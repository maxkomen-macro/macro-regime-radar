"""scripts/options_bench/crosscheck.py — third-method checks and positive controls for the reference.

- QuantLib (test-only; never a dependency of the API): QdFp high-precision American engine without dividends.
  A single dividend paid today (day 0), any q: exact by decomposition, max(exercise today with the dividend,
  QdFp American value of S - D with no dividends). Other dividend cases only when q = 0: its escrowed-dividend
  finite-difference engine (Crank-Nicolson) on three grids (k·T, k·X), k = 1, 2, 4, Richardson-extrapolated, with
  the last two grids' difference as its stated spread. QuantLib 1.44's escrowed engine discounts the escrowed
  dividends at r - q where the Finder's model uses r, so the two agree only when q = 0 and q ≠ 0 dividend cases
  are skipped. QdFp refuses some negative-rate puts; those are recorded as refused.
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


QL_GRIDS = (1, 2, 4)   # escrowed FD grid multipliers on (time steps, space points) = (max(500, 4·days), 500)


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
    if c.divs and c.q != 0.0 and not (len(c.divs) == 1 and c.divs[0][0] == 0):
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

    def qdfp(spot: float) -> float:
        p = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(spot)), flat(c.q), flat(c.rho),
                                         ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))
        opt.setPricingEngine(ql.QdFpAmericanEngine(p, ql.QdFpAmericanEngine.highPrecisionScheme()))
        return opt.NPV()

    try:
        if not c.divs:
            return {"method": "qdfp-high-precision", "value": qdfp(c.spot)}
        if len(c.divs) == 1 and c.divs[0][0] == 0:
            # paid at today's close: exercise today keeps the dividend, holding takes S - D with no dividends left
            hold = qdfp(c.spot - c.divs[0][1])
            ex = max((1.0 if c.is_call else -1.0) * (c.spot - c.strike), 0.0)
            return {"method": "qdfp-day0", "value": max(ex, hold), "hold": hold, "exercise": ex}
        dd = ql.DividendVector([today + d for d, _ in c.divs], [a for _, a in c.divs])
        got = []
        for k in QL_GRIDS:
            t, x = k * max(500, 4 * c.days), k * 500
            opt.setPricingEngine(ql.FdBlackScholesVanillaEngine(proc, dd, t, x, max(2, t // 50),
                                                                 ql.FdmSchemeDesc.CrankNicolson(), False, -1.0,
                                                                 ql.FdBlackScholesVanillaEngine.Escrowed))
            got.append(opt.NPV())
        return {"method": "fd-escrowed-3grid", "value": got[-1] + (got[-1] - got[-2]) / 3.0,
                "spread": abs(got[-1] - got[-2]), "grids": got}
    except RuntimeError as e:
        return {"method": "refused", "value": None, "why": str(e)[:200]}
