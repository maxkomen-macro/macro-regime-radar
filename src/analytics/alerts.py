"""
src/analytics/alerts.py — Generate macro and market alerts into alert_feed.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Run:
    python -m src.analytics.alerts

Reads:  signals (macro signal history), derived_metrics (weekly z-scores/returns)
Writes: alert_feed

Macro signal severity:
    yield_curve_inversion: severity = abs(min(spread, 0))
    vix_spike:             severity = max(vix_value - 30, 0)
    cpi_hot:               severity = max(cpi_value - 4, 0)
    cpi_cold:              severity = max(1 - cpi_value, 0)
    unemployment_spike:    severity = max(unrate_chg - 0.3, 0)

Alert levels:
    "info":  triggered, low severity, duration < 3 months
    "watch": severity >= threshold_low  OR  duration >= 3 months
    "risk":  severity >= threshold_high OR  duration >= 6 months

Market alerts (from derived_metrics):
    SPY_drawdown:   SPY_weekly_ret < -7% → risk; < -3% → watch
    credit_stress:  HYG_weekly_ret - SPY_weekly_ret < -3% → watch
    VIX_shock:      VIX_weekly_chg_z > 3 → risk; > 2 → watch
    USD_breakout:   UUP_weekly_ret_z > 2 → watch

Re-runs: delete today's alert_feed rows and reinsert (no UNIQUE constraint).
"""
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Severity configuration per signal ─────────────────────────────────────────

SIGNAL_CFG = {
    "yield_curve_inversion": {
        "severity_fn":    lambda v: abs(min(v, 0.0)),
        "threshold_low":  0.2,
        "threshold_high": 1.0,
    },
    "vix_spike": {
        "severity_fn":    lambda v: max(v - 30.0, 0.0),
        "threshold_low":  5.0,
        "threshold_high": 15.0,
    },
    "cpi_hot": {
        "severity_fn":    lambda v: max(v - 4.0, 0.0),
        "threshold_low":  1.0,
        "threshold_high": 3.0,
    },
    "cpi_cold": {
        "severity_fn":    lambda v: max(1.0 - v, 0.0),
        "threshold_low":  0.5,
        "threshold_high": 1.0,
    },
    "unemployment_spike": {
        "severity_fn":    lambda v: max(v - 0.3, 0.0),
        "threshold_low":  0.2,
        "threshold_high": 0.5,
    },
}


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Helpers ────────────────────────────────────────────────────────────────────

def _compute_duration_months(sdf: pd.DataFrame) -> int:
    """
    Count consecutive months at the tail of sdf where triggered=1.
    sdf must have columns: date, triggered. Sorted descending before counting.
    """
    s = sdf.sort_values("date", ascending=False).reset_index(drop=True)
    count = 0
    for _, row in s.iterrows():
        if int(row["triggered"]) == 1:
            count += 1
        else:
            break
    return count


def _compute_level(severity: float, duration_months: int, cfg: dict) -> str:
    if severity >= cfg["threshold_high"] or duration_months >= 6:
        return "risk"
    if severity >= cfg["threshold_low"] or duration_months >= 3:
        return "watch"
    return "info"


def _get_latest_derived(conn: sqlite3.Connection, name: str):
    """Return (value, date_str) for the most recent derived_metric by name, or (None, None)."""
    row = conn.execute(
        "SELECT value, date FROM derived_metrics WHERE name=? ORDER BY date DESC LIMIT 1",
        (name,),
    ).fetchone()
    if row:
        return float(row["value"]), row["date"]
    return None, None


# How many months back to look for recently-triggered (but currently inactive) signals.
LOOKBACK_MONTHS = 6

# ── Macro alerts ──────────────────────────────────────────────────────────────

def build_macro_alerts(conn: sqlite3.Connection) -> list:
    """
    Build alert_feed rows from macro signals table.

    For each signal:
    - If triggered at its own most-recent data date → current alert.
    - If not currently triggered, look back LOOKBACK_MONTHS months: if the signal
      fired within that window, emit a "recently triggered" alert using the most
      recent triggered row so the Alerts tab is never silently empty in normal markets.
    """
    rows_out = []
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    all_signals = pd.read_sql_query(
        "SELECT date, signal_name, value, triggered FROM signals ORDER BY date, signal_name",
        conn,
    )
    if all_signals.empty:
        logger.warning("[alerts] signals table is empty.")
        return rows_out

    all_signals = all_signals.assign(date=pd.to_datetime(all_signals["date"]))

    for signal_name, cfg in SIGNAL_CFG.items():
        sdf = all_signals[all_signals["signal_name"] == signal_name].sort_values("date")
        if sdf.empty:
            logger.warning("[alerts] Signal '%s' not found in DB.", signal_name)
            continue

        # Use the signal's own latest date, not the global max across all signals.
        signal_latest_date = sdf["date"].max()
        latest_row = sdf[sdf["date"] == signal_latest_date].iloc[0]
        val       = float(latest_row["value"])
        triggered = int(latest_row["triggered"])
        alert_date = signal_latest_date

        if triggered == 0:
            # Check for recent triggers within the lookback window.
            cutoff = signal_latest_date - pd.DateOffset(months=LOOKBACK_MONTHS)
            recent = sdf[(sdf["date"] >= cutoff) & (sdf["triggered"] == 1)]
            if recent.empty:
                continue  # no recent activity — skip entirely
            # Use the most recent past trigger for severity/level calculation.
            past_row   = recent.sort_values("date").iloc[-1]
            val        = float(past_row["value"])
            alert_date = past_row["date"]

        severity = cfg["severity_fn"](val)
        duration = _compute_duration_months(sdf)
        level    = _compute_level(severity, duration, cfg)

        currently_active = bool(int(latest_row["triggered"]) == 1)
        status_note = "" if currently_active else f" (last triggered {alert_date.strftime('%Y-%m')})"
        message = (
            f"{signal_name.replace('_', ' ').title()} triggered{status_note}. "
            f"Value={val:.2f}, severity={severity:.2f}, "
            f"duration={duration}mo, level={level.upper()}."
        )
        rows_out.append((
            alert_date.strftime("%Y-%m-%d"),
            "macro_signal",
            signal_name,
            level,
            val,
            None,   # threshold is multi-factor, not a single number
            "above" if val > 0 else "below",
            message,
            created_at,
        ))
        logger.info("[alerts] Macro alert: %s [%s]%s", signal_name, level.upper(),
                    "" if currently_active else " (recently triggered)")

    return rows_out


# ── Market alerts ─────────────────────────────────────────────────────────────

def build_market_alerts(conn: sqlite3.Connection) -> list:
    """
    Build alert_feed rows from derived_metrics weekly returns and z-scores.
    """
    rows_out = []
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    def _add(date_str, name, level, value, threshold, direction, message):
        rows_out.append((
            date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "market",
            name,
            level,
            value,
            threshold,
            direction,
            message,
            created_at,
        ))
        logger.info("[alerts] Market alert: %s [%s]", name, level.upper())

    # SPY drawdown
    spy_ret, spy_date = _get_latest_derived(conn, "SPY_weekly_ret")
    if spy_ret is not None:
        if spy_ret < -0.07:
            _add(spy_date, "SPY_drawdown", "risk", spy_ret, -0.07, "below",
                 f"SPY 5d return {spy_ret:.2%} — below -7% risk threshold.")
        elif spy_ret < -0.03:
            _add(spy_date, "SPY_drawdown", "watch", spy_ret, -0.03, "below",
                 f"SPY 5d return {spy_ret:.2%} — below -3% watch threshold.")

    # Credit stress: HYG underperforms SPY
    hyg_ret, hyg_date = _get_latest_derived(conn, "HYG_weekly_ret")
    if spy_ret is not None and hyg_ret is not None:
        spread  = hyg_ret - spy_ret
        dt_str  = hyg_date or spy_date
        if spread < -0.03:
            _add(dt_str, "credit_stress", "watch", spread, -0.03, "below",
                 f"HYG underperformed SPY by {spread:.2%} — credit stress watch.")

    # VIX shock
    vix_z, vix_date = _get_latest_derived(conn, "VIX_weekly_chg_z")
    if vix_z is not None:
        if vix_z > 3.0:
            _add(vix_date, "VIX_shock", "risk", vix_z, 3.0, "above",
                 f"VIX weekly z-score={vix_z:.2f} — above 3.0 risk threshold.")
        elif vix_z > 2.0:
            _add(vix_date, "VIX_shock", "watch", vix_z, 2.0, "above",
                 f"VIX weekly z-score={vix_z:.2f} — above 2.0 watch threshold.")

    # USD breakout
    uup_z, uup_date = _get_latest_derived(conn, "UUP_weekly_ret_z")
    if uup_z is not None and uup_z > 2.0:
        _add(uup_date, "USD_breakout", "watch", uup_z, 2.0, "above",
             f"UUP weekly return z-score={uup_z:.2f} — USD breakout watch.")

    return rows_out


# ── DB writer ─────────────────────────────────────────────────────────────────

def upsert_alert_feed(conn: sqlite3.Connection, rows: list) -> int:
    """
    Delete today's alert_feed rows and reinsert. alert_feed has no UNIQUE constraint.
    """
    if not rows:
        return 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn.execute("DELETE FROM alert_feed WHERE date=?", (today,))
    conn.executemany(
        """
        INSERT INTO alert_feed
            (date, alert_type, name, level, value, threshold, direction, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run() -> None:
    conn = _get_conn()
    try:
        macro_rows  = build_macro_alerts(conn)
        market_rows = build_market_alerts(conn)
        all_rows    = macro_rows + market_rows

        if not all_rows:
            logger.info("[alerts] No alerts generated (no triggered signals or threshold breaches).")
        else:
            n = upsert_alert_feed(conn, all_rows)
            logger.info("[alerts] Done. %d alert_feed rows written.", n)

        print(f"\n--- Alert Feed ({len(all_rows)} alerts) ---")
        for row in all_rows:
            date_str, atype, name, level, val, thr, direction, msg, _ = row
            val_str = f"{val:.4f}" if val is not None else "N/A"
            print(
                f"  [{level.upper():5s}] {name:30s}  val={val_str:10s}  {msg[:80]}"
            )
    finally:
        conn.close()


if __name__ == "__main__":
    run()
