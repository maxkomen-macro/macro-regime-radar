"""scripts/options_bench/controls_p3.py — Phase 3 exact controls, proved bounds and the QuantLib diagnostic.

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md, sections 7.3 to 7.6.
- C1, kernel and transformation check: the production FD Greeks in European mode (exercise off, no exempt
  route) against the closed forms; a returned value more than tol_G from the closed form is a failure (exact
  reference, no u).
- C2 for the FD reference: the reference study in European mode against the closed form; covered when
  |R_FD − exact| ≤ u_FD. Passes in a group when the 95% one-sided Clopper-Pearson upper limit of the miss
  rate is at most 1%.
- C2 for the lattice corroborator (DR-06, DR-13): the protected lattice has no European mode, so its estimator
  u_L is checked only on exempt contexts (every state of the quantity's stencil exempt), where the American
  lattice converges to the closed form: covered when |G_L − exact| ≤ u_L. The exempt population E has its own
  strata, drawn from fixed proposal populations of the bench generators on their own seed streams.
- Proved bounds (7.5): Δ_call ≥ 0, Δ_put ≤ 0, Γ ≥ 0, vega ≥ 0, V ≥ max(European, exercise now). No ±1 bound on
  delta (DR-01: with q < 0 a call's delta exceeds 1). A returned value past a bound by more than its own estimate
  is a confirmed failure.
- QuantLib (7.6): a third code's Greeks, diagnostic only, never a gate.
Everything synthetic: the cases come from the bench's generators (no market data).
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np

from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases, greek_reference as GR
from . import ql_escrowed as qe
from .score import clopper_pearson

C2_RATE_MAX = 0.01   # the 95% one-sided upper limit of the miss rate, at most this
STRATUM_MIN = 300    # an E-stratum's frozen size is at least this

# E strata: name → the bench group whose generator (and so parameter ranges) it uses; G0 is the bench's own.
E_STRATA = {"E-nodiv": "G1-nodiv", "E-div": "G2-dividends", "E-long": "G6-long", "E-vol": "G5-extreme-vol",
            "G0-exempt": "G0-exempt"}
E_STREAM = 100       # rng streams [seed, E_STREAM + stratum index, i]: disjoint from the groups' [seed, 0..8, i]


def to_ctx(c: cases.Case) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


# ── the exempt population E (fixed proposal populations, section 8.2 and DR-13) ──

def e_proposal(seed: int, stratum: str, i: int) -> cases.Case | None:
    """Proposal i of an E-stratum: one draw of the stratum's generator on its own stream, kept only when it is in
    the domain and om.exempt holds (the exempt sign conditions are imposed by this filter, inside the
    generator's own ranges; E-div keeps dividend calls only); None when the draw is rejected. One generator
    call per proposal, no redraw."""
    group = E_STRATA[stratum]
    sid = list(E_STRATA).index(stratum)
    rng = np.random.default_rng([seed, E_STREAM + sid, i])
    p = cases._draw(group, rng)
    c = cases.Case(id=f"{stratum}/{i}", group=stratum, kind="control", is_call=bool(p["is_call"]),
                   spot=cases.SPOT, strike=round(cases.SPOT * float(p["k"]), 6), days=int(p["days"]),
                   rho=round(float(p["rho"]), 8), q=round(float(p["q"]), 8), sigma=round(float(p["sigma"]), 8),
                   divs=tuple(p.get("divs", ())))
    if cases.domain_reason(c) is not None:
        return None
    if stratum == "E-div" and not (c.is_call and c.divs):   # calls whose dividends meet om.exempt's condition
        return None
    x = to_ctx(c)
    if om.in_domain(x) is not None or not om.exempt(x):
        return None
    return c


def e_population(seed: int, stratum: str, proposals: int) -> list[cases.Case]:
    """The kept proposals of a fixed population of `proposals` draws, in proposal order."""
    out = []
    for i in range(proposals):
        c = e_proposal(seed, stratum, i)
        if c is not None:
            out.append(c)
    return out


def stencil_exempt(c: om.Context, quantity: str, cfg: G.GreekConfig = G.GreekConfig()) -> bool:
    """Whether every state of the quantity's reference stencil is exempt (or at expiry): only then is the closed
    form an exact American reference for the lattice side."""
    sp = GR.spec(c, quantity, cfg)
    if isinstance(sp, str):
        return False
    return all(s.days == 0 or om.exempt(s) for s in sp.states)


# ── exact values ───────────────────────────────────────────────────────────

def exact(c: om.Context, quantity: str) -> float:
    """The closed form of a quantity (section 7.3), in the bench's units."""
    cf = G.closed_forms(c)
    return cf["value"] if quantity == GR.PRICE else cf[quantity]


def _judge_exact(g: float, ex: float, tol: float) -> str:
    return "pass" if abs(g - ex) <= tol else "fail"


# ── C1: production FD, European mode, against the closed forms ─────────────

def c1(c: om.Context, cfg: G.GreekConfig = G.GreekConfig()) -> dict:
    """Every Greek of the production FD in European mode, judged against its closed form at tol_G."""
    got = G.greeks(c, cfg, american=False)
    out = {}
    for g in G.GREEKS:
        a = got[g]
        if a.status != G.RETURNED:
            out[g] = {"status": a.status, "reason": a.reason}
            continue
        ex = exact(c, g)
        tol = G.tolerance(g, ex, c.spot)
        out[g] = {"status": a.status, "value": a.value, "exact": ex, "tol": tol, "err_over_tol": abs(a.value - ex) / tol,
                  "result": _judge_exact(a.value, ex, tol)}
    out["_units"] = got["_units"]
    return out


# ── C2: reference adequacy ─────────────────────────────────────────────────

def c2_fd(c: om.Context, cfg: G.GreekConfig = G.GreekConfig(), quantities=GR.QUANTITIES, cap=GR.REF_WORK_CAP) -> dict:
    """The FD reference study in European mode against the closed form: covered when |R_FD − exact| ≤ u_FD."""
    refs = GR.references(c, cfg, quantities, american=False, cap=cap)
    out = {}
    for k in quantities:
        r = refs[k]
        if "R_FD" not in r:
            out[k] = {"status": r["status"]}
            continue
        ex = exact(c, k)
        err = abs(r["R_FD"] - ex)
        out[k] = {"status": "scored", "R_FD": r["R_FD"], "u_FD": r["u_FD"], "exact": ex, "err": err,
                  "covered": err <= r["u_FD"], "flags": r["fd"]["flags"]}
    out["_work"] = refs["_work"]
    return out


def c2_lattice(c: om.Context, cfg: G.GreekConfig = G.GreekConfig(), quantities=GR.QUANTITIES,
               cap=GR.REF_WORK_CAP) -> dict:
    """The lattice side alone on an exempt context against the closed form: covered when |G_L − exact| ≤ u_L.
    A quantity whose stencil crosses the exemption boundary is not a control for the lattice ("not exempt")."""
    budget = GR.RefBudget(cap)
    r = GR.Runner(budget, american=True)
    out = {}
    for k in quantities:
        sp = GR.spec(c, k, cfg)
        if isinstance(sp, str):
            out[k] = {"status": sp}
            continue
        if not stencil_exempt(c, k, cfg):
            out[k] = {"status": "not exempt"}
            continue
        ex = exact(c, k)
        tol = GR._tol(k, ex, c.spot)
        try:
            lat = GR.lattice_seq(r, c, sp, tol)
        except GR.CapHit as e:
            out[k] = {"status": GR.R_CAP, "detail": str(e)}
            continue
        if lat["G"] is None:
            out[k] = {"status": "unresolved: " + "; ".join(lat["flags"])}
            continue
        u = lat["u_seq"] + lat["u_bump"]
        err = abs(lat["G"] - ex)
        out[k] = {"status": "scored", "G_L": lat["G"], "u_L": u, "exact": ex, "err": err, "covered": err <= u,
                  "within_budget": lat["u_seq"] <= GR.U_REF_MAX * tol and lat["u_bump"] <= GR.U_BUMP_MAX * tol}
    out["_work"] = {"used": budget.used, "lattice_calls": budget.lattice_calls}
    return out


def c2_q(c: om.Context, cfg: G.GreekConfig = G.GreekConfig(), quantities=GR.QUANTITIES, cap=GR.REF_WORK_CAP) -> dict:
    """C2-Q (P3-AM2, section E): Q in European mode, with exactly the estimator of section C (the escalation
    included), against the closed form: covered when |R_Q,E − exact| ≤ u_Q,E = u_Q,ref + u_Q,bump. A sequence
    that does not converge is "unresolved: Q sequence not converging", reported and never a pass. The study runs
    with the reference budgets, so it escalates exactly as in American use; coverage is then checked on the
    stated estimate whatever its size ("within_budget" says whether it would have qualified)."""
    budget = GR.RefBudget(cap)
    cache: dict = {}
    out = {}
    for k in quantities:
        sp = GR.spec(c, k, cfg)
        if isinstance(sp, str) or c.days == 0:
            out[k] = {"status": sp if isinstance(sp, str) else G.R_EXPIRY}
            continue
        ex = exact(c, k)
        tol = GR._tol(k, ex, c.spot)
        try:
            q = qe.study(c, sp, tol, False, budget.take, cache)
        except GR.CapHit as e:
            out[k] = {"status": GR.R_CAP, "detail": str(e)}
            continue
        if q["G"] is None or q["u_ref"] is None:
            out[k] = {"status": "unresolved: " + "; ".join(q["flags"]), "levels": q["levels"], "values": q["values"]}
            continue
        u = q["u_ref"] + q["u_bump"]
        err = abs(q["G"] - ex)
        out[k] = {"status": "scored", "G_Q": q["G"], "u_Q": u, "exact": ex, "err": err, "covered": err <= u,
                  "levels": q["levels"], "within_budget": q["u_ref"] <= GR.U_REF_MAX * tol
                  and q["u_bump"] <= GR.U_BUMP_MAX * tol}
    out["_work"] = {"used": budget.used}
    return out


def c2_verdict(rows: list[dict]) -> dict:
    """Per quantity: scored count, misses, the one-sided 95% upper limit and pass/fail at 1%. A stratum below
    STRATUM_MIN scored values is "not established"."""
    out = {}
    names = sorted({k for r in rows for k in r if not k.startswith("_")})
    for k in names:
        scored = [r[k] for r in rows if k in r and r[k].get("status") == "scored"]
        n, miss = len(scored), sum(1 for s in scored if not s["covered"])
        upper = clopper_pearson(miss, n)[2] if n else math.nan
        verdict = ("not established" if n < STRATUM_MIN else ("pass" if upper <= C2_RATE_MAX else "fail"))
        out[k] = {"scored": n, "misses": miss, "upper_95": upper, "verdict": verdict,
                  "unscored": sum(1 for r in rows if k in r and r[k].get("status") != "scored")}
    return out


# ── proved bounds (section 7.5) ────────────────────────────────────────────

def bound_violations(c: om.Context, tier2, greeks: dict) -> list[str]:
    """Each proved bound a returned value breaks by more than its own estimate. `tier2` is Tier 2's answer (its
    price and delta), `greeks` the Greek block {greek: GreekAnswer}."""
    out = []
    est = lambda e: 0.0 if e is None else e
    if tier2 is not None and tier2.delta is not None:
        e = est(tier2.delta_estimate)
        if c.is_call and tier2.delta < -e:
            out.append("call delta below 0")
        if not c.is_call and tier2.delta > e:
            out.append("put delta above 0")
    for g, name in ((G.GAMMA, "gamma below 0"), (G.VEGA, "vega below 0")):
        a = greeks.get(g)
        if a is not None and a.value is not None and a.value < -est(a.estimate):
            out.append(name)
    if tier2 is not None and tier2.value is not None and c.days > 0 and om.in_domain(c) is None:
        sgn = 1.0 if c.is_call else -1.0
        floor = max(om.european(c), sgn * (c.spot - c.strike))
        if tier2.value < floor - est(tier2.estimate):
            out.append("value below max(European, exercise now)")
    return out


# ── QuantLib, diagnostic only (section 7.6) ────────────────────────────────

def quantlib_greeks(c: om.Context, cfg: G.GreekConfig = G.GreekConfig()) -> dict | None:
    """A third code's Greeks by bump and reprice on QuantLib's own American engines: QdFp without dividends,
    the escrowed Crank-Nicolson FD at q = 0 with dividends (its q ≠ 0 dividend convention differs); None when
    QuantLib is absent or the context is outside both. Never a reference and never a gate."""
    from .crosscheck import ql, quantlib
    if ql is None or (c.divs and c.q != 0.0):
        return None

    def v(x: om.Context) -> float | None:
        if x.days == 0:
            return G.intrinsic(x)
        got = quantlib(cases.Case(id="ql", group="ql", kind="control", is_call=x.is_call, spot=x.spot,
                                  strike=x.strike, days=x.days, rho=x.rho, q=x.q, sigma=x.sigma, divs=x.divs))
        return None if got is None else got.get("value")

    base = v(c)
    if base is None:
        return {"status": "refused"}
    out = {"value": base}
    hs = 0.01 * c.spot
    up, dn = v(replace(c, spot=c.spot + hs)), v(replace(c, spot=c.spot - hs))
    if up is not None and dn is not None:
        out[G.GAMMA] = (up - 2.0 * base + dn) / (hs * hs)
    for g in (G.VEGA, G.RHO):
        h = G.bump_size(c, g, cfg)
        a, b = v(G.bumped(c, g, h)), v(G.bumped(c, g, -h))
        if a is not None and b is not None:
            out[g] = (a - b) / (2.0 * h) * G.UNIT[g]
    if not (c.divs and min(d for d, _ in c.divs) == 0):
        one = v(G.one_day_later(c))
        if one is not None:
            out[G.THETA] = one - base
    return out
