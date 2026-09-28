"""api/desk_items.py — the Desk v2 worker items (desk/frame-3-api, B1).

Every /study-family answer is a lookup (docs/desk/FRAME3_API_PLAN.md §0.2):
each query-backed catalog study is a worker item, `desk_study:<slug>`,
rebuilt with every generation (api/analytics_cache.ITEMS registers them). A
builder returns one of three values (plan §1.0):

- `{"ok": True, "native": <the unchanged run() dict>, "events": EventTable,
  "trace": SignalTrace, "pre1970": {input_key: N}}`;
- `{"ok": False, "kind": "not_stored", "reason", "series"}`: an input the
  store does not hold (the engine's NotStored, in its words);
- `{"ok": False, "kind": "study_error", "reason", "series": None}`: the
  engine's StudyError, e.g. "no evaluable session".

Both refusals are values, so they never hold a generation back; any other
exception propagates and is stored as the item's error.

`native` is what `es.run(query)` returns for the same generation and as-of,
byte for byte: the builder opens the connection `run` would and passes the
same generation key and cutoff, so api/analytics_cache's presets may reuse it.
The connection is closed on every path. Every heavy import is lazy.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from api import desk_catalog

log = logging.getLogger("mrr.desk")


def desk_study(slug: str) -> Callable[[dict], dict]:
    """The worker item for one catalog study."""
    study = desk_catalog.BY_SLUG[slug]
    kwargs = study.engine_kwargs
    if kwargs is None:
        raise ValueError(f"{slug} has no engine query")

    def build(ctx: dict) -> dict:
        from src.analytics import dbpath
        from src.desk import event_study as es

        q = es.Query(**kwargs)
        cutoff = es.resolve_as_of(None, es.DB_PATH)
        conn = es._connect(es.DB_PATH)
        try:
            try:
                native, table, trace = es.run_on_traced(conn, q, generation=dbpath.current_key(es.DB_PATH), as_of=cutoff)
            except es.NotStored as exc:
                return {"ok": False, "kind": "not_stored", "reason": str(exc), "series": exc.series}
            except es.StudyError as exc:
                return {"ok": False, "kind": "study_error", "reason": str(exc), "series": None}
            pre1970 = pre1970_counts(conn, native, trace, cutoff)
        finally:
            conn.close()
        return {"ok": True, "native": native, "events": table, "trace": trace, "pre1970": pre1970}

    build.__name__ = f"_desk_study_{slug.replace('-', '_')}"
    return build


def desk_technicals(ctx: dict) -> dict:
    """The /technicals item (plan §1.7, N2 and N3): the S&P 500's averages,
    trend, cross, returns and chart series from the stored ^GSPC closes, read
    through the engine's `load_level` and aligned as the engine aligns. A store
    without them is a refusal value, like a catalog study's."""
    from src.desk import event_study as es
    from src.desk import series as registry

    spec = registry.get("spx")
    cutoff = es.resolve_as_of(None, es.DB_PATH)
    conn = es._connect(es.DB_PATH)
    try:
        try:
            raw = es.load_level(conn, spec, cutoff)
        except es.NotStored as exc:
            return {"ok": False, "kind": "not_stored", "reason": str(exc), "series": exc.series}
    finally:
        conn.close()
    out = technicals_from_level(raw)
    out.pop("_sessions")
    # The S&P's own closes, kept for the relative strength of every other instrument (never served).
    return {"ok": True, **out, "_level": raw}


# The instruments this store prices from its own daily history (desk/usability): the US-listed ETFs
# the full refresh stores in asset_prices for allocation, and the S&P 500 itself. The Desk's
# instrument search falls back to this list when the upstream search does not answer. Names are
# written out here (api/ never imports src.analytics.allocation, which configures the symbols);
# tests/test_desk_instruments.py pins that every stored daily ETF has one.
INSTRUMENT_NAMES: dict[str, tuple[str, str]] = {
    "^GSPC": ("S&P 500", "index"),
    "SPY": ("SPDR S&P 500 ETF Trust", "etf"),
    "IWM": ("iShares Russell 2000 ETF", "etf"),
    "EFA": ("iShares MSCI EAFE ETF", "etf"),
    "EEM": ("iShares MSCI Emerging Markets ETF", "etf"),
    "AGG": ("iShares Core US Aggregate Bond ETF", "etf"),
    "IEF": ("iShares 7-10 Year Treasury Bond ETF", "etf"),
    "LQD": ("iShares iBoxx $ Investment Grade Corporate Bond ETF", "etf"),
    "HYG": ("iShares iBoxx $ High Yield Corporate Bond ETF", "etf"),
    "DJP": ("iPath Bloomberg Commodity Index Total Return ETN", "etf"),
    "GLD": ("SPDR Gold Shares", "etf"),
}


def desk_instruments(ctx: dict) -> dict:
    """The /instruments item: every named instrument with stored daily closes
    in asset_prices, its first and last stored session; an instrument the store
    does not hold is left out. A store without the table lists none.

    desk/usability item 2: each stored ETF's technicals too, by the shared
    function over its stored closes, its relative strength against the stored
    S&P 500 (the `desk_technicals` item's level, listed before this one), so
    /technicals?symbol=<a stored ETF> is a lookup. An ETF whose technicals
    cannot be computed is left out of `technicals`, and the route then asks
    the provider like any other stock.

    Codex R-08: each instrument's rows are read and checked on their own (a
    canonical YYYY-MM-DD date, a finite positive close); one malformed row
    drops that instrument, listed in `excluded` with the reason, and every
    other instrument stands. Its first and last sessions are its checked
    rows'. Round 2: the conversion to a dated series happens inside the same
    per-instrument isolation, so a date that passes the check and still
    cannot be converted excludes its instrument, never the item."""
    import pandas as pd

    from src.analytics import dbpath
    from src.desk import event_study as es

    conn = dbpath.connect_ro(es.DB_PATH)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_prices'").fetchone():
            return {"instruments": [], "technicals": {}, "excluded": []}
        cutoff = es.resolve_as_of(None, es.DB_PATH)
        out, closes, excluded = [], {}, []
        for sym, (name, kind) in INSTRUMENT_NAMES.items():
            rows = conn.execute(
                "SELECT date, close FROM asset_prices WHERE symbol = ? AND interval = '1d' AND date <= ? ORDER BY date",
                (sym, cutoff),
            ).fetchall()
            if not rows:
                continue
            bad = [why for why in (_row_problem(d, c) for d, c in rows) if why]
            if bad:
                excluded.append({"symbol": sym, "reason": f"{len(bad)} stored row{'' if len(bad) == 1 else 's'} could not be read ({bad[0]}); not offered until the store is repaired."})
                continue
            try:
                # Every instrument's dates are converted here, inside its own isolation (Codex R-08, round 2).
                level = pd.Series([float(c) for _, c in rows], index=pd.DatetimeIndex([d for d, _ in rows], dtype="datetime64[ns]"))
            except Exception as exc:  # noqa: BLE001 — any failure is this instrument's, never the item's
                log.warning("desk: instrument %s excluded: %s", sym, exc)
                excluded.append({"symbol": sym, "reason": f"its stored dates could not be read ({type(exc).__name__}); not offered until the store is repaired."})
                continue
            out.append({"symbol": sym, "name": name, "kind": kind, "first": rows[0][0], "last": rows[-1][0], "source": "asset_prices"})
            if kind == "etf":
                closes[sym] = level
    finally:
        conn.close()
    from src.desk.technicals import PRICE_SPEC

    spx = ctx.get("desk_technicals") or {}
    bench = spx.get("_level") if spx.get("ok") else None
    technicals = {}
    for sym, level in closes.items():
        try:
            t = technicals_from_level(level, spec=PRICE_SPEC, bench=bench, source=f"asset_prices {sym}")
        except Exception as exc:  # noqa: BLE001 — too short a history, or any one-ETF failure: listed, no technicals
            log.warning("desk: technicals for %s not computed: %s", sym, exc)
            continue
        t.pop("_sessions")
        technicals[sym] = t
    return {"instruments": out, "technicals": technicals, "excluded": excluded}


def _row_problem(d: Any, close: Any) -> str | None:
    """Why one stored daily row cannot be read (Codex R-08), or None: its date must be a canonical YYYY-MM-DD
    calendar date (round 2: `date.fromisoformat` alone also takes ISO week dates such as '2025-W01-1', ten
    characters that pandas cannot convert) and its close a finite positive number."""
    import math
    import re
    from datetime import date as _date

    try:
        if not isinstance(d, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or _date.fromisoformat(d).isoformat() != d:
            raise ValueError
    except ValueError:
        return f"{d!r} is not a YYYY-MM-DD date"
    if isinstance(close, bool) or not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0:
        return f"{d}: close {close!r} is not a positive number"
    return None


# /overview's data_status contributors (plan N9): the tier-1 inputs of the twelve Ledger
# studies plus DGS2 and DGS10, by registry key, in the plan's order.
FACT_KEYS = ("curve_2s10s", "vix", "hy_oas", "us2y", "us10y", "spx", "gold")
VIX_RECENT_ROWS = 40


def desk_facts(ctx: dict) -> dict:
    """/overview's stored facts (plan §7 commit 9): the newest stored date and
    value of each data_status contributor, read through the engine's
    `load_level` (provenance-aware; None for a series the store lacks), the
    last VIX rows, for the change between the two comparison sessions, and
    the VIX's gap to the S&P's realized volatility (`vol_gap`). `awaiting`
    holds the engine's words for a contributor the store has not reached yet
    (a series its next full refresh stores, desk/fill-compute: ^VIX)."""
    from src.desk import event_study as es
    from src.desk import series as registry

    cutoff = es.resolve_as_of(None, es.DB_PATH)
    newest: dict[str, dict | None] = {}
    vix_recent: dict[str, float] = {}
    loaded: dict[str, Any] = {}
    awaiting: dict[str, str] = {}
    conn = es._connect(es.DB_PATH)
    try:
        for key in FACT_KEYS:
            spec = registry.get(key)
            try:
                s = es.load_level(conn, spec, cutoff)
            except es.NotStored as exc:
                newest[spec.series_id] = None
                if getattr(exc, "awaiting_refresh", False):
                    awaiting[spec.series_id] = str(exc)
                continue
            loaded[key] = s
            newest[spec.series_id] = {"date": s.index[-1].strftime("%Y-%m-%d"), "value": float(s.iloc[-1])}
            if key == "vix":
                vix_recent = {d.strftime("%Y-%m-%d"): float(v) for d, v in s.iloc[-VIX_RECENT_ROWS:].items()}
    finally:
        conn.close()
    gap = vol_gap(loaded["spx"], loaded["vix"]) if "spx" in loaded and "vix" in loaded else None
    return {"newest": newest, "vix_recent": vix_recent, "vol_gap": gap, "awaiting": awaiting}


def vol_gap(spx: Any, vix: Any) -> dict | None:
    """/overview's VIX gap to realized volatility (spec §12.1, desk/fill-compute):
    on the XNYS calendar, the S&P's 21-day realized volatility
    (src/analytics/technicals.realized_vol: annualized, in VIX points, from 21
    daily log returns, every one of them needing both its closes) and the VIX
    on the latest session where both exist; the gap is VIX minus realized.
    None when no session has both."""
    import math

    import numpy as np

    from src.analytics import technicals
    from src.desk import event_study as es
    from src.desk import series as registry

    start = min(spx.index[0], vix.index[0]).strftime("%Y-%m-%d")
    end = max(spx.index[-1], vix.index[-1]).strftime("%Y-%m-%d")
    sessions = es.sessions_between(es.session_calendar(start, end), start, end)
    px, _off, _missing = es.align(spx, sessions)
    px, _bad, _why = es.validate_values(px, registry.get("spx"))
    vx, _off, _missing = es.align(vix, sessions)
    rv = technicals.realized_vol(px).to_numpy(dtype=float)
    v = vx.to_numpy(dtype=float)
    both = np.flatnonzero(np.isfinite(rv) & np.isfinite(v))
    if not len(both):
        return None
    i = int(both[-1])
    w = technicals.REALIZED_WINDOW
    iso = [d.strftime("%Y-%m-%d") for d in sessions]
    realized = float(rv[i])
    if not math.isfinite(realized):
        return None
    return {"date": iso[i], "vix": float(v[i]), "realized_21d": realized, "gap_pts": float(v[i]) - realized,
            "window": {"start": iso[i - w], "end": iso[i], "n": w}}


TECH_CHART_MONTHS = {"6m": 6, "1y": 12, "3y": 36}


def trend_states(price, ma50, ma200) -> list[str]:
    """Plan N2 per session; the one implementation is src/desk/technicals (desk/books)."""
    from src.desk import technicals

    return technicals.trend_states(price, ma50, ma200)


# desk/usability item 2: the figures /technicals adds for any symbol, beside main's.
HIGH_WINDOW = 252   # the drawdown from the high of the last 252 session slots (one year)
RS_CHANGE_N = 63    # relative strength's change over 63 sessions (three months)


def technicals_from_level(raw: Any, *, spec: Any = None, ranges: dict[str, int] | None = None, bench: Any = None,
                          source: str = "asset_prices ^GSPC") -> dict:
    """N2 and N3 over a level series (the engine's load_level output for
    ^GSPC; desk/usability: any stock's or stored ETF's daily closes, `spec`
    `src.desk.technicals.PRICE_SPEC`): the shared
    `src.desk.technicals.level_technicals` at /technicals' chart ranges, which
    Basket & Hedge reads for its index too (desk/books), then /technicals' RSI,
    MACD and seasonality (desk/fill-compute) from the shared indicators in
    `src.analytics.technicals`, over the same extended XNYS calendar (see
    `level_technicals`), for whatever symbol the closes are.

    desk/usability adds (`usability_fields`), on the same calendar: the
    drawdown from the high of the last 252 slots, the 21-day realized
    volatility (the shared `realized_vol`) as a fraction, and, given a `bench`
    level (the stored S&P 500), the relative strength. `_sessions` (the
    calendar) is for tests and is not served."""
    import pandas as pd

    from src.analytics import technicals
    from src.desk import technicals as level

    ranges = ranges if ranges is not None else TECH_CHART_MONTHS
    out = level.level_technicals(raw, spec=spec, ranges=ranges)
    al = out.pop("_aligned")
    iso = out.pop("_sessions")
    sessions = al.index
    px = al.to_numpy(dtype=float)
    i = iso.index(out["date"])
    date_ = sessions[i]
    rsi = technicals.rsi(al).to_numpy(dtype=float)
    macd = technicals.macd(al)
    chart = [k for k in range(len(sessions)) if date_ - pd.DateOffset(months=TECH_CHART_MONTHS["6m"]) < sessions[k] <= date_]
    return {
        **out,
        **rsi_fields(rsi, px, iso),
        "macd": macd_fields(macd, iso, chart),
        "seasonality": seasonality_fields(raw, source),
        **usability_fields(al, px, iso, i, ranges, bench),
        "_sessions": iso,
    }


def usability_fields(al: Any, px: Any, iso: list[str], i: int, ranges: dict[str, int], bench: Any) -> dict:
    """desk/usability item 2's figures for any symbol, each null when a slot it
    reads has no close: `drawdown` from the high of the last 252 slots (the
    earliest session on a tie), `complete` only when all 252 hold a valid close
    (Codex R-01: a shorter or broken history is partial, and `window.n` says
    how many it read); `realized_vol`, the shared
    `src.analytics.technicals.realized_vol` (21 daily log returns, none
    missing) as a fraction; and, given `bench` (the stored S&P 500), `rs`: the
    close divided by the benchmark's on each session, its 50-session average,
    its 63-session change and the chart series rebased to 100."""
    import math

    import numpy as np
    import pandas as pd

    from src.analytics import technicals
    from src.desk import event_study as es
    from src.desk import series as registry

    sessions = al.index
    date_ = sessions[i]

    def f(x: float) -> float | None:
        return float(x) if math.isfinite(x) else None

    def window(w: int) -> dict:
        lo = i - w + 1
        return {"start": iso[lo], "end": iso[i], "n": int(np.isfinite(px[lo:i + 1]).sum())}

    def in_range(months: int) -> list[int]:
        lo = date_ - pd.DateOffset(months=months)
        return [k for k in range(len(sessions)) if lo < sessions[k] <= date_]

    lo = i - HIGH_WINDOW + 1
    hi_k = lo + int(np.nanargmax(px[lo:i + 1]))
    dd_window = window(HIGH_WINDOW)
    drawdown = {"value": float(px[i] / px[hi_k] - 1), "peak": {"date": iso[hi_k], "close": float(px[hi_k])}, "window": dd_window,
                "complete": dd_window["n"] >= HIGH_WINDOW}

    w = technicals.REALIZED_WINDOW
    rv = technicals.realized_vol(al).to_numpy(dtype=float)
    realized_vol = {"value": f(rv[i] / 100.0), "window": {"start": iso[i - w], "end": iso[i], "n": w},
                    "annualization": technicals.PERIODS_PER_YEAR}

    rs = None
    if bench is not None and len(bench):
        bl, _o, _m = es.align(bench, sessions)
        bl, _b, _w = es.validate_values(bl, registry.get("spx"))
        bx = bl.to_numpy(dtype=float)
        ratio = np.where(np.isfinite(px) & np.isfinite(bx), px / np.where(bx == 0, np.nan, bx), np.nan)
        rma = pd.Series(ratio).rolling(50, min_periods=50).mean().to_numpy(dtype=float)
        both = np.flatnonzero(np.isfinite(ratio[: i + 1]))
        if len(both):
            k = int(both[-1])
            chg = ratio[k] / ratio[k - RS_CHANGE_N] - 1 if k >= RS_CHANGE_N and math.isfinite(ratio[k - RS_CHANGE_N]) else math.nan
            rs_series = {}
            for name, months in ranges.items():
                ks = in_range(months)
                base = next((ratio[x] for x in ks if math.isfinite(ratio[x])), math.nan)
                rs_series[name] = [{"date": iso[x], "rs": f(100 * ratio[x] / base), "rs_ma50": f(100 * rma[x] / base)} for x in ks]
            rs = {"benchmark": "^GSPC", "date": iso[k], "value": float(ratio[k]), "ma50": f(rma[k]),
                  "vs_ma50": f(ratio[k] / rma[k] - 1) if math.isfinite(rma[k]) else None,
                  "chg_3m": f(chg), "chg_3m_dates": {"from": iso[k - RS_CHANGE_N], "to": iso[k]} if k >= RS_CHANGE_N else None,
                  "series": rs_series}
    return {"drawdown": drawdown, "realized_vol": realized_vol, "rs": rs}


def macd_fields(m: Any, iso: list[str], chart: list[int]) -> dict | None:
    """/technicals' MACD block (spec §12.7, desk/fill-compute): the shared
    MACD(12, 26, 9) (src/analytics/technicals.macd) on the extended calendar.
    `date` is its newest defined session (a gap in the closes holds it on the
    last session before the gap until the averages re-seed, as the RSI is
    held); the line, the signal and the histogram there; the latest strict
    crossing of the line over its signal; and `series`, one point per session
    of the price chart's 6M range (`chart`), null where the MACD is not
    defined. None when it is defined on no session."""
    import math

    import numpy as np

    from src.analytics import technicals

    hist = m["hist"].to_numpy(dtype=float)
    line = m["macd"].to_numpy(dtype=float)
    sig = m["signal"].to_numpy(dtype=float)
    defined = np.flatnonzero(np.isfinite(hist))
    if not len(defined):
        return None
    k = int(defined[-1])

    def f(x: float) -> float | None:
        return float(x) if math.isfinite(x) else None

    crosses = technicals.macd_crossings(m["hist"])
    last = crosses[-1] if crosses else None
    return {
        "date": iso[k], "macd": float(line[k]), "signal": float(sig[k]), "hist": float(hist[k]),
        "last_cross": None if last is None else {"date": iso[last[0]], "kind": last[1]},
        "params": {"fast": technicals.MACD_FAST, "slow": technicals.MACD_SLOW, "signal": technicals.MACD_SIGNAL},
        "series": [{"date": iso[i], "macd": f(line[i]), "signal": f(sig[i]), "hist": f(hist[i])} for i in chart],
    }


def seasonality_fields(raw: Any, source: str = "asset_prices ^GSPC") -> dict | None:
    """/technicals' seasonality (spec §12.7, desk/fill-compute, the owner's
    item 10): the shared `src/analytics/technicals.monthly_seasonality` over
    every stored close, on the XNYS calendar through the end of the newest
    close's month (`desk_items_macro.month_closes`, the regime table's input),
    so a month counts once it is complete. None when no month is."""
    from api.desk_items_macro import month_closes
    from src.analytics import technicals

    s = technicals.monthly_seasonality(month_closes(raw))
    if not s["window"]["n"]:
        return None
    return {**s, "freq": "monthly", "source": source}


RSI_AFTER = 20  # sessions: the S&P's move after the last session in each RSI zone


def rsi_fields(rsi: Any, px: Any, iso: list[str]) -> dict:
    """/technicals' RSI fields (spec §12.7, desk/fill-compute) from the shared
    RSI (src/analytics/technicals.rsi) on the extended calendar. `rsi` is the newest defined value and
    `rsi_date` its session (a gap in the closes leaves the last one before it
    until fifteen contiguous closes re-seed it); `rsi_prev` is the RSI on the
    session before `rsi_date`, null when it is not defined there. The last
    session strictly above 70, and strictly below 30, each with its RSI and
    the S&P's simple return over the next 20 sessions, and that return's
    status (Codex R-08): `complete`; `pending` while the twentieth session is
    after the newest stored close (the window is not complete yet); `missing`
    when it is not, but its close, or the visit's own, is not stored."""
    import math

    import numpy as np

    from src.analytics import technicals

    def f(x: float) -> float | None:
        return float(x) if math.isfinite(x) else None

    defined = np.flatnonzero(np.isfinite(rsi))
    if not len(defined):
        return {"rsi": None, "rsi_date": None, "rsi_prev": None, "rsi_prev_date": None,
                "rsi_last_above_70": None, "rsi_last_below_30": None}
    k = int(defined[-1])

    def last_where(mask: Any) -> dict | None:
        hits = np.flatnonzero(mask)
        if not len(hits):
            return None
        j = int(hits[-1])
        end = j + RSI_AFTER
        if end >= len(px):
            return {"date": iso[j], "rsi": float(rsi[j]), "after_20d": None, "after_20d_to": None, "after_20d_status": "pending"}
        after = f(px[end] / px[j] - 1) if math.isfinite(px[j]) else None
        return {"date": iso[j], "rsi": float(rsi[j]), "after_20d": after, "after_20d_to": iso[end],
                "after_20d_status": "complete" if after is not None else "missing"}

    valid = np.isfinite(rsi)
    return {
        "rsi": float(rsi[k]), "rsi_date": iso[k],
        "rsi_prev": f(rsi[k - 1]) if k >= 1 else None, "rsi_prev_date": iso[k - 1] if k >= 1 else None,
        "rsi_last_above_70": last_where(valid & (np.nan_to_num(rsi, nan=0.0) > technicals.RSI_UPPER)),
        "rsi_last_below_30": last_where(valid & (np.nan_to_num(rsi, nan=100.0) < technicals.RSI_LOWER)),
    }


def pre1970_counts(conn: Any, native: dict, trace: Any, cutoff: str) -> dict[str, int]:
    """Plan §1.2 (round 4's R-10): for each input whose stored history starts
    before 1970-01-01, the dates the engine counts as calendar sessions without
    a value that are NYSE holidays: an api/calendar holiday before 1970, inside
    the input's stored range, a session of the study's own calendar, and a date
    on which the input has no stored value. Empty for every other study."""
    from api.calendar import HOLIDAYS
    from src.desk import event_study as es
    from src.desk import series as registry

    out: dict[str, int] = {}
    sessions = set(trace.sessions)
    for m in native["provenance"]["inputs"]:
        first, last = m["history_from"], m["last"]
        if first >= "1970-01-01" or not m["missing_sessions"]:
            continue
        stored = set(es.load_level(conn, registry.get(m["key"]), cutoff).index.strftime("%Y-%m-%d"))
        n = sum(1 for year, days in HOLIDAYS.items() if year < 1970 for d in days
                if first <= d.isoformat() <= last and d.isoformat() in sessions and d.isoformat() not in stored)
        if n:
            out[m["key"]] = n
    return out
