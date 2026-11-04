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

## Evidence still to come

- The fresh held-out bench run on a seed registered before the run, scored on its seven components.
- The request matrix and the dashboard latency check, both against main.

Both are reported here when they are done. Until then, every figure above is development evidence.
