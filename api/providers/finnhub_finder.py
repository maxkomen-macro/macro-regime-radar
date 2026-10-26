"""api/providers/finnhub_finder.py — the Options Finder's own earnings calendar reads (design F3 §2b).

The Finder asks Finnhub for one symbol's earnings dates when a visitor prices a contract. The dashboard's
fundamentals panel (api/providers/finnhub.py) has a token bucket sized to the free tier's 60 requests a
minute, and a Finder request taking from it could leave a panel without its fundamentals. So the Finder
shares nothing with it:

  - its own key, FINNHUB_FINDER_API_KEY (Finnhub limits each key on its own); without that key, or when it
    is the dashboard's key (which would share the upstream minute), no request is sent and the Finder
    uses its stored earnings rows or says the calendar could not be read;
  - its own client instance and its own bucket; the shared `_bucket` is never taken (every request goes
    through `_get(..., reserved=True)`, after this module's bucket has granted it);
  - its own cache, keyed by symbol and session, over a fixed horizon, so every request for a name on a
    session reads the same interval.

The key rides in the X-Finnhub-Token header (inherited), never in a URL, a log line or an answer.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from api.providers import finnhub as fh
from api.providers.cache import KeyedTTLCache, TokenBucket
from api.providers.errors import MalformedResponse, MissingToken

ENV_KEY = "FINNHUB_FINDER_API_KEY"
HORIZON_DAYS = 400
NOT_CONFIGURED = "Finnhub's earnings calendar is not configured for the Finder on this server."

# The free tier's arithmetic, as finnhub.py's: 10 up front plus 50 a minute is 60 in any minute.
_finder_bucket = TokenBucket(rate=50 / 60, burst=10)
_earnings_cache = KeyedTTLCache(6 * 3600.0, 256)


def _load_token() -> str | None:
    """FINNHUB_FINDER_API_KEY from the environment, else the repo-root .env (finnhub.py's rule). Never logged."""
    tok = os.environ.get(ENV_KEY)
    if tok:
        return tok.strip() or None
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith(f"{ENV_KEY}=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    except OSError:
        pass
    return None


def configured_token() -> str | None:
    """The Finder's key, or None when it is missing or is the dashboard's own key (compared in memory)."""
    tok = _load_token()
    if not tok:
        return None
    if tok == fh._load_token():
        return None
    return tok


class FinderEarningsClient(fh.FinnhubClient):
    def earnings(self, symbol: str, start: date, end: date) -> list[dict]:
        """Finnhub's earningsCalendar items for one symbol from start to end, as served."""
        if not self.token:
            raise MissingToken(fh.PROVIDER, NOT_CONFIGURED)
        if not _finder_bucket.take():
            raise fh.LocalThrottle(fh.PROVIDER, "The Finder's earnings calendar reads are being throttled; retry in a moment.")
        data = self._get("/calendar/earnings", {"symbol": symbol, "from": start.isoformat(), "to": end.isoformat()},
                         what="earnings calendar", reserved=True)
        items = data.get("earningsCalendar") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise MalformedResponse(fh.PROVIDER, "Finnhub's earnings calendar came back in an unexpected shape.")
        return items


_transport: Any = None  # tests set an httpx transport here


def client() -> FinderEarningsClient:
    return FinderEarningsClient(configured_token(), transport=_transport)


def earnings(symbol: str, session: date) -> dict:
    """{start, end, items} for one symbol from the session over the fixed horizon, cached per (symbol,
    session). Raises a ProviderError (MissingToken when not configured, LocalThrottle when this module's
    bucket is empty); errors are not cached."""
    start, end = session, session + timedelta(days=HORIZON_DAYS)
    c = client()
    if not c.token:
        raise MissingToken(fh.PROVIDER, NOT_CONFIGURED)

    def compute() -> dict:
        return {"start": start, "end": end, "items": c.earnings(symbol, start, end)}

    return _earnings_cache.get(f"{symbol}:{session.isoformat()}", compute)


def clear_caches() -> None:
    _earnings_cache.clear()
