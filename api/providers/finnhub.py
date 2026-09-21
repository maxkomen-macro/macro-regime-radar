"""api/providers/finnhub.py — company fundamentals for the single-name panel.

EODHD's plan here does not include fundamentals (the entitlement probe answers
403), so since fix/prelaunch-1 the panel's Market cap, P/E, Beta, Div yield,
52-week range, Avg volume and Net margin tiles were empty for every symbol.
Finnhub's free tier publishes all of them for US listings through two
endpoints, and the owner confirmed its licensing for public display
(launch-1).

Rules, the same ones the EODHD client follows:
  - the key rides in the `X-Finnhub-Token` header, never in a URL, so it
    cannot reach a log line, an error or a referrer;
  - bounded timeout, no retries on 401/403/404/429;
  - a global token bucket under the free tier's 60 requests a minute;
  - failures are typed (api/providers/errors.py) and never take the quote
    down with them: the panel shows the price and says fundamentals are
    unavailable.

Endpoints (documented shapes, verified live 2026-09-21):
  /stock/profile2?symbol=AAPL   → marketCapitalization (USD millions),
                                  finnhubIndustry, name, exchange, currency
  /stock/metric?symbol=AAPL&metric=all → 133 metrics: 52WeekHigh/Low, beta,
                                  peTTM, forwardPE, epsTTM, pb,
                                  dividendYieldIndicatedAnnual (percent),
                                  netProfitMarginTTM (percent),
                                  revenueGrowthTTMYoy (percent),
                                  52WeekPriceReturnDaily (percent),
                                  3MonthAverageTradingVolume (millions)
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

from api.providers.cache import TokenBucket
from api.providers.errors import (
    MalformedResponse,
    MissingToken,
    ProviderTimeout,
    ProviderUnavailable,
    RateLimited,
    Unauthorized,
    UnknownSymbol,
)

log = logging.getLogger("mrr.providers.finnhub")

BASE = "https://finnhub.io/api/v1"
PROVIDER = "finnhub"

# Free tier: 60 requests a minute. One a second with a small burst keeps every
# visitor's panel inside it without a queue.
_bucket = TokenBucket(rate=1.0, burst=10)


def _load_token() -> str | None:
    """FINNHUB_API_KEY from the environment, else the repo-root .env (the same
    rule api/stream.py uses for EODHD). Never logged, never sent to a client."""
    tok = os.environ.get("FINNHUB_API_KEY")
    if tok:
        return tok.strip() or None
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("FINNHUB_API_KEY=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    except OSError:
        pass
    return None


class FinnhubClient:
    def __init__(self, token: str | None, *, timeout: float = 8.0, transport: httpx.BaseTransport | None = None) -> None:
        self.token = token
        self.timeout = timeout
        self._transport = transport

    def _get(self, path: str, params: dict[str, Any], *, what: str) -> Any:
        if not self.token:
            raise MissingToken(PROVIDER, "Fundamentals are not configured on this server.")
        if not _bucket.take():
            raise RateLimited(PROVIDER, "Fundamentals are being throttled; retry in a moment.")
        try:
            with httpx.Client(timeout=self.timeout, transport=self._transport, follow_redirects=False) as c:
                r = c.get(f"{BASE}{path}", params=params, headers={"X-Finnhub-Token": self.token})
        except httpx.TimeoutException as exc:
            raise ProviderTimeout(PROVIDER, f"Finnhub did not answer in time ({what}).", detail=type(exc).__name__) from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(PROVIDER, f"Finnhub is unreachable ({what}).", detail=type(exc).__name__) from exc
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError as exc:
                raise MalformedResponse(PROVIDER, f"Finnhub returned a malformed response ({what}).", status=200) from exc
        if r.status_code in (401, 403):
            raise Unauthorized(PROVIDER, f"The Finnhub plan on this server does not include {what}.", status=r.status_code)
        if r.status_code == 404:
            raise UnknownSymbol(PROVIDER, f"Finnhub has no listing for this symbol ({what}).", status=404)
        if r.status_code == 429:
            raise RateLimited(PROVIDER, "Finnhub rate limit reached; retry shortly.", status=429)
        raise ProviderUnavailable(PROVIDER, f"Finnhub returned an unexpected status ({what}).", status=r.status_code)

    def profile2(self, symbol: str) -> dict:
        data = self._get("/stock/profile2", {"symbol": symbol}, what="company profile")
        if not isinstance(data, dict):
            raise MalformedResponse(PROVIDER, "Finnhub's company profile came back in an unexpected shape.")
        return data

    def metrics(self, symbol: str) -> dict:
        data = self._get("/stock/metric", {"symbol": symbol, "metric": "all"}, what="company metrics")
        if not isinstance(data, dict):
            raise MalformedResponse(PROVIDER, "Finnhub's metrics came back in an unexpected shape.")
        metric = data.get("metric")
        return metric if isinstance(metric, dict) else {}


_client: FinnhubClient | None = None


def client() -> FinnhubClient:
    global _client
    if _client is None:
        _client = FinnhubClient(_load_token())
    return _client


def set_client_for_tests(c: FinnhubClient | None) -> None:
    global _client
    _client = c


# ── field mapping ─────────────────────────────────────────────────────────────
# Finnhub's units are not the panel's: market cap and average volume arrive in
# millions, and the margin, yield, growth and 52-week return in percent where
# the panel wants a fraction for the margin. Everything is converted here, once.


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return None if x != x else x


def _scaled(value: Any, factor: float) -> float | None:
    x = _num(value)
    return None if x is None else x * factor


def _first(metric: dict, *names: str) -> float | None:
    for name in names:
        x = _num(metric.get(name))
        if x is not None:
            return x
    return None


def fundamentals(symbol: str) -> dict:
    """The panel's fifteen fundamentals fields for one US listing, or {} when
    Finnhub publishes none of them for it (an ETF, an index, a foreign line).
    Raises ProviderError on a transport or plan failure; callers keep the
    quote and say fundamentals are unavailable."""
    c = client()
    profile = c.profile2(symbol)
    metric = c.metrics(symbol)
    industry = (profile.get("finnhubIndustry") or "").strip() or None
    fields = {
        # Finnhub's free tier has one industry label, not the sector/industry
        # pair Yahoo used to give: it is shown once, as the industry.
        "sector": None,
        "industry": industry,
        "market_cap": _scaled(profile.get("marketCapitalization") or metric.get("marketCapitalization"), 1e6),
        "year_low": _first(metric, "52WeekLow"),
        "year_high": _first(metric, "52WeekHigh"),
        "avg_volume_3m": _scaled(_first(metric, "3MonthAverageTradingVolume", "10DayAverageTradingVolume"), 1e6),
        "trailing_pe": _first(metric, "peTTM", "peBasicExclExtraTTM", "peExclExtraTTM"),
        "forward_pe": _first(metric, "forwardPE"),
        "eps_ttm": _first(metric, "epsTTM", "epsBasicExclExtraItemsTTM"),
        "beta": _first(metric, "beta"),
        "dividend_yield": _first(metric, "dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
        "price_to_book": _first(metric, "pbQuarterly", "pb", "pbAnnual"),
        # percent → fraction: the panel renders profit_margin × 100.
        "profit_margin": (lambda x: None if x is None else x / 100.0)(_first(metric, "netProfitMarginTTM", "netProfitMarginAnnual")),
        "revenue_growth": (lambda x: None if x is None else x / 100.0)(_first(metric, "revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy")),
        "fifty_two_wk_change": _first(metric, "52WeekPriceReturnDaily"),
    }
    return fields if any(v is not None for v in fields.values()) else {}
