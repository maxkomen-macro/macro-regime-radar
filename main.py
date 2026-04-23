import os
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent


def _load_secrets_toml() -> None:
    """Copy keys from .streamlit/secrets.toml into os.environ if unset.

    Lets `python main.py` run in a fresh terminal without manual `export`
    commands. CI-provided env vars win — we only fill missing keys.
    """
    try:
        import tomllib
    except ImportError:
        return
    path = PROJECT_ROOT / ".streamlit" / "secrets.toml"
    if not path.exists():
        return
    try:
        with path.open("rb") as f:
            data = tomllib.load(f)
    except Exception:
        return
    for key in (
        "FINNHUB_API_KEY", "NEWS_API_KEY",
        "ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY",
        "FRED_API_KEY", "POLYGON_API_KEY",
    ):
        val = data.get(key)
        if isinstance(val, str) and val and not os.environ.get(key):
            os.environ[key] = val


# Load local secrets BEFORE importing src.config (which asserts FRED_API_KEY).
_load_secrets_toml()
load_dotenv(PROJECT_ROOT / ".env")

from src.database    import init_db
from src.db_helpers  import ensure_news_table
from src.migrate     import run_migration
from src.fetch_data  import fetch_all_series
from src import regime
from src import signals
from src.config import DB_PATH


def _migrate_gs_series() -> None:
    """One-time rename of monthly GS10/GS2 rows to daily DGS10/DGS2 series IDs.

    Idempotent: if no GS10/GS2 rows exist the UPDATEs are no-ops.
    """
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE raw_series SET series_id = 'DGS10' WHERE series_id = 'GS10'")
        conn.execute("UPDATE raw_series SET series_id = 'DGS2'  WHERE series_id = 'GS2'")
        conn.commit()


def main():
    print("=" * 60)
    print("  Macro Regime Radar")
    print("=" * 60)

    print("\n[1/5] Initializing database...")
    init_db()
    ensure_news_table()
    run_migration()
    _migrate_gs_series()

    print("\n[2/5] Fetching data from FRED...")
    series_dict = fetch_all_series()

    print("\n[3/5] Computing regime classifications...")
    regime_df = regime.run(series_dict)

    print("\n[4/5] Detecting macro signals...")
    signals.run(series_dict)

    print("\n[5/5] Refreshing news feed...")
    from src.analytics.news import fetch_and_store_news
    try:
        n = fetch_and_store_news(str(DB_PATH), {
            "finnhub_key":    os.environ.get("FINNHUB_API_KEY", ""),
            "newsapi_key":    os.environ.get("NEWS_API_KEY", ""),
            "anthropic_key":  os.environ.get("ANTHROPIC_API_KEY", ""),
            "perplexity_key": os.environ.get("PERPLEXITY_API_KEY", ""),
        })
        print(f"[news] Stored {n} new headlines.")
    except Exception as exc:
        print(f"[news] WARNING: news refresh failed: {exc}", file=sys.stderr)

    latest = regime_df.iloc[-1]
    print("\n" + "=" * 60)
    print(f"  Current Regime:    {latest['label']}")
    print(f"  Confidence:        {latest['confidence']:.1%}")
    print(f"  As of:             {latest['date']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
