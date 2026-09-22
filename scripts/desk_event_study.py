"""scripts/desk_event_study.py — run one event study from the command line
and print it the way the report shows it (desk/event-study, 2026-09-21).

    python scripts/desk_event_study.py --db data/desk_scratch.db --study gold-2sigma-spx-weak
    python scripts/desk_event_study.py --db data/desk_scratch.db --shock vix --w 5 --z 2 --sign + --target spx

Read-only: it opens the database through src/analytics/dbpath (mode=ro) and
never fetches anything. The ten most recent events are printed with their
forward moves so they can be checked against another tool by eye.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.desk import event_study as es  # noqa: E402


def render(r: dict) -> str:
    s, p = r["study"], r["provenance"]
    unit = s["target"]["unit"]
    f = lambda x: es.fmt_move(x, unit)  # noqa: E731
    out = [s["label"], f"calendar {p['calendar']}",
           f"slug {s['slug']} · as of {p['as_of']} · sample {p['sample_start']} → {p['sample_end']} ({p['n_sessions']} evaluable sessions) · "
           f"N={p['n_events']} (shock sessions {p['n_events_raw']}, after cooldown {p['n_shocks']}, condition held {p['n_after_condition']}; "
           f"unlabeled {p['n_unlabeled']} outside the totals) · cooldown {p['cooldown']} · seed {p['seed']} · hash {p['inputs_hash']}"]
    out.append(f"{'h':>3} {'n':>4} {'blocks':>6} {'incompl':>7} {'hit':>6} {'median':>9} {'mean':>9} {'p25':>9} {'p75':>9} | {'base n':>6} {'base med':>9} {'base hit':>8} | {'Δ':>9} {'90% CI':>22} {'opp%':>5} {'excl':>15} {'resample':>16}")
    for h in r["horizons"]:
        ci = h["ci90"]
        hit = "n/a" if h["hit_rate"] is None else f"{h['hit_rate']:.2f}"
        bhit = "n/a" if h["baseline_hit_rate"] is None else f"{h['baseline_hit_rate']:.2f}"
        excl = h.get("exclusion") or ("too few blocks" if h["ci90"] else "n/a")
        opp = "n/a" if h.get("opposite_sign_share") is None else f"{h['opposite_sign_share'] * 100:.1f}"
        method = {"exact": f"exact {h['n_draws']:,}", "monte_carlo": f"mc {h['n_draws']:,}"}.get(h["resampling"] or "", "none")
        out.append(f"{h['h']:>3} {h['n']:>4} {h['n_blocks']:>6} {h['n_incomplete']:>7} {hit:>6} {f(h['median']):>9} {f(h['mean']):>9} {f(h['p25']):>9} {f(h['p75']):>9} | "
                   f"{h['baseline_n']:>6} {f(h['baseline_median']):>9} {bhit:>8} | {f(h['delta']):>9} "
                   f"{('[' + f(ci[0]) + ', ' + f(ci[1]) + ']') if ci else (h['note'] or 'n/a'):>22} {opp:>5} {excl:>15} {method:>16}")
    ex = p["exclusions"]
    out.append("exclusions: " + " · ".join(f"{k}: off-session {v['off_session']}, missing sessions {v['missing_sessions']}, invalid {v['invalid_values']}" for k, v in sorted(ex.items()))
               + f" · baseline candidates without an entry {p['baseline_no_entry']}")
    out.append("regime split at 20 sessions (own baseline beside it):")
    for rg in r["regimes"]:
        c = next(x for x in rg["horizons"] if x["h"] == 20)
        tag = "  (outside the totals)" if rg.get("excluded_from_totals") else ""
        if c["note"]:
            out.append(f"  {rg['regime']:<15} n={c['n']:>3}  {c['note']}  (baseline n={c['baseline_n']}, median {f(c['baseline_median'])}){tag}")
        else:
            out.append(f"  {rg['regime']:<15} n={c['n']:>3}  hit {c['hit_rate']:.2f}  median {f(c['median'])}  (baseline n={c['baseline_n']}, median {f(c['baseline_median'])}){tag}")
    out.append("ten most recent events (newest first):")
    out.append(f"  {'event':<10} {'z':>5} {'regime':<15} {'entry':<10} {'same':<4} " + " ".join(f"{h:>4}d" for h in es.HORIZONS))
    for e in r["recent_events"]:
        z = "" if e["z"] is None else f"{e['z']:.2f}"
        out.append(f"  {e['date']:<10} {z:>5} {e['regime']:<15} {e['entry_date'] or 'none':<10} {'yes' if e['same_session'] else 'no':<4} "
                   + " ".join(f"{f(v) if v is not None else 'n/a':>6}" for v in e["moves"].values()))
    out.append("verdict: " + r["verdict"]["text"])
    if p["warnings"]:
        out.append("warnings: " + " · ".join(p["warnings"]))
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run one Desk event study (read-only).")
    ap.add_argument("--db", default=str(es.DB_PATH))
    ap.add_argument("--study", help="a preset name or a study slug")
    ap.add_argument("--shock", default="gold")
    ap.add_argument("--w", default=20)
    ap.add_argument("--z", default=2.0)
    ap.add_argument("--sign", default="+")
    ap.add_argument("--cond")
    ap.add_argument("--cond-value")
    ap.add_argument("--regime", default="all")
    ap.add_argument("--target", default="spx")
    ap.add_argument("--seed", default=es.DEFAULT_SEED)
    ap.add_argument("--json", action="store_true", help="print the full JSON payload instead")
    a = ap.parse_args(argv)
    try:
        q = es.parse_slug(a.study) if a.study else es.Query(shock=a.shock, w=a.w, z=a.z, sign=a.sign, cond=a.cond, cond_value=a.cond_value, regime=a.regime, target=a.target)
        q = es.validate(q.__class__(**{**q.__dict__, "seed": a.seed}))
        r = es.run(q, Path(a.db))
    except (es.StudyError, es.NotStored) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(r, indent=2) if a.json else render(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
