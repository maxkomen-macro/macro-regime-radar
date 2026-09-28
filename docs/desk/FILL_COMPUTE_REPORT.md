# Desk · fill-compute report

Branch `desk/fill-compute` (worktree `mrr-compute`), cut from main `4394e59`, 2026-09-27. Nothing is pushed,
merged or deployed.

The brief: fill the empty Desk cards with real values computed from data already in the store, fix two live bugs
(Regime's two cards read different labels; the VIX dated three sessions behind the S&P), verify the Macro tab's
month on the 10-year, then add MACD and monthly seasonality (items 9 and 10). One commit per item, the spec and
Build Notes kept in step, no invented number in a LIVE block.

## Commits

| # | sha | What |
|---|---|---|
| 0 | `788ff57` | web test: keep the `revokeObjectURL` stub until the download's timer fires (main's full vitest exited 1 on an uncaught TypeError; fixed first so the gates mean something) |
| 1 | `422c1d0` | RSI-14 on the S&P (Wilder), served by `/technicals`, the Momentum card live |
| 2 | `540d498` | RSI above 70 / below 30 as catalog studies scored by the engine |
| 3 | `a4aa0e0` | the VIX gap to the S&P's 21-day realized volatility, and the band word |
| 4 | `cc3c424` | what each regime has meant since 1996, and the last five changes |
| 5 | `6fadfea` | What would change it reads the same label as Where we are |
| 6 | `4deb01f` | the classifier line on Regime, and "First month in this regime" |
| 7 | `c4da724` | the VIX from ^GSPC's path, and stale judged by each input's publication cadence |
| 8 | `2077ca4` | the Macro tab's month on the 10-year and 2-year, checked against the raw FRED rows (verified; test only) |
| 9 | `26873cb` | MACD (12, 26, 9) on Technicals, symbol-agnostic in the shared technicals module |
| 10 | `6cbe2ab` | the S&P's seasonality by calendar month, symbol-agnostic in the shared technicals module |
| 11 | `cecea91` | the Data Pipeline names Regime as a reader of ^GSPC and ^VIX (a miss in item 4, found on the live shots) |
| 12 | `57dceb5` | item 7's follow-through: a store without ^VIX, and the tests that read VIXCLS (item 7's gate failures) |
| — | `a84842a` | CLAUDE.md, and the live shots of every card touched |
| — | `6d9c96b` | this report (first version) |
| R-02 | `c4f8e18` | Codex R-02: an RSI study's session is eligible only where both RSIs are defined |
| R-03 | `c3740df` | Codex R-03: each study input judged on its own calendar and tolerance before stale |
| R-01, R-04, R-07, R-08 | `3533882` | the regime table measured from when each regime was known; its sample and coverage apart; the VIX aligned and validated; change return statuses |
| R-08 | `8e0c070` | RSI visits: a window not complete yet and a missing close each have their own status |
| R-05, R-06 | `c198e1d` | published changes apart from upcoming prints, each release bound to its own month; the other axis a flip reads |
| — | `a9fde2d` | live shots after the Codex fixes, and CLAUDE.md |
| — | `9d6de74` | this report, with the findings table (round 1) |
| R-03 | `35c0095` | Codex round 2, R-03: freshness from each input's latest validated observation; a stale study never fires |
| R-09 | `d496891` | Codex round 2, R-09: the VIX's sessions due are every XNYS session of the governed months |
| — | this commit | this report, with the findings table updated for round 2 |

Commits 11 and 12 are fixes to items 4 and 7, kept as their own commits rather than rewriting history under
items 8–10. Their messages say what they fix.

## Rebase onto main (desk/fill-etf merged)

Codex round 3 returned PUSH OK on `d496891`. The branch was then rebased onto origin/main `dccd5bc` (Merge PR #9,
desk/fill-etf). The pre-rebase head is kept as the local branch `backup/fill-compute-pre-rebase` (`4679e16`).
Every sha above is pre-rebase; each maps to its rebased commit here:

| Before | After | Commit |
|---|---|---|
| `788ff57` | dropped (main keeps its own fix) | web test: keep the revokeObjectURL stub until the download's timer fires |
| `422c1d0` | `edfc74d` | desk fill 1: RSI-14 on the S&P (Wilder), served by /technicals, the Momentum card live |
| `540d498` | `5b6cd58` | desk fill 2: RSI above 70 / below 30 as catalog studies scored by the engine |
| `a4aa0e0` | `df40261` | desk fill 3: the VIX gap to the S&P's 21-day realized volatility and the band word |
| `cc3c424` | `40acf0d` | desk fill 4: what each regime has meant since 1996, and the last five changes |
| `6fadfea` | `53cc1ea` | desk fill 5: What would change it reads the same label as Where we are |
| `4deb01f` | `4fc915a` | desk fill 6: the classifier line on Regime, and "First month in this regime" |
| `c4da724` | `849f1a0` | desk fill 7: the VIX from ^GSPC's path, and stale judged by each input's publication cadence |
| `2077ca4` | `cdca566` | desk fill 8: the Macro tab's month on the 10-year and 2-year, checked against the raw FRED rows |
| `26873cb` | `127588c` | desk fill 9: MACD (12, 26, 9) on Technicals, symbol-agnostic in the shared technicals module |
| `6cbe2ab` | `672ded2` | desk fill 10: the S&P's seasonality by calendar month, symbol-agnostic in the shared technicals module |
| `cecea91` | `db79777` | desk fill 11: the Data Pipeline names Regime as a reader of ^GSPC and ^VIX |
| `57dceb5` | `c05eb33` | desk fill 12: item 7's follow-through, a store without ^VIX and the tests that read VIXCLS |
| `a84842a` | `9dd034c` | desk fill: CLAUDE.md, and the live shots of every card touched |
| `6d9c96b` | `a213d3d` | desk fill: the report (docs/desk/FILL_COMPUTE_REPORT.md) |
| `c4f8e18` | `df11ce5` | Codex R-02: an RSI study's session is eligible only where both RSIs are defined |
| `c3740df` | `eb183d4` | Codex R-03: each study input judged on its own calendar and tolerance before stale |
| `3533882` | `d037e77` | Codex R-01, R-04, R-07, R-08 (changes): the regime table measured from when each regime was known |
| `8e0c070` | `d3e9b5e` | Codex R-08 (RSI visits): a window not complete yet and a missing close each have their own status |
| `c198e1d` | `fbe48b8` | Codex R-05, R-06: published changes apart from upcoming prints, each release bound to its own month |
| `a9fde2d` | `4bf8acf` | desk fill: live shots after the Codex fixes, and CLAUDE.md |
| `9d6de74` | `0b5ef9f` | desk fill: the report, with the Codex findings table |
| `35c0095` | `69410af` | Codex R-03 (round 2): freshness from each input's latest validated observation; a stale study never fires |
| `d496891` | `b780415` | Codex R-09: the VIX's sessions due are every XNYS session of the governed months |
| `4679e16` | `dafc958` | desk fill: the report for Codex rounds 2 and 3, and CLAUDE.md |
| — | `777ccfe` | desk fill: rebase follow-through, desk/fill-etf's correlation list reads the VIX as ^VIX |
| — | this commit | the compare shots on the rebased tree, and this section |

**Conflicted files, and how each was resolved** (both sides' intent kept):
- **`web/src/screens/desk/event-study/EventStudyPage.test.tsx`**: both branches fixed the same `revokeObjectURL`
  timer leak. Main's version is kept, and my `788ff57` is dropped. It did not conflict textually (both fixes would
  have stacked), so it was dropped from the rebase's todo list.
- **`web/src/screens/desk/notes/scope.ts`** and **`docs/desk/DESK_FRAME3_SPEC.md` §1.0.1** (items 1–4, 9, 10, R-01):
  - The Live list has main's entries (sector leadership on Technicals; the Macro correlations; the Sectors line)
    and mine (RSI, MACD, seasonality; the VIX band and gap; what each regime has meant; the changes by effective
    month).
  - "Designed, not yet served" is main's list without the entries this branch made live (the VIX gap, the RSI
    signals, what each regime has meant).
  - The two copies are word for word, which BuildNotesPage.test holds.
- **`docs/desk/DESK_FRAME3_SPEC.md` §1.0** (items 1, 2): main's ETF rows (sector bars, stock–bond,
  correlations, Sectors, the matrix) and my RSI row and Ledger wording.
- **`docs/desk/BUILD_NOTES.md`** (items 1, 2, 4, 9, 10): the "What's live" paragraph is the union of both. "Not
  yet served" and "What I'd build next" are main's, without the RSI signals.
- **`web/src/fixtures/desk/PROVENANCE.md`** (most commits): merged row by row against each commit's base. The
  `technicals.json` row, changed on both sides, carries main's sectors note and my RSI, MACD and seasonality notes.
- **`web/src/fixtures/desk/technicals.json`** (items 1, 2, 9, 10, R-08): main's file (its live `sectors` block)
  with my fields added (`rsi*`, the allowlist's RSI rows, `macd`, `seasonality`, the RSI visits' statuses).
- **`web/src/fixtures/desk/study.json`** (R-03 round 2): main's file (its catalog-only `series`) plus
  `stale_inputs`.
- **`web/src/fixtures/desk/pipeline.json`** (item 11): main's file (its ETF groups), with the ^GSPC and ^VIX rows'
  `feeds` recomputed from the merged `tab_readers`.
- **`web/e2e/desk.spec.ts`** (items 1, 9, 10): the Technicals test now expects only the vol card awaiting; main's
  sector bars and my RSI, MACD and seasonality cards are served, and the title says so.
- **`web/src/screens/desk/technicals/TechnicalsPage.test.tsx`** (item 1): main's two sector tests kept; its old
  "RSI card is unavailable" test replaced by my RSI card test.
- **`web/src/screens/desk/technicals/TechnicalsPage.tsx`** (item 10): the format import takes both
  `leadershipGaps` (main) and `monthYear` (mine).
- **`api/desk_envelope.py`** (item 4): main's `MATRIX_REASON` kept, and my removal of `REGIME_STATS_REASON` kept.
- **`web/src/test/desk-variants.ts`** (item 4): my removal of `servedRegime` kept, with main's comment on
  `servedTechnicals`.
- **`src/market_data/asset_history.py`** (item 7): main now stores every registry series whose store is
  `asset_prices`, so it stores ^VIX once item 7 declares it. My `DESK_DAILY` list became redundant and was dropped.
  The docstring is main's, with ^VIX added to its list.
- **`api/desk_pipeline.py`** (items 7, 11): main's Macro and Sectors readers and `LEADERSHIP_SERIES`, plus my ^VIX
  on Overview and my Regime readers (^GSPC, ^VIX).
- **`tests/test_desk_v2_pipeline.py`** (item 11): main's `UNREAD_ETFS` assertion plus my Regime-feeds assertion.
- **`docs/desk/screens/compare/02-technicals*.png`, `10-data-pipeline*.png`** (binary): main's were kept during
  the rebase. Shots 01, 02, 03, 04, 05, 07 and 10 are retaken on the rebased tree in this commit.

**Found by the rebased tests, fixed in `777ccfe`:**
- desk/fill-etf's correlation list names the VIX as ^VIX: its quantity, the pipeline's `CORRELATION_SERIES`
  (the ^VIX row feeds Macro), the spec's rows, main's tests, `macro.json`'s VIX row (−0.75 to Sep 23, served on
  main's fixture store with this branch's ^VIX rows added) and MacroPage.test.
- The ETF items share one store, which now holds ^VIX, so each block names only its own series' providers.
- `tests/desk_vix.py` adds main's `volume` column before writing ^VIX to an older store.

## Codex review: DO NOT PUSH on `6d9c96b`, eight findings fixed; round 2, R-03 and R-09

Round 2 found R-01, R-02 and R-04 to R-08 fixed. Two findings were still blocking:
- R-03, not fixed in round 1: it judged each input by its newest raw row;
- R-09, new: the VIX's sessions due were counted over its own stored range.

Both are fixed below, each with a test from Codex's repro.

Each fix has a test built from Codex's repro. The repro fails on the code before the fix; this was checked for R-02
against the previous engine, and for the others the old value is asserted or named in the test.

| ID | Finding | Fix | Test |
|---|---|---|---|
| R-01 | Regime stats and change returns paired each label with its own calendar month, which traded before the label existed | `3533882`: each label over the month it governed (stamp + 2, the engine's K−2); each change dated by its effective month; the card says "measured from when each regime was known" | `tests/test_desk_v2_regime.py::test_codex_r01_each_label_is_measured_over_the_month_it_governed`, `::test_codex_r01_a_change_is_dated_by_the_month_it_took_effect`, `::test_the_stats_and_the_changes_on_the_audits_store`; web `RegimePage.test.tsx` (the table, the changes, the note) |
| R-02 | The RSI study's eligibility mask (events and baseline alike) required only the session's own RSI | `c4f8e18`: both the RSI at t and at t−1 | `tests/test_event_study.py::test_codex_r02_a_session_whose_preceding_rsi_is_undefined_is_neither_event_nor_baseline` (fails on the previous engine) |
| R-03 | One allowance per study (the most any input allows), so a FRED grace covered a stale S&P close. Round 2: inputs were judged by their newest raw row, so S&P closes of −1 looked current | `c3740df`: `inputs_behind` judges each input on its own calendar and tolerance. Round 2, `35c0095`: from each input's newest validated observation (`SignalTrace.inputs_last`, after alignment and validation); a stale study never reports firing (`firing_now` false); `/study` serves `stale_inputs` | `tests/test_desk_firing.py::test_codex_r03_a_fred_grace_never_covers_a_stale_exchange_close`, `::test_each_input_counts_on_its_own_calendar`; `tests/test_desk_v2_ledger.py::test_codex_r03_the_ledger_judges_each_input_on_its_own_calendar`. Round 2 repro (S&P Sep 23–25 = −1, HY OAS Sep 22 = 100, against Sep 25): `tests/test_desk_v2_study.py::test_codex_r03_round2_the_trace_carries_each_inputs_latest_validated_observation`, `::test_codex_r03_round2_the_route_reports_the_sp_stale_and_no_firing` (the route fails on `9d6de74`) |
| R-04 | The return sample and the VIX coverage were not shown apart from the month count; missing observations undisclosed | `3533882`: `spx_n`, `spx_pending`, `spx_missing`, `vix_days` of `vix_sessions`, served `totals`; columns S&P N and VIX DAYS and a note built from served numbers only | `::test_codex_r04_r07_the_vix_is_validated_aligned_and_its_coverage_served`; web `meantNote` and the table test |
| R-05 | The next release date (whatever it covered) sat beside a threshold or a print for another month | `c198e1d`: published rows (with their own prints) apart from upcoming prints; each release bound to its reference month (the first stored release in the month after it), with `released` | `::test_codex_r05_each_release_date_is_its_own_reference_months`, `::test_release_for_binds_a_reference_month_to_its_release_in_new_york_dates`, `::test_a_print_already_made_is_said_from_the_displayed_row`; web wording tests |
| R-06 | A projected flip held the other axis at the basis row's sign, even when the other series had printed that month the other way | `c198e1d`: `other` is published (the other series' own print) or assumed (said so on the card) | `::test_codex_r06_a_flip_uses_the_other_axis_already_published_for_that_month` (checked against the real classifier); web `otherWords` |
| R-07 | The VIX was averaged over raw stored rows | `3533882`: aligned on XNYS and validated (`align`, `validate_values`) before averaging; `vix_coverage` counts what was set aside (34 off-session rows in FRED's VIXCLS copy of the audit store, 2 in the ^VIX copy) | `::test_codex_r04_r07_the_vix_is_validated_aligned_and_its_coverage_served`, the audit-store test |
| R-09 | The VIX's sessions due were counted over the VIX's own stored range, so a partly covered month read as fully covered | `d496891`: `month_sessions` counts every XNYS session of each governed month whose window is complete; missing sessions stay in the denominator | Repro (a Feb 2026 Goldilocks label, the VIX only on Apr 15–16, reads 2 of 21): `tests/test_desk_v2_regime.py::test_codex_r09_the_vix_denominator_is_every_session_of_the_governed_months`; web `meantNote` ("VIX: 2 of 21 sessions stored.") |
| R-08 | "Window not complete yet" and "missing historical price" were one null, said as "month not over" / "20 sessions have not passed yet" | `3533882` (regime changes), `8e0c070` (RSI visits): `complete` / `pending` / `missing`, each with its own words | `::test_codex_r08_a_missing_close_is_not_a_window_still_open`; `tests/test_desk_v2_technicals.py::test_codex_r08_an_rsi_visits_missing_close_is_not_a_window_still_open`; web status tests on both cards |

What changed on screen (audit store, and the live store the same):
- **The regime table.** Goldilocks' S&P median moves from +0.7% (its own months) to +1.2%, and its VIX from 18.0
  to 16.9, over 26 complete governed months of 27 labels.
- **The last five changes.** They are now dated Oct 2026, Sep 2026, Mar 2026, Nov 2025 and Aug 2025; the two
  newest are pending.
- **What would change it.** It says "Already published: the Aug 2026 row reads Overheating …" and then the
  September prints: CPI's own release on Oct 14, a −0.39% m/m threshold, "Assumes growth stays rising; the Sep
  2026 INDPRO print is not out yet."

Where the tree changed: FRAME3_DATA_AUDIT.md §2.4's method ("every stored row, as stamped, no K−2 lag") is
superseded by R-01, and the spec says so. The audit's Q8 (27 / 213 / 102 / 21 labels) and Q9 (123 changes) still
hold as counts.

## What each item serves

The values below are from a local API on the published store (`data-latest`, synced 2026-09-27) with ^VIX added
the way the full refresh adds it (§ Live verification). Where the fixtures use the audit's store, PROVENANCE.md says
so.

1. **RSI.** A shared, symbol-agnostic module, `src/analytics/technicals.py`, was created; none existed to extend
   (checked `src/analytics`, `api/`, `dashboard/`, `web/src`). `rsi()` is Wilder's RSI(14) on §12.13's rule. The
   Momentum card shows NOW 56.7 on Sep 25 (neutral, rising from 53.5), LAST ABOVE 70 Jun 2 (S&P −1.7% 20 sessions
   later), LAST BELOW 30 Mar 30 (+12.5%), and the 0/30/70/100 gauge. Checked against an independent Wilder
   transcription (56.686 on Sep 25).
2. **RSI studies.** The engine's `kind` `rsi` is a strict crossing of 70 or 30 after a defined session outside the
   zone, with a 14-session cooldown and every other rule shared with the S&P studies. It reuses the Query's `cross`
   field, so no existing study's parameters, payload or `inputs_hash` change. Results: RSI > 70 fired 89 times,
   RSI < 30 fired 45 times, both No edge at a month. The Ledger scores all 12 rows on the live store (on the audit
   store, WTI and DXY stay unavailable because that store lacks them). The rows' client labels are drafted and
   await the owner's approval.
3. **VIX gap and band.** `technicals.realized_vol` is 100 × √252 × the sample stdev of 21 daily log returns. The
   tile reads "VIX 14.9 · Sep 25 · calm" and "4.1 pts above 21-day realized (10.8)". The band edges are the home
   page's own: calm below 15, subdued to 25, stressed above. The phrase "realized-volatility method not specified"
   is gone. Realized vol cross-checked by SQL (10.3923 on Sep 22).
4. **What each regime has meant, and the last five changes.** Built on FRAME3_DATA_AUDIT.md §2.4's method: every
   stored row as stamped, each with its own calendar month.
   - Months: 27 / 213 / 102 / 21.
   - S&P median and mean month, and the share of months up.
   - VIX average: 18.0 / 19.5 / 20.1 / 30.0.
   - Changes: 123; the last five newest first, each with the S&P over the following month ("month not over" for
     Aug 2026).

   Checked by SQL: Aug 2026 +2.6225%, and the Goldilocks VIX average 18.0075 over 564 days on the audit store.
   Superseded by Codex R-01, R-04, R-07 and R-08: each label is now measured over the month it governed, with its
   own sample and coverage (§ Codex review).
5. **One label.** The next prints are read from the K−2 row that Where we are shows (`next_prints.basis`), not
   from the newest row. The August prints are already stored, so the card says so: "Already printed: the Aug 2026
   row reads Overheating, the label from Oct 2026". Each print reports its move ("the Aug 2026 print (+0.40% m/m)
   flipped inflation to rising") instead of a threshold for a different row. A test checks that the flip text
   matches the displayed label for all four regimes, on the route against the real classifier and in the
   rendered card. Codex R-05 and R-06 then separated the published August row from the upcoming September prints,
   each bound to its own release, with the other axis said as published or assumed (§ Codex review).
6. **Classifier line.** Under the lede: "The home page's classifier puts Overheating at 42% for the Aug 2026 row;
   this tab's rule-based label is Goldilocks for the Jul 2026 row, the one governing today. They disagree this
   month." The word is "classifier". When that label is Recession Risk its odds are served null, because the Desk
   never shows `regimes.prob_recession`. "First month in a row" now reads "First month in this regime".
7. **VIX ingest and per-series staleness.**
   - The registry's `vix` is `^VIX` in `asset_prices`, stored from 1990 by the allocation refresh beside ^GSPC
     (`asset_history.DESK_DAILY`: EODHD first where a token exists, else Yahoo, disclosed). It replaces FRED's
     VIXCLS, which FRED publishes a day or more after the close.
   - Yahoo's ^VIX matches VIXCLS within 0.01 on 9,236 of 9,247 common sessions. On the live store the VIX and the
     S&P now both read Sep 25.
   - `api/freshness.DAILY_TOLERANCE` is 3: a FRED daily series 1–3 business days behind is current.
   - Studies are judged stale per study by `publication_allowance`: 0 sessions for exchange closes, 3 for FRED
     daily, 8 for weekly WTI. A study dated after the comparison session stays stale (commit 12).
   - On the live store the HY row (evaluated Sep 24) and the oil row (Sep 22) are current. The data status is
     current across all seven contributors.
8. **The 10-year and 2-year month.** Verified correct, nothing to fix (§ Item 8).
9. **MACD.**
   - Symbol-agnostic functions: `technicals.ema` (SMA-seeded; a missing close breaks the run), `macd(close)`
     returning line, signal and histogram, and `macd_crossings(hist)` (strict; a zero keeps the side; a gap
     resets it).
   - On Sep 25: MACD +18.8, signal +10.7, histogram +8.1, last crossover above its signal on Sep 21.
   - Matches pandas `ewm(adjust=False)` to 5e-12 over the last 500 sessions on both stores.
   - The card draws the histogram as green/red bars from zero, the line in blue and the signal in dashed gray. The
     chart kit gains `bars`.
10. **Seasonality.**
    - Symbol-agnostic functions: `technicals.monthly_returns` and `monthly_seasonality`, over every stored close,
      on the XNYS calendar through month end, so an unfinished month never counts.
    - Coverage: Feb 1990 to Aug 2026, 439 months, 36–37 years a month. The best month is Nov (+2.2%, up 75% of
      years); the worst is Sep (−0.7%, 50%).
    - Equal to a plain month-end resample of the stored closes.
    - The regime table's month returns now call the same function (one copy); its 439 returns are identical and
      the regime fixture is unchanged.
    - The card is a 12-row table (average, a zero-centered bar, share up, years with their span in a tooltip)
      with the window stated in the sub-line.

For every block: §1.0 is flipped to LIVE and §12 carries the fields, the "Not yet served" paths and the illustrative
fixture (`deferred-regime.json`) are gone, API and web tests are added, and the compare shots and Build Notes (both
lists and the prose) are updated.

## Item 8: the dates

On the published store (the same values the deployed API serves), the curve compares the last common observation,
2026-09-24, with the last observation on or before it less one calendar month, 2026-08-24 (Aug 22 and 23 are a
weekend).

| Series | 2026-08-24 | 2026-09-24 | Move |
|---|---|---|---|
| DGS10 | 4.70 | 5.18 | +48 bp (the tab's +48.0) |
| DGS2 | 4.24 | 4.87 | +63 bp |
| 2s10s | 46 bp | 31 bp | −15 bp (so the 2-year moved 48 + 15 = 63) |

The live API served 47.99999999999996 and −15.000000000000039. `tests/test_desk_v2_macro.py` pins the curve's
dates and moves on those raw rows.

## Live verification

Two local APIs from HEAD's tree (no fixtures), with the web app proxied to each (`VITE_PROXY_TARGET`), relay off:

- **:8100**, the published store plus ^VIX. This is `data-latest` synced 2026-09-27 with ^VIX fetched through the
  refresh's own path (`api/providers/market.daily_history`, Yahoo, 9,253 rows through Sep 25), which is what the
  first full refresh after merge stores. Shots 01–11.
- **:8101**, the published store as it is, which is the deployed state until that refresh. Shots 20-*.

`https://macro-economic-radar-api.onrender.com` serves none of the new fields yet (it runs main). It was used only
to read the served curve for item 8.

Shots: `docs/desk/shots/desk-fill-compute/`.

| Card | State | Evidence |
|---|---|---|
| Technicals · Momentum · RSI (R-08: each visit's status) | LIVE-verified | `02-technicals-rsi.png` (retaken at `c198e1d`): 56.7 on Sep 25, Jun 2, Mar 30, both 20-session returns complete |
| Technicals · Signals (the two RSI rows) | LIVE-verified | `02-technicals-signals.png`: 89× and 45×, No edge |
| Technicals · Momentum · MACD | LIVE-verified | `02-technicals-macd.png`: +18.8 / +10.7 / +8.1, crossover Sep 21 |
| Technicals · Seasonality | LIVE-verified | `02-technicals-seasonality.png`: Feb 1990 to Aug 2026 |
| Event Study · RSI above 70 / below 30 | LIVE-verified | `03-event-study-rsi-*.png`: 89 events, No edge at 1 month |
| Signal Ledger · RSI rows, the NOW / stale column (R-03: each input on its own calendar) | LIVE-verified | `07-signal-ledger-page.png` (retaken at `c198e1d`): 12 scored, every row Quiet, none stale |
| Overview · Vol · VIX (band, gap, date) | LIVE-verified | `01-overview-vol-vix.png`: 14.9, Sep 25, calm, +4.1 over 10.8 |
| Overview · Active signals (RSI rows among them) | LIVE-verified | `01-overview-active-signals.png` |
| Overview · since last close, data status | LIVE-verified | `01-overview-page.png`: vol down 0.8 pts; seven contributors current |
| Regime · Where we are (classifier line, "in this regime") | LIVE-verified | `04-regime-where-we-are.png` |
| Regime · What would change it (one label; published rows apart from upcoming prints, R-05, R-06; changes by effective month, R-01, R-08) | LIVE-verified | `04-regime-what-would-change-it.png` (retaken at `c198e1d`): the Aug row published, the Sep CPI print on Oct 14 at −0.39% m/m, growth assumed |
| Regime · What each regime has meant (R-01, R-04, R-07) | LIVE-verified | `04-regime-what-each-regime-has-meant.png` (retaken at `c198e1d`): 26 / 212 / 102 / 21 complete governed months; VIX 7,568 of 7,568 sessions, 2 rows set aside |
| Macro · Yield curve (item 8, no code change) | LIVE-verified | `05-macro-yield-curve.png`: +48.0 bp, −15.0 bp |
| Data Pipeline · inventory (^VIX row, its feeds) | LIVE-verified | `10-data-pipeline-inventory.png` |
| Build Notes · Live list | LIVE-verified | `11-build-notes-live-list.png` (authored text, §1.0.1 word for word) |

No card is PROTOTYPE: none of the touched cards carries an illustrative value. No card is FAILED.

On the published store as it is (shots `20-*`), the three VIX readers wait for the next full refresh and say so:

- the vol tile: "VIX (^VIX) is awaiting the next full refresh: this database has no ^VIX rows in asset_prices yet.";
- the Ledger's VIX row: the same words, 11 scored and 1 not yet served;
- the regime table: its S&P columns are served and its VIX column is "—".

That is the designed state for one refresh cycle after merge, not a fixture dependency: the live :8100 run is
that store after the refresh.

## Decisions, and where the tree won

- **No shared technicals function existed** (item 1: "if one exists"). `src/analytics/technicals.py` is new. It
  holds every indicator this branch computes, and desk/usability can import `rsi`, `macd`, `macd_crossings`,
  `realized_vol`, `monthly_returns` and `monthly_seasonality` for any symbol's closes.
- **Item 5 overrides item 14's ruling** (FRAME3: the next prints read the newest row). The owner's brief makes both
  cards read one label, so the ruling is superseded and the spec says so.
- **The RSI studies reuse `Query.cross`** instead of adding a field, so every existing study's hash is unchanged.
  The RSI's own parameters enter only an RSI study's `inputs_hash`.
- **The VIX source**: "same source and path as ^GSPC if that works" works. The Desk's stored VIXCLS rows are kept
  (never deleted) but no longer refreshed or read.
- **The regression gate after the VIX move.** Layer 1 (traced equals untraced) is green.
  - **Layer 2**: the golden was written by the base, whose registry reads VIXCLS. Layer 2 runs HEAD's engine with
    the base's registry entry (`BASE_VIX`) and still proves the engine unchanged. A new test proves that on
    identical values the move changes only the VIX's identity: series id, table, note and the hash over them.
  - **Layer 3** (`scripts/desk_native_ab.py --base origin/main`) is byte-identical on 15 of 16, on the audit copy
    and on hardening's scratch store, with and without ^VIX. The 16th is `vix-w5-z2.0-up-none-spx`:
    - without ^VIX, HEAD answers NotStored (awaiting the refresh);
    - with ^VIX, the first difference is `/provenance/inputs[1]/note`, the identity that layer 2's test bounds.

  This is the one expected exception, and it is recorded here.
- **No bond column in the regime table.** PNG 04 draws STOCK–BOND there, but no bond price series is stored (§6),
  so the table shows S&P MEAN instead.
- **The classifier's odds are null for Recession Risk.** The Desk never shows `regimes.prob_recession`
  (CLAUDE.md).
- **§1.5's "no normal month" e2e check** now leaves the seasonality card out: May's own average prints "+1.3%", a
  calendar month's average over its own years, not the universal normal month the check forbids.
- **Stale for a study dated after the comparison session** (a clock behind the data) stays true whatever the
  allowance. Item 7 had dropped that case; commit 12 restores it.

## Found after the item commits

- **Commit 11.** The Data Pipeline derives each series' FEEDS from the tabs' readers, but Regime did not list the
  S&P and the VIX that item 4's tables read. Found on the live pipeline shot and fixed.
- **Commit 12.** Item 7's related-pytest gate failed 19 tests that still read the VIX as FRED's VIXCLS, and
  surfaced three behaviors:
  - The regime table awaited whole on a store without ^VIX, though the changes read only the S&P. Now the S&P
    columns serve and `vix_avg` is null.
  - The vol tile gave the generic reason. It now gives the engine's words.
  - The later-session stale case above.

  The tests were rewritten to the new facts. `tests/desk_vix.py` gives a store copy the ^VIX close the refresh
  stores (from that copy's own VIXCLS rows), so the audit store's VIX numbers stay pinned (Q8: 18.0 over 564 days).

## Gates

The policy changed mid-run (owner, 2026-09-27 evening):

- Items 0–6 ran the full gates.
- From item 7 on, each commit ran tsc, vitest `--maxWorkers=2` (with `--minWorkers=1`, which vitest 2.1.9 requires
  alongside it), build, and the related pytest files plus `tests/test_desk*`.
- One full pytest and one full Desk e2e ran at the final head, under `/tmp/mrr-full-gates.lock`.

Every gate ran on a `git archive` snapshot with the audit copy as `data/macro_radar.db` and hardening's
`desk_scratch.db`. `tests/test_streamlit_backports.py` is excluded throughout, because the API venv has no
Streamlit.

| Commit | pytest | tsc · vitest · build | Desk e2e |
|---|---|---|---|
| main `4394e59` (baseline) | 1587 passed, 3 failed (2 known asset_history, 1 assistant timing) | vitest 1 failed (the TypeError commit 0 fixes) | — |
| 1 `422c1d0` | 1595 passed, 2 failed (known) | ✓ · 1537 · ✓ | 54/54 |
| 2 `540d498` | 1604 passed, 2 failed (known) | ✓ · 2 load timeouts (see below) · ✓ | 52/54 under load; the 2 pass alone; full rerun 54/54 |
| 3 `a4aa0e0` | 1608 passed, 5 failed (2 known, 3 timing, see below) | ✓ · 1538 · ✓ | 54/54 |
| 4 `cc3c424` | 1608 passed, 7 failed, 1 error (2 known, timing, see below) | ✓ · 1538 · ✓ | 54/54 |
| 5 `6fadfea` | full run stopped at the policy change | ✓ · 1543 · ✓ | 54/54 |
| 6 `4deb01f` | full run stopped at the policy change | ✓ · 9 load timeouts · ✓ | 54/54 |
| 7 `c4da724` | related: 857 passed, 24 failed: 19 item 7 regressions (fixed in 12), 2 known, 3 timing | ✓ · 1545 · ✓ | targeted |
| 8 `2077ca4` | test only; its file ran in item 9's run | (tree as item 7's) | — |
| 9 `26873cb` | related: 686 passed, 22 failed: the same 19 + 3 timing, nothing new | ✓ · 1549 · ✓ | targeted Technicals 4/4 |
| 10 `6cbe2ab` | targeted technicals, regime and contract files green; the rest at the final run | ✓ · 1551 · ✓ | targeted 8/8 |
| 11 `cecea91` | pipeline 39 passed (+1 audit-sha skip); web pipeline 13 | — | — |
| 12 `57dceb5` | the 19 and every affected file: all green (143 + 2) | ✓ · 1552 · ✓ | — |
| R-02 `c4f8e18` | related (event study, native regression, study, ledger, technicals): 233 passed | no web change (web tree as `6d9c96b`'s) | — |
| R-03 `c3740df` | related (firing, ledger, study, overview, events, contract): 257 passed | no web change | — |
| R-01/04/07/08 `3533882` | related (regime, contract, overview, technicals, fixture): 206 passed | ✓ · 1554 · ✓ | targeted Regime 5/5 |
| R-08 `8e0c070` | related (technicals, contract, fixture): 116 passed | ✓ · 1555 · ✓ | — |
| R-05/06 `c198e1d` | related (regime, contract, overview, fixture): 169 passed | ✓ · 1557 · ✓ | targeted Regime and Technicals 8/8 |
| R-03 round 2 `35c0095` | related (study, firing, ledger, native regression, event study, contract, overview): 346 passed | ✓ · 1557 · ✓ | — |
| R-09 `d496891` | related (regime, contract, fixture): 124 passed | ✓ · 1557 · ✓ | — |

### Final gates at the head

Codex round 3 (on `d496891`): R-03 and R-09 fixed, PUSH OK. At the owner's word, the queued gates at `d496891` were
cancelled before they took the lock, and the branch was rebased onto origin/main, where desk/fill-etf is merged
(§ Rebase onto main). The gates run once at the head this section is committed in:
- tsc, vitest (`--maxWorkers=2 --minWorkers=1`) and build;
- the full pytest and the full Desk e2e, under `/tmp/mrr-full-gates.lock`.

Their results are in the handoff for this head. Before the follow-through, the rebased tree's Desk and related
suites ran: 897 passed, with 8 failures. The 2 are the known `test_asset_history` failures; the other 6 were fixed
in `777ccfe`, whose affected suites then passed (308). Vitest passed at 1562.

### Final gates after round 1

Run at `a9fde2d`, the last commit before the round-1 report (that commit added only the report), under
`/tmp/mrr-full-gates.lock`. The lock was taken at 21:51 EDT with no wait, held for 13 minutes, and released on exit.

- **Build:** exit 0.
- **Full pytest** (no parallel workers, `tests/test_streamlit_backports.py` excluded): **1659 passed, 2 failed** in
  10 min 33 s. The two failures are the brief's known `test_asset_history` DB-copy tests; the timing tests passed
  at load average about 9.
- **Full Desk Playwright e2e** (`e2e/desk.spec.ts --workers=1`, against `DESK_FIXTURES=1 vite` from the same
  snapshot): **54 passed** in 2.1 min.

### Final gates at the first report's head (before the Codex review)

Run at `a84842a` (the last code commit then; that report's commit added only the report), under
`/tmp/mrr-full-gates.lock`. The script waited 42 min for the lock (19:58–20:40 EDT), held it 20:40–20:54, and
released it on exit.

- **Build:** exit 0.
- **Full pytest** (no parallel workers, `tests/test_streamlit_backports.py` excluded): **1649 passed, 2 failed** in
  11 min 32 s. The two failures are the brief's known `test_asset_history` DB-copy tests. The load-sensitive timing
  tests below all passed in this run (load average about 10).
- **Full Desk Playwright e2e** (`e2e/desk.spec.ts --workers=1`, against `DESK_FIXTURES=1 vite` from the same
  snapshot): **54 passed** in 2.0 min.

### Tests that fail under load, and alone

These failures come from machine load (four to five sessions ran suites in parallel; load average 13–23), not from
this branch. Each was run alone at HEAD, and where it still failed, alone on the untouched base.

| Test | Under load | Alone at HEAD (load 13–15) | Alone on base `4394e59` | Final full run (load ~10) |
|---|---|---|---|---|
| `test_asset_history.py::test_without_the_table_…`, `::test_validate_requires_the_table_…` | fail | fail | fail (the brief's two known DB-copy failures) | fail (known) |
| `test_desk_api.py::test_the_query_tool_stops_a_cross_join_within_300_ms…` | fail (2.88 s) | fail (budget) | fail (0.312 s against 0.3) | pass |
| `test_desk_api.py::test_the_assistants_sql_runs_on_a_private_copy…` | fail | fail | fail (25 ms against 20) | pass |
| `test_desk_api.py::test_a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms` | fail | fail | fail (26 ms against 20) | pass |
| `test_generations.py` (hold / revert / freed with the heap frozen) | fail | pass | fails 2 of 5 under load on base | pass |
| `test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently` | fail | pass | — | pass |
| `test_desk_api.py::test_a_job_whose_generation_expired_…` (an error in item 4's run) | error | pass | — | pass |
| vitest `findBy` timeouts (item 2: 2; item 6: 9, across unrelated tabs) | fail | pass (the next full vitest runs, 1538–1552, are green) | — | not in the final run; commit 12's vitest at the same web tree: 1552/1552 |
| e2e item 2 (the Technicals badge, the Ledger header) | 16 s timeouts | pass | — | pass (54/54) |

## For the owner

- The RSI rows' client labels ("The S&P's 14-day momentum gauge (RSI) climbs above 70" / "drops below 30") are
  drafted and await your approval.
- The deployed store has no ^VIX until the first full refresh after merge. Until then the VIX tile, the VIX study
  and the regime table's VIX column say they are awaiting it; the rest is live.
- `api/freshness.DAILY_TOLERANCE` went from 2 to 3 for every FRED daily verdict (the drawer's included), as the
  brief asked ("1–3 business days behind is current").

## Reproduce the live run

```
git archive HEAD | tar -x -C <dir>; cp <data-latest copy> <dir>/data/macro_radar.db
#   plus ^VIX: api/providers/market.daily_history("^VIX", allow_yahoo=True) through asset_history.write_series
cd <dir> && EODHD_API_TOKEN=" " EODHD_PROBE_ON_START=0 python -m uvicorn api.main:app --port 8100
cd web && VITE_PROXY_TARGET=http://127.0.0.1:8100 npx vite --port 5294
```
