"""
dashboard/components/credit_spreads.py — Credit Spreads tab.

Displays:
  - Credit regime label (Spreads Widening / Neutral / Tightening)
  - KPI strip: HYG, LQD, EMB 1D returns + HYG/LQD cross-credit ratio + HYG 1M
  - 90-day indexed price chart: HYG, LQD, TLT, EMB (base=100)
  - HYG/LQD ratio chart (HY vs IG spread proxy)
  - Credit vs Volatility dual-axis: HYG + VIXY
  - Spread signal rows (HYG trend, HY vs IG divergence, EM credit)
  - Regime-aware narrative

Standalone module — no src.config imports.
"""

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from components.db_helpers import has_market_data, load_market_daily
from components.shared_styles import section_header

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

_CREDIT_SYMBOLS = ("HYG", "LQD", "TLT", "EMB", "VIXY")

_COLORS = {
    "HYG":  "#e05c5c",   # red-ish — high yield
    "LQD":  "#4a9eff",   # blue    — investment grade
    "TLT":  "#d29922",   # gold    — long duration rates
    "EMB":  "#9b59b6",   # purple  — EM bonds
    "VIXY": "#95a5a6",   # gray    — volatility
}

_DARK = dict(
    paper_bgcolor="#0d1117",
    plot_bgcolor="#0d1117",
    font=dict(color="#8899aa", size=11),
    margin=dict(l=50, r=16, t=36, b=40),
    legend=dict(
        bgcolor="rgba(0,0,0,0)",
        font=dict(size=10),
        orientation="h",
        yanchor="bottom",
        y=1.02,
        xanchor="left",
        x=0,
    ),
    xaxis=dict(gridcolor="#21262d", linecolor="#21262d", showgrid=True, zeroline=False),
    yaxis=dict(gridcolor="#21262d", linecolor="#21262d", showgrid=True, zeroline=False),
)


# ─────────────────────────────────────────────────────────────────────────────
# Data helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_wide(lookback_days: int = 252) -> pd.DataFrame:
    """Return wide DataFrame: index=date, columns=symbol (close price)."""
    daily = load_market_daily(symbols=_CREDIT_SYMBOLS)
    if daily.empty:
        return pd.DataFrame()
    daily = daily.assign(date=pd.to_datetime(daily["date"]))
    wide = daily.pivot_table(index="date", columns="symbol", values="close", aggfunc="last")
    wide.columns.name = None
    return wide.sort_index().tail(lookback_days)


def _compute_signals(wide: pd.DataFrame) -> dict:
    """Compute spread signals. Returns dict of named float values."""
    s = {}

    def _ret(col: str, periods: int, key: str) -> None:
        if col not in wide.columns:
            return
        ser = wide[col].dropna()
        if len(ser) > periods:
            s[key] = (ser.iloc[-1] / ser.iloc[-1 - periods] - 1) * 100

    # Individual ETF returns
    _ret("HYG", 1,  "hyg_1d");  _ret("HYG", 5,  "hyg_1w");  _ret("HYG", 21, "hyg_1m")
    _ret("LQD", 1,  "lqd_1d");  _ret("LQD", 5,  "lqd_1w")
    _ret("EMB", 1,  "emb_1d");  _ret("EMB", 5,  "emb_1w");  _ret("EMB", 21, "emb_1m")

    # HYG moving-average signals
    if "HYG" in wide.columns:
        hyg = wide["HYG"].dropna()
        if len(hyg) >= 50:
            ma50 = float(hyg.tail(50).mean())
            s["hyg_vs_50dma"]    = (float(hyg.iloc[-1]) - ma50) / ma50 * 100
            s["hyg_above_50dma"] = float(hyg.iloc[-1]) > ma50
        if len(hyg) >= 200:
            s["hyg_above_200dma"] = float(hyg.iloc[-1]) > float(hyg.tail(200).mean())

    # HYG/LQD cross-credit ratio (HY vs IG spread proxy)
    if "HYG" in wide.columns and "LQD" in wide.columns:
        both  = wide[["HYG", "LQD"]].dropna()
        if len(both) >= 2:
            ratio = both["HYG"] / both["LQD"]
            s["hyg_lqd_ratio"] = float(ratio.iloc[-1])
            if len(ratio) >= 5:
                s["hyg_lqd_ratio_1w_chg"] = (ratio.iloc[-1] / ratio.iloc[-5] - 1) * 100
            if len(ratio) >= 63:
                mean = ratio.tail(63).mean()
                std  = ratio.tail(63).std()
                if std > 0:
                    s["hyg_lqd_z"] = float((ratio.iloc[-1] - mean) / std)

    return s


def _credit_regime(signals: dict) -> tuple[str, str]:
    """Return (label, color) based on spread signals."""
    bear = 0
    bull = 0

    hyg_1m = signals.get("hyg_1m", 0.0)
    if hyg_1m < -3:   bear += 2
    elif hyg_1m < -1: bear += 1
    elif hyg_1m > 1:  bull += 1

    above50 = signals.get("hyg_above_50dma")
    if above50 is not None:
        if not above50: bear += 1
        else:           bull += 1

    z = signals.get("hyg_lqd_z", 0.0)
    if z < -1.5:   bear += 2
    elif z < -0.5: bear += 1
    elif z > 0.5:  bull += 1

    if bear >= 3:
        return "Spreads Widening",   "#e74c3c"
    if bear >= 1 and bear > bull:
        return "Widening Risk",      "#e67e22"
    if bull >= 2:
        return "Spreads Tightening", "#2ecc71"
    return "Neutral / Range-Bound",  "#8899aa"


# ─────────────────────────────────────────────────────────────────────────────
# Chart builders
# ─────────────────────────────────────────────────────────────────────────────

def _indexed_chart(wide: pd.DataFrame, lookback: int) -> go.Figure:
    """Indexed price chart (base = 100) for HYG, LQD, TLT, EMB."""
    df = wide.tail(lookback).copy()
    fig = go.Figure()
    for sym in ("HYG", "LQD", "TLT", "EMB"):
        if sym not in df.columns:
            continue
        s = df[sym].dropna()
        if s.empty:
            continue
        idx = s / s.iloc[0] * 100
        fig.add_trace(go.Scatter(
            x=idx.index, y=idx.values, name=sym,
            line=dict(color=_COLORS[sym], width=1.8),
            hovertemplate=f"<b>{sym}</b><br>%{{x|%b %d, %Y}}<br>Indexed: %{{y:.1f}}<extra></extra>",
        ))
    fig.add_hline(y=100, line=dict(color="#484f58", width=1, dash="dot"))
    layout = dict(**_DARK)
    layout["title"] = dict(
        text=f"Credit ETFs — Indexed to 100 ({lookback}d)",
        font=dict(size=12, color="#8899aa"), x=0,
    )
    layout["yaxis"] = dict(**_DARK["yaxis"], title="Index (base=100)")
    fig.update_layout(**layout)
    return fig


def _ratio_chart(wide: pd.DataFrame, lookback: int) -> go.Figure:
    """HYG/LQD ratio (HY vs IG spread proxy)."""
    if "HYG" not in wide.columns or "LQD" not in wide.columns:
        return go.Figure()
    both  = wide[["HYG", "LQD"]].dropna().tail(lookback)
    ratio = (both["HYG"] / both["LQD"])
    if ratio.empty:
        return go.Figure()
    mean = float(ratio.mean())
    fig  = go.Figure()
    fig.add_trace(go.Scatter(
        x=ratio.index, y=ratio.values,
        name="HYG / LQD",
        line=dict(color=_COLORS["HYG"], width=2),
        fill="tozeroy",
        fillcolor="rgba(224,92,92,0.07)",
        hovertemplate="<b>HYG/LQD</b><br>%{x|%b %d, %Y}<br>%{y:.4f}<extra></extra>",
    ))
    fig.add_hline(
        y=mean,
        line=dict(color="#484f58", width=1, dash="dot"),
        annotation_text=f"{lookback}d avg: {mean:.4f}",
        annotation=dict(font_size=9, font_color="#484f58"),
    )
    layout = dict(**_DARK)
    layout["title"] = dict(
        text="HYG / LQD — HY vs IG Spread Proxy",
        font=dict(size=12, color="#8899aa"), x=0,
    )
    layout["yaxis"] = dict(**_DARK["yaxis"], title="Ratio")
    fig.update_layout(**layout)
    return fig


def _credit_vol_chart(wide: pd.DataFrame, lookback: int) -> go.Figure:
    """HYG price + VIXY dual-axis overlay."""
    if "HYG" not in wide.columns or "VIXY" not in wide.columns:
        return go.Figure()
    df   = wide.tail(lookback)
    hyg  = df["HYG"].dropna()
    vixy = df["VIXY"].dropna()
    if hyg.empty or vixy.empty:
        return go.Figure()
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=hyg.index, y=hyg.values,
        name="HYG", yaxis="y",
        line=dict(color=_COLORS["HYG"], width=1.8),
        hovertemplate="<b>HYG</b><br>%{x|%b %d}<br>$%{y:.2f}<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=vixy.index, y=vixy.values,
        name="VIXY (vol proxy)", yaxis="y2",
        line=dict(color=_COLORS["VIXY"], width=1.4, dash="dot"),
        hovertemplate="<b>VIXY</b><br>%{x|%b %d}<br>$%{y:.2f}<extra></extra>",
    ))
    layout = dict(**_DARK)
    layout["title"] = dict(
        text="HYG vs Volatility (VIXY) — Dual Axis",
        font=dict(size=12, color="#8899aa"), x=0,
    )
    layout["yaxis"]  = dict(
        title="HYG ($)", gridcolor="#21262d", linecolor="#21262d",
        titlefont=dict(color=_COLORS["HYG"]),
        tickfont=dict(color=_COLORS["HYG"]),
    )
    layout["yaxis2"] = dict(
        title="VIXY ($)", overlaying="y", side="right",
        showgrid=False, gridcolor="rgba(0,0,0,0)",
        titlefont=dict(color=_COLORS["VIXY"]),
        tickfont=dict(color=_COLORS["VIXY"]),
    )
    layout["legend"] = dict(
        bgcolor="rgba(0,0,0,0)", font=dict(size=10),
        orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0,
    )
    fig.update_layout(**layout)
    return fig


# ─────────────────────────────────────────────────────────────────────────────
# HTML helpers
# ─────────────────────────────────────────────────────────────────────────────

def _kpi_card(label: str, value_str: str, sub_str: str, color: str) -> str:
    return (
        f'<div style="background:#161b22;border:0.5px solid #21262d;border-radius:6px;'
        f'padding:12px 14px">'
        f'<div style="font-size:10px;font-weight:600;text-transform:uppercase;'
        f'letter-spacing:0.4px;color:#8899aa;margin-bottom:6px">{label}</div>'
        f'<div style="font-size:20px;font-weight:700;color:{color};'
        f'font-variant-numeric:tabular-nums;letter-spacing:-0.5px">{value_str}</div>'
        f'<div style="font-size:10px;color:#484f58;margin-top:4px">{sub_str}</div>'
        f'</div>'
    )


def _signal_row(name: str, status: str, status_color: str, detail: str) -> str:
    return (
        f'<div style="display:flex;align-items:center;justify-content:space-between;'
        f'padding:9px 12px;background:#161b22;border:0.5px solid #21262d;'
        f'border-radius:6px;margin-bottom:6px">'
        f'<span style="font-size:12px;color:#c9d1d9">{name}</span>'
        f'<div style="display:flex;align-items:center;gap:8px">'
        f'<span style="font-size:10px;color:#484f58">{detail}</span>'
        f'<span style="font-size:11px;font-weight:700;color:{status_color};'
        f'min-width:120px;text-align:right">{status}</span>'
        f'</div></div>'
    )


def _fmt_pct(v: float | None, decimals: int = 2) -> tuple[str, str]:
    if v is None:
        return "—", "#8899aa"
    sign  = "+" if v >= 0 else ""
    color = "#3fb950" if v >= 0 else "#e74c3c"
    return f"{sign}{v:.{decimals}f}%", color


# ─────────────────────────────────────────────────────────────────────────────
# Narrative
# ─────────────────────────────────────────────────────────────────────────────

def _narrative(regime_label: str, signals: dict) -> str:
    parts = []

    if "Widening" in regime_label:
        parts.append(
            "Credit spreads are <b>widening</b> — HYG is underperforming its recent "
            "trend and trading at a discount to investment-grade proxies. This signals "
            "rising risk premiums in high-yield credit, typically associated with tightening "
            "financial conditions or deteriorating growth expectations."
        )
    elif "Tightening" in regime_label:
        parts.append(
            "Credit spreads are <b>tightening</b> — HYG is trading above key trend levels "
            "and outperforming IG. Strong risk appetite in credit is consistent with a "
            "Goldilocks or early-expansion macro environment."
        )
    else:
        parts.append(
            "Credit markets are in a <b>neutral / range-bound</b> phase. HY and IG bond "
            "proxies are broadly tracking each other, with no significant spread widening "
            "or tightening evident."
        )

    hyg_1m = signals.get("hyg_1m")
    if hyg_1m is not None:
        dir_str = "gained" if hyg_1m >= 0 else "lost"
        parts.append(f"HYG has <b>{dir_str} {abs(hyg_1m):.1f}%</b> over the past month.")

    z = signals.get("hyg_lqd_z")
    if z is not None and abs(z) >= 1.0:
        dir_str = "below" if z < 0 else "above"
        desc    = "HY underperformance vs IG" if z < 0 else "HY outperformance vs IG"
        parts.append(
            f"The HYG/LQD ratio is <b>{abs(z):.1f}σ {dir_str}</b> its 3-month average "
            f"— an unusual {desc} signal."
        )

    above50 = signals.get("hyg_above_50dma")
    vs50    = signals.get("hyg_vs_50dma")
    if above50 is not None:
        trend_str = "above" if above50 else "below"
        vs50_str  = f" ({vs50:+.1f}% vs avg)" if vs50 is not None else ""
        parts.append(f"HYG is currently trading <b>{trend_str} its 50-day moving average</b>{vs50_str}.")

    return " ".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Main renderer
# ─────────────────────────────────────────────────────────────────────────────

def render_credit_spreads() -> None:
    """Render the Credit Spreads tab."""

    if not has_market_data():
        st.info(
            "No market data loaded. Run the data pipeline first:\n"
            "```\npython src/market_data/fetch_market.py --mode backfill\n```"
        )
        return

    wide = _load_wide(lookback_days=252)
    if wide.empty or "HYG" not in wide.columns:
        st.warning("Credit ETF data (HYG, LQD) not found in the database.")
        return

    signals      = _compute_signals(wide)
    regime_label, regime_color = _credit_regime(signals)
    latest_date  = wide.index[-1].strftime("%b %d, %Y")

    # ── Lookback selector ────────────────────────────────────────────────────
    lookback_opt = {"30d": 30, "90d": 90, "1Y": 252}
    lb_col, _, date_col = st.columns([2, 5, 2])
    with lb_col:
        lb_label = st.selectbox(
            "Chart window", list(lookback_opt.keys()), index=1,
            key="cs_lookback", label_visibility="collapsed",
        )
    lookback = lookback_opt[lb_label]
    with date_col:
        st.markdown(
            f'<div style="text-align:right;font-size:10px;color:#484f58;padding-top:8px">'
            f'as of {latest_date}</div>',
            unsafe_allow_html=True,
        )

    # ── Credit regime badge ───────────────────────────────────────────────────
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;margin-top:4px">'
        f'<span style="font-size:11px;font-weight:600;text-transform:uppercase;'
        f'letter-spacing:0.5px;color:#8899aa">Credit Regime</span>'
        f'<span style="border:0.5px solid {regime_color}55;color:{regime_color};'
        f'font-weight:700;font-size:15px;padding:4px 14px;border-radius:5px;'
        f'background:rgba(0,0,0,0.25)">{regime_label}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # ── KPI strip ────────────────────────────────────────────────────────────
    section_header("Credit ETF Performance")

    k1, k2, k3, k4, k5 = st.columns(5)

    hyg_1d_s, hyg_1d_c = _fmt_pct(signals.get("hyg_1d"))
    lqd_1d_s, lqd_1d_c = _fmt_pct(signals.get("lqd_1d"))
    emb_1d_s, emb_1d_c = _fmt_pct(signals.get("emb_1d"))
    hyg_1m_s, hyg_1m_c = _fmt_pct(signals.get("hyg_1m"))

    ratio_v   = signals.get("hyg_lqd_ratio")
    ratio_s   = f"{ratio_v:.4f}" if ratio_v is not None else "—"
    ratio_1w  = signals.get("hyg_lqd_ratio_1w_chg")
    ratio_sub = f"1W chg: {ratio_1w:+.2f}%" if ratio_1w is not None else "HY vs IG ratio"
    ratio_c   = "#3fb950" if (ratio_1w or 0) >= 0 else "#e74c3c"

    with k1: st.markdown(_kpi_card("HYG 1D",   hyg_1d_s, "High Yield ETF",   hyg_1d_c), unsafe_allow_html=True)
    with k2: st.markdown(_kpi_card("LQD 1D",   lqd_1d_s, "Invest. Grade ETF", lqd_1d_c), unsafe_allow_html=True)
    with k3: st.markdown(_kpi_card("EMB 1D",   emb_1d_s, "EM Bond ETF",       emb_1d_c), unsafe_allow_html=True)
    with k4: st.markdown(_kpi_card("HYG 1M",   hyg_1m_s, "HY 1-month return", hyg_1m_c), unsafe_allow_html=True)
    with k5: st.markdown(_kpi_card("HYG/LQD",  ratio_s,  ratio_sub,           ratio_c),  unsafe_allow_html=True)

    st.markdown("<div style='margin-top:10px'></div>", unsafe_allow_html=True)

    # ── Charts row ────────────────────────────────────────────────────────────
    section_header(f"Credit Performance — {lb_label} View")
    c1, c2 = st.columns(2)
    with c1:
        st.plotly_chart(
            _indexed_chart(wide, lookback),
            use_container_width=True, config={"displayModeBar": False},
        )
    with c2:
        st.plotly_chart(
            _ratio_chart(wide, lookback),
            use_container_width=True, config={"displayModeBar": False},
        )

    # ── Spread signals ────────────────────────────────────────────────────────
    section_header("Spread Signals")
    sc1, sc2, sc3 = st.columns(3)

    with sc1:
        above50 = signals.get("hyg_above_50dma")
        vs50    = signals.get("hyg_vs_50dma")
        if above50 is not None:
            sl  = "Above 50 DMA" if above50 else "Below 50 DMA"
            sc  = "#3fb950" if above50 else "#e74c3c"
            det = f"{vs50:+.2f}% vs avg" if vs50 is not None else ""
        else:
            sl, sc, det = "—", "#8899aa", "Insufficient data"
        st.markdown(_signal_row("HYG Trend (50 DMA)", sl, sc, det), unsafe_allow_html=True)

    with sc2:
        z = signals.get("hyg_lqd_z")
        if z is not None:
            if abs(z) >= 1.5:
                sl, sc = "Elevated Divergence", "#e67e22"
            elif abs(z) >= 0.5:
                sl, sc = "Mild Divergence",     "#d29922"
            else:
                sl, sc = "Tracking",            "#3fb950"
            det = f"z-score: {z:+.2f}σ (3M)"
        else:
            sl, sc, det = "—", "#8899aa", "Insufficient data"
        st.markdown(_signal_row("HY vs IG (HYG/LQD)", sl, sc, det), unsafe_allow_html=True)

    with sc3:
        emb_1m_v = signals.get("emb_1m")
        hyg_1m_v = signals.get("hyg_1m")
        if emb_1m_v is not None and hyg_1m_v is not None:
            diff = emb_1m_v - hyg_1m_v
            if diff > 0.5:
                sl, sc = "EM Outperforming", "#3fb950"
            elif diff < -0.5:
                sl, sc = "EM Underperforming", "#e74c3c"
            else:
                sl, sc = "Tracking US HY",     "#8899aa"
            det = f"EMB vs HYG 1M: {diff:+.1f}pp"
        else:
            sl, sc, det = "—", "#8899aa", "Insufficient data"
        st.markdown(_signal_row("EM Credit (EMB vs HYG)", sl, sc, det), unsafe_allow_html=True)

    st.markdown("<div style='margin-top:10px'></div>", unsafe_allow_html=True)

    # ── Credit vs volatility chart ────────────────────────────────────────────
    if "VIXY" in wide.columns and not wide["VIXY"].dropna().empty:
        section_header("Credit vs Volatility")
        st.plotly_chart(
            _credit_vol_chart(wide, lookback),
            use_container_width=True, config={"displayModeBar": False},
        )

    # ── Narrative ─────────────────────────────────────────────────────────────
    section_header("Credit Market Interpretation")
    st.markdown(
        f'<div style="background:#161b22;border:0.5px solid #21262d;border-radius:6px;'
        f'padding:14px 16px;font-size:13px;line-height:1.75;color:#c9d1d9">'
        f'{_narrative(regime_label, signals)}'
        f'</div>',
        unsafe_allow_html=True,
    )

    # ── Methodology note ──────────────────────────────────────────────────────
    st.markdown(
        '<div style="margin-top:10px;font-size:10px;color:#3d444d">'
        'Proxies: HYG = iShares HY Corp Bond ETF · LQD = iShares IG Corp Bond ETF · '
        'EMB = iShares EM Bond ETF · VIXY = ProShares VIX Short-Term Futures ETF. '
        'HYG/LQD ratio used as a cross-credit spread proxy (not a direct OAS measure). '
        'For true option-adjusted spreads, load FRED series BAMLH0A0HYM2 / BAMLC0A0CM.'
        '</div>',
        unsafe_allow_html=True,
    )
