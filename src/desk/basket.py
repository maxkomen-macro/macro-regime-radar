"""src/desk/basket.py — a basket of stocks priced as one index (desk/books).

Pure: every function takes price histories and returns numbers. Nothing here
fetches, reads the database or keeps state; api/desk_basket.py fetches the
histories (api/providers/market.daily_bars) and serves what these return.

The method, in the order the page states it:

- **The index.** Base 100 on the first calendar session on which every name
  has a close (`start`, the session the share counts are bought at, R-03),
  and defined on every later session on which every name has a close. A
  session on which one name has no close is not an index session (counted in
  `missing_sessions`); nothing is filled in.
- **Buy-and-hold** (`hold`, the default): the target weights become share
  counts at the start's closes, `shares_i = w_i × notional / P_i(start)`, and
  the counts never change, so each name's weight drifts with its price.
- **Monthly rebalance** (`monthly`): the same at the start, then at the close
  of each completed month (its last XNYS session by the calendar, the final
  observation included when it is one; R-06), at the basket's last index
  session that month, the counts are reset so each name is back at its target
  weight of the basket's value that day.
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

Prices are split- and dividend-adjusted closes on the XNYS session calendar
(passed in: `sessions`). A daily return is a simple return between two
consecutive calendar sessions that both have a close; a missing session is a
missing return, never one spanning two sessions (Codex R-02).
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


def on_calendar(levels: Mapping[str, float], sessions: Sequence[str]) -> np.ndarray:
    """A level series on the session calendar: NaN on a session it has no value for."""
    return np.array([levels.get(d, np.nan) for d in sessions], dtype=float)


def session_returns(level: np.ndarray) -> np.ndarray:
    """One-session simple returns on the calendar (Codex R-02): row t is
    P_t / P_{t-1} - 1 and NaN unless both sessions have a value, so a gap is
    missing, never a return spanning two sessions; row 0 is NaN."""
    level = np.asarray(level, dtype=float)
    out = np.full(len(level), np.nan)
    if len(level) > 1:
        with np.errstate(invalid="ignore", divide="ignore"):
            out[1:] = level[1:] / level[:-1] - 1.0
    return out


def month_end_sessions(sessions: Sequence[str]) -> set[str]:
    """Each calendar month's last session, for the months the calendar shows
    complete: a session in a later month follows it (Codex R-06)."""
    return {a for a, b in zip(sessions, sessions[1:]) if a[:7] != b[:7]}


def _check_calendar(sessions: Sequence[str]) -> list[str]:
    cal = list(sessions)
    if not cal or any(b <= a for a, b in zip(cal, cal[1:])):
        raise BasketError("the session calendar is empty or not strictly ascending")
    return cal


def _on_calendar_matrix(histories: Mapping[str, History], symbols: Sequence[str], cal: Sequence[str]) -> tuple[np.ndarray, dict[str, int]]:
    """A (sessions × names) matrix of adjusted closes on the calendar, NaN where
    a name has no close, and each name's count of dates that are not sessions
    (left out)."""
    pos = {d: i for i, d in enumerate(cal)}
    px = np.full((len(cal), len(symbols)), np.nan)
    off: dict[str, int] = {}
    for j, s in enumerate(symbols):
        h = histories[s]
        if not h.dates:
            raise BasketError(f"no daily history for {s}")
        for d, c in zip(h.dates, h.close):
            i = pos.get(d)
            if i is None:
                off[s] = off.get(s, 0) + 1
            else:
                px[i, j] = c
    return px, off


def rebalance_rows(cal: Sequence[str], index_rows: Sequence[int], method: str) -> list[int]:
    """Calendar rows where the share counts are set: the start, and for the
    monthly method each completed month's month-end (its last XNYS session by
    the calendar), at the basket's last index session in that month; the
    final observation is one when it is the month's last session (Codex R-06)."""
    if method not in METHODS:
        raise BasketError(f"the method {method!r} is not one of {', '.join(METHODS)}")
    rows = [int(index_rows[0])]
    if method == "monthly":
        last = int(index_rows[-1])
        ends = {d[:7]: d for d in month_end_sessions(cal)}
        by_month: dict[str, int] = {}
        for r in index_rows:
            by_month[cal[r][:7]] = int(r)  # the month's last index session
        for month, r in sorted(by_month.items(), key=lambda kv: kv[1]):
            d = ends.get(month)
            if d is not None and d <= cal[last] and r > rows[0]:
                rows.append(r)
    return rows


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
                 notional: float = DEFAULT_NOTIONAL, *, sessions: Sequence[str], adv_sessions: int = ADV_SESSIONS) -> dict:
    """The basket priced as one index. `weights` are fractions adding to 1,
    keyed like `histories`, in the basket's order; `sessions` is the XNYS
    calendar over the histories, running at least one session into the month
    after the last close (so a month-end is known). Returns plain numbers and
    ISO dates (see the module docstring for every rule). `adv_sessions` is the
    dollar-volume window (20; a test may shorten it)."""
    w = check_weights(weights)
    if set(w) != set(histories):
        raise BasketError("the weights and the histories name different symbols")
    if not (isinstance(notional, (int, float)) and math.isfinite(notional) and notional > 0):
        raise BasketError("the notional is not a positive number")
    cal = _check_calendar(sessions)
    symbols = list(w)
    target = np.array([w[s] for s in symbols])
    px, off = _on_calendar_matrix(histories, symbols, cal)
    present = np.all(np.isfinite(px), axis=1)
    idx = np.flatnonzero(present)
    if not len(idx):
        raise BasketError("the names share no session")
    i0, i_end = int(idx[0]), int(idx[-1])

    # The start is the first session every name has a close, the one the share counts are bought at
    # (Codex R-03), and why it is there.
    firsts = {s: cal[int(np.flatnonzero(np.isfinite(px[:, j]))[0])] for j, s in enumerate(symbols) if np.isfinite(px[:, j]).any()}
    start = cal[i0]
    latest_first = max(firsts.values())
    gap_session = None
    if start == latest_first:
        kind = "first_close" if latest_first > min(firsts.values()) else "history"
        binding = sorted(s for s, d in firsts.items() if d == start)
    else:
        kind = "gap"
        gap_session = cal[i0 - 1]
        binding = sorted(s for j, s in enumerate(symbols) if not np.isfinite(px[i0 - 1, j]))
    missing = [cal[i] for i in range(i0, i_end + 1) if not present[i]]
    rows = rebalance_rows(cal, idx, method)

    # Share counts per holding period, the basket's value on every index session, and contributions.
    value = np.full(len(cal), np.nan)
    contrib = np.zeros(len(symbols))
    shares = target * notional / px[i0]
    periods = []
    for k, r in enumerate(rows):
        if k > 0:
            shares = target * value[r] / px[r]
        seg_end = rows[k + 1] if k + 1 < len(rows) else i_end
        seg = idx[(idx >= r) & (idx <= seg_end)]
        value[seg] = px[seg] @ shares
        contrib += shares * (px[seg_end] - px[r]) / notional
        if seg_end > r:
            periods.append({"from": cal[r], "to": cal[seg_end]})
    weight_now = shares * px[i_end] / value[i_end]
    dates = [cal[i] for i in idx]
    index = 100.0 * value[idx] / notional

    # Concentration at the last close; the correlation reads one-session returns every name has (R-02).
    order = np.argsort(-weight_now, kind="stable")
    rets = np.column_stack([session_returns(px[:, j]) for j in range(len(symbols))])
    ok = np.flatnonzero(np.all(np.isfinite(rets), axis=1) & (np.arange(len(cal)) <= i_end))
    n_corr = min(CORR_SESSIONS, len(ok))
    use = ok[-n_corr:] if n_corr else ok[:0]
    corr = pairwise_mean_corr(rets[use]) if n_corr >= CORR_MIN_SESSIONS else None
    corr_window = {"start": cal[int(use[0]) - 1], "end": cal[int(use[-1])], "n": int(n_corr)} if n_corr >= 1 else None

    # Liquidity: each name's own last 20 sessions through the index's last session.
    legs = []
    worst: tuple[float, str] | None = None
    for j, s in enumerate(symbols):
        h = histories[s]
        upto = [i for i, d in enumerate(h.dates) if d <= cal[i_end]][-adv_sessions:]
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
            "first_close": firsts[s],
            "price_start": float(px[i0, j]),
            "price_end": float(px[i_end, j]),
            "return": float(px[i_end, j] / px[i0, j] - 1.0),
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
        "start_kind": kind,
        "start_binding": binding,
        "start_is_first_close": kind == "first_close",
        "start_gap_session": gap_session,
        "end": cal[i_end],
        "sessions": len(dates),
        "missing_sessions": missing,
        "off_session": off,
        "rebalances": len(rows),
        "periods": periods,
        "dates": dates,
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


def paired_returns(y: Mapping[str, float], x: Mapping[str, float], sessions: Sequence[str],
                   cutoff: str | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The calendar rows where both series have a one-session return (Codex
    R-02: each series' returns are taken on the XNYS calendar first, a gap
    staying missing), and those returns. Rows after `cutoff` are left out."""
    ry = session_returns(on_calendar(y, sessions))
    rx = session_returns(on_calendar(x, sessions))
    ok = np.isfinite(ry) & np.isfinite(rx)
    if cutoff is not None:
        ok &= np.array([d <= cutoff for d in sessions])
    rows = np.flatnonzero(ok)
    return rows, ry[rows], rx[rows]


def regression(y: Mapping[str, float], x: Mapping[str, float], n: int, sessions: Sequence[str],
               cutoff: str | None = None) -> dict:
    """y's one-session returns against x's over the last n calendar sessions
    both have a return for: beta (cov / var of x), Pearson correlation, R²,
    each side's annualized volatility (sample standard deviation × √252), and
    the volatility of `y − beta × x`, what is left after shorting beta of x per
    unit of y. With fewer than n such returns every statistic is None and
    `reason` says how many there are. The window runs from the session before
    its first return to its last."""
    cal = list(sessions)
    rows, ry, rx = paired_returns(y, x, cal, cutoff)
    have = len(rows)
    if have < n:
        since = cal[int(rows[0]) - 1] if have else None
        return {"beta": None, "corr": None, "r2": None, "vol": None, "vol_x": None, "resid_vol": None,
                "vol_reduction": None, "window": {"start": since, "end": cal[int(rows[-1])] if have else None, "n": have},
                "reason": f"needs {n} daily returns; there are {have}" + (f" since {since}" if since else "")}
    rows, ry, rx = rows[-n:], ry[-n:], rx[-n:]
    window = {"start": cal[int(rows[0]) - 1], "end": cal[int(rows[-1])], "n": n}
    vx, vy = float(np.var(rx, ddof=1)), float(np.var(ry, ddof=1))
    cov = float(np.cov(ry, rx, ddof=1)[0, 1])
    ann = math.sqrt(252.0)
    if vx == 0.0 or vy == 0.0:
        return {"beta": None, "corr": None, "r2": None, "vol": math.sqrt(vy) * ann, "vol_x": math.sqrt(vx) * ann,
                "resid_vol": None, "vol_reduction": None, "window": window,
                "reason": "one of the two did not move over the window"}
    beta = cov / vx
    corr = cov / math.sqrt(vx * vy)
    resid = float(np.std(ry - beta * rx, ddof=1)) * ann
    vol = math.sqrt(vy) * ann
    return {"beta": beta, "corr": corr, "r2": corr * corr, "vol": vol, "vol_x": math.sqrt(vx) * ann,
            "resid_vol": resid, "vol_reduction": 1.0 - resid / vol, "window": window, "reason": None}


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


def hedge_rows(basket: Mapping[str, float], etfs: Mapping[str, Mapping[str, float]], notional: float,
               sessions: Sequence[str]) -> list[dict]:
    """One row per ETF, ranked: R² over a year first (60 days when no ETF has
    a year), then the ETF's order. Each row carries both windows' fits and
    `basis`, the window its hedge ratio, dollars and volatilities come from."""
    rows = []
    for order, (sym, levels) in enumerate(etfs.items()):
        fits = {w: regression(basket, levels, n, sessions) for w, n in WINDOWS.items()}
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
           sessions: Sequence[str], move: float = STRESS_MOVE) -> list[dict]:
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
            fb = regression(basket, levels, n, sessions)
            row["window"] = fb["window"]
            if fb["beta"] is not None:
                row["basket_beta"] = fb["beta"]
                row["basket_move"] = fb["beta"] * move
                row["unhedged_usd"] = notional * fb["beta"] * move
                if top is not None and top_levels is not None and top_ratio is not None:
                    be = 1.0 if top == sym else regression(top_levels, levels, n, sessions)["beta"]
                    if be is not None:
                        row["hedge_beta"] = be
                        row["hedge_move"] = be * move
                        row["hedge_usd"] = -top_ratio * notional * be * move
                        row["hedged_usd"] = row["unhedged_usd"] + row["hedge_usd"]
                        row["hedged_move"] = row["hedged_usd"] / notional
        out.append(row)
    return out
