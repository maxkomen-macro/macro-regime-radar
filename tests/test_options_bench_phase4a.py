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
