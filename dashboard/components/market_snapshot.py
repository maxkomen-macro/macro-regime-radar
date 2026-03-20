"""
dashboard/components/market_snapshot.py — Market Snapshot tab.

Displays:
  - Rates bar: DGS2, DGS10, 2s10s spread from raw_series
  - Risk-Off/Risk-On composite gauge
  - 7 grouped ticker sections (US Equities, Sectors heatmap, Rates, Credit,
    Commodities, International, FX & Volatility) with per-ticker cards
  - Top Surprises (shared helper)
  - TradingView widgets by group
"""

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

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

WATCHLIST_SYMBOLS = [
    "SPY", "QQQ", "IWM", "VTV",
    "XLF", "XLE", "XLI", "XLK",
    "TLT", "IEF", "SHY",
    "HYG", "LQD", "EMB",
    "GLD", "SLV", "USO", "UNG", "CPER",
    "EFA", "EEM",
    "UUP", "VIXY",
]

SYMBOL_LABELS = {
    "SPY":  "S&P 500 ETF",     "QQQ":  "Nasdaq 100",
    "IWM":  "Russell 2000",    "VTV":  "Value ETF",
    "XLF":  "Financials",      "XLE":  "Energy",
    "XLI":  "Industrials",     "XLK":  "Technology",
    "TLT":  "20Y Treasury",    "IEF":  "7-10Y Treasury",
    "SHY":  "1-3Y Treasury",
    "HYG":  "High Yield",      "LQD":  "Invest. Grade",
    "EMB":  "EM Bonds",
    "GLD":  "Gold",            "SLV":  "Silver",
    "USO":  "Crude Oil",       "UNG":  "Nat Gas",
    "CPER": "Copper",
    "EFA":  "Developed Mkts",  "EEM":  "Emerging Mkts",
    "UUP":  "US Dollar",       "VIXY": "VIX Futures",
}

WATCHLIST_GROUPS = {
    "US Equities": {
        "symbols": ["SPY", "QQQ", "IWM", "VTV"],
        "color": "#378ADD",
    },
    "Sectors": {
        "symbols": ["XLF", "XLE", "XLI", "XLK"],
        "color": "#639922",
        "heatmap": True,
    },
    "Rates": {
        "symbols": ["TLT", "IEF", "SHY"],
        "color": "#d29922",
    },
    "Credit": {
        "symbols": ["HYG", "LQD", "EMB"],
        "color": "#f08785",
    },
    "Commodities": {
        "symbols": ["GLD", "SLV", "USO", "UNG", "CPER"],
        "color": "#EF9F27",
    },
    "International": {
        "symbols": ["EFA", "EEM"],
        "color": "#7F77DD",
    },
    "FX & Volatility": {
        "symbols": ["UUP", "VIXY"],
        "color": "#888780",
    },
}

_INTRADAY_SYMBOLS = ("SPY", "QQQ", "IWM", "TLT", "GLD", "UUP", "VIXY")


# ─────────────────────────────────────────────────────────────────────────────
# Risk-Off / Risk-On composite
# ─────────────────────────────────────────────────────────────────────────────

def _compute_risk_score(prices: dict, daily_df: pd.DataFrame) -> float | None:
    """
    Compute a Risk-Off/Risk-On composite score from -100 to +100.

    Components (equal weight, each normalized to -1 to +1):
      1. SPY 1-week return    — positive = risk-on
      2. VIXY                 — inverted, high VIXY = risk-off
      3. HYG 1-week return   — positive = risk-on (credit appetite)
      4. GLD 1-week return   — inverted, high gold = risk-off
      5. UUP 1-week return   — inverted, strong dollar = risk-off

    Each component is z-scored vs. its own 52-week history, clamped
    to [-3, +3], then scaled to [-1, +1]. The composite is the mean
    of all available components × 100, rounded to 1 decimal.

    Returns None if fewer than 3 components are available.
    """
    import numpy as np

    COMPONENTS = [
        ("SPY",  1.0),   # risk-on signal
        ("VIXY", -1.0),  # inverted — high vol = risk-off
        ("HYG",  1.0),   # credit appetite = risk-on
        ("GLD",  -1.0),  # inverted — safe haven = risk-off
        ("UUP",  -1.0),  # inverted — strong dollar = risk-off
    ]

    scores = []
    for sym, direction in COMPONENTS:
        sym_data = daily_df[daily_df["symbol"] == sym].sort_values("date")
        if len(sym_data) < 20:
            continue

        closes = sym_data["close"].values.astype(float)
        # 1-week return (5 trading days)
        if len(closes) < 6:
            continue
        ret = (closes[-1] - closes[-6]) / closes[-6]
        # Z-score vs 52-week rolling weekly returns
        weekly_rets = (closes[5:] - closes[:-5]) / closes[:-5]
        if len(weekly_rets) < 10:
            continue
        mean = weekly_rets.mean()
        std  = weekly_rets.std()
        if std == 0:
            continue
        z = (ret - mean) / std
        z = float(np.clip(z, -3, 3))
        normalized = z / 3.0  # scale to [-1, +1]
        scores.append(normalized * direction)

    if len(scores) < 3:
        return None

    composite = float(np.mean(scores)) * 100
    return round(composite, 1)


def _render_risk_gauge(score: float | None) -> None:
    """
    Render the Risk-Off/Risk-On composite gauge using st.markdown.
    Score range: -100 (max risk-off) to +100 (max risk-on).
    """
    if score is None:
        return

    if score >= 30:
        label    = "Risk-On"
        color    = "#3fb950"
        sublabel = "Markets pricing growth and risk appetite"
    elif score <= -30:
        label    = "Risk-Off"
        color    = "#f08785"
        sublabel = "Markets pricing caution and defensive positioning"
    else:
        label    = "Neutral"
        color    = "#d29922"
        sublabel = "Mixed signals — no clear directional bias"

    pct = (score + 100) / 2  # map -100..+100 → 0..100 for bar width

    st.markdown(
        f"""
        <div style="
            background:var(--color-background-secondary);
            border-radius:10px;
            border:0.5px solid var(--color-border-tertiary);
            padding:16px 20px;
            margin-bottom:20px;
        ">
          <div style="display:flex;justify-content:space-between;
                      align-items:flex-start;margin-bottom:10px">
            <div>
              <div style="font-size:10px;font-weight:500;
                          letter-spacing:0.08em;text-transform:uppercase;
                          color:var(--color-text-tertiary);margin-bottom:4px">
                Risk sentiment composite
              </div>
              <div style="font-size:22px;font-weight:500;color:{color}">
                {label}
              </div>
              <div style="font-size:11px;color:var(--color-text-tertiary);
                          margin-top:2px">{sublabel}</div>
            </div>
            <div style="font-size:28px;font-weight:500;
                        color:{color};letter-spacing:-0.02em">
              {score:+.1f}
            </div>
          </div>
          <div style="position:relative;height:6px;
                      background:var(--color-border-tertiary);
                      border-radius:3px;overflow:hidden">
            <div style="
                position:absolute;left:0;top:0;
                width:{pct:.1f}%;height:100%;
                background:{color};border-radius:3px;
            "></div>
          </div>
          <div style="display:flex;justify-content:space-between;
                      margin-top:4px">
            <span style="font-size:9px;color:var(--color-text-tertiary)">
              Risk-off  –100
            </span>
            <span style="font-size:9px;color:var(--color-text-tertiary)">
              0
            </span>
            <span style="font-size:9px;color:var(--color-text-tertiary)">
              +100  Risk-on
            </span>
          </div>
          <div style="font-size:10px;color:var(--color-text-tertiary);
                      margin-top:8px;padding-top:8px;
                      border-top:0.5px solid var(--color-border-tertiary)">
            Components: SPY momentum · HYG credit appetite ·
            VIXY volatility (inv) · GLD safe-haven (inv) ·
            UUP dollar strength (inv) · 52W z-score normalized
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sector heatmap
# ─────────────────────────────────────────────────────────────────────────────

def _render_sector_heatmap(prices: dict) -> None:
    """
    Render the Sectors group as a color-intensity heatmap rather than
    standard cards. Color intensity scales with 1D return magnitude.
    """
    SECTORS = [
        ("XLF", "Financials"),
        ("XLE", "Energy"),
        ("XLI", "Industrials"),
        ("XLK", "Technology"),
    ]

    def _hm_bg(ret: float) -> str:
        """Return rgba background color for heatmap cell by return magnitude."""
        if ret > 0.02:   return "rgba(63,185,80,0.28)"
        if ret > 0.01:   return "rgba(63,185,80,0.19)"
        if ret > 0:      return "rgba(63,185,80,0.09)"
        if ret < -0.02:  return "rgba(240,135,133,0.28)"
        if ret < -0.01:  return "rgba(240,135,133,0.19)"
        return "rgba(240,135,133,0.09)"

    cells_html = ""
    for sym, name in SECTORS:
        p = prices.get(sym)
        if p is None:
            continue
        ret   = p.get("chg_1d_pct", 0) or 0
        price = p.get("close", 0) or 0
        bg    = _hm_bg(ret)
        color = "#3fb950" if ret >= 0 else "#f08785"
        sign  = "+" if ret >= 0 else ""
        cells_html += f"""
        <div class="cell" style="background-color:{bg} !important;">
          <div>
            <div style="font-size:12px;font-weight:500;color:#e6edf3">{sym}</div>
            <div style="font-size:10px;color:#8b949e;margin-top:1px">{name}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:500;color:{color}">{sign}{ret:.2%}</div>
            <div style="font-size:10px;color:#8b949e">{price:.2f}</div>
          </div>
        </div>"""

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
.grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }}
.cell {{ border:0.5px solid #30363d; border-radius:8px; padding:10px 12px;
         display:flex; justify-content:space-between; align-items:center; }}
</style></head>
<body><div class="grid">{cells_html}</div></body></html>""",
        height=70,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Per-ticker card
# ─────────────────────────────────────────────────────────────────────────────

def _render_ticker_card(sym: str, p: dict, group_color: str, sparkline_bars=None) -> None:
    """
    Render a single ticker as a styled card with:
      - Color accent bar at top matching group color
      - Ticker + full name
      - Price (large)
      - 1D change pill (green/red)
      - 1W and 1M returns
      - Z-score badge (color-coded: hot/cold/neutral)
    """
    if p is None:
        return

    close   = p.get("close")      or 0
    chg_1d  = p.get("chg_1d_pct") or 0
    chg_1w  = p.get("chg_1w_pct") or 0
    chg_1m  = p.get("chg_1m_pct") or 0
    zscore  = p.get("weekly_z")   or 0
    name    = SYMBOL_LABELS.get(sym, sym)

    pill_cls   = "pill-up" if chg_1d >= 0 else "pill-down"
    sign_1d    = "+" if chg_1d >= 0 else ""
    sign_1w    = "+" if chg_1w >= 0 else ""
    sign_1m    = "+" if chg_1m >= 0 else ""
    w1_color   = "#3fb950" if chg_1w >= 0 else "#f08785"
    m1_color   = "#3fb950" if chg_1m >= 0 else "#f08785"

    # Z-score badge
    if zscore > 1.5:
        z_cls = "zscore-hot"
    elif zscore < -1.5:
        z_cls = "zscore-cold"
    else:
        z_cls = "zscore-neutral"
    z_text = f"{zscore:+.2f}σ" if zscore else "—"

    # Build sparkline HTML (only if bars provided)
    sparkline_html = ""
    if sparkline_bars is not None:
        spark_color = '#3fb950' if chg_1d >= 0 else '#f08785'
        bars_html = ''.join([
            f'<div style="width:4px;height:{h}px;background:{spark_color};'
            f'opacity:0.7;border-radius:1px;flex-shrink:0"></div>'
            for h in sparkline_bars
        ])
        sparkline_html = (
            '<div style="display:flex;align-items:flex-end;gap:2px;'
            'height:28px;margin-bottom:8px">'
            f'{bars_html}'
            '</div>'
        )

    card_height = 175

    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ background:#0e1117; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
.card {{
  background:#1a1d23; border-radius:10px;
  border:0.5px solid #30363d; border-top:3px solid {group_color};
  padding:14px;
}}
.pill-up   {{ background-color:#3fb950; color:#173404; font-size:10px; font-weight:500; padding:3px 7px; border-radius:4px; display:inline-block; }}
.pill-down {{ background-color:#f08785; color:#4A1B0C; font-size:10px; font-weight:500; padding:3px 7px; border-radius:4px; display:inline-block; }}
.zscore-hot     {{ background-color:#f08785; color:#4A1B0C; font-size:9px; font-weight:500; padding:2px 5px; border-radius:3px; display:inline-block; }}
.zscore-cold    {{ background-color:#378ADD; color:#042C53; font-size:9px; font-weight:500; padding:2px 5px; border-radius:3px; display:inline-block; }}
.zscore-neutral {{ color:#888780;           font-size:9px; font-weight:500; padding:2px 5px; border-radius:3px; display:inline-block; }}
</style></head>
<body><div class="card">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div>
      <div style="font-size:13px;font-weight:500;color:#e6edf3;line-height:1">{sym}</div>
      <div style="font-size:10px;color:#8b949e;margin-top:3px">{name}</div>
    </div>
    <span class="{pill_cls}">{sign_1d}{chg_1d:.2%}</span>
  </div>
  <div style="font-size:20px;font-weight:500;color:#e6edf3;letter-spacing:-0.02em;line-height:1;margin-bottom:8px">{close:.2f}</div>
  {sparkline_html}
  <div style="display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:10px;color:#8b949e">1W <span style="color:{w1_color};font-weight:500">{sign_1w}{chg_1w:.2%}</span></span>
    <span style="font-size:10px;color:#8b949e">1M <span style="color:{m1_color};font-weight:500">{sign_1m}{chg_1m:.2%}</span></span>
    <span class="{z_cls}">{z_text}</span>
  </div>
</div></body></html>""",
        height=card_height,
        scrolling=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────


def render_market_snapshot(wide_df: pd.DataFrame) -> None:
    """
    Redesigned Markets tab — rates bar, Risk-Off/Risk-On gauge,
    grouped cards with sector heatmap and per-ticker cards.
    """
    section_header("MARKET SNAPSHOT")
    st.divider()

    # ── Rates bar (FRED data — preserved) ────────────────────────────────────
    _render_rates_bar(wide_df)
    st.divider()

    market_ok = has_market_data()
    dm        = load_derived_metrics()

    if not market_ok:
        st.warning(
            "Market data not yet loaded. "
            "Run: `python src/market_data/fetch_market.py --mode backfill`"
        )
        st.markdown("**TradingView live charts (data from TradingView)**")
        render_tv_groups()
        return

    # ── Load data ─────────────────────────────────────────────────────────────
    daily_df    = load_market_daily(tuple(WATCHLIST_SYMBOLS))
    intraday_df = load_market_intraday(_INTRADAY_SYMBOLS)

    # ── Build prices dict ─────────────────────────────────────────────────────
    # Intraday latest close by symbol (for price override during market hours)
    intraday_prices: dict = {}
    if not intraday_df.empty:
        intraday_prices = (
            intraday_df.sort_values("ts")
            .groupby("symbol")
            .last()["close"]
            .to_dict()
        )

    prices: dict = {}
    for sym in WATCHLIST_SYMBOLS:
        sym_data = daily_df[daily_df["symbol"] == sym].sort_values("date")
        if sym_data.empty:
            prices[sym] = None
            continue

        last  = sym_data.iloc[-1]
        close = intraday_prices.get(sym, last["close"])

        # ret_1d/ret_1w/ret_1m from load_market_daily are percentage points (×100)
        # Divide by 100 to get fractions for :.2% formatting in card renderers
        ret_1d = last.get("ret_1d")
        ret_1w = last.get("ret_1w")
        ret_1m = last.get("ret_1m")

        prices[sym] = {
            "close":      float(close) if close is not None else 0.0,
            "chg_1d_pct": float(ret_1d) / 100.0 if ret_1d is not None else 0.0,
            "chg_1w_pct": float(ret_1w) / 100.0 if ret_1w is not None else 0.0,
            "chg_1m_pct": float(ret_1m) / 100.0 if ret_1m is not None else 0.0,
            "weekly_z":   get_derived_latest(dm, f"{sym}_weekly_ret_z"),
        }

    # ── Risk-Off/Risk-On gauge ────────────────────────────────────────────────
    score = _compute_risk_score(prices, daily_df)
    _render_risk_gauge(score)

    # ── Grouped ticker sections ───────────────────────────────────────────────
    for group_name, group_cfg in WATCHLIST_GROUPS.items():
        group_color   = group_cfg["color"]
        group_symbols = group_cfg["symbols"]
        is_heatmap    = group_cfg.get("heatmap", False)

        # Section header — left accent bar + group name
        st.markdown(
            f"""
            <div style="display:flex;align-items:center;gap:10px;
                        margin:20px 0 12px">
              <div style="width:3px;height:16px;background:{group_color};
                          border-radius:2px;flex-shrink:0"></div>
              <span style="font-size:10px;font-weight:500;
                           letter-spacing:0.1em;text-transform:uppercase;
                           color:var(--color-text-secondary)">
                {group_name}
              </span>
            </div>
            """,
            unsafe_allow_html=True,
        )

        if is_heatmap:
            _render_sector_heatmap(prices)
        else:
            n_cols = 5 if group_name == "Commodities" else min(len(group_symbols), 4)
            cols   = st.columns(n_cols)
            for i, sym in enumerate(group_symbols):
                with cols[i % n_cols]:
                    spark = None
                    sym_data = daily_df[daily_df["symbol"] == sym].sort_values("date")
                    recent = sym_data["close"].tail(7).tolist()
                    if len(recent) >= 7:
                        mn, mx = min(recent), max(recent)
                        rng = mx - mn if mx != mn else 1
                        spark = [int(4 + ((v - mn) / rng) * 20) for v in recent]
                    _render_ticker_card(sym, prices.get(sym), group_color, sparkline_bars=spark)

    # ── Top Surprises ──────────────────────────────────────────────────────────
    st.divider()
    render_surprises(dm, top_n=10, title="Top Surprises This Week (Macro + Markets)")
    st.divider()

    # ── TradingView widgets ────────────────────────────────────────────────────
    section_header("QUICK CHARTS (TRADINGVIEW)")
    render_tv_groups()

    # ── Footer ────────────────────────────────────────────────────────────────
    st.markdown(
        """
        <div style="
            font-size:10px;color:var(--color-text-tertiary);
            margin-top:16px;padding-top:12px;
            border-top:0.5px solid var(--color-border-tertiary);
            display:flex;align-items:center;gap:6px;
        ">
          <div style="width:5px;height:5px;border-radius:50%;
                      background:#3fb950;flex-shrink:0"></div>
          Intraday prices via yfinance · Updated every 5 min during
          market hours (9:30–4:00 ET) · FRED macro data daily at 6 AM ET
        </div>
        """,
        unsafe_allow_html=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Rates bar helper (preserved verbatim)
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

    gs2   = wide_df["DGS2"]  if "DGS2"  in wide_df.columns else pd.Series(dtype=float)
    gs10  = wide_df["DGS10"] if "DGS10" in wide_df.columns else pd.Series(dtype=float)

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
