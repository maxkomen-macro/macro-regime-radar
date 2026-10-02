"""tests/test_desk_v2_overview.py — GET /overview (desk/frame-3-api, B2 commit 9).

docs/desk/FRAME3_API_PLAN.md §1.1, §1.10 R4/R6/R8/R9, §1.11 N5/N9/N10 and §5.
/overview composes the Ledger rows, the technicals, regime and recession items
and the stored facts of one generation; its since-last-close line, the K−2
selection and the data status are computed for each response. The hermetic
store is the engine suite's synthetic store plus the recession model's
monthly inputs (raw_series) and the Desk's watermarks, so every block serves.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import analytics_cache, desk_catalog as catalog, desk_envelope as env, desk_items, desk_v2
from api import calendar as nyse
from api import freshness as fr
from api.main import app
from src.analytics import dbpath
from src.desk import event_study as es
from tests import desk_contract as dc
from tests.test_desk_v2_study import _serve
from tests.test_event_study import _synthetic_db

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS
         if n.startswith(("desk_assets", "desk_study:", "desk_preset:", "desk_technicals", "desk_facts", "desk_regime"))
         or n == "recession"]
# desk/fill-compute (item 7): the VIX is a close (^VIX in asset_prices), judged by the closes' rule after ^GSPC and GC=F.
SEVEN = ["T10Y2Y", "BAMLH0A0HYM2", "DGS2", "DGS10", "^GSPC", "GC=F", "^VIX"]
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
    assert s["oldest_behind"] is None  # every contributor current on Sep 18
    assert client.get("/api/desk/overview?x=1").status_code == 422


def test_the_refresh_time_is_the_last_run_and_a_series_left_behind_is_named(install_worker, monkeypatch, overview_path, tmp_path):
    """fix/freshness 3d: refreshed_at_utc is when the full refresh last ran the Desk store (the summary
    watermark's checked_at), not its advanced_at, which moves only when the laggard series does; the series
    the run left behind is named on its own (the oldest of the data-status contributors not current)."""
    copy = tmp_path / "macro_radar.db"
    copy.write_bytes(overview_path.read_bytes())
    with sqlite3.connect(copy) as conn:
        conn.execute("UPDATE source_watermarks SET advanced_at = '2026-09-10T05:07:11Z', checked_at = '2026-09-30T16:52:45Z' "
                     "WHERE source = 'desk_series'")
    _serve(install_worker, monkeypatch, copy, items=ITEMS)
    _at(monkeypatch, 2026, 9, 30, 21, 0)  # the synthetic store's daily series end Sep 18: behind by then
    d = _overview()
    s = d["since_last_close"]["data"]
    assert s["refreshed_at_utc"] == "2026-09-30T16:52:45Z"
    behind = [c for c in d["data_status"]["data"]["contributors"] if c["state"] != "current"]
    assert behind, "the synthetic store is behind on Sep 30"
    oldest = min(behind, key=lambda c: (c["observation_date"] or "", c["series"]))
    assert s["oldest_behind"] == {"series": oldest["series"], "observation_date": oldest["observation_date"],
                                  "state": oldest["state"], "reason": oldest["reason"]}


def test_oldest_behind_picks_the_oldest_of_those_behind():
    rows = [{"series": "DGS10", "observation_date": "2026-09-28", "state": "current", "reason": "a"},
            {"series": "GC=F", "observation_date": "2026-09-25", "state": "stale", "reason": "b"},
            {"series": "^VIX", "observation_date": "2026-09-24", "state": "stale", "reason": "c"}]
    assert desk_v2.oldest_behind({"contributors": rows}) == {"series": "^VIX", "observation_date": "2026-09-24", "state": "stale", "reason": "c"}
    assert desk_v2.oldest_behind({"contributors": rows + [{"series": "T10Y2Y", "observation_date": None, "state": "missing", "reason": "d"}]})["series"] == "T10Y2Y"
    assert desk_v2.oldest_behind({"contributors": rows[:1]}) is None


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


def test_the_regime_tile_is_the_newest_row_whatever_the_session(served, monkeypatch):
    """fix/freshness 3a (D2): the tile is the newest stored row, the label and month the Dashboard shows, never
    the K−2 row of the session's month, so it does not move at a month boundary (the synthetic store's newest row is
    2026-07, Goldilocks). The store keeps no CPI or INDPRO watermark, so it cannot date when that row became known:
    since-last-close names the label and says nothing about a change."""
    for args, sessions in (((2026, 9, 18, 21, 0), ("2026-09-18", "2026-09-17")), ((2026, 7, 1, 21, 0), ("2026-07-01", "2026-06-30")),
                           ((2026, 10, 1, 21, 0), ("2026-10-01", "2026-09-30"))):
        _at(monkeypatch, *args)
        d = _overview()
        s, tile = d["since_last_close"]["data"], d["tiles"]["regime"]["data"]
        assert (s["comparison_session"], s["prev_session"]) == sessions
        assert (tile["print"], tile["label"], tile["months_in"]) == ("2026-07", "Goldilocks", 3)
        assert (s["regime_from"], s["regime_to"], s["regime_changed"]) == (None, "Goldilocks", None)


def test_since_last_close_dates_the_newest_row_by_when_the_store_learned_it():
    """fix/freshness 3a: the newest row changed since the last close only when the store learned it (the later of
    the CPI and INDPRO watermark advances) after the previous session's close; then it is read against the row before."""
    item = {"rows": [{"month": "2026-07", "label": "Goldilocks"}, {"month": "2026-08", "label": "Overheating"}],
            "newest_known_at": "2026-09-22T14:48:02Z"}
    assert desk_v2.regime_since(item, "2026-09-29") == ("Overheating", "Overheating", False)
    assert desk_v2.regime_since(item, "2026-09-22") == ("Overheating", "Overheating", False)  # learned before the 16:00 ET close
    assert desk_v2.regime_since(item, "2026-09-21") == ("Goldilocks", "Overheating", True)
    same = {**item, "rows": [{"month": "2026-07", "label": "Overheating"}, item["rows"][1]]}
    assert desk_v2.regime_since(same, "2026-09-21") == ("Overheating", "Overheating", False)
    assert desk_v2.regime_since({**item, "newest_known_at": None}, "2026-09-29") == (None, "Overheating", None)
    assert desk_v2.regime_since({"rows": [], "newest_known_at": None}, "2026-09-29") == (None, None, None)


def test_the_newest_row_is_dated_by_both_of_its_inputs():
    from api import desk_items_macro as items

    conn = sqlite3.connect(":memory:")
    conn.execute(WATERMARKS_DDL)
    rows = [{"month": "2026-08", "label": "Overheating"}]
    assert items.newest_known_at(conn, rows) is None  # no watermark for either input
    conn.execute("INSERT INTO source_watermarks VALUES ('fred:CPIAUCSL', '2026-08-01', 0, '2026-09-15T13:00:00Z', 'x', 'ok', NULL)")
    assert items.newest_known_at(conn, rows) is None  # INDPRO not stored for August yet
    conn.execute("INSERT INTO source_watermarks VALUES ('fred:INDPRO', '2026-08-01', 0, '2026-09-17T14:00:00Z', 'x', 'ok', NULL)")
    assert items.newest_known_at(conn, rows) == "2026-09-17T14:00:00Z"
    conn.execute("UPDATE source_watermarks SET last_obs = '2026-07-01' WHERE source = 'fred:INDPRO'")
    assert items.newest_known_at(conn, rows) is None  # a watermark on another month dates nothing


def test_the_regime_run_stops_at_a_missing_month():
    rows = [{"month": m, "label": lab} for m, lab in (("2025-07", "A"), ("2025-08", "B"), ("2025-09", "B"),
                                                      ("2025-11", "B"), ("2025-12", "B"), ("2026-01", "B"))]
    assert desk_v2.regime_run(rows, "2026-01") == (3, "2025-11")
    assert desk_v2.regime_run(rows, "2025-09") == (2, "2025-08")
    # The K−2 rule stays the engine's, for events (fix/freshness 3a); the tile no longer selects by it.
    from api import desk_v2_macro as v2m

    assert v2m.print_for(date(2026, 1, 5)) == "2025-11" and v2m.print_for(date(2026, 9, 18)) == "2026-07"


# ── Codex round 2, R-03: a direction only from a finite stored slope ────────

@pytest.mark.parametrize(("trend", "word"), [
    (0.4, "rising"), (1e-12, "rising"), (0.0, "falling"), (-0.3, "falling"), (None, None), (float("nan"), None),
    (float("inf"), None), (float("-inf"), None), ("x", None)])
def test_a_direction_is_read_only_from_a_finite_slope(trend, word):
    assert desk_v2._direction(trend) == word
    row = {"month": "2026-07", "label": "Goldilocks", "growth_trend": 0.2, "inflation_trend": 0.2}
    for axis in ("growth_trend", "inflation_trend"):
        rows = [{**row, axis: trend}]
        if word is None:
            with pytest.raises(env.Awaiting) as exc:
                desk_v2.regime_tile(rows)
            assert exc.value.reason == env.BLOCK_FAILED_REASON
        else:
            tile = desk_v2.regime_tile(rows)
            assert tile[axis.removesuffix("_trend")] == word and tile["label"] == "Goldilocks"


def _without_a_slope(src: Path, dst: Path, axis: str, value, month: str = "2026-07") -> Path:
    """A byte copy of `src` whose `month` regimes row (the newest stored row the
    tile shows: 2026-07 on the synthetic store) stores `value` for `axis`."""
    dst.write_bytes(src.read_bytes())
    with sqlite3.connect(dst) as conn:
        n = conn.execute(f"UPDATE regimes SET {axis} = ? WHERE substr(date, 1, 7) = ?", (value, month)).rowcount
    assert n == 1, f"one stored {month} row"
    return dst


def _regime_awaits(d: dict) -> None:
    assert d["tiles"]["regime"] == {"status": "awaiting", "data": None, "unavailable": {
        "reason": "Awaiting refresh: this could not be computed from the current data.", "until": None}}
    assert d["tiles"]["recession"]["status"] == d["tiles"]["trend"]["status"] == "ready"
    assert d["since_last_close"]["data"]["regime_to"] is not None, "the label is stored; only the tile's direction is not"


@pytest.mark.parametrize("value", [None, float("inf"), float("-inf")])
@pytest.mark.parametrize("axis", ["growth_trend", "inflation_trend"])
def test_a_missing_slope_makes_the_regime_tile_await(install_worker, monkeypatch, overview_path, tmp_path, axis, value):
    _serve(install_worker, monkeypatch, _without_a_slope(overview_path, tmp_path / "macro_radar.db", axis, value),
           items=ITEMS)
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    _regime_awaits(_overview())


PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", Path(__file__).resolve().parent.parent / "data" / "macro_radar.db"))


@pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")
@pytest.mark.parametrize("axis", ["growth_trend", "inflation_trend"])
def test_on_a_scratch_copy_of_the_published_store_a_null_slope_awaits(install_worker, monkeypatch, tmp_path, axis):
    """Codex's repro, on the row the tile shows since fix/freshness 3a (D2): the published copy's newest row
    (2026-08, Overheating, the Dashboard's label) with one slope NULL."""
    # Codex R-22: which store this is is read from the file itself, never from the tile under test, so a tile
    # that stops being ready fails here instead of skipping.
    from contextlib import closing

    with closing(sqlite3.connect(f"file:{PUBLISHED}?mode=ro", uri=True)) as conn:
        row = conn.execute("SELECT substr(date, 1, 7), label, growth_trend, inflation_trend FROM regimes ORDER BY date DESC LIMIT 1").fetchone()
    if row is None or row[:2] != ("2026-08", "Overheating") or row[2] is None or row[3] is None:
        pytest.skip(f"not the audit's store: its newest regimes row is {row[:2] if row else None}, not ('2026-08', 'Overheating') with both slopes")
    newest = row[0]
    _serve(install_worker, monkeypatch, PUBLISHED, items=ITEMS)
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    tile = _overview()["tiles"]["regime"]
    assert tile["status"] == "ready", tile
    assert tile["data"]["print"] == newest
    assert tile["data"]["label"] == "Overheating" and tile["data"]["odds"] == pytest.approx(0.4246)
    _serve(install_worker, monkeypatch, _without_a_slope(PUBLISHED, tmp_path / "macro_radar.db", axis, None, month=newest), items=ITEMS)
    _regime_awaits(_overview())


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
    return ({sid: d for sid in desk_v2.DATA_STATUS_FRED}, {"^GSPC": px, "GC=F": px, "^VIX": px})


def test_each_fred_contributor_is_desk_series_states_mapped():
    from api import desk as desk_mod

    now = datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc)
    stored = {"T10Y2Y": "2026-09-23", "BAMLH0A0HYM2": "2026-09-15", "DGS2": "2026-09-22", "DGS10": "2026-09-22"}
    got = {c["series"]: c for c in _status(now, stored, {"^GSPC": "2026-09-23", "GC=F": "2026-09-23", "^VIX": "2026-09-23"})["contributors"]}
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


def test_the_vix_is_a_close_and_takes_the_closes_rule():
    """desk/fill-compute (item 7): ^VIX is judged like ^GSPC, not by FRED's
    tolerance: a session behind the close due is stale once the grace has
    passed, current inside it."""
    stored, prices = _all_current("2026-09-23", "2026-09-23")
    now = datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc)
    got = {c["series"]: c for c in _status(now, stored, prices)["contributors"]}
    assert got["^VIX"]["state"] == "current" and got["^VIX"]["expected_observation_date"] == "2026-09-23"
    behind = {c["series"]: c for c in _status(now, stored, dict(prices, **{"^VIX": "2026-09-22"}))["contributors"]}
    assert behind["^VIX"]["state"] == "stale" and behind["^GSPC"]["state"] == "current"
    inside = {c["series"]: c for c in _status(datetime(2026, 9, 24, 3, 0, tzinfo=timezone.utc), stored,
                                               dict(prices, **{"^VIX": "2026-09-22"}))["contributors"]}
    assert inside["^VIX"]["state"] == "current" and "06:00 UTC" in inside["^VIX"]["reason"]


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
    assert {c["state"] for c in before_refresh["contributors"][:4]} == {"missing"}


def test_the_route_judges_at_the_responses_now(served, monkeypatch):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    a = _overview()["data_status"]["data"]
    _at(monkeypatch, 2026, 10, 5, 21, 0)  # two weeks after the store's last rows
    b = _overview()["data_status"]["data"]
    assert a["state"] == "current" and b["state"] == "stale"
    assert all(c["state"] == "stale" for c in b["contributors"])


# ── the VIX's band and its gap to realized volatility (desk/fill-compute) ──

def test_realized_vol_is_21_log_returns_annualized_and_a_gap_voids_its_windows():
    import math
    import statistics

    from src.analytics import technicals

    px = pd.Series(100 * np.cumprod(1 + np.random.default_rng(9).normal(0, 0.01, 40)))
    rv = technicals.realized_vol(px)
    r = [math.log(b / a) for a, b in zip(px[:-1], px[1:])]
    assert np.isnan(rv.iloc[:21]).all()
    assert rv.iloc[21] == pytest.approx(100 * math.sqrt(252) * statistics.stdev(r[:21]), rel=1e-12)
    assert rv.iloc[39] == pytest.approx(100 * math.sqrt(252) * statistics.stdev(r[-21:]), rel=1e-12)
    gappy = px.copy()
    gappy.iloc[30] = np.nan
    g = technicals.realized_vol(gappy)
    assert np.isnan(g.iloc[30:40]).all() and g.iloc[29] == pytest.approx(rv.iloc[29])


@pytest.mark.parametrize(("vix", "band"), [(14.99, "calm"), (15.0, "subdued"), (24.99, "subdued"), (25.0, "stressed")])
def test_the_vix_band_is_the_home_pages_words(vix, band):
    assert desk_v2.vix_band(vix) == band and desk_v2.VIX_BAND_EDGES == (15.0, 25.0)


def test_the_gap_is_on_the_latest_session_with_both():
    dates = es.sessions_between(es.session_calendar("2026-06-01", "2026-09-18"), "2026-06-01", "2026-09-18")
    spx = pd.Series(100 * np.cumprod(1 + np.random.default_rng(2).normal(0, 0.01, len(dates))), index=dates)
    vix = pd.Series(15.0 + np.arange(len(dates)) * 0.01, index=dates)
    g = desk_items.vol_gap(spx, vix)
    assert g["date"] == "2026-09-18" and g["gap_pts"] == pytest.approx(g["vix"] - g["realized_21d"])
    assert g["window"] == {"start": dates[-22].strftime("%Y-%m-%d"), "end": "2026-09-18", "n": 21}
    # a missing S&P close holds the gap on the session before it: no window may read it
    held = desk_items.vol_gap(spx.drop(dates[-3]), vix)
    assert held["date"] == dates[-4].strftime("%Y-%m-%d") and held["vix"] == vix.iloc[-4]
    assert desk_items.vol_gap(spx.iloc[:10], vix) is None


def test_the_vol_tile_serves_the_band_and_the_gap(served, monkeypatch, overview_path):
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    v = _overview()["tiles"]["vol"]["data"]
    assert v["band"] == desk_v2.vix_band(v["vix"]) and v["band_edges"] == [15.0, 25.0]
    g = v["gap"]
    assert g is not None and g["date"] <= v["date"] and g["gap_pts"] == pytest.approx(g["vix"] - g["realized_21d"])
    conn = sqlite3.connect(f"file:{overview_path}?mode=ro", uri=True)
    try:
        stored = dict(conn.execute("SELECT date, close FROM asset_prices WHERE symbol = '^GSPC' AND interval = '1d' "
                                   "AND date BETWEEN ? AND ?", (g["window"]["start"], g["date"])).fetchall())
    finally:
        conn.close()
    # the XNYS sessions of the window (the synthetic store holds off-session rows the engine drops)
    sessions = es.sessions_between(es.session_calendar(g["window"]["start"], g["date"]), g["window"]["start"], g["date"])
    closes = [stored[d.strftime("%Y-%m-%d")] for d in sessions]
    import math
    import statistics

    assert len(closes) == 22
    rets = [math.log(b / a) for a, b in zip(closes, closes[1:])]
    assert g["realized_21d"] == pytest.approx(100 * math.sqrt(252) * statistics.stdev(rets), rel=1e-12)


def test_before_the_refresh_stores_the_vix_the_vol_tile_says_so(install_worker, monkeypatch, overview_path, tmp_path):
    """desk/fill-compute (item 7): a store its next full refresh has not reached
    (no ^VIX rows yet, the deployed store after the merge) awaits with the
    engine's words, not the generic reason; the data status names ^VIX missing."""
    path = tmp_path / "macro_radar.db"
    src = sqlite3.connect(f"file:{overview_path}?mode=ro", uri=True)
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    dst.execute("DELETE FROM asset_prices WHERE symbol = '^VIX'")
    dst.commit()
    dst.close()
    _serve(install_worker, monkeypatch, path, items=ITEMS)
    _at(monkeypatch, 2026, 9, 18, 21, 0)
    d = _overview()
    vol = d["tiles"]["vol"]
    assert vol["status"] == "awaiting" and "next full refresh" in vol["unavailable"]["reason"], vol
    by = {c["series"]: c for c in d["data_status"]["data"]["contributors"]}
    assert by["^VIX"]["state"] == "missing" and d["data_status"]["data"]["state"] == "missing"
    assert d["since_last_close"]["data"]["vol_change_pts"] is None
