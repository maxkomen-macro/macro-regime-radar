"""api/desk_envelope.py — the §12.0 envelope of the Desk v2 routes (desk/frame-3-api, B1).

Every JSON route of DESK_FRAME3_SPEC §12 (the nine live ones and the
deferred stubs of §12.13) answers one envelope:

    {status, generation_id, as_of, engine_version, data, unavailable, error}

`status` is ready (200), computing (202, `Retry-After: 2`), awaiting (200,
`data: null`) or error (4xx/5xx). A few named paths inside `data` carry block
envelopes `{status, data, unavailable}` (NESTED_PATHS) and nothing else does.

This module holds the envelope and its blocks, the routes and paths the
frame-3 client knows (mirrored from web/src/screens/desk/data/envelope.ts and
pinned by tests/test_desk_v2_stubs.py), the sentences every deferred block and
stub serves, and `answer`, the one wrapper every handler runs in: the error
map of docs/desk/FRAME3_API_PLAN.md §3 lives here and nowhere else.

Stdlib only at import. The worker, the engine, api.db and hardening's
api.provenance are never imported here: an exception can only be an instance
of a class whose module is already loaded, so the error map reads those
classes from sys.modules when it has an exception in hand, and the generation
is read from the worker when an answer is being made.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

from api.calendar import NY

log = logging.getLogger("mrr.desk")

STATES = ("ready", "computing", "awaiting", "error")
# §12.0 (S-11). The existing Desk and worker routes keep their 3 (api/desk.py, api/worker.py).
RETRY_AFTER_S = 2


# ── Engine version (§12.0, S-21) ────────────────────────────────────────────

def resolve_engine_version(environ: Mapping[str, str]) -> str:
    """The git commit sha of the running build: `ENGINE_VERSION`, injected at
    image build, else the host's own `RENDER_GIT_COMMIT`, else "unknown". A
    blank value counts as absent, and so does the Dockerfile ARG's default
    "unknown", so a build that was not passed the argument still serves the
    host's commit."""
    for name in ("ENGINE_VERSION", "RENDER_GIT_COMMIT"):
        value = (environ.get(name) or "").strip()
        if value and value != "unknown":
            return value
    return "unknown"


# Read once, at import. The adapter's schema version is a different constant
# (it keys the projection memo, plan §3) and is never served as this.
ENGINE_VERSION = resolve_engine_version(os.environ)


# ── The frame-3 client's routes and block paths ─────────────────────────────

# The routes that answer the envelope (§12.0): the ten live ones (/sectors since desk/fill-etf), then the
# §12.13 stubs. `/basket` stands for `/basket/:id` (route_of). The existing
# /api/desk endpoints (/event-study, /event-study/assets, /pipeline/inventory)
# keep their own contracts.
ENVELOPED_ROUTES: tuple[str, ...] = (
    "/overview", "/study", "/study/catalog", "/study/events", "/ledger", "/regime", "/technicals", "/macro", "/pipeline",
    "/sectors", "/vol", "/positions", "/basket", "/basket/price", "/hedge",
)

# The only paths that carry block envelopes (§12.0, v4 B-08, C-01). Every
# other object and array in a payload is an ordinary field.
NESTED_PATHS: dict[str, tuple[str, ...]] = {
    "/overview": ("since_last_close", "tiles.regime", "tiles.recession", "tiles.trend", "tiles.vol", "data_status"),
    "/regime": ("current", "recession", "next_prints", "stats", "changes"),
    "/macro": ("curve", "credit", "stock_bond", "correlations", "matrix"),
    "/technicals": ("vol", "sectors"),
    "/study": ("without_condition",),
    "/sectors": ("breadth",),  # desk/fill-etf: /sectors is served, its breadth a block of its own
}


def route_of(path: str) -> str:
    """The route a path under /api/desk answers for: `/basket/ai-infra` is
    `/basket`, as the client's routeOf reads it."""
    return "/basket" if path.startswith("/basket/") and path != "/basket/price" else path


# ── Served sentences (§1.0, §12.3, §12.6–§12.8, §12.13; plan §6 S-17, S-27) ──

BREADTH_REASON = "breadth is not computed yet."  # desk/fill-etf item 2: /sectors serves leadership first
VOL_REASON = "needs stored SPY option snapshots and a versioned skew method."
POSITIONS_REASON = "Positions are kept in this browser; there is no server position store."
BASKET_REASON = "basket pricing and option structures not yet defined in the engine."
RSI_REASON = "RSI is not computed yet."
WITHOUT_CONDITION_REASON = "conditional-versus-unconditional comparison is not defined"
REGIME_STATS_REASON = "regime statistics not yet defined in the engine."
CORRELATIONS_REASON = "Treasury and credit price-return series not ingested."
# S-27: a block whose computation failed on this generation.
BLOCK_FAILED_REASON = "Awaiting refresh: this could not be computed from the current data."

# The §12.13 stubs, each answering the awaiting envelope with its sentence.
# (/sectors is served since desk/fill-etf, §12.14.)
DEFERRED_REASONS: dict[str, str] = {
    "/vol": VOL_REASON,
    "/positions": POSITIONS_REASON,
    "/basket": BASKET_REASON,
    "/basket/price": BASKET_REASON,
    "/hedge": BASKET_REASON,
}

# The blocks deferred on Monday (§13.2 "not allowed"), by route and path.
DEFERRED_BLOCKS: dict[tuple[str, str], str] = {
    ("/study", "without_condition"): WITHOUT_CONDITION_REASON,
    ("/regime", "stats"): REGIME_STATS_REASON,
    ("/regime", "changes"): REGIME_STATS_REASON,
    ("/technicals", "vol"): VOL_REASON,
    ("/sectors", "breadth"): BREADTH_REASON,
    ("/macro", "stock_bond"): CORRELATIONS_REASON,
    ("/macro", "correlations"): CORRELATIONS_REASON,
    ("/macro", "matrix"): CORRELATIONS_REASON,
}

INTERNAL_MESSAGE = "Internal error. The incident is logged server-side."


# ── What a handler raises ───────────────────────────────────────────────────

class Unsupported(ValueError):
    """422 `unsupported`: the request does not normalize to a catalog study
    (plan R11), or names a parameter the route does not take. The message
    names what is not supported; nothing is silently dropped (§12.0)."""


class Awaiting(Exception):
    """The route, or a block, is not served on this generation (§1.0.2): one
    sentence, and when it is expected, if known."""

    def __init__(self, reason: str, until: str | None = None) -> None:
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("an awaiting answer needs its reason in words")
        self.reason = reason
        self.until = until
        super().__init__(reason)


# ── Blocks ──────────────────────────────────────────────────────────────────

def unavailable(reason: str, until: str | None = None) -> dict:
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("an unavailable block needs its reason in words")
    return {"reason": reason, "until": until}


def block_ready(data: Any) -> dict:
    if data is None:
        raise ValueError("a ready block carries its data")
    return {"status": "ready", "data": data, "unavailable": None}


def block_awaiting(reason: str, until: str | None = None) -> dict:
    return {"status": "awaiting", "data": None, "unavailable": unavailable(reason, until)}


def block_deferred(route: str, path: str) -> dict:
    """A block deferred on Monday, with its fixed sentence."""
    return block_awaiting(DEFERRED_BLOCKS[(route, path)])


def block_from(route: str, path: str, fn: Callable[[], Any]) -> dict:
    """One block of a composite route (/overview, /regime, /macro): ready with
    what `fn` returns, awaiting with the reason it raises as `Awaiting`, and
    awaiting with the S-27 sentence when its computation failed on this
    generation (logged). A fact about the whole answer (the server is warming,
    the database is unavailable, its schema could not be read) is not one
    block's: it propagates, and `answer` maps it for the route."""
    try:
        return block_ready(fn())
    except Awaiting as a:
        return block_awaiting(a.reason, a.until)
    except Exception as exc:
        if _route_level(exc):
            raise
        log.exception("desk %s: block %s could not be computed", route, path)
        return block_awaiting(BLOCK_FAILED_REASON)


# ── The generation an answer is made on ─────────────────────────────────────

def _generation() -> Any:
    """The request's pinned generation, else the published one, else None.
    Never waits: a handler that needs results has already waited for them."""
    from api.worker import get_worker

    return get_worker().generation()


def generation_id(gen: Any) -> str | None:
    if gen is None:
        return None
    digest = hashlib.sha256(repr(gen.key).encode("utf-8")).hexdigest()[:10]
    return f"g{gen.id}-{digest}"


def as_of(gen: Any) -> str | None:
    """The New York date the generation was staged (§12.0, S-21), never an
    observation's. Hardening's Generation carries it as `as_of`; before that
    it is read from `staged_at` (UTC, "%Y-%m-%dT%H:%M:%SZ")."""
    if gen is None:
        return None
    stamped = getattr(gen, "as_of", None)
    if isinstance(stamped, str) and stamped:
        return stamped
    try:
        staged = datetime.strptime(getattr(gen, "staged_at", "") or "", "%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return None
    return staged.replace(tzinfo=timezone.utc).astimezone(NY).date().isoformat()


# ── The envelope ────────────────────────────────────────────────────────────

def envelope(status: str, *, gen: Any = None, data: dict | None = None, unavailable: dict | None = None,
             error: dict | None = None) -> dict:
    """The §12.0 envelope. `data` only when ready, `unavailable` only when
    awaiting, `error` only when an error; a computing answer carries no
    generation (S-11)."""
    if status not in STATES:
        raise ValueError(f"unknown envelope status {status!r}")
    if (data is not None) != (status == "ready"):
        raise ValueError("data is served exactly when the status is ready")
    if (unavailable is not None) != (status == "awaiting"):
        raise ValueError("unavailable is served exactly when the status is awaiting")
    if (error is not None) != (status == "error"):
        raise ValueError("error is served exactly when the status is error")
    if status == "computing":
        gen = None
    return {
        "status": status,
        "generation_id": generation_id(gen),
        "as_of": as_of(gen),
        # read per call, so a test can set the module's value
        "engine_version": ENGINE_VERSION,
        "data": data,
        "unavailable": unavailable,
        "error": error,
    }


@dataclass(frozen=True)
class Reply:
    """An answer, ready for the wire; api/desk_v2.py turns it into a Response."""

    status_code: int
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)
    media_type: str = "application/json"


def _dump(obj: Any) -> bytes:
    # allow_nan=False: a NaN or an Infinity that reached a payload is a bug,
    # answered 500, never `NaN` on the wire (plan §3). Same separators and
    # ensure_ascii as Starlette's JSONResponse.
    return json.dumps(obj, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def reply(status_code: int, env: dict, headers: Mapping[str, str] | None = None) -> Reply:
    out = {"Cache-Control": "no-store", **(headers or {})}
    try:
        body = _dump(env)
    except (TypeError, ValueError):
        log.exception("desk: an answer could not be serialized (status %s)", env.get("status"))
        env = envelope("error", gen=_safe_generation(), error={"code": "internal", "message": INTERNAL_MESSAGE})
        status_code, out, body = 500, {"Cache-Control": "no-store"}, _dump(env)
    return Reply(status_code, body, out)


def _safe_generation() -> Any:
    try:
        return _generation()
    except Exception:  # noqa: BLE001 — an error answer must never fail on its own meta
        return None


def error_reply(status_code: int, code: str, message: str, *, gen: Any = None, headers: Mapping[str, str] | None = None,
                **extra: Any) -> Reply:
    return reply(status_code, envelope("error", gen=gen, error={"code": code, "message": message, **extra}), headers)


def awaiting_reply(reason: str, until: str | None = None, *, gen: Any = None) -> Reply:
    return reply(200, envelope("awaiting", gen=gen, unavailable=unavailable(reason, until)))


def deferred(route: str) -> Reply:
    """A §12.13 stub: the awaiting envelope with its sentence, at once. It
    never waits on warming; before the first generation it carries none."""
    return awaiting_reply(DEFERRED_REASONS[route], gen=_safe_generation())


def method_not_allowed(method: str) -> Reply:
    """A write to an enveloped route (§12.0: `POST /positions`, `POST /basket/price`)."""
    return error_reply(405, "method_not_allowed", f"{method} is not allowed here; this route answers GET only.",
                       gen=_safe_generation(), headers={"Allow": "GET"})


# ── The error map (plan §3) ─────────────────────────────────────────────────

def _loaded(module: str, name: str) -> type | None:
    """A class from a module only if that module is loaded: an exception can
    only be an instance of a class whose module has been imported."""
    mod = sys.modules.get(module)
    cls = getattr(mod, name, None) if mod is not None else None
    return cls if isinstance(cls, type) else None


def _is(exc: BaseException, module: str, name: str) -> bool:
    cls = _loaded(module, name)
    return cls is not None and isinstance(exc, cls)


def _route_level(exc: BaseException) -> bool:
    """Facts about the whole answer, never one block's."""
    return (_is(exc, "api.worker", "Warming") or _is(exc, "api.db", "DBUnavailable")
            or _is(exc, "api.provenance", "SchemaCheckFailed"))


def sanitized(exc: BaseException) -> str:
    """An error a visitor may read: the message only when it carries no path,
    else a fixed sentence. The rule of api/main.py's `_sanitized` (launch-1,
    re-audit F6), pinned equal by tests/test_desk_v2_envelope.py."""
    text = str(exc)
    return text if ("/" not in text and "\\" not in text) else "The database is not available on this server."


_UNPINNED = object()


def map_exception(route: str, exc: BaseException, gen: Any = _UNPINNED) -> Reply:
    """The error map's rows, in order (plan §3). A 413 or 429 is refused by
    api/security.py before the route runs and keeps its `{detail}` (S-26).
    `gen` is the request's pinned generation when `answer` has one."""
    if gen is _UNPINNED:
        gen = _safe_generation()
    # Hardening's SchemaCheckFailed subclasses sqlite3.OperationalError: it is
    # matched first, and only by its own class.
    if _is(exc, "api.provenance", "SchemaCheckFailed"):
        return error_reply(503, "schema_check", str(exc), gen=gen, retryable=True, provider="api")
    if _is(exc, "api.worker", "Warming"):
        # S-11: before the first generation, the answer is computing and names none.
        return reply(202, envelope("computing"), {"Retry-After": str(RETRY_AFTER_S)})
    if isinstance(exc, Unsupported) or _is(exc, "src.desk.event_study", "StudyError"):
        return error_reply(422, "unsupported", str(exc), gen=gen)
    if _is(exc, "api.db", "DBUnavailable"):
        return error_reply(503, "db_unavailable", sanitized(exc), gen=gen)
    log.error("desk %s: unhandled %s", route, type(exc).__name__, exc_info=exc)
    return error_reply(500, "internal", INTERNAL_MESSAGE, gen=gen)


def request_generation() -> Any:
    """The one generation a request reads (Codex R-01): the request's pin
    (api/worker.PinGeneration pins a request that arrives after a publication),
    else the first usable published generation, waited for up to the worker's
    wait (a request that arrived before it), else `Warming`. A cold request used
    to read its items from the generation `result()` waited for and name
    whichever generation was current later, in its memo key and envelope; a
    publication in between served one generation's numbers under the next
    one's id, and memoized them under it."""
    import time

    from api.worker import Warming, get_worker
    from src.analytics import dbpath

    w = get_worker()
    w.ensure_started()
    pinned = dbpath.pinned_generation()
    if pinned is not None and getattr(pinned, "owner", None) is w:
        return pinned
    deadline = time.monotonic() + w.wait_s
    while not w.ready():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Warming()
        w.poke()  # as result() does; an unusable published generation waits for the next one
        stale = w.current
        w.wait_published(min_id=stale.id + 1 if stale is not None else 1, timeout=min(remaining, 0.25))
    return w.current


def answer(route: str, fn: Callable[[], dict]) -> Reply:
    """Run one handler body inside the error map and put what it returns in
    the envelope: a payload dict is ready; `Awaiting` is awaiting; every other
    outcome is mapped by `map_exception`. One generation is pinned before the
    body runs (Codex R-01) and held through every item read, the projection,
    the memo key and the envelope."""
    from src.analytics import dbpath

    gen = None
    try:
        gen = request_generation()
        with dbpath.pinned(gen):
            data = fn()
        if not isinstance(data, dict):
            raise TypeError(f"a desk handler returned {type(data).__name__}, not a payload")
        _assert_finite(data)
        return reply(200, envelope("ready", gen=gen, data=data))
    except Awaiting as a:
        return awaiting_reply(a.reason, a.until, gen=gen)
    except Exception as exc:  # noqa: BLE001 — every outcome is an envelope
        return map_exception(route, exc, gen=gen)


def _assert_finite(obj: Any) -> None:
    """A payload carries no NaN or Infinity (§12.0 "never 0, NaN or Infinity").
    json.dumps(allow_nan=False) refuses them too; this names the fault first."""
    stack = [obj]
    while stack:
        v = stack.pop()
        if isinstance(v, float):
            if not math.isfinite(v):
                raise ValueError("a non-finite number reached a desk payload")
        elif isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
