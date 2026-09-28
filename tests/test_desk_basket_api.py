"""Basket & Hedge's routes (api/desk_basket.py, desk/books; DESK_FRAME3_SPEC
§12.14, §12.15). The provider is mocked at market.daily_bars with seeded
random walks on the real XNYS sessions of the two years to 2026-09-25, so no
network is touched; the answers are checked against the §12 contract and a
few values against the engine directly."""

from __future__ import annotations

import sqlite3

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api import db, desk_basket
from api import desk_envelope as env
from api import worker as worker_mod
from api.main import app
from api.providers import market
from api.providers.errors import ProviderTimeout, UnknownSymbol
from tests import desk_contract as dc

client = TestClient(app, raise_server_exceptions=False)
END = "2026-09-25"


def _sessions() -> list[str]:
    from src.desk import event_study as es

    cal = es.session_calendar("2024-01-01", END)
    return [d.strftime("%Y-%m-%d") for d in es.sessions_between(cal, "2024-09-26", END)]


SESSIONS = _sessions()
_rng = np.random.default_rng(11)
_QQQ_R = np.concatenate([[0.0], _rng.normal(0.0006, 0.012, len(SESSIONS) - 1)])


def _walk(beta: float, seed: int, noise: float = 0.01) -> np.ndarray:
    r = np.random.default_rng(seed).normal(0, noise, len(SESSIONS))
    r[0] = 0.0
    return 50.0 * np.cumprod(1 + beta * _QQQ_R + r)


# Ticker → (first session index, closes). CRWV lists late, like the real one (March 2025).
UNIVERSE = {
    "QQQ": (0, 400.0 * np.cumprod(1 + _QQQ_R)),
    "SPY": (0, _walk(0.7, 2, 0.004)),
    "NVDA": (0, _walk(1.8, 3)),
    "AVGO": (0, _walk(1.5, 4)),
    "CRWV": (120, _walk(2.2, 5, 0.03)),
    "SMH": (0, _walk(1.6, 6)), "SOXX": (0, _walk(1.6, 7)), "XLK": (0, _walk(1.1, 8)), "IGV": (0, _walk(0.9, 9)),
    "XLU": (0, _walk(0.2, 10)), "IWM": (0, _walk(0.8, 12)),
    # Listed about 200 sessions ago: too young for a one-year window.
    "NBIS": (300, _walk(1.9, 13, 0.03)),
}


def _bars(sym: str) -> dict:
    if sym not in UNIVERSE:
        raise UnknownSymbol("eodhd", f"No listing found for '{sym}' on EODHD.")
    first, px = UNIVERSE[sym]
    return {"bars": [{"ts": f"{d}T00:00:00Z", "close": float(c), "close_raw": float(c) * 1.01, "volume": 2e6, "adjusted": True}
                     for d, c in zip(SESSIONS[first:], px[first:])]}


@pytest.fixture()
def served(tmp_path, monkeypatch, install_worker):
    """A worker serving one generation of a tiny file, and the mocked provider."""
    f = tmp_path / "tiny.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    monkeypatch.setattr(db, "DB_PATH", f)
    w = install_worker(worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    asked: list[str] = []

    def bars(sym):
        asked.append(sym)
        return _bars(sym)

    monkeypatch.setattr(market, "daily_bars", bars)
    return asked


def price(**q):
    return client.get("/api/desk/basket/price", params=q)


def test_a_ready_answer_keeps_the_contract_and_names_its_generation(served):
    r = price(legs="NVDA:40,AVGO:35,CRWV:25", method="hold", notional="1000000")
    body = dc.check_response("/basket/price", r)
    assert body["status"] == "ready" and body["generation_id"] and body["as_of"]
    d = body["data"]
    assert d["source"] == desk_basket.SOURCE and d["prices_as_of"] == END and d["end"] == END
    # CRWV lists at session 120: that is the start, and the answer says whose first close it is.
    assert d["start"] == SESSIONS[120] and d["start_binding"] == ["CRWV"] and d["start_is_first_close"] is True
    assert d["index"]["series"]["1y"][-1]["date"] == END and d["compare"]["1y"]["points"][-1]["date"] == END
    assert sorted(served) == ["AVGO", "CRWV", "NVDA", "QQQ", "SPY"]


def test_the_index_is_the_engines_and_its_technicals_are_the_shared_function(served):
    from src.desk import basket as bk

    d = price(legs="NVDA:50,AVGO:50").json()["data"]
    h = {s: desk_basket.history_of(_bars(s)) for s in ("NVDA", "AVGO")}
    ref = bk.price_basket(h, {"NVDA": 0.5, "AVGO": 0.5}, sessions=desk_basket.calendar_for(h))
    assert d["total_return"] == pytest.approx(ref["total_return"]) and d["start"] == SESSIONS[0]
    assert d["index"]["price"] == pytest.approx(ref["index"][-1]) and d["method"] == "hold" and d["notional"] == 1e6
    # Two years of sessions: the 200-day average is there across the whole one-year chart.
    assert all(p["ma200"] is not None for p in d["index"]["series"]["1y"])
    assert d["index"]["ret_1y"] is not None and d["index"]["rsi"] is not None and d["index"]["realized_vol_21d"] > 0
    # Dollar volume reads EODHD's unadjusted close: 1.01 × close × 2,000,000.
    nv = next(l for l in d["legs"] if l["symbol"] == "NVDA")
    assert nv["adv_usd"] == pytest.approx(np.mean([c * 1.01 * 2e6 for c in h["NVDA"].close[-20:]]))


def test_a_basket_that_is_all_qqq_moves_one_for_one_with_it(served):
    d = price(legs="QQQ:100").json()["data"]
    q = d["benchmarks"]["qqq"]
    assert q["beta_1y"] == pytest.approx(1.0) and q["corr_1y"] == pytest.approx(1.0) and q["beta_60d"] == pytest.approx(1.0)
    assert q["window_1y"]["n"] == 252 and q["window_60d"]["n"] == 60 and q["reason_1y"] is None
    last = d["compare"]["1y"]["points"][-1]
    assert last["basket"] == pytest.approx(last["qqq"]) and last["rs_qqq"] == pytest.approx(100.0)


def test_a_young_basket_says_why_its_one_year_figures_are_missing(served):
    d = price(legs="NBIS:100").json()["data"]
    q = d["benchmarks"]["qqq"]
    n = len(SESSIONS) - 300 - 1
    assert q["beta_1y"] is None and q["reason_1y"] == f"needs 252 daily returns; there are {n} since {SESSIONS[300]}"
    # 201 sessions: no one-year return, and the 200-day average only on the chart's last two sessions.
    assert d["index"]["ret_1y"] is None
    assert [p["date"] for p in d["index"]["series"]["1y"] if p["ma200"] is not None] == SESSIONS[-2:]
    assert q["beta_60d"] is not None


@pytest.mark.parametrize("q, words", [
    ({"legs": "NVDA:60,AVGO:30"}, "add to 90%"),
    ({"legs": "NVDA:50,NVDA:50"}, "twice"),
    ({"legs": "NVDA"}, "no weight"),
    ({"legs": "NVDA:abc"}, "not a number"),
    ({"legs": "^GSPC:100"}, "not a US listing"),
    ({"legs": "VOD.LSE:100"}, "not a US listing"),
    ({"legs": "NVDA:100", "method": "weekly"}, "not hold or monthly"),
    ({"legs": "NVDA:100", "notional": "-5"}, "notional"),
    ({"legs": "NVDA:100", "window": "5"}, "no window parameter"),
    ({}, "needs its legs"),
])
def test_a_request_that_cannot_be_priced_is_422_naming_what(served, q, words):
    r = price(**q)
    body = dc.check_response("/basket/price", r)
    assert r.status_code == 422 and body["error"]["code"] == "unsupported" and words in body["error"]["message"]


def test_a_ticker_eodhd_does_not_list_is_named(served):
    r = price(legs="NVDA:50,ZZZZ:50")
    body = dc.check_response("/basket/price", r)
    assert r.status_code == 422 and body["error"] == {"code": "unknown_symbol", "message": "ZZZZ: No listing found for 'ZZZZ' on EODHD."}


def test_a_provider_failure_keeps_its_status_and_words(served, monkeypatch):
    def slow(sym):
        raise ProviderTimeout("eodhd", "EODHD did not answer in time (historical prices).")

    monkeypatch.setattr(market, "daily_bars", slow)
    r = price(legs="NVDA:100")
    body = dc.check_response("/basket/price", r)
    assert r.status_code == 504 and body["error"]["code"] == "provider" and "did not answer in time" in body["error"]["message"]


def test_a_write_is_still_the_enveloped_405(served):
    r = client.post("/api/desk/basket/price", json={"legs": []})
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"


def test_the_basket_routes_share_the_provider_ceiling():
    from api import security

    assert "/api/desk/basket/price" in security.DESK_BASKET_PATHS
    assert not env.DEFERRED_REASONS.get("/basket/price")


# ── §12.15 /basket/hedge ────────────────────────────────────────────────────

def hedge(**q):
    return client.get("/api/desk/basket/hedge", params=q)


def test_the_hedge_keeps_the_contract_ranks_by_one_year_r2_and_names_its_top_pick(served):
    r = hedge(legs="NVDA:40,AVGO:35,CRWV:25", notional="2000000")
    body = dc.check_response("/basket/hedge", r)
    d = body["data"]
    assert d["ranked_by"] == "r2_1y" and [e["rank"] for e in d["etfs"]] == list(range(1, 9))
    r2 = [e["r2_1y"] for e in d["etfs"]]
    assert r2 == sorted(r2, reverse=True) and d["top"] == d["etfs"][0]["symbol"]
    top = d["etfs"][0]
    assert top["basis"] == "1y" and top["short_usd"] == pytest.approx(top["hedge_ratio"] * 2e6)
    assert top["vol_reduction"] == pytest.approx(1 - top["residual_vol"] / top["basket_vol"])
    # With a least-squares beta, what is left is sqrt(1 − R²) of the basket's volatility.
    assert top["residual_vol"] == pytest.approx(top["basket_vol"] * np.sqrt(1 - top["r2_1y"]), rel=1e-9)
    assert {s["shock"] for s in d["stress"]} == {"QQQ", "SPY"} and all(s["hedge"] == d["top"] for s in d["stress"])
    assert sorted(served) == sorted({"NVDA", "AVGO", "CRWV", "SMH", "SOXX", "QQQ", "XLK", "IGV", "XLU", "SPY", "IWM"})


def test_a_basket_that_is_all_qqq_is_hedged_by_qqq_one_for_one(served):
    d = hedge(legs="QQQ:100").json()["data"]
    top = d["etfs"][0]
    assert d["top"] == "QQQ" and top["r2_1y"] == pytest.approx(1.0) and top["hedge_ratio"] == pytest.approx(1.0)
    assert top["short_usd"] == pytest.approx(1e6) and top["residual_vol"] == pytest.approx(0.0, abs=1e-9)
    q = next(s for s in d["stress"] if s["shock"] == "QQQ")
    # QQQ −10%: the basket loses $100,000, the short QQQ makes it back.
    assert q["unhedged_usd"] == pytest.approx(-100_000.0) and q["hedge_usd"] == pytest.approx(100_000.0)
    assert q["hedged_usd"] == pytest.approx(0.0, abs=1e-6) and q["hedge_beta"] == 1.0


def test_the_stress_is_linear_in_betas_fitted_on_one_shared_window(served):
    """Codex R-01: the basket, the top ETF and each shock on one window ending at the basket's cutoff."""
    from src.desk import basket as bk

    d = hedge(legs="NVDA:50,AVGO:50").json()["data"]
    h = {s: desk_basket.history_of(_bars(s)) for s in ("NVDA", "AVGO", "QQQ", "SPY", d["top"])}
    cal = desk_basket.calendar_for(h)
    ref = bk.price_basket({s: h[s] for s in ("NVDA", "AVGO")}, {"NVDA": 0.5, "AVGO": 0.5}, sessions=cal)
    level = dict(zip(ref["dates"], ref["index"]))
    top_lv = dict(zip(h[d["top"]].dates, h[d["top"]].close))
    for s in d["stress"]:
        assert s["window"]["end"] == ref["end"] and s["window"]["n"] == 252
        bench = dict(zip(h[s["shock"]].dates, h[s["shock"]].close))
        bb = bk.regression(level, bench, 252, cal, ref["end"])["beta"]
        be = 1.0 if s["shock"] == d["top"] else bk.regression(top_lv, bench, 252, cal, ref["end"])["beta"]
        ratio = bk.regression(level, top_lv, 252, cal, ref["end"])["beta"]
        assert s["hedge_ratio"] == pytest.approx(ratio)
        assert s["unhedged_usd"] == pytest.approx(1e6 * bb * -0.1)
        assert s["hedged_usd"] == pytest.approx(1e6 * (bb - ratio * be) * -0.1)
        assert s["hedged_move"] == pytest.approx(s["hedged_usd"] / 1e6)


def test_a_young_basket_is_ranked_on_sixty_days_and_says_so(served):
    d = hedge(legs="NBIS:100").json()["data"]
    assert d["ranked_by"] == "r2_60d" and all(e["r2_1y"] is None for e in d["etfs"])
    assert d["etfs"][0]["basis"] == "60d" and d["etfs"][0]["window_60d"]["n"] == 60


def test_the_hedge_refuses_as_the_price_does(served):
    r = hedge(legs="NVDA:60")
    assert r.status_code == 422 and dc.check_response("/basket/hedge", r)["error"]["code"] == "unsupported"


# ── Codex R-07: adjusted closes only ────────────────────────────────────────

def test_codex_r07_a_bar_without_an_adjusted_close_is_left_out_and_disclosed(tmp_path, monkeypatch, install_worker):
    """Codex's repro over the mocked EODHD upstream: a two-for-one split, the pre-split bar with a raw close of 100
    and no adjusted_close, then raw and adjusted closes of 50. The basket read the raw 100 and lost 50%; the bar
    is now left out, the answer says so, and no split appears as a loss."""
    import httpx

    from api.providers import cache as cache_mod
    from api.providers import eodhd as eod
    from api.providers import entitlements

    f = tmp_path / "tiny.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    monkeypatch.setattr(db, "DB_PATH", f)
    w = install_worker(worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    days = SESSIONS[-3:]

    def upstream(request: httpx.Request) -> httpx.Response:
        sym = request.url.path.rsplit("/", 1)[-1].split(".")[0]
        if sym == "SPLT":
            rows = [{"date": days[0], "close": 100.0, "volume": 1e6},
                    {"date": days[1], "close": 50.0, "adjusted_close": 50.0, "volume": 2e6},
                    {"date": days[2], "close": 50.0, "adjusted_close": 50.0, "volume": 2e6}]
        else:
            rows = [{"date": d, "close": 10.0, "adjusted_close": 10.0, "volume": 1e6} for d in days]
        return httpx.Response(200, json=rows, request=request)

    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    market.set_client_for_tests(eod.EodhdClient("tok", timeout=1.0, max_retries=0, transport=httpx.MockTransport(upstream)))
    entitlements.reset_for_tests()
    monkeypatch.setattr(market, "_utcnow", lambda: __import__("datetime").datetime.fromisoformat(f"{days[-1]}T21:00:00+00:00"))
    try:
        body = client.get("/api/desk/basket/price", params={"legs": "SPLT:100"}).json()
    finally:
        market.set_client_for_tests(None)
        entitlements.reset_for_tests()
    d = body["data"]
    assert body["status"] == "ready" and d["start"] == days[1] and d["total_return"] == pytest.approx(0.0)
    assert d["excluded"] == [{"symbol": "SPLT", "n": 1, "reason": "no adjusted close from the provider"}]


def test_a_symbol_with_no_adjusted_close_at_all_is_refused():
    with pytest.raises(env.Refused) as ei:
        desk_basket.history_of({"bars": [{"ts": "2026-09-24T00:00:00Z", "close": 10.0, "adjusted": False}]}, "RAW")
    assert ei.value.status == 502 and "no adjusted closes" in ei.value.message
