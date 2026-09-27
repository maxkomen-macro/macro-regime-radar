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

from typing import Any, Callable

from api import desk_catalog


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
    return {"ok": True, **out}


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
    does not hold is left out. A store without the table lists none."""
    from src.analytics import dbpath
    from src.desk import event_study as es

    conn = dbpath.connect_ro(es.DB_PATH)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_prices'").fetchone():
            return {"instruments": []}
        cutoff = es.resolve_as_of(None, es.DB_PATH)
        rows = conn.execute(
            "SELECT symbol, MIN(date), MAX(date) FROM asset_prices WHERE interval = '1d' AND date <= ? GROUP BY symbol",
            (cutoff,),
        ).fetchall()
    finally:
        conn.close()
    stored = {sym: (first, last) for sym, first, last in rows}
    out = []
    for sym, (name, kind) in INSTRUMENT_NAMES.items():
        if sym in stored:
            first, last = stored[sym]
            out.append({"symbol": sym, "name": name, "kind": kind, "first": first, "last": last, "source": "asset_prices"})
    return {"instruments": out}


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


def technicals_from_level(raw: Any) -> dict:
    """N2 and N3 over a ^GSPC level series (the engine's load_level output): the
    shared `src.desk.technicals.level_technicals` at /technicals' three chart
    ranges, which Basket & Hedge reads for its index too (desk/books), then
    /technicals' RSI, MACD and seasonality (desk/fill-compute) from the shared
    indicators in `src.analytics.technicals`, over the same extended XNYS
    calendar (see `level_technicals`). `_sessions` (the calendar) is for tests
    and is not served."""
    import pandas as pd

    from src.analytics import technicals
    from src.desk import technicals as level

    out = level.level_technicals(raw, ranges=TECH_CHART_MONTHS)
    al = out.pop("_aligned")
    iso = out.pop("_sessions")
    sessions = al.index
    px = al.to_numpy(dtype=float)
    date_ = sessions[iso.index(out["date"])]
    rsi = technicals.rsi(al).to_numpy(dtype=float)
    macd = technicals.macd(al)
    chart = [k for k in range(len(sessions)) if date_ - pd.DateOffset(months=TECH_CHART_MONTHS["6m"]) < sessions[k] <= date_]
    return {
        **out,
        **rsi_fields(rsi, px, iso),
        "macd": macd_fields(macd, iso, chart),
        "seasonality": seasonality_fields(raw),
        "_sessions": iso,
    }


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


def seasonality_fields(raw: Any) -> dict | None:
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
    return {**s, "freq": "monthly", "source": "asset_prices ^GSPC"}


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
