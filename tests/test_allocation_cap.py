"""No optimizer breaches the 40% per-asset cap (fix/site-audit D3).

Tools > Asset allocation says "max 40% per asset · long-only", yet HERC served
US Agg Bond at 0.40524 (41% on screen): herc_optimize clipped riskfolio's
weights at 0.40 and then divided by their sum, which lifts every weight,
the capped one included, back over the cap. HRP did the same with its 2% floor.
Every method that post-processes now goes through `cap_weights`, an
iterative cap-and-redistribute (water-filling): capped assets are fixed at
the cap and the excess is shared pro rata over the rest until nothing breaches.

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


def test_the_example_caps_at_40_and_shares_the_excess_pro_rata():
    w = cap_weights(np.array([0.8, 0.1, 0.05, 0.05]), CAP)
    assert w == pytest.approx([0.4, 0.3, 0.15, 0.15], abs=1e-12)
    assert w.sum() == pytest.approx(1.0, abs=1e-12)
    # What clip-then-renormalize served: [0.4, 0.1, 0.05, 0.05] / 0.6 → 66.7%.
    old = np.clip([0.8, 0.1, 0.05, 0.05], 0, CAP)
    assert (old / old.sum()).max() > CAP


def test_a_cascade_caps_every_asset_the_redistribution_pushes_over():
    # 0.5 caps first; sharing its excess lifts 0.39 → 0.433, which then caps too.
    w = cap_weights(np.array([0.5, 0.39, 0.06, 0.05]), CAP)
    assert w.max() <= CAP + TOL
    assert w.sum() == pytest.approx(1.0, abs=1e-12)
    assert w[:2] == pytest.approx([0.4, 0.4], abs=1e-12)
    assert w[2] / w[3] == pytest.approx(0.06 / 0.05)


def test_a_floor_holds_beside_the_cap():
    w = cap_weights(np.array([0.85, 0.1, 0.045, 0.005]), CAP, 0.02)
    assert w.max() <= CAP + TOL and w.min() >= 0.02 - TOL
    assert w.sum() == pytest.approx(1.0, abs=1e-12)


def test_weights_inside_the_bounds_are_only_normalized():
    raw = np.array([0.3, 0.3, 0.2, 0.2]) * 0.999
    assert cap_weights(raw, CAP) == pytest.approx(raw / raw.sum(), abs=1e-15)


def test_an_infeasible_cap_is_an_error_not_a_breach():
    with pytest.raises(ValueError):
        cap_weights(np.array([0.5, 0.5]), CAP)  # two assets cannot sum to 1 under 40%


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
