from pathlib import Path
import sqlite3
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from src.database   import init_db
from src.fetch_data import fetch_all_series
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

    print("\n[1/4] Initializing database...")
    init_db()
    _migrate_gs_series()

    print("\n[2/4] Fetching data from FRED...")
    series_dict = fetch_all_series()

    print("\n[3/4] Computing regime classifications...")
    regime_df = regime.run(series_dict)

    print("\n[4/4] Detecting macro signals...")
    signals.run(series_dict)

    latest = regime_df.iloc[-1]
    print("\n" + "=" * 60)
    print(f"  Current Regime:    {latest['label']}")
    print(f"  Confidence:        {latest['confidence']:.1%}")
    print(f"  As of:             {latest['date']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
