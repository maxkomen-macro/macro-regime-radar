"""
src/memo.py — Weekly Memo Generator  (Phase 3, Part B + Trader Pack)

Run:
    python src/memo.py

Output:
    output/weekly_memo.html

Standalone — does NOT import src.config so no FRED_API_KEY is required.
"""

import base64
import io
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend — must be set before pyplot import
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd
from jinja2 import Environment, FileSystemLoader, TemplateNotFound

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

ROOT          = Path(__file__).resolve().parent.parent
DB_PATH       = ROOT / "data" / "macro_radar.db"
TMPL_DIR      = ROOT / "templates"
OUTPUT_DIR    = ROOT / "output"
MEMO_PATH     = OUTPUT_DIR / "weekly_memo.html"
PLAYBOOK_PATH = OUTPUT_DIR / "playbook.json"

# ─────────────────────────────────────────────────────────────────────────────
# Config — mirrors dashboard constants (no src.config import)
# ─────────────────────────────────────────────────────────────────────────────

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}

SIGNAL_META = {
    "yield_curve_inversion": {
        "label":     "Yield Curve Inversion",
        "threshold": 0.0,
        "direction": "below",
        "unit":      "%",
    },
    "unemployment_spike": {
        "label":     "Unemployment Spike",
        "threshold": 0.3,
        "direction": "above",
        "unit":      "pp",
    },
    "cpi_hot": {
        "label":     "CPI Hot",
        "threshold": 4.0,
        "direction": "above",
        "unit":      "% YoY",
    },
    "cpi_cold": {
        "label":     "CPI Cold",
        "threshold": 1.0,
        "direction": "below",
        "unit":      "% YoY",
    },
    "vix_spike": {
        "label":     "VIX Spike",
        "threshold": 30.0,
        "direction": "above",
        "unit":      "",
    },
}

CHART_MONTHS  = 24   # look-back window for charts
ZSCORE_WINDOW = 36   # rolling window for z-score ranking


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_df(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = connect()
    try:
        return pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()


def load_regimes() -> pd.DataFrame:
    df = load_df("SELECT * FROM regimes ORDER BY date")
    if not df.empty:
        df = df.assign(date=pd.to_datetime(df["date"]))
    return df


def load_signals() -> pd.DataFrame:
    df = load_df("SELECT * FROM signals ORDER BY date, signal_name")
    if not df.empty:
        df = df.assign(date=pd.to_datetime(df["date"]))
    return df


def load_raw_wide() -> pd.DataFrame:
    """Load raw_series and pivot to wide format (date × series_id)."""
    df = load_df("SELECT series_id, date, value FROM raw_series ORDER BY date")
    if df.empty:
        return df
    df = df.assign(date=pd.to_datetime(df["date"]))
    wide = df.pivot_table(index="date", columns="series_id", values="value", aggfunc="last")
    wide.columns.name = None
    return wide.sort_index()


# ─────────────────────────────────────────────────────────────────────────────
# Derived metrics (mirrors dashboard logic)
# ─────────────────────────────────────────────────────────────────────────────

def compute_derived(wide: pd.DataFrame) -> pd.DataFrame:
    d = wide.copy()
    extras = {}
    if "CPIAUCSL" in d.columns:
        extras["CPI_YOY"]    = (d["CPIAUCSL"] / d["CPIAUCSL"].shift(12) - 1) * 100
    if "UNRATE" in d.columns:
        extras["UNRATE_3M"]  = d["UNRATE"] - d["UNRATE"].shift(3)
    if "GS10" in d.columns and "GS2" in d.columns:
        extras["SPREAD"]     = d["GS10"] - d["GS2"]
    if "INDPRO" in d.columns:
        extras["INDPRO_YOY"] = (d["INDPRO"] / d["INDPRO"].shift(12) - 1) * 100
    return d.assign(**extras) if extras else d


# ─────────────────────────────────────────────────────────────────────────────
# "What Changed This Week" — z-score ranked bullets
# ─────────────────────────────────────────────────────────────────────────────

def build_changes(derived: pd.DataFrame) -> list:
    """
    Compute month-over-month change for each key metric, rank by |z-score|,
    and return up to 8 bullet strings + metadata.

    Z-score = Δ / rolling_std(Δ, ZSCORE_WINDOW months).
    """
    items = []

    def _add(col, label, unit, fmt, note_fn=None):
        if col not in derived.columns:
            return
        s = derived[col].dropna()
        if len(s) < 2:
            return
        cur  = float(s.iloc[-1])
        prev = float(s.iloc[-2])
        chg  = cur - prev

        # z-score of this change relative to rolling distribution of changes
        changes  = s.diff().dropna()
        roll_std = changes.rolling(ZSCORE_WINDOW, min_periods=5).std()
        _rs = float(roll_std.iloc[-1])
        _fb = float(changes.std())
        std_val  = _rs if not np.isnan(_rs) else (_fb if not np.isnan(_fb) else 0.0)
        zscore   = (chg / std_val) if std_val != 0 else 0.0

        if chg > 0:
            direction = "rose"
        elif chg < 0:
            direction = "fell"
        else:
            direction = "was unchanged at"
        sign = "+" if chg > 0 else ""
        note   = note_fn(cur, chg) if note_fn else "."
        if chg == 0:
            bullet = f"{label} {direction} {cur:{fmt}}{unit}{note}"
        else:
            bullet = f"{label} {direction} {sign}{chg:{fmt}} to {cur:{fmt}}{unit}{note}"

        items.append({
            "label":   label,
            "current": cur,
            "change":  chg,
            "zscore":  zscore,
            "bullet":  bullet,
        })

    # ── Note functions (return trailing text for the bullet) ───────────────

    def cpi_note(cur, chg):
        if cur > 4:
            return f" — above the 4% alert threshold."
        if cur < 1:
            return f" — below the 1% deflation-risk threshold."
        if abs(chg) >= 0.3:
            return " — notable monthly move."
        return "."

    def spread_note(cur, chg):
        if cur < 0:
            return f" — yield curve remains inverted."
        if chg < -0.1:
            return " — flattening trend."
        if chg > 0.1:
            return " — steepening."
        return "."

    def vix_note(cur, chg):
        if cur > 30:
            return f" — above the 30 risk threshold."
        if cur > 20:
            return " — elevated market uncertainty."
        return "."

    def unrate_note(cur, chg):
        if "UNRATE_3M" in derived.columns:
            s3 = derived["UNRATE_3M"].dropna()
            if not s3.empty:
                v3 = float(s3.iloc[-1])
                if v3 >= 0.3:
                    return f" — 3M change +{v3:.2f}pp, spike threshold breached."
        return "."

    def indpro_note(cur, chg):
        if cur < -3:
            return " — contraction territory."
        if cur > 3:
            return " — solid expansion momentum."
        return "."

    # ── Register metrics ───────────────────────────────────────────────────
    _add("CPI_YOY",    "CPI YoY",          "% YoY",  ".2f", cpi_note)
    _add("SPREAD",     "10Y–2Y Spread",    "%",      ".2f", spread_note)
    _add("VIXCLS",     "VIX",              "",       ".1f", vix_note)
    _add("UNRATE",     "Unemployment Rate","%",      ".1f", unrate_note)
    _add("INDPRO_YOY", "INDPRO YoY",       "%",      ".2f", indpro_note)

    # Sort by absolute z-score descending, keep top 8
    items.sort(key=lambda x: abs(x["zscore"]), reverse=True)
    return items[:8]


# ─────────────────────────────────────────────────────────────────────────────
# Signal analysis
# ─────────────────────────────────────────────────────────────────────────────

def compute_severity(signal_name: str, value: float) -> str:
    """Human-readable severity using spec-defined formulas."""
    if signal_name == "yield_curve_inversion":
        raw = abs(min(value, 0.0))
        if raw == 0:
            return "—"
        level = "mild" if raw < 0.5 else ("moderate" if raw < 1.5 else "severe")
        return f"{raw:.2f}% ({level})"
    elif signal_name == "vix_spike":
        raw = max(value - 30.0, 0.0)
        if raw == 0:
            return "—"
        level = "mild" if raw < 5 else ("moderate" if raw < 15 else "severe")
        return f"+{raw:.1f} ({level})"
    elif signal_name == "cpi_hot":
        raw = max(value - 4.0, 0.0)
        if raw == 0:
            return "—"
        level = "mild" if raw < 1 else ("moderate" if raw < 3 else "severe")
        return f"+{raw:.2f}pp ({level})"
    elif signal_name == "cpi_cold":
        raw = max(1.0 - value, 0.0)
        if raw == 0:
            return "—"
        level = "mild" if raw < 0.5 else ("moderate" if raw < 1 else "severe")
        return f"+{raw:.2f}pp ({level})"
    elif signal_name == "unemployment_spike":
        raw = max(value - 0.3, 0.0)
        if raw == 0:
            return "—"
        level = "mild" if raw < 0.2 else ("moderate" if raw < 0.5 else "severe")
        return f"+{raw:.2f}pp ({level})"
    return "—"


def signal_duration(sdf: pd.DataFrame) -> int:
    """Count consecutive triggered=1 rows at the tail of a per-signal DataFrame."""
    if sdf.empty:
        return 0
    s = sdf.sort_values("date", ascending=False).reset_index(drop=True)
    count = 0
    for _, row in s.iterrows():
        if int(row["triggered"]) == 1:
            count += 1
        else:
            break
    return count


def build_signal_rows(signals: pd.DataFrame) -> list:
    """Build one summary dict per signal for the HTML table."""
    rows = []
    for name, meta in SIGNAL_META.items():
        sdf = signals[signals["signal_name"] == name].sort_values("date")
        if sdf.empty:
            rows.append({
                "name":      name,
                "label":     meta["label"],
                "triggered": False,
                "value_str": "N/A",
                "severity":  "—",
                "duration":  0,
                "last_trig": "—",
            })
            continue

        latest    = sdf.iloc[-1]
        trig      = bool(int(latest["triggered"]))
        val       = float(latest["value"])
        sev       = compute_severity(name, val) if trig else "—"
        dur       = signal_duration(sdf)
        trig_rows = sdf[sdf["triggered"] == 1]
        last_t    = trig_rows["date"].max() if not trig_rows.empty else None
        last_t_str = last_t.strftime("%b %Y") if last_t is not None and pd.notna(last_t) else "—"

        rows.append({
            "name":      name,
            "label":     meta["label"],
            "triggered": trig,
            "value_str": f"{val:.2f}{meta['unit']}",
            "severity":  sev,
            "duration":  dur,
            "last_trig": last_t_str,
        })
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# "What It Implies" narrative  (fund-note style, 2–4 sentences)
# ─────────────────────────────────────────────────────────────────────────────

def build_implication(label: str, confidence: float, signal_rows: list) -> str:
    conf_str = (
        "high confidence" if confidence >= 0.4
        else "moderate confidence" if confidence >= 0.2
        else "low confidence"
    )
    intros = {
        "Goldilocks": (
            f"The macro environment is consistent with a Goldilocks regime ({conf_str}): "
            "growth is expanding while inflation remains contained — historically one of "
            "the most constructive backdrops for risk assets, particularly equities and "
            "tighter credit spreads."
        ),
        "Overheating": (
            f"The data signals an Overheating regime ({conf_str}): above-trend growth "
            "is coinciding with elevated inflation, a configuration that has historically "
            "pressured rate-sensitive assets and prompted further central bank tightening."
        ),
        "Stagflation": (
            f"The model flags a Stagflation regime ({conf_str}): decelerating growth "
            "alongside sticky inflation — one of the most challenging environments for "
            "diversified portfolios. Real assets and inflation-linked instruments have "
            "tended to outperform in similar historical episodes."
        ),
        "Recession Risk": (
            f"Conditions point to a Recession Risk regime ({conf_str}): growth indicators "
            "are deteriorating alongside disinflationary dynamics. This backdrop has "
            "historically favoured duration, high-quality fixed income, and defensive "
            "equity positioning."
        ),
    }
    text = intros.get(label, f"Current regime: {label} ({conf_str}).")

    triggered_labels = [r["label"] for r in signal_rows if r["triggered"]]
    if triggered_labels:
        top    = triggered_labels[:3]
        joined = ", ".join(top)
        text  += (
            f" Active risk signals — {joined} — reinforce a cautious near-term posture "
            "and warrant continued monitoring for persistence."
        )
    else:
        text += (
            " No major risk signals are currently triggered; the regime assessment "
            "rests primarily on trend inputs."
        )
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Charts — matplotlib → base64 PNG (embedded in HTML)
# ─────────────────────────────────────────────────────────────────────────────

_CHART_RC = {
    "figure.facecolor":  "#ffffff",
    "axes.facecolor":    "#fafafa",
    "axes.spines.top":   False,
    "axes.spines.right": False,
    "axes.grid":         True,
    "grid.alpha":        0.35,
    "grid.linestyle":    "--",
    "font.family":       "sans-serif",
    "font.size":         9,
}


def _fig_to_b64(fig: plt.Figure) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def _line_chart(
    series: pd.Series,
    title: str,
    ylabel: str,
    threshold: float = None,
    threshold_label: str = None,
    fill_zero: bool = False,
) -> str:
    """Render one line chart; return base64 PNG string."""
    s = series.dropna()
    if s.empty:
        return None

    with plt.rc_context(_CHART_RC):
        fig, ax = plt.subplots(figsize=(7.2, 2.9))

        ax.plot(s.index, s.values, color="#2c7be5", linewidth=1.7, zorder=3)

        if fill_zero:
            ax.fill_between(
                s.index, s.values, 0,
                where=(np.array(s.values) < 0),
                alpha=0.20, color="#e74c3c", interpolate=True,
            )
            ax.fill_between(
                s.index, s.values, 0,
                where=(np.array(s.values) >= 0),
                alpha=0.10, color="#2ecc71", interpolate=True,
            )

        if threshold is not None:
            ax.axhline(
                threshold, color="#e74c3c", linewidth=1.1, linestyle="--",
                label=threshold_label or f"Threshold ({threshold})", zorder=2,
            )
            ax.legend(fontsize=8, framealpha=0.7, loc="upper left")

        ax.set_title(title, fontsize=10, fontweight="bold", pad=6, loc="left")
        ax.set_ylabel(ylabel, fontsize=8)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=4))
        ax.tick_params(axis="x", labelrotation=30, labelsize=7)
        ax.tick_params(axis="y", labelsize=8)

        fig.tight_layout(pad=0.8)
        return _fig_to_b64(fig)


def build_charts(derived: pd.DataFrame, as_of: pd.Timestamp) -> list:
    """Build up to 4 charts. Skips gracefully if data is missing."""
    cutoff = as_of - pd.DateOffset(months=CHART_MONTHS)
    charts = []

    def _slice(col):
        if col not in derived.columns:
            return pd.Series(dtype=float)
        return derived.loc[derived.index >= cutoff, col].dropna()

    # 1) CPI YoY
    s = _slice("CPI_YOY")
    if not s.empty:
        b64 = _line_chart(
            s, "CPI Year-over-Year Inflation", "% YoY",
            threshold=4.0, threshold_label="Alert: 4% (CPI Hot)",
        )
        if b64:
            charts.append({
                "title":   "CPI YoY Inflation",
                "caption": (
                    f"Consumer Price Index, year-over-year change — "
                    f"last {CHART_MONTHS} months through {as_of.strftime('%b %Y')}."
                ),
                "source": "Source: FRED (CPIAUCSL)",
                "b64":    b64,
            })
    else:
        print("[memo] WARNING: CPI_YOY not available — skipping chart.")

    # 2) Unemployment Rate
    s = _slice("UNRATE")
    if not s.empty:
        b64 = _line_chart(s, "Unemployment Rate (UNRATE)", "Rate (%)")
        if b64:
            charts.append({
                "title":   "Unemployment Rate",
                "caption": (
                    f"U.S. civilian unemployment rate — "
                    f"last {CHART_MONTHS} months through {as_of.strftime('%b %Y')}."
                ),
                "source": "Source: FRED (UNRATE)",
                "b64":    b64,
            })
    else:
        print("[memo] WARNING: UNRATE not available — skipping chart.")

    # 3) 10Y–2Y Yield Spread
    s = _slice("SPREAD")
    if not s.empty:
        b64 = _line_chart(
            s, "10Y – 2Y Yield Spread", "Spread (%)",
            threshold=0.0, threshold_label="Inversion threshold (0%)",
            fill_zero=True,
        )
        if b64:
            charts.append({
                "title":   "10Y – 2Y Yield Spread",
                "caption": (
                    f"Difference between 10-year and 2-year Treasury yields — "
                    f"last {CHART_MONTHS} months through {as_of.strftime('%b %Y')}."
                ),
                "source": "Source: FRED (GS10, GS2)",
                "b64":    b64,
            })
    else:
        print("[memo] WARNING: SPREAD (GS10/GS2) not available — skipping chart.")

    # 4) VIX (optional)
    s = _slice("VIXCLS")
    if not s.empty:
        b64 = _line_chart(
            s, "VIX Volatility Index", "VIX Level",
            threshold=30.0, threshold_label="Spike threshold (30)",
        )
        if b64:
            charts.append({
                "title":   "VIX Volatility Index",
                "caption": (
                    f"CBOE Volatility Index, monthly — "
                    f"last {CHART_MONTHS} months through {as_of.strftime('%b %Y')}."
                ),
                "source": "Source: FRED (VIXCLS)",
                "b64":    b64,
            })
    else:
        print("[memo] WARNING: VIXCLS not available — skipping chart.")

    return charts


# ─────────────────────────────────────────────────────────────────────────────
# Validation diagnostics
# ─────────────────────────────────────────────────────────────────────────────

def print_validation(
    regimes: pd.DataFrame,
    signals: pd.DataFrame,
    output_path: Path,
) -> None:
    print("\n" + "─" * 60)
    print("VALIDATION REPORT")
    print("─" * 60)

    if regimes.empty:
        print("[regimes] EMPTY — no regimes computed yet.")
    else:
        print(f"[regimes] Latest row:")
        for k, v in regimes.iloc[-1].to_dict().items():
            print(f"           {k}: {v}")
        twelve_ago = regimes["date"].max() - pd.DateOffset(months=12)
        count_12m  = int((regimes["date"] >= twelve_ago).sum())
        print(f"[regimes] Rows in last 12 months: {count_12m}")

    print()
    if signals.empty:
        print("[signals] EMPTY — no signals computed yet.")
    else:
        latest_date = signals["date"].max()
        latest_sigs = (
            signals[signals["date"] == latest_date]
            .sort_values("signal_name")
        )
        print(f"[signals] Latest signal rows (as of {latest_date.date()}):")
        print(
            latest_sigs[["signal_name", "value", "triggered"]]
            .to_string(index=False)
        )

    print()
    if output_path.exists():
        size_kb = output_path.stat().st_size // 1024
        print(f"[output]  {output_path}")
        print(f"           File size: {size_kb} KB — OK")
        content = output_path.read_text(encoding="utf-8").lower().replace(" ", "")
        checks = {
            "Header / title":      "weeklymemoreg" in content or "weeklyregimememo" in content or "macroregimeradar" in content,
            "Regime summary":      "regimesummary" in content or "currentregime"  in content,
            "What Changed":        "whatchanged"   in content or "changedthisweek" in content,
            "Signals table":       "signaltable"   in content or "signalsoverview" in content or "signals" in content,
            "Charts":              "data:image/png" in content,
            "What It Implies":     "whatitimplies" in content or "implications"   in content,
            "Methodology footer":  "methodology"   in content,
        }
        for label, ok in checks.items():
            mark = "✓" if ok else "✗"
            print(f"  {mark}  {label}")
    else:
        print(f"[output]  NOT FOUND: {output_path}")

    print("─" * 60)


# ─────────────────────────────────────────────────────────────────────────────
# Trader Pack data loaders (standalone, no src.config import)
# ─────────────────────────────────────────────────────────────────────────────

def _table_exists(table: str) -> bool:
    try:
        conn = connect()
        cur  = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (table,)
        )
        exists = cur.fetchone()[0] > 0
        conn.close()
        return exists
    except Exception:
        return False


def load_market_daily_memo() -> pd.DataFrame:
    """Load market_daily for memo (no Streamlit cache)."""
    if not _table_exists("market_daily"):
        return pd.DataFrame()
    try:
        df = load_df(
            "SELECT symbol, date, open, high, low, close, volume "
            "FROM market_daily ORDER BY symbol, date"
        )
        if df.empty:
            return df
        df = df.assign(date=pd.to_datetime(df["date"]))
        parts = []
        for sym, grp in df.groupby("symbol"):
            g = grp.sort_values("date").copy()
            g = g.assign(ret_1w=g["close"].pct_change(5) * 100)
            parts.append(g)
        return pd.concat(parts).reset_index(drop=True) if parts else pd.DataFrame()
    except Exception as exc:
        print(f"[memo] WARNING: market_daily load failed: {exc}")
        return pd.DataFrame()


def load_derived_metrics_memo() -> pd.DataFrame:
    """Load derived_metrics pivoted to wide format."""
    if not _table_exists("derived_metrics"):
        return pd.DataFrame()
    try:
        df = load_df("SELECT name, date, value FROM derived_metrics ORDER BY date")
        if df.empty:
            return df
        df = df.assign(date=pd.to_datetime(df["date"]))
        wide = df.pivot_table(index="date", columns="name", values="value", aggfunc="last")
        wide.columns.name = None
        return wide.sort_index(ascending=False)
    except Exception as exc:
        print(f"[memo] WARNING: derived_metrics load failed: {exc}")
        return pd.DataFrame()


def load_alert_feed_memo() -> pd.DataFrame:
    """Load alert_feed newest first."""
    if not _table_exists("alert_feed"):
        return pd.DataFrame()
    try:
        df = load_df(
            "SELECT date, alert_type, name, level, value, threshold, direction, message "
            "FROM alert_feed ORDER BY date DESC"
        )
        if not df.empty:
            df = df.assign(date=pd.to_datetime(df["date"]))
        return df
    except Exception as exc:
        print(f"[memo] WARNING: alert_feed load failed: {exc}")
        return pd.DataFrame()


def load_event_calendar_memo() -> pd.DataFrame:
    """Load event_calendar upcoming events."""
    if not _table_exists("event_calendar"):
        return pd.DataFrame()
    try:
        df = load_df(
            "SELECT event_name, event_datetime, importance "
            "FROM event_calendar ORDER BY event_datetime ASC"
        )
        if not df.empty:
            df = df.assign(event_dt=pd.to_datetime(df["event_datetime"], utc=True))
        return df
    except Exception as exc:
        print(f"[memo] WARNING: event_calendar load failed: {exc}")
        return pd.DataFrame()


def load_playbook_memo() -> dict:
    """Load output/playbook.json. Returns {} if missing."""
    try:
        with open(PLAYBOOK_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Trader Pack section builders
# ─────────────────────────────────────────────────────────────────────────────

_WATCHLIST_LABELS = {
    "SPY": "S&P 500 (SPY)", "QQQ": "Nasdaq 100 (QQQ)", "IWM": "Russell 2000 (IWM)",
    "TLT": "20Y Treasury (TLT)", "HYG": "HY Credit (HYG)", "LQD": "IG Credit (LQD)",
    "UUP": "USD Basket (UUP)", "GLD": "Gold (GLD)", "USO": "Oil (USO)",
}

_Z_LABELS_MEMO = {
    "SPY_weekly_ret_z":    "SPY weekly return",
    "QQQ_weekly_ret_z":    "QQQ weekly return",
    "TLT_weekly_ret_z":    "TLT (20Y Treasury)",
    "HYG_weekly_ret_z":    "HYG (HY Credit)",
    "GLD_weekly_ret_z":    "GLD (Gold)",
    "UUP_weekly_ret_z":    "UUP (USD)",
    "USO_weekly_ret_z":    "USO (Oil)",
    "GS10_weekly_chg_z":   "10Y Treasury yield",
    "SPREAD_weekly_chg_z": "10Y–2Y Yield Spread",
    "CPI_yoy_z":           "CPI YoY",
    "VIX_weekly_chg_z":    "VIX (volatility)",
}

_Z_TO_RAW_MEMO = {
    "SPY_weekly_ret_z":    "SPY_weekly_ret",
    "QQQ_weekly_ret_z":    "QQQ_weekly_ret",
    "TLT_weekly_ret_z":    "TLT_weekly_ret",
    "HYG_weekly_ret_z":    "HYG_weekly_ret",
    "GLD_weekly_ret_z":    "GLD_weekly_ret",
    "UUP_weekly_ret_z":    "UUP_weekly_ret",
    "USO_weekly_ret_z":    "USO_weekly_ret",
    "GS10_weekly_chg_z":   "GS10_weekly_chg",
    "SPREAD_weekly_chg_z": "SPREAD_weekly_chg",
    "CPI_yoy_z":           "CPI_yoy",
    "VIX_weekly_chg_z":    None,
}


def build_market_snapshot(market_df: pd.DataFrame, derived_df: pd.DataFrame, wide_df: pd.DataFrame) -> list:
    """
    Build list of dicts for key market moves.
    Each dict: symbol, label, ret_1w, ret_1w_str, direction, z_score.
    """
    rows = []
    priority = ["SPY", "HYG", "TLT", "GLD", "UUP", "USO", "QQQ"]

    for sym in priority:
        sym_data = market_df[market_df["symbol"] == sym].sort_values("date") if not market_df.empty else pd.DataFrame()
        ret_1w   = None
        if not sym_data.empty and "ret_1w" in sym_data.columns:
            v = sym_data["ret_1w"].dropna()
            ret_1w = float(v.iloc[-1]) if not v.empty else None

        z_col = f"{sym}_weekly_ret_z"
        z_val = None
        if not derived_df.empty and z_col in derived_df.columns:
            s = derived_df[z_col].dropna()
            z_val = float(s.iloc[0]) if not s.empty else None

        rows.append({
            "symbol":    sym,
            "label":     _WATCHLIST_LABELS.get(sym, sym),
            "ret_1w":    ret_1w,
            "ret_1w_str": f"{ret_1w:+.2f}%" if ret_1w is not None else "N/A",
            "direction": "up" if ret_1w is not None and ret_1w > 0 else "down",
            "z_score":   z_val,
            "z_str":     f"{z_val:+.1f}σ" if z_val is not None else "",
        })

    # Add rates from raw_series
    if not wide_df.empty:
        gs2  = wide_df["GS2"].dropna()  if "GS2"  in wide_df.columns else pd.Series(dtype=float)
        gs10 = wide_df["GS10"].dropna() if "GS10" in wide_df.columns else pd.Series(dtype=float)
        if not gs10.empty:
            rows.append({
                "symbol": "GS10", "label": "10Y Treasury Yield",
                "ret_1w": float(gs10.iloc[-1]) if not gs10.empty else None,
                "ret_1w_str": f"{float(gs10.iloc[-1]):.2f}%" if not gs10.empty else "N/A",
                "direction": "—", "z_score": None, "z_str": "",
            })

    return rows


def build_surprise_ranking(derived_df: pd.DataFrame, top_n: int = 10) -> list:
    """
    Return top-N z-score items sorted by |z|.
    Each dict: label, z_score, z_str, raw_value, direction, interpretation.
    """
    if derived_df.empty:
        return []

    latest = derived_df.iloc[0]  # sorted descending
    rows   = []
    for col, label in _Z_LABELS_MEMO.items():
        if col not in derived_df.columns:
            continue
        z = latest.get(col)
        if z is None or (isinstance(z, float) and np.isnan(z)):
            continue
        z = float(z)
        raw_col = _Z_TO_RAW_MEMO.get(col)
        raw_val = None
        if raw_col and raw_col in derived_df.columns:
            rv = latest.get(raw_col)
            if rv is not None and not (isinstance(rv, float) and np.isnan(rv)):
                raw_val = float(rv)

        direction  = "surged" if z > 0 else "fell"
        magnitude  = "sharply" if abs(z) >= 2.5 else ("notably" if abs(z) >= 1.5 else "modestly")
        raw_str    = f" ({raw_val:+.2f}%)" if raw_val is not None else ""
        interp     = f"{label} {direction} {magnitude}{raw_str} — {abs(z):.1f}σ move"
        rows.append({
            "label":          label,
            "z_score":        z,
            "z_str":          f"{z:+.1f}σ",
            "abs_z":          abs(z),
            "raw_value":      raw_val,
            "direction":      "up" if z > 0 else "down",
            "interpretation": interp,
            "level":          "high" if abs(z) >= 2.5 else ("medium" if abs(z) >= 1.5 else "low"),
        })

    rows.sort(key=lambda x: x["abs_z"], reverse=True)
    return rows[:top_n]


def build_whats_priced_memo(derived_df: pd.DataFrame) -> dict:
    """
    Return dict with priced metric values.
    Keys: fedfunds, sofr, t5yie, t10yie, dfii5, dfii10 + _chg variants + interpretation.
    """
    result = {}
    if derived_df.empty:
        return result

    latest = derived_df.iloc[0]

    def _get(col):
        if col not in derived_df.columns:
            return None
        v = latest.get(col)
        return float(v) if v is not None and not (isinstance(v, float) and np.isnan(v)) else None

    result["fedfunds"]      = _get("FEDFUNDS_latest")
    result["fedfunds_chg"]  = _get("FEDFUNDS_mom_chg")
    result["sofr"]          = _get("SOFR_latest")
    result["sofr_chg"]      = _get("SOFR_mom_chg")
    result["t5yie"]         = _get("T5YIE_latest")
    result["t5yie_chg"]     = _get("T5YIE_mom_chg")
    result["t10yie"]        = _get("T10YIE_latest")
    result["t10yie_chg"]    = _get("T10YIE_mom_chg")
    result["dfii5"]         = _get("DFII5_latest")
    result["dfii5_chg"]     = _get("DFII5_mom_chg")
    result["dfii10"]        = _get("DFII10_latest")
    result["dfii10_chg"]    = _get("DFII10_mom_chg")
    result["has_data"]      = any(v is not None for k, v in result.items() if not k.endswith("_chg") and k != "has_data")

    # Build interpretation
    msgs = []
    rate = result.get("fedfunds") or result.get("sofr")
    if rate:
        label = "Fed Funds" if result.get("fedfunds") else "SOFR"
        if rate >= 5.0:
            msgs.append(f"Policy rate ({label} {rate:.2f}%) in restrictive territory — high opportunity-cost hurdle for risk assets.")
        elif rate >= 3.0:
            msgs.append(f"Policy rate ({label} {rate:.2f}%) moderately restrictive — rate easing would be a duration tailwind.")
        else:
            msgs.append(f"Policy rate ({label} {rate:.2f}%) accommodative — supportive of equity multiples and credit.")

    be = result.get("t10yie") or result.get("t5yie")
    if be:
        if be > 2.8:
            msgs.append(f"Breakevens ({be:.2f}%) pricing persistent above-target inflation — favor TIPS and real assets over nominals.")
        elif be > 2.2:
            msgs.append(f"Breakevens ({be:.2f}%) modestly above 2% target — monitor incoming CPI for direction.")
        elif be > 1.5:
            msgs.append(f"Breakevens ({be:.2f}%) near-target — inflation expectations anchored.")
        else:
            msgs.append(f"Breakevens ({be:.2f}%) below 2% — disinflation priced in, duration attractive.")

    ry = result.get("dfii10") or result.get("dfii5")
    if ry:
        if ry > 1.5:
            msgs.append(f"Real yields ({ry:.2f}%) restrictive — headwind for growth equities and gold; USD supportive.")
        elif ry > 0:
            msgs.append(f"Real yields ({ry:.2f}%) mildly positive — balanced environment.")
        else:
            msgs.append(f"Real yields ({ry:.2f}%) negative — accommodative for risk-on assets and gold.")

    result["interpretation"] = " ".join(msgs)
    return result


def build_alerts_summary_memo(alerts_df: pd.DataFrame, signal_rows: list) -> dict:
    """
    Return dict with top 3 risk alerts + active signal count + narrative.
    """
    result = {
        "top_risk_alerts": [],
        "active_signal_count": 0,
        "active_signal_labels": [],
        "has_data": False,
    }

    if not alerts_df.empty:
        risk_alerts = alerts_df[alerts_df["level"] == "risk"].head(3)
        for _, row in risk_alerts.iterrows():
            val_str = f"  ({row['value']:.2f})" if pd.notna(row.get("value")) else ""
            result["top_risk_alerts"].append({
                "name":    row["name"],
                "level":   row["level"],
                "message": row["message"] + val_str,
                "date":    str(row.get("date", ""))[:10],
            })
        result["has_data"] = True

    active = [r for r in signal_rows if r.get("triggered")]
    result["active_signal_count"]  = len(active)
    result["active_signal_labels"] = [r["label"] for r in active]

    return result


def build_next_week_memo(calendar_df: pd.DataFrame, signal_rows: list, alerts_df: pd.DataFrame) -> dict:
    """
    Return dict with upcoming events and "what to watch" text.
    """
    result = {
        "events":        [],
        "watch_items":   [],
        "has_events":    False,
    }

    if not calendar_df.empty:
        now    = pd.Timestamp.now(tz="UTC").tz_localize(None)
        cutoff = now + pd.Timedelta(days=7)
        cal    = calendar_df.copy()
        cal    = cal.assign(event_dt_naive=cal["event_dt"].dt.tz_localize(None))
        upcoming = cal[
            (cal["event_dt_naive"] >= now) & (cal["event_dt_naive"] <= cutoff)
        ]
        for _, row in upcoming.iterrows():
            result["events"].append({
                "name":       row["event_name"],
                "datetime":   str(row.get("event_datetime", ""))[:10],
                "importance": row.get("importance", "medium"),
            })
        result["has_events"] = len(result["events"]) > 0

    # "What to Watch" items
    for evt in result["events"]:
        if evt["importance"] == "high":
            result["watch_items"].append(f"{evt['name']} ({evt['datetime']}) — key macro release")

    if not alerts_df.empty:
        for _, row in alerts_df[alerts_df["level"].isin(["risk", "watch"])].head(2).iterrows():
            result["watch_items"].append(f"Alert: {row['name']} — {row['message'][:80]}")

    active = [r for r in signal_rows if r.get("triggered")]
    for r in active[:2]:
        result["watch_items"].append(f"Signal: {r['label']} still triggered — monitor for resolution")

    return result


def build_playbook_commentary_memo(playbook: dict) -> dict:
    """Return dict from playbook.json for template rendering."""
    if not playbook:
        return {"has_data": False}
    return {
        "has_data":     True,
        "regime":       playbook.get("regime", ""),
        "confidence":   f"{playbook.get('confidence', 0):.1%}",
        "baseline":     playbook.get("baseline", ""),
        "because_today": playbook.get("because_today", [])[:5],
        "summary":      playbook.get("summary", ""),
        "badge_color":  {
            "Goldilocks": "#2ecc71", "Overheating": "#e67e22",
            "Stagflation": "#e74c3c", "Recession Risk": "#95a5a6",
        }.get(playbook.get("regime", ""), "#888"),
    }


def build_market_chart(market_df: pd.DataFrame, as_of: pd.Timestamp) -> str | None:
    """
    Build a 12-month indexed return chart for SPY, TLT, GLD, HYG.
    Returns base64 PNG string or None.
    """
    if market_df.empty:
        return None

    cutoff = as_of - pd.DateOffset(months=12)
    symbols_to_plot = ["SPY", "TLT", "GLD", "HYG"]
    colors          = {"SPY": "#2c7be5", "TLT": "#9b59b6", "GLD": "#f39c12", "HYG": "#e74c3c"}
    plotted         = False

    with plt.rc_context(_CHART_RC):
        fig, ax = plt.subplots(figsize=(7.2, 2.9))

        for sym in symbols_to_plot:
            sym_data = market_df[market_df["symbol"] == sym].sort_values("date")
            if sym_data.empty:
                continue
            sym_data = sym_data[sym_data["date"] >= cutoff]
            if sym_data.empty or len(sym_data) < 5:
                continue
            s = sym_data.set_index("date")["close"].dropna()
            if s.empty:
                continue
            indexed = s / s.iloc[0] * 100  # index to 100
            ax.plot(indexed.index, indexed.values, label=sym,
                    color=colors.get(sym, "#333"), linewidth=1.5)
            plotted = True

        if not plotted:
            plt.close(fig)
            return None

        ax.axhline(100, color="#aaa", linewidth=0.8, linestyle="--")
        ax.set_title("12-Month Relative Performance (Indexed = 100)", fontsize=10,
                     fontweight="bold", pad=6, loc="left")
        ax.set_ylabel("Indexed Return", fontsize=8)
        ax.legend(fontsize=8, framealpha=0.7, loc="upper left", ncol=4)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
        ax.tick_params(axis="x", labelrotation=30, labelsize=7)
        ax.tick_params(axis="y", labelsize=8)
        fig.tight_layout(pad=0.8)
        return _fig_to_b64(fig)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def generate_memo() -> None:
    # ── Load macro data ────────────────────────────────────────────────────
    print("[memo] Loading data from DB ...")
    regimes = load_regimes()
    signals = load_signals()
    wide    = load_raw_wide()
    derived = compute_derived(wide) if not wide.empty else pd.DataFrame()

    # ── Load Trader Pack data ──────────────────────────────────────────────
    print("[memo] Loading Trader Pack data ...")
    market_daily = load_market_daily_memo()
    derived_dm   = load_derived_metrics_memo()
    alerts_df    = load_alert_feed_memo()
    calendar_df  = load_event_calendar_memo()
    playbook     = load_playbook_memo()

    if not market_daily.empty:
        print(f"[memo] market_daily: {len(market_daily)} rows")
    else:
        print("[memo] WARNING: market_daily empty — run fetch_market.py")

    if not derived_dm.empty:
        print(f"[memo] derived_metrics: {derived_dm.shape[1]} metrics")
    else:
        print("[memo] WARNING: derived_metrics empty — run analytics modules")

    # ── As-of date (same rule as dashboard) ───────────────────────────────
    if not regimes.empty:
        as_of = regimes["date"].max()
    elif not signals.empty:
        as_of = signals["date"].max()
    elif not wide.empty:
        as_of = wide.index.max()
    else:
        print("[memo] WARNING: All tables are empty — generating skeleton memo.")
        as_of = pd.Timestamp.now().normalize()

    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    print(f"[memo] As-of: {as_of.strftime('%B %Y')}  |  Generated: {generated_at}")

    # ── Regime summary ─────────────────────────────────────────────────────
    regime_ctx = None
    if not regimes.empty:
        r = regimes.iloc[-1].to_dict()
        regime_ctx = {
            **r,
            "badge_color":  REGIME_COLORS.get(r["label"], "#888888"),
            "conf_pct":     f"{r['confidence'] * 100:.0f}%",
            "growth_dir":   "Expanding" if r["growth_trend"] > 0 else "Contracting",
            "infl_dir":     "Rising"    if r["inflation_trend"] > 0 else "Falling",
            "growth_arrow": "▲" if r["growth_trend"] > 0 else "▼",
            "infl_arrow":   "▲" if r["inflation_trend"] > 0 else "▼",
        }

    # ── What Changed This Week ─────────────────────────────────────────────
    changes = build_changes(derived) if not derived.empty else []

    # ── Signals table ──────────────────────────────────────────────────────
    signal_rows = build_signal_rows(signals) if not signals.empty else []

    # ── Charts (base64 embedded) ───────────────────────────────────────────
    print("[memo] Generating macro charts ...")
    charts = build_charts(derived, as_of) if not derived.empty else []
    print(f"[memo] {len(charts)} macro chart(s) generated.")

    # Market returns chart
    market_chart_b64 = build_market_chart(market_daily, as_of)
    if market_chart_b64:
        print("[memo] Market returns chart generated.")
    else:
        print("[memo] Market returns chart skipped (no data).")

    # ── What It Implies ────────────────────────────────────────────────────
    implication = ""
    if regime_ctx:
        implication = build_implication(
            regime_ctx["label"],
            regime_ctx["confidence"],
            signal_rows,
        )

    # ── Trader Pack sections ───────────────────────────────────────────────
    print("[memo] Building Trader Pack sections ...")
    market_snapshot   = build_market_snapshot(market_daily, derived_dm, wide)
    surprise_ranking  = build_surprise_ranking(derived_dm, top_n=10)
    whats_priced      = build_whats_priced_memo(derived_dm)
    alerts_summary    = build_alerts_summary_memo(alerts_df, signal_rows)
    next_week         = build_next_week_memo(calendar_df, signal_rows, alerts_df)
    playbook_ctx      = build_playbook_commentary_memo(playbook)

    print(f"[memo] Surprises: {len(surprise_ranking)}, Events: {len(next_week['events'])}")

    # ── Render Jinja2 template ─────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        env      = Environment(loader=FileSystemLoader(str(TMPL_DIR)), autoescape=True)
        template = env.get_template("memo.html")
    except TemplateNotFound:
        raise FileNotFoundError(
            f"Template not found: {TMPL_DIR / 'memo.html'}\n"
            "Make sure templates/memo.html exists in the project root."
        )

    html = template.render(
        generated_at      = generated_at,
        as_of             = as_of.strftime("%B %Y"),
        as_of_long        = as_of.strftime("%B %d, %Y"),
        regime            = regime_ctx,
        changes           = changes,
        signal_rows       = signal_rows,
        charts            = charts,
        implication       = implication,
        no_regimes        = regime_ctx is None,
        no_signals        = not signal_rows,
        # Trader Pack new sections
        market_snapshot   = market_snapshot,
        surprise_ranking  = surprise_ranking,
        whats_priced      = whats_priced,
        alerts_summary    = alerts_summary,
        next_week         = next_week,
        playbook          = playbook_ctx,
        market_chart_b64  = market_chart_b64,
    )

    MEMO_PATH.write_text(html, encoding="utf-8")
    print(f"[memo] Memo written → {MEMO_PATH}")

    # ── Validation ─────────────────────────────────────────────────────────
    print_validation(regimes, signals, MEMO_PATH)


if __name__ == "__main__":
    try:
        generate_memo()
    except Exception as exc:
        print(f"\n[memo] FATAL: {exc}", file=sys.stderr)
        raise
