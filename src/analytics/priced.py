"""
src/analytics/priced.py — Compute "What's Priced?" metrics from FRED rate/inflation data.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Run:
    python -m src.analytics.priced

Reads:  raw_series (FEDFUNDS, SOFR, T5YIE, T10YIE, DFII5, DFII10)
Writes: derived_metrics

If a series is not present in raw_series, a warning is logged and it is skipped.
To fetch these series, run: python main.py  (after adding PRICED_SERIES to config.py)

Metric names stored in derived_metrics:
    {SERIES_ID}_latest          latest monthly level (keyed to today's run date)
    {SERIES_ID}_weekly_chg      month-over-month absolute change (TIPS/breakeven series only)
    {SERIES_ID}_mom_chg         alias for monthly change (all series)

Series groups:
    Rate proxies (latest only):     FEDFUNDS, SOFR
    Breakevens + weekly_chg:        T5YIE, T10YIE
    Real yields + weekly_chg:       DFII5, DFII10
"""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

RATE_SERIES       = ["FEDFUNDS", "SOFR"]           # latest level only
BREAKEVEN_TIPS    = ["T5YIE", "T10YIE", "DFII5", "DFII10"]  # latest + monthly change
ALL_PRICED_SERIES = RATE_SERIES + BREAKEVEN_TIPS


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def load_series(conn: sqlite3.Connection, series_id: str) -> pd.Series:
    """Load a FRED series from raw_series as pd.Series indexed by pd.Timestamp."""
    rows = conn.execute(
        "SELECT date, value FROM raw_series WHERE series_id=? ORDER BY date",
        (series_id,),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float, name=series_id)
    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date").sort_index()
    return df["value"]


def upsert_derived_metrics(conn: sqlite3.Connection, rows: list) -> int:
    """Upsert (name, date, value) tuples into derived_metrics."""
    computed_at = datetime.utcnow().isoformat()
    data = [(name, date, value, computed_at) for name, date, value in rows]
    conn.executemany(
        """
        INSERT INTO derived_metrics (name, date, value, computed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name, date) DO UPDATE SET
            value=excluded.value,
            computed_at=excluded.computed_at
        """,
        data,
    )
    conn.commit()
    return len(data)


def build_priced_metrics(conn: sqlite3.Connection) -> list:
    """
    Compute priced metrics for all configured series.
    Returns list of (metric_name, date_str, value) tuples.
    """
    rows = []
    today = datetime.utcnow().strftime("%Y-%m-%d")

    for series_id in ALL_PRICED_SERIES:
        s = load_series(conn, series_id)
        if s.empty:
            logger.warning(
                "[priced] %s: not found in raw_series — skipped. "
                "Run 'python main.py' to fetch this series.",
                series_id,
            )
            continue

        latest_val  = float(s.iloc[-1])
        latest_date = s.index[-1].strftime("%Y-%m-%d")

        # Latest level keyed to today's run date
        rows.append((f"{series_id}_latest", today, latest_val))

        # Month-over-month change (available for all series)
        if len(s) >= 2:
            mom_chg = float(s.iloc[-1] - s.iloc[-2])
            rows.append((f"{series_id}_mom_chg", latest_date, mom_chg))
        else:
            logger.warning("[priced] %s: only 1 data point — cannot compute mom_chg.", series_id)

        # Also store as _weekly_chg for breakeven and TIPS series
        # (since these are daily→monthly resampled, mom_chg ≈ latest weekly change)
        if series_id in BREAKEVEN_TIPS and len(s) >= 2:
            mom_chg = float(s.iloc[-1] - s.iloc[-2])
            rows.append((f"{series_id}_weekly_chg", latest_date, mom_chg))

        logger.info("[priced] %s: latest=%.3f (as of %s)", series_id, latest_val, latest_date)

    return rows


def run() -> None:
    conn = _get_conn()
    try:
        rows = build_priced_metrics(conn)
        if not rows:
            logger.warning(
                "[priced] No priced metrics computed. "
                "Ensure FEDFUNDS, SOFR, T5YIE, T10YIE, DFII5, DFII10 are in raw_series."
            )
            return

        n = upsert_derived_metrics(conn, rows)
        logger.info("[priced] Done. %d derived_metrics rows upserted.", n)

        print(f"\n--- Priced Metrics ({n} rows) ---")
        for name, date, value in rows:
            print(f"  {name:30s}  {date}  {value:+.4f}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
