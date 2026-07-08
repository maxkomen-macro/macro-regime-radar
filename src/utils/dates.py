from datetime import date
import pandas as pd


def get_start_date(lookback_years: int, today: date | None = None) -> str:
    """Return ISO date string (YYYY-MM-DD) for `lookback_years` ago from today.

    `today` is injectable for tests. Feb 29 falls back to Feb 28 when the
    target year is not a leap year — a bare .replace(year=...) raises
    ValueError there, which would crash the daily refresh on leap days.
    """
    if today is None:
        today = date.today()
    try:
        start = today.replace(year=today.year - lookback_years)
    except ValueError:  # Feb 29 → non-leap target year
        start = today.replace(year=today.year - lookback_years, day=28)
    return start.strftime("%Y-%m-%d")


def get_end_date() -> str:
    """Return today's date as ISO string."""
    return date.today().strftime("%Y-%m-%d")
