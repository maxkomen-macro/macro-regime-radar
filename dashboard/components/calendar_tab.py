"""
dashboard/components/calendar_tab.py — Calendar tab + "What to Watch Next".

Displays:
  - Upcoming 14-day event table with importance highlighting
  - "What to Watch Next" synthesis: events + active alerts + triggered signals
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st

from components.db_helpers import (
    get_upcoming_events,
    load_alert_feed,
    load_event_calendar,
)
from components.shared_styles import section_header, SIGNAL_DISPLAY_NAMES

_ET = ZoneInfo("America/New_York")

IMP_COLORS = {"high": "#e74c3c", "medium": "#f39c12", "low": "#95a5a6"}
IMP_ICONS  = {"high": "🔴", "medium": "🟡", "low": "⚪"}
LEVEL_ICONS = {"risk": "🔴", "watch": "🟡", "info": "🔵"}


def render_calendar_tab(latest_signals: pd.DataFrame) -> None:
    """
    Main entry point — call from app.py inside the Calendar tab.

    Args:
        latest_signals: latest row per signal_name from the signals table
    """
    section_header("ECONOMIC CALENDAR")
    st.divider()

    calendar = load_event_calendar()
    alerts   = load_alert_feed()

    # Last refreshed timestamp
    if not calendar.empty and "created_at" in calendar.columns:
        last_refresh = str(calendar["created_at"].max())[:16]
        st.caption(f"Last refreshed: {last_refresh} UTC")

    # ── Upcoming Events (14 days) ──────────────────────────────────────────────
    section_header("UPCOMING EVENTS — NEXT 14 DAYS")
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
    section_header("WHAT TO WATCH NEXT")
    _render_what_to_watch(calendar, alerts, latest_signals)


def _days_until_str(event_datetime_str: str) -> str:
    """Return human 'days until' string from ISO 8601 UTC event_datetime."""
    try:
        dt_utc = datetime.fromisoformat(event_datetime_str.rstrip("Z")).replace(tzinfo=timezone.utc)
        today  = datetime.now(timezone.utc).date()
        delta  = (dt_utc.date() - today).days
        if delta == 0:
            return "today"
        if delta == 1:
            return "tomorrow"
        if delta < 0:
            return f"{abs(delta)}d ago"
        return f"in {delta}d"
    except Exception:
        return ""


def _format_event_time(event_datetime_str: str) -> str:
    """Return 'Mon DD · H:MM AM/PM ET' from ISO 8601 UTC string."""
    try:
        dt_utc = datetime.fromisoformat(event_datetime_str.rstrip("Z")).replace(tzinfo=timezone.utc)
        dt_et  = dt_utc.astimezone(_ET)
        return dt_et.strftime("%b %-d · %-I:%M %p ET")
    except Exception:
        return str(event_datetime_str)[:16].replace("T", " ")


def _render_events_table(df: pd.DataFrame, full: bool = False) -> None:
    """Render events as styled cards with visible text, ET time, and days-until."""
    for _, row in df.iterrows():
        imp      = row.get("importance", "medium")
        color    = IMP_COLORS.get(imp, "#888")
        name     = row["event_name"]
        raw_dt   = str(row.get("event_datetime", ""))
        time_str = _format_event_time(raw_dt)
        days_str = _days_until_str(raw_dt)
        weight = "700" if imp == "high" else "500"

        st.markdown(
            f'<div style="display:flex;align-items:center;gap:10px;'
            f'padding:8px 12px;margin-bottom:6px;border-radius:6px;'
            f'background:#161b22;border:0.5px solid #21262d;border-left:3px solid {color}">'
            f'<div style="flex:1">'
            f'<span style="font-size:13px;font-weight:{weight};color:#e6edf3">{name}</span><br>'
            f'<span style="font-size:11px;color:#8899aa">{time_str}</span>'
            f'</div>'
            f'<div style="text-align:right">'
            f'<span style="font-size:12px;color:#c9d1d9;font-weight:600">{days_str}</span><br>'
            f'<span style="font-size:11px;color:{color}">{imp.upper()}</span>'
            f'</div>'
            f'</div>',
            unsafe_allow_html=True,
        )


def _fmt_event_date(event_datetime_str: str) -> str:
    """Format event datetime as 'Mar 19, 2026'."""
    try:
        dt = datetime.fromisoformat(str(event_datetime_str).rstrip("Z"))
        return dt.strftime("%b %-d, %Y")
    except Exception:
        return str(event_datetime_str)[:10]


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
            dt_str = _fmt_event_date(str(row.get("event_datetime", "")))
            items.append(f"**{row['event_name']}** on {dt_str} — high importance macro release")

    # Active risk/watch alerts
    if not alerts.empty:
        top_alerts = alerts[alerts["level"].isin(["risk", "watch"])].head(3)
        for _, row in top_alerts.iterrows():
            raw_name = str(row["name"])
            display_name = SIGNAL_DISPLAY_NAMES.get(raw_name, raw_name.replace("_", " ").title())
            level_label = row["level"].capitalize()
            items.append(f"**{level_label}: {display_name}** — {row['message'][:100]}")

    # Triggered signals
    if not latest_signals.empty:
        triggered = latest_signals[latest_signals["triggered"] == 1]
        for _, row in triggered.iterrows():
            sname = str(row["signal_name"])
            display_name = SIGNAL_DISPLAY_NAMES.get(sname, sname.replace("_", " ").title())
            items.append(
                f"**Signal: {display_name}** triggered — value {float(row['value']):.2f}"
            )

    if not items:
        st.info("No immediate catalysts identified for the next 7 days.")
        return

    st.markdown(
        '<div style="background:#161b22;border:0.5px solid #21262d;border-left:4px solid #4a9eff;'
        'padding:16px 20px;border-radius:6px;line-height:1.8;color:#c9d1d9">',
        unsafe_allow_html=True,
    )
    for item in items:
        st.markdown(f"- {item}")
    st.markdown('</div>', unsafe_allow_html=True)
