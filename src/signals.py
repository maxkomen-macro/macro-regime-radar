import pandas as pd
from datetime import datetime, timezone
from src.config import (
    YIELD_CURVE_INVERSION_THRESHOLD,
    UNRATE_SPIKE_THRESHOLD,
    UNRATE_SPIKE_WINDOW,
    CPI_HOT_THRESHOLD,
    CPI_COLD_THRESHOLD,
    VIX_SPIKE_THRESHOLD,
)
from src.utils.db import get_connection


# ── Individual signal detectors ───────────────────────────────────────────

def detect_yield_curve_inversion(series_dict: dict) -> pd.DataFrame:
    """10Y - 2Y spread < 0."""
    aligned   = pd.DataFrame({"y10": series_dict["yield_10y"], "y2": series_dict["yield_2y"]}).dropna()
    spread    = aligned["y10"] - aligned["y2"]
    triggered = (spread < YIELD_CURVE_INVERSION_THRESHOLD).astype(int)
    return pd.DataFrame({
        "date":        aligned.index.strftime("%Y-%m-%d"),
        "signal_name": "yield_curve_inversion",
        "value":       spread.values,
        "triggered":   triggered.values,
    })


def detect_unemployment_spike(series_dict: dict) -> pd.DataFrame:
    """UNRATE rises >= 0.3pp over 3 months."""
    unrate    = series_dict["unemployment"].dropna()
    change_3m = unrate.diff(UNRATE_SPIKE_WINDOW).dropna()
    triggered = (change_3m >= UNRATE_SPIKE_THRESHOLD).astype(int)
    return pd.DataFrame({
        "date":        change_3m.index.strftime("%Y-%m-%d"),
        "signal_name": "unemployment_spike",
        "value":       change_3m.values,
        "triggered":   triggered.values,
    })


def detect_cpi_hot(series_dict: dict) -> pd.DataFrame:
    """CPI YoY > 4%."""
    cpi       = series_dict["inflation"].dropna()
    cpi_yoy   = (cpi.pct_change(periods=12) * 100).dropna()
    triggered = (cpi_yoy > CPI_HOT_THRESHOLD).astype(int)
    return pd.DataFrame({
        "date":        cpi_yoy.index.strftime("%Y-%m-%d"),
        "signal_name": "cpi_hot",
        "value":       cpi_yoy.values,
        "triggered":   triggered.values,
    })


def detect_cpi_cold(series_dict: dict) -> pd.DataFrame:
    """CPI YoY < 1%."""
    cpi       = series_dict["inflation"].dropna()
    cpi_yoy   = (cpi.pct_change(periods=12) * 100).dropna()
    triggered = (cpi_yoy < CPI_COLD_THRESHOLD).astype(int)
    return pd.DataFrame({
        "date":        cpi_yoy.index.strftime("%Y-%m-%d"),
        "signal_name": "cpi_cold",
        "value":       cpi_yoy.values,
        "triggered":   triggered.values,
    })


def detect_vix_spike(series_dict: dict) -> pd.DataFrame:
    """Monthly VIX > 30."""
    vix       = series_dict["vix"].dropna()
    triggered = (vix > VIX_SPIKE_THRESHOLD).astype(int)
    return pd.DataFrame({
        "date":        vix.index.strftime("%Y-%m-%d"),
        "signal_name": "vix_spike",
        "value":       vix.values,
        "triggered":   triggered.values,
    })


# ── Orchestrator ──────────────────────────────────────────────────────────

def run_all_signals(series_dict: dict) -> pd.DataFrame:
    """Run all five detectors and return a combined DataFrame."""
    detectors = [
        detect_yield_curve_inversion,
        detect_unemployment_spike,
        detect_cpi_hot,
        detect_cpi_cold,
        detect_vix_spike,
    ]
    frames = [detector(series_dict) for detector in detectors]
    combined = pd.concat(frames, ignore_index=True)
    return combined.sort_values(["date", "signal_name"]).reset_index(drop=True)


def save_signals(df: pd.DataFrame) -> None:
    """Upsert signal detection results into the signals table."""
    computed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = get_connection()
    try:
        rows = [
            (
                row["date"],
                row["signal_name"],
                float(row["value"]),
                int(row["triggered"]),
                computed_at,
            )
            for _, row in df.iterrows()
        ]
        conn.executemany(
            """
            INSERT INTO signals
                (date, signal_name, value, triggered, computed_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date, signal_name) DO UPDATE SET
                value       = excluded.value,
                triggered   = excluded.triggered,
                computed_at = excluded.computed_at
            """,
            rows,
        )
        conn.commit()
        print(f"[signals] Saved {len(rows)} signal records.")
    finally:
        conn.close()


def print_active_signals(df: pd.DataFrame) -> None:
    """Print triggered signals for the most recent month."""
    latest_date = df["date"].max()
    active = df[(df["date"] == latest_date) & (df["triggered"] == 1)]
    print(f"\n[signals] Active alerts as of {latest_date}:")
    if active.empty:
        print("  (none)")
    else:
        for _, row in active.iterrows():
            print(f"  ALERT: {row['signal_name']} = {row['value']:.2f}")


def run(series_dict: dict) -> pd.DataFrame:
    """Detect signals, save to DB, print summary, and return result DataFrame."""
    df = run_all_signals(series_dict)
    save_signals(df)
    print_active_signals(df)
    return df
