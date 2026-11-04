# Desk P1b: correlation windows and correlation by regime (method spec)

Approved scope: D6 (Analyst Desk real-data upgrade, 2026-11-03), "Approve 20/60/120-session
correlation views ... Specify sampling, date alignment, missing-data handling, overlapping-return
treatment and what the intervals measure. Label analyses using revised regime history
appropriately", and P-1 of the 2026-11-04 point-in-time decision ("Keep revised history as the
clearly labelled default, with 'As known at the time' available alongside it"). No served regime
or recession model changes.

This spec was written before the code. It extends three blocks the Macro tab already serves
(`/macro` `stock_bond`, `correlations`, `matrix`, DESK_FRAME3_SPEC §12.8), all computed by the one
worker item `desk_etf` (`api/desk_items_etf.py`). Every value that tab serves today stays exactly
as it is: the new values are new keys beside them.

## 1. What is added

| Block | New key | What it holds |
|---|---|---|
| `stock_bond` | `horizons` | `[20, 60, 120]` |
| `stock_bond` | `by_horizon` | for each of `"20"`, `"60"`, `"120"`: today, a year ago, the last change of sign and the one-year line, as the block serves them for 60 today |
| `correlations` (each row) | `by_horizon` | for each horizon: the correlation with SPY, its window and its reason when null |
| `correlations` (each row) | `by_regime` | the correlation with SPY pooled within each regime, and over all labelled returns (§4) |
| `matrix` | `horizons`, `by_horizon` | for each horizon: the 12×12 values, the assets without data and why, the window, each asset's coverage and the lead sentence |

`by_horizon["60"]` is the block's existing 60-session answer, field for field (a test pins it), so
a client can read every horizon one way. The existing top-level fields are untouched.

## 2. Sampling and date alignment (all views)

- **Prices:** the adjusted daily closes the full refresh stores in `asset_prices`
  (`interval = '1d'`), read through the engine's reader `event_study.load_level` (completed
  sessions only, nothing after the generation's as-of). ^VIX is the CBOE index level.
- **Calendar:** every series is aligned onto the XNYS session calendar the engine builds
  (`event_study.session_calendar`), not onto the rows any series happens to hold. A session without
  a close is a gap. A close that is not finite and positive is a gap (`validate_values`).
- **Return:** the daily log return `ln(P(i) / P(i−1))` on return date `i`, where `i−1` is the
  previous XNYS session. It exists only when both closes are stored. ^VIX uses the daily log change
  of the level. Nothing is forward-filled or interpolated, and a return is never formed across a gap.
  - The return is computed exactly as the 60-session blocks compute it today (`daily_returns`, the
    ratio, then the log), so the three horizons share one return series and the 60-session values
    stay unchanged.
  - A return that comes out non-finite counts as missing, like a gap. Only a ratio that overflows or
    underflows can do that, which needs prices near the float limits; validated ETF closes never come
    close.
- **Pearson:** the centred form `Σ dx·dy / √(Σ dx² · Σ dy²)` over the window, with means taken over
  the window. A window where either sum of squares is zero has no variation. A non-finite result is
  null.
- **Pairs:** a correlation uses only return dates on which both series hold a return.

## 3. Rolling windows: 20, 60 and 120 sessions

- **Statistic:** Pearson's correlation of the two daily return series over the `w` most recent
  XNYS return dates ending at `t`, for `w` in 20, 60 and 120. That is about one month, one quarter
  and six months of trading.
- **End session `t`:** the same rule as today, for every horizon:
  - `stock_bond` and each `correlations` row use the newest session on which both series hold a close.
  - `matrix` uses the newest session on which every asset with a valid close holds one.
  - The three horizons of one block share `t`, so they can be read side by side.
- **Missing data:** a window is served only when all `w` return dates hold a return for both
  series. Otherwise the value is null with the same reason each block already gives at 60, with
  `w` in place of 60:
  - `stock_bond` and the `correlations` rows: "fewer than `w` complete daily return pairs in the
    window to `<date>`".
  - the matrix: "only `<coverage>` of `w` daily returns in the window to `<date>`: `<first gap>`".

  A window with no variation in either series is null with that reason. In the matrix, an asset
  without a complete window at that horizon is "no data" at that horizon only. It can be served at
  20 and not at 120.
- **Unavailable paths:** these keep the block-level behaviour each block has today.
  - `stock_bond` awaits while SPY or TLT is not stored, or no session holds both. The views live
    inside the block, so they await with it.
  - The `correlations` block awaits while SPY is not stored, or every listed asset is not.
  - A row the store cannot compute has `date` null: the asset is not stored, or no session holds
    both. Its `by_horizon` and `by_regime` are null, and its own `reason` says why.
  - The matrix awaits as it does today.
- **Overlap:** the windows on consecutive days share `w − 1` of their `w` returns. The one-year
  line is therefore smooth by construction, and neighbouring points are not independent
  observations. The returns inside one window do not overlap: each is one session's move. This
  differs from the event study's forward windows, which do overlap and are block-resampled.
- **Year ago and flipped:** these are computed per horizon with the existing rules. "Year ago" is
  the last session on or before `t` minus 12 calendar months. "Flipped" is the newest change of sign
  among sessions with a complete window, skipping zeros. A shorter window can change sign more
  often than a longer one; the noise note under the window control (§7) says how noisy each window
  is.
- **Noise reference (`noise_band`):** each horizon's entry serves
  `noise_band = tanh(1.6448536 / sqrt(w − 3))`, rule `fisher-z-90-iid`. That gives 0.38 for 20,
  0.21 for 60 and 0.15 for 120.
  - **What it is:** Fisher's approximation to how far from zero a sample correlation lands one time
    in ten, when the true correlation is zero and the returns are independent, identically
    distributed and normal. It is an approximate reference under those assumptions.
  - **Its calibration:** real returns have fat tails, volatility clustering and serial dependence,
    and these can make the true spread wider or narrower. It is neither a floor nor a ceiling.
  - **Its use:** it is served so the page can say roughly how noisy a short window is. It is not a
    confidence interval for the served value, and nothing is tested against it.

## 4. Correlation by regime

**Which regime history.** These correlations use the revised regime history: the labels in the
`regimes` table as stored today, computed from today's revised data. They are served with
`regime_history: "revised"`. The "As known at the time" history (P-1) needs the point-in-time
regime build (plan P5), which does not exist yet. Until it does, the block serves `as_known: null`
with that reason and never presents revised labels as what was known at the time.

**Alignment.** A return date in calendar month K takes the label of the regimes row stamped
K − 2. This is the event-study engine's own rule (`event_study.regime_at`, `REGIME_LAG_MONTHS = 2`),
and `/regime` `stats` uses it too: a row needs data published mid K − 1, so K is the first month in
which it could govern. Regimes are read with `event_study.load_regimes` and are never recomputed.
A return date whose month K − 2 has no row is Unlabeled. That covers dates before the first
labelled month, after the last, and around a missing row such as 2025-10. Unlabeled dates are
counted (`unlabeled_n`) and excluded from every regime and from "all".

**Statistic.** For each pair (SPY and one asset of the "What moves with the S&P" list), and for
each of Goldilocks, Overheating, Stagflation and Recession Risk:
- **Correlation:** Pearson's correlation of the pooled daily returns of every labelled return date
  with that label, from the pair's first common return date through `t`. `t` is the row's own end
  session (§3). The returns are demeaned with the regime's own pooled means.
- **All:** the same statistic over every labelled return date, for comparison. It serves `n`,
  `first`, `last` and the reason, and no spell fields: it pools every regime, so its runs are not
  spells of one label.
- **What is served per regime:** `n` (return dates used), `first` and `last` (the first and last
  dates used), `spells`, `largest_spell_share` and the reason when the value is null.
- **`spells`:** the number of runs that contribute at least one return date used. A run is a
  stretch of consecutive calendar months with that label among the months the sample covers; a
  missing regime row, or a month with another label, ends it. A run with no complete pair (for
  example, one asset holds no close in it) is not a spell, and it still separates the runs on
  either side.
- **`largest_spell_share`:** the share of `n` that falls in the largest spell.

**Missing data and minimums.** A return date counts only when both returns exist (§2). Return
dates inside the sample's span where one return is missing are counted as `incomplete_n` and left
out. A regime with fewer than 60 returns (`MIN_REGIME_RETURNS`, the default window's size) is null
with the reason "only n daily returns in <regime>". A regime with no variation is null with that
reason.

**Regime at the sample's end.** `current` is the label governing the row's own end session `t`
under the same lag rule. `current_row` is the month of the row it comes from (`YYYY-MM`, two months
before `t`'s month). Both are null when `t` is Unlabeled.
- **Per row:** each row ends on its own session, so the page marks each row's own cell. It marks a
  column "at sample end" only when every row's end session takes the same row, and prints the newest
  end session and that row's month beside it.
- **Never "now":** the sample ends on the last stored session, which can be days or weeks before the
  page is read, so the page never calls this regime "now" or today's.
- **Against the newest row:** this can differ from the newest stored row, which the sidebar and the
  Regime tab show, and the page says so.

**Empty samples.** These keep the block's shape:
- **No regime rows stored:** `reason` says so, `regimes` is `[]`, and `all`, `current`,
  `current_row`, `sample` and the counts are null.
- **No common return through `t`:** for example, each series holds a single close. The same, with
  the reason "no daily return both series hold through `<date>`".
- **A regime with no return used:** `n` 0, `first` and `last` null, `spells` 0,
  `largest_spell_share` null, and the minimum's reason.

**What a regime number means, and what it does not.**
- It describes how the two assets co-moved on the days the revised history assigns to that regime.
- Pooled Pearson weights high-volatility days more, so one crisis inside a regime can dominate its
  number. `spells` and `largest_spell_share` are served so the page can show how concentrated the
  sample is.
- No interval is served for these values in this PR. The approved interval work (P1d) is for the
  event study.
- A spell-cluster bootstrap would be the natural interval here: spells are the independent units.
  It would be a separate proposal.
- A difference between two regimes is not shown as significant, and the page never calls one regime
  "different".

## 5. Provenance on every value

Each block keeps `source: "asset_prices"`, `providers` (only the providers of the series that block
reads), `date` (its end session) and its window `{start, end, n}`. Each by-regime row names the
regime history (`revised`), the rule sentence, the sample's first and last return dates, and `n`.
The page prints these stamps and computes no number of its own.

## 6. Tests

These pins hold on synthetic stores (no database needed):
- `by_horizon["60"]` equals the existing 60-session fields exactly, in all three blocks.
- At every horizon, a hand-computed Pearson matches the served value.
- A gap inside the 20-session window nulls 20 with its reason while 60 and 120 obey their own windows.
- The matrix serves an asset at 20 and not at 120 when its history is shorter than 121 sessions.
- The noise band values match the formula.
- Regime alignment uses the K − 2 row, from `event_study.regime_at`.
- Unlabeled dates, including a missing row, are counted and excluded.
- The regime minimum nulls a regime with its reason.
- Pooled Pearson matches a hand computation.
- `spells` and `largest_spell_share` are counted correctly, including a run with no complete pair
  between two runs that hold pairs (two spells, not three or one).
- `current` is correct, and null when Unlabeled.
- `regime_history` is `"revised"` and `as_known` is null with its reason.

The same pins run on the published database copy. `/macro`'s existing contract checks, extended in
`tests/desk_contract.py`, cover the new keys. `src/desk/` is not changed, so the Desk native
regression gate is not triggered. The engine's existing tests run unchanged.

## 7. Web

The Macro tab gets one control, "Correlation window: 20 · 60 · 120 sessions", above the
correlation cards, set to 60.
- **What it switches:** "Do bonds still hedge stocks?", "What moves with the S&P" and the matrix
  all switch to the chosen horizon. Each card's subtitle names the horizon it shows.
- **Definitions:** the shared hover definition of "correlation" names no window ("over the window or
  sample the card names"), so it reads true at 20, 60 and 120 and on the regime card.
- **Noise note:** under the line, the served noise band is printed as a sentence: "With 20 daily
  returns, a true correlation of zero reads beyond about ±0.38 one time in ten if returns were
  independent and normal; real returns can be more or less noisy than that."
- **New card, "Correlation by regime":** full width. It is a table of the nine assets against SPY,
  one column per regime plus All.
  - **Marking:** each row's regime at its sample end is marked in that row. A column is marked
    "at sample end" only when every row agrees (§4).
  - **Cells:** each regime cell shows the served value with its n and spells; the All cell shows
    its value and n. A null cell shows its reason.
- **Labels on the card:**
  - It is headed "Revised regime history".
  - It states the K − 2 rule in one line.
  - It says "As known at the time: not available yet (needs the point-in-time regime history)."
  - It notes that one episode can dominate a regime's number.
- **Advanced panel:** the stock–bond card's Advanced list drops the items now served.
- **Not served yet:** Build Notes keeps "since 1990" and the 250-day window as not served.
