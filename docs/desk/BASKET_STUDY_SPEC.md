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
- **History.** `/basket/price` reads two years of daily bars per name, too short for most questions (the
  z-score needs 240 of its trailing 252 moves before the first event can be judged). The study reads each name's EODHD daily bars
  from `1995-01-01` (`STUDY_HISTORY_FROM`): the regime labels the engine needs start in 1996 on the
  current store, and the z window needs a year before that. One EODHD end-of-day request per name, the
  same 1 API call as the two-year request (EODHD charges end-of-day requests per request, not per row);
  cached per name per completed New York session in a compact form (dates, adjusted closes and closes as
  traded, as arrays; cap weight reads the traded closes, as `/basket/price` does), apart from the two-year
  cache, which is unchanged.
- **So the study's index is not the chart's rebased.** The start is the first session every name has a
  close in the longer history, usually years before the chart's. With buy-and-hold the weights drift
  from that earlier start, so the two indices' returns differ. With monthly rebalancing they agree on
  every month both cover after each has rebalanced once. The answer states the study's own start and
  which name sets it.
- **A basket with a recent listing has a short history.** The index starts on the first XNYS session
  every name has a close (the page's rule, `price_basket`). That is usually the youngest name's first
  close (that name binds); when a name lacks a close on that day, the start is the next session every
  name has one (the names without a close the session before bind); when every name starts the same day,
  it is that day. Names that share no session are refused (422) with the page's words. No `w`-session move can have a z-score before the (240 + `w`)th session of the index's calendar span
  (sessions some name lacks counted): a move reads the session `w` before it, and the z window needs 240
  moves present (it reaches back 252). An index whose span is shorter is not run, and the answer says why, with the index's start and why it is
  there (the binding name's first close, or the names that had no close the session before). Nothing is backfilled and no name is dropped. An index whose span is long enough is handed
  to the engine unchanged, which decides the rest by its own masks: a span with gaps can still lack 240
  moves in every window (the engine then refuses, and the answer gives its words), a session whose window
  has zero variance has no z-score, and a question with no event or no evaluable session answers with the engine's own empty
  state or refusal.
- **Prices.** Split- and dividend-adjusted closes (total return), as `/basket/price` reads them; a bar
  without an adjusted close is left out, never priced from its raw close, and counted (Codex R-07 of
  desk/books). Cap weight reads today's share counts at the study's start (the page's rule); a split or
  large distribution after the start refuses cap weight with the page's reason.

## 3. Sampling and date alignment

- **Calendar.** The engine's XNYS calendar from `exchange_calendars` (4.13.2), sessions and early closes
  included, over the index's span. Nothing is derived from the bars' dates.
- **Alignment.** The index is aligned onto the calendar. A session on which any name lacks a close is
  not an index session; it is missing, never filled, and counted. A name's bar dated off the calendar
  is left out before the index is formed and counted per name (`off_session`); the engine sees only
  index sessions, so its own off-calendar count is of the supplied index and is zero.
- **As-of.** The bars are asked through the last completed New York session. The engine reads nothing
  dated after the request's generation's as-of (review R-06), the same cutoff a stored study uses, and
  counts what it leaves out. The regime labels are read from that generation's copy.
- **A close not published yet.** Asked just after the close, EODHD may not have published that session
  for every name, or may post a session's bar before its adjusted close (a bar without one is left out, so
  the name's newest usable close is the session before). The answer then states the session asked for, each
  name's newest close and the index's last session, and says the newest session is missing. The name's
  history is asked again after the provider's retry interval (15 minutes, as the two-year bars are) while
  its newest adjusted close precedes the session, and so is the study built on it (review S-04).
- **Timing.** The index is fixed and known at the session close (every input is an exchange close), so
  an event enters the basket at the event session's close, as an S&P 500 study on itself does; the
  baseline takes the same entry. One exception is the page's monthly rule, kept unchanged: it rebalances
  on the month's last index session, so when a name has no close on the calendar month-end the
  rebalance is held on the earlier session, which was only known to be the month's last index session
  afterwards. The index's return after it is then not one an investor could have held at the time. The
  answer lists those sessions (`moved_rebalances`) and says so; buy-and-hold and cap weight's resets
  (each month's first index session) have no such case. A causal rule would change the page's index and
  needs its own approval.

## 4. Missing data

- A `w`-session move reads sessions t−w and t; a forward window reads e and e+h; a missing session on
  either end excludes the window and is counted. The z window needs 240 of its 252 moves.
- A non-finite or non-positive index level is an exclusion with a reason (R-17).
- A name the provider does not list is refused naming it (422 `unknown_symbol`); any other provider
  failure keeps its status and words (as `/basket/price`).

## 5. Overlapping returns

- **Events.** The `w`-session move is overlapping by construction. After an event at session t,
  sessions t+1 to t+`w` are a cooldown; the next session past 2σ after it is a new event. A move that
  stays past 2σ longer than the cooldown therefore counts again (with `w` = 5 and 13 sessions past 2σ,
  three events), and at a short horizon those events can fall in separate blocks. This is the engine's
  rule for every study, unchanged.
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
table from the FRED vintages of INDPRO and CPI current at that refresh, so a historical label is not what
was knowable then (review S-07: the served data may be an earlier day's).
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
question), 202 `computing` past 8 s, 429 `busy` when the queue is full, a repeat a lookup. A job past 8 s
keeps running and the next request reads it; a failed job is not kept, so the next request computes it
again; an answer built while a close was not yet published is computed again on a request 15 minutes or
more later (§3). The answer
is the `/study` shape for one horizon (§12.2's fields that apply), plus the index's provenance. A
basket too short for the question answers ready with `study: null` and the reason.
Needs a Render deploy to go live.
