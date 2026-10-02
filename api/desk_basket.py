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
