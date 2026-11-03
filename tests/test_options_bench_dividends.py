"""Dividend handling in the bench's FD reference (scripts/options_bench/fd.py), design D-2 of the dividend-scenario fix.

A step that ends at a cum close holds the ex-dividend exercise value inside its solve and takes the cum value by
projection at the close. Before the fix the cum value sat inside the solve, and at a day-0 close (no damping step
after it) Crank-Nicolson rang: T1-near-boundary/1351 of seed 20261029 read 14.354014 to 14.356422 where the value is
exactly the exercise value 14.353056.

Independent values below are frozen with their provenance (QuantLib 1.44, computed 2026-11-03), so these tests do not
need QuantLib; the last test recomputes them when QuantLib is installed. QuantLib's escrowed engine discounts the
escrowed dividend at r - q, the bench's model at r: they agree only when q = 0, so only q = 0 cases use it.
"""

from __future__ import annotations

import math

import pytest

from scripts.options_bench import fd, reference
from scripts.options_bench.cases import Case


def _case(**a) -> Case:
    return Case(id="test", group="named", kind="named", **a)


# T1-near-boundary/1351, seed 20261029: a call whose dividend's cum close is today. Holding loses the dividend:
# the hold value is QuantLib QdFp (high precision) on S - D with no dividends, 14.332860339; exercise is S - K.
T1_1351 = dict(is_call=True, spot=100.0, strike=85.646944, days=38, rho=0.03797186, q=0.05359212, sigma=0.51036866,
               divs=((0, 1.5518),))
T1_1351_WIDTH = 1.1679147431844443   # the reference's own half-width for this case


@pytest.mark.parametrize("m, per_day", [(992, 40), (1984, 40), (3968, 40), (3968, 160)])
def test_a_day_0_close_does_not_ring(m, per_day):
    v, _ = fd.solve(m=m, per_day=per_day, width=T1_1351_WIDTH, **T1_1351)
    assert abs(v - (100.0 - 85.646944)) <= 1e-9


def test_the_day_0_call_reference_resolves_to_exercise():
    r = reference.reference(_case(**T1_1351))["value"]
    assert r["status"] == "reliable"
    assert abs(r["ref"] - (100.0 - 85.646944)) <= r["u"]


# A put with a day-0 dividend: holding keeps the drop, so the value is the American put on S - D with no dividends,
# QuantLib QdFp (high precision) 12.014141483524208; exercise today (K - S = 10) is worse.
PUT_0 = dict(is_call=False, spot=100.0, strike=110.0, days=30, rho=0.05, q=0.0, sigma=0.25, divs=((0, 2.0),))
PUT_0_EXACT = 12.014141483524208


def test_the_day_0_put_reference_matches_the_exact_decomposition():
    r = reference.reference(_case(**PUT_0))["value"]
    assert r["status"] == "reliable"
    assert abs(r["ref"] - PUT_0_EXACT) <= r["u"]


# Interior cum closes, q = 0, against QuantLib's escrowed FD (Crank-Nicolson, Richardson over three grids; the spread is
# the last two grids' difference). "cn": the step into the close is a Crank-Nicolson step at the reference's grid.
# "rn": the dividend is on the last day and per_day = 2, so the step into the close is a Rannacher half-step pair.
QL = {
    "cn_call": (dict(is_call=True, spot=100.0, strike=95.0, days=60, rho=0.03, q=0.0, sigma=0.3, divs=((30, 2.0),)),
                7.115936209032569, 2.1154694493930037e-06),
    "cn_put": (dict(is_call=False, spot=100.0, strike=105.0, days=60, rho=0.05, q=0.0, sigma=0.3, divs=((30, 2.0),)),
               8.703874167516915, 4.560554372901038e-05),
    "rn_call": (dict(is_call=True, spot=100.0, strike=95.0, days=20, rho=0.03, q=0.0, sigma=0.35, divs=((19, 1.5),)),
                6.301259457929701, 1.1574696739735657e-05),
    "rn_put": (dict(is_call=False, spot=100.0, strike=105.0, days=20, rho=0.05, q=0.0, sigma=0.35, divs=((19, 1.5),)),
               7.316360584454137, 4.131010413921388e-05),
}


@pytest.mark.parametrize("name", ["cn_call", "cn_put"])
def test_an_interior_close_reference_agrees_with_quantlib(name):
    a, ql_value, spread = QL[name]
    r = reference.reference(_case(**a))["value"]
    assert r["status"] == "reliable"
    assert abs(r["ref"] - ql_value) <= r["u"] + spread


@pytest.mark.parametrize("name", ["rn_call", "rn_put"])
def test_a_rannacher_step_into_a_close_holds_the_ex_dividend_obstacle(name):
    # Before the fix, at per_day = 2: call 6.1e-3 and put -2.8e-3 from QuantLib; after: 5.6e-4 and -7.4e-4.
    a, ql_value, spread = QL[name]
    m, _, w = reference.grid(_case(**a))
    assert (a["days"] - 1) * 2 + 1 in {a["days"] * 2, a["days"] * 2 - 1}   # the step into the close is Rannacher
    v, _ = fd.solve(m=m, per_day=2, width=w, **a)
    assert abs(v - ql_value) <= 1e-3 + spread   # a tenth of the price tolerance (0.01 at S = 100)


# Solves with no cum close inside continuous exercise are bit-identical to the bench before the fix (values from
# BASE 6b21304, as float.hex): no dividend, a Bermudan schedule, a European solve.
UNCHANGED = [
    (dict(is_call=False, spot=100.0, strike=105.0, days=90, rho=0.05, q=0.0, sigma=0.3, divs=(), m=400, per_day=4,
          width=1.2), "0x1.0864012bac451p+3"),
    (dict(is_call=True, spot=100.0, strike=95.0, days=60, rho=0.03, q=0.0, sigma=0.3, divs=((20, 2.0),), m=400,
          per_day=4, width=1.2, exercise_days=(10, 20, 40)), "0x1.ba1e5f713ff31p+2"),
    (dict(is_call=False, spot=100.0, strike=100.0, days=60, rho=0.03, q=0.01, sigma=0.3, divs=((20, 2.0),), m=400,
          per_day=4, width=1.2, american=False), "0x1.6a7e7880344d9p+2"),
    (dict(is_call=True, spot=100.0, strike=90.0, days=45, rho=0.02, q=0.06, sigma=0.4, divs=(), m=400, per_day=4,
          width=1.2), "0x1.6e0df1b96d4b9p+3"),
]


@pytest.mark.parametrize("args, want", UNCHANGED)
def test_solves_without_a_continuous_cum_close_are_unchanged(args, want):
    assert fd.solve(**args)[0].hex() == want


def test_pv_after_drops_the_dividend_at_its_own_close_only():
    divs = ((3, 1.0), (5, 2.0))
    assert fd.pv_after(divs, 0.0, 3.0) == 2.0
    assert fd.pv_owed(divs, 0.0, 3.0) == 3.0
    assert fd.pv_after(divs, 0.0, 2.5) == fd.pv_owed(divs, 0.0, 2.5) == 3.0
    assert fd.pv_after(divs, 0.0, 5.0) == 0.0


def test_the_frozen_quantlib_values_reproduce():
    ql = pytest.importorskip("QuantLib")
    d0 = ql.Date(2, 1, 2030)
    ql.Settings.instance().evaluationDate = d0
    dc = ql.Actual365Fixed()

    def process(spot, rho, q, sigma):
        return ql.BlackScholesMertonProcess(
            ql.QuoteHandle(ql.SimpleQuote(spot)),
            ql.YieldTermStructureHandle(ql.FlatForward(d0, q, dc, ql.Continuous)),
            ql.YieldTermStructureHandle(ql.FlatForward(d0, rho, dc, ql.Continuous)),
            ql.BlackVolTermStructureHandle(ql.BlackConstantVol(d0, ql.NullCalendar(), sigma, dc)))

    def american(a, engine, spot=None, divs=None):
        o = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if a["is_call"] else ql.Option.Put, a["strike"]),
                             ql.AmericanExercise(d0, d0 + a["days"]))
        p = process(a["spot"] if spot is None else spot, a["rho"], a["q"], a["sigma"])
        o.setPricingEngine(engine(p) if divs is None else engine(p, divs))
        return o.NPV()

    qdfp = lambda p: ql.QdFpAmericanEngine(p, ql.QdFpAmericanEngine.highPrecisionScheme())
    assert math.isclose(american(T1_1351, qdfp, spot=100.0 - 1.5518), 14.332860339, abs_tol=1e-8)
    assert math.isclose(american(PUT_0, qdfp, spot=98.0), PUT_0_EXACT, abs_tol=1e-8)
    for a, want, spread in QL.values():
        sched = ql.DividendVector([d0 + d for d, _ in a["divs"]], [x for _, x in a["divs"]])
        got = []
        for k in (1, 2, 4):
            t, x = a["days"] * k * 20, 1000 * k
            eng = lambda p, s, t=t, x=x: ql.FdBlackScholesVanillaEngine(
                p, s, t, x, max(2, t // 50), ql.FdmSchemeDesc.CrankNicolson(), False, -ql.nullDouble(),
                ql.FdBlackScholesVanillaEngine.Escrowed)
            got.append(american(a, eng, divs=sched))
        assert math.isclose(got[2] + (got[2] - got[1]) / 3, want, abs_tol=1e-9)
        assert math.isclose(abs(got[2] - got[1]), spread, abs_tol=1e-9)
