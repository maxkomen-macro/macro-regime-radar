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
   a card with a lead, so it is a full-width card under the 2×2. The
   correlation card's Advanced now lists only "rolling windows · by regime".
   Neither is served, so it stays disabled.
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
