"""GET /api/desk/event-study and /assets (desk/event-study, 2026-09-21).

Against the owner-populated scratch copy (data/desk_scratch.db, DESK_DB
overrides; skipped without it) served by a fresh worker so the generation is
built from that file. The presets are worker items (looked up, never
computed on the request path); a free-form query computes on request behind
the expensive-calculator gate, is cached by (generation key, slug, seed),
and answers 202 `computing` with Retry-After past the wait instead of a
blank panel. The TestClient never enters the lifespan, so no relay and no
provider probe run here."""

from __future__ import annotations

import os
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

pytestmark = pytest.mark.skipif(not SCRATCH.exists(), reason="populate data/desk_scratch.db for the Desk API tests")

client = TestClient(app)


@pytest.fixture()
def served(install_worker, monkeypatch):
    """A worker serving the scratch copy (the file every Desk read redirects to)."""
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


def test_the_api_never_imports_the_writer_or_yahoo():
    for name in ("api/desk.py", "api/analytics_cache.py"):
        text = (ROOT / name).read_text()
        assert "desk_history" not in text and "yfinance" not in text, name
