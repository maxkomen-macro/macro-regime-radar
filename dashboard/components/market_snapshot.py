"""
dashboard/components/market_snapshot.py — Market Snapshot tab.

Displays:
  - Rates bar: DGS2, DGS10, 2s10s spread from raw_series
  - Watchlist: current price, 1D/1W/1M returns, weekly z-score
  - Top Surprises (shared helper)
  - TradingView widgets by group
"""

import pandas as pd
import streamlit as st

from components.db_helpers import (
    get_current_prices,
    get_derived_latest,
    has_market_data,
    load_derived_metrics,
    load_market_daily,
    load_market_intraday,
    render_surprises,
)
from components.tradingview import render_tv_groups
from components.shared_styles import section_header, subsection_header

WATCHLIST_SYMBOLS = ["SPY", "QQQ", "IWM", "TLT", "HYG", "LQD", "UUP", "GLD", "USO"]
SYMBOL_LABELS = {
    "SPY": "S&P 500 ETF",
    "QQQ": "Nasdaq 100",
    "IWM": "Russell 2000",
    "TLT": "20Y Treasury",
    "HYG": "HY Credit",
    "LQD": "IG Credit",
    "UUP": "USD Basket",
    "GLD": "Gold",
    "USO": "Oil",
}


def render_market_snapshot(wide_df: pd.DataFrame) -> None:
    """Main entry point — call from app.py inside the Market Snapshot tab."""
    section_header("MARKET SNAPSHOT")
    st.divider()

    market_ok = has_market_data()
    dm        = load_derived_metrics()

    # ── Rates bar ─────────────────────────────────────────────────────────────
    _render_rates_bar(wide_df)
    st.divider()

    if not market_ok:
        st.warning(
            "Market data not yet loaded. "
            "Run: `python src/market_data/fetch_market.py --mode backfill`"
        )
        st.markdown("**TradingView live charts (data from TradingView)**")
        render_tv_groups()
        return

    # ── Watchlist table ───────────────────────────────────────────────────────
    daily_df    = load_market_daily(tuple(WATCHLIST_SYMBOLS))
    intraday_df = load_market_intraday(tuple(["SPY", "QQQ"]))
    _render_watchlist(daily_df, intraday_df, dm)
    st.divider()

    # ── Top Surprises ──────────────────────────────────────────────────────────
    render_surprises(dm, top_n=10, title="Top Surprises This Week (Macro + Markets)")
    st.divider()

    # ── TradingView widgets ────────────────────────────────────────────────────
    section_header("QUICK CHARTS (TRADINGVIEW)")
    render_tv_groups()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _render_rates_bar(wide_df: pd.DataFrame) -> None:
    section_header("RATES")
    if wide_df.empty:
        st.info("Macro rates data unavailable.")
        return

    cols = st.columns(3)
    def _latest(series):
        s = series.dropna()
        return float(s.iloc[-1]) if not s.empty else None

    def _prev(series, n=1):
        s = series.dropna()
        return float(s.iloc[-1 - n]) if len(s) > n else None

    gs2   = wide_df["DGS2"]   if "DGS2"  in wide_df.columns else pd.Series(dtype=float)
    gs10  = wide_df["DGS10"]  if "DGS10" in wide_df.columns else pd.Series(dtype=float)

    v2   = _latest(gs2)
    v10  = _latest(gs10)
    sp   = (v10 - v2) if (v2 is not None and v10 is not None) else None
    d2   = (v2  - _prev(gs2))  if (v2  is not None and _prev(gs2)  is not None) else None
    d10  = (v10 - _prev(gs10)) if (v10 is not None and _prev(gs10) is not None) else None
    dsp  = (sp  - ((_prev(gs10) or 0) - (_prev(gs2) or 0))) if sp is not None else None

    with cols[0]:
        st.metric("2Y Treasury", f"{v2:.2f}%" if v2 else "N/A",
                  delta=f"{d2:+.2f}pp" if d2 is not None else None)
    with cols[1]:
        st.metric("10Y Treasury", f"{v10:.2f}%" if v10 else "N/A",
                  delta=f"{d10:+.2f}pp" if d10 is not None else None)
    with cols[2]:
        inv = " 🔴 Inverted" if sp is not None and sp < 0 else ""
        st.metric(f"2s10s Spread{inv}", f"{sp:.2f}%" if sp is not None else "N/A",
                  delta=f"{dsp:+.2f}pp" if dsp is not None else None)


def _render_watchlist(
    daily_df: pd.DataFrame,
    intraday_df: pd.DataFrame,
    dm: pd.DataFrame,
) -> None:
    section_header("WATCHLIST")
    if daily_df.empty:
        st.info("No market data available.")
        return

    # Current prices
    prices = get_current_prices(intraday_df, daily_df)

    # Build watchlist rows
    rows = []
    latest_daily = (
        daily_df.sort_values("date")
        .groupby("symbol")
        .last()
        .reset_index()
    )

    for sym in WATCHLIST_SYMBOLS:
        sym_data = daily_df[daily_df["symbol"] == sym].sort_values("date")
        if sym_data.empty:
            rows.append({
                "Symbol": sym,
                "Name":   SYMBOL_LABELS.get(sym, sym),
                "Price":  "N/A",
                "1D %":   None,
                "1W %":   None,
                "1M %":   None,
                "W Z-score": None,
            })
            continue

        last_row = sym_data.iloc[-1]
        price    = prices.get(sym, last_row["close"])
        ret_1d   = last_row.get("ret_1d")
        ret_1w   = last_row.get("ret_1w")
        ret_1m   = last_row.get("ret_1m")

        z_col = f"{sym}_weekly_ret_z"
        z_val = get_derived_latest(dm, z_col) if not dm.empty else None

        rows.append({
            "Symbol":    sym,
            "Name":      SYMBOL_LABELS.get(sym, sym),
            "Price":     f"{price:.2f}" if price else "N/A",
            "1D %":      ret_1d,
            "1W %":      ret_1w,
            "1M %":      ret_1m,
            "W Z-score": z_val,
        })

    df_display = pd.DataFrame(rows)

    # Format and style
    def _fmt_pct(v):
        if v is None or pd.isna(v):
            return "—"
        return f"{v:+.2f}%"

    def _fmt_z(v):
        if v is None or pd.isna(v):
            return "—"
        return f"{v:+.2f}σ"

    df_display["1D %"]      = df_display["1D %"].map(_fmt_pct)
    df_display["1W %"]      = df_display["1W %"].map(_fmt_pct)
    df_display["1M %"]      = df_display["1M %"].map(_fmt_pct)
    df_display["W Z-score"] = df_display["W Z-score"].map(_fmt_z)

    # Color-code return columns: green positive, red negative, grey neutral/missing
    def _color_return(val):
        try:
            num = float(str(val).replace("%", "").replace("+", "").replace("σ", "").strip())
            if num > 0:
                return "color: #2ecc71"
            elif num < 0:
                return "color: #e74c3c"
        except (ValueError, AttributeError):
            pass
        return "color: #888888"

    styled = (
        df_display.set_index("Symbol")
        .style
        .map(_color_return, subset=["1D %", "1W %", "1M %", "W Z-score"])
    )

    st.dataframe(
        styled,
        use_container_width=True,
        column_config={
            "Name":      st.column_config.TextColumn("Name"),
            "Price":     st.column_config.TextColumn("Price"),
            "1D %":      st.column_config.TextColumn("1D %"),
            "1W %":      st.column_config.TextColumn("1W %"),
            "1M %":      st.column_config.TextColumn("1M %"),
            "W Z-score": st.column_config.TextColumn("Weekly Z"),
        },
    )
    st.caption("1D/1W/1M returns from market_daily closing prices. Weekly Z-score from derived_metrics.")
