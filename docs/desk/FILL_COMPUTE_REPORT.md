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
| — | this commit | this report |

Commits 11 and 12 are fixes to items 4 and 7, kept as their own commits rather than rewriting history under
items 8–10. Their messages say what they fix.

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
5. **One label.** The next prints are read from the K−2 row that Where we are shows (`next_prints.basis`), not
   from the newest row. The August prints are already stored, so the card says so: "Already printed: the Aug 2026
   row reads Overheating, the label from Oct 2026". Each print reports its move ("the Aug 2026 print (+0.40% m/m)
   flipped inflation to rising") instead of a threshold for a different row. A test checks that the flip text
   matches the displayed label for all four regimes, on the route against the real classifier and in the
   rendered card.
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
| Technicals · Momentum · RSI | LIVE-verified | `02-technicals-rsi.png`: 56.7 on Sep 25, Jun 2, Mar 30 |
| Technicals · Signals (the two RSI rows) | LIVE-verified | `02-technicals-signals.png`: 89× and 45×, No edge |
| Technicals · Momentum · MACD | LIVE-verified | `02-technicals-macd.png`: +18.8 / +10.7 / +8.1, crossover Sep 21 |
| Technicals · Seasonality | LIVE-verified | `02-technicals-seasonality.png`: Feb 1990 to Aug 2026 |
| Event Study · RSI above 70 / below 30 | LIVE-verified | `03-event-study-rsi-*.png`: 89 events, No edge at 1 month |
| Signal Ledger · RSI rows, the NOW / stale column | LIVE-verified | `07-signal-ledger-page.png`: 12 scored, every row Quiet, none stale |
| Overview · Vol · VIX (band, gap, date) | LIVE-verified | `01-overview-vol-vix.png`: 14.9, Sep 25, calm, +4.1 over 10.8 |
| Overview · Active signals (RSI rows among them) | LIVE-verified | `01-overview-active-signals.png` |
| Overview · since last close, data status | LIVE-verified | `01-overview-page.png`: vol down 0.8 pts; seven contributors current |
| Regime · Where we are (classifier line, "in this regime") | LIVE-verified | `04-regime-where-we-are.png` |
| Regime · What would change it (one label, last five changes) | LIVE-verified | `04-regime-what-would-change-it.png` |
| Regime · What each regime has meant | LIVE-verified | `04-regime-what-each-regime-has-meant.png` |
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

### Final gates at the head

Run at `a84842a` (the last code commit; this report's commit adds only this file), under
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
