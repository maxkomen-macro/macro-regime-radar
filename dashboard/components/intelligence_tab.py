"""
dashboard/components/intelligence_tab.py — Phase 8C Market Intelligence tab.

Sections:
  1. Market Intelligence narrative card (live pulse + conviction badge)
  2. Regime Gauge + Playbook (sector tilts, asset performance)
  3. Regime Duration progress bar + Transition Outlook
  4. Historical Analogues timeline
  5. Scenario Analysis (pre-built cards + custom builder)

Uses hybrid approach:
  - components.v1.html() for animations, SVG gauges, styled cards
  - Native Streamlit widgets (buttons, sliders, selectbox) for interactivity
"""

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import streamlit as st
import streamlit.components.v1 as components

from src.analytics.intelligence import (
    INTELLIGENCE_CARD_HEIGHT,
    REGIME_ROW_HEIGHT,
    DURATION_ROW_HEIGHT,
    ANALOGUES_HEIGHT,
    REGIME_COLORS,
    SCENARIOS,
    _get_current_regime_state,
    generate_market_takeaway,
    get_regime_playbook,
    get_regime_duration,
    get_transition_narrative,
    find_historical_analogues,
    run_scenario,
)
from src.analytics.regimes import get_current_regime_probs
from src.analytics.credit import get_credit_metrics
from src.analytics.recession import get_recession_probability

# ─────────────────────────────────────────────────────────────────────────────
# CSS constants
# ─────────────────────────────────────────────────────────────────────────────

_BASE_CSS = """
<style>
  :root {
    --accent:   #4a9eff;
    --green:    #2ecc71;
    --red:      #e74c3c;
    --orange:   #e67e22;
    --bg-card:  rgba(13,17,23,0.97);
    --border:   rgba(48,54,61,0.85);
    --text:     #e6edf3;
    --muted:    #8b949e;
  }
  body { margin:0; padding:0; background:transparent; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .card {
    background: var(--bg-card);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content:''; position:absolute; top:0; left:0;
    width:3px; height:100%;
    background:var(--accent); border-radius:0;
  }
  .card.green::before { background:var(--green); }
  .card.orange::before { background:var(--orange); }
  .card.red::before { background:var(--red); }
  .card.gray::before { background:var(--muted); }
  .header {
    font-size:9px; text-transform:uppercase; letter-spacing:0.1em;
    color:var(--muted); margin-bottom:8px; font-weight:600;
  }
  .metric-big { font-size:26px; font-weight:700; line-height:1.1; }
  .metric-label { font-size:11px; color:var(--muted); margin-top:2px; }
  .badge {
    display:inline-block; padding:3px 10px; border-radius:4px;
    font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em;
  }
  .live-row { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .live-dot {
    width:6px; height:6px; background:var(--green); border-radius:50%;
    animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes glow-green {
    0%,100%{box-shadow:0 0 2px rgba(46,204,113,0.3)} 50%{box-shadow:0 0 5px rgba(46,204,113,0.4)}
  }
  @keyframes glow-blue {
    0%,100%{box-shadow:0 0 2px rgba(74,158,255,0.3)} 50%{box-shadow:0 0 5px rgba(74,158,255,0.4)}
  }
  @keyframes glow-orange {
    0%,100%{box-shadow:0 0 2px rgba(230,126,34,0.3)} 50%{box-shadow:0 0 5px rgba(230,126,34,0.4)}
  }
  @keyframes fill-bar { from{width:0} to{width:var(--target-w)} }
</style>
"""


# ─────────────────────────────────────────────────────────────────────────────
# Section 1 — Market Intelligence Card
# ─────────────────────────────────────────────────────────────────────────────

def _render_narrative_card(takeaway: dict, duration: dict) -> None:
    conviction       = takeaway["conviction"]
    conviction_color = takeaway["conviction_color"]
    glow_anim = {
        "High":   "glow-green 3s infinite",
        "Medium": "glow-blue 3s infinite",
        "Low":    "glow-orange 3s infinite",
    }.get(conviction, "none")

    signal      = takeaway["primary_signal"]
    signal_color = "#2ecc71" if signal == "Risk-On" else ("#e74c3c" if signal == "Risk-Off" else "#4a9eff")
    dur_months  = duration.get("months_in_regime", 0)
    dur_status  = duration.get("status", "Early")
    narrative   = takeaway["narrative"]
    updated     = takeaway["updated_ago"]

    html = f"""{_BASE_CSS}
<div class="card green" style="margin-bottom:2px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="live-row">
        <div class="live-dot"></div>
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);">Market Intelligence</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="badge" style="background:rgba(0,0,0,0.3);color:{conviction_color};
            border:1px solid {conviction_color};animation:{glow_anim};">
        {conviction} Conviction
      </span>
    </div>
  </div>
  <p style="margin:0 0 10px 0;font-size:14px;line-height:1.65;color:var(--text);">{narrative}</p>
  <div style="display:flex;gap:20px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px;flex-wrap:wrap;">
    <span>Signal: <strong style="color:{signal_color};">{signal}</strong></span>
    <span>Duration: <strong style="color:var(--text);">{dur_months:.1f}mo</strong> ({dur_status})</span>
    <span style="margin-left:auto;font-size:11px;">Updated {updated}</span>
  </div>
</div>"""
    components.html(html, height=INTELLIGENCE_CARD_HEIGHT, scrolling=False)


# ─────────────────────────────────────────────────────────────────────────────
# Section 2 — Regime Gauge + Playbook
# ─────────────────────────────────────────────────────────────────────────────

def _render_regime_gauge(state: dict, probs: dict) -> None:
    """Animated SVG semicircular gauge."""
    label    = state["label"]
    regime_c = REGIME_COLORS.get(label, "#4a9eff")
    probs100 = state["approx_probs"]  # {display name: int}
    top_prob = probs100.get(label, 30)

    # SVG gauge: semicircle, angle from 0° (left) to 180° (right)
    # Map top_prob (0–100) to arc angle (0–180°)
    angle = top_prob / 100 * 180
    # Convert to SVG arc: center (100,100), radius 80
    def arc_point(deg):
        rad = math.radians(180 - deg)
        return (100 + 80 * math.cos(rad), 100 - 80 * math.sin(rad))

    x_end, y_end = arc_point(angle)
    large_arc = 1 if angle > 180 else 0

    # Regime pill HTML
    pills_html = ""
    for regime, pct in sorted(probs100.items(), key=lambda x: -x[1]):
        c = REGIME_COLORS.get(regime, "#8b949e")
        short = regime.replace("Recession Risk", "Rec. Risk")
        active = (f"border:1px solid {c};background:rgba({_hex_to_rgba(c)},0.15);"
                  if regime == label else "border:0.5px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);")
        pills_html += f"""
        <div style="display:inline-flex;align-items:center;gap:6px;
                    {active}border-radius:20px;
                    padding:6px 12px;font-size:11px;cursor:default;margin:3px 4px;">
          <span style="width:6px;height:6px;border-radius:50%;background:{c};display:inline-block;"></span>
          <span style="color:{c if regime == label else 'var(--muted)'};">{short}</span>
          <span style="color:var(--text);font-weight:700;">{pct}%</span>
        </div>"""

    html = f"""{_BASE_CSS}
<div class="card" style="height:100%;">
  <div class="header">Current Regime</div>
  <div style="text-align:center;padding:8px 0;">
    <svg width="200" height="110" viewBox="0 0 200 110" style="overflow:visible;">
      <!-- Background track -->
      <path d="M 20,100 A 80,80 0 0 1 180,100"
            fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14" stroke-linecap="round"/>
      <!-- Colored arc -->
      <path d="M 20,100 A 80,80 0 {large_arc},1 {x_end:.1f},{y_end:.1f}"
            fill="none" stroke="{regime_c}" stroke-width="14" stroke-linecap="round"
            style="filter:drop-shadow(0 0 3px {regime_c});">
        <animate attributeName="stroke-dasharray"
                 from="0 251" to="251 0" dur="1s" fill="freeze"/>
      </path>
      <!-- Center needle dot -->
      <circle cx="{x_end:.1f}" cy="{y_end:.1f}" r="6" fill="{regime_c}"
              style="filter:drop-shadow(0 0 3px {regime_c});"/>
      <!-- Percentage text -->
      <text x="100" y="85" text-anchor="middle" font-size="26" font-weight="700"
            fill="{regime_c}">{top_prob}%</text>
      <text x="100" y="102" text-anchor="middle" font-size="11" fill="#8b949e">{label}</text>
    </svg>
  </div>
  <div style="text-align:center;padding:4px 0;line-height:1.8;">
    {pills_html}
  </div>
</div>"""
    components.html(html, height=REGIME_ROW_HEIGHT, scrolling=False)


def _render_playbook_card(playbook: dict) -> None:
    """Sector tilts + asset performance for selected regime."""
    regime  = playbook["regime"]
    color   = playbook["regime_color"]
    desc    = playbook["description"]

    # Sector tilt bars
    ow_bars = ""
    for item in playbook["sector_tilts"]["overweight"]:
        w = item["strength"]
        ow_bars += f"""
        <div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
            <span style="color:#2ecc71;">▲ {item['sector']}</span>
          </div>
          <div style="background:rgba(255,255,255,0.06);border-radius:3px;height:6px;overflow:hidden;">
            <div style="width:{w}%;height:100%;
                        background:linear-gradient(90deg,rgba(46,204,113,0.3),rgba(46,204,113,0.6));
                        border-radius:3px;animation:fill-bar 0.8s ease forwards;
                        --target-w:{w}%;"></div>
          </div>
        </div>"""

    uw_bars = ""
    for item in playbook["sector_tilts"]["underweight"]:
        w = min(25, round(item["strength"] * 0.40))  # cap UW bars at 25% max width — visually distinct from OW
        uw_bars += f"""
        <div style="margin-bottom:6px;">
          <div style="font-size:11px;margin-bottom:3px;color:#e74c3c;">▼ {item['sector']}</div>
          <div style="background:rgba(255,255,255,0.06);border-radius:3px;height:6px;overflow:hidden;">
            <div style="width:{w}%;height:100%;
                        background:linear-gradient(90deg,rgba(231,76,60,0.3),rgba(231,76,60,0.5));
                        border-radius:3px;"></div>
          </div>
        </div>"""

    # Asset performance rows
    perf_rows = ""
    for asset, data in playbook["asset_performance"].items():
        ret = data["avg_return"]
        hit = data["hit_rate"]
        ret_color = "#2ecc71" if ret > 0 else "#e74c3c"
        sign = "+" if ret > 0 else ""
        perf_rows += f"""
        <tr>
          <td style="padding:4px 6px;font-size:12px;color:var(--muted);">{asset}</td>
          <td style="padding:4px 6px;font-size:12px;color:{ret_color};text-align:right;font-weight:600;">{sign}{ret:.1f}%</td>
          <td style="padding:4px 6px;font-size:12px;color:var(--muted);text-align:right;">{hit}%</td>
        </tr>"""

    risks_html = "".join(f"<li style='margin-bottom:4px;color:var(--muted);font-size:12px;'>{r}</li>" for r in playbook["key_risks"])
    warnings_html = "".join(f"<li style='margin-bottom:4px;color:#e67e22;font-size:12px;'>{w}</li>" for w in playbook.get("warning_signs", []))
    catalysts_html = "".join(f"<li style='margin-bottom:4px;color:#e74c3c;font-size:12px;'>{c}</li>" for c in playbook.get("typical_catalysts", []))

    html = f"""{_BASE_CSS}
<style>
  @keyframes fill-bar {{from{{width:0}} to{{width:var(--target-w)}}}}
  table{{border-collapse:collapse;width:100%;}}
  tr:nth-child(odd){{background:rgba(255,255,255,0.03);}}
</style>
<div class="{_regime_class(playbook['regime'])} card" style="height:100%;">
  <div style="border-left:3px solid {color};padding-left:10px;margin-bottom:10px;">
    <div class="header">Regime Playbook — {regime}</div>
    <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.5;">{desc}</p>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:8px;">Sector Positioning</div>
      {ow_bars}
      {uw_bars}
      <div style="margin-top:10px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#e67e22;margin-bottom:6px;">Warning Signs</div>
        <ul style="margin:0;padding-left:16px;">{warnings_html}</ul>
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#e74c3c;margin-bottom:6px;">Typical Catalysts</div>
        <ul style="margin:0;padding-left:16px;">{catalysts_html}</ul>
      </div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:8px;">Historical Performance</div>
      <table>
        <thead>
          <tr>
            <th style="font-size:9px;text-align:left;padding:3px 6px;color:var(--muted);">Asset</th>
            <th style="font-size:9px;text-align:right;padding:3px 6px;color:var(--muted);">Avg Ret</th>
            <th style="font-size:9px;text-align:right;padding:3px 6px;color:var(--muted);">Hit Rate</th>
          </tr>
        </thead>
        <tbody>{perf_rows}</tbody>
      </table>
      <div style="margin-top:10px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:6px;">Key Risks</div>
        <ul style="margin:0;padding-left:16px;">{risks_html}</ul>
      </div>
    </div>
  </div>
</div>"""
    components.html(html, height=REGIME_ROW_HEIGHT, scrolling=False)


def _regime_class(regime: str) -> str:
    mapping = {
        "Goldilocks": "green", "Overheating": "orange",
        "Stagflation": "red",  "Recession Risk": "gray",
    }
    return mapping.get(regime, "")


# ─────────────────────────────────────────────────────────────────────────────
# Section 3 — Duration + Transition Row
# ─────────────────────────────────────────────────────────────────────────────

def _render_duration_card(duration: dict) -> None:
    months   = duration["months_in_regime"]
    avg_mo   = duration["historical_avg_months"]
    status   = duration["status"]
    s_color  = duration["status_color"]
    prog     = min(100, duration["progress_pct"])
    regime   = duration["current_regime"]
    ri       = duration["risk_indicators"]
    pct_dur  = duration["percentile_duration"]

    # Progress bar — marker at 100% (historical avg)
    avg_marker = min(99, 100)  # always at far right (normalized)

    def _indicator_bar(label: str, val: int, color: str) -> str:
        v = max(0, min(100, val))
        bar_grad = ("linear-gradient(90deg,#27ae60,#2ecc71)" if v < 40
                    else ("linear-gradient(90deg,#d35400,#e67e22)" if v < 70
                    else "linear-gradient(90deg,#c0392b,#e74c3c)"))
        return f"""
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
            <span style="color:var(--muted);">{label}</span>
            <span style="color:var(--text);font-weight:600;">{v}%</span>
          </div>
          <div style="background:rgba(255,255,255,0.06);border:0.5px solid #30363d;border-radius:3px;height:5px;">
            <div style="width:{v}%;height:100%;background:{bar_grad};border-radius:3px;
                        transition:width 0.8s ease;"></div>
          </div>
        </div>"""

    status_labels = [
        ("Early", "#2ecc71", 0),
        ("Mid-Cycle", "#4a9eff", 50),
        ("Extended", "#e67e22", 75),
        ("Long in Tooth", "#e74c3c", 90),
    ]
    labels_html = ""
    for lbl, col, pos in status_labels:
        weight = "700" if lbl == status else "400"
        opacity = "1" if lbl == status else "0.45"
        labels_html += f'<span style="font-size:9px;color:{col};font-weight:{weight};opacity:{opacity};">{lbl}</span>'

    html = f"""{_BASE_CSS}
<div class="card">
  <div class="header">Regime Duration</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;">
    <div>
      <div class="metric-big" style="color:{s_color};">{months:.1f}mo</div>
      <div class="metric-label">{regime} · {pct_dur:.0f}th percentile</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;color:var(--muted);">Historical avg</div>
      <div style="font-size:18px;font-weight:700;color:var(--muted);">{avg_mo:.1f}mo</div>
    </div>
  </div>
  <!-- Progress track -->
  <div style="position:relative;background:rgba(255,255,255,0.06);border-radius:4px;height:8px;margin-bottom:4px;">
    <div style="width:{prog}%;height:100%;background:{s_color};border-radius:4px;
                transition:width 1s ease;filter:drop-shadow(0 0 4px {s_color});"></div>
    <div style="position:absolute;top:-2px;right:0;width:2px;height:12px;
                background:rgba(255,255,255,0.3);border-radius:1px;"
         title="Historical average"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
    {labels_html}
  </div>
  <div class="header" style="margin-bottom:6px;">Risk Indicators</div>
  {_indicator_bar("Momentum", ri['momentum'], "#4a9eff")}
  {_indicator_bar("Valuation Stretch", ri['valuation'], "#e67e22")}
  {_indicator_bar("Complacency", ri['sentiment'], "#e74c3c")}
</div>"""
    components.html(html, height=DURATION_ROW_HEIGHT, scrolling=False)


def _render_transition_card(transition: dict) -> None:
    current  = transition["current_regime"]
    stay_3m  = transition["stay_probability_3m"]
    nar3     = transition["narrative_3m"]
    nar6     = transition["narrative_6m"]
    t3m      = transition["transitions_3m"][:3]  # top 3 transitions
    hrisk    = transition["highest_risk_transition"]
    hprob    = transition["highest_risk_prob"]
    hcolor   = transition["highest_risk_color"]
    curr_c   = REGIME_COLORS.get(current, "#4a9eff")

    # Transition arrow boxes
    boxes_html = ""
    for tr in t3m:
        to_c  = tr["color"]
        prob  = tr["probability"]
        short = tr["to"].replace("Recession Risk", "Rec. Risk")
        boxes_html += f"""
        <div style="flex:1;text-align:center;background:rgba({_hex_to_rgba(to_c)},0.06);
                    border:0.5px solid rgba({_hex_to_rgba(to_c)},0.25);border-radius:6px;padding:8px 4px;">
          <div style="font-size:16px;font-weight:700;color:{to_c};">{prob}%</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">{short}</div>
        </div>"""

    html = f"""{_BASE_CSS}
<div class="card">
  <div class="header">Transition Outlook (3M)</div>
  <!-- Stay vs move -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
    <div style="background:rgba({_hex_to_rgba(curr_c)},0.10);border:0.5px solid rgba({_hex_to_rgba(curr_c)},0.35);border-radius:6px;
                padding:8px 14px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:{curr_c};">{stay_3m}%</div>
      <div style="font-size:10px;color:var(--muted);">Stay in<br>{current}</div>
    </div>
    <div style="font-size:18px;color:var(--muted);">→</div>
    <div style="display:flex;flex:1;gap:6px;">
      {boxes_html}
    </div>
  </div>
  <p style="font-size:12px;color:var(--muted);margin:0 0 8px 0;line-height:1.5;">{nar3}</p>
  <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px;">
    <p style="font-size:11px;color:var(--muted);margin:0;line-height:1.5;font-style:italic;">{nar6}</p>
  </div>
  <div style="margin-top:10px;padding:8px;background:rgba({_hex_to_rgba(hcolor)},0.1);
              border-left:3px solid {hcolor};border-radius:0 4px 4px 0;">
    <span style="font-size:11px;color:var(--muted);">Highest transition risk: </span>
    <strong style="font-size:12px;color:{hcolor};">{hrisk} ({hprob}%)</strong>
  </div>
</div>"""
    components.html(html, height=DURATION_ROW_HEIGHT, scrolling=False)


def _hex_to_rgba(hex_color: str) -> str:
    """Convert hex to 'r,g,b' string for rgba()."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"{r},{g},{b}"


# ─────────────────────────────────────────────────────────────────────────────
# Section 4 — Historical Analogues
# ─────────────────────────────────────────────────────────────────────────────

def _render_analogues_timeline(analogues: list[dict]) -> None:
    """Horizontal SVG timeline with scored nodes."""
    n = len(analogues)
    if n == 0:
        return

    width  = 700
    y_line = 60
    x_step = width // (n + 1)

    nodes_svg = ""
    for i, a in enumerate(analogues):
        x      = x_step * (i + 1)
        score  = a["similarity_score"]
        color  = a["similarity_color"]
        period = a["period"]
        next_r = a["next_regime"].replace("Recession Risk", "Rec. Risk")

        nodes_svg += f"""
        <g>
          <circle cx="{x}" cy="{y_line}" r="10" fill="{color}"
                  style="filter:drop-shadow(0 0 2px {color}66);">
          </circle>
          <text x="{x}" y="{y_line - 18}" text-anchor="middle" font-size="11" fill="{color}" font-weight="700">{score}%</text>
          <text x="{x}" y="{y_line + 22}" text-anchor="middle" font-size="10" fill="#e6edf3">{period}</text>
          <text x="{x}" y="{y_line + 35}" text-anchor="middle" font-size="9" fill="#4a9eff">→ {next_r}</text>
        </g>"""

    html = f"""{_BASE_CSS}
<div class="card">
  <div class="header">Historical Analogues — Most Similar Past Environments</div>
  <svg width="100%" viewBox="0 0 {width} 90" style="overflow:visible;">
    <!-- Timeline track -->
    <line x1="{x_step//2}" y1="{y_line}" x2="{width - x_step//2}" y2="{y_line}"
          stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
    {nodes_svg}
  </svg>
  <p style="font-size:11px;color:var(--muted);margin:8px 0 0 0;text-align:center;">
    Select an analogue below for detailed analysis
  </p>
</div>"""
    components.html(html, height=ANALOGUES_HEIGHT, scrolling=False)


# ─────────────────────────────────────────────────────────────────────────────
# Section 5 — Scenario Analysis
# ─────────────────────────────────────────────────────────────────────────────

def _render_scenario_cards_html(scenarios_results: dict, selected_key: str) -> None:
    """Render the 5 pre-built scenario cards as HTML display."""
    cards_html = ""
    for key, result in scenarios_results.items():
        s       = SCENARIOS[key]
        color   = s["color"]
        active  = (f"border:1.5px solid {color};background:rgba({_hex_to_rgba(color)},0.08);"
                   if key == selected_key
                   else "border:0.5px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.35);")
        top_r   = result["most_likely_regime"]
        top_p   = result["most_likely_prob"]

        cards_html += f"""
        <div style="flex:1;{active}border-radius:8px;
                    padding:10px 8px;text-align:center;min-width:0;">
          <div style="width:10px;height:10px;border-radius:50%;background:{color};margin:0 auto 6px auto;"></div>
          <div style="font-size:11px;font-weight:700;color:{color};margin-bottom:4px;">{s['name']}</div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:6px;
                      white-space:normal;word-wrap:break-word;line-height:1.3;">{s['description']}</div>
          <div style="font-size:9px;color:var(--muted);line-height:1.3;">HY {s['input_shocks']['hy_spread_delta_bps']:+d}bps</div>
          <div style="font-size:9px;color:var(--muted);line-height:1.3;">10Y {s['input_shocks']['yield_10y_delta_bps']:+d}bps</div>
          <div style="font-size:9px;color:var(--muted);line-height:1.3;">SPX {s['input_shocks']['spx_delta_pct']:+d}%</div>
          <div style="margin-top:6px;padding:4px;background:rgba(0,0,0,0.3);border-radius:4px;">
            <div style="font-size:10px;color:{color};font-weight:700;">→ {top_r.replace('Recession Risk','Rec.')}</div>
            <div style="font-size:13px;color:{color};font-weight:700;">{top_p}%</div>
          </div>
        </div>"""

    html = f"""{_BASE_CSS}
<div class="card">
  <div class="header">Scenario Analysis — Select a scenario to analyse</div>
  <div style="display:flex;gap:8px;">{cards_html}</div>
</div>"""
    components.html(html, height=240, scrolling=False)


def _render_scenario_results(result: dict) -> None:
    """Render stressed regime probs with delta arrows."""
    probs_html = ""
    for regime in ["goldilocks", "overheating", "stagflation", "recession_risk"]:
        disp   = regime.replace("_", " ").title().replace("Risk", "Risk")
        if "recession" in regime:
            disp = "Recession Risk"
        color  = REGIME_COLORS.get(disp, "#8b949e")
        prob   = result["stressed_regime_probs"].get(regime, 0)
        change = result["prob_changes"].get(regime, 0)
        sign   = "+" if change >= 0 else ""
        ch_c   = "#2ecc71" if change > 0 else ("#e74c3c" if change < 0 else "#8b949e")
        is_top = disp == result["most_likely_regime"]
        border = f"border:1px solid {color};" if is_top else "border:1px solid rgba(255,255,255,0.08);"
        probs_html += f"""
        <div style="flex:1;background:rgba(0,0,0,0.3);{border}border-radius:6px;
                    padding:10px;text-align:center;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">{disp}</div>
          <div style="font-size:22px;font-weight:700;color:{color};">{prob}%</div>
          <div style="font-size:12px;color:{ch_c};font-weight:600;">{sign}{change}pp</div>
        </div>"""

    impl_html = "".join(
        f"<li style='margin-bottom:5px;font-size:12px;color:var(--muted);'>{imp}</li>"
        for imp in result.get("positioning_implications", [])
    )
    s_color = result.get("color", "#4a9eff")

    # Sector implications
    sect = result.get("sector_implications", {})
    ow_list = sect.get("overweight", [])
    uw_list = sect.get("underweight", [])
    ow_html = "".join(f"<li style='color:#2ecc71;font-size:12px;margin-bottom:3px;'>{s}</li>" for s in ow_list)
    uw_html = "".join(f"<li style='color:#e74c3c;font-size:12px;margin-bottom:3px;'>{s}</li>" for s in uw_list)
    sector_html = ""
    if ow_list or uw_list:
        sector_html = f"""
  <div style="margin-bottom:10px;">
    <div class="header" style="margin-bottom:6px;">Sector Implications</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <div style="font-size:10px;color:#2ecc71;font-weight:700;margin-bottom:4px;">▲ OVERWEIGHT</div>
        <ul style="margin:0;padding-left:14px;">{ow_html}</ul>
      </div>
      <div>
        <div style="font-size:10px;color:#e74c3c;font-weight:700;margin-bottom:4px;">▼ UNDERWEIGHT</div>
        <ul style="margin:0;padding-left:14px;">{uw_html}</ul>
      </div>
    </div>
  </div>"""

    # Duration estimate
    duration_est = result.get("duration_estimate", "")
    duration_html = ""
    if duration_est:
        duration_html = f"""
  <div style="margin-bottom:10px;padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:4px;">
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);font-weight:600;">Duration: </span>
    <span style="font-size:12px;color:var(--text);">{duration_est}</span>
  </div>"""

    # Indicators to watch
    watch_list = result.get("indicators_to_watch", [])
    watch_html = ""
    if watch_list:
        items = "".join(f"<li style='font-size:12px;color:var(--muted);margin-bottom:4px;'>{w}</li>" for w in watch_list)
        watch_html = f"""
  <div style="margin-bottom:10px;">
    <div class="header" style="margin-bottom:6px;">Key Indicators to Watch</div>
    <ul style="margin:0;padding-left:16px;">{items}</ul>
  </div>"""

    html = f"""{_BASE_CSS}
<div class="card" style="margin-top:4px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <div>
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{s_color};margin-right:8px;vertical-align:middle;"></span>
      <strong style="color:{s_color};font-size:14px;">{result.get('scenario_name','Scenario')}</strong>
      <span style="font-size:11px;color:var(--muted);margin-left:8px;">{result.get('historical_reference','')}</span>
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px;">{probs_html}</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px;padding:8px;
              background:rgba(0,0,0,0.2);border-radius:4px;border-left:3px solid {s_color};">
    <strong>Historical precedent:</strong> {result.get('what_happened_then','')}
  </div>
  {sector_html}
  {duration_html}
  {watch_html}
  <div>
    <div class="header" style="margin-bottom:6px;">Positioning Implications</div>
    <ul style="margin:0;padding-left:16px;">{impl_html}</ul>
  </div>
</div>"""
    components.html(html, height=620, scrolling=False)


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard summary card (used from app.py dashboard tab)
# ─────────────────────────────────────────────────────────────────────────────

def _render_intelligence_dashboard_card() -> None:
    """Compact Market Intelligence card for the Dashboard tab."""
    try:
        probs    = get_current_regime_probs()
        credit   = get_credit_metrics()
        rec_prob = get_recession_probability()
        state    = _get_current_regime_state()
        regime   = state["label"]
        takeaway = generate_market_takeaway(probs, regime, credit, rec_prob)
        duration = get_regime_duration()
    except Exception:
        return

    conviction       = takeaway["conviction"]
    conviction_color = takeaway["conviction_color"]
    signal           = takeaway["primary_signal"]
    signal_color     = "#2ecc71" if signal == "Risk-On" else ("#e74c3c" if signal == "Risk-Off" else "#4a9eff")
    dur_months       = duration.get("months_in_regime", 0)
    # Strip HTML tags for compact card — show plain text
    plain_narrative = re.sub(r"<[^>]+>", "", takeaway["narrative"])
    # Truncate to 2 sentences
    sentences = plain_narrative.split(". ")
    short_narrative = ". ".join(sentences[:2]) + ("." if len(sentences) > 2 else "")

    glow_anim = {
        "High":   "glow-green 3s infinite",
        "Medium": "glow-blue 3s infinite",
        "Low":    "glow-orange 3s infinite",
    }.get(conviction, "none")

    regime_color = REGIME_COLORS.get(regime, "#4a9eff")

    html = f"""{_BASE_CSS}
<div class="card green" style="margin-bottom:2px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="live-dot"></div>
      <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);">Market Intelligence</span>
    </div>
    <span class="badge" style="background:rgba(0,0,0,0.3);color:{conviction_color};
          border:1px solid {conviction_color};animation:{glow_anim};">
      {conviction} Conviction
    </span>
  </div>
  <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:var(--text);">{short_narrative}</p>
  <div style="display:flex;gap:16px;font-size:11px;color:var(--muted);
              border-top:1px solid var(--border);padding-top:6px;flex-wrap:wrap;">
    <span>Signal: <strong style="color:{signal_color};">{signal}</strong></span>
    <span>Duration: <strong style="color:{regime_color};">{dur_months:.1f}mo</strong></span>
    <span style="margin-left:auto;color:#4a9eff;font-size:11px;">→ See Intelligence tab for full analysis</span>
  </div>
</div>"""
    components.html(html, height=150, scrolling=False)


# ─────────────────────────────────────────────────────────────────────────────
# Main render() entry point
# ─────────────────────────────────────────────────────────────────────────────

def render() -> None:
    """Render the full Market Intelligence tab."""

    # ── Data loading (cached) ─────────────────────────────────────────────────
    @st.cache_data(ttl=60)
    def _load_intelligence():
        probs    = get_current_regime_probs()
        credit   = get_credit_metrics()
        rec_prob = get_recession_probability()
        # Get current regime label from probs
        state    = _get_current_regime_state()
        regime   = state["label"]
        takeaway = generate_market_takeaway(probs, regime, credit, rec_prob)
        duration = get_regime_duration()
        playbook = get_regime_playbook(regime)
        transition = get_transition_narrative(regime)
        hy_pct   = credit.get("hy_pct_rank") or 50
        analogues = find_historical_analogues(regime, float(hy_pct), rec_prob)
        # Preload all 5 scenarios
        sc_results = {key: run_scenario(scenario_key=key) for key in SCENARIOS}
        return {
            "probs": probs, "credit": credit, "rec_prob": rec_prob,
            "state": state, "regime": regime,
            "takeaway": takeaway, "duration": duration, "playbook": playbook,
            "transition": transition, "analogues": analogues,
            "sc_results": sc_results,
        }

    try:
        data = _load_intelligence()
    except Exception as exc:
        st.error(f"Intelligence data load failed: {exc}")
        return

    # ── Section 1: Narrative card ─────────────────────────────────────────────
    _render_narrative_card(data["takeaway"], data["duration"])

    st.markdown("")  # spacing

    # ── Section 2: Regime Gauge + Playbook ────────────────────────────────────
    st.markdown(
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;'
        'color:#8b949e;margin-bottom:6px;">Regime Analysis</div>',
        unsafe_allow_html=True,
    )

    # Regime selector (controls playbook display)
    regimes_list = list(REGIME_COLORS.keys())
    default_idx  = regimes_list.index(data["regime"]) if data["regime"] in regimes_list else 0
    selected_regime = st.selectbox(
        "View playbook for regime:",
        regimes_list,
        index=default_idx,
        key="intel_regime_select",
        label_visibility="collapsed",
    )

    col_gauge, col_play = st.columns([1, 2])
    with col_gauge:
        _render_regime_gauge(data["state"], data["probs"])
    with col_play:
        playbook_to_show = get_regime_playbook(selected_regime)
        _render_playbook_card(playbook_to_show)

    st.markdown("")  # spacing

    # ── Section 3: Duration + Transitions ────────────────────────────────────
    st.markdown(
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;'
        'color:#8b949e;margin-bottom:6px;">Cycle Analysis</div>',
        unsafe_allow_html=True,
    )
    col_dur, col_trans = st.columns([1, 1])
    with col_dur:
        _render_duration_card(data["duration"])
    with col_trans:
        _render_transition_card(data["transition"])

    st.markdown("")  # spacing

    # ── Section 4: Historical Analogues ───────────────────────────────────────
    _render_analogues_timeline(data["analogues"])

    # Analogue detail buttons
    if data["analogues"]:
        st.markdown(
            '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;'
            'color:#8b949e;margin:6px 0 4px 0;">Explore Analogue</div>',
            unsafe_allow_html=True,
        )
        st.markdown("""<style>
.stButton > button {
    border: 0.5px solid #30363d !important;
    border-radius: 6px !important;
    background: transparent !important;
    transition: all 0.15s ease !important;
    font-size: 11px !important;
    color: #8b949e !important;
}
.stButton > button:hover {
    background: #1c2128 !important;
    border-color: #4a9eff !important;
    color: #e6edf3 !important;
}
</style>""", unsafe_allow_html=True)
        cols = st.columns(len(data["analogues"]))
        for i, (col, analogue) in enumerate(zip(cols, data["analogues"])):
            with col:
                score_color = analogue["similarity_color"]
                if st.button(
                    f"{analogue['period']} ({analogue['similarity_score']}%)",
                    key=f"analogue_btn_{i}",
                    use_container_width=True,
                ):
                    st.session_state["selected_analogue"] = analogue["period"]
                # Selected state indicator — thin colored underline
                if st.session_state.get("selected_analogue") == analogue["period"]:
                    st.markdown(
                        f'<div style="height:2px;background:{score_color};border-radius:0 0 3px 3px;margin-top:-8px;"></div>',
                        unsafe_allow_html=True,
                    )

        if "selected_analogue" in st.session_state:
            sel = st.session_state["selected_analogue"]
            a   = next((x for x in data["analogues"] if x["period"] == sel), None)
            if a:
                with st.expander(f"{sel} — Detailed Analysis", expanded=True):
                    c1, c2, c3 = st.columns(3)
                    with c1:
                        st.metric("Similarity", f"{a['similarity_score']}%")
                    with c2:
                        st.metric("HY Spread Pct", f"{a['hy_spread_pct']}th")
                    with c3:
                        st.metric("Next Regime", a["next_regime"])
                    st.markdown(f"**What happened:** {a['what_happened']}")
                    st.markdown(f"**Time to regime change:** {a['time_to_change']}")
                    if a.get("key_drivers"):
                        st.markdown("**Key Drivers:**")
                        for d in a["key_drivers"]:
                            st.markdown(f"- {d}")
                    if a.get("market_impact"):
                        st.markdown("**Market Impact:**")
                        for asset, ret in a["market_impact"].items():
                            st.markdown(f"- **{asset}:** {ret}")
                    if a.get("lessons_for_today"):
                        st.markdown(f"**Lessons for Today:** {a['lessons_for_today']}")
                    if a.get("resolution"):
                        st.markdown(f"**Resolution:** {a['resolution']}")

    st.markdown("")  # spacing

    # ── Section 5: Scenario Analysis ─────────────────────────────────────────
    st.markdown(
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;'
        'color:#8b949e;margin-bottom:6px;">Scenario Analysis</div>',
        unsafe_allow_html=True,
    )

    # Pre-built scenario selector
    scenario_options = {k: v['name'] for k, v in SCENARIOS.items()}
    scenario_options["_custom"] = "Custom Builder"
    selected_scenario = st.selectbox(
        "Select scenario:",
        list(scenario_options.keys()),
        format_func=lambda x: scenario_options[x],
        key="intel_scenario_select",
    )

    # Render scenario card visuals
    active_key = selected_scenario if selected_scenario != "_custom" else list(SCENARIOS.keys())[0]
    _render_scenario_cards_html(data["sc_results"], active_key)

    if selected_scenario != "_custom":
        # Show pre-built scenario results
        _render_scenario_results(data["sc_results"][selected_scenario])
    else:
        # Custom scenario builder
        st.markdown("##### Custom Scenario Builder")
        c1, c2 = st.columns(2)
        with c1:
            hy_shock  = st.slider("HY Spread Δ (bps)",  -200, 500, 0, key="intel_hy_shock")
            y10_shock = st.slider("10Y Yield Δ (bps)",  -150, 200, 0, key="intel_y10_shock")
        with c2:
            vix_shock = st.slider("VIX Δ",               -10,  50, 0, key="intel_vix_shock")
            spx_shock = st.slider("S&P 500 Δ (%)",        -40,  20, 0, key="intel_spx_shock")

        custom_result = run_scenario(custom_shocks={
            "hy_spread_delta_bps": hy_shock,
            "yield_10y_delta_bps": y10_shock,
            "vix_delta":           vix_shock,
            "spx_delta_pct":       spx_shock,
        })
        _render_scenario_results(custom_result)
