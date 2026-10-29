"""The Options Finder's numerical library (src/desk/options_math.py, method finder-2).

Every input here is synthetic. Reference values come from tests/fixtures/options_reference_golden.json,
written by scripts/options_reference_golden.py: the same lattice at N >= 8,000 steps (log-space nodes) and
QuantLib where its conventions equal the model's. QuantLib itself is needed only by the last test, which
recomputes the fixture's QuantLib values and is skipped (and reported as skipped) without it."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from src.desk import options_math as om

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "options_reference_golden.json").read_text())


def _ctx(d: dict) -> om.Context:
    return om.Context(d["is_call"], d["spot"], d["strike"], d["days"], d["rho"], d["q"], d["sigma"],
                      tuple((int(a), float(b)) for a, b in d["divs"]))


# ── European ─────────────────────────────────────────────────────────────────

def test_black76_reproduces_hulls_example_to_the_cent():
    # Hull, Options, Futures and Other Derivatives: S 42, K 40, r 10%, sigma 20%, six months.
    c = om.Context(True, 42.0, 40.0, 0, 0.10, 0.0, 0.20)
    tau = 0.5
    fwd = 42.0 * math.exp(0.10 * tau)
    call = om.black76_scalar(True, fwd, 40.0, tau, 0.20, math.exp(-0.10 * tau))
    put = om.black76_scalar(False, fwd, 40.0, tau, 0.20, math.exp(-0.10 * tau))
    assert round(call, 2) == 4.76 and round(put, 2) == 0.81
    assert c.days == 0 and om.european(c) == 2.0  # zero days: intrinsic


@pytest.mark.parametrize("case", GOLDEN["european"], ids=lambda c: f"{c['context']['strike']:.1f}")
def test_european_value_and_delta_match_quantlib(case):
    if case["quantlib"] is None:
        pytest.skip("fixture written without QuantLib")
    c = _ctx(case["context"])
    assert om.european(c) == pytest.approx(case["quantlib"]["value"], rel=1e-10, abs=1e-12)
    assert om.european_delta(c) == pytest.approx(case["quantlib"]["delta"], abs=1e-8)


def test_put_call_parity_and_the_scalar_formula_match_the_array_one():
    rng = np.random.default_rng(1)
    for _ in range(500):
        f, k, tau, sg, r = rng.uniform(1, 300), rng.uniform(1, 300), rng.uniform(1e-3, 4), rng.uniform(1e-3, 5), rng.uniform(-0.3, 0.5)
        df = math.exp(-r * tau)
        c, p = om.black76_scalar(True, f, k, tau, sg, df), om.black76_scalar(False, f, k, tau, sg, df)
        assert c - p == pytest.approx(df * (f - k), abs=1e-12 * max(f, k))
        assert c == pytest.approx(float(om.black76(True, f, k, tau, sg, df)), rel=1e-11, abs=1e-12)


# ── the lattice against its references ──────────────────────────────────────

@pytest.mark.parametrize("case", GOLDEN["american"], ids=lambda c: f"n{c['context']['days']}")
def test_lattice_is_within_the_stated_tolerance_of_the_reference(case):
    c = _ctx(case["context"])
    value = float(om.american([c])[0][0])
    assert abs(value - case["reference"]) <= om.tolerance(case["reference"], c.spot)


@pytest.mark.parametrize("case", [c for c in GOLDEN["american"] if c["quantlib"] is not None], ids=lambda c: f"n{c['context']['days']}")
def test_reference_agrees_with_quantlib_within_the_tolerance(case):
    c = _ctx(case["context"])
    assert abs(case["reference"] - case["quantlib"]) <= om.tolerance(case["quantlib"], c.spot)


def test_batched_lattice_equals_one_context_at_a_time():
    cs = [_ctx(case["context"]) for case in GOLDEN["american"][:12]]
    together = om.american(cs)[0]
    alone = [float(om.american([c])[0][0]) for c in cs]
    assert np.allclose(together, alone, rtol=1e-12, atol=1e-12)


def test_exempt_contexts_never_gain_from_early_exercise():
    for case in GOLDEN["american"]:
        c = _ctx(case["context"])
        if om.exempt(c):
            assert abs(case["reference"] - om.european(c)) <= om.tolerance(case["reference"], c.spot)


def test_the_early_exercise_bound_is_above_the_premium():
    for case in GOLDEN["american"]:
        c = _ctx(case["context"])
        premium = case["reference"] - om.european(c)
        assert om.premium_bound(c) >= premium - om.tolerance(case["reference"], c.spot)


def test_the_call_exemption_holds_at_its_dividend_condition_and_fails_a_cent_past_it():
    k, days, rho = 100.0, 365, 0.05
    room = k * -math.expm1(-rho * (days - 100) / om.YEAR_DAYS)
    at = om.Context(True, 100.0, k, days, rho, 0.0, 0.3, ((100, room * (1 - 1e-9)),))
    past = om.Context(True, 100.0, k, days, rho, 0.0, 0.3, ((100, room + 0.01),))
    assert om.exempt(at) and not om.exempt(past)


# ── the curve ────────────────────────────────────────────────────────────────

def test_rate_conversions_and_interpolation_by_hand():
    assert om.zero_rate_3m(4.0) == pytest.approx(math.log(1.01) / 0.25, abs=1e-15)
    assert om.zero_rate_par(4.0) == pytest.approx(2 * math.log(1.02), abs=1e-15)
    cv = om.Curve(0.04, 0.03, 0.05)
    assert cv.rate(0.1) == 0.04 and cv.rate(7.0) == 0.05
    assert cv.rate(1.125) == pytest.approx(0.035, abs=1e-15)
    assert cv.forward(0.5, 1.5) == pytest.approx((cv.rate(1.5) * 1.5 - cv.rate(0.5) * 0.5), abs=1e-15)


def test_largest_discount_factor_under_negative_rates():
    assert om.Curve(-0.05, -0.05, -0.05).df_max(3.0) == pytest.approx(math.exp(0.15), rel=1e-14)
    assert om.Curve(0.03, 0.04, 0.05).df_max(4.0) == 1.0
    dip = om.Curve(0.02, -0.04, 0.03)  # r(t)·t has an interior minimum on the second segment
    grid = np.linspace(0, 5, 200_001)
    assert dip.df_max(5.0) == pytest.approx(max(dip.df(t) for t in grid), rel=1e-9)


# ── implied volatility and the forward ───────────────────────────────────────

def test_implied_volatility_round_trips():
    rng = np.random.default_rng(3)
    for _ in range(60):
        days = int(rng.integers(2, 700))
        c = om.Context(bool(rng.random() < 0.5), 100.0, float(rng.uniform(60, 160)), days,
                       float(rng.uniform(-0.03, 0.12)), float(rng.uniform(-0.05, 0.08)), float(rng.uniform(0.08, 2.0)),
                       tuple(sorted({(int(d), 0.7) for d in rng.integers(0, min(60, days), 2)})))
        assert om.in_domain(c) is None
        price = float(om.american([c])[0][0])
        if price - max(0.0, (100 - c.strike) if c.is_call else (c.strike - 100)) < 1e-3:
            continue
        sigma, used = om.iv_american(c, price, lambda x: float(om.american([x])[0][0]))
        assert sigma is not None and used <= 40
        assert abs(float(om.american([c.with_sigma(sigma)])[0][0]) - price) <= 1e-3 * om.tolerance(price, 100.0)
        e = om.european(c)
        assert om.iv_european(c.with_sigma(0.3), e) == pytest.approx(c.sigma, abs=1e-9)


def test_drive_runs_solvers_in_lockstep_with_the_same_answers():
    cs = [om.Context(False, 100.0, k, 120, 0.05, 0.0, 0.3, ((30, 0.8),)) for k in (90.0, 100.0, 110.0)]
    prices = [float(v) for v in om.american(cs)[0]]
    one = lambda x: float(om.american([x])[0][0])
    alone = [om.iv_american(c, p, one) for c, p in zip(cs, prices)]
    together = om.drive({i: om.iv_american_gen(c, p) for i, (c, p) in enumerate(zip(cs, prices))},
                        lambda xs: [float(v) for v in om.american(xs)[0]])
    assert [together[i] for i in range(3)] == alone


def test_value_is_non_decreasing_in_volatility_and_monotone_in_strike():
    for is_call in (True, False):
        sig = [om.Context(is_call, 100.0, 100.0, 200, 0.05, 0.01, s, ((50, 1.0),)) for s in np.linspace(0.05, 2.0, 12)]
        v = om.american(sig)[0]
        assert np.all(np.diff(v) >= -1e-9)
        ks = [om.Context(is_call, 100.0, k, 200, 0.05, 0.01, 0.4, ((50, 1.0),)) for k in np.linspace(50, 150, 12)]
        w = om.american(ks)[0]
        assert np.all(np.diff(w) <= 1e-9) if is_call else np.all(np.diff(w) >= -1e-9)


def test_domain_edges():
    base = om.Context(True, 100.0, 100.0, 30, 0.05, 0.0, 0.3)
    assert om.in_domain(base) is None
    assert om.in_domain(base.with_sigma(5.01)) and om.in_domain(base.with_sigma(0.0009))
    assert om.in_domain(om.Context(True, 100.0, 4.9, 30, 0.05, 0.0, 0.3)) and om.in_domain(om.Context(True, 100.0, 2001.0, 30, 0.05, 0.0, 0.3))
    assert om.in_domain(om.Context(True, 100.0, 100.0, 30, 0.05, 0.0, 0.3, ((3, 3.0),))) is None
    assert "3%" in om.in_domain(om.Context(True, 100.0, 100.0, 30, 0.05, 0.0, 0.3, ((3, 3.0001),)))
    for q in (0.10, -0.10):
        assert om.in_domain(om.Context(False, 100.0, 100.0, 30, 0.05, q, 0.3)) is None
    for q in (0.1001, -0.1001):
        assert om.in_domain(om.Context(False, 100.0, 100.0, 30, 0.05, q, 0.3)) == om.Q_DOMAIN_REASON


def test_codex_dr47_shared_bias_case_is_outside_the_domain():
    # Codex DR-47: a 28% dividend on day 3. Resolutions 180 and 360 agree within the acceptance test, yet both are
    # about $0.021 above the lattice at 23,040/46,080 steps ($8.95775), twice the $0.010 tolerance. Not served.
    c = om.Context(True, 100.0, 92.33030328002155, 90, 0.0973510107851791, 0.0, 0.922860889836401,
                   ((3, 28.249649080935125),))
    assert "3%" in om.in_domain(c)


def test_quantlib_values_recomputed_live():
    pytest.importorskip("QuantLib")
    import importlib.util
    spec = importlib.util.spec_from_file_location("golden", Path(__file__).parents[1] / "scripts" / "options_reference_golden.py")
    golden = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(golden)
    checked = 0
    for case in GOLDEN["american"]:
        if case["quantlib"] is None:
            continue
        assert golden.quantlib_value(_ctx(case["context"])) == pytest.approx(case["quantlib"], rel=1e-9, abs=1e-9)
        checked += 1
        if checked == 6:
            break
    assert checked > 0


def test_the_bound_is_certified_where_quadrature_failed():
    # Codex DR-45: a dividend-free put with a tiny volatility; immediate exercise is worth $6 and the
    # European value is nil, so the premium is at least $6. A 64-point quadrature gave $5.86.
    c = om.Context(False, 94.0, 100.0, 365, 0.20, 0.0, 0.001)
    assert om.european(c) < 1e-12
    assert om.premium_bound(c) >= 6.0


def test_the_bound_stays_above_the_premium_on_random_contexts_at_every_volatility():
    rng = np.random.default_rng(45)
    checked = 0
    while checked < 60:
        days = int(rng.integers(2, 400))
        divs = tuple(sorted({(int(d), float(rng.uniform(0.1, 2.0))) for d in rng.integers(0, days, int(rng.integers(0, 4)))}))
        c = om.Context(bool(rng.random() < 0.5), 100.0, float(100 * math.exp(rng.uniform(-0.5, 0.5))), days,
                       float(rng.uniform(-0.1, 0.3)), float(rng.uniform(-0.15, 0.15)), float(10 ** rng.uniform(-3, 0.3)), divs)
        if om.in_domain(c) or om.exempt(c) or c.spot - c.pv() <= 0:
            continue
        checked += 1
        premium = float(om.american([c])[0][0]) - om.european(c)
        assert om.premium_bound(c) >= premium - om.tolerance(premium + om.european(c), c.spot)


def test_deciding_early_gives_the_same_answer_as_refining_fully():
    rng = np.random.default_rng(7)
    for _ in range(200):
        c = om.Context(bool(rng.random() < 0.5), 100.0, float(rng.uniform(70, 140)), int(rng.integers(2, 400)),
                       float(rng.uniform(-0.05, 0.2)), float(rng.uniform(-0.1, 0.1)), float(10 ** rng.uniform(-2.5, 0.3)))
        threshold = om.tolerance(om.european(c), c.spot) / 5
        assert (om.premium_bound(c, None, threshold) <= threshold) == (om.premium_bound(c) <= threshold)


# ── rev 8: the root's exercise decision and adaptive refinement ─────────────

def test_delta_is_one_when_exercise_at_the_session_close_is_optimal():
    # Codex DR-46: a dividend at the session close larger than the call's time value; exercising now is optimal.
    c = om.Context(True, 100.0, 90.0, 30, 0.0, 0.0, 0.2, ((0, 3.0),))
    values, deltas, ok = om.american([c])
    assert ok[0] and values[0] == pytest.approx(10.0, abs=1e-9)
    assert deltas[0] == 1.0


def test_a_deep_put_exercised_now_has_delta_minus_one():
    c = om.Context(False, 100.0, 160.0, 200, 0.12, 0.0, 0.15)
    values, deltas, ok = om.american([c])
    assert ok[0] and values[0] == pytest.approx(60.0, abs=1e-9) and deltas[0] == -1.0


@pytest.mark.parametrize("case", GOLDEN["early_dividend"], ids=lambda c: f"d{c['context']['divs'][0][0]}")
def test_early_dividends_converge_to_quantlib_within_tolerance(case):
    if case["quantlib"] is None:
        pytest.skip("fixture written without QuantLib")
    c = _ctx(case["context"])
    values, deltas, ok = om.american([c])
    assert ok[0]
    assert abs(values[0] - case["quantlib"]["value"]) <= om.tolerance(case["quantlib"]["value"], c.spot)
    assert abs(deltas[0] - case["quantlib"]["delta"]) <= om.DELTA_TOL


def test_an_early_dividend_is_refined_and_charged():
    c = om.Context(True, 100.0, 128.90, 187, 0.074, 0.0, 0.804, ((3, 1.70), (94, 1.70), (185, 1.70)))
    charges = []
    values, _, ok = om.american([c], charges.append)
    n = om.steps_for(c.days)
    assert ok[0] and len(charges) >= 3 and charges[:3] == [n * n // 2, (2 * n) ** 2 // 2, (4 * n) ** 2 // 2]
    assert abs(values[0] - 13.10291) <= om.tolerance(13.10291, 100.0)  # QuantLib FD, grids 4,000 and 8,000


def test_a_context_that_does_not_converge_is_flagged():
    c = om.Context(True, 100.0, 74.20394455159428, 133, 0.019515952159698625, 0.0, 0.40750766570650654, ((1, 2.06),))
    assert om.in_domain(c) is None
    saved = om.REFINE_LEVELS
    om.REFINE_LEVELS = 0
    try:
        _, _, ok = om.american([c])
    finally:
        om.REFINE_LEVELS = saved
    assert not ok[0]


def test_b8_delta_test_refuses_a_pair_whose_extrapolated_delta_is_off():
    # Rev 8 accepted (341, 682): deltas 2.16e-3 apart, extrapolated 0.90591. QuantLib FD (8,000 x 20,000) and our
    # lattice at 10,912 steps give 0.90908; the delta test at half the stated accuracy refines to (682, 1,364).
    c = om.Context(True, 100.0, 87.03281448090632, 341, 0.02436936153335026, 0.0, 0.12057305288130349, ((2, 2.5),))
    values, deltas, ok = om.american([c])
    assert ok[0] and abs(deltas[0] - 0.909080) <= om.DELTA_TOL
    assert abs(values[0] - 13.068403) <= om.tolerance(13.068403, 100.0)


def test_codex_dr48_split_payments_are_summed_against_the_limit():
    # Codex DR-48: DR-47's $28.25 dividend split into ten payments on day 3, each under $3. Same economics, same
    # $0.021 error; refused because the domain limit applies to the sum within any 10 days.
    base = (True, 100.0, 92.33030328002155, 90, 0.0973510107851791, 0.0, 0.922860889836401)
    split = tuple((3, 28.249649080935125 / 10 + (i - 4.5) * 0.001) for i in range(10))
    assert "3%" in om.in_domain(om.Context(*base, split))
    assert om.in_domain(om.Context(*base, ((3, 1.6), (12, 1.6))))          # 9 days apart: one cluster, 3.2%
    assert om.in_domain(om.Context(*base, ((3, 1.6), (13, 1.6)))) is None  # 10 days apart: two clusters
    assert om.div_cluster(((0, 1.0), (5, 1.0), (9, 0.5), (10, 2.0))) == pytest.approx(3.5)


@pytest.mark.parametrize("strike, reference", [(109.39, 9.4313), (109.78, 9.8088)], ids=["dr49", "dr50"])
def test_codex_dr49_dr50_shared_false_exercise_decisions_are_refused(strike, reference):
    # Codex DR-49 (K 109.39): 180 and 360 steps both exercise at the root. Codex DR-50 (K 109.78): 180, 360 and
    # 720 all do ($9.78, delta -1), while finer lattices converge near $9.8088 (delta -0.9775). Rev 12 refuses
    # both twice over: q = -0.82 is outside the validated residual yields, and the pricer's test on the root
    # continuation value (before the max with the exercise value) never agrees within the budget, so neither
    # is converged: N, 2N, 4N and 8N are charged and nothing is served.
    c = om.Context(False, 100.0, strike, 90, 0.11, -0.82, 0.32, ((4, 1.01),))
    assert om.in_domain(c) == om.Q_DOMAIN_REASON and not om.exempt(c)
    charges = []
    values, _, ok = om.american([c], charges.append)
    n = om.steps_for(c.days)
    assert not ok[0] and charges == [(m * n) ** 2 // 2 for m in (1, 2, 4, 8)]
    assert abs(values[0] - reference) < 0.01   # the last pair's number, kept for diagnosis only


def test_near_the_exercise_boundary_the_value_is_served_and_the_delta_is_not():
    # Builder finding B9 (rev 11): this put's value is $0.0004 above its exercise value; rev 11 served delta -1
    # where finer lattices give -0.99733. Rev 12 decides exercise after extrapolating the continuation value and
    # serves no delta within DELTA_ZONE tolerances of the exercise value (where the scans found delta errors).
    c = om.Context(False, 100.0, 113.0, 60, 0.05, 0.0, 0.2)
    values, deltas, ok = om.american([c])
    tol = om.tolerance(13.0, 100.0)
    assert ok[0] and 13.0 <= values[0] <= 13.0 + tol and np.isnan(deltas[0])
    # further from the boundary the delta is served
    c = om.Context(False, 100.0, 105.0, 60, 0.05, -0.05, 0.2)
    values, deltas, ok = om.american([c])
    assert ok[0] and values[0] - 5.0 > om.DELTA_ZONE * om.tolerance(values[0], 100.0) and -1.0 < deltas[0] < -0.5
