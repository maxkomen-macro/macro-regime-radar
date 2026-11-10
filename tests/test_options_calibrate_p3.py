"""Phase 3 dev calibration (scripts/options_bench/calibrate_p3.py): the bump-size choice rule (design 4.2, 8.5)."""

from __future__ import annotations

import pytest

from scripts.options_bench import calibrate_p3 as K
from src.desk import options_greeks as G


def _row(group, per_greek):
    """per_greek: {greek: [(status, reason) for each candidate, largest first]}."""
    return {"case": "x", "group": group,
            "rows": {g: [{"status": s, "reason": r} for s, r in v] for g, v in per_greek.items()}}


OK = (G.RETURNED, None)
EST = (G.WITHHELD, G.R_ESTIMATE)
UNST = (G.WITHHELD, G.R_UNSTABLE)
NEAR = (G.WITHHELD, G.R_NEAR)


def test_the_smallest_candidate_meeting_95_percent_is_chosen():
    rows = [_row("G1", {G.VEGA: [OK, OK, OK]}) for _ in range(19)] + [_row("G1", {G.VEGA: [OK, OK, UNST]})]
    got = K.choose_bumps(rows)[G.VEGA]
    assert [p["share"] for p in got["candidates"]] == [1.0, 1.0, 0.95]
    assert got["chosen"] == K.CANDIDATES[G.VEGA][1][2]                # 0.95 meets the rule exactly


def test_a_candidate_below_95_percent_is_not_chosen():
    rows = [_row("G1", {G.RHO: [OK, OK, OK]}) for _ in range(18)] + [_row("G1", {G.RHO: [OK, UNST, UNST]})] * 2
    got = K.choose_bumps(rows)[G.RHO]
    assert got["chosen"] == K.CANDIDATES[G.RHO][1][0]


def test_an_estimate_withholding_reaches_rule_3_and_passes_it_but_earlier_withholdings_do_not_count():
    rows = [_row("G2", {G.DIVIDEND: [EST, EST, EST]}), _row("G2", {G.DIVIDEND: [NEAR, NEAR, NEAR]}),
            _row("G2", {G.DIVIDEND: [(G.EXACT_EXEMPT, None)] * 3})]
    got = K.choose_bumps(rows)[G.DIVIDEND]
    for p in got["candidates"]:
        assert p["reached"] == 1 and p["passed"] == 1
        assert p["not_reached"] == {G.R_NEAR: 1, G.EXACT_EXEMPT: 1}


def test_no_candidate_meeting_the_rule_leaves_the_choice_empty():
    rows = [_row("G5", {G.VEGA: [UNST, UNST, UNST]})]
    assert K.choose_bumps(rows)[G.VEGA]["chosen"] is None


def test_calibration_refuses_any_seed_but_the_development_seed(tmp_path):
    with pytest.raises(SystemExit):
        K.main(["bumps", "--seed", "20261111", "--out", str(tmp_path)])
