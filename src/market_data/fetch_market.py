"""
src/market_data/fetch_market.py — Fetch and persist market data from Polygon.

Does NOT import src.config — opens DB with inline _get_conn() to avoid the
FRED_API_KEY EnvironmentError.

Usage:
    python src/market_data/fetch_market.py --mode backfill
    python src/market_data/fetch_market.py --mode incremental

Modes:
    backfill    — fetch MARKET_DAILY_BACKFILL_YEARS of daily bars for all symbols.
                  Intraday is NOT backfilled (too many API calls).
    incremental — daily: fetch from (max_date + 1d) to today.
                  intraday: fetch today's 5m bars.

After each mode, prints validation: row counts + current price per symbol.
"""
import argparse
import logging
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"
CFG_DIR = ROOT / "config"

# Ensure project root is on sys.path so `from src.market_data.polygon import ...`
# works when this file is run as a script (python src/market_data/fetch_market.py).
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    """Open DB without importing src.config."""
    if not DB_PATH.exists():
        logger.error(
            "[fetch_market] DB not found at %s. Run: python src/migrate.py first.", DB_PATH
        )
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _load_assets() -> dict:
    path = CFG_DIR / "assets.yml"
    if not path.exists():
        logger.error("[fetch_market] config/assets.yml not found at %s", path)
        sys.exit(1)
    with open(path) as f:
        return yaml.safe_load(f)


def _get_latest_date(conn: sqlite3.Connection, symbol: str, table: str, date_col: str) -> str | None:
    row = conn.execute(
        f"SELECT MAX({date_col}) AS latest FROM {table} WHERE symbol = ?", (symbol,)
    ).fetchone()
    return row["latest"] if row and row["latest"] else None


# ── Upserts ───────────────────────────────────────────────────────────────────

def _upsert_daily(conn: sqlite3.Connection, rows: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT INTO market_daily
            (symbol, date, open, high, low, close, volume, vwap, source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'polygon', ?)
        ON CONFLICT(symbol, date) DO UPDATE SET
            open=excluded.open,
            high=excluded.high,
            low=excluded.low,
            close=excluded.close,
            volume=excluded.volume,
            vwap=excluded.vwap,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    return len(rows)


def _upsert_intraday(conn: sqlite3.Connection, rows: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT INTO market_intraday
            (symbol, ts, interval, open, high, low, close, volume, vwap, source, fetched_at)
        VALUES (?, ?, '5m', ?, ?, ?, ?, ?, ?, 'polygon', ?)
        ON CONFLICT(symbol, ts, interval) DO UPDATE SET
            open=excluded.open,
            high=excluded.high,
            low=excluded.low,
            close=excluded.close,
            volume=excluded.volume,
            vwap=excluded.vwap,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    return len(rows)


# ── Current price ─────────────────────────────────────────────────────────────

def get_current_price(conn: sqlite3.Connection, symbol: str) -> tuple:
    """
    Return (price, source_label).
    Priority: today's intraday latest close > most recent daily close.
    """
    today_str = date.today().isoformat()
    row = conn.execute(
        """
        SELECT close FROM market_intraday
        WHERE symbol = ? AND ts LIKE ?
        ORDER BY ts DESC LIMIT 1
        """,
        (symbol, f"{today_str}%"),
    ).fetchone()
    if row:
        return float(row["close"]), "intraday"

    row = conn.execute(
        "SELECT close FROM market_daily WHERE symbol = ? ORDER BY date DESC LIMIT 1",
        (symbol,),
    ).fetchone()
    if row:
        return float(row["close"]), "daily"
    return None, "none"


# ── Backfill mode ─────────────────────────────────────────────────────────────

def run_backfill(client, assets: dict, backfill_years: int) -> None:
    """Fetch full daily history for all daily symbols."""
    today     = date.today()
    start_str = today.replace(year=today.year - backfill_years).isoformat()
    end_str   = today.isoformat()

    conn = _get_conn()
    try:
        for symbol in assets.get("daily", []):
            logger.info(
                "[fetch_market] Backfill daily: %s  %s → %s", symbol, start_str, end_str
            )
            try:
                df = client.fetch_daily(symbol, start_str, end_str)
            except Exception as exc:
                logger.warning("[fetch_market] %s: fetch failed: %s — skipping.", symbol, exc)
                continue

            if df.empty:
                logger.warning("[fetch_market] %s: no data returned.", symbol)
                continue

            fetched_at = datetime.utcnow().isoformat()
            rows = [
                (r.symbol, r.date, r.open, r.high, r.low, r.close, r.volume, r.vwap, fetched_at)
                for r in df.itertuples(index=False)
            ]
            n = _upsert_daily(conn, rows)
            conn.commit()
            logger.info("[fetch_market] %s: %d rows upserted.", symbol, n)
    finally:
        conn.close()


# ── Incremental mode ──────────────────────────────────────────────────────────

def run_incremental(client, assets: dict) -> None:
    """
    Daily symbols: fetch from (max_date + 1d) to today.
    Intraday symbols: fetch today's 5m bars.
    """
    today_str  = date.today().isoformat()
    fetched_at = datetime.utcnow().isoformat()
    conn = _get_conn()
    try:
        # Daily incremental
        for symbol in assets.get("daily", []):
            latest = _get_latest_date(conn, symbol, "market_daily", "date")
            if latest:
                start_str = (date.fromisoformat(latest) + timedelta(days=1)).isoformat()
            else:
                # No data yet — fall back to 30-day bootstrap
                start_str = (date.today() - timedelta(days=30)).isoformat()

            if start_str > today_str:
                logger.info("[fetch_market] %s daily already up to date.", symbol)
                continue

            try:
                df = client.fetch_daily(symbol, start_str, today_str)
            except Exception as exc:
                logger.warning("[fetch_market] %s daily fetch failed: %s — skipping.", symbol, exc)
                continue

            if df.empty:
                logger.info("[fetch_market] %s: no new daily bars.", symbol)
                continue

            rows = [
                (r.symbol, r.date, r.open, r.high, r.low, r.close, r.volume, r.vwap, fetched_at)
                for r in df.itertuples(index=False)
            ]
            n = _upsert_daily(conn, rows)
            conn.commit()
            logger.info("[fetch_market] %s daily: %d rows upserted.", symbol, n)

        # Intraday (today only)
        for symbol in assets.get("intraday", []):
            try:
                df = client.fetch_intraday_5m(symbol, today_str, today_str)
            except Exception as exc:
                logger.warning(
                    "[fetch_market] %s intraday fetch failed: %s — skipping.", symbol, exc
                )
                continue

            if df.empty:
                logger.info("[fetch_market] %s: no intraday bars today.", symbol)
                continue

            rows = [
                (r.symbol, r.ts, r.open, r.high, r.low, r.close, r.volume, r.vwap, fetched_at)
                for r in df.itertuples(index=False)
            ]
            n = _upsert_intraday(conn, rows)
            conn.commit()
            logger.info("[fetch_market] %s intraday: %d rows upserted.", symbol, n)

    finally:
        conn.close()


# ── Validation ────────────────────────────────────────────────────────────────

def print_validation(assets: dict) -> None:
    """Print row counts and current price per symbol."""
    conn = _get_conn()
    try:
        print("\n--- Market Data Validation ---")
        all_symbols = list(dict.fromkeys(
            assets.get("daily", []) + assets.get("intraday", [])
        ))
        for symbol in all_symbols:
            daily_count = conn.execute(
                "SELECT COUNT(*) FROM market_daily WHERE symbol=?", (symbol,)
            ).fetchone()[0]
            intraday_count = conn.execute(
                "SELECT COUNT(*) FROM market_intraday WHERE symbol=?", (symbol,)
            ).fetchone()[0]
            price, src = get_current_price(conn, symbol)
            price_str = f"{price:.2f}" if price is not None else "N/A"
            print(
                f"  {symbol:6s}  daily={daily_count:5d}  intraday={intraday_count:6d}"
                f"  current={price_str:10s} ({src})"
            )
    finally:
        conn.close()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch market data from Polygon.io")
    parser.add_argument(
        "--mode",
        choices=["backfill", "incremental"],
        required=True,
        help="backfill: full history; incremental: from last stored date to today",
    )
    args = parser.parse_args()

    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        logger.error(
            "[fetch_market] POLYGON_API_KEY not set. "
            "Add it to .env or set as environment variable."
        )
        sys.exit(1)

    from src.market_data.polygon import PolygonClient

    client  = PolygonClient(api_key)
    assets  = _load_assets()
    backfill_years = int(os.getenv("MARKET_DAILY_BACKFILL_YEARS", "10"))

    if args.mode == "backfill":
        logger.info("[fetch_market] Starting BACKFILL (%d years)...", backfill_years)
        run_backfill(client, assets, backfill_years)
    else:
        logger.info("[fetch_market] Starting INCREMENTAL update...")
        run_incremental(client, assets)

    print_validation(assets)


if __name__ == "__main__":
    main()
