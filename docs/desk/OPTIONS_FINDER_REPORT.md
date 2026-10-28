# Options Finder: build report

Branch `claude/project-thread-gl7ggl`, built to the Options Finder Build Plan (steps F1 to F8, constraint C1) and
the pricing method in `docs/desk/OPTIONS_FINDER_MODEL.md` (method `finder-2`). This report covers what was built,
what stays hidden, what the owner has to do before anyone can use it, and where the build departs from the plan.

## What a visitor can see after the merge

Nothing new is listed. The Desk sidebar, the command palette, the Options lens and Event Study show nothing new while
`OPTIONS_FINDER_LISTED` (`web/src/screens/desk/options/flag.ts`) is `false`, which is how it ships.

**Unlisted is not private.** `/desk/options-finder` answers anyone who has the link. It carries a Preview badge and
a `noindex` tag, and the route serves the same end-of-day quotes that `/api/market/options` already serves publicly.
To make it fully private until EODHD answers the display-rights question, an environment switch on Render would be
needed (the plan's `OPTIONS_FINDER_ENABLED`); it was not asked for and is not built.

The Options lens on the Markets single-name page changes in one way (F1): it lists every expiry the provider has
(the scan pages through the provider's list instead of stopping at its first 1,000 rows), and its stamp names the
session the end-of-day marks describe ("Oct 22 close").

## What the owner has to do

1. **Merge** (the owner's call). Vercel then ships the front end with the page unlisted.
2. **Deploy the API on Render by hand.** The route and the expirations fix live in the API. Until it is deployed,
   the unlisted page says "not deployed on the data service yet" (tested) and the lens keeps its short expiry list.
3. **Before listing:** EODHD's answer on public display of options quotes (and whether OPRA's fee is included).
   Listing is then a one-line change to the flag, plus a Build Notes line (see "Departures").

## What was built

| Step | What | Where |
|---|---|---|
| F1 | Expirations page through the provider's list; an additive `session` field on the expirations and chain answers; the lens's stamp | `api/providers/market.py`, `web/src/screens/markets/SingleName.tsx` |
| F2 | The engine, `finder-2`: screens, carry from the market's forward, sizing in whole cents, European closed forms, an American lattice with a certified early-exercise bound, events, the three lenses, top-20 pruning by value bounds | `src/desk/options_math.py`, `src/desk/options_finder.py`, `docs/desk/OPTIONS_FINDER_MODEL.md` |
| F3 | `GET /api/desk/options/finder` in the Desk v2 envelope: the paging chain scan, the session checks, the stored inputs (earnings included) as a worker item; no Finnhub request | `api/desk_options.py`, `api/analytics_cache.py` |
| F4 | Types, the response-boundary schema (a row missing a required field is dropped and counted), `useOptionsFinder` with a 90 s timeout, the fixture server | `web/src/screens/desk/data/` |
| F5 | The page: the view form (state in the address), the summary with every screen's drop count, the three lens cards, the payoff chart from the served curve, the events, the sortable table, how it was priced, the disclosure footer | `web/src/screens/desk/options/` |
| F6 | Entry links, drawn only when listed: the lens, Event Study (an S&P 500 study maps to SPY), the command palette | `options/entry.tsx`, `options/lens-link.tsx`, `screens/shell/sections.ts` |
| F7 | Position Monitor's option subject `{kind: "option", contract, entry, thesis}`, always monitored by hand | `web/src/screens/desk/positions/option.ts` |
| F8 | This report, the Desk rules line, Playwright for the page | `web/e2e/options-finder.spec.ts` |

Every number the page prints is a number the route served, spelled; a unit test reads every number on the answered
page against the answer. The page has no "best", "recommended" or "buy", and never calls end-of-day quotes live.

## C1: the existing site

Every change to shared code is additive and inert while the Finder is unlisted:

- `desk-sections.ts`: the groups are built by `deskGroups(listed)`; unlisted, they are the same list as before
  (tested), and the Finder's slug resolves from a separate unlisted list.
- `DeskShell.tsx`: one more page branch. `EventStudyPage.tsx`, `SingleName.tsx`: one component each that renders
  nothing while unlisted. The lens imports only the flag and the router (`lens-link.tsx`), not the Desk's data layer.
- `screens/shell/sections.ts`, `CommandPalette.tsx`: an optional `path` on a palette entry; the Finder's entry list
  is empty while unlisted.
- `positions/store.ts`, `levels.ts`, `PositionMonitorPage.tsx`: a new subject kind. Records written before it load
  and import unchanged (tested against the fixture store).
- `data/api.ts`: `deskGet` takes an optional `timeoutMs`; every existing caller passes none and keeps 15 s.
- API: one route, one worker item appended last (it never raises and reads no other item), the route in the
  provider ceiling and the Desk envelope's route list. `api/providers/finnhub.py` is unchanged, and the Finder
  sends Finnhub nothing. `deploy/` is unchanged.

## Tests

- Python: the full suite at the branch's head, 2,471 passed, 75 skipped, 1 failed, against 2,125 passed, 80 skipped
  and 1 failed at the base. The failure is the baseline's `test_no_secret_in_logs` (a uvicorn startup-log race),
  which passes alone. The five fewer skips are tests that need a built `web/dist` and the web dependencies, absent
  from the base's checkout. The Finder's own tests: route 90, numerical library 140, engine 79, on synthetic chains,
  plus the contract and route-list tests.
- Timing tests, kept apart from this branch's own results. Two tests with a wall-clock bound failed in some full
  runs and passed alone. The profile's two-calls-in-parallel test misses its bound by about 10 ms under load; it
  fails on the base too (one of the base's three full runs in round 2, one of three more in round 7), so it is a
  property of `main`, not of this branch. The worker's commit-race test
  (`test_desk_v2_pipeline::test_the_worker_never_publishes_a_copy_taken_across_a_commit`, a 30-second wait) failed
  once in ten full runs at the branch's head and in none of six at the base, so it is not shown to fail on `main`.
  It is also not shown to be this branch's: its worker runs only the Desk pipeline item, and the branch changes
  none of the worker, the bootstrap, the pipeline or the database-path code it runs; it passed 16 of 16 isolated
  runs (head and base, under CPU load), its whole file 6 of 6, and 3 of 3 after the Finder's test files.
- Web: vitest 156 files, 1,998 tests, all passing; typecheck and build clean. Playwright: the Finder's spec 4 of 4;
  `desk.spec.ts`, `desk-usability.spec.ts` and `desk-mobile.spec.ts` 98 of 98, the Finder added to the palette and
  language audits.
- Fixtures are synthetic: an invented $100 stock (SYN) whose quotes the engine's own lattice priced
  (`scripts/options_finder_fixture.py`). No provider data is in the repository.

## Review

Every design (F1, the engine, the route) passed an independent Codex review before it was built; the code then had
a Codex review of the whole branch. Its first round found two defects, both fixed with tests that fail on the old
code: a share-class listing such as BRK.B lost its share class in the contract root, so every standard contract was
screened out (its earnings dates are now not checked, rather than read under an unverified spelling); and in the
Position Monitor, changing the instrument after "Save as position" kept the carried contract attached. Its second
round, over the whole branch, found four more, also fixed with tests: the Position Monitor accepted a carried call
saved as short (whose loss is not its premium; option positions are now long only); the dividend cross-check and
the early-exercise flag were served but not shown (both now show, as the approved decisions say); and the summary
counted the priced rows as "passed the screens" while contracts the value bounds kept out of every top 20 had
passed too (the summary and the table now say priced). Three of the page's own test expectations changed with
that copy (the summary sentence, the puts sentence and the loading line).
Its third round found one: for a report before the open on an expiry day, the route never read that day's expiry,
so the implied earnings move came from the next pair of expiries; the route now reads it, and the engine keeps it
only when the release time puts the report before that close.
Its fourth round found one more: with two reports ahead, the second report's implied move also carried the first
report's jump; a report now gets no move of its own when another one not yet priced falls before its second expiry.
Its fifth round found one: a whole-number parameter such as "²" or a 4,301-digit string reached the envelope as a
server error instead of the typed refusal; those parameters now take one to nine ASCII digits.
Its sixth round found two, in the earnings move and coverage: the move check read only the reports inside the
scanned window, so a report just past the last scanned expiry did not rule out a move whose expiry pair it shared,
and the coverage sentence could say no earnings date was found while Finnhub had returned one past the window. The
check now reads every reported date, one report per day (conflicting times on a day count as unknown); any
earnings row that could not be read suppresses every move estimate and any claim that none was found. Prices and
picks are unchanged. This fix went through its own design review first (five passes).
Its seventh round found the sixth round's fix sound and raised three more. Two said the branch departed from the
plan without the owner's approval: the engine's pricing method and the deferred Data Pipeline row. Both were the
owner's own decisions, given in the thread but not yet written into the reviewer's approved list; with the owner's
approval they were added there verbatim. The third was the commit-race timing test above, which one full run had
failed; it is documented under Tests as not reproduced at the base and not running the branch's code. In the same
round the owner chose to drop the Finder's on-demand Finnhub read (Departures, "Earnings dates are the stored rows
only"); that change went through its own design review (three passes) and is in the two A-3 commits, the first of
which holds only the deleted client and the reverted deploy template line and is meant to be read with the second.
Its eighth round, on the whole branch, found nothing. The validation bench being built alongside (its own branch)
then found two in-domain contexts whose served delta missed the stated accuracy, both with a dividend on day 0 or
1 of a long-dated contract near its exercise boundary; prices were unaffected. After its own design review (two
passes), no lattice delta is served while a dividend falls in the next five days: the price stays, and the
Delta cell shows why (as it now does for every withheld delta). A delta-only lattice run is skipped there, so a
scan near the work ceiling can use less work than before. The bench then reran the engine on its 1,840 cases with a dividend in the first
five days and on a tenth of the rest: no served delta failed, and every price and status was unchanged.
Its ninth round found two smaller defects, fixed with tests: a saved option's line in the Position Monitor
rounded a half-cent fill ($0.875 read $0.88; it now reads as the Finder shows it), and the table's Contract
column sorted strikes as text (105 before 102.5; now as numbers). Its tenth round, which the owner allowed, found one: a
declared dividend after the scan's last expiry was listed under "Events before expiry" (pricing never used it). Its
eleventh round found the same boundary on the expiry's own day: a dividend whose last cum-dividend close is that
expiry, or a report after that day's close, was still listed. The events list now ends at the last expiry's close,
read with each event's timing, the same rule the pricing already used.

## Capacity

The engine prices within a work budget of 300 million lattice steps per request and refuses, with a reason, past it.
On a chain shaped like a large single stock's (weekly expiries, many strikes):

- a rise over the default six-month window used 291 million steps, just inside the budget;
- a fall over the same window was refused ("Too much to price at once");
- a twelve-month window was refused.

A narrower window (fewer months, or a target nearer the close) answers. Raising the budget is a cost and latency
decision; the adaptive-pricing proposal is the place to settle it.

## Departures from the plan

- **The delayed price is not shown.** The plan's risk table said the page would show the stock's delayed price.
  Reading it reaches Finnhub through the dashboard's shared token bucket, which can make the dashboard's fundamentals
  read fail (Codex DR-29). The page shows the session close the answer was priced from.
- **`data.as_of` is `market_as_of`** in the answer, since the envelope's fixture wiring takes `as_of` as its own.
- **The macro calendar's lower cutoff** is the store's newest `market_daily` date.
- **`scan.truncated`** can be true when `complete_through` equals the date asked for (the provider's list was longer
  than one scan reads, and the scan still read through the date). The page says what was read.
- **The address says `direction`**, not `view`: `view` is the Desk / Client toggle's key on every Desk page.
- **Build Notes is unchanged.** The plan gives it a line on what is live; while the Finder is unlisted, a line on the
  public Build Notes page would list it. The line goes in with the flag: "Live on request: the Options Finder, one
  end-of-day option chain priced against your view, ranked three ways, never a recommendation."
- **The Data Pipeline row is deferred** (the owner chose "Yes to both" on that card, 2026-10-25; it ships with the
  flag flip, and that decision does not itself authorize listing the page).
- **Earnings dates are the stored rows only** (the owner's choice, 2026-10-26). The plan's decision 8 fetched a
  symbol's dates from Finnhub on demand. Finnhub gives an account one API limit, shared with the dashboard's
  fundamentals, so the Finder sends no Finnhub request: it shows the dates the refresh stores for the 12 tape names,
  says other earnings dates are unknown, flags every modelled contract with that, and serves no implied earnings
  move (the stored rows record no checked horizon). Prices are unchanged. A shared earnings cache with recorded
  coverage and freshness is its own planned PR; it needs the owner's approval for its refresh-workflow step.
- **`finder2_carry` lives in `options_finder.py`**, not its own module.
- **F7's tests are in `positions/option.test.tsx`**, not spread over the three files the plan names.

## Risks

| Risk | What is in place |
|---|---|
| Display rights (EODHD plan, OPRA) | Unlisted until the owner confirms. The same question covers the live Options lens. |
| Marketplace quota | Per-session chain cache, the provider ceiling, one scan at a time, typed refusals (`busy`, `rate_limited`). |
| Wide chains | The work budget refuses with a reason, never a partial ranking; top-20 pruning by value bounds: the bounds are proved, and their allowance for the lattice's error (twice its tolerance) is validated, not proved. |
| Modelled values | Labelled modelled, with the volatility held and the ±10-point sensitivity on every modelled contract. |
| Events | Earnings, macro releases and dividends before the date are listed and flagged on each contract; earnings dates beyond the stored ones are "unknown", never "none", and no implied earnings move is served until the cache records coverage; other company events are named as not tracked. |
