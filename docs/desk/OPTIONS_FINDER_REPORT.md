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
3. **Optional: add `FINNHUB_FINDER_API_KEY` on Render.** It is the Finder's own Finnhub key, so its earnings-calendar
   reads never spend the dashboard's Finnhub minute. Without it (or set to the same key as `FINNHUB_API_KEY`), the
   Finder makes no Finnhub request: it uses the stored earnings rows, or says the calendar could not be read.
4. **Before listing:** EODHD's answer on public display of options quotes (and whether OPRA's fee is included).
   Listing is then a one-line change to the flag, plus a Build Notes line (see "Departures").

## What was built

| Step | What | Where |
|---|---|---|
| F1 | Expirations page through the provider's list; an additive `session` field on the expirations and chain answers; the lens's stamp | `api/providers/market.py`, `web/src/screens/markets/SingleName.tsx` |
| F2 | The engine, `finder-2`: screens, carry from the market's forward, sizing in whole cents, European closed forms, an American lattice with a certified early-exercise bound, events, the three lenses, top-20 pruning by value bounds | `src/desk/options_math.py`, `src/desk/options_finder.py`, `docs/desk/OPTIONS_FINDER_MODEL.md` |
| F3 | `GET /api/desk/options/finder` in the Desk v2 envelope: the paging chain scan, the session checks, the stored inputs as a worker item, the Finder's own Finnhub client | `api/desk_options.py`, `api/providers/finnhub_finder.py`, `api/analytics_cache.py` |
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
  provider ceiling and the Desk envelope's route list. `api/providers/finnhub.py` is unchanged.
- `deploy/api.env.example`: one documentation line for `FINNHUB_FINDER_API_KEY` (the env-template test requires
  every variable the API reads to be named there). It changes no deploy setting; the owner was asked to confirm it.

## Tests

- Python: the full suite at the branch's head, 2,438 passed, 75 skipped, 2 failed, against 2,125 passed, 80 skipped
  and 1 failed at the base. Both failures are timing tests that also fail on the base when run in the full suite
  (`test_no_secret_in_logs`'s uvicorn startup-log race, in the baseline; the profile's two-calls-in-parallel test,
  which failed in one of two extra full runs of the base) and pass when run alone. The five fewer skips are tests
  that need a built `web/dist` and the web dependencies, absent from the base's checkout. The Finder's own tests:
  route 81, numerical library 140, engine 56, on synthetic chains, plus the contract and route-list tests.
- Web: vitest 156 files, 1,987 tests, all passing; typecheck and build clean. Playwright: the Finder's spec 4 of 4;
  `desk.spec.ts`, `desk-usability.spec.ts` and `desk-mobile.spec.ts` 98 of 98, the Finder added to the palette and
  language audits.
- Fixtures are synthetic: an invented $100 stock (SYN) whose quotes the engine's own lattice priced
  (`scripts/options_finder_fixture.py`). No provider data is in the repository.

## Review

Every design (F1, the engine, the route) passed an independent Codex review before it was built; the code then had
a Codex review of the whole branch. Its first round found two defects, both fixed with tests that fail on the old
code: a share-class listing such as BRK.B lost its share class in the contract root, so every standard contract was
screened out (its earnings dates are now not checked, rather than read under an unverified spelling); and in the
Position Monitor, changing the instrument after "Save as position" kept the carried contract attached.

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
- **The Data Pipeline row is deferred** (the owner chose "Yes to both" on that card).
- **`finder2_carry` lives in `options_finder.py`**, not its own module.
- **F7's tests are in `positions/option.test.tsx`**, not spread over the three files the plan names.

## Risks

| Risk | What is in place |
|---|---|
| Display rights (EODHD plan, OPRA) | Unlisted until the owner confirms. The same question covers the live Options lens. |
| Marketplace quota | Per-session chain cache, the provider ceiling, one scan at a time, typed refusals (`busy`, `rate_limited`). |
| Wide chains | The work budget refuses with a reason, never a partial ranking; top-20 pruning by proved value bounds. |
| Modelled values | Labelled modelled, with the volatility held and the ±10-point sensitivity on every modelled contract. |
| Events | Earnings, macro releases and dividends before the date are listed and flagged on each contract; other company events are named as not tracked. |
