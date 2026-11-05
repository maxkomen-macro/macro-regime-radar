# Private data storage: cutover and rollback

Status: **prepared, not active.** The code in this change reads one setting, `DATA_RELEASE_REPO`. While it is unset, every reader and writer uses this repo's `data-latest` release exactly as before. Nothing here creates a repo, a token, a secret or a variable, and nothing here deploys or deletes anything. Each step below that does is the owner's, and each needs its own go-ahead.

`<data-repo>` below stands for the private repo's `owner/name`. It is a placeholder: no real name is recorded here.

## What moves and what stays

| File on `data-latest` | After cutover |
|---|---|
| `macro_radar.db` | the private repo's `data-latest` |
| `validation.json` (the published verdict bound to the database) | the private repo's `data-latest` |
| `snapshot-latest.json` (the static first-paint snapshot) | the private repo's `data-latest` |
| `earnings-cache-ledger-*.bin` (sealed, encrypted) | **stays on this repo.** The ledger is written and read by its own steps (`src/events/earnings_ledger.py`, `api/earnings_ledger_reader.py`), which never read `DATA_RELEASE_REPO`, so its sequence and its consistency checks are untouched |

The database, its verdict and the snapshot always travel together, in the same order as today: database, then snapshot, then verdict.

## Every reader and writer

| Who | Reads or writes | Setting it reads | What it needs at cutover |
|---|---|---|---|
| `refresh-data.yml` (full, news-only, verify-only) | downloads the DB at start; uploads DB, snapshot, verdict after validation | repo variable `DATA_RELEASE_REPO` | repo secret `DATA_RELEASE_TOKEN` (Contents read and write on `<data-repo>`). Without it, a run fails at its first data step with that message, before anything is published |
| `intraday-refresh.yml` | same, DB and verdict | same | same |
| `daily-memo.yml`, `weekly-memo.yml` | the dispatched path reads the `validated-db` run artifact (unchanged); the manual path (no run id) downloads the DB | same | same secret (read is enough for this path) |
| Earnings ledger steps (`--fetch-ledger`, `--publish-ledger`) | this repo's release | none | nothing |
| Render API (`api/bootstrap.py`) | DB and verdict at start and every `BOOTSTRAP_DB_REFRESH_MIN` minutes | env `DATA_RELEASE_REPO` | `GH_DB_TOKEN` must read `<data-repo>` **and** this repo (the ledger reader uses the same token here). A fine-grained token can read public repos, so one token scoped to `<data-repo>` with Contents read covers both while this repo is public |
| Vercel build (`web/scripts/fetch-snapshot.mjs`) | `snapshot-latest.json` into the bundle | env `SNAPSHOT_REPO` (already supported) | `GH_SNAPSHOT_TOKEN` that reads `<data-repo>`. Without one, the build still succeeds and starts without a pre-seeded snapshot |
| Legacy Streamlit (`dashboard/app.py`) | DB at start | Streamlit secret or env `DATA_RELEASE_REPO` | its `GH_DB_TOKEN` secret must read `<data-repo>` |
| `scripts/sync_data.sh` / `make sync-data` | DB to a local copy | env `DATA_RELEASE_REPO` (before `MRR_REPO`) | the caller's `gh` login must read `<data-repo>` |
| Cloud sessions and Codex review environments | the test DB, by the public URL in `CLAUDE.md` | none | a read token in the environment and `make sync-data`; `CLAUDE.md`'s curl line changes at step 4 |
| Earnings-cache probe (`python -m src.events.earnings_cache --probe` with no `--db`) | the public DB URL (`PUBLIC_DB_URL`), unauthenticated | none | after step 4 it stops with "public database download answered HTTP 404". Pass `--db data/macro_radar.db` after `make sync-data`. Left unchanged here: it is an Options Finder module, and a manual tool that already fails loudly |
| Data rollback (`docs/RUNBOOK.md` section 5) | `gh release upload data-latest …` | none | add `--repo <data-repo>` from step 2 on |

A malformed `DATA_RELEASE_REPO` (not `owner/name`) never falls back to the public copy: the API refresh fails with "DATA_RELEASE_REPO is not owner/name" and keeps serving its current file, and the Streamlit app raises.

## Cutover

Each step is reversible until step 4. Check the result before moving on.

**Step 0. Prepare (owner).** Create the private repo. Create the tokens: `DATA_RELEASE_TOKEN` (read and write on `<data-repo>`) and a read token for Render, Vercel and Streamlit. Store each only in that host's secret store. Seed the private release once: create `data-latest` on `<data-repo>` and upload the current `macro_radar.db`, `snapshot-latest.json` and `validation.json`, in that order. Check: `gh release view data-latest --repo <data-repo>` lists the three files and their sizes match this repo's.

**Step 1. Writers go first, with the mirror on.** Set the repo variables `DATA_RELEASE_REPO=<data-repo>` and `DATA_RELEASE_MIRROR=true`, and the secret `DATA_RELEASE_TOKEN`. Each refresh then publishes to `<data-repo>` and, in a separate bounded step that cannot fail the run, copies the same three files to this repo's `data-latest`, so readers not yet switched keep receiving fresh data. Check after the next full and intraday runs: both repos carry the same database size and `updated_at` within minutes, `/api/freshness` still advances, and the run log shows "Mirrored the published files".

**Step 2. Readers switch.** In any order:
- Render: set `DATA_RELEASE_REPO=<data-repo>` and the new `GH_DB_TOKEN`, then restart. Check that `/health/ready` answers `ready` with a new `snapshot_downloaded_at`, that the log carries no "periodic DB refresh failed" or "validation.json could not be verified" line, and that it still shows "earnings ledger reader: ok".
- Vercel: set `SNAPSHOT_REPO=<data-repo>` and `GH_SNAPSHOT_TOKEN`, then redeploy. Check the build log line `[snapshot] snapshot-latest.json → public/snapshot/latest.json`.
- Streamlit: add the `DATA_RELEASE_REPO` secret and the new `GH_DB_TOKEN`, then reboot.
- Cloud environments: add a read token and use `make sync-data`.

**Step 3. Mirror off.** Set `DATA_RELEASE_MIRROR` to anything but `true` (or delete it). This repo's copy stops updating and goes stale. Check one full run: no mirror step runs, and the private release advances.

**Step 4. Remove the public copies (separate yes, not reversible).** Delete only `macro_radar.db`, `snapshot-latest.json` and `validation.json` from this repo's `data-latest`. **Keep the release and every `earnings-cache-ledger-*.bin` asset.** Then update `CLAUDE.md` (test-DB line), `.claude/rules/database.md`, `docs/RUNBOOK.md` sections 3, 5 and 6, and the `Makefile` comment. Check: the public download URL answers 404, and the next refresh, API check, Vercel build and ledger fetch all succeed.

## Rollback

| From | Do | Effect |
|---|---|---|
| Step 1 | delete the `DATA_RELEASE_REPO` variable | writers publish to this repo again on the next run. If a run published only privately, rerun one refresh so this repo's copy is current |
| Step 2 | unset `DATA_RELEASE_REPO` (Render, Streamlit) or `SNAPSHOT_REPO` (Vercel) and restart or redeploy | the reader goes back to this repo's copy, which the mirror kept current |
| Step 3 | set `DATA_RELEASE_MIRROR=true` again | the next run refreshes this repo's copy; until then it is stale |
| Step 4 | upload the current files from `<data-repo>` back to this repo's `data-latest`, then follow the step 1 rollback | restores the public copy. Anything downloaded while it was public stays downloaded |

A run that fails at the token switch publishes nothing, so the last good file stays in place on whichever release it was reading.

## Exposure that Change 1 does not close

Moving the files makes them private. It does not take the same data off the site:

- **Public API routes.** The API serves stored series to anyone: raw price and credit routes such as `/api/credit/oas`, market history, the news feeds and the assistant's tools. Change 2 in the exposure proposal decides which of these stay, and it is tied to the display decision.
- **The Vercel static copy.** The build bakes `snapshot-latest.json` into the bundle and serves it as `/snapshot/latest.json`, wherever the file is stored. Its manifest includes `/api/credit/oas?days=90` and lists the news endpoints (excluded on 5 November only because a field looked like a secret). Change 2 covers this too.
- **Committed test data** in `web/src/fixtures/`, `tests/fixtures/` and `docs/desk/shots/`. New fixtures use invented prices (`.claude/rules/test-data.md`); existing ones are Change 4.
- **Copies already downloaded.** The asset has been public, so earlier copies may exist outside this repo. Removal cannot recall them.
- **Git history.** GitHub's commit listing shows no commit on `main` that touches `data/macro_radar.db`. Other refs were not checked.
- **The sealed ledger** stays public by design. It is ciphertext only.

## Tests

`tests/test_data_release_repo.py` covers the setting's default, blank and malformed values; that the API reads only the named repo and keeps its file when the setting is bad; that the ledger reader stays on this repo; the Streamlit reader; `sync_data.sh` and the Vercel fetcher; that every non-ledger `gh release` line in the four workflows names `--repo "$DATA_RELEASE_REPO"` after the token switch; the mirror step's condition, order, timeout and `continue-on-error`; the memo manual path; and the token switch itself in all three cases.
