"""scripts/options_bench/run_p3.py — run Phase 3 on bench cases and write one record per case (test tooling).

    python -m scripts.options_bench.run_p3 --seed 20261026 --per-group 12 --out DIR [--workers 3]
        [--regions regions.json] [--no-refs] [--diagnostics]

Per case: Tier 2's answer with the Phase 3 cross-check and Greek block (options_adaptive.phase3, under the claim
regions when given), the corroborated references of every quantity (greek_reference), the FD-only price
reference for Tier 2's lattice price (reference.py, unchanged), exact controls where every stencil state is
exempt, the proved-bound checks, control C1, and the work and wall time of each part. `--diagnostics` adds the
dev-only lattice gamma by delta differences (P3-A7) and QuantLib's Greeks. The records feed score_p3.py.
Development seed only until the freeze: the held-out run is a separate, frozen procedure.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases, controls_p3 as C, golden, greek_reference as GR, reference
from .regions_p3 import Regions

DEV_SEED = 20261026
DELTA_DIFF_EPS = 0.01   # the delta-difference diagnostic's spot bump, as a fraction of S


def delta_difference_gamma(c: om.Context, mults=(1, 2, 3, 4, 5, 6)) -> dict:
    """Dev diagnostic only (P3-A7): lattice gamma as the central difference of the lattice's own step-1 delta at
    S(1 ± ε), per level of the Phase 2 schedule, with the envelope estimate over the levels."""
    h = DELTA_DIFF_EPS * c.spot
    ys, ms = [], []
    for m in mults:
        steps = om.steps_for(c.days) * m
        if oa.units(steps) > om.REFINE_UNITS_MAX:
            break
        d = []
        for s in (c.spot + h, c.spot - h):
            _, dd, _ = om._lattice([c.is_call], [c.strike / s], np.array([c.rho]), np.array([c.q]),
                                   np.array([c.sigma]), [[(x, a / s) for x, a in c.divs]], c.days, steps)
            d.append(float(dd[0]))
        ys.append((d[0] - d[1]) / (2.0 * h))
        ms.append(m)
    if len(ms) < oa.MIN_LEVELS:
        return {"levels": ms, "values": ys, "G": None}
    g, e, _ = oa.envelope(ms, ys)
    return {"levels": ms, "values": ys, "G": g, "E": e}


def one(args) -> dict:
    case_json, regions_json, with_refs, diagnostics = args
    case = cases.Case.from_json(case_json)
    c = C.to_ctx(case)
    regions = None if regions_json is None else Regions.from_json(regions_json)
    rec: dict = {"case": case.to_json(), "versions": {"tier2": oa.VERSION, "greeks": G.VERSION}}
    t0 = time.time()
    p3 = oa.phase3(c, x_region=None if regions is None else regions.fd_role_region,
                   g_region=None if regions is None else regions.greek_region)
    rec["secs_phase3"] = time.time() - t0
    rec["tier2"] = golden.answer_json(p3.tier2)
    rec["tier2_deep_exercise"] = p3.tier2.audit.get("delta_rule") == "deep exercise"
    xc = p3.cross_check
    rec["cross_check"] = {"status": xc.status, "reason": xc.reason, "v_fd": xc.v_fd, "e_fd": xc.e_fd,
                          "diff": xc.diff, "tol": xc.tol, "L1": xc.audit.get("L1"), "L2": xc.audit.get("L2")}
    rec["price_status_p3"] = p3.price_status
    # L1 and L2 (and the h/2 value of a bumped Greek) let the calibration re-derive E_G for any candidate F_G
    rec["greeks"] = {g: {"status": a.status, "value": a.value, "estimate": a.estimate, "reason": a.reason,
                         "audit": {k: v for k, v in a.audit.items() if k in ("L1", "L2", "tol", "h", "L2_half", "rule")}}
                     for g, a in p3.greeks.items()}
    rec["units_phase3"] = p3.units
    rec["regions"] = {g: (None if regions is None else regions.greek_region(c, g)) for g in G.GREEKS}
    rec["fd_role"] = None if regions is None else regions.fd_role_region(c)
    in_domain = om.in_domain(c) is None and c.spot - c.pv() > 0
    rec["in_domain"] = in_domain
    rec["bounds"] = C.bound_violations(c, p3.tier2, p3.greeks) if in_domain else []
    rec["exact"] = {}
    if in_domain and c.days > 0:
        for k in GR.QUANTITIES:
            if C.stencil_exempt(c, k):
                rec["exact"][k] = C.exact(c, k)
        t0 = time.time()
        rec["c1"] = C.c1(c)
        rec["secs_c1"] = time.time() - t0
    if with_refs and in_domain and c.days > 0:
        t0 = time.time()
        refs = GR.references(c)
        rec["secs_refs"] = time.time() - t0
        rec["refs_work"] = refs.pop("_work")
        rec["refs"] = {k: {kk: v.get(kk) for kk in ("status", "R", "u", "tol", "R_FD", "u_FD", "G_L", "u_L", "diff")}
                       for k, v in refs.items()}
        t0 = time.time()
        pr = reference.reference(case)
        rec["secs_price_ref"] = time.time() - t0
        rec["price_ref"] = {"status": pr["value"]["status"], "ref": pr["value"]["ref"], "u": pr["value"]["u"],
                            "tol": pr["value"]["tol"]}
    if diagnostics and in_domain and c.days > 0:
        t0 = time.time()
        rec["diag_delta_difference_gamma"] = delta_difference_gamma(c)
        rec["diag_quantlib"] = C.quantlib_greeks(c)
        rec["secs_diagnostics"] = time.time() - t0
    return rec


def pilot_cases(seed: int, per_group: int, named: bool = False) -> list[cases.Case]:
    return list(cases.suite(seed, per_group, named=named))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=DEV_SEED)
    ap.add_argument("--per-group", type=int, default=12)
    ap.add_argument("--named", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--regions")
    ap.add_argument("--no-refs", action="store_true")
    ap.add_argument("--diagnostics", action="store_true")
    a = ap.parse_args(argv)
    if a.seed != DEV_SEED:
        raise SystemExit("run_p3 runs the development seed only; the held-out run is the frozen procedure")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    regions = None if a.regions is None else json.loads(Path(a.regions).read_text())
    todo = pilot_cases(a.seed, a.per_group, a.named)
    path = out / "records-p3.jsonl"
    t0 = time.time()
    with ProcessPoolExecutor(a.workers) as ex, path.open("w") as f:
        for rec in ex.map(one, [(c.to_json(), regions, not a.no_refs, a.diagnostics) for c in todo]):
            f.write(json.dumps(rec, allow_nan=True) + "\n")
            f.flush()
    (out / "manifest-p3.json").write_text(json.dumps({
        "seed": a.seed, "per_group": a.per_group, "named": a.named, "cases": len(todo), "secs": time.time() - t0,
        "versions": {"tier2": oa.VERSION, "greeks": G.VERSION}, "regions": regions,
        "greek_config": asdict(G.GreekConfig()), "x_config": asdict(oa.XConfig()),
        "ref_work_cap": GR.REF_WORK_CAP}, indent=1, default=str))
    print(f"{len(todo)} cases in {time.time() - t0:.0f} s -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
