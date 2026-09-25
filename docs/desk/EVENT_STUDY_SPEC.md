# Desk · Conditional Event Study engine — spec of record

Branch: `desk/event-study`, cut from the current launch line. Backend only (analytics + FastAPI). Do not touch `web/`.
Same rules as every branch: investigate first, test before fix, a verifier that did not write the code, never push, `main` untouched, no secret in any file, the real database never written.

## 0. Investigate first, then stop for Max
Before writing code, report:
1. Where the regime classifier lives, what its inputs are, how it decides, how many states, and the exact function/table that yields a regime label for an arbitrary date. Quote the code path. Do not describe it as a "model" unless it is trained.
2. Where the recession probability comes from (own computation vs. a sourced FRED series).
3. Which of the series in §3 already exist in the pipeline and which need a config entry.
4. How forward-looking data is prevented today (as-of handling) so the engine reuses the same convention.
Wait for Max's reply before implementing.

## 1. Purpose
Answer "after a defined shock in asset A, while condition B holds, what did target T do over the next h sessions?" — scored against an unconditional baseline and split by regime. The first preset is the exact question John asked: gold ≥ +2σ (20d) while SPX is below its 50d MA.

## 2. Definitions
- **Shock**: asset A's trailing `w`-session move, expressed as a z-score against a rolling 252-session window of the same move. Event fires on the first session |z| ≥ threshold. `w` ∈ {5, 20, 60}; threshold ∈ {1.5, 2.0, 2.5}; sign selectable.
- **Shock unit per asset** (declared in config, never inferred): price series → log return; yields and spreads → change in basis points; VIX → log change.
- **Co-condition** (optional, AND): `SPX < 50d MA`, `SPX 20d return < 0`, `VIX > x`, `regime == R`, `HY OAS 20d change > x bp`. Evaluated on the event date using data through that date only.
- **Cooldown**: after an event, no new event for `w` sessions. State this in the output.
- **Forward return**: target T from close of event date to close `h` sessions later, h ∈ {5, 10, 20, 60}. Unit follows T's shock unit. Events without a full `h` window are excluded, not truncated.
- **Baseline**: T's `h`-session forward move on every session in the sample (same unit, same exclusions).
- **Regime split**: regime label at the event date from the classifier found in §0. Report each regime with N; suppress hit/median where N < 10 and say "n<10".

## 3. Assets
Default lists include only series with history to 1990 or earlier. Shorter series stay selectable with a `history_from` warning.
- Shock and co-condition assets: S&P 500 (^GSPC), Nasdaq 100 (^NDX), Russell 2000 (^RUT), Gold (FRED `GOLDPMGBD228NLBM`, LBMA PM fix; GC=F is the live quote only), WTI (FRED `DCOILWTICO`), Copper (HG=F, warn), 10Y (FRED `DGS10`), 2Y (`DGS2`), 2s10s (`T10Y2Y`), VIX (^VIX), DXY (DX-Y.NYB), USDJPY (JPY=X), HY OAS (FRED `BAMLH0A0HYM2`, warn: 1996), sector ETFs XLK…XLU (warn: 1998).
- Targets: S&P 500, Nasdaq 100, Gold, 10Y (bp), DXY, HY OAS (bp), VIX (log).
Both lists are generated from the pipeline config with `history_from` per series, not hard-coded in the UI.

## 4. Statistics
- Per horizon: N, hit rate (share of forward moves > 0; the UI relabels for a short read, the engine never flips signs), median, mean, p25/p75, baseline median, baseline hit rate, Δ = median − baseline median.
- The z-score is computed on the shock-unit series (log return, bp change, or log change per §2), using the mean and standard deviation of that series over the trailing 252 sessions ending on the event date.
- Bootstrap: 2,000 resamples of the event set for the 90% CI on Δ. Seeded, seed reported.
- Verdict text is generated from rules, not free-form: CI excludes zero at which horizons; strongest and weakest regime; any regime with N<10; sample start; cooldown. Vocabulary is limited to calibrated phrases ("modest", "concentrated in", "not distinguishable from baseline"). Never "predicts", "will", "proves", "model".

## 5. Correctness rules (the verifier checks each one)
- No look-ahead: z-score window, MAs, and co-conditions use data through the event date; forward window starts the next session.
- Cooldown dedupe applied; N reported after dedupe.
- Baseline and conditional use identical exclusions and units.
- Every response carries `as_of`, `sample_start`, `sample_end`, `n_events`, `cooldown`, `seed`, `inputs_hash`.
- The regime label is read from the classifier's stored output, never recomputed here (one number, one truth).

## 6. Second function: 50/200 cross significance
Golden and death crosses on SPX since data start. Same forward-return and baseline machinery, same regime split, same verdict rules. Expose as a second study type so S&P Internals can call it.

## 7. API
`GET /api/desk/event-study?shock=gold&w=20&z=2.0&sign=+&cond=spx_below_50dma&regime=all&target=spx`
Returns JSON with the §4 fields per horizon, the regime split, the last ten events (date, regime, forward moves), and the §5 provenance block. `GET /api/desk/event-study/assets` returns the §3 lists with `history_from` and `shock_unit`.
Studies are addressable by a stable slug (`gold-2sigma-spx-weak`) for permalinks.

**Planned field, not yet served (desk/frame-2 R-08 and R-13, scheduled for the frame-3 API work): `recent_events[].window_open`.** Shape: `{ "5": bool, "10": bool, "20": bool, "60": bool }`, one entry per horizon in `horizons[]`. Rule: `window_open[h]` is true only when the event's entry session plus h sessions, counted on the exchange (XNYS) calendar, lands after the **target series' own last available observation** (its last stored date, `provenance.as_of_by_series[target]`), not the study-wide `as_of` (the earliest last date across all inputs). A window whose exit session is on or before the target's last observation has elapsed: a missing endpoint there is a data gap, `window_open` is false, and the page reads "no observation". Either way the move stays out of that horizon's n. Until the engine serves it, the page prints every missing forward return as "no observation" and never "window open".

## 8. Verification deliverables
- A test that recomputes the preset's N, hit rate, and 20d median through an independent pandas path and asserts equality.
- A printout of the ten most recent preset events with dates and forward moves for Max to eyeball against Streamlit.
- A look-ahead test: shift the target series forward one day and confirm the results change (proves the window is aligned).
Report in `docs/desk/EVENT_STUDY_REPORT.md`. Stop. Wait for `PUSH OK desk/event-study`.
