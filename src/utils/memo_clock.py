"""src/utils/memo_clock.py — the content clock of a queued memo (CS-2, DR-51, DR-71).

A queued memo is built from its source run's database, whenever it is rendered,
as that snapshot stood when it was validated. The memo workflows set MEMO_CLOCK
to the source's validated_at; every semantic "now" in the memo generators and
in the analytics modules the weekly memo re-runs on its pinned copy reads this
helper instead of the wall clock. Unset (the refresh pipeline, manual memo runs)
it returns the wall clock, so their output is unchanged.

Metadata stamps (computed_at, created_at, the playbook's generated_at, a memo's
"Generated" line) stay on the wall clock: they say when a file was written.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone


def memo_clock() -> datetime:
    """MEMO_CLOCK (an ISO-8601 UTC time) when set, else now; always timezone-aware UTC."""
    raw = os.environ.get("MEMO_CLOCK", "").strip()
    if not raw:
        return datetime.now(timezone.utc)
    t = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise ValueError(f"MEMO_CLOCK has no time zone: {raw!r}")
    return t.astimezone(timezone.utc)


def clock_set() -> bool:
    return bool(os.environ.get("MEMO_CLOCK", "").strip())
