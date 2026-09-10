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
def test_health_ready_with_db(client):
    r = client.get("/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready" and body["regime_date"]
    assert "db_mtime" in body and "relay_degraded" in body


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
    assert body["primary"]["daily_candles"] == {"primary": "eodhd eod", "fallback": "yfinance"}
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
