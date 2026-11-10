"""src/desk/options_fd.py — the finite-difference kernel (Phase 3: the Tier 2 cross-check and Greek engine).

Moved unchanged from scripts/options_bench/fd.py (Phase 3, direction 1: one FD code); the bench re-exports it, so
the bench reference and the production cross-check run the same solver. It is never a served price. Production
guards (work charge, refusals) live in a wrapper, never in this kernel.

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
- Dividend closes: a step that ends at a cum close holds the ex-dividend exercise value (the right limit at the
  close) inside its solve, then projects the cum value at the close. Holding the cum value inside the solve rang
  at a day-0 close, where no damping step follows (seed 20261029 T1-near-boundary/1351: 14.354 to 14.356 against
  the exact 14.353056).
- Far boundaries: zero gamma in S (V linear in S, V_xx = V_x in x), right for both deep-in and deep-out tails.
- Exercise schedule: continuous (every time level, the default) or only at the closes of given day indices
  (a Bermudan schedule, for convention studies only).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
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


def pv_after(divs: Sequence[tuple[int, float]], rho: float, t_days: float) -> float:
    """PV at t of the dividends owed just after t (the right limit): at a cum close t = d, without that dividend."""
    return sum(a * math.exp(-rho * (d - t_days) / YEAR_DAYS) for d, a in divs if d > t_days + 1e-9)


def coefficients(rho: float, q: float, sigma: float, dx: float) -> tuple[float, float, float]:
    """The operator's (sub, main, super) diagonal in x = ln X: central differences for drift and diffusion.
    Both off-diagonals are nonnegative (monotone) when |rho − q − σ²/2|·dx/σ² <= 1."""
    mu = rho - q - 0.5 * sigma * sigma
    a = 0.5 * sigma * sigma / (dx * dx)
    b = mu / (2.0 * dx)
    return a - b, -2.0 * a - rho, a + b


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
          diag: dict | None = None, grids: dict | None = None) -> tuple[float, float]:
    """(value, delta) at t = 0 on an m-interval grid of half-width `width` in ln X, `per_day` steps a day.
    delta is dV/dS with the owed dividends' PV held fixed (dS = dX), by central difference at the centre node.
    `exercise_days`: when given, exercise only at the close of these day indices (0 = today) and at expiry.
    `diag`, when given, receives the solver's counters (penalty steps that hit the iteration cap).
    `grids`, when given, receives the solver's state for the Greeks (Phase 3, design section 3.3), copied, never
    recomputed, so the return value and every operation of a solve are the same with or without it:
      "x": the grid in ln X; "xs": X at each node; "v0": the solution at t = 0 (after its projection);
      "g0": the exercise value at t = 0 (cum-dividend at a close on day 0; zeros when t = 0 is not an exercise
      time: exercise off, or a Bermudan schedule without day 0);
      "free0": the solution at t = 0 before its projection max(V, exercise value): the last (half-)step's solve
      (with the penalty when the obstacle is held inside it; at a day-0 close that obstacle is ex-dividend);
      "active0": the last step's penalty active set (all False when no obstacle is held inside the solve);
      "exercise0": the nodes exercised at t = 0: free0 < g0, or pinned by the penalty (not at a day-0 close,
      where the pinned obstacle is the ex-dividend one, part of holding); all False when t = 0 is not an
      exercise time;
      "v_day1": the solution at the time level one calendar day after t = 0 (after its projection; at a cum close
      on day 1 that is the cum value), or None when days < 2 (for days = 1 that level is expiry, whose exact payoff
      the Greeks use instead of the smoothed initial data)."""
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
    lo_c, di_c, up_c = coefficients(rho, q, sigma, dx)
    n = m + 1
    scale = max(1.0, spot)
    stats = {"penalty_unconverged": 0}
    allowed = None if exercise_days is None else {int(d) for d in exercise_days}

    def exercise_value(level: float) -> np.ndarray:
        return np.maximum(sgn * (xs + pv_owed(divs, rho, level / per_day) - strike), 0.0)

    def exercise_value_after(level: float) -> np.ndarray:
        """The exercise value just after the close of `level` (ex-dividend there): the obstacle that holds inside
        a step ending at a cum close, where the dividend is owed only at the close itself."""
        return np.maximum(sgn * (xs + pv_after(divs, rho, level / per_day) - strike), 0.0)

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
    # Continuous exercise holds the obstacle inside every implicit solve (penalty). A Bermudan schedule does
    # not: the continuation value propagates freely and is projected onto the exercise value only at the
    # exercise dates, since an obstacle inside the solve would also lift neighbouring continuation values
    # (Codex OB-12)
    continuous = american and allowed is None
    # A step that ends at a cum close holds the ex-dividend obstacle inside its solve (every time in the step is
    # after the close) and takes the cum exercise value by projection at the close only, as the model defines it
    # and the lattice does. Imposing the cum value inside the solve made Crank-Nicolson ring at a day-0 close, where
    # no damping step follows (T1-near-boundary/1351; design D-2). For a call the ex-dividend obstacle is the lower
    # one, for a put the higher; no ordering is assumed.
    closes = {d * per_day for d, _ in divs} if continuous else set()
    v_day1 = pre0 = None   # written only when `grids` is given (Python-level tests, no array operation)
    for k in range(n_steps, 0, -1):
        close = (k - 1) in closes
        end = exercise_value_after if close else exercise_value
        if k in restart:  # two implicit half-steps
            g = exercise_value(k - 0.5) if continuous else None
            v, active = step(v, 1.0, dt / 2.0, g, active)
            g = end(k - 1) if continuous else None
            v, active = step(v, 1.0, dt / 2.0, g, active)
        else:
            g = end(k - 1) if continuous else None
            v, active = step(v, 0.5, dt, g, active)
        if grids is not None and k == 1:
            pre0 = v.copy()
        if close:
            g = exercise_value(k - 1)
        if g is not None:
            np.maximum(v, g, out=v)
        else:
            active[:] = False
        if not continuous and can_exercise(k - 1):
            np.maximum(v, exercise_value(k - 1), out=v)
        if grids is not None and k - 1 == per_day and days >= 2:
            v_day1 = v.copy()
    if diag is not None:
        diag.update(stats)
    i = m // 2
    delta = (v[i + 1] - v[i - 1]) / (xs[i + 1] - xs[i - 1])
    if grids is not None:
        active0 = np.asarray(active, dtype=bool).copy()
        if can_exercise(0):
            g0 = exercise_value(0)
            # at a day-0 close the penalty held the ex-dividend obstacle (exercise just after the close), which
            # is part of holding now; elsewhere a pinned node (penalty tie rule) is exercised
            exercise0 = (pre0 < g0) | (active0 if 0 not in closes else False)
        else:
            g0, exercise0 = np.zeros(n), np.zeros(n, dtype=bool)
        grids.update({"x": x.copy(), "xs": xs.copy(), "v0": v.copy(), "g0": g0, "free0": pre0,
                      "active0": active0, "exercise0": exercise0, "v_day1": v_day1})
    return float(v[i]), float(delta)


# ── the production wrapper (Phase 3, design section 3.4): guards around the kernel, never inside it ──────────

# The reference grid rule (scripts/options_bench/reference.py `grid`, restated over plain numbers so production
# never imports the bench; tests/test_options_fd.py holds the two equal on every bench group).
GRID_M_MIN, GRID_M_MAX = 1000, 6000
GRID_STEPS_MID = 1500
GRID_PECLET_MAX = 0.25
PECLET_MONOTONE = 1.0   # |drift|·dx/σ² at most 1 keeps both off-diagonals nonnegative (see coefficients)

# Refusals, each named (design section 3.4).
R_INPUT = "input failure"
R_EXPIRY = "at expiry"
R_DIVIDENDS = "price at or below the owed dividends"
R_PECLET = "grid not monotone at this volatility and drift"
R_PENALTY = "exercise iteration did not converge"
R_NONFINITE = "a non-finite value"
R_WORK = "work cap"
# options_adaptive.input_failure's words for X <= 0 (pinned by tests/test_options_fd.py), named R_DIVIDENDS here
OA_DIVIDENDS_REASON = "the price is at or below the dividends still owed"


def grid_rule(spot: float, strike: float, days: int, rho: float, q: float, sigma: float,
              pv: float) -> tuple[int, int, float]:
    """(M, p, half-width) of the reference's finest grid: M intervals, p steps a day at its middle time level.
    The half-width covers the drift's displacement plus seven standard deviations, and the strike plus five."""
    tau = days / 365.0
    sd = sigma * math.sqrt(tau)
    x0 = spot - pv
    drift = rho - q - 0.5 * sigma * sigma
    width = max(abs(drift) * tau + 7.0 * sd, abs(math.log(strike / x0)) + 5.0 * sd)
    dx = min(0.004, sd / 30.0)
    if drift:
        dx = min(dx, GRID_PECLET_MAX * sigma * sigma / abs(drift))
    m = int(min(GRID_M_MAX, max(GRID_M_MIN, 2.0 * width / dx)))
    m -= m % 16
    p = 2 * max(1, math.ceil(GRID_STEPS_MID / (2 * days)))
    return m, p, width


def peclet(rho: float, q: float, sigma: float, m: int, width: float) -> float:
    """|drift|·dx/σ² on a grid of m intervals over ±width: convection against diffusion, per cell."""
    return abs(rho - q - 0.5 * sigma * sigma) * (2.0 * width / m) / (sigma * sigma)


def solve_units(m: int, per_day: int, days: int) -> int:
    """The work of one solve, (m + 1)·(time steps), in the Tier 2 work units (one node update each)."""
    return (m + 1) * per_day * days


class Budget:
    """A per-context work cap, charged before each solve runs (precharged: a solve that would pass the cap is
    refused without running)."""

    def __init__(self, cap: int):
        self.cap = int(cap)
        self.used = 0

    def take(self, units: int) -> bool:
        if self.used + units > self.cap:
            return False
        self.used += units
        return True


@dataclass(frozen=True)
class Level:
    """A production level: m intervals over ±width, per_day steps a day. L1 = (m, p), L2 = (2m, 2p)."""
    m: int
    per_day: int
    width: float


@dataclass(frozen=True)
class FDConfig:
    """The production grid as fractions of the reference grid (calibrated on dev, then frozen) and the
    per-context work cap. The defaults here are placeholders until the freeze; tests pass their own."""
    m_frac: float
    p_frac: float
    work_cap: int
    penalty: float = PENALTY

    def __post_init__(self) -> None:
        if not (0.0 < self.m_frac <= 1.0 and 0.0 < self.p_frac <= 1.0):
            raise ValueError("the production grid is a fraction of the reference grid, in (0, 1]")
        if self.work_cap <= 0:
            raise ValueError("the work cap must be positive")


def levels(c, cfg: FDConfig) -> tuple[Level, Level]:
    """L1 and L2 for context `c` (an options_math.Context): the reference rule scaled by the frozen fractions.
    m is a multiple of 4, so the centre is a node at both levels and in every half-grid stencil."""
    m_ref, p_ref, width = grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma, pv_owed(c.divs, c.rho, 0.0))
    m = max(16, int(round(m_ref * cfg.m_frac)))
    m -= m % 4
    p = max(1, int(round(p_ref * cfg.p_frac)))
    return Level(m, p, width), Level(2 * m, 2 * p, width)


@dataclass(frozen=True)
class Solved:
    value: float
    delta: float
    level: Level
    units: int
    grids: dict = field(repr=False, compare=False)


@dataclass(frozen=True)
class Refused:
    reason: str
    detail: str = ""


def price(c, level: Level, budget: Budget, penalty: float = PENALTY, american: bool = True) -> Solved | Refused:
    """One production solve of context `c` (an options_math.Context) at `level`, with every guard of design
    section 3.4: the inputs and the engine's domain, an expiry, the owed dividends, the grid's monotonicity, the
    work cap (charged before the solve), the penalty iteration and every number's finiteness. Never raises for a
    refusable state; the kernel itself is unchanged."""
    from src.desk import options_adaptive as oa   # read only: the input test and the domain test are Tier 2's own
    from src.desk import options_math as om
    bad = oa.input_failure(c)
    if bad == OA_DIVIDENDS_REASON:
        return Refused(R_DIVIDENDS, bad)
    if bad is not None:
        return Refused(R_INPUT, bad)
    if c.days == 0:
        return Refused(R_EXPIRY)
    why = om.in_domain(c)
    if why is not None:
        return Refused(R_INPUT, why)
    if c.spot - pv_owed(c.divs, c.rho, 0.0) <= 0.0:
        return Refused(R_DIVIDENDS)
    if peclet(c.rho, c.q, c.sigma, level.m, level.width) > PECLET_MONOTONE:
        return Refused(R_PECLET)
    units = solve_units(level.m, level.per_day, c.days)
    if not budget.take(units):
        return Refused(R_WORK, f"{units} units with {budget.used} of {budget.cap} used")
    diag: dict = {}
    grids: dict = {}
    try:
        with np.errstate(all="ignore"):
            v, d = solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, c.divs, level.m, level.per_day,
                         level.width, american=american, penalty=penalty, diag=diag, grids=grids)
    except (ValueError, OverflowError, ZeroDivisionError, FloatingPointError) as e:
        return Refused(R_NONFINITE, str(e)[:200])
    if diag.get("penalty_unconverged", 0):
        return Refused(R_PENALTY, f"{diag['penalty_unconverged']} steps at the iteration cap")
    arrays = [grids[k] for k in ("v0", "free0", "g0")] + ([grids["v_day1"]] if grids["v_day1"] is not None else [])
    if not (math.isfinite(v) and math.isfinite(d) and all(np.all(np.isfinite(a)) for a in arrays)):
        return Refused(R_NONFINITE)
    return Solved(v, d, level, units, grids)
