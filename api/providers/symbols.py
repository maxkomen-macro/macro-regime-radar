"""Canonical symbols and their provider-specific spellings.

The desk writes "BRK.B", "BTC-USD", "EURUSD", "VIX" and "AAPL"; EODHD wants
"BRK-B.US", "BTC-USD.CC", "EURUSD.FOREX", "VIX.INDX", "AAPL.US"; yfinance wants
"BRK-B", "BTC-USD", "EURUSD=X", "^VIX", "AAPL". parse() accepts any of those
spellings and returns one Instrument carrying all three, so no provider ever
receives another provider's syntax.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_RAW_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-=^]{0,23}$|^\^[A-Z0-9.]{1,10}$")

# EODHD exchange codes we recognise as suffixes, with the yfinance suffix that
# reaches the same listing (None = yfinance cannot address it reliably).
EXCHANGE_CODES: dict[str, str | None] = {
    "US": "",
    "LSE": ".L",
    "TO": ".TO",
    "V": ".V",
    "PA": ".PA",
    "XETRA": ".DE",
    "F": ".F",
    "BE": ".BE",
    "MI": ".MI",
    "MC": ".MC",
    "AS": ".AS",
    "BR": ".BR",
    "LS": ".LS",
    "VI": ".VI",
    "SW": ".SW",
    "ST": ".ST",
    "HE": ".HE",
    "CO": ".CO",
    "OL": ".OL",
    "HK": ".HK",
    "SHG": ".SS",
    "SHE": ".SZ",
    "KO": ".KS",
    "TA": ".TA",
    "AU": ".AX",
    "NSE": ".NS",
    "BSE": ".BO",
    "MX": ".MX",
    "SA": ".SA",
    "JSE": ".JO",
    "TSE": ".T",
    "SG": ".SI",
    "IR": ".IR",
    "WAR": ".WA",
}

# Index shorthands the desk uses → (EODHD code, yfinance code).
INDICES: dict[str, tuple[str, str]] = {
    "VIX": ("VIX", "^VIX"),
    "SPX": ("GSPC", "^GSPC"),
    "GSPC": ("GSPC", "^GSPC"),
    "NDX": ("NDX", "^NDX"),
    "DJI": ("DJI", "^DJI"),
    "RUT": ("RUT", "^RUT"),
    "TNX": ("TNX", "^TNX"),
    "VXN": ("VXN", "^VXN"),
}

_CURRENCIES = {
    "USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD", "CNY", "CNH", "HKD",
    "SGD", "SEK", "NOK", "DKK", "MXN", "BRL", "ZAR", "INR", "KRW", "TRY", "PLN",
}
_CRYPTO_QUOTES = {"USD", "USDT", "USDC", "EUR", "GBP", "BTC", "ETH"}


@dataclass(frozen=True)
class Instrument:
    canonical: str
    kind: str  # equity | crypto | forex | index
    eodhd: str
    yfinance: str | None
    exchange: str  # EODHD exchange code: US, LSE, CC, FOREX, INDX …
    base: str

    @property
    def is_us_equity(self) -> bool:
        return self.kind == "equity" and self.exchange == "US"


class SymbolError(ValueError):
    """The text is not a symbol at all (too long, bad characters)."""


def _crypto(base: str, quote: str) -> Instrument:
    canon = f"{base}-{quote}"
    return Instrument(canon, "crypto", f"{canon}.CC", canon, "CC", base)


def _forex(pair: str) -> Instrument:
    return Instrument(pair, "forex", f"{pair}.FOREX", f"{pair}=X", "FOREX", pair)


def _index(code: str) -> Instrument:
    eod, yf = INDICES.get(code, (code, f"^{code}"))
    return Instrument(code, "index", f"{eod}.INDX", yf, "INDX", code)


def _equity(code: str, exchange: str) -> Instrument:
    if "=" in code or "^" in code:
        raise SymbolError(f"'{code}' is not a listable symbol.")
    # Share classes: BRK.B / BRK-B → canonical "BRK.B", EODHD "BRK-B", yfinance "BRK-B".
    m = re.fullmatch(r"([A-Z0-9]{1,6})[.\-]([A-Z])", code)
    if m:
        base, cls = m.group(1), m.group(2)
        canon_code = f"{base}.{cls}"
        provider_code = f"{base}-{cls}"
    else:
        canon_code = provider_code = code
    canonical = canon_code if exchange == "US" else f"{canon_code}.{exchange}"
    yf_suffix = EXCHANGE_CODES.get(exchange)
    yfinance = f"{provider_code}{yf_suffix}" if yf_suffix is not None else None
    return Instrument(canonical, "equity", f"{provider_code}.{exchange}", yfinance, exchange, canon_code)


def parse(raw: str) -> Instrument:
    """Resolve any accepted spelling to one Instrument. Raises SymbolError for
    text that cannot be a symbol; never touches the network."""
    text = (raw or "").strip().upper()
    if not text or not _RAW_RE.match(text):
        raise SymbolError(f"'{raw}' is not a listable symbol.")

    # yfinance spellings
    if text.startswith("^"):
        return _index(text[1:])
    if text.endswith("=X") and len(text) == 8:
        return _forex(text[:6])

    # EODHD spellings
    if text.endswith(".CC"):
        body = text[:-3]
        if "-" in body:
            base, quote = body.split("-", 1)
            return _crypto(base, quote)
        return _crypto(body, "USD")
    if text.endswith(".FOREX"):
        return _forex(text[:-6])
    if text.endswith(".INDX"):
        return _index(text[:-5])

    # Crypto pair BTC-USD / ETH-USDT
    m = re.fullmatch(r"([A-Z0-9]{2,10})-([A-Z]{3,4})", text)
    if m and m.group(2) in _CRYPTO_QUOTES and m.group(1) not in _CURRENCIES:
        return _crypto(m.group(1), m.group(2))

    # Six-letter currency pair EURUSD
    if len(text) == 6 and text.isalpha() and text[:3] in _CURRENCIES and text[3:] in _CURRENCIES:
        return _forex(text)

    # Desk index shorthand
    if text in INDICES:
        return _index(text)

    # Exchange suffix — the last dotted segment. Any 2–6 letter code parses as
    # an EODHD exchange (yfinance reachable only when EXCHANGE_CODES maps it),
    # so a search hit from any exchange round-trips (review P2-1); a single
    # trailing letter is a share class, handled by _equity.
    if "." in text:
        head, tail = text.rsplit(".", 1)
        if tail in EXCHANGE_CODES or re.fullmatch(r"[A-Z]{2,6}", tail):
            return _equity(head, tail)
    return _equity(text, "US")


def canonical(raw: str) -> str:
    return parse(raw).canonical


def from_eodhd_hit(code: str, exchange: str | None) -> str:
    """EODHD search rows carry Code + Exchange separately; map to canonical."""
    exch = (exchange or "US").upper()
    if exch == "CC":
        return parse(f"{code}.CC").canonical
    if exch == "FOREX":
        return parse(f"{code}.FOREX").canonical
    if exch == "INDX":
        return parse(f"{code}.INDX").canonical
    return parse(f"{code}.{exch}").canonical
