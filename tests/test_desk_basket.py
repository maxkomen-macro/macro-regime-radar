"""The basket engine (src/desk/basket.py, desk/books): pure functions over
price histories. The first two tests are worked by hand, two stocks over five
sessions; every expected number below is in the comments beside it."""

from __future__ import annotations

import math

import numpy as np
import pytest

from src.desk import basket as bk

D5 = ("2026-01-28", "2026-01-29", "2026-01-30", "2026-02-02", "2026-02-03")


def H(dates, close, dv=None):
    return bk.History(tuple(dates), tuple(float(c) for c in close), tuple(dv if dv is not None else [None] * len(dates)))


def two_stocks():
    # A: 10, 11, 12, 11, 13 with $1,000 traded a day; B: 20, 20, 22, 24, 22 with $400 a day.
    return {"A": H(D5, [10, 11, 12, 11, 13], [1000.0] * 5), "B": H(D5, [20, 20, 22, 24, 22], [400.0] * 5)}


def test_hand_checked_buy_and_hold_two_stocks_five_sessions():
    r = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, "hold", 1000.0, adv_sessions=5)
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
    r = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5}, "monthly", 1000.0, adv_sessions=5)
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
    r = bk.price_basket(h, {"OLD": 0.6, "NEW": 0.4}, "hold", 100.0)
    assert r["start"] == "2026-01-30" and r["start_binding"] == ["NEW"] and r["start_is_first_close"] is True
    # OLD 60 / 12 = 5 shares, NEW 40 / 5 = 8: 100, 5·11 + 8·6 = 103, 5·13 + 8·7 = 121.
    assert r["index"] == pytest.approx([100.0, 103.0, 121.0])
    same = bk.price_basket(two_stocks(), {"A": 0.5, "B": 0.5})
    assert same["start_binding"] == ["A", "B"] and same["start_is_first_close"] is False


def test_a_session_one_name_lacks_is_dropped_never_filled():
    h = {"A": H(D5, [10, 11, 12, 11, 13]), "B": H(D5[:3] + D5[4:], [20, 20, 22, 22])}
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0)
    assert r["dates"] == [D5[0], D5[1], D5[2], D5[4]] and r["missing_sessions"] == [D5[3]]
    assert r["index"] == pytest.approx([100.0, 105.0, 115.0, 120.0])


def test_liquidity_needs_a_full_window_of_dollar_volume():
    h = two_stocks()
    h["B"] = H(D5, [20, 20, 22, 24, 22], [400.0, None, 400.0, 400.0, 400.0])
    r = bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 1000.0, adv_sessions=5)
    assert r["legs"][1]["adv_usd"] is None and r["legs"][1]["days_to_trade"] is None
    assert r["liquidity"]["binding"] == "A" and r["liquidity"]["basket_days"] == pytest.approx(2.5)
    assert r["legs"][1]["adv_window"] == {"start": D5[0], "end": D5[4], "n": 4}


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
    r = bk.price_basket(h, {"A": 0.5, "B": 0.25, "C": 0.25})
    c = r["concentration"]
    assert c["corr_window"] == {"start": dates[-253], "end": dates[-1], "n": 252}
    px = np.column_stack([h[s].close for s in "ABC"])
    rets = px[1:] / px[:-1] - 1
    cc = np.corrcoef(rets[-252:], rowvar=False)
    assert c["avg_pairwise_corr"] == pytest.approx((cc[0, 1] + cc[0, 2] + cc[1, 2]) / 3)
    short = {s: H(dates[:61], h[s].close[:61]) for s in "ABC"}
    assert bk.price_basket(short, {"A": 0.5, "B": 0.25, "C": 0.25})["concentration"]["avg_pairwise_corr"] is not None
    shorter = {s: H(dates[:60], h[s].close[:60]) for s in "ABC"}
    assert bk.price_basket(shorter, {"A": 0.5, "B": 0.25, "C": 0.25})["concentration"]["avg_pairwise_corr"] is None


def test_top_three_and_effective_names_read_the_weights_at_the_last_close():
    h = {s: H(D5, [10, 10, 10, 10, 10 * (1 + i)]) for i, s in enumerate("ABCD")}
    r = bk.price_basket(h, {s: 0.25 for s in "ABCD"}, "hold", 1000.0)
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
        bk.price_basket(h, {"A": 0.5, "B": 0.5}, "weekly")
    with pytest.raises(bk.BasketError, match="notional"):
        bk.price_basket(h, {"A": 0.5, "B": 0.5}, "hold", 0)
    with pytest.raises(bk.BasketError, match="different symbols"):
        bk.price_basket(h, {"A": 0.5, "C": 0.5})
    with pytest.raises(bk.BasketError, match="share no session"):
        bk.price_basket({"A": H(D5[:2], [1, 2]), "B": H(D5[3:], [1, 2])}, {"A": 0.5, "B": 0.5})
    with pytest.raises(bk.BasketError, match="positive"):
        H(D5[:2], [1, -2])
    with pytest.raises(bk.BasketError, match="ascending"):
        H([D5[1], D5[0]], [1, 2])
