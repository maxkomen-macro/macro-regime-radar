#!/usr/bin/env python3
"""Restate stored market_daily bars onto one price basis: the traded close.

market_daily holds daily bars unadjusted for distributions (Yahoo's Close,
which Yahoo adjusts for splits only; Polygon's closes before 2026-05-27 are
the same basis). Owner decision 2026-11-04 (option A): a consistently
unadjusted history, corrected here and nowhere else. Two known defects:

* Mid-session closes (B6, 2026-09-18). main's morning full runs of
  2026-09-01, 09-02, 09-03 and 09-10 landed during the US session and stored
  unfinished bars with partial volume for all 23 daily symbols (SPY 2026-09-03
  is stored at 768.66 against the provider's finished-session close of 773.17). src/market_data/session.py
  stops new ones. Default mode.
* The SPY splice (--spy-splice). SPY's rows from 1993-01-29 to 2024-02-26 came
  from a Yahoo backfill of 2026-03-13 with auto_adjust=True, so they are
  dividend-adjusted as of that day, and Polygon's traded closes start on
  2024-02-27: a false +2.66% day (the true move is +0.19%) and a mixed basis.
  This replaces the 7,824 rows with Yahoo's unadjusted bars.

Safeguards, all checked before anything is written; any failure refuses the
whole run (no partial restatement):

* the session of every named date is complete (bar_is_complete);
* every target row (an existing row; restating never inserts) has a fetched
  bar with a finite, positive close;
* basis check: up to ANCHORS stored rows next to each block of targets, which
  are not being restated, must match the same fetch within BASIS_TOL in log
  terms, so the fetch is on the stored basis (a dividend-adjusted fetch, the
  old script's mistake, would write closes up to 0.59% off and fails here).
  This is a consistency check inside one provider, not an independent source
  check: the report says so;
* --apply needs an empty write-ahead log, copies the database file byte for
  byte to a snapshot (sha256 checked) before the first write, writes in one
  transaction, and reads every row back.

Owner decision 2026-09-18 and 2026-11-04: written and tested here, never run
against the published database by a session. Applying and publishing is the
owner's separate decision, after the dry-run impact report.
Procedure (owner):
    make sync-data                                                      # validated local copy
    python scripts/restate_market_daily.py --report restate-sept.json   # dry run
    python scripts/restate_market_daily.py --spy-splice --report restate-spy.json
    python scripts/restate_market_daily.py --apply ...                  # same flags; snapshot first
    python scripts/restate_impact.py --before <snapshot> --after data/macro_radar.db --report impact.json
    python scripts/validate_db.py data/macro_radar.db --previous <snapshot> --mode market-only
    # then publish the validated file the usual way; the market_daily
    # fingerprint in validate_db marks the in-place change as a change.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data.session import bar_is_complete  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
BAD_CLOSE_DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10"]
SPY_SPLICE = ("SPY", "1993-01-29", "2024-02-26")
BASIS = "unadjusted for distributions (Yahoo Close: split-adjusted only)"
BASIS_TOL = 2e-4   # |log(stored / fetched)| on an anchor row. Measured 2026-11-04 (data-latest of that
                   # morning) over the 8,503 stored rows since 2024-02-27 outside the four dates: at most 6.5e-5
ANCHORS = 3        # stored rows checked on each side of a block of targets, where they exist
FIELDS = ("open", "high", "low", "close", "volume")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _open(path: Path, apply: bool) -> sqlite3.Connection:
    conn = sqlite3.connect(path) if apply else sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _stored(conn: sqlite3.Connection, symbol: str) -> dict[str, dict]:
    return {r["date"]: dict(r) for r in conn.execute(
        "SELECT date, open, high, low, close, volume FROM market_daily WHERE symbol = ? ORDER BY date", (symbol,))}


def _anchor_dates(all_dates: list[str], targets: set[str]) -> list[str]:
    """Up to ANCHORS stored, non-target dates on each side of every run of targets."""
    out: set[str] = set()
    idx = [i for i, d in enumerate(all_dates) if d in targets]
    runs: list[tuple[int, int]] = []
    for i in idx:
        if runs and i == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], i)
        else:
            runs.append((i, i))
    for a, b in runs:
        out.update(d for d in all_dates[max(0, a - ANCHORS):a] if d not in targets)
        out.update(d for d in all_dates[b + 1:b + 1 + ANCHORS] if d not in targets)
    return sorted(out)


def _bars(client, symbol: str, start: str, end: str) -> dict[str, dict]:
    df = client.fetch_daily(symbol, start, end, auto_adjust=False)
    out: dict[str, dict] = {}
    if df is None or df.empty:
        return out
    for r in df.itertuples(index=False):
        out[str(r.date)[:10]] = {f: (None if getattr(r, f) is None else float(getattr(r, f))) for f in FIELDS}
    return out


def _good(x) -> bool:
    return x is not None and math.isfinite(x) and x > 0


def _usable(b: dict | None) -> bool:
    """Every field written must be usable: prices finite and positive, volume finite and not negative."""
    return (b is not None and all(_good(b[f]) for f in ("open", "high", "low", "close"))
            and b["volume"] is not None and math.isfinite(b["volume"]) and b["volume"] >= 0)


def restate(db_path: Path, dates: list[str], symbols: list[str], client, *, ranges=(), apply: bool = False,
            now: datetime | None = None, snapshot: Path | None = None) -> dict:
    """Plan (and with apply=True, write) the restatement; return the report.

    `dates` x `symbols` names mid-session rows; each of `ranges` is
    (symbol, first date, last date), every stored row inside it. A row that is
    not stored is never inserted. Raises SystemExit, with nothing written,
    when any safeguard fails; report["problems"] lists them all."""
    now = now or datetime.now(timezone.utc)
    db_path = Path(db_path)
    problems: list[str] = []
    for d in dates:
        if not bar_is_complete(date.fromisoformat(d), now):
            problems.append(f"{d}: its session is not complete yet")
    report: dict = {"db": str(db_path), "db_sha256": _sha256(db_path), "generated_at": now.isoformat(),
                    "basis": BASIS, "basis_tol": BASIS_TOL,
                    "source_check": "consistency inside one provider (Yahoo): anchors on the stored basis; "
                                    "not an independent or exchange-official source check",
                    "rows": [], "returns": [], "anchors": [], "problems": problems, "applied": False}
    conn = _open(db_path, apply=False)
    try:
        wanted: dict[str, dict[str, str]] = {}   # symbol -> {date: why it is restated}
        for symbol in symbols:
            stored = _stored(conn, symbol)
            for d in dates:
                if d in stored:
                    wanted.setdefault(symbol, {})[d] = "mid-session"
        for symbol, first, last in ranges:
            stored = _stored(conn, symbol)
            hits = [d for d in stored if first <= d <= last]
            if not hits:
                problems.append(f"{symbol} {first}..{last}: no stored rows")
                continue
            for d in hits:
                wanted.setdefault(symbol, {})[d] = "splice"
        for symbol, kinds in sorted(wanted.items()):
            targets = set(kinds)
            stored = _stored(conn, symbol)
            all_dates = list(stored)
            anchors = _anchor_dates(all_dates, targets)
            if not anchors:
                problems.append(f"{symbol}: no stored neighbour to check the fetched basis against")
            span = sorted(targets | set(anchors))
            bars = _bars(client, symbol, span[0], span[-1])
            for d in anchors:
                b = bars.get(d)
                if b is None or not _good(b["close"]):
                    problems.append(f"{symbol} {d}: anchor row has no fetched bar")
                    continue
                err = math.log(stored[d]["close"] / b["close"])
                report["anchors"].append({"symbol": symbol, "date": d, "stored_close": stored[d]["close"],
                                          "fetched_close": b["close"], "log_diff": err})
                if abs(err) > BASIS_TOL:
                    problems.append(f"{symbol} {d}: stored {stored[d]['close']:.4f} vs fetched {b['close']:.4f} "
                                    f"({err * 100:+.3f}%): the fetch is not on the stored basis")
            for d in sorted(targets):
                b = bars.get(d)
                if not _usable(b):
                    problems.append(f"{symbol} {d}: no usable fetched bar for a target row")
                    continue
                old = {f: stored[d][f] for f in FIELDS}
                changed = any(old[f] is None or b[f] is None or abs(old[f] - b[f]) > 1e-9 for f in FIELDS)
                report["rows"].append({"symbol": symbol, "date": d, "kind": kinds[d], "stored": old, "new": b,
                                       "stored_close": old["close"], "provider_close": b["close"],
                                       "close_change_pct": (b["close"] / old["close"] - 1) * 100 if _good(old["close"]) else None,
                                       "changed": changed})
            # every close-to-close return the restatement changes: into each target row and
            # out of it into the next stored row (a return between two targets counts once)
            new_close = {d: stored[d]["close"] for d in all_dates}
            new_close.update({r["date"]: r["new"]["close"] for r in report["rows"]
                              if r["symbol"] == symbol and r["date"] in targets})
            pos = {d: i for i, d in enumerate(all_dates)}
            touched = sorted({all_dates[i] for d in targets for i in (pos[d], pos[d] + 1)
                              if 0 < i < len(all_dates)})
            for d in touched:
                p = all_dates[pos[d] - 1]
                if not (_good(stored[p]["close"]) and _good(stored[d]["close"])):
                    continue
                before = stored[d]["close"] / stored[p]["close"] - 1
                after = new_close[d] / new_close[p] - 1
                if abs(after - before) > 1e-5:   # 1e-3pp: the adjusted block's float32 rounding moves returns up to 1e-4pp
                    report["returns"].append({"symbol": symbol, "date": d, "prev_date": p,
                                              "before_pct": before * 100, "after_pct": after * 100,
                                              "change_pp": (after - before) * 100})
    finally:
        conn.close()
    if problems:
        raise SystemExit("refusing, nothing written:\n  " + "\n  ".join(problems))
    if not apply:
        return report
    wal = db_path.with_name(db_path.name + "-wal")
    if wal.exists() and wal.stat().st_size > 0:
        raise SystemExit(f"refusing, nothing written: {wal} holds uncheckpointed writes; checkpoint the database first")
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snap = Path(snapshot) if snapshot else db_path.with_name(f"{db_path.stem}.pre-restate-{stamp}{db_path.suffix}")
    if snap.exists() or snap.is_symlink():
        raise SystemExit(f"refusing, nothing written: snapshot {snap} already exists")
    sidecars = [db_path] + [db_path.with_name(db_path.name + x) for x in ("-wal", "-shm", "-journal")]
    if any(snap.resolve() == k.resolve() for k in sidecars):
        raise SystemExit(f"refusing, nothing written: snapshot {snap} names the database or a SQLite sidecar")
    if not snap.resolve().parent.is_dir():
        raise SystemExit(f"refusing, nothing written: snapshot {snap}: its folder does not exist")
    shutil.copyfile(db_path, snap)
    if _sha256(snap) != report["db_sha256"]:
        raise SystemExit(f"refusing, nothing written: snapshot {snap} does not match the database")
    report["snapshot"], report["snapshot_sha256"] = str(snap), report["db_sha256"]
    fetched_at = now.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
    todo = [r for r in report["rows"] if r["changed"]]
    conn = _open(db_path, apply=True)
    try:
        with conn:
            for r in todo:
                n = r["new"]
                conn.execute("UPDATE market_daily SET open = ?, high = ?, low = ?, close = ?, volume = ?, fetched_at = ?"
                             " WHERE symbol = ? AND date = ?",
                             (n["open"], n["high"], n["low"], n["close"], n["volume"], fetched_at, r["symbol"], r["date"]))
        for r in todo:
            got = conn.execute("SELECT open, high, low, close, volume FROM market_daily WHERE symbol = ? AND date = ?",
                               (r["symbol"], r["date"])).fetchone()
            if got is None or any(got[f] != r["new"][f] for f in FIELDS):
                raise SystemExit(f"read-back mismatch at {r['symbol']} {r['date']}; restore {snap}")
    finally:
        conn.close()
    report["applied"] = True
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Restate market_daily bars onto the unadjusted basis (dry run by default).")
    ap.add_argument("--dates", default=",".join(BAD_CLOSE_DATES), help="comma-separated YYYY-MM-DD (default: the four known dates)")
    ap.add_argument("--no-dates", action="store_true", help="restate no named dates (with --spy-splice: the splice only)")
    ap.add_argument("--symbols", default="", help="comma-separated symbols (default: every daily symbol in config/assets.yml)")
    ap.add_argument("--spy-splice", action="store_true", help=f"also replace {SPY_SPLICE[0]} {SPY_SPLICE[1]}..{SPY_SPLICE[2]}")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--report", default="", help="write the full report (every row, anchor and problem) as JSON")
    ap.add_argument("--snapshot", default="", help="snapshot path for --apply (default: beside the database)")
    ap.add_argument("--apply", action="store_true", help="overwrite the rows; without it nothing is written")
    a = ap.parse_args(argv)
    a.dates = [] if a.no_dates else [d.strip() for d in a.dates.split(",") if d.strip()]
    a.symbols = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    return a


def _report_path_problem(report: str, db: str, snapshot: str) -> str | None:
    """--report must name a new file that is none of the files the run reads or keeps:
    the database, its SQLite sidecars, the snapshot, or a default snapshot name."""
    rp, dbp = Path(report), Path(db)
    if rp.exists() or rp.is_symlink():
        return f"--report {rp} already exists; name a new file"
    if not rp.resolve().parent.is_dir():
        return f"--report {rp}: its folder does not exist"
    keep = [dbp] + [dbp.with_name(dbp.name + x) for x in ("-wal", "-shm", "-journal")]
    if snapshot:
        keep.append(Path(snapshot))
    if any(rp.resolve() == k.resolve() for k in keep) or (
            rp.resolve().parent == dbp.resolve().parent and rp.name.startswith(f"{dbp.stem}.pre-restate-")):
        return f"--report {rp} names the database, a sidecar or a snapshot"
    return None


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    if a.report:
        why = _report_path_problem(a.report, a.db, a.snapshot)
        if why:
            print(f"refusing, nothing written: {why}", file=sys.stderr)
            return 2
    symbols = a.symbols
    if not symbols:
        import yaml

        symbols = yaml.safe_load((ROOT / "config" / "assets.yml").read_text()).get("daily", [])
    from src.market_data.yfinance_client import YFinanceClient

    ranges = [SPY_SPLICE] if a.spy_splice else []
    try:
        rep = restate(Path(a.db), a.dates, symbols, YFinanceClient(), ranges=ranges, apply=a.apply,
                      snapshot=Path(a.snapshot) if a.snapshot else None)
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 2
    if a.report:
        with open(a.report, "x") as f:   # exclusive: never replaces a file created meanwhile
            json.dump(rep, f, indent=1)
    shown = [r for r in rep["rows"] if r["kind"] != "splice"][:200]
    print(f"{'symbol':<6} {'date':<10} {'stored':>10} {'provider':>10} {'change':>8}")
    for r in shown:
        print(f"{r['symbol']:<6} {r['date']:<10} {r['stored_close']:>10.4f} {r['provider_close']:>10.4f} {r['close_change_pct']:>+7.3f}%")
    spl = [r for r in rep["rows"] if r["kind"] == "splice"]
    if spl:
        print(f"splice: {len(spl)} rows of {spl[0]['symbol']} {spl[0]['date']}..{spl[-1]['date']} (full list in --report)")
    worst = max((abs(x["log_diff"]) for x in rep["anchors"]), default=0.0)
    print(f"basis check: {len(rep['anchors'])} anchor rows, max |log diff| {worst:.2e} (limit {BASIS_TOL:g}); {rep['source_check']}")
    if rep["returns"]:
        big = max(rep["returns"], key=lambda x: abs(x["change_pp"]))
        print(f"returns: {len(rep['returns'])} close-to-close returns change; largest {big['symbol']} {big['date']} "
              f"{big['before_pct']:+.3f}% -> {big['after_pct']:+.3f}% (every one in --report)")
    n = sum(r["changed"] for r in rep["rows"])
    print(f"{n} of {len(rep['rows'])} target rows differ; " + (f"written, snapshot {rep['snapshot']}" if rep["applied"] else "dry run, nothing written."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
