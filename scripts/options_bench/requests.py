"""scripts/options_bench/requests.py — request-level work and time of the Options Finder (dividend fix, D-3).

    python -m scripts.options_bench.requests --engine-root <checkout> --out <file.jsonl>
    python -m scripts.options_bench.requests --compare before.jsonl after.jsonl

Runs a fixed matrix of whole Finder requests (options_finder.run, the route the API serves) on invented chains
from tests/options_synth.py: the monthly $100 chain with quarterly dividends, the same chain with a 6% dividend
yield, and the AAPL-like weekly chain; both views; scan windows of 1, 3, 6 and 12 months. Each request runs with
no work cap so its full charge is measured, then the charge is read against options_finder.WORK_LIMIT (300 M
units): a request above it is one the Finder refuses with "Too much to price at once". Work units are
deterministic; seconds depend on the machine and its load, so compare them only between runs on the same idle
machine. The chains are priced once with the repository's own engine (they are data); the engine under test is
imported from --engine-root (scripts/options_bench/engine.py's loader), so before and after use the same quotes.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import date
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from tests import options_synth as syn  # noqa: E402  (invented chains; no provider data)

from . import engine  # noqa: E402

HI_DIV_ROWS = [dict(r, amount=1.50) for r in syn.DIV_ROWS]   # $1.50 a quarter on $100: a 6% yield
MONTHS = (1, 3, 6, 12)
BY = {"syn": date(2026, 11, 20), "hidiv": date(2026, 11, 20), "big": date(2026, 12, 18)}
TARGET = {("syn", "up"): 115.0, ("syn", "down"): 88.0, ("hidiv", "up"): 115.0, ("hidiv", "down"): 88.0,
          ("big", "up"): 290.0, ("big", "down"): 215.0}


@lru_cache(maxsize=None)
def chain(name: str) -> tuple[tuple[dict, ...], float, list[dict]]:
    """(rows, spot, dividend rows) of an invented chain."""
    if name == "syn":
        return syn.chain()[0], syn.S0, syn.DIV_ROWS
    if name == "hidiv":
        strikes = [60.0 + 2.5 * i for i in range(41)]
        rows, _ = syn.build(syn.S0, 0.0, HI_DIV_ROWS, syn.EXPIRIES, strikes, "HID")
        return tuple(rows), syn.S0, HI_DIV_ROWS
    if name == "big":
        return syn.big_chain(), syn.BIG_S0, syn.BIG_DIV_ROWS
    raise ValueError(name)


def matrix() -> list[dict]:
    return [{"chain": c, "view": v, "months": m} for c in ("syn", "hidiv", "big") for v in ("up", "down") for m in MONTHS]


def one(of, req: dict) -> dict:
    rows, spot, divs = chain(req["chain"])
    view, kind = req["view"], "call" if req["view"] == "up" else "put"
    t = of.Thesis(view, TARGET[(req["chain"], view)], BY[req["chain"]], 5000.0, scan_months=req["months"],
                  commission=0.65)
    win = of.window(t, spot)
    lo, hi = win["_bounds"]
    cands = [dict(r) for r in rows if r["type"] == kind and t.by.isoformat() <= r["exp_date"] <= win["exp_to"]
             and lo <= of._dec(r["strike"]) <= hi]
    others = [dict(r) for r in rows if r["type"] != kind and t.by.isoformat() <= r["exp_date"] <= win["exp_to"]
              and 0.8 * spot <= r["strike"] <= 1.2 * spot]
    root = {"syn": "SYN", "hidiv": "HID", "big": "AAPL"}[req["chain"]]
    m = of.Market(syn.SESSION, spot, syn.CURVE_ROWS, syn.CLOSES, syn.CAL_THROUGH, syn.SESSION, 0, root)
    t0 = time.perf_counter()
    try:
        a = of.run(cands, t, m, other_rows=others, dividends={"status": "ok", "rows": divs}, work_limit=10**15)
    except of.FinderError as e:
        return req | {"error": str(e), "secs": time.perf_counter() - t0}
    secs = time.perf_counter() - t0
    used = a["work"]["used"]
    return req | {"candidates": len(cands), "rows": len(a.get("rows") or []), "units": used,
                  "over_cap": used > of.WORK_LIMIT, "cap": of.WORK_LIMIT, "secs": secs}


def measure(engine_root: str, out: Path) -> list[dict]:
    _om, of = engine.load(engine_root)
    res = []
    with out.open("w") as f:
        for req in matrix():
            r = one(of, req) | {"engine": engine.describe(engine_root)}
            res.append(r)
            f.write(json.dumps(r) + "\n")
            f.flush()
    return res


def compare(a_path: Path, b_path: Path) -> str:
    a = {(r["chain"], r["view"], r["months"]): r for r in map(json.loads, a_path.read_text().splitlines())}
    b = {(r["chain"], r["view"], r["months"]): r for r in map(json.loads, b_path.read_text().splitlines())}
    L = ["| chain | view | months | units before | units after | ratio | over 300 M before / after | secs before | secs after |",
         "|---|---|---|---|---|---|---|---|---|"]
    for k in a:
        x, y = a[k], b.get(k, {})
        if "units" not in x or "units" not in y:
            L.append(f"| {k[0]} | {k[1]} | {k[2]} | {x.get('error', x.get('units'))} | {y.get('error', y.get('units'))} | | | | |")
            continue
        ratio = y["units"] / x["units"] if x["units"] else math.nan
        L.append(f"| {k[0]} | {k[1]} | {k[2]} | {x['units'] / 1e6:.1f} M | {y['units'] / 1e6:.1f} M | {ratio:.2f} | "
                 f"{'yes' if x['over_cap'] else 'no'} / {'yes' if y['over_cap'] else 'no'} | {x['secs']:.1f} | {y['secs']:.1f} |")
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--engine-root", default=str(REPO))
    ap.add_argument("--out", type=Path)
    ap.add_argument("--compare", nargs=2, type=Path)
    args = ap.parse_args(argv)
    if args.compare:
        print(compare(*args.compare))
        return 0
    if not args.out:
        ap.error("--out is required to measure")
    for r in measure(args.engine_root, args.out):
        print(json.dumps({k: r[k] for k in r if k != "engine"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
