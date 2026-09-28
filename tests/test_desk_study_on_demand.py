"""tests/test_desk_study_on_demand.py — Event Study questions outside the catalog (desk/usability, item 3).

DESK_FRAME3_SPEC §14.3: the engine computes any combination in well under a
second (0.1–0.4 s on the audit's store), so `/study` and `/study/events` answer
every well-formed six-slot question on request, through api/desk.py's pool,
cache and ceiling, pinned to the request's generation, with the same v1 verdict
rule and the same projection as a catalog study. A cross is still only the
S&P 500's own; `series[]` offers only what the store holds; a slow study is
202 `computing`, a full queue 429 `busy`.
"""

from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk as desk_mod, desk_catalog as catalog, desk_v2
from api.main import app
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve, synth_path  # noqa: F401 (fixture)

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS if n == "desk_assets" or n.startswith("desk_study:")]
ASK = "shock=gold&window=60&move=up2s&while=none&target=spx"


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):  # noqa: F811
    desk_mod.clear_cache()
    w = _serve(install_worker, monkeypatch, synth_path, items=ITEMS)
    yield w
    desk_mod.clear_cache()


def _study(query: str) -> dict:
    return dc.check_response("/study", client.get(f"/api/desk/study?{query}"))


def test_a_question_outside_the_catalog_is_answered_with_the_same_rules(served):
    assert catalog.study_for(catalog.Question("gold", 60, "up2s", "none", "spx")) is None
    b = _study(f"{ASK}&horizon=20")
    d = b["data"]
    assert b["status"] == "ready"
    assert d["slug"] == "gold-w60-z2.0-up-none-spx"
    assert d["label"] == "Gold (COMEX front month) +2σ, 60 days → S&P 500"
    assert d["client"] is None or d["client"]["headline"] == "Gold (COMEX front month) jumps over three months, and what the S&P 500 does next"
    assert "σ" not in (d["client"] or {"headline": ""})["headline"]
    assert d["question"]["window"] == 60 and d["selected_horizon"] == 20
    # The v1 rule, on the served rows.
    by_h = {r["h"]: r for r in d["horizons"]}
    assert all(r["verdict"] in ("reliable", "suggestive", "no_edge", "insufficient") for r in d["horizons"])
    assert d["verdict"] == by_h[20]["verdict"]
    # A repeat on the same generation is the projection memo's.
    again = _study(f"{ASK}&horizon=20")["data"]
    assert again["served_from_cache"] is True and again["inputs_hash"] == d["inputs_hash"]
    # Another horizon selects the same run's answer.
    assert _study(f"{ASK}&horizon=5")["data"]["inputs_hash"] == d["inputs_hash"]


def test_its_events_and_csv_are_the_same_run(served):
    d = _study(f"{ASK}&horizon=20")["data"]
    ev = dc.check_response("/study/events", client.get(f"/api/desk/study/events?{ASK}"))["data"]
    assert ev["slug"] == d["slug"] and len(ev["events"]) == d["matched_n"]
    csv = client.get(f"/api/desk/study/events?{ASK}", headers={"Accept": "text/csv"})
    assert csv.status_code == 200 and csv.text.splitlines()[0].startswith("event_date,entry_date,regime")
    assert len(csv.text.strip().splitlines()) == d["matched_n"] + 1


def test_the_cross_is_the_sp500s_own_and_other_refusals(served):
    for q in ("shock=gold&move=cross_above&while=none&target=spx", "shock=spx&move=cross_below&while=regime:Goldilocks&target=spx",
              "shock=spx&move=cross_above&while=none&target=gold"):
        r = client.get(f"/api/desk/study?{q}")
        assert r.status_code == 422 and r.json()["error"]["message"] == catalog.CROSS_RULE, q
    for q in (f"{ASK}&horizon=15", "shock=nope&window=20&move=up2s&while=none&target=spx", "shock=gold&window=10&move=up2s&target=spx"):
        r = client.get(f"/api/desk/study?{q}")
        assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported", q


def test_the_series_offered_are_the_ones_the_store_holds(served):
    d = _study(f"{ASK}&horizon=20")["data"]
    keys = [s["key"] for s in d["series"]]
    # The synthetic store holds the tier-1 inputs only: no tier-2 series is offered.
    assert set(keys) == {"spx", "gold", "us10y", "us2y", "curve_2s10s", "vix", "hy_oas"}
    ops = {s["key"]: s["ops"] for s in d["series"]}
    # The S&P's own crosses, and desk/fill-compute's RSI crossings the catalog asks with it.
    assert ops["spx"] == ["up2s", "down2s", "cross_above", "cross_below", "rsi_above_70", "rsi_below_30"] and ops["gold"] == ["up2s", "down2s"]


def test_the_catalog_serves_the_builders_series_with_no_study_asked(served):
    """Codex R-05: the builder's Shock and "What happens to" lists come with /study/catalog, so a question
    that fails or is not served leaves them editable; the list is the one /study serves."""
    cat = dc.check_response("/study/catalog", client.get("/api/desk/study/catalog"))["data"]
    assert [s["key"] for s in cat["series"]] and all(s["roles"] for s in cat["series"])
    assert cat["series"] == _study(f"{ASK}&horizon=20")["data"]["series"]
    refused = client.get("/api/desk/study?shock=gold&move=cross_above&while=none&target=spx")
    assert refused.status_code == 422
    assert dc.check_response("/study/catalog", client.get("/api/desk/study/catalog"))["data"]["series"] == cat["series"]


def test_a_gold_target_says_its_entry_rule_without_the_banned_word(served):
    d = _study("shock=vix&window=20&move=up2s&while=none&target=gold&horizon=20")["data"]
    assert "never" not in d["provenance"]["entry_rule"]
    assert "so entry is a later session than the event's own" in d["provenance"]["entry_rule"]


def test_a_slow_study_is_computing_and_a_full_queue_is_busy(served, monkeypatch):
    gate = threading.Event()
    real = desk_mod._compute_traced

    def slow(gen, q, cutoff):
        gate.wait(10)
        return real(gen, q, cutoff)

    monkeypatch.setattr(desk_mod, "_compute_traced", slow)
    monkeypatch.setattr(desk_mod, "COMPUTE_TIMEOUT_S", 0.05)
    r = client.get("/api/desk/study?shock=vix&window=60&move=down2s&while=none&target=spx&horizon=20")
    assert r.status_code == 202 and r.json()["status"] == "computing" and r.headers["Retry-After"] == "2"
    assert r.json()["generation_id"] is None
    monkeypatch.setattr(desk_mod, "CACHE_MAX", 1)
    r = client.get("/api/desk/study?shock=vix&window=5&move=down2s&while=none&target=spx&horizon=20")
    assert r.status_code == 429 and r.json()["error"]["code"] == "busy" and r.headers["Retry-After"] == "2"
    gate.set()


def test_the_ad_hoc_labels_read_as_the_catalogs():
    q = catalog.Question("us10y", 5, "down2s", "spx_below_50", "us10y")
    assert desk_v2.question_label(q) == "10Y Treasury −2σ, 5 days while the S&P is below its 50-day → 10Y Treasury"
    assert desk_v2.question_client(catalog.Question("vix", 20, "up2s", "regime:Overheating", "gold")) == (
        "VIX jumps over a month, in an Overheating economy, and what the Gold (COMEX front month) does next")
    assert catalog.fixes_for(catalog.ad_hoc(q)) == ["widen_window", "drop_condition"]
