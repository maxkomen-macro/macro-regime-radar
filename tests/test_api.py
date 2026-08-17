"""tests/test_api.py — smoke + contract tests for the read-only Macro Radar API.

Runs against the real local SQLite DB in read-only mode (no writes) via FastAPI's
TestClient. Skips gracefully if the DB file is absent (e.g. fresh checkout/CI).
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import db
from api.main import app

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="macro_radar.db not present"
)


def _ro_conn() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db_present"] is True


def test_regime_latest_matches_db():
    r = client.get("/regime/latest")
    assert r.status_code == 200
    body = r.json()
    for key in (
        "date", "label", "confidence", "growth_trend", "inflation_trend",
        "prob_goldilocks", "prob_overheating", "prob_stagflation", "prob_recession",
    ):
        assert key in body

    conn = _ro_conn()
    row = conn.execute(
        "SELECT date, label FROM regimes ORDER BY date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    assert body["date"] == row[0]
    assert body["label"] == row[1]


def test_signals_latest_shape_and_date():
    r = client.get("/signals/latest")
    assert r.status_code == 200
    body = r.json()
    assert "date" in body and isinstance(body["signals"], list)

    conn = _ro_conn()
    max_date = conn.execute("SELECT MAX(date) FROM signals").fetchone()[0]
    conn.close()
    assert body["date"] == max_date
    if body["signals"]:
        s = body["signals"][0]
        assert set(s) == {"signal_name", "value", "triggered"}
        assert isinstance(s["triggered"], bool)


def test_series_catalog_and_latest_all():
    ids = client.get("/series").json()
    assert isinstance(ids, list) and ids

    points = client.get("/series/latest").json()
    assert len(points) == len(ids)
    assert {p["series_id"] for p in points} == set(ids)
    assert set(points[0]) == {"series_id", "date", "value"}


def test_series_one_and_unknown_404():
    ids = client.get("/series").json()
    one = client.get(f"/series/{ids[0]}/latest")
    assert one.status_code == 200
    assert one.json()["series_id"] == ids[0]

    missing = client.get("/series/NOPE_NOT_A_SERIES/latest")
    assert missing.status_code == 404


# ── /api (React-migration) endpoints ─────────────────────────────────────────

def test_api_regime_latest_matches_unprefixed():
    assert client.get("/api/regime/latest").json() == client.get("/regime/latest").json()


def test_api_regime_history_limit_and_order():
    rows = client.get("/api/regime/history", params={"limit": 10}).json()
    assert 0 < len(rows) <= 10
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates)

    conn = _ro_conn()
    latest = conn.execute("SELECT MAX(date) FROM regimes").fetchone()[0]
    conn.close()
    assert dates[-1] == latest  # limit keeps the most recent rows


def test_api_signals_latest_carry_forward():
    """Every signal with any history reports — monthly signals carry their
    last print (with its true as-of date) instead of dropping out at the max
    common date."""
    body = client.get("/api/signals/latest").json()
    conn = _ro_conn()
    n_names = conn.execute(
        "SELECT COUNT(DISTINCT signal_name) FROM signals"
    ).fetchone()[0]
    max_date = conn.execute("SELECT MAX(date) FROM signals").fetchone()[0]
    conn.close()

    assert len(body["signals"]) == n_names, "a signal with history came back empty"
    assert body["date"] == max_date
    names = [s["signal_name"] for s in body["signals"]]
    assert len(names) == len(set(names))
    for s in body["signals"]:
        assert set(s) == {
            "signal_name", "date", "value", "triggered",
            "threshold", "direction", "distance_pct", "status",
        }
        assert s["date"] <= max_date  # carry-forward, never future


def test_api_signals_latest_server_side_fields():
    body = client.get("/api/signals/latest").json()
    for s in body["signals"]:
        if s["signal_name"] not in db.SIGNAL_DEFS:
            continue
        defs = db.SIGNAL_DEFS[s["signal_name"]]
        assert s["threshold"] == defs["threshold"]
        assert s["direction"] == defs["direction"]
        assert 0.0 <= s["distance_pct"] <= 100.0
        assert s["status"] in {"Clear", "Watch", "Triggered"}
        # The stored triggered flag owns "Triggered" — distance alone never does.
        assert (s["status"] == "Triggered") == s["triggered"]
        if not s["triggered"]:
            assert s["status"] == ("Watch" if s["distance_pct"] >= 50.0 else "Clear")
        # Spot-check the gauge formula on the plain above-threshold case.
        if s["direction"] == "above" and s["threshold"] and 0 < s["value"] < s["threshold"]:
            assert abs(s["distance_pct"] - s["value"] / s["threshold"] * 100.0) < 1e-9


_CONFIG_THRESHOLD_CONSTS = {
    "YIELD_CURVE_INVERSION_THRESHOLD": "yield_curve_inversion",
    "UNRATE_SPIKE_THRESHOLD": "unemployment_spike",
    "CPI_HOT_THRESHOLD": "cpi_hot",
    "CPI_COLD_THRESHOLD": "cpi_cold",
    "VIX_SPIKE_THRESHOLD": "vix_spike",
}


def test_signal_defs_match_src_config():
    """api/db.SIGNAL_DEFS is a declared mirror of src/config.py:36–41 (api/
    can't import src.config — FRED key requirement). AST-parse the source so
    threshold drift fails here instead of lying to every client."""
    import ast
    from pathlib import Path

    config_path = Path(__file__).resolve().parent.parent / "src" / "config.py"
    consts: dict[str, object] = {}
    for node in ast.walk(ast.parse(config_path.read_text())):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            try:
                consts[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
    for const_name, signal_name in _CONFIG_THRESHOLD_CONSTS.items():
        assert const_name in consts, f"src/config.py no longer defines {const_name}"
        assert consts[const_name] == db.SIGNAL_DEFS[signal_name]["threshold"], (
            f"{signal_name} threshold drifted from src/config.py::{const_name}"
        )


def test_api_priced_groups_and_units():
    rows = client.get("/api/priced").json()
    assert isinstance(rows, list)
    if rows:
        assert set(rows[0]) == {"group", "metric", "label", "unit", "date", "value", "mom_chg"}
        groups = {r["group"] for r in rows}
        assert groups <= {"Policy rate proxies", "Inflation breakevens", "Real yields (TIPS)"}


def test_api_surprises_ranked_by_abs_z():
    rows = client.get("/api/surprises", params={"top_n": 10}).json()
    assert len(rows) <= 10
    zs = [abs(r["z_score"]) for r in rows]
    assert zs == sorted(zs, reverse=True)
    for r in rows:
        assert set(r) == {"metric", "label", "date", "z_score", "raw_value", "interpretation"}
        assert r["interpretation"]  # the shared desk-note phrasing, never empty

    bad = client.get("/api/surprises", params={"top_n": 99})
    assert bad.status_code == 422


def test_z_interpretation_no_double_yoy():
    """The CPI level phrase carries '% YoY' as its unit — a label that already
    says YoY must not repeat it ("CPI YoY runs at 3.46% YoY", found live).
    One shared implementation serves the dashboard, memo, and API."""
    from src.utils.format import z_interpretation

    s = z_interpretation("CPI_yoy_z", "CPI YoY", 3.9, 3.46)
    assert s == "CPI runs at 3.46% YoY — a 3.9σ high reading vs its recent range"
    assert s.count("YoY") == 1


def test_api_alerts_shape_only():
    # alert_feed is nearly empty in the real DB — assert shape, not content.
    r = client.get("/api/alerts", params={"limit": 5})
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        assert {"date", "alert_type", "name", "level", "message"} <= set(rows[0])


def test_api_news_window_no_lexicographic_leak():
    """published_at mixes ISO-'T'/offset and space formats; 'T' > ' ' let
    same-day rows older than the window leak through (a 30h-old row inside a
    24H filter, found live). After normalization every returned row must be
    genuinely inside the window."""
    from datetime import datetime, timedelta, timezone

    hours = 24
    rows = client.get("/api/news", params={"hours": hours, "limit": 500}).json()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    for r in rows:
        stamp = r["published_at"][:19].replace("T", " ")
        parsed = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        assert parsed >= cutoff - timedelta(minutes=2), (
            f"{r['published_at']} leaked past the {hours}h window"
        )


def test_api_news_ordering_and_limit():
    rows = client.get("/api/news", params={"hours": 720, "limit": 20}).json()
    assert len(rows) <= 20
    sigs = [r["overall_significance"] for r in rows]
    assert sigs == sorted(sigs, reverse=True)
    if rows:
        assert rows[0]["headline"]

    bad = client.get("/api/news", params={"hours": "soon"})
    assert bad.status_code == 422


def test_api_market_daily_returns_and_unknown_symbol():
    rows = client.get("/api/market/daily", params={"symbols": "SPY", "days": 60}).json()
    assert rows, "SPY daily bars expected"
    assert all(r["symbol"] == "SPY" for r in rows)
    assert rows[0]["ret_1d"] is None  # no prior row inside the window
    if len(rows) > 1:
        expected = (rows[1]["close"] / rows[0]["close"] - 1.0) * 100.0
        assert abs(rows[1]["ret_1d"] - expected) < 1e-9

    assert client.get("/api/market/daily", params={"symbols": "ZZZZ"}).json() == []


def test_api_market_intraday_shape():
    rows = client.get("/api/market/intraday", params={"symbols": "SPY,QQQ"}).json()
    if rows:
        assert set(rows[0]) == {"symbol", "ts", "close", "volume"}
        ts = [r["ts"] for r in rows if r["symbol"] == rows[0]["symbol"]]
        assert ts == sorted(ts)


def test_api_market_intraday_iso_since_same_day():
    """An ISO 'T…Z' since on the SAME day as stored rows must not drop them —
    stored ts uses a space separator, and ' ' < 'T' lexicographically ate every
    same-day row before the normalization fix (empty intraday chart, live)."""
    conn = _ro_conn()
    max_ts = conn.execute("SELECT MAX(ts) FROM market_intraday").fetchone()[0]
    conn.close()
    if not max_ts:
        pytest.skip("market_intraday empty")
    day = max_ts[:10]
    iso = client.get(
        "/api/market/intraday",
        params={"symbols": "SPY,QQQ", "since": f"{day}T00:00:00Z"},
    ).json()
    plain = client.get(
        "/api/market/intraday",
        params={"symbols": "SPY,QQQ", "since": f"{day} 00:00:00"},
    ).json()
    assert iso, "same-day ISO since returned no rows"
    assert iso == plain


def test_api_calendar_window():
    rows = client.get("/api/calendar", params={"days": 365}).json()
    assert isinstance(rows, list)
    if rows:
        assert {"event_name", "event_datetime", "importance"} <= set(rows[0])
        dts = [r["event_datetime"] for r in rows]
        assert dts == sorted(dts)


def test_api_backtests_pivoted():
    rows = client.get("/api/backtests").json()
    conn = _ro_conn()
    n_groups = conn.execute(
        "SELECT COUNT(*) FROM (SELECT DISTINCT test_name, cohort, horizon FROM backtest_results)"
    ).fetchone()[0]
    conn.close()
    assert len(rows) == n_groups
    if rows:
        assert {"avg_return", "median_return", "hit_rate", "n"} <= set(rows[0])


def test_api_credit_oas_units():
    body = client.get("/api/credit/oas").json()
    assert body["series"], "credit series expected"
    by_label = {s["label"]: s for s in body["series"]}
    assert "IG" in by_label and "HY" in by_label
    ig = by_label["IG"]
    assert abs(ig["value_bps"] - ig["value_pct"] * 100.0) < 1e-9
    assert ig["history"] and set(ig["history"][0]) == {"date", "value"}


def test_api_recession_probability():
    # First call trains the logistic model in-process — slow but bounded.
    r = client.get("/api/recession/probability")
    assert r.status_code == 200
    body = r.json()
    assert body["probability_source"] == "recession_model"
    assert 0.0 <= body["recession_prob"] <= 100.0
    assert body["recession_label"] in {"Low Risk", "Elevated", "High Risk"}
    assert body["recession_prob_series"]
    assert set(body["current_inputs"]) == {"unrate", "hy_oas", "indpro_yoy", "lei"}


def test_api_freshness():
    body = client.get("/api/freshness").json()
    assert set(body) == {
        "regimes_date", "signals_date", "market_daily_date",
        "market_intraday_ts", "news_published_at", "raw_series_date",
    }
    conn = _ro_conn()
    assert body["market_daily_date"] == conn.execute(
        "SELECT MAX(date) FROM market_daily"
    ).fetchone()[0]
    conn.close()


# ── Regime Lab endpoints (night-2) ───────────────────────────────────────────

def test_api_regime_intelligence():
    body = client.get("/api/regime/intelligence").json()
    assert body["conviction"] in {"High", "Medium", "Low"}
    assert body["primary_signal"] in {"Risk-On", "Risk-Off", "Mixed"}
    assert body["narrative"]
    probs = body["regime_probs"]
    assert set(probs) == {"goldilocks", "overheating", "stagflation", "recession_risk"}
    assert abs(sum(probs.values()) - 1.0) < 0.02  # stored softmax, 0–1
    # One truth: the label must match the regimes table's latest row.
    assert body["current_regime"] == client.get("/api/regime/latest").json()["label"]


def test_api_regime_playbooks_static_reference():
    body = client.get("/api/regime/playbooks").json()
    assert set(body) == {"Goldilocks", "Overheating", "Stagflation", "Recession Risk"}
    for regime, pb in body.items():
        assert pb["regime"] == regime
        assert {"overweight", "underweight"} <= set(pb["sector_tilts"])
        assert pb["asset_performance"], "playbook asset performance missing"
        for perf in pb["asset_performance"].values():
            assert set(perf) == {"avg_return", "hit_rate"}
        assert pb["key_risks"] and pb["opportunities"]


def test_api_regime_duration():
    body = client.get("/api/regime/duration").json()
    assert body["status"] in {"Early", "Mid-Cycle", "Extended", "Long in Tooth"}
    assert body["months_in_regime"] > 0
    assert 0 <= body["percentile_duration"] <= 100
    ri = body["risk_indicators"]
    assert set(ri) == {"momentum", "valuation", "sentiment"}
    assert all(0 <= v <= 100 for v in ri.values())
    assert body["current_regime"] == client.get("/api/regime/latest").json()["label"]


def test_api_regime_transitions():
    body = client.get("/api/regime/transitions").json()
    assert 0 <= body["stay_probability_3m"] <= 100
    for horizon in ("transitions_3m", "transitions_6m"):
        items = body[horizon]
        assert items, f"{horizon} empty"
        for t in items:
            assert t["to"] != body["current_regime"]  # self-transition excluded
            assert 0 <= t["probability"] <= 100
    assert body["narrative_3m"] and body["narrative_6m"]


def test_api_regime_analogues():
    rows = client.get("/api/regime/analogues").json()
    assert 0 < len(rows) <= 4
    scores = [r["similarity_score"] for r in rows]
    assert scores == sorted(scores, reverse=True)
    for r in rows:
        assert 0 <= r["similarity_score"] <= 100
        assert r["period"] and r["what_happened"] and r["lessons_for_today"]


def test_api_regime_scenarios_and_run():
    defs = client.get("/api/regime/scenarios").json()
    assert {d["key"] for d in defs} == {
        "covid_replay", "rate_shock", "soft_landing", "stagflation_scare", "credit_crisis",
    }

    run = client.post("/api/regime/scenario", json={"scenario_key": "rate_shock"})
    assert run.status_code == 200
    body = run.json()
    stressed = body["stressed_regime_probs"]
    assert abs(sum(stressed.values()) - 100.0) < 1.5  # renormalized percentages
    assert body["most_likely_regime"]
    # Custom shocks pass through the same math.
    custom = client.post(
        "/api/regime/scenario",
        json={"custom_shocks": {"hy_spread_delta_bps": 300, "vix_delta": 20,
                                "yield_10y_delta_bps": 0, "spx_delta_pct": -20}},
    )
    assert custom.status_code == 200
    assert (
        custom.json()["stressed_regime_probs"]["recession_risk"]
        >= body["current_regime_probs"]["recession_risk"]
    )

    assert client.post("/api/regime/scenario", json={}).status_code == 422
    assert (
        client.post("/api/regime/scenario", json={"scenario_key": "alien_invasion"}).status_code
        == 422
    )
    out_of_bounds = client.post(
        "/api/regime/scenario", json={"custom_shocks": {"hy_spread_delta_bps": 9999}}
    )
    assert out_of_bounds.status_code == 422


# ── Credit metrics (night-2) ─────────────────────────────────────────────────

def test_api_credit_metrics_one_truth_with_oas():
    body = client.get("/api/credit/metrics").json()
    assert body["credit_label"] in {"Normal", "Tight", "Stressed", "Crisis"}
    assert 0 <= body["hy_pct_rank"] <= 100 and 0 <= body["ig_pct_rank"] <= 100
    # Same underlying FRED rows as /api/credit/oas — the two endpoints must
    # report the same latest HY level (one number, one truth).
    oas = client.get("/api/credit/oas").json()
    hy = next(s for s in oas["series"] if s["label"] == "HY")
    assert abs(body["hy_oas"] - hy["value_bps"]) < 1e-6
    # Transition matrix rows are probability distributions.
    for row in body["transition_3m"].values():
        total = sum(row.values())
        assert total == 0.0 or abs(total - 1.0) < 0.01
    assert len(body["hy_sparkline"]) <= 6
    assert body["hy_series"] and set(body["hy_series"][0]) == {"date", "value"}


# ── Recession sensitivity (night-2) ──────────────────────────────────────────

def test_api_recession_scenario_reproduces_baseline():
    """POSTing the model's current inputs must land in the headline
    probability's neighborhood — a unit error (bps fed where % belongs) would
    saturate the logistic and blow far past this tolerance. The gap is NOT
    zero by design: the headline scores 3-month-LAGGED features (anti-look-
    ahead), while current_inputs are the unshifted readings — the Streamlit
    sensitivity panel shows the same nonzero delta at its default positions."""
    metrics = client.get("/api/recession/probability").json()
    cur = metrics["current_inputs"]
    if any(cur.get(k) is None for k in ("unrate", "hy_oas", "indpro_yoy", "lei")):
        pytest.skip("model inputs incomplete in this snapshot")
    req = {
        "yield_curve_bps": max(-200, min(300, metrics["yield_curve_spread"])),
        "unemployment": max(2.0, min(15.0, cur["unrate"])),
        "hy_oas_bps": max(100, min(2000, cur["hy_oas"])),
        "indpro_yoy": max(-20.0, min(10.0, cur["indpro_yoy"])),
        "lei": max(-5.0, min(5.0, cur["lei"])),
    }
    r = client.post("/api/recession/scenario", json=req)
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["probability"] <= 100.0
    assert body["label"] in {"Low Risk", "Elevated", "High Risk"}
    assert abs(body["probability"] - metrics["recession_prob"]) < 15.0
    assert body["delta_pp"] is not None

    bad = client.post("/api/recession/scenario", json={**req, "unemployment": 55})
    assert bad.status_code == 422


# ── LBO endpoints (night-2) ──────────────────────────────────────────────────

def test_api_lbo_defaults_and_run():
    d = client.get("/api/lbo/defaults").json()
    assert set(d) == {"fedfunds", "hy_oas_pct", "lbo_all_in_rate", "data_as_of"}
    assert abs(d["lbo_all_in_rate"] - (d["fedfunds"] + d["hy_oas_pct"])) < 0.02

    req = {
        "ebitda": 100.0, "ebitda_growth_rate": 5.0, "entry_multiple": 8.0,
        "exit_multiple": 9.0, "hold_period": 5, "leverage_ratio": 4.5,
        "interest_rate": d["lbo_all_in_rate"], "amortization_rate": 5.0,
        "mgmt_fee_pct": 1.5,
    }
    r = client.post("/api/lbo/run", json=req)
    assert r.status_code == 200
    body = r.json()
    res = body["result"]
    assert res["viable"] is True
    assert len(res["schedule"]) == 5
    # Single entry/exit cashflow pair ⇒ IRR must equal MOIC^(1/hold) − 1.
    implied = ((res["moic"]) ** (1 / 5) - 1) * 100
    assert abs(res["irr"] - implied) < 0.1

    sens = body["sensitivity"]
    assert sens["entry_multiples"] == [7.0, 7.5, 8.0, 8.5, 9.0]
    assert sens["exit_multiples"] == [8.0, 8.5, 9.0, 9.5, 10.0]
    center = sens["irr_grid"][2][2]
    assert abs(center - res["irr"]) < 1e-9

    # Debt beyond entry EV → honest non-viable result, not a 500.
    broke = client.post("/api/lbo/run", json={**req, "entry_multiple": 3.0, "leverage_ratio": 8.0})
    assert broke.status_code == 200
    assert broke.json()["result"]["viable"] is False
    assert broke.json()["result"]["error_msg"]

    assert client.post("/api/lbo/run", json={**req, "hold_period": 40}).status_code == 422


def test_api_lbo_fee_direction():
    """Transaction fees are a USE of funds: raising them must RAISE the
    sponsor's equity check and LOWER IRR and MOIC. The source model
    originally subtracted fees from the check, so the fee slider flattered
    returns as fees rose (night-2 critique P0, fixed 2026-08-07)."""
    base = {
        "ebitda": 100.0, "ebitda_growth_rate": 5.0, "entry_multiple": 8.0,
        "exit_multiple": 9.0, "hold_period": 5, "leverage_ratio": 4.5,
        "interest_rate": 8.0, "amortization_rate": 5.0, "mgmt_fee_pct": 0.0,
    }
    free = client.post("/api/lbo/run", json=base).json()["result"]
    fee5 = client.post("/api/lbo/run", json={**base, "mgmt_fee_pct": 5.0}).json()["result"]

    assert fee5["entry_equity"] > free["entry_equity"], "fees must grow the equity check"
    assert fee5["irr"] < free["irr"], "fees must cost IRR"
    assert fee5["moic"] < free["moic"], "fees must cost MOIC"
    # Sources = uses: equity check is entry EV + fees − debt, exactly.
    assert abs(fee5["entry_equity"] - (fee5["entry_ev"] * 1.05 - fee5["entry_debt"])) < 0.02
    assert abs(free["entry_equity"] - (free["entry_ev"] - free["entry_debt"])) < 0.02


# ── News & calendar fallbacks (night-2) ──────────────────────────────────────

def test_api_news_latest_fallback_ordering():
    rows = client.get("/api/news/latest", params={"limit": 10}).json()
    assert len(rows) <= 10
    stamps = [r["published_at"] for r in rows]
    assert stamps == sorted(stamps, reverse=True)
    if rows:
        assert rows[0]["headline"]


def test_api_calendar_recent_past_only():
    rows = client.get("/api/calendar/recent", params={"limit": 5}).json()
    assert len(rows) <= 5
    dts = [r["event_datetime"] for r in rows]
    assert dts == sorted(dts, reverse=True)
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert all(dt < now for dt in dts)


# ── Allocation (night-2; heavy — cold call downloads via yfinance) ───────────

def test_api_allocation_smoke():
    """Cold call reaches the data vendor (~30–60 s) then caches for an hour.
    Offline runs get a 502/503 — skip rather than fail (the endpoint's own
    honest degraded mode)."""
    r = client.get("/api/allocation")
    if r.status_code in (502, 503):
        pytest.skip(f"allocation engine degraded: {r.json()['detail']}")
    assert r.status_code == 200
    body = r.json()
    assert body["current_regime"] in {"Goldilocks", "Overheating", "Stagflation", "Recession Risk"}
    assert body["n_months"] > 100
    opts = body["optimizations"]
    assert {"mvo", "min_var", "risk_parity", "black_litterman", "hrp", "cvar", "herc"} <= set(opts)
    names = opts["asset_names"]
    for key in ("mvo", "min_var", "risk_parity"):
        w = opts[key]["weights"]
        assert len(w) == len(names)
        assert abs(sum(w) - 1.0) < 0.02
    # riskfolio is not installed in the API env — CVaR/HERC must say so.
    assert isinstance(opts["cvar"]["converged"], bool)
