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


def H(dates, close, dv=None):
    return bk.History(tuple(dates), tuple(float(c) for c in close), tuple(dv if dv is not None else [None] * len(dates)))


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
    rows = bk.stress(basket, {"QQQ": qqq}, "SMH", smh, "60d", 1_000_000.0, cal, cutoff=cal[60])
    r = rows[0]
    assert r["window"] == {"start": cal[0], "end": cal[60], "n": 60}
    assert r["basket_beta"] == pytest.approx(1.0) and r["hedge_beta"] == pytest.approx(1.0) and r["hedge_ratio"] == pytest.approx(1.0)
    assert r["unhedged_usd"] == pytest.approx(-100_000.0) and r["hedged_usd"] == pytest.approx(0.0, abs=1e-6)
    # The ETF ranking reads up to the same cutoff.
    fit = bk.hedge_rows(basket, {"SMH": smh}, 1_000_000.0, cal, cutoff=cal[60])[0]
    assert fit["beta_60d"] == pytest.approx(1.0) and fit["window_60d"]["end"] == cal[60]


def test_the_stress_says_why_when_the_three_share_too_few_returns():
    cal = _xnys("2025-01-02", "2025-12-31")[:61]
    q = np.full(60, 0.001)
    lv = _levels(cal, q)
    gapped = {d: v for i, (d, v) in enumerate(lv.items()) if i != 30}
    r = bk.stress(lv, {"SPY": gapped}, "SMH", lv, "60d", 1e6, cal, cutoff=cal[-1])[0]
    assert r["unhedged_usd"] is None and r["window"]["n"] == 58
    assert r["reason"] == "needs 60 daily returns the basket, SMH and SPY all have; there are 58"
