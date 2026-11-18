"""scripts/options_bench/heldout_p3.py — the Phase 3 held-out run: the frozen procedure, metered and resumable (test tooling).

    python -m scripts.options_bench.heldout_p3 --freeze scripts/options_bench/calibration/phase3-freeze.json --out DIR

Design: design-P3-approved.md 8.5 step 3 (Phase 2's guards S-9, S-10, A-2, S-14) and Max's P3-A21 (2026-11-18):
one registered experiment on the freeze's fresh seed, at most 130 aggregate CPU hours. Run it from an immutable
checkout of the freeze commit with DIR outside it.

Refusals before any case is drawn: a file whose SHA-256 differs from the freeze's, a checkout with tracked changes,
a seed the freeze registers as used (or the development seed), or a DIR started under another freeze, code or
population. The population is exactly the freeze's: the named cases, then every group's frozen size in seed order
(regions_p3.held_out); the controls' contexts come from it (C2-FD and C2-Q: each group's first `base` draws, plus
the first `dividend` draws carrying a dividend, for the dividend sensitivity alone) and from the E-strata's fixed
proposal populations on the same seed (C2-lattice and C1 on the first `base` kept, C2-lattice's dividend
sensitivity on the first `dividend` kept with a dividend). Inputs only decide membership: no top-up, no redraw.

Every job is one JSON line in DIR/results.jsonl, written when it finishes (a crash is recorded as a result, never
dropped). Jobs run in a fixed interleaved order, each stream (a group's cases, a group's controls, an E-stratum) at
the same fraction of its length, so a stopped run's partial result is spread evenly; resuming runs the jobs not yet
written. A case job is run_p3.one (production under the frozen regions and configuration, its references, the
price reference, the exact controls, C1, the proved bounds), plus the Phase 2 rows: Tier 2's answer against the
verbatim adaptive-p2.1 file in the same process (bit for bit, the version string apart), and for every
`repeat_every`-th case (and every named case) a second production run from scratch, which must be identical.

CPU meter (P3-A21): every `sample_seconds` the parent reads the user + system CPU of each worker process
(/proc/<pid>/stat) and its own, and appends the session's running total to DIR/cpu-meter.jsonl; a session's end
record takes the exact figure (os.times, children reaped). A session that ended without one (the container
stopped) counts its last sample plus workers × sample_seconds. The total over every session, lost and recomputed
work included, is the experiment's CPU. No job is submitted once the total is within `no_submit_margin_hours` of
the cap, and the run stops (workers terminated, every finished result kept) within `stop_margin_hours` of it.
Wall time is recorded separately per session.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import multiprocessing as mp
import os
import signal
import subprocess
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

from src.desk import options_adaptive as oa
from src.desk import options_greeks as G

from . import cases, controls_p3 as C, freeze_p3 as F, golden, greek_reference as GR, regions_p3 as RG, run_p3

P21_FILE, P21_BLOB = "options_adaptive_2ff3e8b.py", "c35574ad8cedb71bbe11e58a495883f707054b3d"
RESULTS, METER, MANIFEST = "results.jsonl", "cpu-meter.jsonl", "manifest.json"
HUNG_S = 6 * 3600.0     # a job running this long has lost its worker (the dev maximum was 2,740 s)


def utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canon(x):
    """Floats by their bits, so NaN equals NaN and -0.0 differs from 0.0 (tests/test_options_crosscheck.py)."""
    if isinstance(x, dict):
        return {k: canon(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [canon(v) for v in x]
    if isinstance(x, float):
        return ("f", x.hex())
    return x


def jsonable(o):
    """numpy scalars (a control's bool, an index) as their Python values; anything else is a bug, so it raises."""
    if hasattr(o, "item"):
        return o.item()
    raise TypeError(f"{type(o).__name__} is not JSON serializable")


def case_key(c_json: dict) -> str:
    return json.dumps(cases.Case.from_json(c_json).to_json(), sort_keys=True)


# ── the population ──────────────────────────────────────────────────────────

def population(freeze: dict) -> tuple[list[dict], dict]:
    """Every job of the frozen run in its fixed order, and what the plan could not supply (inputs only)."""
    ho = freeze["held_out"]
    seed = ho["seed"]
    sizes = {g: ho["sizes"][g] for g in cases.GROUPS if g in ho["sizes"]}
    streams: list[list[dict]] = []
    if ho.get("named", True):
        streams.append([{"key": f"case|{c.id}", "kind": "case", "case": c.to_json()} for c in cases.NAMED])
    drawn = {g: [] for g in sizes}
    for c in RG.held_out(seed, sizes):
        drawn[c.group].append(c)
    for g, cs in drawn.items():
        streams.append([{"key": f"case|{c.id}", "kind": "case", "case": c.to_json()} for c in cs])
    short = {}
    for g, plan in freeze["controls"]["c2"].items():
        cs = drawn[g]
        base = cs[:plan["base"]]
        if len(base) < plan["base"]:
            short[f"c2|{g}|base"] = {"needed": plan["base"], "available": len(base)}
        div = [c for c in cs if c.divs][:plan["dividend"]] if plan["dividend"] else []
        if len(div) < plan["dividend"]:
            short[f"c2|{g}|dividend"] = {"needed": plan["dividend"], "available": len(div)}
        ids = {c.id for c in base}
        for stage in ("c2_fd", "c2_q"):
            js = [{"key": f"{stage}|{c.id}", "kind": stage, "case": c.to_json(), "quantities": None} for c in base]
            js += [{"key": f"{stage}_div|{c.id}", "kind": stage, "case": c.to_json(), "quantities": [G.DIVIDEND]}
                   for c in div if c.id not in ids]
            streams.append(js)
    for s, plan in freeze["controls"]["e_strata"].items():
        kept = C.e_population(seed, s, plan["proposals"])
        base = kept[:plan["base"]]
        if len(base) < plan["base"]:
            short[f"e|{s}|base"] = {"needed": plan["base"], "available": len(base)}
        div = [c for c in kept if c.divs][:plan["dividend"]] if plan["dividend"] else []
        if len(div) < plan["dividend"]:
            short[f"e|{s}|dividend"] = {"needed": plan["dividend"], "available": len(div)}
        ids = {c.id for c in base}
        js = [{"key": f"e|{c.id}", "kind": "e", "case": c.to_json(), "quantities": None} for c in base]
        js += [{"key": f"e_div|{c.id}", "kind": "e", "case": c.to_json(), "quantities": [G.DIVIDEND]}
               for c in div if c.id not in ids]
        streams.append(js)
    order = []
    for si, js in enumerate(streams):
        for i, j in enumerate(js):
            order.append(((i + 0.5) / len(js), si, i, j))
    order.sort(key=lambda t: t[:3])
    jobs = [t[3] for t in order]
    keys = [j["key"] for j in jobs]
    if len(set(keys)) != len(keys):
        raise RuntimeError("duplicate job keys")
    return jobs, short


def fingerprint(jobs: list[dict]) -> str:
    h = hashlib.sha256()
    for j in jobs:
        h.update(json.dumps([j["key"], case_key(j["case"]), j.get("quantities")]).encode())
    return h.hexdigest()


# ── one job (in a worker) ───────────────────────────────────────────────────

_W: dict = {}


def init_worker(freeze: dict) -> None:
    from tests.fixtures import options_pre_phase3 as frozen
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    over = freeze["config"]
    _W.update(over=over, cfg=run_p3.greek_config(over), xcfg=run_p3.x_config(over), regions=freeze["regions"],
              regions_obj=RG.Regions.from_json(freeze["regions"]), repeat_every=freeze["repeat_every"],
              p21=frozen.load(P21_FILE, P21_BLOB))


def _full(a) -> dict:
    d = dataclasses.asdict(a)
    d.pop("version")
    return canon(d)


def repeat_view(rec: dict) -> dict:
    """What a repeat must reproduce bit for bit: Tier 2's answer, the cross-check, every Greek, the work."""
    xc = rec["cross_check"]
    return canon({"tier2": rec["tier2"], "cross_check": [xc["status"], xc["reason"], xc["v_fd"], xc["e_fd"]],
                  "greeks": {g: [a["status"], a["value"], a["estimate"], a["reason"]] for g, a in rec["greeks"].items()},
                  "units": rec["units_phase3"]})


def _production(c) -> dict:
    """Production alone, from scratch, in the record's own form."""
    reg = _W["regions_obj"]
    p3 = oa.phase3(c, gcfg=_W["cfg"], xcfg=_W["xcfg"], x_region=reg.fd_role_region, g_region=reg.greek_region)
    xc = p3.cross_check
    return {"tier2": golden.answer_json(p3.tier2),
            "cross_check": {"status": xc.status, "reason": xc.reason, "v_fd": xc.v_fd, "e_fd": xc.e_fd},
            "greeks": {g: {"status": a.status, "value": a.value, "estimate": a.estimate, "reason": a.reason}
                       for g, a in p3.greeks.items()}, "units_phase3": p3.units}


def case_job(job: dict) -> dict:
    case = cases.Case.from_json(job["case"])
    c = C.to_ctx(case)
    rec = run_p3.one((job["case"], _W["regions"], True, False, _W["over"]))
    old = _W["p21"].price(c)
    new = oa.price(c)
    p2 = {"answer_json_identical": canon(golden.answer_json(old)) == canon(rec["tier2"]),
          "full_identical": _full(old) == _full(new), "old_version": old.version}
    rec["phase2_rows"] = p2
    idx = 0 if case.kind == "named" else int(case.id.rsplit("/", 1)[1])
    if case.kind == "named" or idx % _W["repeat_every"] == 0:
        rec["repeat_identical"] = repeat_view(_production(c)) == repeat_view(rec)
    return rec


def work(job: dict) -> dict:
    t0, w0 = time.process_time(), time.time()
    out = {"key": job["key"], "kind": job["kind"]}
    try:
        if job["kind"] == "case":
            out["rec"] = case_job(job)
        else:
            c = C.to_ctx(cases.Case.from_json(job["case"]))
            qs = tuple(job["quantities"]) if job.get("quantities") else GR.QUANTITIES
            if job["kind"] == "c2_fd":
                out["c2"] = C.c2_fd(c, _W["cfg"], qs)
            elif job["kind"] == "c2_q":
                out["c2"] = C.c2_q(c, _W["cfg"], qs)
            else:
                out["c2"] = C.c2_lattice(c, _W["cfg"], qs)
                if not job.get("quantities"):
                    out["c1"] = C.c1(c, _W["cfg"])
            out["case"] = job["case"]
    except Exception as e:   # recorded, never dropped: a crash is a result
        out["error"] = f"{type(e).__name__}: {e}"
        out["traceback"] = traceback.format_exc()[-2000:]
        out.setdefault("case", job["case"])
    out["cpu_s"] = time.process_time() - t0
    out["wall_s"] = time.time() - w0
    return out


def job_case(result: dict) -> dict:
    return result["rec"]["case"] if "rec" in result else result["case"]


# ── the CPU meter ───────────────────────────────────────────────────────────

TICK = os.sysconf("SC_CLK_TCK")


def proc_cpu(pid: int) -> float | None:
    """User + system CPU seconds of a live process, or None when it is gone."""
    try:
        s = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    f = s[s.rindex(")") + 2:].split()
    return (int(f[11]) + int(f[12])) / TICK


def prior_cpu(meter: Path, workers: int, sample_s: float) -> tuple[float, list[dict]]:
    """CPU seconds of every earlier session in the meter file, and a summary per session."""
    if not meter.exists():
        return 0.0, []
    sessions: dict = {}
    for line in meter.read_text().splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue                 # a partial last line from a stopped container
        s = sessions.setdefault(r["session"], {"session": r["session"], "cpu_s": 0.0, "wall_s": 0.0, "end": False,
                                               "workers": workers})
        s["cpu_s"], s["wall_s"] = max(s["cpu_s"], r["cpu_s"]), max(s["wall_s"], r["wall_s"])
        if r.get("workers"):
            s["workers"] = r["workers"]
        if r["kind"] == "end":
            s["end"] = True
            s["why"] = r.get("why")
    total = 0.0
    for s in sessions.values():
        s["surcharge_s"] = 0.0 if s["end"] else s["workers"] * sample_s
        total += s["cpu_s"] + s["surcharge_s"]
    return total, list(sessions.values())


class Meter:
    def __init__(self, path: Path, session: str, workers: int):
        self.path, self.session, self.workers = path, session, workers
        self.seen: dict[int, float] = {}
        self.t0 = time.time()
        self.self0 = 0.0             # the parent's CPU from its start: population, preflight, imports

    @staticmethod
    def _self() -> float:
        t = os.times()
        return t.user + t.system

    def _write(self, rec: dict) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps(rec) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def sample(self, pids, kind="sample", why=None) -> float:
        for pid in pids:
            v = proc_cpu(pid)
            if v is not None:
                self.seen[pid] = max(self.seen.get(pid, 0.0), v)
        t = os.times()
        reaped = t.children_user + t.children_system
        cpu = (self._self() - self.self0) + max(sum(self.seen.values()), reaped)
        rec = {"session": self.session, "kind": kind, "utc": utc(), "wall_s": round(time.time() - self.t0, 3),
               "cpu_s": round(cpu, 3), "workers": self.workers}
        if why:
            rec["why"] = why
        self._write(rec)
        return cpu


# ── the run ─────────────────────────────────────────────────────────────────

class Stop(Exception):
    pass


def read_results(path: Path) -> list[dict]:
    """Finished results; a partial last line (a stopped container) is dropped and the file rewritten without it."""
    if not path.exists():
        return []
    good, lines = [], path.read_text().splitlines()
    for i, line in enumerate(lines):
        try:
            good.append(json.loads(line))
        except json.JSONDecodeError:
            if i != len(lines) - 1:
                raise SystemExit(f"{path} has a damaged line {i + 1} that is not the last: refusing")
            path.write_text("".join(x + "\n" for x in lines[:-1]))   # its job runs again
    return good


def git_state() -> dict:
    head = subprocess.run(["git", "-C", str(F.REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(F.REPO), "status", "--porcelain", "--untracked-files=no"],
                           capture_output=True, text=True).stdout.strip()
    return {"head": head, "tracked_changes": dirty}


def preflight(freeze: dict, freeze_path: Path, out: Path, jobs: list[dict]) -> dict:
    """Every refusal before work; the manifest to write (new, or the prior one with this session appended)."""
    bad = F.check_freeze(freeze)
    if bad:
        raise SystemExit("files differ from the freeze: " + ", ".join(bad))
    seed = freeze["held_out"]["seed"]
    if seed in freeze["used_seeds"] or seed in F.USED_SEEDS or seed == F.DEV_SEED:
        raise SystemExit(f"seed {seed} is a registered seed, not a fresh held-out seed")
    gs = git_state()
    if gs["tracked_changes"]:
        raise SystemExit("the checkout has tracked changes: run from an immutable checkout of the freeze")
    man = {"runner": "scripts/options_bench/heldout_p3.py", "freeze": str(freeze_path),
           "freeze_sha256": F.sha(freeze_path), "files_sha256": F.file_hashes(), "git_head": gs["head"],
           "seed": seed, "sizes": freeze["held_out"]["sizes"], "jobs": len(jobs), "population_sha256": fingerprint(jobs),
           "versions": {"tier2": oa.VERSION, "greeks": G.VERSION}, "created_utc": utc(), "sessions": []}
    mp_ = out / MANIFEST
    res = out / RESULTS
    if not mp_.exists() and res.exists() and res.stat().st_size:
        raise SystemExit(f"{res} has results but no manifest: use a new --out")
    if mp_.exists():
        prior = json.loads(mp_.read_text())
        diff = [k for k in ("freeze_sha256", "files_sha256", "git_head", "seed", "sizes", "jobs", "population_sha256")
                if prior.get(k) != json.loads(json.dumps(man[k]))]
        if diff:
            raise SystemExit(f"{out} was started with another freeze, code or population ({', '.join(diff)}): "
                             "use a new --out")
        man = prior
    return man


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--freeze", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--population-only", action="store_true", help="print the population's counts and stop")
    a = ap.parse_args(argv)
    freeze_path = Path(a.freeze)
    freeze = json.loads(freeze_path.read_text())
    out = Path(a.out)
    if a.population_only:
        bad = F.check_freeze(freeze)
        if bad:
            raise SystemExit("files differ from the freeze: " + ", ".join(bad))
    jobs, short = population(freeze)
    if a.population_only:
        from collections import Counter
        print(json.dumps({"jobs": len(jobs), "by_kind": dict(Counter(j["key"].split("|")[0] for j in jobs)),
                          "short": short}, indent=1))
        return 0
    out.mkdir(parents=True, exist_ok=True)
    man = preflight(freeze, freeze_path, out, jobs)
    want = {j["key"]: case_key(j["case"]) for j in jobs}
    prev = read_results(out / RESULTS)
    foreign = [r["key"] for r in prev if want.get(r["key"]) != case_key(job_case(r))]
    if foreign:
        raise SystemExit(f"{len(foreign)} results are not jobs of this population (e.g. {foreign[0]}): use a new --out")
    done = {r["key"] for r in prev}
    if len(done) != len(prev):
        raise SystemExit("duplicate results: refusing")
    cpu = freeze["cpu"]
    workers = int(freeze["workers"])
    cap_s = cpu["cap_hours"] * 3600.0
    stop_s, nosub_s = cap_s - cpu["stop_margin_hours"] * 3600.0, cap_s - cpu["no_submit_margin_hours"] * 3600.0
    prior, sessions = prior_cpu(out / METER, workers, cpu["sample_seconds"])
    session = f"{utc()}-{uuid.uuid4().hex[:8]}"
    man["sessions"].append({"session": session, "started_utc": utc(), "already_done": len(done),
                            "prior_cpu_s": round(prior, 3), "short": short})
    (out / MANIFEST).write_text(json.dumps(man, indent=1))
    todo = [j for j in jobs if j["key"] not in done]
    print(f"{len(jobs)} jobs, {len(done)} done, {len(todo)} to run; prior CPU {prior / 3600:.2f} h of "
          f"{cpu['cap_hours']} h", flush=True)
    if prior >= nosub_s:
        print("CPU cap reached before this session: nothing submitted", flush=True)
        return 3
    meter = Meter(out / METER, session, workers)
    meter.sample([], kind="start")

    def on_term(signum, frame):
        raise Stop("signal %d" % signum)

    signal.signal(signal.SIGTERM, on_term)
    why, code = "finished", 0
    pool = mp.get_context("fork").Pool(workers, initializer=init_worker, initargs=(freeze,))
    inflight: list = []
    nxt = 0
    last = 0.0
    accepting = True
    try:
        with (out / RESULTS).open("a") as f:
            while nxt < len(todo) or inflight:
                now = time.time()
                if now - last >= cpu["sample_seconds"]:
                    used = prior + meter.sample([p.pid for p in pool._pool])
                    last = now
                    if used >= stop_s:
                        why, code = "stopped: CPU cap", 3
                        raise Stop(why)
                    accepting = used < nosub_s
                if nxt < len(todo) and len(inflight) < workers and accepting:
                    inflight.append((time.time(), pool.apply_async(work, (todo[nxt],))))
                    nxt += 1
                    continue
                still = []
                for t_sub, r in inflight:
                    if now - t_sub > HUNG_S:
                        why, code = f"stopped: a job ran {HUNG_S / 3600:.0f} h without returning", 5
                        raise Stop(why)
                    if r.ready():
                        res = r.get()
                        res["session"] = session
                        f.write(json.dumps(res, allow_nan=True, default=jsonable) + "\n")
                        f.flush()
                    else:
                        still.append((t_sub, r))
                if not accepting and not still and nxt < len(todo):
                    why, code = "stopped: CPU cap (no submission within the margin)", 3
                    break
                inflight = still
                time.sleep(0.2)
        pool.close()
        pool.join()
    except Stop as e:
        why = why if code else f"stopped: {e}"
        code = code or 4
        pool.terminate()
        pool.join()
    except BaseException:
        pool.terminate()
        pool.join()
        meter.sample([], kind="end", why="error")
        raise
    used = prior + meter.sample([], kind="end", why=why)
    man = json.loads((out / MANIFEST).read_text())
    man["sessions"][-1].update(ended_utc=utc(), why=why, session_cpu_s=round(used - prior, 3), total_cpu_s=round(used, 3))
    (out / MANIFEST).write_text(json.dumps(man, indent=1))
    print(f"{why}: CPU {used / 3600:.2f} h total, this session {(used - prior) / 3600:.2f} h CPU and "
          f"{(time.time() - meter.t0) / 3600:.2f} h wall", flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
