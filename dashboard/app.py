"""
dashboard/app.py — Macro Regime Radar Dashboard (Phase 3 + Trader Pack)

Run:
    streamlit run dashboard/app.py
"""

import re
import sqlite3
from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from components.shared_styles import compute_momentum, generate_sparkline_b64, section_header, subsection_header

# ─────────────────────────────────────────────────────────────────────────────
# Config — standalone (no src.* imports to avoid FRED_API_KEY dependency)
# ─────────────────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "macro_radar.db"

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}

SIGNAL_META = {
    "yield_curve_inversion": {
        "label": "Yield Curve Inversion",
        "threshold": 0.0,
        "direction": "below",
        "unit": "%",
    },
    "unemployment_spike": {
        "label": "Unemployment Spike",
        "threshold": 0.3,
        "direction": "above",
        "unit": "pp",
    },
    "cpi_hot": {
        "label": "CPI Hot",
        "threshold": 4.0,
        "direction": "above",
        "unit": "% YoY",
    },
    "cpi_cold": {
        "label": "CPI Cold",
        "threshold": 1.0,
        "direction": "below",
        "unit": "% YoY",
    },
    "vix_spike": {
        "label": "VIX Spike",
        "threshold": 30.0,
        "direction": "above",
        "unit": "",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@st.cache_data(ttl=300)
def query_df(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = connect_db()
    try:
        return pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Loaders (all cached)
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_regimes() -> pd.DataFrame:
    df = query_df("SELECT * FROM regimes ORDER BY date")
    if not df.empty:
        df = df.assign(date=pd.to_datetime(df["date"]))
    return df


@st.cache_data(ttl=300)
def load_signals() -> pd.DataFrame:
    df = query_df("SELECT * FROM signals ORDER BY date, signal_name")
    if not df.empty:
        df = df.assign(date=pd.to_datetime(df["date"]))
    return df


@st.cache_data(ttl=300)
def load_raw_wide() -> pd.DataFrame:
    """Load raw_series and pivot to wide format (date × series_id)."""
    df = query_df("SELECT series_id, date, value FROM raw_series ORDER BY date")
    if df.empty:
        return df
    df = df.assign(date=pd.to_datetime(df["date"]))
    wide = df.pivot_table(index="date", columns="series_id", values="value", aggfunc="last")
    wide.columns.name = None
    return wide.sort_index()


@st.cache_data(ttl=300)
def load_freshness() -> pd.DataFrame:
    return query_df(
        "SELECT series_id, MAX(date) as max_date, MAX(fetched_at) as max_fetched_at, "
        "COUNT(*) as row_count FROM raw_series GROUP BY series_id ORDER BY series_id"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Derived computations
# ─────────────────────────────────────────────────────────────────────────────

# Underscore prefix tells st.cache_data to skip hashing the DataFrame arg
@st.cache_data(ttl=300)
def compute_derived(_wide: pd.DataFrame) -> pd.DataFrame:
    d = _wide.copy()
    if "CPIAUCSL" in d.columns:
        d["CPI_YOY"] = (d["CPIAUCSL"] / d["CPIAUCSL"].shift(12) - 1) * 100
    if "UNRATE" in d.columns:
        d["UNRATE_3M"] = d["UNRATE"] - d["UNRATE"].shift(3)
    if "DGS10" in d.columns and "DGS2" in d.columns:
        d["SPREAD"] = d["DGS10"] - d["DGS2"]
    if "INDPRO" in d.columns:
        d["INDPRO_YOY"] = (d["INDPRO"] / d["INDPRO"].shift(12) - 1) * 100
        d["INDPRO_3M"]  = (d["INDPRO"] / d["INDPRO"].shift(3)  - 1) * 100
    return d


def apply_norm(series: pd.Series, mode: str) -> pd.Series:
    s = series.dropna()
    if s.empty:
        return series
    if mode == "Index to 100":
        return series / s.iloc[0] * 100
    if mode == "Z-score":
        std = s.std()
        return (series - s.mean()) / std if std != 0 else series
    return series  # Raw


def gcol(df: pd.DataFrame, name: str) -> pd.Series:
    """Safely retrieve a column from a DataFrame; return empty Series if missing."""
    return df[name] if name in df.columns else pd.Series(dtype=float)


def _latest(s: pd.Series):
    s2 = s.dropna()
    return float(s2.iloc[-1]) if not s2.empty else None


def _prev(s: pd.Series, n: int = 1):
    s2 = s.dropna()
    return float(s2.iloc[-1 - n]) if len(s2) > n else None


# ─────────────────────────────────────────────────────────────────────────────
# Regime helpers
# ─────────────────────────────────────────────────────────────────────────────

def merge_regime_segments(df: pd.DataFrame) -> pd.DataFrame:
    """Collapse consecutive same-label rows into (label, start, end, confidence) segments."""
    if df.empty:
        return pd.DataFrame(columns=["label", "start", "end", "confidence", "Task"])
    rows = df.sort_values("date").reset_index(drop=True)
    segs = []
    i = 0
    while i < len(rows):
        lbl   = rows.at[i, "label"]
        conf  = rows.at[i, "confidence"]
        start = rows.at[i, "date"]
        j = i
        while j < len(rows) and rows.at[j, "label"] == lbl:
            j += 1
        end = rows.at[j - 1, "date"] + pd.DateOffset(months=1)
        segs.append({"label": lbl, "start": start, "end": end,
                     "confidence": conf, "Task": "Regime"})
        i = j
    return pd.DataFrame(segs)


def regime_duration_months(df: pd.DataFrame, as_of: pd.Timestamp) -> int:
    """Count consecutive months at the end of the series sharing the latest label."""
    if df.empty:
        return 0
    s = df.sort_values("date", ascending=False).reset_index(drop=True)
    lbl = s.at[0, "label"]
    count = 0
    for _, row in s.iterrows():
        if row["label"] == lbl:
            count += 1
        else:
            break
    return count


def regime_switches_n_months(df: pd.DataFrame, as_of: pd.Timestamp, n: int = 12) -> int:
    cutoff = as_of - pd.DateOffset(months=n)
    sub = df[df["date"] >= cutoff].sort_values("date")
    if len(sub) < 2:
        return 0
    # .shift(1) gives NaN for first row → that comparison counts as True, so subtract 1
    return int((sub["label"] != sub["label"].shift(1)).sum()) - 1


def get_as_of(regimes: pd.DataFrame, signals: pd.DataFrame):
    if not regimes.empty:
        return regimes["date"].max()
    if not signals.empty:
        return signals["date"].max()
    return None


def get_last_updated(regimes: pd.DataFrame, signals: pd.DataFrame,
                     freshness: pd.DataFrame) -> str:
    candidates = []
    for df in [regimes, signals]:
        if not df.empty and "computed_at" in df.columns:
            try:
                candidates.append(pd.to_datetime(df["computed_at"]).max())
            except Exception:
                pass
    if candidates:
        return max(candidates).strftime("%Y-%m-%d %H:%M")
    if not freshness.empty:
        try:
            return pd.to_datetime(freshness["max_fetched_at"]).max().strftime("%Y-%m-%d %H:%M")
        except Exception:
            pass
    return "Unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Signal helpers
# ─────────────────────────────────────────────────────────────────────────────

def signal_active_periods(sdf: pd.DataFrame) -> int:
    """Count consecutive triggered=1 periods ending at the latest date."""
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


def signal_last_triggered(sdf: pd.DataFrame):
    t = sdf[sdf["triggered"] == 1]
    return t["date"].max() if not t.empty else None


def signal_severity_str(value: float, meta: dict) -> str:
    thr  = meta["threshold"]
    dist = (value - thr) if meta["direction"] == "above" else (thr - value)
    if dist <= 0:
        return "—"
    label = "mild" if dist < 0.5 else ("moderate" if dist < 2.0 else "severe")
    return f"+{dist:.2f} ({label})"


# ─────────────────────────────────────────────────────────────────────────────
# Rule-based commentary (HTML bold tags for use inside unsafe_allow_html div)
# ─────────────────────────────────────────────────────────────────────────────

def regime_commentary(label: str, confidence: float, triggered: list) -> str:
    conf_str = (
        "high confidence" if confidence >= 0.4
        else "moderate confidence" if confidence >= 0.2
        else "low confidence"
    )
    intros = {
        "Goldilocks": (
            f"The macro backdrop is signaling a <b>Goldilocks</b> regime ({conf_str}): "
            "growth is expanding and inflation remains contained — historically one of the "
            "most constructive environments for risk assets, particularly equities and "
            "credit spreads."
        ),
        "Overheating": (
            f"Current conditions fit an <b>Overheating</b> regime ({conf_str}): growth "
            "is running above trend while inflation is elevated and rising. This backdrop "
            "historically pressures rate-sensitive assets and may prompt further central "
            "bank tightening."
        ),
        "Stagflation": (
            f"The model flags a <b>Stagflation</b> regime ({conf_str}): growth is "
            "decelerating while inflation remains sticky — one of the most challenging "
            "macro environments for diversified portfolios. Real assets and "
            "inflation-linked instruments have historically outperformed in this regime."
        ),
        "Recession Risk": (
            f"The data points to a <b>Recession Risk</b> regime ({conf_str}): growth "
            "indicators are deteriorating and disinflationary dynamics are emerging. "
            "This backdrop typically favors duration, high-quality fixed income, and "
            "defensive equity positioning."
        ),
    }
    text = intros.get(label, f"Current regime: <b>{label}</b> ({conf_str}).")
    if triggered:
        names = [SIGNAL_META.get(s, {}).get("label", s) for s in triggered]
        joined = ", ".join(f"<b>{n}</b>" for n in names)
        text += f" Active risk signals: {joined} — monitor for persistence."
    else:
        text += (
            " No major risk signals are currently triggered; the regime assessment "
            "rests primarily on trend inputs."
        )
    return text


def regime_commentary_rich(
    label: str,
    confidence: float,
    triggered: list,
    derived: pd.DataFrame,
    prev_label=None,
    regime_duration: int = 0,
) -> str:
    """
    Generate 4-6 sentence professional macro commentary for 'What It Implies'.
    Cites actual latest indicator values, compares to the prior month's regime,
    and lists key variables to watch. Written in the style of a macro strategist.
    """
    conf_str = (
        "high confidence" if confidence >= 0.4
        else "moderate confidence" if confidence >= 0.2
        else "low confidence"
    )

    # ── Pull latest indicator values from derived DataFrame ──────────────────
    cpi        = _latest(gcol(derived, "CPI_YOY"))
    ur         = _latest(gcol(derived, "UNRATE"))
    ur_3m      = _latest(gcol(derived, "UNRATE_3M"))
    sp         = _latest(gcol(derived, "SPREAD"))
    vix        = _latest(gcol(derived, "VIXCLS"))
    indpro_yoy = _latest(gcol(derived, "INDPRO_YOY"))

    def fmt(v, d=2, sfx=""):
        return f"{v:.{d}f}{sfx}" if v is not None else "N/A"

    # ── S1: What the regime means for markets ────────────────────────────────
    intros = {
        "Goldilocks": (
            f"The macro backdrop is registering a <b>Goldilocks</b> regime ({conf_str}): "
            "growth is expanding and inflation remains contained — historically one of the most "
            "constructive environments for risk assets, with equities, credit, and cyclical "
            "sectors tending to outperform over 12-month investment horizons."
        ),
        "Overheating": (
            f"Current conditions are consistent with an <b>Overheating</b> regime ({conf_str}): "
            "the economy is running above trend while inflation remains elevated, a combination "
            "that historically pressures rate-sensitive assets, steepens the front end of the "
            "yield curve, and may prompt further central bank tightening."
        ),
        "Stagflation": (
            f"The model is flagging a <b>Stagflation</b> regime ({conf_str}): growth is "
            "decelerating while inflation remains sticky — one of the most challenging macro "
            "backdrops for diversified portfolios, where both equities and nominal bonds tend "
            "to underperform and real assets and inflation-linked instruments typically outperform."
        ),
        "Recession Risk": (
            f"The data is pointing to a <b>Recession Risk</b> regime ({conf_str}): growth "
            "indicators are deteriorating while disinflationary dynamics are emerging — "
            "a backdrop that historically favors duration, high-quality fixed income, and "
            "a defensive tilt in equity positioning toward low-beta and income-oriented sectors."
        ),
    }
    text = intros.get(label, f"Current regime: <b>{label}</b> ({conf_str}).")

    # ── S2: Driving indicators with actual values ────────────────────────────
    drivers = []
    if cpi is not None:
        cpi_desc = (
            "elevated" if cpi > 4.0
            else "well-anchored" if cpi < 1.5
            else "running at a moderate pace"
        )
        drivers.append(f"CPI at <b>{fmt(cpi)}% YoY</b> ({cpi_desc})")

    if ur is not None:
        if ur_3m is not None and ur_3m > 0.3:
            ur_desc = "rising"
        elif ur_3m is not None and ur_3m < -0.2:
            ur_desc = "improving"
        else:
            ur_desc = "stable"
        drivers.append(f"unemployment at <b>{fmt(ur, 1)}%</b> ({ur_desc})")

    if sp is not None:
        if sp < 0:
            sp_desc = "inverted — a historical recession warning"
        elif sp < 0.3:
            sp_desc = "near-flat"
        else:
            sp_desc = "positively sloped"
        drivers.append(f"the 10Y–2Y yield spread at <b>{fmt(sp)}%</b> ({sp_desc})")

    if vix is not None:
        vix_desc = (
            "elevated, signaling market stress" if vix > 30
            else "slightly elevated" if vix > 20
            else "subdued, consistent with low perceived risk"
        )
        drivers.append(f"VIX at <b>{fmt(vix, 1)}</b> ({vix_desc})")

    if indpro_yoy is not None:
        ip_desc = (
            "expanding" if indpro_yoy > 2
            else "contracting" if indpro_yoy < -1
            else "near-flat"
        )
        drivers.append(
            f"industrial production at <b>{fmt(indpro_yoy)}% YoY</b> ({ip_desc})"
        )

    if drivers:
        text += (
            " The classification is primarily driven by: "
            + ", ".join(drivers[:4])
            + "."
        )

    # ── S3: How this compares to the recent trend ────────────────────────────
    if prev_label is not None and prev_label != label:
        text += (
            f" Notably, the regime has transitioned from <b>{prev_label}</b> in the prior month — "
            "a shift that historically marks an inflection point in cross-asset performance "
            "and warrants reassessment of positioning across asset classes."
        )
    else:
        dur_str = (
            f" for {regime_duration} consecutive month{'s' if regime_duration != 1 else ''}"
            if regime_duration > 1 else ""
        )
        text += (
            f" The regime reading is unchanged from the prior month{dur_str}, "
            "suggesting the underlying macro dynamics remain intact and no near-term "
            "trend reversal is yet in evidence."
        )

    # ── S4: Active signals ───────────────────────────────────────────────────
    if triggered:
        names  = [SIGNAL_META.get(s, {}).get("label", s) for s in triggered]
        joined = ", ".join(f"<b>{n}</b>" for n in names)
        text += (
            f" Risk signals currently active: {joined}. "
            "The persistence of these triggers historically correlates with above-average "
            "market volatility and warrants elevated caution on position sizing and "
            "near-term liquidity management."
        )
    else:
        text += (
            " No major risk signals are currently triggered; the regime classification "
            "rests on trend inputs rather than acute stress readings, suggesting the "
            "environment lacks the tail-risk characteristics typical of market dislocations."
        )

    # ── S5: What investors should watch going forward ────────────────────────
    watches = {
        "Goldilocks": (
            "any re-acceleration in core services CPI that could prompt a more restrictive "
            "Fed stance, and early signs of labor-market softening — a sustained rise in "
            "initial claims or consecutive payroll misses would be the most credible leading "
            "indicator of a transition toward Recession Risk"
        ),
        "Overheating": (
            "incoming CPI and PCE prints for evidence of deceleration, Fed communication "
            "around the pace and terminal level of rate adjustments, and the yield curve — "
            "further inversion would signal that tightening is beginning to restrain "
            "demand and that a growth slowdown may follow"
        ),
        "Stagflation": (
            "whether headline and core inflation begins to roll over as demand weakens, "
            "and the Fed's policy balance: easing prematurely risks entrenching inflation "
            "expectations, while continued tightening risks accelerating the growth "
            "slowdown into an outright contraction"
        ),
        "Recession Risk": (
            "monthly payrolls and initial jobless claims as the most timely labor-market "
            "leading indicators, Fed policy pivots (rate cuts historically lag cycle peaks "
            "by several months), and broad leading indicators such as the PMI composite "
            "and Conference Board LEI for evidence of stabilization"
        ),
    }
    watch = watches.get(label, "key macro indicators for signs of a regime transition")
    text += f" Going forward, investors should closely monitor {watch}."

    return text


# ─────────────────────────────────────────────────────────────────────────────
# Chart helpers
# ─────────────────────────────────────────────────────────────────────────────

def add_regime_bg(fig: go.Figure, segs: pd.DataFrame) -> go.Figure:
    for _, seg in segs.iterrows():
        color = REGIME_COLORS.get(seg["label"], "#cccccc")
        fig.add_shape(
            type="rect",
            xref="x", yref="paper",
            x0=seg["start"], x1=seg["end"],
            y0=0, y1=1,
            fillcolor=color,
            opacity=0.10,
            layer="below",
            line_width=0,
        )
    return fig


def base_layout(title: str, y_title: str) -> dict:
    return dict(
        title=dict(text=title, font=dict(size=15)),
        xaxis_title="Date",
        yaxis_title=y_title,
        hovermode="x unified",
        height=400,
        margin=dict(l=50, r=20, t=50, b=40),
        template="plotly_white",
    )


# ─────────────────────────────────────────────────────────────────────────────
# UI Helpers — Phase 3A
# ─────────────────────────────────────────────────────────────────────────────

def _render_header_bar(latest_regime, as_of) -> None:
    """Two-row persistent header: brand + regime (row 1), market stats (row 2)."""
    # ── SPY pct change (from market_daily) ──────────────────────────────────
    spy_display, spy_color = "—", "#8899aa"
    try:
        with sqlite3.connect(DB_PATH) as _c:
            rows = _c.execute(
                "SELECT close FROM market_daily WHERE symbol='SPY' ORDER BY date DESC LIMIT 2"
            ).fetchall()
        if len(rows) == 2:
            spy_now, spy_prev = float(rows[0][0]), float(rows[1][0])
            chg = (spy_now - spy_prev) / spy_prev
            spy_display = f"{chg:+.2%}"
            spy_color = "#3fb950" if chg >= 0 else "#da3633"
    except Exception:
        pass

    # ── VIX (monthly from raw_series) ───────────────────────────────────────
    vix_value_html = '<span style="font-size:13px;font-weight:600;color:#8899aa;">—</span>'
    try:
        with sqlite3.connect(DB_PATH) as _c:
            rows = _c.execute(
                "SELECT value FROM raw_series WHERE series_id='VIXCLS' ORDER BY date DESC LIMIT 2"
            ).fetchall()
        if rows:
            vix_now = float(rows[0][0])
            if len(rows) == 2:
                vix_chg = vix_now - float(rows[1][0])
                chg_color = "#da3633" if vix_chg > 0 else "#3fb950"
                vix_value_html = (
                    f'<span style="font-size:13px;font-weight:600;color:#e6edf3;">{vix_now:.1f}</span>'
                    f'<span style="font-size:11px;font-weight:500;color:{chg_color};"> ({vix_chg:+.2f})</span>'
                )
            else:
                vix_value_html = f'<span style="font-size:13px;font-weight:600;color:#e6edf3;">{vix_now:.1f}</span>'
    except Exception:
        pass

    # ── GS10 in bps (monthly from raw_series) ───────────────────────────────
    gs10_value_html = '<span style="font-size:13px;font-weight:600;color:#8899aa;">—</span>'
    try:
        with sqlite3.connect(DB_PATH) as _c:
            rows = _c.execute(
                "SELECT value FROM raw_series WHERE series_id='DGS10' ORDER BY date DESC LIMIT 2"
            ).fetchall()
        if len(rows) == 2:
            gs10_now = float(rows[0][0])
            bps = round((gs10_now - float(rows[1][0])) * 100)
            bps_color = "#da3633" if bps > 0 else "#3fb950"
            gs10_value_html = (
                f'<span style="font-size:13px;font-weight:600;color:#e6edf3;">{gs10_now:.2f}%</span>'
                f'<span style="font-size:11px;font-weight:500;color:{bps_color};"> ({bps:+d}bps)</span>'
            )
        elif rows:
            gs10_now = float(rows[0][0])
            gs10_value_html = f'<span style="font-size:13px;font-weight:600;color:#e6edf3;">{gs10_now:.2f}%</span>'
    except Exception:
        pass

    # ── Regime badge ─────────────────────────────────────────────────────────
    BADGE_STYLES = {
        "Overheating":    "background:rgba(218,54,51,0.12) !important;color:#f08785 !important;border:0.5px solid rgba(218,54,51,0.25)",
        "Goldilocks":     "background:rgba(63,185,80,0.12) !important;color:#3fb950 !important;border:0.5px solid rgba(63,185,80,0.25)",
        "Stagflation":    "background:rgba(210,153,34,0.12) !important;color:#d29922 !important;border:0.5px solid rgba(210,153,34,0.25)",
        "Recession Risk": "background:rgba(218,54,51,0.20) !important;color:#f08785 !important;border:0.5px solid rgba(218,54,51,0.40)",
    }
    lbl = str(latest_regime["label"]) if latest_regime is not None else "—"
    conf_pct = f"{float(latest_regime['confidence']):.1%}" if latest_regime is not None else "—"
    badge_style = BADGE_STYLES.get(lbl, "background:#21262d !important;color:#8899aa !important;border:0.5px solid #484f58")

    st.markdown(f"""
<div style="border-bottom:1px solid #21262d;margin:0;padding:0;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px 8px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
        background:#4a9eff;box-shadow:0 0 6px rgba(74,158,255,0.4);flex-shrink:0;"></span>
      <span style="font-size:15px;font-weight:600;letter-spacing:1.2px;
        text-transform:uppercase;color:#e6edf3;white-space:nowrap;">Macro Regime Radar</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:4px;{badge_style}" title="Current macro regime based on 3-month growth and inflation trends">{lbl}</span>
      <span style="font-size:11px;color:#6e7681;white-space:nowrap;" title="Reflects the statistical distance of current conditions from regime boundaries">Conviction: {conf_pct}</span>
    </div>
  </div>
  <div style="display:flex;align-items:center;padding:0 20px 10px;">
    <div style="display:flex;flex-direction:column;padding-right:16px;">
      <span style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;">S&amp;P 500</span>
      <span style="font-size:13px;font-weight:600;color:{spy_color};white-space:nowrap;">{spy_display}</span>
    </div>
    <div style="width:1px;height:14px;background:#21262d;margin:0 8px;"></div>
    <div style="display:flex;flex-direction:column;padding-right:16px;padding-left:8px;">
      <span style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;">VIX</span>
      <div style="white-space:nowrap;">{vix_value_html}</div>
    </div>
    <div style="width:1px;height:14px;background:#21262d;margin:0 8px;"></div>
    <div style="display:flex;flex-direction:column;padding-left:8px;">
      <span style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;">US 10Y</span>
      <div style="white-space:nowrap;">{gs10_value_html}</div>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)


def _render_timestamps(as_of) -> None:
    """Row: macro data as-of · market data through · updated timestamp."""
    macro_date = as_of.strftime("%b %Y") if as_of is not None else "—"
    try:
        with sqlite3.connect(DB_PATH) as _c:
            row = _c.execute("SELECT MAX(date) FROM market_daily").fetchone()
        mkt_date = pd.Timestamp(row[0]).strftime("%b %d, %Y") if row and row[0] else "—"
    except Exception:
        mkt_date = "—"
    updated_str = datetime.now().strftime("%b %d, %Y at %I:%M %p ET")
    st.markdown(
        f'<div style="display:flex;justify-content:space-between;align-items:center;'
        f'flex-wrap:nowrap;padding:4px 0 8px;">'
        f'<span style="font-size:10px;color:#8899aa;white-space:nowrap;">Macro data as of {macro_date} · '
        f'Market data through {mkt_date}</span>'
        f'<span style="font-size:10px;color:#484f58;white-space:nowrap;">Updated {updated_str}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )


def _render_read_through_box(latest_regime, derived_df, regimes_df, latest_signals, as_of) -> None:
    """Blue-left-bordered read-through box: regime commentary + playbook bias."""
    if latest_regime is None:
        return
    try:
        from components.db_helpers import load_playbook as _load_playbook
    except Exception:
        _load_playbook = lambda: {}

    lbl  = str(latest_regime["label"])
    conf = float(latest_regime["confidence"])
    triggered_now = (
        latest_signals[latest_signals["triggered"] == 1]["signal_name"].tolist()
        if not latest_signals.empty else []
    )
    prev_regime_label = None
    if not regimes_df.empty and as_of is not None:
        prev_rows = regimes_df[regimes_df["date"] < as_of].sort_values("date")
        if not prev_rows.empty:
            prev_regime_label = str(prev_rows.iloc[-1]["label"])
    dur_now = regime_duration_months(regimes_df, as_of) if as_of is not None else 0
    interpretive_text = regime_commentary_rich(
        lbl, conf, triggered_now, derived_df,
        prev_label=prev_regime_label, regime_duration=dur_now,
    )
    playbook = _load_playbook()
    playbook_text = playbook.get("baseline", "—") if playbook else "—"
    st.markdown(
        f'<div style="background:#161b22;border:0.5px solid #21262d;'
        f'border-left:3px solid #4a9eff;border-radius:0 6px 6px 0;'
        f'padding:12px 16px;margin-bottom:18px;">'
        f'<div style="font-size:10px;font-weight:600;letter-spacing:0.5px;color:#8899aa;'
        f'text-transform:uppercase;margin-bottom:6px;">Current read-through</div>'
        f'<div style="font-size:13px;color:#c9d1d9;line-height:1.55;margin-bottom:10px;">'
        f'{interpretive_text}</div>'
        f'<div style="border-top:1px solid #21262d;padding-top:8px;'
        f'display:flex;align-items:baseline;gap:8px;">'
        f'<span style="font-size:10px;font-weight:600;letter-spacing:0.4px;color:#8899aa;">'
        f'Playbook bias</span>'
        f'<span style="font-size:12px;color:#c9d1d9;">{playbook_text}</span>'
        f'</div></div>',
        unsafe_allow_html=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Page config + CSS
# ─────────────────────────────────────────────────────────────────────────────

st.set_page_config(
    layout="wide",
    page_title="Macro Regime Radar",
    page_icon="📡",
)

st.markdown("""
<style>
/* Streamlit 1.54.0 — Bloomberg-Grade UI Foundation */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ── Hide Streamlit toolbar for full-bleed header ─── */
header[data-testid="stHeader"] { display: none !important; }
div.block-container { padding-top: 0 !important; }

/* ── Global font ──────────────────────────────────── */
html, body, [class*="css"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-variant-numeric: tabular-nums;
}

/* ── Spacing reduction ────────────────────────────── */
[data-testid="stVerticalBlock"] > div { gap: 0.25rem; }
div.stDivider { margin: 6px 0 !important; }
hr { margin: 6px 0 !important; }
[data-testid="stHorizontalBlock"] { gap: 0.5rem !important; }

/* ── Tab bar — Streamlit 1.54.0 ──────────────────── */
.stTabs [data-baseweb="tab-list"] {
    gap: 0px;
    border-bottom: 1px solid #21262d;
}
.stTabs [data-baseweb="tab"] {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #8899aa;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.4px;
    padding: 8px 12px;
    white-space: nowrap;
}
.stTabs [aria-selected="true"][data-baseweb="tab"] {
    background: transparent !important;
    border-bottom: 2px solid #4a9eff !important;
    color: #e6edf3 !important;
}
.stTabs [data-baseweb="tab"]:hover { color: #c9d1d9; }

/* ── Legacy signal helpers ───────────────────────── */
.sig-triggered { border-left: 4px solid #da3633; }
.sig-ok        { border-left: 4px solid #3fb950; }

/* ── Key Indicator KPI cards ─────────────────────── */
[data-testid="stMetric"] {
    background: #161b22;
    border: 0.5px solid #21262d;
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 0 !important;
    padding-bottom: 4px !important;
}
[data-testid="stMetricLabel"] > div {
    font-size: 10px !important;
    color: #8899aa !important;
    margin-bottom: 4px;
}
[data-testid="stMetricValue"] > div {
    font-size: 16px !important;
    font-weight: 600 !important;
    color: #e6edf3 !important;
}
[data-testid="stMetricDelta"] > div {
    font-size: 10px !important;
}
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# Sidebar — Control Center
# ─────────────────────────────────────────────────────────────────────────────

with st.sidebar:
    st.markdown("**Control Center**")
    date_range  = st.radio("Chart window", ["6M", "1Y", "2Y", "Max"], index=2)
    overlay_reg = st.toggle("Overlay Regimes on Charts", value=False)
    norm_mode   = st.selectbox("Normalization", ["Raw", "Index to 100", "Z-score"])
    st.divider()
    st.caption("Macro Regime Radar · Phase 3 + Trader Pack")

# ─────────────────────────────────────────────────────────────────────────────
# Load all macro data (shared across tabs)
# ─────────────────────────────────────────────────────────────────────────────

regimes_df   = load_regimes()
signals_df   = load_signals()
wide_df      = load_raw_wide()
freshness_df = load_freshness()
derived_df   = compute_derived(wide_df) if not wide_df.empty else pd.DataFrame()

as_of    = get_as_of(regimes_df, signals_df)
last_upd = get_last_updated(regimes_df, signals_df, freshness_df)

# Window start date
if as_of is not None:
    offsets = {"6M": 6, "1Y": 12, "2Y": 24}
    if date_range in offsets:
        win_start = as_of - pd.DateOffset(months=offsets[date_range])
    else:
        win_start = derived_df.index.min() if not derived_df.empty else as_of - pd.DateOffset(years=10)
else:
    win_start = pd.Timestamp("2016-01-01")

# Convenience: latest row extracts
latest_regime = None
if not regimes_df.empty and as_of is not None:
    match = regimes_df[regimes_df["date"] == as_of]
    if not match.empty:
        latest_regime = match.iloc[0]

latest_signals = (
    signals_df.sort_values("date").groupby("signal_name").last().reset_index()
    if not signals_df.empty else pd.DataFrame()
)

regime_segs = merge_regime_segments(regimes_df)

# ─────────────────────────────────────────────────────────────────────────────
# Persistent header bar
# ─────────────────────────────────────────────────────────────────────────────

_render_header_bar(latest_regime, as_of)

# ─────────────────────────────────────────────────────────────────────────────
# Top-level tab navigation
# ─────────────────────────────────────────────────────────────────────────────

tab_dash, tab_mkt, tab_sig, tab_hist, tab_cal, tab_meth = st.tabs([
    "Dashboard", "Markets", "Signals & Alerts", "Historical Analysis", "Calendar", "Methodology"
])

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Dashboard (Decision View + Macro merged)
# ─────────────────────────────────────────────────────────────────────────────

with tab_dash:
    # ── Timestamps ───────────────────────────────────────────────────────────
    _render_timestamps(as_of)

    # ── Read-through box ─────────────────────────────────────────────────────
    _render_read_through_box(latest_regime, derived_df, regimes_df, latest_signals, as_of)

    # ── Decision View (regime tile, risks, events, signals strip, surprises) ─
    try:
        from components.decision_view import render_decision_view
        render_decision_view(
            latest_regime=latest_regime,
            regimes_df=regimes_df,
            latest_signals=latest_signals,
            signals_df=signals_df,
            as_of=as_of,
        )
    except Exception as exc:
        st.error(f"Decision View error: {exc}")

    st.divider()

    # ── Key Indicators (KPI strip) ────────────────────────────────────────────
    section_header("Key Indicators")

    # rising_bad → rising is bad (red); rising_good → rising is good (green)
    _KPI_DIRECTION = {
        "CPI_YOY": "rising_bad",
        "UNRATE":  "rising_bad",
        "SPREAD":  "rising_good",
        "VIXCLS":  "rising_bad",
    }

    def _momentum_color(label: str, series_key: str) -> str:
        """Return CSS color for a momentum label based on series direction."""
        direction = _KPI_DIRECTION.get(series_key, "rising_bad")
        rising = "Rising" in label or "Accelerating" in label
        if direction == "rising_bad":
            return "#da3633" if rising else "#3fb950"
        else:
            return "#3fb950" if rising else "#da3633"

    def _sparkline_and_momentum(col, series_key: str, derived_col: str) -> None:
        """Render sparkline + momentum label inside an already-active column context."""
        vals_series = gcol(derived_df, derived_col).dropna()
        vals = tuple(vals_series.iloc[-12:].tolist())
        if len(vals) >= 3:
            spark_color = "#4a9eff"
            b64 = generate_sparkline_b64(vals, color=spark_color)
            if b64:
                col.markdown(
                    f'<img src="data:image/png;base64,{b64}" '
                    f'style="width:100%;margin:4px 0 2px;" />',
                    unsafe_allow_html=True,
                )
            lbl, arrow, fixed_color = compute_momentum(vals)
            color = fixed_color if fixed_color is not None else _momentum_color(lbl, series_key)
            col.markdown(
                f'<span style="color:{color};font-size:12px">{lbl} (3M)</span>',
                unsafe_allow_html=True,
            )

    kpi = st.columns(5)

    if not derived_df.empty:
        # 1. CPI YoY
        cpi_val  = _latest(gcol(derived_df, "CPI_YOY"))
        cpi_prev = _prev(gcol(derived_df, "CPI_YOY"))
        cpi_d    = f"{cpi_val - cpi_prev:+.2f}pp" if (cpi_val is not None and cpi_prev is not None) else None
        kpi[0].metric("CPI YoY (%)", f"{cpi_val:.2f}" if cpi_val is not None else "N/A", delta=cpi_d)
        _sparkline_and_momentum(kpi[0], "CPI_YOY", "CPI_YOY")

        # 2. Unemployment
        ur_val = _latest(gcol(derived_df, "UNRATE"))
        ur_3m  = _latest(gcol(derived_df, "UNRATE_3M"))
        ur_d   = f"{ur_3m:+.2f}pp (3M)" if ur_3m is not None else None
        kpi[1].metric("Unemployment Rate", f"{ur_val:.1f}%" if ur_val is not None else "N/A", delta=ur_d)
        _sparkline_and_momentum(kpi[1], "UNRATE", "UNRATE")

        # 3. Yield spread
        sp_val   = _latest(gcol(derived_df, "SPREAD"))
        inverted = sp_val is not None and sp_val < 0
        sp_label = "10Y–2Y Spread" + (" 🔴 Inverted" if inverted else "")
        kpi[2].metric(sp_label, f"{sp_val:.2f}%" if sp_val is not None else "N/A")
        _sparkline_and_momentum(kpi[2], "SPREAD", "SPREAD")

        # 4. VIX
        vix_val = _latest(gcol(derived_df, "VIXCLS"))
        vix_d   = f"{vix_val - 30:.1f} from 30" if vix_val is not None else None
        kpi[3].metric("VIX", f"{vix_val:.1f}" if vix_val is not None else "N/A", delta=vix_d)
        _sparkline_and_momentum(kpi[3], "VIXCLS", "VIXCLS")

        # 5. Regime trend inputs
        if latest_regime is not None:
            kpi[4].metric(
                "Growth / Infl Trend",
                f"{float(latest_regime['growth_trend']):.3f} / {float(latest_regime['inflation_trend']):.3f}",
            )
        else:
            kpi[4].metric("Growth / Infl Trend", "N/A")
    else:
        st.warning("Raw series unavailable — KPIs cannot be computed.")

    st.divider()

    # ── Charts ────────────────────────────────────────────────────────────────
    section_header("Charts")

    if derived_df.empty:
        st.warning("No raw series data available for charts.")
    else:
        chart_df   = derived_df[derived_df.index >= win_start]
        reg_window = regime_segs[regime_segs["start"] >= win_start] if not regime_segs.empty else pd.DataFrame()

        def make_line_fig(series: pd.Series, title: str, y_title: str,
                          color: str, hlines=None) -> go.Figure:
            s = apply_norm(series.dropna(), norm_mode)
            fig = go.Figure()
            if overlay_reg and not reg_window.empty:
                fig = add_regime_bg(fig, reg_window)
            fig.add_trace(go.Scatter(
                x=s.index, y=s.values,
                name=y_title,
                line=dict(color=color, width=2),
                hovertemplate="%{x|%b %Y}: %{y:.2f}<extra></extra>",
            ))
            if hlines and norm_mode == "Raw":
                for y_val, dash, ann in hlines:
                    fig.add_hline(
                        y=y_val, line_dash=dash, line_color="#555", line_width=1,
                        annotation_text=ann, annotation_position="top left",
                        annotation_font_size=11,
                    )
            fig.update_layout(**base_layout(title, y_title))
            return fig

        ctab1, ctab2, ctab3, ctab4 = st.tabs(["CPI YoY", "Unemployment", "Yield Curve", "VIX"])

        with ctab1:
            s = gcol(chart_df, "CPI_YOY")
            if not s.dropna().empty:
                fig = make_line_fig(
                    s, "CPI Year-over-Year (%)", "% YoY", "#e74c3c",
                    hlines=[
                        (4.0, "dash", "Hot threshold (4%)"),
                        (1.0, "dot",  "Cold threshold (1%)"),
                    ],
                )
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.warning("CPI YoY not available in selected window.")

        with ctab2:
            s = gcol(chart_df, "UNRATE")
            if not s.dropna().empty:
                fig = make_line_fig(s, "Unemployment Rate (%)", "% Unemployed", "#3498db")
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.warning("Unemployment data not available.")

        with ctab3:
            s = gcol(chart_df, "SPREAD")
            if not s.dropna().empty:
                norm_s = apply_norm(s.dropna(), norm_mode)
                fig = go.Figure()
                if overlay_reg and not reg_window.empty:
                    fig = add_regime_bg(fig, reg_window)
                fig.add_trace(go.Scatter(
                    x=norm_s.index, y=norm_s.values,
                    name="10Y–2Y Spread",
                    line=dict(color="#9b59b6", width=2),
                    fill="tozeroy",
                    fillcolor="rgba(155,89,182,0.12)",
                    hovertemplate="%{x|%b %Y}: %{y:.2f}%<extra></extra>",
                ))
                if norm_mode == "Raw":
                    fig.add_hline(
                        y=0, line_dash="solid", line_color="#e74c3c", line_width=1.5,
                        annotation_text="Inversion (0%)", annotation_position="top left",
                        annotation_font_size=11,
                    )
                fig.update_layout(**base_layout("Yield Curve Spread: 10Y – 2Y (%)", "Spread (%)"))
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.warning("Yield spread data not available.")

        with ctab4:
            s = gcol(chart_df, "VIXCLS")
            if not s.dropna().empty:
                fig = make_line_fig(
                    s, "CBOE Volatility Index (VIX)", "VIX", "#f39c12",
                    hlines=[(30.0, "dash", "Spike threshold (30)")],
                )
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.warning("VIX data not available.")

    st.divider()

    # ── Regime History (Last 12 Months) ──────────────────────────────────────
    section_header("Regime History (Last 12 Months)")

    if regimes_df.empty:
        st.warning("No regime data available.")
    else:
        twelve_ago = (as_of - pd.DateOffset(months=12)) if as_of is not None else pd.Timestamp("2020-01-01")
        hist_segs  = regime_segs[regime_segs["start"] >= twelve_ago].copy()

        if hist_segs.empty:
            st.info("No regime segments in the last 12 months.")
        else:
            fig_gantt = px.timeline(
                hist_segs,
                x_start="start",
                x_end="end",
                y="Task",
                color="label",
                color_discrete_map=REGIME_COLORS,
                hover_data={"label": True, "confidence": ":.1%", "Task": False},
                labels={"label": "Regime"},
                text="label",
            )
            fig_gantt.update_yaxes(showticklabels=False, title="")
            fig_gantt.update_xaxes(tickformat="%b %Y", title="")
            fig_gantt.update_traces(textposition="inside", insidetextanchor="middle")
            fig_gantt.update_layout(
                height=110,
                margin=dict(l=20, r=20, t=30, b=20),
                template="plotly_white",
                showlegend=True,
                legend=dict(orientation="h", y=1.4, title=""),
            )
            st.plotly_chart(fig_gantt, use_container_width=True)

        if as_of is not None:
            dur  = regime_duration_months(regimes_df, as_of)
            sw12 = max(0, regime_switches_n_months(regimes_df, as_of))
            c1, c2 = st.columns(2)
            c1.metric("Months in Current Regime", str(dur))
            c2.metric("Regime Switches (12M)", str(sw12))

    st.divider()

    # ── Drivers Panel ("Why this regime?") ────────────────────────────────────
    section_header("Why This Regime? — Drivers Panel")

    if latest_regime is None or derived_df.empty:
        st.info("No regime or derived data available.")
    else:
        col_bar, col_tbl = st.columns([1, 2])

        with col_bar:
            subsection_header("Regime Inputs")
            gt = float(latest_regime["growth_trend"])
            it = float(latest_regime["inflation_trend"])
            fig_b = go.Figure(go.Bar(
                x=["Growth Trend", "Inflation Trend"],
                y=[gt, it],
                text=[f"{gt:.3f}", f"{it:.3f}"],
                textposition="outside",
                marker_color=[
                    "#2ecc71" if gt >= 0 else "#e74c3c",
                    "#e74c3c" if it > 0.5 else "#f39c12",
                ],
            ))
            fig_b.update_layout(
                height=260,
                margin=dict(l=20, r=20, t=20, b=20),
                template="plotly_white",
                showlegend=False,
                yaxis_title="Trend value",
            )
            st.plotly_chart(fig_b, use_container_width=True)

        with col_tbl:
            subsection_header("Indicator Snapshot (latest)")
            snap_rows = []
            for col_name, disp_name, unit in [
                ("CPI_YOY",    "CPI YoY",        "%"),
                ("INDPRO_YOY", "INDPRO YoY",     "%"),
                ("INDPRO_3M",  "INDPRO 3M Chg",  "%"),
                ("UNRATE",     "Unemployment",   "%"),
                ("UNRATE_3M",  "UNRATE 3M Chg", "pp"),
                ("SPREAD",     "10Y–2Y Spread",  "%"),
                ("VIXCLS",     "VIX",             ""),
            ]:
                v = _latest(gcol(derived_df, col_name))
                snap_rows.append({
                    "Indicator": disp_name,
                    "Value": f"{v:.2f}{unit}" if v is not None else "N/A",
                })
            st.dataframe(pd.DataFrame(snap_rows), hide_index=True, use_container_width=True)

            subsection_header("Top Drivers by |Z-score| vs. 2Y window")
            win_2y = derived_df[derived_df.index >= derived_df.index.max() - pd.DateOffset(months=24)]
            nice   = {
                "CPI_YOY":    "CPI YoY",
                "INDPRO_YOY": "INDPRO YoY",
                "UNRATE":     "Unemployment",
                "SPREAD":     "Yield Spread",
                "VIXCLS":     "VIX",
            }
            zscores = {}
            for cn in nice:
                s = gcol(win_2y, cn).dropna()
                if len(s) >= 3 and s.std() != 0:
                    zscores[cn] = float((s.iloc[-1] - s.mean()) / s.std())

            bullets = [
                f"- **{nice[k]}**: {v:+.2f}σ ({'above' if v > 0 else 'below'} 2Y avg)"
                for k, v in sorted(zscores.items(), key=lambda x: abs(x[1]), reverse=True)[:4]
            ]
            st.markdown("\n".join(bullets) if bullets else "*Insufficient data for z-score ranking.*")

    # ── Data Freshness & Quality ──────────────────────────────────────────────
    with st.expander("Data Freshness & Quality"):
        if not freshness_df.empty:
            st.markdown("**Latest available date per series**")
            st.dataframe(freshness_df, hide_index=True, use_container_width=True)

            if not wide_df.empty:
                st.markdown("**Data completeness in selected window**")
                wdf   = wide_df[wide_df.index >= win_start]
                miss  = wdf.isnull().sum()
                total = len(wdf)
                miss_rows = pd.DataFrame({
                    "Series":       miss.index,
                    "Missing Rows": miss.values,
                    "Total Rows":   total,
                    "Completeness": [
                        f"{(total - m) / total * 100:.0f}%" for m in miss.values
                    ],
                })
                st.dataframe(miss_rows, hide_index=True, use_container_width=True)
        else:
            st.info("No freshness data available.")

    # ── Downloads ─────────────────────────────────────────────────────────────
    section_header("Downloads")

    dl1, dl2, dl3 = st.columns(3)

    with dl1:
        if not wide_df.empty:
            df_dl = wide_df[wide_df.index >= win_start].reset_index()
            st.download_button(
                "⬇ Raw Series (selected window)",
                data=df_dl.to_csv(index=False).encode(),
                file_name=f"raw_series_{date_range}.csv",
                mime="text/csv",
            )

    with dl2:
        if not regimes_df.empty:
            st.download_button(
                "⬇ Regimes Table",
                data=regimes_df.to_csv(index=False).encode(),
                file_name="regimes.csv",
                mime="text/csv",
            )

    with dl3:
        if not signals_df.empty:
            st.download_button(
                "⬇ Signals Table",
                data=signals_df.to_csv(index=False).encode(),
                file_name="signals.csv",
                mime="text/csv",
            )

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Markets
# ─────────────────────────────────────────────────────────────────────────────

with tab_mkt:
    try:
        from components.market_snapshot import render_market_snapshot
        render_market_snapshot(wide_df=wide_df)
    except Exception as exc:
        st.error(f"Market Snapshot error: {exc}")

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Signals & Alerts
# ─────────────────────────────────────────────────────────────────────────────

with tab_sig:
    try:
        from components.alerts_tab import render_alerts_tab
        render_alerts_tab()
    except Exception as exc:
        st.error(f"Alerts error: {exc}")
    st.markdown("---")
    try:
        from components.whats_priced import render_whats_priced
        render_whats_priced()
    except Exception as exc:
        st.error(f"What's Priced error: {exc}")

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Historical Analysis
# ─────────────────────────────────────────────────────────────────────────────

with tab_hist:
    try:
        from components.backtests import render_backtests
        render_backtests()
    except Exception as exc:
        st.error(f"Backtests error: {exc}")

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Calendar
# ─────────────────────────────────────────────────────────────────────────────

with tab_cal:
    try:
        from components.calendar_tab import render_calendar_tab
        render_calendar_tab(latest_signals=latest_signals)
    except Exception as exc:
        st.error(f"Calendar error: {exc}")

# ─────────────────────────────────────────────────────────────────────────────
# TAB: Methodology
# ─────────────────────────────────────────────────────────────────────────────

with tab_meth:
    try:
        from components.methodology import render_methodology
        render_methodology()
    except Exception as exc:
        st.error(f"Methodology error: {exc}")

# ─────────────────────────────────────────────────────────────────────────────
# Footer
# ─────────────────────────────────────────────────────────────────────────────

st.markdown("""
<div style="padding: 8px 20px; border-top: 1px solid #21262d; text-align: center; margin-top: 40px;">
  <span style="font-size: 9px; color: #3d444d; letter-spacing: 0.3px;">Data: FRED · Polygon.io · Yahoo Finance</span>
</div>
""", unsafe_allow_html=True)
