"""src/db_helpers.py — DB migration helpers for macro_radar.db."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "macro_radar.db"

# B4 (2026-09-18): one row per paid AI call (and one per run that hit the
# monthly cap). Append-only and never pruned: its month-to-date sum is the
# budget. No exception text, URL or key is ever stored, only the HTTP status.
AI_SPEND_LEDGER_DDL = (
    """CREATE TABLE IF NOT EXISTS ai_spend_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        month TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        purpose TEXT,
        news_id INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_write_tokens INTEGER,
        cache_read_tokens INTEGER,
        request_fee_usd REAL,
        cost_usd REAL NOT NULL DEFAULT 0,
        cost_source TEXT,
        status TEXT NOT NULL,
        http_status INTEGER,
        run_id TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_ai_spend_month ON ai_spend_ledger(month)",
    "CREATE INDEX IF NOT EXISTS idx_ai_spend_ts ON ai_spend_ledger(ts)",
)


def ensure_ai_spend_ledger(conn: sqlite3.Connection) -> None:
    """Create the append-only AI spend ledger and its indexes. Idempotent."""
    for statement in AI_SPEND_LEDGER_DDL:
        conn.execute(statement)


def ensure_news_table(db_path: str | None = None) -> None:
    """Create news_feed and ai_spend_ledger with their indexes if missing. Idempotent."""
    path = db_path or str(DB_PATH)
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS news_feed (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                headline TEXT NOT NULL,
                summary TEXT,
                url TEXT,
                source TEXT,
                category TEXT,
                published_at DATETIME,
                fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                market_impact INTEGER DEFAULT 1,
                deal_size INTEGER DEFAULT 1,
                sector_relevance INTEGER DEFAULT 1,
                time_sensitivity INTEGER DEFAULT 1,
                regime_relevance INTEGER DEFAULT 1,
                overall_significance REAL DEFAULT 1.0,
                regime_interpretation TEXT,
                perplexity_research TEXT,
                ticker TEXT,
                UNIQUE(headline, published_at)
            );
            CREATE INDEX IF NOT EXISTS idx_news_published
                ON news_feed(published_at DESC);
            CREATE INDEX IF NOT EXISTS idx_news_significance
                ON news_feed(overall_significance DESC);
            CREATE INDEX IF NOT EXISTS idx_news_category
                ON news_feed(category);
        """)
        # Idempotent migration for existing DBs that predate perplexity_research
        cols = {row[1] for row in conn.execute("PRAGMA table_info(news_feed)")}
        if "perplexity_research" not in cols:
            conn.execute("ALTER TABLE news_feed ADD COLUMN perplexity_research TEXT")
        ensure_ai_spend_ledger(conn)
        conn.commit()
