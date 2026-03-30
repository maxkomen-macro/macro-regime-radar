"""
src/analytics/intelligence.py — Market Intelligence analytics layer.

Standalone module (no src.config imports — avoids FRED_API_KEY EnvironmentError).

Synthesises regime, credit, and recession data into narratives, playbooks,
historical analogues, and scenario analysis.

Primary entry points:
    generate_market_takeaway(regime_probs, current_regime, credit_metrics, recession_prob)
    get_regime_playbook(regime)
    get_regime_duration()
    get_transition_narrative(current_regime)
    find_historical_analogues(current_regime, hy_spread_pct, recession_prob)
    run_scenario(scenario_key=None, custom_shocks=None)
"""
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

# ── Section height constants (used by intelligence_tab.py) ────────────────────
INTELLIGENCE_CARD_HEIGHT = 180
REGIME_ROW_HEIGHT        = 400
DURATION_ROW_HEIGHT      = 260
ANALOGUES_HEIGHT         = 220
SCENARIOS_HEIGHT         = 520

# ── Regime base rates (historical frequency, ~1996–present) ──────────────────
REGIME_BASE_RATES: dict[str, float] = {
    "Goldilocks":    0.30,
    "Overheating":   0.35,
    "Stagflation":   0.20,
    "Recession Risk": 0.15,
}

REGIME_COLORS: dict[str, str] = {
    "Goldilocks":    "#2ecc71",
    "Overheating":   "#e67e22",
    "Stagflation":   "#e74c3c",
    "Recession Risk": "#8b949e",
}

# ── Pre-defined scenario templates ────────────────────────────────────────────
SCENARIOS: dict[str, dict] = {
    "covid_replay": {
        "name": "COVID Replay",
        "emoji": "🔴",
        "description": "Acute risk-off shock similar to March 2020",
        "severity": "severe",
        "color": "#e74c3c",
        "input_shocks": {
            "hy_spread_delta_bps": 300,
            "yield_10y_delta_bps": -100,
            "vix_delta": 40,
            "spx_delta_pct": -25,
        },
        "historical_reference": "March 2020",
        "what_happened_then": "50% drawdown in 1 month, full recovery in 5 months with Fed intervention",
        "sector_implications": {
            "overweight": ["Treasuries", "Utilities", "Healthcare", "Cash"],
            "underweight": ["Airlines", "Energy", "Financials", "Consumer Discretionary"],
        },
        "duration_estimate": "Acute phase: 1–3 months. Full recovery contingent on policy response; V-shape if Fed/fiscal acts quickly.",
        "indicators_to_watch": [
            "VIX sustained above 40 — signals systemic panic",
            "HY spreads crossing 700bps — credit market stress",
            "Initial jobless claims spiking above 500k",
            "Fed emergency rate cuts / QE announcement",
            "Treasury 10Y yield approaching 0% — flight to quality peak",
        ],
    },
    "rate_shock": {
        "name": "Rate Shock",
        "emoji": "🟠",
        "description": "Aggressive Fed tightening cycle",
        "severity": "moderate",
        "color": "#e67e22",
        "input_shocks": {
            "hy_spread_delta_bps": 100,
            "yield_10y_delta_bps": 150,
            "vix_delta": 15,
            "spx_delta_pct": -15,
        },
        "historical_reference": "2022 H1",
        "what_happened_then": "Growth stocks crushed, value outperformed, took 18mo to recover",
        "sector_implications": {
            "overweight": ["Energy", "Financials", "Value stocks", "Short-duration credit"],
            "underweight": ["Technology", "REITs", "Long-duration bonds", "Consumer Discretionary"],
        },
        "duration_estimate": "Tightening cycles typically last 12–18 months. Market lows typically 6–9 months before final hike.",
        "indicators_to_watch": [
            "Fed funds futures pricing terminal rate above 5%",
            "10Y yield sustained above 4.5% compressing equity multiples",
            "Mortgage rates above 7% triggering housing slowdown",
            "Yield curve inversion deepening below -100bps",
            "Real rates (TIPS) turning sharply positive",
        ],
    },
    "soft_landing": {
        "name": "Soft Landing",
        "emoji": "🟢",
        "description": "Goldilocks outcome — inflation cools, growth holds",
        "severity": "positive",
        "color": "#2ecc71",
        "input_shocks": {
            "hy_spread_delta_bps": -50,
            "yield_10y_delta_bps": -50,
            "vix_delta": -5,
            "spx_delta_pct": 10,
        },
        "historical_reference": "1995, 2019",
        "what_happened_then": "Extended bull market, risk assets rallied 20%+ over 12mo",
        "sector_implications": {
            "overweight": ["Technology", "Consumer Discretionary", "Small Caps", "HY Credit"],
            "underweight": ["Utilities", "Consumer Staples", "Cash", "Gold"],
        },
        "duration_estimate": "Soft landings extend cycles by 12–24 months. Quality/growth assets outperform for the full duration.",
        "indicators_to_watch": [
            "CPI consistently printing below 3% month-over-month",
            "Unemployment rate stable below 4.5% — no labour market deterioration",
            "ISM Manufacturing recovering back above 50",
            "Corporate earnings guidance upgrades outnumbering cuts",
            "Fed rate cut cycle beginning — dovish pivot confirmed",
        ],
    },
    "stagflation_scare": {
        "name": "Stagflation Scare",
        "emoji": "🟠",
        "description": "Growth slows while inflation persists",
        "severity": "moderate",
        "color": "#e67e22",
        "input_shocks": {
            "hy_spread_delta_bps": 150,
            "yield_10y_delta_bps": 50,
            "vix_delta": 10,
            "spx_delta_pct": -10,
        },
        "historical_reference": "2022 Q2, 1970s",
        "what_happened_then": "No place to hide — stocks and bonds both down",
        "sector_implications": {
            "overweight": ["Energy", "Healthcare", "Staples", "TIPS / Inflation-linked"],
            "underweight": ["Technology", "Consumer Discretionary", "Long-duration bonds", "Industrials"],
        },
        "duration_estimate": "Stagflation episodes: 6–18 months. Resolution requires either demand destruction or supply-side relief.",
        "indicators_to_watch": [
            "Core CPI remaining above 4% despite slowing growth",
            "GDP growth falling below 1% while unemployment rises",
            "Commodity prices (oil, food) remaining elevated",
            "Corporate earnings missing on both revenue and margin compression",
            "Consumer confidence hitting multi-year lows",
        ],
    },
    "credit_crisis": {
        "name": "Credit Crisis",
        "emoji": "🔴",
        "description": "Systemic stress in credit markets",
        "severity": "severe",
        "color": "#e74c3c",
        "input_shocks": {
            "hy_spread_delta_bps": 500,
            "yield_10y_delta_bps": -150,
            "vix_delta": 30,
            "spx_delta_pct": -30,
        },
        "historical_reference": "2008 GFC, March 2020",
        "what_happened_then": "Flight to quality, Treasuries rally, credit frozen, equities -40%+",
        "sector_implications": {
            "overweight": ["Treasuries (long duration)", "Gold", "Cash", "Utilities"],
            "underweight": ["Financials", "HY Credit", "Cyclicals", "Small Caps", "EM"],
        },
        "duration_estimate": "Credit crises: 6–18 month acute phase. Full market recovery typically takes 2–3 years post-trough.",
        "indicators_to_watch": [
            "HY spreads crossing 700–1,000bps — frozen new issuance",
            "LIBOR-OIS / FRA-OIS spread widening (interbank stress)",
            "Financial sector equity underperforming market by 30%+",
            "Investment-grade credit downgrade wave beginning",
            "Commercial paper market seizing — funding stress for corporates",
        ],
    },
}

# ── Pre-encoded historical analogues ─────────────────────────────────────────
_HISTORICAL_PERIODS: list[dict] = [
    {
        "period": "Q4 2017",
        "period_end": "Q1 2018",
        "regime": "Overheating",
        "hy_spread_pct": 12,
        "recession_prob": 8,
        "vix_level": 11,
        "what_happened": "Volmageddon Feb 2018, -10% drawdown then recovery",
        "time_to_change": "6 months",
        "next_regime": "Goldilocks",
        "key_drivers": [
            "US tax reform (TCJA) injected late-cycle fiscal stimulus",
            "Synchronized global growth with all major economies expanding",
            "Short-volatility strategies had grown to extreme scale ($2tr+ notional)",
        ],
        "market_impact": {
            "S&P 500": "+21.8% in 2017, then -10% in 5 days Feb 2018",
            "VIX": "Spiked from 10 to 50 intraday (Volmageddon Feb 5)",
            "Short-vol ETFs": "XIV/SVXY lost 90%+ overnight",
            "HY Credit": "Spreads near cycle tights; minimal contagion",
        },
        "lessons_for_today": (
            "Low VIX with crowded positioning can unwind violently even without a macro catalyst. "
            "The structural short-vol trade amplified a routine correction into a vol event."
        ),
        "resolution": (
            "The Volmageddon spike resolved in weeks as macro fundamentals remained strong. "
            "Markets recovered and ground higher through Q3 2018 before the December 2018 Fed-driven selloff."
        ),
    },
    {
        "period": "Q3 2014",
        "period_end": "Q4 2014",
        "regime": "Overheating",
        "hy_spread_pct": 18,
        "recession_prob": 10,
        "vix_level": 14,
        "what_happened": "Slow grind higher, no vol event for 9 months",
        "time_to_change": "9 months",
        "next_regime": "Overheating",
        "key_drivers": [
            "US dollar surged ~20% driven by Fed taper and diverging global policy",
            "Oil prices began collapsing from $100 to sub-$50 (OPEC supply response)",
            "ECB embarked on negative rates and signalled QE",
        ],
        "market_impact": {
            "S&P 500": "+13.7% for full year 2014 despite Q4 volatility",
            "Energy sector": "-20% in H2 2014 as oil cratered",
            "HY Energy": "Spreads widened 300bps for energy issuers",
            "EM equities": "Underperformed sharply vs USD strength",
        },
        "lessons_for_today": (
            "USD strength and commodity price shocks can create bifurcated markets: "
            "S&P index looks fine while pockets of stress build (HY energy, EM). "
            "Late-cycle regimes can persist for multiple quarters."
        ),
        "resolution": (
            "Oil crash led to HY energy stress in 2015–16, causing two separate 10%+ corrections. "
            "The Fed delayed its first hike until Dec 2015. Full recovery by early 2016 after Fed dovish pivot."
        ),
    },
    {
        "period": "Q2–Q3 2006",
        "period_end": "Q4 2007",
        "regime": "Overheating",
        "hy_spread_pct": 10,
        "recession_prob": 12,
        "vix_level": 12,
        "what_happened": "18 months of continued expansion, then GFC triggered",
        "time_to_change": "18 months",
        "next_regime": "Recession Risk",
        "key_drivers": [
            "Housing market peaked (Case-Shiller topped mid-2006) while credit remained open",
            "Subprime mortgage originations at record levels; CDO/CLO issuance booming",
            "Credit spreads compressed to historical tights — HY OAS near 250bps",
        ],
        "market_impact": {
            "S&P 500": "+15.8% in 2006, +5.5% in 2007 before collapse",
            "HY Credit": "Spreads near 250bps in 2006 — cycle tights",
            "Homebuilders": "-60% from peak by end of 2007",
            "Financials": "Peaked Oct 2007, then lost 80%+ peak-to-trough",
        },
        "lessons_for_today": (
            "Tight credit spreads with rising housing/credit stress is a classic late-cycle trap. "
            "The equity market can continue rising for 12–18 months after leading indicators peak."
        ),
        "resolution": (
            "BNP Paribas froze three funds Aug 2007 (the first crisis signal). "
            "Bear Stearns failed Mar 2008, Lehman Sep 2008. "
            "Fed cut rates to zero and launched QE; markets bottomed Mar 2009 (-57% from peak)."
        ),
    },
    {
        "period": "Q4 2021",
        "period_end": "Q1 2022",
        "regime": "Overheating",
        "hy_spread_pct": 8,
        "recession_prob": 6,
        "vix_level": 17,
        "what_happened": "Rate shock 2022, -25% bear market over 9 months",
        "time_to_change": "3 months",
        "next_regime": "Stagflation",
        "key_drivers": [
            "Fed held zero rates as CPI hit 7%+ (40-year highs) — policy deeply behind curve",
            "Equity valuations at cycle extremes (Shiller CAPE ~38, 2nd highest ever)",
            "Supply chain disruptions and energy price spike kept inflation persistent",
        ],
        "market_impact": {
            "S&P 500": "-25% peak-to-trough Jan–Oct 2022",
            "Bonds (AGG)": "-13% in 2022 — worst year since 1926",
            "Nasdaq 100": "-35% as long-duration growth stocks repriced",
            "HY Credit": "Spreads widened 250bps; no major defaults",
        },
        "lessons_for_today": (
            "Overheating with historically tight spreads and suppressed VIX preceded the most violent "
            "simultaneous stock-bond selloff in a generation. The '60/40 portfolio' offered zero protection."
        ),
        "resolution": (
            "Fed hiked 525bps (Mar 2022–Jul 2023) — fastest tightening cycle since Volcker. "
            "Equities bottomed Oct 2022 as rate-hike pace expectations peaked. "
            "Soft landing fears eventually gave way to recovery through 2023."
        ),
    },
    {
        "period": "Q1 2019",
        "period_end": "Q4 2019",
        "regime": "Goldilocks",
        "hy_spread_pct": 42,
        "recession_prob": 18,
        "vix_level": 14,
        "what_happened": "Fed pivot → rally continued, +30% year",
        "time_to_change": "12 months",
        "next_regime": "Goldilocks",
        "key_drivers": [
            "Powell 'pivot' in Jan 2019 (data-dependent pause after Dec 2018 hike)",
            "US-China trade war fears receded through 2019 following phase-1 deal progress",
            "Global PMIs stabilised after late-2018 growth scare; earnings recovered",
        ],
        "market_impact": {
            "S&P 500": "+31.5% in 2019 — best year since 2013",
            "HY Credit": "Spreads tightened 200bps from Jan to Dec 2019",
            "EM equities": "+18% for the year on dollar weakness",
            "Bonds (AGG)": "+8.7% — bonds and equities rallied together",
        },
        "lessons_for_today": (
            "Fed dovish pivots reliably extend cycles even when recession risk is elevated. "
            "The 2018 bear market was entirely policy-driven and reversed quickly once the Fed blinked."
        ),
        "resolution": (
            "The Goldilocks regime persisted through all of 2019. "
            "COVID arrived in early 2020, triggering the fastest bear market in history (-34% in 33 days). "
            "Fiscal and monetary response drove a V-shaped recovery."
        ),
    },
    {
        "period": "Q2 2020",
        "period_end": "Q4 2020",
        "regime": "Recession Risk",
        "hy_spread_pct": 82,
        "recession_prob": 72,
        "vix_level": 30,
        "what_happened": "Massive stimulus → V-shaped recovery in 5 months",
        "time_to_change": "3 months",
        "next_regime": "Goldilocks",
        "key_drivers": [
            "$2.2tr CARES Act + unlimited Fed QE (balance sheet +$3tr in 12 weeks)",
            "Fed backstopped IG AND HY credit markets for first time ever",
            "Zero rates + fiscal transfers prevented the credit spiral that lengthens recessions",
        ],
        "market_impact": {
            "S&P 500": "-34% Mar 2020, then +68% trough-to-year-end",
            "HY Credit": "Spreads hit 1,100bps, recovered to 400bps by year-end",
            "Treasuries": "10Y yield fell to 0.5% — all-time low",
            "Gold": "+25% in 2020 as real yields went deeply negative",
        },
        "lessons_for_today": (
            "Speed and scale of policy response is the key variable in recession duration. "
            "When the Fed explicitly backstops credit, HY spreads signal the all-clear within weeks."
        ),
        "resolution": (
            "GDP recovered to pre-COVID levels by Q4 2020. "
            "The stimulus overhang seeded the 2021–22 inflation surge. "
            "Goldilocks persisted through 2021 before tipping into Overheating."
        ),
    },
    {
        "period": "Q3 2022",
        "period_end": "Q4 2022",
        "regime": "Stagflation",
        "hy_spread_pct": 65,
        "recession_prob": 38,
        "vix_level": 26,
        "what_happened": "Continued drawdown, bottomed Q4 2022, then recovery",
        "time_to_change": "6 months",
        "next_regime": "Goldilocks",
        "key_drivers": [
            "CPI peaked at 9.1% June 2022 but remained above 6% through Q3",
            "Fed hiking 75bps per meeting (Jul, Sep, Nov 2022) — fastest pace since 1981",
            "UK gilt crisis (LDI pension blow-up) added systemic stress in Sep 2022",
        ],
        "market_impact": {
            "S&P 500": "Bottomed Oct 13 2022 at -25% from Jan peak",
            "Nasdaq 100": "-35% year-to-date at the low",
            "HY Credit": "Spreads peaked ~600bps — elevated but not crisis levels",
            "Gold": "Flat for the year — failed as inflation hedge vs real rate surge",
        },
        "lessons_for_today": (
            "Stagflation regimes end when inflation expectations peak, not when inflation itself peaks. "
            "Markets bottom 6–12 months before CPI returns to target."
        ),
        "resolution": (
            "CPI peaked Jun 2022 (9.1%). Equities bottomed Oct 2022 as terminal rate expectations stabilised. "
            "Full recovery through 2023 as soft-landing narrative gained traction; "
            "S&P 500 reached new highs by Jan 2024."
        ),
    },
]

# ── Markov transition matrices (fallback if DB insufficient) ──────────────────
# 3-month horizon: {from_regime: {to_regime: probability_pct}}
_FALLBACK_TRANSITIONS_3M: dict[str, dict[str, int]] = {
    "Goldilocks": {
        "Goldilocks": 60, "Overheating": 25, "Stagflation": 10, "Recession Risk": 5
    },
    "Overheating": {
        "Goldilocks": 15, "Overheating": 55, "Stagflation": 20, "Recession Risk": 10
    },
    "Stagflation": {
        "Goldilocks": 10, "Overheating": 20, "Stagflation": 45, "Recession Risk": 25
    },
    "Recession Risk": {
        "Goldilocks": 35, "Overheating": 10, "Stagflation": 20, "Recession Risk": 35
    },
}

_FALLBACK_TRANSITIONS_6M: dict[str, dict[str, int]] = {
    "Goldilocks": {
        "Goldilocks": 45, "Overheating": 30, "Stagflation": 15, "Recession Risk": 10
    },
    "Overheating": {
        "Goldilocks": 20, "Overheating": 40, "Stagflation": 25, "Recession Risk": 15
    },
    "Stagflation": {
        "Goldilocks": 15, "Overheating": 15, "Stagflation": 35, "Recession Risk": 35
    },
    "Recession Risk": {
        "Goldilocks": 40, "Overheating": 15, "Stagflation": 15, "Recession Risk": 30
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _load_series(series_id: str, conn: sqlite3.Connection, scale: float = 1.0) -> pd.Series:
    """Load a raw_series by FRED ID. Returns pd.Series with DatetimeIndex."""
    rows = conn.execute(
        "SELECT date, value FROM raw_series WHERE series_id=? ORDER BY date",
        (series_id,),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float, name=series_id)
    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date").sort_index()
    s = df["value"].dropna()
    if scale != 1.0:
        s = s * scale
    s.name = series_id
    return s


def _pct_rank(series: pd.Series, current_val: float) -> int:
    """Percentile rank of current_val in series. Returns 0–100."""
    if series.empty:
        return 50
    arr = series.dropna()
    if len(arr) == 0:
        return 50
    return int(round((arr.values < current_val).mean() * 100))


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _derive_probs_from_confidence(label: str, confidence: float) -> dict[str, int]:
    """Convert regime label + confidence to full probability distribution (0–100 ints)."""
    remaining = 1.0 - confidence
    other_total = sum(v for k, v in REGIME_BASE_RATES.items() if k != label)
    probs: dict[str, int] = {}
    allocated = 0
    regimes = list(REGIME_BASE_RATES.items())
    for i, (regime, base) in enumerate(regimes):
        if regime == label:
            probs[regime] = round(confidence * 100)
        else:
            val = round((base / other_total) * remaining * 100)
            probs[regime] = val
            allocated += val
    # Fix rounding to ensure sum = 100
    total = sum(probs.values())
    if total != 100:
        probs[label] += 100 - total
    return probs


def _get_current_regime_state(conn: sqlite3.Connection | None = None) -> dict:
    """
    Query regimes table for the latest row.
    Returns dict with label, confidence, approx_probs (keyed by display name), date.
    """
    _close = False
    if conn is None:
        conn = _get_conn()
        _close = True
    try:
        row = conn.execute(
            "SELECT date, label, confidence FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if not row:
            label = "Goldilocks"
            confidence = 0.30
            date_str = "N/A"
        else:
            label = row["label"]
            confidence = float(row["confidence"])
            date_str = row["date"]
        probs = _derive_probs_from_confidence(label, confidence)
        return {
            "label": label,
            "confidence": confidence,
            "approx_probs": probs,
            "date": date_str,
        }
    finally:
        if _close:
            conn.close()


def _compute_risk_indicators(conn: sqlite3.Connection) -> dict[str, int]:
    """
    Compute risk indicator scores (0–100). Higher = more risk.

    Momentum: SPY 20-day return percentile (high momentum = late-cycle risk)
    Valuation: HY spread inverted percentile (tight spreads = high valuation risk)
    Sentiment: VIX inverted percentile (low VIX = high complacency = high risk)
    """
    # 1. Momentum — SPY 20-day return vs 1-year history
    momentum = 50
    try:
        spy_rows = conn.execute(
            "SELECT date, close FROM market_daily WHERE symbol='SPY' ORDER BY date DESC LIMIT 252"
        ).fetchall()
        if spy_rows and len(spy_rows) >= 25:
            spy = pd.DataFrame(spy_rows, columns=["date", "close"]).sort_values("date")
            closes = spy["close"].values.astype(float)
            recent_20d = (closes[-1] / closes[-21] - 1) * 100
            all_20d = [(closes[i] / closes[i - 20] - 1) * 100 for i in range(20, len(closes))]
            momentum = max(5, _pct_rank(pd.Series(all_20d), recent_20d))
    except Exception:
        pass

    # 2. Valuation — HY OAS percentile, inverted (tight = high valuation risk)
    valuation = 50
    try:
        hy = _load_series("BAMLH0A0HYM2", conn, scale=100.0)
        if not hy.empty:
            current_hy = float(hy.iloc[-1])
            raw_pct = _pct_rank(hy, current_hy)
            valuation = 100 - raw_pct
    except Exception:
        pass

    # 3. Sentiment — VIX percentile, inverted (low VIX = high complacency = high risk)
    sentiment = 50
    try:
        vix = _load_series("VIXCLS", conn)
        if not vix.empty:
            current_vix = float(vix.iloc[-1])
            raw_pct = _pct_rank(vix, current_vix)
            sentiment = 100 - raw_pct
    except Exception:
        pass

    return {"momentum": int(momentum), "valuation": int(valuation), "sentiment": int(sentiment)}


def _estimate_stressed_probs(
    current_probs: dict[str, int], shocks: dict
) -> dict[str, int]:
    """
    Apply scenario shocks to current regime probabilities using simplified stress multipliers.
    current_probs: {"Goldilocks": 19, "Overheating": 59, "Stagflation": 17, "Recession Risk": 5}
    """
    hy_delta  = shocks.get("hy_spread_delta_bps", 0)
    y10_delta = shocks.get("yield_10y_delta_bps", 0)
    vix_delta = shocks.get("vix_delta", 0)
    spx_delta = shocks.get("spx_delta_pct", 0)

    stress_score = (hy_delta / 100) + (vix_delta / 20) - (spx_delta / 10)
    rate_score   = y10_delta / 50

    gold = max(5.0, current_probs.get("Goldilocks", 25)    - stress_score * 8  - rate_score * 3)
    over = max(5.0, current_probs.get("Overheating", 25)   - stress_score * 10 + rate_score * 2)
    stag = max(5.0, current_probs.get("Stagflation", 25)   + stress_score * 6  + rate_score * 5)
    rec  = max(2.0, current_probs.get("Recession Risk", 25) + stress_score * 12)

    total = gold + over + stag + rec
    g = round(gold / total * 100)
    o = round(over / total * 100)
    s = round(stag / total * 100)
    r = 100 - g - o - s  # absorb rounding residual

    return {"Goldilocks": g, "Overheating": o, "Stagflation": s, "Recession Risk": r}


def _compute_transitions_from_db(
    conn: sqlite3.Connection,
    n_step: int,
) -> dict[str, dict[str, int]] | None:
    """
    Compute n_step-month regime transition probabilities from DB history.
    Returns None if fewer than 50 transitions available.
    """
    rows = conn.execute(
        "SELECT date, label FROM regimes ORDER BY date"
    ).fetchall()
    labels = [r["label"] for r in rows]
    if len(labels) < n_step + 10:
        return None

    counts: dict[str, dict[str, int]] = {}
    for i in range(len(labels) - n_step):
        frm = labels[i]
        to  = labels[i + n_step]
        counts.setdefault(frm, {})
        counts[frm][to] = counts[frm].get(to, 0) + 1

    if sum(len(v) for v in counts.values()) < 50:
        return None

    result: dict[str, dict[str, int]] = {}
    for frm, to_dict in counts.items():
        total = sum(to_dict.values())
        result[frm] = {to: round(cnt / total * 100) for to, cnt in to_dict.items()}
        # Fix rounding
        tot = sum(result[frm].values())
        if tot != 100:
            max_key = max(result[frm], key=lambda k: result[frm][k])
            result[frm][max_key] += 100 - tot
    return result


def _compute_historical_avg_duration(conn: sqlite3.Connection) -> dict[str, float]:
    """Compute average regime streak length in months for each regime."""
    rows = conn.execute(
        "SELECT date, label FROM regimes ORDER BY date"
    ).fetchall()
    labels = [r["label"] for r in rows]

    streaks: dict[str, list[int]] = {k: [] for k in REGIME_BASE_RATES}
    if not labels:
        return {k: 6.0 for k in REGIME_BASE_RATES}

    current_label = labels[0]
    streak_len = 1
    for lbl in labels[1:]:
        if lbl == current_label:
            streak_len += 1
        else:
            if current_label in streaks:
                streaks[current_label].append(streak_len)
            current_label = lbl
            streak_len = 1
    if current_label in streaks:
        streaks[current_label].append(streak_len)

    return {
        k: float(np.mean(v)) if v else 6.0
        for k, v in streaks.items()
    }


# ─────────────────────────────────────────────────────────────────────────────
# R1.1 — Market Takeaway Generator
# ─────────────────────────────────────────────────────────────────────────────

def generate_market_takeaway(
    regime_probs: dict,
    current_regime: str,
    credit_metrics: dict,
    recession_prob: float,
) -> dict:
    """
    Synthesise a 3–4 sentence market narrative from current conditions.

    regime_probs: floats (0–1) or ints (0–100), keys use lowercase underscore
    current_regime: display name e.g. "Overheating"
    credit_metrics: from get_credit_metrics()
    recession_prob: float 0–100
    """
    # Normalise probs to 0–100 ints keyed by display name
    def _norm_key(k: str) -> str:
        return k.replace("_", " ").title().replace("Risk", "Risk")

    raw_probs = {}
    for k, v in regime_probs.items():
        display = _norm_key(k)
        # Map "Recession Risk" variant spellings
        if "recession" in k.lower():
            display = "Recession Risk"
        raw_probs[display] = v

    # Determine scale
    max_val = max(raw_probs.values()) if raw_probs else 1
    scale = 100 if max_val <= 1.0 else 1
    probs_100 = {k: round(v * scale) for k, v in raw_probs.items()}

    top_regime = current_regime
    top_prob   = probs_100.get(top_regime, 30)

    # Credit context
    hy_pct = credit_metrics.get("hy_pct_rank") if credit_metrics else None
    credit_label = credit_metrics.get("credit_label", "Normal") if credit_metrics else "Normal"

    # Safe fallbacks
    if hy_pct is None:
        hy_pct = 50
    rec_prob = recession_prob if recession_prob is not None else 15.0

    # ── Divergence detection ─────────────────────────────────────────────────
    divergences: list[str] = []
    conn = _get_conn()
    try:
        dgs10 = _load_series("DGS10", conn)
        dgs2  = _load_series("DGS2",  conn)
        if not dgs10.empty and not dgs2.empty:
            spread = float(dgs10.iloc[-1]) - float(dgs2.iloc[-1])
            if spread < 0 and hy_pct < 30:
                divergences.append("yield curve inverted despite tight spreads")
        if rec_prob > 25 and hy_pct < 25:
                divergences.append("recession model elevated but credit markets complacent")
    except Exception:
        pass
    finally:
        conn.close()

    # ── Conviction scoring ───────────────────────────────────────────────────
    if top_prob > 55 and not divergences:
        conviction = "High"
        conviction_color = "#2ecc71"
    elif top_prob < 40 or len(divergences) >= 2:
        conviction = "Low"
        conviction_color = "#e67e22"
    else:
        conviction = "Medium"
        conviction_color = "#4a9eff"

    # ── Primary signal ───────────────────────────────────────────────────────
    risk_off_regimes = {"Recession Risk", "Stagflation"}
    if top_regime in risk_off_regimes or rec_prob > 35:
        primary_signal = "Risk-Off"
    elif top_regime in {"Goldilocks", "Overheating"} and rec_prob < 20:
        primary_signal = "Risk-On"
    else:
        primary_signal = "Mixed"

    # ── Narrative construction ───────────────────────────────────────────────
    spread_desc = f"{hy_pct}th percentile"
    if hy_pct < 20:
        spread_qual = "historically tight"
    elif hy_pct < 40:
        spread_qual = "below average"
    elif hy_pct < 60:
        spread_qual = "near average"
    elif hy_pct < 80:
        spread_qual = "above average"
    else:
        spread_qual = "historically wide"

    if rec_prob < 15:
        rec_context = f"recession risk remains low at {rec_prob:.0f}%"
    elif rec_prob < 30:
        rec_context = f"recession risk is elevated at {rec_prob:.0f}%"
    else:
        rec_context = f"recession risk is high at {rec_prob:.0f}% — watch closely"

    if primary_signal == "Risk-On":
        implication = (
            "Conditions favour risk assets, though valuations limit upside "
            "and drawdown risk rises from current spread levels."
        )
    elif primary_signal == "Risk-Off":
        implication = (
            "Positioning should tilt defensive — reduce cyclical exposure and "
            "add duration or quality as the macro backdrop deteriorates."
        )
    else:
        implication = (
            "Positioning should balance offensive and defensive exposure, "
            "with hedges to guard against the key divergence signals."
        )

    if divergences:
        div_sentence = (
            f"Divergence alert: {' and '.join(divergences).capitalize()}. "
        )
    else:
        div_sentence = ""

    narrative = (
        f"Markets are in <strong>{top_regime}</strong> regime ({top_prob}% probability) "
        f"with credit spreads at the <strong>{spread_desc}</strong> — {spread_qual}. "
        f"{div_sentence}"
        f"{rec_context.capitalize()}. "
        f"{implication}"
    )

    updated_ago = "Just now"

    return {
        "narrative":        narrative,
        "conviction":       conviction,
        "conviction_color": conviction_color,
        "primary_signal":   primary_signal,
        "divergences":      divergences,
        "updated_ago":      updated_ago,
    }


# ─────────────────────────────────────────────────────────────────────────────
# R1.2 — Regime Playbook
# ─────────────────────────────────────────────────────────────────────────────

def get_regime_playbook(regime: str) -> dict:
    """Return static historical performance and positioning guidance for a regime."""
    _PLAYBOOKS: dict[str, dict] = {
        "Goldilocks": {
            "regime": "Goldilocks",
            "regime_color": "#2ecc71",
            "description": (
                "Low inflation with solid growth — the ideal backdrop for risk assets. "
                "Monetary policy is accommodative or neutral."
            ),
            "historical_frequency": 30.0,
            "avg_duration_months": 7.5,
            "sector_tilts": {
                "overweight": [
                    {"sector": "Technology",    "strength": 85},
                    {"sector": "Consumer Disc", "strength": 78},
                    {"sector": "Small Caps",    "strength": 70},
                ],
                "underweight": [
                    {"sector": "Utilities",     "strength": 45},
                    {"sector": "Staples",       "strength": 38},
                ],
            },
            "asset_performance": {
                "S&P 500":      {"avg_return": 18.0, "hit_rate": 78},
                "Bonds (AGG)":  {"avg_return":  4.0, "hit_rate": 62},
                "Gold":         {"avg_return":  2.0, "hit_rate": 48},
                "HY Credit":    {"avg_return":  8.0, "hit_rate": 72},
            },
            "typical_indicators": {
                "yield_curve":    "Steep",
                "credit_spreads": "Normal",
                "vix_regime":     "Low",
            },
            "key_risks": [
                "Complacency → regime tips into Overheating",
                "Policy error: premature tightening kills expansion",
            ],
            "warning_signs": [
                "Yield curve flattening as short rates rise faster than long rates",
                "Inflation data starts printing above consensus for 2+ consecutive months",
                "Credit spreads tightening to multi-year lows — complacency risk building",
            ],
            "typical_catalysts": [
                "Fed overtightening in response to inflation overshoot",
                "Supply shock (energy, commodities) pushing inflation above growth",
                "Fiscal policy tightening removing demand stimulus",
            ],
            "opportunities": [
                "Growth equities, momentum strategies",
                "Corporate credit — carry with low default risk",
            ],
        },
        "Overheating": {
            "regime": "Overheating",
            "regime_color": "#e67e22",
            "description": (
                "Strong growth but rising inflation pressures — central banks are tightening "
                "or signalling tightening. Late-cycle dynamics."
            ),
            "historical_frequency": 35.0,
            "avg_duration_months": 6.1,
            "sector_tilts": {
                "overweight": [
                    {"sector": "Energy",        "strength": 85},
                    {"sector": "Financials",    "strength": 75},
                    {"sector": "Commodities",   "strength": 65},
                ],
                "underweight": [
                    {"sector": "Long Duration", "strength": 40},
                    {"sector": "REITs",         "strength": 35},
                ],
            },
            "asset_performance": {
                "S&P 500":      {"avg_return": 12.0, "hit_rate": 68},
                "Bonds (AGG)":  {"avg_return": -2.0, "hit_rate": 35},
                "Gold":         {"avg_return":  1.0, "hit_rate": 52},
                "HY Credit":    {"avg_return":  5.0, "hit_rate": 61},
            },
            "typical_indicators": {
                "yield_curve":    "Flat",
                "credit_spreads": "Tight",
                "vix_regime":     "Low",
            },
            "key_risks": [
                "Overtightening by Fed → tips into Stagflation or Recession",
                "Valuations stretched at cycle top",
            ],
            "warning_signs": [
                "Yield curve inverting as Fed keeps hiking past neutral rate",
                "Leading indicators (PMI, LEI) rolling over while inflation persists",
                "Credit quality deterioration — rising leverage, falling interest coverage",
            ],
            "typical_catalysts": [
                "Fed policy error: tightening into a slowdown",
                "Energy/commodity price spike triggering stagflation dynamics",
                "External demand shock (China slowdown, global recession)",
            ],
            "opportunities": [
                "Commodity producers, energy infrastructure",
                "Short-duration fixed income, inflation-linked bonds",
            ],
        },
        "Stagflation": {
            "regime": "Stagflation",
            "regime_color": "#e74c3c",
            "description": (
                "The worst of both worlds: slowing growth with persistent inflation. "
                "Real incomes fall; central banks face an impossible trade-off."
            ),
            "historical_frequency": 20.0,
            "avg_duration_months": 5.8,
            "sector_tilts": {
                "overweight": [
                    {"sector": "Energy",        "strength": 80},
                    {"sector": "Healthcare",    "strength": 72},
                    {"sector": "Staples",       "strength": 68},
                ],
                "underweight": [
                    {"sector": "Technology",    "strength": 55},
                    {"sector": "Consumer Disc", "strength": 50},
                    {"sector": "Industrials",   "strength": 42},
                ],
            },
            "asset_performance": {
                "S&P 500":      {"avg_return": -8.0,  "hit_rate": 32},
                "Bonds (AGG)":  {"avg_return": -5.0,  "hit_rate": 28},
                "Gold":         {"avg_return": 12.0,  "hit_rate": 65},
                "HY Credit":    {"avg_return": -4.0,  "hit_rate": 35},
            },
            "typical_indicators": {
                "yield_curve":    "Inverted",
                "credit_spreads": "Wide",
                "vix_regime":     "Elevated",
            },
            "key_risks": [
                "Persistent inflation prevents policy easing",
                "No traditional safe haven — both stocks and bonds underperform",
            ],
            "warning_signs": [
                "Unemployment claims starting to rise while CPI remains elevated",
                "Consumer confidence deteriorating — real wage growth turning negative",
                "Corporate margin compression as input costs exceed pricing power",
            ],
            "typical_catalysts": [
                "Central bank forced to choose between inflation and recession (policy dilemma)",
                "Energy price shock (geopolitical disruption to supply)",
                "De-anchoring of inflation expectations forcing aggressive tightening",
            ],
            "opportunities": [
                "Commodities, real assets, inflation-linked bonds (TIPS)",
                "Cash and short-duration T-bills as vol hedge",
            ],
        },
        "Recession Risk": {
            "regime": "Recession Risk",
            "regime_color": "#8b949e",
            "description": (
                "Economic contraction with falling inflation — the deflationary bust. "
                "Credit stress rises, earnings fall, and policy turns aggressively accommodative."
            ),
            "historical_frequency": 15.0,
            "avg_duration_months": 4.2,
            "sector_tilts": {
                "overweight": [
                    {"sector": "Treasuries",    "strength": 90},
                    {"sector": "Utilities",     "strength": 75},
                    {"sector": "Cash & Gold",   "strength": 70},
                ],
                "underweight": [
                    {"sector": "Cyclicals",     "strength": 50},
                    {"sector": "HY Credit",     "strength": 45},
                    {"sector": "Small Caps",    "strength": 40},
                ],
            },
            "asset_performance": {
                "S&P 500":      {"avg_return": -15.0, "hit_rate": 25},
                "Bonds (AGG)":  {"avg_return":  8.0,  "hit_rate": 72},
                "Gold":         {"avg_return":  6.0,  "hit_rate": 60},
                "HY Credit":    {"avg_return": -12.0, "hit_rate": 22},
            },
            "typical_indicators": {
                "yield_curve":    "Inverted",
                "credit_spreads": "Wide",
                "vix_regime":     "Crisis",
            },
            "key_risks": [
                "Deep contraction — earnings collapse faster than expected",
                "Credit contagion from HY to IG markets",
            ],
            "warning_signs": [
                "Initial jobless claims spiking above 300k and trending higher",
                "ISM Manufacturing below 45 for 3+ consecutive months",
                "High-yield spreads above 700bps signalling systemic credit stress",
            ],
            "typical_catalysts": [
                "Fed rate cuts arriving too late to prevent credit/employment feedback loop",
                "Credit event or financial institution stress triggering risk-off cascade",
                "Earnings guidance cuts accelerating as consumer and corporate demand collapses",
            ],
            "opportunities": [
                "Long-duration Treasuries, quality sovereign bonds",
                "Entry point for risk assets if recovery signals emerge",
            ],
        },
    }

    # Normalise regime name
    norm = regime.strip().title()
    if "recession" in regime.lower():
        norm = "Recession Risk"
    return _PLAYBOOKS.get(norm, _PLAYBOOKS["Goldilocks"])


# ─────────────────────────────────────────────────────────────────────────────
# R1.3 — Regime Duration Tracker
# ─────────────────────────────────────────────────────────────────────────────

def get_regime_duration() -> dict:
    """
    Calculate how long we've been in the current regime and compare to historical average.
    """
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT date, label FROM regimes ORDER BY date DESC"
        ).fetchall()

        if not rows:
            return _empty_duration()

        current_label = rows[0]["label"]
        streak_months = 0
        for row in rows:
            if row["label"] == current_label:
                streak_months += 1
            else:
                break

        avg_durations = _compute_historical_avg_duration(conn)
        historical_avg = avg_durations.get(current_label, 6.0)

        months_in_regime = float(streak_months)
        days_in_regime   = int(streak_months * 30)
        progress_pct     = min(200.0, round(months_in_regime / historical_avg * 100, 1))

        # Duration percentile vs all streaks of this regime in history
        all_rows = conn.execute(
            "SELECT date, label FROM regimes ORDER BY date"
        ).fetchall()
        all_labels = [r["label"] for r in all_rows]
        all_streaks: list[int] = []
        if all_labels:
            lbl = all_labels[0]
            s   = 1
            for l in all_labels[1:]:
                if l == lbl:
                    s += 1
                else:
                    if lbl == current_label:
                        all_streaks.append(s)
                    lbl = l
                    s   = 1
            if lbl == current_label:
                all_streaks.append(s)

        if all_streaks:
            pct_duration = round(_pct_rank(pd.Series(all_streaks), streak_months))
        else:
            pct_duration = 50

        # Duration status thresholds
        if pct_duration < 50:
            status = "Early"
            status_color = "#2ecc71"
        elif pct_duration < 75:
            status = "Mid-Cycle"
            status_color = "#4a9eff"
        elif pct_duration < 90:
            status = "Extended"
            status_color = "#e67e22"
        else:
            status = "Long in Tooth"
            status_color = "#e74c3c"

        risk_indicators = _compute_risk_indicators(conn)

        return {
            "current_regime":      current_label,
            "days_in_regime":      days_in_regime,
            "months_in_regime":    round(months_in_regime, 1),
            "historical_avg_months": round(historical_avg, 1),
            "percentile_duration": pct_duration,
            "progress_pct":        progress_pct,
            "status":              status,
            "status_color":        status_color,
            "risk_indicators":     risk_indicators,
        }
    finally:
        conn.close()


def _empty_duration() -> dict:
    return {
        "current_regime": "Unknown",
        "days_in_regime": 0,
        "months_in_regime": 0.0,
        "historical_avg_months": 6.0,
        "percentile_duration": 50.0,
        "progress_pct": 0.0,
        "status": "Early",
        "status_color": "#2ecc71",
        "risk_indicators": {"momentum": 50, "valuation": 50, "sentiment": 50},
    }


# ─────────────────────────────────────────────────────────────────────────────
# R1.4 — Transition Probability Narrator
# ─────────────────────────────────────────────────────────────────────────────

def get_transition_narrative(current_regime: str) -> dict:
    """
    Convert Markov transition matrices into plain English + visual format.
    Computes actual transitions from DB; falls back to hardcoded priors.
    """
    conn = _get_conn()
    try:
        t3m = _compute_transitions_from_db(conn, 3) or _FALLBACK_TRANSITIONS_3M
        t6m = _compute_transitions_from_db(conn, 6) or _FALLBACK_TRANSITIONS_6M
    finally:
        conn.close()

    norm_regime = current_regime.strip()
    if "recession" in norm_regime.lower():
        norm_regime = "Recession Risk"

    row3 = t3m.get(norm_regime, _FALLBACK_TRANSITIONS_3M.get(norm_regime, {}))
    row6 = t6m.get(norm_regime, _FALLBACK_TRANSITIONS_6M.get(norm_regime, {}))

    stay_3m = row3.get(norm_regime, 50)

    def _build_transitions(row: dict) -> list[dict]:
        other = [
            {
                "to":          regime,
                "probability": row.get(regime, 0),
                "color":       REGIME_COLORS.get(regime, "#8b949e"),
            }
            for regime in REGIME_BASE_RATES
            if regime != norm_regime
        ]
        return sorted(other, key=lambda x: -x["probability"])

    transitions_3m = _build_transitions(row3)
    transitions_6m = _build_transitions(row6)

    # Highest risk transition (excluding "stay")
    highest_3m = max(transitions_3m, key=lambda x: x["probability"]) if transitions_3m else {}
    highest_risk = highest_3m.get("to", "Stagflation")
    highest_prob = highest_3m.get("probability", 20)
    highest_color = highest_3m.get("color", "#e74c3c")

    narrative_3m = (
        f"{stay_3m}% chance of remaining in {norm_regime} over the next 3 months, "
        f"with {highest_prob}% risk of transitioning to {highest_risk}."
    )
    stay_6m = row6.get(norm_regime, 40)
    narrative_6m = (
        f"Over 6 months, the {norm_regime} regime persistence falls to {stay_6m}%, "
        f"with elevated probability of regime shift as conditions evolve."
    )

    return {
        "current_regime":          norm_regime,
        "stay_probability_3m":     stay_3m,
        "transitions_3m":          transitions_3m,
        "transitions_6m":          transitions_6m,
        "narrative_3m":            narrative_3m,
        "narrative_6m":            narrative_6m,
        "highest_risk_transition": highest_risk,
        "highest_risk_prob":       highest_prob,
        "highest_risk_color":      highest_color,
    }


# ─────────────────────────────────────────────────────────────────────────────
# R1.5 — Historical Analogues Finder
# ─────────────────────────────────────────────────────────────────────────────

def find_historical_analogues(
    current_regime: str,
    hy_spread_pct: float,
    recession_prob: float,
    n_analogues: int = 4,
) -> list[dict]:
    """
    Find historical periods with conditions most similar to today.
    Similarity: regime match (40) + spread pct proximity (25) + recession prob proximity (20) + VIX proximity (15).
    """
    # Fetch current VIX level for VIX similarity scoring
    current_vix = 15.0
    try:
        conn = _get_conn()
        try:
            vix = _load_series("VIXCLS", conn)
            if not vix.empty:
                current_vix = float(vix.iloc[-1])
        finally:
            conn.close()
    except Exception:
        pass

    norm_regime = current_regime.strip()
    if "recession" in norm_regime.lower():
        norm_regime = "Recession Risk"

    def _similarity(p: dict) -> int:
        score = 0
        # Regime match
        if p["regime"] == norm_regime:
            score += 40
        # HY spread percentile within 10
        spread_diff = abs(p["hy_spread_pct"] - hy_spread_pct)
        if spread_diff <= 5:
            score += 25
        elif spread_diff <= 10:
            score += 18
        elif spread_diff <= 20:
            score += 10
        # Recession prob within 5%
        rec_diff = abs(p["recession_prob"] - recession_prob)
        if rec_diff <= 5:
            score += 20
        elif rec_diff <= 10:
            score += 14
        elif rec_diff <= 15:
            score += 7
        # VIX similarity
        vix_diff = abs(p["vix_level"] - current_vix)
        if vix_diff <= 3:
            score += 15
        elif vix_diff <= 6:
            score += 10
        elif vix_diff <= 10:
            score += 5
        return score

    scored = [
        {**p, "similarity_score": _similarity(p)}
        for p in _HISTORICAL_PERIODS
    ]
    scored.sort(key=lambda x: -x["similarity_score"])

    results = []
    for item in scored[:n_analogues]:
        score = item["similarity_score"]
        if score >= 85:
            sim_color = "#2ecc71"
        elif score >= 70:
            sim_color = "#4a9eff"
        elif score >= 50:
            sim_color = "#e67e22"
        else:
            sim_color = "#8b949e"
        results.append({
            "period":             item["period"],
            "period_end":         item["period_end"],
            "regime":             item["regime"],
            "similarity_score":   score,
            "similarity_color":   sim_color,
            "hy_spread_pct":      item["hy_spread_pct"],
            "recession_prob":     item["recession_prob"],
            "what_happened":      item["what_happened"],
            "time_to_change":     item["time_to_change"],
            "next_regime":        item["next_regime"],
            "key_drivers":        item.get("key_drivers", []),
            "market_impact":      item.get("market_impact", {}),
            "lessons_for_today":  item.get("lessons_for_today", ""),
            "resolution":         item.get("resolution", ""),
        })
    return results


# ─────────────────────────────────────────────────────────────────────────────
# R1.6 — Scenario Analysis Engine
# ─────────────────────────────────────────────────────────────────────────────

def run_scenario(
    scenario_key: str | None = None,
    custom_shocks: dict | None = None,
    current_values: dict | None = None,
) -> dict:
    """
    Apply scenario shocks and compute resulting regime probability shifts.

    Either scenario_key (from SCENARIOS) or custom_shocks dict must be provided.
    """
    if scenario_key and scenario_key in SCENARIOS:
        scenario = SCENARIOS[scenario_key]
        shocks = scenario["input_shocks"].copy()
        name             = scenario["name"]
        emoji            = scenario["emoji"]
        description      = scenario["description"]
        severity         = scenario["severity"]
        color            = scenario["color"]
        hist_ref         = scenario["historical_reference"]
        what_happened    = scenario["what_happened_then"]
    elif custom_shocks:
        shocks = custom_shocks
        name          = "Custom Scenario"
        emoji         = "⚙️"
        description   = "User-defined shock scenario"
        severity      = "custom"
        color         = "#4a9eff"
        hist_ref      = "N/A"
        what_happened = "Custom parameters — no historical reference"
    else:
        raise ValueError("Either scenario_key or custom_shocks must be provided")

    # Get current regime state
    state = _get_current_regime_state()
    current_probs = state["approx_probs"]  # {"Goldilocks": 30, ...}

    stressed_probs = _estimate_stressed_probs(current_probs, shocks)
    prob_changes = {
        regime: stressed_probs[regime] - current_probs.get(regime, 25)
        for regime in stressed_probs
    }

    most_likely = max(stressed_probs, key=lambda k: stressed_probs[k])
    most_likely_prob = stressed_probs[most_likely]

    # Positioning implications based on most likely stressed regime
    _implications: dict[str, list[str]] = {
        "Goldilocks": [
            "Maintain or add equity exposure — conditions remain supportive",
            "Credit spreads should compress; HY attractive for carry",
            "Favour growth and momentum factors over value",
            "Reduce defensive hedges; tactically deploy cash into equities",
            "Consider small-cap and emerging market exposure for beta",
        ],
        "Overheating": [
            "Tilt to value and cyclicals; reduce long-duration growth exposure",
            "Add commodity exposure (energy, materials) as inflation hedge",
            "Consider short bonds or TIPS allocation; avoid AGG",
            "Financials can outperform in a rising-rate environment",
            "Trim speculative positions and high-multiple tech stocks",
        ],
        "Stagflation": [
            "Reduce equity exposure to 40–50% of normal allocation",
            "Increase commodities, TIPS, and real assets allocation",
            "Raise cash to 15–20% — both stocks and bonds face headwinds",
            "Favour defensive sectors: Utilities, Staples, Healthcare",
            "Consider tail-risk hedges (put spreads, long VIX positions)",
        ],
        "Recession Risk": [
            "Reduce equity exposure significantly; favour defensive sectors",
            "Add Treasury duration as primary flight-to-quality hedge",
            "Increase cash and high-quality short-duration credit",
            "Avoid HY credit — default risk elevated and spreads will widen",
            "Watch for entry signals: Fed pivot, credit spread peaks, ISM bottoming",
        ],
    }
    implications = _implications.get(most_likely, ["Review and reduce risk exposure"])

    # Pull sector_implications and other enriched fields from scenario template if available
    scenario_template = SCENARIOS.get(scenario_key, {}) if scenario_key else {}
    sector_implications = scenario_template.get("sector_implications", {
        "overweight": [],
        "underweight": [],
    })
    duration_estimate = scenario_template.get("duration_estimate", "Duration varies by policy response and macro conditions.")
    indicators_to_watch = scenario_template.get("indicators_to_watch", [])

    # Convert probs to lowercase-underscore keys for JSON compatibility
    def _lk(k: str) -> str:
        return k.lower().replace(" ", "_")

    return {
        "scenario_name":            name,
        "emoji":                    emoji,
        "description":              description,
        "severity":                 severity,
        "color":                    color,
        "historical_reference":     hist_ref,
        "what_happened_then":       what_happened,
        "input_shocks":             shocks,
        "current_regime_probs":     {_lk(k): v for k, v in current_probs.items()},
        "stressed_regime_probs":    {_lk(k): v for k, v in stressed_probs.items()},
        "prob_changes":             {_lk(k): v for k, v in prob_changes.items()},
        "most_likely_regime":       most_likely,
        "most_likely_prob":         most_likely_prob,
        "positioning_implications": implications,
        "sector_implications":      sector_implications,
        "duration_estimate":        duration_estimate,
        "indicators_to_watch":      indicators_to_watch,
    }
