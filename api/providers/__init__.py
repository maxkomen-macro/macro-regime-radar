"""api/providers — the market-data provider layer (2026-09-06).

EODHD is the primary source for market prices, candles, search, corporate
actions, exchange metadata and (where entitled) options; yfinance is the
disclosed fallback; FRED stays authoritative for macro series and is not
routed through here. Every public function returns a normalized envelope that
names its provider, stamps fetched_at and the market timestamp, says whether
the data is live or delayed, and records fallback_used / fallback_reason.

Modules:
  symbols       canonical symbol ↔ EODHD / yfinance representations
  errors        the provider error hierarchy (kind, retryable, public message)
  cache         bounded keyed single-flight TTL cache + token bucket
  eodhd         thin httpx client for the EODHD REST families we use
  yf            yfinance wrappers (lazy import, never at module import)
  entitlements  bounded per-family capability probes, cached in-process
  market        orchestration: search / profile / candles / actions / options / ticks
"""
