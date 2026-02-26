"""
src/market_data/polygon.py — Polygon.io REST API client.

Does NOT import src.config — reads POLYGON_API_KEY directly from os.getenv()
so this module can be imported without triggering the FRED_API_KEY EnvironmentError.

Rate limiting:
  - Free tier: ~5 req/min → sleep 12s between requests (conservative)
  - 429: exponential backoff from providers.yml config
  - 5xx: fixed backoff, up to max_retries
  - Other errors: log warning and return empty DataFrame

Pagination: follows Polygon's next_url field until exhausted.
"""
import logging
import os
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
import yaml

from src.market_data.base import MarketDataProvider

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent.parent
_PROVIDERS_CFG_PATH = ROOT / "config" / "providers.yml"


def _load_polygon_config() -> dict:
    with open(_PROVIDERS_CFG_PATH) as f:
        return yaml.safe_load(f)["polygon"]


_CFG = _load_polygon_config()


class PolygonClient(MarketDataProvider):
    """
    Polygon.io v2 aggregate bars client.

    Handles rate limiting, pagination, and retry logic automatically.
    All timestamps are converted to UTC strings.
    """

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("POLYGON_API_KEY")
        if not self.api_key:
            raise ValueError(
                "POLYGON_API_KEY not set. Pass api_key= or set the environment variable."
            )
        self.base_url    = _CFG["base_url"]
        self.sleep_secs  = _CFG["rate_limit"]["sleep_between_requests"]
        self.retry_429   = _CFG["rate_limit"]["retry_429_backoffs"]
        self.retry_5xx   = _CFG["rate_limit"]["retry_5xx_backoffs"]
        self.max_retries = _CFG["rate_limit"]["max_retries"]
        self.default_params = _CFG["default_params"]

    # ── HTTP layer ────────────────────────────────────────────────────────────

    def _get(self, url: str, params: dict | None = None) -> dict | None:
        """
        GET request with retry logic.
        Returns parsed JSON dict or None on unrecoverable error.
        """
        attempt_429 = 0
        attempt_5xx = 0
        effective_params = params or {}

        while True:
            try:
                resp = requests.get(url, params=effective_params, timeout=30)
            except requests.RequestException as exc:
                logger.warning("[polygon] Request exception: %s — skipping.", exc)
                return None

            if resp.status_code == 200:
                return resp.json()

            if resp.status_code == 429:
                if attempt_429 >= len(self.retry_429):
                    logger.warning("[polygon] 429 max retries exceeded for %s", url)
                    return None
                wait = self.retry_429[attempt_429]
                logger.info("[polygon] 429 rate limit — sleeping %ds (attempt %d)", wait, attempt_429 + 1)
                time.sleep(wait)
                attempt_429 += 1
                continue

            if resp.status_code >= 500:
                if attempt_5xx >= len(self.retry_5xx):
                    logger.warning("[polygon] 5xx max retries exceeded for %s", url)
                    return None
                wait = self.retry_5xx[attempt_5xx]
                logger.info("[polygon] %d error — sleeping %ds (attempt %d)", resp.status_code, wait, attempt_5xx + 1)
                time.sleep(wait)
                attempt_5xx += 1
                continue

            logger.warning("[polygon] HTTP %d for %s — skipping.", resp.status_code, url)
            return None

    # ── Core aggregates fetcher ───────────────────────────────────────────────

    def _fetch_aggs(
        self,
        ticker: str,
        multiplier: int,
        timespan: str,      # "day" | "minute"
        from_date: str,     # YYYY-MM-DD
        to_date: str,       # YYYY-MM-DD
    ) -> list[dict]:
        """
        Fetch all aggregate bars, following next_url pagination.
        Returns list of raw bar dicts: {v, vw, o, c, h, l, t}.
        t is milliseconds UTC epoch.
        """
        url = (
            f"{self.base_url}/v2/aggs/ticker/{ticker}"
            f"/range/{multiplier}/{timespan}/{from_date}/{to_date}"
        )
        params = {**self.default_params, "apiKey": self.api_key}
        all_results: list[dict] = []
        is_first = True

        while url:
            time.sleep(self.sleep_secs)
            if is_first:
                data = self._get(url, params)
                is_first = False
            else:
                # next_url already contains all params including apiKey
                data = self._get(url)

            if data is None:
                break

            results = data.get("results") or []
            all_results.extend(results)

            next_url = data.get("next_url")
            if next_url:
                # Append apiKey to next_url (Polygon strips it in next_url)
                url = next_url + f"&apiKey={self.api_key}"
            else:
                url = None

        return all_results

    # ── Timestamp helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _ts_ms_to_iso(t_ms: int) -> str:
        """Millisecond UTC timestamp → ISO 8601 string (2026-02-26T14:35:00Z)."""
        return datetime.utcfromtimestamp(t_ms / 1000).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _ts_ms_to_date(t_ms: int) -> str:
        """Millisecond UTC timestamp → YYYY-MM-DD date string."""
        return datetime.utcfromtimestamp(t_ms / 1000).strftime("%Y-%m-%d")

    # ── Public interface ──────────────────────────────────────────────────────

    def fetch_daily(self, symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
        """
        Fetch daily OHLCV bars for symbol.
        Returns DataFrame (columns: symbol, date, open, high, low, close, volume, vwap)
        or empty DataFrame if no data.
        """
        logger.info("[polygon] Fetching daily %s  %s → %s", symbol, from_date, to_date)
        raw = self._fetch_aggs(symbol, 1, "day", from_date, to_date)
        if not raw:
            logger.warning("[polygon] No daily data returned for %s", symbol)
            return pd.DataFrame()

        rows = [
            {
                "symbol": symbol,
                "date":   self._ts_ms_to_date(bar["t"]),
                "open":   bar["o"],
                "high":   bar["h"],
                "low":    bar["l"],
                "close":  bar["c"],
                "volume": bar["v"],
                "vwap":   bar.get("vw"),   # None if not present
            }
            for bar in raw
        ]
        df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
        logger.info("[polygon] %s: %d daily bars fetched.", symbol, len(df))
        return df

    def fetch_intraday_5m(self, symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
        """
        Fetch 5-minute intraday bars for symbol.
        Returns DataFrame (columns: symbol, ts, open, high, low, close, volume, vwap)
        or empty DataFrame if no data.
        """
        logger.info("[polygon] Fetching 5m intraday %s  %s → %s", symbol, from_date, to_date)
        raw = self._fetch_aggs(symbol, 5, "minute", from_date, to_date)
        if not raw:
            logger.warning("[polygon] No intraday data returned for %s", symbol)
            return pd.DataFrame()

        rows = [
            {
                "symbol": symbol,
                "ts":     self._ts_ms_to_iso(bar["t"]),
                "open":   bar["o"],
                "high":   bar["h"],
                "low":    bar["l"],
                "close":  bar["c"],
                "volume": bar["v"],
                "vwap":   bar.get("vw"),
            }
            for bar in raw
        ]
        df = pd.DataFrame(rows).sort_values("ts").reset_index(drop=True)
        logger.info("[polygon] %s: %d 5m bars fetched.", symbol, len(df))
        return df
