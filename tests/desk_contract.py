"""tests/desk_contract.py — DESK_FRAME3_SPEC §12 as data (desk/frame-3-api, B1).

Not a test module: the helper every Desk v2 endpoint test checks its answers
against (docs/desk/FRAME3_API_PLAN.md §5). It transcribes the folded §12
field tables, with the plan's §6 corrections as folded on desk/frame-3
(S-05 nullable entry dates, S-06 labels only, S-10 `prev_session` on /study,
S-19, …) and item 14's `client_label`, into one schema per route:

    path → (type, presence, nullable, enum)

plus the block paths and the date formats (YYYY-MM-DD, YYYY-MM, RFC 3339
with a zone). `check(route, body)` asserts:

- the envelope's seven fields and their state rules (§12.0);
- every required path is present, and no key exists outside the table
  (strict, so drift in either direction fails);
- a null only where the table allows one;
- enums and fixed values hold;
- block envelopes sit at exactly the listed paths and nowhere else;
- no NaN or Infinity, on the wire or in the value.

`check_response` adds the transport: the status code for the state, the
content type, `Cache-Control: no-store`, and `Retry-After: 2` on a 202.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

# ── The type language ───────────────────────────────────────────────────────

STR, INT, NUM, FRAC, BOOL, DATE, MONTH, TS = "str", "int", "num", "frac", "bool", "date", "month", "ts"
SCALARS = (STR, INT, NUM, FRAC, BOOL, DATE, MONTH, TS)


@dataclass(frozen=True)
class Enum:
    values: tuple


@dataclass(frozen=True)
class Const:
    value: Any


@dataclass(frozen=True)
class F:
    """A field: its type, whether null is allowed, whether it may be absent."""

    t: Any
    null: bool = False
    opt: bool = False


@dataclass(frozen=True)
class Obj:
    fields: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Arr:
    item: Any
    min: int = 0
    max: int | None = None


@dataclass(frozen=True)
class MapOf:
    value: Any


@dataclass(frozen=True)
class Block:
    """A block envelope (§12.0): ready with `data`, or awaiting with a reason."""

    data: Any


@dataclass(frozen=True)
class Deferred:
    """A block not served on Monday (§13.2): always awaiting, with this reason."""

    reason: str


def E(*values: Any) -> Enum:
    return Enum(tuple(values))


def null(t: Any) -> F:
    return F(t, null=True)


def obj(**fields: Any) -> Obj:
    return Obj(fields)


# ── Shared shapes ───────────────────────────────────────────────────────────

REGIME = E("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
VERDICT = E("reliable", "suggestive", "no_edge", "insufficient")
TARGET_UNIT = E("log_return", "log_change", "bp")
DISPLAY_UNIT = E("percent", "bp")
MOVE = E("up2s", "down2s", "cross_above", "cross_below", "rsi_above_70", "rsi_below_30")
WHILE = E("none", "spx_below_50", *(f"regime:{r}" for r in REGIME.values))
HORIZON = E(5, 10, 20, 60)
WINDOW = E(5, 20, 60)
DIRECTION = E("rising", "falling")
FEED_STATE = E("current", "stale", "missing")
TREND_STATE = E("above_both", "below_both", "mixed", "unavailable")
CROSS = obj(kind=E("golden", "death"), date=DATE)
UNAVAILABLE = obj(reason=STR, until=null(STR))
BAND_EDGES_RECESSION = Const([0.20, 0.40])
REGIMES_SOURCE = Const("regimes table (src/regime.py)")
RECESSION_SOURCE = Const("recession model (src/analytics/recession.py)")

# The §12.5 Ledger row, also /overview's active_signals.
LEDGER_ROW = obj(
    slug=STR, label=STR, short=STR, group=E("spx", "cross"),
    available=BOOL, unavailable=null(UNAVAILABLE), horizon=Const(20),
    last_fired=null(DATE), sample_start=null(DATE),
    n=null(INT), up_n=null(INT), up_pct=null(FRAC), median=null(NUM), baseline_median=null(NUM),
    vs_normal=null(NUM), target_unit=null(TARGET_UNIT), display_unit=null(DISPLAY_UNIT),
    verdict=null(VERDICT),
    firing_now=null(BOOL), firing_day=null(INT), evaluated_on=null(DATE), stale=BOOL,
)

# §12.6 recession.data; /overview's tile is the same object minus five fields.
RECESSION_TILE_FIELDS = dict(
    score=FRAC, probability_month=MONTH, inputs_through=MONTH,
    band=E("low", "elevated", "high_risk"), band_edges=BAND_EDGES_RECESSION,
    freq=Const("monthly"), source=RECESSION_SOURCE,
)

REGIME_TILE_FIELDS = dict(
    label=REGIME, print=MONTH, growth=DIRECTION, inflation=DIRECTION,
    months_in=INT, since=MONTH, freq=Const("monthly"), source=REGIMES_SOURCE,
)

SPAN = obj(start=DATE, end=DATE, n=INT)
MONTH_SPAN = obj(start=MONTH, end=MONTH, n=INT)

# ── §12.1 GET /overview ─────────────────────────────────────────────────────

FIRE = obj(slug=STR, label=STR, short=STR)
OVERVIEW = obj(
    since_last_close=Block(obj(
        comparison_session=DATE, prev_session=DATE,
        new_fires=Arr(FIRE),
        still_firing=Arr(obj(slug=STR, label=STR, short=STR, firing_day=INT)),
        vol_change_pts=null(NUM),
        regime_from=null(REGIME), regime_to=null(REGIME), regime_changed=null(BOOL),
        refreshed_at_utc=null(TS),
    )),
    tiles=obj(
        regime=Block(Obj(dict(REGIME_TILE_FIELDS))),
        recession=Block(Obj(dict(RECESSION_TILE_FIELDS))),
        trend=Block(obj(
            state=TREND_STATE, above_50=null(BOOL), above_200=null(BOOL), state_since=null(DATE),
            cross=null(CROSS), date=DATE, freq=Const("daily"), source=Const("asset_prices ^GSPC"),
        )),
        vol=Block(obj(vix=NUM, date=DATE, freq=Const("daily"), source=Const("FRED VIXCLS (desk_series)"),
                      band=E("calm", "subdued", "stressed"), band_edges=Const([15.0, 25.0]),
                      gap=null(obj(date=DATE, vix=NUM, realized_21d=NUM, gap_pts=NUM, window=SPAN)))),
    ),
    active_signals=Arr(LEDGER_ROW),
    data_status=Block(obj(
        state=FEED_STATE,
        contributors=Arr(obj(
            series=STR, observation_date=null(DATE), expected_observation_date=null(DATE),
            state=FEED_STATE, reason=STR,
        )),
    )),
)

# ── §12.2 GET /study ────────────────────────────────────────────────────────

EXTREME = obj(value=NUM, event_date=DATE, entry_date=DATE)
HORIZON_ROW = obj(
    h=HORIZON, label=E("1 week", "2 weeks", "1 month", "3 months"),
    n=INT, up_n=INT, n_incomplete=INT, n_blocks=INT, baseline_n=INT,
    up_pct=null(FRAC), median=null(NUM), baseline_median=null(NUM), baseline_up_pct=null(FRAC),
    ci_lo=null(NUM), ci_hi=null(NUM), adverse_share=null(FRAC), draws=INT,
    method=null(E("enumeration", "monte_carlo")), reason=null(STR), verdict=VERDICT,
    worst=null(EXTREME), best=null(EXTREME),
)
STUDY = obj(
    slug=STR, label=STR, short=STR,
    question=obj(
        shock=STR, window=null(WINDOW), move=MOVE, target=STR, horizon=HORIZON,
        target_unit=TARGET_UNIT, display_unit=DISPLAY_UNIT, **{"while": WHILE},
    ),
    selected_horizon=HORIZON,
    matched_n=INT, data_start=DATE, sample_start=DATE, sample_end=DATE,
    first_event=null(DATE), last_event=null(DATE),
    firing_now=null(BOOL), firing_day=null(INT), evaluated_on=null(DATE),
    comparison_session=DATE, prev_session=DATE, stale=BOOL,
    verdict=VERDICT, verdict_rule=Const("v1"), verdict_confidence=Const(0.90),
    headline=STR, why=STR,
    horizons=Arr(HORIZON_ROW, min=4, max=4),
    by_regime=Arr(obj(h=Const(20), regime=REGIME, n=INT, up_pct=null(FRAC), median=null(NUM)), min=4, max=4),
    unlabeled_n=INT,
    last_events=Arr(obj(event_date=DATE, entry_date=null(DATE), regime=REGIME, value_20=null(NUM)), max=5),
    without_condition=Deferred("conditional-versus-unconditional comparison is not defined"),
    provenance=obj(entry_rule=STR, cooldown=null(INT), seed=INT, engine_version=STR, series_start=MapOf(DATE)),
    warnings=Arr(STR),
    series=Arr(obj(key=STR, label=STR, roles=Arr(E("shock", "target", "condition")), ops=Arr(MOVE), unit=TARGET_UNIT)),
    client=null(obj(horizon=Const(20), headline=STR, summary=STR)),
    empty_state=null(obj(horizon=HORIZON, sentence=STR, fixes=Arr(E("widen_window", "drop_condition")))),
    inputs_hash=STR, served_from_cache=BOOL, elapsed_ms=NUM,
)

# ── §12.3 GET /study/catalog ────────────────────────────────────────────────

CATALOG = obj(studies=Arr(obj(
    slug=STR, label=STR, short=STR, client_label=null(STR),
    available=BOOL, unavailable=null(UNAVAILABLE),
    question=null(obj(shock=STR, window=null(WINDOW), move=MOVE, target=STR, **{"while": WHILE})),
    allowed_horizons=Arr(HORIZON, max=4),
), min=15, max=15))

# ── §12.4 GET /study/events ─────────────────────────────────────────────────

EVENTS_CSV_COLUMNS = ("event_date", "entry_date", "regime",
                      *(c for h in (5, 10, 20, 60) for c in (f"exit_{h}", f"value_{h}", f"complete_{h}")))
EVENT_ROW = Obj(dict(
    event_date=DATE, entry_date=null(DATE), regime=REGIME,
    **{k: v for h in (5, 10, 20, 60) for k, v in ((f"exit_{h}", null(DATE)), (f"value_{h}", null(NUM)), (f"complete_{h}", BOOL))},
))
EVENTS = obj(slug=STR, events=Arr(EVENT_ROW))

# ── §12.5 GET /ledger ───────────────────────────────────────────────────────

LEDGER = obj(
    verdict_rule=Const("v1"), horizon=Const(20), comparison_session=DATE, prev_session=DATE,
    scored_n=INT, unavailable_n=INT, signals=Arr(LEDGER_ROW, min=12, max=12),
)

# ── §12.6 GET /regime ───────────────────────────────────────────────────────

NEXT_PRINT = obj(
    release_date=null(DATE), reference_month=MONTH, series=E("CPIAUCSL", "INDPRO"),
    threshold_mom=null(NUM), operator=E("<=", ">"), flips_to=null(REGIME), first_effective_month=MONTH,
    freq=Const("monthly"), source=STR,
)
REGIME_ROUTE = obj(
    current=Block(Obj(dict(REGIME_TILE_FIELDS, latest_print=MONTH))),
    history=Arr(obj(month=MONTH, regime=REGIME), max=60),
    history_note=Const("labels as stored; revisions are not replayed."),
    history_freq=Const("monthly"), history_source=REGIMES_SOURCE,
    recession=Block(Obj(dict(
        RECESSION_TILE_FIELDS,
        feature_months=MapOf(MONTH),
        year_ago=null(obj(score=FRAC, probability_month=MONTH)),
        peak=obj(score=FRAC, probability_month=MONTH, window=Const("since 2015")),
        training=obj(start=MONTH, end=MONTH),
        methodology=Const("in-sample fitted scores"),
    ))),
    next_prints=Block(obj(cpi=null(NEXT_PRINT), indpro=null(NEXT_PRINT))),
    stats=Block(obj(
        rows=Arr(obj(regime=REGIME, months=INT, spx_n=INT, spx_median_mo=null(NUM), spx_mean_mo=null(NUM),
                     up_pct=null(FRAC), vix_avg=null(NUM), vix_days=INT), min=4, max=4),
        window=MONTH_SPAN, freq=Const("monthly"), source=STR,
    )),
    changes=Block(obj(
        rows=Arr(obj(month=MONTH, to=REGIME, from_month=MONTH, spx_1m=null(NUM), spx_1m_month=MONTH,
                     **{"from": REGIME}), max=5),
        n=INT, window=MONTH_SPAN, freq=Const("monthly"), source=STR,
    )),
)

# ── §12.14 sector leadership (desk/fill-etf), served by /sectors and /technicals ──

SECTOR_ROW = obj(etf=STR, name=STR, short=STR, group=null(E("cyclical", "defensive")),
                 rel_ret=null(NUM), ret=null(NUM), first=null(DATE), reason=null(STR))
SECTOR_PATTERN = obj(rule=Const("sector-pattern-v1"), band=Const(0.01), cyclicals=Arr(STR, min=6, max=6),
                     defensives=Arr(STR, min=3, max=3), word=null(E("cyclical", "defensive", "mixed")),
                     spread=null(NUM), reason=null(STR))
LEADERSHIP = dict(
    window_months=Const(3), window=obj(start=DATE, end=DATE, n=Const(60)), compared_on=DATE,
    unit=Const("log_return"), band=Const(0.01), benchmark=obj(etf=Const("SPY"), name=STR, ret=NUM),
    leadership=Arr(SECTOR_ROW, min=11, max=11), ranked_n=INT,
    missing=Arr(obj(etf=STR, name=STR, reason=STR), max=11), pattern=SECTOR_PATTERN,
    date=DATE, freq=Const("daily"), source=Const("asset_prices"), providers=Arr(STR),
)
_SPAN = obj(start=DATE, end=DATE, n=INT)
ABOVE = obj(n=INT, of=INT, compared_on=DATE, window=_SPAN, by_etf=MapOf(BOOL),
            not_available=Arr(obj(etf=STR, reason=STR)))
REL_POINT = obj(date=DATE, rel=null(NUM))
BREADTH = obj(
    compared_on=DATE, of_total=Const(11), above_50=ABOVE, above_200=ABOVE,
    eqw_vs_cap_3m=null(NUM), eqw_vs_cap_reason=null(STR), eqw_vs_cap_series=Arr(REL_POINT), eqw_vs_cap_line_window=null(_SPAN),
    small_vs_large_3m=null(NUM), small_vs_large_reason=null(STR), small_vs_large_series=Arr(REL_POINT),
    small_vs_large_line_window=null(_SPAN),
    relative_window=obj(start=DATE, end=DATE, n=Const(60)),
    unit=Const("log_return"), date=DATE, freq=Const("daily"), source=Const("asset_prices"), providers=Arr(STR),
)
SECTORS = Obj(dict(LEADERSHIP, breadth=Block(BREADTH)))

# ── §12.7 GET /technicals ───────────────────────────────────────────────────

POINT = obj(date=DATE, close=null(NUM), ma50=null(NUM), ma200=null(NUM))
RSI_VISIT = obj(date=DATE, rsi=NUM, after_20d=null(NUM), after_20d_to=null(DATE))
TECHNICALS = obj(
    price=null(NUM), date=DATE, freq=Const("daily"), source=Const("asset_prices ^GSPC"),
    chg_1d=null(NUM), chg_1d_dates=Obj({"from": DATE, "to": DATE}),
    ret_1y=null(NUM), ret_1y_dates=Obj({"from": DATE, "to": DATE}),
    ma50=null(NUM), ma200=null(NUM), ma50_window=SPAN, ma200_window=SPAN,
    vs_ma50=null(NUM), vs_ma200=null(NUM),
    trend=obj(state=TREND_STATE, state_since=null(DATE)),
    cross=null(CROSS),
    move_20d_sigma=null(NUM), move_20d_date=null(DATE),
    rsi=null(NUM), rsi_date=null(DATE), rsi_prev=null(NUM), rsi_prev_date=null(DATE),
    rsi_last_above_70=null(RSI_VISIT), rsi_last_below_30=null(RSI_VISIT),
    series=Obj({"6m": Arr(POINT), "1y": Arr(POINT), "3y": Arr(POINT)}),
    signals_allowlist=Const(["golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma", "spx-5d-2sigma"]),
    vol=Deferred("needs stored SPY option snapshots and a versioned skew method."),
    sectors=Block(Obj(dict(LEADERSHIP))),
)

# ── §12.8 GET /macro ────────────────────────────────────────────────────────

TENORS = ("3m", "2y", "5y", "10y", "30y")
CURVE_SNAP = Obj(dict(
    {t: null(NUM) for t in TENORS},
    date=null(DATE),
    dates=Obj({t: null(DATE) for t in TENORS}),
))
LEVEL = obj(value=NUM, date=DATE, freq=Const("daily"), source=STR)
MACRO = obj(
    curve=Block(Obj({
        "today": CURVE_SNAP, "month_ago": CURVE_SNAP,
        "2s10s_bp": null(NUM), "2s10s_chg_bp": null(NUM), "10y_chg_bp": null(NUM),
        "freq": Const("daily"), "source": Const("FRED"),
    })),
    credit=Block(obj(
        hy=LEVEL, ig=LEVEL,
        hy_pct_3y=null(FRAC), hy_range_3y=null(Arr(NUM, min=2, max=2)),
        rank_window=obj(start=DATE, end=DATE, n=INT, expected_n=INT, valid_n=INT, missing_n=INT,
                        first_obs=DATE, last_obs=DATE),
        reason=null(STR), band=null(E("tight", "normal", "wide")), band_edges=Const([0.30, 0.70]),
        series=Arr(obj(date=DATE, hy=NUM)), line_window=SPAN, peak_12m=null(obj(date=DATE, hy=NUM)),
    )),
    stock_bond=Block(obj(
        today=null(NUM), today_date=null(DATE), today_reason=null(STR),
        year_ago=null(NUM), year_ago_date=null(DATE),
        flipped=null(MONTH), flipped_on=null(DATE), flipped_to=null(E("positive", "negative")),
        series=Arr(obj(date=DATE, corr=null(NUM))), window=SPAN, line_window=SPAN,
        stock=obj(etf=Const("SPY"), name=STR), bond=obj(etf=Const("TLT"), name=STR),
        transform=Const("daily log return"), unit=Const("correlation"), date=DATE, freq=Const("daily"),
        source=Const("asset_prices"), providers=Arr(STR),
    )),
    correlations=Block(Arr(obj(
        asset=STR, symbol=STR, quantity=STR, transform=E("daily log return", "daily log change"),
        corr=null(NUM), date=null(DATE), window=null(SPAN), reason=null(STR),
    ), min=1, max=9)),
    matrix=Deferred("the 12-asset matrix's assets and method are not specified yet."),
)

# ── §12.9 GET /pipeline ─────────────────────────────────────────────────────

PIPELINE = obj(
    last_refresh_utc=null(TS), validation=null(E("pass", "fail")),
    groups=Arr(obj(
        name=STR, status=FEED_STATE,
        series=Arr(obj(
            label=STR, id=STR, key=null(STR), provider=STR, freq=E("daily", "weekly", "monthly"),
            first=null(DATE), last=null(DATE), feeds=Arr(STR), status=FEED_STATE, note=null(STR),
        )),
    )),
)

# ── The routes ──────────────────────────────────────────────────────────────

# The live routes' ready payloads (the nine of §12.1–§12.9, and /sectors since desk/fill-etf).
ROUTES: dict[str, Obj] = {
    "/overview": OVERVIEW,
    "/study": STUDY,
    "/study/catalog": CATALOG,
    "/study/events": EVENTS,
    "/ledger": LEDGER,
    "/regime": REGIME_ROUTE,
    "/technicals": TECHNICALS,
    "/macro": MACRO,
    "/pipeline": PIPELINE,
    "/sectors": SECTORS,  # desk/fill-etf (§12.14)
}

# §12.13's deferred resources: GET stubs answering awaiting with these reasons
# (§1.0, §12.3's served reasons; `/basket` is `/basket/:id`).
STUBS: dict[str, str] = {
    "/vol": "needs stored SPY option snapshots and a versioned skew method.",
    "/positions": "Positions are kept in this browser; there is no server position store.",
    "/basket": "basket pricing and option structures not yet defined in the engine.",
    "/basket/price": "basket pricing and option structures not yet defined in the engine.",
    "/hedge": "basket pricing and option structures not yet defined in the engine.",
}

ENVELOPE_KEYS = ("status", "generation_id", "as_of", "engine_version", "data", "unavailable", "error")
BLOCK_KEYS = frozenset({"status", "data", "unavailable"})
# §12.0 (plan §6 S-28, round 6's R-16): an error is exactly {code, message},
# except on code "schema_check", which carries exactly provider "api" and
# retryable true besides.
ERROR = obj(code=STR, message=STR)
SCHEMA_CHECK_ERROR = obj(code=Const("schema_check"), message=STR, provider=Const("api"), retryable=Const(True))


def block_paths(t: Any, prefix: str = "") -> list[str]:
    """The dotted paths of every block envelope a schema declares."""
    out: list[str] = []
    if isinstance(t, F):
        return block_paths(t.t, prefix)
    if isinstance(t, (Block, Deferred)):
        return [prefix]
    if isinstance(t, Obj):
        for k, v in t.fields.items():
            out += block_paths(v, f"{prefix}.{k}" if prefix else k)
    return out


def nested_paths() -> dict[str, tuple[str, ...]]:
    """§12.0's block paths, read off the transcribed tables."""
    return {r: tuple(p) for r, t in ROUTES.items() if (p := block_paths(t))}


# ── Checking ────────────────────────────────────────────────────────────────

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def _strict_json(raw: bytes | str) -> Any:
    def refuse(token: str) -> None:
        raise AssertionError(f"{token} on the wire")

    return json.loads(raw, parse_constant=refuse)


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _scalar_ok(tag: str, v: Any) -> bool:
    if tag == STR:
        return isinstance(v, str)
    if tag == INT:
        return isinstance(v, int) and not isinstance(v, bool)
    if tag == BOOL:
        return isinstance(v, bool)
    if tag in (NUM, FRAC):
        if not _number(v) or not math.isfinite(v):
            return False
        return tag == NUM or 0.0 <= v <= 1.0
    if tag == DATE:
        if not isinstance(v, str) or not _DATE.match(v):
            return False
        try:
            date.fromisoformat(v)
        except ValueError:
            return False
        return True
    if tag == MONTH:
        return isinstance(v, str) and bool(_MONTH.match(v))
    if tag == TS:
        if not isinstance(v, str) or not _TS.match(v):
            return False
        try:
            datetime.fromisoformat(v)
        except ValueError:
            return False
        return True
    raise ValueError(f"unknown scalar tag {tag!r}")


def _walk(t: Any, v: Any, path: str, errs: list[str]) -> None:
    if isinstance(t, F):
        if v is None:
            if not t.null:
                errs.append(f"{path}: null where the table allows none")
            return
        return _walk(t.t, v, path, errs)
    if v is None:
        errs.append(f"{path}: null where the table allows none")
        return
    if isinstance(t, str):
        if not _scalar_ok(t, v):
            errs.append(f"{path}: {v!r} is not a {t}")
    elif isinstance(t, Enum):
        if not any(type(v) is type(x) and v == x for x in t.values):
            errs.append(f"{path}: {v!r} is not one of {list(t.values)}")
    elif isinstance(t, Const):
        if v != t.value or type(v) is not type(t.value):
            errs.append(f"{path}: {v!r} is not the fixed {t.value!r}")
    elif isinstance(t, Obj):
        if not isinstance(v, dict):
            errs.append(f"{path}: {type(v).__name__} where an object is declared")
            return
        for k, ft in t.fields.items():
            here = f"{path}.{k}" if path else k
            if k not in v:
                if not (isinstance(ft, F) and ft.opt):
                    errs.append(f"{here}: required and absent")
                continue
            _walk(ft, v[k], here, errs)
        for k in v:
            if k not in t.fields:
                errs.append(f"{path}.{k}: a key outside the table" if path else f"{k}: a key outside the table")
    elif isinstance(t, Arr):
        if not isinstance(v, list):
            errs.append(f"{path}: {type(v).__name__} where an array is declared")
            return
        if len(v) < t.min or (t.max is not None and len(v) > t.max):
            errs.append(f"{path}: {len(v)} items, the table allows {t.min}..{t.max if t.max is not None else '∞'}")
        for i, item in enumerate(v):
            _walk(t.item, item, f"{path}[{i}]", errs)
    elif isinstance(t, MapOf):
        if not isinstance(v, dict):
            errs.append(f"{path}: {type(v).__name__} where an object is declared")
            return
        for k, item in v.items():
            if not isinstance(k, str) or not k:
                errs.append(f"{path}: key {k!r} is not a name")
            _walk(t.value, item, f"{path}.{k}", errs)
    elif isinstance(t, (Block, Deferred)):
        _walk_block(t, v, path, errs)
    else:
        raise TypeError(f"unknown schema node {t!r}")


def _unavailable_ok(u: Any, path: str, errs: list[str]) -> None:
    _walk(UNAVAILABLE, u, path, errs)
    if isinstance(u, dict) and isinstance(u.get("reason"), str) and not u["reason"].strip():
        errs.append(f"{path}.reason: empty")


def _walk_block(t: Block | Deferred, v: Any, path: str, errs: list[str]) -> None:
    if not isinstance(v, dict) or set(v) != BLOCK_KEYS:
        errs.append(f"{path}: not a block envelope {{status, data, unavailable}}: {v!r:.120}")
        return
    status = v["status"]
    if isinstance(t, Deferred):
        if status != "awaiting":
            errs.append(f"{path}: a deferred block answered {status!r}")
            return
    if status == "ready":
        if v["unavailable"] is not None:
            errs.append(f"{path}.unavailable: served on a ready block")
        if v["data"] is None:
            errs.append(f"{path}.data: a ready block without data")
        else:
            _walk(t.data, v["data"], f"{path}.data", errs)
    elif status == "awaiting":
        if v["data"] is not None:
            errs.append(f"{path}.data: served on an awaiting block")
        _unavailable_ok(v["unavailable"], f"{path}.unavailable", errs)
        if isinstance(t, Deferred) and isinstance(v["unavailable"], dict) and v["unavailable"].get("reason") != t.reason:
            errs.append(f"{path}.unavailable.reason: {v['unavailable'].get('reason')!r}, the table fixes {t.reason!r}")
    else:
        errs.append(f"{path}.status: {status!r} is not ready or awaiting")


def _found_blocks(v: Any, path: str = "") -> list[str]:
    """Every object in a payload that has exactly a block envelope's keys."""
    out: list[str] = []
    if isinstance(v, dict):
        if set(v) == BLOCK_KEYS:
            out.append(path)
        for k, x in v.items():
            out += _found_blocks(x, f"{path}.{k}" if path else k)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            out += _found_blocks(x, f"{path}[{i}]")
    return out


def _finite_everywhere(v: Any, path: str, errs: list[str]) -> None:
    if isinstance(v, float) and not math.isfinite(v):
        errs.append(f"{path}: {v!r}")
    elif isinstance(v, dict):
        for k, x in v.items():
            _finite_everywhere(x, f"{path}.{k}" if path else k, errs)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            _finite_everywhere(x, f"{path}[{i}]", errs)


def problems(route: str, body: Any) -> list[str]:
    """Every way `body` breaks the contract of `route` (empty when it holds)."""
    if isinstance(body, (bytes, str)):
        try:
            body = _strict_json(body)
        except AssertionError as exc:
            return [str(exc)]
    errs: list[str] = []
    if route not in ROUTES and route not in STUBS:
        return [f"{route}: not a §12 route"]
    _finite_everywhere(body, "", errs)
    if not isinstance(body, dict) or tuple(sorted(body)) != tuple(sorted(ENVELOPE_KEYS)):
        return errs + [f"envelope keys {sorted(body) if isinstance(body, dict) else type(body).__name__}, "
                       f"the table has {sorted(ENVELOPE_KEYS)}"]
    status = body["status"]
    if status not in ("ready", "computing", "awaiting", "error"):
        return errs + [f"status {status!r}"]
    gid, as_of = body["generation_id"], body["as_of"]
    if gid is not None and (not isinstance(gid, str) or not gid):
        errs.append(f"generation_id {gid!r}")
    if as_of is not None and not _scalar_ok(DATE, as_of):
        errs.append(f"as_of {as_of!r}")
    if (gid is None) != (as_of is None):
        errs.append("generation_id and as_of are null together or not at all")
    if status == "computing" and gid is not None:
        errs.append("a computing answer names no generation (S-11)")
    if status == "ready" and gid is None:
        errs.append("a ready answer names its generation")
    if not isinstance(body["engine_version"], str) or not body["engine_version"]:
        errs.append(f"engine_version {body['engine_version']!r}")
    for key, when in (("data", "ready"), ("unavailable", "awaiting"), ("error", "error")):
        if (body[key] is not None) != (status == when):
            errs.append(f"{key} is served exactly when the status is {when}; status {status!r}")
    if status == "awaiting" and body["unavailable"] is not None:
        _unavailable_ok(body["unavailable"], "unavailable", errs)
    if status == "error" and body["error"] is not None:
        e = body["error"]
        schema = SCHEMA_CHECK_ERROR if isinstance(e, dict) and e.get("code") == "schema_check" else ERROR
        _walk(schema, e, "error", errs)
        if isinstance(e, dict) and not str(e.get("code") or "").strip():
            errs.append("error.code: empty")
    if route in STUBS:
        if status == "ready":
            errs.append(f"{route} is a deferred stub and never ready")
        if status == "awaiting" and isinstance(body["unavailable"], dict) and body["unavailable"].get("reason") != STUBS[route]:
            errs.append(f"unavailable.reason: {body['unavailable'].get('reason')!r}, the table fixes {STUBS[route]!r}")
        return errs
    if status == "ready" and isinstance(body["data"], dict):
        _walk(ROUTES[route], body["data"], "", errs)
        declared = set(nested_paths().get(route, ()))
        found = _found_blocks(body["data"])
        for p in found:
            if p not in declared:
                errs.append(f"{p}: has a block envelope's keys outside the listed paths")
    return errs


def check(route: str, body: Any) -> dict:
    """Assert that `body` (parsed, or the raw bytes) keeps the contract of
    `route`; return it parsed."""
    errs = problems(route, body)
    assert not errs, f"{route} breaks §12:\n  " + "\n  ".join(errs)
    return _strict_json(body) if isinstance(body, (bytes, str)) else body


HTTP_FOR = {"ready": (200,), "awaiting": (200,), "computing": (202,)}


def check_response(route: str, resp: Any) -> dict:
    """The transport of an enveloped answer (§12.0, plan §3), then `check`."""
    ctype = resp.headers.get("content-type", "")
    assert ctype.split(";")[0].strip() == "application/json", ctype
    assert resp.headers.get("cache-control") == "no-store", resp.headers.get("cache-control")
    body = check(route, resp.content)
    status = body["status"]
    if status == "error":
        assert 400 <= resp.status_code < 600, (resp.status_code, body)
    else:
        assert resp.status_code in HTTP_FOR[status], (resp.status_code, status)
    if status == "computing":
        assert resp.headers.get("retry-after") == "2", resp.headers.get("retry-after")
    return body


# ── Examples (for the helper's own tests) ───────────────────────────────────

_SAMPLE = {STR: "x", INT: 1, NUM: 1.5, FRAC: 0.5, BOOL: True, DATE: "2026-09-23", MONTH: "2026-07",
           TS: "2026-09-24T11:30:00Z"}


def example(t: Any, *, nulls: bool = False) -> Any:
    """A value that keeps schema `t`: every nullable field null when `nulls`."""
    if isinstance(t, F):
        return None if (nulls and t.null) else example(t.t, nulls=nulls)
    if isinstance(t, str):
        return _SAMPLE[t]
    if isinstance(t, Enum):
        return t.values[0]
    if isinstance(t, Const):
        return json.loads(json.dumps(t.value))
    if isinstance(t, Obj):
        return {k: example(v, nulls=nulls) for k, v in t.fields.items()}
    if isinstance(t, Arr):
        return [example(t.item, nulls=nulls) for _ in range(max(t.min, 1 if t.max != 0 else 0))]
    if isinstance(t, MapOf):
        return {"k": example(t.value, nulls=nulls)}
    if isinstance(t, Block):
        return {"status": "ready", "data": example(t.data, nulls=nulls), "unavailable": None}
    if isinstance(t, Deferred):
        return {"status": "awaiting", "data": None, "unavailable": {"reason": t.reason, "until": None}}
    raise TypeError(f"unknown schema node {t!r}")


def example_envelope(route: str, *, nulls: bool = False) -> dict:
    """A ready envelope for a live route, or the awaiting one for a stub."""
    meta = {"generation_id": "g1-0123456789", "as_of": "2026-09-24", "engine_version": "unknown"}
    if route in STUBS:
        return {"status": "awaiting", **meta, "data": None,
                "unavailable": {"reason": STUBS[route], "until": None}, "error": None}
    return {"status": "ready", **meta, "data": example(ROUTES[route], nulls=nulls), "unavailable": None, "error": None}
