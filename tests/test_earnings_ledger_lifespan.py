"""The ledger reader in the API lifespan (design LR section 1, item 5): the one shared change.

Pinned: the reader starts after the DB bootstrap and before the worker, stops before the worker stops; a start
or stop that raises never stops the API from starting or shutting down; without GH_DB_TOKEN or
EARNINGS_CACHE_KEY nothing starts; a real reader stops within its join bound at shutdown.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from api import earnings_ledger_reader as reader
from api import main


class FakeWorker:
    def __init__(self, order):
        self.order = order

    def start(self, serving=False):
        self.order.append("worker.start")

    def stop(self):
        self.order.append("worker.stop")


@pytest.fixture()
def order(monkeypatch):
    seen: list[str] = []
    monkeypatch.setenv("EODHD_PROBE_ON_START", "0")
    monkeypatch.setenv("BOOTSTRAP_DB_REFRESH_MIN", "0")
    monkeypatch.setattr(main.bootstrap, "refresh_db", lambda: seen.append("bootstrap"))
    monkeypatch.setattr(main.worker_mod, "get_worker", lambda: FakeWorker(seen))
    monkeypatch.setattr(main.stream.hub, "start", lambda: seen.append("hub.start"))

    async def hub_stop():
        seen.append("hub.stop")

    monkeypatch.setattr(main.stream.hub, "stop", hub_stop)
    return seen


def run_lifespan(order):
    async def go():
        async with main._lifespan(main.app):
            order.append("serving")

    asyncio.run(go())


def test_the_reader_starts_after_the_bootstrap_and_stops_before_the_worker(order, monkeypatch):
    monkeypatch.setattr(reader, "start", lambda env=None: order.append("reader.start") or True)
    monkeypatch.setattr(reader, "stop", lambda: order.append("reader.stop"))
    run_lifespan(order)
    assert order == ["bootstrap", "reader.start", "worker.start", "hub.start", "serving", "reader.stop",
                     "worker.stop", "hub.stop"]


def test_without_both_settings_nothing_starts(order, monkeypatch):
    monkeypatch.delenv("GH_DB_TOKEN", raising=False)
    monkeypatch.setenv("EARNINGS_CACHE_KEY", "x-TESTONLY")
    made = []
    monkeypatch.setattr(reader, "Reader", lambda *a, **k: made.append(1))
    run_lifespan(order)
    assert made == [] and reader._reader is None and reader.current().status == "off"


def test_a_reader_that_cannot_start_never_stops_the_api(order, monkeypatch):
    monkeypatch.setenv("GH_DB_TOKEN", "t-TESTONLY")
    monkeypatch.setenv("EARNINGS_CACHE_KEY", "x-TESTONLY")

    def broken(*a, **k):
        raise RuntimeError("synthetic")

    monkeypatch.setattr(reader, "Reader", broken)
    run_lifespan(order)
    assert "serving" in order and order[-1] == "hub.stop" and reader._reader is None


def test_a_real_reader_with_a_check_in_flight_stops_within_its_bound(order, monkeypatch):
    """The shutdown join is bounded (JOIN_S): a check stuck in its child does not hold the shutdown."""
    monkeypatch.setenv("GH_DB_TOKEN", "t-TESTONLY")
    monkeypatch.setenv("EARNINGS_CACHE_KEY", "x-TESTONLY")
    release = threading.Event()
    entered = threading.Event()

    def stuck(op, url, deadline):
        entered.set()
        release.wait(30)
        return 30, b"network"

    real = reader.Reader
    monkeypatch.setattr(reader, "Reader", lambda secret, **k: real(secret, stuck, **k))
    marks = {}

    async def go():
        async with main._lifespan(main.app):
            assert await asyncio.to_thread(entered.wait, 5)
            assert reader.current().status == "starting"
            marks["shutdown"] = time.monotonic()
        marks["done"] = time.monotonic()

    try:
        asyncio.run(go())
        assert marks["done"] - marks["shutdown"] <= reader.JOIN_S + 1.0 and reader._reader is None
    finally:
        release.set()
