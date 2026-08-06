"""
src/utils/format.py — Shared display-formatting helpers.

Standalone module (no src.config import — safe for keyless contexts like the
dashboard components and the self-contained analytics modules).
"""
from __future__ import annotations


def ordinal(n: float | int) -> str:
    """Format a number as an English ordinal: 1 -> '1st', 2 -> '2nd', 3 -> '3rd',
    4 -> '4th', 11/12/13 -> '11th/12th/13th', 21 -> '21st', 102 -> '102nd'.

    Rounds non-integers first (percentile ranks arrive as floats).
    """
    i = int(round(float(n)))
    if 10 <= i % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(i % 10, "th")
    return f"{i}{suffix}"


# What each surprise z-score metric measures, and therefore how its raw value
# must be phrased. Shared by the dashboard surprise rows (db_helpers) and the
# weekly memo (memo.py) so the two surfaces can never diverge again.
_Z_METRIC_KIND: dict[str, str] = {
    # weekly total returns stored as FRACTIONS (0.0039 = +0.39%)
    "SPY_weekly_ret_z": "ret", "QQQ_weekly_ret_z": "ret", "IWM_weekly_ret_z": "ret",
    "TLT_weekly_ret_z": "ret", "HYG_weekly_ret_z": "ret", "LQD_weekly_ret_z": "ret",
    "GLD_weekly_ret_z": "ret", "UUP_weekly_ret_z": "ret", "USO_weekly_ret_z": "ret",
    # weekly changes in yields, stored in percentage points (0.04 = +4 bps)
    "DGS10_weekly_chg_z": "yield_chg",
    "DGS2_weekly_chg_z":  "yield_chg",
    "SPREAD_weekly_chg_z": "yield_chg",
    # weekly change in the unemployment rate, percentage points
    "UNRATE_weekly_chg_z": "pp_chg",
    # weekly change in the VIX, index points
    "VIX_weekly_chg_z": "pt_chg",
    # CPI YoY is a LEVEL in percent (4.17 = running at 4.17% YoY); its z-score
    # ranks the level against its recent range — it is NOT a weekly move
    "CPI_yoy_z": "level_pct",
}


def z_interpretation(metric: str, label: str, z: float, raw_val: float | None) -> str:
    """One-line desk note for a z-score surprise row.

    Levels are phrased as readings and changes as moves, each with its native
    unit — a CPI *level* must never read as a weekly surge.
    """
    kind = _Z_METRIC_KIND.get(metric, "ret")
    if kind == "level_pct":
        hilo = "high" if z > 0 else "low"
        lvl = f" at {raw_val:.2f}% YoY" if raw_val is not None else ""
        return f"{label} runs{lvl} — a {abs(z):.1f}σ {hilo} reading vs its recent range"
    direction = "surged" if z > 0 else "fell"
    mag = "sharply" if abs(z) >= 2.5 else ("notably" if abs(z) >= 1.5 else "modestly")
    if raw_val is None:
        raw_str = ""
    elif kind == "yield_chg":
        raw_str = f" ({raw_val * 100:+.0f} bps on the week)"
    elif kind == "pp_chg":
        raw_str = f" ({raw_val:+.2f}pp on the week)"
    elif kind == "pt_chg":
        raw_str = f" ({raw_val:+.1f} pts on the week)"
    else:  # weekly total return, fraction -> percent
        raw_str = f" ({raw_val * 100:+.2f}% on the week)"
    return f"{label} {direction} {mag}{raw_str} — {abs(z):.1f}σ move"
