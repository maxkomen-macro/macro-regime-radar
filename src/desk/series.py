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
("next_open", m) for a value public only at the next session's open, or
("clock", minutes after midnight New York). The engine enters a target at
the event date's close only when the target's value is fixed at or after
every input is known; otherwise at the next session. `defer_as_target`
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
the close; the ICE dollar index and FX daily bars close at 17:00 ET; WTI spot
(EIA) settles 14:30 and is known at the next session open.
"""

from __future__ import annotations

from dataclasses import dataclass

HISTORY_BAR = "1990-12-31"  # default lists carry only series with history from 1990 or earlier (the year, not the day)
# The tier the full refresh stores (refresh-data.yml's "Store Desk daily series"
# step runs `desk_history --tier 1`; pinned by tests/test_desk_api.py). A series
# at or below it that a database lacks is awaiting that refresh; one above it is
# planned and no refresh will store it until the step changes (desk/integration).
REFRESH_TIER = 1
UNITS =("log_return", "bp", "log_change")
SOURCES = ("fred", "market", "asset_prices")
ROLES = ("shock", "condition", "target")
KNOWN_BY = ("close", "after_close")
ANCHORS = ("open", "close", "next_open", "clock")
Rule = tuple[str, int]
AT_CLOSE: Rule = ("close", 0)
NEXT_OPEN: Rule = ("next_open", 0)


def clock(hour: int, minute: int = 0) -> Rule:
    return ("clock", hour * 60 + minute)


def rule_str(rule: Rule) -> str:
    anchor, off = rule
    if anchor == "clock":
        return f"{off // 60:02d}:{off % 60:02d} ET clock"
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
    DeskSeries("hy_oas", "US HY OAS", "fred", "BAMLH0A0HYM2", "bp", 100.0, "2023-09-22", 1, _ALL, fixed=("close", -60), known=NEXT_OPEN,
               note="ICE BofA index OAS, published the next morning. FRED serves a rolling three years only "
                    "(since April 2026); the store keeps every observation it has been served, from 2023-09-22."),
    # ── tier 2 ────────────────────────────────────────────────────────────
    DeskSeries("wti", "WTI crude", "fred", "DCOILWTICO", "log_return", 1.0, "1986-01-02", 2, _SC, fixed=clock(14, 30), known=NEXT_OPEN,
               note="EIA spot price via FRED, published after the day."),
    DeskSeries("ndx", "Nasdaq 100", "market", "^NDX", "log_return", 1.0, "1985-10-01", 2, _ALL, eodhd="NDX.INDX"),
    DeskSeries("rut", "Russell 2000", "asset_prices", "^RUT", "log_return", 1.0, "1990-01-02", 2, _SC,
               note="Stored from 1990 by the allocation refresh (asset_prices)."),
    DeskSeries("dxy", "US Dollar Index", "market", "DX-Y.NYB", "log_return", 1.0, "1971-01-04", 2, _ALL, eodhd="DXY.INDX", fixed=clock(17, 0), known=clock(17, 0)),
    DeskSeries("usdjpy", "USD/JPY", "market", "JPY=X", "log_return", 1.0, "1996-10-30", 2, _SC, eodhd="USDJPY.FOREX", fixed=clock(17, 0), known=clock(17, 0),
               note="Yahoo history starts 1996-10-30."),
    # ── tier 3 (deferred) ─────────────────────────────────────────────────
    DeskSeries("copper", "Copper", "market", "HG=F", "log_return", 1.0, "2000-08-30", 3, _SC, fixed=clock(17, 0), known=clock(17, 0), defer_as_target=True,
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


def with_role(role: str) -> list[DeskSeries]:
    return [s for s in SERIES if s.available and role in s.roles]


def get(key: str) -> DeskSeries:
    try:
        return BY_KEY[key]
    except KeyError:
        raise KeyError(f"unknown desk series {key!r}; known: {', '.join(BY_KEY)}") from None
