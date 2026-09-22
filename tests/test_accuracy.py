"""B7 (2026-09-18): accuracy tests. Every displayed metric is traced from its
stored column through the documented transform to the API field, so a unit
change (bps for percent, 0-100 for 0-1) cannot slip through; every share and
probability is bounded on its declared scale; one metric has one value across
endpoints. Runs against the real local DB, read-only (skips only if absent).
"""

from __future__ import annotations

import re
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import db
from api.main import app

client = TestClient(app)
pytestmark = pytest.mark.skipif(not db.DB_PATH.exists(), reason="macro_radar.db not present")

BAML = {"HY": "BAMLH0A0HYM2", "IG": "BAMLC0A0CM", "BB": "BAMLH0A1HYBB", "B": "BAMLH0A2HYB", "CCC": "BAMLH0A3HYC"}
EPS = 1e-9


def _q(sql: str, *args):
    c = sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def _latest(series_id: str) -> tuple[str, float]:
    return _q("SELECT date, value FROM raw_series WHERE series_id = ? ORDER BY date DESC LIMIT 1", series_id)[0]


def _get(path: str) -> dict | list:
    r = client.get(path)
    assert r.status_code == 200, (path, r.status_code)
    return r.json()


# ── 1. Traces: stored column → documented transform → API field ─────────────


def test_trace_regime_label_confidence_and_odds():
    row = _q("SELECT date, label, confidence, prob_goldilocks, prob_overheating, prob_stagflation, prob_recession FROM regimes ORDER BY date DESC LIMIT 1")[0]
    api = _get("/api/regime/latest")
    assert (api["date"], api["label"]) == (row[0], row[1])
    for key, stored in zip(("confidence", "prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession"), row[2:]):
        assert api[key] == pytest.approx(stored, abs=EPS), key  # stored 0-1, served 0-1


def test_trace_each_signal_value():
    stored = {n: (d, v) for n, d, v in _q(
        "SELECT signal_name, date, value FROM signals s WHERE date = (SELECT MAX(date) FROM signals s2 WHERE s2.signal_name = s.signal_name)")}
    served = _get("/api/signals/latest")["signals"]
    assert {s["signal_name"] for s in served} == set(stored)
    for s in served:
        d, v = stored[s["signal_name"]]
        assert s["date"] == d and s["value"] == pytest.approx(v, abs=EPS), s["signal_name"]


def test_trace_oas_stored_percent_served_percent_and_bps():
    for s in _get("/api/credit/oas?days=90")["series"]:
        d, v = _latest(s["series_id"])
        assert s["date"] == d and s["value_pct"] == pytest.approx(v, abs=EPS), s["series_id"]
        assert s["value_bps"] == pytest.approx(v * 100, abs=1e-6), s["series_id"]  # ×100, once


def test_trace_credit_metrics_bps_and_the_distress_line():
    m = _get("/api/credit/metrics")
    for key, sid in (("hy_oas", BAML["HY"]), ("ig_oas", BAML["IG"]), ("bb_oas", BAML["BB"]), ("b_oas", BAML["B"]), ("ccc_oas", BAML["CCC"])):
        assert m[key] == pytest.approx(_latest(sid)[1] * 100, abs=1e-6), key
    assert m["ccc_pct_of_distress_line"] == round(m["ccc_oas"] / 1000 * 100, 1)
    assert m["ccc_bps_vs_distress_line"] == round(m["ccc_oas"] - 1000, 1)


def test_trace_rates_vix_and_the_curve_in_both_units():
    ten, two, vix = _latest("DGS10")[1], _latest("DGS2")[1], _latest("VIXCLS")[1]
    assert _get("/series/DGS10/latest")["value"] == pytest.approx(ten, abs=EPS)
    assert _get("/series/VIXCLS/latest")["value"] == pytest.approx(vix, abs=EPS)
    rec = _get("/api/recession/probability")
    assert rec["curve_shape"]["10Y"] == pytest.approx(ten, abs=EPS) and rec["curve_shape"]["2Y"] == pytest.approx(two, abs=EPS)
    assert rec["yield_curve_spread"] == pytest.approx((ten - two) * 100, abs=1e-6)  # bps here, pp in the signal


def test_trace_fed_funds_and_the_lbo_all_in_rate():
    ff, hy = _latest("FEDFUNDS")[1], _latest(BAML["HY"])[1]
    d = _get("/api/lbo/defaults")
    assert d["is_fallback"] is False
    assert d["fedfunds"] == round(ff, 2) and d["hy_oas_pct"] == round(hy, 2)  # HY stored in percent, used in percent
    assert d["lbo_all_in_rate"] == round(ff + hy, 2)


def test_trace_market_closes_and_one_day_returns():
    stored = {d: c for d, c in _q("SELECT date, close FROM market_daily WHERE symbol = 'SPY' ORDER BY date")}
    dates = sorted(stored)
    rows = _get("/api/market/daily?symbols=SPY&days=45")
    assert rows
    for r in rows:
        assert r["close"] == pytest.approx(stored[r["date"]], abs=EPS)
        i = dates.index(r["date"])
        if r["ret_1d"] is not None:
            assert r["ret_1d"] == pytest.approx((stored[r["date"]] / stored[dates[i - 1]] - 1) * 100, abs=1e-6)


# ── 2. Bounds: every share and probability on its declared scale ────────────
# Keyed by (endpoint, key): the same key can carry two scales (hit_rate is 0-1
# in /api/backtests and 0-100 in /api/regime/playbooks), so a registry by key
# alone would let a unit change through. An unregistered share-like key fails.

SHARE_LIKE = re.compile(r"(prob|share|pct_rank|percentile|odds|weight|hit_rate|confidence|distance_pct|stay)", re.I)
ZERO_ONE, PCT = (0.0, 1.0), (0.0, 100.0)
SCALES: dict[tuple[str, str], tuple[float, float]] = {
    **{("/api/regime/latest", k): ZERO_ONE for k in ("confidence", "prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession")},
    **{("/api/regime/history?limit=400", k): ZERO_ONE for k in ("confidence", "prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession")},
    ("/api/signals/latest", "distance_pct"): PCT,
    ("/api/regime/transitions", "highest_risk_prob"): PCT,
    ("/api/regime/transitions", "probability"): PCT,
    ("/api/regime/transitions", "stay_probability_3m"): PCT,
    ("/api/regime/transitions", "stay_probability_6m"): PCT,
    ("/api/backtests", "hit_rate"): ZERO_ONE,
    ("/api/regime/playbooks", "hit_rate"): PCT,
    ("/api/credit/metrics", "hy_pct_rank"): PCT,
    ("/api/credit/metrics", "ig_pct_rank"): PCT,
    ("/api/regime/duration", "percentile_duration"): PCT,
    ("/api/recession/probability", "recession_prob"): PCT,
    ("/api/recession/probability", "yield_curve_pct_rank"): PCT,
    ("/api/regime/analogues", "recession_prob"): PCT,
}
BOUNDED_ENDPOINTS = sorted({p for p, _ in SCALES} | {"/api/regime/intelligence", "/api/credit/oas?days=90", "/api/freshness", "/api/lbo/defaults", "/api/priced", "/api/surprises?top_n=10"})


def _leaves(obj, key=None):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _leaves(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from _leaves(v, key)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        yield key, obj


@pytest.mark.parametrize("path", BOUNDED_ENDPOINTS)
def test_every_share_and_probability_is_on_its_declared_scale(path):
    for key, value in _leaves(_get(path)):
        if key is None or not SHARE_LIKE.search(str(key)):
            continue
        assert (path, key) in SCALES, f"unregistered share-like key {key!r} on {path}: declare its scale"
        lo, hi = SCALES[(path, key)]
        assert lo - EPS <= value <= hi + EPS, f"{path} {key}={value} outside [{lo}, {hi}]"


def test_regime_odds_and_credit_transition_rows_are_distributions():
    probs = _get("/api/regime/intelligence")["regime_probs"]
    assert all(0 <= p <= 1 for p in probs.values()) and sum(probs.values()) == pytest.approx(1.0, abs=1e-3)
    m = _get("/api/credit/metrics")
    for name, obs_name in (("transition_3m", "transition_obs_3m"), ("transition_6m", "transition_obs_6m")):
        observed = m[obs_name]
        assert set(observed) == set(m[name]), name
        for state, row in m[name].items():
            cells = list(row.values())
            assert all(0 <= c <= 1 for c in cells), (name, state, row)
            if observed[state] > 0:
                assert sum(cells) == pytest.approx(1.0, abs=1e-3), (name, state, row)
            else:  # no history for this state: zeros that must not be read as odds
                assert sum(cells) == 0, (name, state, row)


def test_nothing_named_as_a_share_is_the_distress_line():
    # The CCC level against the 1,000 bps line may exceed 100: its name must
    # never match the share pattern, or the bound above would hide the level.
    assert not SHARE_LIKE.search("ccc_pct_of_distress_line")
    assert not SHARE_LIKE.search("ccc_bps_vs_distress_line")


# ── 3. Consistency: one value per metric across endpoints ───────────────────


def test_lbo_all_in_rate_is_one_value_on_credit_and_tools():
    credit = _get("/api/credit/metrics")["lbo_all_in_cost"]
    tools = _get("/api/lbo/defaults")["lbo_all_in_rate"]
    assert float(str(credit).rstrip("%")) == pytest.approx(tools, abs=0.005)


def test_recession_probability_is_one_value_on_dashboard_and_recession():
    rec = _get("/api/recession/probability")
    series = rec["recession_prob_series"]
    assert 0 <= rec["recession_prob"] <= 100
    # The Recession chart's last point is the headline the Dashboard shows.
    assert series[-1]["value"] == pytest.approx(rec["recession_prob"], abs=EPS)
    from src.analytics import chat

    tool = chat._tool_get_recession_probability()
    assert tool["recession_model"]["probability_pct"] == pytest.approx(rec["recession_prob"], abs=1e-6)
    # The classifier's Recession Risk odds are a different number, never served under the model's name.
    assert tool["regime_recession_risk_odds"]["odds_now"] == pytest.approx(_get("/api/regime/latest")["prob_recession"], abs=EPS)


def test_regime_and_its_odds_are_one_answer_everywhere():
    latest = _get("/api/regime/latest")
    label = latest["label"]
    assert _get("/regime/latest") == latest
    assert _get("/api/regime/history?limit=1")[-1]["label"] == label
    intel = _get("/api/regime/intelligence")
    assert intel["current_regime"] == label
    for key, api_key in (("goldilocks", "prob_goldilocks"), ("overheating", "prob_overheating"), ("stagflation", "prob_stagflation"), ("recession_risk", "prob_recession")):
        assert intel["regime_probs"][key] == pytest.approx(latest[api_key], abs=1e-4), key
    assert _get("/api/regime/duration")["current_regime"] == label
    assert _get("/api/regime/transitions")["current_regime"] == label
    presets = _get("/api/regime/scenarios")
    first = presets[0] if isinstance(presets, list) else next(iter(presets.get("scenarios", presets.values())))
    key = first["key"] if isinstance(first, dict) and "key" in first else first
    sc = client.post("/api/regime/scenario", json={"scenario_key": key})
    assert sc.status_code == 200, sc.text
    cur = sc.json()["current_regime_probs"]
    for name, api_key in (("Goldilocks", "prob_goldilocks"), ("Overheating", "prob_overheating"), ("Stagflation", "prob_stagflation"), ("Recession Risk", "prob_recession")):
        if name in cur:
            assert abs(cur[name] - latest[api_key] * 100) <= 1.0, name  # served as rounded whole percents
    from src.analytics import chat

    tool = chat._tool_get_current_regime()
    assert tool["label"] == label


def test_ten_year_vix_and_hy_oas_are_one_value_across_endpoints():
    ten = _get("/series/DGS10/latest")["value"]
    assert _get("/api/recession/probability")["curve_shape"]["10Y"] == pytest.approx(ten, abs=EPS)
    oas = {s["series_id"]: s for s in _get("/api/credit/oas?days=90")["series"]}
    if "DGS10" in oas:
        assert oas["DGS10"]["value_pct"] == pytest.approx(ten, abs=EPS)
    hy_bps = oas[BAML["HY"]]["value_bps"]
    assert _get("/api/credit/metrics")["hy_oas"] == pytest.approx(hy_bps, abs=1e-6)
    assert _get("/api/lbo/defaults")["hy_oas_pct"] * 100 == pytest.approx(hy_bps, abs=0.5)  # served to 2 dp in percent
    assert _get("/api/recession/probability")["current_inputs"]["hy_oas"] == pytest.approx(hy_bps, abs=1e-6)
    vix_signal = next((s for s in _get("/api/signals/latest")["signals"] if s["signal_name"] == "vix_spike"), None)
    if vix_signal is not None:
        stored = _q("SELECT value FROM raw_series WHERE series_id = 'VIXCLS' AND date = ?", vix_signal["date"])
        assert stored and vix_signal["value"] == pytest.approx(stored[0][0], abs=EPS)
