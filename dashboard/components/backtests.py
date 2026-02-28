"""
dashboard/components/backtests.py — Backtests tab.

Displays:
  - Filter by cohort (signal/regime) and horizon (1M/3M/6M/12M)
  - Metrics table: avg_return, median_return, hit_rate, n
  - Grouped bar chart: avg_return by horizon per cohort
  - Hit rate chart: hit_rate by horizon per cohort
"""

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from components.db_helpers import load_backtest_results, pivot_backtest

HORIZONS = ["1M", "3M", "6M", "12M"]
HORIZON_ORDER = {h: i for i, h in enumerate(HORIZONS)}


def render_backtests() -> None:
    """Main entry point — call from app.py inside the Backtests tab."""
    st.markdown("### 🧪 Signal & Regime Backtests")
    st.caption("Historical SPY forward returns following signal triggers and regime periods.")
    st.divider()

    raw = load_backtest_results()
    if raw.empty:
        st.info(
            "No backtest results found. "
            "Run: `python -m src.analytics.backtest`"
        )
        return

    # ── Filters ───────────────────────────────────────────────────────────────
    cohorts  = sorted(raw["cohort"].unique().tolist())
    horizons = [h for h in HORIZONS if h in raw["horizon"].unique()]

    f_col1, f_col2 = st.columns([2, 1])
    with f_col1:
        sel_cohorts  = st.multiselect(
            "Cohort (signal / regime)", cohorts, default=cohorts,
            help="SPY_signal_* = triggered signal; SPY_regime_* = macro regime"
        )
    with f_col2:
        sel_horizons = st.multiselect(
            "Horizon", horizons, default=horizons
        )

    if not sel_cohorts or not sel_horizons:
        st.warning("Select at least one cohort and one horizon.")
        return

    filtered = raw[
        raw["cohort"].isin(sel_cohorts) & raw["horizon"].isin(sel_horizons)
    ]
    if filtered.empty:
        st.info("No data for the selected filters.")
        return

    # ── Pivot to wide metrics table ───────────────────────────────────────────
    pivoted = pivot_backtest(filtered)

    # Clean up for display
    display_cols = ["cohort", "horizon"]
    for col in ["avg_return", "median_return", "hit_rate", "n"]:
        if col in pivoted.columns:
            display_cols.append(col)

    display_df = pivoted[display_cols].copy()
    display_df["cohort"]  = display_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")

    # Format as percentage
    for col in ["avg_return", "median_return", "hit_rate"]:
        if col in display_df.columns:
            display_df[col] = display_df[col].apply(
                lambda v: f"{v:.1%}" if pd.notna(v) else "—"
            )
    if "n" in display_df.columns:
        display_df["n"] = display_df["n"].apply(lambda v: f"{int(v)}" if pd.notna(v) else "—")

    display_df.columns = [c.replace("_", " ").title() for c in display_df.columns]
    st.dataframe(display_df.set_index("Cohort"), use_container_width=True)

    # Warn when any cohort has a dangerously small sample size (1–4 observations).
    if "n" in pivoted.columns:
        low_n_mask = pivoted["n"].between(1, 4, inclusive="both")
        low_n_cohorts = pivoted.loc[low_n_mask, "cohort"].tolist()
        if low_n_cohorts:
            names = ", ".join(
                c.replace("SPY_", "").replace("_", " ") for c in low_n_cohorts
            )
            st.warning(
                f"⚠️ Low sample size (n < 5): **{names}** — "
                "statistics may not be reliable with so few observations."
            )

    st.divider()

    # ── Charts ────────────────────────────────────────────────────────────────
    c_chart1, c_chart2 = st.columns(2)

    with c_chart1:
        _render_avg_return_chart(filtered)

    with c_chart2:
        _render_hit_rate_chart(filtered)

    st.caption("Based on SPY historical daily returns. Signals from `signals` table, regimes from `regimes` table.")


# ─────────────────────────────────────────────────────────────────────────────
# Chart helpers
# ─────────────────────────────────────────────────────────────────────────────

def _render_avg_return_chart(df: pd.DataFrame) -> None:
    st.markdown("**Avg Return by Horizon**")
    avg_df = df[df["metric"] == "avg_return"].copy()
    if avg_df.empty:
        st.info("avg_return data not available.")
        return

    avg_df = avg_df.sort_values("horizon", key=lambda s: s.map(HORIZON_ORDER))
    avg_df["cohort_clean"] = avg_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")
    avg_df["value_pct"]    = avg_df["value"] * 100

    fig = px.bar(
        avg_df,
        x="horizon",
        y="value_pct",
        color="cohort_clean",
        barmode="group",
        labels={"horizon": "Horizon", "value_pct": "Avg Return (%)", "cohort_clean": "Cohort"},
        category_orders={"horizon": HORIZONS},
    )
    fig.add_hline(y=0, line_dash="solid", line_color="#333", line_width=1)
    fig.update_layout(
        height=320,
        margin=dict(l=20, r=20, t=20, b=40),
        template="plotly_white",
        legend=dict(orientation="h", y=-0.3, font=dict(size=10)),
    )
    st.plotly_chart(fig, use_container_width=True)


def _render_hit_rate_chart(df: pd.DataFrame) -> None:
    st.markdown("**Hit Rate by Horizon**")
    hr_df = df[df["metric"] == "hit_rate"].copy()
    if hr_df.empty:
        st.info("hit_rate data not available.")
        return

    hr_df = hr_df.sort_values("horizon", key=lambda s: s.map(HORIZON_ORDER))
    hr_df["cohort_clean"] = hr_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")
    hr_df["value_pct"]    = hr_df["value"] * 100

    fig = px.bar(
        hr_df,
        x="horizon",
        y="value_pct",
        color="cohort_clean",
        barmode="group",
        labels={"horizon": "Horizon", "value_pct": "Hit Rate (%)", "cohort_clean": "Cohort"},
        category_orders={"horizon": HORIZONS},
    )
    fig.add_hline(y=50, line_dash="dash", line_color="#888", line_width=1,
                  annotation_text="50% (breakeven)", annotation_position="top left",
                  annotation_font_size=10)
    fig.update_layout(
        height=320,
        margin=dict(l=20, r=20, t=20, b=40),
        template="plotly_white",
        legend=dict(orientation="h", y=-0.3, font=dict(size=10)),
        yaxis=dict(range=[0, 105]),
    )
    st.plotly_chart(fig, use_container_width=True)
