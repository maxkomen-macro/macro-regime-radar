"""scripts/desk_native_ab.py — layer 3 of the Desk engine's native regression (desk/frame-3-api).

docs/desk/FRAME3_API_PLAN.md §2. Runs the base engine (a detached full checkout
of --base, PYTHONPATH on it) and HEAD's engine (this tree) in two subprocesses
on one byte copy of --db, with the same pins (generation "golden", as-of
2026-09-24), over every catalog study, every preset and the audit's studies,
and compares the canonical JSON. It prints "byte-identical: N/N"; any
difference is a blocking finding (A-18), shown as its first differing path,
and the exit status is 1.

    python scripts/desk_native_ab.py --base origin/main --db data/macro_radar.db

The store is never opened for writing: both sides read the one temporary copy.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import desk_native_golden as golden  # noqa: E402


def _first_difference(a, b, path: str = "") -> str:
    if type(a) is not type(b):
        return f"{path or '/'}: {type(a).__name__} vs {type(b).__name__}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{path}/{k}: only on {'head' if k not in a else 'base'}"
            if a[k] != b[k]:
                return _first_difference(a[k], b[k], f"{path}/{k}")
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: {len(a)} vs {len(b)} items"
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return _first_difference(x, y, f"{path}[{i}]")
    return f"{path or '/'}: {str(a)[:120]!r} vs {str(b)[:120]!r}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", required=True, help="the ref whose engine is compared (e.g. origin/main)")
    ap.add_argument("--db", required=True, help="the store both engines read (a byte copy is used)")
    a = ap.parse_args()
    with golden.BaseCheckout(a.base) as base, tempfile.TemporaryDirectory() as tmp:
        store = Path(tmp) / "store.db"
        shutil.copyfile(a.db, store)
        dirs = {side: Path(tmp) / side for side in ("base", "head")}
        for d in dirs.values():
            d.mkdir()
        runs = {
            "base": golden.run_side(base.path, "--emit", str(store), "--kind", "ab", "--full-dir", str(dirs["base"])),
            "head": golden.run_side(golden.ROOT, "--emit", str(store), "--kind", "ab", "--full-dir", str(dirs["head"])),
        }
        base_shas, head_shas = (dict(runs[s]["shas"]) for s in ("base", "head"))
        names = list(dict(runs["base"]["shas"]))
        same = [n for n in names if base_shas.get(n) == head_shas.get(n)]
        print(f"base {base.sha[:7]} ({runs['base']['engine']}) vs head ({runs['head']['engine']}), pins {golden.PINS}")
        for n in names:
            b_text = (dirs["base"] / f"{n}.json").read_text()
            state = "identical" if n in same else "DIFFERS"
            kind = "refusal " + b_text.split(":")[0] if not b_text.startswith("{") else f"{len(b_text):,} bytes"
            print(f"  {state:9s} {n} ({kind})")
            if n not in same:
                h_text = (dirs["head"] / f"{n}.json").read_text()
                try:
                    print("            first difference:", _first_difference(json.loads(b_text), json.loads(h_text)))
                except json.JSONDecodeError:
                    print(f"            {b_text[:120]!r} vs {h_text[:120]!r}")
        print(f"byte-identical: {len(same)}/{len(names)}")
        return 0 if len(same) == len(names) else 1


if __name__ == "__main__":
    sys.exit(main())
