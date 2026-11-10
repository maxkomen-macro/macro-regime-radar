"""src/market_data/cot.py — CFTC Commitments of Traders positions for the Desk's macro futures (Desk P4, D7).

The CFTC publishes, every week, the open positions of each category of trader
in each futures market, as of a Tuesday (usually), released that Friday. This
step stores the futures-only reports for five macro markets from the CFTC's
Public Reporting Environment (publicreporting.cftc.gov, a Socrata API, no key):

    market   contract (code)                     report
    spx      E-mini S&P 500, CME (13874A)         Traders in Financial Futures
    ust10y   10-year T-note, CBOT (043602)        Traders in Financial Futures
    usd      US dollar index, ICE US (098662)     Traders in Financial Futures
    gold     Gold, COMEX (088691)                 Disaggregated
    wti      WTI crude, NYMEX (067651)            Disaggregated

into the additive table `cot_positions`, one row per (report, contract,
positions date, trader category): long, short and spreading contracts and the
market's open interest, with the CFTC's own row id, the run that wrote it and
when the store first and last wrote it. CFTC data are US government works in
the public domain (cftc.gov Web Policy: "may be freely distributed and copied",
acknowledgement requested); the Desk credits the CFTC beside every figure.

Each run reads the whole history of the five markets (two requests), so a
report the CFTC corrects is seen: a stored row whose numbers change keeps its
old numbers in `cot_revisions` (when the store learned of the change, and which
runs wrote the old and new numbers), and a stored report the CFTC no longer
serves is marked withdrawn, never deleted; the API sets withdrawn rows aside.
Each report must satisfy the CFTC's own identity before it is stored: the
categories' long positions plus their spreading equal the open interest, and
so do the short positions plus spreading. A report that fails it, or misses a
field, is not stored and the watermark says how many and why.

Every run is recorded in `positioning_runs` (started, then committed or
failed); the API reads a row only when the run that wrote it committed.

Run:  python -m src.market_data.cot [--db data/macro_radar.db]
The step never fails the refresh: a failed fetch keeps what is stored, records
the watermark `cftc_cot` (status ok, partial or error, the reasons in its
detail) and exits 0; scripts/validate_db.py only warns.

Method: docs/desk/POSITIONING_SPEC.md. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import watermarks  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
PROVIDER = "CFTC"
SOURCE = "cftc_pre"  # the CFTC Public Reporting Environment
WATERMARK = "cftc_cot"
TABLE = "cot_positions"
REVISIONS = "cot_revisions"
RUNS = "positioning_runs"
BASE_URL = "https://publicreporting.cftc.gov/resource"
# A plain, descriptive client name; the CFTC's API needs no key or contact.
USER_AGENT = "macro-regime-radar positioning refresh (research; python urllib)"
TIMEOUT_S = 60
RETRIES = 3
RETRY_WAIT_S = 5.0
ROW_LIMIT = 50000  # one request per report; the five markets hold about 1,100 weekly reports each


@dataclass(frozen=True)
class Report:
    key: str          # stored in cot_positions.report
    dataset: str      # the Socrata dataset id, futures only
    title: str
    # (category, long field, short field, spreading field or None), in the CFTC's order
    categories: tuple[tuple[str, str, str, str | None], ...]


REPORTS: dict[str, Report] = {
    "tff": Report("tff", "gpe5-46if", "Traders in Financial Futures, futures only", (
        ("dealer", "dealer_positions_long_all", "dealer_positions_short_all", "dealer_positions_spread_all"),
        ("asset_manager", "asset_mgr_positions_long", "asset_mgr_positions_short", "asset_mgr_positions_spread"),
        ("leveraged_funds", "lev_money_positions_long", "lev_money_positions_short", "lev_money_positions_spread"),
        ("other_reportables", "other_rept_positions_long", "other_rept_positions_short", "other_rept_positions_spread"),
        ("nonreportables", "nonrept_positions_long_all", "nonrept_positions_short_all", None),
    )),
    "disaggregated": Report("disaggregated", "72hh-3qpy", "Disaggregated, futures only", (
        ("producer_merchant", "prod_merc_positions_long", "prod_merc_positions_short", None),
        ("swap_dealers", "swap_positions_long_all", "swap__positions_short_all", "swap__positions_spread_all"),
        ("managed_money", "m_money_positions_long_all", "m_money_positions_short_all", "m_money_positions_spread"),
        ("other_reportables", "other_rept_positions_long", "other_rept_positions_short", "other_rept_positions_spread"),
        ("nonreportables", "nonrept_positions_long_all", "nonrept_positions_short_all", None),
    )),
}


@dataclass(frozen=True)
class Market:
    key: str
    label: str
    contract_code: str
    report: str
    primary: str  # the category the Desk leads with: the speculative one of its report


MARKETS: tuple[Market, ...] = (
    Market("spx", "S&P 500 (E-mini)", "13874A", "tff", "leveraged_funds"),
    Market("ust10y", "10-year Treasury note", "043602", "tff", "leveraged_funds"),
    Market("usd", "US dollar index", "098662", "tff", "leveraged_funds"),
    Market("gold", "Gold (COMEX)", "088691", "disaggregated", "managed_money"),
    Market("wti", "WTI crude oil (NYMEX)", "067651", "disaggregated", "managed_money"),
)

DDL = (
    f"""
CREATE TABLE IF NOT EXISTS {RUNS} (
    run_id       TEXT PRIMARY KEY,
    source       TEXT NOT NULL,   -- cftc_pre | sec_13f
    started_at   TEXT NOT NULL,   -- UTC
    finished_at  TEXT,            -- UTC
    status       TEXT NOT NULL,   -- started | committed | failed
    detail       TEXT
) WITHOUT ROWID
""",
    f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    report          TEXT NOT NULL,     -- tff | disaggregated (futures only)
    contract_code   TEXT NOT NULL,     -- the CFTC contract market code, e.g. 13874A
    as_of           TEXT NOT NULL,     -- YYYY-MM-DD: the date the positions are as of (usually a Tuesday)
    category        TEXT NOT NULL,     -- the report's trader category (cot.REPORTS)
    long            INTEGER NOT NULL CHECK (long >= 0),
    short           INTEGER NOT NULL CHECK (short >= 0),
    spread          INTEGER CHECK (spread IS NULL OR spread >= 0),  -- NULL where the report has no spreading column
    open_interest   INTEGER NOT NULL CHECK (open_interest >= 0),
    market_name     TEXT NOT NULL,     -- as the CFTC names the market in that report
    source_row_id   TEXT NOT NULL,     -- the CFTC's own row id
    provider        TEXT NOT NULL,     -- CFTC
    run_id          TEXT NOT NULL,     -- the run that last wrote the numbers (positioning_runs)
    first_stored_at TEXT NOT NULL,     -- UTC: when this store first held the report
    stored_at       TEXT NOT NULL,     -- UTC: when its numbers were last written
    withdrawn_at    TEXT,              -- UTC: when a full read of the source no longer served it
    PRIMARY KEY (report, contract_code, as_of, category)
) WITHOUT ROWID
""",
    f"""
CREATE TABLE IF NOT EXISTS {REVISIONS} (
    report         TEXT NOT NULL,
    contract_code  TEXT NOT NULL,
    as_of          TEXT NOT NULL,
    category       TEXT NOT NULL,
    old_long       INTEGER, old_short INTEGER, old_spread INTEGER, old_open_interest INTEGER,
    new_long       INTEGER, new_short INTEGER, new_spread INTEGER, new_open_interest INTEGER,
    old_run_id     TEXT NOT NULL,
    new_run_id     TEXT NOT NULL,
    revised_at     TEXT NOT NULL,      -- UTC: when the store read the changed numbers
    PRIMARY KEY (report, contract_code, as_of, category, revised_at)
) WITHOUT ROWID
""",
)
COLUMNS = ("report", "contract_code", "as_of", "category", "long", "short", "spread", "open_interest", "market_name",
           "source_row_id", "provider", "run_id", "first_stored_at", "stored_at", "withdrawn_at")
NUMBERS = ("long", "short", "spread", "open_interest")


class FetchFailed(RuntimeError):
    """The CFTC's API did not answer a usable page."""


def ensure_tables(conn: sqlite3.Connection) -> None:
    for ddl in DDL:
        conn.execute(ddl)


def stamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── runs (shared with src/market_data/sec_13f.py) ───────────────────────────

def start_run(conn: sqlite3.Connection, source: str, now: datetime) -> str:
    run_id = f"{source}-{now.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}"
    conn.execute(f"INSERT INTO {RUNS} (run_id, source, started_at, finished_at, status, detail) VALUES (?, ?, ?, NULL, 'started', NULL)",
                 (run_id, source, stamp(now)))
    return run_id


def finish_run(conn: sqlite3.Connection, run_id: str, status: str, detail: str, now: datetime) -> None:
    conn.execute(f"UPDATE {RUNS} SET status = ?, finished_at = ?, detail = ? WHERE run_id = ?", (status, stamp(now), detail, run_id))


# ── fetch ───────────────────────────────────────────────────────────────────

def query_url(report: Report, codes: Iterable[str]) -> str:
    fields = ["id", "market_and_exchange_names", "report_date_as_yyyy_mm_dd", "cftc_contract_market_code",
              "futonly_or_combined", "open_interest_all"]
    for _cat, lo, sh, sp in report.categories:
        fields += [lo, sh] + ([sp] if sp else [])
    quoted = ",".join(f"'{c}'" for c in codes)
    params = {
        "$select": ",".join(fields),
        "$where": f"cftc_contract_market_code in({quoted})",
        "$order": "report_date_as_yyyy_mm_dd,cftc_contract_market_code",
        "$limit": str(ROW_LIMIT),
    }
    return f"{BASE_URL}/{report.dataset}.json?{urllib.parse.urlencode(params)}"


def http_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310 — a fixed https host
        if resp.status != 200:
            raise FetchFailed(f"HTTP {resp.status}")
        return json.loads(resp.read().decode("utf-8"))


def fetch_report(report: Report, codes: list[str], get: Callable[[str], Any] = http_get_json, *,
                 retry_wait: float = RETRY_WAIT_S) -> list[dict]:
    """Every futures-only row of `report` for the contract codes, retried; raises FetchFailed."""
    url = query_url(report, codes)
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            rows = get(url)
            if not isinstance(rows, list):
                raise FetchFailed("the answer is not a list of rows")
            if len(rows) >= ROW_LIMIT:
                raise FetchFailed(f"the answer reached the {ROW_LIMIT}-row page limit, so it may be cut short")
            return rows
        except Exception as exc:  # noqa: BLE001 — any failure of the read is the run's to report
            last = exc
            if attempt + 1 < RETRIES and retry_wait:
                time.sleep(retry_wait * (attempt + 1))
    raise FetchFailed(f"{report.title}: {type(last).__name__}: {last}")


# ── parse ───────────────────────────────────────────────────────────────────

_ISO = re.compile(r"(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?)?")


def _count(raw: Any, field: str) -> int:
    if isinstance(raw, bool) or raw is None:
        raise ValueError(f"{field} is missing")
    s = str(raw).strip()
    if not re.fullmatch(r"\d+", s):
        raise ValueError(f"{field} is {raw!r}, not a whole number of contracts")
    return int(s)


def parse_row(report: Report, row: Mapping[str, Any], codes: set[str]) -> list[dict]:
    """One CFTC row as one dict per category; raises ValueError naming what is wrong."""
    code = str(row.get("cftc_contract_market_code", "")).strip()
    if code not in codes:
        raise ValueError(f"contract code {code!r} was not asked for")
    if str(row.get("futonly_or_combined", "")).strip() != "FutOnly":
        raise ValueError(f"{code}: not a futures-only row")
    m = _ISO.fullmatch(str(row.get("report_date_as_yyyy_mm_dd", "")).strip())
    if not m:
        raise ValueError(f"{code}: positions date {row.get('report_date_as_yyyy_mm_dd')!r} is not a date")
    as_of = m.group(1)
    if date.fromisoformat(as_of).isoformat() != as_of:
        raise ValueError(f"{code}: positions date {as_of!r} is not a date")
    name = str(row.get("market_and_exchange_names", "")).strip()
    rid = str(row.get("id", "")).strip()
    if not name or not rid:
        raise ValueError(f"{code} {as_of}: no market name or row id")
    oi = _count(row.get("open_interest_all"), "open_interest_all")
    out = []
    longs = shorts = spreads = 0
    for cat, lo, sh, sp in report.categories:
        lv, sv = _count(row.get(lo), lo), _count(row.get(sh), sh)
        pv = _count(row.get(sp), sp) if sp else None
        longs, shorts, spreads = longs + lv, shorts + sv, spreads + (pv or 0)
        out.append({"report": report.key, "contract_code": code, "as_of": as_of, "category": cat, "long": lv, "short": sv,
                    "spread": pv, "open_interest": oi, "market_name": name, "source_row_id": rid})
    if longs + spreads != oi or shorts + spreads != oi:
        raise ValueError(f"{code} {as_of}: long {longs:,} or short {shorts:,} plus spreading {spreads:,} is not the "
                         f"open interest {oi:,}")
    return out


def parse_rows(report: Report, rows: list[Mapping[str, Any]], codes: set[str]) -> tuple[list[dict], list[str]]:
    """The parsed category rows and the reasons any CFTC row was refused; a report served twice is refused both times."""
    parsed: dict[tuple[str, str], list[dict]] = {}
    refused: list[str] = []
    twice: set[tuple[str, str]] = set()
    for row in rows:
        try:
            cats = parse_row(report, row, codes)
        except ValueError as exc:
            refused.append(str(exc))
            continue
        key = (cats[0]["contract_code"], cats[0]["as_of"])
        if key in parsed:
            twice.add(key)
        parsed[key] = cats
    for key in sorted(twice):
        parsed.pop(key, None)
        refused.append(f"{key[0]} {key[1]}: served more than once")
    return [c for k in sorted(parsed) for c in parsed[k]], refused


# ── write ───────────────────────────────────────────────────────────────────

def write_rows(conn: sqlite3.Connection, report: str, codes: list[str], rows: list[dict], run_id: str, now: datetime) -> dict:
    """Insert new reports, revise changed ones (keeping the old numbers), mark reports the source no longer serves as
    withdrawn and bring back one it serves again. Returns counts."""
    ts = stamp(now)
    stored = {(r[0], r[1], r[2]): r for r in conn.execute(
        f"SELECT contract_code, as_of, category, long, short, spread, open_interest, run_id, withdrawn_at FROM {TABLE} "
        f"WHERE report = ? AND contract_code IN ({', '.join('?' * len(codes))})", (report, *codes))}
    new = revised = restored = 0
    seen: set[tuple[str, str, str]] = set()
    for r in rows:
        key = (r["contract_code"], r["as_of"], r["category"])
        seen.add(key)
        old = stored.get(key)
        nums = tuple(r[k] for k in NUMBERS)
        if old is None:
            conn.execute(f"INSERT INTO {TABLE} ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                         (report, *key, *nums, r["market_name"], r["source_row_id"], PROVIDER, run_id, ts, ts, None))
            new += 1
            continue
        if tuple(old[3:7]) != nums:
            conn.execute(f"INSERT INTO {REVISIONS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (report, *key, *old[3:7], *nums, old[7], run_id, ts))
            conn.execute(f"UPDATE {TABLE} SET long = ?, short = ?, spread = ?, open_interest = ?, market_name = ?, "
                         "source_row_id = ?, run_id = ?, stored_at = ?, withdrawn_at = NULL "
                         "WHERE report = ? AND contract_code = ? AND as_of = ? AND category = ?",
                         (*nums, r["market_name"], r["source_row_id"], run_id, ts, report, *key))
            revised += 1
        elif old[8] is not None:
            conn.execute(f"UPDATE {TABLE} SET withdrawn_at = NULL WHERE report = ? AND contract_code = ? AND as_of = ? "
                         "AND category = ?", (report, *key))
            restored += 1
    gone = [k for k, v in stored.items() if k not in seen and v[8] is None]
    for key in gone:
        conn.execute(f"UPDATE {TABLE} SET withdrawn_at = ? WHERE report = ? AND contract_code = ? AND as_of = ? AND category = ?",
                     (ts, report, *key))
    return {"new": new, "revised": revised, "restored": restored, "withdrawn": len(gone)}


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None, get: Callable[[str], Any] | None = None,
            retry_wait: float = RETRY_WAIT_S) -> dict:
    """Read the five markets' whole history from the CFTC, store it, record the run and the watermark, commit once.
    The database is opened before anything is fetched. A report whose read fails keeps what is stored."""
    now = now or datetime.now(timezone.utc)
    conn = sqlite3.connect(db_path)
    try:
        ensure_tables(conn)
        run_id = start_run(conn, SOURCE, now)
        conn.commit()
        parts: list[str] = []
        failed: list[str] = []
        counts = {"new": 0, "revised": 0, "restored": 0, "withdrawn": 0, "refused": 0}
        wrote = False
        for report in REPORTS.values():
            codes = [m.contract_code for m in MARKETS if m.report == report.key]
            try:
                raw = fetch_report(report, codes, get or http_get_json, retry_wait=retry_wait)
            except FetchFailed as exc:
                failed.append(str(exc))
                continue
            rows, refused = parse_rows(report, raw, set(codes))
            served = {r["contract_code"] for r in rows}
            missing = [c for c in codes if c not in served]
            if missing:
                # a read that serves none of a market's reports is not a full read of it: nothing is marked withdrawn
                failed.append(f"{report.title}: no report served for {', '.join(missing)}")
                codes = [c for c in codes if c in served]
            if codes:
                c = write_rows(conn, report.key, codes, [r for r in rows if r["contract_code"] in codes], run_id, now)
                wrote = True
                for k, v in c.items():
                    counts[k] += v
            counts["refused"] += len(refused)
            if refused:
                parts.append(f"{report.key}: {len(refused)} refused ({'; '.join(refused[:3])}{' …' if len(refused) > 3 else ''})")
        newest = {}
        for m in MARKETS:
            row = conn.execute(f"SELECT MAX(as_of) FROM {TABLE} WHERE report = ? AND contract_code = ? AND withdrawn_at IS NULL",
                               (m.report, m.contract_code)).fetchone()
            newest[m.key] = row[0] if row else None
        # The watermark's observation is the oldest market's newest report, so one market that stops arriving holds it back.
        oldest = min(newest.values()) if all(newest.values()) else None
        status = "ok" if not failed and oldest else ("partial" if oldest else "error")
        detail = " · ".join([f"CFTC {sum(1 for v in newest.values() if v)} of {len(MARKETS)} markets, newest report "
                             f"{oldest or 'none'}", ", ".join(f"{k} {v}" for k, v in counts.items())]
                            + parts + ([f"not read: {'; '.join(failed)}"] if failed else []))
        watermarks.record(conn, WATERMARK, oldest, status=status, detail=detail, now=now)
        # The rows a run wrote are readable only when it committed: every run that wrote any row commits.
        finish_run(conn, run_id, "committed" if wrote else "failed", detail, now)
        conn.commit()
    finally:
        conn.close()
    return {"run_id": run_id, "status": status, "detail": detail, "newest": newest, "counts": counts, "failed": failed}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store the CFTC Commitments of Traders positions for the Desk's macro futures.")
    ap.add_argument("--db", default=str(DB_PATH))
    a = ap.parse_args(argv)
    try:
        s = refresh(Path(a.db))
    except Exception as exc:  # noqa: BLE001 — never fails the refresh; validate_db warns on the watermark
        print(f"cftc_cot: not refreshed ({type(exc).__name__}: {exc})")
        return 0
    print(f"cftc_cot: {s['status']} · {s['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
