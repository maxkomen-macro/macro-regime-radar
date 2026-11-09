# Macro Regime Radar — Codex Reference

Single source of truth for Codex sessions on this repo. Keep tight; verify against code before adding new claims. If you can't confirm a fact in five minutes of reading, don't add it.

---

## Project at a Glance

- **Live:** https://macro-economic-radar.vercel.app/ (the React site; it replaced the Streamlit app at macro-regime-radar.streamlit.app)
- **Repo:** github.com/maxkomen-macro/macro-regime-radar
- **Stack:** Python 3.12, Streamlit, SQLite (`data/macro_radar.db`), FRED + yfinance + Finnhub + NewsAPI + RSS (feedparser), Anthropic API, Perplexity Sonar API, scikit-learn, plotly/altair, openbb, arch, riskfolio-lib, quantstats, prophet. Hosted on Streamlit Community Cloud, automated via GitHub Actions.
- **Tabs:** 11 total. Names live in `dashboard/app.py` (around line 893).

---

## Phase Status

Phases 0–12 are complete. For per-phase scope, read `git log` and recent commit messages.

---

## Bloomberg Design System

Dark theme only. No alternative palettes.

| Token | Value |
|---|---|
| Background | `#0d1117` |
| Card background | `#161b22` |
| Borders | `#30363d` |
| Accent blue | `#4a9eff` |

- Use `streamlit.components.v1.html()` for all styled cards (see Streamlit Constraints for why).
- Sparklines on numeric metric cards where time series supports it.
- Monospace for numeric values; small uppercase labels above large values.

---

## Streamlit Constraints (Hard-Won)

1. **HTML sanitizer strips CSS from `st.markdown` even with `unsafe_allow_html=True`.** For any styled card, use `streamlit.components.v1.html(html_string, height=...)`. Reserve `st.markdown` for plain markdown only.
2. **Caching:** `@st.cache_resource` for scikit-learn estimators, fitted pipelines, and other model objects. `@st.cache_data` for DataFrames, arrays, dicts. Mixing these causes pickling errors or silently stale models.
3. **DataFrames:** pass `width="stretch"` (the new syntax replacing deprecated `use_container_width=True`).
4. **Pandas:** use `df.loc[mask, col] = value`. Never use chained indexing `df[col][mask] = value` — raises `ChainedAssignmentError` in modern pandas.
5. **Fragments:** scope `st.fragment(run_every=N)` narrowly. Wrapping a whole tab in a fragment causes session state issues. Example: the Events & Intelligence two-column feed (`_render_feed` in `events_tab.py`) is a fragment, and headline clicks call `st.rerun(scope="fragment")` so selecting an article re-renders only the feed — not the summary-bar / calendar `components.html` iframes. That full-tab rerun was the source of click latency.

---

## Data Source Rules

- **FRED yields:** daily series only — `DGS2`, `DGS10`. Not monthly averages `GS2`, `GS10`.
- **IG OAS:** `BAMLC0A0CM`. Not `BAMLC0A0CAAA`. Other BAML series in active use: `BAMLH0A0HYM2` (US HY), `BAMLH0A1HYBB` (BB), `BAMLH0A2HYB` (B), `BAMLH0A3HYC` (CCC).
- **Inflation expectations:** `T10YIE` and `T5YIE` are the live signals. Breakeven proxy `T10YIE − T5YIE` is the operative input for current readings.
- **`USSLIND` is a frozen historical series.** FRED stopped publishing it in February 2020 — the local DB has 288 rows ending `2020-02-01` and that is the entire dataset that will ever exist. The series is still present in `RECESSION_SERIES` (`src/config.py`) because it is used as historical training data for the recession model. **Never remove `USSLIND` from config without first confirming the recession model has been retrained without it.** For live recession signal computation, the breakeven proxy above is what's actually being read.
- **IRR:** `numpy.irr` was removed in recent numpy versions. Use binary search on NPV. Do not reintroduce `numpy.irr`. Implementation lives in `src/analytics/lbo.py` (look for `_compute_irr`).
- **Market data (pipeline):** `yfinance` (keyless) for both stored daily and intraday bars. (The on-demand API layer and the live tape are EODHD-first since 2026-09-06 — see the FastAPI section.) The active client is `src/market_data/yfinance_client.py` (`fetch_daily` + `fetch_intraday_5m`); `src/market_data/fetch_market.py` uses it for every mode (`backfill`, `incremental`, `intraday-only`) and **no longer requires `POLYGON_API_KEY`**. `src/market_data/polygon.py` and `config/providers.yml` remain on disk as dormant legacy — imported by nothing in the live pipeline. If you find yourself touching `polygon.py`, you're on the wrong path — verify with the user before continuing. `market_daily` still holds the earlier pipeline's Polygon.io bars: each ETF's bars from its Polygon start (2024-02-27, or 2026-02-18 for 14 of the 23) to 2026-05-26 are `source='polygon'`, one per NYSE session (6,018 rows on 2026-11-04), except SPY's 2026-03-12 bar; every other row is yfinance. Label stored daily prices by symbol and date (`web/src/screens/shared/stored-provenance.ts`, `api/desk.py` `POLYGON_DAILY_*`, checked against the DB by `tests/test_stored_provenance.py`), never as all-yfinance. `_upsert_daily` keeps `source` on conflict, so `fetch_market.py --mode backfill` (manual) would leave `polygon` on Yahoo's values; the test fails if any Polygon row's `fetched_at` is later than the last Polygon write (2026-05-27T04:19:10).
- **Migrated daily fetch off Polygon → yfinance (May 26 2026).** Symptom was Polygon free-tier 429s: the 12s-per-request throttle plus 60/120/240s backoffs made `--mode incremental` stall for 13+ min across the 23 daily symbols. The daily path now uses the same keyless yfinance source the intraday path already used. Daily rows are written with `source='yfinance'`.
- **News pipeline:** Finnhub (general + M&A), NewsAPI (macro + M&A), and keyless **RSS feeds** (`fetch_rss_news` + `RSS_FEEDS`: Federal Reserve, NYT Business, CNBC, FT Markets, MarketWatch — via `feedparser`) are ingested via `src/analytics/news.py`. All three flow through the same dedupe → classify → five-dimension significance scoring → store path. Top-significance items get an Anthropic interpretation pass and a per-item Perplexity Sonar (cited research) enrichment. Both outputs persist into `news_feed` (`regime_interpretation` and `perplexity_research` columns). RSS source labels are tier-colored in the dashboard via `events_tab.SOURCE_TIERS`.

---

## Analytics Patterns

- **Regime engine:** 4-way softmax classifier — Goldilocks, Overheating, Stagflation, Recession Risk. Temperature = 0.7 (`src/regime.py:75`). Daily output stored in `regimes` table including 4 probability columns (`prob_goldilocks`, `prob_overheating`, `prob_stagflation`, `prob_recession`).
- **Signal card fill bars:** threshold-ratio formula.
  - "above" condition: `fill_pct = value / threshold * 100`
  - "below" condition: `fill_pct = threshold / value * 100`
  - Do not use historical-range-based `fill_pct` — it produced incorrect "all triggered" results.
- **Macro surprise scoring:** rolling z-scores over the configured window. Inspect `src/analytics/surprise.py` for current window length and the mix of 1-period diffs vs YoY changes — implementation evolves; do not memorize specific window values here.
- **Recession model:** logistic regression in `src/analytics/recession.py`, trained on NBER dates. USSLIND historically; breakeven proxy for live signal. Inspect that file for current feature set and lag.
- **Perplexity Sonar enrichment:** `src/analytics/perplexity.py` calls the Sonar API; result strings are stored in `news_feed.perplexity_research` and rendered in both the Events & Intelligence tab and the daily memo.

---

## Database

`data/macro_radar.db` is the SQLite store (11 tables; 10 excluding `sqlite_sequence`).

**It is NOT in git.** Committing this ~10 MB binary on every hourly refresh bloated the repo
to ~283 MB and broke Streamlit Cloud's deploy clone (the clone timed out → "Failed to
download the sources"). As of Jun 2026 the DB is **gitignored** and shipped as a rolling
**GitHub Release asset** on the **`data-latest`** tag instead:

- **Writers** (`refresh-data.yml`, `intraday-refresh.yml`) `gh release download` the DB from
  `data-latest` at job start, run their incremental update, then `gh release upload … --clobber`
  it back. They are in the `data-write` concurrency group so uploads don't race.
- **Readers** (`daily-memo.yml`, `weekly-memo.yml`) download it read-only to build the memos.
- **Dashboard** (`dashboard/app.py`) downloads the latest asset into `DB_PATH` at startup via
  the GitHub API, authenticated with **`GH_DB_TOKEN`** (a read-only PAT in Streamlit Cloud
  secrets — the repo is private, so the asset is not publicly reachable), cached
  `@st.cache_resource(ttl=900)`. No token locally → dev uses the on-disk DB untouched.
- Do **not** re-add the DB to git tracking. Inspect locally: `sqlite3 data/macro_radar.db ".tables"`.

Tables added since v1: `news_feed` (Phase 11) and `factor_data` (Fama-French factors via openbb).

---

## FastAPI Service (`api/` — Atlas + React front end)

A **FastAPI** service (`version="1.3.0"`) in the top-level `api/` package — intentionally self-contained: it does **not** import `src.config` (so it runs without `FRED_API_KEY`), and every heavy dep (`anthropic`, pandas/scikit-learn, riskfolio) is imported lazily at the point of use, never at module import. Endpoint groups:

- **Unprefixed** (6 routes: `/health`, `/regime/latest`, `/signals/latest`, `/series`, `/series/latest`, `/series/{series_id}/latest`) — the original latest-snapshot contract for Atlas. Do not rename fields without coordinating with Atlas's MacroBridge agent.
- **`/api/*`** (31 routes on the `api` router) — one endpoint per table or computation the Streamlit dashboard reads: table endpoints mirror the dashboard loaders' SQL (`api/db.py`), computed ones call the same `src/analytics/*` modules the tabs do. Regime (`/latest`, `/history`, `/intelligence`, `/playbooks`, `/duration`, `/transitions`, `/analogues`, `/scenarios`, POST `/scenario`), `/signals/latest` (server-computed threshold, direction, distance-to-trigger, status — the frozen Atlas route keeps the old shape), `/priced`, `/surprises`, `/alerts`, `/news` (optional `ticker` filter) + `/news/latest`, `/market/daily`, `/market/intraday`, `/calendar` (upcoming window) + `/calendar/recent`, `/backtests` (pivoted long→wide server-side), `/credit/oas` (pct **and** bps + sparklines) + `/credit/metrics`, `/recession/probability` + POST `/recession/scenario`, `/lbo/defaults` + POST `/lbo/run`, `/allocation`, `/freshness`. **On-demand symbol layer** (`api/providers/`, rebuilt 2026-09-06; `api/lookup.py` is the compatibility seam): `/market/search?q=`, `/market/profile/{symbol}`, `/market/candles/{symbol}?range=` (provenance envelope, never a bare list), `/market/actions/{symbol}`, `/market/options/{symbol}/expirations` + `/market/options/{symbol}?expiration=`, `/market/ticks/{symbol}`, `/providers/status` — **EODHD first, yfinance as a disclosed fallback**, one provider per series, typed errors (`{detail, kind, provider, retryable}` mapped from `api/providers/errors.py`), keyed single-flight TTL caches, symbol normalization in `api/providers/symbols.py` (never send Yahoo syntax to EODHD or vice versa). Entitlements are probed once per family at startup (`api/providers/entitlements.py`); on 2026-09-06 fundamentals and ticks are not in the plan (403 → explicit unavailable), options are. Tests: `tests/test_providers.py` (mock transport), `tests/test_symbols.py`, `tests/test_api_lookup.py`.
- **Live + assistant:** WebSocket `/api/stream/ws` and `GET /api/stream/debug` (EODHD relay, `api/stream.py` — one upstream connection per feed, the token never crosses to the client; 2026-09-06: stale-tick flags, degraded verdict, bounded dynamic `watch`/`unwatch` subscriptions ≤20 symbols with 10-min idle expiry), and **POST `/api/assistant/ask`** (`api/chat.py`) which streams the Phase-12 agent as SSE (`data: {"delta"}` frames, terminal `event: done`) — gated by `ASSISTANT_ACCESS` (off by default when `CORS_ORIGINS` is set).
- **Health + freshness (2026-09-06):** `/health/live`, `/health/ready` (503 until the DB opens with regime rows), `/api/freshness` (six stored maxima plus `overall`, NYSE `session`, per-feed `sla` verdicts from `api/freshness.py` + `api/calendar.py`, `regime.blockers`, `bootstrap`, `relay`). `scripts/validate_db.py` reuses the same verdicts in the workflows.
- **Security (2026-09-06, `api/security.py`):** pure-ASGI middleware — body caps (64 KB; 16 KB assistant), per-client (600/min, burst 120) and global token buckets keyed on the socket peer or `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For`, concurrency ceilings for the calculators, provider calls and stored-data reads (`DB_MAX_CONCURRENCY`), relay-socket caps (`WS_MAX_PER_CLIENT` / `WS_MAX_TOTAL`), security headers, CSP on the served `index.html`, `OPS_ACCESS_KEY` for the diagnostics views; `api/logsafe.py` keeps `api_token` values out of every log line (httpx logged full URLs before). `api/db.py` reuses one read-only connection per worker thread (per-request open/close churn deadlocked the pool under a burst — review 2026-09-06).

Details:

- **Deps:** `requirements-api.txt` — `fastapi`, `uvicorn[standard]`, `httpx`, `websockets`, `pandas`/`numpy`/`scikit-learn` (recession), `yfinance` + `riskfolio-lib==7.3.*` (allocation), `anthropic` (assistant). Kept **separate from `requirements.txt`** so the Streamlit Cloud build doesn't pull them. The riskfolio pin is load-bearing: `herc_optimize` in `src/analytics/allocation.py` carries a shim for 7.3.0's broken HERC kwarg forwarding — remove the pin only together with the shim.
- **Run:** `uvicorn api.main:app --host 127.0.0.1 --port 8000` (local `.venv/` in the repo has the deps). **Port 8000 everywhere** — the Vite dev server on :5173 proxies to it.
- **CORS:** the Vite dev origins (`localhost:5173` / `127.0.0.1:5173`) by default; the `CORS_ORIGINS` env var (comma-separated) **replaces** them for a split deploy. Methods are **GET + POST** — every POST (scenario, recession sensitivity, LBO, assistant) is pure computation over stored data; nothing writes. The built bundle served same-origin needs no CORS. Effective origins are logged in the lifespan startup block.
- **Static bundle:** when `web/dist` exists, `api/main.py` mounts `/assets` + `/fonts` and adds an SPA catch-all, so one process serves the API and the built React app. Paths whose first segment is `api|health|regime|signals|series` stay JSON 404s. No `dist` → nothing is mounted and the Vite dev flow is unchanged.
- **DB bootstrap:** `api/bootstrap.py` downloads the `macro_radar.db` asset from the `data-latest` Release at lifespan start using `GH_DB_TOKEN` (temp file beside `DB_PATH` + `os.replace` atomic swap, so a reader never sees a torn file). No token → no-op; dev keeps the on-disk DB untouched. `BOOTSTRAP_DB_MAX_AGE_MIN` re-downloads a stale startup DB (unset = only-if-missing); `BOOTSTRAP_DB_REFRESH_MIN > 0` arms a periodic refresh task.
- **DB access:** `api/db.py` opens a fresh read-only connection per request via `file:...?mode=ro` and closes it immediately — tolerates the DB swap and concurrent WAL writes. Verified byte-identical DB mtime after a full test run.
- **Recession exception:** `/api/recession/probability` imports `src/analytics/recession.py`, which trains the logistic model in-process on every call (no artifact on disk) and opens its own read-write conn with WAL pragma — same behavior the Streamlit tab always had. `api/recession_cache.py` wraps it in a 15-min TTL cache (~1s cold, ~10ms warm) and converts the pandas Series to `[{date, value}]` lists. Its probability is the **recession model's**, not `regimes.prob_recession` — the response carries `probability_source: "recession_model"` to disambiguate.
- **Analytics caches:** `api/analytics_cache.py` applies the same TTL-cache-plus-JSON-conversion pattern to the intelligence, credit, and allocation payloads. `/api/allocation` is the one endpoint without a strict response model (asset×regime matrices keyed by data) and its cold call downloads return histories via yfinance (~30–60 s) before serving from a 1-hour cache.
- **Assistant:** shares `src/analytics/chat.py` — `is_safe_select` and the tool table are **imported, never copied**; `tests/test_api.py::test_assistant_guard_identity_no_local_copy` asserts `api/chat.py` carries no guard symbols of its own. That module no longer imports `src.config`: it has its own `DB_PATH` and `get_secret` (env → `st.secrets` → repo-root `.env`), plus a `TAB_CONTEXT` ContextVar so `explain_current_view` works without Streamlit session state. `POST /api/assistant/ask` is gated by `api/security.py` (2026-09-06): `ASSISTANT_ACCESS=off|key|open`, 10 req/min per client, 16 KB bodies, no persistence — `docs/redesign/DEPLOY.md` documents the modes.
- **Gotcha:** `/api/credit/oas` anchors its `days` window to `date('now')`; if FRED credit data is stale beyond the window, the endpoint 404s. Default `days=90` gives ample slack.
- **Tests:** `tests/test_api.py` (FastAPI `TestClient` against the real read-only DB; skips if the DB file is absent) covers every route group plus the SSE frame contract (stub agent, no tokens spent) and the SPA-fallback/JSON-404 split. Alerts tests are shape-only — `alert_feed` has ~1 row.

---

## GitHub Actions: data-write concurrency and the Git writer

### What's in place

Both `refresh-data.yml` and `intraday-refresh.yml` share a single concurrency group:

```yaml
concurrency:
  group: data-write
  cancel-in-progress: false
```

The two workflows queue against each other instead of racing, which matters because both publish
the DB to the same `data-latest` release asset (serialized so `--clobber` uploads don't race).

The DB is not committed to git: it is downloaded from and uploaded to the `data-latest` Release
(see **Database**). Three workflows write to git, each one generated file:
`refresh-data.yml` (`output/playbook.json`, full mode after a passing validation), `daily-memo.yml`
(`docs/memo/daily_memo.html`) and `weekly-memo.yml` (`docs/memo/weekly_memo.html`).
`intraday-refresh.yml` and `keep-api-warm.yml` never push. The memo workflows are not in the
`data-write` group (they only read the DB).

### The Git writer: `scripts/publish_artifacts.sh` (2026-11-04)

Each writer's commit step sets the bot identity and runs one line:

```yaml
bash scripts/publish_artifacts.sh "Update playbook [skip ci]" output/playbook.json
```

Each attempt (5, with a 5–14 s random backoff) fetches `main`, checks out that exact commit in a
fresh temporary worktree, copies in only the named file (it must be on the script's `ALLOWED`
list), commits there, checks the commit has exactly the fetched `main` as parent and changes only
the named file, and pushes without force. If `main` moved since the fetch the push is rejected and
the next attempt rebuilds on the newer `main`. A file that already matches `main` makes no commit.
The runner's own checkout and index are never committed. Each staged file must be a regular file
holding exactly the generated bytes (a symlink or directory on `main` at that path is refused, never
followed). Each fetch and push is cut off after 60 s, and the step has `timeout-minutes: 15`. Only a
run on `main` publishes: each commit step's `if:` requires `github.ref == 'refs/heads/main'`, and the
script refuses any other `GITHUB_REF`.

**Why it replaced the soft-reset loop.** The old step committed in the runner's checkout, then
looped `git fetch origin main && git reset --soft origin/main && git commit && git push`. A soft
reset moves the branch but keeps the runner's whole index from its checkout, so the commit's tree
was the old checkout plus the artifact: every change merged to `main` while the run was in flight
was silently reverted, with no conflict and no failed check. It happened twice: 2026-10-02
`4bb6c39` undid `desk/cap-weight` (restored by `9a97c23`) and 2026-11-04 `d9359019` undid #35 and
#30. Concurrency groups do not prevent it: a code merge is not a workflow run. Max approved
replacing the pattern on 2026-11-04.

`tests/test_publish_artifacts.py` rebuilds the race in real repositories (a bare origin, a runner
checkout taken before a merge, the merge, then each workflow's own publish command read from its
YAML) and shows the old step reverting the merge on the same scenario.

### Rules for future workflow edits

1. A workflow that writes to git calls `scripts/publish_artifacts.sh` with explicit paths. Never
   `git commit` or `git push` in a workflow step, never commit the runner's checkout (no
   `reset --soft`, no stash/rebase), and never force-push. A new generated file is a reviewed
   addition to `ALLOWED`.
2. If adding a third workflow that uploads the DB Release asset, give it the same `concurrency: { group: data-write, cancel-in-progress: false }` block.
3. Keep at least 3 attempts and the backoff in the publisher.
4. After merging a PR, check that `main` still contains it: `git diff <merge> origin/main --stat`
   should list only bot artifact paths. A run that started before a workflow change still uses
   the workflow it started with.
5. If a scheduled run fails, investigate it as a new bug.

### `.gitattributes`

Still contains `data/macro_radar.db merge=ours`. Harmless, left in place. Do not remove.

### Modes and validation (2026-09-06)

`refresh-data.yml` has four explicit modes — `full` (11:17 UTC daily, 00:23 UTC Tue–Sat), `news-only` (hourly at :41, lean `requirements-news.txt`), `market-only` (`requirements-market.txt`), `verify-only` — resolved by `scripts/workflow_mode.py` (an unknown cron becomes `verify-only`, never `full`). Every DB-writing run keeps `data/previous.db`, runs `scripts/validate_db.py` (integrity, tables, counts, max-date regression, mode-scoped SLA verdicts, step summary) and uploads only on `pass` + changed. Full runs publish `snapshot-latest.json` and a `validated-db` artifact; every validated full main run records its coverage (`validated-meta-<attempt>`, 45 days), registers new memo sources in `docs/memo/sources.json` and wakes `daily-memo.yml` / `weekly-memo.yml`, which drain a durable queue (`docs/memo/ledger-*.json`, written only by compare-and-swap through `scripts/publish_artifacts.sh --expect`) and build each key from its source attempt's `validated-db` artifact, checked by hash (CS-2, `scripts/memo_queue.py`; no stash/rebase anywhere). `make sync-data` pulls the Release asset locally with the same validation.

---

## Git Session Routine

### Before every session

```bash
cd <repo root>
git checkout HEAD -- data/macro_radar.db && git pull --no-rebase
```

### Commit and push

```bash
git add -A
git commit -m "<message>"
git pull --no-rebase
git push
```

### Local binary DB conflict (rare since the workflow fix)

```bash
git checkout HEAD -- data/macro_radar.db
git add <other-files>
git commit -m "<message>"
git pull --no-rebase
git push
```

---

## API Keys & Secrets

All secrets via `st.secrets[]` in production (Streamlit Cloud secrets manager). Locally, `.streamlit/secrets.toml` (gitignored). GitHub Actions secrets in repo settings.

**Never hardcode keys. Never commit `.streamlit/secrets.toml`.** The committed `.streamlit/secrets.toml.example` contains all key names; copy it to `.streamlit/secrets.toml` and fill values.

| Key | Status |
|---|---|
| `FRED_API_KEY` | Required — raises in `src/config.py:17` if missing |
| `FINNHUB_API_KEY` | Optional — required for news ingest |
| `NEWS_API_KEY` | Optional — required for news ingest. **Note the underscore.** Code uses `NEWS_API_KEY`, not `NEWSAPI_KEY` |
| `ANTHROPIC_API_KEY` | Optional — required for AI regime interpretation |
| `PERPLEXITY_API_KEY` | Optional — required for Sonar research enrichment |
| `POLYGON_API_KEY` | Legacy — yfinance is the active path; no longer read by the pipeline. Safe to leave in secrets or remove |
| `GH_DB_TOKEN` | Fine-grained PAT with **Contents: Read** on this repo. Lets `dashboard/app.py` (Streamlit Cloud secret) and `api/bootstrap.py` (env var) download `data/macro_radar.db` from the private `data-latest` Release. Not needed locally; workflows use the built-in `GITHUB_TOKEN` |
| `EODHD_API_TOKEN` | API only — read by `api/stream.py` and `api/providers/market.py` (env, else repo-root `.env`) for the live-quote relay and the on-demand provider layer. Absent → feeds stay off, the provider layer falls back to yfinance (disclosed), the client falls back to its DB poll. Never sent to the browser; redacted from logs by `api/logsafe.py`. **Not a GitHub Actions secret and not needed there** — an owner action on the API host |

Without the four optional Phase-11 keys, the news, AI interpretation, and research-citation pipelines silently produce no output (this is intentional — the dashboard still works for non-news functionality).

---

## What NOT to Do

- Do not hardcode API keys or secrets anywhere in source.
- Do not commit `data/macro_radar.db`.
- Do not commit `.streamlit/secrets.toml`.
- Do not use `st.markdown()` for styled HTML cards — use `streamlit.components.v1.html()`.
- Do not change the Bloomberg dark aesthetic.
- Do not use chained pandas indexing (`df[col][mask] = value`) — use `df.loc[mask, col] = value`.
- Do not use `@st.cache_data` on scikit-learn model objects — use `@st.cache_resource`.
- Do not reintroduce `numpy.irr` — use binary search on NPV.
- Do not use `BAMLC0A0CAAA` for IG OAS — use `BAMLC0A0CM`.
- Do not use `GS2` / `GS10` for daily yield analysis — use `DGS2` / `DGS10`.
- Do not remove `USSLIND` from `RECESSION_SERIES` config without retraining the recession model — the 288 historical rows are training data, not a live signal.
- Do not assume the env var is `NEWSAPI_KEY` — code uses `NEWS_API_KEY` (underscore).
- Do not extend or reintroduce the `polygon.py` code path — yfinance (`yfinance_client.py`) is the live market data source for daily and intraday.
- Do not replace the workflow retry loop with stash/rebase patterns.
- Do not remove `data/macro_radar.db merge=ours` from `.gitattributes`.
- Do not introduce historical-range-based `fill_pct` for signal cards.
- Do not silently swallow errors — surface them in the UI or log to session state.
- Do not let the chat agent run non-`SELECT` SQL — `is_safe_select` in `src/analytics/chat.py` enforces this and is covered by `tests/test_chat_sql_guard.py`.
- Do not copy `is_safe_select` (or any tool implementation) into another module — **import** it from `src/analytics/chat.py`. A forked copy is exactly how the hardening drifts back out; `tests/test_api.py` fails if `api/chat.py` grows its own.
- Do not persist chat history to the DB — Phase 12 is intentionally session-only so visitors never see prior visitors' conversations.

---

## Phase 12 — Conversational AI Assistant

**Status:** Complete (May 3 2026).

**Where it lives:** Floating bottom-right FAB rendered on every tab. Click opens an `@st.dialog` modal containing the chat. Wired in once at the end of `dashboard/app.py`, after the last `with tab_meth:` block.

**Files added:**
- `src/analytics/chat.py` — `MacroRadarAgent`, `SYSTEM_PROMPT_TEMPLATE`, 8 tool definitions (`active_tools()` offers 7 unless `ASSISTANT_FREEFORM_SQL` is on), tool-use loop (10-iteration cap), `is_safe_select` SQL guard, `RateLimited` / `NetworkError` / `AgentError` exception hierarchy.
- `dashboard/components/chat_widget.py` — `render_chat_launcher()` (FAB) and `_chat_dialog()` (modal). Streams via `st.write_stream` over `MacroRadarAgent.ask_streaming`.
- `dashboard/utils/tab_context.py` — `register_tab_context(tab_name, metrics, kind="live")` writes to `st.session_state.current_tab_context`.
- `tests/test_chat_sql_guard.py` — unit tests covering allowed SELECT/CTE forms and rejecting DDL/DML/PRAGMA/ATTACH/chained statements.

**Files modified:** `dashboard/app.py` (launcher wire-up + Dashboard tab context call); all 11 tab render functions in `dashboard/components/` plus the inline Dashboard block (`register_tab_context` call at entry).

**Tools (8; 7 offered by default):**
- `query_database(sql)` — **off by default** (desk/hardening): offered only when `ASSISTANT_FREEFORM_SQL` is `1`/`true`/`yes`/`on`; otherwise `active_tools()` omits it and `_run_tool` refuses it. Read-only SELECT only; capped at 200 rows.
- `get_current_regime()` — latest `regimes` row (label, confidence, growth/inflation trends, 4 probabilities).
- `get_signal_status(signal_name?)` — latest signal rows from `signals`.
- `get_recession_probability()` — latest + 1m / 3m / 6m prior `prob_recession`.
- `get_credit_snapshot()` — latest IG/HY/CCC/BB/B OAS plus 10Y UST (returned in both pct and bps).
- `get_market_snapshot(ticker)` — latest close + 1d/5d/1m/YTD return from `market_daily`.
- `get_recent_headlines(limit, min_significance)` — top items from `news_feed` with `regime_interpretation` and `perplexity_research`.
- `explain_current_view()` — reads the `TAB_CONTEXT` ContextVar (set per request by `api/chat.py`), falling back to `st.session_state.current_tab_context`.

**Model:** `Codex-sonnet-4-5-20250929` via the official `anthropic` SDK (already in `requirements.txt`).

**API key:** `ANTHROPIC_API_KEY` loaded via `src/analytics/chat.py`'s own `get_secret` (env → `st.secrets` → repo-root `.env`) — *not* `src.config`, which would drag in the `FRED_API_KEY` requirement and break the key-less FastAPI path. Missing key → FAB silently replaced with a muted "AI Assistant unavailable — API key not configured" caption; no traceback.

**SQL guard:** `is_safe_select` rejects anything that isn't a single `SELECT` (or `WITH … SELECT`) statement. Bans interior `;`, all DDL/DML, PRAGMA (including table-valued `pragma_*`), ATTACH/DETACH, VACUUM, REINDEX, TRUNCATE, `randomblob`/`zeroblob`, `load_extension`. When `query_database` is on, `sql_guard_refusal` also caps a statement at 2 KB of SQL, 16 function calls and no two-argument `trim`/`ltrim`/`rtrim`, and each call reads its own in-memory copy (`dbpath.copy_private_ro`) under a 250 ms wall-clock budget (`_interrupt_after` re-fires `conn.interrupt()`), with one value capped at 16 KB and a LIKE/GLOB pattern at 256 bytes. There is no progress-handler (VM-instruction) budget any more (desk/hardening, `docs/desk/HARDENING_REPORT.md` decisions 36, 42, 44).

**Cost guards:** history sent to the API is capped at the last `HISTORY_TURN_LIMIT = 20` turns. Token usage accumulates in `st.session_state.chat_token_log` (input/output) and renders in the dialog footer.

**Persistence model:** Session-only via `st.session_state.chat_messages`. NO new DB table. Reason: public Streamlit app shared across visitors; persistent history would leak prior visitors' conversations to recruiters. Refresh clears history.

**Suggested prompts (recruiter-facing — do not change without thinking):**
1. "What's driving the current regime?"
2. "Explain what I'm looking at on this tab"
3. "Should I be worried about recession risk right now?"
4. "Top headlines today and why they matter"

**Tab context pattern:** every tab calls `register_tab_context("<TabName>", {...})` at the top of its render function. The metrics dict is intentionally a small static description (`shows`, `key_tools`) plus 0–6 live numeric metrics where they are cheap to extract — the agent's other tools fetch live data when needed. `Methodology` registers with `kind="reference"` since its content is static.

**Known gotchas discovered during build:**
- `anthropic` was pinned in `requirements.txt` but not actually installed locally — installed it during dev. The Streamlit Cloud build will pick it up from `requirements.txt` automatically.
- BAML OAS values in `raw_series` are stored as percent (e.g., `0.81`), not basis points — `get_credit_snapshot` returns both `value_pct` and `value_bps` to avoid ambiguity in tool output.
- The FAB uses CSS `:has()` selectors targeting a marker `<div id="macro-chat-fab-mark">` to position the next `stElementContainer` (the button) as fixed bottom-right. Modern browsers only.
- `st.dialog` (Streamlit ≥1.31) needs to be called during a script run to open. The button click triggers a rerun and re-invokes the decorated function, which is sufficient.
- Streaming uses `client.messages.stream(...).text_stream` events — tool_use blocks resolve silently between iterations.

**Deferred to Phase 12.5:**
- Web search tool (latest news beyond `news_feed`).
- Inline chart generation in chat responses.
- Persistent history with auth.
- Voice I/O.

---

## Maintaining This File

Every Codex session that ships code to `main` is responsible for updating this file before its final commit:

1. If you completed a phase, update "Phase Status".
2. If you discovered a new gotcha (Streamlit behavior, library quirk, data source issue), add a one-line entry under the relevant section.
3. If you changed workflow files, update the GitHub Actions section.
4. If you added a new dependency or external service, note it in "Project at a Glance" and "API Keys & Secrets" if applicable.
5. If you removed or renamed a tab, update the tab count.
6. Do not add Phase Nx architecture sections until that phase has shipped — speculative documentation drifts faster than no documentation.

When in doubt: delete more than you add. Stale documentation is worse than missing documentation.

---

## React Migration (in progress — nothing ships without explicit user approval)

- **Design source of truth:** the owner's local design bundle (*Macro Regime Radar Design System*, kept outside this repo) — read `HANDOFF_REACT_MIGRATION.md` there first. `styles.css` + `tokens/` and `components/**/*.jsx` are shippable near as-is; `ui_kits/` are fixture-data references only.
- **Design tooling:** the `impeccable` Codex plugin (v4.0.4, user scope, from `pbakaus/impeccable`) is installed — use `/impeccable` (audit, critique, polish, …) alongside the handoff bundle for all UI work.
- **Step 1 (API) is built** — see the FastAPI section above.
- **Steps 2–4 are built on branch `react-rebuild`** (as of 2026-08-26). `web/` is a Vite + React 18 + TypeScript app: all 7 tabs (Dashboard, Regime Lab, Markets, Credit, Recession, News & Calendar, Tools) plus Methodology and the assistant panel (`web/src/screens/shell/AssistantPanel.tsx` over `POST /api/assistant/ask`), a responsive foundation (`web/src/lib/useBreakpoint.ts` — mobile <480 / tablet <768 / desktop <1024 / wide; the sole width-conditional mechanism) and h1→h2→h3 heading semantics. Product and design contracts for it live in `web/PRODUCT.md` and `web/DESIGN.md`. A `Dockerfile` plus `docs/redesign/DEPLOY.md` describe two working deploys (split Vercel + backend host, or a single same-origin host). **Nothing is deployed and the branch is not pushed.** Session ledger: `proposals/OVERNIGHT_BUILD_LOG.md`.
- **Do not commit, push, merge, or deploy any migration work without the user's explicit say-so.**

---

*Last meaningful update: Aug 27 2026 — owner-directed revamp on `react-rebuild` (uncommitted): type ramp up one rung with mono narrowed to data-only (`web/DESIGN.md` records it), ~115 UI-copy fixes banning em-dash asides plus a `tidyProse()` display filter for model-composed text, mobile header collapse, and the Phase-2 single-name layer (`api/lookup.py` + `/api/market/search|profile|candles`, SymbolSearch/SingleName in Markets). A running uvicorn needs a restart to pick up the new routes.*

*Aug 26 2026 — refreshed the FastAPI section for the `react-rebuild` branch (assistant SSE endpoint, EODHD relay, DB bootstrap, same-origin bundle serving, env-driven CORS, port 8000) and recorded that migration steps 2–4 are built but neither pushed nor deployed.*

*Jun 2 2026 — stopped committing `data/macro_radar.db` to git (it bloated the repo to ~283 MB and broke Streamlit Cloud's deploy clone); purged it from history and now ship it as the `data-latest` GitHub Release asset, downloaded by the workflows (built-in `GITHUB_TOKEN`) and by the dashboard at startup (authenticated with `GH_DB_TOKEN`, since the repo is private).*