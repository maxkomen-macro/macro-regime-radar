"""
src/analytics/volatility.py — GARCH(1,1) conditional volatility for SPY.

Fits a GARCH(1,1) model on SPY daily simple returns (in percent, which is
the scale convention the `arch` library expects), then returns annualized
conditional vol, a 5-day forward forecast, regime label, realized vol
comparison, and a 60-day conditional-vol series for sparkline rendering.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Public:
    compute_garch_signal() -> dict

Reads: market_daily (SPY closes)
"""

from __future__ import annotations

import logging
import math
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

MIN_OBS          = 252
TRADING_DAYS     = 252
LOW_VOL_THRESH   = 15.0
HIGH_VOL_THRESH  = 25.0


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _load_spy_returns(conn: sqlite3.Connection) -> pd.Series:
    rows = conn.execute(
        "SELECT date, close FROM market_daily WHERE symbol='SPY' ORDER BY date"
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["date", "close"]).copy()
    df.loc[:, "date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    # Percent returns — arch's default scale; avoids "data scale" warnings
    returns = df["close"].pct_change().dropna() * 100.0
    return returns


def _regime_label(annualized_pct: float) -> str:
    if annualized_pct < LOW_VOL_THRESH:
        return "LOW"
    if annualized_pct > HIGH_VOL_THRESH:
        return "HIGH"
    return "ELEVATED"


def compute_garch_signal() -> dict:
    """
    Fit GARCH(1,1) on SPY daily returns and return the signal payload.

    Returns keys on success:
        status                        "ok"
        conditional_vol_annual_pct    float
        forecast_5d_annual_pct        float
        realized_vol_30d_pct          float
        regime                        "LOW" | "ELEVATED" | "HIGH"
        direction                     "rising" | "falling"
        spark_60d                     list[float]  (annualized %, most-recent last)
        n_obs                         int
        as_of                         str YYYY-MM-DD
        model_note                    str

    On insufficient data: {"status": "insufficient_data", "reason": ...}.
    On model error:       {"status": "error", "reason": ...}.
    """
    try:
        conn = _get_conn()
        try:
            returns = _load_spy_returns(conn)
        finally:
            conn.close()
    except Exception as exc:
        return {"status": "error", "reason": f"db read failed: {exc}"}

    if len(returns) < MIN_OBS:
        return {
            "status": "insufficient_data",
            "reason": f"{len(returns)} SPY daily returns — need at least {MIN_OBS}",
        }

    try:
        from arch import arch_model  # imported lazily to keep module import cheap
    except Exception as exc:
        return {"status": "error", "reason": f"arch import failed: {exc}"}

    try:
        am  = arch_model(returns, mean="Zero", vol="Garch", p=1, q=1, dist="normal")
        fit = am.fit(disp="off", show_warning=False)
    except Exception as exc:
        return {"status": "error", "reason": f"GARCH fit failed: {exc}"}

    # Conditional volatility series (daily %)
    cond_vol_daily_pct = fit.conditional_volatility
    annual_scale       = math.sqrt(TRADING_DAYS)

    current_cv_pct = float(cond_vol_daily_pct.iloc[-1]) * annual_scale

    try:
        forecast     = fit.forecast(horizon=5, reindex=False)
        fwd_var_5    = float(forecast.variance.iloc[-1].mean())
        forecast_pct = math.sqrt(fwd_var_5) * annual_scale
    except Exception as exc:
        logger.warning("[volatility] forecast failed: %s", exc)
        forecast_pct = current_cv_pct

    # 30-day trailing realized vol (annualized %)
    last_30 = returns.tail(30)
    realized_30_pct = float(last_30.std(ddof=1)) * annual_scale if len(last_30) >= 2 else float("nan")

    # 60-day sparkline of conditional vol
    spark_daily = cond_vol_daily_pct.tail(60).to_numpy()
    spark_60d = [float(v * annual_scale) for v in spark_daily]

    regime    = _regime_label(current_cv_pct)
    direction = "rising" if forecast_pct > current_cv_pct else "falling"
    as_of     = returns.index[-1].strftime("%Y-%m-%d")

    return {
        "status": "ok",
        "conditional_vol_annual_pct": round(current_cv_pct, 2),
        "forecast_5d_annual_pct":     round(forecast_pct, 2),
        "realized_vol_30d_pct":       round(realized_30_pct, 2) if not np.isnan(realized_30_pct) else None,
        "regime":    regime,
        "direction": direction,
        "spark_60d": spark_60d,
        "n_obs":     int(len(returns)),
        "as_of":     as_of,
        "model_note": "GARCH(1,1) · SPY daily returns",
    }


if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = compute_garch_signal()
    # Truncate the sparkline in CLI output for readability
    if "spark_60d" in out:
        out = {**out, "spark_60d": f"<{len(out['spark_60d'])} points>"}
    print(json.dumps(out, indent=2))
