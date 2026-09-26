"""scripts/desk_format_fixture.py — Python's own strings for the Desk's number
formatters (desk/frame-2, review R-03).

    python scripts/desk_format_fixture.py            # write the fixture
    python scripts/desk_format_fixture.py --check    # exit 1 if it is stale

The page formats the engine's numbers in TypeScript; the engine formats the
same numbers in Python (`src.desk.event_study.fmt_move`). Python rounds the
double's exact binary value and sends an exact tie to the even digit, so the
two agree only if the page does the same. This writes, for a spread of
doubles (every move, interval bound and baseline in the saved engine payloads,
exact ties, near-ties, negative zero, subnormals, large values), the string
Python prints, to web/src/screens/desk/event-study/__fixtures__/py-format.json.
web/src/screens/desk/pyformat.test.ts checks the TypeScript formatters against
it; tests/test_desk_format_fixture.py fails when the file no longer matches
what this script writes. Reads the engine's formatter; changes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.desk.event_study import fmt_move  # noqa: E402

FIXTURES = ROOT / "web/src/screens/desk/event-study/__fixtures__"
OUT = FIXTURES / "py-format.json"


def _payload_values() -> tuple[list[float], list[float], list[float]]:
    """Every fraction, bp value and share the saved engine payloads carry."""
    studies = json.loads((FIXTURES / "engine-studies.json").read_text())
    pct: list[float] = []
    bp: list[float] = []
    share: list[float] = []
    for name in ("preset", "cross", "bp_target"):
        s = studies[name]
        into = bp if s["study"]["target"]["format"] == "bp" else pct
        for h in s["horizons"]:
            for k in ("median", "mean", "p25", "p75", "baseline_median", "baseline_p25", "baseline_p75", "delta"):
                if h.get(k) is not None:
                    into.append(h[k])
            for b in h.get("ci90") or []:
                into.append(b)
            for k in ("hit_rate", "baseline_hit_rate"):
                if h.get(k) is not None:
                    share.append(h[k])
        for e in s["recent_events"]:
            into.extend(v for v in e["moves"].values() if v is not None)
    return pct, bp, share


def _unique(xs: list[float]) -> list[float]:
    seen: set[str] = set()
    out: list[float] = []
    for x in xs:
        key = repr(x)
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def build() -> dict:
    pct, bp, share = _payload_values()
    # Fractions whose ×100 lands on or beside a one-decimal tie (0.25, 0.75 …).
    pct += [k / 400 for k in range(-40, 41)] + [k / 4000 for k in range(-20, 21)] + [0.0025, -0.0025, 0.00125, -0.0004, 0.0004, -0.0, 0.0, 1e-12, -1e-12]
    # bp ties at whole numbers (2.5 → +2, 3.5 → +4), near-ties and negatives.
    bp += [k / 2 for k in range(-12, 13)] + [0.4999999999999999, -0.4999999999999999, 12.500000000000002, -0.0, 0.0, 33.2, -33.2, 1e-9]
    share += [0.125, 0.375, 0.625, 0.875, 0.005, 0.015, 0.025, 0.5, 0.555, 0.995, 0.0, 1.0] + [k / 18 for k in range(19)]
    fixed_values = [0.125, 0.375, 2.5, 3.5, -2.5, 1.005, 2.675, 0.045, 0.285, 1.0000000000000002, 123456.785, 4523.105, -0.0, 5e-324, 1e22, 0.30000000000000004, 11.644217590049129, 4.12, 99.995]
    return {
        "_comment": "Written by scripts/desk_format_fixture.py from Python's format and the engine's fmt_move; checked by web/src/screens/desk/pyformat.test.ts and tests/test_desk_format_fixture.py. Do not edit by hand.",
        "pct": [[x, fmt_move(x, "log_return")] for x in _unique(pct)],
        "bp": [[x, fmt_move(x, "bp")] for x in _unique(bp)],
        "share": [[x, f"{x * 100:.0f}%"] for x in _unique(share)],
        "fixed": [[x, dp, format(abs(x), f".{dp}f"), format(x, f"+.{dp}f")] for x in _unique(fixed_values) for dp in (0, 1, 2)],
    }


def render() -> str:
    return json.dumps(build(), indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 when the fixture differs from a fresh run")
    args = ap.parse_args()
    text = render()
    if args.check:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print(f"{OUT.relative_to(ROOT)} is stale: run python scripts/desk_format_fixture.py", file=sys.stderr)
            return 1
        print("fixture current")
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
