"""src/desk/options_adaptive.py — the Tier 2 convergence controller (adaptive Phase 2, unserved).

Refines the baseline's lattice (options_math._lattice, imported read-only) beyond Tier 1's levels and states a
per-contract error estimate for the value it returns. Routes, in order: input failure; intrinsic at expiry;
exempt (European, by theorem); outside the domain; the analytic interval (the midpoint of the proved interval
when it is narrow enough); the lattice. The price and the delta are accepted by separate tests.

Values are "estimated, cross-check pending" until the Phase 3 cross-check exists. Nothing under api/ imports
this module; the design is .loop/design-P2-2.md (review-loop/options-adaptive/designs/ in the project files).
Pure functions of numbers: no I/O, no clock. Each context is priced alone (a batch of one), so its numbers
never depend on which other contexts share a lattice batch.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Callable

import numpy as np

from src.desk import options_engine as oe
from src.desk import options_math as om

VERSION = "adaptive-p2.0"
ENGINE = "adaptive"

SCHEDULES = {"doubling": (1, 2, 4, 8, 16, 32), "multiples": (1, 2, 3, 4, 5, 6)}
K_MAX = 6                 # levels per context at most (a stopping bound: it only refuses more)
MIN_LEVELS = 4            # three successive extrapolations need four raw levels
FLOOR = 0.1               # price estimates are floored at 0.1·tol, the finest error the bench can check
DELTA_FLOOR = 2.5e-4      # delta estimates at 0.1·DELTA_TOL
F_GRID = (2.0, 2.5, 3.0, 4.0)
P_RANGE = (0.5, 3.0)      # the fitted order's admissible range
P_BAND = 0.5              # two fitted orders agree when they differ by at most this
ZERO_CHANGE = 1e-13       # of S: a change this small does not identify an order
DEEP = 1e-9               # a step-1 delta within this of ±1 counts as both nodes exercising (as om.american)
TAU_RANGE = (0.1, 1.0)    # the target as a fraction of tol

# Reasons.
LEVEL_CAP = "level cap"
LATTICE_CAP = "lattice cap"
WORK_CAP = "work cap"
SHORT = "the schedule cannot reach four levels within the 40 M cap"
ABOVE_TARGET = "estimate above target"
OUTSIDE_INTERVAL = "outside the proved interval"
CONTRADICTED = "estimate contradicted by the proved interval"
INCONSISTENT = "interval inconsistent"
D_DIVIDEND = f"a dividend falls within {om.DELTA_DIV_DAYS} days, where the lattice delta is not validated"
D_ZONE = f"within {om.DELTA_ZONE:g} tolerances of the exercise value"
D_DECISION = "exercise decision unresolved"
D_ABOVE = "delta estimate above 2.5e-3"
D_EXPIRY = "at expiry"
ARITHMETIC = "input failure: arithmetic outside the floating-point range"


@dataclass(frozen=True)
class Config:
    estimator: str = "envelope"      # "envelope" (leading) or "fitted"
    schedule: str = "hybrid"         # "doubling", "multiples" or "hybrid"
    F: float = 2.0
    F_d: float = 2.0
    tau: float = 1.0                 # target = tau·tol
    force_lattice: bool = False      # positive control only: skip the exempt and analytic routes, and accept
                                     # without the interval test (an exempt context's interval has width ~0)

    def __post_init__(self) -> None:
        if self.estimator not in ("envelope", "fitted"):
            raise ValueError(f"unknown estimator {self.estimator!r}")
        if self.schedule not in ("doubling", "multiples", "hybrid"):
            raise ValueError(f"unknown schedule {self.schedule!r}")
        if self.F < 2.0 or self.F_d < 2.0:
            raise ValueError("F and F_d are never below 2 in Phase 2")
        if not TAU_RANGE[0] <= self.tau <= TAU_RANGE[1]:
            raise ValueError("tau must lie in [0.1, 1]")


def units(steps: int) -> int:
    return steps * steps // 2


def multipliers(schedule: str, n0: int) -> tuple[int, ...]:
    if schedule == "hybrid":
        schedule = "doubling" if units(8 * n0) <= om.REFINE_UNITS_MAX else "multiples"
    return SCHEDULES[schedule][:K_MAX]


@dataclass(frozen=True)
class Level:
    m: int
    steps: int
    h: float        # root continuation value, per share
    delta: float    # step-1 delta
    units: int


def lattice_level(c: om.Context, m: int) -> Level:
    steps = om.steps_for(c.days) * m
    _, d, _, h = om._lattice([c.is_call], [c.strike / c.spot], np.array([c.rho]), np.array([c.q]),
                             np.array([c.sigma]), [[(dd, a / c.spot) for dd, a in c.divs]], c.days, steps,
                             with_cont=True)
    return Level(m, steps, float(h[0]) * c.spot, float(d[0]), units(steps))


def cap(i: int, ms: tuple[int, ...], n0: int, used: int) -> str | None:
    """Why level i may not run (None when it may): the level cap, the 40 M single-lattice cap, or the 300 M
    per-context cap on the units charged so far."""
    if i >= len(ms):
        return LEVEL_CAP
    u = units(ms[i] * n0)
    if u > om.REFINE_UNITS_MAX:
        return LATTICE_CAP
    if used + u > _work_limit():
        return WORK_CAP
    return None


def _work_limit() -> int:
    from src.desk import options_finder as of   # WORK_LIMIT lives with the Finder; read, never changed
    return of.WORK_LIMIT


class NonFinite(ArithmeticError):
    pass


def check(*xs) -> None:
    """Every derived number must be finite (design §1, DR-02)."""
    if not all(math.isfinite(float(x)) for x in xs):
        raise NonFinite


# ── estimators (pure) ────────────────────────────────────────────────────────

def rich(a: float, ya: float, b: float, yb: float) -> float:
    """First-order Richardson on levels a < b: BBSR's 2y(2M) − y(M) when b = 2a, written as a correction to y(b)
    so that it cannot overflow where y(a) and y(b) do not (DR-07)."""
    return yb + a * (yb - ya) / (b - a)


def rho_p(p: float, a: float, b: float, c: float) -> float:
    return (a ** -p - b ** -p) / (b ** -p - c ** -p)


def fit(a: int, b: int, c: int, ha: float, hb: float, hc: float, spot: float) -> tuple[float, float] | None:
    """(p, extrapolant) under h(m) = h* + C·m^(−p) from three levels, or None when p is not identified: a change
    at most ZERO_CHANGE·S, changes of opposite sign, or a ratio outside the admissible orders."""
    d1, d2 = hb - ha, hc - hb
    z = ZERO_CHANGE * spot
    if abs(d1) <= z or abs(d2) <= z or (d1 > 0) != (d2 > 0):
        return None
    r = d1 / d2
    lo, hi = P_RANGE
    if not rho_p(lo, a, b, c) <= r <= rho_p(hi, a, b, c):
        return None
    for _ in range(60):   # rho_p is increasing in p on P_RANGE for every triple the schedules use
        mid = 0.5 * (lo + hi)
        if rho_p(mid, a, b, c) < r:
            lo = mid
        else:
            hi = mid
        if hi - lo <= 1e-12:
            break
    p = 0.5 * (lo + hi)
    return p, hc + d2 * c ** -p / (b ** -p - c ** -p)


def envelope(ms, ys) -> tuple[float, float, list[float]]:
    """(the last extrapolation, the larger of its last two changes, all extrapolations) over levels ms."""
    b = [rich(ms[j - 1], ys[j - 1], ms[j], ys[j]) for j in range(1, len(ms))]
    return b[-1], max(abs(b[-1] - b[-2]), abs(b[-2] - b[-3])), b


def estimate(ms, hs, spot: float, estimator: str) -> tuple[float, float, str, dict]:
    """(continuation estimate, raw error estimate E, the estimator that produced it, detail) over levels ms."""
    hb, e, bs = envelope(ms, hs)
    detail: dict = {"B": bs}
    if estimator == "envelope":
        return hb, e, "envelope", detail
    f1 = fit(*ms[-4:-1], *hs[-4:-1], spot)
    f2 = fit(*ms[-3:], *hs[-3:], spot)
    detail["fits"] = [f1, f2]
    if f1 is not None and f2 is not None and abs(f1[0] - f2[0]) <= P_BAND:
        return f2[1], abs(f2[1] - f1[1]), "fitted", detail
    return hb, e, "order not identified", detail


# ── the refinement walk (pure over a level source) ───────────────────────────

@dataclass
class Walk:
    price: dict | None = None          # accepted: value, continuation, estimate, level, estimator, tol, target
    price_reason: str | None = None
    proved_exceedance: dict | None = None
    delta: dict | None = None          # accepted: value, estimate, level, rule
    delta_reason: str | None = None
    levels: list | None = None
    trace: list | None = None
    price_units: int = 0
    delta_units: int = 0
    stopped: str | None = None


def walk(get: Callable[[int, int], "Level | str"], c: om.Context, x: float, lo: float, hi: float, cfg: Config,
         analytic: dict | None = None) -> Walk:
    """Run levels in order from `get(i, units_used)` (a Level, or the reason level i may not run) until the price
    is accepted (or refused) and the delta is accepted or no longer eligible, or a cap stops it. With `analytic`
    the price is already fixed by the analytic route and the levels serve the delta alone. The same function
    runs live and offline (calibration), so the two cannot disagree.

    Arithmetic that leaves the floating-point range while the price is undecided propagates (the caller refuses
    the context); once the price is fixed it only withholds the delta (DR-07)."""
    sgn = 1.0 if c.is_call else -1.0
    w = Walk(levels=[], trace=[])
    st = {"need_price": analytic is None, "delta_open": True, "used": 0}
    if om.early_dividend(c):
        st["delta_open"], w.delta_reason = False, D_DIVIDEND
    # on the analytic route the zone is also tested on the returned midpoint
    clear = analytic is None or analytic["value"] - x > om.DELTA_ZONE * analytic["tol"]
    while st["need_price"] or (w.delta is None and st["delta_open"]):
        try:
            more = _level(w, st, get, c, x, lo, hi, cfg, sgn, clear)
        except (OverflowError, ZeroDivisionError, FloatingPointError, NonFinite):
            if st["need_price"]:
                raise
            w.delta_reason = w.stopped = ARITHMETIC
            break
        if not more:
            break
    return w


def _level(w: Walk, st: dict, get, c, x, lo, hi, cfg: Config, sgn: float, clear: bool) -> bool:
    """Run and judge one more level; False when the walk must stop."""
    lv = get(len(w.levels), st["used"])
    if isinstance(lv, str):
        w.stopped = lv if len(w.levels) >= MIN_LEVELS else SHORT
        if st["need_price"]:
            w.price_reason = w.price_reason or w.stopped
        if w.delta is None and st["delta_open"]:
            w.delta_reason = w.delta_reason or w.stopped
        return False
    w.levels.append(lv)
    st["used"] += lv.units
    if st["need_price"]:
        w.price_units += lv.units
    else:
        w.delta_units += lv.units
    if len(w.levels) < MIN_LEVELS:
        return True
    ms = [l.m for l in w.levels]
    hs = [l.h for l in w.levels]
    hh, e, how, detail = estimate(ms, hs, c.spot, cfg.estimator)
    v = max(x, hh)
    tol = om.tolerance(v, c.spot)
    es = max(cfg.F * e, FLOOR * tol)
    t = cfg.tau * tol
    dist = max(lo - v, v - hi, 0.0)
    check(hh, e, v, tol, es, dist, *detail["B"])
    gap = 0.0 if cfg.force_lattice else dist
    k = len(w.levels) - 1
    w.trace.append({"k": k, "m": ms[-1], "H": hh, "V": v, "E": e, "Es": es, "t": t, "tol": tol, "dist": dist,
                    "estimator": how, **detail})
    if st["need_price"]:
        if es <= t and gap > es:
            w.proved_exceedance = {"k": k, "V": v, "Es": es, "dist": dist}
            w.price_reason = CONTRADICTED
            return False
        if es > t:
            w.price_reason = ABOVE_TARGET
        elif gap > 0.0:
            w.price_reason = OUTSIDE_INTERVAL
        else:
            w.price = {"value": v, "continuation": hh, "estimate": es, "level": k, "estimator": how,
                       "tol": tol, "target": t, "exercise_resolved": abs(hh - x) >= es}
            w.price_reason = None
            st["need_price"] = False
    if w.delta is None and st["delta_open"]:
        deep = hh <= x and all(l.h <= x and abs(l.delta - sgn) <= DEEP for l in w.levels)
        if deep:
            w.delta = {"value": sgn, "estimate": DELTA_FLOOR, "level": k, "rule": "deep exercise"}
            w.delta_reason = None
        elif clear and hh - x > om.DELTA_ZONE * tol and hh - x >= es:
            dval, de, _ = envelope(ms, [l.delta for l in w.levels])
            des = max(cfg.F_d * de, DELTA_FLOOR)
            check(dval, de, des)
            w.trace[-1].update(D=dval, Ed=de, dEs=des)
            if des <= om.DELTA_TOL:
                w.delta = {"value": dval, "estimate": des, "level": k, "rule": "envelope"}
                w.delta_reason = None
            else:
                w.delta_reason = D_ABOVE
        else:
            w.delta_reason = D_ZONE if not clear or hh - x <= om.DELTA_ZONE * tol else D_DECISION
            if es <= t and w.delta_reason == D_ZONE:
                st["delta_open"] = False   # the continuation is accurate to t <= tol: the zone question is settled
    return True


# ── the controller ───────────────────────────────────────────────────────────

def _answer(route: str, status: str, value, est, delta_status, delta, delta_est, reason, delta_reason, units_, audit):
    return oe.Answer(engine=ENGINE, version=VERSION, route=route, price_status=status, value=value, estimate=est,
                     delta_status=delta_status, delta=delta, delta_estimate=delta_est, reason=reason,
                     delta_reason=delta_reason, units=units_, audit=audit)


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def input_failure(c: om.Context) -> str | None:
    """Why the inputs describe no valid context (design §1, DR-01), or None."""
    if not isinstance(c.is_call, bool):
        return "the option type is not a call or a put"
    if not all(_num(v) for v in (c.spot, c.strike, c.rho, c.q, c.sigma)):
        return "a non-finite or non-numeric input"
    if not _int(c.days) or c.days < 0:
        return "the days to expiry are not a whole number of at least 0"
    if c.spot <= 0 or c.strike <= 0 or c.sigma <= 0:
        return "the price, strike and volatility must be positive"
    for d, a in c.divs:
        if not _int(d) or not 0 <= d < max(c.days, 1):
            return "a dividend day outside the contract's life"
        if not _num(a) or a <= 0:
            return "a dividend amount that is not positive"
    if c.spot - c.pv() <= 0:
        return "the price is at or below the dividends still owed"
    return None


def price(c: om.Context, cfg: Config = Config(), level_source: Callable[[om.Context, int], Level] = lattice_level) -> oe.Answer:
    """Tier 2's answer for one context. `level_source` computes one lattice level (calibration passes a cached
    one; the walk and its caps are the same either way). Arithmetic that leaves the floating-point range is a
    named refusal, never an exception and never a served number (DR-02)."""
    try:   # numpy overflow gives inf, not an exception: the finiteness checks catch it
        return _price(c, cfg, level_source)
    except (OverflowError, ZeroDivisionError, FloatingPointError, NonFinite):
        return _answer(oe.ROUTE_NONE, oe.INPUT, None, None, oe.WITHHELD, None, None, ARITHMETIC, "no price", 0,
                       {"config": asdict(cfg)})


def _price(c: om.Context, cfg: Config, level_source) -> oe.Answer:
    audit: dict = {"config": asdict(cfg)}
    none = (oe.WITHHELD, None, None)
    bad = input_failure(c)
    if bad is not None:
        return _answer(oe.ROUTE_NONE, oe.INPUT, None, None, *none, bad, "no price", 0, audit)
    if c.days == 0:
        v = max(c.spot - c.strike, 0.0) if c.is_call else max(c.strike - c.spot, 0.0)
        return _answer(oe.ROUTE_INTRINSIC, oe.EXACT, v, None, *none, None, D_EXPIRY, 0, audit)
    why = om.in_domain(c)
    if why is not None:
        return _answer(oe.ROUTE_NONE, oe.OUTSIDE, None, None, *none, why, "no price", 0, audit)
    work = om.UNITS_CLOSED_FORM
    eu = om.european(c)
    check(eu)
    if not cfg.force_lattice and om.exempt(c):
        d = om.european_delta(c)
        check(d)
        return _answer(oe.ROUTE_EXEMPT, oe.EXACT, eu, None, oe.SERVED, d, None, None, None, work, audit)
    sgn = 1.0 if c.is_call else -1.0
    x = sgn * (c.spot - c.strike)
    lo = max(eu, x)
    t_lo = cfg.tau * om.tolerance(lo, c.spot)

    def charge(pieces: int) -> None:
        nonlocal work
        work += om.UNITS_BOUND_BATCH + om.UNITS_BOUND_PIECE * pieces

    work += om.UNITS_CLOSED_FORM * len(c.divs)   # as of.Pricer.bound
    b = om.premium_bound(c, charge, decide=2.0 * t_lo + max(0.0, x - eu))
    hi = eu + b
    half = (hi - lo) / 2.0
    check(b, lo, hi, half)
    audit.update(european=eu, exercise=x, L=lo, U=hi, h=half, bound=b)
    if hi < lo:
        audit["interval_inconsistent"] = True
        return _answer(oe.ROUTE_NONE, oe.UNRESOLVED, None, None, *none, INCONSISTENT, "no price", work, audit)
    n0 = om.steps_for(c.days)
    ms = multipliers(cfg.schedule, n0)
    audit.update(n0=n0, multipliers=list(ms))
    analytic = None
    if not cfg.force_lattice and half <= t_lo:
        mid = lo + half    # not (lo + hi)/2, which can overflow where lo and hi do not (DR-02)
        tol_lo = om.tolerance(lo, c.spot)
        analytic = {"value": mid, "tol": tol_lo, "estimate": max(half, FLOOR * tol_lo)}
        check(mid, analytic["estimate"])
        if not lo <= mid <= hi:
            raise NonFinite

    def get(i: int, used: int):
        why_not = cap(i, ms, n0, used)
        if why_not is not None:
            return why_not
        lv = level_source(c, ms[i])
        check(lv.h, lv.delta)
        return lv

    w = walk(get, c, x, lo, hi, cfg, analytic)
    audit.update(levels=[asdict(l) for l in w.levels], trace=w.trace, stopped=w.stopped,
                 price_units=work + w.price_units, delta_units=w.delta_units)
    if w.proved_exceedance:
        audit["proved_exceedance"] = w.proved_exceedance
    total = work + w.price_units + w.delta_units
    if w.delta is not None:
        dpart = (oe.SERVED, w.delta["value"], w.delta["estimate"])
        audit["delta_rule"] = w.delta["rule"]
        audit["delta_level"] = w.delta["level"]
    else:
        dpart = (oe.WITHHELD, None, None)
    dreason = None if w.delta is not None else w.delta_reason
    if analytic is not None:
        return _answer(oe.ROUTE_ANALYTIC, oe.ANALYTIC, analytic["value"], analytic["estimate"], *dpart, None,
                       dreason, total, audit)
    if w.price is None:
        return _answer(oe.ROUTE_LATTICE, oe.UNRESOLVED, None, None, oe.WITHHELD, None, None,
                       w.price_reason, "no price", total, audit)
    audit.update(price_level=w.price["level"], estimator=w.price["estimator"], target=w.price["target"],
                 exercise_resolved=w.price["exercise_resolved"])
    return _answer(oe.ROUTE_LATTICE, oe.ESTIMATED, w.price["value"], w.price["estimate"], *dpart, None, dreason,
                   total, audit)
