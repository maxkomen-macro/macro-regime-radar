"""The options validation bench (scripts/options_bench/): generator, reference, scoring, runner helpers.

Synthetic inputs only. The engine-dependent tests read the engine from the repository (src/desk/options_math.py
once the baseline is merged) or from OPTIONS_BENCH_ENGINE_ROOT, and skip when neither has it; the QuantLib
test skips without QuantLib (test-only, not in requirements-api.lock).
"""

from __future__ import annotations

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


@pytest.mark.skipif(crosscheck.ql is None, reason="QuantLib is test-only and not installed")
def test_reference_agrees_with_quantlib_on_an_american_put():
    c = _case(strike=110.0, rho=0.06, q=0.0, days=120, sigma=0.25)
    r = reference.reference(c)
    q = crosscheck.quantlib(c)
    assert q["method"] == "qdfp-high-precision"
    assert abs(q["value"] - r["value"]["ref"]) <= r["value"]["u"] + 1e-4 * c.spot
