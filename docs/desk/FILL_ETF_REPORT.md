# desk/fill-etf — real ETF data for the empty Desk cards

Branch `desk/fill-etf`, cut from `main` at `4394e59`, 2026-09-27. Nothing
pushed. One commit per item, then this report.

| # | Commit | What |
|---|---|---|
| 1 | `76fb031` | The 24 ETFs stored in `asset_prices` with volume, full history; the Data Pipeline inventory lists them |
| 2 | `d5458ad` | Sector leadership: `/api/desk/sectors` served, and the Technicals sector card |
| 3 | `85b649e` | Breadth of the 11 sector ETFs, RSP and IWM against SPY |
| 4 | `8eb64a9` | Do bonds still hedge stocks? SPY against TLT |
| 5 | `8f7fa80` | What moves with the S&P: TLT, IEF, HYG, LQD, GLD, UUP, IWM, QQQ and VIX against SPY |
| — | (this report) | `docs/desk/FILL_ETF_REPORT.md` and the real-API shots in `docs/desk/shots/desk-fill-etf/` |

**Final gates passed at head `8f7fa80`** (the last code commit; this report
adds documents only). Under the machine-wide lock `/tmp/mrr-full-gates.lock`
(taken 00:13:14 UTC, released 00:40:06 UTC on 2026-09-28): full pytest,
one process, 1,615 passed, 1 skipped, 7 failed: the two known
`test_asset_history` DB-copy failures and five timing tests that pass alone
or fail alone on the untouched base as well (table below); the full Desk
Playwright e2e, `--workers=1`, 54/54, on the head's own `DESK_FIXTURES=1`
Vite (port 5211); `npm run build` passed. tsc and vitest ran on the same
code in item 5's gate.

## Card by card

Verified against a real API process (uvicorn on `api.main:app`, no
`DESK_FIXTURES`, the Vite dev server proxying `/api` to it), twice:

- **pre-refresh**: a copy of the published database as last downloaded,
  2026-09-24 (sha `9a8b857968b8de22`, the data audit's copy). `gh` is denied
  in this session, so no newer asset could be fetched.
- **post-refresh**: the same copy after this branch's own refresh step ran
  on it (`python -m src.market_data.asset_history --db <copy>`, no EODHD
  token, so Yahoo as in the workflow), which is what the published database
  holds after the workflow runs. Data through Friday 2026-09-25.

Shots, and the JSON each page read, are in `docs/desk/shots/desk-fill-etf/`
(`pre-refresh-*`, `post-refresh-*`: one full page per tab, one image per
card, `*-summary.json` with each card's text and the answer's
`generation_id`).

| Card | Status | Post-refresh (real API, Sep 25) | Pre-refresh (published copy) |
|---|---|---|---|
| Sectors · Sector leadership | **LIVE-verified** | Energy +13.1% leading, Utilities −15.4% lagging, pattern Cyclical (+3.1%), all eleven bars | "Awaiting refresh: the full refresh stores XLB, XLC, … XLY; this database predates it." |
| Sectors · Breadth | **LIVE-verified** | 4 of 11 sectors above the 50-day, 4 of 11 above the 200-day, RSP vs SPY −4.3%, both one-year lines, the dots | Same awaiting reason |
| Technicals · Sector leadership | **LIVE-verified** | Seven bars (XLE, XLV, XLK … XLI, XLU), "Energy and Health care leading; Industrials and Utilities lagging" | Same awaiting reason, the rest of Technicals served |
| Macro · Do bonds still hedge stocks? | **LIVE-verified** | +0.48 on Sep 25, +0.04 on Sep 25, 2025, flipped to positive on Jan 7, 2026, the one-year line | "Awaiting refresh: the full refresh stores TLT; …" |
| Macro · What moves with the S&P | **LIVE-verified** | All nine rows: TLT +0.48, IEF +0.54, HYG +0.71, LQD +0.57, GLD +0.37, UUP −0.30, IWM +0.79, QQQ +0.89, all to Sep 25; VIX −0.73 to Sep 22 (the copy's FRED rows were not refreshed, only `asset_prices` was) | Partly live: GLD, IWM and VIX served; IEF, HYG and LQD "not available · fewer than 60 complete daily return pairs" (that copy has no Sep 22 close for them, as the data audit found); TLT, UUP and QQQ awaiting the refresh |
| Macro · the 12-asset matrix (under Advanced) | UNAVAILABLE, unchanged | "the 12-asset matrix's assets and method are not specified yet." | same |
| Data Pipeline · Series inventory | **LIVE-verified** | 46 series; Sector ETFs, Equity ETFs and Bond, gold & dollar ETFs groups current, first dates from the store (XLC 2018-06-19, XLRE 2015-10-08) | The three groups listed and missing; the six ETFs the allocation refresh already stored read stale (last close Sep 23, two sessions behind Sep 25) |
| Build Notes · Live / Designed, not yet served | **LIVE-verified** (no API; the page's own list) | The new lists as §1.0.1 states them | — |

No card is PROTOTYPE: every changed card serves real values, and no
illustrative value was added anywhere. No card is FAILED. On the published
database as it stands today the five data cards show "Awaiting refresh"
(or, for the correlations, the rows the database can already compute),
which is their designed state until the refresh below runs; the
post-refresh run shows each of them live on a real API.

## Publishing: the one step after merge

The published database gains the ETFs only when the refresh workflow runs
on `main` after the merge:

- Workflow **Refresh Data**, `.github/workflows/refresh-data.yml`, mode
  `full`. Its step "Store allocation price histories" runs
  `python -m src.market_data.asset_history`, which now also fetches the 24
  ETFs and adds the `volume` column.
- Run it by hand with
  `gh workflow run refresh-data.yml --ref main -f mode=full`, or wait for the
  scheduled full runs (11:17 UTC daily, 00:23 UTC Tuesday to Saturday).
- The API picks the new asset up at its next bootstrap check
  (`BOOTSTRAP_DB_REFRESH_MIN`) or restart; it must be running this branch's
  code (the Render deploy from `main`).
- The asset grows from 16.4 MB to about 22.7 MB (`asset_prices` from 89,746
  to 200,569 rows); the run makes 18 more Yahoo downloads (the six
  allocation ETFs were already fetched).

**The volume migration lives in pipeline code, never in a committed file.**
`src/market_data/asset_history.ensure_table` runs `ALTER TABLE asset_prices
ADD COLUMN volume REAL` when the column is missing, in the workflow's step,
against the published database it downloaded. No SQLite file was edited by
hand or committed (`data/*.db` are gitignored; every database this session
touched is a copy under the scratchpad or `data/`).

## What each item does

**1. Store the ETFs (`76fb031`).** XLB XLC XLE XLF XLI XLK XLP XLRE XLU
XLV XLY SPY RSP IWM QQQ SMH SOXX IGV TLT IEF HYG LQD GLD UUP are registry
series with store `asset_prices` (`src/desk/series.py`), fetched by the
same step and path as ^GSPC (`asset_history` → `market.daily_history`,
EODHD first, Yahoo as the disclosed fallback), from 1990 so the row set is
the provider's whole history. Each daily row carries the session's volume
from the same provider response (`yf.Closes.volume`, the envelope's
`volume`); monthly rows store none. Short histories are explicit: XLC and
XLRE are declared at their listing dates (2018-06-19, 2015-10-08, confirmed
on Yahoo), a later first close is named `short` in the watermark, and every
statistic that needs a close before it reads "not available" with the
reason. The inventory gains three groups; the Event Study export test now
waits for the object URL's release (a timer leak the gate exposed).

**2. Sector leadership (`d5458ad`).** One worker item, `desk_etf`
(`api/desk_items_etf.py`), rebuilt with every generation. Leadership: each
sector ETF's log return over the 60 XNYS sessions to SPY's newest close,
less SPY's, ranked; the pattern word by `sector-pattern-v1` (the six
cyclical sectors' mean against the three defensive ones', ±1%, XLC and XLRE
in neither). `/api/desk/sectors` (new §12.14) and `/technicals`' `sectors`
block serve the same object. The illustrative `sectors.json` and the
fixture's `/sectors` awaiting fallback are gone.

**3. Breadth (`85b649e`).** Of the 11 sector ETFs, never stocks: above the
50- and 200-day averages on exact session slots (the §12.7 rule), a sector
that cannot be read named and counted in neither `n` nor `of`; RSP against
SPY and IWM against SPY over 60 sessions with one-year lines. Every count
reads "n of 11 sectors". Build Notes names constituent-level breadth as the
next thing to build.

**4. Stock–bond (`8eb64a9`).** Pearson's correlation of SPY's and TLT's
daily log returns over 60 return dates, every pair complete, no forward
fill; a year ago; the newest change of sign; the one-year line.

**5. What moves with the S&P (`8f7fa80`).** The same correlation for TLT,
IEF, HYG, LQD, GLD, UUP, IWM, QQQ and, when stored, VIX (FRED VIXCLS, log
changes), each to its own newest session with both values. A row says why
it is null: awaiting the refresh, an incomplete window, or no variation.

For each item: spec §1.0 flipped to LIVE, the §12 fields written (§12.7,
§12.8, the new §12.14), §1.0.1 and the page's `scope.ts` updated word for
word, the fixtures regenerated from the API's own answers
(`scripts/desk_etf_fixtures.py`, provenance in
`web/src/fixtures/desk/PROVENANCE.md`), the contract module
(`tests/desk_contract.py`) extended, tests on a locally built store
(`tests/desk_etf_store.py`: the 24 ETFs on real XNYS sessions, with short
histories, gaps and missing series on demand; `tests/test_desk_etf.py`, 26
tests), compare shots re-taken (02, 05, 06, 10), Build Notes and
CLAUDE.md updated.

## Where the tree won over the instruction

- **"3-month return … minus SPY"**: spec §12.13 (v3 A-18) fixes it as
  ln(P(t)/P(t−60)) − ln(SPY(t)/SPY(t−60)), 60 XNYS sessions on adjusted
  closes. Followed, and printed as log returns ×100 with the §1.9 tooltip.
- **PATTERN "per spec"**: no rule existed (§12.0 serves no word without
  one), so `sector-pattern-v1` was written into §12.14.
- **Port 5193** was held by two other sessions' fixture servers
  (mrr-usability, mrr-frame3), and 5197 by a third. My fixture server ran
  on 5196 (compare shots) and the gate's on 5211, each checked by its cwd.
- **The nine sector ETFs listed from 1998 keep their event-study roles**
  (`tests/fixtures/desk_entries_cc721f0.json` freezes them as shocks); the
  other fifteen ETFs have none. So the nine are now selectable in the
  legacy `/api/desk/event-study` and appear in `/study`'s `series[]`
  (tier 2 with roles); the catalog-based `/study` is unchanged.
- **Small caps vs large** reads IWM against SPY (both ingested) rather than
  ^RUT against ^GSPC; ^RUT's inventory note says so.
- **The chart zones** in the mockup ("broad rally", "risk appetite broad")
  interpret; the served zones say which ETF is ahead ("RSP ahead of SPY ·
  equal weight leading").
- **`deferred-macro.json`** keeps only the matrix (a unit-test input for the
  still-unavailable matrix); its illustrative stock–bond and correlations
  are gone.
- **pytest** runs with `--ignore=tests/test_streamlit_backports.py` (no
  streamlit in the venv), as every earlier gate recipe did.
- **vitest `--maxWorkers=2`** needs `--minWorkers=1` on vitest 2.1.9.

## Gates

Before the owner's policy change (items 1–3): tsc, vitest, build, full
pytest and the Desk e2e on an exact snapshot of each pending commit (a
detached worktree at HEAD with the staged diff applied). After it (items
4–5): tsc, vitest `--minWorkers=1 --maxWorkers=2`, build, and
`pytest tests/test_desk*.py`; the full suites once at the head.

| Commit | tsc | vitest | build | pytest | Desk e2e |
|---|---|---|---|---|---|
| 1 `76fb031` | pass | 124 files, 1,535 | pass | 1,597 passed, 2 failed (the known `test_asset_history` pair) | 54/54 |
| 2 `d5458ad` | pass | 124 files, 1,528 | pass | 1,604 passed, 1 skipped, 4 failed: the known pair and 2 load flakes (below) | 54/54 |
| 3 `85b649e` | pass | 124 files, 1,532 | pass | 1,605 passed, 1 skipped, 9 failed: the known pair and 7 load flakes | not required (the item-4 tree, which contains item 3, passed 54/54) |
| 4 `8eb64a9` | pass | 124 files, 1,534 | pass | `test_desk*`: 594 passed, 1 skipped, 3 load flakes | — |
| 5 `8f7fa80` | pass | 124 files, 1,535 | pass | `test_desk*`: 597 passed, 1 skipped, 3 load flakes, 1 real failure fixed before the commit (the contract test's extra-key helper assumed a block's data is an object) | — |
| **Final, `8f7fa80`** | (item 5) | (item 5) | pass | **full: 1,615 passed, 1 skipped, 7 failed** (the known pair, 5 load flakes) | **54/54** (`--workers=1`) |

### Failures under load, and alone

The machine ran five sessions' gates at once (load average 14–43). Every
failure below is a timing test; none touches this branch's code path.

| Test | Under load | Alone |
|---|---|---|
| `test_asset_history::test_allocation_answers_in_under_500_ms…` | failed (item 3) | passed |
| `test_desk_api::test_slow_computation_answers_computing_not_blank` | failed (item 3) | passed |
| `test_desk_api::test_the_query_tool_stops_a_cross_join_within_300_ms…` | failed (items 2–5, final) | passed on items 2, 3, 5 and at the head; on item 4 failed 4 of 7 runs alone at load 14–17 while the base commit passed 5 of 5. Timed directly: the tool call's median is 258–264 ms on base and 257–263 ms on item 4, the same, with the same spikes on both, against a 300 ms bound over a 250 ms budget |
| `test_desk_api::test_the_assistants_sql_runs_on_a_private_copy…` | failed (items 2–5, final) | passed on items 2 and 3; failed alone on items 4 and 5, and **also failed alone twice on the untouched base commit** `4394e59` at the same load. At the head, run alternately with base at the same minute: base failed then passed (reader waited 43.5 ms), head failed then passed (133.8 ms) |
| `test_desk_api::test_a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms` | failed (items 3–5, final) | passed, at the head too |
| `test_generations::test_an_item_that_fails_on_a_new_file_holds…` | failed (item 3, final) | passed, at the head too |
| `test_provider_no_yahoo::test_the_profile_makes_its_two_eodhd_calls_concurrently` | failed (item 3, final) | passed, at the head too |
| vitest: an unhandled `URL.revokeObjectURL` timer (Event Study export) | item 1 | fixed in the test (it now waits for the release) |
| vitest: Basket & Hedge "Send to Position Monitor" | one working-tree run at load 31 | passed alone |

## Merging with the other Desk branches of the day

`desk/books` (`f5d98c2`) and `desk/prototypes` (`d1e0ab4`) branch from the
same `4394e59` and touch many of the same files, so whichever of the three
merges second resolves conflicts in: the spec (§1.0, §1.0.1, §12),
`BUILD_NOTES.md`, `CLAUDE.md`, `api/desk_envelope.py`, `api/desk_v2.py`,
`tests/desk_contract.py` and its tests, `web/e2e/desk.spec.ts`, the Desk
data layer (`envelope.ts`, `schema.ts`, `types.ts`), `scope.ts`,
`PROVENANCE.md`, `TechnicalsPage.tsx`, `kit/ui.tsx`, `desk2.css`. All three
fixed the same Event Study export timer leak in
`EventStudyPage.test.tsx`, each differently: keep one. `desk/books` edits
`api/providers/market.py` in other functions than `daily_history`.

## Follow-ups

- The 12-asset matrix: which twelve assets, and the method.
- Constituent-level breadth (a constituent list and a price per stock).
- The shots' pre-refresh copy is the Sep 24 asset; once the workflow has
  run, a check against the live API (`/api/desk/sectors` ready) confirms
  the publish.
- `/study`'s `series[]` now lists the nine older sector ETFs (tier 2 with
  roles, ops `[]`); if the Event Study page should not show them anywhere,
  filter to catalog shocks in `_series_list`.
