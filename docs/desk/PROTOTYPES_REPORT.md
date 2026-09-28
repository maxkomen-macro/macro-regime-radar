# PROTOTYPES_REPORT.md — desk/prototypes

Branch `desk/prototypes` (worktree `mrr-proto`), cut from main `4394e59`,
**rebased onto origin/main `83a9f46` (desk/books merged) on 2026-09-28**. One
commit per item, then the Codex fixes, the Build Notes section, the three
commits that followed the rebase, and this report. **Nothing is pushed.**
The shas below are the rebased ones; the pre-rebase shas are in the rebase
section at the end.

| # | Commit | What |
|---|---|---|
| 1 | `cbb982a` | The PROTOTYPE state (spec §1.0.3), `PrototypeFootnote` / `PrototypeCard`, and the three tests |
| 2 | `a3e4936` | Technicals "What protection costs right now" |
| 3 | `ef251ed` | Basket & Hedge "Hedge with options" |
| 4 | `0a41e0d` | Basket & Hedge "Positioning" |
| 5 | `53e865e` | Basket & Hedge "Event study on this basket" |
| 6 | `061cea3` | Data Pipeline "Sync to Snowflake" |
| 7 | `1669d86` | Build Notes "Prototypes, and how I would build them" |
| 8 | `cff82f2` | The prototype page checks wait for a loaded machine; `markers.ts` imports tidied |
| 9 | `d673f3f` | This report's first version, its shots, the CLAUDE.md note |
| R-01 | `d715c36` | Positioning says what its figures cover (Codex) |
| R-02 | `397a10c` | Hedge with options prices each structure only inside its domain (Codex) |
| R-03 | `8a95386` | The protection prototype stands only in a not-yet-served vol block (Codex) |
| 10 | `5fe3b73` | Build Notes "How this was built" |
| 11 | `144b1e3` | Its wording, to what the gates were |
| 12 | `dbfcdfa` | **After the rebase:** Hedge with options reads step 3's served `/basket/hedge` answer, in desk/books' options slot |
| 13 | `5e9a559` | **After the rebase:** Data Pipeline's subtitle, Build Notes' two sentences, Positioning's "(illustrative)" headers |
| 14 | `09f9b36` | **After the rebase:** those headers keep Positioning's table inside its card |
| 15 | `3ae4a22` | The report's rebase section, the live shots |
| 16 | this commit | **Before review:** Positioning and the event study drawn for the AI Infrastructure 10 preset; one line for any other basket |

## What a PROTOTYPE card is (spec §1.0.3)

A third state beside LIVE and UNAVAILABLE, for the parts of the Desk that
would take many hours to build for real. The card is drawn finished (title,
stats, body, `Advanced ▸`), carries **no badge and no banner**, and ends with
exactly one footnote, its last line, in the as-of stamp's style (IBM Plex
Mono 11px, #6b7280): `Illustrative values · In production: <one line>`.
Its values are illustrative but internally consistent (each card's numbers
are derived from its fixture by the rule its Advanced section states, and a
unit test holds them to each other). Its values come only from
`web/src/fixtures/desk/proto-*.json` and `vol.json`, read only under
`web/src/screens/desk/prototypes/`. A prototype stands where the block it
prototypes stands and gives way to the LIVE card once that block is served.

The shared pieces: `web/src/screens/desk/kit/Prototype.tsx`
(`PrototypeFootnote`, `PrototypeCard`, which also clears any unavailable
scope so the card is drawn finished on a page whose served blocks are
awaiting), `prototypes/registry.ts` (every card, its page, its footnote
line), `prototypes/markers.ts` (what each card prints that no served card
prints), `prototypes/black-scholes.ts`.

**Tests** (`prototypes/prototypes.test.tsx`, `e2e/desk.spec.ts`):
1. every PROTOTYPE card ends with its footnote (the exact words, last in
   document order, the as-of stamp's computed style) and carries no badge:
   in the unit test on the three hosting pages, in the browser on all eleven;
2. no LIVE card imports a prototype fixture: a TypeScript-parsed import scan
   of every app module (static, re-export, dynamic, `import.meta.glob`)
   allows `proto-*.json` and `vol.json` only under `prototypes/`, and lets a
   module outside it take nothing from it but the named card components;
3. no fixture value appears outside a PROTOTYPE card: each card's markers
   are printed inside its `[data-prototype]` element and nowhere else on the
   page. The browser test also ran against `vite preview` of the production
   build (`routeDesk` answers in the page, so the built bundle reads the same
   fixtures): it passed (the run: 55 of 56, the other failure a dev-server-only Build Notes test, see the gates).

## The cards

### 2 · Technicals "What protection costs right now" (`ProtectionCard`)

In the vol column, for the S&P only, when `/technicals` answers ready and
serves its `vol` block awaiting as not yet served (Monday: "needs stored SPY
option snapshots…"). Every other state keeps the LIVE card in that state:
loading (quiet, so a served block never flashes the prototype first), the
route awaiting or failed, an answer without the block, the block served
ready or awaiting a refresh (Codex R-03). A `/technicals` naming another
instrument draws the LIVE card (§12.7 says every field is the S&P's).

- PUTS vs CALLS · 1 MONTH OUT: `+6.8 pts` (vol.json's skew); the 25-delta
  put at 19.2% vol, strike 96.7% of spot, costs 0.84% of spot; the call at
  12.4%, strike 102.7%, 0.52%. Strikes solved at |Δ| = 0.25, Black-Scholes,
  30 days, 4.10% rate, 1.20% dividend yield.
- WHAT OPTIONS EXPECT vs WHAT HAPPENED, 1 · 3 · 6 MONTHS: 15.4/16.8/17.5
  implied (vol.json's term) against 11.9 (vol.json's `realized_20d`), 12.8,
  13.6 realized, paired bars and the gaps.
- SKEW · WHERE IT SITS: 74th percentile of two years (78 of 105 weekly
  readings at or below today's, equal to vol.json's `skew_pct_2y`), the
  weekly line (low 4.3 Dec 2024, high 9.3 Apr 2025), "Rising since June."
- Footnote: "…In production: daily SPY chain snapshots from the EODHD options
  add-on, stored and versioned."

### 3 · Basket & Hedge "Hedge with options" (`OptionsHedgeCard`)

In desk/books' step 3, in its options slot (`data-slot="hedge-options"`,
`BasketHedgeStep.tsx`), across the step's width under the ETF hedge and the
stress test. The inputs row, `● from your basket · live`, reads the step's own
`GET /basket/hedge` answer (§12.16), the one the ETF table and the stress
test print, through `inputsFrom`: NOTIONAL (`notional`), TOP HEDGE ETF
(`top`, "first of 8 by R², ahead of <next> at <its R²>"), HEDGE RATIO (that
row's `hedge_ratio`), R² (that row's, on its `basis` window, with the
window), and `basket_vol` in Advanced. While the answer is on its way the row
reads "Awaiting refresh" and nothing is priced; an answer with no top pick
prices nothing and says so; with no answer to read (no basket saved at
exactly 100%, or the request failed) the slot keeps desk/books' plain reason.
On a local API over real EODHD closes the row read `$1.0M · SOXX · 1.10 ·
0.86` for the preset (see "After the rebase" below).

Three routes, each as a 1M 95 put, a 3M 95 put and a 1M 95/85 put spread,
with cost in % and $ of notional, breakeven (the basket's fall by expiry
that repays the premium) and the payoff at expiry if the basket falls 10%.
For the sample basket on the fixture server's answer (desk/books'
`basket-hedge.json`, real Yahoo closes through Sep 23: XLK, 1.38, R² 0.69):

| Route | 1M 95 put | 3M 95 put | 1M 95/85 spread | at −10% |
|---|---|---|---|---|
| (a) puts on XLK, $1.4M of it, strikes 96.4% / 89.2% of XLK | 1.90% · $19,000 · down 6.9% | 4.55% · $45,500 · down 9.5% | 1.42% · $14,200 · down 6.4% | $50,000 |
| (b) NVDA, AVGO, VRT puts at their weights, 52% covered | 1.57% · $15,700 · down 8.0% | 3.43% · $34,300 · down 11.6% | 1.06% · $10,600 · down 7.0% | $26,000 |
| (c) OTC basket put, 44.8% vol (1M 95) | 2.78% · $27,800 · down 7.8% | 6.26% · $62,600 · down 11.3% | 1.83% · $18,300 · down 6.8% | $50,000 |

Trade-offs, one line each: (a) listed and liquid, but R² 0.69 leaves 31% of
the variance unhedged; (b) covers only the 52% the three names carry, at
single-name vol; (c) exact, dealer-priced (1.5 vol points over the fair mark)
under an ISDA, with a basket swap (about 45 bp a year, no upside) named as
the alternative. Each structure is priced only inside its domain (a hedge
ratio from 0.25 to 4, strikes from 50% to 100% of spot, a positive vol, R²
in (0, 1], finite results); outside it the row says why and prints no number
(Codex R-02). Advanced states every assumed vol, the domain, the strike mapping, the
dividend yields, and the engine's realized basket vol on the same window
(44.1%, `basket_vol`), just under the 44.8% the dealer is assumed to charge.
Footnote: "…In production: EODHD option chains for the hedge ETF and the
names, and a dealer's quote for the basket put, stored with each basket."

### 4 · Basket & Hedge "Positioning" (`PositioningCard`)

Drawn for desk/books' first-visit preset, AI Infrastructure 10 (commit 16;
`prototypes/drawn-for.ts`), so a first visit sees all ten names. Per name:
weight, short interest % of float, days to cover, put/call open interest,
and a crowding flag by the rule Advanced states (Crowded short at 10% of
float or more, else Crowded long when 25% of the funds a 13F sample tracks
hold it in their top ten). The preset: SHORT INTEREST 4.8% of float, DAYS
TO COVER 1.7, both "weighted over all 10 names", CROWDED 4 of 10 (NVDA,
AVGO long; CRWV 18.3%, NBIS 15.9% short). The three illustrative numeric
columns' headers end "(illustrative)", on a line of their own under the
column's name (weight is the basket's own). Any other basket keeps the
title, the three labels valued "—" and the footnote, and prints "Illustrative
values are shown for the AI Infrastructure 10 preset." The coverage words of
Codex R-01 ("weighted over 50% of the basket (1 of 2 names)", "no name with
data", no NaN) stay in the pure function and its tests. In step 3, below the
options slot, left. Footnote: "…In production: exchange short-interest
files, OCC open interest, 13F holdings."

### 5 · Basket & Hedge "Event study on this basket" (`BasketStudyCard`)

Styled as an Event Study answer, reusing its horizon chart (`Bars`, now
exported from `event-study/AnswerCard.tsx`), drawn for the same preset
(commit 16) and naming the basket as saved: "After AI Infrastructure 10
falls 2σ over 5 days, it was higher a month later 64% of the time."; EVENTS
57 (56 complete at a month), UP A MONTH LATER 64% (36 of 56, 61% in a normal
month), MEDIAN AT A MONTH +3.4% vs +2.4% (log return ×100), VERDICT
Suggestive, which is §1.5's rule v1 applied to the card's own numbers (56 ≥
10; interval −1.1% to +3.8% spans zero, so no exclusion; the excess leans up
at 5, 10 and 20). The why line in §12.2's template; the index from Aug 2009,
once half the preset's weight is listed, names joining as they list. Any
other basket keeps the labels and prints the same one line as Positioning.
In step 3, below the options slot, right. Footnote: "…In production: the
existing engine run on the basket index series."

### 6 · Data Pipeline "Sync to Snowflake" (`SnowflakeSyncCard`)

Under the inventory and the bridge: the target (MRR_DESK, MRR_LOAD_XS,
MRR_LOADER), the four steps CONNECT → STAGE → MERGE → VERIFY with what each
does and its time, and the six tables of the proposed DDL (held equal to it
by a test) with key, staged, merged (inserted · updated, unchanged, or
rebuilt for MART), rows in Snowflake, rows in the snapshot, and the check.
It opens on the last run ("Verified: 6 of 6 tables match the snapshot ·
3,504 rows staged · 7.9 s on MRR_LOAD_XS"); **Sync to Snowflake** replays
the steps (at once under reduced motion). The real **Generate Snowflake
DDL** and **Export current study → CSV** are untouched. Footnote: "…In
production: a job after each validated refresh: stage the changed rows,
MERGE on each key, check counts and hashes."

### 7 · Build Notes "Prototypes, and how I would build them"

A `##` section of `docs/desk/BUILD_NOTES.md` after "What's live, and why the
rest isn't yet": one paragraph per prototype, each with source, compute,
storage and a realistic effort (two weeks, two to three weeks, two weeks,
about a week, about a week), and an opening that says the five do not change
the live list above.

## Gates, per commit

Every gate ran on a `git archive` of the exact tree committed, never the
working tree: Python with the audit's store (mrr-frame3-docs, sha
`9a8b8579…`) and hardening's `desk_scratch.db`; the Desk browser tests
against `DESK_FIXTURES=1 vite` started from that archive, the listener's
working directory checked (other sessions held 5193, 5196, 5293 and 5391).

The owner changed the policy during the run (the machine was running five
sessions' suites at once, load average 15–40): items 1 and 2 had the full
gates; items 3 to 7 had already passed tsc, the full vitest, the build and
the full Desk e2e on their trees, and then ran only the related pytest files
(`tests/test_desk*.py` and `tests/test_event_study.py`; no commit on this
branch changes anything under `api/`, `src/`, `tests/` or `scripts/`); the
last commit ran tsc, `vitest --maxWorkers=2 --minWorkers=1` (vitest 2.1
refuses `--maxWorkers=2` alone on this machine: "minThreads and maxThreads
must not conflict"), the build and the same pytest files; the full pytest
and the full Desk e2e ran once, at the head, under
`/tmp/mrr-full-gates.lock`.

These rows gated the pre-rebase commits (their shas; the map is in the
rebase section). The rebased head's gates follow the table.

| # | Commit | tsc | vitest | build | Desk e2e (fixtures) | pytest |
|---|---|---|---|---|---|---|
| 1 | `d33ea20` | ok | 125 files, 1,546/1,546 ¹ | ok | 55/55 | full: 1,588 passed, 2 failed (the known `test_asset_history` pair) |
| 2 | `2684125` | ok | 127 files, 1,558/1,558 | ok | 55/55 | full: 1,587 passed, 3 failed: the known pair, and `test_generations::…holds_the_whole_generation_back…`, which passed alone (3.4 s) |
| 3 | `10f631b` | ok | 128 files, 1,570/1,570 | ok | 55/55 | desk files: 653 passed, 3 failed ² |
| 4 | `f54ea4c` | ok | 129 files, 1,576/1,576 | ok | 55/55 | desk files: 651 passed, 5 failed: the three of ², and `test_before_the_first_refresh_every_route_answers_its_expected_status`, `test_a_preset_awaiting_the_refresh_never_holds_a_generation_back`, which passed alone (2/2), as on main |
| 5 | `7aeef07` | ok | 1,581/1,582 ³ | ok | 55/55 | desk files: 653 passed, 3 failed ² |
| 6 | `d1e0ab4` | ok | 1,586/1,588 ⁴ | ok | 56/56 | desk files: 654 passed, 2 failed (two of ²) |
| 7 | `3f856db` | ok | 131 files, 1,588/1,588 | ok | 56/56 | desk files: 653 passed, 3 failed ² |
| 8 | `08d1f7a` | ok | 131 files, 1,588/1,588 (2 workers) | ok | (at the head, below) | desk files: 656/656 (after the memory pause, load about 4) |
| head | `08d1f7a` | | | build ok | **56/56**, `--workers=1`, under the lock | **full: 1,588 passed, 2 failed (the known `test_asset_history` pair)**, single process, under the lock |

**At the rebased code head `09f9b36`** (2026-09-28; the report commit after
it changes only this file and PNGs under `docs/desk/shots/`):

| Gate | Result |
|---|---|
| tsc | ok |
| vitest, `--maxWorkers=2 --minWorkers=1` | 134 files, 1,662/1,662 |
| build | ok |
| full pytest (single process, `--ignore=tests/test_streamlit_backports.py`), under the lock | 1,766 passed, 1 skipped, 2 failed: the known `test_asset_history` DB-copy pair (`…the_endpoint_says_the_histories_are_not_stored`, `…validate_requires_the_table_in_full_mode_only`) |
| full Desk e2e, `--workers=1`, `DESK_FIXTURES=1 vite` from a `git archive` of `09f9b36` (listener cwd checked), under the lock | **57/57** |

The lock was held 00:47 to 01:00 (pytest 10 min 44 s, e2e 2 min 24 s) and
released; no test process of this session was left running. Nothing failed
under load that passed alone this time (load average about 6).

Before the rebase, the final run held `/tmp/mrr-full-gates.lock` from 21:03 to 21:14 (full
pytest 8 min 36 s, the Desk e2e 2 min 23 s) and released it; no test
process of this session was left running.

The production build: the Desk browser tests against `vite preview` of item
7's `dist`, 55/56. The PROTOTYPE test passed there; the one failure, "Build
Notes: the contents mark follows the scroll…", swaps the notes module through
the dev server's `?import&raw` URL, so it runs only on a dev server (main's
test, unchanged).

¹ The first run also reported one unhandled error, the Event Study revoke
timer (deviation 10); fixed in the same commit and re-run clean.
² The latency tests `test_desk_api::test_the_query_tool_stops_a_cross_join_within_300_ms…`,
`…the_assistants_sql_runs_on_a_private_copy_that_never_stalls_other_readers`
and `…a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms`
failed, and failed again alone at load 27, and failed the same way on main's
own archive at the same load: they measure milliseconds, and this branch
changes no Python. At load about 4 (commit 8's run) all three passed.
³ The Build Notes page test timed out finding its article (1.5 s); it passed
alone on the same archive (19/19). Item 5 does not touch Build Notes.
⁴ This branch's own page checks in `prototypes.test.tsx` timed out finding
the page heading (1 s default); they passed alone (11/11). Commit 8 gives
them 8 s and the test 30 s.

## Where the tree won over the instructions

1. **The basket engine's fields.** The brief names four inputs (notional, top
   ETF, hedge ratio, R²) and says to read "a fixture shaped like its API".
   desk/books has since committed that API: `GET /basket/hedge` (its §12.15)
   serves `notional`, `top` and the ranked `etfs[]` with `hedge_ratio` and
   `r2_1y`. The stand-in is therefore that answer itself, copied from
   desk/books' `basket-hedge.json` for the sample basket, and the card reads
   exactly those fields (`inputsFrom`). An earlier draft of item 3 used a
   guessed shape (SMH, $10M) and then §12.14's QQQ/SPY betas; both were
   replaced before the commit, which is why item 3 was re-committed on
   item 2 (nothing had been pushed). After the rebase the stand-in is gone
   and `inputsFrom` reads the served answer (commit 12).
2. **Strikes on the ETF route.** "A 1M put … a 1M 95/85 put spread" on an ETF
   the basket moves 1.38 times would, at 95% of the ETF, protect the basket
   only below −6.9% before premium and pay 3.1% at −10% (the basket put
   pays 5%). The card moves the
   basket's strikes onto the ETF (the basket's K is 1 − (1 − K) ÷ ratio of
   the ETF: 96.4% and 89.2% of XLK), so the three routes protect the same
   basket level and differ in cost, coverage and basis risk. Advanced says so.
3. **Where the options card sits.** desk/books puts the page in three steps and
   leaves an `OptionsSlot` titled "Hedge with options" with
   `data-slot="hedge-options"` in step 3. Before the rebase that layout was
   not on main, so the card sat under the two cards; now it fills the slot
   while the step has an answer to read, and `OptionsSlot` keeps the slot
   otherwise.
4. **"Nothing is synthetic."** Data Pipeline's subtitle (§11's exact words,
   "Every panel in Desk resolves to a row here. Nothing is synthetic; nothing
   is re-derived in the browser.") sat above a PROTOTYPE card whose values
   are illustrative and computed in the browser. Reworded by the owner at the
   rebase (commit 13): "Every live number comes from stored data; prototype
   cards are marked." The subtitle's third sentence, "Nothing is re-derived
   in the browser.", stays (see the open calls).
5. **Build Notes' own sentences.** The owner's section "What's live, and why
   the rest isn't yet" says of options "A number without that isn't
   auditable, so there isn't one" and of basket pricing "It's absent until
   it's right; the card has its slot on the page." Both read beside
   illustrative numbers. Reworded by the owner at the rebase (commit 13):
   each now reads "Where a number isn't computed yet, the card says so or is
   a marked prototype."
6. **§1.0.1's lists** (printed word for word by Build Notes) are unchanged: a
   prototyped block stays "Designed, not yet served" (§1.0.3 rule 7).
7. **"No fixture value appears outside a PROTOTYPE card in the production
   build."** Implemented three ways: the import scan (no app module outside
   `prototypes/` can reach a prototype fixture), the marker check in vitest
   on the hosting pages and in the browser on every page, and that browser
   test run against `vite preview` of `vite build`. Markers are the
   distinctive printed values (costs, strikes, percentiles, dollar figures,
   crowding words, the sync's row counts); tickers are not markers, since a
   served card also prints them (the LIVE hedge card's "SPY / QQQ surface").
8. **Port 5193.** Two other sessions' Vite servers (mrr-usability,
   mrr-frame3) held it all session, so a server started there would have
   failed and the e2e would have tested another branch. Each gate ran its
   own `DESK_FIXTURES=1 vite` from a `git archive` of the tree it gated, on
   5197, 5198 or 5199, and from item 3 on the gate script checks that the
   listener's working directory is that archive before running e2e.
9. **pytest** skips `tests/test_streamlit_backports.py` (it imports
   `streamlit`, which the API venv does not install; it errors at
   collection otherwise).
10. **A pre-existing flaky test fixed** (in item 1): Event Study's export test
    restored its `URL.revokeObjectURL` stub while the download's one-second
    revoke timer was pending, so under load a later file's run failed with
    "URL.revokeObjectURL is not a function". The test now waits for the
    revoke. Test-only.
11. **Existing browser tests changed:** the Technicals test expects the vol
    column to be the PROTOTYPE; the Basket test finds the basket card with
    `exact: true` (the prototype cards' names contain "basket").
12. **Which basket the prototypes are drawn for.** After the rebase they
    were drawn for the 7-name sample basket while desk/books seeds the
    10-name preset. Commit 16 redraws both for the preset; the fixture tests'
    sample basket (`baskets.json`) is now "another basket" and prints the
    one line. The options card still prices any saved basket from its served
    answer.

## Run against the real API, before the rebase (definition of done)

Setup: a `git archive` of item 7's tree (commit 8 changes only a test and an
import order, nothing that renders) served by Vite **without**
`DESK_FIXTURES`, proxying `/api` to the deployed API
(`VITE_PROXY_TARGET=https://macro-economic-radar-api.onrender.com vite --port
5392`, the listener's working directory checked). Every page answered from
Render's generation `g1-cfcbef97c3` (engine `4394e59`, main), as its footer
shows. The Basket & Hedge prototypes draw for a saved basket, so the sample
basket (`web/src/fixtures/desk/baskets.json`) was saved in that browser's
local storage first, as a visitor does with Import JSON. Shots:
`docs/desk/shots/desk-prototypes/` (`before-live-*` are the deployed site
before this branch; `real-*` are this branch on the real API).

| Card | Verdict | Evidence |
|---|---|---|
| Technicals · What protection costs right now | **PROTOTYPE** | Render serves `/technicals` with `vol` awaiting ("needs stored SPY option snapshots and a versioned skew method."), so the prototype stands in the column beside the live price (7,743, Sep 25), averages and signals; no badge, footnote last. The LIVE card's path (a served vol block) is unchanged but cannot be exercised: no API serves the block. `real-technicals-page.png`, `real-technicals-protection.png` |
| Basket & Hedge · Hedge with options: the three routes | **PROTOTYPE** | Priced in the browser at the stated vols; footnote last. `real-basket-options-hedge.png`, `real-basket-page.png` |
| Basket & Hedge · Hedge with options: the inputs row "from your basket · live" | **FAILED** | It shows $1.0M, XLK, 1.38, 0.69 on the real API, but those come from `proto-books-basket.json`, not from the API: the deployed API (main) has no basket engine: `/api/desk/basket/hedge` and `/api/desk/basket/price` both answer the awaiting stub ("basket pricing and option structures not yet defined in the engine.", the first through `/basket/:id`), and the page made no `/basket/*` request. The values are desk/books' real-closes fixture for this basket, but a row labelled live that works only with a fixture counts as FAILED. Superseded after the rebase: **LIVE-verified** on a local API (the section after the rebase). |
| Basket & Hedge · Positioning | **PROTOTYPE** | `real-basket-positioning.png` |
| Basket & Hedge · Event study on this basket | **PROTOTYPE** | `real-basket-study.png` |
| Data Pipeline · Sync to Snowflake | **PROTOTYPE** | Last run, and a replay caught at the merge step. `real-pipeline-snowflake-sync.png`, `real-pipeline-snowflake-sync-replay.png`, `real-pipeline-page.png` (the live inventory, 22 series, and the header "Last full refresh Sep 27, 17:28 UTC · validation passed" from Render beside it) |
| Data Pipeline · the bridge's Generate Snowflake DDL (untouched) | **LIVE-verified** | `GET /api/desk/pipeline/ddl` through the proxy: 200 `text/plain; charset=utf-8` |
| Build Notes · Prototypes, and how I would build them | **LIVE-verified** | Rendered from the file on the real-API run; in the contents list after "What's live, and why the rest isn't yet"; no banned word on the page. `real-build-notes-prototypes.png` |
| Event Study · the answer card (its chart component, `Bars`, is now exported for the basket study) | **LIVE-verified** | Render's study, chart drawn, "● Live · 0 ms, cached". `real-event-study-answer.png` |

On the same run, each of the eleven Desk pages was loaded and its text
outside `[data-prototype]` checked against every card's markers (imported
from `prototypes/markers.ts` through the dev server): no prototype value
outside a card on any page, and the prototype cards exactly where the
registry puts them (Technicals 1, Basket & Hedge 3, Data Pipeline 1, the
other eight 0). The console showed two things that predate this branch: the
dev server's `snapshot/latest.json` 404, and a React setState warning in
Position Monitor.

## The rebase onto origin/main `83a9f46` (desk/books merged)

`git fetch origin && git rebase origin/main`, 2026-09-28. Fourteen commits
replayed; seven stopped on conflicts. "Main" below is `83a9f46`'s side.

| Replayed commit | Conflicted file | Resolution |
|---|---|---|
| 1 PROTOTYPE state | `web/src/screens/desk/event-study/EventStudyPage.test.tsx` | **Main's file, whole.** Both sides fixed the same leak (the export test's `URL.revokeObjectURL` stub restored while the download's revoke timer was pending): this branch waited for the revoke, main's timer-leak fix covers it. Main's fix is kept; the file is identical to main's. |
| 2 Technicals | `web/src/screens/desk/technicals/TechnicalsPage.tsx` | Main's code (desk/fill-etf's sectors, desk/fill-compute's RSI, MACD, seasonality, desk/books' `kit/TrendChart`) plus this branch's vol-column switch; the header comment names both. |
| | `…/TechnicalsPage.test.tsx` | Main's tests, with this branch's vol assertions merged into main's "vol awaiting, sectors ready" test: the vol column is the PROTOTYPE, the sector card reads its bars. |
| | `docs/desk/DESK_FRAME3_SPEC.md` | This branch's vol row; main's LIVE rows for sector bars, RSI, MACD and seasonality. |
| | `web/src/fixtures/desk/PROVENANCE.md` | Both sides' rows. |
| | `web/e2e/desk.spec.ts` | Main's Technicals test, with the vol column checked as the PROTOTYPE. |
| 3 Hedge with options | `web/src/screens/desk/basket/BasketHedgePage.tsx` | **Main's page** (the three steps, named baskets, the preset, `?add=`, `BasketTrades`, `BasketHedgeStep`); this branch's under-the-cards block dropped. The card mounts in desk/books' slot instead: `BasketHedgeStep.tsx` (not conflicted) takes the saved basket and renders `OptionsHedgeCard` in `data-slot="hedge-options"`. Header comment extended. |
| | `docs/desk/DESK_FRAME3_SPEC.md` | Main's two LIVE basket rows; main's "Hedge with options UNAVAILABLE" row replaced by the PROTOTYPE row (inputs LIVE from the basket engine). |
| | `web/e2e/desk.spec.ts` | Main's Basket test; its "the options slot is plain" lines now check the slot holds the PROTOTYPE (its one button, Advanced, acts; three routes; no badge). Title updated. |
| 4 Positioning | `BasketHedgePage.tsx`, the spec, `desk.spec.ts` | Positioning renders in step 3 below the slot (`pr-below`), for the basket open; spec row "(step 3, below the options slot)"; the e2e check scoped to step 3. |
| 5 Event study on this basket | `BasketHedgePage.tsx`, the spec | Beside Positioning in step 3. The auto-merge left the card's import twice; folded into this commit by a fixup, so no commit fails to compile. |
| R-03 | `TechnicalsPage.tsx`, the spec | R-03's header words over main's (MACD and seasonality kept); R-03's vol row over the merged table, main's four LIVE rows kept. |

The other seven commits (6, 7, 8, 9, R-01, R-02, 10, 11) applied cleanly.
Sha map, pre-rebase → rebased: `d33ea20`→`cbb982a`, `2684125`→`a3e4936`,
`10f631b`→`ef251ed`, `f54ea4c`→`0a41e0d`, `7aeef07`→`53e865e`,
`d1e0ab4`→`061cea3`, `3f856db`→`1669d86`, `08d1f7a`→`cff82f2`,
`24daa38`→`d673f3f`, `fffb83d`→`d715c36`, `e553dfa`→`397a10c`,
`abaf9ed`→`8a95386`, `f440b42`→`5fe3b73`, `9952f77`→`144b1e3`.

Then, as asked, three new commits:

- **12 `dbfcdfa`, the inputs row on the served answer.** `OptionsHedgeCard`
  takes step 3's `useBasketHedge` answer and reads it through `inputsFrom`;
  `BasketHedgeStep` shows the card while that answer is on its way or has
  answered, and desk/books' `OptionsSlot` (its reason) when there is none to
  read. The card spans the step (`.pr-options-slot`). Deleted:
  `proto-books-basket.json`, `basketInputs`, the stand-in's PROVENANCE row
  and tests. The sample basket the event study is drawn for moved into
  `proto-basket-study.json`; the options markers are priced from the fixture
  server's answer. New tests: `inputsFrom` on the served answer (and on a
  missing answer, top, ratio, notional or window), the card's three input
  states, R-02's 0.10 case built from a served answer, the page's slot both
  ways, main's step-3 test on the new slot.
- **13 `5e9a559`, the owner's wording.** Data Pipeline: "Nothing is
  synthetic" → "Every live number comes from stored data; prototype cards
  are marked." (`desk-sections.ts`, spec §1.0.3 rule 7 and §11). Build
  Notes: "A number without that isn't auditable, so there isn't one." and
  "It's absent until it's right; the card has its slot on the page." → each
  "Where a number isn't computed yet, the card says so or is a marked
  prototype." Positioning: "(illustrative)" on short interest, days to cover
  and put/call OI. The "How this was built" section is unchanged.
- **14 `09f9b36`, a layout fix found on the live run.** At 1440 the new
  headers and the preset's longer company names ran Positioning's table 76 px
  past its half-width card, cutting off the Crowding flags. The note now sits
  under the column's name in lowercase sans, and a company name wraps under
  its ticker. Measured live: 563 px of table in a 563 px box.

## After the rebase: run against a local API (definition of done)

Render still serves main before desk/books (`/api/desk/basket/hedge` answers
the awaiting stub, engine `23014d0`), so this branch's API ran locally
(`127.0.0.1:8397`, the published DB copy in `data/`) through desk/books'
harness: its EODHD client's transport relays each daily-bar request to
Render's real EODHD bars (`/api/market/candles/{SYM}?range=1Y`), since the
token lives only on Render. The web app ran from this worktree with Vite
**without** `DESK_FIXTURES`, proxying to it (`VITE_PROXY_TARGET`, port 5397;
both listeners' working directories checked). One year of bars means the
hedge is ranked on 60 sessions, and the card says so. A fresh browser gets
desk/books' preset; the sample basket was then saved as a visitor would.

| Card | Verdict | Evidence |
|---|---|---|
| Basket & Hedge · Hedge with options: the inputs row "from your basket · live" | **LIVE-verified** | Preset: the page's `/basket/hedge` answer was `ready`, EODHD, prices Sep 25, notional 1,000,000, top SOXX, hedge ratio 1.0998, basis 60d, R² 0.8624, window Jul 1 to Sep 25 (60), basket vol 57.7%; the row printed "$1.0M · AI Infrastructure 10 · SOXX, first of 8 by R², ahead of SMH at 0.84 · 1.10 · 0.86, 60 sessions to Sep 25". Sample basket: SMH, 0.9124, R² 0.7345 served; "SMH … ahead of SOXX at 0.68 · 0.91 · 0.73" printed. The page loaded no `basket-hedge.json` (its only fixture modules were the three `proto-*.json` the prototypes own). `live-preset-options-hedge-1440.png`, `live-preset-options-hedge-390.png`, `live-sample-options-hedge-1440.png`, `live-preset-step3-1440.png` |
| Basket & Hedge · Hedge with options: the three routes | **PROTOTYPE** | Priced in the browser from the live inputs (for the preset: puts on SOXX, strikes 95.5%/86.4% of SOXX; NVDA, AVGO, AMD at 30%; the OTC put); footnote last. Same shots. |
| Basket & Hedge · Positioning | **PROTOTYPE** | Retaken after commit 16. The preset (a fresh browser): all ten names with values, "weighted over all 10 names", 4 of 10 crowded, headers "Short int. (illustrative)", "Days to cover (illustrative)", "Put/call OI (illustrative)", no "no data" row. The sample basket: its labels valued "—" and "Illustrative values are shown for the AI Infrastructure 10 preset.", no table. `live-preset-positioning-1440.png`, `live-sample-positioning-1440.png` |
| Basket & Hedge · Event study on this basket | **PROTOTYPE** | Retaken after commit 16. The preset: "After AI Infrastructure 10 falls 2σ over 5 days, it was higher a month later 64% of the time.", 57 events, Suggestive, the chart. The sample basket: the labels and the same one line. `live-preset-step3-1440.png`, `live-sample-positioning-study-1440.png` |
| Data Pipeline · subtitle | **LIVE-verified** | "Every panel in Desk resolves to a row here. Every live number comes from stored data; prototype cards are marked. Nothing is re-derived in the browser." `live-pipeline-subtitle.png` |
| Build Notes · the two sentences | **LIVE-verified** | Both bullets read "Where a number isn't computed yet, the card says so or is a marked prototype." (2 matches on the page, rendered from the file). `live-build-notes-two-sentences.png` |

No card touched by the rebase or after it is FAILED.

## Codex round on 24daa38 (DO NOT PUSH, three findings)

Each fixed in its own commit, with a test built from Codex's repro that
failed before the fix; gates per commit: tsc, `vitest --maxWorkers=2
--minWorkers=1`, the build, and the related tests (the full gates wait for
the rebase onto desk/books).

| Finding | Fix | Test (Codex's repro) | Commit |
|---|---|---|---|
| R-01 Positioning's summaries hid what they cover; a name without data counted as not crowded; CRWV 0% / MSFT 100% printed NaN | The weighted figures say what they cover (weight and names); a name without data reads "no data" and is in no count; a figure without a positive covered weight is "—" with the reason | CRWV 50% / MSFT 50%, MSFT 100%, CRWV 0% / MSFT 100% (`positioning.test.ts`, `BasketHedgePage.test.tsx`) | `fffb83d` |
| R-02 "Hedge with options" priced any hedge ratio: at 0.10 the spread's 85% strike moved to −50% of the ETF and the rows printed NaN | Each structure is priced only inside its domain (a hedge ratio from 0.25 to 4 for the ETF and basket routes, strikes from 50% to 100% of spot, a positive vol, R² in (0, 1], finite results); outside it the row prints its reason and no number, and the route's line names no strike outside the domain | hedge_ratio 0.10 (`options.test.ts`, `OptionsHedgeCard.test.tsx`), and 0.25, NaN, R² 0, a zero vol | `e553dfa` |
| R-03 The protection card's switch fell back to the illustrative figures when `/technicals` was awaiting or failed | The PROTOTYPE stands only when a ready answer serves the vol block awaiting as not yet served; an awaiting or failed route, or an answer without the block, keeps the LIVE card's awaiting or unavailable state | `/technicals` served awaiting, `/technicals` failed 503, a ready answer without the vol block (`TechnicalsPage.test.tsx`) | the R-03 commit (the head) |

## Open for the owner

1. **Merge.** desk/books is merged and this branch sits on it; the inputs row
   is LIVE-verified on a local API. On Render it goes live when main with
   desk/books is deployed there (Render serves `23014d0` today).
2. **The preset and two prototypes.** Settled by commit 16: both are drawn
   for AI Infrastructure 10, and any other basket prints "Illustrative
   values are shown for the AI Infrastructure 10 preset." A renamed preset,
   or the preset with another method or notional, is still the preset.
3. **"Nothing is re-derived in the browser."** The subtitle's last sentence
   now follows "prototype cards are marked", but the options card is priced
   in the browser. Rule 7 scopes it to live numbers; reword if you prefer
   ("No live number is re-derived in the browser.").
4. **Illustrative numbers on real tickers.** Positioning prints short
   interest and 13F shares for NVDA, AVGO, CRWV and the rest; they are
   illustrative, now marked in the column headers as well as the footnote.
5. **Wording I chose:** the footnote lines for "Hedge with options" and "Sync
   to Snowflake" (the brief gave the other three), the effort estimates in
   Build Notes, and the two empty states of the options card ("Nothing is
   priced until the basket's inputs arrive.", "The ETF hedge names no top
   pick for this basket, so nothing is priced.").
