"""src/market_data/desk_history.py — the Desk's daily series store (desk/event-study).

The event-study engine needs daily history that the pipeline never held:
`raw_series` keeps one month-stamped row per FRED series (B6, never changed),
and `market_daily` starts in 2024 for everything but SPY. This step stores the
registry's fred and market series (src/desk/series.py) as daily observations
in the additive `desk_series` table, one row per (series_id, date), the value
exactly as the source serves it (percent for yields and OAS, USD/oz, index
level, adjusted close). Unit conversion belongs to the engine, which declares
it per series; the store never converts.

Rules it follows (Max, 2026-09-21): its own table and watermark, never
`asset_prices` or the allocation freshness logic; the server process never
calls Yahoo, so the market series come through the same EODHD-first /
Yahoo-fallback path the allocation refresh uses (api/providers/market
.daily_history with allow_yahoo=True), which only ever runs in the GitHub
Actions full refresh or on an owner's laptop; FRED pulls run in the same step.
A market bar is stored only once its session is complete (B6), and a bar
for a series fixed on the clock after the close (the dollar index at 17:00 ET,
USD/JPY at 20:00 ET) only once that time has passed (verifier V-07,
desk/hardening); a FRED observation is an official value and is stored as
dated. A market series is
replaced whole on every run (adjusted closes restate through history); a FRED
series is merged, because FRED now serves the ICE BofA OAS series as a rolling
three-year window ("Starting in April 2026, this series will only include 3
years of observations", BAMLH0A0HYM2 notes, checked 2026-09-21) and a replace
would forget every observation it stopped serving. A series whose first
stored date is later than the registry's declared `history_from` gets
watermark status `short` and is named in the table's detail. A provider error
keeps the previous rows and says so in the watermark, and the step never fails
the refresh: scripts/validate_db.py judges the table.

Each series is written, with its watermark, in its own savepoint (review
R-04, desk/hardening): a write that fails part-way rolls back that series
alone, its previous rows stand, and the others keep what they stored. The
command exits 1 only when a tier-1 series failed (or the store could not run
at all), and 0 when only tier-2 series did (review R-08). That is stricter
than validate_db, which only warns when a tier-1 fetch failed this run but
the series keeps its rows; the workflow step continues on error either way. A
tier-2 row dated after its provider's current trading day is excluded,
incoming or already stored, and the watermark says so (review R-03): New
York's date, or for an instrument traded round the clock the date in Tokyo
(verifier V-31, `provider_day`), so the evening run's in-progress USD/JPY
bar, dated the next London day, is dropped by the session filter and never
called future; a tier-1 FRED observation is stored as served, and
validate_db fails a future-dated one.
Every run starts by moving the stored ones to `desk_series_quarantine`,
before it fetches anything, so a series whose fetch then fails is cleaned
too (review R-06); an incoming one is recorded there as well, the latest kept per series and date.
The quarantine keeps each value exactly as stored, and as text, never
converting it, and runs per series in its own savepoint: one that fails
fails that series alone, and the rest of the run goes on (review R-08).
A stored market row is judged as a completed session, whatever its
provider's day (Codex R-16): at the start of every run, one dated after the
last completed New York session, or on it before its fixing time, is moved
to the quarantine too; the provider's day (V-31) only classifies incoming
bars.

Provenance (Codex R-14, R-15, api/provenance.py). Every run first applies
the provenance migration, then records itself in `desk_series_runs`; every
row it writes carries its `run_id` and `ingested_at`, and the run is marked
committed inside the same savepoint as each series' write, so a row and its
run's commit land together. The Desk reads only rows a committed run wrote,
dated no later than that run's New York date; a row inserted by anything
else has no provenance and is set aside, and on a migrated table a write
without provenance raises (Codex R-19). `--repair SERIES` is the owner's path
after a bogus future print: it moves the series' rows the reader sets aside
(no provenance, or dated after their run's day) to the quarantine and resets
the series' watermark to its newest committed row, stamped when that row was
committed. Without `--apply` it is a dry run of exactly that on an in-memory
copy (Codex R-22); moving more than 10% of a series, or rows its provider can
no longer serve, needs `--force` (Codex R-21).

Run:  python -m src.market_data.desk_history [--db data/macro_radar.db] [--tier 2]
Needs FRED_API_KEY (env or repo-root .env) for the FRED series; the market
series use EODHD_API_TOKEN when present and Yahoo, disclosed, when not.

Calls per run (desk/hardening, 2026-09-23). Tier 1: five FRED requests, no
provider-layer call. Tier 2, the full refresh's tier: six FRED requests (the
five plus DCOILWTICO) and one daily-history request per market series (^NDX,
DX-Y.NYB, JPY=X): three EODHD requests with a token (one unit each), each
retried at most twice on a timeout, a 429 or a 5xx, and one Yahoo download
per series EODHD cannot answer. The Actions workflow carries no EODHD token, so there the three go to
Yahoo and EODHD sees none. A FRED request is retried at most twice.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import calendar as cal  # noqa: E402
from api.providers import eodhd as eod  # noqa: E402
from api.providers import market  # noqa: E402
from api.providers.errors import ProviderError  # noqa: E402
from src import watermarks  # noqa: E402
from src.desk import series as registry  # noqa: E402
from api import provenance  # noqa: E402

log = logging.getLogger("mrr.desk_history")

DB_PATH = ROOT / "data" / "macro_radar.db"
WATERMARK = "desk_series"          # the table's summary: as-of = the oldest newest observation
SERIES_WATERMARK = "desk:{}"       # one per series_id, so freshness can name the laggard
DEFAULT_TIER = 2  # registry.REFRESH_TIER, the tier the full refresh stores (tests/test_desk_api.py pins them equal)

DDL = """
CREATE TABLE IF NOT EXISTS desk_series (
    series_id TEXT NOT NULL,   -- FRED id or the symbol as src/desk/series.py spells it
    date      TEXT NOT NULL,   -- YYYY-MM-DD, the observation or session date
    value     REAL NOT NULL,   -- as served: percent for yields/OAS, USD/oz, index level, adjusted close
    provider  TEXT NOT NULL,   -- fred | eodhd | yfinance
    PRIMARY KEY (series_id, date)
) WITHOUT ROWID
"""


QUARANTINE_DDL = """
CREATE TABLE IF NOT EXISTS desk_series_quarantine (
    series_id      TEXT NOT NULL,
    date           TEXT NOT NULL,   -- after its provider's current trading day (provider_day): not a real observation yet
    value          NOT NULL,        -- untyped: exactly as stored, a malformed one included (review R-08)
    raw            TEXT NOT NULL,   -- the same value as text
    provider       TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,   -- UTC, the store run that moved it
    reason         TEXT NOT NULL,
    PRIMARY KEY (series_id, date)
) WITHOUT ROWID
"""
QUARANTINE = "desk_series_quarantine"


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(DDL)


_UPSERT = ("ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value, raw = excluded.raw, provider = excluded.provider, "
           "quarantined_at = excluded.quarantined_at, reason = excluded.reason")


def _stamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_quarantine(conn: sqlite3.Connection, rows: list[tuple], *, reason: str, now: datetime) -> int:
    """Record incoming (series_id, date, value, provider) rows in the quarantine
    table (created on first use), newest record winning. Values are kept as
    served, and as text, never converted (review R-08)."""
    if not rows:
        return 0
    conn.execute(QUARANTINE_DDL)
    conn.executemany(
        f"INSERT INTO {QUARANTINE} (series_id, date, value, raw, provider, quarantined_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?) " + _UPSERT,
        [(sid, d, v, str(v), prov, _stamp(now), reason) for sid, d, v, prov in rows],
    )
    return len(rows)


def provider_day(spec: registry.DeskSeries | None, now: datetime) -> str:
    """Verifier V-31: the provider's own current trading day for the series
    at `now`, as an ISO date; a row dated after it is future-dated. New
    York's date for FRED and for anything traded in New York's session (and
    for a stored series the registry no longer lists); the date in Tokyo for
    an instrument traded round the clock (registry `day_zone`). A row dated
    after the last completed session but not after this day is a bar in
    progress: the session filter drops it, and it is never quarantined."""
    if spec is None or spec.day_zone == registry.NY_ZONE:
        return now.astimezone(cal.NY).date().isoformat()
    return now.astimezone(ZoneInfo(spec.day_zone)).date().isoformat()


def _dated_after(spec: registry.DeskSeries | None, day: str) -> str:
    if spec is None or spec.day_zone == registry.NY_ZONE:
        return f"dated after {day}, the store run's New York date"
    return f"dated after {day}, its provider's current trading day (the date in {spec.day_zone})"


def stored_bound(spec: registry.DeskSeries | None, now: datetime) -> tuple[str, str, str, str]:
    """(operator, date, short words, reason): the stored rows of a series the run-start scan
    moves are those with `date <operator> <date>`. A market series' stored
    rows are judged as completed sessions, whatever its provider's day (Codex
    R-16): a row dated after the last completed New York session, or on that
    session before its fixing time, is not a completed observation. Any other
    series' (FRED's) rows are judged against the run's New York date."""
    if spec is not None and spec.source == "market":
        last = cal.session_state(now)["last_completed_session"]
        if fixed_by(spec, last, now):
            return ">", last, f"dated after {last}", f"dated after {last}, the last completed session"
        return (">=", last, f"dated on or after {last} before its fixing time",
                f"dated on or after {last}, the last completed session, before its fixing time")
    today = now.astimezone(cal.NY).date().isoformat()
    return ">", today, f"dated after {today}", f"dated after {today}, the store run's New York date"


def _excluded_words(n_incoming: int, day: str, n_stored: int, spec: registry.DeskSeries, now: datetime) -> str:
    """How many rows a series lost to the quarantine this run, in words: incoming
    ones dated after its provider's day (V-31), stored ones past its `stored_bound`
    (R-16); one phrase when the two bounds read the same (a FRED series)."""
    parts: list[list] = [[n_incoming, f"dated after {day}"]] if n_incoming else []
    if n_stored:
        words = stored_bound(spec, now)[2]
        if parts and parts[0][1] == words:
            parts[0][0] += n_stored
        else:
            parts.append([n_stored, words])
    return "; ".join(f"{n} row{'s' if n != 1 else ''} {w} excluded" for n, w in parts)


def _quarantine_stored_series(conn: sqlite3.Connection, series_id: str, now: datetime) -> int:
    """Move one series' stored rows past its `stored_bound` to the quarantine,
    in SQL, the value copied as stored and cast to text there (review R-08: a
    malformed value made float() raise and stopped the whole run)."""
    op, bound, _, words = stored_bound(registry.BY_SERIES_ID.get(series_id), now)
    conn.execute(QUARANTINE_DDL)
    n = conn.execute(
        f"INSERT INTO {QUARANTINE} (series_id, date, value, raw, provider, quarantined_at, reason) "
        f"SELECT series_id, date, value, CAST(value AS TEXT), provider, ?, ? FROM desk_series WHERE series_id = ? AND date {op} ? " + _UPSERT,
        (_stamp(now), f"stored, {words}", series_id, bound),
    ).rowcount
    conn.execute(f"DELETE FROM desk_series WHERE series_id = ? AND date {op} ?", (series_id, bound))
    return max(int(n), 0)


def quarantine_stored_future_rows(conn: sqlite3.Connection, now: datetime) -> tuple[dict[str, int], dict[str, str]]:
    """Review R-06: before anything is fetched, move every stored row past its
    series' `stored_bound` (Codex R-16: a market row that is not a completed,
    fixed session; any other row dated after the run's New York date) of a
    series that is not tier 1 to the quarantine table, so a series whose
    fetch fails is cleaned too. Tier 1 is left as served: validate_db fails a
    future-dated tier-1 row. Each series in its own savepoint (review R-08):
    one that fails rolls back alone, is logged and returned as failed, and
    the next goes on. Returns (rows moved, failures) per series."""
    last = cal.session_state(now)["last_completed_session"]  # no bound is earlier than this
    ids = [r[0] for r in conn.execute("SELECT DISTINCT series_id FROM desk_series WHERE date >= ?", (last,))]
    ids = [sid for sid in ids if getattr(registry.BY_SERIES_ID.get(sid), "tier", None) != 1]
    moved: dict[str, int] = {}
    failed: dict[str, str] = {}
    for sid in sorted(ids):
        op, bound, _, _ = stored_bound(registry.BY_SERIES_ID.get(sid), now)
        if conn.execute(f"SELECT 1 FROM desk_series WHERE series_id = ? AND date {op} ? LIMIT 1", (sid, bound)).fetchone() is None:
            continue
        try:
            with _savepoint(conn, "desk_series_quarantine"):
                moved[sid] = _quarantine_stored_series(conn, sid, now)
        except DirtyConnection:
            raise  # Codex R-08
        except Exception as exc:  # noqa: BLE001 — R-08: this series fails, the run goes on
            failed[sid] = f"quarantine failed: {type(exc).__name__}"
            log.warning("desk_series: could not quarantine %s's future-dated rows (%s); it is not refreshed this run",
                        sid, type(exc).__name__)
    return moved, failed


def fred_daily(series_id: str, start: str) -> list[tuple[str, float]]:
    """Every observation from `start`, blanks (FRED's '.') dropped, sorted.
    Three attempts with a 2 s / 4 s backoff, as src/utils/fred_client does."""
    from src.utils.fred_client import get_fred_client

    client = get_fred_client()
    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            raw = client.get_series(series_id, observation_start=start)
            break
        except Exception as exc:  # noqa: BLE001 — network layer
            last_exc = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    else:
        raise last_exc  # type: ignore[misc]
    if raw is None or raw.empty:
        raise ValueError(f"FRED returned no observations for {series_id}")
    raw = raw.dropna().sort_index()
    return [(idx.strftime("%Y-%m-%d"), float(v)) for idx, v in raw.items()]


class ProvenanceRequired(ValueError):
    """A desk_series write that would leave a value without its own run (Codex R-19)."""


def write_series(conn: sqlite3.Connection, series_id: str, rows: list[tuple[str, float]], *, provider: str, merge: bool,
                 run_id: str | None = None, ingested_at: str | None = None) -> int:
    """Store one series. `merge=False` replaces it whole (market closes restate
    through history after every dividend, so the old basis must go).
    `merge=True` upserts: a FRED observation is revised in place, never
    restated, and FRED now serves the ICE BofA series as a rolling three-year
    window (BAMLH0A0HYM2 notes, 2026-09-21), so a replace would lose every
    observation FRED stopped serving. Values are kept as served, negative ones
    included (T10Y2Y inverts); nothing is filtered but nulls. Every row written,
    a merged one included, carries the run that committed it and `ingested_at`
    (Codex R-14); a row the fetch did not serve keeps its own.

    Codex R-19: on a table with provenance, a write without both raises
    ProvenanceRequired before it touches anything, so no value is ever
    replaced under another run's provenance. Only a table not yet migrated
    (a synthetic test store) takes an unstamped write, and it cannot take a
    stamped one."""
    migrated = provenance.is_migrated(conn)
    if migrated and (run_id is None or ingested_at is None):
        raise ProvenanceRequired(f"desk_series has provenance: a write of {series_id} needs its run_id and ingested_at (Codex R-19)")
    if not migrated and run_id is not None:
        raise ProvenanceRequired("desk_series has no provenance columns yet: migrate it first (api/provenance.migrate)")
    if not merge:
        conn.execute("DELETE FROM desk_series WHERE series_id = ?", (series_id,))
    if run_id is None:
        kept = [(series_id, d, float(v), provider) for d, v in rows if v is not None]
        conn.executemany(
            "INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value, provider = excluded.provider",
            kept,
        )
        return len(kept)
    kept = [(series_id, d, float(v), provider, run_id, ingested_at) for d, v in rows if v is not None]
    conn.executemany(
        "INSERT INTO desk_series (series_id, date, value, provider, run_id, ingested_at) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value, provider = excluded.provider, "
        "run_id = excluded.run_id, ingested_at = excluded.ingested_at",
        kept,
    )
    return len(kept)


def fixed_by(spec: registry.DeskSeries, session: str, now: datetime) -> bool:
    """Whether a market series' value for `session` is determined at `now`:
    one fixed on the clock (registry `fixed`, New York time) prints its bar
    for that date only then, and before it the provider's bar is still moving
    (V-07). One fixed at the session close is complete with the session."""
    anchor, minutes = spec.fixed
    if anchor != "clock":
        return True
    d = date.fromisoformat(session)
    return now >= datetime(d.year, d.month, d.day, minutes // 60, minutes % 60, tzinfo=cal.NY)


def _wait_for_upstream_budget(timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while not eod._bucket.available() and time.monotonic() < deadline:
        time.sleep(0.05)


def stored_summary(conn: sqlite3.Connection) -> dict[str, dict]:
    """Per stored series: first and last date, row count, provider."""
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desk_series'").fetchone()
    if not exists:
        return {}
    out: dict[str, dict] = {}
    for sid, mn, mx, n, prov in conn.execute(
        "SELECT series_id, MIN(date), MAX(date), COUNT(*), MIN(provider) FROM desk_series GROUP BY series_id"
    ):
        out[sid] = {"first": mn, "last": mx, "rows": n, "provider": prov}
    return out


def _connect(db_path: Path | str) -> sqlite3.Connection:
    """The store's connection, in autocommit mode: each savepoint is its own transaction."""
    return sqlite3.connect(db_path, isolation_level=None)


class DirtyConnection(RuntimeError):
    """The store's connection is inside a transaction where it must not be (Codex R-08)."""


def _assert_clean(conn: sqlite3.Connection) -> None:
    """Codex R-08: every savepoint starts outside any transaction. One left
    open would make the next series' writes part of it, and closing the
    connection would roll them back after the store had reported them."""
    if conn.in_transaction:
        raise DirtyConnection("the store's connection is still inside a transaction; nothing more is written this run")


def _undo(conn: sqlite3.Connection, name: str) -> None:
    """Roll one savepoint back and close it. If even that fails, roll the
    transaction back whole: each series' savepoint is the outermost, so that
    is this series' work and nothing else. Afterwards the connection must be
    outside any transaction."""
    try:
        conn.execute(f"ROLLBACK TO {name}")
        conn.execute(f"RELEASE {name}")
    except sqlite3.Error:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
    _assert_clean(conn)


@contextmanager
def _savepoint(conn: sqlite3.Connection, name: str = "desk_series_write"):
    """One series' write, atomic on its own (review R-04). The connection is
    in autocommit mode, so the savepoint is its own transaction: RELEASE
    commits it, and a failure rolls back to it and re-raises. Codex R-08: a
    RELEASE that itself fails ("database is locked") used to leave the
    savepoint, and so the transaction, open; it is now rolled back and closed
    like any other failure, and the series is failed."""
    _assert_clean(conn)
    conn.execute(f"SAVEPOINT {name}")
    try:
        yield
    except BaseException:
        _undo(conn, name)
        raise
    try:
        conn.execute(f"RELEASE {name}")
    except sqlite3.Error:
        _undo(conn, name)
        raise


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None, tier: int = DEFAULT_TIER) -> dict:
    """Fetch every registry series at `tier`, replace what arrived, keep what
    did not, and record the watermarks, each series in its own savepoint.
    Returns a summary for the log."""
    now = now or datetime.now(timezone.utc)
    last_session = cal.session_state(now)["last_completed_session"]
    conn = _connect(db_path)  # autocommit: each savepoint commits on its own (R-04)
    try:
        ensure_table(conn)
        provenance.migrate(conn, now)  # Codex R-14: idempotent; back-fills a pre-provenance store once
        with _savepoint(conn):
            run_id, _run_as_of = provenance.start_run(conn, now)
        ingested_at = _stamp(now)
        stored: list[str] = []
        failed: dict[str, str] = {}
        short: dict[str, str] = {}
        provider_of: dict[str, str] = {}
        # R-06: first, whatever any fetch below does; R-08: a series whose
        # quarantine failed is failed for this run and not fetched
        moved, quarantine_failed = quarantine_stored_future_rows(conn, now)
        failed.update(quarantine_failed)
        excluded: dict[str, int] = dict(moved)
        for spec in registry.fetched(tier):
            if spec.series_id in quarantine_failed:
                continue
            try:
                if spec.source == "fred":
                    rows = fred_daily(spec.series_id, spec.history_from)
                    provider = "fred"
                else:
                    if spec.eodhd:
                        _wait_for_upstream_budget()
                    env = market.daily_history(spec.eodhd, spec.series_id, spec.history_from, None, allow_yahoo=True)
                    rows = list(env["rows"])  # raw: the future split comes first (Codex R-10), the session filters after
                    provider = env["provider"]
            except ProviderError as exc:
                failed[spec.series_id] = exc.kind
                continue
            except Exception as exc:  # noqa: BLE001 — a FRED error must not fail the refresh
                failed[spec.series_id] = type(exc).__name__
                continue
            # R-03, Codex R-10: a tier-2 row dated after its provider's current trading day is split
            # off the raw response first, whichever the store, and quarantined; only then do market
            # rows meet the session-completion and fixing-time filters, which used to drop future
            # rows unseen. V-31: that day is the instrument's own, not New York's, so the evening
            # run's in-progress USD/JPY bar (the next London day) goes to the filters and is dropped.
            day = provider_day(spec, now)
            after = _dated_after(spec, day)
            future = [r for r in rows if r[0] > day] if spec.tier >= 2 else []
            if future:
                rows = [r for r in rows if r[0] <= day]
            if spec.source != "fred":
                rows = [r for r in rows if r[0] < last_session or (r[0] == last_session and fixed_by(spec, last_session, now))]
            if not rows and future:
                # V-16, Codex R-10: served, but only rows dated after the run: not "empty". They go to
                # the quarantine through the same path as any incoming future-dated row (R-06).
                n = len(future)
                try:
                    with _savepoint(conn):
                        _to_quarantine(conn, [(spec.series_id, d, v, provider) for d, v in future],
                                       reason=f"served, {after}", now=now)
                    excluded[spec.series_id] = excluded.get(spec.series_id, 0) + n
                    failed[spec.series_id] = f"served only future-dated rows: {n} quarantined"
                except DirtyConnection:
                    raise  # Codex R-08
                except Exception as exc:  # noqa: BLE001 — R-08: this series fails, the run goes on
                    failed[spec.series_id] = f"quarantine failed: {type(exc).__name__}"
                log.warning("desk_series: %s served only future-dated rows (%d, after %s); %s", spec.series_id, n, day,
                            failed[spec.series_id])
                continue
            if not rows:
                failed[spec.series_id] = "empty"
                continue
            try:
                with _savepoint(conn):
                    _to_quarantine(conn, [(spec.series_id, d, v, provider) for d, v in future],
                                   reason=f"served, {after}", now=now)
                    write_series(conn, spec.series_id, rows, provider=provider, merge=(spec.source == "fred"),
                                 run_id=run_id, ingested_at=ingested_at)
                    provenance.mark_committed(conn, run_id, now)  # R-14: the rows and their run's commit land together
                    first = conn.execute("SELECT MIN(date) FROM desk_series WHERE series_id = ?", (spec.series_id,)).fetchone()[0]
                    detail = f"{provider}; served from {rows[0][0]}; stored from {first}; {len(rows)} rows"
                    status = "ok"
                    if first > spec.history_from:
                        # The source serves less than the registry declares: the study's
                        # sample start is later than the assets list says, so say so.
                        status = "short"
                        detail += f"; declared {spec.history_from}"
                    n_excluded = len(future) + moved.get(spec.series_id, 0)
                    if n_excluded:
                        status = "excluded" if status == "ok" else status
                        detail += f"; {_excluded_words(len(future), day, moved.get(spec.series_id, 0), spec, now)}, moved to {QUARANTINE} (tier {spec.tier})"
                    watermarks.record(conn, SERIES_WATERMARK.format(spec.series_id), rows[-1][0], rows[-1][1],
                                      status=status, detail=detail, now=now)
            except DirtyConnection:
                raise  # Codex R-08: never write on after the connection could not be cleaned
            except Exception as exc:  # noqa: BLE001 — R-04: this series rolls back alone; the refresh goes on
                failed[spec.series_id] = f"write failed: {type(exc).__name__}"
                continue
            stored.append(spec.series_id)
            provider_of[spec.series_id] = provider
            if status == "short":
                short[spec.series_id] = first
            if n_excluded:
                excluded[spec.series_id] = n_excluded
        for sid, kind in failed.items():
            n = moved.get(sid, 0)
            if n:  # R-06: the failed series was cleaned before its fetch; say so
                words = stored_bound(registry.BY_SERIES_ID.get(sid), now)[2]
                kind += f"; {n} row{'s' if n != 1 else ''} {words} moved to {QUARANTINE}"
            try:
                with _savepoint(conn):
                    watermarks.record(conn, SERIES_WATERMARK.format(sid), None, status="error", detail=kind, now=now)
            except DirtyConnection:
                raise  # Codex R-08
            except Exception:  # noqa: BLE001 — the table's watermark below still names it
                pass

        summary = stored_summary(conn)
        wanted = [s.series_id for s in registry.fetched(tier)]
        newest = [summary[s]["last"] for s in wanted if s in summary]
        as_of = min(newest) if newest and len(newest) == len(wanted) else (min(newest) if newest else None)
        counts: dict[str, int] = {}
        for p in provider_of.values():
            counts[p] = counts.get(p, 0) + 1
        fallbacks = sorted(s for s, p in provider_of.items() if p == "yfinance")
        detail = " · ".join(f"{p} {n}" for p, n in sorted(counts.items()))
        if fallbacks:
            detail += f" (fallback: {', '.join(fallbacks)})"
        missing = [s for s in wanted if s not in summary]
        if missing:
            detail += f"; not stored: {', '.join(missing)}"
        if short:
            detail += f"; short history: {', '.join(f'{s} (from {d})' for s, d in sorted(short.items()))}"
        if excluded:
            detail += f"; future-dated rows excluded: {', '.join(f'{s} ({n})' for s, n in sorted(excluded.items()))}"
        if failed:
            detail += f"; failed: {', '.join(f'{s} ({k})' for s, k in sorted(failed.items()))}"
        status = "ok" if not failed else ("partial" if stored else "error")
        with _savepoint(conn):
            watermarks.record(conn, WATERMARK, as_of if stored else None, status=status, detail=detail or None, now=now)
    finally:
        conn.close()
    return {
        "stored": stored,
        "failed": sorted(failed),
        "providers": counts,
        "fallbacks": fallbacks,
        "as_of": as_of,
        "status": status,
        "short": short,
        "excluded": excluded,
        "tier": tier,
        "run_id": run_id,
    }


# Verifier V-37, Codex R-21: series whose provider serves less history than the store
# keeps. A quarantined row older than the provider's window cannot be fetched again.
REFETCH_WINDOW = {
    "BAMLH0A0HYM2": (3, "FRED serves HY OAS as a rolling three-year window"),
}
REPAIR_MAX_SHARE = 0.10  # Codex R-21: moving more than this share of a series' rows needs --force


def _unrefetchable(series_id: str, dates: list[str], now: datetime) -> tuple[int, str | None]:
    """How many of `dates` fall before the provider's current window, and its start."""
    window = REFETCH_WINDOW.get(series_id)
    if window is None:
        return 0, None
    today = now.astimezone(cal.NY).date()
    try:
        start = today.replace(year=today.year - window[0])
    except ValueError:  # 29 February, and no such day that year: 1 March, the later and so safer start (V-41)
        start = date(today.year - window[0], 3, 1)
    start_s = start.isoformat()
    return sum(1 for d in dates if isinstance(d, str) and d < start_s), start_s


def repair(db_path: Path | str, series_id: str, *, apply: bool = False, force: bool = False, now: datetime | None = None) -> dict:
    """The owner's repair after a bogus print (Codex R-15). It moves the
    series' stored rows the Desk's reader sets aside for provenance, none (no
    committed refresh wrote them) or dated after the New York date of the run
    that committed them, to the quarantine, and resets the series' `desk:<id>`
    watermark to its newest remaining committed row, with `advanced_at` the
    time that row was committed (status `repaired`), in one savepoint. The
    next refresh advances from there. Run it where the database lives (`make
    sync-data` fetches the published one), then publish as usual.

    Codex R-21: it refuses unless `force` when it would move more than
    REPAIR_MAX_SHARE of the series' rows, or any row the provider can no
    longer serve (older than its window, REFETCH_WINDOW: HY OAS), and it warns
    whenever it moves such rows, forced or not. Codex R-22: without `apply` it
    is a dry run of exactly that, on an in-memory copy of the database, the
    migration a legacy table would take included, so the preview is what
    `apply` would do; the file is only read."""
    now = now or datetime.now(timezone.utc)
    if not Path(db_path).is_file():  # verifier V-41: never create a database, never a traceback
        return {"series_id": series_id, "rows": [], "applied": False, "dry_run": not apply, "missing": True,
                "refused": True, "reason": f"refused: there is no database at {db_path}"}
    if not _is_sqlite(db_path):  # Codex R-25: read 16 bytes, never open it as a database
        return {"series_id": series_id, "rows": [], "applied": False, "dry_run": not apply, "not_sqlite": True,
                "blocked": True, "refused": True, "reason": f"refused: {db_path} is not a SQLite database"}
    try:
        if apply:
            conn = _connect(db_path)
            try:
                conn.execute(f"PRAGMA busy_timeout = {int(REPAIR_LOCK_WAIT_S * 1000)}")
                return _repair_on(conn, series_id, force=force, now=now, dry=False)
            finally:
                conn.close()
        src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=REPAIR_LOCK_WAIT_S, isolation_level=None)
        copy = sqlite3.connect(":memory:", isolation_level=None)
        try:
            # R-28: take the read lock first, within the wait, so a writer holding the file is a
            # refusal; Connection.backup would retry a busy source without end
            src.execute("BEGIN")
            src.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
            src.backup(copy)
            src.execute("COMMIT")
            return _repair_on(copy, series_id, force=force, now=now, dry=True)
        finally:
            src.close()
            copy.close()
    except sqlite3.DatabaseError as exc:
        # Codex R-28, R-29: the lock could not be taken, or the file could not be read. _repair_on
        # rolled back whatever it had begun, so nothing changed; say which, and exit 1
        base = {"series_id": series_id, "rows": [], "applied": False, "dry_run": not apply, "blocked": True, "refused": True}
        if _is_lock_error(exc):
            return {**base, "locked": True, "reason": "refused: the database is locked by another writer; nothing changed; retry"}
        return {**base, "unreadable": True, "reason": f"refused: database unreadable: {exc}; nothing changed"}


SQLITE_HEADER = b"SQLite format 3\x00"
REPAIR_LOCK_WAIT_S = 5.0  # Codex R-28: how long a repair waits for another writer before it refuses


def _is_lock_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return isinstance(exc, sqlite3.OperationalError) and ("locked" in text or "busy" in text)


def _is_sqlite(path: Path | str) -> bool:
    try:
        with open(path, "rb") as fh:
            return fh.read(16) == SQLITE_HEADER
    except OSError:
        return False


def _repair_on(conn: sqlite3.Connection, series_id: str, *, force: bool, now: datetime, dry: bool) -> dict:
    """`repair` on a connection: the file's own (apply), or an in-memory copy (a
    dry run). Codex R-24: the whole repair holds the database's write lock, from
    before it selects its candidates (BEGIN IMMEDIATE) to its commit, so no
    other writer (a refresh) can change the rows between the check and the
    move: it moves exactly the rows it checked and reports them. A refusal,
    and anything that is not an applied repair, rolls back: nothing is kept."""
    _assert_clean(conn)
    conn.execute("BEGIN IMMEDIATE")
    try:
        out = _repair_locked(conn, series_id, force=force, now=now, dry=dry)
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    conn.execute("COMMIT" if out.get("applied") else "ROLLBACK")
    return out


def _repair_locked(conn: sqlite3.Connection, series_id: str, *, force: bool, now: datetime, dry: bool) -> dict:
    provenance.migrate(conn, now)
    out: dict = {"series_id": series_id, "rows": [], "applied": False, "dry_run": dry}
    if not provenance.is_migrated(conn):
        out["reason"] = "no desk_series table in this database"
        return out
    bad = (f"FROM desk_series d {provenance.COMMITTED_JOIN} WHERE d.series_id = ? "
           "AND (r.run_id IS NULL OR d.date > r.as_of)")
    rows = [tuple(r) for r in conn.execute(f"SELECT d.date, d.value, d.run_id {bad} ORDER BY d.date", (series_id,))]
    total = conn.execute("SELECT COUNT(*) FROM desk_series WHERE series_id = ?", (series_id,)).fetchone()[0]
    out.update(rows=rows, total=int(total), remaining=int(total) - len(rows))
    if not rows:
        out["result"] = "nothing to repair"
        return out
    lost, window_start = _unrefetchable(series_id, [r[0] for r in rows], now)
    out["unrefetchable"] = lost
    if lost:
        out["warning"] = (f"{lost} of the {len(rows)} rows it moves are dated before {window_start}: "
                          f"{REFETCH_WINDOW[series_id][1]}, so they cannot be fetched again and would exist only in {QUARANTINE}")
    share = len(rows) / total
    if (share > REPAIR_MAX_SHARE or lost) and not force:
        why = (f"it would move {len(rows)} of the {total} rows of {series_id} ({share:.1%}), leaving {total - len(rows)}"
               + (f"; {out['warning']}" if lost else ""))
        out["refused"] = True
        out["reason"] = (f"dry run, nothing written: --apply would refuse: {why}. Pass --force to move them anyway" if dry
                         else f"refused: {why}. Pass --force to move them anyway")
        return out
    stamp = _stamp(now)
    conn.execute("SAVEPOINT desk_series_repair")
    try:
        conn.execute(QUARANTINE_DDL)
        # R-24: exactly the checked set, keyed by date (an untyped column keeps each date's own type)
        conn.execute("CREATE TEMP TABLE IF NOT EXISTS desk_series_repair_set (date PRIMARY KEY)")
        conn.execute("DELETE FROM desk_series_repair_set")
        conn.executemany("INSERT INTO desk_series_repair_set (date) VALUES (?)", [(r[0],) for r in rows])
        conn.execute(
            f"INSERT INTO {QUARANTINE} (series_id, date, value, raw, provider, quarantined_at, reason) "
            f"SELECT d.series_id, d.date, d.value, CAST(d.value AS TEXT), d.provider, ?, "
            f"CASE WHEN r.run_id IS NULL THEN 'repair: no committed refresh wrote it' "
            f"ELSE 'repair: dated after ' || r.as_of || ', the New York date of the refresh that stored it' END "
            f"FROM desk_series d {provenance.COMMITTED_JOIN} WHERE d.series_id = ? "
            "AND d.date IN (SELECT date FROM desk_series_repair_set) " + _UPSERT,
            (stamp, series_id))
        moved = conn.execute("DELETE FROM desk_series WHERE series_id = ? AND date IN (SELECT date FROM desk_series_repair_set)",
                             (series_id,)).rowcount
        if moved != len(rows):  # cannot happen under the write lock; never report one set and move another
            raise RuntimeError(f"repair of {series_id}: checked {len(rows)} rows but would move {moved}")
        newest = conn.execute(
            f"SELECT d.date, d.value, d.ingested_at FROM desk_series d {provenance.COMMITTED_JOIN} WHERE d.series_id = ? "
            "AND r.run_id IS NOT NULL AND d.date <= r.as_of ORDER BY d.date DESC LIMIT 1", (series_id,)).fetchone()
        watermarks.ensure_table(conn)
        detail = f"repaired {stamp}: {len(rows)} row{'s' if len(rows) != 1 else ''} moved to {QUARANTINE}"
        if newest:
            conn.execute("INSERT INTO source_watermarks (source, last_obs, last_value, advanced_at, checked_at, status, detail) "
                         "VALUES (?, ?, ?, ?, ?, 'repaired', ?) ON CONFLICT(source) DO UPDATE SET last_obs = excluded.last_obs, "
                         "last_value = excluded.last_value, advanced_at = excluded.advanced_at, checked_at = excluded.checked_at, "
                         "status = excluded.status, detail = excluded.detail",
                         (SERIES_WATERMARK.format(series_id), newest[0], newest[1], newest[2], stamp, detail))
        conn.execute("DROP TABLE temp.desk_series_repair_set")
        conn.execute("RELEASE desk_series_repair")
    except BaseException:
        conn.execute("ROLLBACK TO desk_series_repair")
        conn.execute("RELEASE desk_series_repair")
        raise
    out["applied"] = not dry
    out["newest"] = newest[0] if newest else None
    n = f"{len(rows)} row{'s' if len(rows) != 1 else ''}"
    if dry:
        out["result"] = (f"dry run, nothing written: --apply would move {n} to {QUARANTINE} and "
                         + (f"reset the watermark to {newest[0]}, the newest committed row" if newest
                            else "leave the watermark unchanged: no committed row would remain"))
    else:
        out["result"] = (f"moved {n} to {QUARANTINE}; "
                         + (f"watermark reset to {newest[0]}, the newest committed row" if newest
                            else "watermark left unchanged: no committed row remains"))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store the Desk's daily series (full refresh).")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--tier", type=int, default=DEFAULT_TIER, help="fetch registry tiers up to this (1 or 2; the full refresh runs 2)")
    ap.add_argument("--repair", metavar="SERIES_ID", help="list (and with --apply, quarantine) the rows the Desk sets aside for provenance, "
                                                          "and reset the series' watermark (Codex R-15); fetches nothing")
    ap.add_argument("--apply", action="store_true", help="with --repair: write the repair")
    ap.add_argument("--force", action="store_true", help=f"with --repair: move more than {REPAIR_MAX_SHARE:.0%} of a series' rows, or rows its "
                                                         "provider can no longer serve (Codex R-21)")
    a = ap.parse_args(argv)
    if a.repair:
        r = repair(Path(a.db), a.repair, apply=a.apply, force=a.force)
        for d, v, rid in r["rows"]:
            print(f"{a.repair} {d} {v!r} run {rid or '(none)'}")
        if r.get("warning"):  # R-21: whenever rows the provider cannot serve again would move
            print(f"desk_series repair {a.repair}: WARNING {r['warning']}")
        print(f"desk_series repair {a.repair}: {len(r['rows'])} row(s) set aside by the reader; "
              + (r.get("reason") if r.get("refused") else r.get("result") or r.get("reason", "")))
        return 1 if r.get("missing") or r.get("blocked") or (r.get("refused") and not r.get("dry_run")) else 0
    try:
        s = refresh(Path(a.db), tier=a.tier)
    except Exception as exc:  # noqa: BLE001 — nothing was refreshed, tier 1 included (R-08); validate_db judges the table
        print(f"desk_series: the store could not run ({type(exc).__name__}); validate_db judges the table", file=sys.stderr)
        return 1
    print(
        f"desk_series: {len(s['stored'])} series stored as of {s['as_of']} (tier {s['tier']}) · providers {s['providers']}"
        + (f" · fallback {', '.join(s['fallbacks'])}" if s["fallbacks"] else "")
        + (f" · FAILED {', '.join(s['failed'])}" if s["failed"] else "")
        + (f" · SHORT {', '.join(f'{k} from {v}' for k, v in sorted(s['short'].items()))}" if s["short"] else "")
        + (f" · EXCLUDED {', '.join(f'{k} ({v} future-dated)' for k, v in sorted(s['excluded'].items()))}" if s["excluded"] else "")
    )
    # R-08: any tier-1 failure exits 1 (stricter than validate_db, which warns while the rows
    # stand); a tier-2 failure is a warning, as validate_db judges it
    tier1_failed = [sid for sid in s["failed"] if getattr(registry.BY_SERIES_ID.get(sid), "tier", None) == 1]
    if tier1_failed:
        print(f"desk_series: tier 1 failed: {', '.join(tier1_failed)}; validate_db judges the table", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
