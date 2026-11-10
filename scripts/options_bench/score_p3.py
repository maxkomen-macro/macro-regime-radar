"""scripts/options_bench/score_p3.py — the Phase 3 scorer: Greek pairs, the cross-check, C1, X1 (test tooling).

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md, sections 7.2 (item 4), 7.4, 7.5, 8.3 and
8.4. Pure functions over the run records that run_p3.py writes (one per case); nothing here computes a price.

A returned Greek (status "returned", "exact (exempt)" or "exact (exercised now)") is scored against, in order:
an exact control (the closed form when every state of its stencil is exempt; zero for gamma, vega, rho and the
dividend sensitivity when both methods agree the spot is exercised now), else the corroborated reference when
it is resolved; otherwise it is "returned, unscored" with the reference's reason. pass when |g − R| ≤ tol − u,
confirmed failure beyond tol + u, a straddle in between (a straddle blocks; it is never a pass). An estimator
coverage miss is |g − R| > E_G among the returned and scored. A proved-bound violation is a confirmed failure.

Per (G, g): validated (0 failures, 0 straddles, 0 bound violations, ≥ 300 returned and scored, returned-unscored
≤ 5% of returned, the coverage miss rate's 95% one-sided upper limit ≤ 1%); failed (any failure, straddle,
bound violation or coverage breach); not established otherwise. Every share in the report uses the full
applicable population as its denominator.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict

from src.desk import options_adaptive as oa
from src.desk import options_greeks as G

from .score import clopper_pearson

SCORED_MIN = 300
UNSCORED_MAX = 0.05
COVERAGE_MAX = 0.01
RETURNED = (G.RETURNED, G.EXACT_EXEMPT, G.EXACT_EXERCISED)
PRICE = "price"


def judge(g: float, R: float, u: float, tol: float) -> str:
    d = abs(g - R)
    if d <= tol - u:
        return "pass"
    if d > tol + u:
        return "fail"
    return "straddle"


def greek_reference(rec: dict, greek: str) -> tuple[float, float, str] | str:
    """(R, u, source) for a returned Greek of this record, or why it has none."""
    ex = rec.get("exact", {})
    if greek in ex:
        return ex[greek], 0.0, "exact (closed form)"
    a = rec["greeks"][greek]
    if a["status"] == G.EXACT_EXERCISED and rec.get("tier2_deep_exercise") and greek != G.THETA:
        return 0.0, 0.0, "exact (exercised now, both methods)"
    r = rec.get("refs", {}).get(greek)
    if r is None:
        return "no reference"
    if r.get("status") != "resolved":
        return r.get("status", "no reference")
    return r["R"], r["u"], "corroborated"


def score_greek(rec: dict, greek: str) -> dict:
    """One record's outcome for one Greek: "not applicable", "outside" (Ω_G reason), "withheld", "returned"
    with "result" pass / fail / straddle / unscored, plus coverage and bound flags."""
    a = rec["greeks"][greek]
    if greek == G.DIVIDEND and not rec["case"]["divs"]:
        return {"outcome": "not applicable"}
    region = rec.get("regions", {}).get(greek)
    if a["status"] not in RETURNED:
        reason = a.get("reason") or "withheld"
        return {"outcome": "outside" if region is not None else "withheld", "reason": reason}
    out = {"outcome": "returned", "in_region": region is None}
    ref = greek_reference(rec, greek)
    bound = [b for b in rec.get("bounds", []) if b.startswith(greek)]
    if bound:
        out["bound_violation"] = bound
    if isinstance(ref, str):
        out.update(result="unscored", reason=ref)
        return out
    R, u, src = ref
    tol = G.tolerance(greek, R, rec["case"]["spot"])
    err = abs(a["value"] - R)
    out.update(result="fail" if bound else judge(a["value"], R, u, tol), R=R, u=u, tol=tol, source=src,
               err_over_tol=err / tol, coverage_miss=err > (a["estimate"] or 0.0))
    return out


def pair_verdict(rows: list[dict]) -> dict:
    """8.3 over one (G, g)'s scored outcomes, with the 8.4 counts. `rows` are score_greek outputs of every
    applicable context of the pair inside Ω_G."""
    returned = [r for r in rows if r["outcome"] == "returned"]
    scored = [r for r in returned if r["result"] != "unscored"]
    fails = sum(1 for r in scored if r["result"] == "fail")
    straddles = sum(1 for r in scored if r["result"] == "straddle")
    bounds = sum(1 for r in returned if r.get("bound_violation"))
    unscored = len(returned) - len(scored)
    misses = sum(1 for r in scored if r.get("coverage_miss"))
    cov_upper = clopper_pearson(misses, len(scored))[2] if scored else math.nan
    coverage_breach = bool(scored) and cov_upper > COVERAGE_MAX and len(scored) >= SCORED_MIN
    if fails or straddles or bounds or coverage_breach:
        verdict = "failed"
    elif len(scored) < SCORED_MIN or (returned and unscored > UNSCORED_MAX * len(returned)):
        verdict = "not established"
    else:
        verdict = "validated"
    n = len(rows)
    bad_all = fails + straddles + unscored
    return {
        "applicable": n, "returned": len(returned), "scored": len(scored),
        "pass": sum(1 for r in scored if r["result"] == "pass"), "fail": fails, "straddle": straddles,
        "unscored": unscored, "bound_violations": bounds, "coverage_misses": misses, "coverage_upper_95": cov_upper,
        "withheld": dict(Counter(r["reason"] for r in rows if r["outcome"] == "withheld")),
        "unresolved_refs": dict(Counter(r["reason"] for r in returned if r["result"] == "unscored")),
        "coverage": len(returned) / n if n else math.nan,
        "all_returned_upper_95": clopper_pearson(bad_all, len(returned))[2] if returned else math.nan,
        "verdict": verdict,
    }


def score_greeks(records: list[dict], targeted: dict | None = None) -> dict:
    """Every (G, g) pair's verdict over the records inside Ω_G, the blocking results anywhere in Ω_G, and each
    Greek's standing: served in Ω_G only if every targeted pair is validated and nothing blocked."""
    by = defaultdict(list)
    outside = defaultdict(Counter)
    blocking = defaultdict(list)
    for rec in records:
        if rec["case"]["group"] == "X1-outside":
            continue
        g = rec["case"]["group"]
        for greek in G.GREEKS:
            s = score_greek(rec, greek)
            if s["outcome"] == "not applicable":
                continue
            if s["outcome"] == "outside" or (s["outcome"] == "returned" and not s["in_region"]):
                outside[(greek, g)][s.get("reason", "outside")] += 1
                continue
            by[(greek, g)].append(s)
            if s["outcome"] == "returned" and (s.get("result") in ("fail", "straddle") or s.get("bound_violation")):
                blocking[greek].append({"case": rec["case"]["id"], **{k: s[k] for k in ("result",) if k in s}})
    pairs = {f"{greek}|{g}": {**pair_verdict(rows), "outside_region": dict(outside[(greek, g)])}
             for (greek, g), rows in sorted(by.items())}
    standing = {}
    for greek in G.GREEKS:
        req = [p for p in (targeted or {}).get(greek, [])]
        bad = [p for p in req if pairs.get(f"{greek}|{p}", {}).get("verdict") != "validated"]
        standing[greek] = ("served in its region" if req and not bad and not blocking[greek]
                           else "not served" if req else "not targeted")
        if bad:
            standing[greek] += f" (pairs not validated: {', '.join(bad)})"
        if blocking[greek]:
            standing[greek] += f" (blocked by {len(blocking[greek])} results)"
    return {"pairs": pairs, "blocking": dict(blocking), "standing": standing}


# ── the cross-check (DR-07) ─────────────────────────────────────────────────

def _basis(r: dict) -> str:
    b = r["cross_check"].get("basis")
    if b:
        return b
    return oa.XC_BASIS_INTERVAL if r["tier2"].get("route") == "analytic-interval" else oa.XC_BASIS_POINT


def score_cross_check(records: list[dict]) -> dict:
    """Per group, among prices returned "cross-checked": V_T2 against the FD price reference (independent of the
    lattice) and V_FD against the corroborated price reference or an exact control; the rules of a Greek pair
    for both producers; the agreement shares at 0.5, 0.25 and 0.1·tol over every cross-checked price."""
    by = defaultdict(list)
    for rec in records:
        if rec["case"]["group"] != "X1-outside":
            by[rec["case"]["group"]].append(rec)
    out = {}
    for g, recs in sorted(by.items()):
        statuses = Counter((r["cross_check"]["status"], r["cross_check"].get("reason")) for r in recs)
        checked = [r for r in recs if r["cross_check"]["status"] == oa.XC_CHECKED]
        t2_rows, fd_rows = [], []
        for r in checked:
            v_t2, v_fd = r["tier2"]["value"], r["cross_check"]["v_fd"]
            pr = r.get("price_ref") or {}
            if pr.get("status") == "reliable":
                t2_rows.append({"outcome": "returned", "result": judge(v_t2, pr["ref"], pr["u"], pr["tol"])})
            else:
                t2_rows.append({"outcome": "returned", "result": "unscored", "reason": pr.get("status", "none")})
            ex = r.get("exact", {}).get(PRICE)
            cr = r.get("refs", {}).get(PRICE, {})
            if ex is not None:
                fd_rows.append({"outcome": "returned", "result": judge(v_fd, ex, 0.0, r["cross_check"]["tol"])})
            elif cr.get("status") == "resolved":
                fd_rows.append({"outcome": "returned", "result": judge(v_fd, cr["R"], cr["u"], cr["tol"])})
            else:
                fd_rows.append({"outcome": "returned", "result": "unscored", "reason": cr.get("status", "none")})
        t2, fdv = pair_verdict(t2_rows), pair_verdict(fd_rows)
        both = sum(1 for a, b in zip(t2_rows, fd_rows) if a["result"] != "unscored" and b["result"] != "unscored")
        unscored = len(checked) - both
        if t2["fail"] or t2["straddle"] or fdv["fail"] or fdv["straddle"]:
            verdict = "failed"
        elif both < SCORED_MIN or (checked and unscored > UNSCORED_MAX * len(checked)):
            verdict = "not established"
        else:
            verdict = "validated"
        diffs = [r["cross_check"]["diff"] / r["cross_check"]["tol"] for r in checked]
        # P3-AM1 (P3-A11): an analytic price's "cross-checked" is interval consistency, a lattice price's is point
        # agreement; they are counted apart and never read as the same claim
        basis = Counter(_basis(r) for r in checked)
        out[g] = {"contexts": len(recs), "statuses": {f"{s}: {w}" if w else s: n for (s, w), n in statuses.items()},
                  "cross_checked": len(checked), "cross_checked_by_basis": dict(basis), "scored_both": both, "tier2": t2, "fd": fdv, "verdict": verdict,
                  "shares": {str(f): (sum(1 for d in diffs if d <= f) / len(diffs) if diffs else math.nan)
                             for f in oa.XC_SHARES}}
    return out


# ── C1 and X1 ───────────────────────────────────────────────────────────────

def score_c1(records: list[dict]) -> dict:
    returned = [(r["case"]["id"], g, v) for r in records for g, v in (r.get("c1") or {}).items()
                if not g.startswith("_") and v.get("status") == G.RETURNED]
    fails = [(cid, g) for cid, g, v in returned if v["result"] != "pass"]
    return {"returned": len(returned), "failures": fails, "verdict": "pass" if not fails else "failed"}


def score_x1(records: list[dict]) -> dict:
    got = [(r["case"]["id"], g) for r in records if r["case"]["group"] == "X1-outside"
           for g, a in r["greeks"].items() if a["status"] in RETURNED]
    return {"contexts": sum(1 for r in records if r["case"]["group"] == "X1-outside"), "returned": got,
            "verdict": "pass" if not got else "failed"}
