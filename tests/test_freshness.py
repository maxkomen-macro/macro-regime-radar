"""Source-aware freshness: the NYSE calendar, FRED publication rules, regime
blockers and per-feed verdicts (api/calendar.py + api/freshness.py)."""

from __future__ import annotations

from datetime import date, datetime, timezone

from api import calendar as cal
from api import freshness


def _utc(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


# ── calendar ────────────────────────────────────────────────────────────────


def test_labor_day_weekend_2026():
    sat = cal.session_state(_utc(2026, 9, 5, 22))
    assert sat["phase"] == "weekend" and sat["last_completed_session"] == "2026-09-04"
    assert sat["next_open_utc"] == "2026-09-08T13:30:00Z"  # Labor Day Monday skipped
    mon = cal.session_state(_utc(2026, 9, 7, 15))
    assert mon["phase"] == "holiday" and mon["is_open"] is False
    tue = cal.session_state(_utc(2026, 9, 8, 14))
    assert tue["phase"] == "open" and tue["is_open"] is True
    assert cal.session_state(_utc(2026, 9, 8, 21))["phase"] == "post"
    assert cal.session_state(_utc(2026, 9, 8, 12))["phase"] == "pre"


def test_early_close_and_holiday_tables():
    b = cal.session_bounds(date(2026, 11, 27))
    assert b is not None and b[1].strftime("%H:%M") == "18:00"  # 13:00 ET
    assert cal.session_bounds(date(2026, 12, 25)) is None
    assert cal.is_trading_day(date(2026, 7, 3)) is False  # Independence Day observed
    assert cal.previous_trading_day(date(2026, 9, 8)) == date(2026, 9, 4)
    assert cal.business_days_between(date(2026, 9, 1), date(2026, 9, 4)) == 3


def test_last_completed_session_intraday():
    # Mid-session the last completed session is still yesterday.
    assert cal.last_completed_session(_utc(2026, 9, 8, 15)) == date(2026, 9, 4)
    assert cal.last_completed_session(_utc(2026, 9, 8, 20, 30)) == date(2026, 9, 8)


# ── publication rules ───────────────────────────────────────────────────────


def test_expected_month_rules():
    assert freshness.expected_month("UNRATE", date(2026, 9, 5)) == date(2026, 8, 1)  # first Friday Sep 4 passed
    assert freshness.expected_month("UNRATE", date(2026, 9, 3)) == date(2026, 7, 1)
    assert freshness.expected_month("CPIAUCSL", date(2026, 9, 5)) == date(2026, 7, 1)
    assert freshness.expected_month("CPIAUCSL", date(2026, 9, 16)) == date(2026, 8, 1)
    assert freshness.expected_month("INDPRO", date(2026, 9, 16)) == date(2026, 7, 1)
    assert freshness.expected_month("INDPRO", date(2026, 9, 20)) == date(2026, 8, 1)


# ── assessment ──────────────────────────────────────────────────────────────

_BASE = {
    "regimes_date": "2026-07-01",
    "signals_date": "2026-07-01",
    "market_daily_date": "2026-09-04",
    "market_intraday_ts": "2026-09-04 15:55:00",
    "news_published_at": "2026-09-05 19:00:00",
    "raw_series_date": "2026-09-04",
}
_SERIES = [
    {"series_id": "INDPRO", "date": "2026-07-01", "value": 1.0},
    {"series_id": "CPIAUCSL", "date": "2026-07-01", "value": 1.0},
    {"series_id": "UNRATE", "date": "2026-08-01", "value": 1.0},
    {"series_id": "DGS10", "date": "2026-09-04", "value": 4.0},
    {"series_id": "DGS2", "date": "2026-09-04", "value": 3.5},
    {"series_id": "VIXCLS", "date": "2026-09-04", "value": 15.0},
]


def _by_feed(report):
    return {r["feed"]: r for r in report["sla"]}


def test_saturday_everything_current_and_regime_blocked_by_calendar():
    rep = freshness.assess(db_fresh=_BASE, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
    v = _by_feed(rep)
    assert v["market_daily"]["verdict"] == "current"
    assert v["market_intraday"]["verdict"] == "current"
    assert v["news"]["verdict"] == "current"  # off-hours 6 h window
    assert v["fred:DGS10"]["verdict"] == "current"
    assert v["regime"]["verdict"] == "current"
    assert rep["overall"] == "current"
    assert rep["regime"]["latest_month"] == "2026-07-01" and rep["regime"]["expected_month"] == "2026-07-01"
    causes = {b["series"]: b["cause"] for b in rep["regime"]["blockers"]}
    assert causes == {"INDPRO": "publication calendar", "CPIAUCSL": "publication calendar"}
    assert rep["session"]["phase"] == "weekend"


def test_mid_september_cpi_print_not_stored_is_named():
    rep = freshness.assess(db_fresh=_BASE, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 16, 15))
    causes = {b["series"]: b["cause"] for b in rep["regime"]["blockers"]}
    assert causes["CPIAUCSL"].startswith("print published but not stored")
    assert causes["INDPRO"] == "publication calendar"
    assert _by_feed(rep)["fred:CPIAUCSL"]["verdict"] == "delayed"
    assert _by_feed(rep)["regime"]["verdict"] == "current"  # Jul is still the expected common month


def test_late_september_regime_is_delayed_when_august_is_due():
    db = {**_BASE, "market_daily_date": "2026-09-18", "market_intraday_ts": "2026-09-18 15:55:00", "news_published_at": "2026-09-21 14:30:00"}
    series = [dict(s, date="2026-09-18") if s["series_id"] in ("DGS10", "DGS2", "VIXCLS") else s for s in _SERIES]
    rep = freshness.assess(db_fresh=db, series_latest=series, relay=None, bootstrap=None, now=_utc(2026, 9, 21, 15))
    assert _by_feed(rep)["regime"]["verdict"] == "delayed"
    assert rep["regime"]["expected_month"] == "2026-08-01"
    assert {b["series"] for b in rep["regime"]["blockers"]} == {"INDPRO", "CPIAUCSL"}
    assert rep["overall"] == "delayed"


def test_stale_daily_and_news_verdicts():
    db = {**_BASE, "market_daily_date": "2026-09-02", "news_published_at": "2026-09-04 10:00:00"}
    series = [dict(s, date="2026-08-25") if s["series_id"] == "DGS10" else s for s in _SERIES]
    rep = freshness.assess(db_fresh=db, series_latest=series, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
    v = _by_feed(rep)
    assert v["market_daily"]["verdict"] == "stale" and "2026-09-04" in v["market_daily"]["reason"]
    assert v["news"]["verdict"] == "stale"
    assert v["fred:DGS10"]["verdict"] == "stale"
    assert rep["overall"] == "stale"


def test_news_weekday_window_is_90_minutes():
    db = {**_BASE, "news_published_at": "2026-09-08 14:00:00"}
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 16, 0))
    assert _by_feed(rep)["news"]["verdict"] == "delayed"  # 2 h old on a weekday afternoon
    rep2 = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 15, 0))
    assert _by_feed(rep2)["news"]["verdict"] == "current"


def test_intraday_during_session():
    # Intraday stamps are Eastern wall time: 10:30 ET = 14:30 UTC on 2026-09-08.
    db = {**_BASE, "market_intraday_ts": "2026-09-08 10:30:00"}
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 14, 45))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "current"
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 15, 20))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "delayed"
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 17, 0))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "stale"


def test_intraday_closing_bar_is_current_after_the_close():
    db = {**_BASE, "market_intraday_ts": "2026-09-04 15:55:00"}  # last 5-minute bar of the session, ET
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "current"


def test_relay_rows():
    relay = {"token_configured": False, "feeds": {"us": "off", "vix": "off"}, "feed_stale": {}, "feed_last_frame_at": {}}
    rep = freshness.assess(db_fresh=_BASE, series_latest=_SERIES, relay=relay, bootstrap={"db_mtime": "x"}, now=_utc(2026, 9, 5, 22))
    v = _by_feed(rep)
    assert v["live_quotes"]["verdict"] == "unavailable" and "EODHD_API_TOKEN" in v["live_quotes"]["reason"]
    assert rep["bootstrap"] == {"db_mtime": "x"}
    relay = {"token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {"us": False}, "feed_last_frame_at": {"us": "2026-09-08T14:44:00Z", "vix": "2026-09-08T14:44:00Z"}}
    rep = freshness.assess(db_fresh=_BASE, series_latest=_SERIES, relay=relay, bootstrap=None, now=_utc(2026, 9, 8, 14, 45))
    v = _by_feed(rep)
    assert v["live_quotes"]["verdict"] == "current" and v["vix_delayed"]["verdict"] == "current"
    relay["feed_stale"] = {"us": True}
    rep = freshness.assess(db_fresh=_BASE, series_latest=_SERIES, relay=relay, bootstrap=None, now=_utc(2026, 9, 8, 14, 45))
    assert _by_feed(rep)["live_quotes"]["verdict"] == "stale"


def test_signals_years_behind_are_stale_not_delayed():
    db = {**_BASE, "signals_date": "2015-01-01"}
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
    assert _by_feed(rep)["signals"]["verdict"] == "stale"
    assert rep["overall"] == "stale"


def test_future_dated_rows_are_not_trusted():
    db = {k: ("2027-12-31" if v and len(str(v)) == 10 else v) for k, v in _BASE.items()}
    db["market_intraday_ts"] = "2027-12-31 15:55:00"
    db["news_published_at"] = "2027-12-31 10:00:00"
    series = [dict(s, date="2027-12-31") for s in _SERIES]
    rep = freshness.assess(db_fresh=db, series_latest=series, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
    verdicts = {r["feed"]: r["verdict"] for r in rep["sla"]}
    assert verdicts["market_daily"] == "unavailable" and verdicts["news"] == "unavailable" and verdicts["regime"] == "unavailable"
    assert rep["overall"] == "unavailable"


def test_intraday_opening_grace():
    # 09:35 ET on 2026-09-08 with yesterday's 15:55 closing bar: delayed, not stale.
    db = {**_BASE, "market_intraday_ts": "2026-09-04 15:55:00"}
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 13, 35))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "delayed"
    # After the grace period the same bar is stale.
    rep = freshness.assess(db_fresh=db, series_latest=_SERIES, relay=None, bootstrap=None, now=_utc(2026, 9, 8, 14, 30))
    assert _by_feed(rep)["market_intraday"]["verdict"] == "stale"


def test_daily_series_month_completeness_uses_business_days():
    # August 2026 ends on Monday the 31st; a series through Fri Aug 28 is not complete, through Aug 31 it is.
    def common(day):
        series = [dict(s, date=day) if s["series_id"] in ("DGS10", "DGS2", "VIXCLS") else s for s in _SERIES]
        rep = freshness.assess(db_fresh=_BASE, series_latest=series, relay=None, bootstrap=None, now=_utc(2026, 9, 5, 22))
        return rep["regime"]["common_feature_month"]
    assert common("2026-08-31") == "2026-07-01"  # bounded by the monthly inputs
    # May 2026 ends on Sunday the 31st: Friday the 29th completes the month.
    series = [dict(s, date="2026-05-29") if s["series_id"] in ("DGS10", "DGS2", "VIXCLS") else s for s in _SERIES]
    series = [dict(s, date="2026-05-01") if s["series_id"] in ("INDPRO", "CPIAUCSL", "UNRATE") else s for s in series]
    rep = freshness.assess(db_fresh={**_BASE, "regimes_date": "2026-05-01"}, series_latest=series, relay=None, bootstrap=None, now=_utc(2026, 6, 20, 15))
    assert rep["regime"]["common_feature_month"] == "2026-05-01"



# ── B6 (2026-09-18): FRED daily verdicts read the true observation date ─────
# raw_series stores daily series as one row per month dated the 1st (the
# newest in-month value). Counting lag from that stamp produced the reported
# "nine business days behind" on current values. The fetch now records each
# series' true last observation in source_watermarks; verdicts read it.

_MONTH_STAMPED = [
    {**r, "date": "2026-09-01"} if r["series_id"] in ("DGS10", "DGS2", "VIXCLS") else dict(r) for r in _SERIES
]
_DAILY = ("DGS10", "DGS2", "VIXCLS")


def _wm(obs, checked="2026-09-16T04:18:00Z", advanced=None):
    return {"last_obs": obs, "last_value": 1.0, "advanced_at": advanced or checked, "checked_at": checked, "status": "ok", "detail": None}


def _assess(series, now, wms):
    return freshness.assess(db_fresh=_BASE, series_latest=series, relay=None, bootstrap=None, now=now, watermarks=wms)


def test_month_stamped_rows_alone_reproduce_the_false_nine_day_lag():
    rep = freshness.assess(db_fresh=_BASE, series_latest=_MONTH_STAMPED, relay=None, bootstrap=None, now=_utc(2026, 9, 16, 12))
    row = _by_feed(rep)["fred:DGS10"]
    assert row["verdict"] == "stale" and "9 business day" in row["reason"]  # the legacy path, unchanged


def test_watermark_true_date_reads_current():
    rep = _assess(_MONTH_STAMPED, _utc(2026, 9, 16, 12), {f"fred:{s}": _wm("2026-09-15") for s in _DAILY})
    rows = _by_feed(rep)
    for s in _DAILY:
        assert rows[f"fred:{s}"]["verdict"] == "current", rows[f"fred:{s}"]
        assert rows[f"fred:{s}"]["latest"] == "2026-09-15"


def test_series_that_stops_advancing_is_stale_not_silent():
    wms = {f"fred:{s}": _wm("2026-09-04", checked="2026-09-16T04:18:00Z", advanced="2026-09-05T04:00:00Z") for s in _DAILY}
    rep = _assess(_MONTH_STAMPED, _utc(2026, 9, 16, 12), wms)
    row = _by_feed(rep)["fred:DGS10"]
    assert row["verdict"] == "stale"
    assert "no new observation since 2026-09-04" in row["reason"]
    assert rep["overall"] == "stale"


def test_missed_refresh_cycles_are_named():
    wms = {f"fred:{s}": _wm("2026-09-04", checked="2026-09-05T04:18:00Z") for s in _DAILY}
    row = _by_feed(_assess(_MONTH_STAMPED, _utc(2026, 9, 16, 12), wms))["fred:DGS10"]
    assert row["verdict"] == "stale" and "not checked since 2026-09-05" in row["reason"]


def test_missing_watermark_is_unavailable_not_a_false_stale():
    row = _by_feed(_assess(_MONTH_STAMPED, _utc(2026, 9, 16, 12), {}))["fred:DGS10"]
    assert row["verdict"] == "unavailable" and "observation date" in row["reason"]


def test_bond_market_holiday_counts_for_treasury_yields_only():
    # Columbus Day 2026-10-12: NYSE open, bond market closed (no DGS10 print).
    assert cal.is_trading_day(date(2026, 10, 12)) is True
    assert cal.is_bond_trading_day(date(2026, 10, 12)) is False
    assert cal.is_bond_trading_day(date(2026, 11, 11)) is False  # Veterans Day
    wms = {f"fred:{s}": _wm("2026-10-09", checked="2026-10-13T04:18:00Z") for s in _DAILY}
    rows = _by_feed(_assess(_MONTH_STAMPED, _utc(2026, 10, 13, 12), wms))
    assert rows["fred:DGS10"]["expected"] == "2026-10-09" and rows["fred:DGS2"]["expected"] == "2026-10-09"
    assert rows["fred:VIXCLS"]["expected"] == "2026-10-12"
