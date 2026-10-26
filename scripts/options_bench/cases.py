"""scripts/options_bench/cases.py — benchmark contexts: the domain contract, seeded groups, named regressions.

A case is one long call or put under the Finder's model (S = X + PV of owed dividends, X lognormal with drift
rho − q). Everything here is synthetic: no market data, no dates beyond the convention study's start session.

Reproducibility: case i of group g under seed s is drawn from numpy's default_rng([s, g's index, i]) alone, so
a case is the same whichever shard, worker or run draws it, and a shard is a plain slice of case ids.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Iterator

import numpy as np

SPOT = 100.0
YEAR_DAYS = 365.0

# The domain contract the baseline (rev 12) states. The bench keeps its own copy so a case's group does not
# depend on the engine under test; a case the engine refuses although it is in this domain is a coverage miss.
DOMAIN = {
    "sigma": (0.001, 5.0),
    "days": (1, 4 * 366),
    "rho_abs_max": 0.75,
    "q_abs_max": 0.10,
    "k_over_s": (0.05, 20.0),
    "divs_max": 64,
    "div_cluster_frac": 0.03,   # dividends whose cum closes fall in any 10 consecutive days, over S
    "div_cluster_days": 10,
    "pv_frac_max": 0.9,
}


@dataclass(frozen=True)
class Case:
    id: str
    group: str
    kind: str                 # "random", "targeted", "stress" or "named"
    is_call: bool
    spot: float
    strike: float
    days: int
    rho: float
    q: float
    sigma: float
    divs: tuple[tuple[int, float], ...] = field(default=())
    note: str = ""
    expect: str = ""          # named cases: the outcome the baseline is documented to give

    def pv(self) -> float:
        return sum(a * math.exp(-self.rho * d / YEAR_DAYS) for d, a in self.divs)

    def to_json(self) -> dict:
        d = asdict(self)
        d["divs"] = [list(x) for x in self.divs]
        return d

    @staticmethod
    def from_json(d: dict) -> "Case":
        d = dict(d)
        d["divs"] = tuple((int(a), float(b)) for a, b in d["divs"])
        return Case(**d)


def div_cluster(divs) -> float:
    w = DOMAIN["div_cluster_days"]
    return max((sum(a for d, a in divs if d0 <= d < d0 + w) for d0, _ in divs), default=0.0)


def domain_reason(c: Case) -> str | None:
    """None when the case is inside the stated domain, else the first rule it breaks."""
    lo, hi = DOMAIN["sigma"]
    if not lo <= c.sigma <= hi:
        return "sigma"
    lo, hi = DOMAIN["days"]
    if not lo <= c.days <= hi:
        return "days"
    if abs(c.rho) > DOMAIN["rho_abs_max"]:
        return "rho"
    lo, hi = DOMAIN["k_over_s"]
    if not lo <= c.strike / c.spot <= hi:
        return "strike"
    if len(c.divs) > DOMAIN["divs_max"]:
        return "dividend count"
    if any(not 0 <= d < c.days for d, _ in c.divs):
        return "dividend date"
    if div_cluster(c.divs) > DOMAIN["div_cluster_frac"] * c.spot:
        return "dividend cluster"
    if c.pv() > DOMAIN["pv_frac_max"] * c.spot or c.spot - c.pv() <= 0:
        return "dividend size"
    if abs(c.q) > DOMAIN["q_abs_max"]:
        return "residual yield"
    return None


def exempt_simple(c: Case) -> bool:
    """The no-early-exercise theorems the generator avoids (conservative: the call's dividend condition is
    not used, so some dividend calls drawn here may still be exempt; the engine's own test decides)."""
    if c.is_call:
        return c.rho >= 0.0 and c.q <= 0.0 and not c.divs
    return c.rho <= 0.0 and c.q >= 0.0


# ── groups ───────────────────────────────────────────────────────────────────

def _loguniform(rng, lo, hi):
    return float(math.exp(rng.uniform(math.log(lo), math.log(hi))))


def _days(rng, lo, hi) -> int:
    return int(min(hi, max(lo, round(_loguniform(rng, lo, hi + 0.999)))))


def _dividends(rng, days: int, max_each: float = 2.5) -> tuple[tuple[int, float], ...]:
    cadence = int(rng.choice([30, 91, 91, 182]))
    first = int(rng.integers(0, min(cadence, days)))
    out = []
    d = first
    while d < days and len(out) < 16:
        out.append((d, round(float(rng.uniform(0.1, max_each)), 4)))
        d += cadence
    return tuple(out)


def _draw(group: str, rng) -> dict:
    u = rng.random
    if group == "G0-exempt":
        is_call = u() < 0.5
        rho = rng.uniform(0.0, 0.10) if is_call else rng.uniform(-0.03, 0.0)
        q = rng.uniform(-0.10, 0.0) if is_call else rng.uniform(0.0, 0.10)
        return dict(is_call=is_call, k=math.exp(rng.normal(0, 0.3)), days=_days(rng, 1, 1464), rho=rho, q=q,
                    sigma=_loguniform(rng, 0.05, 1.5))
    if group == "G1-nodiv":
        is_call = u() < 0.4
        return dict(is_call=is_call, k=math.exp(rng.normal(0, 0.3)), days=_days(rng, 1, 1464),
                    rho=rng.uniform(-0.02, 0.12), q=rng.uniform(-0.10, 0.10), sigma=_loguniform(rng, 0.05, 1.5))
    if group == "G2-dividends":
        days = _days(rng, 5, 1464)
        return dict(is_call=u() < 0.5, k=math.exp(rng.normal(0, 0.25)), days=days, rho=rng.uniform(-0.01, 0.10),
                    q=0.0 if u() < 0.7 else rng.uniform(-0.05, 0.05), sigma=_loguniform(rng, 0.08, 1.0),
                    divs=_dividends(rng, days))
    if group == "G3-carry-itm":
        is_call = u() < 0.4
        days = _days(rng, 2, 730)
        if is_call:
            k, rho, q = rng.uniform(0.55, 1.0), rng.uniform(0.0, 0.10), rng.uniform(0.02, 0.10)
        else:
            k, rho, q = rng.uniform(1.0, 1.6), rng.uniform(0.03, 0.12), rng.uniform(-0.10, 0.02)
        divs = ((int(rng.integers(0, min(10, days))), round(float(rng.uniform(0.2, 2.5)), 4)),) if u() < 0.5 else ()
        return dict(is_call=is_call, k=k, days=days, rho=rho, q=q, sigma=_loguniform(rng, 0.05, 1.5), divs=divs)
    if group == "G4-negrate":
        is_call = u() < 0.6
        days = _days(rng, 5, 1000)
        q = rng.uniform(-0.10, 0.03) if is_call else rng.uniform(-0.10, -0.001)
        divs = ((int(rng.integers(0, min(60, days))), round(float(rng.uniform(0.2, 2.0)), 4)),) if u() < 0.4 else ()
        return dict(is_call=is_call, k=math.exp(rng.normal(0, 0.25)), days=days, rho=rng.uniform(-0.05, -0.001),
                    q=q, sigma=_loguniform(rng, 0.05, 0.8), divs=divs)
    if group == "G5-extreme-vol":
        days = _days(rng, 2, 400)
        sigma = rng.uniform(0.001, 0.05) if u() < 0.5 else rng.uniform(2.0, 5.0)
        divs = ((int(rng.integers(0, min(20, days))), round(float(rng.uniform(0.2, 2.0)), 4)),) if u() < 0.4 else ()
        return dict(is_call=u() < 0.5, k=math.exp(rng.normal(0, 0.2)), days=days, rho=rng.uniform(0.0, 0.10),
                    q=rng.uniform(-0.05, 0.05), sigma=sigma, divs=divs)
    if group == "G6-long":
        days = int(rng.integers(731, 1465))
        divs = _dividends(rng, days, 2.0) if u() < 0.6 else ()
        return dict(is_call=u() < 0.5, k=math.exp(rng.normal(0, 0.3)), days=days, rho=rng.uniform(0.0, 0.08),
                    q=rng.uniform(-0.05, 0.05), sigma=_loguniform(rng, 0.08, 0.8), divs=divs)
    if group == "T1-near-boundary":
        # Targeted, not random coverage: short, high-rate, in-the-money puts and high-yield calls, where the
        # root sits near the exercise boundary (the DR-49/DR-50/B9 family inside the domain).
        is_call = u() < 0.3
        days = _days(rng, 5, 180)
        if is_call:
            k, rho, q = rng.uniform(0.80, 0.97), rng.uniform(0.0, 0.05), rng.uniform(0.05, 0.10)
        else:
            k, rho, q = rng.uniform(1.03, 1.30), rng.uniform(0.05, 0.12), rng.uniform(-0.10, 0.0)
        divs = ((int(rng.integers(0, min(8, days))), round(float(rng.uniform(0.2, 2.5)), 4)),) if u() < 0.4 else ()
        return dict(is_call=is_call, k=k, days=days, rho=rho, q=q, sigma=_loguniform(rng, 0.1, 0.6), divs=divs)
    if group == "X1-outside":
        # Stress: each case breaks one domain rule; the baseline must refuse, and anything it serves is scored.
        rule = int(rng.integers(0, 4))
        days = _days(rng, 5, 400)
        base = dict(is_call=u() < 0.5, k=math.exp(rng.normal(0, 0.2)), days=days, rho=rng.uniform(0.0, 0.10),
                    q=rng.uniform(-0.05, 0.05), sigma=_loguniform(rng, 0.1, 1.0), divs=())
        if rule == 0:
            base["q"] = float(rng.choice([-1, 1])) * rng.uniform(0.101, 1.0)
        elif rule == 1:
            base["divs"] = ((int(rng.integers(0, min(10, days))), round(float(rng.uniform(3.01, 30.0)), 4)),)
            base["is_call"] = True
        elif rule == 2:
            d0 = int(rng.integers(0, max(1, min(30, days - 5))))
            base["divs"] = tuple((d0 + j, 1.2) for j in range(3))
        else:
            base["sigma"] = rng.uniform(5.01, 8.0) if u() < 0.5 else rng.uniform(0.0001, 0.00099)
        return base
    raise ValueError(group)


GROUPS = {
    # name: (kind, must be in domain, avoid simple exemptions)
    "G0-exempt": ("random", True, False),
    "G1-nodiv": ("random", True, True),
    "G2-dividends": ("random", True, True),
    "G3-carry-itm": ("random", True, True),
    "G4-negrate": ("random", True, True),
    "G5-extreme-vol": ("random", True, True),
    "G6-long": ("random", True, True),
    "T1-near-boundary": ("targeted", True, True),
    "X1-outside": ("stress", False, False),
}
IN_DOMAIN_GROUPS = [g for g, (_, inside, _) in GROUPS.items() if inside]
RANDOM_IN_DOMAIN_GROUPS = [g for g, (kind, inside, _) in GROUPS.items() if inside and kind == "random"]


def case(seed: int, group: str, i: int) -> Case:
    kind, inside, avoid = GROUPS[group]
    gid = list(GROUPS).index(group)
    rng = np.random.default_rng([seed, gid, i])
    for _ in range(10_000):
        p = _draw(group, rng)
        c = Case(id=f"{group}/{i}", group=group, kind=kind, is_call=bool(p["is_call"]), spot=SPOT,
                 strike=round(SPOT * float(p["k"]), 6), days=int(p["days"]), rho=round(float(p["rho"]), 8),
                 q=round(float(p["q"]), 8), sigma=round(float(p["sigma"]), 8), divs=tuple(p.get("divs", ())))
        why = domain_reason(c)
        if inside and why is not None:
            continue
        if not inside and (why is None or c.spot - c.pv() <= 0):
            continue
        if group == "G0-exempt" and not exempt_simple(c):
            continue
        if avoid and exempt_simple(c):
            continue
        return c
    raise RuntimeError(f"no case drawn for {group}/{i}")


# ── named regressions (exact inputs from the build thread's design record) ───

def _named(name, is_call, k, days, rho, q, sigma, divs, note, expect) -> Case:
    return Case(id=f"named/{name}", group="named", kind="named", is_call=is_call, spot=SPOT, strike=k, days=days,
                rho=rho, q=q, sigma=sigma, divs=tuple(divs), note=note, expect=expect)


NAMED = [
    _named("DR-47", True, 92.33030328002155, 90, 0.0973510107851791, 0.0, 0.922860889836401,
           [(3, 28.249649080935125)], "one dividend of 28% of the price on day 3", "refused:domain"),
    _named("DR-48", True, 92.33030328002155, 90, 0.0973510107851791, 0.0, 0.922860889836401,
           [(3, 28.249649080935125 / 10 + (i - 4.5) * 0.001) for i in range(10)],
           "DR-47's dividend as ten day-3 payments", "refused:domain"),
    _named("DR-49", False, 109.39, 90, 0.11, -0.82, 0.32, [(4, 1.01)],
           "put, q -82%: 180 and 360 steps share a false root exercise", "refused:domain"),
    _named("DR-50", False, 109.78, 90, 0.11, -0.82, 0.32, [(4, 1.01)],
           "put, q -82%: 180, 360 and 720 steps share a false root exercise", "refused:domain"),
    _named("B8", True, 87.03281448090632, 341, 0.02436936153335026, 0.0, 0.12057305288130349, [(2, 2.5)],
           "call, dividend on day 2: rev 8 served delta 0.90591 against 0.90908", "served"),
    _named("B9a", False, 113.0, 60, 0.05, 0.0, 0.2, [],
           "put $0.0004 above its exercise value: rev 11 served delta -1 against -0.99733", "served:no-delta"),
    _named("B9b", False, 105.0, 60, 0.05, -0.25, 0.2, [],
           "put, q -25%: rev 11 served delta -0.90067 against -0.90371", "refused:domain"),
]


def suite(seed: int, per_group: dict[str, int] | int, named: bool = True) -> Iterator[Case]:
    if named:
        yield from NAMED
    for g in GROUPS:
        n = per_group if isinstance(per_group, int) else per_group.get(g, 0)
        for i in range(n):
            yield case(seed, g, i)
