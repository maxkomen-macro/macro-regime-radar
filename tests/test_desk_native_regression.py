"""tests/test_desk_native_regression.py — the engine's native output is unchanged (desk/frame-3-api).

docs/desk/FRAME3_API_PLAN.md §2. The Desk adapter reads each study's full
event table and signal trace, which leave `_run` on a side channel; the dict
`run()` returns, and every `inputs_hash`, must not move. Three layers:

1. the traced path returns the identical dict, for every catalog query and
   preset on the engine suite's synthetic store; the tier-2 queries the store
   lacks are the typed `NotStored` on both paths;
2. HEAD's output, pinned (generation "golden", as-of 2026-09-24), matches the
   golden the base engine wrote (scripts/desk_native_golden.py, one sha256 per
   query, tests/fixtures/desk_native_<base>.json);
3. the A/B run on the published copy is scripts/desk_native_ab.py, recorded
   in docs/desk/FRAME3_API_REPORT.md.

And the projections the adapter serves are checked against the run itself:
counts, per-horizon n, up counts against the hit rate, medians, extrema, the
ten newest events against `recent_events`, the regime counts, on every catalog
study, on the synthetic store and on the published copy (`DESK_PUBLISHED_DB`,
default data/macro_radar.db; skipped without it).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pytest

from dataclasses import replace

from src.desk import event_study as es
from src.desk import series as registry
from tests.test_event_study import _synthetic_db

ROOT = Path(__file__).resolve().parent.parent
GOLDENS = sorted((ROOT / "tests" / "fixtures").glob("desk_native_*.json"))
PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", ROOT / "data" / "macro_radar.db"))
PINS = {"generation": "golden", "as_of": "2026-09-24"}

# DESK_FRAME3_SPEC §12.3's engine query column: the three presets, then the ten others.
PRESET_SLUGS = ("gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross")
CATALOG_QUERIES = PRESET_SLUGS + (
    "vix-w5-z2.0-up-none-spx", "hy_oas-w20-z2.0-up-none-spx", "us10y-w20-z2.0-up-none-spx",
    "dxy-w20-z2.0-down-none-spx", "wti-w20-z2.0-up-none-gold", "spx-w20-z2.0-down-none-us10y",
    "spx-w20-z2.0-up-none-spx", "spx-w5-z2.0-up-none-spx", "curve_2s10s-w20-z2.0-up-none-spx",
    "wti-w20-z2.0-up-none-spx",
)
TIER2 = {"dxy-w20-z2.0-down-none-spx": "dxy", "wti-w20-z2.0-up-none-gold": "wti", "wti-w20-z2.0-up-none-spx": "wti"}
ZERO_EVENTS = "us10y-w5-z2.5-up-vix_above=1000.0-spx"


@pytest.fixture(scope="module")
def synth(tmp_path_factory) -> Path:
    return _synthetic_db(tmp_path_factory.mktemp("native") / "synth.db")


def _canonical(r: dict) -> str:
    return json.dumps(r, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _run_pinned(conn, q, traced: bool = False):
    fn = es.run_on_traced if traced else es.run_on
    return fn(conn, q, generation=PINS["generation"], as_of=PINS["as_of"])


# ── layer 2: the golden ─────────────────────────────────────────────────────

def _golden() -> dict:
    assert len(GOLDENS) == 1, f"exactly one native golden, found {[g.name for g in GOLDENS]}"
    return json.loads(GOLDENS[0].read_text())


def test_the_golden_is_the_bases_pinned_run_over_the_catalog():
    g = _golden()
    assert g["pins"] == PINS and GOLDENS[0].name == f"desk_native_{g['base'][:7]}.json"
    names = set(g["queries"])
    assert set(CATALOG_QUERIES) <= names, set(CATALOG_QUERIES) - names
    assert ZERO_EVENTS in names and len(names) > len(CATALOG_QUERIES)


# desk/fill-compute (owner's item 7): the registry's `vix` moved from FRED VIXCLS (desk_series) to ^VIX
# (asset_prices). The golden was written with the base's entry; layer 2 runs HEAD's engine with that entry,
# so it still proves the engine unchanged, and the next test proves the move changes only the series' identity.
BASE_VIX = replace(registry.BY_KEY["vix"], source="fred", series_id="VIXCLS",
                   note="CBOE close via FRED VIXCLS; settles 16:15 ET, so a VIX-dated event enters the target the next session.")


# Codex R-20 (round 2): the engine's provenance sentence for the regime source was reworded ("3-month ... slopes"
# became "the slopes over the last three monthly readings"), one string and no computation. The golden holds the
# base's sentence; layer 2 maps exactly the new sentence back to it, so every number the engine returns is still
# pinned to the base's, and the test requires the sentence to occur (the mapping is never vacuous).
REWORDED = {
    "regimes table (src/regime.py: a rule on the INDPRO and CPI slopes over the last three monthly readings, one row per month), read as stored":
    "regimes table (src/regime.py: a rule on 3-month INDPRO and CPI slopes, one row per month), read as stored",
}


def _as_base_text(text: str) -> tuple[str, int]:
    """The canonical JSON with each reviewed rewording mapped back to the base's sentence; how many were mapped."""
    hits = 0
    for new, old in REWORDED.items():
        hits += text.count(json.dumps(new))
        text = text.replace(json.dumps(new), json.dumps(old))
    return text, hits


@pytest.fixture()
def base_vix(monkeypatch):
    monkeypatch.setitem(registry.BY_KEY, "vix", BASE_VIX)


def test_heads_pinned_output_matches_the_golden(synth, base_vix):
    """Layer 2: every query's canonical JSON hashes to the base engine's (the
    VIX read as the base registry declared it, BASE_VIX)."""
    conn = es._connect(synth)
    moved = {}
    reworded = 0
    try:
        for name, spec in _golden()["queries"].items():
            q = es.parse_slug(spec["slug"]) if "slug" in spec else es.Query(**spec["kwargs"])
            assert es.slug_for(es.validate(q)) == name
            try:
                text, hits = _as_base_text(_canonical(_run_pinned(conn, q)))
                reworded += hits
            except es.NotStored as exc:
                text = f"NotStored:{exc.series}"
            except es.StudyError as exc:
                text = f"StudyError:{exc}"
            if hashlib.sha256(text.encode("utf-8")).hexdigest() != spec["sha256"]:
                moved[name] = text[:200]
    finally:
        conn.close()
    assert moved == {}, f"native output moved from the golden (a blocking finding, A-18): {sorted(moved)}"
    assert reworded > 0, "the reviewed rewording never occurred: REWORDED no longer matches the engine's sentence"


# ── layer 1: the traced path ────────────────────────────────────────────────

@pytest.mark.parametrize("slug", CATALOG_QUERIES)
def test_the_traced_run_returns_the_identical_dict(synth, slug):
    conn = es._connect(synth)
    try:
        q = es.parse_slug(slug)
        if slug in TIER2:
            for traced in (False, True):
                with pytest.raises(es.NotStored) as exc:
                    _run_pinned(conn, q, traced=traced)
                assert exc.value.series == TIER2[slug]
            return
        plain = _run_pinned(conn, q)
        traced, table, trace = _run_pinned(conn, q, traced=True)
        assert _canonical(traced) == _canonical(plain)
        assert isinstance(table, es.EventTable) and isinstance(trace, es.SignalTrace)
    finally:
        conn.close()


def test_run_traced_opens_and_closes_as_run_does(synth):
    a = es.run(es.PRESETS["spx-golden-cross"], synth, as_of=PINS["as_of"])
    b, table, _ = es.run_traced(es.PRESETS["spx-golden-cross"], synth, as_of=PINS["as_of"])
    assert _canonical(a) == _canonical(b) and len(table) == a["provenance"]["n_events"]


def test_the_trace_is_read_only(synth):
    _, table, trace = es.run_traced(es.PRESETS["gold-2sigma-spx-weak"], synth, as_of=PINS["as_of"])
    for arr in (table.event_idx, table.entry_idx, table.entry_delay, table.same_session, table.value[20],
                table.exit_idx[20], trace.evaluable, trace.trigger, trace.holds, trace.z):
        with pytest.raises(ValueError):
            arr[:1] = 0
    with pytest.raises(AttributeError):
        table.n_unlabeled = 1


def test_detect_events_still_applies_the_cooldown_over_the_trigger_mask():
    import pandas as pd

    z = pd.Series([0.0, 2.1, 2.2, np.nan, 2.5, 0.0, -2.4, 2.0, 1.9])
    assert es.trigger_mask(z, 2.0, "+").tolist() == [False, True, True, False, True, False, False, True, False]
    assert es.trigger_mask(z, 2.0, "-").tolist() == [False] * 6 + [True, False, False]
    assert es.trigger_mask(z, 2.0, "both").tolist() == [False, True, True, False, True, False, True, True, False]
    pos, raw = es.detect_events(z, 2.0, "+", 2)
    assert pos.tolist() == [1, 4, 7] and raw == 4


# ── the projections, checked against the run itself (plan §2) ───────────────

def projection_problems(native: dict, table: es.EventTable, trace: es.SignalTrace) -> list[str]:
    """Every way the table disagrees with the run it came from (empty when it holds)."""
    errs: list[str] = []
    P = native["provenance"]
    k = len(table)
    if k != P["n_events"]:
        errs.append(f"k {k} != n_events {P['n_events']}")
    if table.n_unlabeled != P["n_unlabeled"]:
        errs.append(f"n_unlabeled {table.n_unlabeled} != {P['n_unlabeled']}")
    n_sess = len(table.sessions)
    for a in (trace.evaluable, trace.trigger, trace.holds):
        if len(a) != n_sess:
            errs.append("a trace array is not one value per session")
    if k and not (trace.trigger[table.event_idx].all() and trace.holds[table.event_idx].all()
                  and trace.evaluable[table.event_idx].all()):
        errs.append("an event is not a firing, evaluable session")
    if k and np.any(np.diff(table.event_idx) <= 0):
        errs.append("the table is not ascending")
    for H in native["horizons"]:
        h = H["h"]
        v = table.value[h]
        f = v[np.isfinite(v)]
        n = len(f)
        up_n = int((f > 0).sum())
        if n != H["n"] or k - n != H["n_incomplete"]:
            errs.append(f"h {h}: n {n}/{k - n} != {H['n']}/{H['n_incomplete']}")
        if n > 0:
            if up_n / n != H["hit_rate"]:
                errs.append(f"h {h}: up_n/n {up_n}/{n} != hit_rate {H['hit_rate']}")
            if float(np.median(f)) != H["median"]:
                errs.append(f"h {h}: median {np.median(f)} != {H['median']}")
            worst, best = f[int(np.argmin(f))], f[int(np.argmax(f))]
            if not worst <= H["median"] <= best:
                errs.append(f"h {h}: extrema {worst}..{best} do not bracket the median")
        elif H["hit_rate"] is not None or H["median"] is not None or up_n:
            errs.append(f"h {h}: no completed outcome but statistics served")
        complete = table.exit_idx[h] >= 0
        if not np.array_equal(complete, np.isfinite(v)) or not np.array_equal(table.exit_idx[h][complete], table.entry_idx[complete] + h):
            errs.append(f"h {h}: exit_idx disagrees with value")
    recent = []
    for i in range(k - 1, max(-1, k - 11), -1):
        e, zi = int(table.event_idx[i]), None
        if trace.z is not None and not np.isnan(trace.z[e]):
            zi = round(float(trace.z[e]), 2)
        recent.append({
            "date": table.sessions[e], "z": zi, "regime": table.regime[i],
            "entry_date": table.sessions[int(table.entry_idx[i])] if table.entry_idx[i] >= 0 else None,
            "same_session": bool(table.same_session[i]), "entry_delay": int(table.entry_delay[i]),
            "moves": {str(h): (None if np.isnan(table.value[h][i]) else float(table.value[h][i])) for h in es.HORIZONS},
        })
    if recent != native["recent_events"]:
        errs.append("the ten newest rows are not recent_events")
    for row in native["regimes"]:
        if row["regime"] in es.REGIME_LABELS and table.regime.count(row["regime"]) != row["n_events"]:
            errs.append(f"regime {row['regime']}: {table.regime.count(row['regime'])} != {row['n_events']}")
    return errs


def _check_store(store: Path, slugs: tuple[str, ...]) -> dict[str, list[str]]:
    conn = es._connect(store)
    found: dict[str, list[str]] = {}
    try:
        for slug in slugs:
            try:
                native, table, trace = _run_pinned(conn, es.parse_slug(slug), traced=True)
            except es.NotStored:
                continue
            found[slug] = projection_problems(native, table, trace)
    finally:
        conn.close()
    return found


def test_the_projections_hold_on_the_synthetic_store(synth):
    found = _check_store(synth, CATALOG_QUERIES + (ZERO_EVENTS,))
    assert {s for s in CATALOG_QUERIES if s not in TIER2} <= set(found)
    assert {s: e for s, e in found.items() if e} == {}


def test_a_zero_event_study_projects_to_nothing(synth):
    native, table, trace = es.run_traced(es.parse_slug(ZERO_EVENTS), synth, as_of=PINS["as_of"])
    assert len(table) == 0 and native["provenance"]["n_events"] == 0 and native["recent_events"] == []
    assert all(H["n"] == 0 and H["hit_rate"] is None and H["median"] is None for H in native["horizons"])
    assert projection_problems(native, table, trace) == []


published = pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")


@published
def test_the_projections_hold_on_the_published_copy():
    found = _check_store(PUBLISHED, CATALOG_QUERIES)
    assert found, "no catalog study ran on the published copy"
    assert {s: e for s, e in found.items() if e} == {}


@published
def test_a_ready_but_insufficient_study_projects_without_an_interval():
    """hy-2sigma-20d: HY OAS daily only since 2023, so n is small and there are
    fewer than five blocks: statistics exist, the interval does not."""
    native, table, trace = es.run_traced(es.parse_slug("hy_oas-w20-z2.0-up-none-spx"), PUBLISHED, as_of=PINS["as_of"])
    H20 = next(H for H in native["horizons"] if H["h"] == 20)
    assert 0 < len(table) < 10 and H20["n_blocks"] < es.MIN_BLOCKS_INTERVAL and H20["ci90"] is None
    assert projection_problems(native, table, trace) == []



def _reads_vix(q) -> bool:
    q = es.validate(q)
    return "vix" in (q.shock, q.target) or q.cond == "vix_above"


def _without_vix_identity(r: dict) -> dict:
    """A run with the VIX's identity (its series id, store, note and the hash that covers them) set aside."""
    out = json.loads(_canonical(r))
    p = out["provenance"]
    p.pop("inputs_hash")
    for m in p["inputs"]:
        if m["key"] == "vix":
            for k in ("series_id", "table", "note"):
                m.pop(k)
    return out


def test_the_vix_move_changes_only_the_series_identity(synth, monkeypatch):
    """desk/fill-compute (owner's item 7): on identical values, every golden
    query that reads the VIX answers the same from ^VIX in asset_prices as
    from VIXCLS in desk_series: events, horizons, baselines, verdict text; only
    the series id, its store, its note and the inputs hash differ."""
    conn = es._connect(synth)
    moved, compared = [], 0
    try:
        for name, spec in _golden()["queries"].items():
            q = es.parse_slug(spec["slug"]) if "slug" in spec else es.Query(**spec["kwargs"])
            if not _reads_vix(q):
                continue
            try:
                now = _without_vix_identity(_run_pinned(conn, q))
            except (es.NotStored, es.StudyError) as exc:
                now = f"{type(exc).__name__}:{exc}"
            with monkeypatch.context() as m:
                m.setitem(registry.BY_KEY, "vix", BASE_VIX)
                try:
                    then = _without_vix_identity(_run_pinned(conn, q))
                except (es.NotStored, es.StudyError) as exc:
                    then = f"{type(exc).__name__}:{exc}"
            compared += 1
            moved.append(name) if now != then else None
            assert isinstance(now, dict) or now == then, name
    finally:
        conn.close()
    assert compared >= 5, compared  # the catalog's VIX spike and the free-form VIX queries
    assert moved == [], f"the VIX's move changed more than its identity: {moved}"
