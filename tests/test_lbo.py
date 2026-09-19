"""B1 (2026-09-18): the financing rate must reach the equity returns.

The engine used to charge interest into the schedule while debt fell only by
fixed amortization and exit equity was ``exit_ev - exit_debt``, so the rate
slider moved nothing (IRR 17.51% at every rate from 3% to 20%).

Owner-decided model: cash for debt service is 60% of EBITDA. It pays interest
first; the scheduled amortization (amortization_rate % of entry debt a year) is
a floor; the remainder sweeps against the debt. Once the debt is repaid, cash
builds up and goes to equity at exit. Interest the cash cannot cover is added
to the debt and flagged. Pure function tests: no DB, no network.
"""

from __future__ import annotations

import itertools

import pytest

from src.analytics.lbo import CASH_FOR_DEBT_SERVICE, run_lbo_model

DEAL = dict(
    ebitda=100.0,
    ebitda_growth_rate=5.0,
    entry_multiple=8.0,
    exit_multiple=9.0,
    hold_period=5,
    leverage_ratio=4.5,
    amortization_rate=5.0,
    mgmt_fee_pct=1.5,
)
TOL = 0.02  # schedule rows are rounded to 2 dp


def _rates(lo: float = 3.0, hi: float = 20.0, step: float = 0.25) -> list[float]:
    n = int(round((hi - lo) / step))
    return [round(lo + i * step, 2) for i in range(n + 1)]


def test_cash_for_debt_service_is_sixty_percent_of_ebitda():
    assert CASH_FOR_DEBT_SERVICE == pytest.approx(0.60)
    res = run_lbo_model(**DEAL, interest_rate=6.28)
    assert res["cash_for_debt_service_pct"] == pytest.approx(60.0)
    for row in res["schedule"]:
        assert row["cash_available"] == pytest.approx(0.60 * row["ebitda"], abs=TOL)


def test_irr_and_moic_fall_strictly_as_the_rate_rises_default_deal():
    runs = [run_lbo_model(**DEAL, interest_rate=r) for r in _rates()]
    assert all(r["viable"] for r in runs), "the default deal stays viable across the slider range"
    irrs = [r["irr"] for r in runs]
    moics = [r["moic"] for r in runs]
    net_debt = [r["exit_debt"] - r["exit_cash"] for r in runs]
    assert all(b < a for a, b in zip(irrs, irrs[1:])), f"IRR must fall strictly with the rate: {irrs}"
    assert all(b < a for a, b in zip(moics, moics[1:])), "MOIC must fall strictly with the rate"
    assert all(b > a for a, b in zip(net_debt, net_debt[1:])), "a higher rate leaves more net debt at exit"
    # The regression this replaces: one IRR at every rate.
    assert irrs[0] - irrs[-1] > 5.0


def test_irr_never_rises_with_the_rate_across_a_grid_of_deals():
    grid = itertools.product(
        (0.5, 2.0, 4.5, 6.0, 7.5),  # leverage
        (1, 3, 5, 10),  # hold
        (-10.0, 0.0, 5.0, 15.0),  # growth
        (0.0, 5.0, 20.0),  # amortization
    )
    rates = (3.0, 5.0, 8.0, 12.0, 16.0, 20.0)
    for leverage, hold, growth, amort in grid:
        deal = {**DEAL, "leverage_ratio": leverage, "hold_period": hold,
                "ebitda_growth_rate": growth, "amortization_rate": amort}
        prev_irr: float | None = None
        underwater = False
        for r in rates:
            res = run_lbo_model(**deal, interest_rate=r)
            if not res["viable"]:
                underwater = True  # once underwater, a higher rate cannot rescue it
                continue
            assert not underwater, f"{deal} came back from underwater at {r}%"
            if prev_irr is not None and res["irr"] is not None:
                assert res["irr"] <= prev_irr + 1e-9, f"IRR rose with the rate for {deal} at {r}%"
            prev_irr = res["irr"]


@pytest.mark.parametrize("rate", [3.0, 6.28, 12.0, 20.0])
@pytest.mark.parametrize("leverage", [0.5, 4.5, 7.5])
def test_each_year_reconciles(rate: float, leverage: float):
    deal = {**DEAL, "leverage_ratio": leverage, "entry_multiple": 9.0}
    res = run_lbo_model(**deal, interest_rate=rate)
    sched = res["schedule"]
    assert len(sched) == deal["hold_period"]
    cash_balance = 0.0
    entry_debt = res["entry_debt"]
    for i, y in enumerate(sched):
        if i:
            assert y["debt_start"] == pytest.approx(sched[i - 1]["debt_end"], abs=TOL)
        else:
            assert y["debt_start"] == pytest.approx(entry_debt, abs=TOL)
        # interest due on the opening balance, paid first from cash
        assert y["interest"] == pytest.approx(y["debt_start"] * rate / 100, abs=TOL)
        assert y["interest_paid"] == pytest.approx(min(y["interest"], y["cash_available"]), abs=TOL)
        assert y["interest_shortfall"] == pytest.approx(y["interest"] - y["interest_paid"], abs=TOL)
        # the floor, the sweep beyond it, and what the floor could not get
        assert y["scheduled_amortization"] == pytest.approx(
            min(entry_debt * deal["amortization_rate"] / 100, y["debt_start"]), abs=TOL)
        assert y["principal_paid"] == pytest.approx(
            y["scheduled_amortization"] - y["amortization_shortfall"] + y["sweep"], abs=TOL)
        # every dollar of cash is accounted for
        assert y["cash_available"] == pytest.approx(
            y["interest_paid"] + y["principal_paid"] + y["cash_retained"], abs=TOL)
        # the debt rolls forward
        assert y["debt_end"] == pytest.approx(
            y["debt_start"] - y["principal_paid"] + y["interest_shortfall"], abs=TOL)
        cash_balance += y["cash_retained"]
        assert y["cash_balance"] == pytest.approx(cash_balance, abs=TOL)
    if res["viable"]:
        assert res["exit_debt"] == pytest.approx(sched[-1]["debt_end"], abs=TOL)
        assert res["exit_cash"] == pytest.approx(sched[-1]["cash_balance"], abs=TOL)
        assert res["exit_equity"] == pytest.approx(
            res["exit_ev"] - res["exit_debt"] + res["exit_cash"], abs=TOL)
        # one entry and one exit cash flow: IRR = MOIC^(1/n) - 1
        implied = (res["moic"] ** (1 / deal["hold_period"]) - 1) * 100
        assert res["irr"] == pytest.approx(implied, abs=0.05)


def test_amortization_floor_binds_only_when_cash_cannot_cover_it():
    # Cash after interest (36+ a year at 6%) covers the default 5% floor (22.5):
    # the amortization slider moves nothing while the floor does not bind.
    low = run_lbo_model(**{**DEAL, "amortization_rate": 0.0}, interest_rate=6.0)
    high = run_lbo_model(**{**DEAL, "amortization_rate": 5.0}, interest_rate=6.0)
    assert low["irr"] == high["irr"]
    assert all(y["amortization_shortfall"] == 0 for y in high["schedule"])
    assert not any("amortization" in n.lower() for n in high["notes"])
    # Cash after interest cannot cover a 20% floor on 7.5x leverage: flagged, not faked.
    short = run_lbo_model(**{**DEAL, "leverage_ratio": 7.5, "entry_multiple": 12.0,
                             "amortization_rate": 20.0}, interest_rate=6.0)
    shortfalls = [y["amortization_shortfall"] for y in short["schedule"]]
    assert any(s > 0 for s in shortfalls)
    assert any("amortization" in n.lower() for n in short["notes"])


def test_interest_the_cash_cannot_cover_is_added_to_the_debt_and_flagged():
    res = run_lbo_model(**{**DEAL, "leverage_ratio": 7.5, "entry_multiple": 12.0}, interest_rate=20.0)
    y1 = res["schedule"][0]
    assert y1["interest"] > y1["cash_available"]
    assert y1["interest_shortfall"] == pytest.approx(y1["interest"] - y1["cash_available"], abs=TOL)
    assert y1["principal_paid"] == 0
    assert y1["debt_end"] > y1["debt_start"]
    assert any("interest" in n.lower() for n in res["notes"])


def test_cash_after_payoff_goes_to_equity_at_exit():
    res = run_lbo_model(**{**DEAL, "leverage_ratio": 0.5}, interest_rate=8.0)
    assert res["exit_debt"] == pytest.approx(0.0, abs=TOL)
    assert res["exit_cash"] > 0
    assert res["exit_equity"] == pytest.approx(res["exit_ev"] + res["exit_cash"], abs=TOL)


def test_fee_direction_still_holds():
    free = run_lbo_model(**{**DEAL, "mgmt_fee_pct": 0.0}, interest_rate=8.0)
    fee5 = run_lbo_model(**{**DEAL, "mgmt_fee_pct": 5.0}, interest_rate=8.0)
    assert fee5["entry_equity"] > free["entry_equity"]
    assert fee5["irr"] < free["irr"] and fee5["moic"] < free["moic"]


def test_non_viable_entry_carries_the_new_keys():
    res = run_lbo_model(**{**DEAL, "entry_multiple": 3.0, "leverage_ratio": 8.0}, interest_rate=8.0)
    assert res["viable"] is False and res["error_msg"]
    assert res["notes"] == [] and res["exit_cash"] is None
