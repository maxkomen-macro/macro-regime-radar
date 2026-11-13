"""scripts/options_bench/run_p3.py — run Phase 3 on bench cases and write one record per case (test tooling).

    python -m scripts.options_bench.run_p3 --seed 20261026 --per-group 12 --out DIR [--workers 3]
        [--regions regions.json] [--no-refs] [--diagnostics] [--config greek-config.json] [--resume]

Per case: Tier 2's answer with the Phase 3 cross-check and Greek block (options_adaptive.phase3, under the claim
regions when given), the corroborated references of every quantity (greek_reference), the FD-only price
reference for Tier 2's lattice price (reference.py, unchanged), exact controls where every stencil state is
exempt, the proved-bound checks, control C1, and the work and wall time of each part. `--diagnostics` adds the
dev-only lattice gamma by delta differences (P3-A7) and QuantLib's Greeks. The records feed score_p3.py.
`--resume` keeps the complete records already in DIR/records-p3.jsonl and runs only the cases not yet written
(a run stopped part way loses at most the cases in flight; a partial last line is dropped). The resumed run must
use the same seed, sizes and settings: the manifest from the first run is checked and kept.
`--config` overrides the Greek configuration (h_sigma, h_r, h_d_frac, m_frac, p_frac, factors, bump_factors) for
production, the references (h_ref is the production bump halved), the exact controls and C1 alike.
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


FD_KEYS = ("m_frac", "p_frac", "work_cap", "penalty")
REF_KEYS = ("smooth_divs",)   # reference settings, not GreekConfig: the lattice side's dividend smoothing (V-3)


def greek_config(over: dict | None) -> G.GreekConfig:
    """GreekConfig with the given overrides; FD keys go to its FDConfig, tuples are given as lists of pairs."""
    base = G.GreekConfig()
    if not over:
        return base
    from dataclasses import replace
    from src.desk import options_fd as fd
    fd_over = {k: v for k, v in over.items() if k in FD_KEYS}
    rest = {k: (tuple(tuple(x) for x in v) if k in ("factors", "bump_factors") else v)
            for k, v in over.items() if k not in FD_KEYS + REF_KEYS}
    unknown = set(rest) - {f for f in G.GreekConfig.__dataclass_fields__ if f != "fd"}
    if unknown:
        raise ValueError(f"unknown Greek config keys {sorted(unknown)}")
    return replace(base, fd=replace(base.fd, **fd_over) if fd_over else base.fd, **rest)


def one(args) -> dict:
    case_json, regions_json, with_refs, diagnostics, *more = args
    over = more[0] if more else None
    cfg = greek_config(over)
    smooth = bool((over or {}).get("smooth_divs", False))
    case = cases.Case.from_json(case_json)
    c = C.to_ctx(case)
    regions = None if regions_json is None else Regions.from_json(regions_json)
    rec: dict = {"case": case.to_json(), "versions": {"tier2": oa.VERSION, "greeks": G.VERSION}}
    t0 = time.time()
    p3 = oa.phase3(c, gcfg=cfg, x_region=None if regions is None else regions.fd_role_region,
                   g_region=None if regions is None else regions.greek_region)
    rec["secs_phase3"] = time.time() - t0
    rec["tier2"] = golden.answer_json(p3.tier2)
    rec["tier2_deep_exercise"] = p3.tier2.audit.get("delta_rule") == "deep exercise"
    xc = p3.cross_check
    rec["cross_check"] = {"status": xc.status, "reason": xc.reason, "v_fd": xc.v_fd, "e_fd": xc.e_fd,
                          "diff": xc.diff, "tol": xc.tol, "L1": xc.audit.get("L1"), "L2": xc.audit.get("L2"),
                          "basis": xc.audit.get("basis"), "L": xc.audit.get("L"), "U": xc.audit.get("U")}
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
            if C.stencil_exempt(c, k, cfg):
                rec["exact"][k] = C.exact(c, k)
        t0 = time.time()
        rec["c1"] = C.c1(c, cfg)
        rec["secs_c1"] = time.time() - t0
    if with_refs and in_domain and c.days > 0:
        t0 = time.time()
        refs = GR.references(c, cfg, smooth_divs=smooth)
        rec["secs_refs"] = time.time() - t0
        rec["refs_work"] = refs.pop("_work")
        rec["refs"] = {k: {**{kk: v.get(kk) for kk in ("status", "R", "u", "tol", "R_FD", "u_FD", "G_L", "u_L", "diff",
                                                      "G_Q", "u_Q", "diff_Q", "corroborated_by", "corroborators")},
                           "q": {kk: (v.get("q") or {}).get(kk) for kk in ("levels", "values", "u_ref", "u_bump", "flags", "branch")}
                           if v.get("q") is not None else None,
                           # P3-AM6: the FD study's escalations, the shallow study it extended (if any), why an
                           # extension stopped at the cap
                           "fd_esc": ((v.get("fd") or {}).get("grid") or {}).get("escalations"),
                           "shallow": {kk: ((v.get("fd") or {}).get("shallow") or {}).get(kk)
                                       for kk in ("R", "u_ref", "u_bump", "flags")}
                           if (v.get("fd") or {}).get("shallow") is not None else None,
                           "deep": v.get("deep")}
                       for k, v in refs.items()}
        t0 = time.time()
        pr = reference.reference(case)
        rec["secs_price_ref"] = time.time() - t0
        rec["price_ref"] = {"status": pr["value"]["status"], "ref": pr["value"]["ref"], "u": pr["value"]["u"],
                            "tol": pr["value"]["tol"]}
    if diagnostics and in_domain and c.days > 0:
        t0 = time.time()
        rec["diag_delta_difference_gamma"] = delta_difference_gamma(c)
        rec["diag_quantlib"] = C.quantlib_greeks(c, cfg)
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
    ap.add_argument("--config")
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args(argv)
    over = None if a.config is None else json.loads(Path(a.config).read_text())
    gcfg = greek_config(over)
    if a.seed != DEV_SEED:
        raise SystemExit("run_p3 runs the development seed only; the held-out run is the frozen procedure")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    regions = None if a.regions is None else json.loads(Path(a.regions).read_text())
    todo = pilot_cases(a.seed, a.per_group, a.named)
    path = out / "records-p3.jsonl"
    settings = {"seed": a.seed, "per_group": a.per_group, "named": a.named, "regions": regions,
                "config_overrides": over, "refs": not a.no_refs, "diagnostics": a.diagnostics}
    done = {}
    if a.resume and path.exists():
        prior = json.loads((out / "settings-p3.json").read_text())
        if prior != json.loads(json.dumps(settings)):
            raise SystemExit("--resume needs the same seed, sizes and settings as the run it continues")
        keep = []
        for line in path.read_text().splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                break                       # a partial last line: dropped, its case runs again
            done[rec["case"]["id"]] = True
            keep.append(line)
        path.write_text("".join(x + "\n" for x in keep))
    else:
        (out / "settings-p3.json").write_text(json.dumps(settings, indent=1, default=str))
    rest = [c for c in todo if c.id not in done]
    t0 = time.time()
    with ProcessPoolExecutor(a.workers) as ex, path.open("a" if done else "w") as f:
        for rec in ex.map(one, [(c.to_json(), regions, not a.no_refs, a.diagnostics, over) for c in rest]):
            f.write(json.dumps(rec, allow_nan=True) + "\n")
            f.flush()
    # records are in case order: the kept prefix, then the rest in suite order
    (out / "manifest-p3.json").write_text(json.dumps({
        "seed": a.seed, "per_group": a.per_group, "named": a.named, "cases": len(todo), "secs": time.time() - t0,
        "versions": {"tier2": oa.VERSION, "greeks": G.VERSION}, "regions": regions,
        "greek_config": asdict(gcfg), "config_overrides": over, "x_config": asdict(oa.XConfig()),
        "ref_work_cap": GR.REF_WORK_CAP, "resumed_after": len(done)}, indent=1, default=str))
    print(f"{len(todo)} cases in {time.time() - t0:.0f} s -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
