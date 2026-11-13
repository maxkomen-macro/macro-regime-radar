"""Basket & Hedge's cold-cache burst (the Nov 10 busy diagnosis, option C).

The page asks /basket/price and /basket/hedge together and /basket/study only once the price has answered for the
same basket (web/src/screens/desk/basket/study.ts `studyReleased`). Each route fetches its names FETCH_WORKERS at a
time, and the provider layer refuses a call that finds no free slot (api/providers/market.py `_with_slot`, a
non-blocking acquire). These tests hold that ordering to the provider ceiling with a fake slow EODHD client serving
invented closes (no provider call, no market data): the three routes' fetches launched together are refused as busy,
and price with hedge, then the study, never are. The ceiling and the routes are unchanged; only the order is.
"""

from __future__ import annotations

import datetime as dt
import threading

import pytest

from api import desk_basket as db
from api import desk_envelope as env
from api.providers import entitlements, market

NAMES = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ"]


class SlowFake:
    """An EODHD client whose every call waits for `gate` (or `hold_s`), serving an invented, steadily rising close."""

    def __init__(self, hold_s: float):
        self.hold_s = hold_s
        self.gate = threading.Event()
        self.lock = threading.Lock()
        self.inflight = 0
        self.peak = 0
        self.calls = 0

    def eod(self, sym, *, from_=None, to=None, period="d"):
        with self.lock:
            self.calls += 1
            self.inflight += 1
            self.peak = max(self.peak, self.inflight)
        try:
            self.gate.wait(self.hold_s)
        finally:
            with self.lock:
                self.inflight -= 1
        start = dt.date.fromisoformat(from_ or "2024-01-01")
        end = dt.date.fromisoformat(to or dt.date.today().isoformat())
        rows, d, px = [], start, 100.0
        while d <= end:
            if d.weekday() < 5:
                px *= 1.0003
                rows.append({"date": d.isoformat(), "open": px, "high": px, "low": px, "close": px,
                             "adjusted_close": px, "volume": 1e6})
            d += dt.timedelta(days=1)
        return rows


@pytest.fixture()
def fake(monkeypatch):
    f = SlowFake(hold_s=0.6)
    market.set_client_for_tests(f)
    monkeypatch.setattr(entitlements, "is_blocked", lambda fam: None)
    try:
        yield f
    finally:
        f.gate.set()
        market.set_client_for_tests(None)


def _routes():
    legs = [(s, 10.0) for s in NAMES]
    return {
        "price": lambda: db.fetch(db._symbols(legs, [s for s, _ in db.BENCHMARKS.values()])),
        "hedge": lambda: db.fetch(db._symbols(legs, list(db.HEDGE_ETFS))),
        "study": lambda: db.fetch_study(NAMES),
    }


def _run(results: dict, name: str, fn) -> None:
    try:
        fn()
        results[name] = "ok"
    except env.Refused as exc:
        results[name] = f"{exc.status} {exc.message}"


def _slots() -> int:
    return market._slots._initial_value


def test_two_routes_at_a_time_fit_the_provider_ceiling():
    # The ordering's guarantee: with the price answered, at most the hedge and the study fetch at once.
    assert 2 * db.FETCH_WORKERS <= _slots()
    # and three routes at a time cannot fit, which is the burst the page made on a cold cache
    assert 3 * db.FETCH_WORKERS > _slots()


def test_launched_together_on_a_cold_cache_one_route_is_refused_busy(fake):
    results: dict = {}
    threads = [threading.Thread(target=_run, args=(results, k, f)) for k, f in _routes().items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    refused = {k: v for k, v in results.items() if v != "ok"}
    assert refused, results
    assert all(v.startswith("429 ") and "The market-data layer is busy" in v for v in refused.values()), results
    assert fake.peak == _slots()


def test_price_and_hedge_then_the_study_after_the_price_are_never_refused(fake):
    results: dict = {}
    r = _routes()
    price = threading.Thread(target=_run, args=(results, "price", r["price"]))
    hedge = threading.Thread(target=_run, args=(results, "hedge", r["hedge"]))
    price.start()
    hedge.start()
    price.join()
    assert results["price"] == "ok"
    # the study starts while the hedge is still fetching (its ETFs are not the price's names)
    study = threading.Thread(target=_run, args=(results, "study", r["study"]))
    study.start()
    study.join()
    hedge.join()
    assert results == {"price": "ok", "hedge": "ok", "study": "ok"}
    assert fake.peak <= _slots()
