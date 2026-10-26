"""scripts/options_bench/reference.py — reference values with an estimated uncertainty (test tooling).

The reference for a case is the bench's own finite-difference solver (fd.py), refined independently in each
numerical dimension, with an uncertainty from the observed refinement behaviour. It is not certified: the
uncertainty is an estimate (Roache's grid-convergence index), stated as such, and conservative by
construction (a sum of per-dimension estimates, each with a safety factor).

Refinement study, for the value and for delta:
- time: steps per day p/2, p, 2p on the finest grid. Observed order from the three levels; Richardson
  correction with the order capped at 2 (a smaller order gives a larger estimate); uncertainty 1.25 times the
  correction (GCI, three levels). Oscillating or non-convergent levels get no correction and a wider estimate,
  and non-convergence or an observed order below 0.5 leaves the reference unresolved.
- space: grids M/4, M/2, M at p steps per day, the same rule; the correction is added to the time-refined
  value (an additive-error assumption, stated in the manifest).
- boundary: the half-width times 1.5 at the same spacing (M/2 grid); uncertainty is the whole change.
- penalty: weight 1e7 against 1e9 (M/4 grid); the error scales as 1/weight, so the estimate is the change
  over 99.

A reference is reliable when its uncertainty is at most REF_FRACTION of the tolerance it is used to judge
(0.1 of the price tolerance; 0.1 of the delta tolerance) and neither study is flagged. Unresolved references
stay in the results with their reason; they are never scored as passes.
"""

from __future__ import annotations

import math
import time
from typing import Iterable

from . import fd
from .cases import Case

TOL_SPOT, TOL_VALUE = 1e-4, 5e-4   # the stated price tolerance: max(1e-4·S, 5e-4·V)
DELTA_TOL = 2.5e-3                 # the stated delta accuracy
REF_FRACTION = 0.1                 # a reference must be at least ten times finer than what it judges
GCI_FS3, GCI_FS_WIDE = 1.25, 3.0
ORDER_CAP, ORDER_MIN = 2.0, 0.5
M_MIN, M_MAX = 1000, 6000
STEPS_MID = 1500                   # steps over the life at the middle time level, at least


def tolerance(value: float, spot: float) -> float:
    return max(TOL_SPOT * spot, TOL_VALUE * abs(value))


def gci(coarse: float, mid: float, fine: float, floor: float) -> dict:
    """Three levels refined by 2: the correction to `fine`, its uncertainty, the observed order and a kind."""
    e21, e32 = fine - mid, mid - coarse
    if abs(e21) <= floor and abs(e32) <= floor:
        return {"corr": 0.0, "u": floor, "order": None, "kind": "flat"}
    if abs(e21) <= floor:
        return {"corr": 0.0, "u": max(floor, abs(e32) / 3.0 * GCI_FS3), "order": None, "kind": "converged"}
    ratio = e32 / e21
    if ratio < 0:
        return {"corr": 0.0, "u": GCI_FS3 * max(abs(e21), 0.5 * abs(e32)), "order": None, "kind": "oscillating"}
    if ratio <= 1.0:
        return {"corr": 0.0, "u": GCI_FS_WIDE * max(abs(e21), abs(e32)), "order": None, "kind": "not-converging"}
    order = math.log(ratio) / math.log(2.0)
    used = min(order, ORDER_CAP)
    corr = e21 / (2.0 ** used - 1.0)
    kind = "low-order" if order < ORDER_MIN else "monotone"
    return {"corr": corr, "u": GCI_FS3 * abs(corr), "order": order, "kind": kind}


BAD_KINDS = {"not-converging", "low-order"}
NEGLIGIBLE = 0.1   # of the reference limit: a flagged study whose own estimate is below this does not count


def grid(c: Case) -> tuple[int, int, float]:
    """(M, p, half-width): M intervals on the finest grid, p steps a day at the middle time level."""
    tau = c.days / 365.0
    sd = c.sigma * math.sqrt(tau)
    x0 = c.spot - c.pv()
    width = max(7.0 * sd, abs(math.log(c.strike / x0)) + 5.0 * sd)
    dx = min(0.004, sd / 30.0)
    m = int(min(M_MAX, max(M_MIN, 2.0 * width / dx)))
    m -= m % 8  # m/4, m/2 and 3m/4 stay even, so the centre is a node on every grid
    p = 2 * max(1, math.ceil(STEPS_MID / (2 * c.days)))
    return m, p, width


CELL_CAP = 4e8      # grid nodes times time steps, summed over a case's runs, before escalation stops
ESCALATE_MAX = 2    # extra levels per dimension at most
WIDTH_FACTOR = 1.5
PENALTY_LOW = 1e7


def _assess(c: Case, runs: dict, m0: int, p0: int, t_levels: list[int], s_levels: list[int], w: float) -> dict:
    out = {}
    pt, ms = t_levels[-3:], s_levels[-3:]
    for k, name, floor in ((0, "value", 1e-12 * c.spot), (1, "delta", 1e-12)):
        t = gci(*(runs[(m0, x, w, fd.PENALTY)][k] for x in pt), floor)
        sp = gci(*(runs[(x, p0, w, fd.PENALTY)][k] for x in ms), floor)
        base = runs[(m0, pt[-1], w, fd.PENALTY)][k]
        # the space correction is for the base grid m0: the change from m0 to the finest grid, plus the GCI
        # correction of the finest grid (both at p0 steps a day; errors assumed additive across dimensions)
        s_corr = runs[(ms[-1], p0, w, fd.PENALTY)][k] - runs[(m0, p0, w, fd.PENALTY)][k] + sp["corr"]
        u_w = abs(runs[(3 * m0 // 4, p0, WIDTH_FACTOR * w, fd.PENALTY)][k] - runs[(m0 // 2, p0, w, fd.PENALTY)][k])
        u_p = abs(runs[(m0 // 4, p0, w, PENALTY_LOW)][k] - runs[(m0 // 4, p0, w, fd.PENALTY)][k]) / (fd.PENALTY / PENALTY_LOW - 1.0)
        out[name] = {"ref": base + t["corr"] + s_corr, "u": t["u"] + sp["u"] + u_w + u_p + floor, "time": t,
                     "space": sp, "u_width": u_w, "u_penalty": u_p, "raw_finest": base}
    v = out["value"]
    v["tol"] = tolerance(v["ref"], c.spot)
    for name, limit in (("value", REF_FRACTION * v["tol"]), ("delta", REF_FRACTION * DELTA_TOL)):
        r = out[name]
        # a study that is not in its asymptotic range leaves the quantity unresolved, unless even its widened
        # estimate is negligible (rounding-level changes have no meaningful order)
        why = [f"{name} {r[d]['kind']} in {d}" for d in ("time", "space")
               if r[d]["kind"] in BAD_KINDS and r[d]["u"] > NEGLIGIBLE * limit]
        if r["u"] > limit:
            why.append(f"{name} uncertainty above {REF_FRACTION:g} of its tolerance")
        r["limit"] = limit
        r["status"] = "reliable" if not why else "unresolved: " + "; ".join(why)
    return out


def reference(c: Case, exercise_days: Iterable[int] | None = None, american: bool = True,
              escalate: bool = True) -> dict:
    """The case's reference value and delta with their uncertainty, escalating the time or space refinement
    (one level at a time, whichever dominates the worse quantity) while a quantity is unresolved."""
    t0 = time.time()
    m0, p0, w = grid(c)
    ex = None if exercise_days is None else sorted(set(exercise_days))
    runs: dict = {}
    cells = 0.0
    solver_misses = [0]

    def run(mm, pp, ww=w, pen=fd.PENALTY):
        nonlocal cells
        key = (mm, pp, ww, pen)
        if key not in runs:
            dg: dict = {}
            runs[key] = fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, c.divs, mm, pp, ww,
                                 american=american, exercise_days=ex, penalty=pen, diag=dg)
            solver_misses[0] += dg.get("penalty_unconverged", 0)
            cells += (mm + 1) * pp * c.days
        return runs[key]

    t_levels, s_levels = [p0 // 2, p0, 2 * p0], [m0 // 4, m0 // 2, m0]
    for x in t_levels:
        run(m0, x)
    for x in s_levels:
        run(x, p0)
    run(3 * m0 // 4, p0, WIDTH_FACTOR * w)
    run(m0 // 4, p0, w, PENALTY_LOW)
    out = _assess(c, runs, m0, p0, t_levels, s_levels, w)
    steps = {"time": 0, "space": 0}
    while escalate:
        worst = max(("value", "delta"), key=lambda n: out[n]["u"] / out[n]["limit"])
        r = out[worst]
        if r["status"] == "reliable" and out["value" if worst == "delta" else "delta"]["status"] == "reliable":
            break
        dims = sorted((d for d in ("time", "space") if steps[d] < ESCALATE_MAX), key=lambda d: -r[d]["u"])
        if not dims or r["u_width"] + r["u_penalty"] > r["limit"]:
            break
        d = dims[0]
        nxt = 2 * (t_levels[-1] if d == "time" else s_levels[-1])
        cost = (m0 + 1) * nxt * c.days if d == "time" else (nxt + 1) * p0 * c.days
        if cells + cost > CELL_CAP:
            break
        if d == "time":
            t_levels.append(nxt)
            run(m0, nxt)
        else:
            s_levels.append(nxt)
            run(nxt, p0)
        steps[d] += 1
        out = _assess(c, runs, m0, p0, t_levels, s_levels, w)
    if solver_misses[0]:  # a penalty step stopped at its iteration cap: no quantity of this case is trusted
        for name in ("value", "delta"):
            r = out[name]
            r["status"] = ("unresolved: " if r["status"] == "reliable" else r["status"] + "; ") + \
                f"penalty iteration cap hit on {solver_misses[0]} steps"
    out["grid"] = {"m": m0, "p": p0, "width": w, "time_levels": t_levels, "space_levels": s_levels,
                   "escalations": steps, "cells": cells, "penalty_cap_steps": solver_misses[0]}
    out["secs"] = time.time() - t0
    return out
