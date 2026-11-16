# Phase 4a: the Tier 2 replay bench (unserved)

Approved 2026-11-16 03:07 UTC (the owner's Phase 4a decision; plan doc "Tier 2 full switch: Phase 4 plan"). This
is development evidence for choosing a switch architecture. It serves nothing, changes no tolerance, cap or
budget, runs no held-out evaluation, and does not use Phase 3's numbers or its 96-hour held-out budget.
Architecture approval, broader numerical acceptance and activation are separate decisions.

The bench lives in `scripts/options_bench/phase4a/`. Nothing served imports it: `api/` and `src/` are unchanged,
and `options_finder.run()` is the served function, called unmodified. The bench chooses the engine per call site by
substituting module attributes for the length of one call, in its own process only (section 2).

Status: section 1 is registered (frozen); section 3 is the root-finding design, under Codex design review (at most
three passes; pass 1's findings DR-01 to DR-08 are addressed in this revision); no measurement has been made.

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
another). Tier 2 is `options_adaptive.price(c, FROZEN)` under the configuration the accuracy check uses.

**How the bench reaches the sites (bench process only; DR-05).** `run()` takes no pricer and builds
`Pricer(work)` itself, so the bench substitutes module attributes for the duration of one call and restores them
after (`scripts/options_bench/phase4a/bench.py`, `patched`):
- `options_finder.Pricer` → a factory returning the bench's `SitePricer` bound to the run's own `Work`. It
  dispatches `many`, `values` and `deltas` to Tier 1 (the Finder's own code, `super()`) or Tier 2 by the current
  site, and keeps each Tier 2 answer by context (its value, stated error, route and status).
- `calibrate_all`, `implied_vols`, `value_rows` and `curve_pnl` → the same functions wrapped to set the site;
  `options_math.drive` → wrapped so that a solve run from inside `value_rows` is the breakeven site.
- In configurations C and D only, the three solver generators are replaced by Tier 2-aware copies in
  `scripts/options_bench/phase4a/rootfinding.py` (section 3): `options_math.iv_american_gen`,
  `options_finder.pair_forward_gen` and `options_finder._breakeven_gen`. They receive values from
  `Pricer.values()` as floats, as today, and read each evaluated context's stated error from the `SitePricer`
  (the transport for uncertainty).
- In configurations C and D only, `options_finder.implied_vols` → a bench copy that differs from the Finder's in
  one statement: its exempt branch calls the Tier 2 exempt solve of 3.1 instead of `om.iv_european` (DR-05). A test
  compares the two functions' parse trees and fails on any other difference. The copy is then wrapped for its
  site like the original.
- Instrumentation only records: the implied vols `implied_vols` returns and the top 20 `lens_order` returns per
  lens.

Configuration A substitutes nothing that computes: a test pins that A's answer equals an unpatched `run()` on the
same requests, and that every substituted attribute is the original after a run, including after a failure.

**Tier 2's refusals at a site.** A context Tier 2 gives no value for becomes a reason string, which the Finder
handles as it handles a context outside Tier 1's domain at that site (an IV "unpriceable", a carry pair unusable,
a breakeven "unresolved", a row "unpriceable"). Where Tier 2's status is "outside the domain" the string is
`options_math.in_domain`'s own reason, verbatim, so the Finder's existing "outside domain" carry branch (a residual
yield outside the validated range) is taken exactly as today (DR-06). Tier 2 checks the domain before its exempt
route, so a context Tier 1 prices by the European formula outside the lattice's domain is a Tier 2 refusal; the
report counts these as coverage changes.

**Work and the budget.** Every Tier 2 lattice level is checked against the request's own `Work` before it is
computed, a solve starts only when its pre-lattice reserve fits, and Tier 2's own unit count is charged after
it, as in the accuracy check. Each configuration runs twice on every request:
- **Under the serving budget:** `work_limit` = 300 M, unchanged. A request that passes it is the Finder's "Too much
  to price at once" refusal and is counted as such.
- **Offline diagnostic:** no limit, to measure the work a scan needs to finish. This is never a serving figure.

## 3. Root-finding with Tier 2 (the design under review)

Tier 2 values carry a stated error E per context; Tier 1's carry none per contract. A solver that treats Tier 2's
values as exact would stop on noise or chase it. The rules below apply only where Tier 2 prices a solve (sites
carry, iv and breakeven in configurations C and D). Tier 1's solvers are unchanged.

**Local approximation, not a bound.** Every error below converts a value error into an input error by dividing by
a local slope (vega, the fixed point's conditioning, delta). That is a first-order approximation at the solution.
It is not a guaranteed bound: the slope can change across the interval, and E itself is an empirical estimate, not
a proved bound. The bench reports these as stated errors with that caveat, never as bounds.

**Common rules for a Tier 2 solve (DR-02).**
- *The error of one evaluation.* E is Tier 2's stated estimate for that context. It is 0 only for the exact
  routes (status "exact": intrinsic at expiry, or an exempt context's European value), where Tier 2 states none.
  Any other value of E that is missing, negative or not finite refuses the solve ("Tier 2 stated no error").
- *The slope (DR-02, DR-03, DR-09).* Each solve needs a local slope of its function f (A₂ − P for the IV,
  G(F) − F for carry, V₂ − target for the breakeven) at its returned point x̂.
  - A secant through two evaluated points x₁ ≠ x₂ has the noise ratio ρ = (E₁ + E₂)/|f₁ − f₂| (for carry, E is
    δG at each point). It is usable when both f are finite, its sign is the one monotonicity requires (for carry:
    any sign), and ρ < 0.5. The slope used in every error formula is the conservative s = |secant|·(1 − ρ).
  - The candidate is the current bracket's two ends when the solve brackets its root, else the last two
    evaluated points. When the candidate is unusable (a first point that already matched, coincident points, too
    noisy, or the noise stop, whose bracket is by definition within noise), the solver makes **one** probe
    valuation at x̂ ± h and takes the secant through x̂ and the probe.
  - *Direction:* inward, into the intersection of the current search range (the bracket, or for a first-point
    exit the solver's validated range) and the pricing domain (`in_domain` of the probe's context); when both
    sides have room, the side with more. *Step:* h = min(max(h_target, h_min), h_max, room), where room is the
    distance to that intersection's end on the chosen side, h_target = 8·E₂(x̂)/s₀ with s₀ a closed-form slope
    needing no valuation (the European vega for the IV, the European delta at the date for the breakeven, 1 for
    carry), h_min = max(10⁻³, 0.01·σ̂), 10⁻³·x̂ or 10⁻⁴·F̂, and h_max = 0.25·σ̂, 0.05·x̂ or 0.01·F̂. h_target
    makes ρ ≈ 0.25 when s₀ is right.
  - Refusal only when no usable probe exists: no room on either side, or the probe's secant still fails the
    usability test ("slope not resolved within Tier 2's error"). There is never a second probe.
- *The evaluation cap (DR-10).* Uncertainty is part of acceptance: a solve has not succeeded until its slope is
  usable. Each Tier 2 solve reserves one evaluation of its cap for the probe, so the search proper stops one
  short of today's cap (IV: 40 valuations in all, including the floor test of 3.1; carry: 24 evaluations of G;
  breakeven: Brent's 40), and no solve ever makes an evaluation past its cap. A search that has not met its
  criterion when only the reserved evaluation is left is nonconvergence, as today's cap. Because the reserve is
  always held, "uncertainty unresolved at the evaluation cap" cannot occur; the bench asserts it never does.
- *Every exit is recorded:* by value (|f| within the solver's tolerance), by bracket width, by the Tier 2 noise rule,
  at the evaluation cap, or refused, with the evaluations used, whether a probe was made, ρ, the stated input error
  and the reason.

### 3.1 Implied volatility (site iv)

Solve A₂(σ) = P for the mid P, where A₂ is Tier 2's value, with the Finder's bracket and Brent search
(`iv_american_gen`), and these changes, in this order of precedence:
1. **Identifiability first (DR-01).** Before the search, value the context once at the bracket's global floor
   σ_min = 0.001 (`IV_BRACKET`'s low end; one evaluation, counted in the cap). When P − A₂(σ_min) ≤ E₂(σ_min), the
   price is within Tier 2's error of the smallest value any volatility gives it (a deep in-the-money quote at
   intrinsic), and the quote is refused, "IV not identifiable within Tier 2's stated error". Tier 1 today returns
   the lowest σ that reprices it; the report counts what this refusal costs in coverage. The test is applied at the
   global floor only, never at the moving lower end of the search bracket.
2. **Search and stopping.** The Finder's search as today, stopping at |A₂ − P| ≤ 10⁻³·tol(P), at a bracket under
   10⁻¹⁰, or (Tier 2 only) when the current bracket [a, b] satisfies |b − a|·v̂ ≤ E₂(a) + E₂(b), v̂ the bracket's
   secant: inside it the values cannot be told apart within Tier 2's own error. σ̂ is the end with the smaller
   |A₂ − P|.
3. **Monotonicity.** A₂ need not be monotone in σ at the scale of E. A bracket whose ends contradict monotonicity
   (A₂(b) < A₂(a) for b > a) by more than E₂(a) + E₂(b) refuses the quote, "not identifiable"; a smaller contradiction
   is within Tier 2's error and the search continues.
4. **Stated IV error.** δσ = (E₂(σ̂) + |A₂(σ̂) − P|)/s, s the conservative slope of the common rules.
5. **Too uncertain.** δσ > max(0.01, 0.10·σ̂) refuses the quote, "IV too uncertain". The threshold is a design
   parameter, not a published tolerance (the Finder states no IV accuracy today); the bench reports the
   distribution of δσ so a different threshold can be chosen from evidence.
6. Tier 2 refusing a valuation inside the search makes the quote "unpriceable", and no convergence within the 40
   evaluations makes it "bad_iv", as today, each counted under its own reason.
7. **Exempt quotes (DR-05).** Today `implied_vols` inverts an exempt quote (one never exercised early, `om.exempt`,
   which does not depend on σ) by the European formula, with no lattice. In C and D the bench's copy sends it
   through the same rules, with Tier 2 as the engine:
   - *Domain first.* Tier 2 checks `in_domain` before its exempt route, so the context is checked at the floor;
     a reason other than the volatility makes the quote "unpriceable" with that reason, counted as a coverage
     change against Tier 1.
   - *Engine.* For an in-domain exempt context, Tier 2's value is `om.european` exactly (route "exempt", status
     "exact", E = 0) at every σ. The search is therefore `om.iv_european` as today (closed form, its own counter),
     and then one Tier 2 valuation at σ̂ (in the cap and charged to the request's work) confirms it: a route other
     than "exempt", a status other than "exact", or a value different from `om.european` at σ̂ refuses the quote,
     "Tier 2 disagrees with the exempt route".
   - *Identifiability* is rule 1 with E = 0: P ≤ `om.european` at σ_min refuses the quote "IV not identifiable".
   - *Error.* δσ = |A₂(σ̂) − P|/v, v the European vega at σ̂ in closed form (exact, E = 0, so no probe and no
     noise ratio); rule 5 applies.

### 3.2 Carry (site carry)

The pair's forward is the fixed point of G(F) (`pair_forward_gen`); each evaluation of G values both legs and
re-inverts their volatilities, so G includes the coupled volatility updates. With Tier 2, each leg's early-exercise
premium carries E_c or E_p, so G is known only to within δG = (E_c + E_p)/df.
- **Stopping.** Accept when |G(F) − F| ≤ max(10⁻⁹·S₀, δG) (the Finder's 10⁻⁹·S₀ alone is below Tier 2's
  noise and would exhaust the evaluations) and the slope of r is usable (below); one evaluation of the 24 is
  reserved for its probe. Aitken acceleration is unchanged. The returned forward is G(F_n), as today, and its
  stated error is δF below.
- **Conditioning (DR-03).** The slope of r(F) = G(F) − F, which is G′ − 1, comes from the common slope rule:
  the secant of r through the last two inputs of G along the iteration, else one probe. G here is the reduced,
  scalar map the iteration follows: at an input F the volatilities are re-inverted from the previous
  evaluation's de-Americanized prices under q(F) (`sigmas`, closed form) and then both legs are valued, so the
  coupled volatility update is inside the secant. The probe is one evaluation of G at F_n ± h (F_n the last
  input), built the same way, inward so that q stays within the domain. Coincident inputs (an iteration that
  repeats its forward) are exactly the case the probe resolves: when both legs are exempt or exact, r's values are
  exact (ρ = 0) and a constant map gives G′ = 0, so an exactly solved pair is accepted as today, after its probe.
  The stated forward error is δF = (δG + |r(F_n)|)/s, s the conservative slope of r. When s < 0.1 (G′ above 0.9:
  a small residual can hide a large error) the pair is refused, "ill-conditioned".
- **The expiry's forward (DR-04).** The forward is the median of the usable pairs' forwards, as today. Its stated
  interval is [median of (Fᵢ − δFᵢ), median of (Fᵢ + δFᵢ)]: the median is non-decreasing in each pair's forward, so
  if every pair's true forward lies within its stated interval, the true median lies within this one. That premise
  is empirical, as E is. The stated forward error is the larger distance from the forward to the interval's ends,
  and δq ≈ δF/(F·τ).
- **Refusals and fallbacks (DR-06).** Each keeps its own reason and count:
  - a leg Tier 2 refuses "outside the domain" carries `in_domain`'s reason, so an expiry whose pairs fail for a
    residual yield outside the validated range is "outside domain" and its contracts are excluded, exactly as today;
  - a pair refused as ill-conditioned, not meeting the criterion within 24 evaluations, or with a leg Tier 2 refused
    for any other reason is unusable;
  - an expiry with no usable pair and no domain reason takes the Finder's existing fallback ("dividends only" or
    "none"); the report counts each fallback by the reason its pairs failed, and how many rows it reaches.
- The carry error is not propagated into the row values in Phase 4a; the report gives its size beside each expiry
  so a later design can decide whether it must be.

### 3.3 Breakevens (site breakeven)

Solve V₂(x; date) = target for the price x (`_breakeven_gen`), conditional on the row's volatility and its expiry's
carry as solved (their own errors are reported at 3.1 and 3.2, not added here). Unchanged except:
- **Stopping and acceptance.** The final check |V₂(root) − target| ≤ tol(target, root) is kept; the search also
  stops when the bracket satisfies |b − a|·|Δ̂| ≤ E₂(a) + E₂(b), Δ̂ the bracket's secant in price.
- **Stated breakeven error.** δx = (E₂(root) + |V₂(root) − target|)/s, s the conservative slope of the common rules.
- **Range.** Tier 2 checks the domain before its exempt route, so for an exempt row the Tier 2 search uses the
  validated range of a non-exempt one (`q.strike/KS_HI` and the dividend limits to `q.strike/KS_LO`) instead of
  the model's range up to 10⁹; a breakeven beyond it is "beyond the validated range", counted as a coverage
  change. The probe of the common rules stays inside this range.
- **Refusals.** No usable slope, or δx larger than 1% of the root ("too uncertain", a design parameter reported
  as a distribution), make the breakeven "unresolved" with the reason; the existing "beyond the validated range"
  reasons are kept.

## 4. Measures and how ranking changes are traced

Per request and configuration, under the budget and offline:
- work units, CPU seconds (`time.process_time`) and wall seconds, request-level p50, p95 and maximum;
- the outcome: answered, refused by the work budget, refused by a Finder rule, or failed;
- per site: contexts priced per engine, memo reuse (hits over lookups), Tier 2 refusals by status and reason;
- root-finding: per site, evaluations (p50, p95, max), exits by kind, refusals by reason, and the stated input
  errors;
- coverage: candidates, rows that reached a lens, and the screens that removed the rest;
- per lens: the pick, the top 20, and each change against configuration A.

A ranking need not be identical when both engines are within tolerance. Each changed pick or top-20 member is
traced in two independent parts (DR-08):

**Eligibility, recorded for every row whatever its rank:** present in both, or absent in one with its cause (the
screen, a Tier 2 valuation refusal, or an uncertainty refusal of section 3, each named).

**The metric change of a row present in both,** split by repricing at common inputs: for configuration X against A,
the bench reprices X's row contexts with A's engine at X's inputs (its σ and carry). Then
- the *input effect* is A's engine at X's inputs minus A's answer (what the changed IV or carry did), compared with
  the P&L effect of the stated input errors (δσ times the row's vega, δF times its forward sensitivity; a local
  approximation);
- the *valuation effect* is X's answer minus A's engine at X's inputs, compared with the P&L effect of
  E₂ + tol(V₁) on the values the metric reads.

Each changed rank is then assigned the first that applies: a removed or added candidate (with its cause); a tie
(the swapped rows' metrics differ by less than their combined allowances in either configuration); explained by
valuation within allowance; explained by inputs within their stated errors; explained by both together within the
sum of the two allowances; or **unexplained**. Each unexplained change is listed with the values, errors and contexts
behind it. Neither engine is assumed to be the correct reference: the bench prices the contexts an unexplained
change rests on with the Phase 2 finite-difference reference (`scripts/options_bench/reference.py`), at the inputs
of each configuration, to say which engine, if either, was outside its stated accuracy.

## 5. Compute (DR-07)

The allowance is 10 aggregate CPU hours (the owner's limit) and covers everything Phase 4a runs: the pre-registration
smoke runs, generation, all four configurations under both limits, the common-input repricing, and any reference
repricing. The guard:
- **One ledger.** `scripts/options_bench/phase4a/cpu.json` records every process's CPU (user plus system, its own
  and its children's, from `resource.getrusage`) as each request finishes, and is read before each one starts.
- **Before each request:** it starts only if the ledger's total plus a forecast for it (the 95th percentile of the
  per-request CPU measured so far, times 1.5; for the pilot's first requests, a fixed 0.25 h) plus a 0.25 h reserve
  stays within 10 h. Otherwise the run stops and writes a "stopped: CPU allowance" record for every request not run.
- **During each request:** it runs in a child process whose CPU limit (`RLIMIT_CPU`) is the smaller of 0.5 h and
  what the allowance has left less the reserve. A request killed at that limit is recorded as "incomplete: CPU
  limit", counted in the ledger, and never re-run silently.
- **The forecast** for the main run is written after the pilot (per-request CPU, p50, p95, max, by configuration and
  limit), with N chosen by section 1's rule. A forecast past the allowance returns an adjustment decision before the
  main run starts.

## 6. What the report returns

Measured results for the four configurations; the recommended switch architecture with its coverage limits,
budget and latency requirements, validation plan (on the reserved seed), serving changes and rollback; and every
unresolved design-review finding. Nothing here is acceptance.
