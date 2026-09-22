"""tests/test_public_posture.py — the gaps the SQL-guard re-audit found (launch-1).

An independent verifier re-checked proposals/API_SQLGUARD_AUDIT.md §3 and
proposals/FINAL_SECURITY_REVIEW.md §1c against this branch. These pin the
fixes for what it found still open:

NG-1  the public posture hung on CORS_ORIGINS, which the same-origin deploy
      does not set, so that shape shipped an open assistant and open ops views
NG-2  the generation connection was read-only by PRAGMA query_only, which SQL
      can flip; the guard was the only thing standing in the way
NG-3  the assistant had a rate limit but no concurrency ceiling on a sync route
F6    503 bodies disclosed the database's absolute path
SR-2d the assistant echoed raw Anthropic error text to any caller
F7    interactive docs and the OpenAPI schema were served on a public deploy
F8    the `symbols` CSV had no count cap
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import db, security
from api.main import app
from src.analytics import dbpath

client = TestClient(app)


# ── NG-1: the posture does not depend on CORS_ORIGINS ───────────────────────


def test_public_posture_does_not_depend_on_cors_origins(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("ASSISTANT_ACCESS", raising=False)
    monkeypatch.delenv("OPS_ACCESS_KEY", raising=False)
    monkeypatch.setenv("DEPLOY_PUBLIC", "1")
    assert security.is_public_deploy() is True
    assert security.assistant_mode() == "off", "a public deploy must not default the assistant open"
    for path in ("/api/providers/status", "/api/stream/debug"):
        r = client.get(path)
        assert r.status_code == 503 and "ops key" in r.json()["detail"].lower(), path


def test_development_stays_open_when_nothing_is_set(monkeypatch):
    for var in ("CORS_ORIGINS", "ASSISTANT_ACCESS", "OPS_ACCESS_KEY", "DEPLOY_PUBLIC"):
        monkeypatch.delenv(var, raising=False)
    assert security.is_public_deploy() is False
    assert security.assistant_mode() == "open"
    assert client.get("/api/stream/debug").status_code == 200


def test_an_explicit_assistant_mode_still_wins(monkeypatch):
    monkeypatch.setenv("DEPLOY_PUBLIC", "1")
    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    assert security.assistant_mode() == "open"


# ── NG-2: the generation copy cannot be made writable by SQL ────────────────


def test_a_generation_connection_refuses_writes_even_after_query_only_is_flipped(tmp_path):
    src = tmp_path / "gen.db"
    seed = sqlite3.connect(src)
    seed.execute("CREATE TABLE t (a INTEGER)")
    seed.execute("INSERT INTO t VALUES (1)")
    seed.commit()
    anchor = sqlite3.connect("file:mrr-gen-test-posture?mode=memory&cache=shared", uri=True)
    seed.backup(anchor)
    seed.close()

    class _Gen:
        uri = "file:mrr-gen-test-posture?mode=memory&cache=shared"
        source = src
        key = (0, 0, 0)

    try:
        conn = dbpath.open_generation(_Gen())
        assert conn is not None
        assert conn.execute("SELECT a FROM t").fetchone()[0] == 1
        with pytest.raises(sqlite3.Error):
            conn.execute("INSERT INTO t VALUES (2)")
        # The guard bans PRAGMA, so this is defence in depth: even if a flip
        # got through, the connection must still refuse to write.
        with pytest.raises(sqlite3.Error):
            conn.execute("PRAGMA query_only = 0")
            conn.execute("INSERT INTO t VALUES (3)")
        conn.close()
    finally:
        anchor.close()


# ── NG-3: the assistant has a concurrency ceiling ───────────────────────────


def test_the_assistant_has_a_concurrency_ceiling(monkeypatch):
    mw = security.SecurityMiddleware(lambda *a: None)
    assert mw.assistant._initial_value == security.ASSISTANT_MAX_CONCURRENCY
    assert 1 <= security.ASSISTANT_MAX_CONCURRENCY <= 8


def test_the_assistant_sheds_load_beyond_its_ceiling(monkeypatch):
    import threading

    from fastapi import FastAPI

    monkeypatch.setenv("ASSISTANT_ACCESS", "open")
    release = threading.Event()
    app2 = FastAPI()

    @app2.post("/api/assistant/ask")
    def ask(body: dict):
        release.wait(5)
        return {"ok": True}

    app2.add_middleware(security.SecurityMiddleware, assistant_slots=1)
    c = TestClient(app2)
    codes: list[int] = []
    t = threading.Thread(target=lambda: codes.append(c.post("/api/assistant/ask", json={"m": 1}).status_code))
    t.start()
    try:
        import time

        time.sleep(0.2)
        r = c.post("/api/assistant/ask", json={"m": 2})
        assert r.status_code == 429 and r.headers.get("retry-after")
    finally:
        release.set()
        t.join(10)
    assert codes == [200]


# ── F6: no filesystem path in an error body ─────────────────────────────────


def test_a_missing_database_does_not_disclose_its_path(monkeypatch):
    from pathlib import Path

    missing = Path("/nonexistent-launch-1/macro_radar.db")
    monkeypatch.setattr(db, "DB_PATH", missing)
    monkeypatch.setattr(dbpath, "_provider", None)
    r = client.get("/api/regime/latest")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "nonexistent-launch-1" not in detail and "/" not in detail, detail
    ready = client.get("/health/ready")
    assert ready.status_code == 503
    assert "nonexistent-launch-1" not in str(ready.json())


# ── SR-2d: upstream error text never reaches a visitor ──────────────────────


def test_an_agent_error_reaches_the_visitor_as_a_plain_sentence(monkeypatch):
    import api.chat as api_chat
    from src.analytics import chat as chat_mod

    class _Boom:
        def ask_streaming(self, user_msg, history=None):
            raise chat_mod.AgentError(
                "Anthropic API error: 500 claude-sonnet-4-5-20250929 request_id=req_abc123 upstream body"
            )
            yield  # pragma: no cover

    monkeypatch.setattr(api_chat, "_agent", _Boom())
    r = client.post("/api/assistant/ask", json={"message": "hi", "history": []})
    assert r.status_code == 200
    body = r.text
    assert "event: error" in body
    for leak in ("claude-sonnet", "request_id", "req_abc123", "upstream body", "500"):
        assert leak not in body, leak


# ── F7 / F8: docs closed on a public deploy, symbols bounded ────────────────


def test_symbols_csv_is_bounded():
    many = ",".join(f"SYM{i}" for i in range(500))
    for path in ("/api/market/daily", "/api/market/intraday"):
        r = client.get(path, params={"symbols": many})
        assert r.status_code == 422, path
        assert "symbols" in str(r.json()).lower()


def test_docs_are_closed_on_a_public_deploy(monkeypatch):
    monkeypatch.setenv("DEPLOY_PUBLIC", "1")
    from api import main as main_mod

    assert main_mod.docs_enabled() is False
    monkeypatch.delenv("DEPLOY_PUBLIC", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert main_mod.docs_enabled() is True


def test_the_generation_still_answers_the_pragmas_a_read_needs(tmp_path):
    """The authorizer must not break ordinary reads: callers check for a column
    with PRAGMA table_info before reading it, and the snapshot builder does it
    on every table."""
    src = tmp_path / "gen2.db"
    seed = sqlite3.connect(src)
    seed.execute("CREATE TABLE t (a INTEGER, b TEXT)")
    seed.commit()
    anchor = sqlite3.connect("file:mrr-gen-test-pragma?mode=memory&cache=shared", uri=True)
    seed.backup(anchor)
    seed.close()

    class _Gen:
        uri = "file:mrr-gen-test-pragma?mode=memory&cache=shared"
        source = src
        key = (0, 0, 0)

    try:
        conn = dbpath.open_generation(_Gen())
        assert conn is not None
        cols = {r[1] for r in conn.execute("PRAGMA table_info(t)")}
        assert cols == {"a", "b"}
        assert conn.execute("PRAGMA quick_check").fetchone() is not None
        with pytest.raises(sqlite3.Error):
            conn.execute("PRAGMA query_only = 0")
        with pytest.raises(sqlite3.Error):
            conn.execute("PRAGMA journal_mode = WAL")
        conn.close()
    finally:
        anchor.close()



def test_a_non_ascii_ops_key_is_refused_not_a_crash(monkeypatch):
    """Verify loop 1, defect 6, on the diagnostics gate."""
    monkeypatch.setenv("OPS_ACCESS_KEY", "ops-s3cret")
    r = client.get("/api/stream/debug", headers={"x-ops-key": b"caf\xe9"})
    assert r.status_code == 401
    assert client.get("/api/stream/debug", headers={"x-ops-key": "wrong"}).status_code == 401


# ── launch-1 verify loop 1 (item 3) ─────────────────────────────────────────


def test_whoami_reports_what_the_gates_see_behind_the_ops_key(monkeypatch):
    """After a deploy the owner checks that the rate limits key on their own
    address, not on a proxy's. Closed like every diagnostic."""
    monkeypatch.setenv("OPS_ACCESS_KEY", "ops-s3cret")
    assert client.get("/api/ops/whoami").status_code == 401
    r = client.get("/api/ops/whoami", headers={"x-ops-key": "ops-s3cret", "x-forwarded-for": "198.51.100.7"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"client_id", "peer", "forwarded_for_entries", "trusted_proxy_hops", "client_ip_header", "client_ip_header_present"}
    assert body["forwarded_for_entries"] == 1


def test_a_single_service_deploy_serves_its_root_files_and_the_snapshot(tmp_path, monkeypatch):
    """The SPA catch-all used to answer /favicon.svg and /snapshot/latest.json
    with index.html; the snapshot fallback then failed to parse."""
    import api.main as main_mod

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "snapshot").mkdir()
    (dist / "index.html").write_text("<!doctype html><title>shell</title>")
    (dist / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    (dist / "snapshot" / "latest.json").write_text('{"generated_at": "2026-09-21T00:00:00Z", "entries": {}}')
    monkeypatch.setattr(main_mod, "WEB_DIST", dist)
    r = client.get("/favicon.svg")
    assert r.status_code == 200 and "svg" in r.headers["content-type"]
    r = client.get("/snapshot/latest.json")
    assert r.status_code == 200 and r.json()["generated_at"].startswith("2026")
    r = client.get("/markets")
    assert r.status_code == 200 and "shell" in r.text
    r = client.get("/../etc/passwd")
    assert "root:" not in r.text
