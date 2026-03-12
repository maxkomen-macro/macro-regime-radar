"""
dashboard/components/shared_styles.py — Shared visual helpers for the dashboard.

Provides:
  - section_header(title)       — styled h2 with left accent bar (Bloomberg/FactSet style)
  - render_regime_badge(label)  — colored regime badge (consistent across tabs)
  - render_signal_card(...)     — dark-themed signal card (consistent across tabs)
"""

import streamlit as st

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}


def section_header(title: str) -> None:
    """Render a section header with a left accent bar (Bloomberg/FactSet panel style)."""
    st.markdown(
        f'<h2 style="border-left:4px solid #4a9eff;padding-left:12px;'
        f'margin-top:16px;margin-bottom:12px;color:#e0e0e0;font-size:20px;'
        f'font-weight:600;border-bottom:none">{title}</h2>',
        unsafe_allow_html=True,
    )


def render_regime_badge(label: str) -> None:
    """Render a colored, rounded regime badge — identical style on every tab."""
    color = REGIME_COLORS.get(label, "#888888")
    st.markdown(
        f'<div style="background:{color};color:white;font-weight:700;font-size:24px;'
        f'padding:12px 24px;border-radius:8px;display:inline-block;'
        f'text-shadow:0 1px 2px rgba(0,0,0,.3);letter-spacing:.3px">'
        f'{label}</div>',
        unsafe_allow_html=True,
    )


def render_signal_card(
    name: str,
    status: str,
    value: float,
    unit: str,
    threshold: float,
    direction: str,
    distance: float,
    duration_str: str,
    last_triggered_str: str,
) -> None:
    """Render a dark-themed signal card with consistent fields across all tabs.

    Parameters
    ----------
    name:               Signal display name
    status:             "TRIGGERED" or "OK"
    value:              Current numeric value
    unit:               Unit string (e.g., "%", "pp", "% YoY")
    threshold:          Trigger threshold value
    direction:          "above" or "below"
    distance:           abs(value - threshold)
    duration_str:       Human-readable duration (e.g., "3mo", "2 periods")
    last_triggered_str: Formatted last-triggered date string (e.g., "Jan 2025" or "Never")
    """
    triggered = status == "TRIGGERED"
    icon = "🔴" if triggered else "🟢"
    border_color = "#e74c3c" if triggered else "#2ecc71"
    st.markdown(
        f'<div style="background:#16213e;border:1px solid #2a2a4a;'
        f'border-left:4px solid {border_color};border-radius:8px;padding:12px;'
        f'height:100%;font-size:13px;line-height:1.8;color:#e0e0e0">'
        f'<b style="font-size:14px;color:#fff">{icon} {name}</b><br>'
        f'<b style="color:#ccc">Status:</b> {status}<br>'
        f'<b style="color:#ccc">Value:</b> {value:.2f}{(" " + unit) if unit else ""}<br>'
        f'<b style="color:#ccc">Threshold:</b> {threshold} ({direction})<br>'
        f'<b style="color:#ccc">Dist from trigger:</b> {distance:.2f}<br>'
        f'<b style="color:#ccc">Duration:</b> {duration_str}<br>'
        f'<b style="color:#ccc">Last triggered:</b> {last_triggered_str}'
        f'</div>',
        unsafe_allow_html=True,
    )
