# Options engine, adaptive Phase 2: the Tier 2 convergence controller

Status: built and scored, **unserved**. Nothing under `api/` or `web/` imports the new modules; the Finder keeps
serving the baseline (Tier 1). The engine switch is Phase 7 and needs the owner's explicit approval. Tier 2
values are "estimated, cross-check pending" until the Phase 3 cross-check exists.

- Plan: "Options engine Phase 2 plan: convergence controller", revision 2, approved 2026-10-29 05:39 UTC, with
  amendment A-1 (2026-10-29 18:11 UTC: interval refusals and the analytic-route estimate) and amendment A-2
  (2026-11-02 20:53 UTC: fix S-9 and S-10 here, hold a retained delta to the accepted price's exercise-zone
  test, make acceptance require the held-out run of the frozen population, then run attempt 2).
- Design: design P2-2 (project files, `review-loop/options-adaptive/designs/`), approved by Codex on its fourth
  design pass. Addendum A (A1–A3) was written during the build, after that pass, and reviewed in code-review
  rounds 1–4, not as a design pass. A1 and A3 are amendment A-1. A2 is a deviation from design 9.3: calibration
  aims its tightened reference at 0.1 of the finest straddling candidate's estimate, not at the floor, and reads
  its reliability against each candidate's own 0.1·E_s; in the held-out run the target is exactly 0.1·E_s, as the
  design says.
- Attempts: **attempt 2** (freeze `ef7d784`, engine `adaptive-p2.1`, held-out seed 20261102, fixed before its
  calibration) is the evaluation of the final code: **it met every gate row**, on a `--held-out` run of the
  freeze's own population, so the acceptance prerequisite holds. **Attempt 1** (freeze `2f7bf07`, engine
  `adaptive-p2.0`, held-out seed 20261029) also met every gate row and is **historical**: amendment A-2 changed
  the controller and the bench after it, so its results stand only for the code at `2f7bf07` and are
  superseded. Its freeze, selection report and scorecards are kept unchanged. The exploratory and provisional
  calibrations listed below are not attempts and are kept on record.
- Provenance: every run here is **Claude's recorded run**, not reproduced by Codex. Codex reviewed the code, the
  freezes and the selection reports in its code reviews; it did not rerun calibration or either held-out evaluation.

## What was built

| File | What |
|---|---|
| `src/desk/options_engine.py` | Engine interface and statuses; the baseline adapter over `options_finder.Pricer`, called unchanged |
| `src/desk/options_adaptive.py` | Tier 2: routes, the analytic interval, the refinement walk, both estimators, three schedules, the delta gate |
| `tests/fixtures/options_baseline_golden.json` | Tier 1's served outputs on the named cases, R-1 and a 300-case stratified subset |
| `scripts/options_bench/{adaptive,phase2,calibrate,score2,routine}.py` | Adapter and verdict protocol, frozen runner, calibration, Phase 2 scorer, routine subset |
| `scripts/options_bench/calibration/` | Attempt 1's freeze (`phase2-freeze.json`) and selection report, kept byte for byte; attempt 2's are `phase2-freeze-2.json` and `phase2-selection-2.json` |

Tier 2 routes, in order: input failure; intrinsic at expiry; outside the domain; exempt (European, by theorem);
the analytic interval; the lattice. (Attempt 1's frozen docstring listed exempt before the domain test; the code
has always tested the domain first, and the docstring is corrected for attempt 2.) The proved interval is [L, U] with L = max(European, intrinsic) and
U = European + the early-exercise premium bound.

- **Analytic route.** Returns the midpoint of [L, U] and states E = h + 0.1·tol(L), the half-width h plus a
  padding of 0.1·tol(L), recorded apart in the audit (`h`, `padding`, `analytic_target`). The route is taken only
  when the full E meets the target; otherwise the lattice runs, or the context is unresolved. Midpoints are
  unchanged for cases that keep the analytic route; the stricter eligibility sends other cases to the lattice,
  which can change their work, status and value. R-1 (one-day put, S 100, K 110) returns 10.00000000005 with
  E ≈ 1.0e-3; Tier 1 still serves 9.99969863 (golden-pinned).
- **Lattice route.** Levels from the frozen kernel (`options_math._lattice`, read-only), each recomputed and
  charged. The price is accepted at the first level whose estimate E_s = max(F·E, 0.1·tol) is within the
  target and whose value lies in [L, U]. A candidate outside [L, U] is **refused, never served or clipped**, and
  the walk refines further. Every refusal is kept in the audit, and so is every level whose band
  [V − E_s, V + E_s] misses [L, U] altogether.
- **Delta.** Its own gate: E_d,s = max(F_d·E_d, 2.5e-4) ≤ 2.5e-3, with the early-dividend, exercise-zone and
  exercise-decision safeguards; ±1 only by the deep-exercise rule. A sound price keeps its value when the delta
  is withheld.
- **Positive control.** `force_lattice` skips the exempt and analytic routes and the interval test; its answers
  carry the status "positive control" and are never accepted or usable.

## Calibration and freeze (attempt 2)

The selection rule is attempt 1's (next section). Calibration `cal-4` priced the same 12,707 stored development
cases (seed 20261026) with the controller and bench at `892edcc`: 12,707 cases, 0 errors. The retained-delta fix
changed no development result (0 price rows and 0 delta rows differ from `cal-3` across all candidates), so the
selection is byte-identical to attempt 1's. Frozen at `ef7d784` (`calibration/phase2-freeze-2.json`, reviewed by
Codex in round 9 with no findings): envelope estimator, multiples schedule, F = 3, F_d = 2, τ = 1; 2,500 per random
group, T1 1,500, X1 400, G0 300, plus the named cases. The freeze records attempt 1's freeze and selection by
SHA-256 and refuses a seed that has been used (20261026, 20261029). Nothing was tuned on held-out outcomes.

## Held-out result (attempt 2, seed 20261102, 17,207 cases)

**Gate verdict: met.** Every row passes, and the run is eligible as the Phase 2 acceptance (`--held-out`, the
freeze's seed, sizes and named cases, every case finished, hashes matching the freeze, references matching the
manifest's fingerprint).

| Row | Verdict | Evidence |
|---|---|---|
| Tier 1 unchanged | pass | golden file matches; Tier 1 equals the bench's own baseline run on all 17,207 cases |
| Sample counts | pass | 10,611 Tier 2-accepted, reference-resolved lattice prices in G1–G6 (at least 1,000 per group: smallest G1, 1,387); at least 1,513 scored deltas per group |
| Tier 2 price accuracy | pass | 0 failures, 0 indeterminate; worst error 0.579 tol (G2), p99 0.134 tol |
| Estimator coverage, price | pass | **0 exceedances**; conditional limits 0.13%–0.22% per group in G1–G6 (T1 0.24%), all at most 1% |
| Estimator coverage, delta | pass | **0 exceedances**; conditional limits 0.13%–0.20% per group in G1–G6 (T1 0.31%) |
| Analytic route | pass | 4,027 cases, none outside [L, U], no accuracy failure; 4,016 covered, 11 without a reference |
| Proved interval (every Tier 2 output) | pass | no usable output outside its own [L, U] (main answer, every sweep target, every dividend scenario), no disjoint band, no proved exceedance, no inconsistent interval |
| Displayed delta | pass | 0 failures, 0 indeterminate, none served without an estimate; no delta withdrawn by the A-2 rule |
| Dividend scenario | pass | 2,626 scored, 0 failures; 144 refused, 14 unscored |
| Reference reliability | pass | 1,727 European controls, none outside u; 94 R0 prices unresolved; 64 tightened references |
| Named regressions | pass | 7 of 7 for Tier 2 and for Tier 1; R-1 row passes |
| Determinism and run integrity | pass | 17,207 of 17,207 records, 0 crashes; 351 repeated from scratch, all bit-identical; hashes match the freeze |
| Work, per context | pass | largest single level 37.8 M units (cap 40 M) |

Estimator coverage by group (lattice prices; one-sided 95% Clopper–Pearson upper limits, per group, under this
frozen attempt and seed; not a joint statement):

| Group | Accepted | Covered | Confirmed | Unresolved | No reference | Conditional | All-accepted |
|---|---|---|---|---|---|---|---|
| G1-nodiv | 1,388 | 1,387 | 0 | 0 | 1 | 0.22% | 0.34% |
| G2-dividends | 1,756 | 1,754 | 0 | 0 | 2 | 0.17% | 0.36% |
| G3-carry-itm | 2,054 | 2,043 | 0 | 0 | 11 | 0.15% | 0.88% |
| G4-negrate | 1,628 | 1,628 | 0 | 0 | 0 | 0.18% | 0.18% |
| G5-extreme-vol | 1,503 | 1,502 | 0 | 0 | 1 | 0.20% | 0.32% |
| G6-long | 2,315 | 2,297 | 0 | 0 | 18 | 0.13% | 1.15% |
| T1-near-boundary (apart) | 1,252 | 1,251 | 0 | 0 | 1 | 0.24% | 0.38% |

- No price or delta estimate was exceeded in any group. The all-accepted limit is above 1% only in G6 (1.15%),
  because 18 accepted contexts have no reliable reference; it is reported, not gated, as approved.
- Interval refusals (report only; refusals are not passes): candidates outside [L, U] were refused on the main
  answer in 4.5% of G1, 1.5% of G2, 1.6% of G3, 15.3% of G4, 4.2% of G5 and 5.4% of G6 cases, none in T1. All
  1,299 sat below L (numerical undershoots, cause not established as roundoff), the largest 0.034 tol (G1); none
  above U. In 142 cases no later level was accepted and the price stayed unresolved.
- Coverage on G1–G6: Tier 2 priced 98.3% (14,746 of 15,000), Tier 1 98.8% (14,814) on the same cases. Work per
  priced context p50 / p95 / max: 0.52 M / 25.0 M / 95.7 M units; G6's median is 18.1 M. Targets below tol:
  97.1% priced at 0.5·tol, 95.2% at 0.25·tol, 83.7% at 0.1·tol (random groups). These rows are report only in
  Phase 2, as in attempt 1.
- Full scorecards: `docs/desk/options-adaptive-phase2/held-out-2-scorecard2.md` (Tier 2) and
  `held-out-2-baseline-scorecard.md` (Tier 1, merged scorer).

### What the baseline shows on attempt 2's held-out seed (Tier 1, unchanged)

The merged scorer on the same reference run: prices 15,082 scored in the in-domain groups, 0 failures,
0 indeterminate; deltas 0 failures; dividend scenario 2,674 scored in domain, **0 failures**, 0 indeterminate;
early-exercise bound 774 covered, 0 violated; 0 lattice disputes. Its verdict is "not met" only because G0-exempt
has 300 scored prices, below the merged gate's 1,000, since the freeze sizes G0 at 300. That this seed shows no
dividend-scenario failure does not clear backlog B-1, which stays the dividend-fix thread's work.

## Reference check: the day-0 defect and the QuantLib convention (diagnostic, kept apart)

On 2026-11-03 the dividend-fix thread found two reference-side issues. The owner asked whether either affects
Phase 2's acceptance evidence. These checks read the frozen runs' files and the evaluated checkout read-only and
write only to the project files' `review-loop/options-adaptive/ref-check/`; the frozen evaluation and its
artifacts are unchanged.

- **QuantLib's escrowed model differs from ours when q ≠ 0.** No Phase 2 gate reads QuantLib: `phase2.py` and
  `score2.py` never use it, the bench already skips QuantLib for dividend cases with q ≠ 0, and neither held-out
  reference run had QuantLib installed. It cannot move a Phase 2 verdict. On the development seed's q = 0 dividend
  cases, QuantLib and the bench reference agree within 0.041 tol (1,000 cases).
- **The bench FD rang at a day-0 cum close.** Each day-0 case was recomputed independently as max(exercise today,
  the bench reference of S − D₀ with the day-0 dividend removed), which is exact under the escrowed model and
  never solves a day-0 close. It reproduces T1-near-boundary/1351 of seed 20261029 at 14.353056, where the stored
  reference read 14.355342 (unresolved). On attempt 2's 598 day-0 cases the stored references agree with it
  within 0.005 tol on the main answer and 0.018 tol on the dividend states. Re-judged against it, no price,
  delta, accuracy or dividend-scenario verdict gets worse; one price moves from no reference to covered.
  Attempt 1's 586 day-0 cases: likewise none worse, 4 move from no reference to covered.
- **Every dividend case against corrected references.** The dividend-fix thread's reviewed bench fix
  (`fd.py` at `07a6f5c` on its branch) reran every stored dividend reference for seeds 20261029 and 20261026:
  34 of 34,476 interior comparisons shift beyond their uncertainty, and no value or dividend-scenario shift
  exceeds 0.082 tol. Re-judging attempt 1's 8,390 dividend cases with them, no Tier 2 verdict becomes
  confirmed or failed; 4 become straddles, and a tightened reference from the fixed FD settles all 4 as covered.
- **Attempt 2 against corrected references.** The same fixed FD reran all of attempt 2's 8,403 dividend cases
  (value, delta and both dividend states; a scratch copy of `ef7d784` with only `fd.py` replaced, 0 errors).
  Interior closes: 16 of 20,718 comparisons shift beyond their uncertainty, no value or dividend-state shift
  exceeds 0.070 tol, and no delta shift exceeds 0.103 of the delta tolerance. Day-0 closes: 9 of 1,569 beyond u,
  at most 0.036 tol in value; the largest delta shift (G3-carry-itm/137, 0.25 of the delta tolerance) matches
  the decomposition above, and that case's delta is withheld (a dividend within 5 days). Re-judged with the
  corrected references, **no Tier 2 verdict gets worse**: 28 prices, 2 deltas and 12 dividend scenarios move from
  no reference or unscored to covered or pass, and one price (G6-long/2375) moves from no reference to a
  straddle, which a tightened reference from the fixed FD settles as covered.

So neither finding changes the attempt 2 verdict, and corrected references only add covered and passing
outcomes. These are diagnostics: the scorecard of record stays the frozen run's. The fixed FD is the
dividend-fix thread's change and is not part of this branch.

## Calibration and freeze (attempt 1, historical)

Selection rule (as approved): F is the smallest of {2, 2.5, 3, 4} with no confirmed or unresolved case and a
needed factor at most F/1.25; F_d the same way; ties go to the highest worst random-group coverage, then the
lower work, then the envelope estimator. A disjoint band, an accepted value outside [L, U], a proved
exceedance or an inconsistent interval also fails a candidate (amendment A-1).

On the 12,707 stored development cases, priced with the controller and bench at `ce2da73`:

| Candidate | F = 2 | F = 2.5 | F = 3 | F = 4 | F_d | Worst random-group coverage |
|---|---|---|---|---|---|---|
| envelope, doubling | 1 failing case | needed 2.39 > 2.0 | pass | pass | 2 | 0.545 (G6: doubling cannot reach four levels past 1,118 days) |
| **envelope, multiples** | 2 failing cases | needed 2.21 > 2.0 | **pass** | pass | **2** | **0.964** |
| envelope, hybrid | 1 failing case | needed 2.39 > 2.0 | pass | pass | 2 | 0.941 |
| fitted order, each schedule | fails | fails | fails | fails | — | — |

Frozen (`2f7bf07`, reviewed by Codex in round 5 with no findings): envelope estimator, multiples schedule,
F = 3, F_d = 2, τ = 1. Sizes by the frozen 4-sd rule: 2,500 per random group (the aggregate lower estimate is
10,239 at 2,500 and 9,825 at 2,400), with T1 1,500, X1 400 and G0 300 reported apart, plus the named cases.

Earlier calibrations, kept and superseded (none is an attempt): `cal-pre` on pre-review code (exploratory); `cal-1`
on `f5d41bf`, stopped by a container restart at 5,001 of 12,707 cases; `cal-2` on `c5b4fea`, complete but void for
the freeze because a bench file changed after pricing (the calibration manifest refuses it). `cal-2`'s provisional
selection matched the frozen one. Evidence in the project files under `review-loop/options-adaptive/calibration/`.

## Held-out result (attempt 1, historical: seed 20261029, 17,207 cases)

**Gate verdict: met** for the code at `2f7bf07`. Superseded by attempt 2; kept as recorded.

| Row | Verdict | Evidence |
|---|---|---|
| Tier 1 unchanged | pass | golden file matches; Tier 1 equals the bench's own baseline run on all 17,207 cases |
| Sample counts | pass | 10,564 Tier 2-accepted, reference-resolved lattice prices in G1–G6 (at least 1,000 per group: smallest G1, 1,357); at least 1,513 scored deltas per group |
| Tier 2 price accuracy | pass | 0 failures, 0 indeterminate; worst error 0.374 tol (G2) |
| Estimator coverage, price | pass | conditional limits 0.13%–0.35% per group, all at most 1% |
| Estimator coverage, delta | pass | conditional limits 0.14%–0.27% per group |
| Analytic route | pass | 4,110 cases, none outside [L, U], no accuracy failure; 4,103 covered, 7 without a reference |
| Proved interval (every Tier 2 output) | pass | no usable output outside its own [L, U] (main answer, every sweep target, every dividend scenario), no disjoint band, no inconsistent interval |
| Displayed delta | pass | 0 failures, 0 indeterminate, none served without an estimate |
| Dividend scenario | pass | 2,622 scored, 0 failures; 165 refused, 20 unscored |
| Reference reliability | pass | 1,727 European controls, none outside u; 116 R0 prices unresolved; 37 tightened references |
| Named regressions | pass | 7 of 7 for Tier 2 and for Tier 1; R-1 row passes |
| Determinism and run integrity | pass | 17,207 of 17,207 records; 351 repeated from scratch, all bit-identical; hashes match the freeze |
| Work, per context | pass | largest single level 38.6 M units (cap 40 M) |

### Estimator coverage by group (lattice prices)

Each limit is a one-sided 95% Clopper–Pearson upper limit for that group alone, under this frozen attempt and
seed; six limits are not a joint statement. The binding (conditional) limit counts covered, confirmed and
unresolved cases; the resolved-all and all-accepted limits are reported beside it and are not gated. An
unresolved reference is insufficient evidence, not proof that the engine is wrong or right.

| Group | Accepted | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional | Resolved-all | All-accepted |
|---|---|---|---|---|---|---|---|---|---|
| G1-nodiv | 1,357 | 1,356 | 1 | 0 | 0 | 0 | 0.35% | 0.35% | 0.35% |
| G2-dividends | 1,815 | 1,808 | 0 | 0 | 0 | 7 | 0.17% | 0.17% | 0.72% |
| G3-carry-itm | 2,017 | 2,000 | 0 | 0 | 0 | 17 | 0.15% | 0.15% | 1.26% |
| G4-negrate | 1,591 | 1,590 | 0 | 0 | 0 | 1 | 0.19% | 0.19% | 0.30% |
| G5-extreme-vol | 1,515 | 1,509 | 0 | 0 | 0 | 6 | 0.20% | 0.20% | 0.78% |
| G6-long | 2,323 | 2,300 | 0 | 0 | 0 | 23 | 0.13% | 0.13% | 1.40% |
| T1-near-boundary (apart) | 1,209 | 1,205 | 0 | 0 | 0 | 4 | 0.25% | 0.25% | 0.76% |

- The all-accepted limit is above 1% in G3 (1.26%) and G6 (1.40%), because 17 and 23 accepted contexts have no
  reliable reference there. That limit is reported, not gated, as approved; it is not evidence of an error.
- Two stated estimates were exceeded, each inside its tolerance:
  - Price, G1-nodiv/1287 (254-day put): error 1.24e-3 = 0.124 tol against an estimate of 1.08e-3 (factor 1.14).
  - Delta, G2-dividends/574 (53-day call): error 2.9e-4 against an estimate of 2.7e-4 (judged against a
    tightened reference), within the 2.5e-3 delta tolerance.
  Both count as exceedances in their group's limit, and both groups stay well under 1%.

### Interval refusals (report only; refusals are not passes)

Lattice candidates outside [L, U] were refused on the main answer in 5.1% of G1, 1.6% of G2, 2.0% of G3, 14.0% of
G4, 4.7% of G5, 4.8% of G6 and 0.07% of T1 cases (at some level). Almost all sit below L: they are **numerical
undershoots**, and their cause has not been established as roundoff. The largest is 0.032 tol (G5); G3 has 11
above U. In 142 cases no later level was accepted and the price stayed unresolved. The scorecard reports
frequency, side and size by group, maturity band and output (main answer, each sweep target, each dividend
scenario). At τ = 0.1 the analytic route is never taken, and many sweep refusals there are lattice values at an
interval end by a hair (G1 at 0.1·tol: median 3e-14 tol; 1,403 below L, 57 above U).

### Coverage and work (report only in Phase 2)

| | Tier 2 | Tier 1 (same held-out cases) |
|---|---|---|
| Priced, random groups G1–G6 | 98.4% (14,758 of 15,000) | 98.9% (14,828 of 15,000) |
| Work per priced context, p50 / p95 / max | 0.52 M / 25.0 M / 94.2 M units (G1–G6) | 0.09 M / not reported / 51.9 M units (the merged scorer's G0–G6 and T1 total) |

- Tier 2 prices 0.5 points fewer of these contexts than Tier 1; its refusals are named (outside the interval,
  estimate above target, the schedule cap). The coverage-at-least-the-baseline row stays a later obligation, as
  the plan says.
- Work is per context. Long-dated contexts cost 18 M units at the median (G6), so a request with many long-dated
  contracts would exceed the 300 M request budget; that is a Phase 4/5 question and is not claimed here.
- Targets below tol: 97.2% priced at 0.5·tol, 95.4% at 0.25·tol, 83.8% at 0.1·tol (random groups).

## What the baseline shows on attempt 1's held-out seed (Tier 1, unchanged by this branch)

The merged scorer, run on the same held-out reference run, scores today's served baseline:

- Prices: 15,081 scored in the in-domain groups (G0–G6 and T1), 0 failures, 0 indeterminate; deltas 0 failures.
- **Dividend scenario: 1 failure and 1 indeterminate.** G2-dividends/1239 (21-day call, a 2.04 dividend on day
  4, volatility 0.50): the baseline's price change between the ±10% dividend states differs from the reference's
  by 1.13 tol. G2-dividends/1725 straddles the threshold. Tier 2 refuses a scenario price on both cases.
- One lattice dispute to investigate (T1-near-boundary/1351, a dividend on day 0). The dividend-fix thread
  traced it to the bench FD's day-0 defect: Tier 1 was right (exercise today, 14.353056).
- Under that thread's corrected references (diagnostic, outside these frozen artifacts), Tier 1 also fails
  G4-negrate/54's dividend scenario at 1.353 tol (its +10% reference was unresolved before), G2-dividends/1239
  still fails (1.144 tol) and G2-dividends/1725 passes. Tier 2 refuses both failing cases. Both belong to
  backlog B-1.
- G0-exempt has 300 scored prices, below the merged gate's 1,000, because the freeze sizes G0 at 300.

These are facts about Tier 1 on a new seed. This branch does not change Tier 1 and does not fix them. The
dividend-scenario failure is recorded as a separate follow-up (backlog B-1 in the project files'
`review-loop/options-adaptive/BACKLOG.md`), as the owner asked on 2026-11-02.

## Review findings S-9 and S-10 (resolved for attempt 2)

Codex's final whole-branch review of attempt 1 (round 6, at `30ffef1`) found two gaps in the held-out runner,
both from the first bench commit and neither in the pricing or scoring math:

- **S-9.** `phase2.py` resumed a run without fingerprinting the reference records, so a reference file changed
  between sessions could keep earlier verdicts.
- **S-10.** `phase2.py` adopted results that had no manifest and stamped them with the current freeze.

The owner chose to fix both here and rerun (amendment A-2). Since `f6c96ad` the manifest fingerprints every
reference file, a resume after they change is refused, a result file without its manifest is refused, and the
scorer checks both. Attempt 1 ran before the fix: in one session, in a fresh directory, with no resume, and all
17,207 of its records carry the same case, R0 value and delta, Tier 1 answer and dividend-scenario references as
the reference file holds now (0 differ; `review-loop/options-adaptive/held-out/S-9-S-10-proof.txt` in the
project files). That is Claude's recorded evidence, not reproduced by Codex, and it does not make attempt 1 the
acceptance: its results are historical and attempt 2 is the evaluation of the final code.

## Review finding S-14 (fixed after attempt 2's run; the recorded run is unaffected)

Codex's final review of attempt 2 (round 11, at `1e20859`) found that the population checks compared case ids,
not case inputs. Ids repeat across seeds (`G1-nodiv/0` exists under every seed), so a reference run of another
seed, handed over with a manifest naming the freeze's seed, passed as the frozen population: Codex built such a
run and the check accepted it. The gap dates from the first bench commit (`b1adadd`) and sits in the runner, the
scorer and calibration, not in the pricing or scoring math.

- **Fix.** Every record's case is compared, in canonical form (`Case.from_json` and back, so a record written
  before the `expect_note` field existed compares equal), with the case regenerated from its run's seed and
  sizes. A reference run holding any other case is incomplete and cannot be the held-out population; a Phase 2
  or calibration resume, and calibration's selection, refuse results for another case under the same id; the
  scorer counts such Tier 2 records and fails the run row on any; a reference shard without its own manifest is
  refused. Four regression tests (the same id from two seeds, an edited input, an orphan reference shard, a
  Phase 2 resume, and a calibration resume and selection) fail on the code before the fix. The held-out test fixtures now use a real seed-7 reference record,
  not seed 20261026's stored record under a seed-7 manifest.
- **Recorded evidence.** Every case in attempt 2's references (17,207 of 17,207) and Tier 2 results (17,207 of
  17,207), and in calibration's development references (12,707 of 12,707, seed 20261026), is exactly the case
  regenerated from its seed and sizes, checked with `ef7d784`'s case generator and again with the fixed checks
  (`review-loop/options-adaptive/s14-proof/` in the project files). Attempt 2's verdict stands. This is Claude's
  recorded evidence, not reproduced by Codex.
- **The freeze.** `phase2.py`, `score2.py` and `calibrate.py` on this branch now differ from the hashes freeze 2
  pins, so the fixed runner (and `routine.py`, whose default is freeze 2) refuses to run under freeze 2. The
  evaluated code is the immutable checkout at `ef7d784`; any further run needs a new freeze.
- **Not changed.** `run.py`, the merged reference runner (unchanged since `bbde165`), still adopts a result file
  without a manifest on resume. With the case check, a wrong-seed file adopted that way can no longer pass as
  the frozen population.

## Amendment A-2: the retained delta and the acceptance prerequisite

- **Retained delta.** Before A-2 a delta accepted at a level whose price estimate was still above target was
  kept when the price was accepted at a finer level, even if that price's continuation sat inside the exercise
  zone (within 5·tol of the exercise value). Now such a delta is re-judged on the accepted price's level: an
  envelope delta must pass that price's zone and decision tests, and a deep-exercise delta of ±1 must still meet
  the deep rule over every level run (a deep-exercise delta sits in the zone by nature, so the zone test is not
  applied to it). One that fails is withdrawn, recorded in the audit as `delta_withdrawn`, counted in the
  scorecard, and the delta is judged afresh at the price's level. Synthetic regressions cover the bypass, the
  kept case, the deep-exercise exception and a deep rule broken at a later level.
- **Acceptance prerequisite.** Only a run started with `--held-out` on the freeze's own population (seed, sizes,
  named cases, every case finished), whose seed is not the development seed, can be a Phase 2 acceptance. Any
  other run's gate rows are kept and labelled "diagnostic only, not a Phase 2 acceptance", and never read "met".

## Test environment notes

The full suite at `ef7d784` (round 9) ran 2,703 tests: 2,622 passed, 80 skipped, 1 failed; at `1e20859` (round 10)
2,621 passed, 80 skipped, 2 failed (the two tests below, both failing in the recorded baseline too). The failures
and the skip count are environmental; no financial tolerance was changed for any of them.

- `tests/test_no_secret_in_logs.py::test_uvicorns_own_formatters_still_work_with_the_filter` fails only after
  `tests/test_chat_sql_guard.py::test_get_secret_falls_back_to_env_file`, and only where Streamlit is installed.
  That test's `st.secrets` access runs Streamlit 1.66's `init_uvicorn_logs()`, which gives `uvicorn.error` its
  own handler and sets `propagate = False`; the later test's `dictConfig` removes the handler but leaves
  `propagate`, so the "Uvicorn running on" line is lost. Streamlit is in `requirements.txt`, not in
  `requirements-api.lock`, so the API image never runs that path; the test passes alone and without Streamlit.
  It is test isolation, not this branch's code, and is left to the owner (backlog B-2).
- `tests/test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently` compares wall time
  with the two calls' measured sum, so it can miss by a few milliseconds on a loaded machine: it passed in round
  9, missed by 31 ms in round 10 and passed three runs of three alone at both this branch and `bbde165` (backlog
  B-3). It is a timing test, not a financial tolerance.
- The skip count is 80, not 83, because `web/node_modules` was installed, so the three
  `test_web_fresh_report` tests ran instead of skipping.

## Limits of these claims

- Each statement is about one frozen attempt, one seed and one group, on the bench's synthetic distribution; it
  is not a claim about real chains, whole requests, or any later attempt.
- The references' uncertainty is a GCI estimate, not a proved bound. The interval check means a usable output
  outside a proved interval fails the gate; it does not mean every value is proved correct.
- Tier 2 is not served. Phase 3 (cross-check, finite differences and Greeks), Phase 4 (materiality and request
  budgets), the worker, the UI and the Phase 7 switch keep their own gates.

## Files

- Scorecards as scored (copies in this repo): attempt 2 `docs/desk/options-adaptive-phase2/held-out-2-scorecard2.md`
  (Tier 2) and `held-out-2-baseline-scorecard.md` (Tier 1, merged scorer); attempt 1 `held-out-scorecard2.md` and
  `held-out-baseline-scorecard.md`.
- Held-out runs (project files, `review-loop/options-adaptive/`): attempt 2 in `held-out-2/` (`refs/`, `p2/`,
  `baseline-score/`, and `RUN-LOG.md`, which records every interruption of the reference run and how it resumed
  from its intact results file); attempt 1 in `held-out/`.
- Calibration: `calibration/cal-4/` (attempt 2) and `calibration/cal-3/` (attempt 1); each candidate file is
  gzipped and its uncompressed SHA-256 matches its freeze's `candidates_sha256`.
- Reference check: `ref-check/` (scripts, outputs and a README). S-14 evidence: `s14-proof/`.
- Loop record: `.loop/` in the build session, with the design, ledger, packets and Codex reviews.
