"""A burst of concurrent DB-backed requests must finish, never wedge the
worker pool (independent review P0-1: per-request SQLite open/close churn
deadlocked 39 threads in the unix-VFS mutex). Every response is 200 or a
typed 429 from the concurrency ceiling, and the burst completes quickly."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from api import db
from api.main import app


@pytest.mark.skipif(not db.DB_PATH.exists(), reason="local DB snapshot absent")
def test_burst_of_db_requests_completes():
    client = TestClient(app, raise_server_exceptions=False)
    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=32) as pool:
        codes = list(pool.map(lambda _: client.get("/api/regime/latest").status_code, range(240)))
    elapsed = time.monotonic() - t0
    assert set(codes) <= {200, 429}, set(codes)
    assert codes.count(200) >= 60  # the ceilings shed load; they do not black out
    assert elapsed < 30, elapsed
    # And the service still answers afterwards.
    assert client.get("/api/regime/latest").status_code == 200


def test_connection_is_reused_per_thread_and_reopens_on_swap(tmp_path, monkeypatch):
    import sqlite3

    path = tmp_path / "a.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE regimes(date TEXT, label TEXT, confidence REAL, growth_trend TEXT, inflation_trend TEXT, prob_goldilocks REAL, prob_overheating REAL, prob_stagflation REAL, prob_recession REAL)")
    conn.execute("INSERT INTO regimes VALUES ('2026-07-01','Goldilocks',0.6,'up','flat',0.6,0.2,0.1,0.1)")
    conn.commit()
    conn.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    c1 = db._connect()
    c2 = db._connect()
    assert c1 is c2  # reused on the same thread
    assert db.latest_regime()["label"] == "Goldilocks"
    # Swap the file underneath (what bootstrap/os.replace does): a new connection follows.
    other = tmp_path / "b.db"
    conn = sqlite3.connect(other)
    conn.execute("CREATE TABLE regimes(date TEXT, label TEXT, confidence REAL, growth_trend TEXT, inflation_trend TEXT, prob_goldilocks REAL, prob_overheating REAL, prob_stagflation REAL, prob_recession REAL)")
    conn.execute("INSERT INTO regimes VALUES ('2026-08-01','Overheating',0.7,'up','up',0.1,0.7,0.1,0.1)")
    conn.commit()
    conn.close()
    import os

    os.replace(other, path)
    c3 = db._connect()
    assert c3 is not c1
    assert db.latest_regime()["label"] == "Overheating"
    db.reset_connections_for_tests()
