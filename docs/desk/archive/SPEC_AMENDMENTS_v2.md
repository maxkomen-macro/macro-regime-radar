# SPEC_AMENDMENTS_v2.md — resolution of the kind-D review (D-01…D-37)

Applies to `docs/desk/DESK_FRAME3_SPEC.md` at 7bb2a3e (with §12.13 PROPOSED
fields). This file is the authoritative delta. Session A folds it into the
spec; session B builds only from the spec after it is folded in. Where this
file and the spec disagree, this file wins until the fold is done.

Adjudicated 2026-09-24 by Max. Decisions recorded in §0.

---

## 0. Governing rule and decisions

**Rule.** The engine wins. §12 describes what `src/desk/event_study.py`,
`src/regime.py`, `src/analytics/recession.py` and `api/` compute today, plus
the counts, dates and units needed to display it honestly. Any field the
engine cannot produce by the Monday deadline is served as an explicit
**unavailable** state, never as an illustrative number, and Build Notes
lists it under "Designed, not yet served."

**Decisions.**
1. Verdicts: `reliable` = the engine's *established* (≥10 independent
   blocks, interval on the estimate's side of zero, adverse share < 0.03
   with zero counted adverse). `suggestive` = not established AND
   n_complete ≥ 10 AND the sign of (median − baseline) is the same at
   h=5, 10 and 20. `no_edge` = not established, n_complete ≥ 10, otherwise.
   `insufficient` = n_complete < 10 at the selected horizon. Versioned as
   `verdict_rule: "v1"` in every response that carries a verdict.
2. Baseline: no universal "+1.3%." Every study, horizon and Ledger row
   carries its own engine baseline. `vs_normal` = median − that baseline,
   in the target's display unit.
3. Recession: the logistic score is for the current month, not a forecast.
   Wording: "Logistic recession score for <probability_month>, inputs
   through <inputs_through>." Existing 20% / 40% bands. Score served as a
   0–1 fraction. Historical scores labeled in-sample.
4. Regime: the current Desk regime for session month K is the stored row
   stamped K−2; `print` is that row's `YYYY-MM`. The latest published row
   is `latest_print`, shown separately on Regime only, never used to
   classify.
5. Scope for Monday: Vol card, Treasury-price and HY-credit correlations,
   Sectors, server-side positions, and Basket & Hedge pricing are
   **unavailable** (§1). Position Monitor stores positions in the browser.
6. Units: every study carries `target_unit` and `display_unit`; yields and
   spreads display in bp, equity and commodity targets in percent.

---

## 1. Scope for Monday: live vs unavailable

| Tab / block | Monday state | Reason (D-ref) |
|---|---|---|
| Overview: since-last-close, regime tile, recession tile, trend tile, VIX level, active signals | LIVE | — |
| Overview: VIX "gap vs realized", vol band word | UNAVAILABLE | D-17 (realized-vol method unspecified) |
| Overview: Monitored rows | LIVE from browser store | D-21 |
| Technicals: price, MAs, cross, chart, signals (spx group), RSI number | LIVE (RSI per §13) | — |
| Technicals: vol column, sector bars | UNAVAILABLE | D-17, D-19 |
| Event Study | LIVE for the preset table in §2; other combinations 422 | D-01 |
| Regime: current, history strip, recession score, next prints | LIVE | — |
| Regime: stats table (spx/mo, VIX avg, stock–bond), last-five-changes outcomes | UNAVAILABLE until §9.4 definitions are implemented; B may implement if time allows, else unavailable | D-14 |
| Macro: curve (needs DGS3MO/DGS5/DGS30 registered — B adds these three FRED daily series, §12.6), HY/IG levels, HY 3-year percentile, HY 12-month line | LIVE if the three series are added; else 10y/2y/2s10s only | D-16 |
| Macro: stock–bond correlation, "what moves with the S&P", matrix | UNAVAILABLE | D-15 |
| Sectors | UNAVAILABLE | D-19 |
| Signal Ledger | LIVE for the 12 slugs the engine can run (§2); RSI rows UNAVAILABLE | D-01, D-18 |
| Position Monitor | LIVE, browser-stored; room/level for S&P and 2s10s positions computed from `/technicals` and `/macro` levels; DV01 null | D-21–D-24 |
| Basket & Hedge | UNAVAILABLE (page renders with its labels and the unavailable state; local basket editing may remain, pricing does not) | D-25–D-28 |
| Data Pipeline | LIVE, inventory derived from the registry | D-33 |
| Build Notes | LIVE (authored file) | — |
| Client view | LIVE for the Event Study's current study | — |

Unavailable state (UI): the card keeps its title, subtitle and stat labels;
the body prints one sentence from the response (`unavailable.reason`) and,
if present, `unavailable.until` ("needs stored SPY option snapshots";
"sector ETFs not ingested"). No numbers, no chart, no gauge. The Advanced
control is disabled with the same sentence. Badge reads `○ Not yet served`.

---

## 2. Study grammar and the canonical preset table (D-01)

The question grammar is exactly what the engine accepts today:

- `shock`: one of the engine's shock-capable series keys (served in
  `/study` → `series[]` with `roles`).
- `window`: 5 | 20 | 60. **10 is removed** from the UI slot.
- `move`: `up2s` | `down2s` | `cross_above` | `cross_below`. Crosses mean
  the S&P 50-day average crossing its 200-day average (strict), and are
  valid only with `shock = spx`. Crosses have no window and no cooldown.
- `while`: `none` | `spx_below_50` | `regime:<Goldilocks|Overheating|Stagflation|Recession Risk>`.
  **`spx_above_50` is removed.**
- `target`: one of the engine's target-capable series keys.
- `horizon`: 5 | 10 | 20 | 60.

Unsupported combinations return `422 {"error":"unsupported",
"reason":"…"}`. The UI disables slot options the served `series[].roles`
and `series[].ops` do not allow.

**Canonical preset table** (one row per slug; the engine's `slug_for` is
extended to map these exactly):

| slug | shock | window | move | while | target | horizon |
|---|---|---|---|---|---|---|
| gold-2sigma-spx-weak | gold | 20 | up2s | spx_below_50 | spx | 20 |
| golden-cross | spx | — | cross_above | none | spx | 20 |
| death-cross | spx | — | cross_below | none | spx | 20 |
| vix-spike-2sigma-5d | vix | 5 | up2s | none | spx | 20 |
| hy-2sigma-20d | hy_oas | 20 | up2s | none | spx | 20 |
| 10y-2sigma-20d | us10y | 20 | up2s | none | spx | 20 |
| dollar-2sigma-20d | dxy | 20 | down2s | none | spx | 20 |
| oil-2sigma-gold | wti | 20 | up2s | none | gold | 20 |
| spx-2sigma-10y | spx | 20 | down2s | none | us10y | 20 |
| spx-20d-2sigma | spx | 20 | up2s | none | spx | 20 |
| spx-5d-2sigma | spx | 5 | up2s | none | spx | 20 |
| rsi-above-70, rsi-below-30 | — | — | — | — | — | UNAVAILABLE (D-18) |

The Ledger serves these 12 slugs; the two RSI rows return
`available:false`. Every Ledger slug is a valid `/study?preset=`.

---

## 3. Entry, horizon, cooldown, firing (D-02, D-03)

**Entry.** Entry follows the engine's declared availability rules: entry at
the event session's close when the target fixing is at or after every
input's availability; otherwise the next session's close. Ambiguous target
fixings defer. Forward horizon h runs from entry close to the close h XNYS
sessions later. Baseline observations use the identical rule. Every event
carries `event_date`, `entry_date`, `exit_date` (per horizon). The UI
tooltip changes to: "Entry at the event close when every input is
available by then; otherwise the next close."

**Cooldown.** After every retained threshold hit at session t, sessions
t+1 … t+w are excluded, even if the condition later fails. Crosses have no
cooldown; `provenance.cooldown` is nullable.

**Firing state** (three distinct fields, all served):
- `last_fired`: the latest retained event date.
- `firing_now`: the raw trigger AND condition hold on the latest evaluable
  session (`evaluated_on`), regardless of cooldown.
- `firing_day`: consecutive qualifying XNYS sessions including today, else
  null.
- `since_last_close.new_fires`: slugs whose `firing_now` became true
  between `compared.prev_session` and `compared.session` (both served).
- `still_firing`: `firing_now` true on both sessions, with `firing_day`.

---

## 4. Baseline (D-04)

Every horizon carries `baseline_median`, `baseline_up_pct`, `baseline_n`
from the engine's evaluable baseline for that exact study and horizon
(conditions computable on baseline dates but not required to hold; same
entry and completeness rules; not cooldown-thinned). Every Ledger row
carries `baseline_median` for h=20. `vs_normal` = `median −
baseline_median` in the display unit. The Ledger footer reads: "vs normal
compares each study to its own baseline over its own sample." The
sentence "A normal month is +1.3%" is deleted everywhere.

---

## 5. Counts per horizon (D-05)

```
"matched_n": 19,
"horizons": [
  {"h":20, "label":"1 month",
   "n": 18, "up_n": 12, "n_incomplete": 1, "n_blocks": 14, "baseline_n": 6104,
   "up_pct": 0.667, "median": …, "baseline_median": …, "baseline_up_pct": …,
   "ci_lo": …, "ci_hi": …, "adverse_share": 0.09, "draws": 10000, "method": "monte_carlo",
   "verdict": "suggestive",
   "worst": {"value": …, "event_date": "…", "entry_date": "…"} | null,
   "best":  {…} | null }
]
```
Hit rate, median, extrema and interval at a horizon use exactly the same
`n` completed outcomes. The EVENTS stat shows `matched_n` with sub-line
"`n` complete at <horizon>". Ledger and Client use h=20. Headline counts
use the selected horizon. No denominator is ever taken from another
horizon.

---

## 6. Units and intervals (D-06)

`question.target_unit` ∈ `log_return` | `log_change` | `bp`.
`question.display_unit` ∈ `percent` | `bp`. The engine's numerical
definition is preserved in the JSON (no simple-return substitution). The
UI converts at render: `log_return` → `(e^x − 1) × 100` shown as %;
`log_change` likewise; `bp` shown as bp with no scaling.

Intervals: `ci_lo`, `ci_hi` describe Δ = event median − baseline median,
in the target's native unit. The chart draws the event bar with a whisker
from `baseline + ci_lo` to `baseline + ci_hi`. "Up" always means target
change > 0, including yields and spreads.

---

## 7. Verdicts (D-07)

Per decision 1. Every verdict-bearing response carries
`verdict_rule: "v1"`. The `insufficient` pill reads "Too few" (dashed
gray). Definitions text (§1.5, Overview footer, Ledger footer) becomes:

- **Reliable** — the edge survives resampling: 10+ independent episodes,
  the range stays on one side of zero, and fewer than 3% of resamples go
  the other way.
- **Suggestive** — 10+ episodes lean the same way out to a month, but the
  range still crosses zero. Don't size on it.
- **No edge** — 10+ episodes and no consistent lean. Shown so you know it
  was checked.
- **Too few** — under 10 completed episodes at this horizon.

---

## 8. Bootstrap, confidence, cache (D-08)

Resampling clusters transitively intersecting inclusive forward windows
and resamples whole blocks; all event observations stay in reported
counts. For B ≤ 7 blocks the engine enumerates Bᴮ draws; otherwise 10,000
draws with seed 20260921. Each horizon serves `method`
(`enumeration`|`monte_carlo`), `draws`, `n_blocks`, `adverse_share`.

`confidence` (0.80 | 0.90 | 0.95) changes only the interval quantiles on
identical draws; it never changes `adverse_share` or the 3% threshold, so
`reliable` cannot be reached by lowering confidence. `confidence_note` is
served.

Cache identity: `(generation_id, normalized_query, confidence,
engine_version, seed, resampling_policy)`. `inputs_hash` covers the same.
The Advanced panel requests the identical key, so main and Advanced always
show the same calculation; the frame-2 engine panel is retired.

---

## 9. Regime (D-09, D-10, D-13, D-14)

### 9.1 Current regime and prints
```
"current": {"label":"Overheating","print":"2026-07","latest_print":"2026-08",
            "growth":"rising","inflation":"rising","months_in":3,"since":"2026-05"}
```
`print` is the K−2 row governing the current session month; `months_in`
and `since` describe that row's consecutive stored-label run. Sidebar
reads "Overheating · Jul row". Regime page shows "Latest print: Aug"
separately. `history[]` is the last 60 stored monthly rows with
`{"month":"YYYY-MM","regime":…}`, plus `history_note`: "labels as stored;
revisions are not replayed."

### 9.2 By-regime breakdown
Regime statistics use completed h=20 outcomes and are `null` when n < 10.
The UI prints the count with "too few cases to say"; no median bar. All
regime assignments use the event month's K−2 row. `unlabeled_n` served
separately.

### 9.3 Next prints
```
"next_prints": {"cpi": {"release_date":"2026-10-14","reference_month":"2026-09",
   "series":"CPIAUCSL","threshold_mom": 0.0012, "operator":"<",
   "flips_to":"Goldilocks", "first_effective_month":"2026-11"}, "indpro": {…}}
```
Threshold: for latest observed month m, the three-month level-slope
boundary is x(m+1) = x(m−1), i.e. m/m threshold x(m−1)/x(m) − 1. Equality
is falling. `flips_to` assumes the other axis unchanged; null when not
evaluable. Release dates come from `DB.event_calendar`; a date not in the
calendar is served null (the UI prints "next release: not scheduled").
UI sentence: "a print <operator> <threshold>% m/m flips <axis> to
<direction> → <flips_to>, effective from the <first_effective_month>
label."

### 9.4 Stats table and changes (may be UNAVAILABLE Monday)
If implemented: `stats[].months` = eligible effective calendar months after
the two-month lag; `spx_mo` = median 20-session forward return entered on
the first XNYS session of each effective month (log_return, displayed %);
`up_pct` on the same; `vix_avg` = mean of daily VIX closes in those months;
`stock_bond_corr` UNAVAILABLE (D-15) — column omitted. `changes[]`:
effective month, from, to, and the h=20 outcome entered on the first XNYS
session of the effective month under §3 rules. Sample boundaries served.
Otherwise the card is unavailable with reason "regime statistics not yet
defined in the engine."

---

## 10. Samples and "since" (D-11)

Three served dates, never conflated: `data_start` (first stored
observation), `sample_start` (engine's first evaluable date after warm-up),
`first_event`. UI: "history from <data_start>" on provenance; "<n> events
since <sample_start year>" on stats. `sample_end` served. No 1990/2000
constants anywhere in the UI.

---

## 11. Recession (D-12)

```
"recession": {"score": 0.12, "probability_month":"2026-08", "inputs_through":"2026-05",
  "feature_months": {"…":"…"}, "band":"low", "band_edges":[0.20,0.40],
  "year_ago": {"score":0.09,"probability_month":"2025-08"},
  "peak": {"score":0.71,"probability_month":"2020-03","window":"since 2015"},
  "methodology":"in-sample fitted scores; training 1970–<end>"}
```
Tile: big `12%`, sub-line "Logistic recession score for Aug · inputs
through May". Regime card title "Recession score · logistic model, five
monthly inputs lagged three months". The phrases "over the next year" and
"one-in-eight" are deleted. "Peak last cycle" becomes "Peak since 2015".

---

## 12. Macro (D-15, D-16)

**Curve.** B registers DGS3MO, DGS5, DGS30 (FRED daily, tier 1) beside
DGS2 and DGS10. `curve.today.{3m,2y,5y,10y,30y}` with one `date` (all
tenors must share it; otherwise per-tenor dates and the UI labels the
mismatch). `month_ago` = the last observation on or before `date − 1
calendar month`, with its own `date`. `2s10s_bp` = DGS10 − DGS2 in bp on
`date`. Changes are dated differences.

**Credit.** `hy` and `ig` are percentage levels with their own `date`.
`hy_pct_3y` = count(values < current) / count(valid) over daily
BAMLH0A0HYM2 in the trailing three calendar years ending on the HY date,
current included in the denominator, ties not below; served as 0–1 with
`window: {"start","end","n"}`. Bands: Tight < 0.30 ≤ Normal < 0.70 ≤ Wide.
`peak_12m` is the in-window maximum with earliest-date tie rule.

**Correlations, stock–bond, matrix: UNAVAILABLE** with reason "Treasury
and credit price-return series not ingested." The card keeps its labels.
When later served, each asset declares `symbol`, `quantity`, `transform`;
Pearson over the same trailing 60 XNYS return dates, 60 complete pairs, no
forward fill.

---

## 13. Technicals (D-17, D-18)

**Vol column: UNAVAILABLE** with reason "needs stored SPY option snapshots
and a versioned skew method." `tiles.vol` on Overview serves `vix` and
`date` only; `gap_pts`, `realized_20d`, `band` are absent and the tile
sub-line is "VIX <level> · <date>".

**RSI.** RSI(14), Wilder smoothing, initialized with the simple 14-session
average, computed on XNYS-session closes; served as `rsi`, `rsi_date`,
`rsi_prev` (the prior session's value; the UI derives "rising/falling"
from the two served numbers only). Episodes and the two RSI studies are
UNAVAILABLE Monday (`rsi_last_above_70: null`); the card shows the gauge
and number only.

**Trend.** `trend.state_since` = start of the current above-both /
below-both state; `cross` = latest MA cross `{kind, date}` separately.
`ma50`/`ma200` = simple means of the last 50/200 complete XNYS closes;
`vs_ma50` = price/ma50 − 1. `chg_1d` = simple return on the last two
closes with `date`; `ret_1y` = simple return vs the close 252 sessions
earlier with both dates.

Signals card: explicit allowlist, in this order: golden-cross,
death-cross, spx-20d-2sigma, spx-5d-2sigma, (rsi rows omitted while
unavailable).

---

## 14. Sectors (D-19): UNAVAILABLE

Reason served: "sector ETFs, RSP and IWM not ingested." Registry lines for
the 13 instruments are recorded in FRAME3_DATA_AUDIT.md §5 for the
follow-up. When served: relative return = log(ETF/SPY) over 60 XNYS
sessions, adjusted closes; key green > +0.01, gray in [−0.01, +0.01], red
< −0.01; breadth comparison date served; missing history is "not
available", never "below".

---

## 15. Reads and judgments (D-20, D-32)

`reads.<card>` = `{"label": string|null, "text": string, "tone": "normal"|"warning", "rule": string|null}`.
Allowed labels: `Read`, `Read for the desk`, `Beta to NDX`, `Why index
options, not the names`, `Recommendation`. Every categorical word served
(`band`, `words.*`, `pattern`, `hedging`) carries the versioned rule name
that produced it or is absent. Prose replacements, applied in fixtures and
in the engine's copy: "longer-dated IV exceeds near-dated IV" (not "no
near-term event is priced in"); "correlation positive over this window"
(not "Treasuries stop hedging"); "spreads near their three-year low" (not
"the bond market sees no default cycle"); "the conditional sample differs"
served as `without_condition.comparison_note` only when the engine
computed it. No recommendation is inferred from a verdict, beta,
correlation or IV gap alone.

---

## 16. Positions (D-21–D-24): browser-stored

There is no server position store. `GET/POST /positions` are removed from
B's scope. Positions live in `localStorage` under a versioned key with
Export/Import JSON, exactly like saved questions and baskets. The gate is
enforced in the browser with the rule below, and the same rule is
published in the spec so a future server can enforce it identically:

- required: trimmed non-empty `instrument`, `variant`, `pre_mortem`, a
  `wrong_if` choice; `size_nav` null or finite in [0,1]; `horizon_days` ∈
  {5,10,20,60}.
- wording: case-insensitive ASCII-word-boundary match of will, always,
  never, proves, guaranteed in `variant` and `pre_mortem` only.
- subject: `{"kind":"study","question":{six slots}}` or
  `{"kind":"basket","legs":[…],"benchmark":…}` or
  `{"kind":"instrument","id":…}`; `signal_reverses` requires kind=study
  with the full question.
- persisted at entry: `entry_ts`, `entry_value`, `entry_date`,
  `trigger: {"series","operator","threshold","policy":"frozen"}`,
  `original_room` (signed), `evaluation: "close"`.
- `room_pct` = current signed distance / original distance; ≤ 0 when
  breached; null when the series is not served. `day` counts the entry
  session as 1 on XNYS. `dv01` null. `red_team` is authored by the user
  (a fourth gate field, optional). `closed_90d` derives from stored close
  events; `premortem_right` requires the user's explicit yes/no at close.

Live levels for the two example positions come from `/technicals`
(S&P vs 6,280 → served `ma50`) and `/macro` (2s10s vs +38 bp). The
basket position shows room null with "basket index not served."

---

## 17. Basket & Hedge (D-25–D-28): UNAVAILABLE

`/basket/*` and `/hedge` are removed from B's scope. The tab renders its
skeleton with the unavailable state and reason "basket pricing and option
structures not yet defined in the engine." Local basket editing (legs,
weights, save/export) may remain; every priced stat, the chart, and the
hedge column are unavailable. The §12.13 fields for basket/hedge are
marked `status: deferred` and keep their shapes; the following corrections
apply when they are built: hedge notional is a "selected budget," not
beta-neutral sizing (neutralize = 100 × beta / |net delta|); breakeven and
max loss are `option_breakeven_underlying_return`,
`option_max_loss_nav`, `hedged_book_max_loss_nav` with stated
denominators; contracts, strikes, expiry, quantity, quote timestamps and
signed Greeks are served; `expiration_date`, `current_dte`, `roll_date`
distinct.

---

## 18. Dates and the response envelope (D-29, D-31)

**Envelope** (every `/api/desk/*` route):
```
{"status":"ready"|"computing"|"awaiting"|"error",
 "generation_id":"…","as_of":"YYYY-MM-DD","engine_version":"…",
 "data": {…} | null, "unavailable": {"reason":"…","until":"…"|null} | null,
 "error": {"code":"…","message":"…"} | null}
```
HTTP: ready 200; computing 202; awaiting 200 with `data:null` and
`unavailable`; error 4xx/5xx. The client parses `data` only when
`status=="ready"`. Every field is declared required | optional | nullable;
missing statistics are null with a reason, never 0/NaN/Infinity. Full
precision in JSON; one shared display-rounding rule in the UI kit.

**Dates.** `as_of` describes the calculation and never dates an
observation. Every live block carries `date` (session `YYYY-MM-DD`),
`month` (`YYYY-MM`) or `ts` (RFC3339 with zone) beside its values, plus
`freq` ∈ daily | weekly | monthly and `source`. Composite statistics carry
`window: {"start","end","n"}`. Scheduled releases are `release_date`,
distinct from observations. The sidebar "S&P today" prints the served
`date`; `since_last_close.compared` = `{"session","prev_session"}`.

---

## 19. Ordering and labels (D-30)

One canonical `label` and `short` per slug, served in `/ledger` and reused
by every tab. Overview `active_signals` = deduplicated union of all
`firing_now` rows and the five latest non-null `last_fired` rows, ordered
firing first, then `last_fired` desc, then slug. Ledger: firing first, then
reliable / suggestive / no_edge / insufficient, then `last_fired` desc,
then slug. Technicals: the allowlist in §13. Positions: `room_pct` asc,
null last, then id. Fixtures are regenerated to these orders.

---

## 20. Pipeline, Advanced, PNG conflicts, layout, compute (D-33–D-37)

**Pipeline (D-33).** Inventory is generated from the registry and its
consumers; counts derived. Per series: provider, `freq`, first and last
stored observation, feeds. WTI is daily DCOILWTICO; USD/JPY is the
registry's instrument. The Snowflake block is titled "Proposed export
schema (not the current SQLite layout)." `last_refresh_utc` and
`validation` come from the published run artifact; absent → "unknown".

**Advanced (D-34).** An Advanced control is enabled only when its
endpoint exists in §12; otherwise disabled with "not yet served." No
counts or history ranges are promised in the footer text.

**PNG conflicts (D-35).** Spec/API numbers win. Positive bars extend
right, negative left. Client view uses the same study, generation and
h=20 counts as Event Study. Comparison captions use served comparison
dates ("was 10 on <date>", not "in July"). The five-year strip = last 60
monthly rows.

**Layout and colors (D-36).** PNG 12's two-column Client layout and PNG
02's two RSI context boxes are authoritative. Client toggle allowlist:
Overview, Technicals, Regime, Macro, Sectors, Event Study, Signal Ledger,
Build Notes; not Position Monitor, Data Pipeline, Basket & Hedge. Page
badges date only what they cover; separately dated blocks carry their own.
Regime colors are the single exception to §1.3: Goldilocks green,
Overheating amber, Stagflation red, Recession Risk gray. Chart colors: main
line blue, 50-day green, 200-day gray dashed, event bars blue, baseline
bars gray. Gate text reference "§8.3" → "§9".

**Compute budget (D-37).** `/study`, `/study/events` and presets share the
existing single-flight study queue and generation cache; export reuses
the computed study. No new public compute route is added; basket and hedge
routes do not exist Monday.

---

## 21. Revised §12 — the eight live endpoints

All wrapped in the §18 envelope; shapes below are `data`.

**12.1 `/overview`**: `since_last_close {compared, new_fires[], still_firing[], vol_change_pts?, regime_changed, regime_from, regime_to, refreshed_at_utc}`, `tiles {regime (§9.1 subset), recession (§11 subset), trend {above_50, above_200, state_since, cross{kind,date}, date}, vol {vix, date}}`, `active_signals[]` (Ledger rows, §19 order), `data_status {state, worst_series, date}`.

**12.2 `/study`**: §2 params + `confidence`; response per §3–§8, §10:
`slug, question{…,target_unit,display_unit}, matched_n, sample_start, sample_end, data_start, first_event, last_event, firing_now, firing_day, evaluated_on, verdict, verdict_rule, headline, why, horizons[] (§5), confidence, confidence_note, by_regime[] (§9.2), unlabeled_n, last_events[] {event_date, entry_date, regime, value_20}, without_condition {matched_n, n, up_pct, median, baseline_median, verdict, comparison, comparison_note} | null, provenance {entry_rule, cooldown|null, seed, engine_version, series_start{…}}, warnings[], series[] {key,label,roles[],ops[],unit}, client {headline, summary} | null, empty_state | null`.

**12.3 `/study/events`**: same params; `events[] {event_date, entry_date, regime, exit_5, value_5, …, exit_60, value_60, complete_5…complete_60}`; CSV on `Accept: text/csv`.

**12.4 `/ledger`**: `verdict_rule, signals[] {slug,label,short,group,available, last_fired, n, up_n, up_pct, median, baseline_median, vs_normal, unit, verdict, firing_now, firing_day, sample_start}`.

**12.5 `/regime`**: `current` (§9.1), `history[]`, `history_note`, `recession` (§11), `next_prints` (§9.3), `stats[]` and `changes[]` or `unavailable` (§9.4).

**12.6 `/macro`**: `curve` (§12), `credit` (§12), `stock_bond: unavailable`, `correlations: unavailable`, `matrix: unavailable`.

**12.7 `/technicals`**: §13 fields: `price, date, chg_1d, chg_1d_dates, ret_1y, ret_1y_dates, ma50, ma200, vs_ma50, vs_ma200, trend{state, state_since}, cross{kind,date}, move_20d_sigma, rsi, rsi_date, rsi_prev, series{6m,1y,3y}[] {date, close, ma50, ma200}, signals_allowlist[]`, `vol: unavailable`, `sectors: unavailable`.

**12.8 `/pipeline`**: §20; `/pipeline/ddl` text.

Removed from B's scope: `/sectors`, `/vol`, `/positions`, `/basket/*`,
`/hedge` (each route returns the envelope with `status:"awaiting"` and
`unavailable.reason` so the UI renders the unavailable state uniformly).

---

## 22. UI alignment checklist for session A (after its Codex round 2)

1. Fold this file into the spec: rewrite §1.5, §12, §12.13 per §0–§21;
   mark deferred fields `status: deferred`.
2. Envelope parsing (§18) at the data layer; `computing` → quiet busy;
   `awaiting` → unavailable state with served reason.
3. Units: `target_unit`/`display_unit` conversion at render only; bp for
   yields/spreads everywhere; interval whiskers per §6.
4. Counts: `matched_n` vs per-horizon `n`; "12 of 18" from the horizon.
5. Verdict labels and the four definitions (§7); `verdict_rule` shown in
   provenance.
6. Baseline: delete every "+1.3%" string; per-row `vs_normal`.
7. Regime print wording (§9.1); recession wording (§11).
8. Unavailable states for every block in §1's UNAVAILABLE rows, with the
   Advanced control disabled.
9. Slots: remove window 10 and `spx_above_50`; disable options by served
   `roles`/`ops`.
10. Positions: browser store per §16; remove POST; DV01 null; room from
    served levels.
11. Basket & Hedge: unavailable state; keep local leg editing only.
12. Ordering and labels per §19; regenerate fixtures to §21 shapes with
    the engine's real values from FRAME3_DATA_AUDIT.md where available.
13. Build Notes: add the "Live / Designed, not yet served" list from §1.

## 23. Build order for session B

1. Envelope + `unavailable` on every route (§18), including the five
   removed routes.
2. `/study` (§2–§8, §10) incl. presets precomputed and cached.
3. `/study/events` + CSV.
4. `/ledger`.
5. `/technicals` (price/MAs/cross/RSI number; vol and sectors unavailable).
6. `/regime` (§9.1, §9.2, §9.3, §11; §9.4 only if time).
7. `/macro` (register DGS3MO/DGS5/DGS30; curve + credit; the rest
   unavailable).
8. `/overview` composed from the above.
9. `/pipeline`.
Each with a fixture-shape test, the clean-store regression after every
commit (byte-identical study results, hashes and verdicts vs the merge
base except where §3/§8 changes are intentional and recorded), no new
series beyond the three FRED tenors.
