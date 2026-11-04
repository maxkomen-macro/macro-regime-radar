"""tests/test_release_freshness.py — release-aware freshness for the monthly prints (Max, 2026-11-04).

- **F-2:** INDPRO is due at its dated G.17 release (events/calendar.csv, "Industrial Production (G.17)")
  plus RELEASE_BUFFER, like CPI and the jobs report; a month the calendar does not date keeps the day-18 rule.
- **F-1:** a monthly input one release behind reads the neutral "Released, awaiting refresh"
  (state delayed, late false) from its dated release + 60 min until 06:00 UTC the next day
  (close_grace_until), then stale as before. Never two releases behind, never in an undated month,
  never when the watermark records a failed check, never for a caller that does not opt in (the Desk
  Pipeline). The SLA verdicts and `overall` do not change; a delayed monthly SLA row in the window
  carries the same word. No sentence says FRED has not posted (design F, Codex DR-03/DR-04).
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone

import pytest

from api import desk_items_macro as items
from api import freshness

CPI, NFP, G17 = "CPI Release", "Jobs Report (NFP)", "Industrial Production (G.17)"
RELEASES = {
    CPI: ["2026-10-14T12:30:00Z", "2026-11-10T13:30:00Z"],
    NFP: ["2026-10-02T12:30:00Z", "2026-11-06T13:30:00Z"],
    G17: ["2026-10-16T13:15:00Z", "2026-11-17T14:15:00Z"],
}
WORD = "Released, awaiting refresh"


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _state(sid, stored, now, releases=RELEASES, watermark=None, awaiting=True):
    return freshness.fred_series_state(sid, today_ny=_utc(now).astimezone(freshness.cal.NY).date(), stored_date=stored,
                                       watermark=watermark, now=_utc(now), releases=releases, awaiting=awaiting)


def _assess(stored: dict[str, str], now: str, releases=RELEASES, watermarks=None):
    latest = [{"series_id": s, "date": d, "value": 1.0} for s, d in stored.items()]
    fresh = {"regimes_date": "2026-08-01", "signals_date": "2026-08-01", "market_daily_date": "2026-10-13",
             "news_published_at": "2026-10-14 14:00:00", "raw_series_date": "2026-10-01", "release_times": releases}
    return freshness.assess(db_fresh=fresh, series_latest=latest, relay=None, bootstrap=None, now=_utc(now),
                            watermarks=watermarks)


# ── F-2: INDPRO on its G.17 dates ───────────────────────────────────────────

def test_indpro_is_a_dated_release_event():
    assert freshness.MONTHLY_INPUTS["INDPRO"]["event"] == G17
    assert freshness.SERIES_REGISTRY["INDPRO"]["event"] == G17
    assert G17 in freshness.RELEASE_EVENTS
    # the day-18 rule stays as the fallback for an undated month
    assert freshness.MONTHLY_INPUTS["INDPRO"]["day"] == 18


def test_indpro_falls_due_at_its_g17_release_plus_the_buffer():
    assert freshness.expected_month("INDPRO", _utc("2026-10-16T14:14:00Z"), RELEASES) == date(2026, 8, 1)
    assert freshness.expected_month("INDPRO", _utc("2026-10-16T14:15:00Z"), RELEASES) == date(2026, 9, 1)
    # undated: the 18th, as before
    assert freshness.expected_month("INDPRO", _utc("2026-10-17T16:00:00Z"), {}) == date(2026, 8, 1)


def test_the_day_after_the_g17_an_unstored_indpro_is_behind_not_close():
    """APPROVED F-2's repro: on Oct 17 the day-18 rule read close for a print out since Oct 16."""
    rep = _assess({"INDPRO": "2026-08-01", "CPIAUCSL": "2026-09-01", "UNRATE": "2026-09-01"}, "2026-10-17T16:00:00Z")
    s = {x["id"]: x for x in rep["series"]}["INDPRO"]
    assert (s["state"], s["cycles_behind"]) == ("stale", 1)  # past 06:00 UTC Oct 17
    sla = {r["feed"]: r for r in rep["sla"]}["fred:INDPRO"]
    assert sla["verdict"] == "delayed" and sla["expected"] == "2026-09-01"


def test_the_release_times_reader_carries_the_g17_rows():
    with sqlite3.connect(":memory:") as conn:
        conn.execute("CREATE TABLE event_calendar (event_name TEXT, event_datetime TEXT)")
        conn.executemany("INSERT INTO event_calendar VALUES (?, ?)", [(G17, "2026-10-16T13:15:00Z"), (CPI, "2026-10-14T12:30:00Z")])
        out = freshness.release_times(conn)
    assert out[G17] == ["2026-10-16T13:15:00Z"] and out[CPI] == ["2026-10-14T12:30:00Z"]


def test_the_regime_card_and_the_drawer_read_the_same_release_rows():
    """I9: NEXT_PRINTS' events are the freshness meta's, so both surfaces date a print by one row."""
    for _key, sid, _axis, event in items.NEXT_PRINTS:
        assert freshness.MONTHLY_INPUTS[sid]["event"] == event
        assert event in freshness.RELEASE_EVENTS


# ── F-1: the neutral wait ───────────────────────────────────────────────────

@pytest.mark.parametrize(("sid", "stored", "now", "state", "word"), [
    # CPI Oct 14 2026, 08:30 EDT (12:30Z): due 13:30Z, grace until 06:00Z Oct 15
    ("CPIAUCSL", "2026-08-01", "2026-10-14T13:29:00Z", "close", None),      # before due: Aug is the newest due
    ("CPIAUCSL", "2026-08-01", "2026-10-14T13:30:00Z", "delayed", WORD),    # due_at, inclusive
    ("CPIAUCSL", "2026-08-01", "2026-10-14T23:00:00Z", "delayed", WORD),
    ("CPIAUCSL", "2026-08-01", "2026-10-15T05:59:00Z", "delayed", WORD),
    ("CPIAUCSL", "2026-08-01", "2026-10-15T06:00:00Z", "stale", None),      # the deadline, exclusive
    ("CPIAUCSL", "2026-09-01", "2026-10-14T14:30:00Z", "close", None),      # stored: current
    ("CPIAUCSL", "2026-07-01", "2026-10-14T14:30:00Z", "stale", None),      # two behind: never neutral
    # G.17 Nov 17 2026, 09:15 EST (14:15Z): due 15:15Z, grace until 06:00Z Nov 18 (01:00 EST)
    ("INDPRO", "2026-09-01", "2026-11-17T15:14:00Z", "close", None),
    ("INDPRO", "2026-09-01", "2026-11-17T15:15:00Z", "delayed", WORD),
    ("INDPRO", "2026-09-01", "2026-11-18T05:59:00Z", "delayed", WORD),
    ("INDPRO", "2026-09-01", "2026-11-18T06:00:00Z", "stale", None),
    # Jobs report Friday Nov 6 2026, 08:30 EST (13:30Z): grace until Saturday 06:00Z
    ("UNRATE", "2026-09-01", "2026-11-06T14:30:00Z", "delayed", WORD),
    ("UNRATE", "2026-09-01", "2026-11-07T05:59:00Z", "delayed", WORD),
    ("UNRATE", "2026-09-01", "2026-11-07T06:00:00Z", "stale", None),
])
def test_a_print_one_release_behind_waits_neutrally_until_the_refresh_deadline(sid, stored, now, state, word):
    s = _state(sid, stored, now)
    assert s["state"] == state, s
    assert s["word"] == word
    if state == "delayed":
        assert s["late"] is False and s["cycles_behind"] == 1 and s["stale"] is False and s["as_of"] == stored


def test_the_neutral_reason_names_the_scheduled_release_and_the_deadline_and_never_fred():
    s = _state("CPIAUCSL", "2026-08-01", "2026-10-14T14:30:00Z")
    assert "CPI (all items) for Sep 2026" in s["reason"]
    assert "Oct 14 at 08:30 ET" in s["reason"] and "06:00 UTC Oct 15" in s["reason"]
    assert "not visible here" in s["reason"]  # the failure limit, stated (design F, DR-01)
    assert "FRED" not in s["reason"]  # DR-03/DR-04: no "FRED has not posted" sentence
    est = _state("INDPRO", "2026-09-01", "2026-11-17T16:00:00Z")
    assert "Nov 17 at 09:15 ET" in est["reason"] and "06:00 UTC Nov 18" in est["reason"]


def test_an_undated_month_keeps_todays_state():
    """DR-02: an approximate release day is no evidence of a release; such a month never waits neutrally."""
    s = _state("CPIAUCSL", "2026-08-01", "2026-10-15T14:30:00Z", releases={})
    assert (s["state"], s["word"]) == ("stale", None)
    s = _state("CPIAUCSL", "2026-08-01", "2026-10-15T14:30:00Z", releases=None)
    assert (s["state"], s["word"]) == ("stale", None)


@pytest.mark.parametrize(("status", "state"), [(None, "delayed"), ("ok", "delayed"), ("revised", "delayed"),
                                               ("error", "stale"), ("http_500", "stale")])
def test_a_watermark_that_records_a_failed_check_is_never_neutral(status, state):
    wm = None if status is None else {"last_obs": "2026-08-01", "checked_at": "2026-10-14T14:00:00Z", "status": status}
    assert _state("CPIAUCSL", "2026-08-01", "2026-10-14T14:30:00Z", watermark=wm)["state"] == state


def test_callers_that_do_not_opt_in_and_bare_dates_keep_todays_states():
    """I7: the Desk Pipeline calls without `awaiting`; a bare date has no clock."""
    assert _state("CPIAUCSL", "2026-08-01", "2026-10-14T14:30:00Z", awaiting=False)["state"] == "stale"
    default = freshness.fred_series_state("CPIAUCSL", today_ny=date(2026, 10, 14), stored_date="2026-08-01", watermark=None,
                                          now=_utc("2026-10-14T14:30:00Z"), releases=RELEASES)
    assert default["state"] == "stale" and default["word"] is None
    bare = freshness.fred_series_state("CPIAUCSL", today_ny=date(2026, 10, 14), stored_date="2026-08-01", watermark=None,
                                       now=None, releases=RELEASES, awaiting=True)
    assert bare["state"] == "stale"


def test_series_outside_the_monthly_inputs_are_untouched():
    for sid in ("FEDFUNDS", "USREC"):
        s = _state(sid, "2026-08-01", "2026-10-03T15:00:00Z")
        assert s["state"] == "stale" and s["word"] is None


def test_assess_serves_the_word_and_leaves_every_verdict_as_it_was(monkeypatch):
    stored = {"CPIAUCSL": "2026-08-01", "INDPRO": "2026-08-01", "UNRATE": "2026-09-01"}
    inside = _assess(stored, "2026-10-14T14:30:00Z")
    cpi = {x["id"]: x for x in inside["series"]}["CPIAUCSL"]
    assert (cpi["state"], cpi["word"], cpi["late"]) == ("delayed", WORD, False)
    sla = {r["feed"]: r for r in inside["sla"]}
    assert sla["fred:CPIAUCSL"]["verdict"] == "delayed" and sla["fred:CPIAUCSL"].get("word") == WORD
    assert "word" not in sla["fred:INDPRO"] or sla["fred:INDPRO"]["word"] is None  # INDPRO not yet due Oct 14
    # I1: the verdicts and overall are exactly what they are without the neutral state
    monkeypatch.setattr(freshness, "awaiting_refresh", lambda *a, **k: None)
    without = _assess(stored, "2026-10-14T14:30:00Z")
    assert [(r["feed"], r["verdict"]) for r in inside["sla"]] == [(r["feed"], r["verdict"]) for r in without["sla"]]
    assert inside["overall"] == without["overall"]
    assert {x["id"]: x for x in without["series"]}["CPIAUCSL"]["state"] == "stale"


def test_past_the_deadline_the_sla_row_has_no_word():
    rep = _assess({"CPIAUCSL": "2026-08-01", "INDPRO": "2026-08-01", "UNRATE": "2026-09-01"}, "2026-10-15T06:00:00Z")
    row = {r["feed"]: r for r in rep["sla"]}["fred:CPIAUCSL"]
    assert row["verdict"] == "delayed" and not row.get("word")


def test_every_series_state_carries_a_word_key():
    rep = _assess({"CPIAUCSL": "2026-09-01", "INDPRO": "2026-08-01", "UNRATE": "2026-09-01"}, "2026-10-14T14:30:00Z")
    for s in rep["series"]:
        assert "word" in s and (s["word"] is None or s["state"] == "delayed"), s
