"""scripts/options_bench/pilot_p3.py — summarize a Phase 3 development run (test tooling, dev seed only).

    python -m scripts.options_bench.pilot_p3 DIR [--v3]

Reads DIR/records-p3.jsonl (run_p3.py) and writes DIR/pilot-summary.json: the cost of each part per case and
extrapolated to a held-out population of the planned sizes; production outcomes and reference outcomes by
named reason, per quantity and group; the scorer's view (development only, never acceptance evidence); the
cross-check statuses; the dev-only comparison of the two lattice gammas (step-2 node gamma, the approved
method, against the delta-difference diagnostic of P3-A7), each judged against the FD gamma study; and with
--v3 the node-gamma sequence on the dividend contexts with the lattice's dividend smoothing off and on (V-3).
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from src.desk import options_greeks as G

from . import controls_p3 as C, greek_reference as GR, score_p3 as S
from .cases import Case


def _first(reason: str | None) -> str:
    """A reason's first clause, numbers kept (the summary groups by the named condition)."""
    if not reason:
        return "none"
    return reason.split(";")[0].strip()[:90]


def cost(records: list[dict]) -> dict:
    out = {}
    for part in ("secs_phase3", "secs_refs", "secs_price_ref", "secs_c1", "secs_diagnostics"):
        xs = [r[part] for r in records if part in r]
        if xs:
            out[part] = {"n": len(xs), "mean": statistics.fmean(xs), "max": max(xs), "sum": sum(xs)}
    used = [r["refs_work"]["used"] for r in records if "refs_work" in r]
    if used:
        out["ref_work_units"] = {"mean": statistics.fmean(used), "max": max(used)}
    per_group = defaultdict(list)
    for r in records:
        per_group[r["case"]["group"]].append(sum(r.get(k, 0.0) for k in ("secs_phase3", "secs_refs",
                                                                           "secs_price_ref", "secs_c1")))
    out["secs_per_case_by_group"] = {g: statistics.fmean(v) for g, v in sorted(per_group.items())}
    return out


def outcomes(records: list[dict]) -> dict:
    prod, refs = defaultdict(Counter), defaultdict(Counter)
    for r in records:
        g = r["case"]["group"]
        for k, a in r["greeks"].items():
            prod[f"{k}|{g}"][a["status"] if a["status"] != G.WITHHELD else f"withheld: {_first(a['reason'])}"] += 1
        for k, v in (r.get("refs") or {}).items():
            refs[f"{k}|{g}"][_first(v.get("status"))] += 1
    return {"production": {k: dict(v) for k, v in sorted(prod.items())},
            "references": {k: dict(v) for k, v in sorted(refs.items())}}


def gamma_methods(records: list[dict]) -> dict:
    """Node gamma (G_L from the corroboration) and the delta-difference diagnostic, against the FD gamma study:
    how often each forms a value, agrees with R_FD within 0.1·tol_G, and meets the sequence budget."""
    rows = {"node": Counter(), "delta_difference": Counter()}
    for r in records:
        ref = (r.get("refs") or {}).get(G.GAMMA) or {}
        r_fd = ref.get("R_FD")
        if r_fd is None:
            continue
        tol = G.tolerance(G.GAMMA, r_fd, r["case"]["spot"])
        node, node_u = ref.get("G_L"), ref.get("u_L")             # node gamma has no bump term: u_L = u_L,seq
        dd = (r.get("diag_delta_difference_gamma") or {}).get("G")
        dd_e = (r.get("diag_delta_difference_gamma") or {}).get("E")
        dd_u = None if dd_e is None else max(GR.LATTICE_F * dd_e, GR.REF_FLOOR * tol)
        for name, val, u in (("node", node, node_u), ("delta_difference", dd, dd_u)):
            rows[name]["contexts"] += 1
            if val is None:
                rows[name]["no value"] += 1
                continue
            rows[name]["value"] += 1
            if abs(val - r_fd) <= GR.AGREE * tol:
                rows[name]["agrees within 0.1 tol"] += 1
            if u is not None and u <= GR.U_REF_MAX * tol:
                rows[name]["sequence within budget"] += 1
    return {k: dict(v) for k, v in rows.items()}


def v3(records: list[dict]) -> dict:
    """Node-gamma sequences with the lattice's dividend smoothing off and on, on the dividend contexts."""
    out = []
    for r in records:
        case = Case.from_json(r["case"])
        if not case.divs or not r.get("in_domain") or case.days == 0:
            continue
        c = C.to_ctx(case)
        sp = GR.spec(c, G.GAMMA, G.GreekConfig())
        ref = (r.get("refs") or {}).get(G.GAMMA) or {}
        tol = G.tolerance(G.GAMMA, ref.get("R_FD") or 0.0, c.spot)
        row = {"case": case.id, "R_FD": ref.get("R_FD")}
        for smooth in (False, True):
            try:
                lat = GR.lattice_seq(GR.Runner(GR.RefBudget(), smooth_divs=smooth), c, sp, tol)
            except GR.CapHit:
                lat = {"G": None, "flags": [GR.R_CAP]}
            key = "smooth" if smooth else "plain"
            row[key] = {"G": lat["G"], "u_seq_over_tol": None if lat["G"] is None else lat["u_seq"] / tol,
                        "flags": lat.get("flags"),
                        "agrees": None if lat["G"] is None or ref.get("R_FD") is None
                        else abs(lat["G"] - ref["R_FD"]) <= GR.AGREE * tol}
        out.append(row)
    summary = {}
    for key in ("plain", "smooth"):
        vals = [x[key] for x in out]
        summary[key] = {"contexts": len(vals), "value": sum(1 for v in vals if v["G"] is not None),
                        "within_budget": sum(1 for v in vals if v["u_seq_over_tol"] is not None
                                             and v["u_seq_over_tol"] <= GR.U_REF_MAX),
                        "agrees": sum(1 for v in vals if v["agrees"])}
    return {"summary": summary, "rows": out}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir")
    ap.add_argument("--v3", action="store_true")
    a = ap.parse_args(argv)
    d = Path(a.dir)
    records = [json.loads(line) for line in (d / "records-p3.jsonl").read_text().splitlines() if line.strip()]
    out = {"cases": len(records), "cost": cost(records), "outcomes": outcomes(records),
           "scorer_dev_only": S.score_greeks(records), "cross_check_dev_only": S.score_cross_check(records),
           "c1": S.score_c1(records), "x1": S.score_x1(records), "gamma_methods": gamma_methods(records)}
    if a.v3:
        out["v3"] = v3(records)
    (d / "pilot-summary.json").write_text(json.dumps(out, indent=1, default=str, allow_nan=True))
    print(json.dumps({k: out[k] for k in ("cases", "cost", "c1", "x1", "gamma_methods")}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
