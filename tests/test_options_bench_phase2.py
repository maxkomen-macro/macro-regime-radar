"""The Phase 2 bench components (adaptive Phase 2, build step 4): the tightened reference, the verdict protocol,
the Tier 2 runner and its freeze check, calibration's selection and sizing, and the Phase 2 scorer. The merged
bench's own components must score the baseline exactly as before."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest

from scripts.options_bench import adaptive, calibrate, cases, phase2, reference, score, score2
from src.desk import options_adaptive as oa
from src.desk import options_engine as oe

REPO = Path(__file__).resolve().parent.parent
FIX = REPO / "tests" / "fixtures"
STORED = [json.loads(l) for l in (FIX / "options_bench_stored_records.jsonl").read_text().splitlines()]


def stored(cid: str) -> dict:
    return copy.deepcopy(next(r for r in STORED if r["case"]["id"] == cid))


# ── the merged bench is unchanged ────────────────────────────────────────────

def test_the_merged_scorer_classifies_the_stored_records_as_before():
    want = json.loads((FIX / "options_bench_classify_expected.json").read_text())["expected"]
    got = [score.classify(r) for r in STORED]
    assert json.loads(json.dumps(got, sort_keys=True)) == json.loads(json.dumps(want, sort_keys=True))


@pytest.mark.parametrize("cid", ["G1-nodiv/0", "G5-extreme-vol/2"])
def test_the_standard_reference_reproduces_the_stored_run_bit_for_bit(cid):
    rec = stored(cid)
    from scripts.options_bench import run
    r = reference.reference(cases.Case.from_json(rec["case"]))
    assert run._pack(r["value"]) == rec["ref"]["value"] and run._pack(r["delta"]) == rec["ref"]["delta"]


def test_a_tightened_reference_reads_its_uncertainty_against_its_own_target():
    c = cases.Case.from_json(stored("G1-nodiv/0")["case"])
    r0 = reference.reference(c, escalate=False)
    tight = reference.reference(c, escalate=False, limits={"value": r0["value"]["u"] / 2})
    assert tight["value"]["ref"] == r0["value"]["ref"] and tight["value"]["u"] == r0["value"]["u"]
    assert tight["value"]["limit"] == r0["value"]["u"] / 2
    assert "uncertainty above its target" in tight["value"]["status"]
    assert tight["delta"]["status"] == r0["delta"]["status"]   # a quantity left out keeps the standard limit


# ── the verdict protocol (design 9.3) ────────────────────────────────────────

R0 = {"ref": 10.0, "u": 0.001, "status": "reliable"}


def test_verdict_covered_confirmed_and_straddle():
    assert adaptive.judge(10.004, 0.01, R0)["verdict"] == adaptive.COVERED
    assert adaptive.judge(10.02, 0.01, R0)["verdict"] == adaptive.CONFIRMED
    j = adaptive.judge(10.0095, 0.01, R0)
    assert j["verdict"] == adaptive.STRADDLE and j["needs_r1"]
    assert adaptive.judge(10.0, 0.01, dict(R0, status="unresolved: x"))["verdict"] == adaptive.NO_REF


def test_r1_is_judged_in_the_protocol_order():
    v, es = 10.0095, 0.01
    # 1. inconsistent with R0 counts against the engine, whatever R1's own status
    bad = {"ref": 10.003, "u": 0.0001, "status": "unresolved: value boundary not settled"}
    j = adaptive.judge(v, es, R0, bad)
    assert (j["verdict"], j["why"]) == (adaptive.UNRESOLVED, "reference inconsistent")
    # 2. an unreliable R1 never yields covered or confirmed
    flagged = {"ref": 10.0001, "u": 0.0001, "status": "unresolved: value boundary not settled"}
    assert adaptive.judge(v, es, R0, flagged)["verdict"] == adaptive.UNSCORED
    # 3. covered or confirmed against R1
    assert adaptive.judge(v, es, R0, {"ref": 10.0004, "u": 0.0001, "status": "reliable"})["verdict"] == adaptive.COVERED
    assert adaptive.judge(v, es, R0, {"ref": 9.9993, "u": 0.0001, "status": "reliable"})["verdict"] == adaptive.CONFIRMED
    # 4. a precise straddle is unresolved and counted
    j = adaptive.judge(v, es, R0, {"ref": 9.99951, "u": 0.0001, "status": "reliable"})
    assert (j["verdict"], j["why"]) == (adaptive.UNRESOLVED, "precise straddle")


def test_r1_that_misses_its_floor_target_still_judges_a_coarser_estimate():
    # calibration aims R1 at the finest straddling estimate; a candidate with a larger estimate needs less
    r1 = {"ref": 10.0, "u": 0.0005, "status": "unresolved: value uncertainty above its target 0.0001"}
    assert adaptive.r1_reliable(r1, 0.01) and not adaptive.r1_reliable(r1, 0.001)
    r1b = dict(r1, status="unresolved: value uncertainty above its target 0.0001; value boundary not settled")
    assert not adaptive.r1_reliable(r1b, 0.01)


def test_analytic_lower_end_is_covered_by_the_theorem_not_by_the_reference():
    # A equal to L (no early-exercise value): the midpoint's error is exactly h, which no reference can show
    lo, hi = 1.0, 1.02
    mid, h = lo + (hi - lo) / 2, (hi - lo) / 2
    r0 = {"ref": 1.0, "u": 1e-4, "status": "reliable"}
    j = adaptive.judge(mid, h, r0, interval=(lo, hi))
    assert (j["verdict"], j["why"]) == (adaptive.COVERED, "lower end by theorem")
    assert adaptive.judge(mid, h, r0)["verdict"] == adaptive.STRADDLE         # without the theorem: a straddle
    # the upper end is the certified bound: a straddle there still needs R1
    assert adaptive.judge(mid, h, dict(r0, ref=1.02), interval=(lo, hi))["verdict"] == adaptive.STRADDLE
    # a reference below L by more than u contradicts the theorem: never covered
    assert adaptive.judge(mid, h, dict(r0, ref=0.9997), interval=(lo, hi))["verdict"] == adaptive.CONFIRMED


def test_accuracy_rows_score_conservatively():
    assert adaptive.judge_tol(10.004, 0.01, R0) == "pass"
    assert adaptive.judge_tol(10.02, 0.01, R0) == "fail"
    assert adaptive.judge_tol(10.0095, 0.01, R0) == "indeterminate"
    assert adaptive.judge_tol(10.0095, 0.01, R0, {"ref": 10.0004, "u": 1e-4, "status": "reliable"}) == "pass"
    # an R1 inconsistent with R0 settles nothing
    assert adaptive.judge_tol(10.0095, 0.01, R0, {"ref": 10.005, "u": 1e-4, "status": "reliable"}) == "indeterminate"
    assert adaptive.judge_tol(10.0, 0.01, dict(R0, status="unresolved: x")) == "unscored"


# ── the runner ───────────────────────────────────────────────────────────────

def freeze_now(tmp_path: Path, **cfg) -> Path:
    fz = {"phase": "test", "config": adaptive.config_json(oa.Config(**cfg)), "files_sha256": phase2.file_hashes(),
          "held_out": {"seed": 1, "per_group": {}}}
    p = tmp_path / "freeze.json"
    p.write_text(json.dumps(fz))
    return p


def test_the_freeze_check_names_every_changed_or_missing_file(tmp_path):
    fz = json.loads(freeze_now(tmp_path).read_text())
    assert phase2.check_freeze(fz) == []
    fz["files_sha256"]["src/desk/options_adaptive.py"] = "0" * 64
    del fz["files_sha256"]["scripts/options_bench/score2.py"]
    assert phase2.check_freeze(fz) == ["scripts/options_bench/score2.py", "src/desk/options_adaptive.py"]
    assert "src/desk/options_math.py" in phase2.frozen_paths() and "scripts/options_bench/phase2.py" in phase2.frozen_paths()


def test_runner_refuses_a_changed_file_and_a_reference_run_that_is_not_the_held_out_seed(tmp_path):
    p = freeze_now(tmp_path)
    fz = json.loads(p.read_text())
    fz["files_sha256"]["src/desk/options_adaptive.py"] = "0" * 64
    p.write_text(json.dumps(fz))
    with pytest.raises(SystemExit, match="differ from the freeze"):
        phase2.main(["--refs", str(tmp_path), "--freeze", str(p), "--out", str(tmp_path / "o")])
    refs = tmp_path / "refs"
    refs.mkdir()
    (refs / "results-0of1.jsonl").write_text(json.dumps(stored("G1-nodiv/0")) + "\n")
    (refs / "manifest-0of1.json").write_text(json.dumps(manifest(20261026, {"G1-nodiv": 1})))
    p = freeze_now(tmp_path)
    with pytest.raises(SystemExit, match="held-out run"):
        phase2.main(["--refs", str(refs), "--freeze", str(p), "--out", str(tmp_path / "o"), "--held-out"])


def manifest(seed, per_group, shard="0/1", finished=True):
    full = {g: 0 for g in cases.GROUPS} | per_group
    return {"seed": seed, "per_group": full, "named": False, "shard": shard} | ({"finished_utc": "x"} if finished else {})


def test_the_reference_population_is_the_regenerated_case_list_not_the_records_received():
    rec = stored("G1-nodiv/0")
    pop = phase2.refs_population([rec], [manifest(20261026, {"G1-nodiv": 1})])
    assert pop["complete"] and pop["expected_ids"] == ["G1-nodiv/0"]
    # S-2: 2,400 cases frozen, one received, only shard 0/2 present
    pop = phase2.refs_population([rec], [manifest(20261026, {"G1-nodiv": 2400}, shard="0/2")])
    assert not pop["complete"] and pop["missing"] == 2399 and pop["missing_shards"] == ["1/2"]
    pop = phase2.refs_population([rec, rec], [manifest(20261026, {"G1-nodiv": 1})])
    assert not pop["complete"] and pop["duplicates"] == 1
    assert not phase2.refs_population([rec], [manifest(20261026, {"G1-nodiv": 1}, finished=False)])["complete"]
    fz = {"held_out": {"seed": 20261026, "per_group": manifest(1, {"G1-nodiv": 1})["per_group"], "named": False}}
    assert phase2.held_out_mismatch(phase2.refs_population([rec], [manifest(20261026, {"G1-nodiv": 1})]), fz) is None
    assert "incomplete" in phase2.held_out_mismatch(
        phase2.refs_population([rec], [manifest(20261026, {"G1-nodiv": 2400}, shard="0/2")]), fz)


def test_calibration_refuses_other_seeds_and_code_changed_since_pricing(tmp_path, monkeypatch):
    refs = tmp_path / "refs"
    refs.mkdir()
    rec = stored("G1-nodiv/0")
    (refs / "results-0of1.jsonl").write_text(json.dumps(rec) + "\n")
    (refs / "manifest-0of1.json").write_text(json.dumps(manifest(7, {"G1-nodiv": 1})))
    with pytest.raises(SystemExit, match="seed 20261026"):
        calibrate.check_manifest(tmp_path / "cal", refs)
    (refs / "manifest-0of1.json").write_text(json.dumps(manifest(20261026, {"G1-nodiv": 1})))
    out = tmp_path / "cal"
    out.mkdir()
    man = calibrate.check_manifest(out, refs)
    (out / "manifest.json").write_text(json.dumps(man))
    assert calibrate.check_manifest(out, refs) == man
    changed = dict(man["files_sha256"], **{"src/desk/options_adaptive.py": "0" * 64})
    monkeypatch.setattr(phase2, "file_hashes", lambda: changed)
    with pytest.raises(SystemExit, match="other code or references"):
        calibrate.check_manifest(out, refs)


def test_work_prices_tier2_checks_tier1_and_repeats_bit_for_bit():
    cfg = adaptive.config_json(oa.Config())
    for cid in ("G1-nodiv/1", "G2-dividends/3", "named/B8", "named/DR-47", "X1-outside/0"):
        out = phase2.work((stored(cid), cfg, {"repeat": True}))
        assert "error" not in out, out.get("traceback")
        assert out["tier1_matches"] is True and out["repeat_identical"] is True, cid
        t = out["tier2"]
        if t["value"] is not None and t["route"] in (oe.ROUTE_LATTICE, oe.ROUTE_ANALYTIC):
            assert out["inside_interval"] is True
            assert out["price_verdict"]["verdict"] in adaptive.POPULATIONS
        assert set(out["sweep"]) == {"0.5", "0.25", "0.1"}
    out = phase2.work((stored("G2-dividends/3"), cfg, {"repeat": False}))
    assert ("divsens" in out) == ("divsens" in stored("G2-dividends/3"))


def test_calibration_candidates_are_the_live_controllers_answers():
    rec = stored("G4-negrate/0")
    out = calibrate.work(rec)
    assert "error" not in out and out["price_independent_of_fd"]
    c = cases.Case.from_json(rec["case"])
    for est, sched, f, fd in (("envelope", "hybrid", 2.0, 2.0), ("fitted", "multiples", 2.5, 3.0)):
        live = adaptive.run(c, oa.Config(estimator=est, schedule=sched, F=f, F_d=fd))
        row = calibrate.row(out, est, sched, f, fd)
        assert all(row[k] == live[k] for k in ("route", "price_status", "value", "estimate", "delta", "delta_estimate",
                                               "units"))


# ── selection and sizing ─────────────────────────────────────────────────────

def test_sizes_follow_the_frozen_rule():
    rates = {g: {"r_p": 0.6, "r_e": 0.6, "r_d": 0.4} for g in calibrate.RANDOM}
    sz = calibrate.sizes(rates)
    assert not sz["cannot_be_sized"]
    n = sz["per_group"]["G1-nodiv"]
    assert n % 100 == 0 and n >= 2400
    assert calibrate._meets(n, 0.6, 1000) and calibrate._meets(n, 0.4, 300)
    agg = lambda k: sum(sz["per_group"][g] * rates[g][k] for g in rates) - 4 * math.sqrt(
        sum(sz["per_group"][g] * rates[g][k] * (1 - rates[g][k]) for g in rates))
    assert agg("r_p") >= 10_000 and agg("r_e") >= 10_000
    # the smallest such size: 100 fewer per group misses the aggregate (the per-group counts are met at 2,400)
    assert calibrate._meets(2400, 0.6, 1000) and calibrate._meets(2400, 0.4, 300)
    m = n - 100
    assert 6 * m * 0.6 - 4 * math.sqrt(6 * m * 0.6 * 0.4) < 10_000
    low = dict(rates, **{"G5-extreme-vol": {"r_p": 0.1, "r_e": 0.1, "r_d": 0.1}})
    assert calibrate.sizes(low)["cannot_be_sized"] == {"G5-extreme-vol": "more than 8000 cases"}
    zero = dict(rates, **{"G3-carry-itm": {"r_p": 0.5, "r_e": 0.5, "r_d": 0.0}})
    assert calibrate.sizes(zero)["cannot_be_sized"] == {"G3-carry-itm": "a zero rate"}


def _row(verdict, err, u, E, tol=0.01, route=oe.ROUTE_LATTICE, status=oe.ESTIMATED):
    return ("x", {"route": route, "price_status": status, "E": E, "tol": tol,
                  "pv": {"verdict": verdict, "err": err, "u": u}})


def test_price_selection_needs_no_failure_and_headroom_above_the_floor():
    rows = [_row(adaptive.COVERED, 0.004, 1e-4, 0.0025)]          # needed (0.004 − 1e-4)/0.0025 = 1.56 <= 2/1.25
    assert calibrate._price_check(rows, 2.0)["pass"]
    rows = [_row(adaptive.COVERED, 0.0045, 1e-4, 0.0025)]          # needed 1.76 > 1.6
    assert not calibrate._price_check(rows, 2.0)["pass"] and calibrate._price_check(rows, 2.5)["pass"]
    rows = [_row(adaptive.COVERED, 0.0045, 1e-4, 1e-4)]            # F·E below the floor: the floor sets it
    assert calibrate._price_check(rows, 2.0)["pass"]
    for bad in (adaptive.CONFIRMED, adaptive.UNRESOLVED):
        assert not calibrate._price_check([_row(bad, 0.0, 0.0, 1e-4)], 4.0)["pass"]
    assert calibrate._price_check([_row(adaptive.UNSCORED, 0.0, 0.0, 1e-4)], 2.0)["pass"]
    proved = ("x", {"route": oe.ROUTE_LATTICE, "price_status": oe.UNRESOLVED, "proved_exceedance": True})
    assert not calibrate._price_check([proved], 4.0)["pass"]


# ── the Phase 2 scorer ───────────────────────────────────────────────────────

def test_populations_and_the_three_limits():
    rows = ([{"price_pop": adaptive.COVERED}] * 600 + [{"price_pop": adaptive.UNSCORED}] * 3
            + [{"price_pop": adaptive.NO_REF}] * 5)
    p = score2.populations(rows, "price_pop")
    assert p["scored"] == 600 and p["exceedances"] == 0
    assert p["limit_conditional"] == pytest.approx(score.clopper_pearson(0, 600)[2])
    assert p["limit_resolved_all"] == pytest.approx(score.clopper_pearson(3, 603)[2])
    assert p["limit_all_accepted"] == pytest.approx(score.clopper_pearson(8, 608)[2])
    assert p["limit_conditional"] < 0.01 < p["limit_all_accepted"]


def test_scorer_classifies_a_runner_record():
    out = phase2.work((stored("G1-nodiv/1"), adaptive.config_json(oa.Config()), {"repeat": True}))
    k = score2.classify(out)
    assert k["tier1_matches"] and k["repeat_identical"] and k["priced"]
    assert k["price_pop"] in adaptive.POPULATIONS and k["band"] == calibrate.band(k["days"])
    broken = dict(out, price_verdict={"verdict": adaptive.STRADDLE, "needs_r1": True})
    assert score2.classify(broken)["price_pop"] == adaptive.UNSCORED   # never a pass


def test_r1_regression_row():
    r = score2.r1_regression()
    assert r["pass"] and r["tier1_value"] == 9.99969863054983 and r["tier2_route"] == oe.ROUTE_ANALYTIC
