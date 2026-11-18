"""scripts/options_bench/report_p3.py — score a Phase 3 held-out run by the frozen rules (test tooling).

    python -m scripts.options_bench.report_p3 --freeze FREEZE.json --run DIR [--out REPORT.json]

Pure scoring over heldout_p3.py's results: nothing is priced here. The rules are score_p3.py's (section 8.3 and
8.4: every (G, g) pair, the cross-check per group, C1, X1) and controls_p3.c2_verdict (C2-FD and C2-Q per group,
C2-lattice per E-stratum; a quantity needs 300 scored values and a 95% upper limit of the miss rate at most 1%).
The Phase 2 rows are Tier 2's answers against adaptive-p2.1 bit for bit, and the repeats. CPU and wall time come
from the run's meter. A run that did not finish every job is reported as partial: nothing in it is accepted.
"Accepted by the frozen rules" is what the rules say; numerical acceptance is the owner's decision.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from src.desk import options_greeks as G

from . import cases, controls_p3 as C, heldout_p3 as H, score_p3 as S

NAMED = "named"


def c2_rows(results: list[dict], kind: str) -> dict:
    """Per group or stratum, the C2 verdicts by quantity; a quantity that applies to none of its contexts is "not
    applicable", and a crashed job counts as unscored for every quantity it was to run."""
    by = defaultdict(list)
    errors = Counter()
    for r in results:
        if r["kind"] != kind:
            continue
        unit = r["case"]["group"]
        if "error" in r:
            errors[unit] += 1
            continue
        by[unit].append({k: v for k, v in r["c2"].items() if not k.startswith("_")})
    out = {}
    for unit, rows in sorted(by.items()):
        v = C.c2_verdict(rows)
        for k, row in v.items():
            statuses = [x[k].get("status", "") for x in rows if k in x]
            if row["scored"] == 0 and statuses and all("not applicable" in s for s in statuses):
                row["verdict"] = "not applicable"
        out[unit] = {"quantities": v, "crashed_jobs": errors[unit]}
    return out


def is_short(short: dict, stage: str, unit: str, quantity: str) -> bool:
    """Whether the plan could not supply this control's contexts (heldout_p3.population's `short`)."""
    pre = "e" if stage == "c2_lattice" else "c2"
    return f"{pre}|{unit}|base" in short or (quantity == G.DIVIDEND and f"{pre}|{unit}|dividend" in short)


def judge_price(rec: dict) -> str | None:
    """Report-only Phase 2 row: Tier 2's price against the run's FD price reference."""
    v, pr = rec["tier2"].get("value"), rec.get("price_ref") or {}
    if v is None or pr.get("status") != "reliable":
        return None
    return S.judge(v, pr["ref"], pr["u"], pr["tol"])


def report(freeze: dict, run: Path) -> dict:
    jobs, short = H.population(freeze)
    results = H.read_results(run / H.RESULTS)
    keys = {j["key"] for j in jobs}
    got = {r["key"] for r in results}
    missing = sorted(keys - got)
    cpu = freeze["cpu"]
    total_cpu, sessions = H.prior_cpu(run / H.METER, int(freeze["workers"]), cpu["sample_seconds"])
    recs = [r["rec"] for r in results if r["kind"] == "case" and "rec" in r]
    crashed = [{"key": r["key"], "error": r["error"]} for r in results if "error" in r]
    sampled = [r for r in recs if r["case"]["kind"] != NAMED]
    named = [r for r in recs if r["case"]["kind"] == NAMED]
    targeted = {k: v for k, v in freeze["targeted"].items() if k in G.GREEKS}
    greeks = S.score_greeks(sampled, targeted)
    # a named case is not a sampled context, but a blocking result on one inside Ω_G still blocks (never weaker)
    for rec in named:
        for g in G.GREEKS:
            s = S.score_greek(rec, g)
            if s["outcome"] == "returned" and s["in_region"] and (s.get("result") in ("fail", "straddle")
                                                                 or s.get("bound_violation")):
                greeks["blocking"].setdefault(g, []).append({"case": rec["case"]["id"], "result": s.get("result")})
                greeks["standing"][g] = "not served (blocked by a named case)"
    cross = S.score_cross_check(sampled)
    cross_required = {g: cross.get(g, {"verdict": "not established", "cross_checked": 0})["verdict"]
                      for g in freeze["cross_check_required"]}
    c1_input = recs + [{"case": r["case"], "c1": r["c1"]} for r in results if r["kind"] == "e" and "c1" in r]
    c1 = S.score_c1(c1_input)
    x1 = S.score_x1(recs)
    c2 = {"c2_fd": c2_rows(results, "c2_fd"), "c2_q": c2_rows(results, "c2_q"), "c2_lattice": c2_rows(results, "e")}
    p2 = Counter()
    for r in recs:
        row = r.get("phase2_rows") or {}
        p2["answers"] += 1
        p2["answer_json_differs"] += not row.get("answer_json_identical", False)
        p2["full_differs"] += not row.get("full_identical", False)
        if "repeat_identical" in r:
            p2["repeats"] += 1
            p2["repeat_differs"] += not r["repeat_identical"]
    t2 = Counter(judge_price(r) for r in sampled)
    rows = {}
    for key, p in greeks["pairs"].items():
        g, grp = key.split("|")
        if grp in targeted.get(g, []):
            rows[f"pair {key}"] = p["verdict"]
    for g, v in cross_required.items():
        rows[f"cross-check {g}"] = v
    rows["C1"] = c1["verdict"]
    rows["X1"] = x1["verdict"]
    for stage, units in c2.items():
        for unit, v in units.items():
            for k, row in v["quantities"].items():
                if row["verdict"] != "not applicable":
                    rows[f"{stage} {unit} {k}"] = ("not established: sample not reached"
                                                   if row["verdict"] != "fail" and is_short(short, stage, unit, k)
                                                   else row["verdict"])
    rows["Phase 2 rows: Tier 2 bit-identical to adaptive-p2.1"] = (
        "pass" if p2["answers"] and not p2["answer_json_differs"] and not p2["full_differs"] else "failed")
    rows["Phase 2 rows: repeats bit-identical"] = "pass" if p2["repeats"] and not p2["repeat_differs"] else "failed"
    complete = not missing
    ok = {"validated", "pass"}
    bad = sorted(k for k, v in rows.items() if v not in ok)
    return {
        "complete": complete, "jobs": len(jobs), "finished": len(got & keys), "missing": len(missing),
        "missing_examples": missing[:20], "crashed": crashed, "short_supply": short,
        "cpu": {"total_cpu_hours": total_cpu / 3600.0, "cap_hours": cpu["cap_hours"],
                "wall_hours": sum(s["wall_s"] for s in sessions) / 3600.0, "sessions": sessions,
                "job_cpu_hours_recorded": sum(r.get("cpu_s", 0.0) for r in results) / 3600.0},
        "greeks": greeks, "cross_check": cross, "cross_check_required": cross_required, "c1": c1, "x1": x1,
        "c2": c2, "phase2_rows": dict(p2), "tier2_price_vs_price_ref_report_only": {str(k): v for k, v in t2.items()},
        "named": [{"id": r["case"]["id"], "tier2": r["tier2"]["price_status"], "expect": r["case"]["expect"],
                   "cross_check": r["cross_check"]["status"],
                   "greeks": {g: a["status"] for g, a in r["greeks"].items()}} for r in named],
        "rows": rows, "rows_not_passing": bad,
        "by_the_frozen_rules": ("partial: the run did not finish every job" if not complete
                                else "accepted by the frozen rules" if not bad and not crashed
                                else "not accepted by the frozen rules"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--freeze", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    rep = report(json.loads(Path(a.freeze).read_text()), Path(a.run))
    text = json.dumps(rep, indent=1, default=str, allow_nan=True)
    if a.out:
        Path(a.out).write_text(text)
    print(json.dumps({k: rep[k] for k in ("complete", "jobs", "finished", "missing", "by_the_frozen_rules",
                                          "rows_not_passing")}, indent=1))
    print(f"CPU {rep['cpu']['total_cpu_hours']:.2f} h of {rep['cpu']['cap_hours']} h; wall {rep['cpu']['wall_hours']:.2f} h")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
