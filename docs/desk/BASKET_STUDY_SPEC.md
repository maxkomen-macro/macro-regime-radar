# Event study on this basket (P1a): method spec

Status: written before the code, as the Desk real-data plan requires (P1a; D0 and D6 approvals,
`desk-upgrade/APPROVED.md`). It replaces the PROTOTYPE card "Event study on this basket"
(DESK_FRAME3_SPEC §10) with the existing event-study engine run on the basket's own index.
P1d (optional 80% and 95% intervals) is a later PR; this one serves the engine's 90% interval only.

## 1. The question

After the basket's index moves 2σ over `w` sessions (`move` = `down2s` or `up2s`, `w` = 5, 20 or 60),
what did the basket's index do over the next 5, 10, 20 and 60 sessions, against every evaluable
session of its own history (the baseline)? Defaults: `w` = 5, `down2s`, horizon 20 (the prototype's
question). The basket is both the shock and the target. There is no co-condition ("while") in P1a.

## 2. The series studied

- **The index is the page's index rule over a longer history.** `src/desk/basket.price_basket`, the
  same function `/basket/price` prices with: the saved legs, at their typed weights or cap-weighted from
  the stored share counts, held or rebalanced monthly; base 100 on the first XNYS session every name
  has a close, defined on every later session every name has a close.
- **History.** `/basket/price` reads two years of daily bars per name, too short for the engine (the
  z-score alone needs 252 moves before the first event). The study reads each name's EODHD daily bars
  from `1995-01-01` (`STUDY_HISTORY_FROM`): the regime labels the engine needs start in 1996 on the
  current store, and the z window needs a year before that. One EODHD end-of-day request per name, the
  same 1 API call as the two-year request (EODHD charges end-of-day requests per request, not per row);
  cached per name per completed New York session in a compact form (dates and closes as arrays), apart
  from the two-year cache, which is unchanged.
- **So the study's index is not the chart's rebased.** The start is the first session every name has a
  close in the longer history, usually years before the chart's. With buy-and-hold the weights drift
  from that earlier start, so the two indices' returns differ. With monthly rebalancing they agree on
  every month both cover after each has rebalanced once. The answer states the study's own start and
  which name sets it.
- **A basket with a recent listing has a short history.** The index starts at the youngest name's first
  close. When that leaves too little history for the question (fewer sessions than the z window and the
  move need, or no evaluable session), the study is not run and the answer says why, with the index's
  start and its binding name. Nothing is backfilled and no name is dropped.
- **Prices.** Split- and dividend-adjusted closes (total return), as `/basket/price` reads them; a bar
  without an adjusted close is left out, never priced from its raw close, and counted (Codex R-07 of
  desk/books). Cap weight reads today's share counts at the study's start (the page's rule); a split or
  large distribution after the start refuses cap weight with the page's reason.

## 3. Sampling and date alignment

- **Calendar.** The engine's XNYS calendar from `exchange_calendars` (4.13.2), sessions and early closes
  included, over the index's span. Nothing is derived from the bars' dates.
- **Alignment.** The index is aligned onto the calendar. A session on which any name lacks a close is
  not an index session; it is missing, never filled, and counted. A bar dated off the calendar is
  dropped and counted by the engine.
- **As-of.** The bars run through the last completed New York session. The engine reads nothing dated
  after the request's generation's as-of (review R-06), the same cutoff a stored study uses, and counts
  what it leaves out. The regime labels are read from that generation's copy.
- **Timing.** The index is fixed and known at the session close (every input is an exchange close), so
  an event enters the basket at the event session's close, as an S&P 500 study on itself does; the
  baseline takes the same entry.

## 4. Missing data

- A `w`-session move reads sessions t−w and t; a forward window reads e and e+h; a missing session on
  either end excludes the window and is counted. The z window needs 240 of its 252 moves.
- A non-finite or non-positive index level is an exclusion with a reason (R-17).
- A name the provider does not list is refused naming it (422 `unknown_symbol`); any other provider
  failure keeps its status and words (as `/basket/price`).

## 5. Overlapping returns

- **Events.** The `w`-session move is overlapping by construction; after an event the next `w`
  sessions are a cooldown, so one episode counts once.
- **Forward windows.** Events whose forward windows overlap form one block; the interval is a cluster
  bootstrap over blocks (exact enumeration up to 7 blocks, 10,000 Monte Carlo draws above, seed
  20260921). An interval needs 5 blocks; a zero-exclusion claim needs 10 blocks and under 3% of
  resampled medians adverse.
- **Baseline.** Every evaluable session, overlapping forward windows included; its median is the
  comparison, not resampled (the engine's rule for every study).

## 6. What the interval measures

The 90% cluster-bootstrap interval on Δ, the event median minus the baseline median, at each horizon,
in log return. It measures how much the event median moves when the episodes (blocks) are resampled.
It does not measure model error, regime change, the selection of the basket, or what a future episode
will do. The verdict is the Desk's rule v1 (§1.5) at the selected horizon, unchanged.

## 7. Regimes (P-1)

The by-regime rows are the engine's: each event takes the label of the regimes row stamped two months
before its month (K−2). Those labels are **revised regime history**: every full refresh rewrites the
table from today's FRED vintages of INDPRO and CPI, so a historical label is not what was knowable then.
The card says "Revised regime history". "As known at the time" labels are the point-in-time build
(P5), not available yet; the card does not offer them.

## 8. What the answer cannot claim

- **Hindsight.** The basket is chosen today. Its history is a backtest of names picked knowing how they
  did, and a name that failed or was delisted cannot be in it. The card says so.
- No verdict is advice. No number is shown that is not traced to the provider's closes, the stored
  regime table or the engine's output.

## 9. Serving

`GET /api/desk/basket/study?legs=…&method=…&weighting=…&window=…&move=…&horizon=…` (spec §12.19).
The basket parameters are `/basket/price`'s (no `notional`: the index's returns do not depend on it).
Computed on request behind the provider ceiling: a job per (generation, completed session, basket,
question), 202 `computing` past 8 s, 429 `busy` when the queue is full, a repeat a lookup. The answer
is the `/study` shape for one horizon (§12.2's fields that apply), plus the index's provenance. A
basket too short for the question answers ready with `study: null` and the reason.
Needs a Render deploy to go live.
