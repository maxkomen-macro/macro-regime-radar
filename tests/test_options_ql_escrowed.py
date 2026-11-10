"""The second corroborator Q and the corroboration rule (amendment P3-AM2, sections B-E). Synthetic contexts only."""

from __future__ import annotations

import math

import numpy as np
import pytest

ql = pytest.importorskip("QuantLib")

from scripts.options_bench import controls_p3 as C
from scripts.options_bench import greek_reference as GR
from scripts.options_bench import ql_escrowed as qe
from src.desk import options_greeks as G
from src.desk import options_math as om

CFG = G.GreekConfig()
DIV_PUT = om.Context(False, 100.0, 104.0, 120, 0.03, 0.015, 0.25, ((30, 1.2), (95, 0.8)))   # q ≠ 0, two dividends
NODIV_CALL = om.Context(True, 100.0, 95.0, 90, 0.02, 0.0, 0.3, ())                           # exempt (r ≥ 0, q ≤ 0)


# ── B: the model as solved ─────────────────────────────────────────────────

@pytest.mark.parametrize("is_call,level,want", [(False, 80.0, 20.0), (False, 120.0, 0.0), (True, 80.0, 0.0),
                                                 (True, 120.0, 20.0)])
def test_the_exercise_value_puts_the_sign_inside_the_positive_part(is_call, level, want):
    assert qe.exercise(level, 1.0 if is_call else -1.0, 100.0) == want


def test_days_zero_is_the_intrinsic_payoff_and_never_a_solve():
    c = om.Context(False, 90.0, 100.0, 0, 0.02, 0.0, 0.2, ())
    assert qe.solve(c, None, 1) == {"value": 10.0, "gamma": None, "cells": 0}


def test_every_step_lies_on_the_whole_day_grid_and_the_theta_pair_shares_it():
    n = 400
    m = qe.mesh(DIV_PUT, n)
    spd = qe.steps_per_day(DIV_PUT.days, n)
    later = G.one_day_later(DIV_PUT)
    for s in (DIV_PUT, later):
        trace: list = []
        qe.solve(s, m, spd, trace=trace)
        tau = s.days / qe.YEAR_DAYS
        k = [(tau - t) * qe.YEAR_DAYS * spd for t in trace]          # steps to expiry
        assert max(abs(x - round(x)) for x in k) < 1e-6
        assert len({round(x) for x in k}) == s.days * spd             # one call per step (a close is called twice)
        for d, _ in s.divs:                                           # every close is a grid node
            assert any(abs(x - (s.days - d) * spd) < 1e-6 for x in k)


def test_the_zero_copy_projection_is_bit_identical_to_element_wise_access():
    m = qe.mesh(DIV_PUT, 400)
    spd = qe.steps_per_day(DIV_PUT.days, 400)
    fast, slow = qe.solve(DIV_PUT, m, spd, fast=True), qe.solve(DIV_PUT, m, spd, fast=False)
    assert fast["value"] == slow["value"] and fast["gamma"] == slow["gamma"]


def test_the_view_refuses_a_wrong_size_so_the_slow_path_runs():
    a = ql.Array([1.0, 2.0, 3.0])
    assert qe._view(a, 4) is None
    v = qe._view(a, 3)
    v[1] = 7.0
    assert a[1] == 7.0


def test_the_european_mode_matches_the_closed_form_with_dividends_and_a_yield():
    sp = GR.spec(DIV_PUT, GR.PRICE, CFG)
    q = qe.study(DIV_PUT, sp, om.tolerance(4.0, 100.0), american=False)
    ex = C.exact(DIV_PUT, GR.PRICE)
    assert q["u_ref"] is not None and abs(q["G"] - ex) <= q["u_ref"] + q["u_bump"]


def test_an_exempt_american_call_equals_its_european_closed_form():
    for name in (GR.PRICE, G.GAMMA, G.VEGA):
        sp = GR.spec(NODIV_CALL, name, CFG)
        ex = C.exact(NODIV_CALL, name)
        tol = GR._tol(name, ex, NODIV_CALL.spot)
        q = qe.study(NODIV_CALL, sp, tol)
        assert not q["flags"] and abs(q["G"] - ex) <= 0.1 * tol, name


def test_the_american_put_agrees_with_quantlib_qdfp_without_dividends():
    c = om.Context(False, 100.0, 105.0, 200, 0.04, 0.01, 0.3, ())
    sp = GR.spec(c, GR.PRICE, CFG)
    tol = om.tolerance(8.0, 100.0)
    q = qe.study(c, sp, tol)
    from scripts.options_bench import cases
    ref = __import__("scripts.options_bench.crosscheck", fromlist=["quantlib"]).quantlib(
        cases.Case(id="t", group="t", kind="control", is_call=False, spot=100.0, strike=105.0, days=200, rho=0.04,
                   q=0.01, sigma=0.3))
    assert abs(q["G"] - ref["value"]) <= 0.1 * tol


def test_the_held_fixed_rules_are_the_stencils_of_the_reference():
    """Q reads the same Spec states as the FD and lattice sides: rho moves X through PV_0, S held."""
    sp = GR.spec(DIV_PUT, G.RHO, CFG)
    assert all(s.spot == DIV_PUT.spot for s in sp.states)
    assert sp.states[0].rho > DIV_PUT.rho > sp.states[1].rho


# ── C: the estimate ────────────────────────────────────────────────────────

TOL = 1.0


@pytest.mark.parametrize("seq,want", [
    ((0.0, 0.0, 0.0), 0.02),             # constant
    ((0.0, 0.0, 0.01), 0.02),            # a step from nothing, below the floor (DR-AM2-1)
    ((0.0, 0.0, 0.05), None),            # a step from nothing above the floor
    ((0.0, 0.04, 0.01), None),           # alternating above the floor (DR-AM2-1)
    ((0.0, 0.01, 0.005), 0.02),          # alternating below the floor
    ((0.0, 0.4, 0.6), 0.2),              # first order: u = d23
    ((0.0, 0.4, 0.5), 0.1),              # faster than first order: still u = d23 (ρ* = 1/2)
    ((0.0, 0.4, 0.7), 0.9),              # ρ = 0.75 is the slowest allowed: u = 0.3·0.75/0.25
])
def test_the_estimate_cases(seq, want):
    got = qe.estimate(list(seq), TOL)
    assert got == (pytest.approx(want) if want is not None else None)


def test_slower_than_three_quarters_is_not_converging():
    assert qe.estimate([0.0, 0.4, 0.72], TOL) is None


def test_the_factor_scales_the_tail_and_never_the_floor():
    assert qe.estimate([0.0, 0.4, 0.6], TOL, f_q=2.0) == pytest.approx(0.4)
    assert qe.estimate([0.0, 0.0, 0.0], TOL, f_q=2.0) == pytest.approx(0.02)


def test_the_escalation_runs_once_and_uses_the_last_three_levels(monkeypatch):
    seqs = {400: 0.0, 800: 0.04, 1600: 0.01, 3200: 0.005}   # alternating, then converging below the floor
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append((n, half))
        return seqs[n]
    monkeypatch.setattr(qe, "quantity", fake)
    sp = GR.spec(NODIV_CALL, GR.PRICE, CFG)
    q = qe.study(NODIV_CALL, sp, TOL)
    assert q["levels"] == [400, 800, 1600, 3200] and not q["flags"] and q["u_ref"] == pytest.approx(0.02)
    assert [n for n, _ in calls] == [400, 800, 1600, 3200]
    seqs[3200] = 0.06                                          # still alternating: final, no fifth level
    calls.clear()
    q = qe.study(NODIV_CALL, sp, TOL)
    assert q["flags"] == [qe.R_NOT_CONVERGING] and len(calls) == 4


def test_a_quantlib_error_is_a_refusal_never_a_value(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("negative variance")
    monkeypatch.setattr(qe, "quantity", boom)
    q = qe.study(NODIV_CALL, GR.spec(NODIV_CALL, GR.PRICE, CFG), TOL)
    assert q["G"] is None and q["flags"][0].startswith(qe.R_REFUSED)


def test_the_work_budget_stops_q_like_the_other_sides():
    budget = GR.RefBudget(1e5)
    with pytest.raises(GR.CapHit):
        qe.study(DIV_PUT, GR.spec(DIV_PUT, GR.PRICE, CFG), TOL, take=budget.take)


# ── D: the corroboration rule ──────────────────────────────────────────────

def fd(R=1.0, u_ref=0.01, u_bump=0.0, flags=()):
    return {"R": R, "u_ref": u_ref, "u_bump": u_bump, "flags": list(flags)}


def lat(Gv=1.0, u=0.01, ub=0.0, flags=()):
    return {"G": Gv, "u_seq": u, "u_bump": ub, "flags": list(flags)}


def qq(Gv=1.0, u=0.01, ub=0.0, flags=()):
    return {"G": Gv, "u_ref": u, "u_bump": ub, "flags": list(flags)}


def test_without_q_the_rule_is_the_approved_one_unchanged():
    for args in ((fd(), lat()), (fd(), lat(1.2)), (fd(u_ref=0.5), lat()), (fd(), None),
                 (fd(), lat(flags=[GR.R_NODE_NEAR]))):
        assert GR.resolve(1.0, *args) == GR._resolve_lattice_only(1.0, *args)


def test_both_corroborators_agreeing_resolve_with_the_larger_difference():
    got = GR.resolve(1.0, fd(), lat(1.03), qq(1.05))
    assert got["status"] == GR.RESOLVED and got["corroborated_by"] == ["lattice", "Q"] and got["u"] == pytest.approx(0.05)


def test_q_resolves_where_the_lattice_cannot():
    got = GR.resolve(1.0, fd(), lat(1.0, u=0.3), qq(1.02))
    assert got["status"] == GR.RESOLVED and got["corroborated_by"] == ["Q"]
    assert got["corroborators"]["lattice"]["why"] == ["lattice sequence uncertainty above 0.07 tolerances"]


def test_a_qualified_disagreement_unresolves_even_when_the_other_agrees():
    got = GR.resolve(1.0, fd(), lat(1.0), qq(1.2))
    assert got["status"].startswith("unresolved: " + GR.R_DISAGREE) and "Q differ by 0.2" in got["status"]


def test_an_unqualified_q_never_blocks_and_never_resolves():
    assert GR.resolve(1.0, fd(), lat(1.0), qq(5.0, flags=[qe.R_NOT_CONVERGING]))["status"] == GR.RESOLVED
    got = GR.resolve(1.0, fd(), lat(1.0, u=0.3), qq(1.0, u=None, flags=[qe.R_NOT_CONVERGING]))
    assert got["status"].startswith("unresolved") and qe.R_NOT_CONVERGING in got["status"]


def test_the_fd_side_must_meet_its_own_budgets_whatever_the_corroborators_say():
    got = GR.resolve(1.0, fd(u_bump=0.05), lat(1.0), qq(1.0))
    assert got["status"] == "unresolved: FD bump term above 0.03 tolerances"


def test_q_budgets_are_the_lattice_budgets():
    assert GR.resolve(1.0, fd(), lat(1.0, u=0.3), qq(1.0, u=0.08))["status"].startswith("unresolved")
    assert GR.resolve(1.0, fd(), lat(1.0, u=0.3), qq(1.0, ub=0.04))["status"].startswith("unresolved")
    assert GR.resolve(1.0, fd(), lat(1.0, u=0.3), qq(1.0, u=0.07, ub=0.03))["status"] == GR.RESOLVED


# ── E: C2-Q and the end-to-end reference ───────────────────────────────────

def test_c2_q_scores_the_european_estimate_against_the_closed_form():
    got = C.c2_q(DIV_PUT, CFG, quantities=(GR.PRICE, G.GAMMA, G.DIVIDEND))
    for k in (GR.PRICE, G.GAMMA, G.DIVIDEND):
        assert got[k]["status"] == "scored" and got[k]["covered"], k


def test_the_reference_runs_q_for_every_quantity_and_records_it():
    c = om.Context(False, 100.0, 102.0, 20, 0.03, 0.01, 0.3, ((8, 0.5),))
    refs = GR.references(c, CFG, quantities=(GR.PRICE, G.VEGA))
    for k in (GR.PRICE, G.VEGA):
        assert refs[k]["q"]["levels"][:3] == list(qe.LEVELS)
        assert "Q" in refs[k]["corroborators"]
    assert refs["_work"]["q_cells"] > 0
    off = GR.references(c, CFG, quantities=(GR.PRICE,), corroborate_q=False)
    assert "q" not in off[GR.PRICE] and "corroborators" not in off[GR.PRICE]


def test_the_run_config_carries_the_lattice_smoothing_apart_from_the_greek_config():
    from scripts.options_bench import run_p3
    assert run_p3.greek_config({"smooth_divs": True}) == G.GreekConfig()
    assert run_p3.greek_config({"smooth_divs": True, "h_r": 2.5e-4}).h_r == 2.5e-4


# ── P3-AM3: the mesh at the payoff kink, the time step halving per level, the FD bump term on the finest grid ──

def test_every_level_halves_the_time_step_with_the_space_step():
    for days in (1, 9, 120, 399, 400, 401, 1278, om.DAYS_MAX):
        spd = [qe.steps_per_day(days, n) for n in qe.LEVELS + (qe.ESCALATE,)]
        assert spd == [spd[0], 2 * spd[0], 4 * spd[0], 8 * spd[0]] and spd[0] == max(1, math.ceil(400 / days))
    # under P3-AM2's ceil(n/days) a 1,278-day context stepped 1, 1, 2, 3 per day: the sequence did not refine time
    assert [max(1, -(-n // 1278)) for n in (400, 800, 1600, 3200)] == [1, 1, 2, 3]
    with pytest.raises(ValueError):
        qe.steps_per_day(120, 1200)


def test_the_mesh_concentrates_at_the_expiry_kink_not_at_k_minus_pv0():
    c = om.Context(False, 100.0, 104.0, 120, 0.03, 0.015, 0.25, ((30, 10.0), (95, 10.0)))   # K − PV_0 ≈ 84
    kink = c.strike                            # no dividend at expiry: PV_τ = 0, the payoff kinks at X = K
    for n in (400, 1600):
        m1, kx = qe.mesh(c, n)
        assert kx == pytest.approx(c.strike - qe._pv(c)[0](0.0))
        lx = np.array(m1.locations())
        step = np.diff(lx)
        at = lambda x: step[min(int(np.searchsorted(lx, math.log(x))), len(step) - 1)]
        assert at(kink) == pytest.approx(step.min(), rel=1e-3)          # the finest cells sit at the kink
        assert at(kink) < 0.65 * np.median(step)
        assert at(kx) > 1.5 * at(kink)                                   # and not at K − PV_0
