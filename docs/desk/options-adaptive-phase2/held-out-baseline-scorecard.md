# Options bench scorecard

- Engine: `72a56cc9ec57` (options_math.py sha256), `ee6f9dcf37be` (options_finder.py), commit 2f7bf07f45686d6f5475e5e0ac0649b90da43735
- Bench commit 2f7bf07f45686d6f5475e5e0ac0649b90da43735; seed 20261029; per group {'G0-exempt': 300, 'G1-nodiv': 2500, 'G2-dividends': 2500, 'G3-carry-itm': 2500, 'G4-negrate': 2500, 'G5-extreme-vol': 2500, 'G6-long': 2500, 'T1-near-boundary': 1500, 'X1-outside': 400}; shards 1
- Python 3.12.3, numpy 2.5.1, scipy 1.18.0, QuantLib None; 4 CPUs (Linux-6.18.44-fc-v185-x86_64-with-glibc2.39)
- Reference: bench FD (fd.py), GCI refinement study (reference.py); reliable when its uncertainty is at most 0.1 of the tolerance. Uncertainty is an estimate, not a proved bound.

## Price and delta by group

| Group | Cases | Served | Refused | Ref unresolved | Price pass / fail / indet. / unscored | Worst err (tol) | p99 err (tol) | 95% upper fail rate (indet. counted as fail) | Delta pass / fail / indet. / withheld / unscored | Worst delta err | Work p50 / max (M units) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| G0-exempt | 300 | 300 | 0 | 0 | 300 / 0 / 0 / 0 | 0.007 | 0.004 | 0.0099 | 300 / 0 / 0 / 0 / 0 | 8.53e-07 | 1.50e-04 / 1.50e-04 |
| G1-nodiv | 2500 | 2490 | 10 | 0 | 2490 / 0 / 0 / 0 | 0.563 | 0.043 | 0.0012 | 2227 / 0 / 0 / 263 / 0 | 0.00143 | 7.20e-02 / 44.7 |
| G2-dividends | 2500 | 2495 | 5 | 7 | 2491 / 0 / 0 / 4 | 0.771 | 0.336 | 0.0012 | 1927 / 0 / 0 / 565 / 3 | 0.00105 | 8.43e-02 / 37.8 |
| G3-carry-itm | 2500 | 2475 | 25 | 17 | 2467 / 0 / 0 / 8 | 0.591 | 0.120 | 0.0012 | 1508 / 0 / 0 / 967 / 0 | 0.00091 | 7.04e-02 / 22.7 |
| G4-negrate | 2500 | 2500 | 0 | 1 | 2499 / 0 / 0 / 1 | 0.534 | 0.115 | 0.0012 | 1991 / 0 / 0 / 509 / 0 | 0.00103 | 8.07e-02 / 14.8 |
| G5-extreme-vol | 2500 | 2380 | 120 | 14 | 2366 / 0 / 0 / 14 | 0.383 | 0.071 | 0.0013 | 1796 / 0 / 0 / 575 / 9 | 0.00070 | 6.88e-02 / 6.6 |
| G6-long | 2500 | 2488 | 12 | 23 | 2468 / 0 / 0 / 20 | 0.379 | 0.144 | 0.0012 | 2314 / 0 / 0 / 171 / 3 | 0.00095 | 3.0 / 51.9 |
| T1-near-boundary | 1500 | 1484 | 16 | 4 | 1481 / 0 / 0 / 3 | 0.476 | 0.153 | 0.0020 | 989 / 0 / 0 / 495 / 0 | 0.00143 | 7.04e-02 / 3.7 |
| X1-outside | 400 | 101 | 299 | 46 | 71 / 0 / 0 / 30 | 0.006 | 0.002 | 0.0413 | 34 / 0 / 0 / 51 / 16 | 1.20e-07 | 4.99e-03 / 9.53e-03 |
| named | 7 | 2 | 5 | 4 | 2 / 0 / 0 / 0 | 0.067 | 0.066 | n/a (not sampled) | 0 / 0 / 0 / 2 / 0 | – | 5.06e-03 / 1.2 |
| **random in-domain total** | 15300 | 15128 | 172 | 62 | 15081 / 0 / 0 / 47 | 0.771 | 0.169 | 0.0002 | 12063 / 0 / 0 / 3050 / 15 | 0.00143 | 8.76e-02 / 51.9 |

## Engine routes and refusals

- G0-exempt: served (black76-escrowed) 300
- G1-nodiv: refused:not-converged 10, served (american-bbsr-escrowed) 1834, served (black76-escrowed) 656
- G2-dividends: refused:not-converged 5, served (american-bbsr-escrowed) 2021, served (black76-escrowed) 474
- G3-carry-itm: refused:not-converged 25, served (american-bbsr-escrowed) 2475
- G4-negrate: served (american-bbsr-escrowed) 1944, served (black76-escrowed) 556
- G5-extreme-vol: refused:not-converged 120, served (american-bbsr-escrowed) 1722, served (black76-escrowed) 658
- G6-long: refused:not-converged 12, served (american-bbsr-escrowed) 2363, served (black76-escrowed) 125
- T1-near-boundary: refused:not-converged 16, served (american-bbsr-escrowed) 1484
- X1-outside: refused:domain 299, served (black76-escrowed) 101
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

- European control (exercise off, against Black-76): 1727 cases, 1721 reliable, 1727 with the error inside the stated uncertainty (worst error 0.50 u, 0.0003 tol); delta inside its uncertainty on 1727.
- American references against QuantLib's high-precision QdFp engine (no dividends; an independent third method, its own error not estimated): 
- Early-exercise bound (bound-European route, served value European): G1-nodiv 656 checked: 225 covered, 0 violated, 0 indeterminate, 431 unscored; G2-dividends 362 checked: 161 covered, 0 violated, 0 indeterminate, 201 unscored; G4-negrate 556 checked: 251 covered, 0 violated, 0 indeterminate, 305 unscored; G5-extreme-vol 565 checked: 96 covered, 0 violated, 0 indeterminate, 469 unscored; G6-long 24 checked: 22 covered, 0 violated, 0 indeterminate, 2 unscored; X1-outside 51 checked: 16 covered, 0 violated, 0 indeterminate, 35 unscored.
- Exempt group, American reference against Black-76: 30 of 30 inside the stated uncertainty.

## Cross-checks (diagnostics, not references)

- G0-exempt: lattice (same code family) 300 compared, 0 disputed, max 0.007 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G1-nodiv: lattice (same code family) 2500 compared, 0 disputed, max 0.048 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G2-dividends: lattice (same code family) 2500 compared, 0 disputed, max 0.074 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G3-carry-itm: lattice (same code family) 2500 compared, 0 disputed, max 0.099 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G4-negrate: lattice (same code family) 2500 compared, 0 disputed, max 0.034 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G5-extreme-vol: lattice (same code family) 2500 compared, 0 disputed, max inf tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- G6-long: lattice (same code family) 2500 compared, 0 disputed, max 0.120 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- T1-near-boundary: lattice (same code family) 1500 compared, 1 disputed, max 0.229 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- X1-outside: lattice (same code family) 400 compared, 0 disputed, max inf tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol
- named: lattice (same code family) 7 compared, 0 disputed, max 0.278 tol; QuantLib 0 compared, 0 over 0.5 tol, max – tol

## Implied volatility round trip (the Finder's solver on reference prices)

The engine's own American IV solve, started at sigma 0.3 as the Finder does, on the reference price of a served case; sigma error is |recovered − true| in absolute volatility; residual is the engine's value at the recovered sigma minus the reference price. Identifiable: one volatility point moves the engine's price by at least one tolerance; elsewhere the price barely depends on sigma and a large sigma error is expected.

- G0-exempt: 60 attempted, no-root 7, solved 53; identifiable 30: sigma error p50 1.79e-08, p99 0.000001, max 0.000001, max error × vega 0.003 tol; not identifiable: max sigma error 0.2374; residual max 9.99e-09 tol
- G1-nodiv: 498 attempted, solved 497, unpriceable 1; identifiable 226: sigma error p50 0.000004, p99 0.000070, max 0.114284, max error × vega 13.631 tol; not identifiable: max sigma error 2.6810; residual max 0.0010 tol
- G2-dividends: 499 attempted, solved 499; identifiable 325: sigma error p50 0.000007, p99 0.000650, max 0.012557, max error × vega 2.995 tol; not identifiable: max sigma error 2.9104; residual max 0.0649 tol
- G3-carry-itm: 495 attempted, solved 492, unpriceable 3; identifiable 188: sigma error p50 0.000009, p99 0.000934, max 0.008735, max error × vega 1.353 tol; not identifiable: max sigma error 2.9898; residual max 0.0010 tol
- G4-negrate: 499 attempted, solved 497, unpriceable 2; identifiable 266: sigma error p50 0.000002, p99 0.000192, max 0.000821, max error × vega 0.502 tol; not identifiable: max sigma error 0.5035; residual max 0.0010 tol
- G5-extreme-vol: 478 attempted, no-root 1, solved 475, unpriceable 2; identifiable 247: sigma error p50 0.000012, p99 0.000315, max 0.041830, max error × vega 5.719 tol; not identifiable: max sigma error 1.7930; residual max 0.0057 tol
- G6-long: 493 attempted, solved 492, unpriceable 1; identifiable 440: sigma error p50 7.45e-07, p99 0.000051, max 0.004847, max error × vega 3.424 tol; not identifiable: max sigma error 0.5141; residual max 0.0010 tol
- T1-near-boundary: 297 attempted, solved 294, unpriceable 3; identifiable 110: sigma error p50 0.000015, p99 0.000669, max 0.000939, max error × vega 0.480 tol; not identifiable: max sigma error 0.7820; residual max 0.0009 tol
- X1-outside: 18 attempted, no-root 5, solved 12, unpriceable 1; identifiable 3: sigma error p50 8.12e-08, p99 1.92e-07, max 1.95e-07, max error × vega 4.09e-05 tol; not identifiable: max sigma error 0.0216; residual max 6.35e-09 tol
- named: 2 attempted, solved 2; identifiable 1: sigma error p50 0.000036, p99 0.000036, max 0.000036, max error × vega 0.048 tol; not identifiable: max sigma error 0.0009; residual max 0.0002 tol

## Dividend sensitivity (provisional gate, decision 11)

Every owed dividend scaled by 1.1 and by 0.9: the engine's price change between the two must match the reference's within one price tolerance (the reference uncertainties of both states counted against it).

- G2-dividends: 834 attempted, fail 1, indeterminate 1, pass 826, refused 2, unscored 4; worst mismatch 1.131 tol; median reference move 7.47 tol
- G3-carry-itm: 415 attempted, pass 408, refused 3, unscored 4; worst mismatch 0.808 tol; median reference move 8.62 tol
- G4-negrate: 325 attempted, pass 324, unscored 1; worst mismatch 0.620 tol; median reference move 2.70 tol
- G5-extreme-vol: 395 attempted, pass 377, refused 18; worst mismatch 0.741 tol; median reference move 2.74 tol
- G6-long: 566 attempted, pass 555, refused 4, unscored 7; worst mismatch 0.534 tol; median reference move 51.98 tol
- T1-near-boundary: 196 attempted, pass 195, refused 1; worst mismatch 0.634 tol; median reference move 17.35 tol
- X1-outside: 71 attempted, pass 12, refused 59; worst mismatch 0.002 tol; median reference move 0.02 tol
- named: 5 attempted, pass 1, refused 4; worst mismatch 0.146 tol; median reference move 29.87 tol

## Exercise convention (reported separately from numerical error)

Continuous exercise (the default) against exercise only at NYSE closes from Monday 2026-10-26 and at expiry (a Bermudan approximation), same model and inputs. Shift = Bermudan − continuous, in price tolerances.

- G0-exempt: 26 compared (0 unresolved; 4 skipped, expiring past the holiday tables), |shift| p50 0.000, p95 3.74e-04, max 4.77e-04 tol; 0 above 1 tol
- G1-nodiv: 216 compared (0 unresolved; 34 skipped, expiring past the holiday tables), |shift| p50 6.35e-22, p95 0.813, max 1.368 tol; 7 above 1 tol
- G2-dividends: 194 compared (0 unresolved; 56 skipped, expiring past the holiday tables), |shift| p50 0.052, p95 2.457, max 19.095 tol; 33 above 1 tol
- G3-carry-itm: 228 compared (1 unresolved; 21 skipped, expiring past the holiday tables), |shift| p50 0.145, p95 3.945, max 13.405 tol; 60 above 1 tol
- G4-negrate: 205 compared (0 unresolved; 45 skipped, expiring past the holiday tables), |shift| p50 1.35e-10, p95 0.886, max 2.376 tol; 7 above 1 tol
- G5-extreme-vol: 250 compared (0 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 7.20e-04, p95 0.785, max 23.509 tol; 11 above 1 tol
- G6-long: 0 compared (0 unresolved; 250 skipped, expiring past the holiday tables), |shift| p50 –, p95 –, max – tol; 0 above 1 tol
- T1-near-boundary: 150 compared (0 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 0.422, p95 6.848, max 11.601 tol; 62 above 1 tol
- X1-outside: 34 compared (6 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 3.70e-08, p95 6.274, max 15.480 tol; 5 above 1 tol
- named: 3 compared (4 unresolved; 0 skipped, expiring past the holiday tables), |shift| p50 0.013, p95 2.593, max 2.880 tol; 1 above 1 tol

## Acceptance for this phase (Phase 0 baseline)

**Verdict: failed** (open: G0-exempt below 1000 scored prices, 1 dividend-scenario failures, 1 dividend-scenario outcomes indeterminate, 1 lattice disputes to investigate)

One component per criterion that binds now (the acceptance matrix's "binds from" column). The verdict is met only when every component passes; one failed component fails it, and otherwise one unresolved component leaves it unresolved.

| Component | Verdict | Evidence |
|---|---|---|
| Price accuracy (area 2, decision 10) | insufficient | 15081 scored in the random in-domain groups (at least 1000 per in-domain group: G0-exempt not met, G1-nodiv met, G2-dividends met, G3-carry-itm met, G4-negrate met, G5-extreme-vol met, G6-long met, T1-near-boundary met; at least 10000 overall: met); 0 failures and 0 indeterminate in any group |
| Displayed delta (area 4) | pass | at least 300 scored per in-domain group: G0-exempt met, G1-nodiv met, G2-dividends met, G3-carry-itm met, G4-negrate met, G5-extreme-vol met, G6-long met, T1-near-boundary met; 0 failures and 0 indeterminate among deltas shown, any group |
| Early-exercise bound (bound-European route) | pass | 2214 checked: 771 covered, 0 violated, 0 indeterminate, 1443 unscored (an interval across a bound the reference is too coarse to judge, or an unresolved reference); passing needs covered cases |
| Dividend scenario (area 5) | fail | 2686 scored in domain (at least 300: met); all groups: fail 1, indeterminate 1, pass 2698, refused 91, unscored 16 |
| Reference controls (area 1) | unresolved | 1727 European controls and 30 exempt cases; outside their uncertainty: european_value 0, european_delta 0, exempt_american 0; 1 lattice disputes; 0 QuantLib comparisons outside u (listed above for investigation, not gated) |
| Named regressions | pass | 7 of 7 present; failed: none; unresolved: none |
| Run integrity | pass | 17207 of 17207 cases; 0 crashes (any crash, diagnostics included, fails the run) |

- An indeterminate outcome (the reference's interval straddles the threshold) is unresolved: it is never a pass, and one is enough to hold its component unresolved. Unscored cases (the reference cannot judge them) are counted and shown, never used as evidence either way.
- Sample targets count the in-domain groups; a failure or an indeterminate outcome counts in any group, targeted, stress and named included.
- Displayed-delta availability (withholding an unvalidated delta is correct and is not an accuracy failure): G0-exempt shown for 300 of 300 served prices; G1-nodiv shown for 2227 of 2490 served prices; G2-dividends shown for 1930 of 2495 served prices; G3-carry-itm shown for 1508 of 2475 served prices; G4-negrate shown for 1991 of 2500 served prices; G5-extreme-vol shown for 1805 of 2380 served prices; G6-long shown for 2317 of 2488 served prices; T1-near-boundary shown for 989 of 1484 served prices; X1-outside shown for 50 of 101 served prices; named shown for 0 of 2 served prices.
- Clopper-Pearson limits assume independent draws from each group's sampling distribution, and are conditional on the reference resolving (unscored cases are counted, not in the rate). The table's limit counts every indeterminate outcome as a failure. They are not a claim about real chains or whole requests.
- Scored by score.py `43cb533b297d` (cases.py `fb42ab600748`), bench commit 2f7bf07f45686d6f5475e5e0ac0649b90da43735.

