"""scripts/options_bench/freeze_p3.py — the Phase 3 freeze: claim regions, sizes, sample plan, freeze file (test tooling).

Design: review-loop/options-adaptive-p3/designs/design-P3-approved.md sections 7.3, 8.2, 8.5 and 10, with the
amendments P3-AM1 to P3-AM8. Everything here reads development records only (seed 20261026); nothing draws or
reads a held-out case except `freeze`, which only records the fresh seed.

    python -m scripts.options_bench.freeze_p3 fd-role --records DEV/records-p3.jsonl --config CFG --out ROWS.jsonl
    python -m scripts.options_bench.freeze_p3 regions --records DEV/records-p3.jsonl --fd-role ROWS.jsonl \
        --carves CARVES.json --out REGIONS.json
    python -m scripts.options_bench.run_p3 --per-group 120 --no-refs --regions REGIONS.json --config CFG --out PROD
    python -m scripts.options_bench.freeze_p3 plan --refs DEV/records-p3.jsonl --prod PROD/records-p3.jsonl \
        --controls CTL.jsonl --regions REGIONS.json --out PLAN.json
    python -m scripts.options_bench.freeze_p3 freeze --plan PLAN.json --config CFG --seed N --out FREEZE.json

`fd-role`: production FD prices every in-domain dev context at L1 and L2 at the frozen configuration, exactly as
calibrate_p3's grid stage (fd.levels, fd.price under one per-context budget).
`regions`: Ω's bounds from the dev draws (regions_p3.support_from_dev); the declared carve-outs (a JSON file
{"greeks": {greek: [carve...]}, "fd": [carve...]}, each carve {name, feature, op, value, kind}); then two checks
that refuse the regions when they fail: the FD role rule of section 10 on Ω_X (in every group, at least 99% of the
dev contexts inside Ω_X with a resolved corroborated price reference have |V_FD(L2) − R| ≤ 0.1·tol, an FD refusal
counting as not agreeing, and none has |V_FD − R| > tol + u), and no blocking dev result (confirmed failure,
straddle, proved-bound violation, estimator-coverage miss) inside any Ω_G.
`plan`: π per (G, g) and for each group's cross-check pair on the development records joined with production
re-run under the regions and the frozen configuration; sizes by section 8.2 (n ≥ 300/(0.8·π), n_g = max(400,
largest targeted need), cap 2,500, G6-long 3,500 by decision D4); the controls' frozen sizes by the same 80%
margin on the dev control rates (C2-FD and C2-Q per group, C2-lattice and C1 per E-stratum, each quantity at
least 300 scored); the E-strata's proposal counts by DR-15 (P = ceil(n/(0.5·a)), at most 100,000). A required
pair above its cap stops the plan: that is Max's decision (narrow Ω_G or raise the cap).
`freeze`: the freeze file: seed (fresh, never a registered one), sizes, targeted list, regions, configuration,
control plan, CPU cap and the SHA-256 of every engine and bench file; heldout_p3.py refuses to run on any
difference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from src.desk import options_adaptive as oa
from src.desk import options_fd as fd
from src.desk import options_greeks as G
from src.desk import options_math as om

from . import cases, controls_p3 as C, greek_reference as GR, regions_p3 as RG, run_p3, score_p3 as S

DEV_SEED = 20261026
# every seed registered for a bench run so far; a held-out seed must be none of them (design 8.5, PHASE3-READINESS)
USED_SEEDS = (20261026, 20261029, 20261102, 20261111, 20261117)
FD_AGREE, FD_SHARE = 0.1, 0.99        # section 10: within 0.1·tol in at least 99% of resolved contexts
CAPS = {"G6-long": 3500}              # decision D4 (P3-A17): G6-long up to 3,500; every other group RG.N_CAP
CROSS = "cross-check"
CPU_CAP_HOURS = 130.0                 # P3-A21: 130 aggregate CPU hours for the one held-out experiment
REPEAT_EVERY = 50                     # every k-th case's production is run twice from scratch (Phase 2 rows)

BENCH_DIR = Path(__file__).resolve().parent
REPO = BENCH_DIR.parent.parent
# the engine (Tier 1, Tier 2, the production FD and Greeks) and the Phase 2 frozen copy the Phase 2 rows compare
# against; every bench module is added by frozen_paths
FROZEN_FILES = ("src/desk/options_math.py", "src/desk/options_finder.py", "src/desk/options_engine.py",
                "src/desk/options_adaptive.py", "src/desk/options_fd.py", "src/desk/options_greeks.py",
                "src/market_data/session.py", "tests/fixtures/options_pre_phase3/__init__.py",
                "tests/fixtures/options_pre_phase3/options_adaptive_2ff3e8b.py")


def frozen_paths() -> list[str]:
    return list(FROZEN_FILES) + sorted(str(p.relative_to(REPO)) for p in BENCH_DIR.glob("*.py"))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_hashes() -> dict:
    return {p: sha(REPO / p) for p in frozen_paths()}


def check_freeze(freeze: dict) -> list[str]:
    """The files whose hash differs from the freeze (and files either side lists alone); empty when all match."""
    now, want = file_hashes(), freeze["files_sha256"]
    return sorted({p for p in set(now) | set(want) if now.get(p) != want.get(p)})


def read_jsonl(path) -> list[dict]:
    out = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def _over(path) -> dict:
    return json.loads(Path(path).read_text())


# ── the FD role rule's dev rows ────────────────────────────────────────────

def _fd_role_one(args) -> dict:
    rec, over = args
    cfg = run_p3.greek_config(over)
    case = cases.Case.from_json(rec["case"])
    c = C.to_ctx(case)
    ref = (rec.get("refs") or {}).get(GR.PRICE) or {}
    out = {"id": case.id, "group": case.group, "ref": {k: ref.get(k) for k in ("status", "R", "u", "tol")}}
    if om.in_domain(c) is not None or not c.spot - c.pv() > 0 or c.days == 0:
        out["skipped"] = True
        return out
    lv = fd.levels(c, cfg.fd)
    budget = fd.Budget(cfg.fd.work_cap)
    got = [fd.price(c, lv[k], budget, penalty=cfg.fd.penalty) for k in (0, 1)]
    if all(isinstance(g, fd.Solved) for g in got):
        out.update(v1=got[0].value, v2=got[1].value)
    else:
        out["refused"] = next(g.reason for g in got if isinstance(g, fd.Refused))
    return out


def fd_role_rule(rows: list[dict], records: dict, regions: RG.Regions) -> dict:
    """Section 10 on the dev rows inside Ω_X: per group resolved, agreeing, refused, confirmed failures, the share;
    `holds` when every group's share is at least 99% and none has a confirmed failure."""
    groups = defaultdict(lambda: {"resolved": 0, "agree": 0, "refused": 0, "failures": [], "disagree": []})
    for r in rows:
        if r.get("skipped") or r["ref"]["status"] != "resolved":
            continue
        c = C.to_ctx(cases.Case.from_json(records[r["id"]]["case"]))
        if regions.fd_role_region(c) is not None:
            continue
        g = groups[r["group"]]
        g["resolved"] += 1
        if "refused" in r:
            g["refused"] += 1
            g["disagree"].append({"id": r["id"], "refused": r["refused"]})
            continue
        err = abs(r["v2"] - r["ref"]["R"])
        if err <= FD_AGREE * r["ref"]["tol"]:
            g["agree"] += 1
        else:
            g["disagree"].append({"id": r["id"], "err_over_tol": err / r["ref"]["tol"]})
        if err > r["ref"]["tol"] + r["ref"]["u"]:
            g["failures"].append(r["id"])
    out = {k: {**v, "share": v["agree"] / v["resolved"] if v["resolved"] else math.nan} for k, v in sorted(groups.items())}
    holds = bool(out) and all(v["share"] >= FD_SHARE and not v["failures"] for v in out.values())
    return {"groups": out, "holds": holds}


def with_regions(rec: dict, regions: RG.Regions) -> dict:
    """A dev record scored under the regions: each Greek's region reason set from the Context alone."""
    c = C.to_ctx(cases.Case.from_json(rec["case"]))
    return {**rec, "regions": {g: regions.greek_region(c, g) for g in G.GREEKS}}


def greek_evidence(records: list[dict], regions: RG.Regions) -> dict:
    """Blocking dev results inside each Ω_G (failures, straddles, bound violations, coverage misses)."""
    scored = S.score_greeks([with_regions(r, regions) for r in records])
    misses = {k: p["coverage_misses"] for k, p in scored["pairs"].items() if p["coverage_misses"]}
    blocking = {g: v for g, v in scored["blocking"].items() if v}
    return {"blocking": blocking, "coverage_misses": misses, "clean": not blocking and not misses}


def carves_from(d: dict) -> tuple[dict, tuple]:
    carve = lambda k: RG.Carve(k["name"], k["feature"], k["op"], float(k["value"]), k.get("kind"))
    return ({g: tuple(carve(k) for k in ks) for g, ks in d.get("greeks", {}).items()},
            tuple(carve(k) for k in d.get("fd", ())))


# ── sizes (section 8.2) ─────────────────────────────────────────────────────

def join(refs: list[dict], prod: list[dict]) -> list[dict]:
    """The dev records with production re-run under the regions and frozen configuration: the reference side
    (refs, price_ref, exact, c1) from `refs`, the production side from `prod`, matched by id and checked case."""
    keys = ("tier2", "tier2_deep_exercise", "cross_check", "price_status_p3", "greeks", "units_phase3", "regions",
            "fd_role", "bounds", "versions")
    by = {r["case"]["id"]: r for r in prod}
    out = []
    for r in refs:
        p = by.get(r["case"]["id"])
        if p is None or p["case"] != r["case"]:
            raise ValueError(f"no production record for {r['case']['id']} (or another case under its id)")
        out.append({**r, **{k: p.get(k) for k in keys}})
    if len(out) != len(prod):
        raise ValueError("the production run has records the reference run does not")
    return out


def cross_rows(rec: dict) -> dict | None:
    """One record's cross-check outcome for the pair rule (8.3, DR-07): None when the cross-check does not apply
    (no price, or an exact one), else whether it is cross-checked with both producers scored."""
    xc = rec["cross_check"]
    if xc["status"] == oa.XC_NOT_APPLICABLE:
        return None
    row = S.score_cross_check([{**rec, "case": {**rec["case"], "group": "_"}}])["_"]
    return {"scored_both": row["scored_both"] == 1}


def rates(records: list[dict]) -> dict:
    """{group: {pair: (applicable dev contexts, π)}}: π the per-draw rate of applicable, in Ω_G, returned and
    scored (8.2), the cross-check's the per-draw rate of cross-checked with both producers scored."""
    draws = Counter()
    app, scored = Counter(), Counter()
    for r in records:
        g = r["case"]["group"]
        if g == "X1-outside" or r["case"]["kind"] == "named":
            continue
        draws[g] += 1
        for k in G.GREEKS:
            s = S.score_greek(r, k)
            if s["outcome"] == "not applicable":
                continue
            app[(g, k)] += 1
            if s["outcome"] == "returned" and s.get("in_region") and s.get("result") != "unscored":
                scored[(g, k)] += 1
        x = cross_rows(r)
        if x is not None:
            app[(g, CROSS)] += 1
            scored[(g, CROSS)] += x["scored_both"]
    return {g: {k: (app[(g, k)], scored[(g, k)] / draws[g]) for k in G.GREEKS + (CROSS,)} for g in draws}


def plan_sizes(rt: dict) -> dict:
    """regions_p3.plan_sizes with each group's own cap; a required pair above it is "decision needed"."""
    pairs, groups, decisions = {}, {}, []
    for g, by in rt.items():
        cap = CAPS.get(g, RG.N_CAP)
        need = []
        for k, (n_app, pi) in by.items():
            if n_app == 0:
                pairs[f"{k}|{g}"] = {"standing": "not applicable"}
                continue
            n = RG.required_n(pi)
            if n is None:
                pairs[f"{k}|{g}"] = {"standing": "not targeted", "pi": pi, "applicable": n_app}
                decisions.append(f"{k}|{g}")
            elif n <= cap:
                pairs[f"{k}|{g}"] = {"standing": "targeted", "pi": pi, "n": n, "applicable": n_app}
                need.append(n)
            else:
                pairs[f"{k}|{g}"] = {"standing": "decision needed", "pi": pi, "n": n, "cap": cap}
                decisions.append(f"{k}|{g}")
        groups[g] = max([RG.N_FLOOR] + need)
    return {"pairs": pairs, "groups": groups, "decisions": decisions}


def control_sizes(rows: list[dict]) -> dict:
    """The controls' frozen sizes from a dev control run (one row per (stage, context): {stage, key, status:
    {quantity: status}}). Per stage and group or stratum: `base`, the first contexts that run every quantity,
    sized so each non-dividend quantity reaches 300 scored at 80% of its dev rate (at least 300); `dividend`, the
    number of dividend-applicable contexts needed for 300 dividend values scored at 80% of the dev rate among
    applicable ones (0 when the dividend sensitivity never applies there)."""
    n, app, scored = Counter(), Counter(), Counter()
    for r in rows:
        if r.get("error") or r["stage"] == "c1":
            continue
        unit = r["key"].split("|", 1)[1].rsplit("/", 1)[0]
        key = (r["stage"], unit)
        n[key] += 1
        for k, v in (r["status"] or {}).items():
            if "not applicable" not in str(v):
                app[key + (k,)] += 1
            scored[key + (k,)] += v == "scored"
    out = {}
    for key, m in sorted(n.items()):
        base = RG.SCORED_MIN
        rates_ = {}
        for k in GR.QUANTITIES:
            rate = scored[key + (k,)] / m
            rates_[k] = rate
            if k != G.DIVIDEND and rate > 0:
                base = max(base, RG.required_n(rate))
        a = app[key + (G.DIVIDEND,)]
        div = RG.required_n(scored[key + (G.DIVIDEND,)] / a) if a else 0
        out[f"{key[0]}|{key[1]}"] = {"contexts": m, "rates": rates_, "dividend_applicable": a, "base": base,
                                     "dividend": div or 0}
    return out


def e_acceptance(seed: int, stratum: str, proposals: int) -> dict:
    """Dev acceptance of an E-stratum's proposal population: kept share and kept-with-dividends share."""
    kept = with_div = 0
    for i in range(proposals):
        c = C.e_proposal(seed, stratum, i)
        if c is not None:
            kept += 1
            with_div += bool(c.divs)
    return {"proposals": proposals, "kept": kept, "kept_with_dividends": with_div}


def e_plan(base: int, dividend: int, acc: dict) -> dict:
    """DR-15: P = ceil(n / (0.5·a)) for the kept base and for the kept-with-dividends need, the larger, capped."""
    a = acc["kept"] / acc["proposals"]
    p = RG.stratum_proposals(base, a)
    if dividend:
        ad = acc["kept_with_dividends"] / acc["proposals"]
        pd = RG.stratum_proposals(dividend, ad)
        p = None if pd is None or p is None else max(p, pd)
    return {"proposals": p, "base": base, "dividend": dividend, "dev_acceptance": acc}


# ── commands ────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a1 = sub.add_parser("fd-role")
    a1.add_argument("--records", required=True)
    a1.add_argument("--config", required=True)
    a1.add_argument("--out", required=True)
    a1.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a2 = sub.add_parser("regions")
    a2.add_argument("--records", required=True)
    a2.add_argument("--fd-role", required=True)
    a2.add_argument("--carves", required=True)
    a2.add_argument("--out", required=True)
    a3 = sub.add_parser("plan")
    a3.add_argument("--refs", required=True)
    a3.add_argument("--prod", required=True)
    a3.add_argument("--controls", required=True)
    a3.add_argument("--regions", required=True)
    a3.add_argument("--e-dev-proposals", type=int, default=20000)
    a3.add_argument("--out", required=True)
    a4 = sub.add_parser("freeze")
    a4.add_argument("--plan", required=True)
    a4.add_argument("--config", required=True)
    a4.add_argument("--seed", type=int, required=True)
    a4.add_argument("--seed-note", required=True)
    a4.add_argument("--workers", type=int, default=4)
    a4.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    if a.cmd == "fd-role":
        recs = [r for r in read_jsonl(a.records) if r["case"]["group"] != "X1-outside" and r["case"]["kind"] != "named"]
        over = {k: v for k, v in _over(a.config).items()}
        with ProcessPoolExecutor(a.workers) as ex, open(a.out, "w") as f:
            for row in ex.map(_fd_role_one, [(r, over) for r in recs]):
                f.write(json.dumps(row) + "\n")
        return 0

    if a.cmd == "regions":
        recs = read_jsonl(a.records)
        dev = [cases.Case.from_json(r["case"]) for r in recs if r["case"]["kind"] != "named"]
        sup = RG.support_from_dev(dev)
        carves, fd_carves = carves_from(_over(a.carves))
        regions = RG.Regions(sup, carves, fd_carves)
        role = fd_role_rule(read_jsonl(a.fd_role), {r["case"]["id"]: r for r in recs}, regions)
        ev = greek_evidence(recs, regions)
        out = {"regions": regions.to_json(), "fd_role_rule": role, "greek_evidence": ev,
               "inputs": {"records": sha(Path(a.records)), "fd_role": sha(Path(a.fd_role)), "carves": sha(Path(a.carves))}}
        Path(a.out).write_text(json.dumps(out, indent=1))
        print(json.dumps({"fd_role_holds": role["holds"], "greeks_clean": ev["clean"],
                          "shares": {g: round(v["share"], 4) for g, v in role["groups"].items()}}))
        if not (role["holds"] and ev["clean"]):
            raise SystemExit("the regions fail the FD role rule or a Greek has blocking dev results: declare carve-outs")
        return 0

    if a.cmd == "plan":
        regions_doc = _over(a.regions)
        regions = RG.Regions.from_json(regions_doc["regions"])
        prod = read_jsonl(a.prod)
        for r in prod:   # the production run must be the regions' own
            c = C.to_ctx(cases.Case.from_json(r["case"]))
            if r["regions"] != {g: regions.greek_region(c, g) for g in G.GREEKS} or r["fd_role"] != regions.fd_role_region(c):
                raise SystemExit(f"{r['case']['id']}: the production run was not made under these regions")
        recs = join(read_jsonl(a.refs), prod)
        rt = rates(recs)
        sizes = plan_sizes(rt)
        ctl = control_sizes(read_jsonl(a.controls))
        e = {}
        for s in C.E_STRATA:
            row = ctl[f"c2_lattice|{s}"]
            e[s] = e_plan(row["base"], row["dividend"], e_acceptance(DEV_SEED, s, a.e_dev_proposals))
        c2 = {}
        for g in cases.IN_DOMAIN_GROUPS:
            fd_, q_ = ctl[f"c2_fd|{g}"], ctl[f"c2_q|{g}"]
            c2[g] = {"base": max(fd_["base"], q_["base"]), "dividend": max(fd_["dividend"], q_["dividend"])}
        targeted = defaultdict(list)
        for key, p in sizes["pairs"].items():
            if p["standing"] == "targeted":
                k, g = key.split("|")
                targeted[k].append(g)
        out = {"rates": {g: {k: list(v) for k, v in by.items()} for g, by in rt.items()}, "sizes": sizes,
               "targeted": {k: sorted(v) for k, v in sorted(targeted.items())}, "controls_dev": ctl,
               "controls": {"c2": c2, "e_strata": e}, "regions": regions_doc["regions"],
               "inputs": {"refs": sha(Path(a.refs)), "prod": sha(Path(a.prod)), "controls": sha(Path(a.controls)),
                          "regions": sha(Path(a.regions))}}
        Path(a.out).write_text(json.dumps(out, indent=1))
        print(json.dumps({"groups": sizes["groups"], "decisions": sizes["decisions"], "c2": c2,
                          "e": {s: {k: v[k] for k in ("proposals", "base", "dividend")} for s, v in e.items()}}))
        if sizes["decisions"]:
            raise SystemExit("required pairs cannot be targeted under the caps: Max's decision (" +
                             ", ".join(sizes["decisions"]) + ")")
        return 0

    if a.cmd == "freeze":
        if a.seed in USED_SEEDS:
            raise SystemExit(f"seed {a.seed} is registered already: a held-out seed is fresh")
        plan = _over(a.plan)
        sizes = dict(plan["sizes"]["groups"])
        sizes["X1-outside"] = RG.N_FLOOR      # X1 checks refusals only: the floor, no targeted pair
        freeze = {
            "about": "Phase 3 held-out freeze (design-P3-approved.md 8.5 step 2; P3-A21). heldout_p3.py refuses any "
                     "file, seed or plan that differs.",
            "held_out": {"seed": a.seed, "seed_note": a.seed_note, "sizes": sizes, "named": True,
                         "order": "seed order within each group (regions_p3.held_out); named cases first"},
            "used_seeds": list(USED_SEEDS),
            "config": _over(a.config),
            "regions": plan["regions"],
            "targeted": plan["targeted"],
            "cross_check_required": sorted(g for g, by in plan["rates"].items() if by[CROSS][0] > 0),
            "controls": plan["controls"],
            "repeat_every": REPEAT_EVERY,
            "cpu": {"cap_hours": CPU_CAP_HOURS, "stop_margin_hours": 0.05, "no_submit_margin_hours": 0.5,
                    "sample_seconds": 15.0, "unclean_session_surcharge": "workers x sample_seconds"},
            "workers": a.workers,
            "plan_sha256": sha(Path(a.plan)),
            "frozen_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "files_sha256": file_hashes(),
        }
        Path(a.out).write_text(json.dumps(freeze, indent=1) + "\n")
        print(f"freeze written: seed {a.seed}, {sum(sizes.values())} drawn cases + named")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
