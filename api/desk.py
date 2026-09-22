"""api/desk.py — the Desk's endpoints, one router (desk/integration, 2026-09-22).

Two branches built this module apart and it carries both route sets:
desk/event-study's event-study endpoints (the base: its queue, cache,
generation lease and validation) and desk/frame's pipeline inventory.

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

GET /api/desk/pipeline/inventory  (desk/frame, docs/desk/DESK_FRAME_SPEC.md §7)
    The series inventory the Data Pipeline page prints. It joins the
    per-series freshness states ``api/freshness.py`` already judges (the same
    ``series[]`` that ``/api/freshness`` serves, so the two can never
    disagree) with two static facts about each source: which provider
    publishes it and which modules read it. No analytics, no computation,
    nothing written. ``/api/desk/positions`` (§7, "if a store exists") is not
    here: positions live in the visitor's browser (§5), the app has no
    accounts and no store.

``api/`` never imports ``src.config`` (it needs ``FRED_API_KEY``); the engine
and the registry it reads are config-free.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import replace
from typing import Any, Callable, TypeVar

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api import bootstrap, db, stream
from api import freshness as freshness_mod
from api.db import NotStored
from src.analytics import dbpath


class _Engine:
    """src.desk.event_study, imported on first use (desk/integration). The
    engine loads pandas, numpy and exchange_calendars at import, and api/
    imports no heavy dependency at module import (CLAUDE.md, FastAPI section),
    so `import api.main` stays as light as it was before the Desk. The worker's
    first build (desk_assets, the presets) or the first study loads it; every
    `es.<name>` below reads the real module, monkeypatches included."""

    def __getattr__(self, name: str) -> Any:
        from src.desk import event_study

        return getattr(event_study, name)


es = _Engine()

router = APIRouter(prefix="/api/desk")

# ── Event study (desk/event-study) ──────────────────────────────────────────

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


# ── Pipeline inventory (desk/frame) ─────────────────────────────────────────

T = TypeVar("T")


def _guarded(fn: Callable[[], T]) -> T:
    """A missing or unopenable database is a 503, never a 500 (api/main.py idiom)."""
    try:
        return fn()
    except db.DBUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# Provider per source. FRED series carry their own id as the source id; the
# stored market tables name the pipeline client that wrote them (CLAUDE.md,
# Data Source Rules); the relay names EODHD.
SOURCE_BY_ID: dict[str, str] = {
    "market_daily": "yfinance (stored daily bars)",
    "market_intraday": "yfinance (stored 5-min bars)",
    "asset_prices": "EODHD first, Yahoo disclosed fallback (stored)",
    "live_quotes": "EODHD relay",
    "vix_delayed": "EODHD REST (delayed)",
    "lbo_all_in_rate": "derived: FEDFUNDS + BAMLH0A0HYM2",
}
SOURCE_BY_KIND: dict[str, str] = {
    "fred": "FRED",
    "market": "stored market data",
    "live": "EODHD relay",
    "derived": "derived",
}

# The modules that read each series, in reader words. Regime, signal and
# recession inputs follow api/freshness.MONTHLY_INPUTS / DAILY_INPUTS and
# api/main.RECESSION_INPUTS; credit and priced series follow the tabs that
# print them (web/src/screens/shared/fresh-state.ts groups).
REGIME = "Regime classifier"
SIGNALS = "Monitored signals"
RECESSION = "Recession model"
CREDIT = "Credit"
PRICED = "What's priced"
LBO = "LBO all-in rate"
MARKETS = "Markets"
DASHBOARD = "Dashboard key levels"
ALLOCATION = "Asset allocation"
TAPE = "Live tape"
DESK_POSITIONS = "Desk · Position Monitor"

FEEDS: dict[str, list[str]] = {
    "INDPRO": [REGIME, SIGNALS, RECESSION],
    "CPIAUCSL": [REGIME, SIGNALS],
    "UNRATE": [REGIME, SIGNALS, RECESSION],
    "DGS10": [SIGNALS, RECESSION, CREDIT, DASHBOARD, DESK_POSITIONS],
    "DGS2": [SIGNALS, RECESSION, DASHBOARD],
    "VIXCLS": [SIGNALS, DASHBOARD, DESK_POSITIONS],
    "BAMLH0A0HYM2": [SIGNALS, RECESSION, CREDIT, LBO, DESK_POSITIONS],
    "BAMLC0A0CM": [CREDIT],
    "BAMLH0A1HYBB": [CREDIT],
    "BAMLH0A2HYB": [CREDIT],
    "BAMLH0A3HYC": [CREDIT],
    "T10YIE": [RECESSION, PRICED],
    "T5YIE": [RECESSION, PRICED],
    "DFII10": [PRICED],
    "DFII5": [PRICED],
    "SOFR": [PRICED],
    "FEDFUNDS": [PRICED, LBO],
    "USREC": [f"{RECESSION} (training target)"],
    "USSLIND": [f"{RECESSION} (staleness probe only; discontinued Feb 2020)"],
    "market_daily": [MARKETS, DASHBOARD, "Quote cards", DESK_POSITIONS],
    "market_intraday": [MARKETS, "Quote cards"],
    "asset_prices": [ALLOCATION],
    "live_quotes": [TAPE, "Watchlist"],
    "vix_delayed": [TAPE],
    "lbo_all_in_rate": ["Tools · LBO calculator"],
}


class InventoryRow(BaseModel):
    id: str
    label: str
    kind: str
    cadence: str
    as_of: str | None
    state: str
    delay_min: int | None
    cycles_behind: int | None
    stale: bool
    discontinued: bool
    reason: str
    source: str
    source_id: str | None
    feeds: list[str]


class PipelineInventory(BaseModel):
    generated_at: str | None
    overall: str | None
    regimes_date: str | None
    signals_date: str | None
    market_daily_date: str | None
    market_intraday_ts: str | None
    news_published_at: str | None
    raw_series_date: str | None
    series: list[InventoryRow]


def inventory_rows(series: list[dict]) -> list[dict]:
    """Pure: the freshness ``series[]`` rows with their provider and readers."""
    rows: list[dict] = []
    for s in series:
        sid = str(s.get("id", ""))
        kind = str(s.get("kind", ""))
        rows.append(
            {
                **s,
                "source": SOURCE_BY_ID.get(sid) or SOURCE_BY_KIND.get(kind, kind or "unknown"),
                "source_id": sid if kind == "fred" else None,
                "feeds": list(FEEDS.get(sid, [])),
            }
        )
    return rows


@router.get("/pipeline/inventory", response_model=PipelineInventory)
def pipeline_inventory() -> PipelineInventory:
    """Every stored source with its provider, cadence, true as-of date, the
    server's freshness state and the modules that read it. The states are the
    ones ``/api/freshness`` serves (api/freshness.assess), joined here with
    the static provider and reader facts; nothing is computed."""
    base = _guarded(db.freshness)
    series = _guarded(db.latest_series_all)
    marks = _guarded(db.watermarks)
    report = freshness_mod.assess(
        db_fresh=base, series_latest=series, relay=stream.hub.debug(), bootstrap=bootstrap.status(), watermarks=marks
    )
    return PipelineInventory(
        generated_at=report.get("generated_at"),
        overall=report.get("overall"),
        **{k: report.get(k) for k in ("regimes_date", "signals_date", "market_daily_date", "market_intraday_ts", "news_published_at", "raw_series_date")},
        series=[InventoryRow(**r) for r in inventory_rows(report.get("series") or [])],
    )
