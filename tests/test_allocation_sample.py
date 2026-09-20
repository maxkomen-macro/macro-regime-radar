"""Exact regime sample accounting (src/analytics/allocation.regime_sample_detail):
total regime months, complete aligned months, excluded months and the assets
responsible — the numbers the optimizer gate actually sees."""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.analytics.allocation import _regime_month_counts, regime_sample_detail


def _frame():
    idx = pd.date_range("2020-01-31", periods=30, freq="ME")
    rng = np.random.default_rng(0)
    df = pd.DataFrame(rng.normal(0, 0.02, size=(30, 3)), index=idx, columns=["SPY", "TLT", "BTC"])
    df.loc[idx[:6], "BTC"] = np.nan  # BTC history starts six months in
    df.loc[idx[10], "TLT"] = np.nan  # one isolated gap
    regimes = pd.DataFrame({"regime": ["Goldilocks"] * 28 + ["Overheating"] * 2}, index=idx)
    return df, regimes


def test_detail_matches_gate_counts():
    df, regimes = _frame()
    d = regime_sample_detail(df, regimes, "Goldilocks")
    stats, cov = _regime_month_counts(df, regimes, "Goldilocks")
    assert d["total_regime_months"] == stats == 28
    assert d["complete_months"] == cov == 21
    assert d["excluded_months"] == 7
    assert d["assets_total"] == 3
    assert d["assets_responsible"] == [{"asset": "BTC", "missing_months": 6}, {"asset": "TLT", "missing_months": 1}]
    assert d["required_cov_months"] == 24 and d["cov_ok"] is False and d["stats_ok"] is True
    assert d["sentence"] == "21 of 28 Goldilocks months have complete returns across all three assets; 24 are required."
    assert d["excluded_range"] == "2020-01 → 2020-11" and d["complete_range"] == "2020-07 → 2022-04"


def test_detail_for_regime_with_no_months():
    df, regimes = _frame()
    d = regime_sample_detail(df, regimes, "Stagflation")
    assert d["total_regime_months"] == 0 and d["complete_months"] == 0 and d["assets_responsible"] == []
    assert d["excluded_range"] is None and d["complete_range"] is None


# ── N-B2: the adaptive universe ───────────────────────────────────────────────
#
# The optimizers need every asset present in every month they fit on. With all
# ten that block starts Feb 2010, because High Yield and Commodities have no
# returns before 2007, so Goldilocks (28 months, 21 complete) never cleared the
# 24-month bar and no weights were ever produced. The adaptive pass drops the
# assets whose gaps cost the months, and says which ones it dropped.

from src.analytics.allocation import (  # noqa: E402
    MIN_OPTIMIZER_ASSETS,
    MIN_OPTIMIZER_MONTHS,
    adaptive_regime_block,
    get_regime_conditional_covariance,
    regime_frame,
)


def _ten_asset_frame(n_regime_months: int = 28, missing_head: int = 7):
    """Production's shape: ten assets, two with no history before month
    `missing_head`, one with a single isolated gap."""
    idx = pd.date_range("2020-01-31", periods=n_regime_months + 2, freq="ME")
    rng = np.random.default_rng(7)
    cols = [f"Asset {i}" for i in range(8)] + ["High Yield", "Commodities"]
    df = pd.DataFrame(rng.normal(0.004, 0.02, size=(len(idx), 10)), index=idx, columns=cols)
    df.loc[idx[:missing_head], ["High Yield", "Commodities"]] = np.nan
    df.loc[idx[missing_head + 2], "Asset 3"] = np.nan
    regimes = pd.DataFrame({"regime": ["Goldilocks"] * n_regime_months + ["Overheating"] * 2}, index=idx)
    return df, regimes


def test_the_block_drops_the_assets_whose_gaps_cost_the_months():
    df, regimes = _ten_asset_frame()
    sub = regime_frame(df, regimes, "Goldilocks")
    assert len(sub.dropna()) == 20  # the full ten never reach 24
    u = adaptive_regime_block(sub)
    assert u["ok"] is True and u["lowered"] is False
    assert u["months_used"] == 27 and u["required_months"] == 24
    assert [e["asset"] for e in u["excluded"]] == ["High Yield", "Commodities"]
    assert all(e["missing_months"] == 7 for e in u["excluded"])
    assert u["included"] == [f"Asset {i}" for i in range(8)]
    assert u["assets_total"] == 10 and len(u["block"].columns) == 8
    assert u["sentence"] == (
        "Optimized over 8 of 10 asset classes on 27 complete months. High Yield and Commodities are "
        "excluded: no return in 7 of the 28 regime months."
    )


def test_when_dropping_cannot_reach_the_bar_the_universe_is_kept_and_the_bar_drops():
    """Excluding an asset is only justified when it buys the bar. Here it never
    does, so all ten stay in and the sample is stated as the shorter one."""
    df, regimes = _ten_asset_frame(n_regime_months=20, missing_head=2)
    sub = regime_frame(df, regimes, "Goldilocks")
    u = adaptive_regime_block(sub)
    assert u["ok"] is True and u["lowered"] is True and u["excluded"] == []
    assert u["months_used"] == 17 and u["required_months"] == 17 and u["standard_months"] == 24
    assert u["sentence"] == (
        "Optimized over all 10 asset classes on 17 complete months, fewer than the 24 usually required."
    )


def test_a_regime_too_short_for_any_universe_stays_blocked():
    df, regimes = _ten_asset_frame(n_regime_months=9, missing_head=2)
    sub = regime_frame(df, regimes, "Goldilocks")
    u = adaptive_regime_block(sub)
    assert u["ok"] is False and u["months_used"] < MIN_OPTIMIZER_MONTHS
    assert MIN_OPTIMIZER_ASSETS == 4 and MIN_OPTIMIZER_MONTHS == 12


def test_the_covariance_matrix_is_the_adaptive_universe():
    df, regimes = _ten_asset_frame()
    covs = get_regime_conditional_covariance(df, regimes)
    assert "Goldilocks" in covs  # it never was before
    assert list(covs["Goldilocks"].index) == [f"Asset {i}" for i in range(8)]
    assert "High Yield" not in covs["Goldilocks"].index
