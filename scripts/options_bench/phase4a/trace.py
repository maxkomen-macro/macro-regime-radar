"""scripts/options_bench/phase4a/trace.py — trace each ranking change against configuration A (section 4).

    python -m scripts.options_bench.phase4a.trace <run.jsonl> [--limit offline]

Prices nothing. Repricing at common inputs comes from the four configurations themselves: the root-finding sites
alone decide a row's inputs (its implied volatility and its expiry's carry), so configuration C is Tier 1's
valuation at Tier 2's inputs, and D shares C's inputs. Per row present in both, for X against A:
- input effect: C − A for C and D (zero for B);
- valuation effect: D − C for D, B − A for B (zero for C).
Allowances, on the P&L the lens ranks (100·n per unit of value): a Tier 1 value's tolerance tol(V); a Tier 2 value's
stated error plus tol(V); the inputs' stated error δσ·vega (the European vega at the on-date context; a local
approximation). A carry change carries no stated error (DR-03 is unresolved): a change resting on one is
"involves carry (conditioning not established)", never explained or unexplained by carry.

Each changed pick or top-20 member is assigned the first that applies: removed or added (with the candidate's fate in
the configuration it is missing from), tie, explained by valuation, explained by inputs, explained by both,
involves carry, or unexplained (listed with its contexts for the reference repricing).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from src.desk import options_finder as of
from src.desk import options_math as om

from .analyze import load
from .population import SESSION
from .rootfinding import _vega_eu

METRIC = of.METRICS
T2_VALUE = {"B", "D"}
T2_INPUTS = {"C", "D"}
OCC = re.compile(r"(\d{6})([CP])(\d{8})$")


def expiry_of(contract: str) -> str | None:
    m = OCC.search(contract)
    if not m:
        return None
    d = m.group(1)
    return f"20{d[:2]}-{d[2:4]}-{d[4:]}"


def ctx_of(d: dict) -> om.Context:
    return om.Context(d["call"], d["spot"], d["strike"], d["days"], d["rho"], d["q"], d["sigma"],
                      tuple(tuple(x) for x in d["divs"]))


class Run:
    """One configuration's answered record, with the per-row quantities the trace reads."""

    def __init__(self, rec: dict) -> None:
        self.rec = rec
        self.cfg = rec["config"]
        self.rows = rec.get("rows") or {}
        self.ctx = rec.get("row_contexts") or {}
        self.fate = (rec.get("eligibility") or {}).get("fate") or {}
        self.top = rec.get("lens_order") or {}
        self.picks = rec.get("picks") or {}
        self.carry = {c["exp"]: c for c in rec.get("carry") or []}
        self.dsig = defaultdict(list)
        for x in rec.get("rf") or []:
            if x.get("site") == "iv" and x.get("d_sigma") is not None:
                self.dsig[(x["call"], float(x["strike"]), int(x["days"]))].append((x["sigma"], x["d_sigma"]))

    def metric(self, c: str, lens: str) -> float | None:
        r = self.rows.get(c)
        return None if r is None else float(r["pnl"][METRIC[lens]])

    def time_ok(self, c: str) -> bool | None:
        """Whether the time lens's cost filter keeps the row: the recorded flag (the unrounded P&L), else from the
        P&L rounded to cents, None when that rounding hides the answer (the target rounds to the cost) (B-10). A row
        the time lens ranks passed the filter, whatever the rounding shows (B-11)."""
        r = self.rows[c]
        if r.get("time_ok") is not None:
            return bool(r["time_ok"])
        if c in (self.top.get("time") or []):
            return True
        t, cost = float(r["pnl"]["target"]), float(r["cost"])
        return None if math.isclose(t, cost, rel_tol=0.0, abs_tol=1e-9) else t > cost

    def scale(self, c: str) -> float:
        return 100.0 * self.rows[c]["n"]

    def value(self, c: str, lens: str) -> float:
        r = self.rows[c]
        return (float(r["pnl"][METRIC[lens]]) + float(r["cost"])) / self.scale(c)

    def tol(self, c: str, lens: str) -> float:
        d = self.ctx.get(c, {}).get(METRIC[lens])
        spot = d["spot"] if d else 0.0
        return self.scale(c) * om.tolerance(self.value(c, lens), spot)

    def val_error(self, c: str, lens: str) -> float | None:
        """Tier 2's stated error on the lens's value, in P&L; None when it stated none."""
        d = self.ctx.get(c, {}).get(METRIC[lens])
        if d is None or d.get("t2") is None:
            return None
        t2 = d["t2"]
        if t2["status"] == "exact":
            return 0.0
        e = t2.get("estimate")
        return None if e is None or not math.isfinite(e) else self.scale(c) * e

    def in_error(self, c: str, lens: str) -> float | None:
        """δσ·vega on the lens's value, in P&L (a local approximation); None when no δσ was stated."""
        r, d = self.rows.get(c), self.ctx.get(c, {}).get(METRIC[lens])
        if r is None or d is None:
            return None
        exp = expiry_of(c)
        if exp is None:
            return None
        days = (date.fromisoformat(exp) - SESSION).days   # the solve's own quote: type, strike and expiry (B-12)
        hits = {ds for sg, ds in self.dsig.get((d["call"], float(d["strike"]), days), [])
                if math.isclose(sg, r["iv"], rel_tol=1e-9)}
        if len(hits) != 1:   # none stated, or ambiguous: no allowance
            return None
        return self.scale(c) * hits.pop() * _vega_eu(ctx_of(d))

    def allowance(self, c: str, lens: str) -> float | None:
        a = self.tol(c, lens)
        if self.cfg in T2_VALUE:
            e = self.val_error(c, lens)
            if e is None:
                return None
            a += e
        if self.cfg in T2_INPUTS:
            e = self.in_error(c, lens)
            if e is None:
                return None
            a += e
        return a


def _carry_changed(a: Run, c_run: Run, contract: str) -> bool:
    e = expiry_of(contract)
    ca, cc = a.carry.get(e), c_run.carry.get(e)
    if ca is None or cc is None:
        return ca is not cc
    return ca["source"] != cc["source"] or not math.isclose(ca["forward"], cc["forward"], rel_tol=1e-12, abs_tol=0.0)


def classify(x: Run, a: Run, c_run: Run | None, lens: str, c: str, b: str | None) -> tuple[str, dict]:
    """The class of a rank change of contract c against partner b (the row it swapped places with)."""
    info = {"contract": c, "partner": b}
    for r in (c, b) if b != DISPLACED else (c,):   # a pick's partner is the other pick, which may be new
        for run in (x, a):
            if r is not None and r not in run.rows:
                return "removed or added", {**info, "missing": r, "missing_in": run.cfg,
                                            "cause": run.fate.get(r, "not a candidate")}
    if lens == "time":   # the lens keeps only rows whose target P&L covers their cost (options_finder.lens_order)
        for r in (c, b) if b not in (None, DISPLACED) else (c,):   # either row crossing it changes the order (B-9)
            ok = {run.cfg: run.time_ok(r) for run in (x, a)}
            if not all(ok.values()):
                return "time lens filter", {**info, "filtered": r, "below_cost_in": [k for k, v in ok.items() if v is False],
                                            "undetermined_in": [k for k, v in ok.items() if v is None]}
    if b == DISPLACED:
        return DISPLACED, info
    if b is None or b not in x.rows or b not in a.rows:
        return "unexplained", {**info, "why": "no counterpart (a top 20 shorter than 20)"}
    # tie, in either configuration
    for run in (x, a):
        ac, ab = run.allowance(c, lens), run.allowance(b, lens)
        if ac is not None and ab is not None and abs(run.metric(c, lens) - run.metric(b, lens)) <= ac + ab:
            return "tie", {**info, "in": run.cfg}
    rows = {}
    for r in (c, b):
        m_a, m_x = a.metric(r, lens), x.metric(r, lens)
        m_c = c_run.metric(r, lens) if c_run is not None and r in c_run.rows else None
        if x.cfg == "B":
            d_in, d_val = 0.0, m_x - m_a
        elif x.cfg == "C":
            d_in, d_val = m_x - m_a, 0.0
        else:
            if m_c is None:
                return "unexplained", {**info, "why": "no C row to separate inputs from valuation"}
            d_in, d_val = m_c - m_a, m_x - m_c
        tol_a = a.tol(r, lens)
        val_ok = (d_val == 0.0) or (x.val_error(r, lens) is not None
                                    and abs(d_val) <= x.val_error(r, lens) + x.tol(r, lens) + tol_a)
        in_e = x.in_error(r, lens) if x.cfg in T2_INPUTS else 0.0
        in_ok = (d_in == 0.0) or (in_e is not None and abs(d_in) <= in_e + 2 * tol_a)
        carry = x.cfg in T2_INPUTS and c_run is not None and _carry_changed(a, c_run, r)
        rows[r] = {"d_in": d_in, "d_val": d_val, "val_ok": val_ok, "in_ok": in_ok, "carry": carry}
    info["rows"] = rows
    val_all = all(v["val_ok"] for v in rows.values())
    in_all = all(v["in_ok"] for v in rows.values())
    any_in = any(v["d_in"] != 0.0 for v in rows.values())
    any_val = any(v["d_val"] != 0.0 for v in rows.values())
    if val_all and not any_in:
        return "explained by valuation", info
    # an input effect on a row whose expiry's carry changed rests on a carry without a stated error (DR-03): it is
    # never explained (or unexplained) by inputs, whatever the δσ·vega allowance says (B-7)
    if any(v["carry"] and v["d_in"] != 0.0 for v in rows.values()):
        return ("involves carry (conditioning not established)" if val_all else "unexplained"), info
    if in_all and not any_val:
        return "explained by inputs", info
    if val_all and in_all:
        return "explained by both", info
    return "unexplained", info


DISPLACED = "displaced by a removed or added candidate"


def changes(x: Run, a: Run, lens: str):
    """(kind, contract, partner) for every pick change, every top-20 member that entered or left, and every pair of
    members of both whose order flipped ("order", the higher in A first). A member's
    partner is the row it swapped places with: for one that entered, the leaver still present in X that X ranks
    highest; for one that left, the entrant still present in A that X ranks highest. When every counterpart was
    itself removed or added, the partner is DISPLACED."""
    tx, ta = x.top.get(lens) or [], a.top.get(lens) or []
    leavers = [c for c in ta if c not in tx]
    entrants = [c for c in tx if c not in ta]
    out = []
    if x.picks.get(lens) != a.picks.get(lens) and x.picks.get(lens) and a.picks.get(lens):
        out.append(("pick", a.picks[lens], x.picks[lens]))

    def partner(cands, present_in):
        here = [c for c in cands if c in present_in.rows and c in x.rows]
        if not here:
            return DISPLACED if cands else None
        return max(here, key=lambda c: x.metric(c, lens))

    for c in leavers:
        out.append(("left", c, partner(entrants, a)))
    for c in entrants:
        out.append(("entered", c, partner(leavers, x)))
    # members of both top 20s whose order flipped (B-8): every discordant pair, the one A ranks higher first; an
    # entrant or a leaver moves the others' positions but never their order, so only real swaps are counted
    pos = {c: i for i, c in enumerate(tx)}
    kept = [c for c in ta if c in pos]
    for i, c in enumerate(kept):
        for b in kept[i + 1:]:
            if pos[c] > pos[b]:
                out.append(("order", c, b))
    return out


def trace(recs: list[dict], limit: str) -> dict:
    by = {(r["index"], r["config"]): r for r in recs
          if r.get("limit_name") == limit and r.get("outcome") == "answered" and "config" in r}
    counts = defaultdict(Counter)
    causes = defaultdict(Counter)
    unexplained = []
    pairs = Counter()
    for (i, cfg), rec in sorted(by.items()):
        if cfg == "A" or (i, "A") not in by:
            continue
        x, a = Run(rec), Run(by[(i, "A")])
        c_run = Run(by[(i, "C")]) if (i, "C") in by else None
        pairs[cfg] += 1
        for lens in of.LENSES:
            for kind, c, b in changes(x, a, lens):
                cls, info = classify(x, a, c_run, lens, c, b)
                counts[f"{cfg}:{lens}"][f"{kind}: {cls}"] += 1
                if cls == "removed or added":
                    causes[cfg][f'{info["missing_in"]}: {info["cause"]}'] += 1
                if cls == "unexplained":
                    unexplained.append({"index": i, "config": cfg, "lens": lens, "kind": kind, **info,
                                        "contexts": {r: x.ctx.get(r, {}).get(METRIC[lens]) for r in (c, b) if r}})
    return {"limit": limit, "pairs_compared": dict(pairs), "classes": {k: dict(v) for k, v in counts.items()},
            "removed_or_added_causes": {k: dict(v.most_common()) for k, v in causes.items()},
            "unexplained": unexplained}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=Path)
    ap.add_argument("--limit", default="offline")
    args = ap.parse_args(argv)
    json.dump(trace(load(args.run), args.limit), sys.stdout, indent=1, default=str)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
