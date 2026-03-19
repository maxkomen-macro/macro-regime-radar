"""
src/analytics/playbook.py — Generate the Trader Pack regime playbook.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Run:
    python -m src.analytics.playbook

Reads:  regimes (current regime), signals (triggered), derived_metrics (z-scores + priced)
Writes: derived_metrics (numeric proxy rows)
        output/playbook.json (full text playbook)

The playbook contains:
    1. Current regime baseline positioning text
    2. "Because today..." qualifier sentences from:
       - Triggered macro signals
       - Extreme z-scores (|z| >= 2.5: "extreme"; |z| >= 1.5: "notable")
       - Priced metrics (breakeven inflation, real yields) thresholds
    3. Per-regime static baselines for all 4 regimes

derived_metrics rows written:
    playbook_summary         value = regime confidence (numeric proxy)
    playbook_regime_encoded  value = regime label hash (numeric proxy)
    playbook_{safe_label}    value = baseline text length (numeric proxy, all 4 regimes)

The actual text lives in output/playbook.json.
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT         = Path(__file__).resolve().parent.parent.parent
DB_PATH      = ROOT / "data" / "macro_radar.db"
OUTPUT_DIR   = ROOT / "output"
PLAYBOOK_PATH = OUTPUT_DIR / "playbook.json"

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ── Regime baselines (static) ─────────────────────────────────────────────────

REGIME_BASELINES = {
    "Goldilocks": (
        "Risk-on. Overweight equities, underweight bonds. "
        "Carry strategies work well. Prefer cyclicals over defensives. "
        "Credit spreads typically tightening — HYG/LQD favorable."
    ),
    "Overheating": (
        "Inflation risk elevated. Prefer real assets (GLD, commodities) and TIPS. "
        "Shorten duration — TLT headwinds. USD may strengthen. "
        "Value over growth; energy/materials over tech."
    ),
    "Stagflation": (
        "Most difficult regime for traditional portfolios. "
        "Underweight both equities and nominal bonds. "
        "Gold and real assets as primary hedge. "
        "High-quality defensive equities with pricing power may hold up."
    ),
    "Recession Risk": (
        "Flight to safety. Overweight long-duration Treasuries (TLT). "
        "Underweight equities and credit (HYG). "
        "USD typically strengthens. Reduce risk broadly."
    ),
}

# ── Z-score prose thresholds ──────────────────────────────────────────────────

Z_EXTREME = 2.5
Z_NOTABLE = 1.5

Z_METRIC_LABELS = [
    ("SPY_weekly_ret_z",    "SPY",          "equity momentum"),
    ("VIX_weekly_chg_z",    "VIX",          "volatility"),
    ("DGS10_weekly_chg_z",  "10Y Treasury", "rate momentum"),
    ("SPREAD_weekly_chg_z", "yield spread", "curve steepening"),
    ("CPI_yoy_z",           "CPI",          "inflation"),
    ("UNRATE_weekly_chg_z", "unemployment", "labor conditions"),
    ("UUP_weekly_ret_z",    "USD",          "dollar strength"),
    ("TLT_weekly_ret_z",    "TLT",          "long-bond demand"),
    ("HYG_weekly_ret_z",    "HYG",          "credit conditions"),
]


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_current_regime(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute(
        "SELECT date, label, confidence, growth_trend, inflation_trend "
        "FROM regimes ORDER BY date DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def load_latest_signals(conn: sqlite3.Connection) -> list:
    latest = conn.execute("SELECT MAX(date) FROM signals").fetchone()[0]
    if not latest:
        return []
    rows = conn.execute(
        "SELECT signal_name, value, triggered FROM signals WHERE date=? AND triggered=1",
        (latest,),
    ).fetchall()
    return [dict(r) for r in rows]


def load_latest_derived(conn: sqlite3.Connection) -> dict:
    """
    Load most recent value per derived_metric name.
    Returns dict: metric_name → {"value": float, "date": str}.
    """
    rows = conn.execute(
        """
        SELECT name, value, date
        FROM derived_metrics d1
        WHERE date = (
            SELECT MAX(date) FROM derived_metrics d2 WHERE d2.name = d1.name
        )
        ORDER BY name
        """
    ).fetchall()
    return {r["name"]: {"value": float(r["value"]), "date": r["date"]} for r in rows}


# ── Sentence generators ───────────────────────────────────────────────────────

def _signal_sentences(triggered_signals: list) -> list:
    sentences = []
    for sig in triggered_signals:
        name = sig["signal_name"].replace("_", " ").title()
        val  = sig["value"]
        sentences.append(
            f"Because today {name} is active (value={val:.2f}), "
            "heightened risk management is warranted."
        )
    return sentences


def _zscore_sentences(derived: dict) -> list:
    sentences = []
    for metric_name, label, theme in Z_METRIC_LABELS:
        if metric_name not in derived:
            continue
        z = derived[metric_name]["value"]
        if abs(z) >= Z_EXTREME:
            adj = "elevated" if z > 0 else "depressed"
            sentences.append(
                f"Because today {label} {theme} is extreme (z={z:+.2f}), "
                f"the {label} signal is significantly {adj} versus 2-year norms."
            )
        elif abs(z) >= Z_NOTABLE:
            direction = "above" if z > 0 else "below"
            sentences.append(
                f"Because today {label} {theme} is {direction} trend (z={z:+.2f})."
            )
    return sentences


def _priced_sentences(derived: dict) -> list:
    sentences = []

    # 10Y Breakeven inflation
    be10 = derived.get("T10YIE_latest", {}).get("value")
    if be10 is not None:
        if be10 > 2.5:
            sentences.append(
                f"Because today 10Y breakeven inflation is elevated at {be10:.2f}%, "
                "markets price in above-target inflation."
            )
        elif be10 < 1.5:
            sentences.append(
                f"Because today 10Y breakeven inflation is low at {be10:.2f}%, "
                "markets price in benign inflation ahead."
            )

    # 10Y Real yield
    ry10 = derived.get("DFII10_latest", {}).get("value")
    if ry10 is not None:
        if ry10 > 1.5:
            sentences.append(
                f"Because today 10Y real yield is positive at {ry10:.2f}%, "
                "real rates are restrictive — a headwind for equities and gold."
            )
        elif ry10 < 0:
            sentences.append(
                f"Because today 10Y real yield is negative at {ry10:.2f}%, "
                "real rates remain accommodative."
            )

    # Fed Funds proxy
    fedfunds = derived.get("FEDFUNDS_latest", {}).get("value")
    if fedfunds is not None:
        sentences.append(
            f"Policy rate (FEDFUNDS) is at {fedfunds:.2f}%."
        )

    return sentences


def build_because_sentences(triggered_signals: list, derived: dict) -> list:
    """Assemble all 'Because today...' sentences, capped at 8 total."""
    all_sentences = (
        _signal_sentences(triggered_signals)
        + _zscore_sentences(derived)
        + _priced_sentences(derived)
    )
    return all_sentences[:8]


# ── Playbook assembler ────────────────────────────────────────────────────────

def build_playbook_dict(regime: dict, because_sentences: list) -> dict:
    label    = regime["label"]
    baseline = REGIME_BASELINES.get(label, f"Current regime: {label}.")
    conf     = float(regime["confidence"])
    conf_pct = f"{conf * 100:.0f}%"

    summary = f"Regime: {label} (confidence {conf_pct}). {baseline}"
    if because_sentences:
        summary += " " + " ".join(because_sentences[:3])

    return {
        "generated_at":  datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "as_of":         regime["date"],
        "regime":        label,
        "confidence":    conf,
        "baseline":      baseline,
        "because_today": because_sentences,
        "summary":       summary,
        "all_baselines": REGIME_BASELINES,
    }


# ── Writers ───────────────────────────────────────────────────────────────────

def write_playbook_json(playbook: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(PLAYBOOK_PATH, "w", encoding="utf-8") as f:
        json.dump(playbook, f, indent=2, ensure_ascii=False)
    logger.info("[playbook] JSON written → %s", PLAYBOOK_PATH)


def upsert_playbook_metrics(conn: sqlite3.Connection, playbook: dict, today: str) -> int:
    """
    Store numeric proxy rows in derived_metrics.
    The actual text is in output/playbook.json.
    """
    computed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conf = float(playbook["confidence"])

    rows = [
        ("playbook_summary",        today, conf,                           computed_at),
        ("playbook_regime_encoded", today, float(hash(playbook["regime"]) % 10000), computed_at),
    ]
    for regime_label, baseline_text in REGIME_BASELINES.items():
        safe_name = f"playbook_{regime_label.lower().replace(' ', '_').replace('-', '_')}"
        rows.append((safe_name, today, float(len(baseline_text)), computed_at))

    conn.executemany(
        """
        INSERT INTO derived_metrics (name, date, value, computed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name, date) DO UPDATE SET
            value=excluded.value,
            computed_at=excluded.computed_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run() -> None:
    conn  = _get_conn()
    today = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d")

    try:
        regime = load_current_regime(conn)
        if not regime:
            logger.error(
                "[playbook] No regime data found. Run: python main.py first."
            )
            return

        triggered_signals = load_latest_signals(conn)
        derived           = load_latest_derived(conn)

        because_sentences = build_because_sentences(triggered_signals, derived)
        playbook          = build_playbook_dict(regime, because_sentences)

        write_playbook_json(playbook)

        n = upsert_playbook_metrics(conn, playbook, today)
        logger.info("[playbook] %d derived_metrics rows written.", n)

        print("\n--- Playbook Summary ---")
        print(f"  Regime:     {playbook['regime']} ({playbook['confidence']:.1%} confidence)")
        print(f"  As of:      {playbook['as_of']}")
        print(f"  Baseline:   {playbook['baseline']}")
        if because_sentences:
            print(f"  Because today ({len(because_sentences)} sentences):")
            for s in because_sentences[:5]:
                print(f"    - {s}")
        print(f"  JSON → {PLAYBOOK_PATH}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
