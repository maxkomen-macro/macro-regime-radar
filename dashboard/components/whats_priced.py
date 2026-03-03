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
    ff     = get_derived_latest(dm, "FEDFUNDS_latest")
    sofr   = get_derived_latest(dm, "SOFR_latest")
    t5be   = get_derived_latest(dm, "T5YIE_latest")
    t10be  = get_derived_latest(dm, "T10YIE_latest")
    r5     = get_derived_latest(dm, "DFII5_latest")
    r10    = get_derived_latest(dm, "DFII10_latest")
    ff_chg = get_derived_latest(dm, "FEDFUNDS_mom_chg")
    be_chg = get_derived_latest(dm, "T10YIE_mom_chg")

    bullets = []

    # Policy rate
    rate = ff if ff is not None else sofr
    if rate is not None:
        rlabel = "Fed Funds" if ff is not None else "SOFR"
        chg_str = f" (MoM: {ff_chg:+.2f}%)" if ff_chg is not None else ""
        if rate >= 5.0:
            body = f"Restrictive territory — multi-decade highs. High opportunity-cost hurdle for risk assets.{chg_str}"
        elif rate >= 3.0:
            body = f"Moderately restrictive. An easing cycle would be a near-term tailwind for duration and risk.{chg_str}"
        else:
            body = f"Accommodative. Low-rate environment supports equity multiples and credit spreads.{chg_str}"
        bullets.append(f"<b>Policy rate ({rlabel} {rate:.2f}%):</b> {body}")

    # Breakevens
    be = t10be if t10be is not None else t5be
    if be is not None:
        blabel = "10Y BE" if t10be is not None else "5Y BE"
        chg_str = f" (MoM: {be_chg:+.2f}%)" if be_chg is not None else ""
        if be > 2.8:
            body = f"Well above 2% target — markets pricing persistent inflation. TIPS and real assets favored over nominals.{chg_str}"
        elif be > 2.2:
            body = f"Modestly above target. Inflation risk premium exists; monitor CPI prints for confirmation.{chg_str}"
        elif be > 1.5:
            body = f"Near target — inflation expectations anchored. Nominal bonds competitive vs. TIPS.{chg_str}"
        else:
            body = f"Below 2% — markets pricing disinflation or deflation risk. Duration attractive; TIPS underperform.{chg_str}"
        bullets.append(f"<b>Breakevens ({blabel} {be:.2f}%):</b> {body}")

    # Real yields
    ry = r10 if r10 is not None else r5
    if ry is not None:
        rylabel = "10Y Real" if r10 is not None else "5Y Real"
        if ry > 2.0:
            body = "Highly restrictive. Strong headwind for growth stocks, gold, and long-duration. Dollar supportive."
        elif ry > 1.0:
            body = "Restrictive. Growth vs. value spread likely to compress; gold faces headwinds from positive carry alternatives."
        elif ry > 0:
            body = "Mildly positive. Balanced environment — real yields are not a dominant directional driver."
        else:
            body = "Negative real rates. Historically accommodative for equities, gold, and commodities — risk-on tailwind."
        bullets.append(f"<b>Real yields ({rylabel} {ry:.2f}%):</b> {body}")

    # 5Y/10Y breakeven term structure (bonus bullet if both available)
    if t5be is not None and t10be is not None:
        spread = t10be - t5be
        if spread > 0.1:
            body = f"10Y breakeven ({t10be:.2f}%) > 5Y ({t5be:.2f}%) by {spread:.2f}% — market expects inflation to persist long-term."
        elif spread < -0.1:
            body = f"5Y breakeven ({t5be:.2f}%) > 10Y ({t10be:.2f}%) by {abs(spread):.2f}% — near-term inflation concern, longer-term anchored."
        else:
            body = f"5Y/10Y breakevens in line ({t5be:.2f}% / {t10be:.2f}%) — no meaningful term inflation risk premium."
        bullets.append(f"<b>BE term structure:</b> {body}")

    if bullets:
        rows = "".join(f'<p style="margin:0 0 10px 0;color:#222">{b}</p>' for b in bullets)
        st.markdown(
            f'<div style="background:#f8f9fa;border-left:4px solid #3498db;'
            f'padding:16px 20px;border-radius:6px;line-height:1.8;color:#222">'
            f'{rows}</div>',
            unsafe_allow_html=True,
        )
    else:
        st.info("Not enough data for interpretation.")
