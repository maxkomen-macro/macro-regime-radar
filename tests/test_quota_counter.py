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


def test_marketplace_units_are_kept_out_of_the_daily_figure():
    """Verify loop 1, D6: the options chain bills a separate allowance, so it
    must not inflate the main quota's projection."""
    quota.reset()
    quota.record("/api/real-time/SPY.US", family="relay_rest", tickers=15)
    quota.record("/api/mp/unicornbay/options/contracts", family="options")
    snap = quota.snapshot(elapsed_override_s=3600)
    assert snap["units"] == 15
    assert snap["marketplace_units"] == 10
    assert snap["units_per_day_projected"] == pytest.approx(15 * 24)
    assert snap["requests"] == 2
    quota.reset()


# ── the plan's daily limit, from EODHD's own /api/user (verify loop 1, D7) ──


def test_the_probe_reads_the_plans_daily_limit_and_nothing_personal(caplog):
    """The user endpoint also returns the account's name, email and payment
    method. Only the plan's figures are kept, and nothing personal reaches the
    status payload or a log line."""
    import json
    import logging

    import httpx

    from api.providers import eodhd as eod
    from api.providers import entitlements

    answer = {
        "name": "Owner Name", "email": "owner@example.com", "subscriptionType": "monthly",
        "paymentMethod": "PayPal", "apiRequests": 1234, "apiRequestsDate": "2026-09-21",
        "dailyRateLimit": 100000, "extraLimit": 0, "inviteToken": "inv-secret", "inviteTokenClicked": 0,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/user":
            return httpx.Response(200, json=answer, request=request)
        return httpx.Response(200, json=[], request=request)

    entitlements.reset_for_tests()
    client = eod.EodhdClient("tok", transport=httpx.MockTransport(handler))
    with caplog.at_level(logging.DEBUG):
        entitlements.probe_all(client, force=True, families=["search"])
    plan = entitlements.plan()
    assert plan == {"subscription": "monthly", "daily_limit": 100000, "requests_on_last_day": 1234,
                    "requests_date": "2026-09-21", "extra_limit": 0, "checked_at": plan["checked_at"]}
    dumped = json.dumps(plan) + caplog.text
    for personal in ("Owner Name", "owner@example.com", "PayPal", "inv-secret"):
        assert personal not in dumped, personal
    entitlements.reset_for_tests()


def test_a_plan_probe_failure_is_a_plain_unknown():
    import httpx

    from api.providers import eodhd as eod
    from api.providers import entitlements

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={}, request=request)

    entitlements.reset_for_tests()
    entitlements.probe_all(eod.EodhdClient("tok", transport=httpx.MockTransport(handler)), force=True, families=["search"])
    assert entitlements.plan() == {"daily_limit": None, "reason": "unauthorized"}
    entitlements.reset_for_tests()
