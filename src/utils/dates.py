from datetime import date
import pandas as pd


def get_start_date(lookback_years: int) -> str:
    """Return ISO date string (YYYY-MM-DD) for `lookback_years` ago from today."""
    today = date.today()
    start = today.replace(year=today.year - lookback_years)
    return start.strftime("%Y-%m-%d")


def get_end_date() -> str:
    """Return today's date as ISO string."""
    return date.today().strftime("%Y-%m-%d")
