"""The Options Finder's route (api/desk_options.py, design F3; engine src/desk/options_finder.py, method finder-2).

Everything is synthetic and hermetic: the chains are tests/options_synth.py's invented ones, served by a fake
EODHD and a fake Finnhub at the HTTP transport (tests/options_route_fake.py), so every request runs through
the real clients, caches, concurrency slots, the chain scanner and the envelope. The clock is frozen at
Saturday 2026-10-24 14:00 UTC, so the newest completed session is Friday 2026-10-23, the session the
synthetic quotes describe. The store holds only the Treasury tenors, the event calendar and one market date.
"""

from __future__ import annotations

import asyncio
import json
import math
import threading
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, db, desk_options, security
from api import desk_envelope as env
from api import worker as worker_mod
from api.main import app
from api.providers import eodhd as eod
from api.providers import entitlements, market
from api.providers import finnhub as fh
from api.providers import finnhub_finder as ff
from api.providers.cache import TokenBucket
from src.desk import options_finder as of
from tests import desk_contract as dc
from tests import options_route_fake as fk
from tests import options_synth as syn

client = TestClient(app, raise_server_exceptions=False)
SYN_ROWS, TRUTH = syn.chain()
CHAIN = [fk.provider_row(r) for r in SYN_ROWS]
OCT21, OCT22, OCT23 = date(2026, 10, 21), date(2026, 10, 22), syn.SESSION
EARNINGS = {"SYN": [{"symbol": "SYN", "date": "2026-11-30", "hour": "amc", "quarter": 3, "year": 2026}]}
MACRO = [("CPI", "2026-11-12T13:30:00Z"), ("FOMC", "2026-12-09T19:00:00Z")]
UP = dict(symbol="SYN", view="up", target="120", by="2026-12-18", budget="5000", commission="0.65")
ITEM = [("desk_options_inputs", analytics_cache._desk_options_inputs)]


def closes(last: date = OCT23, values: dict | None = None, base: float = 95.0) -> dict[date, float]:
    """Daily closes from Oct 2024 through `last`: `base` everywhere, 100 at `last`, `values` over both."""
    out = {d: base for d in fk.sessions(date(2024, 10, 1), last)}
    out[last] = 100.0
    out.update(values or {})
    return out


def restamped(rows: list[dict], stamp: str) -> list[dict]:
    return [{**r, "attributes": {**r["attributes"], "bid_date": stamp, "ask_date": stamp}} for r in rows]


class World:
    """The fakes, the store and the worker for one test."""

    def __init__(self, tmp_path, monkeypatch, install_worker):
        self.tmp, self.mp, self.install = tmp_path, monkeypatch, install_worker
        self.fake = fk.FakeEodhd({"SYN": CHAIN}, {"SYN": closes()}, dividends={"SYN": syn.DIV_ROWS})
        self.fh = fk.FakeFinnhub(EARNINGS)
        monkeypatch.setattr(market, "_utcnow", lambda: fk.NOW)
        monkeypatch.setenv("FINNHUB_FINDER_API_KEY", "finder-key")
        monkeypatch.setenv("FINNHUB_API_KEY", "dashboard-key")
        monkeypatch.setattr(eod, "_bucket", TokenBucket(rate=1e6, burst=10**6))
        monkeypatch.setattr(market, "_client", eod.EodhdClient("tok", transport=httpx.MockTransport(self.fake), max_retries=0))
        monkeypatch.setattr(ff, "_transport", httpx.MockTransport(self.fh))
        monkeypatch.setattr(ff, "_finder_bucket", TokenBucket(rate=50 / 60, burst=10))
        monkeypatch.setattr(fh, "_client", fh.FinnhubClient("dashboard-key", transport=httpx.MockTransport(self.fh)))
        monkeypatch.setattr(fh, "_bucket", TokenBucket(rate=50 / 60, burst=10))
        entitlements.reset_for_tests()
        market.clear_caches()
        self.worker = None

    def serve(self, **store_kw) -> "World":
        path = fk.store(self.tmp / f"store{len(list(self.tmp.iterdir()))}.db", **{"macro": MACRO, **store_kw})
        self.mp.setattr(db, "DB_PATH", path)
        self.worker = self.install(worker_mod.AnalyticsWorker(items=ITEM, poll_s=0.05, preload=False))
        self.worker.start(serving=True)
        assert self.worker.wait_published(timeout=30)
        return self

    def get(self, **q) -> httpx.Response:
        return client.get("/api/desk/options/finder", params=q)

    def ok(self, **q) -> dict:
        r = self.get(**q)
        return dc.check_response("/options/finder", r)["data"]

    def refused(self, status: int, code: str, **q) -> str:
        r = self.get(**q)
        body = dc.check_response("/options/finder", r)
        assert r.status_code == status and body["error"]["code"] == code, (r.status_code, body["error"])
        return body["error"]["message"]


@pytest.fixture()
def world(tmp_path, monkeypatch, install_worker):
    w = World(tmp_path, monkeypatch, install_worker)
    yield w
    market.clear_caches()
    entitlements.reset_for_tests()


@pytest.fixture()
def served(world):
    return world.serve()


# ── the happy path ──────────────────────────────────────────────────────────

def test_a_view_is_answered_in_the_envelope_and_keeps_the_contract(served):
    d = served.ok(**UP)
    assert d["symbol"] == "SYN" and d["provider"] == "EODHD" and d["stale"] is None and d["empty"] is None
    assert d["scan"] == {"truncated": False, "complete_through": "2027-06-18", "requested_through": "2027-06-18",
                         "requests": d["scan"]["requests"], "queried": d["scan"]["queried"]}
    q = d["scan"]["queried"]
    assert q["type"] == "call" and q["exp_from"] == "2026-12-17" and q["exp_to"] == "2027-06-19"
    # the window queried is the union of the windows at the two newest closes (100 and 95), rounded outward
    lo = min(of.strike_bounds(of.Thesis("up", 120.0, date(2026, 12, 18), 5000.0), c)[0] for c in (100.0, 95.0))
    hi = max(of.strike_bounds(of.Thesis("up", 120.0, date(2026, 12, 18), 5000.0), c)[1] for c in (100.0, 95.0))
    assert (q["strike_from"], q["strike_to"]) == (math.floor(lo), math.ceil(hi))
    assert d["market_as_of"] == {"chain_session": "2026-10-23", "latest_quote": fk.STAMP, "underlying_close": 100.0,
                                 "underlying_close_date": "2026-10-23",
                                 "curve": [{"series": s, "date": "2026-10-23", "value": syn.CURVE_ROWS[s][0][1]}
                                           for s in ("DGS3MO", "DGS2", "DGS5")]}
    assert d["sources"] == ["EODHD options (end of day, 2026-10-23 close)", "EODHD daily bars",
                            "FRED DGS3MO, DGS2, DGS5 (2026-10-23, 2026-10-23, 2026-10-23)", "EODHD dividends",
                            "Finnhub earnings calendar", "Macro release calendar (stored through 2026-12-09)"]
    u = d["universe"]
    assert u["seen"] == u["passed"] + sum(u["dropped"].values()) + u["ranked_out"] and u["passed"] > 0
    assert all(d["picks"].values()) and not u["truncated"]
    assert "delayed_price" not in json.dumps(d)


def test_the_route_recovers_the_synthetic_forwards_and_prices_the_report(served):
    d = served.ok(**UP)
    market_carry = [c for c in d["carry"] if c["source"] == "market"]
    assert len(market_carry) == len(d["carry"]) == 7
    for c in market_carry:  # cent quotes around the lattice's values (tests/options_synth.py)
        assert abs(c["forward"] - TRUTH[date.fromisoformat(c["exp"])]) < 0.011 * syn.S0
    (move,) = d["earnings_moves"]
    assert move["date"] == "2026-11-30" and move["expiries"] == ["2026-12-18", "2027-01-15"]
    assert move["reason"] is None and move["move_sd_pct"] > 0
    kinds = [(e["kind"], e["name"]) for e in d["events"]]
    assert ("macro", "CPI") in kinds and ("earnings", "SYN earnings (Q3 2026)") in kinds
    assert d["coverage"][0] == "Earnings dates are from Finnhub's calendar through Nov 27, 2027."


def test_a_repeated_view_spends_no_provider_request(served):
    first = served.ok(**UP)
    calls, fh_calls = len(served.fake.calls), len(served.fh.calls)
    again = served.ok(**UP)
    assert len(served.fake.calls) == calls and len(served.fh.calls) == fh_calls
    assert again["scan"]["requests"] == 0 and first["scan"]["requests"] > 0
    assert again["rows"] == first["rows"]


@pytest.mark.parametrize("order", [("121", "121.0001"), ("121.0001", "121")])
def test_two_windows_a_fraction_of_a_dollar_apart_read_the_same_rows(served, order):
    a = served.ok(**{**UP, "target": order[0]})
    b = served.ok(**{**UP, "target": order[1]})
    assert a["scan"]["queried"] == b["scan"]["queried"] and b["scan"]["requests"] == 0
    assert a["universe"]["seen"] == b["universe"]["seen"]


def test_the_engine_row_adapter_is_the_lens_chains_mapping_plus_the_stamps(served):
    lens = market.options_chain("SYN", expiration="2026-12-18", type_="call", strike_from=100.0, strike_to=100.0,
                                page=0, limit=10)["contracts"]
    (raw,) = [r["attributes"] for r in CHAIN if r["attributes"]["exp_date"] == "2026-12-18"
              and r["attributes"]["type"] == "call" and r["attributes"]["strike"] == 100.0]
    row = market.finder_row(raw, fk.NOW)
    assert lens and all(row[k] == v for k, v in lens[0].items())
    assert set(row) - set(lens[0]) == {"bid_date", "ask_date", "bid_session", "ask_session"}
    assert row["bid_session"] == row["ask_session"] == "2026-10-23" and row["implied_vol"] == raw["volatility"]


# ── parameters: refused before any provider request (section 1, DR-14/DR-15) ─

@pytest.mark.parametrize("over, words", [
    ({"target": "0"}, "target is not a price"),
    ({"target": "-5"}, "target is not a price"),
    ({"target": "nan"}, "target is not a finite number"),
    ({"target": "inf"}, "target is not a finite number"),
    ({"target": "abc"}, "target is not a number"),
    ({"budget": "0"}, "budget is not between"),
    ({"budget": "1e12"}, "budget is not between"),
    ({"by": "2026-13-01"}, "not a YYYY-MM-DD date"),
    ({"by": "26-12-18"}, "not a YYYY-MM-DD date"),
    ({"by": "1999-12-31"}, "more than three years ahead"),
    ({"by": "2030-01-02"}, "more than three years ahead"),
    ({"by": "2028-01-03"}, "known through Dec 31, 2027"),
    ({"view": "sideways"}, "is not up or down"),
    ({"fill": "bid"}, "is not ask or mid"),
    ({"min_oi": "1.5"}, "not a whole number"),
    ({"min_oi": "2000000"}, "minimum open interest"),
    ({"max_spread": "0"}, "widest spread"),
    ({"scan_months": "13"}, "scan window"),
    ({"commission": "-1"}, "commission"),
    ({"symbol": "VOD.LSE"}, "US-listed stocks and ETFs only"),
    ({"strike": "100"}, "There is no strike parameter"),
])
def test_a_bad_parameter_is_unsupported_and_costs_nothing(served, over, words):
    assert desk_options.calendar_through() == date(2027, 12, 31)  # api/calendar's holidays run through 2027
    msg = served.refused(422, "unsupported", **{**UP, **over})
    assert words in msg, msg
    assert served.fake.calls == [] and served.fh.calls == []


def test_missing_and_repeated_parameters_name_themselves(served):
    r = client.get("/api/desk/options/finder", params=[("symbol", "SYN"), ("view", "up")])
    assert r.status_code == 422 and "needs target, by, budget" in r.json()["error"]["message"]
    r = client.get("/api/desk/options/finder", params=[*UP.items(), ("budget", "10")])
    assert r.status_code == 422 and "budget parameter is given more than once" in r.json()["error"]["message"]
    assert served.fake.calls == []


def test_a_wrong_side_target_is_the_engines_refusal_before_any_earnings_request(served):
    msg = served.refused(422, "unsupported", **{**UP, "target": "90"})
    assert msg == "A view up needs a target above the Oct 23, 2026 close of $100.00."
    assert served.fh.calls == [] and served.fake.contracts_calls()  # the scan ran; the earnings request did not


def test_a_date_on_or_before_the_session_is_the_engines_refusal(served):
    msg = served.refused(422, "unsupported", **{**UP, "by": "2026-10-23"})
    assert "must be after 2026-10-23" in msg


# ── the chain scanner (section 3) ───────────────────────────────────────────

def _window(lo: date, hi: date, k_lo: int = 79, k_hi: int = 156) -> dict:
    return market.options_window("SYN", "call", lo, hi, k_lo, k_hi)


def _contracts(w: dict) -> set[str]:
    return {r["contract"] for r in w["rows"]}


def test_a_page_boundary_inside_an_expiry_is_filled_under_either_inclusivity(world):
    whole = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert not whole["truncated"] and whole["requests"] == 1
    for inclusive in (True, False):
        market.clear_caches()
        world.fake.inclusive, world.fake.page_cap = inclusive, 40
        w = _window(date(2026, 12, 17), date(2027, 1, 16))
        assert _contracts(w) == _contracts(whole) and not w["truncated"] and w["complete_through"] == "2027-01-15"
        asked = world.fake.contracts_calls()[-w["requests"]:]
        assert [("filter[exp_date_eq]" in p) for p in asked] == [False, True, False]
        assert asked[1]["filter[exp_date_eq]"] == "2027-01-15" and asked[2]["filter[exp_date_from]"] == "2027-01-15"


def test_an_expiry_longer_than_a_page_is_dropped_and_said(world):
    world.fake.page_cap = 20  # fewer than one expiry's calls in the window: the fill has a next link
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["truncated"] and w["rows"] == [] and w["complete_through"] is None and w["requests"] == 2


def test_the_budget_of_eight_requests_ends_the_scan_and_keeps_only_whole_expiries(world):
    whole = _window(date(2026, 12, 17), date(2027, 12, 18))
    market.clear_caches()
    world.fake.page_cap = 40  # each expiry needs a seek page and a fill: nine expiries do not fit in eight requests
    w = _window(date(2026, 12, 17), date(2027, 12, 18))
    assert w["truncated"] and w["requests"] == market.WINDOW_REQUESTS
    through = w["complete_through"]
    assert through is not None and "2026-12-18" <= through < "2027-12-17"
    assert _contracts(w) == {r["contract"] for r in whole["rows"] if r["exp_date"] <= through}


def test_an_empty_fill_contradicts_the_page_and_drops_its_expiry(world):
    """DR-18: a seek page ends inside L with a next link, and the exact-expiry query for L answers no rows."""
    world.fake.page_cap, world.fake.empty_fill = 40, True
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["truncated"] and w["complete_through"] == "2026-12-18"
    assert {r["exp_date"] for r in w["rows"]} == {"2026-12-18"}


def test_a_truncated_scan_reaches_the_answer(world):
    world.fake.page_cap = 30  # Feb 19 has 31 calls in the window: its fill has a next link, and the scan stops there
    d = world.serve().ok(**UP)
    s = d["scan"]
    assert s["truncated"] and d["universe"]["truncated"] and s["complete_through"] == "2027-01-15"
    assert {r["exp"] for r in d["rows"]} <= {"2026-12-18", "2027-01-15"} and d["rows"]


def test_a_truncated_scan_with_no_whole_expiry_says_so(world):
    world.fake.page_cap = 20
    d = world.serve().ok(**UP)
    assert d["scan"]["truncated"] and d["scan"]["complete_through"] is None and d["rows"] == []
    assert d["empty"].startswith("The provider's list for this window was longer than the Finder could read")
    assert d["market_as_of"]["chain_session"] is None and d["sources"][0] == "EODHD options (no quote session)"


def test_the_window_cache_is_per_session_and_asks_again_only_for_an_old_chain(world):
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(OCT22))
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["requests"] == 1
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["requests"] == 0  # younger than 900 s
    _age_all()
    world.fake.chains["SYN"] = CHAIN
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["requests"] == 1 and w["chain_session"] == "2026-10-23"  # the Oct 22 chain was asked again
    _age_all()
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["requests"] == 0  # the session's own chain stands


def _age_all(seconds: float = 1000.0) -> None:
    for k, (t, v) in list(market._window_cache._data.items()):
        market._window_cache._data[k] = (t - seconds, v)


def test_an_empty_friday_evening_window_is_asked_again_after_the_publication(world, monkeypatch):
    friday_evening = datetime(2026, 10, 23, 22, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(market, "_utcnow", lambda: friday_evening)
    world.fake.chains["SYN"] = []
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["rows"] == [] and w["chain_session"] is None
    monkeypatch.setattr(market, "_utcnow", lambda: fk.NOW)  # Saturday: the same session key, now published
    world.fake.chains["SYN"] = CHAIN
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["requests"] == 0  # still younger than 900 s
    _age_all()
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["requests"] == 1 and w["chain_session"] == "2026-10-23" and w["rows"]


def test_a_holiday_overnight_asks_again_for_the_day_before(world, monkeypatch):
    thanksgiving = datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc)  # closed: the newest session is Nov 25
    monkeypatch.setattr(market, "_utcnow", lambda: thanksgiving)
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(date(2026, 11, 24)))
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["chain_session"] == "2026-11-24"
    _age_all()
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(date(2026, 11, 25)))
    w = _window(date(2026, 12, 17), date(2027, 1, 16))
    assert w["requests"] == 1 and w["chain_session"] == "2026-11-25"
    _age_all()
    assert _window(date(2026, 12, 17), date(2027, 1, 16))["requests"] == 0


# ── the session the quotes describe (sections 2 and 6) ──────────────────────

def test_a_chain_one_session_behind_is_priced_with_the_warning(world):
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(OCT22))
    world.fake.closes["SYN"] = closes(values={OCT22: 100.0, OCT23: 100.5})
    curve = {s: [("2026-10-22", v), ("2026-10-23", v)] for s, ((_, v),) in syn.CURVE_ROWS.items()}
    d = world.serve(curve=curve).ok(**UP)
    assert d["stale"] == "These quotes are from the Oct 22, 2026 close; the Oct 23, 2026 session's quotes are not in yet."
    assert d["market_as_of"]["chain_session"] == "2026-10-22" and d["market_as_of"]["underlying_close"] == 100.0


def test_a_chain_two_sessions_behind_is_the_engines_stale_refusal(world):
    """DR-23: the engine's own FinderError(kind="stale") answers 503 stale_chain."""
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(OCT21))
    world.fake.closes["SYN"] = closes(values={OCT21: 100.0, OCT22: 100.0})
    msg = world.serve().refused(503, "stale_chain", **UP)
    assert "2 sessions behind" in msg and world.fh.calls == []


def test_an_old_chain_far_from_the_close_is_read_once_more_at_its_own_close(world):
    """DR-03: C two sessions back with its close far from P1/P2: one reconciliation query at S0's window."""
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(OCT21))
    world.fake.closes["SYN"] = closes(values={OCT21: 100.0, OCT22: 130.0, OCT23: 131.0})
    world.serve().refused(503, "stale_chain", **{**UP, "target": "150"})
    windows = [(p["filter[strike_from]"], p["filter[strike_to]"]) for p in world.fake.contracts_calls()
               if p.get("filter[type]") == "call" and "filter[exp_date_from]" in p]
    t = of.Thesis("up", 150.0, date(2026, 12, 18), 5000.0)
    lo, hi = of.strike_bounds(t, 100.0)
    assert len(set(windows)) == 2 and windows[-1] == (str(float(math.floor(lo))), str(float(math.ceil(hi))))


def test_quotes_that_move_session_between_the_two_queries_are_retryable(world):
    world.fake.chains["SYN"] = restamped(CHAIN, fk.stamp_for(OCT21))
    world.fake.closes["SYN"] = closes(values={OCT21: 100.0, OCT22: 130.0, OCT23: 131.0})

    def publish(n_before: int) -> None:
        if n_before == 2:  # after the first window scan, the provider's quotes move to Oct 23
            world.fake.chains["SYN"] = CHAIN

    world.fake.before_contracts = publish
    msg = world.serve().refused(503, "session_moved", **{**UP, "target": "150"})
    assert msg.startswith("The provider's quotes moved to a new session")


def test_a_close_not_served_for_the_quotes_session_is_retryable(world):
    world.fake.closes["SYN"] = closes(last=OCT22)
    assert "2026-10-23 is not served yet" in world.serve().refused(503, "close_missing", **UP)


def test_stamps_that_name_no_session_are_refused(world):
    world.fake.chains["SYN"] = restamped(CHAIN, "not a stamp")
    assert world.serve().refused(503, "no_session", **UP) == "The quotes' session could not be read from their stamps."


def test_a_close_outside_the_engines_range_is_a_bad_market_input(world):
    world.fake.closes["SYN"] = closes(values={OCT23: 2_000_000.0})
    msg = world.serve().refused(502, "bad_market_input", **{**UP, "target": "2100000"})
    assert "the 2026-10-23 close" in msg and world.fake.contracts_calls() == []


# ── empty answers (section 2 step 5) ────────────────────────────────────────

def test_no_calls_in_the_strike_window_is_an_empty_answer_on_the_quotes_session(world):
    low = [r for r in CHAIN if r["attributes"]["strike"] <= 70]
    world.fake.chains["SYN"] = low
    d = world.serve().ok(**UP)
    assert d["rows"] == [] and d["empty"].startswith("No listed calls in the window")
    assert d["market_as_of"]["chain_session"] == "2026-10-23"
    assert d["sources"][0] == "EODHD options (end of day, 2026-10-23 close)"
    probes = [p for p in world.fake.contracts_calls() if p.get("fields[options-contracts]") == "exp_date,bid_date,ask_date"]
    assert len(probes) == 1 and "filter[strike_from]" not in probes[0]


def test_no_calls_expiring_in_the_window_is_an_empty_answer_with_no_quote_session(world):
    world.fake.chains["SYN"] = [r for r in CHAIN if r["attributes"]["exp_date"] == "2026-11-20"]
    d = world.serve().ok(**UP)
    assert d["rows"] == [] and d["empty"].startswith("No listed calls in the window")
    assert d["market_as_of"]["chain_session"] is None and d["sources"][0] == "EODHD options (no quote session)"


def test_a_symbol_with_no_listed_options_is_empty(world):
    world.fake.chains["SYN"] = []
    r = world.serve().get(**UP)
    assert r.status_code == 404 and r.json()["error"]["code"] == "empty"


# ── provider refusals (section 6) ───────────────────────────────────────────

def test_an_unknown_symbol_is_404(served):
    served.refused(404, "unknown_symbol", **{**UP, "symbol": "ZZZZ"})


def test_options_outside_the_plan_are_403(served):
    served.fake.fail["/api/mp/"] = 403
    served.refused(403, "unauthorized", **UP)


def test_a_provider_server_error_keeps_its_kind(served):
    served.fake.fail["/api/mp/"] = 500
    r = served.get(**UP)
    assert r.status_code == 502 and r.json()["error"]["code"] == "unavailable"


def test_a_full_provider_slot_pool_is_an_enveloped_rate_limit(served, monkeypatch):
    slots = threading.BoundedSemaphore(1)
    slots.acquire()
    monkeypatch.setattr(market, "_slots", slots)
    served.refused(429, "rate_limited", **UP)


def test_the_route_waits_with_the_provider_calls_at_the_middleware():
    assert security.DESK_OPTIONS_PATH == "/api/desk/options/finder"

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, provider_slots=1, per_client_per_min=1000, per_client_burst=1000,
                                     global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    def ask() -> tuple[int, bytes]:
        sent.clear()
        scope = {"type": "http", "path": "/api/desk/options/finder", "method": "GET", "headers": [],
                 "client": ("1.2.3.4", 1), "query_string": b"symbol=SYN"}
        asyncio.run(mw(scope, receive, send))
        return sent[0]["status"], sent[-1].get("body", b"")

    assert mw.provider.acquire(blocking=False)
    try:
        status, body = ask()
        assert status == 429 and json.loads(body) == {"detail": "The service is busy; retry in a moment."}
    finally:
        mw.provider.release()
    assert ask()[0] == 200


def test_another_run_holding_the_lock_is_busy(served, monkeypatch):
    monkeypatch.setattr(desk_options, "LOCK_TIMEOUT_S", 0.05)
    assert desk_options._lock.acquire(timeout=1)
    try:
        assert served.refused(503, "busy", **UP) == "Another options scan is being priced; retry in a moment."
    finally:
        desk_options._lock.release()
    served.ok(**UP)


def test_before_the_first_generation_the_answer_is_computing(world, install_worker, monkeypatch):
    gate = threading.Event()

    def slow(ctx):
        gate.wait(10)
        return desk_options.desk_options_inputs(ctx)

    monkeypatch.setattr(db, "DB_PATH", fk.store(world.tmp / "slow.db"))
    w = install_worker(worker_mod.AnalyticsWorker(items=[("desk_options_inputs", slow)], poll_s=0.05, wait_s=0.1,
                                                  preload=False))
    w.start(serving=True)
    try:
        r = world.get(**UP)
        assert r.status_code == 202 and dc.check_response("/options/finder", r)["status"] == "computing"
        assert world.fake.calls == []
    finally:
        gate.set()


# ── the stored inputs (section 4) ───────────────────────────────────────────

@pytest.mark.parametrize("missing", ["DGS3MO", "DGS2", "DGS5"])
def test_a_tenor_not_stored_answers_awaiting_and_names_it(world, missing):
    curve = {s: rows for s, rows in syn.CURVE_ROWS.items() if s != missing}
    r = world.serve(curve=curve).get(**UP)
    body = dc.check_response("/options/finder", r)
    assert body["status"] == "awaiting" and r.status_code == 200
    assert body["unavailable"]["reason"] == ("Awaiting refresh: the Options Finder discounts on the Treasury curve "
                                             f"(FRED DGS3MO, DGS2 and DGS5); this database does not store {missing} yet.")
    assert world.fake.calls == []


def test_the_item_never_raises_and_a_generation_still_publishes(world, tmp_path, monkeypatch):
    for kw in ({"tables": False}, {"curve": {}}):
        p = fk.store(tmp_path / f"item{len(list(tmp_path.iterdir()))}.db", **kw)
        monkeypatch.setattr(db, "DB_PATH", p)
        got = desk_options.desk_options_inputs({})
        assert got == {"stored": False, "missing": ["DGS3MO", "DGS2", "DGS5"],
                       "reason": "this database does not store DGS3MO, DGS2, DGS5 yet"}
    garbage = tmp_path / "garbage.db"
    garbage.write_bytes(b"not a database at all" * 100)
    monkeypatch.setattr(db, "DB_PATH", garbage)
    assert desk_options.desk_options_inputs({}) == {"stored": False, "missing": ["DGS3MO", "DGS2", "DGS5"],
                                                    "reason": desk_options.ITEM_REASON}
    world.serve(tables=False)
    assert world.worker.current.results["desk_options_inputs"]["stored"] is False and not world.worker.current.errors


def test_the_item_keeps_the_newest_fifteen_rows_and_every_macro_row_from_a_month_back(world, tmp_path, monkeypatch):
    """DR-25: no upper cutoff, so macro_through is the newest row supplied (415 days after the newest market date)."""
    curve = {s: [((OCT23 - timedelta(days=i)).isoformat(), 4.0 + i / 100) for i in range(20)] for s in syn.CURVE_ROWS}
    p = fk.store(tmp_path / "item.db", curve=curve,
                 macro=[("Old", "2026-09-01T12:30:00Z"), ("CPI", "2026-11-12T13:30:00Z"), ("Far", "2027-12-12T13:30:00Z")],
                 earnings=[("SYN", "2026-11-30T21:30:00Z", "SYN earnings (Q3 2026)")])
    monkeypatch.setattr(db, "DB_PATH", p)
    got = desk_options.desk_options_inputs({})
    assert got["stored"] and all(len(v) == 15 and v[0][0] == "2026-10-23" for v in got["curve"].values())
    assert [m["name"] for m in got["macro"]] == ["CPI", "Far"] and got["macro_through"] == "2027-12-12"
    assert got["earnings"] == [{"symbol": "SYN", "at": "2026-11-30T21:30:00Z", "name": "SYN earnings (Q3 2026)"}]
    assert got["earnings_symbols"] == ["SYN"]


def test_only_events_up_to_the_last_expiry_reach_the_engine(world):
    """DR-26: 100 releases after a short scan's last expiry do not count against the engine's cap of 100."""
    later = [(f"Release {i}", f"2027-{3 + i // 28:02d}-{1 + i % 28:02d}T12:30:00Z") for i in range(100)]
    d = world.serve(macro=[("CPI", "2026-11-12T13:30:00Z"), *later]).ok(**{**UP, "scan_months": "1"})
    assert [e["name"] for e in d["events"] if e["kind"] == "macro"] == ["CPI"]
    assert d["coverage"][1] == "The macro calendar is stored through Jun 16, 2027; later events are not listed."


def test_more_than_a_hundred_events_inside_the_window_are_the_engines_refusal(world):
    inside = [(f"Release {i}", f"2026-11-{2 + i % 27:02d}T{12 + i // 27:02d}:30:00Z") for i in range(101)]
    msg = world.serve(macro=inside).refused(422, "unsupported", **{**UP, "scan_months": "1"})
    assert msg == "Too many events to read at once."


# ── the calendar's end (section 2b, DR-22) ──────────────────────────────────

@pytest.mark.parametrize("inclusive", [True, False])
def test_an_expiry_on_the_calendars_last_day_is_read_under_either_inclusivity(world, inclusive):
    assert desk_options.calendar_through() == date(2027, 12, 31)
    last = date(2027, 12, 31)
    rows, _ = syn.build(syn.S0, syn.Q_TRUE, syn.DIV_ROWS, [last], [100.0 + 5 * i for i in range(8)], "SYN")
    later = [{**r, "contract": r["contract"].replace("271231", "280121"), "exp_date": "2028-01-21"} for r in rows]
    world.fake.chains["SYN"] = [fk.provider_row(r) for r in rows + later]
    world.fake.inclusive = inclusive
    d = world.serve().ok(**{**UP, "target": "150", "by": "2027-12-31", "scan_months": "1"})
    assert {r["exp"] for r in d["rows"]} == {"2027-12-31"} and d["universe"]["seen"] > 0
    assert d["scan"]["complete_through"] == "2027-12-31" and d["scan"]["requested_through"] == "2028-01-31"
    assert d["scan"]["queried"]["exp_to"] == "2028-01-01"
    assert "Expiries after Dec 31, 2027 were not read: the market calendar the Finder uses ends there." in d["method"]["notes"]


def test_a_window_reaching_past_the_calendar_is_clipped_and_said(served):
    d = served.ok(**{**UP, "by": "2027-12-17", "target": "130"})
    assert d["scan"]["complete_through"] == "2027-12-31" and d["scan"]["requested_through"] == "2028-06-17"
    assert d["scan"]["queried"]["exp_to"] == "2028-01-01"


# ── dividends, earnings and their sources (section 2b, DR-19, DR-20, DR-27) ─

def test_dividends_unavailable_are_named_in_the_coverage_never_as_a_source(served):
    served.fake.fail["/api/div/"] = 403
    d = served.ok(**UP)
    assert "EODHD dividends" not in d["sources"] and "Dividend data unavailable." in d["coverage"]
    assert d["dividends"] == []


def test_a_name_with_no_report_in_the_horizon_says_so(served):
    served.fh.items = {}
    d = served.ok(**UP)
    assert d["coverage"][0] == "No earnings date found for SYN in Finnhub's calendar through Nov 27, 2027."
    assert "Finnhub earnings calendar" in d["sources"] and d["earnings_moves"] == []


def test_a_failed_calendar_read_falls_back_to_the_stored_rows_with_no_horizon(world):
    world.fh.status = 401
    d = world.serve(earnings=[("SYN", "2026-11-30T21:30:00Z", "SYN earnings (Q3 2026)")]).ok(**UP)
    assert d["coverage"][0] == ("Finnhub's calendar could not be read now: the earnings dates listed are stored "
                                "ones, and when they were last checked is not recorded.")
    assert "Finnhub earnings calendar (stored rows)" in d["sources"]
    (ev,) = [e for e in d["events"] if e["kind"] == "earnings"]
    assert ev["date"] == "2026-11-30" and ev["timing"] == "amc" and ev["source"] == "finnhub_earnings (stored)"


def test_a_failed_calendar_read_without_stored_rows_is_unavailable(world):
    world.fh.status = 401
    d = world.serve().ok(**UP)
    assert d["coverage"][0] == "Earnings dates could not be read." and not any("Finnhub" in s for s in d["sources"])


def test_a_short_scan_and_a_long_scan_read_the_same_earnings_horizon(served):
    """DR-20: the horizon is fixed (C to C + 400 days), so one cached read serves both."""
    short = served.ok(**{**UP, "scan_months": "1"})
    long = served.ok(**{**UP, "scan_months": "4"})
    assert len(served.fh.calls) == 1
    assert short["coverage"][0] == long["coverage"][0] == "Earnings dates are from Finnhub's calendar through Nov 27, 2027."
    ev = lambda d: [e for e in d["events"] if e["kind"] == "earnings"]  # noqa: E731
    assert ev(short) == ev(long)


def test_an_exclusive_provider_still_gives_both_event_expiries(world):
    """DR-21: E1 and E2 are consecutive listed expiries; the padded range reads both under an exclusive filter."""
    world.fake.inclusive = False
    d = world.serve().ok(**UP)
    (move,) = d["earnings_moves"]
    assert move["expiries"] == ["2026-12-18", "2027-01-15"] and move["move_sd_pct"] > 0


# ── the Finder shares no Finnhub capacity with the dashboard (DR-28, DR-29) ─

def test_the_finders_earnings_read_takes_only_its_own_bucket(world, monkeypatch):
    monkeypatch.setattr(fh, "_bucket", TokenBucket(rate=0.0, burst=2))  # exactly one fundamentals pair
    got = ff.earnings("SYN", OCT23)
    assert got["items"] and world.fh.calls[-1][2] == "finder-key" and fh._bucket.available(2)
    fields = fh.fundamentals("SYN")
    assert fields["market_cap"] == 1000.0 * 1e6 and not fh._bucket.available(1)
    assert [c[2] for c in world.fh.calls] == ["finder-key", "dashboard-key", "dashboard-key"]


@pytest.mark.parametrize("finder_key", [None, "dashboard-key"])
def test_without_its_own_key_the_finder_sends_no_finnhub_request(world, monkeypatch, finder_key):
    if finder_key is None:
        monkeypatch.delenv("FINNHUB_FINDER_API_KEY")
    else:
        monkeypatch.setenv("FINNHUB_FINDER_API_KEY", finder_key)
    monkeypatch.setattr(fh, "_bucket", TokenBucket(rate=0.0, burst=2))
    d = world.serve().ok(**UP)
    assert world.fh.calls == [] and fh._bucket.available(2)
    assert ff.NOT_CONFIGURED in d["method"]["notes"] and d["coverage"][0] == "Earnings dates could not be read."


def test_an_empty_finder_bucket_sends_nothing_and_uses_the_stored_rows(world, monkeypatch):
    monkeypatch.setattr(ff, "_finder_bucket", TokenBucket(rate=0.0, burst=0))
    d = world.serve(earnings=[("SYN", "2026-11-30T21:30:00Z", "SYN earnings (Q3 2026)")]).ok(**UP)
    assert world.fh.calls == [] and d["coverage"][0].startswith("Finnhub's calendar could not be read now")


def test_the_finder_never_reads_a_profile_and_a_dashboard_profile_after_it_is_whole(world, monkeypatch):
    monkeypatch.setattr(fh, "_bucket", TokenBucket(rate=0.0, burst=2))
    spied: list[str] = []
    real = {"profile": market.profile, "_fundamentals": market._fundamentals, "fundamentals": fh.fundamentals}

    def spy(name):
        def f(*a, **k):
            spied.append(name)
            return real[name](*a, **k)
        return f

    monkeypatch.setattr(market, "profile", spy("profile"))
    monkeypatch.setattr(market, "_fundamentals", spy("_fundamentals"))
    monkeypatch.setattr(fh, "fundamentals", spy("fundamentals"))
    world.serve().ok(**{**UP})
    assert spied == [] and fh._bucket.available(2)
    p = market.profile("MSFT")
    assert p["fundamentals_status"] == "ok" and p["market_cap"] == 1000.0 * 1e6 and p["year_high"] == 2.0
    assert spied == ["profile", "_fundamentals", "fundamentals"]


# ── C1: the dashboard's own reads are unchanged ─────────────────────────────

def test_the_lens_chain_and_expiry_list_read_the_same_before_and_after_a_finder_run(served):
    def lens() -> tuple[dict, dict]:
        chain = client.get("/api/market/options/SYN", params={"expiration": "2026-12-18"}).json()
        exps = client.get("/api/market/options/SYN/expirations").json()
        for d in (chain, exps):
            d.pop("fetched_at", None)
        return chain, exps

    before = lens()
    lens_keys = set(market._chain_cache._data)
    market.clear_caches()
    served.ok(**UP)
    assert set(market._chain_cache._data) == set()  # the Finder never writes the lens chain's cache
    assert lens() == before and set(market._chain_cache._data) == lens_keys


def test_the_live_route_count_is_fifteen_and_the_web_mirror_agrees():
    assert env.LIVE_ROUTES == 15 and env.ENVELOPED_ROUTES[env.LIVE_ROUTES - 1] == "/options/finder"
    assert "/options/finder" in dc.ROUTES and env.route_of("/options/finder") == "/options/finder"


# ── share classes (Codex S-1) ───────────────────────────────────────────────

def test_the_occ_root_keeps_a_share_class():
    assert desk_options.occ_root("BRK.B") == "BRKB" and desk_options.occ_root("AAPL") == "AAPL"
    assert of.standard_symbol("BRKB261218C00500000", desk_options.occ_root("BRK.B"), date(2026, 12, 18), "call", 500.0)


def test_a_share_class_listing_keeps_its_standard_contracts_and_asks_finnhub_nothing(world):
    """BRK.B: EODHD's underlying is BRK-B and the OCC root BRKB; dropping the class would screen every
    standard contract out as nonstandard, and Finnhub's spelling of the class is not verified."""
    brk = [fk.provider_row({**r, "contract": "BRKB" + r["contract"][len("SYN"):]}, root="BRK-B") for r in SYN_ROWS]
    world.fake.chains["BRK-B"] = brk
    world.fake.closes["BRK-B"] = closes()
    world.fake.dividends["BRK-B"] = syn.DIV_ROWS
    world.serve()
    syn_d = world.ok(**UP)
    d = world.ok(**{**UP, "symbol": "BRK.B"})
    assert d["symbol"] == "BRK.B"
    assert d["universe"]["dropped"].get("nonstandard", 0) == 0
    assert d["universe"]["passed"] == syn_d["universe"]["passed"] > 0 and all(d["picks"].values())
    assert d["coverage"][0] == "Earnings dates are not checked for share-class listings such as BRK.B."
    assert "Finnhub earnings calendar" not in d["sources"]
    assert [p for p, q, _ in world.fh.calls if q.get("symbol") not in (None, "SYN")] == []
