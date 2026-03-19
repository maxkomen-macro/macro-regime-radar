"""
dashboard/components/decision_view.py — Decision View tab (PM scan in 20 seconds).

Designed to surface the most critical information at a glance:
  - Current regime + confidence + as-of date
  - Top drivers (growth/inflation trends + market surprises)
  - Top 2 risks (highest-severity alerts)
  - Active signals summary
  - What's Priced highlights
  - Upcoming events (7 days)
  - Playbook bias text
"""

import pandas as pd
import streamlit as st

from components.db_helpers import (
    build_surprises_df,
    get_derived_latest,
    get_upcoming_events,
    has_market_data,
    load_alert_feed,
    load_derived_metrics,
    load_event_calendar,
    load_playbook,
    render_surprises,
)
from components.shared_styles import render_regime_badge, render_signal_card, section_header, SIGNAL_DISPLAY_NAMES

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}

SIGNAL_META = {
    "yield_curve_inversion": {"label": "Curve Inversion",    "unit": "%",      "threshold": 0.0,  "direction": "below"},
    "unemployment_spike":    {"label": "Labor Deterioration","unit": "pp",     "threshold": 0.3,  "direction": "above"},
    "cpi_hot":               {"label": "Inflation Hot",      "unit": "% YoY",  "threshold": 4.0,  "direction": "above"},
    "cpi_cold":              {"label": "Inflation Cold",     "unit": "% YoY",  "threshold": 1.0,  "direction": "below"},
    "vix_spike":             {"label": "Vol Spike",          "unit": "",       "threshold": 30.0, "direction": "above"},
}

LEVEL_COLORS = {"risk": "#e74c3c", "watch": "#f39c12", "info": "#3498db"}
LEVEL_ICONS  = {"risk": "🔴", "watch": "🟡", "info": "🔵"}


def render_decision_view(
    latest_regime,
    regimes_df: pd.DataFrame,
    latest_signals: pd.DataFrame,
    signals_df: pd.DataFrame,
    as_of,
) -> None:
    """Main entry point — call from app.py inside the Decision View tab."""

    st.divider()

    # Load new-table data
    dm        = load_derived_metrics()
    alerts    = load_alert_feed()
    calendar  = load_event_calendar()
    playbook  = load_playbook()
    market_ok = has_market_data()

    # ── Row 1: Top Risks | Upcoming Events (regime shown in header bar) ─────────
    col_risks, col_events = st.columns([1, 1])

    with col_risks:
        _render_top_risks(alerts)

    with col_events:
        _render_upcoming_events(calendar, days=7)

    st.divider()

    # ── Row 2: Signals | What's Priced highlights ─────────────────────────────
    col_sig, col_priced = st.columns([3, 2])

    with col_sig:
        _render_signals_strip(latest_signals, signals_df)

    with col_priced:
        _render_priced_highlights(dm)

    st.divider()

    # ── Row 3: Surprises (playbook bias shown in header read-through box) ────────
    if market_ok and not dm.empty:
        render_surprises(dm, top_n=5, title="Top Surprises This Week")
    elif not market_ok:
        st.warning("Market data not yet loaded — run `python src/market_data/fetch_market.py --mode backfill`")
    else:
        st.info("Surprise data not available — run `python -m src.analytics.surprise`")


# ─────────────────────────────────────────────────────────────────────────────
# Sub-renderers
# ─────────────────────────────────────────────────────────────────────────────

def _render_regime_tile(latest_regime, regimes_df, as_of) -> None:
    st.markdown("**Current Regime**")
    if latest_regime is None:
        st.warning("No regime data.")
        return

    lbl    = str(latest_regime["label"])
    conf   = float(latest_regime["confidence"])
    bg     = REGIME_COLORS.get(lbl, "#888")
    gt     = float(latest_regime["growth_trend"])
    it     = float(latest_regime["inflation_trend"])
    ao_str = as_of.strftime("%b %Y") if as_of is not None else "N/A"

    render_regime_badge(lbl)
    st.metric("Confidence", f"{conf:.1%}")
    st.caption(f"As of {ao_str}")

    # Trend pills
    g_color  = "#2ecc71" if gt >= 0 else "#e74c3c"
    i_color  = "#e74c3c" if it > 0.5 else ("#f39c12" if it > 0 else "#2ecc71")
    g_arrow  = "▲" if gt >= 0 else "▼"
    i_arrow  = "▲" if it >= 0 else "▼"
    st.markdown(
        f'<div style="display:flex;gap:8px;margin-top:6px">'
        f'<span style="background:{g_color};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px">'
        f'Growth {g_arrow} {gt:.2f}</span>'
        f'<span style="background:{i_color};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px">'
        f'Inflation {i_arrow} {it:.2f}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )


def _render_top_risks(alerts: pd.DataFrame) -> None:
    st.markdown("**Top Risks**")
    if alerts.empty:
        st.info("No alerts — run `python -m src.analytics.alerts`")
        return

    # Count by level
    level_counts = alerts["level"].value_counts()
    badges_html = " ".join(
        f'<span style="background:{LEVEL_COLORS.get(lvl,"#888")};color:#fff;'
        f'padding:3px 9px;border-radius:10px;font-size:12px">'
        f'{LEVEL_ICONS.get(lvl,"")} {lvl.capitalize()}: {cnt}</span>'
        for lvl, cnt in level_counts.items()
        if lvl in LEVEL_COLORS
    )
    if badges_html:
        st.markdown(badges_html, unsafe_allow_html=True)
        st.markdown("")

    # Top 2 risk-level alerts
    risk_alerts = alerts[alerts["level"] == "risk"].head(2)
    if risk_alerts.empty:
        watch_alerts = alerts[alerts["level"] == "watch"].head(2)
        risk_alerts  = watch_alerts

    for _, row in risk_alerts.iterrows():
        lvl   = row["level"]
        color = LEVEL_COLORS.get(lvl, "#888")
        icon  = LEVEL_ICONS.get(lvl, "")
        val_str = f"  |  {row['value']:.2f}" if pd.notna(row.get("value")) else ""
        st.markdown(
            f'<div style="border-left:3px solid {color};padding:8px 12px;'
            f'margin-bottom:8px;background:#fafafa;border-radius:4px">'
            f'<div style="font-size:13px;font-weight:600">{icon} {row["name"]}</div>'
            f'<div style="font-size:12px;color:#555;margin-top:2px">{row["message"][:120]}</div>'
            f'<div style="font-size:11px;color:#888;margin-top:2px">'
            f'{str(row["date"])[:10]}{val_str}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    if len(alerts) > 2:
        st.caption(f"+ {len(alerts) - 2} more alerts — see Alerts tab")


def _render_upcoming_events(calendar: pd.DataFrame, days: int = 7) -> None:
    st.markdown(f"**Upcoming Events (next {days}d)**")
    upcoming = get_upcoming_events(calendar, days=days)
    if upcoming.empty:
        st.info("No events in the next 7 days.")
        return

    imp_colors = {"high": "#e74c3c", "medium": "#f39c12", "low": "#95a5a6"}
    for _, row in upcoming.iterrows():
        imp    = row.get("importance", "medium")
        color  = imp_colors.get(imp, "#95a5a6")
        dt_str = str(row.get("event_datetime", ""))[:10]
        name   = row["event_name"]
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">'
            f'<span style="width:8px;height:8px;border-radius:50%;background:{color};'
            f'flex-shrink:0;display:inline-block"></span>'
            f'<span style="font-size:13px"><b>{name}</b></span>'
            f'<span style="font-size:11px;color:#888;margin-left:auto">{dt_str}</span>'
            f'</div>',
            unsafe_allow_html=True,
        )


def _render_signals_strip(latest_signals: pd.DataFrame, signals_df: pd.DataFrame) -> None:
    st.markdown("**Signal Monitor**")
    if latest_signals.empty:
        st.info("No signal data loaded — run `python -m src.analytics.signals`")
        return

    signal_list = list(SIGNAL_META.items())
    row1_cols = st.columns(3)
    row2_cols = st.columns(2)
    as_of_dates = []

    for i, (sname, smeta) in enumerate(signal_list):
        col = row1_cols[i] if i < 3 else row2_cols[i - 3]
        with col:
            srow = None
            if sname in latest_signals["signal_name"].values:
                srow = latest_signals[latest_signals["signal_name"] == sname].iloc[0]

            if srow is None:
                st.markdown(
                    f'<div style="border:1px solid #ddd;border-radius:6px;padding:10px;'
                    f'font-size:12px;text-align:center;color:#555">'
                    f'<b style="color:#222">{smeta["label"]}</b><br>'
                    f'<span style="color:#888">No data</span></div>',
                    unsafe_allow_html=True,
                )
                continue

            triggered  = bool(int(srow["triggered"]))
            val        = float(srow["value"])
            threshold  = smeta["threshold"]
            direction  = smeta["direction"]
            status     = "TRIGGERED" if triggered else "OK"
            dist       = abs(val - threshold)

            # Duration: consecutive triggered months ending at latest date
            all_s = signals_df[signals_df["signal_name"] == sname] if not signals_df.empty else pd.DataFrame()
            dur = 0
            last_trig_date = None
            if not all_s.empty:
                s_sorted = all_s.sort_values("date", ascending=False).reset_index(drop=True)
                for _, r in s_sorted.iterrows():
                    if int(r["triggered"]) == 1:
                        dur += 1
                        if last_trig_date is None:
                            last_trig_date = str(r["date"])[:10]
                    else:
                        if last_trig_date is None and dur == 0:
                            triggered_rows = s_sorted[s_sorted["triggered"] == 1]
                            if not triggered_rows.empty:
                                last_trig_date = str(triggered_rows.iloc[0]["date"])[:10]
                        break
                if last_trig_date is None:
                    triggered_rows = s_sorted[s_sorted["triggered"] == 1]
                    if not triggered_rows.empty:
                        last_trig_date = str(triggered_rows.iloc[0]["date"])[:10]

            last_triggered_str = last_trig_date if last_trig_date else "Never"

            # Track as-of date for caption
            row_date = str(srow.get("date", ""))[:10]
            if row_date:
                as_of_dates.append(row_date)

            hist_values = ()
            if not all_s.empty:
                hist_values = tuple(all_s.sort_values("date")["value"].dropna().tolist())

            render_signal_card(
                name=SIGNAL_DISPLAY_NAMES.get(sname, smeta["label"]),
                status=status,
                value=val,
                unit=smeta["unit"],
                threshold=threshold,
                direction=direction,
                distance=dist,
                duration_str=f"{dur}mo",
                last_triggered_str=last_triggered_str,
                hist_values=hist_values,
            )

    if as_of_dates:
        st.caption(f"Signals as of {max(as_of_dates)}")


def _render_priced_highlights(dm: pd.DataFrame) -> None:
    st.markdown("**What's Priced — Highlights**")
    if dm.empty:
        st.info("No priced data — run `python -m src.analytics.priced`")
        return

    metrics = [
        ("FEDFUNDS_latest",  "Fed Funds",   "FEDFUNDS_mom_chg",  "%"),
        ("T10YIE_latest",    "10Y Breakevn","T10YIE_mom_chg",   "%"),
        ("DFII10_latest",    "10Y Real Yld","DFII10_mom_chg",   "%"),
    ]
    found_any = False
    for val_col, label, chg_col, unit in metrics:
        val = get_derived_latest(dm, val_col)
        chg = get_derived_latest(dm, chg_col)
        if val is not None:
            found_any = True
            delta_str = f"{chg:+.2f}{unit} MoM" if chg is not None else None
            st.metric(label, f"{val:.2f}{unit}", delta=delta_str)

    if not found_any:
        st.info("Run `python -m src.analytics.priced` to populate.")

    # Brief interpretation
    t10 = get_derived_latest(dm, "T10YIE_latest")
    df10 = get_derived_latest(dm, "DFII10_latest")
    if t10 is not None or df10 is not None:
        msgs = []
        if t10 is not None:
            if t10 > 2.5:
                msgs.append(f"10Y breakeven {t10:.2f}% — above-target inflation priced in")
            elif t10 < 1.5:
                msgs.append(f"10Y breakeven {t10:.2f}% — benign inflation priced in")
        if df10 is not None:
            if df10 > 1.5:
                msgs.append(f"Real rate {df10:.2f}% — restrictive (equity headwind)")
            elif df10 < 0:
                msgs.append(f"Real rate {df10:.2f}% — accommodative (risk-on tailwind)")
        if msgs:
            st.caption(" | ".join(msgs))


def _render_playbook_bias(playbook: dict) -> None:
    st.markdown("**Playbook Bias**")
    if not playbook:
        st.info("No playbook — run `python -m src.analytics.playbook`")
        return

    regime   = playbook.get("regime", "Unknown")
    conf     = playbook.get("confidence", 0)
    baseline = playbook.get("baseline", "")
    because  = playbook.get("because_today", [])
    bg       = REGIME_COLORS.get(regime, "#888")

    st.markdown(
        f'<div style="background:{bg};color:#fff;padding:12px 16px;'
        f'border-radius:8px;font-size:15px;font-weight:700;margin-bottom:8px">'
        f'{regime} — <span style="font-weight:400;font-size:13px">{conf:.1%} confidence</span>'
        f'</div>',
        unsafe_allow_html=True,
    )
    if baseline:
        st.markdown(
            f'<div style="font-size:14px;line-height:1.6;color:#e0e0e0;'
            f'border-left:3px solid {bg};padding:12px 12px;margin-bottom:8px;'
            f'background:rgba(255,255,255,0.05);border-radius:0 6px 6px 0">'
            f'{baseline}</div>',
            unsafe_allow_html=True,
        )
    for sentence in because[:3]:
        st.markdown(
            f'<div style="font-size:13px;color:#b0b0b0;line-height:1.6;margin-bottom:4px">'
            f'↳ {sentence}</div>',
            unsafe_allow_html=True,
        )
