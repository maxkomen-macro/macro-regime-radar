"""scripts/desk_native_golden.py — the Desk engine's native regression golden (desk/frame-3-api).

docs/desk/FRAME3_API_PLAN.md §2, layer 2. The base engine runs from a full
checkout of <base> (a detached `git worktree add`, with PYTHONPATH on it: the
engine imports src.analytics.dbpath and src.desk.series, so a partial archive
would not import), on the engine suite's synthetic store
(tests/test_event_study._synthetic_db, built by the base checkout's own
builder), with both pins: generation="golden" and as_of="2026-09-24". It
writes tests/fixtures/desk_native_<base>.json, one sha256 of canonical JSON
per query. tests/test_desk_native_regression.py compares HEAD's output, under
the same pins, against it.

    python scripts/desk_native_golden.py --base origin/main

The emitter (`--emit`) is the one piece both sides run: it imports
`src.desk.event_study` from PYTHONPATH (checked against --expect-root) and
prints canonical JSON or its sha256 per query. scripts/desk_native_ab.py runs it
on each side over the published copy (layer 3).

Read-only on every store it is given; it writes only the fixture (and the
synthetic store in a temporary directory).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PINS = {"generation": "golden", "as_of": "2026-09-24"}

# The three presets and the catalog's ten other engine queries (DESK_FRAME3_SPEC §12.3's
# "engine query" column). The wti and dxy rows are tier 2: on a store without them they are a
# typed refusal, recorded as such.
PRESETS = ("gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross")
CATALOG = (
    "vix-w5-z2.0-up-none-spx", "hy_oas-w20-z2.0-up-none-spx", "us10y-w20-z2.0-up-none-spx",
    "dxy-w20-z2.0-down-none-spx", "wti-w20-z2.0-up-none-gold", "spx-w20-z2.0-down-none-us10y",
    "spx-w20-z2.0-up-none-spx", "spx-w5-z2.0-up-none-spx", "curve_2s10s-w20-z2.0-up-none-spx",
    "wti-w20-z2.0-up-none-spx",
)
# docs/desk/FRAME3_DATA_AUDIT.md's other studies (the condition dropped; "either way").
AUDIT = ("gold-w20-z2.0-up-none-spx", "spx-w5-z2.0-abs-none-spx", "spx-w20-z2.0-abs-none-spx")


def _freeform() -> list[dict]:
    """The free-form queries tests/test_event_study.py runs on the synthetic store, as Query kwargs."""
    q = [
        dict(shock="us10y", w=5, z=1.5, sign="both", target="spx"),
        dict(shock="vix", w=5, z=1.5, sign="both", target="spx"),
        dict(shock="gold", w=5, z=1.5, sign="both", target="spx"),
        dict(shock="gold", w=20, z=1.5, sign="both", target="spx"),
        dict(shock="spx", w=5, z=1.5, sign="both", target="us10y"),
        dict(shock="spx", w=5, z=1.5, sign="both", target="vix"),
        dict(shock="us10y", w=5, z=1.5, sign="both", cond="hy_oas_20d_change_above", cond_value=0, target="spx"),
        dict(shock="us10y", w=20, z=2.0, sign="+", cond="regime", cond_value="Overheating", target="spx"),
        dict(shock="us10y", w=20, z=2.0, sign="+", target="spx", regime="Overheating"),
        dict(shock="spx", w=20, z=1.5, sign="both", target="vix"),
        dict(shock="us10y", w=20, z=1.5, sign="both", target="spx"),
        dict(shock="spx", w=20, z=1.5, sign="both", target="gold"),
        dict(shock="spx", w=20, z=1.5, sign="both", cond="vix_above", cond_value=10, target="spx"),
        dict(shock="us10y", w=5, z=2.5, sign="+", cond="vix_above", cond_value=1000.0, target="spx"),  # zero events
        dict(shock="gold", w=5, z=2.5, sign="-", target="us10y"),
        dict(shock="us10y", w=5, z=1.5, sign="-", cond="vix_above", cond_value=25, target="gold", regime="Stagflation"),
        dict(shock="vix", w=60, z=2.5, sign="both", cond="regime", cond_value="Recession Risk", target="hy_oas"),
        dict(shock="curve_2s10s", w=20, z=2.0, sign="+", cond="hy_oas_20d_change_above", cond_value=-50.0, target="us10y"),
        dict(shock="gold", w=20, z=2.0, sign="+", cond="vix_above", cond_value=0.1, target="spx"),
        dict(kind="cross", cross="death", target="spx", regime="Overheating"),
    ]
    q += [dict(shock=s, w=w, z=1.5, sign=sg, target=t)
          for s in ("gold", "vix", "us10y") for w in (5, 60) for sg in ("+", "-") for t in ("spx", "gold")]
    return q


def queries(kind: str) -> list[dict]:
    """Query specs: {"slug": …} for a named or slugged study, {"kwargs": …} for a free-form one."""
    if kind == "golden":
        return [{"slug": s} for s in PRESETS + CATALOG] + [{"kwargs": k} for k in _freeform()]
    if kind == "ab":
        return [{"slug": s} for s in PRESETS + CATALOG + AUDIT]
    raise ValueError(kind)


# ── the emitter: runs under whichever engine PYTHONPATH names ───────────────

def _emit(store: str, kind: str, expect_root: str, full_dir: str | None) -> None:
    from src.desk import event_study as es

    here = Path(es.__file__).resolve()
    if not str(here).startswith(str(Path(expect_root).resolve()) + os.sep):
        raise SystemExit(f"the engine came from {here}, not from {expect_root}")
    conn = es._connect(store)
    out: list[list[str]] = []  # [name, sha256] in query order
    try:
        for spec in queries(kind):
            if "slug" in spec:
                q = es.parse_slug(spec["slug"])
            else:
                q = es.Query(**spec["kwargs"])
            name = es.slug_for(es.validate(q))
            try:
                r = es.run_on(conn, q, generation=PINS["generation"], as_of=PINS["as_of"])
                text = json.dumps(r, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            except es.NotStored as exc:
                text = f"NotStored:{exc.series}"
            except es.StudyError as exc:
                text = f"StudyError:{exc}"
            out.append([name, hashlib.sha256(text.encode("utf-8")).hexdigest()])
            if full_dir:
                (Path(full_dir) / f"{name}.json").write_text(text)
    finally:
        conn.close()
    names = [n for n, _ in out]
    if len(set(names)) != len(names):
        raise SystemExit(f"duplicate study names: {sorted(n for n in names if names.count(n) > 1)}")
    print(json.dumps({"engine": str(here), "shas": out}))


def _build_store(path: str, expect_root: str) -> None:
    from tests.test_event_study import _synthetic_db

    import tests.test_event_study as t

    if not str(Path(t.__file__).resolve()).startswith(str(Path(expect_root).resolve()) + os.sep):
        raise SystemExit(f"the builder came from {t.__file__}, not from {expect_root}")
    _synthetic_db(Path(path))


# ── the driver ──────────────────────────────────────────────────────────────

def run_side(root: Path, *args: str) -> dict:
    """This script's emitter under the engine of `root` (PYTHONPATH on it, nothing else)."""
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"} | {"PYTHONPATH": str(root)}
    proc = subprocess.run([sys.executable, str(Path(__file__).resolve()), *args, "--expect-root", str(root)],
                          cwd=root, env=env, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise SystemExit(f"{root}: {proc.stderr[-3000:]}")
    lines = [ln for ln in proc.stdout.splitlines() if ln.startswith("{")]
    return json.loads(lines[-1]) if lines else {}


class BaseCheckout:
    """A detached full checkout of `ref`, removed on exit."""

    def __init__(self, ref: str) -> None:
        self.sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", ref], capture_output=True, text=True,
                                  check=True).stdout.strip()
        self.path = Path(tempfile.mkdtemp(prefix="desk-base-")) / "tree"

    def __enter__(self) -> "BaseCheckout":
        subprocess.run(["git", "-C", str(ROOT), "worktree", "add", "--detach", str(self.path), self.sha],
                       capture_output=True, text=True, check=True)
        return self

    def __exit__(self, *exc) -> None:
        subprocess.run(["git", "-C", str(ROOT), "worktree", "remove", "--force", str(self.path)],
                       capture_output=True, text=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", help="the ref whose engine the golden records (e.g. origin/main)")
    ap.add_argument("--emit", help="(internal) the store to run the queries on")
    ap.add_argument("--build", help="(internal) build the synthetic store at this path")
    ap.add_argument("--kind", default="golden", choices=("golden", "ab"))
    ap.add_argument("--expect-root", help="(internal) the checkout the engine must come from")
    ap.add_argument("--full-dir", help="(internal) also write each query's canonical JSON here")
    a = ap.parse_args()
    if a.build:
        return _build_store(a.build, a.expect_root)
    if a.emit:
        return _emit(a.emit, a.kind, a.expect_root, a.full_dir)
    if not a.base:
        ap.error("--base is required")
    with BaseCheckout(a.base) as base, tempfile.TemporaryDirectory() as tmp:
        store = str(Path(tmp) / "synth.db")
        run_side(base.path, "--build", store)
        side = run_side(base.path, "--emit", store, "--kind", "golden")
        specs = {name: {**spec, "sha256": sha} for spec, (name, sha) in zip(queries("golden"), side["shas"], strict=True)}
        fixture = {
            "base": base.sha,
            "pins": PINS,
            "store": "tests/test_event_study._synthetic_db(seed=3), built by the base checkout",
            "method": "sha256 of json.dumps(run_on(conn, q, **pins), sort_keys=True, separators=(',', ':'), "
                      "ensure_ascii=False); a refusal is 'NotStored:<series>' or 'StudyError:<message>'",
            "queries": specs,
        }
        out = ROOT / "tests" / "fixtures" / f"desk_native_{base.sha[:7]}.json"
        out.write_text(json.dumps(fixture, indent=1, sort_keys=True) + "\n")
        print(f"wrote {out.relative_to(ROOT)}: {len(specs)} queries at {base.sha[:7]}")


if __name__ == "__main__":
    main()
