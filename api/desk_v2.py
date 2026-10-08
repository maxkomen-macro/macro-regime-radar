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
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.responses import Response

from api import calendar as nyse
from api import desk_catalog as catalog
from api import desk_envelope as env
# the one direction rule and the one recession band, shared with /regime (desk/frame-3-api-b2a)
from api.desk_items_macro import direction as _direction, recession_band
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

@router.get("/vol")
def desk_vol() -> Response:
    return _response(env.deferred("/vol"))


@router.get("/positions")
def desk_positions() -> Response:
    return _response(env.deferred("/positions"))


@router.get("/basket/price")
def desk_basket_price(request: Request) -> Response:
    """§12.15: a basket kept in the browser, priced from EODHD's daily bars (api/desk_basket.py)."""
    from api import desk_basket

    return _response(env.answer("/basket/price", lambda: desk_basket.price(list(request.query_params.multi_items()))))


@router.get("/basket/hedge")
def desk_basket_hedge(request: Request) -> Response:
    """§12.16: the ETF hedge for a basket kept in the browser, ranked by fit, and the linear stress test."""
    from api import desk_basket

    return _response(env.answer("/basket/hedge", lambda: desk_basket.hedge(list(request.query_params.multi_items()))))


@router.get("/basket/shares")
def desk_basket_shares(request: Request) -> Response:
    """§12.18 (desk/cap-weight): the stored share counts, so the page knows which baskets can be cap-weighted."""
    from api import desk_basket

    return _response(env.answer("/basket/shares", lambda: desk_basket.shares(list(request.query_params.multi_items()))))


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
    B-07): a study whose item refused, with the engine's words; a study whose
    item failed, with the S-27 sentence (logged)."""
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
    # Codex R-05: the builder's series come with the catalog, so a question that fails or is not served
    # leaves its Shock and "What happens to" slots editable; the same list /study serves.
    return {"studies": rows, "series": _series_list()}


# ── desk/usability §14.3: any well-formed question, computed on request ─────

MOVE_SIGN = {"up2s": "+2σ", "down2s": "−2σ"}
CLIENT_MOVE = {"up2s": "jumps", "down2s": "falls sharply"}
CLIENT_SPAN = {5: "within a week", 20: "over a month", 60: "over three months"}


def _label(key: str) -> str:
    spec = registry.BY_KEY.get(key)
    return spec.label if spec is not None else key


def question_label(q: catalog.Question) -> str:
    """A question outside the catalog in the catalog's style: "Gold +2σ, 60 days → S&P 500"."""
    cond = "" if q.while_ == "none" else (" while the S&P is below its 50-day" if q.while_ == "spx_below_50"
                                          else f", in {q.while_.split(':', 1)[1]}")
    return f"{_label(q.shock)} {MOVE_SIGN[q.move]}, {q.window} days{cond} → {_label(q.target)}"


def question_short(q: catalog.Question) -> str:
    return f"{_label(q.shock)} {MOVE_SIGN[q.move]} {q.window}d → {_label(q.target)}"


def question_client(q: catalog.Question) -> str:
    """The Client view's title in plain words (§11: no σ, no engine terms)."""
    regime = q.while_.split(":", 1)[1] if q.while_.startswith("regime:") else ""
    cond = "" if q.while_ == "none" else (", while the S&P 500 is below its 50-day average" if q.while_ == "spx_below_50"
                                          else f", in {'an' if regime[:1] in 'AEIOU' else 'a'} {regime} economy")
    return f"{_label(q.shock)} {CLIENT_MOVE[q.move]} {CLIENT_SPAN[q.window]}{cond}, and what the {_label(q.target)} does next"


def named(study: catalog.Study) -> catalog.Study:
    """A catalog row as it is; a question outside the catalog with its engine
    slug (a permalink the engine parses back) and its words."""
    if study.slug:
        return study
    from dataclasses import replace

    from api.desk import es

    q = study.question
    return replace(study, slug=es.slug_for(es.Query(**study.engine_kwargs)), label=question_label(q),
                   short=question_short(q), client_label=question_client(q))


def study_item(study: catalog.Study) -> dict:
    """A catalog study's worker item (a lookup); any other question computed on
    request against the request's generation through api/desk.py's pool and
    cache (computing past its wait, busy when the queue is full)."""
    if study.slug in catalog.BY_SLUG:
        return _item(study.slug)
    from api import desk as desk_mod

    try:
        item = desk_mod.traced_result(desk_mod.es.Query(**study.engine_kwargs), env._generation())
    except desk_mod.QueueFull as exc:
        raise env.Busy(f"{desk_mod.CACHE_MAX} studies are computing; retry in a few seconds.") from exc
    if item is None:
        raise env.Computing()
    return item


def study_answer(params: list[tuple[str, str]], t0: float) -> dict:
    study, h = catalog.normalize(params, "/study", resolve_alias=engine_alias, allow_any=True)
    study = named(study)
    item = study_item(study)
    if not item["ok"]:
        raise env.Awaiting(item["reason"])
    hit, (payload, trace) = memo(("/study", study.slug, h), lambda: (study_projection(study, h, item), item["trace"]))
    out = dict(payload)
    out.update(now_fields(trace, cross=study.question.move.startswith("cross"), allowance=publication_allowance(study)))
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


@router.get("/sectors")
def desk_sectors(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/sectors", lambda: sectors_answer(params)))


@router.get("/overview")
def desk_overview(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/overview", lambda: overview_answer(params)))


# ── §12.17 GET /instruments (desk/usability) ───────────────────────────────

@router.get("/instruments")
def desk_instruments(request: Request) -> Response:
    params = list(request.query_params.multi_items())
    return _response(env.answer("/instruments", lambda: instruments_answer(params)))


def instruments_answer(params: list[tuple[str, str]]) -> dict:
    """The instruments this store prices from its own daily closes: the list
    the Desk's instrument search falls back to when the upstream search does
    not answer (a lookup of the generation's item)."""
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /instruments.")
    item = _result("desk_instruments")
    return {"instruments": item["instruments"], "excluded": item.get("excluded", [])}


# ── §12.1 GET /overview ─────────────────────────────────────────────────────

REGIMES_SOURCE = "regimes table (src/regime.py)"
VIX_SOURCE = "asset_prices ^VIX"
# N9: the Desk feed set, by series id, in the plan's order; the four FRED inputs, then the three closes
# (the VIX joined the closes when it moved to asset_prices, desk/fill-compute)
DATA_STATUS_FRED = ("T10Y2Y", "BAMLH0A0HYM2", "DGS2", "DGS10")
DATA_STATUS_PRICES = ("^GSPC", "GC=F", "^VIX")
STATE_RANK = {"current": 0, "stale": 1, "missing": 2}


def _result(name: str) -> Any:
    from api.worker import get_worker

    return get_worker().result(name)


def _month_before(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7]) - 1
    return f"{y - 1:04d}-12" if m == 0 else f"{y:04d}-{m:02d}"


def regime_run(rows: list[dict], print_month: str) -> tuple[int, str]:
    """R9 (spec §12.1, S-14): the run of equal labels in consecutive stored
    months ending at `print`; a missing month ends the run. (months_in, since)."""
    by = {r["month"]: r for r in rows}
    label = by[print_month]["label"]
    since, n = print_month, 1
    while True:
        prev = _month_before(since)
        if prev not in by or by[prev]["label"] != label:
            return n, since
        since, n = prev, n + 1


def regime_tile(rows: list[dict], classifier: dict | None = None) -> dict:
    """tiles.regime (fix/freshness 3a, D2): the newest stored regimes row, the
    label and month the Dashboard shows, with its classifier odds; awaiting
    when nothing is stored or either stored slope is not finite."""
    from api.desk_v2_macro import odds_for

    if not rows:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    row = rows[-1]
    month = row["month"]
    growth, inflation = _direction(row["growth_trend"]), _direction(row["inflation_trend"])
    if growth is None or inflation is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    months_in, since = regime_run(rows, month)
    return {"label": row["label"], "print": month, "growth": growth, "inflation": inflation,
            "months_in": months_in, "since": since, "odds": odds_for(row, classifier), "freq": "monthly",
            "source": REGIMES_SOURCE}


def regime_since(item: dict, prev_session: str) -> tuple[str | None, str | None, bool | None]:
    """since_last_close's regime (fix/freshness 3a): (from, to, changed) for
    the newest stored row, the one the tile shows. It changed since the last
    close when the store learned it (`newest_known_at`, the later CPI and
    INDPRO watermark advance) after the previous session's close; then `from`
    is the row before it. Unknown publication: `to` alone, `changed` null."""
    from api import calendar as cal

    rows = item["rows"]
    if not rows:
        return None, None, None
    to = rows[-1]["label"]
    known = _rfc3339(item.get("newest_known_at"))
    if known is None:
        return None, to, None
    bounds = cal.session_bounds(date.fromisoformat(prev_session))
    prev_close = bounds[1].strftime("%Y-%m-%dT%H:%M:%SZ") if bounds else f"{prev_session}T23:59:59Z"
    if known <= prev_close:
        return to, to, False
    before = rows[-2]["label"] if len(rows) > 1 else None
    return before, to, None if before is None else before != to


def recession_tile(regime_item: dict) -> dict:
    """tiles.recession: the seven tile fields of the one recession block the
    desk_regime item holds, which /regime serves whole (the score, its N5
    provenance, R4's band); awaiting with its reason when the block could not
    be built (the model has no data)."""
    part = regime_item["recession"]
    if not part.get("ok"):
        raise env.Awaiting(part["reason"])
    data = part["data"]
    return {k: data[k] for k in ("score", "probability_month", "inputs_through", "band", "band_edges", "freq", "source")}


def trend_tile() -> dict:
    t = _technicals_item()
    if not t["ok"]:
        raise env.Awaiting(t["reason"])
    return {"state": t["trend"]["state"], "above_50": t["above_50"], "above_200": t["above_200"],
            "state_since": t["trend"]["state_since"], "cross": t["cross"], "date": t["date"], "freq": "daily",
            "source": SPX_SOURCE}


# The home page's VIX words and edges (web/src/screens/dashboard/DashboardScreen.tsx: under 15 calm,
# under 25 subdued, else stressed; src/analytics/volatility.py's 15 / 25 edges), on the tile's VIX.
VIX_BAND_EDGES = (15.0, 25.0)


def vix_band(vix: float) -> str:
    """spec §12.1 (desk/fill-compute): calm < 15 ≤ subdued < 25 ≤ stressed."""
    lo, hi = VIX_BAND_EDGES
    return "calm" if vix < lo else ("subdued" if vix < hi else "stressed")


def vol_tile(facts: dict) -> dict:
    sid = registry.get("vix").series_id
    vix = facts["newest"].get(sid)
    if vix is None:
        # A store its next full refresh reaches (^VIX, desk/fill-compute) says so, in the engine's words.
        raise env.Awaiting(facts.get("awaiting", {}).get(sid) or env.BLOCK_FAILED_REASON)
    return {"vix": vix["value"], "date": vix["date"], "freq": "daily", "source": VIX_SOURCE,
            "band": vix_band(vix["value"]), "band_edges": list(VIX_BAND_EDGES), "gap": facts.get("vol_gap")}


def active_signals(rows: list[dict]) -> list[dict]:
    """R6 (spec §12.1, v2 §19, S-18): the available rows firing now and not
    stale, and the five rows with the latest non-null last_fired, once each;
    firing first, then last_fired descending, then slug."""
    firing = {r["slug"] for r in rows if r["available"] and r["firing_now"] and not r["stale"]}
    recent = sorted((r for r in rows if r["last_fired"]), key=lambda r: (r["last_fired"], r["slug"]), reverse=True)
    chosen = firing | {r["slug"] for r in recent[:5]}
    picked = [r for r in rows if r["slug"] in chosen]
    picked.sort(key=lambda r: r["slug"])
    picked.sort(key=lambda r: r["last_fired"] or "", reverse=True)
    picked.sort(key=lambda r: r["slug"] not in firing)
    return picked


def _rfc3339(stamp: str | None) -> str | None:
    from api.freshness import _parse_dt

    d = _parse_dt(stamp)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def data_status(*, now: datetime, stored: dict | None, watermarks: dict | None, prices: dict[str, str | None]) -> dict:
    """N9 (v4 B-06, C-02, S-23): each contributor through its existing policy.
    The FRED inputs by api/freshness.desk_series_states (close → current, stale
    → stale, unknown → missing), expected on _daily_expected_and_lag's date;
    ^GSPC, GC=F and ^VIX by api/freshness.assess's asset_prices rule applied to the
    symbol's own newest row (current and delayed → current, stale → stale,
    unstored → missing), expected on that rule's session. The state is the
    worst contributor: missing, then stale, then current."""
    from api import calendar as cal
    from api import desk as desk_mod
    from api import freshness as fr

    specs = {s["id"]: s for s in desk_mod.desk_series_specs(stored)}
    rows = fr.desk_series_states(stored=stored, specs=[specs[sid] for sid in DATA_STATUS_FRED], watermarks=watermarks,
                                 now=now)
    by = {r["id"][len("desk:"):]: r for r in rows}
    today = now.astimezone(cal.NY).date()
    out = []
    for sid in DATA_STATUS_FRED:
        r = by[sid]
        expected, _lag = fr._daily_expected_and_lag(today, today, specs[sid].get("calendar") == "bond")
        out.append({"series": sid, "observation_date": (stored or {}).get(sid),
                    "expected_observation_date": expected.isoformat(),
                    "state": {"close": "current", "stale": "stale", "unknown": "missing"}[r["state"]], "reason": r["reason"]})
    for sym in DATA_STATUS_PRICES:
        d = prices.get(sym)
        sla = fr.assess(db_fresh={"asset_prices_date": d}, series_latest=[], relay=None, bootstrap=None, now=now,
                        watermarks=watermarks)["sla"]
        row = next(x for x in sla if x["feed"] == "asset_prices")
        state = "missing" if d is None else {"current": "current", "delayed": "current", "stale": "stale"}[row["verdict"]]
        out.append({"series": sym, "observation_date": d, "expected_observation_date": row["expected"], "state": state,
                    "reason": row["reason"]})
    return {"state": max((c["state"] for c in out), key=STATE_RANK.__getitem__), "contributors": out}


def oldest_behind(status: dict) -> dict | None:
    """fix/freshness 3d: the Desk series that is behind with the oldest
    observation (a missing one first), from the data-status contributors (the
    Desk's feed set, N9, each judged by its own freshness policy); None when
    every one is current."""
    behind = [c for c in status.get("contributors", []) if c.get("state") != "current"]
    if not behind:
        return None
    c = min(behind, key=lambda c: (c.get("observation_date") or "", c["series"]))
    return {"series": c["series"], "observation_date": c.get("observation_date"), "state": c["state"],
            "reason": c.get("reason") or ""}


def overview_answer(params: list[tuple[str, str]]) -> dict:
    """§12.1, composed from the Ledger, the technicals, regime and recession
    items and the stored facts of the request's one generation; every field
    that depends on now is computed for this response."""
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /overview.")
    from api import db

    now = _now()
    comparison, prev = sessions_now(now)
    entries = ledger_rows(comparison, prev, close_grace(comparison, now), now)
    rows = [r for r, _ in entries]

    def status() -> dict:
        newest = _result("desk_facts")["newest"]
        prices = {sym: (newest.get(sym) or {}).get("date") for sym in DATA_STATUS_PRICES}
        return data_status(now=now, stored=db.freshness()["desk_series_latest"], watermarks=db.watermarks(), prices=prices)

    def since_last_close() -> dict:
        new, still = fire_lists(entries)
        r_from, r_to, changed = regime_since(_result("desk_regime"), prev)
        vix = _result("desk_facts")["vix_recent"]
        wm = (db.watermarks() or {}).get("desk_series") or {}
        try:
            behind = oldest_behind(status())
        except Exception:  # noqa: BLE001 — the data_status block reports its own failure; this line stands
            behind = None
        return {
            "comparison_session": comparison, "prev_session": prev, "new_fires": new, "still_firing": still,
            "vol_change_pts": vix[comparison] - vix[prev] if comparison in vix and prev in vix else None,
            "regime_from": r_from, "regime_to": r_to, "regime_changed": changed,
            # fix/freshness 3d: when the full refresh last ran the Desk store (the summary watermark's checked_at,
            # the Data Pipeline's last refresh), not its advanced_at, which moves only when the laggard series does.
            "refreshed_at_utc": _rfc3339(wm.get("checked_at")),
            "oldest_behind": behind,
        }

    return {
        "since_last_close": env.block_from("/overview", "since_last_close", since_last_close),
        "tiles": {
            "regime": env.block_from("/overview", "tiles.regime",
                                     lambda: regime_tile(_result("desk_regime")["rows"], _result("desk_regime").get("classifier"))),
            "recession": env.block_from("/overview", "tiles.recession", lambda: recession_tile(_result("desk_regime"))),
            "trend": env.block_from("/overview", "tiles.trend", trend_tile),
            "vol": env.block_from("/overview", "tiles.vol", lambda: vol_tile(_result("desk_facts"))),
        },
        "active_signals": active_signals(rows),
        "data_status": env.block_from("/overview", "data_status", status),
    }


# ── §12.7 GET /technicals ───────────────────────────────────────────────────

TECHNICALS_KEYS = ("symbol", "name", "scored", "price", "date", "freq", "source", "chg_1d", "chg_1d_dates", "ret_1y",
                   "ret_1y_dates", "ma50", "ma200", "ma50_window", "ma200_window", "vs_ma50", "vs_ma200", "trend", "cross",
                   "move_20d_sigma", "move_20d_date", "rsi", "rsi_date", "rsi_prev", "rsi_prev_date", "rsi_last_above_70",
                   "rsi_last_below_30", "macd", "seasonality", "series", "drawdown", "realized_vol", "rs",
                   "excluded_bars", "unadjusted_bars", "signals_allowlist", "vol", "sectors")
SPX_SOURCE = "asset_prices ^GSPC"
# desk/usability item 2: the spellings that name the S&P 500 itself, the page's default.
SPX_SYMBOLS = frozenset({"^GSPC", "GSPC", "SPX", "^SPX", "GSPC.INDX"})
CANDLES_SOURCE = "EODHD daily candles (2Y), split- and dividend-adjusted"
STOCK_RANGES = {"6m": 6, "1y": 12}  # two years of daily bars carry the 200-day average across a year's chart


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


def technicals_symbol(params: list[tuple[str, str]]) -> str | None:
    """The one `symbol` parameter (desk/usability item 2), upper-cased; None
    for the S&P 500 itself, the page's default. Any other parameter, or a
    repeated one, is refused."""
    symbol = None
    for i, (key, value) in enumerate(params):
        if key != "symbol":
            raise env.Unsupported(f"{key} is not a parameter of /technicals.")
        if i:
            raise env.Unsupported("symbol is given more than once.")
        symbol = value.strip().upper()
    if not symbol:
        if params:
            raise env.Unsupported("symbol is empty.")
        return None
    return None if symbol in SPX_SYMBOLS else symbol


def technicals_answer(params: list[tuple[str, str]]) -> dict:
    """§12.7 for the S&P 500 (a lookup), or desk/usability's §14.2 for any
    US-listed stock or ETF: a stored ETF is a lookup of the instruments item;
    any other symbol reads two years of EODHD daily candles (the provider
    cache holds them) and runs the same technicals function, its relative
    strength against the stored S&P of the request's generation."""
    symbol = technicals_symbol(params)
    item = _technicals_item()
    if symbol is None:
        if not item["ok"]:
            raise env.Awaiting(item["reason"])
        sigma, sigma_date = move_20d()
        out = {**item, "symbol": "^GSPC", "name": "S&P 500", "scored": True, "freq": "daily", "source": SPX_SOURCE, "excluded_bars": None, "unadjusted_bars": None,
               "move_20d_sigma": sigma, "move_20d_date": sigma_date, "rs": None,
               "signals_allowlist": list(catalog.TECHNICALS_ALLOWLIST),
               "vol": env.block_deferred("/technicals", "vol"),
               # desk/fill-etf: the sector leadership /sectors serves, from the same item (§12.7, §12.14)
               "sectors": etf_block("/technicals", "sectors", "sectors")}
        return {k: out[k] for k in TECHNICALS_KEYS}
    stored = _result("desk_instruments")
    names = {r["symbol"]: r["name"] for r in stored["instruments"]}
    if symbol in stored.get("technicals", {}):
        t, name, source = stored["technicals"][symbol], names[symbol], f"asset_prices {symbol}"
    else:
        t, name = stock_technicals(symbol, item.get("_level") if item.get("ok") else None)
        source = CANDLES_SOURCE
    # desk/usability §14.2: a stock's page reads its own figures and main's shared RSI, MACD and seasonality for it;
    # the S&P-only parts (the scored signals, the options) are not a stock's, and its sector bars are the index's.
    out = {"excluded_bars": None, "unadjusted_bars": None, **t, "symbol": symbol, "name": name, "scored": False, "freq": "daily", "source": source,
           "move_20d_sigma": None, "move_20d_date": None, "signals_allowlist": [],
           "vol": env.block_deferred("/technicals", "vol"),
           "sectors": etf_block("/technicals", "sectors", "sectors")}
    return {k: out[k] for k in TECHNICALS_KEYS}


def stock_technicals(symbol: str, bench: Any) -> tuple[dict, str]:
    """A US-listed stock's technicals from two years of EODHD daily candles
    (the dashboard's /api/market/candles, range 2Y) and its name from the
    search index, or a refusal: a symbol that is not a US equity or ETF is
    422 `unsupported`; a provider failure is its typed error (map_exception).
    The figures are the shared ones (api/desk_items.technicals_from_level):
    main's averages, RSI, MACD and seasonality, and desk/usability's drawdown,
    realized volatility and relative strength.

    Codex R-03: only bars dated at or before the last completed NYSE session
    (api/calendar, as of the request) are read; a bar after it (today's while
    the session is open, or one dated in the future) is dropped before any
    technical is computed, and `excluded_bars` says how many and after what.

    Adjusted closes only, as Basket & Hedge reads them (desk/books' Codex
    R-07): a bar EODHD served without an adjusted close carries its raw close,
    which would mix unadjusted prices into every return, so it is left out and
    `unadjusted_bars` says how many; a symbol with no adjusted close at all is
    refused (502 `provider`)."""
    import pandas as pd

    from api.desk_items import technicals_from_level
    from api.providers import market
    from api.providers.symbols import SymbolError, parse
    from src.desk.technicals import PRICE_SPEC

    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise env.Unsupported(str(exc)) from exc
    if not inst.is_us_equity:
        raise env.Unsupported(f"Technicals read US-listed stocks and ETFs; {symbol} is not one.")
    candles = market.candles(inst.canonical, "2Y")
    closes: dict[str, float] = {}
    unadjusted = 0
    for b in candles["bars"]:
        c = b.get("close")
        if not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
            continue
        if b.get("adjusted") is not True:
            unadjusted += 1
            continue
        closes[b["ts"][:10]] = float(c)
    if not closes and unadjusted:
        raise env.Refused(502, "provider", f"{symbol}: EODHD served no adjusted closes; technicals read adjusted closes only.")
    asof = nyse.last_completed_session(_now()).isoformat()
    after = sorted(d for d in closes if d > asof)
    pairs = sorted((d, c) for d, c in closes.items() if d <= asof)
    if not pairs:
        raise env.Awaiting(f"EODHD holds no daily closes for {symbol} through {asof}, the last completed session.")
    level = pd.Series([c for _, c in pairs], index=pd.DatetimeIndex([d for d, _ in pairs]))
    out = technicals_from_level(level, spec=PRICE_SPEC, ranges=STOCK_RANGES, bench=bench, source=CANDLES_SOURCE)
    out.pop("_sessions")
    out["excluded_bars"] = {"n": len(after), "after": asof} if after else None
    out["unadjusted_bars"] = {"n": unadjusted} if unadjusted else None
    name = (market._identity(inst) or {}).get("name") or symbol
    return out, name


# ── §12.14 GET /sectors (desk/fill-etf) ─────────────────────────────────────

def etf_block(route: str, path: str, part: str) -> dict:
    """One part of the desk_etf item as a block of `route`: ready with its
    data, awaiting with the reason it was refused on this generation, and
    awaiting with the S-27 sentence when the item itself failed, so the rest
    of the answer stands (§12.0)."""
    def data() -> Any:
        value = _result("desk_etf")[part]
        if not value.get("ok"):
            raise env.Awaiting(value["reason"])
        return value["data"]

    return env.block_from(route, path, data)


def sectors_answer(params: list[tuple[str, str]]) -> dict:
    """§12.14: the leadership part of the desk_etf item, with breadth as its
    own block (the item's breadth part); the route is awaiting, with the
    reason, when leadership could not be computed on this generation (the ETFs
    not stored yet)."""
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /sectors.")
    value = _result("desk_etf")["sectors"]
    if not value.get("ok"):
        raise env.Awaiting(value["reason"])
    return {**value["data"], "breadth": etf_block("/sectors", "breadth", "breadth")}


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


def ledger_rows(comparison: str, prev: str, grace: int = 0, now: datetime | None = None) -> list[tuple[dict, dict | None]]:
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
        f = firing_state(trace, comparison, prev, cross=cross, allowance=publication_allowance(catalog.BY_SLUG[row["slug"]]),
                         grace=grace, now=now)
        row.update(firing_now=f["firing_now"], firing_day=f["firing_day"], evaluated_on=f["evaluated_on"], stale=f["stale"])
        rows.append(({k: row[k] for k in LEDGER_KEYS}, f))
    return rows


def ledger_answer(params: list[tuple[str, str]]) -> dict:
    if params:
        raise env.Unsupported(f"{params[0][0]} is not a parameter of /ledger.")
    now = _now()
    comparison, prev = sessions_now(now)
    rows = [r for r, _ in ledger_rows(comparison, prev, close_grace(comparison, now), now)]
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
    study, h = catalog.normalize(params, "/study/events", resolve_alias=engine_alias, allow_any=True)
    study = named(study)
    item = study_item(study)
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
    "stale", "stale_inputs", "verdict", "verdict_rule", "verdict_confidence", "headline", "why", "horizons", "by_regime",
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


def close_grace(comparison: str, now: datetime) -> int:
    """fix/site-audit D4: the sessions an exchange close may trail the
    comparison session by while that session's close is not yet due in the
    store. The comparison session turns at the bell
    (calendar.last_completed_session), but only the evening full refresh
    stores its close; until that refresh's deadline
    (api/freshness.close_grace_until: 06:00 UTC the next day, the rule
    /overview's data status and the Data status drawer already apply) a study
    through the session before is current, so 1; after it 0, and a close
    still missing then is stale. On a trading day T, for a study whose inputs
    are exchange closes, the Ledger's NOW cell reads:
      pre-open and mid-session  T−1 is the comparison session and its close is
                                stored: "● Firing · day n" or "○ Quiet" (as
                                of T−1); if the refresh after T−1's close has
                                still not landed, "○ Stale · T−2".
      after the close           T is the comparison session; until the evening
                                refresh lands the row reads its T−1 state
                                ("● Firing · day n" / "○ Quiet", evaluated on
                                T−1), then its T state.
      from 06:00 UTC on T+1     with T's close still missing: "○ Stale · T−1".
    """
    from datetime import date as _date

    from api import freshness as fr

    return 1 if now < fr.close_grace_until(_date.fromisoformat(comparison)) else 0


def publication_allowance(study: catalog.Study) -> int:
    """desk/fill-compute (owner's item 7): the XNYS sessions a study's
    evaluated_on may trail the comparison session and still be current, by
    its inputs' publication cadence: the most any input allows. A close the
    exchange prints (asset_prices, market: ^GSPC, GC=F, ^VIX, ^NDX, the dollar,
    USD/JPY) allows none; a FRED daily series api/freshness.DAILY_TOLERANCE
    (3: FRED posts a day or more after the close); a series published less
    often its own tolerance (api/freshness.DESK_SLOW_PUBLICATION: WTI, 8)."""
    from api import desk_pipeline
    from api import freshness as fr

    out = 0
    for key in desk_pipeline.CATALOG_INPUTS.get(study.slug, ()):
        spec = registry.get(key)
        if spec.source == "fred":
            slow = fr.DESK_SLOW_PUBLICATION.get(spec.series_id, {})
            out = max(out, int(slow.get("tolerance", fr.DAILY_TOLERANCE)))
    return out


def input_rule(key: str) -> tuple[str, int]:
    """Codex R-03: one input's own publication calendar and tolerance. An
    exchange close (asset_prices, market) is due on the XNYS session itself,
    no grace; a FRED daily series within `api/freshness.DAILY_TOLERANCE`
    business days on its own calendar (the bond market's for rates and
    spreads, api/freshness.DESK_REFRESH_SERIES); a slower one its own
    tolerance (DESK_SLOW_PUBLICATION: WTI, 8)."""
    from api import freshness as fr

    spec = registry.get(key)
    if spec.source != "fred":
        return "nyse", 0
    meta = fr.DESK_REFRESH_SERIES.get(spec.series_id, {})
    slow = fr.DESK_SLOW_PUBLICATION.get(spec.series_id, {})
    return meta.get("calendar", "nyse"), int(slow.get("tolerance", fr.DAILY_TOLERANCE))


def inputs_behind(inputs: list[dict], comparison: str, grace: int = 0, now: datetime | None = None) -> list[dict]:
    """Each input judged on its own calendar and tolerance against the
    comparison session: how many of its business days its newest VALIDATED
    observation trails the comparison session by (Codex R-03, round 2: the
    engine's trace, `SignalTrace.inputs_last`, after alignment and validation,
    never the newest raw row, so a stored close of −1 is not a fresh close),
    and whether that is more than its tolerance, or than `grace` when that is
    larger (close_grace: the session that just closed, before the evening
    refresh's deadline; fix/site-audit D4). A FRED input's lag is the
    drawer's (fix/site-audit D7: api/freshness._daily_expected_and_lag, the
    newest print due being the business day before today in New York), so
    an input current in the Data status drawer is current here: after the
    bell the comparison session is today, whose FRED print posts tomorrow.
    Without `now` the newest print due is the comparison session. An input
    with no validated observation is stale."""
    from datetime import date as _date

    from api import freshness as fr

    out = []
    cmp_ = _date.fromisoformat(comparison)
    today = now.astimezone(nyse.NY).date() if now is not None else cmp_ + timedelta(days=1)
    for m in inputs:
        calendar, tolerance = input_rule(m["key"])
        if m.get("last") is None:
            out.append({"key": m["key"], "last": None, "calendar": calendar, "lag": None, "tolerance": tolerance, "stale": True})
            continue
        last = _date.fromisoformat(str(m["last"])[:10])
        if registry.get(m["key"]).source == "fred":
            _due, lag = fr._daily_expected_and_lag(last, today, calendar == "bond")
        else:
            between = nyse.bond_business_days_between if calendar == "bond" else nyse.business_days_between
            lag = between(last, cmp_)
        out.append({"key": m["key"], "last": last.isoformat(), "calendar": calendar, "lag": lag, "tolerance": tolerance,
                    "stale": lag > max(tolerance, grace)})
    return out


def fred_anchor_offset(comparison: str, now: datetime | None) -> int:
    """XNYS sessions from the newest FRED print due (the drawer's anchor,
    api/freshness._daily_expected_and_lag) to the comparison session: 1 after
    the bell on a trading day (that session's FRED print posts tomorrow), else
    0, and 0 without `now`. A study whose allowance is a FRED publication lag
    counts it from that anchor (fix/site-audit D7)."""
    if now is None:
        return 0
    from api import freshness as fr

    cmp_ = date.fromisoformat(comparison)
    due, _lag = fr._daily_expected_and_lag(cmp_, now.astimezone(nyse.NY).date(), False)
    return nyse.business_days_between(due, cmp_)


def trace_inputs(trace: Any) -> list[dict]:
    """The study's inputs with their newest validated observation, from the
    engine's trace (`SignalTrace.inputs_last`)."""
    return [{"key": k, "last": d} for k, d in getattr(trace, "inputs_last", ())]


def sessions_behind(evaluated_on: str, comparison: str) -> int:
    """XNYS sessions after `evaluated_on` up to and including `comparison`."""
    from datetime import date as _date

    return nyse.business_days_between(_date.fromisoformat(evaluated_on), _date.fromisoformat(comparison))


def firing_state(trace: Any, comparison: str, prev: str, *, cross: bool, allowance: int = 0,
                 inputs: list[dict] | None = None, grace: int = 0, now: datetime | None = None) -> dict:
    """A study's firing state from its signal trace: `fires = trigger and holds`
    per session (the raw trigger, before any cooldown; a cross only on its
    strict crossing session). `evaluated_on` is the last evaluable session and
    `firing_now` the state there; `firing_day` counts back from it while the
    session is evaluable and fires (1 for a cross), so a missing session ends
    the count; null unless firing. The state at a session is null when the
    session is not the run's or is not evaluable. `stale` when `evaluated_on`
    trails the comparison session by more than `allowance` XNYS sessions (its
    inputs' publication cadence, desk/fill-compute: 0 for exchange closes), or
    is dated after it, or (Codex R-03) when any input's newest validated
    observation (`inputs`, by default the trace's own, `trace_inputs`) trails
    the comparison session by more than its own tolerance on its own calendar
    (`inputs_behind`), so a FRED series' grace never covers a stale exchange
    close. A stale study is never reported firing: `firing_now` false and
    `firing_day` null (Codex R-03, round 2). `grace` (close_grace, fix/site-audit
    D4) lets the study and its closes trail the comparison session by that many
    sessions while its close is not yet due in the store; `firing_now` is then
    the previous session's state, which the Desk dates ("● Fired Oct 6",
    fix/site-audit S-01) rather than calling it today's. `now` (D7) puts a
    FRED input and a FRED-limited allowance on the drawer's anchor
    (inputs_behind, fred_anchor_offset)."""
    import numpy as np

    ev = trace.evaluable
    fires = trace.trigger & trace.holds
    sessions = trace.sessions
    evaluable = np.flatnonzero(ev)
    if not len(evaluable):
        return {"evaluated_on": None, "firing_now": None, "firing_day": None, "stale": True, "stale_inputs": [],
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

    # Dated after the comparison session (a clock behind the data) is stale as before: never firing today.
    allowed = max(allowance + fred_anchor_offset(comparison, now) if allowance > 0 else 0, grace)
    stale = sessions[last] != comparison and (sessions[last] > comparison or sessions_behind(sessions[last], comparison) > allowed)
    stale_inputs = [m["key"] for m in inputs_behind(trace_inputs(trace) if inputs is None else inputs, comparison, grace, now)
                    if m["stale"]]
    stale = stale or bool(stale_inputs)
    if stale:
        firing_now, firing_day = False, None
    return {"evaluated_on": sessions[last], "firing_now": firing_now, "firing_day": firing_day,
            "stale": stale, "stale_inputs": stale_inputs,
            "state_comparison": state(comparison), "state_prev": state(prev)}


def now_fields(trace: Any, *, cross: bool, allowance: int = 0, inputs: list[dict] | None = None) -> dict:
    """The /study fields that depend on "now" (plan §0.5), for this response."""
    now = _now()
    comparison, prev = sessions_now(now)
    f = firing_state(trace, comparison, prev, cross=cross, allowance=allowance, inputs=inputs, grace=close_grace(comparison, now),
                     now=now)
    return {"firing_now": f["firing_now"], "firing_day": f["firing_day"], "evaluated_on": f["evaluated_on"],
            "comparison_session": comparison, "prev_session": prev, "stale": f["stale"], "stale_inputs": f["stale_inputs"]}


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
    """§12.2 `series`, as desk/usability §14.3 amends it: the registry's tier-1
    and tier-2 series with a role whose history this generation stores (the
    `desk_assets` item's status), in order, each with the moves the Event
    Study asks with it as the shock: a 2σ move either way, the S&P 500's own
    crosses, and any other move a catalog study asks with it (desk/fill-compute's
    RSI crossings). A series the store lacks is not offered at all.

    Rebase ruling (owner, 2026-09-28): the builder computes any well-formed
    question on request, so its list wins over desk/fill-etf's catalog-only
    filter (Codex R-03 there): a stored series with a role is offered even
    when no catalog study reads it, the sector ETFs included."""
    ops_catalog = catalog.ops_by_shock()
    try:
        assets = _result("desk_assets")
        stored = {r["key"] for r in [*assets["shocks"], *assets["targets"]] if r.get("status") == "stored"}
    except Exception as exc:  # a worker without the assets item (a test's) lists the registry's series
        if env._route_level(exc):
            raise
        stored = None

    def ops_of(s: Any) -> list[str]:
        base = (["up2s", "down2s"] + (["cross_above", "cross_below"] if s.key == "spx" else [])) if "shock" in s.roles else []
        return base + [m for m in ops_catalog.get(s.key, []) if m not in base]

    return [{"key": s.key, "label": s.label, "roles": list(s.roles), "ops": ops_of(s), "unit": s.unit}
            for s in registry.SERIES if s.available and s.roles and s.tier <= 2 and (stored is None or s.key in stored)]


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


# desk/usability §14.3: a question may target gold now, and the engine's entry rule for a deferred target says
# "never"; the Desk's language list keeps the word off the page, so the served copy says the same thing without it
# (as /pipeline serves the registry's gold note, api/desk_pipeline.DESK_WORDING). The native payload is untouched.
ENTRY_RULE_WORDING = (("so entry is never the event's own session", "so entry is a later session than the event's own"),)


def entry_rule_words(rule: str) -> str:
    for before, after in ENTRY_RULE_WORDING:
        rule = rule.replace(before, after)
    return rule


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
        "provenance": {"entry_rule": entry_rule_words(P["entry_rule"]), "cooldown": P["cooldown_sessions"], "seed": P["seed"],
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
