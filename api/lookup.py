"""api/lookup.py — compatibility seam for the on-demand symbol layer.

Since 2026-09-06 the implementation lives in api/providers/ (EODHD only
since fix/prelaunch-1: an EODHD failure is a typed, disclosed error, never a
Yahoo fallback). This module keeps the names the routes
and tests import — search / profile / candles / UnknownSymbol / LookupError_
— so callers that monkeypatch the seam keep working, and nothing here reaches
the network on import.

Freshness honesty is unchanged: every payload stamps `fetched_at` and names
its provider; nothing pretends REST history is a live feed.
"""

from __future__ import annotations

from api.providers import market as _market
from api.providers.cache import KeyedTTLCache as _KeyedTTLCache  # noqa: F401 — re-export for tests
from api.providers.errors import ProviderError as LookupError_  # noqa: F401 — HTTP mapping via .http_status
from api.providers.errors import UnknownSymbol  # noqa: F401
from api.providers.symbols import SymbolError, canonical

CANDLE_RANGES = {k: (v["yf"][0], v["yf"][1]) for k, v in _market.RANGES.items()}


def _valid_symbol(symbol: str) -> str:
    """Canonical house spelling for a raw symbol, or UnknownSymbol."""
    try:
        return canonical(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc


def search(q: str, limit: int = 10) -> dict:
    """Search envelope: {provider, fallback_used, fallback_reason, fetched_at, hits}."""
    return _market.search(q, limit)


def profile(symbol: str) -> dict:
    """Quote block + fundamentals with provider labels (see api/providers/market.py)."""
    return _market.profile(symbol)


def candles(symbol: str, range_key: str) -> dict:
    """Candle envelope: provenance fields + `bars` (never a bare list)."""
    return _market.candles(symbol, range_key)
