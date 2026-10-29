"""Write tests/fixtures/options_reference_golden.json: reference values for the Options Finder's pricer.

Synthetic inputs only (a seeded random grid over the pricer's validated domain; no market data). For each
context it stores:
- `reference`: the same day-aligned lattice as src/desk/options_math.py at N >= 8,000 steps with at least 2
  steps a day, Richardson over N and 2N, with node prices recomputed in log space (a slower variant that
  cannot overflow at these step counts);
- `quantlib`: QuantLib's value where its conventions equal the model's (no dividends: QdFpAmericanEngine,
  high precision; dividends with q = 0: the escrowed finite-difference engine on a 4,000 x max(2,000, 4n)
  grid), else null;
- European cases with QuantLib's analytic value and Greeks.

QuantLib is a test-time dependency only (never imported by src/ or api/). Run: python scripts/options_reference_golden.py
(about five minutes). tests/test_desk_options_math.py reads the fixture; a second test recomputes the
QuantLib values live when QuantLib is installed.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.desk import options_math as om  # noqa: E402

SEED = 20261026
CASES = 48
EUROPEAN_CASES = 24
EARLY_CASES = 24  # a dividend in the first days, q = 0: QuantLib's escrowed FD value and delta (rev 8, B7)
REF_N, REF_K = 8000, 2
OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "options_reference_golden.json"


def _b76(sgn: float, fwd, k, tau: float, sig: float, df: float):
    fwd = np.asarray(fwd, dtype=float)
    if k <= 0:
        return df * np.maximum(sgn * (fwd - k), 0.0)
    v = sig * math.sqrt(tau)
    with np.errstate(divide="ignore"):
        d1 = (np.log(fwd / k) + 0.5 * v * v) / v
    d2 = d1 - v
    from scipy.special import ndtr
    if sgn > 0:
        return df * (fwd * ndtr(d1) - k * ndtr(d2))
    return df * (k * ndtr(-d2) - fwd * ndtr(-d1))


def lattice_log(is_call: bool, s: float, k: float, days: int, r: float, q: float, sig: float, divs, n: int) -> float:
    """The pricer's lattice (section 4 of the model document) with node prices recomputed in log space at
    every level and capped at e^700 (those nodes are beyond 35 standard deviations)."""
    t = days / om.YEAR_DAYS
    dt = t / n
    per = n // days
    sgn = 1.0 if is_call else -1.0
    steps = np.arange(n + 1)
    esc = np.zeros(n + 1)
    for d, a in divs:
        jx = d * per
        esc[: jx + 1] += a * np.exp(-r * (jx - steps[: jx + 1]) * dt)
    x0 = math.log(s - esc[0])
    nu = (r - q - 0.5 * sig * sig) * dt
    w = sig * math.sqrt(dt)
    lu, ld = nu + w, nu - w
    g = math.exp((r - q) * dt)
    p = (g - math.exp(ld)) / (math.exp(lu) - math.exp(ld))
    disc = math.exp(-r * dt)
    last = n - 1
    j = np.arange(last + 1)
    st = np.exp(np.minimum(x0 + j * lu + (last - j) * ld, 700.0))
    v = _b76(sgn, st * g, k - esc[n], dt, sig, disc)
    v = np.maximum(v, sgn * (st + esc[last] - k))
    for i in range(last - 1, -1, -1):
        v = disc * (p * v[1 : i + 2] + (1 - p) * v[0 : i + 1])
        j = np.arange(i + 1)
        st = np.exp(np.minimum(x0 + j * lu + (i - j) * ld, 700.0))
        np.maximum(v, sgn * (st + esc[i] - k), out=v)
    return float(v[0])


def reference(c: om.Context) -> float:
    n = max(REF_K, math.ceil(REF_N / c.days)) * c.days
    args = (c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, c.divs)
    return 2.0 * lattice_log(*args, 2 * n) - lattice_log(*args, n)


def sample(rng: np.random.Generator) -> om.Context:
    """One context inside om.in_domain, spread over the domain's corners."""
    while True:
        is_call = bool(rng.random() < 0.5)
        days = int(rng.choice([1, 2, 7, 30, 91, 182, 365, 730, 1098, 1464])) if rng.random() < 0.5 else int(rng.integers(1, om.DAYS_MAX + 1))
        sigma = float(math.exp(rng.uniform(math.log(om.SIGMA_LO), math.log(om.SIGMA_HI)))) if rng.random() < 0.3 else float(rng.uniform(0.05, 1.5))
        rho = float(rng.uniform(-0.1, 0.25)) if rng.random() < 0.8 else float(rng.uniform(-om.RHO_MAX, om.RHO_MAX))
        q = float(rng.uniform(-0.1, 0.1)) if rng.random() < 0.8 else float(rng.uniform(-om.Q_MAX, om.Q_MAX))
        strike = float(100.0 * math.exp(rng.uniform(math.log(0.4), math.log(2.5)))) if rng.random() < 0.85 else float(
            100.0 * math.exp(rng.uniform(math.log(om.KS_LO), math.log(om.KS_HI))))
        divs: list[tuple[int, float]] = []
        if days > 1 and rng.random() < 0.6:
            for d in sorted({int(x) for x in rng.integers(0, days, int(rng.integers(1, 9)))}):
                divs.append((d, float(rng.uniform(0.05, 3.0))))
        c = om.Context(is_call, 100.0, strike, days, rho, q, sigma, tuple(divs))
        if om.in_domain(c) is None and c.spot - c.pv() > 0:
            return c


def quantlib_value(c: om.Context) -> float | None:
    try:
        import QuantLib as ql
    except ImportError:
        return None
    if c.divs and c.q != 0.0:
        return None
    today = ql.Date(23, 10, 2026)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()
    flat = lambda r: ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc, ql.Continuous))
    proc = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(c.spot)), flat(c.q), flat(c.rho),
                                        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))
    payoff = ql.PlainVanillaPayoff(ql.Option.Call if c.is_call else ql.Option.Put, c.strike)
    opt = ql.VanillaOption(payoff, ql.AmericanExercise(today, today + c.days))
    fd = lambda dd: ql.FdBlackScholesVanillaEngine(proc, dd, max(2000, 4 * c.days), 4000, 0, ql.FdmSchemeDesc.CrankNicolson(),
                                                   False, -1.0, ql.FdBlackScholesVanillaEngine.Escrowed)
    if c.divs:
        opt.setPricingEngine(fd(ql.DividendVector([today + d for d, _ in c.divs], [a for _, a in c.divs])))
        return float(opt.NPV())
    opt.setPricingEngine(ql.QdFpAmericanEngine(proc, ql.QdFpAmericanEngine.highPrecisionScheme()))
    try:
        return float(opt.NPV())
    except RuntimeError:  # QdFp has no double-boundary scheme (a put with q < r < 0): the FD engine instead
        opt.setPricingEngine(fd(ql.DividendVector([], [])))
        return float(opt.NPV())


def european_case(rng: np.random.Generator) -> dict:
    c = om.Context(bool(rng.random() < 0.5), float(rng.uniform(20, 300)), float(rng.uniform(15, 400)),
                   int(rng.integers(1, 1465)), float(rng.uniform(-0.05, 0.2)), float(rng.uniform(-0.1, 0.1)),
                   float(rng.uniform(0.02, 3.0)), ())
    out = {"context": _ctx_json(c), "quantlib": None}
    try:
        import QuantLib as ql
    except ImportError:
        return out
    today = ql.Date(23, 10, 2026)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()
    flat = lambda r: ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc, ql.Continuous))
    proc = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(c.spot)), flat(c.q), flat(c.rho),
                                        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))
    opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if c.is_call else ql.Option.Put, c.strike),
                           ql.EuropeanExercise(today + c.days))
    opt.setPricingEngine(ql.AnalyticEuropeanEngine(proc))
    out["quantlib"] = {"value": opt.NPV(), "delta": opt.delta()}
    return out



def quantlib_fd(c: om.Context) -> dict | None:
    """QuantLib's escrowed finite-difference value and delta (q = 0 only, where its convention is the model's)."""
    try:
        import QuantLib as ql
    except ImportError:
        return None
    today = ql.Date(23, 10, 2026)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()
    flat = lambda r: ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc, ql.Continuous))
    proc = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(c.spot)), flat(c.q), flat(c.rho),
                                        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))
    opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if c.is_call else ql.Option.Put, c.strike),
                           ql.AmericanExercise(today, today + c.days))
    dd = ql.DividendVector([today + d for d, _ in c.divs], [a for _, a in c.divs])
    opt.setPricingEngine(ql.FdBlackScholesVanillaEngine(proc, dd, max(1600, 16 * c.days), 4000, 0,
                                                        ql.FdmSchemeDesc.CrankNicolson(), False, -1.0,
                                                        ql.FdBlackScholesVanillaEngine.Escrowed))
    return {"value": float(opt.NPV()), "delta": float(opt.delta())}


def early_case(rng: np.random.Generator) -> dict:
    while True:
        days = int(rng.integers(5, 300))
        first = int(rng.integers(0, 8))
        f = float(rng.choice([0.005, 0.01, 0.017, 0.025]))
        divs = tuple((d, 100.0 * f) for d in range(first, days, 91))[: int(rng.integers(1, 4))]
        c = om.Context(bool(rng.random() < 0.7), 100.0, float(100 * math.exp(rng.uniform(-0.3, 0.3))), days,
                       float(rng.uniform(0.0, 0.08)), 0.0, float(rng.uniform(0.15, 0.9)), divs)
        if om.in_domain(c) is None and not om.exempt(c):
            return {"context": _ctx_json(c), "quantlib": quantlib_fd(c)}

def _ctx_json(c: om.Context) -> dict:
    return {"is_call": c.is_call, "spot": c.spot, "strike": c.strike, "days": c.days, "rho": c.rho, "q": c.q,
            "sigma": c.sigma, "divs": [list(d) for d in c.divs]}


def main() -> None:
    rng = np.random.default_rng(SEED)
    cases = []
    for i in range(CASES):
        c = sample(rng)
        ref = reference(c)
        cases.append({"context": _ctx_json(c), "reference": ref, "quantlib": quantlib_value(c)})
        print(i, _ctx_json(c), round(ref, 6), flush=True)
    europeans = [european_case(rng) for _ in range(EUROPEAN_CASES)]
    early = [early_case(rng) for _ in range(EARLY_CASES)]
    try:
        import QuantLib as ql
        ql_version = ql.__version__
    except ImportError:
        ql_version = None
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "about": "Synthetic reference values for src/desk/options_math.py; written by scripts/options_reference_golden.py.",
        "seed": SEED, "reference_lattice": {"n_min": REF_N, "k_min": REF_K}, "quantlib_version": ql_version,
        "american": cases, "european": europeans, "early_dividend": early}, indent=1) + "\n")


if __name__ == "__main__":
    main()
