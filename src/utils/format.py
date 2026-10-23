"""
src/utils/format.py — Shared display-formatting helpers.

Standalone module (no src.config import — safe for keyless contexts like the
dashboard components and the self-contained analytics modules).
"""
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal


# ── Odds as whole percents (fix/site-audit D1) ───────────────────────────────
# A stored probability prints as a whole percent rounded half up on its
# decimal value: 0.425 → 43%. Python's round() sends a tie to the even digit
# (42.5 → 42) and format(x, ".0%") rounds the double's binary value (0.425 is
# 0.42499… → 42), while the web rounded the same stored odds up: the takeaway
# narrative read "(42% odds)" beside 43% everywhere else. The web's copy of
# the rule is `roundHalfUp` in web/src/lib/format.ts; one fixture,
# web/src/lib/__fixtures__/whole-percent.json, drives both suites
# (tests/test_whole_percent.py, web/src/lib/format.test.ts).

def round_half_up(x: float, shift: int = 0) -> int:
    """x × 10**shift as an integer, rounded half up (away from zero) on the
    decimal Python prints for x: its shortest round-trip spelling, the one
    JavaScript prints too, so 0.285 × 100 is 28.5 and rounds to 29."""
    d = Decimal(repr(float(x))).scaleb(shift)
    return int(d.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_pct(frac: float) -> float:
    """A 0–1 probability on the 0–100 scale, exactly from its decimal: 0.425 → 42.5, 0.285 → 28.5 (a bare
    0.285 * 100 is 28.499…, which then rounds down). For a model that computes on percent points and a
    printer that rounds them half up (Codex S-03)."""
    return float(Decimal(repr(float(frac))).scaleb(2))


def whole_pct(frac: float) -> int:
    """A 0–1 probability as a whole percent under the rule: 0.425 → 43."""
    return round_half_up(frac, 2)


def pct_text(frac: float) -> str:
    """A 0–1 probability as printed text: 0.425 → "43%"."""
    return f"{whole_pct(frac)}%"


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
    # one-session changes (src/analytics/surprise.build_daily_metrics)
    "VIX_daily_chg_z": "pt_chg",
    "DGS10_daily_chg_z": "yield_chg",
    "DGS2_daily_chg_z": "yield_chg",
    # CPI YoY is a LEVEL in percent (4.17 = running at 4.17% YoY); its z-score
    # ranks the level against its recent range — it is NOT a weekly move
    "CPI_yoy_z": "level_pct",
}


# Monthly prints carried through the weeks (src/analytics/surprise.load_fred_weekly);
# api/db serves their cadence as "monthly".
MONTHLY_Z_METRICS = frozenset({"UNRATE_weekly_chg_z", "CPI_yoy_z"})


def z_interpretation(metric: str, label: str, z: float, raw_val: float | None) -> str:
    """One-line desk note for a z-score surprise row.

    Levels are phrased as readings and changes as moves, each with its native
    unit — a CPI *level* must never read as a weekly surge. The direction word
    follows the move itself: a rise smaller than the usual rise has a negative
    z and still rose, so when the move and z disagree in sign (or either is
    zero) the sentence says which way the series moved and where the move sits
    against its usual move. With no raw move there is no direction word.
    """
    kind = _Z_METRIC_KIND.get(metric, "ret")
    if kind == "level_pct":
        hilo = "high" if z > 0 else "low"
        # A label like "CPI YoY" plus the "% YoY" unit would say YoY twice
        # ("CPI YoY runs at 3.46% YoY") — the unit owns the suffix.
        name = label.removesuffix(" YoY")
        lvl = f" at {raw_val:.2f}% YoY" if raw_val is not None else ""
        return f"{name} runs{lvl} — a {abs(z):.1f}σ {hilo} reading vs its recent range"
    daily = "_daily_" in metric
    span = "day" if daily else "week"
    side = "above" if z > 0 else ("below" if z < 0 else None)
    if raw_val is not None and not math.isfinite(raw_val):
        raw_val = None
    if raw_val is None:
        where = f"a {abs(z):.1f}σ {'one-day' if daily else 'weekly'} move {side} its usual move" if side else (
            f"a {'one-day' if daily else 'weekly'} move at its usual move")
        return f"{label}: {where}"
    raw_val = raw_val + 0.0  # a negative zero prints "+0.0", never "-0.0" beside "was unchanged"
    if kind == "yield_chg":
        raw_str = f" ({raw_val * 100:+.0f} bps on the {span})"
    elif kind == "pp_chg":
        # the latest print available this week minus the one a week earlier: 0 on a week with no new print
        raw_str = f" ({raw_val:+.2f}pp, latest print vs a week earlier)"
    elif kind == "pt_chg":
        raw_str = f" ({raw_val:+.1f} pts on the {span})"
    else:  # weekly total return, fraction -> percent
        raw_str = f" ({raw_val * 100:+.2f}% on the {span})"
    if (raw_val > 0 and z > 0) or (raw_val < 0 and z < 0):
        direction = "surged" if z > 0 else "fell"
        mag = "sharply" if abs(z) >= 2.5 else ("notably" if abs(z) >= 1.5 else "modestly")
        return f"{label} {direction} {mag}{raw_str} — {abs(z):.1f}σ move"
    verb = "rose" if raw_val > 0 else ("fell" if raw_val < 0 else "was unchanged")
    where = f"{abs(z):.1f}σ {side} its usual move" if side else "at its usual move"
    return f"{label} {verb}{raw_str} — {where}"
