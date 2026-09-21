"""src/analytics/ai_spend.py — the AI spend ledger and the monthly cap (B4, 2026-09-18).

Every paid call the news pipeline makes (Claude interpretation, Perplexity
research) is written to the append-only ``ai_spend_ledger`` table with its
cost taken from the provider's own usage report. The month-to-date sum of
that table is the budget: a call runs only while month-to-date spend plus
that call's worst case stays within MONTHLY_CAP_USD. Only the current UTC
month counts.

Stdlib only: the hourly news refresh installs requirements-news.txt. Nothing
here stores or prints a key, a URL or exception text.
"""

from __future__ import annotations

import math
import os
import sqlite3
from datetime import datetime, timedelta, timezone

MONTHLY_CAP_USD = 50.0

# Claude API pricing, Haiku 4.5, as of 2026-09-18 (USD per million tokens).
HAIKU_INPUT_USD_PER_MTOK = 1.00
HAIKU_OUTPUT_USD_PER_MTOK = 5.00
HAIKU_CACHE_WRITE_USD_PER_MTOK = HAIKU_INPUT_USD_PER_MTOK * 1.25  # 5-minute cache write
HAIKU_CACHE_READ_USD_PER_MTOK = HAIKU_INPUT_USD_PER_MTOK * 0.10

# Perplexity Sonar pricing. ASSUMPTIONS, to confirm on Perplexity's pricing
# page: used only when a response carries no usage.cost.total_cost.
SONAR_INPUT_USD_PER_MTOK = 1.00  # assumption
SONAR_OUTPUT_USD_PER_MTOK = 1.00  # assumption
SONAR_REQUEST_FEE_USD = 0.005  # assumption: $5 per 1,000 requests at search context "low"

# Claude API pricing, Sonnet 4.5 (the assistant's model, src/analytics/chat.py
# MODEL), from the published pricing page as read on 2026-09-21 (USD per
# million tokens). The assistant's daily ceiling is priced with these.
SONNET_INPUT_USD_PER_MTOK = 3.00
SONNET_OUTPUT_USD_PER_MTOK = 15.00
SONNET_CACHE_WRITE_USD_PER_MTOK = 3.75  # 5-minute cache write, 1.25× base input
SONNET_CACHE_READ_USD_PER_MTOK = 0.30  # cache hit, 0.1× base input

PROVIDERS = ("anthropic", "perplexity", "budget")
PURPOSES = ("news_interpretation", "news_research", "cap_reached", "assistant_ask")
# "reserved" and "released" are the assistant's holds (api/assistant_budget.py):
# a call is held at its worst case before it is made and released, as a
# negative row, once its real cost is recorded.
STATUSES = ("ok", "error", "cap_reached", "reserved", "released")
COST_SOURCES = ("usage", "usage.cost", "price_table", "none", "reserve")

_COLUMNS = (
    "ts", "month", "provider", "model", "purpose", "news_id", "input_tokens", "output_tokens",
    "cache_write_tokens", "cache_read_tokens", "request_fee_usd", "cost_usd", "cost_source",
    "status", "http_status", "run_id",
)


# ── clock ─────────────────────────────────────────────────────────────────────


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(now: datetime | None = None) -> datetime:
    """`now` as an aware UTC datetime (the real clock when None; naive means UTC)."""
    if now is None:
        return utc_now()
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def stamp(now: datetime | None = None) -> str:
    return as_utc(now).strftime("%Y-%m-%dT%H:%M:%SZ")


def month_of(now: datetime | None = None) -> str:
    return as_utc(now).strftime("%Y-%m")


def current_run_id() -> str | None:
    return os.environ.get("GITHUB_RUN_ID") or None


# ── prices ────────────────────────────────────────────────────────────────────


def _tokens(value) -> int:
    try:
        n = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(n, 0)


def _dollars(value) -> float | None:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) and x >= 0 else None


def unpriced() -> dict:
    """A call that returned no usage: recorded at zero."""
    return {
        "input_tokens": None, "output_tokens": None, "cache_write_tokens": None, "cache_read_tokens": None,
        "request_fee_usd": None, "cost_usd": 0.0, "cost_source": "none",
    }


def anthropic_cost(usage: dict | None) -> dict:
    """Ledger columns for one Claude call, priced from its `usage` block."""
    if not isinstance(usage, dict):
        return unpriced()
    inp = _tokens(usage.get("input_tokens"))
    out = _tokens(usage.get("output_tokens"))
    cw = _tokens(usage.get("cache_creation_input_tokens"))
    cr = _tokens(usage.get("cache_read_input_tokens"))
    cost = (
        inp * HAIKU_INPUT_USD_PER_MTOK
        + out * HAIKU_OUTPUT_USD_PER_MTOK
        + cw * HAIKU_CACHE_WRITE_USD_PER_MTOK
        + cr * HAIKU_CACHE_READ_USD_PER_MTOK
    ) / 1_000_000
    return {
        "input_tokens": inp, "output_tokens": out, "cache_write_tokens": cw, "cache_read_tokens": cr,
        "request_fee_usd": None, "cost_usd": round(cost, 8), "cost_source": "usage",
    }


def sonnet_cost(usage: dict | None) -> dict:
    """Ledger columns for one assistant call on Sonnet 4.5, priced from its
    `usage` block (the same field names the SDK reports)."""
    if not isinstance(usage, dict):
        return unpriced()
    inp = _tokens(usage.get("input_tokens"))
    out = _tokens(usage.get("output_tokens"))
    cw = _tokens(usage.get("cache_creation_input_tokens"))
    cr = _tokens(usage.get("cache_read_input_tokens"))
    cost = (
        inp * SONNET_INPUT_USD_PER_MTOK
        + out * SONNET_OUTPUT_USD_PER_MTOK
        + cw * SONNET_CACHE_WRITE_USD_PER_MTOK
        + cr * SONNET_CACHE_READ_USD_PER_MTOK
    ) / 1_000_000
    return {
        "input_tokens": inp, "output_tokens": out, "cache_write_tokens": cw, "cache_read_tokens": cr,
        "request_fee_usd": None, "cost_usd": round(cost, 8), "cost_source": "usage",
    }


def perplexity_cost(usage: dict | None) -> dict:
    """Ledger columns for one Sonar call: the provider's own usage.cost.total_cost
    when present, else tokens at the assumed price table plus the request fee."""
    if not isinstance(usage, dict):
        return unpriced()
    inp = _tokens(usage.get("prompt_tokens"))
    out = _tokens(usage.get("completion_tokens"))
    block = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
    total = _dollars(block.get("total_cost"))
    base = {"input_tokens": inp, "output_tokens": out, "cache_write_tokens": None, "cache_read_tokens": None}
    if total is not None:
        return {**base, "request_fee_usd": _dollars(block.get("request_cost")), "cost_usd": round(total, 8), "cost_source": "usage.cost"}
    cost = (inp * SONAR_INPUT_USD_PER_MTOK + out * SONAR_OUTPUT_USD_PER_MTOK) / 1_000_000 + SONAR_REQUEST_FEE_USD
    return {**base, "request_fee_usd": SONAR_REQUEST_FEE_USD, "cost_usd": round(cost, 8), "cost_source": "price_table"}


def estimate_tokens(*texts: str) -> int:
    """Prompt length / 4, rounded up."""
    return math.ceil(sum(len(t or "") for t in texts) / 4)


def anthropic_worst_case(*prompt_texts: str, max_tokens: int) -> float:
    """Worst case of one Claude call: the estimated input at the dearest input
    rate (the system block is cache-marked, so it could bill as a cache write)
    plus max_tokens of output."""
    return (estimate_tokens(*prompt_texts) * HAIKU_CACHE_WRITE_USD_PER_MTOK + max_tokens * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000


def perplexity_worst_case(*prompt_texts: str, max_tokens: int) -> float:
    """Worst case of one Sonar call: estimated input plus max_tokens of output at
    the price table, plus the request fee."""
    tokens = estimate_tokens(*prompt_texts) * SONAR_INPUT_USD_PER_MTOK + max_tokens * SONAR_OUTPUT_USD_PER_MTOK
    return tokens / 1_000_000 + SONAR_REQUEST_FEE_USD


# ── ledger ────────────────────────────────────────────────────────────────────


def record(
    conn: sqlite3.Connection,
    *,
    provider: str,
    purpose: str,
    status: str,
    now: datetime | None = None,
    model: str | None = None,
    news_id: int | None = None,
    priced: dict | None = None,
    http_status: int | None = None,
    run_id: str | None = None,
) -> float:
    """Append one ledger row and commit it; returns the cost recorded."""
    priced = priced or unpriced()
    if provider not in PROVIDERS or purpose not in PURPOSES or status not in STATUSES or priced["cost_source"] not in COST_SOURCES:
        raise ValueError("unknown ai_spend_ledger value")
    at = as_utc(now)
    values = (
        stamp(at), month_of(at), provider, model, purpose, news_id,
        priced["input_tokens"], priced["output_tokens"], priced["cache_write_tokens"], priced["cache_read_tokens"],
        priced["request_fee_usd"], float(priced["cost_usd"] or 0.0), priced["cost_source"],
        status, http_status if isinstance(http_status, int) else None, run_id,
    )
    conn.execute(f"INSERT INTO ai_spend_ledger ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' * len(_COLUMNS))})", values)
    conn.commit()
    return values[11]


def month_to_date(conn: sqlite3.Connection, now: datetime | None = None) -> float:
    """Sum of recorded cost in the current UTC month."""
    row = conn.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM ai_spend_ledger WHERE month = ?", (month_of(now),)).fetchone()
    return float(row[0] or 0.0)


def within_cap(conn: sqlite3.Connection, worst_case: float, *, now: datetime | None = None, cap: float = MONTHLY_CAP_USD) -> bool:
    """True when month-to-date spend plus `worst_case` stays within the cap."""
    return month_to_date(conn, now) + worst_case <= cap + 1e-9


def day_to_date(conn: sqlite3.Connection, now: datetime | None = None) -> float:
    """Sum of recorded cost in the current UTC day (the assistant's ceiling,
    launch-1). The ledger stamps every row `YYYY-MM-DDTHH:MM:SSZ`, so the day
    is a prefix match."""
    day = as_utc(now).strftime("%Y-%m-%d")
    row = conn.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM ai_spend_ledger WHERE ts LIKE ?", (f"{day}%",)).fetchone()
    return float(row[0] or 0.0)


def enrichments_in_last_hour(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Headlines enriched (ok or error) in the rolling 60 minutes before `now`.
    Counts distinct news_id over both purposes, so a research-only setup is
    bounded too; with both keys it equals the interpretation-row count."""
    since = stamp(as_utc(now) - timedelta(hours=1))
    row = conn.execute(
        "SELECT COUNT(DISTINCT news_id) FROM ai_spend_ledger"
        " WHERE purpose IN ('news_interpretation', 'news_research') AND status IN ('ok', 'error') AND ts >= ?",
        (since,),
    ).fetchone()
    return int(row[0] or 0)


def cap_already_noted(conn: sqlite3.Connection, run_id: str | None) -> bool:
    """Whether this workflow run already wrote its cap_reached row (full mode
    refreshes news twice in one run)."""
    if not run_id:
        return False
    return conn.execute(
        "SELECT 1 FROM ai_spend_ledger WHERE status = 'cap_reached' AND run_id = ? LIMIT 1", (run_id,)
    ).fetchone() is not None


def summary_line(stats: dict) -> str:
    """The one line each run prints: counts and amounts only."""
    if stats.get("ledger_error"):
        return f"AI enrichment: stopped, spend ledger unavailable ({stats['ledger_error']}) · {stats.get('calls', 0)} calls made before it"
    parts = [
        f"{stats.get('enriched', 0)} enriched",
        f"{stats.get('held_hourly', 0)} above the floor held for the hourly limit",
        f"{stats.get('skipped_cap', 0)} skipped at the cap",
    ]
    if stats.get("held_time"):
        parts.append(f"{stats['held_time']} held for the time budget")
    if stats.get("topped_up"):
        parts.append(f"{stats['topped_up']} topped up from the displayed window")
    errors = ", ".join(f"{label}×{n}" for label, n in sorted((stats.get("errors") or {}).items())) or "none"
    line = (
        f"AI enrichment: {', '.join(parts)} · ${stats.get('run_cost_usd', 0.0):.4f} this run"
        f" · ${stats.get('month_to_date_usd', 0.0):.2f} month-to-date of ${stats.get('cap_usd', MONTHLY_CAP_USD):.2f}"
        f" · errors: {errors}"
    )
    if not stats.get("keys", True):
        line += " · no API keys configured"
    return line
