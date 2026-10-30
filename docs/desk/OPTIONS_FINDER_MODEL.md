# Options Finder: the model (method finder-2)

The Options Finder answers one question: a visitor thinks a US stock or ETF will go up (or down) to a target
price by a date, and has a budget to risk. For every listed call (or put) in a window around that view, what
would the position the budget buys be worth on that date if the stock is at the target, halfway there, or
unchanged? It reads one end-of-day option chain and ranks by three plain sorts. It never blends them into a
score and never recommends a contract.

The engine is `src/desk/options_finder.py` (screens, carry, sizing, values, events, lenses, output) on the
numerical library `src/desk/options_math.py`. Both are pure: no I/O and no clock. The route
(`GET /api/desk/options/finder`) fetches every input and passes every date and calendar fact.

Scope: one long call (view up) or one long put (view down) on a US stock or ETF. No spreads, no selling, no
index options.

## How sure each number is

Every number served is one of three kinds, and this document says which:

- **Exact**: money, sizing, payoffs at expiry, breakevens at expiry. Decimal arithmetic on the quoted
  prices, whole cents where money is concerned.
- **Proved within a bound**: a European value (closed form, to roundoff), a theorem-exempt American value
  (equal to the European one by the theorems in "Pricers"), and an American value the early-exercise bound
  lets stand (its error is at most the bound, which is at most a fifth of the tolerance).
- **Estimated, with an observed accuracy**: lattice values and deltas. Their accuracy is checked by a
  convergence test and measured against independent references (QuantLib, and the lattice at a much finer
  resolution) on synthetic stress sets. It is a validated figure, not a proof, and this document never
  calls it one. The pruning of contracts that cannot rank rests on it too ("Pricing only what can rank").

Nothing is "live": the quotes are the provider's end-of-day snapshot of a named session.

## Conventions

- **Model time**: calendar days / 365 (actual/365 fixed), each date standing for its 4:00 pm New York close.
  Early closes and weekends change the order of events, never model time.
- **Rates**: the stored Treasury yields DGS3MO, DGS2 and DGS5, the latest observation on or before the
  session each. Converted to continuously compounded zero rates: 3-month r = ln(1 + 0.25·y)/0.25 (a bill's
  bond-equivalent yield over a quarter); 2- and 5-year r = 2·ln(1 + y/2) (the par yield used as the zero rate,
  a stated approximation: no 1-year point is stored to bootstrap from). Linear in time between 0.25, 2 and 5
  years, flat outside. A contract to expiry E uses the flat rate r(T_E) at the session; a valuation on the
  visitor's date D uses the curve's forward rate from D to E. A yield older than 7 days is named in a note.
- **Dividends** (escrowed model): a dividend is still owed while its last cum-dividend close is on or after
  the valuation's start, and belongs to a contract when that close is before expiry. Its time is its cum
  close, so a Monday ex-date is paid after Friday's close. S* = S − PV(owed dividends) follows geometric
  Brownian motion with volatility σ and a residual yield q.
- **One volatility per contract**, solved from that contract's own mid under this model. The provider's IV
  and Greeks are served only as provenance.

## Carry per expiry: the market's forward

For each expiry the engine reads the market's forward from up to three call and put pairs nearest the money
(same strike, both legs passing the quote-validity screens, a spread at most 10% of mid, and time value above
twice the tolerance, so a leg worth its exercise value now cannot pin the forward):

- **De-Americanized parity.** Starting from F = K + (C − P)/DF, each step removes each leg's early-exercise
  premium (American − European at its current volatility and carry), re-solves both European volatilities
  at the same forward, and sets F = K + ((C − EEP_c) − (P − EEP_p))/DF. At the fixed point both legs share one
  volatility, which defines the market's forward, and each leg's American value equals its mid. It stops when
  a plain step moves F by at most 1e-9·S0 (an Aitken step may accelerate it, but the stop is always checked
  on a plain step), at most 24 steps.
- The expiry's forward is the median of the usable pairs' forwards, and q_E = ln((S0 − PV)/(F·DF))/T_E.
- **Fallbacks**, labelled on every row of that expiry: the dividend schedule with q = 0 ("carry from dividends
  only"), or none at all ("carry: none assumed"). When the only failure is a residual yield beyond ±10% a
  year, the expiry is not priced at all ("outside domain"): assuming no yield would price with a carry the
  market contradicts.
- **The dividend schedule** is a cross-check: declared dividends from EODHD, plus projected ones from the
  last regular dividend's cadence and amount, labelled "projected, not declared". The served carry shows the
  market's dividend PV beside the schedule's.

## Screens

In order, each dropped contract counted under the first it failed: bad row, outside the window, beyond the
market calendar, non-standard symbol (an adjusted contract), no bid, no usable ask, a quote from another
session, no-arbitrage, spread too wide, open interest too low, over budget, no volatility from 5% to 300%
that reprices the mid, unpriceable. `seen = passed + Σ dropped + ranked_out` always.

**No-arbitrage** (exact Decimal on bids and asks, per type and expiry): each row's bounds (call bid ≤ S0,
ask ≥ intrinsic; put bid ≤ K·H, H the largest discount factor to expiry); strike feasibility over all pairs
and triples at once (a bid above the greatest non-increasing convex function, with bounded slope, under all
asks); and calendar order per strike. Failing rows and the rows whose asks show the failure are dropped,
never repaired, until none fails.

## Pricers

A valuation context is a long call or put with spot S, strike K, n whole days, a flat rate ρ, a residual
yield q, a volatility σ and the dividends owed.

- **European**: Black-76 on the escrowed forward. Exact to roundoff.
- **Exempt American contexts**, priced European by theorem, decided per context: a put with ρ ≤ 0 and q ≥ 0;
  a call with ρ ≥ 0, q ≤ 0 and, for every owed dividend, the dividends from it to expiry worth at most
  K·(1 − e^(−ρ·(τ − t))) (Merton's theorem when none is owed). The proof is in the module: the European
  value dominates exercise at every time and state.
- **The early-exercise bound**: an upper bound B on the early-exercise premium, from its integral
  representation with positive parts taken, evaluated as a certified upper sum (exact exponential integrals,
  the largest normal probability over each piece, refined until tight). When B ≤ tol/5 the European value
  stands, and its error is at most B. The row says "below $B".
- **The lattice** (every other context): a binomial lattice on ln S* with a step on every calendar day (so
  every cum close is a step), Black-Scholes smoothing on the last step, N = max(1, ceil(150/n))·n steps.
  Each context is valued on N and 2N steps. The pair is accepted when the two root continuation values
  (before the maximum with the exercise value) agree within half the tolerance and the two step-1 deltas
  within 1.25e-3; otherwise (2N, 4N), then (4N, 8N), within a work limit. The value served is the larger of
  the exercise value and the Richardson extrapolation of the continuation value. A context with no accepted
  pair is not valued, and its row is dropped as unpriceable with the reason.
- **Tolerance**: tol(V; S) = max(1e-4·S, 5e-4·V) per share, S the context's own spot. About a cent per $100
  share.
- **Domain** (checked before every lattice valuation): σ 0.001 to 5, 1 to 1,464 days, ρ within ±0.75,
  |q| ≤ 0.10, K/S 0.05 to 20, at most 64 owed dividends, dividends within any 10 days at most 3% of the price,
  PV at most 90% of the price. Outside it no lattice value is made: the row is unpriceable (with the reason),
  a calibration pair is unusable, a theta or a curve point is null.

**Observed accuracy of the lattice** (synthetic contexts during design review; references QuantLib's
escrowed finite-difference engine, and this lattice at 8,000 or more steps): on random and edge sets inside
the domain, the worst value error is 0.74 of the tolerance and every served delta is within 2.31e-3 of its
reference. Near the exercise boundary (two sets of 2,080 contexts built on it), no value or delta inside the
domain failed. These figures are those design-review sets'. A large dividend in the first days (beyond the
3%-in-10-days rule), closely spaced payments and residual yields beyond ±10% are where the convergence test was
shown to be fooled for the value; they are outside the domain and refused. The validation bench
(`scripts/options_bench/`, an independent Crank-Nicolson reference) later found, inside the domain, two
long-dated contexts with a smaller dividend on day 0 or day 1 whose served price passed but whose lattice delta
missed the stated accuracy (by 3.03e-3 and 2.73e-3): both lattices shared the step-1 slope's error. Prices and
deltas are validated separately: such a price stays served, and no lattice delta is served while a dividend
falls on days 0 to 4 (below).

## Implied volatility and Greeks

- **IV** from the mid. European: Newton with a bisection safeguard in [0.001, 5], to 1e-12 in price.
  American: Brent's method from a bracket between the European inversion and one de-Americanized step, to
  1e-3 of the tolerance in price, at most 40 valuations. Kept only between 5% and 300%.
- **Delta**: the closed form for European and exempt contexts (exact: the exemption does not depend on S). On
  the lattice, ±1 when the root exercises, else the extrapolated step-1 delta. A context whose value the bound
  let stand still takes the lattice's delta (the bound limits the price's error, not its slope). The delta is
  withheld, with a note, within five tolerances of the exercise value (where the two sides' slopes differ by
  more than the stated accuracy), when a dividend falls on days 0 to 4 of the context (the step-1 slope can then
  miss the stated accuracy while both lattices agree on it; the closed-form delta of a European or exempt
  context is kept), or when the lattice did not converge or the context is outside the domain. The page shows
  the note in the Delta cell. Stated accuracy: 2.5e-3 (observed, not a bound).
- **Theta**: the value one calendar day later minus the value now, within the sum of the two values'
  tolerances.

## Sizing, values and P&L

- Entry per contract = the fill (the ask, or the mid) in whole cents rounded up, plus the commission in whole
  cents. n = budget // entry; cost = n × entry; unused = budget − cost.
- **Exit rule**: on the date a contract is sold at its value less the commission when that nets more than
  nothing, else it is left to expire. So P&L ≥ −cost, and the most you can lose is the cost.
- **Values on the date**: a contract expiring on the date is worth its intrinsic value, exactly. A later one
  is modelled at its own volatility held flat, with the same values at σ − 10 and σ + 10 points beside it.
- **Breakeven at expiry**: K ± (fill + 2 × commission / 100 per share), exact. **Breakeven on the date**: the
  price where the modelled value equals that, found by Brent's method inside the range where the pricer is
  validated, each point with its own pricer; null with the side when it lies outside.
- **Probability**: the risk-neutral chance of finishing past the expiry breakeven: the market's pricing, not a
  forecast.

## Pricing only what can rank

The lenses serve the top 20 of each. Bounds on each contract's volatility (from closed forms and the
early-exercise bound) give bounds on its P&L, with an allowance of twice the tolerance for the lattice's
error. Contracts whose upper bound cannot reach a lens's 20th priced value are not priced, and are counted as
`ranked_out`.

What is proved and what is not. The analytical facts are proved: the European value is a lower bound on the
American one, the European value plus the early-exercise bound an upper one, and value rises with volatility.
The allowance is a premise: that every lattice value the run would serve (the volatility solved from the mid,
and each value on the date) is within twice the tolerance of the true American value. It is validated, not
proved: the worst value error observed inside the domain is 0.74 of the tolerance (the design-review sets
above), and the validation bench's in-domain prices all passed. Given that premise, each lens's top 20 is the top 20 of
pricing everything; the tests check this by pricing everything on synthetic chains and comparing. The page's
sentence on the contracts not priced says the allowance is an observed accuracy, not a proved one.

## Events

- Earnings (the earnings cache's dates, or the hand-maintained rows only while the display switch is off:
  `docs/desk/EARNINGS_CACHE.md`; the Finder sends no Finnhub request.
  Not checked for a share-class listing such as BRK.B, whose spelling there is not verified), macro releases (the
  stored calendar, with release instants), and dividends (at their cum close) are placed against the session,
  the date and each expiry. A release time that is not known is "may be on either side", never guessed.
- A modelled row with earnings before the date is flagged: the volatility held flat usually fails after a
  report. While the earnings coverage is not complete through the date, every modelled row also says earnings
  dates are unknown, and the answer's `earnings_status` is "unknown" (or "not_checked"): unknown is never shown
  as no earnings. Stored rows record no checked horizon, so with them the status is always "unknown". The earnings
  cache's reconciled coverage through K counts as complete through K: on or after the date, the unknown flag gives
  way to a reconciled one (Finnhub lists no other regular quarterly report before the date; provider data, not
  confirmed by the company), and through the last expiry scanned the status is "reconciled".
- **Implied earnings move**: from the two nearest expiries after a report, assuming the same diffusive
  variance rate over both and one variance jump at the report: e² = T1·T2·(σ1² − σ2²)/(T2 − T1), served as one
  standard deviation of the move, or null with the reason. A report gets no move of its own when another report
  not yet in the session's prices falls before its second expiry, earlier ones included: the pair's jump would
  be both reports' together. That check reads every report the calendar returned, not only those before the
  last expiry scanned; rows for one day are one report (conflicting times become unknown); and when any earnings
  row could not be read, no move is served and no absence of earnings is claimed. A move also needs the earnings
  coverage complete through its second expiry; stored rows never are, so with them every move is null with the
  reason ("Earnings dates past the stored ones are unknown..."). Reconciled coverage through K is, for pairs
  whose second expiry is on or before K.
- Coverage sentences never claim an absence the data cannot prove ("No earnings date found ... through
  <date>", "Other company events ... are not tracked").

## Stale chains

Quotes one session behind are served with a note saying so; two or more sessions behind are refused.

## Work budget

Every loop is capped, and work is counted in units (one per lattice node update; fixed amounts for closed
forms and bound pieces). A run that would pass 300 M units is refused at the charge that would pass it, with
nothing partial served, so one request's CPU burst on the shared API server stays a few seconds. Inputs are
capped before any processing.

## What the model cannot know

- The quotes are one session's end-of-day snapshot; a contract's price can differ by the next trade.
- Volatility held flat to the date is a modelling choice, shown with ±10-point shifts. It usually fails across
  an earnings report, which is flagged.
- Projected dividends are projections. Events the data does not track (FDA decisions, product launches,
  lawsuits, index changes, mergers) are not in the model.
- Lattice accuracy is observed, not proved (above), and so is the premise the pruning's guarantee rests on. Rates use the par yield as the zero rate at 2 and 5 years.
- Probabilities are risk-neutral: what the market prices, not what will happen.

## Tests

- `tests/test_desk_options_math.py`: Black-76 against Hull's example and QuantLib; parity; the lattice
  against a committed synthetic reference fixture (`tests/fixtures/options_reference_golden.json`, made by
  `scripts/options_reference_golden.py` with QuantLib, a test-only tool never installed in the API) and live
  against QuantLib when it is importable; the exemption theorems at their edges; the bound above the premium;
  refinement, non-convergence and the domain edges; the review cases that shaped the design.
- `tests/test_desk_options_finder.py`, on synthetic chains (`tests/options_synth.py`): forwards and
  volatilities recovered from unrounded quotes (1e-9·S0 and 1e-6), every screen and arbitrage rule (the
  envelope against brute force), carry fallbacks and the ±10% refusal, dividends, sizing and the exit rule
  exact, breakevens repriced, pruning against full pricing, deltas on the bound path, events, coverage, the
  implied move, stale chains and the work budget.
