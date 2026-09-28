"""tests/test_desk_v2_macro.py — GET /api/desk/macro (desk/frame-3-api-b2a).

DESK_FRAME3_SPEC §12.8 and docs/desk/FRAME3_API_PLAN.md §7 commit 8: the
`desk_macro` item (N8's curve alignment with S-29/S-30's per-tenor dates, N7's
rolling HY statistics on the engine's calendar, R5's band with its constant
edges) and the route in the §12.0 envelope.

The three FRED tenors (DGS3MO, DGS5, DGS30) are registered in the Desk
registry; /macro reads the tenors it declares, null until stored. Route tests
run on the hermetic store (tests/desk_macro_store.py), which stores DGS2 and
DGS10 only; the shape is also checked on the scratch and published copies
when present.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api import db
from api import desk_items_macro as items
from api import desk_v2_macro as v2m
from api.main import app
from tests import desk_contract as contract
from tests import desk_macro_store as store
from tests.test_desk_v2_regime import at, run_failing_build, serve

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(os.environ.get("DESK_DB", ROOT / "data" / "desk_scratch.db"))
PUBLISHED = ROOT / "data" / "macro_radar.db"
AUDIT_SHA = "9a8b857968b8de22"  # FRAME3_DATA_AUDIT.md's copy of the store
client = TestClient(app)
AWAITING_REFRESH = "Awaiting refresh: this could not be computed from the current data."
CORRELATIONS = "the 12-asset matrix's assets and method are not specified yet."
# desk/fill-etf: the hermetic store holds no asset_prices, so the stock–bond block awaits the ETF refresh
STOCK_BOND_AWAITING = "Awaiting refresh: the full refresh stores SPY, TLT; this database predates it."
TENOR_KEYS = ("3m", "2y", "5y", "10y", "30y")


def serve_macro(install_worker, monkeypatch, path: Path):
    return serve(install_worker, monkeypatch, path, names=("desk_macro", "desk_etf"))


def get_macro() -> dict:
    return contract.check_response("/macro", client.get("/api/desk/macro"))


def rewrite(path: Path, series_id: str, rows: list[tuple[str, float]]) -> None:
    """Replace one desk_series series with `rows` (the store's own writer)."""
    from src.market_data import desk_history

    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM desk_series WHERE series_id = ?", (series_id,))
    desk_history.write_series(conn, series_id, rows, provider="fred", merge=False)
    conn.commit()
    conn.close()


def drop_rows(path: Path, series_id: str, where: str) -> None:
    conn = sqlite3.connect(path)
    conn.execute(f"DELETE FROM desk_series WHERE series_id = ? AND {where}", (series_id,))
    conn.commit()
    conn.close()


def stored(path: Path, series_id: str) -> pd.Series:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute("SELECT date, value FROM desk_series WHERE series_id = ? ORDER BY date", (series_id,)).fetchall()
    finally:
        conn.close()
    return pd.Series([r[1] for r in rows], index=pd.DatetimeIndex([r[0] for r in rows]))


@pytest.fixture()
def hermetic(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    serve_macro(install_worker, monkeypatch, path)
    return path


# ── The route ───────────────────────────────────────────────────────────────

def test_macro_shape(hermetic):
    body = get_macro()
    assert body["status"] == "ready"
    d = body["data"]
    assert d["matrix"] == {"status": "awaiting", "data": None, "unavailable": {"reason": CORRELATIONS, "until": None}}
    # desk/fill-etf: no SPY in the hermetic store, so the correlations await the ETF refresh
    assert d["correlations"]["unavailable"]["reason"] == "Awaiting refresh: the full refresh stores SPY; this database predates it."
    assert d["stock_bond"] == {"status": "awaiting", "data": None, "unavailable": {"reason": STOCK_BOND_AWAITING, "until": None}}
    assert d["curve"]["status"] == d["credit"]["status"] == "ready"
    c = d["credit"]["data"]
    assert set(c["rank_window"]) == {"start", "end", "n", "expected_n", "valid_n", "missing_n", "first_obs", "last_obs"}
    assert c["band_edges"] == [0.30, 0.70] and c["rank_window"]["n"] == c["rank_window"]["valid_n"]
    for snap in (d["curve"]["data"]["today"], d["curve"]["data"]["month_ago"]):
        assert tuple(snap["dates"]) == TENOR_KEYS


def test_regime_and_macro_answer_on_one_generation(tmp_path, install_worker, monkeypatch):
    serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"), names=("recession", "desk_regime", "desk_macro"))
    at(monkeypatch, datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc))
    a = contract.check_response("/regime", client.get("/api/desk/regime"))
    b = get_macro()
    assert a["generation_id"] == b["generation_id"] and a["as_of"] == b["as_of"] and a["generation_id"]


def test_before_the_desk_store_the_curve_is_null_and_credit_awaits(tmp_path, install_worker, monkeypatch):
    """No desk_series table (a database before the first full refresh): every
    tenor null with a null date, and the credit block awaiting (S-27)."""
    serve_macro(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db", desk=False))
    d = get_macro()["data"]
    curve = d["curve"]["data"]
    for snap in (curve["today"], curve["month_ago"]):
        assert snap["date"] is None and all(snap[t] is None and snap["dates"][t] is None for t in TENOR_KEYS)
    assert curve["2s10s_bp"] is curve["2s10s_chg_bp"] is curve["10y_chg_bp"] is None
    assert d["credit"] == {"status": "awaiting", "data": None, "unavailable": {"reason": AWAITING_REFRESH, "until": None}}


def test_without_the_ig_watermark_credit_awaits(tmp_path, install_worker, monkeypatch):
    serve_macro(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db", watermarks=False))
    d = get_macro()["data"]
    assert d["credit"]["status"] == "awaiting" and d["curve"]["status"] == "ready"


# ── N8: the curve ───────────────────────────────────────────────────────────

def test_the_common_date_path(hermetic):
    """N8: today is the latest date every stored tenor has; a month ago the
    latest common date on or before it less one calendar month."""
    ten, two = stored(hermetic, "DGS10"), stored(hermetic, "DGS2")
    common = ten.index.intersection(two.index)
    today, ago = common.max(), common[common <= common.max() - pd.DateOffset(months=1)].max()
    curve = get_macro()["data"]["curve"]["data"]
    t, m = curve["today"], curve["month_ago"]
    assert t["date"] == today.strftime("%Y-%m-%d") == store.DAILY_END and m["date"] == ago.strftime("%Y-%m-%d")
    assert t["dates"] == {"3m": None, "2y": t["date"], "5y": None, "10y": t["date"], "30y": None}
    assert m["dates"] == {"3m": None, "2y": m["date"], "5y": None, "10y": m["date"], "30y": None}
    assert (t["10y"], t["2y"], m["10y"], m["2y"]) == (ten[today], two[today], ten[ago], two[ago])
    assert t["3m"] is t["5y"] is t["30y"] is None
    assert curve["2s10s_bp"] == (t["10y"] - t["2y"]) * 100.0
    assert curve["2s10s_chg_bp"] == curve["2s10s_bp"] - (m["10y"] - m["2y"]) * 100.0
    assert curve["10y_chg_bp"] == (t["10y"] - m["10y"]) * 100.0
    assert (curve["freq"], curve["source"]) == ("daily", "FRED")


def test_disjoint_histories_have_no_anchor(tmp_path, install_worker, monkeypatch):
    """Round 6's R-18 (S-29) and rounds 7–8's R-19/R-20 (S-30): DGS2 through
    2026-06-30, DGS10 from 2026-07-01: no common date, each tenor its own, and
    every difference null; both `dates` carry all five tenors."""
    path = store.build(tmp_path / "macro_radar.db")
    two = [(d, 4.0 + i * 1e-3) for i, d in enumerate(store.bond_days("2026-01-02", "2026-06-30"))]
    ten = [(d, 4.5 + i * 1e-3) for i, d in enumerate(store.bond_days("2026-07-01", "2026-09-22"))]
    rewrite(path, "DGS2", two)
    rewrite(path, "DGS10", ten)
    serve_macro(install_worker, monkeypatch, path)
    curve = get_macro()["data"]["curve"]["data"]
    t, m = curve["today"], curve["month_ago"]
    assert t["date"] is None and m["date"] is None
    assert t["dates"] == {"3m": None, "2y": "2026-06-30", "5y": None, "10y": "2026-09-22", "30y": None}
    assert (t["2y"], t["10y"]) == (dict(two)["2026-06-30"], dict(ten)["2026-09-22"])
    assert m["dates"] == {"3m": None, "2y": "2026-05-29", "5y": None, "10y": "2026-08-21", "30y": None}  # 05-30 is a Saturday
    assert (m["2y"], m["10y"]) == (dict(two)["2026-05-29"], dict(ten)["2026-08-21"])
    assert curve["2s10s_bp"] is curve["2s10s_chg_bp"] is curve["10y_chg_bp"] is None
    assert all(t[k] is None and m[k] is None for k in ("3m", "5y", "30y"))


def test_a_common_today_with_no_common_date_a_month_earlier(tmp_path, install_worker, monkeypatch):
    """Plan N8's closure of S-29: today is one curve (2s10s served); a month
    ago takes the per-tenor form and both changes are null."""
    path = store.build(tmp_path / "macro_radar.db")
    two = [("2026-08-14", 3.9)] + [(d, 4.0) for d in store.bond_days("2026-09-01", "2026-09-22")]
    rewrite(path, "DGS2", two)
    drop_rows(path, "DGS10", "date = '2026-08-14'")
    serve_macro(install_worker, monkeypatch, path)
    ten = stored(path, "DGS10")
    curve = get_macro()["data"]["curve"]["data"]
    t, m = curve["today"], curve["month_ago"]
    assert t["date"] == "2026-09-22" and m["date"] is None
    assert m["dates"] == {"3m": None, "2y": "2026-08-14", "5y": None, "10y": "2026-08-21", "30y": None}
    assert (m["2y"], m["10y"]) == (3.9, ten["2026-08-21"])
    assert curve["2s10s_bp"] == (t["10y"] - t["2y"]) * 100.0
    assert curve["2s10s_chg_bp"] is None and curve["10y_chg_bp"] is None


def test_the_registered_tenors_are_served_and_the_registry_decides(tmp_path, install_worker, monkeypatch):
    """DGS3MO, DGS5 and DGS30 are registered (desk-v2: register DGS3MO, DGS5,
    DGS30): once stored, /macro draws all five tenors on the common date. The
    registry, not the table, decides what the Desk reads: a tenor stored but
    taken out of the registry is null."""
    from src.desk import series as registry

    path = store.build(tmp_path / "macro_radar.db")
    days = store.bond_days("2026-01-02", store.DAILY_END)
    for sid, v in (("DGS3MO", 4.1), ("DGS5", 4.2), ("DGS30", 4.9)):
        rewrite(path, sid, [(d, v) for d in days])
    serve_macro(install_worker, monkeypatch, path)
    curve = get_macro()["data"]["curve"]["data"]
    t, m = curve["today"], curve["month_ago"]
    assert (t["3m"], t["5y"], t["30y"]) == (4.1, 4.2, 4.9)
    assert t["dates"] == {k: store.DAILY_END for k in TENOR_KEYS} and t["date"] == store.DAILY_END
    assert m["date"] is not None and all(m["dates"][k] == m["date"] for k in TENOR_KEYS)

    monkeypatch.delitem(registry.BY_SERIES_ID, "DGS30")
    serve_macro(install_worker, monkeypatch, path)
    t = get_macro()["data"]["curve"]["data"]["today"]
    assert t["30y"] is None and t["dates"]["30y"] is None and t["5y"] == 4.2


# ── N7: the rolling HY statistics, R5 ───────────────────────────────────────

def test_a_full_window_serves_the_rank_and_the_range(hermetic):
    """N7 with full coverage. A weekend month-end print and prints on NYSE
    holidays count as valid observations and are never expected."""
    hy = stored(hermetic, "BAMLH0A0HYM2")
    c = get_macro()["data"]["credit"]["data"]
    end = hy.index[-1]
    window = hy[hy.index >= end - pd.DateOffset(years=3)]
    cur = hy.iloc[-1]
    assert c["hy"] == {"value": cur, "date": end.strftime("%Y-%m-%d"), "freq": "daily", "source": "FRED BAMLH0A0HYM2"}
    assert c["ig"] == {"value": store.IG_LAST[1], "date": store.IG_LAST[0], "freq": "daily", "source": "FRED BAMLC0A0CM"}
    rw = c["rank_window"]
    assert rw["missing_n"] == 0 and rw["valid_n"] == len(window) and rw["valid_n"] > rw["expected_n"]
    assert rw["start"] == (end - pd.DateOffset(years=3)).strftime("%Y-%m-%d") and rw["end"] == rw["last_obs"] == end.strftime("%Y-%m-%d")
    assert rw["first_obs"] == window.index[0].strftime("%Y-%m-%d")
    assert c["hy_pct_3y"] == (window < cur).sum() / len(window)
    assert c["hy_range_3y"] == [window.min(), window.max()]
    assert c["reason"] is None and c["band"] == items.credit_band(c["hy_pct_3y"])
    line = hy[hy.index >= end - pd.DateOffset(months=12)]
    assert c["series"] == [{"date": d.strftime("%Y-%m-%d"), "hy": v} for d, v in line.items()]
    assert c["line_window"] == {"start": (end - pd.DateOffset(months=12)).strftime("%Y-%m-%d"),
                                "end": end.strftime("%Y-%m-%d"), "n": len(line)}
    assert c["peak_12m"] == {"date": line.idxmax().strftime("%Y-%m-%d"), "hy": line.max()}


def test_one_gap_on_an_expected_session_nulls_the_three_year_figures(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    drop_rows(path, "BAMLH0A0HYM2", "date = '2025-03-04'")
    serve_macro(install_worker, monkeypatch, path)
    c = get_macro()["data"]["credit"]["data"]
    assert c["hy_pct_3y"] is None and c["hy_range_3y"] is None and c["band"] is None
    assert c["band_edges"] == [0.30, 0.70]  # never null (R-14)
    assert c["rank_window"]["missing_n"] == 1
    assert c["reason"] == "no value on 1 expected session in the three-year window: 2025-03-04"


def test_a_long_gap_names_its_first_three_dates_and_its_count(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    drop_rows(path, "BAMLH0A0HYM2", "date BETWEEN '2025-03-03' AND '2025-03-07'")
    serve_macro(install_worker, monkeypatch, path)
    c = get_macro()["data"]["credit"]["data"]
    assert c["reason"] == ("no value on 5 expected sessions in the three-year window: "
                           "2025-03-03, 2025-03-04, 2025-03-05 and 2 more")


def test_a_history_shorter_than_three_years_reads_coverage_from(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    drop_rows(path, "BAMLH0A0HYM2", "date < '2024-06-03'")
    serve_macro(install_worker, monkeypatch, path)
    c = get_macro()["data"]["credit"]["data"]
    assert c["hy_pct_3y"] is None and c["reason"] == "coverage from 2024-06-03 only"
    assert c["rank_window"]["first_obs"] == "2024-06-03" and c["rank_window"]["missing_n"] > 0


def test_nyse_holidays_and_bond_closures_are_never_counted_missing(tmp_path, install_worker, monkeypatch):
    """S-12 (the 2023-12-25 case): expected sessions are the engine's XNYS
    sessions less the bond-market closures, so HY with no print on Christmas
    2023 (outside api/calendar's 2024–2027 tables), on Columbus Day and on
    Veterans Day still has full coverage and serves its rank."""
    path = store.build(tmp_path / "macro_radar.db")
    drop_rows(path, "BAMLH0A0HYM2", "date IN ('2023-12-25', '2024-01-15', '2024-10-14', '2024-11-11', '2025-10-13')")
    serve_macro(install_worker, monkeypatch, path)
    c = get_macro()["data"]["credit"]["data"]
    assert c["rank_window"]["missing_n"] == 0 and c["hy_pct_3y"] is not None and c["reason"] is None


def test_ties_are_not_below_and_the_peak_is_the_earliest(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    days = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(store.HY_FROM, store.HY_END)]
    rewrite(path, "BAMLH0A0HYM2", [(d, 3.0) for d in days])
    serve_macro(install_worker, monkeypatch, path)
    c = get_macro()["data"]["credit"]["data"]
    assert c["hy_pct_3y"] == 0.0 and c["band"] == "tight" and c["hy_range_3y"] == [3.0, 3.0]
    assert c["peak_12m"] == {"date": c["series"][0]["date"], "hy": 3.0}


def test_the_credit_band_and_its_edges():
    """R5: tight < 0.30 ≤ normal < 0.70 ≤ wide; null exactly when the rank is."""
    assert [items.credit_band(p) for p in (0.0, 0.2999, 0.30, 0.6999, 0.70, 1.0)] == \
        ["tight", "tight", "normal", "normal", "wide", "wide"]
    assert items.credit_band(None) is None and list(items.CREDIT_BAND_EDGES) == [0.30, 0.70]


# ── Real stores ─────────────────────────────────────────────────────────────

def _present(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0


@pytest.mark.parametrize("path", [SCRATCH, PUBLISHED], ids=["scratch", "published"])
def test_macro_shape_on_a_real_store(path, install_worker, monkeypatch):
    if not _present(path):
        pytest.skip(f"{path.name} is not in this tree")
    serve_macro(install_worker, monkeypatch, path)
    body = get_macro()
    assert body["status"] == "ready"
    for snap in (body["data"]["curve"]["data"]["today"], body["data"]["curve"]["data"]["month_ago"]):
        assert tuple(snap["dates"]) == TENOR_KEYS


def test_the_audit_copys_figures(install_worker, monkeypatch):
    """FRAME3_DATA_AUDIT.md Q4 and Q5 on the audit's own copy: the curve on
    2026-09-22 against 2026-08-21, and HY over 787 observations with none
    missing, at the 15.50th percentile (122 of 787 below)."""
    if not _present(PUBLISHED) or hashlib.sha256(PUBLISHED.read_bytes()).hexdigest()[:16] != AUDIT_SHA:
        pytest.skip("the audit's copy of the store is not data/macro_radar.db here")
    serve_macro(install_worker, monkeypatch, PUBLISHED)
    d = get_macro()["data"]
    curve, c = d["curve"]["data"], d["credit"]["data"]
    assert (curve["today"]["date"], curve["month_ago"]["date"]) == ("2026-09-22", "2026-08-21")
    assert c["rank_window"] == {"start": "2023-09-23", "end": "2026-09-23", "n": 787, "expected_n": 747, "valid_n": 787,
                                "missing_n": 0, "first_obs": "2023-09-25", "last_obs": "2026-09-23"}
    assert c["hy_pct_3y"] == 122 / 787 and c["band"] == "tight"
    assert c["line_window"]["n"] == 264 and c["peak_12m"] == {"date": "2026-03-30", "hy": 3.46}


# ── Connections to the generation's copy (plan §5) ──────────────────────────

def test_a_desk_macro_build_that_fails_midway_leaves_no_connection_to_the_copy(tmp_path):
    res = run_failing_build(tmp_path, ("desk_macro",))
    assert res["left_open"] == 0 and res["fresh"] > 0, res
    assert res["errors"].get("desk_macro") == "SchemaCheckFailed", res


# ── Item 8 (desk/fill-compute): the published store's month, verified against its raw FRED rows ──

# The stored desk_series rows of the published store (data-latest, synced 2026-09-27 17:55 UTC) around
# the two curve dates: the last common observation (2026-09-24) and the last on or before it less one
# calendar month (2026-08-24; 2026-08-22 and 23 are a weekend).
LIVE_ROWS = {
    "3m": {"2026-08-21": 3.88, "2026-08-24": 3.87, "2026-09-23": 4.19, "2026-09-24": 4.24},
    "2y": {"2026-08-21": 4.24, "2026-08-24": 4.24, "2026-09-23": 4.85, "2026-09-24": 4.87},
    "5y": {"2026-08-21": 4.43, "2026-08-24": 4.41, "2026-09-23": 4.99, "2026-09-24": 5.03},
    "10y": {"2026-08-21": 4.74, "2026-08-24": 4.70, "2026-09-23": 5.11, "2026-09-24": 5.18},
    "30y": {"2026-08-21": 5.27, "2026-08-24": 5.23, "2026-09-23": 5.40, "2026-09-24": 5.47},
}


def test_the_published_months_10y_and_2y_moves_are_the_raw_rows():
    """The Macro tab's +48 bp on the 10-year and the 2-year's ≈ +63 bp implied
    by 2s10s's −15 bp: (5.18 − 4.70) × 100 and (4.87 − 4.24) × 100 on
    2026-09-24 against 2026-08-24, the dates the curve picks."""
    levels = {t: pd.Series(list(v.values()), index=pd.DatetimeIndex(list(v))) for t, v in LIVE_ROWS.items()}
    c = items.curve(levels)
    assert (c["today"]["date"], c["month_ago"]["date"]) == ("2026-09-24", "2026-08-24")
    assert c["10y_chg_bp"] == pytest.approx(48.0, abs=1e-9)
    assert c["2s10s_bp"] == pytest.approx(31.0, abs=1e-9) and c["2s10s_chg_bp"] == pytest.approx(-15.0, abs=1e-9)
    two_year = c["10y_chg_bp"] - c["2s10s_chg_bp"]
    assert two_year == pytest.approx((4.87 - 4.24) * 100, abs=1e-9) == pytest.approx(63.0, abs=1e-9)
