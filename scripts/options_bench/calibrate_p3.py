"""scripts/options_bench/calibrate_p3.py — Phase 3 calibration on the development seed (test tooling, dev only).

    python -m scripts.options_bench.calibrate_p3 bumps --per-group 40 --out DIR [--workers 3]

Stage `bumps` (design section 8.5 step 1, section 4.2): for each bumped Greek, the frozen bump size is the
smallest candidate meeting the bump-stability rule (withheld rule 3, |G(h) − G(h/2)| ≤ tol_G at L2) in at
least 95% of the dev contexts where that rule is reached. A context reaches rule 3 when the Greek is returned,
withheld "estimate above tolerance" or withheld "unstable under the bump"; every earlier withholding (domain,
near a decision, refusal, region, no dividend) never reaches it and is counted apart, by reason.
Development seed only; the held-out run is the frozen procedure.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases, controls_p3 as C

DEV_SEED = 20261026
STABILITY_SHARE = 0.95
# design section 4.2: candidates in each bumped quantity's own units, smallest last
CANDIDATES = {G.VEGA: ("h_sigma", (0.005, 0.0025, 0.00125)),
              G.RHO: ("h_r", (1e-3, 5e-4, 2.5e-4)),
              G.DIVIDEND: ("h_d_frac", (0.01, 0.005, 0.0025))}
REACHED = {None, G.R_ESTIMATE, G.R_UNSTABLE}   # reasons of a Greek that reached rule 3 (None = returned)


def _bump_one(args) -> dict:
    case_json, = args
    case = cases.Case.from_json(case_json)
    c = C.to_ctx(case)
    out = {"case": case.id, "group": case.group, "rows": {}}
    if om.in_domain(c) is not None or not c.spot - c.pv() > 0 or c.days == 0:
        out["skipped"] = True
        return out
    for i in range(3):
        cfg = replace(G.GreekConfig(), **{name: cands[i] for name, cands in CANDIDATES.values()})
        got = G.greeks(c, cfg)
        for g in G.BUMPED:
            a = got[g]
            out["rows"].setdefault(g, []).append({"status": a.status, "reason": a.reason,
                                                  "h": a.audit.get("h"), "L2": a.audit.get("L2"),
                                                  "L2_half": a.audit.get("L2_half"), "tol": a.audit.get("tol")})
    return out


def choose_bumps(rows: list[dict]) -> dict:
    """Per bumped Greek and candidate: contexts reaching rule 3, how many pass it, the share, and the choice."""
    out = {}
    for g, (name, cands) in CANDIDATES.items():
        per = []
        for i, h in enumerate(cands):
            reached = passed = 0
            before = Counter()
            by_group = defaultdict(lambda: [0, 0])
            for r in rows:
                if r.get("skipped") or g not in r["rows"]:
                    continue
                a = r["rows"][g][i]
                if a["status"] in (G.EXACT_EXEMPT, G.EXACT_EXERCISED):
                    before[a["status"]] += 1
                    continue
                if a["status"] == G.WITHHELD and a["reason"] not in REACHED:
                    before[a["reason"]] += 1
                    continue
                reached += 1
                ok = a["reason"] != G.R_UNSTABLE
                passed += ok
                by_group[r["group"]][0] += 1
                by_group[r["group"]][1] += ok
            per.append({name: h, "reached": reached, "passed": passed,
                        "share": passed / reached if reached else None,
                        "by_group": {k: {"reached": v[0], "passed": v[1]} for k, v in sorted(by_group.items())},
                        "not_reached": dict(before)})
        meeting = [p for p in per if p["share"] is not None and p["share"] >= STABILITY_SHARE]
        choice = min(meeting, key=lambda p: p[name])[name] if meeting else None
        out[g] = {"parameter": name, "candidates": per, "chosen": choice}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=("bumps",))
    ap.add_argument("--seed", type=int, default=DEV_SEED)
    ap.add_argument("--per-group", type=int, default=40)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = ap.parse_args(argv)
    if a.seed != DEV_SEED:
        raise SystemExit("calibration runs on the development seed only")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    todo = [(c.to_json(),) for c in cases.suite(a.seed, a.per_group, named=False)]
    rows = []
    with ProcessPoolExecutor(a.workers) as ex, (out / "bumps-rows.jsonl").open("w") as f:
        for r in ex.map(_bump_one, todo):
            rows.append(r)
            f.write(json.dumps(r, allow_nan=True) + "\n")
            f.flush()
    res = {"seed": a.seed, "per_group": a.per_group, "share_required": STABILITY_SHARE, "bumps": choose_bumps(rows)}
    (out / "bumps.json").write_text(json.dumps(res, indent=1, allow_nan=True))
    print(json.dumps({g: v["chosen"] for g, v in res["bumps"].items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
