"""Freshness tone by lateness against each source's expected lag (fix/site-audit D7).

A delay the source always has is not news: intraday bars within the drawer's
20-minute window (and the previous session's closing bar in the 30 minutes
after the open), the VIX's 15-minute delay by source, a monthly print before
its release time and a FRED daily series within its tolerance read neutral;
amber only past the expected lag; stale as before. The server judges it: a
"delayed" state carries `late` (false within the expected lag), and the
Ledger counts a FRED input's lag with the drawer's own rule.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import numpy as np
import pytest

from api import desk_v2, freshness
from src.desk import event_study as es

_FRESH = {
    "regimes_date": "2026-08-01", "signals_date": "2026-08-01", "market_daily_date": "2026-09-17",
    "market_intraday_ts": "2026-09-18 10:33:00", "news_published_at": "2026-09-18 14:00:00", "raw_series_date": "2026-09-01",
}
_STORED = [
    {"series_id": "CPIAUCSL", "date": "2026-08-01", "value": 1.0},
    {"series_id": "INDPRO", "date": "2026-08-01", "value": 1.0},
    {"series_id": "UNRATE", "date": "2026-08-01", "value": 1.0},
]
NOW = datetime(2026, 9, 18, 14, 40, tzinfo=timezone.utc)  # Friday 10:40 ET, session open
RELAY = {"token_configured": True, "feeds": {"us": "open", "vix": "rest"}, "feed_stale": {"us": False, "vix": False},
         "degraded": False, "degraded_reasons": []}


def _assess(now=NOW, fresh=_FRESH, relay=None, stored=_STORED):
    return freshness.assess(db_fresh=fresh, series_latest=stored, relay=relay, bootstrap=None, now=now, watermarks={})


def _series(rep):
    return {s["id"]: s for s in rep["series"]}


def _sla(rep):
    return {r["feed"]: r for r in rep["sla"]}


# ── 1. intraday bars ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(("bar", "state", "late", "verdict"), [
    ("2026-09-18 10:33:00", "delayed", False, "current"),   # 7 min old: within the drawer's 20 minutes
    ("2026-09-18 10:20:00", "delayed", False, "current"),   # exactly 20 min
    ("2026-09-18 10:05:00", "delayed", True, "delayed"),    # 35 min: past the window, amber
    ("2026-09-18 09:35:00", "stale", None, "stale"),        # 65 min: stale, as before
])
def test_intraday_bars_are_neutral_within_the_drawers_window(bar, state, late, verdict):
    rep = _assess(fresh={**_FRESH, "market_intraday_ts": bar})
    s = _series(rep)["market_intraday"]
    assert (s["state"], s["late"]) == (state, late)
    assert _sla(rep)["market_intraday"]["verdict"] == verdict  # the drawer and the state read one rule


def test_the_previous_close_is_on_time_in_the_30_minutes_after_the_open():
    opening = datetime(2026, 9, 18, 13, 45, tzinfo=timezone.utc)  # Friday 09:45 ET
    rep = _assess(now=opening, fresh={**_FRESH, "market_intraday_ts": "2026-09-17 15:55:00"})
    s = _series(rep)["market_intraday"]
    assert s["state"] == "close" and s["as_of"] == "2026-09-17 15:55:00"  # "Close · Sep 17", neutral
    assert _sla(rep)["market_intraday"]["verdict"] == "current"
    later = _assess(now=datetime(2026, 9, 18, 14, 5, tzinfo=timezone.utc), fresh={**_FRESH, "market_intraday_ts": "2026-09-17 15:55:00"})
    assert _series(later)["market_intraday"]["state"] == "stale"  # 10:05 ET: the opening window is over


# ── 2. the VIX's delay by source ──────────────────────────────────────────────

def test_the_vix_delay_by_source_is_on_time_and_a_late_poll_is_late():
    on_time = _series(_assess(relay=RELAY))["vix_delayed"]
    assert (on_time["state"], on_time["delay_min"], on_time["late"]) == ("delayed", 15, False)
    late = _series(_assess(relay={**RELAY, "feed_stale": {"us": False, "vix": True}}))["vix_delayed"]
    assert (late["state"], late["late"]) == ("delayed", True)


def test_late_is_set_only_on_a_delayed_state():
    for s in _assess(relay=RELAY)["series"]:
        assert "late" in s
        assert (s["late"] is None) == (s["state"] != "delayed"), s


# ── 4. monthly prints flip at their release time ─────────────────────────────

@pytest.mark.parametrize(("sid", "now", "state"), [
    ("CPIAUCSL", datetime(2026, 10, 15, 4, 30, tzinfo=timezone.utc), "close"),   # 00:30 ET on release day: not out
    ("CPIAUCSL", datetime(2026, 10, 15, 13, 0, tzinfo=timezone.utc), "close"),   # 09:00 ET: inside the buffer
    ("CPIAUCSL", datetime(2026, 10, 15, 13, 30, tzinfo=timezone.utc), "stale"),  # 09:30 ET: 08:30 + 60 min, due
    ("UNRATE", datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc), "close"),      # first Friday 08:00 ET
    ("UNRATE", datetime(2026, 10, 2, 14, 0, tzinfo=timezone.utc), "stale"),      # 10:00 ET
])
def test_a_monthly_print_is_due_at_its_release_time_not_at_midnight(sid, now, state):
    s = _series(_assess(now=now))[sid]
    assert s["state"] == state, s["reason"]


def test_indpro_is_due_at_its_own_release_time():
    meta = freshness.SERIES_REGISTRY["INDPRO"]
    assert freshness._expected_month_for(meta, datetime(2026, 9, 18, 14, 0, tzinfo=timezone.utc)) == date(2026, 7, 1)   # 10:00 ET
    assert freshness._expected_month_for(meta, datetime(2026, 9, 18, 14, 15, tzinfo=timezone.utc)) == date(2026, 8, 1)  # 09:15 + 60


def test_the_sla_and_the_regime_read_the_same_release_time():
    before = datetime(2026, 10, 15, 13, 0, tzinfo=timezone.utc)
    after = datetime(2026, 10, 15, 13, 30, tzinfo=timezone.utc)
    assert freshness.expected_month("CPIAUCSL", before) == date(2026, 8, 1)
    assert freshness.expected_month("CPIAUCSL", after) == date(2026, 9, 1)
    assert _sla(_assess(now=before))["fred:CPIAUCSL"]["verdict"] == "current"
    # A bare date is the whole day, after the release: the dated callers are unchanged.
    assert freshness.expected_month("CPIAUCSL", date(2026, 10, 15)) == date(2026, 9, 1)


# ── 5. one FRED-lag rule for the Ledger and the drawer ───────────────────────

AFTER_BELL = datetime(2026, 10, 7, 21, 0, tzinfo=timezone.utc)  # Wed 17:00 ET: the comparison session is Oct 7
BEFORE_BELL = datetime(2026, 10, 7, 14, 0, tzinfo=timezone.utc)  # Wed 10:00 ET: it is Oct 6
SPECS = {"hy_oas": "BAMLH0A0HYM2", "curve_2s10s": "T10Y2Y", "wti": "DCOILWTICO"}


def _drawer_stale(sid: str, last: str, now: datetime) -> bool:
    from api import desk as desk_mod

    stored = {sid: last}
    spec = next(s for s in desk_mod.desk_series_specs(stored) if s["id"] == sid)
    return freshness.desk_series_states(stored=stored, specs=[spec], watermarks={}, now=now)[0]["state"] == "stale"


@pytest.mark.parametrize("now", [AFTER_BELL, BEFORE_BELL])
@pytest.mark.parametrize("key", list(SPECS))
@pytest.mark.parametrize("last", ["2026-09-24", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"])
def test_a_fred_input_reads_the_same_on_the_ledger_and_in_the_drawer(now, key, last):
    from api.calendar import last_completed_session

    comparison = last_completed_session(now).isoformat()
    ledger = desk_v2.inputs_behind([{"key": key, "last": last}], comparison, now=now)[0]["stale"]
    assert ledger == _drawer_stale(SPECS[key], last, now), (key, last, comparison)


def test_after_the_bell_a_study_whose_fred_input_the_drawer_calls_current_is_not_stale():
    """The agent's case: HY OAS observed Thu Oct 1 is 3 bond days behind the
    Oct 6 print due (current in the drawer). After Wed Oct 7's bell the Ledger
    counted 4 to Oct 7 and called the study stale."""
    sessions = ("2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07")
    t = es.SignalTrace(sessions=sessions, evaluable=np.array([1, 1, 1, 0, 0, 0, 0], dtype=bool),
                       trigger=np.zeros(7, dtype=bool), holds=np.ones(7, dtype=bool), z=None)
    inputs = [{"key": "hy_oas", "last": "2026-10-01"}, {"key": "spx", "last": "2026-10-07"}]
    assert _drawer_stale("BAMLH0A0HYM2", "2026-10-01", AFTER_BELL) is False
    f = desk_v2.firing_state(t, "2026-10-07", "2026-10-06", cross=False, allowance=3, inputs=inputs,
                             grace=desk_v2.close_grace("2026-10-07", AFTER_BELL), now=AFTER_BELL)
    assert (f["stale"], f["stale_inputs"], f["evaluated_on"]) == (False, [], "2026-10-01")
    # One bond day older is stale in both places.
    assert _drawer_stale("BAMLH0A0HYM2", "2026-09-30", AFTER_BELL) is True
    older = desk_v2.firing_state(t, "2026-10-07", "2026-10-06", cross=False, allowance=3,
                                 inputs=[{"key": "hy_oas", "last": "2026-09-30"}, {"key": "spx", "last": "2026-10-07"}], now=AFTER_BELL)
    assert older["stale"] is True and older["stale_inputs"] == ["hy_oas"]


# ── Codex S-05: monthly prints on the dated release calendar ─────────────────

def _calendar_release_times() -> dict:
    """The repo's hand-maintained calendar (events/calendar.csv), the rows the refresh loads into event_calendar."""
    import csv
    from pathlib import Path

    rows = list(csv.DictReader((Path(__file__).resolve().parent.parent / "events" / "calendar.csv").open()))
    con = __import__("sqlite3").connect(":memory:")
    con.execute("CREATE TABLE event_calendar (id INTEGER PRIMARY KEY, event_name TEXT, event_datetime TEXT, importance TEXT)")
    con.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance) VALUES (?, ?, ?)",
                    [(r["event_name"], r["event_datetime"], r["importance"]) for r in rows])
    return freshness.release_times(con)


def test_the_release_times_come_from_the_event_calendar():
    times = _calendar_release_times()
    assert "2026-10-14T12:30:00Z" in times["CPI Release"]          # Wed Oct 14, 08:30 ET
    assert "2026-10-02T12:30:00Z" in times["Jobs Report (NFP)"]


@pytest.mark.parametrize(("now", "stored", "state"), [
    # The Sep CPI is released Wed Oct 14 at 08:30 ET (the calendar), not on the 15th (the old approximate day).
    (datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc), "2026-08-01", "close"),   # 09:00 ET: inside the buffer
    (datetime(2026, 10, 14, 13, 30, tzinfo=timezone.utc), "2026-08-01", "stale"),  # 09:30 ET: due
    # The Aug CPI came out Fri Sep 11: by Mon Sep 14 a Jul print is a release behind (the day-15 rule said current).
    (datetime(2026, 9, 14, 15, 0, tzinfo=timezone.utc), "2026-07-01", "stale"),
    (datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc), "2026-07-01", "close"),    # 08:00 ET on release day
])
def test_cpi_is_due_on_its_dated_release(now, stored, state):
    rep = freshness.assess(db_fresh={**_FRESH, "release_times": _calendar_release_times()},
                           series_latest=[{"series_id": "CPIAUCSL", "date": stored, "value": 1.0}], relay=None, bootstrap=None,
                           now=now, watermarks={})
    s = _series(rep)["CPIAUCSL"]
    assert s["state"] == state, s["reason"]
    assert _sla(rep)["fred:CPIAUCSL"]["verdict"] == ("current" if state == "close" else "delayed")


def test_the_regime_and_the_sla_read_the_same_dated_release():
    times = _calendar_release_times()
    assert freshness.expected_month("CPIAUCSL", datetime(2026, 9, 14, 15, 0, tzinfo=timezone.utc), times) == date(2026, 8, 1)
    assert freshness.expected_month("CPIAUCSL", datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc), times) == date(2026, 8, 1)
    assert freshness.expected_month("CPIAUCSL", datetime(2026, 10, 14, 13, 30, tzinfo=timezone.utc), times) == date(2026, 9, 1)
    # A month the calendar does not date keeps the approximate rule (the 15th at 08:30 ET + the buffer).
    assert freshness.expected_month("CPIAUCSL", datetime(2027, 1, 14, 16, 0, tzinfo=timezone.utc), times) == date(2026, 11, 1)
    assert freshness.expected_month("CPIAUCSL", datetime(2027, 1, 15, 16, 0, tzinfo=timezone.utc), times) == date(2026, 12, 1)


def test_the_drawer_says_awaiting_opening_bars_in_the_opening_window():
    """D7 follow-up: in the 30 minutes after the open the drawer's intraday row reads "Awaiting opening bars"
    (the verdict stays "current", the four-word contract); once the window closes the word is gone."""
    opening = datetime(2026, 9, 18, 13, 45, tzinfo=timezone.utc)  # Friday 09:45 ET
    row = _sla(_assess(now=opening, fresh={**_FRESH, "market_intraday_ts": "2026-09-17 15:55:00"}))["market_intraday"]
    assert (row["verdict"], row.get("word")) == ("current", "Awaiting opening bars")
    later = _sla(_assess(fresh={**_FRESH, "market_intraday_ts": "2026-09-18 10:33:00"}))["market_intraday"]
    assert later["verdict"] == "current" and later.get("word") is None

