import pandas as pd
import numpy as np
from datetime import datetime, timezone
from src.config import ROLLING_WINDOW
from src.utils.db import get_connection

# ── Regime classification table ───────────────────────────────────────────
REGIMES = {
    (True,  False): "Goldilocks",     # growth up, inflation down
    (True,  True):  "Overheating",    # growth up, inflation up
    (False, True):  "Stagflation",    # growth down, inflation up
    (False, False): "Recession Risk", # growth down, inflation down
}


def compute_trends(series: pd.Series, window: int = ROLLING_WINDOW) -> pd.Series:
    """
    Compute a rolling OLS slope over `window` months.
    Positive slope = series trending up over the window.
    """
    def _slope(y: np.ndarray) -> float:
        x = np.arange(len(y), dtype=float)
        x_mean = x.mean()
        y_mean = y.mean()
        numerator   = ((x - x_mean) * (y - y_mean)).sum()
        denominator = ((x - x_mean) ** 2).sum()
        return numerator / denominator if denominator != 0 else 0.0

    return series.rolling(window=window, min_periods=window).apply(_slope, raw=True)


def compute_zscores(series: pd.Series) -> pd.Series:
    """
    Expanding-window z-scores: how extreme is the current value vs. its own history.
    """
    expanding_mean = series.expanding().mean()
    expanding_std  = series.expanding().std()
    return (series - expanding_mean) / expanding_std.replace(0, np.nan)


def classify_regime(growth_trend: float, inflation_trend: float) -> str:
    """Map (growth_direction, inflation_direction) to a regime label."""
    return REGIMES[(growth_trend > 0, inflation_trend > 0)]


def compute_confidence(growth_zscore: float, inflation_zscore: float) -> float:
    """
    Derive a 0.0–0.95 confidence score from z-score magnitudes.
    Formula: combined = mean(|z_growth|, |z_inflation|)
             confidence = min(0.95, combined / (combined + 1))
    """
    if np.isnan(growth_zscore) or np.isnan(inflation_zscore):
        return 0.5
    combined = (abs(growth_zscore) + abs(inflation_zscore)) / 2
    return round(min(0.95, combined / (combined + 1)), 4)


def run_regime_classification(series_dict: dict) -> pd.DataFrame:
    """
    Classify each month into a macro regime.

    Parameters
    ----------
    series_dict : dict[str, pd.Series] — must contain 'growth' and 'inflation'

    Returns
    -------
    pd.DataFrame with columns: date, label, confidence, growth_trend, inflation_trend
    """
    growth    = series_dict["growth"]
    inflation = series_dict["inflation"]

    base = pd.DataFrame({"growth": growth, "inflation": inflation}).dropna()

    growth_trend    = compute_trends(base["growth"])
    inflation_trend = compute_trends(base["inflation"])
    growth_z        = compute_zscores(growth_trend)
    inflation_z     = compute_zscores(inflation_trend)

    df = base.assign(
        growth_trend=growth_trend,
        inflation_trend=inflation_trend,
        growth_z=growth_z,
        inflation_z=inflation_z,
    ).dropna(subset=["growth_trend", "inflation_trend"])

    labels      = df.apply(lambda r: classify_regime(r["growth_trend"], r["inflation_trend"]), axis=1)
    confidences = df.apply(lambda r: compute_confidence(r["growth_z"], r["inflation_z"]), axis=1)

    return pd.DataFrame({
        "date":            df.index.strftime("%Y-%m-%d"),
        "label":           labels.values,
        "confidence":      confidences.values,
        "growth_trend":    df["growth_trend"].values,
        "inflation_trend": df["inflation_trend"].values,
    })


def save_regimes(df: pd.DataFrame) -> None:
    """Upsert regime classifications into the regimes table."""
    computed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = get_connection()
    try:
        rows = [
            (
                row["date"],
                row["label"],
                row["confidence"],
                row["growth_trend"],
                row["inflation_trend"],
                computed_at,
            )
            for _, row in df.iterrows()
        ]
        conn.executemany(
            """
            INSERT INTO regimes
                (date, label, confidence, growth_trend, inflation_trend, computed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                label           = excluded.label,
                confidence      = excluded.confidence,
                growth_trend    = excluded.growth_trend,
                inflation_trend = excluded.inflation_trend,
                computed_at     = excluded.computed_at
            """,
            rows,
        )
        conn.commit()
        print(f"[regime] Saved {len(rows)} regime records.")
    finally:
        conn.close()


def run(series_dict: dict) -> pd.DataFrame:
    """Classify regimes, save to DB, and return the result DataFrame."""
    df = run_regime_classification(series_dict)
    save_regimes(df)
    return df
