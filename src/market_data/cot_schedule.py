"""src/market_data/cot_schedule.py — the CFTC's Commitments of Traders release dates (Desk P4).

Each weekly report states positions as of a Tuesday (an adjacent day in a
holiday week) and is released later, usually that Friday at 3:30 p.m. Eastern
time, later when a federal holiday intervenes. The data the CFTC serves carries
the positions date only, so the release date of a stored report is read from
the CFTC's own published schedule, copied here verbatim:

    https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm
    read 2026-11-10: "The following is a tentative schedule of releases through
    2026. Federal holidays may delay release by one or two days." Dates marked
    "*" are "Delayed release date due to a federal holiday."

A report's release is the first scheduled release after its positions date,
when that is no more than ten days later; otherwise, and for any positions date
past the last scheduled release, the release date is unknown and nothing is
inferred (docs/desk/POSITIONING_SPEC.md §2.3). The schedule is tentative, so
the reader also refuses a scheduled date that comes after the store's own
first copy of the report (the CFTC released it earlier than the schedule says).

Stdlib only: the API reads it.
"""

from __future__ import annotations

from datetime import date, timedelta

SOURCE_URL = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm"
SOURCE_READ = "2026-11-10"
RELEASE_TIME_ET = "15:30"
# A report is released within this many days of its positions date, or its release is unknown.
MAX_LAG_DAYS = 10

# 2026, month by month, as the page lists them; "*" marks a holiday delay.
_SCHEDULE_2026 = {
    1: "05* 09 16 23 30",
    2: "06 13 20 27",
    3: "06 13 20 27",
    4: "03 10 17 24",
    5: "01 08 15 22 29",
    6: "05 12 22* 26",
    7: "06* 10 17 24 31",
    8: "07 14 21 28",
    9: "04 11 18 25",
    10: "02 09 16 23 30",
    11: "06 16* 20 30*",
    12: "04 11 18 28*",
}


def _parse(year: int, months: dict[int, str]) -> tuple[tuple[date, bool], ...]:
    out = []
    for month, days in sorted(months.items()):
        for tok in days.split():
            out.append((date(year, month, int(tok.rstrip("*"))), tok.endswith("*")))
    return tuple(out)


# (release date, delayed by a federal holiday), in order.
RELEASES: tuple[tuple[date, bool], ...] = _parse(2026, _SCHEDULE_2026)
FIRST = RELEASES[0][0]
LAST = RELEASES[-1][0]


def release_for(as_of: date) -> tuple[date, bool] | None:
    """The scheduled release of the report whose positions are dated `as_of`:
    the first scheduled release after it, within MAX_LAG_DAYS, with whether the
    CFTC marked it delayed; None when the schedule does not cover it."""
    for released, delayed in RELEASES:
        if released > as_of:
            return (released, delayed) if released - as_of <= timedelta(days=MAX_LAG_DAYS) else None
    return None
