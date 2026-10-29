"""scripts/options_bench/crosscheck.py — third-method checks and positive controls for the reference.

- QuantLib (test-only; never a dependency of the API): QdFp high-precision American engine without dividends,
  and its escrowed-dividend finite-difference engine when q = 0 (its escrowed engine uses another convention
  when q ≠ 0, so those cases are skipped). QdFp refuses some negative-rate puts; those are skipped too.
- Closed forms: Black-76 on the escrowed forward, the European value the bench's FD must reproduce with
  exercise switched off, and the American value of an exempt case (no early exercise, by theorem).
"""

from __future__ import annotations

import math

from .cases import Case

try:  # optional: the bench runs without it and records that it did
    import QuantLib as ql
except ImportError:  # pragma: no cover - depends on the environment
    ql = None


def quantlib_version() -> str | None:
    return None if ql is None else ql.__version__


def black76_case(c: Case) -> tuple[float, float]:
    """(European value, delta in S with the owed dividends' PV fixed) under the escrowed model."""
    tau = c.days / 365.0
    x0 = c.spot - c.pv()
    fwd = x0 * math.exp((c.rho - c.q) * tau)
    df = math.exp(-c.rho * tau)
    vol = c.sigma * math.sqrt(tau)
    d1 = (math.log(fwd / c.strike) + 0.5 * vol * vol) / vol
    d2 = d1 - vol
    n = lambda z: 0.5 * math.erfc(-z / math.sqrt(2.0))
    carry = math.exp(-c.q * tau)
    if c.is_call:
        return df * (fwd * n(d1) - c.strike * n(d2)), carry * n(d1)
    return df * (c.strike * n(-d2) - fwd * n(-d1)), carry * (n(d1) - 1.0)


def quantlib(c: Case) -> dict | None:
    if ql is None:
        return None
    if c.divs and c.q != 0.0:
        return None
    today = ql.Date(26, 10, 2026)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()

    def flat(r):
        return ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc, ql.Continuous))

    proc = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(c.spot)), flat(c.q), flat(c.rho),
                                        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))
    opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if c.is_call else ql.Option.Put, c.strike),
                           ql.AmericanExercise(today, today + c.days))
    try:
        if not c.divs:
            opt.setPricingEngine(ql.QdFpAmericanEngine(proc, ql.QdFpAmericanEngine.highPrecisionScheme()))
            return {"method": "qdfp-high-precision", "value": opt.NPV()}
        dd = ql.DividendVector([today + d for d, _ in c.divs], [a for _, a in c.divs])
        opt.setPricingEngine(ql.FdBlackScholesVanillaEngine(proc, dd, max(1000, 8 * c.days), 2000, 0,
                                                             ql.FdmSchemeDesc.CrankNicolson(), False, -1.0,
                                                             ql.FdBlackScholesVanillaEngine.Escrowed))
        return {"method": "fd-escrowed", "value": opt.NPV()}
    except RuntimeError as e:
        return {"method": "refused", "value": None, "why": str(e)[:200]}
