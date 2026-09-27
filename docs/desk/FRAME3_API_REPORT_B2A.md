# FRAME3_API_REPORT_B2A.md: session B2a, `/regime`, `/macro` and `/pipeline`

Branch `desk/frame-3-api-b2a`, cut from `main` at `dc9704d` (hardening merged, PR #6), with
`0a3ae63` carrying the spec and plan at `2def37b`. Rebased onto `main` at `9979fe9` once
desk/frame-3 merged (#5): see "The rebase" below for the new shas. The brief: build `FRAME3_API_PLAN.md` §7
commits 7 (`/regime`) and 8 (`/macro`), each with its tests and the full gate, and commit after
each. B1's `api/desk_envelope.py` and `tests/desk_contract.py` are taken from
`desk/frame-3-api` (`80c1e2b`); the routes live on B2a's own router, `api/desk_v2_macro.py`.
Nothing under `src/desk/` is touched, except in the one commit the owner scoped for it (the
tenor registration). The branch is pushed to origin at the end, as the last brief asked.

This file is committed with plan §7 commit 11 (the CLAUDE.md sections), the branch's last
commit.

## The rebase onto main (frame-3 merged)

desk/frame-3 merged into `main` (#5, `9979fe9`). A rebase of this branch onto it conflicted on
the setup commit `0a3ae63` only: its copies of `DESK_FRAME3_SPEC.md`, `FRAME3_REPORT.md`,
`BUILD_NOTES.md` and the 24 compare screenshots were added on both sides. By the owner's ruling:

- the four B2a commits were replayed onto `main` (`git rebase --onto origin/main 0a3ae63`), with
  no conflict;
- the spec, the frame-3 report, the Build Notes and the screenshots are `main`'s (session A's,
  as merged);
- the two files `main` lacked, `FRAME3_API_PLAN.md` and `FRAME3_API_PLAN_STATUS.md`, are carried
  from `0a3ae63` in `c5c7472 frame-3-api-b2a: carry the API plan`.

| Before the rebase | After |
|---|---|
| `80e3527 desk-v2: /regime` | `3b3eb12` |
| `5bc30ff desk-v2: /macro` | `54df373` |
| `3ce5197 desk-v2: register DGS3MO, DGS5, DGS30` | `4b7743c` |
| `87ff178 desk-v2: /pipeline, /pipeline/ddl and the published validation verdict` | `f30222f` |

The rest of this report names the commits by their subject; where a sha appears before this
section's table, it is the pre-rebase one.

## Where the plan and the tree (or the brief) disagree, and what was done

1. **The three FRED tenors.** The first brief said "Do not touch src/desk/", which outranks the
   plan, so commit 8 shipped `/macro` without registering them. A tenor the registry did not
   declare was served as null, spec §12.8's state "until then". A second brief then made a scope
   exception for one commit, `desk-v2: register DGS3MO, DGS5, DGS30` (below). `/macro` needed no
   change: it reads what the registry declares.
2. **Module names.** The plan's `api/desk_v2.py` and `api/desk_items.py` are B1's. B2a's router is
   `api/desk_v2_macro.py` (the brief's name), and its item builders are in `api/desk_items_macro.py`.
   Neither collides with B1's files at merge.
3. **Where B2a's lines sit in shared files, so the merge with B1 is clean or trivial.**
   - `api/main.py`: the import follows `from api import freshness as freshness_mod`, and the
     `include_router` follows `app.include_router(api)`. B1 adds its lines after
     `from api.desk import router as desk_router` and after `app.include_router(desk_router)`.
     Unchanged lines separate the two sets of hunks.
   - `api/analytics_cache.py`: B2a appends its items after the `desk_preset:*` entries. B1 inserts
     `desk_study:*` before them.
   - `deploy/api.env.example`: B1's two lines (`ENGINE_VERSION`, `RENDER_GIT_COMMIT`) copied
     verbatim. `api/desk_envelope.py` reads both variables, and `tests/test_env_template.py`
     fails unless the template names them. The two edits are identical, so they merge.
4. **`tests/test_desk_api.py` (hardening's).**
   - `ROUTES`, the hand inventory that must equal the app's routes, gains `/api/desk/regime` and
     `/api/desk/macro`, each expected 200 before the first refresh (plan §8).
   - `test_a_failed_first_import_of_the_engine_recovers_by_rebuilding_the_same_file` selected
     "every item whose name starts with desk" and pinned that set to `desk_assets` plus the
     presets. `desk_regime` and `desk_macro` start with "desk" too. The selection is now
     `desk_assets` and `desk_preset:*` by name, which is what the test means. B1's `desk_study:*`
     items need the same change.
   - `test_every_builder_closes_its_connection_on_every_path` scans B2a's two modules as well
     (plan §5).
5. **The envelope on this base.** B1 wrote `api/desk_envelope.py` before hardening merged. On this
   base `api.provenance` exists, so its `SchemaCheckFailed` row is live: a stored schema-check
   failure answers 503 `schema_check`, with `retryable` and `provider` inside `error` (tested on
   `/regime`).
6. **The enveloped 405.** B1's 405 handler scopes itself to B1's router. A `POST /regime` or
   `POST /macro` answers FastAPI's own 405. Spec §12.0 envelopes only the two removed writes, so
   this matches the spec. At merge, B1's `serves()` can take both routers if wanted.

## The gate

The full Python gate is `make test-api`'s command (`pytest tests -q
--ignore=tests/test_streamlit_backports.py`, the shared `.venv`, Python 3.13). It runs on a copy
of the tree, set up as follows:

- the main checkout's built `web/dist`;
- `data/macro_radar.db`, the audit's copy (`mrr-frame3-docs`, sha256 `9a8b8579…`);
- `data/desk_scratch.db`, hardening's scratch copy, which stores the tier-2 series.
  - The main checkout's older scratch copy lacks those series.
  - With it, six `test_desk_api` tests fail on the untouched base as well.

| Tree | Result |
|---|---|
| Base, `0a3ae63` (untouched) | 1120 passed, 3 skipped, 2 failed |
| Commit 7, `80e3527` | 1150 passed, 3 skipped, 2 failed |
| Commit 8, `5bc30ff` | 1169 passed, 3 skipped, 2 failed |
| Registration, `3ce5197` | 1170 passed, 3 skipped, 2 failed |
| Commit 10, `87ff178` | 1215 passed, 3 skipped, 2 failed |
| **After the rebase** onto `9979fe9`, with the plan carried (`c5c7472`) | 1217 passed, 3 skipped, 2 failed |
| Feeds and pipeline fixture, `28727a2` | 1220 passed, 3 skipped, 2 failed; web: typecheck clean, 123 files / 1532 tests |
| DDL fixture generator, `e0a8b55` | 1220 passed, 3 skipped, 2 failed; web: typecheck clean, 124 files / 1535 tests |
| CLAUDE.md and this report (plan commit 11) | see its commit message |

The web gate is `make test-web`'s commands (`tsc -b --noEmit`, `vitest run`) on a copy of the
tree, with `web/node_modules` borrowed from the `mrr-frame3` worktree (the same lockfile). On
the rebased tree before any web change it read 123 files / 1532 tests, all passed.

In every run the two failures are `test_asset_history`'s DB-state pair,
`test_without_the_table_the_endpoint_says_the_histories_are_not_stored` and
`test_validate_requires_the_table_in_full_mode_only`. They fail identically on the base, and B1's
report records the same pair.

## Commit 7: `/regime`

What it adds:

- `src/analytics/recession.py`: `recession_provenance()` (N5), which opens one connection through
  `_get_conn()` and closes it in a `finally`.
- `api/desk_items_macro.py`: the `desk_regime` item, with the stored rows, N6 and the release
  times; R4.
- `api/desk_v2_macro.py`: `GET /api/desk/regime`, with R8 and R9, and the release date per
  response.

**Choices the plan leaves open, taken here:**

- **One item, blocks computed apart.** `desk_regime` stores each block as a "part": its data, or a
  refusal with the reason the route serves. So a failure in N5 or N6 leaves that block awaiting
  ("Awaiting refresh: …", S-27) and serves the rest. Two failures stay facts about the whole item
  and propagate: `SchemaCheckFailed` (the route answers 503 `schema_check`) and `ImportError` (the
  worker rebuilds the file, hardening R-01). A whole-item failure answers 500 `internal`.
- **The release date is per response.**
  - The item stores every `CPI Release` time from `event_calendar`, once per generation.
  - The route picks the first one after its own "now" and serves its New York date. Plan §0.5
    requires this date to be recomputed for every response.
  - `api/db.event_calendar` (the plan's cite) filters on SQLite's clock, so it would put a
    database read on the request path, and a test could not freeze "now".
  - INDPRO has no stored release event, so its date is null, as the plan says.
- **N5 is guarded at run time, not only in a test.** The item compares the extraction's scoring
  dates with the served `recession_prob_series`. When they differ, the recession block is awaiting
  and the mismatch is logged. A score is never served with a month from another fit.
- **N6 cases the plan does not define.** A series' next print is null (the contract allows it)
  when:
  - the newest regimes row stores no finite trend for either axis; or
  - its month has no joint INDPRO–CPIAUCSL row, or it is the first joint row.

  A zero `x(m)` is refused the same way.
- **K−2 with a trend missing.** `current` is awaiting when the K−2 row stores no trend for either
  axis. `growth` and `inflation` are required, and the plan's rule is the trend's sign.
- **One row a month.** The item keys the regimes rows by month (`date[:7]`), the key the engine's
  `load_regimes` uses.
- **R8 is mirrored.** `REGIME_LAG_MONTHS = 2` is mirrored in the router, so a request reads no
  engine. A test pins it equal to the engine's, and `print_for` to `event_study.regime_at` for
  every day of 2024 to 2026.
- **R4 is applied to the served fraction.** The band uses edges 0.20 and 0.40 on the score. A test
  pins it to `_classify_prob`'s percent edges at and around both boundaries.

**On the audit's copy** (sha256 `9a8b8579…`, with the response's "now" on 2026-09-26), every
`/regime` value equals session A's fixture `web/src/fixtures/desk/regime.json` on `desk/frame-3`.
- `current`: Goldilocks, print 2026-07, latest print 2026-08.
- The recession block: score 0.11644…, probability month 2026-08, inputs through 2026-05, training
  2003-04 to 2026-09, peak 2020-06.
- CPI: threshold −0.0039446, operator `<=`, flips to Goldilocks, release 2026-10-14.
- INDPRO: threshold −0.00022121, operator `<=`, flips to Stagflation.

**Tests** (`tests/test_desk_v2_regime.py`; hermetic store `tests/desk_macro_store.py`):

- **Route shape** under `tests/desk_contract.check_response`, on the hermetic store and on the
  scratch and published copies when present.
- **K−2 moves inside one generation.** It moves at a month boundary, with the same
  `generation_id`.
- **Blocks that go awaiting on their own.** A missing K−2 row leaves `current` awaiting; no
  recession result leaves `recession` awaiting; an empty regimes table leaves both awaiting.
- **The route's own answers.** 202 `computing` before the first generation; 500 `internal` for a
  failed item, with no text leaked; 503 `schema_check`.
- **The rules.**
  - R8 against `regime_at`;
  - R9 with a missing month and with a change;
  - R4 parity;
  - N5 parity: the scoring index equals the served series, inputs run three rows back, and
    training covers what the model fits (the scaler's sample count);
  - year-ago absent → null; peak ties → earliest; a mismatched extraction → awaiting.
- **The N6 oracle** against the real classifier (`src/regime.py`, imported with `FRED_API_KEY`
  set and `.env` loading switched off).
  - Its cases: both series, both starting states, and a CPI gap before m.
  - Its checks: exact equality at `x_prev`; the inverse within 1e-12; ε = 1e-4 on both sides of
    the operator.
  - A series that already printed m+1 serves a null threshold.
- **AST mirror parity** for `ROLLING_WINDOW` and `REGIMES`.
- **The release date** under a frozen "now" (before, at and after a release, past the last one).
- **The failing-build subprocess test (plan §5).** Every connection the items open fails once
  open. Afterwards none is left open, and a fresh reader reads after `gc.collect()`.
- **Static checks.** No callback on any connection, and no `src.config` import.

## Commit 8: `/macro`

What it adds:

- `api/desk_items_macro.py`: the `desk_macro` item, with N8 (the curve), N7 (the rolling HY
  statistics) and R5.
- `api/desk_v2_macro.py`: `GET /api/desk/macro`. Nothing in `/macro` depends on "now", so the
  route serves the item as it is.

**The rules as built:**

- **N8, the curve.** Each tenor is read through the engine's reader (`event_study.load_level`),
  as plan §0 decision 4 requires.
  - **The common path.** `today.date` is the latest date every stored tenor shares, and
    `month_ago` is the latest shared date on or before it less one calendar month.
  - **No common date (R-18, S-29).** Each tenor carries its own newest value, and its month-ago
    value is its newest on or before its own date less one month. Both snapshot dates are null.
  - **A common today with no common date a month earlier.** Only `month_ago` takes the per-tenor
    form, on or before `today.date` less one month.
  - **`dates`.** `today.dates` and `month_ago.dates` carry all five tenors on every path (R-19,
    R-20, S-30).
  - **The differences** are taken between common dates only, and are null whenever a date they
    need is null.
- **N7, the HY statistics.** Expected sessions are the engine's XNYS sessions in the closed
  three-year window, less `api.calendar.bond_extra_closures`. So the pre-1970 holiday tables of
  B1's commit 2a are not needed, and neither is any `api/calendar.py` year before 2024: the
  window never reaches them. `valid_n` counts every finite stored observation in the window,
  weekend month-end prints included.
  - **With a gap, the reason** is "coverage from <first observation> only" when every missing
    session precedes the first observation. Otherwise it reads "no value on N expected sessions
    in the three-year window: d1, d2, d3 and K more". The plan says "the first three dates and a
    count" and fixes no wording, so this wording is B2a's.
- **R5, the band.** `band` is null exactly when `hy_pct_3y` is null. `band_edges` is the constant
  `[0.30, 0.70]` on every answer.
- **When the credit block is awaiting (S-27).** It needs `hy` and `ig`, both required and
  non-null. So it is awaiting when HY is not stored, or when the IG watermark
  (`fred:BAMLC0A0CM`) is absent or unreadable.

**The tenors (item 1 above).** `/macro` reads DGS3MO, DGS5 and DGS30 only once the registry
declares them.

- On this branch they are null with null dates, spec §12.8's state "until then".
- **FRED confirms the plan's declared starts** (read-only metadata queries, 2026-09-26): DGS3MO
  from 1981-09-01, DGS5 from 1962-01-02, DGS30 from 1977-02-15, all daily, in percent.
- **FRED shows no 2002–2006 gap in DGS30.** The plan asks for a note on "FRED's 2002-02 to
  2006-02 gap", but FRED as served today has a DGS30 value on every session from 2002-02-19 to
  2006-02-08. There is a step between 2006-02-08 (4.67) and 2006-02-09 (4.51). The note should
  describe what FRED serves. Its wording is left to the registration commit.

**On the audit's copy,** every `/macro` value equals session A's fixture
`web/src/fixtures/desk/macro.json` (compared field by field, within 1e-12 relative).
- The curve: 2026-09-22 against 2026-08-21, 2s10s 25 bp.
- HY: 787 observations, 747 expected, none missing, rank 122/787 = 0.1550, range 2.59 to 4.61,
  band `tight`.
- The line: 264 points, with its peak on 2026-03-30 at 3.46.

One number is served differently: `10y_chg_bp` is 21.999999999999975, where the fixture has 22.0.
Spec §12.0 serves values at full precision, and the fixture rounded.

**Tests** (`tests/test_desk_v2_macro.py`):

- **Route shape** under `check_response`, on the hermetic store and on the scratch and published
  copies when present.
- **`/regime` and `/macro` answer on one `generation_id`.**
- **Before the store exists:** the curve is null and credit is awaiting. Without the IG
  watermark, credit is awaiting.
- **N8:**
  - the common-date path;
  - disjoint histories, the plan's own case: 2y through 2026-06-30, 10y from 2026-07-01, and
    month-ago dates 2026-05-29 and 2026-08-21;
  - a common today with no common month-ago date;
  - a tenor the registry declares (monkeypatched) is served, and one stored but undeclared stays
    null.
- **N7:**
  - a full window (a weekend month-end print and NYSE-holiday prints count as valid);
  - one gap, which gives null figures, the reason, and `band_edges` still served;
  - a five-session gap, which names its first three dates and its count;
  - a short history, which reads "coverage from 2024-06-03 only";
  - no print on 2023-12-25, 2024-01-15, Columbus Day and Veterans Day, which is still full
    coverage (the S-12 rule);
  - ties are not below, and the peak is the earliest on ties.
- **R5:** the band and its edges.
- **The audit's figures (Q4, Q5),** run only on that copy (by its sha).
- **The failing-build subprocess test** for `desk_macro`.

## Commit: `desk-v2: register DGS3MO, DGS5, DGS30` (plan §4.5, the scope exception)

**What it adds:**

- **`src/desk/series.py`:** three tier-1 FRED rows after `hy_oas`, with roles `()`, unit `bp`,
  scale 100, and `fixed=("close", −30)`, `known=NEXT_OPEN`, like DGS10.
  - `us3m`, DGS3MO, from 1981-09-01;
  - `us5y`, DGS5, from 1962-01-02;
  - `us30y`, DGS30, from 1977-02-15.

  These starts are FRED's own (checked read-only on 2026-09-26). No DGS30 gap note, per the
  brief: FRED serves 2002–2006.
- **`api/freshness.py`:** the three mirror rows, calendar `bond`, tier 1.
- **Tests:**
  - `REFRESH_IDS` and `REFRESH_KEYS` in `tests/test_desk_api.py`;
  - the store test `test_the_three_curve_tenors_are_stored_as_tier_1_fred_series` at the end of
    `tests/test_desk_history.py`. It checks the declared rows, that no role list carries them,
    and that a tier-1 run fetches each from its declared start, stores it and writes its
    `desk:<id>` watermark.

**Where the plan and the tree disagree:**

- **The plan says "No workflow edit is needed", but one comment changed.** The refresh runs
  `desk_history --tier 2`, so the tenors are fetched with no change. But the step's comment in
  `refresh-data.yml` states the call count ("six FRED calls"), and
  `tests/test_desk_history.py` pins that text. It now reads "nine FRED calls" (the five rates and
  spreads, the three tenors, WTI). The test and its name follow; no step changed.
- **The registry test's invariant "an available series has roles"**
  (`test_registry_tier1_is_the_agreed_list_and_the_vocabularies_hold`). It now allows the three
  tenors, and only them, to be available with no role, as spec §12.8 requires.
- **Tests that pinned the old refresh set.** These now name eight tier-1 series:
  - `test_validate_db.py`: `TIER1_DESK`, the `_make` store, and two row counts;
  - `test_desk_history.py`: `TIER1`, the counts, and the fetch-order slices;
  - `test_desk_api.py`: the drawer-verdict test's tier-1 slice;
  - `test_event_study.py`: the refresh-set list and the synthetic store's `awaiting_refresh`.
    The tenors appear in no shock list, so its per-key loop checks them by the registry instead.
- **`/macro`'s tenor test** now stores the three tenors and sees all five served. It still shows
  that the registry, not the table, decides what `/macro` reads: a stored tenor taken out of the
  registry is null.

**The clean-store comparison against `origin/main`, before and after.**

- **Its setup.**
  - `origin/main` is `1d30793`. It differs from this branch's base only in `web/`, the
    Dockerfile and one script, so its engine is this branch's.
  - Each engine ran from its own tree (`PYTHONPATH`), in its own process. Both ran on the same
    read-only store copy, pinned with `generation="golden"`, `as_of="2026-09-24"`.
  - The canonical JSON of every result was hashed.
- **The 186 studies.**
  - the three presets;
  - the ten catalog queries that are not presets;
  - every shock × target pair at w = 5, z = 2 in both signs: 12 shocks by 7 targets, 168;
  - two condition studies, a regime study, a regime-condition study, and a death cross in one
    regime.
- **The stores.**
  - hardening's scratch copy, which stores tiers 1 and 2: all 186 run;
  - the audit's copy: 95 run, and 91 are typed refusals for its unstored tier-2 series. A refusal
    is compared by its class and text.

| | Scratch copy | Audit's copy |
|---|---|---|
| Before (this branch at `5bc30ff`) | 186/186 byte-identical; assets list identical | 186/186 byte-identical; assets list identical |
| After (this commit) | **186/186 byte-identical**; assets list differs in `awaiting_refresh` only: `[]` → `[us3m, us5y, us30y]` | **186/186 byte-identical**; `awaiting_refresh`: `[wti, ndx, dxy, usdjpy]` → `[us3m, us5y, us30y, wti, ndx, dxy, usdjpy]` |

No study, preset or `inputs_hash` changed: the tenors have no roles. The assets list's `shocks`,
`targets` and `unavailable` are unchanged. Its `awaiting_refresh` list now names the tenors,
because they are tier-1 series the full refresh stores, and neither copy stores them yet.

**Consequences for the owner** (none blocks, all end with the first full refresh that stores
the tenors):

1. **The first full refresh after the merge must store all three.** `validate_db` fails a
   full-mode database that lacks a tier-1 Desk series (hardening's R-02). So if FRED fails one
   tenor on that first run, that run's upload is held; the next run retries. After the first
   store, a failed fetch keeps the stored rows and only warns (the watermark's `error` status).
2. **The drawer's `desk_series` verdict judges eight tier-1 series.** On a deployed database that
   predates the tenors it reads "Behind" until they are stored.
3. **Main's frame-2 Event Study page** (`web/src/api/desk.ts` on `origin/main`) prints the assets
   list's `awaiting_refresh` as "Awaiting a full refresh: …". Its labels come from the shock and
   target lists, so until the tenors are stored it would add the raw keys `us3m, us5y, us30y`
   to that sentence. The frame-3 web removes that file. Nothing here changes it.
4. **`/api/desk/pipeline/inventory`** lists `desk:DGS3MO`, `desk:DGS5` and `desk:DGS30`, which
   are awaiting until stored.

## Commit 10: `/pipeline`, `/pipeline/ddl` and the published validation verdict

**What it adds:**

- **`api/desk_pipeline.py`**, the rows and their statuses:
  - the row table (`PIPELINE_GROUPS`, `RAW_SERIES_ROWS`) and the feeds table (`FEEDS`, S-02);
  - the `desk_pipeline` worker item, with each row's dates, provider, feeds and note, the
    watermarks, and `last_refresh_utc`;
  - the per-response statuses and grouping. They depend on "now" (plan §0.5).
- **`api/desk_v2_macro.py`**, two routes:
  - `GET /api/desk/pipeline` in the envelope. `validation` is read per request, gated on the
    pinned generation's key;
  - `GET /api/desk/pipeline/ddl`, which serves `api/static/snowflake_proposed.sql` verbatim as
    `text/plain; charset=utf-8`. The file is session A's fixture text, moved unchanged; its first
    line already says PROPOSED (S-04).
- **`api/bootstrap.py`**, the S-01 binding:
  - the bracketed procedure `bind_validation`: `file_key`, WAL empty (at a download the served
    file's too), hash, then `file_key` and the WAL again, binding exactly the first key;
  - at a download it binds on the new file before the swap and holds the result once the swap
    is done. A poll whose asset is unchanged re-fetches `validation.json` while nothing held
    matches the listed digest (or the file's own hash when the listing has none);
  - `validation_for(key)` is the per-request gate. A failed fetch binds nothing and never
    touches the database refresh.
- **`scripts/validation_asset.py`**, stdlib only, writes the slim `{verdict, mode, timestamp,
  db_sha256}`. Both `refresh-data.yml` and `intraday-refresh.yml` gain a step, "Publish the
  validation verdict", right after the database's publish step:
  - it runs under the same condition, with `timeout-minutes: 1` and `continue-on-error: true`;
  - it runs the script and uploads `publish/validation.json` with `--clobber`;
  - the database's publish step is unchanged.

**Choices and deviations:**

1. **The row set is the plan's, not the fixture's.** The plan lists 22 rows:
   - the 15 Desk registry series available at tier 2 or below, the tenors included;
   - INDPRO, CPIAUCSL, UNRATE, T10YIE, T5YIE, USREC and BAMLC0A0CM.

   Session A's fixture `web/src/fixtures/desk/pipeline.json` also lists BB, B and CCC OAS, RSP,
   VXVCLS, PAYEMS, RSAFS and FEDFUNDS. No Desk panel reads those, and the plan says every panel
   resolves to one of its rows.
2. **Groups and feeds.** The group names are the fixture's. The fixture places no row for
   T10YIE, T5YIE or USREC, so B2a put the two breakevens in Rates and USREC in Macro (monthly).
   `FEEDS` is the fixture's table verbatim for every series it lists. T10YIE, T5YIE and USREC
   (recession-model inputs, like UNRATE) feed Regime as UNRATE does.
   - **The fixture's table is narrower than the readers.** HY OAS is also a recession-model
     input and an Overview `data_status` contributor, and its feeds say neither. Kept, so the
     served table and session A's agree; the owner may widen it. *Superseded by the commit
     "desk-v2: feeds and pipeline fixture" below: the feeds are now derived from the code.*
3. **Fields where the served payload differs from A's fixture, following the plan:**
   - provider: the registry's source declaration (R-15), not "FRED" or "Yahoo Finance";
   - `freq`: "daily" for IG, which is `SERIES_REGISTRY`'s cadence, not the fixture's "monthly";
   - the tenors' `key`: now `us3m`, `us5y`, `us30y`;
   - notes: the registry's, or the engine's `not_stored` sentence for any unstored registry
     series, tier 1 included.

   Session A's fixture needs these to match.
4. **Statuses.** For ^GSPC, GC=F and ^RUT, `assess` answers "unavailable" for a symbol with no
   rows, which maps to `missing`. Its `current` and `delayed` map to `current`.
5. **`validation.json` is written by a script, not inline shell.** The script is testable (a
   test runs it and parses its output with bootstrap's own parser), and a static check keeps it
   stdlib-only for the lean intraday install.
6. **The bootstrap tests are in a new hermetic file,** `tests/test_bootstrap_validation.py`. The
   plan names `tests/test_bootstrap_identity.py`, but that module skips entirely without
   `data/macro_radar.db`. The key-gate and race tests are in `tests/test_desk_v2_pipeline.py`, as
   planned.
7. **"A commit after step 4"** is taken as a commit after the binding returns.
   - A commit between reading `k2` and step 4's own WAL re-check is inside step 4, and step 4
     refuses it.
   - Before step 1, between steps 1 and 3, and during the hash (the hash takes half the file,
     the commit lands, then the rest), the binding refuses, plain and checkpointed alike.
   - After step 4, `k1` is bound, the commit moves the key, and the worker's new generation is
     served null.
8. **The poll's re-fetch rule is the plan's:** nothing is held, or the held hash is not the
   current asset's. One consequence: a file replaced by identical bytes under a new inode (a
   `make sync-data` of the same asset) reads "unknown" until the next upload, because the held
   hash still matches the asset and the key moved.
9. **The worker interleaving (R-11) passes on this base.** Hardening's every-build key re-check
   is merged (`api/worker.py` `_stage`, `_SnapshotMoved`). The test commits from inside the
   worker's `_stage`, after the worker read `k1` and before it copies. It asserts three things:
   - no generation is published under `k1`;
   - the dropped-snapshot count rises;
   - the verdict is never served.

**Tests.**

- **`tests/test_desk_v2_pipeline.py`:**
  - shape and groups;
  - the row set pinned to the registry plus the raw rows, and to `FEEDS`;
  - each row's registry or `SERIES_REGISTRY` fields;
  - providers (R-15, with `desk_series.provider` overwritten to show it is never read), and
    parity with the inventory's strings;
  - dates (S-03) and notes;
  - statuses that move with "now": FRED Desk rows, ^GSPC inside and past the 06:00 UTC grace,
    monthly prints, and the worst-of rule for groups;
  - `last_refresh_utc`;
  - the scratch, published and audit copies;
  - the DDL route byte for byte; no `.sql` import under `web/src` or `web/scripts`; the image
    carries the file with no new COPY;
  - S-01: the key gate; the WAL-commit repro; Codex's round-3 repro; an empty WAL; a commit at
    each boundary × plain or checkpointed; the worker interleaving;
  - `/regime`, `/macro` and `/pipeline` answer on one generation.
- **`tests/test_bootstrap_validation.py`:**
  - a match, a fail verdict, and six ways of no match;
  - a download clears the previous file's verdict;
  - the missed-upload repro (R-05);
  - a restart;
  - no listed digest;
  - a failing fetch;
  - no token;
  - the parser;
  - the workflow script.
- **`tests/test_workflows.py`:** both writers' new step (condition, bound, `continue-on-error`,
  the script, `--clobber`, a database publish step that never mentions the verdict, the intraday
  validator's mode), and the script is stdlib-only.
- **`tests/test_desk_api.py`:** the route inventory lists `/api/desk/pipeline` and
  `/api/desk/pipeline/ddl` (200); the builder-close scan covers `api/desk_pipeline.py` and
  `api/bootstrap.py`.

**On the audit's copy**, with "now" at 2026-09-24:
- `last_refresh_utc` is 2026-09-24T15:52:43Z.
- The groups read: Rates missing (the three tenors are not stored there), Credit current,
  Equities & vol missing (^NDX), FX & commodities missing (tier 2), and Macro (monthly) current.
- `validation` is null, because this process holds no verified upload.

**Left for others:** nothing from this commit. The DDL generator and the pipeline fixture were
done on this branch once frame-3 merged (the two commits below), and plan §7 commit 11 is this
branch's last commit.

## Commit: `desk-v2: feeds and pipeline fixture`

**The feeds (S-02) are derived from the code, not the fixture.** A series feeds a Desk tab when a
value the tab shows is computed from its stored rows, directly or through a stored result:
- the regimes table, from INDPRO and CPIAUCSL, which every event study reads (each event's K−2
  label and the evaluable mask);
- the recession model: its seven inputs (`api/main.RECESSION_INPUTS`) and USREC, its target.

`api/desk_pipeline.tab_readers` declares each tab's readers, and `feeds_of` lists the tabs in the
sidebar's order:

| Tab | What its served values read |
|---|---|
| Overview | the regime tile, the recession tile, ^GSPC (trend), VIX (tile and change), the Ledger's studies (active signals, since last close), the `data_status` contributors |
| Technicals | ^GSPC, and its four scored studies (golden and death cross, the 20- and 5-day moves) |
| Event Study | the 13 catalog studies |
| Regime | the regimes rows, the next prints (INDPRO, CPIAUCSL), the recession score |
| Macro | the five tenors, HY (stored) and IG (its watermark) |
| Ledger | its ten studies with a question |
| Position Monitor | the S&P from `/technicals`, 2s10s from `/macro` (DGS2, DGS10) |

- INDPRO and CPIAUCSL feed Overview, Technicals, Event Study, Regime and Ledger.
- The HY spread feeds Overview, Event Study, Regime, Macro and Ledger. The breakevens, UNRATE and
  USREC feed Overview and Regime.
- DGS2 and DGS10 feed the Position Monitor. No Ledger row reads the 10-year.
- ^NDX, ^RUT and USD/JPY have no live reader: Sectors, Basket & Hedge and the correlations are
  not served. Their feeds are empty, and their notes say so ("No Desk tab reads it yet: …").
- **How the derivation is pinned.** `tests/test_desk_v2_pipeline.py` checks the declared readers
  against:
  - the recession model's actual reads, through a recording connection (USSLIND is only its
    staleness probe);
  - the classifier's inputs (`src/config.py` SERIES) and the next prints;
  - `/macro`'s tenors;
  - spec §12.3's catalog table and §8's Ledger order.

  B1's `api/desk_catalog.py` is not on this branch, so the catalog inputs are declared from the
  spec, which that module transcribes.

**One served string broke the Desk's language rule.** The registry's gold note ends "so entry is
always the next session", and "always" is on the ban list (`desk-language.test.ts`), which covers
every string the API prints.
- `/pipeline` serves that phrase reworded ("so entry is the next session"), and the registry,
  under `src/desk/`, is unchanged.
- A test checks every served string, and every registry note as a stored row would serve it,
  against the ban list. The list's regex is read from the web test, so the two cannot drift.
- **Follow-up:** reword the registry note itself (one word in `src/desk/series.py`), then drop
  `DESK_WORDING`. The test fails once the registry no longer says "always", as a reminder.

**The fixture.** `web/src/fixtures/desk/pipeline.json` is now what `GET /api/desk/pipeline`
serves on the audit's store (sha256 `9a8b8579…`) at 16:00 UTC on Sep 24: the 22 rows, the
provider declarations, the derived feeds, the served notes and statuses. The fixture's own
`as_of` and `generation_id` are kept. PROVENANCE.md's row says so.

**The web tests that read it** now follow the served fixture:
- `consistency.test.ts` (S-03): IG and the two breakevens are daily at FRED, stored one row a
  month, and dated to the day on the page. Their `first` is a month stamp, and IG's `last` is
  `/macro`'s IG date. The BB, B and CCC rows are gone.
- `PipelinePage.test.tsx`:
  - 22 series;
  - the groups at 8, 2, 4, 4 and 4 rows, with Macro (monthly) current;
  - the HY and IG rows as served;
  - a note search that finds ^NDX by "no desk tab reads".
- `codex-round2.test.tsx`: 21 series once a group of two is replaced by one unreadable row.

## Commit: `desk-v2: DDL fixture generator (R-02)`

- **`web/scripts/gen-ddl-fixture.mjs`** reads `api/static/snowflake_proposed.sql` and writes
  `web/src/fixtures/desk/pipeline-ddl.ts`. It exports the text as `PIPELINE_DDL`, escapes
  backslashes, backticks and `${`, and heads the module "GENERATED … do not edit by hand".
  - The generated literal equals the hand-written one it replaces, byte for byte.
  - Run from `web/`: `node scripts/gen-ddl-fixture.mjs`.
- **`web/src/fixtures/desk/pipeline-ddl.test.ts`** asserts three things:
  - the export equals the `.sql` file byte for byte;
  - the committed module is exactly what the generator writes, so an edit to either side alone
    fails;
  - the escaping survives a round trip through a template literal.

  The `.sql` file is read with `fs` (through untyped dynamic imports, since the web project
  carries no `@types/node`), never imported. A mutation check (one changed word in the `.sql`)
  fails the first two tests.
- **No `.sql` import anywhere in `web/`.** The Python scan (`tests/test_desk_v2_pipeline.py`) now
  walks all of `web/` except `node_modules`, `dist` and the test outputs, and every source,
  config and HTML file. It also catches a Vite `?raw` import and an `import.meta.glob` of a
  `.sql` path. `new URL(…sql)` passes, since a URL is a read, not an import.
- PROVENANCE.md's `pipeline-ddl.ts` row names the generator and the test.


## Codex R-01 (P2): a raw_series row is dated and judged by its stored rows only

**The finding.** A raw_series row with no stored rows still read "current" when its
`fred:<id>` watermark survived. `statuses()` passed the watermark to
`api/freshness.fred_series_state`, which dates a daily series by the watermark's `last_obs` and
falls back to it for a monthly one. This happened for the series absent on its own, or for the
whole `raw_series` table absent.

**The fix** is in `api/desk_pipeline.py`:
- `_raw_row` counts the series' stored rows. Only with some stored does a daily series take its
  watermark's `last_obs` as `last`.
- `statuses()` judges a raw row by its policy only when it has stored rows. With none, the row
  is `missing` whatever its watermark says, and its group, the worst of its rows, is missing too.
- The Desk and price rows were already dated by stored rows alone (`desk_series_states`, and the
  price row's newest close).

**The tests** (`tests/test_desk_v2_pipeline.py`, at a frozen 2026-09-24 16:00 UTC, on a hermetic
store where every raw row is current):
- each of the seven raw series with its rows deleted and its watermark kept: `first` and `last`
  null, the row missing, its group missing, and the other six still current;
- `raw_series` dropped with the watermarks surviving: every raw row missing; Rates, Credit and
  Macro (monthly) missing; the Desk's own HY row still current.

Against the unfixed module, all eight of those cases fail.

On the audit copy every raw series is stored, so the fixture is unchanged: regenerating it gives
no diff.

## The merge of main (B1 merged, `94e606d`)

`git fetch origin && git merge origin/main`. The six conflicts were resolved as laid out in
B1's report (`docs/desk/FRAME3_API_REPORT.md`, last section). CLAUDE.md merged without a conflict.

**The resolutions:**
- **`api/desk_envelope.py`:** main's version wins. `/regime`, `/macro` and `/pipeline` already
  answer through `env.answer`, so they take B1's pinned-generation rule (Codex R-01: `fn` runs
  under `dbpath.pinned(request_generation())`) with no change of their own.
- **`src/analytics/recession.py`:** main's version, which has one `recession_provenance()`. It
  returns the same five keys as B2a's (`probability_month`, `inputs_through`, `feature_months`,
  `training`, `scoring_index`), so `/regime`'s block and its pinned tests are unchanged.
- **`api/analytics_cache.py`:** one `desk_regime` item, B2a's `api/desk_items_macro.desk_regime`,
  registered after `recession`. B1's builder in `api/desk_items.py` is deleted.
  - The item keeps the stored slopes (`growth_trend`, `inflation_trend`) on each row. `direction()`
    (the classifier's own `> 0` test, which reads None for a slope that is NULL or non-finite, per
    B1's R-03) is the one rule. `/regime`'s rows and next print read it, and so does `/overview`'s
    regime tile.
  - `recession_band` is the one R4 band. `recession_tile` takes seven fields of the item's
    recession block, the same block `/regime` serves whole, so the Overview tile and `/regime`
    agree by construction.
  - A block that fails awaits with its own reason, and the regime rows still serve. The new test
    `test_a_recession_block_that_fails_leaves_the_rows_served` covers this.
  - The item opens the generation's copy through one named opener, `_connect`. B1's
    failing-build test wraps it the way it wraps the other openers. That test now expects
    `desk_regime` among the builds that fail, since its own `regimes` read fails the whole item.
- **`tests/desk_contract.py`, `tests/test_desk_api.py`, `deploy/api.env.example`:** the union.
  - The contract is main's, which adds the strict S-28 error schemas; B2a's schemas were already
    in it.
  - `ROUTES` lists every v2 route, B1's and B2a's.
  - The builder-close scan covers both routers' modules.
  - The env template carries B1's `ENGINE_VERSION` and `RENDER_GIT_COMMIT` lines.

**The gate on the merged tree:**
- **Python: 1585 passed, 3 skipped, 2 failed.** The two failures are the base
  `test_asset_history` pair (the endpoint 503 and `validate_db`'s full mode), which read the
  data/ DB's state and fail the same way on main.
- **Web: typecheck clean; 1534 of 1535 unit tests pass.** The one failure is on main too: it
  fails identically in a detached `origin/main` worktree. `sessions.test.ts` "holds
  api/calendar.py's NYSE holidays, year for year" fails because B1's S-12 carries
  `api/calendar.py` back to 1962, while `web/src/screens/desk/positions/sessions.ts` still holds
  2024–2027. It is not a merge conflict. The next commit fixes it (below).
- **Regression: `scripts/desk_native_ab.py --base origin/main` prints "byte-identical: 16/16"**,
  on the audit copy and on hardening's scratch store.

**Every v2 route on the audit copy, against A's fixtures** (`now` = 2026-09-24 16:00 UTC; all
JSON routes answered on one `generation_id`):
- **No differences:** `/regime`, `/macro`, `/pipeline`, `/study/events`, and `/overview`'s regime
  and recession tiles. `/pipeline/ddl` is byte-equal to `pipeline-ddl.ts`. The stubs answer
  awaiting with their sentences.
- **Differences, each explained:**
  - `/overview`'s `data_status`: B1 orders the contributors as N9 does (FRED first) and gives
    fuller reasons (HY's "short" watermark note, the providers list). Every date and state is the
    same.
  - `/ledger` and `/study/catalog`: the tier-2 unavailable reasons for DXY and WTI. The fixture
    predates hardening's `REFRESH_TIER` 2.
  - `/technicals`: `move_20d_sigma` is −0.28049… where the fixture shows an illustrative −0.28.
  - `/study`: `elapsed_ms`, `served_from_cache` and `engine_version` are illustrative in the
    fixture, and `inputs_hash` depends on the generation. `entry_rule` carries hardening's R-01
    wording ("else the first later session whose fixing is") where the fixture has "else the
    next session's close".

## Commit: `desk: web session calendar matches api/calendar 1962–2027`

The web failure above, fixed with the generator that wrote B1's tables. `scripts/gen_nyse_holidays.py`
still writes 1962–2023 into `api/calendar.py` and `src/market_data/session.py`. It then writes the
web's table in `web/src/screens/desk/positions/sessions.ts` from the fresh `api/calendar.py`: every
year of its HOLIDAYS, 1962–2027. The published 2024–2027 lines come through byte for byte, and the
web table cannot drift from the Python ones. `--check` covers all three files.

**The pins:**
- `sessions.test.ts` holds the web table equal to `api/calendar.py` year for year, as before.
- `tests/test_calendar_coverage.py`'s up-to-date test now covers the web file as well.
- `sessions.test.ts` adds three checks: a pre-1962 span gives no count, a week across
  Christmas 2023 counts 3, and a 1968 paperwork-crisis Wednesday is not a session.
- `consistency.test.ts` drops its guard, whose comment said the table began in 2024. The 3-year
  technicals window now counts sessions against the table too.

**The gate:**
- Web: typecheck clean, 1535/1535.
- Python: 1585 passed, 3 skipped, 2 failed (the same base `test_asset_history` pair).
- Nothing under `src/desk/` changed, so the native regression gate does not apply.
