# Options engine, adaptive Phase 2: the Tier 2 convergence controller

Status: built and scored, **unserved**. Nothing under `api/` or `web/` imports the new modules; the Finder keeps
serving the baseline (Tier 1). The engine switch is Phase 7 and needs the owner's explicit approval. Tier 2
values are "estimated, cross-check pending" until the Phase 3 cross-check exists.

- Plan: "Options engine Phase 2 plan: convergence controller", revision 2, approved 2026-10-29 05:39 UTC, with
  amendment A-1 (2026-10-29 18:11 UTC: interval refusals and the analytic-route estimate).
- Design: design P2-2 (project files, `review-loop/options-adaptive/designs/`), approved by Codex on its fourth
  design pass. Addendum A (A1–A3) was written during the build, after that pass, and reviewed in code-review
  rounds 1–4, not as a design pass. A1 and A3 are amendment A-1. A2 is a deviation from design 9.3: calibration
  aims its tightened reference at 0.1 of the finest straddling candidate's estimate, not at the floor, and reads
  its reliability against each candidate's own 0.1·E_s; in the held-out run the target is exactly 0.1·E_s, as the
  design says.
- Attempt: **attempt 1**, the only one. Calibration seed 20261026; held-out seed 20261029. No failed attempt
  precedes it; the exploratory and provisional calibrations listed below are not attempts and are kept on record.
- Provenance: every run here is **Claude's recorded run**, not reproduced by Codex. Codex reviewed the code, the
  freeze and the selection report (rounds 1–5); it did not rerun calibration or the held-out evaluation.

## What was built

| File | What |
|---|---|
| `src/desk/options_engine.py` | Engine interface and statuses; the baseline adapter over `options_finder.Pricer`, called unchanged |
| `src/desk/options_adaptive.py` | Tier 2: routes, the analytic interval, the refinement walk, both estimators, three schedules, the delta gate |
| `tests/fixtures/options_baseline_golden.json` | Tier 1's served outputs on the named cases, R-1 and a 300-case stratified subset |
| `scripts/options_bench/{adaptive,phase2,calibrate,score2,routine}.py` | Adapter and verdict protocol, frozen runner, calibration, Phase 2 scorer, routine subset |
| `scripts/options_bench/calibration/` | The freeze (`phase2-freeze.json`) and the selection report it was chosen from |

Tier 2 routes, in order: input failure; intrinsic at expiry; outside the domain; exempt (European, by theorem);
the analytic interval; the lattice. (The module docstring lists exempt before the domain test; the code tests the domain
first. The docstring is left as frozen so that the engine file keeps the freeze's hash.) The proved interval is [L, U] with L = max(European, intrinsic) and
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

## Calibration and freeze

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

## Held-out result (attempt 1, seed 20261029, 17,207 cases)

**Gate verdict: met.** Every row passes.

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

## What the baseline shows on the held-out seed (Tier 1, unchanged by this branch)

The merged scorer, run on the same held-out reference run, scores today's served baseline:

- Prices: 15,081 scored in the in-domain groups (G0–G6 and T1), 0 failures, 0 indeterminate; deltas 0 failures.
- **Dividend scenario: 1 failure and 1 indeterminate.** G2-dividends/1239 (21-day call, a 2.04 dividend on day
  4, volatility 0.50): the baseline's price change between the ±10% dividend states differs from the reference's
  by 1.13 tol. G2-dividends/1725 straddles the threshold. Tier 2 refuses a scenario price on both cases.
- One lattice dispute to investigate (T1-near-boundary/1351, a dividend on day 0).
- G0-exempt has 300 scored prices, below the merged gate's 1,000, because the freeze sizes G0 at 300.

These are facts about Tier 1 on a new seed. This branch does not change Tier 1 and does not fix them; they are
listed for the owner's decision.

## Open review findings (the owner's decision)

Codex's final whole-branch review (round 6, at `30ffef1`) found two gaps in the held-out runner, both from the
first bench commit and neither in the pricing or scoring math:

- **S-9.** `phase2.py` resumes a run without fingerprinting the reference records, so a reference file changed
  between sessions could keep earlier verdicts. Calibration already guards this.
- **S-10.** `phase2.py` adopts results that have no manifest and stamps them with the current freeze.
  Calibration already refuses these.

The recorded attempt did not meet either case. It ran in one session in a fresh directory, with no resume. All
17,207 records carry the same case, R0 value and delta, Tier 1 answer and dividend-scenario references as the
reference file holds now (0 differ). Evidence: `review-loop/options-adaptive/held-out/S-9-S-10-proof.txt` in the
project files. Codex has not reproduced it.

Both files are frozen, so fixing them on this branch after the held-out run would break the freeze's hash match
at HEAD. Whether to fix them here or in a follow-up is the owner's decision.

## Limits of these claims

- Each statement is about one frozen attempt, one seed and one group, on the bench's synthetic distribution; it
  is not a claim about real chains, whole requests, or any later attempt.
- The references' uncertainty is a GCI estimate, not a proved bound. The interval check means a usable output
  outside a proved interval fails the gate; it does not mean every value is proved correct.
- Tier 2 is not served. Phase 3 (cross-check, finite differences and Greeks), Phase 4 (materiality and request
  budgets), the worker, the UI and the Phase 7 switch keep their own gates.

## Files

- Scorecards as scored (copies in this repo): `docs/desk/options-adaptive-phase2/held-out-scorecard2.md` (Tier 2)
  and `held-out-baseline-scorecard.md` (Tier 1, merged scorer).
- Held-out runs: project files `review-loop/options-adaptive/held-out/` (`refs/` the reference run, `p2/` Tier 2
  with `scorecard2.md` and `scorecard2.json`, `baseline-score/` the merged scorer on Tier 1).
- Calibration: `review-loop/options-adaptive/calibration/cal-3/` (candidate file gzipped; its uncompressed SHA-256
  matches the freeze's `candidates_sha256`).
- Loop record: `.loop/` in the build session, with the design, ledger, packets and Codex reviews.
