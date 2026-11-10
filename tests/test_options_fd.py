"""The FD kernel moved from scripts/options_bench/fd.py to src/desk/options_fd.py (Phase 3, direction 1).

One FD code: the bench imports the kernel from src/desk/options_fd.py. The move must change no bit of any output,
so each solve below runs both the current kernel and the verbatim pre-move file (tests/fixtures/options_pre_phase3/,
checked by its git blob id) in the same process and compares every bit. A recorded float.hex constant is not
portable across platforms (numpy and libm round differently), so nothing here pins a constant.
"""

from __future__ import annotations

import math

import pytest

from pathlib import Path

from scripts.options_bench import fd as bench_fd
from src.desk import options_fd
from tests.fixtures import options_pre_phase3 as frozen

REPO = Path(__file__).resolve().parent.parent

PRE_MOVE_FILE, PRE_MOVE_BLOB = "fd_2ff3e8b.py", "3b0bbb57b5fba23dccc904c711c9938d4a187c54"

# Every exercise mode and dividend timing the kernel branches on, on small grids (the comparison is bit for bit,
# so grid size does not matter to what is proved, only to the run time).
BASE = dict(spot=100.0, m=240, per_day=2, width=1.3)
SOLVES = [
    dict(is_call=False, strike=105.0, days=90, rho=0.05, q=0.0, sigma=0.3, divs=()),
    dict(is_call=True, strike=95.0, days=60, rho=0.03, q=0.06, sigma=0.4, divs=()),
    dict(is_call=True, strike=90.0, days=40, rho=0.04, q=-0.03, sigma=0.25, divs=()),          # q < 0
    dict(is_call=False, strike=100.0, days=50, rho=-0.01, q=0.0, sigma=0.35, divs=()),        # negative rate
    dict(is_call=True, strike=86.0, days=38, rho=0.038, q=0.054, sigma=0.51, divs=((0, 1.55),)),  # day-0 close
    dict(is_call=True, strike=97.0, days=30, rho=0.02, q=0.0, sigma=0.3, divs=((1, 1.2),)),    # day-1 close
    dict(is_call=False, strike=102.0, days=120, rho=0.05, q=0.01, sigma=0.3,
         divs=((14, 1.0), (45, 1.1), (105, 0.9))),                                           # several closes
    dict(is_call=True, strike=100.0, days=20, rho=0.09, q=0.0, sigma=0.94, divs=((19, 2.28),)),   # last day
    dict(is_call=False, strike=100.0, days=60, rho=0.03, q=0.01, sigma=0.3, divs=((20, 2.0),), american=False),
    dict(is_call=True, strike=95.0, days=60, rho=0.03, q=0.0, sigma=0.3, divs=((20, 2.0),),
         exercise_days=(10, 20, 40)),                                                         # Bermudan
    dict(is_call=False, strike=110.0, days=45, rho=0.06, q=0.0, sigma=0.2, divs=(), penalty=1e7),
    dict(is_call=True, strike=100.0, days=10, rho=0.01, q=0.02, sigma=3.0, divs=(), width=6.0),  # extreme vol
    dict(is_call=False, strike=100.0, days=900, rho=0.04, q=0.0, sigma=0.2, divs=((300, 1.0), (600, 1.0)),
         per_day=1),                                                                          # long-dated
]


def _args(s: dict) -> dict:
    return {**BASE, **s}


def test_the_frozen_pre_move_fd_is_the_verbatim_2ff3e8b_file():
    assert frozen.blob_id(PRE_MOVE_FILE) == PRE_MOVE_BLOB


@pytest.fixture(scope="module")
def pre_move_fd():
    return frozen.load(PRE_MOVE_FILE, PRE_MOVE_BLOB)


def _same_bits(new, old):
    assert len(new) == len(old) == 2
    for a, b in zip(new, old):
        assert type(a) is type(b) is float
        assert a.hex() == b.hex()   # every bit, not a tolerance


@pytest.mark.parametrize("s", SOLVES)
def test_the_moved_kernel_is_bit_identical_to_before_the_move(s, pre_move_fd):
    new_diag, old_diag = {}, {}
    new = options_fd.solve(**_args(s), diag=new_diag)
    old = pre_move_fd.solve(**_args(s), diag=old_diag)
    _same_bits(new, old)
    assert new_diag == old_diag
    assert math.isfinite(new[0])


def test_the_helpers_are_bit_identical_to_before_the_move(pre_move_fd):
    divs = ((0, 1.5), (3, 1.0), (40, 2.0))
    for t in (0.0, 0.5, 3.0, 3.25, 40.0, 41.0):
        for rho in (-0.02, 0.0, 0.05):
            for f in ("pv_owed", "pv_after"):
                a, b = getattr(bench_fd, f)(divs, rho, t), getattr(pre_move_fd, f)(divs, rho, t)
                assert type(a) is type(b) and float(a).hex() == float(b).hex()   # the empty sum is the int 0
    for args in ((0.05, 0.0, 0.3, 0.004), (-0.01, 0.08, 0.15, 0.01), (0.2, -0.05, 2.0, 0.02)):
        assert [c.hex() for c in bench_fd.coefficients(*args)] == [c.hex() for c in pre_move_fd.coefficients(*args)]
    import numpy as np
    x = np.log(100.0) + np.linspace(-1.0, 1.0, 81)
    for is_call in (True, False):
        a = bench_fd.smoothed_payoff(is_call, x, x[1] - x[0], 100.0)
        b = pre_move_fd.smoothed_payoff(is_call, x, x[1] - x[0], 100.0)
        assert a.tobytes() == b.tobytes()
    assert (bench_fd.YEAR_DAYS, bench_fd.PENALTY, bench_fd.PENALTY_ITER_MAX, bench_fd.PENALTY_STOP,
            bench_fd.TIE_ULPS) == (pre_move_fd.YEAR_DAYS, pre_move_fd.PENALTY, pre_move_fd.PENALTY_ITER_MAX,
                                   pre_move_fd.PENALTY_STOP, pre_move_fd.TIE_ULPS)


def test_the_kernel_refusals_are_unchanged(pre_move_fd):
    for mod in (bench_fd, pre_move_fd):
        with pytest.raises(ValueError, match="m must be even"):
            mod.solve(True, 100.0, 100.0, 10, 0.0, 0.0, 0.3, (), 241, 2, 1.0)
        with pytest.raises(ValueError, match="at or below the owed dividends"):
            mod.solve(True, 100.0, 100.0, 10, 0.0, 0.0, 0.3, ((2, 100.0),), 240, 2, 1.0)


KERNEL_NAMES = ("PENALTY", "PENALTY_ITER_MAX", "PENALTY_STOP", "TIE_ULPS", "YEAR_DAYS", "coefficients", "pv_after",
                "pv_owed", "smoothed_payoff", "solve")


def test_the_bench_re_exports_the_one_kernel():
    for name in KERNEL_NAMES:
        assert getattr(bench_fd, name) is getattr(options_fd, name), name
    assert bench_fd.solve.__module__ == "src.desk.options_fd"


def test_no_copy_of_the_kernel_stays_in_the_bench():
    text = (REPO / "scripts" / "options_bench" / "fd.py").read_text()
    for marker in ("def solve", "def pv_owed", "def pv_after", "def coefficients", "def smoothed_payoff",
                   "solve_banded"):
        assert marker not in text, marker
    # nothing else in the bench or in src grows its own Crank-Nicolson solver
    for path in list((REPO / "scripts" / "options_bench").glob("*.py")) + list((REPO / "src").rglob("*.py")):
        if path.name == "options_fd.py":
            continue
        assert "solve_banded" not in path.read_text(), path


# ---- Step 3: the opt-in solver state for the Greeks (design section 3.3) -------------------------------------

import numpy as np  # noqa: E402


@pytest.mark.parametrize("s", SOLVES)
def test_asking_for_the_grids_changes_no_bit_of_the_solve(s, pre_move_fd):
    grids, diag, old_diag = {}, {}, {}
    new = options_fd.solve(**_args(s), diag=diag, grids=grids)
    old = pre_move_fd.solve(**_args(s), diag=old_diag)
    _same_bits(new, old)
    assert diag == old_diag
    a = _args(s)
    i = a["m"] // 2
    v0, xs = grids["v0"], grids["xs"]
    assert v0[i].hex() == new[0].hex()
    assert float((v0[i + 1] - v0[i - 1]) / (xs[i + 1] - xs[i - 1])).hex() == new[1].hex()
    for k in ("x", "xs", "v0", "g0", "free0", "active0", "exercise0"):
        assert grids[k].shape == (a["m"] + 1,), k
    assert (grids["v_day1"] is None) == (a["days"] < 2)


def _ref_solve(**kw):
    return options_fd.solve(**{**BASE, **kw})


def test_the_t0_state_is_the_projection_of_the_free_values():
    # an American put deep in the money: exercised at the low nodes, held at the high ones
    g = {}
    _ref_solve(is_call=False, strike=120.0, days=60, rho=0.08, q=0.0, sigma=0.25, divs=(), grids=g)
    assert np.all(g["v0"] >= g["g0"])
    assert g["exercise0"].any() and not g["exercise0"].all()
    # where holding wins the projection changes nothing; where exercise wins the value is the exercise value (to
    # the penalty's tie rule: a pinned node may sit a few ulps above it)
    held = ~g["exercise0"]
    assert np.array_equal(g["v0"][held], g["free0"][held])
    ex = g["exercise0"]
    assert np.allclose(g["v0"][ex], g["g0"][ex], rtol=1e-14, atol=0)
    assert np.all(g["free0"][held] >= g["g0"][held])


def test_a_european_solve_has_no_exercise_state():
    g = {}
    v, _ = _ref_solve(is_call=True, strike=100.0, days=30, rho=0.03, q=0.0, sigma=0.3, divs=((10, 1.0),),
                      american=False, grids=g)
    assert not g["g0"].any() and not g["exercise0"].any() and not g["active0"].any()
    assert g["free0"].tobytes() == g["v0"].tobytes()   # no projection: the last solve is the solution


def test_at_a_day_0_close_the_exercise_value_is_cum_dividend():
    # V-1: a call whose dividend's cum close is today. g0 is the cum exercise value X + D − K at each node; the
    # free value is held against the ex-dividend obstacle inside the last step (D-2)
    s = dict(is_call=True, strike=86.0, days=38, rho=0.038, q=0.054, sigma=0.51, divs=((0, 1.55),))
    g = {}
    _ref_solve(**s, grids=g)
    cum = np.maximum(g["xs"] + 1.55 - 86.0, 0.0)
    assert np.array_equal(g["g0"], cum)
    assert np.all(g["v0"] >= cum)


@pytest.mark.parametrize("s", [
    dict(is_call=False, strike=105.0, days=30, rho=0.05, q=0.0, sigma=0.3, divs=()),
    dict(is_call=True, strike=97.0, days=30, rho=0.02, q=0.0, sigma=0.3, divs=((1, 1.2),)),        # cum close day 1
    dict(is_call=False, strike=102.0, days=40, rho=0.05, q=0.01, sigma=0.3, divs=((1, 0.8), (20, 1.0))),
    dict(is_call=True, strike=100.0, days=25, rho=0.03, q=0.0, sigma=0.3, divs=((12, 1.5),), american=False),
])
def test_the_day_1_level_is_the_solve_from_one_day_later(s):
    # V-2: the level one day after t = 0 is what a solve over days − 1, with every dividend one day earlier and
    # the same X grid (spot X0 + PV_1), returns at its own t = 0; at a cum close on day 1 that is the cum value.
    # The arithmetic is the same step for step; only the dividends' PV exponents round differently (d − t against
    # (d − 1) − (t − 1)), so the match is to rounding, not to the bit.
    a = _args(s)
    g, g1 = {}, {}
    options_fd.solve(**a, grids=g)
    x0 = a["spot"] - options_fd.pv_owed(a["divs"], a["rho"], 0.0)
    shifted = tuple((d - 1, amt) for d, amt in a["divs"])
    spot1 = x0 + options_fd.pv_owed(shifted, a["rho"], 0.0)
    options_fd.solve(**{**a, "days": a["days"] - 1, "divs": shifted, "spot": spot1}, grids=g1)
    assert np.allclose(g1["x"], g["x"], rtol=0, atol=1e-13)
    assert np.allclose(g["v_day1"], g1["v0"], rtol=1e-11, atol=1e-11)
    assert options_fd.pv_owed(a["divs"], a["rho"], 1.0) == pytest.approx(spot1 - x0, abs=1e-13)


def test_at_a_day_0_close_a_put_waits_for_the_dividend():
    # a deep in-the-money put whose dividend's cum close is today: exercising just after the close (ex-dividend,
    # S lower by D) beats exercising now, so the nodes the penalty pinned to the ex-dividend obstacle are held now
    s = dict(is_call=False, strike=130.0, days=20, rho=0.01, q=0.0, sigma=0.2, divs=((0, 2.0),))
    g = {}
    _ref_solve(**s, grids=g)
    pinned = g["active0"]
    assert pinned.any()
    assert not g["exercise0"][pinned].any()
    after = np.maximum(130.0 - g["xs"], 0.0)          # ex-dividend exercise value, X − K with nothing owed
    assert np.allclose(g["v0"][pinned], after[pinned], rtol=1e-12, atol=0)
    assert np.all(g["v0"][pinned] > g["g0"][pinned])


def test_a_bermudan_schedule_without_day_0_has_no_exercise_at_t0():
    g = {}
    _ref_solve(is_call=False, strike=110.0, days=30, rho=0.05, q=0.0, sigma=0.3, divs=(), exercise_days=(10, 20),
               grids=g)
    assert not g["g0"].any() and not g["exercise0"].any()
    assert g["free0"].tobytes() == g["v0"].tobytes()


# ---- Step 4: the production wrapper (design section 3.4) --------------------------------------------------------

from scripts.options_bench import cases, reference  # noqa: E402
from src.desk import options_adaptive as oa  # noqa: E402
from src.desk import options_math as om  # noqa: E402

CFG = options_fd.FDConfig(m_frac=0.25, p_frac=0.5, work_cap=10**9)


def _ctx(**kw) -> om.Context:
    a = dict(is_call=False, spot=100.0, strike=105.0, days=90, rho=0.05, q=0.0, sigma=0.3, divs=())
    a.update(kw)
    return om.Context(a["is_call"], a["spot"], a["strike"], a["days"], a["rho"], a["q"], a["sigma"], tuple(a["divs"]))


def test_the_production_grid_rule_is_the_reference_rule():
    n = 0
    for g in cases.GROUPS:
        for i in range(60):
            c = cases.case(20261026, g, i)
            if c.spot - c.pv() <= 0:
                continue
            assert options_fd.grid_rule(c.spot, c.strike, c.days, c.rho, c.q, c.sigma,
                                        options_fd.pv_owed(c.divs, c.rho, 0.0)) == reference.grid(c), c.id
            n += 1
    assert n >= 500
    assert (options_fd.GRID_M_MIN, options_fd.GRID_M_MAX) == (reference.M_MIN, reference.M_MAX)
    assert options_fd.GRID_STEPS_MID == reference.STEPS_MID
    assert options_fd.GRID_PECLET_MAX == reference.PECLET_MAX
    assert options_fd.PECLET_MONOTONE == reference.PECLET_MONOTONE


def test_levels_double_both_dimensions_and_keep_the_centre_a_node():
    for c in (_ctx(), _ctx(days=3, sigma=1.5), _ctx(days=1200, sigma=0.12, divs=((100, 1.0),))):
        l1, l2 = options_fd.levels(c, CFG)
        assert l1.m % 4 == 0 and l2.m == 2 * l1.m and l2.per_day == 2 * l1.per_day and l1.width == l2.width
        assert l1.m >= 16 and l1.per_day >= 1


def test_a_production_solve_is_the_kernel_solve():
    c = _ctx(divs=((30, 1.0),))
    l1, _ = options_fd.levels(c, CFG)
    b = options_fd.Budget(CFG.work_cap)
    got = options_fd.price(c, l1, b)
    assert isinstance(got, options_fd.Solved)
    v, d = options_fd.solve(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, c.divs, l1.m, l1.per_day,
                            l1.width)
    assert (got.value.hex(), got.delta.hex()) == (v.hex(), d.hex())
    assert got.units == (l1.m + 1) * l1.per_day * c.days == b.used


def test_the_work_cap_is_charged_before_the_solve_runs(monkeypatch):
    c = _ctx()
    l1, l2 = options_fd.levels(c, CFG)
    u1 = options_fd.solve_units(l1.m, l1.per_day, c.days)
    b = options_fd.Budget(u1 + 10)
    assert isinstance(options_fd.price(c, l1, b), options_fd.Solved)
    ran = []
    monkeypatch.setattr(options_fd, "solve", lambda *a, **k: ran.append(1))
    r = options_fd.price(c, l2, b)
    assert isinstance(r, options_fd.Refused) and r.reason == options_fd.R_WORK
    assert ran == [] and b.used == u1


@pytest.mark.parametrize("ctx, reason", [
    (dict(sigma=float("nan")), options_fd.R_INPUT),
    (dict(sigma=6.0), options_fd.R_INPUT),                             # outside the engine's domain
    (dict(days=0), options_fd.R_EXPIRY),
    (dict(divs=((5, 60.0), (40, 60.0))), options_fd.R_DIVIDENDS),       # X <= 0
])
def test_named_refusals(ctx, reason):
    c = _ctx(**ctx)
    l1 = options_fd.Level(240, 2, 1.0)
    r = options_fd.price(c, l1, options_fd.Budget(10**9))
    assert isinstance(r, options_fd.Refused) and r.reason == reason


def test_the_dividend_refusal_reads_tier_2s_own_words():
    assert oa.input_failure(_ctx(divs=((5, 60.0), (40, 60.0)))) == options_fd.OA_DIVIDENDS_REASON


def test_a_grid_that_is_not_monotone_is_refused():
    # high drift at low volatility: the reference dx meets Péclet 0.25, so a production grid coarser by more
    # than four times passes 1
    c = _ctx(rho=0.5, q=0.0, sigma=0.02, days=30, strike=100.0)
    cfg = options_fd.FDConfig(m_frac=0.2, p_frac=0.5, work_cap=10**9)
    l1, _ = options_fd.levels(c, cfg)
    assert options_fd.peclet(c.rho, c.q, c.sigma, l1.m, l1.width) > 1.0
    b = options_fd.Budget(10**9)
    r = options_fd.price(c, l1, b)
    assert isinstance(r, options_fd.Refused) and r.reason == options_fd.R_PECLET and b.used == 0


def test_a_penalty_step_at_its_cap_is_refused(monkeypatch):
    monkeypatch.setattr(options_fd, "PENALTY_ITER_MAX", 1)
    c = _ctx(strike=130.0, rho=0.08)
    l1, _ = options_fd.levels(c, CFG)
    r = options_fd.price(c, l1, options_fd.Budget(10**9))
    assert isinstance(r, options_fd.Refused) and r.reason == options_fd.R_PENALTY


def test_a_non_finite_result_is_refused(monkeypatch):
    real = options_fd.solve

    def bad(*a, **k):
        v, d = real(*a, **k)
        return float("nan"), d
    monkeypatch.setattr(options_fd, "solve", bad)
    c = _ctx()
    l1, _ = options_fd.levels(c, CFG)
    r = options_fd.price(c, l1, options_fd.Budget(10**9))
    assert isinstance(r, options_fd.Refused) and r.reason == options_fd.R_NONFINITE


def test_the_config_rejects_impossible_settings():
    with pytest.raises(ValueError):
        options_fd.FDConfig(m_frac=0.0, p_frac=0.5, work_cap=1)
    with pytest.raises(ValueError):
        options_fd.FDConfig(m_frac=0.5, p_frac=1.5, work_cap=1)
    with pytest.raises(ValueError):
        options_fd.FDConfig(m_frac=0.5, p_frac=0.5, work_cap=0)


def test_the_day_1_level_keeps_its_pre_projection_values():
    g = {}
    _ref_solve(is_call=False, strike=120.0, days=30, rho=0.08, q=0.0, sigma=0.25, divs=(), grids=g)
    assert g["free_day1"] is not None and g["free_day1"].shape == g["v_day1"].shape
    ex1 = np.maximum(120.0 - g["xs"], 0.0)
    assert np.array_equal(g["v_day1"], np.maximum(g["free_day1"], ex1))
    g1 = {}
    _ref_solve(is_call=False, strike=120.0, days=1, rho=0.08, q=0.0, sigma=0.25, divs=(), per_day=4, grids=g1)
    assert g1["free_day1"] is None and g1["v_day1"] is None
