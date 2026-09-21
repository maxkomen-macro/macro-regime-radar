# Macro Regime Radar — operations runbook (React/FastAPI build)

Written 2026-09-06 for the owner. Everything here was exercised locally on
branch `react-rebuild`; nothing has been committed, pushed, dispatched or
deployed by the build session. Commands assume the repo root.

## 1. What runs where

| Layer | What | Cadence | Where it lives |
|---|---|---|---|
| Data pipeline | FRED series, regimes, signals, market bars, analytics, news | `Refresh Data` workflow: full at 11:17 and 00:23 UTC (Tue–Sat), news-only hourly at :41; `Intraday Market Refresh` every 5 min at :02/:07/… during the US session | GitHub Actions → `data-latest` Release (`macro_radar.db`, `snapshot-latest.json`) |
| API | FastAPI `api/` (read-only SQLite, provider layer, EODHD relay, assistant) | always-on or sleeping host | one instance only (the relay holds one EODHD socket per feed) |
| Frontend | Vite bundle in `web/dist` + `public/snapshot/latest.json` | static | any static host, or served by the API same-origin |
| Memos | daily / weekly HTML + email | after a validated morning full refresh | `Daily Memo Email`, `Weekly Memo Email` (workflow_run) |

## 2. Daily checks (two minutes)

```bash
curl -s https://<api-host>/health/ready
curl -s https://<api-host>/api/freshness | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["overall"]); [print(r["feed"], r["verdict"], "-", r["reason"]) for r in d["sla"]]'
curl -s https://<api-host>/api/stream/debug | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["feeds"], d["degraded"], d["degraded_reasons"])'
curl -s https://<api-host>/api/providers/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:(v["available"],v["status"]) for k,v in d["entitlements"].items()})'
```

What the words mean (`api/freshness.py`, mirrored in the shell):

- **current** — inside the feed's own cycle (market close by 06:00 UTC next day; intraday within 20 min in session; news within 90 min on weekday business hours, 6 h otherwise; FRED daily within 2 business days; monthly prints by their release date; regime = latest complete common feature month).
- **delayed** — one cycle late, still usable; the reason says which.
- **stale** — older than that; the refresh workflow fails validation rather than publish it (unless a dispatch documents `allow_stale_reason`).
- The `regime.blockers` list names exactly which monthly input holds the regime month back and whether that is the publication calendar (nothing newer exists yet) or a print that is public but not stored (run a full refresh).

Observed on 2026-09-05 (Saturday, Labor Day weekend): regime month July 2026 is correct — August INDPRO (due ~Sep 16) and August CPI (due ~Sep 11) are not yet published; August UNRATE (published Sep 4) is stored. FRED daily yields in the snapshot ended 2026-09-01, three business days behind: a pipeline lag to watch on the next full refresh, not a code defect in this build.

## 3. Refreshing data

- **Scheduled:** nothing to do. The mode is resolved by `scripts/workflow_mode.py`; an unrecognised cron can only become `verify-only`.
- **Manual:** Actions → Refresh Data → Run workflow → choose `full`, `news-only`, `market-only` or `verify-only`. Fill `allow_stale_reason` only when publishing an outside-SLA snapshot on purpose (the reason is printed in the step summary).
- **Every run** downloads the current asset, keeps it as `data/previous.db`, refreshes, then runs `scripts/validate_db.py` (integrity_check, required tables, row counts and max dates, no max-date regression, no core-table row loss over a fifth, mode-scoped SLA verdicts, source labels). The step summary shows the mode, previous → new maxima per table, SLA verdicts, blockers, warnings and failures.
- **Upload happens only when** the verdict is `pass` **and** something changed for that mode. Otherwise the previous asset — the last-known-good — stays. A failed validation fails the run loudly.
- **Full runs additionally** build `snapshot-latest.json` (the public static snapshot), upload it beside the DB, and publish a `validated-db` run artifact (3-day retention) that the memo workflows consume.
- **Local copy:** `make sync-data` (needs `gh auth login` with read access). It validates the download against the current file and swaps atomically; a failed validation leaves the local file untouched.

## 4. Memos

`Refresh Data` dispatches the memo workflows itself — only after a **validated morning full** refresh, on weekdays (daily) and Mondays (weekly) — passing its run id. Each memo workflow downloads that run's `validated-db` artifact and refuses to produce a memo unless the artifact says `mode=full`. A manual dispatch without a run id uses the current Release asset. The memo commit uses the retry / `git reset --soft origin/main` loop; stash/rebase is gone. (Hourly news runs never wake the memo workflows.)

## 5. Rolling back data

The Release asset is overwritten only after validation, so the usual rollback is "do nothing — the bad snapshot never uploaded". If a bad snapshot did get through (a documented `allow_stale_reason`, or a defect):

```bash
# download the previous validated DB from the last good Refresh Data run's artifact
gh run list --workflow "Refresh Data" --limit 10
gh run download <run-id> --name validated-db --dir /tmp/validated
python scripts/validate_db.py /tmp/validated/macro_radar.db --mode verify-only --allow-stale "rollback"
gh release upload data-latest /tmp/validated/macro_radar.db --clobber
```

The API swaps it in at its next bootstrap check (`BOOTSTRAP_DB_REFRESH_MIN`) or restart: the upload gives the asset a new id, and a new asset identity is what makes the API download (fix/prelaunch-1). It builds the new generation in the background and switches every screen to it at once; no restart is needed for consistency.

## 6. API host

Environment (host secret store only; never in git, never in the image):

| Var | Purpose |
|---|---|
| `GH_DB_TOKEN` | read-only Contents PAT; `api/bootstrap.py` checks the `data-latest` asset at start and every `BOOTSTRAP_DB_REFRESH_MIN` minutes and downloads only when the asset's identity (id, updated_at, size, digest, recorded in `data/macro_radar.db.asset.json`) has changed, validating the download (header, quick_check, regime rows) before an atomic swap |
| `BOOTSTRAP_DB_REFRESH_MIN` | periodic identity check (set 30–60). Safe to arm since fix/prelaunch-1: an unchanged asset is no download, no swap and no rebuild; a changed one is rebuilt in the background and published whole |
| `BOOTSTRAP_DB_MAX_AGE_MIN` | legacy: still reported in `/api/freshness`, decides nothing (the asset identity does) |
| `PREFETCH_MARKET` | `1` (default) keeps the strip's and the default watchlist's 5D candles warm when `EODHD_API_TOKEN` is set; `0` turns it off |
| `GC_FREEZE` | `1` (default) freezes the server's heap after its first build, so a full garbage collection walks only newer objects (it walked ~180k, ~30 ms and more on a busy host, and held the GIL); `0` turns it off |
| `EODHD_API_TOKEN` | provider layer + live relay. **Owner action: add it on the host.** GitHub Actions does not need it (no workflow step calls EODHD) |
| `EODHD_PROBE_ON_START` | `1` (default) runs one bounded entitlement probe per API family at startup |
| `CORS_ORIGINS` | the frontend origin(s) for a split deploy; setting it also flips the assistant default to `off` |
| `ASSISTANT_ACCESS` | `off` (default when `CORS_ORIGINS` is set) · `key` (requires `X-Assistant-Key` = `ASSISTANT_ACCESS_KEY`) · `open` (dev only) |
| `ANTHROPIC_API_KEY` | assistant model; unused when the assistant is off |
| `RATE_LIMIT_PER_CLIENT_PER_MIN` / `RATE_LIMIT_PER_CLIENT_BURST` | defaults 600 / 120 (a screen load is ~25 requests); the assistant has its own 10/min per client |
| `RATE_LIMIT_GLOBAL_PER_MIN` / `RATE_LIMIT_GLOBAL_BURST` | defaults 4000 / 600 |
| `DB_MAX_CONCURRENCY` | stored-data reads in flight (default 24); beyond it the API answers 429 instead of queueing the worker pool |
| `WS_MAX_PER_CLIENT` / `WS_MAX_TOTAL` | relay sockets per client id / in total (defaults 20 / 200 — a NAT address counts as one client unless `TRUSTED_PROXY_HOPS` is set); refused sockets close before accept |
| `TRUSTED_PROXY_HOPS` | number of reverse proxies in front of the API that append `X-Forwarded-For` (typically `1`); the client is read that many entries from the right, never from the spoofable left. `0` (default) keys limits on the socket peer. `TRUST_X_FORWARDED_FOR=1` is an alias for one hop |
| `OPS_ACCESS_KEY` | when set, `/api/providers/status` and `/api/stream/debug` require the `X-Ops-Key` header |
| `CSP_CONNECT_SRC` | extra `connect-src` origins for the served shell (split API/WS host) |
| `PROVIDER_MAX_CONCURRENCY` | upstream provider calls in flight (default 8) |

Health: `/health/live` (event loop only — it keeps answering even if the worker pool is wedged, so point the host's liveness/health probe at **`/health/ready`**, which touches the database), `/health/ready` (DB opens, regime rows present, and the background worker's first pass complete: 503 `warming` until then, about 4 s after start on a laptop; its body carries the worker's generation and build time), `/api/freshness`, `/api/stream/debug`, `/api/providers/status` (both diagnostics gated by `OPS_ACCESS_KEY` when set).

Derived results (fix/prelaunch-1): a background worker (`api/worker.py`) builds every database-derived result (credit, recession model, Regime Lab, LBO defaults, allocation) into a generation, an in-memory copy of the database plus those results. When the database file changes (bootstrap swap, `make sync-data`, a file copied into place) it builds the next generation in the background and switches reads and results together when it is complete; until then the previous generation answers, and each request reads one generation from start to finish. Handlers never compute; a request arriving before the first pass waits up to 5 s, then gets 503 with `Retry-After`. If an item fails on the new file, the new generation is held back and the previous one keeps serving everything (`/health/ready` shows `worker.held` and `worker.last_error`); the worker retries after 30 s and 60 s, then publishes with that one item answering as an error. A file that cannot be read at all leaves the previous generation serving and is retried with a backoff. Allocation builds in a child process, from the price histories the full refresh stores in `asset_prices`; the API never calls Yahoo.

Database connections (2026-09-06): one read-only SQLite connection per worker thread, reused across requests, reading the published generation. The Docker image runs uvicorn with `--limit-concurrency 64`.

Logs: `api/logsafe.py` holds httpx at WARNING and redacts `api_token=`/Bearer values on every handler — read the startup block after each deploy (dist mounted, DB mtime, token presence yes/no, CORS, entitlement probe verdicts).

## 7. Incidents

| Symptom | Read | Do |
|---|---|---|
| `/api/stream/debug` feed `auth_failed` | EODHD rejected the token | rotate `EODHD_API_TOKEN` on the host; the relay retries every 5 min |
| `degraded_reasons` says a feed is silent during its session | upstream stall or network | wait one reconnect cycle (backoff ≤30 s); if persistent, restart the instance |
| Provider errors `kind=rate_limited` | EODHD or the app's own bucket (5 calls/s, burst 20) | nothing; they retry; sustained → check `/api/providers/status` counters |
| `kind=unauthorized` on candles/search | plan changed | probe with `curl /api/providers/status`. There is no Yahoo fallback on the API (fix/prelaunch-1): the visitor sees the typed error until the plan covers the family again |
| `/api/allocation` answers 503 `not_stored` | the database predates the stored price histories | dispatch Refresh Data → `full`; its "Store allocation price histories" step writes `asset_prices` |
| `/health/ready` stays `warming` | the worker's first pass has not completed | read `worker.state` and `worker.last_error` in the `/health/ready` body and the `mrr.worker` log lines |
| `/health/ready` shows `worker.held` | an item failed on the new database, so the previous generation keeps serving everything | read `worker.held.items` and the `mrr.worker` log; the worker retries twice, then publishes with that item answering as an error. Fix the cause and let the next refresh swap in a good file |
| Shell shows **Validated snapshot** | the API host is asleep or down | wait for wake-up (free hosts: ~1 min) or check the host; stored screens stay readable |
| Regime month did not advance after a print | run a `full` refresh; check `regime.blockers` | if a print is "published, not yet stored", the FRED fetch missed it — inspect the run log |
| Validation failed in Actions | step summary lists the failure | fix the cause and rerun; never `allow_stale_reason` a regression |
| A burst of 429s under normal use | `DB_MAX_CONCURRENCY` or the per-client burst is too low for the host's proxy layout | check `TRUSTED_PROXY_HOPS` first (all visitors sharing the proxy's IP look like one client), then raise the burst |

## 8. After the merge (fix/prelaunch-1)

The API computes allocation only from the `asset_prices` table, which the `full` refresh writes ("Store allocation price histories"). A database published before the merge does not have it, and on such a database `/api/allocation` answers 503 `not_stored` in plain words and never downloads. So:

1. Before merging, once the branch is pushed, dispatch Refresh Data → `full` on it (Actions → Run workflow → branch `fix/prelaunch-1`). The table is additive, so the code on `main` ignores it, and the published database already carries the histories when `main` deploys; the Streamlit app deploys `main` automatically and its allocation tab reads the same table. Or merge first and dispatch `full` at once; until it publishes, allocation says the histories are not stored yet.
2. Confirm the published database carries the table: the run's validation summary lists `asset_prices` with rows and a max date equal to the last completed session, and the `asset_prices` watermark names its providers.
3. Only then point the deployed API at the new database (deploy it, or let `BOOTSTRAP_DB_REFRESH_MIN` pick the new asset up).

No restart is needed after a refresh: the new database is rebuilt in the background and published to every screen at once.

