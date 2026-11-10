"""Phase 3 dev calibration (scripts/options_bench/calibrate_p3.py): the bump-size choice rule (design 4.2, 8.5)."""

from __future__ import annotations

import math

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


# ── stage factors: F_G, F_h (P3-AM1 ordered search) and F_P, from stored levels ────────────────────────────────

def test_the_bumped_greeks_search_the_twelve_pairs_in_the_declared_order():
    got = K.factor_candidates(G.VEGA)
    assert len(got) == 12 and got[0] == (2.0, 4 / 3) and got[1] == (2.0, 2.0) and got[3] == (3.0, 4 / 3)
    assert got[-1] == (6.0, 3.0)
    assert K.factor_candidates(G.GAMMA) == [(2.0, None), (3.0, None), (4.0, None), (6.0, None)]


def _ans(status=G.RETURNED, reason=None, L1=1.0, L2=1.0, half=1.0, tol=0.01):
    return {"status": status, "reason": reason, "value": L2 if status == G.RETURNED else None, "estimate": 0.001,
            "audit": {"L1": L1, "L2": L2, "L2_half": half, "tol": tol}}


def test_rejudging_recomputes_the_estimate_and_only_moves_returned_or_estimate_withheld_answers():
    a = K.rejudge(_ans(L1=1.0 - 0.002, half=1.0 - 0.003), G.VEGA, 2.0, 4 / 3)
    assert a["status"] == G.RETURNED and math.isclose(a["estimate"], 2 * 0.002 + 4 / 3 * 0.003)
    a = K.rejudge(_ans(L1=1.0 - 0.002, half=1.0 - 0.003), G.VEGA, 3.0, 3.0)        # 0.006 + 0.009 > 0.01
    assert a["status"] == G.WITHHELD and a["reason"] == G.R_ESTIMATE and a["value"] is None
    back = K.rejudge(_ans(G.WITHHELD, G.R_ESTIMATE, L1=1.0 - 0.004), G.GAMMA, 2.0, None)
    assert back["status"] == G.RETURNED and back["value"] == 1.0 and math.isclose(back["estimate"], 0.008)
    assert K.rejudge(_ans(L1=1.0, half=1.0), G.GAMMA, 2.0, None)["estimate"] == G.FLOOR * 0.01   # the floor
    for st, why in ((G.WITHHELD, G.R_UNSTABLE), (G.WITHHELD, G.R_NEAR), (G.EXACT_EXEMPT, None)):
        a = _ans(st, why)
        assert K.rejudge(a, G.VEGA, 2.0, 4 / 3) is a


def _frec(i, group, value, ref, divs=()):
    a = _ans(L1=value, L2=value, half=value, tol=0.01)
    greeks = {g: dict(a) for g in G.GREEKS}
    return {"case": {"id": f"{group}/{i}", "group": group, "spot": 100.0, "days": 30, "divs": list(divs)},
            "in_domain": True, "greeks": greeks, "exact": {}, "bounds": [], "regions": {},
            "refs": {g: {"status": "resolved", "R": ref, "u": 1e-4, "tol": 0.01} for g in G.GREEKS}}


def test_the_first_factor_with_no_coverage_miss_in_any_group_is_frozen():
    # at the floor E_G = 0.001; an error of 0.0015 misses until the factor lifts the estimate (L2 − L1 = 0.0005)
    recs = [_frec(0, "G1-nodiv", 1.0, 1.0), _frec(1, "G2-dividends", 1.0, 1.0 + 0.0015)]
    for r in recs:
        for g in G.GREEKS:
            r["greeks"][g]["audit"]["L1"] = 1.0 - 0.0005 if r["case"]["group"] == "G2-dividends" else 1.0
    got = K.choose_factors(recs)[G.GAMMA]
    assert [c["qualifies"] for c in got["candidates"]] == [False, False, True, True]   # 2·5e-4, 3·5e-4 < 1.5e-3
    assert got["chosen"] == {"F_G": 4.0, "F_h": None}


def test_f_p_allows_the_reference_uncertainty_where_the_two_levels_agree_exactly():
    rec = {"case": {"id": "T1/0", "group": "T1"}, "cross_check": {"L1": 5.0, "L2": 5.0},
           "refs": {"price": {"status": "resolved", "R": 5.0 + 1e-12, "u": 2e-4, "tol": 0.01}}}
    assert K.choose_f_p([rec])["chosen"] == 2.0
    far = {"case": {"id": "T1/1", "group": "T1"}, "cross_check": {"L1": 5.0, "L2": 5.0},
           "refs": {"price": {"status": "resolved", "R": 5.001, "u": 2e-4, "tol": 0.01}}}
    assert K.choose_f_p([rec, far])["chosen"] is None
