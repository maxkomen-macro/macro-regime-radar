"""The lattice's opt-in step-2 node diagnostics (Phase 3, P3-A7: second-step node gamma; design section 16).

`_lattice(..., with_nodes=True)` also returns the three step-2 nodes. The default must change nothing: every
comparison below runs the current code and the verbatim pre-change file (tests/fixtures/options_pre_phase3/,
checked by its git blob id) in the same process and compares every bit, for the raw lattice, Tier 1's american()
and served answers, and Tier 2's answers. A recorded float.hex constant is not portable across platforms, so
nothing here pins one.
"""

from __future__ import annotations

import ast
import math
from pathlib import Path

import numpy as np
import pytest

from scripts.options_bench import cases, golden
from src.desk import options_adaptive as oa
from src.desk import options_engine as oe
from src.desk import options_math as om
from tests.fixtures import options_pre_phase3 as frozen

REPO = Path(__file__).resolve().parent.parent
PRE_FILE, PRE_BLOB = "options_math_2ff3e8b.py", "8f1384590ce12278266818f956a72c06b00ce6f9"


def test_the_frozen_pre_change_options_math_is_the_verbatim_2ff3e8b_file():
    assert frozen.blob_id(PRE_FILE) == PRE_BLOB


@pytest.fixture(scope="module")
def old_om():
    return frozen.load(PRE_FILE, PRE_BLOB)


# Batches sharing (days, steps): calls and puts, carry, negative rates, dividends on day 0, day 1, inside the
# first two steps' days and later, a close on the last built layer, smoothing on and off.
BATCHES = [
    (30, 60, [(True, 1.0, 0.03, 0.0, 0.3, []), (False, 1.05, 0.05, 0.0, 0.3, []), (True, 0.9, 0.04, 0.08, 0.4, []),
              (False, 1.2, -0.01, 0.0, 0.25, []), (True, 0.95, 0.02, -0.03, 0.5, [])]),
    (40, 80, [(True, 0.86, 0.038, 0.054, 0.51, [(0, 0.0155)]), (True, 0.97, 0.02, 0.0, 0.3, [(1, 0.012)]),
              (False, 1.02, 0.05, 0.01, 0.3, [(1, 0.008), (20, 0.01)]), (True, 0.9, 0.06, 0.0, 0.35, [(39, 0.02)]),
              (False, 1.3, 0.01, 0.0, 0.2, [(0, 0.02)])]),
    (163, 326, [(True, 0.8965, 0.054, 0.0467, 0.753, [(12, 0.007), (42, 0.014), (72, 0.0053), (102, 0.0091),
                                                     (132, 0.01), (162, 0.0133)])]),
    (5, 20, [(False, 1.1, 0.08, 0.0, 0.2, []), (True, 1.0, 0.01, 0.02, 2.0, [(2, 0.01)])]),
]


def _call(mod, batch, **kw):
    days, steps, rows = batch
    return mod._lattice([r[0] for r in rows], [r[1] for r in rows], np.array([r[2] for r in rows]),
                        np.array([r[3] for r in rows]), np.array([r[4] for r in rows]), [r[5] for r in rows],
                        days, steps, **kw)


def _bits(a) -> bytes:
    return np.asarray(a).tobytes()


@pytest.mark.parametrize("batch", BATCHES)
@pytest.mark.parametrize("with_cont", [False, True])
@pytest.mark.parametrize("smooth", [False, True])
def test_the_default_lattice_is_bit_identical_to_before(batch, with_cont, smooth, old_om):
    new = _call(om, batch, with_cont=with_cont, smooth_divs=smooth)
    old = _call(old_om, batch, with_cont=with_cont, smooth_divs=smooth)
    assert len(new) == len(old) == (4 if with_cont else 3)
    for a, b in zip(new, old):
        assert a.dtype == b.dtype and _bits(a) == _bits(b)


@pytest.mark.parametrize("batch", BATCHES)
@pytest.mark.parametrize("with_cont", [False, True])
@pytest.mark.parametrize("smooth", [False, True])
def test_asking_for_the_nodes_changes_no_other_output(batch, with_cont, smooth):
    plain = _call(om, batch, with_cont=with_cont, smooth_divs=smooth)
    withn = _call(om, batch, with_cont=with_cont, smooth_divs=smooth, with_nodes=True)
    assert len(withn) == len(plain) + 1
    for a, b in zip(plain, withn[:-1]):
        assert _bits(a) == _bits(b)
    nodes = withn[-1]
    assert set(nodes) == {"spot", "value", "cont", "exercise"}
    m = len(batch[2])
    for k in nodes:
        assert nodes[k].shape == (m, 3), k


@pytest.mark.parametrize("batch", BATCHES)
def test_the_step_2_nodes_are_the_lattice_s_own(batch):
    days, steps, rows = batch
    *_, nodes = _call(om, batch, with_nodes=True)
    per = steps // days
    dt = (days / om.YEAR_DAYS) / steps
    for r, (is_call, k, rho, q, sig, divs) in enumerate(rows):
        # S at step 2 = S*_0·u^j·d^(2−j) + PV at step 2 of the dividends still owed there (cum through their close)
        esc0 = sum(a * math.exp(-rho * d * per * dt) for d, a in divs)
        esc2 = sum(a * math.exp(-rho * (d * per - 2) * dt) for d, a in divs if d * per >= 2)
        nu, s = (rho - q - 0.5 * sig * sig) * dt, sig * math.sqrt(dt)
        for j in range(3):
            want = (1.0 - esc0) * math.exp(2 * nu + (2 * j - 2) * s) + esc2
            assert nodes["spot"][r, j] == pytest.approx(want, rel=1e-13)
        sgn = 1.0 if is_call else -1.0
        exv = sgn * (nodes["spot"][r] - k)
        assert np.allclose(nodes["value"][r], np.maximum(nodes["cont"][r], exv), rtol=1e-14, atol=1e-16)
        # the lattice forms the exercise value as a_i·(u/d)^j + b_i, which rounds differently from sgn·(S − K):
        # the flags agree wherever the two sides are apart by more than rounding
        clear = np.abs(exv - nodes["cont"][r]) > 1e-13
        assert np.array_equal(nodes["exercise"][r][clear], (exv >= nodes["cont"][r])[clear])
    assert np.all(np.diff(nodes["spot"], axis=1) > 0)


def test_the_nodes_need_four_steps():
    with pytest.raises(ValueError, match="steps >= 4"):
        om._lattice([True], [1.0], np.array([0.03]), np.array([0.0]), np.array([0.3]), [[]], 3, 3, with_nodes=True)
    om._lattice([True], [1.0], np.array([0.03]), np.array([0.0]), np.array([0.3]), [[]], 4, 4, with_nodes=True)


def _swap_lattice(monkeypatch, old_om):
    monkeypatch.setattr(om, "_lattice", old_om._lattice)


def _sample() -> list:
    return [c for g in cases.GROUPS for c in (cases.case(20261026, g, i) for i in range(3))] + list(cases.NAMED[:12])


def test_tier_1_answers_are_bit_identical_to_before(monkeypatch, old_om):
    sample = _sample()
    new = [golden.answer_json(oe.baseline(oe_ctx(c))) for c in sample]
    _swap_lattice(monkeypatch, old_om)
    old = [golden.answer_json(oe.baseline(oe_ctx(c))) for c in sample]
    assert _canon(new) == _canon(old)


def test_tier_2_answers_are_bit_identical_to_before(monkeypatch, old_om):
    sample = [c for c in _sample() if c.days <= 400][:20]
    new = [_t2(c) for c in sample]
    _swap_lattice(monkeypatch, old_om)
    old = [_t2(c) for c in sample]
    assert _canon(new) == _canon(old)


def oe_ctx(c) -> om.Context:
    return om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))


def _t2(c):
    a = oa.price(oe_ctx(c))
    return golden.answer_json(a)


def _canon(x):
    """Floats by their bits, so NaN equals NaN and -0.0 differs from 0.0."""
    if isinstance(x, dict):
        return {k: _canon(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_canon(v) for v in x]
    if isinstance(x, float):
        return ("f", x.hex())
    return x


def test_only_the_phase_3_diagnostics_ask_for_the_nodes():
    # no served or Tier 2 caller passes with_nodes; the protected modules and the API never name it except
    # options_math.py's own definition
    for path in [REPO / "src" / "desk" / "options_finder.py", REPO / "src" / "desk" / "options_adaptive.py",
                 REPO / "src" / "desk" / "options_engine.py"] + sorted((REPO / "api").rglob("*.py")):
        assert "with_nodes" not in path.read_text(), path
    tree = ast.parse((REPO / "src" / "desk" / "options_math.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                assert kw.arg != "with_nodes", ast.unparse(node)
