"""src/desk/options_check.py — the Tier 2 accuracy check on the Options Finder's picks (candidate A, unserved by default).

For each lens's pick, Tier 2 (options_adaptive, the Phase 2 convergence controller) reprices the one session context
that Tier 1 already valued for that row, under the configuration frozen for Phase 2's acceptance evaluation, and the
check reports Tier 2's answer beside Tier 1's and whether the two agree within the sum of their stated accuracies
(the approved Phase 2 positive-control rule). It never changes, replaces or hides a Tier 1 number: every price,
delta, ranking, P&L and breakeven the Finder serves stays Tier 1's.

Evidence scope: Tier 2's stated error is an empirical estimate validated on the bench's synthetic held-out population
(attempt 2, freeze ef7d784, engine adaptive-p2.1, seed 20261102), not a proved bound and not measured on real chains.
Its values carry "estimated, cross-check pending" until the Phase 3 cross-check is accepted and served.

Pure functions of numbers: no I/O, no clock. The route imports this module only when OPTIONS_TIER2_CHECK is on.
The proposal is the doc "Tier 2 serving candidate: accuracy check on the Finder's picks".
"""

from __future__ import annotations

import logging
import math
from dataclasses import asdict
from typing import Any, Mapping, Sequence

from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_math as om

log = logging.getLogger("mrr.desk")

# The configuration frozen for Phase 2's acceptance evaluation (scripts/options_bench/calibration/phase2-freeze-2.json,
# "config"). Written here, not read from the file, because the API image does not carry scripts/; a test pins the two
# equal. Never Config()'s defaults (hybrid schedule, F = 2), which were not the evaluated configuration.
FROZEN = oa.Config(estimator="envelope", schedule="multiples", F=3.0, F_d=2.0, tau=1.0, force_lattice=False)

EVIDENCE = {
    "engine_version": "adaptive-p2.1",
    "attempt": 2,
    "freeze": "ef7d784",
    "held_out_seed": 20261102,
    "cases": 17207,
    "population": "the bench's synthetic held-out groups; not real chains",
    "estimate": "empirical, validated on that population; not a proved bound",
}

# Work units for the whole check, across every pick: additional computation beyond the scan's own 300 M budget, which
# the check never charges (owner, 2026-11-16). Enforced before any work is done: a solve starts only when the budget
# left covers `prelattice_reserve`, an upper bound on the closed-form and bound work Tier 2 does before its first
# lattice level, and each lattice level is charged before it is computed. A pick refused this way is "work limit"
# with no value, and nothing more is computed for it. The largest single context in Phase 2's held-out run (95.7 M)
# is an observation, not a runtime bound.
CHECK_LIMIT = 300_000_000

CHECKED = "checked"
NOT_CHECKED = "not checked"
WORK_LIMIT_REASON = "work limit"
ROLE = "check only: every number the Finder serves is Tier 1's"


class _OverBudget(Exception):
    pass


def prelattice_reserve(c: om.Context) -> int:
    """An upper bound on the work units Tier 2 charges before its first lattice level (options_adaptive._price): the
    European value, one closed form per dividend, and the early-exercise bound at its most (one initial batch and
    BOUND_PASSES refinement batches, at most max(initial pieces, BOUND_PIECES_MAX) pieces). A test pins it at or
    above the work Tier 2 reports less its lattice levels, on every golden context."""
    nd = len(c.divs)
    pieces = max(om.BOUND_PIECES * (nd + 1), om.BOUND_PIECES_MAX)
    return (om.UNITS_CLOSED_FORM * (1 + nd) + om.UNITS_BOUND_BATCH * (1 + om.BOUND_PASSES)
            + om.UNITS_BOUND_PIECE * pieces)


def _finite(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def _tier2(a: oe.Answer) -> dict:
    return {"route": a.route, "price_status": a.price_status, "value": _finite(a.value),
            "estimate": _finite(a.estimate), "reason": a.reason, "delta_status": a.delta_status,
            "delta": _finite(a.delta), "delta_estimate": _finite(a.delta_estimate), "delta_reason": a.delta_reason,
            "units": int(a.units)}


NO_AGREEMENT = {"difference": None, "allowed": None, "agree": None,
                "delta_difference": None, "delta_allowed": None, "delta_agree": None}


def agreement(a: oe.Answer, v1: float, d1: float | None, spot: float) -> dict:
    """Whether Tier 2's answer agrees with Tier 1's value v1 (and delta d1) within the sum of their stated accuracies:
    |V2 - V1| <= E2 + tol(V1), Tier 1's stated accuracy being its tolerance (observed accuracy) and an exact Tier 2
    value stating none (0). The delta likewise, |D2 - D1| <= E_D2 + 2.5e-3, only when both engines serve one."""
    out = dict(NO_AGREEMENT)
    if a.priced and a.value is not None:
        e2 = 0.0 if a.estimate is None else float(a.estimate)
        diff = float(a.value) - float(v1)
        allowed = e2 + om.tolerance(float(v1), spot)
        out.update(difference=diff, allowed=allowed, agree=abs(diff) <= allowed)
    if a.delta_status == oe.SERVED and a.delta is not None and d1 is not None:
        de2 = 0.0 if a.delta_estimate is None else float(a.delta_estimate)
        dd = float(a.delta) - float(d1)
        dallowed = de2 + om.DELTA_TOL
        out.update(delta_difference=dd, delta_allowed=dallowed, delta_agree=abs(dd) <= dallowed)
    return out


def check(picks: Sequence[Mapping[str, Any]], limit: int = CHECK_LIMIT) -> dict:
    """The check over the Finder's picks: each a mapping with "lens", "contract", "context" (the session
    om.Context Tier 1 valued), "value" (Tier 1's value of it) and "delta" (the row's served delta or None).
    A contract that is the pick of several lenses is priced once. Never raises: a failure is that pick's
    "not checked" with its reason, and the rest are still checked."""
    used = 0
    rows: list[dict] = []
    seen: dict[str, dict] = {}
    for p in picks:
        key = p["contract"]
        if key in seen:
            seen[key]["lenses"].append(p["lens"])
            continue
        row: dict = {"contract": key, "lenses": [p["lens"]], "status": NOT_CHECKED, "reason": None,
                     "tier1": {"value": _finite(p.get("value")), "delta": _finite(p.get("delta"))}, "tier2": None, **NO_AGREEMENT}
        seen[key] = row
        rows.append(row)
        c = p["context"]
        try:
            reserve = prelattice_reserve(c)
        except Exception as err:   # a context the reserve cannot read is refused before any work
            log.warning("Tier 2 check failed on %s: %s", key, type(err).__name__, exc_info=True)
            row["reason"] = f"error ({type(err).__name__})"
            continue
        if used + reserve > limit:   # not started: the budget left cannot cover the work before the first level
            row["reason"] = WORK_LIMIT_REASON
            continue
        base = used
        charged = [0]

        def level(cx: om.Context, m: int, _c=charged, _base=base + reserve) -> oa.Level:
            u = oa.units(om.steps_for(cx.days) * m)
            if _base + _c[0] + u > limit:   # charged before the level is computed
                raise _OverBudget
            _c[0] += u
            return oa.lattice_level(cx, m)

        try:
            a = oa.price(c, FROZEN, level)
        except _OverBudget:
            row["reason"] = WORK_LIMIT_REASON
            used = base + reserve + charged[0]   # the reserve stands in for the bound work actually done
            continue
        except Exception as err:   # the check must never fail the scan; the failure is shown and logged
            log.warning("Tier 2 check failed on %s: %s", key, type(err).__name__, exc_info=True)
            row["reason"] = f"error ({type(err).__name__})"
            used = base + reserve + charged[0]
            continue
        used = base + int(a.units)
        if int(a.units) > reserve + charged[0]:   # a backstop: the reserve fell short of Tier 2's own count
            log.warning("Tier 2 check on %s: %d units reported, %d reserved and charged", key, int(a.units),
                        reserve + charged[0])
            if used > limit:
                row["reason"] = WORK_LIMIT_REASON
                continue
        row["status"] = CHECKED
        row["tier2"] = _tier2(a)
        if row["tier1"]["value"] is not None:
            row.update(agreement(a, row["tier1"]["value"], row["tier1"]["delta"], c.spot))
    return {"engine": oa.ENGINE, "version": oa.VERSION, "role": ROLE, "evidence": dict(EVIDENCE),
            "config": asdict(FROZEN), "work": {"used": used, "limit": limit}, "picks": rows, "error": None}
