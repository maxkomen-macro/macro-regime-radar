"""scripts/options_bench/golden.py — builds the frozen baseline golden file (adaptive Phase 2, test tooling).

    python -m scripts.options_bench.golden            # writes tests/fixtures/options_baseline_golden.json
    python -m scripts.options_bench.golden --check    # exits 1 when today's baseline differs from the file

The golden file holds the baseline's served answer (options_engine.baseline, which calls options_finder.Pricer
unchanged) on the named regressions, R-1 and a stratified subset of seed 20261026: every group, and G6 evenly on both
sides of 1,118 days (above it the doubling schedule cannot run under the 40 M cap). Any change to a served baseline number, status, route, delta or work count fails
tests/test_options_engine.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import cases

REPO = Path(__file__).resolve().parent.parent.parent
GOLDEN = REPO / "tests" / "fixtures" / "options_baseline_golden.json"
SEED = 20261026
# 300 cases: 40 from each random lattice group, 20 exempt, 25 near the boundary, 15 outside the domain.
PER_GROUP = {"G0-exempt": 20, "G1-nodiv": 40, "G2-dividends": 40, "G3-carry-itm": 40, "G4-negrate": 40,
             "G5-extreme-vol": 40, "G6-long": 40, "T1-near-boundary": 25, "X1-outside": 15}
G6_BANDS = ((731, 1118), (1119, 1464))   # G6 (731 to 1,464 days) takes half from each side of the doubling limit

# R-1 (Max and Codex, 29 October): a one-day put whose European value sits below intrinsic; Tier 1's bound
# route serves the European value 9.99969863 and must keep doing so.
R1 = cases.Case(id="named/R-1", group="named", kind="named", is_call=False, spot=100.0, strike=110.0, days=1,
                rho=0.001, q=0.0, sigma=0.05, divs=(),
                note="one-day put: European 9.99969863 below intrinsic 10; Tier 1 serves the European value",
                expect="served")


def subset() -> list[cases.Case]:
    out = []
    for g, n in PER_GROUP.items():
        if g == "G6-long":
            per = n // len(G6_BANDS)
            got = {b: [] for b in G6_BANDS}
            i = 0
            while any(len(v) < per for v in got.values()):
                c = cases.case(SEED, g, i)
                for b in G6_BANDS:
                    if b[0] <= c.days <= b[1] and len(got[b]) < per:
                        got[b].append(c)
                i += 1
            out += [c for b in G6_BANDS for c in got[b]]
        else:
            out += [cases.case(SEED, g, i) for i in range(n)]
    return out


def golden_cases() -> list[cases.Case]:
    return list(cases.NAMED) + [R1] + subset()


def answer_json(a) -> dict:
    return {"route": a.route, "price_status": a.price_status, "value": a.value, "delta_status": a.delta_status,
            "delta": a.delta, "reason": a.reason, "delta_reason": a.delta_reason, "units": a.units,
            "model": a.audit.get("model"), "bound": a.audit.get("bound")}


def build() -> dict:
    from src.desk import options_engine as oe
    from src.desk import options_math as om
    rows = []
    for c in golden_cases():
        ctx = om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))
        rows.append({"case": c.to_json(), "answer": answer_json(oe.baseline(ctx))})
    return {"about": "Frozen baseline (Tier 1) answers: options_engine.baseline over options_finder.Pricer. "
                     "Rebuild only with scripts/options_bench/golden.py, and only for an approved baseline change.",
            "seed": SEED, "per_group": PER_GROUP, "g6_bands": [list(b) for b in G6_BANDS], "rows": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    got = build()
    if a.check:
        want = json.loads(GOLDEN.read_text())
        bad = [r["case"]["id"] for r, w in zip(got["rows"], want["rows"]) if r != w]
        if len(got["rows"]) != len(want["rows"]) or bad:
            print("baseline differs from the golden file:", bad[:20] or "row count")
            return 1
        print(f"baseline matches the golden file ({len(want['rows'])} rows)")
        return 0
    head = {k: v for k, v in got.items() if k != "rows"}
    lines = ",\n".join("  " + json.dumps(r, sort_keys=True) for r in got["rows"])   # one row per line, for review
    GOLDEN.write_text(json.dumps(head, indent=1)[:-2] + ',\n "rows": [\n' + lines + "\n ]\n}\n")
    print(f"wrote {GOLDEN} ({len(got['rows'])} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
