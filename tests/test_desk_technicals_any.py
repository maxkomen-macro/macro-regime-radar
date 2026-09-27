"""tests/test_desk_technicals_any.py — Technicals for any stock (desk/usability, item 2).

DESK_FRAME3_SPEC §14.2: one shared function computes every technical for the
S&P 500 and for any US-listed stock or ETF: the averages, crosses, returns,
RSI-14 (Wilder, §12.13's rule), the drawdown from the one-year high, 21-day
realized volatility and relative strength against the stored S&P 500.
`/api/desk/technicals?symbol=` answers the S&P itself (a lookup), a stored
ETF (a lookup of the instruments item) or any other symbol from two years
of EODHD daily candles; a provider failure is its typed error, a non-US
symbol is refused.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, timedelta

import httpx
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk_items, desk_v2
from api.main import app
from api.providers import cache as cache_mod
from api.providers import eodhd as eod
from api.providers import entitlements, market
from src.market_data import asset_history
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve
from src.desk.technicals import PRICE_SPEC
from tests.test_event_study import _synthetic_db

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS if n in ("desk_technicals", "desk_instruments", "desk_study:spx-20d-2sigma")]
TOKEN = "tok-not-a-real-token"


# ── RSI-14, Wilder (§12.13's rule) ──────────────────────────────────────────

def _reference_rsi(closes: list[float], n: int = 14) -> float:
    d = np.diff(closes)
    g, l = np.clip(d, 0, None), np.clip(-d, 0, None)
    ag, al = g[:n].mean(), l[:n].mean()
    for x, y in zip(g[n:], l[n:]):
        ag, al = (ag * (n - 1) + x) / n, (al * (n - 1) + y) / n
    return 100 - 100 / (1 + ag / al)


def _rsi(px) -> np.ndarray:
    """The one RSI the Desk serves for every symbol: src/analytics/technicals.rsi (desk/fill-compute)."""
    from src.analytics import technicals

    return technicals.rsi(pd.Series(np.asarray(px, dtype=float))).to_numpy()


def test_rsi_is_wilders_initialized_from_fifteen_closes():
    rng = np.random.default_rng(7)
    px = list(100 * np.cumprod(1 + rng.normal(0, 0.01, 60)))
    r = _rsi(px)
    assert np.isnan(r[:14]).all() and math.isfinite(r[14])
    assert math.isclose(r[14], _reference_rsi(px[:15]), rel_tol=1e-12)
    assert math.isclose(r[-1], _reference_rsi(px), rel_tol=1e-12)


def test_rsi_edges_and_a_gap_restart_the_count():
    up = np.arange(1.0, 30.0)
    assert _rsi(up)[-1] == 100.0
    assert _rsi(up[::-1])[-1] == 0.0
    assert _rsi(np.full(20, 5.0))[-1] == 50.0
    px = np.concatenate([np.arange(1.0, 21.0), [np.nan], np.arange(30.0, 44.0)])
    r = _rsi(px)
    assert math.isfinite(r[19]) and np.isnan(r[20])
    # After the gap, 14 closes are not enough; the 15th would be.
    assert np.isnan(r[21:]).all()


# ── The shared function on a stock ──────────────────────────────────────────

def _sessions(start: str, end: str) -> pd.DatetimeIndex:
    from src.desk import event_study as es

    return es.sessions_between(es.session_calendar(start, end), start, end)


def test_drawdown_realized_vol_and_relative_strength_follow_their_definitions():
    days = _sessions("2024-09-20", "2026-09-18")
    rng = np.random.default_rng(11)
    stock = pd.Series(50 * np.cumprod(1 + rng.normal(0.0005, 0.02, len(days))), index=days)
    spx = pd.Series(5000 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(days))), index=days)
    t = desk_items.technicals_from_level(stock, spec=PRICE_SPEC, ranges={"6m": 6, "1y": 12}, bench=spx)
    assert set(t["series"]) == {"6m", "1y"} and t["date"] == "2026-09-18"
    px = stock.to_numpy()
    last = px[-252:]
    assert math.isclose(t["drawdown"]["value"], px[-1] / last.max() - 1)
    assert t["drawdown"]["peak"]["date"] == days[len(px) - 252 + int(np.argmax(last))].strftime("%Y-%m-%d")
    assert t["drawdown"]["window"]["n"] == 252
    rets = np.diff(np.log(px[-22:]))
    assert math.isclose(t["realized_vol"]["value"], float(np.std(rets, ddof=1) * math.sqrt(252)))
    assert t["realized_vol"]["window"] == {"start": days[-22].strftime("%Y-%m-%d"), "end": "2026-09-18", "n": 21}
    ratio = px / spx.to_numpy()
    rs = t["rs"]
    assert rs["benchmark"] == "^GSPC" and rs["date"] == "2026-09-18"
    assert math.isclose(rs["value"], ratio[-1]) and math.isclose(rs["ma50"], ratio[-50:].mean())
    assert math.isclose(rs["chg_3m"], ratio[-1] / ratio[-64] - 1)
    one_year = rs["series"]["1y"]
    assert math.isclose(one_year[0]["rs"], 100.0) and one_year[-1]["date"] == "2026-09-18"
    # Main's shared RSI, MACD and seasonality (src/analytics/technicals) for any symbol's closes.
    assert math.isfinite(t["rsi"]) and t["rsi_date"] == "2026-09-18"
    assert t["macd"] is not None and t["macd"]["params"] == {"fast": 12, "slow": 26, "signal": 9}
    assert t["seasonality"] is not None and len(t["seasonality"]["rows"]) == 12


def test_the_sp500s_own_answer_is_unchanged_by_the_new_figures(tmp_path):
    """The S&P's §12.7 fields are what they were; the new ones ride beside them."""
    from src.desk import event_study as es

    path = _synthetic_db(tmp_path / "macro_radar.db")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    raw = es.load_level(conn, __import__("src.desk.series", fromlist=["get"]).get("spx"), "2026-09-18")
    conn.close()
    t = desk_items.technicals_from_level(raw)
    assert set(t["series"]) == {"6m", "1y", "3y"} and t["rs"] is None
    assert {"rsi", "drawdown", "realized_vol"} <= set(t)


# ── The route ───────────────────────────────────────────────────────────────

@pytest.fixture()
def store(tmp_path):
    """The synthetic store with a stored ETF (GLD, daily) beside ^GSPC."""
    path = _synthetic_db(tmp_path / "macro_radar.db")
    days = pd.bdate_range("2019-01-02", "2026-09-18")
    rng = np.random.default_rng(5)
    gld = 120 * np.cumprod(1 + rng.normal(0.0002, 0.009, len(days)))
    conn = sqlite3.connect(path)
    asset_history.write_series(conn, "GLD", "1d", list(zip([d.strftime("%Y-%m-%d") for d in days], gld.tolist())), provider="test")
    conn.commit()
    conn.close()
    return path


@pytest.fixture()
def served(install_worker, monkeypatch, store):
    return _serve(install_worker, monkeypatch, store, items=ITEMS)


def _tech(query: str = "") -> dict:
    return dc.check_response("/technicals", client.get(f"/api/desk/technicals{query}"))


def test_the_sp500_answers_as_before_with_its_new_figures(served):
    d = _tech()["data"]
    assert (d["symbol"], d["name"], d["scored"], d["rs"]) == ("^GSPC", "S&P 500", True, None)
    assert d["signals_allowlist"] == list(desk_v2.catalog.TECHNICALS_ALLOWLIST)
    assert set(d["series"]) == {"6m", "1y", "3y"}
    for spelling in ("^GSPC", "spx", "GSPC.INDX"):
        assert _tech(f"?symbol={spelling}")["data"]["symbol"] == "^GSPC"


def test_a_stored_etf_is_a_lookup_with_its_relative_strength(served, monkeypatch):
    monkeypatch.setattr(market, "candles", lambda *a, **k: pytest.fail("a stored ETF never asks the provider"))
    d = _tech("?symbol=gld")["data"]
    assert (d["symbol"], d["name"], d["scored"], d["source"]) == ("GLD", "SPDR Gold Shares", False, "asset_prices GLD")
    assert d["signals_allowlist"] == [] and d["move_20d_sigma"] is None
    assert d["rs"]["benchmark"] == "^GSPC" and set(d["rs"]["series"]) == {"6m", "1y", "3y"}


def _eod_rows(start: date, end: date) -> list[dict]:
    rows, d, px = [], start, 100.0
    rng = np.random.default_rng(3)
    while d <= end:
        if d.weekday() < 5:
            px *= 1 + rng.normal(0.0004, 0.015)
            rows.append({"date": d.isoformat(), "open": px, "high": px, "low": px, "close": px, "adjusted_close": px, "volume": 1000})
        d += timedelta(days=1)
    return rows


@pytest.fixture()
def upstream(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        path = request.url.path
        if path == "/api/eod/NVDA.US":
            today = date.today()
            return httpx.Response(200, json=_eod_rows(today - timedelta(days=731), date(2026, 9, 18)), request=request)
        if path.startswith("/api/search/NVDA"):
            return httpx.Response(200, json=[{"Code": "NVDA", "Exchange": "US", "Name": "NVIDIA Corporation", "Type": "Common Stock"}], request=request)
        if path.startswith("/api/eod/"):
            return httpx.Response(404, json={"message": "Ticker Not Found."}, request=request)
        return httpx.Response(404, json={"message": "not found"}, request=request)

    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    monkeypatch.setattr(eod.time, "sleep", lambda s: None)
    market.set_client_for_tests(eod.EodhdClient(TOKEN, timeout=1.0, max_retries=0, transport=httpx.MockTransport(handler)))
    entitlements.reset_for_tests()
    market.clear_caches()
    yield calls
    market.set_client_for_tests(None)
    market.clear_caches()


def test_any_other_stock_reads_two_years_of_candles(served, upstream):
    d = _tech("?symbol=NVDA")["data"]
    assert (d["symbol"], d["name"], d["scored"]) == ("NVDA", "NVIDIA Corporation", False)
    assert d["source"] == desk_v2.CANDLES_SOURCE and set(d["series"]) == {"6m", "1y"}
    assert d["rs"] is not None and d["rs"]["date"] <= "2026-09-18"
    eod_call = next(c for c in upstream if c.url.path == "/api/eod/NVDA.US")
    assert eod_call.url.params.get("period") == "d"
    # A second ask is the provider cache's.
    n = len(upstream)
    _tech("?symbol=NVDA")
    assert len([c for c in upstream[n:] if c.url.path.startswith("/api/eod/")]) == 0


def test_refusals_and_provider_errors_are_enveloped(served, upstream):
    r = client.get("/api/desk/technicals?symbol=ZZZZ")
    body = r.json()
    assert r.status_code == 404 and body["status"] == "error" and body["error"]["code"] == "unknown_symbol"
    assert "api_token" not in r.text
    for q in ("?symbol=VOD.LSE", "?symbol=NVDA&symbol=AAPL", "?ticker=NVDA", "?symbol="):
        r = client.get(f"/api/desk/technicals{q}")
        assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported", q


def test_a_symbol_waits_with_the_provider_calls():
    """§14.2: /technicals with a symbol may ask EODHD, so the middleware bounds it by the provider ceiling."""
    from api import security

    assert security.DESK_TECHNICALS_PATH == "/api/desk/technicals"
    src = __import__("inspect").getsource(security)
    assert 'path == DESK_TECHNICALS_PATH and b"symbol=" in' in src
