"""The Phase 3 scorer's rule table (design-P3-approved.md sections 7.2, 8.3 and 8.4; build step 11)."""

from __future__ import annotations

import json

import pytest

from scripts.options_bench import score_p3 as S
from src.desk import options_adaptive as oa
from src.desk import options_greeks as G

TOL_G = G.tolerance(G.GAMMA, 0.03, 100.0)   # 6e-4


def rec(i=0, group="G1-nodiv", gamma=0.03, est=1e-4, status=G.RETURNED, ref=0.03, u=1e-5, ref_status="resolved",
        divs=(), exact=None, bounds=(), region=None, xc=None, reason=None):
    greeks = {g: {"status": G.WITHHELD, "value": None, "estimate": None, "reason": "estimate above tolerance"}
              for g in G.GREEKS}
    greeks[G.GAMMA] = {"status": status, "value": gamma if status != G.WITHHELD else None, "estimate": est,
                       "reason": reason}
    refs = {G.GAMMA: {"status": ref_status, "R": ref if ref_status == "resolved" else None,
                      "u": u if ref_status == "resolved" else None}}
    return {"case": {"id": f"{group}/{i}", "group": group, "spot": 100.0, "divs": list(divs)}, "greeks": greeks,
            "refs": refs, "exact": dict(exact or {}), "bounds": list(bounds),
            "regions": {G.GAMMA: region}, "cross_check": xc or {"status": oa.XC_NOT_APPLICABLE},
            "tier2": {"value": 7.0}}


@pytest.mark.parametrize("off,want", [(0.0, "pass"), (TOL_G - 1e-5 - 1e-9, "pass"), (TOL_G, "straddle"),
                                      (TOL_G + 1e-5 + 1e-9, "fail")])
def test_pass_straddle_and_fail_against_tol_and_u(off, want):
    assert S.score_greek(rec(gamma=0.03 + off), G.GAMMA)["result"] == want


def test_an_exact_control_takes_precedence_with_no_u():
    s = S.score_greek(rec(gamma=0.0301, exact={G.GAMMA: 0.03}, ref_status="unresolved: x"), G.GAMMA)
    assert s["source"] == "exact (closed form)" and s["u"] == 0.0 and s["result"] == "pass"


def test_an_unresolved_reference_leaves_the_value_returned_unscored_with_its_reason():
    s = S.score_greek(rec(ref_status="unresolved: lattice node gamma near an exercise decision"), G.GAMMA)
    assert s["result"] == "unscored" and "node gamma" in s["reason"]


def test_a_bound_violation_is_a_confirmed_failure():
    s = S.score_greek(rec(bounds=["gamma below 0"]), G.GAMMA)
    assert s["result"] == "fail" and s["bound_violation"] == ["gamma below 0"]


def test_estimator_coverage_is_judged_on_the_stated_estimate():
    assert S.score_greek(rec(gamma=0.0302, est=1e-4), G.GAMMA)["coverage_miss"]
    assert not S.score_greek(rec(gamma=0.0302, est=3e-4), G.GAMMA)["coverage_miss"]


def _pair(n, **kw):
    return S.score_greeks([rec(i, **kw) for i in range(n)], targeted={G.GAMMA: ["G1-nodiv"]})


def test_three_hundred_scored_with_nothing_wrong_validate_the_pair():
    got = _pair(300)
    p = got["pairs"]["gamma|G1-nodiv"]
    assert p["verdict"] == "validated" and p["scored"] == 300 and p["coverage_upper_95"] < 0.01
    assert got["standing"][G.GAMMA] == "served in its region"


def test_fewer_than_300_scored_is_not_established():
    assert _pair(299)["pairs"]["gamma|G1-nodiv"]["verdict"] == "not established"


def test_three_hundred_references_with_every_greek_withheld_establish_nothing():
    got = _pair(300, status=G.WITHHELD, reason="estimate above tolerance")
    p = got["pairs"]["gamma|G1-nodiv"]
    assert p["verdict"] == "not established" and p["withheld"] == {"estimate above tolerance": 300}
    assert p["coverage"] == 0.0 and got["standing"][G.GAMMA].startswith("not served")


def test_unscored_above_five_percent_is_not_established():
    rows = [rec(i) for i in range(300)] + [rec(300 + i, ref_status="unresolved: x") for i in range(16)]
    p = S.score_greeks(rows)["pairs"]["gamma|G1-nodiv"]
    assert p["unscored"] == 16 and p["verdict"] == "not established"
    assert p["all_returned_upper_95"] > p["coverage_upper_95"]


def test_one_straddle_fails_the_pair_and_blocks_the_greek_from_any_group():
    rows = [rec(i) for i in range(400)] + [rec(0, group="G6-long", gamma=0.03 + TOL_G)]
    got = S.score_greeks(rows, targeted={G.GAMMA: ["G1-nodiv"]})
    assert got["pairs"]["gamma|G1-nodiv"]["verdict"] == "validated"
    assert got["pairs"]["gamma|G6-long"]["verdict"] == "failed"
    assert "blocked by 1" in got["standing"][G.GAMMA]


def test_a_coverage_breach_fails_the_pair():
    rows = [rec(i) for i in range(300)] + [rec(300 + i, gamma=0.0302, est=1e-4) for i in range(5)]
    assert S.score_greeks(rows)["pairs"]["gamma|G1-nodiv"]["verdict"] == "failed"


def test_contexts_outside_the_region_are_counted_apart():
    rows = [rec(i) for i in range(300)] + [rec(300, region="outside the sampled region", status=G.WITHHELD,
                                               reason="outside the sampled region")]
    p = S.score_greeks(rows)["pairs"]["gamma|G1-nodiv"]
    assert p["applicable"] == 300 and p["outside_region"] == {"outside the sampled region": 1}


def test_x1_fails_when_any_greek_is_returned_outside_the_domain():
    assert S.score_x1([rec(group="X1-outside", status=G.WITHHELD)])["verdict"] == "pass"
    assert S.score_x1([rec(group="X1-outside")])["verdict"] == "failed"


def test_c1_counts_every_returned_failure():
    r = rec()
    r["c1"] = {G.GAMMA: {"status": G.RETURNED, "result": "pass"}, G.VEGA: {"status": G.RETURNED, "result": "fail"},
               G.RHO: {"status": G.WITHHELD}, "_units": 1}
    got = S.score_c1([r])
    assert got["returned"] == 2 and got["failures"] == [("G1-nodiv/0", G.VEGA)] and got["verdict"] == "failed"


def _xc(i, v_t2=7.0, v_fd=7.0, ref=7.0, fd_ref=7.0, status=oa.XC_CHECKED):
    r = rec(i, xc={"status": status, "v_fd": v_fd, "tol": 0.01, "diff": abs(v_t2 - v_fd)})
    r["tier2"] = {"value": v_t2}
    r["price_ref"] = {"status": "reliable", "ref": ref, "u": 1e-4, "tol": 0.01}
    r["refs"]["price"] = {"status": "resolved", "R": fd_ref, "u": 1e-4, "tol": 0.01}
    return r


def test_the_cross_check_scores_both_producers_among_cross_checked_prices():
    got = S.score_cross_check([_xc(i) for i in range(300)])["G1-nodiv"]
    assert got["verdict"] == "validated" and got["scored_both"] == 300
    assert got["shares"] == {"0.5": 1.0, "0.25": 1.0, "0.1": 1.0}
    bad = S.score_cross_check([_xc(i) for i in range(300)] + [_xc(300, v_fd=7.02)])["G1-nodiv"]
    assert bad["verdict"] == "failed" and bad["fd"]["fail"] == 1 and bad["tier2"]["fail"] == 0
    few = S.score_cross_check([_xc(i) for i in range(300)] + [_xc(300 + i, status=oa.XC_DISAGREE) for i in range(9)])
    assert few["G1-nodiv"]["cross_checked"] == 300 and few["G1-nodiv"]["verdict"] == "validated"


# ── the run records feed the scorer ─────────────────────────────────────────

def test_a_run_record_has_what_the_scorer_reads_and_scores():
    from scripts.options_bench import cases, run_p3
    c = cases.case(20261026, "G4-negrate", 0)
    r = run_p3.one((c.to_json(), None, False, False))
    for k in ("case", "tier2", "cross_check", "greeks", "regions", "bounds", "exact", "c1"):
        assert k in r, k
    assert r["versions"]["tier2"] == oa.VERSION
    for g in G.GREEKS:
        s = S.score_greek(r, g)      # no reference was asked for: unscored unless an exact control exists
        assert s["outcome"] != "returned" or s["result"] == "unscored" or s["source"].startswith("exact")


def test_the_runner_refuses_any_seed_but_the_development_seed():
    from scripts.options_bench import run_p3
    with pytest.raises(SystemExit):
        run_p3.main(["--seed", "20261118", "--out", "/nonexistent-never-written"])


def test_the_run_config_override_reaches_the_greeks_and_the_fd_grid():
    from scripts.options_bench import run_p3
    from src.desk import options_greeks as G
    assert run_p3.greek_config(None) == G.GreekConfig()
    got = run_p3.greek_config({"h_sigma": 0.00125, "m_frac": 0.5, "p_frac": 0.25,
                               "bump_factors": [["vega", 2.0], ["rho", 4 / 3], ["dividend", 3.0]]})
    assert got.h_sigma == 0.00125 and got.fd.m_frac == 0.5 and got.fd.p_frac == 0.25
    assert got.fd.work_cap == G.GreekConfig().fd.work_cap and got.h_r == G.GreekConfig().h_r
    assert got.bump_factor("vega") == 2.0
    with pytest.raises(ValueError):
        run_p3.greek_config({"h_sgima": 0.001})


def test_a_resumed_run_keeps_complete_records_and_runs_only_the_rest(tmp_path):
    from scripts.options_bench import run_p3
    out = tmp_path / "run"
    args = ["--per-group", "1", "--out", str(out), "--workers", "2", "--no-refs"]
    assert run_p3.main(args) == 0
    lines = (out / "records-p3.jsonl").read_text().splitlines()
    ids = [json.loads(x)["case"]["id"] for x in lines]
    # a run stopped after 3 records with a 4th half written
    (out / "records-p3.jsonl").write_text("\n".join(lines[:3]) + "\n" + lines[3][:40])
    assert run_p3.main(args + ["--resume"]) == 0
    again = (out / "records-p3.jsonl").read_text().splitlines()
    assert [json.loads(x)["case"]["id"] for x in again] == ids
    assert again[:3] == lines[:3]
    assert json.loads((out / "manifest-p3.json").read_text())["resumed_after"] == 3
    with pytest.raises(SystemExit):
        run_p3.main(["--per-group", "2", "--out", str(out), "--workers", "2", "--no-refs", "--resume"])
