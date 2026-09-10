"""Provider layer (api/providers/*): the EODHD client against a mock
transport, the EODHD-first / yfinance-fallback orchestration with full
provenance, entitlement gating, bounded ticks, options pagination, cache
isolation and token hygiene. No network is touched anywhere in this file."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
import pytest

from api.providers import cache as cache_mod
from api.providers import entitlements
from api.providers import eodhd as eod
from api.providers import market
from api.providers.errors import (
    EmptyResult,
    MalformedResponse,
    MissingToken,
    ProviderTimeout,
    ProviderUnavailable,
    RateLimited,
    Unauthorized,
    UnknownSymbol,
    UnsupportedInstrument,
)

TOKEN = "tok-not-a-real-token"


class Upstream:
    """Scriptable EODHD stand-in. `script` maps a path prefix to a list of
    responses consumed in order (the last one repeats)."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.script: dict[str, list] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        assert request.url.params.get("api_token") == TOKEN
        assert "^" not in request.url.path and "=X" not in request.url.path, request.url
        for prefix, responses in self.script.items():
            if request.url.path.startswith(prefix):
                item = responses.pop(0) if len(responses) > 1 else responses[0]
                if isinstance(item, Exception):
                    raise item
                status, body = item
                if isinstance(body, (dict, list)):
                    return httpx.Response(status, json=body, request=request)
                return httpx.Response(status, text=body, request=request, headers={"Retry-After": "0"} if status == 429 else {})
        return httpx.Response(404, json={"message": "not found"}, request=request)

    def paths(self) -> list[str]:
        return [c.url.path for c in self.calls]


def _eod_rows(n=3, close=100.0, adj=50.0):
    return [{"date": f"2026-09-0{i + 1}", "open": close, "high": close + 1, "low": close - 1, "close": close, "adjusted_close": adj, "volume": 1000 + i} for i in range(n)]


def _intraday_rows():
    d1 = int(datetime(2026, 9, 3, 14, 30, tzinfo=timezone.utc).timestamp())
    d2 = int(datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc).timestamp())
    return [{"timestamp": d1, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}, {"timestamp": d2, "open": 2, "high": 3, "low": 1.5, "close": 2.5, "volume": 20}, {"timestamp": d2 + 300, "open": 2.5, "high": 3, "low": 2, "close": 2.7, "volume": 30}]


@pytest.fixture()
def up(monkeypatch):
    u = Upstream()
    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    monkeypatch.setattr(eod.time, "sleep", lambda s: None)  # retries without wall-clock waits
    market.set_client_for_tests(eod.EodhdClient(TOKEN, timeout=1.0, max_retries=2, transport=httpx.MockTransport(u.handler)))
    entitlements.reset_for_tests()
    # yfinance must never be reached unless a test wires it explicitly.
    monkeypatch.setattr(market.yf, "history", lambda inst, period, interval: pytest.fail("yfinance history reached"))
    monkeypatch.setattr(market.yf, "search", lambda q, limit=8: pytest.fail("yfinance search reached"))
    monkeypatch.setattr(market.yf, "quote_and_fundamentals", lambda inst: pytest.fail("yfinance quote reached"))
    yield u
    market.set_client_for_tests(None)
    entitlements.reset_for_tests()


# ── client ──────────────────────────────────────────────────────────────────


def test_client_success_and_retry_on_transient(up):
    up.script["/api/eod/AMZN.US"] = [(500, "boom"), (200, _eod_rows())]
    rows = market.client().eod("AMZN.US", from_="2026-01-01", to="2026-09-06")
    assert len(rows) == 3 and up.paths().count("/api/eod/AMZN.US") == 2


def test_client_429_retries_then_gives_up(up):
    up.script["/api/eod/AMZN.US"] = [(429, "slow down")]
    with pytest.raises(RateLimited) as ei:
        market.client().eod("AMZN.US", from_=None, to=None)
    assert ei.value.retryable and ei.value.http_status == 429
    assert up.paths().count("/api/eod/AMZN.US") == 3  # 1 + max_retries


def test_client_timeout_maps_and_redacts(up):
    up.script["/api/eod/AMZN.US"] = [httpx.ReadTimeout(f"slow ...api_token={TOKEN}")]
    with pytest.raises(ProviderTimeout) as ei:
        market.client().eod("AMZN.US", from_=None, to=None)
    assert TOKEN not in ei.value.detail and TOKEN not in ei.value.public
    assert ei.value.http_status == 504


@pytest.mark.parametrize("status, exc", [(401, Unauthorized), (403, Unauthorized), (404, UnknownSymbol), (422, UnsupportedInstrument)])
def test_client_non_retryable_statuses(up, status, exc):
    up.script["/api/eod/AMZN.US"] = [(status, f"denied {TOKEN}")]
    with pytest.raises(exc) as ei:
        market.client().eod("AMZN.US", from_=None, to=None)
    assert up.paths().count("/api/eod/AMZN.US") == 1
    assert TOKEN not in ei.value.detail


def test_client_malformed_json(up):
    up.script["/api/eod/AMZN.US"] = [(200, "<html>oops</html>")]
    with pytest.raises(MalformedResponse):
        market.client().eod("AMZN.US", from_=None, to=None)


def test_client_missing_token_never_calls(up):
    c = eod.EodhdClient(None, transport=httpx.MockTransport(up.handler))
    with pytest.raises(MissingToken):
        c.eod("AMZN.US", from_=None, to=None)
    assert up.calls == []


def test_client_bucket_throttles(up, monkeypatch):
    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=0.0001, burst=1))
    up.script["/api/eod/AMZN.US"] = [(200, _eod_rows())]
    market.client().eod("AMZN.US", from_=None, to=None)
    with pytest.raises(RateLimited):
        market.client().eod("AMZN.US", from_=None, to=None)


# ── candles ─────────────────────────────────────────────────────────────────


def test_candles_eodhd_daily_adjusted_with_provenance(up):
    up.script["/api/eod/AMZN.US"] = [(200, _eod_rows())]
    s = market.candles("amzn", "6M")
    assert s["provider"] == "eodhd" and s["fallback_used"] is False and s["fallback_reason"] is None
    assert s["symbol"] == "AMZN" and s["interval"] == "1d" and s["range"] == "6M" and s["delayed"] is True
    assert s["count"] == 3 and s["market_ts"] == "2026-09-03T00:00:00Z"
    assert s["bars"][0]["close"] == pytest.approx(50.0) and s["bars"][0]["high"] == pytest.approx(50.5)  # adjusted by 0.5
    assert s["timezone"] == "America/New_York" and s["adjustment"] == "split_dividend_adjusted"
    assert entitlements.get("historical").available is True


def test_candles_1d_keeps_last_session_only(up):
    up.script["/api/intraday/AMZN.US"] = [(200, _intraday_rows())]
    s = market.candles("AMZN", "1D")
    assert s["interval"] == "5m" and s["count"] == 2 and all(b["ts"].startswith("2026-09-04") for b in s["bars"])
    assert s["bars"][0]["ts"] == "2026-09-04T14:30:00Z"


def test_candles_5y_weekly_and_max_monthly(up):
    up.script["/api/eod/SPY.US"] = [(200, _eod_rows())]
    assert market.candles("SPY", "5Y")["interval"] == "1wk"
    assert market.candles("SPY", "MAX")["interval"] == "1mo"
    periods = [c.url.params.get("period") for c in up.calls]
    assert periods == ["w", "m"]


def test_candles_fallback_to_yfinance_is_disclosed(up, monkeypatch):
    up.script["/api/eod/AMZN.US"] = [(500, "down")]
    monkeypatch.setattr(market.yf, "history", lambda inst, period, interval: [{"ts": "2026-09-04T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 5}])
    s = market.candles("AMZN", "1Y")
    assert s["provider"] == "yfinance" and s["fallback_used"] is True and s["fallback_reason"] == "unavailable"
    assert s["count"] == 1 and s["interval"] == "1d"


def test_candles_fallback_when_token_missing(up, monkeypatch):
    market.set_client_for_tests(eod.EodhdClient(None))
    monkeypatch.setattr(market.yf, "history", lambda inst, period, interval: [{"ts": "2026-09-04T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 5}])
    s = market.candles("MSFT", "6M")
    assert s["provider"] == "yfinance" and s["fallback_reason"] == "missing_token"
    assert up.calls == []


def test_candles_unknown_on_both_is_404(up, monkeypatch):
    up.script["/api/eod/NOPEX.US"] = [(404, "no")]

    def missing(inst, period, interval):
        raise UnknownSymbol("yfinance", "nothing")

    monkeypatch.setattr(market.yf, "history", missing)
    with pytest.raises(UnknownSymbol) as ei:
        market.candles("NOPEX", "6M")
    assert "EODHD or yfinance" in ei.value.public


def test_candles_empty_range_is_typed(up, monkeypatch):
    up.script["/api/eod/AMZN.US"] = [(200, [])]
    monkeypatch.setattr(market.yf, "history", lambda inst, period, interval: [])
    with pytest.raises(EmptyResult):
        market.candles("AMZN", "6M")


def test_candles_never_mixes_providers_and_caches_per_symbol(up):
    up.script["/api/eod/AMZN.US"] = [(200, _eod_rows())]
    up.script["/api/eod/AAPL.US"] = [(200, _eod_rows(close=10, adj=10))]
    a = market.candles("AMZN", "6M")
    b = market.candles("AAPL", "6M")
    assert a["bars"][0]["close"] != b["bars"][0]["close"]
    market.candles("AMZN", "6M")  # cached — no second upstream call
    assert up.paths().count("/api/eod/AMZN.US") == 1
    assert {a["provider"], b["provider"]} == {"eodhd"}


def test_candles_index_and_fx_spellings(up):
    up.script["/api/eod/VIX.INDX"] = [(200, _eod_rows())]
    up.script["/api/eod/EURUSD.FOREX"] = [(200, _eod_rows())]
    up.script["/api/eod/BRK-B.US"] = [(200, _eod_rows())]
    assert market.candles("^VIX", "6M")["symbol"] == "VIX"
    assert market.candles("EURUSD=X", "6M")["timezone"] == "UTC"
    assert market.candles("BRK.B", "6M")["symbol"] == "BRK.B"
    assert set(up.paths()) == {"/api/eod/VIX.INDX", "/api/eod/EURUSD.FOREX", "/api/eod/BRK-B.US"}


def test_cached_entitlement_blocks_without_calling(up, monkeypatch):
    entitlements.record_live("historical", False, 403, "unauthorized: plan")
    monkeypatch.setattr(market.yf, "history", lambda inst, period, interval: [{"ts": "2026-09-04T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 5}])
    s = market.candles("AMZN", "6M")
    assert s["provider"] == "yfinance" and s["fallback_reason"] == "unauthorized"
    assert up.calls == []


# ── search / profile / actions ──────────────────────────────────────────────


def test_search_maps_and_orders_us_first(up):
    up.script["/api/search/nvidia"] = [(200, [
        {"Code": "NVD", "Exchange": "XETRA", "Name": "NVIDIA Corp", "Type": "Common Stock", "Country": "Germany", "Currency": "EUR", "isPrimary": False},
        {"Code": "NVDA", "Exchange": "US", "Name": "NVIDIA Corporation", "Type": "Common Stock", "Country": "USA", "Currency": "USD", "isPrimary": True},
    ])]
    r = market.search("nvidia", 5)
    assert r["provider"] == "eodhd" and r["fallback_used"] is False
    assert r["hits"][0]["symbol"] == "NVDA" and r["hits"][0]["type"] == "Equity" and r["hits"][0]["currency"] == "USD"
    assert r["hits"][1]["symbol"] != "NVD"  # non-US listing keeps its exchange in the canonical spelling


def test_search_falls_back_to_yfinance(up, monkeypatch):
    up.script["/api/search/"] = [(500, "down")]
    monkeypatch.setattr(market.yf, "search", lambda q, limit=8: [{"symbol": "BRK-B", "name": "Berkshire", "exchange": "NYSE", "type": "Equity", "sector": None}])
    r = market.search("berkshire", 5)
    assert r["provider"] == "yfinance" and r["fallback_used"] is True and r["fallback_reason"] == "unavailable"
    assert r["hits"][0]["symbol"] == "BRK.B"


def test_profile_eodhd_quote_plus_yfinance_fundamentals(up, monkeypatch):
    up.script["/api/real-time/AMZN.US"] = [(200, {"code": "AMZN.US", "timestamp": 1788552000, "open": 200, "high": 205, "low": 198, "close": 203.5, "volume": 12345, "previousClose": 201, "change": 2.5, "change_p": 1.24})]
    up.script["/api/search/AMZN"] = [(200, [{"Code": "AMZN", "Exchange": "US", "Name": "Amazon.com Inc", "Type": "Common Stock", "Country": "USA", "Currency": "USD"}])]
    monkeypatch.setattr(market.yf, "quote_and_fundamentals", lambda inst: {"name": "Amazon", "last": 203.0, "sector": "Consumer Cyclical", "industry": "Internet Retail", "market_cap": 2.1e12, "trailing_pe": 40.0, "market_ts": None, "fetched_at": "x"})
    p = market.profile("amzn")
    assert p["quote_provider"] == "eodhd" and p["fundamentals_provider"] == "yfinance" and p["fallback_used"] is False
    assert p["last"] == 203.5 and p["prev_close"] == 201 and p["day_change_pct"] == 1.24
    assert p["market_ts"] == "2026-09-04T20:00:00Z" and p["delayed"] is True
    assert p["name"] == "Amazon.com Inc" and p["sector"] == "Consumer Cyclical" and p["market_cap"] == 2.1e12


def test_profile_falls_back_to_yfinance_quote(up, monkeypatch):
    up.script["/api/real-time/AMZN.US"] = [(403, "no")]
    monkeypatch.setattr(market.yf, "quote_and_fundamentals", lambda inst: {"name": "Amazon", "last": 203.0, "prev_close": 200.0, "sector": "x", "market_ts": None, "fetched_at": "x"})
    p = market.profile("AMZN")
    assert p["quote_provider"] == "yfinance" and p["fallback_used"] is True and p["fallback_reason"] == "unauthorized"
    assert p["last"] == 203.0
    assert entitlements.get("realtime").available is False


def test_corporate_actions_parse(up):
    up.script["/api/splits/AAPL.US"] = [(200, [{"date": "2020-08-31", "split": "4/1"}])]
    up.script["/api/div/AAPL.US"] = [(200, [{"date": "2026-08-11", "value": 0.26, "unadjustedValue": 0.26, "currency": "USD", "period": "Quarterly", "paymentDate": "2026-08-14"}])]
    a = market.corporate_actions("AAPL")
    assert a["provider"] == "eodhd" and a["splits"][0]["ratio"] == 4.0 and a["dividends"][0]["payment_date"] == "2026-08-14"
    with pytest.raises(UnsupportedInstrument):
        market.corporate_actions("EURUSD")


# ── options ─────────────────────────────────────────────────────────────────


def _contract(strike, kind="call"):
    return {"type": "options-contracts", "attributes": {"contract": f"AAPL261016{kind[0].upper()}{int(strike):08d}", "underlying_symbol": "AAPL", "exp_date": "2026-10-16", "expiration_type": "monthly", "type": kind, "strike": strike, "bid": 1.0, "bid_date": "2026-09-04 16:00:00", "ask": 1.2, "ask_date": "2026-09-04 16:00:00", "last": 1.1, "midpoint": 1.1, "volume": 10, "open_interest": 100, "volatility": 0.3, "delta": 0.5, "gamma": 0.01, "theta": -0.02, "vega": 0.1, "rho": 0.01, "moneyness": 0.99, "tradetime": "2026-09-04 15:59:00", "dte": 40}}


def test_options_expirations_and_chain_pagination(up):
    up.script["/api/mp/unicornbay/options/contracts"] = [(200, {"meta": {"offset": 100, "limit": 50}, "data": [_contract(230), _contract(235)], "links": {"next": "..."}})]
    ex = market.options_expirations("AAPL")
    assert ex["expirations"] == ["2026-10-16"] and ex["cadence"] == "end_of_day" and ex["as_of"] == "2026-09-04 16:00:00"
    ch = market.options_chain("AAPL", expiration="2026-10-16", type_="call", strike_from=200, strike_to=260, page=2, limit=50)
    assert ch["count"] == 2 and ch["has_more"] is True and ch["contracts"][0]["implied_vol"] == 0.3 and ch["contracts"][0]["strike"] == 230
    req = up.calls[-1]
    assert req.url.params["page[offset]"] == "100" and req.url.params["page[limit]"] == "50"
    assert req.url.params["filter[underlying_symbol]"] == "AAPL" and req.url.params["filter[type]"] == "call"
    assert req.url.params["filter[exp_date_eq]"] == "2026-10-16" and req.url.params["filter[strike_from]"] == "200"
    # Same page again → served from cache.
    n = len(up.calls)
    market.options_chain("AAPL", expiration="2026-10-16", type_="call", strike_from=200, strike_to=260, page=2, limit=50)
    assert len(up.calls) == n
    # Different page → different cache key → new call.
    market.options_chain("AAPL", expiration="2026-10-16", type_="call", strike_from=200, strike_to=260, page=3, limit=50)
    assert len(up.calls) == n + 1


def test_options_unentitled_and_unsupported(up):
    up.script["/api/mp/unicornbay/options/contracts"] = [(403, "no plan")]
    with pytest.raises(Unauthorized):
        market.options_expirations("AAPL")
    assert entitlements.get("options").available is False
    with pytest.raises(Unauthorized):
        market.options_expirations("AAPL")  # cached verdict — no second call
    assert up.paths().count("/api/mp/unicornbay/options/contracts") == 1
    with pytest.raises(UnsupportedInstrument):
        market.options_expirations("EURUSD")


# ── ticks ───────────────────────────────────────────────────────────────────


def test_ticks_aggregate_to_minutes_and_units(up):
    base_ms = int(datetime(2026, 9, 4, 14, 30, 5, tzinfo=timezone.utc).timestamp() * 1000)
    up.script["/api/ticks/"] = [(200, {"ts": [base_ms, base_ms + 20_000, base_ms + 61_000], "price": [10.0, 10.5, 10.2], "shares": [100, 200, 300], "seq": [1, 2, 3]})]
    t = market.recent_trades("AAPL", minutes=15, limit=1000)
    req = up.calls[-1]
    assert req.url.params["s"] == "AAPL" and req.url.params["limit"] == "1000"
    assert int(req.url.params["to"]) - int(req.url.params["from"]) == 15 * 60  # seconds on the wire
    assert t["trades"] == 3 and len(t["bars"]) == 2
    assert t["bars"][0] == {"ts": "2026-09-04T14:30:00Z", "open": 10.0, "high": 10.5, "low": 10.0, "close": 10.5, "volume": 300.0, "trades": 2}
    assert t["last_trade_ts"] == "2026-09-04T14:31:06Z"


def test_ticks_gated_and_bounded(up):
    up.script["/api/ticks/"] = [(403, "no")]
    with pytest.raises(Unauthorized):
        market.recent_trades("AAPL", minutes=15, limit=100)
    with pytest.raises(Unauthorized):
        market.recent_trades("MSFT", minutes=15, limit=100)  # cached verdict
    assert up.paths().count("/api/ticks/") == 1
    with pytest.raises(UnsupportedInstrument):
        market.recent_trades("EURUSD", minutes=5, limit=10)


# ── entitlement probe ───────────────────────────────────────────────────────


def test_probe_all_records_families(up):
    up.script["/api/eod/"] = [(200, _eod_rows())]
    up.script["/api/intraday/"] = [(200, [])]
    up.script["/api/real-time/"] = [(200, {"code": "AAPL.US", "close": 1})]
    up.script["/api/search/"] = [(200, [{"Code": "AAPL", "Exchange": "US"}])]
    up.script["/api/splits/"] = [(200, [])]
    up.script["/api/exchange-details/"] = [(200, {"Timezone": "America/New_York", "isOpen": False})]
    up.script["/api/fundamentals/"] = [(403, "plan")]
    up.script["/api/mp/unicornbay/options/contracts"] = [(200, {"data": [_contract(1)]})]
    up.script["/api/ticks/"] = [(403, "plan")]
    snap = entitlements.probe_all(market.client(), force=True)
    assert snap["historical"]["available"] is True and snap["intraday"]["reason"] == "ok_empty_window"
    assert snap["fundamentals"]["available"] is False and snap["fundamentals"]["status"] == 403
    assert snap["ticks"]["available"] is False and snap["options"]["available"] is True
    assert snap["websocket"]["available"] is None
    assert all(TOKEN not in json.dumps(v) for v in snap.values())
    # Cached: a second call within the TTL does not probe again.
    n = len(up.calls)
    entitlements.probe_all(market.client())
    assert len(up.calls) == n


def test_status_matrix_never_carries_token(up):
    s = market.status()
    assert s["eodhd_configured"] is True and TOKEN not in json.dumps(s)
    assert s["primary"]["ticks"]["fallback"] == "no fallback"
