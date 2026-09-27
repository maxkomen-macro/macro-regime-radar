"""tests/test_desk_v2_stubs.py — the Desk v2 router so far (desk/frame-3-api, B1 commit 1).

DESK_FRAME3_SPEC §12.0 and §12.13: the deferred resources are GET-only stubs
answering the awaiting envelope at once, and a removed write (`POST
/positions`, `POST /basket/price`) answers the enveloped 405 with `Allow:
GET`, while every other 405 keeps FastAPI's answer. The router's routes, the
envelope's route list and block paths are pinned to the frame-3 client's
web/src/screens/desk/data/envelope.ts (read from `DESK_WEB_SRC`, a `web/src`
directory, when this tree does not carry the client yet; skipped without it).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api import db, desk_envelope as env, desk_v2
from api import desk as desk_mod
from api import worker as worker_mod
from api.main import app
from tests import desk_contract as dc

ROOT = Path(__file__).resolve().parent.parent
WEB_SRC = Path(os.environ.get("DESK_WEB_SRC", ROOT / "web" / "src"))
ENVELOPE_TS = WEB_SRC / "screens" / "desk" / "data" / "envelope.ts"

client = TestClient(app)

STUB_PATHS = {  # (/api/desk/sectors is served since desk/fill-etf, tests/test_desk_etf.py)
    "/api/desk/vol": "/vol",
    "/api/desk/positions": "/positions",
    "/api/desk/basket/ai-infra": "/basket",
    "/api/desk/hedge?mode=protect": "/hedge",
}


@pytest.fixture()
def idle(install_worker):
    """A worker that has published nothing and would make a lookup wait a minute."""
    return install_worker(worker_mod.AnalyticsWorker(items=[], preload=False, wait_s=60))


@pytest.fixture()
def published(tmp_path, monkeypatch, install_worker):
    """A worker serving one generation of a tiny file (no items)."""
    f = tmp_path / "tiny.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    monkeypatch.setattr(db, "DB_PATH", f)
    w = install_worker(worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    return w


# ── the stubs (§12.13) ──────────────────────────────────────────────────────

@pytest.mark.parametrize("url", sorted(STUB_PATHS))
def test_each_stub_answers_awaiting_with_its_sentence(url, idle):
    route = STUB_PATHS[url]
    r = client.get(url)
    body = dc.check_response(route, r)
    assert r.status_code == 200 and body["status"] == "awaiting"
    assert body["unavailable"] == {"reason": env.DEFERRED_REASONS[route], "until": None}


def test_a_stub_never_waits_on_warming(idle):
    """Before the first generation a stub answers at once and names none (plan §3)."""
    t = time.perf_counter()
    for url in STUB_PATHS:
        body = client.get(url).json()
        assert body["status"] == "awaiting" and body["generation_id"] is None and body["as_of"] is None
    assert time.perf_counter() - t < 5, "a stub waited for a generation"
    assert idle.current is None


def test_every_stub_names_the_one_generation_it_arrived_on(published):
    gen = published.current
    bodies = [client.get(url).json() for url in STUB_PATHS]
    assert {(b["generation_id"], b["as_of"]) for b in bodies} == {(env.generation_id(gen), env.as_of(gen))}


# ── the enveloped 405 ───────────────────────────────────────────────────────

@pytest.mark.parametrize(("method", "url", "route"), [
    ("POST", "/api/desk/positions", "/positions"),
    ("POST", "/api/desk/basket/price", "/basket/price"),
    ("PUT", "/api/desk/positions", "/positions"),
    ("DELETE", "/api/desk/positions", "/positions"),
    ("PATCH", "/api/desk/basket/price", "/basket/price"),
    ("POST", "/api/desk/basket/ai-infra", "/basket"),
    ("POST", "/api/desk/hedge", "/hedge"),
])
def test_a_removed_write_answers_the_enveloped_405(method, url, route, idle):
    r = client.request(method, url, json={"id": "x"})
    assert r.status_code == 405 and r.headers["allow"] == "GET"
    body = dc.check_response(route, r)
    assert body["status"] == "error" and body["error"]["code"] == "method_not_allowed"
    assert method in body["error"]["message"]


@pytest.mark.parametrize(("method", "url"), [
    ("POST", "/api/desk/event-study"),        # api/desk.py's own contract
    ("POST", "/api/desk/pipeline/inventory"),
    ("POST", "/health"),
    ("POST", "/api/regime/latest"),
    ("POST", "/api/desk/macro"),              # not built yet: 404, or the SPA's 405 under a bundle
    ("POST", "/api/desk/basket/a/b"),         # no v2 route matches two segments
])
def test_every_other_405_keeps_fastapis_answer(method, url):
    r = client.request(method, url)
    assert r.status_code in (404, 405), r.text
    assert set(r.json()) == {"detail"}, r.text
    assert r.headers.get("cache-control") != "no-store"


def test_a_failed_schema_check_that_escapes_a_v2_handler_is_the_enveloped_503(monkeypatch, idle):
    """desk/hardening's app-level handler steps aside on the v2 routes (plan §3): a
    SchemaCheckFailed raised outside `answer` (a dependency, middleware) still answers
    the envelope's 503, with provider and retryable inside `error` (S-28)."""
    from api import provenance

    def fail(route):
        raise provenance.SchemaCheckFailed("could not read whether desk_series carries provenance")

    monkeypatch.setattr(env, "deferred", fail)
    tc = TestClient(app, raise_server_exceptions=False)
    r = tc.get("/api/desk/vol")
    body = dc.check_response("/vol", r)
    assert r.status_code == 503 and body["error"] == {
        "code": "schema_check", "message": "could not read whether desk_series carries provenance",
        "provider": "api", "retryable": True}


def test_off_the_v2_routes_the_schema_check_answer_is_hardenings():
    import asyncio

    from starlette.requests import Request

    from api import main, provenance

    exc = provenance.SchemaCheckFailed("could not read")
    for path in ("/api/freshness", "/api/desk/pipeline/inventory", "/api/desk/event-study"):
        req = Request({"type": "http", "method": "GET", "path": path, "query_string": b"", "headers": [],
                       "scheme": "http", "server": ("testserver", 80), "root_path": ""})
        r = asyncio.run(main._schema_check_failed(req, exc))
        assert r.status_code == 503 and json.loads(r.body) == desk_mod.schema_error_body(exc), path


def test_the_405_scope_is_the_routers_own_paths():
    assert desk_v2.serves("/api/desk/positions") and desk_v2.serves("/api/desk/basket/anything")
    assert not desk_v2.serves("/api/desk/basket/a/b") and not desk_v2.serves("/api/desk/event-study")
    assert not desk_v2.serves("/api/deskpositions") and not desk_v2.serves("/positions")


# ── the router ──────────────────────────────────────────────────────────────

def _v2_routes() -> list[tuple[str, list[str]]]:
    return sorted((r.path, sorted(r.methods)) for r in desk_v2.router.routes if isinstance(r, APIRoute))


def test_the_v2_router_is_get_only_and_every_route_is_enveloped():
    routes = _v2_routes()
    assert routes == sorted([
        ("/api/desk/sectors", ["GET"]), ("/api/desk/vol", ["GET"]), ("/api/desk/positions", ["GET"]),
        ("/api/desk/basket/price", ["GET"]), ("/api/desk/basket/{basket_id}", ["GET"]), ("/api/desk/hedge", ["GET"]),
        ("/api/desk/study", ["GET"]), ("/api/desk/study/catalog", ["GET"]), ("/api/desk/study/events", ["GET"]),
        ("/api/desk/ledger", ["GET"]), ("/api/desk/technicals", ["GET"]), ("/api/desk/overview", ["GET"]),
    ])
    for path, _ in routes:
        route = env.route_of(re.sub(r"\{[^}]+\}", "x", path)[len(desk_v2.PREFIX):])
        assert route in env.ENVELOPED_ROUTES, path


def test_basket_price_is_not_read_as_a_basket_id():
    order = [r.path for r in desk_v2.router.routes if isinstance(r, APIRoute)]
    assert order.index("/api/desk/basket/price") < order.index("/api/desk/basket/{basket_id}")


def test_the_v2_routes_share_no_path_with_api_desk():
    """api/desk.py's routes keep their contracts (§12.0): no v2 route shadows one."""
    old = {r.path for r in desk_mod.router.routes}
    assert not old & {p for p, _ in _v2_routes()}


def test_the_app_serves_the_v2_routes():
    """FastAPI keeps an included router as one entry of app.routes (CLAUDE.md
    gotcha), so the served paths are read from the schema."""
    assert {p for p, _ in _v2_routes()} <= set(app.openapi()["paths"])


# ── the client's constants (web/src/screens/desk/data/envelope.ts) ──────────

def _ts_source() -> str:
    if not ENVELOPE_TS.exists():
        pytest.skip(f"no frame-3 client at {ENVELOPE_TS} (set DESK_WEB_SRC to a web/src that carries it)")
    return ENVELOPE_TS.read_text()


def test_the_enveloped_routes_are_the_clients():
    m = re.search(r"export const ENVELOPED_ROUTES[^=]*=\s*\[(.*?)\];", _ts_source(), re.S)
    assert m, "ENVELOPED_ROUTES not found in envelope.ts"
    assert tuple(re.findall(r'"([^"]+)"', m.group(1))) == env.ENVELOPED_ROUTES
    assert set(env.ENVELOPED_ROUTES) == set(dc.ROUTES) | set(dc.STUBS)


def test_the_block_paths_are_the_clients_and_the_specs():
    m = re.search(r"export const NESTED_PATHS[^=]*=\s*\{(.*?)\n\};", _ts_source(), re.S)
    assert m, "NESTED_PATHS not found in envelope.ts"
    ts = {route: tuple(re.findall(r'"([^"]+)"', paths))
          for route, paths in re.findall(r'"(/[^"]+)":\s*\[([^\]]*)\]', m.group(1))}
    assert ts == env.NESTED_PATHS == dc.nested_paths()


def test_the_clients_route_of_reads_as_ours():
    src = _ts_source()
    assert 'path.startsWith("/basket/") && path !== "/basket/price" ? "/basket" : path' in src
