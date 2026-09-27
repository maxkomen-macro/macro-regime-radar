"""yfinance wrapper for the refresh pipeline's disclosed fallback only.

Since fix/prelaunch-1 the API process never calls Yahoo: on-demand lookups are
EODHD only (api/providers/market.py). The one caller left is
market.daily_history(..., allow_yahoo=True), which the full refresh uses to
store allocation's price histories when EODHD does not carry a series
(src/market_data/asset_history.py); the stored row names the provider.
yfinance is imported inside the function, so importing this module (as the
API does, through market.py) never loads it. Failures map onto the provider
error hierarchy."""

from __future__ import annotations

from api.providers.errors import ProviderUnavailable, UnknownSymbol

PROVIDER = "yfinance"


class Closes(list):
    """[(YYYY-MM-DD, close)] with the session's traded volume beside it in
    `volume` ({date: shares}, as Yahoo serves it), so every caller that reads
    the list as closes keeps working (desk/fill-etf)."""

    volume: dict[str, float]

    def __init__(self, rows=(), volume: dict[str, float] | None = None) -> None:
        super().__init__(rows)
        self.volume = dict(volume or {})


def daily_closes(code: str, start: str, end: str | None = None) -> Closes:
    """Daily split- and dividend-adjusted closes (auto_adjust=True), start
    inclusive and end exclusive, as [(YYYY-MM-DD, close)], with each date's
    volume in `.volume` where Yahoo serves one."""
    import pandas as pd
    import yfinance as yf

    try:
        raw = yf.download(code, start=start, end=end, progress=False, auto_adjust=True)
    except Exception as exc:  # noqa: BLE001 — network layer
        raise ProviderUnavailable(PROVIDER, f"Yahoo could not supply {code}.", detail=repr(exc)) from exc
    if raw is None or raw.empty:
        raise UnknownSymbol(PROVIDER, f"Yahoo has no daily history for {code}.")
    if isinstance(raw.columns, pd.MultiIndex):
        close_cols = [c for c in raw.columns if c[0] == "Close"]
        if not close_cols:
            raise UnknownSymbol(PROVIDER, f"Yahoo returned no closes for {code}.")
        closes = raw[close_cols[0]]
    elif "Close" in raw.columns:
        closes = raw["Close"]
    else:
        raise UnknownSymbol(PROVIDER, f"Yahoo returned no closes for {code}.")
    vols = None
    if isinstance(raw.columns, pd.MultiIndex):
        vol_cols = [c for c in raw.columns if c[0] == "Volume"]
        vols = raw[vol_cols[0]] if vol_cols else None
    elif "Volume" in raw.columns:
        vols = raw["Volume"]
    out = Closes()
    for idx, v in closes.dropna().items():
        if v and v > 0:
            d = pd.Timestamp(idx).strftime("%Y-%m-%d")
            out.append((d, float(v)))
            if vols is not None:
                vol = vols.get(idx)
                if vol is not None and vol == vol and vol >= 0:  # NaN is not a volume
                    out.volume[d] = float(vol)
    return out
