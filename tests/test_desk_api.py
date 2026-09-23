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

REFRESH_IDS = ["DGS10", "DGS2", "T10Y2Y", "VIXCLS", "BAMLH0A0HYM2", "DCOILWTICO", "^NDX", "DX-Y.NYB", "JPY=X"]
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
    }
    rows = freshness_mod.desk_series_states(stored=stored, specs=desk_mod.desk_series_specs(stored=stored), watermarks=marks, now=NOW)
    by = {r["id"]: r for r in rows}
    # the refresh set in registry order, then any other stored series
    assert list(by) == [f"desk:{sid}" for sid in REFRESH_IDS] + ["desk:SOMETHING"]
    assert by["desk:DGS10"]["as_of"] == "2026-09-21" and by["desk:DGS10"]["state"] == "close" and by["desk:DGS10"]["cycles_behind"] == 0
    lag = cal.bond_business_days_between(date(2026, 9, 14), date(2026, 9, 21))
    assert by["desk:DGS2"]["state"] == "stale" and by["desk:DGS2"]["stale"] is True and by["desk:DGS2"]["cycles_behind"] == lag > freshness_mod.DAILY_TOLERANCE
    assert by["desk:T10Y2Y"]["state"] == "close" and "declared 1976-06-01" in by["desk:T10Y2Y"]["reason"]
    assert by["desk:VIXCLS"]["state"] == "close"
    assert by["desk:BAMLH0A0HYM2"]["state"] == "unknown" and by["desk:BAMLH0A0HYM2"]["as_of"] is None
    assert "ConnectionError" in by["desk:BAMLH0A0HYM2"]["reason"]
    assert by["desk:^NDX"]["kind"] == "market" and by["desk:^NDX"]["state"] == "close"
    # desk/hardening: EIA publishes WTI weekly, so four business days back is current
    # (the FRED daily rule would read it stale); a month back is not
    wti = by["desk:DCOILWTICO"]
    assert wti["state"] == "close" and wti["cycles_behind"] == 4 > freshness_mod.DAILY_TOLERANCE and "EIA publishes it weekly" in wti["reason"]
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
        assert s["as_of"] == stored[sid], s
        assert s["state"] in ("close", "stale") and s["cadence"] == "daily", s
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

REFRESH_KEYS = ["us10y", "us2y", "curve_2s10s", "vix", "hy_oas", "wti", "ndx", "dxy", "usdjpy"]  # tiers 1 and 2 (desk/hardening)
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
    failed = route_sweep_failures(tc, {
        ("GET", "/api/desk/positions"): ("/api/desk/positions", 404, None),
        ("GET", "/api/desk/event-study/assets"): ("/api/desk/event-study/assets", 503, None),
        ("GET", "/health"): ("/health", 200, None),
    })
    assert failed["GET /api/desk/positions"][:2] == (404, "not served")
    assert failed["GET /api/desk/event-study/assets"][:2] == (200, "expected 503")
    assert "GET /health" not in failed


def test_before_the_first_refresh_the_event_study_says_it_is_awaiting_it(served_before_refresh, monkeypatch):
    assets = client.get("/api/desk/event-study/assets")
    assert assets.status_code == 200, assets.text
    a = assets.json()
    assert a["awaiting_refresh"] == REFRESH_KEYS
    by = {x["key"]: x for x in a["shocks"]}
    assert all(by[k]["status"] == "awaiting_refresh" for k in REFRESH_KEYS if k in by)
    assert by["spx"]["status"] == "stored" and by["gold"]["status"] == "stored" and by["ndx"]["status"] == "awaiting_refresh"

    r = client.get("/api/desk/event-study", params={"shock": "vix", "w": 5, "z": 2.0, "sign": "+", "target": "spx"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "awaiting_refresh" and body["slug"] == "vix-w5-z2.0-up-none-spx" and body["series"] == "vix"
    assert "first full refresh" in body["detail"] and "no such table" not in body["detail"]
    assert r.headers["cache-control"] == "no-store"
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
    latest = {"DGS10": "2026-10-09", "DGS2": "2026-10-09", "T10Y2Y": "2026-10-09", "BAMLH0A0HYM2": "2026-10-09", "VIXCLS": "2026-10-13",
              "^NDX": "2026-09-21"}  # a tier-2 series weeks old; the other three tier-2 series not stored at all

    def verdict(latest_by_id):
        fresh = {**base, "desk_series_date": min(latest_by_id.values()) if latest_by_id else None, "desk_series_latest": latest_by_id}
        rep = freshness_mod.assess(db_fresh=fresh, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})
        return next(r for r in rep["sla"] if r["feed"] == "desk_series")

    row = verdict(latest)
    assert row["verdict"] == "current", row
    states = freshness_mod.desk_series_states(stored=latest, specs=desk_mod.desk_series_specs(stored=latest), watermarks={}, now=now)
    tier1 = {f"desk:{sid}" for sid in REFRESH_IDS[:5]}
    assert all(s["state"] == "close" for s in states if s["id"] in tier1)
    # desk/hardening: tier 2 is named in the reason and never turns the verdict
    assert {s["id"] for s in states if s["state"] != "close"} == {f"desk:{sid}" for sid in REFRESH_IDS[5:]}
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
        es.load_level(conn, registry.get("vix"))
    assert exc.value.awaiting_refresh and "next full refresh" in str(exc.value) and "first" not in str(exc.value)
    conn.execute("DROP TABLE desk_series")
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
    assert [n for n, _ in items][0] == "desk_assets" and len(items) == 1 + len(analytics_cache.DESK_PRESETS)
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
        r = tc.get("/api/desk/event-study", params={"shock": "vix", "w": 5, "z": 2.0, "sign": "+", "target": "spx"})
        if r.status_code != 202 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert r.status_code == 200 and r.json()["status"] == "ready", r.text[:200]
