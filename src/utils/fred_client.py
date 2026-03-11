import time

import pandas as pd
from fredapi import Fred
from src.config import FRED_API_KEY
from src.utils.dates import get_start_date, get_end_date


def get_fred_client() -> Fred:
    """Instantiate and return a fredapi.Fred client."""
    return Fred(api_key=FRED_API_KEY)


def fetch_series(series_id: str, lookback_years: int = 10) -> pd.Series:
    """
    Fetch a single FRED series as a pandas Series with a month-start DatetimeIndex.

    Daily series (e.g. VIXCLS) are collapsed to one value per month by taking
    the last observation in each month. Monthly series are unaffected.
    """
    client = get_fred_client()
    start  = get_start_date(lookback_years)
    end    = get_end_date()

    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            raw = client.get_series(series_id, observation_start=start, observation_end=end)
            break
        except Exception as exc:
            last_exc = exc
            if attempt < 3:
                delay = 2 ** attempt  # 2s, 4s
                print(f"[fetch_data] FRED timeout, retrying in {delay}s... (attempt {attempt}/3)")
                time.sleep(delay)
    else:
        raise last_exc  # type: ignore[misc]

    if raw is None or raw.empty:
        raise ValueError(f"FRED returned empty data for series '{series_id}'")

    raw = raw.dropna().sort_index()
    raw.name = series_id
    raw.index = pd.to_datetime(raw.index)

    # Resample to month-start: for daily series takes last value of month;
    # for already-monthly series this is idempotent.
    raw = raw.groupby(raw.index.to_period("M")).last()
    raw.index = raw.index.to_timestamp()  # Period → Timestamp (month start)

    return raw


def fetch_multiple_series(series_dict: dict, lookback_years: int = 10) -> pd.DataFrame:
    """
    Fetch multiple FRED series and return as a single aligned DataFrame.
    Columns are the friendly names from series_dict keys.
    Only rows where ALL series have data are kept (inner join).
    """
    frames = {}
    for name, series_id in series_dict.items():
        frames[name] = fetch_series(series_id, lookback_years)

    df = pd.DataFrame(frames).dropna().sort_index()
    return df
