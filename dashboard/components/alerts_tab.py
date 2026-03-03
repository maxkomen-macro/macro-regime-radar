"""
dashboard/components/alerts_tab.py — Alerts Feed tab.

Displays alert_feed with:
  - Filters by alert_type (macro_signal / market) and level (risk/watch/info)
  - Full feed table, newest first
  - Color-coded severity
"""

import pandas as pd
import streamlit as st

from components.db_helpers import load_alert_feed

LEVEL_COLORS = {"risk": "#e74c3c", "watch": "#f39c12", "info": "#3498db"}
LEVEL_ICONS  = {"risk": "🔴", "watch": "🟡", "info": "🔵"}
LEVEL_BG     = {"risk": "#fff0f0", "watch": "#fffbf0", "info": "#f0f6ff"}

# Finance-friendly display for known signal/alert names
# Maps raw name → (category, "why it matters" text)
_SIGNAL_DISPLAY: dict[str, tuple[str, str]] = {
    "unemployment_spike":    ("Labor Market",  "Unemployment rising — watch for recessionary demand trajectory"),
    "yield_curve_inversion": ("Rates",         "Curve inverted — historically a leading indicator of recession"),
    "cpi_hot":               ("Inflation",     "CPI above threshold — Fed tightening risk elevated, real rates at risk"),
    "cpi_cold":              ("Inflation",     "CPI below threshold — disinflation signal, watch demand weakness"),
    "vix_spike":             ("Volatility",    "VIX spiked — risk-off conditions, elevated equity tail risk"),
}

_ALERT_TYPE_LABELS = {
    "macro_signal": "Macro Signal",
    "market":       "Market",
    "event":        "Event",
}

def _friendly_name(raw: str) -> str:
    """Convert snake_case alert name to Title Case for display."""
    return raw.replace("_", " ").title()


def render_alerts_tab() -> None:
    """Main entry point — call from app.py inside the Alerts tab."""
    st.markdown("### 🚨 Alerts Feed")
    st.caption("Macro signal and market-based alerts, newest first.")
    st.divider()

    alerts = load_alert_feed()

    if alerts.empty:
        st.info(
            "No alerts found. "
            "Run: `python -m src.analytics.alerts`"
        )
        return

    # ── Summary badges ─────────────────────────────────────────────────────────
    level_counts = alerts["level"].value_counts()
    badge_parts  = []
    for lvl in ["risk", "watch", "info"]:
        if lvl in level_counts:
            cnt   = level_counts[lvl]
            color = LEVEL_COLORS[lvl]
            badge_parts.append(
                f'<span style="background:{color};color:#fff;padding:4px 12px;'
                f'border-radius:12px;font-size:13px;margin-right:6px">'
                f'{LEVEL_ICONS[lvl]} {lvl.capitalize()}: {cnt}</span>'
            )
    if badge_parts:
        st.markdown("".join(badge_parts), unsafe_allow_html=True)
        st.markdown("")

    # ── Filters ───────────────────────────────────────────────────────────────
    f_col1, f_col2 = st.columns(2)
    with f_col1:
        alert_types  = ["All"] + sorted(alerts["alert_type"].unique().tolist())
        sel_type     = st.selectbox("Alert type", alert_types)
    with f_col2:
        levels       = ["All"] + [l for l in ["risk", "watch", "info"] if l in alerts["level"].values]
        sel_level    = st.selectbox("Severity level", levels)

    # Apply filters
    filtered = alerts.copy()
    if sel_type  != "All":
        filtered = filtered[filtered["alert_type"] == sel_type]
    if sel_level != "All":
        filtered = filtered[filtered["level"] == sel_level]

    st.caption(f"Showing {len(filtered)} of {len(alerts)} alerts")

    if filtered.empty:
        st.info("No alerts match the selected filters.")
        return

    # ── Card-style feed ────────────────────────────────────────────────────────
    for _, row in filtered.head(50).iterrows():
        lvl    = row.get("level", "info")
        color  = LEVEL_COLORS.get(lvl, "#888")
        bg     = LEVEL_BG.get(lvl, "#fafafa")
        icon   = LEVEL_ICONS.get(lvl, "")
        name   = str(row.get("name", ""))
        atype  = str(row.get("alert_type", ""))

        # Finance-native display fields
        category, why_it_matters = _SIGNAL_DISPLAY.get(name, (None, None))
        display_name  = _friendly_name(name)
        type_label    = _ALERT_TYPE_LABELS.get(atype, atype.replace("_", " ").title())
        if category is None:
            category = type_label

        # Value / threshold / direction line
        val_line = ""
        val      = row.get("value")
        thresh   = row.get("threshold")
        dirn     = row.get("direction", "")
        if pd.notna(val):
            if pd.notna(thresh):
                dir_txt  = f" {dirn} threshold {thresh:.2f}" if dirn else f" (threshold {thresh:.2f})"
                val_line = f'Value: {val:.2f}{dir_txt}'
            else:
                val_line = f'Value: {val:.2f}'
            if dirn:
                val_line += f" — {'above' if dirn == 'above' else 'below'} trigger"

        # "Why it matters": prefer lookup, fall back to truncated raw message
        if why_it_matters is None:
            raw_msg = str(row.get("message", ""))
            # Strip verbose debug suffix (everything after first sentence or 120 chars)
            why_it_matters = raw_msg.split(".")[0] if "." in raw_msg else raw_msg[:120]

        dt_str = str(row.get("date", ""))[:10]

        val_html = (
            f'<div style="font-size:11px;color:#666;margin-top:3px">{val_line}</div>'
            if val_line else ""
        )

        st.markdown(
            f'<div style="border-left:4px solid {color};background:{bg};color:#222;'
            f'border-radius:6px;padding:10px 14px;margin-bottom:10px">'
            f'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
            f'<div>'
            f'<span style="font-size:11px;color:{color};font-weight:600;text-transform:uppercase;'
            f'letter-spacing:.5px">{category}</span> '
            f'<span style="margin-left:4px;font-size:11px;background:{color};color:#fff;'
            f'padding:1px 7px;border-radius:8px">{lvl.upper()}</span>'
            f'<br><span style="font-weight:700;font-size:14px;color:#111">{icon} {display_name}</span>'
            f'</div>'
            f'<span style="font-size:11px;color:#888;white-space:nowrap;padding-left:8px">{dt_str}</span>'
            f'</div>'
            f'<div style="font-size:13px;margin-top:5px;color:#333">{why_it_matters}</div>'
            f'{val_html}'
            f'</div>',
            unsafe_allow_html=True,
        )

    if len(filtered) > 50:
        st.caption(f"Showing first 50 of {len(filtered)} alerts.")

    # ── Tabular view (expander) ────────────────────────────────────────────────
    with st.expander("View as table"):
        display_cols = ["date", "alert_type", "name", "level", "value", "threshold", "direction", "message"]
        table_df     = filtered[[c for c in display_cols if c in filtered.columns]].copy()
        if "date" in table_df.columns:
            table_df["date"] = table_df["date"].astype(str).str[:10]
        st.dataframe(table_df, use_container_width=True, hide_index=True)
