# Held-out registration: Tier 1 dividend smoothing (design S)

Registered 2026-11-04, before any case of this seed was drawn, priced or scored. Committed to the branch before
the run starts.

## Frozen implementation

- Commit: `44a7f74` (Codex code review round 1 on `38916cb..44a7f74`: no findings, "safe to push").
- Engine and bench files (sha256):
```
47a664fab867d7c6c870327f8f7a762e573311bc85915570a6db2979b23c9349 src/desk/options_math.py
38356ffa2aaba7beb36bc72b3a12ce1d5137035efa4e92443dc8edc80de5aac7 src/desk/options_finder.py
f9db0d169ce1dbf0a94c92f9bf503a71f10a1db4fec3758aa501b447a1930f62 src/desk/options_engine.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 scripts/options_bench/__init__.py
989c026e9285b3983f7d52fa76e88124316e30ac9f806158d98a4531da4fe2f3 scripts/options_bench/adaptive.py
c287965acc3d7a5672e1d457bdf44c972b4b69eb266dfb32d322b08f9eaaf9ac scripts/options_bench/calibrate.py
054625e8da94cc2bb0064766bbec0b975c5de97b585076de2f9d5d6f29c3795f scripts/options_bench/cases.py
8f0c24e98d34c4ce0844adc4bc912a5e9a061783c64d9eaa7ccc2531ee11e2dd scripts/options_bench/crosscheck.py
74d53aa31b973d39b8791a44ad43d2347b5750cbf4ecbe9265c1d7e2d1a77578 scripts/options_bench/engine.py
e25540296a8c5a6c8d4431ee046573fe40f41ba43efb95d682e6d01cdbb83759 scripts/options_bench/fd.py
90badcb0d9dddd5b7cdb3017beb7c6caa8cda39f632983d4ac63a5d341214171 scripts/options_bench/golden.py
d60d93eb1501da0456f81c03825c7d944c5203f33b45b63696ecb5d21a32f94f scripts/options_bench/phase2.py
d3049f6de8783d7f8296ddc3b7eb74ba998b22087c942e739b4bd48888c7b2a6 scripts/options_bench/reference.py
f740aae45cefdb2cac69a202e60d674fed204a161feb017491e926473b52e763 scripts/options_bench/requests.py
261b624c3936440f4467a04f181a9564e42b75b8ea569160653cdc27c69cdd5f scripts/options_bench/routine.py
5657d68c7b085b418a4b106019ab0297c518b33aed7bac4526b7aa2bae1072bd scripts/options_bench/run.py
e88a3b4d00e97c378c545a82b1ae1440beeda653ebcf1ecde4629e54c6de116b scripts/options_bench/score.py
17270c4239abb1bb46ca2479b6c0adbbdf10401e396982959db19494a78f15ee scripts/options_bench/score2.py
```
- The run reads the engine from an immutable detached checkout of that commit. No engine or bench file may
  change between registration and scoring. A change after a failure is a new attempt on a new seed, and this
  attempt stays on record.

## Seed and population

- Seed **20261117**. It has not been used in any bench run: development used 20261026 and 20261029, and Phase 2
  used 20261102.
- Sizes (as the seed 20261029 run): G0-exempt 300; G1-nodiv, G2-dividends, G3-carry-itm, G4-negrate,
  G5-extreme-vol and G6-long 2,500 each; T1-near-boundary 1,500; X1-outside 400; all 23 named regressions.
  17,223 cases in total.
- The bench defaults: lattice check on, QuantLib cross-checks on where conventions match, European control on
  every 10th case, IV round trip on every 5th, dividend scenario (×1.1 and ×0.9) on every 3rd case with
  dividends, business-day convention on every 10th.
- Command: `python -m scripts.options_bench.run --engine-root <frozen checkout> --engine-commit 44a7f74
  --out <run dir> --seed 20261117 --per-group G0-exempt=300,G1-nodiv=2500,G2-dividends=2500,G3-carry-itm=2500,G4-negrate=2500,G5-extreme-vol=2500,G6-long=2500,T1-near-boundary=1500,X1-outside=400
  --workers 4`

## Acceptance rule (fixed now)

1. `scripts/options_bench/score.py` at `44a7f74` scores the run on its seven components: price, displayed delta,
   bound, dividend scenario, controls, named regressions and run integrity. All seven must be met. The scorer's
   targets and tolerances are those already on main; nothing is relaxed.
2. Request matrix (`scripts/options_bench/requests.py`, 24 whole Finder requests): no request newly over the
   300 M work cap compared with main `38916cb`.
3. Finder time within 10% of main on the same matrix, run back to back on the same idle machine.
4. Dashboard latency during a Finder request, measured against main and reported. It is not gated, because the
   existing stall is pre-existing and a separate follow-up.

Refusals, unresolved references, withheld deltas and coverage are reported against the full population. Any
failure is reported to Max before any change is proposed. The figures are empirical results from this run,
not proved bounds.
