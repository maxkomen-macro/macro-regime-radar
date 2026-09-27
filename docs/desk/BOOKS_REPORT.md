# desk/books — Basket & Hedge from real prices

Branch `desk/books` (worktree `mrr-books`), cut from main `4394e59` on
2026-09-27. Six commits, one per item, **not pushed**:

| # | Commit | Item |
|---|---|---|
| 1 | `b86647a` | Two years of daily bars for any US ticker (`/api/market/candles/{SYM}?range=2Y`) |
| 2 | `84af304` | The basket engine (`src/desk/basket.py`), pure, hand-checked |
| 3 | `8aface4` | Basket technicals against the Nasdaq and the S&P (`/api/desk/basket/price`, `src/desk/technicals.py`, step 2) |
| 4 | `9c7ef6b` | The ETF hedge, ranked, and the linear stress test (`/api/desk/basket/hedge`, step 3) |
| 5 | `15476bd` | Named baskets, notional and method, the AI Infrastructure 10 preset, `?add=` |
| 6 | the commit that carries this report (gated as `f5d98c2`, which is it without this file) | The page in three numbered steps; Build Notes; compare shots; live shots |

Commits 3 to 6 were re-made after gates found faults in them, each time by
amending the commit at fault and replaying the ones after it (no rebase, no
push; every earlier sha is still reachable):

- The full gate on commit 3 (first `198177f`) found that
  `tests/test_desk_api.py`'s route sweep still expected the old
  `/basket/price` stub's 200. Its inventory line moved into commit 3 (a
  bare GET is 422: it names no basket) and the `/basket/hedge` line into
  commit 4. Commit 4 was `0f84719`, then `b16a03e`; commit 5 was `1605132`,
  then `1092331`; commit 6 was `7ac512e`.
- The light gate on commit 4 (`b16a03e`) found that
  `tests/test_desk_v2_envelope.py::test_the_sentences_are_the_specs` could
  not find the new `/basket/:id` sentence in the spec. I had wrapped it
  across lines in §12.13. The paragraph was rewrapped in commit 4
  (`9c7ef6b`), and commits 5 (`15476bd`) and 6 (`878b4db`) were replayed.
- The final e2e on `878b4db` found "never" on the Build Notes page (my
  basket section); commit 6 was amended to `f5d98c2` with "stay fixed".

## What the page is now

Basket & Hedge reads top to bottom in three numbered steps, each card
leading with one sentence that states its answer with served numbers:

1. **Build the basket.** Named baskets kept in this browser (§1.8), each
   with its method and notional; the dropdown, Rename, + New basket (named
   inline), Delete (asks twice), Export / Import JSON; NOTIONAL (default
   $1,000,000) and METHOD (Buy-and-hold, the default, or Monthly rebalance);
   the legs with Equal-weight and Normalize to 100%, and once priced each
   name's weight at the last close and its return since the start. Save
   computes everything below. A browser with no basket store starts with
   **AI Infrastructure 10** (NVDA AVGO AMD TSM MU ANET VRT CEG CRWV NBIS,
   10% each, buy-and-hold, $1M). `/desk/basket-hedge?add=XYZ` adds XYZ to
   the open basket.
2. **How the basket trades.** Basket index (the Technicals chart: 50- and
   200-day averages, crosses, 6M / 1Y); momentum and risk (1-year return,
   RSI(14), drawdown from peak, 21-day realized vol, with RSI and drawdown
   charts); against the Nasdaq and the S&P (basket, QQQ, SPY rebased; beta
   and correlation over 1 year and 60 days); relative strength (basket ÷ QQQ
   and ÷ SPY, each with its 50-day average); contribution to return;
   concentration (top-3 weight, effective names, average pairwise
   correlation); liquidity (days to trade at 20% of 20-day dollar volume, the
   slowest name amber).
3. **Hedge it.** SMH SOXX QQQ XLK IGV XLU SPY IWM ranked by R² of daily
   returns (1 year; 60 days beside it), each with hedge ratio (beta), dollars
   to short, volatility left and the cut, the top pick marked; the stress
   test (QQQ −10%, SPY −10%, unhedged and hedged with the top pick, linear in
   the betas); then the slot **Hedge with options** (`data-slot="hedge-options"`)
   for the desk/prototypes card, not served here.

## The method (also in Build Notes, "Basket & Hedge")

- **Prices.** EODHD daily bars, two years (`range=2Y`, about 731 days),
  split- and dividend-adjusted, completed New York sessions only
  (`api/calendar.last_completed_session`), cached per ticker per session in
  `api/providers/market.daily_bars`; an answer still missing the day's close
  is asked again after 15 minutes. Each bar also carries EODHD's unadjusted
  close (`close_raw`, not in the served candle shape) for dollar volume.
- **Index.** Base 100 on the first session every name has a close; the page
  says whose first close it is (CRWV's, March 2025, for the preset) or that
  every history starts there. A later session one name lacks is dropped from
  the index and counted (`missing_sessions`), not filled.
- **Buy-and-hold** (default): target weights become share counts at the
  start; weights drift. **Monthly**: counts reset to target weights at each
  calendar month's last index session.
- **Contribution**: share count × price change per holding period over the
  notional; the names add up to the index's return exactly.
- **Concentration** at the last close: top-3 weight, effective names
  1 / Σw², mean pairwise Pearson correlation of daily returns over the last
  252 index sessions (all of them when fewer, null under 60).
- **Liquidity**: 20-day mean of unadjusted close × volume per name; days to
  trade = target weight × notional / (0.20 × that); the basket figure is the
  largest. (Target weights: the question is how long to put the basket on.)
- **Technicals**: `src/desk/technicals.level_technicals`, the same function
  `/technicals` reads (moved from `api/desk_items.py`; /technicals is byte-
  identical, checked against HEAD's function on the published DB copy and by
  the unchanged 02-technicals compare shot), plus RSI(14) by §12.13's Wilder
  rule, drawdown from the running peak, 21-day realized vol (sample sd of 21
  daily log returns × √252), every cross.
- **Against QQQ and SPY**: simple daily returns between consecutive sessions
  both have a close; beta = cov / var of the benchmark; the last 252 and 60
  returns, complete or null with the reason ("needs 252 daily returns; there
  are 250 since …"). Relative lines: basket ÷ benchmark over its value on the
  range's base date × 100, each with its 50-session average.
- **ETF hedge**: least squares on daily returns; R² over a year ranks (60
  days when no ETF has a year, and the card says so); hedge ratio = beta;
  dollars to short = beta × notional; volatility left = sd of basket − beta ×
  ETF, × √252 (= basket vol × √(1 − R²)).
- **Stress**: linear in the top pick's window betas; basket move = β(basket,
  shock) × −10%; the short's P&L = −ratio × notional × β(ETF, shock) × −10%
  (β = 1 when the ETF is the shock); no convexity, no costs.

## Spec and contract

`docs/desk/DESK_FRAME3_SPEC.md`: §1.0 marks the basket blocks LIVE (and
options UNAVAILABLE with the slot), §1.0.1's two lists (Build Notes prints
them word for word, `notes/scope.ts`), §1.8 (a basket carries method and
notional), §10 rewritten (the steps, the cards, the named-basket rules),
§12.0 (the routes, the two new error codes), §12.13's basket note (what stays
deferred and why), and the new **§12.14 `GET /basket/price`** and **§12.15
`GET /basket/hedge`** field tables. `tests/desk_contract.py` transcribes both;
the fixtures (`basket-price.json`, `basket-hedge.json`, every answer in them)
are checked against it. The deferred stubs now say what is deferred:
`/basket/:id` "Baskets are kept in this browser; there is no server basket
store.", `/hedge` "option structures for a basket not yet defined in the
engine."

## Where an instruction and the tree disagreed (the tree was followed)

1. **"Reuse the main dashboard's asset-history endpoint; extend it with volume
   if needed."** The endpoint is `/api/market/candles/{SYM}`; it already
   carried volume, but served daily bars only up to 1Y (5Y is weekly, 2Y and
   3Y were refused). Per your message mid-session, I added `range=2Y` daily
   (EODHD supports it) and built the basket on two years; the test you asked
   for is `tests/test_providers.py::test_route_range_2y_returns_daily_bars`.
   `/api/market/daily` was not used.
2. **"Use the same shared technicals function as the Technicals page (reuse
   the main dashboard's)."** The main dashboard (React Markets) has only a
   client-side `movingAverage`; the Technicals page's function is the
   server's `technicals_from_level`. That one is now the shared function
   (`src/desk/technicals.py`), reused for the basket; the Technicals page's
   chart became the kit's `TrendChart`, drawn by both pages. RSI lives in the
   same module, by spec §12.13's rule; `/technicals` does not serve it (§1.0
   keeps the RSI card unavailable). **Reconcile at rebase** with
   desk/fill-compute if it adds RSI elsewhere.
3. **InstrumentSearch** (desk/usability) has not landed: adding a name is a
   plain input checked against the price endpoint (`basket/check.ts`); a
   ticker it does not list is refused in its words; an unanswered check adds
   the name and says so. **Switch at rebase.**
4. **The options step** is desk/prototypes'. This branch leaves the slot
   ("Hedge with options", mode labels and stat labels kept, unavailable
   state, no numbers), so no PROTOTYPE values appear here and no footnote
   is needed.
5. **The PNG (screens/09) is two columns;** the request is three steps top to
   bottom. The request wins; §10 says so; the cards keep the PNG's visual
   language. The compare shot is regenerated and differs from the PNG by
   design.
6. **Spec §1.0 and §12.13 had the basket unavailable and `/basket/price` as
   a deferred stub** (POST 405). The GET route is now live; POST still 405.
7. **"Everything computed from real prices."** The API computes from EODHD.
   There is no EODHD token on this machine (it lives on Render), so the
   fixtures are real closes from Yahoo's two-year history through
   2026-09-23, run through the API's own functions
   (`scripts/desk_basket_fixture.py`), and each fixture answer says
   `provider: "Yahoo"`. Yahoo re-adjusts closes on each fetch, so regenerating
   moves the 7th–8th digit.

## Outside the brief, and why

- `web/src/screens/desk/event-study/EventStudyPage.test.tsx` (commit 3): a
  test restored `URL.revokeObjectURL` to `undefined` while its export's
  one-second timer was pending; under this machine's load (average 20–64
  today, other sessions' suites running) the timer fired after the test and
  vitest failed the run with an unhandled error. It now restores a no-op.
  Test-only.
- The gate harness's e2e once ran against another session's dev server that
  held the port (mrr-compute on 5193 and 5293). The gate now takes the first
  free port and checks the listening process's working directory is the
  exported commit before running Playwright; the affected run was redone.

## Gates

Each gate ran on the commit itself: `git archive <sha>` into a scratch tree
with the DB copies (`data/macro_radar.db` = the published copy of 2026-09-24,
sha `9a8b8579…`; `data/desk_scratch.db` = hardening's), `web/node_modules`
linked from mrr-frame3 (same lock).

Commits 1 to 3 ran the full gate (tsc, vitest, build, full pytest, the full
Desk Playwright e2e against `DESK_FIXTURES=1 npx vite` on a port whose
listener was checked to be the export). From commit 4 on, by your change of
policy for the overloaded machine (five sessions, 60–90 minutes a pytest):
tsc, `vitest --maxWorkers=2`, build, and pytest over `tests/test_desk*.py`
(every test file these commits touch is among them); the head then ran the
full pytest and the full Desk e2e (`--workers=1`) once, holding
`/tmp/mrr-full-gates.lock` so no other session ran a full suite meanwhile.

| Commit | tsc | vitest | build | pytest | Desk e2e |
|---|---|---|---|---|---|
| 1 `b86647a` | pass | 124 files, 1,535 | pass | full: 1,592 passed; the 2 known `test_asset_history` | 54/54 |
| 2 `84af304` | pass | 124 files, 1,535 | pass | full: 1,605 passed; the 2 known | 54/54 (the first run was against another session's server on a taken port; redone on a verified one) |
| 3 `8aface4` | pass | 125 files, 1,542 | pass | full: 1,627 passed; the 2 known; 6 timing tests under load (below) | 54/54 |
| 4 `9c7ef6b` | pass | 125 files, 1,543 | pass | `tests/test_desk*`: 620 passed; the 3 SQL-guard timing tests under load (below); the spec-sentence test failed on `b16a03e` and passes here (the spec-reading suites: 158 passed, web 27) | by policy, at the head |
| 5 `15476bd` | pass | 126 files, 1,553 | pass | `tests/test_desk*`: 620 passed; the 3 SQL-guard timing tests; the route sweep got 202 `computing` from `/api/desk/event-study` (a study past 8 s under load) and passes run alone on the same export (1 passed, 22 s); this commit changes nothing under `api/`, `src/`, `tests/` or `scripts/` | by policy, at the head |
| 6 (first `7ac512e`, `878b4db`) | pass | 126 files, 1,554 | pass | full (below) | full (below) |

**The final gates.** On `878b4db` (commit 6 before the report), holding
`/tmp/mrr-full-gates.lock` from 19:43:54 until the e2e finished: the full
pytest, serial, 26 minutes: **1,638 passed, 6 failed**: the 2 known
`test_asset_history` failures and the four timing tests named below; the
full Desk e2e, `--workers=1`: **54 passed, 1 failed**: the Build Notes page
rendered "never" from my basket section ("share counts … never change").
Only the rendered page is held to the whole banned-word list; the notes
file's own check enforces "established" and "significant". It now reads
"stay fixed". That one word is the only change from `878b4db` to the head
`f5d98c2` (no Python test or script reads `BUILD_NOTES.md`). On the head:
tsc pass; vitest (2 workers) 126 files, **1,554 passed**; build pass; the
full Desk e2e, `--workers=1`, holding the lock from 20:54:34 to 20:56:48:
**55/55**. With the lock released, the four timing tests that failed in the
full pytest ran alone on the head's export: **4 passed** (20 s)
(`test_desk_api.py`'s three SQL-guard budgets and
`test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently`).
Adding this report to commit 6 is the only change after these gates.

**Timing tests under load.** Commit 3's full pytest took 90 minutes beside a
dozen other sessions' suites (load average 15–64). Six tests with wall-clock
budgets failed there: `test_desk_api.py::test_a_job_whose_generation_expired_is_cancelled_and_the_client_gets_a_fresh_202`,
`::test_two_generations_of_one_file_with_different_cutoffs_never_share_a_cached_study`,
`tests/test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently`
(these three pass run alone on the same export), and the assistant SQL
guard's `::test_the_query_tool_stops_a_cross_join_within_300_ms_and_explains_how_to_rewrite`
(330 ms against 300), `::test_a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms`
(32.8 ms against 20) and `::test_the_assistants_sql_runs_on_a_private_copy_that_never_stalls_other_readers`
(error; 624 ms against 20), which failed alone too while the machine was
loaded, and fail identically on main `4394e59` run the same way at the same
time. This branch does not touch the assistant, its SQL guard or the
provider profile.

Baseline on main `4394e59`: web 124 files / 1,535 tests; pytest 1,587 passed
with 3 failed (the 2 known `test_asset_history` DB-copy failures and one
`test_generations` timing failure under load that did not recur); Desk e2e
54/54. The native event-study regression (`scripts/desk_native_ab.py --base
origin/main`) is byte-identical 16/16 on both DB copies after the engine
changes.

## Live verification (against real data, no fixtures)

**How.** There is no EODHD token here, so this branch's API ran locally
(`127.0.0.1:8391`, the published DB copy) with its EODHD client's transport
relaying each daily-bar request to the deployed API's real EODHD bars,
`https://macro-economic-radar-api.onrender.com/api/market/candles/{SYM}?range=1Y`
(a scratchpad harness, not committed: `market.set_client_for_tests(EodhdClient(…,
transport=Relay()))`, then `uvicorn.run(app)`). The web app ran without
`DESK_FIXTURES`, proxied to that API. Technicals ran against the deployed API
directly (its `/technicals` exists there).

**What this shows and what it does not.** Every basket card computed and
rendered from real EODHD closes through this branch's code, end to end
(`/api/desk/basket/price` 1.7 s cold for the ten-name preset). The deployed
API serves one year of daily bars (the 2Y range is this branch's), so the
live run has one year: the 1-year return and 1-year betas are served null
with their reasons (250 returns, not 252), the hedge is ranked on 60 days
(and says so), and the 200-day average covers the chart's last ~50 sessions.
The relay's closes are already adjusted, so there the dollar volume reads the
adjusted close. EODHD's own 2Y fetch was verified only against a mocked
upstream; it goes live when this branch is deployed with the token.

Shots: `docs/desk/shots/desk-books/`: `live-before-*` (the live site before),
`live-basket-preset-*` (a fresh browser: the preset), `live-basket-sample-*`
(`baskets.json`'s sample basket), `live-basket-add-flow-*` (`?add=ORCL`, then
ZZZZQ refused: "ZZZZQ was not added: No listing found for 'ZZZZQ' on
EODHD.", then Save priced eleven names), `live-technicals-render-*`.

| Card | Page | Verdict | Evidence |
|---|---|---|---|
| Page badge `● Live · EODHD · Sep 25` | Basket & Hedge | LIVE-verified | preset page shot |
| Basket (step 1: dropdown, rename, new, notional, method, legs with weight now and since start, lead sentence) | Basket & Hedge | LIVE-verified | `live-basket-*-01-basket.png`, add-flow shots |
| Basket index | Basket & Hedge | LIVE-verified (one year of history live; the two-year 200-day line on fixtures and mocks) | `…-02-basket-index.png` |
| Momentum and risk | Basket & Hedge | LIVE-verified | `…-03-momentum-and-risk.png` (1-year return "—, needs 252 sessions; it has 251") |
| Against the Nasdaq and the S&P | Basket & Hedge | LIVE-verified | `…-04-…png` (1Y betas "—" with the reason, 60D served) |
| Relative strength | Basket & Hedge | LIVE-verified | `…-05-relative-strength.png` |
| Contribution to return | Basket & Hedge | LIVE-verified | `…-06-contribution-to-return.png` |
| Concentration | Basket & Hedge | LIVE-verified | `…-07-concentration.png` |
| Liquidity | Basket & Hedge | LIVE-verified (relay: adjusted close × volume) | `…-08-liquidity.png` |
| Hedge with an ETF | Basket & Hedge | LIVE-verified (ranked on 60 days live) | `…-09-hedge-with-an-etf.png` |
| Stress test | Basket & Hedge | LIVE-verified | `…-10-stress-test.png` |
| Hedge with options | Basket & Hedge | PROTOTYPE (the slot; the card is desk/prototypes', no values on this branch) | `…-11-hedge-with-options.png` |
| S&P 500 price and its two trend lines (now the kit's TrendChart) | Technicals | LIVE-verified against the deployed API | `live-technicals-render-02-s-p-500.png`, identical numbers to `live-before-technicals.png` |

No card is FAILED.

## Follow-ups

- **Deploy**: the API image needs this branch for `range=2Y` and the two
  routes; the first request for a basket costs one EODHD call per ticker per
  session (a ten-name basket plus eight ETFs: 18), then the day's cache.
- **Rebase**: desk/usability's InstrumentSearch replaces the add input;
  desk/fill-compute's RSI reconciles into `src/desk/technicals.rsi_wilder`;
  desk/prototypes' options card mounts in `data-slot="hedge-options"`.
- A request that fetches many cold histories is synchronous (four at a time);
  a slow EODHD day could pass the browser's 15 s abort. The Desk's `computing`
  (202) pattern would fit if that shows up.
- `AGENTS.md` predates the Desk v2 notes and was left as it was.
