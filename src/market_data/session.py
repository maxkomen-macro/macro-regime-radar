"""NYSE session ends for the daily-bar completeness rule (B6, 2026-09-18).

A daily bar is stored only once its session is complete: now at or after the
real session end (16:00 ET, 13:00 ET on half-days) plus a buffer. Waiting
longer is always safe; writing a partial bar as a "close" is not (main's
delayed morning runs stored mid-session prices for 2026-09-01/02/03/10).

The tables mirror api/calendar.py. src/ may not import api/ (the market job
runs on the lean requirements-market.txt set), so tests/test_market_session.py
pins these tables and every session end to api/calendar.py. For a year the
tables do not cover, every weekday is treated as a full 16:00 session, which
only ever waits longer. Stdlib only.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
COMPLETE_BUFFER_MIN = 20

HOLIDAYS: dict[int, set[date]] = {
    2024: {date(2024, 1, 1), date(2024, 1, 15), date(2024, 2, 19), date(2024, 3, 29), date(2024, 5, 27), date(2024, 6, 19), date(2024, 7, 4), date(2024, 9, 2), date(2024, 11, 28), date(2024, 12, 25)},
    2025: {date(2025, 1, 1), date(2025, 1, 9), date(2025, 1, 20), date(2025, 2, 17), date(2025, 4, 18), date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1), date(2025, 11, 27), date(2025, 12, 25)},
    2026: {date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7), date(2026, 11, 26), date(2026, 12, 25)},
    2027: {date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26), date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6), date(2027, 11, 25), date(2027, 12, 24)},
}
EARLY_CLOSES: dict[int, set[date]] = {
    2024: {date(2024, 7, 3), date(2024, 11, 29), date(2024, 12, 24)},
    2025: {date(2025, 7, 3), date(2025, 11, 28), date(2025, 12, 24)},
    2026: {date(2026, 11, 27), date(2026, 12, 24)},
    2027: {date(2027, 11, 26)},
}
CLOSE_T = time(16, 0)
EARLY_CLOSE_T = time(13, 0)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS.get(d.year, set())


def session_close_utc(d: date) -> datetime | None:
    """The session's close in UTC, or None when the exchange is closed that day."""
    if not is_trading_day(d):
        return None
    close_t = EARLY_CLOSE_T if d in EARLY_CLOSES.get(d.year, set()) else CLOSE_T
    return datetime.combine(d, close_t, tzinfo=NY).astimezone(timezone.utc)


def bar_is_complete(bar_date: date, now_utc: datetime, buffer_min: int = COMPLETE_BUFFER_MIN) -> bool:
    """True once the session that produced `bar_date` has closed (plus the buffer).

    A bar dated on a closed day (no session) counts as complete only once that
    New York day has fully passed.
    """
    close = session_close_utc(bar_date)
    if close is None:
        close = datetime.combine(bar_date + timedelta(days=1), time(0, 0), tzinfo=NY).astimezone(timezone.utc)
        return now_utc >= close
    return now_utc >= close + timedelta(minutes=buffer_min)


def today_ny(now_utc: datetime) -> date:
    return now_utc.astimezone(NY).date()
