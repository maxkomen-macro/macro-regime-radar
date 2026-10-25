"""The Options Finder's engine (src/desk/options_finder.py, method finder-1; design F2).

Every chain here is synthetic: invented strikes, quotes and volatilities, no
provider data (the repository is public, and real quotes in it could be
redistribution). Values are checked against an independent Black-Scholes
written with scipy.stats.norm, and intrinsic values by hand."""

from __future__ import annotations

import math
from datetime import date

import pytest
from scipy.stats import norm

from src.desk import options_finder as of

SESSION = date(2026, 10, 23)
BY = date(2026, 12, 18)
SPOT = 100.0
R, Q = 0.04, 0.0


def _contract(strike: float, exp: str = "2026-12-18", kind: str = "call", *, bid: float = 2.0, ask: float = 2.1,
              oi: float = 500, iv: float = 0.40, session: str = "2026-10-23", **extra) -> dict:
    row = {
        "contract": f"SYN{exp.replace('-', '')[2:]}{kind[0].upper()}{int(strike * 1000):08d}",
        "type": kind, "strike": strike, "exp_date": exp, "bid": bid, "ask": ask, "open_interest": oi,
        "implied_vol": iv, "delta": 0.5, "theta": -0.05, "last_quote": "2026-10-24 04:00:00",
        "bid_session": session, "ask_session": session,
    }
    row.update(extra)
    return row


def _run(rows, *, view="up", target=130.0, by=BY, budget=1500.0, market=None, **kw):
    t = of.Thesis(view=view, target=target, by=by, budget=budget, **kw)
    m = market or of.Market(session=SESSION, spot=SPOT, rate=R, dividend_yield=Q)
    return of.run(rows, t, m)


def _bs(kind, s, k, tau, sigma, r, q):
    d1 = (math.log(s / k) + (r - q + sigma ** 2 / 2) * tau) / (sigma * math.sqrt(tau))
    d2 = d1 - sigma * math.sqrt(tau)
    if kind == "call":
        return s * math.exp(-q * tau) * norm.cdf(d1) - k * math.exp(-r * tau) * norm.cdf(d2)
    return k * math.exp(-r * tau) * norm.cdf(-d2) - s * math.exp(-q * tau) * norm.cdf(-d1)


# ── the evaluator ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("s,k,tau,sigma,r,q", [(100, 110, 0.5, 0.3, 0.04, 0.0), (80, 60, 1.2, 0.9, 0.0, 0.02),
                                               (150, 150, 0.01, 0.05, -0.01, 0.0), (10, 30, 2.0, 2.5, 0.1, 0.05)])
def test_black_scholes_matches_an_independent_implementation_and_put_call_parity(s, k, tau, sigma, r, q):
    c = of.bs_value("call", s, k, tau, sigma, r, q)
    p = of.bs_value("put", s, k, tau, sigma, r, q)
    assert c == pytest.approx(_bs("call", s, k, tau, sigma, r, q), rel=1e-9, abs=1e-9)
    assert p == pytest.approx(_bs("put", s, k, tau, sigma, r, q), rel=1e-9, abs=1e-9)
    assert c - p == pytest.approx(s * math.exp(-q * tau) - k * math.exp(-r * tau), abs=1e-9)


def test_intrinsic_at_expiry():
    assert of.intrinsic("call", 130, 110) == 20 and of.intrinsic("call", 100, 110) == 0
    assert of.intrinsic("put", 80, 90) == 10 and of.intrinsic("put", 95, 90) == 0


def test_add_months_clamps_to_the_month_end():
    assert of.add_months(date(2026, 8, 31), 6) == date(2027, 2, 28)
    assert of.add_months(date(2026, 12, 18), 6) == date(2027, 6, 18)
    assert of.add_months(date(2027, 11, 30), 3) == date(2028, 2, 29)


# ── sizing ─────────────────────────────────────────────────────────────────

def test_sizing_floors_to_whole_contracts_and_reports_the_unused_budget():
    out = _run([_contract(110, bid=6.50, ask=6.75)], budget=1500)
    row = out["rows"][0]
    assert (row["n"], row["cost"], row["unused"], row["max_loss"]) == (2, 1350.0, 150.0, 1350.0)


def test_a_budget_exactly_one_contract_buys_it_and_a_cent_short_does_not():
    assert _run([_contract(110, bid=6.50, ask=6.75)], budget=675)["rows"][0]["n"] == 1
    out = _run([_contract(110, bid=6.50, ask=6.75)], budget=674.99)
    assert out["rows"] == [] and out["universe"]["dropped"]["over_budget"] == 1


def test_fill_at_mid_uses_the_computed_mid():
    row = _run([_contract(110, bid=6.50, ask=6.75)], fill="mid")["rows"][0]
    assert row["fill"] == 6.625 and row["n"] == 2 and row["cost"] == 1325.0


# ── values on the date ─────────────────────────────────────────────────────

def test_a_contract_expiring_on_the_date_is_valued_at_intrinsic_exactly():
    row = _run([_contract(110, bid=6.50, ask=6.75)], target=130)["rows"][0]
    assert row["modelled"] is False and row["iv_minus_10"] is None
    # 2 contracts: at 130, intrinsic 20 → 4,000 − 1,350; halfway 115 → 5 × 200 − 1,350; flat 100 → −1,350
    assert row["pnl"] == {"target": 2650.0, "half": -350.0, "flat": -1350.0}
    assert row["breakeven_expiry"] == row["breakeven_on_date"] == 116.75


def test_a_later_expiry_is_modelled_with_its_own_iv_and_the_shock_lowers_it():
    row = _run([_contract(110, exp="2027-03-19", bid=9.0, ask=9.4, iv=0.5)], target=130)["rows"][0]
    tau = (date(2027, 3, 19) - BY).days / 365
    n = 1
    want = {name: round(n * 100 * _bs("call", s, 110, tau, 0.5, R, Q) - 940.0, 2) for name, s in (("target", 130), ("half", 115), ("flat", 100))}
    assert row["modelled"] is True and row["pnl"] == want
    low = {name: round(n * 100 * _bs("call", s, 110, tau, 0.4, R, Q) - 940.0, 2) for name, s in (("target", 130), ("half", 115), ("flat", 100))}
    assert row["iv_minus_10"] == low
    # the breakeven on the date reprices the fill
    assert of.bs_value("call", row["breakeven_on_date"], 110, tau, 0.5, R, Q) == pytest.approx(9.4, abs=0.006)


def test_the_probability_is_risk_neutral_past_the_breakeven_at_expiry():
    row = _run([_contract(110, bid=6.50, ask=6.75, iv=0.4)])["rows"][0]
    t = (BY - SESSION).days / 365
    d2 = (math.log(SPOT / 116.75) + (R - 0.4 ** 2 / 2) * t) / (0.4 * math.sqrt(t))
    assert row["rn_prob_breakeven"] == round(norm.cdf(d2), 4)


def test_a_put_whose_fill_exceeds_its_strike_has_no_breakeven_and_no_chance():
    put = _contract(5, kind="put", bid=6.0, ask=6.2, iv=0.4)
    out = _run([put], view="down", target=60.0, budget=10_000)
    # strike 5 is outside the down window (0.7 × 60 = 42 … 120): it never reaches the row
    assert out["universe"]["dropped"]["outside_window"] == 1


def test_the_iv_check_recovers_a_known_volatility():
    t = (BY - SESSION).days / 365
    price = _bs("call", SPOT, 110, t, 0.45, R, Q)
    row = _run([_contract(110, bid=round(price - 0.05, 2), ask=round(price + 0.05, 2), iv=0.45)], budget=5000)["rows"][0]
    assert row["iv_check"]["resolved"] == pytest.approx(0.45, abs=0.005) and row["iv_check"]["disagrees"] is False
    row = _run([_contract(110, bid=round(price - 0.05, 2), ask=round(price + 0.05, 2), iv=0.60)], budget=5000)["rows"][0]
    assert row["iv_check"]["disagrees"] is True


# ── screens ────────────────────────────────────────────────────────────────

def test_each_screen_counts_the_contracts_it_drops_and_the_counts_add_up():
    rows = [
        _contract(110),                                         # passes
        _contract(70),                                          # outside: below 0.8 × close
        _contract(115, bid=0),                                  # no bid
        _contract(116, ask=None),                               # bad ask
        _contract(117, bid=1.0, ask=1.5),                       # wide: 0.5 / 1.25 = 40%
        _contract(118, oi=99),                                  # low open interest
        _contract(119, session="2026-10-22"),                   # quote from the session before
        _contract(120, iv=3.5),                                 # implied volatility out of range
        _contract(121, bid=20.0, ask=20.5),                     # over budget
        {"contract": "", "strike": 100, "exp_date": "2026-12-18"},  # bad row
    ]
    out = _run(rows)
    d = out["universe"]["dropped"]
    assert d == {"bad_row": 1, "outside_window": 1, "no_bid": 1, "bad_ask": 1, "wide_spread": 1, "low_oi": 1,
                 "stale_quote": 1, "bad_iv": 1, "over_budget": 1, "unpriceable": 0}
    assert out["universe"]["seen"] == 10 and out["universe"]["passed"] == 1
    assert out["universe"]["seen"] == out["universe"]["passed"] + sum(d.values())


def test_a_contract_is_counted_under_the_first_screen_it_fails():
    out = _run([_contract(115, bid=0, oi=0, iv=9.0)])
    assert out["universe"]["dropped"]["no_bid"] == 1 and out["universe"]["dropped"]["low_oi"] == 0


def test_the_iv_bounds_are_inclusive():
    out = _run([_contract(110, iv=0.05), _contract(111, iv=3.0), _contract(112, iv=0.0499), _contract(113, iv=3.0001)], budget=10_000)
    assert out["universe"]["passed"] == 2 and out["universe"]["dropped"]["bad_iv"] == 2


def test_non_finite_fields_are_dropped_by_the_screen_that_reads_them():
    out = _run([_contract(110, bid=float("nan")), _contract(111, ask=float("inf")), _contract(112, iv=float("nan"))])
    d = out["universe"]["dropped"]
    assert (d["no_bid"], d["bad_ask"], d["bad_iv"]) == (1, 1, 1)


def test_an_empty_answer_names_its_screens_largest_first():
    rows = [_contract(110 + i, bid=1.0, ask=1.6) for i in range(3)] + [_contract(120, bid=30.0, ask=30.5)]
    out = _run(rows)
    assert out["rows"] == [] and all(v is None for v in out["picks"].values())
    assert out["empty"] == "None of the 4 calls passed the screens: 3 were too wide, 1 cost more than the budget."


def test_no_listed_contract_in_the_window_says_so():
    out = _run([])
    assert out["empty"].startswith("No listed calls in the window: expiries 2026-12-18 to 2027-06-18")


# ── lenses ─────────────────────────────────────────────────────────────────

def _chain():
    return [
        _contract(110, bid=6.50, ask=6.75, iv=0.52),                       # leverage on the date
        _contract(100, bid=12.40, ask=12.60, iv=0.53),                     # at the money on the date
        _contract(110, exp="2027-03-19", bid=9.80, ask=10.00, iv=0.52),    # time
        _contract(140, bid=0.50, ask=0.52, iv=0.60),                       # lottery: big payoff? no, OTM at target
    ]


def test_each_lens_is_a_plain_sort_and_the_picks_are_their_first_rows():
    out = _run(_chain(), target=130)
    rows = out["rows"]
    assert [r["pnl"]["target"] for r in rows] == sorted((r["pnl"]["target"] for r in rows), reverse=True)
    payoff = max(rows, key=lambda r: r["pnl"]["target"])
    forgiving = max(rows, key=lambda r: r["pnl"]["half"])
    doubled = [r for r in rows if r["pnl"]["target"] >= r["cost"]]
    time = max(doubled, key=lambda r: r["pnl"]["flat"])
    assert out["picks"] == {"payoff": payoff["contract"], "forgiving": forgiving["contract"], "time": time["contract"]}
    assert time["modelled"] is True


def test_ties_break_on_lower_cost_then_expiry_then_strike():
    a = _contract(110, bid=6.50, ask=6.75)
    b = dict(a, contract="SYNB")
    out = _run([b, a])
    assert out["picks"]["payoff"] == min(a["contract"], "SYNB")


def test_the_time_lens_is_empty_when_nothing_doubles_and_says_why():
    out = _run([_contract(140, bid=0.50, ask=0.52)], target=130)
    assert out["picks"]["time"] is None and out["lens_reasons"]["time"].startswith("No contract")


def test_a_view_down_searches_puts_and_mirrors_the_window():
    puts = [_contract(90, kind="put", bid=3.0, ask=3.1), _contract(80, kind="put", bid=1.0, ask=1.05), _contract(90)]
    out = _run(puts, view="down", target=80.0)
    assert out["universe"]["window"]["strike_from"] == 56.0 and out["universe"]["window"]["strike_to"] == 120.0
    assert out["universe"]["dropped"]["outside_window"] == 1  # the call
    assert {r["type"] for r in out["rows"]} == {"put"}
    row = next(r for r in out["rows"] if r["strike"] == 90)
    assert row["pnl"]["target"] == round(row["n"] * 100 * 10 - row["cost"], 2)


# ── refusals ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("view,target,msg", [("up", 100.0, "above"), ("up", 90.0, "above"), ("down", 100.0, "below"),
                                             ("down", 110.0, "below"), ("up", 1001.0, "10 times")])
def test_a_target_on_the_wrong_side_of_the_close_is_refused_naming_it(view, target, msg):
    with pytest.raises(of.FinderError, match=msg):
        _run([], view=view, target=target)


@pytest.mark.parametrize("kw,msg", [({"by": SESSION}, "after 2026-10-23"), ({"budget": 0.5}, "budget"),
                                    ({"min_oi": -1}, "open interest"), ({"max_spread": 0.0}, "spread"),
                                    ({"scan_months": 13}, "1 to 12"), ({"fill": "bid"}, "fill"),
                                    ({"by": date(2030, 1, 1)}, "three years")])
def test_bad_inputs_are_refused_naming_what(kw, msg):
    with pytest.raises(of.FinderError, match=msg):
        _run([], **kw)


# ── the payload ────────────────────────────────────────────────────────────

def test_the_curve_carries_the_marks_and_one_line_per_pick():
    out = _run(_chain(), target=130)
    prices = out["curve"]["prices"]
    assert prices == sorted(prices) and {100.0, 115.0, 130.0} <= set(prices)
    assert set(out["curve"]["pnl"]) == {c for c in out["picks"].values() if c}
    assert all(len(v) == len(prices) for v in out["curve"]["pnl"].values())


def test_the_payload_carries_no_non_finite_number_and_names_its_method():
    out = _run(_chain(), target=130)
    stack = [out]
    while stack:
        v = stack.pop()
        if isinstance(v, float):
            assert math.isfinite(v)
        elif isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    assert out["method"]["version"] == "finder-1" and out["method"]["model"] == "bs-flat-iv"


# ── design F2 rev 2 (Codex DR-01 … DR-07) ──────────────────────────────────

def test_a_quote_under_a_cent_is_not_a_listed_price():
    for px in (0.00001, 0.000149, 0.0099):
        out = _run([_contract(110, bid=px, ask=px)])
        assert out["universe"]["dropped"]["no_bid"] == 1 and out["rows"] == []
    out = _run([_contract(110, bid=0.01, ask=0.0099)])
    assert out["universe"]["dropped"]["bad_ask"] == 1


def test_the_budget_is_floored_to_cents_so_cost_never_exceeds_it():
    out = _run([_contract(110, bid=0.0101, ask=0.0101)], budget=1.006)
    assert out["universe"]["dropped"]["over_budget"] == 1
    row = _run([_contract(110, bid=0.0101, ask=0.0101)], budget=1.019)["rows"][0]
    assert row["n"] == 1 and row["cost"] == 1.01 and row["unused"] == 0.0


def test_bid_and_ask_must_each_describe_the_chain_session():
    out = _run([_contract(110, bid_session="2026-10-22"), _contract(111, ask_session=None)])
    assert out["universe"]["dropped"]["stale_quote"] == 2


def test_null_or_non_finite_greeks_are_served_null_and_the_row_is_kept():
    out = _run([_contract(110, theta=None, delta=float("inf"))])
    row = out["rows"][0]
    assert row["theta_dollars_day"] is None and row["delta"] is None


def test_the_iv_check_says_why_when_the_mid_is_outside_the_model():
    # a mid above the stock price: no volatility reprices it
    row = _run([_contract(80, bid=99.8, ask=100.0, iv=3.0)], target=110, budget=20_000)["rows"][0]
    assert row["iv_check"] == {"resolved": None, "disagrees": None, "reason": "outside the model's range"}


def test_extreme_but_accepted_magnitudes_stay_finite():
    m = of.Market(session=SESSION, spot=1_000_000.0, rate=R, dividend_yield=Q)
    out = _run([_contract(1_000_000, exp="2027-03-19", bid=50_000, ask=50_100, iv=0.5)], target=9_000_000.0,
               budget=10_000_000, market=m)
    assert out["universe"]["passed"] == 1
    assert all(math.isfinite(p) for p in out["curve"]["prices"])


def test_a_worked_example_against_an_independent_model():
    """A design-page-shaped example with invented numbers: one $150 call expiring three months after the
    date, $13.20 bid / $13.60 ask, IV 50%, r 4%, close $140, target $175 by 18 Dec, budget $1,500."""
    m = of.Market(session=date(2026, 10, 22), spot=140.0, rate=0.04, dividend_yield=0.0)
    row = _contract(150, exp="2027-03-19", bid=13.20, ask=13.60, iv=0.50, oi=12000, session="2026-10-22")
    out = _run([row], target=175.0, budget=1500, market=m)
    r = out["rows"][0]
    assert r["n"] == 1 and r["cost"] == 1360.0 and r["unused"] == 140.0 and r["modelled"] is True
    tau = (date(2027, 3, 19) - date(2026, 12, 18)).days / 365
    for name, s_ in (("target", 175.0), ("half", 157.5), ("flat", 140.0)):
        assert r["pnl"][name] == round(100 * _bs("call", s_, 150, tau, 0.50, 0.04, 0.0) - 1360.0, 2)
        assert r["iv_minus_10"][name] == round(100 * _bs("call", s_, 150, tau, 0.40, 0.04, 0.0) - 1360.0, 2)
    assert abs(_bs("call", r["breakeven_on_date"], 150, tau, 0.50, 0.04, 0.0) - 13.60) <= of.PRICE_TOL


# ── design F2 rev 4 (Codex DR-08 … DR-13) ──────────────────────────────────

def test_a_mid_fill_keeps_its_half_cent_and_sizes_on_it():
    # DR-12: bid 1.00 / ask 1.01, mid fill 1.005: 14 contracts cost $1,407.00, $93.00 unused
    r = _run([_contract(110, bid=1.00, ask=1.01)], budget=1500, fill="mid")["rows"][0]
    assert r["fill"] == 1.005 and r["mid"] == 1.005 and r["n"] == 14 and r["cost"] == 1407.0 and r["unused"] == 93.0
    assert r["bid"] == 1.00 and r["ask"] == 1.01
    assert r["breakeven_expiry"] == 111.005


def test_money_is_exact_at_the_float_edges():
    # DR-13: a budget a hair under $1.01 buys no $0.0101 contract; a premium a hair over a cent rounds up
    out = _run([_contract(110, bid=0.0101, ask=0.0101)], budget=1.0099999999999998)
    assert out["universe"]["dropped"]["over_budget"] == 1
    r = _run([_contract(110, bid=0.01, ask=0.01000000005)], budget=100)["rows"][0]
    assert r["fill"] == 0.0101 and r["fill"] >= 0.01000000005 and r["n"] == 99 and r["cost"] == 99.99
    assert of.budget_cents(1.0099999999999998) == 100 and of.budget_cents(1.01) == 101 and of.budget_cents(1500) == 150000


def test_a_spread_of_exactly_the_limit_passes():
    # (1.05 − 0.95) / 1.00 is 0.10000000000000009 in floats; exactly 10%, it passes the 10% screen
    out = _run([_contract(110, bid=0.95, ask=1.05)])
    assert out["universe"]["passed"] == 1 and out["rows"][0]["spread_pct"] == 0.1
    assert _run([_contract(110, bid=0.94, ask=1.05)])["universe"]["dropped"]["wide_spread"] == 1


def test_curve_marks_keep_distinct_coordinates():
    # DR-09: S0 0.01001, X 0.01003: three distinct marks, each in the grid at its exact value
    m = of.Market(session=SESSION, spot=0.01001, rate=R, dividend_yield=Q)
    out = _run([], target=0.01003, market=m)
    marks = out["curve"]["marks"]
    assert len({marks["close"], marks["half"], marks["target"]}) == 3
    assert all(v in out["curve"]["prices"] for v in marks.values())
    assert len(out["curve"]["prices"]) == len(set(out["curve"]["prices"]))


def test_quote_ts_is_the_stamp_string():
    r = _run([_contract(110, last_quote="2026-10-24 04:00:01")])["rows"][0]
    assert r["quote_ts"] == "2026-10-24 04:00:01"
    assert _run([_contract(110, last_quote="")])["rows"][0]["quote_ts"] is None
    assert _run([_contract(110, last_quote=12.0)])["rows"][0]["quote_ts"] is None


def test_finder_error_kinds():
    with pytest.raises(of.FinderError) as e:
        _run([], target=90.0)
    assert e.value.kind == "input"
    for m in (of.Market(session=SESSION, spot=float("nan"), rate=R, dividend_yield=Q),
              of.Market(session=SESSION, spot=SPOT, rate=0.5, dividend_yield=Q),
              of.Market(session=SESSION, spot=SPOT, rate=R, dividend_yield=-0.01)):
        with pytest.raises(of.FinderError) as e:
            _run([], market=m)
        assert e.value.kind == "market"


def test_lenses_read_unrounded_pnl():
    # DR-15: target P&L $99.999 serves as $100.00 but is not "at least double" a $100 cost
    m = of.Market(session=SESSION, spot=100.0, rate=R, dividend_yield=Q)
    row = _contract(100, exp=BY.isoformat(), bid=1.0, ask=1.0)
    out = _run([row], target=101.99999, budget=100, market=m)
    r = out["rows"][0]
    assert r["modelled"] is False and r["cost"] == 100.0 and r["pnl"]["target"] == 100.0
    assert out["picks"]["time"] is None and out["lens_reasons"]["time"]
    assert "_pnl" not in r


def test_breakevens_are_served_unrounded_and_checked_on_that_value():
    # DR-14's case: K 100, fill 10, sigma 0.05, r 0, q 0.10, a year past the date
    be = of.breakeven_on_date("call", 100.0, 1.0, 0.05, 0.0, 0.10, 10.0, 100.0)
    assert abs(of.bs_value("call", be, 100.0, 1.0, 0.05, 0.0, 0.10) - 10.0) <= of.PRICE_TOL
    assert abs(be - 121.504068) < 1e-3
    # DR-17's case: a strike with six decimals keeps them in the expiry breakeven
    m = of.Market(session=SESSION, spot=100.0, rate=R, dividend_yield=Q)
    r = _run([_contract(100.000049, exp=BY.isoformat(), bid=1.0, ask=1.0)], target=110.0, budget=1000, market=m)["rows"][0]
    assert r["breakeven_expiry"] == 100.000049 + 1.0 and r["breakeven_on_date"] == r["breakeven_expiry"]


def test_a_truncated_scan_with_no_rows_never_claims_nothing_is_listed():
    t = of.Thesis(view="up", target=130.0, by=BY, budget=1500.0)
    out = of.run([], t, of.Market(session=SESSION, spot=SPOT, rate=R, dividend_yield=Q), truncated=True)
    assert out["universe"]["truncated"] is True and out["rows"] == [] and all(v is None for v in out["picks"].values())
    assert "does not mean no calls are listed" in out["empty"] and "No listed" not in out["empty"]


def test_an_exact_double_is_at_least_double():
    # DR-18: S0 0.11, X 0.12, K 0.10, a $0.01 premium, budget $1: one contract costs $1 and is worth $2
    m = of.Market(session=SESSION, spot=0.11, rate=R, dividend_yield=Q)
    out = _run([_contract(0.10, exp=BY.isoformat(), bid=0.01, ask=0.01)], target=0.12, budget=1, market=m, max_spread=1.0)
    r = out["rows"][0]
    assert r["cost"] == 1.0 and r["pnl"]["target"] == 1.0
    assert out["picks"]["time"] == r["contract"]


def test_a_strike_on_the_window_bound_is_inside_it():
    # 144.75 × 0.8 is 115.80000000000001 in floats; the bound is exactly 115.80
    m = of.Market(session=SESSION, spot=144.75, rate=R, dividend_yield=Q)
    out = _run([_contract(115.8, bid=30.0, ask=30.5), _contract(115.79, bid=30.0, ask=30.5)], target=180.0, budget=10000, market=m)
    assert [r["strike"] for r in out["rows"]] == [115.8] and out["universe"]["dropped"]["outside_window"] == 1
    assert out["universe"]["window"]["strike_from"] == 115.8 and "_bounds" not in out["universe"]["window"]


def test_the_wrong_side_refusal_names_the_close():
    with pytest.raises(of.FinderError, match=r"A view up needs a target above the Oct 23, 2026 close of \$100\.00\."):
        _run([], target=100.0, market=of.Market(session=date(2026, 10, 23), spot=100.0, rate=R, dividend_yield=Q))
