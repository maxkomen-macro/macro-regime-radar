# SPEC_AMENDMENTS_v4.md — delta to v2+v3, resolving B-01…B-13

Read with v2 and v3. Precedence: v4 > v3 > v2. Session A folds all three
into the spec in one pass. Wording below is adopted from the Codex review
where it gave exact replacements; nothing here reopens a resolved item.

---

## B-01 — Horizon of the verdict (v3 §7)

The `/study` top-level `verdict`, `headline`, `why`, counts and
`empty_state` use `selected_horizon`. Ledger and Client use h=20
explicitly. Every such summary carries its `horizon`; a verdict from
another horizon never accompanies the selected horizon's statistics. The
v3 sentence "the top-level verdict is the h=20 verdict" is withdrawn.

## B-02 — Ledger header (v3 §2)

The header is derived from the twelve returned Ledger rows: `scored_n`
counts rows with a completed study response (an `insufficient` verdict
counts as scored); `unavailable_n = 12 − scored_n`. Unavailable rows are
excluded from verdict and firing counts. "10 scored · 2 not yet served" is
an example, not fixed copy — with WTI or DXY absent in a generation, the
oil and dollar rows are also unavailable and the header says so.

## B-03 — One Ledger order (v2 §19 / v3 §2)

The Ledger displays the twelve rows in the exact order listed in v3 §2.
v2 §19's Ledger sorting instruction is deleted. Overview and Technicals
keep their separately specified orders.

## B-04 — Scope of the display rule (v3 §6 / §13)

The log-display rule applies only to fields whose `target_unit` is
`log_return` or `log_change`. Technicals `chg_1d`, `ret_1y`, `vs_ma50`,
`vs_ma200` are simple-return or level-ratio fractions per §13 and display
as fraction × 100.

## B-05 — Firing comparison anchor (v3 §3)

`comparison_session` is the last completed XNYS session at the server's
response calculation timestamp (`api/calendar.py` last-completed-session
rule). `prev_session` is its immediately preceding XNYS session. Both
states are evaluated in the same generation. `new_fires` requires
false→true; `still_firing` requires true→true. An unevaluable state is
`null`, never false, and excludes the signal from both lists. `firing_day`
is null whenever `firing_now` is false or null.

## B-06 — Desk data_status (v3 A-14 wording withdrawn)

Keep the Desk feed set (tier-1 inputs of the twelve Ledger studies plus
DGS2/DGS10), but derive each contributor's freshness from the existing
per-series calendar and publication policy in `api/freshness.py`. Map its
close/current → `current`, stale → `stale`, absent/unknown → `missing`.
Preserve the existing FRED tolerance and bond-market calendar. Return each
contributor's `observation_date`, `expected_publication_date`, `state`,
`reason`. `state` overall = worst contributor (missing > stale > current).
No series is compared directly with the latest XNYS session.

## B-07 — Readiness and coverage tests (v3 §2, §12)

A study is `ready` when the existing engine completes on the pinned
generation. Missing required inputs or no evaluable history → `awaiting`
with the reason. A completed run with zero retained events is `ready` with
an `insufficient` verdict. Short-history warnings alone never make a study
unavailable.

HY rank coverage: require a finite observation on every expected
bond-calendar session in the closed three-year window; weekends and bond
holidays are not missing. Serve `expected_n`, `valid_n`, `missing_n`, and
actual first/last observation dates. If `missing_n > 0`, `hy_pct_3y` and
`hy_range_3y` are null with `reason` naming the gap.

## B-08 — Wire contract details (v3 §18/§21)

**`/study/catalog`** is added to §21. Outer envelope; `data.studies[]`,
each row: `slug`, `label`, `short`, `available`, `unavailable`
(`null` when available, else `{reason, until|null}`), `question` (the five
non-horizon slots; `null` for deferred RSI definitions),
`allowed_horizons` (subset of [5,10,20,60]).

**Nested envelopes occur only at these paths:** Overview
`since_last_close`, each named `tiles` child, `data_status`; Regime
`current`, `recession`, `next_prints`, `stats`, `changes`; Macro `curve`,
`credit`, `stock_bond`, `correlations`, `matrix`; Technicals `vol`,
`sectors`. Every other object and array is an ordinary payload field. A
ready nested envelope's `data` may be the declared object or array.

**CSV** (`/study/events`, `Accept: text/csv`): columns in order
`event_date,entry_date,regime,exit_5,value_5,complete_5,exit_10,value_10,complete_10,exit_20,value_20,complete_20,exit_60,value_60,complete_60`.
Rows newest event first; values in native study units; nulls are empty
cells; booleans `true`/`false`; UTF-8 `text/csv`. DDL is UTF-8
`text/plain`.

**Field table.** The fold produces the per-field `required | optional |
nullable` table for every §21 endpoint. This is a deliverable of the fold,
checked by the next Codex pass; v4 does not stand in for it.

## B-09 — Hash identity (v2 §8, v3 §18)

`inputs_hash` is the engine's unchanged native provenance hash. The native
calculation cache keys on the canonical engine query and generation, and
is shared across selected horizons. The adapter response cache
additionally includes `selected_horizon`, `verdict_rule` version and
`adapter_schema` version. An adapter cache key is never served as
`inputs_hash`.

## B-10 — Position activation (v3 §16)

Positive finite `original_room` is required only for automatic numeric
level monitoring. Unserved subjects (NDX/SPX, basket) and categorical or
custom falsifiers (`regime_changes`, free text) may be saved with
`monitoring: "manual"`, `original_room: null`, `room_pct: null`; they
remain visible and require explicit closure. Signed distance: for a
below-level falsifier `value − threshold`; for an above-level falsifier
`threshold − value`; same orientation at entry and now, threshold frozen
at entry. Storage-load validation applies the same rule (manual rows are
valid with null room).

## B-11 — without_condition (v3 §18/§21)

Monday serves the entire `without_condition` block as a nested awaiting
envelope with reason "conditional-versus-unconditional comparison is not
defined". No improvement classification or comparison prose is generated;
the Event Study's comparison line renders the unavailable state. A later
version must specify the companion query, horizon, sample matching,
baseline treatment, direction of improvement and decision rule before
enabling it.

## B-12 — Scope allowance additions (v3 §23)

Additionally allowed for Monday: the four Technicals return/ratio fields
defined in §13 (`chg_1d`, `ret_1y`, `vs_ma50`, `vs_ma200`, on exact XNYS
endpoints); curve snapshot alignment, month-ago selection and dated
yield/spread differences defined in §12; and these Overview comparisons:
`vol_change_pts` = VIX level difference between the two served comparison
sessions, null if either observation is missing; `regime_from` /
`regime_to` = the stored K−2 labels governing those same two sessions in
the same generation; `regime_changed` compares those labels and is null
if either is unavailable. These additions do not authorize any
conditional-improvement judgment.

## B-13 — Verdict definition copy (v2 §7 / v3 §7)

- **Reliable** — at least ten overlap blocks, with the engine's 90%
  interval and adverse-share requirements met; zero counts as adverse.
- **Suggestive** — 10+ completed outcomes; excess medians lean the same
  way at 5, 10 and 20 sessions, but not all Reliable criteria are met.
- **No edge** — at least ten completed outcomes at this horizon, without
  Reliable evidence or a consistent nonzero excess-median sign across 5,
  10 and 20 sessions.
- **Too few** — fewer than ten completed outcomes at this horizon.

The Overview and Ledger footers use exactly these four sentences.

---

## Fold checklist for session A (supersedes v2 §22 item 1)

Fold v2 + v3 + v4 into `docs/desk/DESK_FRAME3_SPEC.md` with precedence
v4 > v3 > v2, producing: §1 scope table (v2 §1 with v3 changes: RSI,
confidence and regime stats unavailable; without_condition unavailable);
§1.5 verdict copy (B-13); §2–§11 per v2/v3/v4; §12 rewritten as the
complete contract for the nine live endpoints (`/overview`, `/study`,
`/study/catalog`, `/study/events`, `/ledger`, `/regime`, `/technicals`,
`/macro`, `/pipeline`) with the per-field table (B-08) and the nested
envelope paths; §12.13 reduced to `status: deferred` shapes for
positions, basket, hedge, vol, sectors, correlations, RSI, confidence;
§13 build order per v2 §23 + v3 + B-12. Delete every sentence the deltas
withdraw. Then the alignment items in v2 §22 (2–13).
