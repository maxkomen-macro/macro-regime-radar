"""
src/analytics/backtest.py — Historical backtest: signals/regimes → forward SPY total returns.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Run:
    python -m src.analytics.backtest

Reads:  asset_prices (SPY, interval '1d': split- and dividend-adjusted closes), signals, regimes
Writes: backtest_results

Return basis: TOTAL RETURN (Max, 2026-11-04, option A). Every forward return
is the ratio of two SPY closes from asset_prices, which the full refresh
(src/market_data/asset_history.py) refetches whole on every run from one
provider, split- and dividend-adjusted. Only the Yahoo series is scored
(VERIFIED_PROVIDERS): auto_adjust=True, the path the publishing workflow
takes (it carries no EODHD token), verified against SPY's published
distributions. An EODHD series (a machine with a token) is not scored: its
provider layer falls back row by row to the raw close where a row lacks
adjusted_close (api/providers/market.py), so one provider does not
guarantee one basis there (Codex DR-01); the step logs an error and keeps
the stored results. The provider adjusts each close
before an ex-dividend date by the factor (1 - D / prior close), so a return
read off these closes reinvests each distribution in SPY on its ex-dividend
date, at the prior session's close less the distribution. No taxes, no
trading costs; the fund's expense ratio is already in its price.
Distributions enter only through those adjusted closes: nothing here adds a
dividend, and market_daily (the canonical bars, which the approved
correction plan keeps unadjusted) is not read, so no distribution is counted twice
and no two adjustment bases are spliced. A price return (dividends
excluded) is a different number; the outputs that print these results say
"total return".

Every row written carries return_basis = 'total_return' (RETURN_BASIS_KEY), a
column this step adds in place to a published table that predates it, so a
reader can tell recomputed rows from rows stored before this change (NULL:
basis not recorded) and labels only the former "total return".

The series is aligned to the NYSE session calendar (api/calendar) before it
is scored, so a horizon always counts real sessions: a stored row on a
non-session date is dropped, and a missing session or a close that is not
a finite positive number leaves every window that would start or end on it
unscored (both logged). Rows in a year api/calendar has no holiday table
for are dropped (logged), never aligned to a weekends-only guess (Codex
DR-05); extend the calendar when the exchange publishes the year. A return
that is not a finite number (an unrepresentable ratio) is unscored (DR-06).
On the published series today none of this fires: asset_prices SPY holds
exactly one row per NYSE session.

Before this change the backtest read market_daily SPY closes, a splice of a
dividend-adjusted Yahoo backfill (1993-01-29 to 2024-02-26) and unadjusted
bars after it, so its returns were neither basis.

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
    An entry is unscored (left out of n, never truncated) when it predates
    the first stored close, fewer than `horizon` sessions follow it, or its
    entry or exit session has no valid close.

Note: backtest_results has no UNIQUE constraint. Full delete-then-reinsert each run.
"""
import logging
import math
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from api import calendar as cal  # noqa: E402  (pure functions, no network, no src.config)

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
SOURCE_TABLE = "asset_prices"   # split- and dividend-adjusted closes: total return
SOURCE_INTERVAL = "1d"
RETURN_BASIS = "total return"
VERIFIED_PROVIDERS = ("yfinance",)  # Codex DR-01: the only provider whose adjustment basis is verified whole
RETURN_BASIS_KEY = "total_return"  # stored in backtest_results.return_basis on every row this step writes


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
    except BaseException:
        conn.close()  # never left open when its setup fails (Codex R-33)
        raise
    return conn


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_spy_total_return(conn: sqlite3.Connection) -> pd.Series:
    """SPY's daily split- and dividend-adjusted closes from asset_prices
    (interval '1d') as pd.Series indexed by pd.Timestamp, sorted ascending:
    a total-return index, the only series the backtest scores (see the
    module docstring for the reinvestment assumption).

    Empty when the table or the series is absent; never falls back to
    market_daily, whose bars are unadjusted (a fallback would silently switch
    the basis to price return). Raises when the series holds more than one
    provider: two adjustment bases spliced together, which asset_history
    never writes (it replaces a series whole). Empty, with an error logged,
    when the one provider is not in VERIFIED_PROVIDERS (Codex DR-01)."""
    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (SOURCE_TABLE,)
    ).fetchone()
    if not has_table:
        return pd.Series(dtype=float, name=TARGET_SYMBOL)
    providers = [
        r[0] for r in conn.execute(
            f"SELECT DISTINCT provider FROM {SOURCE_TABLE} WHERE symbol = ? AND interval = ?",
            (TARGET_SYMBOL, SOURCE_INTERVAL),
        ).fetchall()
    ]
    if len(providers) > 1:
        raise RuntimeError(
            f"{SOURCE_TABLE} {TARGET_SYMBOL} ({SOURCE_INTERVAL}) mixes providers {sorted(providers)}: "
            "two adjustment bases, refusing to score a spliced total-return series"
        )
    if providers and providers[0] not in VERIFIED_PROVIDERS:
        logger.error(
            "[backtest] %s %s comes from %s, whose adjusted closes are not verified as one total-return basis "
            "(it can fall back to a raw close row by row); not scored, backtest_results left as stored. "
            "Verified: %s", SOURCE_TABLE, TARGET_SYMBOL, providers[0], ", ".join(VERIFIED_PROVIDERS),
        )
        return pd.Series(dtype=float, name=TARGET_SYMBOL)
    rows = conn.execute(
        f"SELECT date, close FROM {SOURCE_TABLE} WHERE symbol = ? AND interval = ? ORDER BY date",
        (TARGET_SYMBOL, SOURCE_INTERVAL),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float, name=TARGET_SYMBOL)
    df = pd.DataFrame([tuple(r) for r in rows], columns=["date", "close"])
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date").sort_index()
    return align_to_sessions(df["close"].astype(float).rename(TARGET_SYMBOL))


def align_to_sessions(closes: pd.Series) -> pd.Series:
    """`closes` on exactly the NYSE sessions from its first to its last date:
    a row on a non-session date is dropped, a missing session is NaN, and so
    is a close that is not a finite positive number. compute_forward_return
    counts positions on this index, so a horizon is always that many real
    sessions, and a window whose entry or exit close is NaN is unscored."""
    if closes.empty:
        return closes
    bad = ~np.isfinite(closes.to_numpy(dtype=float)) | ~(closes.to_numpy(dtype=float) > 0)
    if bad.any():
        logger.warning("[backtest] %d %s closes are not finite positive numbers; windows on them are unscored: %s",
                       int(bad.sum()), TARGET_SYMBOL, [d.date().isoformat() for d in closes.index[bad]][:10])
        closes = closes.mask(bad)
    known = np.array([cal.calendar_known(d.date()) for d in closes.index])
    if not known.all():
        logger.error("[backtest] %d %s rows fall in years api/calendar has no holiday table for (%s → %s); dropped, "
                     "windows needing them are unscored. Extend api/calendar.HOLIDAYS.", int((~known).sum()), TARGET_SYMBOL,
                     closes.index[~known][0].date().isoformat(), closes.index[~known][-1].date().isoformat())
        closes = closes[known]
        if closes.empty:
            return closes
    first, last = closes.index[0].date(), closes.index[-1].date()
    sessions, d = [], first
    while d <= last:
        if cal.is_trading_day(d):
            sessions.append(pd.Timestamp(d))
        d += timedelta(days=1)
    index = pd.DatetimeIndex(sessions)
    extra = closes.index.difference(index)
    missing = index.difference(closes.index)
    if len(extra):
        logger.warning("[backtest] %d %s rows on non-session dates dropped: %s",
                       len(extra), TARGET_SYMBOL, [x.date().isoformat() for x in extra][:10])
    if len(missing):
        logger.warning("[backtest] %d NYSE sessions have no %s close; windows on them are unscored: %s",
                       len(missing), TARGET_SYMBOL, [x.date().isoformat() for x in missing][:10])
    return closes.reindex(index).rename(closes.name)


# ── Core computation ──────────────────────────────────────────────────────────

def compute_forward_return(
    spy: pd.Series,
    entry_date: pd.Timestamp,
    horizon_days: int,
) -> float | None:
    """
    Compute simple forward return from entry_date over the next horizon_days trading days.
    Uses the close on entry_date (or nearest prior) as the entry price. With the
    adjusted closes load_spy_total_return serves, this is the total return.
    Returns None if insufficient future data or entry price unavailable.
    """
    # Positional on the series' own index: the entry is the last row on or
    # before entry_date, the exit the row `horizon_days` after it (the same
    # rows `asof` and `future.iloc[h - 1]` picked). A NaN entry or exit (a
    # session with no valid close, align_to_sessions) is unscored, never
    # replaced by an earlier close.
    pos = int(spy.index.searchsorted(entry_date, side="right")) - 1
    if pos < 0 or pos + horizon_days >= len(spy):
        return None
    entry_price = float(spy.iloc[pos])
    exit_price = float(spy.iloc[pos + horizon_days])
    if not (np.isfinite(entry_price) and np.isfinite(exit_price)) or entry_price <= 0:
        return None
    with np.errstate(over="ignore"):
        ret = float(np.float64(exit_price) / np.float64(entry_price) - 1)
    return ret if np.isfinite(ret) else None  # an unrepresentable ratio is unscored (Codex DR-06)


def compute_metrics(returns: list) -> dict:
    """Return avg_return, median_return, hit_rate, n from list of float returns.

    When returns is empty (no market data overlaps the cohort dates), numeric metrics
    are returned as float('nan') which SQLite stores as NULL — distinguishable from a
    genuine 0% return. The dashboard will display '—' instead of a misleading 0.0%.
    """
    if not returns:
        return {"avg_return": float("nan"), "median_return": float("nan"),
                "hit_rate": float("nan"), "n": 0}
    arr = np.array(returns, dtype=float)
    with np.errstate(over="ignore", invalid="ignore"):
        avg, med = float(np.mean(arr)), float(np.median(arr))
        # Codex DR-07: finite returns whose sum or middle pair overflows still have a
        # representable mean and median; recompute those (only those) on halved values.
        if not np.isfinite(avg):
            avg = float(np.sum(arr / len(arr)))
        if not np.isfinite(med):
            mid = np.sort(arr)[(len(arr) - 1) // 2:len(arr) // 2 + 1]
            med = float(mid[0] / 2 + mid[-1] / 2)
    return {
        "avg_return":    avg,
        "median_return": med,
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

    computed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

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
    computed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

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

def ensure_basis_column(conn: sqlite3.Connection) -> None:
    """Add the nullable return_basis column to a backtest_results that
    predates it. Rows stored before keep NULL: basis not recorded."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(backtest_results)")}
    if "return_basis" not in cols:
        conn.execute("ALTER TABLE backtest_results ADD COLUMN return_basis TEXT")


def upsert_backtest_results(conn: sqlite3.Connection, rows: list) -> int:
    """
    Full delete-then-insert. backtest_results has no UNIQUE constraint
    so this is the correct approach to avoid duplicates on re-runs.

    Rows where value is NaN (empty cohort avg/median/hit_rate) are dropped before
    insertion because the schema has value NOT NULL. The n=0 row is kept so the
    dashboard can display '0' samples and '—' for the return metrics via the pivot.
    """
    if not rows:
        return 0
    # Filter out NaN values (backtest_results.value is NOT NULL).
    # NaN (an empty cohort) and, defensively, any non-finite value are never stored (Codex DR-07).
    rows = [r for r in rows if not (isinstance(r[4], float) and not math.isfinite(r[4]))]
    if not rows:
        return 0
    ensure_basis_column(conn)
    conn.execute("DELETE FROM backtest_results")
    conn.executemany(
        """
        INSERT INTO backtest_results
            (test_name, cohort, horizon, metric, value, computed_at, return_basis)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [(*r, RETURN_BASIS_KEY) for r in rows],
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
        spy = load_spy_total_return(conn)
        if spy.empty:
            logger.warning(
                "[backtest] No SPY total-return closes in %s (interval %s); backtest_results left as stored. "
                "Run: python -m src.market_data.asset_history",
                SOURCE_TABLE, SOURCE_INTERVAL,
            )
            return

        logger.info("[backtest] SPY %s closes loaded from %s: %d rows (%s → %s)",
                    RETURN_BASIS, SOURCE_TABLE, len(spy), spy.index[0].date(), spy.index[-1].date())

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
