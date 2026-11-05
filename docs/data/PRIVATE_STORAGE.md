# Private data storage: cutover and rollback

Status: **prepared, not active.** The code in this change reads one setting, `DATA_RELEASE_REPO`. While it is unset, every reader and writer uses this repo's `data-latest` release exactly as before. Nothing here creates a repo, a token, a secret or a variable, and nothing here deploys or deletes anything. Each step below that does is the owner's, and each needs its own go-ahead.

`<data-repo>` below stands for the private repo's `owner/name`. It is a placeholder: no real name is recorded here. Write it exactly as GitHub shows it, in the same case: the workflows compare names as written.

## What moves and what stays

| File on `data-latest` | After cutover |
|---|---|
| `macro_radar.db` | the private repo's `data-latest` |
| `validation.json` (the published verdict bound to the database) | the private repo's `data-latest` |
| `snapshot-latest.json` (the static first-paint snapshot) | the private repo's `data-latest` |
| `refresh-status.json` (full refreshes' attempt record, read by the API's freshness) | the private repo's `data-latest`, beside the database the API reads it with |
| `earnings-cache-ledger-*.bin` (sealed, encrypted) | **stays on this repo.** The ledger is written and read by its own steps (`src/events/earnings_ledger.py`, `api/earnings_ledger_reader.py`), which never read `DATA_RELEASE_REPO`, so its sequence and its consistency checks are untouched |

Writers publish in the same order as today: database, then the snapshot (full runs only), then the verdict. Full refreshes also write `refresh-status.json` at the start and end of each attempt. These are separate uploads, as they are today, not one atomic step. The verdict names the database's sha256, and the API serves it only for the file whose hash matches, so a reader that catches the release between two uploads serves the verdict as unknown rather than pairing it with the wrong file.

## Every reader and writer

| Who | Reads or writes | Setting it reads | What it needs at cutover |
|---|---|---|---|
| `refresh-data.yml` (full, news-only, verify-only) | downloads the DB at start; uploads DB, snapshot, verdict after validation; full runs read and write `refresh-status.json` | repo variable `DATA_RELEASE_REPO` | repo secret `DATA_RELEASE_TOKEN` (Contents read and write on `<data-repo>`). Without it, a run fails at its first data step with that message, before anything is published. A data repo whose `data-latest` cannot be read (not seeded yet, a token without access, an outage) also stops the run there: unlike this repo, it never proceeds without a prior database, so a refresh cannot build a database that lacks the stored history |
| `intraday-refresh.yml` | same, DB and verdict | same | same |
| `daily-memo.yml`, `weekly-memo.yml` | the dispatched path reads the `validated-db` run artifact (unchanged); the manual path (no run id) downloads the DB | same | same secret (read is enough for this path) |
| Earnings ledger steps (`--fetch-ledger`, `--publish-ledger`) | this repo's release | none | nothing |
| Render API (`api/bootstrap.py`) | DB, verdict and refresh status at start and every `BOOTSTRAP_DB_REFRESH_MIN` minutes | env `DATA_RELEASE_REPO` | `GH_DB_TOKEN` must read `<data-repo>` **and** this repo (the ledger reader uses the same token here). A fine-grained token can read public repos, so one token scoped to `<data-repo>` with Contents read covers both while this repo is public |
| Vercel build (`web/scripts/fetch-snapshot.mjs`) | `snapshot-latest.json` into the bundle | env `SNAPSHOT_REPO`, else env `DATA_RELEASE_REPO` | `GH_SNAPSHOT_TOKEN` that reads `<data-repo>`. Without one, the build still succeeds and starts without a pre-seeded snapshot |
| Legacy Streamlit (`dashboard/app.py`) | DB at start | Streamlit secret or env `DATA_RELEASE_REPO` | its `GH_DB_TOKEN` secret must read `<data-repo>` |
| `scripts/sync_data.sh` / `make sync-data` | DB to a local copy | env `DATA_RELEASE_REPO` (before `MRR_REPO`) | the caller's `gh` login must read `<data-repo>` |
| Cloud sessions and Codex review environments | the test DB, by the public URL in `CLAUDE.md` | none | a read token in the environment and `make sync-data`; `CLAUDE.md`'s curl line changes at step 4 |
| Earnings-cache probe (`python -m src.events.earnings_cache --probe` with no `--db`; manual) | unset: the public DB URL, unauthenticated. Set: `<data-repo>`'s release through the API | env `DATA_RELEASE_REPO` | `GH_DB_TOKEN` (or `GH_TOKEN`) that reads `<data-repo>`; without it the probe stops before any request |
| Data rollback (`docs/RUNBOOK.md` section 5) | `gh release upload data-latest …` | none | add `--repo <data-repo>` from step 1 on, because writers build on the data repo's copy from then |

A malformed `DATA_RELEASE_REPO` (not `owner/name`) never falls back to the public copy: the API refresh fails with "DATA_RELEASE_REPO is not owner/name" and keeps serving its current file, and the Streamlit app shows a warning and keeps its on-disk file.

## Cutover

Each step is reversible until step 4. Check the result before moving on.

**Step 0. Prepare (owner).** Create the private repo. Create the tokens: `DATA_RELEASE_TOKEN` (read and write on `<data-repo>`) and a read token for Render, Vercel and Streamlit. Store each only in that host's secret store. Seed the private release once: create `data-latest` on `<data-repo>` and upload the current `macro_radar.db`, `snapshot-latest.json`, `validation.json` and `refresh-status.json`, in that order. Check: `gh release view data-latest --repo <data-repo>` lists the four files and their sizes match this repo's.

**Step 1. Writers go first, with the mirror on.** Set the repo variables `DATA_RELEASE_REPO=<data-repo>` and `DATA_RELEASE_MIRROR=true`, and the secret `DATA_RELEASE_TOKEN`. Each refresh then publishes to `<data-repo>`. A separate bounded step that cannot fail the run (`scripts/mirror_data_release.sh`) then copies whatever `<data-repo>` holds to this repo's `data-latest`, file by file in the same order, skipping any file whose release digest (or, for an older asset listed without one, whose downloaded bytes) already matches, and checking each download against its digest before uploading it. It creates this repo's release only when GitHub answers 404; any other error stops the step with GitHub's message. It runs on every refresh that is not cancelled, including ones that published nothing or failed, so a mirror that failed once is repaired by the next run and a failed attempt's status still reaches readers not yet switched. In `refresh-data.yml` it is the last step, after the finished status. It never touches the ledger assets. Check after the next full and intraday runs: both repos carry the same database size and `updated_at` within minutes, `/api/freshness` still advances, and the mirror step logs "mirror: … file(s) copied to this repo's data-latest".

**Step 2. Readers switch.** In any order:
- Render: set `DATA_RELEASE_REPO=<data-repo>` and the new `GH_DB_TOKEN`, then restart. Check that `/health/ready` answers `ready` with a new `snapshot_downloaded_at`, that the log carries no "periodic DB refresh failed" or "validation.json could not be verified" line, and that it still shows "earnings ledger reader: ok".
- Vercel: set `DATA_RELEASE_REPO=<data-repo>` (or `SNAPSHOT_REPO`, which wins) and `GH_SNAPSHOT_TOKEN`, then redeploy. Check the build log line `[snapshot] snapshot-latest.json → public/snapshot/latest.json`.
- Streamlit: add the `DATA_RELEASE_REPO` secret and the new `GH_DB_TOKEN`, then reboot.
- Cloud environments: add a read token and use `make sync-data`.

**Step 3. Mirror off.** Set `DATA_RELEASE_MIRROR` to anything but `true` (or delete it). This repo's copy stops updating and goes stale. Check one full run: no mirror step runs, and the private release advances.

**Step 4. Remove the public copies (separate yes, not reversible).** Delete only `macro_radar.db`, `snapshot-latest.json`, `validation.json` and `refresh-status.json` from this repo's `data-latest`. **Keep the release and every `earnings-cache-ledger-*.bin` asset.** Then update `CLAUDE.md` (test-DB line), `.claude/rules/database.md`, `.claude/rules/secrets.md` (`GH_DB_TOKEN`'s scope), `docs/RUNBOOK.md` sections 3, 5 and 6, `deploy/ENV.md`, `deploy/api.env.example`, `web/.env.example` and the `Makefile` comment. Check: the public download URL answers 404, and the next refresh, API check, Vercel build and ledger fetch all succeed.

## Rollback

| From | Do | Effect |
|---|---|---|
| Step 1 | first make this repo's copy current: run `scripts/mirror_data_release.sh` with the same environment and require it to exit 0, then check that both releases list the same digest for `macro_radar.db` (a mirror step that failed leaves the refresh green, so a green run is not proof). Only then delete the `DATA_RELEASE_REPO` variable | writers build on and publish to this repo's copy again from the next run, with no private history lost |
| Step 2 | unset `DATA_RELEASE_REPO` (Render, Streamlit, Vercel; and `SNAPSHOT_REPO` on Vercel if it was used) and restart or redeploy | the reader goes back to this repo's copy, which the mirror kept current |
| Step 3 | set `DATA_RELEASE_MIRROR=true` again | the next run, whatever it publishes, brings this repo's copy current; until then it is stale |
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

`tests/test_data_release_repo.py` covers the setting's default, blank and malformed values; that the API reads the database and its hash-bound verdict only from the named repo and keeps its file when the setting is bad; that the ledger reader and the ledger workflow steps stay on this repo with the built-in token; the Streamlit reader; `sync_data.sh`; the Vercel fetcher, run under node with `fetch` stubbed; the probe's download; that every other `gh release` line in the four workflows names `--repo "$DATA_RELEASE_REPO"` after the token switch; the memo manual path; the token switch in all three cases; and the mirror script against a fake `gh` (tokens per repo, order, repair after a failed run, no re-upload of current files, digest mismatch, unreadable data repo, ledger untouched). Each property was checked by breaking the code and watching its test fail.
