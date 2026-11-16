"""The Tier 2 accuracy check on the Options Finder's picks (src/desk/options_check.py; candidate A).

The check must leave every Tier 1 number the Finder serves unchanged, serve exactly the frozen Tier 2 answer
(adaptive-p2.1 under Phase 2 attempt 2's configuration), state agreement by the approved positive-control rule,
stay inside its own work budget and never fail a scan. Chains are synthetic (tests/options_synth.py)."""

from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

import pytest

from scripts.options_bench import golden
from scripts.options_bench import tier2_golden
from src.desk import options_adaptive as oa
from src.desk import options_check as ock
from src.desk import options_engine as oe
from src.desk import options_finder as of
from src.desk import options_math as om
from tests import options_synth as syn

REPO = Path(__file__).resolve().parent.parent
BY = date(2026, 12, 18)
FLOATS = ("value", "estimate", "delta", "delta_estimate")


def _without_check(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "engine_check"}


class Recorder:
    """A check that records what the Finder handed it and returns the real check's answer."""

    def __init__(self, inner=ock.check):
        self.inner = inner
        self.picks = None

    def __call__(self, picks):
        self.picks = list(picks)
        return self.inner(picks)


@pytest.fixture(scope="module")
def scans() -> dict:
    out = {}
    for view, target in (("up", 120.0), ("down", 85.0)):
        rec = Recorder()
        out[view] = (syn.scan(view, target, BY), syn.scan(view, target, BY, check=rec), rec)
    return out


# ── the configuration and the frozen numbers ─────────────────────────────────

def test_the_check_uses_the_configuration_frozen_for_attempt_2():
    freeze = json.loads((REPO / "scripts/options_bench/calibration/phase2-freeze-2.json").read_text())
    from dataclasses import asdict
    assert asdict(ock.FROZEN) == freeze["config"]
    assert freeze["engine_version"] == ock.EVIDENCE["engine_version"] == "adaptive-p2.1"
    assert ock.FROZEN != oa.Config()   # the module's default is not the evaluated configuration


def test_tier2_answers_match_the_frozen_golden_file():
    """Statuses, routes, reasons and work exactly; floats to 1e-12 relative, allowing only last-digit libm
    differences between platforms (the file was written from ef7d784's code and was bit-identical to main's)."""
    want = json.loads(tier2_golden.GOLDEN.read_text())
    got = tier2_golden.build()
    assert [r["id"] for r in got["rows"]] == [r["id"] for r in want["rows"]] == [c.id for c in golden.golden_cases()]
    for g, w in zip(got["rows"], want["rows"]):
        ga, wa = g["answer"], w["answer"]
        assert {k: v for k, v in ga.items() if k not in FLOATS} == {k: v for k, v in wa.items() if k not in FLOATS}, g["id"]
        for k in FLOATS:
            if wa[k] is None:
                assert ga[k] is None, (g["id"], k)
            else:
                assert math.isclose(ga[k], wa[k], rel_tol=1e-12, abs_tol=1e-15), (g["id"], k, ga[k], wa[k])


def test_the_golden_file_covers_every_tier2_route():
    rows = json.loads(tier2_golden.GOLDEN.read_text())["rows"]
    seen = {(r["answer"]["route"], r["answer"]["price_status"]) for r in rows}
    assert seen >= {(oe.ROUTE_EXEMPT, oe.EXACT), (oe.ROUTE_ANALYTIC, oe.ANALYTIC), (oe.ROUTE_LATTICE, oe.ESTIMATED),
                    (oe.ROUTE_LATTICE, oe.UNRESOLVED), (oe.ROUTE_NONE, oe.OUTSIDE)}


# ── Tier 1 unchanged ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("view", ["up", "down"])
def test_with_the_check_every_tier1_field_is_unchanged(scans, view):
    off, on, _ = scans[view]
    assert "engine_check" not in off
    assert "engine_check" in on
    assert _without_check(on) == off
    assert on["work"] == off["work"]   # the check's work is its own, never charged to the scan


@pytest.mark.parametrize("view", ["up", "down"])
def test_the_check_reprices_each_pick_s_session_context_exactly(scans, view):
    off, on, rec = scans[view]
    picks = [c for c in dict.fromkeys(off["picks"][lens] for lens in of.LENSES) if c]
    assert picks and [p["contract"] for p in rec.picks] == [off["picks"][l] for l in of.LENSES if off["picks"][l]]
    rows = {r["contract"]: r for r in off["rows"]}
    block = on["engine_check"]
    assert [r["contract"] for r in block["picks"]] == picks
    for p, r in zip([p for p in rec.picks if p["contract"] in picks], block["picks"]):
        c = p["context"]
        assert c.sigma == rows[p["contract"]]["iv"] and c.spot == syn.S0
        want = ock._tier2(oa.price(c, ock.FROZEN))
        assert r["tier2"] == want and r["status"] == ock.CHECKED
        assert r["tier1"]["delta"] == rows[p["contract"]]["delta"]
    assert block["config"] == {"estimator": "envelope", "schedule": "multiples", "F": 3.0, "F_d": 2.0, "tau": 1.0,
                               "force_lattice": False}
    assert block["role"] == ock.ROLE and block["evidence"]["freeze"] == "ef7d784"


@pytest.mark.parametrize("view", ["up", "down"])
def test_tier1_s_value_is_the_session_value_the_iv_was_solved_to(scans, view):
    """Tier 1's value of the session context is the pricer's own; at the solved volatility it reprices the mid."""
    off, on, rec = scans[view]
    rows = {r["contract"]: r for r in off["rows"]}
    for p in rec.picks:
        tol = om.tolerance(p["value"], syn.S0)
        assert abs(p["value"] - rows[p["contract"]]["mid"]) <= tol, p["contract"]


@pytest.mark.parametrize("view", ["up", "down"])
def test_on_synthetic_chains_the_engines_agree(scans, view):
    _, on, _ = scans[view]
    for r in on["engine_check"]["picks"]:
        assert r["agree"] is True, r
        assert r["delta_agree"] in (True, None), r


def test_a_contract_that_is_several_lenses_pick_is_priced_once():
    c = om.Context(True, 100.0, 105.0, 90, 0.04, 0.0, 0.3, ((45, 0.5),))
    v = oe.baseline(c)
    got = ock.check([{"lens": "payoff", "contract": "X", "context": c, "value": v.value, "delta": v.delta},
                     {"lens": "time", "contract": "X", "context": c, "value": v.value, "delta": v.delta}])
    assert len(got["picks"]) == 1 and got["picks"][0]["lenses"] == ["payoff", "time"]
    assert got["work"]["used"] == got["picks"][0]["tier2"]["units"]


# ── the agreement rule ───────────────────────────────────────────────────────

def _answer(value, estimate, status=oe.ESTIMATED, delta=None, delta_estimate=None):
    return oe.Answer(engine="adaptive", version=oa.VERSION, route=oe.ROUTE_LATTICE, price_status=status, value=value,
                     estimate=estimate, delta_status=oe.SERVED if delta is not None else oe.WITHHELD, delta=delta,
                     delta_estimate=delta_estimate)


def test_agreement_is_within_the_sum_of_the_stated_accuracies():
    v1, spot = 5.0, 100.0
    tol = om.tolerance(v1, spot)
    e2 = 0.001
    edge = e2 + tol
    assert ock.agreement(_answer(v1 + edge * (1 - 1e-9), e2), v1, None, spot)["agree"] is True
    assert ock.agreement(_answer(v1 - edge * (1 - 1e-9), e2), v1, None, spot)["agree"] is True
    assert ock.agreement(_answer(v1 + edge * (1 + 1e-6), e2), v1, None, spot)["agree"] is False
    assert ock.agreement(_answer(v1 - edge * (1 + 1e-6), e2), v1, None, spot)["agree"] is False
    got = ock.agreement(_answer(v1, e2), v1, None, spot)
    assert got["allowed"] == edge and got["difference"] == 0.0 and got["delta_agree"] is None


def test_an_exact_tier2_value_states_no_error_of_its_own():
    v1, spot = 5.0, 100.0
    got = ock.agreement(_answer(v1 + 0.5 * om.tolerance(v1, spot), None, status=oe.EXACT), v1, None, spot)
    assert got["allowed"] == om.tolerance(v1, spot) and got["agree"] is True


def test_delta_agreement_needs_both_deltas_and_uses_the_delta_tolerance():
    v1, spot, d1 = 5.0, 100.0, 0.40
    de2 = 2.5e-4
    edge = de2 + om.DELTA_TOL
    assert ock.agreement(_answer(v1, 0.001, delta=d1 + edge * (1 - 1e-9), delta_estimate=de2), v1, d1, spot)["delta_agree"] is True
    assert ock.agreement(_answer(v1, 0.001, delta=d1 - edge * (1 + 1e-6), delta_estimate=de2), v1, d1, spot)["delta_agree"] is False
    assert ock.agreement(_answer(v1, 0.001, delta=d1, delta_estimate=de2), v1, None, spot)["delta_agree"] is None
    assert ock.agreement(_answer(v1, 0.001), v1, d1, spot)["delta_agree"] is None


def test_an_unpriced_tier2_answer_states_no_agreement():
    got = ock.agreement(_answer(None, None, status=oe.UNRESOLVED), 5.0, 0.4, 100.0)
    assert got == ock.NO_AGREEMENT


# ── work, refusals and failures ──────────────────────────────────────────────

LONG = om.Context(False, 100.0, 115.0, 1000, 0.042, 0.0, 0.28, ((45, 0.6), (136, 0.6)))


def test_a_pick_past_the_check_budget_is_not_checked_and_carries_no_value():
    v = oe.baseline(LONG)
    got = ock.check([{"lens": "payoff", "contract": "L", "context": LONG, "value": v.value, "delta": v.delta}],
                    limit=1_000_000)
    r = got["picks"][0]
    assert r["status"] == ock.NOT_CHECKED and r["reason"] == ock.WORK_LIMIT_REASON
    assert r["tier2"] is None and r["agree"] is None
    assert got["work"]["used"] <= got["work"]["limit"] == 1_000_000


def test_the_budget_is_shared_across_picks_in_lens_order():
    full = oa.price(LONG, ock.FROZEN).units
    v = oe.baseline(LONG)
    p = {"context": LONG, "value": v.value, "delta": v.delta}
    got = ock.check([{"lens": "payoff", "contract": "A", **p}, {"lens": "forgiving", "contract": "B", **p}],
                    limit=full + full // 2)
    a, b = got["picks"]
    assert a["status"] == ock.CHECKED and a["tier2"]["units"] == full
    assert b["status"] == ock.NOT_CHECKED and b["reason"] == ock.WORK_LIMIT_REASON
    assert got["work"]["used"] <= got["work"]["limit"]


def test_the_reserve_covers_tier2_s_work_before_its_first_level():
    """The reserve must be at least the work Tier 2 reports less the lattice levels it computed, on every golden
    context, so a solve that starts cannot pass the budget through its closed-form and bound work."""
    worst = 0
    for case in golden.golden_cases():
        c = om.Context(case.is_call, case.spot, case.strike, case.days, case.rho, case.q, case.sigma, tuple(case.divs))
        lattice = [0]

        def level(cx, m, _l=lattice):
            lv = oa.lattice_level(cx, m)
            _l[0] += lv.units
            return lv

        a = oa.price(c, ock.FROZEN, level)
        pre = int(a.units) - lattice[0]
        assert 0 <= pre <= ock.prelattice_reserve(c), c
        worst = max(worst, pre)
    assert worst > 0   # the bound route ran somewhere, so the comparison is not vacuous


def test_no_solve_starts_when_the_budget_left_cannot_cover_its_reserve(monkeypatch):
    calls = []
    real = oa.price
    monkeypatch.setattr(oa, "price", lambda *a, **k: calls.append(1) or real(*a, **k))
    c = om.Context(True, 100.0, 105.0, 90, 0.04, 0.0, 0.3)
    picks = [{"lens": lens, "contract": f"C{i}", "context": c, "value": 3.0, "delta": 0.5}
             for i, lens in enumerate(of.LENSES)]
    got = ock.check(picks, limit=ock.prelattice_reserve(c) - 1)
    assert calls == []
    assert [r["reason"] for r in got["picks"]] == [ock.WORK_LIMIT_REASON] * len(picks)
    assert got["work"]["used"] == 0


@pytest.mark.parametrize("limit", [0, 150, 60_000, 1_000_000, 5_000_000, 20_000_000])
def test_the_work_used_never_passes_the_limit(limit, monkeypatch):
    seen = []
    real = oa.lattice_level
    monkeypatch.setattr(oa, "lattice_level", lambda cx, m: seen.append(oa.units(om.steps_for(cx.days) * m)) or real(cx, m))
    short = om.Context(True, 100.0, 105.0, 90, 0.04, 0.0, 0.3)
    v = oe.baseline(LONG)
    picks = [{"lens": "payoff", "contract": "L", "context": LONG, "value": v.value, "delta": v.delta},
             {"lens": "forgiving", "contract": "S", "context": short, "value": 3.0, "delta": 0.5},
             {"lens": "time", "contract": "L2", "context": LONG, "value": v.value, "delta": v.delta}]
    got = ock.check(picks, limit=limit)
    assert got["work"]["used"] <= limit
    assert sum(seen) <= limit   # the lattice work actually computed, not only the work reported
    for r in got["picks"]:
        assert (r["status"] == ock.CHECKED) == (r["tier2"] is not None)


def test_a_failure_inside_tier2_is_that_pick_s_answer_and_is_logged(monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("synthetic failure")
    monkeypatch.setattr(oa, "price", boom)
    c = om.Context(True, 100.0, 105.0, 90, 0.04, 0.0, 0.3)
    with caplog.at_level("WARNING", logger="mrr.desk"):
        got = ock.check([{"lens": "payoff", "contract": "X", "context": c, "value": 3.0, "delta": 0.5}])
    r = got["picks"][0]
    assert r["status"] == ock.NOT_CHECKED and r["reason"] == "error (RuntimeError)" and r["tier2"] is None
    assert any("Tier 2 check failed" in m for m in caplog.messages)


def test_a_check_that_raises_never_fails_the_scan():
    def broken(picks):
        raise ValueError("synthetic")
    off = syn.scan("up", 120.0, BY)
    on = syn.scan("up", 120.0, BY, check=broken)
    assert _without_check(on) == off
    assert on["engine_check"] == {"error": "not checked: error (ValueError)", "picks": []}


def test_the_block_is_json_and_finite(scans):
    _, on, _ = scans["up"]
    text = json.dumps(on["engine_check"], allow_nan=False)
    assert json.loads(text) == on["engine_check"]


def test_tier2_statuses_pass_through_with_their_reasons():
    outside = om.Context(True, 100.0, 105.0, 90, 0.04, 0.0, 9.0)   # far outside the validated volatility range
    a = oa.price(outside, ock.FROZEN)
    got = ock.check([{"lens": "payoff", "contract": "O", "context": outside, "value": 1.0, "delta": None}])
    r = got["picks"][0]
    assert r["status"] == ock.CHECKED and r["tier2"]["price_status"] == a.price_status
    assert r["tier2"]["reason"] == a.reason
    if not a.priced:
        assert r["agree"] is None


# ── what serves it ───────────────────────────────────────────────────────────

def test_the_route_switch_is_off_unless_set(monkeypatch):
    from api import desk_options
    monkeypatch.delenv(desk_options.CHECK_ENV, raising=False)
    assert desk_options.engine_check() is None
    for v in ("0", "", "off", "no"):
        monkeypatch.setenv(desk_options.CHECK_ENV, v)
        assert desk_options.engine_check() is None
    for v in ("1", "true", "on", "yes", " ON "):
        monkeypatch.setenv(desk_options.CHECK_ENV, v)
        assert desk_options.engine_check() is ock.check


def test_only_the_finder_route_reaches_tier2_and_only_through_the_check():
    """Tier 2 is reached from api/ only by api/desk_options.py, only through src/desk/options_check.py, and only
    inside the switch's function (a lazy import); the Finder engine and the shared math never import it."""
    import re
    tier2 = re.compile(r"\boptions_(engine|adaptive)\b")
    check = re.compile(r"\boptions_check\b")
    api_files = list((REPO / "api").rglob("*.py"))
    assert api_files and [p for p in api_files if tier2.search(p.read_text())] == []
    users = [str(p.relative_to(REPO)) for p in api_files if check.search(p.read_text())]
    assert users == ["api/desk_options.py"]
    src = (REPO / "api/desk_options.py").read_text()
    body = src.split("def engine_check():", 1)[1].split("\ndef ", 1)[0]
    assert "from src.desk import options_check" in body
    assert src.count("options_check") == body.count("options_check")   # no import outside the switch
    for f in ("src/desk/options_finder.py", "src/desk/options_math.py"):
        text = (REPO / f).read_text()
        assert not tier2.search(text) and not check.search(text), f


def test_importing_the_app_or_the_finder_loads_no_tier2_module():
    import subprocess
    code = ("import sys; import api.main, api.desk_options, src.desk.options_finder; "
            "print(sorted(m for m in sys.modules if m.endswith(('options_adaptive', 'options_engine', 'options_check'))))")
    out = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]"
