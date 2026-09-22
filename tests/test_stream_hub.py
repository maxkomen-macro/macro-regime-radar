"""EODHD relay hardening (api/stream.py): feed routing for dynamic symbols,
stale-tick detection, the degraded verdict, bounded dynamic subscriptions and
a debug payload that never carries the token."""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from api import stream
from api.main import app


@pytest.mark.parametrize(
    "sym, feed",
    [("AMZN", "us"), ("BRK-B", "us"), ("BRK.B", "us"), ("AAPL.US", "us"), ("BTC-USD", "crypto"), ("ETH-USD", "crypto"), ("EURUSD", "forex"), ("GBPUSD", "forex"), ("VIX.INDX", None), ("^VIX", None), ("DROP TABLE", None)],
)
def test_feed_for_symbol(sym, feed):
    assert stream.feed_for_symbol(sym) == feed


def _hub(token="sekrit-token-value"):
    h = stream.QuoteHub()
    h.token = token
    return h


def test_degraded_without_token():
    h = _hub(None)
    degraded, reasons = h.degraded()
    assert degraded and "EODHD_API_TOKEN" in reasons[0]


def test_stale_detection_only_during_session(monkeypatch):
    h = _hub()
    h.feeds["us"] = "open"
    monkeypatch.setattr(h, "_session_open", lambda feed, now=None: True)
    assert h.stale_flags()["us"] is True  # open, trading, never a frame
    h._mark_frame("us")
    assert h.stale_flags()["us"] is False
    h._last_frame_mono["us"] = time.monotonic() - 1000
    assert h.stale_flags()["us"] is True
    assert h.degraded()[0] is True
    monkeypatch.setattr(h, "_session_open", lambda feed, now=None: False)
    assert h.stale_flags()["us"] is False  # closed session: silence is normal


def test_debug_payload_has_no_token_and_counts_subscriptions():
    h = _hub()
    h.stats["feed_last_error"]["us"] = h._redact("boom sekrit-token-value boom")
    d = h.debug()
    text = json.dumps(d)
    assert "sekrit-token-value" not in text
    assert d["subscriptions"]["fixed"] == {"us": 26, "crypto": 2, "forex": 2}
    assert d["subscriptions"]["dynamic_max"] == stream.MAX_DYNAMIC_SYMBOLS
    assert set(d) >= {"feeds", "feed_stale", "degraded", "degraded_reasons", "reconnect_backoff_s", "feed_last_frame_at", "session"}


def test_watch_is_bounded_and_rejects_unstreamable(monkeypatch):
    h = _hub()
    monkeypatch.setattr(stream, "MAX_DYNAMIC_SYMBOLS", 2)

    class FakeWS:  # a watcher identity only
        pass

    async def run():
        assert await h.watch("SPY", None) is True  # fixed universe: free
        assert await h.watch("VIX.INDX", None) is False  # not streamable
        a, b = FakeWS(), FakeWS()
        assert await h.watch("AMZN", a) is True  # fixed universe member: no dynamic slot used
        assert "AMZN" not in h._dynamic
        assert await h.watch("SNOW", a) is True
        assert await h.watch("PLTR", b) is True
        assert await h.watch("CRWD", FakeWS()) is False  # budget spent, both watched
        await h.unwatch("SNOW", a)
        assert await h.watch("CRWD", FakeWS()) is True  # idle symbol evicted
        assert "SNOW" not in h._dynamic and set(h._dynamic) == {"PLTR", "CRWD"}
        await h._drop_watcher(b)
        assert not h._dynamic["PLTR"]["watchers"]
        h._dynamic["PLTR"]["last_seen"] -= stream.DYNAMIC_IDLE_SECONDS + 1
        await h._expire_dynamic()
        assert "PLTR" not in h._dynamic

    asyncio.run(run())
    assert h.stats["dynamic_rejected"] == 2


def test_browser_protocol_snapshot_and_watch():
    c = TestClient(app)
    hub = stream.hub
    with c.websocket_connect("/api/stream/ws") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and "feeds" in snap and "stale" in snap and "degraded" in snap
        ws.send_json({"action": "watch", "symbols": ["PLTR"]})
        for _ in range(50):
            if "PLTR" in hub._dynamic:
                break
            time.sleep(0.02)
        assert "PLTR" in hub._dynamic
        ws.send_json({"action": "nonsense", "symbols": "x"})  # ignored, never closes the socket
        ws.send_json({"action": "unwatch", "symbols": ["PLTR"]})
    # Disconnect drops the watcher; the symbol lingers until idle expiry.
    for _ in range(50):
        if not hub._dynamic.get("PLTR", {}).get("watchers"):
            break
        time.sleep(0.02)
    assert not hub._dynamic.get("PLTR", {}).get("watchers")
    hub._dynamic.pop("PLTR", None)


def test_per_connection_symbol_budget(monkeypatch):
    h = _hub()
    from api.providers.cache import TokenBucket

    class FakeWS:
        pass

    async def run():
        ws = FakeWS()
        budget = TokenBucket(rate=0.0, burst=2)
        for s in ("PLTR", "SNOW", "CRWD", "NET"):
            await h._handle_client_message(ws, {"action": "watch", "symbols": [s]}, budget)
        assert set(h._dynamic) == {"PLTR", "SNOW"}  # two new symbols per budget, the rest dropped
        # Fixed-universe and already-known symbols cost nothing.
        await h._handle_client_message(ws, {"action": "watch", "symbols": ["AAPL", "PLTR"]}, budget)
        assert set(h._dynamic) == {"PLTR", "SNOW"}

    asyncio.run(run())
    assert h.stats["dynamic_rejected"] == 2


# ── upstream reconnect backoff ───────────────────────────────────────────────


class _FakeWS:
    """Minimal stand-in for a websockets connection: records sends, yields frames."""

    def __init__(self, frames):
        self._frames = list(frames)
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._frames:
            raise StopAsyncIteration
        return self._frames.pop(0)


class _FakeConnect:
    def __init__(self, ws):
        self._ws = ws

    async def __aenter__(self):
        return self._ws

    async def __aexit__(self, *exc):
        return False


def _run_feed_with_upstream(monkeypatch, per_connection_frames, max_sleeps):
    """Drive QuoteHub._run_feed against scripted upstream answers.

    Each entry in ``per_connection_frames`` is the list of JSON frames one
    connection yields before the socket ends. Returns the sleep delays the loop
    requested between connections (random jitter patched to zero).
    """
    import types

    h = _hub()
    queue = [list(f) for f in per_connection_frames]
    delays: list[float] = []

    def fake_connect(url, **kwargs):
        assert h.token not in delays  # never leaks; keeps the token off the list
        frames = queue.pop(0) if queue else []
        return _FakeConnect(_FakeWS([json.dumps(f) for f in frames]))

    async def fake_sleep(delay):
        delays.append(delay)
        if len(delays) >= max_sleeps:
            raise asyncio.CancelledError

    patched_asyncio = types.SimpleNamespace(**vars(asyncio))
    patched_asyncio.sleep = fake_sleep
    monkeypatch.setattr(stream, "asyncio", patched_asyncio)
    monkeypatch.setattr(stream.websockets, "connect", fake_connect)
    monkeypatch.setattr(stream.random, "random", lambda: 0.0)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(h._run_feed("us"))
    return h, delays


def test_refused_subscription_backs_off_exponentially(monkeypatch):
    """A 422 (symbols limit) after the socket opens must not reconnect every
    second forever — the backoff has to grow until EODHD accepts again."""
    refused = {"status_code": 422, "message": "Symbols limit reached"}
    h, delays = _run_feed_with_upstream(monkeypatch, [[refused]] * 4, max_sleeps=4)
    assert delays == [1.0, 2.0, 4.0, 8.0]
    assert h.stats["feed_last_error"]["us"] == "status 422: Symbols limit reached"
    assert h.feeds["us"] == "closed"


def test_accepted_subscription_resets_backoff(monkeypatch):
    """Only an accepted subscription (the 200 ack or a tick) resets the backoff;
    a plain socket open does not."""
    refused = {"status_code": 422, "message": "Symbols limit reached"}
    accepted = {"status_code": 200, "message": "Authorized"}
    _, delays = _run_feed_with_upstream(monkeypatch, [[refused], [refused], [accepted], [refused]], max_sleeps=4)
    assert delays == [1.0, 2.0, 1.0, 2.0]



# ── BH2: live_quotes.as_of is a US quote's own timestamp ─────────────────────
# The US socket keeps delivering frames outside the session (acks, heartbeats,
# after-hours prints), and _mark_frame stamps arrival wall-clock, so on a Sunday
# the feed dated itself Sunday while the last US print was Friday's close.


def _ms(y, m, d, hh=20, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc).timestamp() * 1000.0


def test_us_tick_stamp_reads_the_quote_not_the_frame_arrival():
    h = _hub()
    h._handle_tick("us", {"s": "SPY", "p": 660.0, "t": _ms(2026, 9, 18)})
    h._handle_tick("crypto", {"s": "BTC-USD", "p": 64000.0, "t": _ms(2026, 9, 20, 21, 23)})
    h._mark_frame("us")  # an ack or heartbeat on the US socket, no quote in it
    d = h.debug()
    assert d["feed_last_tick_at"]["us"] == "2026-09-18T20:00:00Z"
    assert d["feed_last_tick_at"]["crypto"] == "2026-09-20T21:23:00Z"
    # Arrival time is still tracked — stale_flags and the reconnect logic need it.
    assert d["feed_last_frame_at"]["us"] is not None


def test_the_us_tick_stamp_never_goes_backwards_and_vix_stays_its_own_feed():
    h = _hub()
    h._handle_tick("us", {"s": "SPY", "p": 660.0, "t": _ms(2026, 9, 18)})
    h._handle_tick("us", {"s": "AAPL", "p": 240.0, "t": _ms(2026, 9, 17)})  # a late frame
    assert h.debug()["feed_last_tick_at"]["us"] == "2026-09-18T20:00:00Z"
    # A delayed VIX poll is not a US print.
    h._store_rest_quote({"code": "VIX.INDX", "close": 15.4, "timestamp": _ms(2026, 9, 20, 22, 40) / 1000.0}, delayed=True)
    assert h.debug()["feed_last_tick_at"]["us"] == "2026-09-18T20:00:00Z"
    assert h.debug()["feed_last_tick_at"]["vix"] == "2026-09-20T22:40:00Z"


def test_a_rest_seeded_us_close_dates_the_feed_from_the_close():
    h = _hub()
    h._store_rest_quote({"code": "SPY.US", "close": 660.0, "timestamp": _ms(2026, 9, 18) / 1000.0}, delayed=True)
    assert h.debug()["feed_last_tick_at"]["us"] == "2026-09-18T20:00:00Z"


def test_a_future_dated_upstream_timestamp_never_pins_the_feed_forward():
    """The stamp only moves forward, so one bad upstream tick would otherwise
    date the feed into the future for the life of the process. Anything beyond
    two days ahead is a clock or parse fault, the same rule api/freshness.py
    applies to a stamp it is handed."""
    h = _hub()
    h._handle_tick("us", {"s": "SPY", "p": 660.0, "t": (time.time() + 9 * 86400) * 1000.0})
    assert h.debug()["feed_last_tick_at"]["us"] is None
    h._handle_tick("us", {"s": "SPY", "p": 660.0, "t": _ms(2026, 9, 18)})
    assert h.debug()["feed_last_tick_at"]["us"] == "2026-09-18T20:00:00Z"
