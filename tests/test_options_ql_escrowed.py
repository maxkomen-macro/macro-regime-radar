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
    n = qe.LEVELS[0]
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
    m = qe.mesh(DIV_PUT, qe.LEVELS[0])
    spd = qe.steps_per_day(DIV_PUT.days, qe.LEVELS[0])
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
    n1, n2, n3, n4 = qe.LEVELS + (qe.ESCALATE,)
    seqs = {n1: 0.0, n2: 0.04, n3: 0.01, n4: 0.005}         # alternating, then converging below the floor
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append((n, half))
        return seqs[n]
    monkeypatch.setattr(qe, "quantity", fake)
    sp = GR.spec(NODIV_CALL, GR.PRICE, CFG)
    q = qe.study(NODIV_CALL, sp, TOL)
    assert q["levels"] == [n1, n2, n3, n4] and not q["flags"] and q["u_ref"] == pytest.approx(0.02)
    assert [n for n, _ in calls] == [n1, n2, n3, n4]
    seqs[n4] = 0.06                                            # still alternating: final, no fifth level
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
    for days in (1, 9, 120, 399, 400, 401, 511, 512, 513, 1278, om.DAYS_MAX):
        spd = [qe.steps_per_day(days, n) for n in qe.LEVELS + (qe.ESCALATE,)]
        assert spd == [spd[0], 2 * spd[0], 4 * spd[0], 8 * spd[0]] and spd[0] == max(1, math.ceil(qe.LEVELS[0] / days))
    # under P3-AM2's ceil(n/days) a 1,278-day context stepped 1, 1, 2, 3 per day: the sequence did not refine time
    assert [max(1, -(-n // 1278)) for n in (400, 800, 1600, 3200)] == [1, 1, 2, 3]
    with pytest.raises(ValueError):
        qe.steps_per_day(120, 1200)


def test_the_mesh_concentrates_at_the_expiry_kink_not_at_k_minus_pv0():
    c = om.Context(False, 100.0, 104.0, 120, 0.03, 0.015, 0.25, ((30, 15.0), (95, 15.0)))   # K − PV_0 ≈ 74
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



# ── P3-AM4: the wider mesh span and Q's two four-level estimates ──────────

def test_the_mesh_span_cuts_the_tail_at_one_in_a_million():
    assert qe.MESH_EPS == 1e-6
    c = om.Context(True, 100.0, 90.0, 300, 0.02, 0.0, 3.5, ())          # extreme volatility
    lo4 = ql.FdmBlackScholesMesher(400, qe._process(c, 100.0), 300 / 365, 90.0, ql.nullDouble(), ql.nullDouble(),
                                   1e-4, 1.5, (90.0, qe.DENSITY)).locations()
    lx = np.array(qe.mesh(c, 400)[0].locations())
    assert lx[0] < lo4[0] and lx[-1] > lo4[len(lo4) - 1]                # wider than P3-AM3's span on both sides


@pytest.mark.parametrize("g", [[5.021, 2.634, 1.305, 0.648],            # dev T1-near-boundary/30 gamma: ratios 0.5
                               [0.0, 0.3, 0.477, 0.58143]])              # DR-AM4-1: ratio 0.59, limit 0.7317
def test_a_monotone_sequence_is_never_extrapolated(g):
    assert qe.estimate4(g, 1.0) is None                                  # no first-order rescue (DR-AM4-1)


def test_a_shrinking_alternation_is_bounded_by_its_last_step():
    assert qe.estimate4([0.0, 1.0, 0.5, 1.0], 1.0) is None                # d_2 = d_3: does not shrink strictly
    assert qe.estimate4([0.0, 1.0, 0.5, 0.5 + 0.6], 1.0) is None          # d_3 > d_2: growing alternation
    g = [0.037, -0.020, 0.011, -0.005]                                    # dev G2-dividends/85 rho shape, in tol
    kind, R, u = qe.estimate4(g, 1.0)
    assert kind == "alternating" and R == -0.005
    assert u == pytest.approx(qe.FLOOR)                                   # d_3 = 0.016 < floor
    kind, R, u = qe.estimate4([0.0, 0.4, 0.1, 0.3], 2.0)                  # d = 0.2, 0.15, 0.1 of tol 2
    assert kind == "alternating" and R == 0.3 and u == pytest.approx(0.2)  # F_Q·d_3·tol = 0.1·2
    assert qe.estimate(g[1:], 1.0) is None                               # rule C: alternating, not converging


def test_three_levels_never_take_a_branch():
    assert qe.estimate4([1.0, 0.5, 0.25], 1.0) is None


def test_study_uses_a_branch_only_when_rule_c_leaves_it_unqualified(monkeypatch):
    n1, n2, n3, n4 = qe.LEVELS + (qe.ESCALATE,)
    seqs = {n1: 0.037, n2: -0.020, n3: 0.011, n4: -0.005}               # a shrinking alternation, in tol
    monkeypatch.setattr(qe, "quantity", lambda c, sp, n, american, half, cache, take: seqs[n])
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    out = qe.study(DIV_PUT, sp, 1.0)
    assert out["branch"] == "alternating" and out["flags"] == [] and out["levels"] == [n1, n2, n3, n4]
    assert out["G"] == -0.005 and out["u_ref"] == pytest.approx(qe.FLOOR)
    seqs.update({n1: 5.021, n2: 2.634, n3: 1.305, n4: 0.648})     # first order: rule C over budget, no branch
    out = qe.study(DIV_PUT, sp, 1.0)
    assert out["branch"] is None and out["flags"] and out["G"] == 0.648
    seqs.update({n1: 1.0, n2: 1.0 + 0.04, n3: 1.0 + 0.05})                # rule C qualifies: no escalation, no branch
    out = qe.study(DIV_PUT, sp, 1.0)
    assert out["branch"] is None and out["levels"] == [n1, n2, n3] and out["G"] == 1.05


# ── P3-AM5: Q's levels after the span change ──────────────────────────────────

def _cell_at_x0(m1, x0):
    lx = np.array(m1.locations())
    j = int(np.searchsorted(lx, math.log(x0)))
    return lx[j] - lx[j - 1]


def test_the_levels_restore_the_cell_at_x0_that_the_wider_span_took():
    assert qe.LEVELS == (512, 1024, 2048) and qe.ESCALATE == 4096
    # P3-AM5's mesh check: at eps 1e-6 the first level's cell at X_0 is within 3% of P3-AM3's (eps 1e-4, n = 400),
    # where 400 at eps 1e-6 (P3-AM4 as built) was about 28% wider
    for c in (DIV_PUT, NODIV_CALL, om.Context(True, 100.0, 95.0, 400, 0.03, 0.0, 0.25, ((100, 1.0), (280, 1.0)))):
        pv, _ = qe._pv(c)
        x0 = c.spot - pv(0.0)
        kx = max(c.strike - pv(0.0), 1e-3 * c.strike)
        kink = max(c.strike - pv(max(c.days, 1) / qe.YEAR_DAYS), 1e-3 * c.strike)
        old = ql.FdmBlackScholesMesher(400, qe._process(c, x0), max(c.days, 1) / qe.YEAR_DAYS, kx, ql.nullDouble(),
                                       ql.nullDouble(), 1e-4, 1.5, (kink, qe.DENSITY))
        was, now = _cell_at_x0(old, x0), _cell_at_x0(qe.mesh(c, qe.LEVELS[0])[0], x0)
        wide = _cell_at_x0(qe.mesh(c, 400)[0], x0)
        assert abs(now / was - 1.0) < 0.03 and wide / was > 1.15, (c, was, now, wide)


# ── P3-AM6 B.2: Q+, one more level after the escalation ──────────────────────

def _q_fake(monkeypatch, seqs, calls=None, half_shift=0.0):
    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        if calls is not None:
            calls.append((n, half))
        return seqs[n] + (half_shift * n / qe.EXTRA if half else 0.0)     # a bump term that grows with n, so the
                                                                             # level it is read at is visible
    monkeypatch.setattr(qe, "quantity", fake)


def test_steps_per_day_at_the_q_plus_level_keep_the_first_level_s_rule():
    assert [qe.steps_per_day(d, qe.EXTRA) for d in (1, 511, 512, 513, 1464)] == [8192, 32, 16, 16, 16]
    assert qe.EXTRA == 2 * qe.ESCALATE


def test_pass_1_never_reaches_the_q_plus_level(monkeypatch):
    n1, n2, n3, n4 = qe.LEVELS + (qe.ESCALATE,)
    calls = []
    _q_fake(monkeypatch, {n1: 0.0, n2: 0.04, n3: 0.01, n4: 0.06}, calls)     # unqualified after the escalation
    out = qe.study(NODIV_CALL, GR.spec(NODIV_CALL, GR.PRICE, CFG), TOL)
    assert out["flags"] and qe.EXTRA not in [n for n, _ in calls] and out["levels"] == [n1, n2, n3, n4]
    assert qe.extra_eligible(out)


def test_q_plus_runs_rule_c_on_the_last_three_levels_and_the_bump_term_at_8192(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    seqs = {n1: 5.021, n2: 2.634, n3: 1.305, n4: 0.648}             # first order: unqualified after 4096
    calls = []
    _q_fake(monkeypatch, seqs, calls, half_shift=0.01)
    sp = GR.spec(DIV_PUT, G.VEGA, CFG)
    assert sp.h is not None
    first = qe.study(DIV_PUT, sp, 1.0)
    assert first["flags"] and qe.extra_eligible(first) and first["u_bump"] == pytest.approx(0.005)
    seqs[n5] = 0.648 - 0.003                                       # 2048..8192 settle: rule C qualifies
    calls.clear()
    out = qe.study(DIV_PUT, sp, 1.0, extend=first)
    assert [n for n, h in calls if not h] == [n5]                               # only the new level is solved
    assert out["levels"] == [n1, n2, n3, n4, n5] and out["values"][:4] == first["values"]
    assert out["u_ref"] == qe.estimate([seqs[n3], seqs[n4], seqs[n5]], 1.0)
    assert out["flags"] == [] and out["G"] == seqs[n5] and out["branch"] is None
    assert (n5, True) in calls and out["u_bump"] == pytest.approx(0.01)       # the bump term at 8192


def test_q_plus_takes_the_alternating_estimate_on_1024_to_8192_only(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    seqs = {n1: 0.097, n2: 0.037, n3: -0.020, n4: 0.011, n5: -0.005}  # 512 breaks the alternation; 1024..8192 hold it
    _q_fake(monkeypatch, seqs)
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    first = qe.study(DIV_PUT, sp, 1.0)
    assert first["flags"] and first["branch"] is None
    out = qe.study(DIV_PUT, sp, 1.0, extend=first)
    assert out["branch"] == "alternating" and out["flags"] == [] and out["G"] == -0.005
    assert out["u_ref"] == pytest.approx(qe.FLOOR)


def test_q_plus_left_unqualified_is_still_q_s_result(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    _q_fake(monkeypatch, {n1: 0.0, n2: 0.04, n3: 0.01, n4: 0.06, n5: 0.2})
    sp = GR.spec(NODIV_CALL, GR.PRICE, CFG)
    first = qe.study(NODIV_CALL, sp, TOL)
    out = qe.study(NODIV_CALL, sp, TOL, extend=first)
    assert out["flags"] and out["levels"][-1] == n5 and out["G"] == 0.2


def test_q_plus_is_eligible_only_after_an_unqualified_escalation():
    n = list(qe.LEVELS)
    assert not qe.extra_eligible({"flags": [], "levels": n + [qe.ESCALATE]})
    assert not qe.extra_eligible({"flags": [qe.R_NOT_CONVERGING], "levels": n})
    assert not qe.extra_eligible({"flags": [f"{qe.R_REFUSED}: boom"], "levels": n + [qe.ESCALATE]})
    assert not qe.extra_eligible({"flags": [qe.R_NOT_CONVERGING], "levels": n + [qe.ESCALATE, qe.EXTRA]})
    assert qe.extra_eligible({"flags": ["Q bump term above 0.03 tolerances"], "levels": n + [qe.ESCALATE]})
    with pytest.raises(ValueError):
        qe.study(NODIV_CALL, GR.spec(NODIV_CALL, GR.PRICE, CFG), TOL, extend={"flags": [], "levels": n})


def test_q_plus_is_charged_before_its_solve():
    budget = GR.RefBudget(1e5)
    sp = GR.spec(NODIV_CALL, GR.PRICE, CFG)
    first = {"G": 1.0, "u_ref": None, "u_bump": 0.0, "flags": [qe.R_NOT_CONVERGING],
             "levels": list(qe.LEVELS) + [qe.ESCALATE], "values": [1.0, 1.1, 1.0, 1.1]}
    with pytest.raises(GR.CapHit):
        qe.study(NODIV_CALL, sp, TOL, take=budget.take, extend=first)
    assert budget.used == 0.0


@pytest.mark.parametrize("cap_on_plus", [False, True])
def test_c2_q_extends_an_unqualified_study_with_q_plus_like_the_references(monkeypatch, cap_on_plus):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    tol = GR._tol(G.GAMMA, 0.645, DIV_PUT.spot)
    seqs = {n: 0.645 + tol * (g - 0.645)                                 # in tolerances: unqualified at 4096,
            for n, g in ((n1, 5.021), (n2, 2.634), (n3, 1.305), (n4, 0.648), (n5, 0.645))}   # 2048..8192 qualify
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append((n, american))
        if cap_on_plus and n == n5:
            raise GR.CapHit("Q+")
        return seqs[n]
    monkeypatch.setattr(qe, "quantity", fake)
    monkeypatch.setattr(C, "exact", lambda c, k: 0.645)
    got = C.c2_q(DIV_PUT, CFG, quantities=(G.GAMMA,))[G.GAMMA]
    assert (n5, False) in calls                                         # European, as the control requires
    if cap_on_plus:
        assert got["deep"]["status"] == GR.R_DEEP_CAP and got["levels"] == [n1, n2, n3, n4]   # the shallow study stands
    else:
        assert got["status"] == "scored" and got["levels"][-1] == n5 and got["within_budget"] and got["covered"]


# ── P3-AM7 B.2: Q++, up to two more levels for gamma ───────────────────────────

def _q_through_8192(values, flags=(qe.R_NOT_CONVERGING,)):
    return {"G": values[-1], "u_ref": None, "u_bump": 0.0, "flags": list(flags),
            "levels": list(qe.LEVELS) + [qe.ESCALATE, qe.EXTRA], "values": list(values), "branch": None}


def test_steps_per_day_at_the_q_plus_plus_levels_keep_the_first_level_s_rule():
    assert qe.DEEP == (16384, 32768) and qe.DEEP[0] == 2 * qe.EXTRA
    assert [qe.steps_per_day(d, 16384) for d in (1, 511, 512, 513, 1464)] == [16384, 64, 32, 32, 32]
    assert [qe.steps_per_day(d, 32768) for d in (1, 511, 512, 513, 1464)] == [32768, 128, 64, 64, 64]


def test_q_plus_plus_is_eligible_only_after_an_unqualified_q_plus():
    n = list(qe.LEVELS) + [qe.ESCALATE]
    assert qe.deep_eligible({"flags": [qe.R_NOT_CONVERGING], "levels": n + [qe.EXTRA]})
    assert qe.deep_eligible({"flags": ["Q refinement uncertainty above 0.07 tolerances"], "levels": n + [qe.EXTRA]})
    assert not qe.deep_eligible({"flags": [], "levels": n + [qe.EXTRA]})                      # qualified at 8192
    assert not qe.deep_eligible({"flags": [qe.R_NOT_CONVERGING], "levels": n})               # Q+ never ran
    assert not qe.deep_eligible({"flags": [f"{qe.R_REFUSED}: boom"], "levels": n + [qe.EXTRA]})
    assert not qe.deep_eligible({"flags": [qe.R_NOT_CONVERGING], "levels": n + [qe.EXTRA, qe.DEEP[0]]})


def test_q_plus_plus_is_for_gamma_only_and_needs_an_eligible_study():
    first = _q_through_8192([1.0, 1.1, 1.0, 1.1, 1.0])
    with pytest.raises(ValueError):
        qe.study(NODIV_CALL, GR.spec(NODIV_CALL, GR.PRICE, CFG), TOL, deepen=first)
    with pytest.raises(ValueError):
        qe.study(NODIV_CALL, GR.spec(NODIV_CALL, G.VEGA, CFG), TOL, deepen=first)
    with pytest.raises(ValueError):
        qe.study(NODIV_CALL, GR.spec(NODIV_CALL, G.GAMMA, CFG), TOL, deepen={**first, "flags": []})


def test_q_plus_plus_stops_at_the_first_level_where_q_qualifies(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    d1, d2 = qe.DEEP
    seqs = {n1: 1.6, n2: 0.8, n3: 0.4, n4: 0.2, n5: 0.1, d1: 0.05, d2: 0.025}   # first order, in tolerances
    calls = []
    _q_fake(monkeypatch, seqs, calls)
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    first = _q_through_8192([seqs[n] for n in (n1, n2, n3, n4, n5)])
    assert qe.estimate([seqs[n3], seqs[n4], seqs[n5]], 1.0) > 0.07                 # unqualified at 8192
    out = qe.study(DIV_PUT, sp, 1.0, deepen=first)
    assert [n for n, _ in calls] == [d1]                                          # 32768 is never solved
    assert out["levels"] == [n1, n2, n3, n4, n5, d1] and out["values"][:5] == first["values"]
    assert out["flags"] == [] and out["G"] == seqs[d1]
    assert out["u_ref"] == qe.estimate([seqs[n4], seqs[n5], seqs[d1]], 1.0) == pytest.approx(0.05)


def test_q_plus_plus_goes_to_32768_and_never_beyond(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    d1, d2 = qe.DEEP
    seqs = {n1: 0.0, n2: 0.4, n3: 0.72, n4: 0.98, n5: 1.19, d1: 1.36, d2: 1.50}   # ratio 0.8: never converging
    calls = []
    _q_fake(monkeypatch, seqs, calls)
    out = qe.study(DIV_PUT, GR.spec(DIV_PUT, G.GAMMA, CFG), 1.0,
                   deepen=_q_through_8192([seqs[n] for n in (n1, n2, n3, n4, n5)]))
    assert [n for n, _ in calls] == [d1, d2]
    assert out["levels"][-1] == d2 and qe.R_NOT_CONVERGING in out["flags"] and out["G"] == seqs[d2]


def test_q_plus_plus_at_32768_takes_the_alternating_estimate_on_the_last_four_levels(monkeypatch):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    d1, d2 = qe.DEEP
    seqs = {n1: 0.0, n2: 0.0, n3: 0.0, n4: 0.3, n5: 0.1, d1: 0.25, d2: 0.20}   # 8192..32768 alternate and shrink
    _q_fake(monkeypatch, seqs)
    out = qe.study(DIV_PUT, GR.spec(DIV_PUT, G.GAMMA, CFG), 1.0,
                   deepen=_q_through_8192([seqs[n] for n in (n1, n2, n3, n4, n5)]))
    assert out["levels"][-1] == d2 and out["branch"] == "alternating" and out["flags"] == []
    assert out["G"] == seqs[d2] and out["u_ref"] == pytest.approx(0.05)


def test_q_plus_plus_is_charged_before_its_solve():
    budget = GR.RefBudget(1e5)
    sp = GR.spec(NODIV_CALL, G.GAMMA, CFG)
    with pytest.raises(GR.CapHit):
        qe.study(NODIV_CALL, sp, TOL, take=budget.take, deepen=_q_through_8192([1.0, 1.1, 1.0, 1.1, 1.0]))
    assert budget.used == 0.0


@pytest.mark.parametrize("k", [G.GAMMA, G.VEGA])
def test_c2_q_runs_q_plus_plus_for_gamma_only_like_the_references(monkeypatch, k):
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    d1 = qe.DEEP[0]
    ex = 0.645
    tol = GR._tol(k, ex, DIV_PUT.spot)
    steps = {n1: 1.6, n2: 0.8, n3: 0.4, n4: 0.2, n5: 0.1, d1: 0.05}          # first order, qualifies at 16384
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append(n)
        return ex + tol * (steps[n] - 0.05) + (0.0 if not half else 0.0)
    monkeypatch.setattr(qe, "quantity", fake)
    monkeypatch.setattr(C, "exact", lambda c, kk: ex)
    got = C.c2_q(DIV_PUT, CFG, quantities=(k,))[k]
    if k == G.GAMMA:
        assert d1 in calls and got["status"] == "scored" and got["levels"][-1] == d1 and got["deep"]["q_plus_plus"]
    else:
        assert d1 not in calls and got["levels"][-1] == n5


def test_c2_q_runs_gamma_s_q_plus_plus_after_every_quantity_s_study(monkeypatch):
    """Code review S-AM7-1: a later quantity's study gets the budget it had before Q++ existed."""
    n1, n2, n3, n4, n5 = qe.LEVELS + (qe.ESCALATE, qe.EXTRA)
    d1 = qe.DEEP[0]
    ex = 0.645
    steps = {n1: 1.6, n2: 0.8, n3: 0.4, n4: 0.2, n5: 0.1, d1: 0.05}
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append((sp.name, n))
        take(9.5 if n == d1 else 0.1)
        return ex + GR._tol(sp.name, ex, c.spot) * (steps[n] - 0.05 if sp.name == G.GAMMA else 0.0)
    monkeypatch.setattr(qe, "quantity", fake)
    monkeypatch.setattr(C, "exact", lambda c, kk: ex)
    got = C.c2_q(DIV_PUT, CFG, quantities=(G.GAMMA, G.VEGA), cap=10.0)
    assert calls.index((G.GAMMA, d1)) > max(i for i, (k, _) in enumerate(calls) if k == G.VEGA)
    assert got[G.VEGA]["status"] == "scored" and list(got) == [G.GAMMA, G.VEGA, "_work"]
    assert got[G.GAMMA]["deep"]["deep3"] == GR.R_DEEP_CAP and got[G.GAMMA]["levels"][-1] == n5


# ── P3-AM8: the read-out conditioning term on Q's returned gamma ───────────────

class _Locs:
    def __init__(self, xs):
        self.xs = list(xs)

    def locations(self):
        return self.xs


def _fake_mesh(monkeypatch, xs):
    built = []

    def fake(c, n):
        built.append(n)
        return (_Locs(xs), c.strike)
    monkeypatch.setattr(qe, "mesh", fake)
    return built


def _no_solve(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("u_cond must not solve")
    monkeypatch.setattr(qe, "solve", boom)
    monkeypatch.setattr(qe, "quantity", boom)


@pytest.mark.parametrize("strike", [80.0, 100.0, 125.0])
def test_u_cond_is_eps_max_s_k_sqrt_nt_over_h2_x02_from_the_cell_containing_x0(monkeypatch, strike):
    c = om.Context(True, 100.0, strike, 90, 0.02, 0.0, 0.3, ())          # no dividend: X_0 = S
    l0 = math.log(100.0)
    _fake_mesh(monkeypatch, [l0 - 0.5, l0 - 0.03, l0 + 0.02, l0 + 0.4])   # ln X_0 inside the 0.05-wide cell
    _no_solve(monkeypatch)
    n = 1024
    nt = 90 * qe.steps_per_day(90, n)
    h = (l0 + 0.02) - (l0 - 0.03)
    want = qe.EPS * max(100.0, strike) * math.sqrt(nt) / (h * h * 100.0 * 100.0)
    assert qe.EPS == 2.0 ** -52
    assert qe.u_cond(c, n) == pytest.approx(want, rel=1e-12)


def test_u_cond_at_a_node_takes_the_smaller_of_its_two_cells(monkeypatch):
    c = om.Context(False, 100.0, 105.0, 30, 0.02, 0.0, 0.3, ())
    l0 = math.log(100.0)
    _fake_mesh(monkeypatch, [l0 - 0.2, l0 - 0.04, l0, l0 + 0.01, l0 + 0.3])
    _no_solve(monkeypatch)
    nt = 30 * qe.steps_per_day(30, 512)
    assert qe.u_cond(c, 512) == pytest.approx(qe.EPS * 105.0 * math.sqrt(nt) / (0.01 ** 2 * 1e4), rel=1e-9)


def test_u_cond_reads_x0_net_of_the_dividends_owed():
    c = DIV_PUT
    pv, _ = qe._pv(c)
    x0 = c.spot - pv(0.0)
    lx = np.array(qe.mesh(c, 512)[0].locations())
    i = int(np.searchsorted(lx, math.log(x0)))
    h = lx[i] - lx[i - 1]
    nt = c.days * qe.steps_per_day(c.days, 512)
    assert qe.u_cond(c, 512) == pytest.approx(qe.EPS * max(c.spot, c.strike) * math.sqrt(nt) / (h * h * x0 * x0),
                                              rel=1e-12)


def test_u_cond_outside_the_mesh_is_an_error_never_a_number(monkeypatch):
    c = om.Context(True, 100.0, 95.0, 30, 0.02, 0.0, 0.3, ())
    _fake_mesh(monkeypatch, [math.log(200.0), math.log(300.0)])
    with pytest.raises(ValueError):
        qe.u_cond(c, 512)


def test_u_cond_grows_four_root_two_per_level_and_uses_the_shared_mesh_cache(monkeypatch):
    got = [qe.u_cond(DIV_PUT, n) for n in (512, 1024, 2048, 4096, 8192)]
    for a, b in zip(got, got[1:]):
        assert b / a == pytest.approx(4.0 * math.sqrt(2.0), rel=0.03)
    cache = {("mesh", DIV_PUT, 2048): qe.mesh(DIV_PUT, 2048)}
    built = []
    monkeypatch.setattr(qe, "mesh", lambda c, n: built.append(n))
    assert qe.u_cond(DIV_PUT, 2048, cache) == got[2] and built == []      # the mesh `quantity` cached is reused


def _qs(u, flags=(), levels=(512, 1024, 2048), G_=0.5):
    return {"G": G_, "u_ref": u, "u_bump": 0.0, "flags": list(flags), "levels": list(levels),
            "values": [G_] * len(levels), "branch": None}


def test_the_guard_is_for_gamma_only_and_leaves_a_study_without_u_rule_as_it_is(monkeypatch):
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: 0.05)
    for k in [q for q in GR.QUANTITIES if q != G.GAMMA]:
        sp = GR.spec(DIV_PUT, k, CFG)
        qs = _qs(0.065)
        assert qe.conditioned(DIV_PUT, sp, qs, 1.0) is qs
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    assert qe.conditioned(DIV_PUT, sp, None, 1.0) is None
    for qs in (_qs(None, [qe.R_NOT_CONVERGING]), {**_qs(None, [f"{qe.R_REFUSED}: boom"]), "G": None},
               _qs(0.01, levels=())):
        assert qe.conditioned(DIV_PUT, sp, qs, 1.0) is qs


@pytest.mark.parametrize("u_rule,uc,flagged", [(0.05, 0.01, False), (0.065, 0.01, True), (0.07, 1e-12, True),
                                               (0.069, 0.001, False)])
def test_the_guard_adds_u_cond_at_n_ret_and_flags_only_a_crossing_of_the_budget(monkeypatch, u_rule, uc, flagged):
    seen = []
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: seen.append(n) or uc)
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    qs = _qs(u_rule, levels=list(qe.LEVELS) + [qe.ESCALATE])
    got = qe.conditioned(DIV_PUT, sp, qs, 1.0)
    assert seen == [qe.ESCALATE] and got["n_ret"] == qe.ESCALATE
    assert got["u_rule"] == u_rule and got["u_cond"] == uc and got["u_ref"] == u_rule + uc
    assert (qe.R_CONDITIONING in got["flags"]) is flagged and bool(got["flags"]) is flagged
    for k in ("G", "u_bump", "levels", "values", "branch"):
        assert got[k] == qs[k]
    assert qs["u_ref"] == u_rule and qs["flags"] == []                       # the study as run is not changed


def test_an_already_unqualified_study_keeps_its_flags_and_gains_no_conditioning_flag(monkeypatch):
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: 0.01)
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    f = "Q refinement uncertainty above 0.07 tolerances"
    got = qe.conditioned(DIV_PUT, sp, _qs(0.08, [f]), 1.0)
    assert got["flags"] == [f] and got["u_ref"] == pytest.approx(0.09)


def test_a_u_cond_that_cannot_be_computed_leaves_q_unqualified(monkeypatch):
    def boom(c, n, cache=None):
        raise ValueError("X_0 outside the mesh")
    monkeypatch.setattr(qe, "u_cond", boom)
    got = qe.conditioned(DIV_PUT, GR.spec(DIV_PUT, G.GAMMA, CFG), _qs(0.01), 1.0)
    assert got["u_cond"] is None and got["flags"][-1].startswith(qe.R_CONDITIONING_NA) and got["G"] == 0.5


def test_dr_am8_1_the_study_stops_where_it_stopped_and_the_guard_disqualifies_it(monkeypatch):
    """Design review DR-AM8-1: gamma 0, 0.139, 0.2085, 0.2185 tolerances, exact 0.17, u_cond 0.001 at 2048 and
    0.005657 at 4096. The fixed path stops at 2048 (u_rule 0.0695) and the guard turns that into 0.0705."""
    n1, n2, n3, n4 = qe.LEVELS + (qe.ESCALATE,)
    seqs = {n1: 0.0, n2: 0.139, n3: 0.2085, n4: 0.2185}
    calls = []
    _q_fake(monkeypatch, seqs, calls)
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: {n3: 0.001, n4: 0.005657}[n])
    sp = GR.spec(DIV_PUT, G.GAMMA, CFG)
    qs = qe.study(DIV_PUT, sp, 1.0)
    assert [n for n, _ in calls] == [n1, n2, n3] and qs["flags"] == []          # no 4096 solve
    assert qs["G"] == 0.2085 and qs["u_ref"] == pytest.approx(0.0695)
    got = qe.conditioned(DIV_PUT, sp, qs, 1.0)
    assert got["u_ref"] == pytest.approx(0.0705) and got["flags"] == [qe.R_CONDITIONING] and got["G"] == 0.2085
    assert abs(got["G"] - 0.17) <= got["u_ref"]                                # no miss
    assert [n for n, _ in calls] == [n1, n2, n3]


G5_95 = om.Context(True, 100.0, 77.1641, 5, 0.02876384, -0.02111457, 0.00631083, ((3, 1.5895),))
G5_95_GAMMA = [-1.17e-08, 4.13e-09, -2.55e-08, 5.8646e-07, 1.29657e-05, 1.59023e-05, -1.55383e-05]  # 512..32768


def test_g5_95_s_stored_values_with_its_own_u_cond(monkeypatch):
    """The recorded C2-Q++ miss (A): forced to end at 16384, rule C qualified 1.59e-5 with u 2.94e-6 against an
    exact 0 at tol 1e-4. With the guard, every end level where the noise rules (4096 and 16384) is unqualified,
    the value is unchanged, and the built path's 2048 result stays qualified and covered."""
    tol = 1e-4
    levels = list(qe.LEVELS) + [qe.ESCALATE, qe.EXTRA] + list(qe.DEEP)
    sp = GR.spec(G5_95, G.GAMMA, CFG)
    for i, want_q in ((2, True), (3, False), (5, False)):
        u = qe.estimate(G5_95_GAMMA[i - 2:i + 1], tol)
        assert u is not None and u <= 0.07 * tol                                # qualified unguarded
        qs = {"G": G5_95_GAMMA[i], "u_ref": u, "u_bump": 0.0, "flags": [], "levels": levels[:i + 1],
              "values": G5_95_GAMMA[:i + 1], "branch": None}
        got = qe.conditioned(G5_95, sp, qs, tol)
        assert got["G"] == G5_95_GAMMA[i] and got["u_cond"] == qe.u_cond(G5_95, levels[i])
        assert (not got["flags"]) is want_q, levels[i]
        if i == 5:
            assert abs(qs["G"]) > qs["u_ref"]                                    # A's miss, unguarded
        if want_q:
            assert abs(got["G"]) <= got["u_ref"]


def _guarded(monkeypatch, q, uc=0.01):
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: uc)
    return qe.conditioned(DIV_PUT, GR.spec(DIV_PUT, G.GAMMA, CFG), {**q, "levels": [2048]}, 1.0)


def test_rule_d_i_q_the_only_agreeing_corroborator_disqualified_leaves_the_reference_unresolved(monkeypatch):
    q = qq(1.02, u=0.065)
    before = GR.resolve(1.0, fd(), lat(1.0, u=0.3), q)
    assert before["status"] == GR.RESOLVED and before["corroborated_by"] == ["Q"]
    after = GR.resolve(1.0, fd(), lat(1.0, u=0.3), _guarded(monkeypatch, q))
    assert after["status"].startswith("unresolved") and qe.R_CONDITIONING in after["status"]


def test_rule_d_ii_a_disqualified_dissenter_no_longer_blocks(monkeypatch):
    q = qq(1.2, u=0.065)
    before = GR.resolve(1.0, fd(), lat(1.0), q)
    assert before["status"].startswith("unresolved: " + GR.R_DISAGREE)
    after = GR.resolve(1.0, fd(), lat(1.0), _guarded(monkeypatch, q))
    assert after["status"] == GR.RESOLVED and after["corroborated_by"] == ["lattice"]
    assert after == GR.resolve(1.0, fd(), lat(1.0), qq(1.2, u=0.075, flags=[qe.R_CONDITIONING]))


def test_rule_d_iii_q_agreeing_beside_the_lattice_keeps_r_and_u_becomes_the_lattice_s(monkeypatch):
    q = qq(1.05, u=0.065)
    before = GR.resolve(1.0, fd(u_ref=0.01), lat(1.03), q)
    assert before["corroborated_by"] == ["lattice", "Q"] and before["u"] == pytest.approx(0.05)
    after = GR.resolve(1.0, fd(u_ref=0.01), lat(1.03), _guarded(monkeypatch, q))
    assert after["status"] == GR.RESOLVED and after["corroborated_by"] == ["lattice"]
    assert after["R"] == before["R"] and after["u"] == pytest.approx(0.03)


def test_a_guard_that_crosses_nothing_changes_nothing_in_rule_d(monkeypatch):
    for args in ((fd(), lat(1.03)), (fd(), lat(1.0, u=0.3)), (fd(), lat(1.0))):
        for gq in (1.02, 1.05, 1.2):
            q = qq(gq, u=0.02)
            g = _guarded(monkeypatch, q, uc=0.001)
            assert not g["flags"]
            assert GR.resolve(1.0, *args, g) == GR.resolve(1.0, *args, {**q, "u_ref": 0.021})


@pytest.mark.parametrize("uc,want_q", [(1e-9, True), (10.0, False)])
def test_c2_q_scores_the_guarded_view_of_gamma_and_leaves_every_other_quantity_alone(monkeypatch, uc, want_q):
    ex = 0.645
    calls = []

    def fake(c, sp, n, american=True, half=False, cache=None, take=None):
        calls.append((sp.name, n))
        steps = {512: 0.16, 1024: 0.08, 2048: 0.04}                     # first order, u_rule 0.04 tol at 2048
        return ex + GR._tol(sp.name, ex, c.spot) * steps[n]
    monkeypatch.setattr(qe, "quantity", fake)
    monkeypatch.setattr(C, "exact", lambda c, kk: ex)
    monkeypatch.setattr(qe, "u_cond", lambda c, n, cache=None: uc * GR._tol(G.GAMMA, ex, c.spot))
    got = C.c2_q(DIV_PUT, CFG, quantities=(G.GAMMA, G.VEGA))
    g, v = got[G.GAMMA], got[G.VEGA]
    tol = GR._tol(G.GAMMA, ex, DIV_PUT.spot)
    assert g["status"] == "scored" and g["levels"][-1] == 2048 and v["levels"][-1] == 2048
    assert g["u_rule"] == pytest.approx(0.04 * tol) and g["u_cond"] == pytest.approx(uc * tol)
    assert g["u_Q"] == pytest.approx((0.04 + uc) * tol) and g["within_budget"] is want_q
    assert (qe.R_CONDITIONING in g["flags"]) is (not want_q)
    assert v["u_rule"] is None and v["u_cond"] is None and v["within_budget"] and not v["flags"]
    assert set(calls) == {(k, n) for k in (G.GAMMA, G.VEGA) for n in qe.LEVELS}     # the same solves either way
