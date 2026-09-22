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


def test_a_closed_market_costs_six_rest_requests_and_62_units_an_hour():
    """The budget claim in the report, in arithmetic: two loops, each twice an
    hour; a VIX poll is one request for one ticker, a sweep is two requests
    for thirty tickers, and a delayed quote bills per ticker."""
    per_hour = 3600 / stream.CLOSED_REST_SECONDS
    assert per_hour == 2
    fixed = len(stream.US_SYMBOLS) + len(stream.CRYPTO_SYMBOLS) + len(stream.FOREX_SYMBOLS)
    assert fixed == 30
    requests = per_hour * 1 + per_hour * -(-fixed // 15)
    units = per_hour * 1 + per_hour * fixed
    assert (requests, units) == (6, 62)


def test_the_websocket_feeds_are_not_gated_by_the_session():
    """Crypto trades around the clock and WS frames cost no quota, so the
    session must not stop the feeds."""
    hub = stream.QuoteHub()
    assert hub._session_open("crypto", SATURDAY) is True
    assert hub._session_open("us", SATURDAY) is False


@pytest.mark.parametrize("now,expected", [(OPEN, True), (SATURDAY, False)])
def test_rest_interval_is_the_cadence_only_in_session(now, expected):
    assert (stream.rest_interval(60, now) == 60) is expected


# ── the loops themselves, on a simulated clock (verify loop 1, D1) ──────────
# The helpers above could be right while a loop ignored them. These drive the
# real _pace, _vix_loop, _seed_loop and _prefetch_once through a fake clock:
# replacing _pace with a plain sleep, or dropping the session check from the
# prefetch, fails them.

import asyncio  # noqa: E402
from datetime import timedelta  # noqa: E402


class _Clock:
    """A wall clock that only moves when the code under test sleeps."""

    def __init__(self, start: datetime, until: datetime | None = None) -> None:
        self.now, self.until, self.slept = start, until, 0.0

    async def sleep(self, seconds: float) -> None:
        self.slept += seconds
        self.now += timedelta(seconds=seconds)
        if self.until is not None and self.now >= self.until:
            raise asyncio.CancelledError


@pytest.fixture()
def clock(monkeypatch):
    holder: dict = {}

    def install(start: datetime, until: datetime | None = None) -> _Clock:
        c = _Clock(start, until)
        holder["c"] = c
        real = stream.rest_interval
        monkeypatch.setattr(stream.asyncio, "sleep", c.sleep)
        monkeypatch.setattr(stream, "rest_interval", lambda open_s, now=None: real(open_s, now or c.now))
        return c

    return install


def _run(coro) -> None:
    try:
        asyncio.run(coro)
    except asyncio.CancelledError:
        pass


def test_pace_in_session_waits_its_own_cadence(clock):
    c = clock(OPEN)
    _run(stream.QuoteHub()._pace(stream._VIX_POLL_SECONDS))
    assert c.slept == stream._VIX_POLL_SECONDS


def test_pace_outside_the_session_waits_half_an_hour(clock):
    c = clock(SATURDAY)
    _run(stream.QuoteHub()._pace(stream._VIX_POLL_SECONDS))
    assert c.slept == stream.CLOSED_REST_SECONDS


def test_pace_wakes_within_half_a_minute_of_the_opening_bell(clock):
    bell = datetime(2026, 9, 22, 13, 30, tzinfo=timezone.utc)  # Tuesday 09:30 ET
    c = clock(bell - timedelta(minutes=20))
    _run(stream.QuoteHub()._pace(stream._VIX_POLL_SECONDS))
    assert bell <= c.now <= bell + timedelta(seconds=30)


def _count_calls(monkeypatch, hub, method: str) -> list:
    calls: list = []

    async def fake(*args, **kwargs):
        calls.append(1)
        return []

    monkeypatch.setattr(hub, method, fake)
    return calls


@pytest.mark.parametrize("start, hours, most", [(SATURDAY, 2, 5), (OPEN, 1, 61)])
def test_the_vix_loop_polls_at_the_session_cadence(clock, monkeypatch, start, hours, most):
    hub = stream.QuoteHub()
    calls = _count_calls(monkeypatch, hub, "_fetch_rest")
    clock(start, until=start + timedelta(hours=hours))
    _run(hub._vix_loop())
    expected = hours * 3600 / stream.rest_interval(stream._VIX_POLL_SECONDS, start)
    assert expected <= len(calls) <= most


@pytest.mark.parametrize("start, hours, most", [(SATURDAY, 2, 5), (OPEN, 1, 13)])
def test_the_seed_sweep_runs_at_the_session_cadence(clock, monkeypatch, start, hours, most):
    hub = stream.QuoteHub()
    calls = _count_calls(monkeypatch, hub, "_seed_symbols")
    clock(start, until=start + timedelta(hours=hours))
    _run(hub._seed_loop())
    expected = hours * 3600 / stream.rest_interval(stream._SEED_POLL_SECONDS, start)
    assert expected <= len(calls) <= most


def test_the_prefetch_obeys_the_calendar_even_with_a_token(monkeypatch):
    """The worker loop test above patches prefetch_enabled itself; this one
    patches only the calendar, so the loop's own session check is what is
    tested, with a token configured."""
    calls = {"n": 0}
    monkeypatch.setattr(worker_mod, "prefetch_tick", lambda: calls.__setitem__("n", calls["n"] + 1))
    monkeypatch.setattr(worker_mod, "_prefetch_has_token", lambda: True)
    w = worker_mod.AnalyticsWorker(items=[], preload=False, prefetch=True, poll_s=0.01)
    monkeypatch.setattr(cal, "session_state", lambda now=None: {"is_open": False})
    w._next_prefetch = 0.0
    w._prefetch_once()
    assert calls["n"] == 0
    monkeypatch.setattr(cal, "session_state", lambda now=None: {"is_open": True})
    w._next_prefetch = 0.0
    w._prefetch_once()
    assert calls["n"] == 1


# ── VIX is not "silent" for polling at its own closed cadence (D2) ──────────


def _vix_hub(age_s: float) -> stream.QuoteHub:
    hub = stream.QuoteHub()
    hub.feeds["vix"] = "rest"
    hub._last_frame_mono["vix"] = 1_000_000.0 - age_s
    return hub


@pytest.mark.parametrize("now, age_s, stale", [
    (SATURDAY, 20 * 60, False),        # a closed market polls half-hourly
    (SATURDAY, 2 * 3600, True),        # three missed half-hours is silence
    (OPEN, 4 * 60, True),              # in session the allowance is 3 × 60 s
    (OPEN, 2 * 60, False),
    (datetime(2026, 9, 22, 13, 30, 10, tzinfo=timezone.utc), 20 * 60, False),  # 10 s after the bell, polled before it
])
def test_vix_staleness_follows_its_cadence(now, age_s, stale):
    assert _vix_hub(age_s).stale_flags(now=now, mono=1_000_000.0)["vix"] is stale


# ── a failing prefetch backs off (D4) ────────────────────────────────────────


def test_a_failing_prefetch_backs_off_instead_of_retrying_every_tick(monkeypatch):
    from api.providers import market
    from api.providers.errors import ProviderUnavailable

    attempts: list[str] = []

    def fail(sym, rk, margin):
        attempts.append(sym)
        raise ProviderUnavailable("eodhd", "down")

    monkeypatch.setattr(market, "refresh_candles", fail)
    now = {"t": 1000.0}
    monkeypatch.setattr(worker_mod.time, "monotonic", lambda: now["t"])
    worker_mod.reset_prefetch_backoff()
    # One simulated session hour of ten-second ticks against a dead provider.
    for _ in range(360):
        worker_mod.prefetch_tick()
        now["t"] += worker_mod.PREFETCH_EVERY_S
    per_symbol = len(attempts) / len(worker_mod.PREFETCH_SYMBOLS)
    assert per_symbol <= 6, per_symbol  # 0, 2, 6, 14, 30, 60 min at the cap: not 360
    worker_mod.reset_prefetch_backoff()


def test_a_recovered_prefetch_forgets_its_backoff(monkeypatch):
    from api.providers import market
    from api.providers.errors import ProviderUnavailable

    state = {"down": True, "calls": 0}

    def flaky(sym, rk, margin):
        state["calls"] += 1
        if state["down"]:
            raise ProviderUnavailable("eodhd", "down")
        return True

    monkeypatch.setattr(market, "refresh_candles", flaky)
    now = {"t": 1000.0}
    monkeypatch.setattr(worker_mod.time, "monotonic", lambda: now["t"])
    worker_mod.reset_prefetch_backoff()
    worker_mod.prefetch_tick()
    state["down"] = False
    now["t"] += worker_mod.PREFETCH_BACKOFF_BASE_S + 1
    assert worker_mod.prefetch_tick() == len(worker_mod.PREFETCH_SYMBOLS)
    now["t"] += worker_mod.PREFETCH_EVERY_S
    before = state["calls"]
    worker_mod.prefetch_tick()
    assert state["calls"] - before == len(worker_mod.PREFETCH_SYMBOLS), "no backoff left after a success"
    worker_mod.reset_prefetch_backoff()


# ── loop-2 pins (the verifier's surviving mutants) ──────────────────────────


def test_pace_wakes_within_half_a_minute_from_any_start(clock):
    """A start that is not a multiple of any re-check period: only a 30 s
    re-check lands within half a minute of the bell (a 300 s one would not)."""
    bell = datetime(2026, 9, 22, 13, 30, tzinfo=timezone.utc)
    c = clock(bell - timedelta(minutes=20, seconds=7))
    _run(stream.QuoteHub()._pace(stream._VIX_POLL_SECONDS))
    assert bell <= c.now <= bell + timedelta(seconds=30), c.now


def test_a_poll_from_the_last_minute_of_the_session_is_not_silent_after_the_close():
    """Polled at 15:59:30 ET, read at 16:05: the allowance is the longer of
    the two cadences, so the closed half-hour one applies."""
    close = datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc)  # Tuesday 16:00 ET
    now = close + timedelta(minutes=5)
    age = (now - (close - timedelta(seconds=30))).total_seconds()
    assert _vix_hub(age).stale_flags(now=now, mono=1_000_000.0)["vix"] is False


def test_every_retry_is_counted_in_the_quota():
    """Three billed attempts are three requests and three weights."""
    import httpx

    from api.providers import eodhd as eod
    from api.providers import quota
    from api.providers.errors import ProviderError

    quota.reset()
    client = eod.EodhdClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(503, json={}, request=r)))
    client.max_retries = 2
    client.backoff = 0.0
    with pytest.raises(ProviderError):
        client.intraday("AAPL.US", interval="5m", from_ts=1, to_ts=2)
    snap = quota.snapshot(elapsed_override_s=3600)
    assert snap["requests"] == 3 and snap["units"] == 15
    quota.reset()
