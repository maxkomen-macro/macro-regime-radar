"""tests/test_session_gating.py — EODHD timers follow the US session (launch-1).

Idle, the server used to spend the same quota at 3 a.m. on a Sunday as at
10 a.m. on a Tuesday: the market prefetch every ~102 s per symbol, the relay's
delayed-quote sweep every 5 minutes and its VIX poll every minute, around the
clock. Outside the session there is nothing new to fetch, so the prefetch stops
and the REST refreshes drop to once every 30 minutes. The WebSocket feeds,
which cost no quota, keep running.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api import calendar as cal
from api import stream
from api import worker as worker_mod

# Reference instants (UTC). The NYSE session runs 09:30–16:00 New York.
OPEN = datetime(2026, 9, 22, 15, 0, tzinfo=timezone.utc)        # Tuesday 11:00 ET
PRE_OPEN = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)    # Tuesday 08:00 ET
AFTER_CLOSE = datetime(2026, 9, 22, 21, 30, tzinfo=timezone.utc)  # Tuesday 17:30 ET
SATURDAY = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
HOLIDAY = datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc)    # Thanksgiving
EARLY_CLOSE_AFTER = datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc)  # 13:30 ET, after the 13:00 close


def test_the_reference_instants_are_what_the_calendar_says():
    assert cal.session_state(OPEN)["is_open"] is True
    for closed in (PRE_OPEN, AFTER_CLOSE, SATURDAY, HOLIDAY, EARLY_CLOSE_AFTER):
        assert cal.session_state(closed)["is_open"] is False, closed


# ── the market prefetch ──────────────────────────────────────────────────────


def test_prefetch_runs_only_while_the_session_is_open():
    assert worker_mod.prefetch_enabled(OPEN) is True
    for closed in (PRE_OPEN, AFTER_CLOSE, SATURDAY, HOLIDAY, EARLY_CLOSE_AFTER):
        assert worker_mod.prefetch_enabled(closed) is False, closed


def test_the_worker_loop_skips_the_prefetch_outside_the_session(monkeypatch):
    """The guard is in the loop, not only in a helper: a closed market makes
    no provider call at all."""
    calls = {"n": 0}
    monkeypatch.setattr(worker_mod, "prefetch_tick", lambda: calls.__setitem__("n", calls["n"] + 1))
    monkeypatch.setattr(worker_mod, "prefetch_enabled", lambda now=None: False)

    w = worker_mod.AnalyticsWorker(items=[], preload=False, prefetch=True, poll_s=0.01)
    w._next_prefetch = 0.0
    w._prefetch_once()
    assert calls["n"] == 0

    monkeypatch.setattr(worker_mod, "prefetch_enabled", lambda now=None: True)
    monkeypatch.setattr(worker_mod, "_prefetch_has_token", lambda: True)
    w._next_prefetch = 0.0
    w._prefetch_once()
    assert calls["n"] == 1


# ── the relay's REST refreshes ───────────────────────────────────────────────


def test_rest_cadence_slows_to_half_hourly_outside_the_session():
    assert stream.rest_interval(stream._VIX_POLL_SECONDS, OPEN) == stream._VIX_POLL_SECONDS
    assert stream.rest_interval(stream._SEED_POLL_SECONDS, OPEN) == stream._SEED_POLL_SECONDS
    for closed in (PRE_OPEN, AFTER_CLOSE, SATURDAY, HOLIDAY, EARLY_CLOSE_AFTER):
        assert stream.rest_interval(stream._VIX_POLL_SECONDS, closed) == stream.CLOSED_REST_SECONDS, closed
        assert stream.rest_interval(stream._SEED_POLL_SECONDS, closed) == stream.CLOSED_REST_SECONDS, closed
    assert stream.CLOSED_REST_SECONDS >= 1800


def test_a_closed_market_costs_at_most_four_rest_calls_an_hour():
    """The budget claim in the report, in arithmetic: two loops, each at most
    twice an hour, and the sweep is two requests."""
    per_hour = 3600 / stream.CLOSED_REST_SECONDS
    assert per_hour <= 2
    vix_calls = per_hour  # one ticker
    seed_calls = per_hour * 2  # 30 tickers in batches of 15
    assert vix_calls + seed_calls <= 6


def test_the_websocket_feeds_are_not_gated_by_the_session():
    """Crypto trades around the clock and WS frames cost no quota, so the
    session must not stop the feeds."""
    hub = stream.QuoteHub()
    assert hub._session_open("crypto", SATURDAY) is True
    assert hub._session_open("us", SATURDAY) is False


@pytest.mark.parametrize("now,expected", [(OPEN, True), (SATURDAY, False)])
def test_pace_waits_longer_when_the_market_is_closed(now, expected):
    assert (stream.rest_interval(60, now) == 60) is expected
