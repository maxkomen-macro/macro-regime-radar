"""api/desk_v2_macro.py — the Desk v2 /regime and /macro routes (desk/frame-3-api-b2a).

DESK_FRAME3_SPEC §12.6 and §12.8, in the §12.0 envelope (api/desk_envelope.py).
This is session B2a's router; B1's api/desk_v2.py carries the other routes and
the two combine at merge. The handlers are thin: each runs in
`desk_envelope.answer`, which holds the error map, and every result they serve
is a worker item they look up (api/desk_items_macro.py; plan §0.2).

What depends on "now" is computed here, per response, and never stored
(plan §0.5): the comparison session, the K−2 row it selects (`print`, and the
label, trends, `months_in` and `since` read from it, which move at a month
boundary inside one generation), and the next release date.

Stdlib only at import, like api/desk.py: no src.config, and nothing heavy.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter
from starlette.responses import Response

from api import calendar as cal
from api import desk_envelope as env

PREFIX = "/api/desk"
router = APIRouter(prefix=PREFIX)

# The engine's lag (src/desk/event_study.REGIME_LAG_MONTHS; v2 §9.1): a session
# in month K takes the row stamped K − 2. Mirrored, so a request reads no
# engine; pinned equal by tests/test_desk_v2_regime.py.
REGIME_LAG_MONTHS = 2
HISTORY_ROWS = 60
HISTORY_NOTE = "labels as stored; revisions are not replayed."
REGIMES_SOURCE = "regimes table (src/regime.py)"


def _now() -> datetime:
    """The response's calculation time (tests freeze it)."""
    return datetime.now(timezone.utc)


def _response(r: env.Reply) -> Response:
    return Response(content=r.body, status_code=r.status_code, headers=r.headers, media_type=r.media_type)


def _result(name: str) -> Any:
    """This request's generation's item (the worker's pin), or its stored
    error raised; before the first generation, `Warming`."""
    from api.worker import get_worker

    return get_worker().result(name)


def stored_block(value: dict) -> dict:
    """A block the item stored as a part (api/desk_items_macro.part)."""
    if value.get("ok"):
        return env.block_ready(value["data"])
    return env.block_awaiting(value["reason"])


# ── K−2 (plan R8, R9) ───────────────────────────────────────────────────────

def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def months_before(month: str, n: int) -> str:
    y, m = divmod(int(month[:4]) * 12 + int(month[5:7]) - 1 - n, 12)
    return f"{y:04d}-{m + 1:02d}"


def print_for(session: date, lag: int = REGIME_LAG_MONTHS) -> str:
    """R8: the row a session in month K reads is the one stamped K − lag (the
    rule of event_study.regime_at)."""
    return months_before(month_of(session), lag)


def run_ending_at(rows: list[dict], month: str) -> tuple[int, str]:
    """R9: the run of equal labels in consecutive stored months ending at
    `month` (which is stored): (its length, its first month). A missing month
    ends the run; it is never bridged (S-14)."""
    by_month = {r["month"]: r for r in rows}
    label = by_month[month]["label"]
    n, first = 1, month
    while True:
        prev = months_before(first, 1)
        row = by_month.get(prev)
        if row is None or row["label"] != label:
            return n, first
        n, first = n + 1, prev


def current_block(rows: list[dict], comparison: date) -> dict:
    """§12.6 `current.data`: the stored K−2 row for the month of the
    comparison session. Awaiting (S-27) when that row is not stored, or does
    not store both trends."""
    month = print_for(comparison)
    row = next((r for r in rows if r["month"] == month), None)
    if row is None or row["growth"] is None or row["inflation"] is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    months_in, since = run_ending_at(rows, month)
    return {
        "label": row["label"],
        "print": month,
        "growth": row["growth"],
        "inflation": row["inflation"],
        "months_in": months_in,
        "since": since,
        "freq": "monthly",
        "source": REGIMES_SOURCE,
        "latest_print": rows[-1]["month"],
    }


# ── The next release date (§12.6, per response) ─────────────────────────────

def _utc(stamp: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return t if t.tzinfo is not None else t.replace(tzinfo=timezone.utc)


def release_date(times: list[str], now: datetime) -> str | None:
    """The New York date of the first stored release after `now`; null when
    the calendar has no record of one."""
    for stamp in times:
        t = _utc(stamp)
        if t is not None and t > now:
            return t.astimezone(cal.NY).date().isoformat()
    return None


def next_prints_block(value: dict, times: dict[str, list[str]], now: datetime) -> dict:
    """§12.6 `next_prints.data`: the item's thresholds, each with the release
    date of its next print as of `now` (null for INDPRO: no such event is
    stored)."""
    if not value.get("ok"):
        raise env.Awaiting(value["reason"])
    return {k: (None if p is None else {"release_date": release_date(times.get(k, []), now), **p})
            for k, p in value["data"].items()}


# ── GET /regime (§12.6) ─────────────────────────────────────────────────────

def regime_payload(now: datetime) -> dict:
    item = _result("desk_regime")
    rows = item["rows"]
    comparison = cal.last_completed_session(now)
    return {
        "current": env.block_from("/regime", "current", lambda: current_block(rows, comparison)),
        "history": [{"month": r["month"], "regime": r["label"]} for r in rows[-HISTORY_ROWS:]],
        "history_note": HISTORY_NOTE,
        "history_freq": "monthly",
        "history_source": REGIMES_SOURCE,
        "recession": stored_block(item["recession"]),
        "next_prints": env.block_from("/regime", "next_prints",
                                      lambda: next_prints_block(item["next_prints"], item["release_times"], now)),
        "stats": env.block_deferred("/regime", "stats"),
        "changes": env.block_deferred("/regime", "changes"),
    }


@router.get("/regime")
def desk_regime() -> Response:
    return _response(env.answer("/regime", lambda: regime_payload(_now())))


# ── GET /macro (§12.8) ──────────────────────────────────────────────────────

def macro_payload() -> dict:
    """The desk_macro item as it is: nothing in /macro depends on "now"."""
    item = _result("desk_macro")
    return {
        "curve": stored_block(item["curve"]),
        "credit": stored_block(item["credit"]),
        "stock_bond": env.block_deferred("/macro", "stock_bond"),
        "correlations": env.block_deferred("/macro", "correlations"),
        "matrix": env.block_deferred("/macro", "matrix"),
    }


@router.get("/macro")
def desk_macro() -> Response:
    return _response(env.answer("/macro", macro_payload))
