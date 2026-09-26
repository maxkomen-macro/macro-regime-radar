# SPEC_AMENDMENTS_v3.md — delta to v2, resolving A-01…A-18

Read with SPEC_AMENDMENTS_v2.md. Where v3 and v2 differ, v3 wins. Section
numbers refer to v2. Session A folds v2 + v3 into the spec in one pass;
session B builds from the folded spec only.

---

## §2 — Catalog vs Ledger (A-01, A-02, A-17)

**Catalog and Ledger are separate.** The catalog is every study the
adapter can name; the Ledger is a fixed list of twelve slugs.

Catalog (15 slugs). Add to v2's table:
| 2s10s-2sigma-steepening | curve_2s10s | 20 | up2s | none | spx | 20 |
| oil-2sigma-20d | wti | 20 | up2s | none | spx | 20 |
plus rsi-above-70 and rsi-below-30 as `available:false`.

Ledger (exactly, in canonical order): 2s10s-2sigma-steepening,
dollar-2sigma-20d, golden-cross, rsi-below-30, vix-spike-2sigma-5d,
gold-2sigma-spx-weak, hy-2sigma-20d, spx-20d-2sigma, death-cross,
rsi-above-70, oil-2sigma-20d, spx-5d-2sigma. The two RSI rows are served
with `available:false` and are excluded from "signals scored" and from
verdict counts (the stat reads "10 scored · 2 not yet served").

**Monday accepts only catalog studies.** A six-slot request must
normalize to one catalog definition; `horizon` then selects 5/10/20/60
from that study's results. Any other combination returns
`{"error":{"code":"unsupported","message":"…"}}` (422) — never a silent
parameter drop. Cross requests require shock=spx, target=spx, while=none,
window=null. `series[].ops` enum: `up2s | down2s | cross_above |
cross_below`; `series[].roles` enum: `shock | target | condition`.
Capability metadata (`/study/catalog`) enumerates the complete allowed
combinations; the UI disables everything else.

**Aliases.** Public slugs map in the new adapter; main's existing
canonical engine slugs and legacy URLs are retained unchanged. `slug_for`
is not modified.

**LIVE requires stored coverage.** A catalog preset is LIVE only when every
input's required coverage is stored in the current generation; otherwise
the study returns `status:"awaiting"` with `unavailable.reason` naming the
series (WTI and DXY are tier 2 and are not refreshed by the tier-1 job —
oil-2sigma-20d, oil-2sigma-gold and dollar-2sigma-20d are LIVE only if C's
audit confirms coverage; else awaiting). Engine aliases, worker precompute
registration and middleware path/preset registration are updated together
in one commit.

---

## §6 — Display math (A-03)

Replace v2 §6's conversion. **Preserve main's `fmt_move`:** `log_return`
and `log_change` display as `100 × native`, labeled as log-return
percentages (the tooltip on any such number reads "log return, ×100");
`bp` displays unchanged. `vs_normal = 100 × (median − baseline_median)`
in log percentage points, or the native difference in bp. Interval
whiskers: add `ci_lo`/`ci_hi` to `baseline_median` in native units, then
apply the same linear scale. No exponentiation anywhere. Simple-return
display is a separate, later methodology decision.

---

## §7 — Verdict precedence (A-04)

`verdict_rule: "v1"`, evaluated in this order for horizon h:
1. `n(h) < 10` → `insufficient`
2. engine `exclusion(h) == "established"` → `reliable`
3. finite excess medians (median − baseline_median) at h = 5, 10 and 20
   all strictly positive, or all strictly negative → `suggestive`
4. otherwise → `no_edge`

"Not established" means any engine result other than `established`,
including `included` and an unavailable exclusion. Zero is not a lean; a
missing horizon delta is not a lean. Suggestive copy: "10+ completed
outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but
not all Reliable criteria are met." The top-level verdict is the h=20
verdict.

---

## §8 — Confidence and blocks (A-05, A-06)

**Verdicts are fixed at the engine's 90% exclusion.** Every response
carries `verdict_confidence: 0.90`. The v2 sentence "reliable cannot be
reached by lowering confidence" stands because the selector never touches
the verdict.

**Monday: the confidence selector is not served.** `/study` accepts no
`confidence` parameter; intervals are the engine's 90%; the UI's 80/90/95
chips render disabled with "not yet served". (Reason: interval projection
at other quantiles on identical seeded draws is new plumbing, A-16.)

Blocks: fewer than five blocks → `ci_lo`, `ci_hi`, `adverse_share`,
`method` null, `draws: 0`, `reason: "fewer than five independent blocks"`.
Five through seven → `method:"enumeration"` (engine "exact"), `draws` = Bᴮ.
Above seven → `method:"monte_carlo"`, `draws: 10000`.

**Full event table.** The permitted engine-output extension retains an
immutable full event table from the existing `_run` (event index, entry
index, exit index per horizon, native outcome per horizon, regime at
K−2). `matched_n`, per-horizon `n`, `up_n`, extrema, `first_event`,
`last_event`, `last_events[]` and the CSV are projections of that table.
Nothing is reconstructed from `recent_events` and no event-selection logic
is copied.

---

## §3 — Firing state (A-07)

Each Ledger signal carries `evaluated_on` (its own latest evaluable
session) and `compared: {"session","prev_session"}` (the two sessions its
state was compared on). Crosses: `firing_now` is true only on the strict
crossing session and `firing_day` is 1. Shocks: `firing_day` counts
consecutive qualifying XNYS sessions and resets after any false or
unevaluable session; a missing session is never bridged. Overview's
`since_last_close` uses one `comparison_session`; only signals with
`evaluated_on == comparison_session` may appear in `new_fires` /
`still_firing`; any other signal is `stale: true` and the UI never calls
it "firing today" (the Ledger's NOW column prints "○ Stale · <evaluated_on>").

---

## §10 — Sample dates (A-08)

`provenance.series_start[key]` = each input's actual first stored date.
`data_start = max(series_start.values())`, matching main. `sample_start`,
`sample_end` = the engine's evaluable boundaries. `first_event`,
`last_event` nullable (null when no retained event).

---

## §11 — Recession (A-09)

The score is for the latest valid `probability_month` produced by the
current generation, which may precede the current calendar month. Tile
sub-line: "score for <probability_month> · inputs through
<inputs_through>". `training: {"start","end"}` come from the aligned
training rows actually used — never a hard-coded 1970. `feature_months`
and `inputs_through` identify the observations used for that score, not
the newest inputs available. Bands: `low` < 0.20 ≤ `elevated` < 0.40 ≤
`high_risk`. `year_ago` = the score whose `probability_month` is twelve
months before; null if absent.

---

## §9.3 — Next prints (A-10)

`threshold_mom` is a fraction; display `× 100` as percent. For a rising
axis the flip condition is `<=` (equality classifies as falling); for a
falling axis the flip to rising is `>`. `flips_to` is derived from the
latest reference row's other-axis sign, not the K−2 current row.
`first_effective_month = reference_month + 2 months`. When the calendar
has no record, `release_date: null` and the UI prints "release date
unavailable" (absence in the calendar window is not proof nothing is
scheduled).

---

## §12 — Credit windows (A-11)

Two windows, both served with coverage: rank window `[hy_date − 3 calendar
years, hy_date]` → `hy_pct_3y`, `hy_range_3y`, `rank_window: {start,end,n}`;
line/peak window `[hy_date − 12 months, hy_date]` → `series[]`,
`peak_12m`, `line_window: {start,end,n}`. If three-year coverage is
incomplete, `hy_pct_3y` and `hy_range_3y` are null with
`reason: "coverage from <first date> only"` — never a shorter rank
relabeled. Peak ties → earliest date. `hy` and `ig` each carry `date` and
`freq`.

---

## §13 — MAs, trend, RSI (A-12)

MAs use the last 50 / 200 XNYS session **slots**, aligned as the engine
aligns, and are null if any required close is missing (no calendar
compression). `chg_1d` and `ret_1y` use exact indexed endpoints, both
dates served. `trend.state` ∈ `above_both | below_both | mixed |
unavailable`; equality is `mixed`; `state_since` = first session of the
current state.

**RSI is UNAVAILABLE Monday** (A-16): no implementation exists in
src/desk/ or api/; adding one is a new calculation outside scope. The RSI
card renders the unavailable state. When later added: RSI(14) Wilder,
initialized from 14 changes over 15 contiguous valid closes; no losses
with gains → 100; no gains with losses → 0; both zero → 50; any gap
invalidates until re-initialized.

---

## §18 / §21 — Envelope and shapes (A-13)

- The envelope applies only to the new JSON endpoints under `/api/desk/`
  listed in §21; existing endpoints keep their contracts.
- `text/csv` and `text/plain` responses are explicit exceptions; their
  headers are listed with the route.
- Errors: `error: {"code","message"}` everywhere (v2 §2's flat string is
  withdrawn).
- `awaiting` responses may carry `generation_id: null` and `as_of: null`
  before a generation exists.
- **Every block inside a composite response is a block envelope:**
  `{"status":"ready","data":{…}}` or
  `{"status":"awaiting","data":null,"unavailable":{"reason","until"}}`.
  The literal `unavailable` placeholders in v2 §21 are replaced by this
  shape.
- Restore to `/study`: `inputs_hash`, `served_from_cache`, `elapsed_ms`.
- `computing` (202) carries `Retry-After: 2`; the client polls the same
  URL.
- Deferred resources are registered as GET-only stubs returning the
  awaiting envelope; removed write operations return 405.
- Cross-response consistency: the UI shows one `generation_id` in the
  page footer; if two responses on a page disagree, the page badge reads
  "mixed generations · refreshing" and the client refetches once.
- Every listed field gets a `required | optional | nullable` marker and,
  for every dated block, `date`/`month`/`ts` + `freq` + `source`; every
  composite statistic carries `window: {start,end,n}`.
- Enums fixed here: `without_condition.comparison ∈ improves |
  no_improvement | insufficient`; `series[].ops`, `series[].roles` per
  §2; `chg_1d_dates: {"from","to"}`, `ret_1y_dates: {"from","to"}`.

A produces the concrete per-field table in the folded §12 (this file
states the rules; the fold states every field).

---

## §21 /overview — data_status (A-14)

`data_status` is computed from an explicit Desk feed set — the tier-1
inputs of the twelve Ledger studies plus DGS2/DGS10 — with function:
`state = worst over the set of (current | stale | missing)` where
`current` = observed on the latest XNYS session for its frequency, `stale`
= older, `missing` = absent; tie order missing > stale > current;
`contributing[]` lists each series with its date. It is not main's
`overall`. Any served categorical word (`band`, `words.*`, `trend.state`)
must name its formula in this contract or its existing implementation;
none is served on a version string alone.

---

## §16 — Positions (A-15)

Automated room only for a subject whose monitored quantity exactly matches
a served series: the S&P vs its `ma50` (from `/technicals`), 2s10s vs a bp
level (from `/macro`). The example "Long NDX vs SPX" and the basket have
`room_pct: null` with "series not served" until their own series exist;
their rows still show size, horizon and the gate text. Activation requires
`original_room > 0` (zero or negative → rejected with a sentence). The
frozen trigger value and its observation date are persisted. Unobserved
intervals (browser closed) create no automatic closure; closure is an
explicit stored event with type and time; pre-mortem adjudication is an
explicit stored yes/no. Gate and schema validation run on Save, on Import
and on storage load (invalid records are quarantined into an "unreadable"
list, never silently dropped). The browser gate is a workflow check, and
Build Notes says so.

---

## §1 / §23 — Scope allowance (A-16)

Two kinds of engine work, both allowed for B, explicitly:

**Projections of the existing run** (no change to sample or estimator):
full event table exposure; per-horizon counts, extrema, first/last event;
CSV; provenance dates; regime K−2 per event (already in the run).

**New calculations, explicitly allowed for Monday:** firing state per §3
(A-07 policy); MAs, trend state and chart series per §13; next-print
inverse thresholds per §9.3; rolling HY statistics per §12; recession
provenance extraction per §11; Desk `data_status` per A-14; the three FRED
tenor series.

**Not allowed for Monday (blocks are UNAVAILABLE):** RSI; confidence
80/95 plumbing; regime statistics table and change outcomes (v2 §9.4 is
withdrawn — that card is unavailable); anything in v2 §1's UNAVAILABLE
rows.

No implementation may broaden scope to satisfy an illustrative shape.

---

## §20 — Compute and registration (A-17)

`/study`, `/study/events`, `/study/catalog` and the preset precompute use
the existing bounded study concurrency, timeout and single-flight policy in
`api/security.py`; they are added to the middleware's study path list in
the same commit that adds the routes. Ordinary stored-read routes stay on
their own pool.

---

## Corrections (A-18)

1. v2 §14 sector relative return, for later activation:
   `log(P_ETF(t)/P_ETF(t−60)) − log(P_SPY(t)/P_SPY(t−60))`, adjusted
   closes; display and ±1% band convention to be specified at activation.
2. FRAME3_DATA_AUDIT.md is evidence only once it exists with verified
   source references (C is producing it); until then fixtures keep
   illustrative values marked as such.
3. Regression gate for B: for every existing query under identical inputs,
   the native event set, per-horizon outcomes, baselines and the engine's
   90% exclusion results are unchanged. Adapter schema, public aliases and
   v1 verdict labels are tested separately as new outputs. No native
   result or hash change is permitted on this branch; any that appears is
   a blocking finding.
