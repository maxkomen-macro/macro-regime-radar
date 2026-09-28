# desk/matrix: the 12-asset correlation matrix

Branch `desk/matrix`, cut from `origin/main` at `23014d0` on 2026-09-27. Not pushed.

## What is served

`GET /api/desk/macro` `matrix` (§12.8) is a ready block from the `desk_etf`
worker item (`api/desk_items_etf.matrix`):

- **Assets**, in this order: SPY, QQQ, IWM, SMH, XLE, TLT, IEF, HYG, LQD, GLD,
  UUP, ^VIX, all from `asset_prices`.
- **Method**: Pearson's r of daily log returns (^VIX: daily log changes of the
  level) over 60 XNYS return dates. The window ends on the newest session on
  which every stored asset has a close. Every pair uses that one window. Each
  cell goes through `corr_at`, the function the "What moves with the S&P" list
  uses; `daily_returns` and `awaiting_refresh` are shared too. There is no
  second copy.
- **No data**: an asset that is not stored, or that lacks 60 complete daily
  returns in the window, or that does not vary in it, has its row and column
  null. Its reason goes in `no_data`. Nothing is filled or estimated.
- **Lead** (`matrix-lead-v1`): "Treasuries are [not] hedging equities (SPY and
  TLT at r); the highest pair is A and B at r and the lowest C and D at r."
  Treasuries count as hedging when the SPY–TLT cell is below zero. Every
  number in the sentence is a served cell.

The card is one full-width card under the 2×2:
- the served lead;
- the 12×12 grid, values in the cells, the pair and window on hover;
- green tints for negative values and amber for positive, stronger as |r|
  grows, gray on the diagonal. These are the Desk's palette colors only;
- a five-swatch legend;
- the stamp "60 daily returns · <start> to <end> · the same window for every
  pair · <provider>";
- the no-data reasons listed under the grid.

The spec marks the block LIVE in §1.0, with its fields in §12.8 and the card
in §6. Build Notes and `notes/scope.ts` move the matrix from "not yet served"
to Live.

## Where I followed the tree over the instruction

1. **"The last 60 common XNYS sessions … ending at the last session where all
   12 have closes."** The existing correlation code, which the brief says to
   reuse, reads 60 *consecutive* XNYS return dates. A window with a gap is
   incomplete, not shortened to the common sessions. So an asset with a gap
   inside the window is "no data", with the first gap named. It is not
   skipped over. When all 12 are stored, the end session is the one where
   all 12 have closes. When some are not stored (a database from before the
   full refresh), it is the newest session on which every *stored* asset
   has a close.
2. **"Least correlated"** is the lowest r, i.e. the most negative, and the
   sentence says "lowest" so it can't be read as "closest to zero".
3. **The lead is served, not written by the page.** The Macro page prints
   only the API's sentences (its header comment and §6), so the sentence and
   the numbers it cites are part of the block.
4. **Its own card rather than under Advanced.** §6 and the PNG put "full
   12-asset matrix" under the correlation card's Advanced. The brief asks for
   a card with a lead, so it is a full-width card under the 2×2. Rolling
   windows and the correlations by regime are not served. At review the
   owner asked that the correlation card carry no Advanced control at all
   rather than a disabled one, so it has none. Build Notes lists both views
   under "What I'd build next", and §6 says the control returns when one is
   served.
5. **Colors.** "Negative to positive" uses the same mapping as the "What
   moves" bars: green for negative (moves against), amber for positive
   (moves with), gray for zero and the diagonal. These are rgba tints of
   three of the five accents, which `desk-palette.test.ts` allows.
6. **The Data Pipeline.** SMH and XLE now feed Macro
   (`desk_pipeline.MATRIX_SERIES`). SMH's "No Desk tab reads it yet" note is
   gone, and `pipeline.json` changes in those two rows.
7. **Fixtures.** `macro.json`'s `matrix` is what the API serves on the fixture
   store. That is desk/fill-etf's store plus ^VIX rows from a copy the
   refresh step filled on 2026-09-27, cut at 2026-09-23.
   - Rebuilding every ETF row from a fresh fetch would have moved the other
     blocks by about 1e-7. The providers restate adjusted closes after
     dividends. So only the ^VIX rows were added.
   - Only `matrix` and the two pipeline rows changed; the correlation list's
     ^VIX row still reads −0.75.
   - The illustrative `deferred-macro.json` (the mockup's matrix) is deleted.
   - `servedMacro()` now reads the served block.

## Verification against a real API

I couldn't download the latest published database: `gh` is denied in this
session. I used the newest local copy of the published store,
`mrr-compute/data/macro_radar.db` (sha256 `aefa2c0e2be70491…`, SPY to
2026-09-25, 6 of the 12 assets stored). I ran it two ways:

| Run | Database | Result |
|---|---|---|
| `post-refresh` | that copy after this branch's refresh step (`python -m src.market_data.asset_history --db <copy>`, Yahoo, the workflow's command) | all 12 served, 60 returns Jul 2 to Sep 25, lead "Treasuries are not hedging equities (SPY and TLT at +0.48); the highest pair is IEF and LQD at +0.96 and the lowest SPY and ^VIX at −0.74."; 144 cells, 0 differ from the served values |
| `pre-refresh` | the copy as published | QQQ, SMH, XLE, TLT, UUP and ^VIX are "no data", each with "Awaiting refresh: the full refresh stores <symbol>; this database predates it."; the lead leaves out the hedge clause (no TLT) |

Both runs used a local `uvicorn api.main:app` (port 8031, `EODHD_API_TOKEN`
and `GH_DB_TOKEN` empty) and Vite without `DESK_FIXTURES` proxying to it.
Shots and the served block are in `docs/desk/shots/desk-matrix/`:
`<run>-macro.png`, `<run>-matrix-card.png` and `<run>-macro.json`.

SPY–TLT +0.48 on Sep 25 equals the stock–bond card's value on the same
database.

| Card | State |
|---|---|
| Macro · Correlation matrix | LIVE-verified (both runs) |
| Macro · What moves with the S&P (its Advanced line only) | LIVE-verified, unchanged values |

No database file is committed or hand-edited. The only SQLite writes were to
scratch copies outside the repo.

## Tests

- **API** (`tests/test_desk_etf.py`):
  - a hand-checked 3-asset case: SPY, TLT, GLD, with r = −1, 1/√3 and −1/√3
    worked out by hand in the docstring;
  - every cell against numpy on the synthetic store. There the synthetic
    ^VIX has no variation, so it is "no data";
  - a gap inside the window ("no close stored for <day>");
  - the lead's partial forms;
  - the route, the contract and the pipeline parity.
- **Contract** (`tests/desk_contract.py`): the served shape replaces the
  deferred entry.
- **Web** (`MacroPage.test.tsx`):
  - the served lead, the window and every cell against the fixture;
  - the tints;
  - an asset with no data in its row and column, with its reason;
  - a hand-checked 3-asset grid;
  - the awaiting card.

## Gates

Per commit: tsc, `vitest run --minWorkers=1 --maxWorkers=2`, build, and the
related pytest files. The first commit's gate: tsc clean, 1,566 vitest tests
in 124 files, build clean, 282 pytest passed and 1 skipped. The skip is the
fixture-store parity test; it passes when `DESK_ETF_STORE` points at the
fixture store. The full pytest and the Desk e2e wait for the owner's
"go full gates" (`/tmp/mrr-full-gates.lock`).

## Codex round 1 (on `b1ba2a2`: DO NOT PUSH, three findings)

Codex checked the math (144 cells against NumPy to 1.7e-14) and returned three
findings. Each is fixed in its own commit, with tests built from the finding.
Codex's exact repro inputs were not in the message I received, so each test
rebuilds the repro from the finding's description.

| # | Finding | Fix | Test |
|---|---|---|---|
| R-01 | The card drew whatever grid the answer held: reordered assets, a ragged or asymmetric grid, a lead naming other pairs | `macro/matrix.ts` `matrixProblem` checks the matrix as one fact before any of it is drawn (§6). A failure makes the whole card unavailable with the failed check in words | `MacroPage.test.tsx` "Codex R-01": 19 served matrices, each with one field changed, each rendered: the card shows the reason and draws no table, cell, lead or stamp. The served fixture and the API's other shapes (some assets without data, one pair, none) pass |
| R-02 | `window.n` was the constant 60 over a window clamped to the calendar's start, and the frontend fell back to 60 when no count was served | The API serves `horizon` (60, requested) apart from `window.n` (the return dates the calendar holds in the window) and each asset's `coverage`; no-data reasons state the count ("only 58 of 60 daily returns …"). The card prints "60 daily returns" only when `window.n` equals `horizon`, otherwise "Only 29 daily returns to …; each pair needs 60". A matrix without its count or horizon, or with a value over fewer returns, is not drawn. Every fallback count is gone, including the stock–bond and correlation stamps, which print the served count or none | `test_codex_r02_a_calendar_shorter_than_the_horizon_serves_its_observed_count` (30 closes: `window.n` 29, `horizon` 60, coverage 29 each, no pair); the gap test's 58 of 60; web "Codex R-02": the 29-return card, no count assumed, values over fewer returns refused, the other stamps without a served count |
| R-03 | A stored asset without one valid close took part in choosing the end session, so no session held a close of all twelve and the whole matrix awaited | Only assets with a valid close choose the end session. One without is "no data" with "no valid close among its <n> stored rows (each must be a finite, positive close on an XNYS session)", and every other pair is computed. With no stored asset valid, the block awaits with that reason | `test_codex_r03_an_asset_without_a_valid_close_is_no_data_and_the_rest_are_computed` (every XLE close set to 0 on a scratch store: XLE null with the reason, every other pair equal to NumPy on the others' last common close; fails on the pre-fix module with the whole block awaiting), and the case with no valid asset |

Still open (not a finding): a stored asset whose valid closes all predate
another's first close leaves no common session, and the block awaits. Which
asset to set aside then is a policy call I haven't made.

## Rebase onto origin/main `83a9f46` (2026-09-28)

Codex returned PUSH OK on R-01 to R-03. I ran `git fetch origin && git rebase
origin/main`, with the pre-rebase head kept as
`backup/matrix-pre-rebase-e4c4dd8`.

**The tree differs from the instruction.** The owner wrote that
desk/prototypes and desk/usability are merged. After the fetch, origin/main
is `83a9f46`, the desk/books merge (#11), and `git ls-remote` agrees.
Neither branch is in it:
- desk/prototypes (`3ae4a22`) sits on top of `83a9f46` locally but is not
  merged.
- desk/usability is being rebased onto `83a9f46` in another worktree
  (`mrr-usability`, interactive rebase in progress).

So this rebase is onto `83a9f46`. U's no-dead-control guard and page purpose
lines are not in this tree, and can't be checked against Macro yet. Macro
carries no disabled control (`b1ba2a2`) and no Advanced control on the
correlation card. The matrix card has none either.

**Conflicts, and how each was resolved:**

| File | Commit replayed | Conflict | Resolution |
|---|---|---|---|
| `docs/desk/BUILD_NOTES.md` | `5dab92e` (the matrix) | "What I'd build next": desk/books reworded the options clause ("the vol card and the options hedge on a basket can go live"); this branch removed "the 12-asset correlation matrix" from the list | desk/books' wording, without the matrix |
| `web/src/fixtures/desk/PROVENANCE.md` | `5dab92e` | the fixture table: desk/books added the `basket-price.json`/`basket-hedge.json` row beside the deferred-shapes row this branch rewrote (`vol.json` only, `deferred-macro.json` removed) | both rows: this branch's `vol.json` row, then desk/books' basket row |
| `docs/desk/BUILD_NOTES.md` | `b1ba2a2` (no Advanced control) | the same sentence again: this branch adds the rolling-window and by-regime correlations | desk/books' options wording plus this branch's item |

Everything else merged without conflict. After the rebase I checked the
seams by hand:
- the pipeline's reader lists and `NO_LIVE_READER`;
- the spec's §12 numbering, where desk/books added §12.15 and §12.16 and
  §12.8 and §12.13 are unchanged;
- the envelope's deferred tables.

The fixtures, rebuilt on the fixture store at the rebased head, differ from
the committed ones by zero bytes, and the fixture-store parity test passes.

**Commit map:**

| Before | After |
|---|---|
| `5dab92e` | `5b03d5b` |
| `3aab397` | `6bc4290` |
| `b1ba2a2` | `ea9a5ef` |
| `effcd04` | `c125e20` |
| `9f4f81d` | `80d7a99` |
| `e4c4dd8` | `3b615a5` |

**Shots retaken** on `3b615a5` against the local API, for both runs. Each
`<run>-macro.json` now carries `horizon`, `window.n` and `coverage`:
- `post-refresh`: horizon 60, window Jul 2 to Sep 25 with n 60, coverage 60
  for all twelve, 144 cells with 0 mismatches.
- `pre-refresh`: the six assets not yet stored have null coverage, and the
  other six have 60.

## Full gates (2026-09-28, under `/tmp/mrr-full-gates.lock`)

**First run** at `dbb79f3` (lock held 05:07:53 to 05:20:29 UTC):
- tsc clean, vitest 1,619 passed in 126 files, build clean.
- Full pytest: 1,773 passed, 1 skipped, 2 failed. The two failures are
  `tests/test_asset_history.py::test_without_the_table_the_endpoint_says_the_histories_are_not_stored`
  and `::test_validate_requires_the_table_in_full_mode_only`. They fail the
  same way on origin/main `83a9f46`, checked on a clean checkout. They depend
  on the local snapshot database's tables and dates, not on this branch.
- Desk e2e (`e2e/desk.spec.ts`, `--workers=1`): 54 of 55. The failure was
  this branch's. The Macro layout test counted every `section.dk-card.mc-card`
  and found five cards (`[363, 363, 363, 363, 490]`), because the matrix card
  carries `mc-card` too.

**Fix** `38333f1`: the test reads the 2×2's own cards
(`.mc-grid > section.dk-card.mc-card`), four and equal as before. It also
checks the matrix card: one card, under the grid, the grid's width, keeping
its height in a taller window.

**Second run** at `38333f1` (lock held 05:22:36 to 05:24:41 UTC): tsc
clean, vitest 1,619 passed, build clean, and the Desk e2e 55 of 55. The full
pytest was not rerun: the fix touches only `web/e2e/desk.spec.ts`, which
pytest doesn't read (nor tsc, whose `include` is `src`, nor vitest).
