"""scripts/options_bench/tier2_golden.py — the frozen Tier 2 answers that the Finder's accuracy check serves.

Tier 2 (src/desk/options_adaptive.price) under the configuration frozen for Phase 2's acceptance evaluation
(src/desk/options_check.FROZEN, equal to calibration/phase2-freeze-2.json's), over the baseline golden file's contexts
(the named regressions, R-1 and the 300-case stratified subset). The file was written from the evaluated revision
ef7d784's own code and checked bit-identical to main's at the time it was added, so a later change that moves a
Tier 2 number fails tests/test_options_check.py. Rebuild only for an approved Tier 2 change, never to make a test pass.

    python -m scripts.options_bench.tier2_golden [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.options_bench import golden

GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "options_tier2_golden.json"
ABOUT = ("Frozen Tier 2 answers: options_adaptive.price under options_check.FROZEN (Phase 2 attempt 2's configuration) "
         "over the baseline golden file's contexts. Written from revision ef7d784's code (adaptive-p2.1, the evaluated "
         "revision) and bit-identical to main's when added. Rebuild only with scripts/options_bench/tier2_golden.py, "
         "and only for an approved Tier 2 change.")


def answer_json(a) -> dict:
    return {"route": a.route, "price_status": a.price_status, "value": a.value, "estimate": a.estimate,
            "reason": a.reason, "delta_status": a.delta_status, "delta": a.delta, "delta_estimate": a.delta_estimate,
            "delta_reason": a.delta_reason, "units": a.units}


def build() -> dict:
    from src.desk import options_adaptive as oa
    from src.desk import options_check as ock
    from src.desk import options_math as om
    rows = []
    for c in golden.golden_cases():
        ctx = om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))
        rows.append({"id": c.id, "answer": answer_json(oa.price(ctx, ock.FROZEN))})
    return {"about": ABOUT, "engine_version": "adaptive-p2.1", "evaluated_revision": "ef7d784", "rows": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    got = build()
    if a.check:
        want = json.loads(GOLDEN.read_text())
        bad = [r["id"] for r, w in zip(got["rows"], want["rows"]) if r != w]
        if len(got["rows"]) != len(want["rows"]) or bad:
            print("Tier 2 differs from the golden file:", bad[:20] or "row count")
            return 1
        print(f"Tier 2 matches the golden file ({len(want['rows'])} rows)")
        return 0
    head = {k: v for k, v in got.items() if k != "rows"}
    lines = ",\n".join("  " + json.dumps(r, sort_keys=True) for r in got["rows"])   # one row per line, for review
    GOLDEN.write_text(json.dumps(head, indent=1)[:-2] + ',\n "rows": [\n' + lines + "\n ]\n}\n")
    print(f"wrote {GOLDEN} ({len(got['rows'])} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
