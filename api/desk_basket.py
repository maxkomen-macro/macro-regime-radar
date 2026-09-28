"""api/desk_basket.py — Basket & Hedge's live routes (desk/books).

`GET /api/desk/basket/price?legs=NVDA:10,AVGO:10,…&method=hold|monthly&notional=1000000`
prices a basket the browser keeps (DESK_FRAME3_SPEC §10, §12.14): the index
and its technicals against the Nasdaq 100 (QQQ) and the S&P 500 (SPY),
contribution, concentration and liquidity. `GET /api/desk/basket/hedge` with
the same parameters ranks the hedge ETFs and runs the linear stress test
(§12.15).

Every number comes from EODHD's daily bars (api/providers/market.daily_bars:
two years, split- and dividend-adjusted, completed sessions only, cached per
ticker per session) through the pure engine in src/desk/basket.py and the
shared technicals in src/desk/technicals.py. Nothing is stored, nothing reads
the database; the answer is computed on request because the basket is the
visitor's, and it rides in the §12.0 envelope with the generation the request
arrived on, like every Desk route.

`price_answer` and `hedge_answer` are pure over the fetched histories, so the
fixture script (scripts/desk_basket_fixture.py) and the tests call them
directly. Heavy imports are lazy.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Mapping

from api import desk_envelope as env

# The two benchmarks every basket is read against (§12.14), key → (ticker, label).
BENCHMARKS: dict[str, tuple[str, str]] = {"qqq": ("QQQ", "Nasdaq 100 (QQQ)"), "spy": ("SPY", "S&P 500 (SPY)")}
CHART_RANGES = {"6m": 6, "1y": 12}
# §12.15: the ETFs a basket's hedge is chosen from, in this order, with their names.
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
PARAMS = ("legs", "method", "notional")


def parse_params(params: list[tuple[str, str]]) -> tuple[list[tuple[str, float]], str, float]:
    """The request's legs (canonical ticker, weight in percent), method and
    notional, or `Unsupported` naming what is wrong (§12.0: never a silent drop)."""
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
    raw = (q.get("legs") or "").strip()
    if not raw:
        raise env.Unsupported("A basket needs its legs: legs=TICKER:weight,… with the weights in percent.")
    legs: list[tuple[str, float]] = []
    for part in raw.split(","):
        sym, sep, w = part.partition(":")
        if not sep:
            raise env.Unsupported(f"The leg {part.strip()!r} has no weight; write it TICKER:weight.")
        try:
            inst = parse(sym)
        except SymbolError as exc:
            raise env.Unsupported(str(exc)) from exc
        if inst.exchange != "US" or inst.kind != "equity":
            raise env.Unsupported(f"{sym.strip().upper()} is not a US listing; a basket holds US-listed stocks and ETFs.")
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
    total = sum(w for _, w in legs)
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
    return legs, method, notional


def history_of(bars_answer: Mapping[str, Any]) -> Any:
    """An engine History from market.daily_bars' answer: the adjusted closes,
    and each session's dollar volume (EODHD's unadjusted close × volume)."""
    from src.desk import basket as bk

    dates, close, dv = [], [], []
    for b in bars_answer["bars"]:
        c = b.get("close")
        if not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
            continue
        dates.append(b["ts"][:10])
        close.append(float(c))
        raw, vol = b.get("close_raw"), b.get("volume")
        ok = all(isinstance(x, (int, float)) and math.isfinite(x) and x > 0 for x in (raw, vol))
        dv.append(float(raw) * float(vol) if ok else None)
    return bk.History(tuple(dates), tuple(close), tuple(dv))


def fetch(symbols: list[str]) -> dict[str, Any]:
    """Every symbol's two-year daily history, four at a time. A ticker EODHD
    does not list is refused naming it (422 `unknown_symbol`); any other
    provider failure keeps its status and its words (code `provider`)."""
    from api.providers import market
    from api.providers.errors import EmptyResult, ProviderError, UnknownSymbol

    def one(sym: str) -> Any:
        return history_of(market.daily_bars(sym))

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


def price_answer(histories: Mapping[str, Any], legs: list[tuple[str, float]], method: str, notional: float, *,
                 provider: str = PROVIDER, source: str = SOURCE) -> dict:
    """§12.14's payload from the fetched histories: the legs' and the two
    benchmarks' (keyed by ticker). `provider` and `source` name where the
    closes came from (the fixture script prices Yahoo's and says so)."""
    import pandas as pd

    from src.desk import basket as bk
    from src.desk import technicals as tech

    names = {s: histories[s] for s, _ in legs}
    sessions = calendar_for(histories)
    try:
        priced = bk.price_basket(names, {s: w / 100.0 for s, w in legs}, method, notional, sessions=sessions)
    except bk.BasketError as exc:
        raise env.Unsupported(str(exc)) from exc
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
        "concentration": priced["concentration"],
        "liquidity": priced["liquidity"],
        "index": t,
        "benchmarks": benchmarks,
        "compare": compare,
    }


def hedge_answer(histories: Mapping[str, Any], legs: list[tuple[str, float]], method: str, notional: float, *,
                 provider: str = PROVIDER, source: str = SOURCE) -> dict:
    """§12.15's payload: the ETFs ranked by how well each fits the basket's
    daily returns, the top pick, and the linear stress test."""
    from src.desk import basket as bk

    names = {s: histories[s] for s, _ in legs}
    sessions = calendar_for(histories)
    try:
        priced = bk.price_basket(names, {s: w / 100.0 for s, w in legs}, method, notional, sessions=sessions)
    except bk.BasketError as exc:
        raise env.Unsupported(str(exc)) from exc
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
        "notional": notional,
        "provider": provider,
        "source": source,
        "freq": "daily",
        "prices_as_of": priced["end"],
        "start": priced["start"],
        "ranked_by": "r2_1y" if any(r["r2_1y"] is not None for r in rows) else "r2_60d",
        "etfs": rows,
        "top": top["symbol"] if top else None,
        "stress": bk.stress(level, shocks, top["symbol"] if top else None, etf_levels[top["symbol"]] if top else None,
                            top["basis"] if top else None, notional, sessions, cutoff),
    }


def _symbols(legs: list[tuple[str, float]], extra: list[str]) -> list[str]:
    held = [s for s, _ in legs]
    return held + [s for s in extra if s not in held]


def price(params: list[tuple[str, str]]) -> dict:
    legs, method, notional = parse_params(params)
    return price_answer(fetch(_symbols(legs, [sym for sym, _ in BENCHMARKS.values()])), legs, method, notional)


def hedge(params: list[tuple[str, str]]) -> dict:
    legs, method, notional = parse_params(params)
    return hedge_answer(fetch(_symbols(legs, list(HEDGE_ETFS))), legs, method, notional)
