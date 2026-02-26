"""
src/market_data/base.py — Abstract base class for market data providers.

All provider implementations must subclass MarketDataProvider and implement
fetch_daily() and fetch_intraday_5m().
"""
from abc import ABC, abstractmethod

import pandas as pd


class MarketDataProvider(ABC):
    """Interface all market data providers must implement."""

    @abstractmethod
    def fetch_daily(
        self,
        symbol: str,
        from_date: str,   # YYYY-MM-DD
        to_date: str,     # YYYY-MM-DD
    ) -> pd.DataFrame:
        """
        Fetch daily OHLCV bars for symbol between from_date and to_date (inclusive).

        Returns a DataFrame with columns:
            symbol (str), date (str YYYY-MM-DD),
            open (float), high (float), low (float), close (float),
            volume (float), vwap (float or None)
        Sorted ascending by date. Returns empty DataFrame if no data available.
        """

    @abstractmethod
    def fetch_intraday_5m(
        self,
        symbol: str,
        from_date: str,   # YYYY-MM-DD
        to_date: str,     # YYYY-MM-DD
    ) -> pd.DataFrame:
        """
        Fetch 5-minute intraday OHLCV bars for symbol.

        Returns a DataFrame with columns:
            symbol (str), ts (str ISO 8601 UTC e.g. 2026-02-26T14:35:00Z),
            open (float), high (float), low (float), close (float),
            volume (float), vwap (float or None)
        Sorted ascending by ts. Returns empty DataFrame if no data available.
        """
