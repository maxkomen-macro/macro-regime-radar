"""Phase 4a's registered population (docs/desk/OPTIONS_PHASE4A.md, section 1): the registration record matches the
generator, the reserved seed stays untouched, and a request depends only on (seed, index)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.options_bench.phase4a import population as pop

REPO = Path(__file__).resolve().parent.parent
REG = json.loads((REPO / "scripts" / "options_bench" / "phase4a" / "registration.json").read_text())


def test_the_registration_record_is_the_generator_s_spec_seeds_and_code():
    now = pop.registration()
    assert REG["spec"] == json.loads(json.dumps(pop.SPEC))
    assert REG["spec_sha256"] == now["spec_sha256"]
    assert REG["generator_sha256"] == hashlib.sha256(Path(pop.__file__).read_bytes()).hexdigest()
    assert (REG["dev_seed"], REG["reserved_seed"]) == (pop.DEV_SEED, pop.RESERVED_SEED) == (20261116, 20261117)


def test_the_reserved_population_is_never_generated_by_default():
    with pytest.raises(PermissionError):
        pop.request(pop.RESERVED_SEED, 0)
    with pytest.raises(PermissionError):
        next(pop.requests(pop.RESERVED_SEED, 1))


def test_a_request_depends_only_on_its_seed_and_index():
    a = pop.request(pop.DEV_SEED, 3)
    b = next(r for i, r in enumerate(pop.requests(pop.DEV_SEED, 4)) if i == 3)
    assert a.params == b.params
    assert a.rows == b.rows and a.other_rows == b.other_rows and a.dividends == b.dividends


def test_the_requests_are_synthetic_and_well_formed():
    r = pop.request(pop.DEV_SEED, 0)
    assert r.rows and all(row["contract"].startswith("P000") for row in r.rows + r.other_rows)
    assert all(0.01 <= row["bid"] <= row["ask"] for row in r.rows)
    kind = "call" if r.params["view"] == "up" else "put"
    assert {row["type"] for row in r.rows} == {kind}


# ── the bench (docs/desk/OPTIONS_PHASE4A.md, sections 2 and 3) ──

import ast  # noqa: E402
import inspect  # noqa: E402
import math  # noqa: E402

from scripts.options_bench.phase4a import bench, rootfinding as rf  # noqa: E402
from src.desk import options_finder as of  # noqa: E402
from src.desk import options_math as om  # noqa: E402

PATCHED = [(of, "Pricer"), (of, "calibrate_all"), (of, "implied_vols"), (of, "value_rows"), (of, "curve_pnl"),
           (of, "lens_order"), (of, "pair_forward_gen"), (of, "_breakeven_gen"), (om, "drive"), (om, "iv_american_gen")]


def _originals():
    return {(m.__name__, n): getattr(m, n) for m, n in PATCHED}


def _plain(answer):
    return json.loads(json.dumps(answer, default=str, sort_keys=True))


def test_configuration_a_answers_exactly_as_the_unpatched_finder():
    req = pop.request(pop.DEV_SEED, 0)
    plain = req.run()
    got = bench.run_one(req, "A", of.WORK_LIMIT)
    assert got["outcome"] == "answered"
    assert _plain(got["answer"]) == _plain(plain)
    assert got["pricer"].t2_answer == {} and got["pricer"].rf == []
    solves = got["pricer"].solves    # B-4: Tier 1's solves are counted too, under every configuration
    assert {s["site"] for s in solves} >= {"iv", "carry", "breakeven"} and {s["engine"] for s in solves} == {1}
    assert all(s["rounds"] >= 0 and s["exit"] in ("solved", "no solution", "refused") for s in solves)


def test_a_tier2_valuation_refusal_inside_a_solve_is_recorded_then_raised():
    # B-5: an OutOfDomain thrown into a Tier 2 IV solve is logged with its reason and re-raised as today
    p = bench.SitePricer(of.Work(of.WORK_LIMIT), bench.CONFIGS["C"], bench.SiteStats())
    p.site = "iv"
    c = om.Context(True, 100.0, 100.0, 60, 0.04, 0.0, 0.3, ((10, 1.0),))
    bench._CURRENT.append(p)
    try:
        got = om.drive({0: rf.iv_american_gen(c, 5.0)}, lambda cs: ["outside: a stand-in reason"] * len(cs))[0]
    finally:
        bench._CURRENT.pop()
    assert isinstance(got, om.OutOfDomain)
    assert p.rf[-1]["exit"] == "refused" and "a stand-in reason" in p.rf[-1]["reason"]


@pytest.mark.parametrize("config", ["A", "C", "D"])
def test_every_substituted_attribute_is_restored_after_a_run(config):
    before = _originals()
    bench.run_one(pop.request(pop.DEV_SEED, 0), config, 10 ** 6,   # a small limit: refused part way through
                  wrappers={"lens_order": lambda fn: (lambda *a, **k: fn(*a, **k))})
    assert _originals() == before and bench._CURRENT == []


def test_attributes_are_restored_after_a_failure():
    class Boom:
        def run(self, **kw):
            raise RuntimeError("boom")
    before = _originals()
    got = bench.run_one(Boom(), "D", of.WORK_LIMIT)
    assert got["outcome"] == "failed" and "boom" in got["error"]
    assert _originals() == before and bench._CURRENT == []


def test_the_implied_vols_copy_differs_from_the_finder_s_in_its_exempt_call_only():
    orig = ast.parse(inspect.getsource(of.implied_vols))
    ours = ast.parse(inspect.getsource(of.implied_vols))
    calls = [n for n in ast.walk(ours) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "iv_european"]
    assert len(calls) == 1
    calls[0].func = ast.copy_location(ast.Name(id="_bench_iv_exempt", ctx=ast.Load()), calls[0].func)
    ast.fix_missing_locations(ours)
    assert ast.dump(orig) != ast.dump(ours)
    assert rf.implied_vols.__code__.co_names != of.implied_vols.__code__.co_names
    assert set(rf.implied_vols.__code__.co_names) - set(of.implied_vols.__code__.co_names) == {"_bench_iv_exempt"}
    code = next(k for k in compile(ours, "x", "exec").co_consts if hasattr(k, "co_code"))
    assert rf.implied_vols.__code__.co_code == code.co_code


def test_a_tier2_outside_domain_refusal_is_in_domain_s_own_reason():
    c = om.Context(False, 100.0, 100.0, 60, 0.04, 0.5, 0.3)   # residual yield beyond the validated ±10%
    assert om.in_domain(c) == om.Q_DOMAIN_REASON
    p = bench.SitePricer(of.Work(of.WORK_LIMIT), bench.CONFIGS["D"], bench.SiteStats())
    assert p._tier2(c, "carry") == om.Q_DOMAIN_REASON


def _value(v):
    def f(x):
        if False:
            yield
        return v(x)
    return f


def _drain(gen):
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value


def test_the_slope_probe_points_inward_at_the_validated_range_s_end():
    # DR-09: a first-point root at the top of the range is probed below it, never outside
    s, rho, xp = _drain(rf.slope_gen(_value(lambda x: 0.5 * (x - 1999.9)), lambda x: 0.001, 1999.9, None,
                                     5.0, 2000.0, 0.5, 2.0, 100.0, +1, lambda x: om.Context(True, x, 100.0, 30, 0.0, 0.0, 0.3), 1))
    assert xp < 1999.9 and math.isclose(s, 0.5 * (1 - rho)) and rho < 0.5


def test_the_slope_probe_is_sized_by_the_slope_s_magnitude():
    # DR-12: a put's breakeven slope is negative; h_target uses |delta|
    s, rho, xp = _drain(rf.slope_gen(_value(lambda x: -0.1 * (x - 100.0)), lambda x: 0.01, 100.0, None,
                                     5.0, 2000.0, -0.1, 0.1, 5.0, -1, lambda x: om.Context(False, x, 100.0, 30, 0.0, 0.0, 0.3), 1))
    assert math.isclose(abs(xp - 100.0), 0.8) and math.isclose(rho, 0.25)


def test_the_noise_stop_bracket_is_resolved_by_a_wider_probe():
    # DR-11: A(σ) = 10σ, E = 0.001, bracket [.19995, .20004] within noise; the probe may leave it
    s, rho, xp = _drain(rf.slope_gen(_value(lambda x: 10 * x - 2.0), lambda x: 0.001, 0.2, (0.19995, 0.20004),
                                     0.001, 5.0, 10.0, 0.002, 0.05, +1, lambda x: om.Context(True, 100.0, 100.0, 30, 0.0, 0.0, x), 1))
    assert xp is not None and (0.001 + 0.001) / s < 0.001


def test_no_second_probe_and_no_probe_past_the_cap():
    with pytest.raises(rf.Refused, match="slope not resolved"):
        _drain(rf.slope_gen(_value(lambda x: 0.0), lambda x: 0.01, 1.0, None, 0.5, 2.0, 1.0, 0.01, 0.1, +1,
                            lambda x: om.Context(True, 100.0, 100.0, 30, 0.0, 0.0, x), 1))
    with pytest.raises(rf.Refused, match="evaluation cap"):
        _drain(rf.slope_gen(_value(lambda x: x), lambda x: 0.01, 1.0, None, 0.5, 2.0, 1.0, 0.01, 0.1, +1,
                            lambda x: om.Context(True, 100.0, 100.0, 30, 0.0, 0.0, x), 0))


def test_an_exactly_solved_pair_is_accepted_after_one_evaluation():
    # pass 2's DR-03 case: zero rates, no residual yield, no dividends, both legs exempt
    p = bench.SitePricer(of.Work(of.WORK_LIMIT), bench.CONFIGS["C"], bench.SiteStats())
    p.site = "carry"
    c = om.Context(True, 100.0, 100.0, 60, 0.0, 0.0, 0.25)
    call = om.european(c)
    put = om.european(om.Context(False, 100.0, 100.0, 60, 0.0, 0.0, 0.25))
    bench._CURRENT.append(p)
    try:
        got = om.drive({0: rf.pair_forward_gen(100.0, 100.0, call, put, 60, 0.0, ())}, p.values)[0]
    finally:
        bench._CURRENT.pop()
    assert got is not None and math.isclose(got[0], 100.0, rel_tol=1e-12)
    assert p.rf[-1]["evals"] == 1 and p.rf[-1]["conditioning"] == "not established"


def test_the_cpu_guard_stops_before_a_request_it_cannot_afford(tmp_path):
    from scripts.options_bench.phase4a import runner
    ledger, out = tmp_path / "cpu.json", tmp_path / "out.jsonl"
    runner.write_ledger({"entries": [{"kind": "external", "cpu_s": 9.6 * 3600}]}, ledger)
    assert runner.guarded(0, 3, ["A"], ["budget"], out, ledger) == 3
    recs = [json.loads(x) for x in out.read_text().splitlines()]
    assert [r["index"] for r in recs] == [0, 1, 2] and {r["outcome"] for r in recs} == {"stopped: CPU allowance"}


def test_the_cpu_guard_meters_a_child_and_keeps_its_answer(tmp_path):
    from scripts.options_bench.phase4a import runner
    ledger, out = tmp_path / "cpu.json", tmp_path / "out.jsonl"
    assert runner.guarded(0, 1, ["A"], ["budget"], out, ledger) == 0
    led = runner.read_ledger(ledger)
    assert led["entries"][0]["kind"] == "request" and led["entries"][0]["cpu_s"] > 0 and led["total_s"] > 0
    (rec,) = [json.loads(x) for x in out.read_text().splitlines()]
    assert rec["outcome"] == "answered" and rec["config"] == "A"


@pytest.mark.parametrize("config", ["A", "C"])
def test_every_candidate_s_fate_adds_up_to_the_answer_s_own_counts(config):
    from scripts.options_bench.phase4a import runner
    (rec,) = list(runner.run_request(0, [config], ["budget"]))
    el = rec["eligibility"]
    assert el["consistent"], el["diff"]
    assert sum(1 for v in el["fate"].values() if v == "passed") == len(rec["rows"])


def test_a_later_configuration_s_failure_keeps_the_earlier_record(monkeypatch):
    from scripts.options_bench.phase4a import runner
    real = bench.run_one

    def run_one(req, config, limit, wrappers=None):
        if config == "B":
            raise MemoryError("stand-in for a kill")
        return real(req, config, limit, wrappers=wrappers)

    monkeypatch.setattr(bench, "run_one", run_one)
    gen = runner.run_request(0, ["A", "B"], ["budget"])
    first = next(gen)
    assert first["config"] == "A" and first["outcome"] == "answered"
    with pytest.raises(MemoryError):
        next(gen)


def test_the_guard_keeps_completed_lines_of_a_killed_child_and_names_the_interrupted_one(tmp_path, monkeypatch):
    import signal
    import subprocess
    from scripts.options_bench.phase4a import runner
    ledger, out = tmp_path / "cpu.json", tmp_path / "out.jsonl"

    def fake_run(cmd, **kw):
        path = Path(cmd[cmd.index("--out") + 1])
        path.write_text(json.dumps({"index": 0, "config": "A", "limit_name": "budget", "outcome": "answered"})
                        + "\n" + '{"index": 0, "config": "A", "limit_na')
        return subprocess.CompletedProcess(cmd, -signal.SIGXCPU)

    monkeypatch.setattr(runner.subprocess, "run", fake_run)
    assert runner.guarded(0, 1, ["A", "B"], ["budget", "offline"], out, ledger) == 0
    recs = [json.loads(x) for x in out.read_text().splitlines()]
    assert [(r["config"], r["limit_name"], r["outcome"]) for r in recs] == [
        ("A", "budget", "answered"), ("A", "offline", "incomplete: CPU limit"),
        ("B", "budget", "not run: earlier configuration interrupted"),
        ("B", "offline", "not run: earlier configuration interrupted")]
    assert recs[1]["cpu_s"] is None and "request_cpu_s" in recs[1]


@pytest.mark.parametrize("config", ["A", "C"])
def test_every_quote_sent_to_implied_vols_has_one_solve_record(config):
    # B-6: exempt quotes skip the generator; they are counted too
    from scripts.options_bench.phase4a import eligibility
    tr = eligibility.Trace()
    got = bench.run_one(pop.request(pop.DEV_SEED, 0), config, of.WORK_LIMIT, wrappers=tr.wrappers())
    iv = [s for s in got["pricer"].solves if s["site"] == "iv"]
    assert len(iv) == len(tr.sent_to_iv) > 0
    assert {s["engine"] for s in iv} == {1 if config == "A" else 2}


def test_an_exempt_quote_is_counted_as_a_solve_under_either_engine():
    c0 = om.Context(True, 100.0, 100.0, 60, 0.04, 0.0, 0.3)
    assert om.exempt(c0)
    price = om.european(c0.with_sigma(0.25))

    class Q:
        contract, mid = "X", price

    class RC:
        class m:
            session, spot = None, 100.0

    for tier2, engine in ((frozenset(), 1), (bench.CONFIGS["D"], 2)):
        p = bench.SitePricer(of.Work(of.WORK_LIMIT), tier2, bench.SiteStats())
        p.site = "iv"
        fake = lambda rc, quotes: {"X": 0.25}
        orig = of._context_on
        of._context_on = lambda rc, q, sg, start, spot: c0
        bench._CURRENT.append(p)
        try:
            bench._exempt_iv_counter(fake)(RC, [Q])
        finally:
            bench._CURRENT.pop()
            of._context_on = orig
        (rec,) = p.solves
        assert rec["exempt"] and rec["engine"] == engine and rec["exit"] == "solved"


def test_each_passed_row_carries_its_on_date_contexts_at_its_own_sigma():
    from scripts.options_bench.phase4a import runner
    (a, d) = list(runner.run_request(0, ["A", "D"], ["offline"]))
    for rec in (a, d):
        assert rec["row_contexts"] and set(rec["row_contexts"]) <= set(rec["rows"])
        for contract, ctxs in rec["row_contexts"].items():
            assert set(ctxs) == {"target", "half", "flat"}
            assert all(math.isclose(c["sigma"], rec["rows"][contract]["iv"], rel_tol=1e-9) for c in ctxs.values())
    assert all(c["t2"] is None for ctxs in a["row_contexts"].values() for c in ctxs.values())
    assert all(c["t2"] is not None for ctxs in d["row_contexts"].values() for c in ctxs.values())
    for rec in (a, d):   # B-10: the time lens's filter is recorded on the unrounded P&L for every passed row
        assert all(isinstance(r["time_ok"], bool) for r in rec["rows"].values())
        timed = set(rec["lens_order"]["time"])
        assert timed <= {c for c, r in rec["rows"].items() if r["time_ok"]}


# ── the ranking trace (section 4) on hand-built records ──────────────────────────────────────────────────────────

from scripts.options_bench.phase4a import trace as tr  # noqa: E402

C1, C2 = "T261218P00100000", "T261218P00095000"


def _rec(cfg, pnl, top, *, iv=0.2, t2=None, ctx_for=(C1, C2), d_sigma=None, fate=None):
    ctx = {"call": False, "spot": 100.0, "strike": 100.0, "days": 30, "rho": 0.04, "q": 0.0, "sigma": iv, "divs": [],
           "t2": t2}
    rows = {c: {"iv": iv, "n": 1, "cost": 100.0, "pnl": {"target": v, "half": v, "flat": v}} for c, v in pnl.items()}
    return {"index": 0, "config": cfg, "limit_name": "offline", "outcome": "answered", "rows": rows,
            "row_contexts": {c: {m: dict(ctx) for m in ("target", "half", "flat")} for c in ctx_for if c in rows},
            "eligibility": {"fate": fate or {}}, "lens_order": {"payoff": top}, "picks": {"payoff": top[0]},
            "carry": [], "rf": ([] if d_sigma is None else
                                [{"site": "iv", "call": False, "strike": 100.0, "sigma": iv, "d_sigma": d_sigma}])}


def _payoff(recs):
    return {k: v for k, v in tr.trace(recs, "offline")["classes"].items() if k.endswith(":payoff")}


def test_the_trace_names_a_removed_candidate_and_the_row_it_displaced():
    a = _rec("A", {C1: 1000.0, C2: 900.0}, [C1])
    b = _rec("B", {C2: 900.0}, [C2], fate={C1: "unpriceable"})
    out = tr.trace([a, b], "offline")
    assert out["classes"]["B:payoff"] == {"pick: removed or added": 1, "left: removed or added": 1,
                                          f"entered: {tr.DISPLACED}": 1}
    assert out["removed_or_added_causes"]["B"] == {"B: unpriceable": 2}
    assert out["unexplained"] == []


def test_a_swap_inside_tier_2_s_stated_error_is_a_tie_and_one_outside_it_is_unexplained():
    t2 = {"status": "unresolved: estimate above target", "estimate": 0.01, "value": None, "route": "x"}
    a = _rec("A", {C1: 1000.0, C2: 999.5}, [C1])
    near = _rec("B", {C1: 999.0, C2: 999.6}, [C2], t2=t2)
    assert set(_payoff([a, near])["B:payoff"]) == {"pick: tie", "left: tie", "entered: tie"}
    a = _rec("A", {C1: 1000.0, C2: 900.0}, [C1])
    far = _rec("B", {C1: 800.0, C2: 900.0}, [C2], t2=t2)
    out = tr.trace([a, far], "offline")
    assert set(out["classes"]["B:payoff"]) == {"pick: unexplained", "left: unexplained", "entered: unexplained"}
    assert {u["contract"] for u in out["unexplained"]} == {C1, C2}


def test_a_swap_inside_the_stated_input_error_is_explained_by_inputs_and_one_outside_it_is_not():
    # C2 has no on-date context (an expiry on the target date), so C's tie test cannot be stated for the pair
    a = _rec("A", {C1: 1000.0, C2: 995.0}, [C1], ctx_for=(C1,))
    c = _rec("C", {C1: 990.0, C2: 995.0}, [C2], ctx_for=(C1,), d_sigma=0.01)
    assert set(_payoff([a, c])["C:payoff"]) == {"pick: explained by inputs", "left: explained by inputs",
                                                "entered: explained by inputs"}
    c = _rec("C", {C1: 990.0, C2: 995.0}, [C2], ctx_for=(C1,), d_sigma=1e-4)
    assert set(_payoff([a, c])["C:payoff"]) == {"pick: unexplained", "left: unexplained", "entered: unexplained"}


def test_a_pick_that_is_new_in_the_configuration_is_classed_as_added():
    a = _rec("A", {C1: 1000.0}, [C1], fate={C2: "ranked out"})
    b = _rec("B", {C1: 1000.0, C2: 1100.0}, [C2, C1])
    out = tr.trace([a, b], "offline")
    assert out["classes"]["B:payoff"]["pick: removed or added"] == 1
    assert out["removed_or_added_causes"]["B"]["A: ranked out"] >= 1
    assert out["unexplained"] == []


def test_an_input_effect_on_a_row_whose_carry_changed_is_never_explained_by_inputs():
    # B-7: the same swap the δσ·vega allowance explains, but C's carry for the expiry differs from A's
    a = _rec("A", {C1: 1000.0, C2: 995.0}, [C1], ctx_for=(C1,))
    c = _rec("C", {C1: 990.0, C2: 995.0}, [C2], ctx_for=(C1,), d_sigma=0.01)
    a["carry"] = [{"exp": "2026-12-18", "forward": 100.0, "source": "market"}]
    c["carry"] = [{"exp": "2026-12-18", "forward": 101.0, "source": "market"}]
    got = _payoff([a, c])["C:payoff"]
    assert set(got) == {"pick: involves carry (conditioning not established)",
                        "left: involves carry (conditioning not established)",
                        "entered: involves carry (conditioning not established)"}


def test_a_swap_inside_the_top_20_with_the_same_pick_and_members_is_traced():
    # B-8: same winner, same members, two members swapped; an entrant or leaver alone moves no pair's order
    C3 = "T261218P00090000"
    t2 = {"status": "unresolved: estimate above target", "estimate": 0.01, "value": None, "route": "x"}
    a = _rec("A", {C1: 3000.0, C2: 2000.0, C3: 1000.0}, [C1, C2, C3])
    b = _rec("B", {C1: 3000.0, C2: 100.0, C3: 2000.0}, [C1, C3, C2], t2=t2)
    out = tr.trace([a, b], "offline")
    assert out["classes"]["B:payoff"] == {"order: unexplained": 1}
    assert [(u["contract"], u["partner"]) for u in out["unexplained"]] == [(C2, C3)]
    shifted = _rec("B", {C1: 3000.0, C2: 2000.0, C3: 1000.0, "T261218P00085000": 2500.0},
                   [C1, "T261218P00085000", C2, C3], t2=t2)
    assert not any(k.startswith("order") for k in tr.trace([a, shifted], "offline")["classes"].get("B:payoff", {}))


def test_the_summary_reports_how_much_of_a_s_order_each_top_20_keeps():
    from scripts.options_bench.phase4a import analyze
    C3 = "T261218P00090000"
    a = _rec("A", {C1: 3.0, C2: 2.0, C3: 1.0}, [C1, C2, C3])
    b = _rec("B", {C1: 3.0, C2: 1.0, C3: 2.0}, [C1, C3, C2])
    for r in (a, b):
        r["outcome"] = "answered"
    got = analyze.summarize([a, b])["B:offline"]["top20_order_kept_vs_A"]["payoff"]
    assert got["p50"] == pytest.approx(2 / 3) and got["all_kept"] == 0


@pytest.mark.parametrize("reverse", [False, True])
def test_a_time_lens_change_from_the_partner_crossing_the_cost_filter_is_the_filter(reverse):
    # B-9: the flat P&Ls never change; only C2's target P&L crosses its $100 cost, in either direction
    def rec(cfg, c2_target, top):
        r = _rec(cfg, {C1: 0.0, C2: 0.0}, top)
        r["lens_order"] = {"time": top}
        r["picks"] = {"time": top[0]}
        r["rows"][C1]["pnl"] = {"target": 200.0, "half": 0.0, "flat": 1000.0}
        r["rows"][C2]["pnl"] = {"target": c2_target, "half": 0.0, "flat": 1100.0}
        return r
    a, b = rec("A", 99.0, [C1]), rec("B", 101.0, [C2, C1])
    if reverse:
        a, b = rec("A", 101.0, [C2, C1]), rec("B", 99.0, [C1])
        a["config"], b["config"] = "A", "B"
    got = tr.trace([a, b], "offline")["classes"]["B:time"]
    assert set(got) == {"pick: time lens filter", "entered: time lens filter" if not reverse else "left: time lens filter"}


@pytest.mark.parametrize("reverse", [False, True])
def test_a_crossing_hidden_by_rounding_to_cents_is_the_filter_and_the_recorded_flag_decides(reverse):
    # B-10: C2's target P&L moves from $99.999 to $100.001 against a $100 cost; both serialize as $100.00
    def rec(cfg, c2_ok, top, flag):
        r = _rec(cfg, {C1: 0.0, C2: 0.0}, top)
        r["lens_order"], r["picks"] = {"time": top}, {"time": top[0]}
        r["rows"][C1]["pnl"] = {"target": 200.0, "half": 0.0, "flat": 1000.0}
        r["rows"][C2]["pnl"] = {"target": 100.0, "half": 0.0, "flat": 1100.0}
        if flag:
            r["rows"][C1]["time_ok"], r["rows"][C2]["time_ok"] = True, c2_ok
        return r
    for flag in (False, True):   # records without the flag (the main run's) and with it
        a, b = rec("A", False, [C1], flag), rec("B", True, [C2, C1], flag)
        if reverse:
            a, b = rec("A", True, [C2, C1], flag), rec("B", False, [C1], flag)
        got = tr.trace([a, b], "offline")
        assert set(got["classes"]["B:time"]) == {"pick: time lens filter",
                                                 "left: time lens filter" if reverse else "entered: time lens filter"}
        assert got["unexplained"] == []


def test_rows_the_time_lens_ranks_in_both_passed_its_filter_so_their_swap_is_not_the_filter():
    # B-11: target P&L rounds to the cost, but both rows sit in both time rankings, so neither crossed the filter
    def rec(cfg, flat1, flat2, top):
        r = _rec(cfg, {C1: 0.0, C2: 0.0}, top)
        r["lens_order"], r["picks"] = {"time": top}, {"time": top[0]}
        r["rows"][C1]["pnl"] = {"target": 100.0, "half": 0.0, "flat": flat1}
        r["rows"][C2]["pnl"] = {"target": 100.0, "half": 0.0, "flat": flat2}
        return r
    a, b = rec("A", 10.0, 0.0, [C1, C2]), rec("B", 0.0, 90.0, [C2, C1])
    got = tr.trace([a, b], "offline")
    assert not any("time lens filter" in k for k in got["classes"]["B:time"])
    assert got["classes"]["B:time"] == {"pick: unexplained": 1, "order: unexplained": 1}
