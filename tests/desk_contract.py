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
class OneOf:
    """A value that keeps any one of these schemas (the Options Finder's early-exercise premium is a number,
    or the words "below $x" when a proved bound stood in for it)."""

    options: tuple


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
# Codex R-08: a return is complete, its window not complete yet (pending), or missing a stored close.
RETURN_STATUS = E("complete", "pending", "missing")
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

# fix/freshness 3a (D2): the newest stored row, the Dashboard's label, with the classifier's
# odds for it (null for Recession Risk: the Desk never shows regimes.prob_recession).
REGIME_TILE_FIELDS = dict(
    label=REGIME, print=MONTH, growth=DIRECTION, inflation=DIRECTION,
    months_in=INT, since=MONTH, odds=null(FRAC), freq=Const("monthly"), source=REGIMES_SOURCE,
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
        # fix/freshness 3d: the Desk series behind with the oldest observation, null when all are current.
        oldest_behind=null(obj(series=STR, observation_date=null(DATE), state=E("stale", "missing"), reason=STR)),
    )),
    tiles=obj(
        regime=Block(Obj(dict(REGIME_TILE_FIELDS))),
        recession=Block(Obj(dict(RECESSION_TILE_FIELDS))),
        trend=Block(obj(
            state=TREND_STATE, above_50=null(BOOL), above_200=null(BOOL), state_since=null(DATE),
            cross=null(CROSS), date=DATE, freq=Const("daily"), source=Const("asset_prices ^GSPC"),
        )),
        vol=Block(obj(vix=NUM, date=DATE, freq=Const("daily"), source=Const("asset_prices ^VIX"),
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

# §12.2 `series`; Codex R-05: /study/catalog serves the same list, so the builder's slots never wait on a study.
SERIES_ROW = obj(key=STR, label=STR, roles=Arr(E("shock", "target", "condition")), ops=Arr(MOVE), unit=TARGET_UNIT)

# ── §12.2 GET /study ────────────────────────────────────────────────────────

EXTREME = obj(value=NUM, event_date=DATE, entry_date=DATE)
HORIZON_ROW = obj(
    h=HORIZON, label=E("1 week", "2 weeks", "1 month", "3 months"),
    n=INT, up_n=INT, n_incomplete=INT, n_blocks=INT, baseline_n=INT,
    up_pct=null(FRAC), median=null(NUM), baseline_median=null(NUM), baseline_up_pct=null(FRAC),
    ci_lo=null(NUM), ci_hi=null(NUM), adverse_share=null(FRAC), draws=INT,
    method=null(E("enumeration", "monte_carlo")), reason=null(STR), verdict=VERDICT,
    worst=null(EXTREME), best=null(EXTREME),
    # P1d (docs/desk/INTERVALS_SPEC.md §4): the 80% and 95% pairs of the same resampled medians. The API serves all
    # four on every row; an answer from a generation before them carries none (the client's fixtures, and what
    # the page reads until the worker's first generation on the new code), so they may be absent, but only all
    # four together, and `interval_rule` holds whenever they are served.
    ci80_lo=F(NUM, null=True, opt=True), ci80_hi=F(NUM, null=True, opt=True),
    ci95_lo=F(NUM, null=True, opt=True), ci95_hi=F(NUM, null=True, opt=True),
)
OPTIONAL_RANGE_KEYS = ("ci80_lo", "ci80_hi", "ci95_lo", "ci95_hi")
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
    stale_inputs=Arr(STR),  # Codex R-03: the registry keys of the inputs behind their own tolerance
    verdict=VERDICT, verdict_rule=Const("v1"), verdict_confidence=Const(0.90),
    headline=STR, why=STR,
    horizons=Arr(HORIZON_ROW, min=4, max=4),
    by_regime=Arr(obj(h=Const(20), regime=REGIME, n=INT, up_pct=null(FRAC), median=null(NUM)), min=4, max=4),
    unlabeled_n=INT,
    last_events=Arr(obj(event_date=DATE, entry_date=null(DATE), regime=REGIME, value_20=null(NUM)), max=5),
    without_condition=Deferred("conditional-versus-unconditional comparison is not defined"),
    provenance=obj(entry_rule=STR, cooldown=null(INT), seed=INT, engine_version=STR, series_start=MapOf(DATE)),
    warnings=Arr(STR),
    series=Arr(SERIES_ROW),
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
), min=15, max=15), series=Arr(SERIES_ROW))

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

PRINT_SERIES = E("CPIAUCSL", "INDPRO")
# Codex R-05: an upcoming print, its release bound to its own reference month; R-06: the other axis it assumes.
NEXT_PRINT = obj(
    release_date=null(DATE), released=null(BOOL), reference_month=MONTH, series=PRINT_SERIES,
    threshold_mom=null(NUM), operator=E("<=", ">"), flips_to=null(REGIME), first_effective_month=MONTH,
    from_direction=DIRECTION, printed_mom=null(NUM), printed_direction=null(DIRECTION),
    other=obj(axis=E("growth", "inflation"), series=PRINT_SERIES, reference_month=MONTH, direction=DIRECTION,
              status=E("published", "assumed")),
    freq=Const("monthly"), source=STR,
)
# Codex R-05: a stored row after the one shown, already published, with the two prints that made it.
PUBLISHED_PRINT = obj(reference_month=MONTH, series=PRINT_SERIES, mom=null(NUM), direction=null(DIRECTION),
                      from_direction=null(DIRECTION))
PUBLISHED_ROW = obj(month=MONTH, label=REGIME, first_effective_month=MONTH, cpi=PUBLISHED_PRINT, indpro=PUBLISHED_PRINT)
REGIME_ROUTE = obj(
    current=Block(Obj(dict(REGIME_TILE_FIELDS, latest_print=MONTH,
                           classifier=null(obj(month=MONTH, label=REGIME, odds=null(FRAC), agrees=BOOL))))),
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
    next_prints=Block(obj(
        basis=obj(month=MONTH, label=REGIME),
        published=Arr(PUBLISHED_ROW, max=2),
        upcoming_from=obj(month=MONTH, label=REGIME),
        cpi=null(NEXT_PRINT), indpro=null(NEXT_PRINT),
    )),
    # Codex R-01, R-04, R-07, R-08 (desk/fill-compute): each label over the month it governed (K−2), the
    # return sample and the VIX coverage apart from the label count, each change by its effective month.
    stats=Block(obj(
        rows=Arr(obj(regime=REGIME, months=INT, spx_n=INT, spx_pending=INT, spx_missing=INT, spx_median_mo=null(NUM),
                     spx_mean_mo=null(NUM), up_pct=null(FRAC), vix_avg=null(NUM), vix_days=INT, vix_sessions=INT), min=4, max=4),
        window=MONTH_SPAN, governed=MONTH_SPAN, lag_months=Const(2),
        totals=obj(months=INT, spx_n=INT, spx_pending=INT, spx_missing=INT, vix_days=INT, vix_sessions=INT),
        vix_coverage=obj(stored=BOOL, first=null(DATE), last=null(DATE), off_session_dropped=INT, invalid=INT),
        freq=Const("monthly"), source=STR,
    )),
    changes=Block(obj(
        rows=Arr(obj(effective_month=MONTH, stamp_month=MONTH, to=REGIME, from_month=MONTH, spx_1m=null(NUM),
                     spx_1m_status=RETURN_STATUS, **{"from": REGIME}), max=5),
        n=INT, window=MONTH_SPAN, lag_months=Const(2), freq=Const("monthly"), source=STR,
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
RSI_VISIT = obj(date=DATE, rsi=NUM, after_20d=null(NUM), after_20d_to=null(DATE), after_20d_status=RETURN_STATUS)
# desk/fill-compute item 9: MACD(12, 26, 9), src/analytics/technicals.macd.
MACD_POINT = obj(date=DATE, macd=null(NUM), signal=null(NUM), hist=null(NUM))
MACD = obj(date=DATE, macd=NUM, signal=NUM, hist=NUM, last_cross=null(obj(date=DATE, kind=E("above", "below"))),
           params=Const({"fast": 12, "slow": 26, "signal": 9}), series=Arr(MACD_POINT))
# desk/fill-compute item 10: seasonality by calendar month, src/analytics/technicals.monthly_seasonality.
SEASON_ROW = obj(month=INT, label=E("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
                 n=INT, avg=null(NUM), pct_up=null(FRAC), first_year=null(INT), last_year=null(INT))
# desk/usability: any symbol's ("asset_prices <symbol>" or the provider's candles).
SEASONALITY = obj(rows=Arr(SEASON_ROW, min=12, max=12), window=MONTH_SPAN, freq=Const("monthly"), source=STR)
RS_POINT = obj(date=DATE, rs=null(NUM), rs_ma50=null(NUM))
DATES = Obj({"from": DATE, "to": DATE})
TECHNICALS = obj(
    # desk/usability §14.2: any US-listed stock or ETF; `scored` only for the S&P 500 itself.
    symbol=STR, name=STR, scored=BOOL,
    price=null(NUM), date=DATE, freq=Const("daily"), source=STR,
    chg_1d=null(NUM), chg_1d_dates=DATES,
    ret_1y=null(NUM), ret_1y_dates=DATES,
    ma50=null(NUM), ma200=null(NUM), ma50_window=SPAN, ma200_window=SPAN,
    vs_ma50=null(NUM), vs_ma200=null(NUM),
    trend=obj(state=TREND_STATE, state_since=null(DATE)),
    cross=null(CROSS),
    move_20d_sigma=null(NUM), move_20d_date=null(DATE),
    rsi=null(NUM), rsi_date=null(DATE), rsi_prev=null(NUM), rsi_prev_date=null(DATE),
    rsi_last_above_70=null(RSI_VISIT), rsi_last_below_30=null(RSI_VISIT),
    macd=null(MACD),
    seasonality=null(SEASONALITY),
    # A stock's two years of daily bars carry 6m and 1y; the stored S&P and ETFs 3y too.
    series=Obj({"6m": Arr(POINT), "1y": Arr(POINT), "3y": F(Arr(POINT), opt=True)}),
    # Codex R-01: `complete` only when all 252 sessions of the year hold a valid close; else the window's n says how many.
    drawdown=obj(value=NUM, peak=obj(date=DATE, close=NUM), window=SPAN, complete=BOOL),
    realized_vol=obj(value=null(NUM), window=SPAN, annualization=Const(252)),
    rs=null(obj(benchmark=Const("^GSPC"), date=DATE, value=NUM, ma50=null(NUM), vs_ma50=null(NUM), chg_3m=null(NUM),
                chg_3m_dates=null(DATES),
                series=Obj({"6m": Arr(RS_POINT), "1y": Arr(RS_POINT), "3y": F(Arr(RS_POINT), opt=True)}))),
    # Codex R-03: a stock's provider bars dated after the last completed session, dropped before any figure.
    excluded_bars=null(obj(n=INT, after=DATE)),
    # A stock's provider bars without an adjusted close, left out (the merge review, as desk/books' R-07).
    unadjusted_bars=null(obj(n=INT)),
    # The S&P 500's six scored signals (desk/fill-compute); a stock's page lists none (desk/usability §14.2).
    signals_allowlist=Arr(E("golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma", "spx-5d-2sigma"), max=6),
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
# Desk P1b (docs/desk/CORRELATION_VIEWS.md): the 20-, 60- and 120-return views and the correlation by regime.
CORR_HORIZONS = ("20", "60", "120")
SB_FIELDS = dict(
    today=null(NUM), today_date=null(DATE), today_reason=null(STR),
    year_ago=null(NUM), year_ago_date=null(DATE),
    flipped=null(MONTH), flipped_on=null(DATE), flipped_to=null(E("positive", "negative")),
    series=Arr(obj(date=DATE, corr=null(NUM))), window=SPAN, line_window=SPAN,
)
SB_HORIZON = Obj(dict(SB_FIELDS, horizon=INT, noise_band=FRAC))
PAIR_HORIZON = obj(horizon=INT, noise_band=FRAC, corr=null(NUM), window=SPAN, reason=null(STR))
REGIME_NAMES = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
REGIME_STAT = dict(corr=null(NUM), n=INT, first=null(DATE), last=null(DATE), reason=null(STR))
BY_REGIME = obj(
    regime_history=Const("revised"), rule=STR, lag_months=Const(2), as_known=null(STR), as_known_reason=STR,
    min_n=Const(60), current=null(E(*REGIME_NAMES)), current_row=null(MONTH),
    sample=null(obj(start=DATE, end=DATE)), unlabeled_n=null(INT), incomplete_n=null(INT),
    regimes=Arr(Obj(dict(REGIME_STAT, regime=E(*REGIME_NAMES), spells=INT, largest_spell_share=null(FRAC))), max=4),
    all=null(Obj(REGIME_STAT)), reason=null(STR),
)
MATRIX_LEAD = obj(text=null(STR), rule=Const("matrix-lead-v1"), hedging=null(BOOL), spy_tlt=null(NUM),
                  highest=null(obj(a=STR, b=STR, corr=NUM)), lowest=null(obj(a=STR, b=STR, corr=NUM)))
MATRIX_GRID = dict(
    no_data=Arr(obj(symbol=STR, reason=STR), max=12),
    values=Arr(Arr(null(NUM), min=12, max=12), min=12, max=12), window=SPAN,
    coverage=Arr(null(INT), min=12, max=12), lead=MATRIX_LEAD,
)
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
    stock_bond=Block(Obj(dict(
        SB_FIELDS,
        stock=obj(etf=Const("SPY"), name=STR), bond=obj(etf=Const("TLT"), name=STR),
        transform=Const("daily log return"), unit=Const("correlation"), date=DATE, freq=Const("daily"),
        source=Const("asset_prices"), providers=Arr(STR),
        horizons=Const([20, 60, 120]), by_horizon=Obj({h: SB_HORIZON for h in CORR_HORIZONS}),
    ))),
    correlations=Block(Arr(obj(
        asset=STR, symbol=STR, quantity=STR, transform=E("daily log return", "daily log change"),
        corr=null(NUM), date=null(DATE), window=null(SPAN), reason=null(STR),
        by_horizon=null(Obj({h: PAIR_HORIZON for h in CORR_HORIZONS})), by_regime=null(BY_REGIME),
    ), min=1, max=9)),
    # desk/matrix: every pair of the twelve assets over one 60-date window (Desk P1b: and over 20 and 120)
    matrix=Block(Obj(dict(
        MATRIX_GRID,
        assets=Const(["SPY", "QQQ", "IWM", "SMH", "XLE", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP", "^VIX"]),
        labels=Arr(STR, min=12, max=12), horizon=Const(60),
        quantity=STR, transform=STR, unit=Const("correlation"), date=DATE, freq=Const("daily"),
        source=Const("asset_prices"), providers=Arr(STR),
        horizons=Const([20, 60, 120]),
        by_horizon=Obj({h: Obj(dict(MATRIX_GRID, horizon=INT, noise_band=FRAC)) for h in CORR_HORIZONS}),
    ))),
)

# ── §12.9 GET /pipeline ─────────────────────────────────────────────────────

PIPELINE_STORED = obj(
    basis=E("row_provider", "table_writer"), rows=INT, latest=STR,
    providers=Arr(obj(code=STR, name=STR, rows=INT, first=DATE, last=DATE), min=1),
)
PIPELINE = obj(
    last_refresh_utc=null(TS), validation=null(E("pass", "fail")),
    groups=Arr(obj(
        name=STR, status=FEED_STATE,
        series=Arr(obj(
            label=STR, id=STR, key=null(STR), provider=STR, freq=E("daily", "weekly", "monthly"),
            # D2 (desk-upgrade): the intended fallback policy, apart from the providers of the stored rows
            policy=STR, stored=null(PIPELINE_STORED),
            first=null(DATE), last=null(DATE), feeds=Arr(STR), status=FEED_STATE, note=null(STR),
        )),
    )),
)

# ── §12.15 GET /basket/price (desk/books) ───────────────────────────────────

REGRESSION_FIELDS = {}
for _w in ("1y", "60d"):
    REGRESSION_FIELDS.update({f"beta_{_w}": null(NUM), f"corr_{_w}": null(NUM),
                              f"window_{_w}": obj(start=null(DATE), end=null(DATE), n=INT), f"reason_{_w}": null(STR)})
BASKET_POINT = obj(date=DATE, close=null(NUM), ma50=null(NUM), ma200=null(NUM), rsi=null(NUM), drawdown=null(NUM))
COMPARE_POINT = obj(date=DATE, basket=null(NUM), qqq=null(NUM), spy=null(NUM), rs_qqq=null(NUM), rs_qqq_ma50=null(NUM),
                    rs_spy=null(NUM), rs_spy_ma50=null(NUM))
# desk/cap-weight: where a cap-weighted basket's weights came from; null for typed weights.
CAP_WEIGHTS = obj(
    provider=STR, source=STR, as_of=DATE, start=DATE,
    legs=Arr(obj(symbol=STR, shares_outstanding=NUM, as_of=DATE, close_start=NUM, value_start=NUM, weight_start=FRAC), min=1),
)
BASKET_PRICE = obj(
    method=E("hold", "monthly"), weighting=E("target", "cap"), cap_weights=null(CAP_WEIGHTS),
    notional=NUM, provider=STR, source=STR, freq=Const("daily"),
    prices_as_of=DATE, history_from=DATE, start=DATE, start_kind=E("first_close", "history", "gap"),
    start_binding=Arr(STR, min=1), start_is_first_close=BOOL, start_gap_session=null(DATE),
    end=DATE, sessions=INT, missing_sessions=Arr(DATE), rebalances=INT, total_return=NUM,
    excluded=Arr(obj(symbol=STR, n=INT, reason=STR)),
    legs=Arr(obj(symbol=STR, target_weight=FRAC, weight_now=FRAC, first_close=DATE, price_end=NUM, **{"return": NUM},
                 contribution=NUM, dollars=NUM, adv_usd=null(NUM), adv_window=SPAN, adv_missing=INT,
                 days_to_trade=null(NUM)), min=1),
    concentration=obj(top3_share=FRAC, top3=Arr(STR, min=1, max=3), effective_n=NUM, avg_pairwise_corr=null(NUM),
                      corr_window=null(SPAN)),
    liquidity=obj(participation=Const(0.2), adv_sessions=Const(20), basket_days=null(NUM), binding=null(STR),
                  missing=Arr(STR), reason=null(STR)),
    index=obj(
        price=NUM, date=DATE, chg_1d=null(NUM), chg_1d_dates=Obj({"from": DATE, "to": DATE}),
        ret_1y=null(NUM), ret_1y_dates=Obj({"from": DATE, "to": DATE}),
        ma50=null(NUM), ma200=null(NUM), ma50_window=SPAN, ma200_window=SPAN, vs_ma50=null(NUM), vs_ma200=null(NUM),
        trend=obj(state=TREND_STATE, state_since=null(DATE)), cross=null(CROSS), crosses=Arr(CROSS),
        series=obj(**{"6m": Arr(BASKET_POINT), "1y": Arr(BASKET_POINT)}),
        rsi=null(NUM), rsi_date=null(DATE),
        drawdown=obj(now=null(NUM), peak_date=DATE, peak=NUM, max=null(NUM), max_date=DATE, max_peak_date=DATE, since=DATE),
        realized_vol_21d=null(NUM), realized_vol_window=null(SPAN),
    ),
    benchmarks=obj(**{k: obj(symbol=STR, label=STR, price=NUM, date=DATE, ret_1y=null(NUM), **REGRESSION_FIELDS)
                      for k in ("qqq", "spy")}),
    compare=obj(**{r: obj(base_date=null(DATE), points=Arr(COMPARE_POINT)) for r in ("6m", "1y")}),
)


# ── §12.16 GET /basket/hedge (desk/books) ───────────────────────────────────

LOOSE_SPAN = obj(start=null(DATE), end=null(DATE), n=INT)
HEDGE_ETF = E("SMH", "SOXX", "QQQ", "XLK", "IGV", "XLU", "SPY", "IWM")
BASKET_HEDGE = obj(
    method=E("hold", "monthly"), weighting=E("target", "cap"), cap_weights=null(CAP_WEIGHTS),
    notional=NUM, provider=STR, source=STR, freq=Const("daily"),
    prices_as_of=DATE, start=DATE, ranked_by=E("r2_1y", "r2_60d"), excluded=Arr(obj(symbol=STR, n=INT, reason=STR)),
    etfs=Arr(obj(
        symbol=HEDGE_ETF, label=STR, rank=INT, basis=null(E("1y", "60d")),
        r2_1y=null(FRAC), r2_60d=null(FRAC), beta_1y=null(NUM), beta_60d=null(NUM),
        hedge_ratio=null(NUM), short_usd=null(NUM), basket_vol=null(NUM), residual_vol=null(NUM), vol_reduction=null(NUM),
        window_1y=LOOSE_SPAN, window_60d=LOOSE_SPAN, reason=null(STR),
    ), min=8, max=8),
    top=null(HEDGE_ETF),
    stress=Arr(obj(
        shock=E("QQQ", "SPY"), move=Const(-0.1), window=null(LOOSE_SPAN), reason=null(STR),
        basket_beta=null(NUM), basket_move=null(NUM), unhedged_usd=null(NUM),
        hedge=null(HEDGE_ETF), hedge_ratio=null(NUM), short_usd=null(NUM), hedge_beta=null(NUM), hedge_move=null(NUM),
        hedge_usd=null(NUM), hedged_usd=null(NUM), hedged_move=null(NUM),
    ), min=2, max=2),
)


# ── §12.17 GET /instruments (desk/usability) ───────────────────────────────

INSTRUMENTS = obj(instruments=Arr(obj(
    symbol=STR, name=STR, kind=E("etf", "index"), first=DATE, last=DATE, source=Const("asset_prices"),
)), excluded=Arr(obj(symbol=STR, reason=STR)))  # Codex R-08: an instrument whose stored rows could not be read, and why


# ── §12.18 GET /basket/shares (desk/cap-weight) ─────────────────────────────

BASKET_SHARES = obj(
    provider=STR, source=STR, counts_as_of=DATE,
    counts=Arr(obj(symbol=STR, shares_outstanding=NUM, as_of=DATE, source=STR), min=1),
    excluded=Arr(obj(symbol=STR, reason=STR)),
)


# ── §12.19 GET /basket/study (desk P1a; docs/desk/BASKET_STUDY_SPEC.md) ─────

# The event-study engine run on the basket's own index (the page's rule over EODHD closes since 1995): the
# basket and the question, the index's provenance, and the study in §12.2's shape for its one question, or
# null with the reason (`not_run`) when the index is too short for it.
BASKET_STUDY_INDEX = obj(
    provider=STR, source=STR, requested_from=DATE, first_close=MapOf(DATE),
    session=DATE, last_close=MapOf(DATE),  # the completed session asked through; each name's newest close
    method=E("hold", "monthly"), weighting=E("target", "cap"), rule=STR,
    start=DATE, start_kind=E("first_close", "history", "gap"), start_binding=Arr(STR, min=1),
    end=DATE, sessions=INT, missing_sessions=INT, off_session=MapOf(INT), moved_rebalances=Arr(DATE),
    excluded=Arr(obj(symbol=STR, n=INT, reason=STR)), cap_weights=null(CAP_WEIGHTS),
)
BASKET_STUDY_RUN = obj(
    slug=STR, label=STR, selected_horizon=HORIZON,
    matched_n=INT, data_start=DATE, sample_start=DATE, sample_end=DATE,
    first_event=null(DATE), last_event=null(DATE),
    verdict=VERDICT, verdict_rule=Const("v1"), verdict_confidence=Const(0.90),
    headline=STR, why=STR,
    horizons=Arr(HORIZON_ROW, min=4, max=4),
    by_regime=Arr(obj(h=Const(20), regime=REGIME, n=INT, up_pct=null(FRAC), median=null(NUM)), min=4, max=4),
    regime_history=Const("revised"),  # P-1: the regimes table's revised history, labelled as such
    unlabeled_n=INT,
    last_events=Arr(obj(event_date=DATE, entry_date=null(DATE), regime=REGIME, value_20=null(NUM)), max=5),
    provenance=obj(entry_rule=STR, cooldown=INT, seed=INT, engine_version=STR, as_of_cutoff=DATE,
                   regimes_last=null(DATE), calendar=STR),
    warnings=Arr(STR),
    empty_state=null(obj(horizon=HORIZON, sentence=STR, fixes=Arr(E("widen_window")))),
    inputs_hash=STR,
)
BASKET_STUDY = obj(
    basket=obj(legs=Arr(obj(symbol=STR, weight=null(NUM)), min=1), method=E("hold", "monthly"), weighting=E("target", "cap")),
    question=obj(shock=Const("basket"), window=WINDOW, move=E("down2s", "up2s"), target=Const("basket"), horizon=HORIZON,
                 target_unit=Const("log_return"), display_unit=Const("percent"), **{"while": Const("none")}),
    index=BASKET_STUDY_INDEX,
    study=null(BASKET_STUDY_RUN),
    not_run=null(STR),
    caveats=Arr(STR, min=2),
    elapsed_ms=NUM,
)


# ── §12.20 GET /positioning (Desk P4; docs/desk/POSITIONING_SPEC.md) ───────

# Two lagged public disclosures, each a block: the CFTC's weekly futures positioning for five macro markets
# and SEC 13F holder concentration for the names a basket may hold. Every figure carries its own dates.
COT_MARKET_KEY = E("spx", "ust10y", "usd", "gold", "wti")
COT_CATEGORY = E("dealer", "asset_manager", "leveraged_funds", "other_reportables", "nonreportables",
                 "producer_merchant", "swap_dealers", "managed_money")
COT_SET_ASIDE = Arr(obj(as_of=STR, reason=STR))  # a stored report not read, and why (its date may be the fault)
COT_MARKET = obj(
    key=COT_MARKET_KEY, label=STR, contract_code=STR, market_name=STR,
    report=E("tff", "disaggregated"), report_title=E("Traders in Financial Futures", "Disaggregated"),
    category=E("leveraged_funds", "managed_money"), category_label=E("Leveraged funds", "Managed money"),
    as_of=DATE,  # the positions date
    released=null(DATE), release_delayed=null(BOOL), release_basis=null(Const("cftc_schedule")), release_note=STR,
    first_stored_at=TS, stored_at=TS,
    long=INT, short=INT, spread=null(INT), net=INT, open_interest=INT, net_pct_oi=null(NUM),
    change_1w=null(obj(**{"from": DATE}, net=INT, net_pct_oi=null(NUM))), change_reason=null(STR),
    range_3y=null(obj(percentile=NUM, n=INT, **{"from": DATE}, to=DATE, min_pct_oi=NUM, min_on=DATE,
                      max_pct_oi=NUM, max_on=DATE)),
    range_reason=null(STR),
    categories=Arr(obj(category=COT_CATEGORY, label=STR, long=INT, short=INT, spread=null(INT), net=INT,
                       net_pct_oi=null(NUM)), min=5, max=5),
    history_from=DATE, reports=INT, excluded=COT_SET_ASIDE,
    series=Arr(obj(as_of=DATE, net=INT, net_pct_oi=null(NUM)), min=1),
)
POSITIONING_FUTURES = obj(
    provider=Const("CFTC"), source=STR, credit=STR, lag_note=STR, range_years=Const(3), range_min_reports=INT,
    markets=Arr(COT_MARKET, min=1, max=5),
    missing=Arr(obj(key=COT_MARKET_KEY, label=STR, excluded=COT_SET_ASIDE, reason=STR), max=4),
    revisions_stored=INT,
)
POSITIONING_HOLDINGS = obj(
    provider=Const("SEC"), source=STR, credit=STR, lag_note=STR,
    period=DATE, previous_period=null(DATE), previous_reason=null(STR), deadline=DATE, filings_through=DATE,
    newest_filing=null(DATE), data_sets=Arr(STR, min=1), ftd_files=Arr(STR, min=1),
    filers=INT, filings=INT, restatements=INT, new_holdings=INT, revised_names=INT, computed_at=TS,
    large_filers_n=Const(100), top_positions_n=Const(10), top_holders_n=Const(10),
    # the names a request asks for (names=…), in its order: none when it asks for none
    names=Arr(obj(symbol=STR, requested=STR, issuer=STR, holders=INT, holders_prev=null(INT), holders_change=null(INT), shares=INT,
                  top10_share=FRAC, large_filers_top10=INT), max=25),
    excluded=Arr(obj(symbol=STR, requested=STR, reason=STR), max=25),
)
POSITIONING = obj(futures=Block(POSITIONING_FUTURES), holdings=Block(POSITIONING_HOLDINGS))


# ── GET /options/finder (the Options Finder, design F3 §5; engine method finder-2) ─

OPTION_TYPE = E("call", "put")
OPTION_MODEL = E("black76-escrowed", "american-bbsr-escrowed", "intrinsic")
CARRY_SOURCE = E("market", "dividends only", "none", "outside domain")
SCENARIO_PNL = obj(target=NUM, half=NUM, flat=NUM)  # dollars on the date at the target, halfway, and the close
OPTION_SCREENS = ("bad_row", "outside_window", "beyond_calendar", "nonstandard", "no_bid", "bad_ask", "stale_quote",
                  "no_arbitrage", "low_oi", "wide_spread", "over_budget", "bad_iv", "unpriceable")
OPTION_ROW = obj(
    contract=STR, type=OPTION_TYPE, exp=DATE, strike=NUM, days_past_date=INT, bid=NUM, ask=NUM, mid=NUM, fill=NUM,
    commission=NUM, quote_ts=null(STR), oi=null(NUM), iv=NUM, delta=null(NUM), delta_note=null(STR),
    theta_dollars_day=null(NUM), spread_pct=NUM, n=INT, cost=NUM, unused=NUM, max_loss=NUM,
    breakeven_expiry=null(NUM), breakeven_on_date=null(NUM), breakeven_on_date_note=null(STR),
    pnl=SCENARIO_PNL, modelled=BOOL, iv_minus_10=null(SCENARIO_PNL), iv_plus_10=null(SCENARIO_PNL),
    rn_prob_breakeven=FRAC,
    model=obj(session=OPTION_MODEL, on_date=OneOf((Const("intrinsic"),
                                                   obj(target=OPTION_MODEL, half=OPTION_MODEL, flat=OPTION_MODEL)))),
    model_inputs=obj(rate_session=NUM, rate_on_date=null(NUM), q=NUM, pv_dividends=NUM, forward=NUM, sigma=NUM,
                     t_years=NUM),
    european_value=NUM,
    early_exercise=obj(premium=OneOf((NUM, STR)), flag=E("yes", "no", "within the pricer's tolerance of a cent")),
    event_ids=obj(before_date=Arr(STR), before_expiry=Arr(STR), uncertain=Arr(STR)),
    flags=Arr(STR), carry_source=CARRY_SOURCE,
    provider=obj(iv=null(NUM), delta=null(NUM), theta=null(NUM)),
)
CURVE_SERIES = E("DGS3MO", "DGS2", "DGS5")
OPTIONS_FINDER = obj(
    symbol=STR,
    inputs=obj(view=E("up", "down"), type=OPTION_TYPE, target=NUM, by=DATE, budget=NUM, min_oi=INT, max_spread=NUM,
               fill=E("ask", "mid"), scan_months=INT, commission=NUM, implied_move_pct=NUM, half_price=NUM),
    universe=obj(window=obj(type=OPTION_TYPE, exp_from=DATE, exp_to=DATE, strike_from=NUM, strike_to=NUM),
                 seen=INT, passed=INT, dropped=obj(**{s: INT for s in OPTION_SCREENS}), ranked_out=INT,
                 ranked_out_words=null(STR), truncated=BOOL),
    picks=obj(payoff=null(STR), forgiving=null(STR), time=null(STR)),
    lens_reasons=obj(time=null(STR)),
    empty=null(STR),
    rows=Arr(OPTION_ROW),
    curve=obj(prices=Arr(NUM, min=1), marks=obj(close=NUM, half=NUM, target=NUM), pnl=MapOf(Arr(null(NUM)))),
    rates=obj(points=Arr(obj(series=CURVE_SERIES, date=DATE, yield_pct=NUM, zero_rate=NUM), min=3, max=3), rule=STR),
    carry=Arr(obj(exp=DATE, forward=null(NUM), q=null(NUM), pv_market=null(NUM), pv_schedule=NUM,
                  difference=null(NUM), pairs=INT, source=CARRY_SOURCE, words=STR, atm_vol=null(NUM))),
    dividends=Arr(obj(ex_date=DATE, cum_session=DATE, amount=NUM, period=null(STR),
                      label=E("projected, not declared", "declared"))),
    events=Arr(obj(id=STR, kind=E("earnings", "macro", "dividend"), name=STR, date=DATE,
                   timing=E("bmo", "amc", "dmh", "unknown", "exact", "cum_close"), at=null(TS), source=STR,
                   placement=STR, amount=F(NUM, opt=True), label=F(E("projected, not declared", "declared"), opt=True))),
    coverage=Arr(STR, min=1),
    # design A-3: "known" only when the earnings coverage is complete through the scan's last expiry;
    # design EC section 6: "reconciled" when that coverage is the earnings cache's reconciled one (display on only)
    earnings_status=E("known", "reconciled", "unknown", "not_checked"),
    earnings_moves=Arr(obj(event_id=STR, date=DATE, move_sd_pct=null(NUM), expiries=null(Arr(DATE, min=2, max=2)),
                           reason=null(STR)), max=2),
    stale=null(STR),
    work=obj(used=INT, limit=INT),
    method=obj(version=Const("finder-2"),
               tolerances=obj(value=STR, european_iv=NUM, american_iv=STR, breakeven_european=NUM, delta_tree=NUM,
                              delta_zone=STR),
               lattice=obj(n_min=INT, k_min=INT), notes=Arr(STR)),
    # the route's own (design F3 §5): the scan's coverage, what the answer was priced from, and its sources
    scan=obj(truncated=BOOL, complete_through=null(DATE), requested_through=DATE, requests=INT,
             queried=obj(type=OPTION_TYPE, exp_from=DATE, exp_to=DATE, strike_from=INT, strike_to=INT)),
    market_as_of=obj(chain_session=null(DATE), latest_quote=null(STR), underlying_close=NUM, underlying_close_date=DATE,
                     curve=Arr(obj(series=CURVE_SERIES, date=DATE, value=NUM), min=3, max=3)),
    provider=Const("EODHD"),
    sources=Arr(STR, min=2),
)


# ── The routes ──────────────────────────────────────────────────────────────

# The live routes' ready payloads (the nine of §12.1–§12.9, /sectors since desk/fill-etf, Basket & Hedge's since desk/books,
# /instruments since desk/usability).
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
    "/basket/price": BASKET_PRICE,  # desk/books
    "/basket/hedge": BASKET_HEDGE,  # desk/books
    "/instruments": INSTRUMENTS,  # desk/usability (§12.17)
    "/basket/shares": BASKET_SHARES,  # desk/cap-weight (§12.18)
    "/options/finder": OPTIONS_FINDER,  # the Options Finder (design F3; its page ships unlisted)
    "/basket/study": BASKET_STUDY,  # desk P1a (§12.19)
    "/positioning": POSITIONING,  # Desk P4 (§12.20)
}

# §12.13's deferred resources: GET stubs answering awaiting with these reasons
# (§1.0, §12.3's served reasons; `/basket` is `/basket/:id`).
STUBS: dict[str, str] = {
    "/vol": "needs stored SPY option snapshots and a versioned skew method.",
    "/positions": "Positions are kept in this browser; there is no server position store.",
    "/basket": "Baskets are kept in this browser; there is no server basket store.",
    "/hedge": "option structures for a basket not yet defined in the engine.",
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
    elif isinstance(t, OneOf):
        tried = [[] for _ in t.options]
        for o, e in zip(t.options, tried):
            _walk(o, v, path, e)
        if all(tried):
            errs.append(f"{path}: {v!r:.80} keeps none of its {len(t.options)} declared shapes")
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


def interval_rule(row: dict, path: str, errs: list[str]) -> None:
    """P1d §4/§8, one §12.2/§12.19 horizons[] row: the four optional range fields are served all together or not
    at all; every pair is null when `ci_lo` is null; otherwise each level's pair is null, or two numbers lo ≤ hi."""
    have = [k for k in OPTIONAL_RANGE_KEYS if k in row]
    if not have:
        return
    if len(have) != len(OPTIONAL_RANGE_KEYS):
        errs.append(f"{path}: serves {have} of the four 80%/95% range fields, never only some")
        return
    no_ninety = row.get("ci_lo") is None or row.get("ci_hi") is None
    for level in ("80", "95"):
        lo, hi = row[f"ci{level}_lo"], row[f"ci{level}_hi"]
        if lo is None and hi is None:
            continue
        if no_ninety:
            errs.append(f"{path}: a {level}% range where the row has no 90% one")
        elif lo is None or hi is None:
            errs.append(f"{path}: the {level}% bounds are null together or not at all")
        elif not (_scalar_ok(NUM, lo) and _scalar_ok(NUM, hi)) or lo > hi:
            errs.append(f"{path}: the {level}% range {lo!r} to {hi!r} is not two numbers lo ≤ hi")


def _horizon_rows(v: Any, path: str, errs: list[str]) -> None:
    """`interval_rule` on every horizons[] row of an answer (a dict carrying `ci_lo` and `n_blocks`)."""
    if isinstance(v, dict):
        if "ci_lo" in v and "n_blocks" in v:
            interval_rule(v, path, errs)
        for k, x in v.items():
            _horizon_rows(x, f"{path}.{k}" if path else k, errs)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            _horizon_rows(x, f"{path}[{i}]", errs)


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
        _horizon_rows(body["data"], "", errs)
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
    if isinstance(t, OneOf):
        return example(t.options[0], nulls=nulls)
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
