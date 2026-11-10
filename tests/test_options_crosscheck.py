"""Tier 2's Phase 3 cross-check and Greek block (design-P3-approved.md sections 10 and 15; build step 7).

price() must keep every number of adaptive-p2.1: the routine subset (the golden file's cases) is priced by the
current module and by the verbatim 2ff3e8b file (tests/fixtures/options_pre_phase3/, checked by its git blob id)
in the same process and compared bit for bit, the version string apart. The cross-check's status rule is tested at
its thresholds on hand-built FD solves, then end to end. Nothing is served: no served module imports Phase 3 code.
"""

from __future__ import annotations

import ast
import dataclasses
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


def test_only_estimated_and_analytic_prices_are_checked():
    a = _est(V)
    assert oa.cross_check(C, dataclasses.replace(a, price_status=oe.ANALYTIC), _base(V, V)).status == oa.XC_CHECKED
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
