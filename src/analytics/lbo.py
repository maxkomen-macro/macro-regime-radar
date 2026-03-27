"""
LBO Calculator — analytics module.
Standalone: no src.config import, defines own DB_PATH and _get_conn().
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ---------------------------------------------------------------------------
# Live market data defaults
# ---------------------------------------------------------------------------

def get_lbo_defaults() -> dict:
    """
    Load live market data to pre-populate calculator defaults.
    BAMLH0A0HYM2 is stored raw as % in FRED (e.g. 3.27 = 327 bps) — use directly.
    Returns dict with live values for interest rate inputs.
    Graceful fallback to reasonable defaults if DB unavailable.
    """
    _FALLBACK = {
        "fedfunds": 5.33,
        "hy_oas_pct": 3.27,
        "lbo_all_in_rate": 8.60,
        "data_as_of": "unavailable",
    }

    try:
        conn = _get_conn()
        try:
            ff_row = conn.execute(
                "SELECT value, date FROM raw_series WHERE series_id='FEDFUNDS' ORDER BY date DESC LIMIT 1"
            ).fetchone()
            hy_row = conn.execute(
                "SELECT value, date FROM raw_series WHERE series_id='BAMLH0A0HYM2' ORDER BY date DESC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()

        if ff_row is None or hy_row is None:
            return _FALLBACK

        fedfunds   = float(ff_row[0])
        hy_oas_pct = float(hy_row[0])  # already in % (e.g. 3.27)

        # data_as_of = whichever series has the more recent date
        ff_date = ff_row[1]
        hy_date = hy_row[1]
        data_as_of = ff_date if ff_date >= hy_date else hy_date

        return {
            "fedfunds":       round(fedfunds, 2),
            "hy_oas_pct":     round(hy_oas_pct, 2),
            "lbo_all_in_rate": round(fedfunds + hy_oas_pct, 2),
            "data_as_of":     data_as_of,
        }
    except Exception:
        return _FALLBACK


# ---------------------------------------------------------------------------
# IRR computation (binary search on NPV — numpy.irr not used)
# ---------------------------------------------------------------------------

def _compute_irr(cashflows: list) -> float | None:
    """
    Binary search for IRR. cashflows[0] is negative (investment).
    Returns IRR as percentage (e.g. 18.5 for 18.5%), or None if no valid IRR.
    """
    def npv(rate: float) -> float:
        return sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))

    # Edge case: NPV still positive at 1000% rate → no valid IRR
    if npv(10.0) > 0:
        return None

    # Edge case: NPV negative even at -99% → no valid IRR
    if npv(-0.99) < 0:
        return None

    lo, hi = -0.99, 10.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(mid) > 0:
            lo = mid
        else:
            hi = mid

    irr = (lo + hi) / 2 * 100  # convert to percentage
    return round(irr, 2)


# ---------------------------------------------------------------------------
# Core LBO model
# ---------------------------------------------------------------------------

def run_lbo_model(
    ebitda: float,
    ebitda_growth_rate: float,
    entry_multiple: float,
    exit_multiple: float,
    hold_period: int,
    leverage_ratio: float,
    interest_rate: float,
    amortization_rate: float,
    mgmt_fee_pct: float,
) -> dict:
    """
    Run a leveraged buyout model using declining balance interest.

    Parameters (all numeric):
        ebitda              Entry EBITDA ($M)
        ebitda_growth_rate  Annual EBITDA growth (%)
        entry_multiple      EV/EBITDA at entry
        exit_multiple       EV/EBITDA at exit
        hold_period         Hold period in years (1-10)
        leverage_ratio      Debt/EBITDA at entry
        interest_rate       All-in interest rate (%)
        amortization_rate   % of initial debt repaid per year
        mgmt_fee_pct        Transaction/mgmt fees as % of entry EV

    Returns dict with deal summary, returns, annual schedule, and viability.
    """
    # --- Entry structure ---
    entry_ev     = ebitda * entry_multiple
    entry_debt   = ebitda * leverage_ratio
    fee_dollars  = entry_ev * mgmt_fee_pct / 100
    entry_equity = entry_ev - entry_debt - fee_dollars

    if entry_equity <= 0:
        return {
            "entry_ev":    entry_ev,
            "entry_debt":  entry_debt,
            "entry_equity": entry_equity,
            "exit_ev":     None,
            "exit_debt":   None,
            "exit_equity": None,
            "moic":        None,
            "irr":         None,
            "equity_gain": None,
            "schedule":    [],
            "viable":      False,
            "error_msg":   "Leverage too high — debt exceeds entry EV",
        }

    # --- Annual schedule (declining balance interest) ---
    annual_amort = entry_debt * (amortization_rate / 100)
    schedule = []
    debt_start = entry_debt

    for year in range(1, hold_period + 1):
        interest_year = debt_start * (interest_rate / 100)
        debt_end      = max(debt_start - annual_amort, 0.0)
        ebitda_year   = ebitda * (1 + ebitda_growth_rate / 100) ** year
        implied_ev    = ebitda_year * exit_multiple

        schedule.append({
            "year":       year,
            "ebitda":     round(ebitda_year, 2),
            "implied_ev": round(implied_ev, 2),
            "debt_start": round(debt_start, 2),
            "debt_end":   round(debt_end, 2),
            "interest":   round(interest_year, 2),
        })

        debt_start = debt_end  # next year starts with this balance

    # --- Exit structure ---
    ebitda_exit  = ebitda * (1 + ebitda_growth_rate / 100) ** hold_period
    exit_ev      = ebitda_exit * exit_multiple
    exit_debt    = schedule[-1]["debt_end"]
    exit_equity  = exit_ev - exit_debt

    if exit_equity <= 0:
        return {
            "entry_ev":    entry_ev,
            "entry_debt":  entry_debt,
            "entry_equity": round(entry_equity, 2),
            "exit_ev":     round(exit_ev, 2),
            "exit_debt":   round(exit_debt, 2),
            "exit_equity": round(exit_equity, 2),
            "moic":        None,
            "irr":         None,
            "equity_gain": round(exit_equity - entry_equity, 2),
            "schedule":    schedule,
            "viable":      False,
            "error_msg":   "Deal underwater at exit",
        }

    # --- Returns ---
    moic = exit_equity / entry_equity

    # IRR: [-entry_equity, 0, 0, ..., exit_equity]
    cashflows = [-entry_equity] + [0.0] * (hold_period - 1) + [exit_equity]
    irr = _compute_irr(cashflows)

    return {
        "entry_ev":    round(entry_ev, 2),
        "entry_debt":  round(entry_debt, 2),
        "entry_equity": round(entry_equity, 2),
        "exit_ev":     round(exit_ev, 2),
        "exit_debt":   round(exit_debt, 2),
        "exit_equity": round(exit_equity, 2),
        "moic":        round(moic, 3),
        "irr":         irr,
        "equity_gain": round(exit_equity - entry_equity, 2),
        "schedule":    schedule,
        "viable":      True,
        "error_msg":   "",
    }
