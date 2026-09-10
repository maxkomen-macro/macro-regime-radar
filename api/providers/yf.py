"""yfinance wrappers — the disclosed fallback. Imported lazily inside each
function so api.main keeps starting without the dependency resolved, exactly
as api/lookup.py did. Every failure is mapped onto the provider error
hierarchy so market.py can reason about it."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.providers.errors import ProviderUnavailable, UnknownSymbol, UnsupportedInstrument
from api.providers.symbols import Instrument

PROVIDER = "yfinance"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def search(q: str, limit: int = 8) -> list[dict]:
    import yfinance as yf

    try:
        quotes = yf.Search(q, max_results=limit).quotes
    except Exception as exc:  # noqa: BLE001 — network layer
        raise ProviderUnavailable(PROVIDER, "Symbol search fallback is unavailable.", detail=repr(exc)) from exc
    out: list[dict] = []
    for item in quotes:
        sym = item.get("symbol")
        if not sym or not item.get("isYahooFinance", True):
            continue
        out.append(
            {
                "symbol": sym,
                "name": item.get("longname") or item.get("shortname") or sym,
                "exchange": item.get("exchDisp") or item.get("exchange"),
                "type": item.get("typeDisp") or item.get("quoteType"),
                "sector": item.get("sectorDisp") or item.get("sector"),
                "country": None,
                "currency": None,
            }
        )
    return out


def _fget(fast: Any, key: str) -> Any:
    try:
        v = fast[key]
    except Exception:  # noqa: BLE001 — lazy mapping raises per missing key
        return None
    return None if v != v else v  # NaN guard


def quote_and_fundamentals(inst: Instrument) -> dict:
    """Quote block + fundamentals from yfinance (delayed up to ~15 minutes)."""
    if inst.yfinance is None:
        raise UnsupportedInstrument(PROVIDER, "yfinance cannot address this listing.")
    import yfinance as yf

    try:
        t = yf.Ticker(inst.yfinance)
        fast = t.fast_info
    except Exception as exc:  # noqa: BLE001
        raise ProviderUnavailable(PROVIDER, "Quote fallback is unavailable.", detail=repr(exc)) from exc
    last = _fget(fast, "lastPrice")
    if last is None:
        raise UnknownSymbol(PROVIDER, f"No quote for '{inst.canonical}'.")
    prev = _fget(fast, "regularMarketPreviousClose") or _fget(fast, "previousClose")
    try:
        info: dict = t.info or {}
    except Exception:  # noqa: BLE001
        info = {}
    day_chg_pct = (last / prev - 1) * 100 if prev else None
    return {
        "name": info.get("longName") or info.get("shortName") or inst.canonical,
        "exchange": _fget(fast, "exchange"),
        "currency": _fget(fast, "currency"),
        "quote_type": _fget(fast, "quoteType"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "last": float(last),
        "prev_close": float(prev) if prev else None,
        "day_change_pct": float(day_chg_pct) if day_chg_pct is not None else None,
        "day_low": _fget(fast, "dayLow"),
        "day_high": _fget(fast, "dayHigh"),
        "year_low": _fget(fast, "yearLow"),
        "year_high": _fget(fast, "yearHigh"),
        "market_cap": _fget(fast, "marketCap"),
        "last_volume": _fget(fast, "lastVolume"),
        "avg_volume_3m": _fget(fast, "threeMonthAverageVolume"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "eps_ttm": info.get("trailingEps"),
        "beta": info.get("beta"),
        "dividend_yield": info.get("dividendYield"),
        "price_to_book": info.get("priceToBook"),
        "profit_margin": info.get("profitMargins"),
        "revenue_growth": info.get("revenueGrowth"),
        "fifty_two_wk_change": _fget(fast, "yearChange"),
        "market_ts": None,
        "fetched_at": _now_iso(),
    }


def history(inst: Instrument, *, period: str, interval: str) -> list[dict]:
    """Bars for a named yfinance period/interval, adjusted for splits and
    dividends (auto_adjust=True), timestamps in UTC."""
    if inst.yfinance is None:
        raise UnsupportedInstrument(PROVIDER, "yfinance cannot address this listing.")
    import yfinance as yf

    try:
        hist = yf.Ticker(inst.yfinance).history(period=period, interval=interval, auto_adjust=True)
    except Exception as exc:  # noqa: BLE001
        raise ProviderUnavailable(PROVIDER, "Candle fallback is unavailable.", detail=repr(exc)) from exc
    if hist is None or hist.empty:
        raise UnknownSymbol(PROVIDER, f"No candle history for '{inst.canonical}'.")
    out: list[dict] = []
    for idx, row in hist.iterrows():
        close = row.get("Close")
        if close is None or close != close:
            continue
        ts = idx.tz_convert("UTC") if idx.tzinfo else idx.tz_localize("UTC")

        def num(key: str) -> float | None:
            v = row.get(key)
            return float(v) if v is not None and v == v else None

        out.append(
            {
                "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "open": num("Open"),
                "high": num("High"),
                "low": num("Low"),
                "close": float(close),
                "volume": num("Volume"),
            }
        )
    return out
