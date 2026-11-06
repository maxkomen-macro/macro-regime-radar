"""Desk P1d: optional 80% and 95% intervals beside the engine's 90%
(docs/desk/INTERVALS_SPEC.md). The 80/95 pairs are read off the same
resampled medians by the 90%'s own rule, on a side channel of the traced
runs; the native dict, the draws and the verdicts are unchanged."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from src.desk import event_study as es
from tests.test_desk_native_regression import CATALOG_QUERIES, PINS, TIER2, _canonical, _run_pinned
from tests.test_event_study import _synthetic_db


# The two percentile lines of judge_exclusion as they stood before P1d (main 8f80eef9), copied here and not
# derived from the new helper: the independent oracle DR-01 asks for.
def _frozen_ci90(deltas: np.ndarray, ci: float = 0.90) -> list[float]:
    tail = (1.0 - ci) / 2.0 * 100.0
    lo = float(np.percentile(deltas, tail, method="lower"))
    hi = float(np.percentile(deltas, 100.0 - tail, method="higher"))
    return [float(lo), float(hi)]


def _oracle_arrays() -> list[np.ndarray]:
    rng = np.random.default_rng(7)
    arrays = [
        np.arange(21, dtype=float),            # integral percentile index: a literal 5 and 4.999999999999999 differ
        np.arange(-10, 11, dtype=float),
        np.arange(41, dtype=float) / 1000.0,
        np.repeat([-0.02, 0.0, 0.01], [3, 9, 9]),  # ties, as few blocks give
        np.array([0.0]),
        np.full(5, 1e-12),
        rng.normal(0, 0.03, 10_000),
        rng.normal(0, 0.03, 21),
        rng.normal(0, 0.03, 3125),             # 5 blocks, exact
    ]
    return arrays


def test_the_tail_expression_is_kept_exactly():
    # DR-01: the tail at 0.90 is not a literal 5, and the helper keeps it so
    assert (1.0 - 0.90) / 2.0 * 100.0 == 4.999999999999999
    d = np.arange(21, dtype=float)
    assert float(np.percentile(d, 5, method="lower")) != float(np.percentile(d, 4.999999999999999, method="lower"))
    assert es.interval_bounds(d, 0.90) == tuple(_frozen_ci90(d))


@pytest.mark.parametrize("i", range(len(_oracle_arrays())))
def test_ninety_percent_bounds_are_the_frozen_lines(i):
    d = _oracle_arrays()[i]
    want = _frozen_ci90(d)
    assert list(es.interval_bounds(d, es.CI_LEVEL)) == want
    for point in (0.01, -0.01, 0.0):
        assert es.judge_exclusion(d, point)["ci90"] == want


@pytest.mark.parametrize("i", range(len(_oracle_arrays())))
def test_the_levels_nest_and_are_resampled_values(i):
    d = _oracle_arrays()[i]
    ci80, ci95 = (es.optional_intervals(d)[k] for k in ("80", "95"))
    ci90 = es.interval_bounds(d, 0.90)
    assert ci95[0] <= ci90[0] <= ci80[0] <= ci80[1] <= ci90[1] <= ci95[1]
    values = set(d.tolist())
    for lo, hi in (ci80, ci95):
        assert lo in values and hi in values
    # the levels use the same expression at 0.80 and 0.95
    assert ci80 == es.interval_bounds(d, 0.80) and ci95 == es.interval_bounds(d, 0.95)


def test_minus_ten_to_ten_reads_as_the_reviewed_example():
    d = np.arange(-10, 11, dtype=float)
    assert es.optional_intervals(d) == {"80": (-9.0, 8.0), "95": (-10.0, 10.0)}
    assert es.interval_bounds(d, 0.90) == (-10.0, 9.0)


def test_an_overflow_keeps_todays_ninety_and_nulls_the_optional_pairs():
    # DR-04: five moves of 1e308 resample to a median of inf; the 90% path returns what it did, no raise
    ev = np.full(5, 1e308)
    entries = np.array([0, 10, 20, 30, 40])
    sink: dict = {}
    with np.errstate(over="ignore", invalid="ignore"):
        plain = es.horizon_stats(ev, entries, np.array([0.0]), 5, np.random.default_rng(1))
        traced = es.horizon_stats(ev, entries, np.array([0.0]), 5, np.random.default_rng(1), sink=sink)
    assert json.dumps(plain, default=str) == json.dumps(traced, default=str)
    assert plain["ci90"] == [math.inf, math.inf]
    assert sink[5] == {"80": None, "95": None}


def test_a_mixed_array_nulls_only_the_level_that_reaches_infinity():
    # DR-05: the 90% and 80% pairs are finite, the 95% upper bound is inf
    d = np.concatenate([np.arange(96, dtype=float), np.full(4, np.inf)])
    assert es.interval_bounds(d, 0.90) == (4.0, 95.0)
    got = es.optional_intervals(d)
    assert got["80"] is not None and all(math.isfinite(x) for x in got["80"])
    assert got["95"] is None


def test_no_interval_means_no_pairs():
    rng = np.random.default_rng(3)
    for ev, entries, base in (
        (np.array([]), np.array([], dtype=int), np.array([0.0])),            # no events
        (np.array([0.01, 0.02]), np.array([0, 50]), np.array([])),           # no baseline
        (np.array([0.01, 0.02, 0.03]), np.array([0, 50, 100]), np.array([0.0])),  # 3 blocks < 5
    ):
        sink: dict = {}
        out = es.horizon_stats(ev, entries, base, 5, rng, sink=sink)
        assert out["ci90"] is None and sink[5] is None


def test_the_sink_draws_nothing_extra():
    ev = np.random.default_rng(11).normal(0, 0.02, 60)
    entries = np.arange(60) * 30  # 60 blocks: Monte Carlo
    base = np.random.default_rng(12).normal(0, 0.02, 500)
    a, b = np.random.default_rng(5), np.random.default_rng(5)
    plain = es.horizon_stats(ev, entries, base, 5, a)
    sink: dict = {}
    traced = es.horizon_stats(ev, entries, base, 5, b, sink=sink)
    assert plain == traced
    assert a.bit_generator.state == b.bit_generator.state
    assert set(sink[5]) == {"80", "95"}


# ── the traced runs on the synthetic store ─────────────────────────────────

@pytest.fixture(scope="module")
def synth(tmp_path_factory):
    return _synthetic_db(tmp_path_factory.mktemp("p1d") / "synth.db")


@pytest.mark.parametrize("slug", [s for s in CATALOG_QUERIES if s not in TIER2])
def test_every_catalog_run_carries_nested_pairs_beside_an_unchanged_dict(synth, slug):
    conn = es._connect(synth)
    try:
        q = es.parse_slug(slug)
        plain = _run_pinned(conn, q)
        traced, table, _ = _run_pinned(conn, q, traced=True)
    finally:
        conn.close()
    assert _canonical(traced) == _canonical(plain)
    assert set(table.intervals) == {H["h"] for H in plain["horizons"]}
    for H in plain["horizons"]:
        pairs = table.intervals[H["h"]]
        if H["ci90"] is None:
            assert pairs is None
            continue
        assert set(pairs) == {"80", "95"}, "never a 90 pair: the 90% is the native ci90"
        lo90, hi90 = H["ci90"]
        assert pairs["95"][0] <= lo90 <= pairs["80"][0] <= pairs["80"][1] <= hi90 <= pairs["95"][1]


def test_the_tables_pairs_are_read_only_and_default_empty(synth):
    _, table, _ = es.run_traced(es.PRESETS["gold-2sigma-spx-weak"], synth, as_of=PINS["as_of"])
    with pytest.raises(TypeError):
        table.intervals[20] = None  # type: ignore[index]
    h = next(h for h, v in table.intervals.items() if v is not None)
    with pytest.raises(TypeError):
        table.intervals[h]["80"] = (0.0, 0.0)  # type: ignore[index]
    assert es.EventTable.__dataclass_fields__["intervals"].default_factory() == {}
