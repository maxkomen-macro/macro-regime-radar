"""api/security.py — publication gates for the FastAPI service (2026-09-06).

Pure ASGI middleware (not BaseHTTPMiddleware, which buffers streaming
responses and would break the assistant's SSE frames). It adds, in order:

1. Request-size limits (Content-Length cap; chunked bodies are cut off).
2. Per-client and global token-bucket rate limits on every API path, with a
   much tighter bucket on the assistant endpoint.
3. A concurrency ceiling for the expensive calculators and the provider
   layer, answered with 429 instead of queueing the worker pool.
4. The assistant gate: `ASSISTANT_ACCESS=open|key|off`. Default is `open`
   on a dev origin set and `off` whenever CORS_ORIGINS is set (a public
   deploy), so the unauthenticated agent never ships by accident.
5. Security headers on every response.

Nothing here logs a request body, a header value, or a token.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(64 * 1024)))
ASSISTANT_MAX_BODY_BYTES = 16 * 1024
API_PREFIXES = ("/api", "/health", "/regime", "/signals", "/series")
EXPENSIVE_PATHS = {"/api/allocation", "/api/lbo/run", "/api/regime/scenario", "/api/recession/scenario", "/api/recession/probability"}
PROVIDER_PREFIX = "/api/market/"
# Everything else under the API prefixes is a stored-data read: bounded by
# the `db` ceiling so a burst sheds load as 429s instead of wedging the
# worker pool (review P0-1).
LIVE_PATHS = {"/health/live"}
SECURITY_HEADERS = {
    b"x-content-type-options": b"nosniff",
    b"x-frame-options": b"DENY",
    b"referrer-policy": b"strict-origin-when-cross-origin",
    b"permissions-policy": b"camera=(), microphone=(), geolocation=(), payment=()",
    b"cross-origin-opener-policy": b"same-origin",
}


def assistant_mode() -> str:
    raw = os.environ.get("ASSISTANT_ACCESS", "").strip().lower()
    if raw in ("open", "key", "off"):
        return raw
    return "off" if os.environ.get("CORS_ORIGINS", "").strip() else "open"


def trusted_proxy_hops() -> int:
    """How many trailing X-Forwarded-For entries were appended by proxies we
    control. 0 (default) ignores the header entirely; TRUST_X_FORWARDED_FOR=1
    is kept as an alias for one hop. The client-supplied left-most entry is
    never used (review P1-2: it was spoofable)."""
    raw = os.environ.get("TRUSTED_PROXY_HOPS", "").strip()
    if raw.isdigit():
        return int(raw)
    return 1 if os.environ.get("TRUST_X_FORWARDED_FOR", "").strip() in ("1", "true", "yes") else 0


def client_id_from(scope: dict, hops: int) -> str:
    """Rate-limit key: the socket peer, or — behind `hops` trusted proxies —
    the X-Forwarded-For entry that many places from the right."""
    peer = scope.get("client")
    peer_ip = peer[0] if peer else "unknown"
    if hops <= 0:
        return peer_ip
    for k, v in scope.get("headers", []):
        if k == b"x-forwarded-for":
            parts = [x.strip() for x in v.decode("latin-1").split(",") if x.strip()]
            if len(parts) >= hops:
                return parts[-hops]
            return peer_ip
    return peer_ip


class _Bucket:
    __slots__ = ("tokens", "updated")

    def __init__(self, burst: float) -> None:
        self.tokens = burst
        self.updated = time.monotonic()


class RateLimiter:
    """Token buckets keyed by client id, bounded in count (LRU eviction)."""

    def __init__(self, per_minute: float, burst: float, max_clients: int = 4096) -> None:
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.max_clients = max_clients
        self._b: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()

    def take(self, key: str, n: float = 1.0) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            b = self._b.get(key)
            if b is None:
                b = _Bucket(self.burst)
                self._b[key] = b
                if len(self._b) > self.max_clients:
                    self._b.popitem(last=False)
            else:
                self._b.move_to_end(key)
            b.tokens = min(self.burst, b.tokens + max(0.0, now - b.updated) * self.rate)
            b.updated = now
            if b.tokens >= n:
                b.tokens -= n
                return True, 0.0
            return False, (n - b.tokens) / self.rate if self.rate > 0 else 60.0


class SecurityMiddleware:
    def __init__(
        self,
        app: Callable,
        *,
        per_client_per_min: float | None = None,
        per_client_burst: float | None = None,
        global_per_min: float | None = None,
        assistant_per_min: float = 10.0,
        expensive_slots: int = 4,
        provider_slots: int = 12,
        db_slots: int | None = None,
        ws_per_client: int | None = None,
        ws_total: int | None = None,
        max_body: int = MAX_BODY_BYTES,
    ) -> None:
        self.app = app
        pc = per_client_per_min if per_client_per_min is not None else float(os.environ.get("RATE_LIMIT_PER_CLIENT_PER_MIN", "600"))
        # Burst well below the per-minute rate: a screen load is ~25 requests;
        # 600 simultaneous admits was the trigger for the P0 wedge.
        burst = per_client_burst if per_client_burst is not None else min(pc, float(os.environ.get("RATE_LIMIT_PER_CLIENT_BURST", "120")))
        self.client_limiter = RateLimiter(pc, burst)
        gl = global_per_min if global_per_min is not None else float(os.environ.get("RATE_LIMIT_GLOBAL_PER_MIN", "4000"))
        self.global_limiter = RateLimiter(gl, min(gl, float(os.environ.get("RATE_LIMIT_GLOBAL_BURST", "600"))), max_clients=1)
        self.assistant_limiter = RateLimiter(assistant_per_min, assistant_per_min)
        self.assistant_global = RateLimiter(assistant_per_min * 6, assistant_per_min * 6, max_clients=1)
        self.expensive = threading.BoundedSemaphore(expensive_slots)
        self.provider = threading.BoundedSemaphore(provider_slots)
        self.db = threading.BoundedSemaphore(db_slots if db_slots is not None else int(os.environ.get("DB_MAX_CONCURRENCY", "24")))
        # Per-client socket cap keyed on the rate-limit client id: generous
        # enough for an office behind one NAT address, tight enough that one
        # script cannot hold hundreds of relay fanouts.
        self.ws_per_client = ws_per_client if ws_per_client is not None else int(os.environ.get("WS_MAX_PER_CLIENT", "20"))
        self.ws_total = ws_total if ws_total is not None else int(os.environ.get("WS_MAX_TOTAL", "200"))
        self._ws_active: dict[str, int] = {}
        self._ws_lock = threading.Lock()
        self.max_body = max_body
        self.hops = trusted_proxy_hops()
        self.stats: dict[str, int] = {"rate_limited": 0, "too_large": 0, "busy": 0, "assistant_blocked": 0, "ws_refused": 0}

    # ── helpers ──────────────────────────────────────────────────────────────

    def _client_id(self, scope: dict) -> str:
        return client_id_from(scope, self.hops)

    def ws_active_total(self) -> int:
        with self._ws_lock:
            return sum(self._ws_active.values())

    async def _websocket(self, scope: dict, receive: Callable, send: Callable) -> None:
        """Connection caps for the relay socket (review P1-3): per client and
        in total. A refused socket is closed before accept (HTTP 403)."""
        cid = self._client_id(scope)
        with self._ws_lock:
            mine = self._ws_active.get(cid, 0)
            total = sum(self._ws_active.values())
            if mine >= self.ws_per_client or total >= self.ws_total:
                refused = True
            else:
                refused = False
                self._ws_active[cid] = mine + 1
        if refused:
            self.stats["ws_refused"] += 1
            await send({"type": "websocket.close", "code": 1013})
            return
        try:
            await self.app(scope, receive, send)
        finally:
            with self._ws_lock:
                left = self._ws_active.get(cid, 1) - 1
                if left <= 0:
                    self._ws_active.pop(cid, None)
                else:
                    self._ws_active[cid] = left

    @staticmethod
    async def _reply(send: Callable, status: int, detail: str, extra_headers: list[tuple[bytes, bytes]] | None = None) -> None:
        body = json.dumps({"detail": detail}).encode()
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
        headers += list(SECURITY_HEADERS.items())
        headers += extra_headers or []
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    # ── ASGI ─────────────────────────────────────────────────────────────────

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] == "websocket":
            return await self._websocket(scope, receive, send)
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")
        headers = dict(scope.get("headers", []))
        is_api = path.startswith(API_PREFIXES)
        is_assistant = path.startswith("/api/assistant")

        # 1. size cap
        limit = ASSISTANT_MAX_BODY_BYTES if is_assistant else self.max_body
        try:
            declared = int(headers.get(b"content-length", b"0") or 0)
        except ValueError:
            declared = 0
        if declared > limit:
            self.stats["too_large"] += 1
            return await self._reply(send, 413, f"Request body exceeds {limit} bytes.")
        if method in ("POST", "PUT", "PATCH") and b"content-length" not in headers:
            receive = self._bounded_receive(receive, limit)

        # 2. rate limits (API paths only — static assets are cheap and cached)
        if is_api:
            cid = self._client_id(scope)
            ok, wait = self.client_limiter.take(cid)
            if ok:
                ok, wait = self.global_limiter.take("global")
            if not ok:
                self.stats["rate_limited"] += 1
                return await self._reply(send, 429, "Too many requests; slow down and retry.", [(b"retry-after", str(max(1, int(wait + 0.999))).encode())])

        # 4. assistant gate
        if is_assistant:
            mode = assistant_mode()
            if mode == "off":
                self.stats["assistant_blocked"] += 1
                return await self._reply(send, 503, "The AI analyst is disabled on this deployment (ASSISTANT_ACCESS=off). Every other screen works without it.")
            if mode == "key":
                expected = os.environ.get("ASSISTANT_ACCESS_KEY", "")
                given = headers.get(b"x-assistant-key", b"").decode("latin-1")
                if not expected or given != expected:
                    self.stats["assistant_blocked"] += 1
                    return await self._reply(send, 401, "The AI analyst requires an access key on this deployment.")
            cid = self._client_id(scope)
            ok, wait = self.assistant_limiter.take(cid)
            if ok:
                ok, wait = self.assistant_global.take("global")
            if not ok:
                self.stats["rate_limited"] += 1
                return await self._reply(send, 429, "The AI analyst is rate limited; retry in a minute.", [(b"retry-after", str(max(1, int(wait + 0.999))).encode())])

        # 3. concurrency ceilings — every API read is bounded somewhere
        sem = None
        if path in EXPENSIVE_PATHS:
            sem = self.expensive
        elif path.startswith(PROVIDER_PREFIX):
            sem = self.provider
        elif is_api and path not in LIVE_PATHS and not is_assistant:
            sem = self.db
        if sem is not None and not sem.acquire(blocking=False):
            self.stats["busy"] += 1
            return await self._reply(send, 429, "The service is busy; retry in a moment.", [(b"retry-after", b"1")])

        async def send_with_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                hdrs = list(message.get("headers", []))
                present = {k.lower() for k, _ in hdrs}
                for k, v in SECURITY_HEADERS.items():
                    if k not in present:
                        hdrs.append((k, v))
                if is_assistant and b"cache-control" not in present:
                    hdrs.append((b"cache-control", b"no-store"))
                message = {**message, "headers": hdrs}
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            if sem is not None:
                sem.release()

    @staticmethod
    def _bounded_receive(receive: Callable[[], Awaitable[dict]], limit: int) -> Callable[[], Awaitable[dict]]:
        seen = 0

        async def wrapped() -> dict:
            nonlocal seen
            msg = await receive()
            if msg.get("type") == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    # Cut the stream: the app sees an empty, finished body and
                    # answers 422 — never buffers an unbounded upload.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return msg

        return wrapped
