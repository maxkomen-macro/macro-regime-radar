# Desk · backend hardening — report

Branch `desk/hardening`, cut from `main` at `a57f9bf` (2026-09-23). Unattended run: nothing
pushed, `web/` and `CLAUDE.md` untouched, no dependency added (`requirements-api.txt` and
`requirements-api.lock` unchanged), no server started.

## Decisions taken unattended

Where the run would have stopped to ask, it took the conservative option and recorded it here.

1. **The scratch database also got the allocation histories.** The goal asked for a fresh
   `.backup` of the local database with the tier-2 store run against it. The local database (the
   2026-09-15 snapshot) has no `asset_prices`, and the Desk tests read `^GSPC`, `GC=F` and `^RUT`
   from that table, so the copy was filled the way `docs/desk/EVENT_STUDY_REPORT.md` §8 documents:
   `asset_history`, then `desk_history --tier 2`. `asset_history` needs no key here (see 2); it
   made 25 Yahoo downloads and nothing else.
2. **No live EODHD call was made.** `../macro-regime-radar/.env` holds `FRED_API_KEY` and an empty
   `EODHD_API_TOKEN`, and the Actions workflow carries no EODHD token by design, so the store ran
   the way the production refresh does: FRED direct, the three market series through the disclosed
   Yahoo fallback. No token was looked for elsewhere. The with-token count (three EODHD requests)
   is pinned by a test through the real provider code over a mock transport instead. Only
   `FRED_API_KEY` and `EODHD_API_TOKEN` were read from that file, only into the store run's child
   process, and every value was redacted from its captured output.
3. **Tier-2 declared starts are the production path's verified first dates**: WTI
   `1986-01-02` (FRED), `^NDX` `1985-10-01`, `DX-Y.NYB` `1971-01-04`, `JPY=X` `1996-10-30` (Yahoo).
   All four matched the registry, so none changed. With an EODHD token the dollar index would
   likely come from `DXY.INDX` starting about 1980-04 (the owner's 2026-09-21 `asset_prices` copy
   has EODHD's monthly `DX-Y.NYB` from 1980-04-01). Such a run would store it `short` and validate
   would warn. The start was not moved to 1980, because the production refresh has no token and
   moving it would drop nine verified years.
4. **HY OAS's declared start moved from 2023-09-22 to 2023-09-25 (a tier-1 change).** FRED serves
   `BAMLH0A0HYM2` as a rolling three-year window. Since 2026-09-22 that window starts 2023-09-25.
   That covers the deployed store's first full refresh after the merge, a workflow_dispatch run
   created 00:56 UTC 2026-09-23 on `45cdbae`, whose log reads `SHORT BAMLH0A0HYM2 from
   2023-09-25` (`b8bd14b` is its playbook commit), and any fresh copy. With the old declaration, every freshly
   filled store read `short` (a permanent validate warning in production), and the owner-requested
   `test_scratch_every_stored_series_reaches_its_declared_start` failed on a fresh scratch copy. A
   store filled earlier (the owner's, from 2023-09-22) is inside the new declaration. The two
   scratch tests that pinned `2023-09-22` now read the copy's own stored start.
5. **USD/JPY is read at 20:00 ET, not 17:00.** Yahoo dates an FX daily bar by its London day and
   EODHD by its UTC day, so the bar closes between 19:00 and 20:00 New York time. A 17:00 reading
   let a USD/JPY shock enter the dollar index (fixed 17:00) in the same session, which would read a
   value not yet printed. A later reading can only delay an entry by one session, never read ahead.
   It changes every study with a USD/JPY shock and a dollar-index target: those now enter the next
   session. No other study changes, because no other target is fixed at or after 17:00 except gold,
   which always enters the next session. The dollar index keeps 17:00 (the ICE trading day), not
   verified against intraday bars.
6. **WTI is current up to 7 business days behind.** EIA publishes the WTI spot series weekly. On
   2026-09-22 after the close the newest print was 2026-09-15, five business days back, and the
   FRED daily rule (2 days) would call it stale most of the week. The tolerance lives in
   `api/freshness.DESK_SLOW_PUBLICATION`, with the reason printed on the row.
7. **The drawer's `desk_series` verdict judges tier 1 only.** A tier-2 series behind is named in the
   verdict's reason ("Tier 2, reported and not judged: …") and never turns it. `validate_db` judges
   this verdict in full mode, so the verdict is where "tier 2 never blocks" has to hold. The
   inventory rows still show each tier-2 series' own state.
8. **Tier-1 behaviour in `validate_db` is unchanged.** A missing tier-1 series is still a warning
   when the refresh checked it this run (the existing outage rule), and an empty or missing table
   still fails. Only the snapshot comparison's date and row checks now run over tier-1 rows. The
   goal did not ask to tighten tier 1, so it was not tightened.
9. **R-01 recovers by rebuilding the whole generation.** Rejected alternatives: an immediate retry
   inside the build (it cannot outlast a failure that lasts seconds), and patching the result into
   the published generation (a published generation must never change). The transient class is
   `ImportError` (`ModuleNotFoundError` included), with three rebuilds at 10, 20 and 40 s.
   - **Scope:** a first import that fails with another exception class (an `OSError` while a
     library loads, say) is not retried. Allocation's deliberate `ModuleNotFoundError` (answered as
     503) does trigger the three rebuilds on a host without riskfolio; the production image has it.
   - **The 500 window:** until the first rebuild publishes, the affected endpoints still answer 500
     as before. That is `IMPORT_RETRY_S` plus one whole generation build, about 15–20 s here, most
     of it allocation's child process, and longer if the first rebuilds fail too. Mapping it to 503
     would be a new handler contract, so it was left for the owner.
10. **R-02 requires the installed version to equal the pin.** The lock is `pip freeze` of the
    environment the suite runs in (its script says so), and no CI job runs pytest (checked: only the
    Makefile's `test` target does, on the local venv). A drifted venv now fails the lock tests: the
    gate would be testing versions the image does not install.
11. **R-03's sweep resets the provider layer's entitlement cache before each request.** A tokenless
    options call caches `missing_token` as the options family's verdict, and the next options route
    then answers 403 "Options data is not included in the EODHD plan". That message is misleading;
    it only happens without a token. It is existing provider behaviour, recorded under
    Observations and not changed here.
12. **One engine sentence changed**, the one the registry change made false:
    `src/desk/event_study.py` said a planned series was not stored because "the full refresh stores
    tier {REFRESH_TIER} only"; it now says "tiers up to {REFRESH_TIER} only".
13. **Gate databases:** `data/macro_radar.db` (a `.backup` of the local database, so the
    database-backed suites run instead of skipping) and `data/desk_scratch.db` were created in this
    worktree. Both paths are gitignored, and neither is staged.
14. **The store now waits for a clock-fixed bar** (verifier V-07). Market bars were cut at the last
    completed NYSE session, so a refresh between the close and 20:00 ET could store a USD/JPY bar
    still moving (and a dollar-index one before 17:00). `desk_history` now keeps a bar for the last
    session only once that series' declared `fixed` clock time has passed. Under the old rule the
    scheduled runs (07:17 EDT / 06:17 EST, and 20:23 EDT / 19:23 EST) never stored a moving bar;
    only a manual dispatch in that window could. The new rule changes one scheduled case: from
    November to March the evening run starts at 19:23 EST, after the USD/JPY bar has closed
    (19:00 EST) but before the declared 20:00, so that day's bar now waits for the next morning's
    run. That is harmless: market series are replaced whole, and freshness expects only the
    previous session. `asset_history` has the same pattern for `GC=F`; it is allocation's table, outside
    this branch, and noted under Observations.
15. **The full gate ran on a copy of this tree** (without `.git`), with the main checkout's built
    `web/dist` added to the copy, so the two static-bundle tests that need a bundle could run
    without touching this worktree's `web/`.

## 1. Part 1: the three findings in `INTEGRATION_REPORT.md` §7

### R-01 · high: a transient first import left the Desk's worker items failed for the generation

**Cause.** A generation publishes whole. An item that raises stores its error, and a new build
starts only when the database file key moves. When `desk_assets` failed its first
`import src.desk.event_study`, the first generation published with that error; the served
generation already failing it was, by the hold rule, no reason to wait. Then nothing rebuilt the
file. `/api/desk/event-study/assets` answered 500, and so did every free-form study, because
`study_result` waits on `desk_assets`, until a refresh or a restart.

**Fix (`api/worker.py`).** After a publish, if any item's stored error is an `ImportError`, the
worker schedules a rebuild of the same file: a new generation from its own copy of that file, every
item computed again. It runs after `IMPORT_RETRY_S` (10 s), then 20 s and 40 s, at most
`IMPORT_RETRY_ATTEMPTS` (3) times per file.

- A rebuild publishes only when it answers strictly more: at least one item that failed now
  answers, and nothing that answered fails. Otherwise it is dropped whole and the served generation
  stands.
- A rebuild that cannot stage its copy counts as an attempt.
- A new file publishing resets the count.
- After the last attempt the error stands until the file changes, and `last_error` says so.
- `/health/ready`'s `worker.rebuild` shows the pending items and the attempt number.
- The hold rule is untouched. A new file whose item regresses on an `ImportError` is held and
  retried as before (30 s, 60 s), and the rebuild schedule applies once it publishes.

Generation consistency: nothing is patched into a published generation and nothing is carried
across generations. Requests pinned to the first generation keep reading it until the next publish,
as with any swap.

**Tests.**

- `tests/test_desk_api.py::test_a_failed_first_import_of_the_engine_recovers_by_rebuilding_the_same_file`
  injects a one-shot `ImportError` through a meta-path finder on the first import of
  `src.desk.event_study`. The module is removed from `sys.modules` and its package, then restored.
  The Desk's real worker items build from the scratch copy. The test asserts that:
  - the first generation holds `desk_assets` as an `ImportError`, and the endpoint answers 500;
  - a second generation with the same key publishes with no errors, and its presets are new
    objects (rebuilt, not carried over);
  - the assets endpoint and a free-form VIX study both answer 200 ready.
- `tests/test_generations.py`, four synthetic cases: recovery, with every item recomputed; a
  permanent `ModuleNotFoundError` gets exactly 1 + 3 builds and the first generation stands; a
  rebuild that loses another item is dropped and the next one publishes; a new file resets the
  count.
- `tests/test_generations.py`, three more from the verifier's round (§3):
  - V-02: a rebuild whose copy cannot be staged keeps the R-01 sentence in `last_error`.
  - V-03: a file swapped during a rebuild's copy is never published under the served key; the
    rebuild checks the key after the copy and drops it.
  - V-04: the rebuild state is set in the same locked step that publishes the generation, so
    `status()` never disagrees with the generation it reports.
- Before and after: on the base commit's `api/worker.py` the recovery test fails. As committed it
  first fails with `KeyError: 'rebuild'`; without that status line, `wait_published(min_id=2)` times
  out, because the error stays for the generation. Both pass on this branch.

### R-02 · low: the lock tests checked names only

`tests/test_api_lock.py` now also checks `requirements-api.lock` as the tested closure of
`requirements-api.txt`. It walks the closure itself from the installed metadata, evaluating markers
and following extras (`uvicorn[standard]`), independently of `scripts/lock_api_requirements.py`,
and fails on any of these:

- a requirement in the closure (the txt file's own, or any locked package's) that is not pinned;
- a pin its requirement's specifier rejects;
- a pin outside the closure;
- a pin that is not the installed version;
- a duplicate or non-exact line.

A separate test checks that its walk and the script's `closure()` give the same set.

The review's two mutations are now tests. `exchange_calendars==0.0.0` fails ("does not satisfy
requirements-api.txt's requirement exchange_calendars==4.13.2"). Removing `toolz==1.1.0` fails
("required by exchange-calendars … but not pinned"). Other mutations tested: a stray pin, a pin
that satisfies a bare requirement but was not tested (`httpx` a major version up), a duplicate
pin, a range pin, and a txt range the lock does not meet (`riskfolio-lib==7.4.*`). The real lock
passes: 111 pins, and every one is the installed version.

### R-03 · low: the route sweep accepted 404 and read its inventory from the app

`tests/test_desk_api.py` now keeps `ROUTES`, a hand-written inventory of all 51 operations
(47 GET, 4 POST). Each entry holds the request that exercises the route and the status it answers
on a database that predates the first full refresh.

- `test_the_route_inventory_is_the_apps_exactly`: the inventory and the served routes are equal in
  both directions. A dropped endpoint fails, and so does a new one without an entry.
- `test_before_the_first_refresh_every_route_answers_its_expected_status`: every entry answers
  exactly its status, and a 404 is always a failure.
- `test_the_route_sweep_fails_on_a_missing_endpoint_and_on_a_wrong_status`: tests the sweep
  itself. An absent route listed as "404" still fails as "not served", and a wrong status fails.

The edges are hermetic. The provider layer has no token (a typed 503 `missing_token`, never a
network call) and the assistant is off (503, never a model call). The provider routes, skipped
before, are now requested too.

## 2. Part 2: tier-2 daily series

| Key | Series | Store | Shock unit | Declared start | Timing (fixed / known) | Role |
|---|---|---|---|---|---|---|
| `wti` | `DCOILWTICO` | FRED | log return | 1986-01-02 | 14:30 ET / next open | shock, condition |
| `ndx` | `^NDX` (`NDX.INDX`) | market | log return | 1985-10-01 | close / close | shock, condition, target |
| `dxy` | `DX-Y.NYB` (`DXY.INDX`) | market | log return | 1971-01-04 | 17:00 ET / 17:00 ET | shock, condition, target |
| `usdjpy` | `JPY=X` (`USDJPY.FOREX`) | market | log return | 1996-10-30 | 20:00 ET / 20:00 ET (was 17:00) | shock, condition |

All four are prices or levels, so their shocks are log returns; nothing changed there. WTI settled
at −$36.98 on 2020-04-20. The engine's validation (R-17) excludes that value with its reason
instead of logging it, and a study on the scratch copy reports it as `invalid_values: 1`.

What changed:

- **Registry (`src/desk/series.py`).** `REFRESH_TIER = 2`. HY OAS's start (decision 4), USD/JPY's
  timing (decision 5), and WTI's note (weekly publication, the negative print).
- **Store (`src/market_data/desk_history.py`).** `DEFAULT_TIER = 2`, and the call counts are in the
  module docstring. The path is unchanged: FRED series are fetched direct and merged; market
  series go through `api.providers.market.daily_history(..., allow_yahoo=True)` (EODHD first, Yahoo
  disclosed) and are replaced whole. The API process still never imports the writer (pinned).
- **Workflow (`refresh-data.yml`).** The "Store Desk daily series" step runs
  `desk_history --tier 2`, still after `asset_history` and before `rm -f .env`.
- **Freshness feed (`api/freshness.py`).** `DESK_REFRESH_SERIES` lists all nine series with their
  tier; `DESK_SLOW_PUBLICATION` carries WTI's tolerance. The drawer's `desk_series` verdict judges
  tier 1 and names tier-2 laggards. `api/desk.desk_series_specs` carries tier and tolerance, and
  the mirror-parity test still holds.
- **Assets endpoint.** No code change was needed: statuses come from
  `registry.stored_by_refresh`. The four series read `stored` where the copy holds them and
  `awaiting_refresh` where it does not. No available series is `planned` any more; the planned path
  is still tested with the tier set back to 1.
- **`scripts/validate_db.py`.** Tier-2 series are warnings, never failures, in five ways:
  - missing, or behind by its own rule: named by id;
  - short, or failed this run: the existing watermark warnings, now labelled "tier 2, reported,
    never blocking";
  - lost more than a fifth of its rows, or its newest date moved earlier: a per-series warning;
  - both short and behind: both are said (V-11);
  - the table's date and row checks against the previous snapshot run over tier-1 rows only.

  Test: `tests/test_validate_db.py::test_a_missing_short_or_behind_tier2_desk_series_warns_and_never_blocks_the_publish`
  builds a previous and a current snapshot with all four tier-2 series going wrong at once:
  USD/JPY missing with a failed fetch, the Nasdaq 100 short and dated earlier, the dollar index 30
  rows down to 10, WTI weeks behind. The table's newest date moves earlier because of them. It
  asserts `pass`, `upload`, a `current` Desk verdict and a named warning per problem, and a second
  case covers a database with no tier-2 rows at all. On the base commit the same test fails with
  `desk_series: max date regressed`.

  Counterpart: `test_the_same_faults_on_a_tier1_desk_series_still_fail`. A tier-1 date regression,
  or a fifth of tier-1 rows lost, still fails.

### Call counts of a tier-2 run

| Configuration | FRED | EODHD | Yahoo |
|---|---|---|---|
| Measured: the scratch run on this laptop (empty `EODHD_API_TOKEN`), the same as the Actions workflow | **6** (DGS10, DGS2, T10Y2Y, VIXCLS, BAMLH0A0HYM2, DCOILWTICO) | **0** | 3 (`^NDX`, `DX-Y.NYB`, `JPY=X`) |
| With an EODHD token (pinned by `test_with_a_token_a_tier2_run_bills_three_eodhd_requests_and_reaches_yahoo_for_none`, mock transport) | 6 | **3** requests, 3 units (`NDX.INDX`, `DXY.INDX`, `USDJPY.FOREX`) | 0 while EODHD answers; 1 per series it cannot |
| Worst case with retries | 18 (3 attempts each) | 9 (a timeout, 429 or 5xx retried twice) | 3 |

Tier 1 alone was 5 FRED and 0 provider-layer calls, so tier 2 adds one FRED call and three
market-series calls. `asset_history`, a separate step not counted above, made 25 Yahoo downloads
and 0 EODHD calls here. With a token it makes 24 EODHD calls plus Yahoo downloads for `GC=F`
(no EODHD address) and any series EODHD cannot answer (`^RUT` on 2026-09-21).

### The scratch run (2026-09-23 01:05–01:10 ET; last completed session 2026-09-22)

The fresh `.backup` of `../macro-regime-radar/data/macro_radar.db` became `data/desk_scratch.db`.
`asset_history` stored 27 series, all through Yahoo, as of 2026-09-21. Then `desk_history --tier 2`:

| Series | Provider | First | Last | Rows | Watermark |
|---|---|---|---|---|---|
| DGS10 | fred | 1962-01-02 | 2026-09-21 | 16,165 | ok |
| DGS2 | fred | 1976-06-01 | 2026-09-21 | 12,573 | ok |
| T10Y2Y | fred | 1976-06-01 | 2026-09-22 | 12,574 | ok |
| VIXCLS | fred | 1990-01-02 | 2026-09-21 | 9,278 | ok |
| BAMLH0A0HYM2 | fred | 2023-09-25 | 2026-09-21 | 785 | ok (was `short` against 2023-09-22) |
| DCOILWTICO | fred | 1986-01-02 | 2026-09-15 | 9,502 | ok |
| ^NDX | yfinance | 1985-10-01 | 2026-09-21 | 10,322 | ok |
| DX-Y.NYB | yfinance | 1971-01-04 | 2026-09-21 | 14,147 | ok |
| JPY=X | yfinance | 1996-10-30 | 2026-09-22 | 7,752 | ok |

The table watermark read `ok · fred 6 · yfinance 3 (fallback: DX-Y.NYB, JPY=X, ^NDX)`. After the
verifier's round the store was run again at 01:59 ET with the final code (V-07's clock-fixed bar
rule included). It made the same 6 FRED calls, 0 EODHD and 3 Yahoo, and stored the same rows,
dates and statuses: at that hour every clock-fixed bar for 2026-09-22 had printed.
`validate_db --mode full` against the local snapshot read the Desk verdict as `current`, with no
Desk warning (WTI five business days back, inside its weekly tolerance). Its failures all come from
the stale 2026-09-15 snapshot itself: no FRED watermarks, market data and news days old,
`main.py` never run on it.

Studies on the copy:

| Study | Events | Entry | Note |
|---|---|---|---|
| `wti-w5-z2.0-down-none-spx` | 69 | next session | the negative print excluded; 781 sessions without a WTI print (see Observations) |
| `usdjpy-w5-z2.0-up-none-dxy` | 69 | next session | decision 5 |
| `ndx-w5-z2.0-down-none-spx` | 121 | same session | |
| `dxy-w20-z2.0-up-none-ndx` | 43 | next session | |

## 3. Verification

### The gate

The full Python gate is the Makefile's `test` target on the shared venv
(`../macro-regime-radar/.venv`, Python 3.13.9):
`EODHD_PROBE_ON_START=0 python -m pytest tests -q --ignore=tests/test_streamlit_backports.py`.

| Run | Result |
|---|---|
| Final, on a copy of this tree (no `.git`) with the main checkout's built `web/dist` added to the copy (decision 15) | **1016 passed, 0 failed, 0 skipped** in 235 s |
| The verifier's run of the same suite on a tree copy without `web/dist` | 1012 passed, 2 skipped, 2 failed: the two `test_public_posture` static-bundle tests, which fail identically on the base commit without a bundle; the two skips also need the bundle |
| First run in this worktree, before the verifier's round (no `web/dist`) | 1006 passed, 2 skipped, 3 failed: the same two bundle tests, and `test_provider_no_yahoo::test_the_profile_makes_its_two_eodhd_calls_concurrently`, a timing assertion that passed alone and in every later run |

The two gate databases: `data/macro_radar.db` (the local 2026-09-15 snapshot) and
`data/desk_scratch.db` (§2). Before and after on the base commit (a `git archive` of `a57f9bf`, the
same environment):

- the tier-2 validate test fails there with `desk_series: max date regressed`;
- the R-01 recovery test fails there, as described in §1.

### The independent verifier

A fresh agent that had not written the code reviewed the diff read-only, ran its own
reproductions and mutations in a temporary directory, and made no vendor call.

**Round 1: no blocker, no high.**

| ID | Severity | Finding | Outcome |
|---|---|---|---|
| V-01 | medium | this section was a placeholder | filled |
| V-02 | low | a rebuild whose copy could not be staged cleared the R-01 sentence from `last_error` | fixed: `_rebuild_note` restored by the same-file branch; test |
| V-03 | low | a file swapped during a rebuild's copy could publish under the served key, so the Desk study cache would treat two files as one | fixed: the rebuild checks the key after the copy and drops it; test |
| V-04 | low | the rebuild state was set after the publish was visible, so `status()` could disagree with the generation | fixed: set in the same locked step, and `status()` reads under the lock; test |
| V-05 | low | the 500 window was stated as ≤10 s; it is `IMPORT_RETRY_S` plus a whole build | report corrected |
| V-06 | low | `ImportError` only: too narrow for other first-import failures, and broad enough to catch allocation's `ModuleNotFoundError` | scope documented (decision 9, Observations) |
| V-07 | low | the store kept a USD/JPY or DXY bar for the last session before its fixing time | fixed: `desk_history.fixed_by`; test (decision 14) |
| V-08 | nit | report slips: 786 gaps, the refresh run's time, "one pair", the before/after failure mode | corrected (781; the 00:56 UTC workflow_dispatch run, confirmed from its log) |
| V-09 | nit | the lock test ignored markers on the txt file's own lines | fixed; test |
| V-10 | nit | the route inventory covers OpenAPI operations only (not the WebSocket or the SPA catch-all) | documented |
| V-11 | nit | a tier-2 series both short and stale showed one warning; the future-date check is table-wide | fixed (both warned; test); the other part documented |

**Round 2: V-02 to V-11 confirmed closed.** The verifier re-ran its reproductions, checked for
deadlock and for WAL-mode files against the V-03 check, and confirmed that each new test fails on
the round-1 code. It found two new nits, both about the report's wording, and both are corrected:

- V-12: the winter evening run's USD/JPY bar now waits for the morning run, and the morning run's
  time is 07:17 EDT / 06:17 EST (decision 14).
- V-13: the reason the `GC=F` bar changes no study (Observations).

The verifier's own runs: the Desk-related suites, 294 passed; the full suite on a tree copy
without a bundle, 1012 passed, 2 skipped, and the 2 known bundle failures.

## 4. Observations and follow-ups (not changed here)

- **The deployed database holds tier 1 only until the next full refresh after the merge.** Until
  then the assets list shows the four tier-2 series as `awaiting_refresh`, the inventory rows read
  unknown, and `scripts/smoke_public.py` reports that as WARN, not FAIL. Deploy order is unchanged.
- **HY OAS keeps rolling.** A store filled after 2026-09-23 starts on a later date than 2023-09-25
  and reads `short` (a warning), and `test_scratch_every_stored_series_reaches_its_declared_start`
  fails for that copy. The production store is not affected: it merges and keeps what it was
  served. A rolling-window declaration (`rolling_years=3`) would end this; not done here.
- **WTI's EIA history has gaps:** 781 NYSE sessions between 1986-01-02 and its newest print
  (2026-09-15) have no print, 619 of them in 1994–2006 (113 in 2003 alone). The engine counts them as missing sessions and drops the windows that read
  them, so WTI studies rest on fewer windows than the date range suggests.
- **Dollar index with an EODHD token:** `DXY.INDX` probably starts about 1980. Such a run replaces
  the series with the shorter history and warns `short` (decision 3).
- **The provider layer's cached `missing_token` verdict** makes a tokenless options route answer
  403 "not in the plan" after another options call (decision 11). Production has a token, so this
  only affects development.
- **`web/` fixtures predate tier 2.** `engine-assets.json` still shows the Nasdaq 100 as `planned`.
  Only its keys are checked against the engine, and they still match. The page reads live statuses.
  `web/` was out of scope, so vitest was not run.
- **R-01's 500 window:** `IMPORT_RETRY_S` plus one whole build (about 15–20 s here) after a failed
  import, until the first rebuild publishes. A 503 with `Retry-After` for a stored `ImportError`
  would be kinder; it needs a handler contract decision.
- **R-01 retries `ImportError` only** (decision 9): another exception class on a first import still
  stands for the generation.
- **`asset_history` stores `GC=F`'s last-session bar at the NYSE close** although the registry
  fixes gold at 17:00 ET. It is the V-07 pattern in allocation's table. No study result changes,
  because an event on the newest session never has a complete forward window, and the next run
  replaces the bar. Gold is also a shock, and the default preset uses it as one.
- **The route inventory covers the OpenAPI operations only.** The relay WebSocket
  `/api/stream/ws`, and the SPA catch-all when `web/dist` exists, are outside it. The WebSocket is
  covered by `tests/test_stream_hub.py` and `tests/test_security.py`.
- **`validate_db`'s future-date check is still table-wide**, so a tier-2 row dated after tomorrow
  would fail a run. That cannot happen today: market rows stop at the last completed session, and
  FRED serves no future dates.
