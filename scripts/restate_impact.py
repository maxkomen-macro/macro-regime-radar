#!/usr/bin/env python3
"""Compare a database before and after a market_daily restatement: prices,
returns and the downstream outputs that read market_daily.

Owner decision 2026-11-04 (option A): the restatement's impact is reported
before the published database changes. Run it on copies only:

    cp data/macro_radar.db /tmp/after.db
    python scripts/restate_market_daily.py --db /tmp/after.db --spy-splice --apply --snapshot /tmp/before.db
    python scripts/restate_impact.py --before /tmp/before.db --after /tmp/after.db --report impact.json

Both files are only read. Each downstream consumer runs its own code on a
temporary copy of each file (its writes land in the copy), and the two results
are compared:

* surprise: src/analytics/surprise.run, every derived_metrics row;
* backtest: src/analytics/backtest.run, every backtest_results row;
* risk: src/analytics/intelligence._compute_risk_indicators (SPY momentum).

The report is evidence for the owner's decision; it changes nothing.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

RETURN_TOL_PP = 1e-3   # percentage points. The stored adjusted SPY block carries float32 rounding: on the
                       # published copy (2026-11-04) its returns move by up to 1e-4pp with no dividend
DIFF_TOL = 1e-6        # a downstream value (a return as a fraction, a z-score, a hit rate) moving less is that same noise

WEEKLY_NOTE = (
    "Weekly surprise rows are week-ending buckets: src/analytics/surprise.py groups daily closes into weeks "
    "ending Friday (pandas W-FRI, last close), so a week still in progress carries that Friday's date. Its "
    "value runs from the previous week's last close to the newest stored close, the job stores that "
    "observation date beside it (<metric>_obs), the API serves it as as_of and the Markets screen labels the "
    "row 'week to <as_of>'. Every full run rebuilds the row until the week's last session completes it. The "
    "z-score compares the partial week with a 104-week window of mostly full weeks."
)


def _ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def _bars(path: Path) -> pd.DataFrame:
    with contextlib.closing(_ro(path)) as c:
        return pd.read_sql("SELECT symbol, date, open, high, low, close, volume FROM market_daily", c)


def price_changes(before: Path, after: Path) -> dict:
    a, b = _bars(before), _bars(after)
    m = a.merge(b, on=["symbol", "date"], how="outer", suffixes=("_before", "_after"), indicator=True)
    only = m[m["_merge"] != "both"]
    both = m[m["_merge"] == "both"].copy()
    cols = ["open", "high", "low", "close", "volume"]
    diff = pd.Series(False, index=both.index)
    for c in cols:
        x, y = both[f"{c}_before"], both[f"{c}_after"]
        diff |= (x - y).abs().gt(1e-9) | (x.isna() != y.isna())
    ch = both[diff].copy()
    ch["close_change_pct"] = (ch["close_after"] / ch["close_before"] - 1) * 100
    return {
        "rows_before": int(len(a)), "rows_after": int(len(b)),
        "rows_only_on_one_side": int(len(only)),
        "rows_changed": int(len(ch)),
        "by_symbol": {s: {"rows": int(len(g)), "first": g["date"].min(), "last": g["date"].max(),
                          "max_abs_close_change_pct": float(g["close_change_pct"].abs().max())}
                      for s, g in ch.groupby("symbol")},
        "rows": ch[["symbol", "date", "close_before", "close_after", "close_change_pct",
                    "volume_before", "volume_after"]].to_dict("records"),
    }


def return_changes(before: Path, after: Path, tol_pp: float = RETURN_TOL_PP) -> dict:
    def rets(df: pd.DataFrame) -> pd.DataFrame:
        df = df.sort_values(["symbol", "date"])
        return df.assign(ret_pct=df.groupby("symbol")["close"].pct_change() * 100)[["symbol", "date", "ret_pct"]]

    r = rets(_bars(before)).merge(rets(_bars(after)), on=["symbol", "date"], suffixes=("_before", "_after"))
    r = r.dropna()
    r["change_pp"] = r["ret_pct_after"] - r["ret_pct_before"]
    ch = r[r["change_pp"].abs() > tol_pp]
    return {
        "compared": int(len(r)), "changed": int(len(ch)),
        "changed_gt_0.01pp": int((ch["change_pp"].abs() > 0.01).sum()),
        "by_symbol": ch.groupby("symbol").size().astype(int).to_dict(),
        "rows": ch.reindex(ch["change_pp"].abs().sort_values(ascending=False).index).to_dict("records"),
    }


@contextlib.contextmanager
def _module_db(module, path: Path):
    old = module.DB_PATH
    module.DB_PATH = path
    try:
        yield
    finally:
        module.DB_PATH = old


def _surprise(path: Path) -> pd.DataFrame:
    from src.analytics import surprise

    with _module_db(surprise, path), contextlib.redirect_stdout(io.StringIO()):
        surprise.run()
    with contextlib.closing(sqlite3.connect(path)) as c:
        return pd.read_sql("SELECT name, date, value FROM derived_metrics", c)


def _backtest(path: Path) -> pd.DataFrame:
    from src.analytics import backtest

    with _module_db(backtest, path), contextlib.redirect_stdout(io.StringIO()):
        backtest.run()
    with contextlib.closing(sqlite3.connect(path)) as c:
        df = pd.read_sql("SELECT test_name, cohort, horizon, metric, value FROM backtest_results", c)
    return df.assign(name=df["test_name"] + "|" + df["horizon"] + "|" + df["metric"], date=df["cohort"])[
        ["name", "date", "value"]]


def _risk(path: Path) -> pd.DataFrame:
    from src.analytics import intelligence

    with contextlib.closing(sqlite3.connect(path)) as c:
        out = intelligence._compute_risk_indicators(c)
    return pd.DataFrame([{"name": k, "date": "", "value": float(v)} for k, v in out.items()])


CONSUMERS = {"surprise": _surprise, "backtest": _backtest, "risk": _risk}


def downstream(before: Path, after: Path, consumers: dict | None = None) -> dict:
    """Run each consumer on a temporary copy of each file and compare (name, date, value) rows."""
    out: dict = {}
    for label, fn in (consumers or CONSUMERS).items():
        with tempfile.TemporaryDirectory() as tmp:
            res = {}
            for side, src in (("before", before), ("after", after)):
                dst = Path(tmp) / f"{side}.db"
                shutil.copyfile(src, dst)
                try:
                    res[side] = fn(dst)
                except Exception as exc:  # reported, never swallowed
                    res[side] = f"{type(exc).__name__}: {exc}"
        if isinstance(res["before"], str) or isinstance(res["after"], str):
            out[label] = {"error_before": res["before"] if isinstance(res["before"], str) else None,
                          "error_after": res["after"] if isinstance(res["after"], str) else None}
            continue
        m = res["before"].merge(res["after"], on=["name", "date"], how="outer",
                                suffixes=("_before", "_after"), indicator=True)
        m["diff"] = m["value_after"] - m["value_before"]
        changed = m[(m["_merge"] != "both") | (m["diff"].abs() > DIFF_TOL)]
        per = {}
        for name, g in changed.groupby("name"):
            last = m[m["name"] == name].sort_values("date").iloc[-1]
            per[name] = {"rows_changed": int(len(g)), "max_abs_diff": float(g["diff"].abs().max()),
                         "only_on_one_side": int((g["_merge"] != "both").sum()),
                         "latest": {"date": last["date"], "before": None if pd.isna(last["value_before"]) else float(last["value_before"]),
                                    "after": None if pd.isna(last["value_after"]) else float(last["value_after"])}}
        out[label] = {"rows_compared": int(len(m)), "rows_changed": int(len(changed)), "by_name": per,
                      "rows": changed.drop(columns=["_merge"]).to_dict("records")}
    return out


def compare(before: Path, after: Path, consumers: dict | None = None) -> dict:
    return {"before": str(before), "after": str(after),
            "prices": price_changes(before, after), "returns": return_changes(before, after),
            "downstream": downstream(before, after, consumers), "weekly_label": WEEKLY_NOTE}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compare two database files after a market_daily restatement (read-only).")
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--report", default="", help="write the full comparison as JSON (a new file)")
    a = ap.parse_args(argv)
    before, after = Path(a.before), Path(a.after)
    if a.report and (Path(a.report).exists() or Path(a.report).is_symlink()):
        print(f"refusing: --report {a.report} already exists; name a new file", file=sys.stderr)
        return 2
    rep = compare(before, after)
    if a.report:
        with open(a.report, "x") as f:
            json.dump(rep, f, indent=1, default=str)
    p, r = rep["prices"], rep["returns"]
    print(f"prices: {p['rows_changed']} of {p['rows_before']} rows changed, {p['rows_only_on_one_side']} on one side only")
    for s, g in p["by_symbol"].items():
        print(f"  {s:<5} {g['rows']:>5} rows {g['first']}..{g['last']}  max |close change| {g['max_abs_close_change_pct']:.3f}%")
    print(f"returns: {r['changed']} of {r['compared']} daily returns changed ({r['changed_gt_0.01pp']} by more than 0.01pp)")
    for label, d in rep["downstream"].items():
        if "error_before" in d:
            print(f"{label}: error before={d['error_before']} after={d['error_after']}")
            continue
        print(f"{label}: {d['rows_changed']} of {d['rows_compared']} rows changed")
        for name, g in sorted(d["by_name"].items(), key=lambda kv: -kv[1]["max_abs_diff"])[:8]:
            print(f"  {name:<40} {g['rows_changed']:>5} rows, max |diff| {g['max_abs_diff']:.4g}, latest {g['latest']}")
    print(rep["weekly_label"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
