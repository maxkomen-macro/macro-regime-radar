"""tests/test_desk_api.py — the Desk's one thin endpoint (desk/frame, spec §7).

Shape and provenance only: the inventory is the freshness report's series[]
joined with static provider and reader facts, so every row must carry the
same state /api/freshness serves for that id, and the module must stay free
of analytics and of src.* imports (the api/ package runs without FRED_API_KEY).
"""

from __future__ import annotations

import ast
import pathlib

import pytest
from fastapi.testclient import TestClient

from api import db
from api import desk
from api.main import app

client = TestClient(app)

HERE = pathlib.Path(__file__).resolve().parent.parent


def test_desk_module_imports_no_src_and_no_analytics():
    tree = ast.parse((HERE / "api" / "desk.py").read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{a.name}" for a in node.names)
    assert not any(n == "src" or n.startswith("src.") for n in names), names
    assert not any("analytics" in n or "pandas" in n or "numpy" in n or "sklearn" in n for n in names), names


def test_inventory_rows_join_is_pure_and_complete():
    series = [
        {"id": "DGS10", "label": "10-year Treasury yield", "kind": "fred", "cadence": "daily", "as_of": "2026-09-18",
         "state": "close", "delay_min": None, "cycles_behind": 0, "stale": False, "discontinued": False, "reason": "r"},
        {"id": "market_daily", "label": "Daily bars (stored)", "kind": "market", "cadence": "daily", "as_of": "2026-09-18",
         "state": "stale", "delay_min": None, "cycles_behind": 2, "stale": True, "discontinued": False, "reason": "r"},
        {"id": "brand_new", "label": "?", "kind": "market", "cadence": "daily", "as_of": None,
         "state": "unknown", "delay_min": None, "cycles_behind": None, "stale": False, "discontinued": False, "reason": ""},
    ]
    rows = desk.inventory_rows(series)
    assert [r["id"] for r in rows] == ["DGS10", "market_daily", "brand_new"]
    assert rows[0]["source"] == "FRED" and rows[0]["source_id"] == "DGS10" and "Recession model" in rows[0]["feeds"]
    assert rows[1]["source"].startswith("yfinance") and rows[1]["source_id"] is None
    # An id the map does not know still gets a provider word and an empty reader list, never a KeyError.
    assert rows[2]["source"] == "stored market data" and rows[2]["feeds"] == []
    # The state fields pass through untouched: the endpoint judges nothing.
    assert rows[1]["state"] == "stale" and rows[1]["cycles_behind"] == 2


def test_every_registered_fred_series_has_readers():
    missing = [sid for sid in freshness_registry() if sid not in desk.FEEDS]
    assert missing == [], f"series without a reader entry: {missing}"


def freshness_registry() -> list[str]:
    from api import freshness as freshness_mod

    return list(freshness_mod.SERIES_REGISTRY)


@pytest.mark.skipif(not db.DB_PATH.exists(), reason="macro_radar.db not present")
def test_pipeline_inventory_matches_freshness_report():
    r = client.get("/api/desk/pipeline/inventory")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("generated_at", "overall", "regimes_date", "signals_date", "market_daily_date", "series"):
        assert key in body
    assert isinstance(body["series"], list) and body["series"]
    row = body["series"][0]
    assert set(row) >= {"id", "label", "kind", "cadence", "as_of", "state", "stale", "reason", "source", "source_id", "feeds"}
    fresh = client.get("/api/freshness").json()
    by_id = {s["id"]: s for s in fresh.get("series") or []}
    assert set(by_id) == {s["id"] for s in body["series"]}
    for s in body["series"]:
        assert s["state"] == by_id[s["id"]]["state"], s["id"]
        assert s["as_of"] == by_id[s["id"]]["as_of"], s["id"]


def test_desk_router_is_get_only():
    """Exactly one Desk route, GET only: the branch may add nothing else (§7)."""
    paths = [(r.path, sorted(r.methods)) for r in desk.router.routes]
    assert paths == [("/api/desk/pipeline/inventory", ["GET"])]
    assert client.post("/api/desk/pipeline/inventory").status_code == 405
