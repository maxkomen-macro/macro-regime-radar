"""B3 (2026-09-18): freshness the screen can state honestly, per series.

Every series carries {id, label, kind, cadence, as_of, state, delay_min,
cycles_behind, stale, discontinued, reason}; state is one of live, delayed,
close, stale, fallback, unknown. The four-word SLA `verdict`/`overall` stay
exactly as they were (the order map, test_health and the web depend on them).
Contract: docs/redesign-v2/FRESHNESS_CONTRACT.md.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from api import freshness

STATES = {"live", "delayed", "close", "stale", "fallback", "unknown"}
KEYS = {"id", "label", "kind", "cadence", "as_of", "state", "delay_min", "cycles_behind", "stale", "discontinued", "reason"}

_FRESH = {
    "regimes_date": "2026-08-01", "signals_date": "2026-08-01", "market_daily_date": "2026-09-17",
    "market_intraday_ts": "2026-09-18 10:33:00", "news_published_at": "2026-09-18 14:00:00", "raw_series_date": "2026-09-01",
}
_STORED = [
    {"series_id": s, "date": "2026-09-01", "value": 1.0} for s in ("DGS10", "DGS2", "VIXCLS", "BAMLH0A0HYM2", "T10YIE")
] + [
    {"series_id": "CPIAUCSL", "date": "2026-08-01", "value": 1.0},
    {"series_id": "INDPRO", "date": "2026-07-01", "value": 1.0},
    {"series_id": "UNRATE", "date": "2026-08-01", "value": 1.0},
    {"series_id": "USSLIND", "date": "2020-02-01", "value": 1.0},
]
NOW = datetime(2026, 9, 18, 14, 40, tzinfo=timezone.utc)  # Friday 10:40 ET, session open


def _wm(obs, checked="2026-09-18T04:18:00Z"):
    return {"last_obs": obs, "last_value": 1.0, "advanced_at": checked, "checked_at": checked, "status": "ok", "detail": None}


def _series(report):
    return {s["id"]: s for s in report["series"]}


def _assess(watermarks=None, relay=None, now=NOW, fresh=_FRESH):
    return freshness.assess(db_fresh=fresh, series_latest=_STORED, relay=relay, bootstrap=None, now=now, watermarks=watermarks)


def test_every_series_carries_the_contract_keys_and_a_known_state():
    wms = {f"fred:{s}": _wm("2026-09-17") for s in ("DGS10", "DGS2", "VIXCLS", "BAMLH0A0HYM2", "T10YIE")}
    rep = _assess(wms)
    assert rep["overall"] in ("current", "delayed", "stale", "unavailable")  # four words, unchanged
    for s in rep["series"]:
        assert set(s) == KEYS, s
        assert s["state"] in STATES, s
        assert s["stale"] == (s["state"] == "stale")
    ids = set(_series(rep))
    assert {"DGS10", "VIXCLS", "CPIAUCSL", "USSLIND", "market_daily", "market_intraday"} <= ids


def test_a_current_daily_series_is_an_official_close_with_its_true_date():
    wms = {"fred:DGS10": _wm("2026-09-17")}
    s = _series(_assess(wms))["DGS10"]
    assert s["state"] == "close" and s["as_of"] == "2026-09-17" and s["cycles_behind"] == 0 and s["stale"] is False


def test_one_stale_series_is_flagged_with_cycles_behind():
    wms = {"fred:DGS10": _wm("2026-09-04")}  # checked this morning, not advancing
    s = _series(_assess(wms))["DGS10"]
    assert s["state"] == "stale" and s["stale"] is True and s["cycles_behind"] >= 6
    assert "2026-09-04" in s["reason"]


def test_month_stamped_daily_series_without_a_watermark_is_unknown_not_stale():
    s = _series(_assess(None))["DGS10"]
    assert s["state"] == "unknown" and s["as_of"] is None and s["stale"] is False


def test_monthly_series_counts_releases_behind():
    rep = _assess({})
    cpi, indpro = _series(rep)["CPIAUCSL"], _series(rep)["INDPRO"]
    assert cpi["state"] == "close" and cpi["cycles_behind"] == 0 and cpi["as_of"] == "2026-08-01"
    # Aug INDPRO is due from the 18th (G.17); stored July is one release behind.
    assert indpro["state"] == "stale" and indpro["cycles_behind"] == 1 and indpro["as_of"] == "2026-07-01"
    early = _series(_assess({}, now=datetime(2026, 9, 16, 14, 0, tzinfo=timezone.utc)))["INDPRO"]
    assert early["state"] == "close" and early["cycles_behind"] == 0


def test_a_discontinued_series_is_its_final_close_not_stale():
    s = _series(_assess({}))["USSLIND"]
    assert s["discontinued"] is True and s["state"] == "close" and s["stale"] is False and s["as_of"] == "2020-02-01"


def test_market_daily_behind_the_last_completed_session_says_so():
    after_close = datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc)  # Friday 17:00 ET
    stale = _series(_assess({}, now=after_close))["market_daily"]
    assert stale["state"] == "stale" and stale["cycles_behind"] == 1 and stale["as_of"] == "2026-09-17"
    fresh = _series(_assess({}, now=after_close, fresh={**_FRESH, "market_daily_date": "2026-09-18"}))["market_daily"]
    assert fresh["state"] == "close" and fresh["cycles_behind"] == 0


def test_intraday_bars_in_session_are_delayed_by_n_minutes():
    s = _series(_assess({}))["market_intraday"]
    assert s["state"] == "delayed" and s["delay_min"] == 7  # bar 10:33 ET, now 10:40 ET


def test_relay_states_live_unknown_and_close():
    base = {"token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {"us": False}, "degraded": False, "degraded_reasons": []}
    live = _series(_assess({}, relay=base))
    assert live["live_quotes"]["state"] == "live" and live["live_quotes"]["delay_min"] == 0
    assert live["vix_delayed"]["state"] == "delayed" and live["vix_delayed"]["delay_min"] == 15
    connecting = _series(_assess({}, relay={**base, "feeds": {"us": "connecting", "vix": "connecting"}}))
    assert connecting["live_quotes"]["state"] == "unknown" and connecting["vix_delayed"]["state"] == "unknown"
    closed = _series(_assess({}, relay=base, now=datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc)))
    assert closed["live_quotes"]["state"] == "close"


def test_lbo_fallback_is_flagged_and_creates_no_file(tmp_path, monkeypatch):
    from src.analytics import lbo

    missing = tmp_path / "nowhere" / "macro_radar.db"
    monkeypatch.setattr(lbo, "DB_PATH", missing)
    d = lbo.get_lbo_defaults()
    assert d["is_fallback"] is True and d["status"] == "fallback"
    assert (d["fedfunds"], d["hy_oas_pct"], d["lbo_all_in_rate"]) == (5.33, 3.27, 8.60)
    assert d["data_as_of"] == "unavailable"  # the web keys on this word
    assert not missing.exists() and not missing.parent.exists()


def test_seeded_snapshot_freshness_is_unknown_until_the_live_report():
    from scripts import build_snapshot

    wms = {"fred:DGS10": _wm("2026-09-17")}
    report = json.loads(json.dumps(_assess(wms)))
    seeded = build_snapshot.seed_freshness({"/api/freshness": report, "/api/credit/metrics": {"hy_oas": 270.0, "freshness": {"DGS10": _series(report)["DGS10"]}}})
    fr = seeded["/api/freshness"]
    assert fr["seeded"] is True and "overall" not in fr and "sla" not in fr
    assert all(s["state"] == "unknown" and s["stale"] is False for s in fr["series"])
    assert seeded["/api/credit/metrics"]["freshness"]["DGS10"]["state"] == "unknown"
    assert seeded["/api/credit/metrics"]["hy_oas"] == 270.0


@pytest.mark.parametrize("path", ["/api/credit/metrics", "/api/credit/oas?days=90", "/api/recession/probability", "/api/signals/latest", "/api/lbo/defaults"])
def test_payloads_carry_a_freshness_block(path):
    from fastapi.testclient import TestClient

    from api import db
    from api.main import app

    if not db.DB_PATH.exists():
        pytest.skip("local DB snapshot absent")
    body = TestClient(app).get(path).json()
    block = body.get("freshness")
    assert isinstance(block, dict) and block, path
    for sid, s in block.items():
        assert set(s) == KEYS and s["state"] in STATES and s["id"] == sid, (path, s)


def test_lbo_defaults_carry_status_and_component_dates():
    from fastapi.testclient import TestClient

    from api import db
    from api.main import app

    if not db.DB_PATH.exists():
        pytest.skip("local DB snapshot absent")
    d = TestClient(app).get("/api/lbo/defaults").json()
    assert d["status"] in ("live", "fallback") and d["is_fallback"] is (d["status"] == "fallback")
    assert d["fedfunds_as_of"] and d["hy_oas_as_of"]
    assert d["freshness"]["lbo_all_in_rate"]["state"] in ("close", "stale", "fallback", "unknown")


def test_series_registry_matches_the_fetched_fred_series():
    """api/ cannot import src.config (FRED key requirement), so the registry is
    a declared mirror; AST-read every *SERIES dict in src/config.py."""
    import ast
    from pathlib import Path

    tree = ast.parse((Path(__file__).resolve().parent.parent / "src" / "config.py").read_text())
    fetched: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id.endswith("SERIES") for t in node.targets):
            try:
                val = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
            if isinstance(val, dict):
                fetched |= {v for v in val.values() if isinstance(v, str)}
    assert fetched, "no *SERIES dicts found in src/config.py"
    assert fetched == set(freshness.SERIES_REGISTRY), fetched ^ set(freshness.SERIES_REGISTRY)


# ── BH1/BH2 (carried over from ITERATION_1_REPORT.md) ────────────────────────


def test_recession_block_names_the_series_the_model_reads():
    """BH1: the block listed USSLIND, which the model only probes for staleness,
    and omitted UNRATE and INDPRO, which are features. Read the loads straight
    out of src/analytics/recession.py so the list cannot drift again."""
    import ast
    from pathlib import Path

    from api.main import RECESSION_INPUTS

    tree = ast.parse((Path(__file__).resolve().parent.parent / "src" / "analytics" / "recession.py").read_text())
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_build_feature_frame")
    loaded = {
        n.args[0].value for n in ast.walk(fn)
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "_load_raw"
        and n.args and isinstance(n.args[0], ast.Constant)
    }
    assert loaded == {"DGS10", "DGS2", "UNRATE", "BAMLH0A0HYM2", "INDPRO", "USSLIND", "T10YIE", "T5YIE", "USREC"}
    # USREC is the NBER training target, USSLIND only the staleness probe; the
    # rest are the inputs whose dates the screen has to be able to state.
    assert set(RECESSION_INPUTS) == loaded - {"USSLIND", "USREC"}
    assert RECESSION_INPUTS == ["DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE", "T5YIE", "UNRATE", "INDPRO"]


def test_recession_payload_block_carries_those_series_and_not_usslind():
    from fastapi.testclient import TestClient

    from api import db
    from api.main import RECESSION_INPUTS, app

    if not db.DB_PATH.exists():
        pytest.skip("local DB snapshot absent")
    block = TestClient(app).get("/api/recession/probability").json()["freshness"]
    assert set(block) == set(RECESSION_INPUTS)
    assert "USSLIND" not in block


def test_live_quotes_dates_itself_from_the_last_us_tick_not_a_weekend_frame():
    """BH2: the US socket carries frames on a Sunday; the feed's as_of must be
    the last US quote's own timestamp (Friday's close), not that arrival."""
    relay = {
        "token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {"us": False},
        "degraded": False, "degraded_reasons": [],
        "feed_last_frame_at": {"us": "2026-09-20T21:23:13Z", "vix": "2026-09-20T22:40:07Z"},
        "feed_last_tick_at": {"us": "2026-09-18T20:00:00Z", "crypto": "2026-09-20T21:23:00Z", "vix": "2026-09-20T22:40:00Z"},
    }
    sunday = datetime(2026, 9, 20, 21, 30, tzinfo=timezone.utc)
    report = _assess({}, relay=relay, now=sunday)
    s = _series(report)["live_quotes"]
    assert s["as_of"] == "2026-09-18T20:00:00Z" and s["state"] == "close"
    sla = {r["feed"]: r for r in report["sla"]}["live_quotes"]
    assert sla["latest"] == "2026-09-18T20:00:00Z"


def test_live_quotes_falls_back_to_frame_arrival_when_no_tick_stamp_exists():
    """An older relay payload (or a feed that has not printed yet) has no tick
    stamp; the report stays populated rather than reading 'As of unknown'."""
    relay = {
        "token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {"us": False},
        "degraded": False, "degraded_reasons": [],
        "feed_last_frame_at": {"us": "2026-09-18T17:00:00Z"},
    }
    s = _series(_assess({}, relay=relay))["live_quotes"]
    assert s["as_of"] == "2026-09-18T17:00:00Z" and s["state"] == "live"
