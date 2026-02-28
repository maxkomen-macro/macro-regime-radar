"""
dashboard/components/whats_priced.py — What's Priced tab.

Displays policy proxies (FEDFUNDS, SOFR), breakevens (T5YIE, T10YIE),
and real yields (DFII5, DFII10) from derived_metrics, with interpretation.
"""

import pandas as pd
import streamlit as st

from components.db_helpers import get_derived_latest, load_derived_metrics

METRIC_GROUPS = [
    {
        "title":   "Policy Rate Proxies",
        "metrics": [
            ("FEDFUNDS_latest", "FEDFUNDS_mom_chg",  "Fed Funds Rate",       "%"),
            ("SOFR_latest",     "SOFR_mom_chg",      "SOFR",                 "%"),
        ],
    },
    {
        "title":   "Inflation Breakevens",
        "metrics": [
            ("T5YIE_latest",  "T5YIE_mom_chg",   "5Y Breakeven",  "%"),
            ("T10YIE_latest", "T10YIE_mom_chg",  "10Y Breakeven", "%"),
        ],
    },
    {
        "title":   "Real Yields (TIPS)",
        "metrics": [
            ("DFII5_latest",  "DFII5_mom_chg",   "5Y Real Yield",  "%"),
            ("DFII10_latest", "DFII10_mom_chg",  "10Y Real Yield", "%"),
        ],
    },
]


def render_whats_priced() -> None:
    """Main entry point — call from app.py inside the What's Priced tab."""
    st.markdown("### 💲 What's Priced")
    st.caption("Policy rate proxies, inflation breakevens, and TIPS real yields — latest data from FRED.")
    st.divider()

    dm = load_derived_metrics()
    if dm.empty:
        st.warning(
            "No derived metrics available. "
            "Run: `python -m src.analytics.priced`"
        )
        return

    any_found = False
    for group in METRIC_GROUPS:
        st.markdown(f"**{group['title']}**")
        cols = st.columns(len(group["metrics"]))
        group_found = False

        for i, (val_col, chg_col, label, unit) in enumerate(group["metrics"]):
            val = get_derived_latest(dm, val_col)
            chg = get_derived_latest(dm, chg_col)
            with cols[i]:
                if val is not None:
                    group_found = True
                    any_found   = True
                    delta_str   = f"{chg:+.2f}{unit} MoM" if chg is not None else None
                    st.metric(label, f"{val:.2f}{unit}", delta=delta_str)
                else:
                    st.metric(label, "N/A")
                    st.caption(f"_{val_col} not in DB_")

        if not group_found:
            st.warning(f"{group['title']}: no data — run `python -m src.analytics.priced`")

        st.markdown("")

    if not any_found:
        return

    st.divider()

    # ── Interpretation ─────────────────────────────────────────────────────────
    st.markdown("**Trader Interpretation**")
    _render_interpretation(dm)


def _render_interpretation(dm: pd.DataFrame) -> None:
    ff   = get_derived_latest(dm, "FEDFUNDS_latest")
    sofr = get_derived_latest(dm, "SOFR_latest")
    t5be = get_derived_latest(dm, "T5YIE_latest")
    t10be = get_derived_latest(dm, "T10YIE_latest")
    r5   = get_derived_latest(dm, "DFII5_latest")
    r10  = get_derived_latest(dm, "DFII10_latest")

    msgs = []

    # Policy
    rate = ff if ff is not None else sofr
    if rate is not None:
        label = "Fed Funds" if ff is not None else "SOFR"
        if rate >= 5.0:
            msgs.append(f"**Policy rate ({label} {rate:.2f}%):** Restrictive territory — Fed anchored at multi-decade highs. Risk assets face a high opportunity-cost hurdle.")
        elif rate >= 3.0:
            msgs.append(f"**Policy rate ({label} {rate:.2f}%):** Moderately restrictive. Easing cycle would be a near-term tailwind for duration and risk.")
        else:
            msgs.append(f"**Policy rate ({label} {rate:.2f}%):** Accommodative. Low-rate environment supports equity multiples and credit.")

    # Breakevens
    be = t10be if t10be is not None else t5be
    if be is not None:
        if be > 2.8:
            msgs.append(f"**Breakevens ({be:.2f}%):** Well above 2% target — markets pricing persistent inflation. TIPS and real assets favored over nominals.")
        elif be > 2.2:
            msgs.append(f"**Breakevens ({be:.2f}%):** Modestly above target. Inflation risk premium exists but not alarming; monitor incoming CPI prints.")
        elif be > 1.5:
            msgs.append(f"**Breakevens ({be:.2f}%):** Near target — inflation expectations anchored. Nominal bonds viable vs. TIPS.")
        else:
            msgs.append(f"**Breakevens ({be:.2f}%):** Below 2% — markets pricing disinflation or deflation risk. Duration attractive; TIPS underperform.")

    # Real yields
    ry = r10 if r10 is not None else r5
    if ry is not None:
        if ry > 2.0:
            msgs.append(f"**Real yields ({ry:.2f}%):** Highly restrictive. Strong headwind for growth stocks, gold, and long-duration assets. Dollar supportive.")
        elif ry > 1.0:
            msgs.append(f"**Real yields ({ry:.2f}%):** Restrictive. Growth vs. value spread likely to compress; gold faces headwinds.")
        elif ry > 0:
            msgs.append(f"**Real yields ({ry:.2f}%):** Mildly positive. Balanced environment — real yields not yet a dominant driver.")
        else:
            msgs.append(f"**Real yields ({ry:.2f}%):** Negative. Historically accommodative for equities, gold, and commodities. Risk-on tailwind.")

    if msgs:
        box_html = '<div style="background:#f8f9fa;border-left:4px solid #3498db;padding:16px 20px;border-radius:6px;line-height:2">'
        for msg in msgs:
            box_html += f'<p style="margin:0 0 8px 0">{msg}</p>'
        box_html += '</div>'
        st.markdown(box_html, unsafe_allow_html=True)
    else:
        st.info("Not enough data for interpretation.")
