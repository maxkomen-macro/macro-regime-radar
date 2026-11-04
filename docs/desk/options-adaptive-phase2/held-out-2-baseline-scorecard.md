# Options bench scorecard

- Engine: `72a56cc9ec57` (options_math.py sha256), `ee6f9dcf37be` (options_finder.py), commit ef7d784ff4f2eab120c5f42e7822afebe4d331f7
- Bench commit ef7d784ff4f2eab120c5f42e7822afebe4d331f7; seed 20261102; per group {'G0-exempt': 300, 'G1-nodiv': 2500, 'G2-dividends': 2500, 'G3-carry-itm': 2500, 'G4-negrate': 2500, 'G5-extreme-vol': 2500, 'G6-long': 2500, 'T1-near-boundary': 1500, 'X1-outside': 400}; shards 1
- Python 3.12.3, numpy 2.5.1, scipy 1.18.0, QuantLib None; 4 CPUs (Linux-6.18.44-fc-v230-x86_64-with-glibc2.39)
- Reference: bench FD (fd.py), GCI refinement study (reference.py); reliable when its uncertainty is at most 0.1 of the tolerance. Uncertainty is an estimate, not a proved bound.

## Price and delta by group

| Group | Cases | Served | Refused | Ref unresolved | Price pass / fail / indet. / unscored | Worst err (tol) | p99 err (tol) | 95% upper fail rate (indet. counted as fail) | Delta pass / fail / indet. / withheld / unscored | Worst delta err | Work p50 / max (M units) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| G0-exempt | 300 | 300 | 0 | 0 | 300 / 0 / 0 / 0 | 0.003 | 0.002 | 0.0099 | 300 / 0 / 0 / 0 / 0 | 7.84e-07 | 1.50e-04 / 1.50e-04 |
| G1-nodiv | 2500 | 2492 | 8 | 1 | 2491 / 0 / 0 / 1 | 0.308 | 0.048 | 0.0012 | 2257 / 0 / 0 / 235 / 0 | 0.00078 | 7.28e-02 / 50.6 |
| G2-dividends | 2500 | 2499 | 1 | 2 | 2497 / 0 / 0 / 2 | 0.833 | 0.305 | 0.0012 | 1904 / 0 / 0 / 594 / 1 | 0.00105 | 8.61e-02 / 50.3 |
| G3-carry-itm | 2500 | 2474 | 26 | 12 | 2470 / 0 / 0 / 4 | 0.720 | 0.124 | 0.0012 | 1514 / 0 / 0 / 960 / 0 | 0.00114 | 7.07e-02 / 21.7 |
| G4-negrate | 2500 | 2500 | 0 | 0 | 2500 / 0 / 0 / 0 | 0.431 | 0.136 | 0.0012 | 1991 / 0 / 0 / 509 / 0 | 0.00069 | 8.58e-02 / 9.9 |
| G5-extreme-vol | 2500 | 2363 | 137 | 12 | 2351 / 0 / 0 / 12 | 0.535 | 0.089 | 0.0013 | 1745 / 0 / 0 / 608 / 10 | 0.00096 | 6.77e-02 / 6.8 |
| G6-long | 2500 | 2486 | 14 | 18 | 2473 / 0 / 0 / 13 | 0.666 | 0.142 | 0.0012 | 2316 / 0 / 0 / 165 / 5 | 0.00089 | 3.0 / 51.8 |
| T1-near-boundary | 1500 | 1487 | 13 | 1 | 1486 / 0 / 0 / 1 | 0.468 | 0.198 | 0.0020 | 983 / 0 / 0 / 504 / 0 | 0.00075 | 6.99e-02 / 3.2 |
| X1-outside | 400 | 120 | 280 | 44 | 94 / 0 / 0 / 26 | 0.029 | 0.006 | 0.0314 | 37 / 0 / 0 / 71 / 12 | 1.09e-07 | 4.78e-03 / 9.41e-03 |
| named | 7 | 2 | 5 | 4 | 2 / 0 / 0 / 0 | 0.067 | 0.066 | n/a (not sampled) | 0 / 0 / 0 / 2 / 0 | – | 5.06e-03 / 1.2 |
| **random in-domain total** | 15300 | 15114 | 186 | 45 | 15082 / 0 / 0 / 32 | 0.833 | 0.176 | 0.0002 | 12027 / 0 / 0 / 3071 / 16 | 0.00114 | 8.94e-02 / 51.8 |

## Engine routes and refusals

- G0-exempt: served (black76-escrowed) 300
- G1-nodiv: refused:not-converged 8, served (american-bbsr-escrowed) 1858, served (black76-escrowed) 634
- G2-dividends: refused:not-converged 1, served (american-bbsr-escrowed) 1996, served (black76-escrowed) 503
- G3-carry-itm: refused:not-converged 26, served (american-bbsr-escrowed) 2474
- G4-negrate: served (american-bbsr-escrowed) 1976, served (black76-escrowed) 524
- G5-extreme-vol: refused:not-converged 137, served (american-bbsr-escrowed) 1702, served (black76-escrowed) 661
- G6-long: refused:not-converged 14, served (american-bbsr-escrowed) 2350, served (black76-escrowed) 136
- T1-near-boundary: refused:not-converged 13, served (american-bbsr-escrowed) 1487
- X1-outside: refused:domain 280, served (black76-escrowed) 120
- named: refused:domain 5, served (american-bbsr-escrowed) 2

## Named regressions (rerun on this engine)

| Case | Expected | Got | Regression | Engine value / delta | Reference value ± u | Reference delta ± u | Business-day shift (tol) |
|---|---|---|---|---|---|---|---|
| DR-48 | refused:domain | refused:domain | pass | – / – | 8.95765 ± 0.00127 (unresolved) | 0.72753 ± 0.00003 (reliable) | 0.03 |
| DR-47 | refused:domain | refused:domain | pass | – / – | 8.95765 ± 0.00127 (unresolved) | 0.72753 ± 0.00003 (reliable) | 0.03 |
| B9a | served:no-delta | served:no-delta | pass | 13.00040 / – | 13.00013 ± 0.00002 (reliable) | -0.99732 ± 4.45e-06 (reliable) | -0.01 |
| DR-50 | refused:domain | refused:domain | pass | – / – | 9.80877 ± 0.00197 (unresolved) | -0.97754 ± 0.00014 (reliable) | -2.88 |
| DR-49 | refused:domain | refused:domain | pass | – / – | 9.43135 ± 0.00194 (unresolved) | -0.97054 ± 0.00016 (reliable) | -4.14 |
| B8 | served:no-delta | served:no-delta | pass | 13.06778 / – | 13.06845 ± 0.00007 (reliable) | 0.90913 ± 0.00007 (reliable) | -3.98e-03 |
| B9b | refused:domain | refused:domain | pass | – / – | 5.03226 ± 0.00004 (reliable) | -0.90372 ± 0.00001 (reliable) | -2.88 |

## Reference controls

- European control (exercise off, against Black-76): 1727 cases, 1722 reliable, 1727 with the error inside the stated uncertainty (worst error 0.62 u, 0.0004 tol); delta inside its uncertainty on 1727.
- American references against QuantLib's high-precision QdFp engine (no dividends; an independent third method, its own error not estimated): 
- Early-exercise bound (bound-European route, served value European): G1-nodiv 634 checked: 235 covered, 0 violated, 0 indeterminate, 399 unscored; G2-dividends 373 checked: 173 covered, 0 violated, 0 indeterminate, 200 unscored; G4-negrate 524 checked: 233 covered, 0 violated, 0 indeterminate, 291 unscored; G5-extreme-vol 579 checked: 72 covered, 0 violated, 0 indeterminate, 507 unscored; G6-long 41 checked: 38 covered, 0 violated, 0 indeterminate, 3 unscored; X1-outside 71 checked: 23 covered, 0 violated, 0 indeterminate, 48 unscored.
- Exempt group, American reference against Black-76: 30 of 30 inside the stated uncertainty.

## Cross-checks (diagnostics, not references)

- G0-exempt: lattice (same code family) 300 compared, 0 disputed, max 0.003 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G1-nodiv: lattice (same code family) 2500 compared, 0 disputed, max 0.070 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G2-dividends: lattice (same code family) 2500 compared, 0 disputed, max 0.118 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G3-carry-itm: lattice (same code family) 2500 compared, 0 disputed, max 0.088 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G4-negrate: lattice (same code family) 2500 compared, 0 disputed, max 0.022 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G5-extreme-vol: lattice (same code family) 2500 compared, 0 disputed, max inf tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G6-long: lattice (same code family) 2500 compared, 0 disputed, max 0.131 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- T1-near-boundary: lattice (same code family) 1500 compared, 0 disputed, max 0.082 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- X1-outside: lattice (same code family) 400 compared, 0 disputed, max inf tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- named: lattice (same code family) 7 compared, 0 disputed, max 0.278 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol

## Implied volatility round trip (the Finder's solver on reference prices)

The engine's own American IV solve, started at sigma 0.3 as the Finder does, on the reference price of a served case; sigma error is |recovered − true| in absolute volatility; residual is the engine's value at the recovered sigma minus the reference price. Identifiable: one volatility point moves the engine's price by at least one tolerance; elsewhere the price barely depends on sigma and a large sigma error is expected.

- G0-exempt: 60 attempted, no-root 5, solved 55; identifiable 26: sigma error p50 1.55e-08, p99 0.000004, max 0.000005, max error × vega 0.001 tol; not identifiable: max sigma error 1.1434; residual max 9.05e-09 tol
- G1-nodiv: 500 attempted, solved 497, unpriceable 3; identifiable 240: sigma error p50 0.000003, p99 0.000041, max 0.000115, max error × vega 0.048 tol; not identifiable: max sigma error 3.9316; residual max 0.0240 tol
- G2-dividends: 499 attempted, solved 499; identifiable 321: sigma error p50 0.000006, p99 0.000962, max 0.100785, max error × vega 76.945 tol; not identifiable: max sigma error 2.7659; residual max 0.0010 tol
- G3-carry-itm: 496 attempted, solved 493, unpriceable 3; identifiable 167: sigma error p50 0.000009, p99 0.000454, max 0.001129, max error × vega 0.161 tol; not identifiable: max sigma error 3.1245; residual max 0.0010 tol
- G4-negrate: 500 attempted, solved 496, unpriceable 4; identifiable 262: sigma error p50 0.000002, p99 0.000278, max 0.060894, max error × vega 10.490 tol; not identifiable: max sigma error 0.8093; residual max 0.0010 tol
- G5-extreme-vol: 472 attempted, solved 472; identifiable 235: sigma error p50 0.000015, p99 0.000458, max 0.001862, max error × vega 0.535 tol; not identifiable: max sigma error 2.2471; residual max 0.0010 tol
- G6-long: 494 attempted, solved 491, unpriceable 3; identifiable 449: sigma error p50 7.97e-07, p99 0.000082, max 0.000578, max error × vega 0.353 tol; not identifiable: max sigma error 0.2898; residual max 0.0010 tol
- T1-near-boundary: 299 attempted, solved 297, unpriceable 2; identifiable 109: sigma error p50 0.000012, p99 0.000705, max 0.000798, max error × vega 0.221 tol; not identifiable: max sigma error 0.8288; residual max 0.1037 tol
- X1-outside: 24 attempted, no-root 5, solved 17, unpriceable 2; identifiable 6: sigma error p50 1.14e-07, p99 3.90e-07, max 3.93e-07, max error × vega 5.34e-05 tol; not identifiable: max sigma error 0.1417; residual max 7.68e-09 tol
- named: 2 attempted, solved 2; identifiable 1: sigma error p50 0.000036, p99 0.000036, max 0.000036, max error × vega 0.048 tol; not identifiable: max sigma error 0.0009; residual max 0.0002 tol

## Dividend sensitivity (provisional gate, decision 11)

Every owed dividend scaled by 1.1 and by 0.9: the engine's price change between the two must match the reference's within one price tolerance (the reference uncertainties of both states counted against it).

- G2-dividends: 834 attempted, pass 832, unscored 2; worst mismatch 0.880 tol; median reference move 7.64 tol
- G3-carry-itm: 400 attempted, pass 397, refused 3; worst mismatch 0.853 tol; median reference move 7.43 tol
- G4-negrate: 328 attempted, pass 328; worst mismatch 0.561 tol; median reference move 3.22 tol
- G5-extreme-vol: 414 attempted, pass 384, refused 28, unscored 2; worst mismatch 0.499 tol; median reference move 3.04 tol
- G6-long: 531 attempted, pass 522, refused 4, unscored 5; worst mismatch 0.513 tol; median reference move 51.40 tol
- T1-near-boundary: 213 attempted, pass 211, refused 2; worst mismatch 0.232 tol; median reference move 11.70 tol
- X1-outside: 59 attempted, pass 9, refused 50; worst mismatch 2.21e-04 tol; median reference move 1.92e-03 tol
- named: 5 attempted, pass 1, refused 4; worst mismatch 0.146 tol; median reference move 29.87 tol

## Exercise convention (reported separately from numerical error)

Continuous exercise (the default) against exercise only at NYSE closes from Monday 2026-10-26 and at expiry (a Bermudan approximation), same model and inputs. Shift = Bermudan − continuous, in price tolerances.

- G0-exempt: 28 compared (0 unresolved; 2 skipped, expiring past the holiday tables), |shift| p50 0.000, p95 7.52e-04, max 0.001 tol; 0 above 1 tol
- G1-nodiv: 201 compared (0 unresolved; 49 skipped, expiring past the holiday tables), |shift| p50 3.66e-14, p95 0.507, max 1.417 tol; 3 above 1 tol
- G2-dividends: 192 compared (0 unresolved; 58 skipped, expiring past the holiday tables), |shift| p50 0.005, p95 2.553, max 7.593 tol; 30 above 1 tol
- G3-carry-itm: 225 compared (1 unresolved; 24 skipped, expiring past the holiday tables), |shift| p50 0.061, p95 3.410, max 16.362 tol; 59 above 1 tol
- G4-negrate: 206 compared (0 unresolved; 44 skipped, expiring past the holiday tables), |shift| p50 7.87e-10, p95 0.507, max 9.502 tol; 6 above 1 tol
- G5-extreme-vol: 250 compared (0 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 1.76e-04, p95 1.625, max 7.599 tol; 18 above 1 tol
- G6-long: 0 compared (0 unresolved; 250 skipped, expiring past the holiday tables), |shift| p50 –, p95 –, max – tol; 0 above 1 tol
- T1-near-boundary: 150 compared (0 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 0.195, p95 6.011, max 13.785 tol; 51 above 1 tol
- X1-outside: 35 compared (5 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 7.93e-11, p95 0.896, max 5.309 tol; 1 above 1 tol
- named: 3 compared (4 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 0.013, p95 2.593, max 2.880 tol; 1 above 1 tol

## Acceptance for this phase (Phase 0 baseline)

**Verdict: not met** (open: G0-exempt below 1000 scored prices)

One component per criterion that binds now (the acceptance matrix's "binds from" column). The verdict is met only when every component passes; one failed component fails it, and otherwise one unresolved component leaves it unresolved.

| Component | Verdict | Evidence |
|---|---|---|
| Price accuracy (area 2, decision 10) | insufficient | 15082 scored in the random in-domain groups (at least 1000 per in-domain group: G0-exempt not met, G1-nodiv met, G2-dividends met, G3-carry-itm met, G4-negrate met, G5-extreme-vol met, G6-long met, T1-near-boundary met; at least 10000 overall: met); 0 failures and 0 indeterminate in any group |
| Displayed delta (area 4) | pass | at least 300 scored per in-domain group: G0-exempt met, G1-nodiv met, G2-dividends met, G3-carry-itm met, G4-negrate met, G5-extreme-vol met, G6-long met, T1-near-boundary met; 0 failures and 0 indeterminate among deltas shown, any group |
| Early-exercise bound (bound-European route) | pass | 2222 checked: 774 covered, 0 violated, 0 indeterminate, 1448 unscored (an interval across a bound the reference is too coarse to judge, or an unresolved reference); passing needs covered cases |
| Dividend scenario (area 5) | pass | 2674 scored in domain (at least 300: met); all groups: pass 2684, refused 91, unscored 9 |
| Reference controls (area 1) | pass | 1727 European controls and 30 exempt cases; outside their uncertainty: european_value 0, european_delta 0, exempt_american 0; 0 lattice disputes; 0 QuantLib comparisons outside u (listed above for investigation, not gated) |
| Named regressions | pass | 7 of 7 present; failed: none; unresolved: none |
| Run integrity | pass | 17207 of 17207 cases; 0 crashes (any crash, diagnostics included, fails the run) |

- An indeterminate outcome (the reference's interval straddles the threshold) is unresolved: it is never a pass, and one is enough to hold its component unresolved. Unscored cases (the reference cannot judge them) are counted and shown, never used as evidence either way.
- Sample targets count the in-domain groups; a failure or an indeterminate outcome counts in any group, targeted, stress and named included.
- Displayed-delta availability (withholding an unvalidated delta is correct and is not an accuracy failure): G0-exempt shown for 300 of 300 served prices; G1-nodiv shown for 2257 of 2492 served prices; G2-dividends shown for 1905 of 2499 served prices; G3-carry-itm shown for 1514 of 2474 served prices; G4-negrate shown for 1991 of 2500 served prices; G5-extreme-vol shown for 1755 of 2363 served prices; G6-long shown for 2321 of 2486 served prices; T1-near-boundary shown for 983 of 1487 served prices; X1-outside shown for 49 of 120 served prices; named shown for 0 of 2 served prices.
- Clopper-Pearson limits assume independent draws from each group's sampling distribution, and are conditional on the reference resolving (unscored cases are counted, not in the rate). The table's limit counts every indeterminate outcome as a failure. They are not a claim about real chains or whole requests.
- Scored by score.py `43cb533b297d` (cases.py `fb42ab600748`), bench commit ef7d784ff4f2eab120c5f42e7822afebe4d331f7.

