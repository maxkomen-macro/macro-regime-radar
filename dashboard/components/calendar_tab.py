"""
dashboard/components/calendar_tab.py — Calendar tab + "What to Watch Next".

Displays:
  - Upcoming 14-day event table with importance highlighting
  - "What to Watch Next" synthesis: events + active alerts + triggered signals
"""

import pandas as pd
import streamlit as st

from components.db_helpers import (
    get_upcoming_events,
    load_alert_feed,
    load_event_calendar,
)

IMP_COLORS = {"high": "#e74c3c", "medium": "#f39c12", "low": "#95a5a6"}
IMP_ICONS  = {"high": "🔴", "medium": "🟡", "low": "⚪"}
LEVEL_ICONS = {"risk": "🔴", "watch": "🟡", "info": "🔵"}


def render_calendar_tab(latest_signals: pd.DataFrame) -> None:
    """
    Main entry point — call from app.py inside the Calendar tab.

    Args:
        latest_signals: latest row per signal_name from the signals table
    """
    st.markdown("### 📅 Economic Calendar")
    st.divider()

    calendar = load_event_calendar()
    alerts   = load_alert_feed()

    # ── Upcoming Events (14 days) ──────────────────────────────────────────────
    st.markdown("**Upcoming Events — Next 14 Days**")
    upcoming_14 = get_upcoming_events(calendar, days=14)

    if upcoming_14.empty:
        st.info("No events in the next 14 days. Check `events/calendar.csv` and re-run `python src/events/load_events.py`.")
    else:
        _render_events_table(upcoming_14)

    st.divider()

    # ── Full calendar ──────────────────────────────────────────────────────────
    with st.expander("Full calendar"):
        if calendar.empty:
            st.info("Event calendar is empty.")
        else:
            _render_events_table(calendar, full=True)

    st.divider()

    # ── What to Watch Next ─────────────────────────────────────────────────────
    st.markdown("### 👁 What to Watch Next")
    _render_what_to_watch(calendar, alerts, latest_signals)


def _render_events_table(df: pd.DataFrame, full: bool = False) -> None:
    """Render events as styled cards."""
    for _, row in df.iterrows():
        imp   = row.get("importance", "medium")
        color = IMP_COLORS.get(imp, "#888")
        icon  = IMP_ICONS.get(imp, "⚪")
        name  = row["event_name"]

        # Format datetime
        dt_str = str(row.get("event_datetime", ""))[:16].replace("T", "  ")

        weight = "700" if imp == "high" else "400"
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:10px;'
            f'padding:8px 12px;margin-bottom:6px;border-radius:6px;'
            f'background:{"#fff8f8" if imp=="high" else "#fafafa"};'
            f'border-left:3px solid {color}">'
            f'<span style="font-size:16px">{icon}</span>'
            f'<div style="flex:1">'
            f'<span style="font-size:13px;font-weight:{weight}">{name}</span>'
            f'</div>'
            f'<div style="text-align:right">'
            f'<span style="font-size:12px;color:#555">{dt_str}</span><br>'
            f'<span style="font-size:11px;color:{color}">{imp.upper()}</span>'
            f'</div>'
            f'</div>',
            unsafe_allow_html=True,
        )


def _render_what_to_watch(
    calendar: pd.DataFrame,
    alerts: pd.DataFrame,
    latest_signals: pd.DataFrame,
) -> None:
    items = []

    # Next 7-day high-importance events
    upcoming_7 = get_upcoming_events(calendar, days=7)
    if not upcoming_7.empty:
        high_events = upcoming_7[upcoming_7["importance"] == "high"]
        for _, row in high_events.iterrows():
            dt_str = str(row.get("event_datetime", ""))[:10]
            items.append(f"🔴 **{row['event_name']}** on {dt_str} — high importance macro release")

    # Active risk/watch alerts
    if not alerts.empty:
        top_alerts = alerts[alerts["level"].isin(["risk", "watch"])].head(3)
        for _, row in top_alerts.iterrows():
            icon = LEVEL_ICONS.get(row["level"], "")
            items.append(f"{icon} **Alert: {row['name']}** — {row['message'][:100]}")

    # Triggered signals
    if not latest_signals.empty:
        triggered = latest_signals[latest_signals["triggered"] == 1]
        for _, row in triggered.iterrows():
            items.append(
                f"🚨 **Signal: {row['signal_name'].replace('_', ' ').title()}** triggered — "
                f"value {float(row['value']):.2f}"
            )

    if not items:
        st.info("No immediate catalysts identified for the next 7 days.")
        return

    st.markdown(
        '<div style="background:#f8f9fa;border-left:4px solid #3498db;'
        'padding:16px 20px;border-radius:6px;line-height:1.8">',
        unsafe_allow_html=True,
    )
    for item in items:
        st.markdown(f"- {item}")
    st.markdown('</div>', unsafe_allow_html=True)
