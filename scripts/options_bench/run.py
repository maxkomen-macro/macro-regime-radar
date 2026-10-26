"""scripts/options_bench/run.py — the sharded, resumable benchmark runner (test tooling).

    python -m scripts.options_bench.run --engine-root ENGINE --out RUN_DIR --per-group 150 --seed 20261026
    python -m scripts.options_bench.run ... --shard 0/4     # this machine runs case ids with index % 4 == 0
    python -m scripts.options_bench.score RUN_DIR [RUN_DIR ...]

Each case is written as one JSON line to RUN_DIR/results-<shard>.jsonl as soon as it finishes, so a run that
stops can be resumed with the same command (finished ids are skipped). RUN_DIR/manifest-<shard>.json records
the command, seed, sizes, package versions, platform, and the engine's and the bench's file hashes.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import importlib.util
import json
import multiprocessing as mp
import os
import platform
import subprocess
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import scipy

from . import cases, crosscheck, engine, reference, score

BENCH_DIR = Path(__file__).resolve().parent
REPO = BENCH_DIR.parent.parent
DIV_BUMP = 0.10                        # the dividend-sensitivity scenario: every owed amount ×(1 ± 0.10)
CONVENTION_START = date(2026, 10, 26)  # a Monday session: day 0 of every convention-study case


def calendar_last_day() -> date:
    return date(max(_session().HOLIDAYS), 12, 31)


def business_closes(days: int, start: date = CONVENTION_START) -> list[int]:
    """Day indices 0..days-1 whose date is an NYSE session, from src/market_data/session.py's holiday tables.
    Refuses a horizon past the tables' last year: there every weekday would count as a session, holidays
    included (Codex OB-05)."""
    if start + timedelta(days=days) > calendar_last_day():
        raise ValueError(f"the NYSE holiday tables end {calendar_last_day()}: no business-day schedule past it")
    return [d for d in range(days) if _session().is_trading_day(start + timedelta(days=d))]


_SESSION = None


def _session():
    """src/market_data/session.py loaded by path (stdlib only), so it never collides with the engine's src."""
    global _SESSION
    if _SESSION is None:
        spec = importlib.util.spec_from_file_location("options_bench_session", REPO / "src" / "market_data" / "session.py")
        _SESSION = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_SESSION)
    return _SESSION


def _pack(r: dict | None) -> dict | None:
    if r is None:
        return None
    return {k: r[k] for k in ("ref", "u", "status", "limit", "raw_finest", "u_width", "u_penalty", "tol")
            if k in r} | {"time": r["time"], "space": r["space"]}


def work(job: tuple) -> dict:
    c_json, opts = job
    c = cases.Case.from_json(c_json)
    rec: dict = {"case": c_json}
    try:
        ref = reference.reference(c)
        rec["ref"] = {"value": _pack(ref["value"]), "delta": _pack(ref["delta"]), "grid": ref["grid"],
                      "secs": ref["secs"]}
        rec["engine"] = engine.run(opts["engine_root"], c)
        if opts["lattice_check"]:
            rec["lattice"] = engine.lattice_check(opts["engine_root"], c)
        if opts["quantlib"]:
            rec["quantlib"] = crosscheck.quantlib(c)
        if opts["controls"]:
            eu = reference.reference(c, american=False)
            bs = crosscheck.black76_case(c)
            rec["control_european"] = {"value": _pack(eu["value"]), "delta": _pack(eu["delta"]),
                                       "black76": bs[0], "black76_delta": bs[1]}
        if opts["iv"] and ref["value"]["status"] == "reliable" and rec["engine"]["status"] == "served":
            rec["iv"] = engine.iv_roundtrip(opts["engine_root"], c, ref["value"]["ref"])
        if opts["divsens"] and c.divs:
            rec["divsens"] = {}
            for side, f in (("up", 1.0 + DIV_BUMP), ("down", 1.0 - DIV_BUMP)):
                cb = dataclasses.replace(c, divs=tuple((d, a * f) for d, a in c.divs))
                rb = reference.reference(cb)
                rec["divsens"][side] = {"ref": _pack(rb["value"]), "engine": engine.run(opts["engine_root"], cb)}
        if opts["convention"] and CONVENTION_START + timedelta(days=c.days) > calendar_last_day():
            rec["convention"] = {"skipped": f"expiry after {calendar_last_day()}, where the holiday tables end"}
        elif opts["convention"]:
            berm = reference.reference(c, exercise_days=business_closes(c.days))
            rec["convention"] = {"schedule": "NYSE closes from 2026-10-26, and expiry",
                                 "value": _pack(berm["value"]), "delta": _pack(berm["delta"])}
    except Exception as e:  # recorded, never dropped: a crash is a result
        rec["error"] = f"{type(e).__name__}: {e}"
        rec["traceback"] = traceback.format_exc()[-2000:]
    return rec


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def manifest(args, shard: str, n_cases: int) -> dict:
    git = lambda *a: subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True).stdout.strip()
    return {
        "bench": "scripts/options_bench",
        "bench_files_sha256": {p.name: _sha(p) for p in sorted(BENCH_DIR.glob("*.py"))},
        "bench_git_commit": git("rev-parse", "HEAD") or None,
        "bench_git_dirty": bool(git("status", "--porcelain", "--", "scripts/options_bench")),
        "engine": engine.describe(args.engine_root) | ({"git_commit": args.engine_commit} if args.engine_commit else {}),
        "command": sys.argv,
        "seed": args.seed,
        "per_group": args.per_group,
        "groups": {g: {"kind": k, "in_domain": i} for g, (k, i, _) in cases.GROUPS.items()},
        "named": not args.no_named,
        "shard": shard,
        "cases_in_shard": n_cases,
        "options": {"lattice_check": not args.no_lattice_check, "quantlib": crosscheck.ql is not None and not args.no_quantlib,
                    "controls_every": args.controls_every, "convention_every": args.convention_every,
                    "iv_every": args.iv_every, "divsens_every": args.divsens_every, "div_bump": DIV_BUMP},
        "reference": {"method": "bench FD (fd.py), GCI refinement study (reference.py)",
                      "ref_fraction": reference.REF_FRACTION, "cell_cap": reference.CELL_CAP,
                      "escalate_max": reference.ESCALATE_MAX, "tolerance": "max(1e-4·S, 5e-4·V)",
                      "delta_tol": reference.DELTA_TOL,
                      "assumptions": ["errors additive across time and space refinement",
                                      "GCI safety factor 1.25 on monotone three-level studies, order capped at 2",
                                      "uncertainty is an estimate from observed refinement, not a proved bound"]},
        "domain": cases.DOMAIN,
        "convention_calendar": "src/market_data/session.py holiday tables; cases expiring after their last year skip the study",
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
                     "quantlib": crosscheck.quantlib_version()},
        "platform": {"machine": platform.machine(), "system": platform.platform(), "cpus": os.cpu_count()},
        "started_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def parse_per_group(s: str):
    if "=" not in s:
        return int(s)
    out = {g: 0 for g in cases.GROUPS}
    for part in s.split(","):
        k, v = part.split("=")
        if k not in out:
            raise SystemExit(f"unknown group {k}")
        out[k] = int(v)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine-root", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=20261026)
    ap.add_argument("--per-group", type=parse_per_group, default=150, help="N, or G1-nodiv=1000,G2-dividends=500,...")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--no-named", action="store_true")
    ap.add_argument("--no-lattice-check", action="store_true")
    ap.add_argument("--no-quantlib", action="store_true")
    ap.add_argument("--controls-every", type=int, default=10, help="European control on every k-th case (0: none)")
    ap.add_argument("--iv-every", type=int, default=5, help="implied-volatility round trip on every k-th case (0: none)")
    ap.add_argument("--divsens-every", type=int, default=3, help="dividend scenario on every k-th case with dividends (0: none)")
    ap.add_argument("--engine-commit", help="the engine's git commit, when --engine-root is an extracted copy")
    ap.add_argument("--convention-every", type=int, default=10, help="business-day exercise on every k-th case (0: none)")
    args = ap.parse_args(argv)
    engine.load(args.engine_root)  # fail fast when the engine is missing
    i_shard, n_shard = (int(x) for x in args.shard.split("/"))
    all_cases = list(cases.suite(args.seed, args.per_group, named=not args.no_named))
    mine = [c for k, c in enumerate(all_cases) if k % n_shard == i_shard]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tag = f"{i_shard}of{n_shard}"
    res_path = out / f"results-{tag}.jsonl"
    done = set()
    if res_path.exists():
        for line in res_path.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["case"]["id"])
    man = manifest(args, args.shard, len(mine))
    man_path = out / f"manifest-{tag}.json"
    prior = json.loads(man_path.read_text()) if man_path.exists() else None
    if prior:
        # every field that can change a result must match (Codex OB-04); the first session's record is kept
        bad = [k for k in score.RUN_KEYS + ("shard", "cases_in_shard") if prior.get(k) != man.get(k)]
        if bad:
            raise SystemExit(f"this run directory was started with other code or inputs ({', '.join(bad)}): use a new --out")
        prior.setdefault("sessions", []).append({"resumed_utc": man["started_utc"], "command": man["command"],
                                                 "already_done": len(done)})
        man = prior
    man_path.write_text(json.dumps(man, indent=2))
    todo = []
    for k, c in enumerate(mine):
        if c.id in done:
            continue
        idx = int(c.id.split("/")[1]) if c.kind != "named" else 0
        opts = {"engine_root": args.engine_root, "lattice_check": not args.no_lattice_check,
                "quantlib": not args.no_quantlib,
                "controls": c.kind == "named" or (args.controls_every and idx % args.controls_every == 0),
                "convention": c.kind == "named" or (args.convention_every and idx % args.convention_every == 0),
                "iv": c.kind == "named" or bool(args.iv_every and idx % args.iv_every == 0),
                "divsens": c.kind == "named" or bool(args.divsens_every and idx % args.divsens_every == 0)}
        todo.append((c.to_json(), opts))
    t0 = time.time()
    print(f"{len(mine)} cases in shard {args.shard}, {len(done)} already done, {len(todo)} to run", flush=True)
    ctx = mp.get_context("fork")
    with ctx.Pool(args.workers) as pool, res_path.open("a") as f:
        for k, rec in enumerate(pool.imap_unordered(work, todo, chunksize=1)):
            f.write(json.dumps(rec) + "\n")
            f.flush()
            if k % 25 == 0 or k == len(todo) - 1:
                print(f"{k + 1}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    man["finished_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    man.setdefault("wall_seconds_by_session", []).append(round(time.time() - t0, 1))
    man_path.write_text(json.dumps(man, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
