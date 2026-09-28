# desk/books — Basket & Hedge from real prices

Branch `desk/books` (worktree `mrr-books`), cut from main `4394e59` on
2026-09-27, and rebased onto main `23014d0` after desk/fill-etf and
desk/fill-compute merged ("Rebase onto main `23014d0`" below: every
conflicted file, its resolution, and the old-to-new sha map). The shas in
the sections before it are the pre-rebase ones, kept on
`backup/desk-books-pre-rebase`. Six commits, one per item, **not pushed**:

| # | Commit | Item |
|---|---|---|
| 1 | `b86647a` | Two years of daily bars for any US ticker (`/api/market/candles/{SYM}?range=2Y`) |
| 2 | `84af304` | The basket engine (`src/desk/basket.py`), pure, hand-checked |
| 3 | `8aface4` | Basket technicals against the Nasdaq and the S&P (`/api/desk/basket/price`, `src/desk/technicals.py`, step 2) |
| 4 | `9c7ef6b` | The ETF hedge, ranked, and the linear stress test (`/api/desk/basket/hedge`, step 3) |
| 5 | `15476bd` | Named baskets, notional and method, the AI Infrastructure 10 preset, `?add=` |
| 6 | `125258c` | The page in three numbered steps; Build Notes; compare shots; live shots; this report's first version |

Then Codex's review of `f5d98c2` (DO NOT PUSH, 14 findings), fixed one
finding or tightly related group per commit (the table below):

| Commit | Findings |
|---|---|
| `0a0745f` | R-02, R-03, R-06: the engine on the XNYS calendar |
| `2c80b97` | R-01: the stress on one shared window at the basket's cutoff |
| `5edce46` | R-04, R-05: liquidity on the trailing 20 sessions, whole or not served |
| `3d19e9b` | R-07: adjusted closes only |
| `3c40c01` | R-13: the daily-bar refresh under the key's single-flight lock |
| `71ad891` | R-08, R-09: each answer's own date, and the stress window in words |
| `7897dcf` | R-10, R-12: no zero-weight leg, and ticker checks bound to their basket |
| `f5ea56e` | R-14, R-11: a plain options slot; the import follow-up in Build Notes |
| `9dcd5cc` | Build Notes' basket method after the review; the live shots re-taken on the fixed head |
| `11f9f4f` | this report after round 1: the findings table and the gates |

Codex's second review (of `f5d98c2..11f9f4f`) found R-01 to R-14 fixed
(R-11 deferred) and one new blocking finding, R-15, fixed in one commit:

| Commit | Findings |
|---|---|
| `591a01f` | R-15: the stress holds the short the ETF table recommends, and the card names it |
| the commit that carries this report | the R-15 row and the gates after it |

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

## Codex's findings

Codex reviewed `f5d98c2` against main `4394e59` and returned DO NOT PUSH
with 14 findings, seven blocking; its second review, of `f5d98c2..11f9f4f`,
confirmed R-01 to R-14 fixed (R-11 deferred) and added R-15, blocking. Each
test below was built from Codex's own repro (read from its session log) and
asserts the corrected value beside the one Codex reported; all pass at the
head.

| ID | Severity | Fix commit | Test |
|---|---|---|---|
| R-01 | blocking | `2c80b97` | `tests/test_desk_basket.py::test_codex_r01_the_stress_never_reads_etf_closes_after_the_basket` (the basket = QQQ for 60 returns, SMH 3× QQQ for 60 more: hedged $0, was about +$200,000); `::test_the_stress_says_why_when_the_three_share_too_few_returns`; `tests/test_desk_basket_api.py::test_the_stress_is_linear_in_betas_fitted_on_one_shared_window` |
| R-02 | blocking | `0a0745f` | `tests/test_desk_basket.py::test_codex_r02_a_missing_session_is_a_missing_return_not_a_two_day_one` (Jan 26–30: beta 3.3333 on the two valid returns, was 2.0513; a 3-return window is null with its reason) |
| R-03 | blocking | `0a0745f` | `::test_codex_r03_the_start_is_the_first_session_the_basket_is_bought_at` (A Jan 28/30, B Jan 29/30: start Jan 30 at Jan 30's closes, `start_kind` "gap"); `web/.../trades.test.ts` (the gap in words) |
| R-04 | blocking | `5edce46` | `::test_codex_r04_one_name_without_adv_leaves_the_basket_figure_unserved`; `BasketHedgePage.test.tsx` "Codex R-04: …" |
| R-05 | blocking | `5edce46` | `::test_codex_r05_adv_reads_the_trailing_20_xnys_sessions_not_the_last_20_rows` (Jan 2–Feb 2 without Jan 16: not a complete ADV) |
| R-06 | blocking | `0a0745f` | `::test_codex_r06_the_final_session_rebalances_when_it_is_the_month_end` (A 100/200/200, B flat, monthly: 50/50 on Jan 30, was 66.7/33.3) |
| R-07 | blocking | `3d19e9b` | `tests/test_desk_basket_api.py::test_codex_r07_a_bar_without_an_adjusted_close_is_left_out_and_disclosed` (the mocked split: 0%, was −50%); `::test_a_symbol_with_no_adjusted_close_at_all_is_refused`; `trades.test.ts` "Codex R-07" |
| R-08 | high | `71ad891` | `BasketHedgePage.test.tsx` "Codex R-08: …" (price Sep 23, hedge Sep 22: both dates and the mismatch shown); `trades.test.ts` "Codex R-08" |
| R-09 | high | `71ad891` | `trades.test.ts` "Codex R-09: …" (a 60-session basis never reads one year); the R-08 page test reads the footnote |
| R-10 | high | `7897dcf` | `weights.test.ts` "Codex R-10: …" (NVDA 60 / AVGO 40 + QQQ: 33.4 / 33.3 / 33.3, was QQQ 0%); `BasketHedgePage.test.tsx` "Codex R-10: Save refuses a leg at 0%" |
| R-11 | high | not fixed, by your decision | Build Notes, "What I'd build next" (`f5ea56e`): import drops a basket whose name and names match one here even when its method or notional differs |
| R-12 | high | `7897dcf` | `BasketHedgePage.test.tsx` "Codex R-12: …" (a QQQ check held while basket B is opened adds nothing to B) |
| R-13 | high | `3c40c01` | `tests/test_providers.py::test_codex_r13_a_stale_daily_entry_is_refreshed_once_under_concurrency` (four concurrent calls: one upstream computation, were four) |
| R-14 | low | `f5ea56e` | `BasketHedgePage.test.tsx` (the options slot has no button and no Advanced control); `web/e2e/desk.spec.ts` (the same in the browser) |
| R-15 | blocking (round 2) | `591a01f` | `tests/test_desk_basket.py::test_codex_r15_the_stress_holds_the_short_the_table_recommends` (121 XNYS sessions, $1M basket: the table recommends $1M of SMH; QQQ −10% hedged −$200,000, was about $0 from a silently refitted $3M short; the pre-fix `stress` from `11f9f4f` run on the same case gives hedge ratio 3.0 and $0); `tests/test_desk_basket_api.py::test_codex_r15_the_answer_stresses_the_short_its_table_recommends` (the same through `hedge_answer`: the stress row's `short_usd` is the table's); `::test_the_stress_without_a_recommended_short_says_so`; `trades.test.ts` "Codex R-15: …" and `BasketHedgePage.test.tsx` (the card names the short it holds) |

The fixture script gained `--cache`: Yahoo re-adjusts its closes on every
download, so the fixtures moved by a dollar between regenerations; with one
cached download they now regenerate byte for byte.

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
- **Calendar.** Every series sits on the XNYS calendar (`exchange_calendars`,
  through the end of the month after the last close). A daily return is a
  simple return between two consecutive sessions that both have a close; a
  gap is a missing return, never one spanning two sessions (R-02).
- **Index.** Base 100 on the first calendar session every name has a close,
  the one the share counts are bought at (R-03); the page says why it is
  there: a later first close (CRWV's, March 2025, for the preset), the
  start of every history, or a gap (the name and the session it had no
  close on). A later session one name lacks is dropped from the index and
  counted (`missing_sessions`), not filled.
- **Buy-and-hold** (default): target weights become share counts at the
  start; weights drift. **Monthly**: counts reset to target weights at each
  completed month's month-end (its last XNYS session by the calendar, the
  final observation included; R-06).
- **Contribution**: share count × price change per holding period over the
  notional; the names add up to the index's return exactly.
- **Concentration** at the last close: top-3 weight, effective names
  1 / Σw², mean pairwise Pearson correlation of the names' one-session
  returns over the last 252 sessions every name has one (all when fewer,
  null under 60).
- **Liquidity**: the mean of unadjusted close × volume over the trailing 20
  XNYS sessions ending at the index's last session, and only when every one
  of them has a dollar volume (R-05); days to trade = target weight ×
  notional / (0.20 × that); the basket figure is the largest, and is not
  served, with its reason, when any name has none (R-04).
- **Adjusted closes only**: a bar EODHD served without an adjusted close is
  left out and disclosed (`excluded`), never priced from its raw close; a
  symbol with none at all is refused (R-07).
- **Technicals**: `src/desk/technicals.level_technicals`, the same function
  `/technicals` reads (moved from `api/desk_items.py`; /technicals is byte-
  identical, checked against HEAD's function on the published DB copy and by
  the unchanged 02-technicals compare shot, and again against main's after
  the rebase), plus RSI(14) by §12.13's Wilder rule and 21-day realized vol
  (sample sd of 21 daily log returns × √252), both since the rebase from
  desk/fill-compute's `src/analytics/technicals`, drawdown from the running
  peak, every cross.
- **Against QQQ and SPY**: one-session returns both have, up to the
  basket's last session; beta = cov / var of the benchmark; the last 252 and
  60 of them, complete or null with the reason ("needs 252 daily returns;
  there are 250 since …"). Relative lines: basket ÷ benchmark over its value
  on the range's base date × 100, each with its 50-session average.
- **ETF hedge**: least squares on one-session returns up to the basket's last
  session; R² over a year ranks (60 days when no ETF has a year, and the card
  says so); hedge ratio = beta; dollars to short = beta × notional;
  volatility left = sd of basket − beta × ETF, × √252 (= basket vol ×
  √(1 − R²)).
- **Stress**: hedged means the short the ETF table recommends for the top
  pick, `short_usd` = its hedge ratio × notional, held as it is under both
  shocks and named on the card (R-15). The shock betas are fitted on one
  shared window (R-01): the last n sessions (n from the top pick's basis) up
  to the basket's last session on which the basket, the top ETF and the
  shock each have a one-session return; basket move = β(basket, shock) ×
  −10%; the short's P&L = −`short_usd` × β(ETF, shock) × −10% (β = 1 when
  the ETF is the shock); the footnote names the window (R-09); no
  convexity, no costs.
- **Dates**: steps 2 and 3 each show their own answer's date, and a hedge
  answered at another session than the price is said (R-08).

## Spec and contract

`docs/desk/DESK_FRAME3_SPEC.md`: §1.0 marks the basket blocks LIVE (and
options UNAVAILABLE with the slot), §1.0.1's two lists (Build Notes prints
them word for word, `notes/scope.ts`), §1.8 (a basket carries method and
notional), §10 rewritten (the steps, the cards, the named-basket rules),
§12.0 (the routes, the two new error codes), §12.13's basket note (what stays
deferred and why), and the new **§12.15 `GET /basket/price`** and **§12.16
`GET /basket/hedge`** field tables (§12.14 and §12.15 before the rebase:
desk/fill-etf's `/sectors` took §12.14 meanwhile). `tests/desk_contract.py` transcribes both;
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
   chart became the kit's `TrendChart`, drawn by both pages. RSI lived in the
   same module, by spec §12.13's rule, until the rebase: desk/fill-compute's
   `src/analytics/technicals` now holds the one RSI, realized volatility,
   MACD and seasonality, and both pages read them from there (see "Rebase
   onto main `23014d0`").
3. **InstrumentSearch** (desk/usability) has not landed: adding a name is a
   plain input checked against the price endpoint (`basket/check.ts`); a
   ticker it does not list is refused in its words; an unanswered check adds
   the name and says so. **Switch at rebase.**
4. **The options step** is desk/prototypes'. This branch leaves the slot:
   the card's title, its "Not yet served" badge and one unavailable line, with no
   controls since R-14 (the three mode buttons and Advanced are gone) and no
   numbers, so no PROTOTYPE values appear here and no footnote is needed.
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

## Rebase onto main `23014d0`

After Codex's PUSH OK on R-15, `git fetch origin && git rebase origin/main`
onto `23014d0` (desk/fill-etf, PR #9, and desk/fill-compute, PR #10,
merged). The pre-rebase head, `58bf113`, is kept on the local branch
`backup/desk-books-pre-rebase`. Commits 1, 2, 5 and 7 to 18
applied without conflicts; 3, 4 and 6 conflicted.

**Commit 3** (`8aface4` → `39e2a9c`), the technicals and the first live basket route:

| File | Conflict | Resolution |
|---|---|---|
| `api/desk_items.py` | main (desk/fill-compute) added RSI, MACD and seasonality inside its copy of `technicals_from_level`; this branch had moved that function to `src/desk/technicals.level_technicals` | One implementation. `technicals_from_level` is `level_technicals` plus main's `rsi_fields`, `macd_fields` and `seasonality_fields`, kept as main wrote them, computed from the aligned closes `level_technicals` now returns (`_aligned`, not served); main's `vol_gap` untouched. In the same resolution `src/desk/technicals.py` drops this branch's `rsi_wilder` and `realized_vol` and reads main's `src.analytics.technicals.rsi` and `realized_vol` (÷ 100: main's is in points), `api/desk_basket.py` drops `_aligned` with `_sessions`, and `tests/test_desk_technicals.py` pins the basket's extras to main's two functions. Checked: the `/technicals` item on the published DB copy is byte-identical to main's (133,666 bytes, RSI 59.28 on Sep 21, MACD, seasonality Feb 1990 to Aug 2026); the basket's RSI is bit-identical to the old one, its realized volatility within 2e-15 |
| `web/src/screens/desk/technicals/TechnicalsPage.tsx` | the imports: main's MACD card and gauge use `LineChart`, `extentTicks`, `DESK_ACCENTS`, `Gauge`; this branch drew the price chart with `kit/TrendChart` | Both: the price chart stays the kit's `TrendChart` (shared with Basket & Hedge; main had not changed it), main's MACD, RSI and seasonality cards unchanged. `monthTicks` is imported from `kit/TrendChart` and re-exported: main's MACD chart calls it, and this branch's bare re-export would have left the name unbound |
| `api/desk_envelope.py` | the route list: main made `/sectors` live, this branch `/basket/price` | Live: main's nine, `/sectors`, `/basket/price`; stubs `/vol`, `/positions`, `/basket`, `/hedge`; `LIVE_ROUTES = 11`. The auto-merge had left `/sectors` among the stubs |
| `web/src/screens/desk/data/envelope.ts` | auto-merged the same wrong order | Put in the Python list's order |
| `tests/desk_contract.py`, `tests/test_desk_contract.py` | both sides added a live route and its fixture | Both routes and both fixtures; the contract test slices by `env.LIVE_ROUTES` (this branch) rather than main's literal 10 |
| `docs/desk/DESK_FRAME3_SPEC.md` | §12.0's route paragraph | Lists `/sectors` (§12.14) and the basket route; neither is a stub any more |
| `web/src/fixtures/desk/PROVENANCE.md` | the deferred rows | Main's rows (`deferred-regime.json` is gone on main, `sectors.json` is served) plus this branch's basket row |
| `web/src/fixtures/desk/index.ts` | a comment on the stubs | Both: `/sectors` served since desk/fill-etf, `/basket/price` since desk/books |
| `web/src/screens/desk/event-study/EventStudyPage.test.tsx` | auto-merged, not conflicted | Main's file taken whole: its timer-leak fix (wait for the object URL's revoke before restoring the stubs) replaces this branch's no-op restore |

**Commit 4** (`9c7ef6b` → `c939a07`), the hedge route: `api/desk_envelope.py`
(the list gains `/basket/hedge`, `LIVE_ROUTES = 12`; the reasons are this
branch's `BASKET_REASON` and `OPTIONS_REASON`, and main's removal of
`RSI_REASON` stands, which `test_desk_v2_envelope.py` checks),
`web/src/screens/desk/data/envelope.ts`, `tests/desk_contract.py`,
`tests/test_desk_contract.py`, `docs/desk/DESK_FRAME3_SPEC.md` and
`web/src/fixtures/desk/PROVENANCE.md`, each resolved as in commit 3 with the
hedge route and fixture added.

**Commit 6** (`125258c` → `5440746`), the page and Build Notes:

| File | Resolution |
|---|---|
| `CLAUDE.md` | Both session lines, desk/books first |
| `docs/desk/BUILD_NOTES.md` | What is live: main's list (sectors, RSI, MACD, seasonality, what each regime has meant, the ETFs) plus the Basket & Hedge sentence. What I'd build next: main's order, since the sector ETFs and the RSI signals this branch listed are done; the options item keeps this branch's wording (the vol card and the options hedge on a basket) |

**Follow-through** (`160d656`): desk/fill-etf's `/sectors` took §12.14, so
the basket routes move up one, `GET /basket/price` to §12.15 and
`GET /basket/hedge` to §12.16, in the spec and every reference (57 lines in
20 files; main's `/sectors` references stay §12.14). The basket fixtures
are regenerated from the same cached Yahoo closes through the merged code
(the three realized-volatility values moved in the 15th digit; nothing else
moved). CLAUDE.md records the rebase and the one technicals stack.

| Before | After | Commit |
|---|---|---|
| `b86647a` | `7b3ea9e` | 1: two years of daily bars |
| `84af304` | `b01d345` | 2: the basket engine |
| `8aface4` | `39e2a9c` | 3: basket technicals |
| `9c7ef6b` | `c939a07` | 4: the ETF hedge and the stress test |
| `15476bd` | `8395018` | 5: named baskets |
| `125258c` | `5440746` | 6: the three steps, Build Notes |
| `0a0745f` | `b343d2f` | R-02, R-03, R-06 |
| `2c80b97` | `ab3112c` | R-01 |
| `5edce46` | `966ee0c` | R-04, R-05 |
| `3d19e9b` | `aaf416e` | R-07 |
| `3c40c01` | `024534e` | R-13 |
| `71ad891` | `8b1ed2e` | R-08, R-09 |
| `7897dcf` | `ac2d113` | R-10, R-12 |
| `f5ea56e` | `a1aca75` | R-14, R-11 |
| `9dcd5cc` | `a1fa2df` | Build Notes after the review, live shots |
| `11f9f4f` | `59b466a` | the report after round 1 |
| `591a01f` | `8b574f7` | R-15 |
| `58bf113` | `5eaf0e2` | the report after round 2 |
| — | `160d656` | the rebase follow-through |

**Gates on the rebased head `160d656`** (the same harness: a `git archive`
export with the published DB copy and the scratch store): tsc pass; vitest
(2 workers) 126 files, **1,590 passed**; build pass; then, holding
`/tmp/mrr-full-gates.lock` from 23:59:23 until the e2e finished, the full
pytest, serial, 10 minutes: **1,766 passed, 1 skipped, 2 failed**. The two
failures are the known `test_asset_history` DB-copy ones. The skip is
main's `tests/test_desk_etf.py:192`, which needs `DESK_ETF_STORE`, the ETF
fixture store. The provider-profile timing test passed this time. The full
Desk e2e, `--workers=1`, on a port whose listener was checked to be the
export: **55/55** (`web/e2e/desk.spec.ts` is the only Desk spec). Adding
this report's rebase section is the only change after the gate.

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
| `0a0745f` R-02/03/06 | pass | 126 files, 1,554 | pass | basket/provider/desk: 704 passed | at the head |
| `2c80b97` R-01 | pass | 126 files, 1,554 | pass | 706 passed | at the head |
| `5edce46` R-04/05 | pass | 126 files, 1,555 | pass | 707 passed | at the head |
| `3d19e9b` R-07 | pass | 126 files, 1,556 | pass | 709 passed | at the head |
| `3c40c01` R-13 | pass | 126 files, 1,556 | pass | 710 passed | at the head |
| `71ad891` R-08/09 | pass | 126 files, 1,559 | pass | 710 passed | at the head |
| `7897dcf` R-10/12 | pass | 126 files, 1,562 | pass | 710 passed | at the head |
| `f5ea56e` R-14/11 | pass | 126 files, 1,562 | pass | 710 passed | at the head |
| `9dcd5cc` (docs and shots) | pass | 126 files, 1,562 | pass | full: 1,650 passed (below) | 55/55 (below) |
| `591a01f` R-15 | pass | 126 files, 1,563 | pass | basket/provider/desk: 713 passed; full: 1,653 passed (below) | 55/55 (below) |

The fix commits' pytest ran `tests/test_providers.py`,
`tests/test_api_lookup.py`, `tests/test_provider_no_yahoo.py` and every
`tests/test_desk*.py` (23 files), with no failure on any of the eight.

**The final gate after R-15.** On `591a01f`, the head before this report's
round-2 update. The light gate first: tsc pass, vitest (2 workers) 126
files and **1,563 passed**, build pass, and the provider tests plus every
`tests/test_desk*.py`, **713 passed**. Then the final gate. It repeated
tsc, vitest (1,563) and the build, all passing. Then it held
`/tmp/mrr-full-gates.lock` from 23:24:00 until the e2e finished; another
session's full pytest took the lock at 23:35:08, after the script's exit
trap had released it.
- The full pytest, serial, 9 minutes: **1,653 passed, 3 failed**. Two are
  the known `test_asset_history` DB-copy failures. The third is
  `test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently`
  again: its calls overlapped, but it took 0.85 s against its 0.71 s bound
  under load. Run alone on the same export afterwards it **passed**
  (0.40 s).
- The full Desk e2e, `--workers=1`, on a port whose listener was checked to
  be the export: **55/55**.

Adding this report's round-2 update is the only change after the gate.

**The final gate after round 1.** On `9dcd5cc`, the head before this
report: tsc pass; vitest (2 workers) 126 files, **1,562 passed**; build pass;
then, holding `/tmp/mrr-full-gates.lock` from 22:24:21 until the e2e
finished (released by the script's exit trap; mrr-usability took it at
22:35:52): the full pytest, serial, 9 minutes: **1,650 passed, 3 failed**:
the 2 known `test_asset_history` DB-copy failures, and
`tests/test_provider_no_yahoo.py::test_the_profile_makes_its_two_eodhd_calls_concurrently`,
whose calls overlapped (that assertion held) but took 0.75 s against its
0.71 s bound under load; run alone on the same export afterwards it
**passed** (0.42 s). The full Desk e2e, `--workers=1`, on a port whose
listener was checked to be the export: **55/55**. The profile's code is as
on main; the cache class it shares (`KeyedTTLCache.get`) gained R-13's
optional `stale` argument, which the profile does not pass (one `is not None`
test per hit). At the time, adding this report (`11f9f4f`) was the only
change after that gate.

**The first final gates, before the review.** On `878b4db` (commit 6 before the report), holding
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
At the time, adding this report to commit 6 was the only change after
these gates.

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

After R-15 (`591a01f`) both baskets were shot live again through the same
relay. Cards 1 to 9 came out byte-identical to `9dcd5cc`'s shots. The options
card's pixels moved with its position but its content is the same, so the
committed shot was kept. The stress card and the full page are re-taken. The
stress figures did not move: every name has every session of the 60-session
window, so the table's ratio and the shared window's refit agree. What is new
is the short the card names. The compare shot `09-basket-hedge` was
regenerated from the fixtures; it had last been made in commit 6, before the
round-1 changes to the page.

| Card | Page | Verdict | Evidence |
|---|---|---|---|
| Page badge `● Live · EODHD · Sep 25`, and steps 2 and 3 each with its own `prices Sep 25` (R-08) | Basket & Hedge | LIVE-verified | preset page shot |
| Basket (step 1: dropdown, rename, new, notional, method, legs with weight now and since start, lead sentence) | Basket & Hedge | LIVE-verified | `live-basket-*-01-basket.png`, add-flow shots |
| Basket index | Basket & Hedge | LIVE-verified (one year of history live; the two-year 200-day line on fixtures and mocks) | `…-02-basket-index.png` |
| Momentum and risk | Basket & Hedge | LIVE-verified | `…-03-momentum-and-risk.png` (1-year return "—, needs 252 sessions; it has 251") |
| Against the Nasdaq and the S&P | Basket & Hedge | LIVE-verified | `…-04-…png` (1Y betas "—" with the reason, 60D served) |
| Relative strength | Basket & Hedge | LIVE-verified | `…-05-relative-strength.png` |
| Contribution to return | Basket & Hedge | LIVE-verified | `…-06-contribution-to-return.png` |
| Concentration | Basket & Hedge | LIVE-verified | `…-07-concentration.png` |
| Liquidity | Basket & Hedge | LIVE-verified (relay: adjusted close × volume) | `…-08-liquidity.png` |
| Hedge with an ETF | Basket & Hedge | LIVE-verified (ranked on 60 days live) | `…-09-hedge-with-an-etf.png` |
| Stress test | Basket & Hedge | LIVE-verified (the lead and footnote name the short it holds, the table's $1,099,833 of SOXX for the preset, R-15; the footnote names the 60-session window, R-09) | `…-10-stress-test.png`, re-taken on `591a01f` |
| Hedge with options | Basket & Hedge | PROTOTYPE (the slot; the card is desk/prototypes', no values and no controls on this branch) | `…-11-hedge-with-options.png` |
| S&P 500 price and its two trend lines (now the kit's TrendChart) | Technicals | LIVE-verified against the deployed API | `live-technicals-render-02-s-p-500.png`, identical numbers to `live-before-technicals.png` |

No card is FAILED.

## Follow-ups

- **Deploy**: the API image needs this branch for `range=2Y` and the two
  routes; the first request for a basket costs one EODHD call per ticker per
  session (a ten-name basket plus eight ETFs: 18), then the day's cache.
- **Later rebases**: desk/usability's InstrumentSearch replaces the add
  input; desk/prototypes' options card mounts in `data-slot="hedge-options"`.
  (desk/fill-compute's RSI is reconciled: see "Rebase onto main `23014d0`".)
- A request that fetches many cold histories is synchronous (four at a time);
  a slow EODHD day could pass the browser's 15 s abort. The Desk's `computing`
  (202) pattern would fit if that shows up.
- **R-11**, not fixed by your decision: import treats a basket with the same
  name and names as already here even when its method or notional differs.
  Recorded in Build Notes, "What I'd build next".
- `AGENTS.md` predates the Desk v2 notes and was left as it was.
