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
