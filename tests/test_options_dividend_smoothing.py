"""Tier 1's smoothed step into each cum-dividend close (design S, approved 2026-11-04; src/desk/options_math.py).

The smoothing is exact for its local model (hold linear in S* between a parent's two children), not a proof of
the lattice's global accuracy: the named regressions below are checked against independent references (the
bench's Crank-Nicolson FD), and acceptance comes from a fresh held-out bench run."""

from __future__ import annotations

import dataclasses
import json
import math
from pathlib import Path

import numpy as np
import pytest
from scipy.integrate import quad

from scripts.options_bench import cases
from src.desk import options_engine as oe
from src.desk import options_math as om
from tests.fixtures import options_pre_dividend_smoothing as frozen

REPO = Path(__file__).resolve().parent.parent
REFS = json.loads((REPO / "tests" / "fixtures" / "options_dividend_references.json").read_text())
ROWS = {r["id"]: r for r in REFS["rows"]}
NAMED = {c.id: c for c in cases.NAMED}
ACCEPT = 0.5   # a named case's error must stay within half of its tolerance (plus the reference's uncertainty)


def ctx(c: cases.Case, scale: float = 1.0) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma,
                      tuple((d, a * scale) for d, a in c.divs))


def lattice(c: cases.Case, steps: int, smooth: bool, scale: float = 1.0, with_cont: bool = False):
    return om._lattice([c.is_call], [c.strike / c.spot], np.array([c.rho]), np.array([c.q]), np.array([c.sigma]),
                       [[(d, a * scale / c.spot) for d, a in c.divs]], c.days, steps, with_cont=with_cont,
                       smooth_divs=smooth)


# ── the smoothed step against numerical integration ──────────────────────────

def _layer(steps: int, x0: float, s: float, nu: float):
    k = np.arange(steps + 1)
    base = (x0 * np.exp((nu - s) * k))[None, :]
    ratio = np.exp(2.0 * s * k)[None, :]
    return base, ratio


@pytest.mark.parametrize("f_children, a, b", [
    ([-1.0, 0.5, 2.0, 2.0, 50.0, 60.0], 1.0, -0.9),     # β > 0, a flat pair (β = 0) and the window's edge
    ([3.0, -1.0, -2.0, -2.5, -3.0, -3.5], -1.0, 1.1),   # β < 0 (a put-like exercise value)
    ([-0.2, 0.4, 7.0, 7.5, 8.0, 9.0], 1.0, -1.0),       # a steep pair whose crossing falls at or below zero
])
def test_the_smoothed_step_is_the_exact_expectation_of_its_local_model(f_children, a, b):
    sig, dt, rho, q = 0.45, 1.0 / 365.0, 0.03, 0.01
    s, nu = sig * math.sqrt(dt), (rho - q - 0.5 * sig * sig) * dt
    g, disc = np.array([math.exp((rho - q) * dt)]), np.array([math.exp(-rho * dt)])
    i = 4                                             # parents at step 4, children (the close) at step 5
    base, ratio = _layer(8, 1.0, s, nu)
    xs = base[0, i + 1] * ratio[0, : i + 2]
    f = np.array([f_children]) * 0.01
    e = (a * xs + b)[None, :]
    nv = np.full((1, i + 1), np.nan)
    om._smooth_parents(nv, np.array([0]), f, e, i, base, ratio, g, disc, np.array([sig]), dt)
    flips = [j for j in range(i + 1) if (f[0, j] > 0) != (f[0, j + 1] > 0)]
    near = {j for j in range(i + 1) if any(abs(j - k) <= om.SMOOTH_WINDOW for k in flips)}
    assert {j for j in range(i + 1) if not math.isnan(nv[0, j])} == near
    for j in near:
        xd, xu = xs[j], xs[j + 1]
        beta = (f[0, j + 1] - f[0, j]) / (xu - xd)
        alpha = f[0, j] - beta * xd
        fwd = base[0, i] * ratio[0, j] * g[0]
        m, v = math.log(fwd) - 0.5 * sig * sig * dt, sig * math.sqrt(dt)

        def integrand(z):
            x = math.exp(m + v * z)
            return (a * x + b + max(alpha + beta * x, 0.0)) * math.exp(-0.5 * z * z) / math.sqrt(2.0 * math.pi)

        kink = [(math.log(-alpha / beta) - m) / v] if beta != 0 and -alpha / beta > 0 else []
        want = disc[0] * quad(integrand, -12.0, 12.0, points=kink or None, epsabs=1e-14, epsrel=1e-12, limit=200)[0]
        assert nv[0, j] == pytest.approx(want, rel=1e-9, abs=1e-13), j


# ── what must not change ─────────────────────────────────────────────────────

# _lattice with the flag off must stay bit-identical to main before design S (38916cb): Tier 2 and the bench's
# lattice check call it this way. Both implementations run in the same process: today's module against a verbatim
# copy of 38916cb's options_math.py (tests/fixtures/options_pre_dividend_smoothing/, checked by its git blob id).
# Recorded float.hex constants were not portable: another platform's numpy and libm round differently, so there the
# old and the new code both give other bits, identical to each other.
PRE_S_FILE, PRE_S_BLOB = "options_math_38916cb.py", "633e21633e9fdf16ea32820ed888e6b13000f884"
FLAG_OFF = [
    (True, 0.95, 0.03, 0.01, 0.4, [(4, 0.02), (40, 0.015)], 60, 120),
    (False, 1.08, 0.05, 0.0, 0.3, [(10, 0.01), (59, 0.012)], 60, 240),
    (True, 0.9, -0.01, 0.02, 0.6, [(0, 0.015), (21, 0.02)], 22, 330),
]


def test_the_frozen_pre_change_lattice_is_the_verbatim_38916cb_file():
    assert frozen.blob_id(PRE_S_FILE) == PRE_S_BLOB


@pytest.fixture(scope="module")
def pre_s():
    return frozen.load(PRE_S_FILE, PRE_S_BLOB)


@pytest.mark.parametrize("args", FLAG_OFF)
def test_the_flag_off_lattice_is_bit_identical_to_before(args, pre_s):
    c, k, r, q, s, dv, days, steps = args

    def run(m):
        return m._lattice([c], [k], np.array([r]), np.array([q]), np.array([s]), [dv], days, steps, with_cont=True)

    new, old = run(om), run(pre_s)
    assert len(new) == len(old) == 4
    for a, b in zip(new, old):   # root values, step-1 deltas, exercised at the root, root continuation values
        assert (a.dtype, a.shape) == (b.dtype, b.shape)
        assert a.tobytes() == b.tobytes()   # every bit, not a tolerance
    assert np.isfinite(new[0]).all() and np.isfinite(new[1]).all()


def test_smoothing_leaves_contexts_without_a_smoothed_close_unchanged():
    rng = np.random.default_rng(20261104)
    for _ in range(40):
        days = int(rng.integers(2, 120))
        steps = om.steps_for(days) * int(rng.choice([1, 2]))
        m = 3
        args = (list(rng.random(m) < 0.5), list(rng.uniform(0.8, 1.2, m)), rng.uniform(-0.01, 0.06, m),
                rng.uniform(0.0, 0.04, m), rng.uniform(0.1, 0.8, m))
        for divs in ([[] for _ in range(m)], [[(0, 0.01)] for _ in range(m)]):   # none, or only on day 0
            on = om._lattice(*args, divs, days, steps, with_cont=True, smooth_divs=True)
            off = om._lattice(*args, divs, days, steps, with_cont=True)
            for x, y in zip(on, off):
                assert np.array_equal(x, y, equal_nan=True)


def test_only_tier_1_turns_the_smoothing_on():
    import inspect

    from src.desk import options_adaptive
    assert inspect.signature(om._lattice).parameters["smooth_divs"].default is False
    assert "smooth_divs" not in inspect.getsource(options_adaptive)
    assert inspect.getsource(om.american).count("smooth_divs=True") == 1


# ── the error is regular in N again ──────────────────────────────────────────

@pytest.mark.parametrize("cid, side, scale", [("named/S29-G2-1239", "up", 1.1), ("named/S29-G2-1239", "down", 0.9),
                                              ("named/S26-G2-1158", "up", 1.1)])
def test_the_lattice_error_is_regular_in_n_at_a_dividend_close(cid, side, scale):
    c, ref = NAMED[cid], ROWS[cid]["divsens"][side]["ref"]
    n0, tol = om.steps_for(c.days), om.tolerance(ref, c.spot)
    val = {k: float(lattice(c, n0 * k, True, scale)[0][0]) * c.spot for k in range(1, 9)}
    ne = [n0 * k * (val[k] - ref) / tol for k in val]
    # before design S, N·error swung from −28 to +115 tolerances across these N for 1239 up (a jumping coefficient)
    assert max(ne) - min(ne) <= 10.0
    for k in (1, 2):   # the (N, 2N) and (2N, 4N) Richardson values
        assert abs(2.0 * val[2 * k] - val[k] - ref) <= 0.1 * tol


def test_a_close_on_the_first_built_layer_is_smoothed():
    # S26 G2/880: 163 days, N = 163 (one step a day), a dividend on day 162, so its close is step N − 1, the
    # layer built from the Black-Scholes last step rather than by the backward loop (Codex DR-03)
    c = NAMED["named/S26-G2-880"]
    n0 = om.steps_for(c.days)
    assert n0 == c.days == 163 and max(d for d, _ in c.divs) == n0 - 1
    only = dataclasses.replace(c, divs=((162, 1.3323),))
    for steps in (n0, 2 * n0):   # step N − 1 at N; the ordinary loop at 2N
        assert float(lattice(only, steps, True)[0][0]) != float(lattice(only, steps, False)[0][0])


# ── the named regressions against independent references ─────────────────────

@pytest.mark.parametrize("cid", sorted(ROWS))
def test_named_dividend_regressions_meet_their_references(cid):
    c, row = NAMED[cid], ROWS[cid]
    a = oe.baseline(ctx(c))
    got = "served:no-delta" if a.priced and a.delta_status == oe.WITHHELD else ("served" if a.priced else a.price_status)
    assert got == c.expect, (cid, got, a.reason, a.delta_reason)
    if c.expect_note:
        assert c.expect_note in (a.delta_reason or "")
    ref = row["value"]
    tol = om.tolerance(ref["ref"], c.spot)
    assert abs(a.value - ref["ref"]) <= ACCEPT * tol + ref["u"], (cid, a.value, ref["ref"], tol)
    if a.delta is not None and row["delta"]["status"] == "reliable":
        assert abs(a.delta - row["delta"]["ref"]) <= om.DELTA_TOL + row["delta"]["u"]
    if "divsens" in row:
        up, dn = oe.baseline(ctx(c, 1.0 + REFS["div_bump"])), oe.baseline(ctx(c, 1.0 - REFS["div_bump"]))
        assert up.priced and dn.priced
        r_up, r_dn = row["divsens"]["up"], row["divsens"]["down"]
        err = abs((up.value - dn.value) - (r_up["ref"] - r_dn["ref"]))
        assert err <= ACCEPT * tol + r_up["u"] + r_dn["u"], (cid, err / tol)


def test_the_named_list_holds_every_dividend_regression():
    assert set(ROWS) <= set(NAMED)
    for cid in ROWS:
        assert NAMED[cid].divs and NAMED[cid].expect in ("served", "served:no-delta")
