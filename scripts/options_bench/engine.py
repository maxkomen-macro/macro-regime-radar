"""scripts/options_bench/engine.py — runs the engine under test on one case, the way the Finder serves it.

The engine is imported read-only from an engine root: a directory holding src/desk/options_math.py and
src/desk/options_finder.py (the repository once the baseline is merged, or an extracted copy of the build
branch). The bench never edits those files. A case goes through options_finder.Pricer, so the served route is
the Finder's own: intrinsic at expiry, a refusal when the price is at or below the owed dividends, the
European value when a theorem rules out early exercise or the early-exercise bound is at most a fifth of the
tolerance, otherwise the lattice, refused outside its domain or when it does not converge. The delta is the
one the Finder shows: the exempt European delta, the lattice delta for bound-European contexts (DR-51), or
the lattice's own.
"""

from __future__ import annotations

import hashlib
import importlib
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from .cases import Case

_LOADED: dict[str, tuple] = {}


def load(root: str):
    """(options_math, options_finder) from `root`, importing them under their own names once per process."""
    root = str(Path(root).resolve())
    if root in _LOADED:
        return _LOADED[root]
    om_path = Path(root) / "src" / "desk" / "options_math.py"
    if not om_path.exists():
        raise FileNotFoundError(f"no engine at {root}: src/desk/options_math.py is missing (pass --engine-root)")
    # the engine's `src` and the caller's own `src` (the repository's, in a test run) share a name: set the
    # caller's aside while the engine imports, then put it back, so later imports of src.* in the same process
    # still find the repository (the engine modules keep their own references; they import at module level)
    is_src = lambda k: k == "src" or k.startswith("src.")
    saved = {k: sys.modules.pop(k) for k in [k for k in sys.modules if is_src(k)]}
    sys.path.insert(0, root)
    try:
        om = importlib.import_module("src.desk.options_math")
        of = importlib.import_module("src.desk.options_finder")
    finally:
        sys.path.remove(root)
        for k in [k for k in sys.modules if is_src(k)]:
            del sys.modules[k]
        sys.modules.update(saved)
    _LOADED[root] = (om, of)
    return om, of


def describe(root: str) -> dict:
    """The engine's provenance for the manifest: file hashes, and the git commit when the root is a checkout."""
    root_p = Path(root).resolve()
    files = {}
    for rel in ("src/desk/options_math.py", "src/desk/options_finder.py"):
        p = root_p / rel
        files[rel] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    commit = None
    try:
        commit = subprocess.run(["git", "-C", str(root_p), "rev-parse", "HEAD"], capture_output=True, text=True,
                                timeout=10).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        pass
    return {"root": str(root_p), "files_sha256": files, "git_commit": commit}


def to_context(om, c: Case):
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


def run(root: str, c: Case) -> dict:
    """The engine's served value, delta and route for one case, with the work it charged and its wall time."""
    om, of = load(root)
    ctx = to_context(om, c)
    work = of.Work(of.WORK_LIMIT)
    pricer = of.Pricer(work)
    t0 = time.time()
    out: dict = {"status": None, "model": None, "value": None, "delta": None, "delta_note": None,
                 "bound": None, "reason": None}
    try:
        got = pricer.many([ctx])[0]
    except of.FinderError as e:
        out.update(status="refused:budget", reason=str(e))
        got = None
    if isinstance(got, str):
        kind = "refused:not-converged" if got == om.NOT_CONVERGED else (
            "refused:dividends" if "at or below the dividends" in got else "refused:domain")
        out.update(status=kind, reason=got)
    elif got is not None:
        out.update(status="served", model=got.model, value=got.value, bound=got.bound)
        if got.model == of.MODEL_EUROPEAN and got.bound is not None:
            try:
                d, why = pricer.deltas([ctx])[ctx]
            except of.FinderError as e:
                d, why = None, str(e)
            out.update(delta=d, delta_note=why)
        else:
            out.update(delta=got.delta, delta_note=getattr(got, "delta_note", None))
    out["units"] = work.used
    out["secs"] = time.time() - t0
    out["in_domain"] = om.in_domain(ctx)
    out["exempt"] = bool(om.exempt(ctx)) if c.spot - c.pv() > 0 else None
    return out


def lattice_check(root: str, c: Case, max_steps: int = 16_000) -> dict | None:
    """A same-family cross-check (not a reference): the plain day-aligned lattice with Black-Scholes smoothing
    and Richardson over (L/2, L) and (L/4, L/2), L the largest N0·2^k within max_steps. It shares the engine's
    code, so it can expose a finite-difference defect but cannot validate the engine."""
    om, _ = load(root)
    if c.spot - c.pv() <= 0:
        return None
    n0 = om.steps_for(c.days)
    k = 0
    while n0 * 2 ** (k + 1) <= max_steps:
        k += 1
    if k < 2:
        return None
    vals = {}
    for steps in (n0 * 2 ** (k - 2), n0 * 2 ** (k - 1), n0 * 2 ** k):
        v, d, _ = om._lattice([c.is_call], [c.strike / c.spot], _arr(c.rho), _arr(c.q), _arr(c.sigma),
                              [[(dd, a / c.spot) for dd, a in c.divs]], c.days, steps)
        vals[steps] = (float(v[0]) * c.spot, float(d[0]))
    s = sorted(vals)
    fine = 2 * vals[s[2]][0] - vals[s[1]][0]
    prev = 2 * vals[s[1]][0] - vals[s[0]][0]
    return {"value": fine, "change": abs(fine - prev), "steps": s[2]}


def _arr(x: float) -> np.ndarray:
    return np.array([x])


def resolution_schedule(root: str, days_list=(1, 7, 30, 90, 150, 365, 730, 1000, 1118, 1119, 1464)) -> list[dict]:
    """Correction G: which refinement pairs the controller can reach at each maturity under its own caps."""
    om, of = load(root)
    rows = []
    for days in days_list:
        n0 = om.steps_for(days)
        pairs = []
        for level in range(om.REFINE_LEVELS + 1):
            hi = n0 * (2 << level)
            allowed = level == 0 or om._units(n0 * (2 << level)) <= om.REFINE_UNITS_MAX
            pairs.append({"pair": [n0 * (1 << level), hi], "units_of_finer": om._units(hi), "allowed": allowed})
        total = sum(om._units(n0 * (1 << j)) for j in range(om.REFINE_LEVELS + 2))
        rows.append({"days": days, "n0": n0, "pairs": pairs, "units_all_four": total,
                     "work_limit": of.WORK_LIMIT, "single_cap": om.REFINE_UNITS_MAX})
    return rows


IV_BUMP = 0.01  # one volatility point, for the identifiability measure


def iv_roundtrip(root: str, c: Case, price: float) -> dict:
    """The Finder's own implied-volatility solve on a reference price: the sigma the engine recovers, and the
    engine's value there. Starts from sigma 0.3 as the Finder does; exempt contracts invert Black-76."""
    om, of = load(root)
    ctx = to_context(om, c)
    pricer = of.Pricer(of.Work(of.WORK_LIMIT))
    start = ctx.with_sigma(0.3)
    if om.exempt(start):
        sig, used = om.iv_european(start, price), None
    else:
        got = om.drive({0: om.iv_american_gen(start, price)}, pricer.values)[0]
        if isinstance(got, om.OutOfDomain):
            return {"status": "unpriceable", "reason": str(got)}
        sig, used = got
    if sig is None:
        return {"status": "no-root", "evals": used}
    # identifiability: how much one volatility point moves the engine's price at the true sigma
    lo_s, hi_s = max(om.SIGMA_LO, c.sigma - IV_BUMP), c.sigma + IV_BUMP
    vl, vh = pricer.many([ctx.with_sigma(lo_s), ctx.with_sigma(hi_s)])
    vega = None if isinstance(vl, str) or isinstance(vh, str) else (vh.value - vl.value) / (hi_s - lo_s)
    back = pricer.many([ctx.with_sigma(sig)])[0]
    out = {"status": "solved", "sigma": sig, "sigma_err": sig - c.sigma, "evals": used, "vega": vega,
           "in_finder_range": bool(of.IV_MIN <= sig <= of.IV_MAX)}
    if isinstance(back, str):
        out["residual"] = None
        out["back_reason"] = back
    else:
        out["residual"] = back.value - price
    return out
