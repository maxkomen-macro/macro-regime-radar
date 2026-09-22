"""api/desk.py — the Desk's endpoints (desk/event-study, 2026-09-21).

GET /api/desk/event-study/assets
    The §3 lists from src/desk/series.py with `history_from`, `shock_unit`,
    stored coverage and status per series, the conditions, windows,
    thresholds, horizons and presets. A worker item (`desk_assets`), rebuilt
    with every generation.

GET /api/desk/event-study?study=<slug> | ?shock=&w=&z=&sign=&cond=&cond_value=&regime=&target=
    One study. The presets (`desk_preset:<name>` items) are precomputed by
    the worker and only looked up. A free-form query computes on request
    (decision 2026-09-21: it cannot be precomputed), behind the expensive-
    calculator semaphore (api/security.EXPENSIVE_PATHS), pinned to the
    generation the request arrived on, and cached by (generation key, study
    slug, seed) so a repeat is a lookup. A request waits at most
    COMPUTE_TIMEOUT_S for its computation; past that it answers 202 with a
    `computing` body and Retry-After, and the computation keeps running for
    the next request. Outstanding computations are bounded at CACHE_MAX
    (R-13): a full queue answers 429 with Retry-After. A job leases the
    generation it was submitted under (R-16): it opens that generation's
    copy itself and computes only against it; if the copy has been released
    by the time the job runs, the job is cancelled and the client gets a
    fresh 202 for a job under the current generation. The cache key is the
    losslessly serialized validated parameters (R-07). Numeric parameters
    arrive as strings and are parsed by the engine's validation, so a parse
    failure is a 422 with the engine's reason (R-14). Never a blank panel:
    every answer is `ready`, `computing`, 429 `busy`, 422 or 503 `not_stored`.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import replace
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from api.db import NotStored
from src.analytics import dbpath
from src.desk import event_study as es

router = APIRouter(prefix="/api/desk")

COMPUTE_TIMEOUT_S = 20.0
RETRY_AFTER_S = 3
CACHE_MAX = 64

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mrr-desk-study")
_lock = threading.Lock()
_cache: "OrderedDict[tuple, Future]" = OrderedDict()
stats = {"computed": 0, "hits": 0, "computing": 0, "busy": 0, "expired": 0}


class QueueFull(RuntimeError):
    """CACHE_MAX computations are outstanding (R-13)."""


class GenerationExpired(RuntimeError):
    """The generation a job was submitted under was released before it ran (R-16)."""


def _worker():
    from api.worker import get_worker

    return get_worker()


def preset_name(q: es.Query) -> str | None:
    q = es.validate(q)
    for name, preset in es.PRESETS.items():
        if es.validate(preset) == replace(q, seed=es.DEFAULT_SEED):
            return name
    return None


def _compute(gen, q: es.Query) -> dict:
    """The job's lease on its generation: its own connection to that copy,
    never the served generation's fallback (R-16)."""
    conn = dbpath.open_generation(gen)
    if conn is None:
        raise GenerationExpired()
    try:
        return es.run_on(conn, q, generation=gen.key)
    finally:
        conn.close()


def study_result(q: es.Query) -> dict | None:
    """The study's payload, or None while it is still computing."""
    q = es.validate(q)
    name = preset_name(q)
    w = _worker()
    if name is not None and q.seed == es.DEFAULT_SEED:
        return w.result(f"desk_preset:{name}")  # any other seed computes below (verifier defect 3)
    w.result("desk_assets")  # waits for a usable generation, or raises Warming like every handler
    gen = w.generation()
    if gen is None:
        from api.worker import Warming

        raise Warming()
    key, fut = _submit(gen, q)
    try:
        return fut.result(timeout=COMPUTE_TIMEOUT_S)
    except FutureTimeout:
        stats["computing"] += 1
        return None
    except GenerationExpired:
        stats["expired"] += 1
        with _lock:
            _cache.pop(key, None)
        cur = w.generation()
        if cur is not None and cur.key != gen.key:
            _submit(cur, q)  # a fresh job under the current generation; the client retries into it
        return None
    except BaseException:
        with _lock:
            _cache.pop(key, None)  # a failure is not pinned to the generation
        raise


def _submit(gen, q: es.Query) -> tuple[tuple, Future]:
    key = (gen.key, es.cache_key(q))  # R-07: the validated parameters, losslessly
    with _lock:
        fut = _cache.get(key)
        if fut is None:
            for stale in [k for k, f in _cache.items() if k[0] != gen.key and f.done()]:
                _cache.pop(stale, None)
            outstanding = sum(1 for f in _cache.values() if not f.done())
            if outstanding >= CACHE_MAX:
                stats["busy"] += 1
                raise QueueFull()
            fut = _pool.submit(_compute, gen, q)
            _cache[key] = fut
            stats["computed"] += 1
            done_keys = [k for k, f in _cache.items() if f.done()]
            while len(_cache) > CACHE_MAX and done_keys:
                _cache.pop(done_keys.pop(0), None)
        else:
            _cache.move_to_end(key)
            stats["hits"] += 1
    return key, fut


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _query(study: str | None, **kw: Any) -> es.Query:
    """Strings in, a validated Query out; every parse failure is the engine's
    StudyError and a 422 with its reason (R-14)."""
    try:
        seed = kw.pop("seed", None)
        if study:
            q = es.parse_slug(study)
        else:
            q = es.Query(**{k: v for k, v in kw.items() if v is not None})
        if seed is not None:
            q = replace(q, seed=seed)
        return es.validate(q)
    except es.StudyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/event-study/assets")
def desk_event_study_assets() -> dict:
    return _worker().result("desk_assets")


@router.get("/event-study")
def desk_event_study(
    study: str | None = Query(None, description="a preset name or a study slug (permalink)"),
    shock: str | None = None,
    w: str | None = None,
    z: str | None = None,
    sign: str | None = None,
    cond: str | None = None,
    cond_value: str | None = None,
    regime: str | None = None,
    target: str | None = None,
    kind: str | None = None,
    cross: str | None = None,
    seed: str | None = None,
):
    q = _query(study, kind=kind, shock=shock, w=w, z=z, sign=sign, cond=cond, cond_value=cond_value,
               regime=regime, target=target, cross=cross, seed=seed)
    try:
        payload = study_result(q)
    except es.StudyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except es.NotStored as exc:
        raise NotStored(str(exc)) from exc  # the app answers 503 not_stored
    except QueueFull:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(RETRY_AFTER_S), "Cache-Control": "no-store"},
            content={"status": "busy", "slug": es.slug_for(q), "retry_after": RETRY_AFTER_S,
                     "detail": f"{CACHE_MAX} studies are computing; retry in {RETRY_AFTER_S} seconds."},
        )
    slug = es.slug_for(q)
    if payload is None:
        return JSONResponse(
            status_code=202,
            headers={"Retry-After": str(RETRY_AFTER_S), "Cache-Control": "no-store"},
            content={"status": "computing", "slug": slug, "retry_after": RETRY_AFTER_S,
                     "detail": f"The study {slug} is computing; retry in {RETRY_AFTER_S} seconds."},
        )
    return {"status": "ready", **payload}
