"""scripts/options_bench/phase4a/runner.py — run the registered development population under the four configurations.

    python -m scripts.options_bench.phase4a.runner --start 0 --n 24 --out <file.jsonl> [--configs A,B,C,D]

docs/desk/OPTIONS_PHASE4A.md, sections 4 and 5. Each request runs under each configuration twice: under the serving
budget (300 M, unchanged) and offline (no limit: the work a scan needs to finish, never a serving figure). One JSON
line per (request, configuration, limit). Reads only the development seed; the reserved seed is never generated.

The CPU guard (section 5): every request runs in its own child process under RLIMIT_CPU; the parent reads the
ledger (cpu.json) before each request, starts it only when the ledger's total, the forecast and the reserve fit the
allowance, and adds the child's CPU (user + system, from getrusage) when it ends. A child killed at its limit is
recorded "incomplete: CPU limit"; a request not started is recorded "stopped: CPU allowance". Nothing is re-run.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from src.desk import options_finder as of

from . import bench, eligibility, population as pop

OFFLINE = 10 ** 13
LIMITS = {"budget": of.WORK_LIMIT, "offline": OFFLINE}
LEDGER = Path(__file__).with_name("cpu.json")
ALLOWANCE_S = 10 * 3600
RESERVE_S = 0.25 * 3600
FIRST_FORECAST_S = 0.25 * 3600
PER_REQUEST_MAX_S = 0.5 * 3600
FORECAST_MIN_SAMPLES = 5


# ── one request (in the child) ──

def capture_wrappers(captured: dict, trace: eligibility.Trace) -> dict:
    """Record each lens's top 20 and every candidate's fate (eligibility.py) as run() computes them; changes
    nothing."""
    def lens_order(fn):
        def inner(rows, lens, view):
            got = fn(rows, lens, view)
            captured.setdefault("lens_order", {})[lens] = [r["contract"] for r in got[: of.LENS_TOP]]
            return got
        return inner

    return {"lens_order": lens_order, **trace.wrappers()}


def _compact(res: dict, captured: dict, trace: eligibility.Trace, req) -> dict:
    a = res["answer"]
    out = {k: res[k] for k in ("config", "limit", "outcome", "error", "units", "cpu_s", "wall_s", "sites")}
    out["iv"] = trace.iv
    out["lens_order"] = captured.get("lens_order")
    p = res["pricer"]
    out["rf"] = p.rf
    out["solves"] = p.solves
    out["t2_answers"] = len(p.t2_answer)
    if a is None:
        return out
    out["eligibility"] = eligibility.fates(trace, req, a)
    out["picks"] = a["picks"]
    out["universe"] = {k: a["universe"][k] for k in ("seen", "passed", "dropped", "ranked_out") if k in a["universe"]}
    out["carry"] = [{k: c.get(k) for k in ("exp", "forward", "q", "pairs", "source")} for c in a["carry"]]
    out["rows"] = {r["contract"]: {"iv": r["iv"], "delta": r["delta"], "pnl": r["pnl"], "n": r["n"], "cost": r["cost"],
                                   "be": r["breakeven_on_date"], "be_note": r["breakeven_on_date_note"],
                                   "model": r["model"], "european": r["european_value"]} for r in a["rows"]}
    # Tier 2's stated errors on the contexts of every row that reached a lens's top 20 (the ranking trace reads them)
    top = {(r["type"] == "call", float(r["strike"])) for r in a["rows"]
           if any(r["contract"] in v for v in (captured.get("lens_order") or {}).values())}
    out["t2_errors"] = [
        {"call": c.is_call, "strike": c.strike, "days": c.days, "sigma": c.sigma, "spot": c.spot, "value": ans.value,
         "estimate": ans.estimate, "route": ans.route, "status": ans.price_status}
        for c, ans in p.t2_answer.items() if (c.is_call, float(c.strike)) in top]
    return out


def run_request(i: int, configs: list[str], limits: list[str]):
    """One record per (configuration, limit), yielded as each finishes, so a later one's failure or CPU limit never
    loses an earlier one's measurement."""
    t0 = time.process_time()
    req = pop.request(pop.DEV_SEED, i)
    gen_cpu = time.process_time() - t0
    for cfg in configs:
        for lim in limits:
            captured: dict = {}
            trace = eligibility.Trace()
            res = bench.run_one(req, cfg, LIMITS[lim], wrappers=capture_wrappers(captured, trace))
            yield _compact(res, captured, trace, req) | {"index": i, "limit_name": lim, "params": req.params,
                                                         "gen_cpu_s": gen_cpu}


# ── the ledger and the guard (in the parent) ──

def read_ledger(path: Path = LEDGER) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"allowance_s": ALLOWANCE_S, "reserve_s": RESERVE_S, "entries": [], "total_s": 0.0}


def write_ledger(led: dict, path: Path = LEDGER) -> None:
    led["total_s"] = round(sum(e["cpu_s"] for e in led["entries"]), 3)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(led, indent=1) + "\n")
    os.replace(tmp, path)


def forecast_s(led: dict) -> float:
    per = sorted(e["cpu_s"] for e in led["entries"] if e.get("kind") == "request")
    if len(per) < FORECAST_MIN_SAMPLES:
        return FIRST_FORECAST_S
    p95 = per[min(len(per) - 1, int(round(0.95 * (len(per) - 1))))]
    return 1.5 * p95


def _children_cpu() -> float:
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


def _whole(line: str) -> bool:
    try:
        json.loads(line)
        return True
    except ValueError:
        return False


def guarded(start: int, n: int, configs: list[str], limits: list[str], out: Path, ledger: Path = LEDGER,
            allowance_s: float = ALLOWANCE_S) -> int:
    with out.open("a") as f:
        for i in range(start, start + n):
            led = read_ledger(ledger)
            left = allowance_s - led["total_s"] - RESERVE_S
            fc = forecast_s(led)
            if fc > left:
                for j in range(i, start + n):
                    f.write(json.dumps({"index": j, "outcome": "stopped: CPU allowance", "ledger_s": led["total_s"],
                                        "forecast_s": fc}) + "\n")
                f.flush()
                print(f"stopped before request {i}: ledger {led['total_s']:.0f} s, forecast {fc:.0f} s", file=sys.stderr)
                return 3
            limit = int(min(PER_REQUEST_MAX_S, left))
            with tempfile.NamedTemporaryFile("r", suffix=".jsonl", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            before = _children_cpu()
            proc = subprocess.run(
                [sys.executable, "-m", "scripts.options_bench.phase4a.runner", "--child", str(i),
                 "--configs", ",".join(configs), "--limits", ",".join(limits), "--out", str(tmp_path)],
                preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_CPU, (limit, limit + 5)),
                cwd=Path(__file__).resolve().parents[3])
            used = _children_cpu() - before
            led["entries"].append({"kind": "request", "index": i, "cpu_s": round(used, 3), "rc": proc.returncode,
                                   "limit_s": limit, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            write_ledger(led, ledger)
            lines = tmp_path.read_text().splitlines() if tmp_path.exists() else []
            tmp_path.unlink(missing_ok=True)
            done = []
            for line in lines:   # every completed (configuration, limit) is kept, whatever happened after it
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue      # a line cut off by the kill
                done.append((rec.get("config"), rec.get("limit_name")))
                f.write(line + "\n")
            if proc.returncode != 0:
                killed = proc.returncode in (-signal.SIGXCPU, -signal.SIGKILL)
                todo = [(c, l) for c in configs for l in limits if (c, l) not in done]
                done_cpu = sum(float(json.loads(x).get("cpu_s") or 0) for x in lines if _whole(x))
                for c, l in todo[:1]:
                    # the child's CPU is metered for the whole request; the interrupted run's own share is not
                    # measured, so it is never reported as that configuration's CPU (B-3)
                    f.write(json.dumps({"index": i, "config": c, "limit_name": l,
                                        "outcome": "incomplete: CPU limit" if killed else "failed: child",
                                        "rc": proc.returncode, "cpu_s": None, "request_cpu_s": round(used, 3),
                                        "completed_cpu_s": round(done_cpu, 3),
                                        "cpu_note": "request_cpu_s includes generation, start-up and the completed "
                                                    "configurations; the interrupted one's own CPU is not measured"})
                            + "\n")
                for c, l in todo[1:]:
                    f.write(json.dumps({"index": i, "config": c, "limit_name": l, "outcome": "not run: earlier "
                                        "configuration interrupted", "rc": proc.returncode}) + "\n")
            f.flush()
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--n", type=int)
    ap.add_argument("--child", type=int, help="internal: run one request in this process")
    ap.add_argument("--configs", default="A,B,C,D")
    ap.add_argument("--limits", default="budget,offline")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    configs, limits = args.configs.split(","), args.limits.split(",")
    if args.child is not None:
        with args.out.open("a") as f:
            for rec in run_request(args.child, configs, limits):
                f.write(json.dumps(rec, default=str) + "\n")
                f.flush()
        return 0
    if args.n is None:
        ap.error("--n is required")
    return guarded(args.start, args.n, configs, limits, args.out)


if __name__ == "__main__":
    sys.exit(main())
