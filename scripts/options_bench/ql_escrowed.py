"""scripts/options_bench/ql_escrowed.py — the second corroborator Q for the Phase 3 references (test tooling).

Design: amendment P3-AM2 (review-loop/options-adaptive-p3/designs/), section B. The model of design section 2,
solved by QuantLib's own finite-difference classes: X = S − PV_0 a GBM with drift r − q and volatility σ,
PV_t = Σ_{d_i ≥ t} D_i·e^{−r(d_i − t)/365}, exercise value (sgn·(X_t + PV_t − K))⁺ with the cum value at a close.

- mesh: FdmBlackScholesMesher in ln X, built from the base context and held fixed across its stencil's states,
  concentrated at the expiry payoff's kink X = K − PV_τ (amendment P3-AM3, change 1);
- operator: FdmBlackScholesOp; time stepping: FdmBackwardSolver (Douglas, θ = 0.5) after DAMPING implicit
  steps, N_t = days·spd steps in all (QuantLib divides the horizon by steps + damping steps), spd whole steps
  per calendar day, so every close is a grid time and the theta pair shares its grid; spd doubles with n
  (spd = ceil(LEVELS[0]/days)·n/LEVELS[0], P3-AM3 change 2), so every level halves both the space and the time
  step; levels 512, 1024, 2048 and the one escalation 4096 (amendment P3-AM5), then (P3-AM6 B.2, Q+) the level
  8192 when 4096 and the alternating estimate still leave Q unqualified;
- early exercise: a step condition projecting onto the exercise value after every step, through a zero-copy
  view of the QuantLib Array (layout-checked on every call, element-wise fallback, bit-identical);
- read-out: CubicNaturalSpline in ln X; gamma = (V_xx − V_x)/X_0².

Nothing here imports the production FD kernel (src/desk/options_fd.py), reference.py or the lattice; it shares
only the model definition (design section 9) and the stencil (options_greeks.bumped / one_day_later, through
greek_reference.Spec), so the held-fixed rules are the same by construction.
"""

from __future__ import annotations

import ctypes
import math

import numpy as np

from src.desk import options_greeks as G
from src.desk import options_math as om

try:
    import QuantLib as ql
except ImportError:          # pragma: no cover - the bench requires it; the result says so
    ql = None

YEAR_DAYS = 365.0
LEVELS = (512, 1024, 2048)   # mesh sizes n; spd = ceil(512 / days)·n/512 (P3-AM3 rule; P3-AM5: 512 restores
                             # P3-AM3's cell at X_0 within 3% under MESH_EPS 1e-6, which widened it by ~28% at 400)
ESCALATE = 4096              # the one extra level when LEVELS leave Q unqualified (section C)
EXTRA = 8192                 # P3-AM6 B.2 (Q+): one more level when the escalation and the alternating estimate
                             # still leave Q unqualified; run as pass 2 of greek_reference.references (B.3)
DAMPING = 2
FLOOR = 0.02                 # reference floor, of tol (= greek_reference.REF_FLOOR)
RHO_MAX = 0.75               # slower than this is "not converging"
RHO_MIN = 0.5                # never assume convergence faster than first order
F_Q = 1.0                    # calibrated on dev (C2-Q, European, zero misses in every group); never below 1
DENSITY = 0.1                # mesher concentration density at the expiry kink
MESH_EPS = 1e-6              # the mesher's tail cut (P3-AM4 change 1; P3-AM2/AM3: 1e-4 biased extreme-vol vega)
TODAY = None                 # QuantLib evaluation date, set on first use

R_NOT_CONVERGING = "Q sequence not converging"
R_REFUSED = "Q refused"


def _today():
    global TODAY
    if TODAY is None:
        TODAY = ql.Date(26, 10, 2026)
    ql.Settings.instance().evaluationDate = TODAY
    return TODAY


def _pv(c: om.Context):
    """PV_t of the dividends owed at t (cum close at or after t), discounted at r."""
    divs = [(d / YEAR_DAYS, a) for d, a in c.divs]

    def pv(t: float) -> float:
        return sum(a * math.exp(-c.rho * (ti - t)) for ti, a in divs if ti >= t - 1e-12)
    return pv, sorted({ti for ti, _ in divs})


def _process(c: om.Context, x0: float):
    today = _today()
    dc = ql.Actual365Fixed()

    def flat(r):
        return ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc, ql.Continuous))
    return ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(x0)), flat(c.q), flat(c.rho),
                                        ql.BlackVolTermStructureHandle(
                                            ql.BlackConstantVol(today, ql.NullCalendar(), c.sigma, dc)))


def steps_per_day(days: int, n: int) -> int:
    """Whole steps per calendar day: every close is a grid time, and the theta pair shares the step. P3-AM3:
    spd_0 = ceil(LEVELS[0]/days) at the first level, doubled with each doubling of n, so the time step halves
    with the space step at every level (under P3-AM2's ceil(n/days) a long-dated context kept spd = 1 at n = 400
    and 800, and the sequence's ratio no longer measured its error)."""
    if n % LEVELS[0] or (n // LEVELS[0]) & (n // LEVELS[0] - 1):
        raise ValueError(f"level {n} is not {LEVELS[0]}·2^k")
    return max(1, -(-LEVELS[0] // max(days, 1))) * (n // LEVELS[0])


def mesh(c: om.Context, n: int):
    """The base context's ln X mesh (size n), held fixed for every state of the stencil. P3-AM3: concentrated
    at the expiry payoff's kink X = K − PV_τ (floored at 0.001·K), not at K − PV_0: with a dividend owed the two
    differ, the kink sat in coarse cells and the level sequence alternated (dev: 4 of 4 such sequences in
    G2-dividends converge with it). The mesher's span and its strike argument K_X are unchanged."""
    pv, _ = _pv(c)
    x0 = c.spot - pv(0.0)
    kx = max(c.strike - pv(0.0), 1e-3 * c.strike)
    kink = max(c.strike - pv(max(c.days, 1) / YEAR_DAYS), 1e-3 * c.strike)
    m1 = ql.FdmBlackScholesMesher(n, _process(c, x0), max(c.days, 1) / YEAR_DAYS, kx, ql.nullDouble(),
                                  ql.nullDouble(), MESH_EPS, 1.5, (kink, DENSITY))
    return m1, kx


def exercise(s_level, sgn: float, strike: float):
    """(sgn·(S − K))⁺ with the sign inside the positive part; S = X + PV_t (scalar or array). Used for the payoff
    at expiry, the projection after every step and the cum exercise today."""
    return np.maximum(sgn * (np.asarray(s_level, dtype=float) - strike), 0.0)


def _view(a, n: int):
    """A numpy view of QuantLib::Array's storage (QuantLib 1.44: data pointer, then size), or None when the
    layout check fails; the caller then uses QuantLib's element accessors."""
    p = ctypes.cast(int(a.this), ctypes.POINTER(ctypes.c_uint64))
    if p[1] != n or p[0] == 0:
        return None
    v = np.ctypeslib.as_array(ctypes.cast(p[0], ctypes.POINTER(ctypes.c_double)), shape=(n,))
    if v[0] != a[0] or v[n - 1] != a[n - 1]:
        return None
    return v


class _Project:
    """V = max(V, (sgn·(e^x + PV_t − K))⁺) after every step (QuantLib calls applyTo with the step's end time)."""

    def __init__(self, xs: np.ndarray, sgn: float, strike: float, pv, fast: bool = True, trace: list | None = None):
        self.xs, self.sgn, self.k, self.pv, self.fast, self.trace = xs, sgn, strike, pv, fast, trace

    def applyTo(self, a, t):       # noqa: N802 - QuantLib's name
        if self.trace is not None:
            self.trace.append(t)
        g = exercise(self.xs + self.pv(t), self.sgn, self.k)
        v = _view(a, len(self.xs)) if self.fast else None
        if v is not None:
            np.maximum(v, g, out=v)
            return
        v = np.array(a)
        for i in np.nonzero(g > v)[0]:
            a[int(i)] = float(g[i])


def solve(c: om.Context, m, spd: int, american: bool = True, fast: bool = True, trace: list | None = None) -> dict:
    """{"value", "gamma"} of state c on the base context's mesh m with spd steps per day. days = 0 is the
    intrinsic payoff at the held-fixed spot (DR-12), never a solve; its gamma is not defined (None)."""
    sgn = 1.0 if c.is_call else -1.0
    if c.days == 0:
        return {"value": G.intrinsic(c), "gamma": None, "cells": 0}
    m1, kx = m
    tau = c.days / YEAR_DAYS
    pv, times = _pv(c)
    x0 = c.spot - pv(0.0)
    if not x0 > 0.0:
        raise ValueError("escrowed spot X_0 not positive")
    lx = np.array(m1.locations())
    xs = np.exp(lx)
    nt = c.days * spd
    a = ql.Array([float(v) for v in exercise(xs + pv(tau), sgn, c.strike)])
    conds = [ql.FdmStepConditionProxy(_Project(xs, sgn, c.strike, pv, fast, trace))] if american else []
    comp = ql.FdmStepConditionComposite([t for t in times if 0.0 < t < tau], ql.FdmStepConditionVector(conds))
    mesher = ql.FdmMesherComposite(m1)
    op = ql.FdmBlackScholesOp(mesher, _process(c, x0), kx)
    ql.FdmBackwardSolver(op, ql.FdmBoundaryConditionSet(), comp, ql.FdmSchemeDesc.Douglas()).rollback(
        a, tau, 0.0, nt - DAMPING, DAMPING)
    spline = ql.CubicNaturalSpline(ql.Array(list(lx)), a)
    l0 = math.log(x0)
    v = spline(l0, False)
    gamma = (spline.secondDerivative(l0, False) - spline.derivative(l0, False)) / (x0 * x0)
    if american:
        v = max(v, float(exercise(c.spot, sgn, c.strike)))
    if not (math.isfinite(v) and math.isfinite(gamma)):
        raise ValueError("non-finite value")
    return {"value": v, "gamma": gamma, "cells": len(xs) * nt}


def quantity(c: om.Context, sp, n: int, american: bool = True, half: bool = False, cache: dict | None = None,
             take=None) -> float:
    """The quantity of `sp` (a greek_reference.Spec) at level n. `cache` holds solves by (base, state, n, mode),
    so the price and gamma share a solve; `take(cells)` charges the work budget before each new solve."""
    cache = {} if cache is None else cache
    spd = steps_per_day(c.days, n)

    def S(s):
        key = (c, s, n, american)
        if key not in cache:
            if take is not None and s.days > 0:
                take(float(n * s.days * spd))
            if ("mesh", c, n) not in cache:
                cache[("mesh", c, n)] = mesh(c, n)
            cache[key] = solve(s, cache[("mesh", c, n)], spd, american)
        return cache[key]

    if sp.name == "price":
        return S(c)["value"]
    if sp.name == G.GAMMA:
        return S(c)["gamma"]
    if sp.name == G.THETA:
        return S(sp.states[1])["value"] - S(c)["value"]
    up, dn = (sp.states[2], sp.states[3]) if half else (sp.states[0], sp.states[1])
    h = sp.h / 2.0 if half else sp.h
    return (S(up)["value"] - S(dn)["value"]) / (2.0 * h) * G.UNIT[sp.name]


def estimate(g: list[float], tol: float, f_q: float = F_Q) -> float | None:
    """Section C: u_Q,ref from three levels, or None when the sequence does not show convergence."""
    d12, d23 = abs(g[1] - g[0]) / tol, abs(g[2] - g[1]) / tol
    if max(d12, d23) <= FLOOR:
        return FLOOR * tol
    if d12 == 0.0 or (g[1] - g[0]) * (g[2] - g[1]) < 0.0:
        return None
    rho = d23 / d12
    if rho > RHO_MAX:
        return None
    rs = max(rho, RHO_MIN)
    return max(f_q * d23 * rs / (1.0 - rs), FLOOR) * tol


def estimate4(g: list[float], tol: float, f_q: float = F_Q) -> tuple[str, float, float] | None:
    """P3-AM4 change 2: (branch, R_Q, u_Q,ref) for a four-level sequence (after the escalation) that rule C leaves
    unqualified, or None. Steps s_1..s_3, d_i = |s_i|/tol. "alternating": the three steps alternate in sign and
    shrink strictly (d_1 > d_2 > d_3): R_Q = g_4 and u = max(F_Q·d_3, floor), the last step. No extrapolation:
    a first-order rescue (R = 2g_4 − g_3 when both ratios lie near 1/2) was dropped (design review DR-AM4-1: two
    observed ratios do not establish the order, and a ratio of 0.59 leaves an error the change between
    extrapolants does not cover)."""
    if len(g) != 4:
        return None
    s = [g[1] - g[0], g[2] - g[1], g[3] - g[2]]
    d = [abs(x) / tol for x in s]
    if s[0] * s[1] < 0.0 and s[1] * s[2] < 0.0 and d[0] > d[1] > d[2]:
        return "alternating", g[3], max(f_q * d[2], FLOOR) * tol
    return None


def extra_eligible(qs: dict) -> bool:
    """P3-AM6 B.3 pass 2, the Q+ test: a completed study (not refused) that went through the escalation to
    ESCALATE and still left Q unqualified after the alternating estimate."""
    return (bool(qs.get("flags")) and not any(f.startswith(R_REFUSED) for f in qs["flags"])
            and tuple(qs.get("levels") or ()) == LEVELS + (ESCALATE,))


def study(c: om.Context, sp, tol: float, american: bool = True, take=None, cache: dict | None = None,
          u_ref_max: float = 0.07, u_bump_max: float = 0.03, extend: dict | None = None) -> dict:
    """Q on one quantity (section C): levels LEVELS, then the one escalation to ESCALATE when unqualified.
    Returns G, u_ref, u_bump, flags (non-empty: Q is not qualified), the levels and values. A QuantLib error or a
    non-finite value is "Q refused"; the budget's CapHit propagates to the caller, as for the FD and lattice.

    `extend` (P3-AM6 B.2 step 3, Q+): a study of the same quantity that `extra_eligible` admits. Its levels and
    values are kept, the level EXTRA is added, rule C runs on 2048, 4096, 8192 with the bump term at 8192, then the
    alternating estimate on the last four levels when rule C leaves Q unqualified. The result is Q's either way."""
    if ql is None:
        return {"G": None, "u_ref": None, "u_bump": None, "flags": [f"{R_REFUSED}: QuantLib not installed"],
                "levels": [], "values": []}
    if extend is not None and not extra_eligible(extend):     # a caller's error, never reported as "Q refused"
        raise ValueError("Q+ needs a completed study that escalated to 4096 and stayed unqualified")
    cache = {} if cache is None else cache
    ns, seq = [], []

    def level(n, half=False):
        return quantity(c, sp, n, american, half, cache, take)

    def assess(gs, nf):
        u = estimate(gs, tol)
        ub = 0.0 if sp.h is None else abs(gs[-1] - level(nf, half=True))
        flags = []
        if u is None:
            flags.append(R_NOT_CONVERGING)
        elif u > u_ref_max * tol:
            flags.append("Q refinement uncertainty above 0.07 tolerances")
        if ub > u_bump_max * tol:
            flags.append("Q bump term above 0.03 tolerances")
        return u, ub, flags

    try:
        if extend is None:
            for n in LEVELS:
                seq.append(level(n))
                ns.append(n)
            u, ub, flags = assess(seq, ns[-1])
            if flags:
                seq.append(level(ESCALATE))
                ns.append(ESCALATE)
                u, ub, flags = assess(seq[-3:], ESCALATE)
        else:
            ns, seq = list(extend["levels"]), list(extend["values"])
            seq.append(level(EXTRA))
            ns.append(EXTRA)
            u, ub, flags = assess(seq[-3:], EXTRA)
    except (RuntimeError, ValueError, TypeError) as e:
        return {"G": None, "u_ref": None, "u_bump": None, "flags": [f"{R_REFUSED}: {str(e)[:120]}"],
                "levels": ns, "values": seq, "branch": None}
    g, branch = seq[-1], None
    bump_flags = [f for f in flags if f.startswith("Q bump")]
    if len(flags) > len(bump_flags):       # rule C left the refinement unqualified: P3-AM4's two branches
        got = estimate4(seq[-4:], tol)
        if got is not None and got[2] <= u_ref_max * tol:
            branch, g, u = got
            flags = bump_flags
    return {"G": g, "u_ref": u, "u_bump": ub, "flags": flags, "levels": ns, "values": seq, "branch": branch}
