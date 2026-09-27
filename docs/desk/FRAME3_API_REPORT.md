# FRAME3_API_REPORT.md: session B's report (desk/frame-3-api)

Session B1, 2026-09-26. The plan is `docs/desk/FRAME3_API_PLAN.md` at `2def37b`; section numbers
below are the plan's unless they say "spec".

## Summary

B1 is built: plan §7 commits 1, 2, 2a, 3, 4 and 5. B2's commits 6 and 9 followed. Commits 2–5 were
first pushed for review at `6bc6c61`, on `dc9704d`. After Codex's R-01 the branch was rebuilt on
`main` at `9979fe9`, so the spec, the frame report, the notes and the screenshots are main's (next
section but one). The shas below are the rebuilt ones, with the earlier ones in brackets.

| Commit | What |
|---|---|
| `931f41d` | the API plan and its status file, as the plan branch left them at `2def37b` |
| `2ca30da` (`e2de5b3`) | commit 1: the envelope, the error map, the six deferred stubs, the enveloped 405, the contract helper |
| `cc54787` (`2b16d15`) | after the hardening merge: its schema-check handler steps aside on the v2 routes; the v2 paths join its route inventory; S-28 in the contract |
| `6e9c1df` (`cb96963`) | commit 2: the engine trace (event table, signal trace); native results unchanged |
| `4b75285` (`d641623`) | commit 2a: the NYSE holiday tables for 1962–2023 (S-12) and the older bond-market closures |
| `d747a11` (`d03b6ce`) | commit 3: the catalog, the precompute, the study ceiling, `/study` and `/study/catalog` |
| `865fc52` (`bc1d17d`) | commit 4: `/study/events` and its CSV |
| `ea77f08` (`6bc6c61`) | commit 5: `/ledger` |
| `6a8db2b` (`ce9cc30`) | commit 6 (B2): `/technicals` |
| `cf384c3` (`78e0bae`) | commit 9 (B2): `/overview`, with the parts of commit 7 it reads |
| `1516af6` (`d73a128`) | Codex R-01: one generation per request |
| `cada0a3` | the native golden rebuilt at `9979fe9` |
| `18ee503` | Codex round 2, R-03: the regime tile needs both stored slopes |
| (this commit) | commit 11: this report and the CLAUDE.md notes for the study routes |

- **The native regression holds.** Layer 1 (the traced path returns the identical dict) and layer 2
  (HEAD against the golden, 57 queries) pass. The golden was built at `dc9704d` and rebuilt at
  `9979fe9`; its 57 digests did not change, because `src/desk` is the same on both. Layer 3, the A/B
  on the published copy, prints `byte-identical: 16/16` at commit 2, at the old tip and at the
  rebuilt tip. On hardening's scratch store, where WTI and DXY are stored, it is also 16/16.
- **The gate passes at every commit** except the same two `test_asset_history.py` tests. They fail
  identically on `origin/main` with the same database copy, because they assume a store without
  `asset_prices`.
- **Build time (§4.2): the catalog adds about 60 ms to a warm rebuild.** Its 13 studies add 1.24 s
  of item time, which ends inside the allocation child's ~2.45 s. That is far below the ~20 s bar,
  so the items stay in-process.
- **The pre-1970 disclosure counts 67** DGS10 holidays on the published copy, as the plan predicted.
- **Five plan instructions met a tree that differs**; each followed the tree (next section).
- **Codex R-01 is fixed** (`1516af6`): a request that arrives before the first publication now reads
  one generation from its first item lookup to its envelope.
- **Codex round 2's R-03 is fixed** (`18ee503`): `/overview`'s regime tile serves a direction only
  from a finite stored slope, and is awaiting otherwise.
- **Commits 7, 8 and 10 are session B2a's,** on `desk/frame-3-api-b2a`. Merging it with this branch
  conflicts in six files, and the last section says how each resolves.

## Where the plan and the tree differ

The operator's rule: follow the tree and record it here.

1. **The bond market's Veterans Day, 1974–1977** (plan N7, "Veterans Day was the fourth Monday of
   October from 1971 to 1977").
   - **What the store shows.** DGS10 has values on the fourth Mondays of October 1974–1977 and none
     on those years' 11 Novembers. The bond market went back to 11 November in 1974, four years
     before the federal date.
   - **What was built.** `bond_extra_closures` closes the fourth Monday of October in 1971–1973
     only.
   - **Columbus Day** matches the plan: 12 October through 1970. A Sunday closes the Monday and a
     Saturday closes nothing, which the store also shows.
   - **Check.** No closure the function names, 1962–2025, carries a stored DGS10 value.
2. **Where the `desk_study` builder lives.** §4.2 says "a `_desk_study(slug)` builder in
   api/analytics_cache.py"; §0.1 says the builders live in `api/desk_items.py`. The builder is in
   `api/desk_items.py`, and `api/analytics_cache.py` only registers it (§0.1's rule: existing files
   are edited only where a registration lives).
3. **B-05 case 11** ("/ledger, /overview and /study agree"). There was no `/overview` in B1. The
   commit-5 test pinned `/ledger` against `/study`; commit 9's test adds `/overview`.

4. **Commit 9 reads commit 7's pieces, which the tree does not have.**
   - **What commit 9 needs.** `/overview`'s regime and recession tiles read:
     - the `desk_regime` item (the stored regimes rows);
     - N5, `recession_provenance()`;
     - R4, R8 and R9.
   - **Where the plan builds them.** Commit 7 (`/regime`), which is not built.
   - **What was built.** Commit 9 builds exactly the part `/overview` reads: `desk_regime` holding
     the rows and N5, and R4, R8 and R9 in `api/desk_v2.py`. Commit 7 adds N6 (the next-print
     thresholds) and the `/regime` route on top of them.
5. **`desk_regime` survives a provenance failure.**
   - **The plan's rule** (§1.0) is that an item's exception is stored as its error.
   - **What the builder does.** It logs a provenance it cannot build (a store without the model's
     `raw_series` inputs) and serves the regimes rows with `recession: null`.
   - **Why.** Otherwise the regime tile would read awaiting only because the recession inputs
     are missing. The recession tile then reads awaiting with the S-27 sentence.

## The rebase and the merge adjustments

- **The rebase.** `git rebase origin/main` (`dc9704d`). The one conflict was in `api/main.py`,
  where hardening's `_schema_check_failed` handler sat beside commit 1's 405 handler; both were kept.
- **The docs.** `git checkout desk/frame-3-api-plan -- docs/desk/` brought the spec (at `42298cb`)
  and the plan (at `2def37b`). After that, the contract tests pass against the client at `42298cb`
  and at the `desk/frame-3` tip `00460b2`.
- **Hardening's handler steps aside** (§3). A `SchemaCheckFailed` that escapes a v2 handler (from a
  dependency or middleware) answers the envelope's 503 `schema_check`. Everywhere else it keeps
  hardening's body byte for byte.
- **The route inventory.** The six stubs joined hardening's `ROUTES`, and each later commit added
  its routes. The sweep's "missing endpoint" example moved off `/api/desk/positions`, which is
  served now.
- **The contract (S-28, round 6's R-16).** An error is exactly `{code, message}`. The one exception
  is `code: "schema_check"`, which carries exactly `provider: "api"` and `retryable: true` besides.
  This is spec §12.0 as folded on `desk/frame-3`, which the operator ruled the authority.
- **The env template.** Its `ENGINE_VERSION` comment now follows the ruling:
  `RENDER_GIT_COMMIT` is production's source, and there are no Dockerfile lines.

## The rebuild on `9979fe9` (after Codex R-01)

**The instruction:** `git rebase --onto origin/main <setup commit>`, so that the spec, the report, the
notes and the screenshots come from `main` (`9979fe9`). Then re-add `docs/desk/FRAME3_API_PLAN.md`
and `FRAME3_API_PLAN_STATUS.md` from the setup commit in a commit named "frame-3-api: carry the API
plan".

**The tree differs from that instruction.**
- **Two setup commits.** The branch had `31540a3` (the folded spec and the first plan) below commit 1,
  and `7392f8b` (spec and plan at `2def37b`) above it.
- **Rebasing onto `main` from `7392f8b`** would drop commit 1, which sits below it and which `main`
  does not carry.
- **Rebasing from `31540a3`** would replay `7392f8b` and its older spec over `main`'s.
- **Only `7392f8b` holds both plan files.** `FRAME3_API_PLAN_STATUS.md` is not in `31540a3`.

**What was done, with the same result as the instruction intends:**
1. `origin/main` (`9979fe9`), then "frame-3-api: carry the API plan" (`931f41d`), holding the two plan
   files from `7392f8b`.
2. Commit 1 and every later commit, cherry-picked in order.
3. `31540a3` and `7392f8b` left out.

**Checks.**
- None of the cherry-picked commits touches `docs/`.
- None of the 30 files they touch changed on `main` since `dc9704d`.
- Every one of those files is byte-identical to its copy at `d73a128`.
- The old tip is kept locally as branch `backup/frame-3-api-d73a128`.

**`main`'s spec is a later fold than `2def37b`'s** (S-28 to S-32, and Codex round 3's R-21 to R-27).
What reaches the built routes was already served:
- the `schema_check` error extras (S-28);
- the pre-1970 warning qualifier;
- the `/study` rules: `horizon` rides with a preset (R-23), and an unknown parameter, a repeated one,
  a preset with slot parameters, or a horizon outside `allowed_horizons` is refused naming what
  (R-27), with the RSI rows' rule (S-31).

The rest belongs to the client (R-21, R-26, S-32), to `/macro` (S-30, commit 8) or to `/pipeline`
(the `validation.json` binding, commit 10).

**The client now ships with `main`.** The contract and parity tests read the tree's own `web/src`, and
none of them skips: 152 pass. The gate no longer sets `DESK_WEB_SRC`.

## Codex R-01: one generation per request (`1516af6`)

**The finding (P1).** `api/worker.PinGeneration` pins a request only when a generation is already
published. A request that arrived before the first publication was unpinned:
- its item lookup, `result()`, waited for generation 1;
- its memo key and its envelope read whichever generation was current later.

Codex's repro: a cold `/study?preset=spx-5d-2sigma` read generation 1, and generation 2 published
before the memo entry was built. The response, and every later warm hit, reported generation 2's
id with generation 1's 73 events and `inputs_hash`.

**The fix** is in `api/desk_envelope.py`:
- `request_generation()` returns the request's pin. Without one, it waits, up to the worker's
  `wait_s`, for a usable published generation, else it raises `Warming`.
  - It pokes the worker, as `result()` does.
  - When the published generation is not usable, it waits for the next one instead of spinning.
- `answer()` pins that one generation (`dbpath.pinned`) before any item read, and holds it through
  the projection, the memo key and the envelope.
- An error reply is dated from the same generation.

**The regression test** is `tests/test_desk_v2_pin.py`, with real engine results on the engine
suite's synthetic store:
1. The first build is gated until the request is waiting.
2. After the request's item lookup, the store loses its pre-2005 S&P closes, and the test waits for
   generation 2 to publish.
3. The cold answer must be generation 1's, whole: its id, `as_of`, `matched_n` and `inputs_hash`.
4. Two warm repeats must be generation 2's, whole: the first builds its memo entry, the second hits
   it.
5. No memo entry may hold one generation's numbers under the other's id.

The test fails on the old tip (it serves generation 2's id over generation 1's numbers) and
passes on the fix. `tests/test_desk_v2_envelope.py` adds the cold case with no publication at all:
the wait ends in `computing`.

## Codex round 2, R-03: the regime tile needs both stored slopes (`18ee503`)

**The finding (P2).** `/overview`'s regime tile took its directions from the classifier's own test,
`trend > 0`. That test is False for NULL, NaN and −∞ alike, so a regimes row with a NULL growth or
inflation slope served "falling".

**The fix** is in `api/desk_v2.py`:
- `_direction` returns None unless the stored slope is a finite number. This is the same rule
  `/regime` follows on `desk/frame-3-api-b2a` (`api/desk_items_macro._direction`).
- `regime_tile` is awaiting, with the S-27 sentence, when either slope has no direction.
- The label is untouched, so the since-last-close line still reads it.

**The tests** (`tests/test_desk_v2_overview.py`):
- **The rule:** `_direction` on finite, zero, NULL, NaN, ±∞ and non-numeric values, and the tile for
  each axis.
- **Hermetic store:** each axis stored NULL, +∞ and −∞ on the K−2 row. The regime tile awaits, and
  the recession and trend tiles stay ready.
- **Codex's repro, per axis:** a scratch copy of the published store. The tile is Goldilocks for
  2026-07 before the edit, and awaiting once that row's slope is NULL.

Before the fix, 13 of the 17 new cases fail. The 4 that pass are the finite-slope unit cases.

**`/regime` is not on this branch.** It is B2a's, and already refuses a slope that is not finite
(its tile is awaiting when either direction is None), so R-03 needed no change there.

## Commit 11: CLAUDE.md and this report

- **CLAUDE.md**, in its Desk section (after "Verification"), gains six bullets:
  - the study routes and the envelope;
  - the catalog and the items;
  - one generation per request (R-01);
  - the engine trace and the three-layer regression gate, with the A/B result;
  - the NYSE holiday tables and the pre-1970 disclosure;
  - the Desk v2 gotchas (R-03's rule; `get_recession_metrics` and a NULL `prob_recession`; the
    tables `api/db.freshness` needs).

  "What NOT to Do" gains the R-01 rule.
- **The placement is chosen to merge cleanly with B2a's CLAUDE.md edit,** which touches the FastAPI
  Details list, the Desk Registry and Store bullets, the Actions section and the dated notes.
- **Out of scope here.** The plan's commit 11 also names the `validation.json` workflow step and its
  gotcha. Both are B2a's (commit 10), and B2a's CLAUDE.md records them. This branch adds no dated
  footnote, so the two branches do not both insert at the head of that list.

## Commit 1: the envelope (`2ca30da`; `e2de5b3` on `dc9704d`, first built as `80c1e2b`)

**What it carries.**
- `api/desk_envelope.py`: the §12.0 envelope and block envelopes, and the routes and block paths
  the client knows (`envelope.ts`).
- The served sentences (S-17, S-27).
- `answer`, with the §3 error map.
- `engine_version`: `ENGINE_VERSION`, else `RENDER_GIT_COMMIT`, else `"unknown"`, read at import
  (S-21).
- `api/desk_v2.py`, the `api/main.py` 405 handler, and `tests/desk_contract.py` with its tests.

**The operator's rulings on commit 1 (2026-09-26).**
- The two commented lines in `deploy/api.env.example` stay. `tests/test_env_template.py` requires
  every variable the API reads to be named there.
- The Dockerfile `ENGINE_VERSION` lines stay out for good. **`RENDER_GIT_COMMIT` is the production
  source of `engine_version`.**
- `desk/frame-3`'s spec is the authority for the contract.
- The client parity tests may skip without the client. They read `DESK_WEB_SRC` (a `web/src`
  directory), and 12 tests skip without it. Every gate on `dc9704d` ran them against a `git
  archive` of `desk/frame-3` at `00460b2`. Since the rebuild `main` carries the client, and they
  read the tree's own.

**Other choices.**
- The 405 is scoped to the v2 router's own paths. Under the built bundle, the SPA catch-all turns
  any POST under `/api` into a 405 too; those keep FastAPI's `{detail}`.
- `SchemaCheckFailed` is matched by its class through `sys.modules`, ahead of the other rows,
  because it subclasses `sqlite3.OperationalError`.

**A correction to commit 1's first gate.** That gate's rsync excluded `data/` everywhere, and
`web/src/components/data/` and `web/src/screens/desk/data/` with it. Nothing it tested read those
directories. From the post-merge gate on, the gate copy is a `git archive` of the commit, with the
excludes gone.

## Commit 2: the engine trace (`6e9c1df`, was `cb96963`)

- **`trigger_mask()`** factors the threshold comparison out of `detect_events`, whose cooldown
  loop is unchanged.
- **The side channel.** `_run(trace=...)` copies the run's own arrays onto it after
  `recent_events`, and none of them reaches the returned dict.
- **New entry points.** `run_traced` and `run_on_traced` return `(dict, EventTable, SignalTrace)`:
  frozen dataclasses with read-only arrays.
- **Untouched:** `run`, `run_on`, `slug_for` and `PRESETS`.
- **The golden.** `scripts/desk_native_golden.py` runs the base engine from a detached `git worktree
  add` of `origin/main`, with both pins (generation `"golden"`, as-of 2026-09-24), on the engine
  suite's synthetic store, built by the base checkout's own builder.
  - It wrote `tests/fixtures/desk_native_dc9704d.json`: 57 queries. They are the 3 presets, the
    other 10 catalog queries (the 3 WTI/DXY ones recorded as `NotStored:<series>`) and the engine
    suite's free-form queries.
  - Rebuilt at `9979fe9` for the rebuild (`cada0a3`, `tests/fixtures/desk_native_9979fe9.json`),
    with the same 57 digests.
- **`tests/test_desk_native_regression.py`** holds layers 1 and 2 and the projection checks against
  the run itself:
  - `k == n_events`;
  - per horizon `n`, `n_incomplete`, `up_n/n == hit_rate` exactly, the median, and the extrema
    bracketing it;
  - the table's newest ten rows equal `recent_events`;
  - the regime counts.

  They run on the synthetic store and on the published copy, with the zero-event and
  short-history cases.
- **Layer 3:** `scripts/desk_native_ab.py --base origin/main --db <copy>` prints
  `byte-identical: 16/16`. The 16 are the 3 presets, the 10 other catalog studies (3 of them
  refusals on the published copy) and the audit's 3 studies.

## Commit 2a: the NYSE holiday tables (`4b75285`, was `d641623`)

- **The generator.** `scripts/gen_nyse_holidays.py` writes 1962–2023 into `api/calendar.py` and
  `src/market_data/session.py` from exchange_calendars 4.13.2's XNYS definitions: 569 dates, 101
  before 1970. It uses `regular_holidays` bounded to each year plus `adhoc_holidays`, weekdays only.
  `--check` verifies both files.
- **The published 2024–2027 lists** equal the definitions.
- **Parity with the engine's XNYS sessions** holds every day from 1970-01-01.
- **Before 1970 the two calendars disagree on exactly 69 dates**, the regular holidays
  exchange_calendars keeps as sessions; a test pins that as a fact.
- **The known closings are hard-coded:** 1962-12-25, the 23 paperwork Wednesdays of 1968, Gloria,
  9/11 and Sandy.
  - **The 1968 list's source.** NYSE's own closings document was not reachable online. The New
    York Times of 1968-06-26 confirms the July closings: 10, 17, 24 and 31 July, with the
    Independence Day week's Wednesday not among them. The rest follow the same holiday-week
    exceptions, and match exchange_calendars' ad hoc list.
- **The bond extras:** difference 1 above.

## Commit 3: the catalog and `/study` (`d747a11`, was `d03b6ce`)

**What it carries.**
- **`api/desk_catalog.py` (stdlib):** the §12.3 table, pinned cell for cell by a test that reads
  the spec. It also holds:
  - the 13 engine slugs;
  - the Ledger order and groups, read from spec §8;
  - `normalize()`: R11, with S-20 and S-31;
  - R14 and R15.
- **`api/desk_items.py`:** the `desk_study:<slug>` builder, which also computes the pre-1970 counts
  on the same connection.
- **`api/analytics_cache.py`:** the 13 items before the presets. The presets reuse a catalog item's
  native payload, and fall through to `es.run` when the item refused.
- **`api/security.py`:** the study paths, `DESK_CATALOG_SLUGS` (all 15), and `_preset_lookup` by
  path (S-25).
- **`api/desk_v2.py`:** `/study` and `/study/catalog`, R1, R2 (with U+2212 for a negative), R3,
  R12, R13, N1, the projection memo, and the disclosure.

**"Plan does" choices recorded.**
- **The builder calls `run_on_traced` on a connection it opens itself,** instead of
  `run_traced`. It passes the generation key and cutoff `run` would, so `native` is byte-identical
  to `es.run(query)`, which a test pins. The pre-1970 counts then read on the same connection.
- **`series[]`** is the registry's available tier-1 and tier-2 series with a role, in registry
  order. Copper (tier 3) and the unavailable LBMA gold are left out, as in A's fixture.
- **A catalog row whose item failed** is unavailable with the S-27 sentence, and the failure is
  logged. The whole catalog does not answer 500, and `/study` for that slug still does (§3's
  whole-route row).
- **An engine-slug `preset` resolves** through the 13 written-out engine slugs, then through
  `es.parse_slug`: `vix-w5-z2-up-none-spx` resolves.
  - The middleware treats only catalog slugs as lookups, so an engine-alias preset takes the study
    pool. It still answers, because the result is a lookup either way.
- **An engine note with no words** raises, so the study answers 500, rather than serving the engine's
  own text, which could carry "established".

**The pre-1970 disclosure (round 4's R-10).**
- On the published copy, `/study?preset=10y-2sigma-20d` and `spx-2sigma-10y` serve
  `us10y <count> (includes 67 pre-1970 holidays the engine calendar treats as sessions)`.
- The test computes 67 independently.
- The native warnings and `inputs_hash` are untouched.
- A hermetic store with DGS10 from 1968 discloses its own count.

**Build time (§4.2),** measured before the commit on the rebased tree, with the traced builders.
- **Method.** Fresh processes on byte copies of the published copy (sha256 `9a8b8579…`), medians of
  three runs each. Base is today's `ITEMS` without the `desk_study:*` entries, where the presets run
  `es.run`.

| | cold build | warm rebuild | study items | synchronous items | allocation child |
|---|---|---|---|---|---|
| base | 2,531 ms | 2,449 ms | 286 ms | 468 ms | 2,396 ms |
| with the catalog | 3,231 ms | 2,508 ms | 1,528 ms | 1,713 ms | 2,457 ms |

- **Per study, warm:** 87–260 ms each. The two us10y studies take the most (253 and 260 ms),
  because their pre-1970 count reads DGS10 once more. The presets now cost 0 ms (reused). The WTI
  and DXY studies refuse in under 10 ms, because the published copy stores neither.
- **Once WTI and DXY are stored,** their three studies add about 0.34 s (measured on hardening's
  scratch store with the base engine). The synchronous path is then about 2.05 s, still under the
  allocation child.
- **The first measurement (before the rebase, base engine)** gave the same picture: +70 ms warm.
  Its first attempt was thrown away, because the script had no `__main__` guard and the allocation
  child re-ran it.

## Commit 4: `/study/events` (`865fc52`, was `bc1d17d`)

- **The route.** It takes the parameters of `/study`, S-31 included. It serves every retained
  event, newest first, projected from the event table.
- **The CSV.** `Accept: text/csv` answers §12.4's CSV: `repr` floats, empty cells for nulls,
  `true`/`false`, as `text/csv; charset=utf-8`, with `Cache-Control: no-store`.
- **An answer that is not ready** keeps its JSON envelope and status code.
- **The tests** pin the CSV rows equal to the JSON rows. They also pin the table's parity with
  `/study`'s counts for every catalog study.

## Commit 5: `/ledger` (`ea77f08`, was `6bc6c61`)

- **The rows.** Twelve rows in spec §8's order, with `scored_n` counting the rows whose study
  completed.
- **An unavailable row** (RSI, and WTI and DXY on a store without them) serves its reason with
  every statistic and firing field null, and is not stale (S-19).
- **The firing state** is recomputed for every response over the memoized statistics.
- **`fire_lists()`** gives N1's `new_fires` and `still_firing`, ready for `/overview`.
- **`tests/test_desk_firing.py`** holds B-05's cases and the comparison session at frozen times:
  - before the open and the close;
  - at the close;
  - a weekend;
  - Thanksgiving and its half-day.
- **The memo tests** cross a session and a month boundary on one generation. Every "now" field
  follows the second now, and no memo entry holds one.

## Commit 6: `/technicals` (`6a8db2b`, was `ce9cc30`)

- **The `desk_technicals` item** (N2, N3) reads ^GSPC through `load_level` and aligns it as the
  engine does, on one extended XNYS calendar:
  - it runs through the newest stored close;
  - it opens on 1 January four years before the first close;
  - it is asserted to hold at least the larger of 252 sessions and the 36-month chart range plus
    200.
- **The averages** are the engine's rolling means: a slot with no close nulls them. Their windows
  are real XNYS dates, with the closes they read.
- **The trend state** (equality is `mixed`) begins at the first session of its current run, counted
  from the first stored close. The cross is the later of the two strict crosses.
- **N4 is read, not recomputed:** the `spx-20d-2sigma` item's own trace z on its `evaluated_on`.
- **On the published copy** the answer is A's fixture's, value for value:
  - price 7,706.03 on 2026-09-23;
  - `chg_1d` null over the missing 2026-09-22 close;
  - `ret_1y` +15.12% from 2025-09-22;
  - the windows start 2026-07-15 (49 closes) and 2025-12-05 (199);
  - trend `unavailable` since 2026-09-22;
  - golden cross 2025-07-01.
- **Short histories.** The plan's counts at one stored close hold: 754, 128 and 252 chart points,
  and a calendar that opens by 2016-03-28.
- **S-30** is a `/macro` rendering rule, not built here, as the operator noted.

## Commit 9: `/overview` (`cf384c3`, was `78e0bae`)

- **The composition.** One generation's Ledger rows (R6, N1's two lists), the technicals item, the
  regime and recession items, and `desk_facts`. Each block that cannot be computed is awaiting with
  the S-27 sentence. Every field that depends on "now" is computed for the response.
- **N9.**
  - The five FRED inputs go through `api/freshness.desk_series_states`, with their observation date
    from `db.freshness()["desk_series_latest"]`.
  - ^GSPC and GC=F go through `assess`'s `asset_prices` rule, applied to each symbol's newest row
    from `desk_facts` (read through `load_level`).
- **N10:** VIX on exactly the two sessions, and the K−2 rows of their months.
- **N5,** `recession_provenance()` in `src/analytics/recession.py`, mirrors the model's steps. A test
  pins its scoring rows equal to the served score series.
- **On the published copy** the answer matches the audit and A's fixture:
  - regime tile: Goldilocks, 2026-07, one month in;
  - recession tile: 11.64%, probability month 2026-08, inputs through 2026-05;
  - VIX 14.21 on 2026-09-22;
  - trend tile: `unavailable` since 2026-09-22, golden cross 2025-07-01;
  - `refreshed_at_utc` 05:07:11 UTC;
  - `data_status` current.
- **An observation, not changed.** `get_recession_metrics` returns its empty answer when the latest
  regimes row has a NULL `prob_recession`: `float(None)` lands in its broad `except`. The real store
  always fills the column; the hermetic test store sets it.

## Gates

`make test-api` on a `git archive` of each commit, with:
- `web/dist` from the main checkout;
- `data/macro_radar.db`, the published copy (sha256 `9a8b857968b8de22…`, the audit's);
- `data/desk_scratch.db`, hardening's scratch store;
- on `dc9704d`, `DESK_WEB_SRC` at `desk/frame-3` `00460b2`; after the rebuild, the tree's own `web/src`;
- `MRR_WEB_NODE_MODULES` from the main checkout.

| Commit | Passed | Failed |
|---|---|---|
| `2b16d15` (after the merge) | 1274 | 2 (`test_asset_history`, DB state) |
| `cb96963` (commit 2) | 1296 | 2 (the same) |
| `d641623` (commit 2a) | 1306 | 2 (the same) |
| `d03b6ce` (commit 3) | 1375 | 2 (the same) |
| `bc1d17d` (commit 4) | 1394 | 2 (the same) |
| `6bc6c61` (commit 5) | 1423 | 2 (the same) |
| `ce9cc30` (commit 6) | 1438 | 2 (the same) |
| `78e0bae` (commit 9) | 1459 | 2 (the same) |
| `cada0a3` (the rebuilt tip on `9979fe9`: R-01 and the golden) | 1463 | 2 (the same) |
| `1fc1a76` (R-03 and commit 11; the pushed commit adds only this row) | 1480 | 2 (the same) |

The two failures fail identically on `origin/main`, at `dc9704d` and at `9979fe9`, with the same copies.

## Open for the merge with `desk/frame-3-api-b2a`

B2a built commits 7, 8 and 10 (`/regime`, `/macro` with the three tenors, `/pipeline`) on
`9979fe9`, beside this branch rather than on it. Merging the two needs these reconciliations:

1. **`api/desk_envelope.py` is added on both branches.** B2a carries commit 1's envelope from before
   R-01: no `request_generation`, and `map_exception` without `gen`.
   - **This branch's file must win.** B2a's enveloped routes (`/regime`, `/macro`, `/pipeline`)
     answer through `env.answer`, so they then pin one generation too. `/pipeline/ddl` is plain text.
2. **Both branches register a `desk_regime` item,** with different builders and shapes:
   - here, `api/desk_items.desk_regime`: `{rows: [{month, label, growth_trend, inflation_trend}],
     recession}`;
   - on B2a, `api/desk_items_macro.desk_regime`: the rows with directions already resolved, a
     recession block, N6's next-print thresholds and the stored release times.

   **The merge keeps one item.** `/overview`'s `regime_tile` and `regime_run` then read its shape.
   Its `_direction` is already the one R-03 asks for.
3. **`api/analytics_cache.py` and `tests/test_desk_api.py`** (`ROUTES`) are edited on both branches:
   - `ITEMS` gains the Desk entries on each;
   - `ROUTES` gains each branch's paths.

   The union is wanted in both files, with the one `desk_regime` of item 2.
4. **`src/analytics/recession.py`: both branches add `recession_provenance()`** (N5), here built for
   `/overview` (difference 4 above) and on B2a in commit 7, the plan's home for it.
   - **The merge keeps one.** Both must close their connection in a `finally` (hardening's static
     test).
   - This branch's scoring-rows test (`test_the_recession_provenance_dates_the_served_score`) must
     hold on whichever is kept.
5. **`tests/desk_contract.py` is added on both branches, and `deploy/api.env.example` is edited on
   both** (the two commented `ENGINE_VERSION` / `RENDER_GIT_COMMIT` lines). The contract helper needs
   the union of both sides' route schemas. The env template keeps one copy of the two lines.

**A trial merge** (`git merge-tree` of this tip with B2a's `6ebbf9d`, 2026-09-26) conflicts in
exactly the six files above. `CLAUDE.md` and the plan files merge cleanly.

Further notes:
- **The regression gate re-runs** after the merge: B2a's commit 8 adds the three tenors to
  `src/desk/series.py`.
- **B-05 case 11** covers `/ledger`, `/overview` and `/study`.
