# LBO model

`src/analytics/lbo.py` (`run_lbo_model`) is the single deal engine. The React Tools tab (via `POST /api/lbo/run`) and the Streamlit LBO tab both call it.

## Cash sweep (since 2026-09-18, fix B1)

Before this change, the interest rate never reached the returns. Interest was computed and shown in the schedule, but debt fell only by the fixed amortization and exit equity was exit EV minus exit debt. The IRR was 17.51% at every rate from 3% to 20%.

The model now works like this each year:

1. **Cash for debt service** is 60% of that year's EBITDA (`CASH_FOR_DEBT_SERVICE`). This single assumption stands in for taxes, capex and working capital.
2. **Interest is paid first**, on the opening debt at the all-in rate. Interest the cash cannot cover is added to the debt (`interest_shortfall`), and the result carries a note.
3. **Scheduled amortization is a floor.** It is `amortization_rate`% of the entry debt, capped at the opening balance.
4. **The remainder sweeps to debt** (`principal_paid` = floor + `sweep`). Because every spare dollar already repays debt, the amortization slider only binds when the cash cannot cover it. That case is flagged as `amortization_shortfall` with a note.
5. **After payoff, cash builds up.** Cash left once the debt is repaid accumulates in `cash_balance` and goes to equity at exit.

At exit:

- Exit equity = exit EV − exit debt + accumulated cash.
- MOIC = exit equity ÷ entry equity, where entry equity = entry EV + fees − entry debt.
- IRR is solved by bisection on NPV over one entry and one exit cash flow, so it equals MOIC^(1/n) − 1.

A higher rate leaves more debt at exit and a lower IRR. For the default deal the IRR is 22.43% at 3%, 20.79% at the live 6.28%, 19.41% at 8.6%, 16.98% at 12% and 8.25% at 20%.

Each schedule row reconciles as follows:

- `cash_available = interest_paid + principal_paid + cash_retained`
- `debt_end = debt_start − principal_paid + interest_shortfall`

`tests/test_lbo.py` pins the rate sweep, the reconciliation, the floor and the shortfall cases. `tests/test_api.py::test_api_lbo_rate_reaches_irr` pins the served contract.
