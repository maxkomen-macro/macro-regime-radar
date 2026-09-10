"""Publication gates (api/security.py): body caps, rate limits, the assistant
access gate, concurrency ceilings and security headers — exercised on a tiny
app so the limits can be small and the assertions exact."""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import security


def _app(**opts) -> FastAPI:
    app = FastAPI()

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.post("/api/echo")
    def echo(body: dict):
        return body

    @app.post("/api/assistant/ask")
    def ask(body: dict):
        return {"answer": "stub"}

    @app.get("/static/x")
    def static():
        return {"static": True}

    app.add_middleware(security.SecurityMiddleware, **opts)
    return app


def test_per_client_rate_limit_and_retry_after():
    c = TestClient(_app(per_client_per_min=3, per_client_burst=3, global_per_min=1000))
    assert [c.get("/api/thing").status_code for _ in range(3)] == [200, 200, 200]
    r = c.get("/api/thing")
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1
    assert "slow down" in r.json()["detail"]
    # Static paths are never rate limited.
    assert c.get("/static/x").status_code == 200


def test_global_rate_limit():
    c = TestClient(_app(per_client_per_min=1000, per_client_burst=1000, global_per_min=2))
    assert c.get("/api/thing").status_code == 200
    assert c.get("/api/thing").status_code == 200
    assert c.get("/api/thing").status_code == 429


def test_body_cap_413():
    c = TestClient(_app(max_body=64))
    ok = c.post("/api/echo", json={"a": 1})
    assert ok.status_code == 200
    big = c.post("/api/echo", content=json.dumps({"a": "x" * 500}), headers={"content-type": "application/json"})
    assert big.status_code == 413


def test_security_headers_on_every_response():
    c = TestClient(_app())
    for path in ("/api/thing", "/static/x"):
        h = c.get(path).headers
        assert h["x-content-type-options"] == "nosniff"
        assert h["x-frame-options"] == "DENY"
        assert "referrer-policy" in h and "permissions-policy" in h


def test_assistant_gate_off_and_key(monkeypatch):
    c = TestClient(_app())
    monkeypatch.setenv("ASSISTANT_ACCESS", "off")
    r = c.post("/api/assistant/ask", json={"q": "hi"})
    assert r.status_code == 503 and "disabled" in r.json()["detail"]
    monkeypatch.setenv("ASSISTANT_ACCESS", "key")
    monkeypatch.setenv("ASSISTANT_ACCESS_KEY", "letmein")
    assert c.post("/api/assistant/ask", json={"q": "hi"}).status_code == 401
    ok = c.post("/api/assistant/ask", json={"q": "hi"}, headers={"x-assistant-key": "letmein"})
    assert ok.status_code == 200 and ok.headers["cache-control"] == "no-store"
    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    assert c.post("/api/assistant/ask", json={"q": "hi"}).status_code == 200


def test_assistant_default_is_off_on_a_public_origin_set(monkeypatch):
    monkeypatch.delenv("ASSISTANT_ACCESS", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert security.assistant_mode() == "open"
    monkeypatch.setenv("CORS_ORIGINS", "https://radar.example.com")
    assert security.assistant_mode() == "off"


def test_assistant_tight_rate_limit(monkeypatch):
    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    c = TestClient(_app(assistant_per_min=2))
    assert c.post("/api/assistant/ask", json={"q": "1"}).status_code == 200
    assert c.post("/api/assistant/ask", json={"q": "2"}).status_code == 200
    assert c.post("/api/assistant/ask", json={"q": "3"}).status_code == 429


def test_expensive_concurrency_ceiling():
    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, expensive_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    scope = {"type": "http", "path": "/api/allocation", "method": "GET", "headers": [], "client": ("1.2.3.4", 1)}
    assert mw.expensive.acquire(blocking=False)  # simulate a calculation in flight
    try:
        asyncio.run(mw(scope, receive, send))
    finally:
        mw.expensive.release()
    assert sent[0]["status"] == 429 and mw.stats["busy"] == 1
    sent.clear()
    asyncio.run(mw(scope, receive, send))
    assert sent[0]["status"] == 200


def test_rate_limiter_refills():
    rl = security.RateLimiter(per_minute=6000, burst=1)
    assert rl.take("a")[0] is True
    assert rl.take("a")[0] is False
    import time

    time.sleep(0.02)  # 100/s refill → a token is back
    assert rl.take("a")[0] is True


def test_client_id_ignores_forwarded_for_unless_hops_configured():
    scope = {"client": ("203.0.113.9", 5), "headers": [(b"x-forwarded-for", b"1.1.1.1, 10.0.0.2, 203.0.113.9")]}
    assert security.client_id_from(scope, 0) == "203.0.113.9"
    # One trusted proxy: the entry it appended is the last one, never the client-supplied first.
    assert security.client_id_from(scope, 1) == "203.0.113.9"
    assert security.client_id_from(scope, 2) == "10.0.0.2"
    # Fewer entries than hops → fall back to the socket peer.
    assert security.client_id_from({"client": ("9.9.9.9", 1), "headers": [(b"x-forwarded-for", b"1.1.1.1")]}, 3) == "9.9.9.9"


def test_spoofed_forwarded_for_cannot_reset_the_bucket(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    c = TestClient(_app(per_client_per_min=3, per_client_burst=3, global_per_min=1000))
    # Behind one trusted proxy the header ends with the address the proxy
    # appended; whatever the client put in front of it is ignored.
    codes = [c.get("/api/thing", headers={"x-forwarded-for": f"10.0.0.{i}, 198.51.100.7"}).status_code for i in range(6)]
    assert codes == [200, 200, 200, 429, 429, 429]


def test_trusted_proxy_hops_alias(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    monkeypatch.setenv("TRUST_X_FORWARDED_FOR", "1")
    assert security.trusted_proxy_hops() == 1
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert security.trusted_proxy_hops() == 2


def test_db_ceiling_sheds_load_with_429():
    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, db_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    scope = {"type": "http", "path": "/api/regime/latest", "method": "GET", "headers": [], "client": ("1.2.3.4", 1)}
    assert mw.db.acquire(blocking=False)
    try:
        asyncio.run(mw(scope, receive, send))
    finally:
        mw.db.release()
    assert sent[0]["status"] == 429
    sent.clear()
    asyncio.run(mw({**scope, "path": "/health/live"}, receive, send))
    assert sent[0]["status"] == 200  # liveness is never shed


def test_websocket_connection_caps():
    events: list[dict] = []

    async def inner(scope, receive, send):
        await send({"type": "websocket.accept"})
        msg = await receive()  # wait for disconnect
        assert msg["type"] == "websocket.disconnect"

    mw = security.SecurityMiddleware(inner, ws_per_client=1, ws_total=10)

    async def run():
        scope = {"type": "websocket", "path": "/api/stream/ws", "headers": [], "client": ("1.2.3.4", 1)}
        hold = asyncio.Event()

        async def receive_first():
            await hold.wait()
            return {"type": "websocket.disconnect"}

        async def send_first(msg):
            events.append(("first", msg))

        first = asyncio.create_task(mw(scope, receive_first, send_first))
        await asyncio.sleep(0.05)
        assert mw.ws_active_total() == 1

        async def receive_second():
            return {"type": "websocket.disconnect"}

        second_events = []

        async def send_second(msg):
            second_events.append(msg)

        await mw(scope, receive_second, send_second)  # same client, over the per-client cap
        assert second_events == [{"type": "websocket.close", "code": 1013}]
        hold.set()
        await first
        assert mw.ws_active_total() == 0
        assert mw.stats["ws_refused"] == 1

    asyncio.run(run())

