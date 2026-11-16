# Options Finder: the Tier 2 accuracy check on the picks

Status: built, **off by default** (`OPTIONS_TIER2_CHECK` unset). With the switch off, `/api/desk/options/finder`
answers exactly as before and the Tier 2 modules are not imported. With it on, the answer gains one block,
`engine_check`, and every other field is unchanged. Every number the Finder serves (prices, deltas, ranking,
P&L, breakevens, the payoff curve) stays Tier 1's. This is not the engine switch.

Approved by the owner on 2026-11-16 (option A of the proposal "Tier 2 serving candidate: accuracy check on the
Finder's picks"), with these limits.

## What it does

After the scan has ranked its rows, the check takes each lens's pick (payoff, forgiving, time: at most three
unique contracts) and the exact session context Tier 1 valued for that row (spot, strike, days, rate, residual
yield, the dividends owed, and the volatility solved from the mid). It prices that context with Tier 2
(`src/desk/options_adaptive.price`) and reports, per pick:

- Tier 2's route and status, value, stated error, delta, delta error and their reasons;
- Tier 1's value of the same context and the row's served delta;
- `agree`: true when |V₂ − V₁| ≤ E₂ + tol(V₁), the sum of the two engines' stated accuracies (Tier 1's being its
  tolerance, its observed accuracy; an exact Tier 2 value stating none). This is the approved Phase 2
  positive-control rule. For the delta, when both engines serve one, |Δ₂ − Δ₁| ≤ E_Δ₂ + 2.5e-3.

A contract that is the pick of several lenses is priced once (`lenses` lists them). A disagreement is reported
as one and never changes or hides a Tier 1 number.

Agreement between the two engines is a consistency check of the pricing calculation at Tier 1's inputs. It is
not a validation of the market price, the implied volatility or the ranking, and it is not an independent
cross-check: Tier 2 refines the same lattice model. The independent finite-difference cross-check is Phase 3's,
in development, and needs its own evidence and serving approval before any value is called cross-checked.

## The configuration and the evidence

- `src/desk/options_check.FROZEN` is the configuration frozen for Phase 2's acceptance evaluation (envelope
  estimator, multiples schedule, F = 3, F_d = 2, τ = 1). It is written in `src/` because the API image does not
  carry `scripts/`; `tests/test_options_check.py` pins it equal to
  `scripts/options_bench/calibration/phase2-freeze-2.json` and different from `Config()`'s defaults (hybrid,
  F = 2), which were not evaluated.
- Numerical acceptance (owner, 2026-11-16): Phase 2 attempt 2, evaluated at `ef7d784` on held-out seed 20261102
  with that configuration, is accepted as numerical evidence **for this single-context comparison use only**.
  It is Claude's recorded run, not reproduced by Codex. It does not cover Tier 2 inside implied-volatility or
  carry root-finding, mixed-engine rankings, a full engine switch, Phase 3 Greeks or broader performance claims.
  The frozen population, its coverage qualifications, conditional limits, refused, unresolved and unscored
  classes and the later reference diagnostics stand as `docs/desk/OPTIONS_ADAPTIVE_PHASE2.md` records them.
- The stated error is an empirical estimate validated on the bench's synthetic held-out population, not a proved
  bound, and it has not been measured on real chains.
- `tests/fixtures/options_tier2_golden.json` holds Tier 2's answers on the baseline golden contexts (the named
  regressions, R-1 and the 300-case stratified subset), written from `ef7d784`'s code and bit-identical to
  main's when added (`scripts/options_bench/tier2_golden.py`). A change that moves a Tier 2 number fails it.

## Work, failures and concurrency

- **Additional computation.** The check has its own budget of 300 M work units per scan, on top of the scan's
  own 300 M, which it never charges (the answer's `work` is unchanged). It is enforced before any work is done: a
  pick's solve starts only when the budget left covers `prelattice_reserve`, an upper bound on the closed-form and
  bound work Tier 2 does before its first lattice level (a test pins it above the actual figure on every golden
  context), and each lattice level is charged before it is computed. A pick past it is "not checked: work limit"
  with no value, and nothing more is computed for it. A refused or failed pick is charged its reserve and the levels
  it computed. The largest single context in attempt 2 (95.7 M units) is an observation, not a runtime bound.
- **Failure isolation.** An error inside Tier 2 is that pick's "not checked: error (<type>)", logged; a failure of
  the check as a whole is `{error, picks: []}`. Neither fails the scan.
- **Concurrency.** The check runs inside the Finder lock, so one scan is priced at a time as before.
- **No provider calls.** The check reads only the contexts the scan already built.

## Switch, deploy, rollback

- Switch: `OPTIONS_TIER2_CHECK` = `1`, `true`, `on` or `yes` (read on every request); anything else is off.
- The code ships in the API image, so it reaches production only with a Render deploy of a pinned revision, which
  the owner runs. The web shows the block's line on each pick once the web change is live, and nothing when the
  block is absent.
- Rollback: unset the variable and restart; the block disappears with no deploy. A code rollback is a redeploy of
  the previous pin.
- Disable and investigate if, after activation, any Tier 1 field differs from the switch-off answer, a scan fails
  because of the check, or the check adds more than 3 s to a scan.

## Tests and checks

- `tests/test_options_check.py`: the frozen configuration, the Tier 2 golden, Tier 1 unchanged with the check on,
  the exact session context, the agreement rule at its edges, the budget, failure isolation, the switch, and that
  only `api/desk_options.py` reaches Tier 2, only through `options_check`, only lazily.
- `tests/test_desk_options_api.py`: with the switch on, the route's answer equals the switch-off answer (provider
  request count included) apart from the block, and the check runs inside the Finder lock.
- `scripts/options_bench/tier2_image_check.py`: the flag-on path inside the built image, with the network off.
