"""Tier 2's Phase 3 cross-check and Greek block (design-P3-approved.md sections 10 and 15; build step 7).

price() must keep every number of adaptive-p2.1: the routine subset (the golden file's cases) is priced by the
current module and by the verbatim 2ff3e8b file (tests/fixtures/options_pre_phase3/, checked by its git blob id)
in the same process and compared bit for bit, the version string apart. The cross-check's status rule is tested at
its thresholds on hand-built FD solves, then end to end. Nothing is served: no served module imports Phase 3 code.
"""

from __future__ import annotations

import ast
import dataclasses
import math
from pathlib import Path

import pytest

from scripts.options_bench import golden
from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om
from tests.fixtures import options_pre_phase3 as frozen

REPO = Path(__file__).resolve().parent.parent
PRE_FILE, PRE_BLOB = "options_adaptive_2ff3e8b.py", "c35574ad8cedb71bbe11e58a495883f707054b3d"


def ctx(is_call=False, spot=100.0, strike=105.0, days=90, rho=0.05, q=0.0, sigma=0.3, divs=()):
    return om.Context(is_call, spot, strike, days, rho, q, sigma, tuple(divs))


@pytest.fixture(scope="module")
def old_oa():
    return frozen.load(PRE_FILE, PRE_BLOB)


def test_the_frozen_pre_change_options_adaptive_is_the_verbatim_2ff3e8b_file(old_oa):
    assert frozen.blob_id(PRE_FILE) == PRE_BLOB
    assert old_oa.VERSION == "adaptive-p2.1" and oa.VERSION == "adaptive-p3"


def _canon(x):
    """Floats by their bits, so NaN equals NaN and -0.0 differs from 0.0."""
    if isinstance(x, dict):
        return {k: _canon(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_canon(v) for v in x]
    if isinstance(x, float):
        return ("f", x.hex())
    return x


def _full(a: oe.Answer) -> dict:
    d = dataclasses.asdict(a)
    d.pop("version")
    return _canon(d)


def test_tier_2_prices_and_deltas_are_bit_identical_to_adaptive_p2_1_on_the_routine_subset(old_oa):
    # every field of the answer, the audit included, the version string apart
    for c in golden.golden_cases():
        x = om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))
        new, old = oa.price(x), old_oa.price(x)
        assert new.version == "adaptive-p3" and old.version == "adaptive-p2.1"
        assert _full(new) == _full(old), c.id


# ── the status rule at its thresholds (design section 10) ──────────────────

LV = fd.Level(400, 4, 1.0)


def _base(v1, v2):
    return {0: fd.Solved(v1, 0.0, LV, 1, {}), 1: fd.Solved(v2, 0.0, fd.Level(800, 8, 1.0), 1, {})}


def _est(value):
    return oe.Answer(engine="adaptive", version=oa.VERSION, route=oe.ROUTE_LATTICE, price_status=oe.ESTIMATED,
                     value=value, estimate=0.001, delta_status=oe.SERVED, delta=-0.5, delta_estimate=1e-4)


C = ctx()
V = 10.0
TOL = om.tolerance(V, C.spot)


@pytest.mark.parametrize("frac,status", [(0.0, oa.XC_CHECKED), (0.5 * (1 - 1e-9), oa.XC_CHECKED),
                                         (0.5 * (1 + 1e-9), oa.XC_DISAGREE), (3.0, oa.XC_DISAGREE)])
def test_agreement_at_half_a_tolerance(frac, status):
    v2 = V + frac * TOL
    got = oa.cross_check(C, _est(V), _base(v2, v2))
    assert got.status == status and got.v_fd == v2 and got.tol == TOL
    assert got.e_fd == 0.0 and got.diff == abs(V - v2)


@pytest.mark.parametrize("frac,status", [(0.25 * (1 - 1e-9), oa.XC_CHECKED), (0.25 * (1 + 1e-9), oa.XC_UNAVAILABLE)])
def test_the_fd_estimate_must_be_within_a_quarter_tolerance(frac, status):
    f_p = oa.XConfig().f_p
    v1 = V - frac * TOL / f_p
    got = oa.cross_check(C, _est(V), _base(v1, V))
    assert got.status == status
    if status == oa.XC_UNAVAILABLE:
        assert got.reason == oa.XC_E_ABOVE


def test_a_disagreement_needs_a_settled_fd_value():
    # far apart but with a large FD estimate: unavailable, never "methods disagree"
    got = oa.cross_check(C, _est(V), _base(V + 5 * TOL, V + 2 * TOL))
    assert got.status == oa.XC_UNAVAILABLE and got.reason == oa.XC_E_ABOVE


def test_an_fd_refusal_makes_the_check_unavailable_with_its_reason():
    for k in (0, 1):
        base = _base(V, V)
        base[k] = fd.Refused(fd.R_PECLET)
        got = oa.cross_check(C, _est(V), base)
        assert got.status == oa.XC_UNAVAILABLE and got.reason == fd.R_PECLET and got.audit["level"] == k + 1
    got = oa.cross_check(C, _est(V), {})
    assert got.status == oa.XC_UNAVAILABLE


def test_outside_the_fd_role_region_the_check_is_unavailable_from_the_inputs_alone():
    got = oa.cross_check(C, _est(V), _base(V, V), region=lambda c: "carve-out" if c.sigma > 0.2 else None)
    assert got.status == oa.XC_UNAVAILABLE and got.reason == oa.XC_NOT_VALIDATED
    assert oa.cross_check(C, _est(V), _base(V, V), region=lambda c: None).status == oa.XC_CHECKED


def _analytic(lo, hi, value=None):
    """An analytic-bound answer: the midpoint of the proved interval [lo, hi] (or `value`), as price() serves it."""
    mid = lo + (hi - lo) / 2.0 if value is None else value
    return dataclasses.replace(_est(mid), route=oe.ROUTE_ANALYTIC,
                               price_status=oe.ANALYTIC, audit={"L": lo, "U": hi})


# amendment P3-AM1 (pilot D1): an analytic price is checked against its proved interval, widened by
# s = max(E_FD, 0.1·tol); the midpoint's 0.5·tol test does not apply to it
@pytest.mark.parametrize("v_fd,status", [
    (V - 0.9 * TOL, oa.XC_CHECKED),                       # inside, 0.9 tol from the midpoint
    (V + 0.9 * TOL, oa.XC_CHECKED),
    (V - TOL, oa.XC_CHECKED),                             # on L
    (V - TOL - 0.1 * TOL * (1 - 1e-9), oa.XC_CHECKED),    # inside the floor below L
    (V - TOL - 0.1 * TOL * (1 + 1e-9), oa.XC_DISAGREE),   # just past it
    (V + TOL + 0.1 * TOL * (1 + 1e-9), oa.XC_DISAGREE),
    (V + 3.0 * TOL, oa.XC_DISAGREE)])
def test_an_analytic_price_is_checked_against_its_proved_interval(v_fd, status):
    got = oa.cross_check(C, _analytic(V - TOL, V + TOL), _base(v_fd, v_fd))
    assert got.status == status and got.v_fd == v_fd and got.e_fd == 0.0
    assert got.audit["L"] == V - TOL and got.audit["U"] == V + TOL and got.audit["s"] == oa.XC_SLACK * TOL
    assert got.audit["basis"] == oa.XC_BASIS_INTERVAL


def test_the_interval_test_is_stricter_than_the_midpoint_test_where_the_interval_is_narrow():
    # 0.3 tol from the midpoint passes the lattice rule, but lies outside a proved interval of half-width 0.01 tol
    lo, hi = V - 0.01 * TOL, V + 0.01 * TOL
    v_fd = V + 0.3 * TOL
    assert oa.cross_check(C, _est(V), _base(v_fd, v_fd)).status == oa.XC_CHECKED
    assert oa.cross_check(C, _analytic(lo, hi), _base(v_fd, v_fd)).status == oa.XC_DISAGREE


def test_the_interval_slack_is_the_fd_estimate_when_that_is_larger():
    f_p = oa.XConfig().f_p
    e = 0.2 * TOL                                          # E_FD = 0.2 tol, under the 0.25 tol limit
    v2 = V + TOL + 0.15 * TOL                              # past U by 0.15 tol: outside the floor, inside E_FD
    got = oa.cross_check(C, _analytic(V - TOL, V + TOL), _base(v2 - e / f_p, v2))
    assert got.status == oa.XC_CHECKED and math.isclose(got.audit["s"], e)
    v2 = V + TOL + 0.25 * TOL
    got = oa.cross_check(C, _analytic(V - TOL, V + TOL), _base(v2 - e / f_p, v2))
    assert got.status == oa.XC_DISAGREE


def test_an_analytic_price_with_an_unsettled_fd_value_is_unavailable():
    got = oa.cross_check(C, _analytic(V - TOL, V + TOL), _base(V + 5 * TOL, V + 2 * TOL))
    assert got.status == oa.XC_UNAVAILABLE and got.reason == oa.XC_E_ABOVE


def test_an_analytic_answer_without_its_interval_is_never_checked_at_its_midpoint():
    got = oa.cross_check(C, dataclasses.replace(_est(V), price_status=oe.ANALYTIC), _base(V, V))
    assert got.status == oa.XC_UNAVAILABLE and got.reason == oa.XC_NO_INTERVAL


def test_the_lattice_rule_is_unchanged_by_the_amendment():
    for frac, status in ((0.5 * (1 - 1e-9), oa.XC_CHECKED), (0.5 * (1 + 1e-9), oa.XC_DISAGREE)):
        v2 = V + frac * TOL
        got = oa.cross_check(C, _est(V), _base(v2, v2))
        assert got.status == status and got.audit["basis"] == oa.XC_BASIS_POINT


def test_only_estimated_and_analytic_prices_are_checked():
    a = _est(V)
    assert oa.cross_check(C, _analytic(V, V, V), _base(V, V)).status == oa.XC_CHECKED
    got = oa.cross_check(C, dataclasses.replace(a, price_status=oe.EXACT), _base(V + TOL, V + TOL))
    assert got.status == oa.XC_NOT_APPLICABLE and got.reason == oa.XC_EXACT
    for st in (oe.UNRESOLVED, oe.OUTSIDE, oe.INPUT, oe.CONTROL):
        got = oa.cross_check(C, dataclasses.replace(a, price_status=st, value=None if st != oe.CONTROL else V),
                             _base(V, V))
        assert got.status == oa.XC_NOT_APPLICABLE and got.reason == oa.XC_NO_PRICE, st


def test_the_config_rejects_a_factor_below_one():
    for bad in (0.5, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            oa.XConfig(f_p=bad)


# ── end to end ─────────────────────────────────────────────────────────────

def test_phase3_keeps_tier_2_s_answer_and_adds_the_check_and_the_greeks():
    c = ctx(is_call=False, strike=105.0, days=60, rho=0.05, sigma=0.3)
    got = oa.phase3(c)
    assert got.tier2 == oa.price(c) and _full(got.tier2) == _full(oa.price(c))
    assert got.tier2.price_status in (oe.ESTIMATED, oe.ANALYTIC)
    assert got.cross_check.status in (oa.XC_CHECKED, oa.XC_DISAGREE, oa.XC_UNAVAILABLE)
    assert got.cross_check.v_fd is not None
    assert set(got.greeks) == set(G.GREEKS)
    assert got.units > got.tier2.units
    # the price's standing: confirmed, or Tier 2's own status unchanged
    want = oa.XC_CHECKED if got.cross_check.status == oa.XC_CHECKED else got.tier2.price_status
    assert got.price_status == want


def test_the_check_solves_the_fd_itself_when_no_greek_needed_it():
    c = ctx(is_call=False, strike=105.0, days=60, rho=0.05, sigma=0.3)
    everywhere = lambda c, g: "outside the sampled region"
    got = oa.phase3(c, g_region=everywhere)
    assert all(g.status == G.WITHHELD for g in got.greeks.values())
    ref = oa.phase3(c)
    assert got.cross_check.status == ref.cross_check.status and got.cross_check.v_fd == ref.cross_check.v_fd
    # outside the FD role region no FD work is done at all
    out = oa.phase3(c, g_region=everywhere, x_region=lambda c: "carve-out")
    assert out.cross_check.reason == oa.XC_NOT_VALIDATED and out.units == out.tier2.units


def test_an_exact_price_is_not_checked_and_its_greeks_are_the_closed_forms():
    c = ctx(is_call=False, strike=100.0, days=60, rho=-0.01, q=0.02, sigma=0.3)
    assert om.exempt(c)
    got = oa.phase3(c)
    assert got.tier2.price_status == oe.EXACT and got.cross_check.status == oa.XC_NOT_APPLICABLE
    assert got.greeks[G.GAMMA].status == G.EXACT_EXEMPT


def test_at_expiry_nothing_reaches_a_solver():
    got = oa.phase3(ctx(days=0))
    assert got.cross_check.reason == oa.XC_EXACT and got.units == got.tier2.units
    assert all(g.reason == G.R_EXPIRY for g in got.greeks.values())


def test_tier_2_s_unresolved_exercise_decision_reaches_the_greeks(monkeypatch):
    seen = {}
    real = G.greeks

    def spy(c, cfg, region=None, decision_unresolved=False, budget=None, american=True):
        seen["flag"] = decision_unresolved
        return real(c, cfg, region=region, decision_unresolved=decision_unresolved, budget=budget,
                    american=american)

    monkeypatch.setattr(G, "greeks", spy)
    c = ctx(is_call=False, strike=105.0, days=60, rho=0.05, sigma=0.3)
    a = oa.price(c)
    oa.phase3(c)
    assert seen["flag"] == (a.delta_reason == oa.D_DECISION)
    forced = dataclasses.replace(a, delta_status=oe.WITHHELD, delta=None, delta_reason=oa.D_DECISION)
    monkeypatch.setattr(oa, "price", lambda c, cfg, level_source: forced)
    oa.phase3(c)
    assert seen["flag"] is True


def _imports(path: Path) -> set[str]:
    out = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            out |= {f"{node.module}.{a.name}" for a in node.names} | {node.module or ""}
    return out


def test_no_served_module_imports_phase_3_code():
    served = [REPO / "src" / "desk" / "options_finder.py", REPO / "src" / "desk" / "options_math.py",
              REPO / "src" / "desk" / "options_engine.py"] + sorted((REPO / "api").rglob("*.py"))
    for path in served:
        for name in _imports(path):
            for p3 in ("options_adaptive", "options_greeks", "options_fd"):
                assert p3 not in name, (path, name)


def test_a_short_dated_analytic_price_more_than_half_a_tolerance_from_fd_is_cross_checked_inside_its_interval():
    # the dev pilot's G1-nodiv/3 inputs (bench-generated, invented): Tier 2 serves the interval midpoint about
    # 0.57 tol from the FD value; the FD value lies inside [L, U], so the price is cross-checked (P3-AM1)
    c = ctx(is_call=False, strike=109.880205, days=3, rho=-0.00871271, q=-0.01667728, sigma=0.76046348)
    a = oa.price(c)
    assert a.price_status == oe.ANALYTIC
    got = oa.phase3(c)
    xc = got.cross_check
    assert xc.diff > oa.XC_AGREE * xc.tol                     # the midpoint rule alone would say "disagree"
    assert a.audit["L"] <= xc.v_fd <= a.audit["U"]
    assert xc.status == oa.XC_CHECKED and got.price_status == oa.XC_CHECKED
