"""The event study on a basket (desk/basket-study, P1a; docs/desk/BASKET_STUDY_SPEC.md,
DESK_FRAME3_SPEC §12.19): the engine's supplied-series entry point
(src/desk/event_study.run_on_supplied_traced) and GET /api/desk/basket/study
(api/desk_basket.study).

The definition-matched control: a series handed to the engine as a supplied
series gives the stored study's statistics exactly, on the synthetic store and
on the published copy. The route is exercised with the provider mocked at
market.daily_closes_since_1995 (seeded random walks on the synthetic store's
sessions), so no network is touched."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import db, desk_basket
from api import worker as worker_mod
from api.main import app
from api.providers import market
from api.providers.errors import UnknownSymbol
from src.analytics import dbpath
from src.desk import event_study as es
from src.desk import series as registry
from tests.test_event_study import _synthetic_db

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = ROOT / "data" / "macro_radar.db"
client = TestClient(app, raise_server_exceptions=False)
SESSION = "2026-09-18"  # the synthetic store's last session
AS_OF = "2026-09-30"


def _supplied_from(level: pd.Series, key: str = "basket", provenance: dict | None = None) -> es.Supplied:
    spec = es.supplied_spec(key, "Test basket", f"basket:{key}", level.index[0].strftime("%Y-%m-%d"))
    return es.Supplied(spec, level, provenance or {"what": "test"})


def _stats(native: dict) -> str:
    return json.dumps({"h": native["horizons"], "r": native["regimes"], "e": native["recent_events"]}, sort_keys=True)


# ── the engine's supplied-series entry point ────────────────────────────────

@pytest.fixture(scope="module")
def synth_store(tmp_path_factory) -> Path:
    return _synthetic_db(tmp_path_factory.mktemp("basket-study") / "synth.db")


@pytest.mark.parametrize("w,sign", [(5, "-"), (20, "+"), (60, "both")])
def test_a_supplied_series_gives_the_stored_studys_statistics_exactly(synth_store, w, sign):
    conn = dbpath.connect_ro(synth_store)
    try:
        lvl = es.load_level(conn, registry.get("spx"), AS_OF)
        native, table, trace = es.run_on_traced(conn, es.Query(shock="spx", target="spx", w=w, z=2.0, sign=sign), generation="g", as_of=AS_OF)
        sup, stab, strace = es.run_on_supplied_traced(conn, es.Query(shock="basket", target="basket", w=w, z=2.0, sign=sign),
                                                     _supplied_from(lvl), generation="g", as_of=AS_OF)
    finally:
        conn.close()
    assert native["provenance"]["n_events"] > 0
    assert _stats(sup) == _stats(native)
    assert np.array_equal(stab.event_idx, table.event_idx) and stab.sessions == table.sessions
    assert np.array_equal(strace.evaluable, trace.evaluable) and np.array_equal(strace.trigger, trace.trigger)
    for k in ("n_events", "n_events_raw", "sample_start", "sample_end", "data_start", "n_sessions"):
        assert sup["provenance"][k] == native["provenance"][k], k
    assert sup["provenance"]["entry_rule"] == native["provenance"]["entry_rule"].replace("S&P 500:", "Test basket:")
    # the supplied run names itself, never a registry series or a preset
    assert sup["study"]["slug"] == f"basket-w{w}-z2.0-{ {'-': 'down', '+': 'up', 'both': 'abs'}[sign] }-none-basket"
    assert sup["study"]["preset"] is None and sup["study"]["shock"]["label"] == "Test basket"
    meta = next(m for m in sup["provenance"]["inputs"] if m["key"] == "basket")
    assert meta["table"] == es.SUPPLIED_TABLE and meta["series_id"] == "basket:basket"


def test_the_inputs_hash_covers_the_supplied_series_content_and_provenance(synth_store):
    conn = dbpath.connect_ro(synth_store)
    try:
        lvl = es.load_level(conn, registry.get("spx"), AS_OF)
        q = es.Query(shock="basket", target="basket", w=5, z=2.0, sign="-")

        def h(level, prov):
            return es.run_on_supplied_traced(conn, q, _supplied_from(level, provenance=prov), generation="g", as_of=AS_OF)[0]["provenance"]["inputs_hash"]

        base = h(lvl, {"legs": [["A", 50.0], ["B", 50.0]]})
        assert base == h(lvl.copy(), {"legs": [["A", 50.0], ["B", 50.0]]})
        assert base != h(lvl, {"legs": [["A", 60.0], ["B", 40.0]]})
        bumped = lvl.copy()
        bumped.iloc[-1] *= 1.0001
        assert base != h(bumped, {"legs": [["A", 50.0], ["B", 50.0]]})
    finally:
        conn.close()


def test_a_supplied_series_is_read_up_to_the_as_of_and_counts_what_it_leaves_out(synth_store):
    conn = dbpath.connect_ro(synth_store)
    try:
        lvl = es.load_level(conn, registry.get("spx"), AS_OF)
        cut = lvl.index[-4].strftime("%Y-%m-%d")
        out = es.run_on_supplied_traced(conn, es.Query(shock="basket", target="basket", w=5, z=2.0, sign="-"),
                                        _supplied_from(lvl), generation="g", as_of=cut)[0]
    finally:
        conn.close()
    P = out["provenance"]
    assert P["as_of_by_series"]["basket"] == cut and P["future_excluded"] == {"basket": 3}
    assert any(w == f"rows dated after {cut} excluded: basket 3." for w in P["warnings"])


def test_a_supplied_series_is_declared_and_validated():
    idx = pd.DatetimeIndex(["2020-01-02", "2020-01-03"])
    spec = es.supplied_spec("basket", "B", "basket:x", "2020-01-02")
    assert spec.fixed == registry.AT_CLOSE and spec.known == registry.AT_CLOSE and spec.unit == "log_return"
    with pytest.raises(es.StudyError, match="registry key"):
        es.Supplied(es.supplied_spec("spx", "B", "x", "2020-01-02"), pd.Series([1.0, 2.0], index=idx), {})
    with pytest.raises(es.StudyError, match="tz-naive"):
        es.Supplied(spec, pd.Series([1.0, 2.0], index=idx.tz_localize("UTC")), {})
    with pytest.raises(es.StudyError, match="ascending"):
        es.Supplied(spec, pd.Series([1.0, 2.0], index=idx[::-1]), {})
    with pytest.raises(es.StudyError, match="time of day"):
        es.Supplied(spec, pd.Series([1.0, 2.0], index=idx + pd.Timedelta(hours=16)), {})
    with pytest.raises(es.StudyError, match="no observations"):
        es.Supplied(spec, pd.Series([], index=pd.DatetimeIndex([]), dtype=float), {})
    with pytest.raises(TypeError):
        es.Supplied(spec, pd.Series([1.0, 2.0], index=idx), {"bad": object()})
    ok = es.Query(shock="basket", target="basket", w=5, z=2.0, sign="-")
    assert es.validate_supplied(ok, spec) == ok
    for bad, why in [(dict(target="spx"), "both the shock and the target"), (dict(cond="vix_above", cond_value=30), "no condition"),
                     (dict(w=7), "w must be one of"), (dict(z=3.0), "z must be one of"), (dict(sign="x"), "sign must be"),
                     (dict(kind="cross"), "shock study"), (dict(regime="Boom"), "regime must be"), (dict(seed=-1), "seed must be")]:
        with pytest.raises(es.StudyError, match=why):
            es.validate_supplied(es.Query(**{**dict(shock="basket", target="basket", w=5, z=2.0, sign="-"), **bad}), spec)


@pytest.mark.skipif(not PUBLISHED.exists(), reason="the published copy (data/macro_radar.db) is not downloaded")
def test_on_the_published_copy_a_one_name_basket_is_the_stored_study():
    """The control on real data: the S&P 500's stored closes priced as a one-name basket by the page's rule
    (price_basket: 100 × P / P₀) and studied through the route's job give the stored S&P study's
    statistics; the index's log returns equal the closes' to rounding, so the events are the same."""
    from src.desk import basket as bk

    conn = dbpath.connect_ro(PUBLISHED)
    try:
        cutoff = es.resolve_as_of(None, PUBLISHED)
        lvl = es.load_level(conn, registry.get("spx"), cutoff)
        native = es.run_on_traced(conn, es.Query(shock="spx", target="spx", w=5, z=2.0, sign="-"), generation="g", as_of=cutoff)[0]
    finally:
        conn.close()
    dates = tuple(d.strftime("%Y-%m-%d") for d in lvl.index)
    hist = {"^GSPC": bk.History(dates, tuple(float(x) for x in lvl), tuple([None] * len(dates)))}

    class Gen:
        key = "published"
        id = 1

    real_open = dbpath.open_generation
    try:
        dbpath.open_generation = lambda gen: dbpath.connect_ro(PUBLISHED)
        item = desk_basket._study_job(Gen(), cutoff, [("^GSPC", 100.0)], "hold", "target", None, 5, "down2s", histories=hist)
    finally:
        dbpath.open_generation = real_open
    assert item["ok"]
    got = item["native"]
    assert got["provenance"]["n_events"] == native["provenance"]["n_events"] > 50
    for a, b in zip(got["horizons"], native["horizons"]):
        assert a["n"] == b["n"] and a["n_blocks"] == b["n_blocks"] and a["baseline_n"] == b["baseline_n"]
        for k in ("median", "baseline_median", "hit_rate", "baseline_hit_rate", "delta"):
            assert a[k] == pytest.approx(b[k], rel=1e-9, abs=1e-12), (a["h"], k)
        assert (a.get("ci90") is None) == (b.get("ci90") is None)
        if a.get("ci90"):
            assert a["ci90"] == pytest.approx(b["ci90"], rel=1e-9, abs=1e-12) and a["exclusion"] == b["exclusion"]
    assert [e["date"] for e in got["recent_events"]] == [e["date"] for e in native["recent_events"]]


# ── the route ───────────────────────────────────────────────────────────────

def _store_sessions(path: Path) -> list[str]:
    conn = dbpath.connect_ro(path)
    try:
        return [d.strftime("%Y-%m-%d") for d in es.load_level(conn, registry.get("spx"), AS_OF).index]
    finally:
        conn.close()


@pytest.fixture()
def served(tmp_path, monkeypatch, install_worker):
    """A worker serving one generation of the synthetic store (its regimes table), and the mocked provider:
    OLD and MID list from 1995, YNG 200 sessions before the store's end."""
    f = _synthetic_db(tmp_path / "synth.db")
    sessions = _store_sessions(f)
    monkeypatch.setattr(db, "DB_PATH", f)
    w = install_worker(worker_mod.AnalyticsWorker(items=[], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    desk_basket.clear_study_cache()
    rng = np.random.default_rng(5)
    common = rng.normal(0.0003, 0.012, len(sessions))
    universe = {
        "OLD": (0, 40.0 * np.cumprod(1 + common + rng.normal(0, 0.008, len(sessions)))),
        "MID": (0, 25.0 * np.cumprod(1 + 1.3 * common + rng.normal(0, 0.01, len(sessions)))),
        "YNG": (len(sessions) - 200, 10.0 * np.cumprod(1 + 2.0 * common + rng.normal(0, 0.02, len(sessions)))),
    }
    asked: list[str] = []
    state = {"delay": 0.0, "gate": None}

    def closes(sym):
        asked.append(sym)
        if state["gate"] is not None:
            state["gate"].wait(10)
        time.sleep(state["delay"])
        if sym not in universe:
            raise UnknownSymbol("eodhd", f"No listing found for '{sym}' on EODHD.")
        first, px = universe[sym]
        d = np.array(sessions[first:], dtype="datetime64[D]")
        return {"symbol": sym, "provider": "EODHD", "session": SESSION, "from": market.STUDY_HISTORY_FROM,
                "dates": d, "adjusted": px[first:].astype(float), "close_raw": px[first:] * 1.01}

    monkeypatch.setattr(market, "daily_closes_since_1995", closes)
    monkeypatch.setattr(market, "last_session", lambda: SESSION)
    yield {"asked": asked, "state": state, "sessions": sessions, "universe": universe}
    if state["gate"] is not None:
        state["gate"].set()
    desk_basket.clear_study_cache()


def study(**q):
    return client.get("/api/desk/basket/study", params=q)


def test_a_long_basket_is_studied_and_the_answer_names_its_index(served):
    r = study(legs="OLD:60,MID:40", method="monthly")
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ready" and body["generation_id"]
    d = body["data"]
    assert d["not_run"] is None and d["question"] == {"shock": "basket", "window": 5, "move": "down2s", "while": "none",
                                                     "target": "basket", "horizon": 20, "target_unit": "log_return",
                                                     "display_unit": "percent"}
    ix = d["index"]
    # the store's first weekday, 1995-01-02, was the observed New Year's Day: the XNYS calendar starts the index after it
    assert ix["provider"] == "EODHD" and ix["requested_from"] == "1995-01-01" and ix["start"] == "1995-01-03"
    assert ix["end"] == SESSION and ix["method"] == "monthly" and ix["weighting"] == "target" and ix["excluded"] == []
    s = d["study"]
    assert s["matched_n"] > 0 and s["selected_horizon"] == 20 and len(s["horizons"]) == 4
    assert s["verdict"] in ("reliable", "suggestive", "no_edge", "insufficient") and s["verdict_rule"] == "v1"
    assert s["regime_history"] == "revised" and len(s["by_regime"]) == 4
    assert d["caveats"] == [desk_basket.HINDSIGHT, desk_basket.REVISED_REGIMES]
    assert s["slug"] == "basket-w5-z2.0-down-none-basket" and s["inputs_hash"]
    assert sorted(served["asked"]) == ["MID", "OLD"]


def test_the_answer_is_the_engines_on_the_pages_index(served):
    """The study's numbers are the engine's run on price_basket's index over the fetched closes."""
    from src.desk import basket as bk

    d = study(legs="OLD:60,MID:40", method="hold", window="20", move="up2s", horizon="60").json()["data"]
    hist = {s: desk_basket.study_history(market.daily_closes_since_1995(s), s) for s in ("OLD", "MID")}
    priced = bk.price_basket(hist, {"OLD": 0.6, "MID": 0.4}, "hold", 1.0, sessions=desk_basket.calendar_for(hist))
    lvl = pd.Series(priced["index"], index=pd.DatetimeIndex(priced["dates"]))
    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        native = es.run_on_supplied_traced(conn, es.Query(shock="basket", target="basket", w=20, z=2.0, sign="+"),
                                           _supplied_from(lvl), generation="g", as_of=AS_OF)[0]
    finally:
        conn.close()
    s = d["study"]
    assert s["selected_horizon"] == 60 and s["matched_n"] == native["provenance"]["n_events"]
    for row, H in zip(s["horizons"], native["horizons"]):
        assert row["n"] == H["n"] and row["median"] == H["median"] and row["baseline_median"] == H["baseline_median"]


def test_a_young_basket_is_not_run_and_says_whose_listing_sets_its_start(served):
    first = served["sessions"][len(served["sessions"]) - 200]
    # the synthetic store's weekdays include NYSE holidays, which are no index session
    n = len(es.sessions_between(es.session_calendar(first, SESSION), first, SESSION))
    d = study(legs="OLD:50,YNG:50").json()["data"]
    assert d["study"] is None and d["index"]["start"] == first and d["index"]["start_binding"] == ["YNG"]
    assert d["index"]["sessions"] == n and 180 < n < 200
    assert d["not_run"] == (f"Not enough history yet: the index starts {first} (YNG's first close) and has {n} sessions; "
                            "the first 2σ move over 5 sessions can be judged on its 245th session (240 5-session moves in a "
                            "252-session window).")
    # a 20-session window needs more; the answer counts it
    assert "judged on its 260th session" in study(legs="OLD:50,YNG:50", window="20").json()["data"]["not_run"]


def test_a_repeat_is_a_lookup(served):
    a = study(legs="OLD:60,MID:40").json()["data"]
    n = len(served["asked"])
    b = study(legs="OLD:60,MID:40").json()["data"]
    assert len(served["asked"]) == n and a["study"]["inputs_hash"] == b["study"]["inputs_hash"]
    # another horizon of the same question reads the same job
    study(legs="OLD:60,MID:40", horizon="5")
    assert len(served["asked"]) == n


@pytest.mark.parametrize("q,words", [
    (dict(legs="OLD:60,MID:40", notional="1000000"), "notional"),
    (dict(legs="OLD:60,MID:40", window="10"), "window"),
    (dict(legs="OLD:60,MID:40", move="up3s"), "move"),
    (dict(legs="OLD:60,MID:40", horizon="30"), "horizon"),
    (dict(legs="OLD:60,MID:40", seed="1"), "seed"),
    (dict(legs="OLD:60,MID:30"), "add to 90%"),
])
def test_a_request_the_route_does_not_take_is_refused_naming_what(served, q, words):
    r = study(**q)
    body = r.json()
    assert r.status_code == 422 and body["status"] == "error" and body["error"]["code"] == "unsupported"
    assert words in body["error"]["message"]


def test_a_name_the_provider_does_not_list_is_refused_naming_it(served):
    r = study(legs="OLD:50,NOPE:50")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_symbol" and "NOPE" in r.json()["error"]["message"]
    # the failure is not kept: the next request asks again
    n = served["asked"].count("NOPE")
    study(legs="OLD:50,NOPE:50")
    assert served["asked"].count("NOPE") == n + 1


def test_a_slow_study_answers_computing_and_a_full_queue_busy(served, monkeypatch):
    gate = threading.Event()
    served["state"]["gate"] = gate
    monkeypatch.setattr(desk_basket, "STUDY_TIMEOUT_S", 0.2)
    r = study(legs="OLD:60,MID:40")
    assert r.status_code == 202 and r.json()["status"] == "computing" and r.headers.get("retry-after")
    monkeypatch.setattr(desk_basket, "STUDY_OUTSTANDING_MAX", 1)
    r = study(legs="OLD:50,MID:50")
    assert r.status_code == 429 and r.json()["error"]["code"] == "busy"
    gate.set()
    served["state"]["gate"] = None
    deadline = time.monotonic() + 30
    while True:
        r = study(legs="OLD:60,MID:40")
        if r.status_code == 200 or time.monotonic() > deadline:
            break
        time.sleep(0.1)
    assert r.status_code == 200 and r.json()["data"]["study"]["matched_n"] > 0


def test_cap_weight_without_stored_counts_is_awaiting(served, install_worker):
    w = install_worker(worker_mod.AnalyticsWorker(items=[("desk_share_counts", desk_basket.desk_share_counts)], poll_s=0.05, preload=False))
    w.start(serving=True)
    assert w.wait_published(timeout=30)
    body = study(legs="OLD,MID", weighting="cap").json()
    assert body["status"] == "awaiting" and "share counts" in body["unavailable"]["reason"]


def test_monthly_the_studys_index_returns_are_the_charts_after_both_rebalance(served):
    """Spec §2: with monthly rebalancing the long-history index and the two-year chart's agree on every
    session's return once both have rebalanced (the chart's start month aside)."""
    from src.desk import basket as bk

    hist = {s: desk_basket.study_history(market.daily_closes_since_1995(s), s) for s in ("OLD", "MID")}
    w = {"OLD": 0.6, "MID": 0.4}
    long = bk.price_basket(hist, w, "monthly", 1.0, sessions=desk_basket.calendar_for(hist))
    cut = served["sessions"][-504]
    short_h = {s: bk.History(*(tuple(x for d, x in zip(h.dates, col) if d >= cut) for col in (h.dates, h.close, h.dollar_volume)))
               for s, h in hist.items()}
    short = bk.price_basket(short_h, w, "monthly", 1.0, sessions=desk_basket.calendar_for(short_h))
    a = pd.Series(long["index"], index=long["dates"])
    b = pd.Series(short["index"], index=short["dates"])
    first_month_end = pd.Timestamp(b.index[0]).to_period("M")
    after = [d for d in b.index if pd.Timestamp(d).to_period("M") > first_month_end]
    ra = np.log(a.loc[after]).diff().dropna()
    rb = np.log(b.loc[after]).diff().dropna()
    assert len(ra) > 400 and np.allclose(ra.to_numpy(), rb.to_numpy(), rtol=0, atol=1e-12)
