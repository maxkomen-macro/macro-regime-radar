"""tests/test_desk_v2_study.py — the catalog, /study and /study/catalog (desk/frame-3-api, B1 commit 3).

docs/desk/FRAME3_API_PLAN.md §1.2, §1.3, §1.10, §4 and §5. The catalog is the
spec's §12.3 table (read here from docs/desk/DESK_FRAME3_SPEC.md and pinned
cell for cell); each query-backed study is a worker item, `desk_study:<slug>`;
/study and /study/catalog answer by lookup and projection, under the §12
contract (tests/desk_contract.py). Routes run on the engine suite's synthetic
store served by a worker holding the Desk items; the published copy
(`DESK_PUBLISHED_DB`, default data/macro_radar.db) adds the real-data cases
and is skipped without it.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, db, desk_catalog as catalog, desk_envelope as env, desk_items, desk_v2, security
from api import calendar as nyse
from api import worker as worker_mod
from api.main import app
from src.analytics import dbpath
from src.desk import event_study as es
from tests import desk_contract as dc
from tests.test_event_study import _synthetic_db

ROOT = Path(__file__).resolve().parent.parent
SPEC = (ROOT / "docs" / "desk" / "DESK_FRAME3_SPEC.md").read_text()
PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", ROOT / "data" / "macro_radar.db"))
published = pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")
TIER2 = ("dollar-2sigma-20d", "oil-2sigma-gold", "oil-2sigma-20d")
DESK_ITEMS = [(n, f) for n, f in analytics_cache.ITEMS if n.startswith(("desk_assets", "desk_study:", "desk_preset:"))]

client = TestClient(app)


def _spec_catalog() -> list[list[str]]:
    sec = SPEC[SPEC.index("### 12.3"):SPEC.index("### 12.4")]
    rows = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in sec.splitlines() if ln.startswith("| ")]
    return [r for r in rows if len(r) == 10 and r[0] != "slug" and not r[0].startswith("-")]


def _serve(install_worker, monkeypatch, path: Path, items=DESK_ITEMS):
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    desk_v2.clear_memo()
    w = install_worker(worker_mod.AnalyticsWorker(items, poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    return w


@pytest.fixture(scope="module")
def synth_path(tmp_path_factory) -> Path:
    return _synthetic_db(tmp_path_factory.mktemp("desk-v2") / "macro_radar.db")


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):
    return _serve(install_worker, monkeypatch, synth_path)


# ── the catalog is the spec's table ─────────────────────────────────────────

def test_the_catalog_is_the_specs_table_cell_for_cell():
    rows = _spec_catalog()
    assert [r[0] for r in rows] == list(catalog.CATALOG_SLUGS) and len(rows) == 15
    for r in rows:
        s = catalog.BY_SLUG[r[0]]
        assert (s.label, s.short) == (r[1], r[2]), r[0]
        assert s.client_label == (None if r[3] == "—" else r[3]), r[0]
        if r[4] == "—":
            assert s.question is None and s.allowed_horizons == () and s.engine_kwargs is None
            continue
        want = catalog.Question(r[4], None if r[5] == "—" else int(r[5]), r[6], r[7], r[8])
        assert s.question == want and s.allowed_horizons == (5, 10, 20, 60), r[0]
        engine = re.search(r"`([^`]+)`", r[9]).group(1)
        assert catalog.ENGINE_SLUGS[r[0]] == engine, r[0]


def test_the_engine_slugs_are_slug_for_of_the_catalog_queries():
    """The aliases, and that slug_for and PRESETS are unmodified (plan §4)."""
    assert set(es.PRESETS) == {"gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross"}
    for slug in catalog.CATALOG_QUERY_SLUGS:
        q = es.Query(**catalog.BY_SLUG[slug].engine_kwargs)
        assert es.slug_for(q) == catalog.ENGINE_SLUGS[slug], slug
        assert es.validate(es.parse_slug(catalog.ENGINE_SLUGS[slug])) == es.validate(q), slug
    for name, q in es.PRESETS.items():
        assert es.validate(es.Query(**catalog.BY_SLUG[catalog.BY_ENGINE_SLUG[name]].engine_kwargs)) == es.validate(q)


def test_the_lookup_slugs_and_items_are_registered():
    assert security.DESK_CATALOG_SLUGS == frozenset(catalog.CATALOG_SLUGS) >= frozenset(catalog.CATALOG_QUERY_SLUGS)
    assert len(catalog.CATALOG_QUERY_SLUGS) == 13
    assert {"/api/desk/study", "/api/desk/study/catalog"} <= security.DESK_STUDY_PATHS
    names = [n for n, _ in analytics_cache.ITEMS]
    first_preset = names.index("desk_preset:gold-2sigma-spx-weak")
    for slug in catalog.CATALOG_QUERY_SLUGS:
        assert names.index(f"desk_study:{slug}") < first_preset, slug


def test_the_ledger_order_groups_and_allowlist_are_the_specs():
    sec8 = SPEC[SPEC.index("## 8. Signal Ledger"):SPEC.index("## 9. ")]
    listed = re.search(r"this order \(v3 §2, v4 B-03\): (.*?)\. A firing row", sec8, re.S).group(1)
    assert tuple(s.strip() for s in listed.replace("\n", " ").split(",")) == catalog.LEDGER_ORDER
    spx = {s for s, g in catalog.LEDGER_GROUP.items() if g == "spx"}
    assert spx == {"golden-cross", "death-cross", "spx-20d-2sigma", "spx-5d-2sigma", "rsi-above-70", "rsi-below-30"}
    assert '["golden-cross","death-cross","spx-20d-2sigma","spx-5d-2sigma"]' in SPEC
    assert list(catalog.TECHNICALS_ALLOWLIST) == ["golden-cross", "death-cross", "spx-20d-2sigma", "spx-5d-2sigma"]


def test_the_verdict_definitions_are_section_1_5s_word_for_word():
    sec = SPEC[SPEC.index("### 1.5 Verdicts"):SPEC.index("### 1.6")]
    for key, label in desk_v2.VERDICT_LABEL.items():
        m = re.search(rf"\*\*{re.escape(label)}\*\* \([^)]*\) — (.*?)(?=\n- \*\*|\n\n)", sec, re.S)
        assert m, label
        assert " ".join(m.group(1).split()) == desk_v2.VERDICT_DEFINITION[key], label


# ── R11: normalization ──────────────────────────────────────────────────────

def _norm(qs: str):
    from urllib.parse import parse_qsl

    return catalog.normalize(parse_qsl(qs, keep_blank_values=True), resolve_alias=desk_v2.engine_alias)


def test_a_request_normalizes_to_one_catalog_study():
    assert _norm("preset=gold-2sigma-spx-weak") == (catalog.BY_SLUG["gold-2sigma-spx-weak"], 20)
    assert _norm("preset=spx-golden-cross")[0].slug == "golden-cross"            # an engine slug (v3 §2)
    assert _norm("preset=vix-w5-z2.0-up-none-spx&horizon=5")[0].slug == "vix-spike-2sigma-5d"
    assert _norm("preset=vix-w5-z2-up-none-spx")[0].slug == "vix-spike-2sigma-5d"  # parses to the same query
    assert _norm("shock=spx&move=cross_above&target=spx&horizon=60") == (catalog.BY_SLUG["golden-cross"], 60)
    assert _norm("shock=gold&window=20&move=up2s&while=spx_below_50&target=spx")[0].slug == "gold-2sigma-spx-weak"
    assert _norm("shock=spx&window=5&move=up2s&target=spx&while=none")[0].slug == "spx-5d-2sigma"   # while defaults to none
    assert _norm("preset=rsi-above-70") == (catalog.BY_SLUG["rsi-above-70"], None)


@pytest.mark.parametrize(("qs", "names"), [
    ("preset=golden-cross&foo=1", "foo"),
    ("preset=golden-cross&confidence=0.8", "confidence"),
    ("shock=vix&window=10&move=up2s&target=spx", "window 10"),
    ("shock=spx&window=20&move=down2s&while=spx_above_50&target=spx", "spx_above_50"),
    ("shock=spx&window=20&move=cross_above&target=spx", "window"),
    ("shock=spx&move=up2s&target=spx", "window"),
    ("shock=gold&window=20&move=up2s&target=spx", "No study in the catalog asks"),
    ("preset=golden-cross&horizon=30", "horizon 30"),
    ("preset=golden-cross&horizon=abc", "horizon abc"),
    ("preset=golden-cross&shock=spx", "slot parameters"),
    ("preset=golden-cross&preset=death-cross", "preset is given more than once"),
    ("preset=not-a-study", "not-a-study"),
    ("preset=vix-w5-z2.0-up-none-spx-overheating", "vix-w5-z2.0-up-none-spx-overheating"),
    ("preset=rsi-above-70&horizon=20", "horizon"),
    ("preset=rsi-below-30&horizon=abc", "horizon"),
    ("", "needs preset"),
])
def test_anything_else_is_unsupported_naming_what(qs, names):
    with pytest.raises(env.Unsupported) as exc:
        _norm(qs)
    assert names in str(exc.value), str(exc.value)


# ── R14, R15, R1, R13, the templates ────────────────────────────────────────

def test_ops_and_fixes():
    ops = catalog.ops_by_shock()
    assert ops["spx"] == ["up2s", "down2s", "cross_above", "cross_below"] and ops["dxy"] == ["down2s"]
    assert ops.get("us2y") is None
    assert catalog.fixes_for(catalog.BY_SLUG["spx-5d-2sigma"]) == ["widen_window"]
    assert catalog.fixes_for(catalog.BY_SLUG["gold-2sigma-spx-weak"]) == []
    assert catalog.fixes_for(catalog.BY_SLUG["spx-20d-2sigma"]) == []
    assert catalog.fixes_for(catalog.BY_SLUG["golden-cross"]) == []


def _h(n=20, delta=None, exclusion=None) -> dict:
    return {"n": n, "delta": delta, **({"exclusion": exclusion} if exclusion is not None else {})}


@pytest.mark.parametrize(("by_h", "h", "want"), [
    ({5: _h(delta=1.0), 10: _h(delta=1.0), 20: _h(n=9, delta=1.0)}, 20, "insufficient"),
    ({5: _h(delta=-1.0), 10: _h(delta=1.0), 20: _h(delta=1.0, exclusion="established")}, 20, "reliable"),
    ({5: _h(delta=0.1), 10: _h(delta=0.2), 20: _h(delta=0.3)}, 20, "suggestive"),
    ({5: _h(delta=-0.1), 10: _h(delta=-0.2), 20: _h(delta=-0.3), 60: _h(delta=0.5)}, 60, "suggestive"),
    ({5: _h(delta=0.1), 10: _h(delta=-0.2), 20: _h(delta=0.3)}, 20, "no_edge"),
    ({5: _h(delta=0.0), 10: _h(delta=0.2), 20: _h(delta=0.3)}, 20, "no_edge"),              # zero is not a lean
    ({5: _h(n=0, delta=None), 10: _h(delta=0.2), 20: _h(delta=0.3)}, 20, "no_edge"),       # a missing horizon
    ({5: _h(delta=0.1), 10: _h(delta=0.2), 20: _h(delta=0.3, exclusion="not established")}, 20, "suggestive"),
    ({5: _h(delta=0.1), 10: _h(delta=-0.2), 20: _h(delta=0.3, exclusion="included")}, 20, "no_edge"),
])
def test_the_v1_verdict(by_h, h, want):
    assert desk_v2.verdict_v1(by_h, h) == want


def test_the_reasons_in_words():
    assert desk_v2.reason_words(None) is None
    assert desk_v2.reason_words("insufficient data") == "no completed outcomes at this horizon"
    assert desk_v2.reason_words("too few blocks for an interval (2 < 5)") == "fewer than five independent blocks"
    assert desk_v2.reason_words("too few independent blocks to judge exclusion").startswith("fewer than ten")
    assert "established" not in " ".join(desk_v2.NOTE_WORDS.values())
    with pytest.raises(ValueError):
        desk_v2.reason_words("a note nobody wrote")


def test_numbers_are_the_engines_with_a_true_minus():
    assert desk_v2.num(-0.0162, "log_return") == "−1.6%" and desk_v2.num(0.041, "log_return") == "+4.1%"
    assert desk_v2.num(-6.0, "bp") == "−6 bp" and desk_v2.num(12.0, "bp") == "+12 bp"
    assert desk_v2.share(0.146) == "14.6%"


# ── /study/catalog ──────────────────────────────────────────────────────────

def test_the_study_catalog(served):
    body = dc.check_response("/study/catalog", client.get("/api/desk/study/catalog"))
    rows = body["data"]["studies"]
    assert [r["slug"] for r in rows] == list(catalog.CATALOG_SLUGS)
    by = {r["slug"]: r for r in rows}
    for slug in ("rsi-above-70", "rsi-below-30"):
        assert by[slug]["question"] is None and by[slug]["available"] is False and by[slug]["client_label"] is None
        assert by[slug]["unavailable"] == {"reason": "RSI is not computed yet.", "until": None} and by[slug]["allowed_horizons"] == []
    for slug in TIER2:  # the synthetic store holds no WTI or DXY
        assert by[slug]["available"] is False and "desk_series" in by[slug]["unavailable"]["reason"], by[slug]
        assert by[slug]["allowed_horizons"] == [5, 10, 20, 60]
    for slug in set(catalog.CATALOG_QUERY_SLUGS) - set(TIER2):
        assert by[slug]["available"] is True and by[slug]["unavailable"] is None, slug
    assert client.get("/api/desk/study/catalog?x=1").status_code == 422


# ── /study ──────────────────────────────────────────────────────────────────

def _study(qs: str) -> dict:
    return dc.check_response("/study", client.get(f"/api/desk/study?{qs}"))


def _slots(s: catalog.Study) -> str:
    q = s.question
    parts = [f"shock={q.shock}", f"move={q.move}", f"target={q.target}", f"while={q.while_}"]
    return "&".join(parts + ([f"window={q.window}"] if q.window is not None else []))


@pytest.mark.parametrize("slug", catalog.CATALOG_QUERY_SLUGS)
def test_every_catalog_study_by_preset_and_by_its_six_slots(served, slug):
    s = catalog.BY_SLUG[slug]
    a, b = _study(f"preset={slug}"), _study(_slots(s))
    if slug in TIER2:
        assert a["status"] == b["status"] == "awaiting" and "desk_series" in a["unavailable"]["reason"]
        return
    assert a["status"] == b["status"] == "ready"
    d = a["data"]
    assert {k: v for k, v in b["data"].items() if k not in ("served_from_cache", "elapsed_ms")} == \
        {k: v for k, v in d.items() if k not in ("served_from_cache", "elapsed_ms")}
    assert d["slug"] == slug and d["label"] == s.label and d["question"]["shock"] == s.question.shock
    assert d["prev_session"] == nyse.previous_trading_day(date.fromisoformat(d["comparison_session"])).isoformat()
    assert all(r["h"] == 20 for r in d["by_regime"]) and len(d["by_regime"]) == 4
    assert d["without_condition"] == {"status": "awaiting", "data": None, "unavailable": {
        "reason": "conditional-versus-unconditional comparison is not defined", "until": None}}
    assert d["client"]["horizon"] == 20 and d["client"]["headline"] == s.client_label != s.label
    assert d["verdict_rule"] == "v1" and d["verdict_confidence"] == 0.9
    assert d["inputs_hash"] == analytics_cache_item(served, slug)["native"]["provenance"]["inputs_hash"]


def analytics_cache_item(w, slug):
    return w.current.results[f"desk_study:{slug}"]


@pytest.mark.parametrize("h", [5, 10, 20, 60])
def test_the_selected_horizon_drives_the_verdict_headline_why_and_empty_state(served, h):
    d = _study(f"preset=spx-5d-2sigma&horizon={h}")["data"]
    row = next(r for r in d["horizons"] if r["h"] == h)
    assert d["selected_horizon"] == d["question"]["horizon"] == h and d["verdict"] == row["verdict"]
    assert d["headline"].startswith(f"{desk_v2.VERDICT_LABEL[row['verdict']]} at {desk_v2.HORIZON_LABEL[h]}: ")
    assert d["why"] == desk_v2.why_sentence(row, d["question"]["target_unit"])
    assert d["why"].startswith(f"{row['n']} completed outcomes in {row['n_blocks']} overlap blocks; ")
    assert (d["empty_state"] is not None) == (row["n"] < 10)
    assert [r["h"] for r in d["horizons"]] == [5, 10, 20, 60]
    assert [r["label"] for r in d["horizons"]] == ["1 week", "2 weeks", "1 month", "3 months"]


def test_the_projection_memo_serves_a_repeat_and_nothing_that_depends_on_now(served, monkeypatch):
    first = _study("preset=golden-cross")["data"]
    again = _study("preset=golden-cross")["data"]
    assert first["served_from_cache"] is False and again["served_from_cache"] is True
    assert _study("preset=golden-cross&horizon=60")["data"]["served_from_cache"] is False
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc))  # a Saturday
    sat = _study("preset=golden-cross")["data"]
    assert sat["served_from_cache"] is True
    assert (sat["comparison_session"], sat["prev_session"]) == ("2026-09-25", "2026-09-24")
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc))  # after the last close
    fri = _study("preset=golden-cross")["data"]
    assert (fri["comparison_session"], fri["prev_session"]) == ("2026-09-18", "2026-09-17")
    assert fri["evaluated_on"] == "2026-09-18" and fri["stale"] is False and sat["stale"] is True
    for entry, _trace in desk_v2._memo.values():
        assert not {"comparison_session", "prev_session", "stale", "firing_now", "firing_day", "evaluated_on",
                    "served_from_cache", "elapsed_ms"} & set(entry)


def test_the_provenance_names_the_envelopes_engine_version(served, monkeypatch):
    monkeypatch.setattr(env, "ENGINE_VERSION", "0123abc")
    body = _study("preset=golden-cross")
    assert body["engine_version"] == body["data"]["provenance"]["engine_version"] == "0123abc"


def test_the_stubs_and_the_study_routes_share_one_generation(served):
    ids = {client.get(u).json()["generation_id"] for u in (
        "/api/desk/study?preset=golden-cross", "/api/desk/study/catalog", "/api/desk/vol", "/api/desk/positions")}
    assert ids == {env.generation_id(served.current)}


def test_rsi_presets_follow_s31(served):
    for slug in ("rsi-above-70", "rsi-below-30"):
        b = _study(f"preset={slug}")
        assert b["status"] == "awaiting" and b["unavailable"] == {"reason": "RSI is not computed yet.", "until": None}
        for h in ("20", "5", "abc"):
            r = client.get(f"/api/desk/study?preset={slug}&horizon={h}")
            assert r.status_code == 422 and "horizon" in r.json()["error"]["message"], (slug, h)


def test_the_preset_items_reuse_the_catalog_run_byte_for_byte(served):
    gen = served.current
    with dbpath.pinned(gen):
        for name in es.PRESETS:
            direct = es.run(es.PRESETS[name])
            reused = gen.results[f"desk_preset:{name}"]
            assert reused is gen.results[f"desk_study:{catalog.BY_ENGINE_SLUG[name]}"]["native"]
            assert json.dumps(reused, sort_keys=True) == json.dumps(direct, sort_keys=True), name


def test_a_refused_catalog_item_falls_through_to_the_legacy_preset(install_worker, monkeypatch, tmp_path):
    """A store without desk_series: the catalog's desk_series studies refuse, the
    presets (asset_prices and regimes only) still reuse theirs, and the legacy
    event-study route answers as it did (200 awaiting_refresh for a desk_series study)."""
    path = _synthetic_db(tmp_path / "macro_radar.db")
    with sqlite3.connect(path) as c:
        c.execute("DROP TABLE desk_series")
    w = _serve(install_worker, monkeypatch, path)
    assert w.current.results["desk_study:vix-spike-2sigma-5d"]["kind"] == "not_stored"
    assert "native" in w.current.results["desk_study:golden-cross"]
    assert client.get("/api/desk/event-study", params={"study": "spx-golden-cross"}).status_code == 200
    r = client.get("/api/desk/event-study", params={"study": "vix-w5-z2.0-up-none-spx"})
    assert r.status_code == 200 and r.json()["status"] == "awaiting_refresh"
    assert _study("preset=vix-spike-2sigma-5d")["status"] == "awaiting"


def test_no_evaluable_session_is_awaiting(install_worker, monkeypatch, tmp_path):
    _serve(install_worker, monkeypatch, _synthetic_db(tmp_path / "macro_radar.db", regimes=False))
    b = _study("preset=golden-cross")
    assert b["status"] == "awaiting" and "no evaluable session" in b["unavailable"]["reason"]
    cat = dc.check_response("/study/catalog", client.get("/api/desk/study/catalog"))["data"]["studies"]
    assert not any(r["available"] for r in cat)


def test_a_zero_event_study_is_ready_and_insufficient(synth_path):
    """Readiness 3 (plan §5): a completed run with no retained event is ready,
    insufficient, with the empty state set and no client line."""
    native, table, trace = es.run_traced(es.parse_slug("us10y-w5-z2.5-up-vix_above=1000.0-spx"), synth_path)
    item = {"ok": True, "native": native, "events": table, "trace": trace, "pre1970": {}}
    p = desk_v2.study_projection(catalog.BY_SLUG["10y-2sigma-20d"], 20, item)
    assert p["matched_n"] == 0 and p["first_event"] is None and p["last_event"] is None and p["last_events"] == []
    assert p["verdict"] == "insufficient" and p["client"] is None
    assert p["empty_state"]["sentence"].startswith("Only 0 events complete at 1 month since ")
    assert all(r["up_pct"] is None and r["worst"] is None and r["draws"] == 0 and r["up_n"] == 0 for r in p["horizons"])
    assert p["why"] == "0 completed outcomes in 0 overlap blocks; no completed outcomes at this horizon."
    body = {"status": "ready", "generation_id": "g1-0", "as_of": "2026-09-24", "engine_version": "x", "unavailable": None,
            "error": None, "data": {**p, **desk_v2.now_fields(trace, cross=False), "served_from_cache": False, "elapsed_ms": 1.0}}
    dc.check("/study", json.dumps(body))


# ── the pre-1970 disclosure (plan §1.2, round 4's R-10) ─────────────────────

def _independent_n(store: Path, slug: str) -> tuple[int, int]:
    """N and DGS10's missing-session count for a us10y study, computed here from
    api/calendar, the study's sessions and DGS10's stored dates."""
    native, _, trace = es.run_traced(es.Query(**catalog.BY_SLUG[slug].engine_kwargs), store)
    meta = next(m for m in native["provenance"]["inputs"] if m["key"] == "us10y")
    conn = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
    try:
        have = {r[0] for r in conn.execute("SELECT date FROM desk_series WHERE series_id = 'DGS10'")}
    finally:
        conn.close()
    sessions = set(trace.sessions)
    n = sum(1 for y, days in nyse.HOLIDAYS.items() if y < 1970 for d in days
            if meta["history_from"] <= d.isoformat() <= meta["last"] and d.isoformat() in sessions and d.isoformat() not in have)
    return n, meta["missing_sessions"]


@published
@pytest.mark.parametrize("slug", ["10y-2sigma-20d", "spx-2sigma-10y"])
def test_the_published_copy_discloses_the_pre_1970_holidays(install_worker, monkeypatch, slug):
    w = _serve(install_worker, monkeypatch, PUBLISHED, items=[(f"desk_study:{slug}", desk_items.desk_study(slug))])
    d = _study(f"preset={slug}")["data"]
    n, missing = _independent_n(PUBLISHED, slug)
    assert n == 67, n
    assert f"us10y {missing} (includes {n} pre-1970 holidays the engine calendar treats as sessions)" in " ".join(d["warnings"])
    native = w.current.results[f"desk_study:{slug}"]["native"]
    assert not any("pre-1970" in x for x in native["provenance"]["warnings"]), "the native payload is untouched"
    assert d["inputs_hash"] == native["provenance"]["inputs_hash"]


def test_a_hermetic_store_from_1968_discloses_its_own_holes(install_worker, monkeypatch, tmp_path):
    from src.market_data import desk_history

    path = _synthetic_db(tmp_path / "macro_radar.db")
    conn = sqlite3.connect(path)
    d, rows = date(1968, 1, 2), []
    while d < date(1995, 1, 2):
        if nyse.is_bond_trading_day(d):
            rows.append((d.isoformat(), 5.0 + (d.toordinal() % 97) / 100))
        d = date.fromordinal(d.toordinal() + 1)
    desk_history.write_series(conn, "DGS10", rows, provider="fred", merge=True)
    conn.commit()
    conn.close()
    _serve(install_worker, monkeypatch, path, items=[("desk_study:10y-2sigma-20d", desk_items.desk_study("10y-2sigma-20d"))])
    data = _study("preset=10y-2sigma-20d")["data"]
    n, missing = _independent_n(path, "10y-2sigma-20d")
    assert n > 0
    assert f"us10y {missing} (includes {n} pre-1970 holidays the engine calendar treats as sessions)" in " ".join(data["warnings"])


def test_without_a_pre_1970_input_the_warnings_are_the_engines(served):
    d = _study("preset=gold-2sigma-spx-weak")["data"]
    native = served.current.results["desk_study:gold-2sigma-spx-weak"]["native"]
    assert d["warnings"] == native["provenance"]["warnings"]
    P = native["provenance"]
    gaps = {m["key"]: m["missing_sessions"] for m in P["inputs"] if m["missing_sessions"]}
    rebuilt = desk_v2.GAPS_PREFIX + ", ".join(f"{k} {v}" for k, v in sorted(gaps.items())) + "."
    assert rebuilt in P["warnings"], "the unqualified rebuild is the engine's string byte for byte"
    assert desk_v2.served_warnings(P, {k: 0 for k in gaps}) == P["warnings"]


# ── readiness on the published copy ─────────────────────────────────────────

@published
def test_a_short_history_study_is_ready_and_insufficient(install_worker, monkeypatch):
    _serve(install_worker, monkeypatch, PUBLISHED, items=[("desk_study:hy-2sigma-20d", desk_items.desk_study("hy-2sigma-20d"))])
    d = _study("preset=hy-2sigma-20d")["data"]
    row = next(r for r in d["horizons"] if r["h"] == 20)
    assert d["verdict"] == "insufficient" and d["empty_state"] is not None and row["ci_lo"] is None
    assert row["reason"] == "fewer than five independent blocks" and row["method"] is None and row["draws"] == 0


# ── the middleware routes a lookup around the study ceiling (S-25) ──────────

def test_a_catalog_lookup_never_waits_behind_the_study_ceiling():
    import asyncio

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, desk_study_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    def get(path: str, qs: bytes = b""):
        sent.clear()
        asyncio.run(mw({"type": "http", "path": path, "method": "GET", "query_string": qs, "headers": [],
                        "client": ("1.2.3.4", 1)}, receive, send))
        return sent[0]["status"]

    assert mw.desk_study.acquire(blocking=False)  # every study slot is taken
    try:
        assert get("/api/desk/study", b"preset=golden-cross") == 200
        assert get("/api/desk/study", b"preset=golden-cross&horizon=60") == 200
        assert get("/api/desk/study/catalog") == 200
        assert get("/api/desk/study", b"preset=rsi-above-70") == 200
        assert get("/api/desk/study", b"preset=rsi-above-70&horizon=20") == 200
        assert get("/api/desk/study", b"shock=vix&window=5&move=up2s&target=spx") == 429
        assert get("/api/desk/study", b"preset=golden-cross&horizon=60&horizon=5") == 429
        assert get("/api/desk/study", b"preset=spx-golden-cross") == 429, "an engine alias computes a parse: the study pool"
        assert get("/api/desk/study/catalog", b"x=1") == 429
        assert get("/api/desk/event-study", b"study=spx-golden-cross") == 200
    finally:
        mw.desk_study.release()


# ── connections to the generation's copy (plan §5) ──────────────────────────

_FAILING_BUILD = r'''
import faulthandler, gc, json, os, sqlite3, sys, threading


def main():
    root, store = sys.argv[1], sys.argv[2]
    sys.path.insert(0, root)
    from pathlib import Path

    from api import analytics_cache, db
    from api import worker as worker_mod
    from src.analytics import recession
    from src.desk import event_study as es

    faulthandler.dump_traceback_later(120, exit=True)
    gc.disable()  # a connection left for the collector stays until the checks below
    conns = []
    real = es._connect

    class FailsMidway:
        """The builder's real connection to the copy, whose reads fail once it is open."""

        def __init__(self, conn):
            self._conn = conn

        def execute(self, *args, **kwargs):
            raise RuntimeError("forced failure mid-build")

        def close(self):
            self._conn.close()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    def failing(path):
        conn = real(path)
        conns.append(conn)
        return FailsMidway(conn)

    from api import desk_items_macro

    real_desk = desk_items_macro._connect  # desk_regime's own connection (desk/frame-3-api-b2a)

    def failing_desk():
        conn = real_desk()
        conns.append(conn)
        return FailsMidway(conn)

    desk_items_macro._connect = failing_desk
    real_recession = recession._get_conn

    def failing_recession():
        conn = real_recession()
        conns.append(conn)
        return FailsMidway(conn)

    es._connect = failing
    recession._get_conn = failing_recession  # desk_regime's recession provenance (N5)
    db.DB_PATH = Path(store)
    items = [(n, f) for n, f in analytics_cache.ITEMS if n.startswith(tuple(sys.argv[3].split(",")))]
    w = worker_mod.AnalyticsWorker(items, poll_s=0.05, preload=False)
    worker_mod._worker = w
    w.start(serving=True)
    assert w.wait_published(timeout=90)
    failed = sorted(n for n, e in w.current.errors.items() if "forced failure" in str(e))

    def is_open(conn):
        try:
            conn.in_transaction
            return True
        except sqlite3.ProgrammingError:
            return False

    left_open = sum(1 for c in conns if is_open(c))
    gc.collect()
    box = {}

    def reader():
        box["rows"] = db._connect().execute("SELECT COUNT(*) FROM regimes").fetchone()[0]

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    t.join(10)
    faulthandler.cancel_dump_traceback_later()
    regime = w.current.results.get("desk_regime", {"recession": "absent"})
    print("RESULT " + json.dumps({"opened": len(conns), "left_open": left_open, "failed": failed,
                                  "regime_recession": regime["recession"], "rows": box.get("rows"),
                                  "hung": t.is_alive()}), flush=True)
    w.stop()
    os._exit(0)


if __name__ == "__main__":
    main()
'''


# Every Desk v2 builder that opens a connection to the copy (plan §5): each is made to fail once it is open.
FAILING_ITEM_PREFIXES = ("desk_study:", "desk_technicals", "desk_facts", "desk_regime")


def test_a_desk_item_that_fails_midway_leaves_no_connection_to_the_copy(tmp_path, synth_path):
    script = tmp_path / "failing_build.py"
    script.write_text(_FAILING_BUILD)
    env_ = {**os.environ, "EODHD_PROBE_ON_START": "0", "ASSISTANT_ACCESS": "off"}
    proc = subprocess.run([sys.executable, str(script), str(ROOT), str(synth_path), ",".join(FAILING_ITEM_PREFIXES)],
                          capture_output=True, text=True, timeout=300, env=env_, cwd=ROOT)
    lines = [ln for ln in proc.stdout.splitlines() if ln.startswith("RESULT ")]
    assert lines, (proc.returncode, proc.stdout[-2000:], proc.stderr[-4000:])
    res = json.loads(lines[-1][len("RESULT "):])
    items = sorted(n for n, _ in analytics_cache.ITEMS if n.startswith(FAILING_ITEM_PREFIXES))
    # every builder fails, desk_regime included: since the merge with desk/frame-3-api-b2a it is the one
    # regime item, whose own regimes read fails the whole item (its recession block, which fails alone
    # and leaves the rows served, is tests/test_desk_v2_regime.py's
    # test_a_recession_block_that_fails_leaves_the_rows_served)
    assert res["failed"] == items, res
    assert res["regime_recession"] == "absent", res
    assert res["opened"] == len(items) and res["left_open"] == 0 and res["rows"] > 0 and not res["hung"], res


def test_the_new_modules_install_no_python_callback_on_a_connection():
    for name in ("api/desk_envelope.py", "api/desk_v2.py", "api/desk_catalog.py", "api/desk_items.py"):
        text = (ROOT / name).read_text()
        for call in ("set_authorizer", "set_progress_handler", "set_trace_callback"):
            assert call not in text, (name, call)


def test_the_catalog_and_items_modules_import_nothing_heavy():
    heavy = ("pandas", "numpy", "exchange_calendars", "sklearn", "scipy", "src.config", "src.desk.event_study")
    code = f"import sys, api.desk_catalog, api.desk_items; print(sorted(m for m in {heavy!r} if m in sys.modules))"
    base = {k: v for k, v in os.environ.items() if k != "FRED_API_KEY"}
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=base, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "[]"
