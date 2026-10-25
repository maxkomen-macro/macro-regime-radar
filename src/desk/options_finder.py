"""src/desk/options_finder.py — the Options Finder's engine (method finder-1).

A visitor states a view: a US stock or ETF goes up (or down) to a target price
by a date, risking a budget. The engine reads one end-of-day option chain and
says, for every listed call (or put) that passes the screens, what the
position the budget buys would be worth on that date if the stock is at the
target, halfway there, or unchanged. It ranks by three lenses, each a plain
sort, never a blended score:

- **payoff**: dollar P&L at the target on the date;
- **forgiving**: dollar P&L halfway to the target;
- **time**: least lost if the stock is unchanged, among contracts whose value
  at the target is at least twice their cost.

Values on the date (design F2 §5): a contract that expires on the date is
worth its intrinsic value, exactly. One that expires later is modelled with
Black-Scholes at its own provider IV held flat, the stored 3-month Treasury
yield (continuously compounded) and the served dividend yield, and is
labelled modelled, with the same values at IV − 10 points beside it. The
probability shown is risk-neutral (the market's pricing, not a forecast).

Pure: stdlib only, no I/O and no clock. api/desk_options.py fetches the chain,
the close, the rate and the dividend yield and calls `run`.
"""

from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation
from typing import Any, Callable, Iterable, Mapping

VERSION = "finder-1"
MODEL = "bs-flat-iv"

VIEWS = ("up", "down")
FILLS = ("ask", "mid")
DEFAULT_MIN_OI = 100
DEFAULT_MAX_SPREAD = 0.10
DEFAULT_FILL = "ask"
DEFAULT_SCAN_MONTHS = 6
IV_MIN, IV_MAX = 0.05, 3.00
IV_SHOCK = 0.10
IV_FLOOR = 0.01
IV_DISAGREE = 0.05
BUDGET_MIN, BUDGET_MAX = 1.0, 10_000_000.0
MAX_TARGET_MULTIPLE = 10.0
MAX_HORIZON_DAYS = 3 * 366
MIN_OI_MAX = 1_000_000
SPREAD_MIN, SPREAD_MAX = 0.01, 1.00
SCAN_MONTHS_MIN, SCAN_MONTHS_MAX = 1, 12
RATE_MIN, RATE_MAX = -0.05, 0.25
DIV_MIN, DIV_MAX = 0.0, 0.25
CONTRACT_SIZE = 100
CURVE_POINTS = 81
# The strike window (design F2 §2): up, 20% below the close to 30% past the target; down mirrors it.
STRIKE_BELOW_CLOSE, STRIKE_PAST_TARGET = 0.20, 0.30

# The screens, in the order they are applied; a contract is counted under the first it fails.
SCREENS = ("bad_row", "outside_window", "no_bid", "bad_ask", "wide_spread", "low_oi", "stale_quote", "bad_iv", "over_budget",
           "unpriceable")
SCREEN_WORDS = {
    "bad_row": "had no contract id, strike or expiry",
    "outside_window": "were outside the scan window",
    "no_bid": "had no bid",
    "bad_ask": "had no usable ask",
    "wide_spread": "were too wide",
    "low_oi": "had too little open interest",
    "stale_quote": "had a quote from another session",
    "bad_iv": "had an implied volatility outside 5% to 300%",
    "over_budget": "cost more than the budget",
    "unpriceable": "could not be priced",
}
# Magnitudes the engine prices (design F2 §1): far inside float range for every formula below.
SPOT_MIN, SPOT_MAX = 0.01, 1_000_000.0
QUOTE_MAX = 1_000_000.0
TICK = 0.01  # the smallest listed option tick: a bid or ask under a cent is not a listed price
MAX_EXPIRY_DAYS = 4 * 366
BRACKET_CAP = 1e9
BE_TOL, PRICE_TOL = 0.0001, 0.005
LENSES = ("payoff", "forgiving", "time")


class FinderError(ValueError):
    """A thesis the engine cannot run; the message names what is wrong. `kind` is "input" for a visitor's
    parameter (the route answers 422) and "market" for a value the route fetched (a provider fault)."""

    def __init__(self, message: str, kind: str = "input") -> None:
        super().__init__(message)
        self.kind = kind


# ── dates ────────────────────────────────────────────────────────────────────

def add_months(d: date, months: int) -> date:
    """The same calendar day `months` later, clamped to that month's last day."""
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


# ── numbers ──────────────────────────────────────────────────────────────────

def _num(x: Any) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    v = float(x)
    return v if math.isfinite(v) else None


def _cents(x: float) -> float:
    return round(x + 0.0, 2)


def _dec(x: float | int) -> Decimal:
    """A finite number as an exact Decimal of its shortest round-trip text (design F2 §4)."""
    return Decimal(x) if isinstance(x, int) else Decimal(repr(float(x)))


def budget_cents(budget: float) -> int:
    """The budget in whole cents, floored exactly."""
    return int((_dec(budget) * 100).to_integral_value(rounding=ROUND_FLOOR))


def premium_cents(raw: Decimal) -> int:
    """One contract (100 shares) at a per-share premium, in whole cents, rounded up exactly."""
    return int((raw * 10_000).to_integral_value(rounding=ROUND_CEILING))


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_value(kind: str, s: float, k: float, tau: float, sigma: float, r: float, q: float) -> float:
    """Black-Scholes value of one share's option (call or put), tau in years > 0, sigma > 0.
    An underlying at or below zero answers the limit: a call 0, a put its discounted strike."""
    if s <= 0.0:
        return 0.0 if kind == "call" else k * math.exp(-r * tau)
    vol = sigma * math.sqrt(tau)
    d1 = (math.log(s / k) + (r - q + 0.5 * sigma * sigma) * tau) / vol
    d2 = d1 - vol
    if kind == "call":
        return s * math.exp(-q * tau) * _ncdf(d1) - k * math.exp(-r * tau) * _ncdf(d2)
    return k * math.exp(-r * tau) * _ncdf(-d2) - s * math.exp(-q * tau) * _ncdf(-d1)


def intrinsic(kind: str, s: float, k: float) -> float:
    return max(s - k, 0.0) if kind == "call" else max(k - s, 0.0)


def rn_prob_past(kind: str, s0: float, level: float, t: float, sigma: float, r: float, q: float) -> float:
    """The risk-neutral probability that the underlying finishes above `level` (call) or below it (put)
    at horizon t > 0, from the lognormal with volatility sigma."""
    if level <= 0.0:
        return 1.0 if kind == "call" else 0.0
    vol = sigma * math.sqrt(t)
    d2 = (math.log(s0 / level) + (r - q - 0.5 * sigma * sigma) * t) / vol
    return _ncdf(d2) if kind == "call" else _ncdf(-d2)


def _bisect(f: Callable[[float], float], lo: float, hi: float, width: float, steps: int = 200) -> float:
    """The root of an increasing f on [lo, hi] with f(lo) <= 0 <= f(hi), to `width` or `steps` halvings."""
    for _ in range(steps):
        if hi - lo <= width:
            break
        mid = 0.5 * (lo + hi)
        if f(mid) < 0.0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def breakeven_on_date(kind: str, k: float, tau: float, sigma: float, r: float, q: float, fill: float, s0: float) -> float | None:
    """The underlying price on the date at which the modelled value equals the fill (design F2 §7)."""
    def value(s: float) -> float:
        return bs_value(kind, s, k, tau, sigma, r, q)

    hi = max(k, s0)
    if kind == "call":
        while value(hi) < fill:
            hi *= 2.0
            if hi > BRACKET_CAP:
                return None
        be = _bisect(lambda s: value(s) - fill, 0.0, hi, BE_TOL)
    else:
        if k * math.exp(-r * tau) <= fill:
            return None
        while value(hi) > fill:
            hi *= 2.0
            if hi > BRACKET_CAP:
                return None
        be = _bisect(lambda s: fill - value(s), 0.0, hi, BE_TOL)
    return be if be > 0 and abs(value(be) - fill) <= PRICE_TOL else None


def implied_vol(kind: str, price: float, s0: float, k: float, t: float, r: float, q: float) -> tuple[float | None, str | None]:
    """(the Black-Scholes volatility in [0.001, 5] that reprices `price`, None) or (None, why not)."""
    lo, hi = 0.001, 5.0

    def f(v: float) -> float:
        return bs_value(kind, s0, k, t, v, r, q) - price

    if not (f(lo) <= 0.0 <= f(hi)):
        return None, "outside the model's range"
    v = _bisect(f, lo, hi, 1e-6)
    return (v, None) if abs(f(v)) <= PRICE_TOL else (None, "unresolved")


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

    @property
    def kind(self) -> str:
        return "call" if self.view == "up" else "put"


@dataclass(frozen=True)
class Market:
    """What the route fetched: the session the quotes describe, the close that session, the rate and the yield."""
    session: date
    spot: float
    rate: float
    dividend_yield: float


def money(x: float) -> str:
    return f"${x:,.2f}"


def validate(t: Thesis, m: Market) -> None:
    """Design F2 §1. Every refusal names what is wrong."""
    if t.view not in VIEWS:
        raise FinderError(f"The view {t.view!r} is not up or down.")
    if t.fill not in FILLS:
        raise FinderError(f"The fill {t.fill!r} is not ask or mid.")
    spot = _num(m.spot)
    if spot is None or not (SPOT_MIN <= spot <= SPOT_MAX):
        raise FinderError("The session close is not a price from $0.01 to $1,000,000.", "market")
    if _num(m.rate) is None or not (RATE_MIN <= m.rate <= RATE_MAX):
        raise FinderError("The stored 3-month Treasury yield is outside -5% to 25%.", "market")
    if _num(m.dividend_yield) is None or not (DIV_MIN <= m.dividend_yield <= DIV_MAX):
        raise FinderError("The served dividend yield is outside 0% to 25%.", "market")
    x = _num(t.target)
    if x is None or x <= 0:
        raise FinderError("The target is not a positive price.")
    close = f"the {m.session:%b} {m.session.day:02d}, {m.session.year} close of {money(spot)}"  # the site's date style (fmtDate)
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
    b = _num(t.budget)
    if b is None or not (BUDGET_MIN <= b <= BUDGET_MAX):
        raise FinderError("The budget is not between $1 and $10,000,000.")
    if isinstance(t.min_oi, bool) or not isinstance(t.min_oi, int) or not (0 <= t.min_oi <= MIN_OI_MAX):
        raise FinderError("The minimum open interest is not a whole number from 0 to 1,000,000.")
    if _num(t.max_spread) is None or not (SPREAD_MIN <= t.max_spread <= SPREAD_MAX):
        raise FinderError("The widest spread is not between 1% and 100% of the mid.")
    if isinstance(t.scan_months, bool) or not isinstance(t.scan_months, int) or not (SCAN_MONTHS_MIN <= t.scan_months <= SCAN_MONTHS_MAX):
        raise FinderError("The scan window is not 1 to 12 months.")


def strike_bounds(t: Thesis, spot: float) -> tuple[Decimal, Decimal]:
    """The strike window (design F2 §2) as exact Decimals: a strike on a bound is inside it."""
    s0, x = _dec(spot), _dec(t.target)
    below, past = _dec(STRIKE_BELOW_CLOSE), _dec(STRIKE_PAST_TARGET)
    if t.view == "up":
        return s0 * (1 - below), x * (1 + past)
    return x * (1 - past), s0 * (1 + below)


def window(t: Thesis, spot: float) -> dict:
    """The scan window (design F2 §2): expiries and strikes. The route queries it rounded outward; the
    screen re-checks every row against the exact bounds."""
    lo, hi = strike_bounds(t, spot)
    return {
        "type": t.kind,
        "exp_from": t.by.isoformat(),
        "exp_to": add_months(t.by, t.scan_months).isoformat(),
        "strike_from": float(lo),
        "strike_to": float(hi),
        "_bounds": (lo, hi),
    }


# ── one contract ─────────────────────────────────────────────────────────────

def _screen(row: Mapping[str, Any], t: Thesis, win: dict, session: date) -> tuple[str | None, dict]:
    """The first screen a row fails (None when it passes) and its parsed fields."""
    contract = row.get("contract")
    k = _num(row.get("strike"))
    e = _date(row.get("exp_date"))
    if not isinstance(contract, str) or not contract or k is None or k <= 0 or e is None:
        return "bad_row", {}
    f = {"contract": contract, "strike": k, "exp": e}
    if (row.get("type") != t.kind or not (win["exp_from"] <= e.isoformat() <= win["exp_to"])
            or not (win["_bounds"][0] <= _dec(k) <= win["_bounds"][1]) or k > QUOTE_MAX
            or (e - session).days > MAX_EXPIRY_DAYS):
        return "outside_window", f
    bid, ask = _num(row.get("bid")), _num(row.get("ask"))
    if bid is None or bid < TICK:
        return "no_bid", f
    if ask is None or ask < TICK or ask < bid or ask > QUOTE_MAX:
        return "bad_ask", f
    bid_d, ask_d = _dec(bid), _dec(ask)
    mid_d = (bid_d + ask_d) / 2
    spread_d = (ask_d - bid_d) / mid_d
    f.update(bid=bid, ask=ask, mid=float(mid_d), spread=float(spread_d))
    if 2 * (ask_d - bid_d) > _dec(t.max_spread) * (ask_d + bid_d):
        return "wide_spread", f
    oi = _num(row.get("open_interest"))
    if oi is None or oi < t.min_oi:
        return "low_oi", f
    f["oi"] = oi
    iso = session.isoformat()
    if row.get("bid_session") != iso or row.get("ask_session") != iso:
        return "stale_quote", f
    iv = _num(row.get("implied_vol"))
    if iv is None or not (IV_MIN <= iv <= IV_MAX):
        return "bad_iv", f
    f["iv"] = iv
    price_c = premium_cents(_dec(ask) if t.fill == "ask" else mid_d)
    budget_c = budget_cents(t.budget)
    n = budget_c // price_c
    if n < 1:
        return "over_budget", f
    f.update(fill=float(Decimal(price_c) / 10_000), n=n, cost_c=n * price_c, budget_c=budget_c)
    return None, f


def _value_fn(kind: str, k: float, e: date, by: date, sigma: float, r: float, q: float) -> tuple[bool, Callable[[float], float]]:
    """(modelled, value of one share's option on the date at an underlying price)."""
    if e == by:
        return False, lambda s: intrinsic(kind, s, k)
    tau = (e - by).days / 365.0
    return True, lambda s: bs_value(kind, s, k, tau, sigma, r, q)


def _pnl_fn(kind: str, k: float, e: date, by: date, sigma: float, r: float, q: float, n: int, cost_c: int) -> Callable[[Decimal], Decimal]:
    """The position's P&L on the date at an underlying price, as an exact Decimal (design F2 §5's number
    types): intrinsic rows exactly, modelled rows as the float computed, converted exactly."""
    cost = Decimal(cost_c) / 100
    if e == by:
        kd = _dec(k)

        def exact(s: Decimal) -> Decimal:
            v = max(s - kd, Decimal(0)) if kind == "call" else max(kd - s, Decimal(0))
            return n * CONTRACT_SIZE * v - cost
        return exact
    _, value = _value_fn(kind, k, e, by, sigma, r, q)
    return lambda s: Decimal(n * CONTRACT_SIZE * value(float(s)) - cost_c / 100.0)


def _usd(x: Decimal) -> float:
    """A P&L in dollars, served to the cent."""
    return float(x.quantize(Decimal("0.01")))


def _row(raw: Mapping[str, Any], f: dict, t: Thesis, m: Market, prices: dict[str, float]) -> dict:
    kind, k, e = t.kind, f["strike"], f["exp"]
    n, fill, iv = f["n"], f["fill"], f["iv"]
    cost = f["cost_c"] / 100.0
    r, q = m.rate, m.dividend_yield
    modelled = e != t.by
    raw_pnl = {name: _pnl_fn(kind, k, e, t.by, iv, r, q, n, f["cost_c"])(s) for name, s in prices.items()}
    shocked = None
    if modelled:
        low = _pnl_fn(kind, k, e, t.by, max(iv - IV_SHOCK, IV_FLOOR), r, q, n, f["cost_c"])
        shocked = {name: _usd(low(s)) for name, s in prices.items()}
    be_exp = float(_dec(k) + _dec(fill)) if kind == "call" else float(_dec(k) - _dec(fill))
    be_exp_out = be_exp if be_exp > 0 else None  # served unrounded (design F2 §7)
    if modelled:
        be = breakeven_on_date(kind, k, (e - t.by).days / 365.0, iv, r, q, fill, m.spot)
        be_date = be
    else:
        be_date = be_exp_out
    horizon = (e - m.session).days / 365.0
    prob = rn_prob_past(kind, m.spot, be_exp, horizon, iv, r, q) if be_exp > 0 else 0.0
    resolved, why = implied_vol(kind, f["mid"], m.spot, k, horizon, r, q)
    theta = _num(raw.get("theta"))
    delta = _num(raw.get("delta"))
    return {
        "contract": f["contract"],
        "type": kind,
        "exp": e.isoformat(),
        "strike": k,
        "days_past_date": (e - t.by).days,
        "bid": f["bid"],
        "ask": f["ask"],
        "mid": f["mid"],
        "fill": fill,
        "quote_ts": raw.get("last_quote") if isinstance(raw.get("last_quote"), str) and raw.get("last_quote") else None,
        "oi": f["oi"],
        "iv": iv,
        "delta": delta,
        "theta_dollars_day": _cents(theta * CONTRACT_SIZE * n) if theta is not None else None,
        "spread_pct": round(f["spread"], 4),
        "n": n,
        "cost": cost,
        "unused": (f["budget_c"] - f["cost_c"]) / 100.0,
        "max_loss": cost,
        "breakeven_expiry": be_exp_out,
        "breakeven_on_date": be_date,
        "pnl": {name: _usd(x) for name, x in raw_pnl.items()},
        "_pnl": raw_pnl,  # exact Decimals: the lenses sort and test eligibility on them, never served
        "_cost_c": f["cost_c"],
        "modelled": modelled,
        "iv_minus_10": shocked,
        "rn_prob_breakeven": round(prob, 4),
        "iv_check": {"resolved": round(resolved, 4) if resolved is not None else None,
                     "disagrees": (abs(resolved - iv) > IV_DISAGREE) if resolved is not None else None,
                     "reason": why},
    }


# ── lenses ───────────────────────────────────────────────────────────────────

def _tiebreak(view: str) -> Callable[[dict], tuple]:
    sign = 1.0 if view == "up" else -1.0
    return lambda r: (r["cost"], r["exp"], sign * r["strike"], r["contract"])


def lens_order(rows: list[dict], lens: str, view: str) -> list[dict]:
    """A lens's rows in order, on the unrounded P&L (design F2 §9: rounding is for serving only)."""
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


# ── the run ──────────────────────────────────────────────────────────────────

def curve_prices(spot: float, target: float, half: float) -> list[float]:
    lo, hi = 0.5 * min(spot, target), 1.5 * max(spot, target)
    step = (hi - lo) / (CURVE_POINTS - 1)
    grid = {lo + i * step for i in range(CURVE_POINTS)} | {spot, half, target}
    return sorted(grid)


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


def run(rows: Iterable[Mapping[str, Any]], thesis: Thesis, market: Market, *, truncated: bool = False,
        notes: Iterable[str] = ()) -> dict:
    """Design F2: screen, size, value, rank. `rows` are the chain's contracts in the market layer's
    shape (api/providers/market.options_window: options_chain's contract fields plus `bid_session` and
    `ask_session`, the sessions the provider layer read from each side's stamp)."""
    validate(thesis, market)
    t, m = thesis, market
    win = window(t, m.spot)
    s0_d, x_d = _dec(m.spot), _dec(t.target)
    half_d = s0_d + (x_d - s0_d) / 2  # exact
    half = float(half_d)
    prices = {"target": x_d, "half": half_d, "flat": s0_d}
    dropped = {s: 0 for s in SCREENS}
    passed: list[dict] = []
    seen = 0
    for raw in rows:
        seen += 1
        reason, f = _screen(raw, t, win, m.session)
        if reason is not None:
            dropped[reason] += 1
            continue
        try:
            row = _row(raw, f, t, m, prices)
        except (ValueError, OverflowError, ZeroDivisionError, InvalidOperation):
            row = None
        if row is None or not _finite(row):
            dropped["unpriceable"] += 1
            continue
        passed.append(row)
    ordered = {lens: lens_order(passed, lens, t.view) for lens in LENSES}
    picks = {lens: (rows_[0]["contract"] if rows_ else None) for lens, rows_ in ordered.items()}
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
    grid = curve_prices(m.spot, t.target, half)
    by_contract = {r["contract"]: r for r in passed}
    curve_pnl = {}
    for c in dict.fromkeys(p for p in picks.values() if p):
        r_ = by_contract[c]
        pnl_at = _pnl_fn(t.kind, r_["strike"], date.fromisoformat(r_["exp"]), t.by, r_["iv"], m.rate, m.dividend_yield, r_["n"], r_["_cost_c"])
        curve_pnl[c] = [_usd(pnl_at(_dec(s))) for s in grid]  # pick rows passed the finite check
    rate_note = "Rates are continuously compounded: the 3-month Treasury yield is used as the risk-free rate."
    return {
        "inputs": {
            "view": t.view, "type": t.kind, "target": t.target, "by": t.by.isoformat(), "budget": budget_cents(t.budget) / 100.0,
            "min_oi": t.min_oi, "max_spread": t.max_spread, "fill": t.fill, "scan_months": t.scan_months,
            "implied_move_pct": round((t.target / m.spot - 1.0) * 100.0, 2),
            "half_price": half,
        },
        "universe": {"window": {k: v for k, v in win.items() if not k.startswith("_")}, "seen": seen, "passed": len(passed), "dropped": dropped, "truncated": bool(truncated)},
        "picks": picks,
        "lens_reasons": lens_reasons,
        "empty": empty,
        "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in ordered["payoff"]],
        "curve": {"prices": grid, "marks": {"close": m.spot, "half": half, "target": t.target}, "pnl": curve_pnl},
        "method": {
            "version": VERSION,
            "model": MODEL,
            "rate": m.rate,
            "dividend_yield": m.dividend_yield,
            "notes": [
                "Contracts that expire on your date are valued at intrinsic value, exactly.",
                "Contracts that expire later are modelled: Black-Scholes with the contract's own implied volatility held flat.",
                rate_note,
                "P&L values the position at that value on your date; the spread on the way out is not charged.",
                "Black-Scholes ignores early exercise, so a modelled put may be understated.",
                "The probability is market-implied (risk-neutral, from each contract's implied volatility), not a forecast.",
                *notes,
            ],
        },
    }
