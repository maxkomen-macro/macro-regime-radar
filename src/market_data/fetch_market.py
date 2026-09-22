"""
src/market_data/fetch_market.py — Fetch and persist market data from Yahoo Finance.

Daily and intraday bars both come from yfinance (keyless). polygon.py is dormant
legacy and is no longer imported here.

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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"
CFG_DIR = ROOT / "config"

# Ensure project root is on sys.path so `from src.market_data.yfinance_client import ...`
# works when this file is run as a script (python src/market_data/fetch_market.py).
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import watermarks  # noqa: E402  (stdlib-only)
from src.market_data.session import bar_is_complete, is_trading_day, today_ny  # noqa: E402

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
    watermarks.ensure_table(conn)
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'yfinance', ?)
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


def _upsert_intraday(conn: sqlite3.Connection, rows: list[tuple], source: str = "yfinance") -> int:
    # rows are 9-tuples: (symbol, ts, open, high, low, close, volume, vwap, fetched_at)
    # splice source between vwap (index 7) and fetched_at (index 8)
    conn.executemany(
        """
        INSERT INTO market_intraday
            (symbol, ts, interval, open, high, low, close, volume, vwap, source, fetched_at)
        VALUES (?, ?, '5m', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, ts, interval) DO UPDATE SET
            open=excluded.open,
            high=excluded.high,
            low=excluded.low,
            close=excluded.close,
            volume=excluded.volume,
            vwap=excluded.vwap,
            fetched_at=excluded.fetched_at
        """,
        [(*row[:8], source, row[8]) for row in rows],
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


# ── Session-complete daily bars + watermarks (B6, 2026-09-18) ────────────────
# A daily bar is stored only once its session is complete (session.py: the real
# NYSE close, 13:00 ET on half-days, plus a buffer). Main's delayed morning runs
# landed mid-session and stored unfinished bars as closes, which the
# max-date + 1 incremental never revisited (2026-09-01/02/03/10).

def _complete_rows(df, now: datetime, fetched_at: str, symbol: str) -> list[tuple]:
    rows, held = [], []
    for r in df.itertuples(index=False):
        if bar_is_complete(date.fromisoformat(str(r.date)[:10]), now):
            rows.append((r.symbol, r.date, r.open, r.high, r.low, r.close, r.volume, r.vwap, fetched_at))
        else:
            held.append(str(r.date)[:10])
    if held:
        logger.info("[fetch_market] %s: holding back %s until its session is complete.", symbol, ", ".join(held))
    return rows


def _record_daily_watermark(conn: sqlite3.Connection, symbols: list[str], now: datetime) -> None:
    """market_daily = the earliest latest date across symbols; laggards named."""
    latest = {s: _get_latest_date(conn, s, "market_daily", "date") for s in symbols}
    have = {s: d for s, d in latest.items() if d}
    if not have:
        watermarks.record(conn, "market_daily", None, status="error", detail="no stored closes", now=now)
        return
    newest = max(have.values())
    laggards = sorted(s for s, d in latest.items() if d is None or d < newest)
    detail = f"behind {newest}: {', '.join(laggards)}" if laggards else None
    watermarks.record(conn, "market_daily", min(have.values()), None, detail=detail, now=now)


def _record_intraday_watermark(conn: sqlite3.Connection, now: datetime) -> None:
    row = conn.execute("SELECT MAX(ts) FROM market_intraday").fetchone()
    last = row[0] if row else None
    watermarks.record(conn, "market_intraday", last, None,
                      status="ok" if last else "error", detail=None if last else "no stored bars", now=now)


def _fetch_daily_incremental(conn: sqlite3.Connection, client, symbols: list[str], now: datetime) -> int:
    """From each symbol's max date + 1 through today (New York date); only
    complete sessions are stored, so a mid-session run writes no partial close."""
    end_str = today_ny(now).isoformat()
    fetched_at = now.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
    total = 0
    for symbol in symbols:
        latest = _get_latest_date(conn, symbol, "market_daily", "date")
        if latest:
            start_str = (date.fromisoformat(latest) + timedelta(days=1)).isoformat()
        else:
            # No data yet — fall back to 30-day bootstrap
            start_str = (today_ny(now) - timedelta(days=30)).isoformat()

        if start_str > end_str:
            logger.info("[fetch_market] %s daily already up to date.", symbol)
            continue

        try:
            df = client.fetch_daily(symbol, start_str, end_str)
        except Exception as exc:
            logger.warning("[fetch_market] %s daily fetch failed: %s — skipping.", symbol, exc)
            continue

        if df.empty:
            logger.info("[fetch_market] %s: no new daily bars.", symbol)
            continue

        rows = _complete_rows(df, now, fetched_at, symbol)
        if not rows:
            continue
        n = _upsert_daily(conn, rows)
        conn.commit()
        total += n
        logger.info("[fetch_market] %s daily: %d rows upserted.", symbol, n)
    _record_daily_watermark(conn, symbols, now)
    conn.commit()
    return total


# ── Backfill mode ─────────────────────────────────────────────────────────────

def run_backfill(client, assets: dict, backfill_years: int, now: datetime | None = None) -> None:
    """Fetch full daily history for all daily symbols (complete sessions only)."""
    now       = now or datetime.now(timezone.utc)
    today     = today_ny(now)
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

            fetched_at = now.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
            rows = _complete_rows(df, now, fetched_at, symbol)
            n = _upsert_daily(conn, rows)
            conn.commit()
            logger.info("[fetch_market] %s: %d rows upserted.", symbol, n)
        _record_daily_watermark(conn, assets.get("daily", []), now)
        conn.commit()
    finally:
        conn.close()


# ── Incremental mode ──────────────────────────────────────────────────────────

def run_incremental(client, assets: dict, now: datetime | None = None) -> None:
    """
    Daily symbols: fetch from (max_date + 1d) to today, complete sessions only.
    Intraday symbols: fetch today's 5m bars.
    """
    now        = now or datetime.now(timezone.utc)
    today_str  = today_ny(now).isoformat()
    fetched_at = now.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
    conn = _get_conn()
    try:
        # Daily incremental (session-complete bars only)
        _fetch_daily_incremental(conn, client, assets.get("daily", []), now)

        # Intraday (today only) — via yfinance, no API key required
        from src.market_data.yfinance_client import YFinanceClient
        yf_client = YFinanceClient()
        for symbol in assets.get("intraday", []):
            try:
                df = yf_client.fetch_intraday_5m(symbol, today_str, today_str)
            except Exception as exc:
                logger.warning(
                    "[fetch_market] %s intraday yfinance failed: %s — skipping.", symbol, exc
                )
                continue

            if df.empty:
                logger.info("[fetch_market] %s: no intraday bars today.", symbol)
                continue

            rows = [
                (r.symbol, r.ts, r.open, r.high, r.low, r.close, r.volume, r.vwap, fetched_at)
                for r in df.itertuples(index=False)
            ]
            n = _upsert_intraday(conn, rows, source="yfinance")
            conn.commit()
            logger.info("[fetch_market] %s intraday: %d rows upserted.", symbol, n)
        if assets.get("intraday"):
            _record_intraday_watermark(conn, now)
            conn.commit()

    finally:
        conn.close()


# ── Intraday-only mode ────────────────────────────────────────────────────────

def run_intraday_only(now: datetime | None = None, client=None, assets: dict | None = None) -> None:
    """
    Fetch latest 5m bars for all intraday symbols via yfinance.
    Called by the intraday GitHub Actions workflow every 5 minutes.
    Does NOT require POLYGON_API_KEY.

    B6 (2026-09-18): once today's session is complete, the same run captures
    the official daily close (session-complete bars only), so every run after
    the close is another chance to store it; the 00:23Z and 11:17Z full runs
    remain the backstop. Before the close the daily path is not touched.
    """
    if client is None:
        from src.market_data.yfinance_client import YFinanceClient

        client = YFinanceClient()
    now        = now or datetime.now(timezone.utc)
    assets     = assets if assets is not None else _load_assets()
    today_str  = today_ny(now).isoformat()
    fetched_at = now.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
    conn       = _get_conn()
    try:
        for symbol in assets.get("intraday", []):
            try:
                df = client.fetch_intraday_5m(symbol, today_str, today_str)
            except Exception as exc:
                logger.warning(
                    "[fetch_market] %s intraday yfinance failed: %s — skipping.",
                    symbol, exc,
                )
                continue
            if df.empty:
                logger.info("[fetch_market] %s: no intraday bars.", symbol)
                continue
            rows = [
                (r.symbol, r.ts, r.open, r.high, r.low,
                 r.close, r.volume, r.vwap, fetched_at)
                for r in df.itertuples(index=False)
            ]
            n = _upsert_intraday(conn, rows, source="yfinance")
            conn.commit()
            logger.info("[fetch_market] %s intraday: %d rows upserted.", symbol, n)
        _record_intraday_watermark(conn, now)
        conn.commit()
        session_day = today_ny(now)
        if is_trading_day(session_day) and bar_is_complete(session_day, now):
            n = _fetch_daily_incremental(conn, client, assets.get("daily", []), now)
            logger.info("[fetch_market] post-close capture: %d official daily bar(s) stored.", n)
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
    parser = argparse.ArgumentParser(description="Fetch market data from Yahoo Finance")
    parser.add_argument(
        "--mode",
        choices=["backfill", "incremental", "intraday-only"],
        required=True,
        help=(
            "backfill: full daily history via yfinance; "
            "incremental: daily from last date + today's intraday via yfinance; "
            "intraday-only: today's 5m bars via yfinance (all keyless)"
        ),
    )
    args = parser.parse_args()

    assets = _load_assets()

    if args.mode == "intraday-only":
        logger.info("[fetch_market] Starting INTRADAY-ONLY update (yfinance)...")
        run_intraday_only()
        print_validation(assets)
        return

    from src.market_data.yfinance_client import YFinanceClient

    client         = YFinanceClient()
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
