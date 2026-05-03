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
    "mvo":              "#4a9eff",
    "min_var":          "#2ecc71",
    "risk_parity":      "#e67e22",
    "black_litterman":  "#8b5cf6",
    "hrp":              "#e74c3c",
    "cvar":             "#f5a623",
    "herc":             "#1abc9c",
}

_METHOD_LABELS = {
    "mvo":              "Mean-Variance (MVO)",
    "min_var":          "Minimum Variance",
    "risk_parity":      "Risk Parity",
    "black_litterman":  "Black-Litterman",
    "hrp":              "Hierarchical Risk Parity",
    "cvar":             "Min CVaR (Tail Risk)",
    "herc":             "HERC",
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

_METHOD_BADGES = {
    "mvo":              "RETURN-BASED",
    "min_var":          "RISK-ONLY",
    "risk_parity":      "RISK-BALANCED",
    "black_litterman":  "EQUILIBRIUM + VIEWS",
    "hrp":              "ML-BASED",
    "cvar":             "TAIL-RISK",
    "herc":             "HIERARCHICAL",
}


def _render_method_card(key: str, result: dict, rf: float) -> None:
    label      = _METHOD_LABELS[key]
    color      = _METHOD_COLORS[key]
    badge_text = _METHOD_BADGES.get(key, "")
    ret        = result.get("expected_return", 0.0)
    vol        = result.get("volatility", 0.0)
    sharpe     = result.get("sharpe_ratio", 0.0)
    ok         = result.get("converged", True)
    note       = "" if ok else " <span style='font-size:9px;color:#8b5cf6;'>(fallback)</span>"
    ret_color  = _POS if ret >= 0 else _NEG

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * {{box-sizing:border-box;margin:0;padding:0;}}
  body {{background:{_PAGE_BG};font-family:{_FONT};padding:2px;}}
</style></head>
<body>
<div style="
    background:linear-gradient(180deg,#0d1117 0%,#0a0c10 100%);
    border-left:1px solid {_BORDER};
    border-right:1px solid {_BORDER};
    border-bottom:1px solid {_BORDER};
    border-top:3px solid {color};
    border-radius:0 0 8px 8px;
    padding:16px 20px;
">
  <div style="font-size:11px;color:{_MUTED};text-transform:uppercase;
              letter-spacing:0.1em;margin-bottom:12px;">
    {label}{note}
    <span style="font-size:8px;padding:2px 6px;background:{color}20;color:{color};
                 border-radius:4px;text-transform:uppercase;letter-spacing:0.05em;
                 margin-left:8px;">{badge_text}</span>
  </div>
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
                  text-shadow:0 0 12px {color}40;">{sharpe:.2f}</div>
    </div>
  </div>
</div>
</body></html>"""
    components.html(html, height=120, scrolling=False)


def _render_weights_chart(opt: dict) -> None:
    _section_header("Portfolio Weights by Method")

    asset_names = opt["asset_names"]
    _ALL_KEYS   = ("mvo", "min_var", "risk_parity", "black_litterman", "hrp", "cvar", "herc")
    rows = []
    for key in _ALL_KEYS:
        if key not in opt:
            continue
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
    method_order = [_METHOD_LABELS[k] for k in _ALL_KEYS if k in opt]
    colors       = [_METHOD_COLORS[k] for k in _ALL_KEYS if k in opt]

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

    _ALL_KEYS     = ("mvo", "min_var", "risk_parity", "black_litterman", "hrp")
    portfolio_pts = []
    for key in _ALL_KEYS:
        if key not in opt:
            continue
        r = opt[key]
        portfolio_pts.append({
            "volatility": float(r["volatility"]),
            "return":     float(r["expected_return"]),
            "sharpe":     float(r["sharpe_ratio"]),
            "Method":     _METHOD_LABELS[key],
        })
    pt_df        = pd.DataFrame(portfolio_pts)
    method_order = [_METHOD_LABELS[k] for k in _ALL_KEYS if k in opt]
    colors       = [_METHOD_COLORS[k] for k in _ALL_KEYS if k in opt]

    color_scale = alt.Color(
        "Method:N",
        scale=alt.Scale(domain=method_order, range=colors),
        legend=None,
    )

    dots = (
        alt.Chart(pt_df)
        .mark_point(size=180, filled=True, stroke="#ffffff", strokeWidth=2)
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


@st.cache_data(ttl=3600, show_spinner=False)
def _load_daily_returns_for_tearsheet(asset_names: tuple[str, ...]) -> pd.DataFrame:
    """Cached daily-returns fetch for the given asset classes + SPY."""
    from src.analytics.allocation import get_daily_asset_returns
    universe = list(asset_names)
    if "US Large Cap" not in universe:
        universe = ["US Large Cap"] + universe  # ensure SPY/Large-Cap proxy for benchmark
    return get_daily_asset_returns(asset_classes=universe)


def _render_tearsheet_section(opt: dict) -> None:
    """
    Institutional performance tearsheet (quantstats) for a user-chosen method.

    Takes the optimized weights, builds a static-weight daily portfolio return
    stream, and renders the full quantstats HTML report with SPY as benchmark.
    """
    _section_header("Performance Tearsheet")

    # Only include method keys actually present in opt
    available_keys = [k for k in ("mvo", "min_var", "risk_parity", "black_litterman",
                                  "hrp", "cvar", "herc") if k in opt]
    if not available_keys:
        st.info("No optimized portfolios available to tearsheet.")
        return

    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:2px 0;'>"
        f"<span style='font-size:11px;color:{_MUTED};'>"
        f"Institutional quantstats report &mdash; Sharpe, Sortino, drawdowns, "
        f"monthly heatmap, benchmark comparison vs. SPY"
        f"</span></body>",
        height=28,
        scrolling=False,
    )

    col_sel, col_btn = st.columns([3, 1])
    with col_sel:
        method_key = st.selectbox(
            "Method",
            options=available_keys,
            format_func=lambda k: _METHOD_LABELS.get(k, k),
            key="tearsheet_method_select",
        )
    with col_btn:
        st.write("")  # spacer for alignment with selectbox label
        st.write("")
        generate = st.button("Generate Tearsheet", type="primary",
                             key="tearsheet_gen_btn", use_container_width=True)

    if not generate:
        return

    asset_names = list(opt["asset_names"])
    weights_arr = np.array(opt[method_key]["weights"], dtype=float)
    weights_map = {name: float(w) for name, w in zip(asset_names, weights_arr) if w > 1e-6}

    with st.spinner("Building institutional tearsheet… (fetching daily returns, running quantstats)"):
        try:
            daily = _load_daily_returns_for_tearsheet(tuple(asset_names))
        except Exception as exc:
            st.error(f"Failed to fetch daily returns: {exc}")
            return

        try:
            from src.analytics.allocation import portfolio_daily_returns
            port_rets = portfolio_daily_returns(weights_map, daily)
            if "US Large Cap" not in daily.columns:
                st.error("Benchmark (SPY / US Large Cap) daily returns missing.")
                return
            bench_rets = daily["US Large Cap"].dropna()
            # Align indices
            common_idx = port_rets.index.intersection(bench_rets.index)
            if len(common_idx) < 250:
                st.error(f"Insufficient overlapping daily history for tearsheet "
                         f"({len(common_idx)} days). Need ≥ 250.")
                return
            port_rets  = port_rets.loc[common_idx]
            bench_rets = bench_rets.loc[common_idx]
        except Exception as exc:
            st.error(f"Failed to build portfolio return series: {exc}")
            return

        try:
            import quantstats as qs
            qs.extend_pandas()

            out_dir = Path(__file__).resolve().parent.parent.parent / "output" / "tearsheets"
            out_dir.mkdir(parents=True, exist_ok=True)
            from datetime import date as _date
            stamp = _date.today().strftime("%Y%m%d")
            out_path = out_dir / f"tearsheet_{method_key}_{stamp}.html"

            title = f"{_METHOD_LABELS[method_key]} Portfolio vs. SPY"
            qs.reports.html(
                returns=port_rets,
                benchmark=bench_rets,
                output=str(out_path),
                title=title,
                download_filename=out_path.name,
            )
        except Exception as exc:
            st.error(f"quantstats report generation failed: {exc}")
            return

    try:
        html_body = out_path.read_text()
    except Exception as exc:
        st.error(f"Failed to read generated tearsheet HTML: {exc}")
        return

    st.caption(f"Saved to `{out_path.relative_to(Path(__file__).resolve().parent.parent.parent)}`")
    components.html(html_body, height=2200, scrolling=True)


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

    # Row 1: MVO, Min Variance, Risk Parity
    col1, col2, col3 = st.columns(3)
    with col1:
        _render_method_card("mvo", opt["mvo"], rf)
    with col2:
        _render_method_card("min_var", opt["min_var"], rf)
    with col3:
        _render_method_card("risk_parity", opt["risk_parity"], rf)

    # Row 2: Black-Litterman, HRP
    col4, col5 = st.columns(2)
    with col4:
        _render_method_card("black_litterman", opt["black_litterman"], rf)
    with col5:
        _render_method_card("hrp", opt["hrp"], rf)

    # Row 3: Min CVaR, HERC (Phase 12B — riskfolio-lib)
    if "cvar" in opt and "herc" in opt:
        col6, col7 = st.columns(2)
        with col6:
            _render_method_card("cvar", opt["cvar"], rf)
        with col7:
            _render_method_card("herc", opt["herc"], rf)

    # Key Insight banner
    insight = _regime_insight(current, opt)
    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:4px 0;'>"
        f"<div style='background:linear-gradient(90deg,#4a9eff15,transparent);"
        f"border-left:3px solid {_ACCENT};padding:12px 16px;border-radius:0 6px 6px 0;'>"
        f"<div style='font-size:10px;color:{_MUTED};text-transform:uppercase;"
        f"letter-spacing:0.1em;margin-bottom:4px;'>KEY INSIGHT</div>"
        f"<div style='font-size:13px;color:{_TEXT};'>{insight}</div>"
        f"</div></body>",
        height=72,
        scrolling=False,
    )

    left, right = st.columns([3, 2])
    with left:
        _render_weights_chart(opt)
    with right:
        _render_frontier_chart(opt)

    # ── Performance Tearsheet (Phase 12B — quantstats) ──────────────────────
    _render_tearsheet_section(opt)

    # Method descriptions expander
    with st.expander("📚 Understanding the Methods", expanded=False):
        _methods_explainer_html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}} body {{background:#010409;font-family:{_FONT};padding:16px;}} .entry {{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #30363d;}} .entry:last-child {{margin-bottom:0;border-bottom:none;}}</style>
</head><body>
<div style="color:{_TEXT};font-size:13px;line-height:1.7;">
  <div class="entry">
    <div style="color:#4a9eff;font-weight:600;font-size:14px;margin-bottom:6px;">Mean-Variance (MVO)</div>
    <div style="color:{_MUTED};">Maximizes Sharpe ratio given expected returns and covariance. The foundation of modern portfolio theory (Markowitz, 1952). Sensitive to return estimates — small input changes can cause large weight swings.</div>
  </div>
  <div class="entry">
    <div style="color:#2ecc71;font-weight:600;font-size:14px;margin-bottom:6px;">Minimum Variance</div>
    <div style="color:{_MUTED};">Ignores return forecasts entirely — minimizes portfolio volatility using only the covariance matrix. Exploits the low-volatility anomaly: historically, lower-risk portfolios have delivered competitive risk-adjusted returns.</div>
  </div>
  <div class="entry">
    <div style="color:#e67e22;font-weight:600;font-size:14px;margin-bottom:6px;">Risk Parity</div>
    <div style="color:{_MUTED};">Equal risk contribution from each asset class. Addresses the hidden concentration in traditional portfolios — a 60/40 portfolio is ~90% equity risk. Popularized by Bridgewater's "All Weather" fund.</div>
  </div>
  <div class="entry">
    <div style="color:#8b5cf6;font-weight:600;font-size:14px;margin-bottom:6px;">Black-Litterman</div>
    <div style="color:{_MUTED};">Starts from market equilibrium returns (what the market implies), then blends with regime-conditional views. More stable than MVO — the industry standard for institutional asset allocation. Developed at Goldman Sachs (1992).</div>
  </div>
  <div class="entry">
    <div style="color:#e74c3c;font-weight:600;font-size:14px;margin-bottom:6px;">Hierarchical Risk Parity (HRP)</div>
    <div style="color:{_MUTED};">Machine learning approach using hierarchical clustering to group correlated assets, then allocates recursively (López de Prado, 2016). No return estimates needed. More stable than MVO and minimum variance. Cutting-edge methodology.</div>
  </div>
  <div class="entry">
    <div style="color:#f5a623;font-weight:600;font-size:14px;margin-bottom:6px;">Min CVaR (Tail Risk)</div>
    <div style="color:{_MUTED};">Minimizes expected loss in the worst 5% of scenarios (Conditional Value-at-Risk). Directly targets tail risk rather than symmetric volatility — the standard risk measure for hedge funds, insurance, and regulated institutions (Basel III).</div>
  </div>
  <div class="entry">
    <div style="color:#1abc9c;font-weight:600;font-size:14px;margin-bottom:6px;">HERC (Hierarchical Equal Risk Contribution)</div>
    <div style="color:{_MUTED};">Extension of HRP that allocates risk equally across hierarchical clusters rather than via recursive bisection. Typically produces more balanced weights in correlated universes (Raffinot, 2018).</div>
  </div>
</div>
</body></html>"""
        components.html(_methods_explainer_html, height=620, scrolling=False)

    # Timestamp footer
    from datetime import date as _date
    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:4px 0;'>"
        f"<div style='font-size:11px;color:{_MUTED};text-align:right;"
        f"padding-top:12px;border-top:1px solid {_BORDER};'>"
        f"Optimizations conditioned on {current} regime"
        f"&nbsp;&nbsp;&middot;&nbsp;&nbsp;Updated {_date.today().strftime('%Y-%m-%d')}"
        f"&nbsp;&nbsp;&middot;&nbsp;&nbsp;Risk-free rate: {rf:.2%}"
        f"</div></body>",
        height=36,
        scrolling=False,
    )


def _regime_insight(regime: str, opt: dict) -> str:
    """Generate a regime-specific insight sentence from actual optimization weights."""
    bl_weights      = dict(zip(opt["asset_names"], opt["black_litterman"]["weights"]))
    mvo_weights     = dict(zip(opt["asset_names"], opt["mvo"]["weights"]))
    min_var_weights = dict(zip(opt["asset_names"], opt["min_var"]["weights"]))
    hrp_weights     = dict(zip(opt["asset_names"], opt["hrp"]["weights"]))

    top_bl_asset  = max(bl_weights, key=bl_weights.get)
    top_bl_weight = bl_weights[top_bl_asset]

    bond_assets = ["US Agg Bond", "US Treasuries", "IG Credit"]
    avg_bonds   = (
        sum(min_var_weights.get(a, 0) for a in bond_assets)
        + sum(hrp_weights.get(a, 0)   for a in bond_assets)
    ) / 2

    equity_assets = ["US Large Cap", "US Small Cap", "Int'l Developed", "Emerging Markets"]
    mvo_equity    = sum(mvo_weights.get(a, 0) for a in equity_assets)

    if regime == "Overheating":
        return (
            f"Black-Litterman tilts toward {top_bl_asset} ({top_bl_weight:.0%})"
            f" based on historical Overheating performance"
        )
    elif regime == "Recession Risk":
        return (
            f"Defensive positioning — Min Variance and HRP favor bonds"
            f" ({avg_bonds:.0%} avg fixed income)"
        )
    elif regime == "Goldilocks":
        return f"Risk-on regime — MVO maximizes equity exposure ({mvo_equity:.0%} equities)"
    elif regime == "Stagflation":
        return "Inflation hedge regime — Gold and commodities feature prominently across methods"
    else:
        return f"Optimizations reflect {regime} regime-conditional return and covariance estimates"


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
        f"<th style='background:#161b22;color:{_REGIME_COLORS.get(r, _ACCENT)};"
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
<div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;padding:16px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:8px 14px;text-align:left;font-size:12px;">Asset Class</th>
    {header_cells}
    <th style="background:#161b22;color:{_TEXT};border:1px solid {_BORDER};
               padding:8px 14px;text-align:center;font-size:12px;">Overall Max DD</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table>
</div>
</body></html>"""

    n_rows = sum(1 for a in asset_classes if a in by_regime.index)
    components.html(html, height=46 * n_rows + 88, scrolling=False)


def _render_cvar_section(data: dict) -> None:
    """Tail Risk (CVaR / Expected Shortfall) section."""
    cvar_data     = data.get("cvar_95")
    regime_cvar   = data.get("regime_cvar", {})
    optimizations = data.get("optimizations") or {}
    current_regime = data.get("current_regime", "")

    _section_header("TAIL RISK (EXPECTED SHORTFALL)", _NEG)
    st.caption(
        "CVaR shows the average loss in the worst 5% of periods — "
        "more informative than VaR alone because it captures tail severity."
    )

    if not cvar_data or not cvar_data.get("asset_cvar"):
        st.info("No CVaR data available.")
        return

    asset_cvar = cvar_data["asset_cvar"]
    assets = list(asset_cvar.keys())

    col1, col2 = st.columns([1, 1])

    # ── Left: per-asset CVaR table ────────────────────────────────────────────
    with col1:
        rows_html = ""
        for asset in assets:
            info  = asset_cvar[asset]
            cval  = info["cvar"]
            vval  = info["var"]
            n     = info["n_periods"]
            # Red gradient: deeper red for worse (more negative) CVaR
            intensity = min(abs(cval) / 0.20, 1.0)  # 20% = max depth
            r = int(30 + intensity * 120)
            bg = f"rgba({r},0,0,0.35)"
            rows_html += (
                f"<tr>"
                f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
                f"padding:6px 10px;font-size:12px;'>{asset}</td>"
                f"<td style='background:{bg};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_NEG};font-size:12px;font-weight:600;'>"
                f"{cval:.1%}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_MUTED};font-size:12px;'>"
                f"{vval:.1%}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_MUTED};font-size:11px;'>{n}</td>"
                f"</tr>"
            )
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Asset</th>
    <th style="background:#161b22;color:{_NEG};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">CVaR 95%</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">VaR 95%</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">n</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
        n_rows = len(assets)
        components.html(html, height=46 * n_rows + 70, scrolling=False)

    # ── Right: portfolio CVaR by method ──────────────────────────────────────
    with col2:
        method_keys = ("mvo", "min_var", "risk_parity", "black_litterman", "hrp")
        method_labels = {
            "mvo": "MVO", "min_var": "Min Var", "risk_parity": "Risk Parity",
            "black_litterman": "Black-Litterman", "hrp": "HRP",
        }
        rows = []
        for key in method_keys:
            opt = optimizations.get(key)
            if opt and opt.get("cvar_95"):
                cval = opt["cvar_95"]["cvar"]
                rows.append({"method": method_labels[key], "cvar": cval, "color": _METHOD_COLORS[key]})

        if rows:
            df_cvar = pd.DataFrame(rows)
            chart = (
                alt.Chart(df_cvar)
                .mark_bar(size=22)
                .encode(
                    x=alt.X("cvar:Q", title="Portfolio CVaR 95%",
                            axis=alt.Axis(format=".1%", labelColor=_MUTED, titleColor=_MUTED,
                                          gridColor="#21262d")),
                    y=alt.Y("method:N", sort=None, title=None,
                            axis=alt.Axis(labelColor=_TEXT, labelFontSize=12)),
                    color=alt.Color("method:N",
                                    scale=alt.Scale(domain=[r["method"] for r in rows],
                                                    range=[r["color"] for r in rows]),
                                    legend=None),
                    tooltip=[
                        alt.Tooltip("method:N", title="Method"),
                        alt.Tooltip("cvar:Q", title="CVaR 95%", format=".2%"),
                    ],
                )
                .properties(
                    width="container",
                    height=180,
                    background=_BG,
                )
                .configure_view(strokeWidth=0)
                .configure_axis(domainColor=_BORDER)
            )
            st.altair_chart(chart, use_container_width=True)
        else:
            st.info("Optimize portfolios first to see portfolio CVaR.")

    # ── Expander: CVaR by regime ──────────────────────────────────────────────
    valid_regimes = {r: v for r, v in regime_cvar.items() if v is not None}
    if valid_regimes:
        with st.expander("CVaR by Regime — tail risk across macro environments"):
            st.caption(
                "Shows how the left tail varies across regimes. "
                "Recession Risk typically has 2-3× worse tail losses than Goldilocks."
            )
            # Build table: Asset × Regime CVaR
            regime_order = [r for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
                            if r in valid_regimes]
            header_cells = "".join(
                f"<th style='background:#161b22;color:{_REGIME_COLORS.get(r, _ACCENT)};"
                f"border:1px solid {_BORDER};padding:7px 12px;text-align:center;font-size:11px;'>{r}</th>"
                for r in regime_order
            )
            rows_html = ""
            for asset in assets:
                row = (
                    f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
                    f"padding:6px 10px;font-size:12px;'>{asset}</td>"
                )
                for regime in regime_order:
                    ac = valid_regimes[regime]["asset_cvar"].get(asset)
                    if ac:
                        cval = ac["cvar"]
                        intensity = min(abs(cval) / 0.20, 1.0)
                        r_ch = int(30 + intensity * 120)
                        bg = f"rgba({r_ch},0,0,0.35)"
                        row += (
                            f"<td style='background:{bg};border:1px solid {_BORDER};"
                            f"text-align:center;padding:6px 8px;color:{_NEG};"
                            f"font-size:12px;font-weight:600;'>{cval:.1%}</td>"
                        )
                    else:
                        row += (
                            f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                            f"text-align:center;color:{_MUTED};padding:6px 8px;'>—</td>"
                        )
                rows_html += f"<tr>{row}</tr>"

            html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Asset</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
            components.html(html, height=46 * len(assets) + 70, scrolling=False)

    # ── Tail risk context banner ──────────────────────────────────────────────
    if regime_cvar and current_regime and len(assets) > 0:
        ref_asset = assets[0]
        current_val = None
        worst_regime = None
        worst_val = 0
        for r, v in regime_cvar.items():
            if v and v.get("asset_cvar", {}).get(ref_asset):
                cv = abs(v["asset_cvar"][ref_asset]["cvar"])
                if r == current_regime:
                    current_val = cv
                if cv > worst_val:
                    worst_val = cv
                    worst_regime = r
        if current_val is not None and worst_regime and worst_regime != current_regime and current_val > 0:
            ratio = worst_val / current_val
            st.markdown(
                f"<div style='background:rgba(74,158,255,0.1);border-left:3px solid {_ACCENT};"
                f"padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;'>"
                f"<span style='color:{_MUTED};font-size:11px;text-transform:uppercase;'>"
                f"TAIL RISK CONTEXT</span><br>"
                f"<span style='color:{_TEXT};'>Current regime "
                f"(<span style='color:{_REGIME_COLORS.get(current_regime, _TEXT)};'>"
                f"{current_regime}</span>) has moderate tail risk. "
                f"<span style='color:{_REGIME_COLORS.get(worst_regime, _TEXT)};'>"
                f"{worst_regime}</span> historically shows {ratio:.1f}\u00d7 worse "
                f"drawdowns in the left tail.</span></div>",
                unsafe_allow_html=True,
            )


def _render_transition_pnl_section(data: dict) -> None:
    """Regime Transition Impact section."""
    all_pnl = data.get("transition_pnl") or {}

    _section_header("REGIME TRANSITION IMPACT", _ACCENT)
    st.caption(
        "Average 3-month forward returns when the regime changes. "
        "Shows which assets benefit or suffer during macro transitions."
    )

    # Filter to transitions with >= 2 occurrences
    filtered = {k: v for k, v in all_pnl.items() if v.get("count", 0) >= 2}
    if not filtered:
        st.info("Insufficient historical transitions (need ≥ 2 occurrences per pair).")
        return

    transitions = sorted(filtered.keys())
    selected = st.selectbox("Select transition:", transitions, key="transition_select")

    pnl_data = filtered.get(selected)
    if not pnl_data:
        return

    avg_ret  = pnl_data["avg_return"]
    count    = pnl_data["count"]
    st.caption(f"Based on {count} historical occurrence(s).")

    df_pnl = pd.DataFrame([
        {"asset": a, "return": v, "sign": "positive" if v >= 0 else "negative"}
        for a, v in sorted(avg_ret.items(), key=lambda x: x[1], reverse=True)
    ])

    chart = (
        alt.Chart(df_pnl)
        .mark_bar()
        .encode(
            x=alt.X("asset:N", sort="-y", title=None,
                    axis=alt.Axis(labelColor=_TEXT, labelFontSize=11, labelAngle=-30)),
            y=alt.Y("return:Q", title="Avg 3m Forward Return",
                    axis=alt.Axis(format=".1%", labelColor=_MUTED, titleColor=_MUTED,
                                  gridColor="#21262d")),
            color=alt.Color(
                "sign:N",
                scale=alt.Scale(domain=["positive", "negative"], range=[_POS, _NEG]),
                legend=None,
            ),
            tooltip=[
                alt.Tooltip("asset:N", title="Asset"),
                alt.Tooltip("return:Q", title="Avg Return", format=".2%"),
            ],
        )
        .properties(width="container", height=260, background=_BG)
        .configure_view(strokeWidth=0)
        .configure_axis(domainColor=_BORDER)
    )
    st.altair_chart(chart, use_container_width=True)


def _render_real_nominal_section(data: dict) -> None:
    """Real vs Nominal Returns section."""
    real_nominal = data.get("real_nominal")
    current_regime = data.get("current_regime", "")

    _section_header("REAL VS NOMINAL RETURNS", _WARN)
    st.caption(
        "Inflation-adjusted returns reveal the true purchasing power impact. "
        "Critical in Stagflation regimes where nominal returns can be misleading."
    )

    if not real_nominal:
        st.info("Real/nominal data unavailable (CPI series not loaded).")
        return

    show_real = st.toggle(
        "Show inflation-adjusted (real) returns", value=False, key="real_toggle"
    )

    regimes_order = [r for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
                     if r in real_nominal]
    if not regimes_order:
        st.info("No regime data for real/nominal comparison.")
        return

    # Gather all assets
    all_assets = []
    for r in regimes_order:
        for a in real_nominal[r]["nominal"].keys():
            if a not in all_assets:
                all_assets.append(a)

    header_cells = "".join(
        f"<th style='background:#161b22;color:{_REGIME_COLORS.get(r, _ACCENT)};"
        f"border:1px solid {_BORDER};padding:7px 12px;text-align:center;font-size:11px;'>"
        f"{r}<br><span style='font-size:9px;color:{_MUTED};'>"
        f"n={real_nominal[r]['n_months']}m</span></th>"
        for r in regimes_order
    )

    rows_html = ""
    for asset in all_assets:
        row = (
            f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
            f"padding:6px 10px;font-size:12px;'>{asset}</td>"
        )
        for regime in regimes_order:
            nom_val  = real_nominal[regime]["nominal"].get(asset, float("nan"))
            real_val = real_nominal[regime]["real"].get(asset, float("nan"))
            display  = real_val if show_real else nom_val

            if np.isnan(display):
                row += (
                    f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                    f"text-align:center;color:{_MUTED};padding:6px 8px;'>—</td>"
                )
                continue

            # Color background by sign
            if display > 0:
                bg = "rgba(46,204,113,0.12)"
                tc = _POS
            else:
                bg = "rgba(231,76,60,0.15)"
                tc = _NEG

            # Inflation erosion warning: nominal positive but real negative
            erosion_html = ""
            if not show_real and nom_val > 0 and real_val < 0:
                erosion_html = (
                    f"<br><span style='color:{_WARN};font-size:9px;'>&#9888; inflation erosion</span>"
                )

            row += (
                f"<td style='background:{bg};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{tc};font-size:12px;font-weight:600;'>"
                f"{display:.1%}{erosion_html}</td>"
            )
        rows_html += f"<tr>{row}</tr>"

    label = "Real (Inflation-Adj)" if show_real else "Nominal"
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Asset ({label})</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
    n_rows = len(all_assets)
    components.html(html, height=52 * n_rows + 80, scrolling=False)

    # ── Inflation erosion alert ───────────────────────────────────────────────
    if real_nominal and current_regime and current_regime in real_nominal:
        regime_data = real_nominal[current_regime]
        nom_vals = regime_data.get("nominal", {})
        real_vals = regime_data.get("real", {})
        erosion_assets = [a for a in nom_vals
                          if nom_vals.get(a, 0) > 0 and real_vals.get(a, 0) < 0]
        if erosion_assets:
            names = ", ".join(erosion_assets[:4])
            suffix = f" (+{len(erosion_assets) - 4} more)" if len(erosion_assets) > 4 else ""
            st.markdown(
                f"<div style='background:rgba(230,126,34,0.1);border-left:3px solid {_WARN};"
                f"padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;'>"
                f"<span style='color:{_MUTED};font-size:11px;text-transform:uppercase;'>"
                f"INFLATION ALERT</span><br>"
                f"<span style='color:{_TEXT};'>In {current_regime}, "
                f"{len(erosion_assets)} asset(s) show positive nominal returns but negative "
                f"real returns \u2014 inflation is eroding purchasing power: "
                f"{names}{suffix}.</span></div>",
                unsafe_allow_html=True,
            )


def _render_factor_section(data: dict) -> None:
    """Factor decomposition — regime factor performance + portfolio exposures."""
    regime_factors    = data.get("regime_factors")
    portfolio_factors = data.get("portfolio_factors", {})

    _section_header("FACTOR DECOMPOSITION", _ACCENT)
    st.caption(
        "Portfolio exposure to Value, Momentum, Quality, Size, and Low Vol factors. "
        "Shows which systematic risks you're actually taking."
    )

    if not regime_factors:
        st.info("Factor data not available.")
        return

    col1, col2 = st.columns([1, 1])

    # ── Left: Factor × Regime heatmap table ───────────────────────────────────
    with col1:
        factors = list(next(iter(regime_factors.values())).keys())
        regime_order = [r for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
                        if r in regime_factors]

        header_cells = "".join(
            f"<th style='background:#161b22;color:{_REGIME_COLORS.get(r, _ACCENT)};"
            f"border:1px solid {_BORDER};padding:7px 12px;text-align:center;font-size:11px;'>{r}</th>"
            for r in regime_order
        )
        rows_html = ""
        for factor in factors:
            row = (
                f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
                f"padding:6px 10px;font-size:12px;font-weight:500;'>{factor}</td>"
            )
            for regime in regime_order:
                val = regime_factors[regime].get(factor, float("nan"))
                if np.isnan(val):
                    row += (
                        f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                        f"text-align:center;color:{_MUTED};padding:6px 8px;'>—</td>"
                    )
                else:
                    tc = _POS if val >= 0 else _NEG
                    bg = "rgba(46,204,113,0.12)" if val >= 0 else "rgba(231,76,60,0.15)"
                    row += (
                        f"<td style='background:{bg};border:1px solid {_BORDER};"
                        f"text-align:center;padding:6px 8px;color:{tc};"
                        f"font-size:12px;font-weight:600;'>{val:+.1%}</td>"
                    )
            rows_html += f"<tr>{row}</tr>"

        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Factor</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
        components.html(html, height=46 * len(factors) + 70, scrolling=False)

    # ── Right: Portfolio factor exposures (betas) bar chart ───────────────────
    with col2:
        if not portfolio_factors:
            st.info("Optimize portfolios first to see factor exposures.")
            return

        method_labels = {
            "mvo": "MVO", "min_var": "Min Var", "risk_parity": "Risk Parity",
            "black_litterman": "Black-Litterman", "hrp": "HRP",
        }
        rows = []
        for key in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp"):
            if key in portfolio_factors:
                for factor, beta in portfolio_factors[key]["exposures"].items():
                    rows.append({
                        "Factor": factor,
                        "Beta":   beta,
                        "Method": method_labels[key],
                    })

        if not rows:
            st.info("No factor exposure data.")
            return

        df = pd.DataFrame(rows)
        method_order = [method_labels[k] for k in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp")
                        if k in portfolio_factors]
        colors = [_METHOD_COLORS[k] for k in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp")
                  if k in portfolio_factors]

        chart = (
            alt.Chart(df)
            .mark_bar(size=10)
            .encode(
                x=alt.X("Beta:Q", title="Factor Beta",
                        axis=alt.Axis(format=".2f", labelColor=_MUTED, titleColor=_MUTED,
                                      gridColor="#21262d")),
                y=alt.Y("Factor:N", sort=None, title=None,
                        axis=alt.Axis(labelColor=_TEXT, labelFontSize=11)),
                color=alt.Color("Method:N",
                                scale=alt.Scale(domain=method_order, range=colors),
                                legend=alt.Legend(orient="bottom", labelColor=_TEXT,
                                                  titleColor=_MUTED, titleFontSize=10)),
                xOffset="Method:N",
                tooltip=["Factor", "Method", alt.Tooltip("Beta:Q", format=".3f")],
            )
            .properties(width="container", height=240, background=_BG)
            .configure_view(strokeWidth=0)
            .configure_axis(domainColor=_BORDER, gridColor="#21262d",
                            tickColor=_BORDER, labelColor=_MUTED, titleColor=_MUTED)
            .configure_legend(labelColor=_MUTED, titleColor=_MUTED)
        )
        st.altair_chart(chart, use_container_width=True)

        st.caption(
            "Positive beta = tilted toward factor \u00b7 "
            "Negative = tilted away \u00b7 "
            "Higher |\u03b2| = stronger exposure"
        )

    # ── R²/α metric cards ────────────────────────────────────────────────────
    card_items = []
    for key in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp"):
        if key in portfolio_factors:
            r2  = portfolio_factors[key]["r_squared"]
            alp = portfolio_factors[key]["alpha"]
            card_items.append((method_labels[key], r2, alp, _METHOD_COLORS[key]))

    if card_items:
        cards_html = "".join(
            f"<div style='flex:1;min-width:140px;background:{_CARD_BG};"
            f"border:1px solid {_BORDER};border-top:3px solid {color};"
            f"border-radius:6px;padding:10px 12px;text-align:center;'>"
            f"<div style='color:{_MUTED};font-size:10px;text-transform:uppercase;"
            f"margin-bottom:6px;'>{label}</div>"
            f"<div style='color:{_TEXT};font-size:16px;font-weight:700;'>"
            f"R\u00b2={r2:.0%}</div>"
            f"<div style='color:{_POS if alp >= 0 else _NEG};font-size:12px;"
            f"margin-top:2px;'>\u03b1={alp:+.1%}</div>"
            f"</div>"
            for label, r2, alp, color in card_items
        )
        st.markdown(
            f"<div style='display:flex;gap:10px;margin:16px 0;'>{cards_html}</div>",
            unsafe_allow_html=True,
        )

    # ── Key Insight banner ────────────────────────────────────────────────────
    if portfolio_factors:
        best_key = max(portfolio_factors, key=lambda k: portfolio_factors[k].get("r_squared", 0))
        best_r2 = portfolio_factors[best_key]["r_squared"] * 100
        best_label = method_labels.get(best_key, best_key)
        st.markdown(
            f"<div style='background:rgba(74,158,255,0.1);border-left:3px solid {_ACCENT};"
            f"padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;'>"
            f"<span style='color:{_MUTED};font-size:11px;text-transform:uppercase;'>"
            f"KEY INSIGHT</span><br>"
            f"<span style='color:{_TEXT};'>{best_label} has the highest factor explanatory "
            f"power (R\u00b2={best_r2:.0f}%), meaning its returns are most predictable from "
            f"systematic factor exposures.</span></div>",
            unsafe_allow_html=True,
        )


def _render_style_section(data: dict) -> None:
    """Style / manager selection by regime."""
    style_data = data.get("style_performance")

    _section_header("STYLE SELECTION", _ACCENT)
    st.caption(
        "Growth vs Value, Small vs Large, Active vs Passive performance by regime. "
        "Guides manager and style tilts."
    )

    if not style_data:
        st.info("Style data not available.")
        return

    regime_options = [r for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
                      if r in style_data]
    if not regime_options:
        st.info("Insufficient data for style analysis.")
        return

    current = data.get("current_regime", regime_options[0])
    default_idx = regime_options.index(current) if current in regime_options else 0
    regime = st.selectbox("Select regime:", regime_options, index=default_idx, key="style_regime_select")

    regime_styles = style_data.get(regime, {})
    if not regime_styles:
        st.warning(f"No data for {regime}.")
        return

    col1, col2 = st.columns([1, 1])

    # ── Left: Style performance table ─────────────────────────────────────────
    with col1:
        # Separate core styles from spreads
        core_styles = {k: v for k, v in regime_styles.items() if "Spread" not in k}
        sorted_styles = sorted(core_styles.items(), key=lambda x: x[1].get("sharpe", 0), reverse=True)

        rows_html = ""
        for style, stats in sorted_styles:
            ret  = stats["return"]
            vol  = stats["volatility"]
            sh   = stats["sharpe"]
            hr   = stats["hit_rate"]
            tc   = _POS if ret >= 0 else _NEG
            rows_html += (
                f"<tr>"
                f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
                f"padding:6px 10px;font-size:12px;'>{style}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{tc};font-size:12px;font-weight:600;'>"
                f"{ret:+.1%}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_MUTED};font-size:12px;'>{vol:.1%}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_TEXT};font-size:12px;font-weight:600;'>"
                f"{sh:.2f}</td>"
                f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                f"text-align:center;padding:6px 8px;color:{_MUTED};font-size:12px;'>{hr:.0%}</td>"
                f"</tr>"
            )

        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Style</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">Return</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">Vol</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">Sharpe</th>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:center;font-size:11px;">Hit Rate</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
        components.html(html, height=46 * len(sorted_styles) + 70, scrolling=False)

    # ── Right: Spread analysis cards ──────────────────────────────────────────
    with col2:
        spreads = {k: v for k, v in regime_styles.items() if "Spread" in k}
        for spread_name, spread_data in spreads.items():
            val = spread_data.get("return", 0)
            tc  = _POS if val >= 0 else _NEG
            arrow = "&#9650;" if val >= 0 else "&#9660;"
            components.html(
                f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="background:{_PAGE_BG};font-family:monospace;margin:0;padding:4px;">
<div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
            padding:16px;margin-bottom:8px;">
  <div style="font-size:11px;color:{_MUTED};text-transform:uppercase;letter-spacing:0.1em;">
    {spread_name}
  </div>
  <div style="font-size:28px;font-weight:700;color:{tc};margin-top:6px;">
    {arrow} {val:+.1%}
  </div>
  <div style="font-size:10px;color:{_MUTED};margin-top:4px;">
    Annualised spread in {regime}
  </div>
</div></body></html>""",
                height=110,
                scrolling=False,
            )


def _render_currency_section(data: dict) -> None:
    """Currency overlay — FX performance by regime."""
    currency_data = data.get("currency_impact")

    _section_header("CURRENCY OVERLAY", _ACCENT)
    st.caption(
        "FX impact on international portfolios by regime. "
        "USD tends to strengthen in Recession Risk (safe haven); EM FX weakens in stress."
    )

    if not currency_data:
        st.info("Currency data not available.")
        return

    regime_order = [r for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
                    if r in currency_data]
    if not regime_order:
        return

    # Gather all currency names
    currencies = list(next(iter(currency_data.values())).keys())

    header_cells = "".join(
        f"<th style='background:#161b22;color:{_REGIME_COLORS.get(r, _ACCENT)};"
        f"border:1px solid {_BORDER};padding:7px 12px;text-align:center;font-size:11px;'>{r}</th>"
        for r in regime_order
    )

    rows_html = ""
    for ccy in currencies:
        row = (
            f"<td style='background:{_CARD_BG};color:{_TEXT};border:1px solid {_BORDER};"
            f"padding:6px 10px;font-size:12px;font-weight:500;'>{ccy}</td>"
        )
        for regime in regime_order:
            info = currency_data[regime].get(ccy)
            if info is None:
                row += (
                    f"<td style='background:{_CARD_BG};border:1px solid {_BORDER};"
                    f"text-align:center;color:{_MUTED};padding:6px 8px;'>—</td>"
                )
            else:
                val = info["return"]
                vol = info["volatility"]
                tc  = _POS if val >= 0 else _NEG
                bg  = "rgba(46,204,113,0.12)" if val >= 0 else "rgba(231,76,60,0.15)"
                row += (
                    f"<td style='background:{bg};border:1px solid {_BORDER};"
                    f"text-align:center;padding:6px 8px;'>"
                    f"<span style='color:{tc};font-size:12px;font-weight:600;'>{val:+.1%}</span>"
                    f"<br><span style='color:{_MUTED};font-size:9px;'>vol {vol:.1%}</span>"
                    f"</td>"
                )
        rows_html += f"<tr>{row}</tr>"

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>* {{box-sizing:border-box;margin:0;padding:0;}}
body {{background:{_PAGE_BG};font-family:monospace;padding:2px;}}
table {{border-collapse:collapse;width:100%;}}</style></head>
<body><div style="background:{_CARD_BG};border:1px solid {_BORDER};border-radius:8px;
                 padding:12px;overflow-x:auto;">
<table>
  <thead><tr>
    <th style="background:#161b22;color:{_MUTED};border:1px solid {_BORDER};
               padding:7px 10px;text-align:left;font-size:11px;">Currency</th>
    {header_cells}
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table></div></body></html>"""
    components.html(html, height=52 * len(currencies) + 70, scrolling=False)


def _render_risk_analysis(data: dict) -> None:
    regime_corr = data.get("regime_correlations", {})
    drawdowns   = data.get("drawdowns", {})
    current     = data["current_regime"]
    available   = list(regime_corr.keys())

    if not available:
        st.info("Insufficient data for risk analysis.")
        return

    _divider = "<hr style='border:none;border-top:1px solid #21262d;margin:32px 0;'>"

    # Ordered: most impressive first, traditional last
    _render_factor_section(data)
    st.markdown(_divider, unsafe_allow_html=True)
    _render_style_section(data)
    st.markdown(_divider, unsafe_allow_html=True)
    _render_cvar_section(data)
    st.markdown(_divider, unsafe_allow_html=True)
    _render_transition_pnl_section(data)
    st.markdown(_divider, unsafe_allow_html=True)
    _render_currency_section(data)
    st.markdown(_divider, unsafe_allow_html=True)
    _render_real_nominal_section(data)
    st.markdown(_divider, unsafe_allow_html=True)

    _section_header("Correlation by Regime")
    default_idx = available.index(current) if current in available else 0
    selected = st.selectbox("Regime", options=available, index=default_idx, key="alloc_corr_regime")
    if selected and selected in regime_corr:
        _render_correlation_heatmap(regime_corr[selected], selected)
    st.markdown(_divider, unsafe_allow_html=True)

    _section_header("Maximum Drawdown by Regime", _NEG)
    components.html(
        f"<body style='background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:0 0 4px 0;'>"
        f"<span style='font-size:11px;color:{_MUTED};'>"
        f"Maximum drawdown recorded during each regime period. "
        f"<span style='color:{_WARN};'>Orange</span> &gt; \u2212 15% \u00b7 "
        f"<span style='color:{_NEG};'>Red</span> &gt; \u221230%"
        f"</span></body>",
        height=24,
        scrolling=False,
    )
    _render_drawdown_table(drawdowns, data["asset_classes"])

    # ── Timestamp footer ──────────────────────────────────────────────────────
    from datetime import date as _date
    regime_color = _REGIME_COLORS.get(current, _TEXT)
    st.markdown(
        f"<div style='text-align:right;color:{_MUTED};font-size:11px;margin-top:32px;"
        f"padding-top:16px;border-top:1px solid {_BORDER};'>"
        f"Risk analytics conditioned on "
        f"<span style='color:{regime_color};'>{current}</span> regime \u00b7 "
        f"Updated {_date.today().strftime('%Y-%m-%d')} \u00b7 "
        f"{data.get('n_months', '?')} months of history"
        f"</div>",
        unsafe_allow_html=True,
    )


# ── Main render ────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def _load_allocation_data() -> dict:
    from src.analytics.allocation import get_allocation_data
    return get_allocation_data()


def render() -> None:
    """Entry point called from dashboard/app.py."""
    from utils.tab_context import register_tab_context
    register_tab_context("Asset Allocation", {
        "shows": "regime-conditional asset return stats, optimization methods (MVO / min-var / risk-parity), efficient frontier",
        "key_tools": ["query_database"],
        "tables": ["factor_data", "market_daily"],
    })
    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="background:{_PAGE_BG};font-family:{_FONT};margin:0;padding:2px 0 4px 2px;">
  <div style="border-left:3px solid {_ACCENT};padding-left:14px;">
    <div style="font-size:22px;font-weight:600;color:{_TEXT};">Asset Allocation</div>
    <div style="font-size:12px;color:{_MUTED};margin-top:4px;">
      Regime-conditional portfolio optimization &nbsp;&mdash;&nbsp; 7 institutional methods
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
