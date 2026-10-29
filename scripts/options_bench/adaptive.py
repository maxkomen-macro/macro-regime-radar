"""scripts/options_bench/adaptive.py — the Tier 2 controller on bench cases, and its verdicts (test tooling).

The adapter runs src/desk/options_adaptive.py (imported from this repository, never edited) on a bench case and
keeps what the Phase 2 scorer reads: the route and statuses, the value and its estimate, the delta and its
estimate, the reasons, the proved interval [L, U], every level computed, and the work charged.

The verdicts follow the frozen protocol (design P2-2, section 9.3). With err = |V − ref| and the stated estimate
E_s: covered when err + u <= E_s, a confirmed exceedance when err − u > E_s, otherwise a straddle. A straddle
gets one tightened reference R1 (the same reference code with a target for u and larger caps), judged in this
order, each outcome exclusive of the later ones:
  1. R1 inconsistent with R0 (|ref1 − ref0| > u1 + u0): unresolved, counted as an exceedance;
  2. R1 not reliable by its own rules (u read against R1's target): unscored;
  3. covered or confirmed against R1;
  4. still straddling with u1 <= 0.1·E_s: unresolved (a precise straddle), counted as an exceedance;
  5. still straddling with u1 > 0.1·E_s: unscored (a coarse straddle).
No reference at all (R0 not reliable) is its own population. Exclusions never count as passes.
"""

from __future__ import annotations

import dataclasses
from typing import Callable

from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_math as om

from . import reference
from .cases import Case

# The tightened reference R1 (design 9.3): a target for u of 0.1 of the estimate it judges, six escalation levels
# per dimension instead of two, and 2e9 cells instead of 4e8. Calibration aims R1 at the finest estimate any
# candidate can state (the floors), so one R1 per case serves every candidate.
R1_FRACTION = 0.1
R1_ESCALATE_MAX = 6
R1_CELL_CAP = 2e9
R1_FLOOR_VALUE = 0.01      # of tol: 0.1 of the price floor 0.1·tol
R1_FLOOR_DELTA = 2.5e-5    # 0.1 of the delta floor 2.5e-4

# Verdicts.
COVERED, CONFIRMED, STRADDLE = "covered", "confirmed", "straddle"
UNRESOLVED, UNSCORED, NO_REF = "unresolved", "unscored", "no reference"
POPULATIONS = (COVERED, CONFIRMED, UNRESOLVED, UNSCORED, NO_REF)


def to_context(c: Case) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


def config_json(cfg: oa.Config) -> dict:
    return dataclasses.asdict(cfg)


def record(a: oe.Answer) -> dict:
    """What the scorer reads from one Tier 2 answer (the audit's numbers, without its per-level trace)."""
    au = a.audit or {}
    out = {"engine": a.engine, "version": a.version, "route": a.route, "price_status": a.price_status,
           "value": a.value, "estimate": a.estimate, "delta_status": a.delta_status, "delta": a.delta,
           "delta_estimate": a.delta_estimate, "reason": a.reason, "delta_reason": a.delta_reason, "units": a.units}
    for k in ("L", "U", "h", "european", "exercise", "bound", "n0", "multipliers", "stopped", "price_units",
              "delta_units", "price_level", "estimator", "target", "exercise_resolved", "delta_rule", "delta_level",
              "proved_exceedance", "interval_inconsistent"):
        if k in au:
            out[k] = au[k]
    out["levels"] = [[l["m"], l["steps"], l["h"], l["delta"], l["units"]] for l in au.get("levels", [])]
    tr = au.get("trace") or []
    if a.price_status == oe.ESTIMATED and "price_level" in au:
        t = tr[au["price_level"] - oa.MIN_LEVELS + 1]
        out["E"], out["Es"], out["tol"] = t["E"], t["Es"], t["tol"]
    if a.delta_status == oe.SERVED and au.get("delta_level") is not None and au.get("delta_rule") == "envelope":
        t = tr[au["delta_level"] - oa.MIN_LEVELS + 1]
        out["Ed"], out["dEs"] = t["Ed"], t["dEs"]
    return out


def run(c: Case, cfg: oa.Config, level_source: Callable | None = None) -> dict:
    ctx = to_context(c)
    a = oa.price(ctx, cfg) if level_source is None else oa.price(ctx, cfg, level_source=level_source)
    return record(a)


class LevelCache:
    """Lattice levels of one case, computed once and shared by every candidate configuration (calibration).
    The controller's walk and caps decide which levels it asks for; the cache only avoids recomputing them."""

    def __init__(self) -> None:
        self.levels: dict = {}

    def __call__(self, ctx: om.Context, m: int) -> oa.Level:
        if m not in self.levels:
            self.levels[m] = oa.lattice_level(ctx, m)
        return self.levels[m]


def baseline_matches(c: Case, rec_engine: dict) -> bool:
    """Tier 1 unchanged: options_engine.baseline's answer equals the bench's own run of the baseline, bit for bit."""
    t1 = oe.baseline(to_context(c))
    if rec_engine.get("status") != "served":
        return not t1.priced
    return t1.priced and t1.value == rec_engine["value"] and t1.delta == rec_engine.get("delta")


# ── verdicts ─────────────────────────────────────────────────────────────────

def verdict(err: float, u: float, es: float) -> str:
    if err + u <= es:
        return COVERED
    if err - u > es:
        return CONFIRMED
    return STRADDLE


def r1_reliable(r1: dict, es: float) -> bool:
    """R1 judged by its own rules, its uncertainty read against the target this estimate needs (0.1·E_s). In the
    held-out run R1's target is exactly that; in calibration R1 aims at the floor, finer than any candidate
    needs, so an R1 that missed the floor but meets 0.1·E_s still judges that candidate."""
    if r1["status"] == "reliable":
        return True
    why = r1["status"].removeprefix("unresolved: ").split("; ")
    return all("uncertainty above its target" in w for w in why) and r1["u"] <= R1_FRACTION * es


def _against(value: float, es: float, ref: float, u: float, interval: tuple | None) -> tuple[str, str | None]:
    """One reference's verdict on one estimate. On the analytic route (`interval` = (L, U)) the estimate h is a
    consequence of the proof: L <= A is a theorem and A <= U the certified bound, so A in [L, U] puts the
    midpoint within h of A. Where A sits at the lower end (an American value equal to its European value, say)
    the error is exactly h and no finite reference can show err + u <= h. There the upper side is what the
    reference must show: a straddle with L − u <= ref <= value and ref + u <= U is covered, by the theorem
    below and the reference above. Everything else is judged as on any route."""
    v = verdict(abs(value - ref), u, es)
    if v == STRADDLE and interval is not None:
        lo, hi = interval
        if lo - u <= ref <= value and ref + u <= hi:
            return COVERED, "lower end by theorem"
    return v, None


def judge(value: float, es: float, r0: dict, r1: dict | None = None, interval: tuple | None = None) -> dict:
    """The protocol verdict for one stated estimate es of `value`, against R0 and, for a straddle, R1.
    r0 and r1 are reference packs ({"ref", "u", "status"}); r1 is None until the caller has computed it.
    `interval` is the analytic route's (L, U), None elsewhere."""
    if r0 is None or r0.get("status") != "reliable":
        return {"verdict": NO_REF}
    err0 = abs(value - r0["ref"])
    v0, why0 = _against(value, es, r0["ref"], r0["u"], interval)
    out = {"err": err0, "u": r0["u"], "ref": "R0", "needed": (err0 - r0["u"]) / es if es else None}
    if v0 != STRADDLE:
        return out | {"verdict": v0} | ({"why": why0} if why0 else {})
    if r1 is None:
        return out | {"verdict": STRADDLE, "needs_r1": True}
    out["r1"] = {"ref": r1["ref"], "u": r1["u"], "status": r1["status"]}
    if abs(r1["ref"] - r0["ref"]) > r1["u"] + r0["u"]:
        return out | {"verdict": UNRESOLVED, "why": "reference inconsistent"}
    if not r1_reliable(r1, es):
        return out | {"verdict": UNSCORED, "why": "R1 not reliable"}
    err1 = abs(value - r1["ref"])
    out.update(err=err1, u=r1["u"], ref="R1")
    v1, why1 = _against(value, es, r1["ref"], r1["u"], interval)
    if v1 != STRADDLE:
        return out | {"verdict": v1} | ({"why": why1} if why1 else {})
    if r1["u"] <= R1_FRACTION * es:
        return out | {"verdict": UNRESOLVED, "why": "precise straddle"}
    return out | {"verdict": UNSCORED, "why": "coarse straddle"}


def judge_tol(value: float, tol: float, r0: dict, r1: dict | None = None) -> str:
    """The accuracy rows (price within tol, delta within 2.5e-3), scored conservatively as the merged bench does:
    pass when err + u <= tol, fail when err − u > tol, otherwise indeterminate; a reliable R1 consistent with R0
    may settle an indeterminate R0 outcome."""
    if r0 is None or r0.get("status") != "reliable":
        return "unscored"
    for r in (r0, r1):
        if r is None or r is not r0 and (r["status"] != "reliable" or abs(r["ref"] - r0["ref"]) > r["u"] + r0["u"]):
            continue
        v = verdict(abs(value - r["ref"]), r["u"], tol)
        if v != STRADDLE:
            return "pass" if v == COVERED else "fail"
    return "indeterminate"


def tighten(c: Case, value_target: float | None, delta_target: float | None) -> dict:
    """R1 for one case: the standard reference with a target for u on the quantities that straddle."""
    limits = {k: v for k, v in (("value", value_target), ("delta", delta_target)) if v is not None}
    r = reference.reference(c, limits=limits, escalate_max=R1_ESCALATE_MAX, cell_cap=R1_CELL_CAP)
    pack = lambda q: {"ref": r[q]["ref"], "u": r[q]["u"], "status": r[q]["status"], "limit": r[q]["limit"]}
    return {"value": pack("value"), "delta": pack("delta"), "targets": limits, "grid": r["grid"], "secs": r["secs"]}
