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


def _grow(group, ref, cands):
    """cands: {(m_frac, p_frac): (units, v2 or a refusal reason)}."""
    rows = []
    for (mf, pf), (units, v) in cands.items():
        row = {"m_frac": mf, "p_frac": pf, "units": units}
        if isinstance(v, str):
            row["refused"] = v
        else:
            row.update(v1=v, v2=v)
        rows.append(row)
    return {"case": f"{group}/x", "group": group, "ref": ref, "cands": rows}


REF = {"status": "resolved", "R": 10.0, "u": 0.001, "tol": 0.01}


def test_the_cheapest_grid_agreeing_in_every_group_is_chosen():
    rows = [_grow(g, REF, {(0.125, 0.25): (1, 10.0 + 0.2 * 0.01), (0.25, 0.25): (2, 10.0 + 0.05 * 0.01),
                           (0.5, 0.5): (8, 10.0)}) for g in ("G1", "G2")]
    got = K.choose_grid(rows)
    assert got["chosen"] == {"m_frac": 0.25, "p_frac": 0.25}
    assert [c["qualifies"] for c in got["candidates"]] == [False, True, True]


def test_one_group_below_99_percent_or_one_confirmed_failure_disqualifies_a_grid():
    good = [_grow("G1", REF, {(0.25, 0.25): (1, 10.0), (0.5, 0.5): (4, 10.0)}) for _ in range(99)]
    near = _grow("G1", REF, {(0.25, 0.25): (1, 10.0 + 0.5 * 0.01), (0.5, 0.5): (4, 10.0)})   # 1 in 100: fine
    assert K.choose_grid(good + [near])["chosen"] == {"m_frac": 0.25, "p_frac": 0.25}
    bad = _grow("G2", REF, {(0.25, 0.25): (1, 10.0 + 1.2 * 0.01), (0.5, 0.5): (4, 10.0)})     # beyond tol + u
    got = K.choose_grid(good + [near, bad])
    assert got["chosen"] == {"m_frac": 0.5, "p_frac": 0.5}
    assert got["candidates"][0]["groups"]["G2"]["failures"] == ["G2/x"]


def test_an_fd_refusal_counts_as_not_agreeing_and_unresolved_references_are_not_counted():
    rows = [_grow("G1", REF, {(0.25, 0.25): (1, "grid not monotone"), (0.5, 0.5): (4, 10.0)}),
            _grow("G1", dict(REF, status="unresolved: x"), {(0.25, 0.25): (1, 99.0), (0.5, 0.5): (4, 99.0)})]
    got = K.choose_grid(rows)
    assert got["chosen"] == {"m_frac": 0.5, "p_frac": 0.5}
    g = got["candidates"][0]["groups"]["G1"]
    assert g["resolved"] == 1 and g["refused"] == 1 and g["agree"] == 0


def test_no_qualifying_grid_leaves_the_choice_empty():
    assert K.choose_grid([_grow("G1", REF, {(0.25, 0.25): (1, 11.0)})])["chosen"] is None
