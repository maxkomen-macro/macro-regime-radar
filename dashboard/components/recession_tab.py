"""
dashboard/components/recession_tab.py
Recession Risk tab — Phase 8.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import pandas as pd
import altair as alt
import streamlit as st
import streamlit.components.v1 as components

# ── Caching ──────────────────────────────────────────────────────────────────

@st.cache_resource
def _get_trained_model():
    """Cache sklearn objects across sessions (not serializable via cache_data)."""
    from src.analytics.recession import train_recession_model
    return train_recession_model()


@st.cache_data(ttl=3600)
def _get_recession_data():
    """Cache serializable metrics for 1 hour."""
    from src.analytics.recession import get_recession_metrics
    return get_recession_metrics()


# ── Constants ─────────────────────────────────────────────────────────────────

INVERSION_EPISODES = [
    ("1998-08-01", "1998-12-01", "2001 recession"),
    ("2000-07-01", "2001-01-01", "2001 recession"),
    ("2006-01-01", "2007-06-01", "2008 recession"),
    ("2022-07-01", "2024-05-01", "no recession yet"),
]

_ALTAIR_CFG = dict(
    stroke_width=0,
    grid_color="#30363d",
    label_color="#8b949e",
    title_color="#8b949e",
    domain_color="#30363d",
    title_font_size=12,
    title_font_color="#e6edf3",
    legend_label="#8b949e",
)

_CARD_STYLE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0d1117;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #e6edf3;
}
.card {
  background: #161b22;
  border: 0.5px solid #30363d;
  border-radius: 6px;
  padding: 14px 16px;
  height: 100%;
}
.card-accent { border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8b949e; margin-bottom: 6px; }
.value { font-size: 28px; font-weight: 700; line-height: 1; }
.sub   { font-size: 11px; color: #8b949e; margin-top: 6px; }
.context { font-size: 10px; color: #586069; margin-top: 4px; }
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.progress-wrap { background: #30363d; border-radius: 4px; height: 6px; margin: 4px 0 2px; }
.progress-bar  { border-radius: 4px; height: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { color: #8b949e; text-align: left; padding: 4px 6px; border-bottom: 1px solid #30363d; font-weight: 500; font-size: 10px; text-transform: uppercase; }
td { padding: 5px 6px; border-bottom: 0.5px solid #21262d; }
"""


def _altair_dark(chart: alt.Chart) -> alt.Chart:
    return (
        chart
        .configure_view(strokeWidth=0, fill="transparent")
        .configure_axis(
            gridColor="#30363d",
            labelColor="#8b949e",
            titleColor="#8b949e",
            domainColor="#30363d",
        )
        .configure_title(color="#e6edf3", fontSize=12)
        .configure_legend(labelColor="#8b949e", titleColor="#8b949e")
    )


def _html(body: str, height: int) -> None:
    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_CARD_STYLE}</style></head>
<body>{body}</body></html>""",
        height=height,
        scrolling=False,
    )


def _section_header(title: str, color: str = "#4a9eff") -> None:
    st.markdown(
        f'<div style="border-left:3px solid {color};padding-left:8px;margin:12px 0 8px;">'
        f'<span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;'
        f'color:#8b949e;font-weight:600;">{title}</span></div>',
        unsafe_allow_html=True,
    )


def _gauge_svg(prob: float, color: str) -> str:
    """Render a semicircular SVG gauge showing recession probability (0-100)."""
    import math
    ARC_LEN  = math.pi * 80
    fill_len = ARC_LEN * (prob / 100.0)
    gap_len  = ARC_LEN - fill_len + 1000
    g_end    = ARC_LEN * 0.33
    o_end    = ARC_LEN * 0.60
    angle_rad = math.radians(180.0 - (prob / 100.0) * 180.0)
    nx = round(100 + 65 * math.cos(angle_rad), 2)
    ny = round(100 - 65 * math.sin(angle_rad), 2)
    fill_color = "#2ecc71" if prob < 33 else "#e67e22" if prob < 60 else "#e74c3c"
    return (
        f'<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg"'
        f' style="width:100%;max-width:200px;display:block;margin:0 auto;">'
        f'<path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#30363d"'
        f' stroke-width="12" stroke-linecap="round"/>'
        f'<path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#2ecc7133"'
        f' stroke-width="12" stroke-linecap="round"'
        f' stroke-dasharray="{g_end:.1f} {ARC_LEN - g_end + 1000:.1f}"/>'
        f'<path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e67e2233"'
        f' stroke-width="12" stroke-linecap="round"'
        f' stroke-dasharray="{o_end - g_end:.1f} {ARC_LEN - (o_end - g_end) + 1000:.1f}"'
        f' stroke-dashoffset="{-g_end:.1f}"/>'
        f'<path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e74c3c33"'
        f' stroke-width="12" stroke-linecap="round"'
        f' stroke-dasharray="{ARC_LEN - o_end:.1f} 1000"'
        f' stroke-dashoffset="{-o_end:.1f}"/>'
        f'<path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="{fill_color}"'
        f' stroke-width="12" stroke-linecap="round"'
        f' stroke-dasharray="{fill_len:.1f} {gap_len:.1f}"/>'
        f'<line x1="100" y1="100" x2="{nx}" y2="{ny}"'
        f' stroke="{color}" stroke-width="2.5" stroke-linecap="round"/>'
        f'<circle cx="100" cy="100" r="4" fill="{color}"/>'
        f'<text x="100" y="82" text-anchor="middle"'
        f' font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif"'
        f' font-size="22" font-weight="700" fill="{color}">{prob:.1f}%</text>'
        f'<text x="18" y="112" text-anchor="middle" font-size="8" fill="#586069"'
        f' font-family="sans-serif">0</text>'
        f'<text x="182" y="112" text-anchor="middle" font-size="8" fill="#586069"'
        f' font-family="sans-serif">100</text>'
        f'</svg>'
    )


# ── Public: compact summary for Dashboard tab ─────────────────────────────────

def render_recession_summary() -> None:
    """Compact 3-metric row injected into the Dashboard tab."""
    m = _get_recession_data()
    if m["recession_prob"] is None:
        return

    prob  = m["recession_prob"]
    label = m["recession_label"]
    color = m["recession_color"]
    spread_bps = m["yield_curve_spread"]
    spread_str = f"{spread_bps:+.0f} bps" if spread_bps is not None else "N/A"
    spread_color = "#e74c3c" if (spread_bps is not None and spread_bps < 0) else "#2ecc71"
    div_label = m["divergence_label"]
    div_color = m["divergence_color"]

    _html(f"""
<div style="display:flex;gap:8px;align-items:stretch;height:64px;margin-top:12px;margin-bottom:12px;">
  <div style="background:#161b22;border:0.5px solid #30363d;border-left:3px solid {color};
              border-radius:0 6px 6px 0;padding:10px 14px;flex:1;display:flex;align-items:center;gap:10px;">
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;">Recession Risk</span>
    <span class="badge" style="background:{color}22;color:{color};">{label}</span>
    <span style="font-size:20px;font-weight:700;color:{color};">{prob:.1f}%</span>
  </div>
  <div style="background:#161b22;border:0.5px solid #30363d;border-left:3px solid {spread_color};
              border-radius:0 6px 6px 0;padding:10px 14px;flex:1;display:flex;align-items:center;gap:10px;">
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;">Yield Curve 2s10s</span>
    <span style="font-size:20px;font-weight:700;color:{spread_color};">{spread_str}</span>
  </div>
  <div style="background:#161b22;border:0.5px solid #30363d;border-left:3px solid {div_color};
              border-radius:0 6px 6px 0;padding:10px 14px;flex:1;display:flex;align-items:center;gap:10px;">
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;">Macro Divergence</span>
    <span class="badge" style="background:{div_color}22;color:{div_color};">{div_label}</span>
  </div>
</div>""", height=82)


def _generate_interpretation(m: dict) -> str:
    """Generate a 2-3 sentence plain-English read-through of current recession metrics."""
    prob       = m["recession_prob"]
    color      = m["recession_color"]
    spread_bps = m["yield_curve_spread"]
    inv_dur    = m["inversion_duration_months"] or 0
    div_label  = m["divergence_label"]
    div_score  = m["divergence_score"] or 0.0

    if prob < 20:
        p_sent = (
            f"The model assigns a <b style='color:{color}'>{prob:.1f}% recession probability</b> "
            f"— below the historical base rate of ~15%, consistent with ongoing expansion."
        )
    elif prob < 40:
        p_sent = (
            f"The model assigns an <b style='color:{color}'>elevated {prob:.1f}% recession probability</b> "
            f"— above the historical base rate, warranting closer monitoring."
        )
    else:
        p_sent = (
            f"The model assigns a <b style='color:{color}'>high {prob:.1f}% recession probability</b> "
            f"— well above the historical base rate, signaling material deterioration."
        )

    if spread_bps is not None and spread_bps < 0:
        yc_sent = (
            f" The 2s10s yield curve is inverted at {spread_bps:+.0f} bps"
            + (f", persisting for {inv_dur} months." if inv_dur > 0 else ".")
            + " Sustained inversion has preceded every post-1970 US recession."
        )
    elif spread_bps is not None:
        yc_sent = (
            f" The 2s10s yield curve is positively sloped at {spread_bps:+.0f} bps, "
            f"a neutral-to-supportive signal for near-term growth."
        )
    else:
        yc_sent = ""

    if abs(div_score) > 20:
        div_sent = (
            f" The macro/market divergence indicator shows <b>{div_label}</b> "
            f"({div_score:+.0f} pts) — one signal is leading the other."
        )
    else:
        div_sent = (
            f" HY credit spreads and the macro model are broadly <b>Aligned</b>, "
            f"reducing false-signal risk."
        )

    return (
        f'<div style="background:#161b22;border:0.5px solid #30363d;'
        f'border-left:3px solid #4a9eff;border-radius:0 6px 6px 0;'
        f'padding:12px 16px;margin:10px 0 4px;">'
        f'<div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;'
        f'color:#8b949e;margin-bottom:6px;">CURRENT READ-THROUGH</div>'
        f'<p style="font-size:13px;color:#c9d1d9;line-height:1.7;margin:0;">'
        f'{p_sent}{yc_sent}{div_sent}</p></div>'
    )


# ── Public: full tab render ───────────────────────────────────────────────────

def render() -> None:
    m = _get_recession_data()

    # ── SECTION 1: Status bar ─────────────────────────────────────────────────
    if m["recession_label"] == "No data":
        st.info(
            "Recession metrics unavailable. Run `python main.py` then "
            "`python -m src.analytics.recession` to populate the required series "
            "(USREC, USSLIND, BAMLH0A0HYM2)."
        )
        return

    prob  = m["recession_prob"]
    label = m["recession_label"]
    color = m["recession_color"]

    st.markdown(
        f"""<div style="display:flex;justify-content:space-between;align-items:center;
        background:#161b22;border:0.5px solid #30363d;border-radius:6px;
        padding:10px 16px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="badge" style="background:{color}22;color:{color};
            padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600;">
            {label}</span>
            <span style="font-size:22px;font-weight:700;color:{color};">{prob:.1f}%</span>
            <span style="font-size:12px;color:#8b949e;">12-month recession probability</span>
          </div>
          <span style="font-size:11px;color:#586069;">
            Logistic regression · trained on NBER recession dates · updated daily
          </span>
        </div>""",
        unsafe_allow_html=True,
    )

    # ── SECTION 2: KPI cards ──────────────────────────────────────────────────
    _section_header("Key Risk Indicators")
    col1, col2, col3 = st.columns(3)

    spread_bps  = m["yield_curve_spread"]
    spread_str  = f"{spread_bps:+.0f}" if spread_bps is not None else "N/A"
    spread_color= "#e74c3c" if (spread_bps is not None and spread_bps < 0) else "#2ecc71"
    inv_dur     = m["inversion_duration_months"] or 0
    pct_rank    = m["yield_curve_pct_rank"] if m["yield_curve_pct_rank"] is not None else 50
    div_label   = m["divergence_label"]
    div_color   = m["divergence_color"]
    div_score   = m["divergence_score"] or 0.0

    with col1:
        gauge_svg = _gauge_svg(prob, color)
        _html(f"""
<div class="card card-accent" style="--accent:{color}">
  <div class="label">Recession Probability</div>
  {gauge_svg}
  <div class="sub" style="text-align:center;margin-top:4px;">12-month recession probability</div>
  <div class="context" style="text-align:center;">Historical base rate ~15% · 2008 peak ~89%</div>
</div>""", height=200)

    with col2:
        inv_note = (
            f'<span style="color:#e74c3c;">Inverted {inv_dur} months</span>'
            if m["is_inverted"]
            else f'<span style="color:#2ecc71;">{pct_rank}th pct vs 30yr history</span>'
        )
        _html(f"""
<div class="card card-accent" style="--accent:{spread_color}">
  <div class="label">Yield Curve 2s10s</div>
  <div class="value" style="color:{spread_color};">{spread_str} bps</div>
  <div class="sub">10Y minus 2Y Treasury spread</div>
  <div class="context">{inv_note}</div>
</div>""", height=130)

    with col3:
        _html(f"""
<div class="card card-accent" style="--accent:{div_color}">
  <div class="label">Macro Divergence</div>
  <div class="value" style="font-size:20px;color:{div_color};">{div_label}</div>
  <div class="sub">Market pricing vs macro data ({div_score:+.0f})</div>
  <div class="context">
    {'Markets more stressed than macro data suggests' if div_score > 20
     else 'Data more stressed than markets reflect' if div_score < -20
     else 'HY spreads and macro signals broadly aligned'}
  </div>
</div>""", height=130)

    st.markdown(_generate_interpretation(m), unsafe_allow_html=True)

    # ── SECTION 3: Recession probability chart ────────────────────────────────
    st.divider()
    _section_header("Recession Probability — Model Output")

    prob_series = m["recession_prob_series"]
    usrec_series= m["usrec_series"]

    if not prob_series.empty:
        # Build NBER recession bands from usrec_series
        rec_bands = _build_recession_bands(usrec_series)

        prob_df = prob_series.reset_index()
        prob_df.columns = ["date", "prob"]
        prob_df["date"] = pd.to_datetime(prob_df["date"])

        base_line = alt.Chart(prob_df).mark_line(
            color="#4a9eff", strokeWidth=1.8
        ).encode(
            x=alt.X("date:T", title="Date"),
            y=alt.Y(
                "prob:Q",
                title="Recession Probability (%)",
                scale=alt.Scale(domain=[0, 100]),
                axis=alt.Axis(values=[0, 20, 40, 60, 80, 100]),
            ),
        )

        rule_50 = alt.Chart(pd.DataFrame({"y": [50]})).mark_rule(
            color="#8b949e", strokeDash=[4, 4], strokeWidth=1
        ).encode(y="y:Q")

        rule_cur = alt.Chart(pd.DataFrame({"y": [prob]})).mark_rule(
            color=color, strokeDash=[4, 4], strokeWidth=1
        ).encode(y="y:Q")

        # Build recession bands first so they render UNDER the probability line
        # Use data-domain values (not pixel constants) so the shared y scale is not inverted
        rec_bands_list = []
        if rec_bands:
            for band_df in rec_bands:
                band_df = band_df.copy()
                band_df["y_min"] = 0
                band_df["y_max"] = 100
                band = alt.Chart(band_df).mark_rect(
                    color="#e74c3c", opacity=0.15
                ).encode(
                    x="start:T",
                    x2="end:T",
                    y="y_min:Q",
                    y2="y_max:Q",
                )
                rec_bands_list.append(band)

        # Bands FIRST → blue line renders on top
        layers = [*rec_bands_list, base_line, rule_50, rule_cur]

        chart = alt.layer(*layers).properties(
            title="Model recession probability — 1995 to present",
            height=280,
        )
        st.altair_chart(_altair_dark(chart), use_container_width=True)

    # ── SECTION 4: Yield curve monitor ────────────────────────────────────────
    st.divider()
    _section_header("Yield Curve Monitor")
    yc_col, ctx_col = st.columns([2, 1])

    with yc_col:
        yc_series = m["yield_curve_series"]
        if not yc_series.empty:
            cutoff = pd.Timestamp.today() - pd.DateOffset(years=30)
            yc_daily = yc_series[yc_series.index >= cutoff].dropna()

            yc_df = yc_daily.reset_index()
            yc_df.columns = ["date", "spread"]
            yc_df["date"] = pd.to_datetime(yc_df["date"])

            yc_line = alt.Chart(yc_df).mark_line(
                color="#4a9eff", strokeWidth=1.2
            ).encode(
                x=alt.X("date:T", title="Date"),
                y=alt.Y("spread:Q", title="2s10s Spread (%)",
                        scale=alt.Scale(domain=[-1.5, 3.5])),
            )

            zero_rule = alt.Chart(pd.DataFrame({"y": [0]})).mark_rule(
                color="#e74c3c", strokeDash=[3, 3], strokeWidth=1
            ).encode(y="y:Q")

            # Red shading below 0
            yc_below = yc_df.copy()
            yc_below["zero"] = 0.0
            area_inv = alt.Chart(yc_below).mark_area(
                color="#e74c3c", opacity=0.12
            ).encode(
                x="date:T",
                y=alt.Y("zero:Q"),
                y2=alt.Y2("spread:Q"),
            ).transform_filter(alt.datum.spread < 0)

            # Build NBER recession bands first → render UNDER the yield curve line
            # Use data-domain y values to avoid inverting the shared y scale
            rec_bands_yc = _build_recession_bands(usrec_series)
            rec_band_layers_yc = []
            for bd in rec_bands_yc:
                bd = bd.copy()
                bd["y_min"] = -1.5
                bd["y_max"] = 3.5
                rec_band_layers_yc.append(
                    alt.Chart(bd).mark_rect(color="#e74c3c", opacity=0.12).encode(
                        x="start:T", x2="end:T", y="y_min:Q", y2="y_max:Q"
                    )
                )
            # Bands FIRST → area, line, zero rule render on top
            layers_yc = [*rec_band_layers_yc, area_inv, yc_line, zero_rule]

            yc_chart = alt.layer(*layers_yc).properties(
                title="2s10s yield curve spread — 30yr history",
                height=260,
            )
            st.altair_chart(_altair_dark(yc_chart), use_container_width=True)

        # ── Yield curve shape snapshot ────────────────────────────────────────
        curve_shape = m.get("curve_shape", {})
        _tenor_order = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"]
        shape_rows = [
            {"tenor": t, "yield": curve_shape[t]}
            for t in _tenor_order
            if curve_shape.get(t) is not None
        ]
        if len(shape_rows) >= 2:
            shape_df = pd.DataFrame(shape_rows)
            shape_line = alt.Chart(shape_df).mark_line(
                color="#4a9eff", strokeWidth=1.8,
                point=alt.OverlayMarkDef(color="#4a9eff", size=40),
            ).encode(
                x=alt.X("tenor:O", sort=_tenor_order, title="Maturity"),
                y=alt.Y("yield:Q", title="Yield (%)",
                        scale=alt.Scale(zero=False)),
                tooltip=["tenor:O", alt.Tooltip("yield:Q", format=".2f")],
            )
            shape_chart = alt.layer(shape_line).properties(
                title="Current yield curve shape",
                height=140,
            )
            st.altair_chart(_altair_dark(shape_chart), use_container_width=True)

    with ctx_col:
        inv_rows = "".join(
            f"""<tr>
              <td>{s[:7]}–{e[:7]}</td>
              <td style="color:#8b949e;">{note}</td>
            </tr>"""
            for s, e, note in INVERSION_EPISODES
        )
        inv_color = "#e74c3c" if m["is_inverted"] else "#2ecc71"
        inv_txt   = (
            f"Inverted {inv_dur} months" if m["is_inverted"]
            else f"{pct_rank}th pct vs 30yr"
        )
        progress_pct = max(0, min(100, pct_rank))
        _html(f"""
<div class="card" style="padding:14px 16px;">
  <div class="label">Current spread</div>
  <div style="font-size:24px;font-weight:700;color:{spread_color};margin-bottom:6px;">
    {spread_str} bps
  </div>
  <div class="progress-wrap">
    <div class="progress-bar" style="width:{progress_pct}%;background:{spread_color};"></div>
  </div>
  <div style="font-size:11px;color:{inv_color};margin-bottom:14px;">{inv_txt}</div>
  <div class="label" style="margin-top:8px;">Inversion history</div>
  <table>
    <tr><th>Period</th><th>Preceded</th></tr>
    {inv_rows}
  </table>
</div>""", height=330)

    # ── SECTION 5: Sensitivity panel ──────────────────────────────────────────
    st.divider()
    with st.expander("Recession probability sensitivity — adjust inputs", expanded=True):
        model, scaler, feat_names = _get_trained_model()
        if model is None:
            st.warning("Model not available — run python main.py first.")
        else:
            default_spread = int(m["yield_curve_spread"] or 0)
            default_unrate = float(m.get("_current_unrate", 4.0))
            default_hy     = int(m.get("_current_hy_oas", 350))
            default_indpro = float(m.get("_current_indpro_yoy", 0.0))
            default_lei    = float(m.get("_current_lei", 0.0))

            if st.button("Reset to current values", key="rec_reset"):
                st.session_state.pop("rec_yc",    None)
                st.session_state.pop("rec_ur",    None)
                st.session_state.pop("rec_hy",    None)
                st.session_state.pop("rec_ip",    None)
                st.session_state.pop("rec_lei",   None)

            s1, s2, s3 = st.columns(3)
            with s1:
                yc_in = st.slider("Yield curve 2s10s (bps)", -200, 300,
                                  value=default_spread, step=5, key="rec_yc")
                ur_in = st.slider("Unemployment rate (%)", 2.0, 15.0,
                                  value=default_unrate, step=0.1, key="rec_ur")
            with s2:
                hy_in = st.slider("HY OAS (bps)", 100, 2000,
                                  value=default_hy, step=10, key="rec_hy")
                ip_in = st.slider("Industrial production YoY (%)", -20.0, 10.0,
                                  value=default_indpro, step=0.5, key="rec_ip")
            with s3:
                lei_in = st.slider("LEI proxy", -5.0, 5.0,
                                   value=max(-5.0, min(5.0, default_lei)),
                                   step=0.1, key="rec_lei")

            # Recompute probability
            try:
                X_user = np.array([[
                    yc_in / 100.0,   # convert bps → % to match training data
                    ur_in,
                    hy_in,
                    ip_in,
                    lei_in,
                ]])
                X_scaled = scaler.transform(X_user)
                rec_idx  = list(model.classes_).index(1) if 1 in model.classes_ else -1
                adj_prob = float(model.predict_proba(X_scaled)[0, rec_idx]) * 100.0
                adj_lbl, adj_col = _classify(adj_prob)

                st.markdown(
                    f"""<div style="margin-top:12px;padding:14px 20px;background:#161b22;
                    border:0.5px solid #30363d;border-left:4px solid {adj_col};
                    border-radius:0 6px 6px 0;display:flex;align-items:center;gap:16px;">
                      <span style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;
                      color:#8b949e;">Adjusted probability</span>
                      <span style="font-size:32px;font-weight:700;color:{adj_col};">{adj_prob:.1f}%</span>
                      <span class="badge" style="background:{adj_col}22;color:{adj_col};
                      padding:3px 10px;border-radius:12px;font-size:12px;">{adj_lbl}</span>
                      <span style="font-size:11px;color:#8b949e;">
                        vs baseline {prob:.1f}% ({adj_prob - prob:+.1f}pp)
                      </span>
                    </div>""",
                    unsafe_allow_html=True,
                )
            except Exception as exc:
                st.error(f"Sensitivity computation error: {exc}")

    # ── SECTION 6: Model transparency ─────────────────────────────────────────
    st.divider()
    _section_header("Model Transparency")
    left_col, right_col = st.columns(2)

    with left_col:
        coef = m["feature_coefficients"]
        feat_labels = {
            "yield_curve":  "Yield Curve (2s10s)",
            "unemployment": "Unemployment Rate",
            "hy_spread":    "HY OAS",
            "indpro_yoy":   "Industrial Prod. YoY",
            "lei_proxy":    "LEI Proxy",
        }
        # Build current values for display
        cur_vals = {
            "yield_curve":  f"{m['yield_curve_spread']:.0f} bps" if m["yield_curve_spread"] is not None else "N/A",
            "unemployment": f"{m.get('_current_unrate', 0):.1f}%",
            "hy_spread":    f"{m.get('_current_hy_oas', 0):.0f} bps",
            "indpro_yoy":   f"{m.get('_current_indpro_yoy', 0):.1f}%",
            "lei_proxy":    f"{m.get('_current_lei', 0):.2f}",
        }
        sorted_feats = sorted(coef.items(), key=lambda x: abs(x[1]), reverse=True)
        rows_html = "".join(
            f"""<tr>
              <td>{feat_labels.get(f, f)}</td>
              <td style="text-align:right;color:#8b949e;">{cur_vals.get(f,'N/A')}</td>
              <td style="text-align:right;color:{'#2ecc71' if c > 0 else '#4a9eff'};font-weight:600;">
                {c:+.3f}
              </td>
            </tr>"""
            for f, c in sorted_feats
        )
        _html(f"""
<div class="card">
  <div class="label" style="margin-bottom:8px;">Feature Coefficients (logistic regression)</div>
  <table>
    <tr><th>Feature</th><th style="text-align:right;">Current</th><th style="text-align:right;">Coef</th></tr>
    {rows_html}
  </table>
  <div style="font-size:10px;color:#586069;margin-top:8px;">
    Green = recession risk factor · Blue = protective factor
  </div>
</div>""", height=220)

    with right_col:
        n = m["n_training_samples"]
        feats = ", ".join(m["model_features"])
        as_of = m["data_as_of"]
        _html(f"""
<div class="card">
  <div class="label" style="margin-bottom:10px;">Model Metadata</div>
  <table>
    <tr><td style="color:#8b949e;">Training samples</td><td style="text-align:right;">{n} months</td></tr>
    <tr><td style="color:#8b949e;">Features</td><td style="text-align:right;font-size:10px;">{feats}</td></tr>
    <tr><td style="color:#8b949e;">Data as of</td><td style="text-align:right;">{as_of}</td></tr>
    <tr><td style="color:#8b949e;">Look-ahead bias</td><td style="text-align:right;">3-month lag applied</td></tr>
    <tr><td style="color:#8b949e;">Target</td><td style="text-align:right;">NBER USREC indicator</td></tr>
  </table>
  <div style="font-size:10px;color:#586069;margin-top:10px;line-height:1.5;">
    Logistic regression with 3-month lagged inputs to avoid look-ahead bias.
    Trained on NBER recession dates 1990–present.<br><br>
    <strong style="color:#8b949e;">Note:</strong> USREC is updated retroactively — recent
    months may show 0 even if a recession has begun.
    This model is a quantitative indicator, not a forecast.
  </div>
</div>""", height=280)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _classify(p: float) -> tuple[str, str]:
    if p < 20:
        return "Low Risk", "#2ecc71"
    elif p < 40:
        return "Elevated", "#e67e22"
    return "High Risk", "#e74c3c"


def _build_recession_bands(usrec: pd.Series) -> list[pd.DataFrame]:
    """Convert a 0/1 USREC series into a list of {start, end} DataFrames for Altair rect marks."""
    if usrec is None or usrec.empty:
        return []
    bands = []
    in_rec = False
    start  = None
    for dt, val in usrec.items():
        if val == 1 and not in_rec:
            in_rec = True
            start  = dt
        elif val == 0 and in_rec:
            in_rec = False
            bands.append(pd.DataFrame({"start": [start], "end": [dt]}))
    if in_rec and start is not None:
        bands.append(pd.DataFrame({"start": [start], "end": [usrec.index[-1]]}))
    return bands
