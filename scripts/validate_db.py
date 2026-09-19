#!/usr/bin/env python3
"""Post-refresh validation gate for data/macro_radar.db (2026-09-06).

Runs after a refresh and before any upload. It never repairs anything; it
decides. Checks, in order:

  1. SQLite header + PRAGMA integrity_check.
  2. Required tables present; row counts and max dates per table.
  3. Against the previous snapshot (when given): no table's max date may
     regress, no core table may lose more than a fifth of its rows (the
     rolling-window tables market_intraday and news_feed are exempt), and
     the refresh must have changed something appropriate to its mode.
  4. Source labels on market_daily.
  5. Freshness SLAs through api/freshness.py — the same verdicts the
     running API reports — scoped to the mode (news-only judges news; full
     judges everything).

Output: a JSON report (--json), a GitHub Step Summary table (--summary, or
$GITHUB_STEP_SUMMARY), and exit 0 only when the verdict is "pass". A stale
verdict fails the run unless --allow-stale REASON documents why, in which
case the reason is printed in the summary. Nothing here prints a token.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import freshness as freshness_mod  # noqa: E402  (stdlib-only module)

REQUIRED_TABLES = ["regimes", "signals", "raw_series", "market_daily", "market_intraday", "news_feed"]
DATE_COLUMNS = {
    "regimes": "date",
    "signals": "date",
    "raw_series": "date",
    "market_daily": "date",
    "market_intraday": "ts",
    "news_feed": "published_at",
    "alert_feed": "date",
    "event_calendar": "event_datetime",
    "priced_metrics": "date",
    "macro_surprises": "date",
    "backtest_results": "date",
}
# Rolling-window tables shrink by design (intraday trimmed to 30 days, news
# aged out); their freshness is judged by max date, never by row count.
TRIMMED_TABLES = {"market_intraday", "news_feed"}
# Forward-looking by design: scheduled releases are dated ahead of the clock,
# so a future max date there is the table doing its job, not a fault.
FORWARD_TABLES = {"event_calendar"}
MODE_TABLES = {
    "full": ["raw_series", "regimes", "signals", "market_daily", "news_feed", "source_watermarks"],
    "news-only": ["news_feed"],
    "market-only": ["market_daily", "market_intraday", "source_watermarks"],
    # B6 (2026-09-18): intraday runs also capture the official close after the
    # session ends, so a daily close can be their change too.
    "intraday": ["market_intraday", "market_daily", "source_watermarks"],
    "verify-only": [],
}
MODE_FEEDS = {
    "full": {"regime", "signals", "market_daily", "news", "fred:INDPRO", "fred:CPIAUCSL", "fred:UNRATE", "fred:DGS10", "fred:DGS2", "fred:VIXCLS"},
    "news-only": {"news"},
    "market-only": {"market_daily", "market_intraday"},
    "intraday": {"market_intraday"},
    "verify-only": {"regime", "market_daily", "news"},
}
# Reported but never blocking in that mode: one missed post-close full run must
# not freeze intraday publishing (the full run owns the daily close).
WARN_FEEDS = {"intraday": {"market_daily"}}
# Content fingerprints (B6): row counts and max dates miss value-only updates
# (FRED rewrites the month-stamped row of the current month; a restatement
# rewrites closes in place). 16 hex chars; never served by the API.
FINGERPRINT_SQL = {
    "raw_series": "SELECT series_id, date, value FROM raw_series ORDER BY series_id, date",
    "market_daily": "SELECT symbol, date, close FROM market_daily ORDER BY symbol, date",
    "source_watermarks": "SELECT source, last_obs, last_value FROM source_watermarks ORDER BY source",
}
# A FRED series fetched within this window but not advancing is a source
# outage (a warning); one not checked at all means the refresh missed cycles.
OUTAGE_WINDOW = timedelta(hours=3)


def _fingerprint(conn: sqlite3.Connection, sql: str) -> str | None:
    try:
        h = hashlib.sha256()
        for row in conn.execute(sql):
            h.update(repr(tuple(row)).encode())
        return h.hexdigest()[:16]
    except sqlite3.Error:
        return None


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _header_ok(path: Path) -> bool:
    try:
        with open(path, "rb") as fh:
            return fh.read(16) == b"SQLite format 3\x00"
    except OSError:
        return False


def inspect(path: Path) -> dict:
    out: dict = {"path": str(path), "exists": path.exists(), "size": path.stat().st_size if path.exists() else 0}
    if not path.exists():
        out["error"] = "missing"
        return out
    if not _header_ok(path):
        out["error"] = "not a SQLite file"
        return out
    conn = _open(path)
    try:
        out["integrity"] = conn.execute("PRAGMA integrity_check").fetchone()[0]
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        out["tables"] = {}
        for t in tables:
            n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            col = DATE_COLUMNS.get(t)
            mx = None
            if col:
                try:
                    mx = conn.execute(f'SELECT MAX("{col}") FROM "{t}"').fetchone()[0]
                except sqlite3.Error:
                    mx = None
            out["tables"][t] = {"rows": int(n), "max": mx}
        try:
            out["market_sources"] = {r[0] or "null": int(r[1]) for r in conn.execute("SELECT source, COUNT(*) FROM market_daily GROUP BY source")}
        except sqlite3.Error:
            out["market_sources"] = {}
        try:
            out["series_latest"] = [dict(r) for r in conn.execute(
                "SELECT r.series_id, r.date, r.value FROM raw_series r JOIN (SELECT series_id, MAX(date) AS md FROM raw_series GROUP BY series_id) m ON r.series_id = m.series_id AND r.date = m.md"
            )]
        except sqlite3.Error:
            out["series_latest"] = []
        out["fingerprints"] = {t: _fingerprint(conn, sql) for t, sql in FINGERPRINT_SQL.items() if t in out["tables"]}
        out["watermarks"] = None
        if "source_watermarks" in out["tables"]:
            try:
                out["watermarks"] = {r["source"]: dict(r) for r in conn.execute(
                    "SELECT source, last_obs, last_value, advanced_at, checked_at, status, detail FROM source_watermarks")}
            except sqlite3.Error:
                out["watermarks"] = None
        out["fresh"] = {
            "regimes_date": out["tables"].get("regimes", {}).get("max"),
            "signals_date": out["tables"].get("signals", {}).get("max"),
            "market_daily_date": out["tables"].get("market_daily", {}).get("max"),
            "market_intraday_ts": out["tables"].get("market_intraday", {}).get("max"),
            "news_published_at": out["tables"].get("news_feed", {}).get("max"),
            "raw_series_date": out["tables"].get("raw_series", {}).get("max"),
        }
    finally:
        conn.close()
    return out


def validate(current: Path, previous: Path | None, mode: str, *, allow_stale: str = "", now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cur = inspect(current)
    prev = inspect(previous) if previous else None
    failures: list[str] = []
    warnings: list[str] = []

    if cur.get("error"):
        failures.append(f"database unusable: {cur['error']}")
        return {"verdict": "fail", "mode": mode, "failures": failures, "warnings": warnings, "current": cur, "previous": prev, "changed": False}
    if cur.get("integrity") != "ok":
        failures.append(f"integrity_check: {cur.get('integrity')}")
    for t in REQUIRED_TABLES:
        if t not in cur["tables"]:
            failures.append(f"missing table {t}")
        elif cur["tables"][t]["rows"] == 0:
            failures.append(f"table {t} is empty")

    # Stamps ahead of the clock are a fault, never freshness (review P2-3).
    horizon = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    for t, info in cur["tables"].items():
        if t in FORWARD_TABLES:
            continue
        mx = info.get("max")
        if mx and re.match(r"^\d{4}-\d{2}-\d{2}", str(mx)) and str(mx)[:10] > horizon:
            failures.append(f"{t}: max date {mx} is in the future")
    # Bounded value sanity on the two tables every screen reads.
    try:
        conn = _open(current)
        try:
            bad_prob = conn.execute(
                "SELECT COUNT(*) FROM regimes WHERE prob_goldilocks NOT BETWEEN 0 AND 1 OR prob_overheating NOT BETWEEN 0 AND 1 OR prob_stagflation NOT BETWEEN 0 AND 1 OR prob_recession NOT BETWEEN 0 AND 1"
            ).fetchone()[0]
            if bad_prob:
                failures.append(f"regimes: {bad_prob} row(s) with probabilities outside [0, 1]")
            bad_px = conn.execute("SELECT COUNT(*) FROM market_daily WHERE close IS NOT NULL AND close <= 0").fetchone()[0]
            if bad_px:
                failures.append(f"market_daily: {bad_px} row(s) with a non-positive close")
        finally:
            conn.close()
    except sqlite3.Error as exc:
        warnings.append(f"value sanity checks skipped: {type(exc).__name__}")

    changed = False
    changed_tables: list[str] = []
    if previous is not None and prev is not None and prev.get("error"):
        failures.append(f"previous snapshot unusable ({prev['error']}); refusing to publish without a baseline")
    if prev and not prev.get("error"):
        for t, info in cur["tables"].items():
            p = prev["tables"].get(t)
            if not p:
                if info["rows"] > 0:
                    changed_tables.append(t)  # a new, populated table is new content
                continue
            if info["max"] and p["max"] and str(info["max"]) < str(p["max"]):
                failures.append(f"{t}: max date regressed {p['max']} → {info['max']}")
            if t not in TRIMMED_TABLES and p["rows"] > 20 and info["rows"] < 0.8 * p["rows"]:
                failures.append(f"{t}: rows fell {p['rows']} → {info['rows']} (more than a fifth)")
            fp_cur = (cur.get("fingerprints") or {}).get(t)
            fp_prev = (prev.get("fingerprints") or {}).get(t)
            if info["rows"] != p["rows"] or str(info["max"]) != str(p["max"]) or (fp_cur and fp_prev and fp_cur != fp_prev):
                changed_tables.append(t)
        expected = MODE_TABLES.get(mode, [])
        touched = [t for t in expected if t in changed_tables]
        changed = bool(touched) if expected else bool(changed_tables)
        if expected and not touched:
            warnings.append(f"{mode}: none of {', '.join(expected)} changed against the previous snapshot — nothing new to publish")
    else:
        changed = True  # no baseline: treat as new

    # Freshness verdicts, scoped to what the mode is responsible for.
    marks = cur.get("watermarks")
    report = freshness_mod.assess(db_fresh=cur["fresh"], series_latest=cur.get("series_latest", []), relay=None, bootstrap=None, now=now, watermarks=marks)
    feeds = MODE_FEEDS.get(mode, set())
    warn_feeds = WARN_FEEDS.get(mode, set())
    rows = [r for r in report["sla"] if r["feed"] in feeds or r["feed"] in warn_feeds]
    for r in rows:
        if r["feed"] in warn_feeds and r["verdict"] != "current":
            warnings.append(f"{r['feed']} {r['verdict']} (reported, not judged in {mode} mode): {r['reason']}")
    rows_judged = [r for r in rows if r["feed"] not in warn_feeds]
    stale = [r for r in rows_judged if r["verdict"] in ("stale", "unavailable")]
    delayed = [r for r in rows_judged if r["verdict"] == "delayed"]

    def _checked_this_run(feed: str) -> bool:
        ts = freshness_mod._parse_dt(((marks or {}).get(feed) or {}).get("checked_at"))
        return ts is not None and now - ts <= OUTAGE_WINDOW

    # B6 outage policy: fetched this run but the source published nothing new
    # is a warning (a FRED pause must not block market and news publishing);
    # not checked at all stays a failure (the refresh missed its cycles).
    outages = [r for r in stale if r["feed"].startswith("fred:") and r["verdict"] == "stale" and _checked_this_run(r["feed"])]
    stale = [r for r in stale if r not in outages]
    for r in outages:
        warnings.append(f"{r['feed']} source outage (checked this run, not advancing): {r['reason']}")
    if mode == "full":
        for sid in freshness_mod.DAILY_INPUTS:
            if not (((marks or {}).get(f"fred:{sid}") or {}).get("last_obs")):
                failures.append(f"fred:{sid}: no watermark (true observation date) recorded by this refresh")
    if stale:
        msg = "; ".join(f"{r['feed']}: {r['reason']}" for r in stale)
        if allow_stale:
            warnings.append(f"outside SLA but allowed ({allow_stale}): {msg}")
        else:
            failures.append(f"outside SLA: {msg}")
    for r in delayed:
        warnings.append(f"{r['feed']} delayed: {r['reason']}")

    verdict = "fail" if failures else "pass"
    return {
        "verdict": verdict,
        "mode": mode,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "failures": failures,
        "warnings": warnings,
        "changed": changed,
        "changed_tables": changed_tables,
        "upload": verdict == "pass" and changed,
        "current": cur,
        "previous": prev,
        "sla": rows,
        "sla_all": report["sla"],
        "regime": report["regime"],
        "session": report["session"],
    }


def summary_markdown(rep: dict) -> str:
    cur = rep.get("current", {})
    prev = rep.get("previous") or {}
    lines = [
        f"## Refresh validation · mode `{rep['mode']}` · **{rep['verdict'].upper()}**",
        "",
        f"- Generated: {rep.get('generated_at')}",
        f"- Integrity: `{cur.get('integrity', cur.get('error'))}` · size {cur.get('size', 0):,} bytes",
        f"- Changed vs previous: {'yes' if rep.get('changed') else 'no'}{' (' + ', '.join(rep.get('changed_tables', [])) + ')' if rep.get('changed_tables') else ''}",
        f"- Upload: {'yes' if rep.get('upload') else 'no'}",
        f"- Market sources: {json.dumps(cur.get('market_sources', {}))}",
        f"- Session: {rep.get('session', {}).get('phase')} · last completed {rep.get('session', {}).get('last_completed_session')}",
        "",
        "| Table | Rows (prev → new) | Max (prev → new) |",
        "|---|---|---|",
    ]
    for t, info in sorted(cur.get("tables", {}).items()):
        p = (prev.get("tables") or {}).get(t, {})
        lines.append(f"| {t} | {p.get('rows', '—')} → {info['rows']} | {p.get('max', '—')} → {info['max']} |")
    lines += ["", "| Feed | Verdict | Latest | Expected | Reason |", "|---|---|---|---|---|"]
    for r in rep.get("sla", []):
        lines.append(f"| {r['feed']} | {r['verdict']} | {r['latest']} | {r['expected']} | {r['reason']} |")
    marks = cur.get("watermarks")
    if marks:
        lines += ["", "**Source watermarks** · newest observation per source and when it last advanced", "",
                  "| Source | Last observation | Advanced | Checked | Status |", "|---|---|---|---|---|"]
        for src, w in sorted(marks.items()):
            status = w.get("status") or ""
            if w.get("detail"):
                status += f" · {w['detail']}"
            lines.append(f"| {src} | {w.get('last_obs')} | {w.get('advanced_at')} | {w.get('checked_at')} | {status} |")
    reg = rep.get("regime") or {}
    if reg:
        lines += ["", f"- Regime month {reg.get('latest_month')} · expected {reg.get('expected_month')}"]
        for b in reg.get("blockers", []):
            lines.append(f"  - blocker {b['series']} ({b['label']}): latest {b['latest_month']} vs expected {b['expected_month']} — {b['cause']}")
    if rep.get("warnings"):
        lines += ["", "**Warnings**"] + [f"- {w}" for w in rep["warnings"]]
    if rep.get("failures"):
        lines += ["", "**Failures**"] + [f"- {f}" for f in rep["failures"]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--previous")
    ap.add_argument("--mode", choices=list(MODE_TABLES), default="full")
    ap.add_argument("--allow-stale", default="", help="documented reason to accept an outside-SLA snapshot")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    ap.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    a = ap.parse_args(argv)
    rep = validate(Path(a.db), Path(a.previous) if a.previous else None, a.mode, allow_stale=a.allow_stale)
    md = summary_markdown(rep)
    print(md)
    if a.summary:
        with open(a.summary, "a", encoding="utf-8") as fh:
            fh.write(md)
    if a.json_out:
        Path(a.json_out).write_text(json.dumps(rep, indent=2, default=str))
    if a.github_output:
        with open(a.github_output, "a", encoding="utf-8") as fh:
            fh.write(f"verdict={rep['verdict']}\nupload={'true' if rep.get('upload') else 'false'}\nchanged={'true' if rep.get('changed') else 'false'}\n")
    return 0 if rep["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
