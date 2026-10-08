"""No optimizer breaches the 40% per-asset cap (fix/site-audit D3).

Tools > Asset allocation says "max 40% per asset · long-only", yet HERC served
US Agg Bond at 0.40524 (41% on screen): herc_optimize clipped riskfolio's
weights at 0.40 and then divided by their sum, which lifts every weight,
the capped one included, back over the cap. HRP did the same with its 2% floor.
Every method that post-processes now goes through `cap_weights`, the
Euclidean projection onto the bounded simplex (Codex S-02: the pro-rata
water-filling it replaced rejected feasible floor-and-cap sets).

NO network, NO database: synthetic seeded returns only.
"""
import numpy as np
import pandas as pd
import pytest

from src.analytics.allocation import (
    black_litterman_optimize,
    cap_weights,
    cvar_optimize,
    herc_optimize,
    hierarchical_risk_parity_optimize,
    mean_variance_optimize,
    minimum_variance_optimize,
    risk_parity_optimize,
)

CAP = 0.40
TOL = 1e-9


def test_the_example_caps_at_40_and_shifts_the_rest_onto_the_simplex():
    """fix/site-audit S-02: a bounded-simplex projection, w = clip(x + λ, lo, hi) with Σw = 1."""
    w = cap_weights(np.array([0.8, 0.1, 0.05, 0.05]), CAP)
    assert w == pytest.approx([0.4, 0.1 + 0.4 / 3, 0.05 + 0.4 / 3, 0.05 + 0.4 / 3], abs=1e-12)  # λ = 0.1333…
    assert w.sum() == pytest.approx(1.0, abs=1e-12)
    # What clip-then-renormalize served: [0.4, 0.1, 0.05, 0.05] / 0.6 → 66.7%.
    old = np.clip([0.8, 0.1, 0.05, 0.05], 0, CAP)
    assert (old / old.sum()).max() > CAP


def test_codex_s02_a_floor_and_a_cap_together_are_feasible():
    """The counterexample the pro-rata water-filling rejected: it capped 0.8, scaled 0.19 to 0.57 and capped
    it too, then floored the two 0.005s and summed to 1.2."""
    w = cap_weights(np.array([0.8, 0.19, 0.005, 0.005]), CAP, 0.2)
    assert w == pytest.approx([0.4, 0.2, 0.2, 0.2], abs=1e-12)


def test_a_cascade_caps_every_asset_the_shift_pushes_over():
    w = cap_weights(np.array([0.5, 0.39, 0.06, 0.05]), CAP)
    assert w == pytest.approx([0.4, 0.4, 0.105, 0.095], abs=1e-12)  # λ = 0.045


def test_a_floor_holds_beside_the_cap():
    w = cap_weights(np.array([0.85, 0.1, 0.045, 0.005]), CAP, 0.02)
    assert w.max() <= CAP + TOL and w.min() >= 0.02 - TOL
    assert w.sum() == pytest.approx(1.0, abs=1e-12)


def test_weights_already_on_the_simplex_are_unchanged():
    raw = np.array([0.3, 0.3, 0.2, 0.2])
    assert cap_weights(raw, CAP) == pytest.approx(raw, abs=1e-15)


@pytest.mark.parametrize("seed", range(40))
def test_any_weights_land_inside_the_bounds_and_sum_to_one(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(4, 12))
    x = rng.dirichlet(np.ones(n) * 0.3) * rng.uniform(0.5, 1.5) + rng.normal(0, 0.01, n)
    w = cap_weights(x, CAP, 0.02)
    assert w.max() <= CAP + TOL and w.min() >= 0.02 - TOL
    assert w.sum() == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize(("x", "lo", "hi"), [
    ([0.5, 0.5], 0.0, CAP),          # two assets cannot reach 1 under 40%
    ([0.25] * 4, 0.3, CAP),          # four floors of 30% pass 1
    ([0.5, 0.5, 0.0], 0.5, 0.4),     # a floor above the cap
])
def test_infeasible_bounds_raise_a_clear_error(x, lo, hi):
    with pytest.raises(ValueError, match=r"cannot sum to 1"):
        cap_weights(np.array(x), hi, lo)


# A universe with one very low-volatility asset: the risk-based methods
# (HRP, HERC, min variance) want most of the book in it.
ASSETS = [f"A{i}" for i in range(10)]


@pytest.fixture(scope="module")
def returns() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    idx = pd.date_range("2010-01-01", periods=180, freq="MS")
    vols = np.array([0.004] + [0.05] * 9)
    data = rng.normal(0.005, 1.0, size=(180, 10)) * vols
    return pd.DataFrame(data, index=idx, columns=ASSETS)


@pytest.fixture(scope="module")
def cov(returns) -> np.ndarray:
    return returns.cov().to_numpy() * 12


def _methods(returns, cov):
    mu = returns.mean().to_numpy() * 12
    return {
        "mvo": mean_variance_optimize(mu, cov),
        "min_var": minimum_variance_optimize(cov),
        "risk_parity": risk_parity_optimize(cov),
        "black_litterman": black_litterman_optimize(cov, ASSETS, mu),
        "hrp": hierarchical_risk_parity_optimize(cov, ASSETS),
        "cvar": cvar_optimize(returns, cov),
        "herc": herc_optimize(returns, cov),
    }


def test_no_method_exceeds_the_cap(returns, cov):
    for name, result in _methods(returns, cov).items():
        w = np.asarray(result["weights"], dtype=float)
        assert w.max() <= CAP + TOL, f"{name} serves {w.max():.6f} in one asset, over the {CAP:.0%} cap"
        assert w.min() >= -TOL, f"{name} serves a short position"
        assert w.sum() == pytest.approx(1.0, abs=1e-9), name


def test_the_floored_methods_keep_their_floor(returns, cov):
    for name, result in (("risk_parity", risk_parity_optimize(cov)), ("hrp", hierarchical_risk_parity_optimize(cov, ASSETS))):
        w = np.asarray(result["weights"], dtype=float)
        assert w.min() >= 0.02 - TOL, f"{name} serves {w.min():.6f}, under its 2% floor"
