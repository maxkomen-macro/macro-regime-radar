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
from datetime import date, datetime, timezone
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
    # HY OAS: where FRED's rolling window stood when the copy was filled (desk/hardening)
    assert "2023-09-22" <= by["hy_oas"]["history_from"] <= by["hy_oas"]["history_declared"] == "2023-09-25"
    assert by["hy_oas"]["known_by"] == "after_close"
    assert by["hy_oas"]["known"] == "next session open" and by["gold"]["defer_as_target"] is True  # R-01, R-03
    # desk/hardening: the full refresh stores tier 2
    assert by["copper"]["status"] == "deferred"
    for key in ("wti", "ndx", "dxy", "usdjpy"):
        assert by[key]["status"] == "stored" and by[key]["tier"] == 2 and by[key]["shock_unit"] == "log_return", by[key]
    assert by["usdjpy"]["known"] == "20:00 ET clock" and by["dxy"]["fixed"] == "17:00 ET clock"
    assert a["unavailable"][0]["key"] == "gold_lbma" and "GC=F" in a["unavailable"][0]["reason"]
    assert {t["key"] for t in a["targets"]} == {"spx", "gold", "us10y", "vix", "hy_oas", "ndx", "dxy"}
    assert [p["slug"] for p in a["presets"]] == ["gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross"]
    assert a["regime_lag_months"] == 2
    assert "desk_assets" in served.current.results


def test_preset_is_looked_up_from_the_generation(served, monkeypatch):
    calls = []
    # desk/integration (verifier V-05): the request path computes through
    # es.run_on (api/desk._compute); patching es.run alone could never fail.
    monkeypatch.setattr(es, "run", lambda *a, **k: calls.append(1) or {})
    monkeypatch.setattr(es, "run_on", lambda *a, **k: calls.append(1) or {})
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


def test_free_form_query_computes_once_per_generation_then_hits_the_cache(tmp_path, install_worker, monkeypatch):
    from tests.desk_vix import add_vix_close

    _served_copy_with(tmp_path, install_worker, monkeypatch, [], prepare=add_vix_close)
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
    real = es.run_on  # the job's call (verifier V-05: es.run is not on the request path)

    def slow(*a, **k):
        time.sleep(0.6)
        return real(*a, **k)

    monkeypatch.setattr(es, "run_on", slow)
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
    real = es.run_on  # the job's call (verifier V-05)

    def slow(*a, **k):
        time.sleep(0.8)
        return real(*a, **k)

    monkeypatch.setattr(es, "run_on", slow)
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


def test_a_tier2_series_is_studied_from_the_store(served):
    """desk/hardening: the Nasdaq 100 answered 503 not_stored while tier 2 was
    planned; the full refresh stores it now. (A planned tier still answers 503:
    test_before_the_first_refresh_the_event_study_says_it_is_awaiting_it.)"""
    client.get("/api/desk/event-study", params={"shock": "ndx", "target": "spx"})  # may answer 202 computing first
    deadline = time.monotonic() + 60
    while True:
        r = client.get("/api/desk/event-study", params={"shock": "ndx", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:300]
    body = r.json()
    assert body["study"]["shock"]["key"] == "ndx" and body["provenance"]["entry_same_session"] is True
    assert body["provenance"]["inputs"][0]["series_id"] == "^NDX"


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


def test_the_study_path_has_its_own_ceiling():
    """desk/integration (verifier V-02): a free-form study is bounded, but by its
    own ceiling, never the POST calculators' four slots."""
    assert "/api/desk/event-study" in security.DESK_STUDY_PATHS
    assert "/api/desk/event-study" not in security.EXPENSIVE_PATHS
    assert "/api/desk/event-study/assets" not in security.EXPENSIVE_PATHS | security.DESK_STUDY_PATHS


def test_a_study_in_flight_never_takes_a_calculator_slot():
    import asyncio

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, expensive_slots=1, desk_study_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    def call(path, method="GET"):
        sent.clear()
        asyncio.run(mw({"type": "http", "path": path, "method": method, "query_string": b"", "headers": [], "client": ("1.2.3.4", 1)}, receive, send))
        return sent[0]["status"]

    assert mw.desk_study.acquire(blocking=False)  # a slow study in flight
    try:
        assert call("/api/lbo/run", "POST") == 200, "a study never holds a calculator slot"
        assert call("/api/recession/scenario", "POST") == 200
        assert call("/api/desk/event-study") == 429, "a second study waits for the first"
    finally:
        mw.desk_study.release()
    assert call("/api/desk/event-study") == 200


def test_a_study_answers_before_the_browser_gives_up():
    """desk/integration (verifier V-03): the browser aborts a request after
    web/src/api/client.ts's TIMEOUT_MS; the server answers 202 `computing`
    after COMPUTE_TIMEOUT_S. Past the client's limit the page could never
    reach its computing state, so the server answers well before it."""
    import re

    ts = (ROOT / "web/src/api/client.ts").read_text()
    client_ms = int(re.search(r"const TIMEOUT_MS = ([\d_]+);", ts).group(1).replace("_", ""))
    assert desk_mod.COMPUTE_TIMEOUT_S * 1000 <= client_ms - 5000, (desk_mod.COMPUTE_TIMEOUT_S, client_ms)


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
    # desk/integration: the inventory is the freshness report's series[] plus
    # the Desk's daily history rows (desk:<series_id>), which /api/freshness
    # does not carry because no main-app page reads desk_series.
    inv_ids = {s["id"] for s in body["series"]}
    assert set(by_id) <= inv_ids
    extra = inv_ids - set(by_id)
    assert all(i.startswith("desk:") for i in extra), extra
    assert {f"desk:{sid}" for sid in REFRESH_IDS} <= extra
    for s in body["series"]:
        if s["id"] in by_id:
            assert s["state"] == by_id[s["id"]]["state"], s["id"]
            assert s["as_of"] == by_id[s["id"]]["as_of"], s["id"]


# ── desk/integration: the desk_series rows in the inventory (Step 3) ────────

# desk/fill-compute (item 7): the VIX left the FRED set; it is ^VIX in asset_prices, stored beside ^GSPC.
REFRESH_IDS = ["DGS10", "DGS2", "T10Y2Y", "BAMLH0A0HYM2", "DGS3MO", "DGS5", "DGS30", "DCOILWTICO", "^NDX", "DX-Y.NYB", "JPY=X"]
MARKET_IDS = {"^NDX", "DX-Y.NYB", "JPY=X"}  # desk/hardening: tier 2, EODHD first, Yahoo disclosed fallback
NOW = datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc)  # Tue 2026-09-22 16:00 ET, a bond and NYSE session


def test_the_refresh_tier_is_the_workflows_tier():
    """The inventory lists the series the full refresh stores: the registry's
    REFRESH_TIER, which must be the tier refresh-data.yml runs and the
    writer's default."""
    from src.desk import series as registry
    from src.market_data import desk_history

    wf = (ROOT / ".github/workflows/refresh-data.yml").read_text()
    assert f"python -m src.market_data.desk_history --tier {registry.REFRESH_TIER}" in wf
    assert desk_history.DEFAULT_TIER == registry.REFRESH_TIER
    assert [s.series_id for s in registry.fetched(registry.REFRESH_TIER)] == REFRESH_IDS
    assert [s["id"] for s in desk_mod.desk_series_specs(stored=None)] == REFRESH_IDS


def test_desk_series_states_before_the_table_exists():
    from api import freshness as freshness_mod

    rows = freshness_mod.desk_series_states(stored=None, specs=desk_mod.desk_series_specs(stored=None), watermarks=None, now=NOW)
    assert [r["id"] for r in rows] == [f"desk:{sid}" for sid in REFRESH_IDS]
    for r in rows:
        assert r["state"] == "unknown" and r["as_of"] is None and r["stale"] is False, r
        assert "first full refresh" in r["reason"], r["reason"]
        assert r["cadence"] == "daily" and r["kind"] == ("market" if r["id"][5:] in MARKET_IDS else "fred"), r


def test_desk_series_states_judge_each_stored_series():
    from api import calendar as cal
    from api import freshness as freshness_mod

    stored = {"DGS10": "2026-09-21", "DGS2": "2026-09-14", "T10Y2Y": "2026-09-21", "VIXCLS": "2026-09-21", "^NDX": "2026-09-21",
              "DCOILWTICO": "2026-09-15", "JPY=X": "2026-08-31", "SOMETHING": "2026-09-21"}
    marks = {
        "desk:BAMLH0A0HYM2": {"source": "desk:BAMLH0A0HYM2", "last_obs": None, "status": "error", "detail": "ConnectionError"},
        "desk:T10Y2Y": {"source": "desk:T10Y2Y", "last_obs": "2026-09-21", "status": "short",
                        "detail": "fred; served from 1990-01-02; stored from 1990-01-02; 9000 rows; declared 1976-06-01"},
        "desk:^NDX": {"source": "desk:^NDX", "last_obs": "2026-09-21", "status": "excluded",
                      "detail": "yfinance; 1 row dated after 2026-09-22 excluded (tier 2)"},
    }
    rows = freshness_mod.desk_series_states(stored=stored, specs=desk_mod.desk_series_specs(stored=stored), watermarks=marks, now=NOW)
    by = {r["id"]: r for r in rows}
    # the refresh set in registry order, then any other stored series: VIXCLS among them since desk/fill-compute
    # (stored by earlier refreshes and kept, no longer refreshed or read; the VIX is ^VIX in asset_prices)
    assert list(by) == [f"desk:{sid}" for sid in REFRESH_IDS] + ["desk:SOMETHING", "desk:VIXCLS"]
    assert by["desk:DGS10"]["as_of"] == "2026-09-21" and by["desk:DGS10"]["state"] == "close" and by["desk:DGS10"]["cycles_behind"] == 0
    lag = cal.bond_business_days_between(date(2026, 9, 14), date(2026, 9, 21))
    assert by["desk:DGS2"]["state"] == "stale" and by["desk:DGS2"]["stale"] is True and by["desk:DGS2"]["cycles_behind"] == lag > freshness_mod.DAILY_TOLERANCE
    assert by["desk:T10Y2Y"]["state"] == "close" and "declared 1976-06-01" in by["desk:T10Y2Y"]["reason"]
    assert by["desk:VIXCLS"]["state"] == "close"
    assert by["desk:BAMLH0A0HYM2"]["state"] == "unknown" and by["desk:BAMLH0A0HYM2"]["as_of"] is None
    assert "ConnectionError" in by["desk:BAMLH0A0HYM2"]["reason"]
    assert by["desk:^NDX"]["kind"] == "market" and by["desk:^NDX"]["state"] == "close"
    assert "excluded rows dated after it (yfinance; 1 row dated after 2026-09-22 excluded (tier 2))" in by["desk:^NDX"]["reason"]  # R-03
    # desk/hardening: EIA publishes WTI weekly and each print is known on the eighth business
    # day after its date (review R-01), so four business days back is current (the FRED daily
    # rule would read it stale), eight still is, and a month back is not
    wti = by["desk:DCOILWTICO"]
    assert wti["state"] == "close" and wti["cycles_behind"] == 4 > freshness_mod.DAILY_TOLERANCE and "EIA publishes it weekly" in wti["reason"]
    assert "eighth business day after its date" in wti["reason"] and "up to 8 business days old is current" in wti["reason"]
    eight = freshness_mod.desk_series_states(stored={**stored, "DCOILWTICO": "2026-09-09"}, specs=desk_mod.desk_series_specs(stored=stored),
                                             watermarks=marks, now=NOW)
    eight_row = next(r for r in eight if r["id"] == "desk:DCOILWTICO")
    assert eight_row["cycles_behind"] == 8 and eight_row["state"] == "close", eight_row
    old = freshness_mod.desk_series_states(stored={**stored, "DCOILWTICO": "2026-08-31"}, specs=desk_mod.desk_series_specs(stored=stored),
                                           watermarks=marks, now=NOW)
    assert next(r for r in old if r["id"] == "desk:DCOILWTICO")["state"] == "stale"
    assert by["desk:JPY=X"]["state"] == "stale" and by["desk:DX-Y.NYB"]["state"] == "unknown" and "not stored yet" in by["desk:DX-Y.NYB"]["reason"]


def test_inventory_lists_the_desk_series_rows_with_their_freshness(served):
    """The event-study report's §10 follow-up: the Data Pipeline inventory
    carries a row per desk_series series with its as-of date and state."""
    import sqlite3

    conn = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    try:
        stored = dict(conn.execute("SELECT series_id, MAX(date) FROM desk_series GROUP BY series_id").fetchall())
    finally:
        conn.close()
    r = client.get("/api/desk/pipeline/inventory")
    assert r.status_code == 200, r.text
    series = r.json()["series"]
    desk_rows = [s for s in series if s["id"].startswith("desk:")]
    assert [s["id"] for s in desk_rows][: len(REFRESH_IDS)] == [f"desk:{sid}" for sid in REFRESH_IDS]
    assert {s["id"] for s in desk_rows} == {f"desk:{sid}" for sid in stored} | {f"desk:{sid}" for sid in REFRESH_IDS}
    for s in desk_rows:
        sid = s["id"].split(":", 1)[1]
        # a series the refresh stores that this copy predates (the curve tenors) is listed, unknown
        assert s["as_of"] == stored.get(sid), s
        assert s["state"] in (("close", "stale") if sid in stored else ("unknown",)) and s["cadence"] == "daily", s
        assert s["source_id"] == sid and s["feeds"] == [desk_mod.DESK_EVENT_STUDY], s
        if sid in MARKET_IDS:  # desk/hardening: tier 2's market series
            assert s["source"].startswith("EODHD first, Yahoo disclosed fallback") and s["kind"] == "market", s
        else:
            assert s["source"].startswith("FRED") and s["kind"] == "fred", s
    ap = next(s for s in series if s["id"] == "asset_prices")
    assert desk_mod.DESK_EVENT_STUDY in ap["feeds"], "the engine reads ^GSPC and GC=F from asset_prices"


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


# ── desk/integration, Step 4: a database that predates desk_series ──────────
# The deployed database has no desk_series table until the first full refresh
# after the merge (and a database older than fix/prelaunch-1 has no
# asset_prices either). The API must boot and serve every route, and the
# event study must say "awaiting the first full refresh", never an error.

REFRESH_KEYS = ["us10y", "us2y", "curve_2s10s", "vix", "hy_oas", "us3m", "us5y", "us30y", "wti", "ndx", "dxy", "usdjpy"]  # tiers 1 and 2 (desk/hardening; the tenors, desk/frame-3-api)
# desk/fill-etf: the Desk ETFs the full refresh stores in asset_prices that the scratch copy lacks
# (allocation already stores SPY, IWM, IEF, LQD, HYG and GLD there), in registry order
ETF_AWAITING = ["xlb", "xle", "xlf", "xli", "xlk", "xlp", "xlu", "xlv", "xly", "xlc", "xlre", "rsp", "qqq", "smh", "soxx", "igv", "tlt", "uup"]
# Review R-03 (desk/hardening): the route inventory, kept by hand and never read
# from the app under test. One entry per route the API serves: the request that
# exercises it and the status it answers on a database that predates the first
# full refresh (the scratch copy without desk_series), with the provider layer
# tokenless (a typed 503, never a network call) and the assistant switched off
# (503, never a model call). A route the app drops fails as a 404; one the app
# adds without an entry here fails the inventory check.
LBO_BODY = {"ebitda": 100.0, "ebitda_growth_rate": 5.0, "entry_multiple": 8.0, "exit_multiple": 9.0, "hold_period": 5,
            "leverage_ratio": 4.5, "interest_rate": 9.0, "amortization_rate": 5.0, "mgmt_fee_pct": 1.5}
ROUTES: dict[tuple[str, str], tuple[str, int, dict | None]] = {
    # Atlas's frozen, unprefixed contract
    ("GET", "/health"): ("/health", 200, None),
    ("GET", "/regime/latest"): ("/regime/latest", 200, None),
    ("GET", "/signals/latest"): ("/signals/latest", 200, None),
    ("GET", "/series"): ("/series", 200, None),
    ("GET", "/series/latest"): ("/series/latest", 200, None),
    ("GET", "/series/{series_id}/latest"): ("/series/DGS10/latest", 200, None),
    # stored tables
    ("GET", "/api/regime/latest"): ("/api/regime/latest", 200, None),
    ("GET", "/api/regime/history"): ("/api/regime/history", 200, None),
    ("GET", "/api/signals/latest"): ("/api/signals/latest", 200, None),
    ("GET", "/api/priced"): ("/api/priced", 200, None),
    ("GET", "/api/surprises"): ("/api/surprises", 200, None),
    ("GET", "/api/alerts"): ("/api/alerts", 200, None),
    ("GET", "/api/news"): ("/api/news", 200, None),
    ("GET", "/api/news/latest"): ("/api/news/latest", 200, None),
    ("GET", "/api/market/daily"): ("/api/market/daily", 200, None),
    ("GET", "/api/market/intraday"): ("/api/market/intraday", 200, None),
    ("GET", "/api/calendar"): ("/api/calendar", 200, None),
    ("GET", "/api/calendar/recent"): ("/api/calendar/recent", 200, None),
    ("GET", "/api/backtests"): ("/api/backtests", 200, None),
    # the widest window, so the answer never depends on how old the copy is
    ("GET", "/api/credit/oas"): ("/api/credit/oas?days=3650", 200, None),
    ("GET", "/api/freshness"): ("/api/freshness", 200, None),
    # worker results
    ("GET", "/api/credit/metrics"): ("/api/credit/metrics", 200, None),
    ("GET", "/api/recession/probability"): ("/api/recession/probability", 200, None),
    ("GET", "/api/regime/intelligence"): ("/api/regime/intelligence", 200, None),
    ("GET", "/api/regime/playbooks"): ("/api/regime/playbooks", 200, None),
    ("GET", "/api/regime/duration"): ("/api/regime/duration", 200, None),
    ("GET", "/api/regime/transitions"): ("/api/regime/transitions", 200, None),
    ("GET", "/api/regime/analogues"): ("/api/regime/analogues", 200, None),
    ("GET", "/api/regime/scenarios"): ("/api/regime/scenarios", 200, None),
    ("GET", "/api/lbo/defaults"): ("/api/lbo/defaults", 200, None),
    ("GET", "/api/allocation"): ("/api/allocation", 200, None),  # the copy keeps asset_prices
    # calculators over stored data
    ("POST", "/api/regime/scenario"): ("/api/regime/scenario", 200, {"scenario_key": "rate_shock"}),
    ("POST", "/api/recession/scenario"): ("/api/recession/scenario", 200,
                                          {"yield_curve_bps": 50, "unemployment": 4.3, "hy_oas_bps": 350, "indpro_yoy": 1.0, "lei": 0.0}),
    ("POST", "/api/lbo/run"): ("/api/lbo/run", 200, LBO_BODY),
    # the on-demand symbol layer, tokenless: typed 503 missing_token
    ("GET", "/api/market/search"): ("/api/market/search?q=SPY", 503, None),
    ("GET", "/api/market/profile/{symbol}"): ("/api/market/profile/SPY", 503, None),
    ("GET", "/api/market/candles/{symbol}"): ("/api/market/candles/SPY", 503, None),
    ("GET", "/api/market/actions/{symbol}"): ("/api/market/actions/SPY", 503, None),
    ("GET", "/api/market/options/{symbol}/expirations"): ("/api/market/options/SPY/expirations", 503, None),
    ("GET", "/api/market/options/{symbol}"): ("/api/market/options/SPY?expiration=2026-10-16", 503, None),
    ("GET", "/api/market/ticks/{symbol}"): ("/api/market/ticks/SPY", 503, None),
    ("GET", "/api/providers/status"): ("/api/providers/status", 200, None),
    # the assistant, switched off for the sweep (its status follows the mode)
    ("POST", "/api/assistant/ask"): ("/api/assistant/ask", 503, {"message": "What is driving the current regime?"}),
    ("GET", "/api/assistant/status"): ("/api/assistant/status", 503, None),
    # the Desk (the default study reads asset_prices and regimes only: ready)
    ("GET", "/api/desk/event-study/assets"): ("/api/desk/event-study/assets", 200, None),
    ("GET", "/api/desk/event-study"): ("/api/desk/event-study", 200, None),
    ("GET", "/api/desk/pipeline/inventory"): ("/api/desk/pipeline/inventory", 200, None),
    # the Desk v2 routes (api/desk_v2.py, desk/frame-3-api): the §12.13 stubs answer awaiting, and so
    # does /sectors (desk/fill-etf) on a database the ETF refresh has not reached
    ("GET", "/api/desk/sectors"): ("/api/desk/sectors", 200, None),
    ("GET", "/api/desk/vol"): ("/api/desk/vol", 200, None),
    ("GET", "/api/desk/positions"): ("/api/desk/positions", 200, None),
    ("GET", "/api/desk/basket/price"): ("/api/desk/basket/price", 200, None),
    ("GET", "/api/desk/basket/{basket_id}"): ("/api/desk/basket/ai-infra", 200, None),
    ("GET", "/api/desk/hedge"): ("/api/desk/hedge?mode=protect", 200, None),
    # a catalog study by preset (asset_prices and regimes only: ready before the refresh), and the catalog
    ("GET", "/api/desk/study"): ("/api/desk/study?preset=golden-cross", 200, None),
    ("GET", "/api/desk/study/catalog"): ("/api/desk/study/catalog", 200, None),
    ("GET", "/api/desk/study/events"): ("/api/desk/study/events?preset=golden-cross", 200, None),
    ("GET", "/api/desk/ledger"): ("/api/desk/ledger", 200, None),
    ("GET", "/api/desk/technicals"): ("/api/desk/technicals", 200, None),
    ("GET", "/api/desk/overview"): ("/api/desk/overview", 200, None),
    # Desk v2 in the envelope (desk/frame-3-api-b2a): ready, or awaiting blocks, before the first refresh
    ("GET", "/api/desk/regime"): ("/api/desk/regime", 200, None),
    ("GET", "/api/desk/macro"): ("/api/desk/macro", 200, None),
    ("GET", "/api/desk/pipeline"): ("/api/desk/pipeline", 200, None),
    ("GET", "/api/desk/pipeline/ddl"): ("/api/desk/pipeline/ddl", 200, None),
    # diagnostics, open in development (no DEPLOY_PUBLIC, no CORS_ORIGINS)
    ("GET", "/api/ops/whoami"): ("/api/ops/whoami", 200, None),
    ("GET", "/api/stream/debug"): ("/api/stream/debug", 200, None),
    ("GET", "/health/live"): ("/health/live", 200, None),
    ("GET", "/health/ready"): ("/health/ready", 200, None),
}


def served_routes() -> set[tuple[str, str]]:
    """(method, path) for every operation the app serves (FastAPI 0.141 keeps an
    included router as one entry in app.routes, so read the schema)."""
    return {(m.upper(), path) for path, ops in app.openapi()["paths"].items() for m in ops}


def route_sweep_failures(tc: TestClient, routes: dict[tuple[str, str], tuple[str, int, dict | None]]) -> dict[str, tuple]:
    """Every inventory entry that does not answer its expected status; a 404 is
    always a failure, whatever the entry expects. The provider layer's cached
    entitlement verdicts are cleared before each request, so an entry answers
    on its own and never on the one before it (a tokenless options call caches
    `missing_token` for the family, and the next options route read it as 403)."""
    from api.providers import entitlements

    failed: dict[str, tuple] = {}
    for (method, template), (url, expected, body) in routes.items():
        entitlements.reset_for_tests()
        r = tc.get(url) if method == "GET" else tc.post(url, json=body)
        if r.status_code == 404:
            failed[f"{method} {template}"] = (404, "not served", r.text[:200])
        elif r.status_code != expected:
            failed[f"{method} {template}"] = (r.status_code, f"expected {expected}", r.text[:200])
    return failed


@pytest.fixture()
def hermetic_edges(monkeypatch):
    """No provider token, no assistant, the development posture: every edge
    route answers without the network, deterministically."""
    from api.providers import entitlements
    from api.providers import eodhd as eod
    from api.providers import finnhub as fh
    from api.providers import market

    monkeypatch.setattr(market, "_client", eod.EodhdClient(None))
    monkeypatch.setattr(fh, "_client", fh.FinnhubClient(None))
    market.clear_caches()
    entitlements.reset_for_tests()
    monkeypatch.setenv("ASSISTANT_ACCESS", "off")
    for var in ("DEPLOY_PUBLIC", "CORS_ORIGINS", "OPS_ACCESS_KEY"):
        monkeypatch.delenv(var, raising=False)
    yield
    market.clear_caches()
    entitlements.reset_for_tests()


def _serve_copy(tmp_path, install_worker, monkeypatch, drop: tuple[str, ...]):
    """A worker serving a copy of the scratch database with `drop` removed (and
    the Desk's watermarks, which the writer records beside its table)."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod

    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    for table in drop:
        dst.execute(f"DROP TABLE IF EXISTS {table}")
    dst.execute("DELETE FROM source_watermarks WHERE source LIKE 'desk%'")
    dst.commit()
    dst.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    return w


@pytest.fixture()
def served_before_refresh(tmp_path, install_worker, monkeypatch):
    """The deployed database before the first full refresh after the merge."""
    return _serve_copy(tmp_path, install_worker, monkeypatch, drop=("desk_series",))


@pytest.fixture()
def served_before_histories(tmp_path, install_worker, monkeypatch):
    """A database older still: neither desk_series nor asset_prices."""
    return _serve_copy(tmp_path, install_worker, monkeypatch, drop=("desk_series", "asset_prices"))


def test_the_route_inventory_is_the_apps_exactly():
    """R-03: the hand-kept inventory and the served routes are the same set,
    so a dropped endpoint and an unlisted new one both fail here."""
    served = served_routes()
    assert set(ROUTES) - served == set(), "listed but not served"
    assert served - set(ROUTES) == set(), "served but not in the inventory: add it with its expected status"
    assert ("GET", "/api/desk/event-study") in ROUTES and ("GET", "/api/allocation") in ROUTES


def test_before_the_first_refresh_every_route_answers_its_expected_status(served_before_refresh, hermetic_edges):
    """R-03: each route answers the status the inventory states, and none 404s."""
    tc = TestClient(app, raise_server_exceptions=False)
    failed = route_sweep_failures(tc, ROUTES)
    assert failed == {}, failed
    ready = tc.get("/health/ready")
    assert ready.status_code == 200 and ready.json()["status"] == "ready"


def test_the_route_sweep_fails_on_a_missing_endpoint_and_on_a_wrong_status(served_before_refresh, hermetic_edges):
    """The sweep itself: an endpoint that is not served is a failure even where
    404 is what the entry says, and any other status than the stated one is."""
    tc = TestClient(app, raise_server_exceptions=False)
    # (/api/desk/positions, the example here before desk/frame-3-api, is a served stub now.)
    failed = route_sweep_failures(tc, {
        ("GET", "/api/desk/not-a-route"): ("/api/desk/not-a-route", 404, None),
        ("GET", "/api/desk/event-study/assets"): ("/api/desk/event-study/assets", 503, None),
        ("GET", "/health"): ("/health", 200, None),
    })
    assert failed["GET /api/desk/not-a-route"][:2] == (404, "not served")
    assert failed["GET /api/desk/event-study/assets"][:2] == (200, "expected 503")
    assert "GET /health" not in failed


def test_before_the_first_refresh_the_event_study_says_it_is_awaiting_it(served_before_refresh, monkeypatch):
    assets = client.get("/api/desk/event-study/assets")
    assert assets.status_code == 200, assets.text
    a = assets.json()
    assert a["awaiting_refresh"] == REFRESH_KEYS + ETF_AWAITING
    by = {x["key"]: x for x in a["shocks"]}
    assert all(by[k]["status"] == "awaiting_refresh" for k in REFRESH_KEYS if k in by)
    assert by["spx"]["status"] == "stored" and by["gold"]["status"] == "stored" and by["ndx"]["status"] == "awaiting_refresh"

    r = client.get("/api/desk/event-study", params={"shock": "us10y", "w": 5, "z": 2.0, "sign": "+", "target": "spx"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "awaiting_refresh" and body["slug"] == "us10y-w5-z2.0-up-none-spx" and body["series"] == "us10y"
    assert "first full refresh" in body["detail"] and "no such table" not in body["detail"]
    assert r.headers["cache-control"] == "no-store"
    # desk/fill-compute (item 7): the VIX is ^VIX in asset_prices, a table this store has without its rows.
    r = client.get("/api/desk/event-study", params={"shock": "vix", "w": 5, "z": 2.0, "sign": "+", "target": "spx"})
    body = r.json()
    assert body["status"] == "awaiting_refresh" and body["series"] == "vix" and "next full refresh" in body["detail"], body
    # The same study by its slug.
    r = client.get("/api/desk/event-study", params={"study": "vix-w5-z2.0-up-none-spx"})
    assert r.status_code == 200 and r.json()["status"] == "awaiting_refresh"
    # A condition on a desk_series input, with a shock and target in asset_prices (verifier V-05).
    for cond, value, series in (("vix_above", "20", "vix"), ("hy_oas_20d_change_above", "25", "hy_oas")):
        r = client.get("/api/desk/event-study", params={"shock": "gold", "w": 20, "z": 2.0, "sign": "+", "cond": cond, "cond_value": value, "target": "spx"})
        assert r.status_code == 200 and r.json()["status"] == "awaiting_refresh" and r.json()["series"] == series, r.text[:200]

    # The presets read asset_prices and the regime table only: ready before the refresh.
    for slug in es.PRESETS:
        r = client.get("/api/desk/event-study", params={"study": slug})
        assert r.status_code == 200 and r.json()["status"] == "ready", (slug, r.text[:200])

    # desk/hardening: a tier-2 series is awaiting the same refresh.
    r = client.get("/api/desk/event-study", params={"shock": "ndx", "target": "spx"})
    assert r.status_code == 200 and r.json()["status"] == "awaiting_refresh" and r.json()["series"] == "ndx", r.text[:200]

    inv = client.get("/api/desk/pipeline/inventory").json()
    rows = [s for s in inv["series"] if s["id"].startswith("desk:")]
    assert [s["id"] for s in rows] == [f"desk:{sid}" for sid in REFRESH_IDS]
    assert all(s["state"] == "unknown" and "first full refresh" in s["reason"] for s in rows), rows

    # A planned series is not stored and no refresh will store it yet: still 503, with the reason.
    # (Every available series is stored by the refresh since desk/hardening; the path is
    # pinned with the refresh tier set back to 1, which makes tier 2 planned again.)
    from src.desk import series as registry

    monkeypatch.setattr(registry, "REFRESH_TIER", 1)
    r = client.get("/api/desk/event-study", params={"shock": "ndx", "target": "spx"})
    assert r.status_code == 503 and r.json()["kind"] == "not_stored" and "tier 2" in r.json()["detail"], r.text[:200]
    assert "^NDX" in r.json()["detail"]


def test_before_the_histories_the_presets_say_they_are_awaiting_the_first_refresh(served_before_histories):
    for slug in es.PRESETS:
        r = client.get("/api/desk/event-study", params={"study": slug})
        assert r.status_code == 200, (slug, r.text)
        body = r.json()
        assert body["status"] == "awaiting_refresh" and body["slug"] == slug and "first full refresh" in body["detail"], body
    a = client.get("/api/desk/event-study/assets").json()
    assert {"spx", "gold"} <= set(a["awaiting_refresh"])
    assert client.get("/health/ready").status_code == 200


def test_the_freshness_drawer_names_every_sla_feed_the_api_emits():
    """desk/event-study added a `desk_series` verdict to /api/freshness's sla
    rows, which the main app's Freshness drawer lists; without a label it
    printed the table name, the defect launch-1 fixed for asset_prices. Every
    feed assess() can emit, the FRED ones aside (labelled by series), must
    have a reader label in web/src/screens/shell/shell-status.ts."""
    import re

    from api import freshness as freshness_mod

    fresh = {"regimes_date": "2026-08-01", "signals_date": "2026-09-01", "market_daily_date": "2026-09-18",
             "market_intraday_ts": "2026-09-18 15:55:00", "news_published_at": "2026-09-20T23:07:12+00:00",
             "raw_series_date": "2026-09-01", "asset_prices_date": "2026-09-18", "desk_series_date": "2026-09-18"}
    relay = {"token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {}, "feed_last_frame_at": {}, "feed_last_tick_at": {}}
    rep = freshness_mod.assess(db_fresh=fresh, series_latest=[], relay=relay, bootstrap=None, now=NOW, watermarks={})
    feeds = {r["feed"] for r in rep["sla"] if not r["feed"].startswith("fred:")}
    assert {"asset_prices", "desk_series", "live_quotes", "vix_delayed"} <= feeds, feeds
    ts = (ROOT / "web/src/screens/shell/shell-status.ts").read_text()
    block = ts[ts.index("const FEED_LABELS"): ts.index("};", ts.index("const FEED_LABELS"))]
    labelled = set(re.findall(r"^\s*([a-z_]+):\s*\"", block, flags=re.M))
    assert feeds <= labelled, sorted(feeds - labelled)


def test_a_preset_awaiting_the_refresh_never_holds_a_generation_back(tmp_path, install_worker, monkeypatch):
    """Verifier V-01 (desk/integration). The worker holds a new generation back
    when an item the served one answers well fails on the new file, except when
    the failure is a fact about the file (api.db.NotStored: allocation on a
    database without asset_prices). The presets fail on such a file with the
    engine's NotStored, awaiting the first full refresh: the same fact, so the
    new generation must publish at once instead of answering `warming` for the
    ~90 s the hold takes (tests/test_api.py::test_api_allocation_smoke failed
    this way on a repo database that carries asset_prices)."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod

    def copy(dst, drop=()):
        src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
        out = sqlite3.connect(dst)
        src.backup(out)
        src.close()
        for table in drop:
            out.execute(f"DROP TABLE IF EXISTS {table}")
        out.commit()
        out.close()
        return dst

    full = copy(tmp_path / "full.db")
    bare = copy(tmp_path / "bare.db", drop=("asset_prices", "desk_series"))
    monkeypatch.setattr(db, "DB_PATH", full)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    assert "desk_preset:gold-2sigma-spx-weak" in w.current.results
    desk_mod.clear_cache()

    monkeypatch.setattr(db, "DB_PATH", bare)
    db.reset_connections_for_tests()
    t = time.perf_counter()
    r = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "awaiting_refresh", r.text[:300]
    assert time.perf_counter() - t < 30, "the new generation published without a hold"
    assert w._held is None
    alloc = client.get("/api/allocation")
    assert alloc.status_code == 503 and alloc.json()["kind"] == "not_stored"


def test_the_drawer_verdict_follows_the_series_the_refresh_stores():
    """desk/integration (verifier V-06): event-study's `desk_series` sla verdict
    judged the oldest newest date across every stored series on the NYSE
    calendar, so the day after Columbus Day (bond market closed, NYSE open) it
    read stale while every inventory row read close, and a tier-2 series
    fetched by hand pinned it stale for good. It follows the same per-series
    rule as the inventory now, over the series the full refresh stores."""
    from api import freshness as freshness_mod

    base = {"regimes_date": "2026-09-01", "signals_date": "2026-10-01", "market_daily_date": "2026-10-13",
            "market_intraday_ts": None, "news_published_at": None, "raw_series_date": "2026-10-01", "asset_prices_date": "2026-10-13"}
    now = datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc)
    latest = {"DGS10": "2026-10-09", "DGS2": "2026-10-09", "T10Y2Y": "2026-10-09", "BAMLH0A0HYM2": "2026-10-09",
              "DGS3MO": "2026-10-09", "DGS5": "2026-10-09", "DGS30": "2026-10-09",
              "^NDX": "2026-09-21"}  # a tier-2 series weeks old; the other three tier-2 series not stored at all

    def verdict(latest_by_id):
        fresh = {**base, "desk_series_date": min(latest_by_id.values()) if latest_by_id else None, "desk_series_latest": latest_by_id}
        rep = freshness_mod.assess(db_fresh=fresh, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})
        return next(r for r in rep["sla"] if r["feed"] == "desk_series")

    row = verdict(latest)
    assert row["verdict"] == "current", row
    states = freshness_mod.desk_series_states(stored=latest, specs=desk_mod.desk_series_specs(stored=latest), watermarks={}, now=now)
    tier1_ids = [sid for sid, meta in freshness_mod.DESK_REFRESH_SERIES.items() if meta["tier"] == 1]
    assert tier1_ids == REFRESH_IDS[:7]
    tier1 = {f"desk:{sid}" for sid in tier1_ids}
    assert all(s["state"] == "close" for s in states if s["id"] in tier1)
    # desk/hardening: tier 2 is named in the reason and never turns the verdict
    assert {s["id"] for s in states if s["state"] != "close"} == {f"desk:{sid}" for sid in REFRESH_IDS[7:]}
    assert "Tier 2, reported and not judged" in row["reason"] and "Nasdaq 100" in row["reason"], row
    lagging = verdict({**latest, "DGS2": "2026-09-14"})
    assert lagging["verdict"] == "stale" and "2Y Treasury" in lagging["reason"], lagging
    missing = verdict(None)
    assert missing["verdict"] == "unavailable" and missing["latest"] is None


def test_a_series_missing_from_an_existing_table_awaits_the_next_refresh_not_the_first():
    """Verifier V-08: "the first full refresh" only when the table itself is absent."""
    import sqlite3

    from src.desk import series as registry

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE desk_series (series_id TEXT, date TEXT, value REAL, provider TEXT)")
    with pytest.raises(es.NotStored) as exc:
        es.load_level(conn, registry.get("us10y"))
    assert exc.value.awaiting_refresh and "next full refresh" in str(exc.value) and "first" not in str(exc.value)
    conn.execute("DROP TABLE desk_series")
    with pytest.raises(es.NotStored) as exc:
        es.load_level(conn, registry.get("us10y"))
    assert exc.value.awaiting_refresh and "first full refresh" in str(exc.value)
    # desk/fill-compute (item 7): the VIX, ^VIX in asset_prices, by the same rule on its own table.
    conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT)")
    with pytest.raises(es.NotStored) as exc:
        es.load_level(conn, registry.get("vix"))
    assert exc.value.awaiting_refresh and "next full refresh" in str(exc.value) and "first" not in str(exc.value)
    conn.execute("DROP TABLE asset_prices")
    with pytest.raises(es.NotStored) as exc:
        es.load_level(conn, registry.get("vix"))
    assert exc.value.awaiting_refresh and "first full refresh" in str(exc.value)


def test_patching_the_engine_through_the_proxy_leaves_no_shadow(monkeypatch):
    """Verifier V-07: attribute writes on api.desk.es reach the real module, so
    an undone patch leaves nothing behind that later hides the module."""
    from src.desk import event_study as real

    with monkeypatch.context() as m:
        m.setattr(desk_mod.es, "DEFAULT_SEED", 1)
        assert real.DEFAULT_SEED == 1 and desk_mod.es.DEFAULT_SEED == 1
    assert "DEFAULT_SEED" not in vars(desk_mod.es)
    with monkeypatch.context() as m:
        m.setattr(real, "DEFAULT_SEED", 99)
        assert desk_mod.es.DEFAULT_SEED == 99


def test_the_freshness_mirror_of_the_refresh_series_is_the_registrys():
    """Verifier V-12: api/freshness.py stays stdlib + api/ (validate_db runs it
    on the lean installs; tests/test_workflows.py pins it), so the drawer's
    desk_series verdict reads a mirror of the series the full refresh stores.
    The mirror is the registry's, exactly."""
    from api import freshness as freshness_mod

    assert freshness_mod.desk_refresh_specs() == desk_mod.desk_series_specs(stored=None)


def test_a_preset_lookup_never_waits_behind_the_study_ceiling():
    """Verifier V-13: the presets are worker items (a lookup), so the page's
    default study must not queue behind other visitors' free-form studies. A
    preset by its slug alone is a stored read; with a seed, or by parameters,
    it computes and takes the study ceiling."""
    import asyncio

    from src.desk import event_study as real

    assert security.DESK_PRESET_SLUGS == frozenset(real.PRESETS)

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, desk_study_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    def get(qs: bytes):
        sent.clear()
        asyncio.run(mw({"type": "http", "path": "/api/desk/event-study", "method": "GET", "query_string": qs, "headers": [], "client": ("1.2.3.4", 1)}, receive, send))
        return sent[0]["status"]

    assert mw.desk_study.acquire(blocking=False)  # every study slot is taken
    try:
        for preset in sorted(real.PRESETS):
            assert get(f"study={preset}".encode()) == 200, preset
        assert get(b"study=spx-golden-cross&seed=7") == 429, "another seed computes"
        assert get(b"study=vix-w5-z2.0-up-none-spx") == 429
        assert get(b"shock=gold&w=20&z=2&sign=%2B&cond=spx_below_50dma&target=spx") == 429
    finally:
        mw.desk_study.release()


# ── desk/hardening, review R-01: a transient first import of the engine ─────

def test_a_failed_first_import_of_the_engine_recovers_by_rebuilding_the_same_file(install_worker, monkeypatch):
    """R-01: the first import of src.desk.event_study fails once (a one-shot
    ImportError from the import system, as a half-copied module or an import
    race gives). The generation publishes with desk_assets as that error, and
    the file's key never moves, so before this branch nothing rebuilt it: the
    assets endpoint and every free-form study answered 500 until a refresh or
    a restart. The worker now rebuilds the same file, whole, after a short
    wait; the rebuilt generation answers everything and replaces the first."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import importlib.abc
    import sys

    import src.desk
    from api import analytics_cache
    from api import worker as worker_mod

    raised: list[str] = []

    class OneShotImportFailure(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path, target=None):
            if fullname == "src.desk.event_study" and not raised:
                raised.append(fullname)
                raise ImportError("probe: a transient first import failure", name=fullname)
            return None

    # A fresh import, as at a cold start: the module leaves sys.modules and the
    # package (monkeypatch puts the original back, so the rest of the suite keeps it).
    monkeypatch.delitem(sys.modules, "src.desk.event_study")
    monkeypatch.delattr(src.desk, "event_study")
    monkeypatch.setattr(sys, "meta_path", [OneShotImportFailure(), *sys.meta_path])
    monkeypatch.setattr(db, "DB_PATH", SCRATCH)
    db.reset_connections_for_tests()
    items = [(n, fn) for n, fn in analytics_cache.ITEMS if n.startswith("desk")]
    # desk/frame-3-api: the Desk v2 items (the catalog's thirteen studies, /technicals' and /overview's)
    # sit among them; desk_assets is still the first to import the engine
    assert [n for n, _ in items][0] == "desk_assets"
    assert {f"desk_preset:{n}" for n in analytics_cache.DESK_PRESETS} <= {n for n, _ in items}
    w = install_worker(worker_mod.AnalyticsWorker(items=items, poll_s=0.05))
    w.import_retry_s = 1.5
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    first = w.current
    assert raised == ["src.desk.event_study"], "the one-shot failure fired on the first import"
    assert isinstance(first.errors.get("desk_assets"), ImportError), first.errors
    assert all(f"desk_preset:{n}" in first.results for n in analytics_cache.DESK_PRESETS), "the next import succeeded"
    tc = TestClient(app, raise_server_exceptions=False)
    assert tc.get("/api/desk/event-study/assets").status_code == 500, "the failure is served until the rebuild lands"
    status = w.status()
    assert status["rebuild"] == {"items": ["desk_assets"], "done": 0, "of": worker_mod.IMPORT_RETRY_ATTEMPTS}, status

    assert w.wait_published(min_id=first.id + 1, timeout=180), "the same file was rebuilt and published"
    second = w.current
    assert second.key == first.key and second.id > first.id and second.errors == {}
    assert "desk_assets" in second.results
    for name in analytics_cache.DESK_PRESETS:  # rebuilt whole from the new copy, nothing carried over
        assert second.results[f"desk_preset:{name}"] is not first.results[f"desk_preset:{name}"]
    st = w.status()
    assert st["rebuild"] is None and st["last_error"] is None, st
    desk_mod.clear_cache()
    r = tc.get("/api/desk/event-study/assets")
    assert r.status_code == 200 and {x["key"] for x in r.json()["shocks"]} >= {"spx", "gold", "ndx"}, r.text[:200]
    deadline = time.monotonic() + 60
    while True:  # a free-form study, which waited on desk_assets and answered 500 before
        # desk/fill-compute: the 10-year, which the scratch copy stores (its VIX is FRED's, which the Desk no longer reads)
        r = tc.get("/api/desk/event-study", params={"shock": "us10y", "w": 5, "z": 2.0, "sign": "+", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:200]


# ── desk/hardening, review round 3: R-06, the generation's as-of ────────────

def test_the_desk_reads_nothing_dated_after_the_generations_as_of(tmp_path, install_worker, monkeypatch):
    """Review R-06, end to end: rows dated after the generation's as-of (the New
    York date its copy was staged) are read by none of the Desk's paths: the
    worker-built preset and assets list (the generation is pinned) and a
    free-form study computed on the pool's thread (it gets the as-of from its
    lease). Each says what it left out."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod

    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    dst.execute("INSERT INTO desk_series VALUES ('DCOILWTICO', '2099-12-31', 99.0, 'fred')")
    dst.execute("INSERT INTO asset_prices VALUES ('^GSPC', '1d', '2099-12-31', 99999.0, 'test')")
    dst.commit()
    dst.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    as_of = w.current.as_of
    # pinned through the session calendar to the instant the copy was staged, never today() (V-20:
    # a build straddling New York midnight made the two dates differ)
    from api import calendar as cal

    staged = datetime.strptime(w.current.staged_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert as_of == staged.astimezone(cal.NY).date().isoformat() and w.status()["as_of"] == as_of

    preset = client.get("/api/desk/event-study", params={"study": "gold-2sigma-spx-weak"}).json()
    assert preset["status"] == "ready" and preset["provenance"]["as_of_cutoff"] == as_of
    assert preset["provenance"]["future_excluded"] == {"spx": 1}
    assets = {x["key"]: x for x in client.get("/api/desk/event-study/assets").json()["shocks"]}
    assert assets["wti"]["last"] < "2099-12-31" and assets["spx"]["last"] < "2099-12-31"
    deadline = time.monotonic() + 60
    while True:
        r = client.get("/api/desk/event-study", params={"shock": "wti", "w": 5, "z": 2.0, "sign": "both", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:300]
    p = r.json()["provenance"]
    assert p["as_of_cutoff"] == as_of and p["future_excluded"] == {"spx": 1, "wti": 1}
    assert all(m["last"] < "2099-12-31" for m in p["inputs"])
    assert any("rows dated after" in x for x in p["warnings"])


# ── desk/hardening, review round 4: R-07, the study cache and the cutoff ────

def _one_event_store(path: Path) -> Path:
    """A synthetic store ending Monday 2026-09-14 whose VIX has exactly one +2.5σ
    5-session move: every other 5-session move is ±1% (z of about ±1), and the
    level doubles six sessions before the end. VIX settles after the close, so
    the S&P is entered the next session and the 5-session window closes on
    2026-09-14: N = 1 at a cutoff of 2026-09-14, N = 0 at 2026-09-13."""
    import sqlite3

    import numpy as np

    from src.market_data import asset_history, desk_history
    from tests.test_event_study import _synthetic_db

    _synthetic_db(path, spx_end="2026-09-14")
    cal = es.session_calendar("1995-01-02", "2026-09-14")
    sessions = es.sessions_between(cal, "1995-01-03", "2026-09-14")
    level = np.log(20.0) + 0.01 * (np.arange(len(sessions)) % 2)
    level[len(sessions) - 7:] += np.log(2.0)
    conn = sqlite3.connect(path)
    vix = [(d.strftime("%Y-%m-%d"), float(np.exp(v))) for d, v in zip(sessions, level)]
    desk_history.write_series(conn, "VIXCLS", vix, provider="fred", merge=False)
    # desk/fill-compute (item 7): the engine reads ^VIX from asset_prices; the same one-event level there.
    asset_history.write_series(conn, "^VIX", "1d", vix, provider="test")
    conn.commit()
    conn.close()
    return path


def test_two_generations_of_one_file_with_different_cutoffs_never_share_a_cached_study(tmp_path, install_worker, monkeypatch):
    """Review R-07: two generations built from one file across New York
    midnight carry different as-of cutoffs. The study cache used to key on the
    file alone, so a study cached under the newer generation (cutoff Sep 14,
    5d N = 1) was served to a request pinned to the older one (cutoff Sep 13,
    where the direct computation gives N = 0). The key is now the generation's
    identity, its effective cutoff and the lossless parameters, and expiry
    follows the generation, not the file."""
    from dataclasses import replace as dc_replace

    from api import analytics_cache
    from api import worker as worker_mod
    from src.analytics import dbpath

    path = _one_event_store(tmp_path / "macro_radar.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(items=[("desk_assets", analytics_cache._desk_assets)], poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=120)
    gen = w.current
    newer = dc_replace(gen, id=gen.id + 1000, as_of="2026-09-14")  # the same file, staged after midnight
    older = dc_replace(gen, id=gen.id + 1001, as_of="2026-09-13")
    assert newer.key == older.key and newer.uri == older.uri
    q = es.Query(shock="vix", w=5, z=2.5, sign="+", target="spx")

    def study(g):
        with dbpath.pinned(g):
            for _ in range(60):
                r = desk_mod.study_result(q)
                if r is not None:
                    return r
                time.sleep(0.5)
        raise AssertionError("the study never finished")

    def n5(r):
        return next(h for h in r["horizons"] if h["h"] == 5)["n"]

    desk_mod.clear_cache()
    before = dict(desk_mod.stats)
    r_new = study(newer)
    assert n5(r_new) == 1 and r_new["provenance"]["as_of_cutoff"] == "2026-09-14"
    r_old = study(older)
    conn = dbpath.open_generation(gen)
    try:
        direct = es.run_on(conn, q, generation=gen.key, as_of="2026-09-13")
    finally:
        conn.close()
    assert n5(direct) == 0
    assert n5(r_old) == 0 and r_old["provenance"]["as_of_cutoff"] == "2026-09-13", "the newer generation's entry was reused"
    assert r_old["horizons"] == direct["horizons"]
    assert desk_mod.stats["computed"] == before["computed"] + 2 and desk_mod.stats["hits"] == before["hits"]
    # expiry follows the generation: the newer one's finished entry went when the older one submitted
    assert {k[0] for k in desk_mod._cache} == {older.id}
    assert n5(study(older)) == 0 and desk_mod.stats["hits"] == before["hits"] + 1, "a repeat under the same generation is a hit"


# ── desk/hardening, verifier round 4: V-14, a non-numeric past-dated value ──

def test_a_non_numeric_stored_value_is_quarantined_on_read_and_never_500s_the_desk(tmp_path, install_worker, monkeypatch):
    """Verifier V-14: a single non-numeric value in a past-dated stored row (the
    10-year Treasury in desk_series, USD/JPY there too, the S&P in asset_prices)
    made the reader's float() raise: desk_assets failed, the assets list and
    every free-form study answered 500. The reader now quarantines such a value
    on read: the study excludes it and says so. validate_db reports it: tier 1
    and asset_prices fail, tier 2 warns."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod
    from scripts import validate_db as v

    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    assert dst.execute("UPDATE desk_series SET value = 'n/a' WHERE series_id = 'DGS10' AND date = '2010-06-01'").rowcount == 1
    assert dst.execute("UPDATE desk_series SET value = 'n/a' WHERE series_id = 'JPY=X' AND date = '2010-06-01'").rowcount == 1
    assert dst.execute("UPDATE asset_prices SET close = 'n/a' WHERE symbol = '^GSPC' AND interval = '1d' AND date = '2010-06-01'").rowcount == 1
    dst.commit()
    dst.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    assert not any(name.startswith("desk") for name in w.current.errors), w.current.errors

    tc = TestClient(app, raise_server_exceptions=False)
    assets = tc.get("/api/desk/event-study/assets")
    assert assets.status_code == 200, assets.text[:300]
    by = {x["key"]: x for x in assets.json()["shocks"]}
    assert by["us10y"]["status"] == "stored" and by["usdjpy"]["status"] == "stored" and by["spx"]["status"] == "stored"

    def ready(params):
        deadline = time.monotonic() + 60
        while True:
            r = tc.get("/api/desk/event-study", params=params)
            if r.status_code != 202 or time.monotonic() > deadline:
                return r
            time.sleep(0.5)

    r = ready({"shock": "us10y", "w": 20, "z": 2.0, "sign": "+", "target": "spx"})
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:300]
    p = r.json()["provenance"]
    assert p["non_numeric_excluded"] == {"spx": 1, "us10y": 1}
    assert p["exclusions"]["us10y"]["non_numeric"] == 1 and p["exclusions"]["spx"]["non_numeric"] == 1
    assert any("non-numeric stored values quarantined on read and excluded: spx 1, us10y 1" in x for x in p["warnings"]), p["warnings"]
    r = ready({"shock": "usdjpy", "w": 5, "z": 2.0, "sign": "+", "target": "dxy"})
    assert r.status_code == 200 and r.json()["provenance"]["non_numeric_excluded"] == {"usdjpy": 1}, r.text[:300]

    rep = v.validate(path, None, "full")
    assert "desk:DGS10 (tier 1): 1 non-numeric value" in rep["failures"], rep["failures"]
    assert "asset_prices: 1 row(s) with a non-numeric close" in rep["failures"]
    assert any(w_.startswith("desk:JPY=X: 1 non-numeric value") and "tier 2, reported, never blocking" in w_ for w_ in rep["warnings"]), rep["warnings"]


# ── desk/hardening, verifier round 5: V-22, a malformed stored date ─────────

def test_a_malformed_stored_date_is_set_aside_on_read_and_never_500s_the_desk(tmp_path, install_worker, monkeypatch):
    """Verifier V-22, V-14's fault in the date column: one stored row whose date
    is not a valid ISO date ('1999-99-99' in the 10-year Treasury, tier 1; and
    '2010-02-30' in USD/JPY, tier 2) made the reader's date parse raise, so the
    assets list and every free-form study answered 500. Such a row is now set
    aside on read, counted per series, named in the study's warnings and
    included in its hash. validate_db fails the tier-1 date and warns for tier 2."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod
    from scripts import validate_db as v

    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    dst.execute("INSERT INTO desk_series VALUES ('DGS10', '1999-99-99', 4.5, 'fred')")
    dst.execute("INSERT INTO desk_series VALUES ('JPY=X', '2010-02-30', 110.0, 'yfinance')")
    dst.commit()
    dst.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    assert not any(name.startswith("desk") for name in w.current.errors), w.current.errors

    tc = TestClient(app, raise_server_exceptions=False)
    assets = tc.get("/api/desk/event-study/assets")
    assert assets.status_code == 200, assets.text[:300]
    by = {x["key"]: x for x in assets.json()["shocks"]}
    assert by["us10y"]["status"] == "stored" and by["usdjpy"]["status"] == "stored"

    deadline = time.monotonic() + 60
    while True:
        r = tc.get("/api/desk/event-study", params={"shock": "us10y", "w": 20, "z": 2.0, "sign": "+", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:300]
    p = r.json()["provenance"]
    assert p["malformed_date_excluded"] == {"us10y": 1} and p["exclusions"]["us10y"]["malformed_date"] == 1
    assert any("stored rows with a malformed date set aside on read and excluded: us10y 1" in x for x in p["warnings"]), p["warnings"]

    rep = v.validate(path, None, "full")
    assert "desk:DGS10 (tier 1): 1 malformed date" in rep["failures"], rep["failures"]
    assert any(w_.startswith("desk:JPY=X: 1 malformed date") and "tier 2, reported, never blocking" in w_ for w_ in rep["warnings"]), rep["warnings"]


# ── desk/hardening, verifier round 6: V-26 (a date floor), V-27 (freshness) ─

def _served_copy_with(tmp_path, install_worker, monkeypatch, rows: list[tuple], prepare=None):
    """A worker serving a copy of the scratch store with `rows` added to desk_series
    (after `prepare(conn)`, when given, runs on the copy)."""
    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    import sqlite3

    from api import worker as worker_mod

    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    if prepare is not None:
        prepare(dst)
    dst.executemany("INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, ?, ?, ?)", rows)
    dst.commit()
    dst.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(poll_s=0.05))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    desk_mod.clear_cache()
    return w, path


def test_a_date_before_the_floor_is_set_aside_on_read_and_never_500s_the_desk(tmp_path, install_worker, monkeypatch):
    """Verifier V-26: a well-formed, real, but far-past date ('0000-01-01',
    '1000-01-01') passed V-22's checks, then the engine raised building its
    calendar (strftime out of range; a nonexistent time under DST rules), and
    the assets list and every free-form study answered 500. Dates before
    1900-01-01 (the registry's earliest declared start is 1962) are now
    malformed: set aside on read, counted, warned and hashed like V-22, and
    validate_db fails them for tier 1."""
    from scripts import validate_db as v

    w, path = _served_copy_with(tmp_path, install_worker, monkeypatch,
                                [("DGS10", "0000-01-01", 4.0, "fred"), ("DGS10", "1000-01-01", 4.0, "fred")])
    assert not any(name.startswith("desk") for name in w.current.errors), w.current.errors
    tc = TestClient(app, raise_server_exceptions=False)
    assert tc.get("/api/desk/event-study/assets").status_code == 200
    deadline = time.monotonic() + 60
    while True:
        r = tc.get("/api/desk/event-study", params={"shock": "us10y", "w": 20, "z": 2.0, "sign": "+", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:300]
    p = r.json()["provenance"]
    assert p["malformed_date_excluded"] == {"us10y": 2}
    assert any("stored rows with a malformed date set aside on read and excluded: us10y 2" in x for x in p["warnings"]), p["warnings"]
    rep = v.validate(path, None, "full")
    assert rep["verdict"] == "fail" and "desk:DGS10 (tier 1): 2 malformed dates" in rep["failures"], rep["failures"]


def test_the_date_floor_is_one_value_below_every_declared_start():
    """V-26: the engine's floor and the one freshness and validate_db read are the
    same date, and no series the registry declares starts before it."""
    from api import freshness as freshness_mod
    from scripts import validate_db as v

    assert es.DATE_FLOOR == freshness_mod.DESK_DATE_FLOOR == "1900-01-01"
    # Codex round 4: one constant, defined once and imported by the engine and validate_db
    assert es.DATE_FLOOR is freshness_mod.DESK_DATE_FLOOR
    for module in ("src/desk/event_study.py", "scripts/validate_db.py"):
        assert '"1900-01-01"' not in (ROOT / module).read_text(), f"{module} defines its own floor"
    assert freshness_mod.DESK_DATE_FLOOR in v.MALFORMED_DATE and es.DATE_FLOOR in es.ISO_DATE
    assert min(s.history_from for s in es.registry.SERIES) >= es.DATE_FLOOR


def test_a_junk_date_that_sorts_last_never_makes_a_series_read_not_stored(tmp_path, install_worker, monkeypatch):
    """Verifier V-27: freshness read the raw MAX(date), so a malformed date that
    sorts after the newest real one ('2026-09-21x') made the 10-year Treasury
    read "not stored yet" in the inventory and turned the drawer's tier-1
    verdict stale. Freshness now reads the newest date that survives the
    reader's checks, in the API and in validate_db alike."""
    import sqlite3

    from scripts import validate_db as v

    c = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True) if SCRATCH.exists() else None
    if c is None:
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    newest = c.execute("SELECT MAX(date) FROM desk_series WHERE series_id = 'DGS10'").fetchone()[0]
    c.close()
    w, path = _served_copy_with(tmp_path, install_worker, monkeypatch, [("DGS10", newest + "x", 4.0, "fred")])
    inv = {s["id"]: s for s in client.get("/api/desk/pipeline/inventory").json()["series"]}
    row = inv["desk:DGS10"]
    assert row["as_of"] == newest and row["state"] != "unknown" and "not stored yet" not in row["reason"], row
    assert db.freshness()["desk_series_latest"]["DGS10"] == newest
    assert v.inspect(path)["fresh"]["desk_series_latest"]["DGS10"] == newest


# ── desk/hardening, Codex round 4: R-12, exclusions in each asset's coverage ─

def test_each_assets_row_names_what_the_reader_left_out(tmp_path, install_worker, monkeypatch):
    """Codex R-12: the reader's exclusions reached a study's provenance but not
    the assets list, so the page's asset picker showed a series as cleanly
    stored while rows of it were being set aside. Each asset row now carries
    the counts and the warnings, here DGS10's four faults (a non-numeric
    value, a malformed date, a date before the floor, a date after the as-of)."""
    from tests.desk_vix import add_vix_close

    w, _ = _served_copy_with(tmp_path, install_worker, monkeypatch, [
        ("DGS10", "2010-06-05", "n/a", "fred"), ("DGS10", "1999-99-99", 4.0, "fred"),
        ("DGS10", "1000-01-01", 4.0, "fred"), ("DGS10", "2099-12-31", 4.0, "fred"),
    ], prepare=add_vix_close)
    r = client.get("/api/desk/event-study/assets")
    assert r.status_code == 200, r.text[:300]
    us10y = next(x for x in r.json()["shocks"] if x["key"] == "us10y")
    assert us10y["status"] == "stored"
    assert us10y["exclusions"] == {"future": 1, "non_numeric": 1, "malformed_date": 2, "no_provenance": 0}, us10y["exclusions"]
    text = " ".join(us10y["warnings"])
    # Codex R-18: the effective cutoff for the row: the as-of, or the New York date of the run that committed
    # it when earlier. The file predates provenance, so the staged copy back-fills it with the pre-provenance
    # run, dated when the copy was staged
    effective = min(w.current.as_of, _run_as_of(w, "pre-provenance"))
    assert f"1 stored row dated after {effective} excluded" in text, us10y["warnings"]
    assert "1 non-numeric stored value quarantined on read" in text and "2 stored rows with a malformed date set aside on read" in text
    clean = next(x for x in r.json()["shocks"] if x["key"] == "vix")
    assert clean["exclusions"] == {"future": 0, "non_numeric": 0, "malformed_date": 0, "no_provenance": 0} and clean["warnings"] == []


def _run_as_of(w, run_id: str) -> str:
    """The New York date of one run in the served generation's copy."""
    import sqlite3

    c = sqlite3.connect(w.current.uri, uri=True)
    try:
        return c.execute("SELECT as_of FROM desk_series_runs WHERE run_id = ?", (run_id,)).fetchone()[0]
    finally:
        c.close()


def test_an_assets_row_names_its_refresh_date_when_the_generation_is_staged_after_it(tmp_path, install_worker, monkeypatch):
    """Codex R-18: a generation staged after the New York date of the refresh
    that committed a row. The store migrated this file on 2026-09-23 and a run
    that day committed a DGS10 row dated 2026-09-24 (stored as served, V-15);
    today's generation is staged later, so the row is not after the as-of but
    is after its refresh's day: the row says 2026-09-23, not the as-of."""
    from api import provenance

    def migrated_on_the_23rd(conn):
        day = datetime(2026, 9, 23, 22, 0, tzinfo=timezone.utc)
        provenance.migrate(conn, day)
        run_id, run_as_of = provenance.start_run(conn, day)
        assert run_as_of == "2026-09-23"
        conn.execute("INSERT INTO desk_series (series_id, date, value, provider, run_id, ingested_at) VALUES "
                     "('DGS10', '2026-09-24', 4.0, 'fred', ?, '2026-09-23T22:00:00Z')", (run_id,))
        provenance.mark_committed(conn, run_id, day)

    w, _ = _served_copy_with(tmp_path, install_worker, monkeypatch, [], prepare=migrated_on_the_23rd)
    assert w.current.as_of > "2026-09-23", "the generation is staged after the row's refresh"
    us10y = next(x for x in client.get("/api/desk/event-study/assets").json()["shocks"] if x["key"] == "us10y")
    assert us10y["exclusions"]["future"] == 1 and us10y["last"] < "2026-09-24", us10y
    assert us10y["warnings"] == ["1 stored row dated after 2026-09-23, the New York date of the refresh that stored it, excluded"], us10y["warnings"]
    assert _run_as_of(w, "pre-provenance") == "2026-09-23", "the file's own migration, not the staging, dated the back-fill"


# ── desk/hardening, Codex round 8: R-27, a schema check that cannot run is an error ──

def test_a_study_whose_provenance_check_cannot_run_is_an_error(served, monkeypatch):
    """Codex R-27: when whether the store carries provenance cannot be read, the
    study never reads the store without it: the API answers 503 with
    status "error" and the reason, and so does the assets list."""
    from api import provenance

    def cannot_read(conn):
        raise provenance.SchemaCheckFailed("could not read whether desk_series carries provenance (OperationalError: database "
                                           "schema is locked: main) after 4 tries over 1 s")

    monkeypatch.setattr(provenance, "is_migrated", cannot_read)
    desk_mod.clear_cache()
    deadline = time.monotonic() + 60
    while True:
        r = client.get("/api/desk/event-study", params={"shock": "us10y", "w": 5, "z": 2.0, "sign": "both", "target": "spx", "seed": 7})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 503, r.text[:300]
    body = r.json()
    assert body["status"] == "error" and "could not read whether desk_series carries provenance" in body["reason"], body
    assert body["detail"] == body["reason"], "the web client reads `detail` (verifier V-50)"


# ── desk/hardening, verifier round 16: V-47, freshness fails closed with a structured 503 ──

def test_freshness_and_the_inventory_fail_closed_when_the_provenance_check_cannot_run(served, monkeypatch):
    """Verifier V-47: api/db._freshness_uncached reads whether the store carries
    provenance, and a SchemaCheckFailed there was a bare 500 on /api/freshness and
    the pipeline inventory. Both now answer the studies' structured 503, the
    message in `detail` and `reason` (V-50)."""
    from api import provenance

    def cannot_read(conn):
        raise provenance.SchemaCheckFailed("could not read whether desk_series carries provenance (OperationalError: database "
                                           "schema is locked: main) after 4 tries")

    monkeypatch.setattr(provenance, "is_migrated", cannot_read)
    db._freshness_memo.clear()
    for path in ("/api/freshness", "/api/desk/pipeline/inventory"):
        r = client.get(path)
        assert r.status_code == 503, (path, r.status_code, r.text[:300])
        body = r.json()
        assert body["status"] == "error" and body["kind"] == "schema_check" and body["retryable"] is True, (path, body)
        assert body["detail"] == body["reason"] and "could not read whether desk_series carries provenance" in body["detail"], body
    db._freshness_memo.clear()


# ── desk/hardening, verifier round 17: V-51, a collection inside a SQLite call ──

_V51_SWEEP = r'''
import faulthandler, gc, json, os, sqlite3, sys, threading, time

HANG_S = 60


def main():
    root, scratch = sys.argv[1], sys.argv[2]
    sys.path.insert(0, root)
    from pathlib import Path

    from fastapi.testclient import TestClient

    from api import db, provenance
    from api import worker as worker_mod
    from api.main import app
    from src.analytics import dbpath

    db.DB_PATH = Path(scratch)
    w = worker_mod.AnalyticsWorker(poll_s=0.05)
    worker_mod._worker = w
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    gen = dbpath.generation_for(db.DB_PATH)
    client = TestClient(app, raise_server_exceptions=False)

    def cannot_read(conn):
        raise provenance.SchemaCheckFailed("could not read whether desk_series carries provenance (OperationalError: "
                                           "database schema is locked: main) after 4 tries")

    provenance.is_migrated = cannot_read

    def bounded(fn, what, timeout=30):
        box = {}

        def run():
            try:
                box["value"] = fn()
            except BaseException as exc:
                box["error"] = repr(exc)

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            print("RESULT " + json.dumps({"hung": what}), flush=True)
            faulthandler.dump_traceback(all_threads=True)
            os._exit(3)
        if "error" in box:
            raise RuntimeError(what + ": " + box["error"])
        return box.get("value")

    def leave_exited_threads(n=4):
        """Threads that read the copy through api/db and exit, as anyio prunes an idle worker."""
        def read():
            db._connect().execute("SELECT COUNT(*) FROM regimes").fetchone()
        for _ in range(n):
            t = threading.Thread(target=read)
            t.start()
            t.join()

    # Python that SQLite runs inside one of its calls runs a full collection there,
    # as the collector may at any allocation; automatic collection is off, so the
    # objects an exited thread left stay garbage until one of these passes.
    depth, fired = threading.local(), []

    def is_sqlite(arg):
        return isinstance(getattr(arg, "__self__", None), (sqlite3.Connection, sqlite3.Cursor))

    def profile(frame, event, arg):
        if event == "c_call" and is_sqlite(arg):
            depth.n = getattr(depth, "n", 0) + 1
        elif event in ("c_return", "c_exception") and is_sqlite(arg):
            depth.n = getattr(depth, "n", 1) - 1
        elif event == "call" and getattr(depth, "n", 0) > 0:
            fired.append(frame.f_code.co_name)
            gc.collect()

    # A hang can hold the interpreter, so the bound is faulthandler's own thread:
    # past it the process prints every thread's stack and exits.
    faulthandler.dump_traceback_later(HANG_S, exit=True)
    gc.disable()
    t0 = time.monotonic()
    statuses, kinds = [], []
    for i in range(3):
        leave_exited_threads()
        db._freshness_memo.clear()
        threading.setprofile_all_threads(profile)
        r = bounded(lambda: client.get("/api/freshness"), f"GET /api/freshness, request {i + 1}")
        threading.setprofile_all_threads(None)
        statuses.append(r.status_code)
        kinds.append(r.json().get("kind"))
        if i == 0:
            gc.collect()  # mid-sweep, from the sweep's own thread, outside any SQLite call
    sweep_s = time.monotonic() - t0

    # a collection inside a SQLite call on the copy (the verifier's standalone repro)
    leave_exited_threads()
    threading.setprofile_all_threads(profile)

    def collect_inside_sqlite():
        conn = dbpath.open_generation(gen)
        try:
            first = []

            def authorizer(*args):
                if not first:
                    first.append(1)
                    gc.collect()
                return sqlite3.SQLITE_OK

            conn.set_authorizer(authorizer)
            return conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0]
        finally:
            conn.close()

    rows = bounded(collect_inside_sqlite, "a collection inside a SQLite call on the copy")
    threading.setprofile_all_threads(None)
    gc.collect()

    def fresh_reader():  # a new thread, a new connection: no thread may still hold the copy's lock
        return db._connect().execute("SELECT COUNT(*) FROM desk_series").fetchone()[0]

    fresh = bounded(fresh_reader, "a fresh reader after the collections", timeout=10)
    faulthandler.cancel_dump_traceback_later()
    print("RESULT " + json.dumps({"statuses": statuses, "kinds": kinds, "sweep_s": round(sweep_s, 2), "rows": rows,
                                  "fresh": fresh, "fired": sorted(set(fired))}), flush=True)
    w.stop()
    os._exit(0)


if __name__ == "__main__":
    main()
'''


def test_the_route_sweep_answers_while_collections_run_inside_sqlite_calls(tmp_path):
    """Verifier V-51: SQLite ran the copy connection's Python authorizer inside the
    copy's shared-cache lock, and a collection there that closed a connection an
    exited thread had left for the collector needed the same lock: the reader
    waited for good, and every reader of the copy after it. The sweep runs in its
    own process so that a hang is a bounded failure: /api/freshness with the
    schema check failing, three times, each after threads that read the copy have
    exited, with a collection wherever Python runs inside a SQLite call and one
    mid-sweep; then a collection inside a SQLite call on the copy, then a fresh
    reader. On the staged code the first request hung."""
    import json

    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    script = tmp_path / "v51_sweep.py"
    script.write_text(_V51_SWEEP)
    env = {**os.environ, "EODHD_PROBE_ON_START": "0", "ASSISTANT_ACCESS": "off"}
    try:
        proc = subprocess.run([sys.executable, str(script), str(ROOT), str(SCRATCH)], capture_output=True, text=True,
                              timeout=300, env=env, cwd=ROOT)
    except subprocess.TimeoutExpired as exc:
        pytest.fail(f"the sweep did not finish in 300 s: {(exc.stdout or '')[-2000:]}")
    assert "Timeout (" not in proc.stderr, "hung past 60 s:\n" + proc.stderr[proc.stderr.find("Timeout ("):][:6000]
    lines = [line for line in proc.stdout.splitlines() if line.startswith("RESULT ")]
    assert lines, (proc.returncode, proc.stdout[-2000:], proc.stderr[-4000:])
    res = json.loads(lines[-1][len("RESULT "):])
    assert "hung" not in res, (res, proc.stderr[-6000:])
    assert res["statuses"] == [503, 503, 503] and res["kinds"] == ["schema_check"] * 3, res
    assert res["sweep_s"] < 60, res
    assert res["rows"] > 0 and res["fresh"] > 0, res
    assert proc.returncode == 0, (proc.returncode, proc.stderr[-2000:])


def test_a_thread_closes_its_copy_connection_when_it_exits(served, monkeypatch):
    """Verifier V-51: an exited thread's connection is closed by that thread as it
    exits, never left for the collector. Collection is off, so only the thread's
    exit can close it; on the staged code nothing did."""
    import gc
    import threading

    closed, used = [], []
    real = db._ReusedConnection.really_close

    def spy(self):
        closed.append(threading.get_ident())
        real(self)

    monkeypatch.setattr(db._ReusedConnection, "really_close", spy)

    def read():
        used.append(threading.get_ident())
        assert db._connect().execute("SELECT COUNT(*) FROM regimes").fetchone()[0] > 0

    was = gc.isenabled()
    gc.disable()
    try:
        t = threading.Thread(target=read)
        t.start()
        t.join()
    finally:
        if was:
            gc.enable()
    assert closed == used, (closed, used)


def test_a_copy_connection_is_read_only_by_its_own_mode_with_no_python_callback(served):
    """Verifier V-51: no Python runs inside SQLite's calls on a copy connection, so
    the copy is read-only by the connection's own mode: query_only refuses every
    write, temp tables and VACUUM INTO included, and a zero attach limit refuses
    ATTACH. On the staged code open_generation installed a Python authorizer."""
    import sqlite3

    from src.analytics import dbpath

    installed: list[str] = []

    class Spy(sqlite3.Connection):
        def set_authorizer(self, *a, **k):
            installed.append("set_authorizer")
            return super().set_authorizer(*a, **k)

        def set_progress_handler(self, *a, **k):
            installed.append("set_progress_handler")
            return super().set_progress_handler(*a, **k)

        def set_trace_callback(self, *a, **k):
            installed.append("set_trace_callback")
            return super().set_trace_callback(*a, **k)

        def create_function(self, *a, **k):
            installed.append("create_function")
            return super().create_function(*a, **k)

    conn = dbpath.open_generation(dbpath.generation_for(db.DB_PATH), factory=Spy)
    assert conn is not None
    try:
        assert installed == []
        assert conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0] > 0
        for sql in ("DELETE FROM regimes", "CREATE TEMP TABLE t (x)", "ATTACH ':memory:' AS m", "VACUUM INTO ':memory:'"):
            with pytest.raises(sqlite3.Error):
                conn.execute(sql)
        assert conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0] > 0
    finally:
        conn.close()


# ── desk/hardening, verifier round 17: V-53 and V-52, what a failed Desk schema check takes out ──

def test_a_failed_desk_schema_check_answers_503_only_on_the_desk_routes(served, monkeypatch):
    """Verifier V-53: the freshness report reads whether the Desk's store carries
    provenance, so a check that could not run took out every endpoint with a
    freshness block. Outside the Desk they now serve their own data, the block
    reading {"status": "awaiting", "reason": ...}; /api/freshness, the pipeline
    inventory and a study still answer the structured 503, the reason in
    `detail`, which the Data Pipeline page's client reads (V-52)."""
    from api import provenance

    message = ("could not read whether desk_series carries provenance (OperationalError: database schema is locked: main) "
               "after 4 tries")

    def cannot_read(conn):
        raise provenance.SchemaCheckFailed(message)

    monkeypatch.setattr(provenance, "is_migrated", cannot_read)
    db._freshness_memo.clear()
    desk_mod.clear_cache()
    try:
        own = {"/api/signals/latest": "signals", "/api/credit/oas?days=3650": "series", "/api/credit/metrics": "hy_oas",
               "/api/recession/probability": "probability_source", "/api/lbo/defaults": "lbo_all_in_rate",
               "/api/allocation": "asset_classes"}
        for path, key in own.items():
            db._freshness_memo.clear()
            r = client.get(path)
            assert r.status_code == 200, (path, r.status_code, r.text[:300])
            body = r.json()
            assert body.get(key) is not None, (path, sorted(body))
            assert body["freshness"] == {"status": "awaiting", "reason": body["freshness"]["reason"]}, (path, body["freshness"])
            assert message in body["freshness"]["reason"], (path, body["freshness"])
        for path in ("/api/freshness", "/api/desk/pipeline/inventory"):
            db._freshness_memo.clear()
            r = client.get(path)
            assert r.status_code == 503, (path, r.status_code, r.text[:300])
            body = r.json()
            assert body["kind"] == "schema_check" and body["detail"] == body["reason"] and message in body["detail"], (path, body)
        deadline = time.monotonic() + 60
        while True:
            r = client.get("/api/desk/event-study", params={"shock": "us10y", "w": 5, "z": 2.0, "sign": "both", "target": "spx", "seed": 7})
            if r.status_code != 202 or time.monotonic() > deadline:
                break
            time.sleep(0.5)
        assert r.status_code == 503 and r.json()["kind"] == "schema_check" and message in r.json()["detail"], r.text[:300]
    finally:
        db._freshness_memo.clear()


# ── desk/hardening, verifier round 18: V-54, a failed build leaves no connection to the copy ──

_V54_BUILD = r'''
import faulthandler, gc, json, os, sqlite3, sys, threading


def main():
    root, scratch = sys.argv[1], sys.argv[2]
    sys.path.insert(0, root)
    from pathlib import Path

    from api import db
    from api import worker as worker_mod
    from src.analytics import dbpath, recession

    faulthandler.dump_traceback_later(120, exit=True)  # a hang can hold the interpreter
    gc.disable()  # a connection left for the collector stays until the passes below
    opened: set[int] = set()
    real = recession._get_conn

    class FailsMidway:
        """recession's real connection to the copy, whose reads fail once it is open."""

        def __init__(self, conn):
            self._conn = conn

        def execute(self, *args, **kwargs):
            raise sqlite3.OperationalError("forced failure mid-build")

        def close(self):
            self._conn.close()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    def failing():
        conn = real()
        opened.add(id(conn))
        return FailsMidway(conn)

    recession._get_conn = failing
    db.DB_PATH = Path(scratch)
    w = worker_mod.AnalyticsWorker(poll_s=0.05)
    worker_mod._worker = w
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    served = dbpath.generation_for(db.DB_PATH)
    # the build returns before the curve shape once its features fail; read it on the served copy too
    assert recession._load_curve_shape() == {}

    def is_open(conn):
        try:
            conn.in_transaction
            return True
        except sqlite3.ProgrammingError:
            return False

    left_open = sum(1 for o in gc.get_objects() if isinstance(o, sqlite3.Connection) and id(o) in opened and is_open(o))

    def bounded(fn, what, timeout=30):
        box = {}

        def run():
            try:
                box["value"] = fn()
            except BaseException as exc:
                box["error"] = repr(exc)

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            print("RESULT " + json.dumps({"hung": what, "opened": len(opened), "left_open": left_open}), flush=True)
            faulthandler.dump_traceback(all_threads=True)
            os._exit(3)
        if "error" in box:
            raise RuntimeError(what + ": " + box["error"])
        return box.get("value")

    def collect_inside_sqlite():
        conn = dbpath.open_generation(served)
        try:
            first = []

            def authorizer(*args):
                if not first:
                    first.append(1)
                    gc.collect()
                return sqlite3.SQLITE_OK

            conn.set_authorizer(authorizer)
            return conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0]
        finally:
            conn.close()

    rows = bounded(collect_inside_sqlite, "a collection inside a SQLite call on the served copy")
    gc.collect()

    def fresh_reader():  # a new thread, a new connection
        return db._connect().execute("SELECT COUNT(*) FROM regimes").fetchone()[0]

    fresh = bounded(fresh_reader, "a fresh reader after the collections", timeout=10)
    faulthandler.cancel_dump_traceback_later()
    print("RESULT " + json.dumps({"opened": len(opened), "left_open": left_open, "rows": rows, "fresh": fresh}), flush=True)
    w.stop()
    os._exit(0)


if __name__ == "__main__":
    main()
'''


def test_a_build_that_fails_midway_leaves_no_connection_to_the_copy(tmp_path):
    """Verifier V-54: recession.py closed its connection only when the build
    succeeded, so a failure left the worker's connection to the copy for the
    collector, and a collection inside a SQLite call on that copy (the query
    tool's progress handler is one) then waited for good. In its own process, so
    a hang is a bounded failure: every recession read fails once its connection
    is open, with automatic collection off, the curve shape read on the served
    copy as well; after that none of those connections is open, a collection inside a SQLite call on the served copy
    and one outside it both complete, and a fresh reader reads."""
    import json

    if not SCRATCH.exists():
        pytest.skip("populate data/desk_scratch.db for the Desk API tests")
    script = tmp_path / "v54_build.py"
    script.write_text(_V54_BUILD)
    env = {**os.environ, "EODHD_PROBE_ON_START": "0", "ASSISTANT_ACCESS": "off"}
    try:
        proc = subprocess.run([sys.executable, str(script), str(ROOT), str(SCRATCH)], capture_output=True, text=True,
                              timeout=300, env=env, cwd=ROOT)
    except subprocess.TimeoutExpired as exc:
        pytest.fail(f"the build did not finish in 300 s: {(exc.stdout or '')[-2000:]}")
    assert "Timeout (" not in proc.stderr, "hung past 120 s:\n" + proc.stderr[proc.stderr.find("Timeout ("):][:6000]
    lines = [line for line in proc.stdout.splitlines() if line.startswith("RESULT ")]
    assert lines, (proc.returncode, proc.stdout[-2000:], proc.stderr[-4000:])
    res = json.loads(lines[-1][len("RESULT "):])
    assert "hung" not in res, (res, proc.stderr[-6000:])
    assert res["opened"] >= 3 and res["left_open"] == 0, res
    assert res["rows"] > 0 and res["fresh"] > 0, res
    assert proc.returncode == 0, (proc.returncode, proc.stderr[-2000:])


def test_every_builder_closes_its_connection_on_every_path():
    """Verifier V-54, for every builder: a connection a module opens to read the
    store is closed in a `finally`, never only after the reads succeed, and never
    by a connection's own `with`, which ends a transaction and does not close.
    Codex R-33, for every factory (`_get_conn`, `_connect`) that runs setup on a
    connection before handing it over: a failed setup closes the connection
    before the error propagates. The assistant's ledger is included, and
    (verifier V-64) the refresh's factories in src/utils, src/market_data and
    src/events, whose builders this test does not judge."""
    import ast

    openers = {"_get_conn", "connect_ro", "open_generation", "_connect", "get_connection"}
    factories = {"_get_conn", "_connect", "get_connection"}
    files = (sorted((ROOT / "src" / "analytics").glob("*.py")) + sorted((ROOT / "src" / "desk").glob("*.py"))
             + [ROOT / "api" / "desk.py", ROOT / "api" / "assistant_budget.py"]
             # desk/frame-3-api (plan §5) and desk/frame-3-api-b2a: the Desk v2 builders, routers and bootstrap
             + [ROOT / "api" / "desk_items.py", ROOT / "api" / "desk_v2.py", ROOT / "api" / "desk_items_macro.py",
                ROOT / "api" / "desk_v2_macro.py", ROOT / "api" / "desk_pipeline.py", ROOT / "api" / "bootstrap.py"])
    factory_only = [f for d in ("utils", "market_data", "events") for f in sorted((ROOT / "src" / d).glob("*.py"))]
    unclosed, withs, setups = [], [], []

    def name_of(call) -> str | None:
        f = call.func
        return f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)

    def opener(call) -> bool:
        return name_of(call) in openers

    for path in files + factory_only:
        tree = ast.parse(path.read_text())
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or fn.name in openers - factories:
                continue  # dbpath's openers hand their connection to the caller
            if path in factory_only and fn.name not in factories:
                continue
            where = f"{path.relative_to(ROOT)}:{fn.lineno} {fn.name}"
            if fn.name in factories:
                # R-33: a call on the new connection before it is returned must sit in a try whose
                # handler closes the connection and re-raises
                for i, stmt in enumerate(fn.body):
                    if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call) and (
                            opener(stmt.value) or name_of(stmt.value) == "connect"):
                        var = stmt.targets[0].id
                        setup = [x for x in fn.body[i + 1:] if not (isinstance(x, ast.Return))]
                        calls = any(isinstance(n, ast.Call) for x in setup for n in ast.walk(x))
                        guarded = any(isinstance(x, ast.Try) and any(
                            f"{var}.close()" in ast.unparse(h) and any(isinstance(n, ast.Raise) for n in ast.walk(h))
                            for h in x.handlers) for x in setup)
                        if calls and not guarded:
                            setups.append(where)
                continue
            closes = {ast.unparse(n) for t in ast.walk(fn) if isinstance(t, ast.Try) for f in t.finalbody for n in ast.walk(f)}
            for node in ast.walk(fn):
                if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and opener(node.value):
                    var = node.targets[0].id
                    if f"{var}.close()" not in closes:
                        unclosed.append(where)
                if isinstance(node, ast.withitem) and isinstance(node.context_expr, ast.Call) and opener(node.context_expr):
                    withs.append(where)
    assert unclosed == [] and withs == [] and setups == [], {
        "closed only on success": unclosed, "a connection's own with": withs, "left open when its setup fails": setups}


class _ConnectProxy:
    """A module's `sqlite3` with `connect` replaced, everything else the real module."""

    def __init__(self, connect):
        import sqlite3

        self._real, self.connect = sqlite3, connect

    def __getattr__(self, name):
        return getattr(self._real, name)


FACTORIES = {"api.assistant_budget": "_connect", "src.analytics.alerts": "_get_conn", "src.analytics.backtest": "_get_conn",
             "src.analytics.playbook": "_get_conn", "src.analytics.priced": "_get_conn", "src.analytics.surprise": "_get_conn",
             "src.analytics.volatility": "_get_conn",
             # verifier V-64: the refresh's own factories
             "src.utils.db": "get_connection", "src.market_data.fetch_market": "_get_conn",
             "src.events.load_events": "_get_conn", "src.market_data.backfill_yfinance": "_get_conn"}


@pytest.mark.parametrize("module", sorted(FACTORIES))
def test_a_factory_closes_its_connection_when_its_setup_fails(module, tmp_path, monkeypatch):
    """Codex R-33, with its repro: the ledger's `ensure_ai_spend_ledger` raises
    "database is locked"; each other factory's `PRAGMA journal_mode` is denied.
    The error propagates, and the connection the factory opened is closed; on the
    staged code it still answered `SELECT 1`. Verifier V-64 added the refresh's
    four factories, whose store path is pointed at a scratch file."""
    import importlib
    import sqlite3

    mod = importlib.import_module(module)
    if hasattr(mod, "DB_PATH"):
        scratch = tmp_path / "store.db"
        scratch.touch()
        monkeypatch.setattr(mod, "DB_PATH", scratch)
    opened: list[sqlite3.Connection] = []

    def connect(*args, **kwargs):
        conn = sqlite3.connect(":memory:")  # never the store or the ledger file
        if module != "api.assistant_budget":
            conn.set_authorizer(lambda action, arg1, *rest: sqlite3.SQLITE_DENY
                                if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() == "journal_mode" else sqlite3.SQLITE_OK)
        opened.append(conn)
        return conn

    monkeypatch.setattr(mod, "sqlite3", _ConnectProxy(connect))
    if module == "api.assistant_budget":
        monkeypatch.setattr(mod, "LEDGER_PATH", tmp_path / "ledger" / "assistant_spend.db")

        def locked(conn):
            raise sqlite3.OperationalError("database is locked")

        monkeypatch.setattr(mod, "ensure_ai_spend_ledger", locked)
    with pytest.raises(sqlite3.DatabaseError):
        getattr(mod, FACTORIES[module])()
    assert len(opened) == 1
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        opened[0].execute("SELECT 1")


def test_a_failed_staging_closes_its_copy_and_backs_off_on_any_error(tmp_path, monkeypatch):
    """Verifiers V-64, V-73: the worker's staging closed its in-memory copy only on
    a SQLite error, and only a SQLite error backed off. An error that is not
    SQLite's (a ValueError, a MemoryError from `backup`) left the copy open, then
    re-copied the whole file at every poll with the state stuck at "building".
    Now any staging error closes the copy and backs off: in a real worker loop,
    one attempt in a second at a 50 ms poll, the state "error", the reason named.
    An interpreter exit is not a staging failure: the copy closes and it
    propagates."""
    import sqlite3

    from api import provenance
    from api import worker as worker_mod

    src = tmp_path / "store.db"
    seed = sqlite3.connect(src)
    seed.execute("CREATE TABLE regimes (date TEXT)")
    seed.execute("INSERT INTO regimes VALUES ('2026-09-01')")
    seed.commit()
    seed.close()
    from src.analytics import dbpath

    key = dbpath.file_key(src)  # the file's own key: staging now checks it holds across the copy (R-11)
    anchors: list[sqlite3.Connection] = []

    def connect(*args, **kwargs):
        conn = sqlite3.connect(*args, **kwargs)
        if str(args[0]).startswith("file:mrr-gen-"):
            anchors.append(conn)
        return conn

    monkeypatch.setattr(worker_mod, "sqlite3", _ConnectProxy(connect))
    for exc in (ValueError("forced failure while staging"), MemoryError("backup ran out of memory"),
                sqlite3.OperationalError("database is locked")):
        def broken(conn, now=None, exc=exc):
            raise exc

        monkeypatch.setattr(provenance, "migrate", broken)
        w = worker_mod.AnalyticsWorker(poll_s=0.05)
        before = time.monotonic()
        assert w._stage(src, key) is None
        assert w._failed is not None and w._failed[0] == key and w._failed[2] >= before + 1.5, (exc, w._failed)
        assert w.state == "error" and str(exc) in (w.last_error or ""), (exc, w.state, w.last_error)
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            anchors[-1].execute("SELECT COUNT(*) FROM regimes")

    def exits(conn, now=None):
        raise SystemExit(3)

    monkeypatch.setattr(provenance, "migrate", exits)
    with pytest.raises(SystemExit):
        worker_mod.AnalyticsWorker(poll_s=0.05)._stage(src, key)
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        anchors[-1].execute("SELECT COUNT(*) FROM regimes")

    calls: list[float] = []

    def failing(conn, now=None):
        calls.append(time.monotonic())
        raise ValueError("forced failure while staging")

    monkeypatch.setattr(provenance, "migrate", failing)
    monkeypatch.setattr(db, "DB_PATH", src)
    w = worker_mod.AnalyticsWorker(poll_s=0.05)
    w.start(serving=True)
    try:
        time.sleep(1.0)
        assert len(calls) == 1, f"staged {len(calls)} times in 1 s at a 50 ms poll"
        assert w.state == "error" and "ValueError: forced failure while staging" in (w.last_error or ""), (w.state, w.last_error)
    finally:
        w.stop()


# ── desk/hardening, verifier rounds 20 and 21: V-60, V-61, V-69, the query tool's budget on the copy ──

REGIME_QUESTIONS = {
    # verifier V-69: natural questions joining on a computed month key, which took 0.2 to 1.6 s
    "SPY daily return by regime": (
        "SELECT g.label, COUNT(*) AS days, AVG(x.ret) AS avg_daily FROM (SELECT date, close / LAG(close) OVER (ORDER BY date) - 1 AS ret "
        "FROM market_daily WHERE symbol='SPY') x JOIN regimes g ON strftime('%Y-%m', x.date) = strftime('%Y-%m', g.date) GROUP BY g.label"),
    "every symbol's average daily return by regime": (
        "SELECT g.label, x.symbol, AVG(x.ret) AS avg_daily FROM (SELECT symbol, date, close / LAG(close) OVER (PARTITION BY symbol ORDER BY date) - 1 AS ret "
        "FROM market_daily) x JOIN regimes g ON strftime('%Y-%m', x.date) = strftime('%Y-%m', g.date) GROUP BY g.label, x.symbol ORDER BY g.label, x.symbol"),
    "signal trigger rate by regime": (
        "SELECT g.label, s.signal_name, AVG(s.triggered) AS rate FROM signals s JOIN regimes g ON strftime('%Y-%m', s.date) = strftime('%Y-%m', g.date) "
        "GROUP BY g.label, s.signal_name"),
}


def _rewrite_error(out: dict) -> bool:
    """The interrupt's error: the budget, and how to rewrite (V-69), never a bare interrupt."""
    err = out.get("error", "")
    return (err.startswith("SQL error: the query exceeded the 250 ms budget; simplify it. If it reads many rows:")
            and "date range" in err and "strftime('%Y-%m', a.date)" in err and "regimes.date" in err
            and "strftime('%Y-%m-01', x.date)" in err)


def test_the_query_tool_stops_a_cross_join_within_300_ms_and_explains_how_to_rewrite(served):
    """Verifiers V-60, V-61, V-69: a query on the served copy holds the copy's
    lock while it runs, so the tool's budget is 250 ms, its clock starting when
    the tool call connects, before any setup. A four-way cross join of the regimes
    table stops within 300 ms of the call, alone and four at once (the assistant's
    concurrency ceiling), and answers the rewrite error: the budget, and how to
    rewrite. The natural regime questions the verifier listed either answer or
    return that error, never a bare interrupt, and the ordinary questions answer.
    On the staged code the cross join took 2 s at first, and returned a bare
    interrupt at 100 ms after round 21."""
    import threading

    from src.analytics import chat

    cross = "SELECT COUNT(*) AS n FROM regimes a, regimes b, regimes c, regimes d"

    def timed(sql: str) -> tuple[float, dict]:
        t = time.perf_counter()
        out = chat._tool_query_database(sql)
        return time.perf_counter() - t, out

    elapsed, out = timed(cross)
    assert _rewrite_error(out) and elapsed < 0.300, (elapsed, out)
    results: list[tuple[float, dict]] = []
    threads = [threading.Thread(target=lambda: results.append(timed(cross))) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(results) == 4 and all(_rewrite_error(o) and e < 0.300 for e, o in results), results
    for name, sql in REGIME_QUESTIONS.items():
        _, out = timed(sql)
        assert ("error" not in out and out["row_count"] > 0) or _rewrite_error(out), (name, out)
    for sql in ("SELECT date, label, confidence FROM regimes ORDER BY date DESC LIMIT 12",
                "SELECT series_id, MAX(date) AS latest, COUNT(*) AS n FROM raw_series GROUP BY series_id ORDER BY series_id",
                "SELECT r.date, r.label, s.signal_name, s.value FROM regimes r JOIN signals s ON s.date = r.date "
                "ORDER BY r.date DESC LIMIT 50",
                # the rewrite the error suggests: join on the regimes table's stored month
                "SELECT g.label, COUNT(*) AS days, AVG(x.ret) AS avg_daily FROM (SELECT date, close / LAG(close) OVER (ORDER BY date) - 1 AS ret "
                "FROM market_daily WHERE symbol='SPY') x JOIN regimes g ON g.date = strftime('%Y-%m-01', x.date) GROUP BY g.label"):
        _, out = timed(sql)
        assert "error" not in out and out["row_count"] > 0, (sql, out)


# ── desk/hardening, Codex round 10: R-34, the assistant's SQL on its own private copy ──

def _like(n: int) -> str:
    """Codex's repro: n repetitions of a LIKE a single call of which runs uninterrupted.
    Since verifier V-84 its 8,000-character pattern is past the 256-character cap."""
    one = "(printf('%.*c',16000,'a') LIKE ('%'||printf('%.*c',8000,'a')||'b'))"
    return ", ".join(f"{one} AS l{i}" for i in range(n)) if n <= 8 else " + ".join([one] * n) + " AS s"


def _glob_chain() -> str:
    """The longest single-call hold found under every cap (decision 42, verifier V-88): 2 KB of
    GLOB operators on a 16 KB value with a 256-byte pattern, one row, no jump between them for an
    interrupt to land on; about 1.0 s. The summed trims the R-34 and V-80 tests used before are
    refused by the guard since V-88 (two-argument trim, the 16-call and 2 KB caps)."""
    head = "WITH v(x,p) AS (SELECT printf('%.*c',16000,'a'), '*'||printf('%.*c',254,'a')||'b') SELECT "
    terms: list[str] = []
    while len((head + "+".join(terms + ["(x GLOB p)"]) + " AS s FROM v").encode()) <= 2048:
        terms.append("(x GLOB p)")
    return head + "+".join(terms) + " AS s FROM v"


def test_the_assistants_sql_runs_on_a_private_copy_that_never_stalls_other_readers(served):
    """Codex R-34: SQLite never interrupts inside a function, so a model's query
    of string functions held the served copy's lock for seconds: eight
    repetitions of Codex's printf/LIKE stalled another reader 1.05 s, and 128
    summed, 15.94 s. The assistant's SQL now runs on the generation's private
    copy, built on its first query from the generation's own copy, held by the
    generation and closed with it. The budget, the cap and the guard are
    unchanged. A reader of the shared copy running SELECT COUNT(*) throughout
    stays under 20 ms, the private copy's build included. Since V-84 and V-88
    Codex's LIKEs are refused at once, so the longest hold the caps leave (2 KB
    of GLOB operators, about 1 s) supplies the uninterrupted work."""
    import threading

    from src.analytics import chat, dbpath

    gen = dbpath.generation_for(db.DB_PATH)
    assert gen is not None and getattr(gen, "private_uri", None) is None  # built on the first query, not before
    reader = dbpath.open_generation(gen)
    stop, worst, reads = threading.Event(), [0.0], [0]

    def read():
        conn = dbpath.open_generation(gen)
        try:
            while not stop.is_set():
                t = time.perf_counter()
                conn.execute("SELECT COUNT(*) FROM regimes").fetchone()
                worst[0] = max(worst[0], time.perf_counter() - t)
                reads[0] += 1
                time.sleep(0.002)
        finally:
            conn.close()

    t = threading.Thread(target=read, daemon=True)
    t.start()
    try:
        time.sleep(0.05)
        # Codex's repro: 8 repetitions are refused at once by the pattern cap (V-84), 128 by the guard's 2 KB cap (V-88)
        out = chat._tool_query_database(f"SELECT {_like(8)} FROM regimes LIMIT 1")
        assert "256-byte limit" in out.get("error", ""), {k: v for k, v in out.items() if k != "rows"}
        out = chat._tool_query_database(f"SELECT {_like(128)} FROM regimes LIMIT 1")
        assert out.get("error", "").startswith("SQL guard: a query is limited to 2 KB of SQL"), out
        started = time.perf_counter()
        long = chat._tool_query_database(_glob_chain())  # the longest hold left under every cap
        long_s = time.perf_counter() - started
        assert "budget; simplify it" in long.get("error", ""), long
        # verifier V-90: the long call must really run long. The longest query the caps leave runs about
        # 1.0 s (0.98 to 1.04 s measured), so the bound is twice the budget, not the 1 s V-90 suggested.
        assert long_s > 0.5, long_s
        assert chat._tool_query_database("SELECT COUNT(*) AS n FROM regimes")["rows"] == [
            {"n": reader.execute("SELECT COUNT(*) FROM regimes").fetchone()[0]}]  # the same generation's data
    finally:
        stop.set()
        t.join(10)
        reader.close()
    assert reads[0] > 20 and worst[0] < 0.020, f"the shared copy's reader waited {worst[0] * 1000:.1f} ms"
    assert gen.private_uri is not None and gen.private_uri != gen.uri and gen.private_anchor is not None


def test_a_generation_closes_its_private_copy_when_it_retires(tmp_path):
    """Codex R-34: the private copy lives and dies with its generation: built
    lazily, from the generation's own copy (the provenance migration included),
    and closed at retirement, after which the generation has none to give."""
    import sqlite3

    from api import worker as worker_mod
    from src.analytics import dbpath

    src = tmp_path / "store.db"
    seed = sqlite3.connect(src)
    seed.execute("CREATE TABLE regimes (date TEXT)")
    seed.executemany("INSERT INTO regimes VALUES (?)", [("2026-08-01",), ("2026-09-01",)])
    seed.commit()
    seed.close()
    gen = worker_mod.AnalyticsWorker(poll_s=0.05)._stage(src, dbpath.file_key(src))
    assert gen is not None and gen.private_uri is None
    ref = gen.private()
    assert ref is not None and ref.uri == gen.private_uri and ref.key == gen.key and ref.as_of == gen.as_of
    conn = dbpath.open_generation(ref)
    assert conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0] == 2
    conn.close()
    assert gen.private() is ref or gen.private().uri == ref.uri  # built once
    anchor = gen.private_anchor
    gen.close()
    assert gen.private_anchor is None and gen.private_uri is None and gen.private() is None
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        anchor.execute("SELECT 1")


# ── desk/hardening, Codex round 10: R-11, R-35, R-36, R-37, staging and the generation factory ──

def _one_table_store(path, rows=1):
    import sqlite3

    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE regimes (date TEXT)")
    conn.executemany("INSERT INTO regimes VALUES (?)", [(f"2026-{m:02d}-01",) for m in range(1, rows + 1)])
    conn.commit()
    conn.close()


def test_a_file_that_moves_during_its_copy_is_never_published_under_the_old_key(tmp_path, monkeypatch):
    """R-11 (the API plan's review): every build, not only a rebuild, needs the
    file's key to hold across the copy. The interleaving: the poll samples the
    key, a refresh commits, then the backup copies the new file, which the
    staged code published under the old key. Now the copy is discarded with no
    backoff, and the next poll publishes the new file under its own key."""
    import sqlite3

    from api import worker as worker_mod
    from src.analytics import dbpath

    src = tmp_path / "store.db"
    _one_table_store(src)
    commit_first = [True]

    def connect(*args, **kwargs):
        if commit_first[0] and str(args[0]).startswith(f"file:{src}"):
            commit_first[0] = False
            writer = sqlite3.connect(src)  # the refresh commits between the key's sampling and the backup
            writer.execute("INSERT INTO regimes VALUES ('2026-12-01')")
            writer.commit()
            writer.close()
        return sqlite3.connect(*args, **kwargs)

    monkeypatch.setattr(worker_mod, "sqlite3", _ConnectProxy(connect))
    monkeypatch.setattr(db, "DB_PATH", src)
    w = worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False)
    try:
        sampled = dbpath.file_key(src)
        w._maybe_build()
        assert w._current is None and w.snapshots_moved == 1 and w._failed is None and w.state == "idle"
        assert dbpath.file_key(src) != sampled
        w._maybe_build()
        gen = w._current
        assert gen is not None and gen.key == dbpath.file_key(src)
        conn = dbpath.open_generation(gen)
        assert conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0] == 2  # the new file, under its own key
        conn.close()
    finally:
        w.stop()


def test_a_staging_connection_that_cannot_open_backs_off(tmp_path, monkeypatch):
    """Codex R-35: the copy's own connection was opened outside the staging
    error handler, so a failure to open it skipped the backoff: six attempts in
    350 ms at a 50 ms poll, `_failed` None, the state stuck at "building". Now it
    backs off like any staging error."""
    import sqlite3

    from api import worker as worker_mod

    src = tmp_path / "store.db"
    _one_table_store(src)
    attempts: list[float] = []

    def connect(*args, **kwargs):
        if str(args[0]).startswith("file:mrr-gen-"):
            attempts.append(time.monotonic())
            raise sqlite3.OperationalError("unable to open database file")
        return sqlite3.connect(*args, **kwargs)

    monkeypatch.setattr(worker_mod, "sqlite3", _ConnectProxy(connect))
    monkeypatch.setattr(db, "DB_PATH", src)
    w = worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False)
    w.start(serving=True)
    try:
        time.sleep(0.5)
        assert len(attempts) == 1, f"{len(attempts)} attempts in 0.5 s"
        assert w._failed is not None and w.state == "error" and "unable to open database file" in (w.last_error or "")
    finally:
        w.stop()


def test_the_staging_backoff_never_overflows(tmp_path, monkeypatch):
    """Codex R-37: after 1,023 failed attempts, 2.0 ** 1024 raised OverflowError and
    left the expired retry state as it was, so retries fell back to every poll.
    The exponent is clamped; the delay stays at the cap."""
    import sqlite3

    from api import provenance
    from api import worker as worker_mod
    from src.analytics import dbpath

    src = tmp_path / "store.db"
    _one_table_store(src)
    key = dbpath.file_key(src)

    def broken(conn, now=None):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(provenance, "migrate", broken)
    w = worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False)
    w._failed = (key, 1023, 0.0)
    before = time.monotonic()
    assert w._stage(src, key) is None
    assert w._failed[0] == key and w._failed[1] == 1024
    assert before + worker_mod.STAGE_RETRY_MAX_S - 1 <= w._failed[2] <= time.monotonic() + worker_mod.STAGE_RETRY_MAX_S


def test_open_generation_closes_its_connection_on_any_setup_error(tmp_path):
    """Codex R-36: the generation factory closed its connection only on a SQLite
    error; a MemoryError on the setup pragma left it open, still reading the
    generation. Now it is closed and the error propagates."""
    import sqlite3

    from src.analytics import dbpath

    src = tmp_path / "store.db"
    _one_table_store(src)
    uri = "file:mrr-gen-test-r36?mode=memory&cache=shared"
    anchor = sqlite3.connect(uri, uri=True)
    seed = sqlite3.connect(src)
    seed.backup(anchor)
    seed.close()

    class _Gen:
        source = src
        key = (0, 0, 0)

    _Gen.uri = uri
    opened: list[sqlite3.Connection] = []

    class Failing(sqlite3.Connection):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            opened.append(self)

        def execute(self, sql, *a, **k):
            if sql.startswith("PRAGMA query_only"):
                raise MemoryError("forced")
            return super().execute(sql, *a, **k)

    try:
        with pytest.raises(MemoryError):
            dbpath.open_generation(_Gen, factory=Failing)
        assert len(opened) == 1
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            sqlite3.Connection.execute(opened[0], "SELECT COUNT(*) FROM regimes")
    finally:
        anchor.close()


# ── desk/hardening, verifier round 23: V-80, a private copy per assistant tool call ──

def test_a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms(served, monkeypatch):
    """Verifier V-80: one private copy per generation was shared by every
    visitor's assistant, so Codex's 128 summed LIKEs (about 17 s, uninterrupted
    inside its functions) made another visitor's fixed-SQL tool call wait 17 s.
    Since the guard's caps (V-84, V-88), the long query is the longest hold they
    leave: 2 KB of GLOB operators, about 1 s.
    Each tool call now reads a copy of its own, made from the generation's
    private copy and closed in a finally: while the long query runs, another
    visitor's fixed-SQL calls and a query of theirs each answer under 20 ms, and
    every copy is closed afterwards."""
    import sqlite3
    import threading

    from src.analytics import chat, dbpath

    copies: list[sqlite3.Connection] = []
    real = getattr(dbpath, "copy_private_ro", None)  # absent on the staged code, which fails on the timings instead

    def tracked(path):
        conn = real(path)
        copies.append(conn)
        return conn

    if real is not None:
        monkeypatch.setattr(dbpath, "copy_private_ro", tracked)
    chat._tool_get_current_regime()  # the generation's private copy exists before the clock starts
    done = threading.Event()

    def long_query():
        try:
            chat._tool_query_database(_glob_chain())  # the longest hold the caps leave, about 1 s (decision 42)
        finally:
            done.set()

    t = threading.Thread(target=long_query, daemon=True)
    t0 = time.perf_counter()
    t.start()
    time.sleep(0.05)
    timings = []
    for _ in range(5):
        for call in (chat._tool_get_current_regime, lambda: chat._tool_query_database("SELECT COUNT(*) AS n FROM regimes")):
            s = time.perf_counter()
            out = call()
            timings.append(time.perf_counter() - s)
            assert "error" not in out, out
        time.sleep(0.05)
    ended_early = done.is_set()
    t.join(60)
    long_s = time.perf_counter() - t0
    assert max(timings) < 0.020, f"another visitor's call took {max(timings) * 1000:.1f} ms while the long query ran {long_s:.1f} s"
    assert not ended_early and long_s > 0.5, "the long query ended before the other visitor's calls: nothing was measured"
    assert len(copies) == 12  # one per call: the warm-up, the long query and the ten measured
    for conn in copies:  # made on other threads too: in_transaction checks the connection, not the thread
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            conn.in_transaction
