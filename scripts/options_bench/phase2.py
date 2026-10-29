"""scripts/options_bench/phase2.py — Tier 2 on a finished bench run, with tightened references (test tooling).

    python -m scripts.options_bench.phase2 --refs RUN_DIR --freeze scripts/options_bench/calibration/phase2-freeze.json \
        --out P2_DIR [--held-out] [--workers 4]
    python -m scripts.options_bench.score2 P2_DIR

RUN_DIR is a finished run of scripts/options_bench/run.py: its standard references R0 and the baseline's own
answers are read from it, never recomputed (they do not depend on Tier 2). For each case this runner prices
Tier 2 under the frozen configuration, checks that options_engine.baseline still equals the bench's run of
the baseline, judges every stated estimate against R0, computes one tightened reference R1 for any estimate
that straddles (adaptive.tighten), prices the dividend scenario's bumped cases where RUN_DIR has them, and
records coverage and work at the report-only targets 0.5, 0.25 and 0.1 tol. With --repeat-every k, every k-th
case is priced a second time from scratch, and the two answers must be identical (determinism).

The freeze file fixes the configuration and the SHA-256 of every engine and bench file; the runner refuses to
start if any differs. With --held-out it also refuses a RUN_DIR whose seed or per-group sizes are not the
freeze's. Results are one JSON line per case in P2_DIR/results-<shard>.jsonl, written as each case finishes, so
an interrupted run resumes with the same command.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import hashlib
import json
import multiprocessing as mp
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from src.desk import options_adaptive as oa
from src.desk import options_engine as oe

from . import adaptive, cases, reference, score

BENCH_DIR = Path(__file__).resolve().parent
REPO = BENCH_DIR.parent.parent
SWEEP = (0.5, 0.25, 0.1)   # report-only targets, as fractions of tol (decision 3; Phase 4 starts from these)

# Files whose hashes the freeze pins: the engine (Tier 1 and Tier 2) and every bench module that can change a
# result or its scoring.
FROZEN_FILES = ("src/desk/options_math.py", "src/desk/options_finder.py", "src/desk/options_engine.py",
                "src/desk/options_adaptive.py", "src/market_data/session.py")


def frozen_paths() -> list[str]:
    return list(FROZEN_FILES) + sorted(str(p.relative_to(REPO)) for p in BENCH_DIR.glob("*.py"))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_hashes() -> dict:
    return {p: sha(REPO / p) for p in frozen_paths()}


def check_freeze(freeze: dict) -> list[str]:
    """The files whose hash differs from the freeze (and files the freeze does not list), empty when all match."""
    now = file_hashes()
    want = freeze["files_sha256"]
    return sorted({p for p in set(now) | set(want) if now.get(p) != want.get(p)})


def config_from(freeze: dict) -> oa.Config:
    return oa.Config(**freeze["config"])


# ── one case ─────────────────────────────────────────────────────────────────

def _pack(r: dict | None) -> dict | None:
    return None if r is None else {k: r[k] for k in ("ref", "u", "status", "tol", "limit") if k in r}


def price_case(c: cases.Case, cfg: oa.Config, r0v: dict, r0d: dict, tighten: bool = True) -> dict:
    """Tier 2 on one case with its verdicts (the part calibration and the held-out run share)."""
    cache = adaptive.LevelCache()
    t2 = adaptive.run(c, cfg, cache)
    out: dict = {"tier2": t2}
    pj = dj = None
    iv = (t2["L"], t2["U"]) if t2["route"] == oe.ROUTE_ANALYTIC else None
    if t2["value"] is not None and t2["estimate"] is not None:
        pj = adaptive.judge(t2["value"], t2["estimate"], r0v, interval=iv)
    if t2["delta"] is not None and t2["delta_estimate"] is not None:
        dj = adaptive.judge(t2["delta"], t2["delta_estimate"], r0d)
    r1 = None
    if tighten and ((pj and pj.get("needs_r1")) or (dj and dj.get("needs_r1"))):
        r1 = adaptive.tighten(c, adaptive.R1_FRACTION * t2["estimate"] if pj and pj.get("needs_r1") else None,
                              adaptive.R1_FRACTION * t2["delta_estimate"] if dj and dj.get("needs_r1") else None)
        out["r1"] = r1
        if pj and pj.get("needs_r1"):
            pj = adaptive.judge(t2["value"], t2["estimate"], r0v, r1["value"], interval=iv)
        if dj and dj.get("needs_r1"):
            dj = adaptive.judge(t2["delta"], t2["delta_estimate"], r0d, r1["delta"])
    out["price_verdict"], out["delta_verdict"] = pj, dj
    if t2["value"] is not None:
        out["price_accuracy"] = adaptive.judge_tol(t2["value"], r0v["tol"], r0v, r1 and r1["value"])
        lo, hi = t2.get("L"), t2.get("U")
        out["inside_interval"] = None if lo is None else bool(lo <= t2["value"] <= hi)
    if t2["delta"] is not None:
        out["delta_accuracy"] = adaptive.judge_tol(t2["delta"], reference.DELTA_TOL, r0d, r1 and r1["delta"])
    out["_cache"] = cache
    return out


def work(job: tuple) -> dict:
    rec, cfg_json, opts = job
    out: dict = {"case": rec["case"]}
    try:
        c = cases.Case.from_json(rec["case"])
        if "error" in rec or "ref" not in rec or "engine" not in rec:
            out["error"] = "the reference run's record has no reference or engine answer: " + str(rec.get("error"))
            return out
        cfg = oa.Config(**cfg_json)
        r0v, r0d = rec["ref"]["value"], rec["ref"]["delta"]
        out["r0"] = {"value": _pack(r0v), "delta": _pack(r0d)}
        t0 = time.time()
        got = price_case(c, cfg, r0v, r0d)
        cache = got.pop("_cache")
        out.update(got)
        out["tier2_secs"] = time.time() - t0
        out["tier1_matches"] = adaptive.baseline_matches(c, rec["engine"])
        out["tier1"] = {k: rec["engine"].get(k) for k in ("status", "model", "value", "delta", "units")}
        out["sweep"] = {}
        for tau in SWEEP:
            a = adaptive.run(c, dataclasses.replace(cfg, tau=tau), cache)
            out["sweep"][str(tau)] = {"route": a["route"], "price_status": a["price_status"], "units": a["units"],
                                      "value": a["value"], "estimate": a["estimate"], "reason": a["reason"]}
        if opts["repeat"]:
            again = adaptive.run(c, cfg)    # from scratch: no cache, a fresh walk
            out["repeat_identical"] = again == out["tier2"]
        ds = rec.get("divsens")
        if ds:
            out["divsens"] = {}
            for side, f in (("up", 1.0 + 0.10), ("down", 1.0 - 0.10)):
                cb = dataclasses.replace(c, divs=tuple((d, a * f) for d, a in c.divs))
                t = adaptive.run(cb, cfg)
                out["divsens"][side] = {"tier2": {k: t[k] for k in ("route", "price_status", "value", "estimate",
                                                                   "reason")},
                                        "ref": _pack(ds[side]["ref"])}
        for k in ("control_european", "convention"):
            if k in rec:
                out[k] = rec[k]
    except Exception as e:   # recorded, never dropped: a crash is a result
        out["error"] = f"{type(e).__name__}: {e}"
        out["traceback"] = traceback.format_exc()[-2000:]
    return out


# ── the run ──────────────────────────────────────────────────────────────────

def read_refs(run_dir: Path) -> tuple[list[dict], list[dict]]:
    recs, mans = [], []
    for p in sorted(run_dir.glob("results-*.jsonl")):
        rs, truncated = score.read_results(p)
        if truncated:
            raise SystemExit(f"{p} ends in a partial record: finish the reference run first")
        recs += rs
    for p in sorted(run_dir.glob("manifest-*.json")):
        mans.append(json.loads(p.read_text()))
    if not recs or not mans:
        raise SystemExit(f"no finished reference run in {run_dir}")
    return recs, mans


def refs_population(recs: list[dict], mans: list[dict]) -> dict:
    """The reference run's own case list, regenerated from its manifests (seed, sizes, named), against the
    records received: every shard compatible and present, every case there once and finished. Missing cases are
    never silently dropped from both sides of a count (Codex S-2)."""
    try:
        score.check_compatible(mans)
        ids = [r["case"]["id"] for r in recs]
        comp = score.completeness(mans, set(ids))
    except ValueError as e:
        return {"complete": False, "why": str(e)}
    comp["duplicates"] = len(ids) - len(set(ids))
    comp["unfinished_shards"] = sorted(m["shard"] for m in mans if not m.get("finished_utc"))
    comp["complete"] = bool(comp["complete"] and not comp["missing_shards"] and not comp["duplicates"]
                            and not comp["unfinished_shards"])
    first = mans[0]
    comp["seed"], comp["per_group"], comp["named"] = first["seed"], first["per_group"], first["named"]
    comp["expected_ids"] = sorted(c.id for c in cases.suite(first["seed"], first["per_group"], named=first["named"]))
    return comp


def held_out_mismatch(pop: dict, freeze: dict) -> str | None:
    """Why a reference run is not the freeze's held-out population, or None."""
    ho = freeze["held_out"]
    if not pop["complete"]:
        return "the reference run is incomplete: " + json.dumps({k: pop.get(k) for k in (
            "why", "missing", "missing_shards", "duplicates", "unfinished_shards")})
    if pop["seed"] != ho["seed"] or pop["per_group"] != ho["per_group"] or pop["named"] != ho.get("named", True):
        return (f"the reference run is seed {pop['seed']} with sizes {pop['per_group']}; the freeze's held-out run "
                f"is seed {ho['seed']} with sizes {ho['per_group']}")
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refs", required=True, help="a finished run.py directory (its R0 and baseline answers)")
    ap.add_argument("--freeze", required=True, help="the freeze file: configuration and file hashes")
    ap.add_argument("--out", required=True)
    ap.add_argument("--held-out", action="store_true", help="refuse a reference run that is not the freeze's held-out seed and sizes")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--repeat-every", type=int, default=50, help="price every k-th case twice from scratch (0: none)")
    args = ap.parse_args(argv)
    freeze = json.loads(Path(args.freeze).read_text())
    bad = check_freeze(freeze)
    if bad:
        raise SystemExit("files differ from the freeze: " + ", ".join(bad))
    cfg = config_from(freeze)
    recs, mans = read_refs(Path(args.refs))
    pop = refs_population(recs, mans)
    if args.held_out:
        why = held_out_mismatch(pop, freeze)
        if why:
            raise SystemExit(why)
    i_shard, n_shard = (int(x) for x in args.shard.split("/"))
    recs = sorted(recs, key=lambda r: r["case"]["id"])
    mine = [r for k, r in enumerate(recs) if k % n_shard == i_shard]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tag = f"{i_shard}of{n_shard}"
    res_path = out / f"results-{tag}.jsonl"
    done = set()
    if res_path.exists():
        prev, truncated = score.read_results(res_path)
        if truncated or (res_path.read_text() and not res_path.read_text().endswith("\n")):
            res_path.write_text("".join(json.dumps(r) + "\n" for r in prev))
        done = {r["case"]["id"] for r in prev}
    man = {"runner": "scripts/options_bench/phase2.py", "command": sys.argv, "freeze": str(args.freeze),
           "freeze_sha256": sha(Path(args.freeze)), "config": adaptive.config_json(cfg), "engine_version": oa.VERSION,
           "files_sha256": file_hashes(), "refs": str(Path(args.refs).resolve()),
           "refs_manifests": [{k: m.get(k) for k in ("seed", "per_group", "bench_files_sha256", "engine", "shard",
                                                    "cases_in_shard", "started_utc", "finished_utc")} for m in mans],
           "refs_population": {k: pop.get(k) for k in ("complete", "why", "expected", "received", "missing",
                                                       "missing_shards", "duplicates", "unfinished_shards")},
           "held_out": args.held_out, "shard": args.shard, "cases_in_shard": len(mine),
           "repeat_every": args.repeat_every, "sweep": list(SWEEP),
           "tightening": {"fraction": adaptive.R1_FRACTION, "escalate_max": adaptive.R1_ESCALATE_MAX,
                          "cell_cap": adaptive.R1_CELL_CAP},
           "started_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    man_path = out / f"manifest-{tag}.json"
    if man_path.exists():
        prior = json.loads(man_path.read_text())
        keys = ("freeze_sha256", "config", "files_sha256", "refs_manifests", "held_out", "shard", "cases_in_shard",
                "repeat_every")
        diff = [k for k in keys if json.loads(json.dumps(prior.get(k))) != json.loads(json.dumps(man.get(k)))]
        if diff:
            raise SystemExit(f"this directory was started with other code or inputs ({', '.join(diff)}): use a new --out")
        prior.setdefault("sessions", []).append({"resumed_utc": man["started_utc"], "already_done": len(done)})
        man = prior
    man_path.write_text(json.dumps(man, indent=2))
    todo = []
    for r in mine:
        if r["case"]["id"] in done:
            continue
        idx = int(r["case"]["id"].split("/")[1]) if r["case"]["kind"] != "named" else 0
        todo.append((r, adaptive.config_json(cfg),
                     {"repeat": r["case"]["kind"] == "named" or bool(args.repeat_every and idx % args.repeat_every == 0)}))
    print(f"{len(mine)} cases in shard {args.shard}, {len(done)} already done, {len(todo)} to run", flush=True)
    t0 = time.time()
    with contextlib.ExitStack() as stack:
        if args.workers > 1:
            pool = stack.enter_context(mp.get_context("fork").Pool(args.workers))
            results = pool.imap_unordered(work, todo, chunksize=1)
        else:
            results = map(work, todo)
        f = stack.enter_context(res_path.open("a"))
        for k, rec in enumerate(results):
            f.write(json.dumps(rec) + "\n")
            f.flush()
            if k % 250 == 0 or k == len(todo) - 1:
                print(f"{k + 1}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    man["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    man.setdefault("wall_seconds_by_session", []).append(round(time.time() - t0, 1))
    man_path.write_text(json.dumps(man, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
