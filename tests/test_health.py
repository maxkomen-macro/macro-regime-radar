"""Health, readiness and provider-status endpoints: shapes, status codes and
the no-secrets rule."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api import db
from api.main import app
from api.providers import market as market_layer


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def test_health_live(client):
    r = client.get("/health/live")
    assert r.status_code == 200 and r.json()["status"] == "ok"


@pytest.mark.skipif(not db.DB_PATH.exists(), reason="local DB snapshot absent")
def test_health_ready_with_db(client, monkeypatch):
    """fix/prelaunch-1: ready only once the background worker's first pass has
    built every derived result; warming (503) before that."""
    import threading

    from api import worker as worker_mod

    gate = threading.Event()
    w = worker_mod.AnalyticsWorker(build_gate=gate, poll_s=0.05)
    monkeypatch.setattr(worker_mod, "_worker", w)
    try:
        w.start(serving=False)
        warming = client.get("/health/ready")
        assert warming.status_code == 503 and warming.json()["status"] == "warming"
        gate.set()
        assert w.wait_published(timeout=120)
        r = client.get("/health/ready")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ready" and body["regime_date"]
        assert "db_mtime" in body and "relay_degraded" in body
        assert body["worker"]["generation"] >= 1 and body["worker"]["current_with_file"] is True
    finally:
        w.stop()


def test_health_ready_without_db(client, monkeypatch):
    def gone():
        raise db.DBUnavailable("no db")

    monkeypatch.setattr(db, "latest_regime", gone)
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["status"] == "not_ready"


def test_providers_status_shape_and_no_token(client):
    r = client.get("/api/providers/status")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"generated_at", "eodhd_configured", "primary", "entitlements", "relay", "security"}
    # fix/prelaunch-1: on-demand lookups are EODHD only (no Yahoo fallback)
    assert body["primary"]["daily_candles"] == {"primary": "eodhd eod", "fallback": None}
    assert body["primary"]["macro_series"]["primary"] == "FRED"
    assert body["security"]["assistant_mode"] in ("open", "key", "off")
    tok = market_layer.client().token
    if tok:
        assert tok not in r.text


@pytest.mark.skipif(not db.DB_PATH.exists(), reason="local DB snapshot absent")
def test_freshness_report_extended(client):
    r = client.get("/api/freshness")
    assert r.status_code == 200
    body = r.json()
    for k in ("regimes_date", "market_daily_date", "news_published_at"):
        assert k in body
    assert body["overall"] in ("current", "delayed", "stale", "unavailable")
    assert body["session"]["exchange"] == "NYSE"
    feeds = {row["feed"] for row in body["sla"]}
    assert {"market_daily", "market_intraday", "news", "regime", "fred:INDPRO", "fred:CPIAUCSL", "fred:UNRATE"} <= feeds
    assert "blockers" in body["regime"] and "expected_month" in body["regime"]
    assert "db_mtime" in body["bootstrap"]
