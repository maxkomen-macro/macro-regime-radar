"""One computation per horizon for the regime transition outlook (fix/site-audit D2).

The Dashboard's "Next 3 months" row printed "highest-risk path → Stagflation
20%" from the served `highest_risk_prob`; the Regime Lab sidebar's "Next 6
months" row printed "→ Stagflation 25%" from a second derivation in the
browser (the first row of `transitions_6m`, and the stay as 100 minus its
exits). Both figures are right for their horizon (the hand-set 3- and 6-month
priors); the defect was two computations behind one phrase. The server now
computes each horizon's stay and highest-risk path with one function and the
web prints both rows through one helper (web/src/screens/shared/transition-outlook.ts).
"""

from __future__ import annotations

import sqlite3

import pytest

from src.analytics import intelligence


@pytest.fixture
def priors(monkeypatch):
    """No stored history: get_transition_narrative serves the hand-set tables."""

    def conn():
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE regimes (date TEXT, label TEXT)")
        return c

    monkeypatch.setattr(intelligence, "_get_conn", conn)


def test_overheating_reads_20_at_3_months_and_25_at_6_months(priors):
    out = intelligence.get_transition_narrative("Overheating")
    assert (out["stay_probability_3m"], out["highest_risk_transition"], out["highest_risk_prob"]) == (55, "Stagflation", 20)
    assert (out["stay_probability_6m"], out["highest_risk_6m_transition"], out["highest_risk_6m_prob"]) == (40, "Stagflation", 25)


@pytest.mark.parametrize("regime", list(intelligence.REGIME_BASE_RATES))
def test_each_horizon_serves_its_own_stay_and_path_from_one_rule(priors, regime):
    out = intelligence.get_transition_narrative(regime)
    for h, rows, table in (("3m", out["transitions_3m"], intelligence._FALLBACK_TRANSITIONS_3M),
                           ("6m", out["transitions_6m"], intelligence._FALLBACK_TRANSITIONS_6M)):
        top = max(rows, key=lambda r: r["probability"])
        suffix = "" if h == "3m" else "_6m"
        assert out[f"highest_risk{suffix}_transition"] == top["to"]
        assert out[f"highest_risk{suffix}_prob"] == top["probability"]
        assert out[f"highest_risk{suffix}_color"] == top["color"]
        assert out[f"stay_probability_{h}"] == table[regime][regime]
        # The stay and the exits are one row of one table: they sum to 100.
        assert out[f"stay_probability_{h}"] + sum(r["probability"] for r in rows) == 100


def test_the_api_model_carries_the_6_month_fields(priors):
    from api.main import TransitionOutlook

    served = TransitionOutlook(**intelligence.get_transition_narrative("Overheating")).model_dump()
    assert served["stay_probability_6m"] == 40
    assert served["highest_risk_6m_transition"] == "Stagflation"
    assert served["highest_risk_6m_prob"] == 25
