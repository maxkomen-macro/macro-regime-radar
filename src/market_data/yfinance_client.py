"""
src/market_data/yfinance_client.py — Daily and intraday bars via Yahoo Finance.

The active market-data source for both daily OHLCV and 5-minute intraday bars.
Keyless — does NOT require an API key. polygon.py is dormant legacy.

Usage:
    from src.market_data.yfinance_client import YFinanceClient
    client = YFinanceClient()
    daily = client.fetch_daily("SPY", "2026-03-20", "2026-03-21")
    intraday = client.fetch_intraday_5m("SPY", "2026-03-20", "2026-03-20")
"""

import logging
from datetime import date, timedelta

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_EMPTY_INTRADAY_COLUMNS = ["symbol", "ts", "open", "high", "low", "close", "volume", "vwap"]
_EMPTY_DAILY_COLUMNS = ["symbol", "date", "open", "high", "low", "close", "volume", "vwap"]


class YFinanceClient:
    """
    Fetches daily and 5-minute intraday bars from Yahoo Finance.

    yfinance is keyless — no API key required.
    vwap is not available from yfinance and is always returned as None.
    """

    def fetch_daily(
        self,
        symbol: str,
        from_date: str,  # YYYY-MM-DD (inclusive)
        to_date: str,    # YYYY-MM-DD (inclusive)
    ) -> pd.DataFrame:
        """
        Fetch daily OHLCV bars for `symbol` between from_date and to_date inclusive.

        Returns a DataFrame with the same column shape as PolygonClient.fetch_daily:
            symbol (str), date (str "YYYY-MM-DD"),
            open, high, low, close (float), volume (float), vwap (None)

        Returns an empty DataFrame with correct columns if no data is available.
        Never raises exceptions — errors are logged as warnings.
        """
        # yfinance's `end` is exclusive; add a day so to_date (and today) is included.
        try:
            end_exclusive = (date.fromisoformat(to_date) + timedelta(days=1)).isoformat()
        except ValueError as exc:
            logger.warning("[yfinance_client] %s: bad to_date %r: %s", symbol, to_date, exc)
            return pd.DataFrame(columns=_EMPTY_DAILY_COLUMNS)

        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=from_date, end=end_exclusive, auto_adjust=True)
        except Exception as exc:
            logger.warning("[yfinance_client] %s: history() failed: %s", symbol, exc)
            return pd.DataFrame(columns=_EMPTY_DAILY_COLUMNS)

        if df is None or df.empty:
            logger.debug("[yfinance_client] %s: no daily bars returned.", symbol)
            return pd.DataFrame(columns=_EMPTY_DAILY_COLUMNS)

        try:
            df = df.reset_index()
            dates = (
                pd.to_datetime(df["Date"]).dt.tz_localize(None).dt.normalize()
                .dt.strftime("%Y-%m-%d")
            )
            result = pd.DataFrame({
                "symbol": symbol,
                "date":   dates,
                "open":   df["Open"].astype(float),
                "high":   df["High"].astype(float),
                "low":    df["Low"].astype(float),
                "close":  df["Close"].astype(float),
                "volume": df["Volume"].astype(float),
                "vwap":   None,
            })
            result = (
                result.dropna(subset=["date", "close"])
                .sort_values("date")
                .reset_index(drop=True)
            )
            logger.info("[yfinance_client] %s: %d daily bars fetched.", symbol, len(result))
            return result
        except Exception as exc:
            logger.warning(
                "[yfinance_client] %s: daily DataFrame processing failed: %s", symbol, exc
            )
            return pd.DataFrame(columns=_EMPTY_DAILY_COLUMNS)

    def fetch_intraday_5m(
        self,
        symbol: str,
        start_date: str,  # YYYY-MM-DD (used for logging only; yfinance uses period='1d')
        end_date: str,    # YYYY-MM-DD (used for logging only)
    ) -> pd.DataFrame:
        """
        Fetch today's 5-minute bars for `symbol`.

        Returns a DataFrame with columns:
            symbol (str), ts (str "YYYY-MM-DD HH:MM:SS" in ET),
            open, high, low, close (float), volume (float), vwap (None)

        Returns an empty DataFrame with correct columns if no data is available.
        Never raises exceptions — errors are logged as warnings.
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period="1d", interval="5m")
        except Exception as exc:
            logger.warning(
                "[yfinance_client] %s: history() failed: %s", symbol, exc
            )
            return pd.DataFrame(columns=_EMPTY_INTRADAY_COLUMNS)

        if df is None or df.empty:
            logger.debug("[yfinance_client] %s: no intraday bars returned.", symbol)
            return pd.DataFrame(columns=_EMPTY_INTRADAY_COLUMNS)

        try:
            df = df.reset_index()

            # Normalize timestamp column — yfinance may name it "Datetime" or "Date"
            ts_col = "Datetime" if "Datetime" in df.columns else "Date"
            ts_series = pd.to_datetime(df[ts_col])

            # Convert to US/Eastern timezone, then drop tz info for storage
            if ts_series.dt.tz is None:
                ts_series = ts_series.dt.tz_localize("UTC").dt.tz_convert("US/Eastern")
            else:
                ts_series = ts_series.dt.tz_convert("US/Eastern")

            ts_strings = ts_series.dt.tz_localize(None).dt.strftime("%Y-%m-%d %H:%M:%S")

            result = pd.DataFrame({
                "symbol": symbol,
                "ts":     ts_strings,
                "open":   df["Open"].astype(float),
                "high":   df["High"].astype(float),
                "low":    df["Low"].astype(float),
                "close":  df["Close"].astype(float),
                "volume": df["Volume"].astype(float),
                "vwap":   None,
            })

            result = result.dropna(subset=["ts", "close"]).reset_index(drop=True)
            logger.debug(
                "[yfinance_client] %s: %d 5m bars fetched.", symbol, len(result)
            )
            return result

        except Exception as exc:
            logger.warning(
                "[yfinance_client] %s: DataFrame processing failed: %s", symbol, exc
            )
            return pd.DataFrame(columns=_EMPTY_INTRADAY_COLUMNS)
