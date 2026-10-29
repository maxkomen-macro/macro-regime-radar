"""The Tier 2 convergence controller (adaptive Phase 2, build step 3): routes, estimators, the proved interval,
the delta gate, caps, determinism, and the two positive controls on synthetic contexts."""

from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from scripts.options_bench import cases, golden
from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_math as om

REPO = Path(__file__).resolve().parent.parent
SEED = 20261026


def ctx(c: cases.Case) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


def sample(group: str, n: int) -> list[om.Context]:
    return [ctx(cases.case(SEED, group, i)) for i in range(n)]


R1 = ctx(golden.R1)


# ── routes ───────────────────────────────────────────────────────────────────

def test_r1_returns_the_interval_midpoint_with_its_half_width():
    a = oa.price(R1)
    eu = om.european(R1)
    lo, hi = a.audit["L"], a.audit["U"]
    assert lo == 10.0 and eu < 10.0 and hi >= lo
    assert a.route == oe.ROUTE_ANALYTIC and a.price_status == oe.ANALYTIC
    assert a.value == lo + (hi - lo) / 2 and lo <= a.value <= hi
    assert a.value == pytest.approx(10.00000000005, abs=1e-12)
    assert a.estimate == max(a.audit["h"], 0.1 * om.tolerance(lo, R1.spot)) == pytest.approx(1e-3)
    # the delta is not certified by the price: it comes from its own lattice levels (deep exercise)
    assert a.delta_status == oe.SERVED and a.delta == -1.0 and a.audit["delta_rule"] == "deep exercise"
    assert a.audit["delta_units"] > 0
    assert oe.baseline(R1).value == eu   # Tier 1 unchanged: still the European value below intrinsic


def test_expiry_exempt_input_and_domain_routes():
    a = oa.price(om.Context(True, 100.0, 90.0, 0, 0.03, 0.0, 0.2))
    assert (a.route, a.price_status, a.value, a.delta_status) == (oe.ROUTE_INTRINSIC, oe.EXACT, 10.0, oe.WITHHELD)
    ex = om.Context(True, 100.0, 105.0, 90, 0.03, 0.0, 0.2)   # Merton: a call on a non-paying stock
    a = oa.price(ex)
    assert (a.route, a.price_status, a.value, a.delta) == (oe.ROUTE_EXEMPT, oe.EXACT, om.european(ex),
                                                          om.european_delta(ex))
    a = oa.price(om.Context(True, 100.0, 105.0, 90, 0.03, 0.0, float("nan")))
    assert a.price_status == oe.INPUT and a.value is None
    a = oa.price(om.Context(False, 100.0, 105.0, 30, 0.03, 0.0, 0.2, ((3, 101.0),)))
    assert a.price_status == oe.INPUT
    for named in cases.NAMED:
        if named.expect == "refused:domain":
            a = oa.price(ctx(named))
            assert a.price_status == oe.OUTSIDE and a.reason == om.in_domain(ctx(named)), named.id


def test_input_triage_refuses_bools_and_non_positive_dividends():
    # DR-01: a negative dividend made om.exempt true for a put worth 7.005 against an exercise value of 10
    neg = om.Context(False, 100.0, 110.0, 30, 0.03, 0.0, 0.2, ((10, -3.0),))
    for c, why in ((neg, "a dividend amount that is not positive"),
                   (om.Context(1, 100.0, 100.0, 30, 0.03, 0.0, 0.2), "the option type is not a call or a put"),
                   (om.Context(True, 100.0, 100.0, True, 0.03, 0.0, 0.2),
                    "the days to expiry are not a whole number of at least 0"),
                   (om.Context(True, 100.0, 100.0, 30, 0.03, 0.0, 0.2, ((True, 1.0),)),
                    "a dividend day outside the contract's life")):
        a = oa.price(c)
        assert (a.route, a.price_status, a.value, a.reason) == (oe.ROUTE_NONE, oe.INPUT, None, why), c


def test_domain_is_tested_before_the_exempt_route():
    c = om.Context(True, 100.0, 105.0, 90, 0.9, 0.0, 0.2)   # exempt (a non-paying call), rho outside the domain
    assert om.exempt(c) and om.in_domain(c) is not None
    a = oa.price(c)
    assert a.price_status == oe.OUTSIDE and a.reason == om.in_domain(c)
    assert oe.baseline(c).route == oe.ROUTE_EXEMPT   # Tier 1 still serves it; Tier 2 refuses more, never less


def test_arithmetic_in_input_triage_is_a_named_refusal():
    # DR-08: finite inputs whose dividend PV overflows before the domain test could reject rho
    c = om.Context(True, 100.0, 100.0, 1464, -1000.0, 0.0, 0.2, ((1463, 1.0),))
    with pytest.raises(OverflowError):
        c.pv()
    a = oa.price(c)
    assert (a.route, a.price_status, a.value, a.reason) == (oe.ROUTE_NONE, oe.INPUT, None, oa.ARITHMETIC)
    assert a.delta_status == oe.WITHHELD


def test_huge_spot_keeps_the_analytic_price_when_only_delta_work_overflows():
    # DR-02 and DR-07: the midpoint is L + h, never (L + U)/2, and delta-only arithmetic never discards the price
    c = om.Context(False, 1e307, 1e308, 1, 0.001, 0.0, 0.05)
    a = oa.price(c)
    lo, hi = a.audit["L"], a.audit["U"]
    assert a.route == oe.ROUTE_ANALYTIC and a.price_status == oe.ANALYTIC
    assert math.isfinite(a.value) and lo <= a.value <= hi and a.value == lo + (hi - lo) / 2
    assert a.estimate == max(a.audit["h"], 0.1 * om.tolerance(lo, c.spot))
    assert a.delta_status in (oe.SERVED, oe.WITHHELD)
    assert a.delta_status == oe.SERVED or a.delta_reason in (oa.D_ZONE, oa.D_DECISION, oa.D_ABOVE, oa.ARITHMETIC)


@pytest.mark.parametrize("c,route", [
    (om.Context(True, 1e307, 1e306, 0, 0.03, 0.0, 0.2), oe.ROUTE_INTRINSIC),
    (om.Context(True, 1e300, 1.05e300, 90, 0.03, 0.0, 0.2), oe.ROUTE_EXEMPT),
    (om.Context(False, 1e300, 1e300, 200, 0.05, 0.0, 0.2), oe.ROUTE_LATTICE),
    (om.Context(False, 1e307, 1.2e307, 200, 0.05, 0.0, 0.2), oe.ROUTE_LATTICE),
])
def test_huge_spot_on_every_route_is_finite_or_named(c, route):
    a = oa.price(c)
    assert a.route == route
    for v in (a.value, a.estimate, a.delta, a.delta_estimate):
        assert v is None or math.isfinite(v)
    if a.priced and a.route == oe.ROUTE_LATTICE:
        assert a.audit["L"] <= a.value <= a.audit["U"]


def test_named_regressions_keep_their_delta_withholding():
    b8 = ctx(next(c for c in cases.NAMED if c.id == "named/B8"))
    a = oa.price(b8)
    assert a.priced and a.delta_status == oe.WITHHELD and a.delta_reason == oa.D_DIVIDEND
    b9a = ctx(next(c for c in cases.NAMED if c.id == "named/B9a"))
    a = oa.price(b9a)
    assert a.priced and a.delta_status == oe.WITHHELD and a.delta_reason == oa.D_ZONE


def test_config_never_lets_f_below_two_or_tau_outside_its_range():
    for bad in (dict(F=1.5), dict(F_d=1.0), dict(tau=0.05), dict(tau=1.5), dict(schedule="x"), dict(estimator="y")):
        with pytest.raises(ValueError):
            oa.Config(**bad)


# ── estimators ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tri", [(1, 2, 4), (2, 4, 8), (4, 8, 16), (8, 16, 32), (1, 2, 3), (2, 3, 4), (3, 4, 5),
                                 (4, 5, 6)])
def test_rho_is_increasing_on_the_admissible_orders(tri):
    ps = np.linspace(*oa.P_RANGE, 2001)
    assert np.all(np.diff([oa.rho_p(p, *tri) for p in ps]) > 0)


@pytest.mark.parametrize("ms", [(1, 2, 4, 8), (1, 2, 3, 4), (3, 4, 5, 6)])
@pytest.mark.parametrize("p", [0.7, 1.0, 1.6, 2.5])
def test_fitted_order_is_exact_on_its_own_model(ms, p):
    hs = [7.25 + 0.031 * m ** -p for m in ms]
    h, e, how, detail = oa.estimate(list(ms), hs, 100.0, "fitted")
    assert how == "fitted"
    assert detail["fits"][1][0] == pytest.approx(p, abs=1e-8)
    assert h == pytest.approx(7.25, abs=1e-10) and e < 1e-10


def test_unidentified_order_falls_back_to_the_envelope():
    ms = [1, 2, 4, 8]
    for hs in ([5.0, 5.0, 5.0, 5.0],                 # equal levels
               [5.0, 5.01, 5.0, 5.01],               # changes of opposite sign
               [5.0, 5.1, 5.1001, 5.10010001]):      # a ratio far outside the admissible orders
        h, e, how, _ = oa.estimate(ms, hs, 100.0, "fitted")
        hb, eb, _ = oa.envelope(ms, hs)
        assert how == "order not identified" and (h, e) == (hb, eb)


def test_envelope_is_bbsr_on_doubling():
    ms, hs = [1, 2, 4, 8], [3.0, 3.2, 3.26, 3.275]
    hb, e, bs = oa.envelope(ms, hs)
    assert bs == pytest.approx([3.4, 3.32, 3.29]) and hb == pytest.approx(3.29)
    assert e == pytest.approx(0.08)


# ── the walk: stopping, the interval, the delta ──────────────────────────────

def synthetic(hs, ds, step=200):
    levels = [oa.Level(m, m * step, h, d, oa.units(m * step)) for m, h, d in zip((1, 2, 4, 8, 16, 32), hs, ds)]
    return lambda i, used: levels[i] if i < len(levels) else oa.LEVEL_CAP


PUT = om.Context(False, 100.0, 100.0, 200, 0.05, 0.0, 0.2)


def test_price_is_fixed_at_its_first_acceptable_level():
    hs = [6.0, 6.004, 6.005, 6.00525, 6.0526, 9.0]        # wild later levels must not move the price
    ds = [-0.40, -0.41, -0.42, -0.425, -0.4251, -0.4251]
    w = oa.walk(synthetic(hs, ds), PUT, 0.0, 5.0, 7.0, oa.Config())
    assert w.price["level"] == 3 and w.price["value"] == pytest.approx(oa.rich(4, 6.005, 8, 6.00525))
    assert w.price["estimate"] == max(2 * w.trace[0]["E"], 0.1 * w.price["tol"])


def test_a_value_outside_the_proved_interval_is_never_clipped_or_accepted():
    hs = [6.0, 6.004, 6.005, 6.00525]
    w = oa.walk(synthetic(hs, [-0.4] * 4), PUT, 0.0, 6.0056, 7.0, oa.Config())   # B = 6.0055 just below L
    assert w.price is None and w.price_reason == oa.OUTSIDE_INTERVAL and w.proved_exceedance is None
    w = oa.walk(synthetic(hs, [-0.4] * 4), PUT, 0.0, 6.2, 7.0, oa.Config())      # far below: a contradiction
    assert w.price is None and w.price_reason == oa.CONTRADICTED and w.proved_exceedance["dist"] > 0.1


def test_delta_has_its_own_gate():
    hs = [6.0, 6.004, 6.005, 6.00525, 6.0053]
    noisy = [-0.40, -0.43, -0.41, -0.44, -0.425]             # the price converges, the delta does not
    w = oa.walk(synthetic(hs, noisy), PUT, 0.0, 5.0, 7.0, oa.Config())
    assert w.price is not None and w.delta is None and w.delta_reason in (oa.D_ABOVE, oa.LEVEL_CAP)
    calm = [-0.40, -0.41, -0.415, -0.4175, -0.41755]
    w = oa.walk(synthetic(hs, calm), PUT, 0.0, 5.0, 7.0, oa.Config())
    assert w.delta is not None and w.delta["estimate"] <= om.DELTA_TOL and w.delta["rule"] == "envelope"


def test_plus_minus_one_only_on_the_deep_exercise_rule():
    itm = om.Context(False, 80.0, 100.0, 200, 0.05, 0.0, 0.2)   # X = 20
    hs = [19.98, 19.99, 19.995, 19.9975]
    w = oa.walk(synthetic(hs, [-1.0] * 4), itm, 20.0, 20.0, 20.5, oa.Config())
    assert w.price["value"] == 20.0 and w.delta == {"value": -1.0, "estimate": oa.DELTA_FLOOR, "level": 3,
                                                    "rule": "deep exercise"}
    w = oa.walk(synthetic(hs, [-1.0, -1.0, -0.98, -1.0]), itm, 20.0, 20.0, 20.5, oa.Config())
    assert w.delta is None and w.delta_reason == oa.D_ZONE   # Tier 1 would serve −1 here; Tier 2 withholds


def test_early_dividend_withholds_the_delta_and_keeps_the_price():
    c = om.Context(True, 100.0, 95.0, 120, 0.03, 0.0, 0.25, ((2, 1.0),))
    a = oa.price(c)
    assert a.priced and a.delta_status == oe.WITHHELD and a.delta_reason == oa.D_DIVIDEND


# ── caps and work ────────────────────────────────────────────────────────────

def test_doubling_cannot_reach_four_levels_above_1118_days_and_multiples_can():
    long = om.Context(False, 100.0, 120.0, 1300, 0.04, 0.0, 0.3)
    a = oa.price(long, oa.Config(schedule="doubling"))
    assert a.price_status == oe.UNRESOLVED and a.reason == oa.SHORT
    assert oa.multipliers("hybrid", om.steps_for(1300)) == oa.SCHEDULES["multiples"]
    assert oa.multipliers("hybrid", om.steps_for(1118)) == oa.SCHEDULES["doubling"]
    a = oa.price(long, oa.Config(schedule="multiples"))
    assert a.priced and max(l["units"] for l in a.audit["levels"]) <= om.REFINE_UNITS_MAX


def test_work_is_every_level_recomputed_and_charged():
    c = sample("G1-nodiv", 12)
    for x in c:
        a = oa.price(x)
        if a.route != oe.ROUTE_LATTICE:
            continue
        lattice = sum(l["units"] for l in a.audit["levels"])
        assert a.audit["levels"][0]["m"] == 1 and a.audit["levels"][1]["m"] == 2
        assert a.units == a.audit["price_units"] + a.audit["delta_units"]
        assert a.audit["price_units"] + a.audit["delta_units"] - lattice > 0   # closed form and bound too
        assert len(a.audit["levels"]) <= oa.K_MAX


# ── positive controls ────────────────────────────────────────────────────────

def test_exempt_contracts_forced_through_the_lattice_match_black76_within_their_estimate():
    forced = oa.Config(force_lattice=True)
    n = 0
    for c in sample("G0-exempt", 25):
        if om.in_domain(c) is not None:
            continue
        a = oa.price(c, forced)
        assert a.route == oe.ROUTE_LATTICE
        if a.price_status == oe.ESTIMATED:
            n += 1
            assert abs(a.value - om.european(c)) <= a.estimate, c
            if a.delta_status == oe.SERVED:
                assert abs(a.delta - om.european_delta(c)) <= a.delta_estimate, c
    assert n >= 15


@pytest.mark.parametrize("group", ["G1-nodiv", "G2-dividends", "G4-negrate", "G6-long", "T1-near-boundary"])
def test_tier2_agrees_with_tier1_where_tier1_converged(group):
    for c in sample(group, 15):
        t1, t2 = oe.baseline(c), oa.price(c)
        if t1.route == oe.ROUTE_LATTICE and t1.priced and t2.priced:
            assert abs(t2.value - t1.value) <= t2.estimate + om.tolerance(t1.value, c.spot), c


# ── determinism and offline equivalence ──────────────────────────────────────

def test_same_inputs_give_bit_identical_answers_and_offline_equals_live():
    cs = sample("G2-dividends", 6) + sample("G6-long", 3) + [R1]
    cache = {}

    def cached(c, m):
        if (c, m) not in cache:
            cache[(c, m)] = oa.lattice_level(c, m)
        return cache[(c, m)]

    for c in cs:
        for cfg in (oa.Config(), oa.Config(estimator="fitted", schedule="multiples", F=2.5)):
            live = oa.price(c, cfg)
            assert live == oa.price(c, cfg)
            assert oa.price(c, cfg, level_source=cached) == live
            assert live.audit == oa.price(c, cfg).audit


def test_answers_match_in_a_fresh_process():
    code = ("from src.desk import options_adaptive as oa, options_math as om;"
            "a=oa.price(om.Context(True,100.0,95.0,400,0.04,0.02,0.35,((100,0.8),(282,0.8))));"
            "print(repr(a.value), repr(a.estimate), repr(a.delta), a.units)")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=REPO, check=True,
                         env={"FRED_API_KEY": "placeholder", "PATH": "/usr/bin:/bin"}).stdout.split()
    a = oa.price(om.Context(True, 100.0, 95.0, 400, 0.04, 0.02, 0.35, ((100, 0.8), (282, 0.8))))
    assert out == [repr(a.value), repr(a.estimate), repr(a.delta), str(a.units)]
