"""src/desk/options_math.py — the Options Finder's numerical library (method finder-2).

Pure functions of numbers and arrays: no I/O, no clock. numpy and scipy.special.ndtr only.
docs/desk/OPTIONS_FINDER_MODEL.md states the model; the section numbers below are its own.

One valuation context is a long call or put on a stock at price S, with strike K, n whole calendar days to
expiry, a flat continuously compounded rate rho, a residual yield q, a volatility sigma, and the dividends
still owed: (day, amount) pairs with 0 <= day < n, each day the dividend's last cum-dividend close counted
from the context's start. The stock is S* + (the owed dividends' present value), S* a geometric Brownian
motion (the escrowed-dividend model).

- European: Black-76 on S*'s forward.
- American: a binomial lattice with a step on every calendar day (so every dividend falls exactly on a
  step), Black-Scholes values on the last step, and Richardson extrapolation over N and 2N steps.
- Exempt contexts (never exercised early, by theorem) and contexts whose early-exercise premium is
  provably below a fifth of the tolerance take the European value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np
from scipy.special import ndtr

YEAR_DAYS = 365.0

# The lattice setting ("Fast"): N = k·n steps with k = max(K_MIN, ceil(N_MIN / n)).
N_MIN, K_MIN = 150, 1
# The stated tolerance of an American value, per share: max(TOL_SPOT·S, TOL_VALUE·V).
TOL_SPOT, TOL_VALUE = 1e-4, 5e-4
# The domain the lattice is validated on (model document, "Domain contract").
SIGMA_LO, SIGMA_HI = 0.001, 5.0
DAYS_MAX = 4 * 366
RHO_MAX = 0.75
Q_MAX = 1.0
# The residual yields the lattice is validated on (DR-50): beyond ±10% a year the exercise boundary's error
# converges slowly enough that near-boundary deltas miss DELTA_TOL in the near-boundary scans. Q_MAX stays the
# input sanity limit (the forward solve's); Q_DOMAIN is where lattice values are served.
Q_DOMAIN = 0.10
Q_DOMAIN_REASON = "residual yield beyond ±10% a year, where the pricer is not validated"
KS_LO, KS_HI = 0.05, 20.0
DIVS_MAX = 64
# Each dividend at most 3% of the price (DR-47): the refinement's two-resolution test is validated against
# QuantLib on this domain only; above it nearby resolutions can share an error larger than the tolerance.
DIV_FRAC_MAX = 0.03
# The 3% applies to the sum of the dividends whose cum closes fall within any DIV_WINDOW consecutive calendar
# days (DR-48): splitting a payment, or paying two close together, does not change the economics.
DIV_WINDOW = 10
PV_FRAC_MAX = 0.9
# The bound's quadrature and the exemption tests' safety margin.
EXEMPT_MARGIN = 1e-12
# Work units (model document, "Work budget"): one lattice node update is one unit (about 10 ns batched);
# the others are their measured cost in node updates.
UNITS_CLOSED_FORM = 150   # a scalar Black-76 value, or one European IV step
UNITS_BOUND_BATCH = 4500   # one batch of bound pieces (measured: ~66 us of fixed cost)
UNITS_BOUND_PIECE = 8      # one piece of the early-exercise bound (measured: ~0.1 us)


def tolerance(value: float, spot: float) -> float:
    return max(TOL_SPOT * spot, TOL_VALUE * abs(value))


# ── the rate curve (section 1) ───────────────────────────────────────────────

def zero_rate_3m(yield_pct: float) -> float:
    """A 3-month bill's bond-equivalent simple yield (percent) as a continuously compounded rate."""
    return math.log1p(yield_pct / 100.0 * 0.25) / 0.25


def zero_rate_par(yield_pct: float) -> float:
    """A semiannual par yield (percent), used as the zero rate, continuously compounded."""
    return 2.0 * math.log1p(yield_pct / 100.0 / 2.0)


@dataclass(frozen=True)
class Curve:
    """Zero rates at 0.25, 2 and 5 years; linear in time between nodes, flat outside."""

    r3m: float
    r2: float
    r5: float

    @property
    def nodes(self) -> tuple[tuple[float, float], ...]:
        return ((0.25, self.r3m), (2.0, self.r2), (5.0, self.r5))

    def rate(self, t: float) -> float:
        (t0, r0), (t1, r1), (t2, r2) = self.nodes
        if t <= t0:
            return r0
        if t <= t1:
            return r0 + (r1 - r0) * (t - t0) / (t1 - t0)
        if t <= t2:
            return r1 + (r2 - r1) * (t - t1) / (t2 - t1)
        return r2

    def df(self, t: float) -> float:
        return math.exp(-self.rate(t) * t)

    def forward(self, ta: float, tb: float) -> float:
        """The flat rate that discounts from ta to tb exactly as the curve does (tb > ta >= 0)."""
        return (self.rate(tb) * tb - self.rate(ta) * ta) / (tb - ta)

    def df_max(self, horizon: float) -> float:
        """H(T) = max over t in [0, T] of DF(t) (>= 1): the most a dollar received at a time of the holder's
        choosing up to T is worth now. r(t)·t is piecewise quadratic; its minimum over [0, T] lies at a
        segment end or a segment's vertex."""
        pts = [0.0, horizon]
        (t0, r0), (t1, r1), (t2, r2) = self.nodes
        for a, b, ra, rb in ((t0, t1, r0, r1), (t1, t2, r1, r2)):
            if a < horizon:
                pts.append(a)
            if b < horizon:
                pts.append(b)
            s = (rb - ra) / (b - a)
            if s != 0.0:
                vertex = -(ra - s * a) / (2.0 * s)  # of (ra − s·a)·t + s·t²
                if a < vertex < min(b, horizon):
                    pts.append(vertex)
        low = min(self.rate(t) * t for t in pts)
        return max(1.0, math.exp(-low))


# ── European (section 4) ─────────────────────────────────────────────────────

def black76(is_call: bool, fwd, strike, tau, sigma, df):
    """Black-76, vectorized. A strike <= 0: a call is worth the discounted forward minus the strike, a put
    nothing. tau = 0 or sigma = 0 is the discounted intrinsic value of the forward."""
    fwd, strike, tau, sigma, df = np.broadcast_arrays(*(np.asarray(x, dtype=float) for x in (fwd, strike, tau, sigma, df)))
    vol = sigma * np.sqrt(tau)
    pos = (strike > 0) & (vol > 0) & (fwd > 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        k = np.where(pos, strike, 1.0)
        f = np.where(pos, fwd, 1.0)
        v = np.where(pos, vol, 1.0)
        d1 = (np.log(f / k) + 0.5 * v * v) / v
        d2 = d1 - v
    if is_call:
        smooth = df * (f * ndtr(d1) - k * ndtr(d2))
        edge = df * np.maximum(fwd - strike, 0.0)
    else:
        smooth = df * (k * ndtr(-d2) - f * ndtr(-d1))
        edge = df * np.maximum(strike - fwd, 0.0)
    return np.where(pos, smooth, edge)


# ── one valuation context ────────────────────────────────────────────────────

@dataclass(frozen=True)
class Context:
    is_call: bool
    spot: float
    strike: float
    days: int
    rho: float
    q: float
    sigma: float
    divs: tuple[tuple[int, float], ...] = field(default=())

    @property
    def tau(self) -> float:
        return self.days / YEAR_DAYS

    def pv(self) -> float:
        return sum(a * math.exp(-self.rho * d / YEAR_DAYS) for d, a in self.divs)

    def with_sigma(self, sigma: float) -> "Context":
        return Context(self.is_call, self.spot, self.strike, self.days, self.rho, self.q, sigma, self.divs)

    def with_spot(self, spot: float) -> "Context":
        return Context(self.is_call, spot, self.strike, self.days, self.rho, self.q, self.sigma, self.divs)


def _ncdf(x: float) -> float:
    """The standard normal distribution function, accurate in both tails (erfc, not 1 − erf)."""
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def black76_scalar(is_call: bool, fwd: float, strike: float, tau: float, sigma: float, df: float) -> float:
    """black76 for one context, in plain floats (the same formula and edge rules)."""
    vol = sigma * math.sqrt(tau)
    if strike > 0 and vol > 0 and fwd > 0:
        d1 = (math.log(fwd / strike) + 0.5 * vol * vol) / vol
        d2 = d1 - vol
        if is_call:
            return df * (fwd * _ncdf(d1) - strike * _ncdf(d2))
        return df * (strike * _ncdf(-d2) - fwd * _ncdf(-d1))
    return df * max(fwd - strike, 0.0) if is_call else df * max(strike - fwd, 0.0)


def european(c: Context) -> float:
    if c.days == 0:
        return max((c.spot - c.strike) if c.is_call else (c.strike - c.spot), 0.0)
    s_star = c.spot - c.pv()
    fwd = s_star * math.exp((c.rho - c.q) * c.tau)
    return black76_scalar(c.is_call, fwd, c.strike, c.tau, c.sigma, math.exp(-c.rho * c.tau))


def european_delta(c: Context) -> float:
    s_star = c.spot - c.pv()
    vol = c.sigma * math.sqrt(c.tau)
    d1 = (math.log(s_star / c.strike) + (c.rho - c.q + 0.5 * c.sigma ** 2) * c.tau) / vol
    carry = math.exp(-c.q * c.tau)
    return carry * _ncdf(d1) if c.is_call else carry * (_ncdf(d1) - 1.0)


def exempt(c: Context) -> bool:
    """Never exercised early, by theorem (model document, "Exempt contexts"). A put: rho <= 0 and q >= 0. A
    call: rho >= 0, q <= 0, and for every owed dividend j the value at t_j of the dividends from j on is at
    most K·(1 − e^(−rho·(tau − t_j))) (with none owed: Merton). Compared with a margin on the safe side."""
    if not c.is_call:
        return c.rho <= 0.0 and c.q >= 0.0
    if c.rho < 0.0 or c.q > 0.0:
        return False
    tau = c.tau
    for dj, _ in c.divs:
        tj = dj / YEAR_DAYS
        owed = sum(a * math.exp(-c.rho * (di - dj) / YEAR_DAYS) for di, a in c.divs if di >= dj)
        room = c.strike * -math.expm1(-c.rho * (tau - tj))
        if owed > room * (1.0 - EXEMPT_MARGIN) - EXEMPT_MARGIN * c.strike:
            return False
    return True


# ── the certified early-exercise bound (rev 7, DR-45) ────────────────────────
BOUND_PIECES = 16        # initial pieces per dividend segment, uniform in sqrt(s)
BOUND_SPLIT = 8          # a refined piece becomes this many
BOUND_PASSES = 4         # refinement passes at most
BOUND_PIECES_MAX = 4096  # pieces evaluated per bound at most (all passes)
BOUND_GAP = 1e-5         # refine until upper − lower ≤ max(BOUND_GAP·S, BOUND_REL·lower) (tol/10 at the smallest tol)
BOUND_REL = 0.02
BOUND_MARGIN = 1e-12     # relative margin for floating-point rounding, on the safe side


def _mass(alpha: float, a, b):
    """∫_a^b e^(−αs) ds, exactly, for arrays a ≤ b."""
    if alpha == 0.0:
        return b - a
    return np.exp(-alpha * a) * -np.expm1(-alpha * (b - a)) / alpha


def _d_range(L_lo, L_hi, mu: float, sig: float, sa, sb):
    """inf and sup over s in [sa, sb] and L in [L_lo, L_hi] of (L + mu·s)/(sig·√s). ±inf where sa = 0."""
    ra, rb = np.sqrt(sa), np.sqrt(sb)
    with np.errstate(divide="ignore", invalid="ignore"):
        t1_hi = np.where(L_hi >= 0, np.where(ra > 0, L_hi / (sig * ra), np.inf), L_hi / (sig * rb))
        t1_lo = np.where(L_lo >= 0, L_lo / (sig * rb), np.where(ra > 0, L_lo / (sig * ra), -np.inf))
    t2_hi = (mu / sig) * (rb if mu >= 0 else ra)
    t2_lo = (mu / sig) * (ra if mu >= 0 else rb)
    return t1_lo + t2_lo, t1_hi + t2_hi


def _bound_pieces(c: Context, s_star: float, sa, sb, cs):
    """Upper and lower values of the bound's integral on each piece [sa, sb]; cs is the piece's
    Σ A·e^(−ρ·t) over the dividends owed throughout it, so PV_s = cs·e^(ρs), monotone in s."""
    sig, rho, q, k_ = c.sigma, c.rho, c.q, c.strike
    ka, kb = k_ - cs * np.exp(rho * sa), k_ - cs * np.exp(rho * sb)
    k_lo, k_hi = np.minimum(ka, kb), np.maximum(ka, kb)
    with np.errstate(divide="ignore", invalid="ignore"):
        L_hi = np.where(k_lo > 0, np.log(s_star / np.where(k_lo > 0, k_lo, 1.0)), np.inf)
        L_lo = np.where(k_hi > 0, np.log(s_star / np.where(k_hi > 0, k_hi, 1.0)), np.inf)
    mu1, mu2 = rho - q + 0.5 * sig * sig, rho - q - 0.5 * sig * sig
    d1 = _d_range(L_lo, L_hi, mu1, sig, sa, sb)
    d2 = _d_range(L_lo, L_hi, mu2, sig, sa, sb)
    up = np.zeros_like(sa)
    lo = np.zeros_like(sa)
    if c.is_call:  # N(d) is 1 where k ≤ 0
        for coef, alpha, (dl, dh) in ((max(0.0, q) * s_star, q, d1), (max(0.0, -rho) * k_, rho, d2)):
            if coef == 0.0:
                continue
            m = coef * _mass(alpha, sa, sb)
            up += m * np.where(k_lo > 0, ndtr(dh), 1.0)
            lo += m * np.where(k_hi > 0, ndtr(dl), 1.0)
    else:  # the term is 0 where k ≤ 0
        for coef, alpha, (dl, dh) in ((max(0.0, rho) * k_, rho, d2), (max(0.0, -q) * s_star, q, d1)):
            if coef == 0.0:
                continue
            m = coef * _mass(alpha, sa, sb)
            up += m * np.where(k_hi > 0, ndtr(-dl), 0.0)
            lo += m * np.where(k_lo > 0, ndtr(-dh), 0.0)
    return up, lo


def premium_bound(c: Context, charge: Callable[[int], None] | None = None, decide: float | None = None) -> float:
    """A certified upper bound on the early-exercise premium (model document, "Early-exercise bound").

    The premium is an expectation over the exercise region; each gain rate's positive part is taken and the
    region widened to S_s > K (call) or S_s < K (put), S_s = S*_s + PV_s. The time integral is bounded
    piece by piece, never approximated: on a piece [a, b] the exponential factor is integrated exactly and
    each normal probability is replaced by its largest value over the piece, from bounds on d over s in
    [a, b] and the piece's range of k_s = K − PV_s (monotone between dividend times). Pieces are refined
    where the upper and lower values differ, which only tightens the bound. `charge(pieces)` is called
    before each batch of pieces is evaluated. With `decide`, refinement also stops once the bound is at most
    `decide` or the lower value is above it: the caller only needs that comparison."""
    tau = c.tau
    s_star = c.spot - c.pv()
    rho = c.rho
    times = sorted({d / YEAR_DAYS for d, _ in c.divs})
    cuts = sorted({0.0, tau, *(t for t in times if 0.0 < t < tau)})
    fixed = 0.0
    if c.is_call:  # each dividend paid while in the region: its probability at the cum close, exact
        for d, a in c.divs:
            t = d / YEAR_DAYS
            if t >= tau:
                continue
            kt = c.strike - sum(b * math.exp(-rho * (e - d) / YEAR_DAYS) for e, b in c.divs if e >= d)
            if t == 0.0 or kt <= 0:
                p = 1.0
            else:
                vt = c.sigma * math.sqrt(t)
                p = float(ndtr((math.log(s_star / kt) + (rho - c.q + 0.5 * c.sigma ** 2) * t) / vt - vt))
            fixed += a * math.exp(-rho * t) * p
    sa_l, sb_l, cs_l = [], [], []
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        cs = sum(a * math.exp(-rho * d / YEAR_DAYS) for d, a in c.divs if d / YEAR_DAYS >= hi)
        u = np.linspace(math.sqrt(lo), math.sqrt(hi), BOUND_PIECES + 1)
        e = u * u
        e[0], e[-1] = lo, hi
        sa_l.append(e[:-1]); sb_l.append(e[1:]); cs_l.append(np.full(BOUND_PIECES, cs))
    sa, sb, cs = np.concatenate(sa_l), np.concatenate(sb_l), np.concatenate(cs_l)
    if charge:
        charge(len(sa))
    up, lo = _bound_pieces(c, s_star, sa, sb, cs)
    evaluated = len(sa)
    target = BOUND_GAP * c.spot
    for _ in range(BOUND_PASSES):
        gap = up - lo
        if gap.sum() <= max(target, BOUND_REL * (fixed + lo.sum())):
            break
        if decide is not None and (fixed + up.sum() <= decide or fixed + lo.sum() > decide):
            break
        order = np.argsort(-gap)
        cum = np.cumsum(gap[order])
        goal = max(target, BOUND_REL * (fixed + lo.sum()))
        n_split = int(np.searchsorted(cum, gap.sum() - goal)) + 1  # the fewest widest pieces to refine
        n_split = min(n_split, (BOUND_PIECES_MAX - evaluated) // BOUND_SPLIT)
        if n_split <= 0:
            break
        pick = order[:n_split]
        keep = np.ones(len(sa), bool)
        keep[pick] = False
        ua, ub = np.sqrt(sa[pick]), np.sqrt(sb[pick])
        f = np.linspace(0.0, 1.0, BOUND_SPLIT + 1)
        uu = ua[:, None] + (ub - ua)[:, None] * f[None, :]
        ee = uu * uu
        ee[:, 0], ee[:, -1] = sa[pick], sb[pick]
        na, nb = ee[:, :-1].ravel(), ee[:, 1:].ravel()
        nc = np.repeat(cs[pick], BOUND_SPLIT)
        if charge:
            charge(len(na))
        nu, nl = _bound_pieces(c, s_star, na, nb, nc)
        evaluated += len(na)
        sa, sb, cs = np.concatenate([sa[keep], na]), np.concatenate([sb[keep], nb]), np.concatenate([cs[keep], nc])
        up, lo = np.concatenate([up[keep], nu]), np.concatenate([lo[keep], nl])
    total = fixed + float(up.sum())
    return total * (1.0 + BOUND_MARGIN) + BOUND_MARGIN * c.spot


def div_cluster(divs: Sequence[tuple[int, float]]) -> float:
    """The largest sum of dividend amounts whose cum-close days lie within DIV_WINDOW consecutive days."""
    best = 0.0
    for d0, _ in divs:
        best = max(best, sum(a for d, a in divs if d0 <= d < d0 + DIV_WINDOW))
    return best


def in_domain(c: Context) -> str | None:
    """None when the lattice is validated for this context, else the reason it is not."""
    if not SIGMA_LO <= c.sigma <= SIGMA_HI:
        return "volatility outside 0.1% to 500%"
    if not 1 <= c.days <= DAYS_MAX:
        return "time to expiry outside 1 day to 4 years"
    if abs(c.rho) > RHO_MAX:
        return "rate outside ±75%"
    if abs(c.q) > Q_MAX:
        return "residual yield outside ±100%"
    ks = c.strike / c.spot
    if not KS_LO <= ks <= KS_HI:
        return "strike outside 0.05 to 20 times the price"
    if len(c.divs) > DIVS_MAX:
        return "more than 64 dividends in the contract's life"
    if div_cluster(c.divs) > DIV_FRAC_MAX * c.spot:
        return "dividends above 3% of the price within 10 days, where the pricer is not validated"
    if c.pv() > PV_FRAC_MAX * c.spot:
        return "dividends too large against the price"
    if any(not 0 <= d < c.days for d, _ in c.divs):
        return "a dividend outside the contract's life"
    if abs(c.q) > Q_DOMAIN:   # after the dividend checks: a refused dividend is the reason to name first
        return Q_DOMAIN_REASON
    return None


# ── the American lattice (section 4) ─────────────────────────────────────────

def steps_for(days: int) -> int:
    """N for a context of `days` calendar days: a whole number of steps per day."""
    return max(K_MIN, math.ceil(N_MIN / days)) * days


def lattice_units(days: int) -> int:
    n = steps_for(days)
    return n * n // 2 + (2 * n) * (2 * n) // 2


def _lattice(is_call, ks, rho, q, sig, divs: Sequence[Sequence[tuple[int, float]]], days: int, steps: int,
             with_cont: bool = False):
    """One batch of contexts sharing `days` and `steps`, in units of S = 1: strikes `ks` = K/S and dividend
    amounts already divided by S. Returns (root values, step-1 deltas, exercised at the root), values and
    deltas per unit of S, and with `with_cont` the root continuation values too (the value of holding over the
    first step, before the maximum with the exercise value). Exercised means the exercise value is at least
    the continuation value at the root.

    A step-i node j holds S* = S*_0·d^i·(u/d)^j; the exercise value there is sgn·(S* + esc_i − K), written
    a_i·(u/d)^j + b_i with per-row constants, so each step is five array passes into preallocated buffers."""
    m = len(ks)
    calls = np.asarray(is_call, dtype=bool)
    sgn = np.where(calls, 1.0, -1.0)[:, None]
    per = steps // days
    dt = (days / YEAR_DAYS) / steps
    grid = np.arange(steps + 1)
    esc = np.zeros((m, steps + 1))
    for i in range(m):
        for d, a in divs[i]:
            jx = d * per
            esc[i, : jx + 1] += a * np.exp(-rho[i] * (jx - grid[: jx + 1]) * dt)
    s_star = 1.0 - esc[:, 0]
    s = sig * math.sqrt(dt)
    nu = (rho - q - 0.5 * sig * sig) * dt
    g = np.exp((rho - q) * dt)
    up, dn = np.exp(nu + s), np.exp(nu - s)
    p = (g - dn) / (up - dn)
    disc = np.exp(-rho * dt)
    pu, pd = (disc * p)[:, None], (disc * (1.0 - p))[:, None]
    k_col = np.asarray(ks, dtype=float)[:, None]
    ratio = np.exp(np.outer(2.0 * s, np.arange(steps + 1)))       # (u/d)^j
    base = s_star[:, None] * np.exp(np.outer(nu - s, np.arange(steps + 1)))  # S*_0·d^i
    a_col = sgn * base                                               # a_i, column i
    b_col = sgn * (esc - k_col)                                      # b_i, column i
    last = steps - 1
    st = base[:, last : last + 1] * ratio[:, : last + 1]
    args = (st * g[:, None], k_col - esc[:, steps : steps + 1], dt, sig[:, None], disc[:, None])
    v = np.where(calls[:, None], black76(True, *args), black76(False, *args))
    np.maximum(v, sgn * (st + esc[:, last : last + 1] - k_col), out=v)
    buf = np.empty((m, steps))
    ex = np.empty((m, steps))
    delta = np.full(m, np.nan)
    root_ex = np.zeros(m, dtype=bool)
    for i in range(last - 1, -1, -1):
        w = i + 1
        nv = buf[:, :w]
        np.multiply(v[:, 1 : w + 1], pu, out=nv)
        e = ex[:, :w]
        np.multiply(v[:, :w], pd, out=e)
        nv += e
        np.multiply(ratio[:, :w], a_col[:, i : i + 1], out=e)
        e += b_col[:, i : i + 1]
        if i == 0:
            root_ex = e[:, 0] >= nv[:, 0]
            cont = nv[:, 0].copy()
        np.maximum(nv, e, out=nv)
        v, buf = nv, v
        if i == 1:
            s1 = base[:, 1:2] * ratio[:, :2] + esc[:, 1:2]
            delta = (v[:, 1] - v[:, 0]) / (s1[:, 1] - s1[:, 0])
    if with_cont:
        return v[:, 0].copy(), delta, root_ex, cont
    return v[:, 0].copy(), delta, root_ex


REFINE_LEVELS = 2              # lattice pairs (N, 2N), then (2N, 4N), then (4N, 8N)
REFINE_VALUE = 0.5             # a pair is accepted when |V(2M) − V(M)| ≤ REFINE_VALUE·tol(V(2M)) ...
REFINE_DELTA = 1.25e-3         # ... and |δ(2M) − δ(M)| ≤ REFINE_DELTA: half of DELTA_TOL, as REFINE_VALUE is half of tol
DELTA_TOL = 2.5e-3             # the stated accuracy of a served delta (validated, not a bound; DR-47)
DELTA_ZONE = 5.0               # no delta is served within DELTA_ZONE·tol of the exercise value (DR-50)
DELTA_DIV_DAYS = 5             # no lattice delta is served with a dividend on days 0 to DELTA_DIV_DAYS − 1 (D-1)
REFINE_UNITS_MAX = 40_000_000  # the largest single-context lattice a refinement may add
NOT_CONVERGED = "the pricer did not reach its tolerance"


def early_dividend(c: Context) -> bool:
    """A dividend on day 0 to DELTA_DIV_DAYS − 1 of the context (D-1): there the step-1 delta can miss DELTA_TOL
    while both lattices agree on it (the validation bench, two in-domain contexts at 3.03e-3 and 2.73e-3), so the
    pricer serves the value and withholds the lattice delta."""
    return any(d < DELTA_DIV_DAYS for d, _ in c.divs)


def _units(steps: int) -> int:
    return steps * steps // 2


def american(contexts: Sequence[Context], charge: Callable[[int], None] | None = None):
    """Lattice values and deltas for contexts that are all in the domain, batched by (days, steps).

    Each context is priced on lattices of N and 2N steps (N = steps_for(days)). The test is on the root
    continuation value h (holding over the first step, before the maximum with the exercise value X) and the
    step-1 delta: a pair is accepted when |h(2M) − h(M)| <= REFINE_VALUE·tol and |δ(2M) − δ(M)| <= REFINE_DELTA
    (DR-50: the root's exercise decision is taken after extrapolation, so two lattices that share a false
    decision cannot agree on it). Otherwise the next pair (2N, 4N), then (4N, 8N), while the added lattice stays
    within REFINE_UNITS_MAX. The value served is max(X, 2·h(2M) − h(M)) of the accepted pair. The delta is ±1
    when that exercises (2·h(2M) − h(M) <= X), else 2·δ(2M) − δ(M); it is NaN (none served) when
    2·h(2M) − h(M) is within DELTA_ZONE·tol of X (the decision is close), unless both lattices also exercise at
    both step-1 nodes (delta ±1 on both: the root is a whole step inside the exercise region).
    `charge(units)` is called before each batch. Returns (values, deltas, converged); a context that is not
    converged keeps its last pair's numbers and must not be served."""
    m = len(contexts)
    values = np.full(m, np.nan)
    deltas = np.full(m, np.nan)
    converged = np.zeros(m, dtype=bool)
    got: list[dict[int, tuple[float, float, bool, float]]] = [{} for _ in range(m)]

    def run(idx: list[int], mult: int) -> None:
        groups: dict[int, list[int]] = {}
        for i in idx:
            groups.setdefault(contexts[i].days, []).append(i)
        for days, gi in groups.items():
            steps = steps_for(days) * mult
            if charge:
                charge(_units(steps) * len(gi))
            cs = [contexts[i] for i in gi]
            v, d, x, h = _lattice([c.is_call for c in cs], [c.strike / c.spot for c in cs],
                                  np.array([c.rho for c in cs]), np.array([c.q for c in cs]),
                                  np.array([c.sigma for c in cs]), [[(dd, a / c.spot) for dd, a in c.divs] for c in cs],
                                  days, steps, with_cont=True)
            for k, i in enumerate(gi):
                got[i][mult] = (float(v[k]) * contexts[i].spot, float(d[k]), bool(x[k]), float(h[k]) * contexts[i].spot)

    pending = list(range(m))
    run(pending, 1)
    for level in range(REFINE_LEVELS + 1):
        lo, hi = 1 << level, 2 << level
        run([i for i in pending if hi not in got[i]], hi)
        left = []
        for i in pending:
            c = contexts[i]
            (_, d1, _, h1), (_, d2, _, h2) = got[i][lo], got[i][hi]
            sgn = 1.0 if c.is_call else -1.0
            hold = 2.0 * h2 - h1
            ex = sgn * (c.spot - c.strike)
            values[i] = max(ex, hold)
            tol = tolerance(values[i], c.spot)
            deep = abs(d1 - sgn) <= 1e-9 and abs(d2 - sgn) <= 1e-9
            deltas[i] = sgn if hold <= ex else 2.0 * d2 - d1
            if abs(hold - ex) <= DELTA_ZONE * tol and not (deep and hold <= ex):
                deltas[i] = np.nan
            ok = abs(h2 - h1) <= REFINE_VALUE * tol and abs(d2 - d1) <= REFINE_DELTA
            if ok:
                converged[i] = True
            elif level < REFINE_LEVELS and _units(steps_for(c.days) * (4 << level)) <= REFINE_UNITS_MAX:
                left.append(i)
        pending = left
        if not pending:
            break
    return values, deltas, converged


# ── implied volatility (section 4) ───────────────────────────────────────────

IV_BRACKET = (0.001, 5.0)
IV_PRICE_TOL = 1e-12
AMERICAN_IV_TOL = 1e-10


def iv_european(c: Context, price: float, max_iter: int = 100, evals: list[int] | None = None) -> float | None:
    """The sigma whose European value is `price`, by Newton with analytic vega inside a kept bracket and
    bisection when a step leaves it; None when no sigma in the bracket reproduces it. `evals`, when given,
    is a one-item counter of closed-form evaluations (the work budget's)."""
    lo, hi = IV_BRACKET
    count = evals if evals is not None else [0]
    count[0] += 2
    f_lo = european(c.with_sigma(lo)) - price
    f_hi = european(c.with_sigma(hi)) - price
    if f_lo > 0 or f_hi < 0:
        return None
    tol = IV_PRICE_TOL * max(1.0, c.spot)
    s_star = c.spot - c.pv()
    tau = c.tau
    x = 0.5 * (lo + hi) if not (lo < 0.3 < hi) else 0.3
    for _ in range(max_iter):
        count[0] += 1
        f = european(c.with_sigma(x)) - price
        if abs(f) <= tol:
            return x
        if f > 0:
            hi = x
        else:
            lo = x
        if hi - lo < 1e-12:
            return 0.5 * (lo + hi)
        vol = x * math.sqrt(tau)
        d1 = (math.log(s_star / c.strike) + (c.rho - c.q + 0.5 * x * x) * tau) / vol
        vega = s_star * math.exp(-c.q * tau) * math.sqrt(tau) * math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
        step = x - f / vega if vega > 0 else math.nan
        x = step if lo < step < hi else 0.5 * (lo + hi)
    return None


class OutOfDomain(Exception):
    """A valuation the lattice is not validated for (model document, "Domain contract")."""


def _now(v):
    """A generator that asks for nothing and returns v (so a plain function can drive a solver)."""
    return v
    yield  # pragma: no cover


def brent_gen(f, a: float, b: float, fa: float, fb: float, xtol: float, ftol: float, max_eval: int):
    """Brent's method on [a, b] with f(a)·f(b) <= 0 already evaluated; `f(x)` is a generator function whose
    `yield from` gives f's value. Stops when |f| <= ftol or the bracket is narrower than xtol; None after
    max_eval evaluations. Returns (root, evaluations)."""
    used = 0
    if fa == 0.0:
        return a, used
    if fb == 0.0:
        return b, used
    c, fc = a, fa
    d = e = b - a
    while used < max_eval:
        if fb * fc > 0:
            c, fc = a, fa
            d = e = b - a
        if abs(fc) < abs(fb):
            a, b, c = b, c, b
            fa, fb, fc = fb, fc, fb
        tol1 = 2.0 * 2.2e-16 * abs(b) + 0.5 * xtol
        xm = 0.5 * (c - b)
        if abs(xm) <= tol1 or abs(fb) <= ftol:
            return b, used
        if abs(e) >= tol1 and abs(fa) > abs(fb):
            s_ = fb / fa
            if a == c:
                p, q = 2.0 * xm * s_, 1.0 - s_
            else:
                q_, r_ = fa / fc, fb / fc
                p = s_ * (2.0 * xm * q_ * (q_ - r_) - (b - a) * (r_ - 1.0))
                q = (q_ - 1.0) * (r_ - 1.0) * (s_ - 1.0)
            if p > 0:
                q = -q
            p = abs(p)
            if 2.0 * p < min(3.0 * xm * q - abs(tol1 * q), abs(e * q)):
                e, d = d, p / q
            else:
                d = e = xm
        else:
            d = e = xm
        a, fa = b, fb
        b = b + d if abs(d) > tol1 else b + math.copysign(tol1, xm)
        fb = yield from f(b)
        used += 1
    return None, used


def run_gen(g):
    """Run a solver generator whose evaluations never yield (plain functions)."""
    try:
        next(g)
    except StopIteration as stop:
        return stop.value
    raise RuntimeError("the solver asked for a batched valuation")


def brent(f: Callable[[float], float], a: float, b: float, fa: float, fb: float, xtol: float, ftol: float,
          max_eval: int) -> tuple[float | None, int]:
    return run_gen(brent_gen(lambda x: _now(f(x)), a, b, fa, fb, xtol, ftol, max_eval))


def drive(gens: dict, value_many: Callable[[list], list]) -> dict:
    """Run many solver generators in lockstep. Each yields a list of contexts and receives their values;
    every round's requests are valued in one call to `value_many` (so lattice work is batched across
    contracts). value_many returns, per context, a float or a string (the reason it is outside the domain),
    which is thrown into that generator as OutOfDomain. Returns {key: result, or the OutOfDomain raised}."""
    results: dict = {}
    pending: dict = {}
    for k, g in gens.items():
        try:
            pending[k] = next(g)
        except StopIteration as stop:
            results[k] = stop.value
        except OutOfDomain as exc:
            results[k] = exc
    while pending:
        keys = list(pending)
        flat = [c for k in keys for c in pending[k]]
        vals = value_many(flat)
        it = iter(vals)
        nxt: dict = {}
        for k in keys:
            got = [next(it) for _ in pending[k]]
            bad = next((v for v in got if isinstance(v, str)), None)
            try:
                nxt[k] = gens[k].throw(OutOfDomain(bad)) if bad is not None else gens[k].send(got)
            except StopIteration as stop:
                results[k] = stop.value
            except OutOfDomain as exc:
                results[k] = exc
        pending = nxt
    return results


def iv_american_gen(c: Context, price: float, max_eval: int = 40, evals: list[int] | None = None):
    """The sigma whose American value is `price` (a solver generator: it yields [context] and receives
    [value], the lattice or the European formula where that is exact); value is non-decreasing in sigma.

    sigma_E inverts the European formula at the price; A(sigma_E) >= price, since A >= European. sigma_0
    inverts it at price − (A(sigma_E) − European(sigma_E)), one de-Americanize step. When A(sigma_0) < price
    the root lies in [sigma_0, sigma_E]; otherwise the lower end steps down by doubling multiples of
    sigma_E − sigma_0 until A is below the price, or to the IV bracket's low end. Brent's method then runs on
    that bracket. Stops at |A − price| <= 1e-3·tol or a bracket under 1e-10; at most max_eval valuations.
    Returns (sigma or None, valuations used)."""
    lo_lim, hi_lim = IV_BRACKET
    used = 0
    memo: dict[float, float] = {}
    ftol = 1e-3 * tolerance(price, c.spot)

    def f(x: float):
        nonlocal used
        if x not in memo:
            memo[x] = (yield [c.with_sigma(x)])[0] - price
            used += 1
        return memo[x]

    s_e = iv_european(c, price, evals=evals)
    if s_e is None:  # the European formula cannot reach the price: search the whole bracket
        lo, hi = lo_lim, hi_lim
        f_lo = yield from f(lo)
        f_hi = yield from f(hi)
    else:
        f_e = yield from f(s_e)
        if abs(f_e) <= ftol:
            return s_e, used
        s0 = iv_european(c, price - (f_e + price - european(c.with_sigma(s_e))), evals=evals)
        if s0 is None:
            s0 = lo_lim
        f0 = yield from f(s0)
        if abs(f0) <= ftol:
            return s0, used
        hi, f_hi = s_e, f_e
        lo, f_lo = s0, f0
        step = max(s_e - s0, 1e-4)
        while f_lo > 0 and lo > lo_lim and used < max_eval:
            hi, f_hi = lo, f_lo
            lo = max(lo_lim, lo - step)
            step *= 2.0
            f_lo = yield from f(lo)
    if 0 < f_lo <= ftol:  # flat in sigma down to the bracket's end: the lowest sigma that reprices it
        return lo, used
    if -ftol <= f_hi < 0:
        return hi, used
    if f_lo > 0 or f_hi < 0:
        return None, used
    root, _ = yield from brent_gen(f, lo, hi, f_lo, f_hi, 1e-10, ftol, max_eval - used)
    return root, used


def iv_american(c: Context, price: float, value: Callable[[Context], float], max_eval: int = 40,
                evals: list[int] | None = None) -> tuple[float | None, int]:
    """iv_american_gen with one context valued at a time by `value`."""
    got = drive({0: iv_american_gen(c, price, max_eval, evals)}, lambda cs: [value(x) for x in cs])[0]
    if isinstance(got, OutOfDomain):
        raise got
    return got
