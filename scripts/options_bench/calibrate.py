"""scripts/options_bench/calibrate.py — Phase 2 calibration on development data, and the proposed freeze (test tooling).

    python -m scripts.options_bench.calibrate --refs RUN_DIR --out CAL_DIR [--workers 4]   # price every candidate
    python -m scripts.options_bench.calibrate --refs RUN_DIR --out CAL_DIR --select        # choose, size, freeze

RUN_DIR is the stored run of seed 20261026 (development data): its references R0 are reused, since they do not
depend on the engine. Every candidate (two estimators × three schedules × F × F_d on {2, 2.5, 3, 4}) prices
every case through the controller itself, on levels shared through adaptive.LevelCache, so a candidate's
answer is the live controller's answer. A case where any candidate's estimate straddles gets one tightened
reference R1, aimed at the finest estimate any straddling candidate states (0.1 of it; never coarser than
any candidate needs), and every candidate is then judged by the same protocol (adaptive.judge).

Selection, written down before the run (plan revision 2; design P2-2, 9.6):
- F is the smallest value in {2, 2.5, 3, 4} with no confirmed exceedance and no unresolved case (precise
  straddle or inconsistent R1) in any in-domain group, and the largest needed factor (err − u)/E at most
  F/1.25, over accepted lattice prices whose F·E is above the floor. F never below 2. F_d likewise on deltas
  (every served delta with a stated estimate; the needed factor over envelope deltas above the floor).
- Among candidates with both, the highest Tier 2 coverage in the worst random group (G1 to G6), then the lower
  total work; the envelope wins a tie.
- No passing candidate: nothing is frozen and the result goes to Max.
Sizes (design 9.5 f): N_g, the smallest multiple of 100 of at least 2,400 with n·r − 4·sqrt(n·r·(1 − r)) >=
target for each per-group count; then G1 to G6 grow together by 100 until the aggregate meets 10,000 for both
price counts. A group needing more than 8,000, or with a zero rate, cannot be sized, and the freeze goes to Max.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import multiprocessing as mp
import os
import time
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_engine as oe

from . import adaptive, cases, phase2, reference, score

ESTIMATORS = ("envelope", "fitted")
SCHEDULES = ("doubling", "multiples", "hybrid")
GRID = oa.F_GRID
TARGET_GROUP, TARGET_ALL, TARGET_DELTA = 1000, 10_000, 300
SIZE_MIN, SIZE_STEP, SIZE_MAX, SIZE_SD = 2400, 100, 8000, 4.0
RANDOM = [g for g in cases.RANDOM_IN_DOMAIN_GROUPS if g != "G0-exempt"]   # G1 to G6: the groups the targets bind
APART = {"T1-near-boundary": 1500, "X1-outside": 400, "G0-exempt": 300}  # held-out, reported apart (plan rev 2)
HELD_OUT_SEED = 20261029   # never run before this freeze (the bench's only earlier seed is 20261026)
BANDS = ((1, 180), (181, 730), (731, 1118), (1119, 1464))


def key(est: str, sched: str, f: float, fd: float) -> str:
    return f"{est}/{sched}/F{f:g}/Fd{fd:g}"


def candidates():
    for est in ESTIMATORS:
        for sched in SCHEDULES:
            for f in GRID:
                for fd in GRID:
                    yield key(est, sched, f, fd), oa.Config(estimator=est, schedule=sched, F=f, F_d=fd)


def band(days: int) -> str:
    for lo, hi in BANDS:
        if lo <= days <= hi:
            return f"{lo}-{hi}"
    return "0"


# ── phase A: every candidate on one case ─────────────────────────────────────

PRICE_KEEP = ("route", "price_status", "value", "estimate", "E", "tol", "units", "reason", "estimator", "L", "U")
DELTA_KEEP = ("delta_status", "delta", "delta_estimate", "Ed", "delta_rule", "delta_reason", "units")
VERDICT_KEEP = ("verdict", "err", "u", "ref", "why")


def _v(j: dict) -> dict:
    return {k: j[k] for k in VERDICT_KEEP if k in j}


def work(rec: dict) -> dict:
    """Every candidate on one case. The price does not depend on F_d (levels run for the delta never move an
    accepted price), so each (estimator, schedule, F) keeps one price row and one delta row per F_d; the record
    says whether the price rows really were identical across F_d."""
    out: dict = {"case": rec["case"]}
    try:
        c = cases.Case.from_json(rec["case"])
        if "error" in rec or "ref" not in rec:
            out["error"] = "no reference in the stored record"
            return out
        r0v, r0d = rec["ref"]["value"], rec["ref"]["delta"]
        out["r0"] = {"value": phase2._pack(r0v), "delta": phase2._pack(r0d)}
        cache = adaptive.LevelCache()
        t0 = time.time()
        runs = {k: adaptive.run(c, cfg, cache) for k, cfg in candidates()}
        out["secs"] = time.time() - t0
        out["level_units"] = sum(lv.units for lv in cache.levels.values())
        # one R1 for the case, as fine as the finest straddling estimate needs
        vt = dt = None
        iv = lambda t: (t["L"], t["U"]) if t["route"] == oe.ROUTE_ANALYTIC else None
        for t in runs.values():
            if t["value"] is not None and t["estimate"] is not None:
                if adaptive.judge(t["value"], t["estimate"], r0v, interval=iv(t)).get("needs_r1"):
                    vt = min(vt or math.inf, adaptive.R1_FRACTION * t["estimate"])
            if t["delta"] is not None and t["delta_estimate"] is not None:
                if adaptive.judge(t["delta"], t["delta_estimate"], r0d).get("needs_r1"):
                    dt = min(dt or math.inf, adaptive.R1_FRACTION * t["delta_estimate"])
        r1 = adaptive.tighten(c, vt, dt) if vt is not None or dt is not None else None
        if r1:
            out["r1"] = r1
        out["runs"], same = {}, True
        for est in ESTIMATORS:
            for sched in SCHEDULES:
                for f in GRID:
                    t = runs[key(est, sched, f, 2.0)]
                    pr = {x: t.get(x) for x in PRICE_KEEP}
                    pr["price_units"] = t.get("price_units")
                    pr["proved_exceedance"] = bool(t.get("proved_exceedance"))
                    pr["inconsistent"] = bool(t.get("interval_inconsistent"))
                    if t["value"] is not None and t["estimate"] is not None:
                        pr["pv"] = _v(adaptive.judge(t["value"], t["estimate"], r0v, r1 and r1["value"], interval=iv(t)))
                    if t["value"] is not None:
                        pr["pacc"] = adaptive.judge_tol(t["value"], r0v["tol"], r0v, r1 and r1["value"])
                    ds = {}
                    for fd in GRID:
                        td = runs[key(est, sched, f, fd)]
                        same &= all(td.get(x) == t.get(x) for x in ("route", "price_status", "value", "estimate", "E"))
                        dr = {x: td.get(x) for x in DELTA_KEEP}
                        if td["delta"] is not None and td["delta_estimate"] is not None:
                            dr["dv"] = _v(adaptive.judge(td["delta"], td["delta_estimate"], r0d, r1 and r1["delta"]))
                        if td["delta"] is not None:
                            dr["dacc"] = adaptive.judge_tol(td["delta"], reference.DELTA_TOL, r0d, r1 and r1["delta"])
                        ds[f"{fd:g}"] = dr
                    out["runs"][f"{est}/{sched}/F{f:g}"] = {"price": pr, "delta": ds}
        out["price_independent_of_fd"] = same
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        out["traceback"] = traceback.format_exc()[-2000:]
    return out


def row(r: dict, est: str, sched: str, f: float, fd: float = 2.0) -> dict:
    """One candidate's answer on one calibration record: its price row merged with its delta row."""
    x = r["runs"][f"{est}/{sched}/F{f:g}"]
    d = x["delta"][f"{fd:g}"]
    return x["price"] | {k: v for k, v in d.items() if k != "units"} | {"units": d["units"]}


def price_all(refs: Path, out: Path, workers: int) -> None:
    recs, _ = phase2.read_refs(refs)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "candidates.jsonl"
    done = set()
    if path.exists():
        prev, truncated = score.read_results(path)
        if truncated or (path.read_text() and not path.read_text().endswith("\n")):
            path.write_text("".join(json.dumps(r) + "\n" for r in prev))
        done = {r["case"]["id"] for r in prev}
    todo = [r for r in sorted(recs, key=lambda r: r["case"]["id"]) if r["case"]["id"] not in done]
    print(f"{len(recs)} cases, {len(done)} done, {len(todo)} to run", flush=True)
    t0 = time.time()
    with contextlib.ExitStack() as stack:
        if workers > 1:
            results = stack.enter_context(mp.get_context("fork").Pool(workers)).imap_unordered(work, todo, chunksize=4)
        else:
            results = map(work, todo)
        f = stack.enter_context(path.open("a"))
        for k, rec in enumerate(results):
            f.write(json.dumps(rec) + "\n")
            f.flush()
            if k % 500 == 0 or k == len(todo) - 1:
                print(f"{k + 1}/{len(todo)} {time.time() - t0:.0f}s", flush=True)


# ── phase B: selection ───────────────────────────────────────────────────────

FAILING = (adaptive.CONFIRMED, adaptive.UNRESOLVED)
SCORED = (adaptive.COVERED, adaptive.CONFIRMED, adaptive.UNRESOLVED)


def _price_check(rows: list[tuple[str, dict]], f: float) -> dict:
    """Exceedances and the needed factor for one candidate's accepted lattice prices (all in-domain groups)."""
    bad, needed, n = [], [], 0
    for cid, r in rows:
        if r.get("proved_exceedance") or r.get("inconsistent"):   # found without a reference: a failure too
            bad.append(cid)
        if r["route"] != oe.ROUTE_LATTICE or r["price_status"] != oe.ESTIMATED or "pv" not in r:
            continue
        v = r["pv"]
        if v["verdict"] in SCORED:
            n += 1
        if v["verdict"] in FAILING:
            bad.append(cid)
        if v["verdict"] in SCORED and r["E"] and f * r["E"] > oa.FLOOR * r["tol"]:
            needed.append((v["err"] - v["u"]) / r["E"])
    worst = max(needed) if needed else None
    return {"scored": n, "failing": bad, "needed_max": worst, "needed_cases": len(needed),
            "pass": not bad and (worst is None or worst <= f / 1.25)}


def _delta_check(rows: list[tuple[str, dict]], fd: float) -> dict:
    bad, needed, n = [], [], 0
    for cid, r in rows:
        if r["delta_status"] != oe.SERVED or "dv" not in r:
            continue
        v = r["dv"]
        if v["verdict"] in SCORED:
            n += 1
        if v["verdict"] in FAILING:
            bad.append(cid)
        if v["verdict"] in SCORED and r.get("Ed") and fd * r["Ed"] > oa.DELTA_FLOOR:
            needed.append((v["err"] - v["u"]) / r["Ed"])
    worst = max(needed) if needed else None
    return {"scored": n, "failing": bad, "needed_max": worst, "needed_cases": len(needed),
            "pass": not bad and (worst is None or worst <= fd / 1.25)}


def _rates(recs: list[dict], sel: tuple) -> dict:
    out = {}
    for g in RANDOM:
        rs = [r for r in recs if r["case"]["group"] == g]
        n = len(rs)
        p = e = d = 0
        for r in rs:
            t = row(r, *sel)
            if t["route"] == oe.ROUTE_LATTICE and t["price_status"] == oe.ESTIMATED and \
                    r["r0"]["value"]["status"] == "reliable":
                p += 1
                if t["pv"]["verdict"] in SCORED:
                    e += 1
            if t["delta_status"] == oe.SERVED and "dv" in t and t["dv"]["verdict"] in SCORED:
                d += 1
        out[g] = {"cases": n, "r_p": p / n if n else 0.0, "r_e": e / n if n else 0.0, "r_d": d / n if n else 0.0,
                  "price_scored": p, "estimator_scored": e, "delta_estimator_scored": d}
    return out


def _meets(n: float, r: float, target: float) -> bool:
    return n * r - SIZE_SD * math.sqrt(n * r * (1.0 - r)) >= target


def sizes(rates: dict) -> dict:
    """The frozen sizes from calibration rates (design 9.5 f)."""
    out, cannot = {}, {}
    for g, x in rates.items():
        if min(x["r_p"], x["r_e"], x["r_d"]) <= 0.0:
            cannot[g] = "a zero rate"
            continue
        n = SIZE_MIN
        while not (_meets(n, x["r_p"], TARGET_GROUP) and _meets(n, x["r_e"], TARGET_GROUP)
                   and _meets(n, x["r_d"], TARGET_DELTA)):
            n += SIZE_STEP
            if n > SIZE_MAX:
                cannot[g] = f"more than {SIZE_MAX} cases"
                break
        else:
            out[g] = n
    if cannot:
        return {"per_group": out, "cannot_be_sized": cannot}

    def agg(field: str) -> bool:
        mean = sum(out[g] * rates[g][field] for g in out)
        var = sum(out[g] * rates[g][field] * (1.0 - rates[g][field]) for g in out)
        return mean - SIZE_SD * math.sqrt(var) >= TARGET_ALL

    while not (agg("r_p") and agg("r_e")):
        out = {g: n + SIZE_STEP for g, n in out.items()}
        bad = {g: f"more than {SIZE_MAX} cases (aggregate)" for g, n in out.items() if n > SIZE_MAX}
        if bad:
            return {"per_group": out, "cannot_be_sized": bad}
    return {"per_group": out, "cannot_be_sized": {}}


def coverage(recs: list[dict], sel: tuple) -> dict:
    out = {}
    for g in cases.IN_DOMAIN_GROUPS:
        rs = [r for r in recs if r["case"]["group"] == g]
        priced = sum(1 for r in rs if row(r, *sel)["value"] is not None)
        out[g] = priced / len(rs) if rs else None
    return out


def select(cal_dir: Path) -> dict:
    recs, truncated = score.read_results(cal_dir / "candidates.jsonl")
    errors = [r["case"]["id"] for r in recs if "error" in r]
    good = [r for r in recs if "error" not in r]
    in_dom = [r for r in good if r["case"]["group"] in cases.IN_DOMAIN_GROUPS]
    report: dict = {"cases": len(recs), "errors": errors, "truncated": truncated, "combos": {}}
    passing = []
    for est in ESTIMATORS:
        for sched in SCHEDULES:
            combo: dict = {"F": {}, "F_d": {}}
            f_sel = None
            for f in GRID:
                rows = [(r["case"]["id"], row(r, est, sched, f)) for r in in_dom]
                chk = _price_check(rows, f)
                combo["F"][f"{f:g}"] = chk
                if chk["pass"] and f_sel is None:
                    f_sel = f
            fd_sel = None
            if f_sel is not None:
                for fd in GRID:
                    rows = [(r["case"]["id"], row(r, est, sched, f_sel, fd)) for r in in_dom]
                    chk = _delta_check(rows, fd)
                    combo["F_d"][f"{fd:g}"] = chk
                    if chk["pass"] and fd_sel is None:
                        fd_sel = fd
            combo["F_selected"], combo["F_d_selected"] = f_sel, fd_sel
            if f_sel is not None and fd_sel is not None:
                k = key(est, sched, f_sel, fd_sel)
                sel = (est, sched, f_sel, fd_sel)
                cov = coverage(good, sel)
                combo["coverage"] = cov
                combo["worst_random_coverage"] = min(cov[g] for g in RANDOM)
                combo["work_total"] = sum(row(r, *sel)["units"] for r in good)
                passing.append((-combo["worst_random_coverage"], combo["work_total"], est != "envelope", k, est,
                                sched, f_sel, fd_sel))
            report["combos"][f"{est}/{sched}"] = combo
    if not passing or errors or truncated:
        report["selected"] = None
        report["why_none"] = ("no candidate passes" if not passing else
                              "calibration records have errors" if errors else "the candidate file is truncated")
        return report
    passing.sort()
    _, _, _, k, est, sched, f_sel, fd_sel = passing[0]
    rates = _rates(good, (est, sched, f_sel, fd_sel))
    report["selected"] = {"key": k, "estimator": est, "schedule": sched, "F": f_sel, "F_d": fd_sel,
                          "ranking": [p[3] for p in passing]}
    report["rates"] = rates
    report["sizes"] = sizes(rates)
    return report


def freeze_doc(report: dict, cal_dir: Path) -> dict:
    sel = report["selected"]
    sz = report["sizes"]
    cfg = oa.Config(estimator=sel["estimator"], schedule=sel["schedule"], F=sel["F"], F_d=sel["F_d"], tau=1.0)
    per_group = {g: 0 for g in cases.GROUPS}
    per_group.update(sz["per_group"])
    per_group.update(APART)
    return {
        "phase": "options adaptive Phase 2, attempt 1",
        "frozen_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": adaptive.config_json(cfg),
        "engine_version": oa.VERSION,
        "constants": {"K_MAX": oa.K_MAX, "MIN_LEVELS": oa.MIN_LEVELS, "FLOOR": oa.FLOOR, "DELTA_FLOOR": oa.DELTA_FLOOR,
                      "P_RANGE": list(oa.P_RANGE), "P_BAND": oa.P_BAND, "ZERO_CHANGE": oa.ZERO_CHANGE,
                      "DEEP": oa.DEEP, "F_GRID": list(oa.F_GRID)},
        "tightening": {"fraction": adaptive.R1_FRACTION, "escalate_max": adaptive.R1_ESCALATE_MAX,
                       "cell_cap": adaptive.R1_CELL_CAP, "held_out_target": "0.1 of the stated estimate"},
        "held_out": {"seed": HELD_OUT_SEED, "per_group": per_group, "named": True,
                     "run_options": "run.py defaults (lattice check, QuantLib, controls every 10th, convention every "
                                    "10th, IV every 5th, dividend scenario every 3rd case with dividends)",
                     "phase2_options": {"repeat_every": 50}},
        "sizing": {"rule": "design P2-2 9.5 f", "targets": {"per_group": TARGET_GROUP, "aggregate": TARGET_ALL,
                                                             "delta_per_group": TARGET_DELTA},
                   "sd": SIZE_SD, "min": SIZE_MIN, "step": SIZE_STEP, "max": SIZE_MAX, "rates": report["rates"],
                   "cannot_be_sized": sz["cannot_be_sized"]},
        "calibration": {"seed": 20261026, "selection_report_sha256": phase2.sha(cal_dir / "selection.json"),
                        "candidates_sha256": phase2.sha(cal_dir / "candidates.jsonl"), "selected": sel},
        "files_sha256": phase2.file_hashes(),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--select", action="store_true", help="select, size and write the proposed freeze")
    ap.add_argument("--freeze-out", default=str(phase2.BENCH_DIR / "calibration" / "phase2-freeze.json"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    if not args.select:
        price_all(Path(args.refs), out, args.workers)
        return 0
    report = select(out)
    (out / "selection.json").write_text(json.dumps(report, indent=2))
    if report["selected"] is None:
        print("no candidate selected:", report["why_none"])
        return 1
    if report["sizes"]["cannot_be_sized"]:
        print("cannot be sized:", report["sizes"]["cannot_be_sized"], "- the freeze goes to Max")
    fz = freeze_doc(report, out)
    Path(args.freeze_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.freeze_out).write_text(json.dumps(fz, indent=2) + "\n")
    print(json.dumps(report["selected"]), json.dumps(report["sizes"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
