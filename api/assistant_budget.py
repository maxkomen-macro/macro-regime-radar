"""api/assistant_budget.py — the assistant's hard daily spend ceiling (launch-1).

The assistant answers visitors' questions on the public deploy, so what stands
between a stranger and the owner's Anthropic bill is a ceiling the server
enforces itself: ASSISTANT_DAILY_CAP_USD (default $1) per UTC day.

Spend is recorded in the same append-only ledger the news pipeline uses
(`ai_spend_ledger`, `src/analytics/ai_spend.py`, schema in `src/db_helpers.py`),
in its own file beside the served database. It cannot share that database: the
API opens it read-only, and a refresh replaces the whole file, which would take
the day's spend with it.

How the ceiling stays hard (verify loop 1 found three ways past the first
design, which recorded a call's cost only after its answer had streamed):

1. Every model call is paid for before it is made. The agent prices the call
   it is about to send at its worst case (one token per UTF-8 byte of the
   request plus the API's framing, all at the dearest input rate, and a full
   MAX_TOKENS answer), and `reserve()` checks the day's spend plus that amount
   against the cap and writes the hold in one write transaction. Questions
   that arrive together queue on the ledger's write lock, so only as many
   calls start as the day can still pay for.
2. A hold is charged whether or not its call finishes: a visitor who hangs up
   mid-answer, a stream that fails part-way and a process that dies all leave
   it in the day's sum. A finished call is settled: its real cost is appended,
   then a release of the hold, both stamped with the hold's time so they fall
   on the day the call started. A request Anthropic refused with an HTTP error
   before streaming is released, since Anthropic bills nothing for it.
3. It fails closed. A hold that cannot be written is refused, and a ledger
   that is read-only, or whose last write failed, rests the analyst.

Every row is appended; nothing is updated or deleted. A release is a negative
row, the way a ledger records a reversal. Nothing here logs a key, a question
or an answer: costs and counts only.
"""

from __future__ import annotations

import logging
import math
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from src.analytics import ai_spend
from src.db_helpers import ensure_ai_spend_ledger

log = logging.getLogger("mrr.assistant.budget")

# Beside the served database, never inside it. A container's filesystem is
# ephemeral: on a host without a persistent disk a restart starts a new ledger,
# so docs/redesign/DEPLOY.md asks for ASSISTANT_LEDGER_PATH on a small disk.
LEDGER_PATH = Path(os.environ.get("ASSISTANT_LEDGER_PATH") or (Path(__file__).resolve().parent.parent / "data" / "assistant_spend.db"))

DEFAULT_DAILY_CAP_USD = 1.0
# What the chip compares with the day's remaining budget: a first call at its
# largest (the 16 KB body cap holds the question and its history, plus the
# system block and tool definitions), priced as reserve() prices any call.
# Every real call is still reserved at its own worst case; this only decides
# when the chip says "resting" before anyone asks.
RESERVE_INPUT_TOKENS = 16_000
RESERVE_OUTPUT_TOKENS = 2_000  # src/analytics/chat.py MAX_TOKENS

# How long a failed ledger write rests the analyst: long enough that a full
# disk is not retried on every question, short enough to recover on its own.
WRITE_FAILURE_REST_S = 300.0

RESTING_MESSAGE = (
    "The AI analyst is resting until tomorrow: it has used today's budget. "
    "Every other screen works as usual, and it wakes up at midnight UTC."
)
LEDGER_MESSAGE = (
    "The AI analyst is resting because its spend ledger cannot be written, "
    "so it cannot count what an answer would cost. Every other screen works as usual."
)

_lock = threading.Lock()
_last_write_failure: float | None = None


@dataclass(frozen=True)
class Hold:
    """One reserved model call: its ledger key, the amount held and the
    moment it was taken (the day it is charged to)."""

    key: str
    amount: float
    at: datetime


def daily_cap_usd() -> float:
    """The cap in dollars. Anything that is not a finite number falls back to
    the default (verify loop 1: `inf` used to switch the ceiling off); a
    negative number rests the analyst, like 0."""
    raw = os.environ.get("ASSISTANT_DAILY_CAP_USD", "").strip()
    if not raw:
        return DEFAULT_DAILY_CAP_USD
    try:
        cap = float(raw)
    except ValueError:
        log.warning("ASSISTANT_DAILY_CAP_USD is not a number; using the default")
        return DEFAULT_DAILY_CAP_USD
    if math.isnan(cap) or cap == math.inf:
        log.warning("ASSISTANT_DAILY_CAP_USD is not a finite number; using the default")
        return DEFAULT_DAILY_CAP_USD
    return max(0.0, cap)


def call_worst_case_usd(prompt_tokens: int, max_tokens: int) -> float:
    """The most one call can cost: every prompt token at the dearest input rate
    (a cache write, though the agent marks nothing for caching) and a full
    answer of `max_tokens` output."""
    return (
        max(0, int(prompt_tokens)) * ai_spend.SONNET_CACHE_WRITE_USD_PER_MTOK
        + max(0, int(max_tokens)) * ai_spend.SONNET_OUTPUT_USD_PER_MTOK
    ) / 1_000_000


def reserve_usd() -> float:
    """What the chip keeps in hand for a first call (see RESERVE_INPUT_TOKENS)."""
    return call_worst_case_usd(RESERVE_INPUT_TOKENS, RESERVE_OUTPUT_TOKENS)


def _connect() -> sqlite3.Connection:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(LEDGER_PATH, timeout=5.0)
    ensure_ai_spend_ledger(conn)
    return conn


def _write_failed(exc: BaseException) -> None:
    global _last_write_failure
    _last_write_failure = time.monotonic()
    log.warning("assistant ledger write failed (%s); resting", type(exc).__name__)


def reset_for_tests() -> None:
    """Forget the last write failure (the path is monkeypatched between tests)."""
    global _last_write_failure
    with _lock:
        _last_write_failure = None


def _ledger_problem() -> str | None:
    """Why the ledger cannot take a hold right now, or None. Checked before a
    question so the chip and the answer agree."""
    if _last_write_failure is not None and time.monotonic() - _last_write_failure < WRITE_FAILURE_REST_S:
        return "unwritable"
    path = Path(LEDGER_PATH)
    # SQLite writes a journal beside the file, so the directory must be
    # writable as well as the file.
    if path.exists() and not (os.access(path, os.W_OK) and os.access(path.parent, os.W_OK)):
        return "read-only"
    return None


def spent_today(now: datetime | None = None) -> float:
    """The day's charged spend: settled calls plus the holds of calls still
    running or never settled. Raises OSError or sqlite3.Error when the ledger
    cannot be read; callers rest instead."""
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
    base = {"cap_usd": cap, "reserve_usd": round(reserve, 6), "resets_at": _resets_at(now)}
    problem = _ledger_problem()
    spent = None
    if problem is None:
        try:
            spent = spent_today(now)
        except (OSError, sqlite3.Error) as exc:
            log.warning("assistant ledger unavailable (%s); resting", type(exc).__name__)
            problem = "unavailable"
    if problem is not None:
        return {"resting": True, "spent_usd": None, **base, "ledger": problem, "reason": LEDGER_MESSAGE}
    resting = spent + reserve > cap + 1e-9
    return {
        "resting": resting,
        "spent_usd": round(spent, 6),
        **base,
        "ledger": "ok",
        "reason": RESTING_MESSAGE if resting else None,
    }


def _held(amount: float) -> dict:
    return {**ai_spend.unpriced(), "cost_usd": amount, "cost_source": "reserve"}


def reserve(amount: float, *, now: datetime | None = None) -> Hold | None:
    """Hold `amount` against today's cap for one model call, or None when the
    day cannot pay for it or the hold cannot be written (fail closed). The
    check and the write are one transaction under the ledger's write lock."""
    if _ledger_problem() is not None:
        return None
    at = ai_spend.as_utc(now)
    amount = round(max(0.0, float(amount)), 8)
    cap = daily_cap_usd()
    key = f"assistant-hold:{uuid.uuid4().hex}"
    try:
        with _lock:
            conn = _connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                if ai_spend.day_to_date(conn, at) + amount > cap + 1e-9:
                    conn.rollback()
                    return None
                ai_spend.record(
                    conn, provider="anthropic", purpose="assistant_ask", status="reserved",
                    now=at, priced=_held(amount), run_id=key,
                )
            finally:
                conn.close()
    except (OSError, sqlite3.Error) as exc:
        _write_failed(exc)
        return None
    return Hold(key=key, amount=amount, at=at)


def settle(hold: Hold, usage: dict | None, *, model: str | None = None) -> float:
    """Charge a finished call its real cost and release its hold. The real cost
    is written first: if the release then fails, the day stays over-counted,
    which is the safe side. Returns the cost now charged for the call."""
    priced = ai_spend.sonnet_cost(usage)
    if priced["cost_usd"] > hold.amount + 1e-9:
        log.warning("an assistant call cost more than its reserved worst case")
    try:
        with _lock:
            conn = _connect()
            try:
                ai_spend.record(
                    conn, provider="anthropic", purpose="assistant_ask", status="ok",
                    now=hold.at, model=model or (usage or {}).get("model"), priced=priced, run_id=hold.key,
                )
                ai_spend.record(
                    conn, provider="anthropic", purpose="assistant_ask", status="released",
                    now=hold.at, priced=_held(-hold.amount), run_id=hold.key,
                )
            finally:
                conn.close()
    except (OSError, sqlite3.Error) as exc:
        _write_failed(exc)
        return hold.amount
    return float(priced["cost_usd"])


def release(hold: Hold) -> None:
    """Return a hold whose request Anthropic refused before streaming."""
    try:
        with _lock:
            conn = _connect()
            try:
                ai_spend.record(
                    conn, provider="anthropic", purpose="assistant_ask", status="released",
                    now=hold.at, priced=_held(-hold.amount), run_id=hold.key,
                )
            finally:
                conn.close()
    except (OSError, sqlite3.Error) as exc:
        _write_failed(exc)


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
