"""The options validation bench (scripts/options_bench/): generator, reference, scoring, runner helpers.

Synthetic inputs only. The engine-dependent tests read the engine from the repository (src/desk/options_math.py
once the baseline is merged) or from OPTIONS_BENCH_ENGINE_ROOT, and skip when neither has it; the QuantLib
test skips without QuantLib (test-only, not in requirements-api.lock).
"""

from __future__ import annotations

import json
import math
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

from scripts.options_bench import cases, crosscheck, fd, reference, run, score

REPO = Path(__file__).resolve().parent.parent


def _engine_root() -> str | None:
    for root in (os.environ.get("OPTIONS_BENCH_ENGINE_ROOT"), str(REPO)):
        if root and (Path(root) / "src" / "desk" / "options_math.py").exists():
            return root
    return None


ENGINE = _engine_root()
needs_engine = pytest.mark.skipif(ENGINE is None, reason="no engine: src/desk/options_math.py is not on this branch")


# ── cases ────────────────────────────────────────────────────────────────────

def test_a_case_depends_only_on_seed_group_and_index():
    a = cases.case(7, "G2-dividends", 13)
    assert a == cases.case(7, "G2-dividends", 13)
    assert a != cases.case(8, "G2-dividends", 13)
    full = list(cases.suite(7, 3))
    shards = [c for k in range(3) for j, c in enumerate(full) if j % 3 == k]
    assert sorted(c.id for c in shards) == sorted(c.id for c in full)
    assert len({c.id for c in full}) == len(full) == len(cases.NAMED) + 3 * len(cases.GROUPS)


def test_groups_keep_their_domain_and_exemption_rules():
    for g, (_, inside, avoid) in cases.GROUPS.items():
        for i in range(25):
            c = cases.case(1, g, i)
            assert (cases.domain_reason(c) is None) == inside, (g, i)
            if g == "G0-exempt":
                assert cases.exempt_simple(c)
            elif avoid:
                assert not cases.exempt_simple(c)
            assert c.spot - c.pv() > 0


def test_named_regressions_carry_the_documented_inputs():
    named = {c.id.split("/")[1]: c for c in cases.NAMED}
    assert set(named) == {"DR-47", "DR-48", "DR-49", "DR-50", "B8", "B9a", "B9b"}
    assert math.isclose(sum(a for _, a in named["DR-48"].divs), 28.249649080935125, rel_tol=1e-12)
    assert named["DR-47"].divs == ((3, 28.249649080935125),)
    assert (named["DR-50"].strike, named["DR-50"].q, named["DR-50"].divs) == (109.78, -0.82, ((4, 1.01),))
    assert cases.domain_reason(named["DR-47"]) == "dividend cluster"
    assert cases.domain_reason(named["DR-49"]) == "residual yield"
    assert cases.domain_reason(named["B8"]) is None


# ── the finite-difference solver and the reference ───────────────────────────

def _bs(c):
    return crosscheck.black76_case(c)


def _case(**kw):
    base = dict(id="t/0", group="t", kind="random", is_call=False, spot=100.0, strike=105.0, days=90, rho=0.04,
                q=0.01, sigma=0.3, divs=())
    base.update(kw)
    return cases.Case(**base)


def test_fd_european_converges_at_second_order_to_black76():
    c = _case(is_call=True, strike=110.0, divs=((20, 1.0), (60, 1.0)))
    exact, _ = _bs(c)
    width = 7 * c.sigma * math.sqrt(c.days / 365)
    errs = [abs(fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, c.divs, m, 20, width,
                         american=False)[0] - exact) for m in (400, 800, 1600)]
    assert errs[2] < 2e-5 * c.spot
    assert errs[0] / errs[1] > 3 and errs[1] / errs[2] > 3


def test_bermudan_value_lies_between_european_and_american():
    c = _case(strike=110.0, rho=0.08, q=0.0)
    w = 7 * c.sigma * math.sqrt(c.days / 365)
    am = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 800, 8, w)[0]
    berm = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 800, 8, w,
                    exercise_days=run.business_closes(c.days))[0]
    eu = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 800, 8, w, american=False)[0]
    assert eu < berm < am


def test_bermudan_exercise_is_projected_only_on_its_dates():
    """OB-12: exercise only today is max(intrinsic, European); no exercise date is the European value; the
    90-day business-close put matches a free-propagate-then-project solve."""
    c = _case(strike=105.0, days=30, rho=0.10, q=0.0, sigma=0.2)
    eu = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 1600, 2, 1.0, american=False)[0]
    for per_day in (1, 2):
        today = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 1600, per_day, 1.0,
                         exercise_days=[0])[0]
        assert abs(today - max(c.strike - c.spot, eu)) < 1e-12
    never = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, (), 1600, 2, 1.0, exercise_days=[])[0]
    assert abs(never - eu) < 1e-12
    berm = fd.solve(False, 100.0, 105.0, 90, 0.10, 0.0, 0.2, (), 1600, 4, 1.0, exercise_days=run.business_closes(90))[0]
    assert abs(berm - 5.935155711) < 1e-8   # the reviewer's independent projection solve


def test_the_monotonicity_veto_matches_the_operator_signs():
    """OB-13: reference.peclet <= 1 exactly when fd's off-diagonals are nonnegative."""
    for g, i in (("G5-extreme-vol", 12), ("G5-extreme-vol", 3), ("G1-nodiv", 0), ("X1-outside", 7)):
        c = cases.case(20261026, g, i)
        m, _, w = reference.grid(c)
        for mm in (m // 4, m // 2, m):
            lo, _, up = fd.coefficients(c.rho, c.q, c.sigma, 2.0 * w / mm)
            assert (min(lo, up) >= -1e-9 * max(abs(lo), abs(up))) == (reference.peclet(c, mm, w) <= 1.0 + 1e-12), (g, i, mm)
    c = cases.case(20261026, "G5-extreme-vol", 12)
    r = reference.reference(c)
    assert reference.peclet(c, r["grid"]["space_levels"][-3], r["grid"]["width"]) <= 1.0 or \
        "convection-dominated" in r["value"]["status"]


def test_reference_brackets_closed_forms_within_its_uncertainty():
    eu_case = _case(is_call=True, strike=95.0, days=200, q=0.03, divs=((45, 1.5),))
    r = reference.reference(eu_case, american=False)
    exact, exact_delta = _bs(eu_case)
    assert r["value"]["status"] == "reliable"
    assert abs(r["value"]["ref"] - exact) <= r["value"]["u"]
    assert abs(r["delta"]["ref"] - exact_delta) <= r["delta"]["u"]
    exempt = _case(rho=-0.01, q=0.02, days=120)       # a put with rho <= 0 and q >= 0 is never exercised early
    ra = reference.reference(exempt)
    assert abs(ra["value"]["ref"] - _bs(exempt)[0]) <= ra["value"]["u"]


def test_gci_reads_the_observed_order():
    h = [0.04, 0.02, 0.01]
    second = reference.gci(*(1.0 + 3.0 * x * x for x in h), floor=1e-15)
    assert second["kind"] == "monotone" and abs(second["order"] - 2.0) < 1e-9
    assert abs((1.0 + 3e-4) + second["corr"] - 1.0) < 1e-12
    assert reference.gci(1.0, 1.1, 0.95, 1e-15)["kind"] == "oscillating"
    assert reference.gci(1.0, 1.01, 1.03, 1e-15)["kind"] == "not-converging"
    assert reference.gci(1.0, 1.0, 1.0, 1e-15)["kind"] == "flat"
    fast = reference.gci(1.0, 1.0 + 7.5e-3, 1.0 + 8.5e-3, 1e-15)   # order 2.9: pre-asymptotic (OB-10)
    assert fast["kind"] == "above-order" and math.isclose(fast["u"], 1e-3, rel_tol=1e-9)   # the last change


def test_low_volatility_high_carry_reference_is_never_trusted_wrongly():
    """OB-10: S=K=100, a year, rho 10%, q 2%, sigma 0.1%: the forward drifts eleven standard deviations, which
    the old grid did not cover (0.697 ± 0.35 against Black-76's 7.536)."""
    c = _case(is_call=True, strike=100.0, days=365, rho=0.10, q=0.02, sigma=0.001)
    m, _, w = reference.grid(c)
    assert reference.peclet(c, m // 4, w) > reference.PECLET_MONOTONE
    r = reference.reference(c, escalate=False)
    assert r["value"]["status"].startswith("unresolved") and "convection-dominated" in r["value"]["status"]
    assert abs(r["value"]["ref"] - _bs(c)[0]) <= max(r["value"]["u"], 1e-6)
    put = _case(strike=100.0, days=365, rho=0.10, q=0.02, sigma=0.02)   # erratic space convergence
    rp = reference.reference(put)
    truth = 0.0917968   # FD at 15,872 intervals (0.09179673) and QuantLib QdFp (0.09179769)
    assert abs(rp["value"]["ref"] - truth) <= rp["value"]["u"]


def test_a_diffusion_dominated_case_is_not_vetoed_for_grid_size():
    """OB-11: G0-exempt/20 of the default seed asks for more than M_MAX intervals for accuracy, not for
    monotonicity; its reference is good to 1e-8 and must stay reliable."""
    c = cases.case(20261026, "G0-exempt", 20)
    r = reference.reference(c)
    assert r["value"]["status"] == "reliable", r["value"]["status"]
    assert abs(r["value"]["ref"] - _bs(c)[0]) <= r["value"]["u"]


# ── scoring ──────────────────────────────────────────────────────────────────

def _rec(status="served", value=10.0, delta=-0.5, ref=10.0, u=1e-4, ref_status="reliable", d_ref=-0.5,
         d_u=1e-5, d_status="reliable", note=None):
    tol = reference.tolerance(ref, 100.0)
    return {"case": {"id": "G1-nodiv/0", "group": "G1-nodiv", "kind": "random"},
            "engine": {"status": status, "model": "m", "value": value, "delta": delta, "delta_note": note,
                       "units": 10, "secs": 0.1},
            "ref": {"value": {"ref": ref, "u": u, "status": ref_status, "tol": tol},
                    "delta": {"ref": d_ref, "u": d_u, "status": d_status}}}


def test_every_case_gets_one_outcome_per_quantity():
    tol = reference.tolerance(10.0, 100.0)
    assert score.classify(_rec())["price"] == "pass"
    assert score.classify(_rec(value=10.0 + 2 * tol))["price"] == "fail"
    assert score.classify(_rec(value=10.0 + tol, u=0.2 * tol))["price"] == "indeterminate"
    assert score.classify(_rec(ref_status="unresolved: x"))["price"] == "unscored"
    refused = score.classify(_rec(status="refused:domain"))
    assert (refused["price"], refused["delta"]) == ("refused", "refused")
    assert score.classify(_rec(delta=None, note="zone"))["delta"] == "withheld"
    assert score.classify(_rec(delta=-0.5 + 3e-3))["delta"] == "fail"
    assert score.classify(_rec(d_status="unresolved: y"))["delta"] == "unscored"
    assert score.classify({"case": {"id": "x", "group": "G1-nodiv", "kind": "random"}, "error": "boom"})["price"] == "error"


def test_a_case_scored_twice_is_refused_not_deduplicated(tmp_path):
    man = {k: "x" for k in score.RUN_KEYS}
    for k in (0, 1):
        (tmp_path / f"manifest-{k}of2.json").write_text(json.dumps(man | {"shard": f"{k}/2"}))
        (tmp_path / f"results-{k}of2.jsonl").write_text(json.dumps(_rec()) + "\n")
    with pytest.raises(ValueError, match="appears twice"):
        score.score([tmp_path])
    with pytest.raises(ValueError, match="shard set"):
        score.score([tmp_path, tmp_path])            # the same run directory passed twice
    with pytest.raises(ValueError, match="no manifest"):
        score.check_compatible([])


def test_shards_from_different_runs_are_not_combined():
    man = {k: "x" for k in score.RUN_KEYS}
    score.check_compatible([man | {"shard": "0/2"}, man | {"shard": "1/2"}])
    with pytest.raises(ValueError, match="seed"):
        score.check_compatible([man | {"shard": "0/2"}, man | {"seed": 2, "shard": "1/2"}])
    with pytest.raises(ValueError, match="shard set"):
        score.check_compatible([man | {"shard": "0/2"}, man | {"shard": "0/2"}])


def test_a_named_case_needs_a_resolved_reference_to_pass():
    assert score.named_verdict("served", "served", "pass", "pass") == "pass"
    assert score.named_verdict("served", "served", "unscored", "pass") == "unresolved"
    assert score.named_verdict("served:no-delta", "served:no-delta", "pass", "withheld") == "pass"
    assert score.named_verdict("served:no-delta", "served:no-delta", "indeterminate", "withheld") == "unresolved"
    assert score.named_verdict("served", "served", "fail", "pass") == "FAIL"
    assert score.named_verdict("refused:domain", "served", "pass", "pass") == "FAIL"
    assert score.named_verdict("refused:domain", "refused:domain", "refused", "refused") == "pass"


def _group(n, fails=0, div=None):
    return {"accepted_scored": n, "price_failures": fails, "divsens": {"outcome": div or {}}}


def test_the_gate_counts_missing_groups_dividends_and_named_cases():
    full = {g: _group(score.PER_GROUP_TARGET) for g in cases.IN_DOMAIN_GROUPS}
    full["G2-dividends"] = _group(score.PER_GROUP_TARGET, div={"pass": score.DIVSENS_TARGET})
    overall = {"accepted_scored": score.OVERALL_TARGET}
    ok = [{"id": c.id, "regression": "pass"} for c in cases.NAMED]
    assert score.gate_result(full, overall, ok, complete=True)["met"]
    assert not score.gate_result(full, overall, ok, complete=False)["met"]
    missing = {g: v for g, v in full.items() if g != "G6-long"}
    gate = score.gate_result(missing, overall, ok, complete=True)
    assert not gate["per_group_met"]["G6-long"] and not gate["met"]
    bad_div = dict(full, **{"G3-carry-itm": _group(score.PER_GROUP_TARGET, div={"fail": 1})})
    assert not score.gate_result(bad_div, overall, ok, complete=True)["met"]
    b8 = next(c.id for c in cases.NAMED if c.id.endswith("B8"))
    unresolved = [n if n["id"] != b8 else {"id": b8, "regression": "unresolved"} for n in ok]
    gate = score.gate_result(full, overall, unresolved, complete=True)
    assert not gate["met"] and gate["named_unresolved"] == [b8] and not gate["named_failures"]
    one = score.gate_result(full, overall, ok[:1], complete=True)   # a shard holding one named case (OB-08)
    assert not one["met"] and len(one["named_missing"]) == len(cases.NAMED) - 1
    assert not score.gate_result(full, overall, [], complete=True)["met"]


def test_a_partial_run_is_scored_but_marked_incomplete():
    man = {k: "x" for k in score.RUN_KEYS} | {"seed": 3, "per_group": 2, "named": True}
    expected = [c.id for c in cases.suite(3, 2)]
    got = score.completeness([man | {"shard": "0/4"}], set(expected[::4]))
    assert not got["complete"] and got["missing_shards"] == ["1/4", "2/4", "3/4"]
    assert got["expected"] == len(expected) and got["missing"] == len(expected) - len(expected[::4])
    assert score.completeness([man | {"shard": "0/1"}], set(expected))["complete"]
    with pytest.raises(ValueError, match="not in this run"):
        score.completeness([man | {"shard": "0/1"}], set(expected) | {"G1-nodiv/99"})


def test_a_calendar_change_separates_runs():
    man = {k: "x" for k in score.RUN_KEYS}
    with pytest.raises(ValueError, match="convention_calendar"):
        score.check_compatible([man | {"shard": "0/2"}, man | {"convention_calendar": "y", "shard": "1/2"}])


def test_a_skipped_convention_study_is_counted_not_crashed():
    rec = _rec()
    rec["convention"] = {"skipped": "expiry after 2027-12-31"}
    out = score.classify(rec)
    assert out["convention_skipped"] and "convention_shift_tol" not in out
    rec["convention"] = {"value": {"ref": 10.001, "u": 1e-5, "status": "reliable"}}
    out = score.classify(rec)
    assert math.isclose(out["convention_shift_tol"], 0.001 / reference.tolerance(10.0, 100.0))


def test_the_early_exercise_bound_is_checked_against_the_reference_premium():
    rec = _rec(value=10.0, ref=10.0004, u=1e-5)
    rec["engine"]["bound"] = 5e-4
    assert score.classify(rec)["bound"] == "covered"
    rec["engine"]["bound"] = 1e-4                   # premium 4e-4 exceeds bound + u
    assert score.classify(rec)["bound"] == "violated"
    rec = _rec(value=10.0, ref=10.0004, u=1e-4)     # premium in [3e-4, 5e-4] across the bound (OB-14)
    rec["engine"]["bound"] = 3.5e-4
    assert score.classify(rec)["bound"] == "indeterminate"
    assert "bound" not in score.classify(_rec())


def test_a_diagnostic_crash_keeps_the_price_outcome_and_holds_the_gate():
    rec = _rec(value=10.02)                         # a price failure, then a later diagnostic raised (OB-16)
    rec["error"] = "RuntimeError: lattice check"
    out = score.classify(rec)
    assert out["price"] == "fail" and out["error"]
    s = score._summary([out])
    assert s["price_failures"] == 1 and s["errors"] == 1
    rec["divsens"] = {"up": {"ref": rec["ref"]["value"], "engine": rec["engine"]}}   # crashed between bumps (OB-18)
    rec["convention"] = {"value": rec["ref"]["value"]}
    half = score.classify(rec)
    assert half["price"] == "fail" and half["diagnostics"] == "incomplete" and "divsens" not in half
    bare = {"case": rec["case"], "error": "boom"}   # nothing computed
    assert score.classify(bare)["price"] == "error"
    full = {g: _group(score.PER_GROUP_TARGET) | {"errors": 0} for g in cases.IN_DOMAIN_GROUPS}
    full["G2-dividends"] = _group(score.PER_GROUP_TARGET, div={"pass": score.DIVSENS_TARGET}) | {"errors": 0}
    ok = [{"id": c.id, "regression": "pass"} for c in cases.NAMED]
    overall = {"accepted_scored": score.OVERALL_TARGET}
    assert score.gate_result(full, overall, ok, complete=True)["met"]
    full["X1-outside"] = {"errors": 1}
    assert not score.gate_result(full, overall, ok, complete=True)["met"]


def test_indeterminate_outcomes_widen_the_conservative_limit():
    rows = [{"price": "pass", "delta": "pass"}] * 1000 + [{"price": "indeterminate", "delta": "pass"}] * 1000
    s = score._summary([dict(r, id="x", group="g", kind="random") for r in rows])
    assert s["clopper_pearson_95"][2] < 0.005 < 0.5 < s["clopper_pearson_95_conservative"][2]


def test_the_scorecard_table_shows_every_outcome(tmp_path):
    """OB-19: an indeterminate delta appears in the rendered counts, not only in the JSON."""
    man = {k: "x" for k in score.RUN_KEYS} | {"seed": 1, "per_group": {"G1-nodiv": 1}, "named": False, "shard": "0/1"}
    rec = _rec(delta=-0.4975, d_u=1e-4)
    rec["case"] = {"id": "G1-nodiv/0", "group": "G1-nodiv", "kind": "random"}
    (tmp_path / "manifest-0of1.json").write_text(json.dumps(man))
    (tmp_path / "results-0of1.jsonl").write_text(json.dumps(rec) + "\n")
    sc = score.score([tmp_path])
    assert sc["groups"]["G1-nodiv"]["delta"] == {"indeterminate": 1}
    sc["manifests"] = []                            # the header needs a real run's manifest; the table does not
    row = next(x for x in score.markdown(sc).splitlines() if x.startswith("| G1-nodiv "))
    assert "| 0 / 0 / 1 / 0 / 0 |" in row


def test_named_regressions_carry_no_sampling_limits():
    rows = [score.classify(_rec())]
    assert score._summary(rows, sampled=False)["clopper_pearson_95"] is None
    assert score._summary(rows)["clopper_pearson_95"] is not None


def test_clopper_pearson_zero_failures():
    lo, hi, one = score.clopper_pearson(0, 1000)
    assert lo == 0.0
    assert math.isclose(one, 1 - 0.05 ** (1 / 1000), rel_tol=1e-9)
    assert hi > one


def test_business_closes_skip_weekends_and_holidays():
    got = run.business_closes(40)
    start = run.CONVENTION_START
    assert 0 in got
    for d in range(40):
        day = start + timedelta(days=d)
        if day.weekday() >= 5 or day == date(2026, 11, 26):
            assert d not in got
    assert (date(2026, 11, 27) - start).days in got  # the day after Thanksgiving is an (early-close) session
    past = (run.calendar_last_day() - start).days + 1
    with pytest.raises(ValueError, match="holiday tables end"):
        run.business_closes(past)        # past the tables a holiday would read as a session (Codex OB-05)


# ── engine-dependent ─────────────────────────────────────────────────────────

@needs_engine
def test_long_maturities_cannot_reach_the_third_refinement_pair():
    from scripts.options_bench import engine
    rows = {r["days"]: r for r in engine.resolution_schedule(ENGINE)}
    long = rows[1464]
    assert long["n0"] == 1464
    assert long["pairs"][2]["pair"] == [5856, 11712]
    assert long["pairs"][2]["units_of_finer"] == 11712 * 11712 // 2 > long["single_cap"]
    assert not long["pairs"][2]["allowed"]
    assert rows[90]["pairs"][2]["allowed"]


@needs_engine
def test_named_regressions_route_as_documented():
    from scripts.options_bench import engine
    for c in cases.NAMED:
        got = engine.run(ENGINE, c)
        if c.expect == "refused:domain":
            assert got["status"] == "refused:domain", c.id
        elif c.expect == "served:no-delta":
            assert got["status"] == "served" and got["delta"] is None, c.id
        else:
            assert got["status"] == "served" and got["delta"] is not None, c.id


@needs_engine
def test_resuming_a_run_with_other_inputs_is_refused(tmp_path):
    common = ["--engine-root", ENGINE, "--out", str(tmp_path), "--per-group", "0", "--no-named", "--workers", "1"]
    assert run.main(common) == 0
    with pytest.raises(SystemExit, match="seed"):
        run.main(common + ["--seed", "1"])
    man_path = tmp_path / "manifest-0of1.json"
    man = json.loads(man_path.read_text())
    assert man["convention_calendar"]["sha256"] == run._sha(run.SESSION_PY)
    man["convention_calendar"]["sha256"] = "0" * 64      # as if the holiday tables had changed (OB-09)
    man_path.write_text(json.dumps(man))
    with pytest.raises(SystemExit, match="convention_calendar"):
        run.main(common)


@pytest.mark.skipif(crosscheck.ql is None, reason="QuantLib is test-only and not installed")
def test_reference_agrees_with_quantlib_on_an_american_put():
    c = _case(strike=110.0, rho=0.06, q=0.0, days=120, sigma=0.25)
    r = reference.reference(c)
    q = crosscheck.quantlib(c)
    assert q["method"] == "qdfp-high-precision"
    assert abs(q["value"] - r["value"]["ref"]) <= r["value"]["u"]   # no slack beyond the stated uncertainty


@pytest.mark.skipif(crosscheck.ql is None, reason="QuantLib is test-only and not installed")
def test_deep_itm_put_uncertainty_covers_quantlib():
    """B9a: the space study converges faster than second order, which the plain GCI read as near-zero
    uncertainty (Codex OB-02); the high-order rule keeps QuantLib inside the stated band."""
    b9a = {c.id.split("/")[1]: c for c in cases.NAMED}["B9a"]
    r = reference.reference(b9a)
    assert r["value"]["status"] == "reliable"
    assert abs(crosscheck.quantlib(b9a)["value"] - r["value"]["ref"]) <= r["value"]["u"]
