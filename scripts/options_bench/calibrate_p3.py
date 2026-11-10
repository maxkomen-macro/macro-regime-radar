"""scripts/options_bench/calibrate_p3.py — Phase 3 calibration on the development seed (test tooling, dev only).

    python -m scripts.options_bench.calibrate_p3 bumps --per-group 40 --out DIR [--workers 3]
    python -m scripts.options_bench.calibrate_p3 grid --per-group 40 --out DIR [--workers 3]

Stage `bumps` (design section 8.5 step 1, section 4.2): for each bumped Greek, the frozen bump size is the
smallest candidate meeting the bump-stability rule (withheld rule 3, |G(h) − G(h/2)| ≤ tol_G at L2) in at
least 95% of the dev contexts where that rule is reached. A context reaches rule 3 when the Greek is returned,
withheld "estimate above tolerance" or withheld "unstable under the bump"; every earlier withholding (domain,
near a decision, refusal, region, no dividend) never reaches it and is counted apart, by reason.

Stage `grid` (design section 3.4, the FD role rule of section 10): production m and p are fractions of the
reference grid's. For each candidate pair, every dev context with a resolved corroborated price reference R
is priced at L1 and L2; the pair qualifies when, in every group, at least 99% of those contexts have
|V_FD(L2) − R| ≤ 0.1·tol (an FD refusal counts as not agreeing) and none has |V_FD(L2) − R| > tol + u (a
confirmed failure). The frozen pair is the qualifying one with the least total work at L1 + L2; ties go to
the finer grid. Development seed only; the held-out run is the frozen procedure.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases, controls_p3 as C, greek_reference as GR

DEV_SEED = 20261026
STABILITY_SHARE = 0.95
# design section 4.2: candidates in each bumped quantity's own units, smallest last
CANDIDATES = {G.VEGA: ("h_sigma", (0.005, 0.0025, 0.00125)),
              G.RHO: ("h_r", (1e-3, 5e-4, 2.5e-4)),
              G.DIVIDEND: ("h_d_frac", (0.01, 0.005, 0.0025))}
REACHED = {None, G.R_ESTIMATE, G.R_UNSTABLE}
M_FRACS = (0.125, 0.25, 0.5)
P_FRACS = (0.25, 0.5, 1.0)
GRID_AGREE = 0.1          # within 0.1·tol (the FD role rule)
GRID_SHARE = 0.99         # in at least 99% of resolved contexts, every group   # reasons of a Greek that reached rule 3 (None = returned)


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


def _grid_one(args) -> dict:
    case_json, = args
    case = cases.Case.from_json(case_json)
    c = C.to_ctx(case)
    out = {"case": case.id, "group": case.group}
    if om.in_domain(c) is not None or not c.spot - c.pv() > 0 or c.days == 0:
        out["skipped"] = True
        return out
    ref = GR.references(c, quantities=(GR.PRICE,))[GR.PRICE]
    out["ref"] = {k: ref.get(k) for k in ("status", "R", "u", "tol")}
    out["cands"] = []
    for mf in M_FRACS:
        for pf in P_FRACS:
            cfg = fd.FDConfig(m_frac=mf, p_frac=pf, work_cap=G.GreekConfig().fd.work_cap)
            lv = fd.levels(c, cfg)
            budget = fd.Budget(cfg.work_cap)
            got = [fd.price(c, lv[k], budget, penalty=cfg.penalty) for k in (0, 1)]
            row = {"m_frac": mf, "p_frac": pf, "units": budget.used}
            if all(isinstance(g, fd.Solved) for g in got):
                row.update(v1=got[0].value, v2=got[1].value)
            else:
                row["refused"] = next(g.reason for g in got if isinstance(g, fd.Refused))
            out["cands"].append(row)
    return out


def choose_grid(rows: list[dict]) -> dict:
    """Per candidate (m_frac, p_frac): per group resolved contexts, agreements, refusals, confirmed failures,
    total work; the qualifying candidate with the least work."""
    per = {}
    for r in rows:
        if r.get("skipped"):
            continue
        ref = r["ref"]
        for row in r["cands"]:
            key = (row["m_frac"], row["p_frac"])
            p = per.setdefault(key, {"m_frac": key[0], "p_frac": key[1], "units": 0, "groups": {}})
            p["units"] += row["units"]
            if ref["status"] != "resolved":
                continue
            g = p["groups"].setdefault(r["group"], {"resolved": 0, "agree": 0, "refused": 0, "failures": [],
                                                    "max_err_over_tol": 0.0})
            g["resolved"] += 1
            if "refused" in row:
                g["refused"] += 1
                continue
            err = abs(row["v2"] - ref["R"])
            g["max_err_over_tol"] = max(g["max_err_over_tol"], err / ref["tol"])
            g["agree"] += err <= GRID_AGREE * ref["tol"]
            if err > ref["tol"] + ref["u"]:
                g["failures"].append(r["case"])
    for p in per.values():
        p["qualifies"] = bool(p["groups"]) and all(
            g["agree"] >= GRID_SHARE * g["resolved"] and not g["failures"] for g in p["groups"].values())
    ok = [p for p in per.values() if p["qualifies"]]
    choice = min(ok, key=lambda p: (p["units"], -p["m_frac"], -p["p_frac"])) if ok else None
    return {"candidates": sorted(per.values(), key=lambda p: (p["m_frac"], p["p_frac"])),
            "chosen": None if choice is None else {"m_frac": choice["m_frac"], "p_frac": choice["p_frac"]}}


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
    ap.add_argument("stage", choices=("bumps", "grid"))
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
    one, choose = {"bumps": (_bump_one, choose_bumps), "grid": (_grid_one, choose_grid)}[a.stage]
    rows = []
    with ProcessPoolExecutor(a.workers) as ex, (out / f"{a.stage}-rows.jsonl").open("w") as f:
        for r in ex.map(one, todo):
            rows.append(r)
            f.write(json.dumps(r, allow_nan=True) + "\n")
            f.flush()
    if a.stage == "bumps":
        res = {"seed": a.seed, "per_group": a.per_group, "share_required": STABILITY_SHARE, "bumps": choose(rows)}
        print(json.dumps({g: v["chosen"] for g, v in res["bumps"].items()}))
    else:
        res = {"seed": a.seed, "per_group": a.per_group, "agree": GRID_AGREE, "share_required": GRID_SHARE,
               "grid": choose(rows)}
        print(json.dumps(res["grid"]["chosen"]))
    (out / f"{a.stage}.json").write_text(json.dumps(res, indent=1, allow_nan=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
