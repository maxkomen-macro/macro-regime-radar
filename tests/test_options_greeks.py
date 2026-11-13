"""The Phase 3 Greeks (src/desk/options_greeks.py; design P3 sections 2, 4, 5 and 7.3)."""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
import pytest

from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om


def ctx(is_call=False, spot=100.0, strike=105.0, days=90, rho=0.05, q=0.0, sigma=0.3, divs=()):
    return om.Context(is_call, spot, strike, days, rho, q, sigma, tuple(divs))


# ── tolerances and units (design section 2) ─────────────────────────────────

def test_the_tolerances_are_the_design_s():
    assert G.tolerance(G.GAMMA, 0.03, 100.0) == pytest.approx(max(0.02 * 0.03, 0.01 / 100.0))
    assert G.tolerance(G.GAMMA, 1e-6, 100.0) == 0.01 / 100.0
    assert G.tolerance(G.VEGA, 0.2, 100.0) == pytest.approx(max(0.002, 1e-3))
    assert G.tolerance(G.RHO, -0.01, 100.0) == pytest.approx(1e-3)
    assert G.tolerance(G.THETA, -0.04, 100.0) == pytest.approx(max(0.0008, 5e-4))
    assert G.tolerance(G.DIVIDEND, -0.7, 100.0) == 2.5e-3
    with pytest.raises(ValueError):
        G.tolerance("delta", 0.5, 100.0)


def _fd_value(c: om.Context) -> float:
    return G.intrinsic(c) if c.days == 0 else om.european(c)


def _central(f, h):
    """Fourth-order central difference (Richardson on h and h/2)."""
    d1 = (f(h) - f(-h)) / (2 * h)
    d2 = (f(h / 2) - f(-h / 2)) / h
    return (4 * d2 - d1) / 3


CLOSED = [
    ctx(),
    ctx(is_call=True, strike=95.0, days=60, rho=0.03, divs=((20, 1.0),)),
    ctx(is_call=True, strike=100.0, days=400, rho=0.02, q=-0.05, sigma=0.25, divs=((30, 1.2), (120, 1.3))),
    ctx(is_call=False, strike=90.0, days=30, rho=-0.02, q=0.04, sigma=0.6),
    ctx(is_call=True, strike=5.0, days=1460, rho=0.0, q=-0.1, sigma=0.2),     # DR-01: call delta above 1
]


@pytest.mark.parametrize("c", CLOSED)
def test_the_closed_forms_are_derivatives_of_the_european_value(c):
    cf = G.closed_forms(c)
    assert cf["value"] == pytest.approx(om.european(c), rel=1e-12, abs=1e-12)
    assert cf["delta"] == pytest.approx(om.european_delta(c), rel=1e-12, abs=1e-14)
    # delta and gamma in S (every dividend held fixed)
    d = _central(lambda h: _fd_value(c.with_spot(c.spot + h)), 1e-3)
    assert cf["delta"] == pytest.approx(d, rel=1e-8, abs=1e-10)
    gm = _central(lambda h: om.european_delta(c.with_spot(c.spot + h)), 1e-3)
    assert cf[G.GAMMA] == pytest.approx(gm, rel=1e-7, abs=1e-12)
    # vega per vol point, rho per percentage point (S fixed: X moves through PV_0)
    vg = 0.01 * _central(lambda h: _fd_value(replace(c, sigma=c.sigma + h)), 1e-4)
    assert cf[G.VEGA] == pytest.approx(vg, rel=1e-8, abs=1e-12)
    rh = 0.01 * _central(lambda h: _fd_value(replace(c, rho=c.rho + h)), 1e-4)
    assert cf[G.RHO] == pytest.approx(rh, rel=1e-8, abs=1e-12)
    # theta: one calendar day, every cum close one day earlier
    later = G.one_day_later(c)
    assert cf[G.THETA] == pytest.approx(_fd_value(later) - om.european(c), abs=1e-13)
    if c.divs:
        dv = _central(lambda h: _fd_value(G.bumped(c, G.DIVIDEND, h)), 1e-3)
        assert cf[G.DIVIDEND] == pytest.approx(dv, rel=1e-8, abs=1e-11)
    else:
        assert G.DIVIDEND not in cf


def test_a_negative_yield_call_has_delta_above_1_and_the_bounds_hold():
    cf = G.closed_forms(CLOSED[-1])
    assert cf["delta"] == pytest.approx(1.4918, abs=1e-4)
    for c in CLOSED:
        cf = G.closed_forms(c)
        assert (cf["delta"] >= 0) if c.is_call else (cf["delta"] <= 0)
        assert cf[G.GAMMA] >= 0 and cf[G.VEGA] >= 0


@pytest.mark.parametrize("spot", [1.0, 100.0, 2500.0])
def test_the_closed_forms_scale_with_the_spot(spot):
    # the bench uses S = 100; every quantity scales as section 2 states: value, vega, rho, theta ×S; delta and
    # the dividend sensitivity as is (amounts scaled with S); gamma ÷S
    base = G.closed_forms(ctx(is_call=True, strike=95.0, days=60, rho=0.03, divs=((20, 1.0),)))
    k = spot / 100.0
    c = ctx(is_call=True, spot=spot, strike=95.0 * k, days=60, rho=0.03, divs=((20, 1.0 * k),))
    cf = G.closed_forms(c)
    for name, power in (("value", 1), ("delta", 0), (G.GAMMA, -1), (G.VEGA, 1), (G.RHO, 1), (G.THETA, 1),
                        (G.DIVIDEND, 0)):
        assert cf[name] == pytest.approx(base[name] * k ** power, rel=1e-11), name


# ── grid readers (design sections 4.1 and 4.3) ──────────────────────────────

def test_the_s_form_gamma_is_exact_on_quadratics_and_close_on_smooth_functions():
    x = np.log(100.0) + np.linspace(-0.2, 0.2, 41)
    xs = np.exp(x)
    i = 20
    assert G.gamma_s_form(xs, 3.0 * xs ** 2 - 2.0 * xs + 1.0, i) == pytest.approx(6.0, rel=1e-9)
    for f, f2 in ((lambda s: s ** 3, lambda s: 6 * s), (lambda s: np.exp(s / 100.0), lambda s: np.exp(s / 100.0) / 1e4)):
        sform = G.gamma_s_form(xs, f(xs), i)
        dx = x[1] - x[0]
        v = f(xs)
        vx = (v[i + 1] - v[i - 1]) / (2 * dx)
        vxx = (v[i + 1] - 2 * v[i] + v[i - 1]) / dx ** 2
        xform = (vxx - vx) / xs[i] ** 2
        assert sform == pytest.approx(f2(xs[i]), rel=1e-3)
        assert sform == pytest.approx(xform, rel=1e-3)


def test_the_cubic_reader_is_exact_on_cubics():
    x = np.linspace(0.0, 1.0, 21)
    v = 2 * x ** 3 - x ** 2 + 0.5 * x - 3
    for x1 in (0.013, 0.5, 0.77, 0.981):
        assert G.cubic_at(x, v, x1) == pytest.approx(2 * x1 ** 3 - x1 ** 2 + 0.5 * x1 - 3, rel=1e-12)


# ── states and the domain of every stencil state (design section 4.2) ───────

def test_bumps_hold_the_spot_and_move_only_their_input():
    c = ctx(divs=((10, 1.0), (40, 1.5)))
    assert G.bumped(c, G.VEGA, 0.01).sigma == pytest.approx(0.31)
    assert G.bumped(c, G.RHO, -0.001).rho == pytest.approx(0.049)
    assert G.bumped(c, G.DIVIDEND, 0.25).divs == ((10, 1.25), (40, 1.5))
    for g in G.BUMPED:
        assert G.bumped(c, g, 0.001).spot == c.spot
    later = G.one_day_later(ctx(days=30, divs=((0, 1.0), (1, 0.5), (12, 2.0))))
    assert later.days == 29 and later.divs == ((0, 0.5), (11, 2.0))


def test_the_vega_bump_is_capped_at_a_quarter_of_sigma():
    cfg = G.GreekConfig()
    assert G.bump_size(ctx(sigma=0.004), G.VEGA, cfg) == pytest.approx(0.001)
    assert G.bump_size(ctx(sigma=0.3), G.VEGA, cfg) == cfg.h_sigma
    assert G.bump_size(ctx(divs=((5, 2.0),)), G.DIVIDEND, cfg) == pytest.approx(cfg.h_d_frac * 2.0)
    assert G.bump_size(ctx(divs=((5, 1e-6),)), G.DIVIDEND, cfg) == pytest.approx(cfg.h_d_frac * 0.1)


def test_a_bump_that_leaves_the_domain_withholds_that_greek_only():
    # D_1 = $0.000001: bumped by $0.0005 down it is a negative dividend (design section 4.2's example)
    c = ctx(is_call=True, strike=100.0, days=60, rho=0.03, divs=((20, 1e-6),))
    r = G.greeks(c)
    assert r[G.DIVIDEND].status == G.WITHHELD and r[G.DIVIDEND].reason == G.R_BUMP_DOMAIN
    assert r[G.GAMMA].status != G.WITHHELD or r[G.GAMMA].reason != G.R_BUMP_DOMAIN
    # a rate at the domain's edge: r + h_r beyond 75%
    r2 = G.greeks(ctx(rho=0.75))
    assert r2[G.RHO].reason == G.R_BUMP_DOMAIN
    assert r2[G.VEGA].reason != G.R_BUMP_DOMAIN


# ── routes and withheld rules (design sections 4.5 and 5) ───────────────────

def test_inputs_expiry_and_domain_withhold_every_greek():
    for c, reason in ((ctx(sigma=float("nan")), G.R_INPUT), (ctx(days=0), G.R_EXPIRY), (ctx(sigma=6.0), G.R_DOMAIN)):
        r = G.greeks(c)
        assert all(r[g].status == G.WITHHELD and r[g].reason == reason for g in G.GREEKS)


def test_no_dividend_means_no_dividend_sensitivity():
    assert G.greeks(ctx())[G.DIVIDEND].reason == G.R_NO_DIVIDEND


def test_a_day_0_close_withholds_theta_only():
    r = G.greeks(ctx(is_call=True, strike=95.0, days=30, rho=0.03, divs=((0, 1.0), (15, 1.0))))
    assert r[G.THETA].reason == G.R_EXDIV
    assert r[G.GAMMA].reason != G.R_EXDIV


def test_exempt_contexts_take_the_closed_forms():
    c = ctx(is_call=False, strike=100.0, days=60, rho=-0.01, q=0.02, sigma=0.3)
    assert om.exempt(c)
    r = G.greeks(c)
    cf = G.closed_forms(c)
    for g in (G.GAMMA, G.VEGA, G.THETA):
        assert r[g].status == G.EXACT_EXEMPT and r[g].value == cf[g] and r[g].estimate == 0.0
    # rho's stencil crosses the exemption boundary when r + h_r > 0: the FD route (design section 4.5's example)
    c0 = replace(c, rho=0.0)
    assert G.greeks(c0)[G.RHO].status != G.EXACT_EXEMPT


def test_a_put_deep_in_the_exercise_region_is_withheld_under_the_literal_rule_1():
    # design section 5, rule 1 as written compares the free (pre-projection) value with the exercise value; under
    # the penalty scheme an active node's pre-projection value sits within rounding of it, so the exercised-now
    # branch cannot fire on a real solve and the Greeks are withheld (conformance note V-7, for the freeze review)
    c = ctx(is_call=False, strike=200.0, days=60, rho=0.1, sigma=0.2)
    r = G.greeks(c)
    for g in (G.GAMMA, G.VEGA, G.RHO):
        assert r[g].status == G.WITHHELD and r[g].reason == G.R_NEAR, g
    assert r[G.THETA].status in (G.RETURNED, G.WITHHELD)


def _free_moved_below(monkeypatch, by: float):
    real = fd.price

    def price(state, level, budget, penalty, american):
        got = real(state, level, budget, penalty, american)
        if isinstance(got, fd.Solved) and got.grids is not None:
            got.grids["free0"] = got.grids["free0"] - by
        return got

    monkeypatch.setattr(G.fd, "price", price)


def test_the_exercised_now_branch_is_exact_when_its_condition_holds(monkeypatch):
    c = ctx(is_call=False, strike=200.0, days=60, rho=0.1, sigma=0.2)
    _free_moved_below(monkeypatch, 1.0)          # every free value 1.0 below, more than 5·price_tol (0.25)
    r = G.greeks(c)
    for g in (G.GAMMA, G.VEGA, G.RHO):
        assert r[g].status == G.EXACT_EXERCISED and r[g].value == 0.0 and r[g].estimate == 0.0, g
    # Tier 2's exercise decision unresolved (D_DECISION) blocks the exact branch
    r2 = G.greeks(c, decision_unresolved=True)
    assert r2[G.GAMMA].status == G.WITHHELD and r2[G.GAMMA].reason == G.R_NEAR
    assert r2[G.VEGA].status != G.EXACT_EXERCISED


def test_the_exercised_now_branch_needs_more_than_five_price_tolerances(monkeypatch):
    c = ctx(is_call=False, strike=200.0, days=60, rho=0.1, sigma=0.2)
    _free_moved_below(monkeypatch, 0.2)          # inside 5·price_tol
    r = G.greeks(c)
    assert r[G.GAMMA].status == G.WITHHELD and r[G.GAMMA].reason == G.R_NEAR


def test_near_the_exercise_boundary_gamma_is_withheld():
    # an American put whose spot sits on the exercise boundary: find a strike where the stencil is mixed
    hits = 0
    for k in np.linspace(118.0, 135.0, 18):
        r = G.greeks(ctx(is_call=False, strike=float(k), days=60, rho=0.1, sigma=0.2))
        if r[G.GAMMA].reason == G.R_NEAR:
            hits += 1
    assert hits >= 1


def test_the_work_cap_withholds_without_running():
    c = ctx()
    r = G.greeks(c, budget=fd.Budget(1000))
    assert all(r[g].reason in (G.R_WORK, G.R_NO_DIVIDEND) for g in G.GREEKS)
    assert r["_units"] == 0


def test_the_claim_region_is_decided_from_the_inputs():
    def region(c, g):
        return "outside this Greek's validated region" if g == G.VEGA and c.sigma < 0.05 else None
    r = G.greeks(ctx(sigma=0.04), region=region)
    assert r[G.VEGA].reason == "outside this Greek's validated region"
    assert r[G.GAMMA].reason != "outside this Greek's validated region"


# ── control C1 in miniature: European-mode FD Greeks against the closed forms (design section 7.3) ──

@pytest.mark.parametrize("c", [
    ctx(),
    ctx(is_call=True, strike=95.0, days=60, rho=0.03, divs=((20, 1.0),)),
    ctx(is_call=True, strike=100.0, days=1, rho=0.03),                      # days = 1: theta from the payoff
    ctx(is_call=False, strike=100.0, days=2, rho=0.02, sigma=0.4, divs=((1, 0.8),)),   # a day-1 close
    ctx(is_call=False, strike=110.0, days=200, rho=-0.01, q=0.03, sigma=0.5, divs=((50, 1.0), (140, 1.0))),
])
def test_european_mode_fd_greeks_match_the_closed_forms(c):
    r = G.greeks(c, american=False)
    cf = G.closed_forms(c)
    for g in G.GREEKS:
        a = r[g]
        if g == G.DIVIDEND and not c.divs:
            continue
        assert a.status in (G.RETURNED, G.WITHHELD)
        if a.status == G.RETURNED:
            assert abs(a.value - cf[g]) <= G.tolerance(g, cf[g], c.spot), (g, a.value, cf[g])


@pytest.mark.parametrize("spot", [1.0, 2500.0])
def test_european_mode_fd_greeks_scale_with_the_spot(spot):
    k = spot / 100.0
    c = ctx(is_call=True, spot=spot, strike=95.0 * k, days=60, rho=0.03, divs=((20, 1.0 * k),))
    r = G.greeks(c, american=False)
    cf = G.closed_forms(c)
    for g in G.GREEKS:
        a = r[g]
        assert a.status == G.RETURNED, (g, a.reason)
        assert abs(a.value - cf[g]) <= G.tolerance(g, cf[g], c.spot), (g, a.value, cf[g])


def test_expiry_states_never_reach_a_solver_or_closed_form(monkeypatch):
    # days = 1: theta's t + 1 state is expiry, valued as the intrinsic payoff at the held-fixed spot (DR-12)
    calls = []
    real = fd.solve

    def spy(*a, **k):
        calls.append(a[3])        # days
        return real(*a, **k)
    monkeypatch.setattr(fd, "solve", spy)
    c = ctx(is_call=True, strike=99.0, days=1, rho=0.03)
    r = G.greeks(c, american=False)
    assert calls and min(calls) >= 1
    cf = G.closed_forms(c)
    assert cf[G.THETA] == pytest.approx(1.0 - om.european(c), abs=1e-14)
    assert r[G.THETA].status == G.RETURNED
    with pytest.raises(ValueError):
        G.closed_forms(ctx(days=0))


# ── amendment P3-AM1 (pilot D2): the bump term in a bumped Greek's estimate ─────────────────────────────────────

# the dev pilot's G5-extreme-vol/3 inputs (bench-generated, invented): European-mode vega was 1.10 tol from the
# closed form while |G(h) − G(h/2)| = 0.79 tol passed rule 3 and the grid-only estimate was 0.29 tol
LOW_VOL = om.Context(False, 100.0, 95.346498, 155, 0.00212854, 0.04065392, 0.01080647, ((10, 0.923),))


def test_the_bump_term_withholds_the_low_volatility_vega_that_failed_control_c1():
    got = G.greeks(LOW_VOL, american=False)["vega"]
    assert got.status == G.WITHHELD and got.reason == G.R_ESTIMATE
    a = got.audit
    assert abs(a["L2"] - a["L2_half"]) <= a["tol"]                 # rule 3 alone lets it through
    grid = max(G.GreekConfig().factor(G.VEGA) * abs(a["L2"] - a["L1"]), G.FLOOR * a["tol"])
    assert grid <= a["tol"]                                         # the grid-only estimate would return it
    assert math.isclose(a["bump_term"], 4.0 / 3.0 * abs(a["L2"] - a["L2_half"]))
    assert math.isclose(got.estimate, grid + a["bump_term"]) and got.estimate > a["tol"]


def test_a_returned_bumped_greek_carries_its_bump_term_in_the_estimate():
    got = G.greeks(ctx())
    for g in G.BUMPED:
        a = got[g]
        if a.status != G.RETURNED:
            continue
        au = a.audit
        grid = max(G.GreekConfig().factor(g) * abs(au["L2"] - au["L1"]), G.FLOOR * au["tol"])
        assert math.isclose(a.estimate, grid + G.GreekConfig().bump_factor(g) * abs(au["L2"] - au["L2_half"]))
        assert a.value == au["L2"]                                  # the served value itself is unchanged


def test_gamma_and_theta_have_no_bump_term():
    got = G.greeks(ctx())
    for g in (G.GAMMA, G.THETA):
        assert "bump_term" not in got[g].audit


@pytest.mark.parametrize("bf", [((G.VEGA, 1.0), (G.RHO, 4 / 3), (G.DIVIDEND, 4 / 3)),
                                ((G.VEGA, 4 / 3), (G.RHO, 4 / 3)),
                                ((G.VEGA, 4 / 3), (G.RHO, 4 / 3), (G.DIVIDEND, 6.0))])
def test_the_bump_factor_is_one_of_the_candidates_and_never_below_four_thirds(bf):
    with pytest.raises(ValueError):
        G.GreekConfig(bump_factors=bf)


# ── design change P3-P1: bump states whose PV_0 moves are solved on the base context's grid ──────────────────────

def _old_bumped(run, g, ex_now, ptol):
    """`_bumped` as it was before P3-P1 (each state on its own centred grid), kept here as the pin for the states
    that P3-P1 leaves alone."""
    c, cfg = run.c, run.cfg
    if G._stencil_states(c, g, cfg) is None:
        return G._withheld(g, G.R_BUMP_DOMAIN)
    h = G.bump_size(c, g, cfg)
    vals = {}
    for k, hh in ((0, h), (1, h), (1, h / 2.0)):
        pair = []
        for sgn_h in (1.0, -1.0):
            s = run.solve(G.bumped(c, g, sgn_h * hh), k)
            if isinstance(s, fd.Refused):
                return G._withheld(g, G.R_WORK if s.reason == fd.R_WORK else f"{G.R_FD}: {s.reason}", level=k + 1, h=hh)
            pair.append(s)
        vals[(k, hh)] = pair
    up, dn = vals[(1, h)]
    (eu, fu), (ed, fdn) = G._spot_state(up), G._spot_state(dn)
    if eu != ed or G._zone_hit(fu, ex_now, ptol, cfg.zone) or G._zone_hit(fdn, ex_now, ptol, cfg.zone):
        return G._withheld(g, G.R_NEAR, rule=2)

    def diff(k, hh):
        p, m = vals[(k, hh)]
        return G.UNIT[g] * (p.value - m.value) / (2.0 * hh)
    g1, g2, g_half = diff(0, h), diff(1, h), diff(1, h / 2.0)
    tol = G.tolerance(g, g2, c.spot)
    if abs(g2 - g_half) > tol:
        return G._withheld(g, G.R_UNSTABLE, rule=3, L2=g2, L2_half=g_half, tol=tol)
    est, tol = G._estimate(g, g1, g2, c, cfg)
    bump_term = cfg.bump_factor(g) * abs(g2 - g_half)
    return G._answer(g, g1, g2, est + bump_term, tol, h=h, L2_half=g_half, bump_term=bump_term)


def _run(c, american=True, cfg=G.GreekConfig()):
    return G._Ctx(c, cfg, fd.Budget(cfg.fd.work_cap), fd.levels(c, cfg.fd), american=american)


UNMOVED = [   # (context, Greeks whose every state has PV_0 equal to the base's)
    (ctx(), (G.VEGA, G.RHO)),                                                         # no dividends
    (ctx(is_call=True, strike=95.0, days=60, rho=0.03, divs=((20, 1.0),)), (G.VEGA,)),
    (ctx(is_call=False, strike=110.0, days=90, rho=0.04, divs=((0, 1.5),)), (G.VEGA, G.RHO)),   # day-0 close only
]


@pytest.mark.parametrize("american", [True, False])
@pytest.mark.parametrize("c,names", UNMOVED)
def test_states_whose_pv0_does_not_move_are_solved_exactly_as_before(monkeypatch, c, names, american):
    new = G.greeks(c, american=american)
    monkeypatch.setattr(G, "_bumped", _old_bumped)
    old = G.greeks(c, american=american)
    for g in names:
        assert new[g] == old[g], g
    for g in (G.GAMMA, G.THETA):            # never through _bumped
        assert new[g] == old[g], g
    assert new["_units"] == old["_units"]


@pytest.mark.parametrize("american", [True, False])
def test_a_moved_state_is_read_on_the_base_grid_with_the_same_solves_and_units(monkeypatch, american):
    c = ctx(is_call=False, strike=110.0, days=120, rho=0.04, divs=((30, 1.2), (100, 1.2)))
    seen = []
    real = fd.price

    def spy(state, level, budget, **k):
        seen.append((state.spot, level))
        return real(state, level, budget, **k)
    monkeypatch.setattr(fd, "price", spy)
    new = G.greeks(c, american=american)
    n_new, units_new = len(seen), new["_units"]
    shifted = {sp for sp, _ in seen if sp != c.spot}
    seen.clear()
    monkeypatch.setattr(G, "_bumped", _old_bumped)
    old = G.greeks(c, american=american)
    assert shifted                                           # the dividend and rho states were moved
    assert n_new == len(seen) and units_new == old["_units"]     # the same solves of the same size


def test_the_base_grid_read_agrees_with_the_own_centred_solve_and_reads_free0_at_a_day0_close():
    # DR-AM4-2's case in production: an American call with a dividend at today's close; the read of the continuation
    # with the exercise value applied matches the state's own centred solve, a cubic through v0 does not
    for spot in (104.30, 104.50):
        c = ctx(is_call=True, spot=spot, strike=100.0, days=30, rho=0.0, q=0.0, sigma=0.2, divs=((0, 1.0),))
        run = _run(c)
        s = G.bumped(c, G.DIVIDEND, 0.05)
        pv_s, pv_c = fd.pv_owed(s.divs, s.rho, 0.0), fd.pv_owed(c.divs, c.rho, 0.0)
        for k in (0, 1):
            got = G._bump_state(run, s, k)
            own = run.solve(s, k).value
            shared = run.solve(replace(s, spot=c.spot - pv_c + pv_s), k)
            naive = G.cubic_at(shared.grids["x"], shared.grids["v0"], math.log(s.spot - pv_s))
            assert abs(got.value - own) < 1e-5
            assert abs(naive - own) > 1e-3


def test_rule_2_reads_the_moved_states_at_their_own_spot(monkeypatch):
    c = ctx(is_call=False, strike=110.0, days=120, rho=0.04, divs=((30, 1.2),))
    assert G.greeks(c)[G.DIVIDEND].reason != G.R_NEAR
    real = G._bump_state
    flip = iter([False, True] * 10)

    def split(run, s, k):
        got = real(run, s, k)
        return G._Read(got.value, next(flip), got.free) if k == 1 else got
    monkeypatch.setattr(G, "_bump_state", split)
    got = G.greeks(c)[G.DIVIDEND]
    assert got.reason == G.R_NEAR and got.audit["rule"] == 2


def test_a_refused_shifted_state_withholds_with_the_kernel_s_reason():
    # design review DR-02: K/S = 20 at the edge of the domain; the shifted spot of the +rho state puts K/S' above 20
    c = ctx(is_call=False, spot=100.0, strike=2000.0, days=60, rho=0.0, q=0.0, sigma=0.2, divs=((30, 1.0),))
    assert G.state_failure(c) is None
    got = G.greeks(c, american=False)           # C1 (in American mode this deep put is exempt: closed forms)
    for g in (G.RHO, G.DIVIDEND):
        a = got[g]
        assert a.status == G.WITHHELD and a.reason.startswith(G.R_FD) and a.audit.get("shifted_state") is True


def test_a_read_outside_the_grid_is_refused_never_extrapolated():
    # design review DR-01: a valid context whose L1/L2 half-width (0.014) is smaller than the rho bump's read
    # displacement; the full bumps are refused, the half bumps (displacement 0.007) are read
    c = ctx(is_call=False, spot=100.0, strike=11.0, days=1464, rho=0.0, q=-0.0000005, sigma=0.001,
            divs=tuple((1120 + 11 * i, 89 / 31) for i in range(31)))
    assert G.state_failure(c) is None
    for american in (True, False):
        run = _run(c, american)
        h = G.bump_size(c, G.RHO, G.GreekConfig())
        for k in (0, 1):
            for sgn in (1.0, -1.0):
                full = G._bump_state(run, G.bumped(c, G.RHO, sgn * h), k)
                half = G._bump_state(run, G.bumped(c, G.RHO, sgn * h / 2.0), k)
                assert isinstance(full, G._ReadRefused) and full.reason == G.R_READ
                assert isinstance(half, G._Read)
        a = G.greeks(c, american=american)[G.RHO]
        assert a.status == G.WITHHELD and a.reason == G.R_READ and a.audit["level"] == 1


def test_the_t1_33_dividend_estimate_now_covers_its_reference_error():
    # the dev generator's T1-near-boundary/33 inputs (invented): before P3-P1 the dividend sensitivity was returned
    # 0.140 tol from its resolved reference with an estimate of 0.131 tol (a coverage miss)
    c = ctx(is_call=False, spot=100.0, strike=112.879013, days=60, rho=0.09103545, q=-0.01480167, sigma=0.2813312,
            divs=((0, 1.5703),))
    ref, tol = 0.9560106221108564, 0.0025
    a = G.greeks(c)[G.DIVIDEND]
    assert a.status == G.RETURNED
    assert abs(a.value - ref) <= a.estimate and abs(a.value - ref) < 0.05 * tol
