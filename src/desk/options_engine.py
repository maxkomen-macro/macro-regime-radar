"""src/desk/options_engine.py — one interface over the options pricing engines (adaptive Phase 2, unserved).

An engine answers one valuation context (options_math.Context) with a price, a delta, their statuses and an
audit record. The price and the delta are judged apart: a delta is never served because its price was.

- baseline (Tier 1): today's Finder pricer, options_finder.Pricer, called unchanged. Its lattice values carry
  "observed accuracy" (the validation suite's worst error), not a per-contract error estimate.
- adaptive (Tier 2): the convergence controller in options_adaptive. Its values carry a per-contract estimate
  and stay "cross-check pending" until the Phase 3 cross-check exists.

Pure functions of numbers: no I/O, no clock. Nothing under api/ imports this module (tests pin that); the
served engine stays the baseline until the Phase 7 switch.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from src.desk import options_finder as of
from src.desk import options_math as om

# Price statuses.
EXACT = "exact"                      # intrinsic at expiry, or the European value of an exempt context (theorem)
OBSERVED = "observed accuracy"       # Tier 1: within the suite's observed worst error; no per-contract figure
ANALYTIC = "analytic bound"          # Tier 2: the midpoint of a proved interval; estimate half-width + 0.1·tol
ESTIMATED = "estimated, cross-check pending"   # Tier 2 lattice: a per-contract estimate, no Phase 3 check yet
UNRESOLVED = "unresolved"            # the engine ran and could not state a value it stands behind
OUTSIDE = "outside the domain"       # a named reason the context is not priced
INPUT = "input failure"              # the inputs describe no valid context
CONTROL = "positive control"         # Tier 2 forced through the lattice without the interval test: never served

# Delta statuses.
SERVED = "served"
WITHHELD = "withheld"

# Routes.
ROUTE_INTRINSIC = "intrinsic"
ROUTE_EXEMPT = "exempt"
ROUTE_BOUND = "bound-european"       # Tier 1: the European value the early-exercise bound let stand
ROUTE_ANALYTIC = "analytic-interval"  # Tier 2: the interval midpoint
ROUTE_LATTICE = "lattice"
ROUTE_NONE = "none"

ENGINE_BASELINE = "baseline"
WORK_CAP = "work cap"


@dataclass(frozen=True)
class Answer:
    engine: str
    version: str
    route: str
    price_status: str
    value: float | None
    estimate: float | None           # the stated error of `value`, per share; None when the status states none
    delta_status: str
    delta: float | None
    delta_estimate: float | None
    reason: str | None = None        # why the price is not served, when it is not
    delta_reason: str | None = None  # why the delta is withheld, when it is
    units: int = 0                   # work charged for this context alone
    audit: dict[str, Any] = field(default_factory=dict, compare=False)

    @property
    def priced(self) -> bool:
        return self.price_status in (EXACT, OBSERVED, ANALYTIC, ESTIMATED)


def _delta(d: float | None, why: str | None) -> tuple[str, float | None, str | None]:
    if d is None or (isinstance(d, float) and math.isnan(d)):
        return WITHHELD, None, why or "no delta"
    return SERVED, float(d), None


def baseline(c: om.Context, limit: int = of.WORK_LIMIT) -> Answer:
    """Tier 1: the Finder's served answer for one context, exactly as options_finder serves it. The price comes
    from Pricer.many; a value the early-exercise bound let stand takes its delta from Pricer.deltas (DR-51), as
    the Finder does. Nothing is recomputed or adjusted here."""
    work = of.Work(limit)
    pricer = of.Pricer(work)
    common = dict(engine=ENGINE_BASELINE, version=of.VERSION)
    try:
        got = pricer.many([c])[0]
    except of.FinderError as e:
        return Answer(**common, route=ROUTE_NONE, price_status=UNRESOLVED, value=None, estimate=None,
                      delta_status=WITHHELD, delta=None, delta_estimate=None, reason=f"{WORK_CAP}: {e}",
                      delta_reason="no price", units=work.used)
    if isinstance(got, str):
        status = (UNRESOLVED if got == om.NOT_CONVERGED else
                  INPUT if "at or below the dividends" in got else OUTSIDE)
        return Answer(**common, route=ROUTE_LATTICE if status == UNRESOLVED else ROUTE_NONE, price_status=status,
                      value=None, estimate=None, delta_status=WITHHELD, delta=None, delta_estimate=None,
                      reason=got, delta_reason="no price", units=work.used)
    if got.model == of.MODEL_INTRINSIC:
        route, status = ROUTE_INTRINSIC, EXACT
    elif got.model == of.MODEL_EUROPEAN and got.bound is None:
        route, status = ROUTE_EXEMPT, EXACT
    elif got.model == of.MODEL_EUROPEAN:
        route, status = ROUTE_BOUND, OBSERVED
    else:
        route, status = ROUTE_LATTICE, OBSERVED
    d, why = got.delta, got.delta_note
    if route == ROUTE_BOUND:
        try:
            d, why = pricer.deltas([c])[c]
        except of.FinderError as e:
            d, why = None, str(e)
    ds, dv, dwhy = _delta(d, why)
    audit = {"model": got.model, "european": got.european}
    if got.bound is not None:
        audit["bound"] = got.bound
    return Answer(**common, route=route, price_status=status, value=float(got.value),
                  estimate=None, delta_status=ds, delta=dv, delta_estimate=None,
                  delta_reason=dwhy, units=work.used, audit=audit)
