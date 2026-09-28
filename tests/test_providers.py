"""Provider layer (api/providers/*): the EODHD client against a mock
transport, the EODHD-only on-demand orchestration with full provenance
(fix/prelaunch-1: the API never falls back to Yahoo; an EODHD failure is a
typed, disclosed error), entitlement gating, bounded ticks, options
pagination, cache isolation and token hygiene. No network is touched anywhere
in this file."""

from __future__ import annotations

import json
import sys
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
    # fix/prelaunch-1: on-demand lookups never reach Yahoo. The one Yahoo
    # function left (the refresh pipeline's daily_closes) fails the test if
    # anything here reaches it, and yfinance itself is unimportable.
    monkeypatch.setattr(market.yf, "daily_closes", lambda *a, **k: pytest.fail("yfinance reached from an on-demand lookup"))
    monkeypatch.setitem(sys.modules, "yfinance", None)
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


def _daily_rows(dates, close=100.0, adj=50.0):
    return [{"date": d, "open": close, "high": close + 1, "low": close - 1, "close": close + i, "adjusted_close": adj + i / 2, "volume": 1000 + i} for i, d in enumerate(dates)]


def _at(monkeypatch, iso_utc):
    monkeypatch.setattr(market, "_utcnow", lambda: datetime.fromisoformat(iso_utc))


def test_candles_2y_is_two_years_of_daily_completed_sessions(up, monkeypatch):
    """desk/books: range=2Y is daily (period d, about 731 days back), split- and dividend-adjusted,
    with volume, and holds only sessions whose close is past; EODHD's unadjusted close rides along
    for dollar volume."""
    _at(monkeypatch, "2026-09-25T21:00:00+00:00")  # Friday, after the 16:00 New York close
    up.script["/api/eod/NVDA.US"] = [(200, _daily_rows(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"]))]
    s = market.candles("NVDA", "2Y")
    assert s["interval"] == "1d" and s["range"] == "2Y" and s["adjustment"] == "split_dividend_adjusted"
    assert [b["ts"][:10] for b in s["bars"]] == ["2026-09-23", "2026-09-24", "2026-09-25"]  # the 28th is not a completed session
    assert s["count"] == 3 and s["market_ts"] == "2026-09-25T00:00:00Z" and s["session"] == "2026-09-25"
    b = s["bars"][1]
    assert b["close"] == pytest.approx(101.0 * (50.5 / 101.0)) and b["volume"] == 1001 and b["close_raw"] == 101.0
    call = up.calls[0]
    assert call.url.params.get("period") == "d"
    frm = datetime.fromisoformat(call.url.params.get("from")).date()
    assert 729 <= (datetime.now(timezone.utc).date() - frm).days <= 732


def test_candles_2y_is_fetched_once_per_ticker_per_session(up, monkeypatch):
    up.script["/api/eod/NVDA.US"] = [(200, _daily_rows(["2026-09-24", "2026-09-25"]))]
    _at(monkeypatch, "2026-09-25T21:00:00+00:00")
    market.candles("NVDA", "2Y")
    market.candles("nvda", "2Y")
    assert up.paths().count("/api/eod/NVDA.US") == 1
    up.script["/api/eod/NVDA.US"] = [(200, _daily_rows(["2026-09-24", "2026-09-25", "2026-09-28"]))]
    _at(monkeypatch, "2026-09-28T21:00:00+00:00")  # the next session closed: a new day's entry
    assert market.candles("NVDA", "2Y")["bars"][-1]["ts"][:10] == "2026-09-28"
    assert up.paths().count("/api/eod/NVDA.US") == 2


def test_candles_2y_asks_again_while_the_days_close_is_not_posted(up, monkeypatch):
    _at(monkeypatch, "2026-09-25T20:30:00+00:00")  # the 25th closed half an hour ago
    up.script["/api/eod/NVDA.US"] = [(200, _daily_rows(["2026-09-23", "2026-09-24"])), (200, _daily_rows(["2026-09-23", "2026-09-24", "2026-09-25"]))]
    assert market.candles("NVDA", "2Y")["bars"][-1]["ts"][:10] == "2026-09-24"
    assert market.candles("NVDA", "2Y")["bars"][-1]["ts"][:10] == "2026-09-24"  # within the retry wait: the stored answer
    assert up.paths().count("/api/eod/NVDA.US") == 1
    monkeypatch.setattr(market, "DAILY_RETRY_S", -1.0)
    assert market.candles("NVDA", "2Y")["bars"][-1]["ts"][:10] == "2026-09-25"
    assert up.paths().count("/api/eod/NVDA.US") == 2


def test_codex_r13_a_stale_daily_entry_is_refreshed_once_under_concurrency(up, monkeypatch):
    """Codex's repro: an entry older than DAILY_RETRY_S whose last bar precedes the completed session, and four
    concurrent daily_bars("SPY") calls. The refresh ran outside the single-flight lock and made four upstream
    computations; the staleness decision and the refresh now share the key's lock: one."""
    import threading
    import time as _time

    _at(monkeypatch, "2026-09-25T21:00:00+00:00")
    up.script["/api/eod/SPY.US"] = [(200, _daily_rows(["2026-09-23", "2026-09-24"]))]
    market.daily_bars("SPY")
    key = "SPY:2Y:2026-09-25"
    stamp, value = market._daily_cache._data[key]
    market._daily_cache._data[key] = (stamp - market.DAILY_RETRY_S - 60, value)  # older than the retry wait
    up.script["/api/eod/SPY.US"] = [(200, _daily_rows(["2026-09-23", "2026-09-24", "2026-09-25"]))]
    calls = []
    real = market._daily_compute

    def slow(inst, session):
        calls.append(session)
        _time.sleep(0.2)
        return real(inst, session)

    monkeypatch.setattr(market, "_daily_compute", slow)
    gate = threading.Barrier(4)
    out = []

    def one():
        gate.wait()
        out.append(market.daily_bars("SPY")["bars"][-1]["ts"][:10])

    threads = [threading.Thread(target=one) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls == ["2026-09-25"] and out == ["2026-09-25"] * 4


def test_route_range_2y_returns_daily_bars(up, monkeypatch):
    """The route over the mocked upstream: /api/market/candles/{SYM}?range=2Y answers daily bars
    (the user's check against the live API: 2Y and 3Y used to be refused, 5Y is weekly)."""
    from fastapi.testclient import TestClient

    from api.main import app

    _at(monkeypatch, "2026-09-25T21:00:00+00:00")
    dates = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]
    up.script["/api/eod/CRWV.US"] = [(200, _daily_rows(dates))]
    r = TestClient(app).get("/api/market/candles/CRWV", params={"range": "2Y"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["interval"] == "1d" and body["range"] == "2Y" and body["provider"] == "eodhd"
    assert [b["ts"][:10] for b in body["bars"]] == dates  # one bar per session, no week or month buckets
    assert set(body["bars"][0]) == {"ts", "open", "high", "low", "close", "volume"}  # the served candle shape
    assert TestClient(app).get("/api/market/candles/CRWV", params={"range": "3Y"}).status_code == 422


def test_candles_eodhd_failure_is_typed_never_a_yahoo_fallback(up):
    """Was test_candles_fallback_to_yfinance_is_disclosed (fix/prelaunch-1)."""
    up.script["/api/eod/AMZN.US"] = [(500, "down")]
    with pytest.raises(ProviderUnavailable) as ei:
        market.candles("AMZN", "1Y")
    assert ei.value.provider == "eodhd" and ei.value.retryable and ei.value.kind == "unavailable"
    assert up.paths().count("/api/eod/AMZN.US") == 3  # 1 + max_retries, then the typed error


def test_candles_without_a_token_say_eodhd_is_not_configured(up):
    """Was test_candles_fallback_when_token_missing (fix/prelaunch-1)."""
    market.set_client_for_tests(eod.EodhdClient(None))
    with pytest.raises(MissingToken):
        market.candles("MSFT", "6M")
    assert up.calls == []


def test_candles_unknown_symbol_is_404_naming_eodhd(up):
    """Was test_candles_unknown_on_both_is_404 (fix/prelaunch-1)."""
    up.script["/api/eod/NOPEX.US"] = [(404, "no")]
    with pytest.raises(UnknownSymbol) as ei:
        market.candles("NOPEX", "6M")
    assert "on EODHD" in ei.value.public and "yfinance" not in ei.value.public
    assert ei.value.http_status == 404


def test_candles_empty_range_is_typed(up):
    up.script["/api/eod/AMZN.US"] = [(200, [])]
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


def test_cached_entitlement_blocks_without_calling(up):
    entitlements.record_live("historical", False, 403, "unauthorized: plan")
    with pytest.raises(Unauthorized) as ei:
        market.candles("AMZN", "6M")
    assert ei.value.provider == "eodhd"
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


def test_search_eodhd_failure_is_typed_never_a_yahoo_fallback(up):
    """Was test_search_falls_back_to_yfinance (fix/prelaunch-1)."""
    up.script["/api/search/"] = [(500, "down")]
    with pytest.raises(ProviderUnavailable) as ei:
        market.search("berkshire", 5)
    assert ei.value.provider == "eodhd" and ei.value.retryable


def test_profile_eodhd_quote_and_identity_without_yahoo_fundamentals(up):
    """Was test_profile_eodhd_quote_plus_yfinance_fundamentals (fix/prelaunch-1):
    the quote and identity are EODHD's; fundamentals are null (not in the plan)
    and never filled from Yahoo."""
    up.script["/api/real-time/AMZN.US"] = [(200, {"code": "AMZN.US", "timestamp": 1788552000, "open": 200, "high": 205, "low": 198, "close": 203.5, "volume": 12345, "previousClose": 201, "change": 2.5, "change_p": 1.24})]
    up.script["/api/search/AMZN"] = [(200, [{"Code": "AMZN", "Exchange": "US", "Name": "Amazon.com Inc", "Type": "Common Stock", "Country": "USA", "Currency": "USD"}])]
    p = market.profile("amzn")
    assert p["quote_provider"] == "eodhd" and p["fundamentals_provider"] is None and p["fallback_used"] is False
    assert p["last"] == 203.5 and p["prev_close"] == 201 and p["day_change_pct"] == 1.24
    assert p["market_ts"] == "2026-09-04T20:00:00Z" and p["delayed"] is True
    assert p["name"] == "Amazon.com Inc" and p["sector"] is None and p["market_cap"] is None
    assert sorted(up.paths()) == ["/api/real-time/AMZN.US", "/api/search/AMZN"]


def test_profile_unentitled_quote_is_typed_and_recorded(up):
    """Was test_profile_falls_back_to_yfinance_quote (fix/prelaunch-1)."""
    up.script["/api/real-time/AMZN.US"] = [(403, "no")]
    with pytest.raises(Unauthorized) as ei:
        market.profile("AMZN")
    assert ei.value.provider == "eodhd"
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


# ── desk/hardening, verifier round 24: V-87, a negative or NaN Retry-After ─────


@pytest.mark.parametrize("header", ["-1", "nan", "NaN", "-0.5"])
def test_a_negative_or_nan_retry_after_is_treated_as_absent(header, monkeypatch):
    """Verifier V-87: `min(float(retry_after), 5.0)` passed a negative or NaN
    Retry-After to time.sleep, which raised ValueError outside the typed errors.
    The prefetch caught only ProviderError, so no backoff was stored and every
    ten-second tick called the provider again. Such a header is now treated as
    absent: the default backoff, then the typed RateLimited, and the prefetch
    stores its backoff and makes no call on the next ticks."""
    from api import worker as worker_mod

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(429, text="slow down", request=request, headers={"Retry-After": header})

    slept: list[float] = []

    def sleep(s: float) -> None:
        # as the real time.sleep (verifier V-90): a negative or NaN length raises ValueError
        if s != s or s < 0:
            raise ValueError("sleep length must be non-negative")
        slept.append(s)

    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    monkeypatch.setattr(eod.time, "sleep", sleep)
    market.set_client_for_tests(eod.EodhdClient(TOKEN, timeout=1.0, max_retries=2, transport=httpx.MockTransport(handler)))
    market.clear_caches()
    entitlements.reset_for_tests()
    try:
        with pytest.raises(RateLimited):
            market.client().eod("AMZN.US", from_="2026-01-01", to="2026-09-06")
        assert len(calls) == 3, calls  # 1 + max_retries
        assert len(slept) == 2 and 0.5 <= slept[0] < 0.6 and 1.0 <= slept[1] < 1.1, slept  # the default 0.5 s, then 1 s

        worker_mod.reset_prefetch_backoff()
        market.clear_caches()  # the provider layer remembers the error above; the prefetch must reach the provider
        entitlements.reset_for_tests()
        calls.clear()
        now = {"t": 1000.0}
        monkeypatch.setattr(worker_mod.time, "monotonic", lambda: now["t"])
        monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))  # on the pinned clock
        worker_mod.prefetch_tick()  # a ValueError here escaped before
        after_first = len(calls)
        keys = [(s, rk) for s in worker_mod.PREFETCH_SYMBOLS for rk in worker_mod.PREFETCH_RANGES]
        assert after_first > 0 and all(k in worker_mod._prefetch_backoff for k in keys), worker_mod._prefetch_backoff
        for _ in range(2):
            now["t"] += worker_mod.PREFETCH_EVERY_S
            worker_mod.prefetch_tick()
        assert len(calls) == after_first, "the backoff holds: no call on the next ticks"
    finally:
        worker_mod.reset_prefetch_backoff()
        market.set_client_for_tests(None)
        market.clear_caches()
        entitlements.reset_for_tests()
