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
A market bar is stored only once its session is complete (B6); a FRED
observation is an official value and is stored as dated. A market series is
replaced whole on every run (adjusted closes restate through history); a FRED
series is merged, because FRED now serves the ICE BofA OAS series as a rolling
three-year window ("Starting in April 2026, this series will only include 3
years of observations", BAMLH0A0HYM2 notes, checked 2026-09-21) and a replace
would forget every observation it stopped serving. A series whose first
stored date is later than the registry's declared `history_from` gets
watermark status `short` and is named in the table's detail. A provider error
keeps the previous rows and says so in the watermark, and the step never fails
the refresh: scripts/validate_db.py judges the table.

Run:  python -m src.market_data.desk_history [--db data/macro_radar.db] [--tier 1]
Needs FRED_API_KEY (env or repo-root .env) for the FRED series; the market
series use EODHD_API_TOKEN when present and Yahoo, disclosed, when not.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import calendar as cal  # noqa: E402
from api.providers import eodhd as eod  # noqa: E402
from api.providers import market  # noqa: E402
from api.providers.errors import ProviderError  # noqa: E402
from src import watermarks  # noqa: E402
from src.desk import series as registry  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
WATERMARK = "desk_series"          # the table's summary: as-of = the oldest newest observation
SERIES_WATERMARK = "desk:{}"       # one per series_id, so freshness can name the laggard
DEFAULT_TIER = 1

DDL = """
CREATE TABLE IF NOT EXISTS desk_series (
    series_id TEXT NOT NULL,   -- FRED id or the symbol as src/desk/series.py spells it
    date      TEXT NOT NULL,   -- YYYY-MM-DD, the observation or session date
    value     REAL NOT NULL,   -- as served: percent for yields/OAS, USD/oz, index level, adjusted close
    provider  TEXT NOT NULL,   -- fred | eodhd | yfinance
    PRIMARY KEY (series_id, date)
) WITHOUT ROWID
"""


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(DDL)


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


def write_series(conn: sqlite3.Connection, series_id: str, rows: list[tuple[str, float]], *, provider: str, merge: bool) -> int:
    """Store one series. `merge=False` replaces it whole (market closes restate
    through history after every dividend, so the old basis must go).
    `merge=True` upserts: a FRED observation is revised in place, never
    restated, and FRED now serves the ICE BofA series as a rolling three-year
    window (BAMLH0A0HYM2 notes, 2026-09-21), so a replace would lose every
    observation FRED stopped serving. Values are kept as served, negative ones
    included (T10Y2Y inverts); nothing is filtered but nulls."""
    kept = [(series_id, d, float(v), provider) for d, v in rows if v is not None]
    if not merge:
        conn.execute("DELETE FROM desk_series WHERE series_id = ?", (series_id,))
    conn.executemany(
        "INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value, provider = excluded.provider",
        kept,
    )
    return len(kept)


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


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None, tier: int = DEFAULT_TIER) -> dict:
    """Fetch every registry series at `tier`, replace what arrived, keep what
    did not, record the watermarks, commit once. Returns a summary for the log."""
    now = now or datetime.now(timezone.utc)
    last_session = cal.session_state(now)["last_completed_session"]
    conn = sqlite3.connect(db_path)
    try:
        ensure_table(conn)
        stored: list[str] = []
        failed: dict[str, str] = {}
        short: dict[str, str] = {}
        provider_of: dict[str, str] = {}
        for spec in registry.fetched(tier):
            try:
                if spec.source == "fred":
                    rows = fred_daily(spec.series_id, spec.history_from)
                    provider = "fred"
                else:
                    if spec.eodhd:
                        _wait_for_upstream_budget()
                    env = market.daily_history(spec.eodhd, spec.series_id, spec.history_from, None, allow_yahoo=True)
                    rows = [r for r in env["rows"] if r[0] <= last_session]
                    provider = env["provider"]
            except ProviderError as exc:
                failed[spec.series_id] = exc.kind
                continue
            except Exception as exc:  # noqa: BLE001 — a FRED error must not fail the refresh
                failed[spec.series_id] = type(exc).__name__
                continue
            if not rows:
                failed[spec.series_id] = "empty"
                continue
            write_series(conn, spec.series_id, rows, provider=provider, merge=(spec.source == "fred"))
            stored.append(spec.series_id)
            provider_of[spec.series_id] = provider
            first = conn.execute("SELECT MIN(date) FROM desk_series WHERE series_id = ?", (spec.series_id,)).fetchone()[0]
            detail = f"{provider}; served from {rows[0][0]}; stored from {first}; {len(rows)} rows"
            status = "ok"
            if first > spec.history_from:
                # The source serves less than the registry declares: the study's
                # sample start is later than the assets list says, so say so.
                short[spec.series_id] = first
                status = "short"
                detail += f"; declared {spec.history_from}"
            watermarks.record(conn, SERIES_WATERMARK.format(spec.series_id), rows[-1][0], rows[-1][1],
                              status=status, detail=detail, now=now)
        for sid, kind in failed.items():
            watermarks.record(conn, SERIES_WATERMARK.format(sid), None, status="error", detail=kind, now=now)

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
        if failed:
            detail += f"; failed: {', '.join(f'{s} ({k})' for s, k in sorted(failed.items()))}"
        status = "ok" if not failed else ("partial" if stored else "error")
        watermarks.record(conn, WATERMARK, as_of if stored else None, status=status, detail=detail or None, now=now)
        conn.commit()
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
        "tier": tier,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store the Desk's daily series (full refresh).")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--tier", type=int, default=DEFAULT_TIER, help="fetch registry tiers up to this (1 or 2)")
    a = ap.parse_args(argv)
    s = refresh(Path(a.db), tier=a.tier)
    print(
        f"desk_series: {len(s['stored'])} series stored as of {s['as_of']} (tier {s['tier']}) · providers {s['providers']}"
        + (f" · fallback {', '.join(s['fallbacks'])}" if s["fallbacks"] else "")
        + (f" · FAILED {', '.join(s['failed'])}" if s["failed"] else "")
        + (f" · SHORT {', '.join(f'{k} from {v}' for k, v in sorted(s['short'].items()))}" if s["short"] else "")
    )
    return 0  # never fails the refresh; validate_db judges the result


if __name__ == "__main__":
    sys.exit(main())
