"""tests/test_calendar_coverage.py — the NYSE holiday tables cover every stored year (desk/frame-3-api).

docs/desk/FRAME3_API_PLAN.md §1.11 N7 and §5 (ruled S-12, R-03). api/calendar.py
used to hold 2024–2027 only, and a missing year degrades to weekends-only, so a
bond-calendar window reaching 2023 counted 2023-12-25 as a missed print. The
tables now hold 1962–2027, generated for 1962–2023 by scripts/gen_nyse_holidays.py
from exchange_calendars' XNYS holiday definitions.

- **Coverage.** Every year that holds a stored daily observation has a list:
  on the published copy (`DESK_PUBLISHED_DB`, default data/macro_radar.db;
  skipped without it) and on the engine suite's synthetic store, always.
- **Known dates**, hard-coded here from NYSE's history of closings, never read
  from exchange_calendars.
- **The bounded definitions**, every year: each list equals a fresh run of
  the generator. Before 1970 this is the only check, and the tables are the
  authority.
- **Parity with the engine's calendar from 1970-01-01 only**, and the
  pre-1970 discrepancy pinned as a fact.
- **The bond extras** against the stored DGS10 days (skipped without the copy).
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

from api import calendar as cal
from src.market_data import session

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = Path(os.environ.get("DESK_PUBLISHED_DB", ROOT / "data" / "macro_radar.db"))
sys.path.insert(0, str(ROOT / "scripts"))
import gen_nyse_holidays as gen  # noqa: E402

published = pytest.mark.skipif(not PUBLISHED.exists(), reason="no published copy at data/macro_radar.db (DESK_PUBLISHED_DB)")

# The 1968 paperwork crisis: every Wednesday from 12 June through 18 December, except the weeks
# of Independence Day, Labor Day, Election Day, Veterans Day and Thanksgiving (the New York Times
# of 1968-06-26 lists the July closings: the 10th, 17th, 24th and 31st).
PAPERWORK_1968 = [date(1968, m, d) for m, d in (
    (6, 12), (6, 19), (6, 26), (7, 10), (7, 17), (7, 24), (7, 31), (8, 7), (8, 14), (8, 21), (8, 28),
    (9, 11), (9, 18), (9, 25), (10, 2), (10, 9), (10, 16), (10, 23), (10, 30), (11, 20), (12, 4), (12, 11), (12, 18))]
KNOWN_CLOSINGS = [
    date(1962, 12, 25),                                     # Christmas
    *PAPERWORK_1968,
    date(1985, 9, 27),                                      # Hurricane Gloria
    date(2001, 9, 11), date(2001, 9, 12), date(2001, 9, 13), date(2001, 9, 14),
    date(2012, 10, 29), date(2012, 10, 30),                 # Hurricane Sandy
]


def _stored_years(conn: sqlite3.Connection) -> set[int]:
    years: set[int] = set()
    q = [("SELECT DISTINCT substr(date, 1, 4) FROM desk_series", "desk_series"),
         ("SELECT DISTINCT substr(date, 1, 4) FROM asset_prices WHERE interval = '1d'", "asset_prices"),
         ("SELECT DISTINCT substr(last_obs, 1, 4) FROM source_watermarks WHERE source LIKE 'fred:%' AND last_obs IS NOT NULL",
          "source_watermarks")]
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for sql, table in q:
        if table in tables:
            years |= {int(r[0]) for r in conn.execute(sql) if r[0] and r[0].isdigit()}
    return years


@published
def test_every_stored_year_on_the_published_copy_has_a_holiday_list():
    conn = sqlite3.connect(f"file:{PUBLISHED}?mode=ro", uri=True)
    try:
        years = _stored_years(conn)
    finally:
        conn.close()
    assert min(years) <= 1962, "the published copy holds DGS10 from 1962"
    assert years - set(cal.HOLIDAYS) == set()


def test_every_stored_year_on_the_synthetic_store_has_a_holiday_list(tmp_path):
    from tests.test_event_study import _synthetic_db

    conn = sqlite3.connect(_synthetic_db(tmp_path / "synth.db"))
    try:
        years = _stored_years(conn)
    finally:
        conn.close()
    assert years and years - set(cal.HOLIDAYS) == set()


def test_the_known_closings_are_holidays():
    for d in KNOWN_CLOSINGS:
        assert cal.is_holiday(d) and not cal.is_trading_day(d), d
    assert date(1968, 7, 3) not in cal.HOLIDAYS[1968], "the Independence Day week's Wednesday traded"
    assert cal.calendar_known(date(1962, 1, 2)) and cal.calendar_known(date(2023, 12, 25))


def test_each_year_equals_the_bounded_definitions():
    """Every year 1962–2027: the checked-in list is a fresh run of the generator
    (regular_holidays bounded to the year, plus its adhoc_holidays, weekdays).
    The published 2024–2027 lists agree with the definitions too."""
    fresh = gen.holidays_by_year(1962, 2027)
    assert sorted(cal.HOLIDAYS) == list(range(1962, 2028))
    for year, days in fresh.items():
        assert cal.HOLIDAYS[year] == set(days), year
    assert sum(len(v) for y, v in fresh.items() if y <= 2023) == 569
    assert sum(len(v) for y, v in fresh.items() if y < 1970) == 101


def test_the_generated_files_are_up_to_date():
    table = gen.holidays_by_year()
    for path in gen.TARGETS:
        assert gen.rendered(path.read_text(), table) == path.read_text(), path


def test_the_lean_copy_is_the_same_tables():
    assert session.HOLIDAYS == cal.HOLIDAYS and session.EARLY_CLOSES == cal.EARLY_CLOSES


def _xnys_sessions() -> set[date]:
    import exchange_calendars as xcals
    import pandas as pd

    x = xcals.get_calendar("XNYS", start="1962-01-01", end="2027-12-31")
    return set(pd.DatetimeIndex(x.sessions).date)


def test_parity_with_the_engines_calendar_from_1970():
    """From 1970-01-01, a bond-trading day in api/calendar is an XNYS session
    of the engine's calendar that is not a bond extra closure, every day."""
    sessions = _xnys_sessions()
    d = date(1970, 1, 1)
    while d <= date(2027, 12, 31):
        assert cal.is_trading_day(d) == (d in sessions), d
        assert cal.is_bond_trading_day(d) == (d in sessions and d not in cal.bond_extra_closures(d.year)), d
        d += timedelta(days=1)


def test_before_1970_the_engines_calendar_keeps_the_regular_holidays_as_sessions():
    """The discrepancy, pinned as a fact: pandas' holiday calendar starts at
    1970-01-01, so exchange_calendars' XNYS sessions keep 1962–1969's regular
    holidays open. A later release that fixes it fails here, and the
    "parity from 1970 only" rule is revisited, never silently changed."""
    sessions = _xnys_sessions()
    assert date(1962, 12, 25) in sessions and cal.is_holiday(date(1962, 12, 25))
    disagree = [d for y in range(1962, 1970) for d in cal.HOLIDAYS[y] if d in sessions]
    assert len(disagree) == 69
    assert not any(d in sessions for d in PAPERWORK_1968), "the ad hoc closings are non-sessions there"


def test_the_bond_extras_follow_the_rules_of_each_era():
    assert cal.bond_extra_closures(1965) == {date(1965, 10, 12), date(1965, 11, 11)}
    assert cal.bond_extra_closures(1969) == {date(1969, 10, 13), date(1969, 11, 11)}   # 12 Oct a Sunday
    assert cal.bond_extra_closures(1968) == {date(1968, 11, 11)}                       # 12 Oct a Saturday
    assert cal.bond_extra_closures(1972) == {date(1972, 10, 9), date(1972, 10, 23)}    # Veterans Day in October
    assert cal.bond_extra_closures(1974) == {date(1974, 10, 14), date(1974, 11, 11)}
    assert cal.bond_extra_closures(2025) == {date(2025, 10, 13), date(2025, 11, 11)}
    assert cal.bond_extra_closures(2029) == {date(2029, 10, 8), date(2029, 11, 12)}    # 11 Nov a Sunday


@published
def test_no_bond_extra_closure_carries_a_stored_treasury_yield():
    """FRED prints no Treasury yield on a bond holiday: every closure the rules
    name, 1962–2025, has no stored DGS10 value, and the dates the older eras did
    not close on (the second Monday before 1971, 11 November in 1971–1973) do."""
    conn = sqlite3.connect(f"file:{PUBLISHED}?mode=ro", uri=True)
    try:
        have = {r[0] for r in conn.execute("SELECT date FROM desk_series WHERE series_id = 'DGS10'")}
    finally:
        conn.close()
    named = [d for y in range(1962, 2026) for d in cal.bond_extra_closures(y)]
    assert [d for d in named if d.isoformat() in have] == []
    assert {"1962-10-08", "1965-10-11", "1966-10-10", "1967-10-09"} <= have, "the second Monday traded before 1971"
    assert "1971-11-11" in have, "11 November traded in 1971"
