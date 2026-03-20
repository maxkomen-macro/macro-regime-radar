"""
src/market_data/yfinance_client.py — Intraday 5-minute bars via Yahoo Finance.

Replaces Polygon for intraday-only use case. Does NOT require an API key.
Daily OHLCV bars continue to be fetched from Polygon via polygon.py.

Usage:
    from src.market_data.yfinance_client import YFinanceClient
    client = YFinanceClient()
    df = client.fetch_intraday_5m("SPY", "2026-03-20", "2026-03-20")
"""

import logging

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_EMPTY_COLUMNS = ["symbol", "ts", "open", "high", "low", "close", "volume", "vwap"]


class YFinanceClient:
    """
    Fetches 5-minute intraday bars from Yahoo Finance.

    yfinance is keyless — no API key required.
    vwap is not available from yfinance and is always returned as None.
    """

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
            return pd.DataFrame(columns=_EMPTY_COLUMNS)

        if df is None or df.empty:
            logger.debug("[yfinance_client] %s: no intraday bars returned.", symbol)
            return pd.DataFrame(columns=_EMPTY_COLUMNS)

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
            return pd.DataFrame(columns=_EMPTY_COLUMNS)
