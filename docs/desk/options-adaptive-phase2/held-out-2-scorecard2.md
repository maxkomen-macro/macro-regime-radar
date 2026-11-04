# Phase 2 scorecard (Tier 2 convergence controller)

- Attempt: options adaptive Phase 2, attempt 2; seed [20261102]; held-out
- Configuration: {"estimator": "envelope", "schedule": "multiples", "F": 3.0, "F_d": 2.0, "tau": 1.0, "force_lattice": false}; engine adaptive-p2.1
- Freeze: `scripts/options_bench/calibration/phase2-freeze-2.json` (sha256 2bb31fec8ba3…)
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
| G1-nodiv | 1388 | 1387 | 0 | 0 | 0 | 1 | 0.00216 | 0.00216 | 0.00341 |
| G2-dividends | 1756 | 1754 | 0 | 0 | 0 | 2 | 0.00171 | 0.00171 | 0.00358 |
| G3-carry-itm | 2054 | 2043 | 0 | 0 | 0 | 11 | 0.00147 | 0.00147 | 0.00885 |
| G4-negrate | 1628 | 1628 | 0 | 0 | 0 | 0 | 0.00184 | 0.00184 | 0.00184 |
| G5-extreme-vol | 1503 | 1502 | 0 | 0 | 0 | 1 | 0.00199 | 0.00199 | 0.00315 |
| G6-long | 2315 | 2297 | 0 | 0 | 0 | 18 | 0.0013 | 0.0013 | 0.0115 |
| T1-near-boundary | 1252 | 1251 | 0 | 0 | 0 | 1 | 0.00239 | 0.00239 | 0.00378 |
| X1-outside | 0 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| named | 2 | 2 | 0 | 0 | 0 | 0 | 0.776 | 0.776 | 0.776 |

## Delta estimator coverage by group

| Group | Deltas with an estimate | Covered | Confirmed | Unresolved | Unscored | No reference | Conditional limit | Withheld (top reasons) |
|---|---|---|---|---|---|---|---|---|
| G0-exempt | 0 | 0 | 0 | 0 | 0 | 0 | — |  |
| G1-nodiv | 2245 | 2245 | 0 | 0 | 0 | 0 | 0.00133 | within 5 tolerances of the exercise value: 234, delta estimate above 2.5e-3: 3 |
| G2-dividends | 1718 | 1718 | 0 | 0 | 0 | 0 | 0.00174 | a dividend falls within 5 days, where the lattice delta is not validated: 513, within 5 tolerances of the exercise value: 54, delta estimate above 2.5e-3: 1 |
| G3-carry-itm | 1513 | 1513 | 0 | 0 | 0 | 0 | 0.00198 | a dividend falls within 5 days, where the lattice delta is not validated: 728, within 5 tolerances of the exercise value: 229 |
| G4-negrate | 1923 | 1923 | 0 | 0 | 0 | 0 | 0.00156 | within 5 tolerances of the exercise value: 286, a dividend falls within 5 days, where the lattice delta is not validated: 210 |
| G5-extreme-vol | 1784 | 1774 | 0 | 0 | 0 | 10 | 0.00169 | a dividend falls within 5 days, where the lattice delta is not validated: 526, within 5 tolerances of the exercise value: 80 |
| G6-long | 2228 | 2224 | 0 | 0 | 0 | 4 | 0.00135 | a dividend falls within 5 days, where the lattice delta is not validated: 111, within 5 tolerances of the exercise value: 53 |
| T1-near-boundary | 979 | 979 | 0 | 0 | 0 | 0 | 0.00306 | a dividend falls within 5 days, where the lattice delta is not validated: 393, within 5 tolerances of the exercise value: 110, delta estimate above 2.5e-3: 2 |
| X1-outside | 0 | 0 | 0 | 0 | 0 | 0 | — |  |
| named | 0 | 0 | 0 | 0 | 0 | 0 | — | within 5 tolerances of the exercise value: 1, a dividend falls within 5 days, where the lattice delta is not validated: 1 |

## Coverage and work by group and maturity band (report only)

| Group, band | Cases | Tier 2 priced | Label | Work p50 | p95 | max | Refusals |
|---|---|---|---|---|---|---|---|
| G0-exempt 1-180 | 228 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 181-730 | 47 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 731-1118 | 16 | 1 | partial | 150 | 150 | 150 |  |
| G0-exempt 1119-1464 | 9 | 1 | partial | 150 | 150 | 150 |  |
| G1-nodiv 1-180 | 1781 | 0.993 | covered | 3.61e+05 | 9.13e+05 | 3128080 | outside the proved interval: 12, estimate above target: 1 |
| G1-nodiv 181-730 | 482 | 0.994 | covered | 2.08e+06 | 7.48e+06 | 17835136 | outside the proved interval: 3 |
| G1-nodiv 731-1118 | 143 | 0.993 | partial | 1.26e+07 | 1.82e+07 | 40895810 | outside the proved interval: 1 |
| G1-nodiv 1119-1464 | 94 | 0.989 | partial | 2.47e+07 | 3.18e+07 | 75838762 | estimate above target: 1 |
| G2-dividends 1-180 | 1563 | 0.958 | covered | 3.8e+05 | 1e+06 | 1724640 | estimate above target: 50, outside the proved interval: 16 |
| G2-dividends 181-730 | 635 | 0.976 | covered | 2.05e+06 | 7.07e+06 | 20922346 | estimate above target: 15 |
| G2-dividends 731-1118 | 196 | 0.99 | partial | 1.2e+07 | 1.79e+07 | 43707426 | estimate above target: 2 |
| G2-dividends 1119-1464 | 106 | 0.991 | partial | 2.42e+07 | 3.15e+07 | 32027040 | estimate above target: 1 |
| G3-carry-itm 1-180 | 1918 | 0.986 | covered | 3.65e+05 | 9.64e+05 | 1935616 | estimate above target: 14, outside the proved interval: 12 |
| G3-carry-itm 181-730 | 582 | 0.993 | covered | 1.88e+06 | 7.01e+06 | 21793368 | estimate above target: 4 |
| G4-negrate 1-180 | 1710 | 0.967 | covered | 3.98e+05 | 1.2e+06 | 3937616 | outside the proved interval: 51, estimate above target: 5 |
| G4-negrate 181-730 | 638 | 0.969 | covered | 2.47e+06 | 8.71e+06 | 24119050 | outside the proved interval: 17, estimate above target: 3 |
| G4-negrate 731-1118 | 152 | 0.967 | partial | 1.27e+07 | 2.92e+07 | 42200066 | outside the proved interval: 5 |
| G5-extreme-vol 1-180 | 2123 | 0.988 | covered | 3.61e+05 | 9.37e+05 | 2625578 | outside the proved interval: 16, estimate above target: 9 |
| G5-extreme-vol 181-730 | 377 | 0.992 | partial | 1e+06 | 2.31e+06 | 6784096 | outside the proved interval: 3 |
| G6-long 731-1118 | 1350 | 0.993 | covered | 1.33e+07 | 1.89e+07 | 56168050 | estimate above target: 7, outside the proved interval: 3 |
| G6-long 1119-1464 | 1150 | 0.997 | covered | 2.51e+07 | 3.41e+07 | 95672976 | outside the proved interval: 3 |
| T1-near-boundary 1-180 | 1500 | 0.989 | covered | 3.89e+05 | 1e+06 | 2254446 | estimate above target: 16 |

## Interval refusals by group and maturity band (report only; refusals are not passes)

Candidates outside the proved interval are refused, never served or clipped. Below L they are numerical undershoots; their cause has not been established as roundoff.

Each output is counted over the cases that have it: the main answer, each sweep target, each dividend scenario.

| Group, band | Output | Cases | With a refusal | Share | Refusals | Below L | Above U | Finally refused | Distance p50 (tol) | max (tol) |
|---|---|---|---|---|---|---|---|---|---|---|
| G0-exempt 1-180 | main answer | 228 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 1-180 | sweep 0.1 | 228 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1-180 | sweep 0.25 | 228 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1-180 | sweep 0.5 | 228 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | main answer | 47 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 181-730 | sweep 0.1 | 47 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | sweep 0.25 | 47 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 181-730 | sweep 0.5 | 47 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | main answer | 16 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 731-1118 | sweep 0.1 | 16 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | sweep 0.25 | 16 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 731-1118 | sweep 0.5 | 16 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | main answer | 9 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G0-exempt 1119-1464 | sweep 0.1 | 9 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | sweep 0.25 | 9 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G0-exempt 1119-1464 | sweep 0.5 | 9 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G1-nodiv 1-180 | main answer | 1781 | 78 | 0.0438 | 121 | 121 | 0 | 12 | 0.000131 | 0.0339 |
| G1-nodiv 1-180 | sweep 0.1 | 1781 | 524 | 0.294 | 1302 | 1270 | 32 | — | 4.54e-17 | 0.0201 |
| G1-nodiv 1-180 | sweep 0.25 | 1781 | 126 | 0.0707 | 193 | 193 | 0 | — | 5.06e-05 | 0.0339 |
| G1-nodiv 1-180 | sweep 0.5 | 1781 | 99 | 0.0556 | 152 | 152 | 0 | — | 7.28e-05 | 0.0339 |
| G1-nodiv 181-730 | main answer | 482 | 24 | 0.0498 | 36 | 36 | 0 | 3 | 0.000189 | 0.00962 |
| G1-nodiv 181-730 | sweep 0.1 | 482 | 45 | 0.0934 | 85 | 85 | 0 | — | 2.18e-08 | 0.00962 |
| G1-nodiv 181-730 | sweep 0.25 | 482 | 27 | 0.056 | 39 | 39 | 0 | — | 0.000194 | 0.00962 |
| G1-nodiv 181-730 | sweep 0.5 | 482 | 25 | 0.0519 | 37 | 37 | 0 | — | 0.000194 | 0.00962 |
| G1-nodiv 731-1118 | main answer | 143 | 7 | 0.049 | 11 | 11 | 0 | 1 | 8.03e-05 | 0.00162 |
| G1-nodiv 731-1118 | sweep 0.1 | 143 | 7 | 0.049 | 11 | 11 | 0 | — | 8.03e-05 | 0.00162 |
| G1-nodiv 731-1118 | sweep 0.25 | 143 | 7 | 0.049 | 11 | 11 | 0 | — | 8.03e-05 | 0.00162 |
| G1-nodiv 731-1118 | sweep 0.5 | 143 | 7 | 0.049 | 11 | 11 | 0 | — | 8.03e-05 | 0.00162 |
| G1-nodiv 1119-1464 | main answer | 94 | 3 | 0.0319 | 5 | 5 | 0 | 0 | 6.69e-05 | 0.00129 |
| G1-nodiv 1119-1464 | sweep 0.1 | 94 | 3 | 0.0319 | 5 | 5 | 0 | — | 6.69e-05 | 0.00129 |
| G1-nodiv 1119-1464 | sweep 0.25 | 94 | 3 | 0.0319 | 5 | 5 | 0 | — | 6.69e-05 | 0.00129 |
| G1-nodiv 1119-1464 | sweep 0.5 | 94 | 3 | 0.0319 | 5 | 5 | 0 | — | 6.69e-05 | 0.00129 |
| G2-dividends 1-180 | main answer | 1563 | 26 | 0.0166 | 60 | 60 | 0 | 16 | 2.86e-09 | 0.0155 |
| G2-dividends 1-180 | divsens down | 512 | 12 | 0.0234 | 20 | 20 | 0 | — | 0.00162 | 0.0175 |
| G2-dividends 1-180 | divsens up | 512 | 6 | 0.0117 | 11 | 11 | 0 | — | 0.000376 | 0.0131 |
| G2-dividends 1-180 | sweep 0.1 | 1563 | 237 | 0.152 | 635 | 621 | 14 | — | 5.31e-14 | 0.0155 |
| G2-dividends 1-180 | sweep 0.25 | 1563 | 32 | 0.0205 | 68 | 68 | 0 | — | 1.85e-07 | 0.0155 |
| G2-dividends 1-180 | sweep 0.5 | 1563 | 29 | 0.0186 | 65 | 65 | 0 | — | 1.13e-08 | 0.0155 |
| G2-dividends 181-730 | main answer | 635 | 6 | 0.00945 | 7 | 7 | 0 | 0 | 0.00292 | 0.0183 |
| G2-dividends 181-730 | divsens down | 219 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 181-730 | divsens up | 219 | 2 | 0.00913 | 3 | 3 | 0 | — | 0.0019 | 0.00717 |
| G2-dividends 181-730 | sweep 0.1 | 635 | 10 | 0.0157 | 14 | 14 | 0 | — | 0.000468 | 0.0183 |
| G2-dividends 181-730 | sweep 0.25 | 635 | 8 | 0.0126 | 10 | 10 | 0 | — | 0.00172 | 0.0183 |
| G2-dividends 181-730 | sweep 0.5 | 635 | 7 | 0.011 | 8 | 8 | 0 | — | 0.00278 | 0.0183 |
| G2-dividends 731-1118 | main answer | 196 | 6 | 0.0306 | 8 | 8 | 0 | 0 | 0.00162 | 0.00462 |
| G2-dividends 731-1118 | divsens down | 67 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 731-1118 | divsens up | 67 | 4 | 0.0597 | 5 | 5 | 0 | — | 0.00137 | 0.00399 |
| G2-dividends 731-1118 | sweep 0.1 | 196 | 7 | 0.0357 | 9 | 9 | 0 | — | 0.00147 | 0.00462 |
| G2-dividends 731-1118 | sweep 0.25 | 196 | 6 | 0.0306 | 8 | 8 | 0 | — | 0.00162 | 0.00462 |
| G2-dividends 731-1118 | sweep 0.5 | 196 | 6 | 0.0306 | 8 | 8 | 0 | — | 0.00162 | 0.00462 |
| G2-dividends 1119-1464 | main answer | 106 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| G2-dividends 1119-1464 | divsens down | 36 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 1119-1464 | divsens up | 36 | 1 | 0.0278 | 3 | 3 | 0 | — | 0.00104 | 0.00106 |
| G2-dividends 1119-1464 | sweep 0.1 | 106 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 1119-1464 | sweep 0.25 | 106 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G2-dividends 1119-1464 | sweep 0.5 | 106 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 1-180 | main answer | 1918 | 34 | 0.0177 | 69 | 69 | 0 | 12 | 7.15e-07 | 0.00338 |
| G3-carry-itm 1-180 | divsens down | 310 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 1-180 | divsens up | 310 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 1-180 | sweep 0.1 | 1918 | 64 | 0.0334 | 138 | 77 | 61 | — | 8.72e-08 | 0.00338 |
| G3-carry-itm 1-180 | sweep 0.25 | 1918 | 39 | 0.0203 | 77 | 77 | 0 | — | 2.36e-07 | 0.00338 |
| G3-carry-itm 1-180 | sweep 0.5 | 1918 | 39 | 0.0203 | 77 | 77 | 0 | — | 2.36e-07 | 0.00338 |
| G3-carry-itm 181-730 | main answer | 582 | 6 | 0.0103 | 9 | 9 | 0 | 0 | 0.000101 | 0.00227 |
| G3-carry-itm 181-730 | divsens down | 90 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 181-730 | divsens up | 90 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| G3-carry-itm 181-730 | sweep 0.1 | 582 | 6 | 0.0103 | 9 | 9 | 0 | — | 0.000101 | 0.00227 |
| G3-carry-itm 181-730 | sweep 0.25 | 582 | 6 | 0.0103 | 9 | 9 | 0 | — | 0.000101 | 0.00227 |
| G3-carry-itm 181-730 | sweep 0.5 | 582 | 6 | 0.0103 | 9 | 9 | 0 | — | 0.000101 | 0.00227 |
| G4-negrate 1-180 | main answer | 1710 | 203 | 0.119 | 359 | 359 | 0 | 51 | 6.87e-06 | 0.0162 |
| G4-negrate 1-180 | divsens down | 231 | 16 | 0.0693 | 32 | 32 | 0 | — | 0.000158 | 0.011 |
| G4-negrate 1-180 | divsens up | 231 | 12 | 0.0519 | 28 | 28 | 0 | — | 0.000287 | 0.0112 |
| G4-negrate 1-180 | sweep 0.1 | 1710 | 599 | 0.35 | 1381 | 1350 | 31 | — | 6.75e-10 | 0.0162 |
| G4-negrate 1-180 | sweep 0.25 | 1710 | 245 | 0.143 | 429 | 429 | 0 | — | 6.56e-06 | 0.0162 |
| G4-negrate 1-180 | sweep 0.5 | 1710 | 229 | 0.134 | 405 | 405 | 0 | — | 5.33e-06 | 0.0162 |
| G4-negrate 181-730 | main answer | 638 | 137 | 0.215 | 204 | 204 | 0 | 17 | 0.00081 | 0.0216 |
| G4-negrate 181-730 | divsens down | 89 | 24 | 0.27 | 32 | 32 | 0 | — | 0.000254 | 0.0143 |
| G4-negrate 181-730 | divsens up | 89 | 20 | 0.225 | 27 | 27 | 0 | — | 0.000458 | 0.0137 |
| G4-negrate 181-730 | sweep 0.1 | 638 | 162 | 0.254 | 258 | 255 | 3 | — | 0.000358 | 0.0216 |
| G4-negrate 181-730 | sweep 0.25 | 638 | 146 | 0.229 | 217 | 217 | 0 | — | 0.000739 | 0.0216 |
| G4-negrate 181-730 | sweep 0.5 | 638 | 141 | 0.221 | 211 | 211 | 0 | — | 0.000755 | 0.0216 |
| G4-negrate 731-1118 | main answer | 152 | 43 | 0.283 | 63 | 63 | 0 | 5 | 0.000359 | 0.00545 |
| G4-negrate 731-1118 | divsens down | 8 | 1 | 0.125 | 1 | 1 | 0 | — | 0.00353 | 0.00353 |
| G4-negrate 731-1118 | divsens up | 8 | 1 | 0.125 | 1 | 1 | 0 | — | 0.00342 | 0.00342 |
| G4-negrate 731-1118 | sweep 0.1 | 152 | 44 | 0.289 | 64 | 64 | 0 | — | 0.000341 | 0.00545 |
| G4-negrate 731-1118 | sweep 0.25 | 152 | 44 | 0.289 | 64 | 64 | 0 | — | 0.000341 | 0.00545 |
| G4-negrate 731-1118 | sweep 0.5 | 152 | 44 | 0.289 | 64 | 64 | 0 | — | 0.000341 | 0.00545 |
| G5-extreme-vol 1-180 | main answer | 2123 | 89 | 0.0419 | 139 | 139 | 0 | 16 | 5.64e-08 | 0.0327 |
| G5-extreme-vol 1-180 | divsens down | 354 | 16 | 0.0452 | 24 | 24 | 0 | — | 0.00194 | 0.026 |
| G5-extreme-vol 1-180 | divsens up | 354 | 17 | 0.048 | 25 | 25 | 0 | — | 0.00142 | 0.0245 |
| G5-extreme-vol 1-180 | sweep 0.1 | 2123 | 385 | 0.181 | 942 | 924 | 18 | — | 5.35e-36 | 0.0281 |
| G5-extreme-vol 1-180 | sweep 0.25 | 2123 | 118 | 0.0556 | 179 | 179 | 0 | — | 1.22e-05 | 0.0327 |
| G5-extreme-vol 1-180 | sweep 0.5 | 2123 | 101 | 0.0476 | 155 | 155 | 0 | — | 4.53e-07 | 0.0327 |
| G5-extreme-vol 181-730 | main answer | 377 | 17 | 0.0451 | 28 | 28 | 0 | 3 | 4.44e-09 | 0.0182 |
| G5-extreme-vol 181-730 | divsens down | 60 | 1 | 0.0167 | 1 | 1 | 0 | — | 3.76e-09 | 3.76e-09 |
| G5-extreme-vol 181-730 | divsens up | 60 | 2 | 0.0333 | 3 | 3 | 0 | — | 3.75e-09 | 2.06e-08 |
| G5-extreme-vol 181-730 | sweep 0.1 | 377 | 44 | 0.117 | 103 | 96 | 7 | — | 3.22e-21 | 0.00521 |
| G5-extreme-vol 181-730 | sweep 0.25 | 377 | 17 | 0.0451 | 28 | 28 | 0 | — | 4.44e-09 | 0.0182 |
| G5-extreme-vol 181-730 | sweep 0.5 | 377 | 17 | 0.0451 | 28 | 28 | 0 | — | 4.44e-09 | 0.0182 |
| G6-long 731-1118 | main answer | 1350 | 77 | 0.057 | 98 | 98 | 0 | 3 | 0.000664 | 0.00641 |
| G6-long 731-1118 | divsens down | 296 | 18 | 0.0608 | 24 | 24 | 0 | — | 0.00106 | 0.00561 |
| G6-long 731-1118 | divsens up | 296 | 18 | 0.0608 | 28 | 28 | 0 | — | 0.000616 | 0.00442 |
| G6-long 731-1118 | sweep 0.1 | 1350 | 83 | 0.0615 | 109 | 109 | 0 | — | 0.000556 | 0.00641 |
| G6-long 731-1118 | sweep 0.25 | 1350 | 80 | 0.0593 | 103 | 103 | 0 | — | 0.000615 | 0.00641 |
| G6-long 731-1118 | sweep 0.5 | 1350 | 77 | 0.057 | 98 | 98 | 0 | — | 0.000664 | 0.00641 |
| G6-long 1119-1464 | main answer | 1150 | 58 | 0.0504 | 82 | 82 | 0 | 3 | 0.000551 | 0.00265 |
| G6-long 1119-1464 | divsens down | 235 | 8 | 0.034 | 12 | 12 | 0 | — | 0.000294 | 0.00309 |
| G6-long 1119-1464 | divsens up | 235 | 8 | 0.034 | 9 | 9 | 0 | — | 0.00136 | 0.00413 |
| G6-long 1119-1464 | sweep 0.1 | 1150 | 62 | 0.0539 | 86 | 86 | 0 | — | 0.000523 | 0.00265 |
| G6-long 1119-1464 | sweep 0.25 | 1150 | 60 | 0.0522 | 84 | 84 | 0 | — | 0.000538 | 0.00265 |
| G6-long 1119-1464 | sweep 0.5 | 1150 | 59 | 0.0513 | 83 | 83 | 0 | — | 0.000547 | 0.00265 |
| T1-near-boundary 1-180 | main answer | 1500 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| T1-near-boundary 1-180 | divsens down | 213 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| T1-near-boundary 1-180 | divsens up | 213 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| T1-near-boundary 1-180 | sweep 0.1 | 1500 | 7 | 0.00467 | 11 | 0 | 11 | — | 7.31e-09 | 2.94e-07 |
| T1-near-boundary 1-180 | sweep 0.25 | 1500 | 0 | 0 | 0 | 0 | 0 | — | — | — |
| T1-near-boundary 1-180 | sweep 0.5 | 1500 | 0 | 0 | 0 | 0 | 0 | — | — | — |

## Targets below tol (report only)

| Group | τ = 1 | 0.5 | 0.25 | 0.1 |
|---|---|---|---|---|
| G0-exempt | 1 | 1 | 1 | 1 |
| G1-nodiv | 0.993 | 0.991 | 0.987 | 0.828 |
| G2-dividends | 0.966 | 0.928 | 0.884 | 0.751 |
| G3-carry-itm | 0.988 | 0.982 | 0.968 | 0.932 |
| G4-negrate | 0.968 | 0.957 | 0.942 | 0.807 |
| G5-extreme-vol | 0.989 | 0.984 | 0.975 | 0.806 |
| G6-long | 0.995 | 0.987 | 0.958 | 0.898 |
| T1-near-boundary | 0.989 | 0.979 | 0.962 | 0.927 |
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
    "price_scored": 1387,
    "estimator_scored": 1387,
    "delta_estimator_scored": 2245
   },
   "G2-dividends": {
    "price_scored": 1754,
    "estimator_scored": 1754,
    "delta_estimator_scored": 1718
   },
   "G3-carry-itm": {
    "price_scored": 2043,
    "estimator_scored": 2043,
    "delta_estimator_scored": 1513
   },
   "G4-negrate": {
    "price_scored": 1628,
    "estimator_scored": 1628,
    "delta_estimator_scored": 1923
   },
   "G5-extreme-vol": {
    "price_scored": 1502,
    "estimator_scored": 1502,
    "delta_estimator_scored": 1774
   },
   "G6-long": {
    "price_scored": 2297,
    "estimator_scored": 2297,
    "delta_estimator_scored": 2224
   }
  },
  "aggregate_price_scored": 10611,
  "aggregate_estimator_scored": 10611,
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
   "G1-nodiv": 0.0021575338236213123,
   "G2-dividends": 0.0017064854385372087,
   "G3-carry-itm": 0.0014652652794568935,
   "G4-negrate": 0.001838438387230221,
   "G5-extreme-vol": 0.0019925078371763267,
   "G6-long": 0.001303343324064377,
   "T1-near-boundary": 0.002391805147688695,
   "X1-outside": null,
   "named": 0.776393202250021
  },
  "verdict": "pass"
 },
 "estimator_coverage_price": {
  "limit_conditional": {
   "G1-nodiv": 0.0021575338236213123,
   "G2-dividends": 0.0017064854385372087,
   "G3-carry-itm": 0.0014652652794568935,
   "G4-negrate": 0.001838438387230221,
   "G5-extreme-vol": 0.0019925078371763267,
   "G6-long": 0.001303343324064377
  },
  "over": [],
  "short": [],
  "limit_resolved_all": {
   "G1-nodiv": 0.0021575338236213123,
   "G2-dividends": 0.0017064854385372087,
   "G3-carry-itm": 0.0014652652794568935,
   "G4-negrate": 0.001838438387230221,
   "G5-extreme-vol": 0.0019925078371763267,
   "G6-long": 0.001303343324064377
  },
  "limit_all_accepted": {
   "G1-nodiv": 0.0034131638957200752,
   "G2-dividends": 0.0035809209477081086,
   "G3-carry-itm": 0.008848864431743752,
   "G4-negrate": 0.001838438387230221,
   "G5-extreme-vol": 0.003152335530389645,
   "G6-long": 0.011508265736075983
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
    "covered": 1387,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 1
   },
   "G2-dividends": {
    "covered": 1754,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 2
   },
   "G3-carry-itm": {
    "covered": 2043,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 11
   },
   "G4-negrate": {
    "covered": 1628,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G5-extreme-vol": {
    "covered": 1502,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 1
   },
   "G6-long": {
    "covered": 2297,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 18
   },
   "T1-near-boundary": {
    "covered": 1251,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 1
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
   "G1-nodiv": 0.00133351198524763,
   "G2-dividends": 0.0017422129879560153,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015566302882858577,
   "G5-extreme-vol": 0.0016872628344919106,
   "G6-long": 0.00134609512167313
  },
  "over": [],
  "short": [],
  "limit_resolved_all": {
   "G1-nodiv": 0.00133351198524763,
   "G2-dividends": 0.0017422129879560153,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015566302882858577,
   "G5-extreme-vol": 0.0016872628344919106,
   "G6-long": 0.00134609512167313
  },
  "limit_all_accepted": {
   "G1-nodiv": 0.00133351198524763,
   "G2-dividends": 0.0017422129879560153,
   "G3-carry-itm": 0.001978035996487228,
   "G4-negrate": 0.0015566302882858577,
   "G5-extreme-vol": 0.009489418165678323,
   "G6-long": 0.004103652013636856
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
    "covered": 2245,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G2-dividends": {
    "covered": 1718,
    "confirmed": 0,
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
    "covered": 1923,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 0
   },
   "G5-extreme-vol": {
    "covered": 1774,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 10
   },
   "G6-long": {
    "covered": 2224,
    "confirmed": 0,
    "unresolved": 0,
    "unscored": 0,
    "no reference": 4
   },
   "T1-near-boundary": {
    "covered": 979,
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
  "cases": 4027,
  "outside_interval": 0,
  "populations": {
   "covered": 4016,
   "confirmed": 0,
   "unresolved": 0,
   "unscored": 0,
   "no reference": 11
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
     "with_refusal": 112,
     "share": 0.0448,
     "events": 173,
     "below_L": 173,
     "above_U": 0,
     "dist_tol_p50": 0.00015627317391242457,
     "dist_tol_max": 0.033904052624933456,
     "final_refused": 16
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 579,
     "share": 0.2316,
     "events": 1403,
     "below_L": 1371,
     "above_U": 32,
     "dist_tol_p50": 2.079463374797474e-15,
     "dist_tol_max": 0.02005093255597093
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 163,
     "share": 0.0652,
     "events": 248,
     "below_L": 248,
     "above_U": 0,
     "dist_tol_p50": 9.040064045499163e-05,
     "dist_tol_max": 0.033904052624933456
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 134,
     "share": 0.0536,
     "events": 205,
     "below_L": 205,
     "above_U": 0,
     "dist_tol_p50": 0.00012048934276975842,
     "dist_tol_max": 0.033904052624933456
    }
   },
   "G2-dividends": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 38,
     "share": 0.0152,
     "events": 75,
     "below_L": 75,
     "above_U": 0,
     "dist_tol_p50": 4.25749514077273e-06,
     "dist_tol_max": 0.01828842850386536,
     "final_refused": 16
    },
    "divsens down": {
     "cases": 834,
     "with_refusal": 12,
     "share": 0.014388489208633094,
     "events": 20,
     "below_L": 20,
     "above_U": 0,
     "dist_tol_p50": 0.0016208622953151064,
     "dist_tol_max": 0.017505208623447288
    },
    "divsens up": {
     "cases": 834,
     "with_refusal": 13,
     "share": 0.015587529976019185,
     "events": 22,
     "below_L": 22,
     "above_U": 0,
     "dist_tol_p50": 0.00107530706914049,
     "dist_tol_max": 0.013088183373355378
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 254,
     "share": 0.1016,
     "events": 658,
     "below_L": 644,
     "above_U": 14,
     "dist_tol_p50": 2.84317305797785e-13,
     "dist_tol_max": 0.01828842850386536
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 46,
     "share": 0.0184,
     "events": 86,
     "below_L": 86,
     "above_U": 0,
     "dist_tol_p50": 1.086240761036944e-05,
     "dist_tol_max": 0.01828842850386536
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 42,
     "share": 0.0168,
     "events": 81,
     "below_L": 81,
     "above_U": 0,
     "dist_tol_p50": 6.893877820804193e-06,
     "dist_tol_max": 0.01828842850386536
    }
   },
   "G3-carry-itm": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 40,
     "share": 0.016,
     "events": 78,
     "below_L": 78,
     "above_U": 0,
     "dist_tol_p50": 3.7860237611653247e-06,
     "dist_tol_max": 0.00337730372983458,
     "final_refused": 12
    },
    "divsens down": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "divsens up": {
     "cases": 400,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 70,
     "share": 0.028,
     "events": 147,
     "below_L": 86,
     "above_U": 61,
     "dist_tol_p50": 1.0501608471713553e-07,
     "dist_tol_max": 0.00337730372983458
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 45,
     "share": 0.018,
     "events": 86,
     "below_L": 86,
     "above_U": 0,
     "dist_tol_p50": 6.200163937819525e-07,
     "dist_tol_max": 0.00337730372983458
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 45,
     "share": 0.018,
     "events": 86,
     "below_L": 86,
     "above_U": 0,
     "dist_tol_p50": 6.200163937819525e-07,
     "dist_tol_max": 0.00337730372983458
    }
   },
   "G4-negrate": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 383,
     "share": 0.1532,
     "events": 626,
     "below_L": 626,
     "above_U": 0,
     "dist_tol_p50": 0.00021235712680534036,
     "dist_tol_max": 0.02156075907263889,
     "final_refused": 73
    },
    "divsens down": {
     "cases": 328,
     "with_refusal": 41,
     "share": 0.125,
     "events": 65,
     "below_L": 65,
     "above_U": 0,
     "dist_tol_p50": 0.0002113776193635175,
     "dist_tol_max": 0.014275744457501136
    },
    "divsens up": {
     "cases": 328,
     "with_refusal": 33,
     "share": 0.10060975609756098,
     "events": 56,
     "below_L": 56,
     "above_U": 0,
     "dist_tol_p50": 0.0004579886587306064,
     "dist_tol_max": 0.013744875143589517
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 805,
     "share": 0.322,
     "events": 1703,
     "below_L": 1669,
     "above_U": 34,
     "dist_tol_p50": 1.5922721449166957e-08,
     "dist_tol_max": 0.02156075907263889
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 435,
     "share": 0.174,
     "events": 710,
     "below_L": 710,
     "above_U": 0,
     "dist_tol_p50": 0.00019659654464376786,
     "dist_tol_max": 0.02156075907263889
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 414,
     "share": 0.1656,
     "events": 680,
     "below_L": 680,
     "above_U": 0,
     "dist_tol_p50": 0.00017998466648183609,
     "dist_tol_max": 0.02156075907263889
    }
   },
   "G5-extreme-vol": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 106,
     "share": 0.0424,
     "events": 167,
     "below_L": 167,
     "above_U": 0,
     "dist_tol_p50": 2.8535771662021127e-08,
     "dist_tol_max": 0.032659893060781466,
     "final_refused": 19
    },
    "divsens down": {
     "cases": 414,
     "with_refusal": 17,
     "share": 0.04106280193236715,
     "events": 25,
     "below_L": 25,
     "above_U": 0,
     "dist_tol_p50": 0.0016619713963950899,
     "dist_tol_max": 0.026039366762265374
    },
    "divsens up": {
     "cases": 414,
     "with_refusal": 19,
     "share": 0.04589371980676329,
     "events": 28,
     "below_L": 28,
     "above_U": 0,
     "dist_tol_p50": 0.0002473975475705271,
     "dist_tol_max": 0.024521403936167353
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 429,
     "share": 0.1716,
     "events": 1045,
     "below_L": 1020,
     "above_U": 25,
     "dist_tol_p50": 3.118684553388263e-33,
     "dist_tol_max": 0.028101887543222428
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 135,
     "share": 0.054,
     "events": 207,
     "below_L": 207,
     "above_U": 0,
     "dist_tol_p50": 3.0696041264377527e-07,
     "dist_tol_max": 0.032659893060781466
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 118,
     "share": 0.0472,
     "events": 183,
     "below_L": 183,
     "above_U": 0,
     "dist_tol_p50": 4.32119229287764e-08,
     "dist_tol_max": 0.032659893060781466
    }
   },
   "G6-long": {
    "tier2": {
     "cases": 2500,
     "with_refusal": 135,
     "share": 0.054,
     "events": 180,
     "below_L": 180,
     "above_U": 0,
     "dist_tol_p50": 0.0006137836773496658,
     "dist_tol_max": 0.006413878880824451,
     "final_refused": 6
    },
    "divsens down": {
     "cases": 531,
     "with_refusal": 26,
     "share": 0.04896421845574388,
     "events": 36,
     "below_L": 36,
     "above_U": 0,
     "dist_tol_p50": 0.0007960069507665567,
     "dist_tol_max": 0.005613840759473869
    },
    "divsens up": {
     "cases": 531,
     "with_refusal": 26,
     "share": 0.04896421845574388,
     "events": 37,
     "below_L": 37,
     "above_U": 0,
     "dist_tol_p50": 0.000622049155474258,
     "dist_tol_max": 0.004416160280330118
    },
    "sweep 0.1": {
     "cases": 2500,
     "with_refusal": 145,
     "share": 0.058,
     "events": 195,
     "below_L": 195,
     "above_U": 0,
     "dist_tol_p50": 0.0005397651255401037,
     "dist_tol_max": 0.006413878880824451
    },
    "sweep 0.25": {
     "cases": 2500,
     "with_refusal": 140,
     "share": 0.056,
     "events": 187,
     "below_L": 187,
     "above_U": 0,
     "dist_tol_p50": 0.0005917962332426383,
     "dist_tol_max": 0.006413878880824451
    },
    "sweep 0.5": {
     "cases": 2500,
     "with_refusal": 136,
     "share": 0.0544,
     "events": 181,
     "below_L": 181,
     "above_U": 0,
     "dist_tol_p50": 0.0006122144417352233,
     "dist_tol_max": 0.006413878880824451
    }
   },
   "T1-near-boundary": {
    "tier2": {
     "cases": 1500,
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
     "cases": 213,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "divsens up": {
     "cases": 213,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.1": {
     "cases": 1500,
     "with_refusal": 7,
     "share": 0.004666666666666667,
     "events": 11,
     "below_L": 0,
     "above_U": 11,
     "dist_tol_p50": 7.310951843919611e-09,
     "dist_tol_max": 2.9440334169093175e-07
    },
    "sweep 0.25": {
     "cases": 1500,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "sweep 0.5": {
     "cases": 1500,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
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
     "cases": 59,
     "with_refusal": 0,
     "share": 0.0,
     "events": 0,
     "below_L": 0,
     "above_U": 0,
     "dist_tol_p50": null,
     "dist_tol_max": null
    },
    "divsens up": {
     "cases": 59,
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
    "within 5 tolerances of the exercise value": 234,
    "delta estimate above 2.5e-3": 3
   },
   "G2-dividends": {
    "a dividend falls within 5 days, where the lattice delta is not validated": 513,
    "within 5 tolerances of the exercise value": 54,
    "delta estimate above 2.5e-3": 1
   },
   "G3-carry-itm": {
    "within 5 tolerances of the exercise value": 229,
    "a dividend falls within 5 days, where the lattice delta is not validated": 728
   },
   "G4-negrate": {
    "within 5 tolerances of the 
```
