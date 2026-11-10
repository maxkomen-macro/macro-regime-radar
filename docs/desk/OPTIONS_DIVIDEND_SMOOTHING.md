# Options Finder: smoothing at dividend closes (design S)

Tier 1's lattice (the Options Finder's served American pricer, `src/desk/options_math.py`) now smooths the step
into each cum-dividend close. Max approved the plan on 2026-11-04; Codex approved the design on its second pass.
The method is described in `docs/desk/OPTIONS_FINDER_MODEL.md` ("Pricers", "Dividend closes"). This report
records what changed, what stayed the same and the evidence, kept separate by kind.

## What changed and what did not

- Changed: Tier 1 values and step-1 deltas for every context with a cum-dividend close on day 1 or later. So
  did the Finder prices, deltas and implied volatilities that come from them on dividend payers.
- Unchanged:
  - Tier 1's acceptance rule, refinement levels, per-context cap (40 M), request cap (300 M), work accounting
    and every tolerance.
  - Contexts without such a close: bit-identical, including a dividend only on day 0.
  - `_lattice` with the flag off (its default): bit-identical. Tier 2 (`src/desk/options_adaptive.py`) and the
    bench's lattice check call it that way.
  - Phase 2's frozen numerical evidence (evaluated at `ef7d784`).
- The served method label stays `finder-2`. Renaming it would touch the API contract and the web fixtures;
  that is left as a separate decision.
- "Exact" here means exact for the local model (hold linear in S* between two children). It is not a proof of
  the lattice's accuracy. That rests on independent references and the held-out run.

## Intended changes to the baseline golden file

`tests/fixtures/options_baseline_golden.json` pins Tier 1's served answers (`scripts/options_bench/golden.py`).
It was regenerated once for this change:

- 16 rows were added: the dividend named regressions in `scripts/options_bench/cases.py`.
- Of the 308 earlier rows, 276 are unchanged.
- 32 rows changed. Only their value or delta moved: no status, route, reason, delta status or work count changed.

Each changed row is compared below with the bench's independent reference for that case (seed 20261026,
Crank-Nicolson FD; `rejudge-addf0dc`, with the D-2 corrected references for dividend cases). Errors are in
units of the case's tolerance; delta errors are absolute.

| case | dividends | before | after | reference | error before (tol) | error after (tol) | delta error before | delta error after |
|---|---|---|---|---|---|---|---|---|
| G2-dividends/7 | 1 | 28.817433 | 28.823480 | 28.823488 | -0.420 | -0.001 | -0.00007 | +0.00000 |
| G4-negrate/21 | 1 | 28.554718 | 28.560606 | 28.560652 | -0.416 | -0.003 |  |  |
| G2-dividends/37 | 1 | 13.902804 | 13.906115 | 13.906151 | -0.335 | -0.004 | +0.00019 | +0.00000 |
| G2-dividends/34 | 1 | 5.051124 | 5.048986 | 5.049073 | +0.205 | -0.009 |  |  |
| G6-long/29 | 13 | 6.797877 | 6.798932 | 6.799185 | -0.131 | -0.025 | -0.00003 | -0.00001 |
| G2-dividends/35 | 1 | 17.601547 | 17.602747 | 17.602779 | -0.123 | -0.003 | +0.00008 | +0.00000 |
| T1-near-boundary/20 | 1 | 16.717611 | 16.718814 | 16.718485 | -0.087 | +0.033 |  |  |
| G6-long/23 | 16 | 11.722452 | 11.721588 | 11.721646 | +0.081 | -0.006 | +0.00001 | -0.00000 |
| G2-dividends/18 | 2 | 2.457211 | 2.456405 | 2.456532 | +0.068 | -0.013 | +0.00005 | -0.00001 |
| named/B8 | 1 | 13.067778 | 13.068408 | 13.068407 | -0.063 | +0.000 |  |  |
| G6-long/19 | 10 | 25.986051 | 25.985198 | 25.985312 | +0.057 | -0.009 | +0.00001 | -0.00000 |
| G2-dividends/0 | 2 | 21.808201 | 21.808832 | 21.808732 | -0.049 | +0.009 | -0.00003 | -0.00000 |
| G3-carry-itm/36 | 1 | 15.342418 | 15.342694 | 15.342719 | -0.030 | -0.003 | +0.00000 | +0.00000 |
| G5-extreme-vol/15 | 1 | 15.669978 | 15.670039 | 15.670271 | -0.029 | -0.023 |  |  |
| G6-long/17 | 16 | 22.255670 | 22.255831 | 22.255936 | -0.024 | -0.009 | +0.00000 | +0.00000 |
| G6-long/14 | 9 | 35.292696 | 35.293069 | 35.293005 | -0.018 | +0.004 | +0.00005 | +0.00000 |
| G2-dividends/2 | 1 | 4.216649 | 4.216649 | 4.216524 | +0.013 | +0.013 | +0.00000 | +0.00001 |
| T1-near-boundary/10 | 1 | 18.403738 | 18.403872 | 18.403858 | -0.012 | +0.001 |  |  |
| G6-long/3 | 14 | 43.252649 | 43.252736 | 43.252820 | -0.008 | -0.004 | -0.00000 | -0.00000 |
| G4-negrate/10 | 1 | 5.653693 | 5.653694 | 5.653660 | +0.003 | +0.003 | +0.00000 | +0.00000 |
| G6-long/26 | 14 | 19.403690 | 19.403600 | 19.403665 | +0.003 | -0.006 | +0.00000 | -0.00000 |
| G6-long/38 | 6 | 32.136337 | 32.136253 | 32.136371 | -0.002 | -0.007 | -0.00000 | -0.00000 |
| G2-dividends/38 | 1 | 22.327275 | 22.327260 | 22.327255 | +0.002 | +0.000 | +0.00000 | +0.00000 |
| G6-long/11 | 9 | 19.985379 | 19.985377 | 19.985396 | -0.002 | -0.002 | +0.00000 | +0.00000 |
| G6-long/1 | 16 | 22.160797 | 22.160724 | 22.160781 | +0.001 | -0.005 | +0.00000 | -0.00000 |
| G2-dividends/26 | 2 | 18.568365 | 18.568377 | 18.568378 | -0.001 | -0.000 | +0.00000 | +0.00000 |
| G2-dividends/39 | 1 | 4.639008 | 4.639012 | 4.639011 | -0.000 | +0.000 |  |  |
| G2-dividends/32 | 1 | 0.143936 | 0.143936 | 0.143936 | +0.000 | +0.000 | +0.00000 | +0.00000 |
| G4-negrate/24 | 1 | 0.000112 | 0.000112 | 0.000112 | -0.000 | -0.000 | -0.00000 | -0.00000 |
| G2-dividends/30 | 1 | 22.849372 | 22.849372 | 22.849372 | -0.000 | -0.000 |  |  |
| G2-dividends/17 | 1 | 0.000000 | 0.000000 | 0.000000 | -0.000 | -0.000 | -0.00000 | -0.00000 |
| G2-dividends/21 | 1 | 0.000000 | 0.000000 | 0.000000 | -0.000 | -0.000 | -0.00000 | -0.00000 |

The largest error after the change is 0.033 tol (T1-near-boundary/20, −0.087 before). A few rows that were
already near zero moved by less than 0.01 tol, in either direction.

## Named regressions

16 dividend cases from seeds 20261029 and 20261026, with their exact inputs, are in `cases.NAMED`. The bench
scores them on every run. `tests/test_options_dividend_smoothing.py` checks them against stored references
(`tests/fixtures/options_dividend_references.json`): the price, a served delta, and the dividend scenario
(every amount ×1.1 and ×0.9) within half a tolerance plus the reference's uncertainty. At main `38916cb`
(before this change), 10 of the 16 fail that check, including both held-out dividend-scenario failures
(S29 G2/1239 and G4-negrate/54).

## How the unchanged paths are checked

Two tests check that a path the fix must not touch is bit-identical to the code before it:
- `test_the_flag_off_lattice_is_bit_identical_to_before` (`tests/test_options_dividend_smoothing.py`), for
  `_lattice` with the flag off;
- `test_solves_without_a_continuous_cum_close_are_unchanged` (`tests/test_options_bench_dividends.py`), for the
  bench FD without a cum close inside continuous exercise.

Each runs the current code and a verbatim copy of the file before the change in the same process, and compares
every output bit for bit. The copies are `options_math.py` at `38916cb` and `fd.py` at `6b21304`, in
`tests/fixtures/options_pre_dividend_smoothing/`, and each is checked against its git blob id before use.

The first version compared against float.hex values recorded on one machine. Those values are specific to the
platform's numpy and libm. On another machine the old and the new code both give other bits, identical to each
other, so the recorded values failed there although nothing had changed. Limiting numpy's SIMD dispatch here
(`NPY_DISABLE_CPU_FEATURES`) reproduces that kind of failure for the recorded values (here 5 assertions: one
lattice case and the four FD cases; the Mac showed 4). The same-process comparison passes under it and still
fails on a one-ulp change to either path.

The same SIMD limit also fails `tests/test_options_engine.py::test_baseline_matches_the_golden_file`. Its first
mismatch is G1-nodiv/33's delta (a case with no dividend), identical on main `f61112b` before this PR. That is the golden
file's platform dependence, not an effect of this fix, and the frozen golden file is not regenerated for it.

## Existing tests changed

Each change accounts for an intended change in behaviour. No test was removed, skipped or loosened.

- `tests/test_options_engine.py`: the golden layout now puts the 16 dividend named regressions before R-1, so
  the row count is the named list plus R-1 plus the 300-case subset.
- `tests/test_options_bench.py`: the named-input check lists the 16 new ids and also checks each one's inputs
  against the seeded generator.
- `tests/test_options_bench_phase2.py`: the Phase 2 harness compares Tier 1 with Phase 2's stored run, which
  was made before this change. B8 (a dividend on day 2) is smoothed now, so the check must report that it no
  longer matches. The other four cases must still match, and the stored records are not edited.
- `tests/test_desk_options_math.py`: the early-dividend context (dividends on days 3, 94 and 185) now converges
  at its (N, 2N) pair rather than (2N, 4N). Its value is still checked against QuantLib. Refinement charging
  is now checked on B8, which still refines to (2N, 4N) on its delta test.

## Held-out evidence

These are empirical results on sampled cases. They are not proved bounds and not a claim about real chains or
whole requests. Numerical acceptance and the merge are Max's separate decisions.

### First registered run (seed 20261117): not met, not accepted

[HELD_OUT_REGISTRATION.md](options-dividend-smoothing/HELD_OUT_REGISTRATION.md), frozen `44a7f74`, 17,223 cases.
- Engine: 0 price, delta or dividend-scenario failures.
- Three components were open, all from the benchmark:
  - Price accuracy was insufficient: G0-exempt was registered at 300 cases, below the scorer's 1,000 target.
  - One European delta control was 1.07 u from Black-76. A low-order refinement study had applied an
    extrapolation its own order test did not trust.
  - One crash: the IV round trip diagnostic hit the 300 M request cap and the bench did not catch the Finder's
    refusal. The same crash happens on main's engine.
- Max did not accept the run (2026-11-05 19:14 UTC). It stays on record unchanged, and its cases are exposed.

### Benchmark repair (design B), bench only

Commits `7d4f6d8` and `1a4bad4`. Nothing under `src/` changed.
- **Low-order studies.** A study whose observed order fails the order test no longer extrapolates. Its
  uncertainty is the larger of the old estimate and the wide estimate the other non-asymptotic kinds use.
- **IV work cap.** The IV round trip records the Finder's work-cap refusal as a refusal. A refusal of the bench's
  later vega or back-pricing measurement keeps the solved sigma and is listed apart. Any other exception still
  crashes the case, and a crash still fails run integrity.
- **QuantLib FD arbiter.** For each QdFp comparison outside the reference's stated uncertainty, QuantLib's
  Crank-Nicolson FD runs on three grids and is read with the reference's own refinement rule, then reported in
  five categories. It is a diagnostic: not a gate, and it assigns no cause.
- **Unresolved references** are counted by reason.

Tolerances, gates, caps and the domain are unchanged. Codex approved the design on its fourth pass, and code
review round 3 had no findings.

Max authorized a diagnostic recomputation of every record of seed 20261026 (engine `addf0dc`) under the final
bench, compared with the unrepaired bench on the same cases. It is kept apart from the original evidence and is
not acceptance (review-loop/dividend-fix/rerun-S26/COMPARISON.md):
- engine outputs identical
- all seven component verdicts identical
- 176 cases' references moved (72 values, 107 deltas), none changed status; the largest value shift is 0.0076
  of its tolerance and the largest delta shift 5.1e-5
- arbiter: 310 of 315 reference-consistent

### Second registered run (seed 20261111): all seven components met

[HELD_OUT_REGISTRATION_2.md](options-dividend-smoothing/HELD_OUT_REGISTRATION_2.md), frozen `1a4bad4` (engine files
identical to `44a7f74`), 18,423 cases, registered before any case was drawn. Scored by `score.py` at `1a4bad4`.
The gate's in-domain groups are G0-exempt to G6-long (random) and T1-near-boundary (targeted); the scorecard's
summary statistics cover the random groups, so T1's figures are given beside them.

| Component | Verdict | Evidence |
|---|---|---|
| Price accuracy | pass | random groups: 16,300 scored (at least 1,000 in each, G0-exempt 1,500), error p50 0.0002 tol, p99 0.046 tol, max 0.368 tol (G3-carry-itm/335); T1: 1,490 scored, p99 0.105 tol, max 0.589 tol (T1-near-boundary/270); 0 failures and 0 indeterminate in any group |
| Displayed delta | pass | random groups 13,255 scored and 3,047 withheld; T1 982 scored and 508 withheld; 0 failures, 0 indeterminate (withholding an unvalidated delta is not an accuracy failure) |
| Early-exercise bound | pass | 2,276 checked: 813 covered, 0 violated, 0 indeterminate, 1,463 unscored |
| Dividend scenario | pass | 2,741 scored in domain; all groups: pass 2,765, refused 91, no failure or indeterminate |
| Reference controls | pass | 1,863 European controls (max 0.35 u) and 150 exempt cases, all within their uncertainty; 0 lattice disputes |
| Named regressions | pass | 23 of 23 |
| Run integrity | pass | 18,423 of 18,423 cases, 0 crashes |

Coverage, reported against the full population:
- **Refusals:** 186 not-converged refusals in the random in-domain groups (133 in G5-extreme-vol), and 10 in
  T1-near-boundary.
- **Unresolved references:** 17 in-domain values, unscored and never counted as passes (G5-extreme-vol 12,
  G6-long 4, G3-carry-itm 1), and 46 in X1-outside, mostly convection-dominated.
- **IV round trip** (a diagnostic, not gated): no work-cap refusal. Random groups: 3,232 of 3,270 solved, 21 no
  root, 17 unpriceable; T1: 294 solved, 4 unpriceable. Its identifiability test reads vega at the true sigma
  only, so it can call a case identifiable where the price is flat in sigma near the recovered root: named
  S29-T1-1351 solved at sigma 0.001 against a true 0.510 with a residual of 3e-14 (a sigma outside the Finder's
  IV range).
  The largest error × vega among identifiable random cases is 1.5 tol (G4-negrate/1440).
- **QuantLib QdFp comparisons outside u:** 373 in all (237 in the random groups, 129 in T1, 7 in X1-outside).
  The arbiter put them at:
  - reference-consistent: 369
  - arbiter-unresolved: 3 (G6-long/2312, T1-near-boundary/117, T1-near-boundary/163)
  - neither: 1 (G1-nodiv/1647)

The request matrix and dashboard latency measure the engine. They were run against main with the `44a7f74`
engine, whose files are identical:
- no request newly over the 300 M cap (5 of 24 over on both)
- Finder time +3.1% pooled (two alternating repetitions, ratios 1.008 and 1.056), within 10%
- dashboard latency the same as main, including the existing stall of up to about 0.8 s on the big chain

Evidence: review-loop/dividend-fix/held-out-2/ (run, scorecard, sha256 manifest), final-requests/ and
final-latency/.

### Numerical acceptance

Max accepted the registered seed 20261111 result on 2026-11-10 (01:25 UTC), within the registered population,
coverage and acceptance rules. That acceptance is recorded apart from the merge and from any API deployment: the
fix is not in the deployed release B, and its deployment needs its own pinned release decision.

- The first registered run (seed 20261117) stays on record as not met and not accepted. The seed 20261026
  recomputation stays a diagnostic recomputation.
- Refusals, unresolved references, withheld deltas, unscored bound checks and the IV diagnostics are not passing
  observations.
- The acceptance does not establish trading edge, complete IV or Greek validation, or institutional readiness.
