"""
src/market_data/backfill_yfinance.py — Backfill historical daily OHLCV from Yahoo Finance.

Fetches daily bars for SPY (and optionally other watchlist symbols) going back to
START_DATE and inserts them into market_daily using INSERT OR IGNORE so existing
Polygon rows are never overwritten.

Run:
    python src/market_data/backfill_yfinance.py
    python src/market_data/backfill_yfinance.py --symbols SPY QQQ IWM TLT
    python src/market_data/backfill_yfinance.py --start 1993-01-01
"""
import argparse
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

DEFAULT_START   = "1993-01-01"
DEFAULT_SYMBOLS = ["SPY"]

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [yfinance_backfill] %(message)s",
)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def fetch_and_insert(symbol: str, start: str, conn: sqlite3.Connection) -> int:
    logger.info("Fetching %s from %s via yfinance...", symbol, start)
    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start, auto_adjust=True)
    if df.empty:
        logger.warning("No data returned for %s", symbol)
        return 0

    df = df.reset_index()
    # Normalize date column — yfinance may return tz-aware DatetimeIndex
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).dt.normalize()
    df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")

    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    rows = []
    for _, row in df.iterrows():
        rows.append((
            symbol,
            row["date_str"],
            float(row.get("Open", 0) or 0),
            float(row.get("High", 0) or 0),
            float(row.get("Low", 0) or 0),
            float(row["Close"]),
            float(row.get("Volume", 0) or 0),
            None,        # vwap — not available from yfinance
            "yfinance",
            fetched_at,
        ))

    cursor = conn.executemany(
        """
        INSERT OR IGNORE INTO market_daily
            (symbol, date, open, high, low, close, volume, vwap, source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    inserted = cursor.rowcount
    logger.info(
        "%s: %d rows fetched, %d inserted (%d duplicates/existing skipped).",
        symbol, len(rows), inserted, len(rows) - inserted,
    )
    return inserted


def run(symbols: list, start: str) -> None:
    conn = _get_conn()
    try:
        total = 0
        for sym in symbols:
            total += fetch_and_insert(sym, start, conn)
        logger.info("Done. %d total rows inserted across %d symbol(s).", total, len(symbols))

        print("\n--- market_daily summary after backfill ---")
        for sym in symbols:
            row = conn.execute(
                "SELECT MIN(date), MAX(date), COUNT(*) FROM market_daily WHERE symbol=?",
                (sym,),
            ).fetchone()
            print(f"  {sym:6s}  {row[0]} → {row[1]}  ({row[2]} rows)")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill historical daily bars from Yahoo Finance into market_daily."
    )
    parser.add_argument(
        "--symbols", nargs="+", default=DEFAULT_SYMBOLS,
        help="Ticker symbols to backfill (default: SPY)",
    )
    parser.add_argument(
        "--start", default=DEFAULT_START,
        help="Start date YYYY-MM-DD (default: 1993-01-01)",
    )
    args = parser.parse_args()
    run(args.symbols, args.start)
