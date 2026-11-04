"""The recession score under real-time data (Desk plan D8, research only).

`src/analytics/recession.py` fits a logistic model on today's database and
scores every month from features three rows earlier. Two of its five
features are revised after publication (UNRATE, INDPRO's 12-month change);
the target (USREC) is set by NBER months to years after the fact; and the
coefficients are fitted on the whole history, recessions the past did not
yet know about included. This measures, without touching the served model:

* `vintage_only`: the served model (today's fit) applied to each feature row
  as it was first published (UNRATE and INDPRO from ALFRED at the date both
  of the row's prints were out). Isolates the data-revision effect.
* `point_in_time`: on each such date, refit the same model on what was
  knowable then (vintage UNRATE and INDPRO, market series through that date,
  USREC as ALFRED served it that day) and score the row. Measured only from
  ALFRED's first USREC vintage (2011-05-02): before it the real-time target
  cannot be traced to a stored vintage here, so those rows are not scored.

The model's own code builds every frame and fit: `_load_raw` is swapped in
this process for one that serves the vintage (no file is edited), and
`train_recession_model` / `_build_feature_frame` run unchanged. The market
series (DGS10, DGS2, BAMLH0A0HYM2, T10YIE, T5YIE) are read from the store
as is: they are treated as unrevised, an assumption, not a measurement.

Usage:
    python3 -m scripts.research.vintage_recession --cache DIR --db data/macro_radar.db --out DIR
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pandas as pd

from scripts.research import alfred, safeio

VINTAGED = ("UNRATE", "INDPRO", "USREC")
OUTPUTS = ("recession_histories.csv", "recession_summary.json")
BAND_EDGES = (20.0, 40.0)  # percent: recession._classify_prob and desk_items_macro.RECESSION_BAND_EDGES


def band(p: float) -> str:
    return "low" if p < BAND_EDGES[0] else ("elevated" if p < BAND_EDGES[1] else "high")


@contextmanager
def vintage_loader(rec, tables: dict[str, pd.DataFrame], day: str | None, target_vintage: bool):
    """Swap recession._load_raw for one that serves UNRATE and INDPRO (and
    USREC when `target_vintage`) as published on `day`, and every series cut
    at `day`'s month. `day` None restores nothing but passes through."""
    original = rec._load_raw

    def load(series_id: str, conn: sqlite3.Connection, scale: float = 1.0) -> pd.Series:
        if day is not None and series_id in tables and (series_id != "USREC" or target_vintage):
            s = alfred.as_of(tables[series_id], day) * scale
        else:
            s = original(series_id, conn, scale)
        if day is not None and not s.empty:
            s = s[s.index <= pd.Timestamp(day)]
        return s

    rec._load_raw = load
    try:
        yield
    finally:
        rec._load_raw = original


def _frame(rec, conn) -> pd.DataFrame:
    features, _usrec, _yc = rec._build_feature_frame(conn)
    return features


def _score(model, scaler, row: pd.Series, names: list[str]) -> float:
    x = scaler.transform(row[names].to_numpy(dtype=float).reshape(1, -1))
    k = list(model.classes_).index(1)
    return float(model.predict_proba(x)[0, k] * 100.0)


REPLICA_TOL_PP = 1e-9


class ReplicaMismatch(RuntimeError):
    """The study's served series is not the module's (Codex S-1)."""


def enforce_replica(module: pd.Series, study: pd.Series, tol: float = REPLICA_TOL_PP) -> float:
    """Raise unless the study's served probability series has exactly the
    module's months and equals it within `tol`; return the largest gap."""
    if len(module) == 0 or not module.index.equals(study.index):
        raise ReplicaMismatch(f"served series covers {len(study)} months, the module's {len(module)}, "
                              f"{len(module.index.intersection(study.index))} in both")
    gap = float(np.abs(module.to_numpy(dtype=float) - study.to_numpy(dtype=float)).max())
    if not gap <= tol:  # also catches NaN
        raise ReplicaMismatch(f"served series differs from the module's by up to {gap} pp")
    return gap


def row_known_dates(tables: dict[str, pd.DataFrame]) -> pd.Series:
    """Per month-end row: the later of UNRATE's and INDPRO's first publication."""
    fu, fi = alfred.first_release(tables["UNRATE"]), alfred.first_release(tables["INDPRO"])
    k = pd.concat([fu["published"], fi["published"]], axis=1, sort=True).max(axis=1, skipna=False).dropna()
    k.index = k.index + pd.offsets.MonthEnd(0)
    return k


def run(cache: Path, db: Path, out: Path) -> dict:
    from src.analytics import recession as rec

    safeio.guard_outputs(db, [out / f for f in OUTPUTS])  # Codex S-7: before any computation
    rec.DB_PATH = db  # read-only either way (dbpath.connect_ro)
    tables = {s: alfred.load(cache, s) for s in VINTAGED}
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # Codex S-5: the cache must be the store's data before anything is scored
        store_check = {sid: alfred.store_gap(rec._load_raw(sid, conn), tables[sid]) for sid in VINTAGED}
        alfred.enforce_store_match(store_check)
        names = list(rec.FEATURE_NAMES)
        model, scaler, _ = rec.train_recession_model()
        served_feat = _frame(rec, conn)
        X = served_feat[names].shift(3).dropna()
        served = pd.Series(model.predict_proba(scaler.transform(X.to_numpy()))[:, list(model.classes_).index(1)] * 100.0,
                           index=X.index)
        served = served[served.index <= pd.Timestamp.today()]
        # the served headline as the module computes it, to pin the replica
        metrics = rec.get_recession_metrics()
        replica_gap = enforce_replica(metrics["recession_prob_series"], served)

        known = row_known_dates(tables)
        recs = []
        for p in served.index:
            pos = served_feat.index.get_loc(p)
            r = served_feat.index[pos - 3]  # the row the score reads (recession_provenance's rule)
            day = known.get(r)
            if not isinstance(day, str):
                continue
            with vintage_loader(rec, tables, day, target_vintage=False):
                feat_v = _frame(rec, conn)
            if r not in feat_v.index or feat_v.loc[r, names].isna().any():
                continue
            rec_row = {"month": p.strftime("%Y-%m"), "inputs_row": r.strftime("%Y-%m"), "row_known": day,
                       "served": float(served[p]), "vintage_only": _score(model, scaler, feat_v.loc[r], names),
                       "unrate_served": float(served_feat.loc[r, "unemployment"]), "unrate_first": float(feat_v.loc[r, "unemployment"]),
                       "indpro_yoy_served": float(served_feat.loc[r, "indpro_yoy"]), "indpro_yoy_first": float(feat_v.loc[r, "indpro_yoy"])}
            if day >= alfred.first_release(tables["USREC"])["published"].min():
                with vintage_loader(rec, tables, day, target_vintage=True):
                    m2, s2, _ = rec.train_recession_model()
                    feat_t = _frame(rec, conn)
                if m2 is not None and r in feat_t.index:
                    rec_row["point_in_time"] = _score(m2, s2, feat_t.loc[r], names)
            recs.append(rec_row)
    finally:
        conn.close()

    df = pd.DataFrame(recs).set_index("month")
    safeio.write_text(out / "recession_histories.csv", df.to_csv(), db=db)

    def cmp(col: str) -> dict:
        d = df.dropna(subset=[col])
        diff = (d[col] - d["served"]).abs()
        bands = d[col].map(band) != d["served"].map(band)
        return {"months": int(len(d)), "from": d.index.min(), "to": d.index.max(),
                "abs_diff_pp": {"mean": round(float(diff.mean()), 2), "median": round(float(diff.median()), 2),
                                "p90": round(float(diff.quantile(.9)), 2), "max": round(float(diff.max()), 2),
                                "max_month": diff.idxmax()},
                "band_differs": int(bands.sum()), "band_differs_months": d.index[bands].tolist(),
                "transitions_alt_to_served": {f"{a} -> {b}": int(n) for (a, b), n in
                                              pd.crosstab(d.loc[bands, col].map(band), d.loc[bands, "served"].map(band)).stack().items() if n},
                "latest": {"month": d.index[-1], "served": round(float(d["served"].iloc[-1]), 1), "alt": round(float(d[col].iloc[-1]), 1)}}

    res = {
        "replica_max_abs_gap_pp": replica_gap,
        "alfred_latest_vs_stored": store_check,
        "served_training": {"n": int(metrics["training_n"]), "window": metrics["training_window"],
                            "recessions": metrics["training_recessions"]},
        "vintage_only_vs_served": cmp("vintage_only"),
        "point_in_time_vs_served": cmp("point_in_time") if "point_in_time" in df else None,
        "feature_revisions": {
            "unrate_abs_pp": {"mean": round(float((df.unrate_first - df.unrate_served).abs().mean()), 3),
                              "max": round(float((df.unrate_first - df.unrate_served).abs().max()), 3)},
            "indpro_yoy_abs_pp": {"mean": round(float((df.indpro_yoy_first - df.indpro_yoy_served).abs().mean()), 3),
                                  "max": round(float((df.indpro_yoy_first - df.indpro_yoy_served).abs().max()), 3)},
        },
        "usrec_first_vintage": alfred.first_release(tables["USREC"])["published"].min(),
        "alfred_fetched_at_utc": {s: t.attrs.get("fetched_at_utc") for s, t in tables.items()},
    }
    safeio.write_text(out / "recession_summary.json", json.dumps(res, indent=2, default=str), db=db)
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    print(json.dumps(run(a.cache, a.db, a.out), indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
