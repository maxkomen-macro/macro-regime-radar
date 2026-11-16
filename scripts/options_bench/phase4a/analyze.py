"""scripts/options_bench/phase4a/analyze.py — summarize a Phase 4a run (section 4's measures) and forecast its size.

    python -m scripts.options_bench.phase4a.analyze <run.jsonl> [--forecast]

Reads the runner's JSON lines only; prices nothing. Per configuration and limit: outcomes, work units, CPU and wall
(p50, p95, max), memo reuse by site and engine, Tier 2 refusals, root-finding rounds and exits by site, the stated
input errors, coverage (each candidate's fate), and each lens's pick and top 20 against configuration A on the same
request and limit.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

from . import runner

CONFIGS = ("A", "B", "C", "D")
LIMITS = ("budget", "offline")


def pct(xs, p):
    xs = sorted(x for x in xs if x is not None and math.isfinite(x))
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def spread(xs):
    return {"n": sum(1 for x in xs if x is not None), "p50": pct(xs, 0.5), "p95": pct(xs, 0.95),
            "max": max((x for x in xs if x is not None), default=None)}


def load(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def summarize(recs: list[dict]) -> dict:
    by = defaultdict(list)
    for r in recs:
        if "config" in r and "limit_name" in r:
            by[(r["config"], r["limit_name"])].append(r)
    base = {(r["index"], r["limit_name"]): r for r in recs if r.get("config") == "A" and r.get("outcome") == "answered"}
    out = {}
    for (cfg, lim), rs in sorted(by.items()):
        ans = [r for r in rs if r["outcome"] == "answered"]
        s = {"requests": len(rs), "outcomes": dict(Counter(r["outcome"] for r in rs)),
             "units": spread([r.get("units") for r in rs]),
             "cpu_s": spread([r.get("cpu_s") for r in rs]), "wall_s": spread([r.get("wall_s") for r in rs]),
             "units_answered": spread([r.get("units") for r in ans])}
        reuse = defaultdict(lambda: [0, 0])
        refusals = Counter()
        for r in rs:
            st = r.get("sites") or {}
            for k, v in (st.get("lookups") or {}).items():
                reuse[k][0] += v
            for k, v in (st.get("hits") or {}).items():
                reuse[k][1] += v
            refusals.update(st.get("t2_refusals") or {})
        s["memo_reuse"] = {k: {"lookups": a, "hits": h, "share": (h / a if a else None)} for k, (a, h) in reuse.items()}
        s["t2_refusals"] = dict(refusals.most_common(12))
        solves = defaultdict(list)
        exits = defaultdict(Counter)
        for r in rs:
            for x in r.get("solves") or []:
                key = f'{x["site"]}:{x["engine"]}'
                solves[key].append(x["rounds"])
                exits[key][x["exit"] if not x.get("reason") or x["exit"] == "solved" else f'{x["exit"]}: {x["reason"]}'] += 1
        s["solves"] = {k: {"rounds": spread(v), "exits": dict(exits[k].most_common(8))} for k, v in solves.items()}
        rules = defaultdict(Counter)
        errs = defaultdict(list)
        for r in rs:
            for x in r.get("rf") or []:
                rules[x["site"]][x["exit"] if x["exit"] != "refused" else f'refused: {x.get("reason")}'] += 1
                for f in ("d_sigma", "d_x"):
                    if x.get(f) is not None:
                        errs[f"{x['site']}:{f}"].append(x[f])
        s["tier2_rules"] = {k: dict(v.most_common(10)) for k, v in rules.items()}
        s["stated_errors"] = {k: spread(v) for k, v in errs.items()}
        fates = Counter()
        inconsistent = 0
        for r in ans:
            el = r.get("eligibility") or {}
            fates.update((el.get("fate") or {}).values())
            inconsistent += 0 if el.get("consistent", True) else 1
        s["fates"] = dict(fates.most_common())
        s["eligibility_inconsistent"] = inconsistent
        # lens effects against A, same request and limit, both answered
        same_pick = Counter()
        top_overlap = defaultdict(list)
        for r in ans:
            a = base.get((r["index"], lim))
            if a is None or cfg == "A":
                continue
            for lens, pick in (r.get("picks") or {}).items():
                same_pick[(lens, pick == a["picks"].get(lens))] += 1
            for lens, top in (r.get("lens_order") or {}).items():
                ta = set((a.get("lens_order") or {}).get(lens) or [])
                if ta or top:
                    top_overlap[lens].append(len(ta & set(top)) / max(len(ta), len(top), 1))
        s["picks_vs_A"] = {f"{lens}:{'same' if same else 'changed'}": n for (lens, same), n in sorted(same_pick.items())}
        s["top20_overlap_vs_A"] = {lens: spread(v) for lens, v in top_overlap.items()}
        out[f"{cfg}:{lim}"] = s
    return out


def forecast(ledger: dict, pilot_n: int = 24) -> dict:
    """Section 1's size rule: N the largest multiple of 24 up to 240 whose forecast fits the allowance left with a
    2-hour margin. The forecast for the requests after the pilot is their count times the pilot's mean per-request
    CPU times 1.25 (headroom for the population's spread); the margin covers the repricing and reference work."""
    per = [e["cpu_s"] for e in ledger["entries"] if e.get("kind") == "request"]
    mean = sum(per) / len(per)
    left = runner.ALLOWANCE_S - ledger["total_s"]
    rows = []
    best = pilot_n
    for n in range(pilot_n, 241, 24):
        need = (n - pilot_n) * mean * 1.25
        fits = need + 2 * 3600 <= left
        rows.append({"N": n, "forecast_h": round(need / 3600, 3), "fits": fits})
        if fits:
            best = n
    return {"per_request_s": spread(per), "mean_s": mean, "ledger_h": ledger["total_s"] / 3600,
            "left_h": left / 3600, "N": best, "table": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=Path)
    ap.add_argument("--forecast", action="store_true")
    args = ap.parse_args(argv)
    out = {"summary": summarize(load(args.run))}
    if args.forecast:
        out["forecast"] = forecast(runner.read_ledger())
    json.dump(out, sys.stdout, indent=1, default=str)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
