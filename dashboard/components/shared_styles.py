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
import plotly.graph_objects as go
import plotly.io as pio
import streamlit as st

# ─────────────────────────────────────────────────────────────────────────────
# Macro RR brand tokens (Canva kit: off-white sheet, navy margins/accent, gold only in logo)
# ─────────────────────────────────────────────────────────────────────────────

BRAND = {
    "shell":   "#000b3d",   # app shell / margins / header band (navy)
    "page":    "#f3f4f6",   # content sheet (off-white)
    "card":    "#ffffff",   # card surface
    "line":    "#e3e6ec",   # subtle divider
    "border":  "#d3d7e0",   # card border
    "dim":     "#8a92a8",   # tertiary text
    "muted":   "#5b6480",   # secondary text
    "text":    "#0b1540",   # primary text
    "accent":  "#000b3d",   # single accent (navy)
    "gold":    "#c69842",   # logo crown + header hairline only
    "green":   "#1e9e5a",
    "orange":  "#d9772a",
    "amber":   "#b8860b",
    "red":     "#d23f3f",
    "grey":    "#7a829a",
}

FONT_UI   = "'Helvetica Neue', Helvetica, Arial, sans-serif"
FONT_MONO = "'SF Mono', Menlo, Consolas, monospace"

# Plotly template used by every chart (replaces plotly_white / plotly_dark).
pio.templates["macro_rr"] = go.layout.Template(
    layout=go.Layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family=FONT_UI, color=BRAND["muted"], size=11),
        title=dict(font=dict(color=BRAND["text"], size=13)),
        xaxis=dict(gridcolor=BRAND["line"], zerolinecolor=BRAND["border"],
                   linecolor=BRAND["border"], tickcolor=BRAND["border"]),
        yaxis=dict(gridcolor=BRAND["line"], zerolinecolor=BRAND["border"],
                   linecolor=BRAND["border"], tickcolor=BRAND["border"]),
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(color=BRAND["muted"])),
        hoverlabel=dict(bgcolor=BRAND["card"], bordercolor=BRAND["border"],
                        font=dict(color=BRAND["text"], family=FONT_UI)),
        colorway=[BRAND["accent"], "#3b6fc4", BRAND["green"], BRAND["orange"],
                  BRAND["red"], BRAND["grey"]],
    )
)
pio.templates.default = "macro_rr"

REGIME_COLORS = {
    "Goldilocks":     "#1e9e5a",
    "Overheating":    "#d9772a",
    "Stagflation":    "#d23f3f",
    "Recession Risk": "#7a829a",
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
    """Render a section header in the 3A design system style — 11px uppercase, muted."""
    st.markdown(
        f'<div style="font-size:11px;font-weight:600;text-transform:uppercase;'
        f'letter-spacing:0.5px;color:#5b6480;padding-bottom:6px;'
        f'border-bottom:1px solid #e3e6ec;margin-bottom:10px;margin-top:16px">'
        f'{title}</div>',
        unsafe_allow_html=True,
    )


def subsection_header(title: str) -> None:
    """Render a sub-section header — 12px normal case, lighter text, no border."""
    st.markdown(
        f'<div style="font-size:12px;font-weight:500;color:#2c3556;'
        f'margin-top:12px;margin-bottom:6px">{title}</div>',
        unsafe_allow_html=True,
    )


_BADGE_MUTED_STYLES = {
    "Overheating":    "background:rgba(210,63,63,0.12);color:#c43c3c;border:0.5px solid rgba(210,63,63,0.25)",
    "Goldilocks":     "background:rgba(30,158,90,0.12);color:#1e9e5a;border:0.5px solid rgba(30,158,90,0.25)",
    "Stagflation":    "background:rgba(184,134,11,0.12);color:#b8860b;border:0.5px solid rgba(184,134,11,0.25)",
    "Recession Risk": "background:rgba(210,63,63,0.20);color:#c43c3c;border:0.5px solid rgba(210,63,63,0.40)",
}


def render_regime_badge(label: str) -> None:
    """Render a muted translucent regime badge — consistent style on every tab."""
    style = _BADGE_MUTED_STYLES.get(label, "background:#e3e6ec;color:#5b6480;border:0.5px solid #8a92a8")
    st.markdown(
        f'<div style="{style};font-weight:700;font-size:18px;'
        f'padding:8px 20px;border-radius:6px;display:inline-block;letter-spacing:.3px">'
        f'{label}</div>',
        unsafe_allow_html=True,
    )


_SIGNAL_TOOLTIPS = {
    "Inflation pressure":  "Monitors CPI year-over-year for sustained above-target inflation",
    "Curve inversion risk": "Monitors the 10Y–2Y Treasury spread for yield curve inversion",
}


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
    """Return compact dark-themed signal card as an HTML string.

    Layout: name + status dot (top row) | big value | thin gauge bar | last alert date.
    """
    # Unit formatting: no leading space for % units
    if unit.startswith("%"):
        unit_str = unit
    elif unit:
        unit_str = " " + unit
    else:
        unit_str = ""

    value_display = f"{value:.2f}{unit_str}"

    # ── Gauge calculation (unchanged logic) ────────────────────────────────────
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
            gauge_color = "#1e9e5a"
        elif fill_pct < 75:
            gauge_color = "#b8860b"
        elif fill_pct < 95:
            gauge_color = "#d9772a"
        else:
            gauge_color = "#d23f3f"

        gauge_html = (
            f'<div style="font-size:9px;color:#8a92a8;margin-top:8px;margin-bottom:3px;">'
            f'Threshold proximity</div>'
            f'<div style="background:#e3e6ec;border-radius:3px;height:4px;width:100%;'
            f'overflow:hidden;margin-bottom:8px;">'
            f'<div style="background:{gauge_color};height:100%;width:{fill_pct:.0f}%;'
            f'border-radius:3px;"></div></div>'
        )

    # ── Status from fill_pct ──────────────────────────────────────────────────
    if fill_pct < 50:
        status_label = "Clear"
        status_color = "#1e9e5a"
    elif fill_pct < 75:
        status_label = "Watch"
        status_color = "#b8860b"
    else:
        status_label = "Triggered"
        status_color = "#d23f3f"

    # Card border: full border, no left accent bar
    if status_label == "Watch":
        card_border = "border:0.5px solid rgba(184,134,11,0.3);"
    elif status_label == "Triggered":
        card_border = "border:0.5px solid rgba(210,63,63,0.3);"
    else:
        card_border = "border:0.5px solid #e3e6ec;"

    # Optional tooltip for specific signals
    tooltip = _SIGNAL_TOOLTIPS.get(name, "")
    tooltip_attr = f' title="{tooltip}"' if tooltip else ""

    return (
        f'<div style="background:#ffffff;{card_border}border-radius:6px;padding:12px;"'
        f'{tooltip_attr}>'
        f'<div style="display:flex;justify-content:space-between;align-items:center;'
        f'margin-bottom:6px;">'
        f'<span style="font-size:12px;font-weight:500;color:#0b1540;white-space:nowrap;'
        f'overflow:hidden;text-overflow:ellipsis;max-width:65%">{name}</span>'
        f'<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">'
        f'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
        f'background:{status_color};"></span>'
        f'<span style="font-size:9px;color:{status_color}">{status_label}</span>'
        f'</div>'
        f'</div>'
        f'<div style="font-size:18px;font-weight:600;color:#0b1540;'
        f'font-variant-numeric:tabular-nums;margin-bottom:2px;">{value_display}</div>'
        f'{gauge_html}'
        f'<div style="font-size:10px;color:#8a92a8;">Last alert: {last_triggered_str}</div>'
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
    color: str = "#000b3d",
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
        return "—", "➡", "#6f7893"

    changes = [values[i] - values[i - periods] for i in range(periods, len(values))]
    if len(changes) < 2:
        return "—", "➡", "#6f7893"

    recent = changes[-1]
    mean = sum(changes) / len(changes)
    variance = sum((c - mean) ** 2 for c in changes) / len(changes)
    std = variance ** 0.5

    if std == 0:
        return "Stable", "➡", "#6f7893"

    z = (recent - mean) / std

    if z > 1.5:
        return "Accelerating", "⬆", None
    elif z > 0.5:
        return "Rising", "↗", None
    elif z > -0.5:
        return "Stable", "➡", "#6f7893"
    elif z > -1.5:
        return "Falling", "↘", None
    else:
        return "Decelerating", "⬇", None
