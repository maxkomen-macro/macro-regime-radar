"""scripts/options_bench/phase4a/rootfinding.py — Tier 2-aware copies of the Finder's solvers (bench only).

docs/desk/OPTIONS_PHASE4A.md, section 3. Installed by bench.patched() only in configurations C and D, in place of
options_math.iv_american_gen, options_finder.pair_forward_gen, options_finder._breakeven_gen and
options_finder.implied_vols (the last differs from the Finder's in one call: its exempt branch, rule 3.1.7), for the
length of one run in the bench's process. They receive values as floats from Pricer.values(), as the Finder's
solvers do, and read each evaluated context's stated error from the bench's SitePricer (the uncertainty transport).
Every exit is logged to the pricer's `rf` list. At a Tier 1 site the originals run.

The stated input errors are local, first-order approximations from empirical value errors; never bounds.
"""

from __future__ import annotations

import ast
import inspect
import math
import textwrap

from src.desk import options_engine as oe
from src.desk import options_finder as of
from src.desk import options_math as om

from . import bench

IV_FLOOR = om.IV_BRACKET[0]
IV_TOO_UNCERTAIN_ABS, IV_TOO_UNCERTAIN_REL = 0.01, 0.10
BE_TOO_UNCERTAIN_REL = 0.01
RHO_MAX = 0.5          # a secant whose noise ratio reaches this is unusable
PROBE_K = 8.0          # h_target = PROBE_K·E/|s0|: rho ≈ 0.25 when s0 is right
NO_ERROR = "Tier 2 stated no error"
NO_SLOPE = "slope not resolved within Tier 2's error"
NO_ROOM = "no room for a slope probe in the validated range"
AT_CAP = "uncertainty unresolved at the evaluation cap"   # the reserve makes this unreachable; asserted

ORIGINAL = {"iv_american_gen": om.iv_american_gen, "pair_forward_gen": of.pair_forward_gen,
            "_breakeven_gen": of._breakeven_gen, "implied_vols": of.implied_vols}
assert not any(hasattr(fn, "__wrapped_site__") or hasattr(fn, "__wrapped__") for fn in ORIGINAL.values()), \
    "rootfinding imported while the bench's patches were installed"


def _pricer():
    return bench._CURRENT[-1]


def _tier2_here() -> bool:
    p = _pricer()
    return p.site in p.tier2_sites


def err_of(ctx: om.Context) -> float | None:
    """Tier 2's stated error for a context it valued: 0 for the exact routes (and the intrinsic triage at expiry),
    None when it stated none (missing, negative or not finite), else the estimate."""
    p = _pricer()
    a = p.t2_answer.get(ctx)
    if a is None:
        v = p.t2_memo.get(ctx)
        return 0.0 if isinstance(v, of.Valued) and v.model == of.MODEL_INTRINSIC else None
    if a.price_status == oe.EXACT:
        return 0.0
    e = a.estimate
    return float(e) if e is not None and math.isfinite(e) and e >= 0 else None


def _log(**kw) -> None:
    _pricer().rf.append(kw)


class Refused(Exception):
    """A Tier 2 solve refused by a rule of section 3 (the reason is logged and reported)."""


def secant(f1: float, f2: float, x1: float, x2: float, e1: float, e2: float, sign: int):
    """The common rules' usable secant: (conservative slope, rho), or None. sign is +1 or -1 when monotonicity
    requires that sign, 0 when any sign is allowed."""
    if x1 == x2 or not (math.isfinite(f1) and math.isfinite(f2)):
        return None
    sec = (f2 - f1) / (x2 - x1)
    if not math.isfinite(sec) or (sign and sec * sign <= 0):
        return None
    d = abs(f2 - f1)
    rho = (e1 + e2) / d if d > 0 else math.inf
    if rho >= RHO_MAX:
        return None
    return abs(sec) * (1.0 - rho), rho


def slope_gen(f, E, xhat, candidate, lo, hi, s0, hmin, hmax, sign, ctx_at, left: int):
    """The common slope rule (section 3): the candidate secant if usable, else one probe inside [lo, hi] and the
    pricing domain, toward the side with more room. Returns (slope, rho, probe point or None)."""
    e_hat = E(xhat)
    if e_hat is None:
        raise Refused(NO_ERROR)
    if candidate is not None:
        x1, x2 = candidate
        f1, f2 = (yield from f(x1)), (yield from f(x2))
        e1, e2 = E(x1), E(x2)
        if e1 is None or e2 is None:
            raise Refused(NO_ERROR)
        got = secant(f1, f2, x1, x2, e1, e2, sign)
        if got is not None:
            return got[0], got[1], None
    if left < 1:
        raise Refused(AT_CAP)
    h_target = PROBE_K * e_hat / abs(s0) if (s0 and math.isfinite(s0)) else hmax
    sides = sorted(((hi - xhat, 1.0), (xhat - lo, -1.0)), reverse=True)
    for room, d in sides:
        h = min(max(h_target, hmin), hmax, room)
        if h <= 0:
            continue
        xp = xhat + d * h
        if not lo <= xp <= hi or om.in_domain(ctx_at(xp)) is not None:
            continue
        fp = yield from f(xp)
        fh = yield from f(xhat)
        ep = E(xp)
        if ep is None:
            raise Refused(NO_ERROR)
        got = secant(fh, fp, xhat, xp, e_hat, ep, sign)
        if got is None:
            raise Refused(NO_SLOPE)
        return got[0], got[1], xp
    raise Refused(NO_ROOM)


def brent_noise_gen(f, a, b, fa, fb, xtol, ftol, max_eval, noise):
    """om.brent_gen with one more stop: noise(b, fb, c, fc) is true when the current bracket [b, c] can no longer be
    resolved within Tier 2's stated errors. Returns (best, contrapoint, evaluations, exit); best None at the cap."""
    used = 0
    if fa == 0.0:
        return a, b, used, "value"
    if fb == 0.0:
        return b, a, used, "value"
    c, fc = a, fa
    d = e = b - a
    while True:
        if fb * fc > 0:
            c, fc = a, fa
            d = e = b - a
        if abs(fc) < abs(fb):
            a, b, c = b, c, b
            fa, fb, fc = fb, fc, fb
        tol1 = 2.0 * 2.2e-16 * abs(b) + 0.5 * xtol
        xm = 0.5 * (c - b)
        if abs(fb) <= ftol:
            return b, c, used, "value"
        if abs(xm) <= tol1:
            return b, c, used, "bracket"
        if noise(b, fb, c, fc):
            return b, c, used, "tier2 noise"
        if used >= max_eval:
            return None, None, used, "cap"
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


def _noise_rule(E):
    def noise(b, fb, c, fc):
        if c == b:
            return False
        eb, ec = E(b), E(c)
        return eb is not None and ec is not None and abs(fc - fb) <= eb + ec
    return noise


def _vega_eu(c: om.Context) -> float:
    s_star = c.spot - c.pv()
    tau = c.tau
    vol = c.sigma * math.sqrt(tau)
    d1 = (math.log(s_star / c.strike) + (c.rho - c.q + 0.5 * c.sigma * c.sigma) * tau) / vol
    return s_star * math.exp(-c.q * tau) * math.sqrt(tau) * math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)


# ── 3.1 implied volatility ──

def iv_american_gen(c: om.Context, price: float, max_eval: int = 40, evals: list[int] | None = None):
    if not _tier2_here():
        return (yield from ORIGINAL["iv_american_gen"](c, price, max_eval, evals))
    lo_lim, hi_lim = om.IV_BRACKET
    search_cap = max_eval - 1        # one evaluation reserved for the slope probe (DR-10)
    used = 0
    memo: dict[float, float] = {}
    order: list[float] = []
    ftol = 1e-3 * om.tolerance(price, c.spot)
    rec = {"site": "iv", "strike": c.strike, "days": c.days, "call": c.is_call, "spot": c.spot}

    def f(x: float):
        nonlocal used
        if x not in memo:
            memo[x] = (yield [c.with_sigma(x)])[0] - price
            used += 1
            order.append(x)
        return memo[x]

    def E(x: float):
        return err_of(c.with_sigma(x))

    def refuse(reason: str, **kw):
        _log(**rec, exit="refused", reason=reason, evals=used, **kw)
        return None, used

    # 1. identifiability at the global floor, before any search (one valuation, in the cap)
    f_min = yield from f(lo_lim)
    e_min = E(lo_lim)
    if e_min is None:
        return refuse(NO_ERROR)
    if -f_min <= e_min:
        return refuse("IV not identifiable within Tier 2's stated error")

    # 2. the Finder's bracketing and search, inside the search cap
    s_e = om.iv_european(c, price, evals=evals)
    first = None
    if s_e is None:
        lo, hi = lo_lim, hi_lim
        f_lo = f_min
        f_hi = yield from f(hi)
    else:
        f_e = yield from f(s_e)
        if abs(f_e) <= ftol:
            first = s_e
        else:
            s0 = om.iv_european(c, price - (f_e + price - om.european(c.with_sigma(s_e))), evals=evals)
            if s0 is None:
                s0 = lo_lim
            f0 = yield from f(s0)
            if abs(f0) <= ftol:
                first = s0
            else:
                hi, f_hi = s_e, f_e
                lo, f_lo = s0, f0
                step = max(s_e - s0, 1e-4)
                while f_lo > 0 and lo > lo_lim and used < search_cap:
                    hi, f_hi = lo, f_lo
                    lo = max(lo_lim, lo - step)
                    step *= 2.0
                    f_lo = yield from f(lo)
    if first is not None:
        best, exit_ = first, "value"
        candidate = (order[-2], order[-1]) if len(order) >= 2 else None
    else:
        if 0 < f_lo <= ftol:
            best, exit_, candidate = lo, "value (flat to the bracket end)", (lo, hi)
        elif -ftol <= f_hi < 0:
            best, exit_, candidate = hi, "value", (lo, hi)
        elif f_lo > 0 or f_hi < 0:
            return refuse("no sign change in the bracket")
        else:
            best, other, _, exit_ = yield from brent_noise_gen(f, lo, hi, f_lo, f_hi, 1e-10, ftol,
                                                               search_cap - used, _noise_rule(E))
            if best is None:
                return refuse("no convergence")
            candidate = (best, other) if other is not None and other != best else None
            if candidate is not None:   # 3. monotonicity, beyond the stated errors
                a, b = sorted(candidate)
                ea, eb = E(a), E(b)
                if ea is None or eb is None:
                    return refuse(NO_ERROR)
                if memo[b] - memo[a] < -(ea + eb):
                    return refuse("not identifiable: values decrease in volatility beyond Tier 2's stated errors")
    try:
        s, rho, probe = yield from slope_gen(
            f, E, best, candidate, lo_lim, hi_lim, _vega_eu(c.with_sigma(best)),
            max(1e-3, 0.01 * best), 0.25 * best, +1, c.with_sigma, max_eval - used)
    except Refused as r:
        return refuse(str(r), sigma=best)
    d_sigma = (E(best) + abs(memo[best])) / s   # 4. local approximation, not a bound
    out = dict(sigma=best, d_sigma=d_sigma, rho=rho, probed=probe is not None)
    if d_sigma > max(IV_TOO_UNCERTAIN_ABS, IV_TOO_UNCERTAIN_REL * best):   # 5.
        return refuse("IV too uncertain", **out)
    assert used <= max_eval
    _log(**rec, exit=exit_, reason=None, evals=used, **out)
    return best, used


def iv_exempt(c0: om.Context, price: float, evals: list[int] | None = None):
    """Rule 3.1.7: an exempt quote at a Tier 2 iv site. Returns the sigma, None (refused, "bad_iv") or
    "unpriceable" (outside Tier 2's domain, or Tier 2 disagrees with the exempt route)."""
    if not _tier2_here():
        return om.iv_european(c0, price, evals=evals)
    rec = {"site": "iv", "strike": c0.strike, "days": c0.days, "call": c0.is_call, "spot": c0.spot, "exempt": True}
    why = om.in_domain(c0.with_sigma(IV_FLOOR))
    if why is not None:
        _log(**rec, exit="refused", reason=f"outside Tier 2's domain: {why}")
        return "unpriceable"
    if evals is not None:
        evals[0] += 1
    if price <= om.european(c0.with_sigma(IV_FLOOR)):
        _log(**rec, exit="refused", reason="IV not identifiable")
        return None
    sg = om.iv_european(c0, price, evals=evals)
    if sg is None:
        _log(**rec, exit="refused", reason="no European volatility reprices the quote")
        return None
    cs = c0.with_sigma(sg)
    p = _pricer()
    got = p.many([cs])[0]
    a = p.t2_answer.get(cs)
    eu = om.european(cs)
    if (isinstance(got, str) or a is None or a.route != oe.ROUTE_EXEMPT or a.price_status != oe.EXACT
            or got.value != eu):
        _log(**rec, exit="refused", reason="Tier 2 disagrees with the exempt route")
        return "unpriceable"
    d_sigma = abs(eu - price) / _vega_eu(cs)
    if d_sigma > max(IV_TOO_UNCERTAIN_ABS, IV_TOO_UNCERTAIN_REL * sg):
        _log(**rec, exit="refused", reason="IV too uncertain", sigma=sg, d_sigma=d_sigma)
        return None
    _log(**rec, exit="value", reason=None, evals=1, sigma=sg, d_sigma=d_sigma, rho=0.0, probed=False)
    return sg


def _implied_vols_copy():
    """options_finder.implied_vols with its exempt branch's om.iv_european call replaced by iv_exempt (one call
    node; tests compare the parse trees)."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(ORIGINAL["implied_vols"])))
    hits = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "iv_european"
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "om"):
            hits.append(node)
    assert len(hits) == 1, "implied_vols changed: the bench's copy needs review"
    hits[0].func = ast.copy_location(ast.Name(id="_bench_iv_exempt", ctx=ast.Load()), hits[0].func)
    ast.fix_missing_locations(tree)
    ns = dict(vars(of))
    ns["_bench_iv_exempt"] = iv_exempt
    exec(compile(tree, "<bench implied_vols>", "exec"), ns)
    fn = ns["implied_vols"]
    fn.__bench_copy__ = True
    return fn


implied_vols = _implied_vols_copy()


# ── 3.2 carry (conditioning unresolved: DR-03, returned to the owner) ──

def pair_forward_gen(s0, k, call, put, days, rho, divs, evals=None, accelerate=True):
    if not _tier2_here():
        return (yield from ORIGINAL["pair_forward_gen"](s0, k, call, put, days, rho, divs, evals, accelerate))
    iv = lambda c, p: om.iv_european(c, p, evals=evals)
    tau = days / om.YEAR_DAYS
    df = math.exp(-rho * tau)
    pv = sum(a * math.exp(-rho * d / om.YEAR_DAYS) for d, a in divs)
    s_star = s0 - pv
    rec = {"site": "carry", "strike": k, "days": days, "spot": s0}
    n = 0

    def refuse(reason: str, **kw):
        _log(**rec, exit="refused", reason=reason, evals=n, **kw)
        return None

    if s_star <= 0:
        return refuse("price at or below the dividends")
    f = k + (call - put) / df
    if f <= 0:
        return refuse("non-positive parity forward")

    def sigmas(fwd, eep_c, eep_p):
        q = math.log(s_star / (fwd * df)) / tau
        return (iv(om.Context(True, s0, k, days, rho, q, 0.3, divs), call - eep_c),
                iv(om.Context(False, s0, k, days, rho, q, 0.3, divs), put - eep_p))

    def g(fwd, sc, sp):
        q = math.log(s_star / (fwd * df)) / tau
        if abs(q) > om.Q_MAX:
            return None
        legs = (om.Context(True, s0, k, days, rho, q, sc, divs), om.Context(False, s0, k, days, rho, q, sp, divs))
        need = [c for c in legs if not om.exempt(c)]
        vals = iter((yield need) if need else ())
        eeps, errs = [], []
        for c in legs:
            if om.exempt(c):
                eeps.append(0.0)
                errs.append(0.0)
            else:
                eeps.append(next(vals) - om.european(c))
                errs.append(err_of(c))
        if any(e is None for e in errs):
            return "no error"
        f2 = k + ((call - eeps[0]) - (put - eeps[1])) / df
        if f2 <= 0:
            return None
        sc2, sp2 = sigmas(f2, eeps[0], eeps[1])
        if sc2 is None or sp2 is None:
            return None
        return f2, sc2, sp2, (errs[0] + errs[1]) / df

    sc, sp = sigmas(f, 0.0, 0.0)
    if sc is None or sp is None:
        return refuse("no European volatility for a leg")
    hist: list[float] = []
    while n < of.FORWARD_ITER:
        n += 1
        got = yield from g(f, sc, sp)
        if got is None:
            return refuse("unusable pair")
        if got == "no error":
            return refuse(NO_ERROR)
        f2, sc2, sp2, d_g = got
        resid = abs(f2 - f)
        if resid <= max(1e-9 * s0, d_g):
            # raw facts only: no forward error is stated while the conditioning is unresolved (DR-03)
            _log(**rec, exit="value" if resid <= 1e-9 * s0 else "tier2 noise", reason=None, evals=n, forward=f2,
                 resid=resid, d_g=d_g, conditioning="not established")
            return f2, 0.5 * (sc2 + sp2)
        hist.append(f)
        if accelerate and len(hist) == 2:
            f0, f1 = hist
            den = f2 - 2.0 * f1 + f0
            hist = []
            if den != 0.0:
                fa_ = f0 - (f1 - f0) ** 2 / den
                if fa_ > 0 and abs(fa_ - f2) < abs(f1 - f0):
                    f2 = fa_
        f, sc, sp = f2, sc2, sp2
    return refuse("no convergence")


# ── 3.3 breakevens ──

def _breakeven_gen(rc, q, sigma, target):
    if not _tier2_here():
        return (yield from ORIGINAL["_breakeven_gen"](rc, q, sigma, target))
    is_call = q.kind == "call"
    s0 = rc.m.spot
    scale = max(1.0, s0)
    base = of._context_on(rc, q, sigma, rc.t.by, s0)
    pv = base.pv()
    exact = om.exempt(base)
    rec = {"site": "breakeven", "contract": q.contract}
    brent_cap = 40 - 1       # one evaluation reserved for the slope probe (DR-10)
    # Tier 2 checks the domain before its exempt route: the validated range for every row (3.3)
    lo = max(q.strike / om.KS_HI, pv / om.PV_FRAC_MAX, om.div_cluster(base.divs) / om.DIV_FRAC_MAX) * (1 + 1e-12)
    hi = q.strike / om.KS_LO * (1 - 1e-12)
    if lo >= hi:
        _log(**rec, exit="refused", reason="no validated range")
        return None, "no price range where the pricer is validated"
    ftol = 1e-10 * scale if exact else 1e-3 * om.tolerance(target, s0)
    memo: dict[float, float] = {}
    order: list[float] = []

    def f(x: float):
        if x not in memo:
            memo[x] = (yield [base.with_spot(x)])[0] - target
            order.append(x)
        return memo[x]

    def E(x: float):
        return err_of(base.with_spot(x))

    def eu(x: float) -> float:
        rc.pricer.closed()
        return om.european(base.with_spot(x)) - target

    def finish(root, candidate, exit_, brent_used):
        try:
            s, rho, probe = yield from slope_gen(
                f, E, root, candidate, lo, hi, om.european_delta(base.with_spot(root)), 1e-3 * root, 0.05 * root,
                +1 if is_call else -1, base.with_spot, 40 - brent_used)
        except Refused as r:
            _log(**rec, exit="refused", reason=str(r), root=root, evals=len(memo))
            return None, f"unresolved: {r}"
        d_x = (E(root) + abs(memo[root])) / s
        out = dict(root=root, d_x=d_x, rho=rho, probed=probe is not None, evals=len(memo))
        if d_x > BE_TOO_UNCERTAIN_REL * root:
            _log(**rec, exit="refused", reason="breakeven too uncertain", **out)
            return None, "unresolved: too uncertain"
        if abs(memo[root]) > (1e-10 * scale if exact else om.tolerance(target, root)):
            _log(**rec, exit="refused", reason="final check", **out)
            return None, "unresolved"
        _log(**rec, exit=exit_, reason=None, **out)
        return root, None

    e_lo, e_hi = eu(lo), eu(hi)
    x0 = None
    if e_lo * e_hi < 0:
        x0, _ = om.brent(eu, lo, hi, e_lo, e_hi, 1e-12 * scale, 1e-12 * scale, 200)
    if x0 is None or not lo < x0 < hi:
        x0 = min(max(q.strike, lo * 1.01), hi / 1.01)
    try:
        f0 = yield from f(x0)
        if abs(f0) <= ftol:
            return (yield from finish(x0, None, "value", 0))
        toward_lo = (f0 > 0) == is_call
        end = lo if toward_lo else hi
        delta = abs(om.european_delta(base.with_spot(x0)))
        step = abs(f0) / delta if delta > 1e-12 else 0.01 * x0
        step = max(step * 1.05, 1e-9 * scale)
        a, fa = x0, f0
        for _ in range(of.BRACKET_STEPS):
            b = max(end, a - step) if toward_lo else min(end, a + step)
            fb = yield from f(b)
            if fa * fb <= 0:
                break
            if b == end:
                side = f"below {of.money(lo)}" if toward_lo else f"above {of.money(hi)}"
                _log(**rec, exit="refused", reason="beyond the validated range", evals=len(memo))
                return None, f"the breakeven is {side}, where the pricer is not validated"
            a, fa, step = b, fb, 2.0 * step
        else:
            _log(**rec, exit="refused", reason="no bracket", evals=len(memo))
            return None, "unresolved"
        best, other, used, exit_ = yield from brent_noise_gen(f, a, b, fa, fb, 1e-12 * scale, ftol, brent_cap,
                                                              _noise_rule(E))
        if best is None:
            _log(**rec, exit="refused", reason="no convergence", evals=len(memo))
            return None, "unresolved"
        candidate = (best, other) if other is not None and other != best else None
        return (yield from finish(best, candidate, exit_, used))
    except om.OutOfDomain:
        _log(**rec, exit="refused", reason="Tier 2 refused a valuation", evals=len(memo))
        return None, "unresolved"


OVERRIDES = {"iv_american_gen": iv_american_gen, "pair_forward_gen": pair_forward_gen,
             "_breakeven_gen": _breakeven_gen, "implied_vols": implied_vols}
