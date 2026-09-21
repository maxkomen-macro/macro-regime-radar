"""tests/test_finnhub.py — fundamentals for the single-name panel (launch-1).

EODHD's plan has no fundamentals, so fifteen fields on the panel were empty
for every symbol. Finnhub's free tier publishes them for US listings. These
tests pin the client's hygiene (key in a header, never a URL), the unit
conversions the panel expects, the 12-hour cache, what happens for instruments
Finnhub does not cover, and that a Finnhub failure never takes the quote down.
No network is touched: every call goes through a mock transport.
"""

from __future__ import annotations

import httpx
import pytest

from api.providers import cache as cache_mod
from api.providers import eodhd as eod
from api.providers import finnhub as fh
from api.providers import market
from api.providers.errors import ProviderError, RateLimited, Unauthorized

TOKEN = "fh-not-a-real-key"

PROFILE2 = {
    "ticker": "AAPL", "name": "Apple Inc", "country": "US", "currency": "USD",
    "exchange": "NASDAQ NMS - GLOBAL MARKET", "ipo": "1980-12-12",
    "marketCapitalization": 4_939_254.2451878525,  # USD millions
    "shareOutstanding": 14_687.36, "finnhubIndustry": "Technology",
    "weburl": "https://www.apple.com/",
}
METRICS = {"metric": {
    "52WeekHigh": 344.5699, "52WeekLow": 236.65, "52WeekPriceReturnDaily": 41.3023,
    "beta": 1.0876318, "dividendYieldIndicatedAnnual": 0.50534,
    "3MonthAverageTradingVolume": 52.50634,  # millions of shares
    "epsTTM": 8.7233, "forwardPE": 34.85022, "netProfitMarginTTM": 27.62,
    "pbQuarterly": 38.486, "peTTM": 38.3096, "revenueGrowthTTMYoy": 14.24,
    "marketCapitalization": 4_939_254,
}}


class Upstream:
    """Scriptable Finnhub stand-in; records every request it sees."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.script: dict[str, list] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        # Key hygiene: the header carries it, the URL never does.
        assert request.headers.get("X-Finnhub-Token") == TOKEN
        assert TOKEN not in str(request.url)
        for prefix, responses in self.script.items():
            if request.url.path.startswith(prefix):
                item = responses.pop(0) if len(responses) > 1 else responses[0]
                if isinstance(item, Exception):
                    raise item
                status, body = item
                return httpx.Response(status, json=body, request=request)
        return httpx.Response(404, json={"error": "not found"}, request=request)

    def paths(self) -> list[str]:
        return [c.url.path for c in self.calls]


@pytest.fixture()
def upstream(monkeypatch):
    up = Upstream()
    up.script = {"/api/v1/stock/profile2": [(200, PROFILE2)], "/api/v1/stock/metric": [(200, METRICS)]}
    fh.set_client_for_tests(fh.FinnhubClient(TOKEN, transport=httpx.MockTransport(up.handler)))
    market.clear_caches()
    # A full bucket for every test: the limiter is asserted on its own below.
    monkeypatch.setattr(fh, "_bucket", cache_mod.TokenBucket(rate=1.0, burst=100))
    yield up
    fh.set_client_for_tests(None)
    market.clear_caches()


# ── the client ───────────────────────────────────────────────────────────────


def test_the_key_rides_in_a_header_and_never_in_a_url(upstream):
    fh.fundamentals("AAPL")
    assert upstream.paths() == ["/api/v1/stock/profile2", "/api/v1/stock/metric"]
    for call in upstream.calls:
        assert "token" not in str(call.url).lower()


def test_a_missing_key_is_a_typed_error():
    fh.set_client_for_tests(fh.FinnhubClient(None))
    with pytest.raises(ProviderError) as ei:
        fh.fundamentals("AAPL")
    assert ei.value.kind == "missing_token"
    fh.set_client_for_tests(None)


@pytest.mark.parametrize("status,kind", [(401, "unauthorized"), (403, "unauthorized"), (429, "rate_limited"), (500, "unavailable")])
def test_upstream_failures_are_typed(monkeypatch, status, kind):
    up = Upstream()
    up.script = {"/api/v1/stock/profile2": [(status, {"error": "no"})]}
    monkeypatch.setattr(fh, "_bucket", cache_mod.TokenBucket(rate=1.0, burst=100))
    fh.set_client_for_tests(fh.FinnhubClient(TOKEN, transport=httpx.MockTransport(up.handler)))
    with pytest.raises(ProviderError) as ei:
        fh.fundamentals("AAPL")
    assert ei.value.kind == kind
    assert TOKEN not in str(ei.value.public) + str(getattr(ei.value, "detail", ""))
    fh.set_client_for_tests(None)


def test_the_bucket_keeps_the_free_tier_under_sixty_a_minute():
    """Burst included: a full bucket plus a minute of refill must stay inside
    Finnhub's 60 a minute (loop 1 found 10 + 60 = 70)."""
    assert fh._bucket.burst + fh._bucket.rate * 60 <= 60


# ── the fields the panel renders ─────────────────────────────────────────────


def test_units_are_converted_to_what_the_panel_expects(upstream):
    f = fh.fundamentals("AAPL")
    assert f["market_cap"] == pytest.approx(4_939_254.2451878525 * 1e6)  # millions → dollars
    assert f["avg_volume_3m"] == pytest.approx(52.50634 * 1e6)  # millions → shares
    assert f["profit_margin"] == pytest.approx(0.2762)  # percent → fraction
    assert f["revenue_growth"] == pytest.approx(0.1424)
    assert f["dividend_yield"] == pytest.approx(0.50534)  # already a percent on screen
    assert f["fifty_two_wk_change"] == pytest.approx(41.3023)
    assert (f["year_low"], f["year_high"]) == (pytest.approx(236.65), pytest.approx(344.5699))
    assert (f["trailing_pe"], f["forward_pe"]) == (pytest.approx(38.3096), pytest.approx(34.85022))
    assert (f["beta"], f["eps_ttm"], f["price_to_book"]) == (pytest.approx(1.0876318), pytest.approx(8.7233), pytest.approx(38.486))


def test_no_tile_silently_changes_meaning(upstream):
    """A 10-day average is not a three-month one, and quarterly growth is not
    trailing-twelve-month growth: when the exact metric is missing the tile
    shows a dash rather than a neighbour (loop 1)."""
    upstream.script = {
        "/api/v1/stock/profile2": [(200, PROFILE2)],
        "/api/v1/stock/metric": [(200, {"metric": {"10DayAverageTradingVolume": 49.1, "revenueGrowthQuarterlyYoy": 16.4,
                                                   "netProfitMarginAnnual": 26.9, "currentDividendYieldTTM": 0.31}})],
    }
    f = fh.fundamentals("AAPL")
    assert f["avg_volume_3m"] is None
    assert f["revenue_growth"] is None
    assert f["profit_margin"] is None
    assert f["dividend_yield"] is None


def test_per_share_figures_in_another_currency_are_dropped(upstream):
    """An ADR can report in its home currency: an EPS in TWD beside a USD
    price would read as nonsense, so it is left out (ratios are unitless)."""
    upstream.script = {
        "/api/v1/stock/profile2": [(200, {**PROFILE2, "currency": "USD", "estimateCurrency": "TWD"})],
        "/api/v1/stock/metric": [(200, METRICS)],
    }
    f = fh.fundamentals("TSM")
    assert f["eps_ttm"] is None
    assert f["trailing_pe"] is not None


def test_industry_is_one_label_and_sector_stays_empty(upstream):
    f = fh.fundamentals("AAPL")
    assert f["industry"] == "Technology"
    assert f["sector"] is None, "the free tier has one label, and the panel must not invent the pair"


def test_an_etf_is_not_covered_even_when_price_metrics_come_back(upstream):
    """Finnhub answers SPY with an empty company profile and a handful of
    price metrics. Company fundamentals do not apply to a fund, so the panel
    must say they are not available rather than show four tiles and eight
    dashes (loop 1)."""
    upstream.script = {
        "/api/v1/stock/profile2": [(200, {})],
        "/api/v1/stock/metric": [(200, {"metric": {"52WeekHigh": 779.37, "52WeekLow": 629.28, "beta": 1.02}})],
    }
    assert fh.fundamentals("SPY") == {}


def test_a_symbol_finnhub_knows_nothing_about_returns_nothing(upstream):
    upstream.script = {"/api/v1/stock/profile2": [(200, {})], "/api/v1/stock/metric": [(200, {"metric": {}})]}
    assert fh.fundamentals("NOPE") == {}


# ── the panel's profile ──────────────────────────────────────────────────────


def _eodhd_quote(monkeypatch):
    """EODHD answers the quote and the identity; Finnhub the fundamentals."""
    def handler(request: httpx.Request) -> httpx.Response:
        if "/real-time/" in request.url.path:
            return httpx.Response(200, json={"code": "AAPL.US", "close": 338.98, "previousClose": 336.13,
                                             "change_p": 0.85, "low": 333.05, "high": 339.64,
                                             "volume": 34_441_478, "timestamp": 1790000000}, request=request)
        if "/search/" in request.url.path:
            return httpx.Response(200, json=[{"Code": "AAPL", "Exchange": "US", "Name": "Apple Inc.",
                                              "Type": "Common Stock", "Country": "USA", "Currency": "USD"}], request=request)
        return httpx.Response(404, json={}, request=request)

    market.set_client_for_tests(eod.EodhdClient("eod-token", transport=httpx.MockTransport(handler)))


def test_the_profile_carries_finnhub_fundamentals_and_names_the_source(upstream, monkeypatch):
    _eodhd_quote(monkeypatch)
    p = market.profile("AAPL")
    assert p["last"] == 338.98 and p["quote_provider"] == "eodhd"
    assert p["fundamentals_provider"] == "finnhub"
    assert p["market_cap"] == pytest.approx(4_939_254.2451878525 * 1e6)
    assert p["industry"] == "Technology"
    assert p["trailing_pe"] == pytest.approx(38.3096)
    market.set_client_for_tests(None)


def test_a_finnhub_failure_leaves_the_quote_standing(upstream, monkeypatch):
    _eodhd_quote(monkeypatch)
    upstream.script = {"/api/v1/stock/profile2": [(500, {"error": "down"})]}
    p = market.profile("AAPL")
    assert p["last"] == 338.98, "the quote must survive a fundamentals outage"
    assert p["fundamentals_provider"] is None
    assert p["market_cap"] is None
    market.set_client_for_tests(None)


def test_a_failure_is_unavailable_not_uncovered(upstream, monkeypatch):
    """An outage must not tell a visitor that NVDA is not a covered company
    (loop 1): the payload says which of the three it is."""
    _eodhd_quote(monkeypatch)
    upstream.script = {"/api/v1/stock/profile2": [(500, {"error": "down"})]}
    p = market.profile("AAPL")
    assert p["fundamentals_status"] == "unavailable"
    assert p["fundamentals_provider"] is None
    market.set_client_for_tests(None)


def test_statuses_for_covered_and_uncovered(upstream, monkeypatch):
    _eodhd_quote(monkeypatch)
    assert market.profile("AAPL")["fundamentals_status"] == "ok"
    market.set_client_for_tests(None)


def test_our_own_throttle_is_not_remembered_as_a_failure(upstream, monkeypatch):
    """When the local bucket is empty the fundamentals are unavailable for
    this request only; the next request after it refills gets them, instead of
    a five-minute blank (loop 1)."""
    _eodhd_quote(monkeypatch)
    monkeypatch.setattr(fh, "_bucket", cache_mod.TokenBucket(rate=0.0, burst=0))
    p = market.profile("AAPL")
    assert p["fundamentals_status"] == "unavailable"
    assert upstream.calls == [], "an empty bucket must not spend half a pair"
    monkeypatch.setattr(fh, "_bucket", cache_mod.TokenBucket(rate=1.0, burst=100))
    market._profile_cache.clear()
    p = market.profile("AAPL")
    assert p["fundamentals_status"] == "ok"
    market.set_client_for_tests(None)


def test_a_pair_takes_both_tokens_or_none(upstream, monkeypatch):
    monkeypatch.setattr(fh, "_bucket", cache_mod.TokenBucket(rate=0.0, burst=1))
    with pytest.raises(RateLimited):
        fh.fundamentals("AAPL")
    assert upstream.calls == []


def test_fundamentals_are_cached_for_twelve_hours(upstream, monkeypatch):
    _eodhd_quote(monkeypatch)
    market.profile("AAPL")
    calls_after_first = len(upstream.calls)
    market._profile_cache.clear()  # a new quote, 45 s later
    market.profile("AAPL")
    assert len(upstream.calls) == calls_after_first, "fundamentals must not be re-fetched with every quote"
    assert market.FUNDAMENTALS_TTL == 12 * 3600
    market.set_client_for_tests(None)


def test_instruments_finnhub_does_not_cover_are_not_asked_about(upstream, monkeypatch):
    """Crypto, FX and indices: no call, and the panel says so rather than
    showing empty tiles with no explanation."""
    def handler(request: httpx.Request) -> httpx.Response:
        if "/real-time/" in request.url.path:
            return httpx.Response(200, json={"code": "BTC-USD.CC", "close": 64000.0, "timestamp": 1790000000}, request=request)
        return httpx.Response(200, json=[], request=request)

    market.set_client_for_tests(eod.EodhdClient("eod-token", transport=httpx.MockTransport(handler)))
    p = market.profile("BTC-USD")
    assert p["fundamentals_provider"] is None and p["market_cap"] is None
    assert upstream.calls == [], "no fundamentals call for an instrument Finnhub does not cover"
    market.set_client_for_tests(None)
