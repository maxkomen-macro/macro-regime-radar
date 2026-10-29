"""scripts/options_bench/score.py — turns run results into a scorecard (test tooling).

    python -m scripts.options_bench.score RUN_DIR [RUN_DIR ...] [--out DIR]

Writes scorecard.json and scorecard.md. Every case lands in exactly one outcome per quantity, and none is
dropped: refused, unscored (the reference is unresolved), pass, fail, or indeterminate (the reference's
uncertainty straddles the tolerance). A price passes when |V − R| + u <= tol and fails when |V − R| − u > tol;
the same rule for delta with its own tolerance. Clopper-Pearson limits treat the cases of a group as
independent draws from that group's sampling distribution: they say nothing about other distributions, about
real option chains, or about whole Finder requests.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import beta

from . import cases, reference

PER_GROUP_TARGET = 1000
OVERALL_TARGET = 10_000
LATTICE_DISPUTE_TOL = 0.05   # tolerances of slack on top of both uncertainties


def clopper_pearson(x: int, n: int, conf: float = 0.95) -> tuple[float, float, float]:
    """(two-sided lower, two-sided upper, one-sided upper) limits on a failure rate, x failures in n."""
    if n == 0:
        return (math.nan, math.nan, math.nan)
    a = 1.0 - conf
    lo = 0.0 if x == 0 else float(beta.ppf(a / 2, x, n - x + 1))
    hi = 1.0 if x == n else float(beta.ppf(1 - a / 2, x + 1, n - x))
    one = 1.0 if x == n else float(beta.ppf(conf, x + 1, n - x))
    return lo, hi, one


def judge(err: float, u: float, tol: float) -> str:
    if err + u <= tol:
        return "pass"
    if err - u > tol:
        return "fail"
    return "indeterminate"


def bound_outcome(premium: float, u: float, bound: float) -> str:
    """The bound-European route's claim: the early-exercise premium (American − European) is at most `bound`,
    judged against a resolved reference. An interval wholly above the bound is a violation and wholly inside it
    is covered, at any resolution. An interval across the bound is indeterminate only when the reference is at
    least ten times finer than the bound (REF_FRACTION, as prices are judged against tol); a coarser reference
    cannot tell a zero premium from one at the bound, so that case is unscored (review finding 1). Unscored is
    never evidence: the component needs covered cases to pass."""
    if premium - u > bound:
        return "violated"
    if premium + u <= bound:
        return "covered"
    return "unscored" if u > reference.REF_FRACTION * bound else "indeterminate"


def classify(rec: dict) -> dict:
    """One record's outcomes. Pure: the tests drive it with hand-made records."""
    out: dict = {"id": rec["case"]["id"], "group": rec["case"]["group"], "kind": rec["case"]["kind"]}
    if "error" in rec:
        out["error"] = rec["error"]
        if "engine" not in rec or "ref" not in rec:  # the price itself was never computed
            out.update(price="error", delta="error")
            return out
        # a later diagnostic crashed: the price and delta outcomes still stand, the crash is kept beside them
        # and holds the gate open (Codex OB-16)
    eng, rv, rd = rec["engine"], rec["ref"]["value"], rec["ref"]["delta"]
    out["engine_status"] = eng["status"]
    out["model"] = eng.get("model")
    out["units"] = eng.get("units")
    out["engine_secs"] = eng.get("secs")
    out["ref_value_status"] = rv["status"]
    out["ref_delta_status"] = rd["status"]
    tol = rv["tol"]
    out["tol"] = tol
    out["ref_u_tol"] = rv["u"] / tol if rv["u"] else None
    if eng["status"] != "served":
        out["price"] = "refused"
        out["delta"] = "refused"
    else:
        if rv["status"] != "reliable":
            out["price"] = "unscored"
            if eng.get("bound") is not None:
                out["bound"] = "unscored"
        else:
            err = abs(eng["value"] - rv["ref"])
            out["price_err_tol"] = err / tol
            out["price_u_tol"] = rv["u"] / tol
            out["price"] = judge(err, rv["u"], tol)
            if eng.get("bound") is not None:
                # the served value is European; covered only when the premium's whole interval is inside the
                # bound, an interval across it is indeterminate (Codex OB-14)
                out["bound"] = bound_outcome(rv["ref"] - eng["value"], rv["u"], eng["bound"])
        if eng.get("delta") is None:
            out["delta"] = "withheld"
            out["delta_note"] = eng.get("delta_note")
        elif rd["status"] != "reliable":
            out["delta"] = "unscored"
        else:
            err = abs(eng["delta"] - rd["ref"])
            out["delta_err"] = err
            out["delta"] = judge(err, rd["u"], reference.DELTA_TOL)
    if "error" in rec:
        # the diagnostics after the crash point may be missing or half written (one dividend bump of two,
        # say), so none of them is read; the crash holds the gate open (Codex OB-18)
        out["diagnostics"] = "incomplete"
        return out
    lat = rec.get("lattice")
    if lat and lat.get("value") is not None:
        diff = abs(lat["value"] - rv["ref"])
        out["lattice_diff_tol"] = diff / tol
        out["lattice_disputed"] = diff > rv["u"] + lat["change"] + LATTICE_DISPUTE_TOL * tol
    qlr = rec.get("quantlib")
    if qlr and qlr.get("value") is not None:
        out["quantlib_method"] = qlr["method"]
        out["quantlib_diff_tol"] = abs(qlr["value"] - rv["ref"]) / tol
    ce = rec.get("control_european")
    if ce:
        e = ce["value"]
        out["control_eu_err_over_u"] = abs(e["ref"] - ce["black76"]) / e["u"]
        out["control_eu_err_tol"] = abs(e["ref"] - ce["black76"]) / e["tol"]
        out["control_eu_reliable"] = e["status"] == "reliable"
        d = ce["delta"]
        out["control_eu_delta_err_over_u"] = abs(d["ref"] - ce["black76_delta"]) / d["u"]
    if out["group"] == "G0-exempt" and ce:
        out["exempt_american_err_over_u"] = abs(rv["ref"] - ce["black76"]) / rv["u"]
    iv = rec.get("iv")
    if iv:
        out["iv_status"] = iv["status"]
        if iv["status"] == "solved":
            vega = iv.get("vega")
            # identifiable: one volatility point moves the price by at least one tolerance
            out["iv_identifiable"] = vega is not None and abs(vega) * 0.01 >= tol
            out["iv_sigma_err"] = abs(iv["sigma_err"])
            if vega:
                out["iv_err_vega_tol"] = abs(iv["sigma_err"]) * abs(vega) / tol
            if iv.get("residual") is not None:
                out["iv_residual_tol"] = abs(iv["residual"]) / tol
    ds = rec.get("divsens")
    if ds:
        up, dn = ds["up"], ds["down"]
        if up["engine"]["status"] != "served" or dn["engine"]["status"] != "served":
            out["divsens"] = "refused"
        elif up["ref"]["status"] != "reliable" or dn["ref"]["status"] != "reliable":
            out["divsens"] = "unscored"
        else:
            d_eng = up["engine"]["value"] - dn["engine"]["value"]
            d_ref = up["ref"]["ref"] - dn["ref"]["ref"]
            err = abs(d_eng - d_ref)
            out["divsens_err_tol"] = err / tol
            out["divsens_move_tol"] = abs(d_ref) / tol
            out["divsens"] = judge(err, up["ref"]["u"] + dn["ref"]["u"], tol)
    cv = rec.get("convention")
    if cv and "skipped" in cv:
        out["convention_skipped"] = True
    elif cv:
        out["convention_shift_tol"] = (cv["value"]["ref"] - rv["ref"]) / tol
        out["convention_reliable"] = cv["value"]["status"] == "reliable" and rv["status"] == "reliable"
    return out


def _q(xs, p):
    return float(np.quantile(xs, p)) if xs else None


def _summary(rows: list[dict], sampled: bool = True) -> dict:
    """sampled=False (the named regressions): deterministic cases, so no sampling confidence limits (OB-15)."""
    s: dict = {"cases": len(rows), "sampled": sampled}
    s["engine"] = dict(Counter((r.get("engine_status") or "error") + (f" ({r['model']})" if r.get("model") else "") for r in rows))
    s["reference_value"] = dict(Counter("reliable" if r.get("ref_value_status") == "reliable" else "unresolved" for r in rows if "ref_value_status" in r))
    s["reference_value_reasons"] = dict(Counter(r["ref_value_status"] for r in rows if r.get("ref_value_status", "reliable") != "reliable"))
    s["price"] = dict(Counter(r["price"] for r in rows))
    s["delta"] = dict(Counter(r["delta"] for r in rows))
    acc = [r for r in rows if r["price"] in ("pass", "fail")]
    fails = sum(r["price"] == "fail" for r in rows)
    s["accepted_scored"] = len(acc)
    s["price_failures"] = fails
    s["clopper_pearson_95"] = clopper_pearson(fails, len(acc)) if sampled else None
    # conservative: every indeterminate outcome counted as a failure (Codex OB-17)
    indet = sum(r["price"] == "indeterminate" for r in rows)
    s["clopper_pearson_95_conservative"] = clopper_pearson(fails + indet, len(acc) + indet) if sampled else None
    s["price_indeterminate"] = indet
    s["errors"] = sum("error" in r for r in rows)
    errs = [r["price_err_tol"] for r in rows if "price_err_tol" in r]
    s["price_err_tol"] = {"p50": _q(errs, 0.5), "p99": _q(errs, 0.99), "max": max(errs) if errs else None}
    worst = sorted((r for r in rows if "price_err_tol" in r), key=lambda r: -r["price_err_tol"])[:3]
    s["price_worst"] = [{"id": r["id"], "err_tol": r["price_err_tol"], "u_tol": r["price_u_tol"]} for r in worst]
    derr = [r["delta_err"] for r in rows if "delta_err" in r]
    s["delta_err"] = {"p50": _q(derr, 0.5), "p99": _q(derr, 0.99), "max": max(derr) if derr else None}
    dacc = [r for r in rows if r["delta"] in ("pass", "fail")]
    s["delta_failures"] = sum(r["delta"] == "fail" for r in rows)
    s["delta_clopper_pearson_95"] = clopper_pearson(s["delta_failures"], len(dacc)) if sampled else None
    dind = sum(r["delta"] == "indeterminate" for r in rows)
    s["delta_clopper_pearson_95_conservative"] = (clopper_pearson(s["delta_failures"] + dind, len(dacc) + dind)
                                                  if sampled else None)
    s["delta_accepted_scored"] = len(dacc)
    s["delta_indeterminate"] = dind
    s["delta_withheld_notes"] = dict(Counter(r.get("delta_note") for r in rows if r["delta"] == "withheld"))
    # availability is reported apart from accuracy: withholding an unvalidated delta is correct behaviour
    served = [r for r in rows if r.get("engine_status") == "served"]
    shown = sum(r["delta"] != "withheld" for r in served)
    s["delta_availability"] = {"served": len(served), "shown": shown, "withheld": len(served) - shown,
                               "share_shown": shown / len(served) if served else None}
    units = [r["units"] for r in rows if r.get("units") is not None]
    s["work_units"] = {"p50": _q(units, 0.5), "p95": _q(units, 0.95), "max": max(units) if units else None}
    secs = [r["engine_secs"] for r in rows if r.get("engine_secs") is not None]
    s["engine_secs"] = {"p50": _q(secs, 0.5), "p95": _q(secs, 0.95), "max": max(secs) if secs else None}
    lat = [r for r in rows if "lattice_diff_tol" in r]
    s["lattice_check"] = {"compared": len(lat), "disputed": sum(r["lattice_disputed"] for r in lat),
                          "diff_tol_max": max((r["lattice_diff_tol"] for r in lat), default=None)}
    qlr = [r["quantlib_diff_tol"] for r in rows if "quantlib_diff_tol" in r]
    qdf = [r for r in rows if r.get("quantlib_method") == "qdfp-high-precision" and r.get("ref_value_status") == "reliable"]
    cov = [r["quantlib_diff_tol"] / r["ref_u_tol"] for r in qdf if r.get("ref_u_tol")]
    s["bound_route"] = {"checked": sum("bound" in r for r in rows)} | dict(Counter(r["bound"] for r in rows if "bound" in r))
    s["bound_checked"] = s["bound_route"]["checked"]
    s["quantlib_coverage"] = {"compared": len(cov), "outside_u": sum(x > 1 for x in cov),
                              "ratio_p50": _q(cov, 0.5), "ratio_p99": _q(cov, 0.99), "ratio_max": max(cov) if cov else None}
    s["quantlib_check"] = {"compared": len(qlr), "over_half_tol": sum(x > 0.5 for x in qlr),
                           "diff_tol_p50": _q(qlr, 0.5), "diff_tol_max": max(qlr) if qlr else None}
    ivs = [r for r in rows if "iv_status" in r]
    se = [r["iv_sigma_err"] for r in ivs if r.get("iv_identifiable")]
    ev = [r["iv_err_vega_tol"] for r in ivs if r.get("iv_identifiable") and "iv_err_vega_tol" in r]
    rs = [r["iv_residual_tol"] for r in ivs if "iv_residual_tol" in r]
    s["iv_roundtrip"] = {"attempted": len(ivs), "status": dict(Counter(r["iv_status"] for r in ivs)),
                         "sigma_err_p50": _q(se, 0.5), "sigma_err_p99": _q(se, 0.99), "sigma_err_max": max(se) if se else None,
                         "residual_tol_max": max(rs) if rs else None,
                         "identifiable": sum(bool(r.get("iv_identifiable")) for r in ivs),
                         "unidentifiable_sigma_err_max": max((r["iv_sigma_err"] for r in ivs if "iv_sigma_err" in r and not r.get("iv_identifiable")), default=None),
                         "err_vega_tol_max": max(ev) if ev else None}
    dv = [r for r in rows if "divsens" in r]
    s["divsens"] = {"attempted": len(dv), "outcome": dict(Counter(r["divsens"] for r in dv)),
                    "err_tol_max": max((r["divsens_err_tol"] for r in dv if "divsens_err_tol" in r), default=None),
                    "move_tol_p50": _q([r["divsens_move_tol"] for r in dv if "divsens_move_tol" in r], 0.5)}
    cs = [r for r in rows if "convention_shift_tol" in r and r["convention_reliable"]]
    sh = [abs(r["convention_shift_tol"]) for r in cs]
    s["convention"] = {"compared": len(cs), "abs_shift_tol_p50": _q(sh, 0.5), "abs_shift_tol_p95": _q(sh, 0.95),
                       "abs_shift_tol_max": max(sh) if sh else None, "over_one_tol": sum(x > 1 for x in sh),
                       "unresolved": sum(1 for r in rows if "convention_shift_tol" in r and not r["convention_reliable"]),
                       "skipped": sum(1 for r in rows if r.get("convention_skipped"))}
    return s


# Manifest fields every shard of one run must share; anything else (shard, timestamps, resumes) may differ.
RUN_KEYS = ("bench_files_sha256", "engine", "seed", "per_group", "named", "options", "reference", "domain", "versions",
            "convention_calendar")


def check_compatible(manifests: list[dict]) -> None:
    if not manifests:
        raise ValueError("no manifest found: these results cannot be traced to a run")
    first = manifests[0]
    for m in manifests[1:]:
        bad = [k for k in RUN_KEYS if m.get(k) != first.get(k)]
        if bad:
            raise ValueError(f"shards from different runs ({', '.join(bad)} differ); score them separately")
    shards = sorted(m["shard"] for m in manifests)
    n = int(shards[0].split("/")[1])
    if len(set(shards)) != len(shards) or any(int(x.split("/")[1]) != n for x in shards):
        raise ValueError(f"inconsistent shard set {shards}")


def completeness(manifests: list[dict], ids: set[str]) -> dict:
    """The run's case list, regenerated from its manifest, against the results received: a partial run (missing
    shards or unfinished cases) is scored but marked incomplete, and an incomplete run never meets the gate
    (Codex OB-08). A result the run could not have produced is an error."""
    first = manifests[0]
    expected = {c.id for c in cases.suite(first["seed"], first["per_group"], named=first["named"])}
    extra = ids - expected
    if extra:
        raise ValueError(f"{len(extra)} results are not in this run's case list (e.g. {sorted(extra)[0]})")
    n = int(first["shard"].split("/")[1])
    have = {m["shard"] for m in manifests}
    return {"expected": len(expected), "received": len(ids), "missing": len(expected - ids),
            "missing_shards": [f"{i}/{n}" for i in range(n) if f"{i}/{n}" not in have],
            "complete": not (expected - ids)}


def named_verdict(exp: str, got: str | None, price: str | None, delta: str | None,
                  note: str | None = None, expect_note: str = "") -> str:
    """pass only when the route is the documented one and every numerical check that applies passed; a served
    case whose reference is unresolved is "unresolved", never a pass (Codex OB-03). A delta withheld for a
    reason other than the documented one fails (review finding 2: B8's early-dividend withholding)."""
    if got != exp or price == "fail" or delta == "fail":
        return "FAIL"
    if expect_note and expect_note not in (note or ""):
        return "FAIL"
    if got == "served":
        return "pass" if price == "pass" and delta == "pass" else "unresolved"
    if got == "served:no-delta":
        return "pass" if price == "pass" and delta == "withheld" else "unresolved"
    return "pass"


DIVSENS_TARGET = 300          # scored dividend-scenario cases across the in-domain groups [Proposed]
DELTA_PER_GROUP_TARGET = 300  # area 4: scored displayed deltas per in-domain group (acceptance matrix)

# What each verdict means. pass: the evidence the component requires is there and none of it fails.
# fail: a confirmed failure. unresolved: no confirmed failure, but an indeterminate outcome (the reference's
# interval straddles the threshold) or a disagreement still to investigate; it never counts as a pass.
# insufficient: too few scored cases, or an incomplete run. The overall verdict is the worst of them.
VERDICT_ORDER = ("fail", "unresolved", "insufficient", "pass")
OVERALL = {"fail": "failed", "unresolved": "unresolved", "insufficient": "not met", "pass": "met"}


def _verdict(fail: bool, unresolved: bool, short: bool) -> str:
    return "fail" if fail else "unresolved" if unresolved else "insufficient" if short else "pass"


def gate_result(groups: dict, overall: dict | None, named: list[dict], complete: bool,
                controls: dict | None = None) -> dict:
    """The acceptance verdict for this phase, one component per criterion that binds now (review finding 1).

    Sample targets count the in-domain groups (decision 10; area 4 for delta; area 5 for the dividend
    scenario), but a confirmed failure or an indeterminate outcome in any group, targeted, stress and named
    included, decides its component: a wrong served number is wrong wherever it is drawn. Every required group
    appears, absent ones as unmet (Codex OB-06); every named regression must be present (OB-08)."""
    in_dom = {g: groups[g] for g in cases.IN_DOMAIN_GROUPS if g in groups}
    every = list(groups.values())

    def total(key: str) -> int:
        return sum(x.get(key, 0) for x in every)

    per_group = {g: bool(g in groups and groups[g]["accepted_scored"] >= PER_GROUP_TARGET) for g in cases.IN_DOMAIN_GROUPS}
    overall_met = bool(overall and overall["accepted_scored"] >= OVERALL_TARGET)
    price = {"per_group_target": PER_GROUP_TARGET, "overall_target": OVERALL_TARGET, "per_group_met": per_group,
             "overall_met": overall_met, "accepted_scored": overall["accepted_scored"] if overall else 0,
             "failures": total("price_failures"), "indeterminate": total("price_indeterminate")}
    price["verdict"] = _verdict(price["failures"] > 0, price["indeterminate"] > 0,
                                not (in_dom and all(per_group.values()) and overall_met))

    d_group = {g: bool(g in groups and groups[g].get("delta_accepted_scored", 0) >= DELTA_PER_GROUP_TARGET)
               for g in cases.IN_DOMAIN_GROUPS}
    delta = {"per_group_target": DELTA_PER_GROUP_TARGET, "per_group_met": d_group,
             "failures": total("delta_failures"), "indeterminate": total("delta_indeterminate"),
             "availability": {g: x.get("delta_availability") for g, x in groups.items()}}
    delta["verdict"] = _verdict(delta["failures"] > 0, delta["indeterminate"] > 0, not all(d_group.values()))

    b = Counter()
    for x in every:
        b.update({k: v for k, v in x["bound_route"].items() if k != "checked"})
    bound = {"checked": total("bound_checked"), "outcome": dict(b)}
    bound["verdict"] = _verdict(b["violated"] > 0, b["indeterminate"] > 0, b["covered"] == 0)

    div_in, div_all = Counter(), Counter()
    for g, x in groups.items():
        div_all.update(x["divsens"]["outcome"])
        if g in in_dom:
            div_in.update(x["divsens"]["outcome"])
    divsens = {"target_scored": DIVSENS_TARGET, "outcome": dict(div_in), "outcome_all_groups": dict(div_all),
               "scored": div_in["pass"] + div_in["fail"]}
    divsens["verdict"] = _verdict(div_all["fail"] > 0, div_all["indeterminate"] > 0, divsens["scored"] < DIVSENS_TARGET)

    c = controls or {}
    n_eu = c.get("european_cases", 0)
    outside = {"european_value": n_eu - c.get("european_within_u", 0),
               "european_delta": n_eu - c.get("european_delta_within_u", 0),
               "exempt_american": c.get("exempt_american_cases", 0) - c.get("exempt_american_within_u", 0)}
    ctl = {"european_cases": n_eu, "exempt_american_cases": c.get("exempt_american_cases", 0), "outside_u": outside,
           "lattice_disputed": sum(x["lattice_check"]["disputed"] for x in every),
           # QuantLib's own error is not estimated, so its disagreements are listed for investigation, not gated
           "quantlib_outside_u": sum(x["quantlib_coverage"]["outside_u"] for x in every)}
    ctl["verdict"] = _verdict(sum(outside.values()) > 0, ctl["lattice_disputed"] > 0,
                              n_eu == 0 or ctl["exempt_american_cases"] == 0)

    nm = {"missing": sorted({x.id for x in cases.NAMED} - {n["id"] for n in named}),
          "failures": [n["id"] for n in named if n["regression"] == "FAIL"],
          "unresolved": [n["id"] for n in named if n["regression"] == "unresolved"]}
    nm["verdict"] = _verdict(bool(nm["failures"]), bool(nm["unresolved"]), bool(nm["missing"]))

    run = {"complete": complete, "crashes": sum(x.get("errors", 0) for x in every)}
    run["verdict"] = _verdict(run["crashes"] > 0, False, not complete)

    comps = {"price": price, "delta": delta, "bound": bound, "divsens": divsens, "controls": ctl, "named": nm,
             "run": run}
    worst = min((x["verdict"] for x in comps.values()), key=VERDICT_ORDER.index)
    return {"components": comps, "verdict": OVERALL[worst], "met": worst == "pass"}


COMPONENT_NAMES = {"price": "Price accuracy (area 2, decision 10)", "delta": "Displayed delta (area 4)",
                   "bound": "Early-exercise bound (bound-European route)", "divsens": "Dividend scenario (area 5)",
                   "controls": "Reference controls (area 1)", "named": "Named regressions", "run": "Run integrity"}


def gate_open(gt: dict) -> list[str]:
    """What holds the verdict open, in words, so the scorecard never names the wrong reason."""
    c = gt["components"]
    p, d, b, v, k, n, r = (c[x] for x in ("price", "delta", "bound", "divsens", "controls", "named", "run"))
    why = [] if r["complete"] else ["run incomplete"]
    why += [f"{r['crashes']} crashes"] if r["crashes"] else []
    why += [f"{p['failures']} price failures"] if p["failures"] else []
    why += [f"{p['indeterminate']} price outcomes indeterminate"] if p["indeterminate"] else []
    why += [f"{g} below {p['per_group_target']} scored prices" for g, ok in p["per_group_met"].items() if not ok]
    why += [] if p["overall_met"] else [f"fewer than {p['overall_target']} scored prices overall"]
    why += [f"{d['failures']} displayed-delta failures"] if d["failures"] else []
    why += [f"{d['indeterminate']} delta outcomes indeterminate"] if d["indeterminate"] else []
    why += [f"{g} below {d['per_group_target']} scored deltas" for g, ok in d["per_group_met"].items() if not ok]
    why += [f"{b['outcome']['violated']} bound violations"] if b["outcome"].get("violated") else []
    why += [f"{b['outcome']['indeterminate']} bound outcomes indeterminate"] if b["outcome"].get("indeterminate") else []
    why += [] if b["outcome"].get("covered") else ["no bound covered by a reference"]
    vo = v["outcome_all_groups"]
    why += [f"{vo['fail']} dividend-scenario failures"] if vo.get("fail") else []
    why += [f"{vo['indeterminate']} dividend-scenario outcomes indeterminate"] if vo.get("indeterminate") else []
    why += [] if v["scored"] >= v["target_scored"] else [f"fewer than {v['target_scored']} scored dividend scenarios"]
    why += [f"{x} {name} controls outside their uncertainty" for name, x in k["outside_u"].items() if x]
    why += [f"{k['lattice_disputed']} lattice disputes to investigate"] if k["lattice_disputed"] else []
    why += [] if k["european_cases"] else ["no European controls run"]
    why += [] if k["exempt_american_cases"] else ["no exempt controls run"]
    why += [f"named {x} {kind}" for kind, xs in (("failed", n["failures"]), ("unresolved", n["unresolved"]),
                                                ("missing", n["missing"])) for x in xs]
    return why


def read_results(path: Path) -> tuple[list[dict], bool]:
    """A results file's records, and whether its last line was cut short. A run killed mid-write can leave a
    partial final line: that case is treated as not yet run (resume re-runs it, the scorer counts it missing).
    An unreadable line anywhere else is damage, not an interruption, and raises."""
    lines = [x for x in path.read_text().splitlines() if x.strip()]
    recs = []
    for k, x in enumerate(lines):
        try:
            recs.append(json.loads(x))
        except json.JSONDecodeError:
            if k == len(lines) - 1:
                return recs, True
            raise ValueError(f"{path.name} line {k + 1} is not a result record") from None
    return recs, False


def controls_summary(rows: list[dict]) -> dict:
    """The reference's positive controls: European cases against Black-76 and exempt cases' American reference."""
    controls = [r for r in rows if "control_eu_err_over_u" in r]
    return {"european_cases": len(controls),
            "european_reliable": sum(r["control_eu_reliable"] for r in controls),
            "european_within_u": sum(r["control_eu_err_over_u"] <= 1 for r in controls),
            "european_err_over_u_max": max((r["control_eu_err_over_u"] for r in controls), default=None),
            "european_err_tol_max": max((r["control_eu_err_tol"] for r in controls), default=None),
            "european_delta_within_u": sum(r["control_eu_delta_err_over_u"] <= 1 for r in controls),
            "exempt_american_cases": sum("exempt_american_err_over_u" in r for r in rows),
            "exempt_american_within_u": sum(r.get("exempt_american_err_over_u", 2) <= 1 for r in rows)}


def score(dirs: list[Path]) -> dict:
    recs, manifests, cut = [], [], []
    for d in dirs:
        for p in sorted(d.glob("results-*.jsonl")):
            got, truncated = read_results(p)
            recs += got
            cut += [p.name] if truncated else []
        manifests += [json.loads(p.read_text()) for p in sorted(d.glob("manifest-*.json"))]
    check_compatible(manifests)
    seen: dict = {}
    for r in recs:
        cid = r["case"]["id"]
        if cid in seen:  # never pick one of two results silently (Codex OB-01)
            raise ValueError(f"case {cid} appears twice in the results; score one run's shards at a time")
        seen[cid] = r
    uniq = list(seen.values())
    run_status = completeness(manifests, set(seen))
    run_status["truncated_files"] = cut
    rows = [classify(r) for r in uniq]
    by = defaultdict(list)
    for r in rows:
        by[r["group"]].append(r)
    groups = {g: _summary(by[g], sampled=g != "named") for g in [*cases.GROUPS, "named"] if g in by}
    in_dom = [r for r in rows if r["group"] in cases.RANDOM_IN_DOMAIN_GROUPS]
    overall = _summary(in_dom) if in_dom else None
    named = []
    for r, rec in ((classify(x), x) for x in uniq if x["case"]["kind"] == "named"):
        # judged against the current documented route (cases.NAMED), not the one stored with an older run; the
        # stored one is shown when it differs (the run's inputs must be the same case)
        cur = next(c for c in cases.NAMED if c.id == r["id"])
        if any(rec["case"][k] != v for k, v in cur.to_json().items() if k not in ("note", "expect", "expect_note")):
            raise ValueError(f"{r['id']}: the run's inputs differ from the current named case")
        exp, exp_note = cur.expect, cur.expect_note
        recorded = rec["case"].get("expect")
        eng = rec.get("engine", {})
        got = eng.get("status")
        rv, rd = (rec.get("ref") or {}).get("value") or {}, (rec.get("ref") or {}).get("delta") or {}
        if got == "served" and eng.get("delta") is None:
            got_short = "served:no-delta"
        elif got and got.startswith("refused"):
            got_short = "refused:domain" if got == "refused:domain" else got
        else:
            got_short = got
        named.append({"id": r["id"], "note": cur.note, "expect": exp, "got": got_short,
                      "expect_recorded": recorded if recorded != exp else None,
                      "regression": named_verdict(exp, got_short, r.get("price"), r.get("delta"), eng.get("delta_note"),
                                                  exp_note),
                      "delta_note": eng.get("delta_note"), "expect_note": exp_note,
                      "engine_value": eng.get("value"), "engine_delta": eng.get("delta"),
                      "reason": eng.get("reason") or rec.get("error"),
                      "ref_value": rv.get("ref"), "ref_value_u": rv.get("u"), "ref_value_status": rv.get("status", "missing"),
                      "ref_delta": rd.get("ref"), "ref_delta_u": rd.get("u"), "ref_delta_status": rd.get("status", "missing"),
                      "price": r.get("price"), "delta": r.get("delta"),
                      "convention_shift_tol": r.get("convention_shift_tol")})
    ctl = controls_summary(rows)
    gate = gate_result(groups, overall, named, run_status["complete"], ctl)
    return {"manifests": manifests, "scorer": scorer_version(), "run": run_status, "groups": groups,
            "overall_in_domain": overall, "named": named, "controls": ctl, "gate": gate,
            "errors": [r for r in rows if "error" in r]}


def scorer_version() -> dict:
    """The scoring code itself, so a re-scored run says which rules judged it (the run's own manifest records
    the code that produced the results)."""
    here = Path(__file__).resolve().parent
    sha = {n: hashlib.sha256((here / n).read_bytes()).hexdigest() for n in ("score.py", "cases.py", "reference.py")}
    git = lambda *a: subprocess.run(["git", "-C", str(here), *a], capture_output=True, text=True, timeout=10)
    try:
        head = git("rev-parse", "HEAD")
        ok = head.returncode == 0
        commit = head.stdout.strip() if ok else None
        dirty = bool(git("status", "--porcelain", "--", ".").stdout.strip()) if ok else None  # None: not a checkout
    except (OSError, subprocess.SubprocessError):
        commit, dirty = None, None
    return {"score_py_sha256": sha["score.py"], "cases_py_sha256": sha["cases.py"],
            "reference_py_sha256": sha["reference.py"], "git_commit": commit, "git_dirty": dirty}


def _f(x, nd=3):
    if x is None:
        return "–"
    if isinstance(x, float):
        if x != 0 and (abs(x) < 10 ** -nd or abs(x) >= 1e6):
            return f"{x:.2e}"
        return f"{x:.{nd}f}"
    return str(x)


def markdown(sc: dict) -> str:
    m0 = sc["manifests"][0] if sc["manifests"] else {}
    L = ["# Options bench scorecard", ""]
    rs = sc["run"]
    if not rs["complete"]:
        L += [f"**Partial run: {rs['received']} of {rs['expected']} cases"
              + (f"; shards not received: {', '.join(rs['missing_shards'])}" if rs["missing_shards"] else "")
              + (f"; partial last record dropped from {', '.join(rs['truncated_files'])}" if rs.get("truncated_files") else "")
              + ". Nothing below certifies the engine.**", ""]
    if m0:
        L += [f"- Engine: `{m0['engine']['files_sha256'].get('src/desk/options_math.py', '')[:12]}` (options_math.py sha256), "
              f"`{(m0['engine']['files_sha256'].get('src/desk/options_finder.py') or '')[:12]}` (options_finder.py), commit {m0['engine'].get('git_commit')}",
              f"- Bench commit {m0.get('bench_git_commit')}{' (uncommitted changes)' if m0.get('bench_git_dirty') else ''}; seed {m0['seed']}; per group {m0['per_group']}; shards {len(sc['manifests'])}",
              f"- Python {m0['versions']['python']}, numpy {m0['versions']['numpy']}, scipy {m0['versions']['scipy']}, QuantLib {m0['versions']['quantlib']}; {m0['platform']['cpus']} CPUs ({m0['platform']['system']})",
              f"- Reference: {m0['reference']['method']}; reliable when its uncertainty is at most {m0['reference']['ref_fraction']} of the tolerance. Uncertainty is an estimate, not a proved bound.",
              ""]
    L += ["## Price and delta by group", "",
          "| Group | Cases | Served | Refused | Ref unresolved | Price pass / fail / indet. / unscored | Worst err (tol) | p99 err (tol) | 95% upper fail rate (indet. counted as fail) | Delta pass / fail / indet. / withheld / unscored | Worst delta err | Work p50 / max (M units) |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for g, s in [*sc["groups"].items(), *([("**random in-domain total**", sc["overall_in_domain"])] if sc["overall_in_domain"] else [])]:
        served = sum(v for k, v in s["engine"].items() if k.startswith("served"))
        refused = s["cases"] - served
        p, d = s["price"], s["delta"]
        L.append(f"| {g} | {s['cases']} | {served} | {refused} | {s['reference_value'].get('unresolved', 0)} | "
                 f"{p.get('pass', 0)} / {p.get('fail', 0)} / {p.get('indeterminate', 0)} / {p.get('unscored', 0)} | "
                 f"{_f(s['price_err_tol']['max'])} | {_f(s['price_err_tol']['p99'])} | {_f(s['clopper_pearson_95_conservative'][2], 4) if s['clopper_pearson_95_conservative'] else 'n/a (not sampled)'} | "
                 f"{d.get('pass', 0)} / {d.get('fail', 0)} / {d.get('indeterminate', 0)} / {d.get('withheld', 0)} / {d.get('unscored', 0)} | {_f(s['delta_err']['max'], 5)} | "
                 f"{_f((s['work_units']['p50'] or 0) / 1e6, 1)} / {_f((s['work_units']['max'] or 0) / 1e6, 1)} |")
    L += ["", "## Engine routes and refusals", ""]
    for g, s in sc["groups"].items():
        L.append(f"- {g}: " + ", ".join(f"{k} {v}" for k, v in sorted(s["engine"].items())))
    L += ["", "## Named regressions (rerun on this engine)", "",
          "| Case | Expected | Got | Regression | Engine value / delta | Reference value ± u | Reference delta ± u | Business-day shift (tol) |",
          "|---|---|---|---|---|---|---|---|"]
    for n in sc["named"]:
        L.append(f"| {n['id'].split('/')[1]} | {n['expect']}{' (run recorded ' + n['expect_recorded'] + ')' if n.get('expect_recorded') else ''} | {n['got']} | {n['regression']} | {_f(n['engine_value'], 5)} / {_f(n['engine_delta'], 5)} | "
                 f"{_f(n['ref_value'], 5)} ± {_f(n['ref_value_u'], 5)} ({'reliable' if n['ref_value_status'] == 'reliable' else 'unresolved'}) | "
                 f"{_f(n['ref_delta'], 5)} ± {_f(n['ref_delta_u'], 5)} ({'reliable' if n['ref_delta_status'] == 'reliable' else 'unresolved'}) | {_f(n['convention_shift_tol'], 2)} |")
    c = sc["controls"]
    L += ["", "## Reference controls", "",
          f"- European control (exercise off, against Black-76): {c['european_cases']} cases, {c['european_reliable']} reliable, "
          f"{c['european_within_u']} with the error inside the stated uncertainty (worst error {_f(c['european_err_over_u_max'], 2)} u, {_f(c['european_err_tol_max'], 4)} tol); "
          f"delta inside its uncertainty on {c['european_delta_within_u']}.",
          "- American references against QuantLib's high-precision QdFp engine (no dividends; an independent third method, its own error not estimated): "
          + "; ".join(f"{g} {s['quantlib_coverage']['compared']} compared, {s['quantlib_coverage']['outside_u']} outside the stated uncertainty (|QL − R|/u p99 {_f(s['quantlib_coverage']['ratio_p99'], 2)}, max {_f(s['quantlib_coverage']['ratio_max'], 2)})"
                      for g, s in sc["groups"].items() if s["quantlib_coverage"]["compared"]),
          "- Early-exercise bound (bound-European route, served value European): "
          + "; ".join(f"{g} {s['bound_route']['checked']} checked: {s['bound_route'].get('covered', 0)} covered, "
                      f"{s['bound_route'].get('violated', 0)} violated, {s['bound_route'].get('indeterminate', 0)} indeterminate, "
                      f"{s['bound_route'].get('unscored', 0)} unscored"
                      for g, s in sc["groups"].items() if s["bound_route"]["checked"]) + ".",
          f"- Exempt group, American reference against Black-76: {c['exempt_american_within_u']} of {c['exempt_american_cases']} inside the stated uncertainty.",
          ""]
    L += ["## Cross-checks (diagnostics, not references)", ""]
    for g, s in sc["groups"].items():
        lc, qc = s["lattice_check"], s["quantlib_check"]
        L.append(f"- {g}: lattice (same code family) {lc['compared']} compared, {lc['disputed']} disputed, max {_f(lc['diff_tol_max'])} tol; "
                 f"QuantLib {qc['compared']} compared, {qc['over_half_tol']} over 0.5 tol, max {_f(qc['diff_tol_max'])} tol")
    L += ["", "## Implied volatility round trip (the Finder's solver on reference prices)", "",
          "The engine's own American IV solve, started at sigma 0.3 as the Finder does, on the reference price of a served case; sigma error is |recovered − true| in absolute volatility; residual is the engine's value at the recovered sigma minus the reference price. Identifiable: one volatility point moves the engine's price by at least one tolerance; elsewhere the price barely depends on sigma and a large sigma error is expected.", ""]
    for g, s in sc["groups"].items():
        iv = s["iv_roundtrip"]
        if iv["attempted"]:
            L.append(f"- {g}: {iv['attempted']} attempted, " + ", ".join(f"{k} {v}" for k, v in sorted(iv["status"].items()))
                     + f"; identifiable {iv['identifiable']}: sigma error p50 {_f(iv['sigma_err_p50'], 6)}, p99 {_f(iv['sigma_err_p99'], 6)}, max {_f(iv['sigma_err_max'], 6)}, max error × vega {_f(iv['err_vega_tol_max'], 3)} tol; "
                     f"not identifiable: max sigma error {_f(iv['unidentifiable_sigma_err_max'], 4)}; residual max {_f(iv['residual_tol_max'], 4)} tol")
    L += ["", "## Dividend sensitivity (provisional gate, decision 11)", "",
          "Every owed dividend scaled by 1.1 and by 0.9: the engine's price change between the two must match the reference's within one price tolerance (the reference uncertainties of both states counted against it).", ""]
    for g, s in sc["groups"].items():
        dv = s["divsens"]
        if dv["attempted"]:
            L.append(f"- {g}: {dv['attempted']} attempted, " + ", ".join(f"{k} {v}" for k, v in sorted(dv["outcome"].items()))
                     + f"; worst mismatch {_f(dv['err_tol_max'], 3)} tol; median reference move {_f(dv['move_tol_p50'], 2)} tol")
    L += ["", "## Exercise convention (reported separately from numerical error)", "",
          "Continuous exercise (the default) against exercise only at NYSE closes from Monday 2026-10-26 and at expiry (a Bermudan approximation), same model and inputs. Shift = Bermudan − continuous, in price tolerances.", ""]
    for g, s in sc["groups"].items():
        cv = s["convention"]
        if cv["compared"] or cv["unresolved"] or cv["skipped"]:
            L.append(f"- {g}: {cv['compared']} compared ({cv['unresolved']} unresolved; {cv['skipped']} skipped, expiring past the holiday tables), |shift| p50 {_f(cv['abs_shift_tol_p50'], 3)}, p95 {_f(cv['abs_shift_tol_p95'], 3)}, max {_f(cv['abs_shift_tol_max'], 3)} tol; {cv['over_one_tol']} above 1 tol")
    gt = sc["gate"]
    c = gt["components"]
    p, d, b, v, k, n, r = (c[x] for x in ("price", "delta", "bound", "divsens", "controls", "named", "run"))
    met = lambda ok: "met" if ok else "not met"
    bo, vo = b["outcome"], v["outcome_all_groups"]
    evidence = {
        "price": f"{p['accepted_scored']} scored in the random in-domain groups (at least {p['per_group_target']} per in-domain group: "
                 + ", ".join(f"{g} {met(x)}" for g, x in p["per_group_met"].items())
                 + f"; at least {p['overall_target']} overall: {met(p['overall_met'])}); {p['failures']} failures and {p['indeterminate']} indeterminate in any group",
        "delta": f"at least {d['per_group_target']} scored per in-domain group: " + ", ".join(f"{g} {met(x)}" for g, x in d["per_group_met"].items())
                 + f"; {d['failures']} failures and {d['indeterminate']} indeterminate among deltas shown, any group",
        "bound": f"{b['checked']} checked: {bo.get('covered', 0)} covered, {bo.get('violated', 0)} violated, {bo.get('indeterminate', 0)} indeterminate, "
                 f"{bo.get('unscored', 0)} unscored (an interval across a bound the reference is too coarse to judge, or an unresolved reference); passing needs covered cases",
        "divsens": f"{v['scored']} scored in domain (at least {v['target_scored']}: {met(v['scored'] >= v['target_scored'])}); all groups: "
                   + ", ".join(f"{x} {y}" for x, y in sorted(vo.items())),
        "controls": f"{k['european_cases']} European controls and {k['exempt_american_cases']} exempt cases; outside their uncertainty: "
                    + ", ".join(f"{x} {y}" for x, y in k["outside_u"].items())
                    + f"; {k['lattice_disputed']} lattice disputes; {k['quantlib_outside_u']} QuantLib comparisons outside u (listed above for investigation, not gated)",
        "named": f"{len(sc['named'])} of {len(sc['named']) + len(n['missing'])} present; failed: {', '.join(n['failures']) or 'none'}; "
                 f"unresolved: {', '.join(n['unresolved']) or 'none'}" + (f"; missing: {', '.join(n['missing'])}" if n["missing"] else ""),
        "run": f"{sc['run']['received']} of {sc['run']['expected']} cases; {r['crashes']} crashes (any crash, diagnostics included, fails the run)",
    }
    L += ["", "## Acceptance for this phase (Phase 0 baseline)", "",
          f"**Verdict: {gt['verdict']}**" + ("" if gt["met"] else " (open: " + ", ".join(gate_open(gt)) + ")"), "",
          "One component per criterion that binds now (the acceptance matrix's \"binds from\" column). The verdict is met only when "
          "every component passes; one failed component fails it, and otherwise one unresolved component leaves it unresolved.", "",
          "| Component | Verdict | Evidence |", "|---|---|---|"]
    L += [f"| {COMPONENT_NAMES[x]} | {c[x]['verdict']} | {evidence[x]} |" for x in COMPONENT_NAMES]
    L += ["",
          "- An indeterminate outcome (the reference's interval straddles the threshold) is unresolved: it is never a pass, and one is enough to hold its component unresolved. "
          "Unscored cases (the reference cannot judge them) are counted and shown, never used as evidence either way.",
          "- Sample targets count the in-domain groups; a failure or an indeterminate outcome counts in any group, targeted, stress and named included.",
          "- Displayed-delta availability (withholding an unvalidated delta is correct and is not an accuracy failure): "
          + "; ".join(f"{g} shown for {a['shown']} of {a['served']} served prices" for g, a in d["availability"].items() if a and a["served"]) + ".",
          "- Clopper-Pearson limits assume independent draws from each group's sampling distribution, and are conditional on the reference resolving (unscored cases are counted, not in the rate). The table's limit counts every indeterminate outcome as a failure. They are not a claim about real chains or whole requests.",
          f"- Scored by score.py `{sc['scorer']['score_py_sha256'][:12]}` (cases.py `{sc['scorer']['cases_py_sha256'][:12]}`), bench commit {sc['scorer']['git_commit']}"
          + (" with uncommitted changes" if sc["scorer"]["git_dirty"] else "") + ".",
          ""]
    if sc["errors"]:
        L += ["## Crashes", ""] + [f"- {e['id']}: {e['error']}" for e in sc["errors"]]
    return "\n".join(L) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    sc = score([Path(d) for d in a.dirs])
    out = Path(a.out or a.dirs[0])
    out.mkdir(parents=True, exist_ok=True)
    (out / "scorecard.json").write_text(json.dumps(sc, indent=2, default=str))
    (out / "scorecard.md").write_text(markdown(sc))
    print((out / "scorecard.md").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
