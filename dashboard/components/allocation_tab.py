"""
dashboard/components/allocation_tab.py
Asset Allocation tab — Phase 9A (Bloomberg polish)

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

# ── Design tokens ──────────────────────────────────────────────────────────────
_PAGE_BG = "#010409"   # outermost body bg inside components.html
_BG      = "#0d1117"   # card / container bg
_CARD_BG = "#0d1117"
_BORDER  = "#30363d"
_ACCENT  = "#4a9eff"
_TEXT    = "#e6edf3"
_MUTED   = "#8b949e"
_POS     = "#2ecc71"
_NEG     = "#e74c3c"
_WARN    = "#e67e22"

_REGIME_COLORS = {
    "Goldilocks":    "#2ecc71",
    "Overheating":   "#e67e22",
    "Stagflation":   "#e74c3c",
    "Recession Risk":"#8b5cf6",
}

_METHOD_COLORS = {
    "mvo":         "#4a9eff",
    "min_var":     "#2ecc71",
    "risk_parity": "#e67e22",
}

_METHOD_LABELS = {
    "mvo":         "Mean-Variance (MVO)",
    "min_var":     "Minimum Variance",
    "risk_parity": "Risk Parity",
}

_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"


# ── HTML helpers ───────────────────────────────────────────────────────────────

def _section_header_html(title: str, color: str = _ACCENT) -> str:
    return (
        f"<div style='border-left:3px solid {color};padding-left:12px;"
        f"margin:4px 0 8px 0;'>"
        f"<span style='font-size:11px;font-weight:600;letter-spacing:0.1em;"
        f"text-transform:uppercase;color:{_MUTED};'>{title}</span>"
        f"</div>"
    )


def _section_header(title: str, color: str = _ACCENT) -> None:
    """Render a Bloomberg-style left-accent section header."""
    components.html(
        f"<body style='background:{_PAGE_BG};margin:0;padding:0;font-family:{_FONT};'>"
        f"{_section_header_html(title, color)}</body>",
        height=36,
        scrolling=False,
    )


def _render_regime_banner(data: dict) -> None:
    """Gradient banner showing current regime, confidence and data range."""
    current = data["current_regime"]
    color   = _REGIME_COLORS.get(current, _ACCENT)
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
</style></head>
<body>
<div style="
    background:linear-gradient(135deg,{color}1a,{color}05);
    border:1px solid {color}4d;
    border-left:3px solid {color};
    border-radius:0 8px 8px 0;
    padding:14px 20px;
">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:10px;color:{_MUTED};text-transform:uppercase;
                  letter-spacing:0.1em;margin-bottom:4px;">Current Regime</div>
      <div style="font-size:20px;font-weight:600;color:{color};">{current}</div>
      <div style="font-size:11px;color:{_MUTED};margin-top:3px;">
        {data['confidence']:.0%} confidence
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:{_MUTED};text-transform:uppercase;
                  letter-spacing:0.1em;margin-bottom:4px;">Data Range</div>
      <div style="font-size:14px;color:{_TEXT};font-weight:500;">
        {data['n_months']} months
      </div>
      <div style="font-size:11px;color:{_MUTED};margin-top:3px;">
        {data['data_start']} &rarr; {data['data_end']}
      </div>
    </div>
  </div>
</div>
</body></html>"""
    components.html(html, height=96, scrolling=False)


# ── Color helpers ──────────────────────────────────────────────────────────────

def _return_bg(val: float) -> str:
    if val > 0.10:  return "#0d2818"
    if val > 0.05:  return "#0a1f12"
    if val > 0.0:   return "#07150c"
    if val > -0.05: return "#1c0c0c"
    return "#2a0a0a"


def _return_tc(val: float) -> str:
    if val > 0.05:  return _POS
    if val > 0.0:   return "#7dd89b"
    if val > -0.05: return "#d88a7d"
    return _NEG


def _corr_color(val: float) -> str:
    """Dark-background diverging palette: blue (neg) → navy (zero) → red (pos)."""
    if val >= 1.0:   return "#21262d"   # diagonal
    if val >= 0.8:   return "#7f1d1d"
    if val >= 0.5:   return "#c0392b"
    if val >= 0.2:   return "#7b2828"
    if val >= -0.2:  return "#1a1a2e"
    if val >= -0.5:  return "#1a3a5c"
    return "#1e4976"


def _corr_tc(val: float) -> str:
    if abs(val) < 0.2: return _MUTED
    return _TEXT


def _dd_color(val: float) -> str:
    if val < -0.30: return _NEG
    if val < -0.15: return _WARN
    return _MUTED


# ── Overview sub-tab ───────────────────────────────────────────────────────────

def _render_overview(data: dict) -> None:
    _render_regime_banner(data)
    _section_header("Regime-Conditional Performance")

    regime_stats    = data["regime_stats"]
    current         = data["current_regime"]
    regimes_present = list(regime_stats.keys())
    assets          = data["asset_classes"]

    if not regime_stats:
        st.info("Insufficient regime history to compute statistics.")
        return

    # Build HTML table ──────────────────────────────────────────────────────────
    header_cells = "".join(
        f"<th style='background:{_CARD_BG};color:{_REGIME_COLORS.get(r, _ACCENT)};"
        f"border:1px solid {_BORDER};padding:10px 14px;text-align:center;"
        f"{'border-bottom:2px solid ' + _REGIME_COLORS.get(r, _ACCENT) + ';' if r == current else ''}'>"
        f"{r}</th>"
        for r in regimes_present
    )

    rows_html = ""
    for asset in assets:
        # Only show asset if it has data in at least one regime
        has_any = any(asset in regime_stats[r]["mean"].index for r in regimes_present)
        if not has_any:
            continue

        cells = (
            f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
            f"padding:8px 14px;font-weight:500;white-space:nowrap;'>{asset}</td>"
        )
        for regime in regimes_present:
            mean_s = regime_stats[regime]["mean"]
            sharpe_s = regime_stats[regime]["sharpe"]
            if asset not in mean_s.index or np.isnan(float(mean_s[asset])):
                cells += (
                    f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                    f"text-align:center;color:{_MUTED};font-size:12px;'>—</td>"
                )
                continue
            ret    = float(mean_s[asset])
            sharpe = float(sharpe_s[asset]) if asset in sharpe_s.index else float("nan")
            bg  = _return_bg(ret)
            tc  = _return_tc(ret)
            stc = _MUTED if np.isnan(sharpe) or sharpe < 0.5 else (_POS if sharpe > 1.0 else _WARN)
            is_current = (regime == current)
            bl = f"border-left:2px solid {_REGIME_COLORS.get(regime, _ACCENT)};" if is_current else ""
            cells += (
                f"<td style='background:{bg};border:1px solid {_BORDER};{bl}"
                f"text-align:center;padding:8px 12px;'>"
                f"<div style='color:{tc};font-size:13px;font-weight:600;'>{ret:+.1%}</div>"
                f"<div style='color:{stc};font-size:10px;margin-top:2px;'>"
                f"{'SR —' if np.isnan(sharpe) else f'SR {sharpe:.2f}'}</div>"
                f"</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    months_row = (
        "<tr>"
        f"<td style='background:{_PAGE_BG};color:{_MUTED};border:1px solid {_BORDER};"
        f"padding:5px 14px;font-size:11px;font-style:italic;'>n months</td>"
        + "".join(
            f"<td style='background:{_PAGE_BG};color:{_MUTED};border:1px solid {_BORDER};"
            f"text-align:center;font-size:11px;padding:5px;'>{regime_stats[r]['n_months']}</td>"
            for r in regimes_present
        )
        + "</tr>"
    )

    col_w = 140
    n_assets_shown = sum(
        1 for a in assets
        if any(a in regime_stats[r]["mean"].index for r in regimes_present)
    )
    table_w = 220 + col_w * len(regimes_present)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
  table {{border-collapse:collapse;}}
  th {{font-size:12px;font-weight:600;letter-spacing:0.5px;}}
  td {{font-size:13px;}}
</style></head>
<body>
<table style="width:{table_w}px;">
  <thead><tr>
    <th style="background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};
               padding:10px 14px;text-align:left;">Asset Class</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}{months_row}</tbody>
</table>
</body></html>"""

    row_h   = 52
    total_h = 44 + row_h * n_assets_shown + 34 + 16
    components.html(html, height=total_h, scrolling=False)


# ── Optimization sub-tab ───────────────────────────────────────────────────────

def _render_method_card(key: str, result: dict, rf: float) -> None:
    label  = _METHOD_LABELS[key]
    color  = _METHOD_COLORS[key]
    ret    = result.get("expected_return", 0.0)
    vol    = result.get("volatility", 0.0)
    sharpe = result.get("sharpe_ratio", 0.0)
    ok     = result.get("converged", True)
    note   = "" if ok else " <span style='font-size:9px;color:#8b5cf6;'>(fallback)</span>"
    ret_color = _POS if ret >= 0 else _NEG

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
</style></head>
<body>
<div style="
    background:{_CARD_BG};
    border-left:1px solid {_BORDER};
    border-right:1px solid {_BORDER};
    border-bottom:1px solid {_BORDER};
    border-top:3px solid {color};
    border-radius:0 0 8px 8px;
    padding:16px 20px;
">
  <div style="font-size:11px;color:{_MUTED};text-transform:uppercase;
              letter-spacing:0.1em;margin-bottom:12px;">{label}{note}</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
    <div>
      <div style="font-size:10px;color:{_MUTED};margin-bottom:4px;">Expected Return</div>
      <div style="font-size:24px;font-weight:700;color:{ret_color};">{ret:+.1%}</div>
    </div>
    <div>
      <div style="font-size:10px;color:{_MUTED};margin-bottom:4px;">Volatility</div>
      <div style="font-size:24px;font-weight:700;color:{_TEXT};">{vol:.1%}</div>
    </div>
    <div>
      <div style="font-size:10px;color:{_MUTED};margin-bottom:4px;">Sharpe Ratio</div>
      <div style="font-size:24px;font-weight:700;color:{color};
                  text-shadow:0 0 10px {color}4d;">{sharpe:.2f}</div>
    </div>
  </div>
</div>
</body></html>"""
    components.html(html, height=112, scrolling=False)


def _render_weights_chart(opt: dict) -> None:
    _section_header("Portfolio Weights by Method")

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
    colors       = [_METHOD_COLORS[k] for k in ("mvo", "min_var", "risk_parity")]

    chart = (
        alt.Chart(df)
        .mark_bar(size=13)
        .encode(
            x=alt.X("Weight:Q", axis=alt.Axis(format=".0%", title="Weight", labelColor=_MUTED, titleColor=_MUTED)),
            y=alt.Y(
                "Asset:N",
                sort=alt.EncodingSortField(field="Weight", op="sum", order="descending"),
                axis=alt.Axis(title=None, labelColor=_MUTED),
            ),
            color=alt.Color(
                "Method:N",
                scale=alt.Scale(domain=method_order, range=colors),
                legend=alt.Legend(orient="bottom", labelColor=_TEXT, titleColor=_MUTED, titleFontSize=10),
            ),
            xOffset="Method:N",
            tooltip=["Asset", "Method", alt.Tooltip("Weight:Q", format=".1%")],
        )
        .properties(height=max(280, len(asset_names) * 38))
        .configure(background="transparent")
        .configure_view(strokeWidth=0)
        .configure_axis(
            domainColor=_BORDER,
            gridColor="#21262d",
            tickColor=_BORDER,
            labelColor=_MUTED,
            titleColor=_MUTED,
        )
        .configure_legend(labelColor=_MUTED, titleColor=_MUTED)
    )
    st.altair_chart(chart, use_container_width=True)


def _render_frontier_chart(opt: dict) -> None:
    _section_header("Efficient Frontier")

    frontier = opt.get("frontier")
    if frontier is None or frontier.empty:
        st.info("Efficient frontier not available.")
        return

    base = alt.Chart(frontier).encode(
        x=alt.X(
            "volatility:Q",
            axis=alt.Axis(format=".0%", title="Volatility (ann.)", labelColor=_MUTED, titleColor=_MUTED),
            scale=alt.Scale(zero=False),
        ),
        y=alt.Y(
            "return:Q",
            axis=alt.Axis(format=".0%", title="Return (ann.)", labelColor=_MUTED, titleColor=_MUTED),
            scale=alt.Scale(zero=False),
        ),
    )
    line = base.mark_line(color=_ACCENT, strokeWidth=2).encode(
        tooltip=[
            alt.Tooltip("volatility:Q", format=".1%", title="Vol"),
            alt.Tooltip("return:Q",     format=".1%", title="Return"),
            alt.Tooltip("sharpe:Q",     format=".2f", title="Sharpe"),
        ]
    )

    portfolio_pts = []
    for key in ("mvo", "min_var", "risk_parity"):
        r = opt[key]
        portfolio_pts.append({
            "volatility": float(r["volatility"]),
            "return":     float(r["expected_return"]),
            "sharpe":     float(r["sharpe_ratio"]),
            "Method":     _METHOD_LABELS[key],
        })
    pt_df        = pd.DataFrame(portfolio_pts)
    method_order = [_METHOD_LABELS[k] for k in ("mvo", "min_var", "risk_parity")]
    colors       = [_METHOD_COLORS[k] for k in ("mvo", "min_var", "risk_parity")]

    color_scale = alt.Color(
        "Method:N",
        scale=alt.Scale(domain=method_order, range=colors),
        legend=None,
    )

    dots = (
        alt.Chart(pt_df)
        .mark_point(size=150, filled=True, stroke=_TEXT, strokeWidth=1.5)
        .encode(
            x="volatility:Q",
            y="return:Q",
            color=color_scale,
            tooltip=[
                "Method",
                alt.Tooltip("volatility:Q", format=".1%", title="Vol"),
                alt.Tooltip("return:Q",     format=".1%", title="Return"),
                alt.Tooltip("sharpe:Q",     format=".2f", title="Sharpe"),
            ],
        )
    )
    labels = (
        alt.Chart(pt_df)
        .mark_text(dy=-16, fontSize=10, align="center")
        .encode(
            x="volatility:Q",
            y="return:Q",
            text="Method:N",
            color=color_scale,
        )
    )

    chart = (
        (line + dots + labels)
        .properties(height=300)
        .configure(background="transparent")
        .configure_view(strokeWidth=0)
        .configure_axis(
            domainColor=_BORDER,
            gridColor="#21262d",
            tickColor=_BORDER,
            labelColor=_MUTED,
            titleColor=_MUTED,
        )
        .configure_title(color=_TEXT, fontSize=12)
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

    _render_regime_banner(data)

    rf      = data["rf_rate"]
    current = data["current_regime"]
    color   = _REGIME_COLORS.get(current, _ACCENT)

    # Context line
    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:2px 0;'>"
        f"<span style='font-size:11px;color:{_MUTED};'>"
        f"Conditioned on <span style='color:{color};font-weight:600;'>{current}</span> "
        f"regime statistics&nbsp;&nbsp;·&nbsp;&nbsp;"
        f"Max weight per asset: 40%&nbsp;&nbsp;·&nbsp;&nbsp;Risk-free rate: {rf:.2%}"
        f"</span></body>",
        height=28,
        scrolling=False,
    )

    _section_header("Portfolio Metrics", color)

    col1, col2, col3 = st.columns(3)
    with col1:
        _render_method_card("mvo", opt["mvo"], rf)
    with col2:
        _render_method_card("min_var", opt["min_var"], rf)
    with col3:
        _render_method_card("risk_parity", opt["risk_parity"], rf)

    left, right = st.columns([3, 2])
    with left:
        _render_weights_chart(opt)
    with right:
        _render_frontier_chart(opt)


# ── Risk Analysis sub-tab ──────────────────────────────────────────────────────

def _render_correlation_heatmap(corr: pd.DataFrame, regime: str) -> None:
    color  = _REGIME_COLORS.get(regime, _ACCENT)
    assets = list(corr.columns)
    n      = len(assets)

    header_cells = "".join(
        f"<th style='background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};"
        f"padding:5px 7px;font-size:11px;white-space:nowrap;"
        f"writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);'>{a}</th>"
        for a in assets
    )

    rows_html = ""
    for row_a in assets:
        cells = (
            f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
            f"padding:6px 10px;white-space:nowrap;font-size:12px;font-weight:500;'>{row_a}</td>"
        )
        for col_a in assets:
            v   = float(corr.loc[row_a, col_a])
            bg  = _corr_color(v)
            tc  = _corr_tc(v)
            cells += (
                f"<td style='background:{bg};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 4px;color:{tc};font-size:12px;font-weight:500;'>"
                f"{v:.2f}</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    size  = max(520, n * 54)
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
  table {{border-collapse:collapse;}}
</style></head>
<body>
<div style="background:{_CARD_BG};border:1px solid {_BORDER};
            border-radius:8px;padding:16px;overflow-x:auto;">
  <table>
    <thead><tr>
      <th style="background:{_CARD_BG};border:1px solid {_BORDER};padding:6px;"></th>
      {header_cells}
    </tr></thead>
    <tbody>{rows_html}</tbody>
  </table>
</div>
</body></html>"""
    components.html(html, height=size + 80, scrolling=True)


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
        overall_dd = float(overall.get(asset, np.nan)) if overall is not None else float("nan")

        row = (
            f"<tr><td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
            f"padding:7px 12px;white-space:nowrap;font-size:13px;'>{asset}</td>"
        )
        for regime in regimes_present:
            dd = float(by_regime.loc[asset, regime]) if asset in by_regime.index else float("nan")
            if np.isnan(dd):
                row += (
                    f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                    f"text-align:center;color:{_MUTED};padding:7px;'>—</td>"
                )
            else:
                tc = _dd_color(dd)
                bg = "#1a0000" if dd < -0.30 else ("#180d00" if dd < -0.15 else _CARD_BG)
                row += (
                    f"<td style='background:{bg};border:1px solid {_BORDER};"
                    f"text-align:center;padding:7px 10px;color:{tc};font-size:13px;font-weight:600;'>"
                    f"{dd:.1%}</td>"
                )

        # Overall column
        if not np.isnan(overall_dd):
            tc = _dd_color(overall_dd)
            row += (
                f"<td style='background:#0a0a0a;border:1px solid {_BORDER};"
                f"text-align:center;padding:7px 10px;color:{tc};font-size:13px;font-weight:700;'>"
                f"{overall_dd:.1%}</td>"
            )
        else:
            row += (
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;color:{_MUTED};'>—</td>"
            )
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
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
  table {{border-collapse:collapse;width:100%;}}
</style></head>
<body>
<table>
  <thead><tr>
    <th style="background:{_CARD_BG};color:{_MUTED};border:1px solid {_BORDER};
               padding:8px 14px;text-align:left;font-size:12px;">Asset Class</th>
    {header_cells}
    <th style="background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};
               padding:8px 14px;text-align:center;font-size:12px;">Overall Max DD</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table>
</body></html>"""

    n_rows = sum(1 for a in asset_classes if a in by_regime.index)
    components.html(html, height=46 * n_rows + 56, scrolling=False)


def _render_risk_analysis(data: dict) -> None:
    regime_corr = data.get("regime_correlations", {})
    drawdowns   = data.get("drawdowns", {})
    current     = data["current_regime"]
    available   = list(regime_corr.keys())

    if not available:
        st.info("Insufficient data for risk analysis.")
        return

    _section_header("Correlation by Regime")
    default_idx = available.index(current) if current in available else 0
    selected = st.selectbox("Regime", options=available, index=default_idx, key="alloc_corr_regime")
    if selected and selected in regime_corr:
        _render_correlation_heatmap(regime_corr[selected], selected)

    _section_header("Maximum Drawdown by Regime", _NEG)
    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:0 0 4px 0;'>"
        f"<span style='font-size:11px;color:{_MUTED};'>"
        f"Maximum drawdown recorded during each regime period. "
        f"<span style='color:{_WARN};'>Orange</span> &gt; −15% · "
        f"<span style='color:{_NEG};'>Red</span> &gt; −30%"
        f"</span></body>",
        height=24,
        scrolling=False,
    )
    _render_drawdown_table(drawdowns, data["asset_classes"])


# ── Main render ────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def _load_allocation_data() -> dict:
    from src.analytics.allocation import get_allocation_data
    return get_allocation_data()


def render() -> None:
    """Entry point called from dashboard/app.py."""
    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:2px 0 4px 2px;">
  <div style="border-left:3px solid {_ACCENT};padding-left:14px;">
    <div style="font-size:22px;font-weight:600;color:{_TEXT};">Asset Allocation</div>
    <div style="font-size:12px;color:{_MUTED};margin-top:4px;">
      Regime-conditional portfolio optimization &nbsp;&middot;&nbsp;
      MVO &nbsp;&middot;&nbsp; Minimum Variance &nbsp;&middot;&nbsp; Risk Parity
    </div>
  </div>
</body></html>""",
        height=68,
        scrolling=False,
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
