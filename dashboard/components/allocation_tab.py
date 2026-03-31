"""
dashboard/components/allocation_tab.py
Asset Allocation tab — Phase 9A

Sub-tabs:
  Overview     — regime-conditional return heatmap (10 assets × 4 regimes)
  Optimization — MVO / Min Var / Risk Parity method cards + weights chart + frontier
  Risk Analysis — per-regime correlation heatmap + drawdown table
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import altair as alt
import numpy as np
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

# ── Design tokens (match existing tabs) ───────────────────────────────────────
_BG       = "#0d1117"
_CARD_BG  = "#161b22"
_BORDER   = "#30363d"
_ACCENT   = "#4a9eff"
_TEXT     = "#e6edf3"
_MUTED    = "#8b949e"
_POS      = "#3fb950"
_NEG      = "#f85149"
_WARN     = "#d29922"

_REGIME_COLORS = {
    "Goldilocks":    "#3fb950",
    "Overheating":   "#d29922",
    "Stagflation":   "#f85149",
    "Recession Risk":"#8b949e",
}

_METHOD_COLORS = {
    "mvo":         _ACCENT,
    "min_var":     _POS,
    "risk_parity": _WARN,
}

_METHOD_LABELS = {
    "mvo":         "Mean-Variance (MVO)",
    "min_var":     "Minimum Variance",
    "risk_parity": "Risk Parity",
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _return_color(val: float) -> str:
    if val > 0.10:  return "#1a4731"
    if val > 0.05:  return "#1a3a1a"
    if val > 0.0:   return "#1a2a1a"
    if val > -0.05: return "#3a1a1a"
    return "#5a1a1a"


def _text_color(val: float) -> str:
    if val > 0.05:  return _POS
    if val > 0.0:   return "#8bc98a"
    if val > -0.05: return "#c98a8a"
    return _NEG


def _corr_color(val: float) -> str:
    """Blue–white–red diverging palette for correlation."""
    if val >= 0.8:   return "#c0392b"
    if val >= 0.5:   return "#e74c3c"
    if val >= 0.2:   return "#e8b4b8"
    if val >= -0.2:  return "#ecf0f1"
    if val >= -0.5:  return "#7fb3d3"
    return "#2471a3"


def _dd_color(val: float) -> str:
    if val < -0.30: return _NEG
    if val < -0.15: return _WARN
    return _MUTED


# ── Overview sub-tab ───────────────────────────────────────────────────────────

def _render_overview(data: dict) -> None:
    regime_stats = data["regime_stats"]
    current      = data["current_regime"]

    if not regime_stats:
        st.info("Insufficient regime history to compute statistics.")
        return

    regimes_present = list(regime_stats.keys())
    assets = data["asset_classes"]
    # Only keep assets that appear in all available regimes
    common_assets = [
        a for a in assets
        if all(a in regime_stats[r]["mean"].index for r in regimes_present)
    ]

    # ── Header ─────────────────────────────────────────────────────────────────
    st.markdown(
        f"<div style='color:{_MUTED};font-size:12px;margin-bottom:12px;'>"
        f"Annualized returns and Sharpe ratios by macro regime. "
        f"Current regime: <span style='color:{_REGIME_COLORS.get(current, _ACCENT)};font-weight:600;'>"
        f"{current}</span>&nbsp;&nbsp;|&nbsp;&nbsp;"
        f"Data: {data['data_start']} → {data['data_end']} ({data['n_months']} months)"
        f"</div>",
        unsafe_allow_html=True,
    )

    # ── Build HTML table ───────────────────────────────────────────────────────
    col_width = 140
    table_width = 220 + col_width * len(regimes_present)

    header_cells = "".join(
        f"<th style='background:{_CARD_BG};color:{_REGIME_COLORS.get(r, _ACCENT)};"
        f"border:1px solid {_BORDER};padding:10px 14px;text-align:center;"
        f"{'border-bottom:2px solid ' + _REGIME_COLORS.get(r, _ACCENT) + ';' if r == current else ''}'>"
        f"{r}</th>"
        for r in regimes_present
    )

    rows_html = ""
    for asset in common_assets:
        cells = f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};" \
                f"padding:8px 14px;font-weight:500;white-space:nowrap;'>{asset}</td>"

        for regime in regimes_present:
            ret    = float(regime_stats[regime]["mean"].get(asset, np.nan))
            sharpe = float(regime_stats[regime]["sharpe"].get(asset, np.nan))
            if np.isnan(ret):
                cells += f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};text-align:center;'>—</td>"
            else:
                bg  = _return_color(ret)
                tc  = _text_color(ret)
                stc = _MUTED if sharpe < 0.5 else (_POS if sharpe > 1.0 else _WARN)
                is_current = (regime == current)
                border_style = f"border-left:2px solid {_REGIME_COLORS.get(regime, _ACCENT)};" if is_current else ""
                cells += (
                    f"<td style='background:{bg};border:1px solid {_BORDER};{border_style}"
                    f"text-align:center;padding:8px 12px;'>"
                    f"<div style='color:{tc};font-size:13px;font-weight:600;'>{ret:+.1%}</div>"
                    f"<div style='color:{stc};font-size:10px;margin-top:2px;'>SR {sharpe:.2f}</div>"
                    f"</td>"
                )
        rows_html += f"<tr>{cells}</tr>"

    months_row = (
        "<tr>"
        f"<td style='background:{_BG};color:{_MUTED};border:1px solid {_BORDER};"
        f"padding:6px 14px;font-size:11px;font-style:italic;'>Sample months</td>"
        + "".join(
            f"<td style='background:{_BG};color:{_MUTED};border:1px solid {_BORDER};"
            f"text-align:center;font-size:11px;padding:6px;'>"
            f"{regime_stats[r]['n_months']}</td>"
            for r in regimes_present
        )
        + "</tr>"
    )

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_BG};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px;}}
  table {{border-collapse:collapse;width:100%;}}
  th {{font-size:12px;font-weight:600;letter-spacing:0.5px;}}
  td {{font-size:13px;}}
</style></head>
<body>
<table style="width:{table_width}px;">
  <thead><tr>
    <th style="background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};
               padding:10px 14px;text-align:left;">Asset Class</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}{months_row}</tbody>
</table>
</body></html>"""

    row_h = 52
    header_h = 44
    total_h = header_h + row_h * len(common_assets) + 36 + 20
    components.html(html, height=total_h, scrolling=False)


# ── Optimization sub-tab ───────────────────────────────────────────────────────

def _render_method_card(key: str, result: dict, rf: float) -> None:
    label  = _METHOD_LABELS[key]
    color  = _METHOD_COLORS[key]
    ret    = result.get("expected_return", 0.0)
    vol    = result.get("volatility", 0.0)
    sharpe = result.get("sharpe_ratio", 0.0)
    ok     = result.get("converged", True)
    note   = "" if ok else " (fallback)"

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_BG};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:2px;}}
</style></head><body>
<div style="background:{_CARD_BG};border:1px solid {_BORDER};border-top:3px solid {color};
            border-radius:6px;padding:16px 20px;">
  <div style="color:{_MUTED};font-size:11px;font-weight:600;letter-spacing:1px;
              text-transform:uppercase;margin-bottom:10px;">{label}{note}</div>
  <div style="display:flex;gap:24px;align-items:flex-start;">
    <div>
      <div style="color:{_MUTED};font-size:10px;">Expected Return</div>
      <div style="color:{_POS if ret >= 0 else _NEG};font-size:22px;font-weight:700;">{ret:+.1%}</div>
    </div>
    <div>
      <div style="color:{_MUTED};font-size:10px;">Volatility</div>
      <div style="color:{_TEXT};font-size:22px;font-weight:700;">{vol:.1%}</div>
    </div>
    <div>
      <div style="color:{_MUTED};font-size:10px;">Sharpe Ratio</div>
      <div style="color:{color};font-size:22px;font-weight:700;">{sharpe:.2f}</div>
    </div>
  </div>
</div>
</body></html>"""
    components.html(html, height=110, scrolling=False)


def _render_weights_chart(opt: dict) -> None:
    asset_names = opt["asset_names"]
    rows = []
    for key in ("mvo", "min_var", "risk_parity"):
        for asset, w in zip(asset_names, opt[key]["weights"]):
            if w > 0.005:
                rows.append({
                    "Asset":  asset,
                    "Weight": float(w),
                    "Method": _METHOD_LABELS[key],
                })

    if not rows:
        return

    df = pd.DataFrame(rows)

    method_order = [_METHOD_LABELS[k] for k in ("mvo", "min_var", "risk_parity")]
    color_map    = {_METHOD_LABELS[k]: _METHOD_COLORS[k] for k in _METHOD_COLORS}

    chart = (
        alt.Chart(df)
        .mark_bar(size=14)
        .encode(
            x=alt.X("Weight:Q", axis=alt.Axis(format=".0%", title="Weight")),
            y=alt.Y(
                "Asset:N",
                sort=alt.EncodingSortField(field="Weight", op="sum", order="descending"),
                axis=alt.Axis(title=None),
            ),
            color=alt.Color(
                "Method:N",
                scale=alt.Scale(domain=method_order, range=[_ACCENT, _POS, _WARN]),
                legend=alt.Legend(orient="bottom", labelColor=_TEXT, titleColor=_MUTED),
            ),
            xOffset="Method:N",
            tooltip=["Asset", "Method", alt.Tooltip("Weight:Q", format=".1%")],
        )
        .properties(
            height=max(300, len(asset_names) * 40),
            title=alt.TitleParams("Portfolio Weights by Method", color=_TEXT),
        )
        .configure_view(strokeOpacity=0, fill=_BG)
        .configure_axis(
            labelColor=_MUTED, titleColor=_MUTED,
            gridColor="#21262d", domainColor=_BORDER,
        )
        .configure_title(color=_TEXT, fontSize=13)
        .configure_legend(labelColor=_TEXT, titleColor=_MUTED)
    )
    st.altair_chart(chart, use_container_width=True)


def _render_frontier_chart(opt: dict) -> None:
    frontier = opt.get("frontier")
    if frontier is None or frontier.empty:
        st.info("Efficient frontier not available.")
        return

    # Frontier line
    base = alt.Chart(frontier).encode(
        x=alt.X("volatility:Q", axis=alt.Axis(format=".0%", title="Volatility (ann.)"), scale=alt.Scale(zero=False)),
        y=alt.Y("return:Q",     axis=alt.Axis(format=".0%", title="Return (ann.)"),     scale=alt.Scale(zero=False)),
    )
    line = base.mark_line(color=_MUTED, strokeWidth=2).encode(
        tooltip=[alt.Tooltip("volatility:Q", format=".1%"), alt.Tooltip("return:Q", format=".1%"),
                 alt.Tooltip("sharpe:Q", format=".2f", title="Sharpe")]
    )

    # Mark the 3 portfolios
    portfolio_pts = []
    for key in ("mvo", "min_var", "risk_parity"):
        r = opt[key]
        portfolio_pts.append({
            "volatility": float(r["volatility"]),
            "return":     float(r["expected_return"]),
            "sharpe":     float(r["sharpe_ratio"]),
            "Method":     _METHOD_LABELS[key],
        })
    pt_df = pd.DataFrame(portfolio_pts)
    method_order = [_METHOD_LABELS[k] for k in ("mvo", "min_var", "risk_parity")]

    dots = (
        alt.Chart(pt_df)
        .mark_point(size=120, filled=True, strokeWidth=2)
        .encode(
            x="volatility:Q",
            y="return:Q",
            color=alt.Color(
                "Method:N",
                scale=alt.Scale(domain=method_order, range=[_ACCENT, _POS, _WARN]),
            ),
            tooltip=["Method", alt.Tooltip("volatility:Q", format=".1%"),
                     alt.Tooltip("return:Q", format=".1%"), alt.Tooltip("sharpe:Q", format=".2f")],
        )
    )
    labels = dots.mark_text(dy=-14, fontSize=10, align="center").encode(
        text="Method:N",
        color=alt.Color("Method:N", scale=alt.Scale(domain=method_order, range=[_ACCENT, _POS, _WARN])),
    )

    chart = (
        (line + dots + labels)
        .properties(
            height=320,
            title=alt.TitleParams("Efficient Frontier", color=_TEXT),
        )
        .configure_view(strokeOpacity=0, fill=_BG)
        .configure_axis(
            labelColor=_MUTED, titleColor=_MUTED,
            gridColor="#21262d", domainColor=_BORDER,
        )
        .configure_title(color=_TEXT, fontSize=13)
        .configure_legend(labelColor=_TEXT, titleColor=_MUTED)
    )
    st.altair_chart(chart, use_container_width=True)


def _render_optimization(data: dict) -> None:
    opt = data.get("optimizations")
    if opt is None:
        st.warning(
            f"Cannot run optimization for regime **{data['current_regime']}** — "
            "insufficient history (need ≥ 24 months)."
        )
        return

    rf      = data["rf_rate"]
    current = data["current_regime"]

    st.markdown(
        f"<div style='color:{_MUTED};font-size:12px;margin-bottom:14px;'>"
        f"Optimizations conditioned on <span style='color:{_REGIME_COLORS.get(current, _ACCENT)};font-weight:600;'>"
        f"{current}</span> regime statistics.&nbsp;&nbsp;"
        f"Max weight per asset: 40%&nbsp;&nbsp;|&nbsp;&nbsp;Risk-free rate: {rf:.2%}"
        f"</div>",
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns(3)
    with col1:
        _render_method_card("mvo", opt["mvo"], rf)
    with col2:
        _render_method_card("min_var", opt["min_var"], rf)
    with col3:
        _render_method_card("risk_parity", opt["risk_parity"], rf)

    st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)

    left, right = st.columns([3, 2])
    with left:
        _render_weights_chart(opt)
    with right:
        _render_frontier_chart(opt)


# ── Risk Analysis sub-tab ──────────────────────────────────────────────────────

def _render_correlation_heatmap(corr: pd.DataFrame, regime: str) -> None:
    assets = list(corr.columns)
    n      = len(assets)
    size   = max(520, n * 54)

    cells = ""
    for row_asset in assets:
        cells += f"<tr><td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};" \
                 f"padding:6px 10px;white-space:nowrap;font-size:12px;'>{row_asset}</td>"
        for col_asset in assets:
            v  = float(corr.loc[row_asset, col_asset])
            bg = _corr_color(v)
            tc = "#111" if -0.2 < v < 0.2 else _TEXT
            cells += (
                f"<td style='background:{bg};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 4px;color:{tc};font-size:12px;font-weight:500;'>"
                f"{v:.2f}</td>"
            )
        cells += "</tr>"

    header = "".join(
        f"<th style='background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};"
        f"padding:6px 8px;font-size:11px;white-space:nowrap;writing-mode:vertical-rl;"
        f"text-orientation:mixed;transform:rotate(180deg);'>{a}</th>"
        for a in assets
    )

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_BG};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px;}}
  table {{border-collapse:collapse;}}
</style></head><body>
<table>
  <thead><tr>
    <th style="background:{_CARD_BG};border:1px solid {_BORDER};padding:6px;"></th>
    {header}
  </tr></thead>
  <tbody>{cells}</tbody>
</table>
</body></html>"""

    components.html(html, height=size + 60, scrolling=True)


def _render_drawdown_table(drawdowns: dict, asset_classes: list) -> None:
    by_regime = drawdowns.get("by_regime")
    overall   = drawdowns.get("overall")
    if by_regime is None or by_regime.empty:
        st.info("No drawdown data available.")
        return

    regimes_present = list(by_regime.columns)
    rows_html = ""
    for asset in asset_classes:
        if asset not in by_regime.index:
            continue
        overall_dd = float(overall.get(asset, np.nan)) if overall is not None else np.nan
        row = f"<tr><td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};" \
              f"padding:7px 12px;white-space:nowrap;font-size:13px;'>{asset}</td>"

        for regime in regimes_present:
            dd = float(by_regime.loc[asset, regime]) if asset in by_regime.index else np.nan
            if np.isnan(dd):
                row += f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};" \
                       f"text-align:center;color:{_MUTED};'>—</td>"
            else:
                tc = _dd_color(dd)
                bg = "#1a0000" if dd < -0.30 else ("#1a0f00" if dd < -0.15 else _CARD_BG)
                row += (
                    f"<td style='background:{bg};border:1px solid {_BORDER};"
                    f"text-align:center;padding:7px 10px;color:{tc};font-size:13px;font-weight:600;'>"
                    f"{dd:.1%}</td>"
                )

        # Overall column
        if not np.isnan(overall_dd):
            tc = _dd_color(overall_dd)
            row += (
                f"<td style='background:#0d0d0d;border:1px solid {_BORDER};"
                f"text-align:center;padding:7px 10px;color:{tc};font-size:13px;font-weight:700;'>"
                f"{overall_dd:.1%}</td>"
            )
        else:
            row += f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};text-align:center;color:{_MUTED};'>—</td>"

        row += "</tr>"
        rows_html += row

    header_cells = "".join(
        f"<th style='background:{_CARD_BG};color:{_REGIME_COLORS.get(r, _ACCENT)};"
        f"border:1px solid {_BORDER};padding:8px 14px;text-align:center;font-size:12px;'>{r}</th>"
        for r in regimes_present
    )

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_BG};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px;}}
  table {{border-collapse:collapse;width:100%;}}
</style></head><body>
<table>
  <thead><tr>
    <th style="background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};
               padding:8px 14px;text-align:left;font-size:12px;">Asset Class</th>
    {header_cells}
    <th style="background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};
               padding:8px 14px;text-align:center;font-size:12px;">Overall</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table>
</body></html>"""

    n_rows = len([a for a in asset_classes if a in by_regime.index])
    components.html(html, height=46 * n_rows + 60, scrolling=False)


def _render_risk_analysis(data: dict) -> None:
    regime_corr = data.get("regime_correlations", {})
    drawdowns   = data.get("drawdowns", {})
    current     = data["current_regime"]
    available   = list(regime_corr.keys())

    if not available:
        st.info("Insufficient data for risk analysis.")
        return

    st.markdown("### Correlation Heatmap")
    default_idx = available.index(current) if current in available else 0
    selected = st.selectbox(
        "Regime",
        options=available,
        index=default_idx,
        key="alloc_corr_regime",
    )
    if selected and selected in regime_corr:
        _render_correlation_heatmap(regime_corr[selected], selected)

    st.markdown("### Maximum Drawdown by Regime")
    st.caption("Maximum drawdown recorded during each regime period.")
    _render_drawdown_table(drawdowns, data["asset_classes"])


# ── Main render ────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def _load_allocation_data() -> dict:
    from src.analytics.allocation import get_allocation_data
    return get_allocation_data()


def render() -> None:
    """Entry point called from dashboard/app.py."""
    st.markdown(
        "<h2 style='color:#e6edf3;margin-bottom:4px;'>Asset Allocation</h2>"
        "<p style='color:#8b949e;font-size:13px;margin-bottom:16px;'>"
        "Regime-conditional portfolio optimization — MVO, Minimum Variance, Risk Parity"
        "</p>",
        unsafe_allow_html=True,
    )

    with st.spinner("Fetching asset prices and running optimizations…"):
        try:
            data = _load_allocation_data()
        except Exception as exc:
            st.error(f"Failed to load allocation data: {exc}")
            return

    overview_tab, optim_tab, risk_tab = st.tabs(["Overview", "Optimization", "Risk Analysis"])

    with overview_tab:
        _render_overview(data)

    with optim_tab:
        _render_optimization(data)

    with risk_tab:
        _render_risk_analysis(data)
