import collections
import pandas as pd
from datetime import datetime, timezone
from src.config import SERIES, LOOKBACK_YEARS
from src.utils.fred_client import fetch_series
from src.utils.db import get_connection


def fetch_all_series() -> dict:
    """
    Fetch all configured FRED series, upsert into raw_series table,
    and return them as a dict mapping friendly name → pd.Series.
    """
    conn = get_connection()
    result = {}

    try:
        for name, series_id in SERIES.items():
            print(f"[fetch_data] Fetching {series_id} ({name})...")
            s = fetch_series(series_id, LOOKBACK_YEARS)

            fetched_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            rows = [
                (series_id, idx.strftime("%Y-%m-%d"), float(val), fetched_at)
                for idx, val in s.items()
            ]
            conn.executemany(
                """
                INSERT INTO raw_series (series_id, date, value, fetched_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(series_id, date) DO UPDATE SET
                    value      = excluded.value,
                    fetched_at = excluded.fetched_at
                """,
                rows,
            )
            conn.commit()
            result[name] = s
            print(f"[fetch_data]   -> {len(s)} observations saved.")

    finally:
        conn.close()

    return result


def load_series_from_db() -> dict:
    """
    Reconstruct the series dict from the raw_series table.
    Allows re-running regime/signal logic without hitting the FRED API.
    """
    id_to_name = {v: k for k, v in SERIES.items()}
    conn = get_connection()

    try:
        rows = conn.execute(
            "SELECT series_id, date, value FROM raw_series ORDER BY date"
        ).fetchall()
    finally:
        conn.close()

    grouped = collections.defaultdict(list)
    for row in rows:
        grouped[row["series_id"]].append((row["date"], row["value"]))

    result = {}
    for series_id, observations in grouped.items():
        name   = id_to_name.get(series_id, series_id)
        dates  = pd.to_datetime([o[0] for o in observations])
        values = [o[1] for o in observations]
        result[name] = pd.Series(values, index=dates, name=series_id)

    return result
