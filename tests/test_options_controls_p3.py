"""Phase 3 exact controls, the exempt population E, the proved bounds and the QuantLib diagnostic
(design-P3-approved.md sections 7.3 to 7.6; build step 9)."""

from __future__ import annotations

import cmath
import math
from dataclasses import replace

import numpy as np
import pytest
from scipy.special import erfc

from scripts.options_bench import cases
from scripts.options_bench import controls_p3 as C
from scripts.options_bench import greek_reference as GR
from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_greeks as G
from src.desk import options_math as om

SEED = 20261026


def ctx(is_call=False, spot=100.0, strike=105.0, days=60, rho=0.05, q=0.0, sigma=0.3, divs=()):
    return om.Context(is_call, spot, strike, days, rho, q, sigma, tuple(divs))


# ── the closed forms against a complex-step derivative of the closed-form value ──

def _value(is_call, S, K, days, r, q, sig, divs):
    """Black-76 on the escrowed forward, written with complex-safe functions (erfc and exp accept complex)."""
    tau = days / 365.0
    X = S - sum(a * cmath.exp(-r * d / 365.0) for d, a in divs)
    F = X * cmath.exp((r - q) * tau)
    vol = sig * math.sqrt(tau) if not isinstance(sig, complex) else sig * math.sqrt(tau)
    d1 = (cmath.log(F / K) + 0.5 * vol * vol) / vol
    d2 = d1 - vol
    N = lambda z: 0.5 * erfc(-z / math.sqrt(2.0))
    df = cmath.exp(-r * tau)
    return df * (F * N(d1) - K * N(d2)) if is_call else df * (K * N(-d2) - F * N(-d1))


H = 1e-20


def _cstep(f, x):
    return f(complex(x, H)).imag / H


CASES = [ctx(is_call=True, strike=95.0, days=90, rho=0.03, q=-0.02, sigma=0.25, divs=((30, 1.0), (60, 0.8))),
         ctx(is_call=False, strike=110.0, days=200, rho=-0.01, q=0.02, sigma=0.4, divs=((5, 1.5),)),
         ctx(is_call=True, spot=2500.0, strike=2400.0, days=400, rho=0.05, q=0.01, sigma=0.2, divs=((100, 20.0),)),
         ctx(is_call=False, spot=1.0, strike=1.2, days=30, rho=0.02, q=0.0, sigma=0.6)]


@pytest.mark.parametrize("c", CASES)
def test_the_closed_form_greeks_match_a_complex_step_derivative(c):
    cf = G.closed_forms(c)
    a = lambda **k: _value(**{**dict(is_call=c.is_call, S=c.spot, K=c.strike, days=c.days, r=c.rho, q=c.q,
                                     sig=c.sigma, divs=c.divs), **k})
    assert cf["value"] == pytest.approx(a().real, rel=1e-12)
    assert cf["delta"] == pytest.approx(_cstep(lambda s: a(S=s), c.spot), rel=1e-9, abs=1e-12)
    assert cf[G.VEGA] == pytest.approx(0.01 * _cstep(lambda s: a(sig=s), c.sigma), rel=1e-9, abs=1e-12)
    # rho with S fixed: the rate-dividend interaction (X moves through PV_0) is inside the complex step
    assert cf[G.RHO] == pytest.approx(0.01 * _cstep(lambda r: a(r=r), c.rho), rel=1e-9, abs=1e-12)
    # gamma: a central difference of the complex-step delta
    h = 1e-4 * c.spot
    d = lambda s: _cstep(lambda z: a(S=z), s)
    assert cf[G.GAMMA] == pytest.approx((d(c.spot + h) - d(c.spot - h)) / (2 * h), rel=1e-6)
    if c.divs:
        j = G.next_dividend(c)

        def with_d(x):
            return a(divs=tuple((dd, x if i == j else aa) for i, (dd, aa) in enumerate(c.divs)))

        assert cf[G.DIVIDEND] == pytest.approx(_cstep(with_d, c.divs[j][1]), rel=1e-9, abs=1e-12)
    later = G.one_day_later(c)
    assert cf[G.THETA] == pytest.approx(G.closed_forms(later)["value"] - cf["value"], rel=1e-12)


# ── C1 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("c", CASES[:2] + [ctx(), ctx(is_call=True, strike=90.0, days=3, sigma=1.2)])
def test_c1_the_european_mode_fd_greeks_pass_against_the_closed_forms(c):
    got = C.c1(c)
    returned = [g for g in G.GREEKS if got[g]["status"] == G.RETURNED]
    assert returned
    for g in returned:
        assert got[g]["result"] == "pass", (g, got[g])


def test_c1_judges_against_the_exact_value_with_no_u(monkeypatch):
    real = G.greeks

    def off(c, cfg, american=True, **kw):
        out = real(c, cfg, american=american, **kw)
        a = out[G.GAMMA]
        out[G.GAMMA] = replace(a, value=a.value + 1.01 * G.tolerance(G.GAMMA, a.value, c.spot))
        return out

    monkeypatch.setattr(G, "greeks", off)
    assert C.c1(ctx())[G.GAMMA]["result"] == "fail"


# ── C2 ─────────────────────────────────────────────────────────────────────

def test_the_c2_verdict_is_the_one_sided_clopper_pearson_limit_at_one_percent():
    row = lambda ok: {G.GAMMA: {"status": "scored", "covered": ok}}
    assert C.c2_verdict([row(True)] * 300)[G.GAMMA]["verdict"] == "pass"     # upper 0.995%
    assert C.c2_verdict([row(True)] * 299)[G.GAMMA]["verdict"] == "not established"
    v = C.c2_verdict([row(True)] * 299 + [row(False)])[G.GAMMA]
    assert v["verdict"] == "fail" and v["misses"] == 1
    v = C.c2_verdict([row(True)] * 300 + [{G.GAMMA: {"status": "unresolved: x"}}])[G.GAMMA]
    assert v["scored"] == 300 and v["unscored"] == 1


def test_c2_fd_scores_the_european_study_against_the_closed_form():
    e = ctx(is_call=False, strike=100.0, rho=-0.01, q=0.02)
    got = C.c2_fd(e, quantities=(GR.PRICE, G.GAMMA))
    for k in (GR.PRICE, G.GAMMA):
        assert got[k]["status"] == "scored" and got[k]["covered"], got[k]
    assert got["_work"]["lattice_calls"] == 0


def test_c2_lattice_runs_only_where_the_whole_stencil_is_exempt():
    put0 = ctx(is_call=False, strike=100.0, rho=0.0, q=0.02)        # rho's stencil crosses r = 0
    assert om.exempt(put0)
    assert not C.stencil_exempt(put0, G.RHO) and C.stencil_exempt(put0, G.VEGA)
    got = C.c2_lattice(put0, quantities=(G.RHO, G.VEGA, G.GAMMA))
    assert got[G.RHO]["status"] == "not exempt"
    assert got[G.GAMMA]["status"] == "scored" and got[G.GAMMA]["covered"], got[G.GAMMA]


# ── the exempt population E ────────────────────────────────────────────────

@pytest.mark.parametrize("stratum", list(C.E_STRATA))
def test_e_proposals_are_deterministic_in_domain_exempt_and_never_redrawn(stratum):
    pop = C.e_population(SEED, stratum, 200)
    assert [c.id for c in pop] == [c.id for c in C.e_population(SEED, stratum, 200)]
    assert all(int(c.id.split("/")[1]) < 200 for c in pop)
    for c in pop:
        x = C.to_ctx(c)
        assert cases.domain_reason(c) is None and om.in_domain(x) is None and om.exempt(x)
    # the stratum keeps the generator's own ranges: drawn with the same draw function
    for c in pop[:20]:
        assert c.group == stratum


def test_e_streams_are_disjoint_from_the_bench_groups():
    g1 = cases.case(SEED, "G1-nodiv", 0)
    e = [C.e_proposal(SEED, "E-nodiv", i) for i in range(50)]
    assert all(x is None or (x.strike, x.days, x.sigma) != (g1.strike, g1.days, g1.sigma) for x in e)


def test_e_div_draws_dividend_calls_only_when_exempt():
    pop = C.e_population(SEED, "E-div", 400)
    assert pop and all(c.divs and c.is_call for c in pop)


# ── proved bounds (section 7.5) ────────────────────────────────────────────

def _t2(value=10.0, delta=0.5, de=1e-4, est=1e-3):
    return oe.Answer(engine="adaptive", version=oa.VERSION, route=oe.ROUTE_LATTICE, price_status=oe.ESTIMATED,
                     value=value, estimate=est, delta_status=oe.SERVED, delta=delta, delta_estimate=de)


def _ga(g, v, e):
    return G.GreekAnswer(g, G.RETURNED, v, e, None, {})


def test_no_plus_or_minus_one_bound_on_delta_dr_01():
    c = ctx(is_call=True, strike=5.0, days=1460, rho=0.0, q=-0.1, sigma=0.2)
    assert G.closed_forms(c)["delta"] == pytest.approx(1.4918, abs=1e-4)
    t2 = _t2(value=om.european(c), delta=1.4918)
    assert C.bound_violations(c, t2, {}) == []


def test_each_bound_is_a_failure_only_past_its_own_estimate():
    c = ctx(is_call=True, strike=100.0)
    assert C.bound_violations(c, _t2(delta=-2e-4, de=1e-4), {}) == ["call delta below 0"]
    assert C.bound_violations(c, _t2(delta=-0.5e-4, de=1e-4), {}) == []
    p = ctx(is_call=False, strike=100.0)
    assert C.bound_violations(p, _t2(value=om.european(p), delta=2e-4, de=1e-4), {}) == ["put delta above 0"]
    gs = {G.GAMMA: _ga(G.GAMMA, -0.002, 0.001), G.VEGA: _ga(G.VEGA, -0.0005, 0.001)}
    assert C.bound_violations(c, None, gs) == ["gamma below 0"]
    low = om.european(c) - 0.01
    assert C.bound_violations(c, _t2(value=low, est=0.001), {}) == ["value below max(European, exercise now)"]
    assert C.bound_violations(c, _t2(value=low, est=0.02), {}) == []


def test_negative_yield_exempt_contracts_pass_the_bounds_with_their_closed_forms():
    for c in (ctx(is_call=True, strike=100.0, rho=0.02, q=-0.05), ctx(is_call=False, strike=100.0, rho=-0.02, q=0.03)):
        cf = G.closed_forms(c)
        gs = {g: _ga(g, cf[g], 0.0) for g in (G.GAMMA, G.VEGA)}
        assert C.bound_violations(c, _t2(value=cf["value"], delta=cf["delta"], de=0.0), gs) == []


# ── QuantLib, diagnostic only ──────────────────────────────────────────────

def test_quantlib_is_skipped_where_its_dividend_convention_differs():
    assert C.quantlib_greeks(ctx(q=0.01, divs=((10, 1.0),))) is None


def test_quantlib_greeks_are_a_diagnostic_near_the_closed_forms_on_an_exempt_context():
    from scripts.options_bench.crosscheck import ql
    if ql is None:
        pytest.skip("QuantLib is not installed")
    c = ctx(is_call=True, strike=100.0, rho=0.03, q=0.0, sigma=0.3)
    got = C.quantlib_greeks(c)
    cf = G.closed_forms(c)
    assert got["value"] == pytest.approx(cf["value"], rel=1e-3)
    assert got[G.GAMMA] == pytest.approx(cf[G.GAMMA], rel=2e-2)
    assert got[G.VEGA] == pytest.approx(cf[G.VEGA], rel=1e-2)
