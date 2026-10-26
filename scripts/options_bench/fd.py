"""scripts/options_bench/fd.py — the bench's finite-difference pricer (test tooling, never served).

An independent Crank-Nicolson solver for the escrowed-dividend model the Finder's lattice uses: the stock is
S = X + PV(owed dividends), X a geometric Brownian motion with drift rho − q and volatility sigma (the residual
yield q applies to X, not to the whole stock). It shares no code with src/desk/options_math.py: only the model.

- Coordinates: x = ln X on a uniform grid centred on ln X0 (a node there), so dividends never move the grid;
  they enter only through the exercise value sgn·(X + PV_t − K).
- Time: a whole number of steps per calendar day, so each cum-dividend close is a time level. Rannacher start
  (the first two steps from expiry as four implicit half-steps), then Crank-Nicolson.
- Early exercise: the penalty method (Forsyth and Vetzal 2002), iterated to a fixed active set, warm-started
  from the previous step's set, then the projection max(V, exercise value). The penalty weight is a parameter
  so the reference can measure its effect.
- Far boundaries: zero gamma in S (V linear in S, V_xx = V_x in x), right for both deep-in and deep-out tails.
- Exercise schedule: continuous (every time level, the default) or only at the closes of given day indices
  (a Bermudan schedule, for convention studies only).
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np
from scipy.linalg import solve_banded

YEAR_DAYS = 365.0
PENALTY = 1e9
PENALTY_ITER_MAX = 50
PENALTY_STOP = 1e-13  # times max(1, S)
TIE_ULPS = 4


def pv_owed(divs: Sequence[tuple[int, float]], rho: float, t_days: float) -> float:
    """PV at t of the dividends still owed at t: a dividend whose cum close is day d is owed through t = d."""
    return sum(a * math.exp(-rho * (d - t_days) / YEAR_DAYS) for d, a in divs if d >= t_days - 1e-9)


def smoothed_payoff(is_call: bool, x: np.ndarray, dx: float, strike: float) -> np.ndarray:
    """The payoff averaged over each node's cell [x − dx/2, x + dx/2] (Pooley, Vetzal and Forsyth 2003): with
    Rannacher steps it keeps the strike's kink from making the spatial convergence oscillate."""
    h = 0.5 * dx
    lo, hi = np.exp(x - h), np.exp(x + h)
    fwd = (hi - lo) / dx - strike                      # the average of e^y − K over the cell
    lk = math.log(strike)
    part = (hi - strike - strike * (x + h - lk)) / dx   # the average of max(e^y − K, 0) when K is inside
    call = np.where(lo >= strike, fwd, np.where(hi <= strike, 0.0, part))
    call = np.maximum(call, 0.0)
    return call if is_call else np.maximum(call - fwd, 0.0)


def solve(is_call: bool, spot: float, strike: float, days: int, rho: float, q: float, sigma: float,
          divs: Sequence[tuple[int, float]], m: int, per_day: int, width: float, american: bool = True,
          exercise_days: Iterable[int] | None = None, penalty: float = PENALTY,
          diag: dict | None = None) -> tuple[float, float]:
    """(value, delta) at t = 0 on an m-interval grid of half-width `width` in ln X, `per_day` steps a day.
    delta is dV/dS with the owed dividends' PV held fixed (dS = dX), by central difference at the centre node.
    `exercise_days`: when given, exercise only at the close of these day indices (0 = today) and at expiry.
    `diag`, when given, receives the solver's counters (penalty steps that hit the iteration cap)."""
    if m % 2:
        raise ValueError("m must be even (the centre must be a node)")
    tau = days / YEAR_DAYS
    x_star = spot - pv_owed(divs, rho, 0.0)
    if x_star <= 0:
        raise ValueError("the price is at or below the owed dividends")
    x = math.log(x_star) + np.linspace(-width, width, m + 1)
    dx = x[1] - x[0]
    xs = np.exp(x)
    n_steps = per_day * days
    dt = tau / n_steps
    sgn = 1.0 if is_call else -1.0
    mu = rho - q - 0.5 * sigma * sigma
    a = 0.5 * sigma * sigma / (dx * dx)
    b = mu / (2.0 * dx)
    lo_c, di_c, up_c = a - b, -2.0 * a - rho, a + b
    n = m + 1
    scale = max(1.0, spot)
    stats = {"penalty_unconverged": 0}
    allowed = None if exercise_days is None else {int(d) for d in exercise_days}

    def exercise_value(level: float) -> np.ndarray:
        return np.maximum(sgn * (xs + pv_owed(divs, rho, level / per_day) - strike), 0.0)

    def can_exercise(level: int) -> bool:
        if not american:
            return False
        if allowed is None:
            return True
        return level % per_day == 0 and (level // per_day) in allowed

    # Tridiagonal system (I − θhL) on the interior. The two boundary rows are identities whose right-hand
    # sides extrapolate the last step's values with zero gamma in S (V_xx = V_x one node in): lagging the far
    # boundary by a step keeps the matrix an M-matrix, which the penalty iteration's convergence needs.
    def matrix(theta: float, h: float) -> np.ndarray:
        ab = np.zeros((3, n))
        ab[0, 2:] = -theta * h * up_c        # superdiagonal, rows 1..n-2
        ab[1, 1:-1] = 1.0 - theta * h * di_c  # diagonal
        ab[2, :-2] = -theta * h * lo_c       # subdiagonal
        ab[1, 0] = ab[1, -1] = 1.0
        return ab

    kb = 0.5 * dx

    def edges(v: np.ndarray, rhs: np.ndarray) -> None:
        rhs[0] = (2.0 * v[1] - (1.0 - kb) * v[2]) / (1.0 + kb)
        rhs[-1] = (2.0 * v[-2] - (1.0 + kb) * v[-3]) / (1.0 - kb)

    mats: dict[tuple[float, float], np.ndarray] = {}

    def step(v: np.ndarray, theta: float, h: float, g: np.ndarray | None, active: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        key = (theta, h)
        if key not in mats:
            mats[key] = matrix(theta, h)
        ab0 = mats[key]
        rhs = np.zeros(n)
        if theta < 1.0:
            rhs[1:-1] = v[1:-1] + (1.0 - theta) * h * (lo_c * v[:-2] + di_c * v[1:-1] + up_c * v[2:])
        else:
            rhs[1:-1] = v[1:-1]
        edges(v, rhs)
        if g is None:
            return solve_banded((1, 1), ab0, rhs, check_finite=False), active
        # start from the unconstrained solve's violations: from below, the active set only grows (Forsyth and
        # Vetzal's monotone convergence), where a warm start from the last step's set can shrink a node a pass
        free = solve_banded((1, 1), ab0, rhs, check_finite=False)
        act = free < g
        act[0] = act[-1] = False
        if not act.any():
            return free, act
        prev = free
        for _ in range(PENALTY_ITER_MAX):
            ab = ab0.copy()
            pen = np.where(act, penalty, 0.0)
            ab[1, 1:-1] += pen[1:-1]
            out = solve_banded((1, 1), ab, rhs + pen * g, check_finite=False)
            # a pinned node whose penalized value rounds to g (within TIE_ULPS) stays pinned: without this
            # tie rule a weakly active node flips in and out forever (its free value is just below g)
            new = (out < g) | (act & (out - g <= TIE_ULPS * np.spacing(np.abs(g))))
            new[0] = new[-1] = False
            # Forsyth-Vetzal stopping: the active set is fixed, or the iterate no longer moves
            if np.array_equal(new, act) or (prev is not None and np.max(np.abs(out - prev)) <= PENALTY_STOP * scale):
                break
            act, prev = new, out
        else:
            stats["penalty_unconverged"] += 1
        return out, new

    v = smoothed_payoff(is_call, x, dx, strike)  # no dividend is owed at expiry (each cum close is before it)
    active = np.zeros(n, dtype=bool)
    # Rannacher steps: the first two from expiry, and the two after each cum close (the exercise value jumps
    # there by the dividend, which kinks V the way the payoff does; Crank-Nicolson alone would ring)
    restart = {n_steps, n_steps - 1}
    if american:
        for d, _ in divs:
            restart |= {d * per_day, d * per_day - 1}
    for k in range(n_steps, 0, -1):
        if k in restart:  # two implicit half-steps
            half = k - 0.5
            g = exercise_value(half) if (american and allowed is None) else None
            v, active = step(v, 1.0, dt / 2.0, g, active)
            g = exercise_value(k - 1) if can_exercise(k - 1) else None
            v, active = step(v, 1.0, dt / 2.0, g, active)
        else:
            g = exercise_value(k - 1) if can_exercise(k - 1) else None
            v, active = step(v, 0.5, dt, g, active)
        if g is not None:
            np.maximum(v, g, out=v)
        else:
            active[:] = False
    if diag is not None:
        diag.update(stats)
    i = m // 2
    delta = (v[i + 1] - v[i - 1]) / (xs[i + 1] - xs[i - 1])
    return float(v[i]), float(delta)
