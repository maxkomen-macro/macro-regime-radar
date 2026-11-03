"""Desk study results under real-time regime labels (Desk plan D8, research only).

Every Desk event study splits its events by the regime label of the row
stamped two months before the event's month (`event_study.regime_at`,
REGIME_LAG_MONTHS = 2), and `/regime`'s stats pair each label with the
S&P's return in the month it governed. Both read today's regimes table,
i.e. labels computed on the latest data vintage. This reruns them with the
labels as they were known at the time and counts what changes.

Three label sources, all from `vintage_regime.py`'s replay:

* `served`: the stored table, unchanged (the baseline run).
* `governed_start`: row M carries its label from the vintage of the last day
  of month M+1, the eve of the month it governs. A table swap on a scratch
  copy of the database; the engine runs unmodified.
* `point_in_time`: each session takes row K-2's label from the vintage of
  that session's own date (a mid-month INDPRO or CPI release can revise it).
  The engine reads labels through one module function, `regime_at`; this
  run swaps that function in this process only. No file is edited.

Never touches the app database: the scratch copy lives where `--scratch`
says. Runs every catalog study (api/desk_catalog.CATALOG) at the engine's
defaults (default seed, N_BOOT draws).

Usage:
    python3 -m scripts.research.vintage_studies --db data/macro_radar.db \
        --labels OUT/regime_labels_by_vintage.csv.gz --histories OUT/regime_histories.csv \
        --scratch SCRATCH_DIR --out OUT
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PRIMARY_H = 20


def load_vintage_labels(path: Path) -> tuple[list[str], dict[str, dict[str, str]]]:
    long = pd.read_csv(path)
    by_v: dict[str, dict[str, str]] = {}
    for v, g in long.groupby("vintage", sort=True):
        by_v[str(v)] = dict(zip(g["month"].astype(str), g["label"]))
    return sorted(by_v), by_v


def make_scratch_db(src: Path, dst: Path, labels: dict[str, str | None]) -> Path:
    """A copy of `src` whose regimes rows for the months in `labels` carry the
    given label (None deletes the row: the label was not known yet)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    conn = sqlite3.connect(dst)
    try:
        for month, lab in labels.items():
            d = f"{month}-01"
            if lab is None:
                conn.execute("DELETE FROM regimes WHERE date = ?", (d,))
            else:
                conn.execute("UPDATE regimes SET label = ? WHERE date = ?", (lab, d))
        conn.commit()
    finally:
        conn.close()
    return dst


def point_in_time_regime_at(vdates: list[str], by_v: dict[str, dict[str, str]], lag: int):
    """A drop-in for event_study.regime_at: each session's label is row
    K-lag's label in the vintage published on or before the session's date
    (CPI 08:30 ET and G.17 09:15 ET both precede the open, so a release on the
    session's own day counts). Months the replay did not cover (rows left by
    older runs, before the replay window) keep the stored label."""
    from src.desk import event_study as es

    varr = np.array(vdates)

    def regime_at(dates: pd.DatetimeIndex, months: pd.Series, lag_: int = lag) -> pd.Index:
        if len(dates) == 0:
            return pd.Index([], dtype=object)
        first_replayed = min(min(by_v[v]) for v in vdates)
        keys = dates.to_period("M") - lag_
        days = dates.strftime("%Y-%m-%d")
        idx = np.searchsorted(varr, days, side="right") - 1
        out = []
        for k, i in zip(keys, idx):
            ks = str(k)
            if ks < first_replayed:
                lab = months.get(k, es.UNLABELED)
                out.append(lab if isinstance(lab, str) else es.UNLABELED)
            elif i < 0:
                out.append(es.UNLABELED)
            else:
                out.append(by_v[vdates[i]].get(ks, es.UNLABELED))
        return pd.Index(np.array(out, dtype=object))

    return regime_at


def run_catalog(db: Path) -> dict[str, dict]:
    from api.desk_catalog import CATALOG
    from src.desk import event_study as es

    out = {}
    for st in CATALOG:
        q = es.Query(**st.engine_kwargs)
        res, table, _trace = es.run_traced(q, db)
        out[st.slug] = {"result": res, "events": list(zip([table.sessions[i] for i in table.event_idx], table.regime))}
    return out


def summarize(res: dict) -> dict:
    """The regime split at the primary horizon and the verdict sentences."""
    split = {}
    for row in res.get("regimes", []):
        cell = next((c for c in row.get("horizons", []) if c.get("h") == PRIMARY_H), {})
        split[row["regime"]] = {"n_events": row.get("n_events"), "n": cell.get("n"), "median": cell.get("median"),
                                "baseline_median": cell.get("baseline_median"), "hit_rate": cell.get("hit_rate")}
    overall = next((h for h in res.get("horizons", []) if h.get("h") == PRIMARY_H), {})
    verdict = res.get("verdict") or {}
    return {"overall_n": overall.get("n"), "overall_median": overall.get("median"),
            "split": split, "verdict": list(verdict.get("sentences", []))}


def _regime_sentences(sentences: list[str]) -> list[str]:
    """The verdict's sentences about the regime split (the ranking, or why
    there is none, and the n<10 list of regimes)."""
    return [s for s in sentences if "regime" in s.lower() or s.startswith("n<10")]


def compare(base: dict[str, dict], alt: dict[str, dict]) -> dict:
    out = {}
    for slug, b in base.items():
        a = alt[slug]
        eb, ea = dict(b["events"]), dict(a["events"])
        common = set(eb) & set(ea)
        relabelled = sorted(d for d in common if eb[d] != ea[d])
        sb, sa = summarize(b["result"]), summarize(a["result"])
        regime_sentence_b = _regime_sentences(sb["verdict"])
        regime_sentence_a = _regime_sentences(sa["verdict"])
        cells = {}
        for r in sorted(set(sb["split"]) | set(sa["split"])):
            cb, ca = sb["split"].get(r, {}), sa["split"].get(r, {})
            cells[r] = {"n_served": cb.get("n"), "n_alt": ca.get("n"),
                        "median_served": cb.get("median"), "median_alt": ca.get("median"),
                        "baseline_median_served": cb.get("baseline_median"), "baseline_median_alt": ca.get("baseline_median")}
        out[slug] = {
            "events": len(eb), "events_alt": len(ea), "events_relabelled": len(relabelled),
            "relabelled_share": round(len(relabelled) / len(common), 4) if common else None,
            "overall_n_20": (sb["overall_n"], sa["overall_n"]),
            "overall_median_20": (sb["overall_median"], sa["overall_median"]),
            "regime_cells_20": cells,
            "regime_verdict_changed": regime_sentence_b != regime_sentence_a,
            "regime_verdict_served": regime_sentence_b, "regime_verdict_alt": regime_sentence_a,
            "any_verdict_changed": sb["verdict"] != sa["verdict"],
        }
    return out


def regime_stats_for(db: Path, labels: dict[str, str | None] | None) -> dict:
    """`/regime`'s stats and changes count (api/desk_items_macro) on the
    stored rows with the given labels swapped in (None drops the row)."""
    from api import desk_items_macro as dm

    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = dm.regime_rows(conn)
        spx, vix = dm._levels(conn)
    finally:
        conn.close()
    if labels is not None:
        new = []
        for r in rows:
            if r["month"] in labels:
                if labels[r["month"]] is None:
                    continue
                r = {**r, "label": labels[r["month"]]}
            new.append(r)
        rows = new
    stats = dm.regime_stats(rows, spx, vix)
    n_changes = sum(1 for a, b in zip(rows, rows[1:]) if a["label"] != b["label"])
    return {"rows": stats["rows"], "changes": n_changes, "n_rows": len(rows)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--labels", required=True, type=Path)
    ap.add_argument("--histories", required=True, type=Path)
    ap.add_argument("--scratch", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)

    from src.desk import event_study as es

    h = pd.read_csv(a.histories, index_col=0)
    gov = {m: (lab if isinstance(lab, str) else None) for m, lab in h["at_governed_start"].items()}
    vdates, by_v = load_vintage_labels(a.labels)

    served = run_catalog(a.db)
    gov_db = make_scratch_db(a.db, a.scratch / "governed_start.db", gov)
    governed = run_catalog(gov_db)

    original = es.regime_at
    es.regime_at = point_in_time_regime_at(vdates, by_v, es.REGIME_LAG_MONTHS)
    try:
        pit = run_catalog(a.db)
    finally:
        es.regime_at = original

    res = {
        "governed_start_vs_served": compare(served, governed),
        "point_in_time_vs_served": compare(served, pit),
        "regime_stats": {"served": regime_stats_for(a.db, None), "governed_start": regime_stats_for(a.db, gov)},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "studies_summary.json").write_text(json.dumps(res, indent=2, default=str))
    for name in ("governed_start_vs_served", "point_in_time_vs_served"):
        print(f"\n== {name}")
        for slug, c in res[name].items():
            print(f"{slug:28s} events {c['events']:4d} relabelled {c['events_relabelled']:4d} ({c['relabelled_share']}) "
                  f"overall n20 {c['overall_n_20']} regime verdict changed {c['regime_verdict_changed']} any {c['any_verdict_changed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
