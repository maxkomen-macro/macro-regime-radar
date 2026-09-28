"""tests/test_desk_etf.py — the Desk's ETFs (desk/fill-etf).

Item 1: the 24 ETFs are registered in the Desk registry, stored in
asset_prices by the allocation refresh (src/market_data/asset_history.py; its
own tests cover the fetch, the volume and the short-history check), and
listed in the Data Pipeline inventory.
"""

from __future__ import annotations

from api import desk_pipeline as pipe
from src.desk import series as registry

SECTORS = ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")
OTHERS = ("SPY", "RSP", "IWM", "QQQ", "SMH", "SOXX", "IGV", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP")
ETFS = SECTORS + OTHERS


def test_the_24_etfs_are_registered_in_asset_prices_at_tier_2():
    specs = {s.series_id: s for s in registry.SERIES}
    for sym in ETFS:
        s = specs[sym]
        assert (s.source, s.table, s.tier, s.unit, s.available) == ("asset_prices", "asset_prices", 2, "log_return", True), sym
        assert s.key == sym.lower() and registry.stored_by_refresh(s), sym
    assert [t for t, *_ in registry.SECTOR_ETFS] == list(SECTORS)


def test_the_short_histories_are_declared_with_their_listing_dates():
    """XLC listed in June 2018 and XLRE in October 2015: the registry declares
    the provider's first close and says what that means for a statistic."""
    assert registry.get("xlc").history_from == "2018-06-19"
    assert registry.get("xlre").history_from == "2015-10-08"
    for key in ("xlc", "xlre"):
        assert "not available" in registry.get(key).note
    assert {registry.get(t.lower()).history_from for t in SECTORS if t not in ("XLC", "XLRE")} == {"1998-12-22"}


def test_only_the_nine_older_sector_etfs_keep_their_event_study_roles():
    """The nine that list from 1998-12-22 keep the roles the event study
    declared (the frozen entries of tests/fixtures/desk_entries_cc721f0.json
    name them); the other fifteen are read by the Sectors, Technicals and Macro
    tabs only, so no study can select them."""
    for sym in ETFS:
        want = ("shock", "condition") if sym in registry.SECTOR_NAMES else ()
        assert registry.get(sym.lower()).roles == want, sym


def test_every_etf_is_a_row_of_the_data_pipeline_inventory():
    groups = dict(pipe.PIPELINE_GROUPS)
    assert groups["Sector ETFs"] == SECTORS
    assert set(groups["Equity ETFs"]) | set(groups["Bond, gold & dollar ETFs"]) == set(OTHERS)
    assert set(ETFS) <= set(pipe.row_ids())


# ── Item 2: sector leadership (§12.14; /sectors and /technicals' sectors block) ──

import math  # noqa: E402
import os  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api import analytics_cache, db, desk_items_etf as etf  # noqa: E402
from api.main import app  # noqa: E402
from tests import desk_contract as dc  # noqa: E402
from tests import desk_etf_store as store  # noqa: E402
from tests.test_desk_v2_study import _serve  # noqa: E402
from tests.test_event_study import _synthetic_db  # noqa: E402

client = TestClient(app)
ITEMS = [(n, f) for n, f in analytics_cache.ITEMS
         if n in ("desk_etf", "desk_technicals", "desk_study:spx-20d-2sigma", "desk_study:golden-cross", "desk_study:death-cross")]
ALLOCATION_ETFS = ("SPY", "IWM", "IEF", "LQD", "HYG", "GLD")  # the ones the allocation refresh stored before desk/fill-etf


def _db(tmp_path: Path, name: str = "macro_radar.db", **kw) -> Path:
    return store.add_etfs(_synthetic_db(tmp_path / name), **kw)


def _item(monkeypatch, path: Path) -> dict:
    """The desk_etf item built on `path` directly (no generation)."""
    monkeypatch.setattr(db, "DB_PATH", path)
    return etf.desk_etf({})


def _expected(path: Path) -> tuple[str, str, dict[str, float | None]]:
    c = store.closes(path)
    days = store.sessions()
    t = max(c["SPY"])
    t0 = days[days.index(t) - 60]
    spy = math.log(c["SPY"][t] / c["SPY"][t0])
    rel = {}
    for s in store.SECTORS:
        p = c.get(s, {})
        rel[s] = math.log(p[t] / p[t0]) - spy if t in p and t0 in p else None
    return t, t0, rel


def test_leadership_is_each_sectors_60_session_log_return_less_spys(tmp_path, monkeypatch):
    path = _db(tmp_path)
    t, t0, rel = _expected(path)
    part = _item(monkeypatch, path)["sectors"]
    assert part["ok"], part
    d = part["data"]
    assert (d["compared_on"], d["window"], d["window_months"], d["unit"]) == (t, {"start": t0, "end": t, "n": 60}, 3, "log_return")
    rows = d["leadership"]
    assert [r["etf"] for r in rows] == sorted(rel, key=lambda s: -rel[s])  # best first
    for r in rows:
        assert r["rel_ret"] == pytest.approx(rel[r["etf"]], abs=1e-12), r["etf"]
        assert r["reason"] is None
    assert d["providers"] == ["Yahoo"] and d["source"] == "asset_prices" and d["date"] == t


def test_a_short_history_or_a_gap_is_null_with_its_reason_and_ranked_last(tmp_path, monkeypatch):
    """XLC listed within the window (as it would be for a window before June
    2018) and XLE without its latest close: each is null with the reason, never
    a value, and ranked after every served row; the pattern, which reads XLE,
    is not computed; XLC is in neither group."""
    days = store.sessions()
    probe = _db(tmp_path, "probe.db")
    t = max(store.closes(probe)["SPY"])
    i = days.index(t)
    path = _db(tmp_path, starts={"XLC": days[i - 30]}, drop={"XLE": (t,)})
    d = _item(monkeypatch, path)["sectors"]["data"]
    rows = {r["etf"]: r for r in d["leadership"]}
    assert rows["XLC"]["rel_ret"] is None and rows["XLC"]["reason"] == f"no close on {days[i - 60]}: its history starts {days[i - 30]}"
    assert rows["XLE"]["rel_ret"] is None and rows["XLE"]["reason"] == f"no close stored for {t}"
    assert [r["etf"] for r in d["leadership"][-2:]] == ["XLC", "XLE"]
    assert all(r["rel_ret"] is not None for r in d["leadership"][:-2])
    assert d["pattern"]["word"] is None and d["pattern"]["spread"] is None
    assert d["pattern"]["reason"] == "XLE not served, so the groups cannot be compared."


def test_a_spread_of_exactly_the_band_is_mixed(monkeypatch):
    """The rule is strict both ways; 0.5 keeps the arithmetic exact in binary."""
    monkeypatch.setattr(etf, "BAND", 0.5)
    rows = ([{"etf": s, "group": "cyclical", "rel_ret": 0.5} for s in ("XLB", "XLE", "XLF", "XLI", "XLK", "XLY")]
            + [{"etf": s, "group": "defensive", "rel_ret": 0.0} for s in ("XLP", "XLU", "XLV")])
    assert etf.pattern(rows)["spread"] == 0.5 and etf.pattern(rows)["word"] == "mixed"
    rows = [{**r, "rel_ret": -r["rel_ret"]} for r in rows]
    assert etf.pattern(rows)["word"] == "mixed"


def test_the_pattern_rule_names_its_groups_and_its_band():
    def rows(cyc: float, dfn: float) -> list[dict]:
        return ([{"etf": s, "group": "cyclical", "rel_ret": cyc} for s in ("XLB", "XLE", "XLF", "XLI", "XLK", "XLY")]
                + [{"etf": s, "group": "defensive", "rel_ret": dfn} for s in ("XLP", "XLU", "XLV")]
                + [{"etf": "XLC", "group": None, "rel_ret": None}, {"etf": "XLRE", "group": None, "rel_ret": 0.5}])

    assert etf.pattern(rows(0.02, 0.0))["word"] == "cyclical"
    assert etf.pattern(rows(-0.02, 0.0))["word"] == "defensive"
    assert etf.pattern(rows(0.005, 0.0))["word"] == "mixed"
    assert etf.pattern(rows(0.0, 0.02))["word"] == "defensive"
    p = etf.pattern(rows(0.03, 0.01))
    assert p["spread"] == pytest.approx(0.02) and p["cyclicals"] == ["XLB", "XLE", "XLF", "XLI", "XLK", "XLY"]
    assert p["defensives"] == ["XLP", "XLU", "XLV"] and p["rule"] == "sector-pattern-v1" and p["band"] == 0.01


def test_sectors_and_the_technicals_card_serve_one_leadership(tmp_path, install_worker, monkeypatch):
    path = _db(tmp_path)
    _serve(install_worker, monkeypatch, path, items=ITEMS)
    s = dc.check_response("/sectors", client.get("/api/desk/sectors"))
    assert s["status"] == "ready"
    t = dc.check_response("/technicals", client.get("/api/desk/technicals"))
    block = t["data"]["sectors"]
    assert block["status"] == "ready"
    assert block["data"] == {k: v for k, v in s["data"].items() if k != "breadth"}
    assert s["data"]["breadth"]["status"] == "ready"  # item 3
    assert s["generation_id"] == t["generation_id"]
    assert client.get("/api/desk/sectors?window=3").status_code == 422


def test_before_the_refresh_stores_them_sectors_awaits_it_and_technicals_stands(tmp_path, install_worker, monkeypatch):
    """A published database that predates the first full refresh after this
    change holds SPY and the other allocation ETFs but no sector ETF: /sectors
    is awaiting that refresh, in words that begin "Awaiting refresh", and
    /technicals serves everything else with its sectors block awaiting."""
    path = _db(tmp_path, only=ALLOCATION_ETFS)
    _serve(install_worker, monkeypatch, path, items=ITEMS)
    s = dc.check_response("/sectors", client.get("/api/desk/sectors"))
    reason = "Awaiting refresh: the full refresh stores " + ", ".join(store.SECTORS) + "; this database predates it."
    assert s["status"] == "awaiting" and s["unavailable"] == {"reason": reason, "until": None}
    t = dc.check_response("/technicals", client.get("/api/desk/technicals"))
    assert t["status"] == "ready" and t["data"]["price"] is not None
    assert t["data"]["sectors"] == {"status": "awaiting", "data": None, "unavailable": {"reason": reason, "until": None}}


ETF_STORE = os.environ.get("DESK_ETF_STORE")  # the fixture store scripts/desk_etf_fixtures.py builds


@pytest.mark.skipif(not ETF_STORE or not Path(ETF_STORE).exists(), reason="DESK_ETF_STORE (the fixture store) is not set")
def test_the_web_fixtures_are_what_the_api_serves_on_the_fixture_store(install_worker, monkeypatch):
    """web/src/fixtures/desk/sectors.json and technicals.json's sectors block are
    the API's answers on the fixture store (PROVENANCE.md), value for value."""
    import json

    fixtures = Path(__file__).resolve().parent.parent / "web" / "src" / "fixtures" / "desk"
    _serve(install_worker, monkeypatch, Path(ETF_STORE), items=ITEMS)
    served = client.get("/api/desk/sectors").json()["data"]
    fixture = json.loads((fixtures / "sectors.json").read_text())
    assert {k: v for k, v in fixture.items() if k not in ("as_of", "generation_id")} == served
    tech = json.loads((fixtures / "technicals.json").read_text())
    assert tech["sectors"] == client.get("/api/desk/technicals").json()["data"]["sectors"]


def test_the_pipeline_says_which_tabs_read_the_leadership_series():
    """The Data Pipeline's feeds (api/desk_pipeline.tab_readers) name what the
    ETF item reads: SPY and the eleven sector ETFs feed Sectors and Technicals."""
    from src.desk import series as registry

    assert set(pipe.LEADERSHIP_SERIES) == {registry.get(k).series_id for k in (etf.BENCHMARK, *etf.SECTOR_KEYS)}
    for sym in pipe.LEADERSHIP_SERIES:
        assert {"Technicals", "Sectors"} <= set(pipe.feeds_of(sym)), sym
        assert sym not in pipe.NO_LIVE_READER, sym


# ── Item 3: breadth, of the eleven sector ETFs (§12.14) ─────────────────────

def _above(c: dict, days: list[str], sym: str, t: str, w: int) -> bool | None:
    i = days.index(t)
    slots = days[i - w + 1:i + 1]
    p = c.get(sym, {})
    if not all(d in p for d in slots):
        return None
    return p[t] > sum(p[d] for d in slots) / w


def _rel(c: dict, days: list[str], sym: str, i: int) -> float | None:
    t, t0 = days[i], days[i - 60]
    p, spy = c.get(sym, {}), c["SPY"]
    if not all(d in p and d in spy for d in (t, t0)):
        return None
    return math.log(p[t] / p[t0]) - math.log(spy[t] / spy[t0])


def test_breadth_counts_the_eleven_sector_etfs_above_their_averages(tmp_path, monkeypatch):
    path = _db(tmp_path)
    c, days = store.closes(path), store.sessions()
    t = max(c["SPY"])
    b = _item(monkeypatch, path)["breadth"]
    assert b["ok"], b
    d = b["data"]
    assert (d["compared_on"], d["of_total"]) == (t, 11)
    for w in (50, 200):
        want = {s: _above(c, days, s, t, w) for s in store.SECTORS}
        got = d[f"above_{w}"]
        assert got["by_etf"] == want and got["n"] == sum(want.values()) and got["of"] == 11
        assert got["window"] == {"start": days[days.index(t) - w + 1], "end": t, "n": w} and got["not_available"] == []


def test_a_sector_without_the_history_or_the_close_is_not_available_never_below(tmp_path, monkeypatch):
    """XLC listed 100 sessions before t: its 50-day is read, its 200-day is not
    available; XLK without a close inside its 50 slots is not available there.
    Neither is counted as below: `of` drops by one where it is not available."""
    days = store.sessions()
    t = max(store.closes(_db(tmp_path, "probe.db"))["SPY"])
    i = days.index(t)
    path = _db(tmp_path, starts={"XLC": days[i - 99]}, drop={"XLK": (days[i - 10],)})
    d = _item(monkeypatch, path)["breadth"]["data"]
    a50, a200 = d["above_50"], d["above_200"]
    assert "XLC" in a50["by_etf"] and "XLC" not in a200["by_etf"]
    assert {"etf": "XLC", "reason": f"no close on {days[i - 199]}: its history starts {days[i - 99]}"} in a200["not_available"]
    assert a50["not_available"] == [{"etf": "XLK", "reason": f"no close stored for {days[i - 10]}"}]
    assert (a50["of"], a200["of"]) == (10, 9)  # XLK is out of both windows' reach; XLC of the 200-day only
    assert a50["n"] == sum(a50["by_etf"].values()) and a200["n"] == sum(a200["by_etf"].values())


def test_equal_and_small_against_spy_are_60_session_log_differences_with_a_one_year_line(tmp_path, monkeypatch):
    path = _db(tmp_path)
    c, days = store.closes(path), store.sessions()
    t = max(c["SPY"])
    i = days.index(t)
    d = _item(monkeypatch, path)["breadth"]["data"]
    import pandas as pd

    since = (pd.Timestamp(t) - pd.DateOffset(months=12)).strftime("%Y-%m-%d")
    line = [x for x in days if since < x <= t]
    for name, sym in (("eqw_vs_cap", "RSP"), ("small_vs_large", "IWM")):
        assert d[f"{name}_3m"] == pytest.approx(_rel(c, days, sym, i), abs=1e-12) and d[f"{name}_reason"] is None
        pts = d[f"{name}_series"]
        assert [p["date"] for p in pts] == line
        assert pts[-1]["rel"] == pytest.approx(d[f"{name}_3m"], abs=1e-12)
        assert pts[0]["rel"] == pytest.approx(_rel(c, days, sym, days.index(line[0])), abs=1e-12)
        assert d[f"{name}_line_window"] == {"start": line[0], "end": t, "n": len(line)}
    assert d["relative_window"] == {"start": days[i - 60], "end": t, "n": 60}


def test_without_rsp_the_equal_weight_line_awaits_the_refresh_and_the_rest_stands(tmp_path, monkeypatch):
    path = _db(tmp_path, only=tuple(x for x in store.ETFS if x != "RSP"))
    d = _item(monkeypatch, path)["breadth"]["data"]
    assert d["eqw_vs_cap_3m"] is None and d["eqw_vs_cap_series"] == [] and d["eqw_vs_cap_line_window"] is None
    assert d["eqw_vs_cap_reason"] == "Awaiting refresh: the full refresh stores RSP; this database predates it."
    assert d["small_vs_large_3m"] is not None and d["above_50"]["of"] == 11


def test_the_sectors_route_serves_breadth_as_its_block(tmp_path, install_worker, monkeypatch):
    _serve(install_worker, monkeypatch, _db(tmp_path), items=ITEMS)
    s = dc.check_response("/sectors", client.get("/api/desk/sectors"))
    b = s["data"]["breadth"]
    assert b["status"] == "ready" and b["data"]["of_total"] == 11 and b["data"]["compared_on"] == s["data"]["compared_on"]


def test_the_pipeline_says_the_breadth_series_feed_sectors():
    from src.desk import series as registry

    assert set(pipe.BREADTH_SERIES) == {registry.get(k).series_id for k in (etf.BENCHMARK, *etf.SECTOR_KEYS, "rsp", "iwm")}
    for sym in ("RSP", "IWM"):
        assert "Sectors" in pipe.feeds_of(sym) and sym not in pipe.NO_LIVE_READER, sym


# ── Item 4: do bonds still hedge stocks? (§12.8 stock_bond) ─────────────────

import numpy as np  # noqa: E402

from api import desk_v2_macro  # noqa: E402

MACRO_ITEMS = [(n, f) for n, f in analytics_cache.ITEMS if n in ("desk_etf", "desk_macro")]


def _returns(c: dict, days: list[str], sym: str) -> list[float | None]:
    p = c.get(sym, {})
    return [None] + [math.log(p[b] / p[a]) if a in p and b in p else None for a, b in zip(days, days[1:])]


def _pearson(x: list, y: list) -> float | None:
    """numpy's r, or None where it is undefined (a pair missing, or no variance, as a clipped level gives)."""
    if any(v is None for v in x + y) or np.std(x) == 0 or np.std(y) == 0:
        return None
    return float(np.corrcoef(np.array(x), np.array(y))[0, 1])


def _corr(c: dict, days: list[str], a: str, b: str, i: int) -> float | None:
    ra, rb = _returns(c, days, a), _returns(c, days, b)
    return _pearson(ra[i - 59:i + 1], rb[i - 59:i + 1])


def test_stock_bond_is_the_60_date_correlation_of_daily_log_returns(tmp_path, monkeypatch):
    path = _db(tmp_path)
    c, days = store.closes(path), store.sessions()
    t = max(set(c["SPY"]) & set(c["TLT"]))
    i = days.index(t)
    part = _item(monkeypatch, path)["stock_bond"]
    assert part["ok"], part
    d = part["data"]
    assert d["today_date"] == t and d["today"] == pytest.approx(_corr(c, days, "SPY", "TLT", i), abs=1e-12)
    assert d["window"] == {"start": days[i - 59], "end": t, "n": 60} and d["today_reason"] is None
    import pandas as pd

    ago = max(x for x in days if x <= (pd.Timestamp(t) - pd.DateOffset(months=12)).strftime("%Y-%m-%d"))
    assert d["year_ago_date"] == ago and d["year_ago"] == pytest.approx(_corr(c, days, "SPY", "TLT", days.index(ago)), abs=1e-12)
    line = [x for x in days if ago < x <= t]
    assert [p["date"] for p in d["series"]] == line and d["line_window"] == {"start": line[0], "end": t, "n": len(line)}
    k = days.index(line[len(line) // 2])
    assert d["series"][len(line) // 2]["corr"] == pytest.approx(_corr(c, days, "SPY", "TLT", k), abs=1e-12)
    # the newest change of sign, over every session with a complete window, zeros skipped
    signs = [(x, _corr(c, days, "SPY", "TLT", j)) for j, x in enumerate(days) if 60 <= j <= i]
    signs = [(x, v > 0) for x, v in signs if v is not None and v != 0]
    flips = [x for (_, a), (x, b) in zip(signs, signs[1:]) if a != b]
    assert d["flipped_on"] == (flips[-1] if flips else None)
    if flips:
        assert d["flipped"] == flips[-1][:7] and d["flipped_to"] == ("positive" if signs[-1][1] else "negative")
    assert (d["stock"]["etf"], d["bond"]["etf"], d["transform"]) == ("SPY", "TLT", "daily log return")


def test_a_missing_close_inside_the_window_makes_today_null_with_its_reason(tmp_path, monkeypatch):
    """No forward fill: a TLT session without a close leaves two returns
    incomplete, and the window that holds them has no correlation."""
    days = store.sessions()
    t = max(store.closes(_db(tmp_path, "probe.db"))["SPY"])
    i = days.index(t)
    d = _item(monkeypatch, _db(tmp_path, drop={"TLT": (days[i - 5],)}))["stock_bond"]["data"]
    assert d["today"] is None and d["today_reason"] == f"fewer than 60 complete daily return pairs in the window to {t}"
    assert d["series"][-1]["corr"] is None and d["year_ago"] is not None


def test_without_tlt_the_block_awaits_the_refresh_and_macro_stands(tmp_path, install_worker, monkeypatch):
    path = _db(tmp_path, only=ALLOCATION_ETFS)  # the allocation ETFs: SPY stored, TLT not
    _serve(install_worker, monkeypatch, path, items=MACRO_ITEMS)
    m = dc.check_response("/macro", client.get("/api/desk/macro"))
    assert m["status"] == "ready"
    assert m["data"]["stock_bond"]["unavailable"]["reason"] == "Awaiting refresh: the full refresh stores TLT; this database predates it."


def test_the_macro_route_serves_stock_bond_from_the_etf_item(tmp_path, install_worker, monkeypatch):
    _serve(install_worker, monkeypatch, _db(tmp_path), items=MACRO_ITEMS)
    m = dc.check_response("/macro", client.get("/api/desk/macro"))
    sb = m["data"]["stock_bond"]
    assert sb["status"] == "ready" and sb["data"]["today"] is not None
    assert desk_v2_macro.macro_payload()["stock_bond"] == sb
    assert "SPY" in pipe.STOCK_BOND_SERIES and "Macro" in pipe.feeds_of("TLT") and "TLT" not in pipe.NO_LIVE_READER


# ── Item 5: what moves with the S&P (§12.8 correlations) ────────────────────

def _vix(path: Path) -> dict[str, float]:
    import sqlite3

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return dict(conn.execute("SELECT date, value FROM desk_series WHERE series_id = 'VIXCLS'"))
    finally:
        conn.close()


CORR_ORDER = ["TLT", "IEF", "HYG", "LQD", "GLD", "UUP", "IWM", "QQQ", "VIXCLS"]


def test_each_asset_is_correlated_with_spy_over_60_daily_returns_to_its_own_date(tmp_path, monkeypatch):
    path = _db(tmp_path)
    c, days = store.closes(path), store.sessions()
    c["VIXCLS"] = {d: v for d, v in _vix(path).items() if d in set(days)}  # on the XNYS calendar, as aligned
    rows = _item(monkeypatch, path)["correlations"]["data"]
    assert [r["symbol"] for r in rows] == CORR_ORDER
    for r in rows:
        sym = r["symbol"]
        t = max(set(c["SPY"]) & set(c[sym]))
        i = days.index(t)
        assert r["date"] == t and r["window"] == {"start": days[i - 59], "end": t, "n": 60}, sym
        want_r = _corr(c, days, "SPY", sym, i)
        assert (r["corr"] is None) == (want_r is None) and (want_r is None or r["corr"] == pytest.approx(want_r, abs=1e-12)), sym
        # the synthetic VIX sits at its 9.0 floor through the window: complete pairs, no variation
        assert r["reason"] == (None if want_r is not None else f"no variation in one of the two series in the window to {t}"), sym
        want = ("index level (FRED VIXCLS)", "daily log change") if sym == "VIXCLS" else ("adjusted close", "daily log return")
        assert (r["quantity"], r["transform"]) == want, sym
    assert rows[-1]["asset"] == "VIX" and rows[0]["asset"] == "20+ year Treasuries"


def test_a_row_the_store_cannot_compute_says_why_and_the_rest_stand(tmp_path, monkeypatch):
    """QQQ not stored: its row awaits the refresh. GLD without a close inside
    its window: no forward fill, so its row says the window is incomplete."""
    days = store.sessions()
    t = max(store.closes(_db(tmp_path, "probe.db"))["SPY"])
    path = _db(tmp_path, only=tuple(x for x in store.ETFS if x != "QQQ"), drop={"GLD": (days[days.index(t) - 3],)})
    rows = {r["symbol"]: r for r in _item(monkeypatch, path)["correlations"]["data"]}
    assert rows["QQQ"]["corr"] is None and rows["QQQ"]["date"] is None
    assert rows["QQQ"]["reason"] == "Awaiting refresh: the full refresh stores QQQ; this database predates it."
    assert rows["GLD"]["corr"] is None and rows["GLD"]["reason"] == f"fewer than 60 complete daily return pairs in the window to {t}"
    assert rows["TLT"]["corr"] is not None


def test_without_vix_stored_the_list_leaves_it_out(tmp_path, monkeypatch):
    import sqlite3

    path = _db(tmp_path)
    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM desk_series WHERE series_id = 'VIXCLS'")
    conn.commit()
    conn.close()
    rows = _item(monkeypatch, path)["correlations"]["data"]
    assert [r["symbol"] for r in rows] == CORR_ORDER[:-1]


def test_the_macro_route_serves_the_correlations_and_keeps_the_matrix_awaiting(tmp_path, install_worker, monkeypatch):
    _serve(install_worker, monkeypatch, _db(tmp_path), items=MACRO_ITEMS)
    m = dc.check_response("/macro", client.get("/api/desk/macro"))
    assert m["data"]["correlations"]["status"] == "ready" and len(m["data"]["correlations"]["data"]) == 9
    assert m["data"]["matrix"]["unavailable"]["reason"] == "the 12-asset matrix's assets and method are not specified yet."
    for sym in CORR_ORDER:
        assert "Macro" in pipe.feeds_of(sym), sym


# ── Codex R-01: no definitive ranking when a sector's return is unavailable ──

def test_codex_r01_the_ranking_says_how_many_sectors_it_ranks_and_names_the_rest(tmp_path, monkeypatch):
    """Codex's repro: one sector without the history for the window (XLC
    listed inside it) and one without its latest close (XLE). The served
    leadership ranks the nine with data, says so (`ranked_n`), and names the
    two others with their reasons (`missing`), in the same order as the rows."""
    days = store.sessions()
    t = max(store.closes(_db(tmp_path, "probe.db"))["SPY"])
    i = days.index(t)
    d = _item(monkeypatch, _db(tmp_path, starts={"XLC": days[i - 30]}, drop={"XLE": (t,)}))["sectors"]["data"]
    assert d["ranked_n"] == 9 == sum(r["rel_ret"] is not None for r in d["leadership"])
    assert d["missing"] == [
        {"etf": "XLC", "name": "Communications", "reason": f"no close on {days[i - 60]}: its history starts {days[i - 30]}"},
        {"etf": "XLE", "name": "Energy", "reason": f"no close stored for {t}"},
    ]
    full = _item(monkeypatch, _db(tmp_path, "full.db"))["sectors"]["data"]
    assert (full["ranked_n"], full["missing"]) == (11, [])


# ── Codex R-03: the catalog page offers only what the catalog asks ──────────

def test_codex_r03_the_study_series_are_the_catalogs_inputs_and_the_legacy_roles_stay(tmp_path):
    """Codex's repro: the nine sector ETFs, tier 2 with roles since item 1,
    were listed in /study's series[] with ops [] (a Shock the page could not
    ask). series[] is now the registry's series some catalog study reads; the
    legacy /api/desk/event-study keeps every role (its assets list them)."""
    from api import desk_catalog, desk_v2
    from src.desk import event_study as es

    listed = desk_v2._series_list()
    keys = [s["key"] for s in listed]
    assert keys == ["spx", "gold", "us10y", "curve_2s10s", "vix", "hy_oas", "wti", "dxy"]
    assert set(keys) == desk_catalog.series_read()
    assert not any(k.startswith("xl") for k in keys)
    shocks = {q.question.shock for q in desk_catalog.CATALOG if q.question}
    assert all(s["ops"] or s["key"] not in shocks for s in listed)
    nine = {t.lower() for t in registry.SECTOR_NAMES}
    assets = es.assets_with_coverage(_db(tmp_path))
    assert nine <= {a["key"] for a in assets["shocks"]}
    assert all(registry.get(k).roles == ("shock", "condition") for k in nine)
