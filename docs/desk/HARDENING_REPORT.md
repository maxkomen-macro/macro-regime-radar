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
6. **WTI is current up to 8 business days behind** (7 before the second review, §5). EIA
   publishes the WTI spot series weekly. On 2026-09-22 after the close the newest print was
   2026-09-15, five business days back, and the FRED daily rule (2 days) would call it stale most
   of the week. Since the second review, each WTI print is declared known at 13:00 ET on the
   eighth business day after its date, and the tolerance is that rule's. It lives in
   `api/freshness.DESK_SLOW_PUBLICATION`, with the rule printed in the row's reason.
7. **The drawer's `desk_series` verdict judges tier 1 only.** A tier-2 series behind is named in the
   verdict's reason ("Tier 2, reported and not judged: …") and never turns it. `validate_db` judges
   this verdict in full mode, so the verdict is where "tier 2 never blocks" has to hold. The
   inventory rows still show each tier-2 series' own state.
8. **Tier 1 in `validate_db` was not tightened in the first pass; the second review tightened it
   (§5, R-02).** It now checks each tier-1 series on its own: missing, more than 1% of its rows
   lost, or its newest date earlier each fails. An empty or missing table still fails.
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
16. **V-31: a round-the-clock instrument's trading day is the date in Tokyo.** The store needs each
    market series' "current trading day at its provider", and nothing in the providers' responses
    states it. The registry now declares it per series (`day_zone`): New York's date by default,
    and `Asia/Tokyo` for USD/JPY and the dollar index (and copper, tier 3, not fetched). Their
    trading day starts in Asia, so no provider dates a bar later than that: neither by the London or
    UTC day FX bars take, nor by a next-day trade date taken in the New York evening. The bound is
    deliberately loose. A row between New York's date and Tokyo's is never stored either way; the
    session filter drops it, as before R-10. Only rows past Tokyo's date are called future and
    quarantined. The run-start scan of stored rows uses the same per-series day.
17. **V-32: a damaged previous snapshot fails; no previous snapshot warns.**
    - The previous snapshot's integrity check must hold. A snapshot that fails it is not a
      baseline, like one that cannot be opened ("refusing to publish without a baseline", already
      a failure).
    - When no previous snapshot is given, validate_db now warns that the row-loss, date-regression
      and change comparisons did not run. The memo workflows and a first run pass none by design,
      so this is a warning, not a failure.
    - A failure listing tables or counting a table's rows still raises. It was left as it was:
      that fails the step and prints the error, so it is never silent.
    - Each table's newest-date query stays guarded, not mandatory. `backtest_results` has no
      `date` column, although `DATE_COLUMNS` names one, so a mandatory query would fail every real
      run. The mismatch is recorded in §12, unfixed.
18. **V-33: a value check whose table is absent is not run.** A missing `regimes` or `market_daily`
    already fails as a missing required table, and `asset_prices` is required in full mode only.
    Running the check anyway would add a second, redundant failure. The validator suite's fixture
    now gives `regimes` the four probability columns. Without them, every fixture-based run had
    silently skipped all three checks (the V-33 fault itself).
19. **V-34: "the run's New York date" is the date the series' newest observation was stored.**
    **Superseded by decision 20** (Codex R-14 and R-15, §14): eligibility now comes from provenance, not
    from `advanced_at`.
    The reader already cut at the as-of, the New York date of the read. On the next New York day, a
    hand-stored row is no longer after that, so the as-of alone cannot keep it out once a fetch has
    failed. The second cut is therefore per series, and must survive a failed fetch: the New York
    date of the `desk:<id>` watermark's `advanced_at`, when the store last stored a newer
    observation. A failed fetch leaves that stamp as it was.
    - It is never earlier than a row the store wrote: market rows stop at the last completed
      session, and a tier-2 FRED row dated after the run is quarantined. The one exception is a
      tier-1 FRED row dated in the future, which is stored as served and fails validation anyway
      (V-15). **Contradicted by V-35 (§13, unfixed):** after such a print is repaired by hand, the
      next real observations are cut.
    - It is stricter than the date of the series' last refresh. A refresh that advances nothing
      (a morning run, or a week without an EIA print) does not move it, so a hand row dated after
      it stays set aside. That is conservative: the store wrote nothing after that date.
      **Contradicted by V-36 (§13, unfixed) for the FRED-merged series:** a successful fetch moves
      it forward without replacing a hand row.
    - No schema change: the stamp already exists for every series the store writes. A series
      without a `desk:` watermark (asset_prices series, and synthetic test stores) keeps the as-of
      cut alone.
    - A row cut this way counts in the existing future-dated bucket, named with its own date, so
      no payload key is added (the web fixtures pin the keys).

20. **R-14, R-15: committed-write provenance.** `api/provenance.py` (stdlib + api).
    - **Schema.** `desk_series` gains `run_id` and `ingested_at` (UTC). A `desk_series_runs` table
      records each refresh run: its start, its New York date (`as_of`), and when its first write
      committed.
    - **When a run counts as committed.** The store marks its run committed inside the same savepoint
      as each series' write. A row and its run's commit therefore land together. A run killed after
      three series leaves those three readable and the rest on their earlier rows (R-04's isolation
      holds). A run that wrote nothing never commits.
    - **Migration.** It is idempotent. It adds the columns and the runs table, and back-fills the rows
      stored before it, once, with one synthetic run, `pre-provenance`, marked committed and dated the
      migration's New York date. A row inserted after that has no provenance until a refresh writes
      its date. `ensure_table` still creates the four-column table, so a fresh store and an old one
      take one migration path.
    - **Where it runs.** The store applies it at the start of every refresh. The API applies it to each
      generation's in-memory copy when it stages one: the file stays read-only, and the back-fill is
      dated the staging instant, the generation's own as-of. Any other reader of an unmigrated file
      reads it as the migration would leave it: every row committed, cut at the read's as-of.
    - **The reader's buckets, in order:** a malformed date shape, then no provenance (the hand-inserted
      class, counted, warned and hashed like V-22), then future-dated, then non-numeric, then an
      impossible day. A row is future-dated when it is after the as-of, or after the New York date of
      the run that committed it (named with that date). No payload key was removed. Added keys:
      `no_provenance_excluded` in a study's provenance, and `no_provenance` in each exclusions map.
      Both are absent from the hash when zero, so a clean store hashes as before.
    - **validate_db.** A row with no provenance, or dated after its refresh's New York date, fails for
      tier 1 and warns for tier 2. Both are mandatory checks on each snapshot. An unmigrated snapshot
      (the first run's previous file) reads as pre-provenance.
    - **Not changed:** the run-start scan does not quarantine a row without provenance. The reader
      sets it aside and validate names it, which leaves the owner the evidence.
    - **Removed:** V-34's `advanced_at` cut: `desk_stored_on`, the engine's `_stored_on`, and
      validate's stored-on check.
21. **R-16: "the morning reader must count one exclusion".** The store's scan moves a stored market
    row that is not a completed, fixed session to the quarantine, so after the evening run the row
    is gone and the morning reader returns the 09-21 close. The one exclusion per series is counted
    by that run: `refresh()["excluded"]`, the quarantine, and the watermark's "1 row dated after
    2026-09-21 moved". The test also reads the same seed with the store's scan skipped, migrated at
    the evening instant. There the reader alone sets the row aside and counts one future-dated
    exclusion, since the row is after the pre-provenance run's New York date. Both readings of the
    requirement hold.
22. **R-15's repair path** is `python -m src.market_data.desk_history --repair SERIES [--apply]`,
    read-only without `--apply`. It lists the series' rows the reader sets aside for provenance:
    none, or dated after their run's New York date, which covers a bogus future print. With
    `--apply`, in one savepoint, it moves them to the quarantine and resets `desk:<id>` to the newest
    committed row. `last_obs` becomes that row's date, `advanced_at` the time it was committed, and
    the status `repaired`, so the watermark names an observation a committed refresh wrote. The next
    refresh advances from there. The owner runs it where the database lives (`make sync-data`),
    then publishes as usual.
23. **R-17: every table's newest-date check is mandatory, on both snapshots,** and its column must
    exist (PRAGMA table_info). A table without it is a check not executed, which fails. The verifier
    had checked every mapping against both real schemas: `backtest_results` was the only mismatch,
    and it now reads `computed_at`.
24. **The production snapshot.** At first the command to fetch the published `data-latest` asset
    was denied, so the migration check ran on the local stores closest to it (§14):
    - the Desk stores the real store wrote in both checkouts;
    - the main checkout's local copy of the production database, from 2026-09-15, which has no
      desk_series yet.
    On the owner's instruction, `make sync-data` then fetched the published database, and the
    check ran on a copy of it (§14, "The migration on the published database"). The synced file
    replaced this worktree's gitignored `data/macro_radar.db`, as the target does, and was never
    migrated. The previous file is kept as a backup and was used for the gate.

25. **R-19: a write to a table with provenance must carry it.** `write_series` raises
    `ProvenanceRequired` before touching anything when the table is migrated and the call lacks a
    `run_id` or `ingested_at`, for a merge and a replace alike. It also refuses a stamped write to a
    table not yet migrated. The unstamped path survives only for tables without provenance: the
    engine suite's synthetic stores.
    - **Audit of every writer.** `write_series` is the only code that writes values into
      desk_series, and its only production caller is `refresh`, which passes the run.
    - The memo workflows, `src/analytics/backtest.py`, the dashboard and the API never write
      desk_series. The API writes only the in-memory copy it stages, through `migrate`.
    - The other statements that touch the table are deletes (the run-start scan and the repair) and
      `migrate`'s one back-fill of rows without a run.
26. **R-20: what "changed" means for desk_series.**
    - **What counts as a change (since V-39 and V-40, §17).** A series changes only when what the
      Desk reads changes: a row's value, its date, or its readability. Readable means its run
      committed and the row is not dated after that run's New York date.
    - **The table's fingerprint and each series'** hash exactly that: per row, date, value and
      readable. Which run stamped a row, and that run's date, do not count. A refresh that re-stamps
      identical rows under a new run, on the same day or the next, changes nothing. So does a run
      that commits nothing.
    - **The series named in `changed_tables`** (as `desk:<id>`) are the ones whose readable rows
      changed. A store not yet migrated fingerprints as the migration would leave it (Codex R-26,
      §18): every row committed by the pre-provenance run dated the validation's New York date. So
      a row dated after that is unreadable in both, and migrating a copy names no series.
      Since Codex R-30 (§19), a migrated store's back-filled rows are judged by that same explicit
      cutoff, the run's New York date at validation start, passed to both snapshots, so the two
      sides agree on either side of New York midnight. That settles V-46.
    - `desk_series_runs` joins full mode's publication list, but it counts as changed only together
      with desk_series. A started run, or one that re-stamps identical rows, adds a row there and
      never triggers an upload on its own. Full mode's "nothing new to publish" guard holds for a
      run with identical provider histories.
27. **R-21 and R-22: the repair's guard and its preview.**
    - **Refusal without `--force`:** when the repair would move more than 10% of the series' rows
      (`REPAIR_MAX_SHARE`), or any row older than the provider's window (`REFETCH_WINDOW`). For HY OAS
      that window is three years back from the run's New York date.
    - **The refetch warning** prints whenever such rows move: on the dry run, the refusal and a
      forced apply.
    - **The dry run** is the repair itself, run on an in-memory copy of the database, including the
      migration a legacy table would take. It reports exactly what `--apply` would do. It exits 0
      even when it previews a refusal, and the file is only read.
    - **Replaced tests:** V-37's two tests gave way to R-21's, since the rule changed.
    - **The R-22 repro takes `--force`:** its series has two rows, and moving one of them is 50%.
    - **Since V-41 (§17):**
      - the share prints to one decimal, "(10.2%)", so it reads against "more than 10%";
      - on 29 February the window starts on 1 March three years back, the later and so safer day;
      - a missing path refuses, on the dry run and on `--apply`, with exit 1, and creates no file.

28. **R-23: every fingerprint is a mandatory check, on both snapshots.** That covers the Desk's and
    those of the other tables validate_db fingerprints: raw_series, market_daily, source_watermarks,
    asset_prices and desk_series_runs. A fingerprint query that fails is "not executed" and fails
    validation. It is never read as "unchanged", which is how a failed Desk query had hidden a
    recovery from publication.
29. **R-24 and R-25: the repair's transaction and its input.**
    - **The write lock:** a repair holds the database's write lock (BEGIN IMMEDIATE) from before it
      selects its candidates to its commit.
    - **What it moves:** exactly the checked set, keyed by a temporary table of its dates. It aborts
      if the count moved ever differs from the count checked.
    - **Anything else rolls back:** a refusal, "nothing to repair", or a missing table keeps nothing,
      not even the migration, which the next refresh applies anyway.
    - **A concurrent refresh** either lands before the repair's check, which then sees its rows, or
      cannot write until the repair commits.
    - **The input:** before anything is opened, the repair reads the file's first 16 bytes. A file
      that is not SQLite, or is empty, is refused.

30. **R-27: the schema check fails closed, and the audit of every caught SQLite error.**
    - **`api/provenance.is_migrated` and the new `table_exists`** read the schema, retry an
      `OperationalError` up to three times, and then raise `SchemaCheckFailed`, a subclass of
      `sqlite3.OperationalError`. A store is read without provenance only when a read that completed
      shows the columns absent.
      - **The bound (V-48, §20).** The retries are 0.2, 0.3 and 0.5 s apart, 1 s in all. But each of
        the four reads (the first and the three retries) may also wait out SQLite's busy timeout, 5 s
        by Python's default. The worst case is therefore about 23 s (22.8 s measured), and the error
        message says so.
    - **The engine** no longer catches the check, and treats only a confirmed missing table as "not
      stored". The API answers 503 with `status: "error"` and the reason, for a study and for the
      assets list. validate_db runs the check through `_mandatory`, and nothing that depends on it
      runs.
    - **Every place on the Desk path that branched on a caught SQLite error, and what it does now:**

      | Where | Before | Now |
      |---|---|---|
      | `event_study.load_level`, the provenance check | an `OperationalError` meant legacy: filtering off | fail closed (R-27) |
      | `event_study.load_level`, the reads | any `OperationalError` meant "table missing", so not stored | only a completed read saying the table is absent does; any other error raises |
      | `validate_db.inspect`, market_daily sources | `{}` | mandatory: not executed fails |
      | `validate_db.inspect`, raw_series newest observations (the regime blockers) | `[]` | mandatory |
      | `validate_db.inspect`, source_watermarks | `None` | mandatory |
      | `validate_db.inspect`, asset_prices newest daily closes | no date | mandatory |
      | `validate_db.inspect`, desk_series newest readable observations | no date | mandatory, and skipped only after the schema check failed (itself a failure) |
      | `validate_db._ai_spend`, the month-to-date ledger | `None`, no report | mandatory |
      | `validate_db._fingerprint` / `_desk_fingerprints` | already mandatory (R-23) | unchanged |
      | `provenance.migrate`; `desk_history._undo`, `_savepoint`, `_repair_on`, `_repair_locked` | roll back and re-raise | unchanged: fail closed |
      | `desk_history.refresh`, per series (quarantine, fetch, write) | the series is failed and named | unchanged: reported |
      | `desk_history.refresh`, the failed-series watermark write | ignored; the table's watermark names the series | unchanged: reported there |
      | `desk_history.main` | exit 1, "the store could not run" | unchanged |
      | `api/worker._stage` (the backup and the migration) | staging fails; the last good generation keeps serving, retried | unchanged: fail closed |
      | `api/db._freshness_uncached` (the Desk's newest dates for `/api/freshness` and the pipeline inventory) | `SchemaCheckFailed` became a bare 500 (V-47) | fail closed: the app's handler answers the structured 503 on `/api/freshness`, the inventory and a study (§20); an endpoint outside the Desk serves its data with a freshness block that says it is awaiting the check (V-53, §21) |
      | `api/db._connect` | `DBUnavailable`, 503 | unchanged |
      | `api/db._drop_local`, `api/worker.Generation.close` | ignored on close | unchanged: cleanup, no decision |
      | `src/analytics/dbpath.open_generation` | a released copy gives None, and the caller reads the file | unchanged, with the reason: the file is read under the same rules (with provenance if migrated, as the migration would leave it if not), so no filtering is lost |
31. **R-28 and R-29: a repair that cannot take the lock, or cannot read the file, refuses.**
    - `repair()` catches `sqlite3.DatabaseError` after `_repair_on` has rolled back.
    - A lock error ("locked" or "busy") refuses: "the database is locked by another writer; nothing
      changed; retry".
    - Any other error refuses: "database unreadable: <SQLite's words>; nothing changed".
    - Both exit 1, in both modes.
    - The repair waits `REPAIR_LOCK_WAIT_S` (5 s) for the lock: `busy_timeout` on `--apply`, the
      connection timeout on the dry run's read.
    - The dry run takes its read lock explicitly before copying. `Connection.backup` retries a busy
      source without end, and an exclusive writer hung it.
32. **V-51: the in-memory copy is read-only by its connection's own mode, and no connection to it is
    left for the garbage collector.**
    - **The mode.** `dbpath.open_generation` sets `PRAGMA query_only = 1` and a zero attach limit
      (`SQLITE_LIMIT_ATTACHED`), and installs no Python callback. A read-only URI was the other option
      the owner named, but a shared-cache memory database cannot take one: `mode=ro` beside
      `mode=memory` opens nothing (tested, "unable to open database file"). Moving the copies to the
      `memdb` VFS, which does take `mode=ro`, would change every generation's storage and each
      reader's memory, on the image's older SQLite; that was not done here.
    - **What query_only now carries alone.** It refuses every write, temp tables and `VACUUM INTO`
      included; the attach limit refuses `ATTACH` and the file `VACUUM INTO` would otherwise create.
      A flip of `query_only` is SQL again, where launch-1's authorizer (NG-2) made it impossible, and
      so is every pragma that does not write, some with process-wide effects (V-55, accepted in
      decision 34). Only
      the app's own SQL runs on the API's connections, and the assistant's query tool, whose guard
      bans `PRAGMA`, opens and now closes a connection per call, so a flip cannot reach a second
      statement. The NG-2 tests were rewritten to pin that.
    - **Thread exit.** Each thread's API connection lives in `api/db._ThreadConnection`, a context
      manager held only by its thread's locals, which closes it when the thread exits, in that thread.
    - **The assistant's tools.** `chat._ro_conn` is now a context manager that closes its connection:
      a connection's own `with` only ends a transaction, so every tool call had left its connection to
      the copy for the collector. The tool keeps the launch-1 authorizer on the file fallback only
      (no shared cache there, so no shared lock), and `dbpath.is_copy` tells the two apart.
    - **The tool's progress handler is gone too (Codex R-32, §23).** It was the last Python callback
      SQLite ran inside a call on the copy. The query tool's budget is now wall-clock only, enforced
      by a timer thread that interrupts the connection (decision 36). No Python runs inside a SQLite
      call on a copy connection. Connections are still closed deterministically as well: the api/db
      threads and the assistant's tools close theirs when their block or thread ends. Since V-54
      (§22) every builder closes its connection in a `finally`, failure included. Since R-33 (§23)
      and V-64 (§24), eleven factories close their connection when their setup fails: the seven
      Codex named, and the refresh's four (`src/utils/db.get_connection`, `fetch_market`,
      `load_events`, `backfill_yfinance`). The worker's staging closes its copy on any error.
      - A static test covers `src/analytics`, `src/desk`, `api/desk.py` and
        `api/assistant_budget.py`.
      - `api/db`, the worker, `api/analytics_cache` and `api/bootstrap` close theirs by design,
        outside that test, as the verifier confirmed (V-59).
33. **The V-49 gap and V-53.**
    - **The flag is the reader's (V-49, V-56).** Every row's readability flag in `_desk_fingerprints`
      is the Desk reader's rule, judged the same way on both snapshots and for every tier: a committed
      run wrote it, it is dated no later than R-30's explicit cutoff, and it is not dated after its
      own run's New York date. Round 18 dropped that last condition and missed a tier-2 re-stamp
      across the run's date (V-56); round 19 restored it (§22). A back-filled row is judged by the
      cutoff alone (R-30), so the V-49 re-stamp of a back-filled row stays unnamed, as §20 recorded.
      Tier decides whether a check fails or warns, never whether a change is named.
    - **Awaiting (V-53).** Outside the Desk, a freshness block whose check could not run is
      `{"status": "awaiting", "reason": "The freshness of these numbers could not be judged this
      time: <the check's message>"}`, and the endpoint serves its own data. The five response models
      with a freshness block now type it `dict[str, Any]`. The LBO defaults add no
      `lbo_all_in_rate` state to an awaiting block, and the snapshot builder keeps one as it is (it
      raised on it).
34. **V-55 is accepted, not fixed.** Without the authorizer, a copy connection accepts every pragma
    that does not write, `hard_heap_limit` and `soft_heap_limit` among them, which act on the whole
    process. The owner's reason: it is reachable only past the SQL guard. Only two kinds of SQL run on
    these connections. The API's own queries are constants in the code. The assistant's query tool
    runs a model's SQL only after `is_safe_select`, which bans `PRAGMA`, including the table-valued
    `pragma_*` functions, and is pinned by `tests/test_chat_sql_guard.py`. A connection that has
    passed the guard is the second wall, and on the copy that wall now refuses writes and attaches,
    not pragmas.
35. **R-31 and V-62: six web files, by scope exception.**
    - **The files.** These are the only web changes on this branch; the owner granted each by name:
      - `web/src/screens/shared/useFreshReport.ts` (R-31, §23);
      - `web/src/screens/recession/RecessionScreen.tsx` (V-62, §24);
      - `ModelInputs.tsx`, `CurveMonitor.tsx` and `TransparencyPanel.tsx` in
        `web/src/screens/recession/`, and `web/src/screens/tools/lbo-copy.ts` (Codex R-31, round 10,
        §26).
    - **The rule.** In the hook, an awaiting block overrides every label its readers build, the
      cached report's and a seeded snapshot's included:
      - the date reads "—";
      - the tone is caution: amber, fresh-state's `delayed` tone, since the tone set lives in
        another file;
      - the server's reason is printed beside the numbers (the label's muted tail) as well as in
        the tooltip.
    - **Recession (V-62, round 10).** The screen and its three panels pass
      `/api/recession/probability`'s block to the hook, like the other screens. Its E3 rule kept that
      block out while it named USSLIND and missed two inputs; since BH1 it names the model's seven,
      and series[] still comes first.
    - **LBO (round 10).** `lbo-copy.ts`'s `componentAsOf`, `componentDetail` and `lboStrip` take the
      same rule through the hook's `isAwaitingBlock` and `awaitingLabel`, one rule in one place.
      `componentAsOf` gives the awaiting label for both components; `componentDetail` gives the
      reason; the strip reads "FRED rate · as of —" in amber with the reason. That covers all five
      call sites: `ToolsScreen.tsx:82`, `FinancingConditions.tsx:81`, `LboHeroRow.tsx:89` and
      `:244`, and `LboPanel.tsx:241`.
    - **Frame-2 merges next and rewrites these files.** The merge takes frame-2's versions, which
      must carry the same rule.
    - **Screens that still date numbers from an endpoint with a freshness block without the rule**
      (an audit of every label call in `web/src`, 2026-09-26; the endpoints are signals, credit OAS,
      credit metrics, recession, LBO defaults and allocation). Frame-2 inherits the list:
      - **`DeskRead.tsx:320`** (`shellFreshness`, the signals group through `lookupFrom`). It has no
        caller today.
      - **Allocation** (`AllocationHeroRow.tsx`, `AllocationPanel.tsx`, `EvidenceTab.tsx`) never reads
        its block. It prints the payload's own `data_end`, which is never a cached date, so it shows
        no awaiting state but dates nothing wrongly.

      Everything else goes through the rule with the block:
      - the Recession screen and its panels, the Credit screens and their LBO helpers, the Tools tab's
        LBO;
      - `TenYearCard`, `KeyLevels` (the 10-year and the curve), `MacroCharts`, the Dashboard's
        signals, Methodology and the ticker;
      - the Today page's `StatusBadge`s (V-63).

      `KeyLevels`' Fed funds and VIX come from `/series/latest`, which has no block. `stampOf`
      (`lbo-copy.ts:226`) prints the payload's own `data_as_of`, never a cached date.
    - **The tests run outside `web/`,** so the web change stays these six files.
      `tests/test_web_fresh_report.py` runs:
      - Codex's repro with node, using TypeScript's own transpiler over the two freshness modules and
        `@tanstack/query-core`'s cache;
      - with vitest in a copy of `web/`: `tests/web/RecessionScreen.awaiting.test.tsx` (the Recession
        route's hero and summary) and `tests/web/AwaitingScreens.test.tsx` (the whole Recession and
        Credit screens).

      They need node and the web dependencies, and skip without them.
36. **R-32, V-60, V-61, V-69, R-34: the assistant's SQL runs on its own private copy, under a 250
    ms timer that interrupts the connection, counted from connect, and an interrupt says how to
    rewrite.**
    - **A copy per tool call (verifier V-80, §27), made from the generation's private copy (Codex
      R-34, §26).**
      - `Generation.private()` builds the private copy on the assistant's first query of that
        generation: a second shared-cache memory database, backed up from the generation's own copy
        in steps of `PRIVATE_COPY_PAGES` (64), so a reader of the shared copy waits at most one step.
        The generation holds it, and `close()` releases it at retirement.
      - Since V-80, the private copy is only a source. Every assistant tool call reads its own copy
        (`dbpath.copy_private_ro`): a plain in-memory database backed up from the private copy in
        64-page steps (2.8 ms on the scratch copy), read-only by its own mode (query_only, no
        attach), and closed in `_ro_conn`'s `finally`.
      - A model's query therefore holds only its own copy's lock. No other visitor's tool call, and
        no screen, waits on it.
      - Before the first generation, the call copies the file itself.
      - The budget, the value cap and the guard are unchanged.
    - `_interrupt_after` starts a `threading.Timer` for what remains of `_QUERY_TIME_BUDGET_S`. When
      it fires, it calls `conn.interrupt()` (C-level `sqlite3_interrupt`) every millisecond until
      stopped.
    - **The budget is 250 ms (V-60, then V-69).** A query holds its copy's lock for as long as it
      runs, which since V-80 is its own copy. A query whose functions run uninterrupted still runs
      as long as they do: Codex's 128 LIKEs, about 16 s. But only its own answer waits. Another
      visitor's fixed-SQL call measured 4.4 ms at most meanwhile, where it waited 17 s with one
      shared private copy (§27).
      - The budget bounds what the tool's statements run between SQLite's interrupt checks.
      - A single SQL function runs uninterrupted. One value is therefore capped at 16 KB, where
        `trim` over a 250 KB value held the lock 13.6 s (V-68, §25).
      - A LIKE or GLOB pattern is capped at 256 bytes (V-84, §28), with SQLite's
        SQLITE_LIMIT_LIKE_PATTERN_LENGTH on each call's connection. That is where the SQL guard's
        cap has to live, since a pattern built at run time (`printf`, `||`) is measured only
        there. A pattern past it answers an error naming the limit. SQLite counts the limit in
        bytes, so accented text gets fewer than 256 characters; since V-89 the constant
        (`_QUERY_MAX_PATTERN_BYTES`) and the error say so.
      - The guard caps a statement's work (V-88, §29, decision 42) before any connection opens:
        2 KB of SQL, 16 function calls (an identifier, bare or quoted, followed by "("), and no
        two-argument `trim`, `ltrim` or `rtrim`.
      - An interrupt's error names the budget alone first ("the query exceeded the 250 ms budget;
        simplify it"), and keeps the rewrite hints as its second sentence (V-88).
      - At 100 ms, natural questions that join on computed month keys (0.2 to 1.6 s) were interrupted
        with no hint. Now an interrupt answers with the budget and how to rewrite: filter by a date
        range, do not join on computed month keys, join on `regimes.date` (the stored first of the
        month), aggregate first (V-69, §25).
    - **The deadline is taken when the tool call connects, before any setup (V-61).** A queued call
      no longer starts a fresh budget once the lock frees. A wait SQLite cannot interrupt (opening,
      closing) can still carry a call past its own deadline when calls arrive staggered: 162 to
      192 ms (V-67, §24).
      - SQLite clears an interrupt as a statement starts, so a single interrupt that landed first was
        lost: a zero budget missed an 11 ms query.
      - The stop joins the timer's thread before the connection closes.
    - **The instruction budget is gone.** It counted VM steps and needed the Python callback. It
      was also the tighter bound: it stopped a 47.8M-row join at about 51 ms, where round 20's 2 s
      clock let it run, holding the copy's shared-cache lock and every other reader with it (V-60).
      The 250 ms clock and the private copy (R-34) replace it. The byte bounds (value length, columns, result bytes) are
      unchanged. The file fallback uses the same timer. Since V-80 it no longer keeps its authorizer: every tool call reads an in-memory copy, the file's included, whose own mode refuses writes and attaches (V-85, V-86, §27).
    - `CLAUDE.md`'s Phase-12 note still describes the progress handler ("aborts a query after ~20M
      VM instructions"), and so does `AGENTS.md`. This branch does not touch `CLAUDE.md`, so the
      owner updates both at the merge.
37. **R-33: a factory closes its connection when its setup fails.** `api/assistant_budget._connect`
    (`ensure_ai_spend_ledger`) and the `_get_conn` of `alerts`, `backtest`, `playbook`, `priced`,
    `surprise` and `volatility` (`PRAGMA journal_mode=WAL`) close the new connection, then re-raise.
    These are the refresh pipeline's and the ledger's own files, not the copy. V-64 (§24) added the
    refresh's four other factories and the worker's staging, which closes its copy on any error. Since
    V-73 (§25) any staging error backs off as a SQLite error does. Only an interpreter exit or an
    interrupt propagates. Round 10 of Codex's review (§26) closed the rest of staging:
    - **R-35:** the copy's own connection opens inside the staging error handler, so a failure to
      open it backs off too.
    - **R-37:** the backoff's exponent is clamped at `STAGE_RETRY_EXP_MAX` (16). After 1,023
      attempts `2.0 ** 1024` overflowed, and retries fell back to every poll.
    - **R-11 (the API plan's review):** the file's key must hold from its sampling to the end of the
      backup, for every build (V-03 had it for a rebuild only). A commit in between copied the next
      file under the previous one's key. The copy is now discarded, with no backoff and no rebuild
      attempt, and the next poll copies the file under its own key (`snapshots_moved` counts these).
    - **R-36:** `dbpath.open_generation` closes its connection on any setup error, a MemoryError
      included, before the error propagates.
38. **V-63, V-65 and V-66 are accepted, not fixed.**
    - **V-63 (nit)** is about styling only: an awaiting state already reaches the Today page's badges
      through the hook. How `StatusBadge` colours it (the glyph only), and a seeded session dropping
      the reason from the badge line, belong to frame-2's badge work, and this branch's web scope is
      two files.
    - **V-65 (low).** The static cleanup check guards against the known patterns; it is not a proof.
      Each factory's actual behaviour is pinned by the repro tests, which make its setup fail and
      check that the connection is closed: eleven factories and the staging. Closing the five
      evasions the verifier built needs a stricter shape rule: the statement after the open must be
      a `try` covering everything up to the return. That is left for a later pass, since the repro
      tests pin the behaviour. This round also covered two of V-65's points: the `get_connection`
      name, and the scan widened to `src/utils`, `src/market_data` and `src/events`.
    - **V-66 (nit).** Four test comments still mention the removed instruction budget. They describe
      no behaviour, and the tests they sit in pass under the timer. `CLAUDE.md` and `AGENTS.md` are
      the owner's to update at the merge (decision 36).
39. **V-67, V-70 and V-72 are accepted, not fixed.**
    - **V-67 (low).** Staggered calls can end past the tool's own deadline: waits SQLite cannot
      interrupt (opening, closing) sit outside the budget. What protects the site is how long a call
      holds the lock, and that stays within the budget: the verifier measured other readers' longest
      wait at about the budget. A call that waits longer than its deadline delays only its own
      answer. Serializing the tool behind a Python lock would add a second queue for the same bound.
    - **V-70 (low).** The budget test pins the owner's end-to-end bound, one call and four at once,
      under 300 ms. At round 21's 100 ms budget, a revert of V-61 alone was caught 8 times in 11. It
      was not re-measured at 250 ms and 300 ms, so it may be caught less often. A deterministic pin
      would patch the connect path's timing, and the owner's test is the bound.
    - **V-72 (nit).** The repeated reason in the Inputs through tooltip is cosmetic, and in
      `recession-copy.ts`, outside this branch's two web files: frame-2.
40. **V-82 and V-83 are accepted, not fixed.**
    - **V-82 (nit): moot since V-80.** Retiring a generation waited for a running assistant statement,
      because closing the private copy needed its lock. A statement now runs on its own per-call
      copy, and the private copy is locked only for a backup step. Measured: `Generation.close()`
      took 1.7 ms during a 64-repetition query, where the verifier measured 8.35 s. Neither
      `_publish` nor `stop()` waits on a statement any more.
    - **V-83 (nit): the screen test's reach.** It renders the Recession and Credit screens, not the
      Tools tab.
      - The three Tools sites call the same `lbo-copy.ts` helpers the Credit screen's Financing tile
        does, and that tile is covered.
      - The verifier's stricter probe (future-dated cached dates, `aria-label` too, the Tools tab)
        passed on this code and failed on the staged code.
      - Frame-2 rewrites these files and can widen the test with them.
41. **V-85 and V-86 are accepted, not fixed.**
    - **V-85 (low): the file fallback copies the file each call.** It serves only two cases:
      - the API before its first generation, whose readiness waits a few seconds for it;
      - the Streamlit dashboard's assistant.

      A call there costs about 5 ms and 20 MB more, freed when the call ends. The authorizer it lost
      guarded writes and attaches, which the copy's own mode refuses, and PRAGMA, which the guard
      refuses. One path for every call keeps the walls and the per-call close the same everywhere.
    - **V-86 (nit): stale comments, and two tests watching the copy's source.** The comments
      describe no behaviour.
      - The R-32 and V-51 tests still pin what they pin on the source connection.
      - The V-80 test checks that every per-call copy is closed, and the R-32 test's registrations
        are on no connection at all: the tool registers nothing, on either side.
      - The unreachable authorizer branch in `_run_query` is harmless, and becomes live again if
        V-85 is reversed. Tidying both is left for the next pass through these files.
42. **V-88: the guard's caps, and the accepted residual, which applies only when the free-form SQL
    tool is on (`ASSISTANT_FREEFORM_SQL`, decision 44).** It ships disabled. The caps, the residual
    and V-92's bypass below describe a deploy that turns it on.
    - **The caps.** `chat.sql_guard_refusal` runs after `is_safe_select`, before any connection
      opens. Each refusal names its limit:
      - **2 KB of SQL**, in bytes;
      - **16 function calls.** An identifier followed by "(" counts, bare or quoted (`"trim"(`,
        `[trim](`, `` `trim`( `` are calls in SQLite). String literals and comments are blanked
        first, and SQL keywords before a parenthesis (IN, AS, EXISTS, OVER, CAST, VALUES …) are not
        calls. A CTE's column list, `x(a, b)`, counts, as the owner's rule reads.
        - The keyword list also exempts the function forms `like(…)`, `glob(…)` and `regexp(…)`
          (V-93, §29).
      - **no two-argument `trim`, `ltrim` or `rtrim`**, at any depth: the character-set form, whose
        cost is the product of its arguments.
      - **Both function caps can be bypassed today (V-92, §29, recorded unfixed; confirmed).**
        - The blanking runs two separate passes, literals then comments, and never recognises
          quoted identifiers. So a `/*`, `--` or `'` inside a quoted identifier or a comment blanks
          the real SQL after it.
        - Example: `SELECT 1 AS "/*", trim(label, 'O') FROM regimes` passes the guard, and SQLite
          runs the two-argument trim.
        - Until that is fixed, only the 2 KB cap bounds a statement's work, and the 25 s repro
          scaled to 2 KB is reachable again: roughly 10 s a call, the verifier's estimate from
          V-88's figures, not measured.
    - **The residual, measured.** The longest single-call CPU hold found under every cap is about
      1.0 s: 2 KB of chained GLOB operators, `(x GLOB p)+…` 177 times.
      - `x` is a 16 KB value and `p` a 256-byte `'*aaa…ab'` pattern: each GLOB costs about 5.7 ms,
        and SQLite never checks for an interrupt between the terms of one row's expression.
      - Measured through the tool on a copy of the published database: 0.98 to 1.04 s wall and 0.97
        to 1.03 s CPU, then the budget error. The same chain of LIKE: 1.01 s.
      - This measurement is this round's own. The verifier's attempt to build and time long
        queries was stopped by a safety classifier, so it is not independently confirmed.
      - The residual assumes the caps hold. With V-92 open, a two-argument trim hidden from the
        guard runs longer.
      - LIKE and GLOB are operators, not "identifier followed by (", so the 16-call cap does not
        count them. Counting them would bound this at about 16 × 5.7 ms, about 90 ms; the owner's
        rule is kept as written.
      - Every other construction tried stays near the budget or under it:
        - GLOB with character classes: 0.60 s;
        - a big sort of recursive rows: 256 ms, interrupted;
        - a CASE chain: interrupted at its jumps, or over 2 KB;
        - `json_patch`: 8 ms;
        - `instr`: limited by the 16 calls.
    - **Accepted, for three reasons:**
      - **A private copy per call.** The hold is on the calling tool's own in-memory copy (V-80),
        a lock no one else waits on.
      - **Readers unaffected.** Another visitor's tool calls answered under 20 ms during it, and
        the screens read the shared copy, which it never touches (the R-34 and V-80 tests run
        exactly this chain).
      - **Concurrency limit four.** `ASSISTANT_MAX_CONCURRENCY` bounds the burst at four calls,
        about four core-seconds, against V-88's 25 s a call.
43. **V-91 is accepted, not fixed.** The prefetch runs on the worker thread that builds
    generations, and its provider retries sleep there. A persistent provider failure can hold a tick
    for 40 to 96 s. It happens once per backoff window, not every tick: each failing series backs
    off, up to 30 minutes. Meanwhile the served generation keeps serving. What waits is everything
    that runs on that thread: a new file's publication, a held item's 30 s and 60 s retries, and an
    R-01 rebuild (V-97, §29). Moving the prefetch to its own thread changes the worker's structure,
    which this pass leaves as it is.
44. **The free-form SQL tool ships disabled (round 27, the owner's decision).** Guarding SQL a
    model writes kept finding ways past the guard (V-88, V-92). So the owner stopped guarding it by
    default.
    - `ASSISTANT_FREEFORM_SQL`, read from the environment, is off unless it is `1`, `true`, `yes` or
      `on`. Off:
      - `query_database` is not in the tools the model is offered (`chat.active_tools()`);
      - a tool request naming it is refused, with no SQL run (`chat._run_tool`): "The
        query_database tool is not enabled on this server; answer with the other tools."
    - The seven fixed-SQL tools, whose queries this module writes, stay: regime, signals, recession,
      credit, markets, headlines, and the current view.
    - The system prompt no longer names the tool. Its principle 5 now reads: refuse to write to
      the database or run SQL that changes it, since nothing here can.
    - `TOOLS` and `_TOOL_IMPLS` still hold the tool, so an enabled deploy gets it guarded exactly
      as before: `is_safe_select`, `sql_guard_refusal`'s caps, a per-call copy, the 250 ms budget,
      and the value and pattern caps.
    - The variable is documented off in `deploy/api.env.example` (`ASSISTANT_FREEFORM_SQL=0`) and
      in `deploy/ENV.md`. `ENV.md` lives on `desk/deploy-prep` (`db042f4`); this branch carries that
      version plus one line on the Assistant row, so the merge meets the two only on that line.
    - `CLAUDE.md`'s Phase-12 notes still list `query_database` among the assistant's tools; the
      owner updates them at the merge (with decision 36's note).

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
- **Future-dated Desk rows** are judged per series (§5, R-03). Every store run quarantines the
  tier-2 ones before it fetches, and the engine reads no row dated after the generation's as-of
  (§6, R-06). A future-dated tier-1 row is still stored as served, and validate fails it.
- **The store was not re-run from the vendors after the second or third review.** Its code changed
  (§5, R-03 and R-04) after the scratch run. The new paths are covered by the writer tests on real
  SQLite files, and the scratch tests pass on the existing copy.
- **A WTI shock's newest events have no entry yet** (§5, R-01). An event in the last eight sessions
  of the data cannot be entered, so it drops out of a study's counts until eight more sessions are
  stored.


## 5. Second review (accepted findings R-01 to R-04)

An independent review of the committed branch (`cc721f0`) raised four findings, all accepted and
implemented. This round is staged, not committed, for a second review.

### Review R-01 · WTI is known eight business days after its date

EIA publishes the WTI spot series weekly, so a study that took a WTI value as known the next
morning could enter a target on a price no desk using FRED could yet see.

**Declared.** `src/desk/series.py` declares each WTI observation known at 13:00 ET on the eighth
business day (XNYS session) after its date: `known = session_clock(8, 13, 0)`, a new rule anchor
meaning "this clock time on the n-th exchange session after the date". `known_note` says why
(EIA publishes weekly).

**The engine** (`src/desk/event_study.py`) generalizes entry from "the event's close or the next
session's" to a delay: the first session whose fixing of the target is at or after every input is
known (`entry_delay_vec`).

- **Pinned:** every existing input keeps the entry it had before. Since the third review (§6, R-05)
  this is checked against 4,410 entries frozen from the `cc721f0` engine, replacing the second
  round's circular comparison.
- **WTI:** a WTI shock enters every target 8 sessions later. The exceptions are 9 sessions, where
  the eighth session is an early close and the target fixes before 13:00: the 10-year Treasury
  (read 30 minutes before the close) and HY OAS (priced an hour before it). From 1995 to 2026 each
  has 73 such entries; every other target is always 8 (verifier V-19).
- **Baseline:** it takes the same delay.

The verdict states it ("WTI crude is taken as known at 13:00 ET on the 8th business day after
(XNYS sessions) (EIA publishes the WTI spot series weekly), so each event enters … 8 sessions after
its date; the baseline takes the same delay"). The provenance carries `entry_delay_sessions`,
each recent event its `entry_delay`, and the entry rule its text. The freshness row states the rule
too, with the tolerance set to the eight business days it implies.

**Tests** (`tests/test_event_study.py`):

- `test_wti_is_declared_known_on_the_eighth_business_day_after_its_date`;
- `test_a_wti_shock_never_enters_a_target_before_it_is_known`. For every session from 1995 and
  every target, the entry's fixing is at or after 13:00 ET on the eighth session, computed
  independently with zoneinfo, and the fixing one session earlier is before it. Studies on a
  synthetic store with the four tier-2 series enter exactly the event date plus the delay, and
  the verdict carries the rule.

### Review R-02 · tier-1 integrity checks per series

`scripts/validate_db.py` checks each tier-1 Desk series on its own, and records those failures
before any table-wide check:

- in full mode, a tier-1 series the table lacks fails ("not stored; the full refresh stores it");
- against the previous snapshot, a tier-1 series fails if it vanished, lost more than 1% of its
  rows, or moved its newest date earlier.

The table-wide (tier-1 aggregate) checks still run after them. A missing tier-1 series used to be
only an outage warning; it now fails (the desk/integration test that pinned the warning was updated).

Test: `tests/test_validate_db.py::test_each_tier1_desk_series_fails_on_its_own_before_any_aggregate`:

- a missing series that the aggregate misses (1,000 → 800 rows is not "more than a fifth");
- 1.5% of one series' rows lost fails, and 0.5% does not;
- one series dated earlier while the others advance;
- every per-series failure listed before the aggregate's;
- a missing series with no previous snapshot.

### Review R-03 · future dates per Desk series

- **Validate.** The future-date check for `desk_series` runs per series: a tier-1 series dated
  after tomorrow fails; any other is a warning. Other tables are judged as before.
- **Store.** `desk_history` excludes tier-2 rows dated after the refresh's own New York date
  (since V-31, §12: after the provider's own trading day for the instrument),
  whether incoming or already stored (FRED rows merge, so a stored one would otherwise persist).
  The series watermark reads `excluded`, naming the count; `validate_db` warns on it and the
  inventory row says so. A tier-1 observation is stored as served, so validate fails it.

Tests: `tests/test_validate_db.py::test_a_future_dated_desk_row_fails_for_tier1_and_warns_for_tier2`
and `tests/test_desk_history.py::test_a_future_dated_tier2_row_is_excluded_and_recorded_while_tier1_is_stored_as_served`.

### Review R-04 · one series' failure never costs the others

- **Savepoints.** `desk_history` opens its connection in autocommit mode and writes each series,
  with its watermark, in its own savepoint. A write that fails part-way rolls back that series
  alone: its previous rows stand, the others keep what they stored, and the failure is recorded
  as `write failed: <type>`.
- **Exit code.** As shipped in this round, the command returned zero whatever happened, including
  when the store could not run at all, saying so on stderr. The fourth review changed that (§7,
  R-08 c): it now exits 1 when a tier-1 series failed or the store could not run, and 0 when only
  tier-2 series failed.
- **Workflow.** The "Store Desk daily series" step has `continue-on-error: true`; `validate_db`
  still judges the table.

Tests (`tests/test_desk_history.py`): `test_a_series_whose_write_fails_is_rolled_back_alone_and_the_run_returns_zero`
(the Nasdaq 100's write deletes its rows, then fails), `test_the_store_command_says_so_when_the_store_cannot_run`
(it asserted exit 0 in this round and asserts 1 since §7) and `test_the_store_step_never_fails_the_workflow`.

### Gate

The full Python gate, on a copy of this tree with the main checkout's `web/dist` added (decision
15): **1024 passed, 0 failed, 0 skipped** in 302 s. That is the earlier 1016 plus eight new tests.
The tier-2 store was not re-run from the vendors this round (§4).


## 6. Third review (R-06 blocking, R-05 low)

A further review of the staged second round raised two findings, both fixed. This round is staged,
not committed, for another check.

### Review R-06 · future-dated tier-2 rows survived a failed fetch (blocking)

**The defect.** The second round cleaned a stored future-dated tier-2 row only inside that series'
write savepoint, which runs only when the fetch succeeds. If WTI's FRED call failed, its bogus row
stayed, and the engine read it: a row dated in the future extends the session calendar and can
become a spurious event.

**Store fix** (`src/market_data/desk_history.py`). Every run starts, before any fetch, by moving
each stored row dated after the run's New York date (since V-31, §12: after the series' own
provider day), for every series that is not tier 1, to a new
`desk_series_quarantine` table (`quarantine_stored_future_rows`). The table is created on first
use and keeps the value, provider, time and reason. Incoming future-dated tier-2 rows are recorded
there too.

- **On a successful fetch,** the series watermark reads `excluded`, with the count.
- **On a failed fetch,** it reads `error`, and the detail names what was moved.
- **The table watermark** lists every series cleaned.

Tier 1 is still stored as served, and `validate_db` fails a future-dated tier-1 row.

**Engine fix** (`src/desk/event_study.py`). The series reader `load_level` reads no row dated after
the as-of, resolved by `resolve_as_of`:

1. an explicit date;
2. else the as-of of the generation the read uses. That is the New York date the copy was staged,
   the new `api/worker.Generation.as_of`, shown in the worker's status. Worker builds get it
   through the pinned generation; a free-form study on the thread pool gets it passed through
   `api/desk._compute`;
3. else today's New York date, for a script or test reading a file.

Provenance carries `as_of_cutoff` and `future_excluded`, the warnings name the rows left out, and
`inputs_hash` covers them. A clean store hashes exactly as before.

**Tests.**

- `tests/test_desk_history.py::test_future_dated_tier2_rows_are_quarantined_even_when_the_fetch_fails`
  is the failed-fetch repro. Future-dated WTI and Nasdaq 100 rows are stored and both fetches fail.
  The rows are quarantined, the real rows stand, the tier-1 row is untouched, and the next run has
  nothing to move. It fails on the second-round code.
- `tests/test_event_study.py::test_the_series_reader_excludes_rows_dated_after_the_as_of`. A store
  with future-dated WTI and S&P rows gives the clean store's study, disclosed and hashed. An
  earlier as-of cuts earlier, and the as-of resolution order is checked.
- `tests/test_desk_api.py::test_the_desk_reads_nothing_dated_after_the_generations_as_of`, end to
  end. The worker-built preset, the assets list and a free-form study on the pool thread all cut at
  the generation's as-of and say what they left out.

### Review R-05 · the entry-regression test was circular (low)

The second round checked "every other input keeps its entry" by comparing `entry_delay_vec` with
`same_session_vec`, which is now derived from it. That block is gone.

**The fixture.** `tests/fixtures/desk_entries_cc721f0.json` (83 KB) holds 4,410 entry sessions
generated once by the `cc721f0` engine (`same_session_entry`, before the entry delay was
generalized), from a `git archive` of that commit. Its generator travels inside the fixture. It
covers:

- every shock but WTI, alone and with a condition input;
- every target;
- fifteen sessions chosen for their edges: early closes (2001-11-23, 2013-07-03, 2019-12-24,
  2025-11-28, 2026-11-27), both DST changes (2007-03-12, 2026-03-09, 2026-11-02), the sessions
  before Good Friday and New Year, Columbus Day, and ordinary days.

**The test.** `tests/test_event_study.py::test_every_entry_but_wtis_is_the_one_cc721f0_froze`
checks the current engine against every entry. It fails when entry is forced to the same session,
and when the defer-as-target rule is dropped; both mutations were checked by hand.

### Gate

The full Python gate, on a copy of this tree with the main checkout's `web/dist` added (decision
15): **1028 passed, 0 failed, 0 skipped** in 250 s. That is the second round's 1024 plus four new
tests.

The first run found one failure: `test_calendar_extends_one_session_past_the_last_input` builds a
synthetic store running to 2026-12-31, after today. The new default as-of (today in New York)
rightly cut it, so the test now passes the as-of its data implies (`as_of="2026-12-31"`); what it
checks (R-22, the calendar one session past the last input) is unchanged.

## 7. Fourth review (Codex round 3: R-07 blocking, R-08 high)

Two findings on the staged third round, both fixed with their repro tests. The R-05 and R-06 tests
are unchanged, and the requirements too. Staged, not committed, for review.

### Review R-07 · the study cache aliased two generations of one file (blocking)

**The defect.** `api/desk._submit` keyed a free-form study on the file key and the parameters. Two
generations staged from one file across New York midnight (an R-01 rebuild, or the retired
generation a pinned request still reads) have the same file key and different as-of cutoffs. A
study cached under the newer one (cutoff Sep 14, 5d N = 1) was served to a request pinned to the
older one (cutoff Sep 13), whose direct computation gives N = 0. The job also resolved its cutoff
on its own, apart from the key.

**The fix.** The key is now (generation id, file key, effective as-of cutoff, lossless
parameters): everything that determines the study's `inputs_hash`, which itself exists only once
the study is computed. The cutoff is resolved once in `_submit` and handed to the job, so the key
and the computation cannot use two dates. Expiry follows the generation's identity (id and file
key), not the file key alone. The expired-lease resubmit in `study_result` compares identity too,
though in serving mode it never fires: the request is pinned to the very generation whose lease
expired. What recovers is the client's retry, pinned to the current generation (verifier V-17).

**The test.** `tests/test_desk_api.py::test_two_generations_of_one_file_with_different_cutoffs_never_share_a_cached_study`
builds a synthetic store with exactly one VIX event, whose 5-session window closes on 2026-09-14,
and two generations of that one file with cutoffs Sep 14 and Sep 13.

- It caches the study under the newer generation and queries under the older.
- The older generation gets 5d N = 0, identical to its direct computation. The newer one got 1.
- The newer generation's finished entry expired when the older one submitted, and a repeat under
  the same generation is a cache hit.
- It failed exactly as reported before the fix.

### Review R-08 · a junk tier-2 row stopped every series (high)

**The defect.** A malformed optional-series row, `('DCOILWTICO', '2099-12-31', 'not-a-number',
'fred')`, made the quarantine's `float()` raise before any fetch. The CLI still exited 0, and no
series refreshed, the tier-1 rates and spreads included.

**The fix** (`src/market_data/desk_history.py`):

- **(a) The value is never converted.** The quarantine copies the stored value in SQL, into an
  untyped column that keeps it exactly as stored, with a `raw` text copy (`CAST(value AS TEXT)`).
  Incoming rows keep their value and its text.
- **(b) Each series is quarantined in its own savepoint.** A failure rolls back that series alone,
  is logged, marks it failed (`quarantine failed: <type>`) and skips its fetch this run; the loop
  goes on to the next series. The engine's as-of cut still never reads that series' future-dated
  row.
- **(c) The exit code separates the tiers.** The CLI exits 1 when a tier-1 series failed, or when
  the store could not run at all, and 0 when only tier-2 series failed. For tier 2 this matches
  validate_db. For tier 1 it is stricter: validate_db only warns when a tier-1 fetch failed this
  run but the series keeps its rows (verifier V-18). This replaces the second
  round's "always returns zero"; the two tests that pinned it now pin the new rule, and the step
  keeps `continue-on-error: true`.

**Tests** (`tests/test_desk_history.py`):

- `test_a_non_numeric_future_tier2_row_is_quarantined_as_text_and_tier1_still_refreshes`: the
  seeded `not-a-number` row lands in the quarantine as text, every tier-1 fetch runs and stores,
  and the exit code is 0.
- `test_a_quarantine_that_fails_fails_its_series_only_and_tier1_still_refreshes`: an injected
  quarantine-insert exception on WTI. WTI is failed and not fetched, the Nasdaq 100 is still
  quarantined, every tier-1 series is fetched and stored, and the exit code is 0.
- `test_the_cli_exits_non_zero_only_when_a_tier1_series_failed`: a tier-2 failure exits 0, a
  tier-1 failure exits 1.

All three failed before the fix.

### Gate and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist`
added: **1032 passed, 0 failed, 0 skipped** in 260 s (the third round's 1028 plus four new tests).

**Verifier.** The independent verifier then reviewed everything since `cc721f0` (rounds 2 to 4).
It confirmed:

- R-07 and R-08 are fixed as described. The R-07 repro fails with the pre-fix key.
- The R-05 fixture regenerates byte for byte from a fresh `git archive cc721f0`.
- R-01, R-03 and R-06 hold at the edges tried.
- Its own runs: 310 passed on the Desk suites; 1032 in all on a tree copy.

It raised eight more findings. Their outcomes are in §8:

| ID | Severity | Finding |
|---|---|---|
| V-14 | medium | a non-numeric value in a past-dated stored row took the Desk down (500s) and validate_db let it through |
| V-15 | low | a future-dated tier-1 row fails validate in every mode and is never removed |
| V-16 | low | a FRED response of only future-dated WTI rows failed as "empty", its rows neither quarantined nor mentioned |
| V-17 | nit | the expired-lease resubmit never fires in serving mode (the report described it as working) |
| V-18 | nit | "the exit code follows validate_db" overstated the match for tier 1 |
| V-19 | nit | §5 still said the store always exits zero, cited a renamed test, and named only the 10-year Treasury as the nine-session exception |
| V-20 | nit | the as-of assertion in the R-06 API test compared against today() and could fail across New York midnight |
| V-21 | nit | a delay reaching `MAX_ENTRY_DELAY` would raise IndexError rather than StudyError (unreachable today: the longest declared delay is 9) |


## 8. Fifth round (the verifier's V-14 to V-21)

The owner decided: fix V-14 and V-16, defer V-15 (below, Accepted exceptions), and correct the
report and the flaky assertion. Staged, not committed.

### V-14 · a non-numeric stored value never takes the Desk down

**The defect.** `load_level` converted every stored value with `float()`. One text value in any
past-dated row of a Desk input (the 10-year Treasury, USD/JPY, or the S&P in asset_prices) raised
ValueError. `desk_assets` and the presets reading that series failed, so the assets list and every
free-form study answered 500. `validate_db` saw nothing: text compares above every number, so the
`close <= 0` check never fired. Such a value persists when the provider no longer serves that date
or its fetch fails.

**Engine: quarantined on read.** The reader selects only numeric stored values
(`typeof(value) IN ('real', 'integer')`), with no Python conversion of anything else. Each value
it leaves out is counted:

- per series in `exclusions[key]["non_numeric"]` and in provenance `non_numeric_excluded`;
- in a warning ("non-numeric stored values quarantined on read and excluded: …");
- in `inputs_hash`, only when there is one, so a clean store hashes as before.

The engine never writes, since a generation is read-only, so "quarantined" means set aside on read.
The stored row stays until the provider serves that date again or someone repairs it; the store
does not move past-dated rows.

**validate_db.**

- A non-numeric desk_series value fails for tier 1 and is a warning for any other series (the
  Desk excludes it either way).
- A non-numeric asset_prices close fails, because that table is allocation's and its rows are the
  Desk's S&P, gold and Russell inputs.

**The test.** `tests/test_desk_api.py::test_a_non_numeric_stored_value_is_quarantined_on_read_and_never_500s_the_desk`
seeds `'n/a'` on 2010-06-01 in DGS10, JPY=X and `^GSPC` of a scratch copy.

- The worker builds with no Desk error.
- `/assets` answers 200.
- A 10-year-shock study answers 200, excluding `spx 1, us10y 1` and saying so, and a USD/JPY study
  excludes `usdjpy 1`.
- `validate_db` fails `desk:DGS10 (tier 1): 1 non-numeric value` and the asset_prices close, and
  warns on JPY=X.
- On the pre-fix engine the same test fails: `desk_assets` and the presets raise
  `could not convert string to float: 'n/a'`.

### V-16 · a response of only future-dated rows is quarantined, not "empty"

When every row FRED serves for a tier-2 series is dated after the run, the rows go to
`desk_series_quarantine` through the same incoming path as R-06, with the value kept and its text.
The series is failed as "served only future-dated rows: N moved to desk_series_quarantine" and a
warning is logged; the run goes on. A quarantine failure there marks the series
`quarantine failed: <type>` (R-08).

Test: `tests/test_desk_history.py::test_a_response_of_only_future_dated_rows_is_quarantined_not_empty`.

### The corrections

- **V-17, V-18, V-19:** §5 and §7 corrected in place. The exit-code history, the renamed test and
  both nine-session exceptions are now stated. The expired-lease resubmit is described as it
  behaves: it never fires in serving mode, and the client's retry recovers. The exit code is
  described as stricter than validate_db for tier 1. The same wording is fixed in the
  `desk_history` docstring and comment.
- **V-20:** the worker now stamps a generation's `staged_at` and `as_of` from one instant, its New
  York date taken through the session calendar's zone (`api.calendar.NY`). The R-06 API test
  derives the expected as-of from the generation's own staging stamp that way, never from today().
- **V-21:** not changed. It is unreachable: the longest declared delay is 9, and the calendar's
  margin is at least 16 sessions.

### Accepted exceptions

**V-15 (deferred), a future-dated tier-1 row fails validation in every mode, and nothing removes
it.** The owner's reason: a future-dated tier-1 row failing validation loudly in every mode is the
intended behaviour. Since Codex R-11 that holds for every row dated after the run's New York date,
in all five modes (full, news-only, market-only, intraday and verify-only). Before R-11, a row
dated one day ahead passed on a one-day allowance, and the modes named here were only three.
Automatic removal is a follow-up, once R-06's tier-2 removal has run in production for a week.
Until then, such a row is repaired by hand.

**V-23 (accepted, round 6), a series whose every stored value is non-numeric shows "awaiting
refresh".** The owner's reason: that series correctly shows "awaiting refresh", returns no 500,
and validate_db reports it (a tier-2 warning, or a tier-1 or asset_prices failure). That is the
intended failure mode.

**V-24 (accepted, round 6), a stored and an incoming future row on the same series and date
collide in the quarantine.** The owner's reason: both rows are junk. The quarantine keeps the
latest (one row per series and date). The module docstring now says "the latest kept per series
and date", not "never lost".

**V-29 (accepted, round 7), a BLOB-typed date in a FRED-merged series makes the store's
`refresh` raise, every run until the row is repaired.** The raise is at `as_of = min(newest)` in
`src/market_data/desk_history.py`, the Python `min()` over the per-series last dates that
`stored_summary` returns (a bytes value beside text); `stored_summary` itself runs only SQL
`MIN`/`MAX` (corrected in round 8, Codex R-13 / verifier V-30). The
owner's reason: validation catches it (for tier 1, a future-date and a malformed-date failure), and
the fix is a stored-row repair, not code.

### Gate and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1034 passed, 0 failed, 0 skipped** in 261 s (the previous 1032 plus the V-14 and V-16 tests).

**Verifier.** Its re-check of this round:

- V-14 is closed for stored values. Every Desk read path goes through the reader. BLOB and NULL
  values are excluded and integers are read as numbers. validate_db flags the value in every mode,
  consistent with V-15.
- V-16 is closed, including its counts, its watermark text and a quarantine failure there.
- V-17 to V-19 are corrected; V-20 is closed (deterministic, with no other behaviour change).
- The V-14 and V-16 tests fail on the pre-fix code.
- Its own runs: 312 passed on the Desk suites; 1034 in all on a tree copy.

**Open, for the owner's decision** (found in this re-check, not fixed; this round stops here as
asked):

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-22 | medium | V-14's fault in the date column: one malformed past date in a Desk input (`1999-99-99`, `2010-02-30`) makes the reader's date parse raise, so `desk_assets` fails and every free-form study answers 500; validate_db reads only `MAX(date)` and misses it (FRED and EODHD send ISO dates, so it is less likely than V-14) | in `load_level`, keep only ISO-shaped dates, parse with coercion and count the rest like the non-numeric values; a matching per-series check in validate_db (tier 1 fails, tier 2 warns) |
| V-23 | low | a series whose every stored value is non-numeric is reported as "awaiting the next full refresh", with no count (no 500; validate_db does report it) | when every row was excluded as non-numeric, raise a NotStored with its own sentence and no `awaiting_refresh` flag |
| V-24 | nit | the quarantine keeps one row per (series, date), newest winning, so a stored and an incoming future row on the same date overwrite each other, and the watermark count (3) can exceed the rows kept (2); this contradicts "never lost" in the module docstring | add `reason` or `quarantined_at` to the key, or reword |
| V-25 | nit | validate_db's warning reads "7752 non-numeric values; the Desk excludes it on read" | "them" for a plural count |

V-21 remains as recorded (unreachable today).


## 9. Sixth round (the verifier's V-22 to V-25)

The owner decided: fix V-22 exactly as V-14 was fixed, for the date column; fix V-25's wording;
accept V-23 and V-24 (§8, Accepted exceptions). Staged, not committed.

### V-22 · a malformed stored date never takes the Desk down

**The defect.** A malformed past date in any Desk input made the reader's date parse raise: for
example `('JPY=X', '1999-99-99', …)`, or `('^GSPC', '1d', '2010-02-30', …)` in asset_prices.
`desk_assets` failed, and the assets list and every free-form study answered 500. `validate_db`
read only `MAX(date)` and missed it.

**Engine.** `load_level` reads a row only when its date is ISO-shaped text
(`typeof(date) = 'text'` and `YYYY-MM-DD` by GLOB). The dates it reads are then parsed strictly,
with coercion, and a row that names no real day (`1999-99-99`, `2010-02-30`) is set aside too.
Each stored row counts in exactly one bucket. The buckets are tested in this order (corrected in
round 7, V-28):

1. a date that is not ISO-shaped text is malformed (from round 7, also one before the
   1900-01-01 floor, V-26);
2. else a date after the as-of is future-dated;
3. else a value that is not a number is non-numeric;
4. else a date that names no real day (`1999-99-99`, `2010-02-30`) is malformed;
5. else the row is read.

So `9999-99-99` counts as future-dated and `2010-02-30` with a text value as non-numeric, while
validate_db, which judges date and value apart, can count such a row under both. Either way the
row is excluded exactly once.

Malformed rows are counted per series (`exclusions[key]["malformed_date"]` and provenance
`malformed_date_excluded`), named in a warning ("stored rows with a malformed date set aside on
read and excluded: …"), and included in `inputs_hash` only when there is one. A clean store hashes
as before, and the engine suite, the frozen `cc721f0` entries and the scratch studies are
unchanged.

**validate_db.** `inspect` counts, per desk_series series, the dates that are not text naming a
real day (`NOT (typeof(date) = 'text' AND COALESCE(date(date) = date, 0))`, with the 1900-01-01
floor added in round 7). SQLite's `date()` returns NULL for
`1999-99-99` and normalizes `2010-02-30` to `2010-03-02`, so both differ from the stored text.

- A malformed tier-1 date fails, and a tier-2 one is a warning.
- A malformed asset_prices date fails, as the non-numeric close does (V-14).
- These checks and V-14's are now judged apart from the regimes and market_daily value checks.
  Those sat in one block that an unrelated schema error skipped whole ("value sanity checks
  skipped"; each runs on its own since V-33, §12); the V-14 checks used to sit inside it and
  could be skipped with it. The counts come
  from `inspect`.

**The test.** `tests/test_desk_api.py::test_a_malformed_stored_date_is_set_aside_on_read_and_never_500s_the_desk`
seeds `('DGS10', '1999-99-99')` (tier 1) and `('JPY=X', '2010-02-30')` (tier 2) in a scratch copy.

- The worker builds with no Desk error, and `/assets` answers 200.
- A 10-year-shock study answers 200 with `malformed_date_excluded == {"us10y": 1}` and the warning.
- `validate_db` fails `desk:DGS10 (tier 1): 1 malformed date` and warns on JPY=X.
- Confirmed failing on the pre-fix code: on the staged engine and validator, `desk_assets` raises
  `DateParseError: month must be in 1..12: 1999-99-99`.

### V-25 · the pronoun agrees with the count

"2 non-numeric values; the Desk excludes them on read" ("it" for one), and the same for malformed
dates ("sets it/them aside on read"). Test:
`tests/test_validate_db.py::test_the_non_numeric_and_malformed_date_warnings_agree_in_number`.

### Gate and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1036 passed, 0 failed, 0 skipped** in 257 s (the previous 1034 plus the V-22 and V-25 tests).

**Verifier.** Its re-check of this round:

- V-22 is closed for every malformed string shape tried: ISO with a time suffix, unpadded, slashed,
  whitespace, full-width digits, `1999-99-99`, `9999-99-99`, `2010-02-30`, `2023-02-29` (with
  `2024-02-29` valid), and BLOB or REAL dates. The engine and `validate_db` classify them alike,
  and each answers 200 with the row set aside.
- Integer and NULL dates cannot be stored at all: TEXT affinity and `NOT NULL`.
- V-25 is closed, and V-23 and V-24 match §8.
- On a clean store nothing changed: the report's studies, the presets and the assets list give
  byte-identical hashes, horizons and verdicts under the round-5 and round-6 engines.
- The new `validate_db` counts are zero on real data.
- Moving the checks out of the value-sanity block changed nothing else.
- Its own runs: 314 passed on the Desk suites; 1036 in all on a tree copy.

**Open, for the owner's decision** (found in this re-check, not fixed; this round stops here as
asked):

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-26 | medium | V-22's fault for dates that are well-formed and real but earlier than the engine can handle: one `0000-01-01`, `0001-01-01` or `1000-01-01` row in a Desk input passes both checks, then the engine raises building its calendar or formatting (`strftime not yet supported…`, `nonexistent time due to daylight savings`), so `desk_assets` fails and every free-form study answers 500; validate_db reports nothing (1700 and later are fine; the writer never produces such dates) | bound the date in both places, e.g. `date >= '1900-01-01'` (the earliest declared start is 1962), counting earlier rows as malformed |
| V-27 | low | the freshness layer reads the raw stored `MAX(date)`: a malformed date that sorts after the newest real one (`'2026-09-21x'`) makes the series read "not stored yet" and the drawer's tier-1 verdict stale (validate_db fails that tier-1 date anyway, so only the drawer and inventory wording is wrong) | compute `desk_series_latest` over valid ISO dates only, in `api/db.freshness` and `validate_db.inspect` |
| V-28 | nit | §9 and the `load_level` docstring give the bucket order as "malformed date, then after the as-of, then non-numeric", but only the ISO *shape* is tested first; whether the date is a real day is tested only among rows on or before the as-of with a numeric value. `9999-99-99` counts as future-dated in the engine (malformed in validate_db), and `2010-02-30` with value `n/a` as non-numeric. Each row is still excluded exactly once | parse the date for every ISO-shaped row before bucketing, or describe the actual order |
| V-29 | nit | a BLOB-typed date in a FRED-merged series becomes that series' `MAX(date)`; the store's `min()` over bytes and str then raises TypeError, so the store exits 1 ("could not run") and skips the table watermark every run until the row is repaired (validate_db catches it; pure corruption) | read `MAX(date)` over valid ISO dates only in `stored_summary`, as for V-27 |

Also noted: §9's predicate is written without the `COALESCE` the code uses; the meaning is the
same.


## 10. Seventh round (the verifier's V-26 to V-29), the last verifier round on this branch

The owner decided: fix V-26 and V-27, correct V-28's wording, and accept V-29 (§8). New verifier
findings are recorded here unfixed, for Codex to judge next. Staged, not committed.

### V-26 · a date before 1900 is malformed

A well-formed, real, but far-past date (`0000-01-01`, `0001-01-01`, `1000-01-01`) passed V-22's
checks. The engine then raised building its calendar or formatting dates ("strftime not yet
supported", "a nonexistent time due to daylight savings"), so the assets list and every free-form
study answered 500, and validate_db reported nothing.

- **Engine and validate_db:** both now require the date on or after `1900-01-01`, alongside the ISO
  check. That is `DATE_FLOOR` in `src/desk/event_study.py` and `DESK_DATE_FLOOR` in
  `api/freshness.py`, which validate_db reads (it stays stdlib + api/).
- **Handling:** a row before the floor is malformed, handled exactly like V-22: set aside on read,
  counted, warned, hashed, and failed by validate_db for tier 1 (warned for tier 2).
- **The floor is safe:** the registry's earliest declared start is 1962.

**Tests.**

- `tests/test_desk_api.py::test_a_date_before_the_floor_is_set_aside_on_read_and_never_500s_the_desk`
  seeds `0000-01-01` and `1000-01-01` in DGS10.
  - `/assets` and a 10-year-shock study answer 200, with `malformed_date_excluded == {"us10y": 2}`
    and the warning.
  - `validate_db` fails `desk:DGS10 (tier 1): 2 malformed dates`.
  - Confirmed failing on the pre-fix code: `desk_assets` raises `strftime not yet supported…`.
- `test_the_date_floor_is_one_value_below_every_declared_start` pins the two floors equal and
  below every declared start.

### V-27 · freshness reads the newest date the reader would keep

`api/db.freshness` and `validate_db.inspect` read each Desk series' newest date as the raw
`MAX(date)`. A junk date that sorted last (`2026-09-21x`) made the 10-year Treasury read "not
stored yet" in the Data Pipeline inventory, and turned the drawer's tier-1 verdict stale.

Both now take `MAX(date)` over the rows the engine's reader keeps, up to the as-of:

- **Predicate:** `api/freshness.desk_readable_sql()`, meaning ISO-shaped text naming a real day on
  or after the floor, with a numeric value.
- **As-of in the API:** the generation's as-of, else today in New York (`api/db._desk_as_of`).
- **As-of in validate_db:** the run's New York date (`inspect(..., as_of=)`).

The per-series future-date and tier-1 integrity checks still read the raw per-series maxima
(`desk_series_by_id`), since they exist to see such rows.

**Test.** `tests/test_desk_api.py::test_a_junk_date_that_sorts_last_never_makes_a_series_read_not_stored`
adds `('DGS10', '<newest>x')` to a scratch copy.

- The inventory row reads the real newest date, not "not stored yet".
- So do `db.freshness()` and `validate_db.inspect`.
- It failed on the pre-fix code: the row read no date.

### V-28 · the bucket order, as the code tests it

The `load_level` docstring and §9 now state the order as tested:

1. not ISO-shaped text on or after the floor is malformed;
2. else after the as-of is future-dated;
3. else a value that is not a number is non-numeric;
4. else no real day is malformed.

They also note that validate_db, which judges date and value apart, can count a row under both.

### Gate and verifier

**Gate.** The full Python gate, run once on a copy of this tree with the main checkout's
`web/dist` added: **1039 passed, 0 failed, 0 skipped** in 282 s (the previous 1036 plus the three
tests above).

**Verifier** (the last round on this branch). It found:

- **V-26 closed.** At the floor's edges the engine and validate_db agree (`1899-12-31` malformed in
  both, `1900-01-01` read by both). A study with rows on 1900-01-02 answers normally. No real data
  is below the floor: the earliest desk_series date is 1962-01-02, the earliest asset_prices date
  1971-01-01.
- **V-27 closed.** On a copy seeded with every junk shape, the newest date per series is identical,
  for all nine series, in what `load_level` reads, `api/db` freshness and `validate_db.inspect`.
  The as-of in each place is right, and rows between the run's date and the staging date cannot
  exist (the store quarantines tier 2; validate fails tier 1).
- **V-28 closed.** The wording matches the code.
- **Clean store unchanged.** The report's studies, the presets and the assets list are
  byte-identical under the round-6 and round-7 engines, and the frozen `cc721f0` entries pass.
- **Nothing else broken.** Imports are unchanged in weight, and validate_db stays stdlib + api/.
- **Pre-fix failures.** The round-7 tests fail on the staged pre-fix code as described.
- **Its own runs:** 366 passed and 2 skipped (bundle tests) on the requested suites; 1039 in all on
  a tree copy.

**New finding, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-30 | nit | §8's V-29 entry says `stored_summary` raises on `min()` over bytes and text. `stored_summary` runs only SQL `MIN`/`MAX`; the Python `min()` that raises is in `refresh` (`src/market_data/desk_history.py`, `as_of = min(newest)`), over the per-series `last` values `stored_summary` returns | name `refresh` in the entry |

## 11. Eighth round (Codex round 4: R-08 to R-11 high, R-12 and R-13 low)

Codex's round 4 raised six findings, all fixed here, plus one constant for the date floor. Each new
test was confirmed failing on the staged pre-fix code. Staged, not committed.

### R-08 · a failed RELEASE left the savepoint open (high)

When WTI's `RELEASE` failed (`database is locked`), `_savepoint` re-raised without closing it, and
the transaction stayed open. Every later series was then written inside it. Closing the connection
rolled them all back, while the store had already reported them stored.

**The fix** (`src/market_data/desk_history.py`):

- A failed `RELEASE` is handled like any failure inside the savepoint, by `_undo`: `ROLLBACK TO`,
  then `RELEASE`. If that fails too, `ROLLBACK`, which covers only this series' work, since each
  series' savepoint is the outermost.
- The series is failed (`write failed: <type>`).
- `_assert_clean` requires the connection to be outside any transaction at every savepoint's start
  and after every undo. A `DirtyConnection` stops the run (exit 1) instead of writing on.
- The connection comes from a one-line `_connect` seam.

**Test.** `test_a_failed_release_rolls_that_series_back_and_every_later_series_still_stores`
injects `OperationalError("database is locked")` on WTI's `RELEASE`.

- WTI keeps its previous rows and is reported failed.
- Every later series stores its new rows, and its watermark advances.
- What the store reports as stored is what the database holds.
- On the pre-fix code, the Nasdaq 100 was "stored" but the database still held its old rows.

### R-09 · the corruption checks can no longer be skipped (high)

The V-14, V-22 and V-26 counts sat in one `try` with a freshness query using `MIN()`. With `MIN`
denied, the block was skipped whole, and four DGS10 faults passed as zero.

**The fix.** Each mandatory check runs on its own in `inspect` (`_mandatory`):

- per-series rows and dates, which feed the tier-1 and future-date checks;
- non-numeric values and malformed dates, per series;
- the asset_prices non-numeric closes and malformed dates.

A check that cannot run is named in `checks_not_executed`, and `validate` fails it in every mode
("check not executed: …; a mandatory check that did not run never counts as clean"). The report
also carries a `corruption` section, printed in the step summary, with the counts and anything
not executed.

**Test.** `test_the_corruption_checks_run_whatever_else_fails_and_one_that_cannot_run_fails`
denies `MIN` with an SQLite authorizer and seeds four DGS10 faults: a non-numeric value,
`1999-99-99`, `1000-01-01` and `2026-12-31`.

- In all five modes the run fails, `upload` is false, and the three failures and the counts are
  named.
- With `typeof` denied instead, the checks read "not executed" and fail.

### R-10 · market future rows are quarantined before the session filters (high)

A market provider's future-dated rows were cut by the last-session and fixing-time filters before
the future split. They were never quarantined, and an all-future response failed as "empty".

**The fix.** Tier-2 rows dated after the run are now split off the raw response first, whichever
the store, and quarantined. Only then do market rows meet the session filters.

- An all-future response is failed as "served only future-dated rows: N quarantined". That is now
  the one wording for both stores; the V-16 test follows it.

**Test.** `test_market_series_serving_only_future_dates_are_quarantined_not_empty`: the Nasdaq
100, DXY and USD/JPY each serve only 2099 dates. It checks the six quarantined rows, the
per-series exclusion counts and the failure message.

### R-11 · Desk dates are compared with the New York as-of (high)

The per-series future-date check compared each Desk series' newest date with tomorrow in UTC. At
2026-09-05 22:00 UTC (18:00 in New York, still the 5th) a DGS10 row dated 2026-09-06 passed. The
check now compares with the run's New York as-of, the cutoff every other Desk check uses. Other
tables keep their one-day allowance.

**Test.** `test_a_desk_row_dated_after_the_new_york_date_fails_every_mode` fails in all five modes;
the New York date itself is not future. V-15's accepted-exception text (§8) now states what is
true: every mode, every row dated after the run's New York date, since this fix.

### R-12 · each asset row names what the reader left out (low)

`assets_with_coverage` carries the reader's counts into each stored asset's row:
`exclusions: {future, non_numeric, malformed_date}`, and `warnings` in the words a study uses.

**Test.** `test_each_assets_row_names_what_the_reader_left_out` checks the 10-year Treasury's row
names DGS10's four faults (1, 1 and 2), and a clean series' row carries zeros and no warnings.

### R-13 · V-29's text names `refresh` (low)

§8's V-29 entry now names `refresh` and its `min(newest)` in `src/market_data/desk_history.py`, not
`stored_summary`. This was also the verifier's V-30.

### One date floor

The 1900-01-01 floor is defined once, `api/freshness.DESK_DATE_FLOOR`, and imported by the engine
(`DATE_FLOOR`) and read by `validate_db`. The equality test stays, now with an identity check and
a check that neither module spells the date itself.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1044 passed, 0 failed, 0 skipped** in 271 s (the previous 1039 plus the five tests above).

**Clean store against `cc721f0`.** Both engines ran on the same `data/desk_scratch.db`: the
`cc721f0` engine from a `git archive` export, and this tree's. Both runs used the same file, so the
file key in `inputs_hash` is the same. Compared: `inputs_hash`, horizons, regimes, recent events
(setting aside the `entry_delay` key added since) and verdicts.

- **My run:** 17 studies (the three presets; every shock and every target at least once; a
  condition study; two WTI studies). 15 are byte-identical; only the two WTI studies differ.
- **The verifier's run:** 83 studies (every shock × target pair at w = 5, z = 2 in both signs; the
  three presets; three condition and regime studies). All 76 non-WTI studies are byte-identical;
  the 7 WTI studies differ.
- **Why WTI differs:** R-01 moved its known time to the eighth business day, as designed. Its event
  counts and sample spans are unchanged; only the entry timing, and so the results, moved.

**Verifier.** Its re-check of this round:

- **R-08 closed.** Failures were injected at every step of the cleanup: RELEASE once; RELEASE again
  inside `_undo`; ROLLBACK TO; all three. In each case either the series rolls back alone and every
  later series stores, or the run stops (exit 1) with nothing reported stored that is not held.
- **R-10 works as designed,** but introduced V-31 below.
- **R-11, R-12, R-13 and the single floor constant are closed.**
- **R-09 is closed for the current snapshot** (V-32 below is the previous one).
- **Report:** §8 and §11 match the code.
- **Its own runs:** 371 passed and 2 skipped (bundle tests) on the Desk suites with `test_api`;
  1044 in all on a tree copy.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-31 | medium | **A regression this round introduced (R-10).** The evening full run (00:23 UTC = 20:23 EDT / 19:23 EST) runs after the London/UTC day has rolled over, but before New York's. USD/JPY's in-progress daily bar is dated by that next day (decision 5). Before this round the last-session filter dropped it, correctly. Now the future split runs first, so the bar is quarantined as "future-dated" every evening: JPY=X's watermark reads `excluded`, validate_db warns every evening run, and the quarantine gains one spurious row a day. It is non-blocking (tier 2), but it turns the future-dated signal into daily noise that would hide a real one | for market series, quarantine only rows dated after the provider's own current day (e.g. after `today_ny + 1 day`), leaving a row dated the next calendar day to the session filter as before |
| V-32 | medium | the previous snapshot's mandatory checks are never judged. If `desk_series_by_id` cannot run on it, the tier-1 row-loss and max-date-regression checks are skipped silently and the comparison falls back to the table-wide 20% rule (repro: DGS10 losing 6% of its rows passes with `MAX` denied on the previous snapshot only). The previous snapshot's `integrity` is not judged either | fail (or at least report) the previous snapshot's `checks_not_executed` whenever a comparison depends on it, and judge its integrity |
| V-33 | low | the value-sanity checks (non-positive closes in market_daily and asset_prices, regime probabilities outside [0, 1]) still share one `try`, so an unrelated fault skips them with only a warning (repro: a `^GSPC` close of −5 and a market_daily close of −1 pass when `regimes.prob_goldilocks` is missing). Predates this branch; §11 scopes R-09 to V-14/V-22/V-26 | run each through `_mandatory` |

## 12. Ninth round (the verifier's V-31 to V-33)

The three findings §11 recorded, all fixed here. Each new test was confirmed failing on the staged
pre-fix code. Staged, not committed.

### V-31 · the evening run's in-progress FX bar is in progress, not future (medium; a regression from R-10)

The evening full run (00:23 UTC) starts after London's day has rolled over and before New York's.
USD/JPY's bar in progress is dated that next London day. R-10 split future rows off against New
York's date before the session filters, so it quarantined that bar every evening: an `excluded`
watermark, a warning in every evening validation, and one spurious quarantine row a day.

**The fix** (`src/desk/series.py`, `src/market_data/desk_history.py`):

- A market row is future-dated only when it is dated after its provider's own current trading day
  for that instrument (`provider_day`, from the registry's new `day_zone`, decision 16). That day
  is New York's date for FRED and the Nasdaq 100, and the date in Tokyo for USD/JPY and the dollar
  index.
- The in-progress bar goes back to the session filter, which drops it, as before R-10.
- Rows past the provider's own day are still quarantined. The reason names that day: "served,
  dated after 2026-09-22, its provider's current trading day (the date in Asia/Tokyo)".
- The run-start quarantine of stored rows judges each series by the same day.
- validate_db's future-date check and the engine's reader keep New York's as-of as their cutoff.
  The store never writes a market row past the last completed session, so only a row written by
  something else could fall between the two days. Such a row is set aside on read while it is dated
  after the as-of, and afterwards while it is dated after the New York date on which its series'
  newest observation was stored (V-34, §13), so a failed fetch never lets it in. validate_db warns
  on it (tier 2). The next successful fetch replaces it, since market series are replaced whole.

**Tests** (`tests/test_desk_history.py`):

- `test_the_evening_run_drops_the_in_progress_fx_bar_and_quarantines_nothing` runs the refresh at
  2026-09-22 00:23 UTC and again a day later. USD/JPY and the dollar index serve their completed
  days plus a bar in progress dated the next day. Across both evenings:
  - nothing is excluded or quarantined, and no row accumulates;
  - no warning is logged, and neither watermark says `excluded`;
  - the completed day is stored once its fixing time has passed.
  - On the pre-fix code, both bars were quarantined every evening.
- `test_the_evening_run_still_quarantines_a_row_past_the_providers_own_day`: at the same hour a
  2099 USD/JPY row is quarantined, alone, with the reason above and an `excluded` count of one.
  The pre-fix code quarantined two rows: the 2099 row and the in-progress bar.
- `test_every_series_declares_its_providers_day_and_it_is_never_before_new_yorks` checks that only
  the two round-the-clock tier-2 series declare Tokyo and that every zone resolves. It also checks
  the scan's premise: no series' day is earlier than New York's.

### V-32 · the previous snapshot's mandatory checks are judged too (medium)

Only the current snapshot's `checks_not_executed` failed. With the previous snapshot's per-series
Desk query unable to run, its rows were absent. The tier-1 row-loss and date-regression
comparisons then compared nothing, and the previous snapshot's integrity was never read.

**The fix** (`scripts/validate_db.py`):

- The integrity check is a mandatory check (`_mandatory`) on both snapshots.
- Every previous-snapshot check that cannot run fails, in every mode: "check not executed on the
  previous snapshot: …".
- When the previous snapshot holds `desk_series` but its per-series check did not run, a failure
  also says that the tier-1 row-loss and date-regression comparisons did not run.
- A previous snapshot whose integrity check does not return `ok` fails (decision 17).
- The report's `corruption` section carries `previous_not_executed`, and the step summary prints
  each as "NOT EXECUTED on the previous snapshot".
- With no previous snapshot given, the skipped comparisons are named in a warning.

**Test.** `test_a_previous_snapshot_check_that_cannot_run_fails_every_mode_and_is_named` uses a
previous snapshot with 30 rows per tier-1 series, and a current one where DGS10 holds 10.

- With every check able to run, the comparison fails DGS10's row loss.
- With `MAX` denied on the previous snapshot alone, every mode fails, and the failures, the report
  and the summary name the check.
- On the pre-fix code, full mode passed with no failures at all.
- With the previous snapshot's `integrity_check` pragma denied, every mode fails and names it.

### V-33 · each value sanity check on its own (low)

The regime-probability check and the two non-positive-close checks (market_daily, asset_prices)
shared one `try`. An error in any of them, such as a `regimes` table without the probability
columns, skipped all three with only a warning.

**The fix.** They run one by one from `VALUE_SANITY`, each through `_mandatory`. One that cannot
run is "not executed" and fails. The other two still run and report their faults. Their counts are
in the `corruption` section and the summary. The old "value sanity checks skipped" warning is gone.

**Test.** `test_each_value_sanity_check_runs_on_its_own_and_one_that_cannot_run_fails` is
parametrized over the three checks. It seeds one fault for each check, breaks one check's column
(a dropped probability column, or a renamed close), and asserts in every mode:

- the broken check is "not executed" and fails;
- the other two report their faults;
- no "skipped" warning is left.

All three cases fail on the pre-fix code. The validator suite's fixture now carries the regime
probabilities, and `test_value_sanity` no longer adds them.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1051 passed, 0 failed, 0 skipped** in 274 s. That is §11's 1044 plus seven tests: three for V-31,
one for V-32 and V-33's three parametrized cases.

**Clean store against `cc721f0`.** The same 17 studies as §11, both engines on the same
`data/desk_scratch.db`:

- 15 are byte-identical in `inputs_hash`, horizons, regimes, recent events and verdicts.
- Only the two WTI studies differ, for R-01's reason; their event counts and sample spans are
  equal.
- This round's output is byte-identical to §11's: the store and validator changes reach no study.

**An observation of mine, recorded unfixed.** `validate_db.DATE_COLUMNS` maps `backtest_results`
to a `date` column. The table has none: its columns are id, test_name, cohort, horizon, metric,
value and computed_at. Its newest-date query therefore always fails and reads as no date, so its
max-date regression has never been compared. That query stays guarded rather than mandatory
(decision 17): made mandatory, it would fail every real run until the mapping is corrected
(probably to `computed_at`, which is for the owner to confirm).

**Verifier.** Its re-check of this round:

- **V-31 closed.** It re-ran the repro with a stub dating USD/JPY by the London day and DX-Y.NYB by
  a trade date that rolls at 20:00 ET, at 09-22 11:17Z, 09-23 00:23Z, 09-23 11:17Z and a winter
  evening (12-09 00:23Z).
  - On the staged code, both bars in progress were quarantined each evening, and the quarantine grew.
  - On this tree nothing was excluded or quarantined, and the completed days were stored.
  - It agreed that a bar dated after Tokyo's date is future, and that Tokyo is never behind either
    dating rule, in any season.
- **V-32 closed.** It denied the previous snapshot's integrity pragma: all five modes fail and name
  the check, `--allow-stale` included. That fails closed with no override, consistent with the
  existing "refusing to publish without a baseline".
- **V-33 closed.**
  - The skipped-block warning is gone.
  - The fixture change matches the real `regimes` schema.
  - The extra integrity pass costs 0.26 s on the 18 MB scratch database.
- **No regression.**
  - The engine, `api/` and freshness are untouched this round.
  - The workflows' `--previous` calls are unchanged. The memo workflows and the Makefile now get the
    "no previous snapshot" warning, which is harmless.
  - It checked every `DATE_COLUMNS` mapping against both real schemas: `backtest_results` is the
    only mismatch.
- **Its runs:**
  - 378 passed, 2 skipped (the bundle tests) on the Desk, validator, freshness, workflow and API
    suites.
  - 1047 passed and 2 failed (the two bundle tests) on a tree copy without `web/dist`: 1051 in all.
  - All seven new tests fail on the staged round-8 code.
- **Report:** decisions 16 to 18 and §12 match the code, except V-34.

**New finding, recorded unfixed:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-34 | nit | §12's V-31 bullet on the cutoffs says that a round-the-clock row stored by something else and dated between New York's and Tokyo's dates is "left out of every study, and replaced by the next successful fetch". The run-start scan deliberately leaves such a row ("a bar in progress, not future"), and the engine cuts at New York's date. So the row is left out only until New York's date reaches it. If that day's fetch fails, the row is not replaced, and the engine reads it as a real observation. Repro from the code: `_quarantine_stored_series` runs only for rows past Tokyo's date; the engine cuts at the generation's New York as-of; `write_series(merge=False)` replaces the series only on a successful fetch | reword the bullet to "left out of studies until New York's date reaches it, and replaced by the next successful fetch"; or quarantine stored round-the-clock rows past New York's date, since the store never writes one and any such row was written by something else |

## 13. Tenth round (the verifier's V-34)

V-34 is fixed here. The `backtest_results` date-column observation in §12 is left unfixed for
Codex. Each new test was confirmed failing on the staged pre-fix code. Staged, not committed.

### V-34 · a hand-stored row stays set aside through a failed fetch

A USD/JPY row dated New York's tomorrow, stored by something other than the store, was set aside
only while its date was after the as-of. On the next New York day, a failed fetch left it in the
table, and the engine read it as a real observation. §12's sentence claiming it was "left out of
every study" was wrong.

**The fix.** On read, a desk_series row is set aside when it is dated after the as-of, or after
the New York date on which its series' newest observation was stored (decision 19). That date comes
from the `desk:<id>` watermark's `advanced_at`, and a failed fetch leaves it as it was. The rule
holds whichever process stored the row (except for the FRED-merged series after a successful
fetch: V-36 below, unfixed), and whatever day the store judges incoming rows by. The
store's write-side rule (V-31, Tokyo's date for round-the-clock instruments) is unchanged.

Such a row is set aside the way V-22 and V-26 rows are:

- **Counted and hashed:** it counts in the future-dated bucket, so `future_excluded` and
  `inputs_hash` carry it. `future_cutoff` holds the date it was cut at.
- **Warned:** "rows dated after the New York date their series' newest observation was stored on
  excluded: usdjpy 1 (after 2026-09-21)". The /assets row says the same.
- **Excluded from studies.**
- **Freshness** reads only what the reader keeps (V-27), in `api/db.py` and validate_db, through
  one shared query, `api/freshness.desk_latest_query`.
- **validate_db** fails such a row for a tier-1 series and warns for a tier-2 one, in every mode.

**Tests.**

- `tests/test_event_study.py::test_a_hand_stored_row_after_its_series_last_refresh_is_set_aside_until_a_refresh_replaces_it`
  runs the real store (`refresh`) on the synthetic store. Monday evening's run stores USD/JPY
  through Monday, then a row dated Tuesday is stored by hand.
  - That evening's study excludes it and names it.
  - On Tuesday, after a successful fetch, the fetched Tuesday bar replaces it, and nothing is
    excluded.
  - On Tuesday, after a failed fetch, the hand row stays in the table but is set aside. The
    study's horizons, regimes, recent events and verdict equal those of the same store without the
    hand row. Its `inputs_hash` differs by the exclusion. Freshness and /assets read Monday.
  - On the pre-fix code, the failed-fetch branch read the hand row (`future_excluded == {}`).
- `tests/test_validate_db.py::test_a_desk_row_after_its_series_stored_on_date_fails_tier1_and_warns_tier2`:
  a DGS10 and a USD/JPY row dated one day after their series' stored-on date. DGS10 fails and
  USD/JPY warns in every mode, and freshness reads the day before. On the pre-fix code, full mode
  passed with no failures.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1053 passed, 0 failed, 0 skipped** in 271 s. That is §12's 1051 plus the two tests above.

**Clean store against `cc721f0`.** The same 17 studies, both engines on the same
`data/desk_scratch.db`:

- 15 are byte-identical in `inputs_hash`, horizons, regimes, recent events and verdicts.
- Only the two WTI studies differ, for R-01's reason; their event counts and sample spans are
  equal.
- This round's output is byte-identical to §11's and §12's. On that store every series' newest
  row is on or before the New York date of its watermark's `advanced_at`, so the second cut sets
  nothing aside.

**Verifier.** Its re-check of this round:

- **The owner's scenario passes.** The USD/JPY test drives the real `refresh`. Both new tests fail
  on the staged code.
- **Decision 19's premise holds** on a simulated timeline of real `refresh` runs with realistic
  providers. After every run, each series' stored maximum was on or before the New York date of
  its `advanced_at`, and the reader cut nothing. The runs covered:
  - a first run, an evening run, then the next morning;
  - FRED revising in place, and FRED dropping its newest observation, then restoring it;
  - a shorter market history;
  - WTI's weekly release;
  - failed fetches, then a recovery;
  - an evening run after the DST change.
- **Two exceptions to that premise:** V-35 and V-36 below.
- **No regression.** On the scratch copy, 81 outputs are byte-identical between the staged round-9
  engine and this round's: every shock×target pair, the three presets and the assets list. The
  API, /assets, presets, inventory and web payload-key tests pass.
- **Its runs:**
  - 380 passed, 2 skipped (the bundle tests) on the Desk, validator, freshness, workflow and API
    suites.
  - 1049 passed and 2 failed (the two bundle tests) on a tree copy without `web/dist`: 1053 in all.
- **Report:** accurate on §12's rewritten bullet, the tests and the gate. Decision 19's first two
  bullets and §13's "whichever process stored the row" are contradicted by V-35 and V-36. They are
  marked above, not rewritten.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-36 | medium | The owner's rule fails for the FRED-merged series: the five tier-1 rates and spreads, and WTI. FRED posts the next day, so a successful fetch never serves the hand row's date, and the merge keeps the hand row. The fetch does serve a new observation dated the day before, which moves `advanced_at` to the hand row's own date. The hand value is then read as a real observation until FRED publishes that date and the upsert overwrites it. Repro: the owner's test on DGS10 and DCOILWTICO. After the Monday 09-21 evening run, hand rows dated 2026-09-22 are stored. Monday, they are excluded, and validate fails DGS10 as future. Tuesday 09-22 evening, after a successful refresh serving through 09-21, `us10y` reads the hand value 99.0 on 2026-09-22 with nothing cut, the same for WTI, and validate says nothing. The run-start quarantine does not move them either, since they are dated New York's today | Cut desk_series rows dated after the newest date the store itself wrote for the series: a monotone per-series maximum over the rows each committed write served, carried in the `desk:<id>` watermark. That one stamp covers a failed fetch, a successful FRED fetch that does not serve the hand row's date, market replace-whole, FRED dropping its newest observation, and V-35. `last_obs` alone would falsely cut a stored row after FRED drops its newest observation |
| V-35 | low | After a V-15 bogus future print on a tier-1 FRED series, `last_obs` is that future date. The first run after a hand repair lowers `last_obs` ("revised") but leaves `advanced_at` at the bogus run. That run's legit new observations, dated after that day, are set aside, and validate fails tier 1 in every mode with a false "the store did not write it". It clears on the next run that brings a new observation, and persists if none arrives. Repro: a Monday 09-21 run serves DGS10 through 09-18 plus 2026-12-31; the owner deletes the bogus row; a Thursday 09-24 run serves through 09-23. The reader's last is 09-21 (09-22 and 09-23 cut), and validate fails "desk:DGS10 (tier 1): max date 2026-09-23 is after 2026-09-21" | the same stamp as V-36; at minimum, add "and reset its `desk:<id>` watermark" to V-15's hand-repair instructions |

## 14. Eleventh round (Codex round 5: R-14, R-15, R-16 blocking; R-17 high; R-18 low)

All five fixed here. R-14 and R-15 share a root cause: row eligibility was inferred from the
`advanced_at` watermark. That is replaced by committed-write provenance (decision 20). Each new test
was confirmed failing on the staged pre-fix code. Staged, not committed.

### R-14 and R-15 · eligibility from committed-write provenance (blocking)

**The cause.** V-34 read a desk_series row only up to the New York date of its series' watermark
`advanced_at`. Two things broke that:

- **R-14:** a successful FRED fetch moved that stamp to a hand row's date without replacing the row,
  because FRED rows are merged.
- **R-15:** a bogus future print held the stamp back after the print was deleted.

**The fix** (`api/provenance.py`, `src/market_data/desk_history.py`, `src/desk/event_study.py`,
`api/freshness.py`, `api/db.py`, `api/worker.py`, `scripts/validate_db.py`):

- Every row carries the refresh `run_id` that committed it and `ingested_at`.
- The reader keeps a row only when its run committed and its date passes the date checks: ISO,
  the floor, and not after the as-of or its run's New York date.
- A row without provenance is set aside, counted, warned and hashed like V-22.
- validate_db fails a tier-1 one and warns on a tier-2 one.
- Rows stored before provenance are back-filled once with the synthetic, committed `pre-provenance`
  run, so today's data stays readable.

**Tests** on a copy of the scratch store, as Codex ran them (`tests/test_event_study.py`):

- `test_r14_a_hand_row_a_successful_fred_refresh_never_served_is_set_aside`. After the September 21
  evening refresh, DGS10 and WTI rows dated September 22 are inserted by hand, valued 99. The
  September 22 evening refresh then succeeds with FRED serving through September 21.
  - Both rows are excluded, and the reader, /assets and the study name them.
  - Validation fails (DGS10, tier 1) and warns on WTI (tier 2).
  - The SPX→US10Y study (w=5, z=1.5, both signs) has a five-session baseline N of 7,405.
- `test_r15_a_repaired_future_print_leaves_the_next_refreshs_rows_readable`. The September 21 run
  stores a bogus DGS10 2026-12-31 print. It is deleted, then the September 24 refresh serves
  through September 23.
  - September 22 and 23 are readable, and validation names no corruption.
  - The same study has 372 events.
- `test_r15_the_repair_path_moves_a_bogus_future_print_and_reconciles_the_watermark`: the documented
  repair (decision 22). The dry run lists the print and writes nothing. `--apply` quarantines it and
  resets `desk:DGS10` to 2026-09-18, stamped at the committing run. The next refresh advances to the
  23rd, and the study has 372 events.
- The same flows run on the staged code and on this tree:

  | | Staged (round 10) | This tree | Codex's clean figure |
  |---|---|---|---|
  | R-14 five-session baseline N | 7,406 | **7,405** | 7,405 |
  | R-15 events | 371 | **372** | 372 (the cc721f0 engine) |

- The V-34 lifecycle test now asserts provenance. The hand USD/JPY row has no run: it is excluded
  that evening, replaced after a successful fetch, and still excluded after a failed one.
- `tests/test_validate_db.py::test_a_row_no_committed_refresh_wrote_fails_tier1_and_warns_tier2`
  checks the validator on a migrated store, and that an unmigrated store reads as pre-provenance.

### R-16 · stored market rows are judged as completed sessions (blocking)

The run-start scan used the provider's day (Tokyo) for stored FX rows, so a stored 09-22 row
survived the evening and morning runs whenever the fetch failed.

**The fix.** The provider's day now only classifies incoming bars in progress (V-31, unchanged).
`stored_bound` judges a stored market row as a completed session: one dated after the last completed
New York session, or on it before its fixing time, is moved to the quarantine at the start of every
run. FRED rows keep the run's New York date.

**Test:** `tests/test_desk_history.py::test_a_stored_fx_row_for_an_unfinished_session_never_reads_after_a_failed_fetch`,
Codex's repro. DXY and USD/JPY are seeded with 09-18 and 09-21 rows and a 09-22 row valued 999, with
no watermark, and both providers fail at 00:23Z and 11:17Z.

- The evening run quarantines each 999 row and counts one exclusion per series.
- The morning reader returns the 09-21 close, never 999.
- On the same seed with no store run, the reader alone sets the row aside and counts one exclusion
  (decision 21).
- On the pre-fix code, neither run moved the rows.
- V-31's evening tests still pass.

### R-17 · backtests compared on computed_at, mandatory on both snapshots (high)

`DATE_COLUMNS` mapped `backtest_results` to `date`, a column it does not have. SQLite read
`MAX("date")` as the string itself, so a rollback passed. It now compares `computed_at`; each table's
newest-date check is mandatory on both snapshots, and the column must exist (decision 23).

**Test:** `tests/test_validate_db.py::test_a_backtest_rollback_fails_every_mode`.

- The previous snapshot has `computed_at` 2026-09-04 and the current one 2020-01-01, with equal row
  counts and one news row added.
- Every mode fails with "backtest_results: max date regressed 2026-09-04T12:00:00 →
  2020-01-01T12:00:00". On the pre-fix code, full mode passed.
- A `backtest_results` table without `computed_at` is a check not executed, which fails, on either
  snapshot.

### R-18 · the assets test asserts the effective per-series cutoff (low)

`test_each_assets_row_names_what_the_reader_left_out` now asserts against the effective cutoff: the
as-of, or the New York date of the run that committed the row when earlier.

`test_an_assets_row_names_its_refresh_date_when_the_generation_is_staged_after_it` adds the case
where the generation is staged after that date. The file was migrated on 2026-09-23, and that day's
run committed a DGS10 row dated 2026-09-24. Today's generation names 2026-09-23, not the as-of.

### The migration on production-shaped stores

The published `data-latest` asset could not be fetched here (decision 24). The check copies each
store, reads every registry series and the freshness dates before and after `migrate`, and compares
them row for row:

| Store | desk_series | Rows back-filled | Readable rows before → after | Freshness | Second migrate |
|---|---|---|---|---|---|
| This worktree's `data/desk_scratch.db` (the real store's output, 2026-09-23) | yes, 9 series | 93,098 (all) | 118,132, identical | identical | back-fills 0 |
| The main checkout's `data/desk_scratch.db` (2026-09-21) | yes | 51,371 (all) | 76,404, identical | identical | back-fills 0 |
| This worktree's and the main checkout's `data/macro_radar.db` (production copies, 2026-09-15) | no | 0 | unchanged | unchanged | no-op |

In each store with desk_series, no row was left without provenance, and every readable row (the
asset_prices series included) reads the same after the migration.

**To run the same check on the published asset,** fetch it with `make sync-data` or
`gh release download data-latest -p macro_radar.db -D <dir>` and apply `api/provenance.migrate` to a
copy. The first full refresh after the merge does exactly that to the published file.

### V-37 · a repair that would empty a series refuses without --force

`--repair SERIES --apply` on a series none of whose rows has provenance moved its whole history to
the quarantine, printed "watermark reset to None", and left the watermark as it was.

**The fix** (`src/market_data/desk_history.py` `repair`, the CLI):

- Such a repair refuses unless `--force` is given. It says how many rows it would quarantine, and
  that the provider cannot serve them again where its history is shorter than the store's. It exits
  1 and changes nothing.
- With `--force`, the warning is still printed.
- The result says what happened: "moved N rows to desk_series_quarantine; watermark reset to
  <date>, the newest committed row", or "watermark left unchanged: no committed row remains".

**The HY OAS refetch limit.** FRED serves BAMLH0A0HYM2 as a rolling three-year window (its series
notes since April 2026). The published store holds 787 rows of it, and the store keeps every
observation it was ever served. A row older than FRED's current window that is moved to the
quarantine cannot be fetched again: it survives only in `desk_series_quarantine`. `REFETCH_LIMIT`
names the series, and its message says so. For any other series, the message says that rows older
than the provider still serves cannot be fetched again.

**Tests** (`tests/test_desk_history.py`):

- `test_a_repair_that_would_quarantine_a_whole_series_refuses_without_force`: HY OAS with every
  row's provenance removed. `--apply` exits 1 and prints the count and the rolling-window sentence;
  rows, quarantine and watermark are unchanged. DGS2 gets the generic sentence.
- `test_a_forced_repair_quarantines_the_series_and_says_the_watermark_is_unchanged`: `--force`
  moves every DGS2 row and says the watermark was left unchanged. A DGS10 repair that leaves
  committed rows resets it to 2026-09-17, the newest committed row.
- On the staged code, the first test emptied the series (exit 0), and the second failed on the
  unknown `--force`.

### The migration on the published database

`make sync-data` fetched the published `data-latest` asset: 16,240,640 bytes, updated
2026-09-24T17:56:54Z, validation pass, integrity ok. `api/provenance.migrate` then ran on a copy of
it. The file itself was hashed before and after: sha256 `656d7ca8…5c12d` both times, still without
provenance columns.

| | On the copy |
|---|---|
| Desk rows found | 51,381 in the five tier-1 series: DGS10 16,166 · DGS2 12,574 · T10Y2Y 12,575 · VIXCLS 9,279 · BAMLH0A0HYM2 787 |
| Rows back-filled to `pre-provenance` | 51,381, all of them. One run, committed, dated 2026-09-24; no row is left without provenance |
| Readable rows before → after | 76,418 → 76,418 (51,381 desk_series + 25,037 asset_prices for spx, gold and rut), identical row for row across all 8 stored series |
| Freshness before → after | identical. desk_series 2026-09-22; per series BAMLH0A0HYM2 2026-09-23, DGS10 2026-09-22, DGS2 2026-09-22, T10Y2Y 2026-09-23, VIXCLS 2026-09-22; asset_prices 2026-09-23, market_daily 2026-09-23 |
| A second `migrate` | back-fills 0; readable rows, freshness, schema and runs identical |

The first full refresh after the merge applies exactly this to the published file. Today's data
stays readable.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate, on a copy of this tree with the main checkout's `web/dist` added:
**1059 passed, 0 failed, 0 skipped** in 275 s. That is §13's 1053 plus six tests: R-14, the two
R-15 tests, R-16, R-17 and R-18's new case. The V-34 validator test became the provenance one.

**Clean store against `cc721f0`.** The same 17 studies, both engines on the same
`data/desk_scratch.db` (unmigrated, so both read every row):

- 15 are byte-identical in `inputs_hash`, horizons, regimes, recent events and verdicts.
- Only the two WTI studies differ, for R-01's reason.
- This round's output is byte-identical to §11's, §12's and §13's.
- All 4,410 frozen entries of `tests/fixtures/desk_entries_cc721f0.json` pass
  (`test_every_entry_but_wtis_is_the_one_cc721f0_froze`).

**Verifier.** Its re-check of this round:

- **R-14 and R-15 closed. Provenance held under every attack:**
  - A run interrupted mid-way, and a hard kill inside a series' savepoint. The next open rolls the
    hot journal back and `integrity_check` returns ok; that run's earlier series stay readable and
    the interrupted one keeps its earlier rows.
  - A hand row FRED later serves: set aside until then, after which the upsert gives it the run's
    provenance and FRED's value.
  - The API's staging migration on the rebuild and hold paths. On an unmigrated file it costs 29 ms
    for 93,098 rows, and it is a no-op once the store has migrated the file.
  - 81 outputs identical on an unmigrated and a migrated copy of the scratch store.
  - A lean-mode validate on an unmigrated file: the provenance checks are skipped, so nothing is
    blocked before the first full refresh.
  - A hand row that forges a committed `run_id` is out of scope: whatever can write the file can
    also write the runs table.
- **R-16 closed.** `stored_bound` never moves a row the store wrote. Checked: evening, morning,
  19:23 EST in winter, a 16:30 ET manual dispatch, Thanksgiving and the early-close Friday.
  - On decision 21: once the scan has quarantined the row, the reader counts 0. The exclusion is
    disclosed by the store (its `excluded`, the quarantine, and the watermark detail the Data
    Pipeline inventory shows), not in a study's or /assets' warnings. The reader-only variant counts
    one. It considers both readings acceptable. If Codex meant the study payload literally, the
    quarantine count would have to be surfaced in the reader.
- **R-17 and R-18 closed.** `computed_at` is written as `now().isoformat()` on every full reload
  (`src/analytics/backtest.py`), so it moves only forward.
- **All eight new tests fail on the staged code:** five on the behaviour, three because the new
  module or `repair` is missing.
- **No regression.** The web payload subset check passes with the added keys, and the import pins
  hold (`api/provenance.py` is stdlib + `api.calendar`).
- **Report:** decisions 20 to 24 and §14 match the code. The 118,132 readable rows are 93,098
  desk_series rows plus 25,034 asset_prices rows.
- **Its runs:**
  - 386 passed, 2 skipped (the bundle tests) on the Desk, validator, freshness, workflow and API
    suites.
  - 1055 passed and 2 failed (the two bundle tests) on a tree copy without `web/dist`: 1059 in all.
- **Process note:** `api/provenance.py` is new, and the staged set imports it, so it is staged with
  this round.

**New finding, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-37 | low | `--repair SERIES --apply` on a series with no provenance at all moves its entire history to the quarantine, with no warning. It leaves the watermark as it was while printing "watermark reset to None". For a merged FRED series whose source no longer serves its history (HY OAS, a rolling three years), the removed rows cannot be fetched again; they survive only in the quarantine table. Repro: a migrated store with DGS2's `run_id` set to NULL on every row, then `desk_history.main(["--db", db, "--repair", "DGS2", "--apply"])`. It exits 0 with "187 row(s) set aside … watermark reset to None", 0 DGS2 rows remain, and the watermark is still `('2026-09-21', 'short')` | refuse, or require an explicit `--all-rows`, when the repair would remove every committed-looking row or more than a set share of a series; print "watermark left unchanged (no committed row remains)"; for a merged FRED series, warn that the removed rows cannot be fetched again |

## 15. Twelfth round (V-37, and the migration on the published database)

V-37 is fixed, the HY OAS refetch limit is recorded, and the migration was checked on a copy of the
published `data-latest` database. All three are in §14. Staged, not committed.

### Gate

The full Python gate ran on two copies of this tree, each with the main checkout's `web/dist`
added.

- **On the pre-sync local database**, the one every earlier gate used (a backup taken before
  `make sync-data`): **1061 passed, 0 failed, 0 skipped** in 284 s. That is §14's 1059 plus the two
  V-37 tests.
- **On the synced published database:** 1059 passed and 2 failed:
  `test_asset_history.py::test_without_the_table_the_endpoint_says_the_histories_are_not_stored`
  and `::test_validate_requires_the_table_in_full_mode_only`.
  - Both copy `data/macro_radar.db` expecting a local snapshot without an `asset_prices` table ("the
    local snapshot has no asset_prices table"), and the published database has one.
  - The staged round-11 tree fails them identically on the same file, and so does the branch's base,
    `a57f9bf`. They predate this branch and depend on the database's state, not on this round, and
    are recorded here unfixed. `INTEGRATION_REPORT.md` §8 already says to gate on a snapshot without
    asset_prices. The robust fix is for the two tests to drop the table from their own copy.

### Verifier

Its re-check of this round:

- **V-37 closed.**
  - A series with no provenance refuses without `--force`, exits 1, changes nothing and names the
    count, with the HY OAS rolling-window sentence or the generic one.
  - The dry run and a forced apply print the warning, and the result line says what happened to
    the watermark.
  - On the staged code, the refusal test emptied the series and the `--force` test was rejected by
    argparse.
- **The published database, reproduced independently** on its own backup copy, taken through a
  read-only connection:
  - 51,381 desk rows, all back-filled to the committed `pre-provenance` run.
  - 76,418 readable rows before and after (51,381 desk_series; asset_prices `^GSPC` 9,248, `^RUT`
    9,248 and `GC=F` 6,541), identical by count and by a content hash of every series.
  - Freshness identical, and a second `migrate` back-fills 0.
  - `validate --mode full` on the migrated copy records provenance and finds no row without it.
  - The file itself: sha256 `656d7ca8…5c12d` before and after, four columns, no runs table,
    `is_migrated` False.
- **The two database-state failures** predate the branch (see the gate above).
- **No regression.**
  - On the pre-sync snapshot, without `web/dist`: 1057 passed and 2 failed (the bundle tests), 1061
    in all.
  - On the published copy: 1055 passed and 4 failed (the bundle tests and the two above).
- **Report:** decision 24 and §14's additions match the code and its figures. The asset's
  `updated_at` cannot be checked offline.

**New finding, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-38 | low | The V-37 guard keys on "no row has provenance", not on how much the repair removes, so a repair that empties or nearly empties a series by another route runs with no refusal and no refetch warning. Repro on a tier-1 store, HY OAS with 186 rows, `--repair BAMLH0A0HYM2 --apply`: (1) every row without provenance is refused, exit 1, as intended; (2) all but one row without provenance: exit 0, 185 rows quarantined, no warning; (3) every row committed, but by a run whose `as_of` precedes them all (`UPDATE desk_series_runs SET as_of = '2020-01-01'`): exit 0, all 186 rows quarantined, "watermark left unchanged: no committed row remains", no warning. The owner's ask named only the no-provenance case, so this meets its letter | refuse without `--force` whenever the repair would leave the series empty (`len(rows) == total`) or remove more than a set share of it; print the refetch note whenever the rows it moves include ones older than the provider's window (for HY OAS, three years) |

## 16. Thirteenth round (Codex round 6: R-19 blocking, R-20 high, R-21 and R-22 low)

All four fixed here. Each new test was confirmed failing on the staged pre-fix code. Staged, not
committed. The repros are Codex's own, from its review session's scripts.

### R-19 · no value is replaced under another run's provenance (blocking)

`write_series` without provenance overwrote a value and kept the old row's `run_id` and
`ingested_at`. The engine read it with no exclusion, and validation found nothing.

**The fix (decision 25):** on a table with provenance, a write without it raises
`ProvenanceRequired` before it deletes or writes anything.

**Test:** `tests/test_desk_history.py::test_a_write_to_a_table_with_provenance_requires_it`, Codex's
repro.

- Start from a committed DGS10/2026-09-04 of 4.0.
- An unstamped merge and an unstamped replace both raise. The row keeps 4.0 and its original run
  and time.
- A stamped write stores 99.0 with the new run, and the engine reads it.
- A table not yet migrated takes an unstamped write and refuses a stamped one.

### R-20 · a refresh that only restores provenance is published (high)

The Desk fingerprint omitted provenance, and full mode's publication list omitted the runs table,
so a refresh that made rows readable again was classed as nothing to publish.

**The fix (decision 26):** the fingerprints cover the provenance that decides readability, full mode
publishes `desk_series_runs`, and `changed_tables` names the affected series.

**Test:** `tests/test_validate_db.py::test_a_refresh_that_restores_a_series_provenance_is_published`,
Codex's repro.

- A healthy tier-1 fixture is refreshed. DGS10's `run_id` is cleared in the baseline. The refresh
  runs again with identical provider histories.
- DGS10 is readable again, the verdict passes, and `upload` is true.
- `changed_tables` holds `desk_series`, `desk_series_runs` and `desk:DGS10`, and no other series.
- An identical snapshot changes nothing.
- On the staged code: `upload=False`, `changed_tables=["desk_series_runs"]`.

### R-21 · the repair guard counts what moves (low)

**The fix (decision 27):** the guard counts the rows that move and the rows the provider can no
longer serve.

**Tests** (`tests/test_desk_history.py`):

- `test_a_repair_moving_most_of_a_series_refuses_without_force` covers Codex's two cases on 186 HY
  OAS rows:
  - only one row's provenance intact: 185 would move;
  - every row committed by a run dated 2020-01-01: all 186 would move.

  Both refuse with the count, the share and what remains. `--force` moves them and says the
  watermark was left unchanged. The CLI exits 1 on the refusal.
- `test_a_repair_moving_rows_the_provider_cannot_serve_again_warns_and_refuses_without_force`:
  - 19 HY OAS rows (2.4% of the series) lose provenance.
  - On 2026-10-15, 15 of them are older than FRED's window. The repair refuses, and the dry run,
    the refusal and the forced apply all carry the warning.
  - A one-row DGS2 repair needs neither `--force` nor a warning.

### R-22 · the dry run previews what --apply does (low)

**The fix (decision 27):** the dry run is the repair applied to an in-memory copy.

**Test:** `test_a_dry_run_repair_previews_what_apply_does_on_a_legacy_table`, Codex's repro.

- A legacy four-column table holds DGS10 rows dated 2026-09-04 and 2099-01-01, with the clock at
  2026-09-05.
- The dry run reports the 2099 row and "--apply would move 1 row … and reset the watermark to
  2026-09-04". Without `--force` it previews the refusal.
- The file is unchanged: four columns, no runs or quarantine table.
- `--apply --force` then does exactly what was previewed.
- On the staged code, the dry run reported no rows.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1064 passed, 0 failed, 0 skipped** in 310 s. That is §15's
  1061, less V-37's two tests (replaced), plus five new ones.
- **On this worktree's `data/macro_radar.db`,** the published database since §15: 1062 passed and 2
  failed. The failures are the two `test_asset_history` tests §15 records, which predate the branch.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §15.
- All 4,410 frozen entries pass (`test_every_entry_but_wtis_is_the_one_cc721f0_froze`, in the gate).

**Verifier.** Its re-check of this round:

- **R-19 closed.** The audit found no path that writes a desk_series value without provenance.
  - The only production writers are `write_series`, called only from `refresh`, with the run, and
    `migrate`'s one back-fill, on an unmigrated table only.
  - The scan and the repair only delete, and `asset_history.write_series` writes asset_prices.
  - The API writes only its staged in-memory copy. Memo, backtest and dashboard code never touch the
    table, and test helpers are never imported by production.
  - Out of scope as specified: asset_prices, the Desk's `^GSPC`, `GC=F` and `^RUT` input, carries no
    provenance.
- **R-20 passes Codex's repro,** but see V-39 and V-40. On a copy of the published database with the
  real `refresh`:
  - a next-day refresh with identical histories names `desk_series`, `desk_series_runs` and all nine
    `desk:<id>`;
  - a same-day one names only the two tables;
  - a refresh whose every fetch failed names `desk_series_runs` and counts as changed, where the
    staged validator said nothing changed.
- **R-21 closed.** 18 of 186 rows (9.7%) is allowed, and 19 of 186 (10.2%) refuses with exit 1.
  Exactly 1 of 10 is allowed. The warning prints on the dry run, the refusal and a forced apply.
- **R-22 closed.** The dry run matches `--apply` on a legacy table. It sees a frame that exists only
  in `-wal` through the read-only backup, answers a database without desk_series with exit 0, and
  exits 0 when it previews a refusal.
- **All five new tests fail on the staged code.**
- **No regression.** On a tree copy with the Sep-15 local database and no `web/dist`: 1060 passed and
  2 failed (the bundle tests), 1064 in all. The engine did not change this round.
- **Report:** decisions 25 and 27 and §16 match the code. Decision 26 is contradicted by V-39 and
  V-40, and is marked above.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-39 | low | Each series' fingerprint includes its run's `as_of`, and every refresh re-stamps every served row with a run dated that day. Every Desk series is therefore named in `changed_tables` on every next-day refresh, even when its readable rows and exclusions are identical, which contradicts decision 26. Repro: the real `refresh` on a copy of the published database at 2026-09-21 11:17Z, then at 2026-09-22 11:17Z with identical histories; full validation names all nine `desk:<id>`. The same pair on one day names none | hash, per row, `(date, value, readable)`, readable being "its run committed and `date <= run.as_of`", instead of `as_of` itself |
| V-40 | low | `start_run` inserts a `started` row into `desk_series_runs` at the start of every refresh, and full mode now publishes that table. A full run that committed nothing therefore counts as `changed=True` and uploads when it passes, where the staged validator said nothing changed. This defeats full mode's "nothing new to publish" guard. Repro: the same copy, then a refresh with every FRED and provider fetch failing: `changed=True`, `changed_tables` holds `desk_series_runs`, while the staged validator gives `changed=False` | count only committed runs: fingerprint `desk_series_runs` by its committed rows, or insert the run row at its first commit |
| V-41 | nit | Three small inaccuracies. (1) The refusal rounds the share to a whole percent, so "it would move 19 of the 186 rows of DGS2 (10%)" reads as though 10% triggered it, while the rule is more than 10%. (2) On 29 February, the window start falls back to 28 February of the earlier year, the less conservative way by one day. (3) The dry run on a missing path raises an unhandled traceback, and `--apply` on one creates an empty database file (pre-existing) | (1) format with `:.1%`, or say "more than 10%"; (2) use 1 March on a leap day; (3) check the path exists before connecting and print a plain message |

## 17. Fourteenth round (the verifier's V-39 to V-41)

V-39 and V-40 were over-reach in the R-20 fix; V-41 was three nits. All three are fixed here. Each
new test was confirmed failing on the staged pre-fix code. Staged, not committed.

### V-39 and V-40 · a Desk change is a change in what the Desk reads

**The rule (decision 26):** a series changes only when a row's value, date or readability changes,
readable meaning its run committed and the row is not dated after that run's New York date.

- A refresh's date alone is not a change (V-39).
- A started run that commits nothing is not a change, and neither is one that re-stamps identical
  rows (V-40).
- `desk_series_runs` counts as changed only together with desk_series. Full mode's "nothing new to
  publish" guard holds for a run with identical provider histories.

**The fix** (`scripts/validate_db.py`):

- `_desk_fingerprints` hashes date, value and readable per row, for the table and for each series.
- The runs table is left out of the generic comparison and judged after it, only when desk_series
  changed.
- It has its own fingerprint (`run_id`, `as_of`, `status`) for that case.

**Tests** (`tests/test_validate_db.py`, on the R-20 fixture):

- **(a)** `test_a_next_day_refresh_of_identical_data_changes_nothing`: the refresh runs again the
  next New York day with identical histories, so every row gets a new run dated 2026-09-06. No
  desk table or series is named, `changed` and `upload` are false, and the guard's warning is
  present. On the staged code, all five series were named.
- **(b)** `test_a_full_run_that_commits_nothing_changes_nothing`: every fetch fails, and the run is
  recorded as started. No desk table is named, and `changed` and `upload` are false. On the staged
  code, `desk_series_runs` counted as changed.
- **(c)** Codex's R-20 repro:
  - `test_a_refresh_that_restores_a_series_provenance_is_published` keeps its same-day form
    unchanged, and still passes.
  - `test_a_next_day_provenance_repair_names_the_runs_table_and_dgs10_only` runs it the next day,
    as a scheduled refresh would, with that day's news. The changed tables are exactly
    `desk_series`, `desk:DGS10` and `desk_series_runs`, and the run uploads. On the staged code,
    all five series were named.
  - The same-day form passes on the staged code too, because R-20 was already fixed there. That is
    why the next-day form was added: it is the one that shows this round's fix.

### V-41 · three nits

**The fix** (`src/market_data/desk_history.py`):

- the share prints to one decimal;
- on 29 February the HY OAS window starts on 1 March three years back;
- a missing path refuses, on the dry run and on `--apply`, with exit 1, and no file is created.

**Test:**
`tests/test_desk_history.py::test_the_repair_states_its_share_exactly_takes_the_safer_leap_day_window_and_refuses_a_missing_path`.

- 19 of 186 reads "(10.2%)".
- On 2028-02-29 the window starts 2025-03-01, so a 2025-02-28 row counts as one the provider cannot
  serve.
- A missing path refuses in all three forms, and neither the file nor its folder is created.
- On the staged code the share read "(10%)".
- R-21's test now expects the one-decimal share.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1068 passed, 0 failed, 0 skipped** in 293 s. That is §16's
  1064 plus the four tests above.
- **On this worktree's published `data/macro_radar.db`:** 1066 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §16.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-39, V-40 and V-41 closed.** The four new tests and R-21's (now expecting one decimal) fail on
  the staged code, and the unchanged same-day R-20 test passes there.
- **The real `refresh` on a copy of the published database** (clock 2026-09-28 and 09-29):

  | Scenario | Changed / upload | Desk entries in `changed_tables` |
  |---|---|---|
  | Next day, identical data | False / False | none |
  | Same day, identical data | False / False | none |
  | Every fetch failed | False / False (the staged code said True) | none |
  | A new FRED observation | True / True | `desk_series`, each FRED `desk:<id>`, `desk_series_runs` |
  | One revised DGS2 value | True / True | `desk_series`, `desk:DGS2`, `desk_series_runs` |
  | A DGS10 provenance repair, next day | changed True | `desk_series`, `desk:DGS10`, `desk_series_runs` exactly |

- **Edge cases that hold:**
  - the first migrated run against an unmigrated baseline, and a baseline without the runs table:
    identical data changes nothing;
  - a readability flip through a run's `as_of` is named;
  - the leap-day start (2028, 2032, 2400; 2100 has no 29 February);
  - missing paths relative to the working directory, and a directory.
- **No regression.** On a tree copy with the Sep-15 local database and no `web/dist`: 1064 passed and
  2 failed (the bundle tests), 1068 in all.
- **Report:** decisions 26 and 27 and §17 match the code, but for V-43.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-42 | nit | V-41's path check (`Path(db_path).is_file()`) passes any existing file, so a file that is not SQLite still raises an unhandled `sqlite3.DatabaseError: file is not a database`, on the dry run and on `--apply`, though the comment says "never a traceback". The file is left untouched. Repro: `printf 'not a database at all' > junk.db`, then `desk_history.main(["--db", "junk.db", "--repair", "DGS2"])`, with and without `--apply` | catch `sqlite3.DatabaseError` in `repair()` and refuse with "refused: <path> is not a SQLite database" and exit 1, or check the 16-byte header as `validate_db._header_ok` does |
| V-43 | nit | Decision 26 said an unmigrated store fingerprints as its back-filled self, "every row readable". The back-filled self is not: the migration marks a row dated after its New York date as after its run, unreadable. An unmigrated baseline holding a future-dated row (the V-15 class) therefore makes the first migrated run name that series with identical data. It is moot in practice, because validate fails that row as future-dated anyway. Repro: an unmigrated copy of a refreshed store plus `('DGS10', '2099-01-01', 4.0, 'fred')`, then an identical-history refresh (which migrates): `changed_tables` gets `desk_series`, `desk:DGS10` and `desk_series_runs`, and the failures include `desk:DGS10 (tier 1): max date 2099-01-01 is in the future` | compute the legacy fingerprint's readable flag as the migration would (`date <=` the run's New York date), or reword decision 26 (marked above) |

## 18. Fifteenth round (Codex round 7: R-23 and R-24 high, R-25 and R-26 low)

All four fixed here. The repros are Codex's own, taken from its review session's scripts. Each new
test was confirmed failing on the staged pre-fix code. Staged, not committed.

### R-23 · a fingerprint that cannot run fails validation (high)

A failed Desk fingerprint query read as "unchanged", so a refresh that restored DGS10 passed with
`upload=False` and nothing in `not_executed`.

**The fix (decision 28):** every fingerprint runs through `_mandatory`, on both snapshots.

**Test:** `tests/test_validate_db.py::test_a_fingerprint_that_cannot_run_fails_validation_on_either_snapshot`,
Codex's repro.

- DGS10's provenance is cleared in the previous snapshot, and the refresh runs again with identical
  histories.
- "database is locked" is injected into the Desk fingerprint SELECT on the current snapshot, the
  previous one, and both.
- Each case fails with `upload=False`, and the fingerprint is named in `not_executed` or
  `previous_not_executed` on the side that failed.
- With no fault, the recovery uploads.
- On the staged code, the verdict passed.

### R-24 · the repair moves exactly what it checked (high)

The repair checked its guard, then reselected the rows while moving them. A concurrent refresh in
between made it report 1 row moved and move 100.

**The fix (decision 29):** BEGIN IMMEDIATE before the selection, and a move of exactly the checked
set.

**Test:** `tests/test_desk_history.py::test_a_repair_moves_exactly_the_rows_it_checked_whatever_a_concurrent_refresh_does`,
Codex's repro. The store holds 100 committed DGS10 rows and one without provenance. A second
connection's real refresh serves those 100 plus 99 rows dated 2099.

- **Run just before `SAVEPOINT desk_series_repair`, Codex's point:** the refresh cannot write
  ("database is locked"), and the repair moves the one row it reported, leaving 100.
- **Run before the repair begins:** the check sees 100 of 200 rows (50.0%), so the repair refuses
  and moves nothing.
- On the staged code, the refresh wrote in the middle of the repair.

### R-25 · a file that is not SQLite is refused (low)

**Test:** `tests/test_desk_history.py::test_a_repair_refuses_a_file_that_is_not_a_sqlite_database`.

- `README.md` is refused, "not a SQLite database", with exit 1, on the dry run, on `--apply` and
  on `--apply --force`.
- Its hash is unchanged.
- On the staged code, it raised "file is not a database".

### R-26 · a legacy store reads with the migration's cutoff (low)

**The fix.** `_desk_fingerprints` reads a store not yet migrated as the migration would leave it:
a row is readable when it is not dated after the validation's New York date, the date the
migration would give the pre-provenance run.

**Test:** `tests/test_validate_db.py::test_a_legacy_future_row_names_no_series_when_a_copy_is_migrated`,
Codex's repro.

- A legacy `('DGS10', '2099-01-01', 4.0)` row, and a migrated copy of the store.
- No Desk change is named. The tier-1 future-date failure still stands. The two fingerprints are
  equal.
- On the staged code, `desk_series`, `desk:DGS10` and `desk_series_runs` were named.
- Decision 26's sentence is corrected.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1072 passed, 0 failed, 0 skipped** in 295 s. That is §17's
  1068 plus the four tests above.
- **On this worktree's published `data/macro_radar.db`:** 1070 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §17.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **R-23 to R-26 closed.** Each new test fails on the staged code for the right reason:
  - R-23: the verdict passed with the fault;
  - R-24: the refresh wrote in the middle of the repair;
  - R-25: "file is not a database";
  - R-26: three Desk changes named.
- **R-23 on the real schemas.** No false failure in any mode on:
  - the published copy, alone and against itself;
  - the scratch store;
  - the Sep-15 local database;
  - a migrated copy of the published file against the legacy one, and back, a baseline with and
    without `desk_series_runs`. Neither pair names a Desk change.
- **R-24 under stress.**
  - A refused `--apply` and "nothing to repair" leave the file byte-identical; a legacy file stays
    unmigrated.
  - A BLOB-dated row without provenance is moved, since the temporary column is untyped.
  - A refresh started during the lock waits, then stores every series once the repair commits.
  - The dry run's lock on the in-memory copy works and rolls back.
  - A crash inside the lock rolls back, and a hard kill leaves a hot journal the next open rolls
    back.
- **R-25:** README.md and a 0-byte file are refused on both modes, and both are untouched. A WAL-mode
  file works.
- **No regression.** On a tree copy with the published database and no `web/dist`: 1066 passed and 4
  failed (the two bundle tests and the two `test_asset_history` tests), 1072 in all.
- **Report:** decisions 26, 28 and 29 and §18 match the code, but for V-46.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-44 | low | A real repair (`--repair --apply`) that meets another writer holding the lock past the store's default 5 s busy timeout ends in an unhandled `sqlite3.OperationalError: database is locked`, raised from `BEGIN IMMEDIATE`, not a refusal. Repro: a second process holds `BEGIN IMMEDIATE` for 8 s; `desk_history.main(["--db", db, "--repair", "DGS2", "--apply"])` raises after 5.2 s | catch `sqlite3.OperationalError` on the lock and refuse ("the database is locked by another writer (a refresh?); nothing was changed, retry"), exit 1; optionally give the repair a longer busy timeout |
| V-45 | nit | The header check passes a damaged database whose header is valid, which then raises `sqlite3.DatabaseError: database disk image is malformed` in both modes. And a 0-byte file, a valid empty SQLite database, is refused as "not a SQLite database". Repro: a copy of a store with 4 KB of `0xff` over page 3, then `--repair DGS2` with and without `--apply`: both raise | catch `sqlite3.DatabaseError` in `repair()` and refuse ("cannot be read as a SQLite database (<error>)"), exit 1; word the empty case "is empty" |
| V-46 | nit | The legacy fingerprint's cutoff is the validation's New York date, while the migrated snapshot's pre-provenance cutoff is the store run's. When they straddle New York midnight, a legacy row dated the new day is readable in the baseline and unreadable in the migrated copy, so the series is named. It is moot: that row fails validation either way, as future-dated or dated after its run. Repro: the published copy plus `('DGS10', '2026-09-26', 4.0)`, migrated at 23:50 ET on 09-25; validated at 23:55 ET no Desk change, at 00:05 ET `desk_series`, `desk:DGS10` and `desk_series_runs` named | reword decision 26 (marked above), or take the legacy cutoff from the current snapshot's pre-provenance run's `as_of` when there is one |

## 19. Sixteenth round (Codex round 8: R-27 blocking, R-28 to R-30 low)

All four fixed here. The repros are Codex's own, taken from its review session's scripts. Each new
test was confirmed failing on the staged pre-fix code. Staged, not committed.

### R-27 · a schema check that raises never turns provenance off (blocking)

`load_level` caught an `OperationalError` from `provenance.is_migrated` and read the store as
legacy. A schema write held by another connection therefore let an unstamped DGS10 value into a
study, with no warning.

**The fix (decision 30):** a bounded retry, then an error; never a legacy read. The audit table in
decision 30 lists every other caught SQLite error on the Desk path.

**Tests:**

- `tests/test_event_study.py::test_r27_a_schema_check_that_raises_never_reads_the_store_without_provenance`,
  Codex's repro:
  - an in-memory copy of the scratch store, migrated, with DGS10's 2008-10-10 value set to 99.0 and
    no provenance;
  - a second connection's schema write held during the reader's provenance check, so SQLite raises
    "database schema is locked".
  - The retry clears it: the study reads 180 events, excludes the row, carries the provenance
    warning, and has the clean study's `inputs_hash`.
  - A fault that outlasts the retries raises `SchemaCheckFailed`.
  - On the staged code: 172 events.
  - **The five-session baseline N** is 7,460 here, against 7,462 on the staged code. The review
    quotes 7,461 and 7,463. The verifier traced the difference to the input database:
    - Codex's session log shows its run on `data/desk_scratch.db` gave 7,460 and 7,462, as here.
    - The review's figures come from a later variant that swapped the source to the published
      `data/macro_radar.db`, which gives 180 events and 7,461.
    - The test's 7,460 is right for its fixture, the scratch store.
- `tests/test_desk_api.py::test_a_study_whose_provenance_check_cannot_run_is_an_error`: the study
  answers 503 with `status: "error"` and the reason.
- `tests/test_validate_db.py::test_a_provenance_schema_check_that_cannot_run_fails_validation`: every
  mode fails, and `not_executed` names "desk_series provenance schema".
- The R-09 corruption test now allows the asset_prices freshness query, the one that uses `MIN()`, to
  be "not executed" under its `MIN` denial. It used to fall back to no date. Every corruption check
  still runs.

### R-28 · a repair that cannot take the lock refuses (low)

**Test:** `tests/test_desk_history.py::test_a_repair_that_cannot_take_the_lock_refuses_in_both_modes`.

- `--apply` against a writer holding BEGIN IMMEDIATE, and the dry run against one holding BEGIN
  EXCLUSIVE, both refuse with "the database is locked by another writer; nothing changed; retry"
  and exit 1.
- The file is byte-identical afterwards.
- The first version of this test hung on the dry run: `Connection.backup` retries a busy source
  without end. The dry run now takes its read lock first.

### R-29 · a damaged database refuses (low)

**Test:** `tests/test_desk_history.py::test_a_repair_of_an_unreadable_database_refuses_in_both_modes`.

- A store with a valid header and its first page's contents overwritten refuses, on both modes,
  "database unreadable: database disk image is malformed; nothing changed", with exit 1.
- The file is untouched.
- On the staged code, it raised.

### R-30 · one cutoff across midnight (low)

**Test:** `tests/test_validate_db.py::test_a_legacy_row_dated_tomorrow_is_judged_alike_on_both_sides_of_midnight`,
Codex's repro.

- A legacy row dated 2026-09-26, in DGS10 and in WTI; the copy migrated at 23:50 ET on 09-25;
  validated at 23:55 and 00:05 ET.
- No Desk change is named at either time, and WTI does not upload.
- On the staged code, both series were named after midnight.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1078 passed, 0 failed, 0 skipped** in 282 s. That is §18's
  1072 plus the six tests above.
- **On this worktree's published `data/macro_radar.db`:** 1076 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §18.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **R-27 closed.** `SchemaCheckFailed` reaches the API as 503 `status: "error"` for the assets list,
  a preset (a stored worker item) and a free-form study, and validate_db fails it as not executed.
  Elsewhere it fails closed:
  - in `write_series`, that series fails and no unstamped row is written;
  - in the repair, it becomes a refusal;
  - staging keeps the last good generation serving;
  - `dbpath` falls back to the file under the same rules.
- **R-28 closed, timed on file copies.**
  - A lock held 2 s: the repair goes through in both modes.
  - A lock held 8 s: exit 1 after 5.5 s with the refusal, and the file is byte-identical.
  - On the staged code, the apply raised after 5.4 s and the dry run waited the lock out.
- **R-29 and R-30 closed.** An identical migrated pair validated at 23:55 and 00:05 ET, and a day
  later, names no Desk series.
- **The baseline offset** was the input database (above).
- **No regression.** On a tree copy with the Sep-15 database and no web bundle: 1074 passed and 2
  failed (the bundle tests), 1078 in all.
- **Report:** decision 30's audit misses V-47's call site, and its "one second" is V-48.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-47 | low | A failed schema check turns `/api/freshness` and `/api/desk/pipeline/inventory` into a bare 500 ("Internal error. The incident is logged server-side."). `api/db._freshness_uncached` calls `provenance.is_migrated(conn)` for the Desk's newest dates and does not catch `SchemaCheckFailed`. It fails closed, since nothing is read without provenance, and is reachable only on the file fallback (a generation is an in-memory copy). The call site is missing from decision 30's table. Repro: patch `provenance.is_migrated` to raise, clear the freshness memo, call both routes: 500 | catch it there and report `desk_series_latest` as not read, with the reason, keeping the rest of the drawer (or answer 503 with the reason); add the row to decision 30 |
| V-48 | nit | The retry bound is about 23 s, not "1 s": each of the four tries also waits the connection's busy timeout (5 s by default). Repro: a second process holds `BEGIN EXCLUSIVE`; `is_migrated(sqlite3.connect("file:...?mode=ro", uri=True))` raises after 22.8 s, with "after 4 tries over 1 s"; with `timeout=0`, 1.0 s | state the real bound (4 × busy timeout + 1 s), or run the schema reads under a short busy timeout |
| V-49 | low | A side effect of R-30's cutoff: `_desk_fingerprints` judges a pre-provenance row by the validation date, while the reader judges it by its run's stored `as_of`. So a migrated-to-migrated pair can miss a real change. Repro: `_make` plus a DGS10 (or WTI) row dated 09-26, migrated at 23:50 ET on 09-25 (the previous snapshot); the current snapshot re-stamps that row under a committed run dated 09-26, same value. The Desk's newest readable date moves (DGS10 09-04 → 09-26; WTI none → 09-26), yet validation at 09-26 15:10Z names nothing and `upload` is False. It arises only for a legacy row dated after its migration, and a full run almost always changes other tables, so it affects which series are named | apply the validation cutoff to pre-provenance rows only when the other snapshot is legacy; when both are migrated, use the stored `r.as_of` on both sides |
| V-50 | nit | The web page never shows the new 503's reason. `_schema_error` puts the message in `reason`, but `web/src/api/client.ts` reads `detail`, `kind` and `retryable`, so `ApiError.detail` becomes "503 Service Unavailable". The Event Study page, documented to print the engine's reason for a 503, shows that status line instead. It is still retried, since a 503 defaults to retryable. Every other Desk body carries `detail` | add `"detail": str(exc)` to the body, and optionally `kind` and `retryable: true` |

## 20. Seventeenth round (the verifier's V-47 to V-50)

V-47, V-48 and V-50 are fixed here. For V-49 the rule the owner gave is implemented and tested. Its
test passes on the staged code as well, for the reason below. Staged, not committed.

### V-49 · a back-filled row's value is always compared

**The rule.** A back-filled row's readability flag is judged by R-30's explicit cutoff, and its date
and value are always hashed, whatever the flag. A value that changes on any row, readable or not,
names its series.

**Test:**
`tests/test_validate_db.py::test_a_changed_value_on_a_back_filled_row_names_its_series_between_migrated_snapshots`.

- Setup: a row dated 2026-09-26 in DGS10, and in WTI, back-filled by a migration at 23:50 ET on
  09-25. The current snapshot changes its value to 5.0.
- `desk_series` and `desk:<id>` are named, for both series.

**What the check showed.** The staged code already hashed every row's date and value whatever its
flag, so this test passes there too. It pins the rule rather than proving a fix. What the staged
code did not name was the verifier's own V-49 repro: the same value re-stamped under a committed run
dated 09-26.

- Before the re-stamp, the Desk's reader set that row aside, since its run is dated 09-25. After it,
  the reader reads it, so the newest readable date moves.
- Under the owner's rule, the fingerprint flags it readable on both sides, by the explicit cutoff.
  The re-stamp is therefore not named, and the test states that as the rule's consequence.
- Naming it would take the verifier's alternative: judge a back-filled row by its stored `as_of`
  when both snapshots are migrated, and by the cutoff only against a legacy one. It is left for the
  owner and Codex to judge.

### V-47 · freshness fails closed with a structured 503

**The fix.** An app-level handler (`api/main.py`) turns `SchemaCheckFailed` into the Desk studies'
503 body, for every route that reaches the check: `/api/freshness`, the pipeline inventory, and any
freshness block. Decision 30's audit table lists `api/db._freshness_uncached`.

**Test:** `tests/test_desk_api.py::test_freshness_and_the_inventory_fail_closed_when_the_provenance_check_cannot_run`.

- Both routes answer 503 with the structured body. On the staged code, the error escaped.

### V-50 · the message reaches the web client

**The body** of a schema-check 503 (`api/desk.schema_error_body`, used by the Desk routes and the
app's handler), for the frame-3 fold:

```json
{"status": "error", "slug": "<study slug, on a study only>", "detail": "<message>", "reason": "<message>",
 "kind": "schema_check", "provider": "api", "retryable": true}
```

`web/src/api/client.ts` reads `detail`, `kind` and `retryable`. So the Event Study page now shows
the reason, and the client retries it, as it does any 503. `reason` is kept for the Desk's own body.

**Test:** R-27's API test now asserts `detail == reason`. On the staged code there was no `detail`.

### V-48 · the real retry bound

**The fix.** The error message and decision 30 now give the real bound: the read and three retries,
1 s apart in all, each waiting up to SQLite's busy timeout (5 s by default), about 23 s at worst.

**Test:** R-27's engine test matches the new message. On the staged code it read "after 4 tries over
1 s".

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1080 passed, 0 failed, 0 skipped** in 299 s. That is §19's
  1078 plus the two new tests.
  - The first run had one failure: `test_provider_no_yahoo::test_the_profile_makes_its_two_eodhd_calls_concurrently`,
    a timing test known to flake under load. This branch does not touch the provider layer.
  - It passed five times of five on its own, and the full rerun above is clean.
- **On this worktree's published `data/macro_radar.db`:** 1078 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §19.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-47, V-48 and V-50 closed; V-49 as the owner's rule defines it.**
  - V-47's test fails on the staged code (the error escapes). The R-27 API test fails there on
    `KeyError: 'detail'`, and the R-27 engine test on the old wording. The V-49 test passes on both,
    for the reason in §20.
  - Its route sweep with `is_migrated` raising: every route that reaches the check answers the
    structured 503, with `Cache-Control: no-store` and the security headers. That covers
    `/api/freshness`, the pipeline inventory, `/api/signals/latest`, `/api/credit/oas` and
    `/api/credit/metrics`, `/api/recession/probability`, `/api/lbo/defaults`, `/api/allocation` and a
    free-form study. None of them turns it back into a 500 or a 200.
  - The handler sits inside PinGeneration, the security middleware and CORS, and wins over the
    generic `Exception` handler.
- **The web client.** The Event Study page shows `detail` for its study and its assets note, and
  retries three times. The Data Pipeline page does not (V-52).
- **The V-49 analysis confirmed.** The fingerprint hashes date, value and flag for every row, so a
  value change was named on the staged code too. The only blind spot is the one the rule accepts: a
  re-stamp of a back-filled row dated after its migration.
- **No regression.**
  - On the Sep-15 local database, no web bundle: 1075 passed and 3 failed, 1080 in all. The failures
    are the two bundle tests and the same timing flake, which passed 3 of 3 alone.
  - On the published copy: 1073 passed and 5 failed. The failures are the two `test_asset_history`
    tests, the two bundle tests and the flake.

**New findings, recorded unfixed for Codex to judge:**

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-51 | medium (availability; the weakness predates this round) | A garbage collection that runs inside `dbpath._read_only_authorizer` can deadlock a reader thread. SQLite calls that Python authorizer while it holds the in-memory copy's shared-cache lock. If a collection there finalizes a statement or connection of another connection on the same copy, that close needs the same lock, and the thread waits for good; every other reader of that copy then blocks too (the file stays readable). Standalone repro: connection B runs a query and is dropped unclosed (a sqlite3 connection and its statement cache refer to each other, so only the collector frees it); connection A's authorizer runs `gc.collect()` on its first call: A's query hangs. In the app: `api/db._local` never closes a thread's connection when anyio prunes that idle worker thread (after 10 s), and a later reader's authorizer can meet the collection. A route sweep with `is_migrated` raising hung `GET /api/freshness` in 3 of 3 runs on this round's code, the thread parked in the authorizer, while the staged code passed 3 of 3: this round's handler only moves when the collector runs. `Generation.close()` is inferred, untested, to block the worker the same way when it retires a copy | never leave a connection to an in-memory copy for the collector: close each thread's connection when its thread exits, and a copy's reader connections when the worker retires it, outside any SQLite call; make sure no cursor outlives its connection; or make the copies read-only without a Python authorizer (launch-1's NG-2); add the forced-collection repro as a test |
| V-52 | nit | The Data Pipeline page drops the reason. A 503 from `/api/desk/pipeline/inventory` renders "Unavailable: the data service did not answer." (`DID_NOT_ANSWER`, untrue: it answered), the badge says "The inventory has not answered yet.", and the freshness drawer and Desk badges (`useFreshReport`) get only an error flag | for the frame-3 fold: print `inv.error.message` for an `ApiError`, at least for `kind: "schema_check"`, as the Event Study assets note does |
| V-53 | nit | A failed Desk schema check also takes out non-Desk endpoints: `/api/signals/latest`, `/api/credit/oas`, `/api/credit/metrics`, `/api/recession/probability`, `/api/lbo/defaults` and `/api/allocation` all answer the structured 503, because `_series_states` computes all freshness, the Desk's included. It fails closed as asked and is no worse than the staged code's bare 500s, and a lock that fails the schema read usually fails the other reads too | optional: let those freshness blocks skip the Desk rows, and fail only `/api/freshness` and the inventory |

## 21. Eighteenth round (the verifier's V-51 to V-53, and the V-49 gap)

All four are fixed here, as the owner specified. Staged, not committed.

### V-51 · no Python inside SQLite's lock, and no connection left for the collector

**The fix** (decision 32).

- `dbpath.open_generation` makes the copy read-only by the connection's own mode: `query_only` and
  a zero attach limit, with no Python authorizer.
- `api/db` closes each thread's connection when the thread exits (`_ThreadConnection`).
- The assistant's `_ro_conn` closes its connection when its block ends.

**Tests.**

- `tests/test_desk_api.py::test_the_route_sweep_answers_while_collections_run_inside_sqlite_calls`.
  This is the verifier's route sweep, in its own process, so a hang is a bounded failure (30 s per
  request, and faulthandler's own thread at 60 s).
  - Four threads read the copy through `api/db` and exit, before each request.
  - Automatic collection is off. A profile hook runs a full collection wherever Python runs inside
    a SQLite call.
  - `/api/freshness` is requested three times with the schema check failing, with a `gc.collect()`
    after the first request.
  - Then comes a collection inside a SQLite call on the copy (the verifier's standalone repro), and
    a fresh reader on a new thread.
  - Staged code: request 1 hung within the bound, the reader parked in `_read_only_authorizer`.
  - Now: 503 `schema_check` three times out of three, in 0.11 s. The fresh reader read 93,098 rows.
    The only Python the hook met inside a SQLite call was the test's own probe authorizer.
- `test_a_thread_closes_its_copy_connection_when_it_exits`: with collection off, the thread's exit
  closes its connection in that thread. On the staged code nothing closed it.
- `test_a_copy_connection_is_read_only_by_its_own_mode_with_no_python_callback`: no callback is
  installed, and `DELETE`, a temp table, `ATTACH` and `VACUUM INTO` are refused. On the staged code
  `set_authorizer` was called.
- `tests/test_chat_sql_guard.py::test_each_tool_call_closes_its_connection`: fails on the staged
  code ("DID NOT RAISE").
- `test_the_tool_refuses_writes_on_a_copy_without_an_authorizer` checks the tool on the copy, past
  the guard:
  - it refuses writes, temp tables, `ATTACH` and `VACUUM INTO`, and creates no file;
  - a `query_only` flip dies with its call's connection.
  - On the staged code it fails where the authorizer refused the flip.
- `tests/test_public_posture.py`: the two NG-2 tests pin the new mode.
  - Writes are refused, and a flip affects only its own connection.
  - `journal_mode = WAL` stays `memory`, and `user_version = 7` is refused.

### The V-49 gap · readability is part of the fingerprint

**The fix** (decision 33): one explicit cutoff on both snapshots.

**Test:** `tests/test_validate_db.py::test_a_restamp_is_a_change_exactly_when_it_changes_the_rows_readability`,
on migrated snapshots validated at 09-26 15:10Z.

| Case | Named |
|---|---|
| (a) same value, uncommitted run → committed | `desk_series`, `desk:DCOILWTICO` (and `desk_series_runs`, judged with it) |
| (a) the reverse, committed → uncommitted | the same |
| (b) committed → committed | nothing |
| (b) committed → committed, a row dated after its first run's date (09-26, first run 09-25) | nothing |
| (b) committed → committed, tier 1 (DGS10) | nothing |

**What the check showed.** (a) and (b) as the owner wrote them already held on the staged code:
its flag included the commit status. The case that separates the two is the fourth. The staged code
judged a non-back-filled row by its own run's date, so it named that re-stamp; one cutoff does not.
That re-stamp does change what the Desk reads, since the reader still sets aside a row dated after
its run's date, so the test pins the one-cutoff rule there, not an unchanged read (V-56). The
verifier's own V-49 repro (a back-filled row re-stamped) stays unnamed, as §20 recorded.

### V-53 · outside the Desk, the data is served and its freshness is awaiting

**The fix** (decision 33). `_freshness_block` catches `SchemaCheckFailed` and returns the awaiting
block. `/api/freshness`, the pipeline inventory and the studies keep the 503.

**Test:** `tests/test_desk_api.py::test_a_failed_desk_schema_check_answers_503_only_on_the_desk_routes`,
with the schema check failing:

- `/api/signals/latest`, `/api/credit/oas`, `/api/credit/metrics`, `/api/recession/probability`,
  `/api/lbo/defaults` and `/api/allocation` answer 200 with their data, and
  `freshness == {"status": "awaiting", "reason": ...}` carries the check's message.
- `/api/freshness`, the inventory and a free-form study answer the structured 503.
- On the staged code `/api/signals/latest` answered 503.

`tests/test_freshness_state.py::test_a_seeded_snapshot_keeps_an_awaiting_freshness_block` covers
the snapshot builder, which raised on that block.

**The web.** It reads a series from the live report first, then from the block, so an awaiting
block reads as no state, not an error. Printing "awaiting" is for the frame-3 fold.

### V-52 · confirmed

The inventory's 503 goes through the app's handler, `desk_mod.schema_error_body`: the same body as a
study's, with the reason in `detail`, which the Data Pipeline page's client reads. The V-53 test
asserts `detail == reason` on the inventory. Printing it on the page (`inv.error.message`) is the
frame-3 fold's.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1088 passed, 0 failed, 0 skipped** in 338 s. That is §20's
  1080 plus the eight new tests.
- **On this worktree's published `data/macro_radar.db`:** 1086 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §20.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-51, V-52 and V-53 closed; the V-49 gap as instructed.** All 11 new or rewritten tests pass
  now and fail on the staged code, each for the reason above:
  - the three V-49 cases (a), (b) and tier 1 pass on both trees, as §21 says;
  - the NG-2 and copy-path tests fail on staged only where the authorizer refused the flip.
- **Thread exit.** An anyio worker thread pruned after 0.2 s idle closed its connection in its own
  thread as it exited. The interpreter shuts down cleanly with connections held by the main thread
  and a daemon thread.
- **Callbacks.** Nothing on the copy installs an authorizer, trace callback, user function or
  collation. The one Python callback left is the query tool's progress handler.
  - A standalone test shows that a collection inside a progress handler, trace callback or user
    function deadlocks just as the authorizer did, when the statement reads a stored table.
- **SQL on a copy connection.**
  - Still refused, with other words: ATTACH, VACUUM, VACUUM INTO, temp tables and views, DETACH,
    BEGIN IMMEDIATE and writes.
  - Newly accepted: every pragma that does not write (V-55).
  - The file fallback is unchanged.
- **V-53.**
  - All six endpoints with a freshness block answer 200 with the awaiting block.
  - `/api/freshness`, the inventory and the studies still answer 503 `schema_check`.
  - `smoke_public.py` reads `/api/freshness` only.
  - The web reads an awaiting block as "as of unknown". Its type, `Record<string, SeriesState>`, is
    now inaccurate; noted for the frame-3 fold.

**New findings, recorded unfixed for Codex to judge.** Decision 32, decision 33, the §21 V-49 note
and the re-stamp test's docstring were corrected where these showed their wording false; the code
is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-54 | low (the V-51 hang reached another way; predates this round) | `src/analytics/recession.py` (`train_recession_model`, `_load_curve_shape`, `get_recession_metrics`) closes its connection only on success, inside `try/except Exception`. So a failed build leaves the worker's connection to the copy for the collector, and the query tool's progress handler, still Python inside SQLite on the copy, can run that collection and hang. Repro: a copy of `desk_scratch.db` with one `USSLIND` value `'.'` (so `_load_raw` raises). Two recession connections to the served copy stay open, and `_tool_query_database("SELECT COUNT(*) AS n FROM regimes a, regimes b")` with one `gc.collect()` inside `_budget_exceeded` hangs at `chat.py:219`, on current and staged code; a clean DB passes. Low because the build's own collections usually free it before publish | close the three connections in `finally` or `with closing(...)`; take the last callback off the copy: enforce the 2 s budget with `threading.Timer(_QUERY_TIME_BUDGET_S, conn.interrupt)`, cancelled in `finally`, and keep the instruction budget on the file path only; test that after a build with a failing item no connection to the served copy remains in `gc.get_objects()` besides the anchor and the thread slots |
| V-55 | low (past the SQL guard only) | Without the authorizer, a copy connection accepts every pragma that does not write, not only the `query_only` flip. Some act process-wide and last: `PRAGMA hard_heap_limit = 1000000` succeeds, and every later `sqlite3.connect` in the process raises MemoryError (staged: "not authorized"). `soft_heap_limit` and `threads` are process-wide too; `cache_size`, `journal_mode=OFF` and `locking_mode` now succeed on the shared cache. The file fallback still refuses them | state it in decision 32 and NG-2 (done in decision 32), or check the statement away from the shared cache: compile it under `read_only_authorizer` on a private connection holding only the copy's schema (for example `EXPLAIN <sql>` on a `:memory:` schema clone built once per generation), then run it on the copy with no callback; at least add `hard_heap_limit` and `soft_heap_limit` to the test that pins the mode |
| V-56 | low | The one-cutoff flag no longer matches the reader, which also requires `date <= r.as_of`. The re-stamp test's case 4: a tier-2 `DCOILWTICO` row dated 09-26 by a committed run of 09-25, which the Desk sets aside, re-stamped under a committed 09-26 run, which the Desk reads. Nothing is named (staged named `desk_series`, `desk:DCOILWTICO` and the runs table), and the after-run check is silent on the current snapshot, so if that is the only change the upload is skipped. Tier 2 only: a tier-1 row dated after its run fails validation, so it cannot be in a published previous snapshot. The reverse is still reported by the after-run check | mirror the reader: `committed AND date <= cutoff AND (run_id = 'pre-provenance' OR date <= r.as_of)`. Tried by the verifier: it names case 4 and its reverse, keeps R-30's back-fill cases unnamed, and every other `test_validate_db.py` test passes (only the new case-4 assertion fails). Or keep the rule, as now documented |

## 22. Nineteenth round (the verifier's V-54 and V-56 fixed, V-55 accepted)

V-54 and V-56 are fixed here as the owner specified, and V-55 is accepted (decision 34). Staged,
not committed.

### V-54 · every builder closes its connection on every path

**The fix.** Each connection a builder opens to read the store is closed in a `finally`:

- `src/analytics/recession.py`: `train_recession_model`, `_load_curve_shape`, `get_recession_metrics`.
- `src/analytics/allocation.py`: `get_regime_history`, `get_current_regime`, `get_risk_free_rate`.
- `allocation.py` also had two `with _get_conn() as conn:` blocks in `get_allocation_data`. A
  connection's own `with` ends a transaction and never closes. Allocation runs in its own child
  process, so it could not hang the API, but it is a builder, so all five were fixed.
- Every other module that reads the store already closed its connection in a `finally`: `credit`,
  `lbo`, `intelligence`, `regimes`, `alerts`, `backtest`, `playbook`, `priced`, `surprise`,
  `volatility`, the Desk engine and `api/desk._compute`. `api/db` reuses one connection per thread
  (decision 32).

**Tests.**

- `tests/test_desk_api.py::test_a_build_that_fails_midway_leaves_no_connection_to_the_copy`. It runs
  in its own process, so a hang is a bounded failure (30 s per step, and faulthandler's own thread at
  120 s).
  - Automatic collection is off. Every recession read fails once its connection to the copy is open.
    The worker builds and publishes, and `_load_curve_shape` is also read on the served copy.
  - Then come a collection inside a SQLite call on the served copy, a plain collection, and a fresh
    reader on a new thread.
  - Staged code: 3 connections opened, 3 left open, and the collection inside the SQLite call hung
    within the bound.
  - Now: 0 left open, and both collections and the fresh reader complete.
- `test_every_builder_closes_its_connection_on_every_path` is a static check over `src/analytics`,
  `src/desk` and `api/desk.py` only (V-57 and V-59 below). A connection a function opens must be closed in a `finally`, and a
  connection's own `with` is refused. On the staged code it lists the eight sites above.

### V-56 · the readability flag is the reader's, whatever the tier

**The fix** (decision 33). The flag is: a committed run wrote the row, it is dated no later than the
explicit cutoff, and it is not dated after its own run's New York date. A back-filled row is judged
by the cutoff alone (R-30). No tier enters it: `changed_tables` names every series whose fingerprint
changed.

**Tests.**

- `tests/test_validate_db.py::test_a_restamp_across_its_runs_date_names_its_series_whatever_its_tier`:
  a row dated 09-26, for tier 2 (`DCOILWTICO`) and tier 1 (`DGS10`).
  - Moved from a committed 09-25 run to a committed 09-26 run: named, and no after-run failure or
    warning.
  - The reverse: named, and the current snapshot's row dated after its run fails validation for
    tier 1 and warns for tier 2, never the other way round.
  - On the staged code the tier-2 re-stamp named nothing.
- Round 18's re-stamp test keeps (a), (b) and tier-1 (b). Its case 4, which pinned the one-cutoff
  rule, is now the V-56 test's first case, with the opposite outcome.

### V-55 · accepted

The owner's reason, recorded in decision 34: past the SQL guard only.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1091 passed, 0 failed, 0 skipped** in 310 s. That is §21's
  1088 plus the three new tests.
- **On this worktree's published `data/macro_radar.db`:** 1089 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §21.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-54 closed.**
  - Both new tests fail on the staged code for the stated reason and pass now.
  - An independent probe tracked every connection `open_generation` hands out through a full
    worker build, with the collector off, then ran `DEBUG_SAVEALL` and a collection.
    - Staged code: 2 unclosed connections to the copy.
    - Now: 0 unclosed and 0 SQLite objects left for the collector, under the V-54 repro and seven
      other faults: bad HY OAS, VIX and FEDFUNDS values, a bad DGS10 date, a text confidence and an
      empty regimes table.
    - Also 0 after query-tool reads that were capped at 200 rows, interrupted or erroring.
  - The query tool with a collection inside its real progress handler completes.
  - A stricter scan over all of `api/` and `src/` found every connection closed on every path, or by
    design (the thread slots, the worker's anchor, `api/desk._compute`, the pipeline's writers on the
    file).
  - Explicit close is the only safe path: every `sqlite3.Connection` sits in a reference cycle with
    its own statement cache, so an unclosed one is freed only by the collector.
- **V-56 closed.**
  - The new test fails on the staged code and passes now.
  - A grid of 1,032 re-stamp pairs compared each fingerprint with `load_level`'s values and
    attributes. Its inputs: migration dates, DGS10 and WTI, three row dates, numeric and text values,
    and six run kinds.
    - 8 changes of the Desk's values go unnamed. All 8 are the documented R-30/V-49 exception: a
      back-filled row dated after its migration, re-stamped by a committed run dated on or after the
      row.
    - 12 cases name a series whose read did not change: a back-filled row re-stamped under a
      committed run still dated before the row, which the writer cannot produce.
    - DGS10 and WTI behave identically.
  - Tier never enters naming. A normal refresh names nothing, and R-30's midnight test passes.
- **V-55: decision 34 is accurate.** `is_safe_select` rejects `pragma\w*`, the table-valued
  `pragma_*` forms included, and three guard tests pin it.
- **No regressions** in the touched suites: 200 passed across the Desk, allocation, generation,
  guard and accuracy tests; 44 in `test_validate_db`.

**New findings, recorded unfixed for Codex to judge.** Decision 32 and the V-54 test note in §22 were
corrected where V-59 showed their wording overstated; the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-57 | low | `test_every_builder_closes_its_connection_on_every_path` can be fooled. It accepts any `var.close()` in any `finally` in the function, nested defs included, and it sees only `Name = opener(...)` assignments. Five functions appended to a copy of `src/analytics/credit.py` still pass: a read between the open and the `try`; an early `return` before the `try`; an inline `_get_conn().execute(...)`; an annotated `conn: sqlite3.Connection = _get_conn()`; and a `finally: conn.close()` only in a nested function. An attribute target (`self.conn = _get_conn()`) crashes the test with AttributeError. No current code has such a site | require the assignment to be followed at once by (or be first inside) a `Try` whose own `finalbody` closes the variable, without walking nested defs; flag every other opener call unless it is inside `with closing(...)` or returned by an opener; handle `AnnAssign` and non-Name targets |
| V-58 | nit | The flag is boolean, so a re-stamp that keeps a row unreadable but changes why it is set aside names nothing, while the Desk's exclusion counts and warnings change. WTI row 09-25 by committed@24, re-stamped with `run_id` NULL: unnamed, while `after_run_excluded` goes 1 → 0 and `no_provenance_excluded` 0 → 1. Row 09-26 re-stamped committed@24 → committed@25: unnamed, while `after_run_dates` goes `['2026-09-24']` → `['2026-09-25']`. The current snapshot's own after-run and no-provenance checks still report the new state (tier 1 fails, tier 2 warns) | accept and record it, or hash the reader's bucket for each row (readable, malformed, no provenance, future, after-run with `r.as_of`, non-numeric) instead of a boolean |
| V-59 | nit | Decision 32 said "a test checks for every module that reads the store", but the test scans `src/analytics`, `src/desk` and `api/desk.py` only. `api/db.py`, `api/worker.py`, `api/analytics_cache.py` and `api/bootstrap.py` open connections outside it, all correct by design | name the scanned scope (done in decision 32 and §22), or widen the scan and allowlist the by-design sites |

## 23. Twentieth round (Codex round 9: R-31 high, R-32 and R-33 low)

Codex returned DO NOT PUSH on three findings, and all three are fixed here as the owner specified.
Staged, not committed.

### R-31 · an awaiting block overrides a cached freshness date

**The fix** (decision 35). In `web/src/screens/shared/useFreshReport.ts`, `series`, `group`, `at`
and `derived` return `awaitingLabel(block)` whenever the payload's block is
`{status: "awaiting", reason}`:

- the date is "—";
- the tone is amber;
- the reason is printed beside the numbers and in the tooltip.

This holds whatever the report on hand says, and whether or not it is seeded. The block type is
widened to `FreshnessBlock`, so callers type-check unchanged. It is the only web change.

**Test:** `tests/test_web_fresh_report.py::test_an_awaiting_block_overrides_a_cached_freshness_date`,
Codex's repro.

- The query cache holds a report dating DGS10 Sep 24. The next freshness fetch fails, and the cache
  keeps the report. Without the block the cached report still reads "Sep 24", which is the repro's
  premise.
- With the awaiting block, all six readings are exactly the awaiting label, and none holds
  "Sep 24": `series`, `group`, `at`, `derived`, seeded, and no cached report.
- On the staged code: "Sep 24", neutral tone, the old reason.
- Across the whole web app (a copy of `web/` with the main checkout's identical dependencies):
  `tsc -b --noEmit` is clean, and vitest passes 1,104 of 1,104 tests in 99 files, before and after.

### R-32 · no Python callback on a generation connection

**The fix** (decision 36): the progress handler is removed, and a timer interrupts the connection.

**Test:** `tests/test_chat_sql_guard.py::test_the_tool_registers_no_python_callback_on_a_generation_and_its_budget_still_fires`.
It runs through the tool itself, on a generation copy whose connections are a spy subclass.

- No `set_progress_handler`, `set_authorizer`, `set_trace_callback`, `create_function`,
  `create_collation`, `create_aggregate` or `create_window_function` is registered.
- A three-way cross join of 2,000 rows, under a 0.2 s budget, comes back "interrupted" in under 2 s.
- On the staged code, `set_progress_handler` was registered four times.
- The existing file-path budget test (a zero budget) passes with the timer: 50 of 50 zero-budget
  runs were interrupted, the worst in 1.3 ms.

### R-33 · a factory's failed setup closes its connection

**The fix** (decision 37).

**Tests.**

- `tests/test_desk_api.py::test_a_factory_closes_its_connection_when_its_setup_fails`, seven
  cases, with Codex's repro:
  - the ledger's `ensure_ai_spend_ledger` raises "database is locked";
  - each analytics factory's `PRAGMA journal_mode` is denied.
  - The error propagates, and the opened connection is closed. On the staged code all seven still
    answered.
- The cleanup test, `test_every_builder_closes_its_connection_on_every_path`, now also covers
  factories and `api/assistant_budget.py`.
  - A factory that calls anything on its new connection before returning it needs a handler that
    closes it and re-raises.
  - On the staged code it lists the seven factories.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` added, and `MRR_WEB_NODE_MODULES` set so the node test runs.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1100 passed, 0 failed, 0 skipped** in 315 s. That is §22's
  1091 plus nine new tests: R-31's node test, R-32's tool test, and R-33's seven factory cases.
- **On this worktree's published `data/macro_radar.db`:** 1098 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §22.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **R-31: closed for callers that pass the block to the hook.** The node test fails on the staged
  code and passes now; tsc is clean and vitest passes 1,104 of 1,104.
  - Edge cases hold: a missing or non-string reason, a null block, a real block with a key named
    "status".
  - `Stamp`, `FreshnessChip` and `MetaWithStamp` render "—" in amber, with the reason as the muted
    tail. The ticker strip cuts that tail off with an ellipsis; the reason stays in the tooltip.
  - It is not closed across the app (V-62, V-63).
- **R-32: closed as framed.**
  - The tool test fails on the staged code and passes now. No Python callback remains on any copy
    connection.
  - Stress runs on the copy and the file path: 400 calls with budgets from −1 to 3 ms answered only
    rows or "interrupted". No timer thread survived 32 concurrent calls. There is no interrupt after
    close, and none leaks into a later statement. The zero-budget test missed 0 of 300 runs with 24
    CPU burners.
  - A bound was lost (V-60, V-61).
- **R-33: closed for the seven named factories.** All seven cases and the extended static test fail
  on the staged code and pass now; the Desk API file passes 80 of 80. It is incomplete elsewhere
  (V-64), and the static rule can be fooled (V-65).

**New findings, recorded unfixed for Codex to judge.** Decisions 32, 35 and 36 were corrected where
these showed their wording false; the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-60 | medium | Removing the instruction budget raised the query tool's longest hold on the generation's shared-cache lock from about 51 ms to 2.0 s. Every other reader of the served copy (`api/db`, Desk jobs) waits behind it. Repro: stage a copy of `macro_radar.db` as a generation, call `_tool_query_database("SELECT COUNT(*) AS n FROM regimes a, regimes b, regimes c, regimes d")` while a second copy connection polls a one-row read. Staged: interrupted at 0.051 s, the reader waited at most 0.052 s. Now: 2.011 s and 2.009 s. The three-way join (47.8M rows), which the old budget stopped at 52 ms, now completes in 0.25 s. Any visitor can trigger it through the open assistant: up to 4 concurrent questions, each with up to 10 tool calls | a tight bound on the copy, for example about 0.1 s when `dbpath.is_copy(conn)`, keeping 2 s on the file; or run the tool's SQL on a private copy (`deserialize(gen.anchor.serialize())`) |
| V-61 | low | The 2 s clock starts only after the connection's setup (`open_generation`'s pragma and read, the schema load, `is_copy`), which waits on the same lock. Under concurrency a call runs well past its budget. With 4 concurrent heavy calls (the default `ASSISTANT_MAX_CONCURRENCY`), two finish at 2.01 s and two at 4.02 s. With 8: 10.05 s wall, and a reader waited up to 4.01 s (staged: 0.41 s and 0.20 s) | take the deadline before setup, as an absolute time, so a call that queued stops at its own deadline |
| V-62 | medium | R-31 does not reach the Recession tab, which never passes `/api/recession/probability`'s block to the hook: `RecessionScreen.tsx:138-139` (`report.group(RECESSION_INPUT_IDS)`, `inputsThrough(report.group)`), `CurveMonitor.tsx:164`, `ModelInputs.tsx:72,136` and `TransparencyPanel.tsx:157`. With a cached report and an awaiting block, the tab dates new numbers from the cached report: `freshReport(cached, false, null, {isError: true}).group(RECESSION_INPUT_IDS).word` is "Aug 2026 print". `lbo-copy` is confirmed too: "Fed Aug 2026 print · HY Sep 24" | pass `m?.freshness`, or check `isAwaitingBlock(m?.freshness)` before the group call (the frame-2 fold; now listed in decision 35) |
| V-63 | nit | Decision 35's list of bypassing screens was partly wrong (corrected). The Today page's badges go through `StatusBadge`, which already calls the hook with the block ("● LIVE · FRED · as of — <reason>"); `DeskRead.shellFreshness` has no caller. On `StatusBadge` the amber tone colours only the 9 px glyph, while the border and the LIVE word stay mint. In a seeded session, `badgeWords` shows a grey "◇ Snapshot · as of —" and drops the reason from the visible line, where `Stamp` shows amber "—" and the reason | give `StatusBadge` an awaiting style in frame-2 |
| V-64 | low | R-33 is incomplete. Four more factories leak on a failed setup: `src/utils/db.get_connection` (the full refresh: fetch_data, regime, signals), `src/market_data/fetch_market._get_conn` (pragmas, then `watermarks.ensure_table`), `src/events/load_events._get_conn` and `src/market_data/backfill_yfinance._get_conn`. With `journal_mode` denied, all four raise and their connection still answers `SELECT 1`. `api/worker._stage` closes its anchor only on `sqlite3.Error`: when `provenance.migrate` raises `ValueError`, the anchor still answers `SELECT COUNT(*) FROM regimes` = 363. A `backup` that runs out of memory raises `MemoryError`, `_failed` is not set, and the next poll re-stages at once | the same try, close and re-raise in the four factories; close the anchor on `BaseException` in `_stage` |
| V-65 | low | The new static factory check can be fooled (as V-57 showed for the builder check). Five leaking factories in one file pass it: setup before an unrelated `try` whose handler closes; an annotated `conn: sqlite3.Connection = sqlite3.connect(...)`; setup inside the return (`return _setup(conn)`); a handler whose `conn.close()` sits under `if False:`; a factory named `get_connection`. It skips `src/utils`, `src/market_data`, `src/events` and `api/worker.py` | require the statement after the open to be a `try` covering everything up to the return, whose handler always closes and re-raises; handle annotated assignments; flag calls inside the return; find factories by what they do, not their name; widen the scan |
| V-66 | nit | Text still describes the removed instruction budget: `tests/test_chat_sql_guard.py:134`, `:158` ("Aborted by the progress handler"), `:247` and `:311` ("The instruction budget counts VM steps"); `AGENTS.md:308` repeats CLAUDE.md's "~20M VM instructions" | update the comments; `AGENTS.md` is now in decision 36's merge note |

## 24. Twenty-first round (the verifier's V-60, V-61, V-62 and V-64 fixed; V-63, V-65 and V-66 accepted)

All four are fixed here as the owner specified. The three accepted findings carry their reasons in
decision 38. Staged, not committed.

### V-60 and V-61 · a 100 ms budget, counted from connect

**The fix** (decision 36). `_QUERY_TIME_BUDGET_S` is 0.1 s. `_tool_query_database` takes its
deadline before `_ro_conn()` opens the connection. It arms the interrupt timer for what remains as
soon as the connection exists, before the schema load, the limits and `is_copy`. The statements
moved into `_run_query`, unchanged.

**Measured on the served scratch copy:**

- a four-way cross join of `regimes`, alone: 105 ms (one run in five: 120 ms);
- four at once: 102 to 103 ms each; eight at once: 104 to 108 ms each (round 20: 2.01 s and 4.02 s);
- the assistant's ordinary questions: under 1 ms.

**Test:**
`tests/test_desk_api.py::test_the_query_tool_stops_a_cross_join_within_150_ms_and_answers_a_normal_query`.

- The cross join is interrupted within 150 ms of the tool call, alone and four at once.
- Three ordinary questions answer with rows: the latest regimes, each series' newest date, and
  regimes joined to signals.
- On the staged code: 2.001 s.
- The 44 guard tests pass under the new budget, the real database's normal-query test among them.

### V-62 · the Recession screen passes its block

**The fix** (decision 35). `RecessionScreen.tsx` passes `m?.freshness` to `report.group` for the
hero chip, and to `inputsThrough` for the summary row.

- The existing E3 test stays green unchanged. series[] still comes first, and its second half has
  no block in the payload.
- The E3 test's title still says "never the payload's block". That is now true only because the
  report carries all seven inputs; the file is outside this branch's web scope.

**Test:**
`tests/test_web_fresh_report.py::test_the_recession_route_labels_an_awaiting_block_as_the_hook_does`.
It runs `tests/web/RecessionScreen.awaiting.test.tsx` with vitest in a copy of `web/`, on Codex's
repro for `/app/recession`.

- The real screen renders with a cached report dating the inputs Sep 24 and Aug 2026, and a failed
  freshness fetch whose cache keeps the report.
- With the awaiting block, the hero chip reads "—" in the caution tone with the reason, and so does
  the Inputs through row. Neither holds "Sep 24" or "Aug 2026 print".
- Without the block, the same cache reads "Daily Sep 24 · monthly Aug 2026 print" (the premise).
- On the staged code the awaiting case failed: the chip's tone was "neutral", the cached date.
- Every screen that still bypasses the hook is listed in decision 35, for frame-2.

### V-64 · the remaining factories and the staging close on failure

**The fix** (decisions 32 and 37).

- `src/utils/db.get_connection`, `src/market_data/fetch_market._get_conn`,
  `src/events/load_events._get_conn` and `src/market_data/backfill_yfinance._get_conn` close their
  connection when setup fails, then re-raise.
- `api/worker._stage` closes its in-memory copy on any error. It still backs off on a SQLite error,
  and re-raises any other; the worker's loop logs it and survives.

**Tests.**

- The factory test now has eleven cases: the four new ones fail on the staged code.
- `test_a_failed_staging_closes_its_copy_on_any_error`: with `provenance.migrate` raising
  ValueError, the error propagates and the copy is closed. A SQLite error still backs off and closes
  it too. On the staged code the copy still answered a read.
- The static cleanup check now also scans `src/utils`, `src/market_data` and `src/events` for
  factories, `get_connection` among them. On the staged code it lists the four.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1107 passed, 0 failed, 0 skipped** in 317 s. That is §23's
  1100 plus seven new tests: V-60/61's, the Recession route's, four factory cases and the staging
  test.
- **On this worktree's published `data/macro_radar.db`:** 1105 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §23.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-60 and V-61: closed as framed.**
  - The new test fails on the staged code (2.010 s) and passes now.
  - Alone, the cross join stops at 107 to 110 ms; four at once, at 100 to 113 ms.
  - Normal queries take under 1 ms, and no interrupt is left on the connection.
  - Gaps remain: V-67 to V-70.
- **V-62: closed as framed.**
  - The harness renders the real screen: 2 of 2 now. On the staged screen it fails ("expected
    'neutral' to be 'delayed'").
  - 126 recession, fresh-state and hook tests pass, and tsc is clean with the new test file.
  - The E3 change is safe. With no report on hand, the chip now shows the block's states instead of
    "As of unknown".
  - The three Recession panels in decision 35 still read the cached dates, as listed.
  - The list was incomplete for the LBO sites (V-71), now corrected.
- **V-64: the leak is closed.** The eleven factory cases, the staging test and the static check pass
  now; the new ones fail on the staged code. No other factory does setup that can fail. The re-raise
  changes nothing against the staged code. The backoff half is open (V-73).
- **Decision 38 is accurate in substance.** Its V-65 wording overstated the cost of a stricter
  rule; that is corrected.

**New findings, recorded unfixed for Codex to judge.** Decisions 35, 36 and 38 and the budget's
comment in `chat.py` were corrected where these showed them false (text only); the code is as tested
above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-67 | low | The 150 ms bound holds only when calls arrive together. The shared-cache mutex is not first-come first-served, and a queued call's waits (connect's schema lookup, `open_generation`'s read, its close) cannot be interrupted. Four cross joins started 30 ms apart: the second took 162 to 171 ms in 7 of 8 runs (80 ms waiting to open, up to 34 ms in close). Eight, 15 ms apart: up to 192 ms. Other readers' longest wait stayed about 108 ms | serialize the tool's SQL with a Python lock taken with `timeout=deadline-now`, so a queued call gives up at its own deadline; or restate the bound; add a staggered case to the test |
| V-68 | high (predates this round) | The budget does not bound the lock on the copy: SQLite checks for an interrupt between opcodes, never inside a function, and `trim(X, Y)` costs len(X) × chars(Y). `SELECT length(trim(printf('%.*c',250000,'a'), printf('%.*c',21000,'b')\|\|'a')) AS m FROM regimes LIMIT 1` through the tool held the served copy's mutex 13.6 s, and a reader on another copy connection waited 13.6 s (staged: 13.3 s). `instr` with a 120K needle: 313 ms. Without a `FROM` table no mutex is held. A visitor can ask the open assistant to run it | lower `_QUERY_MAX_VALUE_BYTES` (SQLITE_LIMIT_LENGTH) from 256 KB to 16 KB (the largest stored value is 2,036 B, `news_feed.perplexity_research`): worst trim 52 ms, instr 3 ms, and the news query still answers; or run the tool's SQL on a private copy that shares no cache |
| V-69 | medium | 100 ms fails natural regime questions that 2 s answered. Joining regimes on a computed month key (`ON strftime('%Y-%m', x.date) = strftime('%Y-%m', g.date)`): SPY daily return by regime 820 ms, all symbols 1.5 s, signal trigger rate by regime 170 ms. All three now answer "SQL error: interrupted"; the staged tree answers them (0.89, 1.6, 0.18 s). The model gets no hint that it ran out of time. The indexed rewrite (`g.date = strftime('%Y-%m-01', x.date)`) takes 7 to 16 ms. Under load headroom is thin: with a Desk study computing in-process, 12-row reads reached 54 to 73 ms; with a CPU-bound Python thread, every query was interrupted (median 170 ms) | map the interrupt to an actionable error ("stopped at the 100 ms limit; join on stored dates, e.g. `regimes.date = strftime('%Y-%m-01', …)`, or aggregate first"); the trade-off is now in decision 36 |
| V-70 | low | The new test pins V-61 only by chance: with only the deadline moved back after connect (budget kept at 100 ms), it failed 8 of 11 runs, depending on whether queued calls block before the timer is armed or inside their own step | make it deterministic: patch `dbpath.connect_ro` to take 150 ms, then assert the call is interrupted within about 20 ms of connecting |
| V-71 | low | Decision 35's list was incomplete: `componentAsOf` (`lbo-copy.ts:238`) is also called from `FinancingConditions.tsx:81`, `LboHeroRow.tsx:89` and `:244` (`lboStrip`) and `LboPanel.tsx:241`. With an awaiting block and a cached report it gives "Aug 2026 print" / "Sep 24" in the neutral tone, and `lboStrip` "FRED rate · as of unknown · Fed Aug 2026 print · HY Sep 24" | the four sites are now in decision 35, for frame-2 |
| V-72 | nit | Under an awaiting block, the Inputs through tooltip repeats the reason: `inputsThrough` joins `daily.reason` and `monthly.reason`, the same string | deduplicate the reasons, in frame-2 |
| V-73 | low (V-64's other half) | A non-SQLite staging error sets no `_failed` and no backoff. With `provenance.migrate` raising ValueError or MemoryError, the worker staged 29 to 30 times in 2 s at `poll_s=0.05` (every 2 s at the production `POLL_S`), re-copying the database and logging a traceback each time, and `state` stayed `building`. On a rebuild `_schedule_rebuild` is skipped, so R-01's retry bound does not apply either | back off on any `Exception` from `_stage` as on a SQLite error; re-raise only `BaseException`s that are not `Exception` |
| V-74 | nit | §24 said "Staged, not committed" while the round was still unstaged, with `tests/web/` untracked; `tests/test_web_fresh_report.py` without `tests/web/` would error rather than skip | `tests/web/RecessionScreen.awaiting.test.tsx` is staged with this round |

## 25. Twenty-second round (the verifier's V-68, V-69, V-71 and V-73 fixed; V-67, V-70 and V-72 accepted)

All four are fixed here as the owner specified. The three accepted findings carry their reasons in
decision 39. Staged, not committed.

### V-68 · one value is capped at 16 KB

**The fix** (decision 36). `_QUERY_MAX_VALUE_BYTES` is 16 × 1024 (SQLITE_LIMIT_LENGTH); the largest
stored value is about 2 KB.

- Past the cap, SQLite's `printf()` yields NULL.
- Every other way of building a longer value fails with "string or blob too big". `_query_error`
  maps that to an error naming the limit: "a value in this query would pass the assistant's 16 KB
  limit on one value (the largest stored value is about 2 KB) …".

**Test:**
`tests/test_chat_sql_guard.py::test_a_250_kb_value_cannot_be_built_and_the_cap_error_names_the_limit`.

- The verifier's `trim` and `instr` repros return NULL within the budget.
- Building 250 KB by concatenation, by recursive doubling or by `group_concat` returns the error
  naming the 16 KB limit. The guard already refuses `zeroblob`, `randomblob` and `replace`.
- A 16,000-character value still reads.
- On the staged code, the `trim` repro ran about 13 s and came back "interrupted".
- Two launch-1 tests that built 200 KB values now build 16 KB ones. They still pin their bounds:
  NULL or an error past the cap, and the 2 MB result limit, reached after about 25 rows.

### V-69 · a 250 ms budget, and an interrupt that says how to rewrite

**The fix** (decision 36). `_QUERY_TIME_BUDGET_S` is 0.25 s, still counted from before connect. An
interrupt answers:

> SQL error: the query was interrupted at the assistant's 250 ms time limit. Rewrite it to read
> less: filter by a date range first (for example WHERE date >= '2015-01-01'); do not join on
> computed month keys such as strftime('%Y-%m', a.date) = strftime('%Y-%m', b.date), which cannot
> use an index; join on the regimes table's stored month column instead, regimes.date, the first
> day of each month (for example ON r.date = strftime('%Y-%m-01', x.date)); and aggregate before
> joining.

**Measured on the served scratch copy:**

- The cross join stops at 255 ms, alone and four at once (255 to 257 ms).
- The verifier's three month-key questions:
  - SPY daily return by regime: the rewrite error, at 255 ms;
  - every symbol by regime: the rewrite error, at 255 ms;
  - signal trigger rate by regime: answers in 156 ms.
- The rewrite the error suggests answers.

**Test:**
`tests/test_desk_api.py::test_the_query_tool_stops_a_cross_join_within_300_ms_and_explains_how_to_rewrite`.
It replaces round 21's 150 ms test.

- The cross join returns the rewrite error under 300 ms from the call, alone and four at once.
- Each of the three questions answers or returns the rewrite error, never a bare interrupt.
- Four ordinary questions answer, the suggested rewrite among them.
- On the staged code: a bare "SQL error: interrupted" at 105 ms.

### V-71 · decision 35 lists every LBO site

Decision 35 now names the three `lbo-copy.ts` functions that read the block without the hook
(`componentAsOf`, `componentDetail`, `lboStrip`), and all five call sites outside the file.

### V-73 · any staging error backs off

**The fix** (decision 37). `api/worker._stage` treats any `Exception` as a staging failure:

- it closes the copy;
- it records the attempt with the same exponential backoff as a SQLite error;
- it names the error type in `last_error` and the log;
- it sets the state to "ready" or "error", never leaving it at "building".

An interpreter exit or an interrupt (a `BaseException` that is not an `Exception`) closes the copy
and propagates.

**Test:** `tests/test_desk_api.py::test_a_failed_staging_closes_its_copy_and_backs_off_on_any_error`.
It replaces round 21's staging test.

- A ValueError, a MemoryError and a SQLite error each close the copy and back off 2 s, with the
  state "error" and the reason named.
- A SystemExit closes the copy and propagates.
- In a real worker loop at a 50 ms poll, a failing staging runs once in a second, where the verifier
  counted 29 to 30.
- On the staged code the ValueError propagated.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1108 passed, 0 failed, 0 skipped** in 315 s. That is §24's
  1107 plus the V-68 test; the V-69 and V-73 tests replace round 21's.
- **On this worktree's published `data/macro_radar.db`:** 1106 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §24.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **All three new tests fail on the staged code for the stated reason and pass now:** the `trim`
  came back "interrupted" after about 14 s; a bare interrupt at 105 ms; the ValueError propagated.
  The two edited launch-1 tests pass.
- **V-68: closed as framed.**
  - The cap's edges are exact: 16,383 characters through `printf` and 16,384 through `||` read.
    Past them, `printf` gives NULL and every other builder gives the error naming 16 KB.
  - Widths of about 1e9 give NULL in under 0.3 ms, and `hex()` of 9 KB gives the error.
  - The largest stored value is 2,036 B, so every stored read works.
  - Single functions at the cap, on a served copy of the real database: `LIKE` 138 ms, `GLOB`
    145 ms, `instr` 1.7 ms; a reader waited as long.
  - The cap does break aggregates of more than 16 KB (`group_concat`, `json_group_array` over every
    regime), and their error points to `substr`.
  - **Its survey is partial.** A safety classifier stopped one of its responses, so several
    functions in one row, recursive CTEs, JSON aggregates and big sorts were not measured (V-75).
- **V-69: closed.**
  - All 363 `regimes.date` values are 'YYYY-MM-01' text in a `UNIQUE` (indexed) column, so the
    error's advice is accurate.
  - The suggested rewrites run in 1 to 21 ms: SPY, every symbol, signals, `^GSPC` from
    `asset_prices`, and `desk_series`.
  - The month-key forms return the rewrite error at about 255 ms.
  - The mapping fires on SQLite's exact "interrupted", so for every interrupt and only interrupts.
- **V-71: closed.** Decision 35's LBO list matches every call site. Its one slip, `stampOf`'s second
  call, is corrected.
- **V-73: closed.**
  - Any `Exception` closes the copy, backs off 2^n s (at most 60), and sets the state; `last_error`
    names the type.
  - `SystemExit` and `KeyboardInterrupt` close the copy and propagate.
  - A rebuild's failed staging now reaches `_schedule_rebuild`, so R-01's retry bound applies.
  - `_failed` is keyed on the file key, with no bad interaction with the served generation.
- **Decision 39.** V-72's reason is accurate. V-67 and V-70 were not re-measured at 250 ms; V-70's
  wording is corrected to say so.

**New findings, recorded unfixed for Codex to judge.** Decisions 35 and 39 were corrected where
the verifier found their wording off; the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-75 | low | The 16 KB cap bounds one function call, not the time between interrupt checks. SQLite checks for an interrupt only at jumps, so string functions evaluated in one row run back to back without a check. One call at the cap measured 138 to 145 ms (`LIKE`, `GLOB`). Several in one row were not measured (the partial survey above) | measure in a controlled owner run; if it confirms, bound the work per row (for example, a limit on `LIKE` pattern length) or run the tool on a private copy that shares no cache |
| V-76 | low | The rewrite error can blame a query that did nothing wrong. The deadline starts at connect, so a cheap query queued behind other tool calls can reach its deadline while waiting, be interrupted in its setup statement, and be told to "rewrite it to read less". The assistant's own tool calls can queue like this. Reasoned from the code, not measured | note whether the user's statement had started; if not, answer "busy, retry" instead of the rewrite advice |
| V-77 | nit | A staging error that is not SQLite's is logged at WARNING without a traceback, and only on attempts 1, 10, 20 and so on. A programming error in `provenance.migrate` (TypeError, KeyError) used to log its traceback and is now hard to diagnose | `exc_info=True` on the first attempt for an error that is not SQLite's |
| V-78 | nit | `_stage` opens its anchor (`sqlite3.connect(uri…)`) outside the `try`, so an error there skips the backoff, and on a rebuild `_schedule_rebuild` | move the connect inside the `try` |
| V-79 | nit | The V-69 test asserts under 300 ms on a 250 ms budget, and measured runs take 253 to 257 ms: about 45 ms of margin on a loaded machine, four threads at once | the owner's bound; the margin is recorded here |

## 26. Twenty-third round (Codex round 10: R-31 residual and R-34 high; R-35, R-36 and R-37 low; R-11 from the API plan's review)

Codex returned DO NOT PUSH; all six are fixed here as the owner specified. Staged, not committed.

### R-34 · the assistant's SQL on its own private copy

**The fix** (decision 36). Every assistant tool opens its connection through
`dbpath.connect_private_ro`, on `Generation.private()`.

- The private copy is built lazily, on the assistant's first query of a generation.
- It is backed up from the generation's own copy (so it holds the same data, the provenance
  migration included), in steps of 64 pages.
- The generation holds it, and `close()` releases it at retirement.
- The budget, the 16 KB cap and the guard are unchanged.

**Measured on the served scratch copy**, with a reader looping `SELECT COUNT(*) FROM regimes` on the
shared copy:

- The private copy builds in 5.8 ms.
- Codex's eight printf/LIKE repetitions take the tool 1.05 s, and the 128 summed 16.8 s. Both end
  in the rewrite error.
- The reader's worst wait over 7,197 reads is 3.3 ms. On the staged code: 17.2 s.
- The tool call itself still runs as long as its functions do, since SQLite cannot interrupt inside
  one. The model's own answer waits, and other assistant calls can queue on the private copy; the
  screens' reads never do.

**Tests** (`tests/test_desk_api.py`):

- `test_the_assistants_sql_runs_on_a_private_copy_that_never_stalls_other_readers`, Codex's repro:
  - the 8 and 128 repetitions run through the tool while a reader of the shared copy loops;
  - the reader stays under 20 ms, the private copy's build included;
  - the tool reads the same generation's data.
  - On the staged code the reader waited 17,174 ms.
- `test_a_generation_closes_its_private_copy_when_it_retires`:
  - the copy is built once;
  - it carries the generation's key and as-of;
  - `close()` closes it, and the generation has none to give after.

### R-31 · the awaiting block through the Recession panels and the LBO helpers

**The fix** (decision 35, four web files by the owner's scope exception).

- `ModelInputs.tsx` (the input cards and the section's group), `CurveMonitor.tsx` (the curve's
  as-of) and `TransparencyPanel.tsx` (its Inputs through) pass `m?.freshness` to the hook.
- `lbo-copy.ts`'s `componentAsOf`, `componentDetail` and `lboStrip` apply the hook's
  `isAwaitingBlock` and `awaitingLabel`.

**Test:** `tests/test_web_fresh_report.py::test_the_recession_and_credit_screens_carry_no_cached_date_under_an_awaiting_block`.
It runs `tests/web/AwaitingScreens.test.tsx` with vitest in a copy of `web/`, on Codex's repro:

- a cached report dating the daily inputs Sep 24 and the monthly ones Aug 2026;
- `/api/freshness` answering 503, and every payload (recession, credit metrics, LBO defaults)
  carrying the awaiting block;
- over the whole rendered Recession screen and the whole Credit screen, text and titles alike:
  - no "Sep 24" and no "Aug 2026 print";
  - the reason and the "—" are shown.
- The premise run without the blocks prints the cached dates.
- On the staged code the Credit screen's Financing conditions still read "Monthly average · Aug
  2026 print" and "Daily · Sep 24".

### R-11, R-35, R-36, R-37 · staging and the generation factory

**The fixes** (decision 37).

**Tests** (`tests/test_desk_api.py`), each failing on the staged code as noted:

- `test_a_file_that_moves_during_its_copy_is_never_published_under_the_old_key`. The poll samples
  the key, a commit lands before the backup (hooked on the source's open), and the backup copies
  the new file.
  - Now: nothing is published, `snapshots_moved` is 1, there is no backoff, and the state is "idle".
  - The next poll publishes the new file (two rows) under its own key.
  - Staged: published under the old key.
- `test_a_staging_connection_that_cannot_open_backs_off`: the copy's connection raising "unable to
  open database file" is attempted once in 0.5 s at a 50 ms poll, backed off, with the state
  "error". Staged: 10 attempts.
- `test_the_staging_backoff_never_overflows`: from 1,023 attempts, the next failure records attempt
  1,024 with the capped delay. Staged: OverflowError.
- `test_open_generation_closes_its_connection_on_any_setup_error`: a MemoryError on the setup
  pragma propagates and the connection is closed. Staged: still open.
- Round 22's staging test now passes the file's real key, since a made-up key is now, correctly, a
  moved file.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1115 passed, 0 failed, 0 skipped** in 362 s. That is §25's
  1108 plus seven new tests: R-34's two, R-31's screen test, and R-11's, R-35's, R-36's and R-37's.
- **On this worktree's published `data/macro_radar.db`:** 1113 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §25.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **R-34: closed as framed.**
  - The tests fail on the staged code (the reader waited 17,161 ms; no `private_uri`) and pass now.
  - All seven of the assistant's database tools go through `connect_private_ro`; no `connect_ro` is
    left in `chat.py` or `api/chat.py`.
  - The fallbacks behave as described: a released generation reads the served one's private copy,
    a retired but readable one builds its own, and with no provider the tool reads the file.
  - Thread safety: 8 first queries released together made 1 build; `private()` racing `close()`
    raised nothing and gave None after.
  - Allocation's anchor backup runs only for a generation not yet published, so it never overlaps
    `private()`.
  - On the real database (16.2 MB) the private copy builds in 2.9 ms, and a shared-copy reader
    waited at most 0.36 ms.
  - The two copies hold the same data: a hash of the schema and every row of all 17 tables matches.
  - Memory: at most four copies at steady state (current and retired, each shared and private), all
    released at `close()`.
  - Decision 36's sentence about the budget was false (V-80), now corrected.
- **R-31: closed.**
  - `git diff cc721f0 -- web/` lists exactly decision 35's six files.
  - tsc is clean and vitest passes 101 files and 1,110 tests with both tests in `src/`.
  - The screen test fails on the staged code ("found Sep 24").
  - A stricter probe also passes: future-dated cached dates, `aria-label` included, and the Tools
    tab's LBO.
  - The bypass audit matches decision 35, and the list is complete.
- **R-11: closed.**
  - Comparing the key after the backup with the poll's sample catches a commit before the backup and
    during it. No other window exists.
  - Starvation is not a practical risk: a 16 MB copy takes 8.3 ms. With a writer committing every
    200, 50 and 10 ms, the worker published after 0.05, 0.17 and 0.05 s.
  - `snapshots_moved` is not in `status()`. After a discarded rebuild, `_rebuild` is stale until the
    next publish, which does no harm.
- **R-35, R-36, R-37: closed** (1 attempt against 10; the connection closed; attempt 1,024 at the
  cap). The same overflow remains in the prefetch backoff (V-81).
- **No regressions:** 179 passed, 0 skipped across `test_generations`, `test_chat_sql_guard`,
  `test_desk_api` and `test_web_fresh_report`.

**New findings, recorded unfixed for Codex to judge.** Decision 36 was corrected where V-80 showed it
false; the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-80 | low | One private copy per generation is shared by every visitor's assistant, so one question stalls everyone else's tool calls. Serving a copy of the real database: thread A runs Codex's 128 summed printf/LIKE through the tool; 0.3 s later, B runs `SELECT COUNT(*) AS n FROM regimes` and C `_tool_get_current_regime()`. A takes 17.33 s and ends in the rewrite error; B and C take 17.02 s each. The fixed-SQL tool waits too, because opening a connection to the private copy needs the lock A holds. Screens are unaffected | give each tool call its own copy (a backup takes 2.9 ms; at `ASSISTANT_MAX_CONCURRENCY=4`, at most about 64 MB transient), or one copy per visitor |
| V-81 | low (predates this round; R-37's bug elsewhere) | The prefetch backoff overflows: `api/worker.py:322` computes `PREFETCH_BACKOFF_BASE_S * 2 ** (failures - 1)`. Past 1,024 failures it raises OverflowError inside the `except ProviderError` handler, before the state is stored, so every 10 s tick makes a billed call for the first symbol and the error aborts the tick (the D4 quota burn the backoff was built to stop). Repro: set `_prefetch_backoff[(s, "5D")] = (0.0, 1024)` for every symbol and make `refresh_candles` raise ProviderError; three ticks make three SPY calls, each ending in OverflowError. Reaching it takes about 79 trading sessions of a persistent error at the 30-minute cap | clamp the exponent, e.g. `2 ** min(failures - 1, 16)`, as `STAGE_RETRY_EXP_MAX` does |
| V-82 | nit (as before R-34) | `Generation.close()` waits for a running assistant statement: closing `private_anchor` needs the private copy's lock. `close()` took 8.35 s while a 64-repetition query ran. In production this blocks the worker in `_publish`'s `released.close()` only when one answer spans two publishes, and it blocks `stop()` at shutdown, longer than the Dockerfile's 10 s graceful timeout for a 17 s statement. The anchor close waited the same way before R-34 | note it, or close the private anchor off the worker thread |
| V-83 | nit | The R-31 screen test covers less than the fix. It renders Recession and Credit, not the Tools tab's LBO (`ToolsScreen`, `LboHeroRow`, `LboPanel`), matches only "Sep 24" and "Aug 2026 print", and checks text and `title`, not `aria-label`. The verifier's stricter probe shows the behaviour is correct there | add `/app/tools#lbo`, future-dated cached dates, and `aria-label` |

## 27. Twenty-fourth round (the verifier's V-80 and V-81 fixed; V-82 and V-83 accepted)

Both are fixed here as the owner specified. The two accepted findings carry their reasons in
decision 40. Staged, not committed.

### V-80 · a copy per assistant tool call

**The fix** (decision 36). `chat._ro_conn` opens `dbpath.copy_private_ro` for every tool call, and
closes it in its `finally`. The copy is a plain in-memory database, backed up in 64-page steps from
the generation's private copy (or the file before the first generation), with query_only and no
attach. The per-generation private copy stays, as the copies' source.

**Measured on the served scratch copy:**

- The first call's copy takes 6.8 ms (it builds the private copy too); later ones take 2.7 to
  2.8 ms.
- During Codex's 128 summed LIKEs (15.9 s on its own copy), another visitor's fixed-SQL calls and
  queries answered in 3.4 ms median and 4.4 ms at most.
- `Generation.close()` during a long query took 1.7 ms (decision 40).

**Test:** `tests/test_desk_api.py::test_a_long_assistant_query_leaves_another_visitors_tool_calls_under_20_ms`.

- While the 17 s query runs in one call, ten calls of another visitor answer under 20 ms each:
  `_tool_get_current_regime()` and a `SELECT COUNT(*)` through the query tool.
- The long query really ran long.
- All twelve per-call copies are closed afterwards.
- On the staged code: "another visitor's call took 15401.7 ms".
- The existing guard, posture and R-34 tests pass on the per-call copies, among them the file
  fallback's write refusals and the copy-path walls.

### V-81 · the prefetch backoff's exponent is clamped

**The fix.** `api/worker.prefetch_tick` computes the wait from
`2 ** min(failures - 1, PREFETCH_BACKOFF_EXP_MAX)` (16), under the 30-minute cap, as staging's R-37
clamp does.

**Test:** `tests/test_session_gating.py::test_the_prefetch_backoff_never_overflows`.

- Every prefetch series starts at 1,024 failures, and the provider fails.
- Over three ticks, each series is called once. Its backoff is stored as 1,025 failures, retrying
  at the 1,800 s cap, and the next ticks make no call.
- On the staged code: "OverflowError: int too large to convert to float".

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1117 passed, 0 failed, 0 skipped** in 373 s. That is §26's
  1115 plus the V-80 and V-81 tests.
- **On this worktree's published `data/macro_radar.db`:** 1115 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §26.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-80: closed.** The test fails on the staged code ("another visitor's call took 16716.0 ms")
  and passes now.
  - All seven assistant database tools read per-call copies, and no model SQL runs on the private
    copy.
  - Source and copy close on every path: a backup failing with OperationalError, MemoryError or
    KeyboardInterrupt, a guard rejection (no connection opened), the interrupt, and an error inside
    the tool.
  - The interrupt still lands, at 252 ms.
  - Walls hold on the served path and the file fallback, and no file is created. Past the guard, a
    process-wide pragma still takes effect, as on every copy since V-51; the guard refuses it.
  - On the 16.2 MB real database, one per-call copy is about 20.7 MB of SQLite heap. The high-water
    mark was 146 MB with five concurrent calls; RSS went from 128 to 217 MB at peak.
    `ASSISTANT_MAX_CONCURRENCY` (4) caps the extra at about four copies, and a question's
    ten-iteration loop holds one at a time.
  - Builds take 2.86 ms median. The first call takes 7.0 ms, because it builds the private copy.
  - A shared-copy reader during churn plus four long queries took 0.18 ms median and 5.3 ms at
    most. Copying straight from the shared copy instead would have pushed it to 12.6 ms, so the
    private copy earns its place as the source.
  - The copy build now counts against the 250 ms budget: about 1% alone, and 7 to 20% for
    concurrent first calls.
  - Eight concurrent first calls built the private copy once.
- **V-81: closed.** The test fails on the staged code (OverflowError) and passes now. The delays are
  unchanged (120, 240, 480, 960, then 1,800 s). Every other exponent in `api/` is bounded.
- **Decision 40: accurate.** `close()` took 1.43 ms during a long query.
- **No regressions** in the touched suites.

**New findings, recorded unfixed for Codex to judge.** Decision 36 was corrected where V-85 and V-86
showed it false (the file fallback's authorizer); the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-84 | low | Model SQL that cannot be interrupted now runs in parallel. Before V-80 the private copy's shared-cache mutex queued it onto one core; now up to `ASSISTANT_MAX_CONCURRENCY` (4) such statements run at once. DEPLOY.md picks a 1-CPU Render instance, so the event loop's share of the CPU would fall from about 1/2 to about 1/5 during such a burst (inferred, not measured on 1 CPU). Four threads each running 16 summed LIKEs on a served copy: staged, 1.01 cores busy, wall 6.31 s; now 4.00 cores, 2.16 s | `setlimit(SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 256)` in `_run_query`: Codex's repro then fails "LIKE or GLOB pattern too complex", and a 250-character pattern costs 5.6 ms against 133 ms per LIKE; or accept it as V-80's trade-off |
| V-85 | low | The file fallback copies the whole file on every call and gains nothing: a plain file connection shares no cache, so it never blocked other readers. Streamlit's assistant always takes this path, with no concurrency ceiling, and the API takes it before its first generation. With no provider, while a 32-repetition LIKE query runs on another thread: staged, other calls answer in 0.83 ms median and 12.6 ms max; now 6.04 ms and 8.97 ms. The copy takes 5.45 ms median (17.2 ms max) and about 20.7 MB of heap per call, and the file path's authorizer is gone | copy only when `dbpath.generation_for(path)` returns a generation; otherwise return the `mode=ro` file connection, where the authorizer applies again |
| V-86 | nit | Stale comments, and tests that watch the wrong connection. (a) `chat._run_query`'s authorizer branch and its comment are unreachable, since every connection is a `:memory:` copy, and `dbpath.read_only_authorizer`'s comment ("the assistant's query tool") is stale. (b) The `_QUERY_TIME_BUDGET_S` comment still says every other reader of the served generation waits behind a query. (c) `test_each_tool_call_closes_its_connection` spies `connect_private_ro`, and the R-32 test spies `open_generation`: both see only the copy's source, never the connection the SQL runs on, so R-32's `registered == []` proves nothing about it. Nothing tests closing the copy on the file path; the verifier's probe found it correct | update the comments; point the two tests at `dbpath.copy_private_ro`; if V-85 is fixed the authorizer branch is live again, else delete it; optionally put an authorizer back on the per-call copy, which is not shared-cache (untested) |
| V-87 | nit (predates this round) | A negative or NaN `Retry-After` escapes the provider layer untyped. `api/providers/eodhd.py:118` computes `min(float(retry_after), 5.0)`, and `time.sleep` then raises ValueError. `prefetch_tick` catches only `ProviderError`, so no backoff is stored and each 10 s tick makes a quota-counted call again (V-81's failure mode); on-demand routes answer 500 instead of a typed error. Repro: a mock transport answering 429 with `Retry-After: -1` (or `nan`) and three `prefetch_tick()` calls: each raises "sleep length must be non-negative", three upstream calls are made, and the backoff stays empty | `delay = min(max(ra, 0.0), 5.0)` when `ra` is finite, else the current delay; a test for -1 and nan |

## 28. Twenty-fifth round (the verifier's V-84 and V-87 fixed; V-85 and V-86 accepted)

Both are fixed here as the owner specified. The two accepted findings carry their reasons in
decision 41. Staged, not committed.

### V-84 · LIKE and GLOB patterns capped at 256 characters

**The fix** (decision 36). `chat._run_query` sets SQLITE_LIMIT_LIKE_PATTERN_LENGTH to
`_QUERY_MAX_PATTERN_CHARS` (256) on each call's connection, beside the value and column limits.
`_query_error` maps SQLite's "LIKE or GLOB pattern too complex" to:

> SQL error: a LIKE or GLOB pattern in this query is longer than the assistant's 256-character
> limit. Match a shorter pattern, or compare with = or instr().

A text check in `is_safe_select` could not do this, since Codex's patterns are built with `printf`
and `||` at run time. The limit applies to LIKE and GLOB alike.

**Measured:** a 256-character pattern over 16,000 characters runs in 6.1 ms (250 characters,
5.9 ms), where Codex's 8,000-character pattern ran 133 ms a call. A 257-character pattern is
refused.

**What the cap leaves open.** Other string functions still run uninterrupted inside a call: V-75's
territory, recorded in §25 and not changed here.

- `trim()` at the value cap costs about 60 ms a call. Its trim set is held to about 1,300
  characters, because trim() allocates about 12 bytes a character for it, within the 16 KB cap.
- 64 of them summed in one row ran 3.95 s through the tool before the rewrite error.
- So one call can still hold one core far past the budget, and four such calls at once can still
  hold four cores, on each call's own copy. The verifier measured about 25 s for one call of 400
  trims in a 4.1 KB query (V-88 below).
- The R-34 and V-80 tests now use these summed trims as their long query, since the pattern cap
  refuses Codex's LIKE repro at once.

**Test:** `tests/test_chat_sql_guard.py::test_like_and_glob_patterns_are_capped_at_256_characters`.

- A 256-character LIKE pattern and GLOB pattern match.
- A 257-character LIKE pattern built at run time, a 300-character GLOB, a 300-character literal
  pattern, and Codex's 8,000-character repro each return the error naming the limit, in under
  50 ms.
- On the staged code the 257-character pattern matched.

### V-87 · a negative or NaN Retry-After is treated as absent

**The fix.** `api/providers/eodhd.EodhdClient._get` parses Retry-After and uses it only when it is a
non-negative number (NaN compares false). Otherwise the default backoff stands: 0.5 s, then 1 s. A
429 then ends in the typed RateLimited, as with no header.

**Test:** `tests/test_providers.py::test_a_negative_or_nan_retry_after_is_treated_as_absent`, for
`-1`, `nan`, `NaN` and `-0.5`.

- A client call makes 1 + max_retries requests, sleeps the default 0.5 s and 1 s, and raises
  RateLimited.
- A prefetch tick against that provider stores a backoff for every series, and the two ticks after
  it make no request.
- On the staged code the sleeps were negative or NaN; the real `time.sleep` raises ValueError on
  them.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1122 passed, 0 failed, 0 skipped** in 375 s. That is §27's
  1117 plus the V-84 test and the V-87 test's four cases.
- **On this worktree's published `data/macro_radar.db`:** 1120 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §27.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** Its re-check of this round:

- **V-84: closed as the owner framed it; the concern behind it is not closed.**
  - The test fails on the staged code (the 257-character pattern matched) and passes now.
  - Every pattern path is capped: LIKE, NOT LIKE, ESCAPE, `like()` with two and three arguments,
    GLOB, NOT GLOB, `glob()`, mixed case, patterns built with `||` or `printf`, patterns from a CTE,
    a subquery or an aggregate, and patterns read from stored columns. Each 300-byte case answers the
    named error in 6 to 8 ms.
  - A text check in `is_safe_select` would see only literals and would count characters where
    SQLite counts bytes; the connection limit catches literals too. `is_safe_select` still passes
    a 300-character LIKE, since the cap lives on the tool's connection.
  - Legitimate queries on real data pass. One breaks: `summary LIKE '%'||headline||'%'`, where two
    headlines are 283 bytes. The error's `instr()` hint recovers it (183 rows).
  - One function at the caps: `trim` 61.5 ms, LIKE or GLOB at 256 bytes 5.6 ms, `json_patch` up to
    23 ms, `instr` 1.4 ms.
  - Summed trims through the tool: 4.0 s for 64, 12.3 s for 200, 24.9 s wall and 24.6 s CPU for 400
    (a 4.1 KB query).
  - Four calls of 64 trims at once on a served copy of the real database: 3.92 cores for 4.04 s,
    against 0.98 cores when they queued on one private copy. Another visitor's call took 13.7 ms at
    most, and a shared-copy reader 0.84 ms. Peak RSS was 265 to 289 MB.
  - So the four-core burst V-84 described is still reachable with trims, a query under every cap
    (V-88).
- **V-87: closed.**
  - The test fails on the staged code (sleeps of -0.92, -0.98 and NaN) and passes now.
  - Negative, NaN, -inf, empty, blank, HTTP-date and junk headers all get the default backoff;
    `inf`, `1e308` and `1e309` are capped at 5 s. Every form ends in a typed RateLimited.
  - With the real `time.sleep`, the staged prefetch raised ValueError, or OverflowError for `-inf`,
    and stored no backoff. Now it calls 8, 0, 0 per tick and stores four backoffs.
  - Finnhub does not retry a 429, and no other sleep reads a header.
- **Decision 41: accurate.** V-85's figures hold (6 to 7 ms a call). The authorizer's loss costs
  nothing the copy's mode and the guard do not refuse. V-86's claims hold, and the V-80 test does
  check all twelve copies closed. The decision does not address V-85's missing concurrency ceiling
  on the Streamlit side.
- **The reworked R-34 and V-80 tests still prove their claims.**
  - The V-80 test fails when the tool uses one private copy ("another visitor's call took
    3474.2 ms").
  - The R-34 test fails when the tool reads the shared copy ("the shared copy's reader waited
    2920.2 ms").
- **No regressions:** 108 passed across the guard, provider and session tests, plus the Desk and API
  assistant tests.

**New findings, recorded unfixed for Codex to judge.** §28 and decision 36 were corrected where V-88
and V-89 showed their wording off; the code is as tested above.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-88 | low | One call can still run about 25 s uninterrupted. Two-argument `trim` costs 61.5 ms a call at the caps; the tool's connection allows expression depth 10,000 and 1,000 function arguments, with no limit on SQL length. `WITH x(s,t) AS (SELECT printf('%.*c',16000,'a'), printf('%.*c',1364,'b')\|\|'a') SELECT max(trim(s,t), … ×100) AS m0, … (four such columns) FROM x` (4,139 characters, inside a 2,000-token tool call) ran 24.9 s wall and 24.6 s CPU. It then answered "interrupted at the assistant's 250 ms time limit… filter by a date range", which misleads. `ASSISTANT_MAX_CONCURRENCY` allows four cores for about 25 s each on DEPLOY.md's 1-CPU host; the $1/day ledger is the outer bound | (a) run the tool's query in a child process killed at the budget, the only real bound; (b) `SQLITE_LIMIT_SQL_LENGTH` of about 2 KB plus refusing two-argument `trim`/`ltrim`/`rtrim`; or (c) accept, recording the bound. When the elapsed time is far past the budget, say a function ran long, not "read less" |
| V-89 | nit | The pattern cap is 256 bytes, not 256 characters: SQLite measures the pattern with `sqlite3_value_bytes`. 86 `€` (258 bytes), 129 `é` and 65 emoji are refused with "longer than the assistant's 256-character limit"; 790 stored headlines hold multi-byte characters. `_QUERY_MAX_PATTERN_CHARS`, its comment and the error text say characters (the report now says bytes) | rename to `_QUERY_MAX_PATTERN_BYTES`, word the error as a 256-byte limit (fewer characters for accented text), and add a multi-byte case to the test |
| V-90 | nit | Two tests are weaker than their docstrings. (a) The V-87 test's prefetch half passes on the staged code, because `time.sleep` is stubbed to record, so the staged prefetch never raises; only its sleep-value line catches V-87. (b) The R-34 test never asserts its trims query ran long, so a cheaper future `trim` would make it pass vacuously; today it does fail on a shared-copy variant | (a) stub sleep to raise as the real one does; (b) assert the long call took more than 1 s |
| V-91 | nit (predates this round) | The prefetch runs on the worker thread that builds generations (`_run` calls `_prefetch_once`; `PREFETCH_MARKET` defaults to 1), and the provider's retries sleep on that thread. With a valid Retry-After of 5 or more (or `inf`), one tick sleeps about 40 s (4 series × 2 × 5 s); with EODHD timing out, about 96 s (8 s × 3 attempts × 4 series). Meanwhile a new database file is not published and a hold is not retried | run the prefetch on its own thread or executor, or give its `refresh_candles` a client with `max_retries=0` and rely on the prefetch's own backoff |

## 29. Twenty-sixth round (the verifier's V-88, V-89 and V-90 fixed; V-91 accepted)

V-88 is fixed by caps, as the owner specified, and its residual is accepted with the owner's
reasons (decision 42). V-89 and V-90 are fixed. V-91 is accepted (decision 43). Staged, not
committed.

### V-88 · the guard's caps

**The fix** (decision 42). `sql_guard_refusal` caps a statement at 2 KB and 16 function calls, and
refuses two-argument `trim`, `ltrim` and `rtrim`. The interrupt's error now reads:

> SQL error: the query exceeded the 250 ms budget; simplify it. If it reads many rows: filter by a
> date range first (…); do not join on computed month keys (…); join on the regimes table's stored
> month column instead, regimes.date (…); and aggregate before joining.

**Tests** (`tests/test_chat_sql_guard.py`):

- `test_the_guard_caps_a_statements_length_calls_and_two_argument_trims`:
  - 2,048 bytes run and 2,049 are refused;
  - 16 calls run and 17 are refused;
  - keywords before a parenthesis, literals and comments are not counted;
  - two-argument trims are refused bare, double-quoted, bracketed, backquoted and nested, and
    one-argument forms run;
  - the verifier's 25 s repro is refused in under 50 ms;
  - a refused query opens no connection.
  - On the staged code each ran.
- `test_an_interrupted_query_names_the_budget_first_and_the_residual_hold_stays_near_a_second`:
  - the error's first sentence is exactly the budget sentence, and the hints follow;
  - the residual GLOB chain answers the budget error between 0.25 s and 3 s (measured about 1.0 s).
- Queries of the earlier tests that the caps now refuse were rewritten:
  - the 300-column query is written as 300 ones;
  - the V-68 test's trim repro is now the guard's refusal, and its builders drop `trim`;
  - the R-34 and V-80 tests use the residual GLOB chain as their long query.

**The residual measured:** about 1.0 s of CPU in one call (0.98 to 1.04 s; decision 42).

### V-89 · the pattern cap in bytes

`_QUERY_MAX_PATTERN_BYTES`, and the error "longer than the assistant's 256-byte limit (fewer
characters for accented text)". The V-84 test adds a multi-byte case: 85 euro signs and an 'a'
(256 bytes, 86 characters) match, and 86 euro signs (258 bytes) are refused. On the staged code the
error said characters.

### V-90 · two tests strengthened

- **(a)** The V-87 test's stubbed `time.sleep` raises ValueError on a negative or NaN length, as
  the real one does. On the provider code before V-87, all four cases now fail with that
  ValueError, the prefetch half included.
- **(b)** The R-34 test asserts that its long call ran more than 0.5 s. The verifier suggested 1 s,
  but the longest query the caps leave runs 0.98 to 1.04 s, so 1 s would flake; 0.5 s is twice the
  budget.

### Gate, comparison with cc721f0, and verifier

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1124 passed, 0 failed, 0 skipped** in 343 s. That is §28's
  1122 plus the two V-88 tests.
- **On this worktree's published `data/macro_radar.db`:** 1122 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §28.
- All 4,410 frozen entries pass (in the gate).

**Verifier.** A safety classifier stopped its first attempt, which was building timing experiments
against the query tool. So it did not build or time long queries, did not measure the residual, and
did not run the tests that execute the GLOB chain. The rest was checked by reading the code, by
targeted tests in copies, and by calling the guard on short strings.

- **V-88: not closed.**
  - The 2 KB cap counts bytes, and a refusal returns before any connection opens.
  - Whitespace, a newline or a comment between a function's name and "(" still counts as a call.
  - Quoted names count, and the error's wording is exact.
  - The caps test fails on the staged code and passes now.
  - But both function caps can be bypassed (V-92). This round reproduced all six of its repros:
    each passes the guard, and SQLite runs the two-argument trim.
- **V-89: closed.** The byte-named constant and error are used throughout, and the test fails on the
  staged wording.
- **V-90: closed.**
  - (a) The stub raises as the real `sleep` does. The test fails on cc721f0's provider code, and its
    prefetch half alone fails there too.
  - (b) The 0.5 s bound is sound by reading.
- **Decision 42 was inaccurate as written.** It said the caps bound a statement's work, and it did
  not state the `like`/`glob` exemption. Both are corrected above. The residual is this round's own
  measurement, not the verifier's.
- **Decision 43 was incomplete** on what waits (V-97), now corrected.
- **Typical analyst SQL fits the 16 calls.** A monthly pivot uses about 9. A six-series
  `ROUND(MAX(CASE …))` pivot lands at 14 to 16, close to the cap.

**New findings.** Decisions 42 and 43 were corrected where V-92, V-93 and V-97 showed them
inaccurate. **Round 27 accepts all six (V-92 to V-97), for one reason: the free-form SQL tool ships
disabled (decision 44).** With `ASSISTANT_FREEFORM_SQL` unset, no model-written SQL reaches the guard
at all, and each finding matters only to a deploy that turns the tool on; V-97's decision-43 wording
was corrected in round 26.

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| V-92 | low (reopens V-88; confirmed) | The two-argument-trim rule and the 16-call cap can both be bypassed. `_guard_mask` blanks `'…'` literals, then comments, each with its own regex, and never recognises quoted identifiers, so a comment opener inside an identifier, or a `'` inside a comment or identifier, blanks all the real SQL after it. Each of these passes `sql_guard_refusal`, and SQLite runs a real two-argument trim (`'verheating'`): `SELECT 1 AS "/*", trim(label, 'O') AS t FROM regimes`, the same with `[/*]` or `"a--b"`, `SELECT 1 /* ' */, trim(label, 'O') …`, and `SELECT 1 AS "it's", trim(label, 'O') …`. `SELECT 1 AS "/*", abs(0), …, abs(16)` (17 calls) passes too. Only the 2 KB cap is left: by V-88's figures, roughly 10 s or more a call (estimated, not measured) | one left-to-right scanner: a single alternation over `'…'`, `"…"`, `[…]`, `` `…` ``, `--…` and `/*…*/`, taken in order of appearance, blanking literals and comments and keeping quoted identifiers only where directly followed by "("; add the repros to the test. Or fail closed: refuse SQL where `/*`, `--` or `'` appears inside a quoted identifier or comment |
| V-93 | nit | `like`, `glob`, `regexp` and `match` are in `_GUARD_KEYWORDS`, so their function forms are never counted: 17 `like('a','a')` or `glob('a','a')` calls pass. Under the owner's rule they are identifier-followed-by-"(" calls | count the function forms (`like`/`glob` not preceded by an operand), or state the exemption (now in decision 42) |
| V-94 | nit | False refusals from the same masking. `SELECT trim("a,b") FROM (SELECT ' z ' AS "a,b")` is a one-argument trim (SQLite returns `'z'`) but is refused as two-argument: commas inside quoted identifiers count as separators. Text inside quoted identifiers counts as calls (`AS "abs(1)"` counts 1) | fold into V-92's scanner: skip quoted-identifier contents when counting |
| V-95 | nit | The `query_database` tool description (`chat.py` about line 630) says nothing of the new limits (2 KB, 16 calls, one-argument trim), so the model learns them by being refused, at a tool iteration of its 10 | one sentence listing the limits in the description |
| V-96 | nit | "256 characters" survives in the tests: `test_like_and_glob_patterns_are_capped_at_256_characters` and its docstring (`tests/test_chat_sql_guard.py` about lines 546 to 551), and `tests/test_desk_api.py:2228` ("256-character cap") | say bytes |
| V-97 | nit | Decision 43 said only a new file's publication waits during a slow prefetch tick; held items' retries and R-01 rebuilds run on the same thread and wait too | now in decision 43 |

## 30. Twenty-seventh round (the free-form SQL tool ships disabled)

The owner stopped guarding free-form SQL by default (decision 44). No verifier round was run. Staged,
not committed.

**The change.**

- `src/analytics/chat.py` adds `freeform_sql_enabled()`, `active_tools()` and `_run_tool()`. The
  agent offers `active_tools()`, uses it for the spend bound, and dispatches every tool request
  through `_run_tool`.
- System prompt principle 5 no longer names the tool.
- `deploy/api.env.example` and `deploy/ENV.md` document `ASSISTANT_FREEFORM_SQL`, off.
- The guard, the caps and the per-call copy are unchanged, for a deploy that turns the tool on.

**Test:** `tests/test_chat_sql_guard.py::test_the_free_form_sql_tool_is_off_unless_its_variable_turns_it_on`,
through the agent itself with a scripted model client.

- **Off.** With the variable unset, and set to `""`, `0`, `false`, `off`, `no` and `2`:
  - the model is offered exactly the seven fixed-SQL tools, on both of its calls;
  - its request naming `query_database` comes back as an error tool result ("not enabled on this
    server"), and no SQL runs;
  - the system prompt names no `query_database`.
- **On.** With `1`, `true`, `YES` and ` on `, the tool is offered first and its query answers
  through the guard.
- On the staged code the gate does not exist (the tool was always offered).
- The guard's tests call the tool's implementation directly, so they still pin its behaviour for
  an enabled deploy. `tests/test_env_template.py` checks that the new variable is documented.

**Gate.** The full Python gate ran on two copies of this tree, each with the main checkout's
`web/dist` and `MRR_WEB_NODE_MODULES` set.

- **On the local database every earlier gate used** (a backup copy of the main checkout's
  `data/macro_radar.db`, 2026-09-15): **1125 passed, 0 failed, 0 skipped** in 332 s. That is §29's
  1124 plus the round-27 test.
- **On this worktree's published `data/macro_radar.db`:** 1123 passed and 2 failed, the two
  `test_asset_history` tests that predate the branch (§15).
- **The web app, on a copy of `web/`:** `tsc -b --noEmit` is clean, and vitest passes 1,104 of
  1,104 tests in 99 files.
- Both database files hash as before: published `656d7ca81d5165b1`, scratch `e7000c76d040359c`.

**Clean store against `cc721f0`.** The same 17 studies:

- 15 are byte-identical; only the two WTI studies differ.
- The output is byte-identical to §11 through §29.
- All 4,410 frozen entries pass (in the gate).

**Verifier:** none this round, by the owner's instruction.
