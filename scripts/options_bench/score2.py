"""scripts/options_bench/score2.py — the Phase 2 scorecard: Tier 2 against every exit-gate row (test tooling).

    python -m scripts.options_bench.score2 P2_DIR [P2_DIR ...] [--out DIR]

Reads the phase2.py results (and, through their manifest, the reference run they were built on) and writes
scorecard2.json and scorecard2.md. Every case lands in exactly one population per quantity, and none is dropped.

The estimator-coverage statistic (design P2-2, 9.4) is conditional: for one frozen attempt, seed and group, it
is about Tier 2-accepted lattice contexts whose reference resolved and whose verdict is covered, confirmed or
unresolved. x = confirmed + unresolved, n = covered + confirmed + unresolved, and the one-sided 95%
Clopper-Pearson upper limit on x/n must be at most 1% in each of G1 to G6. Beside it, not gated: the
resolved-all limit (unscored cases counted as exceedances) and the all-accepted limit (unscored and
no-reference cases counted as exceedances). An unresolved reference is insufficient evidence, not proof that
the engine is wrong or right. Each limit is for its group alone (six limits are not a joint statement) and for
this attempt alone.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_math as om

from . import adaptive, cases, golden, phase2, reference, score
from .calibrate import BANDS, RANDOM, TARGET_ALL, TARGET_DELTA, TARGET_GROUP, band

COVERAGE_LIMIT = 0.01          # one-sided 95% upper limit on the exceedance rate
SCORED_MIN = 299               # fewer scored cases cannot show 1% at 95% even with none failing
PRICED = (oe.EXACT, oe.ANALYTIC, oe.ESTIMATED)


def _q(xs, p):
    return float(np.quantile(xs, p)) if xs else None


def _cp(x: int, n: int) -> float | None:
    return None if n == 0 else score.clopper_pearson(x, n)[2]


# ── one record ───────────────────────────────────────────────────────────────

def classify(rec: dict) -> dict:
    """One phase2 record's outcomes. Pure: the tests drive it with hand-made records."""
    c = rec["case"]
    out: dict = {"id": c["id"], "group": c["group"], "kind": c["kind"], "days": c["days"], "band": band(c["days"])}
    if "error" in rec:
        out["error"] = rec["error"]
        return out
    t = rec["tier2"]
    out.update(route=t["route"], status=t["price_status"], reason=t["reason"], delta_status=t["delta_status"],
               delta_reason=t["delta_reason"], units=t["units"], price_units=t.get("price_units"),
               delta_units=t.get("delta_units"), estimator=t.get("estimator"), delta_rule=t.get("delta_rule"),
               max_level_units=max((l[4] for l in t.get("levels", [])), default=0),
               tier1_matches=rec.get("tier1_matches"), repeat_identical=rec.get("repeat_identical"),
               r0_value=rec["r0"]["value"]["status"] == "reliable", r0_delta=rec["r0"]["delta"]["status"] == "reliable",
               r1="r1" in rec, proved_exceedance=bool(t.get("proved_exceedance")),
               interval_inconsistent=bool(t.get("interval_inconsistent")))
    priced = t["value"] is not None
    out["priced"] = priced
    if priced:
        out["inside_interval"] = rec.get("inside_interval")
        out["price_accuracy"] = rec.get("price_accuracy")
        pv = rec.get("price_verdict")
        if pv:
            out["price_pop"] = pv["verdict"]
            out["price_why"] = pv.get("why")
            if "err" in pv:
                out["price_err_tol"] = pv["err"] / rec["r0"]["value"]["tol"]
                out["price_err_est"] = pv["err"] / t["estimate"]
            if pv["verdict"] == adaptive.STRADDLE:   # R1 was not computed: a runner defect, never a pass
                out["price_pop"] = adaptive.UNSCORED
                out["price_why"] = "straddle without R1"
    if t["delta"] is not None:
        out["delta_accuracy"] = rec.get("delta_accuracy")
        dv = rec.get("delta_verdict")
        out["delta_has_estimate"] = t["delta_estimate"] is not None
        if dv:
            out["delta_pop"] = dv["verdict"] if dv["verdict"] != adaptive.STRADDLE else adaptive.UNSCORED
            out["delta_why"] = dv.get("why") if dv["verdict"] != adaptive.STRADDLE else "straddle without R1"
            if "err" in dv:
                out["delta_err"] = dv["err"]
    ds = rec.get("divsens")
    if ds:
        up, dn = ds["up"], ds["down"]
        tol = rec["r0"]["value"]["tol"]
        if up["tier2"]["value"] is None or dn["tier2"]["value"] is None:
            out["divsens"] = "refused"
        elif up["ref"]["status"] != "reliable" or dn["ref"]["status"] != "reliable":
            out["divsens"] = "unscored"
        else:
            err = abs((up["tier2"]["value"] - dn["tier2"]["value"]) - (up["ref"]["ref"] - dn["ref"]["ref"]))
            out["divsens_err_tol"] = err / tol
            out["divsens"] = score.judge(err, up["ref"]["u"] + dn["ref"]["u"], tol)
    ce = rec.get("control_european")
    if ce:
        out["control_eu_within_u"] = abs(ce["value"]["ref"] - ce["black76"]) <= ce["value"]["u"]
        out["control_eu_delta_within_u"] = abs(ce["delta"]["ref"] - ce["black76_delta"]) <= ce["delta"]["u"]
    cv = rec.get("convention")
    if cv and "skipped" not in cv and out["r0_value"] and cv["value"]["status"] == "reliable":
        out["convention_shift_tol"] = (cv["value"]["ref"] - rec["r0"]["value"]["ref"]) / rec["r0"]["value"]["tol"]
    out["sweep"] = {tau: s["price_status"] in PRICED for tau, s in (rec.get("sweep") or {}).items()}
    out["sweep_units"] = {tau: s["units"] for tau, s in (rec.get("sweep") or {}).items()}
    return out


# ── groups ───────────────────────────────────────────────────────────────────

def populations(rows: list[dict], field: str) -> dict:
    pop = Counter(r[field] for r in rows if field in r)
    cov, conf, unres = pop[adaptive.COVERED], pop[adaptive.CONFIRMED], pop[adaptive.UNRESOLVED]
    unsc, noref = pop[adaptive.UNSCORED], pop[adaptive.NO_REF]
    n, x = cov + conf + unres, conf + unres
    return {"populations": {p: pop[p] for p in adaptive.POPULATIONS}, "scored": n, "exceedances": x,
            "limit_conditional": _cp(x, n), "limit_resolved_all": _cp(x + unsc, n + unsc),
            "limit_all_accepted": _cp(x + unsc + noref, n + unsc + noref),
            "why": dict(Counter(r.get(field.replace("_pop", "_why")) for r in rows
                                if r.get(field) in (adaptive.UNRESOLVED, adaptive.UNSCORED)))}


def summary(rows: list[dict]) -> dict:
    ok = [r for r in rows if "error" not in r]
    lat = [r for r in ok if r["route"] == oe.ROUTE_LATTICE and r["status"] == oe.ESTIMATED]
    ana = [r for r in ok if r["route"] == oe.ROUTE_ANALYTIC]
    s: dict = {"cases": len(rows), "errors": sum("error" in r for r in rows)}
    s["routes"] = dict(Counter(f"{r['route']}: {r['status']}" for r in ok))
    s["refusals"] = dict(Counter(r["reason"] for r in ok if not r["priced"]))
    s["coverage"] = sum(r["priced"] for r in ok) / len(ok) if ok else None
    s["price_scored"] = sum(1 for r in lat if r["r0_value"])
    s["price"] = populations(lat, "price_pop")
    s["estimator_scored"] = s["price"]["scored"]
    acc = Counter(r.get("price_accuracy") for r in lat)
    s["price_accuracy"] = dict(acc) | {"limit": _cp(acc["fail"], acc["pass"] + acc["fail"])}
    errs = [r["price_err_tol"] for r in lat if "price_err_tol" in r]
    s["price_err_tol"] = {"p50": _q(errs, 0.5), "p99": _q(errs, 0.99), "max": max(errs) if errs else None}
    ests = [r["price_err_est"] for r in lat if "price_err_est" in r]
    s["price_err_over_estimate"] = {"p50": _q(ests, 0.5), "p99": _q(ests, 0.99), "max": max(ests) if ests else None}
    s["estimator"] = dict(Counter(r.get("estimator") for r in lat))
    s["analytic"] = {"cases": len(ana), "outside_interval": sum(r.get("inside_interval") is False for r in ana),
                     "accuracy": dict(Counter(r.get("price_accuracy") for r in ana))} | populations(ana, "price_pop")
    ex = [r for r in ok if r["route"] == oe.ROUTE_EXEMPT]
    s["exempt"] = {"cases": len(ex), "accuracy": dict(Counter(r.get("price_accuracy") for r in ex))}
    s["interval"] = {"served_outside": sum(r.get("inside_interval") is False for r in lat),
                     "proved_exceedances": sum(r["proved_exceedance"] for r in ok),
                     "inconsistent": sum(r["interval_inconsistent"] for r in ok),
                     "refused_outside": sum(r["reason"] == oa.OUTSIDE_INTERVAL for r in ok)}
    dl = [r for r in ok if r["delta_status"] == oe.SERVED and r.get("delta_has_estimate")]
    s["delta"] = populations(dl, "delta_pop")
    s["delta_estimator_scored"] = s["delta"]["scored"]
    dacc = Counter(r.get("delta_accuracy") for r in ok if r["delta_status"] == oe.SERVED)
    s["delta_accuracy"] = dict(dacc) | {"limit": _cp(dacc["fail"], dacc["pass"] + dacc["fail"])}
    derr = [r["delta_err"] for r in dl if "delta_err" in r]
    s["delta_err"] = {"p50": _q(derr, 0.5), "p99": _q(derr, 0.99), "max": max(derr) if derr else None}
    priced = [r for r in ok if r["priced"]]
    s["delta_shown"] = {"priced": len(priced), "shown": sum(r["delta_status"] == oe.SERVED for r in priced),
                        "rules": dict(Counter(r.get("delta_rule") for r in priced if r["delta_status"] == oe.SERVED)),
                        "withheld": dict(Counter(r["delta_reason"] for r in priced if r["delta_status"] != oe.SERVED))}
    s["divsens"] = dict(Counter(r["divsens"] for r in ok if "divsens" in r))
    s["divsens_err_tol_max"] = max((r["divsens_err_tol"] for r in ok if "divsens_err_tol" in r), default=None)
    units = [r["units"] for r in ok if r["priced"]]
    s["work"] = {"p50": _q(units, 0.5), "p95": _q(units, 0.95), "max": max(units) if units else None,
                 "max_level_units": max((r["max_level_units"] for r in ok), default=0),
                 "delta_only_p95": _q([r["delta_units"] for r in ok if r.get("delta_units")], 0.95)}
    s["sweep"] = {}
    for tau in ("1",) + tuple(str(x) for x in phase2.SWEEP):
        if tau == "1":
            s["sweep"][tau] = {"coverage": s["coverage"], "units_p50": s["work"]["p50"]}
            continue
        got = [r for r in ok if tau in r["sweep"]]
        s["sweep"][tau] = {"coverage": sum(r["sweep"][tau] for r in got) / len(got) if got else None,
                           "units_p50": _q([r["sweep_units"][tau] for r in got if r["sweep"][tau]], 0.5)}
    cs = [abs(r["convention_shift_tol"]) for r in ok if "convention_shift_tol" in r]
    s["convention"] = {"compared": len(cs), "abs_shift_tol_p50": _q(cs, 0.5), "abs_shift_tol_max": max(cs) if cs else None}
    s["references"] = {"r0_value_unresolved": sum(not r["r0_value"] for r in ok),
                       "r0_delta_unresolved": sum(not r["r0_delta"] for r in ok), "r1_computed": sum(r["r1"] for r in ok)}
    return s


# ── named regressions ────────────────────────────────────────────────────────

def tier2_named(r: dict) -> str:
    """Tier 2's outcome on a named case, in the merged bench's words."""
    exp = next(n for n in cases.NAMED if n.id == r["id"])
    if "error" in r:
        return "FAIL"
    got = ("refused:domain" if r["status"] == oe.OUTSIDE else "refused:input" if r["status"] == oe.INPUT
           else ("served" if r["delta_status"] == oe.SERVED else "served:no-delta") if r["priced"]
           else "refused:not-converged")
    delta = r.get("delta_accuracy") if r["delta_status"] == oe.SERVED else "withheld"
    return score.named_verdict(exp.expect, got, r.get("price_accuracy"), delta, r.get("delta_reason"), exp.expect_note)


def r1_regression() -> dict:
    ctx = adaptive.to_context(golden.R1)
    t2, t1 = oa.price(ctx), oe.baseline(ctx)
    lo, hi = t2.audit["L"], t2.audit["U"]
    ok = (t2.route == oe.ROUTE_ANALYTIC and t2.value == lo + (hi - lo) / 2 and lo <= t2.value <= hi
          and t1.value == 9.99969863054983)
    return {"tier2_value": t2.value, "tier2_estimate": t2.estimate, "tier2_route": t2.route, "tier1_value": t1.value,
            "pass": ok}


def golden_check() -> bool:
    with contextlib.redirect_stdout(io.StringIO()):
        return golden.main(["--check"]) == 0


# ── the gate ─────────────────────────────────────────────────────────────────

def _verdict(fail: bool, unresolved: bool, short: bool) -> str:
    return score._verdict(fail, unresolved, short)


def gate(groups: dict, rows: list[dict], integrity: dict, named: dict) -> dict:
    ok = [r for r in rows if "error" not in r]
    every = list(groups.values())
    tot = lambda f: sum(f(x) for x in every)
    rnd = {g: groups.get(g) for g in RANDOM}
    comps: dict = {}

    t1_bad = [r["id"] for r in ok if r["tier1_matches"] is not True]
    comps["tier1"] = {"golden_matches": integrity["golden"], "held_out_mismatches": t1_bad[:20],
                      "mismatch_count": len(t1_bad)}
    comps["tier1"]["verdict"] = _verdict(bool(t1_bad) or not integrity["golden"], False, not ok)

    per = {g: {"price_scored": x["price_scored"] if x else 0, "estimator_scored": x["estimator_scored"] if x else 0,
               "delta_estimator_scored": x["delta_estimator_scored"] if x else 0} for g, x in rnd.items()}
    agg_p = sum(v["price_scored"] for v in per.values())
    agg_e = sum(v["estimator_scored"] for v in per.values())
    short = [g for g, v in per.items() if v["price_scored"] < TARGET_GROUP or v["estimator_scored"] < TARGET_GROUP
             or v["delta_estimator_scored"] < TARGET_DELTA]
    comps["samples"] = {"per_group": per, "aggregate_price_scored": agg_p, "aggregate_estimator_scored": agg_e,
                        "targets": {"per_group": TARGET_GROUP, "aggregate": TARGET_ALL, "delta": TARGET_DELTA},
                        "short_groups": short}
    comps["samples"]["verdict"] = _verdict(False, False, bool(short) or agg_p < TARGET_ALL or agg_e < TARGET_ALL)

    fails = tot(lambda x: x["price_accuracy"].get("fail", 0))
    indet = tot(lambda x: x["price_accuracy"].get("indeterminate", 0))
    comps["price_accuracy"] = {"failures": fails, "indeterminate": indet,
                               "limits": {g: x["price_accuracy"]["limit"] for g, x in groups.items()}}
    comps["price_accuracy"]["verdict"] = _verdict(fails > 0, indet > 0, comps["samples"]["verdict"] != "pass")

    def coverage_row(field: str, count: int) -> dict:
        lim = {g: (x[field]["limit_conditional"] if x else None) for g, x in rnd.items()}
        few = [g for g, x in rnd.items() if not x or x[field]["scored"] < max(SCORED_MIN, count)]
        # a short group is "insufficient sample" (the attempt fails that row either way); its limit is shown
        over = [g for g, v in lim.items() if v is not None and v > COVERAGE_LIMIT and g not in few]
        row = {"limit_conditional": lim, "over": over, "short": few,
               "limit_resolved_all": {g: (x[field]["limit_resolved_all"] if x else None) for g, x in rnd.items()},
               "limit_all_accepted": {g: (x[field]["limit_all_accepted"] if x else None) for g, x in rnd.items()},
               "populations": {g: (x[field]["populations"] if x else None) for g, x in groups.items()}}
        row["verdict"] = _verdict(bool(over), False, bool(few))
        return row

    comps["estimator_coverage_price"] = coverage_row("price", TARGET_GROUP)
    comps["estimator_coverage_delta"] = coverage_row("delta", TARGET_DELTA)

    a_out = tot(lambda x: x["analytic"]["outside_interval"])
    a_pop = Counter()
    for x in every:
        a_pop.update(x["analytic"]["populations"])
    a_fail = tot(lambda x: x["analytic"]["accuracy"].get("fail", 0))
    comps["analytic"] = {"cases": tot(lambda x: x["analytic"]["cases"]), "outside_interval": a_out,
                         "populations": dict(a_pop), "accuracy_failures": a_fail}
    comps["analytic"]["verdict"] = _verdict(a_out > 0 or a_pop[adaptive.CONFIRMED] > 0 or a_fail > 0,
                                            a_pop[adaptive.UNRESOLVED] > 0, comps["analytic"]["cases"] == 0)

    iv = {k: tot(lambda x, k=k: x["interval"][k]) for k in ("served_outside", "proved_exceedances", "inconsistent",
                                                           "refused_outside")}
    comps["interval"] = iv | {"verdict": _verdict(iv["served_outside"] + iv["proved_exceedances"] + iv["inconsistent"] > 0,
                                                  False, not ok)}

    d_fail = tot(lambda x: x["delta_accuracy"].get("fail", 0))
    d_ind = tot(lambda x: x["delta_accuracy"].get("indeterminate", 0))
    no_est = sum(1 for r in ok if r["delta_status"] == oe.SERVED and r["route"] != oe.ROUTE_EXEMPT
                 and not r.get("delta_has_estimate"))
    comps["delta"] = {"failures": d_fail, "indeterminate": d_ind, "served_without_estimate": no_est,
                      "withheld": {g: x["delta_shown"]["withheld"] for g, x in groups.items()}}
    comps["delta"]["verdict"] = _verdict(d_fail > 0 or no_est > 0, d_ind > 0,
                                         comps["estimator_coverage_delta"]["verdict"] == "insufficient")

    dv = Counter()
    for x in every:
        dv.update(x["divsens"])
    comps["divsens"] = {"outcome": dict(dv), "scored": dv["pass"] + dv["fail"], "target": score.DIVSENS_TARGET}
    comps["divsens"]["verdict"] = _verdict(dv["fail"] > 0, dv["indeterminate"] > 0,
                                           comps["divsens"]["scored"] < score.DIVSENS_TARGET)

    eu = [r for r in ok if "control_eu_within_u" in r]
    outside = sum(not r["control_eu_within_u"] for r in eu) + sum(not r["control_eu_delta_within_u"] for r in eu)
    comps["references"] = {"european_controls": len(eu), "controls_outside_u": outside,
                           "r0_value_unresolved": tot(lambda x: x["references"]["r0_value_unresolved"]),
                           "r1_computed": tot(lambda x: x["references"]["r1_computed"])}
    comps["references"]["verdict"] = _verdict(outside > 0, False, not eu)

    comps["named"] = named
    comps["named"]["verdict"] = _verdict(bool(named["failures"]) or not named["r1"]["pass"], bool(named["unresolved"]),
                                         bool(named["missing"]))

    rep = [r for r in ok if r.get("repeat_identical") is not None]
    comps["run"] = integrity | {"repeated": len(rep), "repeat_differs": sum(not r["repeat_identical"] for r in rep),
                                "crashes": sum("error" in r for r in rows)}
    comps["run"]["verdict"] = _verdict(comps["run"]["crashes"] > 0 or comps["run"]["repeat_differs"] > 0
                                       or not integrity["hashes_match_freeze"], False,
                                       not integrity["complete"] or not rep)

    big = max((x["work"]["max_level_units"] for x in every), default=0)
    comps["work"] = {"max_level_units": big, "cap": om.REFINE_UNITS_MAX}
    comps["work"]["verdict"] = _verdict(big > om.REFINE_UNITS_MAX, False, False)

    worst = min((x["verdict"] for x in comps.values()), key=score.VERDICT_ORDER.index)
    return {"components": comps, "verdict": score.OVERALL[worst], "met": worst == "pass"}


NAMES = {"tier1": "Tier 1 unchanged", "samples": "Sample counts", "price_accuracy": "Tier 2 price accuracy",
         "estimator_coverage_price": "Estimator coverage, price (area 6)",
         "estimator_coverage_delta": "Estimator coverage, delta (area 6)", "analytic": "Analytic route",
         "interval": "Proved interval (lattice)", "delta": "Displayed delta (area 4)",
         "divsens": "Dividend scenario (area 5)", "references": "Reference reliability (area 1)",
         "named": "Named regressions", "run": "Determinism and run integrity", "work": "Work, per context"}


# ── the scorecard ────────────────────────────────────────────────────────────

def score_dirs(dirs: list[Path]) -> dict:
    recs, mans = [], []
    for d in dirs:
        for p in sorted(d.glob("results-*.jsonl")):
            rs, truncated = score.read_results(p)
            if truncated:
                raise SystemExit(f"{p} ends in a partial record: resume the run first")
            recs += rs
        mans += [json.loads(p.read_text()) for p in sorted(d.glob("manifest-*.json"))]
    if not mans:
        raise SystemExit("no manifest: these results cannot be traced to a run")
    first = mans[0]
    for m in mans[1:]:
        if any(m.get(k) != first.get(k) for k in ("freeze_sha256", "config", "files_sha256", "refs_manifests")):
            raise SystemExit("shards from different runs: score them separately")
    freeze = json.loads(Path(first["freeze"]).read_text())
    ids = [r["case"]["id"] for r in recs]
    refs, _ = phase2.read_refs(Path(first["refs"]))
    expected = {r["case"]["id"] for r in refs}
    n_shard = int(first["shard"].split("/")[1])
    integrity = {"hashes_match_freeze": phase2.sha(Path(first["freeze"])) == first["freeze_sha256"]
                 and all(m["files_sha256"] == freeze["files_sha256"] for m in mans) and not phase2.check_freeze(freeze),
                 "complete": set(ids) == expected and len(ids) == len(set(ids)) and all(m.get("finished_utc") for m in mans)
                 and len({m["shard"] for m in mans}) == n_shard,
                 "expected": len(expected), "received": len(ids), "duplicates": len(ids) - len(set(ids)),
                 "golden": golden_check(), "held_out": first["held_out"]}
    rows = [classify(r) for r in recs]
    by = defaultdict(list)
    for r in rows:
        by[r["group"]].append(r)
    groups = {g: summary(by[g]) for g in list(cases.GROUPS) + ["named"] if g in by}
    bands = {}
    for g in cases.IN_DOMAIN_GROUPS:
        for lo, hi in BANDS:
            b = f"{lo}-{hi}"
            rs = [r for r in by.get(g, []) if r["band"] == b]
            if rs:
                s = summary(rs)
                short_sched = sum(r.get("reason") == oa.SHORT for r in rs if "error" not in r)
                s["label"] = ("unsupported" if s["coverage"] == 0 or short_sched == len(rs) else
                              "partial" if s["estimator_scored"] < SCORED_MIN else "covered")
                bands[f"{g} {b}"] = s
    named_rows = [r for r in by.get("named", [])]
    named = {"tier2": {r["id"]: tier2_named(r) for r in named_rows}, "r1": r1_regression()}
    base = {}
    for r in refs:
        if r["case"]["group"] == "named":
            k = score.classify(r)
            exp = next(n for n in cases.NAMED if n.id == r["case"]["id"])
            got = k.get("engine_status")
            got = "served:no-delta" if got == "served" and k["delta"] == "withheld" else got
            base[k["id"]] = score.named_verdict(exp.expect, got, k.get("price"), k.get("delta"), k.get("delta_note"),
                                                exp.expect_note)
    named["tier1"] = base
    named["missing"] = sorted({n.id for n in cases.NAMED} - set(named["tier2"]))
    named["failures"] = sorted(i for d in (named["tier2"], named["tier1"]) for i, v in d.items() if v == "FAIL")
    named["unresolved"] = sorted(i for d in (named["tier2"], named["tier1"]) for i, v in d.items() if v == "unresolved")
    random_rows = [r for g in RANDOM for r in by.get(g, [])]
    overall = summary(random_rows) if random_rows else None
    gt = gate(groups, rows, integrity, named)
    return {"scorer": "scripts/options_bench/score2.py", "freeze": first["freeze"], "freeze_sha256": first["freeze_sha256"],
            "config": first["config"], "engine_version": first["engine_version"], "held_out": first["held_out"],
            "seed": sorted({m["seed"] for m in first["refs_manifests"]}), "attempt": freeze.get("phase"),
            "integrity": integrity, "groups": groups, "bands": bands, "overall_random": overall, "gate": gt,
            "provenance": "Claude's recorded run unless Codex reproduces it"}


def _f(x, nd=3):
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.{nd}g}"
    return str(x)


def markdown(sc: dict) -> str:
    g = sc["gate"]
    L = [f"# Phase 2 scorecard (Tier 2 convergence controller)", "",
         f"- Attempt: {sc['attempt']}; seed {sc['seed']}; {'held-out' if sc['held_out'] else 'development (not held-out)'}",
         f"- Configuration: {json.dumps(sc['config'])}; engine {sc['engine_version']}",
         f"- Freeze: `{sc['freeze']}` (sha256 {sc['freeze_sha256'][:12]}…)",
         f"- Provenance: {sc['provenance']}.",
         f"- **Gate verdict: {g['verdict']}**", "",
         "Every limit is a one-sided 95% Clopper–Pearson upper limit for that group alone, under this frozen "
         "attempt and seed; six limits are not a joint statement. The estimator-coverage limit is conditional on "
         "Tier 2 acceptance and reference resolution (covered, confirmed and unresolved cases); the resolved-all and "
         "all-accepted limits are reported beside it and not gated. An unresolved reference is insufficient "
         "evidence, not proof that the engine is wrong or right.", "",
         "| Row | Verdict |", "|---|---|"]
    for k, c in g["components"].items():
        L.append(f"| {NAMES.get(k, k)} | {c['verdict']} |")
    L += ["", "## Estimator coverage by group", "",
          "| Group | Lattice accepted | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional limit | Resolved-all | All-accepted |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for name, x in sc["groups"].items():
        p = x["price"]
        pp = p["populations"]
        L.append(f"| {name} | {sum(pp.values())} | {pp['covered']} | {pp['confirmed']} | {pp['unresolved']} | "
                 f"{pp['unscored']} | {pp['no reference']} | {_f(p['limit_conditional'])} | "
                 f"{_f(p['limit_resolved_all'])} | {_f(p['limit_all_accepted'])} |")
    L += ["", "## Delta estimator coverage by group", "",
          "| Group | Deltas with an estimate | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional limit | Withheld (top reasons) |",
          "|---|---|---|---|---|---|---|---|---|"]
    for name, x in sc["groups"].items():
        p = x["delta"]
        pp = p["populations"]
        wh = ", ".join(f"{k}: {v}" for k, v in sorted(x["delta_shown"]["withheld"].items(), key=lambda kv: -kv[1])[:3])
        L.append(f"| {name} | {sum(pp.values())} | {pp['covered']} | {pp['confirmed']} | {pp['unresolved']} | "
                 f"{pp['unscored']} | {pp['no reference']} | {_f(p['limit_conditional'])} | {wh} |")
    L += ["", "## Coverage and work by group and maturity band (report only)", "",
          "| Group, band | Cases | Tier 2 priced | Label | Work p50 | p95 | max | Refusals |", "|---|---|---|---|---|---|---|---|"]
    for name, x in sc["bands"].items():
        ref = ", ".join(f"{k}: {v}" for k, v in sorted(x["refusals"].items(), key=lambda kv: -kv[1])[:3])
        L.append(f"| {name} | {x['cases']} | {_f(x['coverage'])} | {x['label']} | {_f(x['work']['p50'])} | "
                 f"{_f(x['work']['p95'])} | {_f(x['work']['max'])} | {ref} |")
    L += ["", "## Targets below tol (report only)", "", "| Group | τ = 1 | 0.5 | 0.25 | 0.1 |", "|---|---|---|---|---|"]
    for name, x in sc["groups"].items():
        L.append(f"| {name} | " + " | ".join(_f(x["sweep"][t]["coverage"]) for t in ("1", "0.5", "0.25", "0.1")) + " |")
    L += ["", "## Gate rows in detail", "", "```", json.dumps(g["components"], indent=1, default=str)[:20000], "```", ""]
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    sc = score_dirs([Path(d) for d in args.dirs])
    out = Path(args.out or args.dirs[0])
    (out / "scorecard2.json").write_text(json.dumps(sc, indent=1, default=str))
    (out / "scorecard2.md").write_text(markdown(sc))
    print(sc["gate"]["verdict"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
