"""The basket engine (src/desk/basket.py, desk/books): pure functions over
price histories. The first two tests are worked by hand, two stocks over five
sessions; every expected number below is in the comments beside it."""

from __future__ import annotations

import math

import numpy as np
import pytest

from src.desk import basket as bk

D5 = ("2026-01-28", "2026-01-29", "2026-01-30", "2026-02-02", "2026-02-03")


def _xnys(start: str, end: str) -> list[str]:
    from src.desk import event_study as es

    return [d.strftime("%Y-%m-%d") for d in es.sessions_between(es.session_calendar(start, end), start, end)]


# The XNYS calendar the engine reads (the API passes exchange_calendars' sessions).
CAL = _xnys("2026-01-02", "2026-03-31")


def H(dates, close, dv=None, traded=None):
    """A History; the close as traded is the adjusted close unless given (no split or dividend in the window)."""
    traded = close if traded is None else traded
    return bk.History(tuple(dates), tuple(float(c) for c in close), tuple(dv if dv is not None else [None] * len(dates)),
                      tuple(None if t is None else float(t) for t in traded))


def two_stocks():
    # A: 10, 11, 12, 11, 13 with $1,000 traded a day; B: 20, 20, 22, 24, 22 with $400 a day.
    return {"A": H(D5, [10, 11, 12, 11, 13], [1000.0] * 5), "B": H(D5, [20, 20, 22, 24, 22], [400.0] * 5)}


def test_hand_checked_buy_and_hold_two_stocks_five_sessions():
    r = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL, adv_sessions=5)
    # Shares at the start: A 500 / 10 = 50, B 500 / 20 = 25.
    # Value: 50·10 + 25·20 = 1000; 550 + 500 = 1050; 600 + 550 = 1150; 550 + 600 = 1150; 650 + 550 = 1200.
    assert r["index"] == pytest.approx([100.0, 105.0, 115.0, 115.0, 120.0])
    assert r["start"] == "2026-01-28" and r["end"] == "2026-02-03" and r["sessions"] == 5 and r["rebalances"] == 1
    assert r["total_return"] == pytest.approx(0.20)
    a, b = r["legs"]
    # Contribution: A 50 × (13 − 10) / 1000 = 0.15; B 25 × (22 − 20) / 1000 = 0.05; together the 20%.
    assert a["contribution"] == pytest.approx(0.15) and b["contribution"] == pytest.approx(0.05)
    assert a["contribution"] + b["contribution"] == pytest.approx(r["total_return"])
    # Weights at the last close: A 650 / 1200, B 550 / 1200.
    assert a["weight_now"] == pytest.approx(650 / 1200) and b["weight_now"] == pytest.approx(550 / 1200)
    assert a["shares_now"] == pytest.approx(50.0) and b["shares_now"] == pytest.approx(25.0)
    assert a["return"] == pytest.approx(0.30) and b["return"] == pytest.approx(0.10)
    c = r["concentration"]
    # Two names: the top three hold everything; 1 / (0.541667² + 0.458333²) = 1 / 0.503472 = 1.986207.
    assert c["top3_share"] == pytest.approx(1.0) and c["top3"] == ["A", "B"]
    assert c["effective_n"] == pytest.approx(1.986207, abs=1e-6)
    # Four returns are fewer than the 60 a correlation needs.
    assert c["avg_pairwise_corr"] is None and c["corr_window"] == {"start": "2026-01-28", "end": "2026-02-03", "n": 4}
    # Liquidity at 20% of the 5-session average: A $500 / (0.2 × 1000) = 2.5 days; B $500 / (0.2 × 400) = 6.25 days.
    assert a["adv_usd"] == pytest.approx(1000.0) and a["days_to_trade"] == pytest.approx(2.5)
    assert b["adv_usd"] == pytest.approx(400.0) and b["days_to_trade"] == pytest.approx(6.25)
    assert r["liquidity"]["basket_days"] == pytest.approx(6.25) and r["liquidity"]["binding"] == "B"


def test_hand_checked_monthly_rebalance_two_stocks_five_sessions():
    r = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, "monthly", 1000.0, sessions=CAL, adv_sessions=5)
    # Jan 30 is January's last session: the counts reset there to half of 1150 each.
    # A 575 / 12 = 47.916667, B 575 / 22 = 26.136364.
    # Feb 2: 47.916667·11 + 26.136364·24 = 527.083333 + 627.272727 = 1154.356061.
    # Feb 3: 47.916667·13 + 26.136364·22 = 622.916667 + 575.000000 = 1197.916667.
    assert r["rebalances"] == 2 and r["periods"] == [{"from": "2026-01-28", "to": "2026-01-30"}, {"from": "2026-01-30", "to": "2026-02-03"}]
    assert r["index"] == pytest.approx([100.0, 105.0, 115.0, 115.4356061, 119.7916667])
    a, b = r["legs"]
    # A: 50 × 2 / 1000 + 47.916667 × 1 / 1000 = 0.147917; B: 25 × 2 / 1000 + 26.136364 × 0 = 0.05.
    assert a["contribution"] == pytest.approx(0.1479166667) and b["contribution"] == pytest.approx(0.05)
    assert a["contribution"] + b["contribution"] == pytest.approx(r["total_return"])
    # Weights at the last close: 622.916667 / 1197.916667 and 575 / 1197.916667.
    assert a["weight_now"] == pytest.approx(0.5200) and b["weight_now"] == pytest.approx(0.4800)


def test_the_start_is_the_first_session_every_name_has_a_close_and_says_whose():
    h = {"OLD": H(D5, [10, 11, 12, 11, 13]), "NEW": H(D5[2:], [5, 6, 7])}
    r = bk.price_basket(h, {"OLD": 0.6, "NEW": 0.4}, "hold", 100.0, sessions=CAL)
    assert r["start"] == "2026-01-30" and r["start_binding"] == ["NEW"] and r["start_is_first_close"] is True
    # OLD 60 / 12 = 5 shares, NEW 40 / 5 = 8: 100, 5·11 + 8·6 = 103, 5·13 + 8·7 = 121.
    assert r["index"] == pytest.approx([100.0, 103.0, 121.0])
    same = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, sessions=CAL)
    assert same["start_binding"] == ["A", "B"] and same["start_is_first_close"] is False


def test_a_session_one_name_lacks_is_dropped_never_filled():
    h = {"A": H(D5, [10, 11, 12, 11, 13]), "B": H(D5[:3] + D5[4:], [20, 20, 22, 22])}
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL)
    assert r["dates"] == [D5[0], D5[1], D5[2], D5[4]] and r["missing_sessions"] == [D5[3]]
    assert r["index"] == pytest.approx([100.0, 105.0, 115.0, 120.0])


def test_codex_r04_one_name_without_adv_leaves_the_basket_figure_unserved():
    """Codex's repro: $1 million, 50/50, A's ADV $1 million, one missing volume for B. The basket named A the
    slowest at 2.5 days while B's days were null; the basket-wide figure now needs every name's."""
    h = two_stocks()
    h["B"] = H(D5, [20, 20, 22, 24, 22], [400.0, None, 400.0, 400.0, 400.0])
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL, adv_sessions=5)
    assert r["legs"][1]["adv_usd"] is None and r["legs"][1]["days_to_trade"] is None and r["legs"][1]["adv_missing"] == 1
    assert r["legs"][0]["days_to_trade"] == pytest.approx(2.5)
    q = r["liquidity"]
    assert q["basket_days"] is None and q["binding"] is None and q["missing"] == ["B"]
    assert q["reason"] == "B has no dollar volume on every one of the 5 sessions from 2026-01-28 to 2026-02-03; the basket's figure needs every name's"
    assert r["legs"][1]["adv_window"] == {"start": D5[0], "end": D5[4], "n": 4}


def test_codex_r05_adv_reads_the_trailing_20_xnys_sessions_not_the_last_20_rows():
    """Codex's repro: the 21 XNYS sessions from January 2 to February 2, 2026 with January 16 removed, $1 million
    a day otherwise. The last 20 rows looked complete; the trailing 20 sessions include January 16, so the ADV
    is not served and says one session is missing."""
    days = [d for d in _xnys("2026-01-02", "2026-02-02")]
    assert len(days) == 21
    kept = [d for d in days if d != "2026-01-16"]
    h = {"A": H(kept, [10.0] * 20, [1e6] * 20)}
    r = bk.price_basket(h, {"A": 1.0}, "hold", 1e6, sessions=CAL)
    leg = r["legs"][0]
    assert leg["adv_usd"] is None and leg["adv_missing"] == 1
    assert leg["adv_window"] == {"start": "2026-01-05", "end": "2026-02-02", "n": 19}
    assert r["liquidity"]["basket_days"] is None and r["liquidity"]["missing"] == ["A"]
    full = bk.price_basket({"A": H(days, [10.0] * 21, [1e6] * 21)}, {"A": 1.0}, "hold", 1e6, sessions=CAL)
    assert full["legs"][0]["adv_usd"] == pytest.approx(1e6) and full["liquidity"]["binding"] == "A"


def test_pairwise_mean_corr_by_hand():
    x = np.array([1.0, 2.0, 3.0, 4.0])
    # (x, 2x) = 1, (x, −x) = −1, (2x, −x) = −1: mean −1/3.
    assert bk.pairwise_mean_corr(np.column_stack([x, 2 * x, -x])) == pytest.approx(-1 / 3)
    assert bk.pairwise_mean_corr(np.column_stack([x])) is None
    assert bk.pairwise_mean_corr(np.column_stack([x, np.ones(4)])) is None


def test_the_correlation_reads_the_last_252_returns_and_needs_60():
    rng = np.random.default_rng(7)
    n = 300
    dates = [f"S{i:04d}" for i in range(n)]
    common = rng.normal(0, 0.01, n - 1)
    lv = lambda eps: np.concatenate([[100.0], 100.0 * np.cumprod(1 + common + eps)])
    h = {s: H(dates, lv(rng.normal(0, 0.01, n - 1))) for s in ("A", "B", "C")}
    r = bk.price_basket(h, {"A": 0.5, "B": 0.25, "C": 0.25}, sessions=dates)
    c = r["concentration"]
    assert c["corr_window"] == {"start": dates[-253], "end": dates[-1], "n": 252}
    px = np.column_stack([h[s].close for s in "ABC"])
    rets = px[1:] / px[:-1] - 1
    cc = np.corrcoef(rets[-252:], rowvar=False)
    assert c["avg_pairwise_corr"] == pytest.approx((cc[0, 1] + cc[0, 2] + cc[1, 2]) / 3)
    short = {s: H(dates[:61], h[s].close[:61]) for s in "ABC"}
    assert bk.price_basket(short, {"A": 0.5, "B": 0.25, "C": 0.25}, sessions=dates)["concentration"]["avg_pairwise_corr"] is not None
    shorter = {s: H(dates[:60], h[s].close[:60]) for s in "ABC"}
    assert bk.price_basket(shorter, {"A": 0.5, "B": 0.25, "C": 0.25}, sessions=dates)["concentration"]["avg_pairwise_corr"] is None


def test_top_three_and_effective_names_read_the_weights_at_the_last_close():
    h = {s: H(D5, [10, 10, 10, 10, 10 * (1 + i)]) for i, s in enumerate("ABCD")}
    r = bk.price_basket(h, {s: 0.25 for s in "ABCD"}, "hold", 1000.0, sessions=CAL)
    # Last close: A 250, B 500, C 750, D 1000 of 2500: weights .1 .2 .3 .4.
    assert [round(l["weight_now"], 12) for l in r["legs"]] == [0.1, 0.2, 0.3, 0.4]
    assert r["concentration"]["top3"] == ["D", "C", "B"] and r["concentration"]["top3_share"] == pytest.approx(0.9)
    assert r["concentration"]["effective_n"] == pytest.approx(1 / 0.30)


@pytest.mark.parametrize("weights, words", [
    ({"A": 0.5, "B": 0.4}, "add to 90%"),
    ({"A": 1.0, "B": 0.0}, "weight of B"),
    ({"A": 0.5, "B": math.nan}, "weight of B"),
    ({}, "at least one name"),
])
def test_weights_must_be_positive_and_add_to_one(weights, words):
    with pytest.raises(bk.BasketError, match=words):
        bk.check_weights(weights)


def test_refusals_name_what_is_wrong():
    h = two_stocks()
    with pytest.raises(bk.BasketError, match="method"):
        bk.price_basket(h, {"A": 0.5, "B": 0.5}, "weekly", sessions=CAL)
    with pytest.raises(bk.BasketError, match="notional"):
        bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 0, sessions=CAL)
    with pytest.raises(bk.BasketError, match="different symbols"):
        bk.price_basket(h, {"A": 0.5, "C": 0.5}, sessions=CAL)
    with pytest.raises(bk.BasketError, match="share no session"):
        bk.price_basket({"A": H(D5[:2], [1, 2]), "B": H(D5[3:], [1, 2])}, {"A": 0.5, "B": 0.5}, sessions=CAL)
    with pytest.raises(bk.BasketError, match="positive"):
        H(D5[:2], [1, -2])
    with pytest.raises(bk.BasketError, match="ascending"):
        H([D5[1], D5[0]], [1, 2])


# ── Against a benchmark (item 3) ─────────────────────────────────────────────

def _levels(dates, rets, start=100.0):
    out, v = {}, start
    for d, r in zip(dates, [0.0] + list(rets)):
        v *= 1 + r
        out[d] = v
    return out


def test_regression_by_hand_a_basket_that_moves_twice_its_benchmark():
    dates = [f"S{i:03d}" for i in range(61)]
    rng = np.random.default_rng(1)
    x = rng.normal(0, 0.01, 60)
    r = bk.regression(_levels(dates, 2 * x), _levels(dates, x), 60, dates)
    assert r["beta"] == pytest.approx(2.0) and r["corr"] == pytest.approx(1.0) and r["r2"] == pytest.approx(1.0)
    assert r["resid_vol"] == pytest.approx(0.0, abs=1e-12) and r["vol_reduction"] == pytest.approx(1.0)
    assert r["vol"] == pytest.approx(2 * r["vol_x"])
    assert r["window"] == {"start": "S000", "end": "S060", "n": 60} and r["reason"] is None


def test_regression_needs_a_full_window_and_reads_only_common_sessions():
    dates = [f"S{i:03d}" for i in range(40)]
    y = _levels(dates, np.full(39, 0.01))
    x = _levels(dates[5:], np.full(34, 0.005))
    r = bk.regression(y, x, 60, dates)
    assert r["beta"] is None and r["window"] == {"start": "S005", "end": "S039", "n": 34}
    assert r["reason"] == "needs 60 daily returns; there are 34 since S005"
    # A session one side lacks is a missing return on both sides, never one spanning the gap (Codex R-02).
    rows, ry, rx = bk.paired_returns({"a": 1.0, "b": 2.0, "c": 3.0, "d": 6.0}, {"a": 10.0, "c": 20.0, "d": 30.0}, ["a", "b", "c", "d"])
    assert list(rows) == [3] and list(ry) == [1.0] and list(rx) == [0.5]


def test_relative_series_by_hand():
    sessions = [f"S{i:03d}" for i in range(60)]
    bench = {d: 50.0 + i for i, d in enumerate(sessions)}
    basket = {d: 2 * v for d, v in bench.items()}  # always twice the benchmark
    out = bk.relative_series(sessions, basket, {"qqq": bench}, {"r": sessions[-5:]})["r"]
    assert out["base_date"] == "S055"
    first, last = out["points"][0], out["points"][-1]
    assert first["basket"] == pytest.approx(100.0) and first["qqq"] == pytest.approx(100.0)
    # S055: basket 210, QQQ 105; S059: 218 and 109. Both rebase to 100 × 109 / 105.
    assert last["basket"] == pytest.approx(100.0 * 109 / 105) and last["qqq"] == pytest.approx(100.0 * 109 / 105)
    assert last["rs_qqq"] == pytest.approx(100.0) and last["rs_qqq_ma50"] == pytest.approx(100.0)
    # The ratio's 50-session average needs 50 slots with both closes.
    early = bk.relative_series(sessions, basket, {"qqq": bench}, {"r": sessions[:3]})["r"]["points"]
    assert all(p["rs_qqq_ma50"] is None for p in early)


# ── Codex R-02, R-03, R-06: the XNYS calendar ─────────────────────────────────

def test_codex_r02_a_missing_session_is_a_missing_return_not_a_two_day_one():
    """Codex's repro: January 26-30, benchmark 100, 110, 121, 108.9, 114.345 and basket 100, missing, 144,
    115.2, 149.76. Intersecting dates first made a two-session return and a beta of 2.0513; the two valid
    one-session returns are the basket's -20% and +30% against -10% and +5%: beta 0.5 / 0.15 = 3.3333."""
    days = ["2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30"]
    bench = dict(zip(days, [100, 110, 121, 108.9, 114.345]))
    basket = dict(zip([days[0], *days[2:]], [100, 144, 115.2, 149.76]))
    r = bk.regression(basket, bench, 2, CAL)
    assert r["beta"] == pytest.approx(10 / 3) and r["window"] == {"start": "2026-01-28", "end": "2026-01-30", "n": 2}
    three = bk.regression(basket, bench, 3, CAL)
    assert three["beta"] is None and three["reason"] == "needs 3 daily returns; there are 2 since 2026-01-28"


def test_codex_r03_the_start_is_the_first_session_the_basket_is_bought_at():
    """Codex's repro: A closes on January 28 and 30, B on January 29 and 30, equal weights. The start said
    January 29 while the purchase was at January 30's closes; it is January 30, because A has no close on
    the 29th."""
    h = {"A": H(["2026-01-28", "2026-01-30"], [10, 12]), "B": H(["2026-01-29", "2026-01-30"], [20, 22])}
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL)
    assert r["start"] == "2026-01-30" and r["dates"] == ["2026-01-30"] and r["index"] == [100.0]
    assert r["start_kind"] == "gap" and r["start_binding"] == ["A"] and r["start_gap_session"] == "2026-01-29"
    assert r["start_is_first_close"] is False
    assert [l["price_start"] for l in r["legs"]] == [12.0, 22.0]


def test_codex_r06_the_final_session_rebalances_when_it_is_the_month_end():
    """Codex's repro: January 28-30, A 100, 200, 200 and B 100, 100, 100, equal targets, monthly. January 30
    is January's last session (the calendar shows February 2 next), so the counts reset there and the weights
    at the last close are 50% / 50%; appending an unchanged February 2 no longer changes January's answer."""
    days = ["2026-01-28", "2026-01-29", "2026-01-30"]
    h = {"A": H(days, [100, 200, 200]), "B": H(days, [100, 100, 100])}
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "monthly", 1000.0, sessions=CAL)
    assert [round(l["weight_now"], 12) for l in r["legs"]] == [0.5, 0.5] and r["rebalances"] == 2
    h2 = {"A": H([*days, "2026-02-02"], [100, 200, 200, 200]), "B": H([*days, "2026-02-02"], [100, 100, 100, 100])}
    r2 = bk.price_basket(h2, {"A": 0.5, "B": 0.5}, "monthly", 1000.0, sessions=CAL)
    assert [round(l["weight_now"], 12) for l in r2["legs"]] == [0.5, 0.5]
    # A month still in progress does not rebalance: with the calendar ending at January 29 nothing shows the month over.
    r3 = bk.price_basket({"A": H(days[:2], [100, 200]), "B": H(days[:2], [100, 100])}, {"A": 0.5, "B": 0.5}, "monthly", 1000.0, sessions=CAL)
    assert r3["rebalances"] == 1 and round(r3["legs"][0]["weight_now"], 6) == round(2 / 3, 6)


# ── Codex R-01: the stress reads one shared window ending at the basket's cutoff ──

def test_codex_r01_the_stress_never_reads_etf_closes_after_the_basket():
    """Codex's repro: the basket has 60 returns identical to QQQ's; SMH has those 60 and then 60 more at three
    times QQQ's. Fitting SMH on QQQ over SMH's own last 60 returns read the later ones and reported about
    +$200,000 hedged; on the shared window ending at the basket's cutoff every beta is 1 and the hedge nets $0."""
    cal = _xnys("2025-01-02", "2025-12-31")[:121]
    rng = np.random.default_rng(3)
    q = rng.normal(0, 0.01, 120)
    qqq = _levels(cal, q)
    smh = _levels(cal, np.concatenate([q[:60], 3 * q[60:]]))
    basket = _levels(cal[:61], q[:60])
    # The ETF ranking reads up to the same cutoff, and its hedge ratio is the one the stress holds (Codex R-15).
    fit = bk.hedge_rows(basket, {"SMH": smh}, 1_000_000.0, cal, cutoff=cal[60])[0]
    assert fit["beta_60d"] == pytest.approx(1.0) and fit["window_60d"]["end"] == cal[60]
    rows = bk.stress(basket, {"QQQ": qqq}, "SMH", smh, "60d", 1_000_000.0, cal, cutoff=cal[60], hedge_ratio=fit["hedge_ratio"])
    r = rows[0]
    assert r["window"] == {"start": cal[0], "end": cal[60], "n": 60}
    assert r["basket_beta"] == pytest.approx(1.0) and r["hedge_beta"] == pytest.approx(1.0) and r["hedge_ratio"] == pytest.approx(1.0)
    assert r["unhedged_usd"] == pytest.approx(-100_000.0) and r["hedged_usd"] == pytest.approx(0.0, abs=1e-6)


# ── Codex R-15: the stress holds the short the table recommends ──

def r15_case():
    """Codex's R-15 repro: 121 XNYS sessions; SMH's returns alternate −1% / +1%; the basket moves three times SMH
    for its first 60 returns and with SMH for the last 60; QQQ has only the first 61 prices, identical to SMH's."""
    cal = _xnys("2025-01-02", "2025-12-31")[:121]
    smh_r = np.array([-0.01 if i % 2 == 0 else 0.01 for i in range(120)])
    smh = _levels(cal, smh_r)
    basket = _levels(cal, np.concatenate([3 * smh_r[:60], smh_r[60:]]))
    qqq = dict(list(smh.items())[:61])
    return cal, basket, smh, qqq


def test_codex_r15_the_stress_holds_the_short_the_table_recommends():
    """The table fits the last 60 returns (beta 1) and recommends shorting $1M of SMH. QQQ's window is the first
    60 returns, the only ones it has: the basket's beta to QQQ is 3 and SMH's is 1, so the $1M short leaves
    −$200,000 hedged. Refitting the hedge on that window (beta 3, a $3M short) reported about $0."""
    cal, basket, smh, qqq = r15_case()
    top = bk.hedge_rows(basket, {"SMH": smh}, 1_000_000.0, cal, cutoff=cal[-1])[0]
    assert top["basis"] == "60d" and top["hedge_ratio"] == pytest.approx(1.0) and top["short_usd"] == pytest.approx(1_000_000.0)
    r = bk.stress(basket, {"QQQ": qqq}, "SMH", smh, top["basis"], 1_000_000.0, cal, cutoff=cal[-1],
                  hedge_ratio=top["hedge_ratio"])[0]
    assert r["window"] == {"start": cal[0], "end": cal[60], "n": 60}
    assert r["basket_beta"] == pytest.approx(3.0) and r["hedge_beta"] == pytest.approx(1.0)
    assert r["hedge_ratio"] == pytest.approx(1.0) and r["short_usd"] == pytest.approx(1_000_000.0)
    assert r["unhedged_usd"] == pytest.approx(-300_000.0) and r["hedge_usd"] == pytest.approx(100_000.0)
    assert r["hedged_usd"] == pytest.approx(-200_000.0) and r["hedged_move"] == pytest.approx(-0.2)


def test_the_stress_without_a_recommended_short_says_so():
    cal, basket, smh, qqq = r15_case()
    r = bk.stress(basket, {"QQQ": qqq}, "SMH", smh, "60d", 1e6, cal, cutoff=cal[-1], hedge_ratio=None)[0]
    assert r["short_usd"] is None and r["hedged_usd"] is None and r["reason"] == "no ETF fits the basket over a complete window"


def test_the_stress_says_why_when_the_three_share_too_few_returns():
    cal = _xnys("2025-01-02", "2025-12-31")[:61]
    q = np.full(60, 0.001)
    lv = _levels(cal, q)
    gapped = {d: v for i, (d, v) in enumerate(lv.items()) if i != 30}
    r = bk.stress(lv, {"SPY": gapped}, "SMH", lv, "60d", 1e6, cal, cutoff=cal[-1], hedge_ratio=1.0)[0]
    assert r["unhedged_usd"] is None and r["window"]["n"] == 58
    assert r["reason"] == "needs 60 daily returns the basket, SMH and SPY all have; there are 58"


# ── desk/cap-weight: weights from share counts × the start's closes ─────────

def test_hand_checked_cap_weights_from_known_shares_and_prices():
    """A has 300 shares at 10 and B 50 at 20 on the start: market values 3,000 and 1,000, so 75% and 25%."""
    r = bk.price_basket(two_stocks(), None, "hold", 1000.0, sessions=CAL, adv_sessions=5, shares_outstanding={"A": 300, "B": 50})
    a, b = r["legs"]
    assert r["weighting"] == "cap" and a["target_weight"] == pytest.approx(0.75) and b["target_weight"] == pytest.approx(0.25)
    assert a["shares_outstanding"] == 300 and a["value_start"] == pytest.approx(3000.0) and b["value_start"] == pytest.approx(1000.0)
    # Bought: A 750 / 10 = 75 shares, B 250 / 20 = 12.5, proportional to the counts (300 : 50).
    assert a["shares_now"] == pytest.approx(75.0) and b["shares_now"] == pytest.approx(12.5)
    # The index is the two companies' market value over its value at the start:
    # (300·11 + 50·20) / 4000 = 1.075; 4700 / 4000; 4500 / 4000; (300·13 + 50·22) / 4000 = 1.25.
    assert r["index"] == pytest.approx([100.0, 107.5, 117.5, 112.5, 125.0]) and r["total_return"] == pytest.approx(0.25)
    # At the last close the weights are the market values there: 3900 / 5000 and 1100 / 5000.
    assert a["weight_now"] == pytest.approx(0.78) and b["weight_now"] == pytest.approx(0.22)
    # Contribution: A 75 × 3 / 1000 = 0.225; B 12.5 × 2 / 1000 = 0.025.
    assert a["contribution"] == pytest.approx(0.225) and b["contribution"] == pytest.approx(0.025)
    # Concentration reads the weights at the last close: 1 / (0.78² + 0.22²) = 1 / 0.6568.
    assert r["concentration"]["effective_n"] == pytest.approx(1 / 0.6568) and r["concentration"]["top3"] == ["A", "B"]
    # Liquidity: a basket bought at the last close, at its market values: A $780 / (0.2 × 1000) = 3.9 days,
    # B $220 / (0.2 × 400) = 2.75 days.
    assert a["dollars"] == pytest.approx(780.0) and a["days_to_trade"] == pytest.approx(3.9)
    assert b["dollars"] == pytest.approx(220.0) and b["days_to_trade"] == pytest.approx(2.75)
    assert r["liquidity"]["basket_days"] == pytest.approx(3.9) and r["liquidity"]["binding"] == "A"
    # Typed weights say so, and carry no counts.
    t = bk.price_basket(two_stocks(), {"A": 0.75, "B": 0.25}, "hold", 1000.0, sessions=CAL, adv_sessions=5)
    assert t["weighting"] == "target" and t["legs"][0]["shares_outstanding"] is None and t["legs"][0]["value_start"] is None
    # Held, the typed 75/25 basket is the cap-weighted one: the same index (they start at the same weights).
    assert t["index"] == pytest.approx(r["index"])


def test_the_monthly_cap_reset_is_each_months_first_session_and_changes_no_holding():
    """Monthly, a cap-weighted basket resets to cap weights at the close of each month's first session after the
    start: Feb 2 here (the typed basket resets on Jan 30, January's last). With one set of counts the reset leaves
    every holding as it was, so the index is the held one."""
    held = bk.price_basket(two_stocks(), None, "hold", 1000.0, sessions=CAL, adv_sessions=5, shares_outstanding={"A": 300, "B": 50})
    r = bk.price_basket(two_stocks(), None, "monthly", 1000.0, sessions=CAL, adv_sessions=5, shares_outstanding={"A": 300, "B": 50})
    assert r["rebalances"] == 2 and r["periods"] == [{"from": "2026-01-28", "to": "2026-02-02"}, {"from": "2026-02-02", "to": "2026-02-03"}]
    assert r["index"] == pytest.approx(held["index"], abs=1e-12)
    assert [l["shares_now"] for l in r["legs"]] == pytest.approx([75.0, 12.5])
    assert sum(l["contribution"] for l in r["legs"]) == pytest.approx(r["total_return"])
    typed = bk.price_basket(two_stocks(), {"A": 0.75, "B": 0.25}, "monthly", 1000.0, sessions=CAL, adv_sessions=5)
    assert typed["periods"][0] == {"from": "2026-01-28", "to": "2026-01-30"}


def test_over_three_months_the_monthly_cap_index_is_the_held_one():
    rng = np.random.default_rng(7)
    hist = {s: H(CAL, 50 * np.cumprod(1 + rng.normal(0, 0.02, len(CAL)))) for s in ("A", "B", "C")}
    counts = {"A": 5e9, "B": 2e8, "C": 7e8}
    held = bk.price_basket(hist, None, "hold", 1e6, sessions=CAL, shares_outstanding=counts)
    monthly = bk.price_basket(hist, None, "monthly", 1e6, sessions=CAL, shares_outstanding=counts)
    # Jan 2 is the start; Feb 2 and Mar 2 are the months' first sessions.
    assert monthly["rebalances"] == 3 and [p["from"] for p in monthly["periods"]] == ["2026-01-02", "2026-02-02", "2026-03-02"]
    assert monthly["index"] == pytest.approx(held["index"], rel=1e-12)
    # Each name's weight at the last close is its market value there, both ways.
    mv = {s: counts[s] * hist[s].close[-1] for s in counts}
    for legs in (held["legs"], monthly["legs"]):
        assert [l["weight_now"] for l in legs] == pytest.approx([mv[s] / sum(mv.values()) for s in ("A", "B", "C")])


def test_cap_weight_starts_at_the_market_values_of_the_start_not_of_the_first_dates():
    """A name that lists later sets the start (Codex R-03): every weight is read on that session's closes."""
    h = {"OLD": H(D5, [10, 11, 12, 11, 13]), "NEW": H(D5[2:], [5, 6, 7])}
    r = bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"OLD": 100, "NEW": 600})
    assert r["start"] == "2026-01-30"
    # OLD 100 × 12 = 1,200 and NEW 600 × 5 = 3,000 on Jan 30: 2/7 and 5/7.
    assert [l["target_weight"] for l in r["legs"]] == pytest.approx([1200 / 4200, 3000 / 4200])


# ── desk/cap-weight, Codex R-01: market values read the close as traded ────

def test_codex_r01_a_dividend_payer_is_weighted_at_its_market_value_not_its_adjusted_close():
    """Codex R-01's case with an ordinary dividend: A and B each have 100 shares at $100 on the start. A ends at
    $200; B pays $2 and ends at $98 as traded, so its adjusted closes are 98 and 98. The market values at the start
    are 10,000 each, so 50/50 (the adjusted closes would read 10,000 and 9,800: 50.5/49.5). Reinvested across the
    basket, the basket returns 50%: A +100% and B 0% in total return, at half each."""
    d2 = D5[:2]
    h = {"A": H(d2, [100, 200]), "B": H(d2, [98, 98], traded=[100, 98])}
    r = bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    a, b = r["legs"]
    assert (a["target_weight"], b["target_weight"]) == pytest.approx((0.5, 0.5))
    assert (a["close_traded_start"], b["close_traded_start"]) == pytest.approx((100.0, 100.0))
    assert (a["value_start"], b["value_start"]) == pytest.approx((10_000.0, 10_000.0))
    assert r["index"] == pytest.approx([100.0, 150.0]) and r["total_return"] == pytest.approx(0.5)
    # At the last close the weights are the market values there, as traded: 20,000 and 9,800.
    assert (a["weight_now"], b["weight_now"]) == pytest.approx((20_000 / 29_800, 9_800 / 29_800))
    assert (a["contribution"], b["contribution"]) == pytest.approx((0.5, 0.0))
    # The liquidity's dollars are the same market values at the last close.
    assert a["dollars"] == pytest.approx(1000.0 * 20_000 / 29_800)
    # Monthly is the held basket (D4), dividend or not.
    m = bk.price_basket(h, None, "monthly", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    assert m["index"] == pytest.approx(r["index"], rel=1e-12)


def test_held_reinvests_a_dividend_across_the_basket_so_the_weights_stay_the_market_values():
    """Round 2, R2-01 (rejected; the policy kept and said on the page): Codex's case. A and B start at 100 shares and
    $100; B pays $2 on Jan 29 (98 as traded and adjusted after); A doubles on Jan 30. The dividend is reinvested
    across the basket at the market values (A 10,000, B 9,800), so the basket ends at 100 × (10,000 × 2 + 9,800) /
    19,800 = 150.505; kept in B instead it would end at 150, its weights off the market values, and a monthly reset
    would then differ from held (D4). Without a dividend the reset changes nothing: the one trade is the dividend's."""
    d3 = D5[:3]
    h = {"A": H(d3, [100, 100, 200]), "B": H(d3, [98, 98, 98], traded=[100, 98, 98])}
    held = bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    assert held["index"] == pytest.approx([100.0, 100.0, 100 * (10_000 * 2 + 9_800) / 19_800])
    assert held["rebalances"] == 1
    a, b = held["legs"]
    assert (a["weight_now"], b["weight_now"]) == pytest.approx((20_000 / 29_800, 9_800 / 29_800))
    monthly = bk.price_basket(h, None, "monthly", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    assert monthly["index"] == pytest.approx(held["index"], rel=1e-12)


def test_a_split_after_the_start_refuses_cap_weight_and_one_before_is_already_in_the_close():
    """Round 3, R3-02: B splits 4-for-1 on Jan 29 (as traded 400 then 100, adjusted 100 and 100). After the basket's
    start its close as traded is on another share basis than the current count, and prices cannot tell the split from a
    large cash distribution, so cap weight is refused with the reason; so is a 2-for-1 or a reverse split. Before the
    start it is already in the start's close: a basket that starts on Jan 30 (C's first close) weights B at 100."""
    d2 = D5[:2]
    h = {"A": H(d2, [100, 100]), "B": H(d2, [100, 100], traded=[400, 100])}
    with pytest.raises(bk.BasketError, match="B's close as traded moved 300% against its adjusted close on 2026-01-29 for a split or for a cash distribution"):
        bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    for traded in ([200, 100], [10, 100]):
        with pytest.raises(bk.BasketError, match="for a split or for a cash distribution"):
            bk.market_prices(H(d2, [100, 100], traded=traded), "B")
    late = {"A": H(D5, [100] * 5), "B": H(D5, [100] * 5, traded=[400, 100, 100, 100, 100]), "C": H(D5[2:], [50] * 3)}
    r = bk.price_basket(late, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100, "C": 100})
    assert r["start"] == D5[2] and [l["target_weight"] for l in r["legs"]] == pytest.approx([100 / 250, 100 / 250, 50 / 250])
    assert [l["close_traded_start"] for l in r["legs"]] == pytest.approx([100.0, 100.0, 50.0])
    # A provider whose close is already split-adjusted (Yahoo's) shows only the dividend, and it stays in.
    assert bk.market_prices(H(d2, [99, 100], traded=[100, 100])) == pytest.approx({d2[0]: 100.0, d2[1]: 100.0})


def test_a_move_of_five_percent_or_more_after_the_start_refuses_cap_weight_instead_of_guessing():
    """Rounds 2 and 3 (R2-02, R3-02): under 5% the move is an ordinary dividend and stays in; 5% or more, either way, is
    a split, a stock dividend or a large cash distribution, which prices cannot tell apart, and it refuses cap weight
    with the reason. Codex's cases: $20 on $100 (raw 100, 80, 80; adjusted 80, 80, 80), which moves the ratio as a
    5-for-4 split would, and $40 on $100 (raw 100, 60, 60; adjusted 60, 60, 60), as a 5-for-3 split would."""
    d2, d3 = D5[:2], D5[:3]
    assert bk.market_prices(H(d2, [96, 96], traded=[100, 96])) == pytest.approx({d2[0]: 100.0, d2[1]: 96.0})
    for traded in ([105, 100], [125, 100], [100, 125], [139, 100], [167, 100], [300, 100]):
        with pytest.raises(bk.BasketError, match=r"^cap weight cannot tell whether B's close as traded moved \d+% against its "
                                                 r"adjusted close on 2026-01-29 for a split or for a cash distribution, so it cannot weight"):
            bk.market_prices(H(d2, [100, 100], traded=traded), "B")
    for paid, moved in ((20, 25), (40, 67)):
        h = {"A": H(d3, [100, 200, 200]), "B": H(d3, [100 - paid] * 3, traded=[100, 100 - paid, 100 - paid])}
        with pytest.raises(bk.BasketError, match=f"B's close as traded moved {moved}% against its adjusted close on 2026-01-29"):
            bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    # A move before the basket's start never weighs.
    assert bk.market_prices(H(d3, [80, 80, 80], traded=[100, 80, 80]), "B", since=d3[1]) == pytest.approx({d3[1]: 80.0, d3[2]: 80.0})


def test_dividends_over_three_months_keep_monthly_equal_to_held_and_the_weights_at_market_value():
    rng = np.random.default_rng(11)
    n = len(CAL)
    adj = {s: 50 * np.cumprod(1 + rng.normal(0, 0.02, n)) for s in ("A", "B", "C")}
    # B pays 1% on sessions 20 and 45, C 2% on session 30 (their earlier closes as traded stand above the adjusted).
    div_b, div_c = np.ones(n), np.ones(n)
    div_b[:20] *= 0.99 ** -1
    div_b[:45] *= 0.99 ** -1
    div_c[:30] *= 0.98 ** -1
    traded_b, traded_c = adj["B"] * div_b, adj["C"] * div_c
    hist = {"A": H(CAL, adj["A"]), "B": H(CAL, adj["B"], traded=traded_b), "C": H(CAL, adj["C"], traded=traded_c)}
    counts = {"A": 5e9, "B": 2e8, "C": 7e8}
    held = bk.price_basket(hist, None, "hold", 1e6, sessions=CAL, shares_outstanding=counts)
    monthly = bk.price_basket(hist, None, "monthly", 1e6, sessions=CAL, shares_outstanding=counts)
    assert monthly["index"] == pytest.approx(held["index"], rel=1e-12)
    # Each name's market price is its close as traded: B's and C's above their adjusted closes before each dividend.
    mkt = {"A": adj["A"], "B": traded_b, "C": traded_c}
    start = {s: counts[s] * mkt[s][0] for s in counts}
    assert [l["target_weight"] for l in held["legs"]] == pytest.approx([start[s] / sum(start.values()) for s in "ABC"])
    end = {s: counts[s] * mkt[s][-1] for s in counts}
    assert [l["weight_now"] for l in held["legs"]] == pytest.approx([end[s] / sum(end.values()) for s in "ABC"])
    # The index is the cap-weighted total return: each session, the names' adjusted returns at the previous weights.
    v = 1.0
    for t in range(1, n):
        mv = {s: counts[s] * mkt[s][t - 1] for s in counts}
        v *= sum(mv[s] / sum(mv.values()) * adj[s][t] / adj[s][t - 1] for s in counts)
    assert held["total_return"] == pytest.approx(v - 1.0, rel=1e-12)
    assert sum(l["contribution"] for l in held["legs"]) == pytest.approx(held["total_return"])


def test_cap_weight_refuses_a_name_without_its_close_as_traded_and_a_history_checks_it():
    h = two_stocks()
    h["B"] = bk.History(h["B"].dates, h["B"].close, h["B"].dollar_volume)
    with pytest.raises(bk.BasketError, match="cap weight reads each name's close as traded, and B has none$"):
        bk.price_basket(h, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 300, "B": 50})
    # At typed weights the close as traded is never read.
    assert bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL)["weighting"] == "target"
    # Round 2, R2-03: a session without a close as traded has no market value, none is borrowed from another
    # session, and the start's and the last close's are needed. Codex's case: B's raw close is missing on the start.
    assert bk.market_prices(H(D5, [10, 11, 12, 11, 13], traded=[10, None, 12, 11, 13])) == pytest.approx(
        {D5[0]: 10, D5[2]: 12, D5[3]: 11, D5[4]: 13})
    d3 = D5[:3]
    codex = {"A": H(d3, [100, 100, 100]), "B": H(d3, [98, 98, 98], traded=[None, 98, 98])}
    with pytest.raises(bk.BasketError, match="^cap weight reads each name's close as traded on its start, 2026-01-28, and B has none there$"):
        bk.price_basket(codex, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    end = {"A": H(d3, [100, 100, 100], traded=[100, 100, None]), "B": H(d3, [98, 98, 98])}
    with pytest.raises(bk.BasketError, match="on its last close, 2026-01-30, and A has none there$"):
        bk.price_basket(end, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 100, "B": 100})
    # In between, the session keeps the holdings: priced, the index unchanged where no dividend is paid.
    mid = {"A": H(D5, [100, 110, 120, 110, 130], traded=[100, None, 120, 110, 130]), "B": H(D5, [50] * 5)}
    r = bk.price_basket(mid, None, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 10, "B": 20})
    assert r["index"] == pytest.approx([100.0, 105.0, 110.0, 105.0, 115.0])
    with pytest.raises(bk.BasketError, match="dates and closes as traded differ in length"):
        bk.History(D5, (1.0,) * 5, (None,) * 5, (1.0,) * 4)
    with pytest.raises(bk.BasketError, match="close as traded that is not a positive number"):
        bk.History(D5, (1.0,) * 5, (None,) * 5, (1.0, 1.0, 0.0, 1.0, 1.0))


@pytest.mark.parametrize("shares, words", [
    ({"A": 300}, "cap weight needs a share count for every name; B has none"),
    ({}, "cap weight needs a share count for every name; A, B have none"),
    ({"A": 300, "B": 0}, "the share count of B is not a positive number"),
    ({"A": 300, "B": float("nan")}, "the share count of B is not a positive number"),
    ({"A": 300, "B": True}, "the share count of B is not a positive number"),
    ({"A": 300, "B": 50, "C": 10}, "the share counts and the histories name different symbols"),
])
def test_a_missing_or_bad_share_count_is_refused_naming_the_name(shares, words):
    with pytest.raises(bk.BasketError) as ei:
        bk.price_basket(two_stocks(), None, "hold", 1000.0, sessions=CAL, shares_outstanding=shares)
    assert str(ei.value) == words


def test_cap_weight_takes_counts_not_weights():
    with pytest.raises(bk.BasketError, match="takes share counts, not weights"):
        bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, "hold", 1000.0, sessions=CAL, shares_outstanding={"A": 1, "B": 1})
