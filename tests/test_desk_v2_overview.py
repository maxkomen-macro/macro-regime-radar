"""tests/test_desk_v2_overview.py — GET /overview (desk/frame-3-api, B2 commit 9).

docs/desk/FRAME3_API_PLAN.md §1.1, §1.10 R4/R6/R8/R9, §1.11 N5/N9/N10 and §5.
/overview composes the Ledger rows, the technicals, regime and recession items
and the stored facts of one generation; its since-last-close line, the K−2
selection and the data status are computed for each response. The hermetic
store is the engine suite's synthetic store plus the recession model's
monthly inputs (raw_series) and the Desk's watermarks, so every block serves.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk_catalog as catalog, desk_envelope as env, desk_v2
from api import calendar as nyse
from api import freshness as fr
from api.main import app
from src.analytics import dbpath
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve
from tests.test_event_study import _synthetic_db

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS
         if n.startswith(("desk_assets", "desk_study:", "desk_preset:", "desk_technicals", "desk_facts", "desk_regime"))
         or n == "recession"]
SEVEN = ["T10Y2Y", "VIXCLS", "BAMLH0A0HYM2", "DGS2", "DGS10", "^GSPC", "GC=F"]
WATERMARKS_DDL = """CREATE TABLE IF NOT EXISTS source_watermarks (source TEXT PRIMARY KEY, last_obs TEXT, last_value REAL,
advanced_at TEXT, checked_at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT)"""
RAW_DDL = """CREATE TABLE IF NOT EXISTS raw_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id TEXT NOT NULL,
date TEXT NOT NULL, value REAL NOT NULL, fetched_at TEXT NOT NULL, UNIQUE(series_id, date))"""


def _overview_db(path: Path) -> Path:
    """The synthetic store, plus monthly recession inputs (the NBER dates stand
    in for USREC) and the Desk store's summary watermark."""
    _synthetic_db(path)
    rng = np.random.default_rng(11)
    months = pd.date_range("1990-01-01", "2026-08-01", freq="MS")
    n = len(months)
    series = {
        "DGS10": 5 + np.cumsum(rng.normal(0, 0.15, n)) * 0.2, "DGS2": 4 + np.cumsum(rng.normal(0, 0.15, n)) * 0.2,
        "UNRATE": 5 + np.abs(np.cumsum(rng.normal(0, 0.1, n))) * 0.3, "BAMLH0A0HYM2": 4 + np.abs(rng.normal(0, 1, n)),
        "INDPRO": 80 * np.cumprod(1 + rng.normal(0.001, 0.005, n)), "T10YIE": 2.2 + rng.normal(0, 0.2, n),
        "T5YIE": 2.0 + rng.normal(0, 0.2, n),
    }
    conn = sqlite3.connect(path)
    conn.execute(RAW_DDL)
    conn.execute(WATERMARKS_DDL)
    # the other tables api/db.freshness reads its stored maxima from (empty here)
    for ddl in ("CREATE TABLE signals (date TEXT)", "CREATE TABLE market_daily (date TEXT)",
                "CREATE TABLE market_intraday (ts TEXT)", "CREATE TABLE news_feed (published_at TEXT)"):
        conn.execute(ddl)
    for sid, vals in series.items():
        conn.executemany("INSERT INTO raw_series (series_id, date, value, fetched_at) VALUES (?,?,?,?)",
                         [(sid, m.strftime("%Y-%m-%d"), float(v), "t") for m, v in zip(months, vals)])
    conn.execute("INSERT OR REPLACE INTO source_watermarks VALUES ('desk_series', '2026-09-18', NULL, "
                 "'2026-09-19T05:07:11Z', '2026-09-19T05:07:11Z', 'ok', NULL)")
    # the classifier's own column, which get_recession_metrics reads (a NULL there empties its answer)
    conn.execute("UPDATE regimes SET prob_recession = 0.1")
    conn.commit()
    conn.close()
    return path


@pytest.fixture(scope="module")
def overview_path(tmp_path_factory) -> Path:
    return _overview_db(tmp_path_factory.mktemp("overview") / "macro_radar.db")


@pytest.fixture()
def served(install_worker, monkeypatch, overview_path):
    return _serve(install_worker, monkeypatch, overview_path, items=ITEMS)


def _at(monkeypatch, *args):
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(*args, tzinfo=timezone.utc))


def _overview() -> dict:
    return dc.check_response("/overview", client.get("/api/desk/overview"))["data"]


# ── the composition ─────────────────────────────────────────────────────────

def test_the_overview_shape(served, monkeypatch):
    _at(monkeypatch, 2026, 9, 18, 21, 0)  # after the last stored close
    d = _overview()
    for path in ("since_last_close", "tiles.regime", "tiles.recession", "tiles.trend", "tiles.vol", "data_status"):
        node = d
        for part in path.split("."):
            node = node[part]
        assert node["status"] == "ready", (path, node)
    assert [c["series"] for c in d["data_status"]["data"]["contributors"]] == SEVEN
    s = d["since_last_close"]["data"]
    assert (s["comparison_session"], s["prev_session"]) == ("2026-09-18", "2026-09-17")
    assert s["refreshed_at_utc"] == "2026-09-19T05:07:11Z"
    assert client.get("/api/desk/overview?x=1").status_code == 422


def test_active_signals_follow_r6(served, monkeypatch):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    d = _overview()
    ledger = dc.check_response("/ledger", client.get("/api/desk/ledger"))["data"]["signals"]
    firing = {r["slug"] for r in ledger if r["available"] and r["firing_now"] and not r["stale"]}
    recent = sorted((r for r in ledger if r["last_fired"]), key=lambda r: (r["last_fired"], r["slug"]), reverse=True)[:5]
    chosen = firing | {r["slug"] for r in recent}
    want = sorted((r for r in ledger if r["slug"] in chosen), key=lambda r: (
        r["slug"] not in firing, r["last_fired"] is None,
        -date.fromisoformat(r["last_fired"]).toordinal() if r["last_fired"] else 0, r["slug"]))
    assert d["active_signals"] == want
    assert len({r["slug"] for r in d["active_signals"]}) == len(d["active_signals"]), "each row once"


def test_active_signals_ordering_rule():
    rows = [{"slug": s, "available": True, "firing_now": f, "stale": st, "last_fired": lf} for s, f, st, lf in (
        ("a", False, False, "2026-01-02"), ("b", True, False, "2025-01-01"), ("c", True, True, "2026-09-01"),
        ("d", False, False, "2026-03-01"), ("e", False, False, None), ("f", False, False, "2026-03-01"),
        ("g", False, False, "2024-01-01"), ("h", False, False, "2020-01-01"), ("i", True, False, None))]
    got = [r["slug"] for r in desk_v2.active_signals(rows)]
    # firing and not stale: b, i; the five latest last_fired: c, d, f, a, b; stale c is not firing
    assert got == ["b", "i", "c", "d", "f", "a"]


def test_ledger_overview_and_study_agree_for_a_slug(served, monkeypatch):
    """B-05, case 11: one generation, one now, one firing state."""
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    ov = _overview()
    ledger = {r["slug"]: r for r in dc.check_response("/ledger", client.get("/api/desk/ledger"))["data"]["signals"]}
    for row in ov["active_signals"]:
        assert row == ledger[row["slug"]]
    new = {x["slug"] for x in ov["since_last_close"]["data"]["new_fires"]}
    still = {x["slug"]: x["firing_day"] for x in ov["since_last_close"]["data"]["still_firing"]}
    for slug, row in ledger.items():
        if not row["available"]:
            continue
        study = dc.check_response("/study", client.get(f"/api/desk/study?preset={slug}"))["data"]
        for k in ("firing_now", "firing_day", "evaluated_on", "stale"):
            assert row[k] == study[k], (slug, k)
        if slug in still:
            assert still[slug] == row["firing_day"] and row["firing_now"] and not row["stale"]
        if slug in new:
            assert row["firing_now"] and not row["stale"]


# ── N10: the since-last-close comparisons ───────────────────────────────────

def _vix(path: Path) -> dict[str, float]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return dict(conn.execute("SELECT date, value FROM desk_series WHERE series_id = 'VIXCLS'").fetchall())
    finally:
        conn.close()


def test_the_vix_change_is_between_the_two_sessions(served, monkeypatch, overview_path):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    s = _overview()["since_last_close"]["data"]
    vix = _vix(overview_path)
    assert s["vol_change_pts"] == pytest.approx(vix["2026-09-18"] - vix["2026-09-17"], abs=1e-12)
    _at(monkeypatch, 2026, 9, 22, 21, 0)  # the store has no VIX for the 21st or 22nd
    assert _overview()["since_last_close"]["data"]["vol_change_pts"] is None


def test_the_regime_comparison_and_the_k_minus_2_selection(served, monkeypatch):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    d = _overview()
    s, tile = d["since_last_close"]["data"], d["tiles"]["regime"]["data"]
    assert tile["print"] == "2026-07" and s["regime_to"] == tile["label"] and s["regime_changed"] is False
    # the synthetic labels change every six months from 1996-05: 2026-04 and 2026-05 differ
    _at(monkeypatch, 2026, 7, 1, 21, 0)
    s = _overview()["since_last_close"]["data"]
    assert (s["comparison_session"], s["prev_session"]) == ("2026-07-01", "2026-06-30")
    assert s["regime_from"] != s["regime_to"] and s["regime_changed"] is True
    _at(monkeypatch, 2026, 10, 1, 21, 0)  # K−2 = 2026-08: not stored
    d = _overview()
    assert d["tiles"]["regime"] == {"status": "awaiting", "data": None, "unavailable": {
        "reason": "Awaiting refresh: this could not be computed from the current data.", "until": None}}
    s = d["since_last_close"]["data"]
    assert s["regime_to"] is None and s["regime_from"] is not None and s["regime_changed"] is None


def test_the_regime_run_stops_at_a_missing_month():
    rows = [{"month": m, "label": lab} for m, lab in (("2025-07", "A"), ("2025-08", "B"), ("2025-09", "B"),
                                                      ("2025-11", "B"), ("2025-12", "B"), ("2026-01", "B"))]
    assert desk_v2.regime_run(rows, "2026-01") == (3, "2025-11")
    assert desk_v2.regime_run(rows, "2025-09") == (2, "2025-08")
    assert desk_v2.k_minus_2("2026-01-05") == "2025-11" and desk_v2.k_minus_2("2026-09-18") == "2026-07"


# ── the recession tile: R4, N5 ──────────────────────────────────────────────

@pytest.mark.parametrize("score", [0.0, 0.1999, 0.20, 0.3999, 0.40, 0.95])
def test_the_recession_band_is_the_models_own_edges(score):
    from src.analytics.recession import _classify_prob

    words = {"Low Risk": "low", "Elevated": "elevated", "High Risk": "high_risk"}
    assert desk_v2.recession_band(score) == words[_classify_prob(score * 100)[0]]


def test_the_recession_provenance_dates_the_served_score(served, monkeypatch):
    from src.analytics.recession import get_recession_metrics, recession_provenance

    _at(monkeypatch, 2026, 9, 18, 21, 0)
    tile = _overview()["tiles"]["recession"]["data"]
    with dbpath.pinned(served.current):
        prov = recession_provenance()
        metrics = get_recession_metrics()
    served_dates = [d.strftime("%Y-%m-%d") for d in metrics["recession_prob_series"].index]
    assert prov["scoring_index"] == served_dates, "the extraction's scoring rows are the served score's"
    assert tile["probability_month"] == served_dates[-1][:7] == prov["probability_month"]
    last = pd.Timestamp(served_dates[-1])
    assert tile["inputs_through"] == (last - pd.DateOffset(months=3)).strftime("%Y-%m")  # no gap in these months
    assert tile["score"] == metrics["recession_prob"] / 100 and tile["band"] == desk_v2.recession_band(tile["score"])
    assert set(prov["feature_months"]) == set(["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"])


def test_without_the_models_inputs_the_recession_tile_awaits(install_worker, monkeypatch, tmp_path):
    _serve(install_worker, monkeypatch, _synthetic_db(tmp_path / "macro_radar.db"), items=ITEMS)
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    d = _overview()
    assert d["tiles"]["recession"]["unavailable"]["reason"] == env.BLOCK_FAILED_REASON
    assert d["tiles"]["regime"]["status"] == d["tiles"]["trend"]["status"] == "ready"


# ── N9, the data status (B-06): each contributor through its own policy ─────

FRED_BOND = {"BAMLH0A0HYM2", "DGS2", "DGS10", "T10Y2Y"}


def _status(now: datetime, stored: dict | None, prices: dict) -> dict:
    return desk_v2.data_status(now=now, stored=stored, watermarks={}, prices=prices)


def _all_current(d: str, px: str) -> tuple[dict, dict]:
    return ({sid: d for sid in desk_v2.DATA_STATUS_FRED}, {"^GSPC": px, "GC=F": px})


def test_each_fred_contributor_is_desk_series_states_mapped():
    from api import desk as desk_mod

    now = datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc)
    stored = {"T10Y2Y": "2026-09-23", "VIXCLS": "2026-09-22", "BAMLH0A0HYM2": "2026-09-15", "DGS2": "2026-09-22",
              "DGS10": "2026-09-22"}
    got = {c["series"]: c for c in _status(now, stored, {"^GSPC": "2026-09-23", "GC=F": "2026-09-23"})["contributors"]}
    specs = [s for s in desk_mod.desk_series_specs(stored) if s["id"] in stored]
    for r in fr.desk_series_states(stored=stored, specs=specs, watermarks={}, now=now):
        sid = r["id"][len("desk:"):]
        assert got[sid]["state"] == {"close": "current", "stale": "stale", "unknown": "missing"}[r["state"]], sid
        assert got[sid]["reason"] == r["reason"] and got[sid]["observation_date"] == stored[sid]
    assert got["BAMLH0A0HYM2"]["state"] == "stale"
    today = now.astimezone(nyse.NY).date()
    for sid in desk_v2.DATA_STATUS_FRED:
        want = fr._daily_expected_and_lag(today, today, sid in FRED_BOND)[0].isoformat()
        assert got[sid]["expected_observation_date"] == want, sid


def test_a_bond_holiday_is_not_a_missed_print():
    """DGS10's last observation is the Friday before Columbus Day; on Tuesday it is current."""
    stored, prices = _all_current("2026-10-13", "2026-10-13")
    stored["DGS10"] = "2026-10-09"
    got = {c["series"]: c for c in _status(datetime(2026, 10, 13, 21, 0, tzinfo=timezone.utc), stored, prices)["contributors"]}
    assert got["DGS10"]["state"] == "current" and got["DGS10"]["expected_observation_date"] == "2026-10-09"


def test_vix_a_day_behind_is_current():
    stored, prices = _all_current("2026-09-23", "2026-09-23")
    stored["VIXCLS"] = "2026-09-22"
    got = {c["series"]: c for c in _status(datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc), stored, prices)["contributors"]}
    assert got["VIXCLS"]["state"] == "current" and "1 business day(s) behind" in got["VIXCLS"]["reason"]


def test_a_price_inside_the_grace_is_current_and_past_it_stale():
    stored, _ = _all_current("2026-09-18", "2026-09-18")
    prices = {"^GSPC": "2026-09-17", "GC=F": "2026-09-18"}
    inside = {c["series"]: c for c in _status(datetime(2026, 9, 19, 3, 0, tzinfo=timezone.utc), stored, prices)["contributors"]}
    past = {c["series"]: c for c in _status(datetime(2026, 9, 19, 7, 0, tzinfo=timezone.utc), stored, prices)["contributors"]}
    assert inside["^GSPC"]["state"] == "current" and "06:00 UTC" in inside["^GSPC"]["reason"]
    assert past["^GSPC"]["state"] == "stale" and past["GC=F"]["state"] == "current"
    assert inside["^GSPC"]["expected_observation_date"] == "2026-09-18"


def test_an_unstored_contributor_is_missing_and_the_worst_decides():
    now = datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc)
    stored, prices = _all_current("2026-09-23", "2026-09-23")
    assert _status(now, stored, prices)["state"] == "current"
    stale = dict(stored, BAMLH0A0HYM2="2026-09-01")
    assert _status(now, stale, prices)["state"] == "stale"
    gone = {k: v for k, v in stale.items() if k != "DGS2"}
    got = _status(now, gone, dict(prices, **{"GC=F": None}))
    by = {c["series"]: c for c in got["contributors"]}
    assert by["DGS2"]["state"] == by["GC=F"]["state"] == "missing" and by["GC=F"]["observation_date"] is None
    assert got["state"] == "missing"
    before_refresh = _status(now, None, prices)
    assert {c["state"] for c in before_refresh["contributors"][:5]} == {"missing"}


def test_the_route_judges_at_the_responses_now(served, monkeypatch):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    a = _overview()["data_status"]["data"]
    _at(monkeypatch, 2026, 10, 5, 21, 0)  # two weeks after the store's last rows
    b = _overview()["data_status"]["data"]
    assert a["state"] == "current" and b["state"] == "stale"
    assert all(c["state"] == "stale" for c in b["contributors"])
