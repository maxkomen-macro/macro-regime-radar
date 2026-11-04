# Phase 2 scorecard (Tier 2 convergence controller)

- Attempt: options adaptive Phase 2, attempt 1; seed [20261029]; held-out
- Configuration: {"estimator": "envelope", "schedule": "multiples", "F": 3.0, "F_d": 2.0, "tau": 1.0, "force_lattice": false}; engine adaptive-p2.0
- Freeze: `scripts/options_bench/calibration/phase2-freeze.json` (sha256 40a65e6d37d7…)
- Provenance: Claude's recorded run unless Codex reproduces it.
- **Gate verdict: met**

Every limit is a one-sided 95% Clopper–Pearson upper limit for that group alone, under this frozen attempt and seed; six limits are not a joint statement. The estimator-coverage limit is conditional on Tier 2 acceptance and reference resolution (covered, confirmed and unresolved cases); the resolved-all and all-accepted limits are reported beside it and not gated. An unresolved reference is insufficient evidence, not proof that the engine is wrong or right.

| Row | Verdict |
|---|---|
| Tier 1 unchanged | pass |
| Sample counts | pass |
| Tier 2 price accuracy | pass |
| Estimator coverage, price (area 6) | pass |
| Estimator coverage, delta (area 6) | pass |
| Analytic route | pass |
| Proved interval (every Tier 2 output) | pass |
| Displayed delta (area 4) | pass |
| Dividend scenario (area 5) | pass |
| Reference reliability (area 1) | pass |
| Named regressions | pass |
| Determinism and run integrity | pass |
| Work, per context | pass |

## Estimator coverage by group

| Group | Lattice accepted | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional limit | Resolved-all | All-accepted |
|---|---|---|---|---|---|---|---|---|---|
| G0-exempt | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G1-nodiv | 1357 | 1356 | 1 | 0 | 0 | 0 | 0.00349 | 0.00349 | 0.00349 |
| G2-dividends | 1815 | 1808 | 0 | 0 | 0 | 7 | 0.00166 | 0.00166 | 0.00723 |
| G3-carry-itm | 2017 | 2000 | 0 | 0 | 0 | 17 | 0.0015 | 0.0015 | 0.0126 |
| G4-negrate | 1591 | 1590 | 0 | 0 | 0 | 1 | 0.00188 | 0.00188 | 0.00298 |
| G5-extreme-vol | 1515 | 1509 | 0 | 0 | 0 | 6 | 0.00198 | 0.00198 | 0.0078 |
| G6-long | 2323 | 2300 | 0 | 0 | 0 | 23 | 0.0013 | 0.0013 | 0.014 |
| T1-near-boundary | 1209 | 1205 | 0 | 0 | 0 | 4 | 0.00248 | 0.00248 | 0.00756 |
| X1-outside | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| named | 2 | 2 | 0 | 0 | 0 | 0 | 0.776 | 0.776 | 0.776 |

## Delta estimator coverage by group

| Group | Deltas with an estimate | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional limit | Withheld (top reasons) |
|---|---|---|---|---|---|---|---|---|
| G0-exempt | 0 | 0 | 0 | 0 | 0 | 0 | — |  |
| G1-nodiv | 2210 | 2210 | 0 | 0 | 0 | 0 | 0.00135 | within 5 tolerances of the exercise value: 264, delta estimate above 2.5e-3: 2 |
| G2-dividends | 1770 | 1769 | 1 | 0 | 0 | 0 | 0.00268 | a dividend falls within 5 days, where the lattice delta is not validated: 492, within 5 tolerances of the exercise value: 56, delta estimate above 2.5e-3: 3 |
| G3-carry-itm | 1513 | 1513 | 0 | 0 | 0 | 0 | 0.00198 | a dividend falls within 5 days, where the lattice delta is not validated: 754, within 5 tolerances of the exercise value: 205, delta estimate above 2.5e-3: 1 |
| G4-negrate | 1925 | 1925 | 0 | 0 | 0 | 0 | 0.00156 | within 5 tolerances of the exercise value: 283, a dividend falls within 5 days, where the lattice delta is not validated: 217, delta estimate above 2.5e-3: 1 |
| G5-extreme-vol | 1800 | 1792 | 0 | 0 | 0 | 8 | 0.00167 | a dividend falls within 5 days, where the lattice delta is not validated: 515, within 5 tolerances of the exercise value: 62 |
| G6-long | 2210 | 2208 | 0 | 0 | 0 | 2 | 0.00136 | a dividend falls within 5 days, where the lattice delta is not validated: 111, within 5 tolerances of the exercise value: 58 |
| T1-near-boundary | 983 | 983 | 0 | 0 | 0 | 0 | 0.00304 | a dividend falls within 5 days, where the lattice delta is not validated: 374, within 5 tolerances of the exercise value: 125, delta estimate above 2.5e-3: 3 |
| X1-outside | 0 | 0 | 0 | 0 | 0 | 0 | — |  |
| named | 0 | 0 | 0 | 0 | 0 | 0 | — | within 5 tolerances of the exercise value: 1, a dividend falls within 5 days, where the lattice delta is not validated: 1 |

## Coverage and work by group and maturity band (report only)

| Group, band | Cases | Tier 2 priced | Label | Work p50 | p95 | max | Refusals |
|---|---|---|---|---|---|---|---|
| G0-exempt 1-180 | 215 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 181-730 | 52 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 731-1118 | 22 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 1119-1464 | 11 | 1 | partial | 150 | 150 | 150 |  |
| G1-nodiv 1-180 | 1788 | 0.989 | covered | 3.61e+05 | 9.14e+05 | 3521200 | outside the proved interval: 19 |
| G1-nodiv 181-730 | 477 | 0.992 | covered | 2.14e+06 | 7.43e+06 | 23135566 | outside the proved interval: 3, estimate above target: 1 |
| G1-nodiv 731-1118 | 146 | 1 | partial | 1.31e+07 | 2.76e+07 | 39696976 |  |
| G1-nodiv 1119-1464 | 89 | 0.989 | partial | 2.55e+07 | 3.49e+07 | 66071914 | outside the proved interval: 1 |
| G2-dividends 1-180 | 1551 | 0.971 | covered | 3.85e+05 | 1e+06 | 2848806 | estimate above target: 34, outside the proved interval: 11 |
| G2-dividends 181-730 | 645 | 0.969 | covered | 1.98e+06 | 6.74e+06 | 16443870 | estimate above target: 20 |
| G2-dividends 731-1118 | 185 | 0.995 | partial | 1.12e+07 | 1.77e+07 | 38102962 | estimate above target: 1 |
| G2-dividends 1119-1464 | 119 | 0.992 | partial | 2.36e+07 | 3.35e+07 | 58869372 | estimate above target: 1 |
| G3-carry-itm 1-180 | 1911 | 0.99 | covered | 3.61e+05 | 8.98e+05 | 3726774 | outside the proved interval: 10, estimate above target: 9 |
| G3-carry-itm 181-730 | 589 | 0.986 | covered | 1.92e+06 | 7e+06 | 10973962 | estimate above target: 6, outside the proved interval: 2 |
| G4-negrate 1-180 | 1718 | 0.967 | covered | 3.89e+05 | 1.08e+06 | 4045360 | outside the proved interval: 47, estimate above target: 9 |
| G4-negrate 181-730 | 644 | 0.974 | covered | 2.27e+06 | 9.18e+06 | 23920992 | outside the proved interval: 14, estimate above target: 3 |
| G4-negrate 731-1118 | 138 | 0.993 | partial | 1.21e+07 | 2.83e+07 | 38181826 | outside the proved interval: 1 |
| G5-extreme-vol 1-180 | 2116 | 0.988 | covered | 3.61e+05 | 1.02e+06 | 3884290 | outside the proved interval: 17, estimate above target: 9 |
| G5-extreme-vol 181-730 | 384 | 0.99 | partial | 9.66e+05 | 2.22e+06 | 6437386 | outside the proved interval: 4 |
| G6-long 731-1118 | 1331 | 0.99 | covered | 1.28e+07 | 1.85e+07 | 55766042 | outside the proved interval: 7, estimate above target: 6 |
| G6-long 1119-1464 | 1169 | 0.994 | covered | 2.5e+07 | 3.69e+07 | 94224806 | outside the proved interval: 6, estimate above target: 1 |
| T1-near-boundary 1-180 | 1500 | 0.99 | covered | 3.89e+05 | 9.88e+05 | 2011328 | estimate above target: 15 |

## Interval refusals by group and maturity band (report only; refusals are not passes)

Candidates outside the proved interval are refused, never served or clipped. Below L they are numerical undershoots; their cause has not been established as roundoff.

Each output is counted over the cases that have it: the main answer, each sweep target, each dividend scenario.

| Group, band | Output | Cases | With a refusal | Share | Refusals | Below L | Above U | Finally refused | Distance p50 (tol) | max (tol) |
|---|---|---|---|---|---|---|---|---|---|---|
| G0-exempt 1-180 | main answer | 215 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 1-180 | sweep 0.1 | 215 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1-180 | sweep 0.25 | 215 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1-180 | sweep 0.5 | 215 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | main answer | 52 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 181-730 | sweep 0.1 | 52 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | sweep 0.25 | 52 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | sweep 0.5 | 52 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | main answer | 22 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 731-1118 | sweep 0.1 | 22 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | sweep 0.25 | 22 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | sweep 0.5 | 22 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | main answer | 11 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 1119-1464 | sweep 0.1 | 11 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | sweep 0.25 | 11 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | sweep 0.5 | 11 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G1-nodiv 1-180 | main answer | 1788 | 80 | 0.0447 | 140 | 140 | 0 | 19 | 1.64e-05 | 0.0178 |
| G1-nodiv 1-180 | sweep 0.1 | 1788 | 531 | 0.297 | 1345 | 1288 | 57 | — | 3.07e-15 | 0.0178 |
| G1-nodiv 1-180 | sweep 0.25 | 1788 | 115 | 0.0643 | 203 | 203 | 0 | — | 1.6e-05 | 0.0178 |
| G1-nodiv 1-180 | sweep 0.5 | 1788 | 91 | 0.0509 | 160 | 160 | 0 | — | 2.26e-05 | 0.0178 |
| G1-nodiv 181-730 | main answer | 477 | 31 | 0.065 | 42 | 42 | 0 | 3 | 0.000496 | 0.0169 |
| G1-nodiv 181-730 | sweep 0.1 | 477 | 50 | 0.105 | 86 | 86 | 0 | — | 2.7e-08 | 0.0169 |
| G1-nodiv 181-730 | sweep 0.25 | 477 | 35 | 0.0734 | 46 | 46 | 0 | — | 0.000478 | 0.0169 |
| G1-nodiv 181-730 | sweep 0.5 | 477 | 32 | 0.0671 | 43 | 43 | 0 | — | 0.00051 | 0.0169 |
| G1-nodiv 731-1118 | main answer | 146 | 11 | 0.0753 | 17 | 17 | 0 | 0 | 0.000328 | 0.0058 |
| G1-nodiv 731-1118 | sweep 0.1 | 146 | 12 | 0.0822 | 18 | 18 | 0 | — | 0.000285 | 0.0058 |
| G1-nodiv 731-1118 | sweep 0.25 | 146 | 12 | 0.0822 | 18 | 18 | 0 | — | 0.000285 | 0.0058 |
| G1-nodiv 731-1118 | sweep 0.5 | 146 | 11 | 0.0753 | 17 | 17 | 0 | — | 0.000328 | 0.0058 |
| G1-nodiv 1119-1464 | main answer | 89 | 6 | 0.0674 | 9 | 9 | 0 | 1 | 0.000153 | 0.00238 |
| G1-nodiv 1119-1464 | sweep 0.1 | 89 | 7 | 0.0787 | 11 | 11 | 0 | — | 0.000124 | 0.00238 |
| G1-nodiv 1119-1464 | sweep 0.25 | 89 | 6 | 0.0674 | 9 | 9 | 0 | — | 0.000153 | 0.00238 |
| G1-nodiv 1119-1464 | sweep 0.5 | 89 | 6 | 0.0674 | 9 | 9 | 0 | — | 0.000153 | 0.00238 |
| G2-dividends 1-180 | main answer | 1551 | 26 | 0.0168 | 55 | 55 | 0 | 11 | 6.77e-06 | 0.0135 |
| G2-dividends 1-180 | divsens down | 523 | 9 | 0.0172 | 20 | 20 | 0 | — | 0.000672 | 0.0083 |
| G2-dividends 1-180 | divsens up | 523 | 9 | 0.0172 | 17 | 17 | 0 | — | 0.000534 | 0.00735 |
| G2-dividends 1-180 | sweep 0.1 | 1551 | 219 | 0.141 | 579 | 575 | 4 | — | 3.35e-14 | 0.0135 |
| G2-dividends 1-180 | sweep 0.25 | 1551 | 32 | 0.0206 | 66 | 66 | 0 | — | 0.000182 | 0.0135 |
| G2-dividends 1-180 | sweep 0.5 | 1551 | 27 | 0.0174 | 57 | 57 | 0 | — | 2.61e-05 | 0.0135 |
| G2-dividends 181-730 | main answer | 645 | 6 | 0.0093 | 9 | 9 | 0 | 0 | 0.00187 | 0.018 |
| G2-dividends 181-730 | divsens down | 217 | 2 | 0.00922 | 2 | 2 | 0 | — | 0.00267 | 0.00505 |
| G2-dividends 181-730 | divsens up | 217 | 1 | 0.00461 | 2 | 2 | 0 | — | 9.66e-05 | 0.000185 |
| G2-dividends 181-730 | sweep 0.1 | 645 | 7 | 0.0109 | 11 | 11 | 0 | — | 0.000747 | 0.018 |
| G2-dividends 181-730 | sweep 0.25 | 645 | 6 | 0.0093 | 9 | 9 | 0 | — | 0.00187 | 0.018 |
| G2-dividends 181-730 | sweep 0.5 | 645 | 6 | 0.0093 | 9 | 9 | 0 | — | 0.00187 | 0.018 |
| G2-dividends 731-1118 | main answer | 185 | 4 | 0.0216 | 5 | 5 | 0 | 0 | 0.000658 | 0.00223 |
| G2-dividends 731-1118 | divsens down | 60 | 2 | 0.0333 | 3 | 3 | 0 | — | 0.00261 | 0.00299 |
| G2-dividends 731-1118 | divsens up | 60 | 4 | 0.0667 | 4 | 4 | 0 | — | 0.000653 | 0.00314 |
| G2-dividends 731-1118 | sweep 0.1 | 185 | 4 | 0.0216 | 5 | 5 | 0 | — | 0.000658 | 0.00223 |
| G2-dividends 731-1118 | sweep 0.25 | 185 | 4 | 0.0216 | 5 | 5 | 0 | — | 0.000658 | 0.00223 |
| G2-dividends 731-1118 | sweep 0.5 | 185 | 4 | 0.0216 | 5 | 5 | 0 | — | 0.000658 | 0.00223 |
| G2-dividends 1119-1464 | main answer | 119 | 5 | 0.042 | 5 | 5 | 0 | 0 | 0.000496 | 0.00533 |
| G2-dividends 1119-1464 | divsens down | 34 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 1119-1464 | divsens up | 34 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 1119-1464 | sweep 0.1 | 119 | 5 | 0.042 | 5 | 5 | 0 | — | 0.000496 | 0.00533 |
| G2-dividends 1119-1464 | sweep 0.25 | 119 | 5 | 0.042 | 5 | 5 | 0 | — | 0.000496 | 0.00533 |
| G2-dividends 1119-1464 | sweep 0.5 | 119 | 5 | 0.042 | 5 | 5 | 0 | — | 0.000496 | 0.00533 |
| G3-carry-itm 1-180 | main answer | 1911 | 41 | 0.0215 | 72 | 64 | 8 | 10 | 5.07e-07 | 0.0146 |
| G3-carry-itm 1-180 | divsens down | 311 | 3 | 0.00965 | 7 | 4 | 3 | — | 1.07e-05 | 0.00304 |
| G3-carry-itm 1-180 | divsens up | 311 | 2 | 0.00643 | 5 | 2 | 3 | — | 1.65e-08 | 0.00192 |
| G3-carry-itm 1-180 | sweep 0.1 | 1911 | 60 | 0.0314 | 121 | 67 | 54 | — | 1e-07 | 0.0146 |
| G3-carry-itm 1-180 | sweep 0.25 | 1911 | 42 | 0.022 | 75 | 67 | 8 | — | 5.68e-07 | 0.0146 |
| G3-carry-itm 1-180 | sweep 0.5 | 1911 | 42 | 0.022 | 75 | 67 | 8 | — | 5.68e-07 | 0.0146 |
| G3-carry-itm 181-730 | main answer | 589 | 8 | 0.0136 | 13 | 10 | 3 | 2 | 1.89e-06 | 0.00277 |
| G3-carry-itm 181-730 | divsens down | 104 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 181-730 | divsens up | 104 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 181-730 | sweep 0.1 | 589 | 9 | 0.0153 | 16 | 10 | 6 | — | 1.14e-06 | 0.00277 |
| G3-carry-itm 181-730 | sweep 0.25 | 589 | 8 | 0.0136 | 13 | 10 | 3 | — | 1.89e-06 | 0.00277 |
| G3-carry-itm 181-730 | sweep 0.5 | 589 | 8 | 0.0136 | 13 | 10 | 3 | — | 1.89e-06 | 0.00277 |
| G4-negrate 1-180 | main answer | 1718 | 192 | 0.112 | 328 | 328 | 0 | 47 | 2.53e-06 | 0.0194 |
| G4-negrate 1-180 | divsens down | 217 | 11 | 0.0507 | 16 | 16 | 0 | — | 3.64e-08 | 0.00444 |
| G4-negrate 1-180 | divsens up | 217 | 9 | 0.0415 | 16 | 16 | 0 | — | 3.51e-08 | 0.00227 |
| G4-negrate 1-180 | sweep 0.1 | 1718 | 616 | 0.359 | 1413 | 1378 | 35 | — | 3.39e-10 | 0.0154 |
| G4-negrate 1-180 | sweep 0.25 | 1718 | 235 | 0.137 | 395 | 395 | 0 | — | 3.19e-06 | 0.0194 |
| G4-negrate 1-180 | sweep 0.5 | 1718 | 215 | 0.125 | 364 | 364 | 0 | — | 3.4e-06 | 0.0194 |
| G4-negrate 181-730 | main answer | 644 | 128 | 0.199 | 192 | 192 | 0 | 14 | 0.0011 | 0.0216 |
| G4-negrate 181-730 | divsens down | 91 | 17 | 0.187 | 26 | 26 | 0 | — | 0.000297 | 0.0111 |
| G4-negrate 181-730 | divsens up | 91 | 18 | 0.198 | 28 | 28 | 0 | — | 0.000672 | 0.0108 |
| G4-negrate 181-730 | sweep 0.1 | 644 | 157 | 0.244 | 253 | 247 | 6 | — | 0.000384 | 0.0176 |
| G4-negrate 181-730 | sweep 0.25 | 644 | 137 | 0.213 | 204 | 204 | 0 | — | 0.000926 | 0.0216 |
| G4-negrate 181-730 | sweep 0.5 | 644 | 133 | 0.207 | 200 | 200 | 0 | — | 0.000926 | 0.0216 |
| G4-negrate 731-1118 | main answer | 138 | 31 | 0.225 | 43 | 43 | 0 | 1 | 0.000524 | 0.00297 |
| G4-negrate 731-1118 | divsens down | 17 | 4 | 0.235 | 5 | 5 | 0 | — | 0.000913 | 0.00582 |
| G4-negrate 731-1118 | divsens up | 17 | 3 | 0.176 | 4 | 4 | 0 | — | 0.000445 | 0.00336 |
| G4-negrate 731-1118 | sweep 0.1 | 138 | 34 | 0.246 | 47 | 47 | 0 | — | 0.000495 | 0.00297 |
| G4-negrate 731-1118 | sweep 0.25 | 138 | 32 | 0.232 | 44 | 44 | 0 | — | 0.000514 | 0.00297 |
| G4-negrate 731-1118 | sweep 0.5 | 138 | 32 | 0.232 | 44 | 44 | 0 | — | 0.000514 | 0.00297 |
| G5-extreme-vol 1-180 | main answer | 2116 | 100 | 0.0473 | 158 | 158 | 0 | 17 | 9.91e-05 | 0.0322 |
| G5-extreme-vol 1-180 | divsens down | 321 | 21 | 0.0654 | 37 | 37 | 0 | — | 0.0051 | 0.0277 |
| G5-extreme-vol 1-180 | divsens up | 321 | 19 | 0.0592 | 33 | 33 | 0 | — | 0.00665 | 0.0354 |
| G5-extreme-vol 1-180 | sweep 0.1 | 2116 | 391 | 0.185 | 960 | 926 | 34 | — | 1.38e-32 | 0.0281 |
| G5-extreme-vol 1-180 | sweep 0.25 | 2116 | 131 | 0.0619 | 205 | 205 | 0 | — | 0.00049 | 0.0328 |
| G5-extreme-vol 1-180 | sweep 0.5 | 2116 | 112 | 0.0529 | 180 | 180 | 0 | — | 0.000336 | 0.0328 |
| G5-extreme-vol 181-730 | main answer | 384 | 17 | 0.0443 | 31 | 31 | 0 | 4 | 2.01e-08 | 0.0302 |
| G5-extreme-vol 181-730 | divsens down | 74 | 4 | 0.0541 | 8 | 8 | 0 | — | 2.73e-10 | 0.000287 |
| G5-extreme-vol 181-730 | divsens up | 74 | 4 | 0.0541 | 7 | 7 | 0 | — | 1.54e-10 | 1.93e-06 |
| G5-extreme-vol 181-730 | sweep 0.1 | 384 | 57 | 0.148 | 145 | 139 | 6 | — | 2.11e-19 | 0.0302 |
| G5-extreme-vol 181-730 | sweep 0.25 | 384 | 18 | 0.0469 | 32 | 32 | 0 | — | 2.32e-08 | 0.0302 |
| G5-extreme-vol 181-730 | sweep 0.5 | 384 | 18 | 0.0469 | 32 | 32 | 0 | — | 2.32e-08 | 0.0302 |
| G6-long 731-1118 | main answer | 1331 | 50 | 0.0376 | 74 | 74 | 0 | 7 | 0.000773 | 0.0111 |
| G6-long 731-1118 | divsens down | 296 | 17 | 0.0574 | 24 | 24 | 0 | — | 0.000405 | 0.00396 |
| G6-long 731-1118 | divsens up | 296 | 12 | 0.0405 | 18 | 18 | 0 | — | 0.000762 | 0.00633 |
| G6-long 731-1118 | sweep 0.1 | 1331 | 57 | 0.0428 | 84 | 84 | 0 | — | 0.000583 | 0.0111 |
| G6-long 731-1118 | sweep 0.25 | 1331 | 53 | 0.0398 | 77 | 77 | 0 | — | 0.000776 | 0.0111 |
| G6-long 731-1118 | sweep 0.5 | 1331 | 51 | 0.0383 | 75 | 75 | 0 | — | 0.000776 | 0.0111 |
| G6-long 1119-1464 | main answer | 1169 | 71 | 0.0607 | 99 | 99 | 0 | 6 | 0.000445 | 0.00564 |
| G6-long 1119-1464 | divsens down | 270 | 18 | 0.0667 | 23 | 23 | 0 | — | 0.000777 | 0.00429 |
| G6-long 1119-1464 | divsens up | 270 | 17 | 0.063 | 22 | 22 | 0 | — | 0.000454 | 0.00406 |
| G6-long 1119-1464 | sweep 0.1 | 1169 | 74 | 0.0633 | 102 | 102 | 0 | — | 0.000402 | 0.00564 |
| G6-long 1119-1464 | sweep 0.25 | 1169 | 72 | 0.0616 | 100 | 100 | 0 | — | 0.000426 | 0.00564 |
| G6-long 1119-1464 | sweep 0.5 | 1169 | 71 | 0.0607 | 99 | 99 | 0 | — | 0.000445 | 0.00564 |
| T1-near-boundary 1-180 | main answer | 1500 | 1 | 0.000667 | 1 | 0 | 1 | 0 | 1.69e-10 | 1.69e-10 |
| T1-near-boundary 1-180 | divsens down | 196 | 1 | 0.0051 | 1 | 0 | 1 | — | 2.45e-10 | 2.45e-10 |
| T1-near-boundary 1-180 | divsens up | 196 | 1 | 0.0051 | 1 | 0 | 1 | — | 9.33e-11 | 9.33e-11 |
| T1-near-boundary 1-180 | sweep 0.1 | 1500 | 5 | 0.00333 | 11 | 0 | 11 | — | 8.44e-09 | 1.5e-07 |
| T1-near-boundary 1-180 | sweep 0.25 | 1500 | 1 | 0.000667 | 1 | 0 | 1 | — | 1.69e-10 | 1.69e-10 |
| T1-near-boundary 1-180 | sweep 0.5 | 1500 | 1 | 0.000667 | 1 | 0 | 1 | — | 1.69e-10 | 1.69e-10 |

## Targets below tol (report only)

| Group | τ = 1 | 0.5 | 0.25 | 0.1 |
|---|---|---|---|---|
| G0-exempt | 1 | 1 | 1 | 1 |
| G1-nodiv | 0.99 | 0.988 | 0.984 | 0.821 |
| G2-dividends | 0.973 | 0.934 | 0.873 | 0.749 |
| G3-carry-itm | 0.989 | 0.982 | 0.972 | 0.944 |
| G4-negrate | 0.97 | 0.964 | 0.953 | 0.808 |
| G5-extreme-vol | 0.988 | 0.982 | 0.978 | 0.803 |
| G6-long | 0.992 | 0.982 | 0.962 | 0.903 |
| T1-near-boundary | 0.99 | 0.981 | 0.969 | 0.931 |
| X1-outside | 0 | 0 | 0 | 0 |
| named | 0.286 | 0.286 | 0.143 | 0.143 |

## Gate rows in detail

```
{
 "tier1": {
  "golden_matches": true,
  "held_out_mismatches": [],
  "mismatch_count": 0,
  "verdict": "pass"
 },
 "samples": {
  "per_group": {
   "G1-nodiv": {
    "price_scored": 1357,
    "estimator_scored": 1357,
    "delta_estimator_scored": 2210
   },
   "G2-dividends": {
    "price_scored": 1808,
    "estimator_scored": 1808,
    "delta_estimator_scored": 1770
   },
   "G3-carry-itm": {
    "price_scored": 2000,
    "estimator_scored": 2000,
    "delta_estimator_scored": 1513
   },
   "G4-negrate": {
    "price_scored": 1590,
    "estimator_scored": 1590,
    "delta_estimator_scored": 1925
   },
   "G5-extreme-vol": {
    "price_scored": 1509,
    "estimator_scored": 1509,
    "delta_estimator_scored": 1792
   },
   "G6-long": {
    "price_scored": 2300,
    "estimator_scored": 2300,
    "delta_estimator_scored": 2208
   }
  },
  "aggregate_price_scored": 10564,
  "aggregate_estimator_scored": 10564,
  "targets": {
   "per_group": 1000,
   "aggregate": 10000,
   "delta": 300
  },
  "short_groups": [],
  "verdict": "pass"
 },
 "price_accuracy": {
  "failures": 0,
  "indeterminate": 0,
  "limits": {
   "G0-exempt": null,
   "G1-nodiv": 0.0022051790679351235,
   "G2-dividends": 0.0016555596139707833,
   "G3-carry-itm": 0.0014967448951882837,
   "G4-negrate": 0.0018823345302100018,
   "G5-extreme-vol": 0.0019832740964379567,
   "G6-long": 0.0013016444179199007,
   "T1-near-boundary": 0.002482997124650117,
   "X1-outside": null,
   "named": 0.776393202250021
  },
  "verdict": "pass"
 },
 "estimator_coverage_price": {
  "limit_conditional": {
   "G1-nodiv": 0.003491028411015335,
   "G2-dividends": 0.0016555596139707833,
   "G3-carry-itm": 0.0014967448951882837,
   "G4-negrate": 0.0018823345302100018,
   "G5-extreme-vol": 0.0019832740964379567,
   "G6-long": 0.0013016444179199007
  },
  "over": [],
  "short": [],
  "limit_resolved_all": {
   "G1-nodiv": 0.003491028411015335,
   "G2-dividends": 0.0016555596139707833,
   "G3-carry-itm": 0.0014967448951882837,
   "G4-negrate": 0.0018823345302100018,
   "G5-extreme-vol": 0.0019832740964379567,
   "G6-long": 0.0013016444179199007
  },
  "limit_all_accepted": {
   "G1-nodiv": 0.003491028411015335,
   "G2-dividends": 0.007231873767531481,
   "G3-carry-itm": 0.01261550653561062,
   "G4-negrate": 0.0029781814312425303,
   "G5-extreme-vol": 0.007801696796133481,
   "G6-long": 0.013998318195933827
  },
  "populations": {
   "G0-exempt": {
    "covered": 0,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G1-nodiv": {
    "covered": 1356,
    "confirmed": 1,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G2-dividends": {
    "covered": 1808,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 7
   },
   "G3-carry-itm": {
    "covered": 2000,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 17
   },
   "G4-negrate": {
    "covered": 1590,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 1
   },
   "G5-extreme-vol": {
    "covered": 1509,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 6
   },
   "G6-long": {
    "covered": 2300,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 23
   },
   "T1-near-boundary": {
    "covered": 1205,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 4
   },
   "X1-outside": {
    "covered": 0,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "named": {
    "covered": 2,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   }
  },
  "verdict": "pass"
 },
 "estimator_coverage_delta": {
  "limit_conditional": {
   "G1-nodiv": 0.0013546166428741251,
   "G2-dividends": 0.0026773166179464513,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015550142681622452,
   "G5-extreme-vol": 0.001670329044169423,
   "G6-long": 0.0013558428185119174
  },
  "over": [],
  "short": [],
  "limit_resolved_all": {
   "G1-nodiv": 0.0013546166428741251,
   "G2-dividends": 0.0026773166179464513,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015550142681622452,
   "G5-extreme-vol": 0.001670329044169423,
   "G6-long": 0.0013558428185119174
  },
  "limit_all_accepted": {
   "G1-nodiv": 0.0013546166428741251,
   "G2-dividends": 0.0026773166179464513,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015550142681622452,
   "G5-extreme-vol": 0.00800491900177684,
   "G6-long": 0.0028460079367900702
  },
  "populations": {
   "G0-exempt": {
    "covered": 0,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G1-nodiv": {
    "covered": 2210,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G2-dividends": {
    "covered": 1769,
    "confirmed": 1,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G3-carry-itm": {
    "covered": 1513,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G4-negrate": {
    "covered": 1925,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G5-extreme-vol": {
    "covered": 1792,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 8
   },
   "G6-long": {
    "covered": 2208,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 2
   },
   "T1-near-boundary": {
    "covered": 983,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "X1-outside": {
    "covered": 0,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "named": {
    "covered": 0,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   }
  },
  "verdict": "pass"
 },
 "analytic": {
  "cases": 4110,
  "outside_interval": 0,
  "populations": {
   "covered": 4103,
   "confirmed": 0,
   "unresolved": 0,
   "unscored": 0,
   "no reference": 7
  },
  "accuracy_failures": 0,
  "verdict": "pass"
 },
 "interval": {
  "served_outside": 0,
  "disjoint_bands": 0,
  "disjoint_within_target": 0,
  "disjoint_on_delta_levels": 0,
  "proved_exceedances": 0,
  "inconsistent": 0,
  "refused_outside": 142,
  "verdict": "pass",
  "refusals": {
   "G0-exempt": {
    "tier2": {
     "cases": 300,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null,
     "final_refused": 0
    },
    "sweep 0.1": {
     "cases": 300,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.25": {
     "cases": 300,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.5": {
     "cases": 300,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    }
   },
   "G1-nodiv": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 128,
     "share": 0.0512,
     "events": 208,
     "below_L": 208,
     "above_U": 0,
     "dist_tol_p50": 7.168491906750771e-05,
     "dist_tol_max": 0.01776827279922344,
     "final_refused": 23
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 600,
     "share": 0.24,
     "events": 1460,
     "below_L": 1403,
     "above_U": 57,
     "dist_tol_p50": 3.109668431950608e-14,
     "dist_tol_max": 0.01776827279922344
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 168,
     "share": 0.0672,
     "events": 276,
     "below_L": 276,
     "above_U": 0,
     "dist_tol_p50": 5.745213663569185e-05,
     "dist_tol_max": 0.01776827279922344
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 140,
     "share": 0.056,
     "events": 229,
     "below_L": 229,
     "above_U": 0,
     "dist_tol_p50": 8.159030452670719e-05,
     "dist_tol_max": 0.01776827279922344
    }
   },
   "G2-dividends": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 41,
     "share": 0.0164,
     "events": 74,
     "below_L": 74,
     "above_U": 0,
     "dist_tol_p50": 0.00036185536362864923,
     "dist_tol_max": 0.017969590198063656,
     "final_refused": 11
    },
    "divsens down": {
     "cases": 834,
     "with_refusal": 13,
     "share": 0.015587529976019185,
     "events": 25,
     "below_L": 25,
     "above_U": 0,
     "dist_tol_p50": 0.0008223246444671872,
     "dist_tol_max": 0.00829819944971888
    },
    "divsens up": {
     "cases": 834,
     "with_refusal": 14,
     "share": 0.016786570743405275,
     "events": 23,
     "below_L": 23,
     "above_U": 0,
     "dist_tol_p50": 0.0003052381808643645,
     "dist_tol_max": 0.007349548335255918
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 235,
     "share": 0.094,
     "events": 600,
     "below_L": 596,
     "above_U": 4,
     "dist_tol_p50": 1.869938364216071e-13,
     "dist_tol_max": 0.017969590198063656
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 47,
     "share": 0.0188,
     "events": 85,
     "below_L": 85,
     "above_U": 0,
     "dist_tol_p50": 0.00045069632275129834,
     "dist_tol_max": 0.017969590198063656
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 42,
     "share": 0.0168,
     "events": 76,
     "below_L": 76,
     "above_U": 0,
     "dist_tol_p50": 0.00036185536362864923,
     "dist_tol_max": 0.017969590198063656
    }
   },
   "G3-carry-itm": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 49,
     "share": 0.0196,
     "events": 85,
     "below_L": 74,
     "above_U": 11,
     "dist_tol_p50": 6.207458873757503e-07,
     "dist_tol_max": 0.014634776944943244,
     "final_refused": 12
    },
    "divsens down": {
     "cases": 415,
     "with_refusal": 3,
     "share": 0.007228915662650603,
     "events": 7,
     "below_L": 4,
     "above_U": 3,
     "dist_tol_p50": 1.0691164575860057e-05,
     "dist_tol_max": 0.0030415335760203277
    },
    "divsens up": {
     "cases": 415,
     "with_refusal": 2,
     "share": 0.004819277108433735,
     "events": 5,
     "below_L": 2,
     "above_U": 3,
     "dist_tol_p50": 1.6548895587220613e-08,
     "dist_tol_max": 0.0019183107770714969
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 69,
     "share": 0.0276,
     "events": 137,
     "below_L": 77,
     "above_U": 60,
     "dist_tol_p50": 1.4708018576553276e-07,
     "dist_tol_max": 0.014634776944943244
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 50,
     "share": 0.02,
     "events": 88,
     "below_L": 77,
     "above_U": 11,
     "dist_tol_p50": 7.241652813339848e-07,
     "dist_tol_max": 0.014634776944943244
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 50,
     "share": 0.02,
     "events": 88,
     "below_L": 77,
     "above_U": 11,
     "dist_tol_p50": 7.241652813339848e-07,
     "dist_tol_max": 0.014634776944943244
    }
   },
   "G4-negrate": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 351,
     "share": 0.1404,
     "events": 563,
     "below_L": 563,
     "above_U": 0,
     "dist_tol_p50": 0.0002588788443726834,
     "dist_tol_max": 0.02162534644263303,
     "final_refused": 62
    },
    "divsens down": {
     "cases": 325,
     "with_refusal": 32,
     "share": 0.09846153846153846,
     "events": 47,
     "below_L": 47,
     "above_U": 0,
     "dist_tol_p50": 0.00018484330190915443,
     "dist_tol_max": 0.011112249354638948
    },
    "divsens up": {
     "cases": 325,
     "with_refusal": 30,
     "share": 0.09230769230769231,
     "events": 48,
     "below_L": 48,
     "above_U": 0,
     "dist_tol_p50": 0.00018673840379757303,
     "dist_tol_max": 0.010824965093014782
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 807,
     "share": 0.3228,
     "events": 1713,
     "below_L": 1672,
     "above_U": 41,
     "dist_tol_p50": 4.402567706917717e-09,
     "dist_tol_max": 0.01764946393321217
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 404,
     "share": 0.1616,
     "events": 643,
     "below_L": 643,
     "above_U": 0,
     "dist_tol_p50": 0.00019959794446069282,
     "dist_tol_max": 0.02162534644263303
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 380,
     "share": 0.152,
     "events": 608,
     "below_L": 608,
     "above_U": 0,
     "dist_tol_p50": 0.00020767917264486938,
     "dist_tol_max": 0.02162534644263303
    }
   },
   "G5-extreme-vol": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 117,
     "share": 0.0468,
     "events": 189,
     "below_L": 189,
     "above_U": 0,
     "dist_tol_p50": 2.4739545523289053e-06,
     "dist_tol_max": 0.03215331077932214,
     "final_refused": 21
    },
    "divsens down": {
     "cases": 395,
     "with_refusal": 25,
     "share": 0.06329113924050633,
     "events": 45,
     "below_L": 45,
     "above_U": 0,
     "dist_tol_p50": 0.0016599639628576298,
     "dist_tol_max": 0.027661110674775027
    },
    "divsens up": {
     "cases": 395,
     "with_refusal": 23,
     "share": 0.05822784810126582,
     "events": 40,
     "below_L": 40,
     "above_U": 0,
     "dist_tol_p50": 0.0031574813793481225,
     "dist_tol_max": 0.035446030860683715
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 448,
     "share": 0.1792,
     "events": 1105,
     "below_L": 1065,
     "above_U": 40,
     "dist_tol_p50": 4.172215525160224e-31,
     "dist_tol_max": 0.03016981150254459
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 149,
     "share": 0.0596,
     "events": 237,
     "below_L": 237,
     "above_U": 0,
     "dist_tol_p50": 0.0001290739217035819,
     "dist_tol_max": 0.03283282758981856
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 130,
     "share": 0.052,
     "events": 212,
     "below_L": 212,
     "above_U": 0,
     "dist_tol_p50": 9.436065921374082e-05,
     "dist_tol_max": 0.03283282758981856
    }
   },
   "G6-long": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 121,
     "share": 0.0484,
     "events": 173,
     "below_L": 173,
     "above_U": 0,
     "dist_tol_p50": 0.0005238750002689585,
     "dist_tol_max": 0.011118617170069456,
     "final_refused": 13
    },
    "divsens down": {
     "cases": 566,
     "with_refusal": 35,
     "share": 0.061837455830388695,
     "events": 47,
     "below_L": 47,
     "above_U": 0,
     "dist_tol_p50": 0.000574136609898801,
     "dist_tol_max": 0.004289390317139993
    },
    "divsens up": {
     "cases": 566,
     "with_refusal": 29,
     "share": 0.05123674911660778,
     "events": 40,
     "below_L": 40,
     "above_U": 0,
     "dist_tol_p50": 0.000483730664438228,
     "dist_tol_max": 0.006327763563440669
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 131,
     "share": 0.0524,
     "events": 186,
     "below_L": 186,
     "above_U": 0,
     "dist_tol_p50": 0.0004685207752716715,
     "dist_tol_max": 0.011118617170069456
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 125,
     "share": 0.05,
     "events": 177,
     "below_L": 177,
     "above_U": 0,
     "dist_tol_p50": 0.0005238750002689585,
     "dist_tol_max": 0.011118617170069456
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 122,
     "share": 0.0488,
     "events": 174,
     "below_L": 174,
     "above_U": 0,
     "dist_tol_p50": 0.0005328523451632206,
     "dist_tol_max": 0.011118617170069456
    }
   },
   "T1-near-boundary": {
    "tier2": {
     "cases": 1500,
     "with_refusal": 1,
     "share": 0.0006666666666666666,
     "events": 1,
     "below_L": 0,
     "above_U": 1,
     "dist_tol_p50": 1.6936513688168108e-10,
     "dist_tol_max": 1.6936513688168108e-10,
     "final_refused": 0
    },
    "divsens down": {
     "cases": 196,
     "with_refusal": 1,
     "share": 0.00510204081632653,
     "events": 1,
     "below_L": 0,
     "above_U": 1,
     "dist_tol_p50": 2.4488507905577253e-10,
     "dist_tol_max": 2.4488507905577253e-10
    },
    "divsens up": {
     "cases": 196,
     "with_refusal": 1,
     "share": 0.00510204081632653,
     "events": 1,
     "below_L": 0,
     "above_U": 1,
     "dist_tol_p50": 9.334332645780141e-11,
     "dist_tol_max": 9.334332645780141e-11
    },
    "sweep 0.1": {
     "cases": 1500,
     "with_refusal": 5,
     "share": 0.0033333333333333335,
     "events": 11,
     "below_L": 0,
     "above_U": 11,
     "dist_tol_p50": 8.44231351493363e-09,
     "dist_tol_max": 1.5036118009445447e-07
    },
    "sweep 0.25": {
     "cases": 1500,
     "with_refusal": 1,
     "share": 0.0006666666666666666,
     "events": 1,
     "below_L": 0,
     "above_U": 1,
     "dist_tol_p50": 1.6936513688168108e-10,
     "dist_tol_max": 1.6936513688168108e-10
    },
    "sweep 0.5": {
     "cases": 1500,
     "with_refusal": 1,
     "share": 0.0006666666666666666,
     "events": 1,
     "below_L": 0,
     "above_U": 1,
     "dist_tol_p50": 1.6936513688168108e-10,
     "dist_tol_max": 1.6936513688168108e-10
    }
   },
   "X1-outside": {
    "tier2": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null,
     "final_refused": 0
    },
    "divsens down": {
     "cases": 71,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "divsens up": {
     "cases": 71,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.1": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.25": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.5": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    }
   },
   "named": {
    "tier2": {
     "cases": 7,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null,
     "final_refused": 0
    },
    "divsens down": {
     "cases": 5,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "divsens up": {
     "cases": 5,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.1": {
     "cases": 7,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.25": {
     "cases": 7,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.5": {
     "cases": 7,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    }
   }
  }
 },
 "delta": {
  "failures": 0,
  "indeterminate": 0,
  "served_without_estimate": 0,
  "withheld": {
   "G0-exempt": {},
   "G1-nodiv": {
    "within 5 tolerances of the exercise value": 264,
    "delta estimate above 2.5e-3": 2
   },
   "G2-dividends": {
  
```
