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
