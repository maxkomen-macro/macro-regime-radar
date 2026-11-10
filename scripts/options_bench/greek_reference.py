"""scripts/options_bench/greek_reference.py — Phase 3 references for the Greeks and the FD price (test tooling).

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md, sections 7.1, 7.2 and 12. A production FD
quantity (the cross-check price, gamma, vega, rho, theta, the dividend sensitivity) is scored only against a
reference that is corroborated by separate code: an FD study on the quantity itself (time, space, boundary width,
penalty weight, as reference.py does for the price) and the protected lattice `om._lattice` (read only, through
its opt-in step-2 node output for gamma), each within its own budget, and the two within 0.1·tol_G of each other.
An FD study alone is never a reference for an FD quantity, whatever its resolution ("not independently
corroborated"). The Tier 2 lattice price is scored against reference.py's FD price reference, which is FD only.

Uncertainty budgets (DR-09), in units of tol_G: FD refinement u_FD,ref ≤ 0.07 and bump u_FD,bump ≤ 0.03; lattice
sequence u_L,seq ≤ 0.07 and bump u_L,bump ≤ 0.03 (zero for node gamma, the price and theta). Every refinement
estimate is floored at REF_FLOOR = 0.02·tol_G (the production floor 0.1·tol_G never applies here). Resolved:
both sides within budget, no study flagged, |R_FD − G_L| ≤ 0.1·tol_G; then R = R_FD and u = max(u_FD, |R_FD − G_L|).

Work (section 12): every FD solve and every lattice call goes through one per-context budget, charged before the
solve allocates or runs; at exhaustion the quantity is unresolved "reference work cap" and its study stops. The
stated ceiling is therefore exact, initial studies included. Configuration values marked placeholder are set by
the dev pilot and the calibration, then frozen.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om

from . import reference as ref

PRICE = "price"
QUANTITIES = (PRICE,) + G.GREEKS

REF_FLOOR = 0.02      # of tol_G, both sides
U_REF_MAX = 0.07      # refinement budget, both sides
U_BUMP_MAX = 0.03     # bump budget, both sides
AGREE = 0.1           # |R_FD − G_L| and the resolved u, at most this of tol_G
NODE_ZONE = 5.0       # price tolerances: a step-2 node this close to its exercise value is "near"
LATTICE_F = 3.0       # the Phase 2 envelope estimator's factor (phase2-freeze-2.json, F)
LATTICE_SCHEDULE = "multiples"   # the Phase 2 schedule (phase2-freeze-2.json): N_k = steps_for(days)·k, k ≤ 6
MIN_LEVELS = oa.MIN_LEVELS
REF_WORK_CAP = 2e10   # placeholder: FD cells plus lattice units per context, set from the dev pilot's costs

RESOLVED = "resolved"
R_CAP = "reference work cap"
R_NOT_CORROBORATED = "not independently corroborated"
R_NODE_NEAR = "lattice node gamma near an exercise decision"
R_LATTICE_SHORT = "the lattice schedule cannot reach four levels"
R_NOT_APPLICABLE = "not applicable"


class CapHit(Exception):
    pass


class RefBudget:
    """One aggregate budget per context across every quantity and state: FD cells (m + 1)·steps and lattice units
    steps²/2, each charged before the call runs."""

    def __init__(self, cap: float = REF_WORK_CAP):
        self.cap = float(cap)
        self.used = 0.0
        self.fd_solves = 0
        self.lattice_calls = 0

    def take(self, units: float) -> None:
        if self.used + units > self.cap:
            raise CapHit(f"{units:.3g} more with {self.used:.3g} of {self.cap:.3g} used")
        self.used += units


@dataclass(frozen=True)
class Key:
    m: int
    p: int
    w: float
    pen: float


class Runner:
    """The budgeted, cached solves of one context's references. Each state is a full om.Context (spot held)."""

    def __init__(self, budget: RefBudget, american: bool = True):
        self.budget = budget
        self.american = american
        self._fd: dict = {}
        self._lat: dict = {}
        self.penalty_misses = 0

    def fd(self, s: om.Context, k: Key) -> dict:
        key = (s, k)
        if key not in self._fd:
            self.budget.take(fd.solve_units(k.m, k.p, s.days))
            self.budget.fd_solves += 1
            dg, gr = {}, {}
            v, d = fd.solve(s.is_call, s.spot, s.strike, s.days, s.rho, s.q, s.sigma, s.divs, k.m, k.p, k.w,
                            american=self.american, penalty=k.pen, diag=dg, grids=gr)
            self.penalty_misses += dg.get("penalty_unconverged", 0)
            self._fd[key] = {"value": float(v), "delta": float(d), "xs": gr["xs"], "v0": gr["v0"]}
        return self._fd[key]

    def lattice(self, s: om.Context, mult: int, nodes: bool = False) -> dict:
        steps = om.steps_for(s.days) * mult
        key = (s, steps, nodes)
        if key not in self._lat:
            self.budget.take(oa.units(steps))
            self.budget.lattice_calls += 1
            args = ([s.is_call], [s.strike / s.spot], np.array([s.rho]), np.array([s.q]), np.array([s.sigma]),
                    [[(dd, a / s.spot) for dd, a in s.divs]], s.days, steps)
            if nodes:
                v, d, _, h, nd = om._lattice(*args, with_cont=True, with_nodes=True)
            else:
                v, d, _, h = om._lattice(*args, with_cont=True)
                nd = None
            self._lat[key] = {"value": float(v[0]) * s.spot, "cont": float(h[0]) * s.spot, "steps": steps,
                              "nodes": None if nd is None else {k: np.asarray(a[0]) for k, a in nd.items()}}
        return self._lat[key]


# ── the quantities, per state set ──────────────────────────────────────────

def _value(r: Runner, s: om.Context, k: Key) -> float:
    if s.days == 0:
        return G.intrinsic(s)
    return r.fd(s, k)["value"]


def node_gamma(nodes: dict, c: om.Context, price: float, zone: float = NODE_ZONE) -> float | str:
    """Γ in $ from the lattice's three step-2 nodes (design section 7.2): the second derivative of the quadratic
    through them, per unit S, divided by S; 0 exactly when all three are exercised and clear; the unresolved
    reason when the nodes straddle the exercise decision or any is within `zone` price tolerances of it."""
    sgn = 1.0 if c.is_call else -1.0
    s, v, cont, ex = (np.asarray(nodes[k], dtype=float) for k in ("spot", "value", "cont", "exercise"))
    ptol = om.tolerance(price, c.spot)
    exv = sgn * (s - c.strike / c.spot) * c.spot
    flags = np.asarray(nodes["exercise"], dtype=bool)
    if flags.any() and not flags.all():
        return R_NODE_NEAR
    if np.any(np.abs(cont * c.spot - exv) <= zone * ptol):
        return R_NODE_NEAR
    if flags.all():
        return 0.0
    a = (v[2] - v[1]) / (s[2] - s[1])
    b = (v[1] - v[0]) / (s[1] - s[0])
    return float(2.0 * (a - b) / (s[2] - s[0])) / c.spot


@dataclass(frozen=True)
class Spec:
    """One quantity's reference definition: its states and how a level's value is formed from them."""
    name: str
    states: tuple            # every state the FD and lattice sides solve, for the domain test
    h: float | None = None   # h_ref for bumped Greeks


def spec(c: om.Context, name: str, cfg: G.GreekConfig) -> Spec | str:
    """The quantity's states, or why it has no reference (not applicable, or a state outside the domain)."""
    if name == PRICE or name == G.GAMMA:
        return Spec(name, (c,))
    if name == G.THETA:
        if c.divs and min(d for d, _ in c.divs) == 0:
            return f"{R_NOT_APPLICABLE}: {G.R_EXDIV}"
        s1 = G.one_day_later(c)
        return Spec(name, (c, s1)) if G.state_failure(s1) is None else G.R_BUMP_DOMAIN
    if name == G.DIVIDEND and not c.divs:
        return f"{R_NOT_APPLICABLE}: {G.R_NO_DIVIDEND}"
    h = G.bump_size(c, name, cfg) / 2.0          # h_ref: the frozen production bump halved
    states = tuple(G.bumped(c, name, f * h) for f in (1.0, -1.0, 0.5, -0.5))
    if any(G.state_failure(s) is not None for s in states):
        return G.R_BUMP_DOMAIN
    return Spec(name, states, h)


def _fd_q(r: Runner, c: om.Context, sp: Spec, k: Key, half: bool = False) -> float:
    if sp.name == PRICE:
        return _value(r, c, k)
    if sp.name == G.GAMMA:
        got = r.fd(c, k)
        return G.gamma_s_form(got["xs"], got["v0"], k.m // 2)
    if sp.name == G.THETA:
        return _value(r, sp.states[1], k) - _value(r, c, k)
    up, dn = (sp.states[2], sp.states[3]) if half else (sp.states[0], sp.states[1])
    h = sp.h / 2.0 if half else sp.h
    return (_value(r, up, k) - _value(r, dn, k)) / (2.0 * h) * G.UNIT[sp.name]


def _lat_value(r: Runner, s: om.Context, mult: int) -> float:
    return G.intrinsic(s) if s.days == 0 else r.lattice(s, mult)["value"]


def _lat_q(r: Runner, c: om.Context, sp: Spec, mult: int, half: bool = False) -> float | str:
    if sp.name == PRICE:
        return r.lattice(c, mult)["cont"]          # the continuation; the value is max(X, extrapolated), as Tier 2
    if sp.name == G.GAMMA:
        got = r.lattice(c, mult, nodes=True)
        return node_gamma(got["nodes"], c, got["value"])
    if sp.name == G.THETA:
        return _lat_value(r, sp.states[1], mult) - _lat_value(r, c, mult)
    up, dn = (sp.states[2], sp.states[3]) if half else (sp.states[0], sp.states[1])
    h = sp.h / 2.0 if half else sp.h
    return (_lat_value(r, up, mult) - _lat_value(r, dn, mult)) / (2.0 * h) * G.UNIT[sp.name]


def _tol(name: str, value: float, spot: float) -> float:
    return om.tolerance(value, spot) if name == PRICE else G.tolerance(name, value, spot)


# ── the FD side: reference.py's study, run on the quantity itself ──────────

def fd_study(r: Runner, c: om.Context, sp: Spec, escalate: bool = True) -> dict:
    """R_FD, u_FD,ref (time, space, width, penalty; GCI, the time order capped at 1 for American values),
    u_FD,bump and the flags. Raises CapHit when the budget runs out."""
    m0, p0, w = fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, fd.pv_owed(c.divs, c.rho, 0.0))
    m0 -= m0 % 16
    t_levels, s_levels = [p0 // 2, p0, 2 * p0], [m0 // 4, m0 // 2, m0]
    steps = {"time": 0, "space": 0}

    def q(m, p, ww=w, pen=fd.PENALTY):
        return _fd_q(r, c, sp, Key(m, p, ww, pen))

    def assess():
        pt, ms = t_levels[-3:], s_levels[-3:]
        base = q(m0, pt[-1])
        # rounding-level changes have no order: the price's floor is 1e-12·S as in reference.py, a Greek's
        # 1e-12 of the larger of its value and its tolerance
        flat = 1e-12 * (c.spot if sp.name == PRICE else max(abs(base), _tol(sp.name, base, c.spot)))
        t = ref.gci(*(q(m0, x) for x in pt), flat,
                    cap=ref.ORDER_CAP_TIME_AMERICAN if r.american else ref.ORDER_CAP)
        sp_ = ref.gci(*(q(x, p0) for x in ms), flat)
        s_corr = q(ms[-1], p0) - q(m0, p0) + sp_["corr"]
        w1 = abs(q(3 * m0 // 4, p0, ref.WIDTH_FACTOR * w) - q(m0 // 2, p0, w))
        w2 = abs(q(9 * m0 // 8, p0, ref.WIDTH_FACTOR ** 2 * w) - q(3 * m0 // 4, p0, ref.WIDTH_FACTOR * w))
        u_p = abs(q(m0 // 4, p0, w, ref.PENALTY_LOW) - q(m0 // 4, p0, w)) / (fd.PENALTY / ref.PENALTY_LOW - 1.0)
        R = base + t["corr"] + s_corr
        tol = _tol(sp.name, R, c.spot)
        u_ref = max(t["u"] + sp_["u"] + w1 + w2 + u_p, REF_FLOOR * tol)
        flags = [f"{sp.name} {x[1]['kind']} in {x[0]}" for x in (("time", t), ("space", sp_))
                 if x[1]["kind"] in ref.BAD_KINDS and x[1]["u"] > ref.NEGLIGIBLE * U_REF_MAX * tol]
        if w2 > ref.WIDTH_SETTLED * w1 and w2 > ref.NEGLIGIBLE * U_REF_MAX * tol:
            flags.append(f"{sp.name} boundary not settled")
        pe = max(fd.peclet(s.rho, s.q, s.sigma, ms[0], w) for s in sp.states if s.days > 0)
        if pe > fd.PECLET_MONOTONE:
            flags.append(f"convection-dominated: cell Péclet {pe:.3g} on the coarsest space level")
        u_bump = 0.0
        if sp.h is not None:
            u_bump = abs(q(m0, pt[-1]) - _fd_q(r, c, sp, Key(m0, pt[-1], w, fd.PENALTY), half=True))
        return {"R": R, "u_ref": u_ref, "u_bump": u_bump, "tol": tol, "time": t, "space": sp_,
                "width_steps": [w1, w2], "u_penalty": u_p, "raw_finest": base, "flags": flags}

    out = assess()
    while escalate and (out["flags"] or out["u_ref"] > U_REF_MAX * out["tol"]):
        convective = any("convection-dominated" in f for f in out["flags"])
        dims = sorted((d for d in ("time", "space") if steps[d] < ref.ESCALATE_MAX),
                      key=lambda d: (not (convective and d == "space"), -out[d]["u"]))
        if not dims or sum(out["width_steps"]) + out["u_penalty"] > U_REF_MAX * out["tol"]:
            break
        d = dims[0]
        if d == "time":
            t_levels.append(2 * t_levels[-1])
        else:
            s_levels.append(2 * s_levels[-1])
        steps[d] += 1
        out = assess()
    out["grid"] = {"m": m0, "p": p0, "width": w, "time_levels": list(t_levels), "space_levels": list(s_levels),
                   "escalations": steps}
    return out


# ── the lattice side: the Phase 2 schedule and envelope estimator on the quantity ──

def lattice_seq(r: Runner, c: om.Context, sp: Spec, tol: float) -> dict:
    """G_L and u_L,seq from the quantity formed at each lattice level (never the states' estimates added),
    u_L,bump at the finest level run, and the flags. Raises CapHit when the budget runs out."""
    ms_all = oa.multipliers(LATTICE_SCHEDULE, om.steps_for(c.days))
    ms, ys, flags = [], [], []
    for mult in ms_all:
        if any(s.days > 0 and oa.units(om.steps_for(s.days) * mult) > om.REFINE_UNITS_MAX for s in sp.states):
            break
        y = _lat_q(r, c, sp, mult)
        if isinstance(y, str):
            return {"G": None, "u_seq": None, "u_bump": None, "flags": [y], "levels": ms + [mult], "values": ys}
        ms.append(mult)
        ys.append(y)
    if len(ms) < MIN_LEVELS:
        return {"G": None, "u_seq": None, "u_bump": None, "flags": [R_LATTICE_SHORT], "levels": ms, "values": ys}
    g, e, bs = oa.envelope(ms, ys)
    if sp.name == PRICE:   # Tier 2's own reading: the continuation extrapolated, then the exercise value's floor
        sgn = 1.0 if c.is_call else -1.0
        g = max(sgn * (c.spot - c.strike), g)
    u_seq = max(LATTICE_F * e, REF_FLOOR * tol)
    u_bump = 0.0
    if sp.h is not None:
        u_bump = abs(ys[-1] - _lat_q(r, c, sp, ms[-1], half=True))
    return {"G": g, "u_seq": u_seq, "u_bump": u_bump, "E": e, "flags": flags, "levels": ms, "values": ys,
            "extrapolations": bs}


# ── combining the two sides (pure) ─────────────────────────────────────────

def resolve(tol: float, f: dict, lat: dict | None) -> dict:
    """The reference (R, u) when both sides meet their budgets, nothing is flagged and they agree within
    0.1·tol_G; otherwise unresolved with every failing condition named. `lat` None: FD only, which never
    resolves an FD quantity (section 7.1)."""
    why = list(f.get("flags", []))
    if f["u_ref"] > U_REF_MAX * tol:
        why.append("FD refinement uncertainty above 0.07 tolerances")
    if f["u_bump"] > U_BUMP_MAX * tol:
        why.append("FD bump term above 0.03 tolerances")
    out = {"tol": tol, "R_FD": f["R"], "u_FD": f["u_ref"] + f["u_bump"]}
    if lat is None:
        why.append(R_NOT_CORROBORATED)
        return {**out, "status": "unresolved: " + "; ".join(why), "R": None, "u": None}
    why += list(lat.get("flags", []))
    if lat.get("G") is not None:
        if lat["u_seq"] > U_REF_MAX * tol:
            why.append("lattice sequence uncertainty above 0.07 tolerances")
        if lat["u_bump"] > U_BUMP_MAX * tol:
            why.append("lattice bump term above 0.03 tolerances")
        diff = abs(f["R"] - lat["G"])
        out.update(G_L=lat["G"], u_L=lat["u_seq"] + lat["u_bump"], diff=diff)
        if diff > AGREE * tol:
            why.append("FD and lattice differ by more than 0.1 tolerances")
    if why:
        return {**out, "status": "unresolved: " + "; ".join(why), "R": None, "u": None}
    u = max(out["u_FD"], out["diff"])
    return {**out, "status": RESOLVED, "R": f["R"], "u": u}


def score(g: float, R: float, u: float, tol: float) -> str:
    """Section 7.2, item 4: pass within tol − u, confirmed failure beyond tol + u, a straddle in between."""
    d = abs(g - R)
    if d <= tol - u:
        return "pass"
    if d > tol + u:
        return "fail"
    return "straddle"


# ── one context ────────────────────────────────────────────────────────────

def references(c: om.Context, cfg: G.GreekConfig = G.GreekConfig(), quantities=QUANTITIES, american: bool = True,
               cap: float = REF_WORK_CAP) -> dict:
    """Every requested quantity's reference for context c, under one aggregate budget. `american=False` is the
    C2 FD adequacy control: the FD study in European mode, no lattice side, scored against closed forms."""
    t0 = time.time()
    budget = RefBudget(cap)
    r = Runner(budget, american)
    out: dict = {}
    bad = G.state_failure(c)
    for name in quantities:
        if bad is not None or c.days == 0:
            out[name] = {"status": f"unresolved: {bad or G.R_EXPIRY}"}
            continue
        sp = spec(c, name, cfg)
        if isinstance(sp, str):
            out[name] = {"status": f"unresolved: {sp}"}
            continue
        misses = r.penalty_misses
        try:
            f = fd_study(r, c, sp)
            if r.penalty_misses > misses:
                f["flags"].append(f"penalty iteration cap hit on {r.penalty_misses - misses} steps")
            if not american:
                out[name] = {"status": "FD only (European control)", "fd": f, "R_FD": f["R"],
                             "u_FD": f["u_ref"] + f["u_bump"], "tol": f["tol"]}
                continue
            lat = lattice_seq(r, c, sp, f["tol"])
        except CapHit as e:
            out[name] = {"status": f"unresolved: {R_CAP}", "detail": str(e)}
            continue
        res = resolve(f["tol"], f, lat)
        out[name] = {**res, "fd": f, "lattice": lat}
    out["_work"] = {"used": budget.used, "cap": budget.cap, "fd_solves": budget.fd_solves,
                    "lattice_calls": budget.lattice_calls, "secs": time.time() - t0}
    return out
