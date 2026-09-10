"""Symbol normalization: one canonical house spelling, one EODHD spelling,
one yfinance spelling — and never the wrong vendor's syntax on the wire."""

from __future__ import annotations

import pytest

from api.providers.symbols import SymbolError, canonical, from_eodhd_hit, parse

CASES = [
    # raw → (canonical, eodhd, yfinance, kind)
    ("AMZN", "AMZN", "AMZN.US", "AMZN", "equity"),
    ("aapl", "AAPL", "AAPL.US", "AAPL", "equity"),
    ("NVDA", "NVDA", "NVDA.US", "NVDA", "equity"),
    ("MSFT", "MSFT", "MSFT.US", "MSFT", "equity"),
    ("JPM", "JPM", "JPM.US", "JPM", "equity"),
    ("BRK.B", "BRK.B", "BRK-B.US", "BRK-B", "equity"),
    ("BRK-B", "BRK.B", "BRK-B.US", "BRK-B", "equity"),
    ("SPY", "SPY", "SPY.US", "SPY", "equity"),
    ("QQQ", "QQQ", "QQQ.US", "QQQ", "equity"),
    ("BTC-USD", "BTC-USD", "BTC-USD.CC", "BTC-USD", "crypto"),
    ("EURUSD", "EURUSD", "EURUSD.FOREX", "EURUSD=X", "forex"),
    ("EURUSD=X", "EURUSD", "EURUSD.FOREX", "EURUSD=X", "forex"),
    ("VIX", "VIX", "VIX.INDX", "^VIX", "index"),
    ("^VIX", "VIX", "VIX.INDX", "^VIX", "index"),
    ("VIX.INDX", "VIX", "VIX.INDX", "^VIX", "index"),
    ("AMZN.US", "AMZN", "AMZN.US", "AMZN", "equity"),
]


@pytest.mark.parametrize("raw, canon, eodhd, yfin, kind", CASES)
def test_spellings(raw, canon, eodhd, yfin, kind):
    inst = parse(raw)
    assert inst.canonical == canon
    assert inst.eodhd == eodhd
    assert inst.yfinance == yfin
    assert inst.kind == kind
    assert canonical(raw) == canon


def test_vendor_syntax_never_crosses():
    for raw, *_ in CASES:
        inst = parse(raw)
        assert "^" not in inst.eodhd and "=X" not in inst.eodhd, raw
        assert not inst.yfinance.endswith((".US", ".CC", ".FOREX", ".INDX")), raw


def test_us_equity_flag():
    assert parse("AMZN").is_us_equity
    assert parse("BRK.B").is_us_equity
    assert not parse("VIX").is_us_equity
    assert not parse("EURUSD").is_us_equity
    assert not parse("BTC-USD").is_us_equity


@pytest.mark.parametrize("junk", ["", "   ", "not a symbol!!", "A" * 40, "DROP TABLE", "AMZN;SELECT", "../etc"])
def test_junk_rejected(junk):
    with pytest.raises(SymbolError):
        parse(junk)


def test_from_eodhd_hit_roundtrips_house_spelling():
    assert from_eodhd_hit("AAPL", "US") == "AAPL"
    assert from_eodhd_hit("BRK-B", "US") == "BRK.B"
    assert from_eodhd_hit("BTC-USD", "CC") == "BTC-USD"
    assert from_eodhd_hit("EURUSD", "FOREX") == "EURUSD"
    assert from_eodhd_hit("VIX", "INDX") == "VIX"
    # A non-US listing keeps its exchange so it never collides with a US ticker.
    lse = from_eodhd_hit("VOD", "LSE")
    assert lse != "VOD" and parse(lse).eodhd == "VOD.LSE"


@pytest.mark.parametrize("code, exch", [("AAPL", "US"), ("AMZN", "BA"), ("AAPL", "AT"), ("VOD", "LSE"), ("NESN", "SW"), ("ABC", "XYZQ"), ("BRK-B", "US")])
def test_eodhd_hits_round_trip_for_any_exchange(code, exch):
    canon = from_eodhd_hit(code, exch)
    inst = parse(canon)
    assert inst.eodhd == f"{code}.{exch}"
    assert inst.exchange == exch
    if exch not in ("US", "LSE", "SW"):
        assert inst.yfinance is None  # unmapped exchange: no yfinance fallback, never a wrong one


@pytest.mark.parametrize("raw", ["AAPL=X", "A^B", "EURUSD=Y"])
def test_yahoo_syntax_never_becomes_an_equity(raw):
    with pytest.raises(SymbolError):
        parse(raw)

