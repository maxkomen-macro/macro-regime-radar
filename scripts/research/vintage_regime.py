"""Regime labels under real-time data vintages (Desk plan D8, research only).

The served regime history (`regimes` table) is computed by `src/regime.py`
on today's download of INDPRO and CPIAUCSL: the latest vintage, revisions
included, for every month back to 1996. This replays the same classifier
(imported, never edited) on the data as ALFRED says it could have been
downloaded on each historical date, and measures:

* how many monthly labels differ from the served ones when each month is
  labelled with the data available when its two prints were first both out
  (`first_known`), or at the start of the month the label governs under the
  Desk's two-month lag (`at_governed_start`);
* which axis (growth from INDPRO, inflation from CPI) caused each flip;
* how often a month's label changed after first publication and how long it
  took to settle;
* labels computed from a pure first-release series (each month at its
  first print) for comparison;
* publication timing: when each month's row could first exist, and the
  months where the Desk's K-2 rule tags a session with a row that was not
  yet published.

Nothing here writes to the app database or changes anything served. The
replica is checked against the stored regimes rows before any number is
reported (`check_replica`).

Usage:
    FRED_API_KEY=... python3 -m scripts.research.vintage_regime \
        --cache DIR --db data/macro_radar.db --out DIR
"""
from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from scripts.research import alfred, safeio

# The window the served run used: the stored rows from the newest run start
# here (the 30-year lookback's start on the run date, see check_replica).
# Every replay uses the same start, so only the data vintage differs.
OBS_START = "1996-11-01"
LABELS = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
PROB_COLS = ("prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession")
OUTPUTS = ("regime_histories.csv", "regime_labels_by_vintage.csv.gz", "regime_summary.json")
LAG = 2  # src/desk/event_study.REGIME_LAG_MONTHS (asserted in main)


def classify(ind: pd.Series, cpi: pd.Series, start: str = OBS_START) -> pd.DataFrame:
    """src/regime.run_regime_classification on the two series from `start`,
    indexed by month (Period M)."""
    from src.regime import run_regime_classification

    df = run_regime_classification({"growth": ind[ind.index >= start], "inflation": cpi[cpi.index >= start]})
    df.index = pd.PeriodIndex(pd.to_datetime(df["date"]), freq="M")
    return df.drop(columns=["date"])


def replay_all(ind_t: pd.DataFrame, cpi_t: pd.DataFrame, start: str = OBS_START) -> dict[str, pd.DataFrame]:
    """The classifier's full output on every vintage date either series has
    from the first month it can label. Keyed by vintage date (ISO)."""
    vdates = sorted(set(alfred.vintage_dates(ind_t)) | set(alfred.vintage_dates(cpi_t)))
    vdates = [v for v in vdates if v >= start]
    out: dict[str, pd.DataFrame] = {}
    for v in vdates:
        ind, cpi = alfred.as_of(ind_t, v), alfred.as_of(cpi_t, v)
        if len(ind[ind.index >= start]) < 3 or len(cpi[cpi.index >= start]) < 3:
            continue
        out[v] = classify(ind, cpi, start)
    return out


def vintage_on(vdates: list[str], day: str) -> str | None:
    """The newest vintage date on or before `day`."""
    i = np.searchsorted(np.array(vdates), day, side="right") - 1
    return vdates[i] if i >= 0 else None


def first_known_dates(ind_t: pd.DataFrame, cpi_t: pd.DataFrame) -> pd.DataFrame:
    """Per month: INDPRO's and CPI's first publication dates and the later of
    the two (the first day the month's regimes row could exist)."""
    fi, fc = alfred.first_release(ind_t), alfred.first_release(cpi_t)
    df = pd.DataFrame({"indpro_published": fi["published"], "cpi_published": fc["published"]})
    df.index = df.index.to_period("M")
    df["row_known"] = df[["indpro_published", "cpi_published"]].max(axis=1, skipna=False)
    return df


def histories(reps: dict[str, pd.DataFrame], served: pd.DataFrame, known: pd.DataFrame) -> pd.DataFrame:
    """One row per served month: the served label and odds, the label when the
    row was first known, the label at the start of the month it governs (the
    vintage of the last day of month M+1), and the label's revision history."""
    vdates = sorted(reps)
    rows = []
    for m, srow in served.iterrows():
        rec = {"month": str(m), "served": srow["label"], "served_dom_prob": float(srow[list(PROB_COLS)].max())}
        for c in PROB_COLS:
            rec[f"served_{c}"] = float(srow[c])
        k = known.loc[m, "row_known"] if m in known.index else None
        rec["row_known"] = k if isinstance(k, str) else None
        if rec["row_known"]:
            v = vintage_on(vdates, rec["row_known"])
            r = reps.get(v)
            if r is not None and m in r.index:
                rec["first_known"] = r.loc[m, "label"]
                rec["first_known_vintage"] = v
                for c in PROB_COLS:
                    rec[f"first_{c}"] = float(r.loc[m, c])
                rec["first_growth_trend"] = float(r.loc[m, "growth_trend"])
                rec["first_inflation_trend"] = float(r.loc[m, "inflation_trend"])
        gov_eve = ((m + LAG).to_timestamp(how="start") - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        v2 = vintage_on(vdates, gov_eve)
        r2 = reps.get(v2) if v2 else None
        rec["at_governed_start"] = r2.loc[m, "label"] if (r2 is not None and m in r2.index) else None
        # every label the month carried, vintage by vintage, from first known on
        seq = [(v, reps[v].loc[m, "label"]) for v in vdates
               if rec.get("first_known_vintage") and v >= rec["first_known_vintage"] and m in reps[v].index]
        changes = [(a[0], b[0], a[1], b[1]) for a, b in zip(seq, seq[1:]) if a[1] != b[1]]
        rec["label_changes"] = len(changes)
        rec["last_change"] = changes[-1][1] if changes else None
        rec["n_labels_seen"] = len({lab for _, lab in seq})
        rec["served_growth_trend"] = float(srow["growth_trend"])
        rec["served_inflation_trend"] = float(srow["inflation_trend"])
        rows.append(rec)
    return pd.DataFrame(rows).set_index("month")


def attribution(reps_by_axis: dict[str, pd.Series], h: pd.DataFrame) -> dict:
    """Which axis flipped where first_known differs from served."""
    d = h.dropna(subset=["first_known"])
    diff = d[d["first_known"] != d["served"]]
    g = np.sign(diff["first_growth_trend"]) != np.sign(diff["served_growth_trend"])
    i = np.sign(diff["first_inflation_trend"]) != np.sign(diff["served_inflation_trend"])
    return {"growth_only": int((g & ~i).sum()), "inflation_only": int((i & ~g).sum()), "both": int((g & i).sum())}


def first_release_labels(ind_t: pd.DataFrame, cpi_t: pd.DataFrame) -> pd.Series:
    """Labels on series built from each month's first print (not a view anyone
    saw: the three months in a slope were each read at their own first print)."""
    fi, fc = alfred.first_release(ind_t)["value"], alfred.first_release(cpi_t)["value"]
    return classify(fi, fc)["label"]


def served_rows(db: Path) -> pd.DataFrame:
    """The stored regimes rows from the newest run (the rows older runs left
    behind before the window start are excluded: see check_replica)."""
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        df = pd.read_sql_query("SELECT * FROM regimes ORDER BY date", conn)
    finally:
        conn.close()
    df.index = pd.PeriodIndex(pd.to_datetime(df["date"]), freq="M")
    return df


def stored_inputs(db: Path) -> tuple[pd.Series, pd.Series]:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        def s(sid: str) -> pd.Series:
            r = conn.execute("SELECT date, value FROM raw_series WHERE series_id=? ORDER BY date", (sid,)).fetchall()
            return pd.Series([v for _, v in r], index=pd.to_datetime([d for d, _ in r]), dtype=float)
        return s("INDPRO"), s("CPIAUCSL")
    finally:
        conn.close()


def check_replica(db: Path, reps: dict[str, pd.DataFrame], ind_t: pd.DataFrame, cpi_t: pd.DataFrame) -> dict:
    """Two checks before any result: (1) the imported classifier on the
    stored inputs reproduces the stored rows of the newest run exactly;
    (2) ALFRED's latest vintage equals the stored inputs (so 'served' and
    'latest vintage' are the same data)."""
    stored = served_rows(db)
    newest_run = stored["computed_at"].max()
    run_rows = stored[stored["computed_at"] == newest_run]
    ind_db, cpi_db = stored_inputs(db)
    rep = classify(ind_db, cpi_db, OBS_START)
    common = run_rows.index.intersection(rep.index)
    lab_eq = int((run_rows.loc[common, "label"] == rep.loc[common, "label"]).sum())
    prob_err = (float(np.abs(run_rows.loc[common, list(PROB_COLS)].to_numpy() - rep.loc[common, list(PROB_COLS)].to_numpy()).max())
                if len(common) else float("inf"))
    li, lc = alfred.latest(ind_t), alfred.latest(cpi_t)
    def gap(a: pd.Series, b: pd.Series) -> dict:
        """Stored months from the window start, ALFRED months, months in both
        and the largest absolute difference over them (inf when none)."""
        a = a[a.index >= pd.Timestamp(OBS_START)]
        b = b[b.index >= pd.Timestamp(OBS_START)]
        j = a.index.intersection(b.index)
        err = float(np.abs(a.loc[j].to_numpy() - b.loc[j].to_numpy()).max()) if len(j) else float("inf")
        return {"stored_months": int(len(a)), "alfred_months": int(len(b)), "months": int(len(j)), "max_abs_diff": err}
    return {
        "newest_run_computed_at": newest_run, "newest_run_rows": int(len(run_rows)),
        "newest_run_first": str(run_rows.index.min()), "newest_run_last": str(run_rows.index.max()),
        "older_rows_left_from_earlier_runs": int(len(stored) - len(run_rows)),
        "replica_rows_compared": int(len(common)), "replica_labels_equal": lab_eq, "replica_max_prob_abs_err": prob_err,
        "alfred_latest_vs_stored": {"INDPRO": gap(ind_db, li), "CPIAUCSL": gap(cpi_db, lc)},
        "alfred_fetched_at_utc": {"INDPRO": ind_t.attrs.get("fetched_at_utc"), "CPIAUCSL": cpi_t.attrs.get("fetched_at_utc")},
    }


# Replica tolerances: the stored odds are rounded to 4 places by src/regime.py
# and recomputed by the same code here, and ALFRED serves the same decimals the
# store holds, so both gaps must be zero up to float noise.
REPLICA_TOL = 1e-9


class ReplicaMismatch(RuntimeError):
    """The replay does not reproduce the served rows, or ALFRED's latest
    vintage is not the stored data: no result may be reported (Codex S-1)."""


def enforce_replica(diag: dict, tol: float = REPLICA_TOL) -> None:
    """Raise unless the replica covers every row of the newest stored run with
    equal labels and odds, and ALFRED's latest vintage covers every stored
    input month with equal values."""
    problems = []
    n = diag["newest_run_rows"]
    if n == 0:
        problems.append("the newest stored run has no rows")
    if diag["replica_rows_compared"] != n:
        problems.append(f"replica covers {diag['replica_rows_compared']} of {n} stored rows")
    if diag["replica_labels_equal"] != diag["replica_rows_compared"]:
        problems.append(f"labels equal on {diag['replica_labels_equal']} of {diag['replica_rows_compared']} rows")
    if not diag["replica_max_prob_abs_err"] <= tol:
        problems.append(f"odds differ by up to {diag['replica_max_prob_abs_err']}")
    for sid, g in diag["alfred_latest_vs_stored"].items():
        if g["months"] != g["stored_months"] or g["months"] != g["alfred_months"]:
            problems.append(f"{sid}: {g['stored_months']} stored months, {g['alfred_months']} ALFRED months, {g['months']} in both")
        if not g["max_abs_diff"] <= tol:
            problems.append(f"{sid}: ALFRED's latest vintage differs from the store by up to {g['max_abs_diff']}")
    if problems:
        raise ReplicaMismatch("replica check failed: " + "; ".join(problems))


def timing(known: pd.DataFrame, months: pd.PeriodIndex) -> dict:
    """Publication timing of the regimes row stamped M."""
    k = known.loc[known.index.intersection(months)].copy()
    out_missing = [str(m) for m in months if m not in k.index or not isinstance(k.loc[m, "row_known"], str)]
    k = k[k["row_known"].map(lambda x: isinstance(x, str))]
    stamp = k.index.to_timestamp(how="start")
    month_end = k.index.to_timestamp(how="end").normalize()
    known_d = pd.to_datetime(k["row_known"])
    lag_from_stamp = (known_d - stamp).dt.days
    lag_from_end = (known_d - month_end).dt.days
    gov_start = (k.index + LAG).to_timestamp(how="start")
    late = k[known_d.to_numpy() >= gov_start.to_numpy()]
    ind_late = (pd.to_datetime(k["indpro_published"]) > pd.to_datetime(k["cpi_published"])).sum()
    return {
        "rows": int(len(k)),
        "days_from_stamp_to_known": {"min": int(lag_from_stamp.min()), "median": float(lag_from_stamp.median()), "max": int(lag_from_stamp.max())},
        "days_after_month_end": {"min": int(lag_from_end.min()), "median": float(lag_from_end.median()), "p95": float(lag_from_end.quantile(.95)), "max": int(lag_from_end.max())},
        "indpro_is_the_later_print": int(ind_late),
        "rows_not_known_by_governed_month_start": [
            {"row": str(m), "governs": str(m + LAG), "row_known": k.loc[m, "row_known"],
             "indpro_published": k.loc[m, "indpro_published"], "cpi_published": k.loc[m, "cpi_published"]}
            for m in late.index],
        "rows_never_published": out_missing,
    }


def agreement(h: pd.DataFrame, col: str) -> dict:
    d = h.dropna(subset=[col])
    diff = d[d[col] != d["served"]]
    trans = diff.groupby([col, "served"]).size().sort_values(ascending=False)
    by_period = {}
    for name, lo, hi in (("1997-2006", "1997-01", "2006-12"), ("2007-2016", "2007-01", "2016-12"),
                         ("2017-2026", "2017-01", "2026-12"), ("last 24 months", None, None)):
        if lo is None:
            dd = d.iloc[-24:]
        else:
            dd = d[(d.index >= lo) & (d.index <= hi)]
        by_period[name] = {"months": int(len(dd)), "differ": int((dd[col] != dd["served"]).sum())}
    return {"months": int(len(d)), "differ": int(len(diff)), "share": round(len(diff) / len(d), 4) if len(d) else None,
            "transitions_realtime_to_served": {f"{a} -> {b}": int(n) for (a, b), n in trans.items()},
            "by_period": by_period, "months_differing": diff.index.tolist()}


def label_changes(rows: list[str]) -> int:
    return sum(1 for a, b in zip(rows, rows[1:]) if a != b)


def run(cache: Path, db: Path, out: Path) -> dict:
    from src.desk import event_study as es

    assert es.REGIME_LAG_MONTHS == LAG, "the Desk's lag changed; re-read the study's timing section"
    outputs = [out / f for f in OUTPUTS]
    safeio.guard_outputs(db, outputs)  # Codex S-7: before any computation
    ind_t, cpi_t = alfred.load(cache, "INDPRO"), alfred.load(cache, "CPIAUCSL")
    reps = replay_all(ind_t, cpi_t)
    replica = check_replica(db, reps, ind_t, cpi_t)
    enforce_replica(replica)
    stored = served_rows(db)
    served = stored[stored["computed_at"] == stored["computed_at"].max()]
    known = first_known_dates(ind_t, cpi_t)
    h = histories(reps, served, known)
    fr = first_release_labels(ind_t, cpi_t)
    h["first_release_series"] = fr.reindex(pd.PeriodIndex(h.index, freq="M")).to_numpy()
    res = {
        "replica_check": replica,
        "vintages_replayed": len(reps),
        "first_known_vs_served": agreement(h, "first_known"),
        "at_governed_start_vs_served": agreement(h, "at_governed_start"),
        "first_release_series_vs_served": agreement(h, "first_release_series"),
        "axis_of_flip_first_known": attribution({}, h),
        "label_revisions_after_first_known": {
            "months_with_any_change": int((h["label_changes"] > 0).sum()),
            "months_changed_2plus_times": int((h["label_changes"] >= 2).sum()),
            "max_changes": int(h["label_changes"].max()),
        },
        "regime_changes_count": {
            "served": label_changes(h["served"].tolist()),
            "first_known": label_changes(h["first_known"].dropna().tolist()),
        },
        "dominant_prob_abs_diff_first_known": _prob_diff(h),
        "timing": timing(known, pd.PeriodIndex(h.index, freq="M")),
    }
    safeio.write_text(out / "regime_histories.csv", h.to_csv(), db=db)
    # the per-vintage label table, for the event-study and drill-down runs
    long = pd.concat({v: r["label"] for v, r in reps.items()}, names=["vintage", "month"]).rename("label")
    safeio.write_bytes(out / "regime_labels_by_vintage.csv.gz", gzip.compress(long.to_frame().to_csv().encode(), mtime=0), db=db)
    safeio.write_text(out / "regime_summary.json", json.dumps(res, indent=2, default=str), db=db)
    return res


def _prob_diff(h: pd.DataFrame) -> dict:
    d = h.dropna(subset=["first_known"])
    diffs = np.abs(d[[f"first_{c}" for c in PROB_COLS]].to_numpy() - d[[f"served_{c}" for c in PROB_COLS]].to_numpy()).max(axis=1)
    return {"months": int(len(d)), "mean_max_abs_diff": round(float(diffs.mean()), 4),
            "median": round(float(np.median(diffs)), 4), "p90": round(float(np.quantile(diffs, .9)), 4),
            "max": round(float(diffs.max()), 4), "months_over_0.20": int((diffs > 0.20).sum())}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    res = run(a.cache, a.db, a.out)
    print(json.dumps({k: v for k, v in res.items() if k not in ("first_known_vs_served",)}, indent=2, default=str)[:6000])
    print(json.dumps(res["first_known_vs_served"], indent=2, default=str)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
