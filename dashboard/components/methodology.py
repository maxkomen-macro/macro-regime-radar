"""
dashboard/components/methodology.py — Methodology tab content.

Renders 5 sections with real values extracted from src/regimes.py,
src/signals.py, and src/config.py.
"""

import streamlit as st

from components.shared_styles import section_header

# ─────────────────────────────────────────────────────────────────────────────
# Shared HTML helpers
# ─────────────────────────────────────────────────────────────────────────────

_TABLE_STYLE = (
    "width:100%;border-collapse:collapse;font-size:12px;"
    "color:#c9d1d9;margin-bottom:4px"
)
_TH_STYLE = (
    "background:#21262d;color:#8899aa;font-weight:600;font-size:11px;"
    "text-transform:uppercase;letter-spacing:0.4px;padding:7px 10px;"
    "border:0.5px solid #21262d;text-align:left"
)
_TD_STYLE = (
    "padding:7px 10px;border:0.5px solid #21262d;"
    "vertical-align:top;line-height:1.5"
)
_TD_ALT_STYLE = (
    "padding:7px 10px;border:0.5px solid #21262d;"
    "vertical-align:top;line-height:1.5;background:#0d1117"
)

_REGIME_BADGES = {
    "Goldilocks":     "background:rgba(63,185,80,0.12);color:#3fb950;border:0.5px solid rgba(63,185,80,0.25)",
    "Overheating":    "background:rgba(218,54,51,0.12);color:#f08785;border:0.5px solid rgba(218,54,51,0.25)",
    "Stagflation":    "background:rgba(210,153,34,0.12);color:#d29922;border:0.5px solid rgba(210,153,34,0.25)",
    "Recession Risk": "background:rgba(218,54,51,0.20);color:#f08785;border:0.5px solid rgba(218,54,51,0.40)",
}


def _badge(regime: str) -> str:
    style = _REGIME_BADGES.get(regime, "background:#21262d;color:#8899aa")
    return (
        f'<span style="{style};padding:2px 8px;border-radius:4px;'
        f'font-size:11px;font-weight:700;white-space:nowrap">{regime}</span>'
    )


def _panel(html: str) -> str:
    return (
        f'<div style="background:#161b22;border:0.5px solid #21262d;'
        f'border-radius:6px;padding:16px 18px;margin-bottom:4px">'
        f'{html}</div>'
    )


def _prose(text: str) -> str:
    return (
        f'<p style="font-size:13px;color:#c9d1d9;line-height:1.6;margin:8px 0 0 0">'
        f'{text}</p>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# Section renderers
# ─────────────────────────────────────────────────────────────────────────────

def _render_regime_framework() -> None:
    section_header("REGIME FRAMEWORK")

    regime_table = f"""
<table style="{_TABLE_STYLE}">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Regime</th>
      <th style="{_TH_STYLE}">Growth Trend</th>
      <th style="{_TH_STYLE}">Inflation Trend</th>
      <th style="{_TH_STYLE}">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}">{_badge("Goldilocks")}</td>
      <td style="{_TD_STYLE}">Rising (slope &gt; 0)</td>
      <td style="{_TD_STYLE}">Falling (slope ≤ 0)</td>
      <td style="{_TD_STYLE}">Growth accelerating, inflation cooling — historically favorable for risk assets.</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">{_badge("Overheating")}</td>
      <td style="{_TD_ALT_STYLE}">Rising (slope &gt; 0)</td>
      <td style="{_TD_ALT_STYLE}">Rising (slope &gt; 0)</td>
      <td style="{_TD_ALT_STYLE}">Both growth and inflation trending up — late-cycle risk; central bank tightening likely.</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">{_badge("Stagflation")}</td>
      <td style="{_TD_STYLE}">Falling (slope ≤ 0)</td>
      <td style="{_TD_STYLE}">Rising (slope &gt; 0)</td>
      <td style="{_TD_STYLE}">Growth slowing, inflation rising — worst macro combination; real assets historically outperform.</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">{_badge("Recession Risk")}</td>
      <td style="{_TD_ALT_STYLE}">Falling (slope ≤ 0)</td>
      <td style="{_TD_ALT_STYLE}">Falling (slope ≤ 0)</td>
      <td style="{_TD_ALT_STYLE}">Both growth and inflation falling — deflationary slowdown; duration and defensive assets favored.</td>
    </tr>
  </tbody>
</table>"""

    st.markdown(_panel(regime_table), unsafe_allow_html=True)

    st.markdown(
        _panel(
            _prose(
                "<b>Growth trend</b> is the OLS slope of the <b>Industrial Production Index (INDPRO)</b> "
                "over a rolling 3-month window. The slope is computed via linear regression "
                "(ordinary least squares using the dot-product formula) on the last 3 monthly observations. "
                "A positive slope means industrial production is accelerating over that window; "
                "negative means it is decelerating."
            ) +
            _prose(
                "<b>Inflation trend</b> uses the same 3-month rolling OLS slope applied to "
                "<b>CPI All Urban Consumers (CPIAUCSL)</b>. The sign of the slope — not its magnitude — "
                "determines the quadrant. Both series are sourced from FRED and updated monthly."
            ) +
            _prose(
                "<b>Conviction</b> measures how far current conditions are from regime boundaries. "
                "It is derived from expanding-window z-scores of both trend series: "
                "<code>z = (value − expanding_mean) / expanding_std</code>. "
                "The combined magnitude is "
                "<code>(|z_growth| + |z_inflation|) / 2</code>, "
                "then transformed to a 0–95% scale: "
                "<code>conviction = min(0.95, combined / (combined + 1))</code>. "
                "A score of 50% means conditions are at their historical average distance from a boundary; "
                "95% is the cap. This is a statistical distance measure, not a probability estimate."
            )
        ),
        unsafe_allow_html=True,
    )


def _render_signal_definitions() -> None:
    section_header("SIGNAL DEFINITIONS")

    signal_table = f"""
<table style="{_TABLE_STYLE}">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Signal</th>
      <th style="{_TH_STYLE}">Measures</th>
      <th style="{_TH_STYLE}">Trigger Threshold</th>
      <th style="{_TH_STYLE}">Direction</th>
      <th style="{_TH_STYLE}">Source</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Curve inversion risk</span></td>
      <td style="{_TD_STYLE}">10Y − 2Y Treasury spread</td>
      <td style="{_TD_STYLE}">0.00%</td>
      <td style="{_TD_STYLE}">Triggers when spread falls <b>below</b> 0%</td>
      <td style="{_TD_STYLE}">FRED: DGS10, DGS2</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Unemployment spike</span></td>
      <td style="{_TD_ALT_STYLE}">3-month change in unemployment rate (UNRATE)</td>
      <td style="{_TD_ALT_STYLE}">+0.30 pp over 3 months</td>
      <td style="{_TD_ALT_STYLE}">Triggers when 3-month rise exceeds <b>+0.3 pp</b></td>
      <td style="{_TD_ALT_STYLE}">FRED: UNRATE</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Inflation pressure</span></td>
      <td style="{_TD_STYLE}">CPI year-over-year (CPIAUCSL)</td>
      <td style="{_TD_STYLE}">4.0% YoY</td>
      <td style="{_TD_STYLE}">Triggers when CPI YoY rises <b>above</b> 4.0%</td>
      <td style="{_TD_STYLE}">FRED: CPIAUCSL</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Disinflation signal</span></td>
      <td style="{_TD_ALT_STYLE}">CPI year-over-year (CPIAUCSL)</td>
      <td style="{_TD_ALT_STYLE}">1.0% YoY</td>
      <td style="{_TD_ALT_STYLE}">Triggers when CPI YoY falls <b>below</b> 1.0%</td>
      <td style="{_TD_ALT_STYLE}">FRED: CPIAUCSL</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">VIX spike</span></td>
      <td style="{_TD_STYLE}">CBOE Volatility Index, monthly average</td>
      <td style="{_TD_STYLE}">30.0</td>
      <td style="{_TD_STYLE}">Triggers when monthly VIX rises <b>above</b> 30</td>
      <td style="{_TD_STYLE}">FRED: VIXCLS</td>
    </tr>
  </tbody>
</table>"""

    st.markdown(_panel(signal_table), unsafe_allow_html=True)


def _render_threshold_proximity() -> None:
    section_header("THRESHOLD PROXIMITY")

    proximity_table = f"""
<table style="{_TABLE_STYLE};margin-top:10px">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Status</th>
      <th style="{_TH_STYLE}">Gauge Fill</th>
      <th style="{_TH_STYLE}">Meaning</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950"></span>
          <span style="color:#3fb950;font-weight:600">Clear</span>
        </span>
      </td>
      <td style="{_TD_STYLE}">Below 50%</td>
      <td style="{_TD_STYLE}">Indicator is well below its trigger level — no immediate concern.</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d29922"></span>
          <span style="color:#d29922;font-weight:600">Watch</span>
        </span>
      </td>
      <td style="{_TD_ALT_STYLE}">50–75%</td>
      <td style="{_TD_ALT_STYLE}">Indicator is approaching its threshold — elevated attention warranted.</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#da3633"></span>
          <span style="color:#da3633;font-weight:600">Triggered</span>
        </span>
      </td>
      <td style="{_TD_STYLE}">Above 75%</td>
      <td style="{_TD_STYLE}">Indicator has crossed or is near its trigger level — signal is active.</td>
    </tr>
  </tbody>
</table>"""

    content = (
        _prose(
            "The gauge bars on the signal monitor indicate how close each indicator is to its trigger threshold. "
            "A higher fill percentage means the indicator is closer to crossing its trigger level."
        ) +
        _prose(
            "For <b>above-direction</b> signals (unemployment spike, inflation pressure, VIX spike): "
            "<code>fill% = (current_value / threshold) × 100</code>. "
            "For <b>below-direction</b> signals (curve inversion risk, disinflation signal): "
            "<code>fill% = (threshold / current_value) × 100</code>, "
            "capped at 100% once the indicator crosses the threshold."
        ) +
        proximity_table
    )
    st.markdown(_panel(content), unsafe_allow_html=True)


def _render_data_sources() -> None:
    section_header("DATA SOURCES & UPDATE CADENCE")

    sources_html = f"""
<table style="{_TABLE_STYLE}">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Source</th>
      <th style="{_TH_STYLE}">Series / Assets</th>
      <th style="{_TH_STYLE}">Frequency</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">FRED</span></td>
      <td style="{_TD_STYLE}">INDPRO, CPIAUCSL, DGS10, DGS2, UNRATE, VIXCLS,<br>FEDFUNDS, SOFR, T5YIE, T10YIE, DFII5, DFII10</td>
      <td style="{_TD_STYLE}">Monthly (daily series resampled to month-end)</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Polygon.io</span></td>
      <td style="{_TD_ALT_STYLE}">SPY, QQQ, IWM, TLT, HYG, LQD, UUP, GLD, USO</td>
      <td style="{_TD_ALT_STYLE}">Daily (OHLCV + derived returns)</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Manual</span></td>
      <td style="{_TD_STYLE}">events/calendar.csv — upcoming macro releases</td>
      <td style="{_TD_STYLE}">Updated as needed</td>
    </tr>
  </tbody>
</table>"""

    schedule_html = f"""
<table style="{_TABLE_STYLE};margin-top:12px">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Pipeline step</th>
      <th style="{_TH_STYLE}">Schedule</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}">FRED macro fetch + regime/signal computation</td>
      <td style="{_TD_STYLE}">Daily at 11:00 UTC (GitHub Actions cron)</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">Market data fetch (Polygon.io)</td>
      <td style="{_TD_ALT_STYLE}">Daily incremental, same workflow</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">Analytics suite (surprise, alerts, priced, playbook)</td>
      <td style="{_TD_STYLE}">Daily, sequenced after data fetch</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">Dashboard refresh</td>
      <td style="{_TD_ALT_STYLE}">On every page load (5-min cache TTL)</td>
    </tr>
  </tbody>
</table>"""

    st.markdown(_panel(sources_html + schedule_html), unsafe_allow_html=True)


def _render_methodology_notes() -> None:
    section_header("METHODOLOGY NOTES")

    notes = [
        (
            "Rules-based regime classification. Growth and inflation trends are derived from "
            "3-month rolling OLS slopes of INDPRO and CPIAUCSL respectively. The sign of each slope "
            "— not its magnitude — determines the regime quadrant. The system is fully deterministic: "
            "given the same input data, it always produces the same output. There are no discretionary overrides."
        ),
        (
            "Signal thresholds are based on historical precedent and standard macro monitoring conventions "
            "(e.g., yield curve inversion at 0%, VIX stress at 30). They were not optimized or fitted to "
            "backtest performance. Changing thresholds to improve historical hit rates would constitute "
            "data snooping and is intentionally avoided."
        ),
        (
            "Historical analysis covers approximately 30 years (back to ~1994, limited by FRED series availability), "
            "capturing the dot-com boom/bust, the 2008 global financial crisis, COVID shock, "
            "and the 2021–2024 inflation surge and normalization cycle."
        ),
        (
            "Conviction scores reflect the statistical distance of current trend z-scores from their "
            "historical average, transformed to a 0–95% scale. They are not probability estimates and "
            "should not be interpreted as the likelihood of a regime persisting or reversing."
        ),
    ]

    bullets_html = "".join(
        f'<p style="font-size:13px;color:#8899aa;line-height:1.6;margin:0 0 10px 0">'
        f'<span style="color:#484f58;margin-right:6px">—</span>{note}</p>'
        for note in notes
    )
    st.markdown(_panel(bullets_html), unsafe_allow_html=True)


def _render_recession_model() -> None:
    section_header("RECESSION PROBABILITY MODEL")

    intro = _prose(
        "The Recession Risk tab runs a standalone <b>logistic regression</b> model trained on "
        "NBER recession dates. The model is entirely rules-based — no judgment overrides, no "
        "parameter tuning to improve backtest performance."
    )

    model_table = f"""
<table style="{_TABLE_STYLE};margin-top:10px">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Component</th>
      <th style="{_TH_STYLE}">Detail</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Model type</span></td>
      <td style="{_TD_STYLE}">Logistic regression (sklearn LogisticRegression, C=1.0, class_weight=balanced)</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Training target</span></td>
      <td style="{_TD_ALT_STYLE}">NBER USREC indicator (monthly 0/1) — falls back to hardcoded NBER dates if USREC absent from DB</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Features (5)</span></td>
      <td style="{_TD_STYLE}">
        yield_curve (DGS10−DGS2, %), unemployment (UNRATE, %),
        hy_spread (BAMLH0A0HYM2, bps), indpro_yoy (INDPRO 12m % chg),
        lei_proxy (USSLIND or T10YIE−T5YIE fallback)
      </td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Look-ahead bias control</span></td>
      <td style="{_TD_ALT_STYLE}">All features are lagged 3 months before both training and inference</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Output</span></td>
      <td style="{_TD_STYLE}">12-month recession probability (0–100%); thresholds: Low &lt;20%, Elevated 20–40%, High ≥40%</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Retraining cadence</span></td>
      <td style="{_TD_ALT_STYLE}">Retrained on every dashboard cold start (@st.cache_resource); no stored model weights</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><span style="color:#e6edf3;font-weight:500">Yield curve percentile</span></td>
      <td style="{_TD_STYLE}">Computed vs 30yr history in % units (not basis points) to avoid unit mismatch</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><span style="color:#e6edf3;font-weight:500">Macro divergence</span></td>
      <td style="{_TD_ALT_STYLE}">
        HY OAS percentile rank (market signal) minus regime prob_recession (macro signal).
        &gt;+20: &ldquo;Markets ahead of macro&rdquo; &middot; &lt;−20: &ldquo;Macro ahead of markets&rdquo; &middot; otherwise &ldquo;Aligned&rdquo;
      </td>
    </tr>
  </tbody>
</table>"""

    limitation = _prose(
        "<b>Limitation:</b> NBER declares recessions retroactively — USREC may show 0 for recent "
        "months even if a recession has begun. Only 4 recessions appear in the training sample since "
        "1990 (small sample). Treat probabilities above 40% as a heightened-vigilance trigger, "
        "not a confirmed recession call."
    )

    st.markdown(_panel(intro + model_table + limitation), unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def _render_lbo_calculator() -> None:
    section_header("LBO CALCULATOR")

    # Overview
    st.markdown(
        _panel(
            _prose(
                "Interactive leveraged buyout model with live market data integration. "
                "Calculates equity returns (IRR, MOIC) for a hypothetical PE acquisition."
            )
        ),
        unsafe_allow_html=True,
    )

    # Data sources + Model mechanics side by side
    data_sources = f"""
<table style="{_TABLE_STYLE}">
  <thead><tr>
    <th style="{_TH_STYLE}">Series</th>
    <th style="{_TH_STYLE}">Description</th>
  </tr></thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}"><code style="font-size:11px;color:#79c0ff">FEDFUNDS</code></td>
      <td style="{_TD_STYLE}">Fed Funds Rate (FRED, daily)</td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}"><code style="font-size:11px;color:#79c0ff">BAMLH0A0HYM2</code></td>
      <td style="{_TD_ALT_STYLE}">ICE BofA US High Yield OAS — stored as % in FRED (e.g. 3.27 = 327 bps)</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">All-in Cost</td>
      <td style="{_TD_STYLE}">Fed Funds + HY Spread (pre-populates interest rate slider)</td>
    </tr>
  </tbody>
</table>"""

    mechanics = f"""
<table style="{_TABLE_STYLE}">
  <thead><tr>
    <th style="{_TH_STYLE}">Metric</th>
    <th style="{_TH_STYLE}">Formula</th>
  </tr></thead>
  <tbody>
    <tr><td style="{_TD_STYLE}">Entry EV</td><td style="{_TD_STYLE}">EBITDA &times; Entry Multiple</td></tr>
    <tr><td style="{_TD_ALT_STYLE}">Entry Debt</td><td style="{_TD_ALT_STYLE}">EBITDA &times; Leverage Ratio</td></tr>
    <tr><td style="{_TD_STYLE}">Entry Equity</td><td style="{_TD_STYLE}">Entry EV &minus; Entry Debt &minus; Transaction Fees</td></tr>
    <tr><td style="{_TD_ALT_STYLE}">Interest</td><td style="{_TD_ALT_STYLE}">Declining balance — interest on remaining principal each year</td></tr>
    <tr><td style="{_TD_STYLE}">Exit Equity</td><td style="{_TD_STYLE}">Exit EV &minus; Remaining Debt</td></tr>
    <tr><td style="{_TD_ALT_STYLE}">MOIC</td><td style="{_TD_ALT_STYLE}">Exit Equity &divide; Entry Equity</td></tr>
    <tr><td style="{_TD_STYLE}">IRR</td><td style="{_TD_STYLE}">Solved via binary search on NPV (no numpy dependency)</td></tr>
  </tbody>
</table>"""

    col1, col2 = st.columns(2)
    with col1:
        st.markdown(
            _panel(f'<p style="font-size:11px;color:#8899aa;text-transform:uppercase;'
                   f'letter-spacing:.06em;margin-bottom:8px">Data Sources</p>' + data_sources),
            unsafe_allow_html=True,
        )
    with col2:
        st.markdown(
            _panel(f'<p style="font-size:11px;color:#8899aa;text-transform:uppercase;'
                   f'letter-spacing:.06em;margin-bottom:8px">Model Mechanics</p>' + mechanics),
            unsafe_allow_html=True,
        )

    # IRR thresholds
    thresholds = f"""
<table style="{_TABLE_STYLE}">
  <thead><tr>
    <th style="{_TH_STYLE}">IRR Range</th>
    <th style="{_TH_STYLE}">Signal</th>
    <th style="{_TH_STYLE}">Color</th>
  </tr></thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}">&ge;20%</td>
      <td style="{_TD_STYLE}">Strong returns</td>
      <td style="{_TD_STYLE}"><span style="background:rgba(46,204,113,0.15);color:#2ecc71;
        padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Green</span></td>
    </tr>
    <tr>
      <td style="{_TD_ALT_STYLE}">15–20%</td>
      <td style="{_TD_ALT_STYLE}">Acceptable</td>
      <td style="{_TD_ALT_STYLE}"><span style="background:rgba(74,158,255,0.15);color:#4a9eff;
        padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Blue</span></td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">&lt;15%</td>
      <td style="{_TD_STYLE}">Below typical PE hurdle rate</td>
      <td style="{_TD_STYLE}"><span style="background:rgba(230,126,34,0.15);color:#e67e22;
        padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Orange</span></td>
    </tr>
  </tbody>
</table>
<p style="font-size:11px;color:#8b949e;margin-top:8px;line-height:1.5">
  The sensitivity table displays a 5&times;5 IRR grid across entry vs exit multiples,
  centered on the current slider values and rounded to 0.5&times; increments.
  Color coding is consistent across the returns banner, schedule table header, and all sensitivity cells.
</p>"""

    st.markdown(
        _panel(f'<p style="font-size:11px;color:#8899aa;text-transform:uppercase;'
               f'letter-spacing:.06em;margin-bottom:8px">IRR Thresholds &amp; Sensitivity</p>'
               + thresholds),
        unsafe_allow_html=True,
    )


def _render_intelligence_methodology() -> None:
    """Intelligence tab methodology section."""
    section_header("Market Intelligence")

    intro = """
<p style="font-size:13px;color:#c9d1d9;line-height:1.6;margin-bottom:12px;">
The Intelligence tab synthesises all dashboard signals into actionable market narratives
with forward-looking scenario analysis. It answers the "so what" question — translating
raw macro data into positioning implications.
</p>"""

    components_doc = f"""
<table style="{_TABLE_STYLE}">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Component</th>
      <th style="{_TH_STYLE}">Method</th>
      <th style="{_TH_STYLE}">Output</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}"><strong>Market Takeaway</strong></td>
      <td style="{_TD_STYLE}">Combines regime probs, credit conditions (BAMLH0A0HYM2 percentile), and logistic regression recession probability into a 3–4 sentence narrative</td>
      <td style="{_TD_STYLE}">Narrative, conviction level (High/Medium/Low), primary signal (Risk-On/Mixed/Risk-Off), detected divergences</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><strong>Regime Playbook</strong></td>
      <td style="{_TD_STYLE}">Static reference data based on historical regime analysis (~1996–present). Sector hit rates from academic literature and historical backtest</td>
      <td style="{_TD_STYLE}">Overweight/underweight sectors, asset class avg returns and hit rates, key risks and opportunities</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><strong>Duration Analysis</strong></td>
      <td style="{_TD_STYLE}">Counts consecutive months in current regime from regimes table. Compares to historical average streak for each regime type. Risk indicators computed from market_daily (momentum), BAML OAS (valuation), VIXCLS (sentiment)</td>
      <td style="{_TD_STYLE}">Months in regime, percentile vs history, status (Early/Mid-Cycle/Extended/Long in Tooth)</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><strong>Transition Probabilities</strong></td>
      <td style="{_TD_STYLE}">Markov transition matrices computed from DB history (357 monthly regime observations). Falls back to calibrated priors if fewer than 50 transitions. Horizons: 3-month and 6-month</td>
      <td style="{_TD_STYLE}">Stay probability, transition probs to each other regime, plain-English narrative</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><strong>Historical Analogues</strong></td>
      <td style="{_TD_STYLE}">Scores 7 pre-encoded historical periods on 4 criteria: regime match (40pt), HY spread percentile proximity (25pt), recession prob proximity (20pt), VIX level proximity (15pt)</td>
      <td style="{_TD_STYLE}">Top 4 analogues by similarity score, with "what happened next" context</td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}"><strong>Scenario Analysis</strong></td>
      <td style="{_TD_STYLE}">5 pre-built stress scenarios + custom builder. Regime probability recalculation uses simplified stress multipliers (Approach A): stress score = HY_delta/100 + VIX_delta/20 - SPX_delta/10. Probabilities adjusted proportionally and normalised to 100%</td>
      <td style="{_TD_STYLE}">Stressed regime probs, probability deltas, positioning implications</td>
    </tr>
  </tbody>
</table>"""

    conviction_doc = f"""
<table style="{_TABLE_STYLE}">
  <thead>
    <tr>
      <th style="{_TH_STYLE}">Level</th>
      <th style="{_TH_STYLE}">Condition</th>
      <th style="{_TH_STYLE}">Color</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="{_TD_STYLE}">High</td>
      <td style="{_TD_STYLE}">Top regime probability &gt;55% AND no signal divergences</td>
      <td style="{_TD_STYLE}"><span style="background:rgba(46,204,113,0.15);color:#2ecc71;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Green</span></td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">Medium</td>
      <td style="{_TD_STYLE}">Top regime probability 40–55% OR one indicator diverges</td>
      <td style="{_TD_STYLE}"><span style="background:rgba(74,158,255,0.15);color:#4a9eff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Blue</span></td>
    </tr>
    <tr>
      <td style="{_TD_STYLE}">Low</td>
      <td style="{_TD_STYLE}">Top regime probability &lt;40% OR multiple divergences</td>
      <td style="{_TD_STYLE}"><span style="background:rgba(230,126,34,0.15);color:#e67e22;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Orange</span></td>
    </tr>
  </tbody>
</table>"""

    limitations = """
<p style="font-size:11px;color:#8b949e;margin-top:8px;line-height:1.6;">
<strong>Limitations:</strong>
Regime probabilities displayed in the Intelligence tab are approximated from stored confidence scores
using historical base rates as priors — exact softmax probabilities are not persisted in the database.
The scenario stress multipliers are simplified linear approximations; a full Z-score recalculation
through the regime model would be more accurate but is deferred to a future enhancement.
Historical analogues use a small pre-encoded dataset and should be used as contextual references,
not predictive signals.
</p>"""

    st.markdown(_panel(intro + components_doc), unsafe_allow_html=True)
    st.markdown(_panel(
        '<p style="font-size:11px;color:#8899aa;text-transform:uppercase;'
        'letter-spacing:.06em;margin-bottom:8px">Conviction Scoring</p>' + conviction_doc + limitations
    ), unsafe_allow_html=True)


def render_methodology() -> None:
    """Render the Methodology tab — 5 sections with real values from src/."""
    from utils.tab_context import register_tab_context
    register_tab_context(
        "Methodology",
        {
            "shows": "regime framework (2x2 growth/inflation), signal definitions and thresholds, model lineage, data sources, pipeline schedule",
            "regime_taxonomy": ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"],
            "growth_indicator": "INDPRO 3-month OLS slope",
            "inflation_indicator": "CPIAUCSL 3-month OLS slope",
            "recession_model": "Logistic regression trained on NBER recession dates",
        },
        kind="reference",
    )
    _render_regime_framework()
    _render_signal_definitions()
    _render_threshold_proximity()
    _render_data_sources()
    _render_methodology_notes()
    _render_recession_model()
    _render_lbo_calculator()
    _render_intelligence_methodology()
