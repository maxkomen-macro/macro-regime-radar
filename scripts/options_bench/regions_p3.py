"""scripts/options_bench/regions_p3.py — Phase 3 claim regions, sample sizes and conditioned strata (test tooling).

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md, section 8.2 (DR-03, DR-04, DR-10, DR-15).
Production never sees a bench group, so every capability is claimed over a region of inputs decided by
deterministic predicates on the Context alone:
- the sampled support Ω: the engine's domain and explicit bounds (days, σ bands, K/S per option kind at the dev
  draws' 0.5-99.5 percentiles, |r|, q, dividend count, PV/S within the sampled ranges); in-domain inputs outside
  Ω are "outside the sampled region" for every Phase 3 capability;
- per Greek, Ω_G = Ω minus declared carve-outs, each a named predicate on one input; and Ω_X for the FD
  cross-check role, built the same way.
All of it serializes to plain data for the freeze manifest (`Region.to_json`), and nothing reads a group.
Sizes: π_{g,G} is the dev per-draw rate of applicable, in Ω_G, returned and scored; n ≥ 300/(0.8·π), targeted
when ≤ 2,500; a group's size is max(400, its targeted pairs' largest n) ≤ 2,500. A required pair that cannot be
targeted is brought to Max (narrow Ω_G or raise the cap) before the freeze; this module only reports it.
"""

from __future__ import annotations

import math
import operator
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases

OUTSIDE_SAMPLED = "outside the sampled region"
OUTSIDE_VALIDATED = "outside this Greek's validated region"
OUTSIDE_FD_ROLE = "FD not validated for these inputs"

SIGMA_BANDS = ((0.001, 1.5), (2.0, 5.0))   # the generators' union (G5's high band starts at 2.0)
DAYS = (1, 1464)
KS_PCT = (0.5, 99.5)
SCORED_MIN = 300
PI_FACTOR = 0.8
N_CAP = 2500
N_FLOOR = 400
P_CAP = 100_000

OPS = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge, "==": operator.eq}


def features(c: om.Context) -> dict:
    """The inputs a predicate may read: the Context's own fields and quantities computed from them alone."""
    return {"is_call": c.is_call, "days": c.days, "sigma": c.sigma, "rho": c.rho, "q": c.q,
            "k_over_s": c.strike / c.spot, "n_divs": len(c.divs), "pv_over_s": c.pv() / c.spot,
            "first_div_day": min((d for d, _ in c.divs), default=-1)}


@dataclass(frozen=True)
class Carve:
    """A carve-out: inputs where `feature op value` holds (and `kind`, when given, is the option kind) are
    excluded from the region."""
    name: str
    feature: str
    op: str
    value: float
    kind: str | None = None     # "call", "put" or None for both

    def hits(self, f: dict) -> bool:
        if self.kind is not None and f["is_call"] != (self.kind == "call"):
            return False
        return OPS[self.op](f[self.feature], self.value)

    def to_json(self) -> dict:
        return {"name": self.name, "feature": self.feature, "op": self.op, "value": self.value, "kind": self.kind}


@dataclass(frozen=True)
class Support:
    """Ω's explicit bounds."""
    ks_call: tuple
    ks_put: tuple
    rho: tuple
    q: tuple
    n_divs_max: int
    pv_over_s_max: float
    days: tuple = DAYS
    sigma_bands: tuple = SIGMA_BANDS

    def reason(self, c: om.Context) -> str | None:
        if om.in_domain(c) is not None:
            return f"outside the domain: {om.in_domain(c)}"
        f = features(c)
        lo, hi = self.days
        ks = self.ks_call if c.is_call else self.ks_put
        if (not lo <= f["days"] <= hi or not any(a <= f["sigma"] <= b for a, b in self.sigma_bands)
                or not ks[0] <= f["k_over_s"] <= ks[1] or not self.rho[0] <= f["rho"] <= self.rho[1]
                or not self.q[0] <= f["q"] <= self.q[1] or f["n_divs"] > self.n_divs_max
                or f["pv_over_s"] > self.pv_over_s_max):
            return OUTSIDE_SAMPLED
        return None

    def to_json(self) -> dict:
        return {"ks_call": list(self.ks_call), "ks_put": list(self.ks_put), "rho": list(self.rho),
                "q": list(self.q), "n_divs_max": self.n_divs_max, "pv_over_s_max": self.pv_over_s_max,
                "days": list(self.days), "sigma_bands": [list(b) for b in self.sigma_bands]}


def support_from_dev(dev: Iterable[cases.Case]) -> Support:
    """Ω's bounds from the dev draws of the in-domain groups (set on dev, then frozen)."""
    dev = [c for c in dev if c.group in cases.IN_DOMAIN_GROUPS]
    ks = {k: np.array([c.strike / c.spot for c in dev if c.is_call == (k == "call")]) for k in ("call", "put")}
    band = lambda a: (float(np.percentile(a, KS_PCT[0])), float(np.percentile(a, KS_PCT[1])))
    return Support(ks_call=band(ks["call"]), ks_put=band(ks["put"]),
                   rho=(min(c.rho for c in dev), max(c.rho for c in dev)),
                   q=(min(c.q for c in dev), max(c.q for c in dev)),
                   n_divs_max=max(len(c.divs) for c in dev),
                   pv_over_s_max=max(c.pv() / c.spot for c in dev))


@dataclass(frozen=True)
class Regions:
    """Ω, every Greek's carve-outs, and the FD role region's (Ω_X). Callables for options_greeks.greeks
    (`greek_region`) and options_adaptive.phase3 (`fd_role_region`)."""
    support: Support
    carves: dict = field(default_factory=dict)       # greek → tuple of Carve
    fd_carves: tuple = ()

    def greek_region(self, c: om.Context, greek: str) -> str | None:
        why = self.support.reason(c)
        if why is not None:
            return OUTSIDE_SAMPLED
        f = features(c)
        if any(k.hits(f) for k in self.carves.get(greek, ())):
            return OUTSIDE_VALIDATED
        return None

    def fd_role_region(self, c: om.Context) -> str | None:
        if self.support.reason(c) is not None:
            return OUTSIDE_SAMPLED
        f = features(c)
        if any(k.hits(f) for k in self.fd_carves):
            return OUTSIDE_FD_ROLE
        return None

    def to_json(self) -> dict:
        return {"support": self.support.to_json(),
                "carves": {g: [k.to_json() for k in ks] for g, ks in sorted(self.carves.items())},
                "fd_carves": [k.to_json() for k in self.fd_carves]}

    @staticmethod
    def from_json(d: dict) -> "Regions":
        s = d["support"]
        sup = Support(ks_call=tuple(s["ks_call"]), ks_put=tuple(s["ks_put"]), rho=tuple(s["rho"]), q=tuple(s["q"]),
                      n_divs_max=s["n_divs_max"], pv_over_s_max=s["pv_over_s_max"], days=tuple(s["days"]),
                      sigma_bands=tuple(tuple(b) for b in s["sigma_bands"]))
        carve = lambda k: Carve(k["name"], k["feature"], k["op"], k["value"], k.get("kind"))
        return Regions(sup, {g: tuple(carve(k) for k in ks) for g, ks in d["carves"].items()},
                       tuple(carve(k) for k in d["fd_carves"]))


# ── sizes (DR-03) ───────────────────────────────────────────────────────────

def applicable(c: om.Context, greek: str) -> bool:
    return bool(c.divs) if greek == G.DIVIDEND else True


def required_n(pi: float) -> int | None:
    """Draws a pair needs for SCORED_MIN returned-and-scored values at 80% of the dev rate, or None when π = 0."""
    if pi <= 0.0:
        return None
    return math.ceil(SCORED_MIN / (PI_FACTOR * pi))


def plan_sizes(rates: dict) -> dict:
    """rates: {group: {greek: (applicable dev contexts, π)}} → per pair its standing and n, per group n_g.
    Standings: "not applicable" (no applicable dev contexts), "not targeted" (π = 0), "targeted" (n ≤ N_CAP),
    "decision needed" (a required pair above the cap: narrow Ω_G or raise the cap, Max's call)."""
    pairs, groups = {}, {}
    for g, by in rates.items():
        need = []
        for greek, (n_app, pi) in by.items():
            if n_app == 0:
                pairs[(g, greek)] = {"standing": "not applicable"}
                continue
            n = required_n(pi)
            if n is None:
                pairs[(g, greek)] = {"standing": "not targeted", "pi": pi}
            elif n <= N_CAP:
                pairs[(g, greek)] = {"standing": "targeted", "pi": pi, "n": n}
                need.append(n)
            else:
                pairs[(g, greek)] = {"standing": "decision needed", "pi": pi, "n": n}
        groups[g] = max([N_FLOOR] + need)
    return {"pairs": pairs, "groups": groups}


def stratum_proposals(n_required: int, acceptance: float) -> int | None:
    """P = ceil(n_required / (0.5·a)) for an applicability-conditioned stratum, capped at P_CAP; None when the
    dev acceptance is zero (no stratum can serve the pair)."""
    if acceptance <= 0.0:
        return None
    return min(P_CAP, math.ceil(n_required / (0.5 * acceptance)))


STRATUM_STREAM = 200   # rng streams [seed, STRATUM_STREAM + group index, i], disjoint from groups and E


def stratum(seed: int, group: str, greek: str, proposals: int, regions: Regions, n_required: int) -> dict:
    """An applicability-conditioned stratum: exactly `proposals` draws of the group's generator on its own
    stream, keeping in proposal order those applicable to the Greek and inside Ω_G (inputs only, before any
    reference exists); no redraw and no outer loop. Fewer kept than required: "not established: sample not
    reached"."""
    gid = list(cases.GROUPS).index(group)
    kind, inside, avoid = cases.GROUPS[group]
    kept = []
    for i in range(proposals):
        rng = np.random.default_rng([seed, STRATUM_STREAM + gid, i])
        p = cases._draw(group, rng)
        c = cases.Case(id=f"{group}:{greek}/{i}", group=group, kind="stratum", is_call=bool(p["is_call"]),
                       spot=cases.SPOT, strike=round(cases.SPOT * float(p["k"]), 6), days=int(p["days"]),
                       rho=round(float(p["rho"]), 8), q=round(float(p["q"]), 8),
                       sigma=round(float(p["sigma"]), 8), divs=tuple(p.get("divs", ())))
        if inside and cases.domain_reason(c) is not None:
            continue
        if avoid and cases.exempt_simple(c):
            continue
        x = om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))
        if applicable(x, greek) and regions.greek_region(x, greek) is None:
            kept.append(c)
    status = "reached" if len(kept) >= n_required else "not established: sample not reached"
    return {"cases": kept, "kept": len(kept),
            "proposals": proposals, "status": status}


def held_out(seed: int, sizes: dict) -> list[cases.Case]:
    """The held-out population: exactly the frozen sizes on the fresh seed, in seed order (no top-up, no redraw,
    no filter on any outcome)."""
    return [cases.case(seed, g, i) for g, n in sizes.items() for i in range(n)]
