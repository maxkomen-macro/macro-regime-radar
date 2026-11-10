"""src/desk/options_greeks.py — the Phase 3 Greeks: gamma, vega, rho, theta and the next-dividend sensitivity.

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md (Codex pass 5), sections 2, 4 and 5. Unserved:
nothing under api/ imports this module. The served delta stays Tier 2's (the Phase 2 lattice envelope).

Conventions (design section 2). Every Greek is a derivative, or a one-day difference, of the t = 0 value with the
market spot S held fixed; X = S − PV_0 is the escrowed part, a GBM with volatility σ.
- gamma ∂²V/∂S² (1/$); vega 0.01·∂V/∂σ ($ per vol point; σ is X's volatility); rho 0.01·∂V/∂r ($ per percentage
  point; S fixed, so X moves through PV_0); theta V(t + 1 calendar day) − V(t) ($ per calendar day; every d_i and
  days fall by one, X moves to S − PV_1); dividend ∂V/∂D_1, D_1 the next owed dividend's amount (S fixed, so X
  moves by −e^{−r·d_1/365}·dD_1).
- Any state at days = 0 is the intrinsic payoff at the held-fixed spot, evaluated directly.

Routes, per Greek: input failure, at expiry, outside the domain, outside the claim region (the predicates frozen
at the Phase 3 freeze; `region`), exempt (closed forms of section 7.3 when om.exempt holds for every state the
stencil needs), exercised now (design section 5, rule 1: the exact branch), else the production FD at two levels
L1 and L2 (options_fd), served at L2 without extrapolation, with the estimate E_G = F_G·|G(L2) − G(L1)| floored at
0.1·tol_G. E_G is an empirical estimate, never a bound. Pure functions of numbers: no I/O, no clock.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Callable

from scipy.special import ndtr

from src.desk import options_adaptive as oa
from src.desk import options_fd as fd
from src.desk import options_math as om

VERSION = "greeks-p3.0"

GAMMA, VEGA, RHO, THETA, DIVIDEND = "gamma", "vega", "rho", "theta", "dividend"
GREEKS = (GAMMA, VEGA, RHO, THETA, DIVIDEND)
BUMPED = (VEGA, RHO, DIVIDEND)
UNIT = {VEGA: 0.01, RHO: 0.01, DIVIDEND: 1.0}

# Statuses.
RETURNED = "returned"
EXACT_EXEMPT = "exact (exempt)"
EXACT_EXERCISED = "exact (exercised now)"
WITHHELD = "withheld"

# Withheld reasons (design section 5), each in its own words.
R_INPUT = "input failure"
R_EXPIRY = "at expiry"
R_DOMAIN = "outside the domain"
R_NEAR = "near an exercise decision"
R_UNSTABLE = "unstable under the bump"
R_ESTIMATE = "estimate above tolerance"
R_WORK = "work cap"
R_BUMP_DOMAIN = "bump leaves the validated domain"
R_EXDIV = "ex-dividend inside the step"
R_NO_DIVIDEND = "no dividend owed"
R_FD = "FD refused"            # followed by the FD's own reason

ZONE = 5.0          # price tolerances: the exercise-decision zone of rules 1 and 2 (as Phase 2's DELTA_ZONE)
FLOOR = 0.1         # production estimates are floored at 0.1·tol_G (design section 4.4)


def tolerance(greek: str, value: float, spot: float) -> float:
    """tol_G (design section 2): gamma max(2%·|Γ|, 0.01/S); vega and rho max(1%·|G|, 1e-5·S); theta
    max(2%·|θ|, 5e-6·S); dividend 2.5e-3."""
    if greek == GAMMA:
        return max(0.02 * abs(value), 0.01 / spot)
    if greek in (VEGA, RHO):
        return max(0.01 * abs(value), 1e-5 * spot)
    if greek == THETA:
        return max(0.02 * abs(value), 5e-6 * spot)
    if greek == DIVIDEND:
        return 2.5e-3
    raise ValueError(greek)


@dataclass(frozen=True)
class GreekConfig:
    """Production settings. The defaults are placeholders until the Phase 3 freeze, which sets every one from dev
    evidence (design sections 4.2, 4.4, 8.5) and records it in the freeze manifest."""
    fd: fd.FDConfig = field(default_factory=lambda: fd.FDConfig(m_frac=0.25, p_frac=0.5, work_cap=2_000_000_000))
    h_sigma: float = 0.0025       # vol units, capped at σ/4
    h_r: float = 5e-4             # rate units
    h_d_frac: float = 0.005       # times max(D_1, 0.001·S), in $
    factors: tuple = ((GAMMA, 3.0), (VEGA, 3.0), (RHO, 3.0), (THETA, 3.0), (DIVIDEND, 3.0))
    zone: float = ZONE

    def factor(self, greek: str) -> float:
        return dict(self.factors)[greek]


@dataclass(frozen=True)
class GreekAnswer:
    greek: str
    status: str
    value: float | None
    estimate: float | None
    reason: str | None
    audit: dict = field(default_factory=dict, compare=False)


# ── states (design section 2): S held fixed in every bump ─────────────────────

def next_dividend(c: om.Context) -> int | None:
    """Index in c.divs of the next owed dividend (the earliest cum close), or None."""
    if not c.divs:
        return None
    return min(range(len(c.divs)), key=lambda i: (c.divs[i][0], i))


def bumped(c: om.Context, greek: str, h: float) -> om.Context:
    if greek == VEGA:
        return replace(c, sigma=c.sigma + h)
    if greek == RHO:
        return replace(c, rho=c.rho + h)
    if greek == DIVIDEND:
        j = next_dividend(c)
        divs = tuple((d, a + h) if i == j else (d, a) for i, (d, a) in enumerate(c.divs))
        return replace(c, divs=divs)
    raise ValueError(greek)


def one_day_later(c: om.Context) -> om.Context:
    """The theta state: days − 1, every cum close one day earlier (a dividend whose close was today is paid)."""
    divs = tuple((d - 1, a) for d, a in c.divs if d - 1 >= 0)
    return replace(c, days=c.days - 1, divs=divs)


def bump_size(c: om.Context, greek: str, cfg: GreekConfig) -> float:
    if greek == VEGA:
        return min(cfg.h_sigma, c.sigma / 4.0)
    if greek == RHO:
        return cfg.h_r
    if greek == DIVIDEND:
        return cfg.h_d_frac * max(c.divs[next_dividend(c)][1], 0.001 * c.spot)
    raise ValueError(greek)


def state_failure(c: om.Context) -> str | None:
    """Why a stencil state is not a valid, in-domain context (design section 4.2, DR-14), or None. A state at
    days = 0 is valid: it is the intrinsic payoff."""
    bad = oa.input_failure(c)
    if bad is not None:
        return bad
    if c.days == 0:
        return None
    why = om.in_domain(c)
    if why is not None:
        return why
    if c.spot - c.pv() <= 0.0:
        return "the price is at or below the owed dividends"
    return None


def intrinsic(c: om.Context) -> float:
    return max(c.spot - c.strike, 0.0) if c.is_call else max(c.strike - c.spot, 0.0)


# ── closed forms (design section 7.3): European values under the escrowed model, S fixed ──

def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def closed_forms(c: om.Context) -> dict:
    """Black-76 on F = X·e^{(r−q)τ}, discount e^{−rτ}, X = S − PV_0: value, delta, gamma, vega, rho, theta and,
    with a dividend owed, the next-dividend sensitivity. Requires days >= 1."""
    if c.days < 1:
        raise ValueError("closed forms need days >= 1 (a days = 0 state is the intrinsic payoff)")
    tau = c.tau
    x = c.spot - c.pv()
    vol = c.sigma * math.sqrt(tau)
    d1 = (math.log(x / c.strike) + (c.rho - c.q + 0.5 * c.sigma * c.sigma) * tau) / vol
    d2 = d1 - vol
    eq, er = math.exp(-c.q * tau), math.exp(-c.rho * tau)
    if c.is_call:
        value = x * eq * float(ndtr(d1)) - c.strike * er * float(ndtr(d2))
        delta = eq * float(ndtr(d1))
        drx = c.strike * tau * er * float(ndtr(d2))
    else:
        value = c.strike * er * float(ndtr(-d2)) - x * eq * float(ndtr(-d1))
        delta = eq * (float(ndtr(d1)) - 1.0)
        drx = -c.strike * tau * er * float(ndtr(-d2))
    gamma = eq * _npdf(d1) / (x * vol)
    vega = 0.01 * x * eq * _npdf(d1) * math.sqrt(tau)
    dxdr = sum((d / om.YEAR_DAYS) * a * math.exp(-c.rho * d / om.YEAR_DAYS) for d, a in c.divs)
    rho = 0.01 * (delta * dxdr + drx)
    later = one_day_later(c)
    v_later = intrinsic(later) if later.days == 0 else om.european(later)
    out = {"value": value, "delta": delta, GAMMA: gamma, VEGA: vega, RHO: rho, THETA: v_later - om.european(c)}
    j = next_dividend(c)
    if j is not None:
        out[DIVIDEND] = -math.exp(-c.rho * c.divs[j][0] / om.YEAR_DAYS) * delta
    return out


# ── reading the FD grids (design sections 4.1 and 4.3) ───────────────────────

def gamma_s_form(xs, v, i: int) -> float:
    """The second derivative of the quadratic through (X_{i−1}, V_{i−1}), (X_i, V_i), (X_{i+1}, V_{i+1}): exact
    for V quadratic in S, and ∂²V/∂S² since dS = dX."""
    a = (v[i + 1] - v[i]) / (xs[i + 1] - xs[i])
    b = (v[i] - v[i - 1]) / (xs[i] - xs[i - 1])
    return float(2.0 * (a - b) / (xs[i + 1] - xs[i - 1]))


def cubic_at(x, v, x1: float) -> float:
    """The cubic through the four grid nodes around x1 (Lagrange form), evaluated at x1."""
    import numpy as np
    j = int(np.searchsorted(x, x1)) - 1          # x[j] <= x1 < x[j + 1]
    j = min(max(j, 1), len(x) - 3)
    pts = range(j - 1, j + 3)
    total = 0.0
    for a in pts:
        w = 1.0
        for b in pts:
            if b != a:
                w *= (x1 - x[b]) / (x[a] - x[b])
        total += w * v[a]
    return float(total)


@dataclass
class _Ctx:
    """One context's production run: the levels, the shared budget and the base solves."""
    c: om.Context
    cfg: GreekConfig
    budget: fd.Budget
    levels: tuple
    american: bool = True
    base: dict = field(default_factory=dict)       # level index -> Solved | Refused

    def solve(self, state: om.Context, k: int):
        return fd.price(state, self.levels[k], self.budget, penalty=self.cfg.fd.penalty, american=self.american)


def _withheld(greek, reason, **audit) -> GreekAnswer:
    return GreekAnswer(greek, WITHHELD, None, None, reason, audit)


def _estimate(greek: str, g1: float, g2: float, c: om.Context, cfg: GreekConfig) -> tuple[float, float]:
    tol = tolerance(greek, g2, c.spot)
    return max(cfg.factor(greek) * abs(g2 - g1), FLOOR * tol), tol


def _zone_hit(free: float, ex: float, ptol: float, zone: float) -> bool:
    """A free value within zone·price_tol of the (unclipped) exercise value sgn·(S − K)."""
    return abs(free - ex) <= zone * ptol


def greeks(c: om.Context, cfg: GreekConfig = GreekConfig(), region: Callable[[om.Context, str], str | None] | None = None,
           decision_unresolved: bool = False, budget: fd.Budget | None = None, american: bool = True) -> dict:
    """The five Phase 3 Greeks of one context: {greek: GreekAnswer}, plus "_fd" with the base FD values at L1 and
    L2 (the cross-check reuses them) and "_units" (work charged). `region(c, greek)` gives the claim-region
    reason ("outside the sampled region" or "outside this Greek's validated region") or None; it is the frozen
    predicate set from the Phase 3 freeze, None only in development runs. `decision_unresolved` is Tier 2's
    D_DECISION for this context: it blocks the exercised-now exact branch (design section 5, rule 1).
    `american=False` is control C1 (design section 7.3): the same production FD with exercise off and no exempt
    route, scored against the closed forms."""
    bad = oa.input_failure(c)
    if bad is not None:
        return {g: _withheld(g, R_INPUT, detail=bad) for g in GREEKS}
    if c.days == 0:
        return {g: _withheld(g, R_EXPIRY) for g in GREEKS}
    why = om.in_domain(c)
    if why is not None:
        return {g: _withheld(g, R_DOMAIN, detail=why) for g in GREEKS}
    out: dict = {}
    pending = []
    for g in GREEKS:
        if g == DIVIDEND and not c.divs:
            out[g] = _withheld(g, R_NO_DIVIDEND)
            continue
        if region is not None:
            r = region(c, g)
            if r is not None:
                out[g] = _withheld(g, r)
                continue
        pending.append(g)
    run = _Ctx(c, cfg, budget if budget is not None else fd.Budget(cfg.fd.work_cap), fd.levels(c, cfg.fd),
               american=american)
    # exempt: closed forms when every state of the stencil is exempt (design section 4.5)
    rest = []
    for g in pending:
        states = _stencil_states(c, g, cfg)
        if american and states is not None and all(s.days == 0 or om.exempt(s) for s in states):
            cf = closed_forms(c)
            out[g] = GreekAnswer(g, EXACT_EXEMPT, cf[g], 0.0, None, {"route": "exempt"})
        else:
            rest.append(g)
    if rest:
        _fd_route(run, rest, out, decision_unresolved)
    out["_fd"] = {k: (s.value if isinstance(s, fd.Solved) else None) for k, s in run.base.items()}
    out["_base"] = dict(run.base)   # the base solves themselves (fd.Solved or fd.Refused), for the cross-check
    out["_units"] = run.budget.used
    return out


def _stencil_states(c: om.Context, greek: str, cfg: GreekConfig) -> list | None:
    """Every state the Greek's production stencil needs, or None when one is not a valid in-domain context (the
    Greek is then withheld: bump leaves the validated domain)."""
    if greek == GAMMA:
        states = [c]
    elif greek == THETA:
        states = [c, one_day_later(c)]
    else:
        h = bump_size(c, greek, cfg)
        states = [bumped(c, greek, s * h) for s in (1.0, -1.0, 0.5, -0.5)]
    if any(state_failure(s) is not None for s in states):
        return None
    return states


def _fd_route(run: _Ctx, rest: list, out: dict, decision_unresolved: bool) -> None:
    c, cfg = run.c, run.cfg
    for k in (0, 1):
        run.base[k] = run.solve(c, k)
    b1, b2 = run.base[0], run.base[1]
    for k, b in ((0, b1), (1, b2)):
        if isinstance(b, fd.Refused):
            for g in rest:
                out[g] = _withheld(g, R_WORK if b.reason == fd.R_WORK else f"{R_FD}: {b.reason}", level=k + 1)
            return
    sgn = 1.0 if c.is_call else -1.0
    ex_now = sgn * (c.spot - c.strike)                     # the unclipped exercise value at the spot, S fixed
    ptol = om.tolerance(b2.value, c.spot)
    g2 = b2.grids
    i = b2.level.m // 2
    stencil = slice(i - 1, i + 2)
    ex_nodes = sgn * (g2["xs"][stencil] + fd.pv_owed(c.divs, c.rho, 0.0) - c.strike)
    exercised = g2["exercise0"][stencil]
    free = g2["free0"][stencil]
    clear_ex = bool(exercised.all() and (free < ex_nodes - cfg.zone * ptol).all())
    mixed = bool(exercised.any() and not exercised.all())
    near = mixed or bool((abs(free - ex_nodes) <= cfg.zone * ptol).any())
    exact_exercise = clear_ex and not decision_unresolved
    for g in rest:
        if g == THETA:
            out[g] = _theta(run, ex_now, ptol)
            continue
        if exact_exercise:
            out[g] = GreekAnswer(g, EXACT_EXERCISED, 0.0, 0.0, None, {"route": "exercised now"})
            continue
        if g == GAMMA:
            if near or clear_ex:   # clear_ex here means Tier 2's decision is unresolved
                out[g] = _withheld(g, R_NEAR, rule=1)
                continue
            v1 = gamma_s_form(b1.grids["xs"], b1.grids["v0"], b1.level.m // 2)
            v2 = gamma_s_form(g2["xs"], g2["v0"], i)
            est, tol = _estimate(g, v1, v2, c, cfg)
            out[g] = _answer(g, v1, v2, est, tol)
            continue
        out[g] = _bumped(run, g, ex_now, ptol)


def _answer(g: str, v1: float, v2: float, est: float, tol: float, **audit) -> GreekAnswer:
    audit.update(L1=v1, L2=v2, tol=tol)
    if est > tol:
        return GreekAnswer(g, WITHHELD, None, est, R_ESTIMATE, audit)
    return GreekAnswer(g, RETURNED, v2, est, None, audit)


def _spot_state(s: fd.Solved) -> tuple[bool, float]:
    i = s.level.m // 2
    return bool(s.grids["exercise0"][i]), float(s.grids["free0"][i])


def _bumped(run: _Ctx, g: str, ex_now: float, ptol: float) -> GreekAnswer:
    c, cfg = run.c, run.cfg
    if _stencil_states(c, g, cfg) is None:
        return _withheld(g, R_BUMP_DOMAIN)
    h = bump_size(c, g, cfg)
    vals = {}
    for k, hh in ((0, h), (1, h), (1, h / 2.0)):
        pair = []
        for sgn_h in (1.0, -1.0):
            s = run.solve(bumped(c, g, sgn_h * hh), k)
            if isinstance(s, fd.Refused):
                return _withheld(g, R_WORK if s.reason == fd.R_WORK else f"{R_FD}: {s.reason}", level=k + 1, h=hh)
            pair.append(s)
        vals[(k, hh)] = pair
    up, dn = vals[(1, h)]
    (eu, fu), (ed, fdn) = _spot_state(up), _spot_state(dn)
    if eu != ed or _zone_hit(fu, ex_now, ptol, cfg.zone) or _zone_hit(fdn, ex_now, ptol, cfg.zone):
        return _withheld(g, R_NEAR, rule=2)

    def diff(k, hh):
        p, m = vals[(k, hh)]
        return UNIT[g] * (p.value - m.value) / (2.0 * hh)
    g1, g2, g_half = diff(0, h), diff(1, h), diff(1, h / 2.0)
    tol = tolerance(g, g2, c.spot)
    if abs(g2 - g_half) > tol:
        return _withheld(g, R_UNSTABLE, rule=3, L2=g2, L2_half=g_half, tol=tol)
    est, tol = _estimate(g, g1, g2, c, cfg)
    return _answer(g, g1, g2, est, tol, h=h, L2_half=g_half)


def _theta(run: _Ctx, ex_now: float, ptol: float) -> GreekAnswer:
    c, cfg = run.c, run.cfg
    if any(d == 0 for d, _ in c.divs):
        return _withheld(THETA, R_EXDIV)
    if _stencil_states(c, THETA, cfg) is None:
        return _withheld(THETA, R_BUMP_DOMAIN)
    later = one_day_later(c)
    x1 = c.spot - later.pv()               # X at t + 1 with S fixed: S − PV_1 (PV_1 at the shifted schedule)
    vals = []
    frees = []
    for k in (0, 1):
        s = run.base[k]
        i = s.level.m // 2
        if c.days == 1:
            v1 = intrinsic(later)
        else:
            v1 = cubic_at(s.grids["x"], s.grids["v_day1"], math.log(x1))
            frees.append(cubic_at(s.grids["x"], s.grids["free_day1"], math.log(x1)))
        vals.append(v1 - float(s.grids["v0"][i]))
    # rule 2: the spot's exercise status at t and at t + 1, and both free values against the exercise value. At
    # days = 1 the t + 1 state is expiry, where nothing is decided, so only t = 0 is tested (conformance note V-6)
    e0, f0 = _spot_state(run.base[1])
    if _zone_hit(f0, ex_now, ptol, cfg.zone):
        return _withheld(THETA, R_NEAR, rule=2)
    if c.days >= 2:
        f1 = frees[1]
        e1 = f1 < ex_now and ex_now > 0.0
        if e1 != e0 or _zone_hit(f1, ex_now, ptol, cfg.zone):
            return _withheld(THETA, R_NEAR, rule=2)
    est, tol = _estimate(THETA, vals[0], vals[1], c, cfg)
    return _answer(THETA, vals[0], vals[1], est, tol)
