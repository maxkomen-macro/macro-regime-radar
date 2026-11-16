"""scripts/options_bench/phase4a/bench.py — the Phase 4a replay bench: one Finder request under one configuration.

docs/desk/OPTIONS_PHASE4A.md, section 2. `options_finder.run()` is called unmodified. The bench hands it a pricer
that chooses Tier 1 or Tier 2 per call site, and it names the site by wrapping the Finder's own functions in this
process only (nothing served imports this module, and the served modules on disk are unchanged).

Sites: carry (calibrate_all and its pair solves), iv (implied_vols), value (value_rows' valuations and deltas,
curve_pnl), breakeven (value_rows' breakeven solves). Each engine keeps its own memo. Tier 2 is
options_adaptive.price under the accuracy check's frozen configuration; each of its lattice levels is charged to the
request's Work before it is computed, and a solve starts only when its pre-lattice reserve fits.
"""

from __future__ import annotations

import contextlib
import functools
import math
import time
from collections import Counter, defaultdict
from typing import Any, Callable

from src.desk import options_adaptive as oa
from src.desk import options_check as ock
from src.desk import options_engine as oe
from src.desk import options_finder as of
from src.desk import options_math as om

SITES = ("carry", "iv", "value", "breakeven")
CONFIGS = {
    "A": frozenset(),
    "B": frozenset({"value"}),
    "C": frozenset({"carry", "iv", "breakeven"}),
    "D": frozenset(SITES),
}
MODEL_TIER2 = "tier2"


class SiteStats:
    """Per site: unique contexts asked for, how many were already in that engine's memo, Tier 2's work and refusals."""

    def __init__(self) -> None:
        self.lookups = Counter()          # (site, engine) -> unique contexts asked for in a call
        self.hits = Counter()             # (site, engine) -> of those, already memoized
        self.priced = Counter()           # (site, engine) -> contexts newly priced
        self.t2_units = Counter()         # site -> Tier 2 units
        self.t2_refusals = Counter()      # (site, status: reason) -> count
        self.t2_routes = Counter()        # (site, route) -> count

    def as_dict(self) -> dict:
        key = lambda k: ":".join(k) if isinstance(k, tuple) else k
        return {name: {key(k): v for k, v in getattr(self, name).items()}
                for name in ("lookups", "hits", "priced", "t2_units", "t2_refusals", "t2_routes")}


class SitePricer(of.Pricer):
    """of.Pricer, with Tier 2 at the configuration's sites. `site` is set by the wrappers below."""

    def __init__(self, work: of.Work, tier2_sites: frozenset, stats: SiteStats) -> None:
        super().__init__(work)
        self.tier2_sites = tier2_sites
        self.stats = stats
        self.site = "value"
        self.t2_memo: dict[om.Context, of.Valued | str] = {}
        self.t2_answer: dict[om.Context, Any] = {}   # the Tier 2 Answer behind each value (its stated error)
        self.rf: list[dict] = []                     # root-finding rule exits (rootfinding.py), Tier 2 sites only
        self.solves: list[dict] = []                 # every solve, either engine: rounds, contexts, exit (B-4)

    def engine(self) -> int:
        return 2 if self.site in self.tier2_sites else 1

    def many(self, cs):
        site, eng = self.site, self.engine()
        uniq = list(dict.fromkeys(cs))
        memo = self.memo if eng == 1 else self.t2_memo
        self.stats.lookups[(site, str(eng))] += len(uniq)
        hit = sum(1 for c in uniq if c in memo)
        self.stats.hits[(site, str(eng))] += hit
        self.stats.priced[(site, str(eng))] += len(uniq) - hit
        if eng == 1:
            return super().many(cs)
        for c in uniq:
            if c not in self.t2_memo:
                self.t2_memo[c] = self._tier2(c, site)
        return [self.t2_memo[c] for c in cs]

    def deltas(self, cs):
        if self.engine() == 1:
            return super().deltas(cs)
        # Tier 2's values carry their own delta; the Finder asks for deltas only of Tier 1's bound-European values
        return {c: ((self.t2_memo[c].delta, self.t2_memo[c].delta_note) if isinstance(self.t2_memo.get(c), of.Valued)
                    else (None, "no Tier 2 value")) for c in cs}

    def _tier2(self, c: om.Context, site: str) -> of.Valued | str:
        # the Finder's own triage before any lattice: at expiry, and a price at or below the dividends owed
        if c.days == 0:
            v = max(c.spot - c.strike, 0.0) if c.is_call else max(c.strike - c.spot, 0.0)
            return of.Valued(v, v, of.MODEL_INTRINSIC, None)
        if c.spot - c.pv() <= 0:
            return "the price is at or below the dividends still owed"
        reserve = ock.prelattice_reserve(c)
        w = self.work
        if w.used + reserve > w.limit:
            w.charge(reserve)   # raises the Finder's "Too much to price at once"
        base = w.used
        charged = [0]

        def level(cx: om.Context, m: int) -> oa.Level:
            u = oa.units(om.steps_for(cx.days) * m)
            if base + reserve + charged[0] + u > w.limit:
                w.charge(reserve + charged[0] + u)   # raises before the level is computed
            charged[0] += u
            return oa.lattice_level(cx, m)

        a = oa.price(c, ock.FROZEN, level)
        # Tier 2's own count (at most the reserve plus the levels charged, which fit the limit; were it more, the
        # charge raises and the request is refused, never served over the limit)
        w.charge(int(a.units))
        self.stats.t2_units[site] += int(a.units)
        self.stats.t2_routes[(site, a.route)] += 1
        self.t2_answer[c] = a
        if a.value is None or not math.isfinite(a.value):
            self.stats.t2_refusals[(site, f"{a.price_status}: {a.reason}")] += 1
            if a.price_status == oe.OUTSIDE and a.reason:
                # in_domain's own reason, verbatim: the Finder's "outside domain" carry branch reads it (DR-06)
                return a.reason
            return f"Tier 2 gave no value ({a.price_status}: {a.reason})"
        delta = a.delta if a.delta_status == "served" and a.delta is not None and math.isfinite(a.delta) else None
        return of.Valued(float(a.value), om.european(c), f"{MODEL_TIER2}:{a.route}", delta,
                         delta_note=None if delta is not None else (a.delta_reason or "Tier 2 withheld the delta"))


# ── naming the site: wrap the Finder's functions in this process ──

_CURRENT: list[SitePricer] = []


@contextlib.contextmanager
def _at(site: str):
    p = _CURRENT[-1] if _CURRENT else None
    if p is None:
        yield
        return
    old, p.site = p.site, site
    try:
        yield
    finally:
        p.site = old


def _wrap(fn: Callable, site: str) -> Callable:
    @functools.wraps(fn)
    def inner(*a, **kw):
        with _at(site):
            return fn(*a, **kw)
    inner.__wrapped_site__ = site
    return inner


_ORIG: dict[str, Callable] = {}


def delegate(gen, on_exit: Callable[[str, Any, int, int, str | None], None]):
    """Run a solver generator unchanged (every yield, send and throw passed through) and report how it ended:
    on_exit(exit, result, rounds, contexts, reason). exit is "returned" or "refused" (an OutOfDomain thrown in by
    the driver, re-raised after the report)."""
    rounds = contexts = 0
    try:
        req = next(gen)
        while True:
            rounds += 1
            contexts += len(req)
            try:
                got = yield req
            except GeneratorExit:
                gen.close()
                raise
            except BaseException as exc:   # the driver's OutOfDomain, passed to the solver as today
                req = gen.throw(exc)
            else:
                req = gen.send(got)
    except StopIteration as stop:
        on_exit("returned", stop.value, rounds, contexts, None)
        return stop.value
    except om.OutOfDomain as exc:
        on_exit("refused", None, rounds, contexts, str(exc))
        raise


def _solve_counter(name: str, fn: Callable) -> Callable:
    """Wrap one solver so every solve, under either engine, is recorded on the run's pricer (B-4)."""
    def ident(a):
        if name == "iv_american_gen":
            c = a[0]
            return {"site": "iv", "call": c.is_call, "strike": c.strike, "days": c.days}
        if name == "pair_forward_gen":
            return {"site": "carry", "strike": a[1], "days": a[4]}
        return {"site": "breakeven", "contract": a[1].contract}

    @functools.wraps(fn)
    def inner(*a, **kw):
        p = _CURRENT[-1] if _CURRENT else None
        rec = ident(a)

        def on_exit(exit_, result, rounds, contexts, reason):
            if p is None:
                return
            if exit_ == "returned":
                ok = (result is not None if name == "pair_forward_gen" else
                      result[0] is not None if isinstance(result, tuple) else result is not None)
                exit_ = "solved" if ok else "no solution"
                if name == "_breakeven_gen" and isinstance(result, tuple):
                    reason = result[1]
            p.solves.append({**rec, "engine": p.engine(), "exit": exit_, "reason": reason, "rounds": rounds,
                             "contexts": contexts})
        return delegate(fn(*a, **kw), on_exit)
    inner.__solve_counter__ = True
    return inner


SOLVERS = (("iv_american_gen", "om"), ("pair_forward_gen", "of"), ("_breakeven_gen", "of"))


def _drive_tagged(gens, value_many):
    """om.drive inside value_rows is the breakeven solve; elsewhere it keeps the caller's site."""
    p = _CURRENT[-1] if _CURRENT else None
    if p is not None and p.site == "value":
        with _at("breakeven"):
            return _ORIG["drive"](gens, value_many)
    return _ORIG["drive"](gens, value_many)


@contextlib.contextmanager
def patched(pricer: SitePricer, overrides: dict[str, Callable] | None = None,
            wrappers: dict[str, Callable[[Callable], Callable]] | None = None):
    """Install the site wrappers and this run's pricer; restore everything after. `overrides` replaces Finder or
    solver functions (rootfinding.OVERRIDES in C and D), by name on options_finder or options_math; `wrappers` then
    wrap the current function by name (instrumentation that only records). Site wrappers go on last."""
    targets = {"calibrate_all": "carry", "implied_vols": "iv", "value_rows": "value", "curve_pnl": "value"}
    saved = {name: getattr(of, name) for name in targets}
    saved_pricer = of.Pricer
    _ORIG["drive"] = om.drive
    saved_over = {}
    try:
        # overrides first, so a replaced site function is still wrapped with its site
        for name, fn in (overrides or {}).items():
            mod = of if hasattr(of, name) else om
            saved_over[(mod, name)] = getattr(mod, name)
            setattr(mod, name, fn)
        for name, wrap in (wrappers or {}).items():
            mod = of if hasattr(of, name) else om
            saved_over.setdefault((mod, name), getattr(mod, name))
            setattr(mod, name, wrap(getattr(mod, name)))
        for name, where in SOLVERS:   # counting only; the solver underneath is unchanged
            mod = of if where == "of" else om
            saved_over.setdefault((mod, name), getattr(mod, name))
            setattr(mod, name, _solve_counter(name, getattr(mod, name)))
        for name, site in targets.items():
            setattr(of, name, _wrap(getattr(of, name), site))
        om.drive = _drive_tagged
        of.Pricer = lambda work: pricer if pricer.work is work else _bind(pricer, work)
        _CURRENT.append(pricer)
        yield pricer
    finally:
        _CURRENT.pop()
        of.Pricer = saved_pricer
        om.drive = _ORIG["drive"]
        for name, fn in saved.items():
            setattr(of, name, fn)
        for (mod, name), fn in saved_over.items():
            setattr(mod, name, fn)


def _bind(pricer: SitePricer, work: of.Work) -> SitePricer:
    pricer.work = work
    return pricer


def overrides_for(config: str) -> dict[str, Callable]:
    """The Tier 2-aware solvers wherever a root-finding site is Tier 2 (C and D); nothing in A and B."""
    if not CONFIGS[config] & {"carry", "iv", "breakeven"}:
        return {}
    from . import rootfinding
    return dict(rootfinding.OVERRIDES)


def run_one(req, config: str, work_limit: int, wrappers: dict[str, Callable] | None = None) -> dict:
    """One request under one configuration. Returns the answer (or the refusal) with the bench's measures."""
    stats = SiteStats()
    pricer = SitePricer(of.Work(work_limit), CONFIGS[config], stats)
    t_cpu, t_wall = time.process_time(), time.perf_counter()
    answer, outcome, error = None, "answered", None
    with patched(pricer, overrides_for(config), wrappers):
        try:
            answer = req.run(work_limit=work_limit)
        except of.FinderError as e:
            outcome = "work limit" if str(e).startswith("Too much to price") else "finder refusal"
            error = str(e)
        except Exception as e:   # a bench failure is recorded, never hidden
            outcome, error = "failed", f"{type(e).__name__}: {e}"
    cpu, wall = time.process_time() - t_cpu, time.perf_counter() - t_wall
    return {"config": config, "limit": work_limit, "outcome": outcome, "error": error, "answer": answer,
            "units": pricer.work.used, "cpu_s": cpu, "wall_s": wall, "sites": stats.as_dict(),
            "pricer": pricer}
