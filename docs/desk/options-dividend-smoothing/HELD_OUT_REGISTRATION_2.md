# Held-out registration 2: Tier 1 dividend smoothing (design S) on the repaired bench (design B)

Registered 2026-11-06, before any case of this seed was drawn, priced or scored. It is committed to the branch
before the run starts.

The first registered held-out (seed 20261117, frozen `44a7f74`, [HELD_OUT_REGISTRATION.md](HELD_OUT_REGISTRATION.md))
stays on record unchanged. It was not met, and Max did not accept it (2026-11-05 19:14 UTC). Its cases are now
exposed and are not reused. That run's open components were benchmark limitations: the G0-exempt group was sized
below the scorer's target, one European control failed because of a low-order Richardson correction, and the IV
diagnostic crashed at the work cap. None of them came from the engine. Max approved repairing the benchmark and
running a fresh held-out (amendment 6, 2026-11-05 19:14 UTC; amendment 7, 22:37 UTC).

## Frozen implementation

- **Commit:** `1a4bad4`. It is design S's engine (unchanged since `44a7f74`) plus the design-B bench repair
  (`7d4f6d8`) and Codex S-02 (`1a4bad4`). Reviews:
  - Codex design review of design B: pass 4 approved.
  - Codex code review round 2 on `7d4f6d8`: one finding, S-02, fixed.
  - Codex code review round 3 on `1a4bad4`: no findings, "safe to push".
- **Full suite at `1a4bad4`:** 3,165 passed, 80 skipped, 0 failed.
- **Engine and bench files (sha256).** The three engine files are identical to `44a7f74`'s.
```
47a664fab867d7c6c870327f8f7a762e573311bc85915570a6db2979b23c9349 src/desk/options_math.py
38356ffa2aaba7beb36bc72b3a12ce1d5137035efa4e92443dc8edc80de5aac7 src/desk/options_finder.py
f9db0d169ce1dbf0a94c92f9bf503a71f10a1db4fec3758aa501b447a1930f62 src/desk/options_engine.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 scripts/options_bench/__init__.py
989c026e9285b3983f7d52fa76e88124316e30ac9f806158d98a4531da4fe2f3 scripts/options_bench/adaptive.py
c287965acc3d7a5672e1d457bdf44c972b4b69eb266dfb32d322b08f9eaaf9ac scripts/options_bench/calibrate.py
054625e8da94cc2bb0064766bbec0b975c5de97b585076de2f9d5d6f29c3795f scripts/options_bench/cases.py
a6fe56e5cca3a5ddd36d6d1f663d4cc3937a526081e7584acc8ad40c9a2c6405 scripts/options_bench/crosscheck.py
5b1afb1d529bffdaa34cfeba0d57b8d0fe5407a3e44840e05fd747c4fe4d65b9 scripts/options_bench/engine.py
e25540296a8c5a6c8d4431ee046573fe40f41ba43efb95d682e6d01cdbb83759 scripts/options_bench/fd.py
90badcb0d9dddd5b7cdb3017beb7c6caa8cda39f632983d4ac63a5d341214171 scripts/options_bench/golden.py
d60d93eb1501da0456f81c03825c7d944c5203f33b45b63696ecb5d21a32f94f scripts/options_bench/phase2.py
3a5fd7fd490c27949a8c108af091c7e1782fd6e970564ae443620bc9a129c305 scripts/options_bench/reference.py
f740aae45cefdb2cac69a202e60d674fed204a161feb017491e926473b52e763 scripts/options_bench/requests.py
261b624c3936440f4467a04f181a9564e42b75b8ea569160653cdc27c69cdd5f scripts/options_bench/routine.py
9d034fa5210e87f82df6a763268839ba97405aa8ba85719b448fd0ee87396c75 scripts/options_bench/run.py
37a69b90160e902bc3537d41dabbc145b0a33e2dced8ed626f0b18ac8803dfdf scripts/options_bench/score.py
17270c4239abb1bb46ca2479b6c0adbbdf10401e396982959db19494a78f15ee scripts/options_bench/score2.py
```
- **Frozen checkout.** The run reads the engine and the bench from an immutable detached checkout of `1a4bad4`.
  No engine or bench file may change between registration and scoring. A change after a failure would be a new
  attempt on a new seed, and this attempt would stay on record.
- **No engine retuning.** Nothing under `src/` changed after the exposed run.

## Seed and population

- **Seed 20261111.** No bench run has used it. Earlier runs used:
  - 20261026 and 20261029: development
  - 20261102: Phase 2
  - 20261117: the first dividend held-out, now exposed
- **Sizes:** the same as registration 1, except G0-exempt, which is now 1,500 (as in the seed 20261026 run).
  The scorer's target is 1,000 scored prices per in-domain group, and 300 could only read "insufficient".
  - G0-exempt: 1,500
  - G1-nodiv, G2-dividends, G3-carry-itm, G4-negrate, G5-extreme-vol and G6-long: 2,500 each
  - T1-near-boundary: 1,500
  - X1-outside: 400
  - All 23 named regressions
  - **18,423 cases in total.**
- **Bench defaults, unchanged:**
  - lattice check on
  - QuantLib cross-checks on where conventions match
  - the QuantLib FD arbiter, only for QdFp comparisons outside the reference's stated uncertainty
  - European control on every 10th case
  - IV round trip on every 5th case
  - dividend scenario (×1.1 and ×0.9) on every 3rd case with dividends
  - business-day convention on every 10th case
- **Command:** `python -m scripts.options_bench.run --engine-root <frozen checkout> --engine-commit 1a4bad4
  --out <run dir> --seed 20261111 --per-group G0-exempt=1500,G1-nodiv=2500,G2-dividends=2500,G3-carry-itm=2500,G4-negrate=2500,G5-extreme-vol=2500,G6-long=2500,T1-near-boundary=1500,X1-outside=400
  --workers 4`

## Acceptance rule (fixed now; unchanged from registration 1)

1. **Seven scored components.** `scripts/options_bench/score.py` at `1a4bad4` scores the run on price, displayed
   delta, bound, dividend scenario, controls, named regressions and run integrity. All seven must be met.
   - The targets and tolerances are those of registration 1. The repair changed none of these:
     DELTA_TOL, REF_FRACTION, NEGLIGIBLE, the floors, PER_GROUP_TARGET, WORK_LIMIT, REFINE_UNITS_MAX, and the
     components and their gates.
   - The QuantLib arbiter categories and the unresolved-reference reasons are reported diagnostics. They are not
     gates.
   - An IV round trip that the work cap refuses is reported as a refusal and listed. Any crash still fails run
     integrity.
2. **Request matrix:** no request newly over the 300 M work cap compared with main `38916cb` (24 whole Finder
   requests).
3. **Finder time:** within 10% of main on the same matrix.
4. **Dashboard latency:** measured during a Finder request against main and reported, not gated.

Items 2 to 4 measure the engine, and the engine files are identical to `44a7f74`'s. So the comparisons already
made with `44a7f74` apply unchanged (review-loop/dividend-fix/final-requests/ and final-latency/):
- no request newly over the cap, 5 of 24 over in both
- time +3.1% pooled
- dashboard latency the same as main

They are rerun only if an engine file changes, which this registration forbids.

Refusals, unresolved references, withheld deltas and coverage are reported against the full population. Any
failure is reported to Max before any change is proposed. The figures are empirical results from this run, not
proved bounds. Numerical acceptance and the PR merge are Max's separate decisions.
