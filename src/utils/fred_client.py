import time

import pandas as pd
from src.utils.dates import get_start_date, get_end_date


def get_fred_client():
    """Instantiate and return a fredapi.Fred client (imported lazily, so the
    pure transforms below import without fredapi or a FRED_API_KEY)."""
    from fredapi import Fred
    from src.config import FRED_API_KEY

    return Fred(api_key=FRED_API_KEY)


def fetch_series(series_id: str, lookback_years: int = 10) -> pd.Series:
    """
    Fetch a single FRED series as a pandas Series with a month-start DatetimeIndex.

    Daily series (e.g. VIXCLS) are collapsed to one value per month by taking
    the last observation in each month. Monthly series are unaffected.
    """
    return _to_monthly(_download(series_id, lookback_years))


def fetch_series_observed(series_id: str, lookback_years: int = 10) -> tuple[pd.Series, str | None, float | None]:
    """
    B6 (2026-09-18): the monthly series exactly as fetch_series returns it, plus
    the true date and value of the newest observation.

    The monthly rows are dated the 1st and hold the newest in-month value, so
    their date says nothing about how fresh a daily series is; counting lag
    from it read current values as nine business days behind by mid-month.
    The caller records the true date in source_watermarks.
    """
    raw = _download(series_id, lookback_years)
    last_obs = raw.index[-1].strftime("%Y-%m-%d") if len(raw) else None
    last_value = float(raw.iloc[-1]) if len(raw) else None
    return _to_monthly(raw), last_obs, last_value


def _download(series_id: str, lookback_years: int) -> pd.Series:
    """Raw observations from FRED, blanks dropped, sorted by date."""
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
    return raw


def _to_monthly(raw: pd.Series) -> pd.Series:
    """Resample to month-start: for daily series takes last value of month;
    for already-monthly series this is idempotent. Unchanged since Phase 2 —
    the stored raw_series history depends on it (tests/test_fred_watermark.py)."""
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
