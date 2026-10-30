"""scripts/options_bench/routine.py — the routine Phase 2 subset, run on every push (test tooling).

    python -m scripts.options_bench.routine --out DIR [--freeze FREEZE] [--workers 4]

About 300 development cases (seed 20261026: the named regressions and golden.PER_GROUP from each group, the
golden file's strata) go through the standard reference run (run.py, without QuantLib), then phase2.py twice
into two directories, every case repeated from scratch in the first. The second pass must reproduce the first
bit for bit, and score2 writes the subset's scorecard. It is a smoke and determinism check on development data,
never evidence for the gate: the subset is too small for the sample rows, and it is not held out.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from . import golden, phase2, run, score, score2

FREEZE = phase2.BENCH_DIR / "calibration" / "phase2-freeze.json"


def _records(d: Path) -> dict:
    out = {}
    for p in sorted(d.glob("results-*.jsonl")):
        for r in score.read_results(p)[0]:
            r = {k: v for k, v in r.items() if k not in ("tier2_secs",)}
            r.pop("repeat_identical", None)
            if "r1" in r:   # wall time is not a result
                r["r1"] = {k: v for k, v in r["r1"].items() if k != "secs"}
            out[r["case"]["id"]] = r
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--freeze", default=str(FREEZE))
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    args = ap.parse_args(argv)
    out = Path(args.out)
    sizes = ",".join(f"{g}={n}" for g, n in golden.PER_GROUP.items())
    run.main(["--engine-root", str(phase2.REPO), "--out", str(out / "refs"), "--seed", str(golden.SEED),
              "--per-group", sizes, "--workers", str(args.workers), "--no-quantlib"])
    common = ["--refs", str(out / "refs"), "--freeze", args.freeze, "--workers", str(args.workers)]
    phase2.main(common + ["--out", str(out / "p2-a"), "--repeat-every", "1"])
    phase2.main(common + ["--out", str(out / "p2-b"), "--repeat-every", "0"])
    a, b = _records(out / "p2-a"), _records(out / "p2-b")
    differs = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    sc = score2.score_dirs([out / "p2-a"])
    (out / "p2-a" / "scorecard2.json").write_text(json.dumps(sc, indent=1, default=str))
    (out / "p2-a" / "scorecard2.md").write_text(score2.markdown(sc))
    summary = {"cases": len(a), "second_pass_differs": differs[:20], "second_pass_differs_count": len(differs),
               "repeat_differs": sc["gate"]["components"]["run"]["repeat_differs"],
               "crashes": sc["gate"]["components"]["run"]["crashes"],
               "rows": {k: c["verdict"] for k, c in sc["gate"]["components"].items()}}
    (out / "routine.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    ok = not differs and not summary["repeat_differs"] and not summary["crashes"]
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
