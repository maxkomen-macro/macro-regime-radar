"""tests/test_desk_instruments.py — GET /api/desk/instruments (desk/usability, item 1).

DESK_FRAME3_SPEC §12.17, §14.1: the instruments this store prices from its
own daily closes, the list the Desk's stock search offers when the upstream
search does not answer. A worker item (`desk_instruments`), a lookup on the
request's generation, in the §12.0 envelope. The name table covers every
daily ETF the full refresh stores.
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk_items
from api.main import app
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve, synth_path  # noqa: F401 (fixture)

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS if n == "desk_instruments"]


def test_every_stored_daily_etf_has_a_name():
    """The refresh's daily series (src/market_data/asset_history) are named here, the
    S&P 500 as the index; futures and the other indices are not offered as stocks."""
    from src.market_data import asset_history

    etfs = {s for s in asset_history.DAILY_SYMBOLS if not s.startswith("^") and "=" not in s}
    assert etfs <= set(desk_items.INSTRUMENT_NAMES)
    assert desk_items.INSTRUMENT_NAMES["^GSPC"] == ("S&P 500", "index")
    assert all(kind in ("etf", "index") for _, kind in desk_items.INSTRUMENT_NAMES.values())


def test_the_item_lists_the_named_instruments_the_store_holds(monkeypatch, tmp_path):
    path = tmp_path / "macro_radar.db"
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT)")
        c.executemany("INSERT INTO asset_prices VALUES (?, ?, ?, ?, 'eodhd')", [
            ("SPY", "1d", "2020-01-02", 300.0), ("SPY", "1d", "2026-09-23", 700.0),
            ("SPY", "1mo", "2026-09-01", 700.0),  # monthly rows are not daily history
            ("GLD", "1d", "2010-01-04", 110.0), ("GLD", "1d", "2099-01-02", 1.0),  # future-dated: not read
            ("GC=F", "1d", "2026-09-23", 2000.0),  # futures: not a stock
            ("VTI", "1mo", "2026-09-01", 300.0),  # monthly only: not priced daily
        ])
    from src.desk import event_study as es

    monkeypatch.setattr(es, "DB_PATH", path)
    out = desk_items.desk_instruments({})
    assert out["instruments"] == [
        {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "kind": "etf", "first": "2020-01-02", "last": "2026-09-23", "source": "asset_prices"},
        {"symbol": "GLD", "name": "SPDR Gold Shares", "kind": "etf", "first": "2010-01-04", "last": "2010-01-04", "source": "asset_prices"},
    ]
    # desk/usability item 2: each stored ETF's technicals ride with the list; two closes are too few for any.
    assert set(out["technicals"]) <= {"SPY", "GLD"}
    assert out["excluded"] == []


@pytest.mark.parametrize("bad", [
    ("GLD", "1d", "2026-06-01", "abc"),        # a close stored as text
    ("GLD", "1d", "2026-06-01", None),         # no close
    ("GLD", "1d", "2026-06-01", float("nan")),  # not a number
    ("GLD", "1d", "2026-06-01", -3.0),         # not a price
    ("GLD", "1d", "2026-02-30", 180.0),        # not a date
])
def test_one_malformed_row_drops_its_instrument_with_a_reason_and_keeps_the_rest(monkeypatch, tmp_path, bad):
    """Codex R-08: the item read every instrument's closes at once, so one malformed asset_prices row failed the
    whole item (and the search's fallback list with it). Each instrument's rows are checked on their own now."""
    import numpy as np

    path = tmp_path / "macro_radar.db"
    days = [d.strftime("%Y-%m-%d") for d in __import__("pandas").bdate_range("2021-01-04", "2026-09-18")]
    rng = np.random.default_rng(2)
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT)")
        for sym, base in (("SPY", 400.0), ("GLD", 170.0)):
            px = base * np.cumprod(1 + rng.normal(0.0003, 0.01, len(days)))
            c.executemany("INSERT INTO asset_prices VALUES (?, '1d', ?, ?, 'eodhd')", [(sym, d, float(p)) for d, p in zip(days, px)])
        c.execute("DELETE FROM asset_prices WHERE symbol = ? AND date = ?", (bad[0], bad[2]))
        c.execute("INSERT INTO asset_prices VALUES (?, ?, ?, ?, 'eodhd')", bad)
    from src.desk import event_study as es

    monkeypatch.setattr(es, "DB_PATH", path)
    out = desk_items.desk_instruments({})
    assert [r["symbol"] for r in out["instruments"]] == ["SPY"]
    assert set(out["technicals"]) == {"SPY"}
    [ex] = out["excluded"]
    assert ex["symbol"] == "GLD" and ex["reason"].startswith("1 stored row could not be read (") and bad[2] in ex["reason"]


def test_a_store_without_the_table_lists_none(monkeypatch, tmp_path):
    path = tmp_path / "macro_radar.db"
    sqlite3.connect(path).close()
    from src.desk import event_study as es

    monkeypatch.setattr(es, "DB_PATH", path)
    assert desk_items.desk_instruments({}) == {"instruments": [], "technicals": {}, "excluded": []}


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):  # noqa: F811
    return _serve(install_worker, monkeypatch, synth_path, items=ITEMS)


def test_the_route_serves_the_item_in_the_envelope(served):
    body = dc.check_response("/instruments", client.get("/api/desk/instruments"))
    rows = body["data"]["instruments"]
    assert body["data"]["excluded"] == []
    assert [r["symbol"] for r in rows][:1] == ["^GSPC"]
    assert all(r["source"] == "asset_prices" for r in rows)
    r = client.get("/api/desk/instruments?q=spy")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported"
