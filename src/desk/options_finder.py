"""src/desk/options_finder.py — the Options Finder's engine (method finder-2).

A visitor states a view: a US stock or ETF goes up (or down) to a target price by a date, risking a budget.
The engine reads one end-of-day option chain and says, for every listed call (or put) that passes the
screens, what the position the budget buys would be worth on that date if the stock is at the target,
halfway there, or unchanged; it ranks by three lenses, each a plain sort, never a blended score.

finder-2 (docs/desk/OPTIONS_FINDER_MODEL.md): each contract's own implied volatility, solved from its mid;
the Treasury curve; the market's forward per expiry from de-Americanized put-call parity with the dividend
schedule as a cross-check; American values on a dividend-exact lattice wherever early exercise can matter;
no-arbitrage checks on executable prices; earnings, dividends and macro releases placed against the dates.

Pure: no I/O and no clock. api/desk_options.py fetches everything and calls `run`.
"""

from __future__ import annotations

import calendar
import math
import re
import statistics
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation
from typing import Any, Callable, Iterable, Mapping, Sequence
from zoneinfo import ZoneInfo

from src.desk import options_math as om

# --- Dividends, the market forward per expiry, and the arbitrage envelope (design F2 section 3, 6) ---

REGULAR = {"Monthly": 1, "Quarterly": 3, "SemiAnnual": 6, "Annual": 12}
MAX_PROJECTED = 48
# An input-sanity limit, not the pricer's domain: a row above half the price is a data error and is ignored.
# A large real dividend (a special) is kept, and the pricer refuses the contexts it falls in (DR-47).
DIV_SANITY_FRAC = 0.5
PAIR_SPREAD = Decimal("0.10")
PAIRS_PER_EXPIRY = 3
FORWARD_ITER = 24
Q_ACCEPT = 1.0


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


# ── the session calendar the route passes ────────────────────────────────────

@dataclass(frozen=True)
class Sessions:
    """NYSE sessions (date → close instant) from the chain session through `through`."""
    closes: Mapping[date, datetime]
    through: date

    def is_session(self, d: date) -> bool:
        return d in self.closes

    def next_on_or_after(self, d: date) -> date | None:
        while d <= self.through:
            if d in self.closes:
                return d
            d += timedelta(days=1)
        return None

    def previous(self, d: date) -> date | None:
        d -= timedelta(days=1)
        first = min(self.closes)
        while d >= first:
            if d in self.closes:
                return d
            d -= timedelta(days=1)
        return None


# ── dividends (design sections 2 and 3) ──────────────────────────────────────

@dataclass(frozen=True)
class Dividend:
    ex_date: date
    cum_session: date
    amount: float
    period: str | None
    projected: bool

    @property
    def regular(self) -> bool:
        return self.period in REGULAR


def _date(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def normalize_dividends(rows: Iterable[Mapping[str, Any]], s0: float) -> tuple[list[Dividend], int]:
    """Valid declared and past rows, exact duplicates dropped; (rows, ignored count)."""
    out: dict[tuple, Dividend] = {}
    ignored = 0
    for r in rows:
        ex, cum = _date(r.get("ex_date")), _date(r.get("cum_session"))
        amt = r.get("amount")
        ok = (ex is not None and cum is not None and cum < ex and isinstance(amt, (int, float)) and not isinstance(amt, bool)
              and math.isfinite(amt) and 0 < amt <= DIV_SANITY_FRAC * s0)
        if not ok:
            ignored += 1
            continue
        period = r.get("period") if isinstance(r.get("period"), str) else None
        key = (ex, float(amt), period)
        out.setdefault(key, Dividend(ex, cum, float(amt), period, False))
    return sorted(out.values(), key=lambda d: (d.ex_date, d.amount)), ignored


def schedule(divs: Sequence[Dividend], session: date, last_expiry: date, cal: Sessions) -> tuple[list[Dividend], list[str]]:
    """Declared dividends after the session plus regular projections (design section 3, DR-36, DR-38)."""
    notes: list[str] = []
    declared = [d for d in divs if d.cum_session >= session]
    past_regular = [d for d in divs if d.ex_date <= session and d.regular]
    if not past_regular:
        notes.append("No regular dividend history: no dividends are projected.")
        return declared, notes
    base = past_regular[-1]
    months = REGULAR[base.period]
    if add_months(base.ex_date, (3 * months + 1) // 2) < session:  # more than 1.5 cadences ago
        notes.append(f"The last regular dividend was on {base.ex_date.isoformat()}: none are projected.")
        return declared, notes
    candidates: list[Dividend] = []
    k = 1
    while len(candidates) < MAX_PROJECTED:
        ex = add_months(base.ex_date, k * months)
        k += 1
        if ex > last_expiry:
            break
        ex_s = cal.next_on_or_after(ex)
        if ex_s is None:
            break
        cum = cal.previous(ex_s)
        if cum is None or cum < session:
            continue
        candidates.append(Dividend(ex_s, cum, base.amount, base.period, True))
    half_cadence = lambda a, b: abs((a - b).days) <= months * 365.25 / 24  # c/2 months, in days
    keep = list(candidates)
    for d in (d for d in declared if d.regular):
        near = [c for c in keep if half_cadence(c.ex_date, d.ex_date)]
        if near:
            keep.remove(min(near, key=lambda c: (abs((c.ex_date - d.ex_date).days), c.ex_date)))
    return sorted(declared + keep, key=lambda d: (d.cum_session, d.amount)), notes


def owed(divs: Sequence[Dividend], start: date, end: date) -> tuple[tuple[int, float], ...]:
    """The (day, amount) pairs a context from `start` to expiry `end` owes: cum session in [start, end)."""
    return tuple(((d.cum_session - start).days, d.amount) for d in divs if start <= d.cum_session < end)


# ── no-arbitrage (design section 6) ──────────────────────────────────────────

def _cross(o, a, b) -> Decimal:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def lower_hull(points: Sequence[tuple[Decimal, Decimal]]) -> list[tuple[Decimal, Decimal]]:
    pts = sorted(set(points))
    hull: list[tuple[Decimal, Decimal]] = []
    for p in pts:
        while len(hull) >= 2 and _cross(hull[-2], hull[-1], p) <= 0:
            hull.pop()
        hull.append(p)
    return hull


def _hull_at(hull, k: Decimal) -> tuple[Decimal, tuple]:
    """The lower hull's value at k (inside its strike range) and the edge's end strikes."""
    for (k1, a1), (k2, a2) in zip(hull, hull[1:]):
        if k1 <= k <= k2:
            return a1 + (a2 - a1) * (k - k1) / (k2 - k1), (k1, k2)
    k0, a0 = hull[0]
    return a0, (k0,)


def envelope_violations(rows: Sequence[tuple[Decimal, Decimal, Decimal]], is_call: bool, h: Decimal) -> dict[int, set[Decimal]]:
    """rows: (strike, bid, ask). For each row j with b_j > h_j: the strikes whose asks attain h_j."""
    asks = [(k, a) for k, _, a in rows]
    hull = lower_hull(asks)
    bad: dict[int, set[Decimal]] = {}
    for j, (kj, bj, aj) in enumerate(rows):
        best, src = aj, {kj}
        for ki, _, ai in rows:
            if ki == kj:
                continue
            if is_call:
                val = ai if ki < kj else ai + h * (ki - kj)
            else:
                val = ai if ki > kj else ai + h * (kj - ki)
            if val < best:
                best, src = val, {ki}
        hv, edge = _hull_at(hull, kj)
        if hv < best:
            best, src = hv, set(edge)
        if bj > best:
            bad[j] = src | {kj}
    return bad


# ── the market's forward per expiry (design section 3) ───────────────────────

@dataclass(frozen=True)
class Leg:
    strike: float
    mid: float
    bid: float
    ask: float


@dataclass(frozen=True)
class Carry:
    forward: float | None
    q: float
    source: str           # "market", "dividends only", "none"
    pairs: int
    atm_vol: float | None
    pair_points: tuple[tuple[float, float], ...] = ()  # (strike, common sigma) of the usable pairs


def pair_forward_gen(s0: float, k: float, call: float, put: float, days: int, rho: float,
                     divs: tuple[tuple[int, float], ...], evals: list[int] | None = None, accelerate: bool = True):
    """De-Americanized parity for one pair (a solver generator: it yields the non-exempt legs' contexts and
    receives their values). Returns (forward, common sigma), or None when the pair is unusable.

    G(F): each leg's early-exercise premium at its current sigma under carry q(F), the European inversions of
    the de-Americanized prices, and the parity forward of those. The market forward is G's fixed point; it is
    accepted when |G(F) − F| <= 1e-9·S0. G contracts linearly, so after every two plain steps an Aitken
    (Steffensen) step jumps to the extrapolated fixed point. At most FORWARD_ITER evaluations of G."""
    iv = lambda c, p: om.iv_european(c, p, evals=evals)
    tau = days / om.YEAR_DAYS
    df = math.exp(-rho * tau)
    pv = sum(a * math.exp(-rho * d / om.YEAR_DAYS) for d, a in divs)
    s_star = s0 - pv
    if s_star <= 0:
        return None
    f = k + (call - put) / df
    if f <= 0:
        return None

    def sigmas(fwd: float, eep_c: float, eep_p: float):
        q = math.log(s_star / (fwd * df)) / tau
        return (iv(om.Context(True, s0, k, days, rho, q, 0.3, divs), call - eep_c),
                iv(om.Context(False, s0, k, days, rho, q, 0.3, divs), put - eep_p))

    def g(fwd: float, sc: float, sp: float):
        """One evaluation of G: (G(F), its two sigmas), or None."""
        q = math.log(s_star / (fwd * df)) / tau
        if abs(q) > om.Q_MAX:
            return None
        legs = (om.Context(True, s0, k, days, rho, q, sc, divs), om.Context(False, s0, k, days, rho, q, sp, divs))
        need = [c for c in legs if not om.exempt(c)]
        vals = iter((yield need) if need else ())
        eep_c, eep_p = (0.0 if om.exempt(c) else next(vals) - om.european(c) for c in legs)
        f2 = k + ((call - eep_c) - (put - eep_p)) / df
        if f2 <= 0:
            return None
        sc2, sp2 = sigmas(f2, eep_c, eep_p)
        if sc2 is None or sp2 is None:
            return None
        return f2, sc2, sp2

    sc, sp = sigmas(f, 0.0, 0.0)
    if sc is None or sp is None:
        return None
    hist: list[float] = []
    for _ in range(FORWARD_ITER):
        got = yield from g(f, sc, sp)
        if got is None:
            return None
        f2, sc2, sp2 = got
        if abs(f2 - f) <= 1e-9 * s0:
            return f2, 0.5 * (sc2 + sp2)
        hist.append(f)
        if accelerate and len(hist) == 2:
            f0, f1 = hist
            den = f2 - 2.0 * f1 + f0
            hist = []
            if den != 0.0:
                fa = f0 - (f1 - f0) ** 2 / den
                if fa > 0 and abs(fa - f2) < abs(f1 - f0):  # an extrapolation that stays near the iterates
                    f2 = fa
        f, sc, sp = f2, sc2, sp2
    return None

# --- The engine ---

VERSION = "finder-2"
NY = ZoneInfo("America/New_York")

VIEWS = ("up", "down")
FILLS = ("ask", "mid")
DEFAULT_MIN_OI = 100
DEFAULT_MAX_SPREAD = 0.10
DEFAULT_FILL = "ask"
DEFAULT_SCAN_MONTHS = 6
IV_MIN, IV_MAX = 0.05, 3.00
IV_SHOCK = 0.10
IV_FLOOR = 0.01
BUDGET_MIN, BUDGET_MAX = 1.0, 10_000_000.0
COMMISSION_MAX = 100.0
SPOT_MIN, SPOT_MAX = 0.01, 1_000_000.0
MAX_TARGET_MULTIPLE = 10
MAX_HORIZON_DAYS = 3 * 366
MAX_EXPIRY_DAYS = 4 * 366
MIN_OI_MAX = 1_000_000
SPREAD_MIN, SPREAD_MAX = 0.01, 1.00
SCAN_MONTHS_MIN, SCAN_MONTHS_MAX = 1, 12
YIELD_MIN, YIELD_MAX = -5.0, 25.0
CURVE_STALE_DAYS = 7
CONTRACT_SIZE = 100
TICK = 0.01
QUOTE_MAX = 1_000_000.0
CURVE_POINTS = 81
STRIKE_BELOW_CLOSE, STRIKE_PAST_TARGET = 0.20, 0.30
EXERCISE_FLAG = 0.01
WORK_LIMIT = 300_000_000
CAPS = {"rows": 2_500, "other_rows": 1_500, "event_rows": 400, "dividends": 500, "events": 100}
CURVE_SERIES = ("DGS3MO", "DGS2", "DGS5")
LENSES = ("payoff", "forgiving", "time")

SCREENS = ("bad_row", "outside_window", "beyond_calendar", "nonstandard", "no_bid", "bad_ask", "stale_quote",
           "no_arbitrage", "wide_spread", "low_oi", "over_budget", "bad_iv", "unpriceable")
SCREEN_WORDS = {
    "bad_row": "had no contract id, strike or expiry",
    "outside_window": "were outside the scan window",
    "beyond_calendar": "expire after the market calendar the Finder knows",
    "nonstandard": "were not standard contracts (adjusted after a corporate action)",
    "no_bid": "had no bid",
    "bad_ask": "had no usable ask",
    "stale_quote": "had a quote from another session",
    "no_arbitrage": "had quotes that contradict other strikes or expiries (an arbitrage in the quotes)",
    "wide_spread": "were too wide",
    "low_oi": "had too little open interest",
    "bad_iv": "had no implied volatility from 5% to 300% that reprices their mid",
    "over_budget": "cost more than the budget",
    "unpriceable": "could not be priced",
}


class FinderError(ValueError):
    """A thesis the engine cannot run; the message names what is wrong. `kind`: "input" (a visitor's
    parameter or too much work: the route answers 422), "market" (a value the route fetched: 502) or
    "stale" (the chain is two or more sessions behind: 503)."""

    def __init__(self, message: str, kind: str = "input") -> None:
        super().__init__(message)
        self.kind = kind


OutOfDomain = om.OutOfDomain


# ── numbers ──────────────────────────────────────────────────────────────────

def _num(x: Any) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    v = float(x)
    return v if math.isfinite(v) else None


def _dec(x: float | int) -> Decimal:
    return Decimal(x) if isinstance(x, int) else Decimal(repr(float(x)))


def budget_cents(budget: float) -> int:
    return int((_dec(budget) * 100).to_integral_value(rounding=ROUND_FLOOR))


def premium_cents(raw: Decimal) -> int:
    return int((raw * 10_000).to_integral_value(rounding=ROUND_CEILING))


def commission_cents(c: float) -> int:
    return int((_dec(c) * 100).to_integral_value(rounding=ROUND_CEILING))


def money(x: float) -> str:
    return f"${x:,.2f}"


def _day(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


# ── the work budget (model document, "Work budget") ──────────────────────────

class Work:
    def __init__(self, limit: int = WORK_LIMIT) -> None:
        self.used = 0
        self.limit = limit

    def charge(self, units: int) -> None:
        if self.used + units > self.limit:
            raise FinderError("Too much to price at once: shorten the scan window or narrow the strikes.")
        self.used += units


# ── inputs ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Thesis:
    view: str
    target: float
    by: date
    budget: float
    min_oi: int = DEFAULT_MIN_OI
    max_spread: float = DEFAULT_MAX_SPREAD
    fill: str = DEFAULT_FILL
    scan_months: int = DEFAULT_SCAN_MONTHS
    commission: float = 0.0

    @property
    def kind(self) -> str:
        return "call" if self.view == "up" else "put"


@dataclass(frozen=True)
class Market:
    """What the route fetched about the session the quotes describe."""
    session: date
    spot: float
    curve_rows: Mapping[str, Sequence[tuple[str, float]]]  # series → [(YYYY-MM-DD, percent)]
    closes: Mapping[date, datetime]  # NYSE session → close instant (UTC), session through calendar_through
    calendar_through: date
    latest_session: date
    sessions_behind: int
    occ_root: str
    symbol: str = ""  # the listing as the page names it (BRK.B); the OCC root when empty


def build_curve(rows: Mapping[str, Sequence[tuple[str, float]]], session: date) -> tuple[om.Curve, list[dict], list[str]]:
    points, notes = [], []
    zeros = {}
    for series in CURVE_SERIES:
        obs = [(d, v) for d, v in ((_date(a), _num(b)) for a, b in rows.get(series, ())) if d is not None and v is not None and d <= session]
        if not obs:
            raise FinderError(f"No stored {series} observation on or before the session.", "market")
        d, y = max(obs)
        if not YIELD_MIN <= y <= YIELD_MAX:
            raise FinderError(f"The stored {series} yield {y}% is outside -5% to 25%.", "market")
        z = om.zero_rate_3m(y) if series == "DGS3MO" else om.zero_rate_par(y)
        zeros[series] = z
        points.append({"series": series, "date": d.isoformat(), "yield_pct": y, "zero_rate": z})
        if (session - d).days > CURVE_STALE_DAYS:
            notes.append(f"The newest stored {series} is from {_day(d)}.")
    return om.Curve(zeros["DGS3MO"], zeros["DGS2"], zeros["DGS5"]), points, notes


def validate(t: Thesis, m: Market) -> None:
    if t.view not in VIEWS:
        raise FinderError(f"The view {t.view!r} is not up or down.")
    if t.fill not in FILLS:
        raise FinderError(f"The fill {t.fill!r} is not ask or mid.")
    spot = _num(m.spot)
    if spot is None or not (SPOT_MIN <= spot <= SPOT_MAX):
        raise FinderError("The session close is not a price from $0.01 to $1,000,000.", "market")
    x = _num(t.target)
    if x is None or x <= 0:
        raise FinderError("The target is not a positive price.")
    close = f"the {m.session:%b} {m.session.day:02d}, {m.session.year} close of {money(spot)}"
    if t.view == "up":
        if x <= spot:
            raise FinderError(f"A view up needs a target above {close}.")
        if x > MAX_TARGET_MULTIPLE * spot:
            raise FinderError(f"The target is more than {MAX_TARGET_MULTIPLE:g} times {close}.")
    else:
        if x >= spot:
            raise FinderError(f"A view down needs a target below {close}.")
        if x < spot / MAX_TARGET_MULTIPLE:
            raise FinderError(f"The target is less than a tenth of {close}.")
    if t.by <= m.session:
        raise FinderError(f"The date must be after {m.session.isoformat()}, the session the quotes describe.")
    if (t.by - m.session).days > MAX_HORIZON_DAYS:
        raise FinderError("The date is more than three years after the session the quotes describe.")
    if t.by > m.calendar_through:
        raise FinderError(f"The market calendar is known through {_day(m.calendar_through)}; pick a date on or before it.")
    b = _num(t.budget)
    if b is None or not (BUDGET_MIN <= b <= BUDGET_MAX):
        raise FinderError("The budget is not between $1 and $10,000,000.")
    c = _num(t.commission)
    if c is None or not (0.0 <= c <= COMMISSION_MAX):
        raise FinderError("The commission is not between $0 and $100 per contract.")
    if isinstance(t.min_oi, bool) or not isinstance(t.min_oi, int) or not (0 <= t.min_oi <= MIN_OI_MAX):
        raise FinderError("The minimum open interest is not a whole number from 0 to 1,000,000.")
    if _num(t.max_spread) is None or not (SPREAD_MIN <= t.max_spread <= SPREAD_MAX):
        raise FinderError("The widest spread is not between 1% and 100% of the mid.")
    if isinstance(t.scan_months, bool) or not isinstance(t.scan_months, int) or not (SCAN_MONTHS_MIN <= t.scan_months <= SCAN_MONTHS_MAX):
        raise FinderError("The scan window is not 1 to 12 months.")
    if m.sessions_behind >= 2:
        raise FinderError(f"The newest option quotes are from the {_day(m.session)} close, {m.sessions_behind} sessions "
                          f"behind; the Finder does not price quotes that old.", "stale")


def strike_bounds(t: Thesis, spot: float) -> tuple[Decimal, Decimal]:
    s0, x = _dec(spot), _dec(t.target)
    below, past = _dec(STRIKE_BELOW_CLOSE), _dec(STRIKE_PAST_TARGET)
    if t.view == "up":
        return s0 * (1 - below), x * (1 + past)
    return x * (1 - past), s0 * (1 + below)


def window(t: Thesis, spot: float) -> dict:
    lo, hi = strike_bounds(t, spot)
    return {"type": t.kind, "exp_from": t.by.isoformat(), "exp_to": add_months(t.by, t.scan_months).isoformat(),
            "strike_from": float(lo), "strike_to": float(hi), "_bounds": (lo, hi)}


def standard_symbol(contract: str, root: str, exp: date, kind: str, strike: float) -> bool:
    """OCC form: root + yymmdd + C|P + strike in thousandths, 8 digits (decision 13)."""
    milli = _dec(strike) * 1000
    if milli != milli.to_integral_value() or milli >= Decimal(10) ** 8:
        return False
    want = f"{root}{exp:%y%m%d}{'C' if kind == 'call' else 'P'}{int(milli):08d}"
    return contract == want


# ── quotes ───────────────────────────────────────────────────────────────────

@dataclass
class Quote:
    contract: str
    kind: str
    strike: float
    exp: date
    bid: float
    ask: float
    raw: Mapping[str, Any]

    @property
    def bid_d(self) -> Decimal:
        return _dec(self.bid)

    @property
    def ask_d(self) -> Decimal:
        return _dec(self.ask)

    @property
    def mid_d(self) -> Decimal:
        return (self.bid_d + self.ask_d) / 2

    @property
    def mid(self) -> float:
        return float(self.mid_d)


def quote_screen(row: Mapping[str, Any], session: date, root: str) -> tuple[str | None, Quote | None]:
    """The quote-validity screens (0, 2 to 5), shared by candidates and calibration rows (DR-33)."""
    contract, k, e = row.get("contract"), _num(row.get("strike")), _date(row.get("exp_date"))
    kind = row.get("type")
    if not isinstance(contract, str) or not contract or k is None or k <= 0 or e is None or kind not in ("call", "put"):
        return "bad_row", None
    if not standard_symbol(contract, root, e, kind, k):
        return "nonstandard", None
    bid, ask = _num(row.get("bid")), _num(row.get("ask"))
    if bid is None or bid < TICK:
        return "no_bid", None
    if ask is None or ask < TICK or ask < bid or ask > QUOTE_MAX:
        return "bad_ask", None
    iso = session.isoformat()
    if row.get("bid_session") != iso or row.get("ask_session") != iso:
        return "stale_quote", None
    return None, Quote(contract, kind, k, e, bid, ask, row)


def single_bounds_ok(q: Quote, s0: Decimal, h: Decimal) -> bool:
    k = _dec(q.strike)
    if q.kind == "call":
        return q.bid_d <= s0 and q.ask_d >= max(Decimal(0), s0 - k)
    return q.bid_d <= k * h and q.ask_d >= max(Decimal(0), k - s0)


def no_arbitrage(quotes: list[Quote], s0: float, curve: om.Curve, session: date) -> tuple[list[Quote], int]:
    """Screen 6 on one type's rows (design section 6): bounds, strike feasibility per expiry, calendar
    across expiries; failing rows dropped until none fails. Returns (kept, dropped)."""
    s0d = _dec(s0)
    keep = list(quotes)
    dropped = 0
    h_of = {}
    for q in keep:
        if q.exp not in h_of:
            h_of[q.exp] = _dec(curve.df_max((q.exp - session).days / om.YEAR_DAYS)) * (1 + Decimal("1e-12"))
    while True:
        bad: set[str] = {q.contract for q in keep if not single_bounds_ok(q, s0d, h_of[q.exp])}
        if not bad:
            by_exp: dict[date, list[Quote]] = {}
            for q in keep:
                by_exp.setdefault(q.exp, []).append(q)
            for e, qs in by_exp.items():
                rows = [(_dec(q.strike), q.bid_d, q.ask_d) for q in qs]
                for j, strikes in envelope_violations(rows, qs[0].kind == "call", h_of[e]).items():
                    bad |= {q.contract for q in qs if _dec(q.strike) in strikes}
            if not bad:
                by_k: dict[float, list[Quote]] = {}
                for q in keep:
                    by_k.setdefault(q.strike, []).append(q)
                for qs in by_k.values():
                    qs.sort(key=lambda q: q.exp)
                    for i, q in enumerate(qs[:-1]):
                        later = min(qs[i + 1:], key=lambda r: r.ask_d)
                        if q.bid_d > later.ask_d:
                            bad |= {q.contract, later.contract}
        if not bad:
            return keep, dropped
        dropped += len(bad)
        keep = [q for q in keep if q.contract not in bad]


# ── the pricer: each context by its cheapest exact-enough route (model document, section 4) ──

MODEL_EUROPEAN = "black76-escrowed"
MODEL_AMERICAN = "american-bbsr-escrowed"
MODEL_INTRINSIC = "intrinsic"


@dataclass(frozen=True)
class Valued:
    value: float
    european: float
    model: str
    delta: float | None
    bound: float | None = None  # the early-exercise bound, when it let the European value stand
    delta_note: str | None = None  # why delta is None for an American context


DELTA_NOTE_ZONE = f"within {om.DELTA_ZONE:g} pricer tolerances of the exercise value, where the delta is not validated"
DELTA_NOTE_LATTICE = "the pricer did not reach its delta tolerance"
DELTA_NOTE_DIVIDEND = f"a dividend falls within {om.DELTA_DIV_DAYS} days, where the lattice delta is not validated"


class Pricer:
    """Values contexts for one run, charging the work budget and keeping each value it computed."""

    def __init__(self, work: Work) -> None:
        self.work = work
        self.memo: dict[om.Context, Valued | str] = {}
        self.delta_memo: dict[om.Context, tuple[float | None, str | None]] = {}

    def closed(self, n: int = 1) -> None:
        self.work.charge(om.UNITS_CLOSED_FORM * n)

    def bound(self, c: om.Context, decide: float | None = None) -> float:
        self.work.charge(om.UNITS_CLOSED_FORM * len(c.divs))
        return om.premium_bound(c, lambda pieces: self.work.charge(om.UNITS_BOUND_BATCH + om.UNITS_BOUND_PIECE * pieces), decide)

    def _triage(self, c: om.Context) -> Valued | str | None:
        """A value when no lattice is needed; the reason when the lattice is needed and the context is
        outside its domain; None when the lattice runs."""
        if c.days == 0:
            v = max(c.spot - c.strike, 0.0) if c.is_call else max(c.strike - c.spot, 0.0)
            return Valued(v, v, MODEL_INTRINSIC, None)
        if c.spot - c.pv() <= 0:
            return "the price is at or below the dividends still owed"
        self.closed()
        eu = om.european(c)
        if om.exempt(c):
            return Valued(eu, eu, MODEL_EUROPEAN, om.european_delta(c))
        b = self.bound(c, decide=om.tolerance(eu, c.spot) / 5)
        if b <= om.tolerance(eu, c.spot) / 5:
            return Valued(eu, eu, MODEL_EUROPEAN, om.european_delta(c), bound=b)
        return om.in_domain(c)

    def many(self, cs: Sequence[om.Context]) -> list[Valued | str]:
        """Each context's value, or the reason it cannot be valued; lattice work batched."""
        lattice: list[om.Context] = []
        for c in dict.fromkeys(cs):
            if c in self.memo:
                continue
            got = self._triage(c)
            if got is None:
                lattice.append(c)
            else:
                self.memo[c] = got
        if lattice:
            values, deltas, ok = om.american(lattice, self.work.charge)
            for c, v, d, good in zip(lattice, values, deltas, ok):
                note = DELTA_NOTE_DIVIDEND if om.early_dividend(c) else DELTA_NOTE_ZONE if math.isnan(d) else None
                self.memo[c] = (Valued(float(v), om.european(c), MODEL_AMERICAN, None if note else float(d),
                                       delta_note=note)
                                if good else om.NOT_CONVERGED)
        return [self.memo[c] for c in cs]

    def deltas(self, cs: Sequence[om.Context]) -> dict[om.Context, tuple[float | None, str | None]]:
        """The lattice delta of contexts whose value the early-exercise bound let stand (DR-51: the bound
        limits the price's error, not its derivative's), batched and charged; (None, why) when the lattice is
        outside its domain, a dividend falls in the first DELTA_DIV_DAYS days (D-1: no lattice is run), the
        lattice does not converge, or the context is in the delta zone."""
        need = [c for c in dict.fromkeys(cs) if c not in self.delta_memo]
        run = []
        for c in need:
            why = om.in_domain(c)
            if why is not None:
                self.delta_memo[c] = (None, f"the delta needs the lattice, and {why}")
            elif om.early_dividend(c):
                self.delta_memo[c] = (None, DELTA_NOTE_DIVIDEND)
            else:
                run.append(c)
        if run:
            _, ds, ok = om.american(run, self.work.charge)
            for c, d, good in zip(run, ds, ok):
                self.delta_memo[c] = ((None, DELTA_NOTE_LATTICE) if not good else
                                      (None, DELTA_NOTE_ZONE) if math.isnan(d) else (float(d), None))
        return {c: self.delta_memo[c] for c in cs}

    def values(self, cs: list[om.Context]) -> list[float | str]:
        """For the solver driver: each context's value, or the reason it is outside the domain."""
        return [g if isinstance(g, str) else g.value for g in self.many(cs)]

    def one(self, c: om.Context) -> Valued:
        got = self.many([c])[0]
        if isinstance(got, str):
            raise OutOfDomain(got)
        return got


# ── carry per expiry (design section 3) ──────────────────────────────────────

def _spread_ok(q: Quote, limit: Decimal) -> bool:
    return 2 * (q.ask_d - q.bid_d) <= limit * (q.ask_d + q.bid_d)


def _informative(q: Quote, s0: float) -> bool:
    """A leg whose mid is within 2·tol of its exercise value now may be worth exactly that (an in-the-money
    call the day before an ex-date): its price then pins neither sigma nor the forward (rev 5)."""
    intrinsic = max(s0 - q.strike, 0.0) if q.kind == "call" else max(q.strike - s0, 0.0)
    return q.mid - intrinsic > 2.0 * om.tolerance(q.mid, s0)


def calibrate_all(expiries: Sequence[date], by_exp: Mapping[date, Sequence[Quote]], s0: float, session: date,
                  curve: om.Curve, sched: Sequence[Dividend], schedule_ok: bool, pricer: Pricer
                  ) -> tuple[dict[date, Carry], dict[date, dict]]:
    """The market's forward for each expiry from its call and put pairs (section 3), or the fallback; every
    pair of every expiry solved in lockstep so the lattice work is batched."""
    gens, facts, setup = {}, {}, {}
    evals = [0]
    for e in expiries:
        days = (e - session).days
        tau = days / om.YEAR_DAYS
        rho = curve.rate(tau)
        df = math.exp(-rho * tau)
        divs = owed(sched, session, e)
        pv = sum(a * math.exp(-rho * d / om.YEAR_DAYS) for d, a in divs)
        s0d, h = _dec(s0), _dec(curve.df_max(tau)) * (1 + Decimal("1e-12"))
        calls, puts = {}, {}
        for q in by_exp.get(e, ()):
            if single_bounds_ok(q, s0d, h) and _spread_ok(q, PAIR_SPREAD) and _informative(q, s0):
                (calls if q.kind == "call" else puts).setdefault(q.strike, q)
        f0 = (s0 - pv) / df
        strikes = sorted(set(calls) & set(puts), key=lambda k: (abs(k - f0), k))[:PAIRS_PER_EXPIRY]
        for k in strikes:
            gens[(e, k)] = pair_forward_gen(s0, k, calls[k].mid, puts[k].mid, days, rho, divs, evals)
        facts[e] = {"days": days, "rate": rho, "pv_schedule": pv, "pairs_tried": len(strikes)}
        setup[e] = (tau, df, pv)
    solved = om.drive(gens, pricer.values)
    pricer.closed(2 * evals[0])
    carries = {}
    for e in expiries:
        tau, df, pv = setup[e]
        usable = sorted((k, got[0], got[1]) for (e_, k), got in solved.items()
                        if e_ == e and got is not None and not isinstance(got, OutOfDomain))
        carry = None
        if usable:
            fwd = statistics.median(f for _, f, _ in usable)
            q_e = math.log((s0 - pv) / (fwd * df)) / tau
            if abs(q_e) <= Q_ACCEPT:
                points = tuple((k, sg) for k, _, sg in usable)
                carry = Carry(fwd, q_e, "market", len(usable), _atm(points, fwd), points)
        if carry is None and not usable and any(isinstance(got, OutOfDomain) and str(got) == om.Q_DOMAIN_REASON
                                                for (e_, _), got in solved.items() if e_ == e):
            # DR-50: the market's forward implies a residual yield the lattice is not validated for; assuming
            # none instead would price with a carry the market contradicts, so the expiry is not priced
            carry = Carry((s0 - pv) / df, 0.0, "outside domain", 0, None)
        if carry is None:
            carry = Carry((s0 - pv) / df, 0.0, "dividends only" if schedule_ok else "none", 0, None)
        carries[e] = carry
    return carries, facts


def _atm(points: Sequence[tuple[float, float]], fwd: float) -> float | None:
    """The pairs' common sigma, linear in strike at the forward; the nearest pair's outside their range."""
    if not points:
        return None
    if fwd <= points[0][0]:
        return points[0][1]
    if fwd >= points[-1][0]:
        return points[-1][1]
    for (k1, s1), (k2, s2) in zip(points, points[1:]):
        if k1 <= fwd <= k2:
            return s1 + (s2 - s1) * (fwd - k1) / (k2 - k1)
    return None


CARRY_WORDS = {
    "market": "carry from the market's forward (call and put pairs at this expiry)",
    "dividends only": "carry from dividends only (no near-the-money call and put pair to read the market's forward)",
    "none": "carry: none assumed (no pair and no dividend data)",
    "outside domain": "carry: the call and put pairs imply a residual yield beyond ±10% a year, where the pricer is "
                      "not validated; contracts at this expiry are not priced",
}


# ── events (design section 8) ────────────────────────────────────────────────

TIMES = ("bmo", "amc", "dmh", "unknown", "exact")


@dataclass(frozen=True)
class Event:
    id: str
    kind: str          # earnings, macro, dividend
    name: str
    day: date
    time: str          # one of TIMES, or "cum_close" for a dividend
    at: datetime | None
    source: str
    amount: float | None = None
    label: str | None = None


def _instant(v: Any) -> datetime | None:
    if not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo is not None else None


def normalize_events(rows: Iterable[Mapping[str, Any]]) -> tuple[list[Event], int]:
    out, ignored = [], 0
    for i, r in enumerate(rows):
        kind, name, d, tm = r.get("kind"), r.get("name"), _date(r.get("date")), r.get("time")
        at = _instant(r.get("at")) if r.get("at") is not None else None
        ok = (kind in ("earnings", "macro") and isinstance(name, str) and name and d is not None and tm in TIMES
              and ((tm == "exact") == (at is not None)) and (r.get("at") is None or at is not None)
              and not (kind == "earnings" and tm == "exact"))
        if not ok:
            ignored += 1
            continue
        out.append(Event(f"{kind}-{d.isoformat()}-{i}", kind, name, d, tm, at, str(r.get("source") or "")))
    return sorted(out, key=lambda ev: (ev.day, ev.at or datetime.min.replace(tzinfo=timezone.utc), ev.id)), ignored


def dividend_events(sched: Sequence[Dividend]) -> list[Event]:
    return [Event(f"dividend-{d.ex_date.isoformat()}-{i}", "dividend", "Dividend", d.cum_session, "cum_close", None,
                  "EODHD", d.amount, "projected, not declared" if d.projected else "declared")
            for i, d in enumerate(sched)]


def earnings_reports(evs: Sequence[Event], known_rows: Iterable[Mapping[str, Any]], session: date,
                     closes) -> tuple[list[Event], set[str], int]:
    """One report per calendar day from the window's earnings events and every known earnings row (design S-10,
    steps 2 and 5): (reports by day, the ids that may carry a move, known rows with no valid date). A day's time
    is the one its rows agree on, else unknown; its id is the first window event on that day the event list
    displays, and only such ids may carry a move."""
    rows: dict[date, list[tuple[str, Event | None]]] = {}
    for ev in evs:
        if ev.kind == "earnings":
            rows.setdefault(ev.day, []).append((ev.time, ev))
    bad = 0
    for r in known_rows:
        d = _date(r.get("date")) if isinstance(r, Mapping) else None
        if d is None:
            bad += 1
            continue
        tm = r.get("time")
        rows.setdefault(d, []).append((tm if tm in ("bmo", "amc", "dmh") else "unknown", None))
    out, eligible = [], set()
    for d in sorted(rows):
        times = {tm for tm, _ in rows[d]}
        tm = times.pop() if len(times) == 1 else "unknown"
        shown = [ev for _, ev in rows[d] if ev is not None and position(ev, session, closes) != "before"]
        if shown:
            out.append(replace(shown[0], time=tm, at=None if tm != "exact" else shown[0].at))
            eligible.add(shown[0].id)
        else:
            out.append(Event(f"earnings-{d.isoformat()}-known", "earnings", "Earnings", d, tm, None, "known"))
    return out, eligible, bad


def close_of(d: date, closes: Mapping[date, datetime]) -> datetime:
    got = closes.get(d)
    return got if got is not None else datetime.combine(d, time(16), NY).astimezone(timezone.utc)


def position(ev: Event, ref: date, closes: Mapping[date, datetime]) -> str:
    """Where an event falls against the close of `ref`: before, after, or uncertain."""
    if ev.time == "exact":
        return "before" if ev.at < close_of(ref, closes) else "after"
    if ev.time == "cum_close":  # paid after its cum close: the stock at that close still carries it
        return "before" if ev.day < ref else "after"
    if ev.time in ("bmo", "dmh"):
        return "before" if ev.day <= ref else "after"
    if ev.time == "amc":
        return "before" if ev.day < ref else "after"
    if ev.day < ref:
        return "before"
    return "after" if ev.day > ref else "uncertain"


def between(ev: Event, start: date, end: date, closes) -> str | None:
    """"yes" when the event is certainly after start's close and before end's, "maybe" when either side is
    uncertain, None when it is certainly outside."""
    a, b = position(ev, start, closes), position(ev, end, closes)
    if a == "before" or b == "after":
        return None
    return "yes" if (a, b) == ("after", "before") else "maybe"


UNKNOWN_FLAG = ("Earnings dates are unknown for this name, so a report before your date is not ruled out; the "
                "modelled value holds this contract's volatility flat.")


def event_flags(evs: Sequence[Event], session: date, by: date, closes, known_through: date | None = None) -> list[str]:
    """The earnings flags of one modelled row: each found report before (or perhaps before) the visitor's date, and
    UNKNOWN_FLAG while the earnings coverage is not complete through that date (design A-3)."""
    out = []
    for ev in evs:
        if ev.kind != "earnings":
            continue
        got = between(ev, session, by, closes)
        if got == "yes":
            out.append(f"Earnings on {_day(ev.day)} are before your date; the modelled value holds this contract's "
                       "volatility flat, which usually fails after a report.")
        elif got == "maybe":
            out.append(f"Earnings on {_day(ev.day)} may be before your date (the release time is not known); the "
                       "modelled value holds this contract's volatility flat, which usually fails after a report.")
    if known_through is None or known_through < by:
        out.append(UNKNOWN_FLAG)
    return out


def row_event_ids(evs: Sequence[Event], session: date, by: date, e: date, closes) -> dict:
    ids = {"before_date": [], "before_expiry": [], "uncertain": []}
    for ev in evs:
        if ev.kind == "macro":
            continue
        d, x = between(ev, session, by, closes), between(ev, session, e, closes)
        if d == "yes":
            ids["before_date"].append(ev.id)
        if x == "yes":
            ids["before_expiry"].append(ev.id)
        if "maybe" in (d, x):
            ids["uncertain"].append(ev.id)
    return ids


def event_list(evs: Sequence[Event], session: date, by: date, closes) -> list[dict]:
    out = []
    for ev in evs:
        s = position(ev, session, closes)
        if s == "before":
            continue
        d = position(ev, by, closes)
        if s == "uncertain":
            placed = "timing unknown: may be before or after the session close"
        elif d == "uncertain":
            placed = "timing unknown: may be before or after the date close"
        else:
            placed = "before your date" if d == "before" else "after your date"
        item = {"id": ev.id, "kind": ev.kind, "name": ev.name, "date": ev.day.isoformat(), "timing": ev.time,
                "at": ev.at.isoformat() if ev.at else None, "source": ev.source, "placement": placed}
        if ev.kind == "dividend":
            item.update(amount=ev.amount, label=ev.label)
        out.append(item)
    return out


INCOMPLETE_MOVE = "Some earnings rows could not be read, so another report before the second expiry cannot be ruled out."
UNKNOWN_MOVE = ("Earnings dates past the stored ones are unknown, so another report before the second expiry cannot be "
                "ruled out.")


def earnings_moves(evs: Sequence[Event], session: date, last_expiry: date, closes, carries: Mapping[date, Carry],
                   expiries: Sequence[date], *, eligible: set[str] | None = None, incomplete: bool = False,
                   complete_through: date | None = None) -> list[dict]:
    """Decision 10: the move priced for each upcoming report (at most 2), from the two nearest expiries after it.
    `evs` holds one report per day (earnings_reports); only `eligible` ids carry a move, and none does while
    discovery is `incomplete` (design S-10) or the earnings coverage is not complete through the pair's second
    expiry (`complete_through`, design A-3)."""
    out = []
    earnings = [ev for ev in evs if ev.kind == "earnings" and between(ev, session, last_expiry, closes) is not None
                and (eligible is None or ev.id in eligible)]
    for ev in earnings[:2]:
        item = {"event_id": ev.id, "date": ev.day.isoformat(), "move_sd_pct": None, "expiries": None, "reason": None}
        out.append(item)
        if incomplete:
            item["reason"] = INCOMPLETE_MOVE
            continue
        if complete_through is None:
            item["reason"] = UNKNOWN_MOVE
            continue
        if position(ev, session, closes) == "uncertain":
            item["reason"] = "The report's time against the session close is not known."
            continue
        # an earlier report not yet in the session's prices sits in any pair after this one (Codex S-8)
        if any(o is not ev and o.kind == "earnings" and o.day <= ev.day and position(o, session, closes) != "before" for o in evs):
            item["reason"] = "Another earnings date falls before the second expiry."
            continue
        after = sorted(e for e in expiries if position(ev, e, closes) == "before")[:2]
        if len(after) < 2:
            item["reason"] = "Two listed expiries after the report are not in the quotes."
            continue
        e1, e2 = after
        if e2 > complete_through:
            item["reason"] = UNKNOWN_MOVE
            continue
        item["expiries"] = [e1.isoformat(), e2.isoformat()]
        # any other report priced into either expiry, earlier ones included, adds its own jump (Codex S-8)
        if any(o is not ev and o.kind == "earnings" and between(o, session, e2, closes) is not None for o in evs):
            item["reason"] = "Another earnings date falls before the second expiry."
            continue
        c1, c2 = carries.get(e1), carries.get(e2)
        if c1 is None or c2 is None or c1.source != "market" or c2.source != "market" or c1.atm_vol is None or c2.atm_vol is None:
            item["reason"] = "An expiry's forward fell back (no usable call and put pair)."
            continue
        t1, t2 = (e1 - session).days / om.YEAR_DAYS, (e2 - session).days / om.YEAR_DAYS
        s1, s2 = c1.atm_vol, c2.atm_vol
        jump = t1 * t2 * (s1 * s1 - s2 * s2) / (t2 - t1)
        base = (s2 * s2 * t2 - s1 * s1 * t1) / (t2 - t1)
        if jump <= 0 or base <= 0:
            item["reason"] = "The two expiries' volatilities do not price a jump at the report."
            continue
        item["move_sd_pct"] = 100.0 * math.sqrt(jump)
    return out


def coverage_words(cov: Mapping[str, Any], symbol: str, dividends_ok: bool, found_earnings: bool,
                   unreadable: bool = False) -> list[str]:
    out = []
    status = cov.get("earnings")
    through = _date(cov.get("earnings_through"))
    if status in ("fetched", "not_found") and through is not None and unreadable and not found_earnings:
        # no absence claim while a row could not be read (design S-10 step 5)
        out.append("Some of Finnhub's earnings rows could not be read, so no earnings date can be ruled out.")
    elif status == "stored" and through is None:
        out.append("Earnings dates listed are from Finnhub's calendar as stored by the site's refresh; when they were "
                   "last checked is not recorded, and other earnings dates are unknown.")
    elif status == "unknown":
        out.append(f"Earnings dates unknown for {symbol}: no usable dates are available from the stored calendar.")
    elif status in ("stored", "fetched", "not_found") and through is not None:
        if found_earnings:
            out.append(f"Earnings dates are from Finnhub's calendar through {_day(through)}.")
        else:
            out.append(f"No earnings date found for {symbol} in Finnhub's calendar through {_day(through)}.")
    elif status == "not_checked":
        out.append(f"Earnings dates are not checked for share-class listings such as {symbol}.")
    else:
        out.append("Earnings dates could not be read.")
    macro = _date(cov.get("macro_through"))
    if macro is not None:
        out.append(f"The macro calendar is stored through {_day(macro)}; later events are not listed.")
    out.append("Other company events (FDA decisions, product launches, lawsuits, index changes, mergers) are not tracked.")
    if not dividends_ok:
        out.append("Dividend data unavailable.")
    return out


# ── one contract: IV, sizing, values, P&L, breakevens (design sections 4 and 7) ──

def _pnl(v: Decimal, n: int, comm_c: int, cost_c: int) -> Decimal:
    """The exit rule (DR-24): sold at its value paying the commission when that nets more than nothing."""
    exit_ = max(CONTRACT_SIZE * v - Decimal(comm_c) / 100, Decimal(0))
    return n * exit_ - Decimal(cost_c) / 100


def _usd(x: Decimal) -> float:
    return float(x.quantize(Decimal("0.01")))


def _intrinsic_d(is_call: bool, s: Decimal, k: Decimal) -> Decimal:
    return max(s - k, Decimal(0)) if is_call else max(k - s, Decimal(0))


@dataclass
class RowCtx:
    """What every contract of one run shares."""
    t: Thesis
    m: Market
    curve: om.Curve
    sched: list[Dividend]
    carries: Mapping[date, Carry]
    pricer: Pricer
    prices: Mapping[str, Decimal]
    comm_c: int
    budget_c: int
    events: list[Event]
    earnings_through: date | None = None  # earnings coverage complete through this date, else None (design A-3)


def _context_on(rc: RowCtx, q: Quote, sigma: float, start: date, spot: float) -> om.Context:
    """The valuation context from `start` (the session or the visitor's date) to q's expiry (section 1)."""
    tau_e = (q.exp - rc.m.session).days / om.YEAR_DAYS
    if start == rc.m.session:
        rho = rc.curve.rate(tau_e)
    else:
        rho = rc.curve.forward((start - rc.m.session).days / om.YEAR_DAYS, tau_e)
    return om.Context(q.kind == "call", spot, q.strike, (q.exp - start).days, rho, rc.carries[q.exp].q, sigma,
                      owed(rc.sched, start, q.exp))


BRACKET_STEPS = 80  # doubling from at least 1e-9·max(1, S0) passes 1e9 well within this


def _breakeven_gen(rc: RowCtx, q: Quote, sigma: float, target: float):
    """Section 7 (DR-23, DR-34, DR-40, rev 5): the price on the date where the value is `target` (a solver
    generator). Returns (price or None, the reason when None).

    v is increasing (call) or decreasing (put) in the price, so any sub-bracket with a sign change holds the
    root. The search starts at the European breakeven, steps toward the root by the European delta's
    estimate, doubling the step until the sign changes, and stops at the range's end, where the pricer is
    validated (the domain) or the model holds (exempt). Every point uses its own pricer; an end is evaluated
    only when the search reaches it, and only an evaluated end decides that the breakeven lies beyond it."""
    is_call = q.kind == "call"
    s0 = rc.m.spot
    scale = max(1.0, s0)
    base = _context_on(rc, q, sigma, rc.t.by, s0)
    pv = base.pv()
    exact = om.exempt(base)
    if exact:
        lo = pv * (1 + 1e-9) + 1e-9 * scale
        hi = 1e9
    else:
        lo = max(q.strike / om.KS_HI, pv / om.PV_FRAC_MAX, om.div_cluster(base.divs) / om.DIV_FRAC_MAX) * (1 + 1e-12)
        hi = q.strike / om.KS_LO * (1 - 1e-12)
        if lo >= hi:
            return None, "no price range where the pricer is validated"
    ftol = 1e-10 * scale if exact else 1e-3 * om.tolerance(target, s0)

    def f(x: float):
        return (yield [base.with_spot(x)])[0] - target

    def eu(x: float) -> float:
        rc.pricer.closed()
        return om.european(base.with_spot(x)) - target

    e_lo, e_hi = eu(lo), eu(hi)
    x0 = None
    if e_lo * e_hi < 0:
        x0, _ = om.brent(eu, lo, hi, e_lo, e_hi, 1e-12 * scale, 1e-12 * scale, 200)
    if x0 is None or not lo < x0 < hi:
        x0 = min(max(q.strike, lo * 1.01), hi / 1.01)
    try:
        f0 = yield from f(x0)
        if abs(f0) <= ftol:
            return x0, None
        toward_lo = (f0 > 0) == is_call  # where the root lies, by monotonicity
        end = lo if toward_lo else hi
        delta = abs(om.european_delta(base.with_spot(x0)))
        step = abs(f0) / delta if delta > 1e-12 else 0.01 * x0
        step = max(step * 1.05, 1e-9 * scale)
        a, fa = x0, f0
        for _ in range(BRACKET_STEPS):
            b = max(end, a - step) if toward_lo else min(end, a + step)
            fb = yield from f(b)
            if fa * fb <= 0:
                break
            if b == end:
                where = "outside the model's domain" if exact else "where the pricer is not validated"
                side = f"below {money(lo)}" if toward_lo else f"above {money(hi)}"
                return None, f"the breakeven is {side}, {where}"
            a, fa, step = b, fb, 2.0 * step
        else:
            return None, "unresolved"
        root, _ = yield from om.brent_gen(f, a, b, fa, fb, 1e-12 * scale, ftol, 40)
        if root is None:
            return None, "unresolved"
        err = abs((yield from f(root)))
    except OutOfDomain:
        return None, "unresolved"
    if err > (1e-10 * scale if exact else om.tolerance(target, root)):
        return None, "unresolved"
    return root, None


@dataclass
class Sized:
    q: Quote
    c0: om.Context
    sigma: float
    price_c: int
    n: int
    cost_c: int


def implied_vols(rc: RowCtx, quotes: Sequence[Quote]) -> dict[str, float | str]:
    """Screen 9 for every row in lockstep: our implied volatility from the mid, or the screen it fails."""
    out: dict[str, float | str] = {}
    gens = {}
    evals = [0]
    for q in quotes:
        c0 = _context_on(rc, q, 0.3, rc.m.session, rc.m.spot)
        if om.exempt(c0):
            out[q.contract] = om.iv_european(c0, q.mid, evals=evals)
        else:
            gens[q.contract] = om.iv_american_gen(c0, q.mid, evals=evals)
    for key, got in om.drive(gens, rc.pricer.values).items():
        out[key] = "unpriceable" if isinstance(got, OutOfDomain) else got[0]
    rc.pricer.closed(2 * evals[0])
    for key, sg in out.items():
        if not isinstance(sg, str) and (sg is None or not (IV_MIN <= sg <= IV_MAX)):
            out[key] = "bad_iv"
    return out


def value_rows(rc: RowCtx, sized: Sequence[Sized]) -> dict[str, tuple[str | None, dict | None]]:
    """Values, P&L, breakevens and Greeks for every sized row; lattice work batched across rows."""
    t, m = rc.t, rc.m
    s0 = m.spot
    shocks = ("iv", "iv_minus_10", "iv_plus_10")
    names = list(rc.prices)
    plan: dict[str, list[om.Context]] = {}
    for z in sized:
        cs = [z.c0.with_sigma(z.sigma)]
        if z.c0.days > 1:
            cs.append(_context_on(rc, z.q, z.sigma, m.session + timedelta(days=1), s0))
        if z.q.exp != t.by:
            for sg in (z.sigma, max(z.sigma - IV_SHOCK, IV_FLOOR), z.sigma + IV_SHOCK):
                cs.extend(_context_on(rc, z.q, sg, t.by, float(rc.prices[name])) for name in names)
        plan[z.q.contract] = cs
    flat = [c for cs in plan.values() for c in cs]
    got_all = rc.pricer.many(flat)
    it = iter(got_all)
    valued = {key: [next(it) for _ in cs] for key, cs in plan.items()}
    # DR-51: a session value the bound let stand gets its delta from the lattice, not the European formula
    cs0 = {key: plan[key][0] for key, vs in valued.items() if isinstance(vs[0], Valued) and vs[0].bound is not None}
    if cs0:
        got_d = rc.pricer.deltas(list(cs0.values()))
        for key, c in cs0.items():
            d, why = got_d[c]
            valued[key][0] = replace(valued[key][0], delta=d, delta_note=why)
    fill_target = {z.q.contract: (Decimal(z.price_c) / 10_000) + Decimal(2 * rc.comm_c) / 10_000 for z in sized}
    be_gens = {}
    for z in sized:
        vs = valued[z.q.contract]
        if z.q.exp != t.by and not any(isinstance(v, str) for v in vs):
            be_gens[z.q.contract] = _breakeven_gen(rc, z.q, z.sigma, float(fill_target[z.q.contract]))
    be = om.drive(be_gens, rc.pricer.values)
    out = {}
    for z in sized:
        vs = valued[z.q.contract]
        if isinstance(vs[0], str) or (z.q.exp != t.by and any(isinstance(v, str) for v in vs[2 if z.c0.days > 1 else 1:])):
            out[z.q.contract] = ("unpriceable", None)
            continue
        got = be.get(z.q.contract)
        if isinstance(got, OutOfDomain):
            got = (None, "unresolved")
        out[z.q.contract] = (None, _row(rc, z, vs, fill_target[z.q.contract], got))
    return out


def _row(rc: RowCtx, z: Sized, vs: list, target_d: Decimal, be: tuple | None) -> dict:
    t, m, q = rc.t, rc.m, z.q
    is_call = q.kind == "call"
    s0 = m.spot
    now = vs[0]
    i = 1
    if z.c0.days > 1:
        theta = None if isinstance(vs[1], str) else vs[1].value - now.value
        i = 2
    else:
        theta = (max(s0 - q.strike, 0.0) if is_call else max(q.strike - s0, 0.0)) - now.value
    modelled = q.exp != t.by
    k_d = _dec(q.strike)
    names = list(rc.prices)
    pnl: dict[str, dict[str, Decimal]] = {}
    on_date_models = None
    if not modelled:
        pnl["iv"] = {name: _pnl(_intrinsic_d(is_call, s, k_d), z.n, rc.comm_c, z.cost_c) for name, s in rc.prices.items()}
    else:
        for key in ("iv", "iv_minus_10", "iv_plus_10"):
            chunk = dict(zip(names, vs[i:i + len(names)]))
            i += len(names)
            pnl[key] = {name: _pnl(Decimal(v.value), z.n, rc.comm_c, z.cost_c) for name, v in chunk.items()}
            if key == "iv":
                on_date_models = {name: v.model for name, v in chunk.items()}
    fill_d = Decimal(z.price_c) / 10_000
    be_exp_d = k_d + target_d if is_call else k_d - target_d
    be_exp = float(be_exp_d) if be_exp_d > 0 else None
    be_date, be_why = be if modelled else (be_exp, None)
    sigma, tau = z.sigma, z.c0.tau
    fwd = (s0 - z.c0.pv()) * math.exp((z.c0.rho - z.c0.q) * tau)
    if be_exp is None:
        prob = 0.0
    else:
        d2 = (math.log(fwd / be_exp) - 0.5 * sigma * sigma * tau) / (sigma * math.sqrt(tau))
        prob = float(om.ndtr(d2)) if is_call else float(om.ndtr(-d2))
    tol = om.tolerance(now.value, s0)
    if now.model == MODEL_EUROPEAN and now.bound is None:
        flag, premium_out = "no", 0.0
    else:
        p = 0.0 if now.bound is not None else now.value - now.european
        flag = ("yes" if p > EXERCISE_FLAG + tol else "no" if p < EXERCISE_FLAG - tol
                else "within the pricer's tolerance of a cent")
        premium_out = f"below {money(now.bound)}" if now.bound is not None else now.value - now.european
    raw = q.raw
    provider = {key: _num(raw.get(src)) for key, src in (("iv", "implied_vol"), ("delta", "delta"), ("theta", "theta"))}
    return {
        "contract": q.contract,
        "type": q.kind,
        "exp": q.exp.isoformat(),
        "strike": q.strike,
        "days_past_date": (q.exp - t.by).days,
        "bid": q.bid,
        "ask": q.ask,
        "mid": q.mid,
        "fill": float(fill_d),
        "commission": rc.comm_c / 100.0,
        "quote_ts": raw.get("last_quote") if isinstance(raw.get("last_quote"), str) and raw.get("last_quote") else None,
        "oi": _num(raw.get("open_interest")),
        "iv": sigma,
        "delta": now.delta,
        "delta_note": now.delta_note,
        "theta_dollars_day": round(theta * CONTRACT_SIZE * z.n, 2) if theta is not None else None,
        "spread_pct": round(float((q.ask_d - q.bid_d) / q.mid_d), 4),
        "n": z.n,
        "cost": z.cost_c / 100.0,
        "unused": (rc.budget_c - z.cost_c) / 100.0,
        "max_loss": z.cost_c / 100.0,
        "breakeven_expiry": be_exp,
        "breakeven_on_date": be_date,
        "breakeven_on_date_note": be_why,
        "pnl": {name: _usd(x) for name, x in pnl["iv"].items()},
        "_pnl": pnl["iv"],
        "_cost_c": z.cost_c,
        "modelled": modelled,
        "iv_minus_10": {name: _usd(x) for name, x in pnl["iv_minus_10"].items()} if modelled else None,
        "iv_plus_10": {name: _usd(x) for name, x in pnl["iv_plus_10"].items()} if modelled else None,
        "rn_prob_breakeven": round(prob, 4),
        "model": {"session": now.model, "on_date": on_date_models or MODEL_INTRINSIC},
        "model_inputs": {"rate_session": z.c0.rho,
                         "rate_on_date": rc.curve.forward((t.by - m.session).days / om.YEAR_DAYS, tau) if modelled else None,
                         "q": z.c0.q, "pv_dividends": z.c0.pv(), "forward": fwd, "sigma": sigma, "t_years": tau},
        "european_value": now.european,
        "early_exercise": {"premium": premium_out, "flag": flag},
        "event_ids": row_event_ids(rc.events, m.session, t.by, q.exp, m.closes),
        "flags": event_flags(rc.events, m.session, t.by, m.closes, rc.earnings_through) if modelled else [],
        "carry_source": rc.carries[q.exp].source,
        "provider": provider,
        "_sigma": sigma,
    }


def curve_pnl(rc: RowCtx, q: Quote, row: dict, grid: Sequence[float]) -> list[float | None]:
    """The pick's P&L on the date over the grid; null where its pricer is not validated (section 10)."""
    is_call = q.kind == "call"
    if not row["modelled"]:
        k = _dec(q.strike)
        return [_usd(_pnl(_intrinsic_d(is_call, _dec(s), k), row["n"], rc.comm_c, row["_cost_c"])) for s in grid]
    got = rc.pricer.many([_context_on(rc, q, row["_sigma"], rc.t.by, s) for s in grid])
    return [None if isinstance(g, str) else _usd(_pnl(Decimal(g.value), row["n"], rc.comm_c, row["_cost_c"])) for g in got]


# ── proven ranges, so only contracts that can reach a lens's top LENS_TOP are priced ──

LENS_TOP = 20
# Pruning's allowance for the lattice's error: twice the stated tolerance (DR-47). The validated worst error on the
# domain is 0.70 tol, so a row is pruned only when it would lose even with an error well past anything observed.
PRUNE_ALLOWANCE = 2.0
METRICS = {"payoff": "target", "forgiving": "half", "time": "flat"}


@dataclass
class Ranged:
    """A sized row's proven P&L range on the date at each scenario price (lo, hi), before any lattice."""
    z: Sized
    pnl: dict[str, tuple[Decimal, Decimal]]


def _ucap(c: om.Context, pricer: Pricer) -> float:
    """European value plus the early-exercise bound: at least the American value."""
    pricer.closed()
    return om.european(c) + (0.0 if om.exempt(c) else pricer.bound(c))


def sigma_range(rc: RowCtx, c0: om.Context, mid: float) -> tuple[float, float] | str:
    """[lo, hi] holding the sigma the lattice inversion can return (its value within PRUNE_ALLOWANCE·tol of the mid),
    or "bad_iv" when no sigma in 5% to 300% can. hi: European inversion at mid + slack (American >=
    European). lo: a point where European + bound < mid − slack (so American < the mid there, and value is
    non-decreasing in sigma)."""
    evals = [0]
    exact = om.exempt(c0)
    slack = 0.0 if exact else PRUNE_ALLOWANCE * om.tolerance(mid, c0.spot)
    try:
        lo_lim, hi_lim = om.IV_BRACKET
        if om.european(c0.with_sigma(lo_lim)) > mid + slack:
            return "bad_iv"
        hi = om.iv_european(c0, mid + slack, evals=evals)
        hi = hi_lim if hi is None else hi
        if exact:
            return (hi, hi) if IV_MIN <= hi <= IV_MAX else "bad_iv"
        target = mid - slack
        x = hi
        s_star = c0.spot - c0.pv()
        for _ in range(4):  # Newton on European + bound with the European vega, from above
            u = _ucap(c0.with_sigma(x), rc.pricer)
            vol = x * math.sqrt(c0.tau)
            d1 = (math.log(s_star / c0.strike) + (c0.rho - c0.q + 0.5 * x * x) * c0.tau) / vol
            vega = s_star * math.exp(-c0.q * c0.tau) * math.sqrt(c0.tau) * math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
            if u < target or vega <= 0:
                break
            x = max(lo_lim, x - (u - target) / vega)
        lo = max(lo_lim, x * (1 - 1e-3) - 1e-4)
        while lo > lo_lim and _ucap(c0.with_sigma(lo), rc.pricer) >= target:
            lo = max(lo_lim, lo - 2 * (x - lo) - 1e-3)
        if lo > IV_MAX or hi < IV_MIN:
            return "bad_iv"
        return max(lo, IV_MIN), min(hi, IV_MAX)
    finally:
        rc.pricer.closed(2 * evals[0])


def ranges(rc: RowCtx, z: Sized, lo: float, hi: float) -> Ranged | str:
    """The row's proven P&L range at each scenario price, or the screen it certainly fails."""
    t, q = rc.t, z.q
    is_call = q.kind == "call"
    k_d = _dec(q.strike)
    out = {}
    for name, s in rc.prices.items():
        if q.exp == t.by:
            v = _pnl(_intrinsic_d(is_call, s, k_d), z.n, rc.comm_c, z.cost_c)
            out[name] = (v, v)
            continue
        c_lo = _context_on(rc, q, lo, t.by, float(s))
        c_hi = c_lo.with_sigma(hi)
        if c_lo.spot - c_lo.pv() <= 0:
            return "unpriceable"
        rc.pricer.closed(2)
        v_lo = om.european(c_lo)
        v_hi = _ucap(c_hi, rc.pricer)
        tol = PRUNE_ALLOWANCE * om.tolerance(v_hi, c_hi.spot)
        out[name] = (_pnl(Decimal(max(0.0, v_lo - tol)), z.n, rc.comm_c, z.cost_c),
                     _pnl(Decimal(v_hi + tol), z.n, rc.comm_c, z.cost_c))
    return Ranged(z, out)


def rank_bound(rows: Sequence[dict], lens: str) -> Decimal | None:
    """The LENS_TOP-th best exact metric among priced rows for a lens (None when fewer are priced)."""
    metric = METRICS[lens]
    vals = sorted((r["_pnl"][metric] for r in rows
                   if lens != "time" or r["_pnl"]["target"] >= Decimal(r["_cost_c"]) / 100), reverse=True)
    return vals[LENS_TOP - 1] if len(vals) >= LENS_TOP else None


def can_rank(rg: Ranged, lens: str, bar: Decimal | None) -> bool:
    if lens == "time" and rg.pnl["target"][1] < Decimal(rg.z.cost_c) / 100:
        return False
    return bar is None or rg.pnl[METRICS[lens]][1] >= bar


# ── lenses ───────────────────────────────────────────────────────────────────

def _tiebreak(view: str) -> Callable[[dict], tuple]:
    sign = 1.0 if view == "up" else -1.0
    return lambda r: (r["cost"], r["exp"], sign * r["strike"], r["contract"])


def lens_order(rows: list[dict], lens: str, view: str) -> list[dict]:
    tb = _tiebreak(view)
    if lens == "payoff":
        return sorted(rows, key=lambda r: (-r["_pnl"]["target"], *tb(r)))
    if lens == "forgiving":
        return sorted(rows, key=lambda r: (-r["_pnl"]["half"], *tb(r)))
    doubled = [r for r in rows if r["_pnl"]["target"] >= Decimal(r["_cost_c"]) / 100]
    return sorted(doubled, key=lambda r: (-r["_pnl"]["flat"], *tb(r)))


def empty_words(dropped: Mapping[str, int]) -> str | None:
    parts = [(n, s) for s, n in dropped.items() if n]
    if not parts:
        return None
    parts.sort(key=lambda p: (-p[0], SCREENS.index(p[1])))
    return ", ".join(f"{n} {SCREEN_WORDS[s]}" for n, s in parts)


def curve_prices(spot: float, target: float, half: float) -> list[float]:
    lo, hi = 0.5 * min(spot, target), 1.5 * max(spot, target)
    step = (hi - lo) / (CURVE_POINTS - 1)
    return sorted({lo + i * step for i in range(CURVE_POINTS)} | {spot, half, target})


def _finite(obj: Any) -> bool:
    stack = [obj]
    while stack:
        v = stack.pop()
        if (isinstance(v, float) and not math.isfinite(v)) or (isinstance(v, Decimal) and not v.is_finite()):
            return False
        if isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, (list, tuple)):
            stack.extend(v)
    return True


# ── the run ──────────────────────────────────────────────────────────────────

CAP_WORDS = {
    "rows": "Too many contracts to price at once: shorten the scan window or narrow the strikes.",
    "other_rows": "Too many calibration contracts to price at once.",
    "event_rows": "Too many event-expiry contracts to price at once.",
    "dividends": "Too many dividend rows to read at once.",
    "events": "Too many events to read at once.",
}
REFUSE = "Too much to price at once: shorten the scan window or narrow the strikes."


def _schedule_check(sched: Sequence[Dividend], s0: float, session: date, last: date, curve: om.Curve) -> str | None:
    owed_ = [d for d in sched if session <= d.cum_session < last]
    if len(owed_) > om.DIVS_MAX:
        return f"The dividend schedule has {len(owed_)} payments before the last expiry, more than the pricer takes ({om.DIVS_MAX})."
    pv = sum(d.amount * curve.df((d.cum_session - session).days / om.YEAR_DAYS) for d in owed_)
    if s0 - pv < 0.5 * s0:
        return f"The dividend schedule's present value {money(pv)} is not plausible against the {money(s0)} close."
    return None


def run(rows: Iterable[Mapping[str, Any]], thesis: Thesis, market: Market, *,
        other_rows: Iterable[Mapping[str, Any]] = (), event_rows: Iterable[Mapping[str, Any]] = (),
        dividends: Mapping[str, Any] | None = None, events: Iterable[Mapping[str, Any]] = (),
        known_earnings: Iterable[Mapping[str, Any]] = (),
        coverage: Mapping[str, Any] | None = None, truncated: bool = False, notes: Iterable[str] = (),
        work_limit: int = WORK_LIMIT) -> dict:
    t, m = thesis, market
    inputs = {"rows": list(rows), "other_rows": list(other_rows), "event_rows": list(event_rows),
              "dividends": list((dividends or {}).get("rows") or ()), "events": list(events)}
    for name, seq in inputs.items():
        if len(seq) > CAPS[name]:
            raise FinderError(CAP_WORDS[name])
    validate(t, m)
    s0 = float(m.spot)
    session = m.session
    work = Work(work_limit)
    pricer = Pricer(work)
    curve, curve_points, run_notes = build_curve(m.curve_rows, session)
    run_notes = list(run_notes)
    if m.sessions_behind == 1:
        stale = (f"These quotes are from the {_day(session)} close; the {_day(m.latest_session)} session's quotes "
                 "are not in yet.")
    else:
        stale = None

    # screens 0 to 5 on the candidates (section 5)
    win = window(t, s0)
    lo_k, hi_k = win["_bounds"]
    exp_to = date.fromisoformat(win["exp_to"])
    dropped = {s: 0 for s in SCREENS}
    seen = 0
    cands: list[Quote] = []
    for raw in inputs["rows"]:
        seen += 1
        contract, k, e = raw.get("contract"), _num(raw.get("strike")), _date(raw.get("exp_date"))
        if not isinstance(contract, str) or not contract or k is None or k <= 0 or e is None:
            dropped["bad_row"] += 1
            continue
        if (raw.get("type") != t.kind or not (t.by <= e <= exp_to) or not (lo_k <= _dec(k) <= hi_k)
                or k > QUOTE_MAX or (e - session).days > MAX_EXPIRY_DAYS):
            dropped["outside_window"] += 1
            continue
        if e > m.calendar_through:
            dropped["beyond_calendar"] += 1
            continue
        reason, q = quote_screen(raw, session, m.occ_root)
        if reason is not None:
            dropped[reason] += 1
            continue
        cands.append(q)
    # screen 6, then 7 and 8
    work.charge(om.UNITS_CLOSED_FORM * len(cands))
    kept, n_arb = no_arbitrage(cands, s0, curve, session)
    dropped["no_arbitrage"] += n_arb
    limit = _dec(t.max_spread)
    survivors = []
    for q in kept:
        if not _spread_ok(q, limit):
            dropped["wide_spread"] += 1
            continue
        oi = _num(q.raw.get("open_interest"))
        if oi is None or oi < t.min_oi:
            dropped["low_oi"] += 1
            continue
        survivors.append(q)

    # calibration pool: every row's quote-validity screens only (DR-33)
    pool: dict[str, Quote] = {}
    for raw in (*inputs["rows"], *inputs["other_rows"], *inputs["event_rows"]):
        reason, q = quote_screen(raw, session, m.occ_root)
        if reason is None and session < q.exp <= m.calendar_through and (q.exp - session).days <= MAX_EXPIRY_DAYS:
            pool.setdefault(q.contract, q)
    event_expiries = sorted({q.exp for raw in inputs["event_rows"] for r_, q in [quote_screen(raw, session, m.occ_root)]
                             if r_ is None and session < q.exp <= m.calendar_through})
    expiries = sorted({q.exp for q in survivors} | set(event_expiries))
    last = max(expiries) if expiries else t.by

    # dividends (sections 2 and 3)
    div_ok = (dividends or {}).get("status") == "ok"
    divs, ignored = normalize_dividends(inputs["dividends"], s0) if div_ok else ([], 0)
    if ignored:
        run_notes.append(f"{ignored} dividend rows were not usable and were ignored.")
    if not div_ok:
        run_notes.append("Dividend data unavailable: no dividends are in the carry.")
    sched, sched_notes = schedule(divs, session, last, Sessions(m.closes, m.calendar_through)) if div_ok else ([], [])
    run_notes.extend(sched_notes)
    schedule_ok = div_ok
    bad = _schedule_check(sched, s0, session, last, curve)
    if bad:
        run_notes.append(bad + " The carry uses the market forward alone.")
        sched, schedule_ok = [], False
    covered: date | None = None
    for d in sched:  # sorted by ex-date; a cluster = cum closes within om.DIV_WINDOW days (DR-48)
        group = [g for g in sched if d.cum_session <= g.cum_session < d.cum_session + timedelta(days=om.DIV_WINDOW)]
        total = sum(g.amount for g in group)
        if total > om.DIV_FRAC_MAX * s0 and (covered is None or d.cum_session > covered):
            covered = max(g.cum_session for g in group)
            what = (f"The {money(total)} dividend going ex on {_day(d.ex_date)} is" if len(group) == 1 else
                    f"Dividends totalling {money(total)} going ex from {_day(group[0].ex_date)} to {_day(group[-1].ex_date)} are")
            run_notes.append(f"{what} more than 3% of the price, where the pricer is not validated: contracts "
                             f"{'it falls' if len(group) == 1 else 'they fall'} in cannot be priced.")

    # events (section 8)
    evs, ev_ignored = normalize_events(inputs["events"])
    if ev_ignored:
        run_notes.append(f"{ev_ignored} event rows were not usable and were ignored.")
    # earnings discovery (design S-10): one report per day over the window and every known row; any unusable
    # earnings row, here or in the route, leaves it incomplete
    reports, move_ids, bad_known = earnings_reports(evs, known_earnings, session, m.closes)
    bad_window = (sum(1 for r in inputs["events"] if isinstance(r, Mapping) and r.get("kind") == "earnings")
                  - sum(1 for ev in evs if ev.kind == "earnings"))
    unusable = bad_known + bad_window + max(0, int(_num((coverage or {}).get("unreadable")) or 0))
    if unusable:
        run_notes.append(f"{unusable} earnings rows were unusable and were ignored.")
    # complete only when a calendar was read through a date with nothing unusable; stored rows never are (design A-3)
    cov = coverage or {}
    complete_through = _date(cov.get("earnings_through")) if cov.get("earnings") in ("fetched", "not_found") and not unusable else None
    evs = sorted(evs + dividend_events(sched), key=lambda ev: (ev.day, ev.id))

    # carry per expiry (no up-front estimate: the counter refuses at the charge that would pass the budget, DR-44)
    by_exp: dict[date, list[Quote]] = {}
    for q in pool.values():
        by_exp.setdefault(q.exp, []).append(q)
    carries, carry_facts = calibrate_all(expiries, by_exp, s0, session, curve, sched, schedule_ok, pricer)
    outside = [e for e in expiries if carries[e].source == "outside domain"]
    if outside:
        run_notes.append(f"The call and put pairs at {', '.join(_day(e) for e in outside)} imply a residual yield beyond "
                         f"±10% a year, where the pricer is not validated: contracts at "
                         f"{'that expiry' if len(outside) == 1 else 'those expiries'} cannot be priced.")

    # value every survivor
    s0_d, x_d = _dec(s0), _dec(t.target)
    half_d = s0_d + (x_d - s0_d) / 2
    prices = {"target": x_d, "half": half_d, "flat": s0_d}
    rc = RowCtx(t, m, curve, sched, carries, pricer, prices, commission_cents(t.commission), budget_cents(t.budget), evs,
                complete_through)
    sized: list[Sized] = []
    for q in survivors:  # screen 10 before 9 (rev 5): sizing is exact and needs no volatility
        if carries[q.exp].source == "outside domain":
            dropped["unpriceable"] += 1
            continue
        price_c = premium_cents(q.ask_d if t.fill == "ask" else q.mid_d)
        n = rc.budget_c // (price_c + rc.comm_c)
        if n < 1:
            dropped["over_budget"] += 1
            continue
        sized.append(Sized(q, _context_on(rc, q, 0.3, session, s0), 0.0, price_c, n, n * (price_c + rc.comm_c)))
    ranged: dict[str, Ranged] = {}
    for z in sized:
        got = sigma_range(rc, z.c0, z.q.mid)
        if not isinstance(got, str):
            got = ranges(rc, z, *got)
        if isinstance(got, str):
            dropped[got] += 1
        else:
            ranged[z.q.contract] = got
    # price in rounds: first each lens's LENS_TOP best lower bounds, then every unpriced row whose upper bound
    # reaches the LENS_TOP-th best exact value, until none does (rev 5)
    passed: list[dict] = []
    quote_of: dict[str, Quote] = {}
    done: set[str] = set()
    todo: set[str] = set()
    for lens, metric in METRICS.items():
        pool_ = [rg for rg in ranged.values() if lens != "time" or rg.pnl["target"][0] >= Decimal(rg.z.cost_c) / 100]
        pool_.sort(key=lambda rg: rg.pnl[metric][0], reverse=True)
        todo |= {rg.z.q.contract for rg in pool_[:LENS_TOP]}
    while todo:
        batch = [ranged[c].z for c in sorted(todo)]
        done |= todo
        ivs = implied_vols(rc, [z.q for z in batch])
        ready = []
        for z in batch:
            sg = ivs[z.q.contract]
            if isinstance(sg, str):
                dropped[sg] += 1
                continue
            ready.append(Sized(z.q, z.c0.with_sigma(sg), sg, z.price_c, z.n, z.cost_c))
        priced = value_rows(rc, ready)
        for z in ready:
            reason, row = priced[z.q.contract]
            if reason is None and not _finite(row):
                reason = "unpriceable"
            if reason is not None:
                dropped[reason] += 1
                continue
            passed.append(row)
            quote_of[row["contract"]] = z.q
        bars = {lens: rank_bound(passed, lens) for lens in METRICS}
        todo = {c for c, rg in ranged.items() if c not in done and any(can_rank(rg, lens, bars[lens]) for lens in METRICS)}
    ranked_out = len(ranged) - len(done)

    ordered = {lens: lens_order(passed, lens, t.view) for lens in LENSES}
    picks = {lens: (rs[0]["contract"] if rs else None) for lens, rs in ordered.items()}
    lens_reasons = {"time": None}
    if passed and picks["time"] is None:
        lens_reasons["time"] = "No contract that passed the screens is worth at least twice its cost at the target."
    empty = None
    if not passed:
        kind = "calls" if t.kind == "call" else "puts"
        if seen == 0 and truncated:
            empty = (f"The provider's list for this window was longer than the Finder could read, and no expiry in it "
                     f"was read completely, so nothing can be compared; this does not mean no {kind} are listed.")
        elif seen == 0:
            empty = (f"No listed {kind} in the window: expiries {win['exp_from']} to {win['exp_to']}, "
                     f"strikes {money(win['strike_from'])} to {money(win['strike_to'])}.")
        else:
            empty = f"None of the {seen} {kind} passed the screens: {empty_words(dropped)}."
    half = float(half_d)
    grid = curve_prices(s0, t.target, half)
    by_contract = {r["contract"]: r for r in passed}
    curves = {c: curve_pnl(rc, quote_of[c], by_contract[c], grid) for c in dict.fromkeys(p for p in picks.values() if p)}

    carry_out = []
    for e in expiries:
        c, f = carries[e], carry_facts[e]
        df = math.exp(-f["rate"] * f["days"] / om.YEAR_DAYS)
        pv_mkt = s0 - c.forward * df if c.source == "market" else None
        known = c.source != "outside domain"
        carry_out.append({"exp": e.isoformat(), "forward": c.forward if known else None, "q": c.q if known else None,
                          "pv_market": pv_mkt,
                          "pv_schedule": f["pv_schedule"], "difference": (pv_mkt - f["pv_schedule"]) if pv_mkt is not None else None,
                          "pairs": c.pairs, "source": c.source, "words": CARRY_WORDS[c.source], "atm_vol": c.atm_vol})
    found_earnings = any(r.day >= session for r in reports)
    last_scanned = max((q.exp for q in survivors), default=t.by)
    # the events list ends at the close of the scan's last expiry: the route bounds earnings and macro releases by
    # its date only, and declared dividends have no upper date in the schedule (Codex S-17, S-18)
    scan_last = max((d for d in (_date(r.get("exp_date")) for r in inputs["rows"] if isinstance(r, Mapping)) if d), default=t.by)
    if cov.get("earnings") == "not_checked":
        earnings_status = "not_checked"
    elif complete_through is not None and complete_through >= last_scanned:
        earnings_status = "known"
    else:
        earnings_status = "unknown"
    answer = {
        "inputs": {"view": t.view, "type": t.kind, "target": t.target, "by": t.by.isoformat(),
                   "budget": budget_cents(t.budget) / 100.0, "min_oi": t.min_oi, "max_spread": t.max_spread,
                   "fill": t.fill, "scan_months": t.scan_months, "commission": rc.comm_c / 100.0,
                   "implied_move_pct": round((t.target / s0 - 1.0) * 100.0, 2), "half_price": half},
        "universe": {"window": {k: v for k, v in win.items() if not k.startswith("_")}, "seen": seen,
                     "passed": len(passed), "dropped": dropped, "ranked_out": ranked_out,
                     "ranked_out_words": (f"{ranked_out} contracts passed the screens but were not priced: bounds on "
                                          f"their value show none can reach the top {LENS_TOP} of any lens.")
                                         if ranked_out else None,
                     "truncated": bool(truncated)},
        "picks": picks,
        "lens_reasons": lens_reasons,
        "empty": empty,
        "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in ordered["payoff"]],
        "curve": {"prices": grid, "marks": {"close": s0, "half": half, "target": t.target}, "pnl": curves},
        "rates": {"points": curve_points, "rule": "Zero rates from DGS3MO, DGS2 and DGS5, linear in time between "
                                                   "0.25, 2 and 5 years and flat outside, continuously compounded."},
        "carry": carry_out,
        "dividends": [{"ex_date": d.ex_date.isoformat(), "cum_session": d.cum_session.isoformat(), "amount": d.amount,
                       "period": d.period, "label": "projected, not declared" if d.projected else "declared"} for d in sched],
        "events": event_list([ev for ev in evs if position(ev, scan_last, m.closes) != "after"], session, t.by,
                             m.closes),  # events after the last expiry's close are not before expiry (Codex S-17, S-18)
        "coverage": coverage_words(coverage or {}, m.symbol or m.occ_root, div_ok, found_earnings, unusable > 0),
        "earnings_status": earnings_status,
        "earnings_moves": earnings_moves(reports, session, last_scanned, m.closes, carries, event_expiries,
                                         eligible=move_ids, incomplete=unusable > 0, complete_through=complete_through),
        "stale": stale,
        "work": {"used": work.used, "limit": work.limit},
        "method": {
            "version": VERSION,
            "tolerances": {"value": f"max({om.TOL_SPOT:g} x spot, {om.TOL_VALUE:g} x value) per share",
                           "european_iv": 1e-12, "american_iv": "1e-3 x tol in price", "breakeven_european": 1e-10,
                           "delta_tree": om.DELTA_TOL, "delta_zone": f"{om.DELTA_ZONE:g} x tol"},
            "lattice": {"n_min": om.N_MIN, "k_min": om.K_MIN},
            "notes": [*run_notes, *notes],
        },
    }
    return answer
