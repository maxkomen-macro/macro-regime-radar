"""src/desk/basket.py — a basket of stocks priced as one index (desk/books).

Pure: every function takes price histories and returns numbers. Nothing here
fetches, reads the database or keeps state; api/desk_basket.py fetches the
histories (api/providers/market.daily_bars) and serves what these return.

The method, in the order the page states it:

- **The index.** Base 100 on the first session on which every name has a
  close (`start`), and defined on every later session on which every name has
  a close. A session on which one name has no close is not an index session
  (counted in `missing_sessions`); nothing is filled in.
- **Buy-and-hold** (`hold`, the default): the target weights become share
  counts at the start's closes, `shares_i = w_i × notional / P_i(start)`, and
  the counts never change, so each name's weight drifts with its price.
- **Monthly rebalance** (`monthly`): the same at the start, then at the close
  of each calendar month's last index session the counts are reset so each
  name is back at its target weight of the basket's value that day.
- **Contribution to return** of a name: the sum over holding periods of its
  share count times its price change, over the notional, so the names add up
  to the index's return exactly.
- **Concentration** at the last close: the top three weights' share,
  the effective number of names `1 / Σ w²`, and the average of the pairwise
  Pearson correlations of the names' daily returns over the last 252 index
  sessions (all of them when fewer, at least 60).
- **Liquidity**: a name's 20-day average dollar volume is the mean of its
  last 20 sessions' unadjusted close × shares traded; the days to trade it are
  its dollars at target weight of the notional over 20% of that average; the
  basket's figure is the largest.

Prices are split- and dividend-adjusted closes; daily returns are simple
returns between consecutive index sessions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np

METHODS = ("hold", "monthly")
DEFAULT_METHOD = "hold"
DEFAULT_NOTIONAL = 1_000_000.0
ADV_SESSIONS = 20
PARTICIPATION = 0.20
CORR_SESSIONS = 252
CORR_MIN_SESSIONS = 60
WEIGHT_TOLERANCE = 1e-9


class BasketError(ValueError):
    """The basket cannot be priced as asked; the message says why, in words."""


@dataclass(frozen=True)
class History:
    """One name's daily history: ascending session dates, adjusted closes, and
    each session's dollar volume (unadjusted close × shares traded; None when
    the provider gave no volume)."""

    dates: tuple[str, ...]
    close: tuple[float, ...]
    dollar_volume: tuple[float | None, ...]

    def __post_init__(self) -> None:
        if not (len(self.dates) == len(self.close) == len(self.dollar_volume)):
            raise BasketError("a history's dates, closes and volumes differ in length")
        if any(b <= a for a, b in zip(self.dates, self.dates[1:])):
            raise BasketError("a history's dates are not strictly ascending")
        if any(not (math.isfinite(c) and c > 0) for c in self.close):
            raise BasketError("a history carries a close that is not a positive number")


def check_weights(weights: Mapping[str, float]) -> dict[str, float]:
    """Target weights as fractions: every one finite and positive, adding to 1."""
    if not weights:
        raise BasketError("a basket needs at least one name")
    out = {}
    for sym, w in weights.items():
        if not (isinstance(w, (int, float)) and math.isfinite(w) and w > 0):
            raise BasketError(f"the weight of {sym} is not a positive number")
        out[sym] = float(w)
    total = sum(out.values())
    if abs(total - 1.0) > WEIGHT_TOLERANCE:
        raise BasketError(f"the weights add to {total * 100:.6g}%, not 100%")
    return out


def common_start(histories: Mapping[str, History]) -> tuple[str, list[str], bool]:
    """The first session every name has a close, the names whose first close
    it is, and whether it is a later first close than another name's (a
    listing, or a history that begins later) rather than the start of every
    history alike."""
    firsts = {s: h.dates[0] for s, h in histories.items() if h.dates}
    if len(firsts) != len(histories):
        empty = sorted(set(histories) - set(firsts))
        raise BasketError(f"no daily history for {', '.join(empty)}")
    start = max(firsts.values())
    binding = sorted(s for s, d in firsts.items() if d == start)
    return start, binding, start > min(firsts.values())


def index_sessions(histories: Mapping[str, History], start: str) -> tuple[list[str], list[str]]:
    """The index's sessions (on or after `start`, every name with a close) and
    the sessions dropped because some name had none (a session at least one
    name traded, after the start and up to the last index session)."""
    sets = [set(h.dates) for h in histories.values()]
    common = sorted(d for d in set.intersection(*sets) if d >= start)
    if not common:
        raise BasketError("the names share no session")
    union = set().union(*sets)
    dropped = sorted(d for d in union if start <= d <= common[-1] and d not in set(common))
    return common, dropped


def _prices(histories: Mapping[str, History], symbols: Sequence[str], dates: Sequence[str]) -> np.ndarray:
    """A (sessions × names) matrix of adjusted closes on `dates`."""
    out = np.empty((len(dates), len(symbols)))
    for j, s in enumerate(symbols):
        h = histories[s]
        at = dict(zip(h.dates, h.close))
        out[:, j] = [at[d] for d in dates]
    return out


def rebalance_rows(dates: Sequence[str], method: str) -> list[int]:
    """Row numbers where the share counts are set: the start, and for the
    monthly method the last index session of each calendar month before the
    final session."""
    if method not in METHODS:
        raise BasketError(f"the method {method!r} is not one of {', '.join(METHODS)}")
    rows = [0]
    if method == "monthly":
        rows += [i for i in range(1, len(dates) - 1) if dates[i][:7] != dates[i + 1][:7]]
    return rows


def simple_returns(level: np.ndarray) -> np.ndarray:
    """Daily simple returns between consecutive rows (one fewer than rows)."""
    return level[1:] / level[:-1] - 1.0


def pairwise_mean_corr(returns: np.ndarray) -> float | None:
    """The mean of the Pearson correlations of every pair of columns; None with
    fewer than two columns or when a column does not move."""
    k = returns.shape[1]
    if k < 2:
        return None
    sd = returns.std(axis=0)
    if np.any(sd == 0):
        return None
    c = np.corrcoef(returns, rowvar=False)
    iu = np.triu_indices(k, 1)
    return float(np.mean(c[iu]))


def price_basket(histories: Mapping[str, History], weights: Mapping[str, float], method: str = DEFAULT_METHOD,
                 notional: float = DEFAULT_NOTIONAL, *, adv_sessions: int = ADV_SESSIONS) -> dict:
    """The basket priced as one index. `weights` are fractions adding to 1,
    keyed like `histories`, in the basket's order. Returns plain numbers and
    ISO dates (see the module docstring for every rule). `adv_sessions` is the
    dollar-volume window (20; a test may shorten it)."""
    w = check_weights(weights)
    if set(w) != set(histories):
        raise BasketError("the weights and the histories name different symbols")
    if not (isinstance(notional, (int, float)) and math.isfinite(notional) and notional > 0):
        raise BasketError("the notional is not a positive number")
    symbols = list(w)
    target = np.array([w[s] for s in symbols])
    start, binding, later = common_start(histories)
    dates, dropped = index_sessions(histories, start)
    px = _prices(histories, symbols, dates)
    rows = rebalance_rows(dates, method)

    # Share counts per holding period, the basket's value on every session, and contributions.
    value = np.empty(len(dates))
    contrib = np.zeros(len(symbols))
    shares = target * notional / px[0]
    bounds = rows + [len(dates) - 1]
    periods = []
    for k, r in enumerate(rows):
        if k > 0:
            shares = target * value[r] / px[r]
        end = bounds[k + 1]
        value[r:end + 1] = px[r:end + 1] @ shares
        contrib += shares * (px[end] - px[r]) / notional
        periods.append({"from": dates[r], "to": dates[end]})
    index = 100.0 * value / notional
    weight_now = shares * px[-1] / value[-1]

    # Concentration at the last close.
    order = np.argsort(-weight_now, kind="stable")
    rets = simple_returns(px)
    n_corr = min(CORR_SESSIONS, len(rets))
    corr = pairwise_mean_corr(rets[-n_corr:]) if n_corr >= CORR_MIN_SESSIONS else None
    corr_window = {"start": dates[-n_corr - 1], "end": dates[-1], "n": int(n_corr)} if n_corr >= 1 else None

    # Liquidity: each name's own last 20 sessions through the index's last session.
    legs = []
    worst: tuple[float, str] | None = None
    for j, s in enumerate(symbols):
        h = histories[s]
        upto = [i for i, d in enumerate(h.dates) if d <= dates[-1]][-adv_sessions:]
        dv = [h.dollar_volume[i] for i in upto]
        have = [v for v in dv if v is not None and math.isfinite(v) and v > 0]
        adv = float(np.mean(have)) if len(have) == adv_sessions else None
        dollars = float(target[j] * notional)
        days = dollars / (PARTICIPATION * adv) if adv else None
        if days is not None and (worst is None or days > worst[0]):
            worst = (days, s)
        legs.append({
            "symbol": s,
            "target_weight": float(target[j]),
            "weight_now": float(weight_now[j]),
            "first_close": h.dates[0],
            "price_start": float(px[0, j]),
            "price_end": float(px[-1, j]),
            "return": float(px[-1, j] / px[0, j] - 1.0),
            "contribution": float(contrib[j]),
            "shares_now": float(shares[j]),
            "dollars": dollars,
            "adv_usd": adv,
            "adv_window": {"start": h.dates[upto[0]], "end": h.dates[upto[-1]], "n": len(have)} if upto else None,
            "days_to_trade": days,
        })
    return {
        "method": method,
        "notional": float(notional),
        "start": start,
        "start_binding": binding,
        "start_is_first_close": later,
        "end": dates[-1],
        "sessions": len(dates),
        "missing_sessions": dropped,
        "rebalances": len(rows),
        "periods": periods,
        "dates": list(dates),
        "index": [float(x) for x in index],
        "total_return": float(index[-1] / 100.0 - 1.0),
        "legs": legs,
        "concentration": {
            "top3_share": float(weight_now[order[:3]].sum()),
            "top3": [symbols[i] for i in order[:3]],
            "effective_n": float(1.0 / np.sum(weight_now ** 2)),
            "avg_pairwise_corr": corr,
            "corr_window": corr_window,
        },
        "liquidity": {
            "participation": PARTICIPATION,
            "adv_sessions": adv_sessions,
            "basket_days": worst[0] if worst else None,
            "binding": worst[1] if worst else None,
        },
    }


# ── Against a benchmark (desk/books, item 3) ─────────────────────────────────
#
# Returns against a benchmark are simple returns between consecutive sessions
# on which both have a close. A window is the last n of them, complete or not
# served: 252 returns is the one-year figure, 60 the 60-day one.

WINDOWS = {"1y": 252, "60d": 60}
RS_MA = 50


def paired_returns(y: Mapping[str, float], x: Mapping[str, float]) -> tuple[list[str], np.ndarray, np.ndarray]:
    """The common dates, and the two series' returns between consecutive common
    dates (each return dated by its end; one fewer than the dates)."""
    common = sorted(set(y) & set(x))
    ly = np.array([y[d] for d in common], dtype=float)
    lx = np.array([x[d] for d in common], dtype=float)
    if len(common) < 2:
        return common, np.empty(0), np.empty(0)
    return common, ly[1:] / ly[:-1] - 1.0, lx[1:] / lx[:-1] - 1.0


def regression(y: Mapping[str, float], x: Mapping[str, float], n: int) -> dict:
    """y's daily returns against x's over the last n common returns: beta
    (cov / var of x), Pearson correlation, R², each side's annualized
    volatility (sample standard deviation × √252), and the volatility of
    `y − beta × x`, what is left after shorting beta of x per unit of y. With
    fewer than n returns every statistic is None and `reason` says how many
    there are."""
    common, ry, rx = paired_returns(y, x)
    have = len(ry)
    if have < n:
        since = common[0] if common else None
        return {"beta": None, "corr": None, "r2": None, "vol": None, "vol_x": None, "resid_vol": None,
                "vol_reduction": None, "window": {"start": since, "end": common[-1] if common else None, "n": have},
                "reason": f"needs {n} daily returns; there are {have}" + (f" since {since}" if since else "")}
    ry, rx = ry[-n:], rx[-n:]
    vx, vy = float(np.var(rx, ddof=1)), float(np.var(ry, ddof=1))
    cov = float(np.cov(ry, rx, ddof=1)[0, 1])
    ann = math.sqrt(252.0)
    if vx == 0.0 or vy == 0.0:
        return {"beta": None, "corr": None, "r2": None, "vol": math.sqrt(vy) * ann, "vol_x": math.sqrt(vx) * ann,
                "resid_vol": None, "vol_reduction": None, "window": {"start": common[-n - 1], "end": common[-1], "n": n},
                "reason": "one of the two did not move over the window"}
    beta = cov / vx
    corr = cov / math.sqrt(vx * vy)
    resid = float(np.std(ry - beta * rx, ddof=1)) * ann
    vol = math.sqrt(vy) * ann
    return {"beta": beta, "corr": corr, "r2": corr * corr, "vol": vol, "vol_x": math.sqrt(vx) * ann,
            "resid_vol": resid, "vol_reduction": 1.0 - resid / vol,
            "window": {"start": common[-n - 1], "end": common[-1], "n": n}, "reason": None}


def _rolling_mean(v: np.ndarray, w: int) -> np.ndarray:
    """The mean of the last w slots, NaN unless all w are finite (the averages' rule)."""
    out = np.full(len(v), np.nan)
    for i in range(w - 1, len(v)):
        s = v[i - w + 1:i + 1]
        if np.all(np.isfinite(s)):
            out[i] = float(s.mean())
    return out


def relative_series(sessions: Sequence[str], basket: Mapping[str, float], bench: Mapping[str, Mapping[str, float]],
                    ranges: Mapping[str, Sequence[str]]) -> dict[str, dict]:
    """For each chart range (its sessions, a tail of `sessions`): the basket and
    each benchmark rebased to 100 on the range's first session where all of
    them have a close, and basket ÷ benchmark with its 50-session average,
    both over 100 × the ratio on that session. The ratio's average reads the
    whole calendar, so it is complete from a range's first session when the
    history is long enough; a slot without both closes is a gap."""
    b = np.array([basket.get(d, np.nan) for d in sessions], dtype=float)
    xs = {k: np.array([lv.get(d, np.nan) for d in sessions], dtype=float) for k, lv in bench.items()}
    ratio = {k: b / x for k, x in xs.items()}
    ratio_ma = {k: _rolling_mean(r, RS_MA) for k, r in ratio.items()}
    at = {d: i for i, d in enumerate(sessions)}

    def f(v: float) -> float | None:
        return float(v) if math.isfinite(v) else None

    out = {}
    for name, dates in ranges.items():
        rows = [at[d] for d in dates]
        base = next((i for i in rows if math.isfinite(b[i]) and all(math.isfinite(x[i]) for x in xs.values())), None)
        pts = []
        for i in rows:
            p = {"date": sessions[i], "basket": None if base is None else f(100.0 * b[i] / b[base])}
            for k, x in xs.items():
                p[k] = None if base is None else f(100.0 * x[i] / x[base])
                p[f"rs_{k}"] = None if base is None else f(100.0 * ratio[k][i] / ratio[k][base])
                p[f"rs_{k}_ma50"] = None if base is None else f(100.0 * ratio_ma[k][i] / ratio[k][base])
            pts.append(p)
        out[name] = {"base_date": None if base is None else sessions[base], "points": pts}
    return out


# ── The ETF hedge (desk/books, item 4) ───────────────────────────────────────
#
# Each ETF is fitted to the basket by least squares on daily returns (the
# regression above): R² says how much of the basket's daily variance it
# explains, beta is the hedge ratio (dollars of ETF to short per dollar of
# basket), and the residual volatility is what is left after that short.
# The one-year window decides the rank; the 60-day one is served beside it.
# A basket too young for a year is ranked on 60 days, and says so.

STRESS_MOVE = -0.10


def hedge_rows(basket: Mapping[str, float], etfs: Mapping[str, Mapping[str, float]], notional: float) -> list[dict]:
    """One row per ETF, ranked: R² over a year first (60 days when no ETF has
    a year), then the ETF's order. Each row carries both windows' fits and
    `basis`, the window its hedge ratio, dollars and volatilities come from."""
    rows = []
    for order, (sym, levels) in enumerate(etfs.items()):
        fits = {w: regression(basket, levels, n) for w, n in WINDOWS.items()}
        basis = "1y" if fits["1y"]["beta"] is not None else "60d" if fits["60d"]["beta"] is not None else None
        head = fits[basis] if basis else None
        rows.append({
            "symbol": sym,
            "order": order,
            "basis": basis,
            "r2_1y": fits["1y"]["r2"], "r2_60d": fits["60d"]["r2"],
            "beta_1y": fits["1y"]["beta"], "beta_60d": fits["60d"]["beta"],
            "hedge_ratio": head["beta"] if head else None,
            "short_usd": head["beta"] * notional if head else None,
            "basket_vol": head["vol"] if head else None,
            "residual_vol": head["resid_vol"] if head else None,
            "vol_reduction": head["vol_reduction"] if head else None,
            "window_1y": fits["1y"]["window"], "window_60d": fits["60d"]["window"],
            "reason": None if head else fits["60d"]["reason"],
        })
    key = "r2_1y" if any(r["r2_1y"] is not None for r in rows) else "r2_60d"
    rows.sort(key=lambda r: (r[key] is None, -(r[key] or 0.0), r["order"]))
    for rank, r in enumerate(rows, 1):
        r["rank"] = rank
        r.pop("order")
    return rows


def stress(basket: Mapping[str, float], shocks: Mapping[str, Mapping[str, float]], top: str | None,
           top_levels: Mapping[str, float] | None, top_ratio: float | None, basis: str | None, notional: float,
           move: float = STRESS_MOVE) -> list[dict]:
    """The basket's P&L if a benchmark moves `move` (−10%), linear in the
    fitted betas over `basis`'s window: unhedged, notional × β(basket,
    benchmark) × move; the hedge, short `top_ratio` × notional of the top
    ETF, which moves β(ETF, benchmark) × move (exactly the move when it is
    the benchmark); hedged, the two added."""
    n = WINDOWS.get(basis or "", None)
    out = []
    for sym, levels in shocks.items():
        row = {"shock": sym, "move": move, "window": None, "basket_beta": None, "basket_move": None, "unhedged_usd": None,
               "hedge": top, "hedge_beta": None, "hedge_move": None, "hedge_usd": None, "hedged_usd": None, "hedged_move": None}
        if n is not None:
            fb = regression(basket, levels, n)
            row["window"] = fb["window"]
            if fb["beta"] is not None:
                row["basket_beta"] = fb["beta"]
                row["basket_move"] = fb["beta"] * move
                row["unhedged_usd"] = notional * fb["beta"] * move
                if top is not None and top_levels is not None and top_ratio is not None:
                    be = 1.0 if top == sym else regression(top_levels, levels, n)["beta"]
                    if be is not None:
                        row["hedge_beta"] = be
                        row["hedge_move"] = be * move
                        row["hedge_usd"] = -top_ratio * notional * be * move
                        row["hedged_usd"] = row["unhedged_usd"] + row["hedge_usd"]
                        row["hedged_move"] = row["hedged_usd"] / notional
        out.append(row)
    return out
