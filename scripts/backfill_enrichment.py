#!/usr/bin/env python3
"""Top up the AI read on the cards the News tab is showing (N-B1, 2026-09-20).

Enrichment used to consider only the rows a run had just inserted, so a window
that filled up while the hourly limit held kept its wire summaries forever.
src/analytics/news.py now tops the displayed ten up on every run; this script
does the same thing once, for a database that is already behind.

It spends money: at most DISPLAY_TOP_N items, each one Claude Haiku plus one
Perplexity Sonar call, recorded in the same append-only ai_spend_ledger and
refused past the same $50 monthly cap. Without --apply it opens the database
read-only, makes no HTTP call and prints what it would enrich.

    python scripts/backfill_enrichment.py --db <copy>            # dry run
    python scripts/backfill_enrichment.py --db <copy> --apply    # spends

Run it against a scratch copy of the published release asset, never against a
file that is serving. Keys come from the environment or the repo-root .env and
are never printed.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analytics import news  # noqa: E402
from src.db_helpers import ensure_ai_spend_ledger  # noqa: E402

DB_PATH = ROOT / "data" / "macro_radar.db"


def _keys() -> dict:
    """anthropic_key / perplexity_key from the environment, else repo-root .env."""
    import os

    found = {"anthropic_key": os.environ.get("ANTHROPIC_API_KEY", ""), "perplexity_key": os.environ.get("PERPLEXITY_API_KEY", "")}
    if all(found.values()):
        return found
    names = {"ANTHROPIC_API_KEY": "anthropic_key", "PERPLEXITY_API_KEY": "perplexity_key"}
    try:
        for line in (ROOT / ".env").read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() in names and not found[names[k.strip()]]:
                found[names[k.strip()]] = v.strip().strip("\"'")
    except OSError:
        pass
    return found


def plan(conn: sqlite3.Connection, *, top_n: int = news.DISPLAY_TOP_N) -> list[dict]:
    """The displayed cards that carry no AI read yet, in the page's own order."""
    ids = news.select_display_topups(conn, top_n=top_n)
    if not ids:
        return []
    rows = {r["id"]: r for r in news._load_rows(conn, ids)}
    return [rows[i] for i in ids if i in rows]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DB_PATH), help="database to read (and, with --apply, write)")
    ap.add_argument("--top-n", type=int, default=news.DISPLAY_TOP_N, help=f"how deep into the displayed window to go (default {news.DISPLAY_TOP_N})")
    ap.add_argument("--apply", action="store_true", help="make the calls and store the results; without it nothing is called")
    a = ap.parse_args(argv)

    path = Path(a.db)
    if not path.exists():
        raise SystemExit(f"no database at {path}")
    uri = str(path) if a.apply else f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=not a.apply)
    try:
        pending = plan(conn, top_n=a.top_n)
        print(f"{len(pending)} of the top {a.top_n} displayed cards carry no AI read:")
        for r in pending:
            print(f"  {r['overall_significance']:>5.2f}  {str(r['published_at'])[:16]}  {r['headline'][:78]}")
        if not a.apply:
            print("dry run, nothing called and nothing written.")
            return 0
        if not pending:
            return 0
        ensure_ai_spend_ledger(conn)
        stats = news.enrich_new_rows(conn, [], _keys(), display_ids=[r["id"] for r in pending])
        conn.commit()
        print(f"enriched {stats['enriched']} · ${stats['run_cost_usd']:.4f} this run · ${stats['month_to_date_usd']:.2f} month-to-date")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
