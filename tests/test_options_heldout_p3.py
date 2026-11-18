"""The Phase 3 freeze and held-out runner (design-P3-approved.md 8.2, 8.5, 10; Max's P3-A21 of 2026-11-18).

freeze_p3: the FD role rule (a refusal is not agreement), the sizes and caps, the controls' sizes and the E-strata's
proposal counts, the hash check, and the seed refusal. heldout_p3: the population is the freeze's and nothing else
(seed order, controls taken from it by inputs alone, a fixed interleaved order), the refusals before any work, the
resumable results, and the CPU meter (clean and stopped sessions, the stop before the cap). One end-to-end run on a
test seed exercises every job kind, the Phase 2 rows, resume and the report. No held-out seed is used here.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from scripts.options_bench import cases
from scripts.options_bench import controls_p3 as C
from scripts.options_bench import freeze_p3 as F
from scripts.options_bench import heldout_p3 as H
from scripts.options_bench import regions_p3 as RG
from scripts.options_bench import report_p3 as R
from scripts.options_bench import run_p3
from src.desk import options_greeks as G

TEST_SEED = 4242      # test-only; never a registered or held-out seed


def wide_regions() -> dict:
    s = RG.Support(ks_call=(0.05, 20.0), ks_put=(0.05, 20.0), rho=(-0.75, 0.75), q=(-0.1, 0.1), n_divs_max=64,
                   pv_over_s_max=0.9)
    return RG.Regions(s, {}, (RG.Carve("sigma < 0.01", "sigma", "<", 0.01),)).to_json()


def tiny_freeze(**over) -> dict:
    fr = {"held_out": {"seed": TEST_SEED, "sizes": {"G0-exempt": 1, "X1-outside": 1}, "named": False},
          "used_seeds": list(F.USED_SEEDS), "config": {"f_p": 2.0}, "regions": wide_regions(),
          "targeted": {G.GAMMA: ["G0-exempt"]}, "cross_check_required": [],
          "controls": {"c2": {"G0-exempt": {"base": 1, "dividend": 0}},
                       "e_strata": {"G0-exempt": {"proposals": 6, "base": 1, "dividend": 0}}},
          "repeat_every": 50,
          "cpu": {"cap_hours": 130.0, "stop_margin_hours": 0.05, "no_submit_margin_hours": 0.5, "sample_seconds": 1.0},
          "workers": 2, "files_sha256": F.file_hashes()}
    fr.update(over)
    return fr


# ── freeze_p3 ───────────────────────────────────────────────────────────────

def _role_rows():
    rec = lambda i, g: {"case": cases.case(F.DEV_SEED, g, i).to_json()}
    recs = {f"G1-nodiv/{i}": rec(i, "G1-nodiv") for i in range(200)}
    rows = []
    for i in range(200):
        r = {"id": f"G1-nodiv/{i}", "group": "G1-nodiv", "ref": {"status": "resolved", "R": 1.0, "u": 0.0001, "tol": 0.01},
             "v1": 1.0, "v2": 1.0}
        rows.append(r)
    return rows, recs


def test_the_fd_role_rule_counts_a_refusal_as_not_agreeing():
    rows, recs = _role_rows()
    reg = RG.Regions(RG.Support((0.05, 20), (0.05, 20), (-1, 1), (-1, 1), 64, 0.9))
    assert F.fd_role_rule(rows, recs, reg)["holds"]
    rows[0] = {**rows[0], "refused": "work cap"}
    rows[0].pop("v2")
    rows[1] = {**rows[1], "refused": "work cap"}
    rows[1].pop("v2")
    rows[2] = {**rows[2], "refused": "work cap"}
    rows[2].pop("v2")
    got = F.fd_role_rule(rows, recs, reg)
    assert got["groups"]["G1-nodiv"]["refused"] == 3 and got["groups"]["G1-nodiv"]["share"] == 197 / 200
    assert not got["holds"]                                   # 98.5% < 99%


def test_the_fd_role_rule_fails_on_any_confirmed_failure_and_skips_inputs_outside_omega_x():
    rows, recs = _role_rows()
    rows[5] = {**rows[5], "v2": 1.0 + 0.02}                   # |V − R| > tol + u: a confirmed failure
    reg = RG.Regions(RG.Support((0.05, 20), (0.05, 20), (-1, 1), (-1, 1), 64, 0.9))
    got = F.fd_role_rule(rows, recs, reg)
    assert got["groups"]["G1-nodiv"]["failures"] == ["G1-nodiv/5"] and not got["holds"]
    sigma5 = cases.Case.from_json(recs["G1-nodiv/5"]["case"]).sigma
    carved = RG.Regions(reg.support, {}, (RG.Carve("x", "sigma", "==", sigma5),))
    assert F.fd_role_rule(rows, recs, carved)["holds"]       # the carve-out removes it from Ω_X


def test_sizes_follow_8_2_with_each_group_s_cap():
    rt = {"G1-nodiv": {G.GAMMA: (100, 0.5), G.DIVIDEND: (0, 0.0)},
          "G6-long": {G.DIVIDEND: (80, 0.1)},
          "G3-carry-itm": {G.DIVIDEND: (40, 0.1), G.GAMMA: (100, 0.0)}}
    got = F.plan_sizes(rt)
    assert got["pairs"]["gamma|G1-nodiv"]["n"] == 750 and got["groups"]["G1-nodiv"] == 750
    assert got["pairs"]["dividend|G1-nodiv"]["standing"] == "not applicable"
    # 300/(0.8·0.1) = 3,750 > 3,500 (G6) and > 2,500 (G3): both are the owner's decision, never left untargeted
    assert got["pairs"]["dividend|G6-long"]["standing"] == "decision needed"
    assert got["pairs"]["dividend|G3-carry-itm"]["standing"] == "decision needed"
    assert got["pairs"]["gamma|G3-carry-itm"]["standing"] == "not targeted"
    assert set(got["decisions"]) == {"dividend|G6-long", "dividend|G3-carry-itm", "gamma|G3-carry-itm"}
    assert F.plan_sizes({"G6-long": {G.DIVIDEND: (80, 0.11)}})["groups"]["G6-long"] == 3410


def test_control_sizes_give_each_quantity_300_scored_at_80_percent_of_its_dev_rate():
    rows = []
    for i in range(100):
        st = {k: "scored" for k in ("price", "gamma", "vega", "rho")}
        st["theta"] = "scored" if i < 92 else "unresolved: x"
        st["dividend"] = ("scored" if i % 2 == 0 else "unresolved: not applicable: no dividend owed")
        rows.append({"stage": "c2_fd", "key": f"c2_fd|G3-carry-itm/{i}", "status": st, "error": None})
    got = F.control_sizes(rows)["c2_fd|G3-carry-itm"]
    assert got["base"] == 408                              # theta: ceil(300 / (0.8·0.92))
    assert got["dividend_applicable"] == 50 and got["dividend"] == 375


def test_e_strata_proposals_follow_dr_15():
    acc = {"proposals": 1000, "kept": 250, "kept_with_dividends": 25}
    got = F.e_plan(388, 375, acc)
    assert got["proposals"] == max(RG.stratum_proposals(388, 0.25), RG.stratum_proposals(375, 0.025)) == 30000
    assert F.e_plan(300, 0, acc)["proposals"] == 2400


def test_the_freeze_check_names_every_changed_file(tmp_path):
    fr = {"files_sha256": F.file_hashes()}
    assert F.check_freeze(fr) == []
    fr["files_sha256"]["scripts/options_bench/score_p3.py"] = "0" * 64
    fr["files_sha256"]["scripts/options_bench/not_a_file.py"] = "0" * 64
    assert F.check_freeze(fr) == ["scripts/options_bench/not_a_file.py", "scripts/options_bench/score_p3.py"]
    assert "scripts/options_bench/heldout_p3.py" in fr["files_sha256"]
    assert "tests/fixtures/options_pre_phase3/options_adaptive_2ff3e8b.py" in fr["files_sha256"]


def test_the_freeze_refuses_a_registered_seed(tmp_path):
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"sizes": {"groups": {}}, "regions": {}, "targeted": {}, "rates": {}, "controls": {}}))
    cfg = tmp_path / "cfg.json"
    cfg.write_text("{}")
    for seed in F.USED_SEEDS:
        with pytest.raises(SystemExit, match="registered"):
            F.main(["freeze", "--plan", str(plan), "--config", str(cfg), "--seed", str(seed), "--seed-note", "x",
                    "--out", str(tmp_path / "f.json")])


def test_the_cross_check_factor_is_a_config_key():
    assert run_p3.x_config({"f_p": 2.0, "h_r": 1e-4}).f_p == 2.0
    assert run_p3.x_config(None) == run_p3.oa.XConfig()
    run_p3.greek_config({"f_p": 2.0, "smooth_divs": True})   # neither is a GreekConfig key, and neither raises


# ── heldout_p3: the population ───────────────────────────────────────────────

def test_the_population_is_the_freeze_s_in_seed_order_with_controls_chosen_by_inputs():
    fr = tiny_freeze(held_out={"seed": TEST_SEED, "sizes": {"G3-carry-itm": 30, "X1-outside": 2}, "named": True},
                     controls={"c2": {"G3-carry-itm": {"base": 10, "dividend": 12}},
                               "e_strata": {"E-div": {"proposals": 4000, "base": 5, "dividend": 8}}})
    jobs, short = H.population(fr)
    again, _ = H.population(fr)
    assert [j["key"] for j in jobs] == [j["key"] for j in again]
    drawn = [cases.Case.from_json(j["case"]) for j in jobs if j["key"].startswith("case|G3")]
    assert [c.to_json() for c in sorted(drawn, key=lambda c: int(c.id.split("/")[1]))] == \
        [c.to_json() for c in RG.held_out(TEST_SEED, {"G3-carry-itm": 30})]
    assert {j["case"]["id"] for j in jobs if j["key"].startswith("case|named/")} == {c.id for c in cases.NAMED}
    base = [j for j in jobs if j["key"].startswith("c2_fd|")]
    assert sorted(int(j["case"]["id"].split("/")[1]) for j in base) == list(range(10))
    div = [j for j in jobs if j["key"].startswith("c2_fd_div|")]
    assert all(j["case"]["divs"] and int(j["case"]["id"].split("/")[1]) >= 10 for j in div)
    assert all(j["quantities"] == [G.DIVIDEND] for j in div)
    with_div = [c for c in RG.held_out(TEST_SEED, {"G3-carry-itm": 30}) if c.divs]
    in_base = sum(1 for c in with_div[:12] if int(c.id.split("/")[1]) < 10)
    assert len(div) == min(12, len(with_div)) - in_base
    kept = C.e_population(TEST_SEED, "E-div", 4000)
    assert sorted(j["case"]["id"] for j in jobs if j["key"].startswith("e|")) == sorted(c.id for c in kept[:5])
    assert ("c2|G3-carry-itm|dividend" in short) == (len(with_div) < 12)


def test_the_population_reports_a_sample_not_reached_and_never_draws_more():
    fr = tiny_freeze(held_out={"seed": TEST_SEED, "sizes": {"G1-nodiv": 3}, "named": False},
                     controls={"c2": {"G1-nodiv": {"base": 5, "dividend": 0}},
                               "e_strata": {"E-vol": {"proposals": 10, "base": 50, "dividend": 0}}})
    jobs, short = H.population(fr)
    assert short["c2|G1-nodiv|base"] == {"needed": 5, "available": 3}
    assert short["e|E-vol|base"]["needed"] == 50 and short["e|E-vol|base"]["available"] <= 10
    assert sum(1 for j in jobs if j["key"].startswith("case|")) == 3


def test_the_order_interleaves_every_stream_by_its_fraction():
    fr = tiny_freeze(held_out={"seed": TEST_SEED, "sizes": {"G0-exempt": 40, "G1-nodiv": 4}, "named": False},
                     controls={"c2": {}, "e_strata": {}})
    jobs, _ = H.population(fr)
    first = [j["key"] for j in jobs[:12]]
    assert sum(k.startswith("case|G1") for k in first) == 1   # 1 of 4 G1 cases in the first 10 of 40 G0 ones
    assert H.fingerprint(jobs) != H.fingerprint(H.population(tiny_freeze(
        held_out={"seed": TEST_SEED + 1, "sizes": {"G0-exempt": 40, "G1-nodiv": 4}, "named": False},
        controls={"c2": {}, "e_strata": {}}))[0])


# ── heldout_p3: refusals, results, meter ────────────────────────────────────

@pytest.fixture
def clean_git(monkeypatch):
    monkeypatch.setattr(H, "git_state", lambda: {"head": "f" * 40, "tracked_changes": ""})


def test_preflight_refuses_changed_files_used_seeds_tracked_changes_and_foreign_runs(tmp_path, monkeypatch, clean_git):
    fp = tmp_path / "freeze.json"
    fr = tiny_freeze()
    fp.write_text(json.dumps(fr))
    jobs, _ = H.population(fr)
    H.preflight(fr, fp, tmp_path / "out", jobs)
    bad = tiny_freeze()
    bad["files_sha256"] = {**bad["files_sha256"], "scripts/options_bench/score_p3.py": "0" * 64}
    with pytest.raises(SystemExit, match="differ from the freeze"):
        H.preflight(bad, fp, tmp_path / "out", jobs)
    for seed in (F.DEV_SEED, 20261117):
        with pytest.raises(SystemExit, match="registered seed"):
            H.preflight(tiny_freeze(held_out={**fr["held_out"], "seed": seed}), fp, tmp_path / "out", jobs)
    monkeypatch.setattr(H, "git_state", lambda: {"head": "f" * 40, "tracked_changes": " M src/desk/options_fd.py"})
    with pytest.raises(SystemExit, match="tracked changes"):
        H.preflight(fr, fp, tmp_path / "out", jobs)
    monkeypatch.setattr(H, "git_state", lambda: {"head": "f" * 40, "tracked_changes": ""})
    out = tmp_path / "run"
    out.mkdir()
    (out / H.RESULTS).write_text('{"key": "x"}\n')
    with pytest.raises(SystemExit, match="no manifest"):
        H.preflight(fr, fp, out, jobs)
    (out / H.RESULTS).unlink()
    (out / H.MANIFEST).write_text(json.dumps({**H.preflight(fr, fp, out, jobs), "population_sha256": "0"}))
    with pytest.raises(SystemExit, match="population_sha256"):
        H.preflight(fr, fp, out, jobs)


def test_results_drop_only_a_partial_last_line(tmp_path):
    p = tmp_path / "r.jsonl"
    p.write_text('{"key": "a"}\n{"key": "b"}\n{"key": "c", "tru')
    assert [r["key"] for r in H.read_results(p)] == ["a", "b"]
    assert p.read_text() == '{"key": "a"}\n{"key": "b"}\n'
    p.write_text('{"key": "a"}\n{"ke\n{"key": "b"}\n')
    with pytest.raises(SystemExit, match="damaged line 2"):
        H.read_results(p)


def test_the_meter_counts_every_session_and_surcharges_one_that_stopped_without_an_end(tmp_path):
    m = tmp_path / H.METER
    rows = [{"session": "a", "kind": "start", "wall_s": 0, "cpu_s": 1.0, "workers": 4},
            {"session": "a", "kind": "sample", "wall_s": 100, "cpu_s": 380.0, "workers": 4},
            {"session": "a", "kind": "end", "wall_s": 101, "cpu_s": 400.5, "workers": 4, "why": "finished"},
            {"session": "b", "kind": "start", "wall_s": 0, "cpu_s": 0.5, "workers": 4},
            {"session": "b", "kind": "sample", "wall_s": 60, "cpu_s": 230.0, "workers": 4}]
    m.write_text("".join(json.dumps(r) + "\n" for r in rows) + '{"session": "b", "kind": "sam')
    total, sessions = H.prior_cpu(m, 4, 15.0)
    assert total == pytest.approx(400.5 + 230.0 + 4 * 15.0)
    assert {s["session"]: s["end"] for s in sessions} == {"a": True, "b": False}
    assert H.proc_cpu(os.getpid()) >= 0.0 and H.proc_cpu(2 ** 22 + 12345) is None


def test_a_run_at_its_cap_submits_nothing(tmp_path, clean_git):
    fp = tmp_path / "freeze.json"
    fr = tiny_freeze(cpu={"cap_hours": 1.0, "stop_margin_hours": 0.05, "no_submit_margin_hours": 0.5,
                          "sample_seconds": 1.0})
    fp.write_text(json.dumps(fr))
    out = tmp_path / "run"
    out.mkdir()
    (out / H.METER).write_text(json.dumps({"session": "a", "kind": "end", "wall_s": 9, "cpu_s": 0.6 * 3600,
                                           "workers": 2}) + "\n")
    assert H.main(["--freeze", str(fp), "--out", str(out)]) == 3
    assert not (out / H.RESULTS).exists() or not (out / H.RESULTS).read_text()


def test_end_to_end_on_a_test_seed_every_job_kind_resume_and_the_report(tmp_path, clean_git):
    fp = tmp_path / "freeze.json"
    fr = tiny_freeze()
    fp.write_text(json.dumps(fr))
    out = tmp_path / "run"
    assert H.main(["--freeze", str(fp), "--out", str(out)]) == 0
    res = H.read_results(out / H.RESULTS)
    jobs, _ = H.population(fr)
    assert sorted(r["key"] for r in res) == sorted(j["key"] for j in jobs)
    assert not [r for r in res if "error" in r]
    by = {r["key"]: r for r in res}
    g0 = by["case|G0-exempt/0"]["rec"]
    assert g0["phase2_rows"]["answer_json_identical"] and g0["phase2_rows"]["full_identical"]
    assert g0["phase2_rows"]["old_version"] == "adaptive-p2.1" and g0["repeat_identical"] is True
    assert "refs" in g0 and "delta_ref" in g0 and g0["case"]["id"] == "G0-exempt/0"
    assert "c2" in by["c2_fd|G0-exempt/0"] and "c2" in by["c2_q|G0-exempt/0"]
    e = [r for r in res if r["kind"] == "e"]
    assert len(e) == 1 and "c1" in e[0] and "c2" in e[0]
    meter = [json.loads(x) for x in (out / H.METER).read_text().splitlines()]
    assert meter[0]["kind"] == "start" and meter[-1]["kind"] == "end" and meter[-1]["why"] == "finished"
    assert meter[-1]["cpu_s"] >= sum(r["cpu_s"] for r in res) * 0.9
    man = json.loads((out / H.MANIFEST).read_text())
    assert man["seed"] == TEST_SEED and man["sessions"][0]["why"] == "finished"
    # resume: nothing left to run, a second session recorded, the results untouched
    before = (out / H.RESULTS).read_text()
    assert H.main(["--freeze", str(fp), "--out", str(out)]) == 0
    assert (out / H.RESULTS).read_text() == before
    assert len(json.loads((out / H.MANIFEST).read_text())["sessions"]) == 2
    rep = R.report(fr, out)
    assert rep["complete"] and rep["finished"] == len(jobs)
    assert rep["rows"]["X1"] == "pass" and rep["rows"]["Phase 2 rows: Tier 2 bit-identical to adaptive-p2.1"] == "pass"
    assert rep["rows"]["pair gamma|G0-exempt"] == "not established"      # one context: fewer than 300 scored
    assert rep["by_the_frozen_rules"] == "not accepted by the frozen rules"
    assert rep["c2"]["c2_fd"]["G0-exempt"]["quantities"]["dividend"]["verdict"] == "not applicable"
    assert rep["cpu"]["total_cpu_hours"] > 0


def test_a_foreign_result_is_refused_on_resume(tmp_path, clean_git):
    fp = tmp_path / "freeze.json"
    fr = tiny_freeze(controls={"c2": {}, "e_strata": {}}, held_out={"seed": TEST_SEED, "sizes": {"X1-outside": 1},
                                                                  "named": False})
    fp.write_text(json.dumps(fr))
    out = tmp_path / "run"
    assert H.main(["--freeze", str(fp), "--out", str(out)]) == 0
    other = cases.case(TEST_SEED + 1, "X1-outside", 0).to_json()
    lines = (out / H.RESULTS).read_text().splitlines()
    r = json.loads(lines[0])
    r["rec"]["case"] = other
    (out / H.RESULTS).write_text(json.dumps(r) + "\n")
    with pytest.raises(SystemExit, match="not jobs of this population"):
        H.main(["--freeze", str(fp), "--out", str(out)])


def test_report_marks_a_short_control_and_a_partial_run():
    assert R.is_short({"c2|G5-extreme-vol|dividend": {}}, "c2_fd", "G5-extreme-vol", G.DIVIDEND)
    assert not R.is_short({"c2|G5-extreme-vol|dividend": {}}, "c2_fd", "G5-extreme-vol", G.GAMMA)
    assert R.is_short({"e|E-vol|base": {}}, "c2_lattice", "E-vol", G.GAMMA)
    assert not R.is_short({"e|E-vol|base": {}}, "c2_fd", "E-vol", G.GAMMA)
