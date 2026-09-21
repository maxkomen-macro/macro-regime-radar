"""The API process never calls Yahoo (fix/prelaunch-1, item 4a/4d).

On-demand symbol lookups are EODHD only: when EODHD cannot answer, the visitor
gets a typed, disclosed error instead of a silent second source. The profile's
two EODHD calls run concurrently, and the worker keeps the fixed strip and the
default watchlist candles warm. Yahoo survives only as the refresh pipeline's
disclosed fallback (tests/test_asset_history.py)."""

from __future__ import annotations

import re
import sys
import threading
import time
import types
from pathlib import Path

import httpx
import pytest

from api.providers import cache as cache_mod
from api.providers import entitlements
from api.providers import eodhd as eod
from api.providers import market
from api.providers.errors import MissingToken, ProviderError, Unauthorized, UnknownSymbol

TOKEN = "tok-not-a-real-token"
ROOT = Path(__file__).resolve().parent.parent


class _BlockedYahoo(types.ModuleType):
    def __getattr__(self, name):
        raise AssertionError(f"yfinance.{name} reached from the API process")


class Upstream:
    def __init__(self, delay: dict[str, float] | None = None) -> None:
        self.calls: list[tuple[str, float, float]] = []
        self.script: dict[str, tuple[int, object]] = {}
        self.delay = delay or {}
        self._lock = threading.Lock()

    def handler(self, request: httpx.Request) -> httpx.Response:
        t0 = time.perf_counter()
        for prefix, secs in self.delay.items():
            if request.url.path.startswith(prefix):
                threading.Event().wait(secs)  # not time.sleep: the fixture stubs it for the client's retries
        with self._lock:
            self.calls.append((request.url.path, t0, time.perf_counter()))
        for prefix, (status, body) in self.script.items():
            if request.url.path.startswith(prefix):
                if isinstance(body, (dict, list)):
                    return httpx.Response(status, json=body, request=request)
                return httpx.Response(status, text=str(body), request=request)
        return httpx.Response(404, json={"message": "not found"}, request=request)


@pytest.fixture()
def blocked(monkeypatch):
    """yfinance is unimportable, and every function of the Yahoo provider
    module records an attempt; a test fails if any attempt was made (an
    attempt swallowed into a typed error would otherwise pass unseen)."""
    from api.providers import yf as yf_provider

    attempts: list[str] = []
    monkeypatch.setitem(sys.modules, "yfinance", _BlockedYahoo("yfinance"))
    for name in [n for n in dir(yf_provider) if not n.startswith("_") and callable(getattr(yf_provider, n))
                 and getattr(getattr(yf_provider, n), "__module__", "") == yf_provider.__name__]:
        monkeypatch.setattr(yf_provider, name, lambda *a, _n=name, **k: attempts.append(_n) or pytest.fail(f"Yahoo {_n} attempted"))
    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    monkeypatch.setattr(eod.time, "sleep", lambda s: None)
    entitlements.reset_for_tests()
    market.clear_caches()
    yield attempts
    market.set_client_for_tests(None)
    entitlements.reset_for_tests()
    assert attempts == [], f"the API process attempted Yahoo: {attempts}"


def _install(up: Upstream) -> None:
    market.set_client_for_tests(eod.EodhdClient(TOKEN, timeout=2.0, max_retries=0, transport=httpx.MockTransport(up.handler)))


LOOKUPS = [
    ("candles 6M", lambda: market.candles("AMZN", "6M"), "/api/eod/AMZN.US"),
    ("candles 1D", lambda: market.candles("AMZN", "1D"), "/api/intraday/AMZN.US"),
    ("search", lambda: market.search("amazon", 5), "/api/search/amazon"),
    ("profile", lambda: market.profile("AMZN"), "/api/real-time/AMZN.US"),
    ("actions", lambda: market.corporate_actions("AMZN"), "/api/splits/AMZN.US"),
]


@pytest.mark.parametrize("name, call, path", LOOKUPS, ids=[x[0] for x in LOOKUPS])
def test_a_failing_eodhd_is_a_typed_error_never_a_yahoo_fallback(blocked, name, call, path):
    up = Upstream()
    up.script[path] = (503, "upstream down")
    _install(up)
    with pytest.raises(ProviderError) as ei:
        call()
    err = ei.value
    assert err.kind == "unavailable" and err.retryable is True, (err.kind, err.public)
    assert "yfinance" not in err.public.lower() and "yahoo" not in err.public.lower()
    assert up.calls, "EODHD was asked first"


@pytest.mark.parametrize("name, call, path", LOOKUPS, ids=[x[0] for x in LOOKUPS])
def test_without_a_token_lookups_say_eodhd_is_not_configured(blocked, name, call, path):
    market.set_client_for_tests(eod.EodhdClient(None))
    with pytest.raises(MissingToken):
        call()


def test_a_blocked_entitlement_answers_without_any_upstream_call(blocked):
    up = Upstream()
    _install(up)
    entitlements.record_live("historical", False, 403, "unauthorized: plan")
    with pytest.raises(Unauthorized):
        market.candles("AMZN", "6M")
    assert up.calls == []


def test_an_unknown_symbol_names_eodhd_only(blocked):
    up = Upstream()
    up.script["/api/eod/NOPEX.US"] = (404, "no")
    _install(up)
    with pytest.raises(UnknownSymbol) as ei:
        market.candles("NOPEX", "6M")
    assert "EODHD" in ei.value.public and "yfinance" not in ei.value.public


def test_the_profile_makes_its_two_eodhd_calls_concurrently(blocked):
    up = Upstream(delay={"/api/real-time/": 0.35, "/api/search/": 0.35})
    up.script["/api/real-time/AMZN.US"] = (200, {"code": "AMZN.US", "timestamp": 1788552000, "open": 200, "high": 205, "low": 198, "close": 203.5, "volume": 12345, "previousClose": 201, "change": 2.5, "change_p": 1.24})
    up.script["/api/search/AMZN"] = (200, [{"Code": "AMZN", "Exchange": "US", "Name": "Amazon.com Inc", "Type": "Common Stock", "Country": "USA", "Currency": "USD"}])
    _install(up)
    t = time.perf_counter()
    p = market.profile("AMZN")
    elapsed = time.perf_counter() - t
    paths = [c[0] for c in up.calls]
    assert sorted(paths) == ["/api/real-time/AMZN.US", "/api/search/AMZN"]
    (_, a0, a1), (_, b0, b1) = up.calls
    assert max(a0, b0) < min(a1, b1), "the two calls overlap in time"
    assert elapsed < 0.6, f"{elapsed:.2f}s: sequential would be at least 0.70s"
    assert p["last"] == 203.5 and p["name"] == "Amazon.com Inc" and p["quote_provider"] == "eodhd"
    assert p["fundamentals_provider"] is None and p["market_cap"] is None and p["fallback_used"] is False


def test_the_profile_still_answers_when_only_the_identity_lookup_fails(blocked):
    up = Upstream()
    up.script["/api/real-time/AMZN.US"] = (200, {"code": "AMZN.US", "timestamp": 1788552000, "close": 203.5, "previousClose": 201, "change_p": 1.24})
    up.script["/api/search/AMZN"] = (503, "down")
    _install(up)
    p = market.profile("AMZN")
    assert p["last"] == 203.5 and p["name"] == "AMZN"


# ── prefetch ─────────────────────────────────────────────────────────────────

def _ts_list(src: str, pattern: str) -> list[str]:
    m = re.search(pattern, src, re.S)
    assert m, pattern
    return re.findall(r'"([A-Z]+)"', m.group(1))


def test_the_prefetch_set_is_the_strip_plus_the_default_watchlist():
    from api import worker as worker_mod

    storage = (ROOT / "web/src/screens/shell/watchlist/storage.ts").read_text()
    watch = _ts_list(storage, r"DEFAULT_SYMBOLS[^=]*=\s*\[([^\]]*)\]")
    strip = _ts_list((ROOT / "web/src/screens/shell/TickerLive.tsx").read_text(), r"useMarketIntraday\(\[([^\]]*)\]")
    assert list(worker_mod.PREFETCH_SYMBOLS) == list(dict.fromkeys(strip + watch))
    # the watchlist rows ask for 5D candles (useWatchlistQuote); that is what gets warmed
    assert '"5D"' in (ROOT / "web/src/screens/shell/watchlist/useWatchlistQuote.ts").read_text()
    assert worker_mod.PREFETCH_RANGES == ("5D",)


def test_prefetch_warms_the_fixed_symbols_and_refreshes_them_before_they_expire(blocked, monkeypatch):
    from api import worker as worker_mod

    up = Upstream()
    for sym in worker_mod.PREFETCH_SYMBOLS:
        up.script[f"/api/intraday/{sym}.US"] = (200, [{"timestamp": 1788552000 + 300 * i, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10} for i in range(3)])
    _install(up)
    # The cache module's own clock only (the token bucket shares it, so start
    # from real time; patching the global time module would freeze the bucket).
    clock = [time.monotonic()]
    monkeypatch.setattr(cache_mod, "time", types.SimpleNamespace(monotonic=lambda: clock[0]))
    assert worker_mod.prefetch_tick() == len(worker_mod.PREFETCH_SYMBOLS)
    n = len(up.calls)
    for sym in worker_mod.PREFETCH_SYMBOLS:
        market.candles(sym, "5D")  # a visitor's request: served warm, no upstream call
    assert len(up.calls) == n
    clock[0] += 30
    assert worker_mod.prefetch_tick() == 0  # still fresh
    clock[0] += market.RANGE_TTL["5D"] - 30 - worker_mod.PREFETCH_MARGIN_S + 1
    assert worker_mod.prefetch_tick() == len(worker_mod.PREFETCH_SYMBOLS)  # refreshed before expiry
    assert len(up.calls) == 2 * n


def test_the_status_matrix_declares_no_yahoo_for_on_demand_lookups():
    status = market.status()
    for family in ("daily_candles", "intraday_candles", "symbol_search", "splits_dividends", "quotes", "fundamentals"):
        entry = status["primary"].get(family)
        if entry is None:
            continue
        assert entry["fallback"] is None and "yfinance" not in entry["primary"], (family, entry)


# ── launch-1: fundamentals come from Finnhub, and still never from Yahoo ────


def test_the_profile_fills_fundamentals_from_finnhub_without_touching_yahoo(blocked, monkeypatch):
    """The fifteen fields EODHD's plan cannot answer are Finnhub's now. The
    point of this file stands: no path in the API process reaches Yahoo."""
    import httpx

    from api.providers import finnhub as fh

    def eodhd(request: httpx.Request) -> httpx.Response:
        if "/real-time/" in request.url.path:
            return httpx.Response(200, json={"code": "NVDA.US", "close": 180.5, "previousClose": 178.0,
                                             "timestamp": 1790000000}, request=request)
        if "/search/" in request.url.path:
            return httpx.Response(200, json=[{"Code": "NVDA", "Exchange": "US", "Name": "NVIDIA Corp",
                                              "Type": "Common Stock", "Currency": "USD"}], request=request)
        return httpx.Response(404, json={}, request=request)

    def finnhub(request: httpx.Request) -> httpx.Response:
        if "profile2" in request.url.path:
            return httpx.Response(200, json={"marketCapitalization": 3_000_000.0, "finnhubIndustry": "Semiconductors"}, request=request)
        return httpx.Response(200, json={"metric": {"peTTM": 51.2, "beta": 2.1, "52WeekHigh": 200.0, "52WeekLow": 90.0}}, request=request)

    market.set_client_for_tests(eod.EodhdClient("tok", transport=httpx.MockTransport(eodhd)))
    fh.set_client_for_tests(fh.FinnhubClient("fh-tok", transport=httpx.MockTransport(finnhub)))
    try:
        p = market.profile("NVDA")
        assert p["fundamentals_provider"] == "finnhub"
        assert p["market_cap"] == 3_000_000.0 * 1e6
        assert p["industry"] == "Semiconductors"
        assert p["last"] == 180.5
        assert blocked == [], "the fundamentals path must not reach Yahoo"
    finally:
        fh.set_client_for_tests(None)


def test_finnhub_is_never_asked_about_an_instrument_it_does_not_cover(blocked):
    """Crypto, FX and indices skip the call entirely, so no quota is spent and
    the panel can say plainly that fundamentals are not available."""
    import httpx

    from api.providers import finnhub as fh

    calls: list[str] = []

    def finnhub(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={}, request=request)

    def eodhd(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": "BTC-USD.CC", "close": 64000.0, "timestamp": 1790000000}, request=request)

    market.set_client_for_tests(eod.EodhdClient("tok", transport=httpx.MockTransport(eodhd)))
    fh.set_client_for_tests(fh.FinnhubClient("fh-tok", transport=httpx.MockTransport(finnhub)))
    try:
        p = market.profile("BTC-USD")
        assert p["fundamentals_provider"] is None
        assert calls == []
        assert blocked == []
    finally:
        fh.set_client_for_tests(None)
