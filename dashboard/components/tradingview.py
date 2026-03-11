"""
dashboard/components/tradingview.py — TradingView widget embed helpers.

All embeds use st.components.v1.html() and are wrapped in try/except
so a failure never crashes the parent tab.

Usage:
    from components.tradingview import tv_symbol_overview, tv_ticker_tape
"""

import json

import streamlit as st

try:
    import streamlit.components.v1 as components
    _HAS_COMPONENTS = True
except Exception:
    _HAS_COMPONENTS = False


def _safe_html(html: str, height: int = 300) -> None:
    """Embed raw HTML in Streamlit; shows caption on failure."""
    if not _HAS_COMPONENTS:
        st.caption("TradingView widgets require streamlit.components.v1 (not available).")
        return
    try:
        components.html(html, height=height, scrolling=False)
    except Exception as exc:
        st.caption(f"Chart embed unavailable: {exc}")


def tv_symbol_overview(
    symbols: list[tuple[str, str]],  # list of (tv_symbol, display_name) e.g. ("AMEX:SPY","SPY")
    theme: str = "light",
    height: int = 220,
) -> None:
    """
    Embed TradingView Symbol Overview widget for multiple symbols.

    Args:
        symbols: list of (tradingview_symbol, display_name) tuples
        theme:   "light" or "dark"
        height:  iframe height in pixels
    """
    sym_list = [[d, f"{s}|1D"] for s, d in symbols]
    config = {
        "symbols":    sym_list,
        "chartOnly":  False,
        "width":      "100%",
        "height":     height,
        "locale":     "en",
        "colorTheme": theme,
        "autosize":   True,
        "showVolume": False,
        "showMA":     False,
        "hideDateRanges": False,
        "hideMarketStatus": False,
        "hideSymbolLogo":   False,
        "scalePosition":    "right",
        "scaleMode":        "Normal",
        "fontFamily":       "-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif",
        "fontSize":         "10",
        "noTimeScale":      False,
        "valuesTracking":   "1",
        "changeMode":       "price-and-percent",
        "chartType":        "area",
        "maLineColor":      "#2962FF",
        "maLineWidth":      1,
        "maLength":         9,
        "headerFontSize":   "medium",
        "lineWidth":        2,
        "lineType":         0,
        "dateRanges":       ["1d|1", "1w|15", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
    }
    config_json = json.dumps(config)
    html = f"""
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js" async>
  {config_json}
  </script>
</div>"""
    _safe_html(html, height=height + 20)


def tv_mini_chart(
    symbol: str,
    theme: str = "light",
    height: int = 220,
) -> None:
    """
    Embed TradingView Mini Chart for a single symbol.

    Args:
        symbol: TradingView symbol e.g. "AMEX:SPY"
        theme:  "light" or "dark"
        height: iframe height in pixels
    """
    config = {
        "symbol":     symbol,
        "width":      "100%",
        "height":     height,
        "locale":     "en",
        "colorTheme": theme,
        "autosize":   True,
        "trendLineColor": "rgba(41, 98, 255, 1)",
        "underLineColor": "rgba(41, 98, 255, 0.3)",
        "underLineBottomColor": "rgba(41, 98, 255, 0)",
        "isTransparent": False,
        "noTimeScale": False,
        "dateRange": "12M",
        "chartType": "area",
    }
    config_json = json.dumps(config)
    html = f"""
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js" async>
  {config_json}
  </script>
</div>"""
    _safe_html(html, height=height + 20)


def tv_ticker_tape(
    symbols: list[tuple[str, str]],
    theme: str = "light",
) -> None:
    """
    Embed TradingView Ticker Tape widget (scrolling price bar).

    Args:
        symbols: list of (tradingview_symbol, display_name) tuples
        theme:   "light" or "dark"
    """
    sym_list = [{"proName": s, "title": d} for s, d in symbols]
    config = {
        "symbols":          sym_list,
        "showSymbolLogo":   True,
        "isTransparent":    False,
        "displayMode":      "adaptive",
        "colorTheme":       theme,
        "locale":           "en",
    }
    config_json = json.dumps(config)
    html = f"""
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js" async>
  {config_json}
  </script>
</div>"""
    _safe_html(html, height=78)


# ── Pre-defined symbol groups ──────────────────────────────────────────────

EQUITIES_SYMBOLS = [
    ("AMEX:SPY",  "SPY"),
    ("NASDAQ:QQQ","QQQ"),
    ("AMEX:IWM",  "IWM"),
]

RATES_CREDIT_SYMBOLS = [
    ("NASDAQ:TLT", "TLT"),
    ("AMEX:LQD", "LQD"),
    ("AMEX:HYG", "HYG"),
]

COMMODITIES_FX_SYMBOLS = [
    ("AMEX:GLD", "GLD"),
    ("AMEX:USO", "USO"),
    ("AMEX:UUP", "UUP"),
]

ALL_SYMBOLS = EQUITIES_SYMBOLS + RATES_CREDIT_SYMBOLS + COMMODITIES_FX_SYMBOLS


def render_tv_groups(theme: str = "light") -> None:
    """
    Render three TradingView Symbol Overview widgets in a 3-column layout
    covering equities, rates/credit, and commodities/FX.
    Falls back gracefully if embeds fail.
    """
    col1, col2, col3 = st.columns(3)
    with col1:
        st.caption("Equities")
        tv_symbol_overview(EQUITIES_SYMBOLS, theme=theme)
    with col2:
        st.caption("Rates & Credit")
        tv_symbol_overview(RATES_CREDIT_SYMBOLS, theme=theme)
    with col3:
        st.caption("Commodities & FX")
        tv_symbol_overview(COMMODITIES_FX_SYMBOLS, theme=theme)
