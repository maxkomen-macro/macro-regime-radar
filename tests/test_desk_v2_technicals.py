"""tests/test_desk_v2_technicals.py — GET /technicals (desk/frame-3-api, B2 commit 6).

docs/desk/FRAME3_API_PLAN.md §1.7, §1.11 N2–N4 and §5. The S&P 500's price,
day and year returns on exact XNYS endpoints, its 50- and 200-day averages on
one extended calendar (a slot with no close makes the average null), the trend
state and when it began, the latest strict cross, the chart series, and the z
of the spx-20d-2sigma study on its own evaluated_on. The short-history cases
run the pure builder on levels built here; the route runs on the synthetic
store and, for the real-data facts A's fixture records, on the published copy.
"""

from __future__ import annotations

import math
import os
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk_catalog as catalog, desk_items, desk_v2
from api.main import app
from src.desk import event_study as es
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve, synth_path  # noqa: F401 (fixture)

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", ROOT / "data" / "macro_radar.db"))
published = pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS
         if n in ("desk_technicals", "desk_study:spx-20d-2sigma", "desk_study:golden-cross", "desk_study:death-cross")]

client = TestClient(app)


def _xnys(start: str, end: str) -> pd.DatetimeIndex:
    return es.sessions_between(es.session_calendar(start, end), start, end)


def _level(dates, seed: int = 1) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(100 * np.cumprod(1 + rng.normal(0.0004, 0.01, len(dates))), index=pd.DatetimeIndex(dates))


def _tech() -> dict:
    return dc.check_response("/technicals", client.get("/api/desk/technicals"))


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):  # noqa: F811
    return _serve(install_worker, monkeypatch, synth_path, items=ITEMS)


# ── the route ───────────────────────────────────────────────────────────────

def test_the_technicals_shape(served):
    d = _tech()["data"]
    assert d["signals_allowlist"] == ["golden-cross", "death-cross", "spx-20d-2sigma", "spx-5d-2sigma"]
    assert d["vol"]["unavailable"]["reason"] == "needs stored SPY option snapshots and a versioned skew method."
    assert d["sectors"]["unavailable"]["reason"] == "sector ETFs, RSP and IWM not ingested."
    assert (d["freq"], d["source"]) == ("daily", "asset_prices ^GSPC")
    assert client.get("/api/desk/technicals?x=1").status_code == 422


def test_the_averages_are_the_last_50_and_200_session_slots(served, synth_path):
    d = _tech()["data"]
    conn = sqlite3.connect(f"file:{synth_path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT date, close FROM asset_prices WHERE symbol = '^GSPC' ORDER BY date").fetchall()
    finally:
        conn.close()
    closes = dict(rows)
    sessions = [s.strftime("%Y-%m-%d") for s in _xnys("2025-01-01", d["date"])]
    for w, key in ((50, "ma50"), (200, "ma200")):
        slots = sessions[-w:]
        assert d[f"{key}_window"] == {"start": slots[0], "end": d["date"], "n": sum(1 for s in slots if s in closes)}
        if all(s in closes for s in slots):
            assert d[key] == pytest.approx(sum(closes[s] for s in slots) / w, rel=1e-12)
            assert d[f"vs_{key}"] == pytest.approx(d["price"] / d[key] - 1, rel=1e-12)
    assert d["price"] == closes[d["date"]]
    assert d["chg_1d_dates"] == {"from": sessions[-2], "to": sessions[-1]}
    assert d["ret_1y_dates"] == {"from": sessions[-253], "to": sessions[-1]}
    assert d["chg_1d"] == pytest.approx(closes[sessions[-1]] / closes[sessions[-2]] - 1, rel=1e-12)


def test_the_cross_is_the_later_of_the_two_studies_last_events(served, monkeypatch):
    d = _tech()["data"]
    golden = served.current.results["desk_study:golden-cross"]["events"]
    death = served.current.results["desk_study:death-cross"]["events"]
    last = max((t.sessions[int(t.event_idx[-1])], kind) for t, kind in ((golden, "golden"), (death, "death")) if len(t))
    assert d["cross"] == {"kind": last[1], "date": last[0]}


def test_move_20d_sigma_is_the_studys_z_on_its_evaluated_on(served):
    d = _tech()["data"]
    tr = served.current.results["desk_study:spx-20d-2sigma"]["trace"]
    last = int(np.flatnonzero(tr.evaluable)[-1])
    assert d["move_20d_date"] == tr.sessions[last] and d["move_20d_sigma"] == float(tr.z[last])


def test_the_chart_windows_are_calendar_months_of_sessions(served):
    d = _tech()["data"]
    end = pd.Timestamp(d["date"])
    for name, months in (("6m", 6), ("1y", 12), ("3y", 36)):
        pts = d["series"][name]
        want = [s.strftime("%Y-%m-%d") for s in _xnys("2020-01-01", d["date"]) if s > end - pd.DateOffset(months=months)]
        assert [p["date"] for p in pts] == want, name
        assert pts[-1]["close"] == d["price"] and pts[-1]["ma50"] == d["ma50"]


def test_a_store_without_the_sp_is_awaiting(install_worker, monkeypatch, tmp_path):
    path = tmp_path / "macro_radar.db"
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE regimes (date TEXT, label TEXT)")
    _serve(install_worker, monkeypatch, path, items=[("desk_technicals", desk_items.desk_technicals)])
    b = _tech()
    assert b["status"] == "awaiting" and "S&P 500" in b["unavailable"]["reason"]


# ── the builder on short histories (plan §5, N2, N3) ────────────────────────

def test_equality_is_mixed_and_a_null_average_unavailable():
    nan = float("nan")
    assert desk_items.trend_states([10, 10, 9, 11, 10, 10], [9, 10, 10, 10, nan, 9], [9, 9, 10, 10, 9, nan]) == \
        ["above_both", "mixed", "below_both", "above_both", "unavailable", "unavailable"]


@pytest.mark.parametrize("n", [1, 30, 199, 200])
def test_a_short_history(n):
    dates = _xnys("2025-01-01", "2026-09-18")[-n:]
    t = desk_items.technicals_from_level(_level(dates))
    sessions = t["_sessions"]
    i = sessions.index("2026-09-18")
    assert t["ma50_window"] == {"start": sessions[i - 49], "end": "2026-09-18", "n": min(n, 50)}
    assert t["ma200_window"] == {"start": sessions[i - 199], "end": "2026-09-18", "n": min(n, 200)}
    assert (t["ma50"] is None) == (n < 50) and (t["ma200"] is None) == (n < 200)
    if n < 200:
        assert t["trend"] == {"state": "unavailable", "state_since": dates[0].strftime("%Y-%m-%d")}
    assert t["ret_1y"] is None and t["ret_1y_dates"]["from"] == sessions[i - 252] < dates[0].strftime("%Y-%m-%d")
    assert (t["chg_1d"] is None) == (n == 1) and t["chg_1d_dates"]["from"] == sessions[i - 1]
    assert all(p["ma200"] is None for p in t["series"]["3y"][:-1]) and (t["series"]["3y"][-1]["ma200"] is None) == (n < 200)


def test_the_chart_at_one_stored_close():
    """Round 6's R-17: one close on 2020-01-07 still serves every chart date."""
    t = desk_items.technicals_from_level(_level(pd.DatetimeIndex(["2020-01-07"])))
    s3 = t["series"]["3y"]
    assert len(s3) == 754 and (s3[0]["date"], s3[-1]["date"]) == ("2017-01-09", "2020-01-07")
    assert [p["date"] for p in s3] == [s.strftime("%Y-%m-%d") for s in _xnys("2017-01-08", "2020-01-07")]
    assert all(p["close"] is None for p in s3[:-1]) and s3[-1]["close"] is not None
    assert all(p["ma50"] is None and p["ma200"] is None for p in s3)
    assert (len(t["series"]["6m"]), len(t["series"]["1y"])) == (128, 252)
    assert t["_sessions"][0] <= "2016-03-28", "the first chart point's 200-session slots are on the calendar"
    assert t["trend"]["state_since"] == "2020-01-07"


def test_a_missing_close_nulls_the_day_change_and_the_averages_over_it():
    dates = _xnys("2025-01-01", "2026-09-18")
    lvl = _level(dates).drop(pd.Timestamp("2026-09-17"))
    t = desk_items.technicals_from_level(lvl)
    assert t["chg_1d"] is None and t["chg_1d_dates"] == {"from": "2026-09-17", "to": "2026-09-18"}
    assert t["ma50"] is None and t["ma200"] is None and t["ma50_window"]["n"] == 49
    assert t["trend"] == {"state": "unavailable", "state_since": "2026-09-17"}
    assert t["ret_1y"] is not None
    full = desk_items.technicals_from_level(_level(dates))
    assert full["ma50"] is not None and full["chg_1d"] is not None


def test_the_ret_1y_from_date_is_a_real_session_before_the_data():
    dates = _xnys("2025-01-01", "2026-09-18")[-200:]
    t = desk_items.technicals_from_level(_level(dates))
    sessions = [s.strftime("%Y-%m-%d") for s in _xnys("2024-01-01", "2026-09-18")]
    assert t["ret_1y"] is None and t["ret_1y_dates"] == {"from": sessions[-253], "to": "2026-09-18"}


# ── the published copy (A's fixture records these values) ───────────────────

@published
def test_the_published_copy(install_worker, monkeypatch):
    _serve(install_worker, monkeypatch, PUBLISHED, items=ITEMS)
    d = _tech()["data"]
    assert (d["price"], d["date"]) == (7706.02978515625, "2026-09-23")
    assert d["chg_1d"] is None and d["chg_1d_dates"] == {"from": "2026-09-22", "to": "2026-09-23"}
    assert d["ret_1y_dates"]["from"] == "2025-09-22" and d["ret_1y"] == pytest.approx(0.1512, abs=5e-5)
    assert d["ma50"] is None and d["ma200"] is None
    assert (d["ma50_window"]["start"], d["ma50_window"]["n"]) == ("2026-07-15", 49)
    assert (d["ma200_window"]["start"], d["ma200_window"]["n"]) == ("2025-12-05", 199)
    assert d["trend"] == {"state": "unavailable", "state_since": "2026-09-22"}
    assert d["cross"] == {"kind": "golden", "date": "2025-07-01"}
    assert d["move_20d_date"] == "2026-09-23" and math.isfinite(d["move_20d_sigma"])
    gap = next(p for p in d["series"]["6m"] if p["date"] == "2026-09-22")
    assert gap == {"date": "2026-09-22", "close": None, "ma50": None, "ma200": None}
    assert catalog.TECHNICALS_ALLOWLIST == tuple(d["signals_allowlist"])
    assert desk_v2.TECHNICALS_KEYS == tuple(d)
