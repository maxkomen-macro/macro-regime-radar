"""src/desk/technicals.py (desk/books): the one level-technicals function the
Desk reads, over the shared indicators of src/analytics/technicals
(desk/fill-compute). /technicals' fields are pinned by
tests/test_desk_v2_technicals.py through api/desk_items; these check the
basket's extras by hand, and the shared RSI and realized volatility they read."""

from __future__ import annotations

import math
import statistics

import numpy as np
import pandas as pd
import pytest

from src.analytics import technicals as ind
from src.desk import technicals as tech

nan = math.nan


def rsi(px) -> np.ndarray:
    return ind.rsi(pd.Series(np.asarray(px, dtype=float))).to_numpy()


def test_rsi_by_wilders_rule():
    up = np.arange(10.0, 25.0)  # 15 closes, 14 changes of +1
    assert np.isnan(rsi(up)[:14]).all() and rsi(up)[14] == 100.0
    assert rsi(up[::-1])[14] == 0.0
    assert rsi(np.full(15, 7.0))[14] == 50.0
    # Seven up and seven down: gains and losses average 0.5, RSI 50. Then +2:
    # gain (0.5·13 + 2) / 14 = 0.607143, loss 0.5·13 / 14 = 0.464286, RS 1.307692, RSI 56.666667.
    px = np.array([10.0, 11, 12, 13, 14, 15, 16, 17, 16, 15, 14, 13, 12, 11, 10, 12])
    r = rsi(px)
    assert r[14] == pytest.approx(50.0) and r[15] == pytest.approx(56.666667, abs=1e-6)


def test_a_missing_close_restarts_the_rsi():
    px = np.concatenate([np.arange(10.0, 25.0), [nan], np.arange(30.0, 44.0)])
    r = rsi(px)
    assert r[14] == 100.0 and np.isnan(r[15:]).all()  # 14 closes after the gap: 13 changes, not yet 14
    r2 = rsi(np.concatenate([px, [45.0]]))
    assert r2[-1] == 100.0


def test_drawdown_from_the_running_peak():
    dd, at = tech.drawdowns(np.array([nan, 100.0, 120, 90, 130, 104]))
    assert np.isnan(dd[0]) and list(dd[1:]) == pytest.approx([0.0, 0.0, -0.25, 0.0, -0.2])
    assert list(at) == [-1, 1, 2, 2, 4, 4]


def test_realized_vol_is_the_sample_sd_of_21_log_returns_annualized():
    rng = np.random.default_rng(3)
    px = 100 * np.exp(np.cumsum(np.concatenate([[0.0], rng.normal(0, 0.02, 30)])))
    r = [math.log(px[i] / px[i - 1]) for i in range(10, 31)]
    rv = ind.realized_vol(pd.Series(px)).to_numpy() / 100.0  # the shared function answers in points
    assert rv[30] == pytest.approx(statistics.stdev(r) * math.sqrt(252))
    assert np.isfinite(rv[21]) and np.isnan(rv[20])  # 21 returns need 22 closes: positions 0 to 21
    gap = px.copy()
    gap[15] = nan
    assert np.isnan(ind.realized_vol(pd.Series(gap)).to_numpy()[30])


def _index(n: int, end: str = "2026-09-25") -> pd.Series:
    from src.desk import event_study as es

    cal = es.session_calendar("2023-01-01", end)
    s = es.sessions_between(cal, "2023-06-01", end)[-n:]
    rng = np.random.default_rng(5)
    return pd.Series(100 * np.cumprod(1 + rng.normal(0.0008, 0.015, n)), index=s)


def test_the_extras_add_to_the_shared_fields_and_change_none():
    raw = _index(420)
    plain = tech.level_technicals(raw, spec=tech.PRICE_SPEC, ranges={"6m": 6, "1y": 12})
    full = tech.level_technicals(raw, spec=tech.PRICE_SPEC, ranges={"6m": 6, "1y": 12}, extras=True)
    for k, v in plain.items():
        if k == "_aligned":
            assert full[k].equals(v)
        elif k == "series":
            for r, pts in v.items():
                assert [{kk: p[kk] for kk in ("date", "close", "ma50", "ma200")} for p in full["series"][r]] == pts
        else:
            assert full[k] == v, k
    assert set(full) - set(plain) == {"rsi", "rsi_date", "drawdown", "realized_vol_21d", "realized_vol_window", "crosses"}
    px = raw.to_numpy()
    assert full["rsi"] == pytest.approx(rsi(px)[-1])
    assert full["drawdown"]["now"] == pytest.approx(px[-1] / px.max() - 1)
    assert full["realized_vol_21d"] == pytest.approx(ind.realized_vol(pd.Series(px)).iloc[-1] / 100.0)
    assert full["realized_vol_window"]["n"] == 21 and full["realized_vol_window"]["end"] == full["date"]
    assert all(p["rsi"] is None or 0 <= p["rsi"] <= 100 for p in full["series"]["1y"])
    assert full["cross"] in (full["crosses"][-1:] or [None]) or full["cross"] is None
