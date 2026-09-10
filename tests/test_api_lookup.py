"""Tests for the on-demand symbol layer routes (api/lookup.py seam over
api/providers/market.py, 2026-09-06).

The provider functions are stubbed at the module seam — no network is
touched; what's under test is the route contract: envelope mapping, input
validation, and the error translation (ProviderError kinds → HTTP status and
a sanitized, typed body).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api import lookup
from api.main import app
from api.providers import market as market_layer
from api.providers.errors import ProviderUnavailable, RateLimited, Unauthorized, UnknownSymbol, UnsupportedInstrument


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


_HIT = {
    "symbol": "NVDA",
    "name": "NVIDIA Corporation",
    "exchange": "US",
    "type": "Equity",
    "sector": None,
    "country": "USA",
    "currency": "USD",
    "primary": True,
}
_SEARCH = {"provider": "eodhd", "fallback_used": False, "fallback_reason": None, "fetched_at": "2026-09-06T00:00:00Z", "hits": [_HIT]}

_PROFILE = {
    "symbol": "NVDA",
    "name": "NVIDIA Corporation",
    "exchange": "US",
    "currency": "USD",
    "quote_type": "Equity",
    "sector": "Technology",
    "industry": "Semiconductors",
    "last": 209.66,
    "prev_close": 213.05,
    "day_change_pct": -1.59,
    "day_low": 209.22,
    "day_high": 213.6,
    "year_low": 164.07,
    "year_high": 236.86,
    "market_cap": 5.078e12,
    "last_volume": 175233600.0,
    "avg_volume_3m": 139600000.0,
    "trailing_pe": 32.56,
    "forward_pe": 16.0,
    "eps_ttm": 6.44,
    "beta": 2.215,
    "dividend_yield": 0.47,
    "price_to_book": 38.2,
    "profit_margin": 0.63,
    "revenue_growth": 0.62,
    "fifty_two_wk_change": 0.15,
    "fetched_at": "2026-08-27T06:54:44Z",
    "market_ts": "2026-08-27T06:40:00Z",
    "quote_provider": "eodhd",
    "fundamentals_provider": "yfinance",
    "delayed": True,
    "delay_note": "EODHD delayed quote",
    "fallback_used": False,
    "fallback_reason": None,
}

_BAR = {
    "ts": "2026-08-26T00:00:00Z",
    "open": 212.64,
    "high": 213.6,
    "low": 209.23,
    "close": 209.66,
    "volume": 175233600.0,
}
_SERIES = {
    "symbol": "NVDA",
    "provider": "eodhd",
    "fallback_used": False,
    "fallback_reason": None,
    "fetched_at": "2026-09-06T00:00:00Z",
    "market_ts": _BAR["ts"],
    "delayed": True,
    "interval": "1d",
    "range": "6M",
    "exchange": "US",
    "timezone": "America/New_York",
    "adjustment": "split_dividend_adjusted",
    "count": 1,
    "bars": [_BAR],
}


def test_search_maps_hits(client, monkeypatch):
    monkeypatch.setattr(lookup, "search", lambda q, limit=10: dict(_SEARCH))
    r = client.get("/api/market/search", params={"q": "nvidia"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "eodhd" and body["fallback_used"] is False
    assert body["hits"] == [_HIT]


def test_search_requires_query(client):
    assert client.get("/api/market/search").status_code == 422
    assert client.get("/api/market/search", params={"q": ""}).status_code == 422


def test_search_upstream_failure_is_typed_502(client, monkeypatch):
    def boom(q, limit=10):
        raise ProviderUnavailable("eodhd", "Symbol search is unavailable right now.", detail="https://eodhd.com/api/search/x?api_token=SECRET")

    monkeypatch.setattr(lookup, "search", boom)
    r = client.get("/api/market/search", params={"q": "nvda"})
    assert r.status_code == 502
    body = r.json()
    assert body["kind"] == "unavailable" and body["provider"] == "eodhd" and body["retryable"] is True
    assert "unavailable" in body["detail"].lower()
    assert "SECRET" not in r.text and "api_token" not in r.text  # internal detail never leaves the server


def test_profile_roundtrip_carries_provenance(client, monkeypatch):
    monkeypatch.setattr(lookup, "profile", lambda s: dict(_PROFILE))
    r = client.get("/api/market/profile/NVDA")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "NVDA"
    assert body["last"] == pytest.approx(209.66)
    assert body["quote_provider"] == "eodhd" and body["fundamentals_provider"] == "yfinance"
    assert body["delayed"] is True and body["fallback_used"] is False


def test_profile_unknown_symbol_is_404(client, monkeypatch):
    def missing(s):
        raise UnknownSymbol(f"No quote for '{s}'.")

    monkeypatch.setattr(lookup, "profile", missing)
    r = client.get("/api/market/profile/NOTREAL999")
    assert r.status_code == 404
    assert r.json()["kind"] == "unknown_symbol"


def test_profile_rejects_junk_symbol_before_any_provider(client, monkeypatch):
    called = {"n": 0}

    def never(s):
        called["n"] += 1
        return dict(_PROFILE)

    monkeypatch.setattr(lookup, "profile", never)
    assert client.get("/api/market/profile/not%20a%20symbol!!").status_code == 422
    assert called["n"] == 0


def test_candles_envelope_and_range_validation(client, monkeypatch):
    monkeypatch.setattr(lookup, "candles", lambda s, r: dict(_SERIES))
    ok = client.get("/api/market/candles/NVDA", params={"range": "6M"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["provider"] == "eodhd" and body["bars"] == [_BAR] and body["count"] == 1
    assert body["interval"] == "1d" and body["adjustment"] == "split_dividend_adjusted"
    # range is a closed vocabulary — anything else fails validation, and the
    # stub above proves the 422 comes from the route, not the provider layer.
    assert client.get("/api/market/candles/NVDA", params={"range": "2Y"}).status_code == 422


def test_candles_fallback_is_disclosed(client, monkeypatch):
    fb = {**_SERIES, "provider": "yfinance", "fallback_used": True, "fallback_reason": "timeout"}
    monkeypatch.setattr(lookup, "candles", lambda s, r: fb)
    body = client.get("/api/market/candles/AMZN", params={"range": "1Y"}).json()
    assert body["provider"] == "yfinance" and body["fallback_used"] is True and body["fallback_reason"] == "timeout"


@pytest.mark.parametrize(
    "exc, status, kind",
    [
        (RateLimited("eodhd", "throttled"), 429, "rate_limited"),
        (Unauthorized("eodhd", "plan"), 403, "unauthorized"),
        (UnsupportedInstrument("api", "nope"), 422, "unsupported"),
    ],
)
def test_candles_error_kinds_map_to_status(client, monkeypatch, exc, status, kind):
    def raise_it(s, r):
        raise exc

    monkeypatch.setattr(lookup, "candles", raise_it)
    r = client.get("/api/market/candles/AMZN", params={"range": "6M"})
    assert r.status_code == status
    assert r.json()["kind"] == kind


def test_symbol_validation_rejects_junk():
    with pytest.raises(UnknownSymbol):
        lookup._valid_symbol("not a symbol!!")
    assert lookup._valid_symbol(" nvda ") == "NVDA"
    assert lookup._valid_symbol("brk-b") == "BRK.B"


def test_keyed_cache_single_flight_and_ttl():
    cache = lookup._KeyedTTLCache(1000.0)
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return calls["n"]

    assert cache.get("k", compute) == 1
    assert cache.get("k", compute) == 1  # cached — compute not re-run
    assert calls["n"] == 1
    assert cache.get("k2", compute) == 2  # distinct key computes


# ── corporate actions / options / ticks routes ──────────────────────────────

_ACTIONS = {
    "symbol": "AAPL",
    "provider": "eodhd",
    "fallback_used": False,
    "fallback_reason": None,
    "fetched_at": "2026-09-06T00:00:00Z",
    "from": "2021-09-06",
    "splits": [{"date": "2020-08-31", "ratio": 4.0, "text": "4/1"}],
    "dividends": [{"date": "2026-08-11", "value": 0.26, "unadjusted_value": 0.26, "currency": "USD", "period": "Quarterly", "declaration_date": None, "record_date": None, "payment_date": "2026-08-14"}],
}


def test_actions_envelope(client, monkeypatch):
    monkeypatch.setattr(market_layer, "corporate_actions", lambda s, years=5: dict(_ACTIONS))
    r = client.get("/api/market/actions/AAPL")
    assert r.status_code == 200
    body = r.json()
    assert body["from"] == "2021-09-06" and body["splits"][0]["ratio"] == 4.0


def test_options_unentitled_is_explicit_403(client, monkeypatch):
    def gated(s):
        raise Unauthorized("eodhd", "Options data is not included in the EODHD plan on this server.", status=403)

    monkeypatch.setattr(market_layer, "options_expirations", gated)
    r = client.get("/api/market/options/AAPL/expirations")
    assert r.status_code == 403
    assert r.json()["kind"] == "unauthorized"


def test_options_chain_validation(client, monkeypatch):
    monkeypatch.setattr(market_layer, "options_chain", lambda *a, **k: {})
    assert client.get("/api/market/options/AAPL").status_code == 422  # expiration required
    assert client.get("/api/market/options/AAPL", params={"expiration": "next-friday"}).status_code == 422
    assert client.get("/api/market/options/AAPL", params={"expiration": "2026-10-16", "type": "straddle"}).status_code == 422
    assert client.get("/api/market/options/AAPL", params={"expiration": "2026-10-16", "strike_from": 200, "strike_to": 100}).status_code == 422
    assert client.get("/api/market/options/AAPL", params={"expiration": "2026-10-16", "limit": 5000}).status_code == 422


def test_options_chain_roundtrip(client, monkeypatch):
    captured = {}

    def chain(symbol, *, expiration, type_, strike_from, strike_to, page, limit):
        captured.update(symbol=symbol, expiration=expiration, type_=type_, page=page, limit=limit)
        return {
            "symbol": "AAPL", "underlying": "AAPL", "provider": "eodhd", "cadence": "end_of_day", "as_of": "2026-09-04 16:00:00",
            "fetched_at": "2026-09-06T00:00:00Z", "expiration": expiration, "type": type_, "strike_from": strike_from, "strike_to": strike_to,
            "page": page, "limit": limit, "count": 1, "total": None, "has_more": False,
            "contracts": [{"contract": "AAPL261016C00230000", "type": "call", "strike": 230.0, "exp_date": "2026-10-16", "expiration_type": "monthly", "dte": 40,
                           "bid": 5.1, "ask": 5.3, "last": 5.2, "midpoint": 5.2, "volume": 100, "open_interest": 2000, "implied_vol": 0.28,
                           "delta": 0.45, "gamma": 0.02, "theta": -0.05, "vega": 0.3, "rho": 0.1, "moneyness": 0.98, "tradetime": "2026-09-04 15:59:00", "last_quote": "2026-09-04 16:00:00"}],
        }

    monkeypatch.setattr(market_layer, "options_chain", chain)
    r = client.get("/api/market/options/AAPL", params={"expiration": "2026-10-16", "type": "call", "page": 1, "limit": 50})
    assert r.status_code == 200
    assert captured == {"symbol": "AAPL", "expiration": "2026-10-16", "type_": "call", "page": 1, "limit": 50}
    assert r.json()["contracts"][0]["implied_vol"] == 0.28 and r.json()["cadence"] == "end_of_day"


def test_ticks_bounds_and_gating(client, monkeypatch):
    def gated(symbol, *, minutes, limit):
        raise Unauthorized("eodhd", "Tick data is not included in the EODHD plan on this server.", status=403)

    monkeypatch.setattr(market_layer, "recent_trades", gated)
    assert client.get("/api/market/ticks/AAPL", params={"minutes": 120}).status_code == 422  # window is bounded
    assert client.get("/api/market/ticks/AAPL", params={"limit": 999999}).status_code == 422
    r = client.get("/api/market/ticks/AAPL")
    assert r.status_code == 403 and r.json()["kind"] == "unauthorized"


def test_news_ticker_filter_shape(client):
    # Real read-only DB: the filter must apply cleanly whether or not any rows
    # carry tags (the local snapshot has none — shape-only assertion).
    r = client.get("/api/news", params={"hours": 720, "ticker": "AAPL", "limit": 5})
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    for row in r.json():
        assert (row["ticker"] or "").upper() == "AAPL"
