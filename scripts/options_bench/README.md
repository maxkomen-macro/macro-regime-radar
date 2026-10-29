# Options bench

Nonproduction validation tooling for the Options Finder's pricing engine. Nothing here is imported by the
API or the web app, and nothing here is served. It scores an engine revision against independently refined
references on synthetic contexts and writes a reproducible scorecard.

## What it measures

- **Price and delta** of every case through the Finder's own route (`options_finder.Pricer`): intrinsic,
  the European value where a theorem or the early-exercise bound allows it, the lattice otherwise, or a
  refusal. Each outcome is one of refused, unscored (reference unresolved), pass, fail or indeterminate.
- **References** (`reference.py`): the bench's Crank-Nicolson solver (`fd.py`, no code shared with the
  lattice), refined in time, space, boundary width and penalty weight, with an uncertainty from the observed
  convergence (grid-convergence index). A reference is used only when its uncertainty is at most a tenth of
  the tolerance it judges; the rest stay visible as unresolved. The uncertainty is an estimate, not a bound.
- **Controls**: the same solver with exercise off against Black-76, and exempt contracts against Black-76.
- **Cross-checks** (diagnostics, never references): a fine plain lattice (same code family as the engine)
  and QuantLib where its conventions match (no dividends, or q = 0 with escrowed dividends).
- **Implied volatility round trip** with the Finder's solver, split by whether the price identifies sigma.
- **Dividend scenario**: owed dividends ×1.1 and ×0.9; the engine's price change against the reference's.
- **Exercise convention**: continuous exercise against exercise only at NYSE closes (a Bermudan
  approximation), same inputs, reported apart from numerical error.
- **Named regressions** DR-47, DR-48, DR-49, DR-50, B8, B9a and B9b, rerun on every engine revision.

## Acceptance

`score.py` gives one verdict per criterion that binds now: price accuracy (decision 10's sample targets),
displayed delta (at least 300 scored per in-domain group), the early-exercise bound on the bound-European
route, the dividend scenario, the reference controls, the named regressions and run integrity. Each is pass,
fail, unresolved (an indeterminate outcome, or a lattice dispute to investigate) or insufficient (too few
scored cases, or an incomplete run). The overall verdict is met only when every component passes. A failure
or an indeterminate outcome counts in any group; the sample targets count the in-domain groups. A withheld
delta is reported as availability, not as an accuracy failure. A bound is judged against a resolved
reference: an interval wholly above it is a violation and wholly inside it is covered; an interval across it
is indeterminate only when the reference is at least ten times finer than the bound (as a price is judged
against its tolerance), else unscored. Named regressions are judged against the current documented route,
also when an older run is re-scored.

## Groups

`cases.py` draws each case from `default_rng([seed, group, index])`, so a case is the same in any shard.
Random in-domain groups G0 to G6, the targeted group T1 (near the exercise boundary), and the stress group X1
(each case breaks one domain rule; the engine should refuse it). The domain contract is the bench's copy of
the baseline's, so a refusal inside it counts against coverage.

## Running

```
pip install -r scripts/options_bench/requirements.txt
python -m scripts.options_bench.run --engine-root ENGINE_ROOT --out RUN_DIR --per-group 1500 --seed 20261026
python -m scripts.options_bench.run ... --shard 1/4     # one of four machines
python -m scripts.options_bench.score RUN_DIR [RUN_DIR ...]
```

`ENGINE_ROOT` holds `src/desk/options_math.py` and `src/desk/options_finder.py` (this checkout once the
baseline is merged, or an extracted copy of another branch; pass `--engine-commit` for a copy). Results are
appended per case, so rerunning the same command resumes; a run directory refuses to resume with other code
or inputs. Each shard writes a manifest (command, seed, sizes, versions, platform, engine and bench hashes).

Tests: `python -m pytest tests/test_options_bench.py` (the engine tests skip unless the engine is in this
checkout or `OPTIONS_BENCH_ENGINE_ROOT` points at one; the QuantLib test skips without QuantLib).

## Phase 2: the Tier 2 controller (adaptive Phase 2, unserved)

The Tier 2 convergence controller (`src/desk/options_adaptive.py`) is scored on top of a finished run of
`run.py`, whose references R0 and baseline answers it reuses (they do not depend on Tier 2):

```
python -m scripts.options_bench.calibrate --refs RUN_DIR --out CAL_DIR            # every candidate, development seed
python -m scripts.options_bench.calibrate --refs RUN_DIR --out CAL_DIR --select   # choose, size, write the freeze
python -m scripts.options_bench.run --engine-root . --out HELD_OUT --seed SEED --per-group <the freeze's sizes>
python -m scripts.options_bench.phase2 --refs HELD_OUT --freeze scripts/options_bench/calibration/phase2-freeze.json \
    --out P2_DIR --held-out
python -m scripts.options_bench.score2 P2_DIR
python -m scripts.options_bench.routine --out DIR                                 # ~300 development cases, every push
```

- `adaptive.py`: the adapter, and the verdict protocol (covered, confirmed, straddle; one tightened reference R1
  per straddling case, judged inconsistent, unreliable, covered or confirmed, precise straddle, coarse straddle
  in that order).
- `phase2.py`: Tier 2 under the frozen configuration, the Tier 1 identity check, R1, the dividend scenario, the
  report-only targets 0.5, 0.25 and 0.1 tol, and repeated cases for determinism. It refuses to run when any
  engine or bench file differs from the freeze, and with `--held-out` a reference run that is not the freeze's
  seed and sizes.
- `score2.py`: every exit-gate row, with five populations per group and maturity band, and the conditional,
  resolved-all and all-accepted limits (only the conditional one binds).
- The design and its statistics: design P2-2 (review-loop/options-adaptive/designs/ in the project files) and
  docs/desk/OPTIONS_ADAPTIVE_PHASE2.md.

Tests: `python -m pytest tests/test_options_engine.py tests/test_options_adaptive.py tests/test_options_bench_phase2.py`.
