"""tests/test_desk_v2_pipeline.py — GET /api/desk/pipeline and /pipeline/ddl
(desk/frame-3-api-b2a; DESK_FRAME3_SPEC §12.9, FRAME3_API_PLAN.md §1.9, §5
and §7 commit 10).

- The row set, the groups, each row's provider (R-15), dates (S-03), feeds
  (S-02), note and status, on the hermetic store, and the shape on the
  scratch and published copies when present.
- The proposed DDL (S-04, R-02): served verbatim as text, and never imported
  as a .sql module under web/.
- The published verdict (S-01): served only for the generation whose file key
  bootstrap bound, through every race the plan names: a WAL commit after a
  verified download, Codex's round-3 repro, an empty WAL, a commit at each
  boundary of the bracket (plain and checkpointed), and the worker's copy
  taken across a commit (hardening's R-11).
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache as ac
from api import bootstrap, db
from api import desk as desk_mod
from api import desk_pipeline as pipe
from api import desk_v2_macro as v2m
from api.main import app
from src.analytics import dbpath
from src.desk import series as registry
from tests import desk_contract as contract
from tests import desk_macro_store as store
from tests import desk_release as rel
from tests.test_desk_v2_regime import at, serve

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(os.environ.get("DESK_DB", ROOT / "data" / "desk_scratch.db"))
PUBLISHED = ROOT / "data" / "macro_radar.db"
AUDIT_SHA = "9a8b857968b8de22"
client = TestClient(app)
GROUPS = ["Rates", "Credit", "Equities & vol", "FX & commodities", "Macro (monthly)"]


def serve_pipeline(install_worker, monkeypatch, path: Path):
    return serve(install_worker, monkeypatch, path, names=("desk_pipeline",))


def get_pipeline() -> dict:
    return contract.check_response("/pipeline", client.get("/api/desk/pipeline"))


def rows_of(body: dict) -> dict[str, dict]:
    return {s["id"]: s for g in body["data"]["groups"] for s in g["series"]}


@pytest.fixture()
def hermetic(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    serve_pipeline(install_worker, monkeypatch, path)
    return path


# ── The row set, the groups, the fields ─────────────────────────────────────

def test_pipeline_shape(hermetic, monkeypatch):
    at(monkeypatch, datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc))
    body = get_pipeline()
    d = body["data"]
    assert [g["name"] for g in d["groups"]] == GROUPS
    for g in d["groups"]:
        assert g["status"] == pipe.worst([s["status"] for s in g["series"]])
    assert d["validation"] is None, "no verdict is held without a verified upload"
    wm = sqlite3.connect(hermetic).execute("SELECT checked_at FROM source_watermarks WHERE source = 'desk_series'").fetchone()[0]
    assert d["last_refresh_utc"] == wm


def test_the_rows_are_the_registry_and_its_raw_series_readers():
    """Plan §1.9: every available Desk registry series at tier 2 or below,
    then the raw_series rows a Desk panel reads; a series added to the registry
    fails here until it is placed in a group with its feeds."""
    desk = {s.series_id for s in registry.SERIES if s.available and s.tier <= 2}
    assert len(pipe.row_ids()) == len(set(pipe.row_ids()))
    assert set(pipe.row_ids()) == desk | set(pipe.RAW_SERIES_ROWS)
    assert set(pipe.FEEDS) == set(pipe.row_ids())
    assert {"DGS3MO", "DGS5", "DGS30"} <= desk, "the three tenors are registered"
    assert set(pipe.RAW_SERIES_ROWS) == {"INDPRO", "CPIAUCSL", "UNRATE", "T10YIE", "T5YIE", "USREC", "BAMLC0A0CM"}
    from api import main

    assert set(main.RECESSION_INPUTS) - {s for s in desk} <= set(pipe.RAW_SERIES_ROWS), "every recession input has a row"


def test_each_row_carries_its_registry_or_raw_series_fields(hermetic, monkeypatch):
    at(monkeypatch, datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc))
    rows = rows_of(get_pipeline())
    from api import freshness as freshness_mod

    for sid, r in rows.items():
        spec = registry.BY_SERIES_ID.get(sid)
        if spec is not None and sid not in pipe.RAW_SERIES_ROWS:
            assert (r["label"], r["key"], r["freq"]) == (spec.label, spec.key, "daily"), sid
        else:
            meta = freshness_mod.SERIES_REGISTRY[sid]
            assert (r["label"], r["key"], r["freq"]) == (meta["label"], None, meta["cadence"]), sid
        assert r["feeds"] == list(pipe.FEEDS[sid]), sid


def test_pipeline_providers_are_each_rows_declaration(tmp_path, install_worker, monkeypatch):
    """R-15: every row, stored or not (the tier-2 series, the prices, which this
    store lacks), names its registry source declaration; the stored rows' own
    provider column is never read."""
    path = store.build(tmp_path / "macro_radar.db")
    conn = sqlite3.connect(path)
    conn.execute("UPDATE desk_series SET provider = 'hand-typed' WHERE series_id = 'DGS10'")
    conn.commit()
    conn.close()
    serve_pipeline(install_worker, monkeypatch, path)
    rows = rows_of(get_pipeline())
    _assert_providers(rows)
    assert rows["DGS10"]["last"] == store.DAILY_END and rows["DCOILWTICO"]["last"] is None


def _assert_providers(rows: dict[str, dict]) -> None:
    for sid, r in rows.items():
        spec = registry.BY_SERIES_ID.get(sid) if sid not in pipe.RAW_SERIES_ROWS else None
        if spec is None:
            want = desk_mod.SOURCE_BY_KIND["fred"]
        elif spec.source == "asset_prices":
            want = desk_mod.SOURCE_BY_ID["asset_prices"]
        elif spec.source == "fred":
            want = "FRED (Desk daily history)"
        else:
            want = "EODHD first, Yahoo disclosed fallback (Desk daily history)"
        assert r["provider"] == want, (sid, r["provider"])
    assert all(rows[s]["provider"] == desk_mod.SOURCE_BY_ID["asset_prices"] for s in ("^GSPC", "GC=F", "^RUT"))



def test_the_desk_provider_strings_are_the_inventorys():
    now = datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc)
    rows = {r["source_id"]: r["source"] for r in desk_mod.desk_inventory_rows({"DGS10": "2026-09-22", "^NDX": "2026-09-22"}, {}, now)}
    assert rows["DGS10"] == pipe.PROVIDER_DESK_FRED and rows["^NDX"] == pipe.PROVIDER_DESK_MARKET


def test_rows_are_dated_by_what_the_desk_reads(hermetic, monkeypatch):
    """S-03: a desk_series row by the engine's reader; a daily FRED series
    stored month-stamped in raw_series by its watermark's last_obs (first: its
    first month stamp); a monthly print by its month stamps; nothing stored,
    nulls. Notes: the registry's, or the engine's not_stored sentence."""
    at(monkeypatch, datetime(2026, 9, 23, 15, 0, tzinfo=timezone.utc))
    rows = rows_of(get_pipeline())
    conn = sqlite3.connect(hermetic)
    try:
        lo, hi = conn.execute("SELECT MIN(date), MAX(date) FROM desk_series WHERE series_id = 'DGS10'").fetchone()
        ig_first = conn.execute("SELECT MIN(date) FROM raw_series WHERE series_id = 'BAMLC0A0CM'").fetchone()[0]
        ip = conn.execute("SELECT MIN(date), MAX(date) FROM raw_series WHERE series_id = 'INDPRO'").fetchone()
    finally:
        conn.close()
    assert (rows["DGS10"]["first"], rows["DGS10"]["last"]) == (lo, hi) == (store.DAILY_START, store.DAILY_END)
    assert rows["DGS10"]["note"] == registry.get("us10y").note
    assert (rows["BAMLC0A0CM"]["first"], rows["BAMLC0A0CM"]["last"]) == (ig_first, store.IG_LAST[0])
    assert (rows["INDPRO"]["first"], rows["INDPRO"]["last"]) == tuple(ip)
    assert rows["T10YIE"]["last"] is None, "month-stamped and no watermark: undated"
    assert rows["INDPRO"]["note"] is None
    for sid in ("DGS3MO", "DGS5", "DGS30", "^NDX", "DCOILWTICO", "^GSPC"):
        r = rows[sid]
        assert r["first"] is None and r["last"] is None and r["status"] == "missing", sid
        assert r["note"].startswith(f"{registry.BY_SERIES_ID[sid].label} ({sid}) is awaiting"), (sid, r["note"])
    assert (rows["USREC"]["first"], rows["USREC"]["status"]) == (None, "missing")


def test_statuses_follow_each_series_policy_and_move_with_now(tmp_path, install_worker, monkeypatch):
    """N9's mapping per row, recomputed per response (plan §0.5): FRED Desk
    rows through desk_series_states, prices through the asset_prices rule with
    its 06:00 UTC grace, monthly prints by release month; a group is its worst."""
    from src.market_data import asset_history

    path = store.build(tmp_path / "macro_radar.db")
    conn = sqlite3.connect(path)
    asset_history.ensure_table(conn)
    days = [d.strftime("%Y-%m-%d") for d in __import__("pandas").bdate_range("2026-01-02", "2026-09-23")]
    asset_history.write_series(conn, "^GSPC", "1d", [(d, 5000.0 + i) for i, d in enumerate(days)], provider="test")
    conn.commit()
    conn.close()
    serve_pipeline(install_worker, monkeypatch, path)
    at(monkeypatch, datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc))
    rows = rows_of(get_pipeline())
    assert rows["DGS10"]["status"] == "current" and rows["BAMLH0A0HYM2"]["status"] == "current"
    assert rows["INDPRO"]["status"] == "current" and rows["DGS3MO"]["status"] == "missing"
    at(monkeypatch, datetime(2026, 9, 25, 3, 0, tzinfo=timezone.utc))  # 09-24's close due, inside the 06:00 UTC grace
    assert rows_of(get_pipeline())["^GSPC"]["status"] == "current"
    at(monkeypatch, datetime(2026, 9, 25, 7, 0, tzinfo=timezone.utc))  # past the grace: a session behind
    assert rows_of(get_pipeline())["^GSPC"]["status"] == "stale"
    at(monkeypatch, datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc))
    body = get_pipeline()
    rows = rows_of(body)
    assert rows["DGS10"]["status"] == rows["INDPRO"]["status"] == "stale"
    groups = {g["name"]: g["status"] for g in body["data"]["groups"]}
    assert groups["Macro (monthly)"] == "missing" and groups["Credit"] == "stale"


def test_without_the_desk_watermark_the_last_refresh_is_null(tmp_path, install_worker, monkeypatch):
    serve_pipeline(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db", watermarks=False))
    d = get_pipeline()["data"]
    assert d["last_refresh_utc"] is None
    assert rows_of({"data": d})["BAMLC0A0CM"]["last"] is None


@pytest.mark.parametrize("path", [SCRATCH, PUBLISHED], ids=["scratch", "published"])
def test_pipeline_shape_on_a_real_store(path, install_worker, monkeypatch):
    if not path.exists() or path.stat().st_size == 0:
        pytest.skip(f"{path.name} is not in this tree")
    serve_pipeline(install_worker, monkeypatch, path)
    rows = rows_of(get_pipeline())
    _assert_providers(rows)
    assert set(rows) == set(pipe.row_ids())


def test_the_audit_copys_rows(install_worker, monkeypatch):
    if not PUBLISHED.exists() or hashlib.sha256(PUBLISHED.read_bytes()).hexdigest()[:16] != AUDIT_SHA:
        pytest.skip("the audit's copy of the store is not data/macro_radar.db here")
    serve_pipeline(install_worker, monkeypatch, PUBLISHED)
    at(monkeypatch, datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc))
    d = get_pipeline()["data"]
    rows = rows_of({"data": d})
    assert d["last_refresh_utc"] == "2026-09-24T15:52:43Z"
    assert (rows["DGS10"]["first"], rows["DGS10"]["last"]) == ("1962-01-02", "2026-09-22")
    assert (rows["BAMLC0A0CM"]["first"], rows["BAMLC0A0CM"]["last"]) == ("1996-12-01", "2026-09-23")
    assert rows["BAMLH0A0HYM2"]["first"] == "2023-09-25" and rows["^GSPC"]["last"] == "2026-09-23"
    assert all(rows[s]["status"] == "missing" for s in ("DGS3MO", "DGS5", "DGS30", "DCOILWTICO", "^NDX", "DX-Y.NYB", "JPY=X"))


# ── /pipeline/ddl (S-04, R-02) ──────────────────────────────────────────────

def test_pipeline_ddl_is_the_static_file_verbatim_as_text():
    r = client.get("/api/desk/pipeline/ddl")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    body = (ROOT / "api" / "static" / "snowflake_proposed.sql").read_bytes()
    assert r.content == body
    first = body.decode("utf-8").splitlines()[0]
    assert "PROPOSED" in first and first.startswith("-- PROPOSED Snowflake export schema (not the current SQLite layout)")


def test_nothing_under_web_imports_a_sql_file():
    """R-02: the fixture is generated from the file, never imported as a module."""
    pattern = re.compile(r"""(?:\bimport\s[^;]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"]+\.sql(?:\?[^'"]*)?['"]""")
    hits = []
    for base in (ROOT / "web" / "src", ROOT / "web" / "scripts"):
        if not base.exists():
            continue
        for f in base.rglob("*"):
            if f.suffix in (".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx") and "node_modules" not in f.parts:
                if pattern.search(f.read_text(errors="replace")):
                    hits.append(str(f.relative_to(ROOT)))
    assert hits == []
    assert pattern.search('import ddl from "../api/static/snowflake_proposed.sql?raw";')
    assert pattern.search("const m = await import('./x.sql')") and not pattern.search('a.download = "schema.sql"')


def test_the_image_carries_the_ddl_without_a_new_copy():
    docker = (ROOT / "Dockerfile").read_text()
    assert "COPY api/ api/" in docker
    ignored = [ln.strip() for ln in (ROOT / ".dockerignore").read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    assert not any(p in ("api", "api/", "api/static", "*.sql", "**/*.sql") for p in ignored), ignored


# ── The published verdict, gated on the generation's key (S-01) ─────────────

@pytest.fixture()
def gate(tmp_path, install_worker, monkeypatch):
    """A worker serving a WAL-mode store B, bootstrap on a fake release."""
    from api import worker as worker_mod

    live = tmp_path / "live" / "macro_radar.db"
    live.parent.mkdir()
    live.write_bytes(rel.store_bytes(tmp_path, "b.db", seed=8))
    monkeypatch.setattr(db, "DB_PATH", live)
    monkeypatch.setenv("GH_DB_TOKEN", "test-token-not-real")
    release = rel.Release()
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(release.handler))
    bootstrap.reset_validation_for_tests()
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker([(n, f) for n, f in ac.ITEMS if n == "desk_pipeline"], poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=60)
    writers: list[sqlite3.Connection] = []
    state = {"live": live, "release": release, "worker": w, "writers": writers, "a": rel.store_bytes(tmp_path, "a.db", seed=7)}
    yield state
    for c in writers:
        c.close()
    bootstrap.reset_validation_for_tests()
    db.reset_connections_for_tests()


def wait_key(w, key, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if w.current is not None and w.current.key == key:
            return
        time.sleep(0.02)
    raise AssertionError(f"the worker never published {key}; it serves {w.current.key if w.current else None}")


def served_validation() -> str | None:
    return get_pipeline()["data"]["validation"]


def settle(state) -> tuple:
    """The worker serves the file as it is now."""
    key = dbpath.file_key(state["live"])
    wait_key(state["worker"], key)
    return key


def test_the_verdict_is_served_for_the_bound_generation_only(gate):
    live, release, w = gate["live"], gate["release"], gate["worker"]
    release.publish_db(gate["a"])
    release.publish_validation(rel.verdict(gate["a"]))
    assert bootstrap.refresh_db() is True
    k1 = settle(gate)
    assert bootstrap.validation_state()["validated_key"] == k1
    assert served_validation() == "pass"
    bootstrap._set_validation({**bootstrap.validation_state(), "validated_key": ("another", "generation")})
    assert served_validation() is None, "a verdict bound to another key is never served"


def test_a_wal_commit_to_the_served_file_drops_the_verdict_until_the_next_verified_upload(gate):
    """The WAL-commit repro (R-01): one committed write moves the file key,
    the worker stages a new generation, and the verdict reads unknown, also
    after a poll of the unchanged asset and after the checkpoint."""
    live, release = gate["live"], gate["release"]
    release.publish_db(gate["a"])
    release.publish_validation(rel.verdict(gate["a"]))
    bootstrap.refresh_db()
    k1 = settle(gate)
    assert served_validation() == "pass"
    gate["writers"].append(rel.wal_commit(live))
    k2 = settle(gate)
    assert k2 != k1 and served_validation() is None
    bootstrap.refresh_db()
    assert served_validation() is None and bootstrap.validation_state()["validated_key"] == k1
    gate["writers"].pop().close()  # the checkpoint moves the commit into the main file
    settle(gate)
    bootstrap.refresh_db()
    assert served_validation() is None


def test_codex_round_3_a_verdict_arriving_after_a_wal_commit_is_never_bound(gate):
    """Download A while its validation.json is not listed; WAL-commit a row;
    A's verdict arrives: the main file's hash still matches A, but the WAL holds
    a commit the hash never saw, so nothing is bound, before the checkpoint and
    after it (then the hash differs)."""
    live, release = gate["live"], gate["release"]
    release.publish_db(gate["a"])
    assert bootstrap.refresh_db() is True and bootstrap.validation_state() is None
    writer = rel.wal_commit(live)
    gate["writers"].append(writer)
    assert hashlib.sha256(live.read_bytes()).hexdigest() == rel.sha(gate["a"]), "a WAL commit leaves the main file's bytes"
    release.publish_validation(rel.verdict(gate["a"]))
    assert bootstrap.refresh_db() is False
    settle(gate)
    assert bootstrap.validation_state() is None and served_validation() is None
    writer.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    assert bootstrap.refresh_db() is False
    settle(gate)
    assert bootstrap.validation_state() is None and served_validation() is None


def test_an_empty_wal_binds_as_usual(gate):
    live, release = gate["live"], gate["release"]
    release.publish_db(gate["a"])
    bootstrap.refresh_db()
    Path(f"{live}-wal").write_bytes(b"")  # present, zero bytes: no commit at all
    release.publish_validation(rel.verdict(gate["a"]))
    bootstrap.refresh_db()
    k = settle(gate)
    assert bootstrap.validation_state()["validated_key"] == k and served_validation() == "pass"


@pytest.mark.parametrize("checkpoint", [False, True], ids=["in-wal", "checkpointed"])
@pytest.mark.parametrize("point", ["before-1", "between-1-and-3", "during-hash", "after-4"])
def test_a_commit_at_each_boundary_of_the_bracket(gate, point, checkpoint):
    """Round 4's R-01: a commit to the served file at each point of a poll's
    binding. Before step 1, the WAL (or, checkpointed, the hash) refuses; between
    steps 1 and 3 and during the hash, the moved key (and the hash) refuse; after
    step 4 the first key is bound, the commit moves the file's key, and the
    generation the worker stages for it is served no verdict."""
    live, release, w = gate["live"], gate["release"], gate["worker"]
    release.publish_db(gate["a"])
    bootstrap.refresh_db()  # A in place, nothing held (no verdict listed yet)
    k0 = settle(gate)
    release.publish_validation(rel.verdict(gate["a"]))

    def commit() -> None:
        c = rel.wal_commit(live)
        if checkpoint:
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        gate["writers"].append(c)

    calls = {"n": 0}

    class Keys:
        @staticmethod
        def file_key(path):
            k = dbpath.file_key(path)
            calls["n"] += 1
            if (point, calls["n"]) == ("between-1-and-3", 1):
                commit()
            return k

    def hashing(path):
        size = os.path.getsize(path)
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            h.update(fh.read(size // 2))
            commit()
            h.update(fh.read())
        return h.hexdigest()

    real_bind = bootstrap.bind_validation

    def bind_then_commit(*args, **kwargs):  # after step 4, the WAL re-check included
        bound = real_bind(*args, **kwargs)
        commit()
        return bound

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(bootstrap, "dbpath", Keys)
        if point == "during-hash":
            mp.setattr(bootstrap, "sha256_file", hashing)
        if point == "after-4":
            mp.setattr(bootstrap, "bind_validation", bind_then_commit)
        if point == "before-1":
            commit()
        assert bootstrap.refresh_db() is False
    held = bootstrap.validation_state()
    if point == "after-4":
        assert held is not None and held["validated_key"] == k0
    else:
        assert held is None, held
    k = settle(gate)
    assert k != k0
    assert served_validation() is None


def test_the_worker_never_publishes_a_copy_taken_across_a_commit(gate, monkeypatch):
    """Round 4's R-11, the pin for hardening's key stability: bootstrap binds
    k1 and swaps; the worker samples k1, a commit lands, then the worker
    copies. It drops that copy (the key moved), publishes no generation under
    k1, and stages the next key; the verdict is never served."""
    live, release, w = gate["live"], gate["release"], gate["worker"]
    published: list[tuple] = []
    real_publish, real_stage = w._publish, w._stage
    armed = {"on": False}

    def publish(gen, **kw):
        published.append(gen.key)
        return real_publish(gen, **kw)

    def stage(src, key):
        if armed["on"]:
            armed["on"] = False
            gate["writers"].append(rel.wal_commit(live))
        return real_stage(src, key)

    monkeypatch.setattr(w, "_publish", publish)
    monkeypatch.setattr(w, "_stage", stage)
    moved = w.snapshots_moved
    release.publish_db(gate["a"])
    release.publish_validation(rel.verdict(gate["a"]))
    armed["on"] = True
    assert bootstrap.refresh_db() is True
    k1 = bootstrap.validation_state()["validated_key"]
    deadline = time.monotonic() + 30
    while armed["on"] and time.monotonic() < deadline:  # the worker samples k1 and the commit lands
        time.sleep(0.02)
    assert not armed["on"], "the worker never staged the swapped file"
    k2 = settle(gate)
    assert k2 != k1 and k1 not in published, (k1, published)
    assert w.snapshots_moved > moved
    assert served_validation() is None


def test_regime_macro_and_pipeline_answer_on_one_generation(tmp_path, install_worker, monkeypatch):
    serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"),
          names=("recession", "desk_regime", "desk_macro", "desk_pipeline"))
    at(monkeypatch, datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc))
    ids = {contract.check_response(r, client.get(f"/api/desk{r}"))["generation_id"] for r in ("/regime", "/macro", "/pipeline")}
    assert len(ids) == 1 and None not in ids
