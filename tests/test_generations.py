"""B-H1 and "off the request path" (fix/prelaunch-1).

The API serves every database-derived result from a generation: an in-memory
copy of the database file plus every result computed from that copy by the
background worker. A change in the database file key starts a new generation;
reads and results switch together once it is complete, so a swap can never
leave one screen on the old file and another on the new one, and no request
ever computes. These tests pin that contract on scratch copies of the local
snapshot; the repo database is only ever read.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api import db
from src.analytics import dbpath

REPO_DB = db.DB_PATH
pytestmark = pytest.mark.skipif(not REPO_DB.exists(), reason="local DB snapshot absent")

WORKER_SERVED = [
    "/api/credit/metrics",
    "/api/recession/probability",
    "/api/regime/intelligence",
    "/api/regime/playbooks",
    "/api/regime/duration",
    "/api/regime/transitions",
    "/api/regime/analogues",
    "/api/regime/scenarios",
    "/api/lbo/defaults",
    "/api/allocation",
]


# ── scratch databases ─────────────────────────────────────────────────────────

def _copy(src: Path, dst: Path) -> Path:
    """A consistent copy through SQLite's backup API (a WAL-mode source can hold
    committed pages in its -wal file, which a byte copy would miss)."""
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    s.backup(d)
    s.close()
    d.close()
    return dst


def _seed_asset_prices(path: Path, seed: int = 7) -> None:
    """Deterministic synthetic histories for every ticker allocation reads, in
    the stored-histories table the refresh pipeline writes."""
    from src.market_data import asset_history

    rng = np.random.RandomState(seed)
    conn = sqlite3.connect(path)
    asset_history.ensure_table(conn)
    days = [d.strftime("%Y-%m-%d") for d in __import__("pandas").bdate_range("1990-01-02", "2026-09-18")]
    for spec in asset_history.SERIES:
        start = max(0, next((i for i, d in enumerate(days) if d >= spec.start), 0))
        span = days[start:]
        px = 100.0 * np.cumprod(1.0 + rng.normal(0.0003, 0.01, size=len(span)))
        rows = list(zip(span, px.tolist()))
        if spec.interval == "1mo":
            rows = asset_history.month_end_closes(rows)
        asset_history.write_series(conn, spec.symbol, spec.interval, rows, provider="eodhd")
    conn.commit()
    conn.close()


def _hy_oas_latest(path: Path) -> float:
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return float(c.execute("SELECT value FROM raw_series WHERE series_id='BAMLH0A0HYM2' ORDER BY date DESC LIMIT 1").fetchone()[0])
    finally:
        c.close()


def _bump_hy_oas(path: Path, delta_pct: float) -> float:
    c = sqlite3.connect(path)
    d, v = c.execute("SELECT date, value FROM raw_series WHERE series_id='BAMLH0A0HYM2' ORDER BY date DESC LIMIT 1").fetchone()
    c.execute("UPDATE raw_series SET value = ? WHERE series_id='BAMLH0A0HYM2' AND date = ?", (v + delta_pct, d))
    c.commit()
    c.close()
    return v + delta_pct


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    """The API pointed at a scratch copy (A); B is a changed copy ready to swap in."""
    a = _copy(REPO_DB, tmp_path / "macro_radar.db")
    _seed_asset_prices(a)
    b = _copy(a, tmp_path / "incoming.db")
    _bump_hy_oas(b, 0.5)
    monkeypatch.setattr(db, "DB_PATH", a)
    db.reset_connections_for_tests()
    yield a, b
    db.reset_connections_for_tests()


@pytest.fixture()
def serving_worker(install_worker):
    """A worker in serving mode (reads redirected to generations), the only one
    running during the test, torn down after it so no provider leaks."""
    from api import worker as worker_mod

    def make(**kw):
        return install_worker(worker_mod.AnalyticsWorker(poll_s=kw.pop("poll_s", 0.05), **kw))

    return make


# ── the file key ─────────────────────────────────────────────────────────────

def test_file_key_changes_on_an_atomic_swap_and_on_a_wal_commit(tmp_path):
    a = _copy(REPO_DB, tmp_path / "a.db")
    b = _copy(REPO_DB, tmp_path / "b.db")
    k1 = dbpath.file_key(a)
    assert k1 is not None and dbpath.file_key(a) == k1
    os.replace(b, a)
    k2 = dbpath.file_key(a)
    assert k2 != k1
    # an in-place commit in WAL mode lands in the -wal file first; the key sees it
    c = sqlite3.connect(a)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS wal_probe (x)")
    c.execute("INSERT INTO wal_probe VALUES (1)")
    c.commit()
    assert dbpath.file_key(a) != k2
    c.close()
    assert dbpath.file_key(tmp_path / "missing.db") is None


def test_reads_are_redirected_only_for_the_database_the_generation_was_built_from(tmp_path, serving_worker, scratch):
    a, _ = scratch
    w = serving_worker(items=[("probe", lambda ctx: 1)])
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    gen = w.current
    assert dbpath.generation_for(a) is gen
    assert dbpath.generation_for(dbpath.DEFAULT_DB_PATH) is gen  # analytics modules' default path
    elsewhere = _copy(REPO_DB, tmp_path / "elsewhere.db")
    assert dbpath.generation_for(elsewhere) is None  # a path a caller moved on purpose reads the file


# ── double-buffered generations ──────────────────────────────────────────────

def _count_regimes(ctx) -> int:
    conn = dbpath.connect_ro(dbpath.DEFAULT_DB_PATH)
    try:
        return int(conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0])
    finally:
        conn.close()


def test_reads_and_results_switch_together_only_when_the_new_generation_is_complete(serving_worker, scratch):
    a, b = scratch
    gate = threading.Event()
    gate.set()
    w = serving_worker(items=[("regime_rows", _count_regimes)], build_gate=gate)
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    first = w.current
    before = w.result("regime_rows")
    assert before == db.regime_history(None, None, 100000).__len__()

    # B carries one more regime row; hold its build open and swap it in.
    c = sqlite3.connect(b)
    last = c.execute("SELECT * FROM regimes ORDER BY date DESC LIMIT 1").fetchone()
    cols = [r[1] for r in c.execute("PRAGMA table_info(regimes)")]
    row = {k: v for k, v in zip(cols, last) if k != "id"}  # a new row: SQLite assigns the id
    row["date"] = "2099-01-01"
    c.execute(f"INSERT INTO regimes ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", tuple(row.values()))
    c.commit()
    c.close()
    gate.clear()
    os.replace(b, a)
    w.poke()
    time.sleep(0.3)  # the worker has seen the new key and is blocked mid-build
    assert w.current is first, "the old generation keeps serving while the new one builds"
    assert w.result("regime_rows") == before
    assert len(db.regime_history(None, None, 100000)) == before, "stored reads stay on the same generation as the results"

    gate.set()
    assert w.wait_published(min_id=first.id + 1, timeout=30)
    assert w.result("regime_rows") == before + 1
    assert len(db.regime_history(None, None, 100000)) == before + 1


def _counting(monkeypatch, module, name: str) -> list:
    calls: list = []
    real = getattr(module, name)

    def wrapped(*a, **k):
        calls.append(threading.current_thread().name)
        return real(*a, **k)

    monkeypatch.setattr(module, name, wrapped)
    return calls


def test_every_derived_result_is_rebuilt_after_a_swap(serving_worker, scratch, monkeypatch):
    """The spec's "a test proves each cache misses after a swap": every item in
    the worker's registry (the former TTL caches and the recession model) and
    the assistant's recession view are recomputed from the new file, and the HY
    OAS that moved in B reaches every result that carries it."""
    from api import analytics_cache
    from src.analytics import chat as chat_mod

    a, b = scratch
    monkeypatch.setattr(chat_mod, "_RECESSION_MODEL_CACHE", {})
    assistant_calls = _counting(monkeypatch, chat_mod, "_compute_recession_view")
    w = serving_worker()
    w.start(serving=True)
    assert w.wait_published(timeout=120)
    names = [n for n, _ in analytics_cache.ITEMS]
    assert set(names) >= {"credit", "recession", "recession_model", "takeaway", "duration", "transitions",
                          "analogues", "playbooks", "scenario_defs", "lbo_defaults", "allocation"}
    counts_a = dict(w.compute_counts)
    hy_a = _hy_oas_latest(a)
    credit_a = w.result("credit")
    rec_a = w.result("recession")
    lbo_a = w.result("lbo_defaults")
    chat_mod._recession_model_view()
    chat_mod._recession_model_view()
    assert len(assistant_calls) == 1  # warm within one generation

    first_id = w.current.id
    os.replace(b, a)
    w.poke()
    assert w.wait_published(min_id=first_id + 1, timeout=120)
    for n in names:
        assert w.compute_counts[n] == counts_a[n] + 1, f"{n} was not rebuilt after the swap"
    hy_b = _hy_oas_latest(a)
    assert abs(hy_b - hy_a - 0.5) < 1e-9
    assert w.result("credit") != credit_a
    assert w.result("recession")["current_inputs"]["hy_oas"] != rec_a["current_inputs"]["hy_oas"]
    assert abs(w.result("lbo_defaults")["hy_oas_pct"] - lbo_a["hy_oas_pct"] - 0.5) < 1e-6
    # the assistant's own cache (src/, its own file check) misses too
    chat_mod._recession_model_view()
    assert len(assistant_calls) == 2


def test_the_assistant_recession_cache_misses_after_a_file_swap_without_the_api(tmp_path, monkeypatch):
    """src/ cannot import api/, so the assistant's cache keys on its own file
    check: Streamlit and scripts get the same guarantee as the API."""
    from src.analytics import chat as chat_mod

    dbpath.clear_provider()
    a = _copy(REPO_DB, tmp_path / "chat.db")
    b = _copy(REPO_DB, tmp_path / "chat_b.db")
    monkeypatch.setattr(chat_mod, "DB_PATH", a)
    monkeypatch.setattr(chat_mod, "_RECESSION_MODEL_CACHE", {})
    calls = _counting(monkeypatch, chat_mod, "_compute_recession_view")
    chat_mod._recession_model_view()
    chat_mod._recession_model_view()
    assert len(calls) == 1  # warm: one compute
    os.replace(b, a)
    chat_mod._recession_model_view()
    assert len(calls) == 2  # the swap is a miss


def test_first_request_after_a_swap_is_served_from_rebuilt_results_in_under_a_second(serving_worker, scratch):
    from api.main import app

    a, b = scratch
    w = serving_worker()
    w.start(serving=True)
    assert w.wait_published(timeout=120)
    client = TestClient(app, raise_server_exceptions=False)
    hy_before = client.get("/api/credit/metrics").json()
    first_id = w.current.id
    os.replace(b, a)
    w.poke()
    # during the rebuild every request is answered at once from the previous generation
    t = time.perf_counter()
    r = client.get("/api/credit/metrics")
    assert r.status_code == 200 and time.perf_counter() - t < 1.0
    assert w.wait_published(min_id=first_id + 1, timeout=120)
    for path in WORKER_SERVED:
        t = time.perf_counter()
        r = client.get(path)
        ms = (time.perf_counter() - t) * 1000
        assert r.status_code == 200, (path, r.status_code, r.text[:200])
        assert ms < 1000, f"{path} took {ms:.0f} ms after the swap"
    assert client.get("/api/credit/metrics").json() != hy_before


def test_requests_before_the_first_pass_wait_then_get_503_warming(serving_worker, scratch):
    from api.main import app

    gate = threading.Event()
    w = serving_worker(build_gate=gate, wait_s=0.4)
    w.start(serving=True)
    client = TestClient(app, raise_server_exceptions=False)
    ready = client.get("/health/ready")
    assert ready.status_code == 503 and ready.json()["status"] == "warming"
    t = time.perf_counter()
    r = client.get("/api/credit/metrics")
    waited = time.perf_counter() - t
    assert r.status_code == 503
    assert 0.35 <= waited < 2.0
    assert int(r.headers["Retry-After"]) >= 1
    body = r.json()
    assert body["kind"] == "warming" and body["retryable"] is True and "warming" in body["detail"].lower()
    gate.set()
    assert w.wait_published(timeout=120)
    assert client.get("/api/credit/metrics").status_code == 200
    assert client.get("/health/ready").json()["status"] == "ready"


def test_the_production_wait_is_five_seconds(serving_worker, scratch):
    from api import worker as worker_mod
    from api.main import app

    assert worker_mod.WAIT_S == 5.0
    gate = threading.Event()
    w = serving_worker(build_gate=gate)
    w.start(serving=True)
    client = TestClient(app, raise_server_exceptions=False)
    t = time.perf_counter()
    r = client.get("/api/regime/duration")
    waited = time.perf_counter() - t
    gate.set()
    assert r.status_code == 503 and 4.9 <= waited < 7.0


def test_handlers_never_compute_on_the_request_path(serving_worker, scratch, monkeypatch):
    """Every analytics entry point is instrumented; after the first pass, a
    full sweep of the worker-served endpoints must not call any of them."""
    from api.main import app
    from src.analytics import allocation, credit, intelligence, lbo, recession, regimes

    calls: list = []
    for module, names in (
        (credit, ["get_credit_metrics"]),
        (recession, ["get_recession_metrics", "train_recession_model"]),
        (intelligence, ["generate_market_takeaway", "get_regime_duration", "get_transition_narrative", "find_historical_analogues", "get_regime_playbook"]),
        (regimes, ["get_current_regime_probs"]),
        (lbo, ["get_lbo_defaults"]),
        (allocation, ["get_allocation_data"]),
    ):
        for n in names:
            real = getattr(module, n)

            def wrapped(*a, _real=real, **k):
                calls.append(threading.current_thread().name)
                return _real(*a, **k)

            monkeypatch.setattr(module, n, wrapped)
    w = serving_worker()
    w.start(serving=True)
    assert w.wait_published(timeout=120)
    assert calls and set(calls) == {w.thread_name}
    during_build = len(calls)
    client = TestClient(app, raise_server_exceptions=False)
    for path in WORKER_SERVED:
        assert client.get(path).status_code == 200, path
    assert client.post("/api/recession/scenario", json={"yield_curve_bps": 50, "unemployment": 4.3, "hy_oas_bps": 300, "indpro_yoy": 1.0, "lei": 0.2}).status_code == 200
    assert len(calls) == during_build, f"a handler computed on the request path: {calls[during_build:]}"
    assert w.compute_threads == {w.thread_name}


def test_a_failed_item_is_served_as_its_own_error_and_does_not_block_the_rest(serving_worker, scratch):
    def boom(ctx):
        raise db.DBUnavailable("probe: this item has no data")

    w = serving_worker(items=[("ok", lambda ctx: 42), ("broken", boom)])
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    assert w.result("ok") == 42
    with pytest.raises(db.DBUnavailable):
        w.result("broken")


def test_stored_maxima_are_computed_once_per_generation_and_move_with_it(serving_worker, scratch, monkeypatch):
    """db.freshness() is read by every payload that carries a freshness block;
    within a generation its answer cannot change, across a swap it must."""
    a, b = scratch
    w = serving_worker(items=[("probe", lambda ctx: 1)])
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    calls: list = []
    real = db._freshness_uncached
    monkeypatch.setattr(db, "_freshness_uncached", lambda: calls.append(1) or real())
    first = db.freshness()
    assert db.freshness() == first and len(calls) == 1
    c = sqlite3.connect(b)
    c.execute("UPDATE asset_prices SET date = '2026-09-19' WHERE symbol = 'SPY' AND interval = '1d' AND date = '2026-09-18'")
    c.execute("DELETE FROM asset_prices WHERE interval = '1d' AND date = '2026-09-18' AND symbol <> 'SPY'")
    c.commit()
    c.close()
    first_id = w.current.id
    os.replace(b, a)
    w.poke()
    assert w.wait_published(min_id=first_id + 1, timeout=30)
    moved = db.freshness()
    assert len(calls) == 2 and moved["asset_prices_date"] != first["asset_prices_date"]


def test_the_frontier_yields_the_gil_in_every_solver_callback_and_changes_nothing(monkeypatch):
    """SciPy's SLSQP held the GIL for up to ~250 ms per solve, freezing the
    event loop during a rebuild (measured: /health/live stalled ~1 s). Each
    callback now sleeps(0) first; with the sleep stubbed out the frontier is
    identical, so the yield is scheduling only."""
    from src.analytics import allocation as al

    rng = np.random.RandomState(3)
    a = rng.normal(0, 0.02, size=(120, 6))
    mu, cov = a.mean(axis=0) * 12, np.cov(a.T) * 12
    yields: list = []
    real_sleep = al.time.sleep
    monkeypatch.setattr(al.time, "sleep", lambda s: yields.append(s) or real_sleep(s))
    with_yield = al.generate_efficient_frontier(mu, cov, 0.03)
    assert yields and set(yields) == {0}, "every callback yields with a zero-length sleep"
    monkeypatch.setattr(al.time, "sleep", lambda s: None)
    without = al.generate_efficient_frontier(mu, cov, 0.03)
    assert len(with_yield) > 5 and with_yield.equals(without)


def test_allocation_is_computed_in_a_child_process_never_in_the_server(serving_worker, scratch, monkeypatch):
    """Its libraries hold the GIL long enough to stall the event loop (measured:
    /health/live up to ~124 ms even after the frontier fix), so it runs in a
    spawned child that reads a snapshot of the generation being built."""
    import multiprocessing

    from api import analytics_cache
    from src.analytics import allocation

    in_server: list = []
    monkeypatch.setattr(allocation, "get_allocation_data", lambda *a, **k: in_server.append(1) or {})
    spawned: list = []
    real_ctx = multiprocessing.get_context

    def spy(method=None):
        ctx = real_ctx(method)
        if method == "spawn":
            spawned.append(method)
        return ctx

    monkeypatch.setattr(multiprocessing, "get_context", spy)
    w = serving_worker(items=[("allocation", analytics_cache._allocation)])
    w.start(serving=True)
    assert w.wait_published(timeout=120)
    body = w.result("allocation")
    assert in_server == [] and spawned == ["spawn"]
    assert body["n_months"] > 100 and body["histories"]["as_of"] == "2026-09-18"


def test_an_overrunning_allocation_child_is_terminated_and_the_rest_still_publishes(serving_worker, scratch, monkeypatch):
    from api import analytics_cache

    monkeypatch.setattr(analytics_cache, "ALLOCATION_TIMEOUT_S", 0.05)
    w = serving_worker(items=[("allocation", analytics_cache._allocation), ("probe", lambda ctx: 7)])
    w.start(serving=True)
    assert w.wait_published(timeout=60)
    assert w.result("probe") == 7
    with pytest.raises(TimeoutError):
        w.result("allocation")
    import multiprocessing

    assert not [p for p in multiprocessing.active_children() if p.name == "mrr-allocation"], "the child was reaped"
