"""The Phase 3 reference runner (design-P3-approved.md sections 7.1, 7.2 and 12; build step 8)."""

from __future__ import annotations

import numpy as np
import pytest

from scripts.options_bench import greek_reference as GR
from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om


def ctx(is_call=False, spot=100.0, strike=105.0, days=60, rho=0.05, q=0.0, sigma=0.3, divs=()):
    return om.Context(is_call, spot, strike, days, rho, q, sigma, tuple(divs))


EXEMPT = ctx(is_call=False, strike=100.0, rho=-0.01, q=0.02)


# ── work: one aggregate budget, charged before every call ──────────────────

def test_the_budget_is_charged_before_any_solve_runs(monkeypatch):
    calls = []
    real = fd.solve
    monkeypatch.setattr(fd, "solve", lambda *a, **k: calls.append(1) or real(*a, **k))
    out = GR.references(ctx(), quantities=(GR.PRICE,), cap=1000)
    assert out[GR.PRICE]["status"] == f"unresolved: {GR.R_CAP}" and calls == []
    assert out["_work"]["used"] == 0 and out["_work"]["fd_solves"] == 0


def test_the_budget_never_passes_its_cap_and_is_shared_across_quantities():
    c = ctx()
    first = GR.references(c, quantities=(GR.PRICE,))
    used = first["_work"]["used"]
    # a cap that admits the price study, not the next quantity's extra solves
    out = GR.references(c, quantities=(GR.PRICE, G.VEGA), cap=used + 1)
    assert out[GR.PRICE]["status"] == first[GR.PRICE]["status"]
    assert out[G.VEGA]["status"] == f"unresolved: {GR.R_CAP}"
    assert out["_work"]["used"] <= used + 1


def test_a_lattice_call_is_charged_too():
    b = GR.RefBudget(10)
    r = GR.Runner(b)
    with pytest.raises(GR.CapHit):
        r.lattice(ctx(), 1)
    assert b.used == 0 and b.lattice_calls == 0


def test_the_cache_charges_each_solve_once():
    b = GR.RefBudget()
    r = GR.Runner(b)
    k = GR.Key(400, 4, 1.0, fd.PENALTY)
    r.fd(ctx(), k)
    used = b.used
    r.fd(ctx(), k)
    assert b.used == used == fd.solve_units(400, 4, 60) and b.fd_solves == 1


# ── what may validate what (section 7.1) ───────────────────────────────────

def test_an_fd_study_alone_never_resolves_an_fd_quantity():
    f = {"R": 1.0, "u_ref": 0.0, "u_bump": 0.0, "flags": []}
    got = GR.resolve(0.01, f, None)
    assert got["R"] is None and GR.R_NOT_CORROBORATED in got["status"]


def test_the_gate_is_feasible_at_the_floors():
    # DR-16: identical lattice levels, an exact FD study and zero bump difference resolve, u = 0.02·tol_G each side
    tol = 0.01
    f = {"R": 2.0, "u_ref": GR.REF_FLOOR * tol, "u_bump": 0.0, "flags": []}
    lat = {"G": 2.0, "u_seq": GR.REF_FLOOR * tol, "u_bump": 0.0, "flags": []}
    got = GR.resolve(tol, f, lat)
    assert got["status"] == GR.RESOLVED and got["R"] == 2.0 and got["u"] == pytest.approx(GR.REF_FLOOR * tol)


def test_the_lattice_estimate_is_floored_at_the_reference_floor(monkeypatch):
    monkeypatch.setattr(GR, "_lat_q", lambda r, c, sp, mult, half=False: 0.5)
    sp = GR.spec(ctx(), G.GAMMA, G.GreekConfig())
    got = GR.lattice_seq(GR.Runner(GR.RefBudget()), ctx(), sp, tol=0.01)
    assert got["G"] == 0.5 and got["u_seq"] == GR.REF_FLOOR * 0.01 and got["u_bump"] == 0.0


@pytest.mark.parametrize("field,value,needle", [
    ("u_ref", 0.071, "FD refinement"), ("u_bump", 0.031, "FD bump"), ("u_seq", 0.071, "lattice sequence"),
    ("lat_bump", 0.031, "lattice bump"), ("diff", 0.101, "differ")])
def test_each_budget_and_the_agreement_are_named_when_they_fail(field, value, needle):
    tol = 1.0
    f = {"R": 0.0, "u_ref": 0.02, "u_bump": 0.0, "flags": []}
    lat = {"G": 0.0, "u_seq": 0.02, "u_bump": 0.0, "flags": []}
    if field in ("u_ref", "u_bump"):
        f[field] = value
    elif field == "u_seq":
        lat["u_seq"] = value
    elif field == "lat_bump":
        lat["u_bump"] = value
    else:
        lat["G"] = value
    got = GR.resolve(tol, f, lat)
    assert got["R"] is None and needle in got["status"]
    # just inside: resolved
    ok_f = {"R": 0.0, "u_ref": 0.07, "u_bump": 0.03, "flags": []}
    ok_l = {"G": 0.1, "u_seq": 0.07, "u_bump": 0.03, "flags": []}
    assert GR.resolve(tol, ok_f, ok_l)["status"] == GR.RESOLVED
    assert GR.resolve(tol, ok_f, ok_l)["u"] == pytest.approx(0.1)


def test_a_flag_on_either_side_leaves_the_reference_unresolved():
    f = {"R": 0.0, "u_ref": 0.02, "u_bump": 0.0, "flags": ["gamma low-order in time"]}
    lat = {"G": 0.0, "u_seq": 0.02, "u_bump": 0.0, "flags": []}
    assert "low-order" in GR.resolve(1.0, f, lat)["status"]
    got = GR.resolve(1.0, {**f, "flags": []}, {"G": None, "flags": [GR.R_NODE_NEAR]})
    assert got["R"] is None and GR.R_NODE_NEAR in got["status"]


@pytest.mark.parametrize("d,want", [(0.0, "pass"), (0.79, "pass"), (0.81, "straddle"), (1.19, "straddle"),
                                    (1.21, "fail")])
def test_scoring_against_tol_plus_and_minus_u(d, want):
    assert GR.score(1.0 + d, 1.0, 0.2, 1.0) == want


# ── node gamma (P3-A7) ──────────────────────────────────────────────────────

def _nodes(s, v, cont, ex):
    return {"spot": np.array(s, float), "value": np.array(v, float), "cont": np.array(cont, float),
            "exercise": np.array(ex, bool)}


def test_node_gamma_is_exact_on_a_quadratic_and_in_dollars():
    c = ctx(is_call=True, strike=50.0)   # far from exercise: the exercise value is well below the values
    s = [0.9, 1.0, 1.15]                 # unequal spacing, per unit S
    v = [x * x for x in s]
    got = GR.node_gamma(_nodes(s, v, v, [False] * 3), c, price=100.0)
    assert got == pytest.approx(2.0 / c.spot, rel=1e-13)


def test_node_gamma_near_an_exercise_decision_is_unresolved():
    c = ctx(is_call=False, strike=105.0)
    s = [0.9, 1.0, 1.1]
    exv = [(1.05 - x) for x in s]
    # the nodes straddle the decision
    got = GR.node_gamma(_nodes(s, [0.2, 0.1, 0.08], [0.1, 0.1, 0.08], [True, False, False]), c, price=7.0)
    assert got == GR.R_NODE_NEAR
    # all continuing, but one node's continuation within 5·price_tol of its exercise value
    ptol = om.tolerance(7.0, c.spot)
    cont = [exv[0] + 4.0 * ptol / c.spot, 0.2, 0.15]
    assert GR.node_gamma(_nodes(s, cont, cont, [False] * 3), c, price=7.0) == GR.R_NODE_NEAR
    cont[0] = exv[0] + 6.0 * ptol / c.spot
    assert isinstance(GR.node_gamma(_nodes(s, cont, cont, [False] * 3), c, price=7.0), float)


def test_node_gamma_is_zero_when_all_three_are_exercised_and_clear():
    c = ctx(is_call=False, strike=200.0)
    s = [0.9, 1.0, 1.1]
    exv = [2.0 - x for x in s]
    cont = [e - 0.01 for e in exv]
    assert GR.node_gamma(_nodes(s, exv, cont, [True] * 3), c, price=100.0) == 0.0


def test_the_lattice_s_nodes_give_the_exempt_gamma_at_every_spot_scale():
    # exempt: the lattice converges to the closed form; Γ_$ = Γ_L / S, checked at S ∈ {1, 100, 2500}
    for spot in (1.0, 100.0, 2500.0):
        c = ctx(is_call=False, spot=spot, strike=spot, rho=-0.01, q=0.02)
        r = GR.Runner(GR.RefBudget())
        got = r.lattice(c, 4, nodes=True)
        g = GR.node_gamma(got["nodes"], c, got["value"])
        exact = G.closed_forms(c)[G.GAMMA]
        assert g == pytest.approx(exact, rel=0.02), spot
        assert g * spot == pytest.approx(GR.node_gamma(GR.Runner(GR.RefBudget()).lattice(
            ctx(is_call=False, spot=1.0, strike=1.0, rho=-0.01, q=0.02), 4, nodes=True)["nodes"],
            ctx(is_call=False, spot=1.0, strike=1.0, rho=-0.01, q=0.02), got["value"] / spot), rel=1e-12)


def test_every_lattice_level_the_runner_uses_has_at_least_four_steps():
    assert min(om.steps_for(d) for d in (1, 2, 5, 30, 365, 1464)) >= 4


# ── the states and their domain (DR-14) ────────────────────────────────────

def test_bumped_references_use_half_the_production_bump():
    cfg = G.GreekConfig()
    for g in (G.VEGA, G.RHO):
        sp = GR.spec(ctx(), g, cfg)
        assert sp.h == G.bump_size(ctx(), g, cfg) / 2.0
        assert len(sp.states) == 4


def test_a_reference_state_outside_the_domain_is_named():
    c = ctx(rho=0.75)    # r + h_ref leaves the domain
    assert GR.spec(c, G.RHO, G.GreekConfig()) == G.R_BUMP_DOMAIN
    out = GR.references(c, quantities=(G.RHO,))
    assert out[G.RHO]["status"] == f"unresolved: {G.R_BUMP_DOMAIN}" and out["_work"]["used"] == 0


def test_inapplicable_quantities_and_expiry_cost_nothing():
    out = GR.references(ctx(divs=((0, 1.0),)), quantities=(G.THETA,))
    assert G.R_EXDIV in out[G.THETA]["status"] and out["_work"]["used"] == 0
    out = GR.references(ctx(), quantities=(G.DIVIDEND,))
    assert G.R_NO_DIVIDEND in out[G.DIVIDEND]["status"]
    out = GR.references(ctx(days=0))
    assert all(G.R_EXPIRY in v["status"] for k, v in out.items() if k != "_work")


def test_theta_at_one_day_reads_the_exact_payoff():
    c = ctx(days=1, strike=100.0)
    sp = GR.spec(c, G.THETA, G.GreekConfig())
    r = GR.Runner(GR.RefBudget())
    k = GR.Key(400, 4, 0.2, fd.PENALTY)
    got = GR._fd_q(r, c, sp, k)
    assert got == G.intrinsic(sp.states[1]) - r.fd(c, k)["value"]
    assert r.budget.fd_solves == 1


# ── end to end on an exempt context, where exact values exist ───────────────

def test_resolved_references_on_an_exempt_context_cover_the_closed_forms():
    out = GR.references(EXEMPT, quantities=(GR.PRICE, G.GAMMA, G.VEGA))
    cf = G.closed_forms(EXEMPT)
    exact = {GR.PRICE: cf["value"], G.GAMMA: cf[G.GAMMA], G.VEGA: cf[G.VEGA]}
    resolved = [k for k in exact if out[k]["status"] == GR.RESOLVED]
    assert resolved, out
    for k in resolved:
        assert abs(out[k]["R"] - exact[k]) <= out[k]["u"], (k, out[k]["R"], exact[k], out[k]["u"])
        assert out[k]["u"] <= GR.AGREE * out[k]["tol"]


def test_the_european_control_has_no_lattice_side():
    out = GR.references(EXEMPT, quantities=(G.GAMMA,), american=False)
    assert out[G.GAMMA]["status"] == "FD only (European control)" and "lattice" not in out[G.GAMMA]
    assert out["_work"]["lattice_calls"] == 0
    assert abs(out[G.GAMMA]["R_FD"] - G.closed_forms(EXEMPT)[G.GAMMA]) <= out[G.GAMMA]["u_FD"]


def test_the_lattice_side_s_dividend_smoothing_is_a_setting_and_off_by_default():
    # V-3: frozen at calibration; the default is the unsmoothed lattice (smooth_divs=False, om's own default)
    c = ctx(is_call=True, strike=95.0, days=40, rho=0.03, divs=((12, 1.0),))
    off, on = GR.Runner(GR.RefBudget()), GR.Runner(GR.RefBudget(), smooth_divs=True)
    a, b = off.lattice(c, 2), on.lattice(c, 2)
    want = om._lattice([True], [0.95], np.array([0.03]), np.array([0.0]), np.array([0.3]), [[(12, 0.01)]], 40,
                       om.steps_for(40) * 2)[0][0] * 100.0
    assert a["value"] == want and b["value"] != a["value"]


# ── P3-AM3 change 3: the FD bump term on the study's finest grid; over budget, it escalates space ──

def _fake_bump_study(monkeypatch, scale):
    """FD quantity constant in the grid (u_ref at the floor); the h_ref/2 value differs by scale/m (a bump term
    that falls with space refinement, as the exercise boundary's position between nodes does). Records the grids
    the bump term was read on."""
    seen = []

    def fake(r, c, sp, k, half=False):
        if half:
            seen.append((k.m, k.p))
            return 1.0 + scale / k.m
        return 1.0
    monkeypatch.setattr(GR, "_fd_q", fake)
    return seen


def test_the_bump_term_is_read_on_the_finest_grid_and_escalates_space(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    tol = GR._tol(G.VEGA, 1.0, c.spot)
    m0, p0, _ = fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, 0.0)
    m0 -= m0 % 16
    seen = _fake_bump_study(monkeypatch, 0.05 * tol * m0)       # 0.05·tol on m0, 0.025·tol on 2·m0
    out = GR.fd_study(GR.Runner(GR.RefBudget()), c, sp)
    assert out["grid"]["escalations"]["space"] == 1 and out["grid"]["space_levels"][-1] == 2 * m0
    assert out["u_bump"] == pytest.approx(0.025 * tol) and out["u_bump"] <= GR.U_BUMP_MAX * tol
    assert seen[-1] == (2 * m0, out["grid"]["time_levels"][-1])


def test_a_bump_term_within_budget_escalates_nothing(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    tol = GR._tol(G.VEGA, 1.0, c.spot)
    m0, p0, _ = fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, 0.0)
    m0 -= m0 % 16
    _fake_bump_study(monkeypatch, 0.02 * tol * m0)
    out = GR.fd_study(GR.Runner(GR.RefBudget()), c, sp)
    assert out["grid"]["escalations"] == {"time": 0, "space": 0}
    assert out["u_bump"] == pytest.approx(0.02 * tol)


def test_a_bump_term_that_does_not_fall_stops_at_the_escalation_limit(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    tol = GR._tol(G.VEGA, 1.0, c.spot)
    seen = []

    def fake(r, c_, sp_, k, half=False):
        if half:
            seen.append(k)
            return 1.0 + 0.05 * tol
        return 1.0
    monkeypatch.setattr(GR, "_fd_q", fake)
    out = GR.fd_study(GR.Runner(GR.RefBudget()), c, sp)
    from scripts.options_bench import reference as ref
    assert out["grid"]["escalations"] == {"time": ref.ESCALATE_MAX, "space": ref.ESCALATE_MAX}
    assert out["u_bump"] == pytest.approx(0.05 * tol)



# ── P3-AM4 change 3: every bump state on the base context's FD grid ────────

def _grids(r):
    return {s: v["xs"] for (s, _k), v in r._fd.items()}


@pytest.mark.parametrize("name", [G.DIVIDEND, G.RHO])
def test_a_bump_that_moves_pv0_is_solved_on_the_base_grid(name):
    c = ctx(divs=((20, 2.0), (50, 2.0)))
    sp = GR.spec(c, name, G.GreekConfig())
    r = GR.Runner(GR.RefBudget())
    k = GR.Key(400, 4, 1.0, fd.PENALTY)
    GR._fd_q(r, c, sp, k)
    GR._fd_q(r, c, sp, k, half=True)
    base = r.fd(c, k)["xs"]
    shifted = [s for s in _grids(r) if s != c]
    assert len(shifted) == 4                                   # the four stencil states, none at its own spot
    for s in shifted:
        assert s.spot != c.spot
        np.testing.assert_allclose(_grids(r)[s], base, rtol=1e-13)
    # each state is read at its own X_0 = S − PV_s, which is not a node of the shared grid
    for st in sp.states:
        x0 = np.log(st.spot - fd.pv_owed(st.divs, st.rho, 0.0))
        assert np.min(np.abs(r.fd(c, k)["x"] - x0)) > 0


def test_a_bump_that_leaves_pv0_alone_is_solved_at_its_own_spot():
    c = ctx(divs=((20, 2.0),))
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    r = GR.Runner(GR.RefBudget())
    k = GR.Key(400, 4, 1.0, fd.PENALTY)
    got = GR._fd_q(r, c, sp, k)
    assert set(_grids(r)) == {sp.states[0], sp.states[1]}
    want = (r.fd(sp.states[0], k)["value"] - r.fd(sp.states[1], k)["value"]) / (2 * sp.h) * G.UNIT[G.VEGA]
    assert got == want
    no_div = ctx()
    sp = GR.spec(no_div, G.RHO, G.GreekConfig())                # no dividends: PV_0 = 0 in every state
    r = GR.Runner(GR.RefBudget())
    GR._fd_q(r, no_div, sp, k)
    assert set(_grids(r)) == {sp.states[0], sp.states[1]}


def test_the_base_grid_read_out_agrees_with_the_closed_form():
    # European, the dividend sensitivity on the shared grid against its closed form −e^{−ρ t_j}·Δ
    c = ctx(divs=((20, 2.0),))
    sp = GR.spec(c, G.DIVIDEND, G.GreekConfig())
    r = GR.Runner(GR.RefBudget(), american=False)
    got = GR._fd_q(r, c, sp, GR.Key(1600, 16, 1.0, fd.PENALTY))
    ex = G.closed_forms(c)[G.DIVIDEND]
    assert abs(got - ex) <= 0.02 * G.tolerance(G.DIVIDEND, ex, c.spot)


@pytest.mark.parametrize("spot", [104.30, 104.50])
def test_the_base_grid_read_applies_the_exercise_value_exactly_at_a_day0_close(spot):
    # DR-AM4-2: an American call with a dividend at today's close; continuation and immediate exercise tie near
    # S ≈ 104.44, where V has a derivative jump. A cubic through V's nodes misreads it; the read of the continuation
    # with the exact exercise value applied agrees with the state's own centred solve
    import math
    from dataclasses import replace
    c = ctx(is_call=True, spot=spot, strike=100.0, days=30, rho=0.0, q=0.0, sigma=0.2, divs=((0, 1.0),))
    k = GR.Key(800, 8, 1.0, fd.PENALTY)
    r = GR.Runner(GR.RefBudget())
    s = G.bumped(c, G.DIVIDEND, 0.05)
    got = GR._value_on_base_grid(r, c, s, k)
    own = r.fd(s, k)["value"]
    pv_s, pv_c = fd.pv_owed(s.divs, s.rho, 0.0), fd.pv_owed(c.divs, c.rho, 0.0)
    shared = r.fd(replace(s, spot=c.spot - pv_c + pv_s), k)
    naive = G.cubic_at(shared["x"], shared["v0"], math.log(s.spot - pv_s))
    assert abs(got - own) < 1e-5
    assert abs(naive - own) > 1e-3


# ── P3-AM6 B.1, B.3, B.4: the space-only extension, two passes, the in-grid read ──

def _space_fake(monkeypatch, c, a_tol, cap_n=None):
    """FD quantity flat in time and penalty, and in the width study (every widened domain reads the m0/2 value);
    in space a step of a_tol·tol at each doubling of the study's levels from m0/4 (n = log2(m/(m0/4))), so every
    three levels read 'not-converging'. With cap_n the steps stop at that doubling, so a deeper study converges
    and clears the shallow flag (design review DR-AM6-7)."""
    tol = GR._tol(G.VEGA, 1.0, c.spot)
    m0, _p0, w = fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, 0.0)
    m0 -= m0 % 16

    def fake(r, c_, sp_, k, half=False):
        m = k.m if k.w == w else m0 // 2
        n = int(round(np.log2(m / (m0 // 4))))
        if cap_n is not None:
            n = min(n, cap_n)
        return 1.0 + a_tol * tol * n
    monkeypatch.setattr(GR, "_fd_q", fake)
    return tol, m0


def test_a_shallow_flag_that_deeper_space_levels_clear_is_recomputed_not_kept(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    tol, m0 = _space_fake(monkeypatch, c, 0.03, cap_n=4)
    r = GR.Runner(GR.RefBudget())
    f = GR.fd_study(r, c, sp)
    from scripts.options_bench import reference as ref
    assert f["grid"]["escalations"] == {"time": ref.ESCALATE_MAX, "space": ref.ESCALATE_MAX}
    assert any("not-converging in space" in x for x in f["flags"]) and GR.extension_eligible(f)
    f2 = GR.fd_study(r, c, sp, extend=f)
    assert f2["flags"] == [] and f2["u_ref"] <= GR.U_REF_MAX * f2["tol"]
    assert f2["grid"]["escalations"] == {"time": ref.ESCALATE_MAX, "space": ref.ESCALATE_MAX + 1}
    assert f2["grid"]["space_levels"][-1] == 8 * m0 and f2["grid"]["time_levels"] == f["grid"]["time_levels"]
    assert f2["shallow"]["flags"] == f["flags"] and f2["shallow"]["R"] == f["R"]       # kept for the audit


def test_the_extension_stops_at_its_own_space_limit(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    tol, m0 = _space_fake(monkeypatch, c, 0.03)
    r = GR.Runner(GR.RefBudget())
    f = GR.fd_study(r, c, sp)
    f2 = GR.fd_study(r, c, sp, extend=f)
    assert f2["grid"]["escalations"]["space"] == GR.SPACE_ESCALATE_MAX and f2["flags"]
    assert f2["grid"]["space_levels"][-1] == 2 ** GR.SPACE_ESCALATE_MAX * m0
    assert f2["grid"]["time_levels"] == f["grid"]["time_levels"]                          # time is never extended


def test_a_study_within_budget_is_never_extended(monkeypatch):
    c = ctx()
    sp = GR.spec(c, G.VEGA, G.GreekConfig())
    _space_fake(monkeypatch, c, 0.0)
    f = GR.fd_study(GR.Runner(GR.RefBudget()), c, sp)
    assert f["grid"]["escalations"] == {"time": 0, "space": 0} and not GR.extension_eligible(f)


def _f(flags=(), u_ref=0.01, esc=(2, 2), width=(0.0, 0.0), u_p=0.0, tol=1.0):
    return {"R": 1.0, "u_ref": u_ref, "u_bump": 0.0, "tol": tol, "flags": list(flags), "width_steps": list(width),
            "u_penalty": u_p, "grid": {"escalations": {"time": esc[0], "space": esc[1]}}}


def test_extension_eligibility_is_the_designed_test():
    assert GR.extension_eligible(_f(u_ref=0.08))
    assert GR.extension_eligible(_f(flags=["vega not-converging in space"]))
    assert not GR.extension_eligible(_f())                                       # within budget
    assert not GR.extension_eligible(_f(u_ref=0.08, esc=(1, 2)))                 # counters not at the limit
    assert not GR.extension_eligible(_f(u_ref=0.08, esc=(2, 1)))
    assert not GR.extension_eligible(_f(u_ref=0.08, width=(0.05, 0.03)))         # stopped on width and penalty
    assert not GR.extension_eligible(_f(u_ref=0.08, u_p=0.08))
    assert not GR.extension_eligible(_f(flags=["penalty iteration cap hit on 3 steps"]))   # pass-1 penalty miss


def _two_pass_fakes(monkeypatch, deep):
    """Every FD study over budget and eligible in pass 1; `deep(name)` gives the extension's result or raises.
    The lattice agrees and is qualified. Records the call order."""
    calls = []

    def fake_fd(r, c, sp, escalate=True, extend=None):
        calls.append((sp.name, extend is not None))
        if extend is None:
            return _f(u_ref=0.08, tol=1.0)
        return deep(sp.name, r)
    lat = {"G": 1.0, "u_seq": 0.01, "u_bump": 0.0, "flags": []}
    monkeypatch.setattr(GR, "fd_study", fake_fd)
    monkeypatch.setattr(GR, "lattice_seq", lambda r, c, sp, tol: dict(lat))
    monkeypatch.setattr(GR, "_tol", lambda name, value, spot: 1.0)
    return calls


def test_the_extensions_run_after_every_pass_1_study_and_a_cap_keeps_the_pass_1_result(monkeypatch):
    qs = (GR.PRICE, G.VEGA)

    def deep(name, r):
        if name == GR.PRICE:
            raise GR.CapHit("deep")
        return {**_f(u_ref=0.01), "shallow": _f(u_ref=0.08)}
    calls = _two_pass_fakes(monkeypatch, deep)
    out = GR.references(ctx(), quantities=qs, corroborate_q=False)
    assert calls == [(GR.PRICE, False), (G.VEGA, False), (GR.PRICE, True), (G.VEGA, True)]
    assert out[GR.PRICE]["status"].startswith("unresolved") and "FD refinement" in out[GR.PRICE]["status"]
    assert out[GR.PRICE]["deep"]["status"] == GR.R_DEEP_CAP and out[GR.PRICE]["fd"]["u_ref"] == 0.08
    assert out[G.VEGA]["status"] == GR.RESOLVED and out[G.VEGA]["fd"]["shallow"]["u_ref"] == 0.08
    calls.clear()
    out0 = GR.references(ctx(), quantities=qs, corroborate_q=False, extend=False)
    assert calls == [(GR.PRICE, False), (G.VEGA, False)]
    assert all(out0[k]["status"] == out[GR.PRICE]["status"] for k in qs)


def _read_solve(r, key, misses):
    """A solve the study reads, as Runner.fd records it (DR-AM6-8)."""
    r._fd.setdefault(key, {"penalty_unconverged": misses})
    if r._track is not None:
        r._track.add(key)


def test_a_new_penalty_miss_in_the_deeper_study_stays_a_flag(monkeypatch):
    def deep(name, r):
        _read_solve(r, ("deep",), 2)
        return _f(u_ref=0.01)
    _two_pass_fakes(monkeypatch, deep)
    out = GR.references(ctx(), quantities=(G.VEGA,), corroborate_q=False)
    assert "penalty iteration cap hit on 2 steps (deeper study)" in out[G.VEGA]["status"]


def test_the_european_control_extends_the_fd_side_alone(monkeypatch):
    calls = _two_pass_fakes(monkeypatch, lambda name, r: _f(u_ref=0.01))
    out = GR.references(ctx(), quantities=(G.VEGA,), american=False)
    assert calls == [(G.VEGA, False), (G.VEGA, True)]
    assert out[G.VEGA]["status"] == "FD only (European control)" and out[G.VEGA]["fd"]["u_ref"] == 0.01


def test_a_base_grid_read_outside_the_grid_is_refused_never_extrapolated(monkeypatch):
    c = ctx(divs=((20, 2.0),))
    sp = GR.spec(c, G.DIVIDEND, G.GreekConfig())
    s = sp.states[0]
    pv_s = fd.pv_owed(s.divs, s.rho, 0.0)
    x1 = np.log(s.spot - pv_s)
    r = GR.Runner(GR.RefBudget())
    k = GR.Key(400, 4, 1.0, fd.PENALTY)
    grid = {"x": np.array([x1 - 0.2, x1 - 0.1, x1 + 0.1, x1 + 0.2]), "v0": np.zeros(4), "free0": np.zeros(4),
            "value": 0.0}
    monkeypatch.setattr(r, "fd", lambda st, kk: grid)
    GR._value_on_base_grid(r, c, s, k)                                       # inside x[1]..x[-2]: read
    grid["x"] = np.array([x1 - 0.3, x1 - 0.2, x1 - 0.1, x1 + 0.1])            # x1 beyond x[-2]: refused
    with pytest.raises(GR.ReadOutside):
        GR._value_on_base_grid(r, c, s, k)
    grid["x"] = np.array([x1 - 0.1, x1 + 0.1, x1 + 0.2, x1 + 0.3])            # x1 below x[1]: refused
    with pytest.raises(GR.ReadOutside):
        GR._value_on_base_grid(r, c, s, k)


@pytest.mark.parametrize("g_plus,want", [(1.05, "agree"), (1.2, "disagree")])
def test_q_plus_runs_on_a_lattice_resolved_reference_and_a_disagreeing_q_plus_blocks(monkeypatch, g_plus, want):
    from scripts.options_bench import ql_escrowed as qe
    lat = {"G": 1.0, "u_seq": 0.01, "u_bump": 0.0, "flags": []}
    monkeypatch.setattr(GR, "fd_study", lambda r, c, sp, escalate=True, extend=None: _f(u_ref=0.01, esc=(0, 0)))
    monkeypatch.setattr(GR, "lattice_seq", lambda r, c, sp, tol: dict(lat))
    monkeypatch.setattr(GR, "_tol", lambda name, value, spot: 1.0)
    shallow = {"G": 1.3, "u_ref": None, "u_bump": 0.0, "flags": [qe.R_NOT_CONVERGING],
               "levels": list(qe.LEVELS) + [qe.ESCALATE], "values": [1.0] * 4, "branch": None}
    seen = []

    def fake_study(c, sp, tol, american=True, take=None, cache=None, extend=None, **kw):
        seen.append(extend is not None)
        if extend is None:
            return dict(shallow)
        return {"G": g_plus, "u_ref": 0.02, "u_bump": 0.0, "flags": [], "levels": shallow["levels"] + [qe.EXTRA],
                "values": [1.0] * 4 + [g_plus], "branch": None}
    monkeypatch.setattr(qe, "study", fake_study)
    base = GR.references(ctx(), quantities=(G.VEGA,), extend=False)[G.VEGA]
    assert base["status"] == GR.RESOLVED and base["u"] == pytest.approx(0.01)        # the lattice resolves alone
    seen.clear()
    out = GR.references(ctx(), quantities=(G.VEGA,))[G.VEGA]
    assert seen == [False, True] and out["q"]["levels"][-1] == qe.EXTRA
    if want == "agree":
        assert out["status"] == GR.RESOLVED and out["u"] == pytest.approx(0.05)     # u raised to the difference
    else:
        assert out["status"].startswith("unresolved") and "disagree" in out["status"]


def test_the_forced_c2_fd_control_reads_every_depth_and_never_changes_the_reference_path(monkeypatch):
    from scripts.options_bench import controls_p3 as C
    c = ctx()
    tol, m0 = _space_fake(monkeypatch, c, 0.0)                     # within budget: references never extend it
    monkeypatch.setattr(C, "exact", lambda c_, k: 1.0)
    out = C.c2_fd_forced(c, quantities=(G.VEGA,))[G.VEGA]
    assert out["status"] == "scored" and sorted(out["depths"]) == [3, 4, 5]
    assert [out["depths"][d]["depth"] for d in (3, 4, 5)] == [3, 4, 5]
    assert all(row["covered"] and row["resolves"] for row in out["depths"].values())
    f = GR.fd_study(GR.Runner(GR.RefBudget(), False), c, GR.spec(c, G.VEGA, G.GreekConfig()))
    assert f["grid"]["escalations"] == {"time": 0, "space": 0} and not GR.extension_eligible(f)


# ── design review DR-AM6-8: a cached unconverged solve flags every study that reads it ──

def _fake_kernel(monkeypatch, bad_m):
    """fd.solve returning finite values everywhere, reporting penalty-iteration misses on the m = bad_m grids."""
    def solve(is_call, spot, strike, days, rho, q, sigma, divs, m, p, w, american=True, penalty=None, diag=None,
              grids=None):
        x = np.linspace(-1.0, 1.0, m + 1) + np.log(spot)
        grids.update(x=x, xs=np.exp(x), v0=np.ones(m + 1), free0=np.ones(m + 1))
        diag["penalty_unconverged"] = 3 if m == bad_m else 0
        return 1.0, 0.5
    monkeypatch.setattr(GR.fd, "solve", solve)
    monkeypatch.setattr(GR.fd, "solve_units", lambda m, p, days: 1.0)


def test_the_runner_counts_a_cached_solve_s_misses_for_every_reader(monkeypatch):
    _fake_kernel(monkeypatch, 400)
    r = GR.Runner(GR.RefBudget())
    k = GR.Key(400, 4, 1.0, fd.PENALTY)
    r.track()
    r.fd(ctx(), k)
    assert r.penalty_in_tracked() == 3 and r.budget.fd_solves == 1
    r.track()
    r.fd(ctx(), k)                                                 # a cache hit: no solve, the misses still count
    assert r.penalty_in_tracked() == 3 and r.budget.fd_solves == 1
    r.track()
    r.fd(ctx(), GR.Key(800, 4, 1.0, fd.PENALTY))
    assert r.penalty_in_tracked() == 0


@pytest.mark.parametrize("order", [(GR.PRICE, G.GAMMA), (G.GAMMA, GR.PRICE)])
def test_a_shared_unconverged_solve_flags_both_quantities_whatever_the_order(monkeypatch, order):
    _fake_kernel(monkeypatch, 400)
    shared = GR.Key(400, 4, 1.0, fd.PENALTY)

    def fake_fd(r, c, sp, escalate=True, extend=None):
        r.fd(c, shared)                                            # price and gamma read the same solve
        return _f(u_ref=0.01, esc=(0, 0))
    monkeypatch.setattr(GR, "fd_study", fake_fd)
    monkeypatch.setattr(GR, "lattice_seq", lambda r, c, sp, tol: {"G": 1.0, "u_seq": 0.01, "u_bump": 0.0, "flags": []})
    monkeypatch.setattr(GR, "_tol", lambda name, value, spot: 1.0)
    out = GR.references(ctx(), quantities=order, corroborate_q=False)
    for k in order:
        assert "penalty iteration cap hit on 3 steps" in out[k]["status"], (k, out[k]["status"])


def test_a_solve_cached_by_an_extension_that_hit_the_cap_still_flags_its_next_reader(monkeypatch):
    _fake_kernel(monkeypatch, 1600)
    deep_key = GR.Key(1600, 4, 1.0, fd.PENALTY)

    def fake_fd(r, c, sp, escalate=True, extend=None):
        if extend is None:
            return _f(u_ref=0.08, tol=1.0)                          # over budget, eligible
        r.fd(c, deep_key)                                          # the deep level, unconverged
        if sp.name == GR.PRICE:
            raise GR.CapHit("after the deep solve")
        return _f(u_ref=0.01)
    monkeypatch.setattr(GR, "fd_study", fake_fd)
    monkeypatch.setattr(GR, "lattice_seq", lambda r, c, sp, tol: {"G": 1.0, "u_seq": 0.01, "u_bump": 0.0, "flags": []})
    monkeypatch.setattr(GR, "_tol", lambda name, value, spot: 1.0)
    out = GR.references(ctx(), quantities=(GR.PRICE, G.GAMMA), corroborate_q=False)
    assert out[GR.PRICE]["deep"]["status"] == GR.R_DEEP_CAP
    assert "penalty iteration cap hit on 3 steps (deeper study)" in out[G.GAMMA]["status"]
