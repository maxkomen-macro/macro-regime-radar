"""api/calendar.py — NYSE session calendar for freshness verdicts (2026-09-06).

Pure functions, no network. Holidays and early closes are the published NYSE
schedule for 2024–2027; extend the tables when the exchange publishes the
next year (a missing year degrades to weekends-only, never to a crash).
Times are America/New_York; every function accepts and returns aware UTC
datetimes so callers never guess a zone.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")

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
OPEN_T = time(9, 30)
CLOSE_T = time(16, 0)
EARLY_CLOSE_T = time(13, 0)


def is_holiday(d: date) -> bool:
    return d in HOLIDAYS.get(d.year, set())


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and not is_holiday(d)


def calendar_known(d: date) -> bool:
    return d.year in HOLIDAYS


def session_bounds(d: date) -> tuple[datetime, datetime] | None:
    """(open, close) in UTC for a trading day, None on a closed day."""
    if not is_trading_day(d):
        return None
    close_t = EARLY_CLOSE_T if d in EARLY_CLOSES.get(d.year, set()) else CLOSE_T
    o = datetime.combine(d, OPEN_T, tzinfo=NY).astimezone(timezone.utc)
    c = datetime.combine(d, close_t, tzinfo=NY).astimezone(timezone.utc)
    return o, c


def previous_trading_day(d: date) -> date:
    d = d - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def next_trading_day(d: date) -> date:
    d = d + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def last_completed_session(now: datetime) -> date:
    """The most recent trading day whose close is already in the past."""
    ny = now.astimezone(NY)
    d = ny.date()
    b = session_bounds(d)
    if b is not None and now >= b[1]:
        return d
    return previous_trading_day(d)


def session_state(now: datetime) -> dict:
    """Where the US cash session stands right now."""
    ny = now.astimezone(NY)
    d = ny.date()
    b = session_bounds(d)
    if b is None:
        phase = "holiday" if is_holiday(d) else "weekend"
    elif now < b[0]:
        phase = "pre"
    elif now < b[1]:
        phase = "open"
    else:
        phase = "post"
    nxt = next_trading_day(d) if phase in ("holiday", "weekend", "post") else d
    nb = session_bounds(nxt)
    return {
        "exchange": "NYSE",
        "timezone": "America/New_York",
        "phase": phase,
        "is_open": phase == "open",
        "today_is_trading_day": b is not None,
        "early_close": d in EARLY_CLOSES.get(d.year, set()),
        "last_completed_session": last_completed_session(now).isoformat(),
        "next_open_utc": nb[0].strftime("%Y-%m-%dT%H:%M:%SZ") if nb else None,
        "calendar_known": calendar_known(d),
        "local_time": ny.strftime("%Y-%m-%d %H:%M %Z"),
    }


def business_days_between(a: date, b: date) -> int:
    """Trading days strictly after a up to and including b (b ≥ a)."""
    if b <= a:
        return 0
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if is_trading_day(d):
            n += 1
    return n


def first_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() != 4:
        d += timedelta(days=1)
    return d


def month_add(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return date(d.year + y, m + 1, 1)
