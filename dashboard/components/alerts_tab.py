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
        lvl   = row.get("level", "info")
        color = LEVEL_COLORS.get(lvl, "#888")
        bg    = LEVEL_BG.get(lvl, "#fafafa")
        icon  = LEVEL_ICONS.get(lvl, "")

        val_str = ""
        if pd.notna(row.get("value")) and pd.notna(row.get("threshold")):
            dir_str  = row.get("direction", "")
            dir_text = f" ({dir_str} {row['threshold']:.2f})" if dir_str else f" (threshold {row['threshold']:.2f})"
            val_str  = f'<br><span style="font-size:11px;color:#666">Value: {row["value"]:.2f}{dir_text}</span>'

        dt_str = str(row.get("date", ""))[:10]

        st.markdown(
            f'<div style="border-left:4px solid {color};background:{bg};'
            f'border-radius:6px;padding:10px 14px;margin-bottom:10px">'
            f'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
            f'<div>'
            f'<span style="font-weight:700;font-size:14px">{icon} {row["name"]}</span>'
            f'<span style="margin-left:8px;font-size:11px;background:{color};color:#fff;'
            f'padding:2px 8px;border-radius:8px">{lvl.upper()}</span>'
            f'<span style="margin-left:8px;font-size:11px;color:#888">{row.get("alert_type","")}</span>'
            f'</div>'
            f'<span style="font-size:11px;color:#888">{dt_str}</span>'
            f'</div>'
            f'<div style="font-size:13px;margin-top:5px;color:#333">{row["message"]}</div>'
            f'{val_str}'
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
