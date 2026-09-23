# Desk · integration — report

Branch `desk/integration`, cut from `origin/main` @ `a739585` on 2026-09-22 in the worktree
`/Users/maxkomen/Projects/Macro/macro-regime-radar-integration`. It merges `desk/event-study`
(`447467d`) and `desk/frame` (`0ac8b5c`) and makes them one product. Nothing pushed; `main` and
`origin/main` untouched (`a739585`); no `.db` or `data/` path in any commit; every file staged by
explicit path; the real database never opened for writing (every run used copies in the session's
scratch folder). **Stopped at the gate: waiting for `PUSH OK desk/integration`.**

## 0. Where it stands

| Gate (at `8fd792e`, the last code commit) | Result |
|---|---|
| Python, `.venv` (3.13), whole suite, `data/macro_radar.db` = the Sep 15 local snapshot | **993 passed, 0 failed** (3 min 32 s) |
| Python, the same suite with the launch copy (asset_prices, no desk_series) | 991 passed; the 2 failures are `test_asset_history`'s two tests that assume the snapshot lacks asset_prices, and they fail identically on `a739585` with that copy |
| Python, anaconda, `tests/test_streamlit_backports.py` | 7 passed |
| `tsc -b --noEmit` · vitest · `npm run build` | clean · **99 files, 1,104 passed** · clean |
| Docker image on `python:3.13-slim` from `requirements-api.lock` | built; `import api.main` 0.46 s with no heavy module loaded; exchange_calendars 4.13.2; boots in 8–10 s (§5) |
| `scripts/smoke_public.py` against that image, public posture, no provider tokens | before the first refresh **48 passed, 7 warnings, 0 failed**; after it **50 passed, 5 warnings, 0 failed** |
| e2e, full suite at `910498e`, launch copy, no provider keys | 762 passed, 50 failed, 10 did not run; 47 of the 50 fail identically on `a739585` in the same setup; the other 3 were F8, fixed in `8fd792e` (§4) |
| e2e, full suite at `8fd792e`, launch copy + desk_series, no provider keys | **765 passed, 47 failed, 10 did not run** (43.2 min): the 47 are exactly the 47 that fail on `a739585` in the same setup, none caused by this branch; the 10 are Credit's serial group, then run one by one: **10 passed** (§6) |
| Independent verifier (did not write the code), three rounds | round 3 at `8fd792e`: every finding V-01 to V-13 fixed (V-09 accepted as is), no new defect, hygiene intact (§4) |

## 1. The commits (first parent)

| # | Commit | What |
|---|---|---|
| 1 | `4171117` | Merge `desk/event-study`: clean (9 files auto-merged, no conflict; `yfinance` stays out of `requirements-api.txt`, the API version was already 1.5.0 on main). |
| 2 | `eb53496` | **lock: add exchange_calendars.** `scripts/lock_api_requirements.py` walks a hand-kept `ROOTS` list, so the pin event-study added to `requirements-api.txt` never reached `requirements-api.lock`, and the image (which installs only the lock) would have failed at `import api.main`. Root added, lock regenerated from the tested `.venv`: `exchange_calendars==4.13.2` plus its closure (`korean_lunar_calendar`, `pyluach`, `toolz`, `tzdata`); nothing else moved (the verifier regenerated it byte for byte). `tests/test_api_lock.py` (failed first, on `exchange-calendars`) pins the roots to the txt file and every requirement to a pin. |
| 3 | `8cf8b81` | Merge `desk/frame`. Conflicts kept both sides: CLAUDE.md (the launch-1 note and the frame note); `TopBar.tsx` (the assistant-resting chip **and** the `mrr-desk-entry` link, both imports); `api/main.py` (one `desk_router` import, one include); `api/desk.py` (event-study's module byte for byte as the base, its queue, cache, generation lease and validation intact, and the frame's inventory route and helpers appended byte for byte, checked mechanically); `tests/test_desk_api.py` (both suites; three tests adapted to the union, F3). |
| 4 | `118a359` | `api/desk.py` imports the engine on first use (F1). |
| 5 | `15e0e1b` | Step 3: the inventory lists the desk_series rows with their freshness. |
| 6 | `7fdd314` | Step 4: `awaiting_refresh` on a database without desk_series. |
| 7 | `a19d8dc` | The Event Study page on the engine's real contract, slugs and states (F4); the Freshness drawer label (F5). |
| 8 | `bcd2403` | `scripts/smoke_public.py` checks the Desk's reads (F6). |
| 9 | `910498e` | Three render fixes seen on the engine's real answers (F7). |
| 10 | `ff31c02` | The independent verifier's first round, V-01 to V-08 (§4). |
| 11 | `8fd792e` | The verifier's second round (V-11, V-12, V-13, V-08's page wording) and the phone MobileNav order (F8). |
| 12 | (this one) | CLAUDE.md and this report. |

## 2. Steps 3 and 4

**Step 3 (the event-study report's §10 follow-up).** `/api/desk/pipeline/inventory` returns the
rows `/api/freshness` serves, then one `desk:<series_id>` row per desk_series series: the ones the
full refresh stores (`registry.REFRESH_TIER`, pinned to `refresh-data.yml`'s `--tier` and to the
writer's default), then any other series the table holds. Each is judged by
`api/freshness.desk_series_states` with the FRED daily rule (the table stores true observation
dates, not month stamps): `close` within `DAILY_TOLERANCE` business days of the newest print due,
`stale` beyond, rates and spreads on the bond calendar, VIX on the NYSE's. The writer's
`desk:<id>` watermark adds a failed fetch or a short history to the reason. Before the table
exists every row is `unknown`, "awaiting the first full refresh". The per-series maxima ride in
`db.freshness()`'s per-generation memo (the worker fills it; no request computes it).
`/api/freshness` carries no desk rows (no main-app page reads desk_series); its `desk_series` sla
verdict, which event-study added and the main app's Freshness drawer lists, now follows the same
per-series rule over the refresh set (V-06) and reads "Desk daily history" (F5). `asset_prices`
names the event study among its readers. The Data Pipeline page groups the rows as "Desk · daily
history" (`pipeline/inventory-groups.ts`); `schema.md` names the table.

**Step 4 (the deployed database lacks desk_series until the first post-merge full refresh).**
Probed before any change, every route against a copy of the launch database (asset_prices, no
desk_series): the API booted and answered every route; the three presets were **ready** (they read
asset_prices and the regime table only); but a study on the 10Y, 2Y, 2s10s, VIX or HY OAS
answered 503 `not_stored` with the raw sqlite text "no such table: desk_series", the assets list
called those five series "planned", and a tier-2 study gave the same raw text. Now:

- the engine's `NotStored` carries the series key and whether the full refresh stores it
  (`registry.stored_by_refresh`: asset_prices rows always, desk_series rows at or below
  `REFRESH_TIER`); the flag survives `copy.copy`, which is how the worker re-raises a stored error;
- such a study answers **200 `{"status": "awaiting_refresh", slug, series, detail}`**, `no-store`,
  in plain words ("VIX (VIXCLS) is awaiting the first full refresh: this database has no
  desk_series table yet, and that refresh stores it."; "…the next full refresh…" when the table
  exists but a series' rows do not); a planned tier-2 series stays 503 `not_stored` and says it is
  tier 2;
- the assets list marks the five `awaiting_refresh` and lists their keys; a preset on a database
  without asset_prices either answers the same state, and (V-01) never holds a generation back;
- the page prints the state (badge "as of unknown", the engine's sentence, a way back to the
  preset), and the builder keeps those series selectable, marked "awaiting refresh".

Tests: every documented route answers (no 5xx outside the provider layer, the POST calculators
200, `/health/ready` ready) on the scratch copy without desk_series; the awaiting state (shock and
condition), the ready presets, the tier-2 503 and the inventory rows there; the presets awaiting on
a copy without asset_prices either; a generation that goes from presets ready to a file without
the histories publishes at once; the engine rule on the synthetic database. The real image on the
launch copy answered the same (§5).

## 3. Integration findings (defects the merge exposed; each fixed test-first)

| Id | Finding | Fix | Pinned by |
|---|---|---|---|
| F1 | event-study's `api/desk.py` imported the engine at module load, so `import api.main` loaded pandas, numpy and exchange_calendars (CLAUDE.md: heavy deps at the point of use). 0.42 s → 0.46 s warm on main's measure. | a small proxy (`_Engine`) reads the real module on first use (writes forwarded too, V-07); every `es.<name>` in the event-study code is unchanged. 0.22 s warm. | `test_importing_the_app_loads_no_heavy_dependency` (failed first: `['exchange_calendars', 'numpy', 'pandas']`) |
| F2 | The lock missed exchange_calendars (commit 2). | root + regenerated lock | `tests/test_api_lock.py` |
| F3 | Three tests could not hold on the union: the frame's "no `src.*` import" (the event-study base reads the config-free engine from `src/`), "exactly one Desk route", and event-study's text check for "yfinance" (the inventory names yfinance as a provider in its labels). | kept their intent: "never imports `src.config`" (AST and a subprocess); "the three GET routes, POST 405"; an AST import check that catches `import yfinance`, `from … desk_history`, `import_module("yfinance")` and ignores a label | the adapted tests |
| F4 | The frame typed the Event Study page from the spec before the engine existed ("field names provisional"). With the engine merged the endpoints answer 200 in another shape (`shocks`/`key`, `regimes`, `verdict.sentences`, fractional log returns, nullable intervals, valued conditions, regime labels, crosses), and the builder read `assets.shock_assets` of undefined: the page would have thrown. | `web/src/api/desk.ts` adapts the engine's payloads in one place; the page addresses studies by the engine's own slug (`studies.ts` ports `slug_for`/`parse_slug`); states ready / computing (polled at the engine's 3 s) / awaiting / retryable errors retried / 422 and 503 with the engine's reason / 404 (the fixture, as before); the three presets; cross titles; null-safe cells; a Blocks column; the provenance caption from the engine (the frame's "2,000 resamples" was the fixture's) | `__fixtures__/slugs.json`, generated from the engine, pinned to it by `tests/test_event_study.py` and to the port by `studies.test.ts` (the verifier ran all 27,010 builder studies through the port: all match); `engine-adapter.test.ts` on real payloads under `__fixtures__/`, whose keys a Python test checks against a fresh engine run |
| F5 | event-study's `desk_series` sla row printed the raw table name in the main app's Freshness drawer (the defect launch-1 fixed for asset_prices). | label "Desk daily history" | `test_the_freshness_drawer_names_every_sla_feed_the_api_emits` |
| F6 | `scripts/smoke_public.py` checks "every route the site reads" and knew nothing of the Desk. | `check_desk`: ready PASS; a row, list or preset awaiting a refresh WARN (a fact about the database, like allocation's `not_stored`); anything else FAIL; an inventory without desk rows FAIL; a preset worker error that is awaiting gets one WARN in readiness | `tests/test_smoke_script.py` (5 new) |
| F7 | Seen in screenshots of the page on real answers: the badge read "as of As of unknown" for a dated source with no stamp (a frame bug, also on the Data Pipeline badge before its inventory loads); the verdict printed the engine's text and then the same sentences as a list; the awaiting panel said the presets "answer now", false on a database without asset_prices. | `badgeWords` strips the word's prefix; the desk view lists the sentences, the client view keeps the paragraph; the panel says what the presets read | a `StatusBadge` test |
| F8 | The full e2e: `a11y.spec.ts` walks the phone MobileNav and expects the tabs, Methodology, "Jump to a section", Watchlist in that order; the frame added "Analyst Workspace" after Methodology (its spec §1), and its own run covered `desk.spec.ts` only. These three phone walks were the only e2e failures the branch caused. | the expected order gains the frame's row; the walk's length follows the list | the spec |

## 4. The independent verifier

A fresh agent that wrote none of this code, read-only, with its own scripts and database copies
(`scratchpad/verify/`), no servers, no network. Round 1 at `910498e`, round 2 at `ff31c02`, round 3
at `8fd792e`.

| Id | Severity | Finding | Resolution |
|---|---|---|---|
| V-01 | blocker | The worker's hold rule exempted only `api.db.NotStored`, so the presets' engine `NotStored` on a database without asset_prices counted as a regression and held the new generation back ~90 s; `tests/test_api.py::test_api_allocation_smoke` answered `warming` instead of `not_stored` whenever the repo database carries asset_prices. (My first full run used the Sep 15 snapshot, which lacks asset_prices, so no preset ever regressed there: the gate could not see it.) Present on `desk/event-study` itself; the merge exposed it. | `_fact_about_the_file`: an error flagged `awaiting_refresh` publishes at once, duck-typed so the worker imports nothing of the Desk's. Reproduced, pinned by `test_a_preset_awaiting_the_refresh_never_holds_a_generation_back`; `test_api.py` passes on the launch copy. Fixed (round 2). |
| V-02 | should-fix | `/api/desk/event-study` shared the calculators' four `expensive` slots and held one up to 20 s: four slow studies answered the LBO and scenario POSTs 429. | its own ceiling (`DESK_STUDY_PATHS`, 4, `DESK_STUDY_MAX_CONCURRENCY`). Fixed (round 2). |
| V-03 | should-fix | The server waited 20 s before 202, the client aborts at 15 s: "computing" was unreachable; a 503 `warming` was never retried; a failed asset list hid the builder silently. | `COMPUTE_TIMEOUT_S` 8 s (a test reads the client's `TIMEOUT_MS`); `deskRetry` retries what the API marks retryable; a note when the lists fail. Fixed (round 2). |
| V-04 | should-fix | The a11y phone MobileNav order (F8) was uncommitted. | committed in `8fd792e`. |
| V-05 | should-fix | Inherited tests patched `es.run` while the request path calls `es.run_on`: "a preset never computes on the request path" could not fail; the slow wrappers did nothing; the condition case of Step 4 was untested. | patch `run_on`; the condition cases added. Fixed (round 2). |
| V-06 | should-fix | The drawer's `desk_series` verdict (NYSE calendar, oldest newest date over every stored series) read stale the day after Columbus Day while every inventory row read close, and a tier-2 series fetched by hand pinned it stale. | the same per-series rule as the inventory over the refresh set; `validate_db` reports the per-series maxima; its fixture stores the five tier-1 series. Fixed (round 2). Nit left: the sla row's `expected` is null, so the drawer prints "—" there. |
| V-07 | nit | Patching through the proxy left a shadow attribute; an engine import error surfaces inside an `except` clause. | writes forwarded. The import-error case stays: the image's lock carries the engine and an import error would fail every Desk request loudly. |
| V-08 | nit | "The first full refresh" also when the table exists but a series' rows do not. | "next" there (engine, smoke); the page says "a full refresh". |
| V-09 | nit | `numSlug` differs from Python's `repr` for hand-typed exotic numbers (1e-7, -0). | left: the engine accepts them and answers its canonical slug; every builder study matches. |
| V-11 | should-fix (round 2) | `tests/test_env_template.py` red: `DESK_STUDY_MAX_CONCURRENCY` missing from `deploy/api.env.example`. | added; read when the middleware is built; the production default asserted. |
| V-12 | should-fix (round 2) | `tests/test_workflows.py` red: V-06's fix made `api/freshness.py` import `src` (validate_db runs it on the lean installs). | `DESK_REFRESH_SERIES`, a stdlib mirror of the registry's refresh set, pinned by a parity test. |
| V-13 | nit (round 2) | Preset lookups shared the study ceiling: the page's default study could wait behind other visitors' queries. | `?study=<preset>` alone reads under the stored-read ceiling (`DESK_PRESET_SLUGS`, parity pinned); a seeded or parameterised preset takes the study ceiling. |

**Round 3 (final, at `8fd792e`):** V-04, V-08, V-11, V-12 and V-13 FIXED; V-01, V-02, V-03 and
V-06 re-checked and holding; no new finding. Its evidence: 409 passed on an extraction of
`8fd792e` (the 2 `test_public_posture` 404s are its extraction's missing `web/dist`, identical on
`a739585`); the gate probe with four slow studies in flight answers the LBO, the recession
scenario and a preset lookup 200; `_preset_lookup` sends `study=<preset>&seed=7`, a repeated
`study`, `;seed=7`, `&shock=`, `STUDY=` and `%26seed%3D7` to the study ceiling; the mirror equals
the registry by hand. Two notes, neither a defect of these rounds, both in §7: the drawer shows
"Desk daily history · unavailable" to every visitor until the first full refresh (outside
`overall`), and a first full refresh whose five FRED fetches all fail cannot publish (inherited
from `desk/event-study`'s validator).

## 5. Step 5: the lock on Python 3.13, the image, the smoke

Docker 29.8.0 is available, so the image was built locally from this branch
(`docker build -t mrr-api:desk-integration .`, exit 0 at `a19d8dc`; rebuilt at `8fd792e`, image
`550909a444b5`, with the pip layer reused from the first build because the lock did not change).
The first build's `pip install -r requirements-api.lock` installed `exchange_calendars 4.13.2` and
its closure on `python:3.13-slim`. In the final image: Python 3.13.15; `import api.main` in 0.46 s
with no heavy module loaded; exchange_calendars 4.13.2, pandas 3.0.5, numpy 2.5.1, fastapi
0.141.1; the engine's XNYS calendar gives 20 sessions for November 2026 (Thanksgiving out); the
security mirror of the presets equals the engine's.

The container booted on a read-only copy of the launch database (no desk_series), no token: ready
in 7–10 s, generation 1 in ~5.5 s with 16 results and 0 errors, every probed route answering
(allocation from its child process included), presets ready, the VIX study `awaiting_refresh`, the
tier-2 study 503 with its reason, the relay off (`token_configured: false`), the SPA serving
`/desk/event-study`.

`scripts/smoke_public.py --api http://127.0.0.1:18765 --ops-key … --skip-provider` against the final
image in the public posture (`DEPLOY_PUBLIC=1`, an ops key, no provider tokens):

| Database | Result | The Desk |
|---|---|---|
| launch copy, no desk_series (the deployed state before the first full refresh) | **48 passed, 7 warnings, 0 failed** | inventory WARN (5 of 5 not stored yet), assets WARN (the five keys), three presets PASS; the VIX study answers `awaiting_refresh` |
| launch copy + desk_series (after it) | **50 passed, 5 warnings, 0 failed** | all PASS: 5 desk series judged, presets ready (18, 14, 14 events); the VIX study ready |

The warnings are facts about this setup: the relay is off without a token, the Sep 18 copy is
stale against today's calendar, the ledger sits on the container's own disk.

## 6. The e2e runs

All e2e ran from the worktree against its own API on :8765 and Vite on :5195 (8000 and 5173 were
held by the frame worktree's servers), in launch-1's e2e posture (`DEPLOY_PUBLIC=1`, generous rate
limits), with **no provider keys**: `EODHD_API_TOKEN` explicitly blank and no `.env` in the
worktree (the relay reported `token_configured: false`), and no Finnhub or Anthropic key, so no
provider or model call was made.

- **Full suite at `910498e`, launch copy (no desk_series):** 762 passed, 50 failed, 10 did not run
  (Credit's serial group after its health check failed), 43.3 min.
- **Classification:** the 25 failing spec locations were run on `a739585` (origin/main) in the
  identical setup (same ports, env, database, a detached worktree of `a739585`): 124 passed, **47
  failed, and those 47 are exactly the branch's other 47**. What their errors say: the seven
  "health" checks and the `states` / `responsive` cells count console lines for 403s on
  `/api/market/candles/*` (the API log: the on-demand layer refuses candles without a token), and
  so does Markets 8 (ranges); the single-name M5 and Markets 6 checks and the four watchlist tests
  (three in `watchlist.spec.ts`, one in the functional sweep) need `/api/market/search` or
  `/profile` (503 `missing_token`); the G1 overlap sweep finds the strip's stale-close stamp
  ("Stored closes · Sep 18 · 2 sessions behind", shown only when no live tick exists) over a
  sparkline; A2 finds no `vix-live` metric (the relay's); D2 finds the FX tiles at unequal heights;
  A3c finds a freshness line naming the copy's Sep 18 close under its mocked pre-open clock. None
  touches the Desk. The remaining 3 were F8.
- **Full suite at `8fd792e`, launch copy + desk_series (the state after the first full refresh):**
  765 passed, 47 failed, 10 did not run, 43.2 min. The 47 failures are, test for test, the 47 that
  fail on `a739585` in the identical setup: **no failure is the branch's**, and F8's three phone
  walks pass. The 10 that did not run are Credit's serial group (3 to 15), skipped after its
  environmental health check; run one by one against the same servers they **all pass**.
- **Smoke against the local uvicorn** of that run (the worktree's API, `DEPLOY_PUBLIC=1`, no keys,
  post-refresh copy): 50 passed, 5 warnings, 0 failed.

## 7. What to know before the push and the merge

- **The first full refresh after the merge stores desk_series.** Until then the deployed API
  answers every route; the Desk's five FRED-backed series read "awaiting the first full refresh"
  and the presets are ready. DEPLOY.md's order is unchanged (push `main`, dispatch Refresh Data
  `full`, deploy the API); the new image installs exchange_calendars from the lock.
- **Until that refresh the main app's Freshness drawer lists "Desk daily history · unavailable"**
  (event-study's sla row, outside `overall`); after it, "current".
- **A full refresh whose five FRED calls all fail cannot publish.** `validate_db` (event-study)
  fails a full-mode database whose desk_series table is empty; the writer creates the table before
  it fetches. A FRED outage would also stop `main.py`'s pipeline, so the blast radius is the same,
  but it is one more way a full run can hold the release asset back. Not changed here.
- **The e2e ran without provider keys** (§6). The 47 key-dependent checks were last green in
  launch-1's keyed run; a keyed run of this branch (EODHD on one API only, since a second relay on
  the same token hits the symbol limit) is the owner's call.
- **Not done, by design:** distribution bins (the engine serves none; the panel says so); the
  builder composes shock studies only (crosses are presets); tier 2 fetching; a `RELAY_DISABLED`
  switch (event-study §10); the frame's formatter prints a tiny negative as "-0.0%"; the drawer's
  desk_series row prints "—" under Expected.

## 8. Commands

Push, once approved (the owner runs it; nothing here pushes):

```bash
cd /Users/maxkomen/Projects/Macro/macro-regime-radar-integration
git push -u origin desk/integration
```

Reproduce the gates (worktree root; the main checkout's `.venv`; no `.env` in the worktree):

```bash
cp <scratch>/db/local.db data/macro_radar.db          # test_asset_history assumes the snapshot lacks asset_prices
(cd web && npm ci && npm run build)                     # test_public_posture needs web/dist
EODHD_API_TOKEN="" DESK_DB=<scratch>/db/desk_scratch.db ../macro-regime-radar/.venv/bin/python -m pytest tests --ignore=tests/test_streamlit_backports.py -q -p no:cacheprovider
/opt/anaconda3/bin/python -m pytest tests/test_streamlit_backports.py -q
(cd web && npx tsc -b --noEmit && npx vitest run)
docker build -t mrr-api:desk-integration .
```

e2e: a database with asset_prices at `data/macro_radar.db`, the API from the worktree on a free port
in the launch-1 e2e posture with no keys, Vite on another free port proxying to it
(`VITE_PROXY_TARGET=http://127.0.0.1:<api port> npm run dev -- --port <vite port> --strictPort`),
then `E2E_BASE_URL=http://localhost:<vite port> npx playwright test` from `web/`. Restart Vite after
every commit: three specs compare its build stamp with HEAD.
