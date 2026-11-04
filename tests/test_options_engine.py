"""The engine interface and the frozen baseline (adaptive Phase 2, build step 1).

The baseline adapter must give the Finder's served answer exactly, and the golden file pins that answer, so any
change to a served baseline number, status, route, delta or work count fails here."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import pytest

from scripts.options_bench import engine as bench_engine
from scripts.options_bench import golden
from scripts.options_bench.cases import Case
from src.desk import options_engine as oe
from src.desk import options_math as om

REPO = Path(__file__).resolve().parent.parent
FLOATS = ("value", "delta", "bound")


def ctx(c: Case) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


@pytest.fixture(scope="module")
def frozen() -> dict:
    return json.loads(golden.GOLDEN.read_text())


@pytest.fixture(scope="module")
def today() -> dict:
    return golden.build()


def test_golden_covers_the_named_cases_r1_and_the_stratified_subset(frozen):
    ids = [r["case"]["id"] for r in frozen["rows"]]
    assert ids[:8] == ["named/DR-47", "named/DR-48", "named/DR-49", "named/DR-50", "named/B8", "named/B9a",
                       "named/B9b", "named/R-1"]
    assert len(ids) == len(set(ids)) == 8 + 300
    by_group = {}
    for r in frozen["rows"][8:]:
        by_group[r["case"]["group"]] = by_group.get(r["case"]["group"], 0) + 1
    assert by_group == golden.PER_GROUP
    g6 = [r["case"]["days"] for r in frozen["rows"] if r["case"]["group"] == "G6-long"]
    assert sum(d <= 1118 for d in g6) == sum(d > 1118 for d in g6) == 20
    routes = {(r["answer"]["route"], r["answer"]["price_status"]) for r in frozen["rows"]}
    assert routes >= {(oe.ROUTE_EXEMPT, oe.EXACT), (oe.ROUTE_BOUND, oe.OBSERVED), (oe.ROUTE_LATTICE, oe.OBSERVED),
                      (oe.ROUTE_LATTICE, oe.UNRESOLVED), (oe.ROUTE_NONE, oe.OUTSIDE)}


def test_baseline_matches_the_golden_file(frozen, today):
    """Statuses, routes, reasons and work exactly; floats to 1e-12 relative, which only allows last-digit libm
    differences between platforms (the in-process comparison below is exact)."""
    assert [r["case"] for r in today["rows"]] == [r["case"] for r in frozen["rows"]]
    for got, want in zip(today["rows"], frozen["rows"]):
        g, w = got["answer"], want["answer"]
        assert {k: v for k, v in g.items() if k not in FLOATS} == {k: v for k, v in w.items() if k not in FLOATS}, \
            got["case"]["id"]
        for k in FLOATS:
            if w[k] is None:
                assert g[k] is None, (got["case"]["id"], k)
            else:
                assert math.isclose(g[k], w[k], rel_tol=1e-12, abs_tol=1e-15), (got["case"]["id"], k, g[k], w[k])


def test_adapter_is_bit_identical_to_the_pricer_the_bench_scores(frozen):
    """The bench's engine.run calls options_finder.Pricer directly; the adapter must give the same numbers."""
    status = {oe.OUTSIDE: "refused:domain", oe.INPUT: "refused:dividends"}
    for row in frozen["rows"]:
        c = Case.from_json(row["case"])
        a = oe.baseline(ctx(c))
        b = bench_engine.run(str(REPO), c)
        if b["status"] == "served":
            assert a.priced and a.value == b["value"] and a.audit["model"] == b["model"], c.id
            assert a.delta == b["delta"] and a.delta_reason == b["delta_note"], c.id
            assert a.audit.get("bound") == b["bound"], c.id
        elif b["status"] == "refused:not-converged":
            assert a.price_status == oe.UNRESOLVED and a.reason == om.NOT_CONVERGED, c.id
        else:
            assert status[a.price_status] == b["status"] and a.reason == b["reason"], c.id
        assert a.units == b["units"], c.id


def test_r1_keeps_serving_the_european_value_below_intrinsic():
    """R-1: Tier 1 is unchanged. Its bound route serves the European value 9.99969863, 3.0e-4 below the exercise
    value 10; Tier 2 (options_adaptive) answers this case on its own analytic-interval route."""
    c = ctx(golden.R1)
    a = oe.baseline(c)
    assert a.route == oe.ROUTE_BOUND and a.price_status == oe.OBSERVED and a.estimate is None
    assert a.value == om.european(c)
    assert a.value == pytest.approx(9.99969863, abs=5e-9)
    assert 10.0 - a.value == pytest.approx(3.0137e-4, rel=1e-3)


def test_tier1_states_no_per_contract_estimate(frozen):
    for row in frozen["rows"][:40]:
        a = oe.baseline(ctx(Case.from_json(row["case"])))
        assert a.estimate is None and a.delta_estimate is None and a.engine == oe.ENGINE_BASELINE


def test_work_cap_is_an_unresolved_answer_not_an_error():
    c = ctx(Case.from_json(next(r["case"] for r in json.loads(golden.GOLDEN.read_text())["rows"]
                                if r["answer"]["route"] == oe.ROUTE_LATTICE)))
    a = oe.baseline(c, limit=1000)
    assert a.price_status == oe.UNRESOLVED and a.reason.startswith(oe.WORK_CAP) and a.value is None


def test_nothing_served_imports_the_new_engine_modules():
    """Phase 2 is unserved: no module under api/ (nor the Finder itself) imports the engine interface or the
    controller, so nothing the site serves can reach them."""
    pat = re.compile(r"\boptions_(engine|adaptive)\b")
    files = list((REPO / "api").rglob("*.py")) + [REPO / "src/desk/options_finder.py", REPO / "src/desk/options_math.py"]
    hits = [str(p.relative_to(REPO)) for p in files if pat.search(p.read_text())]
    assert files and hits == []
