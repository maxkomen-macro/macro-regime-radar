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

Amendment P3-AM2 (design-P3-AM2-approved.md): a second corroborator Q, the same model solved by QuantLib's own
FDM kernel (ql_escrowed.py), runs for every quantity. Resolved when the FD side meets its budgets, at least one
qualified corroborator (lattice or Q, each within its own budgets and unflagged) agrees within 0.1·tol_G, and no
qualified corroborator disagrees ("corroborators disagree"); R = R_FD, u = max(u_FD, the agreeing differences).

Work (section 12): every FD solve and every lattice call goes through one per-context budget, charged before the
solve allocates or runs; at exhaustion the quantity is unresolved "reference work cap" and its study stops. The
stated ceiling is therefore exact, initial studies included. Configuration values marked placeholder are set by
the dev pilot and the calibration, then frozen.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, replace

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om

from . import ql_escrowed as qe
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
SPACE_ESCALATE_MAX = 5   # P3-AM6 B.1: total space escalations of an extended FD study (the shallow study's limit
                         # stays reference.ESCALATE_MAX = 2 per dimension; time is never extended)

RESOLVED = "resolved"
R_CAP = "reference work cap"
R_DEEP_CAP = "deeper study stopped at the reference work cap"   # P3-AM6 B.3: the pass-1 result stands
R_READ = "FD bump read outside the grid"                        # P3-AM6 B.4
R_NOT_CORROBORATED = "not independently corroborated"
R_NODE_NEAR = "lattice node gamma near an exercise decision"
R_LATTICE_SHORT = "the lattice schedule cannot reach four levels"
R_NOT_APPLICABLE = "not applicable"
R_DISAGREE = "corroborators disagree"
CORROBORATE_Q = True   # P3-AM2: Q (QuantLib-kernel solve of the same model) runs for every quantity


class CapHit(Exception):
    pass


class ReadOutside(Exception):
    """P3-AM6 B.4: a moved bump state's read point lies outside its solved grid's interior."""


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

    def __init__(self, budget: RefBudget, american: bool = True, smooth_divs: bool = False):
        self.budget = budget
        self.american = american
        self.smooth_divs = smooth_divs   # the lattice side's dividend smoothing: frozen at calibration (V-3)
        self._fd: dict = {}
        self._lat: dict = {}
        self.penalty_misses = 0
        self._track: set | None = None   # P3-AM6 (design review DR-AM6-8): the FD solves a study consumes

    def track(self) -> None:
        """Start recording every FD solve read, cache hits included, for `penalty_in_tracked`."""
        self._track = set()

    def penalty_in_tracked(self) -> int:
        """Stop recording; the penalty-iteration misses of every solve read since `track`, cache hits included, so
        a study that reuses another quantity's unconverged solve is flagged whatever the order (DR-AM6-8)."""
        keys, self._track = self._track or set(), None
        return sum(self._fd[k]["penalty_unconverged"] for k in keys if k in self._fd)

    def fd(self, s: om.Context, k: Key) -> dict:
        key = (s, k)
        if key not in self._fd:
            self.budget.take(fd.solve_units(k.m, k.p, s.days))
            self.budget.fd_solves += 1
            dg, gr = {}, {}
            v, d = fd.solve(s.is_call, s.spot, s.strike, s.days, s.rho, s.q, s.sigma, s.divs, k.m, k.p, k.w,
                            american=self.american, penalty=k.pen, diag=dg, grids=gr)
            self.penalty_misses += dg.get("penalty_unconverged", 0)
            self._fd[key] = {"value": float(v), "delta": float(d), "x": gr["x"], "xs": gr["xs"], "v0": gr["v0"],
                           "free0": gr["free0"], "penalty_unconverged": int(dg.get("penalty_unconverged", 0))}
        if self._track is not None:
            self._track.add(key)
        return self._fd[key]

    def lattice(self, s: om.Context, mult: int, nodes: bool = False) -> dict:
        steps = om.steps_for(s.days) * mult
        key = (s, steps, nodes, self.smooth_divs)
        if key not in self._lat:
            self.budget.take(oa.units(steps))
            self.budget.lattice_calls += 1
            args = ([s.is_call], [s.strike / s.spot], np.array([s.rho]), np.array([s.q]), np.array([s.sigma]),
                    [[(dd, a / s.spot) for dd, a in s.divs]], s.days, steps)
            if nodes:
                v, d, _, h, nd = om._lattice(*args, with_cont=True, smooth_divs=self.smooth_divs, with_nodes=True)
            else:
                v, d, _, h = om._lattice(*args, with_cont=True, smooth_divs=self.smooth_divs)
                nd = None
            self._lat[key] = {"value": float(v[0]) * s.spot, "cont": float(h[0]) * s.spot, "steps": steps,
                              "nodes": None if nd is None else {k: np.asarray(a[0]) for k, a in nd.items()}}
        return self._lat[key]


# ── the quantities, per state set ──────────────────────────────────────────

def _value(r: Runner, s: om.Context, k: Key) -> float:
    if s.days == 0:
        return G.intrinsic(s)
    return r.fd(s, k)["value"]


def _value_on_base_grid(r: Runner, c: om.Context, s: om.Context, k: Key) -> float:
    """P3-AM4 change 3: a bump state's FD value on the base context's grid. The kernel centres its ln X grid at
    x* = S − PV_0 of the state it solves, so a bump that moves PV_0 (the dividend amount; the rate, when dividends
    are owed) shifts the state's whole grid against the strike and the exercise boundary by a fraction of a cell
    that changes with every space level: the difference quotient then carries that shift's grid noise over 2h.
    Here the unchanged kernel solves s at S' = S + PV_s − PV_c, whose x* is the base's, so every state of the
    stencil shares the base grid's nodes (as Q's mesh is held fixed across the stencil, P3-AM2 B), and the value
    at s's own X_0 = S − PV_s is read by the cubic through the four nodes around it. A state whose PV_0 equals the
    base's (the volatility bump) is solved as before, at its own centre node."""
    if s.days == 0:
        return G.intrinsic(s)
    pv_s, pv_c = fd.pv_owed(s.divs, s.rho, 0.0), fd.pv_owed(c.divs, c.rho, 0.0)
    if pv_s == pv_c:
        return r.fd(s, k)["value"]
    got = r.fd(replace(s, spot=c.spot - pv_c + pv_s), k)
    x1 = math.log(s.spot - pv_s)
    if not (got["x"][1] <= x1 <= got["x"][-2]):      # P3-AM6 B.4: an interpolation, never an extrapolation
        raise ReadOutside(f"ln X_0 {x1:.6g} outside [{got['x'][1]:.6g}, {got['x'][-2]:.6g}]")
    if not r.american:
        return G.cubic_at(got["x"], got["v0"], x1)
    # American (design review DR-AM4-2): v0 = max(free0, exercise value) is only C⁰ where the projection binds at
    # t = 0 (at a day-0 dividend close the cum obstacle lies above the ex-dividend one held inside the solve), so
    # the cubic reads the continuation free0 (C¹ at its own boundary) and the exact exercise value is applied at
    # the read point: the kernel's own projection, max(V, sgn·(X + PV_0 − K)⁺) = max(V, intrinsic at S)
    return max(G.cubic_at(got["x"], got["free0"], x1), G.intrinsic(s))


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
    return (_value_on_base_grid(r, c, up, k) - _value_on_base_grid(r, c, dn, k)) / (2.0 * h) * G.UNIT[sp.name]


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

def fd_study(r: Runner, c: om.Context, sp: Spec, escalate: bool = True, extend: dict | None = None,
             space_max: int = SPACE_ESCALATE_MAX, force: bool = False) -> dict:
    """R_FD, u_FD,ref (time, space, width, penalty; GCI, the time order capped at 1 for American values),
    u_FD,bump and the flags. Raises CapHit when the budget runs out.

    `extend` (P3-AM6 B.1): a shallow study's result that `extension_eligible` admits. The study then resumes from
    its final levels and adds space levels only, one doubling at a time, while the same trigger holds, the
    width-and-penalty stop does not fire and fewer than SPACE_ESCALATE_MAX space escalations have run; the flags are
    the final assessment's (the caller adds penalty misses), and the shallow result is kept under "shallow".
    `space_max` and `force` serve the forced C2-FD control only (controls_p3.c2_fd_forced): the extension runs to
    `space_max` space escalations in total whatever the trigger says (the width-and-penalty stop still applies).
    References always use the defaults."""
    m0, p0, w = fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, fd.pv_owed(c.divs, c.rho, 0.0))
    m0 -= m0 % 16
    if extend is None:
        t_levels, s_levels = [p0 // 2, p0, 2 * p0], [m0 // 4, m0 // 2, m0]
        steps = {"time": 0, "space": 0}
    else:
        g = extend["grid"]
        t_levels, s_levels, steps = list(g["time_levels"]), list(g["space_levels"]), dict(g["escalations"])

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
            # P3-AM3 change 3: on the finest grid the study ran (finest space and time level). At a coarse space
            # level the difference |G(h_ref) − G(h_ref/2)| is mostly the exercise boundary's position between
            # nodes, which falls with space refinement and is already in the space study's u; on the finest grid
            # it measures the bump's own truncation
            mb, pb = s_levels[-1], t_levels[-1]
            u_bump = abs(q(mb, pb) - _fd_q(r, c, sp, Key(mb, pb, w, fd.PENALTY), half=True))
        return {"R": R, "u_ref": u_ref, "u_bump": u_bump, "tol": tol, "time": t, "space": sp_,
                "width_steps": [w1, w2], "u_penalty": u_p, "raw_finest": base, "flags": flags}

    out = assess()
    if extend is not None:
        while ((force or _over(out)) and steps["space"] < space_max
               and sum(out["width_steps"]) + out["u_penalty"] <= U_REF_MAX * out["tol"]):
            s_levels.append(2 * s_levels[-1])
            steps["space"] += 1
            out = assess()
        out["grid"] = {"m": m0, "p": p0, "width": w, "time_levels": list(t_levels), "space_levels": list(s_levels),
                       "escalations": steps}
        out["shallow"] = {k: v for k, v in extend.items() if k != "shallow"}
        return out
    while escalate and (out["flags"] or out["u_ref"] > U_REF_MAX * out["tol"]
                        or out["u_bump"] > U_BUMP_MAX * out["tol"]):
        # space first when the flow is convective, and (P3-AM3 change 3) when the bump term is over its budget
        space_first = (any("convection-dominated" in f for f in out["flags"])
                       or out["u_bump"] > U_BUMP_MAX * out["tol"])
        dims = sorted((d for d in ("time", "space") if steps[d] < ref.ESCALATE_MAX),
                      key=lambda d: (not (space_first and d == "space"), -out[d]["u"]))
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


def _over(out: dict) -> bool:
    """The FD side over budget or flagged: the shallow loop's own trigger."""
    return bool(out["flags"] or out["u_ref"] > U_REF_MAX * out["tol"] or out["u_bump"] > U_BUMP_MAX * out["tol"])


def extension_eligible(f: dict) -> bool:
    """P3-AM6 B.3 pass 2, the FD test: a completed shallow study over budget or flagged, both counters at the
    shallow limit, not stopped on the width-and-penalty test, and no pass-1 penalty flag (which no deeper level can
    clear). Whether the reference resolved plays no part."""
    g = f.get("grid", {}).get("escalations", {})
    return (_over(f) and g.get("time") == ref.ESCALATE_MAX and g.get("space") == ref.ESCALATE_MAX
            and sum(f["width_steps"]) + f["u_penalty"] <= U_REF_MAX * f["tol"]
            and not any(x.startswith("penalty iteration cap hit") for x in f["flags"]))


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

def resolve(tol: float, f: dict, lat: dict | None, q: dict | None = None) -> dict:
    """The reference (R, u) when both sides meet their budgets, nothing is flagged and they agree within
    0.1·tol_G; otherwise unresolved with every failing condition named. `lat` None: FD only, which never
    resolves an FD quantity (section 7.1).

    With `q` (amendment P3-AM2, section D): the FD side must meet its budgets; a corroborator (the lattice or
    Q) is qualified when it meets its own budgets and nothing is flagged, and agrees when |R_FD − G| ≤ 0.1·tol.
    Resolved when at least one qualified corroborator agrees and no qualified corroborator disagrees; a
    qualified disagreement is "corroborators disagree" whatever the other says. R = R_FD; u = max(u_FD, the
    agreeing corroborators' differences)."""
    if q is None:
        return _resolve_lattice_only(tol, f, lat)
    fd_why = list(f.get("flags", []))
    if f["u_ref"] > U_REF_MAX * tol:
        fd_why.append("FD refinement uncertainty above 0.07 tolerances")
    if f["u_bump"] > U_BUMP_MAX * tol:
        fd_why.append("FD bump term above 0.03 tolerances")
    out = {"tol": tol, "R_FD": f["R"], "u_FD": f["u_ref"] + f["u_bump"]}
    sides = {}
    for name, side, u_key in (("lattice", lat, "u_seq"), ("Q", q, "u_ref")):
        if side is None:
            continue
        why = list(side.get("flags", []))
        if side.get("G") is not None:
            if side[u_key] is not None and side[u_key] > U_REF_MAX * tol:
                why.append(f"{name} {'sequence' if name == 'lattice' else 'refinement'} uncertainty above 0.07 tolerances")
            if side["u_bump"] is not None and side["u_bump"] > U_BUMP_MAX * tol:
                why.append(f"{name} bump term above 0.03 tolerances")
            diff = abs(f["R"] - side["G"])
        else:
            diff = None
        why = list(dict.fromkeys(why))
        qualified = side.get("G") is not None and side.get(u_key) is not None and not why
        sides[name] = {"qualified": qualified, "agrees": qualified and diff <= AGREE * tol, "diff": diff,
                       "why": why}
    if lat is not None and lat.get("G") is not None:
        out.update(G_L=lat["G"], u_L=lat["u_seq"] + lat["u_bump"], diff=sides["lattice"]["diff"])
    if q.get("G") is not None:
        out.update(G_Q=q["G"], u_Q=None if q["u_ref"] is None else q["u_ref"] + q["u_bump"],
                   diff_Q=sides["Q"]["diff"])
    out["corroborators"] = {k: {kk: v[kk] for kk in ("qualified", "agrees", "why")} for k, v in sides.items()}
    agreeing = [k for k, v in sides.items() if v["agrees"]]
    disagreeing = [k for k, v in sides.items() if v["qualified"] and not v["agrees"]]
    why = list(fd_why)
    if disagreeing:
        why.append(R_DISAGREE + ": " + ", ".join(f"FD and {k} differ by {sides[k]['diff'] / tol:.3g} tolerances"
                                                 for k in disagreeing))
    elif not agreeing:
        for k, v in sides.items():
            why += v["why"] or ([f"FD and {k} differ by more than 0.1 tolerances"] if v["qualified"] else [])
        if not sides:
            why.append(R_NOT_CORROBORATED)
    if why:
        return {**out, "status": "unresolved: " + "; ".join(why), "R": None, "u": None}
    u = max([out["u_FD"]] + [sides[k]["diff"] for k in agreeing])
    return {**out, "status": RESOLVED, "R": f["R"], "u": u, "corroborated_by": agreeing}


def _resolve_lattice_only(tol: float, f: dict, lat: dict | None) -> dict:
    """The approved design's rule (7.2 item 3) with the lattice as the only corroborator, unchanged."""
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

def _fd_only(f: dict) -> dict:
    return {"status": "FD only (European control)", "fd": f, "R_FD": f["R"], "u_FD": f["u_ref"] + f["u_bump"],
            "tol": f["tol"]}


def references(c: om.Context, cfg: G.GreekConfig = G.GreekConfig(), quantities=QUANTITIES, american: bool = True,
               cap: float = REF_WORK_CAP, smooth_divs: bool = False, corroborate_q: bool | None = None,
               extend: bool = True) -> dict:
    """Every requested quantity's reference for context c, under one aggregate budget. `american=False` is the
    C2 FD adequacy control: the FD study in European mode, no lattice side, scored against closed forms.
    `corroborate_q` (default CORROBORATE_Q): Q runs for every quantity and section D of P3-AM2 resolves."""
    t0 = time.time()
    budget = RefBudget(cap)
    r = Runner(budget, american, smooth_divs)
    use_q = CORROBORATE_Q if corroborate_q is None else corroborate_q
    q_cache: dict = {}
    q_cells = [0.0]

    def q_take(units: float) -> None:
        budget.take(units)
        q_cells[0] += units
    out: dict = {}
    passes: dict = {}
    bad = G.state_failure(c)
    for name in quantities:
        if bad is not None or c.days == 0:
            out[name] = {"status": f"unresolved: {bad or G.R_EXPIRY}"}
            continue
        sp = spec(c, name, cfg)
        if isinstance(sp, str):
            out[name] = {"status": f"unresolved: {sp}"}
            continue
        r.track()
        try:
            try:
                f = fd_study(r, c, sp)
            finally:
                misses = r.penalty_in_tracked()
            if misses:
                f["flags"].append(f"penalty iteration cap hit on {misses} steps")
            if not american:
                out[name] = _fd_only(f)
                passes[name] = (sp, f, None, None)
                continue
            lat = lattice_seq(r, c, sp, f["tol"])
            qs = qe.study(c, sp, f["tol"], True, q_take, q_cache) if use_q else None
        except CapHit as e:
            out[name] = {"status": f"unresolved: {R_CAP}", "detail": str(e)}
            continue
        except ReadOutside as e:            # P3-AM6 B.4: the FD side cannot read this quantity; never extrapolated
            out[name] = {"status": f"unresolved: {R_READ}", "detail": str(e)}
            continue
        res = resolve(f["tol"], f, lat, qs)
        out[name] = {**res, "fd": f, "lattice": lat}
        if qs is not None:
            out[name]["q"] = qs
        passes[name] = (sp, f, lat, qs)
    # P3-AM6 B.3 pass 2: the extensions, in quantity order, with whatever budget pass 1 left; a quantity whose
    # extension hits the cap keeps its pass-1 result
    for name, (sp, f, lat, qs) in passes.items():
        do_fd = extend and extension_eligible(f)
        do_q = extend and qs is not None and qe.extra_eligible(qs)
        if not (do_fd or do_q):
            continue
        try:
            if do_fd:
                r.track()
                try:
                    f2 = fd_study(r, c, sp, extend=f)
                finally:
                    misses = r.penalty_in_tracked()
                if misses:   # every solve the extended study read, the shallow levels' included (DR-AM6-8)
                    f2["flags"].append(f"penalty iteration cap hit on {misses} steps (deeper study)")
            else:
                f2 = f
            qs2 = qe.study(c, sp, f["tol"], True, q_take, q_cache, extend=qs) if do_q else qs
        except (CapHit, ReadOutside) as e:  # the pass-1 result stands, with the reason the extension stopped
            why = R_DEEP_CAP if isinstance(e, CapHit) else f"deeper study stopped: {R_READ}"
            out[name] = {**out[name], "deep": {"status": why, "detail": str(e)}}
            continue
        if not american:
            out[name] = _fd_only(f2)
            continue
        res = resolve(f2["tol"], f2, lat, qs2)
        out[name] = {**res, "fd": f2, "lattice": lat}
        if qs2 is not None:
            out[name]["q"] = qs2
    out["_work"] = {"used": budget.used, "cap": budget.cap, "fd_solves": budget.fd_solves,
                    "lattice_calls": budget.lattice_calls, "q_cells": q_cells[0], "secs": time.time() - t0}
    return out
