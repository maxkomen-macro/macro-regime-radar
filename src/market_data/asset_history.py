"""src/market_data/asset_history.py — allocation's price histories, stored by
the full refresh (fix/prelaunch-1, item 4a).

Every series src/analytics/allocation.py reads is fetched here, through the
provider layer (api/providers/market.daily_history): EODHD first where the
plan carries the instrument, Yahoo only as the disclosed fallback, and one
provider per series (a series is replaced whole or kept whole, never mixed).
The rows land in the additive `asset_prices` table, with a source watermark
the freshness contract reads; scripts/validate_db.py judges both before the
database is published. The API computes allocation from the table and never
downloads anything.

Full history is refetched on every run: adjusted closes are rewritten back
through history whenever a dividend is paid, so appending only the newest
rows would splice two adjustment bases together.

Where a token exists (a laptop, the API host) EODHD answers first. The Actions
workflow deliberately carries no EODHD token (tests/test_workflows.py pins
that), so there every series comes from the Yahoo fallback and the watermark
and the payload say so.

Run:  python -m src.market_data.asset_history [--db data/macro_radar.db]
The step never fails the refresh on a provider error: the previous rows stay,
the watermark says what failed, and validation decides.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import calendar as cal  # noqa: E402
from api.providers import eodhd as eod  # noqa: E402
from api.providers import market  # noqa: E402
from api.providers.errors import ProviderError  # noqa: E402
from api.providers.symbols import SymbolError, parse  # noqa: E402
from src import watermarks  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
WATERMARK = "asset_prices"

DDL = """
CREATE TABLE IF NOT EXISTS asset_prices (
    symbol   TEXT NOT NULL,   -- the spelling allocation.py configures (SPY, ^GSPC, GC=F, EURUSD=X, ...)
    interval TEXT NOT NULL CHECK (interval IN ('1d', '1mo')),
    date     TEXT NOT NULL,   -- YYYY-MM-DD; '1mo' rows are dated the 1st and hold the month's last close
    close    REAL NOT NULL,   -- split- and dividend-adjusted
    provider TEXT NOT NULL,   -- eodhd | yfinance
    PRIMARY KEY (symbol, interval, date)
) WITHOUT ROWID
"""

# EODHD addresses the symbol parser cannot derive from the Yahoo spelling,
# checked against EODHD on 2026-09-21. None = EODHD does not carry the
# instrument: GC=F is gold front-month futures (EODHD's XAUUSD.FOREX is spot,
# a different instrument, so it is not substituted silently).
_EODHD_OVERRIDES: dict[str, str | None] = {
    "GC=F": None,
    "JPY=X": "USDJPY.FOREX",
    "DX-Y.NYB": "DXY.INDX",
}

MAX_HISTORY_START = "1970-01-01"  # the monthly series were yfinance period="max"


@dataclass(frozen=True)
class SeriesSpec:
    symbol: str
    interval: str  # '1d' | '1mo'
    start: str
    eodhd: str | None
    yahoo: str


def _eodhd_code(yahoo: str) -> str | None:
    if yahoo in _EODHD_OVERRIDES:
        return _EODHD_OVERRIDES[yahoo]
    try:
        return parse(yahoo).eodhd
    except SymbolError:
        return None


def _build_series() -> list[SeriesSpec]:
    from src.analytics.allocation import ASSET_CLASSES, CURRENCY_PAIRS, FACTOR_PROXIES, STYLE_ETFS

    out: list[SeriesSpec] = []
    seen: set[tuple[str, str]] = set()

    def add(sym: str, interval: str, start: str) -> None:
        if (sym, interval) not in seen:
            seen.add((sym, interval))
            out.append(SeriesSpec(sym, interval, start, _eodhd_code(sym), sym))

    # Daily: the ten ETFs from inception and the three splice proxies from the
    # start date get_asset_returns uses (the splice needs daily closes).
    for cfg in ASSET_CLASSES.values():
        add(cfg["etf"], "1d", cfg["etf_start"])
        if cfg["index"]:
            add(cfg["index"], "1d", "1990-01-01")
    # Monthly: the factor pairs, style ETFs and currencies (month-start dated).
    for pair in FACTOR_PROXIES.values():
        add(pair["long"], "1mo", MAX_HISTORY_START)
        add(pair["short"], "1mo", MAX_HISTORY_START)
    for sym in STYLE_ETFS.values():
        add(sym, "1mo", MAX_HISTORY_START)
    for sym in CURRENCY_PAIRS.values():
        add(sym, "1mo", MAX_HISTORY_START)
    return out


SERIES: list[SeriesSpec] = _build_series()


# The table's as-of is the oldest of the daily series' newest closes: every
# daily input allocation splices is at least this current. api/db.freshness()
# and allocation.stored_histories_summary() use the same definition.
DAILY_SYMBOLS: list[str] = [s.symbol for s in SERIES if s.interval == "1d"]


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(DDL)


def month_end_closes(rows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Daily (date, close) rows → one row per month, dated the 1st and holding
    the month's last close: the bar yfinance's interval="1mo" returned."""
    last: dict[str, float] = {}
    for d, c in sorted(rows):
        last[d[:7]] = c
    return [(f"{m}-01", c) for m, c in sorted(last.items())]


def write_series(conn: sqlite3.Connection, symbol: str, interval: str, rows: list[tuple[str, float]], *, provider: str) -> int:
    """Replace one series whole (never mixed with an earlier provider's rows)."""
    conn.execute("DELETE FROM asset_prices WHERE symbol = ? AND interval = ?", (symbol, interval))
    conn.executemany(
        "INSERT INTO asset_prices (symbol, interval, date, close, provider) VALUES (?, ?, ?, ?, ?)",
        [(symbol, interval, d, float(c), provider) for d, c in rows if c is not None and c > 0],
    )
    return len(rows)


def _wait_for_upstream_budget(timeout: float = 30.0) -> None:
    """The provider layer's token bucket is a non-blocking guard sized for
    visitors; a batch job waits for a token instead of failing on it."""
    deadline = time.monotonic() + timeout
    while not eod._bucket.available() and time.monotonic() < deadline:
        time.sleep(0.05)


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None) -> dict:
    """Fetch every series, replace what arrived, keep what did not, record the
    watermark, commit once. Returns a summary for the step log."""
    now = now or datetime.now(timezone.utc)
    # A bar is stored only once its session is complete (the B6 rule for
    # market_daily): a provider can hand back today's partial bar.
    last_session = cal.session_state(now)["last_completed_session"]
    by_ticker: dict[str, list[SeriesSpec]] = {}
    for spec in SERIES:
        by_ticker.setdefault(spec.yahoo, []).append(spec)

    conn = sqlite3.connect(db_path)
    try:
        ensure_table(conn)
        stored: list[str] = []
        failed: dict[str, str] = {}
        provider_of: dict[str, str] = {}
        for ticker, specs in by_ticker.items():
            start = min(s.start for s in specs)
            if specs[0].eodhd:
                _wait_for_upstream_budget()
            try:
                env = market.daily_history(specs[0].eodhd, ticker, start, None, allow_yahoo=True)
            except ProviderError as exc:
                for s in specs:
                    failed[s.symbol] = exc.kind
                continue
            for s in specs:
                rows = [r for r in env["rows"] if s.start <= r[0] <= last_session]
                if s.interval == "1mo":
                    rows = month_end_closes(rows)
                write_series(conn, s.symbol, s.interval, rows, provider=env["provider"])
                stored.append(f"{s.symbol}:{s.interval}")
            provider_of[ticker] = env["provider"]

        newest = [
            conn.execute("SELECT MAX(date) FROM asset_prices WHERE symbol = ? AND interval = '1d'", (sym,)).fetchone()[0]
            for sym in DAILY_SYMBOLS
        ]
        as_of = min(newest) if newest and all(newest) else None
        counts: dict[str, int] = {}
        for p in provider_of.values():
            counts[p] = counts.get(p, 0) + 1
        fallbacks = sorted(t for t, p in provider_of.items() if p != "eodhd")
        detail = " · ".join(f"{p} {n}" for p, n in sorted(counts.items()))
        if fallbacks:
            detail += f" (fallback: {', '.join(fallbacks)})"
        if failed:
            detail += f"; failed: {', '.join(f'{s} ({k})' for s, k in sorted(failed.items()))}"
        status = "ok" if not failed else ("partial" if stored else "error")
        watermarks.record(conn, WATERMARK, as_of if stored else None, status=status, detail=detail or None, now=now)
        conn.commit()
    finally:
        conn.close()
    return {
        "stored": len(stored),
        "failed": sorted({s for s in failed}),
        "providers": counts,
        "fallbacks": fallbacks,
        "as_of": as_of,
        "status": status,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store allocation's price histories (full refresh).")
    ap.add_argument("--db", default=str(DB_PATH))
    a = ap.parse_args(argv)
    s = refresh(Path(a.db))
    print(
        f"asset_prices: {s['stored']} series stored as of {s['as_of']} · providers {s['providers']}"
        + (f" · fallback {', '.join(s['fallbacks'])}" if s["fallbacks"] else "")
        + (f" · FAILED {', '.join(s['failed'])}" if s["failed"] else "")
    )
    return 0  # never fails the refresh; validate_db judges the result


if __name__ == "__main__":
    sys.exit(main())
