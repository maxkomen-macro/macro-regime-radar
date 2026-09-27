"""src/analytics/technicals.py — price technicals, symbol-agnostic (desk/fill-compute).

One copy of each indicator the site computes from a close series: the Desk's
Technicals page reads them for the S&P 500 (api/desk_items.py), the Desk's
RSI studies read `rsi` through the event-study engine, and any other page can
call them on any symbol's closes. Each function takes a pandas Series of
closes on its own index (sessions; NaN where a session has no close) and
returns values on the same index; nothing here knows which instrument it is
given, where the closes came from, or what calendar they sit on.

Imports numpy and pandas only (no src.config, no database), so the API loads
it lazily at the point of use like every other heavy dependency.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

RSI_PERIOD = 14
RSI_UPPER, RSI_LOWER = 70.0, 30.0  # the zones: strictly above 70 overbought, strictly below 30 oversold


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    """One RSI from Wilder's two averages: no losses with gains is 100, no
    gains with losses 0, both zero 50."""
    if avg_loss == 0.0:
        return 50.0 if avg_gain == 0.0 else 100.0
    if avg_gain == 0.0:
        return 0.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def rsi(close: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    """Wilder's RSI(period) (DESK_FRAME3_SPEC §12.7, §12.13's rule, v3 §13).
    The first value is seeded from the plain means of `period` close-to-close
    changes over period + 1 contiguous valid closes; each later session
    smooths them, avg = (avg × (period − 1) + x) / period. A missing close
    (NaN) breaks the run, and the RSI is NaN until `period` new changes
    re-seed it: nothing bridges a gap. NaN wherever it is not defined."""
    px = close.to_numpy(dtype=float)
    out = np.full(len(px), np.nan)
    run, gains, losses = 0, 0.0, 0.0
    avg_gain = avg_loss = 0.0
    for i in range(1, len(px)):
        a, b = px[i - 1], px[i]
        if not (math.isfinite(a) and math.isfinite(b)):
            run, gains, losses = 0, 0.0, 0.0
            continue
        change = b - a
        gain, loss = (change, 0.0) if change > 0 else (0.0, -change)
        run += 1
        if run < period:
            gains, losses = gains + gain, losses + loss
            continue
        if run == period:
            avg_gain, avg_loss = (gains + gain) / period, (losses + loss) / period
        else:
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = _rsi_value(avg_gain, avg_loss)
    return pd.Series(out, index=close.index)


REALIZED_WINDOW = 21     # daily log returns in a realized-volatility window
PERIODS_PER_YEAR = 252   # trading sessions a year, the annualization


def realized_vol(close: pd.Series, window: int = REALIZED_WINDOW, periods_per_year: int = PERIODS_PER_YEAR) -> pd.Series:
    """Annualized realized volatility, in percentage points (VIX's unit):
    100 × √periods_per_year × the sample standard deviation (ddof = 1) of the
    last `window` daily log returns ending on each session. A return needs
    both of its closes, and the value needs all `window` returns: a missing
    close (NaN) makes every window that reads it NaN, never a shorter one."""
    r = np.log(close.astype(float)).diff()
    sd = r.rolling(window, min_periods=window).std(ddof=1)
    return 100.0 * math.sqrt(periods_per_year) * sd


MACD_FAST, MACD_SLOW, MACD_SIGNAL = 12, 26, 9


def ema(values: pd.Series, span: int) -> pd.Series:
    """Exponential moving average, alpha = 2 / (span + 1), seeded at the
    span-th contiguous valid value with the plain mean of those span values
    (the SMA seed). A missing value (NaN) breaks the run and the average is
    NaN until span new values re-seed it: nothing bridges a gap."""
    x = values.to_numpy(dtype=float)
    out = np.full(len(x), np.nan)
    alpha = 2.0 / (span + 1.0)
    run, total, prev = 0, 0.0, 0.0
    for i, v in enumerate(x):
        if not math.isfinite(v):
            run, total = 0, 0.0
            continue
        run += 1
        if run < span:
            total += v
            continue
        prev = (total + v) / span if run == span else alpha * v + (1.0 - alpha) * prev
        out[i] = prev
    return pd.Series(out, index=values.index)


def macd(close: pd.Series, fast: int = MACD_FAST, slow: int = MACD_SLOW, signal: int = MACD_SIGNAL) -> pd.DataFrame:
    """MACD(fast, slow, signal) on a close series: `macd` = EMA(fast) −
    EMA(slow) of the closes, `signal` = EMA(signal) of `macd`, `hist` =
    `macd` − `signal`, each EMA seeded by its SMA (`ema`). A missing close
    breaks every average that reads it, so the three are NaN until the runs
    re-seed (slow closes for `macd`, signal more for `signal`)."""
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig}, index=close.index)


def macd_crossings(hist: pd.Series) -> list[tuple[int, str]]:
    """Strict crossings of the MACD line over its signal line, as (position,
    "above" | "below"): a session whose histogram is strictly positive
    (negative) after the side carried was the other one. A zero histogram
    keeps the carried side; an undefined session resets it, so a crossing
    never bridges one (the rule of the 50/200-day crosses)."""
    out: list[tuple[int, str]] = []
    side: int | None = None
    for i, h in enumerate(hist.to_numpy(dtype=float)):
        if not math.isfinite(h):
            side = None
            continue
        s = 1 if h > 0 else (-1 if h < 0 else 0)
        if s == 0:
            continue
        if side is not None and s != side:
            out.append((i, "above" if s > 0 else "below"))
        side = s
    return out

