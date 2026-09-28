"""src/desk/technicals.py — the one level-technicals function the Desk reads (desk/books).

Technicals (/api/desk/technicals, the S&P 500) and Basket & Hedge (the basket
index) both read `level_technicals`: the 50- and 200-day averages, the trend
state, the latest cross, the day's change, the one-year return and the chart
series, over a level series aligned to the XNYS session calendar exactly as
the event-study engine aligns (DESK_FRAME3_SPEC §12.7). Moved here from
api/desk_items.py so the two pages cannot drift apart.

The indicators come from the one symbol-agnostic module,
src/analytics/technicals (desk/fill-compute): /technicals adds its RSI, MACD
and seasonality from there (api/desk_items.technicals_from_level), over the
aligned series this function returns as `_aligned`; with `extras=True` the
basket card reads:
- RSI(14), `src.analytics.technicals.rsi` (Wilder, §12.13's rule);
- the drawdown from the running peak, `close / max(closes so far) − 1`, with
  the peak's date and the deepest drawdown on record;
- 21-day realized volatility, `src.analytics.technicals.realized_vol` (the
  sample standard deviation of the last 21 daily log returns, none missing,
  × √252), as a fraction;
- every golden and death cross in the history (`crosses`), for the chart.
"""

from __future__ import annotations

import math
from types import SimpleNamespace
from typing import Any, Mapping

CHART_MONTHS = {"6m": 6, "1y": 12, "3y": 36}
# A price series for the engine's value check: non-finite and non-positive closes are exclusions.
PRICE_SPEC = SimpleNamespace(unit="log_return")


def trend_states(price, ma50, ma200) -> list[str]:
    """Plan N2, per session, strict both ways: unavailable when either average
    is null; above_both above both; below_both below both; mixed otherwise (a
    price equal to either average is mixed)."""
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


def drawdowns(px):
    """`close / running peak − 1` per session (NaN where there is no close) and
    the running peak's position per session (−1 before the first close)."""
    import numpy as np

    dd = np.full(len(px), np.nan)
    at = np.full(len(px), -1, dtype=int)
    peak, where = -math.inf, -1
    for t, v in enumerate(px):
        if math.isfinite(v):
            if v > peak:
                peak, where = float(v), t
            dd[t] = v / peak - 1.0
        at[t] = where
    return dd, at


def level_technicals(raw: Any, *, spec: Any = None, ranges: Mapping[str, int] = CHART_MONTHS, extras: bool = False) -> dict:
    """N2 and N3 over a level series (the engine's load_level output for the
    S&P 500; the basket's index for Basket & Hedge).

    One extended XNYS calendar runs through the newest close and opens on
    1 January of the year four years before the first close; before that
    close it holds at least the larger of 252 sessions (ret_1y) and the longest
    chart range plus 200 sessions (every chart point's average slots), asserted.
    A session before the first close is a slot with no close, never a missing
    slot or a wrapped index. Averages are the engine's rolling means with
    min_periods equal to the window, so one missing close in the slots makes
    the average null. `_sessions` (the calendar) and `_aligned` (the closes on
    it, for the shared indicators) are not served."""
    import numpy as np
    import pandas as pd

    from src.analytics import technicals as ind
    from src.desk import event_study as es

    if spec is None:
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
    longest = max(ranges.values())
    n_long = int(((sessions > date_ - pd.DateOffset(months=longest)) & (sessions <= date_)).sum())
    before = int((sessions < first).sum())
    if before < max(252, n_long + 200):
        raise ValueError(f"the extended calendar holds {before} sessions before the first close, fewer than {max(252, n_long + 200)}")
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
    all_crosses = []
    for kind in ("golden", "death"):
        pos = es.cross_positions(al, kind)[0]
        if len(pos):
            crosses.append((int(pos[-1]), kind))
        all_crosses += [(int(p), kind) for p in pos]
    cross = None
    if crosses:
        p, kind = max(crosses)
        cross = {"kind": kind, "date": iso[p]}
    if extras:
        rsi = ind.rsi(al).to_numpy(dtype=float)
        dd, peak_at = drawdowns(px)
    series = {}
    for name, months in ranges.items():
        lo = date_ - pd.DateOffset(months=months)
        pts = []
        for k in range(len(sessions)):
            if lo < sessions[k] <= date_:
                pt = {"date": iso[k], "close": f(px[k]), "ma50": f(ma50[k]), "ma200": f(ma200[k])}
                if extras:
                    pt["rsi"] = f(rsi[k])
                    pt["drawdown"] = f(dd[k])
                pts.append(pt)
        series[name] = pts
    price = float(px[i])
    m50, m200 = f(ma50[i]), f(ma200[i])
    out = {
        "price": price, "date": iso[i],
        "chg_1d": ret(i - 1), "chg_1d_dates": {"from": iso[i - 1], "to": iso[i]},
        "ret_1y": ret(i - 252), "ret_1y_dates": {"from": iso[i - 252], "to": iso[i]},
        "ma50": m50, "ma200": m200, "ma50_window": window(50), "ma200_window": window(200),
        "vs_ma50": None if m50 is None else price / m50 - 1, "vs_ma200": None if m200 is None else price / m200 - 1,
        "above_50": None if m50 is None else price > m50, "above_200": None if m200 is None else price > m200,
        "trend": {"state": states[i], "state_since": iso[j]},
        "cross": cross,
        "series": series,
        "_sessions": iso,
        "_aligned": al,
    }
    if extras:
        # The deepest drawdown on record and the peak it fell from.
        k_min = int(np.nanargmin(np.where(np.isfinite(dd), dd, np.inf)))
        out["rsi"] = f(rsi[i])
        out["rsi_date"] = iso[i] if math.isfinite(rsi[i]) else None
        out["drawdown"] = {
            "now": f(dd[i]),
            "peak_date": iso[int(peak_at[i])],
            "peak": float(px[int(peak_at[i])]),
            "max": f(dd[k_min]),
            "max_date": iso[k_min],
            "max_peak_date": iso[int(peak_at[k_min])],
            "since": iso[int(closes[0])],
        }
        w = ind.REALIZED_WINDOW
        rv = f(float(ind.realized_vol(al).iloc[i]) / 100.0)  # the shared function answers in points
        out["realized_vol_21d"] = rv
        out["realized_vol_window"] = {"start": iso[i - w], "end": iso[i], "n": w} if i - w >= 0 else None
        out["crosses"] = [{"kind": kind, "date": iso[p]} for p, kind in sorted(all_crosses)]
    return out
