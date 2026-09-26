"""Desk series registry (desk/event-study, 2026-09-21). Stdlib only.

One declared record per asset the event-study engine may read. Nothing here
is inferred from data: the shock unit, the declared history start, the tier,
the roles and the store are all stated, and the API's assets endpoint is
generated from this list (never hand-typed in the UI).

Stores
  fred          FRED daily observations in `desk_series` (src/market_data/desk_history.py)
  market        EODHD-first / Yahoo-fallback adjusted closes in `desk_series` (same writer)
  asset_prices  allocation's stored histories (`asset_prices`, interval '1d'); the
                writer never touches that table

Shock units (EVENT_STUDY_SPEC §2): price series → log return; yields and
spreads → change in basis points (FRED serves them in percent, so `scale` is
100); VIX → log change. Two timing rules per series, resolved per date
against the NYSE session (api.calendar.session_bounds, so an early close is
handled; review R-02): `fixed`, when the day's stored value is determined
(the price a target can be entered at), and `known`, when a desk can see it.
A rule is (anchor, offset minutes): ("open", m), ("close", m),
("next_open", m) for a value public only at the next session's open,
("clock", minutes after midnight New York), or ("session_clock", n × 1440 +
minutes after midnight New York) for a value public only at that clock time
on the n-th exchange session after its date (desk/hardening review R-01:
WTI, which EIA publishes weekly). The engine enters a target at
the event date's close only when the target's value is fixed at or after
every input is known; otherwise at the first later session whose fixing is
(the next session for every input but WTI, the eighth for WTI). `defer_as_target`
(review R-03) forces the next session whenever the series is the target,
because its fixing time is ambiguous. `known_by` is derived for the assets
endpoint: "close" when public by the session close, "after_close" otherwise.

Rules declared: index closes at the session close; gold (GC=F) and copper at
17:00 ET clock, the conservative reading (decision 2026-09-21: Yahoo's daily
close for CME futures may be the settlement or the Globex close), deferred as
targets; FRED daily Treasury values (DGS10, DGS2, T10Y2Y) are read ~30 min
before the close and known at the next session open (review R-01: a FRED
daily value is never same-day); ICE BofA OAS is priced an hour before the
close and known at the next session open (R-01); VIX settles 15 min after
the close; the ICE dollar index closes at 17:00 ET; WTI spot (EIA) settles
14:30, and because EIA publishes the series weekly each observation is known
at 13:00 ET on the eighth business day (XNYS session) after its date, the
conservative reading of the weekly cycle (review R-01), so a WTI-dated event
enters any target eight sessions later. USD/JPY is read at 20:00 ET
(desk/hardening, 2026-09-23): Yahoo dates an FX daily bar by its London day
and EODHD by its UTC day, so the bar closes 19:00 to 20:00 New York time, not
at the 17:00 New York close; the later reading keeps a same-session entry from
reading a value that was not yet printed.
"""

from __future__ import annotations

from dataclasses import dataclass

HISTORY_BAR = "1990-12-31"  # default lists carry only series with history from 1990 or earlier (the year, not the day)
# The tier the full refresh stores (refresh-data.yml's "Store Desk daily series"
# step runs `desk_history --tier 2`; pinned by tests/test_desk_api.py). A series
# at or below it that a database lacks is awaiting that refresh; one above it is
# planned and no refresh will store it until the step changes (desk/integration).
# Tier 2 since desk/hardening (2026-09-23): WTI, the Nasdaq 100, the dollar index
# and USD/JPY. scripts/validate_db.py judges tier 1 and only warns on tier 2.
REFRESH_TIER = 2
UNITS =("log_return", "bp", "log_change")
SOURCES = ("fred", "market", "asset_prices")
ROLES = ("shock", "condition", "target")
KNOWN_BY = ("close", "after_close")
ANCHORS = ("open", "close", "next_open", "clock", "session_clock")
Rule = tuple[str, int]
AT_CLOSE: Rule = ("close", 0)
NEXT_OPEN: Rule = ("next_open", 0)
# Verifier V-31 (desk/hardening): the zone whose calendar date is a series'
# current trading day at its provider. A row dated after that day is
# future-dated; one dated after the last completed New York session but not
# after that day is a bar still in progress, which the store's session filter
# drops. New York's date for FRED and for anything traded in New York's
# session. For an instrument traded round the clock, the date in Tokyo, where
# its trading day starts: no provider dates a bar later than that, whether by
# the London or UTC day (FX) or by a next-day trade date taken in the New
# York evening (futures).
NY_ZONE = "America/New_York"
ROUND_THE_CLOCK_ZONE = "Asia/Tokyo"


def clock(hour: int, minute: int = 0) -> Rule:
    return ("clock", hour * 60 + minute)


def session_clock(sessions: int, hour: int, minute: int = 0) -> Rule:
    """The New York clock time on the `sessions`-th exchange session after
    the date, as ("session_clock", sessions × 1440 + minutes after midnight)."""
    return ("session_clock", sessions * 1440 + hour * 60 + minute)


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rule_str(rule: Rule) -> str:
    anchor, off = rule
    if anchor == "clock":
        return f"{off // 60:02d}:{off % 60:02d} ET clock"
    if anchor == "session_clock":
        n, m = divmod(off, 1440)
        return f"{m // 60:02d}:{m % 60:02d} ET on the {_ordinal(n)} business day after (XNYS sessions)"
    base = {"open": "session open", "close": "session close", "next_open": "next session open"}[anchor]
    if off == 0:
        return base
    return f"{base} {'+' if off > 0 else '−'} {abs(off)} min"


@dataclass(frozen=True)
class DeskSeries:
    key: str            # API slug: shock=gold, target=spx
    label: str
    source: str         # fred | market | asset_prices
    series_id: str      # FRED id, or the symbol as the store spells it
    unit: str           # log_return | bp | log_change
    scale: float        # multiplier before the bp difference (100: percent → bp)
    history_from: str   # declared first observation (verified against the store by the writer)
    tier: int           # 1, 2, 3 (3 = deferred, not fetched)
    roles: tuple[str, ...]
    fixed: Rule = AT_CLOSE          # when the day's value is determined (see rule_str)
    known: Rule = AT_CLOSE          # when a desk can see it
    defer_as_target: bool = False   # R-03: as a target, always enter the next session
    eodhd: str | None = None   # market source only
    note: str | None = None    # shown with the history_from warning
    known_note: str | None = None  # why `known` is late, stated in a study's verdict (review R-01)
    day_zone: str = NY_ZONE    # V-31: the zone whose date is the provider's current trading day (see ROUND_THE_CLOCK_ZONE)
    available: bool = True     # False: listed with `reason`, never fetched, never selectable
    reason: str | None = None  # the one-line reason when unavailable

    @property
    def warn(self) -> bool:
        return self.history_from > HISTORY_BAR

    @property
    def known_by(self) -> str:
        anchor, off = self.known
        return "close" if anchor == "open" or (anchor == "close" and off <= 0) else "after_close"

    @property
    def table(self) -> str:
        return "asset_prices" if self.source == "asset_prices" else "desk_series"


_ALL = ("shock", "condition", "target")
_SC = ("shock", "condition")

SERIES: tuple[DeskSeries, ...] = (
    # ── tier 1 ────────────────────────────────────────────────────────────
    DeskSeries("spx", "S&P 500", "asset_prices", "^GSPC", "log_return", 1.0, "1990-01-02", 1, _ALL,
               note="Stored from 1990 by the allocation refresh (asset_prices)."),
    DeskSeries("gold", "Gold (COMEX front month)", "asset_prices", "GC=F", "log_return", 1.0, "2000-08-30", 1, _ALL,
               fixed=clock(17, 0), known=clock(17, 0), defer_as_target=True,
               note="COMEX front-month futures (GC=F), stored from 2000-08-30 by the allocation refresh; studies on gold say \"since 2000\". "
                    "The daily close is declared at 17:00 ET (conservative), so a gold shock enters an equity target the next session; "
                    "as a target its fixing time is ambiguous, so entry is always the next session."),
    DeskSeries("gold_lbma", "Gold (LBMA PM fix)", "fred", "GOLDPMGBD228NLBM", "log_return", 1.0, "1968-04-01", 3, (),
               available=False, reason="FRED no longer serves GOLDPMGBD228NLBM (checked 2026-09-21); gold uses GC=F."),
    DeskSeries("us10y", "10Y Treasury", "fred", "DGS10", "bp", 100.0, "1962-01-02", 1, _ALL, fixed=("close", -30), known=NEXT_OPEN),
    DeskSeries("us2y", "2Y Treasury", "fred", "DGS2", "bp", 100.0, "1976-06-01", 1, _SC, fixed=("close", -30), known=NEXT_OPEN),
    DeskSeries("curve_2s10s", "2s10s curve", "fred", "T10Y2Y", "bp", 100.0, "1976-06-01", 1, _SC, fixed=("close", -30), known=NEXT_OPEN),
    DeskSeries("vix", "VIX", "fred", "VIXCLS", "log_change", 1.0, "1990-01-02", 1, _ALL, fixed=("close", 15), known=("close", 15),
               note="CBOE close via FRED VIXCLS; settles 16:15 ET, so a VIX-dated event enters the target the next session."),
    # desk/hardening (2026-09-23): FRED's three-year window starts 2023-09-25 since
    # 2026-09-22, the day the deployed store's first full refresh ran; a store filled
    # earlier holds 2023-09-22 on, which is inside the declaration.
    DeskSeries("hy_oas", "US HY OAS", "fred", "BAMLH0A0HYM2", "bp", 100.0, "2023-09-25", 1, _ALL, fixed=("close", -60), known=NEXT_OPEN,
               note="ICE BofA index OAS, published the next morning. FRED serves a rolling three years only "
                    "(since April 2026); the store keeps every observation it has been served, from 2023-09-25."),
    # ── tier 2 ────────────────────────────────────────────────────────────
    DeskSeries("wti", "WTI crude", "fred", "DCOILWTICO", "log_return", 1.0, "1986-01-02", 2, _SC, fixed=clock(14, 30),
               known=session_clock(8, 13, 0), known_note="EIA publishes the WTI spot series weekly",
               note="EIA spot price via FRED, which EIA publishes weekly, so the newest print can be a week old; each value is taken as "
                    "known at 13:00 ET on the eighth business day after its date. "
                    "Settled at −$36.98 on 2020-04-20: a price at or below zero has no log return, and the study counts it as an exclusion."),
    DeskSeries("ndx", "Nasdaq 100", "market", "^NDX", "log_return", 1.0, "1985-10-01", 2, _ALL, eodhd="NDX.INDX"),
    DeskSeries("rut", "Russell 2000", "asset_prices", "^RUT", "log_return", 1.0, "1990-01-02", 2, _SC,
               note="Stored from 1990 by the allocation refresh (asset_prices)."),
    DeskSeries("dxy", "US Dollar Index", "market", "DX-Y.NYB", "log_return", 1.0, "1971-01-04", 2, _ALL, eodhd="DXY.INDX", fixed=clock(17, 0), known=clock(17, 0),
               day_zone=ROUND_THE_CLOCK_ZONE),
    DeskSeries("usdjpy", "USD/JPY", "market", "JPY=X", "log_return", 1.0, "1996-10-30", 2, _SC, eodhd="USDJPY.FOREX", fixed=clock(20, 0), known=clock(20, 0),
               day_zone=ROUND_THE_CLOCK_ZONE,
               note="Yahoo history starts 1996-10-30. The daily bar closes 19:00 to 20:00 ET (London or UTC day), read at 20:00 ET."),
    # ── tier 3 (deferred) ─────────────────────────────────────────────────
    DeskSeries("copper", "Copper", "market", "HG=F", "log_return", 1.0, "2000-08-30", 3, _SC, fixed=clock(17, 0), known=clock(17, 0), defer_as_target=True,
               day_zone=ROUND_THE_CLOCK_ZONE,
               note="Front-month futures; history from 2000-08-30."),
) + tuple(
    DeskSeries(t.lower(), f"{name} sector ETF ({t})", "market", t, "log_return", 1.0, "1998-12-22", 3, _SC,
               eodhd=f"{t}.US", note="Sector ETFs list from 1998-12-22.")
    for t, name in (
        ("XLB", "Materials"), ("XLE", "Energy"), ("XLF", "Financials"), ("XLI", "Industrials"),
        ("XLK", "Technology"), ("XLP", "Consumer Staples"), ("XLU", "Utilities"),
        ("XLV", "Health Care"), ("XLY", "Consumer Discretionary"),
    )
)

BY_KEY: dict[str, DeskSeries] = {s.key: s for s in SERIES}
BY_SERIES_ID: dict[str, DeskSeries] = {s.series_id: s for s in SERIES}


def fetched(tier: int) -> list[DeskSeries]:
    """The series the writer stores at this tier: fred and market sources only
    (asset_prices rows belong to the allocation refresh), tiers ≤ `tier`, and
    never tier 3 (deferred by decision, whatever `tier` says)."""
    return [s for s in SERIES if s.available and s.source != "asset_prices" and s.tier <= min(tier, 2)]


def stored_by_refresh(spec: DeskSeries) -> bool:
    """True when the full refresh stores this series (desk/integration): the
    allocation refresh's asset_prices rows always, desk_series rows at or
    below REFRESH_TIER. A database lacking such a series is awaiting that
    refresh; any other missing series is planned or deferred."""
    return spec.available and (spec.source == "asset_prices" or spec in fetched(REFRESH_TIER))


def with_role(role: str) -> list[DeskSeries]:
    return [s for s in SERIES if s.available and role in s.roles]


def get(key: str) -> DeskSeries:
    try:
        return BY_KEY[key]
    except KeyError:
        raise KeyError(f"unknown desk series {key!r}; known: {', '.join(BY_KEY)}") from None
