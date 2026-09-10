"""EODHD relay hardening (api/stream.py): feed routing for dynamic symbols,
stale-tick detection, the degraded verdict, bounded dynamic subscriptions and
a debug payload that never carries the token."""

from __future__ import annotations

import asyncio
import json
import time

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
