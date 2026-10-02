#!/usr/bin/env python3
"""Post-refresh validation gate for data/macro_radar.db (2026-09-06).

Runs after a refresh and before any upload. It never repairs anything; it
decides. Checks, in order:

  1. SQLite header + PRAGMA integrity_check, and the mandatory checks
     (Codex R-09): the Desk's per-series rows, non-numeric values and
     malformed dates, and the value sanity checks (probabilities in [0, 1],
     positive closes), each run on its own (verifier V-33). One that cannot
     run is "not executed" and fails, whatever the mode, and so does one of
     the previous snapshot's, whose integrity must hold too (verifier V-32).
  2. Required tables present; row counts and max dates per table.
  3. Against the previous snapshot (when given): no table's max date may
     regress (the forward-looking event_calendar only warns: a rescheduled
     event can move its latest date in), no core table may lose more than
     a fifth of its rows (the rolling-window tables market_intraday and
     news_feed are exempt), and the refresh must have changed something
     appropriate to its mode.
  4. Source labels on market_daily.
  5. Freshness SLAs through api/freshness.py — the same verdicts the
     running API reports — scoped to the mode (news-only judges news; full
     judges everything).

The Desk's daily series (desk_series) are judged by tier (desk/hardening,
2026-09-23). Tier 1 blocks, series by series before any table-wide check
(review R-02): a tier-1 series missing, losing more than 1% of its rows or
moving its newest date earlier against the previous snapshot fails on its
own, and a future-dated one fails (R-03); the table must exist and hold
rows, and the table-wide date and row checks run over the tier-1 series. A
tier-2 series that is missing, short, failed, behind, future-dated (the store
excludes such rows, R-03), holding a non-numeric value or a malformed date
(the engine sets such a row aside on read, verifiers V-14 and V-22; tier 1
fails on it), or that lost rows
or moved its newest date earlier is a warning, never a failure, so it can
never hold the full refresh's publish back. The tiers are the registry's, read through
api/freshness.DESK_REFRESH_SERIES (this script stays stdlib + api/). In a store with
provenance (Codex R-14, api/provenance.py), a row no committed refresh wrote, or dated
after the New York date of the refresh that committed it, fails for tier 1 and is
reported for any other; a store not yet migrated reads as the migration would leave it.

The preset baskets' share counts (`share_counts`, desk/cap-weight) are advisory
(ADVISORY_TABLES): a full refresh whose share counts changed publishes, but the
table being absent or empty, a partial or failed fetch (its watermark), a date
that moved earlier, rows that fell, a row the API sets aside, or a query on the
table that cannot run is a warning, never a failure.

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
from api import provenance  # noqa: E402  (stdlib-only module; Codex R-14)

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
    # Codex R-17: the table has computed_at and no `date` column; MAX("date") compared the literal string
    "backtest_results": "computed_at",
    # fix/prelaunch-1: allocation's price histories, stored by the full refresh
    "asset_prices": "date",
    # desk/event-study: the Desk's daily series (src/market_data/desk_history.py)
    "desk_series": "date",
    # desk/cap-weight: the preset baskets' share counts (src/market_data/share_counts.py), advisory
    "share_counts": "as_of",
}
# desk/cap-weight: tables a refresh publishes when they change but whose state never fails a database.
# Absent, partly fetched, regressed, emptied or holding a row the API sets aside: each is a warning, and a
# query on them that cannot run is a warning too (never "not executed"). Basket & Hedge's cap weight is
# the only reader, and it says it is unavailable, with the reason, when the counts are not there.
ADVISORY_TABLES = {"share_counts"}
ADVISORY_FINGERPRINT_SQL = {
    "share_counts": "SELECT symbol, shares_outstanding, as_of, source FROM share_counts ORDER BY symbol",
}
# Rolling-window tables shrink by design (intraday trimmed to 30 days, news
# aged out); their freshness is judged by max date, never by row count.
TRIMMED_TABLES = {"market_intraday", "news_feed"}
# Forward-looking by design: scheduled releases are dated ahead of the clock,
# so a future max date there is the table doing its job, not a fault. B5
# (2026-09-19): nor is a max date that moves earlier, since a rescheduled
# earnings report can pull the table's latest date in; that is a warning.
FORWARD_TABLES = {"event_calendar"}
# B4 (2026-09-18): ai_spend_ledger is append-only; a run that spent must
# publish its rows or the next run (which downloads the published DB) forgets
# the spend, so new ledger rows count as a change in the modes that enrich.
MODE_TABLES = {
    # Codex R-20: desk_series_runs too, so a refresh that only restores rows' provenance publishes;
    # desk/cap-weight: share_counts, so a refresh whose only news is a new share count publishes it
    "full": ["raw_series", "regimes", "signals", "market_daily", "news_feed", "source_watermarks", "ai_spend_ledger", "asset_prices", "desk_series",
             "desk_series_runs", "share_counts"],
    "news-only": ["news_feed", "ai_spend_ledger"],
    "market-only": ["market_daily", "market_intraday", "source_watermarks"],
    # B6 (2026-09-18): intraday runs also capture the official close after the
    # session ends, so a daily close can be their change too.
    "intraday": ["market_intraday", "market_daily", "source_watermarks"],
    "verify-only": [],
}
MODE_FEEDS = {
    "full": {"regime", "signals", "market_daily", "news", "fred:INDPRO", "fred:CPIAUCSL", "fred:UNRATE", "fred:DGS10", "fred:DGS2", "fred:VIXCLS", "asset_prices", "desk_series"},
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
    # Adjusted closes are restated back through history after every dividend. inspect() replaces this
    # with _asset_prices_fingerprint, which adds the table's columns and every stored column, volume
    # included (desk/fill-etf, Codex R-02); this query is the layout that predates the volume column.
    "asset_prices": "SELECT symbol, interval, date, close FROM asset_prices ORDER BY symbol, interval, date",
    # FRED revises a daily observation in place (desk/event-study); inspect() replaces this with
    # _desk_fingerprints, which adds each row's readability (Codex R-20, V-39)
    "desk_series": "SELECT series_id, date, value FROM desk_series ORDER BY series_id, date",
    # the refresh runs (Codex R-14); a change only alongside what the Desk reads (V-40)
    "desk_series_runs": "SELECT run_id, as_of, status FROM desk_series_runs ORDER BY run_id",
}
# Feeds whose "checked this run, not advancing" is a source outage (a warning)
# rather than a missed cycle (a failure): the FRED series and, since
# fix/prelaunch-1, the stored asset histories.
OUTAGE_FEEDS = ("fred:", "asset_prices", "desk_series")
# A FRED series fetched within this window but not advancing is a source
# outage (a warning); one not checked at all means the refresh missed cycles.
OUTAGE_WINDOW = timedelta(hours=3)
# Mirror of src/analytics/ai_spend.MONTHLY_CAP_USD (pinned equal by
# tests/test_news_budget.py); this script stays stdlib + api/.
AI_MONTHLY_CAP_USD = 50.0


def _ai_spend(path: Path, now: datetime) -> dict:
    """Month-to-date AI spend and call count from ai_spend_ledger (current UTC month).
    A query that fails raises: the caller reports it "not executed" (Codex R-27 audit)."""
    month = now.strftime("%Y-%m")
    conn = _open(path)
    try:
        cost, calls = conn.execute(
            "SELECT COALESCE(SUM(cost_usd), 0), COALESCE(SUM(provider <> 'budget'), 0)"
            " FROM ai_spend_ledger WHERE month = ?",
            (month,),
        ).fetchone()
    finally:
        conn.close()
    return {"month": month, "cost_usd": float(cost or 0.0), "calls": int(calls or 0), "cap_usd": AI_MONTHLY_CAP_USD}


def _desk_fingerprints(conn: sqlite3.Connection, as_of: str) -> tuple[str, dict[str, str]]:
    """desk_series as the Desk reads it (Codex R-20; verifiers V-39, V-40, V-49,
    V-56): each row's date, its value, and its readability flag, hashed for every
    row whatever the flag, whatever the series' tier. The flag is the reader's
    rule (src/desk/event_study.load_level), judged the same way on both snapshots:
    a committed run wrote the row, it is dated no later than `as_of`, R-30's
    explicit cutoff (the run's New York date at validation start, passed to both
    sides), and it is not dated after the New York date of the run that wrote it.
    A row the migration back-filled is judged by the cutoff alone (Codex R-30):
    the migration's own date would make migrating a copy name series across New
    York midnight. A store not yet migrated is read as the migration would leave
    it (Codex R-26): every row back-filled. Which run wrote a row does not count,
    so a row re-stamped under a new run is a change if and only if its flag
    changed: from an uncommitted run to a committed one, from a run dated before
    the row to one dated on or after it, or the reverse. A re-stamp that leaves
    the date, the value and the flag as they were changes nothing. Tier decides
    whether a check fails or warns, never whether a change is named.
    Returns the table's fingerprint and each series'. A query that fails
    raises: the caller runs this as a mandatory check (Codex R-23)."""
    if provenance.is_migrated(conn):
        rows = conn.execute(f"SELECT d.series_id, d.date, d.value, COALESCE(r.status = 'committed' AND d.date <= ? AND "
                            f"(d.run_id = '{provenance.PRE_PROVENANCE}' OR d.date <= r.as_of), 0) "
                            f"FROM desk_series d LEFT JOIN {provenance.RUNS} r ON r.run_id = d.run_id "
                            f"ORDER BY d.series_id, d.date", (as_of,))
    else:
        rows = conn.execute("SELECT series_id, date, value, COALESCE(date <= ?, 0) FROM desk_series ORDER BY series_id, date", (as_of,))
    table, per = hashlib.sha256(), {}
    for sid, d, v, readable in rows:
        table.update(repr((sid, d, v, bool(readable))).encode())
        per.setdefault(sid, hashlib.sha256()).update(repr((d, v, bool(readable))).encode())
    return table.hexdigest()[:16], {sid: h.hexdigest()[:16] for sid, h in per.items()}


def _asset_prices_fingerprint(conn: sqlite3.Connection) -> str:
    """asset_prices' publication fingerprint (desk/fill-etf, Codex R-02): the
    table's columns, then every value of every column in table order, so a
    volume-only correction (or a provider's, or a close's) is new content, and
    so is the volume column's arrival on a published table that predates it
    (src/market_data/asset_history.ensure_table adds it, NULL). A table in the
    older layout, without the column, fingerprints over its own columns. A
    query that fails raises, as _fingerprint's (Codex R-23)."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(asset_prices)")]
    if not cols:
        raise sqlite3.OperationalError("asset_prices has no columns to fingerprint")
    h = hashlib.sha256()
    h.update(repr(("columns", tuple(cols))).encode())
    select = ", ".join('"' + c.replace('"', '""') + '"' for c in cols)
    for row in conn.execute(f"SELECT {select} FROM asset_prices ORDER BY symbol, interval, date"):
        h.update(repr(tuple(row)).encode())
    return h.hexdigest()[:16]


def _fingerprint(conn: sqlite3.Connection, sql: str) -> str:
    """A table's content fingerprint. A query that fails raises: the caller runs it
    as a mandatory check, never as "unchanged" (Codex R-23)."""
    h = hashlib.sha256()
    for row in conn.execute(sql):
        h.update(repr(tuple(row)).encode())
    return h.hexdigest()[:16]


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


def _mandatory(out: dict, name: str, key: str | None, query):
    """Codex R-09: one mandatory check, run on its own. Its result is returned,
    and lands in out[key] when a key is given; a check that cannot run is named in
    out["checks_not_executed"] and returns None. validate() fails that list
    in every mode, the current snapshot's and the previous one's alike
    (verifier V-32): a check that never ran is never a check that found
    nothing."""
    try:
        value = query()
    except sqlite3.Error as exc:
        out.setdefault("checks_not_executed", []).append(f"{name} ({type(exc).__name__}: {exc})")
        return None
    if key is not None:
        out[key] = value
    return value


def _advisory(out: dict, name: str, query):
    """desk/cap-weight: one check on an advisory table (ADVISORY_TABLES). A
    check that cannot run is named in out["advisory_not_executed"], which
    validate() reports as a warning, never as "not executed": an advisory
    table never fails a database."""
    try:
        return query()
    except sqlite3.Error as exc:
        out.setdefault("advisory_not_executed", []).append(f"{name} ({type(exc).__name__}: {exc})")
        return None


# desk/cap-weight: share_counts rows the API sets aside on read (api/desk_basket.desk_share_counts): no symbol, a
# count that is not a positive number, a read date that is not a YYYY-MM-DD calendar date or is after the run's
# New York date (the `?`), or no source.
SHARE_COUNTS_UNREADABLE = ("SELECT COUNT(*) FROM share_counts WHERE typeof(symbol) <> 'text' OR trim(symbol) = '' "
                           "OR typeof(shares_outstanding) NOT IN ('real', 'integer') OR shares_outstanding <= 0 "
                           "OR NOT (typeof(as_of) = 'text' AND COALESCE(date(as_of) = as_of, 0)) OR as_of > ? "
                           "OR typeof(source) <> 'text' OR trim(source) = ''")


def inspect(path: Path, as_of: str | None = None) -> dict:
    out: dict = {"path": str(path), "exists": path.exists(), "size": path.stat().st_size if path.exists() else 0}
    if not path.exists():
        out["error"] = "missing"
        return out
    if not _header_ok(path):
        out["error"] = "not a SQLite file"
        return out
    conn = _open(path)
    try:
        # Codex R-09, verifier V-32: the integrity check is mandatory, the previous
        # snapshot's as much as the current one's (the table list or a row count failing raises)
        _mandatory(out, "integrity_check", "integrity", lambda: conn.execute("PRAGMA integrity_check").fetchone()[0])
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        out["tables"] = {}
        for t in tables:
            n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            col = DATE_COLUMNS.get(t)
            mx = None
            if col:
                # Codex R-17: each table's newest date is a mandatory check, on both snapshots, and
                # the column must exist (SQLite reads "date" in double quotes as a string literal when
                # the table has no such column, so a missing one compared the word itself)
                has_col = col in {r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')}
                if t in ADVISORY_TABLES:  # desk/cap-weight: reported, never failing
                    if has_col:
                        mx = _advisory(out, f"{t} newest {col}", lambda t=t, col=col: conn.execute(f'SELECT MAX("{col}") FROM "{t}"').fetchone()[0])
                    else:
                        out.setdefault("advisory_not_executed", []).append(f"{t} newest {col} (the table has no {col} column)")
                elif has_col:
                    mx = _mandatory(out, f"{t} newest {col}", None, lambda t=t, col=col: conn.execute(f'SELECT MAX("{col}") FROM "{t}"').fetchone()[0])
                else:
                    out.setdefault("checks_not_executed", []).append(f"{t} newest {col} (the table has no {col} column)")
            out["tables"][t] = {"rows": int(n), "max": mx}
        # Codex R-27 audit: a query that cannot run is "not executed", never an empty answer
        out["market_sources"] = {}
        if "market_daily" in out["tables"]:
            _mandatory(out, "market_daily sources", "market_sources", lambda: {
                r[0] or "null": int(r[1]) for r in conn.execute("SELECT source, COUNT(*) FROM market_daily GROUP BY source")})
        out["series_latest"] = []
        if "raw_series" in out["tables"]:
            _mandatory(out, "raw_series newest observations", "series_latest", lambda: [dict(r) for r in conn.execute(
                "SELECT r.series_id, r.date, r.value FROM raw_series r JOIN (SELECT series_id, MAX(date) AS md FROM raw_series GROUP BY series_id) m ON r.series_id = m.series_id AND r.date = m.md"
            )])
        # Codex R-23: every fingerprint is a mandatory check, on both snapshots: one that cannot run is
        # "not executed" and fails validation, never a table that did not change
        out["fingerprints"] = {}
        for t, sql in FINGERPRINT_SQL.items():
            if t in out["tables"] and t not in ("desk_series", "asset_prices"):
                out["fingerprints"][t] = _mandatory(out, f"{t} fingerprint", None, lambda sql=sql: _fingerprint(conn, sql))
        if "asset_prices" in out["tables"]:  # Codex R-02: every column, volume included, and the layout
            out["fingerprints"]["asset_prices"] = _mandatory(out, "asset_prices fingerprint", None, lambda: _asset_prices_fingerprint(conn))
        for t, sql in ADVISORY_FINGERPRINT_SQL.items():  # desk/cap-weight: a change publishes; a failure only warns
            if t in out["tables"]:
                out["fingerprints"][t] = _advisory(out, f"{t} fingerprint", lambda sql=sql: _fingerprint(conn, sql))
        if "desk_series" in out["tables"]:  # Codex R-20: content and readability-deciding provenance
            cut_fp = as_of or datetime.now(timezone.utc).astimezone(freshness_mod.cal.NY).date().isoformat()
            desk_fp = _mandatory(out, "desk_series fingerprint", None, lambda: _desk_fingerprints(conn, cut_fp))
            out["fingerprints"]["desk_series"], out["desk_series_fingerprints"] = desk_fp if desk_fp else (None, {})
        out["watermarks"] = None
        if "source_watermarks" in out["tables"]:
            _mandatory(out, "source_watermarks", "watermarks", lambda: {r["source"]: dict(r) for r in conn.execute(
                "SELECT source, last_obs, last_value, advanced_at, checked_at, status, detail FROM source_watermarks")})
        out["fresh"] = {
            "regimes_date": out["tables"].get("regimes", {}).get("max"),
            "signals_date": out["tables"].get("signals", {}).get("max"),
            "market_daily_date": out["tables"].get("market_daily", {}).get("max"),
            "market_intraday_ts": out["tables"].get("market_intraday", {}).get("max"),
            "news_published_at": out["tables"].get("news_feed", {}).get("max"),
            "raw_series_date": out["tables"].get("raw_series", {}).get("max"),
            "asset_prices_date": None,
            "desk_series_date": None,
            "desk_series_latest": None,
            # desk/cap-weight: the oldest stored share-count read (api/freshness reports its state, never judged)
            "share_counts_as_of": None,
        }
        if "share_counts" in out["tables"]:
            out["fresh"]["share_counts_as_of"] = _advisory(out, "share_counts oldest read", lambda: conn.execute(
                "SELECT MIN(as_of) FROM share_counts").fetchone()[0])
            cut_sc = as_of or datetime.now(timezone.utc).astimezone(freshness_mod.cal.NY).date().isoformat()
            out["share_counts_unreadable"] = _advisory(out, "share_counts unreadable rows", lambda: int(conn.execute(
                SHARE_COUNTS_UNREADABLE, (cut_sc,)).fetchone()[0]))
        if "asset_prices" in out["tables"]:
            out["fresh"]["asset_prices_date"] = _mandatory(out, "asset_prices newest daily closes", None, lambda: conn.execute(
                "SELECT MIN(mx) FROM (SELECT MAX(date) AS mx FROM asset_prices WHERE interval = '1d' GROUP BY symbol)"
            ).fetchone()[0])
            # verifiers V-14, V-22: rows the Desk and allocation cannot read (mandatory, Codex R-09)
            _mandatory(out, "asset_prices non-numeric closes", "asset_prices_non_numeric", lambda: int(conn.execute(
                "SELECT COUNT(*) FROM asset_prices WHERE typeof(close) NOT IN ('real', 'integer')").fetchone()[0]))
            _mandatory(out, "asset_prices malformed dates", "asset_prices_malformed_dates", lambda: int(conn.execute(
                f"SELECT COUNT(*) FROM asset_prices WHERE {MALFORMED_DATE}").fetchone()[0]))
        if "desk_series" in out["tables"]:
            # desk/event-study: the oldest newest observation across the stored series; since
            # verifier V-27 over the rows the engine's reader keeps, up to the as-of (today in
            # New York unless given), as api/db.freshness reads them: a junk date that sorts
            # last never stands in for the newest observation
            cut = as_of or datetime.now(timezone.utc).astimezone(freshness_mod.cal.NY).date().isoformat()
            # Codex R-14, R-15: in a store with provenance, only rows a committed refresh wrote, dated
            # on or before its New York date (api/provenance.py), as the reader keeps them
            # Codex R-27: whether the store carries provenance is a mandatory check, read fail-closed;
            # one that cannot run fails validation, and nothing that depends on it runs
            _mandatory(out, "desk_series provenance schema", "desk_provenance", lambda: provenance.is_migrated(conn))
            if "desk_provenance" in out:
                # desk/integration (verifier V-06): per series, as api/db.freshness reports them
                latest = _mandatory(out, "desk_series newest readable observations", None, lambda: dict(conn.execute(
                    *freshness_mod.desk_latest_query(cut, out["desk_provenance"])).fetchall()))
                if latest is not None:
                    out["fresh"]["desk_series_latest"] = latest
                    out["fresh"]["desk_series_date"] = min(latest.values(), default=None)
            # Codex R-09: the integrity and corruption checks are mandatory, each on its own, so
            # no other query failing can skip them; one that cannot run is "not executed"
            # desk/hardening: rows and dates per series (the tier-1 and future-date checks)
            _mandatory(out, "desk_series per-series rows and dates", "desk_series_by_id", lambda: {
                sid: {"rows": int(n), "max": mx} for sid, n, mx in conn.execute(
                    "SELECT series_id, COUNT(*), MAX(date) FROM desk_series GROUP BY series_id")})
            # verifier V-14: stored values that are not numbers, per series
            _mandatory(out, "desk_series non-numeric values", "desk_series_non_numeric", lambda: {
                sid: int(n) for sid, n in conn.execute(
                    "SELECT series_id, COUNT(*) FROM desk_series WHERE typeof(value) NOT IN ('real', 'integer') GROUP BY series_id")})
            # verifiers V-22, V-26: stored dates that are not valid ISO dates on or after the floor
            _mandatory(out, "desk_series malformed dates", "desk_series_malformed_dates", lambda: {
                sid: int(n) for sid, n in conn.execute(
                    f"SELECT series_id, COUNT(*) FROM desk_series WHERE {MALFORMED_DATE} GROUP BY series_id")})
            if out.get("desk_provenance"):
                # Codex R-14: rows no committed refresh wrote, and rows dated after the New York date of
                # the run that committed them (not after the as-of: the future-date check names those)
                _mandatory(out, "desk_series provenance", "desk_series_no_provenance", lambda: {
                    sid: int(n) for sid, n in conn.execute(
                        f"SELECT d.series_id, COUNT(*) FROM desk_series d {provenance.COMMITTED_JOIN} "
                        "WHERE r.run_id IS NULL GROUP BY d.series_id")})
                _mandatory(out, "desk_series dates after their refresh", "desk_series_after_run", lambda: {
                    sid: int(n) for sid, n in conn.execute(
                        f"SELECT d.series_id, COUNT(*) FROM desk_series d {provenance.COMMITTED_JOIN} "
                        "WHERE r.run_id IS NOT NULL AND d.date > r.as_of AND d.date <= ? GROUP BY d.series_id", (cut,))})
    finally:
        conn.close()
    return out


def _desk_tier(series_id: str) -> int | None:
    meta = freshness_mod.DESK_REFRESH_SERIES.get(series_id)
    return int(meta.get("tier", 1)) if meta else None


def _desk_tier_note(series_id: str) -> str:
    tier = _desk_tier(series_id)
    if tier == 1:
        return "tier 1"
    return f"tier {tier}, reported, never blocking" if tier else "not in the refresh set, reported, never blocking"


# verifier V-33: the value sanity checks, each run on its own: (name, report key, table, query)
VALUE_SANITY = (
    ("regimes probabilities within [0, 1]", "regimes_prob_out_of_range", "regimes",
     "SELECT COUNT(*) FROM regimes WHERE prob_goldilocks NOT BETWEEN 0 AND 1 OR prob_overheating NOT BETWEEN 0 AND 1"
     " OR prob_stagflation NOT BETWEEN 0 AND 1 OR prob_recession NOT BETWEEN 0 AND 1"),
    ("market_daily non-positive closes", "market_daily_non_positive", "market_daily",
     "SELECT COUNT(*) FROM market_daily WHERE close IS NOT NULL AND close <= 0"),
    ("asset_prices non-positive closes", "asset_prices_non_positive", "asset_prices",
     "SELECT COUNT(*) FROM asset_prices WHERE close IS NULL OR close <= 0"),
)
DESK_TIER1_ROW_LOSS = 0.01  # review R-02: a tier-1 Desk series losing more than 1% of its rows fails
# verifier V-22: a stored date that is not YYYY-MM-DD text naming a real day (SQLite's date()
# returns NULL for '1999-99-99' and normalizes '2010-02-30' to '2010-03-02', so both differ),
# or one before the engine's floor (verifier V-26: '0000-01-01', '1000-01-01')
MALFORMED_DATE = f"NOT (typeof(date) = 'text' AND COALESCE(date(date) = date, 0) AND date >= '{freshness_mod.DESK_DATE_FLOOR}')"


def _desk_tier1_failures(cur: dict[str, dict], prev: dict[str, dict] | None, *, full: bool, table_present: bool) -> list[str]:
    """Review R-02: each tier-1 Desk series on its own, before any table-wide
    check. In full mode a tier-1 series the table lacks fails; against the
    previous snapshot, a tier-1 series that vanished, lost more than 1% of its
    rows, or moved its newest date earlier fails."""
    out: list[str] = []
    for sid, meta in freshness_mod.DESK_REFRESH_SERIES.items():
        if int(meta.get("tier", 1)) != 1:
            continue
        now_, was = cur.get(sid), (prev or {}).get(sid)
        if now_ is None and full and table_present:
            out.append(f"desk:{sid} (tier 1): not stored; the full refresh stores it")
        if was is None:
            continue
        if now_ is None:
            out.append(f"desk:{sid} (tier 1): {was['rows']} rows before, none now")
            continue
        if was["rows"] and now_["rows"] < (1 - DESK_TIER1_ROW_LOSS) * was["rows"]:
            out.append(f"desk:{sid} (tier 1): rows fell {was['rows']} → {now_['rows']} (more than 1%)")
        if was["max"] and now_["max"] and str(now_["max"]) < str(was["max"]):
            out.append(f"desk:{sid} (tier 1): max date regressed {was['max']} → {now_['max']}")
    return out


def _desk_series_judged(cur: dict[str, dict], prev: dict[str, dict]) -> tuple[dict, dict, list[str]]:
    """desk_series against the previous snapshot (desk/hardening): the table's
    date and row checks run over the tier-1 series only, and every other series
    that lost rows or moved its newest date earlier is a warning."""

    def judged(by_id: dict[str, dict]) -> dict:
        rows = [v for sid, v in by_id.items() if _desk_tier(sid) == 1]
        return {"rows": sum(v["rows"] for v in rows), "max": max((v["max"] for v in rows if v["max"]), default=None)}

    notes: list[str] = []
    for sid in sorted(sid for sid in prev if _desk_tier(sid) != 1):
        was, now_ = prev[sid], cur.get(sid)
        if now_ is None:
            notes.append(f"desk:{sid}: no rows in this snapshot, {was['rows']} before ({_desk_tier_note(sid)})")
            continue
        if was["max"] and now_["max"] and str(now_["max"]) < str(was["max"]):
            notes.append(f"desk:{sid}: newest date moved earlier {was['max']} → {now_['max']} ({_desk_tier_note(sid)})")
        if was["rows"] > 20 and now_["rows"] < 0.8 * was["rows"]:
            notes.append(f"desk:{sid}: rows fell {was['rows']} → {now_['rows']} ({_desk_tier_note(sid)})")
    return judged(cur), judged(prev), notes


def validate(current: Path, previous: Path | None, mode: str, *, allow_stale: str = "", now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    as_of = now.astimezone(freshness_mod.cal.NY).date().isoformat()  # V-27: freshness up to the run's New York date
    cur = inspect(current, as_of=as_of)
    prev = inspect(previous, as_of=as_of) if previous else None
    failures: list[str] = []
    warnings: list[str] = []

    if cur.get("error"):
        failures.append(f"database unusable: {cur['error']}")
        return {"verdict": "fail", "mode": mode, "failures": failures, "warnings": warnings, "current": cur, "previous": prev, "changed": False}
    if "integrity" in cur and cur["integrity"] != "ok":  # one that could not run fails as "not executed" below
        failures.append(f"integrity_check: {cur.get('integrity')}")
    for t in REQUIRED_TABLES:
        if t not in cur["tables"]:
            failures.append(f"missing table {t}")
        elif cur["tables"][t]["rows"] == 0:
            failures.append(f"table {t} is empty")

    # fix/prelaunch-1: a full refresh stores allocation's price histories, so a
    # full-mode database without them (or with an empty table) is not
    # publishable; lean modes download the published file as it is.
    if mode == "full":
        if "asset_prices" not in cur["tables"]:
            failures.append("asset_prices: missing; the full refresh stores allocation's price histories (src/market_data/asset_history.py)")
        elif cur["tables"]["asset_prices"]["rows"] == 0:
            failures.append("asset_prices: table is empty")
        # desk/event-study (2026-09-21): the full refresh also stores the Desk's
        # daily series; a series the source served short of its declared start,
        # or that failed this run, is reported, never blocking.
        if "desk_series" not in cur["tables"]:
            failures.append("desk_series: missing; the full refresh stores the Desk's daily series (src/market_data/desk_history.py)")
        elif cur["tables"]["desk_series"]["rows"] == 0:
            failures.append("desk_series: table is empty")
        reported: set[str] = set()
        for src, wm in sorted((cur.get("watermarks") or {}).items()):
            if src.startswith("desk:") and wm.get("status") in ("short", "error", "excluded"):
                warnings.append(f"{src} {wm['status']}: {wm.get('detail')} ({_desk_tier_note(src[5:])})")
                reported.add(src)
        # desk/hardening: a tier-2 series missing or behind is reported by
        # name, never judged (the desk_series verdict below reads tier 1 only).
        if "desk_series" in cur["tables"]:
            optional = [sp for sp in freshness_mod.desk_refresh_specs() if sp.get("tier", 1) > 1]
            for st in freshness_mod.desk_series_states(stored=cur["fresh"].get("desk_series_latest") or {}, specs=optional,
                                                        watermarks=cur.get("watermarks"), now=now):
                # a series the watermark already named as failed and never stored says
                # nothing new as `unknown`; a stale one says it is behind (V-11)
                if st["state"] != "close" and not (st["state"] == "unknown" and st["id"] in reported):
                    warnings.append(f"{st['id']} {st['state']}: {st['reason']} ({_desk_tier_note(st['id'][5:])})")
        # desk/cap-weight: the share counts are advisory. The step creates the table even when every
        # fetch fails, so a table that is absent or empty, or a partial or failed fetch, is reported and
        # never fails the database (Basket & Hedge then says cap weight is unavailable, and why).
        if "share_counts" not in cur["tables"]:
            warnings.append("share_counts: not stored; the full refresh's share-count step stores the preset baskets' "
                            "counts, and cap weight is unavailable until then (advisory, never blocking)")
        elif cur["tables"]["share_counts"]["rows"] == 0:
            warnings.append("share_counts: no count stored; cap weight is unavailable until a full refresh reads them "
                            "(advisory, never blocking)")
        sc_mark = (cur.get("watermarks") or {}).get("share_counts") or {}
        if sc_mark.get("status") in ("partial", "error"):
            warnings.append(f"share_counts {sc_mark['status']}: {sc_mark.get('detail')} (advisory, never blocking)")

    # Stamps ahead of the clock are a fault, never freshness (review P2-3).
    horizon = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    for t, info in cur["tables"].items():
        if t in FORWARD_TABLES:
            continue
        if t == "desk_series" and "desk_series_by_id" in cur:
            # review R-03: per series; tier 1 fails, anything else is reported. Codex R-11: against
            # the run's New York as-of, the cutoff every other Desk check uses, never the one-day
            # allowance above (which let a row dated tomorrow in New York through)
            for sid, row in sorted(cur["desk_series_by_id"].items()):
                mx = row.get("max")
                if mx and str(mx)[:10] > as_of:
                    if _desk_tier(sid) == 1:
                        failures.append(f"desk:{sid} (tier 1): max date {mx} is in the future")
                    else:
                        warnings.append(f"desk:{sid}: max date {mx} is in the future; the store excludes such rows "
                                        f"({_desk_tier_note(sid)})")
            continue
        mx = info.get("max")
        if mx and re.match(r"^\d{4}-\d{2}-\d{2}", str(mx)) and str(mx)[:10] > horizon:
            (warnings if t in ADVISORY_TABLES else failures).append(f"{t}: max date {mx} is in the future"
                                                                    + (" (advisory, never blocking)" if t in ADVISORY_TABLES else ""))
    # Bounded value sanity on the tables every screen reads. Verifier V-33: each check on its
    # own (it was one block, which an error in any query, a regimes table without the
    # probability columns say, skipped whole with a warning), and one that cannot run is
    # "not executed" and fails below (Codex R-09). A check whose table is missing is not run:
    # a missing required table already fails.
    conn = _open(current)
    try:
        for name, key, table, sql in VALUE_SANITY:
            if table in cur["tables"]:
                _mandatory(cur, name, key, lambda sql=sql: int(conn.execute(sql).fetchone()[0]))
    finally:
        conn.close()
    if cur.get("regimes_prob_out_of_range"):
        failures.append(f"regimes: {cur['regimes_prob_out_of_range']} row(s) with probabilities outside [0, 1]")
    if cur.get("market_daily_non_positive"):
        failures.append(f"market_daily: {cur['market_daily_non_positive']} row(s) with a non-positive close")
    if cur.get("asset_prices_non_positive"):
        failures.append(f"asset_prices: {cur['asset_prices_non_positive']} row(s) with a non-positive close")

    # Malformed stored rows the Desk reads (verifiers V-14, V-22), counted by inspect() as
    # mandatory checks of their own (Codex R-09), so no unrelated schema error can skip them. A
    # non-numeric value or a malformed date fails for a tier-1 series and is reported for any
    # other (the engine sets such a row aside on read either way, so the Desk still answers);
    # in asset_prices, allocation's table, it fails. Text compares above every number, so
    # the `close <= 0` check above never saw a non-numeric close.
    for name in cur.get("checks_not_executed") or []:  # Codex R-09
        failures.append(f"check not executed: {name}; a mandatory check that did not run never counts as clean")
    # verifier V-32: the previous snapshot's mandatory checks are judged the same way. Its
    # per-series Desk rows feed the tier-1 row-loss and date-regression comparisons, and
    # its integrity says whether it is a baseline at all.
    if prev and not prev.get("error"):
        if "integrity" in prev and prev["integrity"] != "ok":
            failures.append(f"previous snapshot integrity_check: {prev['integrity']}; nothing is compared against a damaged baseline")
        for name in prev.get("checks_not_executed") or []:
            failures.append(f"check not executed on the previous snapshot: {name}; a mandatory check that did not run never counts as clean")
        if "desk_series" in prev["tables"] and "desk_series_by_id" not in prev:
            failures.append("desk_series (tier 1): the row-loss and date-regression comparisons did not run, "
                            "because the previous snapshot's per-series check was not executed")
    elif previous is None:
        warnings.append("no previous snapshot given: the row-loss, date-regression and change comparisons did not run")
    # desk/cap-weight: the advisory table's own reports, never a failure
    if cur.get("share_counts_unreadable"):
        warnings.append(f"share_counts: {cur['share_counts_unreadable']} row(s) the API sets aside (no symbol or source, a count "
                        "that is not a positive number, or a read date malformed or after today) (advisory, never blocking)")
    for name in cur.get("advisory_not_executed") or []:
        warnings.append(f"advisory check not run: {name} (never blocking)")
    for name in ((prev or {}).get("advisory_not_executed") or []) if prev and not prev.get("error") else []:
        warnings.append(f"advisory check not run on the previous snapshot: {name} (never blocking)")
    if cur.get("asset_prices_non_numeric"):
        failures.append(f"asset_prices: {cur['asset_prices_non_numeric']} row(s) with a non-numeric close")
    if cur.get("asset_prices_malformed_dates"):
        failures.append(f"asset_prices: {cur['asset_prices_malformed_dates']} row(s) with a malformed date")
    for key, what, verb in (("desk_series_non_numeric", ("non-numeric value", "non-numeric values"), "excludes {} on read"),
                            ("desk_series_malformed_dates", ("malformed date", "malformed dates"), "sets {} aside on read"),
                            # Codex R-14: the hand-inserted class, and rows dated after their refresh's day
                            ("desk_series_no_provenance", ("row no committed refresh wrote (no provenance)",
                                                           "rows no committed refresh wrote (no provenance)"), "sets {} aside on read"),
                            ("desk_series_after_run", ("row dated after the New York date of the refresh that stored it",
                                                       "rows dated after the New York date of the refresh that stored them"),
                             "sets {} aside on read")):
        for sid, n in sorted((cur.get(key) or {}).items()):
            noun = f"{n} {what[0] if n == 1 else what[1]}"
            if _desk_tier(sid) == 1:
                failures.append(f"desk:{sid} (tier 1): {noun}")
            else:
                warnings.append(f"desk:{sid}: {noun}; the Desk {verb.format('it' if n == 1 else 'them')} ({_desk_tier_note(sid)})")

    # review R-02: each tier-1 Desk series on its own, before any table-wide check
    if "desk_series" in cur["tables"] and "desk_series_by_id" in cur:
        failures.extend(_desk_tier1_failures(
            cur["desk_series_by_id"], (prev or {}).get("desk_series_by_id") if prev and not prev.get("error") else None,
            full=(mode == "full"), table_present=True))

    changed = False
    changed_tables: list[str] = []
    if previous is not None and prev is not None and prev.get("error"):
        failures.append(f"previous snapshot unusable ({prev['error']}); refusing to publish without a baseline")
    if prev and not prev.get("error"):
        for t, info in cur["tables"].items():
            if t == provenance.RUNS:
                continue  # verifier V-40: judged below, by what the Desk reads
            p = prev["tables"].get(t)
            if not p:
                if info["rows"] > 0:
                    changed_tables.append(t)  # a new, populated table is new content
                continue
            judged, judged_prev = info, p
            if t == "desk_series" and "desk_series_by_id" in cur and "desk_series_by_id" in prev:
                judged, judged_prev, notes = _desk_series_judged(cur["desk_series_by_id"], prev["desk_series_by_id"])
                warnings.extend(notes)
            if judged["max"] and judged_prev["max"] and str(judged["max"]) < str(judged_prev["max"]):
                if t in FORWARD_TABLES:
                    warnings.append(f"{t}: max date moved earlier {p['max']} → {info['max']} (a scheduled event was rescheduled)")
                elif t in ADVISORY_TABLES:
                    warnings.append(f"{t}: max date moved earlier {judged_prev['max']} → {judged['max']} (advisory, never blocking)")
                else:
                    failures.append(f"{t}: max date regressed {judged_prev['max']} → {judged['max']}")
            if t in ADVISORY_TABLES:
                if judged["rows"] < judged_prev["rows"]:
                    warnings.append(f"{t}: rows fell {judged_prev['rows']} → {judged['rows']} (advisory, never blocking)")
            elif t not in TRIMMED_TABLES and judged_prev["rows"] > 20 and judged["rows"] < 0.8 * judged_prev["rows"]:
                failures.append(f"{t}: rows fell {judged_prev['rows']} → {judged['rows']} (more than a fifth)")
            fp_cur = (cur.get("fingerprints") or {}).get(t)
            fp_prev = (prev.get("fingerprints") or {}).get(t)
            if info["rows"] != p["rows"] or str(info["max"]) != str(p["max"]) or (fp_cur and fp_prev and fp_cur != fp_prev):
                changed_tables.append(t)
        # Codex R-20: name each Desk series whose readable rows changed (value, date or readability)
        if "desk_series" in cur["tables"]:
            fp_now, fp_was = cur.get("desk_series_fingerprints") or {}, prev.get("desk_series_fingerprints") or {}
            changed_tables.extend(f"desk:{sid}" for sid in sorted(set(fp_now) | set(fp_was)) if fp_now.get(sid) != fp_was.get(sid))
        # verifier V-40: the runs table is a change only when what the Desk reads changed with it. A run
        # that commits nothing, or re-stamps identical rows, adds a row here and changes nothing else.
        if provenance.RUNS in cur["tables"] and "desk_series" in changed_tables:
            p_runs = prev["tables"].get(provenance.RUNS)
            fp_runs = ((cur.get("fingerprints") or {}).get(provenance.RUNS), (prev.get("fingerprints") or {}).get(provenance.RUNS))
            if p_runs is None or cur["tables"][provenance.RUNS]["rows"] != p_runs["rows"] or fp_runs[0] != fp_runs[1]:
                changed_tables.append(provenance.RUNS)
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
    outages = [r for r in stale if r["feed"].startswith(OUTAGE_FEEDS) and r["verdict"] == "stale" and _checked_this_run(r["feed"])]
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

    ai_spend = None
    if "ai_spend_ledger" in cur["tables"]:  # R-27 audit: a ledger that cannot be read is not "no spend"
        ai_spend = _mandatory(cur, "ai_spend_ledger month-to-date", None, lambda: _ai_spend(current, now))
        if ai_spend is None:
            failures.append(f"check not executed: {cur['checks_not_executed'][-1]}; a mandatory check that did not run never counts as clean")
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
        # Codex R-09: what the mandatory corruption checks found, and any that did not run
        "corruption": {
            "desk_series_non_numeric": dict(cur.get("desk_series_non_numeric") or {}),
            "desk_series_malformed_dates": dict(cur.get("desk_series_malformed_dates") or {}),
            # Codex R-14: provenance, when the store carries it
            "desk_provenance": cur.get("desk_provenance"),
            "desk_series_no_provenance": dict(cur.get("desk_series_no_provenance") or {}),
            "desk_series_after_run": dict(cur.get("desk_series_after_run") or {}),
            "asset_prices_non_numeric": cur.get("asset_prices_non_numeric"),
            "asset_prices_malformed_dates": cur.get("asset_prices_malformed_dates"),
            "not_executed": list(cur.get("checks_not_executed") or []),
            # verifier V-33: the value sanity checks, each on its own
            "regimes_prob_out_of_range": cur.get("regimes_prob_out_of_range"),
            "market_daily_non_positive": cur.get("market_daily_non_positive"),
            "asset_prices_non_positive": cur.get("asset_prices_non_positive"),
            # verifier V-32: the previous snapshot's checks that did not run
            "previous_not_executed": list((prev or {}).get("checks_not_executed") or []),
        },
        "ai_spend": ai_spend,
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
    ]
    ai = rep.get("ai_spend")
    if ai:
        lines.append(f"- AI spend month-to-date: ${ai['cost_usd']:.2f} of ${ai['cap_usd']:.2f} cap ({ai['calls']} calls)")
    lines += [
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
    corr = rep.get("corruption") or {}
    if corr:  # Codex R-09
        lines += ["", "**Corruption checks** · non-numeric values and malformed dates the Desk sets aside on read", "",
                  f"- desk_series non-numeric values: {json.dumps(corr.get('desk_series_non_numeric') or {})}",
                  f"- desk_series malformed dates: {json.dumps(corr.get('desk_series_malformed_dates') or {})}",
                  f"- desk_series provenance: {'recorded' if corr.get('desk_provenance') else 'not yet (read as pre-provenance)'} · "
                  f"no provenance {json.dumps(corr.get('desk_series_no_provenance') or {})} · "
                  f"after their refresh {json.dumps(corr.get('desk_series_after_run') or {})}",
                  f"- asset_prices non-numeric closes: {corr.get('asset_prices_non_numeric')} · malformed dates: {corr.get('asset_prices_malformed_dates')}",
                  f"- regimes probabilities outside [0, 1]: {corr.get('regimes_prob_out_of_range')} · non-positive closes: "
                  f"market_daily {corr.get('market_daily_non_positive')}, asset_prices {corr.get('asset_prices_non_positive')}"]
        for name in corr.get("not_executed") or []:
            lines.append(f"- NOT EXECUTED: {name}")
        for name in corr.get("previous_not_executed") or []:
            lines.append(f"- NOT EXECUTED on the previous snapshot: {name}")
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
