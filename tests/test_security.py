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

    @app.get("/api/assistant/status")
    def status():
        return {"resting": False}

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

    # fix/prelaunch-1: allocation is a lookup of a worker-built result now; the
    # calculators (the visitor's own inputs) keep the expensive ceiling.
    assert "/api/allocation" not in security.EXPENSIVE_PATHS and "/api/recession/probability" not in security.EXPENSIVE_PATHS
    scope = {"type": "http", "path": "/api/lbo/run", "method": "POST", "headers": [], "client": ("1.2.3.4", 1)}
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



# ── launch-1: the gates at their production values ──────────────────────────
# The tests above use small limits so the assertions can be exact. These pin
# the numbers a public deploy actually runs with: a default-constructed
# middleware, no environment overrides.


@pytest.fixture()
def production_env(monkeypatch):
    """No overrides: what the container gets when the host sets none of them."""
    for var in ("RATE_LIMIT_PER_CLIENT_PER_MIN", "RATE_LIMIT_PER_CLIENT_BURST",
                "RATE_LIMIT_GLOBAL_PER_MIN", "RATE_LIMIT_GLOBAL_BURST",
                "DB_MAX_CONCURRENCY", "DESK_STUDY_MAX_CONCURRENCY", "WS_MAX_PER_CLIENT", "WS_MAX_TOTAL", "MAX_BODY_BYTES"):
        monkeypatch.delenv(var, raising=False)
    yield


def test_production_defaults_are_the_documented_numbers(production_env):
    mw = security.SecurityMiddleware(lambda *a: None)
    assert (mw.client_limiter.rate * 60, mw.client_limiter.burst) == (pytest.approx(600.0), 120.0)
    assert (mw.global_limiter.rate * 60, mw.global_limiter.burst) == (pytest.approx(4000.0), 600.0)
    assert (mw.assistant_limiter.rate * 60, mw.assistant_limiter.burst) == (pytest.approx(10.0), 10.0)
    assert (mw.assistant_global.rate * 60, mw.assistant_global.burst) == (pytest.approx(60.0), 60.0)
    assert mw.expensive._initial_value == 4
    assert mw.provider._initial_value == 12
    assert mw.db._initial_value == 24
    assert mw.desk_study._initial_value == 4  # desk/integration: the event study's own ceiling
    assert (mw.ws_per_client, mw.ws_total) == (20, 200)
    assert mw.max_body == 64 * 1024
    assert security.ASSISTANT_MAX_BODY_BYTES == 16 * 1024
    assert mw.client_limiter.max_clients == 4096
    assert mw.hops == 0


def test_body_caps_at_production_size(production_env):
    client = TestClient(_app())
    assert client.post("/api/echo", content=b"x" * (64 * 1024 + 1), headers={"content-type": "application/json"}).status_code == 413
    assert client.post("/api/assistant/ask", content=b"x" * (16 * 1024 + 1), headers={"content-type": "application/json"}).status_code == 413


def test_per_client_burst_at_production_size(production_env):
    """121 requests in a burst: the production bucket admits 120 plus what a
    tenth of a second refills, then sheds with 429 and a Retry-After."""
    client = TestClient(_app())
    codes = [client.get("/api/thing").status_code for _ in range(160)]
    assert codes[0] == 200 and codes.count(200) >= 120
    assert 429 in codes, "the production burst must shed beyond its size"
    first_429 = codes.index(429)
    assert first_429 >= 120
    r = client.get("/api/thing")
    if r.status_code == 429:
        assert int(r.headers["retry-after"]) >= 1


def test_assistant_rate_limit_at_production_size(production_env, monkeypatch):
    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    client = TestClient(_app())
    codes = [client.post("/api/assistant/ask", json={"m": 1}).status_code for _ in range(12)]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429 or codes[11] == 429


# ── launch-1: the relay socket's Origin allowlist ───────────────────────────


def _ws_scope(origin: str | None, host: str = "api.example.com"):
    headers = [(b"host", host.encode())]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    return {"type": "websocket", "path": "/api/stream/ws", "headers": headers, "client": ("1.2.3.4", 1)}


def _ws_attempt(mw, scope) -> list:
    sent: list = []

    async def receive():
        return {"type": "websocket.disconnect"}

    async def send(msg):
        sent.append(msg)

    asyncio.run(mw(scope, receive, send))
    return sent


def _accepting_app():
    async def inner(scope, receive, send):
        await send({"type": "websocket.accept"})
        await receive()

    return inner


def test_relay_socket_refuses_a_foreign_origin(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://radar.example.com")
    mw = security.SecurityMiddleware(_accepting_app())
    assert _ws_attempt(mw, _ws_scope("https://radar.example.com"))[0]["type"] == "websocket.accept"
    for hostile in ("https://evil.example", "http://radar.example.com", "null"):
        sent = _ws_attempt(mw, _ws_scope(hostile))
        assert sent == [{"type": "websocket.close", "code": 1008}], hostile
    assert mw.stats["ws_origin_refused"] == 3


def test_relay_socket_allows_a_client_that_sends_no_origin(monkeypatch):
    """Browsers always send Origin; curl and the smoke script do not, and they
    are not the cross-site risk the allowlist exists for."""
    monkeypatch.setenv("CORS_ORIGINS", "https://radar.example.com")
    mw = security.SecurityMiddleware(_accepting_app())
    assert _ws_attempt(mw, _ws_scope(None))[0]["type"] == "websocket.accept"


def test_relay_socket_in_development_allows_localhost_only(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    mw = security.SecurityMiddleware(_accepting_app())
    for dev in ("http://localhost:5173", "http://127.0.0.1:5180", "http://localhost:4173"):
        assert _ws_attempt(mw, _ws_scope(dev))[0]["type"] == "websocket.accept", dev
    assert _ws_attempt(mw, _ws_scope("https://evil.example")) == [{"type": "websocket.close", "code": 1008}]


def test_relay_socket_allows_the_same_origin_it_is_served_from(monkeypatch):
    """The single-service deploy serves the bundle and the socket from one
    origin, and sets no CORS_ORIGINS."""
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    mw = security.SecurityMiddleware(_accepting_app())
    scope = _ws_scope("https://radar.example.com", host="radar.example.com")
    assert _ws_attempt(mw, scope)[0]["type"] == "websocket.accept"



# ── launch-1 verify loop 1: identity, keys and origins ──────────────────────


def test_every_forwarded_for_line_counts(monkeypatch):
    """Defect 5: RFC 9110 treats repeated header lines as one comma-joined
    list. Reading only the first line let a client pick its own key by
    sending a line of its own ahead of the proxy's."""
    scope = {"client": ("10.0.0.1", 5), "headers": [
        (b"x-forwarded-for", b"6.6.6.6"),
        (b"x-forwarded-for", b"198.51.100.7"),
    ]}
    assert security.client_id_from(scope, 1) == "198.51.100.7"
    assert security.client_id_from(scope, 2) == "6.6.6.6"

    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    c = TestClient(_app(per_client_per_min=3, per_client_burst=3, global_per_min=1000))
    codes = [
        c.get("/api/thing", headers=[("x-forwarded-for", f"10.9.9.{i}"), ("x-forwarded-for", "198.51.100.7")]).status_code
        for i in range(6)
    ]
    assert codes == [200, 200, 200, 429, 429, 429]


def test_a_non_ascii_assistant_key_is_refused_not_a_crash(monkeypatch):
    """Defect 6: a raw header byte such as 0xE9 made hmac.compare_digest
    raise, which surfaced as a 500 with a logged traceback."""
    monkeypatch.setenv("ASSISTANT_ACCESS", "key")
    monkeypatch.setenv("ASSISTANT_ACCESS_KEY", "s3cret")
    c = TestClient(_app())
    assert c.post("/api/assistant/ask", json={"m": 1}, headers={"x-assistant-key": b"caf\xe9"}).status_code == 401
    assert c.post("/api/assistant/ask", json={"m": 1}, headers={"x-assistant-key": "s3cret"}).status_code == 200


def test_keys_match_compares_bytes_in_constant_time():
    assert security.keys_match("s3cret", "s3cret") is True
    assert security.keys_match(b"s3cret", "s3cret") is True
    assert security.keys_match("caf\xe9", "s3cret") is False
    assert security.keys_match(b"caf\xe9", "caf\xe9") is False  # latin-1 bytes are not the UTF-8 key
    assert security.keys_match("s3cret", "") is False
    assert security.keys_match("", "") is False


def test_a_public_single_service_deploy_allows_only_its_own_origin(monkeypatch):
    """Defect 7: with DEPLOY_PUBLIC=1 and no CORS_ORIGINS (the documented
    single-service fallback), localhost is somebody else's machine."""
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setenv("DEPLOY_PUBLIC", "1")
    mw = security.SecurityMiddleware(_accepting_app())
    own = _ws_scope("https://radar.example.com", host="radar.example.com")
    assert _ws_attempt(mw, own)[0]["type"] == "websocket.accept"
    for foreign in ("http://localhost:5173", "http://127.0.0.1:8080", "https://evil.example"):
        assert _ws_attempt(mw, _ws_scope(foreign, host="radar.example.com")) == [{"type": "websocket.close", "code": 1008}], foreign


def test_two_origin_headers_are_refused(monkeypatch):
    """A browser sends one Origin. Two is a crafted request, and first-wins
    used to let the second one ride along."""
    monkeypatch.setenv("CORS_ORIGINS", "https://radar.example.com")
    mw = security.SecurityMiddleware(_accepting_app())
    scope = _ws_scope("https://radar.example.com")
    scope["headers"].append((b"origin", b"https://evil.example"))
    assert _ws_attempt(mw, scope) == [{"type": "websocket.close", "code": 1008}]


def test_the_assistant_ceiling_is_four_at_production(production_env, monkeypatch):
    """Loaded as a separate copy with the variable unset, so the module the
    app uses (and its counters) is never replaced (verify loop 2, R5)."""
    import importlib.util

    monkeypatch.delenv("ASSISTANT_MAX_CONCURRENCY", raising=False)
    spec = importlib.util.spec_from_file_location("security_production_copy", security.__file__)
    fresh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh)
    assert fresh.ASSISTANT_MAX_CONCURRENCY == 4
    assert fresh.SecurityMiddleware(lambda *a: None).assistant._initial_value == 4


def test_websocket_total_cap_refuses_beyond_the_ceiling():
    """The per-client cap is exercised above; this is the process-wide one."""

    async def run():
        mw = security.SecurityMiddleware(_accepting_app(), ws_per_client=10, ws_total=2)
        holds = [asyncio.Event() for _ in range(2)]
        tasks = []
        for i, hold in enumerate(holds):
            async def receive(h=hold):
                await h.wait()
                return {"type": "websocket.disconnect"}

            async def send(msg):
                pass

            scope = {"type": "websocket", "path": "/api/stream/ws", "headers": [], "client": (f"1.2.3.{i}", 1)}
            tasks.append(asyncio.create_task(mw(scope, receive, send)))
        await asyncio.sleep(0.05)
        assert mw.ws_active_total() == 2
        third: list = []

        async def receive3():
            return {"type": "websocket.disconnect"}

        async def send3(msg):
            third.append(msg)

        await mw({"type": "websocket", "path": "/api/stream/ws", "headers": [], "client": ("9.9.9.9", 1)}, receive3, send3)
        assert third == [{"type": "websocket.close", "code": 1013}]
        for hold in holds:
            hold.set()
        await asyncio.gather(*tasks)
        assert mw.ws_active_total() == 0

    asyncio.run(run())


# ── launch-1 verify loop 1 (item 3): the client's address on the real hosts ──


def test_a_client_ip_header_set_by_the_edge_wins(monkeypatch):
    """Render sits behind Cloudflare, so X-Forwarded-For arrives as
    "client, cloudflare-edge": one hop from the right is Cloudflare, and every
    visitor would share its bucket. CLIENT_IP_HEADER names a header the edge
    itself sets on every request."""
    scope = {"client": ("10.0.0.1", 5), "headers": [
        (b"x-forwarded-for", b"203.0.113.9, 104.22.17.40"),
        (b"cf-connecting-ip", b"203.0.113.9"),
    ]}
    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    assert security.client_ip_header() == "cf-connecting-ip"
    assert security.client_id_from(scope, 1) == "203.0.113.9"
    # Missing on a request: fall back to the hop count, then the peer.
    bare = {"client": ("10.0.0.1", 5), "headers": [(b"x-forwarded-for", b"203.0.113.9, 104.22.17.40")]}
    assert security.client_id_from(bare, 2) == "203.0.113.9"
    monkeypatch.delenv("CLIENT_IP_HEADER")
    assert security.client_id_from(scope, 1) == "104.22.17.40", "without the header, one hop is the edge"


def test_a_garbage_client_ip_header_is_ignored(monkeypatch):
    monkeypatch.setenv("CLIENT_IP_HEADER", "cf-connecting-ip")
    scope = {"client": ("10.0.0.1", 5), "headers": [(b"cf-connecting-ip", b"x" * 300)]}
    assert security.client_id_from(scope, 0) == "10.0.0.1"


# ── launch-1 verify (item 9): the chip's status read is not a question ──────


def test_the_status_read_does_not_spend_the_assistant_buckets(production_env, monkeypatch):
    """GET /api/assistant/status is read on every page load and every five
    minutes per tab. It shared the 10-a-minute question bucket, so sixty
    first-time visitors in a minute refused every question for that minute,
    and one visitor's eleventh page load was a 429."""
    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    client = TestClient(_app())
    assert [client.get("/api/assistant/status").status_code for _ in range(30)] == [200] * 30
    codes = [client.post("/api/assistant/ask", json={"m": 1}).status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and 429 in codes[10:], "questions keep their own ten a minute"
    assert client.get("/api/assistant/status").status_code == 200, "after the questions are shed, the chip still reads"


def test_the_status_read_still_follows_the_assistant_mode(monkeypatch):
    """Off and key-gated deployments answer the chip's read the same way as a
    question, so the chip can say what it is looking at."""
    client = TestClient(_app())
    monkeypatch.setenv("ASSISTANT_ACCESS", "off")
    assert client.get("/api/assistant/status").status_code == 503
    monkeypatch.setenv("ASSISTANT_ACCESS", "key")
    monkeypatch.setenv("ASSISTANT_ACCESS_KEY", "s3cret")
    assert client.get("/api/assistant/status").status_code == 401
    assert client.get("/api/assistant/status", headers={"x-assistant-key": "s3cret"}).status_code == 200


def test_the_assistant_ceiling_applies_to_questions_not_the_status_read(monkeypatch):
    import threading

    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    release = threading.Event()
    app2 = FastAPI()

    @app2.post("/api/assistant/ask")
    def ask(body: dict):
        release.wait(5)
        return {"ok": True}

    @app2.get("/api/assistant/status")
    def status():
        return {"resting": False}

    app2.add_middleware(security.SecurityMiddleware, assistant_slots=1)
    c = TestClient(app2)
    codes: list[int] = []
    t = threading.Thread(target=lambda: codes.append(c.post("/api/assistant/ask", json={"m": 1}).status_code))
    t.start()
    try:
        import time

        time.sleep(0.2)
        assert c.get("/api/assistant/status").status_code == 200, "a question in flight must not block the chip's read"
        assert c.post("/api/assistant/ask", json={"m": 2}).status_code == 429
    finally:
        release.set()
        t.join(10)
    assert codes == [200]
