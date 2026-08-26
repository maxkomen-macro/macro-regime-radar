"""
tests/test_allocation_optimizers.py

Verifies the riskfolio-lib-backed optimizers (Min CVaR, HERC) actually compute
— not the equal-weight fallback — now that riskfolio-lib is installed, that
every optimizer result carries an explicit `converged` key, and that the
regime-conditional gate semantics (min 12 stats months / 24 cov months)
reported by `optimizations_skipped` hold.

NO network, NO database: synthetic seeded returns only; the one function that
reads the DB (get_risk_free_rate, called inside get_regime_conditional_stats)
is monkeypatched.
"""
import numpy as np
import pandas as pd
import pytest

from src.analytics.allocation import (
    _attach_portfolio_cvar,
    _regime_month_counts,
    calculate_cvar,
    cvar_optimize,
    get_regime_conditional_covariance,
    get_regime_conditional_stats,
    herc_optimize,
    hierarchical_risk_parity_optimize,
)

N_MONTHS = 120
N_ASSETS = 8
ASSETS   = [f"Asset_{i}" for i in range(N_ASSETS)]


@pytest.fixture(scope="module")
def monthly_returns() -> pd.DataFrame:
    rng  = np.random.default_rng(42)
    idx  = pd.date_range("2015-01-01", periods=N_MONTHS, freq="MS")
    data = rng.normal(0.006, 0.04, size=(N_MONTHS, N_ASSETS))
    return pd.DataFrame(data, index=idx, columns=ASSETS)


@pytest.fixture(scope="module")
def cov_matrix(monthly_returns: pd.DataFrame) -> np.ndarray:
    return monthly_returns.cov().to_numpy() * 12  # annualized, module convention


def _assert_real_optimization(result: dict) -> None:
    weights = np.asarray(result["weights"], dtype=float)
    assert weights.shape == (N_ASSETS,)
    assert abs(weights.sum() - 1.0) < 1e-6
    assert (weights >= -1e-9).all()
    assert result["converged"] is True
    assert "(fallback)" not in result["method"]


def test_cvar_optimize_computes_for_real(monthly_returns, cov_matrix):
    result = cvar_optimize(monthly_returns, cov_matrix)
    _assert_real_optimization(result)
    assert result["volatility"] > 0


def test_herc_optimize_computes_for_real(monthly_returns, cov_matrix):
    result = herc_optimize(monthly_returns, cov_matrix)
    _assert_real_optimization(result)
    assert result["volatility"] > 0


def test_hrp_success_path_sets_converged(cov_matrix):
    result = hierarchical_risk_parity_optimize(cov_matrix, ASSETS)
    assert result["converged"] is True
    weights = np.asarray(result["weights"], dtype=float)
    assert abs(weights.sum() - 1.0) < 1e-6
    assert "(fallback)" not in result["method"]


def test_gate_excludes_regime_with_too_few_months(monthly_returns, monkeypatch):
    """Pins the gate semantics optimizations_skipped reports: a regime with
    only 3 months is absent from both the stats (min 12) and cov (min 24)
    dicts, and _regime_month_counts sees the same counts the gate saw."""
    from src.analytics import allocation

    monkeypatch.setattr(allocation, "get_risk_free_rate", lambda: 0.045)  # no DB

    labels = ["Goldilocks"] * (N_MONTHS - 3) + ["Stagflation"] * 3
    regimes = pd.DataFrame({"regime": labels}, index=monthly_returns.index)

    stats = get_regime_conditional_stats(monthly_returns, regimes)
    covs  = get_regime_conditional_covariance(monthly_returns, regimes)

    assert "Stagflation" not in stats
    assert "Stagflation" not in covs
    assert "Goldilocks" in stats           # 117 months clears both gates
    assert "Goldilocks" in covs

    assert _regime_month_counts(monthly_returns, regimes, "Stagflation") == (3, 3)
    assert _regime_month_counts(monthly_returns, regimes, "Goldilocks") == (
        N_MONTHS - 3,
        N_MONTHS - 3,
    )


def test_attach_portfolio_cvar_dict_shape(monthly_returns):
    """Exercises the production helper get_allocation_data calls: cvar_95 on
    each optimizer result is None or the {cvar, var, worst_periods} dict with
    float members — the shape the Streamlit dashboard consumes via
    opt["cvar_95"]["cvar"]."""
    rng = np.random.default_rng(11)
    raw = rng.random(N_ASSETS)
    optimizations = {
        "mvo":         {"weights": np.full(N_ASSETS, 1.0 / N_ASSETS)},
        "herc":        {"weights": raw / raw.sum()},
        "asset_names": ASSETS,
    }

    _attach_portfolio_cvar(optimizations, monthly_returns, ASSETS)

    for key in ("mvo", "herc"):
        c = optimizations[key]["cvar_95"]
        assert c is None or (
            isinstance(c, dict)
            and isinstance(c["cvar"], float)
            and isinstance(c["var"], float)
        )
        # 120 months of weighted returns → the dict branch, concretely
        assert isinstance(c, dict)
    # methods absent from the dict are left untouched, no KeyError
    assert "min_var" not in optimizations
