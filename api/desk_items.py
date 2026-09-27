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


# /overview's data_status contributors (plan N9): the tier-1 inputs of the twelve Ledger
# studies plus DGS2 and DGS10, by registry key, in the plan's order.
FACT_KEYS = ("curve_2s10s", "vix", "hy_oas", "us2y", "us10y", "spx", "gold")
VIX_RECENT_ROWS = 40


def desk_facts(ctx: dict) -> dict:
    """/overview's stored facts (plan §7 commit 9): the newest stored date and
    value of each data_status contributor, read through the engine's
    `load_level` (provenance-aware; None for a series the store lacks), and
    the last VIX rows, for the change between the two comparison sessions."""
    from src.desk import event_study as es
    from src.desk import series as registry

    cutoff = es.resolve_as_of(None, es.DB_PATH)
    newest: dict[str, dict | None] = {}
    vix_recent: dict[str, float] = {}
    conn = es._connect(es.DB_PATH)
    try:
        for key in FACT_KEYS:
            spec = registry.get(key)
            try:
                s = es.load_level(conn, spec, cutoff)
            except es.NotStored:
                newest[spec.series_id] = None
                continue
            newest[spec.series_id] = {"date": s.index[-1].strftime("%Y-%m-%d"), "value": float(s.iloc[-1])}
            if key == "vix":
                vix_recent = {d.strftime("%Y-%m-%d"): float(v) for d, v in s.iloc[-VIX_RECENT_ROWS:].items()}
    finally:
        conn.close()
    return {"newest": newest, "vix_recent": vix_recent}


TECH_CHART_MONTHS = {"6m": 6, "1y": 12, "3y": 36}


def trend_states(price, ma50, ma200) -> list[str]:
    """Plan N2, per session, strict both ways: unavailable when either average
    is null; above_both above both; below_both below both; mixed otherwise (a
    price equal to either average is mixed)."""
    import math

    out = []
    for p, a, b in zip(price, ma50, ma200):
        if math.isnan(a) or math.isnan(b) or math.isnan(p):
            out.append("unavailable")
        elif p > a and p > b:
            out.append("above_both")
        elif p < a and p < b:
            out.append("below_both")
        else:
            out.append("mixed")
    return out


def technicals_from_level(raw: Any) -> dict:
    """N2 and N3 over a ^GSPC level series (the engine's load_level output).

    One extended XNYS calendar runs through the newest stored close and opens on
    1 January of the year four years before the first stored close; before that
    close it holds at least the larger of 252 sessions (ret_1y) and the 36-month
    chart range plus 200 sessions (every chart point's average slots), asserted.
    A session before the first close is a slot with no close, never a missing
    slot or a wrapped index. Averages are the engine's rolling means with
    min_periods equal to the window, so one missing close in the slots makes
    the average null. `_sessions` (the calendar) is for tests and is not served."""
    import math

    import numpy as np
    import pandas as pd

    from src.analytics import technicals
    from src.desk import event_study as es
    from src.desk import series as registry

    spec = registry.get("spx")
    first, last = raw.index[0], raw.index[-1]
    start = (first - pd.DateOffset(years=4)).strftime("%Y-%m-%d")
    end = last.strftime("%Y-%m-%d")
    sessions = es.sessions_between(es.session_calendar(start, end), start, end)
    al, _off, _missing = es.align(raw, sessions)
    al, _bad, _why = es.validate_values(al, spec)
    px = al.to_numpy(dtype=float)
    closes = np.flatnonzero(np.isfinite(px))
    i = int(closes[-1])  # `date`: the newest session with a close
    date_ = sessions[i]
    n36 = int(((sessions > date_ - pd.DateOffset(months=36)) & (sessions <= date_)).sum())
    before = int((sessions < first).sum())
    if before < max(252, n36 + 200):
        raise ValueError(f"the extended calendar holds {before} sessions before the first close, fewer than {max(252, n36 + 200)}")
    ma50 = al.rolling(50, min_periods=50).mean().to_numpy(dtype=float)
    ma200 = al.rolling(200, min_periods=200).mean().to_numpy(dtype=float)
    iso = [d.strftime("%Y-%m-%d") for d in sessions]

    def f(x: float) -> float | None:
        return float(x) if math.isfinite(x) else None

    def ret(j: int) -> float | None:
        return f(px[i] / px[j] - 1) if math.isfinite(px[j]) else None

    def window(w: int) -> dict:
        lo = i - w + 1
        return {"start": iso[lo], "end": iso[i], "n": int(np.isfinite(px[lo:i + 1]).sum())}

    states = trend_states(px, ma50, ma200)
    first_pos = int(sessions.searchsorted(first))
    j = i
    while j - 1 >= first_pos and states[j - 1] == states[i]:
        j -= 1
    crosses = []
    for kind in ("golden", "death"):
        pos = es.cross_positions(al, kind)[0]
        if len(pos):
            crosses.append((int(pos[-1]), kind))
    cross = None
    if crosses:
        p, kind = max(crosses)
        cross = {"kind": kind, "date": iso[p]}
    rsi = technicals.rsi(al).to_numpy(dtype=float)
    series = {}
    for name, months in TECH_CHART_MONTHS.items():
        lo = date_ - pd.DateOffset(months=months)
        series[name] = [{"date": iso[k], "close": f(px[k]), "ma50": f(ma50[k]), "ma200": f(ma200[k])}
                        for k in range(len(sessions)) if lo < sessions[k] <= date_]
    price = float(px[i])
    m50, m200 = f(ma50[i]), f(ma200[i])
    return {
        "price": price, "date": iso[i],
        "chg_1d": ret(i - 1), "chg_1d_dates": {"from": iso[i - 1], "to": iso[i]},
        "ret_1y": ret(i - 252), "ret_1y_dates": {"from": iso[i - 252], "to": iso[i]},
        "ma50": m50, "ma200": m200, "ma50_window": window(50), "ma200_window": window(200),
        "vs_ma50": None if m50 is None else price / m50 - 1, "vs_ma200": None if m200 is None else price / m200 - 1,
        "above_50": None if m50 is None else price > m50, "above_200": None if m200 is None else price > m200,
        "trend": {"state": states[i], "state_since": iso[j]},
        "cross": cross,
        "series": series,
        **rsi_fields(rsi, px, iso),
        "_sessions": iso,
    }


RSI_AFTER = 20  # sessions: the S&P's move after the last session in each RSI zone


def rsi_fields(rsi: Any, px: Any, iso: list[str]) -> dict:
    """/technicals' RSI fields (spec §12.7, desk/fill-compute) from the shared
    RSI (src/analytics/technicals.rsi) on the extended calendar. `rsi` is the newest defined value and
    `rsi_date` its session (a gap in the closes leaves the last one before it
    until fifteen contiguous closes re-seed it); `rsi_prev` is the RSI on the
    session before `rsi_date`, null when it is not defined there. The last
    session strictly above 70, and strictly below 30, each with its RSI and
    the S&P's simple return over the next 20 sessions (null until 20 sessions
    with a close on the twentieth have passed)."""
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
        after = f(px[end] / px[j] - 1) if end < len(px) and math.isfinite(px[j]) else None
        return {"date": iso[j], "rsi": float(rsi[j]), "after_20d": after,
                "after_20d_to": iso[end] if after is not None else None}

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
