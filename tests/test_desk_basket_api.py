"""Basket & Hedge's routes (api/desk_basket.py, desk/books; DESK_FRAME3_SPEC
§12.15, §12.16). The provider is mocked at market.daily_bars with seeded
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


# ── §12.16 /basket/hedge ────────────────────────────────────────────────────

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
    top = d["etfs"][0]
    for s in d["stress"]:
        assert s["window"]["end"] == ref["end"] and s["window"]["n"] == 252
        bench = dict(zip(h[s["shock"]].dates, h[s["shock"]].close))
        bb = bk.regression(level, bench, 252, cal, ref["end"])["beta"]
        be = 1.0 if s["shock"] == d["top"] else bk.regression(top_lv, bench, 252, cal, ref["end"])["beta"]
        # The short is the table's, as it recommends it (Codex R-15).
        ratio = top["hedge_ratio"]
        assert s["hedge_ratio"] == ratio and s["short_usd"] == top["short_usd"]
        assert s["unhedged_usd"] == pytest.approx(1e6 * bb * -0.1)
        assert s["hedged_usd"] == pytest.approx(1e6 * (bb - ratio * be) * -0.1)
        assert s["hedged_move"] == pytest.approx(s["hedged_usd"] / 1e6)


def test_codex_r15_the_answer_stresses_the_short_its_table_recommends():
    """Codex's R-15 repro through the answer itself: the basket moves three times SMH for its first 60 returns
    and with it for the last 60, QQQ has only the first 61 prices; the table recommends shorting $1M of SMH, and
    the QQQ stress holds that $1M short: −$200,000 hedged, not the refitted hedge's $0."""
    from src.desk import basket as bk

    cal = SESSIONS[-121:]
    smh_r = np.array([-0.01 if i % 2 == 0 else 0.01 for i in range(120)])

    def lv(rets):
        return list(100.0 * np.cumprod(np.concatenate([[1.0], 1 + np.asarray(rets)])))

    def hist(closes, n=None):
        n = len(closes) if n is None else n
        return bk.History(tuple(cal[:n]), tuple(float(c) for c in closes[:n]), tuple([1e9] * n))

    rng = np.random.default_rng(15)
    histories = {"BSK": hist(lv(np.concatenate([3 * smh_r[:60], smh_r[60:]]))), "SMH": hist(lv(smh_r)), "QQQ": hist(lv(smh_r), 61)}
    for sym in ("SOXX", "XLK", "IGV", "XLU", "SPY", "IWM"):
        histories[sym] = hist(lv(rng.normal(0, 0.01, 120)))
    d = desk_basket.hedge_answer(histories, [("BSK", 100.0)], "hold", 1_000_000.0)
    top = d["etfs"][0]
    assert d["top"] == "SMH" and top["basis"] == "60d" and top["short_usd"] == pytest.approx(1_000_000.0)
    q = next(s for s in d["stress"] if s["shock"] == "QQQ")
    assert q["window"] == {"start": cal[0], "end": cal[60], "n": 60}
    assert q["short_usd"] == top["short_usd"] and q["hedge_ratio"] == top["hedge_ratio"]
    assert q["unhedged_usd"] == pytest.approx(-300_000.0) and q["hedged_usd"] == pytest.approx(-200_000.0)


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


# ── desk/cap-weight: weighting=cap from the stored share counts ─────────────

COUNTS = {"NVDA": 24_147_000_000, "AVGO": 4_773_629_865, "CRWV": 458_871_690}


def _counts_store(path, rows=None, *, table=True, extra=()):
    """A tiny file holding the share_counts table as the full refresh writes it (rows read 2026-09-24), or no
    table at all. With `extra` rows, as a hand might add them, the table is one without the step's CHECK."""
    from src.market_data import share_counts as sc

    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE t (x)")
        if table and extra:
            c.execute("CREATE TABLE share_counts (symbol TEXT PRIMARY KEY, shares_outstanding REAL, as_of TEXT, source TEXT)")
        if table:
            sc.write_counts(c, COUNTS if rows is None else rows, "2026-09-24")
            c.executemany("INSERT INTO share_counts VALUES (?, ?, ?, ?)", extra)
    return path


def test_codex_r05_the_freshness_dates_the_counts_by_the_rows_the_basket_reads(tmp_path, monkeypatch):
    """Codex R-05: /api/freshness's share-count state reads only the rows the basket reads: a row dated after today,
    which the basket sets aside, never dates it, and with every row set aside the counts read as unavailable."""
    from datetime import date

    from api import freshness as fr

    f = _counts_store(tmp_path / "fresh.db", extra=[("ZZZ", 1e9, "2099-01-01", "yfinance")])
    with sqlite3.connect(f) as c:
        for t in ("regimes(date)", "signals(date)", "market_daily(date)", "market_intraday(ts)", "news_feed(published_at)", "raw_series(date)"):
            c.execute(f"CREATE TABLE {t}")
    monkeypatch.setattr(db, "DB_PATH", f)
    db.reset_connections_for_tests()
    try:
        out = db._freshness_uncached()
        assert out["share_counts_as_of"] == "2026-09-24" and out["share_counts_rows"] == len(COUNTS) + 1
        with sqlite3.connect(f) as c:
            c.execute("UPDATE share_counts SET as_of = '2099-01-01'")
        db.reset_connections_for_tests()
        out = db._freshness_uncached()
        assert out["share_counts_as_of"] is None and out["share_counts_rows"] == len(COUNTS) + 1
        st = fr.share_counts_state(out["share_counts_as_of"], today_ny=date(2026, 10, 2), stored_rows=out["share_counts_rows"])
        assert st["state"] == "unknown" and st["reason"] == fr.SHARE_COUNTS_NONE_READABLE
    finally:
        db.reset_connections_for_tests()


@pytest.fixture()
def served_counts(tmp_path, monkeypatch, install_worker):
    """start(...) serves the share counts item over a file built by _counts_store, with the mocked provider."""
    def start(rows=None, **kw):
        f = _counts_store(tmp_path / "counts.db", rows, **kw)
        monkeypatch.setattr(db, "DB_PATH", f)
        db.reset_connections_for_tests()
        w = install_worker(worker_mod.AnalyticsWorker(items=[("desk_share_counts", desk_basket.desk_share_counts)], poll_s=0.05, preload=False))
        w.start(serving=True)
        assert w.wait_published(timeout=30)
        monkeypatch.setattr(market, "daily_bars", _bars)
        return w

    return start


def test_a_cap_weighted_basket_is_weighted_by_market_value_at_its_start(served_counts):
    served_counts()
    r = price(legs="NVDA,AVGO,CRWV", weighting="cap", method="hold", notional="1000000")
    body = dc.check_response("/basket/price", r)
    d = body["data"]
    assert d["weighting"] == "cap" and d["start"] == SESSIONS[120]  # CRWV's first close sets the start
    cw = d["cap_weights"]
    assert cw["provider"] == "Yahoo" and cw["as_of"] == "2026-09-24" and cw["start"] == SESSIONS[120]
    # Each weight is its count × its close on the start over the sum: the close as traded (Codex R-01), EODHD's own
    # close (the mock's is the adjusted close × 1.01, no split), never the adjusted one.
    closes = {s: float(UNIVERSE[s][1][120]) * 1.01 for s in COUNTS}
    mv = {s: COUNTS[s] * closes[s] for s in COUNTS}
    want = {s: mv[s] / sum(mv.values()) for s in COUNTS}
    assert {l["symbol"]: l["target_weight"] for l in d["legs"]} == pytest.approx(want)
    for l in cw["legs"]:
        s = l["symbol"]
        assert (l["shares_outstanding"], l["as_of"]) == (COUNTS[s], "2026-09-24")
        assert (l["close_start"], l["value_start"], l["weight_start"]) == pytest.approx((closes[s], mv[s], want[s]))
    # The index is the three companies' market value over the start's (no dividend in the mock).
    end_mv = sum(COUNTS[s] * float(UNIVERSE[s][1][-1]) * 1.01 for s in COUNTS)
    assert d["total_return"] == pytest.approx(end_mv / sum(mv.values()) - 1)
    # The same names at typed weights are another basket, and say so.
    t = price(legs="NVDA:40,AVGO:35,CRWV:25").json()["data"]
    assert t["weighting"] == "target" and t["cap_weights"] is None and t["total_return"] != pytest.approx(d["total_return"])


def test_history_of_keeps_eodhds_own_close_as_the_close_as_traded():
    """desk/cap-weight (Codex R-01): the adjusted close prices the index; EODHD's own close, kept beside it, is what
    a cap-weighted basket's market values read. A bar without one keeps its place, with None, and has no market
    value that session (round 2, R2-03: none is borrowed); a 2% dividend stays in the market value."""
    from src.desk import basket as bk

    bars = {"bars": [
        {"ts": "2026-09-21T00:00:00Z", "close": 98.0, "close_raw": 100.0, "volume": 1e6, "adjusted": True},
        {"ts": "2026-09-22T00:00:00Z", "close": 99.0, "close_raw": None, "volume": 1e6, "adjusted": True},
        {"ts": "2026-09-23T00:00:00Z", "close": 98.0, "close_raw": 98.0, "volume": 1e6, "adjusted": True},
    ]}
    h = desk_basket.history_of(bars, "X")
    assert h.close == (98.0, 99.0, 98.0) and h.close_traded == (100.0, None, 98.0)
    assert bk.market_prices(h, "X") == pytest.approx({"2026-09-21": 100.0, "2026-09-23": 98.0})


def test_a_cap_weighted_hedge_reads_the_same_counts_and_says_so(served_counts):
    served_counts()
    r = hedge(legs="NVDA,AVGO,CRWV", weighting="cap", notional="2000000")
    d = dc.check_response("/basket/hedge", r)["data"]
    assert d["weighting"] == "cap" and d["cap_weights"]["as_of"] == "2026-09-24"
    assert d["etfs"][0]["short_usd"] == pytest.approx(d["etfs"][0]["hedge_ratio"] * 2e6)


def test_monthly_cap_weight_resets_on_each_months_first_session_and_matches_held(served_counts):
    served_counts()
    held = price(legs="NVDA,AVGO,CRWV", weighting="cap", method="hold").json()["data"]
    monthly = price(legs="NVDA,AVGO,CRWV", weighting="cap", method="monthly").json()["data"]
    months = sorted({d[:7] for d in SESSIONS[120:]})
    assert held["rebalances"] == 1 and monthly["rebalances"] == len(months)  # the start, then each later month's first session
    assert monthly["total_return"] == pytest.approx(held["total_return"], rel=1e-10)


def test_a_name_without_a_stored_count_is_refused_naming_it(served_counts):
    served_counts()
    r = price(legs="NVDA,NBIS,AVGO,SMH", weighting="cap")
    body = dc.check_response("/basket/price", r)
    assert r.status_code == 422 and body["error"]["code"] == "unsupported"
    assert body["error"]["message"] == ("Cap weight needs a stored share count for every name: NBIS, SMH have none. "
                                        "The full refresh stores counts for the preset baskets' names.")


@pytest.mark.parametrize("q, words", [
    ({"legs": "NVDA:50,AVGO:50", "weighting": "cap"}, "give the leg 'NVDA:50' as its ticker alone"),
    ({"legs": "NVDA,AVGO", "weighting": "equal"}, "The weighting 'equal' is not target or cap."),
    ({"legs": "NVDA,AVGO"}, "has no weight"),
    ({"weighting": "cap"}, "A cap-weighted basket needs its legs"),
    ({"legs": "NVDA,NVDA", "weighting": "cap"}, "twice"),
])
def test_a_cap_request_that_cannot_be_priced_is_422_naming_what(served_counts, q, words):
    served_counts()
    r = price(**q)
    assert r.status_code == 422 and words in dc.check_response("/basket/price", r)["error"]["message"]


def test_an_old_database_without_the_table_serves_and_says_cap_weight_awaits_the_refresh(served_counts):
    """A file the share-count step has not reached: /basket/shares and a cap request answer awaiting with the
    reason; the basket at its own weights is priced as before."""
    served_counts(table=False)
    r = client.get("/api/desk/basket/shares")
    body = dc.check_response("/basket/shares", r)
    assert r.status_code == 200 and body["status"] == "awaiting" and body["unavailable"] == {
        "reason": "Awaiting refresh: share counts are not stored in this database yet; the next full refresh reads them from Yahoo.",
        "until": None}
    r = price(legs="NVDA,AVGO", weighting="cap")
    body = dc.check_response("/basket/price", r)
    assert body["status"] == "awaiting" and body["unavailable"]["reason"] == (
        "Awaiting refresh: cap weight reads stored share counts, and share counts are not stored in this database yet; "
        "the next full refresh reads them from Yahoo.")
    assert hedge(legs="NVDA,AVGO", weighting="cap").json()["status"] == "awaiting"
    ready = price(legs="NVDA:50,AVGO:50")
    assert dc.check_response("/basket/price", ready)["status"] == "ready" and ready.json()["data"]["weighting"] == "target"


def test_an_empty_table_awaits_too(served_counts):
    served_counts(rows={})
    body = client.get("/api/desk/basket/shares").json()
    assert body["status"] == "awaiting" and body["unavailable"]["reason"] == (
        "Awaiting refresh: no share count is stored yet; the next full refresh reads them from Yahoo.")


def test_basket_shares_lists_the_stored_counts_and_sets_a_bad_row_aside(served_counts):
    """Each row is read on its own: a count that is not positive, a read date after today, a malformed date and
    a row with no source are set aside with why, and every other count stands."""
    served_counts(extra=[("ZERO", 0, "2026-09-24", "yfinance"), ("LATE", 1e9, "2099-01-01", "yfinance"),
                         ("BADD", 1e9, "Sep 24", "yfinance"), ("NOSRC", 1e9, "2026-09-23", "")])
    r = client.get("/api/desk/basket/shares")
    d = dc.check_response("/basket/shares", r)["data"]
    assert d["provider"] == "Yahoo" and d["counts_as_of"] == "2026-09-24" and d["source"] == desk_basket.COUNTS_SOURCE
    assert d["counts"] == [{"symbol": s, "shares_outstanding": float(COUNTS[s]), "as_of": "2026-09-24", "source": "yfinance"}
                           for s in sorted(COUNTS)]
    assert {e["symbol"]: e["reason"] for e in d["excluded"]} == {
        "BADD": "set aside: its read date 'Sep 24' is not a YYYY-MM-DD date",
        "LATE": "set aside: its read date 2099-01-01 is after today (" + __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).astimezone(__import__("api.calendar", fromlist=["NY"]).NY).date().isoformat() + ")",
        "NOSRC": "set aside: it names no source",
        "ZERO": "set aside: its count 0.0 is not a positive number",
    }
    # A set-aside name is refused with why its stored count was set aside.
    r = price(legs="NVDA,ZERO,ORCL", weighting="cap")
    assert r.status_code == 422 and r.json()["error"]["message"] == (
        "Cap weight needs a stored share count for every name: ORCL has none. The full refresh stores counts for the "
        "preset baskets' names. ZERO's stored count is set aside: its count 0.0 is not a positive number.")
    assert client.get("/api/desk/basket/shares", params={"symbols": "NVDA"}).status_code == 422


def test_the_hedge_ranking_follows_the_chosen_weights():
    """X moves exactly with SMH and Y exactly with XLU, three times as volatile. At equal weight Y's swings
    dominate the basket and XLU fits it best; cap-weighted, X is 99% of the basket and SMH fits it best. The
    hedge ratio, the short and the stress follow the ranking."""
    from src.desk import basket as bk

    rng = np.random.default_rng(29)
    n = len(SESSIONS)
    rets = {sym: rng.normal(0, 0.01, n) for sym in desk_basket.HEDGE_ETFS}
    rets["XLU"] = rng.normal(0, 0.03, n)
    for r in rets.values():
        r[0] = 0.0

    def hist(r):
        px = tuple(50.0 * np.cumprod(1 + r))
        return bk.History(tuple(SESSIONS), px, tuple([1e9] * n), px)

    histories = {sym: hist(r) for sym, r in rets.items()}
    histories["X"], histories["Y"] = hist(rets["SMH"]), hist(rets["XLU"])
    equal = desk_basket.hedge_answer(histories, [("X", 50.0), ("Y", 50.0)], "hold", 1e6)
    counts = {"X": {"shares_outstanding": 1e10, "as_of": "2026-09-24", "source": "yfinance"},
              "Y": {"shares_outstanding": 1e8, "as_of": "2026-09-24", "source": "yfinance"}}
    cap = desk_basket.hedge_answer(histories, [("X", None), ("Y", None)], "hold", 1e6, counts=counts)
    assert equal["top"] == "XLU" and cap["top"] == "SMH"
    # At equal weight both names show (XLU first, SMH second); cap-weighted, Y's 1% leaves XLU with almost nothing.
    assert [e["symbol"] for e in equal["etfs"]][:2] == ["XLU", "SMH"]
    assert next(e for e in cap["etfs"] if e["symbol"] == "XLU")["r2_1y"] < 0.05
    top_cap = cap["etfs"][0]
    assert top_cap["r2_1y"] > 0.97 and top_cap["hedge_ratio"] == pytest.approx(0.99, abs=0.02)
    # Both start at 50: X's weight is 1e10 / (1e10 + 1e8).
    assert cap["cap_weights"]["legs"][0]["weight_start"] == pytest.approx(1e10 / 1.01e10) and equal["cap_weights"] is None
    assert all(s["hedge"] == "SMH" for s in cap["stress"]) and all(s["hedge"] == "XLU" for s in equal["stress"])


def test_a_table_whose_every_row_is_set_aside_awaits_and_says_so(served_counts):
    served_counts(rows={}, extra=[("ZERO", 0, "2026-09-24", "yfinance")])
    body = client.get("/api/desk/basket/shares").json()
    assert body["status"] == "awaiting" and body["unavailable"]["reason"] == (
        "Awaiting refresh: no stored share count can be read (each is set aside, with why); the next full refresh stores "
        "them again.")

