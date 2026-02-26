"""
dashboard/app.py — Macro Regime Radar Dashboard (Phase 3, Part A)

Run:
    streamlit run dashboard/app.py
"""

import re
import sqlite3
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

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
    if "GS10" in d.columns and "GS2" in d.columns:
        d["SPREAD"] = d["GS10"] - d["GS2"]
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
# Page config + CSS
# ─────────────────────────────────────────────────────────────────────────────

st.set_page_config(
    layout="wide",
    page_title="Macro Regime Radar",
    page_icon="📡",
)

st.markdown("""
<style>
.regime-tile {
    display: inline-block;
    padding: 18px 32px;
    border-radius: 10px;
    font-size: 26px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,.25);
    letter-spacing: .5px;
    margin-bottom: 8px;
}
.sig-card {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.9;
    height: 100%;
    color: #111111 !important;
}
.sig-card * { color: #111111 !important; }
.sig-triggered { border-left: 4px solid #e74c3c; background: #fff5f5; }
.sig-ok         { border-left: 4px solid #2ecc71; background: #f5fff5; }
.commentary-box {
    background: #f9f9f9;
    padding: 16px 20px;
    border-radius: 6px;
    font-size: 15px;
    line-height: 1.8;
    color: #111111 !important;
}
.commentary-box * { color: #111111 !important; }
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# Sidebar — Control Center
# ─────────────────────────────────────────────────────────────────────────────

with st.sidebar:
    st.markdown("## ⚙️ Control Center")
    date_range  = st.radio("Chart window", ["6M", "1Y", "2Y", "Max"], index=2)
    overlay_reg = st.toggle("Overlay Regimes on Charts", value=False)
    norm_mode   = st.selectbox("Normalization", ["Raw", "Index to 100", "Z-score"])
    st.divider()
    st.caption("Macro Regime Radar · Phase 3")

# ─────────────────────────────────────────────────────────────────────────────
# Load all data
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
# SECTION 1 — Header / Regime Summary
# ─────────────────────────────────────────────────────────────────────────────

st.markdown("# 📡 Macro Regime Radar")
as_of_str = as_of.strftime("%B %Y") if as_of is not None else "N/A"
st.markdown(f"*As of **{as_of_str}** · Last updated: {last_upd}*")
st.divider()

col_badge, col_stats = st.columns([1, 3])

with col_badge:
    if latest_regime is not None:
        lbl  = latest_regime["label"]
        conf = float(latest_regime["confidence"])
        bg   = REGIME_COLORS.get(lbl, "#888")
        st.markdown(
            f'<div class="regime-tile" style="background:{bg}">{lbl}</div>',
            unsafe_allow_html=True,
        )
        st.markdown(f"**Confidence:** {conf:.1%}")
    else:
        st.warning("No regime data available.")

with col_stats:
    if latest_regime is not None and as_of is not None:
        dur  = regime_duration_months(regimes_df, as_of)
        sw12 = max(0, regime_switches_n_months(regimes_df, as_of))
        gt   = float(latest_regime["growth_trend"])
        it   = float(latest_regime["inflation_trend"])
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Growth Trend",     f"{gt:.3f}")
        c2.metric("Inflation Trend",  f"{it:.3f}")
        c3.metric("Months in Regime", str(dur))
        c4.metric("Switches (12M)",   str(sw12))

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — KPI Strip
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Key Indicators")

kpi = st.columns(5)

if not derived_df.empty:
    # 1. CPI YoY
    cpi_val  = _latest(gcol(derived_df, "CPI_YOY"))
    cpi_prev = _prev(gcol(derived_df, "CPI_YOY"))
    cpi_d    = f"{cpi_val - cpi_prev:+.2f}pp" if (cpi_val is not None and cpi_prev is not None) else None
    kpi[0].metric("CPI YoY (%)", f"{cpi_val:.2f}" if cpi_val is not None else "N/A", delta=cpi_d)

    # 2. Unemployment
    ur_val = _latest(gcol(derived_df, "UNRATE"))
    ur_3m  = _latest(gcol(derived_df, "UNRATE_3M"))
    ur_d   = f"{ur_3m:+.2f}pp (3M)" if ur_3m is not None else None
    kpi[1].metric("Unemployment Rate", f"{ur_val:.1f}%" if ur_val is not None else "N/A", delta=ur_d)

    # 3. Yield spread
    sp_val   = _latest(gcol(derived_df, "SPREAD"))
    inverted = sp_val is not None and sp_val < 0
    sp_label = "10Y–2Y Spread" + (" 🔴 Inverted" if inverted else "")
    kpi[2].metric(sp_label, f"{sp_val:.2f}%" if sp_val is not None else "N/A")

    # 4. VIX
    vix_val = _latest(gcol(derived_df, "VIXCLS"))
    vix_d   = f"{vix_val - 30:.1f} from 30" if vix_val is not None else None
    kpi[3].metric("VIX", f"{vix_val:.1f}" if vix_val is not None else "N/A", delta=vix_d)

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

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — Signals Panel
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Signal Monitor")

sig_cols = st.columns(len(SIGNAL_META))

for i, (sname, smeta) in enumerate(SIGNAL_META.items()):
    with sig_cols[i]:
        srow = None
        if not latest_signals.empty and sname in latest_signals["signal_name"].values:
            srow = latest_signals[latest_signals["signal_name"] == sname].iloc[0]
        all_s = (
            signals_df[signals_df["signal_name"] == sname]
            if not signals_df.empty else pd.DataFrame()
        )

        if srow is None:
            st.markdown(f"**{smeta['label']}**\n\n*No data*")
            continue

        triggered = bool(int(srow["triggered"]))
        val       = float(srow["value"])
        dur_s     = signal_active_periods(all_s)
        last_t    = signal_last_triggered(all_s)
        sev       = signal_severity_str(val, smeta)
        css       = "sig-triggered" if triggered else "sig-ok"
        icon      = "🔴" if triggered else "🟢"
        status    = "TRIGGERED" if triggered else "OK"
        last_t_str = last_t.strftime("%b %Y") if last_t is not None else "Never"

        st.markdown(
            f"""<div class="sig-card {css}" style="color:#111111 !important">
<b style="font-size:14px;color:#111111">{icon} {smeta['label']}</b><br>
<span style="color:#111111"><b style="color:#111111">Status:</b> {status}</span><br>
<span style="color:#111111"><b style="color:#111111">Value:</b> {val:.2f} {smeta['unit']}</span><br>
<span style="color:#111111"><b style="color:#111111">Threshold:</b> {smeta['threshold']} ({smeta['direction']})</span><br>
<span style="color:#111111"><b style="color:#111111">Severity:</b> {sev}</span><br>
<span style="color:#111111"><b style="color:#111111">Active periods:</b> {dur_s}</span><br>
<span style="color:#111111"><b style="color:#111111">Last triggered:</b> {last_t_str}</span>
</div>""",
            unsafe_allow_html=True,
        )

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — Charts
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Charts")

if derived_df.empty:
    st.warning("No raw series data available for charts.")
else:
    chart_df   = derived_df[derived_df.index >= win_start]
    reg_window = regime_segs[regime_segs["start"] >= win_start] if not regime_segs.empty else pd.DataFrame()

    # Shared chart builder
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

    tab1, tab2, tab3, tab4 = st.tabs(["CPI YoY", "Unemployment", "Yield Curve", "VIX"])

    with tab1:
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

    with tab2:
        s = gcol(chart_df, "UNRATE")
        if not s.dropna().empty:
            fig = make_line_fig(s, "Unemployment Rate (%)", "% Unemployed", "#3498db")
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.warning("Unemployment data not available.")

    with tab3:
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

    with tab4:
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

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — Regime History
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Regime History (Last 12 Months)")

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

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6 — "What It Implies" commentary
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("What It Implies")

if latest_regime is not None:
    triggered_now = (
        latest_signals[latest_signals["triggered"] == 1]["signal_name"].tolist()
        if not latest_signals.empty else []
    )
    # Determine previous month's regime for trend comparison
    prev_regime_label = None
    if not regimes_df.empty and as_of is not None:
        prev_rows = regimes_df[regimes_df["date"] < as_of].sort_values("date")
        if not prev_rows.empty:
            prev_regime_label = str(prev_rows.iloc[-1]["label"])
    dur_now = regime_duration_months(regimes_df, as_of) if as_of is not None else 0

    commentary = regime_commentary_rich(
        latest_regime["label"],
        float(latest_regime["confidence"]),
        triggered_now,
        derived_df,
        prev_label=prev_regime_label,
        regime_duration=dur_now,
    )
    border_color = REGIME_COLORS.get(latest_regime["label"], "#888")
    st.markdown(
        f'<div class="commentary-box" '
        f'style="border-left:4px solid {border_color}; color:#111111 !important">'
        f'{commentary}</div>',
        unsafe_allow_html=True,
    )
else:
    st.info("No regime data to generate commentary.")

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# PRO C — Drivers Panel ("Why this regime?")
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Why This Regime? — Drivers Panel")

if latest_regime is None or derived_df.empty:
    st.info("No regime or derived data available.")
else:
    col_bar, col_tbl = st.columns([1, 2])

    with col_bar:
        st.markdown("**Regime Inputs**")
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
        st.markdown("**Indicator Snapshot (latest)**")
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

        st.markdown("**Top Drivers by |Z-score| vs. 2Y window**")
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

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# PRO D — Data Freshness & Quality
# ─────────────────────────────────────────────────────────────────────────────

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

# ─────────────────────────────────────────────────────────────────────────────
# PRO E — Downloads
# ─────────────────────────────────────────────────────────────────────────────

st.subheader("Downloads")

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
