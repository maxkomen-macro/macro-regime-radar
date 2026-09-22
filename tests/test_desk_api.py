"""tests/test_desk_api.py — the Desk's endpoints, one router (desk/integration, 2026-09-22).

desk/event-study's suite and desk/frame's suite, unified with api/desk.py.

Event study (desk/event-study, 2026-09-21): GET /api/desk/event-study and
/assets against the owner-populated scratch copy (data/desk_scratch.db,
DESK_DB overrides; the tests that need it skip without it) served by a fresh
worker so the generation is built from that file. The presets are worker
items (looked up, never computed on the request path); a free-form query
computes on request behind the expensive-calculator gate, is cached by
(generation key, slug, seed), and answers 202 `computing` with Retry-After
past the wait instead of a blank panel. The TestClient never enters the
lifespan, so no relay and no provider probe run here.

Pipeline inventory (desk/frame, spec §7): shape and provenance only. The
inventory is the freshness report's series[] joined with static provider and
reader facts, so every row must carry the same state /api/freshness serves
for that id, and the module must stay free of src.config (the api/ package
runs without FRED_API_KEY).
"""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import db
from api import desk as desk_mod
from api import security
from api.main import app
from src.desk import event_study as es

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(os.environ.get("DESK_DB", ROOT / "data" / "desk_scratch.db"))

client = TestClient(app)


@pytest.fixture()
def served(install_worker, monkeypatch):
    """A worker serving the scratch copy (the file every Desk read redirects to).
    Skips without the scratch copy (the event-study suite's module-level skip
    before the merge; the inventory tests below need no scratch copy)."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    from api import worker as worker_mod

    monkeypatch.setattr(db, "DB_PATH", SCRATCH)
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    return w


def test_assets_is_a_worker_item_with_stored_coverage(served):
    r = client.get("/api/desk/event-study/assets")
    assert r.status_code == 200, r.text
    a = r.json()
    by = {x["key"]: x for x in a["shocks"]}
    assert by["gold"]["history_from"] == "2000-08-30" and by["gold"]["shock_unit"] == "log_return" and by["gold"]["warn"]
    assert by["spx"]["status"] == "stored" and by["spx"]["default"]
    assert by["hy_oas"]["history_from"] == "2023-09-22" and by["hy_oas"]["known_by"] == "after_close"
    assert by["hy_oas"]["known"] == "next session open" and by["gold"]["defer_as_target"] is True  # R-01, R-03
    assert by["copper"]["status"] == "deferred" and by["ndx"]["status"] == "planned"
    assert a["unavailable"][0]["key"] == "gold_lbma" and "GC=F" in a["unavailable"][0]["reason"]
    assert {t["key"] for t in a["targets"]} == {"spx", "gold", "us10y", "vix", "hy_oas", "ndx", "dxy"}
    assert [p["slug"] for p in a["presets"]] == ["gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross"]
    assert a["regime_lag_months"] == 2
    assert "desk_assets" in served.current.results


def test_preset_is_looked_up_from_the_generation(served, monkeypatch):
    calls = []
    monkeypatch.setattr(es, "run", lambda *a, **k: calls.append(1) or {})
    r = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ready" and body["study"]["slug"] == "gold-2sigma-spx-weak"
    assert calls == [], "a preset never computes on the request path"
    assert body["provenance"]["inputs_hash"] == served.current.results["desk_preset:gold-2sigma-spx-weak"]["provenance"]["inputs_hash"]
    # the same study by its parameters resolves to the same precomputed item
    r2 = client.get("/api/desk/event-study", params={"shock": "gold", "w": 20, "z": 2.0, "sign": "+", "cond": "spx_below_50dma", "target": "spx"})
    assert r2.status_code == 200 and r2.json()["provenance"]["inputs_hash"] == body["provenance"]["inputs_hash"]


def test_a_preset_with_another_seed_computes_with_that_seed(served):
    """Verifier defect 3: the seed is not part of the address but it is part of the study."""
    before = desk_mod.stats["computed"]
    r = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak", "seed": 7})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provenance"]["seed"] == 7 and body["study"]["slug"] == "gold-2sigma-spx-weak"
    assert desk_mod.stats["computed"] == before + 1
    default = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak"}).json()
    assert default["provenance"]["seed"] == es.DEFAULT_SEED
    h20 = lambda b: next(h for h in b["horizons"] if h["h"] == 20)  # noqa: E731
    assert (h20(body)["n"], h20(body)["median"]) == (h20(default)["n"], h20(default)["median"]), "the seed moves only the interval"


def test_preset_carries_the_contract(served):
    body = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak"}).json()
    p = body["provenance"]
    for key in ("as_of", "sample_start", "sample_end", "n_events", "cooldown", "seed", "inputs_hash", "regime_lag_months",
                "regime_revision_caveat", "entry_rule", "inputs", "warnings"):
        assert key in p, key
    assert p["cooldown_sessions"] == 20 and p["n_events"] >= 10
    assert [h["h"] for h in body["horizons"]] == [5, 10, 20, 60]
    assert len(body["recent_events"]) == 10 and len(body["regimes"]) == 5
    assert "Sample since 2000" in body["verdict"]["text"]
    for word in ("predict", "proves", "model", " will "):
        assert word not in body["verdict"]["text"].lower()


def test_free_form_query_computes_once_per_generation_then_hits_the_cache(served):
    before = dict(desk_mod.stats)
    params = {"shock": "vix", "w": 5, "z": 2.0, "sign": "+", "target": "spx"}
    r1 = client.get("/api/desk/event-study", params=params)
    assert r1.status_code == 200, r1.text
    t = time.perf_counter()
    r2 = client.get("/api/desk/event-study", params=params)
    assert r2.status_code == 200 and time.perf_counter() - t < 0.5
    assert r1.json()["provenance"]["inputs_hash"] == r2.json()["provenance"]["inputs_hash"]
    assert desk_mod.stats["computed"] == before["computed"] + 1 and desk_mod.stats["hits"] == before["hits"] + 1
    assert r1.json()["study"]["slug"] == "vix-w5-z2.0-up-none-spx"
    r3 = client.get("/api/desk/event-study", params={"study": "vix-w5-z2.0-up-none-spx"})
    assert r3.status_code == 200 and r3.json()["provenance"]["inputs_hash"] == r1.json()["provenance"]["inputs_hash"], "the slug is a permalink"


def test_slow_computation_answers_computing_not_blank(served, monkeypatch):
    real = es.run

    def slow(q, *a, **k):
        time.sleep(0.6)
        return real(q, *a, **k)

    monkeypatch.setattr(es, "run", slow)
    monkeypatch.setattr(desk_mod, "COMPUTE_TIMEOUT_S", 0.05)
    params = {"shock": "us10y", "w": 20, "z": 2.5, "sign": "-", "target": "gold"}
    r = client.get("/api/desk/event-study", params=params)
    assert r.status_code == 202, r.text
    assert r.headers["retry-after"] == "3" and r.json()["status"] == "computing" and r.json()["slug"] == "us10y-w20-z2.5-down-none-gold"
    monkeypatch.setattr(desk_mod, "COMPUTE_TIMEOUT_S", 20.0)
    r2 = client.get("/api/desk/event-study", params=params)
    assert r2.status_code == 200 and r2.json()["status"] == "ready"


@pytest.mark.parametrize("params", [
    {"w": 7}, {"z": 3.0}, {"sign": "up"}, {"cond": "vix_above"}, {"cond": "regime", "cond_value": "Boom"},
    {"target": "us2y"}, {"shock": "copper"}, {"study": "nope-w1-z9-up-none-spx"}, {"regime": "Boom"},
    # R-14: non-finite thresholds, invalid seeds and parse failures are the engine's 422, not a framework error
    {"z": "nan"}, {"z": "inf"}, {"z": "two"}, {"seed": "-1"}, {"seed": str(2**40)}, {"seed": "abc"}, {"w": "7.5"}, {"w": "x"},
    {"cond": "vix_above", "cond_value": "high"}, {"cond": "vix_above", "cond_value": "nan"},
])
def test_bad_queries_are_422_with_a_reason(served, params):
    r = client.get("/api/desk/event-study", params=params)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, str) and detail, "the engine's reason, not a framework list"


def test_cache_key_is_the_validated_parameters_not_the_spelling(served):
    """R-07: z=2 and z=2.0, seed spelled or defaulted, are one study."""
    before = dict(desk_mod.stats)
    a = client.get("/api/desk/event-study", params={"shock": "us10y", "w": "5", "z": "1.5", "sign": "-", "target": "spx"})
    b = client.get("/api/desk/event-study", params={"shock": "us10y", "w": 5, "z": 1.5, "sign": "-", "target": "spx", "seed": str(es.DEFAULT_SEED)})
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)
    assert a.json()["provenance"]["inputs_hash"] == b.json()["provenance"]["inputs_hash"]
    assert desk_mod.stats["computed"] == before["computed"] + 1 and desk_mod.stats["hits"] == before["hits"] + 1
    assert es.cache_key(es.Query(z="2.0", w="20")) == es.cache_key(es.Query(z=2.0, w=20))


def test_a_full_queue_answers_429_with_retry_after(served, monkeypatch):
    """R-13: outstanding computations are bounded at CACHE_MAX."""
    real = es.run

    def slow(q, *a, **k):
        time.sleep(0.8)
        return real(q, *a, **k)

    monkeypatch.setattr(es, "run", slow)
    monkeypatch.setattr(desk_mod, "COMPUTE_TIMEOUT_S", 0.05)
    monkeypatch.setattr(desk_mod, "CACHE_MAX", 1)
    desk_mod.clear_cache()
    first = client.get("/api/desk/event-study", params={"shock": "us2y", "w": 60, "z": 2.5, "sign": "both", "target": "spx"})
    assert first.status_code == 202, first.text
    second = client.get("/api/desk/event-study", params={"shock": "curve_2s10s", "w": 60, "z": 2.5, "sign": "both", "target": "spx"})
    assert second.status_code == 429, second.text
    assert second.headers["retry-after"] == "3" and second.json()["status"] == "busy"
    monkeypatch.setattr(desk_mod, "COMPUTE_TIMEOUT_S", 20.0)
    again = client.get("/api/desk/event-study", params={"shock": "us2y", "w": 60, "z": 2.5, "sign": "both", "target": "spx"})
    assert again.status_code == 200 and again.json()["status"] == "ready"


def test_planned_series_answer_not_stored(served):
    r = client.get("/api/desk/event-study", params={"shock": "ndx", "target": "spx"})
    assert r.status_code == 503, r.text
    assert r.json()["kind"] == "not_stored" and "^NDX" in r.json()["detail"]


def test_a_job_whose_generation_expired_is_cancelled_and_the_client_gets_a_fresh_202(served, monkeypatch):
    """R-16: a job opens the generation it was submitted under; if that copy
    is gone when it runs, the job is cancelled and the client retries into a
    job under the current generation."""
    from src.analytics import dbpath

    real_open = dbpath.open_generation
    calls = {"n": 0}

    def flaky_open(gen, *a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # the copy was released before the job ran
        return real_open(gen, *a, **k)

    monkeypatch.setattr(desk_mod.dbpath, "open_generation", flaky_open)
    desk_mod.clear_cache()
    before = desk_mod.stats["expired"]
    params = {"shock": "curve_2s10s", "w": 20, "z": 2.0, "sign": "+", "target": "spx"}
    r = client.get("/api/desk/event-study", params=params)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "computing" and desk_mod.stats["expired"] == before + 1
    r2 = client.get("/api/desk/event-study", params=params)
    assert r2.status_code == 200 and r2.json()["status"] == "ready", r2.text
    assert r2.json()["provenance"]["generation"] == str(served.current.key), "computed against the current generation only"


def test_the_study_path_is_under_the_expensive_gate():
    assert "/api/desk/event-study" in security.EXPENSIVE_PATHS
    assert "/api/desk/event-study/assets" not in security.EXPENSIVE_PATHS


def _imported_modules(path: Path) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{a.name}" for a in node.names)
        elif isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", None)) in ("import_module", "__import__"):
            names.update(a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str))
    return names


def test_the_api_never_imports_the_writer_or_yahoo():
    """Imports, not text (desk/integration): the merged module names yfinance
    as the provider of the stored market tables in the inventory's labels,
    which the event-study branch's text check read as an import."""
    for name in ("api/desk.py", "api/analytics_cache.py"):
        mods = _imported_modules(ROOT / name)
        assert not any("desk_history" in m or m.split(".")[0] == "yfinance" for m in mods), (name, sorted(mods))
    assert "desk_history" not in (ROOT / "api" / "analytics_cache.py").read_text()


def test_importing_the_app_loads_no_heavy_dependency():
    """CLAUDE.md (FastAPI section): every heavy dependency is imported at the
    point of use, never at module import. The event-study engine loads pandas,
    numpy and exchange_calendars, so api/desk.py reaches it on first use (the
    worker's first build or the first study), and `import api.main` stays as
    light as it was before the Desk (desk/integration)."""
    heavy = ("pandas", "numpy", "sklearn", "scipy", "exchange_calendars", "riskfolio", "anthropic")
    code = f"import sys, api.main; print(sorted(m for m in {heavy!r} if m in sys.modules))"
    env = {k: v for k, v in os.environ.items() if k != "FRED_API_KEY"}
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "[]"


# ── Pipeline inventory (desk/frame) ─────────────────────────────────────────


def test_desk_module_never_imports_src_config():
    """desk/frame's rule, kept through the merge: the api/ package runs without
    FRED_API_KEY, so the Desk module never imports src.config, directly or
    through what it imports. (The frame's stricter "no src.* at all" could not
    survive the merge: desk/event-study's base reads the config-free engine
    and dbpath from src/.)"""
    tree = ast.parse((ROOT / "api" / "desk.py").read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{a.name}" for a in node.names)
    assert not any(n == "src.config" or n.startswith("src.config.") for n in names), names
    env = {k: v for k, v in os.environ.items() if k != "FRED_API_KEY"}
    out = subprocess.run(
        [sys.executable, "-c", "import sys, api.desk; print('src.config' in sys.modules)"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "False"


def test_inventory_rows_join_is_pure_and_complete():
    series = [
        {"id": "DGS10", "label": "10-year Treasury yield", "kind": "fred", "cadence": "daily", "as_of": "2026-09-18",
         "state": "close", "delay_min": None, "cycles_behind": 0, "stale": False, "discontinued": False, "reason": "r"},
        {"id": "market_daily", "label": "Daily bars (stored)", "kind": "market", "cadence": "daily", "as_of": "2026-09-18",
         "state": "stale", "delay_min": None, "cycles_behind": 2, "stale": True, "discontinued": False, "reason": "r"},
        {"id": "brand_new", "label": "?", "kind": "market", "cadence": "daily", "as_of": None,
         "state": "unknown", "delay_min": None, "cycles_behind": None, "stale": False, "discontinued": False, "reason": ""},
    ]
    rows = desk_mod.inventory_rows(series)
    assert [r["id"] for r in rows] == ["DGS10", "market_daily", "brand_new"]
    assert rows[0]["source"] == "FRED" and rows[0]["source_id"] == "DGS10" and "Recession model" in rows[0]["feeds"]
    assert rows[1]["source"].startswith("yfinance") and rows[1]["source_id"] is None
    # An id the map does not know still gets a provider word and an empty reader list, never a KeyError.
    assert rows[2]["source"] == "stored market data" and rows[2]["feeds"] == []
    # The state fields pass through untouched: the endpoint judges nothing.
    assert rows[1]["state"] == "stale" and rows[1]["cycles_behind"] == 2


def test_every_registered_fred_series_has_readers():
    missing = [sid for sid in freshness_registry() if sid not in desk_mod.FEEDS]
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
    """The Desk's routes, GET only: the event study's two and the frame's
    inventory (spec §7), one router; nothing else and nothing that writes."""
    paths = sorted((r.path, sorted(r.methods)) for r in desk_mod.router.routes)
    assert paths == [
        ("/api/desk/event-study", ["GET"]),
        ("/api/desk/event-study/assets", ["GET"]),
        ("/api/desk/pipeline/inventory", ["GET"]),
    ]
    for path, _ in paths:
        assert client.post(path).status_code == 405, path
