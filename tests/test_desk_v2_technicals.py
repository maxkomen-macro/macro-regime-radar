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
from src.analytics import technicals
from src.desk import event_study as es
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve, synth_path  # noqa: F401 (fixture)

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", ROOT / "data" / "macro_radar.db"))
published = pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS
         if n in ("desk_technicals", "desk_study:spx-20d-2sigma", "desk_study:golden-cross", "desk_study:death-cross", "desk_etf")]

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
    assert d["signals_allowlist"] == ["golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma",
                                      "spx-5d-2sigma"]
    assert d["vol"]["unavailable"]["reason"] == "needs stored SPY option snapshots and a versioned skew method."
    # desk/fill-etf: the synthetic store predates the ETFs, so the served leadership awaits the refresh
    assert d["sectors"]["unavailable"]["reason"].startswith("Awaiting refresh: the full refresh stores SPY, XLB, XLC")
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


# ── RSI (desk/fill-compute; spec §12.7, §12.13's rule) ──────────────────────

def _wilder(closes: list[float], n: int = 14) -> list[float]:
    """A plain transcription of Wilder's rule on one contiguous run of closes."""
    ch = [b - a for a, b in zip(closes, closes[1:])]
    out = [math.nan] * len(closes)
    if len(ch) < n:
        return out
    g = sum(max(c, 0.0) for c in ch[:n]) / n
    lo = sum(max(-c, 0.0) for c in ch[:n]) / n
    for i in range(n, len(ch) + 1):
        if i > n:
            c = ch[i - 1]
            g, lo = (g * (n - 1) + max(c, 0.0)) / n, (lo * (n - 1) + max(-c, 0.0)) / n
        out[i] = 50.0 if g == lo == 0 else (100.0 if lo == 0 else (0.0 if g == 0 else 100 - 100 / (1 + g / lo)))
    return out


def test_rsi_is_seeded_from_fourteen_changes_and_smoothed_by_wilder():
    closes = list(100 + np.cumsum(np.random.default_rng(3).normal(0, 1, 60)))
    got = technicals.rsi(pd.Series(closes)).to_numpy()
    want = _wilder(closes)
    assert np.isnan(got[:14]).all() and not np.isnan(got[14])
    np.testing.assert_allclose(got[14:], want[14:], rtol=1e-12)


def test_rsi_edge_values():
    up = pd.Series([float(i) for i in range(1, 20)])
    assert technicals.rsi(up).iloc[-1] == 100.0          # gains, no losses
    assert technicals.rsi(up[::-1].reset_index(drop=True)).iloc[-1] == 0.0  # losses, no gains
    assert technicals.rsi(pd.Series([5.0] * 20)).iloc[-1] == 50.0          # neither


def test_a_gap_invalidates_the_rsi_until_fifteen_contiguous_closes_reseed_it():
    closes = list(100 + np.cumsum(np.random.default_rng(4).normal(0, 1, 80)))
    s = pd.Series(closes)
    s.iloc[40] = np.nan
    got = technicals.rsi(s).to_numpy()
    assert not np.isnan(got[39])
    assert np.isnan(got[40:55]).all(), "nothing bridges the gap: 14 new changes are needed"
    np.testing.assert_allclose(got[55:], _wilder(closes[41:])[14:], rtol=1e-12)


def test_the_rsi_fields_on_a_level():
    dates = _xnys("2025-01-01", "2026-09-18")
    lvl = _level(dates, seed=5)
    t = desk_items.technicals_from_level(lvl)
    r = technicals.rsi(lvl.reindex(pd.DatetimeIndex(pd.to_datetime(t["_sessions"])))).dropna()
    assert t["rsi_date"] == "2026-09-18" and t["rsi"] == pytest.approx(float(r.iloc[-1]), rel=1e-12)
    assert t["rsi_prev_date"] == r.index[-2].strftime("%Y-%m-%d") and t["rsi_prev"] == pytest.approx(float(r.iloc[-2]))
    for key, hits in (("rsi_last_above_70", r[r > 70]), ("rsi_last_below_30", r[r < 30])):
        v = t[key]
        if not len(hits):
            assert v is None
            continue
        day = hits.index[-1]
        assert v["date"] == day.strftime("%Y-%m-%d") and v["rsi"] == pytest.approx(float(hits.iloc[-1]))
        later = [d for d in lvl.index if d > day]
        if len(later) >= 20:
            assert v["after_20d_to"] == later[19].strftime("%Y-%m-%d")
            assert v["after_20d"] == pytest.approx(float(lvl[later[19]] / lvl[day] - 1), rel=1e-12)
        else:
            assert v["after_20d"] is None and v["after_20d_to"] is None


def test_a_gap_holds_the_rsi_on_the_session_before_it():
    dates = _xnys("2025-01-01", "2026-09-18")
    lvl = _level(dates, seed=6).drop(pd.Timestamp("2026-09-16"))
    t = desk_items.technicals_from_level(lvl)
    assert t["date"] == "2026-09-18" and t["rsi_date"] == "2026-09-15"
    assert t["rsi_prev_date"] == "2026-09-14" and t["rsi_prev"] is not None


def test_the_route_serves_the_rsi_fields(served):
    d = _tech()["data"]
    assert d["rsi_date"] is not None and 0 <= d["rsi"] <= 100
    assert list(d)[list(d).index("move_20d_date") + 1:list(d).index("series")] == [
        "rsi", "rsi_date", "rsi_prev", "rsi_prev_date", "rsi_last_above_70", "rsi_last_below_30", "macd", "seasonality"]


@published
def test_the_published_copy_rsi(install_worker, monkeypatch):
    """The audit's store has no Sep 22 close, so the RSI is held on Sep 21 (the value A's fixture records)."""
    _serve(install_worker, monkeypatch, PUBLISHED, items=ITEMS)
    d = _tech()["data"]
    assert (d["rsi_date"], d["rsi_prev_date"]) == ("2026-09-21", "2026-09-18")
    assert d["rsi"] == pytest.approx(59.2768, abs=5e-5) and d["rsi_prev"] == pytest.approx(50.7136, abs=5e-5)
    assert d["rsi_last_above_70"]["date"] == "2026-06-02" and d["rsi_last_above_70"]["after_20d_to"] == "2026-07-01"
    assert d["rsi_last_below_30"]["date"] == "2026-03-30" and d["rsi_last_below_30"]["after_20d_to"] == "2026-04-28"


# ── MACD (desk/fill-compute, owner's item 9; spec §12.7) ────────────────────

def _ema(xs: list[float], span: int) -> list[float]:
    """A plain transcription on one contiguous run: the SMA of the first `span`
    values seeds it, then alpha = 2 / (span + 1)."""
    out = [math.nan] * len(xs)
    if len(xs) < span:
        return out
    a = 2 / (span + 1)
    e = sum(xs[:span]) / span
    out[span - 1] = e
    for i in range(span, len(xs)):
        e = a * xs[i] + (1 - a) * e
        out[i] = e
    return out


def test_macd_is_the_sma_seeded_emas_of_twelve_twenty_six_and_nine():
    closes = list(100 + np.cumsum(np.random.default_rng(7).normal(0, 1, 120)))
    got = technicals.macd(pd.Series(closes))
    fast, slow = _ema(closes, 12), _ema(closes, 26)
    line = [f - s_ for f, s_ in zip(fast, slow)]
    sig = [math.nan] * 25 + _ema(line[25:], 9)
    assert np.isnan(got["macd"].to_numpy()[:25]).all() and not math.isnan(got["macd"].iloc[25])
    assert np.isnan(got["signal"].to_numpy()[:33]).all() and not math.isnan(got["signal"].iloc[33])
    np.testing.assert_allclose(got["macd"].to_numpy()[25:], line[25:], rtol=1e-12)
    np.testing.assert_allclose(got["signal"].to_numpy()[33:], sig[33:], rtol=1e-12)
    np.testing.assert_allclose(got["hist"].to_numpy()[33:], np.array(line[33:]) - np.array(sig[33:]), rtol=1e-9, atol=1e-12)


def test_macd_converges_on_the_common_first_value_seeded_ewm():
    """The seed stops mattering on a long run: the textbook pandas ewm(adjust=False) agrees at the end."""
    s = pd.Series(100 + np.cumsum(np.random.default_rng(8).normal(0, 1, 1500)))
    got = technicals.macd(s)
    line = s.ewm(span=12, adjust=False).mean() - s.ewm(span=26, adjust=False).mean()
    sig = line.ewm(span=9, adjust=False).mean()
    np.testing.assert_allclose(got["macd"].tail(100), line.tail(100), rtol=1e-9)
    np.testing.assert_allclose(got["signal"].tail(100), sig.tail(100), rtol=1e-9)


def test_a_gap_invalidates_the_macd_until_the_averages_reseed():
    closes = list(100 + np.cumsum(np.random.default_rng(9).normal(0, 1, 140)))
    s = pd.Series(closes)
    s.iloc[60] = np.nan
    got = technicals.macd(s)
    assert not math.isnan(got["hist"].iloc[59])
    # 26 new closes (61..86) for the line, then 9 line values for the signal (86..94).
    assert np.isnan(got["macd"].to_numpy()[60:86]).all() and not math.isnan(got["macd"].iloc[86])
    assert np.isnan(got["hist"].to_numpy()[60:94]).all() and not math.isnan(got["hist"].iloc[94])
    fresh = technicals.macd(pd.Series(closes[61:]))
    np.testing.assert_allclose(got["hist"].to_numpy()[94:], fresh["hist"].to_numpy()[33:], rtol=1e-12)


def test_macd_crossings_are_strict_carry_through_zero_and_reset_on_a_gap():
    hist = pd.Series([math.nan, 1, 0, -1, -2, math.nan, -1, 1, 0, 0, 2, -1])
    assert technicals.macd_crossings(hist) == [(3, "below"), (7, "above"), (11, "below")]
    assert technicals.macd_crossings(pd.Series([0.0, 0.0, 1.0])) == []  # no side before the first sign
    assert technicals.macd_crossings(pd.Series([1.0, math.nan, -1.0])) == []  # never across a gap


def test_the_macd_fields_on_a_level():
    dates = _xnys("2025-01-01", "2026-09-18")
    lvl = _level(dates, seed=10)
    t = desk_items.technicals_from_level(lvl)
    m = technicals.macd(lvl.reindex(pd.DatetimeIndex(pd.to_datetime(t["_sessions"]))))
    got = t["macd"]
    assert got["date"] == "2026-09-18" and got["params"] == {"fast": 12, "slow": 26, "signal": 9}
    for k in ("macd", "signal", "hist"):
        assert got[k] == pytest.approx(float(m[k].iloc[-1]), rel=1e-12)
    cr = technicals.macd_crossings(m["hist"])
    assert got["last_cross"] == {"date": m.index[cr[-1][0]].strftime("%Y-%m-%d"), "kind": cr[-1][1]}
    # The chart is the price chart's 6M sessions, point for point.
    assert [p["date"] for p in got["series"]] == [p["date"] for p in t["series"]["6m"]]
    last = got["series"][-1]
    assert last == {"date": "2026-09-18", "macd": got["macd"], "signal": got["signal"], "hist": got["hist"]}


def test_a_gap_holds_the_macd_on_the_session_before_it():
    dates = _xnys("2025-01-01", "2026-09-18")
    lvl = _level(dates, seed=11).drop(pd.Timestamp("2026-09-16"))
    t = desk_items.technicals_from_level(lvl)
    assert t["date"] == "2026-09-18" and t["macd"]["date"] == "2026-09-15"
    tail = {p["date"]: p for p in t["macd"]["series"][-3:]}
    assert all(tail[d]["macd"] is None and tail[d]["hist"] is None for d in ("2026-09-16", "2026-09-17", "2026-09-18"))


def test_no_macd_is_null():
    dates = _xnys("2026-01-02", "2026-02-10")  # fewer than 34 closes
    t = desk_items.technicals_from_level(_level(dates, seed=12))
    assert t["macd"] is None


def test_the_route_serves_the_macd(served):
    m = _tech()["data"]["macd"]
    assert m is not None and m["params"] == {"fast": 12, "slow": 26, "signal": 9}
    assert m["hist"] == pytest.approx(m["macd"] - m["signal"], abs=1e-9)


@published
def test_the_published_copy_macd(install_worker, monkeypatch):
    """The audit's store has no Sep 22 close, so the MACD is held on Sep 21, the day the line crossed above its signal."""
    _serve(install_worker, monkeypatch, PUBLISHED, items=ITEMS)
    m = _tech()["data"]["macd"]
    assert m["date"] == "2026-09-21" and m["last_cross"] == {"date": "2026-09-21", "kind": "above"}
    assert (m["macd"], m["signal"], m["hist"]) == pytest.approx((3.9720, 3.6872, 0.2849), abs=5e-5)
    assert [(p["date"], p["hist"]) for p in m["series"][-2:]] == [("2026-09-22", None), ("2026-09-23", None)]


# ── Seasonality (desk/fill-compute, owner's item 10; spec §12.7) ────────────

def _month_closes(values: dict[str, float], end: str) -> pd.Series:
    """Closes on the XNYS calendar from the first key through `end`, NaN where not given."""
    idx = _xnys(min(values), end)
    return pd.Series([values.get(d.strftime("%Y-%m-%d"), np.nan) for d in idx], index=idx)


def test_monthly_returns_read_each_months_last_session():
    s = _month_closes({"2026-01-02": 90.0, "2026-01-30": 100.0, "2026-02-27": 110.0, "2026-03-31": 99.0, "2026-04-15": 120.0},
                      "2026-04-30")
    r = technicals.monthly_returns(s)
    assert [str(m) for m in r.index] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert math.isnan(r.iloc[0])                              # nothing before January
    assert r.iloc[1] == pytest.approx(0.10) and r.iloc[2] == pytest.approx(99 / 110 - 1)
    assert math.isnan(r.iloc[3])                              # April's last session (the 30th) has no close: not over


def test_a_month_ending_without_a_close_has_no_return_and_neither_does_the_next():
    s = _month_closes({"2026-01-30": 100.0, "2026-02-26": 105.0, "2026-03-31": 99.0, "2026-04-30": 101.0}, "2026-04-30")
    r = technicals.monthly_returns(s)   # Feb 27, February's last session, has no close
    assert math.isnan(r["2026-02"]) and math.isnan(r["2026-03"]) and r["2026-04"] == pytest.approx(101 / 99 - 1)


def test_monthly_seasonality_groups_by_calendar_month():
    idx = pd.period_range("2019-12", "2022-03", freq="M")
    ends = pd.Series(100 * np.cumprod(1 + np.random.default_rng(13).normal(0.005, 0.04, len(idx))), index=idx.to_timestamp("M"))
    got = technicals.monthly_seasonality(ends)
    r = (ends / ends.shift(1) - 1).dropna()
    assert got["window"] == {"start": "2020-01", "end": "2022-03", "n": 27}
    jan = got["rows"][0]
    want = r[r.index.month == 1]
    assert (jan["label"], jan["n"], jan["first_year"], jan["last_year"]) == ("Jan", 3, 2020, 2022)
    assert jan["avg"] == pytest.approx(float(want.mean())) and jan["pct_up"] == pytest.approx(float((want > 0).mean()))
    assert [x["n"] for x in got["rows"]] == [3, 3, 3] + [2] * 9
    empty = technicals.monthly_seasonality(ends.iloc[:1])
    assert empty["window"] == {"start": None, "end": None, "n": 0} and all(x["avg"] is None for x in empty["rows"])


def test_the_seasonality_fields_on_a_level_skip_the_unfinished_month():
    dates = _xnys("2023-01-03", "2026-09-18")
    lvl = _level(dates, seed=14)
    s = desk_items.technicals_from_level(lvl)["seasonality"]
    assert (s["freq"], s["source"]) == ("monthly", "asset_prices ^GSPC")
    assert s["window"] == {"start": "2023-02", "end": "2026-08", "n": 43}   # September 2026 is not over
    month_ends = lvl.groupby(lvl.index.to_period("M")).last()
    r = (month_ends / month_ends.shift(1) - 1).loc["2023-02":"2026-08"]
    for row in s["rows"]:
        want = r[r.index.month == row["month"]]
        assert row["n"] == len(want) and row["avg"] == pytest.approx(float(want.mean()), rel=1e-12)
    # The regime table reads the same month returns (one copy, src/analytics/technicals.monthly_returns).
    from api import desk_items_macro
    mr = desk_items_macro.month_returns(lvl)
    assert len(mr) == 43 and mr["2026-08"] == pytest.approx(float(r["2026-08"]), rel=1e-12)


def test_a_history_without_a_complete_month_has_no_seasonality():
    t = desk_items.technicals_from_level(_level(_xnys("2026-08-03", "2026-09-18"), seed=15))
    assert t["seasonality"] is None


def test_the_route_serves_the_seasonality(served):
    d = _tech()["data"]
    assert [r["label"] for r in d["seasonality"]["rows"]] == ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
                                                              "Oct", "Nov", "Dec"]
    assert list(d).index("seasonality") == list(d).index("macd") + 1


@published
def test_the_published_copy_seasonality(install_worker, monkeypatch):
    """Every stored ^GSPC close, 1990 on: Feb 1990 to Aug 2026 (September not over), checked against a month-end resample."""
    _serve(install_worker, monkeypatch, PUBLISHED, items=ITEMS)
    s = _tech()["data"]["seasonality"]
    assert s["window"] == {"start": "1990-02", "end": "2026-08", "n": 439}
    by = {r["label"]: r for r in s["rows"]}
    assert (by["Jan"]["n"], by["Jan"]["first_year"], by["Sep"]["last_year"]) == (36, 1991, 2025)
    assert by["Nov"]["avg"] == pytest.approx(0.021739, abs=5e-7) and by["Nov"]["pct_up"] == pytest.approx(0.75)
    assert by["Sep"]["avg"] == pytest.approx(-0.007177, abs=5e-7) and by["Sep"]["pct_up"] == pytest.approx(0.5)
