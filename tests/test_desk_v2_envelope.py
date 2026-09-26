"""tests/test_desk_v2_envelope.py — the §12.0 envelope and the error map (desk/frame-3-api, B1).

api/desk_envelope.py, row by row of docs/desk/FRAME3_API_PLAN.md §3: the
envelope's state rules, the blocks (S-27), the generation it names (S-11,
S-21), `engine_version` (S-21), and `answer`'s map from what a handler raises
to a status, a code and headers. The routes that use it are tested in
tests/test_desk_v2_stubs.py.
"""

from __future__ import annotations

import ast
import json
import logging
import os
import sqlite3
import subprocess
import sys
import types
from pathlib import Path

import pytest

from api import db, desk_envelope as env
from api import worker as worker_mod
from tests import desk_contract as dc

ROOT = Path(__file__).resolve().parent.parent


def _body(r: env.Reply) -> dict:
    return json.loads(r.body)


@pytest.fixture()
def a_generation(tmp_path, monkeypatch, install_worker):
    """A worker serving one generation of a tiny file: `answer` pins it (Codex R-01)."""
    return _published(tmp_path, monkeypatch, install_worker)


# ── engine_version (S-21) ───────────────────────────────────────────────────

@pytest.mark.parametrize(("environ", "expected"), [
    ({"ENGINE_VERSION": "abc123", "RENDER_GIT_COMMIT": "def456"}, "abc123"),
    ({"ENGINE_VERSION": "abc123"}, "abc123"),
    ({"ENGINE_VERSION": " abc123 "}, "abc123"),
    ({"RENDER_GIT_COMMIT": "def456"}, "def456"),
    ({"ENGINE_VERSION": "", "RENDER_GIT_COMMIT": "def456"}, "def456"),
    ({"ENGINE_VERSION": "   ", "RENDER_GIT_COMMIT": "def456"}, "def456"),
    ({"ENGINE_VERSION": "unknown", "RENDER_GIT_COMMIT": "def456"}, "def456"),  # the Dockerfile ARG's default
    ({}, "unknown"),
    ({"ENGINE_VERSION": "unknown"}, "unknown"),
    ({"ENGINE_VERSION": "", "RENDER_GIT_COMMIT": ""}, "unknown"),
])
def test_engine_version_is_the_build_then_the_host_commit(environ, expected):
    assert env.resolve_engine_version(environ) == expected


@pytest.mark.parametrize(("extra", "expected"), [
    ({"ENGINE_VERSION": "abc123", "RENDER_GIT_COMMIT": "def456"}, "abc123"),
    ({"ENGINE_VERSION": "unknown", "RENDER_GIT_COMMIT": "def456"}, "def456"),
    ({}, "unknown"),
])
def test_engine_version_is_read_from_the_environment_at_import(extra, expected):
    base = {k: v for k, v in os.environ.items() if k not in ("ENGINE_VERSION", "RENDER_GIT_COMMIT")}
    out = subprocess.run([sys.executable, "-c", "import api.desk_envelope as e; print(e.ENGINE_VERSION)"],
                         cwd=ROOT, env={**base, **extra}, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == expected


def test_every_envelope_carries_the_engine_version(monkeypatch, a_generation):
    monkeypatch.setattr(env, "ENGINE_VERSION", "cafef00d")
    for r in (env.answer("/ledger", lambda: {"x": 1}),
              env.answer("/study", _raise(env.Unsupported("no"))),
              env.answer("/overview", _raise(worker_mod.Warming())),
              env.deferred("/vol"),
              env.method_not_allowed("POST")):
        assert _body(r)["engine_version"] == "cafef00d"


# ── the envelope's state rules (§12.0) ──────────────────────────────────────

def test_envelope_serves_each_part_only_in_its_state():
    assert env.envelope("ready", data={"a": 1})["data"] == {"a": 1}
    assert env.envelope("awaiting", unavailable=env.unavailable("r"))["unavailable"] == {"reason": "r", "until": None}
    assert env.envelope("error", error={"code": "c", "message": "m"})["error"]["code"] == "c"
    e = env.envelope("computing")
    assert (e["data"], e["unavailable"], e["error"], e["generation_id"], e["as_of"]) == (None,) * 5
    assert list(e) == list(dc.ENVELOPE_KEYS)
    for bad in (lambda: env.envelope("ready"),
                lambda: env.envelope("awaiting", data={"a": 1}, unavailable=env.unavailable("r")),
                lambda: env.envelope("awaiting"),
                lambda: env.envelope("error"),
                lambda: env.envelope("computing", error={"code": "c", "message": "m"}),
                lambda: env.envelope("done")):
        with pytest.raises(ValueError):
            bad()
    with pytest.raises(ValueError):
        env.unavailable("  ")
    with pytest.raises(ValueError):
        env.Awaiting("")


def test_before_any_publication_answer_waits_then_answers_computing(tmp_path, monkeypatch, install_worker):
    """Codex R-01: `answer` pins a generation before the body runs; with none
    published within the worker's wait, the body never runs and the answer is
    202 computing, naming no generation."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "absent.db")
    install_worker(worker_mod.AnalyticsWorker(items=[], preload=False, wait_s=0.3))
    ran = []
    r = env.answer("/ledger", lambda: ran.append(1) or {"x": 1})
    b = _body(r)
    assert r.status_code == 202 and b["status"] == "computing" and b["generation_id"] is None and ran == []


def test_a_computing_answer_names_no_generation(tmp_path, monkeypatch, install_worker):
    gen = _published(tmp_path, monkeypatch, install_worker)
    assert gen is not None
    e = env.envelope("computing", gen=gen)
    assert e["generation_id"] is None and e["as_of"] is None


# ── the generation an answer names ──────────────────────────────────────────

def _published(tmp_path, monkeypatch, install_worker):
    f = tmp_path / "tiny.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    monkeypatch.setattr(db, "DB_PATH", f)
    w = install_worker(worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    return w.current


def test_generation_id_names_the_generation_and_its_file():
    a = types.SimpleNamespace(id=7, key=(1, 2, 3))
    b = types.SimpleNamespace(id=7, key=(1, 2, 4))
    ga, gb = env.generation_id(a), env.generation_id(b)
    assert ga.startswith("g7-") and len(ga) == len("g7-") + 10 and int(ga[3:], 16) >= 0
    assert ga == env.generation_id(types.SimpleNamespace(id=7, key=(1, 2, 3))) and ga != gb
    assert env.generation_id(None) is None


@pytest.mark.parametrize(("staged_at", "as_of"), [
    ("2026-09-26T02:30:00Z", "2026-09-25"),  # 22:30 the evening before in New York
    ("2026-09-26T15:00:00Z", "2026-09-26"),
    ("2026-03-08T04:59:59Z", "2026-03-07"),  # EST, the night the clocks change
    ("2026-03-08T05:00:00Z", "2026-03-08"),
])
def test_as_of_is_the_new_york_date_the_generation_was_staged(staged_at, as_of):
    assert env.as_of(types.SimpleNamespace(id=1, key=(), staged_at=staged_at)) == as_of


def test_as_of_prefers_the_generations_own_stamp():
    # desk/hardening's Generation carries as_of (the same NY date) beside staged_at.
    gen = types.SimpleNamespace(id=1, key=(), staged_at="2026-09-26T02:30:00Z", as_of="2026-09-25")
    assert env.as_of(gen) == "2026-09-25"
    assert env.as_of(types.SimpleNamespace(id=1, key=(), staged_at="")) is None
    assert env.as_of(None) is None


def test_an_answer_names_the_published_generation(tmp_path, monkeypatch, install_worker):
    gen = _published(tmp_path, monkeypatch, install_worker)
    b = _body(env.answer("/ledger", lambda: {"x": 1}))
    assert b["generation_id"] == env.generation_id(gen) and b["as_of"] == env.as_of(gen)
    assert b["as_of"] is not None and len(b["as_of"]) == 10


# ── answer: the error map (plan §3), one row each ───────────────────────────

def _raise(exc):
    def fn():
        raise exc
    return fn


def test_a_payload_is_ready(a_generation):
    r = env.answer("/ledger", lambda: {"x": 1.25, "y": [None, "a"]})
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store" and r.media_type == "application/json"
    assert _body(r)["status"] == "ready" and _body(r)["data"] == {"x": 1.25, "y": [None, "a"]}


def test_awaiting_is_200_with_its_reason(a_generation):
    r = env.answer("/study", _raise(env.Awaiting("the inputs are not stored", until="2026-10-01")))
    b = _body(r)
    assert r.status_code == 200 and b["status"] == "awaiting" and b["data"] is None
    assert b["unavailable"] == {"reason": "the inputs are not stored", "until": "2026-10-01"}


def test_an_unsupported_request_is_422_naming_what(a_generation):
    r = env.answer("/study", _raise(env.Unsupported("confidence is not a parameter of /study")))
    b = _body(r)
    assert r.status_code == 422 and b["error"] == {"code": "unsupported", "message": "confidence is not a parameter of /study"}
    dc.check("/study", r.body)


def test_the_engines_validation_is_422_in_its_own_words(a_generation):
    from src.desk import event_study as es

    r = env.answer("/study", _raise(es.StudyError("window must be one of 5, 20, 60")))
    assert r.status_code == 422 and _body(r)["error"] == {"code": "unsupported", "message": "window must be one of 5, 20, 60"}


def test_warming_is_202_computing_with_no_generation(tmp_path, monkeypatch, install_worker):
    _published(tmp_path, monkeypatch, install_worker)  # even with a generation at hand, S-11
    r = env.answer("/overview", _raise(worker_mod.Warming()))
    b = _body(r)
    assert r.status_code == 202 and r.headers["Retry-After"] == "2" and r.headers["Cache-Control"] == "no-store"
    assert b["status"] == "computing" and b["generation_id"] is None and b["as_of"] is None
    assert b["data"] is None and b["unavailable"] is None and b["error"] is None


def test_an_unavailable_database_is_503_with_a_sanitized_message(a_generation):
    r = env.answer("/regime", _raise(db.DBUnavailable("database file not found at /srv/data/macro_radar.db")))
    assert r.status_code == 503
    assert _body(r)["error"] == {"code": "db_unavailable", "message": "The database is not available on this server."}
    r = env.answer("/regime", _raise(db.DBUnavailable("no regime rows")))
    assert _body(r)["error"]["message"] == "no regime rows"


def test_the_sanitizing_rule_is_api_mains():
    from api import main

    for text in ("plain words", "a /path/in/it", "C:\\windows", "", "unit 5/10"):
        exc = RuntimeError(text)
        assert env.sanitized(exc) == main._sanitized(exc), text


def test_a_failed_schema_check_is_503_retryable(a_generation, monkeypatch):
    """desk/hardening's api.provenance.SchemaCheckFailed (a sqlite3.OperationalError) is matched by
    its own class once its module is loaded; here a stand-in module plays it."""
    fake = types.ModuleType("api.provenance")

    class SchemaCheckFailed(sqlite3.OperationalError):
        pass

    fake.SchemaCheckFailed = SchemaCheckFailed
    monkeypatch.setitem(sys.modules, "api.provenance", fake)
    r = env.answer("/pipeline", _raise(SchemaCheckFailed("could not read the provenance columns after 4 tries")))
    assert r.status_code == 503
    assert _body(r)["error"] == {"code": "schema_check", "message": "could not read the provenance columns after 4 tries",
                                 "retryable": True, "provider": "api"}
    dc.check("/pipeline", r.body)
    # a plain OperationalError is not a failed schema check
    assert env.answer("/pipeline", _raise(sqlite3.OperationalError("locked"))).status_code == 500


def test_the_real_schema_check_failure_once_hardening_lands(a_generation):
    provenance = pytest.importorskip("api.provenance")
    r = env.answer("/pipeline", _raise(provenance.SchemaCheckFailed("could not read")))
    assert r.status_code == 503 and _body(r)["error"]["code"] == "schema_check"


def test_anything_else_is_500_internal_and_logged(a_generation, caplog):
    with caplog.at_level(logging.ERROR, logger="mrr.desk"):
        r = env.answer("/technicals", _raise(KeyError("no result named 'desk_technicals'")))
    assert r.status_code == 500
    assert _body(r)["error"] == {"code": "internal", "message": "Internal error. The incident is logged server-side."}
    assert any("KeyError" in rec.getMessage() and rec.exc_info for rec in caplog.records)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_a_non_finite_number_is_a_500_never_on_the_wire(a_generation, bad):
    r = env.answer("/technicals", lambda: {"price": 1.0, "series": [{"close": bad}]})
    assert r.status_code == 500 and b"NaN" not in r.body and b"Infinity" not in r.body
    assert _body(r)["error"]["code"] == "internal"


def test_a_payload_that_cannot_be_serialized_is_a_500(a_generation):
    assert env.answer("/ledger", lambda: {"when": object()}).status_code == 500
    assert env.answer("/ledger", lambda: ["not", "a", "payload"]).status_code == 500
    assert env.answer("/ledger", lambda: None).status_code == 500


def test_the_405_names_get(a_generation):
    r = env.method_not_allowed("POST")
    assert r.status_code == 405 and r.headers == {"Cache-Control": "no-store", "Allow": "GET"}
    assert _body(r)["error"]["code"] == "method_not_allowed"
    dc.check("/positions", r.body)


# ── blocks (§12.0, S-27) ────────────────────────────────────────────────────

def test_block_shapes():
    assert env.block_ready({"a": 1}) == {"status": "ready", "data": {"a": 1}, "unavailable": None}
    assert env.block_ready([]) == {"status": "ready", "data": [], "unavailable": None}
    assert env.block_awaiting("why") == {"status": "awaiting", "data": None, "unavailable": {"reason": "why", "until": None}}
    with pytest.raises(ValueError):
        env.block_ready(None)
    for (route, path), reason in env.DEFERRED_BLOCKS.items():
        assert env.block_deferred(route, path)["unavailable"]["reason"] == reason


def test_a_block_is_ready_awaiting_or_failed():
    assert env.block_from("/regime", "current", lambda: {"label": "Goldilocks"})["status"] == "ready"
    b = env.block_from("/regime", "recession", _raise(env.Awaiting("the recession model has no data")))
    assert b == {"status": "awaiting", "data": None, "unavailable": {"reason": "the recession model has no data", "until": None}}
    b = env.block_from("/macro", "credit", _raise(ZeroDivisionError("x")))
    assert b["unavailable"]["reason"] == "Awaiting refresh: this could not be computed from the current data."


def test_a_fact_about_the_whole_answer_is_never_one_blocks():
    for exc in (worker_mod.Warming(), db.DBUnavailable("gone")):
        with pytest.raises(type(exc)):
            env.block_from("/overview", "tiles.vol", _raise(exc))


def test_a_failed_block_inside_a_ready_answer(a_generation, caplog):
    def fn():
        return {"stats": env.block_from("/regime", "stats", _raise(RuntimeError("boom")))}

    with caplog.at_level(logging.ERROR, logger="mrr.desk"):
        r = env.answer("/regime", fn)
    assert r.status_code == 200 and _body(r)["data"]["stats"]["status"] == "awaiting"
    assert any("stats" in rec.getMessage() for rec in caplog.records)


# ── the served sentences ────────────────────────────────────────────────────

def test_the_sentences_are_the_specs():
    """§1.0, §12.3's served reasons (S-17), §12.6–§12.8, §12.13, S-27: the
    transcription in tests/desk_contract.py is the second copy."""
    assert env.DEFERRED_REASONS == dc.STUBS
    declared = {}
    for route, t in dc.ROUTES.items():
        for path in dc.block_paths(t):
            node = t
            for part in path.split("."):
                node = node.fields[part]
            if isinstance(node, dc.Deferred):
                declared[(route, path)] = node.reason
    assert env.DEFERRED_BLOCKS == declared
    assert env.RSI_REASON == "RSI is not computed yet."
    # The spec, or the plan's §6 (S-17, S-27) until this tree carries the spec's errata fold.
    docs = "".join((ROOT / "docs" / "desk" / name).read_text() for name in ("DESK_FRAME3_SPEC.md", "FRAME3_API_PLAN.md"))
    for sentence in {*env.DEFERRED_REASONS.values(), *env.DEFERRED_BLOCKS.values(), env.RSI_REASON, env.BLOCK_FAILED_REASON}:
        assert sentence.rstrip(".") in docs, sentence


def test_route_of_reads_a_basket_id_as_basket():
    assert env.route_of("/basket/ai-infra") == "/basket"
    assert env.route_of("/basket/price") == "/basket/price"
    assert env.route_of("/study/events") == "/study/events"
    assert env.route_of("/basket") == "/basket"


# ── weight ──────────────────────────────────────────────────────────────────

def _imports(path: Path) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def test_the_new_modules_never_import_src_config_or_anything_heavy():
    """CLAUDE.md (FastAPI section): api/ runs without FRED_API_KEY and imports no
    heavy dependency at module import; the envelope module is stdlib apart from
    api.calendar (itself stdlib)."""
    for name in ("api/desk_envelope.py", "api/desk_v2.py"):
        mods = _imports(ROOT / name)
        assert not any(m == "src.config" or m.startswith("src.config.") for m in mods), (name, mods)
    project = {m for m in _imports(ROOT / "api" / "desk_envelope.py") if m.split(".")[0] in ("api", "src")}
    # api.worker and src.analytics (dbpath, stdlib) only inside the functions that pin and name the generation
    assert project == {"api.calendar", "api.worker", "src.analytics"}, project
    heavy = ("pandas", "numpy", "sklearn", "scipy", "exchange_calendars", "riskfolio", "anthropic", "src.config",
             "src.desk.event_study")
    code = f"import sys, api.desk_envelope, api.desk_v2; print(sorted(m for m in {heavy!r} if m in sys.modules))"
    base = {k: v for k, v in os.environ.items() if k != "FRED_API_KEY"}
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=base, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "[]"
