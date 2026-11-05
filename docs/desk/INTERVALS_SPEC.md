# Desk P1d: optional 80% and 95% intervals (method spec)

Status: design, before code. It is approved as part of the Desk sequence (D0/D6; Max 2026-11-04, carried forward 2026-11-05 19:14 UTC, item 8). The verdicts stay at 90%.

## 1. What changes for the reader

The Event Study page's range block reads "Edge vs a normal period · 90% range" today. It gains a three-way level switch: **80% · 90% · 95%**, with 90% as the default. The switch changes:

- the range printed for each horizon in the rail (StudyRail `es-ranges`);
- the chart's whiskers, "range the answer could fall in" (AnswerCard `Bars`).

It does **not** change:

- any verdict, pill, `headline`, `why` sentence or `verdict_confidence`. They are judged at the engine's 90% exactly as now;
- the adverse-share figure;
- the CSV export;
- the Client view;
- the basket study card;
- Advanced's EngineDetail "clears zero / includes zero" line, which describes the verdict's interval and so stays at 90%.

When 80% or 95% is shown, one line under the switch says: "Verdicts are judged at the engine's 90% range; this view shows the N% range of the same resampled medians."

The level lives in the address as `ci=80|95`, and is absent for 90. A reload or a shared link keeps it. Any other value reads as 90.

**Requested and effective level (DR-02, DR-06).** The address carries the *requested* level. The page draws the *effective* level, which is one level for the whole answer, never mixed per row. Two cases are distinguished:

- **An answer that predates the fields.** Its horizons carry no `ci80_*`/`ci95_*` keys at all. The effective level is 90 for the whole answer (the fallback below).
- **An answer that serves the fields.** The effective level is the requested one, for every horizon. A horizon whose pair at that level is served null prints its reason in that row:
  - the native `reason` when `ci_lo` is also null, for example too few blocks;
  - otherwise "This range cannot be computed for this horizon."

  That row's bar draws no whisker. Such a row never borrows the 90% pair. The heading and the chart's accessible description name the requested level, and the description lists the horizons without a range.

When the old-answer fallback applies:

- the switch marks the requested level unavailable;
- the range head says "90% range";
- one line says "The N% range is not served for this answer yet; showing the engine's 90%."

`ci=N` stays in the address, so a later answer that serves the pair draws it without another click. Nothing is ever labelled with a level whose pair it is not.

**Navigation (DR-03).** `searchFor` (event-study/question.ts) keeps `ci` beside `view` and `tour`, so the level survives:

- a preset chip;
- a saved question;
- a slot change;
- the browser's back and forward.

`ci` is display state only. It is never sent to the API and never part of a study's slug, cache key or `inputs_hash`.

## 2. Method: a projection of the same draws, no new resampling

For each horizon, `horizon_stats` (src/desk/event_study.py) already computes `deltas`. These are the resampled medians minus the baseline median, from `block_resample_medians`: exact enumeration up to 7 blocks, 10,000 Monte Carlo draws above. `judge_exclusion` reads the 90% bounds off them with `tail = (1.0 - ci) / 2.0 * 100.0`:

- the lower bound is `np.percentile(deltas, tail, method="lower")`;
- the upper bound is `np.percentile(deltas, 100.0 - tail, method="higher")`.

At ci = 0.90 the tail is `4.999999999999999`, not 5. Both bounds are resampled values, rounded outward.

The 80% and 95% intervals are read off **the same `deltas` array** by **that exact expression**, called with ci = 0.80 and ci = 0.95. The tails are `9.999999999999998` and `2.500000000000002`, never a literal 10, 2.5 or 5.

- **One function (DR-01).** The expression moves into one function, `interval_bounds(deltas, ci)`. `judge_exclusion(deltas, point, ci)` calls it with its own `ci` argument, unchanged, so `ci90` is bit-identical: same expression, same calls, same arguments.
- **An independent oracle test pins this.** It holds a frozen copy of today's two percentile lines. It compares them with `interval_bounds(deltas, 0.90)` and with `judge_exclusion`'s `ci90` on arrays where the percentile index is integral or near-integral. Among them is 21 distinct sorted draws, where a literal 5 and 4.999999999999999 pick different draws. The copy is taken before the refactor and is not derived from the new function.
- **No new validation in the 90% path (DR-04).** `interval_bounds` is exactly today's two percentile lines: no check, no raise, no clamp. So `judge_exclusion` behaves as now on every input it accepts today, including an overflow to infinity. For example, five moves of 1e308 resample to a median of inf, and today that returns `[inf, inf]`.
- **The optional projections handle the out-of-domain case themselves.** The sink stores the 80 or 95 pair only when both bounds are finite. Otherwise the pair is null, and the page shows that level as unavailable for that horizon, with the reason "This range cannot be computed for this horizon." The 90% pair and the verdict are untouched.
- **Supported domain.** The engine's real inputs are log returns and basis-point changes, so deltas are finite and far from overflow. The non-finite branch exists only so that an extreme hand-built input cannot make the optional fields lie. Hardening the native arithmetic is out of scope.
- **Tests pin both sides:**
  - the 1e308 case returns today's `ci90` unchanged, with null 80 and 95 pairs;
  - a mixed array such as `[0, …, 95, inf, inf, inf, inf]` gives a finite 90% `[4, 95]` and 80% pair, and a null 95% pair, with the page showing 95 unavailable for that horizon only;
  - an empty `deltas` never reaches the sink, because `horizon_stats` returns before resampling when there are no events, no baseline or fewer than 5 blocks.

- **No extra random numbers are drawn.** The generator's state, and so every native number, is unchanged.
- **Nesting holds by construction.** These are percentiles of one array with outward rounding, so ci95 contains ci90, and ci90 contains ci80. A test pins this on every horizon of every fixture study.
- **The null rule is the same as `ci90`.** If the horizon has no interval (`n_blocks` < MIN_BLOCKS_INTERVAL = 5, no events, or no baseline), ci80 and ci95 are null and the row's `reason` explains why, as now.

## 3. Where the numbers travel: a side channel, never the native dict

The native `run`/`run_on` dict must stay byte-identical. This is the three-layer regression gate (layers 1–3) and the golden.

- `horizon_stats` takes an optional keyword `sink: dict | None = None`. When one is given, it stores `sink[h] = {"80": pair, "95": pair}` computed from `deltas`, where each pair is `(lo, hi)` when both bounds are finite and `None` otherwise (DR-05). `sink[h]` is `None` when the horizon has no interval at all. The returned dict is unchanged.
- `_run` passes a sink only on the traced paths: `run_on_traced`, `run_traced` and `run_on_supplied_traced`.
- `EventTable` gains one field, `intervals: Mapping[int, Mapping[str, tuple[float, float] | None] | None]`: each level's pair is independently nullable, defaulting to an empty mapping. It is frozen like its other fields. The untraced `run`/`run_on` never build it.
- Layer 1 (traced equals untraced) still compares the dicts. A new test asserts that the traced dict equals the untraced dict with and without the sink. `table.intervals` stores only the 80 and 95 pairs, never a 90 pair: 90 is always read from `ci90`, so one value cannot drift from the other.

## 4. Served fields: the contract change (after P1b releases the files)

These fields are added to §12.2 `horizons[]`. That is the Event Study answer, the worker presets and on-request studies, all through `api/desk_v2.horizon_row`:

| Field | Type | Rule |
|---|---|---|
| `ci80_lo`, `ci80_hi` | number, nullable | Δ bounds at 80% of the same draws, in the target's native unit (log return or bp), as `ci_lo`/`ci_hi`. Null when `ci_lo` is null, **or** when either projected 80% bound is non-finite (DR-05). The two bounds are null together. |
| `ci95_lo`, `ci95_hi` | number, nullable | The same at 95%, nullable independently of 80%. |

- The API serves all four on every row. The contract (tests/desk_contract.py) accepts a row with none of the four, the shape of an answer from a generation before the deploy and of the client's fixtures, but never only some, and checks the null rule whenever they are served. schema.ts reads them as statistics: an absent field stays absent, a non-finite one becomes null. An older stored answer from a generation before the deploy lacks them.
  - The page treats a missing field as "this level is not served for this answer".
  - The switch shows 80 and 95 as unavailable, with the reason "This answer predates the 80% and 95% ranges; they are served once the API is updated and has recomputed this study." 90 stays usable.
  - The boundary accepts the older shape, so there is no broken page between the deploy and the next worker generation.
- §12.19 (`/basket/study`) carries `horizons[]` built by the same `horizon_row`, so it serves the four fields too. The basket card does not draw them in this PR.
- `tests/desk_contract.py`, §12.2/§12.19, schema.ts and types.ts change together, in one commit, after P1b merges.

## 5. Web

- `event-study/StudyRail.tsx`: the range head keeps its words and names the level drawn ("Edge vs a normal period · 95% range"); the switch sits under it (DR-07). It is a `<fieldset>` whose `<legend>` reads "Range shown", holding three **native** `<input type="radio" name="es-ci">` with visible `<label>`s 80%, 90% and 95%. The browser gives it radio semantics, a single tab stop, arrow-key selection and the checked state. It is styled with existing tokens and has a focus ring.
  - An unavailable level (the old-answer fallback) stays checked when requested. It is marked `aria-describedby` to the fallback line, rather than disabled, so a keyboard user can still hear it and move off it.
  - Each range row reads the effective level's pair.
- `event-study/AnswerCard.tsx`: `Bars` takes the selected pair for its whiskers. The chart's accessible description names the level ("…with its 80% range…").
- `units.ts`: the existing `whisker`/`rangeText` helpers take any (lo, hi). No change of unit handling.
- All copy goes through the Desk language list. No new color: the switch uses the existing segmented-control tokens (§1.3).

## 6. Edge cases (input domain)

- `n_blocks` < 5, no events, or no baseline: all four fields null, the row prints its `reason`. The switch stays usable; every level shows that reason.
- Exactly 5–7 blocks (exact enumeration, 5^5 = 3,125 to 7^7 = 823,543 draws): percentiles are read with the "lower"/"higher" methods, so the bounds are drawn values. At 95% a tail of 2.5% is at least 78 draws.
- Monte Carlo (10,000 draws): a 2.5% tail is 250 draws.
- `n_boot` other than 10,000, which the traced entry points accept: the same expression and the same nesting. The oracle includes `n_boot` = 21.
- Ties in `deltas`, including the many repeated medians with few blocks: the bounds may coincide across levels (ci80 = ci90 is possible). This is allowed and stated in the tests. The bounds are never inverted.
- Basis-point targets: the same rule, bp display as now (Codex R-02's "never a percent" holds).
- The verdict at 90% stays independent of the shown level. A 95% range that includes zero beside a "Reliable" pill is possible and correct; the line in §1 says why.
- `ci=` values other than 80/95: read as 90 and the address is rewritten to drop the value.
- `?ci=95` with an answer that predates the fields: §1's requested/effective rule. A refreshed answer then draws 95; going back to an older answer draws 90 with the line again.

## 7. What stays out

- No change to the verdict rule, `CI_LEVEL`, `N_BOOT`, seeds, block rules or the adverse-share bar.
- No new resampling.
- No other endpoint. Client view, CSV and basket card are unchanged.
- No by-regime intervals: there are none today.

## 8. Tests and gates

- **Engine:**
  - `interval_bounds` at 90 equals `judge_exclusion`'s bounds on random and tied arrays;
  - nesting holds on every horizon of every saved fixture run;
  - the null rule matches `ci90`'s;
  - the generator's state after a traced run with the sink equals one without it;
  - layers 1–3 of the regression gate: byte-identical 16/16, the golden unchanged.
- **API:** `horizon_row` serves the four fields equal to the table's intervals. A pair is null whenever `ci_lo` is null, and may also be null alone when its bounds are non-finite. The contract gate states exactly that rule: the pair is null if `ci_lo` is null, else null or two finite numbers with lo ≤ hi. Contract tests for §12.2 and §12.19.
- **Web:**
  - the switch changes the ranges and the whiskers, not the verdicts or `why`;
  - the switch is a labelled radio group with one tab stop; arrow keys select, the checked state is exposed, and a requested-but-unavailable level stays reachable and described;
  - `?ci=95` survives a reload, a preset chip, a saved question, a slot change, and back/forward;
  - `ci` never reaches an API request;
  - older-to-newer and newer-to-older answer transitions under `?ci=95`, both directions;
  - mixed availability in one served answer under `?ci=95`: one horizon with a finite 95% pair, one with a null 95% pair and a finite 90%, and one with too few blocks. Each row shows its own pair or reason, no row shows a 90% pair, and the chart draws whiskers only where the 95% pair exists;
  - an answer without the fields disables 80/95 with the reason;
  - palette and banned-word audits, and the width checks at 1440/1101/390.
- **Fixtures.** The committed study fixtures (`study.json`, `study-horizons.json`, `studies/*.json`, `basket-study.json`) are not regenerated: they were made from the audit's store and a dated copy of the published database, and they keep the older-answer shape, which is exactly what the page reads between the front end's release and the API's first generation on the new code. The served 80%/95% numbers in the web tests are invented, nested around the fixtures' 90% (test-data rule).

## 9. Deploy

This is API code, so it needs a manual Render deploy. Until the worker's next generation after the deploy, stored answers lack the fields, and §4's older-answer state covers that window.
