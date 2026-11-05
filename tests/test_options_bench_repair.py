"""The bench repair before the dividend fix's fresh held-out (design B, Max's amendment of 2026-11-05 19:14 UTC).

Bench only (scripts/options_bench): the low-order refinement study no longer extrapolates, the IV round trip
records the Finder's work-cap refusal as a refusal, a QuantLib FD arbiter is run for QdFp comparisons outside the
reference's stated uncertainty, and the scorecard counts unresolved references by reason. Nothing here changes a
tolerance, a gate or the engine."""

from __future__ import annotations

import math
import os
from pathlib import Path

import pytest

from scripts.options_bench import cases, crosscheck, engine, reference, score

REPO = Path(__file__).resolve().parent.parent
ENGINE = os.environ.get("OPTIONS_BENCH_ENGINE_ROOT") or str(REPO)
needs_engine = pytest.mark.skipif(not (Path(ENGINE) / "src" / "desk" / "options_math.py").exists(),
                                  reason="no engine: src/desk/options_math.py is not on this branch")
needs_quantlib = pytest.mark.skipif(crosscheck.ql is None, reason="QuantLib is not installed")


def _case(**kw) -> cases.Case:
    base = {"id": "G1-nodiv/0", "group": "G1-nodiv", "kind": "random", "is_call": False, "spot": 100.0,
            "strike": 100.0, "days": 30, "rho": 0.03, "q": 0.0, "sigma": 0.3, "divs": [], "note": "", "expect": "",
            "expect_note": ""}
    return cases.Case.from_json(base | kw)


# ── item 2: a low-order study does not extrapolate ───────────────────────────

def _old_low_order_u(coarse, mid, fine):
    e21, e32 = fine - mid, mid - coarse
    order = math.log(e32 / e21) / math.log(2.0)
    return reference.GCI_FS3 * abs(e21 / (2.0 ** order - 1.0)), order


@pytest.mark.parametrize("levels", [
    (0.0, 1.56e-9, 2.85e-9),                       # rounding-level changes, order about 0.27 (G5-extreme-vol/670)
    tuple(1.0 + h ** 0.4 for h in (1.0, 0.5, 0.25)),   # a genuinely slow convergence, order 0.4
    (0.0, 0.03511112189345, 0.06011112189345),     # order 0.49, just under the test (Codex DR-B06's levels)
])
def test_a_low_order_study_keeps_its_estimate_without_extrapolating(levels):
    got = reference.gci(*levels, floor=1e-15)
    old_u, order = _old_low_order_u(*levels)
    assert order < reference.ORDER_MIN and got["kind"] == "low-order"
    assert got["corr"] == 0.0
    e = max(abs(levels[2] - levels[1]), abs(levels[1] - levels[0]))
    assert got["u"] == pytest.approx(max(old_u, reference.GCI_FS_WIDE * e), rel=1e-12)
    assert got["u"] >= old_u                        # never smaller for the same levels


def test_a_genuine_slow_convergence_stays_inside_the_low_order_estimate():
    # order 0.4 to a limit of 1: the finest level is h^0.4 away, the estimate must cover it uncorrected
    levels = tuple(1.0 + h ** 0.4 for h in (1.0, 0.5, 0.25))
    got = reference.gci(*levels, floor=1e-15)
    assert abs(levels[2] - 1.0) <= got["u"]


def test_the_other_kinds_are_unchanged():
    h = (1.0, 0.5, 0.25)
    second = reference.gci(*(1.0 + 3.0 * x * x for x in h), floor=1e-15)
    assert second["kind"] == "monotone" and second["corr"] == pytest.approx(-3.0 * 0.25 ** 2, rel=1e-9)
    assert reference.gci(1.0, 1.0 + 7.5e-3, 1.0 + 8.5e-3, 1e-15)["kind"] == "above-order"


def test_the_failing_european_control_is_inside_its_uncertainty_on_the_repaired_reference():
    # seed 20261117 G5-extreme-vol/670: the delta 8.6e-9 from Black-76 with u 8.0e-9 before the repair
    c = _case(id="G5-extreme-vol/670", group="G5-extreme-vol", strike=122.031192, days=19, rho=0.09403744,
              q=-0.01273185, sigma=0.00300935)
    eu = reference.reference(c, american=False)
    b76, b76_delta = crosscheck.black76_case(c)
    assert abs(eu["delta"]["ref"] - b76_delta) <= eu["delta"]["u"]
    assert abs(eu["value"]["ref"] - b76) <= eu["value"]["u"]


# ── item 3: the IV round trip and the work cap ───────────────────────────────

LONG = dict(id="G6-long/1840", group="G6-long", strike=113.336402, days=1074, rho=0.07627865, q=-0.02660107,
            sigma=0.08589296, divs=[[4, 1.8546], [34, 1.6439], [64, 0.9209], [94, 1.5212], [124, 1.9119],
                                    [154, 0.9902], [184, 1.828], [214, 1.4832], [244, 0.36], [274, 1.3482],
                                    [304, 1.1588], [334, 1.0], [364, 1.6461], [394, 1.9204], [424, 0.4466],
                                    [454, 0.3022]])


@needs_engine
def test_the_iv_solve_past_the_work_cap_is_a_refusal_not_a_crash():
    got = engine.iv_roundtrip(ENGINE, _case(**LONG), 20.87320370577336)   # its reference price
    assert got["status"] == "refused" and "Too much to price at once" in got["reason"]


@needs_engine
def test_any_other_exception_in_the_iv_solve_still_raises(monkeypatch):
    om, _ = engine.load(ENGINE)

    def boom(*a, **k):
        raise ValueError("not a refusal")

    monkeypatch.setattr(om, "drive", boom)
    with pytest.raises(ValueError, match="not a refusal"):
        engine.iv_roundtrip(ENGINE, _case(), 5.0)


def _rec(**iv):
    tol = reference.tolerance(10.0, 100.0)
    return {"case": {"id": "G6-long/1", "group": "G6-long", "kind": "random"},
            "engine": {"status": "served", "model": "m", "value": 10.0, "delta": -0.5, "units": 10, "secs": 0.1},
            "ref": {"value": {"ref": 10.0, "u": 1e-4, "status": "reliable", "tol": tol},
                    "delta": {"ref": -0.5, "u": 1e-5, "status": "reliable"}}} | ({"iv": iv} if iv else {})


def test_the_scorer_counts_an_iv_refusal_and_lists_it():
    out = score.classify(_rec(status="refused", reason="Too much to price at once"))
    assert out["iv_status"] == "refused" and "error" not in out
    s = score._summary([out])
    assert s["iv_roundtrip"]["status"] == {"refused": 1}
    assert s["iv_roundtrip"]["refused_ids"] == ["G6-long/1"] and s["errors"] == 0


# ── item 4: the QuantLib arbiter and its categories ──────────────────────────

def test_arbiter_selection_is_the_outside_u_rule():
    rv = {"ref": 10.0, "u": 1e-6, "status": "reliable"}
    q = lambda v, m="qdfp-high-precision": {"method": m, "value": v}
    assert score.arbiter_selected(q(10.0 + 2e-6), rv)
    assert not score.arbiter_selected(q(10.0 + 1e-6), rv)                  # exactly u: inside
    assert not score.arbiter_selected(q(10.0 + 2e-6, "fd-escrowed-3grid"), rv)
    assert not score.arbiter_selected(q(None), rv)
    assert not score.arbiter_selected(q(11.0), rv | {"status": "unresolved: x"})
    assert not score.arbiter_selected(q(11.0), rv | {"u": 0.0})
    assert not score.arbiter_selected(None, rv)


@pytest.mark.parametrize("ref, u, qdfp, arb, want", [
    (10.0, 0.1, 10.5, None, "unavailable"),
    (10.0, 0.1, 10.5, {"error": "RuntimeError: x"}, "unavailable"),
    (10.0, 0.1, 10.5, {"value": math.nan, "u": 0.1, "kind": "monotone"}, "unavailable"),
    (10.0, 0.1, 10.5, {"value": 10.0, "u": math.inf, "kind": "monotone"}, "unavailable"),
    (10.0, 0.1, 10.5, {"value": 10.0, "u": 0.1, "kind": "not-converging"}, "arbiter-unresolved"),
    (10.0, 0.1, 10.5, {"value": 10.0, "u": 0.1, "kind": "low-order"}, "arbiter-unresolved"),
    (10.0, 0.125, 10.5, {"value": 10.25, "u": 0.125, "kind": "monotone"}, "reference-consistent"),   # |A−R| = u + u_A
    (10.0, 0.125, 10.5, {"value": 10.375, "u": 0.125, "kind": "monotone"}, "qdfp-consistent-only"),  # |A−Q| = u_A
    (10.0, 0.125, 10.5, {"value": 10.3125, "u": 0.0625, "kind": "monotone"}, "neither"),
])
def test_every_selected_case_falls_in_exactly_one_category(ref, u, qdfp, arb, want):
    assert score.arbiter_category(ref, u, qdfp, arb) == want


def test_the_category_counts_sum_to_the_selected_cases():
    rows = []
    for k, arb in enumerate([None, {"value": 10.0, "u": 1e-6, "kind": "monotone"},
                             {"value": 10.0, "u": 1e-6, "kind": "oscillating"}]):
        r = _rec()
        r["case"] = r["case"] | {"id": f"G1-nodiv/{k}"}
        r["quantlib"] = {"method": "qdfp-high-precision", "value": 10.001}
        if arb:
            r["quantlib_arbiter"] = arb
        rows.append(score.classify(r))
    s = score._summary(rows)
    a = s["quantlib_arbiter"]
    assert a["selected"] == 3 == s["quantlib_coverage"]["outside_u"]
    assert sum(a["categories"].values()) == 3
    assert a["categories"]["unavailable"] == 1 and a["categories"]["reference-consistent"] == 2
    assert a["ids"]["unavailable"] == ["G1-nodiv/0"]


@needs_quantlib
def test_the_arbiter_reads_its_three_grids_with_the_reference_rule():
    c = _case(strike=110.0, days=90, rho=0.05, sigma=0.25)
    arb = crosscheck.quantlib_arbiter(c, day0=False)
    assert arb["method"] == "ql-fd-cn-3grid" and len(arb["levels"]) == 3 and "error" not in arb
    qd = crosscheck.quantlib(c)["value"]
    ref = reference.reference(c)["value"]
    assert abs(arb["value"] - qd) <= 0.01 * ref["tol"]
    g = reference.gci(*arb["levels"], 1e-12 * c.spot)
    assert (arb["u"], arb["kind"]) == (g["u"], g["kind"])


@needs_quantlib
def test_an_arbiter_failure_is_recorded_not_raised(monkeypatch):
    monkeypatch.setattr(crosscheck.ql, "FdBlackScholesVanillaEngine", None)
    got = crosscheck.quantlib_arbiter(_case(), day0=False)
    assert got["error"].startswith("TypeError")


# ── unresolved references by reason ──────────────────────────────────────────

def test_unresolved_reasons_are_counted_without_the_case_numbers():
    st = ("unresolved: convection-dominated: cell Péclet 1.25 on the coarsest space level (6000 intervals); "
          "value uncertainty above 0.1 of its tolerance")
    assert score.unresolved_reason(st) == ["convection-dominated (cell Péclet above 1 on the coarsest space level)",
                                           "value uncertainty above N of its tolerance"]
    assert score.unresolved_reason("reliable") == []
    rows = [score.classify(_rec() | {"ref": _rec()["ref"] | {"value": _rec()["ref"]["value"] | {"status": st}}})]
    s = score._summary(rows)
    assert s["unresolved_reasons"]["value"] == {
        "convection-dominated (cell Péclet above 1 on the coarsest space level)": 1,
        "value uncertainty above N of its tolerance": 1}
    assert s["unresolved_reasons"]["delta"] == {}
