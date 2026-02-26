"""
src/analytics/backtest.py — Historical backtest: signals/regimes → forward SPY returns.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Run:
    python -m src.analytics.backtest

Reads:  market_daily (SPY closes), signals, regimes
Writes: backtest_results

Horizons (trading days):
    1M  ≈  21 days
    3M  ≈  63 days
    6M  ≈ 126 days
    12M ≈ 252 days

Cohorts:
    signal triggers — dates where signals.triggered=1, one cohort per signal_name
    regime entries  — dates where regimes.label changes (first appearance counts)

Metrics stored:
    avg_return, median_return, hit_rate (fraction > 0), n (sample count)

Note: backtest_results has no UNIQUE constraint. Full delete-then-reinsert each run.
"""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

HORIZONS = {
    "1M":  21,
    "3M":  63,
    "6M":  126,
    "12M": 252,
}
TARGET_SYMBOL = "SPY"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_spy_daily(conn: sqlite3.Connection) -> pd.Series:
    """Load SPY daily closes as pd.Series indexed by pd.Timestamp, sorted ascending."""
    rows = conn.execute(
        "SELECT date, close FROM market_daily WHERE symbol='SPY' ORDER BY date"
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float, name="SPY")
    df = pd.DataFrame(rows, columns=["date", "close"])
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date").sort_index()
    return df["close"]


# ── Core computation ──────────────────────────────────────────────────────────

def compute_forward_return(
    spy: pd.Series,
    entry_date: pd.Timestamp,
    horizon_days: int,
) -> float | None:
    """
    Compute simple forward return from entry_date over the next horizon_days trading days.
    Uses the close price on entry_date (or nearest prior) as the entry price.
    Returns None if insufficient future data or entry price unavailable.
    """
    entry_price = spy.asof(entry_date)
    if entry_price is None or (isinstance(entry_price, float) and np.isnan(entry_price)):
        return None

    future = spy[spy.index > entry_date]
    if len(future) < horizon_days:
        return None

    exit_price = future.iloc[horizon_days - 1]
    return float(exit_price / entry_price - 1)


def compute_metrics(returns: list) -> dict:
    """Return avg_return, median_return, hit_rate, n from list of float returns."""
    if not returns:
        return {"avg_return": 0.0, "median_return": 0.0, "hit_rate": 0.0, "n": 0}
    arr = np.array(returns, dtype=float)
    return {
        "avg_return":    float(np.mean(arr)),
        "median_return": float(np.median(arr)),
        "hit_rate":      float(np.mean(arr > 0)),
        "n":             int(len(arr)),
    }


# ── Cohort builders ───────────────────────────────────────────────────────────

def backtest_signals(conn: sqlite3.Connection, spy: pd.Series) -> list:
    """
    For each signal_name: find all triggered=1 entry dates.
    Compute forward returns for each horizon.
    Returns list of (test_name, cohort, horizon, metric, value, computed_at).
    """
    results = []
    signal_names = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT signal_name FROM signals ORDER BY signal_name"
        ).fetchall()
    ]

    computed_at = datetime.utcnow().isoformat()

    for signal_name in signal_names:
        rows = conn.execute(
            "SELECT date FROM signals WHERE signal_name=? AND triggered=1 ORDER BY date",
            (signal_name,),
        ).fetchall()
        entry_dates = [pd.Timestamp(r["date"]) for r in rows]

        if not entry_dates:
            continue

        test_name = f"SPY_signal_{signal_name}"
        cohort    = signal_name

        for horizon_label, horizon_days in HORIZONS.items():
            fwd_returns = []
            for entry in entry_dates:
                ret = compute_forward_return(spy, entry, horizon_days)
                if ret is not None:
                    fwd_returns.append(ret)

            metrics = compute_metrics(fwd_returns)
            for metric, value in metrics.items():
                results.append((test_name, cohort, horizon_label, metric, float(value), computed_at))

    return results


def backtest_regimes(conn: sqlite3.Connection, spy: pd.Series) -> list:
    """
    Find dates where regime label changes (regime entries).
    Compute forward SPY returns for each regime entry and horizon.
    Returns list of (test_name, cohort, horizon, metric, value, computed_at).
    """
    rows = conn.execute(
        "SELECT date, label FROM regimes ORDER BY date"
    ).fetchall()
    if not rows:
        logger.warning("[backtest] No regime data found.")
        return []

    df = pd.DataFrame(rows, columns=["date", "label"])
    df = df.assign(date=pd.to_datetime(df["date"])).sort_values("date").reset_index(drop=True)

    # Entry = first row OR any row where label differs from previous row
    df = df.assign(prev_label=df["label"].shift(1))
    entries = df[df["label"] != df["prev_label"]].copy()

    results = []
    computed_at = datetime.utcnow().isoformat()

    for regime_label in df["label"].unique():
        entry_dates = entries[entries["label"] == regime_label]["date"].tolist()
        safe_label  = regime_label.replace(" ", "_")
        test_name   = f"SPY_regime_{safe_label}"
        cohort      = regime_label

        for horizon_label, horizon_days in HORIZONS.items():
            fwd_returns = []
            for entry in entry_dates:
                ret = compute_forward_return(spy, entry, horizon_days)
                if ret is not None:
                    fwd_returns.append(ret)

            metrics = compute_metrics(fwd_returns)
            for metric, value in metrics.items():
                results.append((test_name, cohort, horizon_label, metric, float(value), computed_at))

    return results


# ── DB writer ─────────────────────────────────────────────────────────────────

def upsert_backtest_results(conn: sqlite3.Connection, rows: list) -> int:
    """
    Full delete-then-insert. backtest_results has no UNIQUE constraint
    so this is the correct approach to avoid duplicates on re-runs.
    """
    if not rows:
        return 0
    conn.execute("DELETE FROM backtest_results")
    conn.executemany(
        """
        INSERT INTO backtest_results
            (test_name, cohort, horizon, metric, value, computed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def print_summary(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT test_name, horizon, metric, value
        FROM backtest_results
        WHERE metric IN ('avg_return', 'hit_rate', 'n')
        ORDER BY test_name, horizon, metric
        """
    ).fetchall()
    print(f"\n--- Backtest Results ({len(rows)} metric rows) ---")
    prev_key = None
    for r in rows:
        key = (r["test_name"], r["horizon"])
        if key != prev_key:
            print(f"  {r['test_name']} | {r['horizon']}")
            prev_key = key
        val_str = f"{r['value']:.4f}" if r["metric"] != "n" else f"{int(r['value'])}"
        print(f"    {r['metric']:20s} {val_str}")


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run() -> None:
    conn = _get_conn()
    try:
        spy = load_spy_daily(conn)
        if spy.empty:
            logger.warning(
                "[backtest] No SPY data in market_daily. "
                "Run: python src/market_data/fetch_market.py --mode backfill"
            )
            return

        logger.info("[backtest] SPY daily bars loaded: %d rows (%s → %s)",
                    len(spy), spy.index[0].date(), spy.index[-1].date())

        logger.info("[backtest] Running signal cohort backtests...")
        signal_rows = backtest_signals(conn, spy)

        logger.info("[backtest] Running regime cohort backtests...")
        regime_rows = backtest_regimes(conn, spy)

        all_rows = signal_rows + regime_rows
        n = upsert_backtest_results(conn, all_rows)
        logger.info("[backtest] Done. %d backtest_results rows inserted.", n)

        print_summary(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    run()
