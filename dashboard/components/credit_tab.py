"""
dashboard/components/credit_tab.py — Phase 7 Credit Spreads tab.

Sections:
  1. Status bar (credit regime badge + data freshness)
  2. Five OAS spread cards (HY, IG, CCC, BB, B) with 1W changes
  3. Chart row: OAS history (Altair) + HY/IG ratio & distress ratio cards
  4. Three-column analytical row: LBO cost · Conditions logic · Percentile ranks
  5. Regime-conditional asset performance table
  6. Credit regime transition matrix (3M and 6M)

Standalone module — no src.config import.
Uses components.v1.html() for all card rendering (matches market_snapshot.py pattern).
"""

import sys
import sqlite3
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

CREDIT_STATES = ["Normal", "Tight", "Stressed", "Crisis"]

_STATE_COLORS = {
    "Normal":  "#2ecc71",
    "Tight":   "#3498db",
    "Stressed": "#e67e22",
    "Crisis":  "#e74c3c",
    "No data": "#8b949e",
}

# NBER recession dates for chart shading
_RECESSIONS = [
    ("2001-03-01", "2001-11-01"),
    ("2007-12-01", "2009-06-01"),
    ("2020-02-01", "2020-04-01"),
]

# Regime-conditional asset performance (hardcoded research estimates)
_REGIME_RETURNS = {
    "HY Bonds":        {"Goldilocks": +8.4,  "Overheating": +5.2,  "Stagflation": -3.1,  "Recession Risk": -12.8},
    "IG Bonds":        {"Goldilocks": +5.1,  "Overheating": +1.2,  "Stagflation": -1.8,  "Recession Risk":  +6.4},
    "US Equities":     {"Goldilocks": +18.2, "Overheating": +9.4,  "Stagflation": -6.2,  "Recession Risk": -22.1},
    "Leveraged Loans": {"Goldilocks": +6.8,  "Overheating": +4.1,  "Stagflation": -2.4,  "Recession Risk": -15.2},
    "Gold":            {"Goldilocks": +2.1,  "Overheating": +11.4, "Stagflation": +14.2, "Recession Risk":  +8.8},
    "Real Assets":     {"Goldilocks": +4.3,  "Overheating": +12.8, "Stagflation": +9.1,  "Recession Risk":  -5.6},
}

_REGIME_COLS = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]


# ─────────────────────────────────────────────────────────────────────────────
# DB helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _current_regime() -> str | None:
    """Return the most recent regime label from the regimes table."""
    try:
        conn = _get_conn()
        row = conn.execute(
            "SELECT label FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# HTML helpers
# ─────────────────────────────────────────────────────────────────────────────

def _section_header(title: str, accent_color: str = "#4a9eff") -> None:
    """Render a Bloomberg-style section header with left accent bar."""
    st.markdown(
        f"""
        <div style="display:flex;align-items:center;gap:10px;margin:20px 0 12px">
          <div style="width:3px;height:16px;background:{accent_color};
                      border-radius:2px;flex-shrink:0"></div>
          <span style="font-size:10px;font-weight:500;letter-spacing:0.1em;
                       text-transform:uppercase;color:#8b949e">{title}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _fmt_bps(v: float | None, decimals: int = 1) -> str:
    return f"{v:.{decimals}f}" if v is not None else "—"


def _fmt_chg(v: float | None) -> tuple[str, str]:
    """Return (formatted string with ▲/▼ arrow, CSS color). Red = widening = bad."""
    if v is None:
        return "—", "#8b949e"
    arrow = "▲" if v >= 0 else "▼"
    color = "#e74c3c" if v >= 0 else "#2ecc71"  # widening = bad (red)
    return f"{arrow} {abs(v):.1f} bps", color


def _svg_points(sparkline: pd.Series) -> str | None:
    """Compute SVG polyline points string. Returns None if fewer than 2 points."""
    try:
        values = list(sparkline.values)
    except Exception:
        return None
    n = len(values)
    if n < 2:
        return None
    min_v, max_v = min(values), max(values)
    if max_v == min_v:
        return " ".join(f"{i/(n-1)*100:.1f},14" for i in range(n))
    return " ".join(
        f"{i/(n-1)*100:.1f},{24-(v-min_v)/(max_v-min_v)*20:.1f}"
        for i, v in enumerate(values)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section 2: Spread cards
# ─────────────────────────────────────────────────────────────────────────────

def _render_spread_cards(m: dict) -> None:
    """Five OAS spread cards in a single components.html() row."""

    def _accent(key: str, val: float | None) -> str:
        if val is None:
            return "#484f58"
        if key == "HY OAS":
            return "#2ecc71" if val < 400 else ("#e67e22" if val <= 700 else "#e74c3c")
        if key == "IG OAS":
            return "#2ecc71" if val <= 150 else "#e67e22"
        if key in ("CCC OAS", "Distress"):
            return "#e67e22" if val < 700 else "#e74c3c"
        return "#4a9eff"  # BB and B — neutral blue

    cards_data = [
        ("HY OAS",  m.get("hy_oas"),  m.get("hy_1w_change"),  "ICE BofA HY Index",  m.get("hy_sparkline",  pd.Series(dtype=float))),
        ("IG OAS",  m.get("ig_oas"),  m.get("ig_1w_change"),  "ICE BofA IG Corp",   m.get("ig_sparkline",  pd.Series(dtype=float))),
        ("CCC OAS", m.get("ccc_oas"), m.get("ccc_1w_change"), "Distress indicator", m.get("ccc_sparkline", pd.Series(dtype=float))),
        ("BB OAS",  m.get("bb_oas"),  m.get("bb_1w_change"),  "BB tier spread",     m.get("bb_sparkline",  pd.Series(dtype=float))),
        ("B OAS",   m.get("b_oas"),   m.get("b_1w_change"),   "B tier spread",      m.get("b_sparkline",   pd.Series(dtype=float))),
    ]

    cards_html = ""
    for label, val, chg, sublabel, sparkline in cards_data:
        accent = _accent(label, val)
        val_str = _fmt_bps(val, 0) if val is not None else "—"
        chg_str, chg_color = _fmt_chg(chg)
        pts = _svg_points(sparkline)
        if pts:
            svg_html = (
                f'<svg width="100%" height="28" viewBox="0 0 100 28" '
                f'preserveAspectRatio="none" style="display:block;margin-top:6px">'
                f'<polyline points="{pts}" stroke="{accent}" stroke-width="1.5" fill="none"/>'
                f'</svg>'
            )
        else:
            svg_html = '<div style="height:28px;margin-top:6px"></div>'
        cards_html += f"""
        <div style="background:#1a1d23;border:0.5px solid #30363d;border-left:3px solid {accent};
                    border-radius:0 8px 8px 0;padding:12px 14px;flex:1;min-width:0">
          <div style="font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;
                      color:#8b949e;margin-bottom:6px">{label}</div>
          <div style="font-size:22px;font-weight:500;color:#e6edf3;
                      font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:-0.02em;
                      line-height:1">{val_str} <span style="font-size:12px;color:#8b949e">bps</span></div>
          <div style="font-size:10px;color:#8b949e;margin-top:4px">{sublabel}</div>
          <div style="font-size:11px;color:{chg_color};margin-top:6px;font-weight:500">{chg_str} vs prev month</div>
          {svg_html}
        </div>"""

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.row {{ display:flex; gap:8px; }}
</style></head>
<body><div class="row">{cards_html}</div></body></html>""",
        height=165,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section 3: OAS history chart (Altair) + ratio/distress cards
# ─────────────────────────────────────────────────────────────────────────────

def _render_oas_chart(hy_series: pd.Series, ig_series: pd.Series) -> None:
    """Render Altair dual-line OAS history chart with recession shading."""
    try:
        import altair as alt
    except ImportError:
        st.warning("altair not installed — run `pip install altair>=5.0`")
        return

    if hy_series.empty:
        st.info("OAS history chart unavailable — no data.")
        return

    # Build combined line data
    hy_df = hy_series.reset_index()
    hy_df.columns = ["date", "value"]
    hy_df.loc[:, "series"] = "HY OAS"

    ig_df = ig_series.reset_index() if not ig_series.empty else pd.DataFrame(columns=["date", "value"])
    if not ig_df.empty:
        ig_df.columns = ["date", "value"]
        ig_df.loc[:, "series"] = "IG OAS"
        line_data = pd.concat([hy_df, ig_df], ignore_index=True)
    else:
        line_data = hy_df

    # Recession bands
    rec_rows = [
        {"start": pd.Timestamp(s), "end": pd.Timestamp(e)}
        for s, e in _RECESSIONS
        if pd.Timestamp(s) >= hy_series.index[0]
    ]
    rec_df = pd.DataFrame(rec_rows) if rec_rows else pd.DataFrame(columns=["start", "end"])

    color_scale = alt.Scale(
        domain=["HY OAS", "IG OAS"],
        range=["#e67e22", "#4a9eff"],
    )

    lines = (
        alt.Chart(line_data)
        .mark_line(strokeWidth=1.8)
        .encode(
            x=alt.X("date:T", title=None),
            y=alt.Y("value:Q", title="OAS (bps)"),
            color=alt.Color("series:N", scale=color_scale, legend=alt.Legend(orient="top-left")),
            tooltip=[
                alt.Tooltip("date:T", title="Date", format="%b %d, %Y"),
                alt.Tooltip("series:N", title="Series"),
                alt.Tooltip("value:Q", title="OAS (bps)", format=".1f"),
            ],
        )
    )

    if not rec_df.empty:
        bands = (
            alt.Chart(rec_df)
            .mark_rect(opacity=0.15, color="#e74c3c")
            .encode(
                x=alt.X("start:T"),
                x2=alt.X2("end:T"),
            )
        )
        chart = alt.layer(bands, lines).properties(
            title="HY & IG OAS — 30-year history",
            height=280,
        )
    else:
        chart = lines.properties(
            title="HY & IG OAS — 30-year history",
            height=280,
        )

    chart = (
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

    st.altair_chart(chart, use_container_width=True)


def _render_ratio_distress_cards(m: dict) -> None:
    """Render HY/IG ratio card and distress ratio card (stacked)."""
    ratio = m.get("hy_ig_ratio")
    distress = m.get("distress_ratio")

    ratio_str = f"{ratio:.2f}×" if ratio is not None else "—"
    distress_str = f"{distress:.1f}%" if distress is not None else "—"
    fill = min(distress or 0, 100)

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.card {{ background:#1a1d23; border:0.5px solid #30363d;
         border-radius:8px; padding:14px 16px; margin-bottom:8px; }}
.label {{ font-size:9px; font-weight:500; letter-spacing:0.1em; text-transform:uppercase; color:#8b949e; margin-bottom:6px; }}
.value {{ font-size:26px; font-weight:500; color:#e6edf3; font-family:'SFMono-Regular',Consolas,monospace; letter-spacing:-0.02em; }}
.context {{ font-size:10px; color:#484f58; margin-top:6px; }}
.bar-track {{ height:6px; background:#30363d; border-radius:3px; margin:10px 0 6px; overflow:hidden; }}
.bar-fill {{
  height:6px; border-radius:3px;
  background:linear-gradient(to right, #2ecc71 0%, #e67e22 50%, #e74c3c 100%);
  width:{fill}%;
}}
</style></head>
<body>
<div class="card">
  <div class="label">HY / IG Ratio</div>
  <div class="value">{ratio_str}</div>
  <div class="context">Historical avg ~3.5× &nbsp;·&nbsp; 2008 peak 8.2×</div>
</div>
<div class="card">
  <div class="label">Distress Ratio (CCC vs 1000 bps)</div>
  <div class="value">{distress_str}</div>
  <div class="bar-track"><div class="bar-fill"></div></div>
  <div class="context">Above 100% = systemic credit stress</div>
</div>
</body></html>""",
        height=270,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section 4: Analytical columns
# ─────────────────────────────────────────────────────────────────────────────

def _render_lbo_card(m: dict) -> None:
    """LBO all-in financing cost breakdown."""
    fedfunds_pct = None
    hy_spread_pct = None
    if m.get("hy_oas") is not None:
        hy_spread_pct = m["hy_oas"] / 100
    # Back-calculate fedfunds from lbo_all_in_cost
    if m.get("lbo_all_in_cost") and hy_spread_pct is not None:
        try:
            total = float(m["lbo_all_in_cost"].replace("%", ""))
            fedfunds_pct = total - hy_spread_pct
        except Exception:
            pass

    ff_str  = f"{fedfunds_pct:.2f}%" if fedfunds_pct is not None else "—"
    hy_str  = f"{hy_spread_pct:.2f}%" if hy_spread_pct is not None else "—"
    all_str = m.get("lbo_all_in_cost") or "—"

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.card {{ background:#1a1d23; border:0.5px solid #30363d; border-left:3px solid #9b59b6;
         border-radius:0 8px 8px 0; padding:14px 16px; }}
.row {{ display:flex; justify-content:space-between; padding:5px 0;
        font-size:12px; color:#8b949e; border-bottom:0.5px solid #21262d; }}
.row:last-of-type {{ border-bottom:none; }}
.total-row {{ display:flex; justify-content:space-between; padding:8px 0 4px; }}
.total-val {{ font-size:20px; font-weight:500; color:#9b59b6;
              font-family:'SFMono-Regular',Consolas,monospace; }}
.context {{ font-size:10px; color:#484f58; margin-top:8px; }}
.note {{ font-size:10px; color:#484f58; margin-top:10px; font-style:italic; }}
</style></head>
<body><div class="card">
  <div class="row"><span>Fed Funds rate</span><span style="color:#e6edf3">{ff_str}</span></div>
  <div class="row"><span>+ HY OAS spread</span><span style="color:#e6edf3">{hy_str}</span></div>
  <div style="height:0.5px;background:#484f58;margin:6px 0"></div>
  <div class="total-row">
    <span style="font-size:12px;color:#8b949e;align-self:center">All-in cost</span>
    <span class="total-val">{all_str}</span>
  </div>
  <div class="context">Pre-GFC avg ~7.2% &nbsp;·&nbsp; 2022 peak ~11.4%</div>
  <div class="note">Proxy for leveraged buyout debt cost. Higher = harder to make LBO math work.</div>
</div></body></html>""",
        height=200,
        scrolling=False,
    )


def _render_conditions_card(m: dict) -> None:
    """Credit conditions classification logic with current value highlighted."""
    current_label = m.get("credit_label", "No data")
    hy_val = m.get("hy_oas")
    hy_str = f"{hy_val:.0f} bps" if hy_val is not None else "—"

    rows_html = ""
    thresholds = [
        ("Normal",   "#2ecc71", "HY < 400 bps, IG < 150 bps"),
        ("Tight",    "#3498db", "IG > 150 bps"),
        ("Stressed", "#e67e22", "HY 400–700 bps"),
        ("Crisis",   "#e74c3c", "HY > 700 bps"),
    ]
    for label, color, desc in thresholds:
        is_current = label == current_label
        bg = "background:rgba(74,158,255,0.08);" if is_current else ""
        weight = "font-weight:600;" if is_current else ""
        rows_html += f"""
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;
                    border-radius:4px;{bg}margin-bottom:2px">
          <div style="width:8px;height:8px;border-radius:50%;background:{color};flex-shrink:0"></div>
          <span style="font-size:12px;color:#e6edf3;{weight}">{label}</span>
          <span style="font-size:10px;color:#484f58;margin-left:auto">{desc}</span>
        </div>"""

    current_color = _STATE_COLORS.get(current_label, "#8b949e")

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.card {{ background:#1a1d23; border:0.5px solid #30363d; border-radius:8px; padding:14px 16px; }}
.current {{ font-size:11px; color:#8b949e; margin-bottom:10px; }}
</style></head>
<body><div class="card">
  <div class="current">
    Current: HY {hy_str} →
    <span style="color:{current_color};font-weight:600"> {current_label}</span>
  </div>
  {rows_html}
</div></body></html>""",
        height=200,
        scrolling=False,
    )


def _render_percentile_card(m: dict) -> None:
    """30-year spread percentile ranks with progress bars."""
    hy_rank = m.get("hy_pct_rank")
    ig_rank = m.get("ig_pct_rank")

    def _interp(rank: int | None) -> str:
        if rank is None:
            return ""
        if rank < 33:
            return "historically tight / favorable"
        elif rank < 67:
            return "normal range"
        else:
            return "elevated / caution"

    def _bar_color(rank: int | None) -> str:
        if rank is None:
            return "#484f58"
        if rank < 33:
            return "#2ecc71"
        elif rank < 67:
            return "#d29922"
        return "#e74c3c"

    hy_fill  = hy_rank or 0
    ig_fill  = ig_rank or 0
    hy_color = _bar_color(hy_rank)
    ig_color = _bar_color(ig_rank)
    hy_interp = _interp(hy_rank)
    ig_interp = _interp(ig_rank)
    hy_rank_str = f"{hy_rank}th" if hy_rank is not None else "—"
    ig_rank_str = f"{ig_rank}th" if ig_rank is not None else "—"

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.card {{ background:#1a1d23; border:0.5px solid #30363d; border-radius:8px; padding:14px 16px; }}
.metric {{ margin-bottom:14px; }}
.metric-label {{ font-size:10px; color:#8b949e; margin-bottom:4px; }}
.metric-row {{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; }}
.rank {{ font-size:20px; font-weight:500; font-family:'SFMono-Regular',Consolas,monospace; }}
.interp {{ font-size:10px; color:#484f58; }}
.bar-track {{ height:4px; background:#30363d; border-radius:2px; overflow:hidden; }}
.bar-fill {{ height:4px; border-radius:2px; }}
</style></head>
<body><div class="card">
  <div class="metric">
    <div class="metric-label">HY OAS Percentile (30yr)</div>
    <div class="metric-row">
      <span class="rank" style="color:{hy_color}">{hy_rank_str}</span>
      <span class="interp">{hy_interp}</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:{hy_fill}%;background:{hy_color}"></div></div>
  </div>
  <div class="metric">
    <div class="metric-label">IG OAS Percentile (30yr)</div>
    <div class="metric-row">
      <span class="rank" style="color:{ig_color}">{ig_rank_str}</span>
      <span class="interp">{ig_interp}</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:{ig_fill}%;background:{ig_color}"></div></div>
  </div>
</div></body></html>""",
        height=200,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section 5: Regime-conditional performance table
# ─────────────────────────────────────────────────────────────────────────────

def _render_regime_table(current_regime: str | None) -> None:
    """HTML table of asset returns by macro regime, with current regime highlighted."""

    def _val_color(v: float) -> str:
        if v > 0.5:   return "#2ecc71"
        elif v < -0.5: return "#e74c3c"
        return "#8b949e"

    header_cells = ""
    for col in _REGIME_COLS:
        is_current = col == current_regime
        bg_style = "background:rgba(74,158,255,0.08);" if is_current else ""
        weight = "font-weight:600;color:#4a9eff;" if is_current else ""
        header_cells += f'<th style="{bg_style}padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8b949e;text-align:right;{weight}">{col}</th>'

    rows_html = ""
    for asset, returns in _REGIME_RETURNS.items():
        row_cells = f'<td style="padding:8px 12px;font-size:12px;color:#e6edf3;white-space:nowrap">{asset}</td>'
        for col in _REGIME_COLS:
            v = returns.get(col, 0.0)
            color = _val_color(v)
            sign = "+" if v >= 0 else ""
            is_current = col == current_regime
            bg_style = "background:rgba(74,158,255,0.08);" if is_current else ""
            row_cells += f'<td style="{bg_style}padding:8px 12px;font-size:12px;color:{color};text-align:right;font-family:\'SFMono-Regular\',Consolas,monospace;font-weight:500">{sign}{v:.1f}%</td>'
        rows_html += f"<tr>{row_cells}</tr>"

    # Current regime note
    regime_note = f'Current regime: <span style="color:#4a9eff;font-weight:600">{current_regime}</span>' if current_regime else "Current regime: unavailable"

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
.wrap {{ background:#1a1d23; border:0.5px solid #30363d; border-radius:8px; overflow:hidden; }}
table {{ width:100%; border-collapse:collapse; }}
tr {{ border-bottom:0.5px solid #21262d; }}
tr:last-child {{ border-bottom:none; }}
tr:hover td {{ background:rgba(255,255,255,0.02); }}
.footer {{ font-size:10px; color:#484f58; padding:10px 12px; border-top:0.5px solid #21262d; }}
.regime-note {{ font-size:10px; padding:8px 12px 0; color:#8b949e; }}
</style></head>
<body>
<div class="wrap">
  <div class="regime-note">{regime_note}</div>
  <table>
    <thead>
      <tr>
        <th style="padding:8px 12px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8b949e;text-align:left">Asset</th>
        {header_cells}
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>
  <div class="footer">
    Returns are approximate medians from academic and industry research.
    Phase 8 will replace with live backtest from this dashboard's regime history.
  </div>
</div>
</body></html>""",
        height=310,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section 6: Transition matrix
# ─────────────────────────────────────────────────────────────────────────────

def _matrix_html(probs: dict, title: str, current_label: str | None) -> str:
    """Build an HTML table for a credit state transition matrix."""

    header_cells = '<th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:#484f58;text-align:left">From \\ To</th>'
    for to_s in CREDIT_STATES:
        color = _STATE_COLORS.get(to_s, "#8b949e")
        header_cells += f'<th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:{color};text-align:center">{to_s}</th>'

    rows_html = ""
    for from_s in CREDIT_STATES:
        is_current_row = from_s == current_label
        row_bg = "background:rgba(74,158,255,0.05);" if is_current_row else ""
        dot_color = _STATE_COLORS.get(from_s, "#8b949e")
        row_cells = f'<td style="padding:8px 10px;{row_bg}"><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:{dot_color};flex-shrink:0"></span><span style="font-size:12px;color:#e6edf3">{from_s}</span></span></td>'
        from_probs = probs.get(from_s, {})
        for to_s in CREDIT_STATES:
            p = from_probs.get(to_s, 0.0)
            pct = int(round(p * 100))
            is_diag = from_s == to_s
            if pct >= 50:
                cell_color = "#2ecc71" if is_diag else "#4a9eff"
                cell_bg = "rgba(46,204,113,0.12)" if is_diag else "rgba(74,158,255,0.12)"
            elif pct >= 20:
                cell_color = "#3fb950" if is_diag else "#58a6ff"
                cell_bg = "rgba(46,204,113,0.06)" if is_diag else "rgba(74,158,255,0.06)"
            else:
                cell_color = "#484f58"
                cell_bg = "transparent"
            row_cells += f'<td style="padding:8px 10px;text-align:center;{row_bg}"><span style="background:{cell_bg};color:{cell_color};font-size:12px;font-weight:500;font-family:\'SFMono-Regular\',Consolas,monospace;padding:2px 6px;border-radius:3px">{pct}%</span></td>'
        rows_html += f"<tr>{row_cells}</tr>"

    return f"""
    <div style="background:#1a1d23;border:0.5px solid #30363d;border-radius:8px;overflow:hidden">
      <div style="padding:10px 12px 0;font-size:10px;color:#8b949e;font-weight:500">{title}</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>{header_cells}</tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
    </div>"""


def _render_transition_matrices(m: dict) -> None:
    """Render 3M and 6M transition matrices side-by-side."""
    t3m = m.get("transition_3m", {})
    t6m = m.get("transition_6m", {})
    current_label = m.get("credit_label")

    if not t3m and not t6m:
        st.info(
            "Transition matrix requires 30yr BAML history. "
            "Run the data pipeline to populate: `python main.py`"
        )
        return

    col1, col2 = st.columns(2)

    with col1:
        if t3m:
            components.html(
                f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
table {{ width:100%; border-collapse:collapse; }}
tr {{ border-bottom:0.5px solid #21262d; }}
tr:last-child {{ border-bottom:none; }}
</style></head>
<body>{_matrix_html(t3m, "3-Month transition probabilities", current_label)}</body></html>""",
                height=255,
                scrolling=False,
            )

    with col2:
        if t6m:
            components.html(
                f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:2px; }}
table {{ width:100%; border-collapse:collapse; }}
tr {{ border-bottom:0.5px solid #21262d; }}
tr:last-child {{ border-bottom:none; }}
</style></head>
<body>{_matrix_html(t6m, "6-Month transition probabilities", current_label)}</body></html>""",
                height=255,
                scrolling=False,
            )

    # Tight state footnote
    tight_count = m.get("tight_count", 0)
    if tight_count < 5:
        st.markdown(
            '<div style="font-size:10px;color:#484f58;margin-top:6px;font-style:italic">'
            'Note: Tight state has insufficient historical observations and is excluded from probability estimates.'
            '</div>',
            unsafe_allow_html=True,
        )

    # Interpretation block
    if current_label and current_label != "No data" and t3m and t6m:
        stay_3m = int(round(t3m.get(current_label, {}).get(current_label, 0) * 100))
        # Probability of deterioration (to Stressed or Crisis) in 6M
        deterio_states = [s for s in ["Stressed", "Crisis"]
                          if s != current_label and CREDIT_STATES.index(s) > CREDIT_STATES.index(current_label)]
        deterio_6m = int(round(sum(t6m.get(current_label, {}).get(s, 0) for s in deterio_states) * 100))

        label_color = _STATE_COLORS.get(current_label, "#8b949e")
        st.markdown(
            f'<div style="background:#161b22;border:0.5px solid #21262d;border-radius:6px;'
            f'padding:12px 16px;font-size:12px;line-height:1.7;color:#c9d1d9;margin-top:8px">'
            f'Current state: <span style="color:{label_color};font-weight:600">{current_label}</span>. '
            f'Based on 30yr history, credit conditions remain <span style="color:{label_color};font-weight:600">'
            f'{current_label}</span> <b>{stay_3m}%</b> of the time over 3 months. '
            f'There is a <b>{deterio_6m}%</b> historical probability of deterioration to '
            f'Stressed or Crisis over the next 6 months.'
            f'</div>',
            unsafe_allow_html=True,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def _load_credit_metrics() -> dict:
    from src.analytics.credit import get_credit_metrics
    return get_credit_metrics()


def render() -> None:
    """Render the full Credit tab."""
    from utils.tab_context import register_tab_context

    m = _load_credit_metrics()
    register_tab_context("Credit", {
        "shows": "IG/HY/CCC/BB/B OAS spreads, distress ratio, LBO all-in financing cost, credit regime",
        "credit_regime":   m.get("credit_label"),
        "ig_oas_bps":      m.get("ig_oas"),
        "hy_oas_bps":      m.get("hy_oas"),
        "hy_ig_ratio":     m.get("hy_ig_ratio"),
        "lbo_all_in_cost": m.get("lbo_all_in_cost"),
        "key_tools":       ["get_credit_snapshot"],
    })

    label = m.get("credit_label", "No data")
    color = m.get("credit_label_color", "#8b949e")
    as_of = m.get("data_as_of") or "—"

    # ── Section 1: Status bar ─────────────────────────────────────────────────
    st.markdown(
        f'<div style="display:flex;justify-content:space-between;align-items:center;'
        f'padding:8px 0;margin-bottom:4px">'
        f'<div style="display:flex;align-items:center;gap:10px">'
        f'<span style="font-size:10px;font-weight:500;text-transform:uppercase;'
        f'letter-spacing:0.08em;color:#8b949e">Credit Regime</span>'
        f'<span style="border:0.5px solid {color}55;color:{color};font-weight:700;'
        f'font-size:14px;padding:3px 12px;border-radius:4px;background:rgba(0,0,0,0.25)">'
        f'● {label}</span>'
        f'</div>'
        f'<span style="font-size:10px;color:#484f58">FRED BAML series · refreshed daily 6 AM ET'
        f' · as of {as_of}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # No-data fallback
    if label == "No data":
        st.info(
            "No BAML credit spread data found in the database. "
            "Run the data pipeline to fetch historical OAS series:\n"
            "```\npython main.py\n```"
        )
        return

    # ── Section 2: Spread cards ───────────────────────────────────────────────
    _section_header("SPREAD LEVELS (BASIS POINTS)", accent_color="#e67e22")
    _render_spread_cards(m)

    st.markdown("<div style='margin-top:6px'></div>", unsafe_allow_html=True)

    # ── Section 3: Chart + ratio/distress cards ───────────────────────────────
    _section_header("OAS HISTORY & SPREAD RATIOS", accent_color="#4a9eff")
    chart_col, side_col = st.columns([3, 2])
    with chart_col:
        _render_oas_chart(m["hy_series"], m["ig_series"])
    with side_col:
        _render_ratio_distress_cards(m)

    # ── Section 4: Analytical columns ────────────────────────────────────────
    _section_header("CREDIT ANALYTICS", accent_color="#9b59b6")
    a1, a2, a3 = st.columns(3)
    with a1:
        st.markdown(
            '<div style="font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;'
            'color:#9b59b6;margin-bottom:8px">LBO ALL-IN FINANCING COST</div>',
            unsafe_allow_html=True,
        )
        _render_lbo_card(m)
    with a2:
        st.markdown(
            '<div style="font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;'
            'color:#8b949e;margin-bottom:8px">CONDITIONS LOGIC</div>',
            unsafe_allow_html=True,
        )
        _render_conditions_card(m)
    with a3:
        st.markdown(
            '<div style="font-size:9px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;'
            'color:#8b949e;margin-bottom:8px">SPREAD CONTEXT (30YR)</div>',
            unsafe_allow_html=True,
        )
        _render_percentile_card(m)

    # ── Section 5: Regime-conditional performance ─────────────────────────────
    _section_header("REGIME-CONDITIONAL ASSET PERFORMANCE", accent_color="#9b59b6")
    st.markdown(
        '<div style="font-size:11px;color:#484f58;margin-bottom:8px;margin-top:-8px">'
        'Median annual returns during each macro regime · backtested 1995–present</div>',
        unsafe_allow_html=True,
    )
    current_regime = _current_regime()
    _render_regime_table(current_regime)

    # ── Section 6: Transition matrix ─────────────────────────────────────────
    _section_header("CREDIT REGIME TRANSITION MATRIX", accent_color="#4a9eff")
    st.markdown(
        '<div style="font-size:11px;color:#484f58;margin-bottom:8px;margin-top:-8px">'
        'Historical probability of credit condition changes · computed from 30yr BAML spread history</div>',
        unsafe_allow_html=True,
    )
    _render_transition_matrices(m)
