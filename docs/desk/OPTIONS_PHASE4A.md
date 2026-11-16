# Phase 4a: the Tier 2 replay bench (unserved)

Approved 2026-11-16 03:07 UTC (the owner's Phase 4a decision; plan doc "Tier 2 full switch: Phase 4 plan"). This
is development evidence for choosing a switch architecture. It serves nothing, changes no tolerance, cap or
budget, runs no held-out evaluation, and does not use Phase 3's numbers or its 96-hour held-out budget.
Architecture approval, broader numerical acceptance and activation are separate decisions.

The bench lives in `scripts/options_bench/phase4a/`. Nothing served imports it: `api/` and `src/` are unchanged,
and `options_finder.run()` is the served function, called unmodified. The bench chooses the engine per call site by
handing `run()` a different pricer, in its own process only.

Status: section 1 is registered (frozen); section 3 is the root-finding design, under Codex design review (at most
three passes); no measurement has been made.

## 1. Registration (frozen before any measurement)

**Population.** `scripts/options_bench/phase4a/population.py`, spec `phase4a-pop-1`. Every request is invented: a
chain built from a stated smile, carry and dividend schedule, and a visitor's thesis. No provider data. Request
`i` of a seed depends only on (seed, i), so a larger run only adds requests.

| Dimension | Registered mix |
|---|---|
| Chain shape | monthly to ~14 months 35%, weekly + monthly to a year 25%, LEAP-length (monthlies for a year, then Jun 2027, Jan, Jun and Dec 2028) 25%, short weeklies (six weeks) 15% |
| Spot | log-uniform $10 to $800 |
| Dividends | none 30%; quarterly, 0.3% to 3% a year 45%; quarterly, 4% to 8% 15%; monthly, 2% to 6% 10%; plus a residual yield 0 to 0.5% |
| Volatility | smile level 12% to 90%, with skew and curvature, and a short-dated bump |
| Strikes | 40% to 180% of spot, step 0.2% to 5% of spot (log-uniform), rounded to $0.50, $1, $2.50, $5, $10 or $25 |
| Spreads | 0.5% to 6% of value; 10% of chains 8% to 15% |
| Difficult root-finding (30% of chains) | 5% of quotes deep in the money at intrinsic to intrinsic + 2¢ (low vega); 5% of cheap wings quoted 1¢ to 5¢; 2% below intrinsic (unidentifiable; the Finder screens them) |
| View and target | up or down, 50/50; target 2% to 30% from spot |
| Date | a week to a month 30%, one to four months 40%, four to fourteen months 30% (never past the last expiry) |
| Scan window | 1 month 30%, 3 months 30%, 6 months 25%, 12 months 15% |
| Budget, fill | log-uniform $300 to $100,000; ask 80%, mid 20%; commission $0.65 |

Quotes are priced by a lattice pair two levels finer than Tier 1's first pair (2N and 4N steps, extrapolated as
Tier 1 extrapolates, without Tier 1's dividend smoothing), then rounded to the cent around that value with the
chain's spread. Neither configuration under test prices its own data. The generator is not a certified reference;
where it matters (a few cheap quotes where its error approaches a cent) the report says so.

**Seeds.**
- Development: `20261116`. Every Phase 4a measurement reads this seed and only this seed.
- Reserved: `20261117`, kept untouched for a later registered validation. The generator refuses it unless a
  caller passes `allow_reserved=True`, which no Phase 4a script does, and Phase 4a never generates it.

**Size.** A pilot of the first 24 development requests measures cost; the main run is the first N requests, N the
largest multiple of 24 up to 240 whose forecast fits the remaining CPU allowance with a 2-hour margin (section 5).
The pilot's 24 requests are part of the N; nothing is re-drawn after a measurement.

The registration record (spec hash, generator hash, both seeds, N's rule) is
`scripts/options_bench/phase4a/registration.json`, committed before the first measurement.

## 2. The four configurations

The Finder prices through one `Pricer` per run. The bench passes a pricer whose engine is chosen per call site:

| Site | Where in `options_finder.py` | What it prices |
|---|---|---|
| carry | `calibrate_all` → `pair_forward_gen` via `om.drive` | each pair's early-exercise premium in the forward fixed point |
| iv | `implied_vols` → `iv_american_gen` via `om.drive` | each quote's implied volatility from its mid |
| value | `value_rows` (`many`, `deltas`), `curve_pnl` | the session value, the next-day value, the date's scenario values, deltas, the payoff curve |
| breakeven | `value_rows` → `_breakeven_gen` via `om.drive` | the price on the date where the value covers the cost |

`sigma_range`, `ranges` and `_ucap` use closed forms and the early-exercise bound only (no lattice); they are the
same under every configuration.

| Configuration | carry | iv | value | breakeven |
|---|---|---|---|---|
| A. Tier 1 everywhere (baseline) | 1 | 1 | 1 | 1 |
| B. Tier 2 on value rows only | 1 | 1 | 2 | 1 |
| C. Tier 2 in root-finding only | 2 | 2 | 1 | 2 |
| D. Tier 2 everywhere | 2 | 2 | 2 | 2 |

B and C are mixed-engine configurations, studied here only; this does not authorize serving them.

Each engine keeps its own memo (a context priced by Tier 1 at one site is never returned as Tier 2's value at
another). Tier 2 is `options_adaptive.price(c, FROZEN)` under the configuration the accuracy check uses. A Tier 2
answer with no value is that context's refusal with Tier 2's status and reason, which the Finder handles as it
handles a context outside Tier 1's domain at that site.

**Work and the budget.** Every Tier 2 lattice level is charged to the request's own `Work` before it is computed,
and a solve starts only when its pre-lattice reserve fits, as in the accuracy check. Each configuration runs twice
on every request:
- **Under the serving budget:** `work_limit` = 300 M, unchanged. A request that passes it is the Finder's "Too much
  to price at once" refusal and is counted as such.
- **Offline diagnostic:** no limit, to measure the work a scan needs to finish. This is never a serving figure.

## 3. Root-finding with Tier 2 (the design under review)

Tier 2 values carry a stated error E per context; Tier 1's carry none per contract. A solver that treats Tier 2's
values as exact would stop on noise or chase it. The rules below apply only where Tier 2 prices a solve (sites
carry, iv and breakeven in configurations C and D). Tier 1's solvers are unchanged.

**Local approximation, not a bound.** Every error below converts a value error into an input error by dividing by
a local slope (vega, the forward's sensitivity, delta). That is a first-order approximation at the solution. It is
not a guaranteed bound: the slope can change across the interval, and E itself is an empirical estimate, not a
proved bound. The bench reports these as stated errors with that caveat, never as bounds.

### 3.1 Implied volatility (site iv)

Solve A₂(σ) = P for the mid P, where A₂ is Tier 2's value, with the Finder's bracket and Brent search
(`iv_american_gen`), and these changes:
- **Stopping.** The Finder stops at |A − P| ≤ 10⁻³·tol(P) or a bracket under 10⁻¹⁰. With Tier 2 the search also
  stops when the bracket [a, b] satisfies |b − a|·v̂ ≤ E₂, where v̂ is the secant slope (A₂(b) − A₂(a))/(b − a):
  inside that bracket the values cannot be told apart from Tier 2's own error, so more evaluations add no
  information. The returned σ̂ is the end with the smaller |A₂ − P|.
- **Stated IV error.** δσ = (E₂(σ̂) + |A₂(σ̂) − P|)/v̂, with v̂ the last bracket's secant slope (Tier 2's own
  values, so it includes the early-exercise premium's sensitivity). Reported per quote.
- **Refusals** (each the quote's "bad_iv" with a named reason, counted per reason):
  1. *Not identifiable (low vega):* v̂ ≤ 0, or P − A₂(σ_lo) ≤ E₂(σ_lo) at the bracket's low end σ_lo
     (the price is within Tier 2's error of its smallest value: deep in the money at intrinsic). Tier 1 today
     returns the lowest σ that reprices it; under this rule Tier 2 refuses instead, and the report counts the
     coverage this costs.
  2. *Too uncertain:* δσ > max(0.01, 0.10·σ̂). The threshold is a design parameter, not a published tolerance:
     the Finder states no IV accuracy today. The bench reports the distribution of δσ so a different threshold
     can be chosen from evidence.
  3. *Tier 2 refused a valuation* inside the search (no value at some σ): the quote is "unpriceable" as today.
  4. *No convergence* within the Finder's 40 evaluations: "bad_iv" as today, counted separately.
- **Monotonicity.** Tier 2's values need not be monotone in σ at the scale of E (adjacent σ may take different
  routes or levels). A sign change inside a bracket is accepted as found; a bracket whose ends' values contradict
  monotonicity by more than E₂(a) + E₂(b) is refused as "not identifiable" and counted.

### 3.2 Carry (site carry)

The pair's forward is the fixed point of G(F) (`pair_forward_gen`), whose early-exercise premiums come from
lattice values. With Tier 2 each premium carries E_c or E_p, so G is known only to within
δG = (E_c + E_p)/df.
- **Stopping.** Accept when |G(F) − F| ≤ max(10⁻⁹·S₀, δG) (the Finder's 10⁻⁹·S₀ alone is below Tier 2's noise and
  would exhaust the 24 iterations). Aitken acceleration is unchanged.
- **Stated forward error.** δF = δG + |G(F) − F|. The expiry's forward is the median of its pairs, as today; its
  stated error is the median of the pairs' δF (the median's error is bounded by the pairs' errors when at least two
  pairs agree within their errors, and otherwise is reported as the largest δF). The implied carry error is
  δq ≈ δF/(F·τ).
- **Refusals.** A pair whose iteration does not meet the criterion within 24 evaluations, or where Tier 2 refused a
  leg, is unusable, as today; an expiry with no usable pair takes the Finder's existing fallback ("dividends only"
  or "none"), counted per reason.
- The carry error is not propagated into the row values in Phase 4a; the report gives its size beside each
  expiry so that a later design can decide whether it must be.

### 3.3 Breakevens (site breakeven)

Solve V₂(x; date) = target for the price x (`_breakeven_gen`), unchanged except:
- **Stopping and acceptance.** The final check |V₂(root) − target| ≤ tol(target, root) is kept; the search also
  stops when the bracket satisfies |b − a|·|Δ̂| ≤ E₂, with Δ̂ the secant slope in price.
- **Stated breakeven error.** δx = (E₂(root) + |V₂(root) − target|)/|Δ̂|.
- **Refusals.** Δ̂ = 0, or δx larger than 1% of the root ("too uncertain", a design parameter reported as a
  distribution), become "unresolved" with the reason; the existing "beyond the validated range" reasons are kept.

### 3.4 What the bench records for root-finding

For each solve: the engine, evaluations used, whether it stopped by value, by bracket, by the Tier 2 rule or by
the evaluation cap, the stated input error (Tier 2 only), and the refusal reason. Summaries per site and per
configuration: evaluations (p50, p95, max), refusal counts by reason, and the IV, forward and breakeven
differences between configurations on the same quote, beside the stated errors.

## 4. Measures and how ranking changes are traced

Per request and configuration, under the budget and offline:
- work units, CPU seconds (`time.process_time`) and wall seconds, request-level p50, p95 and maximum;
- the outcome: answered, refused by the work budget, refused by a Finder rule, or failed;
- per site: contexts priced per engine, memo reuse (hits over lookups), Tier 2 refusals by status and reason;
- coverage: candidates, rows that reached a lens, and the screens that removed the rest;
- per lens: the pick, the top 20, and each change against configuration A.

A ranking need not be identical when both engines are within tolerance. Each changed pick or top-20 member is
assigned the first of these that applies, using the rows' values in both configurations:
1. **Removed or added candidate:** the row is absent in one configuration (named screen or refusal).
2. **Pricing difference within the engines' stated accuracies:** the metric moved by no more than the P&L effect of
   E₂ + tol(V₁) on the values it reads.
3. **Tie:** the swapped rows' metrics differ by less than that combined allowance in either configuration.
4. **Uncertainty refusal:** a value or solve was refused under section 3.
5. **Unexplained:** none of the above. Each is listed with the values, errors and contexts behind it. Neither engine
   is assumed to be the correct reference; where an unexplained change appears, the bench prices the contexts it
   rests on with the Phase 2 finite-difference reference (`scripts/options_bench/reference.py`) to say which
   engine, if either, was outside its stated accuracy.

## 5. Compute

The allowance is 10 aggregate CPU hours (the owner's limit). The forecast and the actual usage are recorded in
`scripts/options_bench/phase4a/cpu.json` after the pilot and after each batch; a forecast above the remaining
allowance stops the run and returns an adjustment decision before it is exceeded.

## 6. What the report returns

Measured results for the four configurations; the recommended switch architecture with its coverage limits,
budget and latency requirements, validation plan (on the reserved seed), serving changes and rollback; and every
unresolved design-review finding. Nothing here is acceptance.
