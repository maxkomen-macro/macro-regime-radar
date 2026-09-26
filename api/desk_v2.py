"""api/desk_v2.py — the Desk v2 routes under /api/desk (desk/frame-3-api, B1).

DESK_FRAME3_SPEC §12: nine GET routes answering the §12.0 envelope
(api/desk_envelope.py), and the deferred resources of §12.13 as GET-only
stubs answering the awaiting envelope. The handlers are thin: each runs in
`desk_envelope.answer`, which holds the error map, and every result they
serve is a worker item they look up (docs/desk/FRAME3_API_PLAN.md §0.2), then
project. Built so far: the stubs (plan §7 commit 1), /study and
/study/catalog (commit 3).

A removed write (`POST /positions`, `POST /basket/price`) answers the
enveloped 405 through api/main.py's 405 handler, which asks
`method_not_allowed` here and leaves every other 405 as FastAPI answers it.

**The projection memo** (plan §3, v4 B-09) holds only the part of an answer
that depends on the generation alone, keyed on (generation id, route, the
normalized parameters, the verdict rule, ADAPTER_SCHEMA); the fields that
depend on "now" (plan §0.5: the comparison sessions, `stale`, the firing
state) are recomputed for every response and laid over it.
`served_from_cache` is true exactly on a memo hit, and a memo key is never
served as `inputs_hash`.

api/desk.py's routes (/event-study, /event-study/assets, /pipeline/inventory)
keep their own contracts and are not touched here. Like api/desk.py, this
module never imports src.config, and every heavy dependency (the engine,
numpy) is imported at the point of use.
"""

from __future__ import annotations

import bisect
import json
import logging
import math
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.responses import Response

from api import calendar as nyse
from api import desk_catalog as catalog
from api import desk_envelope as env
from src.desk import series as registry

log = logging.getLogger("mrr.desk")

PREFIX = "/api/desk"
router = APIRouter(prefix=PREFIX)

ADAPTER_SCHEMA = "desk-v2/1"  # keys the projection memo; never served as engine_version or inputs_hash
VERDICT_RULE = "v1"
MEMO_MAX = 256
MIN_VERDICT_N = 10
HORIZON_LABEL = {5: "1 week", 10: "2 weeks", 20: "1 month", 60: "3 months"}
METHOD = {"exact": "enumeration", "monte_carlo": "monte_carlo", None: None}
VERDICT_LABEL = {"reliable": "Reliable", "suggestive": "Suggestive", "no_edge": "No edge", "insufficient": "Too few"}
# spec §1.5, each verdict's definition from its first word after the dash (the headline quotes it).
VERDICT_DEFINITION = {
    "reliable": "at least ten overlap blocks, with the engine's 90% interval and adverse-share requirements met; "
                "zero counts as adverse.",
    "suggestive": "10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all "
                  "Reliable criteria are met.",
    "no_edge": "at least ten completed outcomes at this horizon, without Reliable evidence or a consistent nonzero "
               "excess-median sign across 5, 10 and 20 sessions.",
    "insufficient": "fewer than ten completed outcomes at this horizon.",
}
# spec §12.2 horizons[].reason (plan S-07): the engine's note, in words.
NOTE_WORDS = {
    "insufficient data": "no completed outcomes at this horizon",
    "too few blocks for an interval": "fewer than five independent blocks",
    "too few independent blocks to judge exclusion": "fewer than ten independent blocks; the interval is shown but not judged",
    "exclusion not established": "the interval clears zero but 3% or more of resampled medians are adverse",
}
GAPS_PREFIX = "calendar sessions without a value: "


def _response(r: env.Reply) -> Response:
    return Response(content=r.body, status_code=r.status_code, headers=r.headers, media_type=r.media_type)


def _now() -> datetime:
    """The response's calculation time (a function, so a test can freeze it)."""
    return datetime.now(timezone.utc)


# ── §12.13 deferred stubs: GET-only, awaiting at once ───────────────────────
# /basket/price is declared before /basket/{basket_id}, which would match it.

@router.get("/sectors")
def desk_sectors() -> Response:
    return _response(env.deferred("/sectors"))


@router.get("/vol")
def desk_vol() -> Response:
    return _response(env.deferred("/vol"))


@router.get("/positions")
def desk_positions() -> Response:
    return _response(env.deferred("/positions"))


@router.get("/basket/price")
def desk_basket_price() -> Response:
    return _response(env.deferred("/basket/price"))


@router.get("/basket/{basket_id}")
def desk_basket(basket_id: str) -> Response:
    return _response(env.deferred("/basket"))


@router.get("/hedge")
def desk_hedge() -> Response:
    return _response(env.deferred("/hedge"))


# ── §12.2 GET /study and §12.3 GET /study/catalog ───────────────────────────

@router.get("/study")
def desk_study(request: Request) -> Response:
    t0 = time.perf_counter()
    params = list(request.query_params.multi_items())
    return _response(env.answer("/study", lambda: study_answer(params, t0)))


@router.get("/study/catalog")
def desk_study_catalog(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/study/catalog", lambda: catalog_answer(params)))


@router.get("/study/events")
def desk_study_events(request: Request) -> Response:
    """§12.4: every retained event, newest first. `Accept: text/csv` answers
    the CSV; an answer that is not ready keeps its JSON envelope and status."""
    params = list(request.query_params.multi_items())
    reply = env.answer("/study/events", lambda: events_answer(params))
    if reply.status_code == 200 and "text/csv" in request.headers.get("accept", ""):
        data = json.loads(reply.body)["data"]
        if data is not None:
            return Response(content=events_csv(data["events"]).encode("utf-8"), status_code=200,
                            headers={"Cache-Control": "no-store"}, media_type="text/csv; charset=utf-8")
    return _response(reply)


def _item(slug: str) -> dict:
    """The generation's worker item for a catalog study (a lookup, never a computation)."""
    from api.worker import get_worker

    return get_worker().result(f"desk_study:{slug}")


def engine_alias(name: str) -> str | None:
    """A `preset` given as an engine slug that parses to a catalog study's query
    (spec §12.2, S-20): the catalog slug, or None. The engine is loaded by the
    worker's items already, so this costs a parse."""
    from api.desk import es

    try:
        q = es.validate(es.parse_slug(name))
    except (es.StudyError, ValueError, KeyError):
        return None
    for s in catalog.CATALOG:
        if s.engine_kwargs is not None and es.validate(es.Query(**s.engine_kwargs)) == q:
            return s.slug
    return None


def availability(study: catalog.Study) -> tuple[bool, dict | None]:
    """(available, unavailable) for a catalog row on this generation (§12.3, v4
    B-07): an RSI row never; a study whose item refused, with the engine's
    words; a study whose item failed, with the S-27 sentence (logged)."""
    if study.question is None:
        return False, env.unavailable(catalog.RSI_REASON)
    try:
        item = _item(study.slug)
    except Exception as exc:
        if env._route_level(exc):
            raise
        log.error("desk: catalog item %s failed", study.slug, exc_info=exc)
        return False, env.unavailable(env.BLOCK_FAILED_REASON)
    if item["ok"]:
        return True, None
    return False, env.unavailable(item["reason"])


def catalog_answer(params: list[tuple[str, str]]) -> dict:
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /study/catalog.")
    rows = []
    for s in catalog.CATALOG:
        available, unavailable = availability(s)
        rows.append({
            "slug": s.slug, "label": s.label, "short": s.short, "client_label": s.client_label,
            "available": available, "unavailable": unavailable,
            "question": s.question.as_dict() if s.question is not None else None,
            "allowed_horizons": list(s.allowed_horizons),
        })
    return {"studies": rows}


def study_answer(params: list[tuple[str, str]], t0: float) -> dict:
    study, h = catalog.normalize(params, "/study", resolve_alias=engine_alias)
    if h is None:  # a row with no horizons, asked without one (S-31)
        raise env.Awaiting(catalog.RSI_REASON)
    item = _item(study.slug)
    if not item["ok"]:
        raise env.Awaiting(item["reason"])
    hit, (payload, trace) = memo(("/study", study.slug, h), lambda: (study_projection(study, h, item), item["trace"]))
    out = dict(payload)
    out.update(now_fields(trace, cross=study.question.move.startswith("cross")))
    out["provenance"] = {**payload["provenance"], "engine_version": env.ENGINE_VERSION}
    out["served_from_cache"] = hit
    out["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return {k: out[k] for k in STUDY_KEYS}


@router.get("/ledger")
def desk_ledger(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/ledger", lambda: ledger_answer(params)))


@router.get("/technicals")
def desk_technicals(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/technicals", lambda: technicals_answer(params)))


# ── §12.7 GET /technicals ───────────────────────────────────────────────────

TECHNICALS_KEYS = ("price", "date", "freq", "source", "chg_1d", "chg_1d_dates", "ret_1y", "ret_1y_dates", "ma50",
                   "ma200", "ma50_window", "ma200_window", "vs_ma50", "vs_ma200", "trend", "cross", "move_20d_sigma",
                   "move_20d_date", "series", "signals_allowlist", "vol", "sectors")
SPX_SOURCE = "asset_prices ^GSPC"


def _technicals_item() -> dict:
    from api.worker import get_worker

    return get_worker().result("desk_technicals")


def move_20d() -> tuple[float | None, str | None]:
    """N4: the spx-20d-2sigma study's z on its evaluated_on, read from that
    item's own trace (nothing recomputed); both null when the study refused or
    has no evaluable session."""
    import numpy as np

    item = _item("spx-20d-2sigma")
    if not item["ok"] or item["trace"].z is None:
        return None, None
    tr = item["trace"]
    ev = np.flatnonzero(tr.evaluable)
    if not len(ev):
        return None, None
    z = float(tr.z[int(ev[-1])])
    return (z if math.isfinite(z) else None), tr.sessions[int(ev[-1])]


def technicals_answer(params: list[tuple[str, str]]) -> dict:
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /technicals.")
    item = _technicals_item()
    if not item["ok"]:
        raise env.Awaiting(item["reason"])
    sigma, sigma_date = move_20d()
    out = {**item, "freq": "daily", "source": SPX_SOURCE, "move_20d_sigma": sigma, "move_20d_date": sigma_date,
           "signals_allowlist": list(catalog.TECHNICALS_ALLOWLIST),
           "vol": env.block_deferred("/technicals", "vol"), "sectors": env.block_deferred("/technicals", "sectors")}
    return {k: out[k] for k in TECHNICALS_KEYS}


# ── §12.5 GET /ledger ───────────────────────────────────────────────────────

LEDGER_KEYS = ("slug", "label", "short", "group", "available", "unavailable", "horizon", "last_fired", "sample_start",
               "n", "up_n", "up_pct", "median", "baseline_median", "vs_normal", "target_unit", "display_unit", "verdict",
               "firing_now", "firing_day", "evaluated_on", "stale")
LEDGER_STATS = ("last_fired", "sample_start", "n", "up_n", "up_pct", "median", "baseline_median", "vs_normal",
                "target_unit", "display_unit", "verdict")


def vs_normal(delta: float | None, unit: str) -> float | None:
    """R3 (spec §1.9, v3 §6): the excess median in log pp for a log unit, bp for bp."""
    if delta is None:
        return None
    return delta if unit == "bp" else 100 * delta


def _ledger_static() -> list[tuple[dict, Any, bool]]:
    """The generation-dependent part of the twelve rows: (row, trace, cross)."""
    out = []
    for slug in catalog.LEDGER_ORDER:
        s = catalog.BY_SLUG[slug]
        available, unavailable = availability(s)
        row = {"slug": slug, "label": s.label, "short": s.short, "group": catalog.LEDGER_GROUP[slug],
               "available": available, "unavailable": unavailable, "horizon": 20, **{k: None for k in LEDGER_STATS}}
        if not available:
            out.append((row, None, False))
            continue
        item = _item(slug)
        native, table = item["native"], item["events"]
        by_h = {H["h"]: H for H in native["horizons"]}
        H = by_h[20]
        unit = registry.get(s.question.target).unit
        v = table.value[20]
        row.update(
            last_fired=table.sessions[int(table.event_idx[-1])] if len(table) else None,
            sample_start=native["provenance"]["sample_start"], n=H["n"],
            up_n=int(sum(1 for x in v if math.isfinite(x) and x > 0)),
            up_pct=H["hit_rate"], median=H["median"], baseline_median=H["baseline_median"],
            vs_normal=vs_normal(H["delta"], unit), target_unit=unit, display_unit=display_unit(unit),
            verdict=verdict_v1(by_h, 20))
        out.append((row, item["trace"], s.question.move.startswith("cross")))
    return out


def ledger_rows(comparison: str, prev: str) -> list[tuple[dict, dict | None]]:
    """The twelve Ledger rows with this response's firing state, and each
    row's firing detail (None for an unavailable row). An unavailable row's
    statistics and firing fields are null and it is not stale (S-19)."""
    _hit, static = memo(("/ledger",), _ledger_static)
    rows = []
    for base, trace, cross in static:
        row = dict(base)
        if trace is None:
            row.update(firing_now=None, firing_day=None, evaluated_on=None, stale=False)
            rows.append(({k: row[k] for k in LEDGER_KEYS}, None))
            continue
        f = firing_state(trace, comparison, prev, cross=cross)
        row.update(firing_now=f["firing_now"], firing_day=f["firing_day"], evaluated_on=f["evaluated_on"], stale=f["stale"])
        rows.append(({k: row[k] for k in LEDGER_KEYS}, f))
    return rows


def ledger_answer(params: list[tuple[str, str]]) -> dict:
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /ledger.")
    comparison, prev = sessions_now()
    rows = [r for r, _ in ledger_rows(comparison, prev)]
    scored = sum(1 for r in rows if r["available"])
    return {"verdict_rule": VERDICT_RULE, "horizon": 20, "comparison_session": comparison, "prev_session": prev,
            "scored_n": scored, "unavailable_n": len(catalog.LEDGER_ORDER) - scored, "signals": rows}


def fire_lists(entries: list[tuple[dict, dict | None]]) -> tuple[list[dict], list[dict]]:
    """N1's two lists over (row, firing detail) pairs (/overview's
    since_last_close): new_fires turned from false on prev_session to true on
    comparison_session, still_firing is true on both; a stale row, or one whose
    state on either session is null, is in neither."""
    new, still = [], []
    for row, f in entries:
        if f is None or f["stale"] or f["state_prev"] is None or f["state_comparison"] is None:
            continue
        ident = {"slug": row["slug"], "label": row["label"], "short": row["short"]}
        if f["state_comparison"] and not f["state_prev"]:
            new.append(ident)
        elif f["state_comparison"] and f["state_prev"]:
            still.append({**ident, "firing_day": f["firing_day"]})
    return new, still


def events_answer(params: list[tuple[str, str]]) -> dict:
    """§12.4 as JSON: the study's full event table, newest first (plan §2)."""
    study, h = catalog.normalize(params, "/study/events", resolve_alias=engine_alias)
    if h is None:  # a row with no horizons, asked without one (S-31)
        raise env.Awaiting(catalog.RSI_REASON)
    item = _item(study.slug)
    if not item["ok"]:
        raise env.Awaiting(item["reason"])
    _hit, rows = memo(("/study/events", study.slug), lambda: event_rows(item["events"]))
    return {"slug": study.slug, "events": rows}


def event_rows(table: Any) -> list[dict]:
    """Every row of the event table, newest first, in §12.4's fields."""
    rows = []
    for i in range(len(table) - 1, -1, -1):
        entry = int(table.entry_idx[i])
        row = {"event_date": table.sessions[int(table.event_idx[i])],
               "entry_date": table.sessions[entry] if entry >= 0 else None,
               "regime": table.regime[i]}
        for h in catalog.HORIZONS:
            exit_ = int(table.exit_idx[h][i])
            complete = exit_ >= 0
            row[f"exit_{h}"] = table.sessions[exit_] if complete else None
            row[f"value_{h}"] = float(table.value[h][i]) if complete else None
            row[f"complete_{h}"] = complete
        rows.append(row)
    return rows


EVENTS_CSV_COLUMNS = ("event_date", "entry_date", "regime",
                      *(c for h in catalog.HORIZONS for c in (f"exit_{h}", f"value_{h}", f"complete_{h}")))


def events_csv(rows: list[dict]) -> str:
    """§12.4's CSV: the columns in order, rows as served (newest first); a value
    is repr(float), the JSON's precision; a null is an empty cell; a boolean
    is true or false. No cell holds a comma or a quote, so none is quoted."""
    def cell(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, bool):
            return "true" if v else "false"
        return repr(v) if isinstance(v, float) else str(v)

    lines = [",".join(EVENTS_CSV_COLUMNS)] + [",".join(cell(r[c]) for c in EVENTS_CSV_COLUMNS) for r in rows]
    return "\n".join(lines) + "\n"


STUDY_KEYS = (
    "slug", "label", "short", "question", "selected_horizon", "matched_n", "data_start", "sample_start", "sample_end",
    "first_event", "last_event", "firing_now", "firing_day", "evaluated_on", "comparison_session", "prev_session",
    "stale", "verdict", "verdict_rule", "verdict_confidence", "headline", "why", "horizons", "by_regime",
    "unlabeled_n", "last_events", "without_condition", "provenance", "warnings", "series", "client", "empty_state",
    "inputs_hash", "served_from_cache", "elapsed_ms",
)


# ── The projection memo (plan §3) ───────────────────────────────────────────

_memo: "OrderedDict[tuple, Any]" = OrderedDict()
_memo_lock = threading.Lock()


def memo(key: tuple, build: Callable[[], Any]) -> tuple[bool, Any]:
    """(hit, value) for `key` on the request's generation. Entries of other
    generations are dropped as a new one arrives; at most MEMO_MAX are kept."""
    gid = env.generation_id(env._generation())
    full = (gid, *key, VERDICT_RULE, ADAPTER_SCHEMA)
    with _memo_lock:
        if full in _memo:
            _memo.move_to_end(full)
            return True, _memo[full]
    value = build()
    with _memo_lock:
        for k in [k for k in _memo if k[0] != gid]:
            del _memo[k]
        _memo[full] = value
        while len(_memo) > MEMO_MAX:
            _memo.popitem(last=False)
    return False, value


def clear_memo() -> None:
    with _memo_lock:
        _memo.clear()


# ── N1, the firing state (plan §1.11) ───────────────────────────────────────

def sessions_now(now: datetime | None = None) -> tuple[str, str]:
    """(comparison_session, prev_session): the last completed XNYS session at
    the response's calculation time, and the session before it (v4 B-05)."""
    cmp_ = nyse.last_completed_session(now or _now())
    return cmp_.isoformat(), nyse.previous_trading_day(cmp_).isoformat()


def firing_state(trace: Any, comparison: str, prev: str, *, cross: bool) -> dict:
    """A study's firing state from its signal trace: `fires = trigger and holds`
    per session (the raw trigger, before any cooldown; a cross only on its
    strict crossing session). `evaluated_on` is the last evaluable session and
    `firing_now` the state there; `firing_day` counts back from it while the
    session is evaluable and fires (1 for a cross), so a missing session ends
    the count; null unless firing. The state at a session is null when the
    session is not the run's or is not evaluable. `stale` when `evaluated_on`
    is not the comparison session."""
    import numpy as np

    ev = trace.evaluable
    fires = trace.trigger & trace.holds
    sessions = trace.sessions
    evaluable = np.flatnonzero(ev)
    if not len(evaluable):
        return {"evaluated_on": None, "firing_now": None, "firing_day": None, "stale": True,
                "state_comparison": None, "state_prev": None}
    last = int(evaluable[-1])
    firing_now = bool(fires[last])
    firing_day = None
    if firing_now:
        if cross:
            firing_day = 1
        else:
            i = last
            while i >= 0 and ev[i] and fires[i]:
                i -= 1
            firing_day = last - i

    def state(iso: str) -> bool | None:
        i = bisect.bisect_left(sessions, iso)
        return bool(fires[i]) if i < len(sessions) and sessions[i] == iso and ev[i] else None

    return {"evaluated_on": sessions[last], "firing_now": firing_now, "firing_day": firing_day,
            "stale": sessions[last] != comparison, "state_comparison": state(comparison), "state_prev": state(prev)}


def now_fields(trace: Any, *, cross: bool) -> dict:
    """The /study fields that depend on "now" (plan §0.5), for this response."""
    comparison, prev = sessions_now()
    f = firing_state(trace, comparison, prev, cross=cross)
    return {"firing_now": f["firing_now"], "firing_day": f["firing_day"], "evaluated_on": f["evaluated_on"],
            "comparison_session": comparison, "prev_session": prev, "stale": f["stale"]}


# ── The rules the spec states (plan §1.10) ──────────────────────────────────

def verdict_v1(by_h: dict[int, dict], h: int) -> str:
    """R1 (spec §1.5): fewer than ten completed outcomes is insufficient; the
    engine's exclusion "established" is reliable; finite excess medians at 5,
    10 and 20 all strictly positive or all strictly negative is suggestive;
    otherwise no edge. Zero, or a missing horizon, is not a lean."""
    H = by_h[h]
    if H["n"] < MIN_VERDICT_N:
        return "insufficient"
    if H.get("exclusion") == "established":
        return "reliable"
    deltas = [by_h.get(x, {}).get("delta") for x in (5, 10, 20)]
    if all(isinstance(d, (int, float)) and math.isfinite(d) for d in deltas) and (
            all(d > 0 for d in deltas) or all(d < 0 for d in deltas)):
        return "suggestive"
    return "no_edge"


def display_unit(unit: str) -> str:
    """R12 (spec §1.9)."""
    return "bp" if unit == "bp" else "percent"


def reason_words(note: str | None) -> str | None:
    """R13 (spec §12.2, S-07): the engine's note in words; no note is null."""
    if note is None:
        return None
    for prefix, words in NOTE_WORDS.items():
        if note == prefix or note.startswith(prefix + " ("):
            return words
    raise ValueError(f"an engine note with no words: {note!r}")


def num(x: float | None, unit: str) -> str:
    """A number in a served template (spec §12.2, S-08): the engine's fmt_move,
    then U+2212 for a negative's leading hyphen."""
    from src.desk.event_study import fmt_move

    s = fmt_move(x, unit)
    return "−" + s[1:] if s.startswith("-") else s


def share(x: float) -> str:
    return f"{x * 100:.1f}%"


# ── The /study projection (plan §1.2, §2) ───────────────────────────────────

def _series_list() -> list[dict]:
    """The registry's available tier-1 and tier-2 series with a role, in order (§12.2 `series`)."""
    ops = catalog.ops_by_shock()
    return [{"key": s.key, "label": s.label, "roles": list(s.roles), "ops": ops.get(s.key, []), "unit": s.unit}
            for s in registry.SERIES if s.available and s.roles and s.tier <= 2]


def served_warnings(provenance: dict, pre1970: dict[str, int]) -> list[str]:
    """The engine's warnings, verbatim, except its "calendar sessions without a
    value" entry: an input whose stored history starts before 1970 has its
    count qualified (plan §1.2, round 4's R-10). The native payload is never
    modified; the entry is rebuilt in the engine's exact format."""
    warnings = list(provenance["warnings"])
    gaps = {m["key"]: m["missing_sessions"] for m in provenance["inputs"] if m["missing_sessions"]}
    if not gaps or not any(pre1970.get(k) for k in gaps):
        return warnings
    engine = GAPS_PREFIX + ", ".join(f"{k} {v}" for k, v in sorted(gaps.items())) + "."
    served = GAPS_PREFIX + ", ".join(
        f"{k} {v}" + (f" (includes {pre1970[k]} pre-1970 holidays the engine calendar treats as sessions)"
                      if pre1970.get(k) else "")
        for k, v in sorted(gaps.items())) + "."
    if engine not in warnings:
        raise ValueError("the engine's missing-session warning is not where the adapter expects it")
    warnings[warnings.index(engine)] = served
    return warnings


def _extreme(table: Any, i: int, h: int) -> dict:
    return {"value": float(table.value[h][i]), "event_date": table.sessions[int(table.event_idx[i])],
            "entry_date": table.sessions[int(table.entry_idx[i])]}


def horizon_row(H: dict, table: Any, verdict: str) -> dict:
    """One §12.2 horizons[] row: the engine's statistics, the up count and the
    extrema projected from the event table (the earliest event on ties)."""
    import numpy as np

    h = H["h"]
    v = table.value[h]
    finite = np.flatnonzero(np.isfinite(v))
    f = v[finite]
    if len(f) != H["n"]:
        raise ValueError(f"the event table has {len(f)} completed outcomes at h {h}, the run {H['n']}")
    ci = H.get("ci90")
    worst = best = None
    if len(f):
        worst = _extreme(table, int(finite[int(np.argmin(f))]), h)
        best = _extreme(table, int(finite[int(np.argmax(f))]), h)
    return {
        "h": h, "label": HORIZON_LABEL[h], "n": H["n"], "up_n": int((f > 0).sum()), "n_incomplete": H["n_incomplete"],
        "n_blocks": H["n_blocks"], "baseline_n": H["baseline_n"],
        "up_pct": H["hit_rate"], "median": H["median"], "baseline_median": H["baseline_median"],
        "baseline_up_pct": H["baseline_hit_rate"],
        "ci_lo": ci[0] if ci else None, "ci_hi": ci[1] if ci else None,
        "adverse_share": H.get("opposite_sign_share") if ci else None,
        "draws": H["n_draws"], "method": METHOD[H["resampling"]], "reason": reason_words(H["note"]),
        "verdict": verdict, "worst": worst, "best": best,
    }


def why_sentence(row: dict, unit: str) -> str:
    """§12.2's `why` template over one horizon row."""
    head = f"{row['n']} completed outcomes in {row['n_blocks']} overlap blocks; "
    if row["ci_lo"] is None:
        return head + f"{row['reason']}."
    return head + (f"the 90% interval on the excess median runs {num(row['ci_lo'], unit)} to {num(row['ci_hi'], unit)}; "
                   f"{share(row['adverse_share'])} of resampled medians are adverse against a 3% bar.")


def study_projection(study: catalog.Study, h: int, item: dict) -> dict:
    """The generation-dependent part of a /study answer (what the memo holds)."""
    native, table = item["native"], item["events"]
    P = native["provenance"]
    if len(table) != P["n_events"]:
        raise ValueError(f"the event table has {len(table)} events, the run {P['n_events']}")
    by_h = {H["h"]: H for H in native["horizons"]}
    target = registry.get(study.question.target)
    unit = target.unit
    rows = [horizon_row(H, table, verdict_v1(by_h, H["h"])) for H in native["horizons"]]
    by_row = {r["h"]: r for r in rows}
    sel = by_row[h]
    verdict = sel["verdict"]
    k = len(table)
    year = P["sample_start"][:4]
    r20 = by_row[20]
    client = None
    if r20["n"]:
        client = {"horizon": 20, "headline": study.client_label,
                  "summary": (f"Looking at {P['n_events']} episodes since {year}, the {target.label} was higher a month "
                              f"later in {r20['up_n']} of {r20['n']}, with a typical move of {num(r20['median'], unit)} "
                              f"against {num(r20['baseline_median'], unit)} in an ordinary month.")}
    empty_state = None
    if sel["n"] < MIN_VERDICT_N:
        empty_state = {"horizon": h,
                       "sentence": (f"Only {sel['n']} events complete at {HORIZON_LABEL[h]} since {year}, fewer than "
                                    "the ten a verdict other than Too few needs."),
                       "fixes": catalog.fixes_for(study)}
    return {
        "slug": study.slug, "label": study.label, "short": study.short,
        "question": {**study.question.as_dict(), "horizon": h, "target_unit": unit, "display_unit": display_unit(unit)},
        "selected_horizon": h,
        "matched_n": P["n_events"],
        "data_start": P["data_start"], "sample_start": P["sample_start"], "sample_end": P["sample_end"],
        "first_event": table.sessions[int(table.event_idx[0])] if k else None,
        "last_event": table.sessions[int(table.event_idx[-1])] if k else None,
        "verdict": verdict, "verdict_rule": VERDICT_RULE, "verdict_confidence": P["ci"],
        "headline": f"{VERDICT_LABEL[verdict]} at {HORIZON_LABEL[h]}: {VERDICT_DEFINITION[verdict]}",
        "why": why_sentence(sel, unit),
        "horizons": rows,
        "by_regime": [{"h": 20, "regime": r["regime"], "n": c["n"], "up_pct": c["hit_rate"], "median": c["median"]}
                      for r in native["regimes"] if r["regime"] in catalog.REGIMES for c in r["horizons"] if c["h"] == 20],
        "unlabeled_n": P["n_unlabeled"],
        "last_events": [
            {"event_date": table.sessions[int(table.event_idx[i])],
             "entry_date": table.sessions[int(table.entry_idx[i])] if table.entry_idx[i] >= 0 else None,
             "regime": table.regime[i],
             "value_20": None if math.isnan(table.value[20][i]) else float(table.value[20][i])}
            for i in range(k - 1, max(-1, k - 6), -1)],
        "without_condition": env.block_deferred("/study", "without_condition"),
        "provenance": {"entry_rule": P["entry_rule"], "cooldown": P["cooldown_sessions"], "seed": P["seed"],
                       "engine_version": env.ENGINE_VERSION,
                       "series_start": {m["key"]: m["history_from"] for m in P["inputs"]}},
        "warnings": served_warnings(P, item.get("pre1970", {})),
        "series": _series_list(),
        "client": client,
        "empty_state": empty_state,
        "inputs_hash": P["inputs_hash"],
    }


# ── The enveloped 405 and the schema-check 503 ──────────────────────────────

def serves(path: str) -> bool:
    """Whether a request path is one of this router's routes. The 405's scope:
    under the built bundle the SPA catch-all turns any other POST under /api
    into a 405 as well, and those keep FastAPI's answer."""
    return any(r.path_regex.match(path) for r in router.routes if isinstance(r, APIRoute))


def _route(request: Request) -> str | None:
    """The enveloped route a request is for, or None when its path is not this router's."""
    path = request.url.path
    if not serves(path):
        return None
    route = env.route_of(path[len(PREFIX):])
    return route if route in env.ENVELOPED_ROUTES else None


def method_not_allowed(request: Request) -> Response | None:
    """The enveloped 405 for a write to an enveloped route, or None when the
    path is not this router's (the caller answers as FastAPI does)."""
    if _route(request) is None:
        return None
    return _response(env.method_not_allowed(request.method))


def schema_check_failed(request: Request, exc: Exception) -> Response | None:
    """The enveloped 503 `schema_check` for a failed provenance check that
    reached api/main.py's handler from a v2 route (raised outside `answer`,
    in a dependency or middleware; plan §3), or None elsewhere."""
    route = _route(request)
    if route is None:
        return None
    return _response(env.map_exception(route, exc))
