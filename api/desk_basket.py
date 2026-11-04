"""api/desk_basket.py — Basket & Hedge's live routes (desk/books).

`GET /api/desk/basket/price?legs=NVDA:10,AVGO:10,…&method=hold|monthly&notional=1000000`
prices a basket the browser keeps (DESK_FRAME3_SPEC §10, §12.15): the index
and its technicals against the Nasdaq 100 (QQQ) and the S&P 500 (SPY),
contribution, concentration and liquidity. `GET /api/desk/basket/hedge` with
the same parameters ranks the hedge ETFs and runs the linear stress test
(§12.16).

Every number comes from EODHD's daily bars (api/providers/market.daily_bars:
two years, split- and dividend-adjusted, completed sessions only, cached per
ticker per session) through the pure engine in src/desk/basket.py and the
shared technicals in src/desk/technicals.py. Nothing is stored, nothing reads
the database; the answer is computed on request because the basket is the
visitor's, and it rides in the §12.0 envelope with the generation the request
arrived on, like every Desk route.

desk/cap-weight: `weighting=cap` weights the basket by market value at its
start (src/desk/basket.py) from the share counts the full refresh stores
(`share_counts`, src/market_data/share_counts.py), read through the worker
item `desk_share_counts` of the request's generation, never from Yahoo. The
legs are then tickers alone. `GET /api/desk/basket/shares` lists the stored
counts, so the page knows which baskets can be cap-weighted (§12.18). A
database without the table answers both awaiting, with the reason; a name
without a stored count is refused naming it.

`price_answer` and `hedge_answer` are pure over the fetched histories (and,
for cap weight, the counts), so the fixture script
(scripts/desk_basket_fixture.py) and the tests call them directly. Heavy
imports are lazy.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Mapping

from api import desk_envelope as env

log = logging.getLogger("mrr.desk")

# The two benchmarks every basket is read against (§12.15), key → (ticker, label).
BENCHMARKS: dict[str, tuple[str, str]] = {"qqq": ("QQQ", "Nasdaq 100 (QQQ)"), "spy": ("SPY", "S&P 500 (SPY)")}
CHART_RANGES = {"6m": 6, "1y": 12}
# §12.16: the ETFs a basket's hedge is chosen from, in this order, with their names.
HEDGE_ETFS: dict[str, str] = {
    "SMH": "VanEck Semiconductor", "SOXX": "iShares Semiconductor", "QQQ": "Nasdaq 100", "XLK": "Technology Select Sector",
    "IGV": "iShares Expanded Tech-Software", "XLU": "Utilities Select Sector", "SPY": "S&P 500", "IWM": "Russell 2000",
}
# The two benchmarks the stress test moves, and by how much.
STRESS_SHOCKS = ("QQQ", "SPY")
MAX_LEGS = 25
MAX_NOTIONAL = 1e12
PROVIDER = "EODHD"
SOURCE = "EODHD daily bars, split- and dividend-adjusted"
FETCH_WORKERS = 4
PARAMS = ("legs", "method", "notional", "weighting")
WEIGHTINGS = ("target", "cap")
DEFAULT_WEIGHTING = "target"


def parse_params(params: list[tuple[str, str]]) -> tuple[list[tuple[str, float | None]], str, float, str]:
    """The request's legs (canonical ticker, weight in percent; None for a
    cap-weighted basket, whose legs are tickers alone), method, notional and
    weighting, or `Unsupported` naming what is wrong (§12.0: never a silent drop)."""
    from api.providers.symbols import SymbolError, parse
    from src.desk import basket as bk

    keys = [k for k, _ in params]
    unknown = sorted({k for k in keys if k not in PARAMS})
    if unknown:
        raise env.Unsupported(f"There is no {' or '.join(unknown)} parameter.")
    repeated = sorted({k for k in keys if keys.count(k) > 1})
    if repeated:
        raise env.Unsupported(f"The {' and '.join(repeated)} parameter is given more than once.")
    q = dict(params)
    weighting = q.get("weighting", DEFAULT_WEIGHTING)
    if weighting not in WEIGHTINGS:
        raise env.Unsupported(f"The weighting {weighting!r} is not target or cap.")
    cap = weighting == "cap"
    raw = (q.get("legs") or "").strip()
    if not raw:
        raise env.Unsupported("A cap-weighted basket needs its legs: legs=TICKER,TICKER,… with no weights." if cap else
                              "A basket needs its legs: legs=TICKER:weight,… with the weights in percent.")
    legs: list[tuple[str, float | None]] = []
    for part in raw.split(","):
        sym, sep, w = part.partition(":")
        if cap and sep:
            raise env.Unsupported(f"A cap-weighted basket takes its weights from market value: give the leg "
                                  f"{part.strip()!r} as its ticker alone.")
        if not sep and not cap:
            raise env.Unsupported(f"The leg {part.strip()!r} has no weight; write it TICKER:weight.")
        try:
            inst = parse(sym)
        except SymbolError as exc:
            raise env.Unsupported(str(exc)) from exc
        if inst.exchange != "US" or inst.kind != "equity":
            raise env.Unsupported(f"{sym.strip().upper()} is not a US listing; a basket holds US-listed stocks and ETFs.")
        weight: float | None = None
        if not cap:
            try:
                weight = float(w)
            except ValueError:
                raise env.Unsupported(f"The weight of {inst.canonical} is not a number.") from None
            if not (math.isfinite(weight) and 0 < weight <= 100):
                raise env.Unsupported(f"The weight of {inst.canonical} is not above 0% and at most 100%.")
        if any(s == inst.canonical for s, _ in legs):
            raise env.Unsupported(f"{inst.canonical} is in the basket twice.")
        legs.append((inst.canonical, weight))
    if len(legs) > MAX_LEGS:
        raise env.Unsupported(f"A basket holds at most {MAX_LEGS} names; this one has {len(legs)}.")
    if not cap:
        total = sum(w for _, w in legs if w is not None)
        if abs(total - 100.0) > 1e-6:
            raise env.Unsupported(f"The weights add to {total:.10g}%, not 100%.")
    method = q.get("method", bk.DEFAULT_METHOD)
    if method not in bk.METHODS:
        raise env.Unsupported(f"The method {method!r} is not hold or monthly.")
    try:
        notional = float(q["notional"]) if "notional" in q else bk.DEFAULT_NOTIONAL
    except ValueError:
        raise env.Unsupported("The notional is not a number.") from None
    if not (math.isfinite(notional) and 0 < notional <= MAX_NOTIONAL):
        raise env.Unsupported("The notional is not above $0 and at most $1 trillion.")
    return legs, method, notional, weighting


UNADJUSTED = "no adjusted close from the provider"


def history_of(bars_answer: Mapping[str, Any], symbol: str = "") -> Any:
    """An engine History from market.daily_bars' answer: the adjusted closes,
    and each session's dollar volume (EODHD's unadjusted close × volume). A bar
    the provider served without an adjusted close is left out, never priced
    from its raw close (Codex R-07); how many is on the History as
    `unadjusted` for the answer to disclose. A symbol with no adjusted close at
    all is refused. desk/cap-weight (Codex R-01): EODHD's own close is kept as
    the close as traded, which a cap-weighted basket's market values read."""
    from src.desk import basket as bk

    def positive(x: Any) -> bool:
        return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0

    dates, close, dv, traded = [], [], [], []
    left_out = 0
    for b in bars_answer["bars"]:
        c = b.get("close")
        if not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
            continue
        if b.get("adjusted") is not True:
            left_out += 1
            continue
        dates.append(b["ts"][:10])
        close.append(float(c))
        raw, vol = b.get("close_raw"), b.get("volume")
        ok = all(isinstance(x, (int, float)) and math.isfinite(x) and x > 0 for x in (raw, vol))
        dv.append(float(raw) * float(vol) if ok else None)
        traded.append(float(raw) if positive(raw) else None)
    if not dates and left_out:
        raise env.Refused(502, "provider", f"{symbol}: EODHD served no adjusted closes; a basket reads adjusted closes only.")
    h = bk.History(tuple(dates), tuple(close), tuple(dv), tuple(traded))
    object.__setattr__(h, "unadjusted", left_out)
    return h


def excluded(histories: Mapping[str, Any], symbols: list[str]) -> list[dict]:
    """The closes left out of the answer, by symbol, with why (Codex R-07)."""
    return [{"symbol": s, "n": int(getattr(histories[s], "unadjusted", 0)), "reason": UNADJUSTED}
            for s in symbols if getattr(histories[s], "unadjusted", 0)]


def fetch(symbols: list[str]) -> dict[str, Any]:
    """Every symbol's two-year daily history, four at a time. A ticker EODHD
    does not list is refused naming it (422 `unknown_symbol`); any other
    provider failure keeps its status and its words (code `provider`)."""
    from api.providers import market
    from api.providers.errors import EmptyResult, ProviderError, UnknownSymbol

    def one(sym: str) -> Any:
        return history_of(market.daily_bars(sym), sym)

    out: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS, thread_name_prefix="mrr-basket") as pool:
        futures = {s: pool.submit(one, s) for s in symbols}
        for s, fut in futures.items():
            try:
                out[s] = fut.result()
            except (UnknownSymbol, EmptyResult) as exc:
                raise env.Refused(422, "unknown_symbol", f"{s}: {exc.public}") from exc
            except ProviderError as exc:
                raise env.Refused(exc.http_status, "provider", f"{s}: {exc.public}") from exc
    return out


def calendar_for(histories: Mapping[str, Any]) -> list[str]:
    """The XNYS sessions the engine reads (Codex R-02, R-06): from the earliest
    close fetched through the end of the month after the latest, so a
    month-end in the data is known as one. The engine's exchange_calendars
    calendar (src/desk/event_study), never the stored rows."""
    import pandas as pd

    from src.desk import event_study as es

    start = min(h.dates[0] for h in histories.values() if h.dates)
    end = max(h.dates[-1] for h in histories.values() if h.dates)
    beyond = (pd.Timestamp(end) + pd.offsets.MonthEnd(2)).strftime("%Y-%m-%d")
    cal = es.session_calendar(start, end)
    return [d.strftime("%Y-%m-%d") for d in es.sessions_between(cal, start, beyond)]


def _f(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and math.isfinite(x) else None


def _priced(histories: Mapping[str, Any], legs: list[tuple[str, float | None]], method: str, notional: float,
            counts: Mapping[str, Mapping[str, Any]] | None, sessions: list[str]) -> dict:
    """The engine's basket: at the legs' weights, or, given the stored counts (desk/cap-weight), cap-weighted."""
    from src.desk import basket as bk

    names = {s: histories[s] for s, _ in legs}
    try:
        if counts is not None:
            return bk.price_basket(names, None, method, notional, sessions=sessions,
                                   shares_outstanding={s: counts[s]["shares_outstanding"] for s in names if s in counts})
        return bk.price_basket(names, {s: w / 100.0 for s, w in legs}, method, notional, sessions=sessions)
    except bk.BasketError as exc:
        raise env.Unsupported(str(exc)) from exc


def cap_block(priced: Mapping[str, Any], counts: Mapping[str, Mapping[str, Any]] | None) -> dict | None:
    """§12.15's `cap_weights` (desk/cap-weight): where the weights came from, for the label "Cap-weighted:
    market value at the start, current share counts (<provider>, as of <as_of>)": the provider in words, the
    oldest read among the basket's names, the session the market values are taken on, and per name its
    count, its read date, its close there as traded on today's share basis (Codex R-01), its market value and
    its weight. None for typed weights."""
    if counts is None:
        return None
    legs = priced["legs"]
    return {
        "provider": counts_provider(counts[l["symbol"]] for l in legs),
        "source": COUNTS_SOURCE,
        "as_of": min(counts[l["symbol"]]["as_of"] for l in legs),
        "start": priced["start"],
        "legs": [{"symbol": l["symbol"], "shares_outstanding": l["shares_outstanding"], "as_of": counts[l["symbol"]]["as_of"],
                  "close_start": l["close_traded_start"], "value_start": l["value_start"], "weight_start": l["target_weight"]}
                 for l in legs],
    }


def price_answer(histories: Mapping[str, Any], legs: list[tuple[str, float | None]], method: str, notional: float, *,
                 provider: str = PROVIDER, source: str = SOURCE, counts: Mapping[str, Mapping[str, Any]] | None = None) -> dict:
    """§12.15's payload from the fetched histories: the legs' and the two
    benchmarks' (keyed by ticker). `provider` and `source` name where the
    closes came from (the fixture script prices Yahoo's and says so).
    `counts` (desk/cap-weight): the stored share counts by ticker, for a
    cap-weighted basket; None weights it at the legs' weights."""
    import pandas as pd

    from src.desk import basket as bk
    from src.desk import technicals as tech

    names = {s: histories[s] for s, _ in legs}
    sessions = calendar_for(histories)
    priced = _priced(histories, legs, method, notional, counts, sessions)
    level = dict(zip(priced["dates"], priced["index"]))
    raw = pd.Series(priced["index"], index=pd.DatetimeIndex(priced["dates"]))
    t = tech.level_technicals(raw, spec=tech.PRICE_SPEC, ranges=CHART_RANGES, extras=True)
    sessions = t.pop("_sessions")
    t.pop("_aligned")
    t.pop("above_50", None)
    t.pop("above_200", None)
    bench_levels = {k: dict(zip(histories[sym].dates, histories[sym].close)) for k, (sym, _) in BENCHMARKS.items()}
    compare = bk.relative_series(sessions, level, bench_levels,
                                 {r: [p["date"] for p in pts] for r, pts in t["series"].items()})
    benchmarks = {}
    for k, (sym, label) in BENCHMARKS.items():
        h = histories[sym]
        row: dict[str, Any] = {"symbol": sym, "label": label, "price": h.close[-1], "date": h.dates[-1]}
        for w, n in bk.WINDOWS.items():
            r = bk.regression(level, bench_levels[k], n, sessions, priced["end"])
            row[f"beta_{w}"], row[f"corr_{w}"] = r["beta"], r["corr"]
            row[f"window_{w}"] = r["window"]
            row[f"reason_{w}"] = r["reason"]
        # The benchmark's own one-year return over the basket's one-year dates, for the rebased read.
        dates = t["ret_1y_dates"]
        a, b = bench_levels[k].get(dates["from"]), bench_levels[k].get(dates["to"])
        row["ret_1y"] = (b / a - 1.0) if (a and b) else None
        benchmarks[k] = row
    return {
        "method": method,
        "weighting": priced["weighting"],
        "cap_weights": cap_block(priced, counts),
        "notional": notional,
        "provider": provider,
        "source": source,
        "freq": "daily",
        "prices_as_of": priced["end"],
        "history_from": min(h.dates[0] for h in names.values()),
        "start": priced["start"],
        "start_kind": priced["start_kind"],
        "start_binding": priced["start_binding"],
        "start_is_first_close": priced["start_is_first_close"],
        "start_gap_session": priced["start_gap_session"],
        "end": priced["end"],
        "sessions": priced["sessions"],
        "missing_sessions": priced["missing_sessions"],
        "rebalances": priced["rebalances"],
        "total_return": priced["total_return"],
        "legs": [{k: l[k] for k in ("symbol", "target_weight", "weight_now", "first_close", "price_end", "return",
                                    "contribution", "dollars", "adv_usd", "adv_window", "adv_missing", "days_to_trade")}
                 for l in priced["legs"]],
        "excluded": excluded(histories, [s for s, _ in legs] + [sym for sym, _ in BENCHMARKS.values() if sym not in {s for s, _ in legs}]),
        "concentration": priced["concentration"],
        "liquidity": priced["liquidity"],
        "index": t,
        "benchmarks": benchmarks,
        "compare": compare,
    }


def hedge_answer(histories: Mapping[str, Any], legs: list[tuple[str, float | None]], method: str, notional: float, *,
                 provider: str = PROVIDER, source: str = SOURCE, counts: Mapping[str, Mapping[str, Any]] | None = None) -> dict:
    """§12.16's payload: the ETFs ranked by how well each fits the basket's
    daily returns, the top pick, and the linear stress test, for the basket
    at the legs' weights or, given `counts`, cap-weighted (desk/cap-weight)."""
    from src.desk import basket as bk

    sessions = calendar_for(histories)
    priced = _priced(histories, legs, method, notional, counts, sessions)
    level = dict(zip(priced["dates"], priced["index"]))
    etf_levels = {sym: dict(zip(histories[sym].dates, histories[sym].close)) for sym in HEDGE_ETFS}
    # Every fit reads data up to the basket's own last session, never the ETFs' later closes (Codex R-01).
    cutoff = priced["end"]
    rows = bk.hedge_rows(level, etf_levels, notional, sessions, cutoff)
    for r in rows:
        r["label"] = HEDGE_ETFS[r["symbol"]]
    top = next((r for r in rows if r["hedge_ratio"] is not None), None)
    shocks = {sym: etf_levels[sym] for sym in STRESS_SHOCKS}
    return {
        "method": method,
        "weighting": priced["weighting"],
        "cap_weights": cap_block(priced, counts),
        "notional": notional,
        "provider": provider,
        "source": source,
        "freq": "daily",
        "prices_as_of": priced["end"],
        "start": priced["start"],
        "ranked_by": "r2_1y" if any(r["r2_1y"] is not None for r in rows) else "r2_60d",
        "excluded": excluded(histories, [s for s, _ in legs] + [s for s in HEDGE_ETFS if s not in {x for x, _ in legs}]),
        "etfs": rows,
        "top": top["symbol"] if top else None,
        # The stress holds the table's recommended short as it is (Codex R-15).
        "stress": bk.stress(level, shocks, top["symbol"] if top else None, etf_levels[top["symbol"]] if top else None,
                            top["basis"] if top else None, notional, sessions, cutoff,
                            hedge_ratio=top["hedge_ratio"] if top else None),
    }


def _symbols(legs: list[tuple[str, float | None]], extra: list[str]) -> list[str]:
    held = [s for s, _ in legs]
    return held + [s for s in extra if s not in held]


def price(params: list[tuple[str, str]]) -> dict:
    legs, method, notional, weighting = parse_params(params)
    counts = cap_counts([s for s, _ in legs]) if weighting == "cap" else None
    return price_answer(fetch(_symbols(legs, [sym for sym, _ in BENCHMARKS.values()])), legs, method, notional, counts=counts)


def hedge(params: list[tuple[str, str]]) -> dict:
    legs, method, notional, weighting = parse_params(params)
    counts = cap_counts([s for s, _ in legs]) if weighting == "cap" else None
    return hedge_answer(fetch(_symbols(legs, list(HEDGE_ETFS))), legs, method, notional, counts=counts)


# ── desk/cap-weight: the stored share counts ────────────────────────────────

COUNTS_TABLE = "share_counts"
COUNTS_SOURCE = "Yahoo's shares outstanding, read by the full refresh and checked against Yahoo's market cap"
COUNTS_NOT_STORED = "share counts are not stored in this database yet; the next full refresh reads them from Yahoo"
COUNTS_EMPTY = "no share count is stored yet; the next full refresh reads them from Yahoo"
COUNTS_UNREADABLE = "the stored share counts could not be read; the next full refresh stores them again"
COUNTS_ALL_SET_ASIDE = "no stored share count can be read (each is set aside, with why); the next full refresh stores them again"
# The providers the table's `source` names, in words (src/market_data/share_counts.SOURCE is "yfinance").
PROVIDER_WORDS = {"yfinance": "Yahoo", "eodhd": "EODHD"}


def counts_provider(rows) -> str:
    """The providers of some stored counts, in words ("Yahoo")."""
    return ", ".join(sorted({PROVIDER_WORDS.get(r["source"], r["source"]) for r in rows}))


def _count_problem(symbol: Any, shares: Any, as_of: Any, source: Any, today: str) -> str | None:
    """Why one stored count cannot be read, or None: a symbol, a count that is a positive number, a YYYY-MM-DD
    read date no later than today in New York, and a source."""
    import re
    from datetime import date as _date

    if not isinstance(symbol, str) or not symbol.strip():
        return "it names no symbol"
    if isinstance(shares, bool) or not isinstance(shares, (int, float)) or not math.isfinite(shares) or shares <= 0:
        return f"its count {shares!r} is not a positive number"
    try:
        if not isinstance(as_of, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) or _date.fromisoformat(as_of).isoformat() != as_of:
            raise ValueError
    except ValueError:
        return f"its read date {as_of!r} is not a YYYY-MM-DD date"
    if as_of > today:
        return f"its read date {as_of} is after today ({today})"
    if not isinstance(source, str) or not source.strip():
        return "it names no source"
    return None


def desk_share_counts(ctx: dict) -> dict:
    """The worker item `desk_share_counts` (desk/cap-weight): every stored
    share count in the generation's file, each row checked on its own; a row
    that fails is set aside in `excluded` with why. A file without the table,
    one whose table cannot be read, or one with no row that passes answers
    `stored: False` with the reason: a value, never an error, so an old
    database never holds a generation back."""
    import sqlite3
    from datetime import datetime, timezone

    from api import db
    from api.calendar import NY
    from src.analytics import dbpath

    def none(reason: str, excluded: list | None = None) -> dict:
        return {"stored": False, "reason": reason, "counts": {}, "excluded": excluded or []}

    today = datetime.now(timezone.utc).astimezone(NY).date().isoformat()
    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (COUNTS_TABLE,)).fetchone():
            return none(COUNTS_NOT_STORED)
        try:
            rows = conn.execute(f"SELECT symbol, shares_outstanding, as_of, source FROM {COUNTS_TABLE} ORDER BY symbol").fetchall()
        except sqlite3.Error as exc:
            log.warning("desk: share counts not read: %s", exc)
            return none(COUNTS_UNREADABLE)
    finally:
        conn.close()
    counts: dict[str, dict] = {}
    excluded: list[dict] = []
    for sym, shares, as_of, source in rows:
        problem = _count_problem(sym, shares, as_of, source, today)
        if problem:
            excluded.append({"symbol": str(sym), "reason": f"set aside: {problem}"})
            continue
        counts[sym] = {"shares_outstanding": float(shares), "as_of": as_of, "source": source}
    if not counts:
        return none(COUNTS_ALL_SET_ASIDE if excluded else COUNTS_EMPTY, excluded)
    return {"stored": True, "reason": None, "counts": counts, "excluded": excluded}


def stored_counts() -> dict:
    """The request's generation's `desk_share_counts` item (a lookup, never a read of the file)."""
    from api.worker import get_worker

    return get_worker().result("desk_share_counts")


def cap_counts(symbols: list[str]) -> dict[str, dict]:
    """The stored counts a cap-weighted basket reads: awaiting, with the reason, when the generation holds
    none; 422 `unsupported` naming every name without one."""
    item = stored_counts()
    if not item["stored"]:
        raise env.Awaiting(f"Awaiting refresh: cap weight reads stored share counts, and {item['reason']}.")
    aside = {e["symbol"]: e["reason"] for e in item.get("excluded") or []}
    missing = [s for s in symbols if s not in item["counts"] and s not in aside]
    unread = [s for s in symbols if s not in item["counts"] and s in aside]
    if missing or unread:
        parts = []
        if missing:
            parts.append(f"{', '.join(missing)} {'has' if len(missing) == 1 else 'have'} none. The full refresh stores counts "
                         "for the preset baskets' names.")
        for s in unread:
            parts.append(f"{s}'s stored count is {aside[s]}.")
        raise env.Unsupported("Cap weight needs a stored share count for every name: " + " ".join(parts))
    return {s: item["counts"][s] for s in symbols}


def shares(params: list[tuple[str, str]]) -> dict:
    """§12.18 (desk/cap-weight): the stored share counts, so the page knows which baskets can be cap-weighted."""
    if params:
        raise env.Unsupported(f"There is no {' or '.join(sorted({k for k, _ in params}))} parameter.")
    item = stored_counts()
    if not item["stored"]:
        raise env.Awaiting(f"Awaiting refresh: {item['reason']}.")
    counts = item["counts"]
    return {
        "provider": counts_provider(counts.values()),
        "source": COUNTS_SOURCE,
        # the oldest read (a payload's top-level `as_of` is the envelope's, §12.0)
        "counts_as_of": min(c["as_of"] for c in counts.values()),
        "counts": [{"symbol": s, **c} for s, c in counts.items()],
        "excluded": item["excluded"],
    }


# ── desk/basket-study (P1a): the event study on this basket ─────────────────
#
# docs/desk/BASKET_STUDY_SPEC.md is the method. The basket's index is the page's rule
# (price_basket, through _priced) over each name's EODHD daily closes since
# market.STUDY_HISTORY_FROM, handed to the existing engine as a supplied series
# (src/desk/event_study.run_on_supplied_traced): the basket is the shock and the target.
# Computed on request in this module's pool, pinned to the request's generation (its
# regime table and as-of), cached per generation, completed session, basket and question.

STUDY_PARAMS = ("legs", "method", "weighting", "window", "move", "horizon")
STUDY_MOVES = {"down2s": "-", "up2s": "+"}
STUDY_Z = 2.0
STUDY_DEFAULTS = {"window": 5, "move": "down2s", "horizon": 20}
STUDY_KEY = "basket"
STUDY_LABEL = "Basket index"
STUDY_SOURCE = "EODHD daily closes since 1995, split- and dividend-adjusted"
STUDY_TIMEOUT_S = 8.0       # under the browser's 15 s abort, as api/desk.COMPUTE_TIMEOUT_S
STUDY_CACHE_MAX = 32        # finished answers kept
STUDY_OUTSTANDING_MAX = 8   # computations in flight before 429 `busy`
HINDSIGHT = ("The basket is chosen today, so its history is a backtest of names picked knowing how they did; "
             "a name that failed or was delisted cannot be in it.")
REVISED_REGIMES = ("Regime labels are revised regime history: each full refresh rewrites them from today's FRED "
                   "vintages of INDPRO and CPI, so a past label is not what was knowable then. "
                   "As-known-at-the-time labels are not built yet.")
INDEX_RULE = {"hold": "the saved weights bought at the start and held, so each name's weight drifts with its price",
              "monthly": "rebalanced to the saved weights at each month's last session"}

_study_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mrr-basket-study")
_study_lock = threading.Lock()
_study_cache: "OrderedDict[tuple, Any]" = OrderedDict()


class StudyGenerationExpired(RuntimeError):
    """The generation a basket study was submitted under was released before it ran."""


def parse_study_params(params: list[tuple[str, str]]) -> tuple[list[tuple[str, float | None]], str, str, int, str, int]:
    """The basket (parse_params' legs, method and weighting; no notional, which the index's returns do not
    depend on) and the question: `window` (5, 20 or 60 sessions), `move` (down2s or up2s) and `horizon`
    (5, 10, 20 or 60). Anything else is refused naming it (§12.0)."""
    from src.desk import event_study as es

    keys = [k for k, _ in params]
    unknown = sorted({k for k in keys if k not in STUDY_PARAMS})
    if unknown:
        if "notional" in unknown:
            raise env.Unsupported("A study reads the basket's index, whose returns do not depend on the notional: leave notional out.")
        raise env.Unsupported(f"There is no {' or '.join(unknown)} parameter.")
    basket = [(k, v) for k, v in params if k in PARAMS]
    question = dict((k, v) for k, v in params if k not in PARAMS)
    repeated = sorted({k for k in keys if keys.count(k) > 1})
    if repeated:
        raise env.Unsupported(f"The {' and '.join(repeated)} parameter is given more than once.")
    legs, method, _notional, weighting = parse_params(basket)

    def integer(name: str, allowed: tuple[int, ...]) -> int:
        raw = question.get(name)
        if raw is None:
            return STUDY_DEFAULTS[name]
        if raw.strip() not in {str(a) for a in allowed}:
            raise env.Unsupported(f"The {name} {raw!r} is not one of {', '.join(str(a) for a in allowed)} sessions.")
        return int(raw.strip())

    window = integer("window", es.WINDOWS)
    move = question.get("move", STUDY_DEFAULTS["move"])
    if move not in STUDY_MOVES:
        raise env.Unsupported(f"The move {move!r} is not down2s or up2s.")
    horizon = integer("horizon", es.HORIZONS)
    return legs, method, weighting, window, move, horizon


def study_history(cols: Mapping[str, Any], symbol: str = "") -> Any:
    """An engine History from market.daily_closes_since_1995's columns: the adjusted closes, the close as
    traded beside them (cap weight's market values), no dollar volume (the study prices no liquidity). A
    session EODHD served without an adjusted close is left out and counted (`unadjusted`), never priced
    from its raw close (Codex R-07); a name with none at all is refused."""
    from src.desk import basket as bk

    dates, close, traded = [], [], []
    left_out = 0
    for d, adj, raw in zip(cols["dates"], cols["adjusted"], cols["close_raw"]):
        if not (math.isfinite(adj) and adj > 0):
            left_out += 1
            continue
        dates.append(str(d))
        close.append(float(adj))
        traded.append(float(raw) if math.isfinite(raw) and raw > 0 else None)
    if not dates:
        raise env.Refused(502, "provider", f"{symbol}: EODHD served no adjusted closes; a basket reads adjusted closes only.")
    h = bk.History(tuple(dates), tuple(close), tuple([None] * len(dates)), tuple(traded))
    object.__setattr__(h, "unadjusted", left_out)
    return h


def fetch_study(symbols: list[str]) -> dict[str, Any]:
    """Every name's daily closes since 1995, four at a time, refused as `fetch` refuses."""
    from api.providers import market
    from api.providers.errors import EmptyResult, ProviderError, UnknownSymbol

    def one(sym: str) -> Any:
        return study_history(market.daily_closes_since_1995(sym), sym)

    out: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS, thread_name_prefix="mrr-basket-hist") as pool:
        futures = {s: pool.submit(one, s) for s in symbols}
        for s, fut in futures.items():
            try:
                out[s] = fut.result()
            except (UnknownSymbol, EmptyResult) as exc:
                raise env.Refused(422, "unknown_symbol", f"{s}: {exc.public}") from exc
            except ProviderError as exc:
                raise env.Refused(exc.http_status, "provider", f"{s}: {exc.public}") from exc
    return out


def index_block(priced: Mapping[str, Any], histories: Mapping[str, Any], legs: list[tuple[str, float | None]],
                counts: Mapping[str, Mapping[str, Any]] | None, provider: str, source: str,
                session: str | None = None) -> dict:
    """What the studied index is (spec §2): its provider, its start and the name that sets it, its span,
    the sessions it lacks, the closes left out, its rule in words, and the cap weights' source. `session`
    is the completed New York session the closes were asked through; `last_close` is each name's newest
    adjusted close as served, so a provider that has not published that session yet shows (spec §3)."""
    from api.providers import market

    symbols = [s for s, _ in legs]
    return {
        "provider": provider,
        "source": source,
        "requested_from": market.STUDY_HISTORY_FROM,
        "first_close": {l["symbol"]: l["first_close"] for l in priced["legs"]},
        "session": session,
        "last_close": {s: histories[s].dates[-1] for s in symbols},
        "method": priced["method"],
        "weighting": priced["weighting"],
        "rule": (INDEX_RULE[priced["method"]] if priced["weighting"] == "target" else
                 "cap-weighted: market value at the start from today's share counts, each dividend reinvested across the basket"),
        "start": priced["start"],
        "start_kind": priced["start_kind"],
        "start_binding": priced["start_binding"],
        "end": priced["end"],
        "sessions": priced["sessions"],
        "missing_sessions": len(priced["missing_sessions"]),
        "excluded": excluded(histories, symbols),
        "cap_weights": cap_block(priced, counts),
    }


def _study_cutoff(gen: Any) -> str:
    from src.desk import event_study as es

    return es.resolve_as_of(getattr(gen, "as_of", None) or None)


def _study_job(gen: Any, cutoff: str, legs: list[tuple[str, float | None]], method: str, weighting: str,
               counts: Mapping[str, Mapping[str, Any]] | None, w: int, move: str, *,
               provider: str = PROVIDER, source: str = STUDY_SOURCE, histories: Mapping[str, Any] | None = None,
               session: str | None = None) -> dict:
    """One basket study on its generation's copy: fetch, price the index, run the engine. The engine's
    StudyError (too little history for the question) is a value, `ok` False with its words. Every answer
    carries `late` (the names whose newest close is older than `session`, the completed session the
    closes were asked through) and `computed_at`, so study_item asks a late answer again on the
    provider's retry interval (spec §9)."""
    item = _study_answer(gen, cutoff, legs, method, weighting, counts, w, move, provider=provider, source=source,
                         histories=histories, session=session)
    last = item["index"]["last_close"]
    item["late"] = sorted(s for s, d in last.items() if session is not None and d < session)
    item["computed_at"] = time.monotonic()
    return item


def _study_answer(gen: Any, cutoff: str, legs: list[tuple[str, float | None]], method: str, weighting: str,
                  counts: Mapping[str, Mapping[str, Any]] | None, w: int, move: str, *,
                  provider: str, source: str, histories: Mapping[str, Any] | None, session: str | None) -> dict:
    import pandas as pd

    from src.analytics import dbpath
    from src.desk import event_study as es

    symbols = [s for s, _ in legs]
    if histories is None:
        histories = fetch_study(symbols)
    sessions = calendar_for({s: histories[s] for s in symbols})
    priced = _priced(histories, legs, method, 1.0, counts, sessions)
    block = index_block(priced, histories, legs, counts, provider, source, session)
    # the first session a w-session move's z exists on is the (Z_MIN_PRESENT + w)th: the window needs
    # Z_MIN_PRESENT moves, and the first move reads the session w before it
    need = es.Z_MIN_PRESENT + w
    if priced["sessions"] < need:
        binding = ", ".join(priced["start_binding"])
        whose = f"{binding}'s first close" if priced["start_kind"] == "first_close" else "the first session every name has a close"
        return {"ok": False, "index": block,
                "reason": (f"Not enough history yet: the index starts {priced['start']} ({whose}) and has {priced['sessions']} "
                           f"sessions; the first 2σ move over {w} sessions can be judged on its {need}th session "
                           f"({es.Z_MIN_PRESENT} {w}-session moves in a {es.Z_WINDOW}-session window).")}
    level = pd.Series(priced["index"], index=pd.DatetimeIndex(priced["dates"]))
    spec = es.supplied_spec(STUDY_KEY, STUDY_LABEL, f"basket:{','.join(symbols)}", priced["dates"][0],
                            note="A basket's index from its names' daily closes (src/desk/basket.price_basket).")
    provenance = {
        "kind": "basket_index", "provider": provider, "source": source, "rule": "src/desk/basket.price_basket",
        "legs": [[s, w_] for s, w_ in legs], "method": method, "weighting": weighting,
        "counts": None if counts is None else {s: [counts[s]["shares_outstanding"], counts[s]["as_of"]] for s in symbols},
        "requested_from": block["requested_from"], "first_close": block["first_close"],
        "excluded": block["excluded"],
    }
    sup = es.Supplied(spec, level, provenance)
    q = es.Query(kind="shock", shock=STUDY_KEY, target=STUDY_KEY, w=w, z=STUDY_Z, sign=STUDY_MOVES[move])
    conn = dbpath.open_generation(gen)
    if conn is None:
        raise StudyGenerationExpired()
    try:
        native, table, trace = es.run_on_supplied_traced(conn, q, sup, generation=gen.key, as_of=cutoff)
    except es.StudyError as exc:
        return {"ok": False, "index": block, "reason": f"The engine cannot run this question on the index: {exc}"}
    finally:
        conn.close()
    return {"ok": True, "index": block, "native": native, "events": table, "trace": trace}


def _study_submit(gen: Any, key_tail: tuple, job: Any) -> tuple[tuple, Any]:
    """The job's future, cached by what determines its answer: the generation (its id and file key), its
    as-of cutoff, the completed session the closes run to, the basket and the question. Finished entries of
    another generation expire here; a full queue is `Busy`."""
    key = (getattr(gen, "id", None), gen.key) + key_tail
    with _study_lock:
        fut = _study_cache.get(key)
        if fut is not None:
            _study_cache.move_to_end(key)
            return key, fut
        for stale in [k for k, f in _study_cache.items() if k[:2] != key[:2] and f.done()]:
            _study_cache.pop(stale, None)
        if sum(1 for f in _study_cache.values() if not f.done()) >= STUDY_OUTSTANDING_MAX:
            raise env.Busy(f"{STUDY_OUTSTANDING_MAX} basket studies are computing; retry in a few seconds.")
        fut = _study_pool.submit(job)
        _study_cache[key] = fut
        done = [k for k, f in _study_cache.items() if f.done()]
        while len(_study_cache) > STUDY_CACHE_MAX and done:
            _study_cache.pop(done.pop(0), None)
    return key, fut


def clear_study_cache() -> None:
    with _study_lock:
        _study_cache.clear()


def study_item(gen: Any, legs: list[tuple[str, float | None]], method: str, weighting: str,
               counts: Mapping[str, Mapping[str, Any]] | None, w: int, move: str) -> dict:
    """The job's item, or `Computing` while it runs past STUDY_TIMEOUT_S. A generation released before the
    job ran re-submits under the current one and answers `Computing`, so the client's retry lands there."""
    from concurrent.futures import TimeoutError as FutureTimeout

    from api.providers import market

    def submit(g: Any) -> tuple[tuple, Any]:
        cutoff = _study_cutoff(g)
        session = market.last_session()
        tail = (cutoff, session, tuple(legs), method, weighting,
                None if counts is None else tuple(sorted((s, c["shares_outstanding"], c["as_of"]) for s, c in counts.items())),
                w, move)
        return _study_submit(g, tail, lambda: _study_job(g, cutoff, legs, method, weighting, counts, w, move,
                                                         session=session))

    key, fut = submit(gen)
    if fut.done() and fut.exception() is None:
        # a name's close for the session was not published yet when this answer was computed: ask again
        # once the provider's own retry interval has passed (market.DAILY_RETRY_S), as daily_bars does
        done = fut.result()
        if done.get("late") and time.monotonic() - done["computed_at"] > market.DAILY_RETRY_S:
            with _study_lock:
                if _study_cache.get(key) is fut:
                    _study_cache.pop(key, None)
            key, fut = submit(gen)
    try:
        return fut.result(timeout=STUDY_TIMEOUT_S)
    except FutureTimeout:
        raise env.Computing() from None
    except StudyGenerationExpired:
        with _study_lock:
            _study_cache.pop(key, None)
        from api.worker import get_worker

        cur = get_worker().generation()
        if cur is not None and getattr(cur, "id", None) != getattr(gen, "id", None):
            submit(cur)
        raise env.Computing() from None
    except BaseException:
        with _study_lock:
            _study_cache.pop(key, None)  # a failure is not kept: the next request asks again
        raise


def study_projection(item: dict, legs: list[tuple[str, float | None]], method: str, weighting: str,
                     w: int, move: str, h: int) -> dict:
    """§12.19's payload from a job's item: the basket and the question, the index's provenance, and the
    study in §12.2's shape for the horizons the engine computes (null with the reason when not run)."""
    from api import desk_v2 as v2
    from src.desk import event_study as es

    question = {"shock": STUDY_KEY, "window": w, "move": move, "while": "none", "target": STUDY_KEY, "horizon": h,
                "target_unit": "log_return", "display_unit": "percent"}
    out = {
        "basket": {"legs": [{"symbol": s, "weight": wt} for s, wt in legs], "method": method, "weighting": weighting},
        "question": question,
        "index": item["index"],
        "study": None,
        "not_run": None,
        "caveats": [HINDSIGHT, REVISED_REGIMES],
    }
    if item.get("late"):
        ix = item["index"]
        out["caveats"].append(f"EODHD had not published {ix['session']}'s close for {', '.join(item['late'])} when this "
                              f"was computed, so the index runs through {ix['end']}; a request 15 minutes later asks again.")
    if not item["ok"]:
        out["not_run"] = item["reason"]
        return out
    native, table = item["native"], item["events"]
    P = native["provenance"]
    if len(table) != P["n_events"]:
        raise ValueError(f"the event table has {len(table)} events, the run {P['n_events']}")
    unit = "log_return"
    by_h = {H["h"]: H for H in native["horizons"]}
    rows = [v2.horizon_row(H, table, v2.verdict_v1(by_h, H["h"])) for H in native["horizons"]]
    sel = next(r for r in rows if r["h"] == h)
    verdict = sel["verdict"]
    k = len(table)
    year = P["sample_start"][:4]
    empty_state = None
    if sel["n"] < v2.MIN_VERDICT_N:
        empty_state = {"horizon": h,
                       "sentence": (f"Only {sel['n']} events complete at {v2.HORIZON_LABEL[h]} since {year}, fewer than "
                                    "the ten a verdict other than Too few needs."),
                       "fixes": ["widen_window"] if w < max(es.WINDOWS) else []}
    out["study"] = {
        "slug": native["study"]["slug"],
        "label": native["study"]["label"],
        "selected_horizon": h,
        "matched_n": P["n_events"],
        "data_start": P["data_start"], "sample_start": P["sample_start"], "sample_end": P["sample_end"],
        "first_event": table.sessions[int(table.event_idx[0])] if k else None,
        "last_event": table.sessions[int(table.event_idx[-1])] if k else None,
        "verdict": verdict, "verdict_rule": v2.VERDICT_RULE, "verdict_confidence": P["ci"],
        "headline": f"{v2.VERDICT_LABEL[verdict]} at {v2.HORIZON_LABEL[h]}: {v2.VERDICT_DEFINITION[verdict]}",
        "why": v2.why_sentence(sel, unit),
        "horizons": rows,
        "by_regime": [{"h": 20, "regime": r["regime"], "n": c["n"], "up_pct": c["hit_rate"], "median": c["median"]}
                      for r in native["regimes"] if r["regime"] in es.REGIME_LABELS for c in r["horizons"] if c["h"] == 20],
        "regime_history": "revised",
        "unlabeled_n": P["n_unlabeled"],
        "last_events": [
            {"event_date": table.sessions[int(table.event_idx[i])],
             "entry_date": table.sessions[int(table.entry_idx[i])] if table.entry_idx[i] >= 0 else None,
             "regime": table.regime[i],
             "value_20": None if math.isnan(table.value[20][i]) else float(table.value[20][i])}
            for i in range(k - 1, max(-1, k - 6), -1)],
        "provenance": {"entry_rule": v2.entry_rule_words(P["entry_rule"]), "cooldown": P["cooldown_sessions"], "seed": P["seed"],
                       "engine_version": env.ENGINE_VERSION, "as_of_cutoff": P["as_of_cutoff"],
                       "regimes_last": P["regimes_last"], "calendar": P["calendar"]},
        "warnings": list(P["warnings"]),
        "empty_state": empty_state,
        "inputs_hash": P["inputs_hash"],
    }
    return out


def study(params: list[tuple[str, str]], t0: float | None = None) -> dict:
    """§12.19 (desk/basket-study, P1a): the event study on a basket kept in the browser."""

    t0 = time.perf_counter() if t0 is None else t0
    legs, method, weighting, w, move, h = parse_study_params(params)
    counts = cap_counts([s for s, _ in legs]) if weighting == "cap" else None
    gen = env._generation()
    if gen is None:
        from api.worker import Warming

        raise Warming()
    item = study_item(gen, legs, method, weighting, counts, w, move)
    out = study_projection(item, legs, method, weighting, w, move, h)
    out["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
