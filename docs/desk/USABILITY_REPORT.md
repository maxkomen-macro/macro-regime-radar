# Desk usability: report

Branch `desk/usability` (worktree `mrr-usability`), cut from main `4394e59`
on 2026-09-27, rebased onto main `83a9f46` (desk/fill-etf, desk/fill-compute
and desk/books merged) and then onto `2c62d403` (desk/matrix merged) on
2026-09-28. The brief: an MD walks the Desk cold with zero confusion,
everything is one search away, and no control on screen does nothing. The
contract changes are in `docs/desk/DESK_FRAME3_SPEC.md` §14 (one section per
item) and the amended §1.0, §1.1, §1.4, §1.7, §2, §3, §4, §5, §9, §10, §12.

**Status (2026-09-28, overnight):** rebased onto `2c62d403`; not pushed,
no PR, not merged: the Codex review ended DO NOT PUSH on `d09d6e51` (its one
finding is fixed in `cab74622`, which awaits a re-review). Gates and shots
below.

## Commits (after the second rebase)

| # | sha | what |
|---|---|---|
| 1 | `035cb856` | Desk-wide stock search (InstrumentSearch) |
| 2 | `9c96ac5c` | Technicals for any stock (`?symbol=`) |
| 3 | `6224dfc3` | Event Study answers any question, on request |
| 4 | `567113ec` | Position Monitor opens on the saved positions |
| 5 | `aa3651ce` | Nav groups Market · Research · Trade, About this build |
| 6 | `f55a0f90` | One plain line under each title, one primary action |
| 7 | `f84ef25a` | Start here on the Overview |
| 8 | `ba47bc0f` | Analyst Desk → on the landing page |
| 9 | `cacd01de` | Every stateful Desk view is a deep link |
| 10 | `cad926cd` | Cold start: keep the API warm, say Loading live data… |
| 11 | `ca725ed8` | Hover definitions for every term of art |
| 12 | `78d36ca9` | A card whose request failed says Couldn't load · Retry |
| 13 | `cfc9ebae` | No control that does nothing (the Desk guard) |
| 13 | `ba3f4481` | Follow-up: the guard waits for the Advanced it opens (test only) |
| 1 | `d4c83712` | Follow-up: the Position Monitor's suggestions show their names (found by the live check) |
| R-01 | `0e4cebc9` | Codex: the one-year drawdown needs 252 valid closes, else it says partial |
| R-02 | `619b1f6e` | Codex: a stock's price and averages print with their decimals |
| R-03 | `9ae3c87d` | Codex: a stock's technicals read completed sessions only |
| R-04 | `c4e0a68c` | Codex: a suggestion can be picked only for the text it was searched for |
| R-05 | `9d7916a4` | Codex: the Event Study builder's series come with the catalog |
| R-06 | `fa43ae8d` | Codex: the provider ceiling classifies Technicals on decoded parameters |
| R-07 | `939d1e11` | Codex: every Event Study mode is in the address |
| R-08 | `e416aa33` | Codex: one malformed asset_prices row drops its instrument, not the list |
| R-08 r2 | `976c1199` | Codex round 2: canonical dates only, conversion isolated per instrument |
| F-1 | `401223d4` | Rebase follow-through: main's stored ETFs are named and searchable |
| F-2 | `81b68151` | Rebase follow-through: Basket & Hedge's ticker field is the Desk's stock search |
| F-3 | `cc8c12ad` | Rebase follow-through: main's new cards load, fail and define their terms like the rest |
| F-4 | `4df5cfe1` | Rebase follow-through: the guard on the merged Desk; the scope cut's Basket & Hedge terms and purpose line |
| M-1 | `e0c2fb84` | Codex merge review: a stock's technicals read adjusted closes only |
| M-2 | `c718d89a` | Codex merge review: the guard on Macro's five cards and the Position Monitor's Close… form |
| M-3 | `d09d6e51` | Codex merge review, round 2: a failed refetch shows nothing from the answer before it |
| M-4 | `cab74622` | Codex merge review, final round: a close the browser does not keep says so on the Monitored card |
| T | `143a8c7f` | desk/fill-etf's R-03 test pinned to the rebase ruling (the full pytest's third failure) |
| — | (this commit) | This report, CLAUDE.md, the final shots |

## Codex round 1 (on `535c9c1`, before the rebases)

Eight findings, one commit each, every fix with a test built from Codex's
repro; the contract is in spec §14.14. Shas are the rebased ones.

| ID | finding | fix | test |
|---|---|---|---|
| R-01 | The one-year drawdown printed a complete-looking number on less than a year of valid closes | `0e4cebc9` | `tests/test_desk_technicals_any.py::test_a_drawdown_on_less_than_a_year_of_valid_closes_is_partial_and_says_how_many`; `TechnicalsPage.test.tsx` "Codex R-01: a stock with under a year of closes…" and the S&P's 251 of 252 |
| R-02 | A stock's price and averages were whole numbers: $0.40 read 0 | `619b1f6e` | `kit/format.test.ts` "prices (Codex R-02)"; `TechnicalsPage.test.tsx` "Codex R-02: a stock under $1…" (price, averages, axis, the high) |
| R-03 | A stock's technicals read provider bars after the last completed session | `9ae3c87d` | `tests/test_desk_technicals_any.py::test_bars_after_the_last_completed_session_are_dropped_and_said`; `TechnicalsPage.test.tsx` "Codex R-03…" |
| R-04 | Enter inside the search's debounce picked the previous text's suggestion | `c4e0a68c` | `kit/InstrumentSearch.test.tsx` "Codex R-04…"; since F-2 also `BasketHedgePage.test.tsx` "Codex R-04 in the basket…" |
| R-05 | A failed or unavailable question disabled the builder's Shock and "What happens to" | `9d7916a4` | `tests/test_desk_study_on_demand.py::test_the_catalog_serves_the_builders_series_with_no_study_asked`; `EventStudyPage.test.tsx` "Codex R-05…" |
| R-06 | `?%73ymbol=NVDA` reached EODHD outside the provider ceiling | `fa43ae8d` | `tests/test_security.py::test_a_technicals_symbol_waits_with_the_provider_calls_however_its_key_is_spelled` |
| R-07 | Only My saved questions was in the address | `939d1e11` | `EventStudyPage.test.tsx` "Codex R-07: every mode is in the address…"; e2e item 3 now expects `&mode=build` |
| R-08 | One malformed `asset_prices` row failed the whole instruments item | `e416aa33`; round 2 `976c1199` | `tests/test_desk_instruments.py::test_one_malformed_row_drops_its_instrument_with_a_reason_and_keeps_the_rest`; round 2: `test_a_noncanonical_date_excludes_its_instrument_and_keeps_the_rest` (GLD valid, SPY '2025-W01-1'), `test_a_date_that_passes_the_check_and_still_fails_to_convert_costs_only_its_instrument`, `test_only_a_canonical_calendar_date_is_read` |

**Round 2** (Codex on `00fc5ff`): R-01 to R-07 fixed with no new blocking
issue; R-08 not fixed, because an ISO week date ('2025-W01-1') passed the
check and crashed the item in pandas. `976c1199` requires canonical
YYYY-MM-DD dates and converts inside the per-instrument isolation.

## The overnight review (Codex CLI, read-only, after the rebase onto `2c62d403`)

The owner's brief: "Review desk/usability against origin/main: the rebase
conflict resolutions, the scope-cut and glossary commits, the Basket & Hedge
InstrumentSearch, and the no-dead-control guard on every page as merged.
Report only blocking issues and end with PUSH OK or DO NOT PUSH." Run as
`codex exec -s read-only` with the conflict list attached and an instruction
not to run suites while the gates held the machine; at most two fix rounds.

| round | on | verdict | finding | fix | test |
|---|---|---|---|---|---|
| 1 | `4df5cfe1` | DO NOT PUSH | A stock's technicals took every close from books' daily bars, raw ones included where EODHD served no adjusted close | `e0c2fb84` | `tests/test_desk_technicals_any.py::test_a_stock_reads_adjusted_closes_only_and_says_how_many_it_left_out`, `::test_a_stock_with_no_adjusted_close_is_refused_in_the_desks_words`; `TechnicalsPage.test.tsx` (the count, the refusal) |
| 1 | | | The item-12 e2e counted four failed Macro cards; the merged page has five | `c718d89a` | e2e item 12 (five, and the matrix card's line) |
| 1 | | | The guard never opened a position's Close… form, where Close position sat disabled | `c718d89a` | `PositionMonitorPage.test.tsx` "Close… stores an explicit close…"; e2e item 13 with positions saved (the form, with and without a type) |
| 2 | `c718d89a` | DO NOT PUSH | After a good answer, a failed refetch kept the old numbers, charts and Live badges beside "Couldn't load · Retry" | `d09d6e51` | `MacroPage.test.tsx` and `TechnicalsPage.test.tsx` "a good answer, a failed refetch…" (the Macro one fails without the fix) |
| final | `d09d6e51` | DO NOT PUSH | A close whose storage write failed was reported only in the hidden New position form | `cab74622` (not re-reviewed: the two rounds were spent) | `PositionMonitorPage.test.tsx` "a close the browser does not keep…"; e2e item 13 forces storage full on Close position |

The final round confirmed the four earlier fixes and found nothing else in the
rebase resolutions, the scope cut, the glossary or the InstrumentSearch
integration. Because the review did not end PUSH OK, **the branch was not
pushed, no PR was opened and nothing was merged**; the owner's next commands
are in the morning note (untracked).

## The rebases

### Onto `83a9f46` (desk/fill-etf, desk/fill-compute, desk/books)

Every conflicted file and its resolution, per commit (pre-rebase shas):

commit 1 (42df794): api/desk_envelope.py (routes: main's 12 live + /instruments as 13th, LIVE_ROUTES=13); tests/desk_contract.py (main's basket contracts + INSTRUMENTS as §12.17); tests/test_desk_contract.py (LIVE and fixtures: both); web data/api.ts, envelope.ts, api.test.tsx, fixtures/desk/index.ts (both); DESK_FRAME3_SPEC.md (main's §12.14 /sectors kept, instruments moved to §12.17, route list both); compare 01 PNGs (main's; regenerated at the end)
commit 2 (f1d5b7c):
- api/desk_items.py: main's technicals_from_level (level_technicals + shared RSI/MACD/seasonality) kept; extended with spec/ranges/bench/source keyword args and desk/usability's usability_fields (drawdown, realized_vol via the shared realized_vol, rs); my wilder_rsi, nested rsi object and _Priced dropped (main's shared rsi and PRICE_SPEC); seasonality source parameterized.
- api/desk_v2.py: TECHNICALS_KEYS = main's + symbol/name/scored + drawdown/realized_vol/rs; S&P answer = main's (etf_block sectors) + symbol fields; any symbol served with main's sectors block; stock_technicals on PRICE_SPEC and the shared function.
- api/providers/market.py: both added the same 2Y range: main's line, comment names both uses.
- api/security.py: DESK_BASKET_PATHS (books) and DESK_TECHNICALS_PATH (mine) both on the provider ceiling.
- tests/desk_contract.py: main's RSI_VISIT/MACD/SEASONALITY kept (seasonality source any symbol's); my symbol/scored/drawdown/realized_vol/rs added; signals_allowlist main's six slugs, [] for a stock.
- tests/test_api_lookup.py: mine (2Y assertion) kept.
- web TechnicalsPage.tsx: main's page (TrendChart, RSI/MACD/seasonality cards) kept; mine ported onto it: URL range, served-ranges chips, stock title, unscored cross callouts, a new Risk card (drawdown, realized vol, a stock's 1-year return), Relative strength card, stock layout (price, RSI, risk, RS, MACD, seasonality), actions; main's cards name the stock.
- TechnicalsPage.test.tsx: main's tests kept; my RSI-card test became the Risk card's; stock tests on the new cards.
- fixtures technicals.json / -GLD / -NVDA: regenerated by scripts/desk_usability_fixtures.py on main's fixture store (desk/fill-etf's fixture-vix.db, reproduces all 23 of main's fields exactly); NVDA's Yahoo stand-in re-fetched 2026-09-28.
- fixtures index.ts, PROVENANCE.md, e2e desk.spec.ts, notes/scope.ts, spec: both sides.
- basket/BasketHedgePage.tsx: books' page taken whole (books has its own ?add=, including a new basket when none is saved); my ?add= hook dropped.
- compare 02 PNGs: main's (regenerated at the end).
commit 3 (a349580):
- api/desk_envelope.py: main's Refused and my Busy both kept.
- api/desk_v2.py: /study and /study/events take my on-demand path (allow_any, named, study_item); my RSI_REASON guard dropped (main serves the RSI rows); _series_list: my stored-series filter wins over main's catalog-only filter (owner's ruling: the builder computes on request), ops add main's catalog moves (the S&P's RSI crossings).
- api/desk_catalog.py (auto-merged, adjusted): an ad hoc RSI crossing outside the catalog shape is refused with its own RSI_RULE sentence.
- web QueryCard.tsx: mine (ungated options, lists by role), main's "none (a cross or RSI)" label.
- web question.ts (auto-merged, adjusted): adjust()'s cascade and engineSlugOf cover main's RSI moves (the windowless family).
- fixtures study.json: main's answer with my builder's series list, computed on the fixture store.
- EventStudyPage.test.tsx: main's catalog-only R-03/R-04 test replaced by one pinning the ruling; my option lists updated.
- notes/scope.ts, spec: main's lines, my Event Study line; spec table my entry_rule, main's cooldown.
- compare 03 PNGs: main's.
commit 5 (3f8fc5a): compare 01 PNGs only (main's; regenerated at the end)
commit 6 (64efe30): BasketHedgePage.tsx Save: books' enabling (!legs || !local), my demotion to secondary (no data-kind light); TechnicalsPage.tsx: my 15-word blurb, commit 2's short name kept; compare 01, 04 PNGs main's
commit 7 (dddd4b8): OverviewPage.test.tsx: main's VIX-gap tests and my Start here test both kept; compare 01 PNGs main's
commit 10 (591fc73): SectorsPage.tsx: main's imports/card heads + my LoadingLine; TechnicalsPage.tsx SectorCard: my LoadingLine above main's ends line
commit 11 (7d3a9b5): QueryCard.tsx: main's window label, my glossary σ tip; RegimePage.tsx: main's MEANT_LABELS head, each defined; TechnicalsPage.tsx: main's RSI card head with my definition; every compare PNG main's
commit 12 (283445f): SectorsPage.tsx: main's grid (its legacy 'not ingested' body is gone) inside FailedScope; TechnicalsPage.test.tsx: the unknown symbol's refusal on the Risk card and main's RSI card; LoadingLine added to main's RSI, MACD and seasonality cards so they carry the loading and failed lines (items 10, 12)
commit 13 (841fcd6):
- OverviewPage.tsx / .test.tsx: main's VIX tile (the gap and band word are served since desk/fill-compute), so my "not on this tile yet" line and its link are dropped; my pathTo threading into Tiles reverted.
- BasketHedgePage.tsx: books' three steps and priced hedge kept (my label-only hedge card and hidden basket Advanced dropped); the guard's rule applied to books' controls: the add-a-ticker row and Save show only with a basket open, instead of disabled.
- BasketHedgePage.test.tsx: books' test; my "added from Technicals" tests removed (books' ?add= and its test stand).
- Macro/Regime/Technicals/Sectors tests: main's served cards, with the guard rule (an Advanced that would open nothing is absent, not disabled).
- e2e desk.spec.ts: my "July data" wording with main's comment; books' hedge assertions.
- spec: main's LIVE VIX row; main's correlations prose with the §14.13 Advanced rule.
- every compare PNG main's.
commit R-01 (3006e9a): desk_items.py: HEAD (usability_fields) with R-01's complete re-applied there; contract, schema: HEAD with complete; TechnicalsPage.tsx: HEAD with R-01's partial/ddN in the Risk card; tests: the drawdown lives on the Risk card now; fixtures technicals*.json regenerated by the builder (complete included); compare 02 main's
- R-02 (price decimals): TechnicalsPage.tsx: main's page + priceText/tickText on Price stats, Risk card's peak, TrendChart axis (new optional tickText prop on kit/TrendChart.tsx, default grouped); test's drawdown assertion moved from the RSI card to the Risk card (where the merged page shows it).
- R-03 (completed sessions): api/desk_v2.py: TECHNICALS_KEYS = main's list + excluded_bars (before signals_allowlist); stock answer = HEAD's with excluded_bars default; stock_technicals docstring = both paragraphs, R-03's session cut over HEAD's PRICE_SPEC/source call. tests/desk_contract.py: HEAD's six-signal allowlist + R-03's excluded_bars. Fixtures technicals*.json: HEAD's + excluded_bars null (the S&P fixture appended by the builder's own rule, which now also sets it); test asserts main's rsi_date (main serves rsi as a number).
- R-06 (decoded parameters): api/security.py: books' DESK_BASKET_PATHS kept beside R-06's _names_symbol(scope) for Technicals (replacing the raw b"symbol=" substring test).
- R-08 round 2 (canonical dates): api/desk_items.py: per-instrument date conversion (R-08 r2) with main's technicals_from_level(PRICE_SPEC, source) call; R-08 r2's broad per-ETF except kept. (test_every_stored_daily_etf_has_a_name fails here on main's new ETFs; fixed in the follow-through commit.)

### Onto `2c62d403` (desk/matrix)

- desk-usability 2 (707f62b9): web/src/fixtures/desk/PROVENANCE.md: main's desk/matrix paragraph kept, then desk/usability's section.
- desk-usability 11 (ee3f1c19): MacroPage.tsx: main's (desk/matrix) correlation matrix card, not my Advanced-panel matrix; its title and subtitle carry the correlation definition through CardHead's defineTerms.
- desk-usability 12 (dd50dd29): MacroPage.tsx: the FailedScope wraps main's 2×2 and its matrix card; the matrix card gets the LoadingLine (loading, or Couldn't load · Retry) the 2×2's cards carry.
- desk-usability 13 (48c30af5): MacroPage.tsx and spec §6: main's (desk/matrix: the correlation card has no Advanced; the matrix is its own card), which meets the guard; MacroPage.test.tsx: my §14.13 no-Advanced assertion and main's matrix tests both kept; the failed-/macro test counts five failed cards (the matrix included, per the item-12 resolution).

Main's Event Study timer-leak fix (the export test waits for
`revokeObjectURL` before restoring its stubs,
`EventStudyPage.test.tsx` "Codex R-23…") is kept as main has it.

### Follow-through commits

- **F-1 `401223d4`.** desk/fill-etf stores twenty more daily ETFs; the
  instruments item names each one, so the search's stored fallback offers
  them and `/technicals?symbol=` reads their closes.
  `scripts/desk_usability_fixtures.py --instruments` regenerates
  `instruments.json` (29 instruments); the catalog fixture's series is the
  same 17-series list `/study` serves.
- **F-2 `81b68151`.** Basket & Hedge's add row is `InstrumentSearch`: US
  stocks and ETFs from the first keystroke, R-04's rule (a suggestion
  searched for other text is never added), books' `?add=` unchanged.
- **F-3 `cc8c12ad`.** Loading and failed lines on main's new cards (Basket &
  Hedge's step cards; the Position Monitor's Monitored card, which read
  "now not served" while its levels loaded); definitions for MACD,
  seasonality, effective names, drawdown from peak, days to trade; the tip
  follows its term on scroll (hiding on every scroll lost it below the fold).
- **F-4 `4df5cfe1`.** The guard on the merged Desk: Regime's change list
  printed "· Aug row" (now "· from Aug data"); a stock's Technicals grid
  placed only three of its six cards, so MACD, seasonality and the Risk card
  fell into the S&P page's slots and made columns 36 px wide (every card is
  now placed); e2e updated for R-07's `mode=build` and the Risk card. The
  owner's scope cut: Basket & Hedge's purpose line, and its terms defined.

## Scope cut (owner, overnight 2026-09-28)

Done: the guard passes on every page as merged, including Basket & Hedge's
three steps, Regime, Macro with the correlation matrix, and Sectors; Basket &
Hedge's terms (beta, R², hedge ratio, notional, drawdown from peak, realized
volatility, RSI, relative strength, concentration, liquidity and ADV) and the
Macro matrix's correlation carry their definitions; the purpose line reads
"Build a basket, see how it trades against the Nasdaq and S&P, and hedge it."
Basket & Hedge prints no basis points, so that term has nothing to attach to
there.

### Follow-ups

- **Loading and error states on newly merged cards.** Covered: Basket &
  Hedge's step cards (loading; books' own failure lines kept), the Position
  Monitor's Monitored card, Macro's matrix card (it joined the page's failed
  scope, so it says Couldn't load · Retry with the 2×2). Not audited card by
  card: Sectors' and Regime's cards added by desk/fill-compute and
  desk/fill-etf beyond those resolved in the rebase, and whatever
  desk/prototypes merges.
- **Books' failure lines.** "This basket could not be priced: … Try again"
  offers Try again on a refusal too (a 422 answers the same again); the rest
  of the Desk shows no Retry on a refusal (§14.12). Left as books designed
  it and tested it.
- **Glossary beyond the scope cut.** Sectors' participation and equal weight
  vs cap weight, Regime's new tables' column heads, the Overview's VIX band
  words, the stress test's "Vol left" and "Vol cut".
- **Compare shots** (`docs/desk/screens/compare/`): every conflicted PNG took main's;
  they were not regenerated for this branch's header search, grouped
  navigation and one-line titles.
- **A stock's seasonality** reads two years of candles, so each month
  averages one or two years; the card says "1–2 years a month". A longer
  history for stocks needs a longer provider range.
- **Re-review `cab74622`** (the final round's fix) before the merge.
- **Main's RSI card** prints "Awaiting refresh" under "Last below 30" when the
  history served holds no such dip (a stock's one year through the relay);
  "none in the history served" would say it. desk/fill-compute's wording,
  left as is.
- **Event Study's mode hint** ("pick one below, or build your own in the
  slots — either way…") carries an em-dash aside the Desk's copy rules ban;
  main's string, left as is.

## Gates

Per commit: `npx tsc -b --noEmit`, `npx vitest run --maxWorkers=2 --minWorkers=1`,
`npm run build`, the related pytest files. The full pytest (no parallel
workers; `tests/test_streamlit_backports.py` under the Streamlit interpreter)
and the full Desk e2e (`e2e/desk.spec.ts` and `e2e/desk-usability.spec.ts`,
`--workers=1`, fixture Vite) ran once under `/tmp/mrr-full-gates.lock`, taken
at 01:58:44 ET after another session released it and released at 02:16:38.

| gate | where | result |
|---|---|---|
| full pytest | archive of `c718d89a` (its Python tree is the head's, but for the one test rewritten in `143a8c7f`) | 1820 passed, 1 skipped, 3 failed: the two known `tests/test_asset_history.py` failures (`test_without_the_table_the_endpoint_says_the_histories_are_not_stored`, `test_validate_requires_the_table_in_full_mode_only`, both on main too), and `tests/test_desk_etf.py::test_codex_r03_…`, desk/fill-etf's pin of the catalog-only series list the owner's ruling replaced; rewritten to the ruling in `143a8c7f`, and `tests/test_desk_etf.py` then passed whole (35, 1 skipped) |
| Streamlit back-ports | same | 7 passed |
| Desk e2e | the worktree at `cab74622` (the head's web tree) | 81 passed |
| tsc, vitest, build | `143a8c7f` | green; vitest 1674 passed |

## Final screenshots (real API, no fixtures)

`docs/desk/shots/final/`, full page at 1440 wide, taken 2026-09-28 02:20 ET
from `143a8c7f`:

- **API:** this branch's `api.main:app` (port 8497) from an export of the
  head, no `DESK_FIXTURES`. One generation, 38 results, 0 errors.
- **Store:** a copy of the newest local copy of the published database
  (`mrr-compute/data/macro_radar.db`, sha256 `aefa2c0e2be70491…`, the one
  desk/matrix shot against; `gh release download` is not available to these
  sessions), filled by the full refresh's own step,
  `python -m src.market_data.asset_history --db <copy>` (Yahoo, no EODHD token
  here): 32 daily symbols through 2026-09-25, the sector ETFs, ^VIX and the
  matrix's twelve included.
- **Provider:** no EODHD token on this machine, so the API's EODHD client
  was relayed to the deployed API on Render (search to its
  `/api/market/search`, daily bars to its `/api/market/candles`). Render
  answered `2Y` with an error and `1Y` with a year of bars, so a stock
  through the relay reads one year: NVDA's 1-year return and its RSI's "last
  below 30" read Awaiting refresh (fewer than 253 closes; no dip below 30 in
  the year), and its seasonality holds one year a month. The relay socket
  was off.
- **Web:** Vite with `VITE_PROXY_TARGET` to that API, no fixtures.
- **Evidence:** `shots.json` lists each shot's route, every `/api` answer it
  saw (all 200) and the loading, failed and awaiting counts at capture.

| shot | page | at capture |
|---|---|---|
| [01](shots/final/01-landing.png) | Landing page (Analyst Desk →) | clean |
| [02](shots/final/02-overview.png) | Overview | clean |
| [03](shots/final/03-technicals-sp500.png) | Technicals, S&P 500 | clean |
| [04](shots/final/04-technicals-nvda.png) | Technicals, NVDA (retaken once the relay had answered: its first request outlasted the first capture) | 2 awaiting, the relay's one year (above) |
| [05](shots/final/05-sectors.png) | Sectors | clean |
| [06](shots/final/06-macro-with-matrix.png) | Macro, the correlation matrix included | clean |
| [07](shots/final/07-regime.png) | Regime | clean |
| [08](shots/final/08-event-study-build-your-own.png) | Event Study, Build your own, VIX +2σ over 20 days while Overheating → gold a month later (not a preset) | clean |
| [09](shots/final/09-signal-ledger.png) | Signal Ledger | clean |
| [10](shots/final/10-basket-hedge-preset.png) | Basket & Hedge, the AI Infrastructure 10 preset, all three steps priced (the options slot's §1.0 reason) | clean |
| [11](shots/final/11-position-monitor.png) | Position Monitor, an empty browser | clean |
| [11b](shots/final/11b-position-monitor-saved-positions.png) | Position Monitor with the sample positions in this browser (`web/src/fixtures/desk/positions.json` seeded into localStorage; the API unfixtured) | clean |
| [12](shots/final/12-data-pipeline.png) | Data Pipeline | clean |
| [13](shots/final/13-build-notes.png) | Build Notes | clean |
| [14](shots/final/14-desk-search-N.png) | The Desk search after "N": NOW, NVDA, NFLX, NBIS, US equities | clean |

The pre-rebase real-API check (80 shots, `docs/desk/shots/desk-usability/`,
before the rebases) is superseded by this set and not committed.

## What each item did

1. **Stock search.** `/api/market/search?scope=us` keeps US equities and
   ETFs, primary listings first (a one-letter query returns only US
   symbols: `tests/test_providers.py`). The main dashboard's `SymbolSearch`
   is reused through props (scope, fallback, controlled value, dense) as the
   Desk's `kit/InstrumentSearch`: suggestions on the first keystroke, arrows
   and Enter or a click, a pick opens that stock's Technicals. When the
   upstream search does not answer, it offers the series this store prices
   (`GET /api/desk/instruments`, worker item `desk_instruments`, §12.14). It
   sits in the Desk header on every page and is the Position Monitor's
   instrument field and, since the rebase onto desk/books, Basket & Hedge's
   ticker field (a pick adds the ticker; Enter with no suggestion adds what is
   typed; `?add=` is books').
2. **Technicals for any stock.** `/desk/technicals?symbol=XYZ` (S&P 500 by
   default) reads `/api/desk/technicals?symbol=`: the stored ETFs from the
   store, any other US stock through the provider's `2Y` daily candles (a
   range this branch adds). One function, main's `technicals_from_level`
   over the shared `src/analytics/technicals` (no copy), serves the S&P, the
   ETFs and every stock: price, 50/200-day averages and their crosses, RSI,
   MACD and monthly seasonality (main's cards, now for any symbol), and this
   branch's Risk card (drawdown from the 1-year high, 21-day realized
   volatility, 1-year return) and strength against the S&P with its 50-day.
   A stock's bars are cut at the last completed session (Codex R-03). A
   stock's crosses are shown and labelled "not scored"; the S&P-only cards
   stay on the S&P page, and a stock's page says "Signals are scored on the
   S&P 500 → view". Actions: Add to basket (`/desk/basket-hedge?add=XYZ`)
   and Open as position (the monitor's form with the instrument filled).
3. **Event Study, any question.** The engine answers any well-formed six-slot
   question in 0.1–0.4 s, so `/study` and `/study/events` compute it on
   request (the pool, cache and ceiling of `api/desk.py`, pinned to the
   request's generation; 202 `computing` past 8 s, 429 `busy`), with the
   catalog's verdict rule. Every option in the builder works (none is
   disabled); a cross and an RSI crossing are the S&P's own (the rule is
   said); the series offered are every stored series with a role, with main's
   catalog moves (the builder computes on request, so its list wins over
   main's catalog-only filter, as the owner ruled). The confidence chips and "Price it →" did not work and are gone
   (the rail prints the engine's 90% interval in words). Three non-default
   combinations in e2e.
4. **Position Monitor.** Opens on the saved positions; the form sits behind
   "+ New position" (`?new=1`); the discipline gate is unchanged.
5. **Navigation.** Market (Overview, Technicals, Sectors, Macro, Regime),
   Research (Event Study, Signal Ledger), Trade (Basket & Hedge, Position
   Monitor), then a small "About this build: Data Pipeline · Build Notes".
   The current page carries a green bar; the breadcrumb stays.
6. **One line, one action.** Each page title has one plain-English line (15
   words at most) and one obvious primary action in the header.
7. **Start here.** Four numbered links on the Overview: Overview → Basket &
   Hedge → Technicals → Event Study, one phrase each.
8. **Landing page.** "Analyst Desk →" beside "Open the terminal", to
   `/desk/overview`.
9. **Deep links.** The Event Study's question, horizon, Advanced panel
   (`adv=1`) and saved tab (`mode=saved`); Technicals' symbol and range; the
   Ledger's filter (`filter=`); the Pipeline's search (`q=`, its group
   opened); the Position Monitor's form (`new=1`). Three deep links in e2e,
   plus the other two.
10. **Cold start.** `.github/workflows/keep-api-warm.yml`, workflow name
    **"Keep the API warm"**: cron `*/10 * * * *` (and on demand) asks
    `https://macro-economic-radar-api.onrender.com/health/live`, three tries,
    no secret, `permissions: {}`. **Render plan:** `docs/redesign/DEPLOY.md`
    §3a (prices read 2026-09-21) specifies the $25/month 1 CPU / 2 GB
    instance and rules out the free tier, which spins down when idle; the
    running plan could not be read from this machine (no Render dashboard
    access). Every card whose request is pending says "Loading live data…".
11. **Hover definitions.** `kit/glossary.ts`: one plain sentence for σ, OAS
    and the high-yield spread, investment grade, HY, 2s10s, steepening and
    flattening, the front end, basis points, RSI, realized and implied
    volatility, skew, the VIX, drawdown, the moving averages and their
    crosses, relative strength, log returns, correlation, breadth, normal,
    overlap blocks, the 90% interval, K−2, NAV, DV01, beta, R² and notional;
    after the rebases MACD (signal line, histogram), seasonality, and Basket
    & Hedge's hedge ratio, concentration, effective names, drawdown from
    peak, liquidity and days to trade (ADV). Stat labels, card heads,
    Overview tiles, the Ledger's rows and column heads, Basket & Hedge's
    card heads and table heads, the Macro matrix card's head carry them (a
    dotted underline; one tooltip, `kit/Term.tsx`, which follows its term on
    scroll).
12. **Per-card failure.** A card whose own request fails says "Couldn't load
    · Retry" once, keeps its labels with "—", and Retry asks again; the
    Desk's own refusals print their words without Retry; cards fed by other
    requests render. Forced in e2e for the Ledger (Technicals' Signals card
    alone), `/macro` (its four cards) and `/overview` (its line, tiles and
    active signals; the monitored positions stand).
13. **The guard.** Every Desk page, with an empty browser store and with
    positions and baskets saved, fails e2e on a visible disabled control, an
    Advanced that opens onto nothing, or "Generation g…", "<n> ms",
    "cached", "<Month> row", "not specified". Whitelist: blocks served
    unavailable with their reason (`[data-unserved]`), PROTOTYPE cards
    (`[data-prototype]`, none on this branch), the Position Monitor's gated
    Save. What changed to pass it is listed in spec §14.13.

## The tree against the brief (followed the tree)

- **"Replace the flat tab strip" (item 5).** The tree has no tab strip: the
  sidebar has been the Desk's only navigation since frame-3 (grouped Survey
  / Act / Tools). The sidebar is regrouped as asked.
- **"Reuse the main dashboard's technicals" (item 2).** The dashboard's
  technicals are display math in the browser (`movingAverage`); the Desk's
  rule is that nothing is re-derived in the browser, so the one shared
  function is the Desk's server-side `technicals_from_level`, now used for
  the S&P, the stored ETFs and any stock. The asset-history reuse is the
  provider's candles path with the new `2Y` range.
- **RSI (item 2).** This branch first served its own RSI-14; desk/fill-compute
  merged the shared one (`src/analytics/technicals.rsi`), which every symbol
  now reads, and this branch's copy is gone.
- **Event Study compute (item 3).** No new route: spec §4.1 says "no new
  public compute route", so `/study` itself computes on request.
- **Confidence levels and "Price it →" (item 3).** Neither could be made to
  work on this branch (the engine resamples at one level; pricing belongs to
  desk/books), so both are removed, as the brief allows.
- **"Generation g1" (item 13)** is the spec §1.1 footer the frame-3 build
  printed. The footer is gone; Codex R-22's check and its "mixed generations
  · refreshing" badge stay.
- **The Position Monitor's Save** stays disabled until the gate is complete
  ("keep the discipline gate exactly as is"), so the guard whitelists it.
- **The VIX tile.** Before the rebase its reason read "realized-volatility
  method not specified"; desk/fill-compute now serves the gap and band word,
  so main's tile is kept whole.
- **A 200 answered null** (Codex R-09: "never a loading state") now reads as
  a failure ("Couldn't load · Retry") rather than "Awaiting refresh", which
  is reserved for data the store has not refreshed.
- **Item 12's e2e** first asserted that no text on the page awaits a
  refresh; the fixture's own technicals legitimately await the averages, RSI
  and realized volatility (a session is missing), so item 13's commit
  narrows that check to the failed card.
- **No EODHD token on this machine.** The real-API check relays the
  provider calls to the deployed API on Render (below).

## Loads, pauses and flakes

- **Load-sensitive assistant-SQL timing tests** in `tests/test_desk_api.py`
  failed under load during items 3 to 6 (other sessions' suites on the
  machine) and passed alone; they passed in the final full pytest.
- **Item 13's guard** read `aria-controls` before a re-render (fixed by
  `ba3f4481`, which waits).
- **Hover e2e below the fold**: the tip hid on the scroll that brought its
  term into view (a product fix in F-3: the tip follows its term).
- **The first NVDA capture** went out before the relay's first answer (over
  two minutes, Render cold); retaken once warm.
- **Pauses**: the machine ran out of memory once (every process this
  session started was killed; resumed on the owner's word); the full gates
  waited for the lock once, behind another session.
