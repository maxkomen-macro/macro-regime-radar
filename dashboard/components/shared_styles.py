"""
dashboard/components/shared_styles.py — Shared visual helpers for the dashboard.

Provides:
  - section_header(title)           — styled h2 with left accent bar (Bloomberg/FactSet style)
  - render_regime_badge(label)      — colored regime badge (consistent across tabs)
  - render_signal_card(...)         — dark-themed signal card with distance gauge
  - generate_sparkline_b64(...)     — tiny trend chart as base64 PNG
  - compute_momentum(...)           — z-score-based 3-month momentum label
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
    triggered = status == "TRIGGERED"
    icon = "🔴" if triggered else "🟢"
    border_color = "#e74c3c" if triggered else "#2ecc71"
    unit_str = (" " + unit) if unit else ""

    # ── Gauge calculation ──────────────────────────────────────────────────────
    gauge_html = ""
    if hist_values:
        if triggered:
            fill_pct = 100.0
        else:
            if direction == "above":
                safe_floor = min(0.0, min(hist_values))
                denom = threshold - safe_floor
                fill_pct = ((value - safe_floor) / denom * 100) if denom > 0 else 0.0
            else:  # below
                safe_ceil = max(hist_values)
                denom = safe_ceil - threshold
                fill_pct = ((safe_ceil - value) / denom * 100) if denom > 0 else 0.0
            fill_pct = max(0.0, min(100.0, fill_pct))

        if fill_pct < 50:
            gauge_color = "#2ecc71"
        elif fill_pct < 75:
            gauge_color = "#f1c40f"
        elif fill_pct < 95:
            gauge_color = "#e67e22"
        else:
            gauge_color = "#e74c3c"

        gauge_html = (
            f'<div style="background:#2a2a4a;border-radius:4px;height:16px;width:100%;'
            f'overflow:hidden;margin:8px 0 2px;">'
            f'<div style="background:{gauge_color};height:100%;width:{fill_pct:.0f}%;'
            f'border-radius:4px;"></div></div>'
            f'<div style="display:flex;justify-content:space-between;font-size:11px;'
            f'color:#aaa;margin-bottom:2px;">'
            f'<span>Current: {value:.2f}{unit_str}</span>'
            f'<span>Trigger: {threshold}</span></div>'
        )

    st.markdown(
        f'<div style="background:#16213e;border:1px solid #2a2a4a;'
        f'border-left:4px solid {border_color};border-radius:8px;padding:12px;'
        f'height:100%;font-size:13px;line-height:1.8;color:#e0e0e0">'
        f'<b style="font-size:14px;color:#fff">{icon} {name}</b><br>'
        f'<b style="color:#ccc">Value:</b> {value:.2f}{unit_str}<br>'
        f'<b style="color:#ccc">Last triggered:</b> {last_triggered_str}'
        f'{gauge_html}'
        f'</div>',
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
