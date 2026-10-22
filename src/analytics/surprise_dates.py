"""src/analytics/surprise_dates.py — the dates the surprise pipeline accepts and
how it stores an observation date as a derived_metrics value.

Stdlib only, so api/db can read the provenance rows without importing pandas.
"""

from __future__ import annotations

import math
import re
from datetime import date

# Observation dates the daily-sourced surprises accept; the provenance check reads the same range.
SUPPORTED_DATES = (date(1900, 1, 1), date(2100, 12, 31))

_CANONICAL = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_source_date(text) -> date | None:
    """A stored observation date, only when it is exactly YYYY-MM-DD, a real
    calendar date, and inside SUPPORTED_DATES; a time of day is never truncated."""
    if not isinstance(text, str) or not _CANONICAL.fullmatch(text):
        return None
    try:
        d = date.fromisoformat(text)
    except ValueError:
        return None
    return d if SUPPORTED_DATES[0] <= d <= SUPPORTED_DATES[1] else None


def date_from_ordinal(value) -> date | None:
    """A provenance row's value (`date.toordinal()`) back to its date; None
    unless it is a whole number naming a date inside SUPPORTED_DATES."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value != int(value):
        return None
    n = int(value)
    if not SUPPORTED_DATES[0].toordinal() <= n <= SUPPORTED_DATES[1].toordinal():
        return None
    return date.fromordinal(n)
