---
paths:
  - ".github/workflows/**"
  - "scripts/workflow_mode.py"
  - "scripts/validate_db.py"
  - "scripts/validation_asset.py"
  - "scripts/sync_data.sh"
  - ".gitattributes"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

## GitHub Actions Workflow Conflict Pattern (DO NOT REVERT)

**Status:** Fixed and deployed May 2 2026 (commit `e581a49`, "Fix workflow binary conflict pattern (Refresh Data #295 fix)"). Validation: confirmed clean by README audit on May 2 2026 (`grep -c "git stash"` returns 0 in both files; `grep -c "git reset --soft origin/main"` returns 1 in each). Continue to monitor scheduled runs.

### What's in place

Both `refresh-data.yml` and `intraday-refresh.yml` share a single concurrency group:

```yaml
concurrency:
  group: data-write
  cancel-in-progress: false
```

The two workflows queue against each other instead of racing — still important now that both
publish the DB to the same `data-latest` release asset (serialized so `--clobber` uploads don't race).

**Update (Jun 2026):** the DB is no longer committed to git — it's downloaded from and uploaded
to the `data-latest` Release (see **Database**). The retry / `reset --soft origin/main` loop below
now guards only `refresh-data.yml`'s small `output/playbook.json` commit; `intraday-refresh.yml`
no longer pushes to git at all.

Note: `daily-memo.yml` and `weekly-memo.yml` generate HTML memos and do not write the DB back, so
they are not in the `data-write` concurrency group (they only download the DB read-only).

### Retry loop pattern

The "Commit and push" step in BOTH DB-writing workflows uses a 5-attempt retry loop with `git reset --soft origin/main` instead of the old `git stash` / `git pull --rebase` / `git stash pop` pattern. The **entire attempt — fetch, reset, commit, push — is one `&&` conditional** so a transient failure on any step retries instead of aborting:

```yaml
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add data/macro_radar.db
git add output/playbook.json 2>/dev/null || true   # refresh-data.yml only
git commit -m "<EXISTING_COMMIT_MESSAGE>"
COMMIT_MSG=$(git log -1 --pretty=%B)
for i in 1 2 3 4 5; do
  if git fetch origin main \
     && git reset --soft origin/main \
     && git commit -m "$COMMIT_MSG" \
     && git push; then
    echo "Push succeeded on attempt $i"
    exit 0
  fi
  echo "Attempt $i failed (fetch/reset/commit/push), retrying..."
  sleep $((RANDOM % 10 + 5))
done
echo "Push failed after 5 attempts"
exit 1
```

### Why this works

`git reset --soft origin/main` moves the branch pointer to origin's tip while keeping the staged DB changes, then re-commits on top. **No rebase, no merge, no binary conflict possible.** Each attempt has a 5–14s random backoff.

**Why the whole attempt is one `if … &&` chain (2026-05-26 fix):** GitHub Actions runs `run:` steps under `bash -e` (errexit). A *bare* `git fetch origin main` inside the loop would, on a transient HTTP 403 during ref listing, abort the entire step immediately — the retry loop never executes (no "retrying…" line is ever printed). Only `git push` was previously protected by its `if`. Folding fetch/reset/commit into the same conditional makes every network step retryable. This is what the 2026-05-26 transient-403 failure exposed: the loop existed but was dead for fetch-side errors.

### Commit messages preserved across the soft reset

- `refresh-data.yml`: `"Auto-refresh data [skip ci]"`
- `intraday-refresh.yml`: `"Intraday refresh [skip ci]"`

### `.gitattributes`

Still contains `data/macro_radar.db merge=ours`. Harmless, left in place. Do not remove.

### Modes and validation (2026-09-06)

`refresh-data.yml` has four explicit modes — `full` (11:17 UTC daily, 00:23 UTC Tue–Sat), `news-only` (hourly at :41, lean `requirements-news.txt`), `market-only` (`requirements-market.txt`), `verify-only` — resolved by `scripts/workflow_mode.py` (an unknown cron becomes `verify-only`, never `full`). Every DB-writing run keeps `data/previous.db`, runs `scripts/validate_db.py` (integrity, tables, counts, max-date regression, mode-scoped SLA verdicts, step summary) and uploads only on `pass` + changed. Full runs publish `snapshot-latest.json` and a `validated-db` artifact; after a validated morning full run the refresh dispatches `daily-memo.yml` / `weekly-memo.yml` with its run id and they consume that artifact, refusing anything but `mode=full` (no stash/rebase anywhere). `make sync-data` pulls the Release asset locally with the same validation. Both DB writers then run a separate **"Publish the validation verdict"** step right after the DB publish step (same condition, `timeout-minutes: 1`, `continue-on-error: true`): `scripts/validation_asset.py` (stdlib) writes `publish/validation.json` `{verdict, mode, timestamp, db_sha256}` and it is uploaded with `--clobber`; a failure only leaves the verdict absent, and the DB publish step never mentions it (pinned by `tests/test_workflows.py`). `weekly-memo.yml` builds the memo with `python -m src.memo` from the repo root (fix/site-audit S-06: `python src/memo.py` put `src/` on the path, the memo's `src.utils.format` import failed, and no weekly memo was built from at least Sep 7); `tests/test_weekly_memo_entrypoint.py` runs the workflow's own command.

`validate_db` judges `alert_feed` as a recomputed table (`RECOMPUTED_TABLES`): the full run rebuilds it whole, so a cleared alert moving its max date earlier, or its rows falling, is a warning. Oct 20–21 2026 a cleared VIX_shock alert (dated 2026-10-02) failed every full refresh, because the failing run never published and the baseline kept the alert. A run with no alerts empties the table (`upsert_alert_feed` always replaces it; before, it returned early and the last run's alerts stayed on screen, Codex S-03). `fred_client._download` retries five times over about two minutes: FRED's outage page is an HTTP 200 with a non-XML body, which fredapi raises as `ParseError` (Refresh Data #2308).

### Rules for future workflow edits

1. **Never replace the retry loop with stash/rebase patterns.** They will reintroduce the binary conflict.
2. If adding a third workflow that writes to `data/macro_radar.db`, give it the same `concurrency: { group: data-write, cancel-in-progress: false }` block.
3. The `for i in 1 2 3 4 5` loop is load-bearing — do not reduce attempts below 3 or remove the backoff.
4. If a scheduled run fails, investigate as a new bug, not the old conflict pattern.
