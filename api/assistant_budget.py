"""api/assistant_budget.py — the assistant's hard daily spend ceiling (launch-1).

The assistant answers visitors' questions on the public deploy, so what stands
between a stranger and the owner's Anthropic bill is a ceiling the server
enforces itself: ASSISTANT_DAILY_CAP_USD (default $1) of recorded spend per UTC
day.

Spend is recorded in the same append-only ledger the news pipeline uses
(`ai_spend_ledger`, `src/analytics/ai_spend.py`, schema in `src/db_helpers.py`),
in its own file beside the served database. It cannot share that database: the
API opens it read-only, and a refresh replaces the whole file, which would take
the day's spend with it.

Two checks make the ceiling hard rather than "hard until the last answer":

1. A question is refused before any model call while the day's spend plus one
   call's worst case would cross the cap (`state()["resting"]`).
2. The agent's tool loop asks `allow_more()` before every further model call,
   so a long answer stops instead of carrying the day past the cap.

When the ledger cannot be opened the server rests rather than spending blind.
Nothing here logs a key, a question or an answer: costs and counts only.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.analytics import ai_spend
from src.db_helpers import ensure_ai_spend_ledger

log = logging.getLogger("mrr.assistant.budget")

# Beside the served database, never inside it. A container's filesystem is
# ephemeral, so the ceiling is per UTC day and per instance lifetime; the
# runbook says so.
LEDGER_PATH = Path(os.environ.get("ASSISTANT_LEDGER_PATH") or (Path(__file__).resolve().parent.parent / "data" / "assistant_spend.db"))

DEFAULT_DAILY_CAP_USD = 1.0
# One call's worst case at Sonnet 4.5 rates: a full prompt (system block, the
# eight tool definitions and up to twenty turns of history) billed as a cache
# write, plus MAX_TOKENS of output. Used as the reserve so the cap is never
# crossed by a call this server chose to start.
RESERVE_INPUT_TOKENS = 16_000
RESERVE_OUTPUT_TOKENS = 2_000  # src/analytics/chat.py MAX_TOKENS

_lock = threading.Lock()


def daily_cap_usd() -> float:
    raw = os.environ.get("ASSISTANT_DAILY_CAP_USD", "").strip()
    try:
        cap = float(raw) if raw else DEFAULT_DAILY_CAP_USD
    except ValueError:
        log.warning("ASSISTANT_DAILY_CAP_USD is not a number — using the default")
        return DEFAULT_DAILY_CAP_USD
    return max(0.0, cap)


def reserve_usd() -> float:
    """What one more call could cost."""
    return (
        RESERVE_INPUT_TOKENS * ai_spend.SONNET_CACHE_WRITE_USD_PER_MTOK
        + RESERVE_OUTPUT_TOKENS * ai_spend.SONNET_OUTPUT_USD_PER_MTOK
    ) / 1_000_000


def _connect() -> sqlite3.Connection:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(LEDGER_PATH, timeout=5.0)
    ensure_ai_spend_ledger(conn)
    return conn


def reset_for_tests() -> None:
    """Forget any cached state (the path is monkeypatched between tests)."""
    with _lock:
        pass


def spent_today(now: datetime | None = None) -> float:
    """Recorded assistant spend in the current UTC day. Raises OSError or
    sqlite3.Error when the ledger cannot be read; callers rest instead."""
    with _lock:
        conn = _connect()
        try:
            return ai_spend.day_to_date(conn, now)
        finally:
            conn.close()


def _resets_at(now: datetime | None = None) -> str:
    at = ai_spend.as_utc(now)
    midnight = (at + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.strftime("%Y-%m-%dT%H:%M:%SZ")


def state(now: datetime | None = None) -> dict:
    """What the chip shows: resting or not, the day's spend, the cap and when
    the day turns over. Never raises."""
    cap, reserve = daily_cap_usd(), reserve_usd()
    try:
        spent = spent_today(now)
    except (OSError, sqlite3.Error) as exc:
        log.warning("assistant ledger unavailable (%s) — resting", type(exc).__name__)
        return {
            "resting": True, "spent_usd": None, "cap_usd": cap, "reserve_usd": round(reserve, 6),
            "resets_at": _resets_at(now), "ledger": "unavailable",
            "reason": "The spend ledger is unavailable, so the analyst is resting until it can count the day again.",
        }
    resting = spent + reserve > cap
    return {
        "resting": resting,
        "spent_usd": round(spent, 6),
        "cap_usd": cap,
        "reserve_usd": round(reserve, 6),
        "resets_at": _resets_at(now),
        "ledger": "ok",
        "reason": RESTING_MESSAGE if resting else None,
    }


RESTING_MESSAGE = (
    "The AI analyst is resting until tomorrow: it has used today's budget. "
    "Every other screen works as usual, and it wakes up at midnight UTC."
)


def allow_more(now: datetime | None = None) -> bool:
    """Gate for the agent's tool loop: may it make one more model call?"""
    return not state(now)["resting"]


def record(usage: dict | None, *, status: str = "ok", model: str | None = None, now: datetime | None = None) -> float:
    """Append one assistant call to the ledger, priced at Sonnet 4.5 rates.
    Returns the cost recorded (0.0 when the ledger cannot be written)."""
    priced = ai_spend.sonnet_cost(usage)
    try:
        with _lock:
            conn = _connect()
            try:
                return ai_spend.record(
                    conn,
                    provider="anthropic",
                    purpose="assistant_ask",
                    status=status if status in ("ok", "error") else "ok",
                    now=now,
                    model=model or (usage or {}).get("model"),
                    priced=priced,
                )
            finally:
                conn.close()
    except (OSError, sqlite3.Error) as exc:
        log.warning("assistant spend not recorded (%s)", type(exc).__name__)
        return 0.0


def note_cap_reached(now: datetime | None = None) -> None:
    """One `cap_reached` row per UTC day, so the ops view shows the ceiling
    was hit rather than inferring it from a gap."""
    try:
        with _lock:
            conn = _connect()
            try:
                day = ai_spend.as_utc(now).strftime("%Y-%m-%d")
                already = conn.execute(
                    "SELECT 1 FROM ai_spend_ledger WHERE status = 'cap_reached' AND purpose = 'cap_reached' AND ts LIKE ? LIMIT 1",
                    (f"{day}%",),
                ).fetchone()
                if already:
                    return
                ai_spend.record(conn, provider="budget", purpose="cap_reached", status="cap_reached", now=now)
            finally:
                conn.close()
    except (OSError, sqlite3.Error):
        pass
