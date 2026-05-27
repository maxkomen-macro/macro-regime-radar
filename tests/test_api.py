"""tests/test_api.py — smoke + contract tests for the read-only Macro Radar API.

Runs against the real local SQLite DB in read-only mode (no writes) via FastAPI's
TestClient. Skips gracefully if the DB file is absent (e.g. fresh checkout/CI).
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import db
from api.main import app

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="macro_radar.db not present"
)


def _ro_conn() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db_present"] is True


def test_regime_latest_matches_db():
    r = client.get("/regime/latest")
    assert r.status_code == 200
    body = r.json()
    for key in (
        "date", "label", "confidence", "growth_trend", "inflation_trend",
        "prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession",
    ):
        assert key in body

    conn = _ro_conn()
    row = conn.execute(
        "SELECT date, label FROM regimes ORDER BY date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    assert body["date"] == row[0]
    assert body["label"] == row[1]


def test_signals_latest_shape_and_date():
    r = client.get("/signals/latest")
    assert r.status_code == 200
    body = r.json()
    assert "date" in body and isinstance(body["signals"], list)

    conn = _ro_conn()
    max_date = conn.execute("SELECT MAX(date) FROM signals").fetchone()[0]
    conn.close()
    assert body["date"] == max_date
    if body["signals"]:
        s = body["signals"][0]
        assert set(s) == {"signal_name", "value", "triggered"}
        assert isinstance(s["triggered"], bool)


def test_series_catalog_and_latest_all():
    ids = client.get("/series").json()
    assert isinstance(ids, list) and ids

    points = client.get("/series/latest").json()
    assert len(points) == len(ids)
    assert {p["series_id"] for p in points} == set(ids)
    assert set(points[0]) == {"series_id", "date", "value"}


def test_series_one_and_unknown_404():
    ids = client.get("/series").json()
    one = client.get(f"/series/{ids[0]}/latest")
    assert one.status_code == 200
    assert one.json()["series_id"] == ids[0]

    missing = client.get("/series/NOPE_NOT_A_SERIES/latest")
    assert missing.status_code == 404
