# FRAME3_API_PLAN.md: implementation plan for session B (desk/frame-3-api)

Branch `desk/frame-3-api-plan`, cut from `desk/frame-3` at `2e4be69` on 2026-09-25 and rebased
onto `desk/frame-3` at `42298cb` on 2026-09-26. The eight plan commits replayed cleanly. A plan
only: this file is the one change on the branch. No code, test, fixture or data file was edited,
and nothing was pushed.

## Inputs and conventions

**Read in full for this plan**

- `docs/desk/DESK_FRAME3_SPEC.md` at `42298cb`, the folded contract with its errata
  (`ef3a338`, `0d3996f`, `42298cb`). Cited as "spec §n". Every spec citation and every §1 field
  table was re-checked against it on 2026-09-26, section by section.
- `docs/desk/archive/SPEC_AMENDMENTS_v2.md`, `_v3.md` and `_v4.md`. Cited as "v2 §n", "v3 §n"
  and "v4 B-nn".
- `docs/desk/FRAME3_DATA_AUDIT.md` from `origin/desk/frame-3-docs` at `cd465f8`. Cited as
  "audit §n".
- **Hardening: `origin/desk/hardening` is not pushed.** `git ls-remote origin 'refs/heads/desk/*'`
  lists deploy-prep, event-study, frame, frame-2, frame-3-docs and integration only. Two sources
  were read instead, read-only:
  - the local branch `desk/hardening` at `cc721f0`, with its committed `docs/desk/HARDENING_REPORT.md`
    (379 lines);
  - the uncommitted work in the `macro-regime-radar-hardening` worktree, re-read for each Codex
    round. The counts below are from round 1. Round 4 read the staged `api/worker.py` of
    2026-09-26 for R-11. The staged index holds 23 files and 7,297 insertions; the staged report has
    sha256 `6b694c34553e35b7…`. Round 18 (V-51 to V-53) is staged.
  - Round 19 (V-54 and V-56) is still being written: there are unstaged edits to
    `src/analytics/recession.py`, `src/analytics/allocation.py`, `scripts/validate_db.py`, the
    report and three test files. The working report is 2,698 lines, sha256 `099eddb3fe9f1f7e…`.

  The 503 shape (§3) and the conflict list (§8) come from this uncommitted work. None of it is on
  any pushed branch, and it can still change.
- **The engine and API at this tree:**
  - the engine: `src/desk/event_study.py` and `src/desk/series.py`;
  - the API modules: `api/desk.py`, `api/main.py`, `api/worker.py`, `api/analytics_cache.py`,
    `api/recession_cache.py`, `api/db.py`, `api/freshness.py`, `api/calendar.py`,
    `api/security.py` and `api/bootstrap.py`;
  - the analytics and regime modules: `src/analytics/dbpath.py`, `src/regime.py`,
    `src/analytics/recession.py` and `src/analytics/credit.py`;
  - the store and its validation: `src/watermarks.py`, `src/market_data/desk_history.py`,
    `scripts/validate_db.py`, `.github/workflows/refresh-data.yml` and `intraday-refresh.yml`;
  - the frame-3 client's `web/src/screens/desk/data/envelope.ts` and `api.ts`.

**Citations.** Every `file:line` is at `42298cb`, this branch's base.
- `api/`, `src/`, `scripts/`, `tests/`, the workflows and the Dockerfile are unchanged from
  `2e4be69`, which is `main`'s `a57f9bf` plus one added file (`scripts/desk_format_fixture.py`).
  So every engine citation also holds at the commit hardening was cut from.
- The `web/` and `docs/desk/` citations were re-verified after the rebase.

**Data checks made for this plan.** They were run with `sqlite3 -readonly` on the audit's own copy
of the store in the `mrr-frame3-docs` worktree (sha256 `9a8b857968b8de22…`, the file the audit
names):

- the HY OAS dates against the weekdays of the three-year window (§1.11 N7, §6 S-12);
- the `event_calendar` event names: `CPI Release` exists, and there is no industrial-production
  event.

**Basis codes** are the spec's (§12.0): E existing function, P projection of the run's event
table, N new calculation §13.2 authorizes, A adapter shaping, S stored read. Where the spec's A
is a rule stated in words (the verdict, the bands, the templates, the orders), this plan numbers
it R1…R15 and gives its algorithm in §1.10. The new calculations are N1…N11 in §1.11.

---

## 0. The decisions this plan makes

1. **New modules; `api/desk.py` is not edited.** The new code lives in four modules:
   - `api/desk_catalog.py`: stdlib only; the catalog, the aliases, the Ledger order, the groups;
   - `api/desk_envelope.py`: the envelope, the blocks, the error map;
   - `api/desk_v2.py`: the router, thin handlers, the projections;
   - `api/desk_items.py`: the worker-item builders, with every heavy import lazy.

   Existing files are edited only where a registration lives:
   - `src/desk/event_study.py` (the trace, §2);
   - `src/desk/series.py` (the three tenors);
   - `api/freshness.py` (their mirror rows);
   - `api/analytics_cache.py` (ITEMS);
   - `api/security.py` (paths);
   - `api/main.py` (router, 405 scope);
   - `src/analytics/recession.py` (provenance extraction, N5);
   - `api/bootstrap.py`, `.github/workflows/refresh-data.yml` and `intraday-refresh.yml` (the
     published validation verdict, §6 S-01);
   - `api/calendar.py` and its lean copy `src/market_data/session.py` (the holiday tables,
     S-12);
   - `Dockerfile` (`ENGINE_VERSION`, S-21). The R-15 Build Notes lines are already on `desk/deploy-prep` and are not B's.

   One new static file ships as well: `api/static/snowflake_proposed.sql` (S-04).

   This keeps B off the functions hardening rewrites (§8).
2. **Every `/study`-family answer is a lookup.** The 13 query-backed catalog studies are worker
   items, rebuilt with every generation (`api/analytics_cache.ITEMS`). CLAUDE.md's rule is "add a
   worker item" rather than compute on the request path. The new routes never use the free-form
   single-flight queue (`api/desk.py:154–207`). That queue stays for `/api/desk/event-study`.
3. **The engine's public output does not change.** The full event table and the signal trace
   leave `_run` on a side channel. They are never keys of the dict `run()` returns: the
   `/api/desk/event-study` contract, the web fixtures' key check
   (`tests/test_event_study.py:770`) and every `inputs_hash` stay byte-identical (§2).
4. **Every `desk_series` read goes through `event_study.load_level`** (`event_study.py:310`),
   never raw SQL. The staged hardening makes `load_level` provenance-aware (§8). A raw read would
   bypass that filtering after the merge.
5. **The fields that depend on "now" are recomputed for every response and never memoized.**
   - `comparison_session` and `prev_session` (`api/calendar.py:56`, `:70`);
   - `stale`;
   - every firing field: `firing_now`, `firing_day`, `evaluated_on`, `new_fires` and
     `still_firing`, and what is read from them (the `active_signals` selection, the Ledger's
     firing rows);
   - `data_status` (`api/freshness.py`);
   - `vol_change_pts`;
   - `regime_from`, `regime_to` and `regime_changed`;
   - `next_prints.<k>.release_date` (`api/db.py:563`);
   - the K−2 selection. K is `comparison_session`'s month, so `print` and the label, growth,
     inflation, `months_in` and `since` read from that row move at a month boundary inside one
     generation.

   Everything that depends only on the generation is an item. The adapter's projection memo
   (§3) holds only that part.

---

## 1. Field sources, endpoint by endpoint

### 1.0 Shared pieces

**The envelope** (spec §12.0), on every JSON route of §12 and on the deferred stubs:

| Field | Source | Code | Cite |
|---|---|---|---|
| `status` | the error map (§3) | A | spec §12.0 |
| `generation_id` | `f"g{gen.id}-{sha256(repr(gen.key))[:10]}"` of the request's generation (`get_worker().generation()`); null only before a generation exists | A | `api/worker.py:112–115`, `:545–551` |
| `as_of` | the New York date of `gen.staged_at` (the calculation's date, never an observation's; after hardening, `gen.as_of`, the same value) | A | `api/worker.py:123`, `:411` |
| `engine_version` | the git commit sha of the running build (spec §12.0, folded S-21, ruled), read once at import from the environment: `ENGINE_VERSION`, else `RENDER_GIT_COMMIT`, else `"unknown"` (blank counts as absent). `ENGINE_VERSION` is injected at image build: `ARG ENGINE_VERSION=unknown` then `ENV ENGINE_VERSION=${ENGINE_VERSION}` in the Python stage, built with `--build-arg ENGINE_VERSION=$(git rev-parse HEAD)`. The build cannot compute the sha itself, because `.dockerignore` excludes `.git`. `RENDER_GIT_COMMIT` is the host's own commit variable, the fallback when the build argument was not passed, and B confirms on the host that the service receives it. An `ARG` default of `unknown` counts as absent, so the fallback applies. The adapter's own `ADAPTER_SCHEMA` constant stays separate: it keys the projection memo (v4 B-09) | A | `Dockerfile:21–24`; `.dockerignore:3` |
| `data`, `unavailable`, `error` | the handler, through the error map | A | spec §12.0 |

**One catalog-study item** per query-backed catalog slug: `desk_study:<slug>`, 13 of them (§4).
The builder branches on the exception class, and its value is one of three:

- on success: `{"ok": True, "native": <the unchanged run() dict>, "events": EventTable,
  "trace": SignalTrace, "pre1970": {input_key: N}}`. `pre1970` holds round 4's R-10 counts
  (§1.2, "The served warnings"), computed by the builder on the same connection, for inputs whose
  stored history starts before 1970; it is empty for every other study;
- on `except es.NotStored as exc` (`event_study.py:144–155`, raised by `not_stored`, `:327–339`):
  `{"ok": False, "kind": "not_stored", "reason": str(exc), "series": exc.series}`. `series` is
  read only here, because only `NotStored` carries it;
- on `except es.StudyError as exc` (`:140`, e.g. "no evaluable session", `:1009–1010`):
  `{"ok": False, "kind": "study_error", "reason": str(exc), "series": None}`.

Any other exception propagates and is stored as the item's error. Both refusals are values, so
they never hold a generation back (`api/worker.py:489–504` holds only on a stored error).
`EventTable` and `SignalTrace` are specified in §2.

**Engine names used below:**

- `H(h)` is the row of `native["horizons"]` with `h`, built by `horizon_stats`
  (`event_study.py:650–691`);
- `P` is `native["provenance"]` (`:1112–1175`);
- `S` is `native["study"]` (`:1097–1107`).

### 1.1 `GET /overview` (spec §12.1)

| Field | Source | Code | Cite |
|---|---|---|---|
| `since_last_close` | block, always ready once a generation exists | A | spec §12.0 |
| `.comparison_session` | `api/calendar.last_completed_session(now)` at the response's calculation time | N1 | `api/calendar.py:70–77` |
| `.prev_session` | `api/calendar.previous_trading_day(comparison_session)` | N1 | `api/calendar.py:56–60` |
| `.new_fires` | N1 over the available Ledger rows' traces: state(prev) false, state(comparison) true, `evaluated_on == comparison_session`; `{slug,label,short}` from the catalog | N1, R10 | §1.11 |
| `.still_firing` | N1: true → true, with `firing_day` | N1 | §1.11 |
| `.vol_change_pts` | VIX on the two sessions | N10 | §1.11 |
| `.regime_from`, `.regime_to`, `.regime_changed` | stored K−2 rows for the two sessions | N10 | §1.11 |
| `.refreshed_at_utc` | `source_watermarks` row `desk_series`, `advanced_at` (written by the Desk store's summary watermark) | S | `api/db.py:649–657`; `src/market_data/desk_history.py:56`, `:204`; `src/watermarks.py:41–82` |
| `tiles.regime` | block; when the K−2 row is not stored, awaiting with the spec's reason "Awaiting refresh: this could not be computed from the current data.", which the UI badges `○ Awaiting refresh` (spec §12.0, §1.7) | A | spec §12.0 |
| `.label` | the stored label of the K−2 row (`classify_regime`'s output as stored) | E | `api/db.py:386–404`; `src/regime.py:41–43` |
| `.print` | K−2 for the month of `comparison_session` | R8 | `event_study.py:359–364`, `:111` |
| `.growth`, `.inflation` | `"rising"` iff the stored `growth_trend` / `inflation_trend` > 0 (the classifier's own test) | E | `src/regime.py:43`; `api/db.py:188–191` |
| `.months_in`, `.since` | the run of equal stored labels ending at `print` | R9 | §1.10 |
| `.freq`, `.source` | `"monthly"`, `"regimes table (src/regime.py)"` | A | spec §12.1 |
| `tiles.recession` | block; awaiting with "Awaiting refresh: this could not be computed from the current data." when the recession model has no data | A | spec §12.0 |
| `.score`, `.probability_month`, `.inputs_through`, `.band`, `.band_edges`, `.freq`, `.source` | the same seven fields, with the same sources and codes, as `/regime` `recession.data` (§1.6): `score` E, `probability_month` and `inputs_through` N5, `band` and `band_edges` R4, `freq` and `source` A. The tile serves none of `feature_months`, `year_ago`, `peak`, `training` or `methodology` | as §1.6 | §1.6 |
| `tiles.trend` | block; awaiting with "Awaiting refresh: this could not be computed from the current data." when the technicals item failed | A | spec §12.0 |
| `.state`, `.above_50`, `.above_200`, `.state_since` | as `/technicals` | N2 | §1.11 |
| `.cross` | the later of the two `cross_positions` kinds | E | `event_study.py:532–554` |
| `.date` | the newest ^GSPC session | S | `event_study.py:310–324` |
| `.freq`, `.source` | `"daily"`, `"asset_prices ^GSPC"` | A | spec §12.1 |
| `tiles.vol` | block | A | — |
| `.vix`, `.date` | the newest stored VIXCLS observation and its date | E | `event_study.py:310`; `src/desk/series.py:124` |
| `.freq`, `.source` | `"daily"`, `"FRED VIXCLS (desk_series)"` | A | — |
| `active_signals` | selection and order over the `/ledger` rows | R6 | §1.10 |
| `data_status` | block | A | — |
| `.state` | the worst contributor: missing, then stale, then current | N9 | §1.11 |
| `.contributors[]` | one per series of the Desk feed set, the seven of N9 | N9 | §1.11 |
| `…contributors[].series` | the series id | A | spec §12.1 |
| `…contributors[].observation_date` | the series' newest stored observation: `db.freshness()["desk_series_latest"]` for the five FRED inputs, `load_level`'s newest row for ^GSPC and GC=F | S | `api/db.py:713–715`; `event_study.py:310–324` |
| `…contributors[].expected_observation_date` | `_daily_expected_and_lag`'s expected date for the FRED inputs; the `asset_prices` sla row's `expected` for the two prices | E | `api/freshness.py:83–88`, `:260–282` |
| `…contributors[].state` | the N9 mapping of each series' existing policy | N9 | §1.11 |
| `…contributors[].reason` | the policy's own reason sentence | E | `api/freshness.py:143–182`, `:260–282` |

### 1.2 `GET /study` (spec §12.2)

| Field | Source | Code | Cite |
|---|---|---|---|
| `slug` | the catalog slug the request normalizes to | R11 | §1.10 |
| `label`, `short` | the catalog row | A | spec §12.3 |
| `question.shock` | the catalog row's slot, mapped to the engine's `Query.shock` | A → E | spec §12.3; `event_study.py:161` |
| `question.move` | the catalog row's slot, mapped to `Query.sign` (up2s `+`, down2s `-`) or to `Query.kind` = `cross` with `Query.cross` (golden, death) | A → E | `event_study.py:160`, `:164`, `:169` |
| `question.while` | the catalog row's slot, mapped to `Query.cond`: `spx_below_50` → `spx_below_50dma`, `regime:<label>` → `regime` with `cond_value` | A → E | `event_study.py:127–133`, `:165–166` |
| `question.target` | `Query.target` | E | `event_study.py:168` |
| `question.window` | `Query.w` for a shock (`S.params.w`), null for a cross | E | `event_study.py:162`, `:1102` |
| `question.horizon`, `selected_horizon` | the request's `horizon` (default 20) | A | v4 B-01 |
| `question.target_unit` | `registry.get(target).unit` | E | `src/desk/series.py:80` |
| `question.display_unit` | `percent` for `log_return`/`log_change`, `bp` for `bp` | R12 | spec §1.9 |
| `matched_n` | `P.n_events` (and `len(EventTable)`, asserted equal) | E | `event_study.py:1120` |
| `data_start`, `sample_start`, `sample_end` | `P.data_start`, `P.sample_start`, `P.sample_end` | E | `event_study.py:1116–1118` |
| `first_event`, `last_event` | the oldest and newest `event_date` of the table; null with no event | P | §2 |
| `firing_now`, `firing_day`, `evaluated_on`, `comparison_session`, `stale` | this study's trace, recomputed for every response (§0.5) | N1 | §1.11 |
| `prev_session` | the XNYS session before `comparison_session` (`api/calendar.previous_trading_day`), recomputed for every response; the §12.2 row added by the S-10 ruling | N1 | `api/calendar.py:56–60`; spec §12.2, folded S-10 |
| `verdict`, `horizons[].verdict` | v1 at `selected_horizon` / at each h | R1 | §1.10 |
| `verdict_rule` | `"v1"` | A | spec §1.5 |
| `verdict_confidence` | `CI_LEVEL` (`P.ci`) | E | `event_study.py:107`, `:1144` |
| `headline`, `why` | templates | R2 | §1.10 |
| `horizons[].h` | `H.h` | E | `event_study.py:660` |
| `horizons[].label` | 5 → "1 week", 10 → "2 weeks", 20 → "1 month", 60 → "3 months" | A | spec §12.2 |
| `horizons[].n`, `.n_incomplete`, `.baseline_n` | `H.n`, `H.n_incomplete`, `H.baseline_n` | E | `event_study.py:659–660` |
| `horizons[].n_blocks` | `H.n_blocks` | E | `:668`, `:678` |
| `horizons[].up_n` | the finite outcomes > 0 at h in the table; 0 when `n == 0` (the §2 assertions) | P | §2 |
| `horizons[].up_pct` | `H.hit_rate` | E | `:668`, `:676` |
| `horizons[].median` | `H.median` | E | `:676` |
| `horizons[].baseline_median`, `.baseline_up_pct` | `H.baseline_median`, `H.baseline_hit_rate` | E | `:663–666` |
| `horizons[].ci_lo`, `.ci_hi` | `H.ci90[0]`, `H.ci90[1]`; null under five blocks | E | `:680`, `:685`; `judge_exclusion` `:694–726` |
| `horizons[].adverse_share` | `H.opposite_sign_share`; null under five blocks | E | `:685`, `:711–716` |
| `horizons[].draws` | `H.n_draws` (0 with no interval) | E | `:661`, `:685` |
| `horizons[].method` | `H.resampling`: `"exact"` → `"enumeration"`, `"monte_carlo"` kept, None → null | E | `:643`, `:647`, `:685` |
| `horizons[].reason` | `H.note` in the words spec §12.2 gives (folded S-07) | R13 | `:669`, `:680`, `:687`, `:690` |
| `horizons[].worst`, `.best` | min and max over the h-complete outcomes, earliest event on ties, with `event_date` and `entry_date`; null when `n == 0` | P | §2 |
| `by_regime[]` (4 rows) | `native["regimes"]` minus the Unlabeled row, cell `h == 20`: `n`, `hit_rate` → `up_pct`, `median`; `h: 20` | E | `event_study.py:734–763` (`:753`, `:758`, `:760`) |
| `unlabeled_n` | `P.n_unlabeled` | E | `event_study.py:1124` |
| `last_events[]` | the newest five table rows, newest first | P | §2 |
| `last_events[].event_date` | the row's event session | P | §2 |
| `last_events[].entry_date` | the row's entry session; null when the entry session is after the stored data | P | §2 |
| `last_events[].regime` | the row's K−2 label: a retained event always carries one; events whose K−2 month has no stored regimes row are counted in `unlabeled_n` and not listed | P | §2 |
| `last_events[].value_20` | the row's `value[20]`; null when incomplete | P | §2 |
| `without_condition` | awaiting block, reason "conditional-versus-unconditional comparison is not defined" | A | v4 B-11 |
| `provenance.entry_rule` | `P.entry_rule` | E | `event_study.py:1168–1171` |
| `provenance.cooldown` | `P.cooldown_sessions` (null for a cross) | E | `:1141` |
| `provenance.seed` | `P.seed` | E | `:1142` |
| `provenance.engine_version` | the same value as the envelope's `engine_version`: `ENGINE_VERSION`, else `RENDER_GIT_COMMIT`, else `"unknown"` | A | §1.0 |
| `provenance.series_start` | `{m.key: m.history_from for m in P.inputs}` (first stored date) | E | `:889`, `:1153` |
| `warnings` | `P.warnings`, with the one qualified entry of R-10 (below); the native payload is untouched | E, A | `:1080–1093`, `:1154` |
| `series[]` | the available registry series with any role, in registry order: `key`, `label`, `roles`, `unit` | E | `src/desk/series.py:110–149`, `:170–171` |
| `series[].ops` | the moves the catalog allows with that series as shock | R14 | §1.10 |
| `client` | `{horizon: 20, headline, summary}`; null when the h = 20 `n` is 0 | R2 | §1.10 |
| `client.headline` | the catalog row's `client_label` (§1.3), **never** `label` (round 5's R-12; spec §12.2 at `42298cb`: "never `label` (§11: no σ)") | A | §1.3 |
| `empty_state` | `{horizon, sentence, fixes}` iff `H(selected).n < 10` | R2, R15 | §1.10 |
| `inputs_hash` | `P.inputs_hash`, native | E | `event_study.py:903–919`, `:1151` |
| `served_from_cache` | true on a projection-memo hit (§3): the generation-dependent part of this answer came from the memo; the §0.5 fields were recomputed either way | A | v4 B-09 |
| `elapsed_ms` | the handler's wall time | A | spec §12.2 |

**The served warnings (round 4's R-10).** Every engine warning is served verbatim, except the one
the engine writes as `"calendar sessions without a value: " + ", ".join(f"{k} {v}") + "."`
(`event_study.py:1086–1088`, one count per input from `missing_sessions`, `:896`).

- **The qualifier.** When an input's stored history starts before 1970-01-01, the served copy
  appends, right after that input's count: `(includes N pre-1970 holidays the engine calendar
  treats as sessions)`.
- **N**, computed from `api/calendar` by the item builder (§1.0), counts the dates that meet all
  four conditions:
  - a holiday in `api/calendar.HOLIDAYS` before 1970;
  - inside the input's stored range;
  - a session of the study's own calendar (`trace.sessions`), which the engine treats as trading;
  - on which the input has no stored value, so the date is among the counted missing sessions.
- **The value on the audit's copy.** For DGS10 N is **67**, from a read-only query. 100 of the
  pre-1970 holidays fall inside DGS10's range, which starts 1962-01-02. 68 of those are engine
  sessions, and DGS10 has a value on one of them, 1969-02-21. The other 67 are counted.
- **How it is built.** The adapter rebuilds the entry from `P.inputs[].missing_sessions` in the
  engine's exact format, adds the qualifiers, and replaces that one entry in the served list. A
  test pins the unqualified rebuild byte-identical to the engine's string.
- **What stays untouched.** The native payload, `P.warnings` in it, and `inputs_hash` are never
  modified. The legacy `/api/desk/event-study` serves the engine's text as today.
- **In the catalog,** only the two studies that read `us10y` carry a qualifier. DGS2 and T10Y2Y
  start in 1976, and DX-Y.NYB in 1971.

**Null guards.** These follow the engine's own behaviour and must hold for a ready-but-insufficient
study, zero retained events included.

- **No completed outcome at h (`n == 0`).** `horizon_stats` serves no statistics
  (`event_study.py:667–670`), so the following are null: `up_pct`, `median`, `ci_lo`, `ci_hi`,
  `adverse_share`, `method`, `worst` and `best`. `draws` is 0, `n_blocks` is 0 and `up_n` is 0.
- **The baseline.** `baseline_n` is never smaller than `n`: every event is an evaluable session,
  and events and baseline take the same entry rule (`:1018`, `:1030–1043`). So `n > 0` always has
  baseline statistics.
- **Fewer than five blocks.** `ci_lo`, `ci_hi`, `adverse_share` and `method` are null and `draws`
  is 0 (`:679–681`).
- **No retained event.** `first_event` and `last_event` are null, `last_events` is empty and
  `matched_n` is 0. The verdict is `insufficient` and `empty_state` is set.
- **Other fields.**
  - `vs_normal` is null when `delta` is null.
  - A `by_regime` cell's `up_pct` and `median` are null below 10 (`:760`).
  - `client` is null when the h = 20 `n` is 0.
  - `empty_state` is non-null exactly when `n` at `selected_horizon` is below 10.

### 1.3 `GET /study/catalog` (spec §12.3)

| Field | Source | Code | Cite |
|---|---|---|---|
| `studies[]` (15) | `api/desk_catalog.CATALOG`, the §12.3 table verbatim, in its order | A | spec §12.3 |
| `.slug`, `.label`, `.short`, `.question` | the row; `question` null for the two RSI rows | A | spec §12.3 |
| `.client_label` | the row's Client-view title, in plain words with no σ; null for the two RSI rows (round 5's R-12). The 13 titles are below | A | spec §12.3 at `42298cb` |
| `.available` | the row's item `ok`; false for the RSI rows | A | v4 B-07 |
| `.unavailable` | the item's `reason` (the engine's `not_stored` / `StudyError` words), or the RSI sentence (spec §12.3, folded S-17) | E | `event_study.py:327–339`, `:1009–1010` |
| `.allowed_horizons` | `[5,10,20,60]` for a row with a question, `[]` for RSI (spec §12.3, folded S-16) | A | spec §12.3 |

**The 13 `client_label` titles** (round 5's R-12). They are copied exactly from the §12.3 catalog
table of `docs/desk/DESK_FRAME3_SPEC.md` on `desk/frame-3` at `42298cb`
(`docs/desk/DESK_FRAME3_SPEC.md:1009–1021` on this branch). `api/desk_catalog.CATALOG`
carries them verbatim, and a test reads that spec table and pins the two equal.

| slug | client_label |
|---|---|
| gold-2sigma-spx-weak | Gold jumps over a month while the S&P is weak |
| golden-cross | The S&P's 50-day average rises above its 200-day |
| death-cross | The S&P's 50-day average falls below its 200-day |
| vix-spike-2sigma-5d | Stock-market volatility jumps within a week |
| hy-2sigma-20d | High-yield credit spreads widen sharply over a month |
| 10y-2sigma-20d | The 10-year Treasury yield jumps over a month |
| dollar-2sigma-20d | The dollar falls sharply over a month |
| oil-2sigma-gold | Oil jumps over a month, and what gold does next |
| spx-2sigma-10y | The S&P falls sharply over a month, and what the 10-year yield does next |
| spx-20d-2sigma | The S&P rallies sharply over a month |
| spx-5d-2sigma | The S&P rallies sharply within a week |
| 2s10s-2sigma-steepening | The yield curve steepens sharply over a month |
| oil-2sigma-20d | Oil jumps over a month |
| rsi-above-70, rsi-below-30 | null |

### 1.4 `GET /study/events` (spec §12.4)

| Field | Source | Code | Cite |
|---|---|---|---|
| `slug` | as `/study` | R11 | — |
| `events[]` | every table row, newest first | P | §2 |
| `.event_date`, `.entry_date` | `sessions[event_idx]`, `sessions[entry_idx]` (null when there is no entry session: spec §12.2, §12.4, folded S-05) | P | `event_study.py:1030–1037` |
| `.regime` | the row's K−2 label | P | `event_study.py:1020` |
| `.exit_<h>`, `.value_<h>`, `.complete_<h>` | `sessions[exit_idx[h]]`, `value[h]` and `exit_idx[h] >= 0`; `exit_<h>` and `value_<h>` are null when the window is incomplete | P | `event_study.py:576–591`, `:1038` |

CSV: the §12.4 columns in order, rows newest first. A value is `repr(float)` (lossless, the JSON's
precision); a null is an empty cell; a boolean is `true`/`false`. The body is
`text/csv; charset=utf-8`. With `Accept: text/csv`, an awaiting, unsupported or error answer
still returns the JSON envelope with its status code.

### 1.5 `GET /ledger` (spec §12.5)

| Field | Source | Code | Cite |
|---|---|---|---|
| `verdict_rule`, `horizon` | `"v1"`, `20` | A | spec §12.5 |
| `comparison_session`, `prev_session` | as §1.1 | N1 | §1.11 |
| `scored_n`, `unavailable_n` | rows whose study completed; `12 − scored_n` | R7 | v4 B-02 |
| `signals[]` (12) | `LEDGER_ORDER`, the §8 order | R7 | v4 B-03 |
| `.slug`, `.label`, `.short`, `.group` | the catalog; `group` from the §12.5 list | A | spec §12.5 |
| `.available`, `.unavailable` | as §1.3 | A/E | — |
| `.horizon` | `20` | A | — |
| `.last_fired` | the table's `last_event` | P | §2 |
| `.sample_start` | `P.sample_start` | E | `event_study.py:1117` |
| `.n`, `.up_pct`, `.median`, `.baseline_median` | `H(20)` | E | `event_study.py:660–678` |
| `.up_n` | as `/study` | P | §2 |
| `.vs_normal` | R3 on `H(20).delta` | R3 | `event_study.py:678` |
| `.target_unit`, `.display_unit` | as `/study` (null when unavailable) | E, R12 | — |
| `.verdict` | v1 at 20 (null when unavailable) | R1 | — |
| `.firing_now`, `.firing_day`, `.evaluated_on`, `.stale` | the row's trace | N1 | §1.11 |

An unavailable row (RSI, WTI, DXY): every statistic and firing field is null, and `stale` is false
(spec §12.5, folded S-19).

### 1.6 `GET /regime` (spec §12.6)

| Field | Source | Code | Cite |
|---|---|---|---|
| `current` block | the regimes rows (item `desk_regime`); awaiting with "Awaiting refresh: this could not be computed from the current data." when the K−2 row is not stored | A | spec §12.0 |
| `.label` | the stored label of the K−2 row, with K the month of `comparison_session` | E | `api/db.py:386–404`; `src/regime.py:41–43` |
| `.print` | K−2 for the month of `comparison_session` | R8 | §1.10 |
| `.growth`, `.inflation` | the signs of that row's stored trends | E | `src/regime.py:43` |
| `.months_in`, `.since` | the run of equal labels in consecutive stored months ending at `print`; a missing month ends the run | R9 | §1.10 |
| `.freq`, `.source` | `"monthly"`, `"regimes table (src/regime.py)"` | A | spec §12.6 |
| `.latest_print` | the newest stored row's month | E | `api/db.py:386–404` |
| `history` | the last 60 stored rows `{month: date[:7], regime: label}`, ascending | E | `api/db.py:386–404` (`limit=60`) |
| `history_note`, `history_freq`, `history_source` | fixed strings | A | spec §12.6 |
| `recession` block | the generation's `recession` item plus N5; awaiting with "Awaiting refresh: this could not be computed from the current data." when `recession_prob` is None | A | `api/analytics_cache.py:103–109`; `api/recession_cache.py:49–52` |
| `.score` | `recession_prob / 100` | E | `src/analytics/recession.py:278` |
| `.probability_month`, `.inputs_through`, `.feature_months`, `.training` | N5 | N5 | §1.11 |
| `.band`, `.band_edges` | R4 | R4 | `src/analytics/recession.py:374–380` |
| `.year_ago` | the served `recession_prob_series` point `{date, value}` whose month is `probability_month − 12`, served as `{score: value / 100, probability_month: date[:7]}` (the series is in percent, 0–100); null when absent | E | `recession.py:358`; `api/recession_cache.py:24–29` |
| `.peak` | the maximum point of that series at or after 2015-01-01, earliest on ties, served as `{score: value / 100, probability_month: date[:7], window: "since 2015"}` | N5 | §1.11 |
| `.methodology`, `.freq`, `.source` | fixed strings | A | spec §12.6 |
| `next_prints` block, `.cpi`, `.indpro` | N6, one object per series | N6 | §1.11 |
| `.<k>.reference_month` | m + 1, with m the month of the latest stored regimes row | N6 | §1.11 |
| `.<k>.threshold_mom` | `x_prev / x(m) − 1`; null when the series already has a value for m + 1 | N6 | §1.11 |
| `.<k>.operator` | `<=` when the latest row's own axis is rising, `>` when it is falling | N6 | §1.11 |
| `.<k>.flips_to` | the regime with this axis flipped and the other held; null when not evaluable | N6 | §1.11 |
| `.<k>.first_effective_month` | `reference_month` + 2 months | N6 | §1.11 |
| `.<k>.release_date` | the first `event_calendar` row after now named `CPI Release` for cpi; null for indpro (no such event is stored) | E | `api/db.py:563–574` |
| `.<k>.series` | `"CPIAUCSL"`, `"INDPRO"` | A | `src/config.py:20–22` |
| `.<k>.freq`, `.source` | `"monthly"`, the FRED id | A | — |
| `stats`, `changes` | awaiting blocks, reason "regime statistics not yet defined in the engine." | A | v3 A-16 |

### 1.7 `GET /technicals` (spec §12.7)

| Field | Source | Code | Cite |
|---|---|---|---|
| `price`, `date` | the newest ^GSPC close and its session | E | `event_study.py:310–324` |
| `freq`, `source` | `"daily"`, `"asset_prices ^GSPC"` | A | — |
| `chg_1d`, `chg_1d_dates`, `ret_1y`, `ret_1y_dates` | N3 | N3 | §1.11 |
| `ma50`, `ma200`, `ma50_window`, `ma200_window`, `vs_ma50`, `vs_ma200`, `trend.state`, `trend.state_since`, `series.6m/.1y/.3y` | N2 | N2 | §1.11 |
| `cross` | as §1.1 | E | `event_study.py:532–554` |
| `move_20d_sigma`, `move_20d_date` | N4; both null when the spx-20d-2sigma study has no evaluable session | N4 | §1.11 |
| `signals_allowlist` | `["golden-cross","death-cross","spx-20d-2sigma","spx-5d-2sigma"]` | A | spec §12.7 |
| `vol`, `sectors` | awaiting blocks with the §12.7 reasons | A | spec §12.7 |

### 1.8 `GET /macro` (spec §12.8)

| Field | Source | Code | Cite |
|---|---|---|---|
| `curve` block | N8 over DGS3MO, DGS2, DGS5, DGS10, DGS30 read through `load_level` (an unstored tenor is null) | N8 | §1.11 |
| `.today`, `.today.dates`, `.month_ago`, `.2s10s_bp`, `.2s10s_chg_bp`, `.10y_chg_bp` | N8, including its no-common-date branch (round 6's R-18): `today.date` and `month_ago.date` null, per-tenor `dates`, every difference null. `today.dates` and `month_ago.dates` are served on every path, one entry per tenor (round 7's R-19, round 8's R-20, §6 S-30) | N8 | §1.11 |
| `.freq`, `.source` | `"daily"`, `"FRED"` | A | — |
| `credit` block | — | — | — |
| `.hy` | the newest BAMLH0A0HYM2 observation in `desk_series` `{value, date, "daily", "FRED BAMLH0A0HYM2"}` | E | `event_study.py:310`; `series.py:126` |
| `.ig` | `source_watermarks["fred:BAMLC0A0CM"]` `{last_value, last_obs}`. IG is stored only month-stamped in `raw_series`, and the watermark is the stored table that dates it (spec §12.8 as folded, S-22) | E | `api/db.py:649–657`; `src/fetch_data.py:41` |
| `.hy_pct_3y`, `.hy_range_3y`, `.rank_window`, `.reason`, `.series`, `.line_window`, `.peak_12m` | N7 | N7 | §1.11 |
| `.band` | R5 on `hy_pct_3y`; null exactly when `hy_pct_3y` is null (round 6's R-14) | R5 | spec §12.8 |
| `.band_edges` | the constant `[0.30, 0.70]`, served on every answer and **never null**, even when `hy_pct_3y` and `band` are (round 6's R-14) | A | spec §12.8 |
| `stock_bond`, `correlations`, `matrix` | awaiting blocks, "Treasury and credit price-return series not ingested." | A | spec §12.8 |

### 1.9 `GET /pipeline` and `/pipeline/ddl` (spec §12.9)

| Field | Source | Code | Cite |
|---|---|---|---|
| `last_refresh_utc` | `source_watermarks["desk_series"].checked_at` (the Desk store runs only in the full refresh), never the run artifact; null when that row is not stored | S | `api/db.py:649`; `desk_history.py:204`; `refresh-data.yml:137` |
| `validation` | today, **no source** the API can read (spec §12.9, folded S-01). After commit 10 it is **bootstrap state, read per request** (the published verdict, below). It is served only when the request's pinned `gen.key` equals the key bootstrap recorded right after its sha check; otherwise, or with nothing held, it is null (the UI's "unknown") | S | `refresh-data.yml:221`, `:238–250`, `:286–300`; `api/bootstrap.py:154–233` |
| `groups` | the registry and its consumers, as `/api/desk/pipeline/inventory` joins them, regrouped (the row set below) | E | `api/desk.py:430–463`; `src/desk/series.py:110` |
| `groups[].name` | `api/desk_catalog.PIPELINE_GROUPS`: Rates, Credit, Equities & vol, FX & commodities, Macro (monthly). The spec names no groups (§11 says only that "each group expands to a table", `DESK_FRAME3_SPEC.md:689–690`); the names are A's fixture's (`web/src/fixtures/desk/pipeline.json`) and audit §1's, so the fixture and the served groups agree | A | spec §12.9 |
| `groups[].status` | worst of its series (missing > stale > current) | A | spec §12.9 |
| `…series[]` | the row set in the next paragraph | E | `src/desk/series.py:110`; `api/freshness.py:44–64` |
| `.label`, `.id`, `.key` | registry `label`/`series_id`/`key`, or `SERIES_REGISTRY` label, id, `key: null` | E | `series.py:75–91`; `freshness.py:44–64` |
| `.provider` | **the registry row's own source declaration**, for every Desk series, stored or not, so an unstored row still has a non-null provider (round 6's R-15). The strings are the inventory's existing declarations: <ul><li>a `fred` series: `"FRED (Desk daily history)"`;</li><li>a `market` series: `"EODHD first, Yahoo disclosed fallback (Desk daily history)"` (`api/desk.py:436`);</li><li>every `asset_prices` symbol, ^GSPC, GC=F and ^RUT included: `SOURCE_BY_ID["asset_prices"]` (`api/desk.py:306`);</li><li>a `raw_series` FRED row: `SOURCE_BY_KIND["fred"]`, `"FRED"` (`api/desk.py:312`).</li></ul>The source declaration is the registry's `source` field (`src/desk/series.py:78`). The stored `desk_series.provider` column (which provider a row actually came from) is not used: it is absent for an unstored series | E | `api/desk.py:303–316`, `:436`; `src/desk/series.py:78` |
| `.freq` | `"daily"` for the Desk registry series; `SERIES_REGISTRY` cadence otherwise | E | `freshness.py:44–64` |
| `.first`, `.last` | the first and last stored observation; for a month-stamped daily FRED series, `last` is the watermark's `last_obs` (spec §12.9, folded S-03) | S | `event_study.py:310`; `api/db.py:649` |
| `.feeds` | a fixed table of the Desk tabs that read each series (spec §12.9, folded S-02) | A | — |
| `.status` | N9's mapping, per series | E | `freshness.py:91–121`, `:143–182`, `:260–282` |
| `.note` | registry `note` or null | E | `series.py:89` |
| `/pipeline/ddl` | the file `api/static/snowflake_proposed.sql`, served verbatim as `text/plain; charset=utf-8` (spec §12.9, folded S-04, ruled). Details below | S | `Dockerfile:36` |

**The row set.** It has two parts:

- the Desk registry series that are available and at tier 2 or below: the 12 now, 15 with the
  three tenors (`series.py:110–137`). A planned tier-2 series that is not stored is `missing`,
  with the engine's `not_stored` sentence as its `note`;
- the `raw_series` series a Desk panel reads:
  - INDPRO and CPIAUCSL (regime);
  - UNRATE, T10YIE and T5YIE, inputs of the recession model (`RECESSION_INPUTS`,
    `api/main.py:1483`);
  - USREC, the model's training target, read at `src/analytics/recession.py:133–152`;
  - BAMLC0A0CM (macro IG).

Every panel in Desk resolves to one of these rows. The relay, the intraday bars and the news are
no Desk panel's input and are left out.

**The published verdict** (spec §12.9, folded S-01: the operator's rulings on the full refresh and the intraday
runs, and Codex round 2's R-01, R-05 and R-07; built in §7 commit 10) has four parts. **Both
database writers publish it**, because both upload `macro_radar.db` to `data-latest`.

1. **Publishing: its own step, which never blocks the database.** In each workflow, a new step
   runs right after the database's publish step, under the same condition
   (`steps.validate.outputs.upload == 'true'`). It carries `timeout-minutes: 1` and
   `continue-on-error: true`, the pattern of the Vercel step (`refresh-data.yml:262–263`).
   - It writes the slim `publish/validation.json`, with exactly four fields:
     - `verdict`: the validator's `"pass"` or `"fail"`;
     - `mode`: the validator's mode;
     - `timestamp`: the validator report's `generated_at` (`scripts/validate_db.py:369`);
     - `db_sha256`: the sha256 of `data/macro_radar.db`, the file just uploaded.
   - It uploads that file with `--clobber` under the asset name `validation.json`. The full local
     report stays as it is: `refresh-data.yml` copies it into the `validated-db` artifact (`:291`),
     and nothing else reads it.
   - **The two writers.**
     - `refresh-data.yml`: after the publish step (`:238–250`, database upload `:246`); its
       validation runs at `:221`, in every mode except verify-only.
     - `intraday-refresh.yml`: after the publish step (`:81–90`, database upload `:89`); its
       validation already runs in the mode the workflow uses, `--mode intraday` (`:72`), so its
       `mode` field reads `"intraday"`.
   - **When the step fails** (a timeout, an upload error), the verdict is simply absent. The
     database is already published and the run's result does not change. There is no mode-switch
     fallback: the one-minute timeout bounds the step's cost.
2. **Bootstrap verifies it and holds it (R-01, R-05).** The verdict is bootstrap state, in memory:
   no generation item, no sidecar file.
   - **After a download.** In `api/bootstrap.refresh_db` (`:154–233`), after the download and
     `_validate_sqlite(tmp)` (`:218`), bootstrap reads the `validation.json` asset from the same
     release listing (`:179`) and checks its `db_sha256` against the sha256 of `tmp`.
   - **The verdict binds only with no WAL (round 3's R-01).** Before it records anything, at a
     download and at every poll alike, bootstrap checks that `<DB_PATH>-wal` is absent or empty.
     - A non-empty WAL holds commits the sha check never saw. A commit in WAL mode leaves the main
       file's bytes unchanged, so its sha still matches.
     - With a non-empty WAL, bootstrap records nothing, and `validation` stays null until the
       next upload is verified.
     - `dbpath.file_key` counts a WAL only when it holds frames (`src/analytics/dbpath.py:67–72`),
       so an empty WAL changes neither the key nor this rule.
   - **The binding brackets the hash (round 4's R-01).** One procedure binds a verdict, run on
     the file whose bytes are hashed: `tmp` after a download, `DB_PATH` on a poll.
     1. Read `k1 = dbpath.file_key(file)`.
     2. Require `<file>-wal` to be absent or empty. At a download, also require `<DB_PATH>-wal` to
        be absent or empty, the round-3 rule, since that is the WAL the swapped file will sit
        beside.
     3. Hash the file and compare with `validation.json`'s `db_sha256`.
     4. Read `k2 = dbpath.file_key(file)`, and check that the WAL (or WALs) of step 2 are still
        absent or empty.
     5. Bind only when the sha matches, `k1 == k2` and the WAL is still empty. Bind **exactly
        `k1`**, with no further sample of the key.

     Bootstrap then holds `(verdict, mode, timestamp, validated_key = k1)` and the `db_sha256` it
     verified, for the poll check below. When any step fails, it holds nothing.
     - At a download, `tmp` is bootstrap's own file, so `k1 == k2` there. `os.replace` (`:219`)
       keeps the inode, the mtime and the size, so `k1` is the key the swapped file carries and
       the key the next generation is staged under.
     - Any commit after step 4 moves the file's key: WAL frames count once they exist
       (`src/analytics/dbpath.py:67–72`), and a checkpoint changes the main file's mtime and size.
       The key gate (part 3) then refuses the bound verdict.
   - **Every poll re-fetches when needed.** The poll runs at startup (`api/main.py:123`) and every
     `BOOTSTRAP_DB_REFRESH_MIN` minutes (`api/bootstrap.py:259–271`, `api/main.py:136–138`;
     production sets 10, `deploy/api.env.example:59`, `docs/redesign/DEPLOY.md:179`). Even when
     the database's identity is unchanged (`:196–200`), it re-fetches `validation.json` if the held
     verdict is null, or if the held `db_sha256` differs from the current database asset's sha.
     That sha is the listing's `digest` (`sha256:<hex>`), already part of the asset identity
     (`:131`); where the listing gives none, bootstrap uses the sha of the file on disk.
     - **The check on a poll** runs the bracketed procedure above on `DB_PATH`.
     - **What this recovers.** A validation upload that failed or arrived late, and a server
       restart (which starts with nothing held), both recover on the next poll with no database
       download.
3. **Reading: per request, gated on the key (R-01).** `/pipeline` reads the held state when the
   request is handled. It serves `verdict` only when the request's pinned `gen.key` (the worker's
   `generation()`, `api/worker.py:545–551`) equals `validated_key`. Otherwise it serves null (the
   UI prints "unknown"): nothing held, a different generation, or a changed file.
   - **What the gate relies on: the worker's key stability, a hardening guarantee (round 4's
     R-11).** The gate trusts that a generation's `key` is the key of the bytes it copied.
     - **Today's gap.** The worker reads the file key in `_maybe_build` and copies the file
       afterwards in `_stage`. This tree has the same order (`api/worker.py:373–389`,
       `:391–411`). Only a rebuild re-reads the key after its copy and drops a copy taken across a
       change: hardening's V-03 check in its `_build`.
     - **The interleaving.** Bootstrap binds `k1`, the worker reads `k1`, a commit lands, then the
       worker copies. That would publish the committed bytes under `k1`, and the gate would serve
       the verdict for them.
     - **The fix.** Hardening is extending the same check to every build (the operator's note):
       after the copy, the worker re-reads `dbpath.file_key` and publishes only when the key did
       not move. Otherwise it drops the copy, and the next poll stages the new file under its own
       key.
     - **Dependencies.** B's key gate depends on that guarantee landing with hardening. §5 tests
       the interleaving, and §8 lists the dependency.
4. **Local commits drop it (R-01).** Any commit to the served file outside an upload moves its
   file key, either through the WAL's frames or through the main file's mtime and size
   (`src/analytics/dbpath.py:59–72`). Examples: an operator's repair, an `ai_spend_ledger` write,
   a price row.
   - The key gate then serves null.
   - A later poll cannot bind the old verdict to the changed file, because the WAL check refuses
     it while the commit sits in the WAL, and the sha check refuses it once a checkpoint has moved
     the commit into the main file.
   - So the verdict reads "unknown" from that commit until the next upload is verified.

The served verdict is therefore always the one published with the served file:
- an intraday run's, during the session;
- a news-only run's, after an hourly news upload (`refresh-data.yml:17`);
- a full run's, after the 11:17 and 00:23 UTC runs (`:15–16`).

`mode` says which. The Data Pipeline header prints `verdict` only.

**The proposed DDL** (spec §12.9, folded S-04, ruled; R-02).

- **The source is one file:** `api/static/snowflake_proposed.sql`.
  - Its content starts as the text A's fixture now holds (`web/src/fixtures/desk/pipeline-ddl.ts`,
    the RAW → CUR → MART schemas). It is moved, not rewritten.
  - A first line labels it: `-- PROPOSED Snowflake export schema (not the current SQLite layout);
    nothing in this project creates it.`
  - Every change to the DDL is an edit to this file.
- **In the image, with no new COPY.** The existing `COPY api/ api/` (`Dockerfile:36`) carries
  `api/static/`, and `.dockerignore` has no rule that would exclude a `.sql` file under `api/`.
- **The route** reads the file once. It is static, not database-derived, so this is no cache of
  stored data. It answers `text/plain; charset=utf-8` under the stored-read ceiling, like any GET.
- **For session A.** A's `web/src/fixtures/desk/pipeline-ddl.ts` is **generated** from the file
  by a new `web/scripts/gen-ddl-fixture.mjs`. The script writes the `PIPELINE_DDL` template
  literal, escaping backticks, `${` and backslashes.
  - A test asserts that the TS export equals the file byte for byte. A's vitest can read the file
    with `fs`, which is a read, not an import.
  - **No file under `web/` imports a `.sql` file,** and `web/vite.config.ts` is unchanged by the DDL work (its one change since `2e4be69` serves Build Notes figures).
  - B's side of the pin is a pytest that scans `web/src` and `web/scripts` for an `import` or
    dynamic `import(…)` of a `.sql` path. Today there are only download file names:
    `PipelinePage.tsx:179`, `PipelinePage.test.tsx:138`, `download.test.ts:23`.
  - The fixture stays out of the app (`web/src/fixtures/desk/index.ts`), so the image's web stage,
    which copies only `web/` (`Dockerfile:15`), still never needs the file.
- **B's tests:** the body equals the file byte for byte, its first line carries "PROPOSED", and
  the content type is `text/plain; charset=utf-8`.

### 1.10 Rules the spec states (A), with their algorithms

- **R1, verdict v1** (spec §1.5, v3 §7, v4 B-01). At horizon h, read `H(h)`:
  1. `n < 10` → `insufficient`;
  2. `exclusion == "established"` (`event_study.py:689`) → `reliable`;
  3. `delta` (`:678`) at 5, 10 and 20 all finite and all > 0, or all < 0 → `suggestive`;
  4. otherwise → `no_edge`.

  `None`, `"included"` and `"not established"` all count as not established. A delta of zero, or
  a missing one, is not a lean.
- **R2, templates** (spec §12.2). `headline`, `why`, `empty_state.sentence` and `client.summary`
  use the §12.2 strings exactly. `client.headline` is the catalog row's `client_label`, never
  `label` (round 5's R-12, §1.3).
  - Numbers are printed by the engine's `fmt_move` (`event_study.py:768–773`). `adverse_share`
    is printed as a percent with one decimal (spec §12.2, folded S-08).
  - The adapter then replaces a number's leading hyphen with U+2212 (−), so a negative reads
    "−1.6%". The page prints the served string as is (spec §12.2 templates at `42298cb`).
  - `<L>` is the horizon label. The year is `sample_start[:4]`.
  - The target label is `registry.get(target).label`.
  - `why` without an interval uses R13's words.
- **R3, `vs_normal`** (spec §1.9, v3 §6): `100 × delta` for `log_return` and `log_change`, and
  `delta` for `bp`.
- **R4, recession band** (v3 §11). `low` below 0.20; `elevated` from 0.20 up to but not including
  0.40; `high_risk` from 0.40. These are `_classify_prob`'s own edges (`recession.py:374–380`), and
  a parity test pins the two.
- **R5, credit band** (spec §12.8). `tight` below 0.30; `normal` from 0.30 up to but not
  including 0.70; `wide` from 0.70.
- **R6, `active_signals`** (spec §12.1, v2 §19). The union, without duplicates, of:
  - the available Ledger rows with `firing_now` true and not stale (spec §12.1, folded S-18);
  - the five rows with the latest non-null `last_fired`.

  Order: firing first, then `last_fired` descending, then `slug`.
- **R7, Ledger** (spec §8, v4 B-02/B-03). The twelve rows are in `LEDGER_ORDER`. `scored_n`
  counts the rows whose item is `ok` (an `insufficient` verdict counts as scored).
- **R8, print** (v2 §9.1). The row stamped K−2 for session month K: the rule of `regime_at`
  (`event_study.py:359–364`), with `REGIME_LAG_MONTHS = 2` (`:111`).
- **R9, `months_in` / `since`** (spec §12.1). Walk the stored rows back from `print` while the
  label is equal and the month is consecutive; a missing month ends the run (spec §12.1, §12.6, folded S-14).
  `get_regime_duration` (`src/analytics/intelligence.py:1088`) cannot serve this: it starts from
  the newest row, not from the K−2 row, and it bridges gaps.
- **R10, catalog labels.** One `label` and one `short` per slug, served everywhere (v2 §19).
- **R11, normalization** (spec §12.2, v3 §2). The request either names `preset=<slug>` or gives
  the six slots.
  - `preset` accepts a catalog slug. It also accepts an engine slug whose `es.parse_slug`
    (`event_study.py:282`) equals a catalog query: `spx-golden-cross` → `golden-cross` (v3 §2
    "aliases"; `slug_for` is untouched).
  - The slots:
    - `window` ∈ {5, 20, 60}, required for `up2s`/`down2s` and absent for a cross;
    - `while` defaults to `none` (spec §12.2, folded S-20);
    - the five-slot tuple must equal a catalog row;
    - `horizon` ∈ the row's `allowed_horizons`.
  - Any unknown or repeated parameter, `confidence` included, is a 422 `unsupported` that names
    it.
  - **A row with no horizons (§6 S-31, operator rule).** The RSI rows have `allowed_horizons: []`.
    - A preset request for one of them that carries a `horizon` parameter, whatever its value, is
      422 `unsupported`, and the message names `horizon`.
    - Without one it is awaiting 200 with the row's reason, `{reason: "RSI is not computed yet.",
      until: null}` (spec §12.3, folded S-17).
    - The default horizon of 20 is never applied to such a row.
    - The rule holds on `/study` and `/study/events` alike, since both take the same parameters
      (spec §12.4).
- **R12, display unit.** `percent` for the two log units, `bp` for `bp`.
- **R13, the reasons in words.** The words are spec §12.2's (folded S-07).
- **R14, `series[].ops`.** For each series, the moves of the catalog rows that use it as shock.
- **R15, `empty_state.fixes`.**
  - `widen_window` is offered when the question with the next larger window is a catalog study.
  - `drop_condition` is offered when the question with `while: none` is one.
  - Otherwise the list is empty.

### 1.11 New calculations (N), each authorized by spec §13.2 (v3 §23 / A-16 and v4 B-12 as folded)

**N1, firing state** (§13.2 "the firing state"; v3 §3 = A-07; v4 B-05).

- **Inputs:** the study's `SignalTrace` (§2) from the same run as its numbers:
  - `sessions`;
  - `evaluable`, the engine's mask (`event_study.py:1007–1008`);
  - `trigger`;
  - `holds` (`:993–1005`).
- **Firing:** `fires[i] = trigger[i] and holds[i]`. `trigger` is:
  - for a shock, the engine's threshold comparison before the cooldown (`:516–521`, factored
    out, §2);
  - for a cross, the strict-cross sessions of `cross_positions` (`:532–554`).
- **`evaluated_on`:** the last session with `evaluable` true.
- **The state at a session s:** `fires[i(s)]` when s is a session of the run and `evaluable[i(s)]`;
  null otherwise.
- **`firing_now`:** the state on `evaluated_on`.
- **`firing_day`:**
  - a cross counts 1;
  - a shock counts back from `evaluated_on` while `evaluable` and `fires` both hold, so any false
    or unevaluable session ends the count and a missing session is never bridged;
  - null unless `firing_now` is true.
- **The two sessions:**
  - `comparison_session = api/calendar.last_completed_session(now)` (`api/calendar.py:70`);
  - `prev_session = previous_trading_day(comparison_session)` (`:56`).
- **`stale`:** `evaluated_on != comparison_session`.
- **The lists:**
  - `new_fires` is state(prev) false, state(comparison) true, and not stale;
  - `still_firing` is true on both sessions and not stale;
  - a null state keeps the signal out of both.
- **Cooldown:** ignored (v2 §3).

**N2, the 50/200-day averages, trend state and chart series** (§13.2; v3 §13 = A-12).

- **One extended calendar (round 5's R-13, the same calendar as N3's R-08; its reach is round
  6's R-17).** The item builds a single XNYS calendar (`session_calendar` and `sessions_between`,
  `:384`, `:397`) that runs through the last stored ^GSPC close. Before the first stored close it
  holds at least the larger of:
  - 252 sessions, which `ret_1y` needs;
  - the full 36-calendar-month chart range plus 200 sessions, that is `n36 + 200`, where `n36`
    counts the XNYS sessions after `date − 36 calendar months` through `date`. Every point of the
    longest chart then has all its average slots on the calendar, even when the store holds one
    close.

  How it is built and checked:
  - `session_calendar` opens on 1 January of its `start`'s year (`:388–389`). The item passes the
    first stored close minus four calendar years. That reaches at least 1,001 sessions back from
    any session since 1990, and `n36 + 200` is at most 959 (`n36` runs 750 to 759 for every
    session since 2000). Both counts are this plan's, with exchange_calendars 4.13.2.
  - The item still asserts the count before the first stored close rather than trust that
    arithmetic.
  - ^GSPC is declared from 1990-01-02 (`src/desk/series.py:112`), so the calendar never reaches
    the pre-1970 years.
  - The ^GSPC level is aligned onto it as the engine aligns it: `load_level` (`:310`), then
    `align` (`:469`) and `validate_values` (`:481`).
  - A session before the first stored close is therefore a slot with no close, never a missing
    slot or a negative index.
- **`ma50` and `ma200`:** `rolling(50, min_periods=50).mean()` and the 200-day version over that
  aligned series, the engine's own expression (`:537–538`, `:562`). An average is null when any
  of its slots lacks a close, a slot before the data included. One missing close is enough: that
  is the case today, since 2026-09-22 is missing (audit §1, fact 1).
- **Windows**, with `i` the position of `date` on the extended calendar:
  - `ma50_window = {start: cal[i − 49], end: cal[i], n}`, and `ma200_window` likewise with
    `i − 199`;
  - `start` and `end` are always real XNYS dates;
  - `n` counts the finite closes inside exactly those slots, so it is below 50 (or 200) exactly
    when the average is null.
  - The chart series' per-point averages use the same slots.
- **Comparisons:**
  - `above_50 = price > ma50`, null when the average is null;
  - `vs_ma50 = price / ma50 − 1`;
  - the same for 200.
- **`state`**, per session, with strict comparisons both ways:
  - `unavailable` when either average is null;
  - `above_both` when `price > ma50` and `price > ma200`;
  - `below_both` when `price < ma50` and `price < ma200`;
  - `mixed` otherwise. A price equal to either average is therefore `mixed`, never above or below.

  `state_since` applies the same rule to every session and is the first session of the current
  run of equal state. The run is counted from the first stored close onward, so a slot before the
  data never extends it and `state_since` never names a date the calendar's opening chose. With
  one stored close it is that close's date.
- **The chart series:** the sessions after `date − 6 / 12 / 36` calendar months, through `date`.
  Each point is `{date, close, ma50, ma200}`, with null where a close or an average is missing
  (spec §12.7, folded S-15).
  - The dates are the extended calendar's sessions, so the series has every session of its range
    whatever the history: `series.3y` has `n36` points.
  - A point before the first stored close is `{date, close: null, ma50: null, ma200: null}`, with
    a real XNYS date (R-17).

**N3, one-day and one-year returns** (§13.2; v4 B-12).

- **`chg_1d`:** `to` is `date` (the newest session with a close) and `from` is the XNYS session
  before it. The value is `close(to) / close(from) − 1` when both closes are finite, else null.
  The dates are served either way. There is no fallback to an earlier stored close, so the value
  is null today (audit §2.1).
- **`ret_1y` (R-08):** the same rule with `from` 252 XNYS sessions before `to`.
  - **Resolving `from`.** It is resolved on N2's extended calendar (`session_calendar`,
    `event_study.py:384`). Before the first stored close that calendar holds at least the larger
    of 252 sessions and the 36-month chart range plus 200 sessions (round 6's R-17). So `from` is
    always a real session date, and never a negative index into the stored span, which Python
    would wrap to its end.
  - **With no stored close on `from`,** as with less than 252 sessions of history, `ret_1y` is
    null and `ret_1y_dates.from` still names that session.
  - **`chg_1d`** uses the same extended calendar when `to` is the first stored session.
  - **Test:** a store holding 200 sessions of ^GSPC serves `ret_1y: null`, with `ret_1y_dates.from`
    252 sessions before the last one.

**N4, `move_20d_sigma`** (§13.2: "the z of the spx-20d-2sigma study it evaluates").

- The value is `trace.z` of the `spx-20d-2sigma` item at that study's `evaluated_on`, and
  `move_20d_date` is that session.
- `trace.z` is the engine's `zscore(move(shock, spec, 20))` (`:979`). Nothing is recomputed.

**N5, recession provenance extraction** (§13.2; v3 §11 = A-09).

- **Where:** a new function, `recession_provenance()` in `src/analytics/recession.py`. It is built
  by the `desk_regime` item in the same generation as the `recession` item.
- **Its connection.** It opens one through `_get_conn()` (`:35–41`) and closes it in a `finally`
  on every path. That is the pattern hardening's round 19 (V-54) gives the module's three builders,
  which its static test checks (§8).
- **The steps**, each mirroring the model's own lines:
  1. build `features_df` with `_build_feature_frame` (`:86–154`);
  2. `X = features_df[FEATURE_NAMES].shift(3)` (as `:256`);
  3. the scoring rows are `X.dropna()` (as `:257`), kept to index `≤ today` (as `:274–276`).
- **The outputs:**
  - `probability_month` is the month of the last scoring row;
  - with `pos` its position in `features_df`, `inputs_through` is `features_df.index[pos − 3]`,
    the row-wise shift the model applies;
  - `feature_months[f]` is that same month for every feature, because the shifted row is complete
    by construction;
  - `training` is the first and last month of `concat([X, usrec]).dropna()` (as `:173–177`).
    `usrec` is the target `_build_feature_frame` returns (`:133–152`): the stored USREC series,
    resampled and forward-filled onto the feature index, or, when USREC is not stored, the NBER
    date ranges of `NBER_RECESSIONS` (`:24–29`, `_build_usrec_from_nber` `:76–83`).
    `n_training_samples` (`:361`) counts the scoring frame, so it is not reused.
- **Parity:** a test asserts that the extraction's scoring index equals the dates of the served
  `recession_prob_series`, so the extraction cannot disagree with the score it dates.
- **`year_ago` and `peak`** read the served `recession_prob_series`, whose points are
  `{date: "YYYY-MM-DD", value: percent 0–100}` (`api/recession_cache.py:24–29`). Each is served as
  `{score: value / 100, probability_month: date[:7]}`:
  - `year_ago` is the point whose month is `probability_month − 12`, and null when absent;
  - `peak` is the maximum point at or after 2015-01-01, earliest on ties, and it also carries
    `window: "since 2015"`.

**N6, next-print inverse thresholds** (§13.2; v3 §9.3 = A-10).

- **The classifier's rule.** It classifies on 3-point OLS slopes of the INDPRO and CPIAUCSL
  levels:
  - the slopes are taken over the rows of their joint frame (`src/regime.py:151–154`), with
    `ROLLING_WINDOW = 3` (`src/config.py:33`);
  - for x = 0, 1, 2 the slope is `(y₂ − y₀)/2` (`src/regime.py:16–29`);
  - an axis is rising iff its slope > 0 (`:43`).
- **For each k ∈ {cpi: CPIAUCSL, indpro: INDPRO}:**
  1. let m be the latest regimes row's month;
  2. `x(m)` is the series at m, and `x_prev` is its value on the joint frame's row before m
     (normally m−1). Both are read with `recession._load_raw` (`recession.py:44–55`);
  3. `threshold_mom = x_prev / x(m) − 1`;
  4. `operator` is `<=` when the latest row's own-axis sign is rising, else `>`;
  5. `flips_to` is the regime with this axis flipped and the other axis at the latest row's sign;
  6. `reference_month = m + 1` and `first_effective_month = m + 3`.
- **When not evaluable:** `threshold_mom` and `flips_to` are null when the series already has a
  value for m+1 (the regime waits on the other series).
- **Mirrors.** The 3-point closed form holds only for a window of 3, and `api/` cannot import
  `src.regime` (it imports `src.config`, `src/regime.py:4`). So the window and the four-entry
  `REGIMES` table (`src/regime.py:8–13`) are mirrored and pinned by AST parity tests (the pattern
  of `tests/test_freshness_state.py:174–189`).

**N7, rolling HY statistics** (§13.2; v3 §12 = A-11; v4 B-07).

- **The series:** `load_level(conn, hy_oas)`. `hy_date` is its last date and `current` its value.
- **The rank window** is `[hy_date − 3 years, hy_date]`, closed:
  - `valid` is every finite stored observation dated in the window;
  - `expected` is the XNYS sessions in the window (`session_calendar`/`sessions_between`) minus
    `api/calendar.bond_extra_closures(year)` (`api/calendar.py:109–122`) (spec §12.8, folded S-12);
  - `missing` is the expected sessions without a finite observation.
- **The holiday tables (S-12, ruled, in addition to the rule above).** B adds the missing NYSE
  holidays to `api/calendar.py`'s `HOLIDAYS` (`:17–22`) for every year the store covers. Today that
  is 1962, when DGS10 starts (audit §1), through 2023, since 2024–2027 are already there. Then
  `is_bond_trading_day` (`:125`) and `calendar_known` (`:42–43`) are right for those years too.
  From 1970-01-01 the tables agree with the engine's calendar; before 1970 they do not, and
  `api/calendar.py` is the authority (the next bullets).
  - **The source (R-03).** The tables are generated once by `scripts/gen_nyse_holidays.py` from
    `exchange_calendars` 4.13.2, already pinned in `requirements-api.txt:33` and used by the
    engine. The generator reads the XNYS calendar's holiday definitions, never "weekdays minus
    sessions":
    - `regular_holidays.holidays(start="1962-01-01", end="2023-12-31")`, the rule-based holidays
      bounded to the range (the pandas `AbstractHolidayCalendar` interface;
      `exchange_calendar_xnys.py:168–195` in the installed package);
    - `adhoc_holidays`, the one-off closings (`:198–218`), filtered to the same range. These
      include the 1968 paperwork crisis, the 1977 blackout, 9/11, Hurricanes Gloria and Sandy, and
      the national days of mourning.
    - It keeps weekday dates only: 569 of them for 1962–2023 in 4.13.2, 101 of them before 1970.
    - The output is checked in as data, because `api/calendar.py` stays stdlib-only for the lean
      installs.
  - **The engine's calendar disagrees before 1970 (R-03).**
    - **The fact.** `exchange_calendars` builds XNYS sessions as
      `CustomBusinessDay(holidays=adhoc_holidays, calendar=regular_holidays)`
      (`exchange_calendar.py:753–759` in the installed package). pandas'
      `AbstractHolidayCalendar.start_date` defaults to 1970-01-01 (pandas 3.0.5).
    - **What was observed** (read-only, 4.13.2): no regular holiday before 1970 removes a session.
      All 69 regular holidays of 1962–1969 are XNYS sessions there, 1962-12-25 among them. The 32
      ad hoc closings of those years are non-sessions. From 1970 through 2023 the holiday
      definitions and the non-sessions are the same 468 dates.
    - **Consequences.**
      - Parity with `exchange_calendars` sessions is asserted from 1970-01-01 only.
      - Before 1970, `api/calendar.py` and `session.py` are the authority. They are tested against
        the bounded holiday definitions and the known dates (§5).
      - The engine's own calendar is left as it is: it is frozen by the native regression (§2), and
        B changes nothing in it.
    - **No served calculation reaches a pre-1970 session.**
      - **Through `api/calendar.py`:** freshness judges recent dates, N7's window is three years,
        and the chart and return windows are at most three years and 252 sessions.
      - **Through the engine:** every served statistic is computed on evaluable sessions, and these
        start at the first labelled month, 1996-07-01 (`first_labelled_date`,
        `event_study.py:367–370`; audit §3), less any month whose K−2 row is missing. The one
        exception is `unlabeled_n`. It counts the events whose K−2 month has no stored regimes
        row (spec §12.2 at `42298cb`): those before the first labelled month, and those in a gap,
        such as the sessions governed by the missing 2025-10 row. They fall on sessions where the
        shock, the condition and the target all have values (`event_study.py:1017`). In every catalog study those sessions start no
        earlier than 1990, when ^GSPC's history begins (2000 for the gold study). The lookbacks
        reach at most a 252-session z window plus a 60-session move before that, so back to about
        1989.
      - **One served text counts across those years:** the engine's provenance warning "calendar
        sessions without a value" for a DGS10 input. It spans the series' whole stored range, and
        so includes 67 pre-1970 holidays on the audit's copy (§1.2).
        - It is engine output, frozen by the native regression, and no statistic depends on it.
        - The adapter now discloses it in the served copy: "(includes N pre-1970 holidays the
          engine calendar treats as sessions)" (round 4's R-10, §1.2).
  - **The lean copy.** The same years go into the lean copy in `src/market_data/session.py`
    (`:23–28`), which `tests/test_market_session.py:36` pins equal.
  - **Early closes.** `EARLY_CLOSES` keeps 2024–2027. Its only readers are session-time checks on
    recent dates, and the same test pins it equal.
  - **The bond extras.** `bond_extra_closures` (`:109–122`) encodes today's federal rules: Columbus
    Day the second Monday of October, Veterans Day on 11 November. Before 1978 the federal dates
    differed: Columbus Day was 12 October until 1970, and Veterans Day was the fourth Monday of
    October from 1971 to 1977. B checks those years against the stored DGS10 days (FRED prints no
    Treasury yield on a bond holiday), extends the function where the store confirms the older
    dates, and records what it found.
- **With `missing_n > 0`:** `hy_pct_3y` and `hy_range_3y` are null. `reason` is "coverage from
  <first_obs> only" when every missing session precedes the first observation. Otherwise it names
  the gap as the first three dates and a count.
- **Otherwise:** `hy_pct_3y = count(valid < current) / valid_n`, with ties not below, and
  `hy_range_3y = [min, max]`.
- **`rank_window`** is `{start, end, n: valid_n, expected_n, valid_n, missing_n, first_obs,
  last_obs}`.
- **The line window** is `[hy_date − 12 months, hy_date]`:
  - `series` is every observation in it;
  - `line_window` is `{start, end, n}`;
  - `peak_12m` is the maximum, earliest on ties.
- **On the audit's copy** this gives valid_n 787 and missing_n 0, and 15.50% (Q5 agrees).

**N8, curve alignment, month-ago selection, dated differences** (§13.2; v4 B-12; v2 §12).

- **`today.date`:** the latest date on which every stored tenor has a finite value.
- **`dates`:** that date for each stored tenor, and null for a tenor with no stored rows.
- **`month_ago`:** the same alignment at or before `today.date − 1 calendar month`, the same shape
  as `today`.
- **The differences**, each taken only between common dates:
  - `2s10s_bp = (10y − 2y) × 100` on `today.date`;
  - `2s10s_chg_bp` is the difference of the two 2s10s values;
  - `10y_chg_bp = (10y_today − 10y_month_ago) × 100`.
- **No common date (round 6's R-18).** When no date carries a finite value for every stored tenor
  (for example, disjoint DGS2 and DGS10 histories):
  - `today.date` is null. Each stored tenor carries its own newest value, with that value's date
    in `today.dates`.
  - `month_ago` has the same shape: `month_ago.date` is null, and each stored tenor carries its
    newest value at or before **its own** `today.dates` entry minus one calendar month, with that
    date in `month_ago.dates`. A tenor with no observation that early is null with a null date.
  - `2s10s_bp`, `2s10s_chg_bp` and `10y_chg_bp` are all null, even though 10y alone has two
    dated values. The UI labels the mismatch from `dates`.
  - An unstored tenor is null with a null date in both, as on the common-date path.
- **A common `today.date` with no common date a month earlier** takes the same per-tenor form for
  `month_ago` alone: each tenor's newest value at or before `today.date − 1 calendar month`,
  `month_ago.date` null, and both changes null. `2s10s_bp` is still served.
- **`today.dates` and `month_ago.dates` are always served (round 7's R-19, extended to today by
  round 8's R-20).** Each has one entry per tenor on every path:
  - the common date, on the common-date path;
  - each tenor's own date, on a per-tenor path;
  - null, for a tenor that is not stored or has no observation early enough.
- **Each snapshot is judged by its own date** (R-20). The page checks the two dates
  independently:
  - when `today.date` is null, it lists `today.dates` and draws today's tenors as labelled points
    that no line joins;
  - when `month_ago.date` is null, it does the same for the month-ago tenors with
    `month_ago.dates`.

  Neither check may stand in for the other. A null `today.date` always comes with a null
  `month_ago.date` (R-18), but a common `today.date` can come with a null `month_ago.date` (the
  partial case above), where today is still one curve. This is session A's work, recorded in §6
  S-30 as a prerequisite.
- **Today** (2y and 10y only): the common date is 2026-09-22, and the month-ago date is
  2026-08-21, as audit Q4 found.

**N9, Desk `data_status`** (§13.2; v4 B-06; C-02).

- **The contributors:** T10Y2Y, VIXCLS, BAMLH0A0HYM2, DGS2, DGS10, ^GSPC and GC=F. These are the
  tier-1 inputs of the twelve Ledger studies plus DGS2 and DGS10.
- **The FRED series** are judged by `desk_series_states` (`api/freshness.py:143–182`):
  - its specs come from `api/desk.desk_series_specs` (`api/desk.py:410–427`);
  - `stored` is `db.freshness()["desk_series_latest"]` (`api/db.py:713–715`);
  - the watermarks come from `db.watermarks()`;
  - `close` maps to current, `stale` to stale, and `unknown` to missing;
  - `expected_observation_date` is the first value of `_daily_expected_and_lag(d or today,
    today, calendar == "bond")` (`api/freshness.py:83–88`), which does not depend on `d`.
- **The two prices** each go through `api/freshness.assess` with
  `db_fresh = {"asset_prices_date": <that symbol's newest date>}`:
  - its `asset_prices` sla row is `current`, `delayed` (the 06:00 UTC grace) or `stale`
    (`:260–282`);
  - `current` and `delayed` map to current (spec §12.1, folded S-23), `stale` to stale, and an unstored symbol
    to missing;
  - `expected_observation_date` is the row's `expected`.
- **`reason`** is the policy's own sentence.
- **`state`** is the worst contributor: missing, then stale, then current.

**N10, the Overview comparisons** (§13.2; v4 B-12).

- **`vol_change_pts`:** VIX (`load_level(vix)`) on exactly `comparison_session` minus VIX on
  `prev_session`, null when either is missing. FRED posts VIX the next day, so this is usually
  null until the morning after.
- **`regime_from` / `regime_to`:** the stored K−2 rows for the months of the two sessions
  (`regime_at`, `:359`).
- **`regime_changed`:** they differ, null when either is null.

**N11, the three FRED tenors** (§13.2; §12.8; v2 §12). This is registration, not arithmetic
(§4 step 5).

### 1.12 Audit against spec on computability

The audit and the spec agree wherever both judge computability. There is no field where the spec
calls a value computable that the audit shows is not. Three kinds of case look like disagreements
and are not.

**The audit judged an older definition.** It judged `since_last_close` against a "previous
generation" it could not find (audit §2.1), and `vol_change_pts` as an implied-volatility change.
v4 B-05 and B-12 redefine both over two sessions of one generation and over VIXCLS, which are
computable.

**The audit shows a number computable that the spec withholds on scope** (§13.2 "not allowed for
Monday"). B serves each of these as awaiting, as the spec says:

- the six `without_condition` statistics (a second run, audit §2.3);
- the 80% and 95% intervals (audit §3);
- the months per regime and the last five changes (audit §2.4).

The audit's evidence is recorded here for when the spec lifts them.

**The same rule gives a different value from the audit's.**

- **`tiles.regime` / `current.label` this week:** the audit read the newest row (2026-08,
  Overheating). The K−2 rule (R8) gives the 2026-07 row for September sessions: **Goldilocks**,
  months_in 1, since 2026-07. It moves to Overheating on the first October session.
- **`spx-20d-2sigma` and `spx-5d-2sigma`:** the audit assumed "either way" (`abs`: n 86 and 188).
  The folded catalog fixes `up2s`, so the served counts differ from audit §4.
- **`ma50`/`ma200`:** audit Q2's plain averages are not the rule. Under the engine's rule both
  are null today. The audit says the same thing: "the engine's rolling average is NaN on
  2026-09-23".

---

## 2. The engine-output extension (v3 §8, spec §13.2)

**Where the arrays live in `_run`** (`src/desk/event_study.py:941–1176`):

| Array | Lines | What it is |
|---|---|---|
| `sessions` | `:952–955` | the study's XNYS calendar over the inputs' span |
| `ev_pos` | `:1018`, regime filter `:1021–1024` | retained event positions, ascending |
| `labels` | `:1020`, `:1023` | K−2 label per retained event |
| `entry`, `same`, `has_entry` | `entries_for` `:1030–1034`, `:1036` | entry index (−1 when beyond the data), same-session flag |
| `ev_delay` | hardening's `_run`, right after `entries_for` (not in this tree; on B's base after the merge) | each retained event's entry delay in sessions, `delay_all[ev_pos]` from `entry_delay_vec`: 0 for the event's own close, 1 for the next session, up to 8 for WTI (hardening's R-01). Defined for every event, including one whose entry falls after the stored data. `same = delay == 0` |
| `moves_by_h[h]` | `:1038` via `forward_moves` `:576–591` | native outcome per event (NaN when incomplete) |
| `unl_pos` | `:1017` | Unlabeled events, outside the totals |
| `z` | `:979` (None for a cross) | the shock's 252-session z per session |
| `input_ok`, `holds`, `evaluable` | `:985`/`:975`, `:993–1005`, `:1007–1008` | the evaluability mask and the condition |
| `recent` | `:1059–1070` | the ten newest events as served |

**The change** has four parts. It is small and local, and it never touches the returned dict.

1. **Factor the threshold comparison out of `detect_events`.** A new
   `trigger_mask(z, thr, sign) -> ndarray[bool]` holds the three comparisons of `:516–521`.
   `detect_events` calls it and keeps its cooldown loop (`:522–529`) unchanged.
2. **Give `_run` a keyword-only `trace: dict | None = None`.** Right after `recent.reverse()`
   (`:1070`), when `trace` is not None, it fills it with copies of the arrays above:
   - `trigger`: `trigger_mask(z, q.z, q.sign)` for a shock. For a cross it is a boolean mask at
     `cross_positions(shock, q.cross)[0]`. That is the engine's own function on the same aligned
     `shock`, called again in the trace block, so no second hunk is needed where `ev_pos` is
     overwritten.
3. **Add public entry points beside `run`/`run_on`.** `run_on_traced(conn, q, *, generation,
   n_boot=N_BOOT) -> (dict, EventTable, SignalTrace)` repeats `run_on`'s validation and clamp
   (`:931–938`), and `run_traced(q, db_path)` repeats `run`. `run`, `run_on` and `slug_for` are
   untouched, and so is `PRESETS`: adding catalog rows to `PRESETS` would change `slug_for`'s
   output, and with it every native payload's `study.slug`.
4. **Freeze the result.** The frozen dataclasses hold arrays with `setflags(write=False)`:

```text
EventTable  (retained events only, ascending; one row per event)
  sessions: tuple[str, ...]           the study's calendar, ISO dates
  event_idx: int[k]                   ev_pos
  entry_idx: int[k]                   entry (event + delay), −1 when beyond the stored data
  entry_delay: int[k]                 ev_delay, for every event, entry-less ones included (R-04)
  same_session: bool[k]               entry_delay == 0
  regime: tuple[str, ...]             labels (K−2)
  exit_idx: {h: int[k]}               entry + h when value[h] is finite, else −1
  value: {h: float[k]}                moves_by_h[h], NaN when incomplete (native units)
  n_unlabeled: int                    len(unl_pos)
SignalTrace
  sessions (shared), evaluable: bool[n], trigger: bool[n], holds: bool[n], z: float[n] | None
```

**The projections** are what the adapter serves. Nothing is rebuilt from `recent_events`:

- `matched_n = k`.
- Per h, over the finite outcomes `f = value[h][isfinite(value[h])]` only:
  - `n = len(f)`;
  - `n_incomplete = k − n`;
  - `up_n` is the count of `f > 0` (0 when `n == 0`);
  - worst and best are the argmin and argmax of `f`, mapped back to their rows. numpy's
    first-occurrence rule on the ascending table gives the earliest event on ties. Both are null
    when `n == 0`.
- `first_event` and `last_event` are `sessions[event_idx[0]]` and `sessions[event_idx[-1]]`.
- `last_events` is the last five rows reversed.
- The CSV is every row reversed.
- The regime counts are `regime.count(r)`.

**The projections are checked against the run itself.** These assertions run in the tests for
every catalog study on the synthetic store and on the published copy. Each works on the finite
outcomes `f` only, and each branches on `n == 0`.

- `k == P.n_events` and `n_unlabeled == P.n_unlabeled`.
- Per h, always: `n == H.n` and `k − n == H.n_incomplete`.
- Per h, when `n > 0`:
  - `up_n / n == H.hit_rate` exactly: the engine's `np.mean` of booleans divides the same integer
    sum (`event_study.py:676`);
  - `median(f) == H.median`;
  - worst ≤ `H.median` ≤ best.
- Per h, when `n == 0`: `H.hit_rate is None`, `H.median is None`, `up_n == 0`, and worst and best
  are null (`:667–670`). No division is made.
- The table's newest ten rows, put in `recent_events`' shape, **equal `native["recent_events"]`**.
  The shape is: `date`; `z` rounded to 2; `regime`; `entry_date`, null for an entry-less event;
  `same_session`; `entry_delay`; and `moves` with NaN → None. `entry_delay` is compared for every
  event, entry-less ones included (R-04): hardening's `recent_events` writes `int(ev_delay[i])`
  whether or not the event has an entry session.
  This is the strongest single proof that the table is the run's own event set. With `k == 0`,
  both are empty.
- Per regime: `regime.count(r) == regimes[r].n_events` (`:745`).

They must pass in the ready-but-insufficient cases:

- `hy-2sigma-20d`: n 2 and 2 blocks, so statistics exist but there is no interval;
- a synthetic zero-event study: `k == 0`, every `n == 0`, `first_event` null.

The tests include both (§5, readiness 3 and 4).

**The regression gate** (spec §13.1, v3 corrections §3, A-18) has three layers. All three run
before every commit that touches `src/desk/`.

**The base and the pins.**

- The base is `main` after hardening merges. The golden is built there before B's first commit,
  and B's branch starts from that commit.
- The base engine always runs from a full checkout of that commit:
  `git worktree add --detach <tmp> <base>`, with `PYTHONPATH=<tmp>`. The engine imports
  `src.analytics.dbpath` and `src.desk.series`, and a partial `git archive` of two directories
  would not import.
- Every run, base or head, pins both `generation="golden"` and `as_of="2026-09-24"` (a fixed
  date, not today's). The fixed generation makes `inputs_hash` reproducible across copies: the hash
  includes the generation (`event_study.py:908`), and audit §10 item 5 shows the file key
  otherwise changes it. After hardening, `run_on` takes `as_of`, and the cutoff decides which rows
  are read. So an unpinned cutoff would move with the calendar, and the golden would drift with
  it.

**The layers.**

1. **The traced path returns the identical dict.** For each catalog query and each existing
   preset, `json.dumps(run_on(...), sort_keys=True)` equals `json.dumps(run_on_traced(...)[0],
   sort_keys=True)`. This runs on the synthetic store (`tests/test_event_study.py:49`, `:88`),
   which holds every tier-1 series.
   - The same layer asserts the typed refusal for the three queries that read a series the
     synthetic store lacks (`wti-w20-z2.0-up-none-spx`, `wti-w20-z2.0-up-none-gold` and
     `dxy-w20-z2.0-down-none-spx`). Both `run_on` and `run_on_traced` raise `es.NotStored`, with
     `series` `"wti"` or `"dxy"`, and the `desk_study:<slug>` builder turns that into
     `{"ok": False, "kind": "not_stored", "series": …}`. The assertion is on the class, never on
     the message.
2. **A golden from the base, on the synthetic store.**
   - `scripts/desk_native_golden.py` runs the base engine from the worktree above, with both pins.
   - It writes `tests/fixtures/desk_native_<base>.json`, one sha256 of canonical JSON per query.
   - `tests/test_desk_native_regression.py` compares HEAD's output, under the same pins, against
     it. It covers the 3 presets, the 10 tier-1 catalog queries, and the test module's existing
     free-form queries.
3. **A/B on the published copy.** `scripts/desk_native_ab.py --base <sha> --db <copy>` runs the
   base engine (the worktree on `PYTHONPATH`) and HEAD's engine in two subprocesses, on the same
   file, with the same pins. It diffs the canonical JSON of every catalog study, every preset and
   the audit's studies.
   - It must print "byte-identical: N/N". The line goes in the B report.
   - Any difference is a blocking finding (A-18).
   - The adapter's schema, the aliases and the v1 labels are tested separately, as new outputs.

---

## 3. The envelope and error handling

**The module.** `api/desk_envelope.py` is stdlib and imports nothing heavy (the import-weight test
`tests/test_desk_api.py:313`). It holds:

- `envelope(...)`, `block_ready(data)` and `block_awaiting(reason, until=None)`;
- `ENVELOPED_ROUTES` and `NESTED_PATHS`, which mirror
  `web/src/screens/desk/data/envelope.ts:37–43` and `:153–156`. A test reads the TS file and
  pins the two, the way `tests/test_provider_no_yahoo.py` pins web constants;
- `DEFERRED_REASONS`, the exact sentences for every awaiting block and stub (§6 S-17);
- `answer(route, fn)`, the one wrapper every handler runs in.

**The response rules:**

- Every enveloped response is `application/json` with `Cache-Control: no-store`.
- It is serialized with `allow_nan=False`, so a NaN that escaped is a 500 bug, never a
  `NaN` on the wire.
- `data` is non-null only when `status` is ready.

**The error map** (one place, `answer`):

| Raised or found | status | HTTP | `error.code` / headers |
|---|---|---|---|
| normalization failure, unknown or repeated parameter, horizon not allowed, any `horizon` on an RSI preset (R11, S-31) | error | 422 | `unsupported`, message names what |
| `es.StudyError` from engine validation | error | 422 | `unsupported`, the engine's words |
| catalog item `{"ok": False}` (engine `NotStored`, or `StudyError` "no evaluable session"), or an RSI preset without a `horizon` (S-31) | awaiting | 200 | `unavailable: {reason, until: null}`; for RSI the reason is "RSI is not computed yet." |
| `worker.Warming` (no generation yet; `api/worker.py:102–109`) | **computing** | 202 | `Retry-After: 2`; `generation_id`/`as_of` null (§6 S-11) |
| `api.db.DBUnavailable` (`api/db.py:39`) | error | 503 | `db_unavailable`, sanitized message (the `api/main.py:239–244` rule) |
| `SchemaCheckFailed` (staged hardening, `api/provenance.py`) | error | 503 | `schema_check`, plus `retryable: true`, `provider: "api"` |
| a Desk item's stored error for a whole-route item (e.g. `desk_technicals`) | error | 500 | `internal`, a fixed sentence, `log.exception` |
| the same for one block of a composite route (`/overview`, `/regime`, `/macro`), or a block whose stored input is absent (no K−2 row, no recession result) | the block is awaiting | 200 | the spec's exact reason, "Awaiting refresh: this could not be computed from the current data." (spec §12.0 at `42298cb`). The UI badges it `○ Awaiting refresh`, not `○ Not yet served` (spec §1.7) |
| Starlette 405 on an enveloped path (`POST /positions`, `POST /basket/price`) | error | 405 | `method_not_allowed`, `Allow: GET` |
| any other exception | error | 500 | `internal` |
| `api/security.py` refusals (413, 429) | not enveloped | 413 / 429 | `{detail}` from `_reply` (`api/security.py:324–331`); §6 S-26 |

**Where the hardening 503 lands.**

- **Its current shape.** The staged hardening answers a failed provenance schema check with
  `{"status":"error","slug","detail","reason","kind":"schema_check","provider":"api","retryable":true}`.
  It is built by `api/desk.schema_error_body`, and the app-level `_schema_check_failed` handler
  in `api/main.py` uses the same body.
- **On the enveloped routes** the same fact becomes the envelope row above. The frame-3 client
  reads `body.error` (`web/src/screens/desk/data/api.ts:101`, `:167`), and its `error` type
  allows extra keys (`envelope.ts:27`). So `retryable` and `provider` ride inside `error`, and the
  top-level `detail`/`kind` are not needed there.
- **The one exception to `{code, message}` (round 6's R-16).** An enveloped `error` carries
  exactly `code` and `message`, except on `code: "schema_check"`, where it carries exactly two
  more keys: `provider: "api"` and `retryable: true`. No other code carries an extra key, and
  `schema_check` carries no third one.
  - The contract helper (§5) enforces exactly that: it allows those two keys on an `error` whose
    code is `schema_check`, and nothing else anywhere.
  - Spec §12.0 still types `error` as `{code, message}`, so this needs a spec edit, which §6 S-28
    records for session A.
- **Before the merge.** `SchemaCheckFailed` does not exist on B's base. B1 ships the map with
  that row as a documented placeholder and a test marked to activate when `api.provenance`
  imports.
- **Whichever of B1 and hardening merges second** must also:
  1. add the `SchemaCheckFailed` row, with the real import;
  2. scope hardening's `_schema_check_failed` so that on `ENVELOPED_ROUTES` it defers to the
     envelope. `answer` catches it first inside the handler, but a failure raised in a dependency
     or middleware would reach the app handler;
  3. run hardening's route sweep, extended to the new routes.

**Nested envelopes.** Builders return block dicts only at the `NESTED_PATHS`, and the handler
assembles them. A contract walk in the tests checks two things (spec §12.0, v4 B-08, C-01):

- every listed path is a block envelope;
- no other object in the payload has the block envelope's keys.

**The `Retry-After` path.** `computing` arises only while the server warms, because every Desk
item is precomputed.

- `Retry-After: 2` is the spec's value. The existing routes keep their 3: `api/desk.py:111` and
  `api/worker.py:62`.
- The client polls the same URL up to `MAX_POLLS = 60` (`api.ts:200`, `:212–215`).
- The deferred stubs never wait on warming. They read `get_worker().current`, or null, and answer
  awaiting at once.

**Two caches** (v4 B-09).

- **The native cache is the worker item** `desk_study:<slug>`, keyed by the generation and the
  canonical engine query. It is shared across horizons, and `inputs_hash` is its native
  provenance hash.
- **The adapter's projection memo** is keyed on `(generation id, route, the normalized
  parameters with selected_horizon, verdict_rule, ADAPTER_SCHEMA)`.
  - It holds **only the generation-dependent projection** of a response: the fields computed from
    the generation's items alone.
  - It never holds a field that depends on "now". Every §0.5 field is recomputed for every
    response, after the lookup, and laid over the memoized part:
    - `comparison_session` and `prev_session`, and `stale`;
    - all firing fields;
    - `data_status`;
    - `vol_change_pts`;
    - the regime comparisons;
    - `release_date`;
    - the K−2 selection.
  - It is bounded (LRU 256). Its entries for other generations are dropped, as `api/desk.py:192–193`
    drops them.
  - `served_from_cache` is true exactly on a projection-memo hit.
- A memo key is never served as `inputs_hash`.

**One generation per response.** `PinGeneration` pins each request (`api/worker.py:609–627`), and
every lookup goes through `get_worker().result()` (`:553–575`). `/overview` reads the Ledger,
technicals, regime and recession items of that one pinned generation.

**`/study/catalog` from the registry and the table.**

- `api/desk_catalog.CATALOG` is the §12.3 table: 15 rows of six fields,
  `(slug, label, short, client_label, question, engine_kwargs | None)`, in order. This is the same
  definition as §4.1 (round 6's R-12): `client_label` holds the 13 titles of §1.3, and null for
  the RSI rows.
- `engine_kwargs` are plain dicts, so `api/security.py` can import the module without the engine.
- `available`/`unavailable` come from each row's item value.
- A test pins `es.slug_for(es.Query(**engine_kwargs))` to the §12.3 "engine query" column for all
  13 rows, which proves the aliases and that `slug_for` is unmodified.
- The registry supplies `series[]`, `roles` and `unit` (`src/desk/series.py:170–171`).

---

## 4. Registration: the edits that ship in one commit (A-17, v3 §20, spec §13.1 step 2)

One commit (B1 commit 3, §7) carries all of the following. Tests fail if any part is missing.

1. **Engine aliases.** A new `api/desk_catalog.py` holds:
   - `CATALOG` (15 rows) and `CATALOG_QUERY_SLUGS` (the 13 with a query). Each row is
     `(slug, label, short, client_label, question, engine_kwargs | None)`. `client_label` holds
     the 13 titles of §1.3 exactly, and null for the two RSI rows (round 5's R-12);
   - `LEDGER_ORDER` (spec §8), `LEDGER_GROUP` (spec §12.5), `TECHNICALS_ALLOWLIST` (spec §12.7),
     `PIPELINE_GROUPS`, `normalize(params) -> (slug, horizon)`, and the alias resolution from
     engine slugs (R11).

   `src/desk/event_study.py` `PRESETS` (`:173–177`) and `slug_for` (`:260–272`) are **not**
   edited.
2. **Worker precompute** in `api/analytics_cache.py`:
   - a `_desk_study(slug)` builder in the style of `_desk_preset` (`:300–310`). It calls
     `es.run_traced(es.Query(**kwargs))` and returns the §1.0 value, catching `es.NotStored` and
     `es.StudyError` into `{"ok": False, …}`;
   - `ITEMS` (`:316–331`) gains `*[(f"desk_study:{s}", _desk_study(s)) for s in
     CATALOG_QUERY_SLUGS]`, inserted **before** the `desk_preset:*` entries.
   - **Optional reuse, guarded.** `_desk_preset(name)` may reuse the catalog item for its three
     presets, which saves three runs per generation, but only when that item carries a native
     payload:
     `item = ctx.get(f"desk_study:{alias}")`; if `item` is not None and `"native"` is in it,
     return `item["native"]`; otherwise run `es.run(es.PRESETS[name])` exactly as today.
     - A refused item (`{"ok": False, …}`) therefore falls through to the existing call, which
       raises the engine's `NotStored` as before. So the legacy routes answer as they do today:
       `/api/desk/event-study` and `/assets`, including 200 `awaiting_refresh` and 503
       `not_stored` (`api/desk.py:257–268`).
     - A test pins the preset payload byte-identical to a direct `es.run`, and the legacy answers
       unchanged on a store without `desk_series` (the `served_before_refresh` fixture,
       `tests/test_desk_api.py:551–554`).
   - **Build time must be measured** before the commit: 13 studies per generation instead of 3.
     Use the cold-timing method, isolated TestClient processes on the published copy, and record
     the number. If the build grows by more than about 20 s, move the catalog items into a
     spawned child like allocation's (`api/analytics_cache.py:204–290`).
3. **`api/security.py`:**
   - `DESK_STUDY_PATHS` (`:44`) becomes `{"/api/desk/event-study", "/api/desk/study",
     "/api/desk/study/events", "/api/desk/study/catalog"}`. `/study/events` enters in the commit
     that adds its route (§7 commit 4), because the spec requires the route and its path in one
     commit.
   - A new `DESK_CATALOG_SLUGS` sits beside `DESK_PRESET_SLUGS` (`:48`), with a parity test. It
     holds all 15 catalog slugs, the two RSI rows included (round 7): S-25's lookup is "a request
     of only `preset=<catalog slug>`", and both RSI answers of S-31, awaiting and 422, compute
     nothing, so they never wait behind a study.
   - **Required** (§6 S-25, ruled; not optional, it ships in this commit): extend
     `_preset_lookup` (`:431–435`) to take the path.
     - On `/api/desk/study` and `/study/events`, a query of only `preset=<catalog slug>`, with an
       optional `horizon`, is a lookup under the stored-read ceiling.
     - A bare `/study/catalog` is one too.
     - Every other query on those paths, the six-slot form included, takes the study ceiling.
     - The branch at `:399–400` calls the extended function. This keeps V-13's rule that a lookup
       never waits behind other visitors' studies.
4. **`api/main.py`:**
   - `app.include_router(desk_v2_router)` after `:1621`;
   - the 405 handler scoped to `ENVELOPED_ROUTES`;
   - no other handler edits in B1.
5. **The three tenors** belong to B2 (§7 commit 8), with `/macro`, as spec §13.1 step 7 orders.
   They are registered tier 1 as spec §12.8 says, with `roles=()` so that no study can select
   them:
   - `src/desk/series.py` gets three rows after `hy_oas` (`:126`):
     - `us3m` for DGS3MO, declared from 1981-09-01;
     - `us5y` for DGS5, from 1962-01-02;
     - `us30y` for DGS30, from 1977-02-15, with a note on FRED's 2002-02 to 2006-02 gap.

     All three are unit `bp`, scale 100, `fixed=("close", −30)`, `known=NEXT_OPEN`, like DGS10
     (`:121`). The declared starts are audit §5's, and the first fetch confirms them: a later
     start is a `short` warning, never a failure.
   - `api/freshness.py` `DESK_REFRESH_SERIES` (`:129–135`) gets the three mirror rows, with
     calendar `bond`.
   - `tests/test_desk_api.py` `REFRESH_IDS` (`:412`) gains the three ids, and the mirror test
     (`:764–771`) must hold.

   **Consequence:**
   - the drawer's `desk_series` verdict and `validate_db`'s full-mode feed then judge eight
     series (`scripts/validate_db.py:81–87`). No workflow edit is needed: the refresh runs
     `--tier 1` (`refresh-data.yml:137`);
   - on the deployed database the tenors read null ("Awaiting refresh") until the first full
     refresh after the merge.

Tests that pin this registration:

- `DESK_CATALOG_SLUGS` equals the 15 slugs of `CATALOG`, a superset of `CATALOG_QUERY_SLUGS`;
- `set(es.PRESETS) == {the three}`;
- the 13 `slug_for` goldens;
- every `desk_study:<slug>` is in `ITEMS`, ahead of the presets;
- a new GET-only test for the v2 router, while `test_desk_router_is_get_only`
  (`tests/test_desk_api.py:491`) stays unchanged for `api/desk.py`'s router;
- the V-13-style middleware test (`:774–811`), extended to the new lookup routing (S-25, ruled).
  With the study ceiling at one slot and held, these requests still answer: a preset `/study`, a
  preset `/study/events`, a bare `/study/catalog`, and `preset=rsi-above-70` with and without
  `horizon` (awaiting and 422, S-31). A six-slot `/study` answers 429.

---

## 5. Test plan

**The contract helper.** `tests/desk_contract.py` is not a test module. It transcribes the folded
§12 field tables into data: for each route, `path → (type, presence, nullable, enum)`, the nested
paths, and the date formats (`YYYY-MM-DD`, `YYYY-MM`, RFC 3339 with zone). `check(route, body)`
asserts all of these:

- the envelope's fields and their state rules;
- every required path is present;
- a null appears only where the table allows one;
- no key exists outside the table (strict, to catch drift in both directions). The one allowance
  is round 6's R-16: an `error` whose `code` is `schema_check` may also carry exactly `provider`
  and `retryable`. Any other extra key on `error`, and those two on any other code, fail;
- enums hold;
- there is no NaN or Infinity.

**One fixture-shape test per endpoint** (nine, plus the stubs), against the folded §12 field
table through `check`. Each runs on two stores.

- **The hermetic store** extends the engine suite's synthetic builder
  (`tests/test_event_study.py:49`: ^GSPC, GC=F, DGS10, DGS2, T10Y2Y, VIXCLS, HY OAS, regimes) with
  `raw_series` (INDPRO, CPIAUCSL, and the recession inputs), `source_watermarks` and
  `event_calendar`. It never skips.
- **The scratch copy** (`data/desk_scratch.db`, `DESK_DB`) skips when absent, as today's Desk
  suite does (`tests/test_desk_api.py:48–62`).

| Test | Asserts beyond shape |
|---|---|
| `test_overview_shape` | the six block paths; the `active_signals` order (R6); `data_status.contributors` ids are the seven |
| `test_study_shape` (+ the preset and six-slot forms of all 13) | `prev_session` is present and is the XNYS session before `comparison_session` (S-10); `selected_horizon` drives `verdict`/`headline`/`why`/`empty_state`; `by_regime[].h == 20`; `client.horizon == 20`; `without_condition` is awaiting with the B-11 sentence `client`, both cases (round 5's R-12): populated, where `client.headline` equals the row's `client_label` and differs from its `label`, checked for all 13 slugs; and `client: null` on a synthetic study whose h = 20 `n` is 0 |
| `test_study_catalog_shape` | 15 rows in §12.3 order; RSI rows `question: null`, `available: false`, `client_label: null`; every other row's `client_label` equals the §1.3 title, and the test reads the spec's §12.3 table at `42298cb` to check it (round 5's R-12) |
| `test_study_events_shape` + `test_study_events_csv` | the JSON rows equal the CSV rows; the header is the §12.4 string; newest first; empty cells for nulls; `true`/`false` |
| `test_ledger_shape` | the §8 order; `scored_n + unavailable_n == 12`; unavailable rows are all-null |
| `test_regime_shape` | `stats`/`changes` are awaiting with the exact reason; `history` has ≤ 60 rows, ascending |
| `test_technicals_shape` | `vol`/`sectors` are awaiting; `signals_allowlist` is exact |
| `test_macro_shape` | three awaiting blocks; `rank_window` keys |
| `test_pipeline_shape` + `test_pipeline_ddl` | `validation` is null without a verified verdict and `"pass"`/`"fail"` with one (the S-01 tests below); the groups; `/pipeline/ddl` is `api/static/snowflake_proposed.sql` byte for byte, as `text/plain; charset=utf-8`, with "PROPOSED" in its first line (S-04); no file under `web/src` or `web/scripts` imports a `.sql` path (R-02) |
| `test_deferred_stubs` | GET awaiting ×6; `POST /positions` and `POST /basket/price` answer an enveloped 405 with `Allow: GET` |

**The other contract tests:**

- the nested-path walk;
- the TS parity of `NESTED_PATHS`/`ENVELOPED_ROUTES`;
- all nine routes in one pinned request context share a `generation_id`;
- warming answers 202 `computing` with `Retry-After: 2` and null ids;
- 422 `unsupported` for: an unknown parameter, `confidence`, window 10, `spx_above_50`, a cross
  with a window, a non-catalog tuple, and a horizon not allowed;
- the import-weight test and the `src.config` test cover the new modules
  (`tests/test_desk_api.py:313`, `:330`);
- `engine_version` (S-21), with the envelope and `provenance.engine_version` checked in every
  case:
  - with `ENGINE_VERSION` set, both serve it, whatever `RENDER_GIT_COMMIT` holds;
  - with `ENGINE_VERSION` unset, blank or `unknown` and `RENDER_GIT_COMMIT` set, both serve
    `RENDER_GIT_COMMIT`;
  - with neither set, both serve `"unknown"`;
  - a Dockerfile test reads the Python stage and finds `ARG ENGINE_VERSION` followed by
    `ENV ENGINE_VERSION=${ENGINE_VERSION}`.

**The projection memo (§3, §0.5).** Two tests keep "now" out of the memo.

1. Two requests on one generation, each with a frozen `now`: the second `now` crosses a session
   boundary, and in a second case a month boundary. The second response is a memo hit
   (`served_from_cache: true`). All of the following still follow the second `now`:
   - `comparison_session`, `prev_session` and `stale`;
   - every firing field;
   - `data_status`;
   - `vol_change_pts`;
   - the regime comparisons;
   - `release_date`;
   - the K−2 selection (`print` moves at the month boundary).
2. A memo entry holds none of those keys.

**The clean-store regression** (§2): `tests/test_desk_native_regression.py`, layers 1 and 2
(layer 1 with the typed `NotStored` for the wti and dxy queries), and the projection assertions
with their `n == 0` branches. `scripts/desk_native_ab.py` is layer 3, recorded in the report.

**Connections to the generation's copy.** Hardening's round 18 (V-51) is on B's base, so the copy
carries no Python authorizer. These tests keep it that way.

1. **A failing builder leaves no unowned connection**
   (`test_a_desk_item_that_fails_midway_leaves_no_connection_to_the_copy`).
   - It runs in its own process, so a hang is a bounded failure: 30 s a step, and faulthandler's
     own thread at 120 s.
   - Automatic collection is off. Each new Desk builder is made to fail after its connection to
     the copy opens: `desk_study:*`, `desk_technicals`, `desk_regime` (N5's `recession_provenance`
     included), `desk_macro` and `desk_facts`.
   - The worker then builds and publishes. The test asserts that `gc.get_objects()` holds no
     connection to the copy (`dbpath.is_copy`, hardening) other than the generation's anchor and
     the `api/db` thread slots.
   - This is the pattern of hardening's `test_a_build_that_fails_midway_leaves_no_connection_to_the_copy`.
2. **Then a bounded reader.** After `gc.collect()`, a fresh reader on a new thread reads the copy
   within the bound. On the unfixed code the collection is where the reader hung.
3. **Static checks.** Hardening's `test_every_builder_closes_its_connection_on_every_path` scans
   `src/analytics`, `src/desk` and `api/desk.py`. Its scope is extended to `api/desk_items.py`,
   `api/desk_v2.py` and `api/bootstrap.py`. A second static check asserts that none of B's modules
   calls `set_authorizer`, `set_progress_handler` or `set_trace_callback`.

**The published verdict (§6 S-01; R-01, R-05, R-07).**

- **`tests/test_bootstrap_identity.py`**, with a mock transport as today:
  - **A match.** A `validation.json` asset whose `db_sha256` matches the downloaded bytes leaves
    bootstrap holding `(verdict, mode, timestamp, validated_key)`, where `validated_key` equals
    `dbpath.file_key(DB_PATH)` after the swap.
  - **No match.** A mismatched sha, or no asset, leaves nothing held. `/pipeline` serves null.
  - **The missed-upload repro (R-05).** Poll one lists a new database with the previous run's
    `validation.json` (a stale sha): the database swaps in and `validation` is null. Poll two
    lists the same database asset with the new `validation.json`. The test asserts no second
    database download, and that `validation` is served.
  - **A restart.** A fresh process with an unchanged asset re-fetches `validation.json` on its
    startup poll, verifies it against the file on disk, and serves the verdict.
- **The key gate (R-01), `tests/test_desk_v2_pipeline.py`:**
  - with the held `validated_key` equal to the pinned `gen.key`, the verdict is served;
  - with a different generation pinned, `validation` is null;
  - **the WAL-commit repro:** after a verified download, one committed write in WAL mode to the
    served file (an `ai_spend_ledger` row) moves its file key, the worker stages a new
    generation, and `/pipeline` serves `validation: null` until the next verified upload.
  - **Codex's round-3 repro (the WAL rule).** Download database A while its `validation.json` is
    not yet listed. WAL-commit one price row to the served file. Poll again when A's metadata
    arrives. The sha of the main file still matches A, but the WAL is not empty, so nothing is
    recorded and `/pipeline` serves `validation: null`. The test also asserts null after a later
    checkpoint, which makes the sha differ.
  - **An empty WAL** (present, zero bytes) records the verdict as usual.
  - **A commit at each boundary of the bracket (round 4's R-01).** The test wraps
    `dbpath.file_key` and the hash so that it WAL-commits one price row at a chosen point of a
    poll's binding. Each case asserts what bootstrap holds and what `/pipeline` serves:
    1. **Before step 1** (`k1` includes the frames): the WAL check fails, nothing is bound, and
       `validation` is null.
    2. **Between steps 1 and 3:** `k2 ≠ k1` and the WAL is non-empty, so nothing is bound, and
       `validation` is null.
    3. **During the hash, between steps 3 and 4:** `k2 ≠ k1`, so nothing is bound, and `validation`
       is null.
    4. **After step 4:** `k1` is bound. The commit moves the file key, the worker stages the new
       key, and `/pipeline` serves null.
    5. **The same four points with the commit checkpointed** into the main file: the same outcomes,
       through the key or the sha.
  - **The worker interleaving (round 4's R-11; hardening's key-stability guarantee).**
    - **Setup.** Bootstrap binds `k1`. The test wraps `AnalyticsWorker._stage` so that it
      WAL-commits a price row after `_maybe_build` has read `k1` and before the copy runs.
    - **Expected, with hardening's every-build check.** The worker drops that copy, no generation
      is published under `k1` with the committed bytes, and the next poll stages the new key.
      `/pipeline` serves `validation: null` throughout.
    - **Without the guarantee** (the staged hardening of 2026-09-26 checks only a rebuild), the
      test fails. That makes it the pin for the dependency.
- **`tests/test_workflows.py`**, next to `test_validation_gates_every_upload` (`:80`, which already
  loops over both writers). In **both** `refresh-data.yml` and `intraday-refresh.yml`, a
  validation step follows the database's publish step, and the test checks all of the following:
  - it runs under the same condition;
  - it carries `timeout-minutes: 1` and `continue-on-error: true`;
  - it computes the sha of `data/macro_radar.db`;
  - it writes `publish/validation.json` with exactly `verdict`, `mode`, `timestamp` and
    `db_sha256`;
  - it uploads it with `--clobber`;
  - the database's publish step does not mention `validation.json`, so a validation failure cannot
    reach the database upload;
  - the intraday validator stays `--mode intraday`.

**The three FRED tenors** (`tests/test_desk_api.py`, `tests/test_desk_history.py`):

- each registry row is tier 1, `fred`, `bp`, scale 100, `roles == ()`, and in `fetched(1)`;
- the freshness mirror equals `desk_series_specs(None)`;
- `desk_history.refresh` with a mocked FRED stores all three (the pattern of the existing tier
  tests) and writes their `desk:<id>` watermarks;
- the event-study assets lists carry none of them as shock or target;
- `/macro` serves a tenor once it is stored, and null with the "Awaiting refresh" rendering before
  that;
- `validate_db` on a store where one tenor failed this run warns (the outage policy,
  `scripts/validate_db.py:348–351`) and does not fail.

**The inventory's providers (round 6's R-15).** `test_pipeline_providers` runs on the hermetic
store and on the audit's copy (sha256 `9a8b857968b8de22…`, through `DESK_DB`; skipped without
it). Every `/pipeline` row, stored or not, has a non-null `provider` equal to its registry row's
source declaration (§1.9):

- the unstored rows are included: the tier-2 series and the three new FRED tenors, none of which
  the audit's copy holds;
- every `asset_prices` symbol, ^RUT included, carries `SOURCE_BY_ID["asset_prices"]`;
- no row's `provider` is read from `desk_series.provider`.

**Freshness through `api/freshness.py` (B-06).** These use a frozen `now`:

- each FRED contributor's state and reason equal `desk_series_states`' row mapped through N9;
- a bond-holiday case: DGS10's last observation is the Friday before Columbus Day and `now` is
  Tuesday, so DGS10 is current;
- VIX one day behind is current (the 2-business-day tolerance, `api/freshness.py:65`), never
  compared bare with the latest XNYS session;
- a price inside the 06:00 UTC grace is current, and past it is stale;
- an unstored contributor is missing;
- the worst-of order holds;
- `expected_observation_date` equals `_daily_expected_and_lag`'s first value.

**Firing state (B-05).** These are pure unit tests on synthetic traces
(`tests/test_desk_firing.py`):

1. false → true between `prev_session` and `comparison_session` lands in `new_fires`;
2. true → true lands in `still_firing`, with the right `firing_day`;
3. `evaluated_on` before `comparison_session` is stale, stays out of both lists, and is never
   called firing;
4. an unevaluable `prev_session` gives a null state and keeps the signal out of both lists;
5. a missing session inside a run resets `firing_day` (never bridged);
6. a trigger inside a cooldown still fires;
7. a cross fires only on its crossing session, with `firing_day` 1, and is false the next session;
8. a trigger whose condition fails does not fire;
9. `firing_day` is null when `firing_now` is false or null;
10. `comparison_session` at a frozen `now`: before the open, after the close, a weekend, a
    holiday;
11. `/ledger`, `/overview` and `/study` agree for the same slug in one generation.

**Readiness (B-07):**

1. every input stored → ready;
2. a tier-2 input absent → the catalog says `available: false` with the engine's `not_stored`
   sentence, `/study` is awaiting 200, and the Ledger row is unavailable;
3. zero retained events (a synthetic study) → ready, `insufficient`, `empty_state` set,
   `first_event: null`;
4. short-history warnings only (`hy-2sigma-20d`: HY from 2023, n 2) → ready and `insufficient`;
5. `StudyError` "no evaluable session" → awaiting;
6. HY coverage: a full window gives the percentile and range; one gap on an expected bond session
   gives nulls and a reason naming the date; weekend month-end and NYSE-holiday observations are
   never counted missing; a history shorter than three years reads "coverage from <date> only";
7. the 2023-12-25 case: without the §6 S-12 calendar rule the percentile would go null. This test
   pins the rule.

**The holiday tables (S-12).** `tests/test_calendar_coverage.py`:

- **Coverage.** Every year that holds a stored daily observation has a holiday list in
  `api/calendar.HOLIDAYS`. The years come from the store: `desk_series`, `asset_prices` rows with
  interval `1d`, and the FRED daily series' watermarks.
  - The test reads the published or scratch copy when present (skipping without one), and the
    hermetic store always.
  - A store that reaches back further fails the test until the tables do.
- **Known dates, asserted independently (R-03).** Each of these dates is a holiday in
  `api/calendar.HOLIDAYS`. They are hard-coded in the test from NYSE's own history of closings,
  never read from `exchange_calendars`:
  - 1962-12-25;
  - the 1968 paperwork-crisis Wednesdays. These are every Wednesday from 1968-06-12 through
    1968-12-18 except the weeks of Independence Day, Labor Day, Election Day, Veterans Day and
    Thanksgiving: 06-12, 06-19, 06-26, 07-10, 07-17, 07-24, 07-31, 08-07, 08-14, 08-21, 08-28,
    09-11, 09-18, 09-25, 10-02, 10-09, 10-16, 10-23, 10-30, 11-20, 12-04, 12-11 and 12-18. B
    confirms the list against NYSE's published record before writing it;
  - 1985-09-27;
  - 2001-09-11 through 2001-09-14;
  - 2012-10-29 and 2012-10-30.
- **Against the bounded definitions, every year.** In the API venv, for every year from 1962,
  the checked-in list equals a fresh run of `scripts/gen_nyse_holidays.py`: `regular_holidays`
  bounded to that year, plus that year's `adhoc_holidays`, weekdays only. This is the only
  check before 1970, where `api/calendar.py` and `session.py` are the authority (R-03).
- **Parity with the engine's calendar, from 1970-01-01 only.** For each stored year from 1970,
  `api/calendar.is_bond_trading_day` equals "an XNYS session and not in `bond_extra_closures`",
  so N7's rule and `api/calendar` agree.
  - The test does not compare earlier years. There, `exchange_calendars` treats every regular
    holiday as a session (N7), and the known date 1962-12-25 would fail against it.
  - A second assertion pins that discrepancy as a fact: 1962-12-25 is an XNYS session in the
    engine's calendar and a holiday in `api/calendar`. A later `exchange_calendars` that fixes it
    then fails loudly, and the "1970 only" rule is revisited, never silently changed.
- **Parity with `session.py`.** `tests/test_market_session.py:36` keeps `session.HOLIDAYS` equal
  to `api/calendar.HOLIDAYS` for every year, the new ones included.
- **The bond extras.** For the pre-1978 years, a check that `bond_extra_closures`' dates carry no
  stored DGS10 value. It skips without the store.

**The served warning's disclosure (round 4's R-10).** `tests/test_desk_v2_study.py`:

- **On the published or scratch copy** (skipped without it), `/study?preset=10y-2sigma-20d` and
  `/study?preset=spx-2sigma-10y` serve the missing-session warning with
  `us10y <count> (includes N pre-1970 holidays the engine calendar treats as sessions)`.
  - The test computes N independently from `api/calendar.HOLIDAYS`, the study's sessions and
    DGS10's stored dates. It is 67 on the audit's copy, including the exclusion of 1969-02-21,
    where DGS10 has a value.
- **On a hermetic store** with a DGS10 span from 1968, the same disclosure appears, with N
  computed from its own holes.
- **What stays unqualified.**
  - The native `run()` warnings carry no qualifier, and `inputs_hash` is unchanged.
  - A study with no pre-1970 input (the gold preset) serves its warnings byte-identical to the
    engine's.
  - Without qualifiers, the adapter's rebuilt entry is byte-identical to the engine's string.

**Rules and new calculations, one small test each:**

- R1: the v1 table, including a zero delta and a missing horizon;
- R2: the templates, word for word with `fmt_move`, and a negative number printed with U+2212 (−), never a hyphen (spec §12.2 at `42298cb`);
- R4 against `_classify_prob`'s parity;
- R9: the run with a missing month;
- R11: the aliases;
- R11, a row with no horizons (S-31). On both `/study` and `/study/events`:
  - `preset=rsi-above-70` and `preset=rsi-below-30` are awaiting 200 with "RSI is not computed
    yet." and `until: null`;
  - the same presets with `horizon=20`, `horizon=5` or `horizon=abc` are 422 `unsupported`, and
    the message names `horizon`;
  - with `Accept: text/csv`, both answers are still the JSON envelope with their status codes;
- N2, short histories (round 5's R-13): stores holding 1, 30 and 199 sessions of ^GSPC history.
  - Every average whose window is longer than the history is null: `ma50` and `ma200` at 1 and 30
    sessions, and `ma200` at 199. `ma50` at 199 sessions has all 50 slots filled, so it is
    computed.
  - `ma50_window` and `ma200_window` carry real XNYS `start` and `end` dates from the extended
    calendar.
  - `n` counts the stored closes inside the slots: `ma50_window.n` is 1, 30 and 50, and
    `ma200_window.n` is 1, 30 and 199.
  - `trend.state` is `unavailable` wherever an average is null, and `trend.state_since` is the
    first stored close.
  - **Chart dates at one stored close (round 6's R-17).** The one-session store holds only
    2020-01-07.
    - Its 36-month range holds 754 XNYS sessions, 2017-01-09 to 2020-01-07. That is this plan's
      count with exchange_calendars 4.13.2; the count runs 750 to 759 by date, so the test pins
      its date.
    - `series.3y` has exactly 754 points, dated with the calendar's sessions in order.
    - Every `close` is null except the last, and every `ma50` and `ma200` is null.
    - `series.6m` has 128 points and `series.1y` 252, on the same rule.
    - The calendar opens on or before 2016-03-28, the first slot of the first chart point's
      200-session window.
  - No exception, and no wrapped index;
- N3: a null `chg_1d` over a missing close; the short-history case (R-08). A store of 200 ^GSPC sessions serves `ret_1y: null`, with `ret_1y_dates.from` a real XNYS session 252 sessions before `to`, resolved on the extended calendar, never a wrapped index;
- N5: the scoring index equals the served series;
- N6: an oracle. It uses the real classifier, `src.regime.compute_trends` and `classify_regime`,
  imported in the test with `FRED_API_KEY` set.
  - **The setup.** Each case appends one row for month m+1 to the joint frame and reclassifies.
    The other series' appended value keeps that axis's sign, so only the axis under test can move.
  - **The fixtures.** They cover both series (CPIAUCSL and INDPRO) and both starting states of the
    axis: rising, with operator `<=`, and falling, with operator `>`.
  - **"Unchanged".** The latest reference row's label: the label with neither axis flipped.
  - **Exact equality.** Append `x_prev` itself. The slope is exactly `0.0`: the three-point
    numerator is `−(y₀ − ȳ) + (y₂ − ȳ)` with `y₀ == y₂` bit for bit. So the axis classifies as
    falling, and equality belongs to the `<=` side:
    - for a rising axis, the label equals `flips_to`;
    - for a falling axis, the label is unchanged.

    This is the only exact assertion.
  - **Inverse reconstruction.** `x(m) · (1 + threshold_mom)` equals `x_prev` within a relative
    tolerance of `1e-12`. One division and one multiplication cost a few ulps, so this is never
    tested for equality and never used for the sign.
  - **Both sides of the operator, at a meaningful ε (R-09).** With ε a relative 1e-4:
    - **The side `operator` selects** is `x_prev · (1 − ε)` for `<=`, or `x_prev · (1 + ε)` for
      `>`. There the classifier's label must equal `flips_to`.
    - **The opposite side** is `x_prev · (1 + ε)` for `<=`, or `x_prev · (1 − ε)` for `>`. There
      the label must be unchanged.
    - **Why 1e-4.** It sits far above floating noise and above the print resolution of the levels
      (CPIAUCSL at 3 decimals is about 3e-6 relative, INDPRO at 4 decimals about 1e-6). It sits
      below a typical monthly move (about 1e-3).
- N8, the common-date alignment: on the audit's copy, `today.date` is 2026-09-22 and
  `month_ago.date` is 2026-08-21 (audit Q4).
- **N8, the null anchor (round 6's R-18).** A store whose DGS2 and DGS10 histories are disjoint,
  for example DGS2 through 2026-06-30 and DGS10 from 2026-07-01 through 2026-09-22:
  - `today.date` and `month_ago.date` are null;
  - `today.dates` gives 2026-06-30 for 2y and 2026-09-22 for 10y, each with its own value;
  - each `month_ago.dates` entry is that tenor's newest date at or before its own `today.dates`
    entry minus one calendar month: 2026-05-29 for 2y (2026-05-30 is a Saturday) and 2026-08-21
    for 10y;
  - `2s10s_bp`, `2s10s_chg_bp` and `10y_chg_bp` are null;
  - the three unstored tenors are null with null dates in both;
  - `today.dates` and `month_ago.dates` each have all five tenor keys on every path of both
    stores and of the audit's copy (R-19, R-20);
  - a second store shares 2026-09-22 across both tenors but has no common date a month earlier.
    There `month_ago` takes the per-tenor form, both changes are null, and `2s10s_bp` is served.

---

## 6. Spec errors found, with the exact wording fix

Each row names the spec place, what is wrong with its evidence, and replacement text for
`DESK_FRAME3_SPEC.md`. B builds the "Plan does" column.

**Rulings (2026-09-25).**

- The operator ruled eleven rows:
  - S-01 (two rulings: the full refresh, then the intraday runs);
  - S-04, S-10, S-12, S-21 and S-25;
  - S-28 and S-29, added in round 6;
  - S-30 (Codex's R-19, extended to today's curve by round 8's R-20), S-31 and S-32 (two
    operator rules), added in round 7.
- Their "Plan does" cells now say "ruled". The other 21 stand as written in "Plan does".
- **Status at `42298cb`: rows S-01 to S-27 are all folded into `DESK_FRAME3_SPEC.md`.** S-28 to
  S-32, added in rounds 6 and 7, are not yet folded there; they are session A's to fold. The
  folds are `ef3a338` (S-02 to S-27), `0d3996f` (S-01, S-12 and amendments) and `42298cb` (the
  `last_refresh_utc` erratum). This branch now sits on that commit. A one-phrase probe per row
  finds each fold in the spec. The table below is kept as the history of why each rule is there.
  Two folds read differently from the replacement wording here:
  - **S-06.** The spec defines an unlabeled event as one "whose K−2 month has no stored regimes
    row". That is broader than "before the first labelled month": it also covers a gap such as the
    missing 2025-10 row, and it is what the engine's `regime_at` does (`event_study.py:359–364`).
    The plan follows the spec (N7, §1.2).
  - **S-01.** The spec's text records the key "right after that check" with the WAL rule of round
    3. The plan's round-4 bracket (§1.9 part 2) is stricter and satisfies it: the bound key `k1`
    equals the key read right after the check, `k2`.
- **After `42298cb`.** `desk/frame-3` has since moved to `ee373dc` ("frame-3: codex-3 fixes").
  This branch is not rebased onto it. A probe of that commit's spec finds:
  - S-28 folded: §12.0 types `error` with `provider?` and `retryable?`, only on `schema_check`;
  - the 422 half of S-31 already implied: its R-27 wording refuses "a horizon outside the study's
    `allowed_horizons`", which for `[]` is any horizon. The awaiting half is not stated;
  - S-29, S-30 and S-32 not in it: the `month_ago` row and §6's curve card are unchanged, and
    §1.1 still puts the `generation_id` in every page footer.

| ID | Place | What is wrong | Replacement wording | Plan does |
|---|---|---|---|---|
| S-01 | §12.9 `validation` | Basis E "validate_db verdict as published" has no source the API can read. The verdict is written to `validation.json` (`refresh-data.yml:221`) and kept only in the 3-day `validated-db` run artifact (`:286–300`). The release gets the DB and `snapshot-latest.json` only (`:238–250`), and `api/bootstrap.py` downloads the DB asset alone (`:185–187`). `intraday-refresh.yml` also uploads the DB, every five minutes in the session (`:13`, `:89`), after its own `--mode intraday` validation (`:72`); its verdict is not published either. | "`validation` \| `"pass"` \| `"fail"` \| required, nullable \| S: the verdict of the `validation.json` published with the served database. Both writers publish it: `refresh-data.yml` and `intraday-refresh.yml`, each in the mode it validates in, as `{verdict, mode, timestamp, db_sha256}`, uploaded after the database. The API verifies `db_sha256` against the file, records the file's key right after that check, and serves the verdict only for the generation with that key; missing, mismatched or re-keyed → null (the UI prints "unknown")." | **ruled** (two rulings, Codex R-01, R-05, R-07). Each workflow runs a separate validation step after the database upload, bounded at one minute, whose failure blocks nothing. Bootstrap records `(verdict, mode, timestamp, validated_key)` in memory only through the bracketed binding: `file_key`, WAL empty, hash, `file_key` again, and bind exactly the first key when both keys match and the WAL is still empty (rounds 3 and 4), re-fetches on each poll while nothing matches, and `/pipeline` reads it per request behind the key gate, which relies on hardening's every-build key stability (round 4's R-11) (§1.9, §7 commit 10) |
| S-02 | §12.9 `…series[].feeds` | Basis E, but no function lists Desk tabs per series. `api/desk.py:335–361` `FEEDS` names main-app readers. | "`…series[].feeds` \| … \| A: the Desk tabs that read the series, a fixed table in the adapter (the inventory's `FEEDS` names main-app readers)." | A table |
| S-03 | §12.9 `…series[].first, last` | For a FRED daily series stored month-stamped in `raw_series` (IG, BB, B, CCC), the "last stored row" is a month stamp. CLAUDE.md B6 records the error it caused. | "S: the first and last stored observation; for a FRED daily series stored month-stamped in `raw_series`, `last` is its `source_watermarks` `last_obs` and `first` its first month stamp." | as the fix |
| S-04 | §12.9 `/pipeline/ddl` | "the CREATE statements of the proposed export schema" has no source. The only text is A's fixture `web/src/fixtures/desk/pipeline-ddl.ts`. | "`/pipeline/ddl` answers `text/plain; charset=utf-8`: the contents of `api/static/snowflake_proposed.sql`, the one copy of the proposed Snowflake export schema (not the current SQLite layout; the file says so in its first line), served verbatim by the route and read by the fixture." | **ruled**: the static file `api/static/snowflake_proposed.sql`. It ships in the image through the existing `COPY api/ api/` (`Dockerfile:36`), with no new COPY, and is served by `/pipeline/ddl`, labeled proposed. A's fixture is generated from it by `web/scripts/gen-ddl-fixture.mjs`, with a byte-for-byte test; there is no `.sql` import in `web/`, and `vite.config.ts` is not touched for it (R-02, §1.9) |
| S-05 | §12.2 `last_events[].entry_date`; §12.4 `events[].entry_date` | Marked required and non-null. But an event on the last stored session whose entry is the next session has no entry: `has_entry` is false (`event_study.py:1030–1037`), counted in `n_no_entry` (`:1125`). | "`entry_date` \| date \| required, nullable (null when the entry session is after the stored data) \| …" in both tables. | nullable |
| S-06 | §12.2 `last_events[].regime`; §12.4 `events[].regime` | The enum lists `"Unlabeled"`, which a retained event cannot carry: the evaluable mask requires the lagged label (`event_study.py:1008`, `:1018`). Unlabeled events are counted separately (`:1017`, `:1124`). | "`regime` \| regime label \| … a retained event always carries its K−2 label; events before the first labelled month are counted in `unlabeled_n` and not listed." | labels only |
| S-07 | §12.2 `horizons[].reason` | Only one engine note is given words. Two others contain the banned word "established" (spec §1.5, §13.3), from `event_study.py:687` and `:690`. | "`horizons[].reason` \| … \| A: the engine's `note` in these words: `insufficient data` → "no completed outcomes at this horizon"; `too few blocks for an interval (B < 5)` → "fewer than five independent blocks"; `too few independent blocks to judge exclusion` → "fewer than ten independent blocks; the interval is shown but not judged"; `exclusion not established` → "the interval clears zero but 3% or more of resampled medians are adverse"; none → null." | these words |
| S-08 | §12.2 templates | "numbers printed by §1.9", but §1.9 puts the one rounding rule in the UI kit, and the server must print numbers into `headline`/`why`/`summary`. | "Numbers in served templates are printed by the engine's `fmt_move` (`src/desk/event_study.py:768`): a log unit as `±x.x%` of 100 × native, a bp unit as `±x bp`; a share as a percent with one decimal." | `fmt_move` |
| S-09 | §12.2 `horizons[].worst, best` | Ties are not specified. | "…min and max over the `n` completed outcomes, the earliest event on ties." | earliest |
| S-10 | §12.0 "Names" paragraph vs §12.2 table | The paragraph puts the pair `comparison_session` and `prev_session` "on `/study`", but §12.2 lists only `comparison_session`. | Add the row "`prev_session` \| date \| required \| — \| XNYS \| N firing state: as §12.1" to §12.2. | **ruled**: the row is added to §12.2, and `/study` serves `prev_session` (§1.2), recomputed per response (§0.5) |
| S-11 | §12.0 envelope, `generation_id` | "null only while awaiting before a generation exists." But `awaiting` renders the unavailable state and is never retried (`web/src/screens/desk/data/api.ts:224`), so a page opened while the server warms would stay unavailable. | "`generation_id` \| … \| required, nullable \| null only before a generation exists: the answer is then `computing` (202, `Retry-After: 2`) while the server builds its first generation, and `as_of` is null too." | 202 |
| S-12 | §12.8 `rank_window` / v4 B-07 "expected bond-calendar session" | The named bond calendar (`api/calendar.py:125`) has holiday tables for 2024–2027 only (`:17–22`, "a missing year degrades to weekends-only"). Today's window starts 2023-09-23, and HY has no value on 2023-12-25, so that date would count as missing and `hy_pct_3y` would stay null for a calendar gap until 2026-12-25. HY also has 12 weekend month-end observations and values on NYSE holidays (this plan's query of the audit's copy). | "Expected sessions are the XNYS sessions of the engine's calendar (`exchange_calendars`) in the window, minus `api/calendar.bond_extra_closures`; `valid_n` counts every finite stored observation dated in the window (weekend month-end prints included); `n = valid_n`." | **ruled**: the calendar rule, **and** B adds the missing holidays to `api/calendar.py` for every year the store covers. They are generated from `exchange_calendars`' bounded `regular_holidays` plus `adhoc_holidays`, never weekdays minus sessions (R-03). Tests: each stored year has a list, the lists match the bounded definitions, known dates are asserted independently, and parity with `session.py` holds. Parity with `exchange_calendars` sessions is asserted from 1970-01-01 only; before that the tables are the authority (Codex round 3; N7, §5, §7 commit 2a, §8) |
| S-13 | §12.6 `threshold_mom`, `flips_to`, `reference_month` | "for latest observed month m, x(m+1) = x(m−1)" ignores two facts. The classifier's slope runs over the rows of the joint INDPRO/CPI frame (`src/regime.py:151–154`), so the row before m is not always m−1 (2025-10 is missing, audit §1). And the formula holds only for `ROLLING_WINDOW = 3` (`src/config.py:33`). The case where one series has already printed m+1 is undefined. | "m is the month of the latest stored regimes row; x_prev is the series' value on the joint INDPRO–CPIAUCSL row before m; `threshold_mom = x_prev / x(m) − 1` (valid for the three-month window only); `threshold_mom` and `flips_to` are null when the series already has a value for m+1." | as the fix |
| S-14 | §12.1 / §12.6 `months_in`, `since` | "the run of equal stored labels ending at `print`" leaves open whether a missing month (2025-10, audit Q10) bridges the run. | "…the run of equal labels in consecutive stored months ending at `print`; a missing month ends the run." | ends the run |
| S-15 | §12.7 `series.6m`, `.1y`, `.3y` | No window lengths. | "…the XNYS sessions after `date` − 6, 12 and 36 calendar months, through `date`; a missing close is a point with `close: null`." | as the fix |
| S-16 | §12.3 `allowed_horizons` | Specified for available rows only. | "…[5, 10, 20, 60] for every row with a question, available or not; [] for the RSI rows." | as the fix |
| S-17 | §12.3 and §1.0 served reasons | RSI's reason in §1.0 cites code paths and "v3 A-16", unfit to print. `/positions`, `/basket/:id`, `/basket/price` and `/hedge` have no served sentence. | Add: "RSI rows: `unavailable.reason` "RSI is not computed yet."; `/positions`: "Positions are kept in this browser; there is no server position store."; `/basket/:id`, `/basket/price`, `/hedge`: "basket pricing and option structures not yet defined in the engine."" | these sentences |
| S-18 | §12.1 `active_signals` | "every row with `firing_now` true" includes stale rows, which §8 excludes from FIRING NOW and v3 §3 forbids calling firing. | "…the deduplicated union of every row with `firing_now` true and `stale` false and the five rows…" | as the fix |
| S-19 | §12.5 `signals[].stale` | Required boolean "`evaluated_on` is not `comparison_session`". For an unavailable row `evaluated_on` is null, so the literal reading marks it stale. | "…false for an unavailable row." | false |
| S-20 | §12.2 parameters | No default for `while`; `window` is not stated as required for a shock move; the v3 §2 aliases are not said to apply to `preset`. | "`while` defaults to `none`; `window` is required for `up2s`/`down2s` and refused for a cross; `preset` also accepts an engine slug that parses to a catalog study's query." | as the fix |
| S-21 | §12.0 `engine_version`, `as_of` | `engine_version` has no named source; no engine version string exists. `as_of` ("the calculation's date") is ambiguous for responses that compute per request. | "`engine_version`: the git commit sha of the running build, injected at image build as `ENGINE_VERSION` (`ARG`/`ENV`) and read from the environment: `ENGINE_VERSION`, else the host's `RENDER_GIT_COMMIT`; `"unknown"` when neither is set. `as_of`: the New York date the generation was staged; per-request anchors (`comparison_session`) are served in the payload." | **ruled**: `ENGINE_VERSION` (injected at build), else `RENDER_GIT_COMMIT`, else `"unknown"` (§1.0, §8 Dockerfile row) |
| S-22 | §12.8 `credit.data.hy, .ig` basis | "(`desk_series`; IG's date from `source_watermarks`)". IG (BAMLC0A0CM) is not in `desk_series`; it is month-stamped in `raw_series` (audit §1). | "E: HY the newest `desk_series` observation; IG `source_watermarks` `fred:BAMLC0A0CM` (`last_obs`, `last_value`)." | as the fix |
| S-23 | §12.1 `…contributors[].state` for ^GSPC and GC=F | "stale or delayed past its window → stale" leaves `delayed` inside the window (the 06:00 UTC grace, `api/freshness.py:254–256`, `:272`) implicit. | "…`current` and `delayed` within the grace → `current`; `stale` → `stale`; absent → `missing`." | as the fix |
| S-24 | §12.8 `curve.data.today` | "`date` shared, or null with per-tenor `dates`" gives no alignment rule. | "`today.date` is the latest date on which every stored tenor has a value; `dates` names it per tenor (null for a tenor not stored); when no such date exists, `date` is null and each tenor its own newest." | as the fix |
| S-25 | §13.1 step 2 / v3 §20 | Putting `/study`, `/study/events` and `/study/catalog` on the study ceiling makes pure lookups (every catalog study is a worker item) queue behind visitors' free-form studies. That is the V-13 defect (`api/security.py:45–48`, `tests/test_desk_api.py:774`). | "…added to the middleware's study path list in the same commit that adds the routes; a request of only `preset=<catalog slug>` (with an optional `horizon`), and a bare `/study/catalog`, is a lookup and reads under the stored-read ceiling, as `?study=<preset>` does." | **ruled**: the `_preset_lookup` extension ships, and it is not optional (§4.3) |
| S-26 | §12.0 "every JSON route above" | Refusals made before routing (413 and 429 from `api/security.py:361`, `:373`, `:411`) carry `{detail}`, not the envelope. | "Refusals made before the route runs (413, 429 from `api/security.py`) keep the middleware's `{detail}` body." | as the fix |
| S-27 | §1.7 / §12.0 blocks | A block whose computation failed ("Awaiting refresh", §1.7) has no envelope. A block is only `ready` or `awaiting`, and `awaiting` needs a reason. | "A block that could not be computed from the current generation is `awaiting` with reason "Awaiting refresh: this could not be computed from the current data."" | as the fix |
| S-28 | §12.0 envelope, `error` | Added in round 6 (R-16). §12.0 types `error` as `{code: string, message: string}`, but the hardening 503 on the enveloped routes carries `provider: "api"` and `retryable: true` inside `error` (§3). The frame-3 client already accepts extra keys (`web/src/screens/desk/data/envelope.ts:27`), but the contract does not name them. | In §12.0's envelope table: "`error` \| `{code: string, message: string}`, plus exactly `provider: "api"` and `retryable: true` when `code` is `"schema_check"` \| required, nullable \| non-null only when `status` is `error`; no other code carries an extra key." | **ruled** (round 6's R-16): B serves it, and the contract helper allows exactly those two keys on `schema_check`. **For session A:** fold this into spec §12.0. It is not folded at `42298cb`; `ee373dc` folds it (§6 preamble, "After `42298cb`") |
| S-29 | §12.8 `curve.data.month_ago` and the three differences | Added in round 6 (R-18). The `today` row allows a null `date` with per-tenor `dates`, but `month_ago`'s source, "the last observation on or before `today.date` − 1 calendar month", has no anchor then, and the difference rows do not say they are null then. | `curve.data.month_ago`: "same shape; the last common observation on or before `today.date` − 1 calendar month. When `today.date` is null, `date` is null and each tenor carries its newest observation on or before its own `today.dates` entry − 1 calendar month; with a common `today.date` but no common date a month earlier, `date` is null and each tenor carries its newest observation on or before `today.date` − 1 calendar month." `2s10s_bp`, `2s10s_chg_bp`, `10y_chg_bp`: "…null whenever a date it needs, `today.date` or `month_ago.date`, is null." | **ruled** (round 6's R-18) for a null `today.date`; the case of a common `today.date` with no common date a month earlier is this plan's closure of the same gap (N8). **For session A:** fold this into spec §12.8, with S-28 |
| S-30 | §6 Macro & Correlations, the Yield curve card; §12.8 `curve.data.today` and `curve.data.month_ago` | Added in round 7 (Codex's R-19), extended to today's curve in round 8 (R-20). The card draws "today (blue solid) and a month ago (gray dashed)" as two curves and says only that "the chart labels the mismatch". With a null snapshot date (S-29), that snapshot's points sit on different dates, and a line through them presents them as one curve on one date. `today.date` can be null (§12.8), and `month_ago.date` can be null on its own when `today.date` is common. | §12.8 `curve.data.today.dates` and `curve.data.month_ago.dates`: "object, tenor → date; required on every path: the common date, or each tenor's own date when that snapshot's `date` is null; null for a tenor not served." §6, after the chart sentence: "Each snapshot is checked on its own date. When `today.date` is null, today's tenors are drawn as separate points, each labelled with its tenor and date, with no line joining them, and their dates (`today.dates`) are listed under the chart. When `month_ago.date` is null, the month-ago tenors are drawn and listed the same way from `month_ago.dates`. A snapshot with a date is drawn as one curve." | **ruled** (round 7's R-19, round 8's R-20). B serves both `dates` objects on every path (N8). **A session-A prerequisite** before the page reads a live `/macro`, with a regression test over both snapshots and independent date checks: (1) both dates null with disjoint per-tenor dates: both snapshots render as labelled points with no connecting line, and both sets of dates are listed under the chart; (2) `today.date` common and `month_ago.date` null: today is one curve, and the month-ago tenors are labelled points with no line, with their dates listed under the chart; (3) both dates common: two curves. Listing a snapshot's dates when its `date` is common is allowed, never required |
| S-31 | §12.2 parameters; §12.3 `allowed_horizons` | Added in round 7 (operator rule). The spec gives the RSI rows `allowed_horizons: []` and a reason, but it does not say what a preset request for one answers, with or without `horizon`. `horizon` defaults to 20, which the row does not allow. | §12.2, after the parameter rules: "A preset for a row whose `allowed_horizons` is `[]` (the RSI rows) is awaiting, with the row's served reason, when the request carries no `horizon`; with any `horizon` parameter it is refused 422 `unsupported`, the message naming `horizon`. The default horizon is never applied to such a row. `/study/events` follows the same rule." | **ruled** (operator rule): R11 and the error map (§3); tests in §5 |
| S-32 | §1.1 page footer; §11 Client view | Added in round 7 (operator rule). §1.1 puts the page's shared `generation_id` in every footer. The Client view is the client-safe page ("no jargon", §11), and a generation id is an engineering term. | §11 Client view: "The footer prints `Snapshot · <as_of>` and no generation id, and it is hidden in print. The mixed-generation check of §1.1 still runs on the Client view." §1.1: "…the page footer shows the one `generation_id` the page's responses share (the Client view prints `Snapshot · <as_of>` instead, §11)." | **ruled** (operator rule). Session A's: B already serves `as_of` on every envelope (§1.0), so nothing for B to build |

**Not spec errors, recorded for the operator.**

1. **Fixture drift: resolved at `42298cb`.** Session A's alignment commits (`1591bff` "align 12
   fixtures" and those around it) brought the fixtures under `web/src/fixtures/desk/` to the §12
   shapes. A spot-check on this rebased tree finds every example below fixed: the old keys are
   gone, and `value`/`event_date`, `value_20`, `exit_/value_/complete_<h>`, `release_date`,
   `threshold_mom`, `chg_1d_dates`, `ma50_window`, `first`/`last`/`key`/`provider` and
   `client_label` are present. B's strict contract tests can therefore run over A's fixtures as a
   cross-check. The original list, kept for the record:
   - `study.json`: `horizons[].best.{date,ret}` where §12.2 has `{value,event_date,entry_date}`;
     `last_events[].ret_20`; no `n_incomplete`, `baseline_n`, `series[].ops`, `stale`;
   - `study-events.json`: `events[].ret_<h>` where §12.4 has `exit_/value_/complete_<h>`;
   - `overview.json`: `tiles.trend.since_signal`, and `monitored[]` although positions are
     browser-side;
   - `regime.json`: `next_prints.<k>.date` and `flip_threshold_mom`;
   - `technicals.json`: `instrument` and `move_20d_word`, and no `*_dates` or `*_window`;
   - `macro.json`: `credit.words`, which v3 A-14 forbids without a formula;
   - `pipeline.json`: `series[].from`/`as_of`, where §12.9 has `first`/`last` and also `key`,
     `provider`, `freq`.

   `tests/desk_contract.py` can validate the fixtures directly (a pytest over
   `web/src/fixtures/desk/*.json`, each wrapped by its route's envelope).
2. **The tier of the three tenors.** Audit §5 proposed tier 2 under hardening's `REFRESH_TIER = 2`.
   The spec says tier 1, which is what the current refresh stores. There is no conflict; the
   consequence is noted in §4.5.

---

## 7. Build order, estimates and commit boundaries

B1 and B2 follow spec §13.1's order. Each commit carries its fixture-shape test, runs the
regression gate when `src/desk/` changed, and runs the full Python gate. The gate is the
Makefile's `test` target, with `web/dist` present and the scratch and published copies in
`data/`, per the hardening report's gate notes.

**Before commit 1.** Hardening merges to `main`. B's branch starts from that commit, and the §2
golden is built there, with the base engine from a `git worktree add` of it and both pins. It is
committed with commit 2. About 0.5 h, counted in commit 2.

**B1, which merges alone.** It leaves the Desk's other routes 404, which the client renders as
"Awaiting refresh" (spec §1.7).

| # | Commit | Contents | Estimate |
|---|---|---|---|
| 1 | `desk-v2: envelope, error map, deferred stubs and the image's ENGINE_VERSION` | `api/desk_envelope.py` (`engine_version`: `ENGINE_VERSION`, else `RENDER_GIT_COMMIT`, else `"unknown"`, S-21); `api/desk_v2.py` skeleton; six GET stubs; the enveloped 405; `tests/desk_contract.py`, strict except `provider` and `retryable` on a `schema_check` error (round 6's R-16); the envelope, TS-parity, stub and `engine_version` tests. The image lines are S-21's only: `ARG`/`ENV ENGINE_VERSION` in the Python stage and the build comment's `--build-arg` (§8 Dockerfile row). The R-15 Build Notes lines are **not** in this commit: they are already on `desk/deploy-prep` (added in `620cf1f`, contained in `db042f4`) | 3.25 h |
| 2 | `desk: engine trace (event table, signal trace); native results unchanged` | `trigger_mask`; `_run(trace=)`; `run_on_traced`/`run_traced` (with `as_of`); `EventTable`/`SignalTrace`; the golden script and the golden built before commit 1; regression layers 1–2 (layer 1 with the typed `NotStored` for wti and dxy); the A/B script run on the published copy (its output in the commit message) | 4.5 h |
| 2a | `api: NYSE holiday tables for every stored year (S-12)` | S-12 (ruled): the NYSE holiday lists for every year the store covers, 1962–2023 added. They are generated once by `scripts/gen_nyse_holidays.py` from `exchange_calendars`' bounded `regular_holidays` plus `adhoc_holidays` (R-03) into `api/calendar.py` and the `src/market_data/session.py` copy. The pre-1978 `bond_extra_closures` check against stored DGS10 days. Tests: coverage, bounded definitions, known dates, `session.py` parity, and parity against `exchange_calendars` sessions from 1970-01-01 only (R-03, §5). It is in B1 because commit 3's warning disclosure (R-10) computes N from these tables, so B1 merged alone already serves the disclosed warning | 2 h |
| 3 | `desk-v2: catalog, aliases, precompute, the study ceiling, /study and /study/catalog (A-17)` | `api/desk_catalog.py` (with the 13 `client_label` titles, round 5's R-12, and `client.headline` from them); the `desk_study:*` ITEMS; `api/security.py` paths and slugs, and the S-25 `_preset_lookup` extension (ruled, required); R1, R2, R3, R11–R15 (R11 with S-31's RSI horizon rule and its tests); N1 (with `prev_session` on `/study`, S-10); `/study` and `/study/catalog`; the served warning's pre-1970 disclosure (R-10; the builder's `pre1970` counts, from commit 2a's tables) and its tests; the build-time measurement | 6.5 h |
| 4 | `desk-v2: /study/events and its CSV` | the route, its `DESK_STUDY_PATHS` entry, the CSV, the projection parity tests, S-31's tests on `/study/events` | 2 h |
| 5 | `desk-v2: /ledger` | R6/R7, the Ledger projection, the firing tests (B-05), the projection-memo tests (§5) | 3 h |
| | **B1 total** | | **21.25 h** |

**B2**

| # | Commit | Contents | Estimate |
|---|---|---|---|
| 6 | `desk-v2: /technicals` | the `desk_technicals` item (N2–N4, on one XNYS calendar that holds, before the first stored close, the larger of 252 sessions and the 36-month chart range plus 200 sessions (round 6's R-17); it serves `ret_1y`'s `from` (R-08), both moving-average windows (round 5's R-13) and every chart date); the route; the short-history tests at 1, 30, 199 and 200 sessions, and the chart dates at one stored close (754 points) | 4 h |
| 7 | `desk-v2: /regime` | `recession_provenance()` (N5), its connection closed in a `finally`; N6 with its AST mirrors; the `desk_regime` item (stored rows, thresholds); R4, R8, R9; the route; the N5/N6 oracle tests | 5 h |
| 8 | `desk-v2: /macro and the three FRED tenors` | the three registry rows, the freshness mirror, the `REFRESH_IDS` update, the store test; the `desk_macro` item (N7, N8; N7's expected sessions use the engine's calendar, and its three-year window never reaches the pre-1970 years; N8's null-anchor tests, round 6's R-18, and `today.dates` and `month_ago.dates` on every path, rounds 7 and 8's R-19 and R-20); R5 with the constant `band_edges` (round 6's R-14); the route; one scratch store run with a FRED key to confirm the declared starts. The holiday tables moved to commit 2a | 5 h |
| 9 | `desk-v2: /overview` | the composition; N9, N10; the `desk_facts` item (newest dates and values per contributor, the last VIX rows); the freshness tests (B-06) | 4 h |
| 10 | `desk-v2: /pipeline, /pipeline/ddl and the published validation verdict` | the row set, each row's `provider` from its registry source declaration and `test_pipeline_providers` (round 6's R-15); the groups; S-02 and S-03 as "Plan does". S-04 (ruled, R-02): `api/static/snowflake_proposed.sql`, moved from A's fixture text with its "PROPOSED" first line, served by `/pipeline/ddl`; the pytest that no `.sql` is imported under `web/`. A's generator, `web/scripts/gen-ddl-fixture.mjs`, and its byte test are A's, noted in §1.9. S-01 (ruled, R-01, R-05, R-07): in both writers, a separate validation step after the database publish step (`refresh-data.yml:238–250`, `intraday-refresh.yml:81–90`) writes and uploads `publish/validation.json` `{verdict, mode, timestamp, db_sha256}`, with `timeout-minutes: 1` and `continue-on-error: true`. `refresh_db` (`api/bootstrap.py:154–233`) binds through the bracket (`file_key`, WAL empty, hash, `file_key` again, bind the first key; rounds 3 and 4), holds the state in memory, and re-fetches on each poll while nothing matches. `/pipeline` reads it per request behind the key gate. Tests: bootstrap (match, mismatch, the missed-upload repro, restart), the key gate with the WAL-commit repro, Codex's round-3 repro, a commit at each boundary of the bracket, and the worker interleaving that pins hardening's key stability (R-11), and the workflows (§5) | 6 h |
| 11 | `docs: CLAUDE.md and the B report` | the FastAPI/Desk sections; the GitHub Actions section (the separate, non-blocking `validation.json` step in both writers); the new gotchas (§8), including "a local commit to the served file drops `validation` to unknown until the next upload"; the A/B result | 1 h |
| | **B2 total** | | **25 h** |

§6 is settled. S-01, S-04, S-10, S-12, S-21, S-25 and S-28 to S-32 are ruled, and the other 21
are built as "Plan does". B still lists every "Plan does" choice in its report. The spec fold of
the ruled wording (§6 preamble) comes before commit 1. S-28 to S-32 are session A's to fold, and
S-30's rendering and S-32's footer are session A's to build.

---

## 8. Merge-conflict watch: files this plan and `desk/hardening` both touch

This compares hardening with the edits of §4 and §7. The hardening side is: committed
`a57f9bf..cc721f0`, the staged index (round 18), and the unstaged round-19 edits, as read on
2026-09-25 (§ Inputs). Two notes before the table:

- B's new modules (`api/desk_catalog.py`, `api/desk_envelope.py`, `api/desk_v2.py`,
  `api/desk_items.py`, and the new tests and scripts) touch nothing hardening touches.
- Hardening functions are named without line numbers: they are not in this tree.
- One row also records another branch: the `Dockerfile` row notes `desk/deploy-prep`'s edit (`620cf1f`, contained in `db042f4`), which carries frame-3's R-15 lines.

| File | Hardening changes | This plan changes | Risk and resolution |
|---|---|---|---|
| `src/desk/event_study.py` | `_run` (12 hunks: an `as_of` keyword; `load_level(…, as_of)`; `entry_delay_vec` replacing `same_session_vec` inside `entries_for`; the exclusion counts; provenance `as_of_cutoff`); `run`/`run_on` gain `as_of`; `resolve_as_of`, `load_level`, `_inputs_hash` (four optional exclusion arguments), `clock_for`, `when_vec`, `same_session_vec`, `assets_with_coverage`, `not_stored` | `detect_events` (`trigger_mask`), `_run` (a `trace` keyword and one block after `:1070`), new `run_on_traced`/`run_traced` beside `run`/`run_on` | **High.** Resolution: <ul><li>The traced entry points take `as_of` and pass it through.</li><li>The trace block reads `entry`, the same-session flag and `ev_delay`. Hardening computes all three from its delay array (`entries_for` returns `pos + delay`), so on the merged base the trace keeps `ev_delay` as `EventTable.entry_delay` (R-04, §2).</li><li>**On hashes:** hardening's `_inputs_hash` adds `future_excluded`, `non_numeric_excluded`, `malformed_date_excluded` and `no_provenance_excluded` to the payload only when they are non-zero ("absent when none, so a clean store hashes as before"). So a native hash changes only for a study whose inputs have rows those rules exclude. Its report's clean-store comparison kept 15 of 17 studies byte-identical; the two WTI studies differ.</li><li>B's golden is built at `main` after the merge, with `as_of` pinned (§2). No hardening change can then show up as a B regression.</li></ul> |
| `src/desk/series.py` | `SERIES` (HY start 2023-09-25, USD/JPY 20:00 timing, WTI note); `REFRESH_TIER = 2`; module docstring | three tenor rows after `hy_oas` (`:126`) | **Medium.** Adjacent to hardening's HY row edit. With `REFRESH_TIER = 2`, `wti`/`dxy` become stored: three catalog studies turn available and the Ledger's `scored_n` rises (v4 B-02 expects it). |
| `api/freshness.py` | `DESK_REFRESH_SERIES` (tier-2 rows, `tier` fields), `DESK_SLOW_PUBLICATION`, `desk_series_states` (tier and tolerance logic, 4 hunks), `assess` (2 hunks), `fred_series_state` | `DESK_REFRESH_SERIES`: three tenor rows | **Medium** textual conflict in one dict. N9 calls `desk_series_states` with specs from `api/desk.desk_series_specs`, which hardening updates to carry `tier` and tolerance, so the call stays compatible. The mirror test must hold after both. |
| `api/main.py` | imports (`desk as desk_mod`, `provenance`) near `:37–40`; the new `_schema_check_failed` handler after `_not_stored` (`:221–228`); V-53: the five response models type their freshness block `dict[str, Any]`, and `_freshness_block`/`_series_states` serve an awaiting block when the check cannot run | `include_router(desk_v2_router)` after `:1621`; the enveloped 405 handler near the handlers | **Low to medium.** Adjacent hunks. The merge must scope `_schema_check_failed` to defer on `ENVELOPED_ROUTES` (§3). |
| `api/desk.py` | `_compute`, `_submit`, `study_result`, `desk_event_study` (cutoff-keyed cache, schema error); `schema_error_body`/`_schema_error`; `desk_series_specs` (`tier`, tolerance) | **none**; the plan only calls `desk_series_specs` and the `es` proxy (`:75–101`) | **Low.** Behaviour only: `desk_series_specs` output gains keys. |
| `api/db.py` | **Thread ownership (V-51).** Each thread's connection now lives in `_ThreadConnection`, a context manager held only by its thread's locals, which closes the connection at thread exit, in that thread (`_slot`). `_connect`, `_drop_local` and `reset_connections_for_tests` are rewritten around it. Also: `_desk_as_of`; `_freshness_uncached` (provenance-aware `desk_series_latest`, may raise `SchemaCheckFailed`); `_FRESHNESS_MEMO_SLOTS` | **none**; the plan calls `db.freshness()` (`:670`), `db.watermarks()` (`:649`), `db.regime_history()` (`:386`) and `db.event_calendar()` (`:563`) | **Low.** Behaviour: N9 inherits hardening's filtering and its 503 (§3). B keeps no per-thread connection of its own: a read that should reuse its thread's connection goes through these `api/db` functions, which own it. |
| `src/analytics/dbpath.py` | **Authorizer removal (V-51, decision 32).** `open_generation` no longer calls `set_authorizer`. The copy is read-only by the connection's own mode: `PRAGMA query_only = 1` and `setlimit(SQLITE_LIMIT_ATTACHED, 0)`. `read_only_authorizer` is kept for connections to the file only, and there is a new `is_copy(conn)` | **none**; B calls `connect_ro` (`:181–193`) and `open_generation` (`:152–169`) | **None textually.** The rule B keeps on the merged base: **no Python authorizer, progress handler or trace callback on any connection to a generation's copy.** |
| `src/analytics/recession.py` | **Round 19, V-54 (unstaged, in progress).** `train_recession_model`, `_load_curve_shape` and `get_recession_metrics` now close their connection in a `finally` on every path. Hardening's static test `test_every_builder_closes_its_connection_on_every_path` checks it | the new `recession_provenance()` (N5), after `get_recession_metrics` (`:222–371`) | **Medium** (adjacent hunks). Resolution: <ul><li>Keep hardening's `try`/`finally` in all three functions as it lands.</li><li>The new function opens through `_get_conn()` (`:35–41`) and closes in its own `finally`.</li><li>It adds no other edit to the module.</li><li>The static test must pass with it.</li></ul> |
| `api/worker.py` | `Generation.as_of`, the rebuild schedule (R-01), `_stage` (migration on the copy), `_build(rebuild=)` | **none**; the plan reads `gen.id`, `gen.key`, `gen.source` and `gen.staged_at` | **Low.** After the merge, the envelope's `as_of` switches to `gen.as_of` (same value). **Dependency (round 4's R-11):** B's validation key gate relies on hardening's every-build key stability. Today only a rebuild re-reads `dbpath.file_key` after its copy (V-03 in hardening's `_build`); the operator reports the extension to every build in progress. §5's worker-interleaving test fails until it lands. |
| `api/bootstrap.py` | **none** (in neither its staged nor its unstaged files) | `refresh_db` (`:154–233`): <ul><li>the bracketed binding (§1.9 part 2): read `file_key`, require the WAL absent or empty (at a download, `<DB_PATH>-wal` too), hash, read `file_key` again, and bind exactly the first key only when both keys match and the WAL is still empty (rounds 3 and 4);</li><li>it holds `(verdict, mode, timestamp, validated_key)` and the verified sha in memory;</li><li>on every poll (`periodic_refresh`, `:259–271`), even with an unchanged database (`:196–200`), it re-fetches `validation.json` while nothing held matches the current asset (S-01; R-01, R-05);</li><li>a read accessor for `/pipeline`.</li></ul> | **None textually.** Listed because B now edits it. `tests/test_bootstrap_identity.py` covers it. |
| `scripts/validate_db.py` | `inspect`, `validate` (13 hunks), `_ai_spend`, `FINGERPRINT_SQL`, `MODE_TABLES`, and round-19 edits in progress | **none**; S-01's sha is written by the workflow, not by the validator | **None textually.** Behaviour: the tenors enter the judged `desk_series` set through the mirror; re-run hardening's validate tests after the merge. |
| `tests/test_desk_api.py` | the `ROUTES` hand inventory of every operation (R-03) and its sweep; V-51/V-54 tests; many new tests | `REFRESH_IDS` (`:412`); new v2 route tests (a separate module preferred) | **Medium.** After the merge, hardening's `ROUTES` must list B's **16** new GET paths, or its inventory test fails in both directions. Their before-refresh status is 200 (ready or awaiting; `/pipeline/ddl` as `text/plain`): <ul><li>the nine live routes: `/overview`, `/study`, `/study/catalog`, `/study/events`, `/ledger`, `/regime`, `/technicals`, `/macro`, `/pipeline`;</li><li>`/pipeline/ddl`;</li><li>the six stubs: `/sectors`, `/vol`, `/positions`, `/basket/{id}`, `/basket/price`, `/hedge`.</li></ul> |
| `tests/test_event_study.py` | many new tests; the frozen-entries fixture `tests/fixtures/desk_entries_cc721f0.json` | none if B's regression tests live in `tests/test_desk_native_regression.py` | **Low.** Keep B's tests in their own module. |
| `tests/test_desk_history.py` | heavy (provenance, quarantine, repair) | the tenor store test | **Medium.** Add it in a separate function at the end of the file. |
| `.github/workflows/refresh-data.yml` | the Desk store step runs `desk_history --tier 2` (`:137`) | a **new step** after the publish step (`:238–250`), under its condition. It writes and uploads `publish/validation.json` `{verdict, mode, timestamp, db_sha256}`, with `timeout-minutes: 1` and `continue-on-error: true`; the publish step itself is unchanged (S-01, R-07) | **Low.** A different step from hardening's; `tests/test_workflows.py` checks both after the merge. |
| `.github/workflows/intraday-refresh.yml` | **none** (hardening's only workflow change is `refresh-data.yml`, checked against its committed, staged and unstaged diffs) | the same **new step** after the publish step (`:81–90`), from the `--mode intraday` report the validator already writes (`:72`); one-minute timeout, `continue-on-error`, and no mode switch (S-01, R-07) | **None textually.** Listed because B now edits it. |
| `api/calendar.py` | **none** (checked against its committed, staged and unstaged diffs) | `HOLIDAYS` (`:17–22`) gains the NYSE holiday lists for 1962–2023, so every year the store covers has one; `bond_extra_closures` (`:109–122`) gains the pre-1978 federal dates where the stored DGS10 days confirm them (S-12, ruled) | **None textually.** Listed because B now edits it. `api/freshness.py`, which hardening edits, reads these functions unchanged. **A semantic discrepancy with the engine's calendar before 1970 (below):** the tables are the authority there, and parity with `exchange_calendars` is asserted from 1970-01-01 only (R-03). |
| `src/market_data/session.py` | **none** | the same `HOLIDAYS` years (`:23–28`), kept equal to `api/calendar.py` by `tests/test_market_session.py:36` | **None textually.** The copy exists because `src/` may not import `api/calendar.py` on the lean market install (`tests/test_market_session.py:8`). |
| `Dockerfile` | **none** in hardening. **`desk/deploy-prep` does edit it:** `620cf1f` (contained in `db042f4`) adds the R-15 Build Notes lines to the web stage and `.dockerignore`, and moves `FROM python:3.13-slim` from line 21 here to line 26 there | **The Dockerfile note.** <ul><li>S-21 only: `ARG ENGINE_VERSION=unknown` and `ENV ENGINE_VERSION=${ENGINE_VERSION}` right after `FROM python:3.13-slim` (`Dockerfile:21` in this tree).</li><li>The build comment (`Dockerfile:4`) becomes `docker build --build-arg ENGINE_VERSION=$(git rev-parse HEAD) -t mrr-api .`. `.dockerignore` excludes `.git` (`.dockerignore:3`), so the sha cannot be read inside the build, and B does not edit `.dockerignore`.</li><li>The runtime reads `ENGINE_VERSION`, else `RENDER_GIT_COMMIT` (the host's own commit variable), else `"unknown"`. So a Render build that did not pass the argument still serves its commit. B confirms on the host that the service receives `RENDER_GIT_COMMIT` and records it in `docs/redesign/DEPLOY.md`.</li><li>S-04 needs **no** COPY: `COPY api/ api/` (`Dockerfile:36`) already carries `api/static/snowflake_proposed.sql`.</li><li>R-15 is **not** B's: its two lines are already on `desk/deploy-prep`.</li></ul> | **Low.** B's two lines sit in the Python stage, deploy-prep's in the web stage and `.dockerignore`, so they merge without overlap; after deploy-prep lands, the anchor `FROM python:3.13-slim` is its line 26. |

**The pre-1970 calendar discrepancy (R-03).**

- **The two calendars.** After B's commit 2a the repo carries two NYSE calendars that disagree
  before 1970:
  - `api/calendar.py` and `src/market_data/session.py`, whose tables are generated from the bounded
    holiday definitions;
  - the engine's `exchange_calendars` XNYS, which treats all 69 regular holidays of 1962–1969 as
    sessions (N7 gives the mechanism and the counts).
- **What B does.** B does not reconcile them:
  - the engine's calendar is frozen by the native regression (§2);
  - the tables are the authority before 1970;
  - parity is asserted from 1970-01-01 only;
  - no served calculation reaches a pre-1970 session, as N7 states with its one exception (the
    engine's DGS10 missing-session warning, unchanged engine output). The served copy of that
    warning now discloses the count: "(includes N pre-1970 holidays the engine calendar treats as
    sessions)", with N = 67 for DGS10 on the audit's copy (round 4's R-10, §1.2).
- **For a later reconciliation**, if anyone wants one: the engine could pass its calendar bounded
  regular holidays. That changes the engine's calendar, so it is a separate change, under the
  native regression, and out of this plan's scope.

**Connections to the generation's copy.**

- **Hardening's state.**
  - **V-51 is fixed** in hardening's staged round 18 (decision 32):
    - `dbpath.open_generation` makes the copy read-only by its connection's own mode, with no
      Python authorizer;
    - `api/db` closes each thread's connection when the thread exits (`_ThreadConnection`);
    - the assistant's `_ro_conn` closes its connection when its block ends.
  - **V-54 and V-56 are in progress** in round 19, as unstaged edits:
    - the recession and allocation builders close their connections in a `finally`;
    - the snapshot readability flag follows the Desk reader.
  - The one Python callback left on a copy is the assistant query tool's progress handler. It is
    hardening's, and it is safe only while no connection to the copy is left for the collector.
- **What B holds on the merged base:**
  - there is no Python authorizer on the copy, and B adds no Python callback to any connection to
    it (a static check, §5);
  - every connection B opens to the copy (`dbpath.connect_ro` → `open_generation`,
    `dbpath.py:152–193`) is closed in a `finally` or `with closing(...)` on every path, failure
    included. A connection's own `with` only ends a transaction;
  - no cursor outlives its connection;
  - thread-reused connections stay `api/db`'s.
- **Enforcement.** §5's failing-builder test (no unowned connection to the copy after a Desk item
  fails midway), its bounded reader after `gc.collect()`, and the extended static checks enforce
  this.
