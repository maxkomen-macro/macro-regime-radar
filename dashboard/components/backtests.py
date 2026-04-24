"""
dashboard/components/backtests.py — Backtests tab.

Displays:
  - Filter by cohort (signal/regime) and horizon (1M/3M/6M/12M)
  - Metrics table: avg_return, median_return, hit_rate, n
  - Grouped bar chart: avg_return by horizon per cohort
  - Hit rate chart: hit_rate by horizon per cohort
  - Phase 12B: Factor Attribution (pyfolio) — rolling beta/Sharpe, drawdowns
    with regime overlay, rolling factor exposures for SPY vs. SPY benchmark
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from components.db_helpers import _query, load_backtest_results, load_market_daily, pivot_backtest
from components.shared_styles import section_header, subsection_header

_REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#8b5cf6",
}

HORIZONS = ["1M", "3M", "6M", "12M"]
HORIZON_ORDER = {h: i for i, h in enumerate(HORIZONS)}


def render_backtests() -> None:
    """Main entry point — call from app.py inside the Backtests tab."""
    section_header("SIGNAL & REGIME BACKTESTS")
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
    display_df.loc[:, "cohort"]  = display_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")

    # Format as percentage
    for col in ["avg_return", "median_return", "hit_rate"]:
        if col in display_df.columns:
            display_df.loc[:, col] = display_df[col].apply(
                lambda v: f"{v:.1%}" if pd.notna(v) else "—"
            )
    if "n" in display_df.columns:
        display_df.loc[:, "n"] = display_df["n"].apply(lambda v: f"{int(v)}" if pd.notna(v) else "—")

    display_df.columns = [c.replace("_", " ").title() for c in display_df.columns]
    st.dataframe(display_df.set_index("Cohort"), width="stretch")

    # Warn when any cohort has a dangerously small sample size (1–4 observations).
    if "n" in pivoted.columns:
        from collections import Counter
        low_n_mask = pivoted["n"].between(1, 4, inclusive="both")
        low_n_rows = pivoted.loc[low_n_mask, "cohort"]
        if not low_n_rows.empty:
            counts = Counter(
                c.replace("SPY_", "").replace("_", " ") for c in low_n_rows
            )
            parts = [
                f"{name} ({n} horizon{'s' if n > 1 else ''})"
                for name, n in sorted(counts.items())
            ]
            st.warning(
                "⚠️ Low sample size (n < 5): **" + ", ".join(parts) + "** — "
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

    # ── Factor Attribution (Phase 12B — pyfolio-reloaded) ─────────────────────
    st.divider()
    _render_factor_attribution()


# ─────────────────────────────────────────────────────────────────────────────
# Chart helpers
# ─────────────────────────────────────────────────────────────────────────────

def _render_avg_return_chart(df: pd.DataFrame) -> None:
    subsection_header("Avg Return by Horizon")
    avg_df = df[df["metric"] == "avg_return"].copy()
    if avg_df.empty:
        st.info("avg_return data not available.")
        return

    avg_df = avg_df.sort_values("horizon", key=lambda s: s.map(HORIZON_ORDER))
    avg_df.loc[:, "cohort_clean"] = avg_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")
    avg_df.loc[:, "value_pct"]    = avg_df["value"] * 100

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
    subsection_header("Hit Rate by Horizon")
    hr_df = df[df["metric"] == "hit_rate"].copy()
    if hr_df.empty:
        st.info("hit_rate data not available.")
        return

    hr_df = hr_df.sort_values("horizon", key=lambda s: s.map(HORIZON_ORDER))
    hr_df.loc[:, "cohort_clean"] = hr_df["cohort"].str.replace("SPY_", "").str.replace("_", " ")
    hr_df.loc[:, "value_pct"]    = hr_df["value"] * 100

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


# ─────────────────────────────────────────────────────────────────────────────
# Factor Attribution (Phase 12B — pyfolio-reloaded)
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def _load_spy_daily_returns() -> pd.Series:
    """SPY daily returns from market_daily."""
    df = load_market_daily(symbols=("SPY",))
    if df.empty:
        return pd.Series(dtype=float)
    df = df.sort_values("date")
    s = pd.Series(df["close"].values, index=pd.to_datetime(df["date"])).sort_index()
    return s.pct_change().dropna()


@st.cache_data(ttl=3600, show_spinner=False)
def _load_regimes_daily(index_values: tuple) -> pd.Series:
    """Monthly regime labels forward-filled onto a daily DatetimeIndex."""
    df = _query("SELECT date, label FROM regimes ORDER BY date")
    if df.empty:
        return pd.Series(dtype=object)
    df["date"] = pd.to_datetime(df["date"])
    s = df.set_index("date")["label"]
    daily_idx = pd.DatetimeIndex(index_values)
    return s.reindex(daily_idx, method="ffill")


@st.cache_data(ttl=3600, show_spinner=False)
def _load_factor_daily_returns() -> pd.DataFrame:
    """
    Factor returns as long-minus-short daily returns using the same proxies
    as `src/analytics/allocation.FACTOR_PROXIES`.
    """
    from src.analytics.allocation import FACTOR_PROXIES, _fetch_prices
    from datetime import datetime

    end = datetime.now().strftime("%Y-%m-%d")
    out = {}
    for name, pair in FACTOR_PROXIES.items():
        long_s  = _fetch_prices(pair["long"],  "2000-01-01", end)
        short_s = _fetch_prices(pair["short"], "2000-01-01", end)
        if long_s.empty or short_s.empty:
            continue
        long_r  = long_s.pct_change()
        short_r = short_s.pct_change()
        aligned = pd.concat([long_r, short_r], axis=1).dropna()
        aligned.columns = ["long", "short"]
        out[name] = aligned["long"] - aligned["short"]
    if not out:
        return pd.DataFrame()
    df = pd.DataFrame(out)
    df.index = pd.to_datetime(df.index)
    return df.dropna(how="all")


def _regime_segments(regimes_daily: pd.Series) -> list[tuple[pd.Timestamp, pd.Timestamp, str]]:
    """Compress a daily forward-filled regime Series into (start, end, label) runs."""
    if regimes_daily.empty:
        return []
    s = regimes_daily.dropna()
    changes = s != s.shift()
    group = changes.cumsum()
    segs = []
    for _, grp in s.groupby(group):
        segs.append((grp.index[0], grp.index[-1], str(grp.iloc[0])))
    return segs


def _add_regime_shading_mpl(ax, regimes_daily: pd.Series) -> None:
    """Shade each regime segment on a matplotlib axes."""
    for start, end, label in _regime_segments(regimes_daily):
        color = _REGIME_COLORS.get(label, "#8b949e")
        ax.axvspan(start, end, color=color, alpha=0.10, linewidth=0)


def _add_regime_shading_plotly(fig: go.Figure, regimes_daily: pd.Series) -> None:
    """Shade regime segments as background rects on a plotly figure."""
    for start, end, label in _regime_segments(regimes_daily):
        color = _REGIME_COLORS.get(label, "#8b949e")
        fig.add_vrect(
            x0=start, x1=end,
            fillcolor=color, opacity=0.10, layer="below", line_width=0,
        )


def _rolling_factor_betas(returns: pd.Series, factors: pd.DataFrame, window: int = 63) -> pd.DataFrame:
    """Rolling OLS of asset returns on factor returns. Returns betas by date × factor."""
    aligned = pd.concat([returns.rename("_y"), factors], axis=1).dropna()
    if len(aligned) < window + 10:
        return pd.DataFrame()

    y = aligned["_y"].values
    X = aligned[factors.columns].values
    n, k = X.shape
    betas = np.full((n, k), np.nan)

    # Rolling OLS — each window solves (X'X)^-1 X'y without an intercept
    # (factors are already long-short excess returns, so intercept ≈ 0).
    for i in range(window, n + 1):
        Xw = X[i - window:i]
        yw = y[i - window:i]
        try:
            b, *_ = np.linalg.lstsq(Xw, yw, rcond=None)
            betas[i - 1] = b
        except Exception:
            continue

    df = pd.DataFrame(betas, index=aligned.index, columns=factors.columns)
    return df.dropna(how="all")


def _render_factor_attribution() -> None:
    section_header("FACTOR ATTRIBUTION — SPY ACROSS REGIMES")
    st.caption(
        "SPY daily returns decomposed with pyfolio + factor regressions. "
        "Background shading shows the active macro regime at each date."
    )

    returns = _load_spy_daily_returns()
    if returns.empty or len(returns) < 252:
        st.info("Insufficient SPY daily history in market_daily for attribution.")
        return

    regimes_daily = _load_regimes_daily(tuple(returns.index.astype("int64").tolist()))
    # Re-index on the Series to align with returns
    regimes_daily.index = returns.index

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        import pyfolio as pf
    except Exception as exc:
        st.error(f"pyfolio import failed: {exc}")
        return

    # ── Row 1: rolling Sharpe + rolling beta (vs. SPY = 1.0 sanity check) ─────
    c1, c2 = st.columns(2)

    with c1:
        subsection_header("Rolling 6-Month Sharpe")
        try:
            fig, ax = plt.subplots(figsize=(6, 3))
            pf.plotting.plot_rolling_sharpe(returns, rolling_window=126, ax=ax)
            _add_regime_shading_mpl(ax, regimes_daily)
            ax.set_title("")
            fig.tight_layout()
            st.pyplot(fig, use_container_width=True)
            plt.close(fig)
        except Exception as exc:
            st.warning(f"Rolling Sharpe unavailable: {exc}")

    with c2:
        subsection_header("Rolling 6-Month Beta (vs. SPY)")
        try:
            fig, ax = plt.subplots(figsize=(6, 3))
            pf.plotting.plot_rolling_beta(
                returns, factor_returns=returns, ax=ax
            )
            _add_regime_shading_mpl(ax, regimes_daily)
            ax.set_title("")
            fig.tight_layout()
            st.pyplot(fig, use_container_width=True)
            plt.close(fig)
        except Exception as exc:
            st.warning(f"Rolling beta unavailable: {exc}")

    # ── Row 2: Top-N drawdown periods with regime shading ────────────────────
    subsection_header("Top 5 Drawdown Periods (Regime-Shaded)")
    try:
        fig, ax = plt.subplots(figsize=(12, 4))
        pf.plotting.plot_drawdown_periods(returns, top=5, ax=ax)
        _add_regime_shading_mpl(ax, regimes_daily)
        ax.set_title("")
        fig.tight_layout()
        st.pyplot(fig, use_container_width=True)
        plt.close(fig)
    except Exception as exc:
        st.warning(f"Drawdown-period chart unavailable: {exc}")

    # Regime legend
    legend_html_parts = []
    for label, color in _REGIME_COLORS.items():
        legend_html_parts.append(
            f"<span style='display:inline-flex;align-items:center;margin-right:16px;"
            f"font-size:11px;color:#8b949e;'>"
            f"<span style='display:inline-block;width:12px;height:12px;background:{color};"
            f"opacity:0.4;margin-right:6px;border-radius:2px;'></span>{label}</span>"
        )
    st.markdown(
        "<div style='margin:4px 0 12px 0;'>" + "".join(legend_html_parts) + "</div>",
        unsafe_allow_html=True,
    )

    # ── Row 3: Rolling factor exposures ──────────────────────────────────────
    subsection_header("Rolling 63-Day Factor Exposures")
    try:
        factors = _load_factor_daily_returns()
    except Exception as exc:
        st.warning(f"Factor returns fetch failed: {exc}")
        factors = pd.DataFrame()

    if factors.empty:
        st.info("Factor return proxies unavailable (yfinance fetch returned empty).")
        return

    betas = _rolling_factor_betas(returns, factors, window=63)
    if betas.empty:
        st.info("Not enough overlapping data to compute rolling factor betas.")
        return

    fig = go.Figure()
    factor_colors = {
        "Value":    "#4a9eff",
        "Momentum": "#2ecc71",
        "Quality":  "#8b5cf6",
        "Size":     "#e67e22",
        "Low Vol":  "#1abc9c",
    }
    for col in betas.columns:
        fig.add_trace(go.Scatter(
            x=betas.index, y=betas[col],
            mode="lines", name=col,
            line=dict(color=factor_colors.get(col, "#e6edf3"), width=1.5),
        ))
    _add_regime_shading_plotly(fig, regimes_daily.loc[betas.index.min():betas.index.max()])
    fig.add_hline(y=0, line_dash="dot", line_color="#555", line_width=1)
    fig.update_layout(
        height=360,
        margin=dict(l=20, r=20, t=20, b=40),
        template="plotly_white",
        legend=dict(orientation="h", y=-0.2, font=dict(size=10)),
        xaxis=dict(title=None),
        yaxis=dict(title="Beta"),
    )
    st.plotly_chart(fig, use_container_width=True)
    st.caption(
        "Long-minus-short factor proxies (IWD-IWF, MTUM-SPY, IWM-SPY, QUAL-SPY, USMV-SPY). "
        "Rolling OLS, 63-day window."
    )
