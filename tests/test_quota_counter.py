"""tests/test_quota_counter.py — what the deploy spends at EODHD (launch-1).

The plan is metered in "API calls", and the weights differ by endpoint: an
intraday request costs five, a delayed-quote request one per ticker, an EOD or
search request one. Idle, this server spends most of its quota on timers, so
the counter is what makes item 5's claim checkable in production rather than
only in a measurement session.
"""

from __future__ import annotations

import pytest

from api.providers import quota


@pytest.fixture(autouse=True)
def fresh():
    quota.reset()
    yield
    quota.reset()


def test_weights_follow_the_published_price_list():
    assert quota.weight_for("/intraday/AAPL.US") == 5
    assert quota.weight_for("/eod/AAPL.US") == 1
    assert quota.weight_for("/search/AAPL") == 1
    assert quota.weight_for("/splits/AAPL.US") == 1
    assert quota.weight_for("/exchange-details/US") == 1
    assert quota.weight_for("/fundamentals/AMZN.US") == 10
    assert quota.weight_for("/mp/unicornbay/options/contracts") == 10
    # A delayed-quote request is one call per ticker in it.
    assert quota.weight_for("/real-time/SPY.US", tickers=15) == 15
    assert quota.weight_for("/real-time/VIX.INDX") == 1


def test_it_counts_requests_units_and_families():
    quota.record("/intraday/SPY.US", family="intraday")
    quota.record("/real-time/SPY.US", family="realtime", tickers=15)
    quota.record("/real-time/VIX.INDX", family="realtime")
    snap = quota.snapshot()
    assert snap["requests"] == 3
    assert snap["units"] == 5 + 15 + 1
    assert snap["by_family"]["intraday"] == {"requests": 1, "units": 5}
    assert snap["by_family"]["realtime"] == {"requests": 2, "units": 16}
    assert snap["since"].endswith("Z") and snap["elapsed_s"] >= 0


def test_it_projects_a_daily_rate_from_what_it_has_seen():
    quota.record("/intraday/SPY.US", family="intraday")
    snap = quota.snapshot(elapsed_override_s=3600.0)
    assert snap["units_per_hour"] == pytest.approx(5.0)
    assert snap["units_per_day_projected"] == pytest.approx(120.0)


def test_the_client_counts_every_call_it_makes(monkeypatch):
    import httpx

    from api.providers import eodhd as eod

    def handler(request: httpx.Request) -> httpx.Response:
        if "/intraday/" in request.url.path:
            return httpx.Response(200, json=[], request=request)
        return httpx.Response(200, json=[{"code": "SPY.US", "close": 1.0}], request=request)

    c = eod.EodhdClient("tok", transport=httpx.MockTransport(handler))
    c.intraday("SPY.US", interval="5m", from_ts=0, to_ts=1)
    c.realtime("SPY.US", extra=["QQQ.US", "IWM.US"])
    snap = quota.snapshot()
    assert snap["requests"] == 2
    assert snap["units"] == 5 + 3  # intraday 5, three tickers 3
