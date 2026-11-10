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
