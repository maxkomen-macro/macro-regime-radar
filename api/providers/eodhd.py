"""Thin EODHD REST client for the families this app uses (2026-09-06).

Endpoint shapes follow the official documentation as read on 2026-09-06:
  /api/eod/{SYM.EXCH}            period=d|w|m, from, to, fmt=json
  /api/intraday/{SYM.EXCH}       interval=1m|5m|1h, from/to = UNIX seconds
  /api/real-time/{SYM.EXCH}      s=A,B,C (15–20 recommended), fmt=json
  /api/search/{query}            limit, exchange, type, fmt=json
  /api/splits/{SYM.EXCH}         from, fmt=json
  /api/div/{SYM.EXCH}            from, fmt=json
  /api/exchange-details/{CODE}   TradingHours, ExchangeHolidays, isOpen, Timezone
  /api/fundamentals/{SYM.EXCH}   filter=General,Highlights (10 calls/request)
  /api/mp/unicornbay/options/contracts  filter[...], page[offset|limit], sort
  /api/ticks/                    s, from/to seconds, limit ≤ 10000 (US only)

Rules: bounded timeouts; retries only for transient failures (timeouts, 5xx,
429) with exponential backoff capped at 4 s and at most `max_retries`
attempts; 401/403/404/422 never retry; the token never appears in any error
or log line (redacted on the way out).
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx
from urllib.parse import quote

from api.providers import quota
from api.providers.cache import TokenBucket
from api.providers.errors import (
    MalformedResponse,
    MissingToken,
    ProviderTimeout,
    ProviderUnavailable,
    RateLimited,
    Unauthorized,
    UnknownSymbol,
    UnsupportedInstrument,
)

log = logging.getLogger("mrr.providers.eodhd")

BASE = "https://eodhd.com/api"
PROVIDER = "eodhd"

# Global ceiling on upstream calls: the plan allows far more, this is abuse
# protection so a burst of visitors cannot turn into a burst of paid calls.
_bucket = TokenBucket(rate=5.0, burst=20)


def _seg(value: str) -> str:
    """One URL path segment, percent-encoded so user text can never escape
    its segment (review P1-1: `../user` reached another EODHD endpoint)."""
    return quote(str(value), safe="")


class EodhdClient:
    def __init__(
        self,
        token: str | None,
        *,
        timeout: float = 8.0,
        max_retries: int = 2,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.token = token
        self.timeout = timeout
        self.max_retries = max_retries
        self._transport = transport

    # ── plumbing ─────────────────────────────────────────────────────────

    def _redact(self, text: str) -> str:
        return text.replace(self.token, "***") if self.token else text

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout, transport=self._transport, follow_redirects=False)

    def _get(self, path: str, params: dict[str, Any], *, what: str, family: str | None = None, tickers: int = 1) -> Any:
        if not self.token:
            raise MissingToken(PROVIDER, "EODHD is not configured on this server.")
        if not _bucket.take():
            raise RateLimited(PROVIDER, "Market-data requests are being throttled; retry in a moment.")
        url = f"{BASE}{path}"
        q = {**params, "api_token": self.token}
        delay = 0.5
        last: Exception | None = None
        for attempt in range(self.max_retries + 1):
            # Every attempt is a call the plan is billed for, retries included
            # (launch-1): the counter must not flatter the deploy.
            quota.record(path, family=family or what.replace(" ", "_"), tickers=tickers)
            try:
                with self._client() as c:
                    r = c.get(url, params=q)
            except httpx.TimeoutException as exc:
                last = ProviderTimeout(PROVIDER, f"EODHD did not answer in time ({what}).", detail=self._redact(repr(exc)))
            except httpx.HTTPError as exc:
                last = ProviderUnavailable(PROVIDER, f"EODHD is unreachable ({what}).", detail=self._redact(repr(exc)))
            else:
                if r.status_code == 200:
                    try:
                        return r.json()
                    except ValueError as exc:
                        raise MalformedResponse(PROVIDER, f"EODHD returned a malformed response ({what}).", status=200, detail=self._redact(repr(exc))) from exc
                if r.status_code in (401, 403):
                    raise Unauthorized(PROVIDER, f"The EODHD plan on this server does not include {what}.", status=r.status_code, detail=self._redact(r.text[:200]))
                if r.status_code == 404:
                    raise UnknownSymbol(PROVIDER, f"EODHD has no listing for this symbol ({what}).", status=404, detail=self._redact(r.text[:200]))
                if r.status_code == 422:
                    raise UnsupportedInstrument(PROVIDER, f"EODHD rejected the request ({what}).", status=422, detail=self._redact(r.text[:200]))
                if r.status_code == 429:
                    retry_after = r.headers.get("Retry-After")
                    last = RateLimited(PROVIDER, "EODHD rate limit reached; retry shortly.", status=429, detail=self._redact(r.text[:200]))
                    try:
                        delay = min(float(retry_after), 5.0) if retry_after else delay
                    except ValueError:
                        pass
                elif r.status_code >= 500:
                    last = ProviderUnavailable(PROVIDER, f"EODHD returned a server error ({what}).", status=r.status_code, detail=self._redact(r.text[:200]))
                else:
                    raise MalformedResponse(PROVIDER, f"EODHD returned an unexpected status ({what}).", status=r.status_code, detail=self._redact(r.text[:200]))
            if attempt < self.max_retries:
                time.sleep(delay + random.random() * 0.1)
                delay = min(delay * 2, 4.0)
        assert last is not None
        log.warning("eodhd %s failed after retries: %s", what, getattr(last, "detail", ""))
        raise last

    # ── families ─────────────────────────────────────────────────────────

    def eod(self, sym: str, *, from_: str | None, to: str | None, period: str = "d") -> list[dict]:
        params: dict[str, Any] = {"fmt": "json", "period": period, "order": "a"}
        if from_:
            params["from"] = from_
        if to:
            params["to"] = to
        data = self._get(f"/eod/{_seg(sym)}", params, what="historical prices")
        if not isinstance(data, list):
            raise MalformedResponse(PROVIDER, "EODHD historical prices came back in an unexpected shape.")
        return data

    def intraday(self, sym: str, *, interval: str, from_ts: int, to_ts: int) -> list[dict]:
        data = self._get(
            f"/intraday/{_seg(sym)}",
            {"fmt": "json", "interval": interval, "from": int(from_ts), "to": int(to_ts)},
            what="intraday candles",
        )
        if not isinstance(data, list):
            raise MalformedResponse(PROVIDER, "EODHD intraday candles came back in an unexpected shape.")
        return data

    def realtime(self, sym: str, extra: list[str] | None = None) -> list[dict]:
        params: dict[str, Any] = {"fmt": "json"}
        if extra:
            params["s"] = ",".join(extra)
        data = self._get(f"/real-time/{_seg(sym)}", params, what="delayed quotes", family="realtime", tickers=1 + len(extra or []))
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return data
        raise MalformedResponse(PROVIDER, "EODHD quotes came back in an unexpected shape.")

    def search(self, query: str, *, limit: int = 15, exchange: str | None = None, type_: str | None = None) -> list[dict]:
        params: dict[str, Any] = {"fmt": "json", "limit": limit}
        if exchange:
            params["exchange"] = exchange
        if type_:
            params["type"] = type_
        data = self._get(f"/search/{_seg(query)}", params, what="symbol search")
        if not isinstance(data, list):
            raise MalformedResponse(PROVIDER, "EODHD search came back in an unexpected shape.")
        return data

    def splits(self, sym: str, *, from_: str) -> list[dict]:
        data = self._get(f"/splits/{_seg(sym)}", {"fmt": "json", "from": from_}, what="splits")
        return data if isinstance(data, list) else []

    def dividends(self, sym: str, *, from_: str) -> list[dict]:
        data = self._get(f"/div/{_seg(sym)}", {"fmt": "json", "from": from_}, what="dividends")
        return data if isinstance(data, list) else []

    def exchange_details(self, code: str) -> dict:
        data = self._get(f"/exchange-details/{_seg(code)}", {"fmt": "json"}, what="exchange details")
        if not isinstance(data, dict):
            raise MalformedResponse(PROVIDER, "EODHD exchange details came back in an unexpected shape.")
        return data

    def fundamentals(self, sym: str, *, filter_: str = "General,Highlights,Valuation,Technicals") -> dict:
        data = self._get(f"/fundamentals/{_seg(sym)}", {"fmt": "json", "filter": filter_}, what="fundamentals")
        if not isinstance(data, dict):
            raise MalformedResponse(PROVIDER, "EODHD fundamentals came back in an unexpected shape.")
        return data

    def options_contracts(
        self,
        underlying: str,
        *,
        exp_date_eq: str | None = None,
        exp_date_from: str | None = None,
        exp_date_to: str | None = None,
        type_: str | None = None,
        strike_from: float | None = None,
        strike_to: float | None = None,
        limit: int = 100,
        offset: int = 0,
        sort: str = "exp_date",
        fields: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {
            "filter[underlying_symbol]": underlying,
            "page[limit]": max(1, min(int(limit), 1000)),
            "page[offset]": max(0, min(int(offset), 10000)),
            "sort": sort,
        }
        if exp_date_eq:
            params["filter[exp_date_eq]"] = exp_date_eq
        if exp_date_from:
            params["filter[exp_date_from]"] = exp_date_from
        if exp_date_to:
            params["filter[exp_date_to]"] = exp_date_to
        if type_:
            params["filter[type]"] = type_
        if strike_from is not None:
            params["filter[strike_from]"] = strike_from
        if strike_to is not None:
            params["filter[strike_to]"] = strike_to
        if fields:
            params["fields[options-contracts]"] = fields
        data = self._get("/mp/unicornbay/options/contracts", params, what="options data")
        if not isinstance(data, dict) or "data" not in data:
            raise MalformedResponse(PROVIDER, "EODHD options came back in an unexpected shape.")
        return data

    def ticks(self, sym_code: str, *, from_ts: int, to_ts: int, limit: int) -> dict:
        data = self._get(
            "/ticks/",
            {"fmt": "json", "s": sym_code, "from": int(from_ts), "to": int(to_ts), "limit": max(1, min(int(limit), 10000))},
            what="tick data",
        )
        if not isinstance(data, dict):
            raise MalformedResponse(PROVIDER, "EODHD tick data came back in an unexpected shape.")
        return data
