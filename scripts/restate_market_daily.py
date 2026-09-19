#!/usr/bin/env python3
"""Restate stored daily closes that were written mid-session (B6, 2026-09-18).

main's morning full runs fired hours late and landed during the US session,
so the incremental fetch stored unfinished bars as closes and never revisited
them. Known rows: 2026-09-01, 09-02, 09-03 and 09-10, all 23 daily symbols
(for example SPY 2026-09-03 is stored at 768.66 against a last 5-minute bar
of 773.11). The fix that stops new ones lives in src/market_data/session.py.

This script re-fetches the official close for named dates and, only with
--apply, overwrites those rows in place. It never inserts a row (restating is
not backfilling), refuses a date whose session is not complete, and without
--apply opens the database read-only and changes nothing.

Owner decision 2026-09-18: written, never run in the session that wrote it;
the published rows stay untouched until the owner runs it after promotion.
Procedure (owner, after promotion):
    make sync-data                                          # validated local copy
    python scripts/restate_market_daily.py                  # dry run: the diff table
    python scripts/restate_market_daily.py --apply          # overwrite the named rows
    python scripts/validate_db.py data/macro_radar.db --previous <copy> --mode market-only
    # then publish the validated file the usual way; the market_daily
    # fingerprint in validate_db marks the in-place change as a change.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data.session import bar_is_complete  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"
BAD_CLOSE_DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10"]


def _open(path: Path, apply: bool) -> sqlite3.Connection:
    if apply:
        conn = sqlite3.connect(path)
    else:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def restate(db_path: Path, dates: list[str], symbols: list[str], client, *, apply: bool = False, now: datetime | None = None) -> list[dict]:
    """Return one entry per stored (symbol, date) row with its stored and
    official close; with apply=True, overwrite those rows' OHLCV in place."""
    now = now or datetime.now(timezone.utc)
    for d in dates:
        if not bar_is_complete(date.fromisoformat(d), now):
            raise SystemExit(f"refusing {d}: its session is not complete yet")
    conn = _open(Path(db_path), apply)
    plan: list[dict] = []
    try:
        for symbol in symbols:
            for d in dates:
                stored = conn.execute("SELECT close FROM market_daily WHERE symbol = ? AND date = ?", (symbol, d)).fetchone()
                if stored is None:
                    continue  # never insert: restating is not backfilling
                df = client.fetch_daily(symbol, d, d)
                bar = next((r for r in df.itertuples(index=False) if str(r.date)[:10] == d), None) if not df.empty else None
                entry = {"symbol": symbol, "date": d, "stored_close": stored["close"],
                         "official_close": float(bar.close) if bar is not None else None}
                entry["changed"] = bar is not None and abs(entry["official_close"] - (entry["stored_close"] or 0.0)) > 1e-9
                plan.append(entry)
                if apply and entry["changed"]:
                    conn.execute(
                        "UPDATE market_daily SET open = ?, high = ?, low = ?, close = ?, volume = ?, fetched_at = ?"
                        " WHERE symbol = ? AND date = ?",
                        (bar.open, bar.high, bar.low, bar.close, bar.volume,
                         now.astimezone(timezone.utc).replace(tzinfo=None).isoformat(), symbol, d),
                    )
        if apply:
            conn.commit()
    finally:
        conn.close()
    return plan


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Restate mid-session daily closes with the official close (dry run by default).")
    ap.add_argument("--dates", default=",".join(BAD_CLOSE_DATES), help="comma-separated YYYY-MM-DD (default: the four known dates)")
    ap.add_argument("--symbols", default="", help="comma-separated symbols (default: every daily symbol in config/assets.yml)")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--apply", action="store_true", help="overwrite the rows; without it nothing is written")
    a = ap.parse_args(argv)
    a.dates = [d.strip() for d in a.dates.split(",") if d.strip()]
    a.symbols = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    return a


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    symbols = a.symbols
    if not symbols:
        import yaml

        symbols = yaml.safe_load((ROOT / "config" / "assets.yml").read_text()).get("daily", [])
    from src.market_data.yfinance_client import YFinanceClient

    plan = restate(Path(a.db), a.dates, symbols, YFinanceClient(), apply=a.apply)
    print(f"{'symbol':<6} {'date':<10} {'stored':>10} {'official':>10}  change")
    for p in plan:
        official = f"{p['official_close']:.2f}" if p["official_close"] is not None else "n/a"
        print(f"{p['symbol']:<6} {p['date']:<10} {p['stored_close']:>10.2f} {official:>10}  {'yes' if p['changed'] else 'no'}")
    print(f"{sum(p['changed'] for p in plan)} of {len(plan)} stored rows differ; {'written' if a.apply else 'dry run, nothing written'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
