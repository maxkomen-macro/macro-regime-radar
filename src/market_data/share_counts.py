"""src/market_data/share_counts.py — share counts for cap-weighted baskets (desk/cap-weight).

Basket & Hedge weights a preset basket by market cap: each name's share count
times its close on the basket's start date, over the sum (src/desk/basket.py).
EODHD's plan here carries no fundamentals, so the full refresh (GitHub
Actions, where yfinance already runs) reads each preset constituent's current
share count from Yahoo into the additive `share_counts` table:

    symbol, shares_outstanding, as_of (the refresh's New York date), source

The API reads the table and never calls Yahoo.

A count must be in the unit the listing's price is quoted in, so each name is
checked against Yahoo's own market cap, in US dollars: the count times
Yahoo's price must equal the market cap Yahoo reports, within 2%.

- One share class, or an ADR whose count Yahoo gives in ADR units (TSM: one
  ADR is five ordinary shares, and Yahoo counts ADRs): the count passes as it
  is.
- An ADR whose count is in ordinary shares, k of them per ADR (the count
  times the price is k times the market cap, k a whole number from 2 to
  100): the count ÷ k is stored, in ADR units, and the detail says so.
- More than one share class (CRWV, NBIS): Yahoo's market cap counts every
  class at the listed class's price (its `impliedSharesOutstanding`), its
  `sharesOutstanding` the listed class only. The listed class is stored,
  since the S&P and the Nasdaq count only listed shares, and the detail
  names the difference.
- Anything else, a quote not in US dollars, or a count Yahoo does not give,
  is refused: nothing is written for that name, its previous row (if any)
  stays with its own date, and the watermark says why.

The table holds the presets' names only: a name that leaves every preset is
removed at the next full refresh.

Run:  python -m src.market_data.share_counts [--db data/macro_radar.db]
The step never fails the refresh: a failed or partial fetch keeps what is
stored, records the watermark `share_counts` (status ok, partial or error,
the reasons in its detail) and exits 0; scripts/validate_db.py only warns.
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import calendar as cal  # noqa: E402
from src import watermarks  # noqa: E402
from src.desk import presets  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
TABLE = "share_counts"
WATERMARK = "share_counts"
SOURCE = "yfinance"
PROVIDER_WORDS = "Yahoo"
CURRENCY = "USD"
# The count times Yahoo's price against Yahoo's market cap: within 2%.
TOLERANCE = 0.02
# The ADR ratios the ordinary-share rule accepts (ordinary shares per ADR).
ADR_RATIO_RANGE = (2, 100)
PAUSE_S = 0.5
RETRY_WAIT_S = 3.0

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    symbol             TEXT PRIMARY KEY,   -- the US listing's ticker, as the basket prices it
    shares_outstanding REAL NOT NULL CHECK (shares_outstanding > 0),  -- in the unit of the listing's price (ADR units for an ADR)
    as_of              TEXT NOT NULL,      -- YYYY-MM-DD: the New York date the full refresh read it
    source             TEXT NOT NULL       -- yfinance
) WITHOUT ROWID
"""
COLUMNS = ("symbol", "shares_outstanding", "as_of", "source")


class CountRefused(ValueError):
    """Yahoo's answer for one name gives no count in the unit of its price; the message says why."""


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(DDL)


def _num(info: Mapping[str, Any], key: str) -> float | None:
    v = info.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) and v > 0 else None


def _close(a: float, b: float) -> bool:
    return abs(a / b - 1.0) <= TOLERANCE


def _m(x: float) -> str:
    return f"{x / 1e6:,.1f}M"


def checked_count(symbol: str, info: Mapping[str, Any]) -> tuple[float, str | None]:
    """The share count to store for `symbol` from Yahoo's quote summary
    (`yfinance.Ticker(symbol).info`), in the unit of the listing's price,
    and a note when it is not Yahoo's `sharesOutstanding` as given or when
    Yahoo's market cap counts more than the stored shares. Raises
    CountRefused when no count passes the market-cap check."""
    currency = info.get("currency")
    if currency != CURRENCY:
        raise CountRefused(f"{symbol}: quoted in {currency or 'an unstated currency'}, not {CURRENCY}")
    shares = _num(info, "sharesOutstanding")
    mcap = _num(info, "marketCap")
    price = _num(info, "regularMarketPrice") or _num(info, "currentPrice") or _num(info, "previousClose")
    if shares is None:
        raise CountRefused(f"{symbol}: Yahoo gives no share count")
    if mcap is None or price is None:
        raise CountRefused(f"{symbol}: Yahoo gives no market cap and price to check the count against")
    implied = _num(info, "impliedSharesOutstanding")
    if _close(mcap, shares * price):
        return shares, None
    if mcap > shares * price and implied is not None and implied > shares and _close(mcap, implied * price):
        return shares, (f"{symbol}: listed class {_m(shares)} shares stored; Yahoo's market cap counts every class, "
                        f"{_m(implied)}")
    k = round(shares * price / mcap)
    if ADR_RATIO_RANGE[0] <= k <= ADR_RATIO_RANGE[1] and _close(mcap * k, shares * price):
        return shares / k, (f"{symbol}: Yahoo counts {_m(shares)} ordinary shares, {k} per ADR; "
                            f"{_m(shares / k)} ADRs stored")
    raise CountRefused(f"{symbol}: {_m(shares)} shares at ${price:,.2f} is ${shares * price / 1e9:,.1f}B, "
                       f"not Yahoo's market cap of ${mcap / 1e9:,.1f}B")


def yahoo_info(symbol: str) -> Mapping[str, Any]:
    """Yahoo's quote summary for one ticker (yfinance, imported here: the API never loads this)."""
    import yfinance as yf

    info = yf.Ticker(symbol).info
    if not isinstance(info, Mapping) or not info:
        raise CountRefused(f"{symbol}: Yahoo returned no quote summary")
    return info


def fetch_counts(symbols: list[str], fetch: Callable[[str], Mapping[str, Any]] = yahoo_info, *,
                 pause: float = PAUSE_S, retry_wait: float = RETRY_WAIT_S) -> tuple[dict[str, float], dict[str, str], list[str]]:
    """Each symbol's checked count, the symbols refused or not fetched with
    why, and the notes. A fetch that raises is retried once after
    `retry_wait` seconds; a refusal is not retried."""
    counts: dict[str, float] = {}
    failed: dict[str, str] = {}
    notes: list[str] = []
    for i, sym in enumerate(symbols):
        if i and pause:
            time.sleep(pause)
        info = None
        for attempt in (1, 2):
            try:
                info = fetch(sym)
                break
            except CountRefused as exc:
                failed[sym] = str(exc)
                break
            except Exception as exc:  # noqa: BLE001 — any provider failure is this name's, never the run's
                if attempt == 2:
                    failed[sym] = f"{sym}: not fetched ({type(exc).__name__})"
                elif retry_wait:
                    time.sleep(retry_wait)
        if info is None:
            continue
        try:
            n, note = checked_count(sym, info)
        except CountRefused as exc:
            failed[sym] = str(exc)
            continue
        counts[sym] = n
        if note:
            notes.append(note)
    return counts, failed, notes


def write_counts(conn: sqlite3.Connection, counts: Mapping[str, float], as_of: str, source: str = SOURCE) -> int:
    """Upsert one row per counted symbol; a symbol not counted keeps its row."""
    ensure_table(conn)
    conn.executemany(
        f"INSERT INTO {TABLE} (symbol, shares_outstanding, as_of, source) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(symbol) DO UPDATE SET shares_outstanding = excluded.shares_outstanding, "
        "as_of = excluded.as_of, source = excluded.source",
        [(s, float(n), as_of, source) for s, n in counts.items()],
    )
    return len(counts)


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None,
            fetch: Callable[[str], Mapping[str, Any]] | None = None, pause: float = PAUSE_S,
            retry_wait: float = RETRY_WAIT_S) -> dict:
    """Fetch every preset constituent's count, store what passes, keep what
    did not arrive, record the watermark, commit once. Returns a summary for
    the step log. The database is opened before anything is fetched, so a
    file that cannot be written costs no call to Yahoo."""
    now = now or datetime.now(timezone.utc)
    as_of = now.astimezone(cal.NY).date().isoformat()
    symbols = presets.constituents()
    conn = sqlite3.connect(db_path)
    try:
        ensure_table(conn)
        counts, failed, notes = fetch_counts(symbols, fetch or yahoo_info, pause=pause, retry_wait=retry_wait)
        status = "ok" if not failed else ("partial" if counts else "error")
        parts = [f"{PROVIDER_WORDS} {len(counts)} of {len(symbols)}"]
        if notes:
            parts.append("; ".join(notes))
        if failed:
            parts.append("not stored: " + "; ".join(failed[s] for s in symbols if s in failed))
        detail = " · ".join(parts)
        write_counts(conn, counts, as_of)
        # The table holds the presets' names only: a name no preset holds any more is not read again,
        # so its row is removed rather than left to age.
        conn.execute(f"DELETE FROM {TABLE} WHERE symbol NOT IN ({', '.join('?' * len(symbols))})", symbols)
        # The watermark's observation is the oldest stored date among the preset names, so a name
        # whose fetch keeps failing holds it back; None when one has no row at all.
        dates = [conn.execute(f"SELECT as_of FROM {TABLE} WHERE symbol = ?", (s,)).fetchone() for s in symbols]
        oldest = min(d[0] for d in dates) if dates and all(dates) else None
        watermarks.record(conn, WATERMARK, oldest if counts else None, status=status, detail=detail, now=now)
        conn.commit()
    finally:
        conn.close()
    return {"stored": sorted(counts), "failed": failed, "notes": notes, "as_of": as_of, "oldest": oldest,
            "status": status, "detail": detail}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store the preset baskets' share counts from Yahoo (full refresh).")
    ap.add_argument("--db", default=str(DB_PATH))
    a = ap.parse_args(argv)
    try:
        s = refresh(Path(a.db))
    except Exception as exc:  # noqa: BLE001 — never fails the refresh; validate_db warns on the watermark
        print(f"share_counts: not refreshed ({type(exc).__name__}: {exc})")
        return 0
    print(f"share_counts: {s['status']} · {s['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
