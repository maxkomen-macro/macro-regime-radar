"""
dashboard/components/shared_styles.py — Shared visual helpers for the dashboard.

Provides:
  - section_header(title)           — styled h2 with left accent bar (Bloomberg/FactSet style)
  - render_regime_badge(label)      — colored regime badge (consistent across tabs)
  - render_signal_card(...)         — dark-themed signal card with distance gauge
  - generate_sparkline_b64(...)     — tiny trend chart as base64 PNG
  - compute_momentum(...)           — z-score-based 3-month momentum label
  - SIGNAL_DISPLAY_NAMES            — maps DB signal_name keys to display names
"""

import base64
import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import streamlit as st

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}

# Maps raw DB signal_name values to professional display names
SIGNAL_DISPLAY_NAMES = {
    "yield_curve_inversion": "Curve inversion risk",
    "unemployment_spike":    "Unemployment spike",
    "cpi_hot":               "Inflation pressure",
    "cpi_cold":              "Disinflation signal",
    "vix_spike":             "VIX spike",
}


def section_header(title: str) -> None:
    """Render a section header with a left accent bar (Bloomberg/FactSet panel style)."""
    st.markdown(
        f'<h2 style="border-left:4px solid #4a9eff;padding-left:12px;'
        f'margin-top:16px;margin-bottom:12px;color:#e6edf3;font-size:20px;'
        f'font-weight:600;border-bottom:none">{title}</h2>',
        unsafe_allow_html=True,
    )


_BADGE_MUTED_STYLES = {
    "Overheating":    "background:rgba(218,54,51,0.12);color:#f08785;border:0.5px solid rgba(218,54,51,0.25)",
    "Goldilocks":     "background:rgba(63,185,80,0.12);color:#3fb950;border:0.5px solid rgba(63,185,80,0.25)",
    "Stagflation":    "background:rgba(210,153,34,0.12);color:#d29922;border:0.5px solid rgba(210,153,34,0.25)",
    "Recession Risk": "background:rgba(218,54,51,0.20);color:#f08785;border:0.5px solid rgba(218,54,51,0.40)",
}


def render_regime_badge(label: str) -> None:
    """Render a muted translucent regime badge — consistent style on every tab."""
    style = _BADGE_MUTED_STYLES.get(label, "background:#21262d;color:#8899aa;border:0.5px solid #484f58")
    st.markdown(
        f'<div style="{style};font-weight:700;font-size:18px;'
        f'padding:8px 20px;border-radius:6px;display:inline-block;letter-spacing:.3px">'
        f'{label}</div>',
        unsafe_allow_html=True,
    )


def signal_card_html(
    name: str,
    status: str,
    value: float,
    unit: str,
    threshold: float,
    direction: str,
    distance: float,
    duration_str: str,
    last_triggered_str: str,
    hist_values: tuple = (),
) -> str:
    """Return dark-themed signal card as an HTML string (for embedding in CSS grid layouts).

    Same logic as render_signal_card() but returns HTML instead of calling st.markdown.
    Includes name nowrap fix: card name is single-line with ellipsis overflow.
    """
    triggered = status == "TRIGGERED"
    unit_str = (" " + unit) if unit else ""

    # ── Gauge calculation ──────────────────────────────────────────────────────
    fill_pct = 0.0
    gauge_html = ""
    if hist_values:
        if direction == "above":
            if threshold != 0:
                fill_pct = (value / threshold) * 100
            else:
                fill_pct = 100.0 if value > 0 else 0.0
        else:  # below: fills as value approaches threshold from above
            if value <= threshold:
                fill_pct = 100.0
            elif value != 0:
                fill_pct = (threshold / value) * 100
            else:
                fill_pct = 0.0
        fill_pct = max(0.0, min(100.0, fill_pct))

        if fill_pct < 50:
            gauge_color = "#3fb950"
        elif fill_pct < 75:
            gauge_color = "#d29922"
        elif fill_pct < 95:
            gauge_color = "#e67e22"
        else:
            gauge_color = "#da3633"

        gauge_html = (
            f'<div style="font-size:9px;color:#484f58;margin-top:6px;margin-bottom:2px;">'
            f'Threshold proximity</div>'
            f'<div style="background:#21262d;border-radius:4px;height:16px;width:100%;'
            f'overflow:hidden;margin:0 0 2px;">'
            f'<div style="background:{gauge_color};height:100%;width:{fill_pct:.0f}%;'
            f'border-radius:4px;"></div></div>'
            f'<div style="display:flex;justify-content:space-between;font-size:11px;'
            f'color:#8899aa;margin-bottom:2px;">'
            f'<span>Current: {value:.2f}{unit_str}</span>'
            f'<span>Trigger: {threshold}</span></div>'
        )

    # ── Status from fill_pct ──────────────────────────────────────────────────
    if fill_pct < 50:
        status_label = "Clear"
        status_color = "#3fb950"
    elif fill_pct < 75:
        status_label = "Watch"
        status_color = "#d29922"
    else:
        status_label = "Triggered"
        status_color = "#da3633"

    icon_html = (
        f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;'
        f'background:{status_color};flex-shrink:0;"></span>'
        f'<span style="font-size:9px;color:{status_color};margin-left:4px">{status_label}</span>'
    )

    # Watch state gets a subtle amber border; all cards get a left accent bar
    if status_label == "Watch":
        card_side_border = "border:0.5px solid rgba(210,153,34,0.3);"
    elif status_label == "Triggered":
        card_side_border = "border:0.5px solid rgba(218,54,51,0.3);"
    else:
        card_side_border = "border:0.5px solid #21262d;"

    return (
        f'<div style="background:#161b22;{card_side_border}'
        f'border-left:4px solid {status_color};border-radius:8px;padding:12px;'
        f'height:100%;font-size:13px;line-height:1.8;color:#e6edf3">'
        f'<div style="display:flex;align-items:center;margin-bottom:4px;">'
        f'{icon_html}'
        f'<b style="font-size:12px;color:#e6edf3;margin-left:6px;white-space:nowrap;'
        f'overflow:hidden;text-overflow:ellipsis;display:block">{name}</b>'
        f'</div>'
        f'<b style="color:#8899aa">Value:</b> {value:.2f}{unit_str}<br>'
        f'<b style="color:#8899aa">Last alert:</b> {last_triggered_str}'
        f'{gauge_html}'
        f'</div>'
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
    hist_values: tuple = (),
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
    hist_values:        Tuple of historical signal values (oldest→newest) for gauge calculation
    """
    st.markdown(
        signal_card_html(
            name=name, status=status, value=value, unit=unit,
            threshold=threshold, direction=direction, distance=distance,
            duration_str=duration_str, last_triggered_str=last_triggered_str,
            hist_values=hist_values,
        ),
        unsafe_allow_html=True,
    )


@st.cache_data(ttl=3600)
def generate_sparkline_b64(
    values_tuple: tuple,
    width: int = 120,
    height: int = 30,
    color: str = "#4a9eff",
) -> str | None:
    """Generate a tiny sparkline chart as a base64-encoded PNG.

    values_tuple must be a tuple (not list) for st.cache_data hashability.
    Returns None if fewer than 2 values.
    """
    values = list(values_tuple)
    if len(values) < 2:
        return None
    fig, ax = plt.subplots(figsize=(width / 80, height / 80), dpi=80)
    ax.plot(range(len(values)), values, color=color, linewidth=1.5)
    ax.fill_between(range(len(values)), values, alpha=0.1, color=color)
    ax.axis("off")
    ax.margins(0)
    fig.patch.set_alpha(0)
    ax.patch.set_alpha(0)
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0, transparent=True)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


@st.cache_data(ttl=3600)
def compute_momentum(values_tuple: tuple, periods: int = 3) -> tuple:
    """Compute momentum using z-score of recent change vs historical changes.

    values_tuple: tuple of floats, oldest to newest.
    periods:      window size for change computation (3 = 3-month).

    Returns (label, arrow, color_or_None).
    color_or_None is None when caller should decide color based on good/bad direction.
    """
    values = list(values_tuple)
    if len(values) < periods + 2:
        return "—", "➡", "#888888"

    changes = [values[i] - values[i - periods] for i in range(periods, len(values))]
    if len(changes) < 2:
        return "—", "➡", "#888888"

    recent = changes[-1]
    mean = sum(changes) / len(changes)
    variance = sum((c - mean) ** 2 for c in changes) / len(changes)
    std = variance ** 0.5

    if std == 0:
        return "Stable", "➡", "#888888"

    z = (recent - mean) / std

    if z > 1.5:
        return "Accelerating", "⬆", None
    elif z > 0.5:
        return "Rising", "↗", None
    elif z > -0.5:
        return "Stable", "➡", "#888888"
    elif z > -1.5:
        return "Falling", "↘", None
    else:
        return "Decelerating", "⬇", None
