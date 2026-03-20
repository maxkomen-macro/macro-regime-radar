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


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def render_methodology() -> None:
    """Render the Methodology tab — 5 sections with real values from src/."""
    _render_regime_framework()
    _render_signal_definitions()
    _render_threshold_proximity()
    _render_data_sources()
    _render_methodology_notes()
