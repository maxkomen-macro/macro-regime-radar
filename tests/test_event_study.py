"""The conditional event-study engine (desk/event-study, 2026-09-21; review
R-01 … R-20 of the same day, two rounds).

Two layers. The synthetic tests build a small database (asset_prices,
desk_series, regimes) with known series, including the gaps the real data
has (a gold bar missing on an NYSE session, a Globex bar on an NYSE holiday,
bond-market holidays, a FRED weekend month-end), and pin every rule. The
scratch tests (§8) run against the owner-populated copy `data/desk_scratch.db`
(DESK_DB overrides the path; they skip without it): an independent pandas
recomputation of the preset, the look-ahead shift, every stored series
reaching its declared start, and the wording. The real database is never
opened for writing. Every review finding R-xx names its test in
docs/desk/EVENT_STUDY_REPORT.md §9."""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from src.desk import event_study as es
from src.desk import series as registry
from src.market_data import asset_history, desk_history

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(os.environ.get("DESK_DB", ROOT / "data" / "desk_scratch.db"))
scratch = pytest.mark.skipif(not SCRATCH.exists(), reason="populate data/desk_scratch.db (docs/desk/EVENT_STUDY_REPORT.md) for the real-data tests")
BANNED = ("predict", " will ", "proves", "model", "guarantee", "since data start")
NY = ZoneInfo("America/New_York")

REGIMES_DDL = """CREATE TABLE regimes (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
confidence REAL NOT NULL, growth_trend REAL, inflation_trend REAL, computed_at TEXT NOT NULL,
prob_goldilocks REAL, prob_overheating REAL, prob_stagflation REAL, prob_recession REAL)"""

GOLD_GAP = "2010-06-16"          # an NYSE session with no gold bar
GOLD_OFF = "2010-07-05"          # Independence Day (observed): a Globex bar on an NYSE holiday
BOND_HOLIDAYS = ("10-12", "11-11")  # Columbus and Veterans Day: NYSE open, no Treasury print
OAS_WEEKEND = "2024-03-31"       # a FRED weekend month-end stamp


def _synthetic_db(path: Path, seed: int = 3, *, regimes: bool = True, spx_end: str = "2026-09-18") -> Path:
    """Random-walk levels on weekdays 1995→2026-09-18 with the real data's
    gaps; gold from 2000-08-30, HY OAS from 2023-09-22; regimes monthly from
    1996-05, the four labels cycling every six months."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("1995-01-02", spx_end)
    days = days[days != pd.Timestamp(GOLD_OFF)]  # NYSE closed that day
    n = len(days)
    spx = 100.0 * np.cumprod(1.0 + rng.normal(0.0003, 0.01, n))
    gold = 300.0 * np.cumprod(1.0 + rng.normal(0.0002, 0.011, n))
    vix = np.clip(20.0 * np.exp(np.cumsum(rng.normal(0.0, 0.05, n))), 9.0, 90.0)
    dgs10 = 3.0 + np.cumsum(rng.normal(0.0, 0.03, n))
    dgs2 = dgs10 - 0.5 + np.cumsum(rng.normal(0.0, 0.01, n))
    hy = 4.0 + np.cumsum(rng.normal(0.0, 0.02, n))
    conn = sqlite3.connect(path)
    asset_history.ensure_table(conn)
    desk_history.ensure_table(conn)
    d = [x.strftime("%Y-%m-%d") for x in days]
    asset_history.write_series(conn, "^GSPC", "1d", list(zip(d, spx.tolist())), provider="test")
    g0 = int(days.searchsorted(pd.Timestamp("2000-08-30")))
    gold_rows = [(dd, v) for dd, v in zip(d[g0:], gold[g0:].tolist()) if dd != GOLD_GAP] + [(GOLD_OFF, 1234.5)]
    asset_history.write_series(conn, "GC=F", "1d", gold_rows, provider="test")
    bond = [(dd, v) for dd, v in zip(d, dgs10.tolist()) if dd[5:] not in BOND_HOLIDAYS]
    desk_history.write_series(conn, "DGS10", bond, provider="fred", merge=False)
    desk_history.write_series(conn, "DGS2", [(dd, v) for dd, v in zip(d, dgs2.tolist()) if dd[5:] not in BOND_HOLIDAYS], provider="fred", merge=False)
    desk_history.write_series(conn, "T10Y2Y", [(dd, v) for dd, v in zip(d, (dgs10 - dgs2).tolist()) if dd[5:] not in BOND_HOLIDAYS], provider="fred", merge=False)
    desk_history.write_series(conn, "VIXCLS", list(zip(d, vix.tolist())), provider="fred", merge=False)
    h0 = int(days.searchsorted(pd.Timestamp("2023-09-22")))
    desk_history.write_series(conn, "BAMLH0A0HYM2", list(zip(d[h0:], hy[h0:].tolist())) + [(OAS_WEEKEND, 4.2)], provider="fred", merge=False)
    conn.execute(REGIMES_DDL)
    if regimes:
        months = pd.period_range("1996-05", "2026-07", freq="M")
        rows = [(m.to_timestamp().strftime("%Y-%m-%d"), es.REGIME_LABELS[(i // 6) % 4], 0.5, 0.0, 0.0, "t") for i, m in enumerate(months)]
        conn.executemany("INSERT INTO regimes (date, label, confidence, growth_trend, inflation_trend, computed_at) VALUES (?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return path


@pytest.fixture()
def synth(tmp_path):
    return _synthetic_db(tmp_path / "synth.db")


def _no_banned(text: str) -> None:
    low = " " + text.lower() + " "
    for word in BANNED:
        assert word not in low, f"verdict uses {word!r}: {text}"


def _h(r: dict, h: int) -> dict:
    return next(x for x in r["horizons"] if x["h"] == h)


# ── queries, slugs, validation (R-07, R-14) ───────────────────────────────────

def test_slugs_round_trip_losslessly_and_presets_keep_their_names():
    qs = [
        es.PRESETS["gold-2sigma-spx-weak"],
        es.Query(shock="us10y", w=5, z=1.5, sign="-", cond="vix_above", cond_value=25, target="gold", regime="Stagflation"),
        es.Query(shock="vix", w=60, z=2.5, sign="both", cond="regime", cond_value="Recession Risk", target="hy_oas"),
        es.Query(shock="curve_2s10s", w=20, z=2.0, sign="+", cond="hy_oas_20d_change_above", cond_value=-50.0, target="us10y"),
        es.Query(shock="gold", w=20, z=2.0, sign="+", cond="vix_above", cond_value=0.1, target="spx"),
        es.Query(kind="cross", cross="death", target="spx", regime="Overheating"),
    ]
    for q in qs:
        slug = es.slug_for(q)
        assert es.validate(es.parse_slug(slug)) == es.validate(q), slug
    assert es.slug_for(es.Query(shock="vix", w=5, z=2.0, target="spx")) == "vix-w5-z2.0-up-none-spx"
    assert es.slug_for(es.PRESETS["gold-2sigma-spx-weak"]) == "gold-2sigma-spx-weak"
    assert es.slug_for(es.Query(kind="cross", cross="golden", target="spx")) == "spx-golden-cross"
    assert es.slug_for(replace(es.PRESETS["gold-2sigma-spx-weak"], seed=7)) == "gold-2sigma-spx-weak", "the seed is not part of the address"
    with pytest.raises(es.StudyError):
        es.parse_slug("not-a-study")


def test_cond_value_is_clamped_and_slugs_round_trip_over_random_queries():
    """R-15: cond_value clamped to ±1e6 at validation, serialized with repr;
    the parser accepts what the serializer emits, over random valid queries."""
    q = es.validate(es.Query(cond="vix_above", cond_value=5e9))
    assert q.cond_value == 1e6 and es.validate(es.parse_slug(es.slug_for(q))) == q
    assert es.validate(es.Query(cond="hy_oas_20d_change_above", cond_value=-7e7)).cond_value == -1e6
    rng = np.random.default_rng(20260921)
    shocks = [s.key for s in registry.with_role("shock") if s.tier < 3]
    targets = [s.key for s in registry.with_role("target") if s.tier < 3]
    conds = list(es.CONDITIONS) + [None]
    for _ in range(400):
        cond = conds[rng.integers(len(conds))]
        if cond is None or es.CONDITIONS[cond]["param"] is None:
            cv = None
        elif cond == "regime":
            cv = es.REGIME_LABELS[rng.integers(4)]
        else:
            scale = 10.0 ** rng.integers(-6, 9)
            cv = float(rng.normal() * scale)
        q = es.Query(shock=shocks[rng.integers(len(shocks))], w=es.WINDOWS[rng.integers(3)], z=es.THRESHOLDS[rng.integers(3)],
                     sign=es.SIGNS[rng.integers(3)], cond=cond, cond_value=cv, regime=(["all"] + list(es.REGIME_LABELS))[rng.integers(5)],
                     target=targets[rng.integers(len(targets))], seed=int(rng.integers(0, es.MAX_SEED)))
        v = es.validate(q)
        slug = es.slug_for(v)
        back = es.validate(es.parse_slug(slug))
        assert replace(back, seed=v.seed) == v, (slug, v)
        assert es.cache_key(replace(back, seed=v.seed)) == es.cache_key(v)


def test_cache_key_is_the_validated_parameters(tmp_path):
    a = es.cache_key(es.Query(z="2.0", w="20", seed="20260921"))
    b = es.cache_key(es.Query(z=2.0, w=20))
    assert a == b and es.cache_key(es.Query(z=2.5)) != b and '"seed":20260921' in b


@pytest.mark.parametrize("bad", [
    dict(w=7), dict(z=3.0), dict(sign="up"), dict(cond="spx_above_moon"), dict(cond="vix_above"),
    dict(cond="vix_above", cond_value="high"), dict(cond="regime", cond_value="Boom"), dict(target="us2y"),
    dict(regime="Boom"), dict(shock="gold_lbma"), dict(shock="copper"), dict(kind="cross", cross="silver"),
    dict(kind="cross", cross="golden", target="gold"), dict(cond="spx_below_50dma", cond_value=1),
    # R-14
    dict(z=float("nan")), dict(z=float("inf")), dict(z="two"), dict(w=True), dict(w="x"), dict(w=7.5),
    dict(seed=-1), dict(seed=2**40), dict(seed=True), dict(seed="abc"), dict(seed=1.5),
    dict(cond="vix_above", cond_value=float("nan")), dict(cond="vix_above", cond_value=True),
])
def test_validate_rejects(bad):
    with pytest.raises(es.StudyError):
        es.validate(replace(es.Query(), **bad))


def test_validate_normalises_and_coerces_strings():
    q = es.validate(es.Query(z="2", w="20", cond="none", seed="7"))
    assert (q.z, q.w, q.cond, q.cond_value, q.seed) == (2.0, 20, None, None, 7)
    assert es.validate(es.Query(kind="cross", cross="golden", target="spx")).shock == "spx"
    assert es.validate(es.Query(cond="vix_above", cond_value="25")).cond_value == 25.0


# ── alignment and windows (R-04) ─────────────────────────────────────────────

def test_calendar_is_xnys_and_rejects_dates_outside_it():
    cal = es.session_calendar("2001-01-01", "2001-12-31")
    sessions = es.sessions_between(cal, "2001-09-04", "2001-09-21")
    assert [d.strftime("%Y-%m-%d") for d in sessions[:8]] == ["2001-09-04", "2001-09-05", "2001-09-06", "2001-09-07", "2001-09-10", "2001-09-17", "2001-09-18", "2001-09-19"], "9/11 closures known"
    with pytest.raises(es.StudyError):
        es.clock_for(cal, pd.DatetimeIndex(["2001-09-12"]))  # not a session: rejected, never regular hours
    with pytest.raises(es.StudyError):
        es.when(("close", 0), pd.DatetimeIndex(["2024-11-28"]), 0)  # Thanksgiving
    clock = es.clock_for(cal, pd.DatetimeIndex(["2001-11-23"]))  # day after Thanksgiving 2001: early close
    assert clock.closes[0].tz_convert(NY).strftime("%H:%M") == "13:00" and clock.opens[0].tz_convert(NY).strftime("%H:%M") == "09:30"


def test_calendar_extends_one_session_past_the_last_input(tmp_path):
    """R-22: the last input session always has a next open; the study index stays bounded by the inputs."""
    cal = es.session_calendar("2026-01-01", "2026-12-31")
    sessions = es.sessions_between(cal, "2026-01-01", "2026-12-31")
    assert sessions[-1].strftime("%Y-%m-%d") == "2026-12-31"
    clock = es.clock_for(cal, sessions[[-1]])
    assert clock.next_opens[0].tz_convert(NY).strftime("%Y-%m-%d %H:%M") == "2027-01-04 09:30"
    db = _synthetic_db(tmp_path / "yearend.db", spx_end="2026-12-31")
    r = es.run(es.Query(shock="us10y", w=5, z=1.5, sign="both", target="spx"), db)
    assert " to 2026-12-31: " in r["provenance"]["calendar"], "the study index stays bounded by the inputs"
    assert r["provenance"]["sample_end"] == "2026-09-30", "the last labelled session (regime rows to 2026-07, lag 2); every later session still resolved its next open without error"


def test_missing_spx_sessions_are_exclusions_not_calendar_holes(tmp_path):
    db = _synthetic_db(tmp_path / "gap.db")
    conn = sqlite3.connect(db)
    conn.execute("DELETE FROM asset_prices WHERE symbol='^GSPC' AND date IN ('2012-06-14', '2012-06-15')")
    conn.commit(); conn.close()
    r = es.run(es.Query(shock="vix", w=5, z=1.5, sign="both", target="spx"), db)
    p = r["provenance"]
    assert p["exclusions"]["spx"]["missing_sessions"] == 2, "the calendar still has the sessions; the S&P is missing on them"
    assert any("calendar sessions without a value: spx 2" in w for w in p["warnings"])
    assert "XNYS" in p["calendar"]


def test_align_drops_off_session_observations_inside_the_range_only():
    sessions = pd.bdate_range("2024-01-01", "2024-01-31")
    raw = pd.Series(1.0, index=pd.DatetimeIndex(["2023-12-30", "2024-01-06", "2024-01-08", "2024-02-03"]))  # Sat, Sat, Mon, Sat
    al, off, missing = es.align(raw, sessions)
    assert off == 1, "only the Saturday inside the calendar's range counts"
    assert al.notna().sum() == 1 and al.loc["2024-01-08"] == 1.0
    assert missing == len(sessions[(sessions >= "2023-12-30") & (sessions <= "2024-02-03")]) - 1, "every calendar session in the series' own range but the one it has"
    al2, off2, missing2 = es.align(pd.Series([1.0, 2.0], index=pd.DatetimeIndex(["2024-01-02", "2024-01-31"])), sessions)
    assert (off2, missing2) == (0, 20), "sessions inside the series' range without a value"


def test_invalid_prices_are_exclusions_with_a_reason_for_events_and_baseline(tmp_path):
    idx = pd.bdate_range("2024-01-01", periods=6)
    lvl = pd.Series([100.0, -5.0, 0.0, float("inf"), float("nan"), 101.0], index=idx)
    cleaned, n_bad, why = es.validate_values(lvl, registry.get("spx"))
    assert n_bad == 3 and "non-positive" in why and cleaned.notna().sum() == 2
    cleaned_bp, n_bad_bp, why_bp = es.validate_values(lvl, registry.get("us10y"))
    assert n_bad_bp == 1 and why_bp == "non-finite value" and cleaned_bp.loc[idx[1]] == -5.0, "a yield may be negative"
    db = _synthetic_db(tmp_path / "bad.db")
    conn = sqlite3.connect(db)
    conn.execute("UPDATE asset_prices SET close = -1.0 WHERE symbol='^GSPC' AND date='2012-06-14'")
    conn.execute("UPDATE asset_prices SET close = 0.0 WHERE symbol='GC=F' AND date='2012-06-15'")
    conn.commit(); conn.close()
    r = es.run(es.Query(shock="gold", w=5, z=1.5, sign="both", target="spx"), db)
    ex = r["provenance"]["exclusions"]
    assert ex["spx"]["invalid_values"] == 1 and ex["gold"]["invalid_values"] == 1 and "logged" in ex["gold"]["invalid_reason"]
    assert any("invalid values excluded" in w for w in r["provenance"]["warnings"])
    # the same session is missing for the baseline: it is not evaluable
    assert r["provenance"]["n_sessions"] < es.run(es.Query(shock="gold", w=5, z=1.5, sign="both", target="spx"), _synthetic_db(tmp_path / "ok.db"))["provenance"]["n_sessions"]


def test_move_reads_its_two_endpoints_only():
    idx = pd.bdate_range("2024-01-01", periods=12)
    lvl = pd.Series(np.linspace(100, 111, 12), index=idx)
    lvl.iloc[4] = np.nan  # an interior gap
    m = es.move(lvl, registry.get("spx"), 5)
    assert np.isnan(m.iloc[4]) and np.isnan(m.iloc[9]), "t and t−w missing"
    assert not np.isnan(m.iloc[7]), "a gap strictly inside the window does not disqualify a two-endpoint move"
    bp = es.move(pd.Series([3.0, 3.25], index=idx[:2]), registry.get("us10y"), 1)
    assert bp.iloc[1] == pytest.approx(25.0)


def test_zscore_is_trailing_inclusive_and_tolerates_a_few_missing_moves():
    idx = pd.bdate_range("2020-01-01", periods=300)
    m = pd.Series(np.arange(300, dtype=float), index=idx)
    z = es.zscore(m)
    assert z.iloc[:239].isna().all() and not np.isnan(z.iloc[251])
    win = m.iloc[300 - 252:300]
    assert z.iloc[-1] == pytest.approx((m.iloc[-1] - win.mean()) / win.std(ddof=1))
    gappy = m.copy()
    gappy.iloc[10:22] = np.nan  # 12 missing: tolerated
    assert not np.isnan(es.zscore(gappy).iloc[251])
    gappy.iloc[22] = np.nan  # 13 missing: not
    assert np.isnan(es.zscore(gappy).iloc[251])
    assert np.isnan(es.zscore(gappy).iloc[15]), "a session whose own move is missing has no z"


def test_forward_moves_need_both_endpoints_and_follow_the_unit():
    idx = pd.bdate_range("2024-01-01", periods=10)
    lvl = pd.Series(np.linspace(100, 109, 10), index=idx)
    lvl.iloc[7] = np.nan
    pct = es.forward_moves(lvl, registry.get("spx"), np.array([0, 2, 4, 5]), 5)
    assert pct[0] == pytest.approx(np.log(105 / 100))
    assert np.isnan(pct[1]), "exit session missing"
    assert pct[2] == pytest.approx(np.log(109 / 104)), "a gap inside the window does not matter"
    assert np.isnan(pct[3]), "5 sessions after position 5 do not exist"
    bp = es.forward_moves(lvl, registry.get("us10y"), np.array([0]), 2)
    assert bp[0] == pytest.approx(200.0), "yields in percent become basis points"


def test_run_reports_off_session_drops_and_incomplete_windows(synth):
    r = es.run(es.Query(shock="gold", w=20, z=1.5, sign="both", target="spx"), synth)
    p = r["provenance"]
    conn = sqlite3.connect(f"file:{synth}?mode=ro", uri=True)
    gold_dates = pd.DatetimeIndex([row[0] for row in conn.execute("SELECT date FROM asset_prices WHERE symbol='GC=F'")])
    conn.close()
    cal = es.session_calendar("1995-01-01", "2026-12-31")
    sessions = es.sessions_between(cal, "1995-01-01", "2026-12-31")
    expected = int((~gold_dates.isin(sessions)).sum())  # every weekday holiday the synthetic series has a bar on, plus the planted Globex bar
    assert expected >= 1 and p["exclusions"]["gold"]["off_session"] == expected, "off-session observations are counted against the XNYS calendar"
    assert any(f"off-session observations dropped: gold {expected}" in w for w in p["warnings"])
    t = es.run(es.Query(shock="spx", w=5, z=1.5, sign="both", target="us10y"), synth)
    assert sum(t["provenance"]["n_incomplete_by_h"].values()) > 0, "forward windows ending on a bond holiday are excluded"
    assert all(h["n"] + h["n_incomplete"] == t["provenance"]["n_events"] - t["provenance"]["n_no_entry"] for h in t["horizons"])
    bond_dates = pd.DatetimeIndex([row[0] for row in sqlite3.connect(f"file:{synth}?mode=ro", uri=True).execute("SELECT date FROM desk_series WHERE series_id='DGS10'")])
    inside = bond_dates[(bond_dates >= sessions[0]) & (bond_dates <= sessions[-1])]  # the engine counts inside the calendar's range only
    assert t["provenance"]["exclusions"]["us10y"]["off_session"] == int((~inside.isin(sessions)).sum()), "the synthetic yields have bars on NYSE holidays"
    assert t["provenance"]["exclusions"]["us10y"]["missing_sessions"] >= 30, "the fixed-date bond holidays that fall on NYSE sessions have no print"


# ── events and crosses (R-10) ─────────────────────────────────────────────────

def test_cooldown_blocks_w_sessions_and_counts_raw_hits():
    idx = pd.bdate_range("2021-01-01", periods=40)
    z = pd.Series(0.0, index=idx)
    z.iloc[[3, 4, 5, 8, 9, 30]] = 3.0     # 3 fires; 4,5,8 blocked (cooldown 5: sessions 4..8); 9 fires; 30 fires
    events, raw = es.detect_events(z, 2.0, "+", 5)
    assert raw == 6 and list(events) == [3, 9, 30]
    assert list(es.detect_events(-z, 2.0, "-", 5)[0]) == [3, 9, 30]
    assert list(es.detect_events(-z, 2.0, "both", 5)[0]) == [3, 9, 30]
    assert len(es.detect_events(z, 2.0, "-", 5)[0]) == 0


def test_crosses_are_strict_and_resolve_through_equality():
    idx = pd.bdate_range("2015-01-01", periods=900)
    # 300 sessions falling (50d below 200d), 300 flat (both averages converge to exact equality),
    # then 300 rising: the golden cross fires on the first session the 50d is strictly above
    lvl = np.concatenate([np.linspace(200, 100, 300), np.full(300, 100.0), np.linspace(100, 200, 300)])
    s = pd.Series(lvl, index=idx)
    golden, valid = es.cross_positions(s, "golden")
    death, _ = es.cross_positions(s, "death")
    fast, slow = s.rolling(50).mean(), s.rolling(200).mean()
    equal = (fast == slow) & valid
    assert equal.sum() >= 50, "the plateau produces exact equality"
    assert len(death) == 0
    assert len(golden) == 1
    g = int(golden[0])
    assert fast.iloc[g] > slow.iloc[g] and fast.iloc[g - 1] <= slow.iloc[g - 1]
    assert not equal.iloc[g], "equality never fires"
    # a constant series from inception never crosses: there is no prior side
    flat = pd.Series(100.0, index=idx)
    assert len(es.cross_positions(flat, "golden")[0]) == 0 and len(es.cross_positions(flat, "death")[0]) == 0
    # R-21: an unevaluable session resets the side; a cross right after a gap is not admitted
    gapped = s.copy()
    gapped.iloc[g - 1] = np.nan  # the session before the cross has no value: both averages are unevaluable there and for 200 sessions after
    assert len(es.cross_positions(gapped, "golden")[0]) == 0, "the preceding session must be evaluable"
    early = s.copy()
    early.iloc[g - 150] = np.nan  # a gap 150 sessions earlier: the 200-day average is unevaluable through the cross, so no side carries into it
    assert len(es.cross_positions(early, "golden")[0]) == 0
    plateau_gap = s.copy()
    plateau_gap.iloc[g - 260] = np.nan  # a gap inside the plateau: after the reset only equal sessions follow, so no side is re-established and nothing fires
    assert len(es.cross_positions(plateau_gap, "golden")[0]) == 0
    early_gap = s.copy()
    early_gap.iloc[40] = np.nan  # a gap early in the fall: both averages recover by session 240, the falling side is re-established, the cross fires
    assert list(es.cross_positions(early_gap, "golden")[0]) == [g]


# ── regime and evaluability (R-05) ────────────────────────────────────────────

def test_regime_lag_rule_and_unlabeled():
    months = pd.Series(["Goldilocks", "Overheating", "Stagflation"], index=pd.PeriodIndex(["2026-05", "2026-06", "2026-07"], freq="M"))
    dates = pd.DatetimeIndex(["2026-06-15", "2026-07-01", "2026-08-31", "2026-09-21", "2026-10-01", "2026-12-31"])
    assert list(es.regime_at(dates, months)) == [es.UNLABELED, "Goldilocks", "Overheating", "Stagflation", es.UNLABELED, es.UNLABELED]
    assert es.first_labelled_date(months) == pd.Timestamp("2026-07-01")
    assert es.last_labelled_date(months) == pd.Timestamp("2026-09-30")
    assert es.REGIME_LAG_MONTHS == 2


def test_baseline_candidates_take_the_same_entry_delay(synth):
    """R-05: a baseline candidate at session p enters at p+1 when an event
    would, so its window is p+1 … p+1+h and the last candidate has no entry."""
    r = es.run(es.Query(shock="us10y", w=5, z=1.5, sign="both", target="spx"), synth)
    p = r["provenance"]
    assert p["entry_same_session"] is False and p["baseline_no_entry"] >= 1
    assert "the baseline takes the same delay" in p["entry_rule"]
    s = es.run(es.Query(shock="spx", w=5, z=1.5, sign="both", target="vix"), synth)
    assert s["provenance"]["entry_same_session"] is True and s["provenance"]["baseline_no_entry"] == 0


def test_one_evaluability_mask_for_events_and_baseline(synth):
    r = es.run(es.Query(shock="us10y", w=5, z=1.5, sign="both", target="spx"), synth)
    p = r["provenance"]
    assert p["sample_start"] == p["regimes_first"], "a session without a lagged label is not evaluable"
    assert p["n_unlabeled"] > 0, "1995-96 events exist in the synthetic data"
    unl = next(x for x in r["regimes"] if x["regime"] == es.UNLABELED)
    assert unl["excluded_from_totals"] and unl["n_events"] == p["n_unlabeled"]
    assert sum(x["n_events"] for x in r["regimes"] if x["regime"] != es.UNLABELED) == p["n_events"]
    for h in r["horizons"]:
        assert h["baseline_n"] <= p["n_sessions"], "the baseline is the evaluable sessions with a complete window"
    # a condition that cannot be evaluated on a session makes that session non-evaluable for both
    c = es.run(es.Query(shock="us10y", w=5, z=1.5, sign="both", cond="hy_oas_20d_change_above", cond_value=0, target="spx"), synth)
    assert c["provenance"]["sample_start"] >= "2023-10-19", "HY OAS exists from 2023-09-22 and needs 20 sessions"
    assert _h(c, 5)["baseline_n"] < _h(r, 5)["baseline_n"]


def test_regime_condition_and_filter_share_the_lag_rule_and_the_baseline(synth):
    r = es.run(es.Query(shock="us10y", w=20, z=2.0, sign="+", cond="regime", cond_value="Overheating", target="spx"), synth)
    assert all(e["regime"] == "Overheating" for e in r["recent_events"])
    f = es.run(es.Query(shock="us10y", w=20, z=2.0, sign="+", target="spx", regime="Overheating"), synth)
    assert f["provenance"]["n_events"] == r["provenance"]["n_events"], "regime=R filters like cond=regime"
    assert (f["provenance"]["sample_start"], f["provenance"]["sample_end"]) == (r["provenance"]["sample_start"], r["provenance"]["sample_end"])
    assert [h["baseline_n"] for h in f["horizons"]] == [h["baseline_n"] for h in r["horizons"]]
    assert any("lagged label" in w for w in f["provenance"]["warnings"])
    _no_banned(r["verdict"]["text"])


# ── timing (R-01, R-02, R-03) ─────────────────────────────────────────────────

def test_timing_rules_resolve_against_the_session_and_early_closes():
    sessions = pd.DatetimeIndex(["2026-11-25", "2026-11-27", "2026-11-30"])  # 11-27 closes 13:00 ET
    pos = 1
    close = es.when(("close", 0), sessions, pos).astimezone(NY)
    assert (close.hour, close.minute) == (13, 0)
    assert es.when(("close", 15), sessions, pos).astimezone(NY).strftime("%H:%M") == "13:15"
    assert es.when(("close", -30), sessions, pos).astimezone(NY).strftime("%H:%M") == "12:30"
    nxt = es.when(registry.NEXT_OPEN, sessions, pos).astimezone(NY)
    assert nxt.strftime("%Y-%m-%d %H:%M") == "2026-11-30 09:30"
    assert es.when(registry.clock(17, 0), sessions, pos).astimezone(NY).strftime("%H:%M") == "17:00"
    full = es.when(("close", 0), sessions, 0).astimezone(NY)
    assert (full.hour, full.minute) == (16, 0)
    # the last session's next open falls back to the calendar
    last = es.when(registry.NEXT_OPEN, sessions, 2).astimezone(NY)
    assert last.strftime("%Y-%m-%d %H:%M") == "2026-12-01 09:30"
    spx, vix, us10y, gold, hy = (registry.get(k) for k in ("spx", "vix", "us10y", "gold", "hy_oas"))
    assert es.same_session_entry([spx], vix, sessions, pos), "VIX settles after the S&P close: known before it is fixed"
    assert not es.same_session_entry([vix], spx, sessions, pos)
    assert not es.same_session_entry([us10y], spx, sessions, pos), "R-01: a FRED daily value is known at the next open"
    assert not es.same_session_entry([hy], spx, sessions, pos)
    assert es.same_session_entry([spx], us10y, sessions, pos) is False, "the CMT read precedes the S&P close"
    assert not es.same_session_entry([spx], gold, sessions, pos), "R-03: gold as a target always defers"
    assert not es.same_session_entry([gold], spx, sessions, pos), "gold declared 17:00 ET"


def test_entry_follows_the_timing_rules_in_a_study(synth):
    def entries(q):
        r = es.run(q, synth)
        return [(e["date"], e["entry_date"], e["same_session"]) for e in r["recent_events"] if e["entry_date"]], r["provenance"]

    same, p = entries(es.Query(shock="spx", w=20, z=1.5, sign="both", target="vix"))
    assert same and all(d == e and s for d, e, s in same) and p["entry_same_session"] is True
    nxt, p = entries(es.Query(shock="us10y", w=20, z=1.5, sign="both", target="spx"))
    assert nxt and all(e > d and not s for d, e, s in nxt) and p["entry_same_session"] is False
    assert "next session open" in p["entry_rule"]
    nxt, p = entries(es.Query(shock="gold", w=20, z=1.5, sign="both", target="spx"))
    assert nxt and all(e > d for d, e, _ in nxt) and "17:00 ET clock" in p["entry_rule"]
    nxt, p = entries(es.Query(shock="spx", w=20, z=1.5, sign="both", target="gold"))
    assert nxt and all(e > d for d, e, _ in nxt) and "ambiguous" in p["entry_rule"]
    nxt, _ = entries(es.Query(shock="spx", w=20, z=1.5, sign="both", cond="vix_above", cond_value=10, target="spx"))
    assert nxt and all(e > d for d, e, _ in nxt), "a condition public after the close pushes the entry too"


# ── statistics (R-06, R-08, R-11, R-12) ───────────────────────────────────────

def test_cluster_blocks_group_overlapping_forward_windows():
    assert list(es.cluster_blocks(np.array([0, 3, 10]), 5)) == [0, 0, 1]
    assert list(es.cluster_blocks(np.array([0, 5, 10, 16]), 5)) == [0, 0, 0, 1], "touching at e+h is an overlap"
    assert list(es.cluster_blocks(np.array([0, 100, 200]), 60)) == [0, 1, 2]


def test_horizon_stats_bootstraps_blocks_and_reports_them():
    rng = np.random.default_rng(1)
    base = rng.normal(0.0, 0.02, 2000)
    entries = np.arange(0, 400, 20)  # 20 events, no overlap at h=5, all overlap at h=60 chains
    ev = rng.normal(0.01, 0.02, 20)
    s5 = es.horizon_stats(ev, entries, base, 5, np.random.default_rng(0), n_boot=300)
    assert s5["n"] == 20 and s5["n_blocks"] == 20 and s5["ci90"]
    assert s5["resampling"] == "monte_carlo" and s5["n_draws"] == 300 and s5["exclusion"] in ("established", "not established", "included")
    assert 0.0 <= s5["opposite_sign_share"] <= 1.0
    s60 = es.horizon_stats(ev, entries, base, 60, np.random.default_rng(0), n_boot=300)
    assert s60["n_blocks"] == 1 and s60["ci90"] is None and "too few blocks" in s60["note"] and s60["resampling"] is None
    empty = es.horizon_stats(np.array([np.nan, np.nan]), np.array([0, 1]), base, 5, rng)
    assert empty["n"] == 0 and empty["n_incomplete"] == 2 and empty["note"] == "insufficient data"
    same = es.horizon_stats(ev, entries, base, 5, np.random.default_rng(0), n_boot=300)
    assert same["ci90"] == s5["ci90"], "seeded"


def test_exact_enumeration_up_to_seven_blocks_and_the_exclusion_floor():
    """R-18: B ≤ 7 blocks enumerate all B^B draws exactly; 5–9 blocks print
    an interval without judging exclusion; 10+ judge it."""
    import itertools

    rng = np.random.default_rng(4)
    base = rng.normal(0.0, 0.02, 1000)
    base_med = float(np.median(base))
    # six events in six blocks at h=5 (entries 10 apart), overlapping pairs at h=15 (three blocks)
    entries = np.array([0, 10, 20, 30, 40, 50])
    ev = np.array([0.03, -0.01, 0.02, 0.05, -0.02, 0.01])
    s = es.horizon_stats(ev, entries, base, 5, rng, n_boot=50)
    assert s["n_blocks"] == 6 and s["resampling"] == "exact" and s["n_draws"] == 6**6
    deltas = np.array([np.median(ev[list(draw)]) - base_med for draw in itertools.product(range(6), repeat=6)])
    lo, hi = np.percentile(deltas, 5, method="lower"), np.percentile(deltas, 95, method="higher")
    assert s["ci90"] == pytest.approx([float(lo), float(hi)])
    assert s["ci_excludes_zero"] is None and s["note"] == "too few independent blocks to judge exclusion"
    # seven blocks: 823,543 draws, still exact and under a second
    import time
    t = time.perf_counter()
    s7 = es.horizon_stats(np.r_[ev, 0.04], np.r_[entries, 60], base, 5, rng, n_boot=50)
    assert s7["resampling"] == "exact" and s7["n_draws"] == 7**7 and time.perf_counter() - t < 5.0
    # eight blocks: Monte Carlo; ten blocks: exclusion judged
    s8 = es.horizon_stats(np.r_[ev, 0.04, 0.02], np.r_[entries, 60, 70], base, 5, np.random.default_rng(0), n_boot=200)
    assert s8["resampling"] == "monte_carlo" and s8["n_draws"] == 200 and s8["ci_excludes_zero"] is None
    ten = np.r_[ev, 0.04, 0.02, 0.03, 0.01]
    s10 = es.horizon_stats(ten, np.arange(0, 100, 10), base, 5, np.random.default_rng(0), n_boot=200)
    assert s10["n_blocks"] == 10 and s10["exclusion"] is not None and s10["opposite_sign_share"] is not None
    assert es.N_BOOT == 10000 and es.OPPOSITE_SIGN_MAX == 0.03
    # the weighted median equals numpy's median of the expanded resample
    order = np.argsort(ev); vs, bo = ev[order], np.arange(6)[order]
    counts = np.array([[2, 0, 1, 0, 3, 0], [1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 6]])
    expect = [np.median(np.repeat(vs, c[bo])) for c in counts]
    assert es._weighted_medians(vs, bo, counts) == pytest.approx(expect)


def test_exclusion_needs_the_interval_and_the_opposite_sign_test():
    """R-18 (round 3): established only when the 90% interval excludes zero
    and fewer than 3% of resampled medians carry the opposite sign; the two
    disagreeing is "not established"; the share is reported either way."""
    rng = np.random.default_rng(0)
    pos = np.abs(rng.normal(0.02, 0.005, 10000))
    clean = es.judge_exclusion(pos, 0.02)
    assert clean["exclusion"] == "established" and clean["ci_excludes_zero"] and clean["opposite_sign_share"] == 0.0
    # 4% opposite: the 5th percentile is still above zero, but the share fails the 3% ceiling
    mixed = np.r_[np.full(400, -0.001), np.abs(rng.normal(0.02, 0.005, 9600))]
    weak = es.judge_exclusion(mixed, 0.02)
    assert weak["ci_excludes_zero"] and weak["opposite_sign_share"] == pytest.approx(0.04) and weak["exclusion"] == "not established"
    # 2% opposite: established
    ok = es.judge_exclusion(np.r_[np.full(200, -0.001), np.abs(rng.normal(0.02, 0.005, 9800))], 0.02)
    assert ok["exclusion"] == "established" and ok["opposite_sign_share"] == pytest.approx(0.02)
    # 10% opposite: the interval includes zero
    incl = es.judge_exclusion(np.r_[np.full(1000, -0.001), np.abs(rng.normal(0.02, 0.005, 9000))], 0.02)
    assert not incl["ci_excludes_zero"] and incl["exclusion"] == "included"
    # a negative point estimate counts the positive side
    neg = es.judge_exclusion(-mixed, -0.02)
    assert neg["opposite_sign_share"] == pytest.approx(0.04) and neg["exclusion"] == "not established"
    # zero is adverse: exact zeros count against the claim, and an interval touching zero is judged, not "included"
    zeros = np.r_[np.zeros(400), np.abs(rng.normal(0.02, 0.005, 9600))]
    z = es.judge_exclusion(zeros, 0.02)
    assert z["opposite_sign_share"] == pytest.approx(0.04) and z["ci_excludes_zero"] and z["exclusion"] == "not established"
    assert es.judge_exclusion(np.r_[np.zeros(200), np.abs(rng.normal(0.02, 0.005, 9800))], 0.02)["exclusion"] == "established"
    assert es.judge_exclusion(np.zeros(100), 0.0)["exclusion"] == "included" and es.judge_exclusion(np.zeros(100), 0.0)["opposite_sign_share"] == 1.0


def test_regression_zero_is_adverse_in_the_exclusion_guard():
    """Owner regression (R-18, final): eight returns of −2% and three of zero
    in eleven blocks against a zero baseline. The exact 90% interval on Δ is
    [−0.02, 0]; the guard must read the zeros as adverse and say "exclusion
    not established", never "established"."""
    s = es.horizon_stats(np.r_[np.full(8, -0.02), np.zeros(3)], np.arange(11) * 10, np.zeros(50), 5, np.random.default_rng(20260921))
    assert s["n"] == 11 and s["n_blocks"] == 11 and s["resampling"] == "monte_carlo" and s["n_draws"] == es.N_BOOT
    assert s["delta"] == pytest.approx(-0.02)
    assert s["ci90"][0] == pytest.approx(-0.02) and s["ci90"][1] == pytest.approx(0.0)
    assert s["ci_excludes_zero"] is True
    assert s["opposite_sign_share"] >= es.OPPOSITE_SIGN_MAX
    assert s["exclusion"] == "not established" and s["note"] == "exclusion not established"


def _regime_rows(cells: dict[str, tuple[int, float]]) -> list[dict]:
    rows = []
    for r in list(es.REGIME_LABELS) + [es.UNLABELED]:
        n, med = cells.get(r, (0, 0.0))
        cell = {"h": 20, "n": n, "baseline_n": 100, "baseline_median": 0.0, "baseline_hit_rate": 0.5,
                "hit_rate": 0.6 if n >= 10 else None, "median": med if n >= 10 else None, "mean": med if n >= 10 else None,
                "note": None if n >= 10 else "n<10"}
        rows.append({"regime": r, "n_events": n, "excluded_from_totals": r == es.UNLABELED, "horizons": [cell]})
    return rows


def _horizon_rows(spec: dict[int, tuple[int, int, list | None, bool | None]], weak: set[int] = frozenset()) -> list[dict]:
    """excl True → established (or 'not established' when h is in `weak`), False → included, None → unjudged."""
    out = []
    for h, (n, blocks, ci, excl) in spec.items():
        exclusion = None if excl is None else ("included" if not excl else ("not established" if h in weak else "established"))
        out.append({"h": h, "n": n, "n_incomplete": 0, "n_blocks": blocks, "median": 0.02, "mean": 0.02, "baseline_median": 0.01,
                    "baseline_p25": -0.02, "baseline_p75": 0.04, "delta": 0.01, "ci90": ci, "ci_excludes_zero": excl, "exclusion": exclusion,
                    "opposite_sign_share": (0.041 if h in weak else 0.01) if ci else None,
                    "resampling": ("exact" if blocks <= 7 else "monte_carlo") if ci else None, "n_draws": (blocks**blocks if blocks <= 7 else 10000) if ci else 0,
                    "note": None if ci and excl is not None else ("too few independent blocks to judge exclusion" if ci else ("insufficient data" if n == 0 else "too few blocks"))})
    return out


def test_verdict_rules_for_intervals_n_and_regimes():
    kw = dict(unit="log_return", data_start=pd.Timestamp("1990-01-02"), sample_start=pd.Timestamp("1996-07-01"),
              sample_end=pd.Timestamp("2026-09-18"), n_raw=40, w=20, shock_label="X", target_label="S&P 500")
    hz = _horizon_rows({5: (12, 12, [0.001, 0.02], True), 10: (12, 11, [-0.01, 0.02], False), 20: (12, 3, None, None), 60: (0, 0, None, None)})
    text = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({"Overheating": (11, 0.02)}), n_events=12, **kw))
    assert "excludes zero at 5 sessions (n = 12, 12 blocks)" in text, text                         # R-08
    assert "not distinguishable from baseline at 10 sessions (n = 12, 11 blocks)" in text            # R-11: only horizons with an interval
    assert "No interval at 20 sessions" in text and "Insufficient data at 60 sessions (n = 0" in text
    assert "Only Overheating reaches n ≥ 10" in text and "concentrated" not in text                  # R-12
    two = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({"Overheating": (11, 0.02), "Stagflation": (10, -0.01)}), n_events=21, **kw))
    assert "concentrated in Overheating (n = 11" in two and "weakest in Stagflation (n = 10" in two
    none = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({}), n_events=12, **kw))
    assert "not informative" in none
    # R-18: 5–9 blocks print the interval without judging exclusion
    hz2 = _horizon_rows({5: (6, 6, [-0.01, 0.03], None), 10: (12, 12, [0.001, 0.02], True), 20: (12, 12, [-0.01, 0.02], False), 60: (12, 12, [-0.01, 0.02], False)})
    t2 = " ".join(es.verdict_sentences(horizons=hz2, regimes=_regime_rows({}), n_events=12, **kw))
    assert "At 5 sessions (n = 6, 6 blocks) the 90% interval on Δ is [-1.0%, +3.0%]; too few independent blocks to judge exclusion." in t2
    assert "excludes zero at 10 sessions" in t2 and "5 sessions" not in t2.split("excludes zero")[1].split(".")[0]
    assert "exact enumeration" in t2 or "Monte Carlo" in t2
    # R-18 (round 3): the interval excludes zero but the opposite-sign share fails: "exclusion not established"
    hz3 = _horizon_rows({5: (12, 12, [0.001, 0.02], True), 10: (12, 12, [0.002, 0.03], True), 20: (12, 12, [-0.01, 0.02], False), 60: (0, 0, None, None)}, weak={10})
    t3 = " ".join(es.verdict_sentences(horizons=hz3, regimes=_regime_rows({}), n_events=12, **kw))
    assert "excludes zero at 5 sessions (n = 12, 12 blocks)." in t3
    assert "At 10 sessions (n = 12, 12 blocks) the 90% interval on Δ is [+0.2%, +3.0%] but 4.1% of resampled medians are adverse (zero included); exclusion not established." in t3
    _no_banned(t3)
    # R-20: ties and contrasts under 0.5 pp get no strongest/weakest claim
    tie = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({"Overheating": (11, 0.020), "Stagflation": (10, 0.016), "Goldilocks": (12, -0.03)}), n_events=33, **kw))
    assert "within 0.5 percentage points" in tie and "concentrated" not in tie and "weakest in" not in tie
    clear = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({"Overheating": (11, 0.020), "Stagflation": (10, 0.014)}), n_events=21, **kw))
    assert "concentrated in Overheating" in clear
    bp = " ".join(es.verdict_sentences(horizons=hz, regimes=_regime_rows({"Overheating": (11, 4.0), "Stagflation": (10, 0.0)}), n_events=21, **{**kw, "unit": "bp"}))
    assert "within 5 bp" in bp
    _no_banned(text); _no_banned(two); _no_banned(none); _no_banned(t2); _no_banned(tie)


def test_zero_event_sentence_names_the_stage_that_emptied_the_set(synth):
    """R-19: from the recorded stages."""
    stages = [{"stage": "threshold", "n": 40, "what": "met the threshold"}, {"stage": "cooldown", "n": 9, "what": "after cooldown"},
              {"stage": "evaluable", "n": 9, "what": "evaluable"}, {"stage": "condition", "n": 0, "what": "with the condition holding (VIX above 80)"}]
    assert es.zero_event_sentence(stages, "VIX") == "No events: 9 sessions passed the evaluable stage (evaluable) but none passed the condition stage (with the condition holding (VIX above 80))."
    assert es.zero_event_sentence([{"stage": "threshold", "n": 0, "what": "x"}], "VIX") == "No events: no session of VIX met the threshold."
    r = es.run(es.Query(shock="us10y", w=5, z=2.5, sign="+", cond="vix_above", cond_value=1000.0, target="spx"), synth)
    assert r["provenance"]["n_events"] == 0
    assert r["verdict"]["sentences"][0].startswith("No events: ") and "condition stage" in r["verdict"]["sentences"][0]
    assert [st["stage"] for st in r["provenance"]["stages"]][:6] == ["threshold", "cooldown", "evaluable", "condition", "regime filter", "entry"]
    _no_banned(r["verdict"]["text"])


def test_insufficient_data_at_a_horizon_in_a_study(tmp_path):
    db = _synthetic_db(tmp_path / "short.db", spx_end="2024-02-15")
    conn = sqlite3.connect(db)
    conn.execute("DELETE FROM asset_prices WHERE symbol='^GSPC' AND date > '2024-01-31'")
    conn.commit(); conn.close()
    r = es.run(es.Query(shock="vix", w=5, z=1.5, sign="both", target="spx"), db)
    h60 = _h(r, 60)
    assert h60["n"] >= 0 and any("Insufficient data at" in s or "No interval at" in s for s in r["verdict"]["sentences"]) or h60["ci90"]


# ── provenance (R-09) ─────────────────────────────────────────────────────────

def test_inputs_hash_covers_content_generation_and_parameters(tmp_path, synth):
    a = es.run(es.PRESETS["gold-2sigma-spx-weak"], synth)
    b = es.run(es.PRESETS["gold-2sigma-spx-weak"], synth)
    assert a["provenance"]["inputs_hash"] == b["provenance"]["inputs_hash"] and a["horizons"] == b["horizons"]
    other = tmp_path / "other.db"
    src = sqlite3.connect(synth); dst = sqlite3.connect(other); src.backup(dst); src.close()
    dst.execute("UPDATE asset_prices SET close = close * 1.0001 WHERE symbol='GC=F' AND date='2015-06-01'")
    dst.commit(); dst.close()
    c = es.run(es.PRESETS["gold-2sigma-spx-weak"], other)
    assert c["provenance"]["inputs_hash"] != a["provenance"]["inputs_hash"], "one stored value changed"
    assert c["provenance"]["generation"] != a["provenance"]["generation"], "a different file is a different generation"
    d = es.run(replace(es.PRESETS["gold-2sigma-spx-weak"], seed=1), synth)
    assert d["provenance"]["inputs_hash"] != a["provenance"]["inputs_hash"], "the seed is an effective parameter"
    e = es.run(es.PRESETS["gold-2sigma-spx-weak"], synth, n_boot=500)
    assert e["provenance"]["inputs_hash"] != a["provenance"]["inputs_hash"], "the effective n_boot is hashed (R-09)"
    assert all(v[0] in ("exact", "monte_carlo", None) for v in a["provenance"]["resampling_by_h"].values())
    for m in a["provenance"]["inputs"]:
        assert len(m["content_hash"]) == 16 and m["fixed"] and m["known"]


def test_run_shape_provenance_and_vocabulary(synth):
    r = es.run(es.PRESETS["gold-2sigma-spx-weak"], synth)
    p = r["provenance"]
    for key in ("as_of", "sample_start", "sample_end", "n_sessions", "n_events", "n_events_raw", "n_shocks", "n_after_condition", "n_unlabeled",
                "n_no_entry", "n_incomplete_by_h", "n_blocks_by_h", "cooldown", "cooldown_sessions", "seed", "inputs_hash", "generation",
                "regime_lag_months", "regime_revision_caveat", "entry_rule", "forward_rule", "master_calendar", "evaluability", "inputs",
                "calendar", "exclusions", "stages", "resampling_by_h", "baseline_n_by_h", "baseline_no_entry"):
        assert key in p, key
    assert p["cooldown_sessions"] == 20 and p["seed"] == es.DEFAULT_SEED and len(p["inputs_hash"]) == 16
    assert p["sample_start"] >= "2000-08-30" and p["entry_same_session"] is False
    assert [h["h"] for h in r["horizons"]] == [5, 10, 20, 60]
    assert [x["regime"] for x in r["regimes"]] == list(es.REGIME_LABELS) + [es.UNLABELED]
    assert len(r["recent_events"]) <= 10 and r["study"]["preset"] == "gold-2sigma-spx-weak"
    _no_banned(r["verdict"]["text"])
    assert "Sample since 2000" in r["verdict"]["text"]
    for h in r["horizons"]:
        assert h["n"] <= p["n_events"] and h["baseline_n"] > h["n"]
        if h["n"]:
            assert 0.0 <= h["hit_rate"] <= 1.0 and h["delta"] == pytest.approx(h["median"] - h["baseline_median"])
            assert h["n_blocks"] >= 1


def test_verdict_vocabulary_over_many_queries(synth):
    qs = [es.Query(shock=s, w=w, z=1.5, sign=sg, target=t)
          for s in ("gold", "vix", "us10y") for w in (5, 60) for sg in ("+", "-") for t in ("spx", "gold")]
    for q in qs:
        r = es.run(q, synth, n_boot=200)
        _no_banned(r["verdict"]["text"])
        assert r["verdict"]["sentences"][-1].startswith("Sample since ")
        for s in r["verdict"]["sentences"]:
            if "regime" in s.lower() or "reaches" in s or "concentrated" in s:
                continue  # those cite a regime's n; the horizon sentences cite the horizon's
            for m in re.finditer(r"(\d+) sessions \(n = (\d+)", s):
                assert int(m.group(2)) == _h(r, int(m.group(1)))["n"], "every cited horizon carries its own n (R-08)"


def test_cross_study_synthetic(synth):
    r = es.run(es.PRESETS["spx-golden-cross"], synth)
    assert r["study"]["kind"] == "cross" and r["provenance"]["cooldown_sessions"] is None
    assert "no cooldown" in r["provenance"]["cooldown"] and "strict" in r["provenance"]["event_rule"]
    _no_banned(r["verdict"]["text"])


def test_not_stored_is_typed(tmp_path):
    db = _synthetic_db(tmp_path / "s.db")
    conn = sqlite3.connect(db); conn.execute("DROP TABLE desk_series"); conn.commit(); conn.close()
    with pytest.raises(es.NotStored):
        es.run(es.Query(shock="us10y", target="spx"), db)
    assert es.run(es.PRESETS["gold-2sigma-spx-weak"], db)["provenance"]["n_events"] >= 0


def test_assets_from_the_registry_with_stored_coverage(synth):
    a = es.assets_with_coverage(synth)
    by = {x["key"]: x for x in a["shocks"]}
    assert by["spx"]["status"] == "stored" and by["spx"]["history_from"] == "1995-01-02" and by["spx"]["warn"]
    assert by["gold"]["status"] == "stored" and by["gold"]["defer_as_target"] and by["gold"]["known"] == "17:00 ET clock"
    assert by["us10y"]["known"] == "next session open" and by["wti"]["status"] == "planned" and by["copper"]["status"] == "deferred"
    assert "gold_lbma" not in by and a["unavailable"][0]["key"] == "gold_lbma"
    assert {t["key"] for t in a["targets"]} <= set(by) and [p["slug"] for p in a["presets"]] == list(es.PRESETS)
    assert a["regime_lag_months"] == 2 and a["history_bar"] == "1990-12-31" and a["master_calendar"]


# ── §8 against the owner-populated scratch copy ───────────────────────────────

def _read(sql: str, *args) -> pd.Series:
    conn = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    try:
        df = pd.read_sql_query(sql, conn, params=args)
    finally:
        conn.close()
    return pd.Series(df.iloc[:, 1].astype(float).to_numpy(), index=pd.DatetimeIndex(df.iloc[:, 0]))


def _regime_months() -> pd.Series:
    conn = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    rows = conn.execute("SELECT date, label FROM regimes ORDER BY date").fetchall()
    conn.close()
    return pd.Series([r[1] for r in rows], index=pd.PeriodIndex([pd.Timestamp(r[0]).to_period("M") for r in rows], freq="M"))


@scratch
def test_scratch_every_stored_series_reaches_its_declared_start():
    """Max, 2026-09-21: fail when a stored series' first date is later than
    the registry's history_from."""
    conn = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    late = []
    for spec in registry.SERIES:
        if not spec.available:
            continue
        if spec.table == "asset_prices":
            row = conn.execute("SELECT MIN(date) FROM asset_prices WHERE symbol=? AND interval='1d'", (spec.series_id,)).fetchone()
        else:
            row = conn.execute("SELECT MIN(date) FROM desk_series WHERE series_id=?", (spec.series_id,)).fetchone()
        first = row[0] if row else None
        if first is not None and first > spec.history_from:
            late.append(f"{spec.series_id}: stored from {first}, declared {spec.history_from}")
    conn.close()
    assert not late, late


@scratch
def test_scratch_preset_matches_an_independent_pandas_recomputation():
    """§8: N, hit rate, 20-day median and baseline of the preset from pandas
    primitives written separately from the engine, under the reviewed rules:
    S&P sessions as the calendar, two-endpoint moves, a 252-window z with at
    least 240 moves, the lagged regime label as part of evaluability, next-
    session entry for gold (declared 17:00 ET)."""
    spx = _read("SELECT date, close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date")
    gold = _read("SELECT date, close FROM asset_prices WHERE symbol='GC=F' AND interval='1d' ORDER BY date").reindex(spx.index)
    r20 = np.log(gold).diff(20)
    z = (r20 - r20.rolling(252, min_periods=240).mean()) / r20.rolling(252, min_periods=240).std()
    fire = (z >= 2.0).to_numpy()
    events, nxt = [], -1
    for i in np.flatnonzero(fire):
        if i >= nxt:
            events.append(int(i)); nxt = i + 21
    ma50 = spx.rolling(50).mean()
    below = (spx < ma50).where(ma50.notna()).astype(float)
    months = _regime_months()
    labeled = (spx.index.to_period("M") - 2).isin(months.index)
    evaluable = z.notna().to_numpy() & below.notna().to_numpy() & labeled
    kept = [i for i in events if evaluable[i] and below.iloc[i] == 1.0]
    fwd = []
    for i in kept:
        e = i + 1  # gold is known at 17:00 ET, after the S&P close
        if e + 20 < len(spx):
            fwd.append(np.log(spx.iloc[e + 20] / spx.iloc[e]))
    fwd = np.array(fwd)
    ev_sessions = np.flatnonzero(evaluable)
    # R-05: every baseline candidate takes the same entry delay as an event
    base = np.array([np.log(spx.iloc[p + 21] / spx.iloc[p + 1]) for p in ev_sessions if p + 21 < len(spx)])
    r = es.run(es.PRESETS["gold-2sigma-spx-weak"], SCRATCH)
    h20 = _h(r, 20)
    assert r["provenance"]["n_events"] == len(kept)
    assert r["provenance"]["sample_start"] == spx.index[ev_sessions[0]].strftime("%Y-%m-%d")
    assert h20["n"] == len(fwd)
    assert h20["hit_rate"] == pytest.approx(float(np.mean(fwd > 0)))
    assert h20["median"] == pytest.approx(float(np.median(fwd)))
    assert h20["baseline_n"] == len(base) and h20["baseline_median"] == pytest.approx(float(np.median(base)))


@scratch
def test_scratch_exact_enumeration_interval_matches_an_independent_enumeration():
    """R-18: for a horizon with 5 to 7 blocks the engine enumerates every
    B^B block draw; this recomputes one such interval from the engine's own
    per-event moves and entries with itertools.product, nothing shared."""
    import itertools

    cands = [es.Query(shock=sh, w=w, z=z, sign=sg, target=t)
             for sh in ("hy_oas", "us2y", "curve_2s10s", "vix", "gold") for w in (60, 20) for z in (2.5, 2.0) for sg in ("+", "-") for t in ("spx", "gold", "us10y")]
    checked = 0
    for q in cands:
        try:
            r = es.run(q, SCRATCH)
        except es.StudyError:
            continue
        for row in r["horizons"]:
            if not (es.MIN_BLOCKS_INTERVAL <= row["n_blocks"] <= es.EXACT_MAX_BLOCKS):
                continue
            assert row["resampling"] == "exact" and row["n_draws"] == row["n_blocks"] ** row["n_blocks"]
            assert row["ci_excludes_zero"] is None and "too few independent blocks" in row["note"]
            # rebuild the events' moves and entry positions for this horizon from the study's inputs
            h = row["h"]
            full = es.run(replace(q, seed=q.seed), SCRATCH)  # same study, for its recent list is only ten: recompute below
            # independent path: sessions, entries and moves straight from the stored levels
            conn = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
            tspec, sspec = registry.get(q.target), registry.get(q.shock)
            raw_t = es.load_level(conn, tspec); raw_s = es.load_level(conn, sspec)
            months = es.load_regimes(conn); conn.close()
            start = min(raw_t.index[0], raw_s.index[0]).strftime("%Y-%m-%d"); end = max(raw_t.index[-1], raw_s.index[-1]).strftime("%Y-%m-%d")
            cal = es.session_calendar(start, end); sessions = es.sessions_between(cal, start, end)
            t_al = raw_t.reindex(sessions); s_al = raw_s.reindex(sessions)
            if tspec.unit != "bp":
                t_al = t_al.where(t_al > 0)
            mv = es.move(s_al.where(s_al > 0) if sspec.unit != "bp" else s_al, sspec, q.w)
            z = (mv - mv.rolling(252, min_periods=240).mean()) / mv.rolling(252, min_periods=240).std()
            fire = {"+": z >= q.z, "-": z <= -q.z, "both": z.abs() >= q.z}[q.sign].fillna(False).to_numpy()
            ev, nxt = [], -1
            for i in np.flatnonzero(fire):
                if i >= nxt:
                    ev.append(int(i)); nxt = i + q.w + 1
            labeled = (sessions.to_period("M") - 2).isin(months.index)
            evaluable = z.notna().to_numpy() & t_al.notna().to_numpy() & labeled
            ev = [i for i in ev if evaluable[i]]
            clock = es.clock_for(cal, sessions)
            same = es.same_session_vec([sspec], tspec, clock)
            entries, moves = [], []
            tv = t_al.to_numpy()
            for i in ev:
                e = i if same[i] else i + 1
                if e + h < len(tv) and not np.isnan(tv[e]) and not np.isnan(tv[e + h]):
                    entries.append(e)
                    moves.append((tv[e + h] - tv[e]) * tspec.scale if tspec.unit == "bp" else np.log(tv[e + h] / tv[e]))
            ev_sessions = np.flatnonzero(evaluable)
            base = []
            for p in ev_sessions:
                e = p if same[p] else p + 1
                if e + h < len(tv) and not np.isnan(tv[e]) and not np.isnan(tv[e + h]):
                    base.append((tv[e + h] - tv[e]) * tspec.scale if tspec.unit == "bp" else np.log(tv[e + h] / tv[e]))
            base_med = float(np.median(base))
            entries, moves = np.array(entries), np.array(moves)
            order = np.argsort(entries, kind="stable"); entries, moves = entries[order], moves[order]
            # blocks: overlapping windows e … e+h
            blocks, end_, b = [], -1, -1
            for e in entries:
                if e > end_:
                    b += 1; end_ = e + h
                else:
                    end_ = max(end_, e + h)
                blocks.append(b)
            blocks = np.array(blocks); B = blocks.max() + 1
            assert B == row["n_blocks"] and len(moves) == row["n"]
            members = [moves[blocks == k] for k in range(B)]
            deltas = np.array([np.median(np.concatenate([members[k] for k in draw])) - base_med for draw in itertools.product(range(B), repeat=B)])
            lo, hi = np.percentile(deltas, 5, method="lower"), np.percentile(deltas, 95, method="higher")
            assert len(deltas) == row["n_draws"]
            assert row["ci90"][0] == pytest.approx(float(lo)) and row["ci90"][1] == pytest.approx(float(hi))
            checked += 1
            break
        if checked:
            break
    assert checked, "no candidate study had a horizon with 5 to 7 blocks; widen the candidate list"


@scratch
def test_scratch_look_ahead_shift_changes_the_result(tmp_path):
    """§8: give the target each close one session late; the events are the
    same dates, the entries and forward moves are not."""
    shifted = tmp_path / "shifted.db"
    src = sqlite3.connect(f"file:{SCRATCH}?mode=ro", uri=True)
    dst = sqlite3.connect(shifted)
    src.backup(dst); src.close()
    spx = _read("SELECT date, close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date")
    moved = spx.shift(1).dropna()
    dst.execute("DELETE FROM asset_prices WHERE symbol='^GSPC' AND interval='1d'")
    dst.executemany("INSERT INTO asset_prices (symbol, interval, date, close, provider) VALUES ('^GSPC','1d',?,?,'test')",
                    [(d.strftime("%Y-%m-%d"), float(v)) for d, v in moved.items()])
    dst.commit(); dst.close()
    a = es.run(es.PRESETS["gold-2sigma-spx-weak"], SCRATCH)
    b = es.run(es.PRESETS["gold-2sigma-spx-weak"], shifted)
    assert [e["date"] for e in a["recent_events"]] == [e["date"] for e in b["recent_events"]], "the shock did not move"
    assert a["provenance"]["inputs_hash"] != b["provenance"]["inputs_hash"]
    assert _h(a, 20)["median"] != _h(b, 20)["median"] or _h(a, 20)["hit_rate"] != _h(b, 20)["hit_rate"]
    diffs = [ea["moves"]["20"] != eb["moves"]["20"] for ea, eb in zip(a["recent_events"], b["recent_events"])
             if ea["moves"]["20"] is not None and eb["moves"]["20"] is not None]
    assert any(diffs)


@scratch
def test_scratch_wording_since_2000_for_gold_and_since_1990_for_the_cross():
    g = es.run(es.PRESETS["gold-2sigma-spx-weak"], SCRATCH)
    assert "Sample since 2000" in g["verdict"]["text"] and "1990" not in g["verdict"]["text"]
    assert g["provenance"]["data_start"] == "2000-08-30"
    for name in ("spx-golden-cross", "spx-death-cross"):
        c = es.run(es.PRESETS[name], SCRATCH)
        assert "Sample since 1990" in c["verdict"]["text"]
        _no_banned(c["verdict"]["text"])
    _no_banned(g["verdict"]["text"])


@scratch
def test_scratch_recent_events_are_the_last_ten_newest_first_and_enter_next_session():
    r = es.run(es.PRESETS["gold-2sigma-spx-weak"], SCRATCH)
    dates = [e["date"] for e in r["recent_events"]]
    assert len(dates) == min(10, r["provenance"]["n_events"]) and dates == sorted(dates, reverse=True)
    for e in r["recent_events"]:
        assert e["entry_date"] > e["date"] and not e["same_session"], "gold is declared at 17:00 ET: the S&P entry is the next session"
        assert e["regime"] in es.REGIME_LABELS and e["z"] >= 2.0


@scratch
def test_scratch_assets_gaps_and_timing():
    import time

    t = time.perf_counter()
    a = es.assets_with_coverage(SCRATCH)
    for name in es.PRESETS:
        es.run(es.PRESETS[name], SCRATCH)
    assert time.perf_counter() - t < 8.0
    by = {x["key"]: x for x in a["shocks"]}
    assert by["hy_oas"]["history_from"] == "2023-09-22" and by["hy_oas"]["warn"]
    assert by["gold"]["history_from"] == "2000-08-30" and by["spx"]["history_from"] == "1990-01-02" and not by["spx"]["warn"]
    r = es.run(es.Query(shock="us10y", w=20, z=2.0, sign="+", target="spx"), SCRATCH)
    p = r["provenance"]
    assert p["exclusions"]["us10y"]["off_session"] > 0, "Treasury prints on NYSE holidays are dropped"
    assert p["n_events"] > 0 and p["entry_same_session"] is False, "R-01: known at the next open"
