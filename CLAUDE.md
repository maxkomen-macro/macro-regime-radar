# Macro Regime Radar — Claude Code Reference

Single source of truth for Claude Code sessions on this repo. Keep tight; verify against code before adding new claims. If you can't confirm a fact in five minutes of reading, don't add it.

---

## Project at a Glance

- **Live:** macro-regime-radar.streamlit.app
- **Repo:** github.com/maxkomen-macro/macro-regime-radar
- **Local path:** `/Users/maxkomen/Projects/Macro/macro-regime-radar` (moved Aug 5 2026; the old `/Users/maxkomen/Python Macro/` path is dead)
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
- **FRED daily series are stored month-stamped (B6, 2026-09-18).** `fred_client` keeps one `raw_series` row per month dated the 1st, holding the newest in-month value (published history every monthly model reads; never change it). The true date of each series' newest observation lives in `source_watermarks` (`src/watermarks.py`, written by `fetch_data.py`); `api/freshness.py` and `scripts/validate_db.py` read it. Counting lag from the month stamp produced the "nine business days behind" report on current values. Treasury yields (DGS*) follow the bond-market calendar (`api/calendar.py` `is_bond_trading_day`).
- **Daily bars are stored only after their session completes (B6).** `src/market_data/session.py` (`bar_is_complete`: real NYSE close incl. 13:00 half-days, +20 min; tables pinned to `api/calendar.py` by a parity test). Intraday runs capture the official close after the session; `intraday-refresh.yml` validates with `--mode intraday` (a stale daily close warns, never blocks). `scripts/restate_market_daily.py` restates the four known mid-session closes (2026-09-01/02/03/10); owner-run only.
- **`USSLIND` is a frozen historical series, and the recession model no longer trains on it.** FRED stopped publishing it in February 2020 — the local DB has 288 rows ending `2020-02-01` and that is the entire dataset that will ever exist. Because those rows are more than two years old, `src/analytics/recession.py` (`_usslind_stale`, ~lines 103–115) takes its fallback on every run: the fifth feature (`lei_proxy`) is the 10-year minus 5-year breakeven spread, `T10YIE − T5YIE`, for both **training and the live reading**. The series stays in `RECESSION_SERIES` (`src/config.py`) only so the stored history and the fallback check keep working. Corrected 2026-09-19 (iteration 1, decision I8); the earlier claim that the 288 rows are training data was wrong.
- **IRR:** `numpy.irr` was removed in recent numpy versions. Use binary search on NPV. Do not reintroduce `numpy.irr`. Implementation lives in `src/analytics/lbo.py` (look for `_compute_irr`).
- **LBO cash sweep (B1, 2026-09-18):** cash for debt service is 60% of EBITDA (`CASH_FOR_DEBT_SERVICE`); it pays interest first (a shortfall is added to the debt), scheduled amortization is a floor, and the remainder sweeps to debt; cash left after payoff goes to equity at exit. Before this the rate never reached the IRR. Documented in `docs/lbo-model.md`; pinned by `tests/test_lbo.py`.
- **Market data (pipeline):** `yfinance` (keyless) for both stored daily and intraday bars. (The on-demand API layer and the live tape are EODHD-first since 2026-09-06 — see the FastAPI section.) The active client is `src/market_data/yfinance_client.py` (`fetch_daily` + `fetch_intraday_5m`); `src/market_data/fetch_market.py` uses it for every mode (`backfill`, `incremental`, `intraday-only`) and **no longer requires `POLYGON_API_KEY`**. `src/market_data/polygon.py` and `config/providers.yml` remain on disk as dormant legacy — imported by nothing in the live pipeline. If you find yourself touching `polygon.py`, you're on the wrong path — verify with the user before continuing.
- **Migrated daily fetch off Polygon → yfinance (May 26 2026).** Symptom was Polygon free-tier 429s: the 12s-per-request throttle plus 60/120/240s backoffs made `--mode incremental` stall for 13+ min across the 23 daily symbols. The daily path now uses the same keyless yfinance source the intraday path already used. Daily rows are written with `source='yfinance'`.
- **News enrichment follows the page, not the run (N-B1, 2026-09-20).** `enrich_new_rows` used to see only the ids a run inserted, ranked by rule score, while the News tab asks `/api/news?hours=168` ordered by significance — so the cards on screen were almost never the enriched ones. `select_display_topups` (`src/analytics/news.py`) now reads the top ten of the display window that carry no AI read, mirroring `api/db.py`'s window clause and ORDER BY, and those ids take the hourly room first inside the same ledger, floor and $50 cap. Write that SQL in `news.py`, never import `api/db.py`: `tests/test_workflows.py` pins the module's imports to `requirements-news.txt`. `scripts/backfill_enrichment.py` does the same once for a database that is behind (read-only until `--apply`).
- **The top-up and the page mean the same ten stories (B-H2, fix/prelaunch-1).** The page merges near-identical headlines (`headlineKey` in `web/src/screens/news/news-copy.ts`) before it shows ten cards, so `select_display_topups` reads the page's 150 rows and collapses them on `news.headline_key`, a port that spells out JavaScript's whitespace set by code point (Python's `str.strip()`/`split()` differ on U+001C–U+001F, U+0085 and U+FEFF); `pendingReadIds` merges before it takes ten. One fixture, `web/src/screens/news/__fixtures__/story-keys.json`, drives both suites. A read replaces the rule score with Claude's, so a run re-reads the ten after its top-ups and settles newcomers (`settle`), pays for each story once, and `share_story_reads` lends a read to unread copies of the same story. One story, for paying once, settling and lending alike, is the same key published less than 12 h apart (`SHARE_SPAN`): a recurring title further apart is a different article.
- **News pipeline:** Finnhub (general + M&A), NewsAPI (macro + M&A), and keyless **RSS feeds** (`fetch_rss_news` + `RSS_FEEDS`: Federal Reserve, NYT Business, CNBC, FT Markets, MarketWatch — via `feedparser`) are ingested via `src/analytics/news.py`. All three flow through the same dedupe → classify → five-dimension significance scoring → store path. Rows are stored first; only rows new in this run with a rule score ≥ 2.5 get an Anthropic interpretation pass and a per-item Perplexity Sonar (cited research) enrichment, at most 10 per rolling hour under a $50/month hard cap, each call recorded with its cost from usage in the append-only `ai_spend_ledger` (never prune it; `src/analytics/ai_spend.py`, B4 2026-09-18). Both outputs persist into `news_feed` (`regime_interpretation` and `perplexity_research` columns). RSS source labels are tier-colored in the dashboard via `events_tab.SOURCE_TIERS`.

---

## Analytics Patterns

- **Regime engine:** 4-way softmax classifier — Goldilocks, Overheating, Stagflation, Recession Risk. Temperature = 0.7 (`src/regime.py:75`). Daily output stored in `regimes` table including 4 probability columns (`prob_goldilocks`, `prob_overheating`, `prob_stagflation`, `prob_recession`).
- **Signal card fill bars:** threshold-ratio formula.
  - "above" condition: `fill_pct = value / threshold * 100`
  - "below" condition: `fill_pct = threshold / value * 100`
  - Do not use historical-range-based `fill_pct` — it produced incorrect "all triggered" results.
- **Macro surprise scoring:** rolling z-scores over the configured window. Inspect `src/analytics/surprise.py` for current window length and the mix of 1-period diffs vs YoY changes — implementation evolves; do not memorize specific window values here.
- **Recession model:** logistic regression in `src/analytics/recession.py`, trained on NBER dates. Its fifth feature is the `T10YIE − T5YIE` breakeven spread for both training and the live reading, because USSLIND has been stale since Feb 2020 (see the USSLIND note above). Inspect that file for the current feature set and lag.
- **Allocation optimizer, adaptive universe (N-B2, 2026-09-20).** The optimizers fit on months where every asset has a return; across all ten that block starts Feb 2010, because HYG (2007) and DJP (2006) have no earlier history and no index proxy, so Goldilocks never cleared the 24-month bar and the optimizer had never produced weights. `adaptive_regime_block` drops the assets whose gaps cost the most months, but only while dropping still buys the bar; when it cannot, it keeps every asset and lowers the bar to what they support, never below `MIN_OPTIMIZER_MONTHS`/`MIN_OPTIMIZER_ASSETS`. `optimizations.universe` carries the excluded assets, the months used and a ready-to-print sentence, which the Tools panel states above the weights. No index history is spliced: FRED serves the ICE BofA total-return indices for a rolling three years only, and the commodity index Yahoo carries (`^SPGSCI`) tracks a different benchmark from DJP's.
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
- **`/api/*`** (31 routes on the `api` router) — one endpoint per table or computation the Streamlit dashboard reads: table endpoints mirror the dashboard loaders' SQL (`api/db.py`), computed ones call the same `src/analytics/*` modules the tabs do. Regime (`/latest`, `/history`, `/intelligence`, `/playbooks`, `/duration`, `/transitions`, `/analogues`, `/scenarios`, POST `/scenario`), `/signals/latest` (server-computed threshold, direction, distance-to-trigger, status — the frozen Atlas route keeps the old shape), `/priced`, `/surprises`, `/alerts`, `/news` (optional `ticker` filter) + `/news/latest`, `/market/daily`, `/market/intraday`, `/calendar` (upcoming window) + `/calendar/recent`, `/backtests` (pivoted long→wide server-side), `/credit/oas` (pct **and** bps + sparklines) + `/credit/metrics`, `/recession/probability` + POST `/recession/scenario`, `/lbo/defaults` + POST `/lbo/run`, `/allocation`, `/freshness`. **On-demand symbol layer** (`api/providers/`, rebuilt 2026-09-06; `api/lookup.py` is the compatibility seam): `/market/search?q=`, `/market/profile/{symbol}`, `/market/candles/{symbol}?range=` (provenance envelope, never a bare list), `/market/actions/{symbol}`, `/market/options/{symbol}/expirations` + `/market/options/{symbol}?expiration=`, `/market/ticks/{symbol}`, `/providers/status` — **EODHD only since fix/prelaunch-1 (the API process never calls Yahoo; an EODHD failure is a typed, disclosed error)**, one provider per series, typed errors (`{detail, kind, provider, retryable}` mapped from `api/providers/errors.py`), keyed single-flight TTL caches, symbol normalization in `api/providers/symbols.py` (never send Yahoo syntax to EODHD or vice versa). Entitlements are probed once per family at startup (`api/providers/entitlements.py`); on 2026-09-06 fundamentals and ticks are not in the plan (403 → explicit unavailable), options are. Tests: `tests/test_providers.py` (mock transport), `tests/test_symbols.py`, `tests/test_api_lookup.py`.
- **Live + assistant:** WebSocket `/api/stream/ws` and `GET /api/stream/debug` (EODHD relay, `api/stream.py` — one upstream connection per feed, the token never crosses to the client; 2026-09-06: stale-tick flags, degraded verdict, bounded dynamic `watch`/`unwatch` subscriptions ≤20 symbols with 10-min idle expiry). 2026-09-10: the upstream reconnect backoff resets only after EODHD's 200 ack or a tick, so a refused subscribe (`422 Symbols limit reached` — usually a second local uvicorn holding the per-token quota) backs off 1→30 s instead of reconnecting every second (`tests/test_stream_hub.py`); the Dockerfile CMD carries `--timeout-graceful-shutdown 10` so a hung shutdown cannot leave an orphan holding the feeds, and **POST `/api/assistant/ask`** (`api/chat.py`) which streams the Phase-12 agent as SSE (`data: {"delta"}` frames, terminal `event: done`) — gated by `ASSISTANT_ACCESS` (off by default when `CORS_ORIGINS` is set).
- **Per-series freshness (B3, 2026-09-18):** `/api/freshness` adds `series[]` (state live·delayed·close·stale·fallback·unknown, `as_of`, `delay_min`, `cycles_behind`, `stale`, `discontinued`, `reason`); `/api/credit/metrics`, `/api/credit/oas`, `/api/recession/probability`, `/api/signals/latest` and `/api/lbo/defaults` carry a `freshness` block (not the Atlas `/regime/latest` pair, not the bare lists). The four-word `verdict`/`overall` are unchanged. `/api/lbo/defaults` flags the stated defaults (`status: "fallback"`, `is_fallback`). `lbo.py`, `credit.py` and `recession.py` open the DB read-only. Seeded snapshots mark every state unknown (`scripts/build_snapshot.py seed_freshness`). Spec: `docs/redesign-v2/FRESHNESS_CONTRACT.md` (local).
- **`live_quotes` dates itself from a quote, not from a frame (BH2, 2026-09-20).** `_mark_frame` stamps the wall clock when *any* frame lands on a socket — acks, heartbeats and after-hours prints included — so on a Sunday the US feed dated itself Sunday. `api/stream.py` now keeps `feed_last_tick_at` beside `feed_last_frame_at`, stamped from each quote's own timestamp and resolved per symbol (VIX and crypto can never date the US feed), and `api/freshness.py` reads the tick stamp with arrival as the fallback. Arrival still drives the stale flags and the reconnect backoff; do not repoint those at the tick stamp.
- **Health + freshness (2026-09-06):** `/health/live`, `/health/ready` (503 until the DB opens with regime rows), `/api/freshness` (six stored maxima plus `overall`, NYSE `session`, per-feed `sla` verdicts from `api/freshness.py` + `api/calendar.py`, `regime.blockers`, `bootstrap`, `relay`). `scripts/validate_db.py` reuses the same verdicts in the workflows.
- **Public deploy posture (launch-1, branch `release/launch-1`, 2026-09-22):** `DEPLOY_PUBLIC=1` (or any `CORS_ORIGINS`) closes the diagnostics without `OPS_ACCESS_KEY` (503), turns off `/docs` and the schema, defaults the assistant to `off`, and makes the relay socket accept only the allowlisted Origin. The launch deploy runs the assistant **open** under a hard **$1-a-day ceiling** (`api/assistant_budget.py`): every model call is held in an append-only ledger (`ASSISTANT_LEDGER_PATH`, on a mounted disk) at its worst case before it is made, then settled at its real cost; a hang-up keeps the hold; the chip shows a plain resting state; `GET /api/assistant/status` follows the mode but not the question bucket. Visitors are keyed on `CLIENT_IP_HEADER` (Render: `cf-connecting-ip`), else `TRUSTED_PROXY_HOPS` from the right of `X-Forwarded-For`; `GET /api/ops/whoami` (ops-gated) shows what the limits see. EODHD timers follow the US session (prefetch off, REST loops half-hourly outside it; `api/providers/quota.py` counts units; idle ≈ 8,500 units on a weekday, 1,500 at a weekend, plan limit 100,000). Fundamentals come from **Finnhub** (`api/providers/finnhub.py`, free tier, 60/min, 12 h cache; a listing Finnhub answers for another share class or currency is refused). The query tool bounds a value at 256 KB, a row at 32 columns, a call at 2 MB and 2 s. Runbook: `docs/redesign/DEPLOY.md` (Vercel + Render, prices dated 2026-09-21, the merge order, rollback); smoke: `scripts/smoke_public.py`; env template: `deploy/api.env.example`; report: `docs/redesign-v2/LAUNCH_REPORT.md` (git-excluded).
- **Security (2026-09-06, `api/security.py`):** pure-ASGI middleware — body caps (64 KB; 16 KB assistant), per-client (600/min, burst 120) and global token buckets keyed on the socket peer or `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For`, concurrency ceilings for the calculators, provider calls and stored-data reads (`DB_MAX_CONCURRENCY`), relay-socket caps (`WS_MAX_PER_CLIENT` / `WS_MAX_TOTAL`), security headers, CSP on the served `index.html`, `OPS_ACCESS_KEY` for the diagnostics views; `api/logsafe.py` keeps `api_token` values out of every log line (httpx logged full URLs before). `api/db.py` reuses one read-only connection per worker thread (per-request open/close churn deadlocked the pool under a burst — review 2026-09-06).

Details:

- **Deps:** `requirements-api.txt` — `fastapi`, `uvicorn[standard]`, `httpx`, `websockets`, `pandas`/`numpy`/`scikit-learn` (recession), `riskfolio-lib==7.3.*` (allocation), `anthropic` (assistant). **No yfinance since launch-1**: the API never calls Yahoo; the refresh pipeline installs it from its own file. The image installs **`requirements-api.lock`** (`pip freeze` of the tested `.venv`, kept to this file's closure; `scripts/lock_api_requirements.py` regenerates it byte for byte; run it after changing `requirements-api.txt`). Kept **separate from `requirements.txt`** so the Streamlit Cloud build doesn't pull them. The riskfolio pin is load-bearing: `herc_optimize` in `src/analytics/allocation.py` carries a shim for 7.3.0's broken HERC kwarg forwarding — remove the pin only together with the shim.
- **Run:** `uvicorn api.main:app --host 127.0.0.1 --port 8000` (local `.venv/` in the repo has the deps). **Port 8000 everywhere** — the Vite dev server on :5173 proxies to it.
- **CORS:** the Vite dev origins (`localhost:5173` / `127.0.0.1:5173`) by default; the `CORS_ORIGINS` env var (comma-separated) **replaces** them for a split deploy. Methods are **GET + POST** — every POST (scenario, recession sensitivity, LBO, assistant) is pure computation over stored data; nothing writes. The built bundle served same-origin needs no CORS. Effective origins are logged in the lifespan startup block.
- **Static bundle:** when `web/dist` exists, `api/main.py` mounts `/assets` + `/fonts` and adds an SPA catch-all, so one process serves the API and the built React app. Paths whose first segment is `api|health|regime|signals|series` stay JSON 404s. No `dist` → nothing is mounted and the Vite dev flow is unchanged.
- **DB bootstrap:** `api/bootstrap.py` checks the `macro_radar.db` asset on the `data-latest` Release at lifespan start (and every `BOOTSTRAP_DB_REFRESH_MIN` minutes when > 0) using `GH_DB_TOKEN`, and downloads only when the **asset's identity** changed (id, updated_at, size, digest, recorded in `data/*.asset.json`, gitignored); the local mtime never decides, and `BOOTSTRAP_DB_MAX_AGE_MIN` is legacy (reported, decides nothing). Temp file beside `DB_PATH` + `os.replace` atomic swap, then the worker is poked. No token → no-op; dev keeps the on-disk DB untouched. An unchanged refresh is no download, no swap, no rebuild (fix/prelaunch-1, B-H1).
- **Generations (fix/prelaunch-1):** a background worker (`api/worker.py`, started in the lifespan) builds every database-derived result (`api/analytics_cache.ITEMS`: credit, recession metrics + fitted model, takeaway, duration, transitions, analogues, playbooks, scenario defs, LBO defaults, allocation) into a **generation**: an in-memory shared-cache copy of the DB file plus those results. A change in the file key (`src/analytics/dbpath.file_key`: inode, mtime, size, plus a non-empty `-wal`) starts the next generation; reads (`api/db.py` and every analytics module through `dbpath.connect_ro`) and results switch together once it is complete, and the previous one answers until then. Handlers only look results up and never compute. Before the first pass a request waits 5 s (`WAIT_S`), then gets 503 `warming` with `Retry-After`; `/health/ready` is 503 `warming` until the first pass. The TTL caches that outlived a DB swap by up to an hour (B-H1) are gone; the assistant's recession view is a worker item (`assistant_recession`), and outside the API it keys on `dbpath.current_key`. `PinGeneration` (pure ASGI, innermost) pins each HTTP request to the generation published when it arrived, and a replaced generation stays readable until the next publish, so one response never mixes two. The last good result is the last good generation, whole: an item the served generation answers well that fails on a new file holds the new generation back (the previous one serves everything), is retried at 30 s and 60 s, and after `HOLD_ATTEMPTS` consecutive failed builds (whatever the file) publishes with that item as its error; a failure the served generation already has publishes at once. Never carry one item's result into another file's generation: that was B-H1 again. Stored errors keep no traceback and requests raise copies (re-raising the stored object chained every request's frames onto it). The serving process freezes its heap after the first build (`GC_FREEZE`): full collections walked ~180k objects with the GIL held. Allocation builds in a spawned child (`api/allocation_child.py`): SciPy/riskfolio hold the GIL long enough to stall the event loop otherwise, and the frontier's SLSQP callbacks `sleep(0)` for the same reason. Tests that install their own worker use the `install_worker` fixture (`tests/conftest.py`).
- **DB access:** `api/db.py` keeps one read-only connection per worker thread, reading the published generation (keyed on the generation's uri) or, with no generation, the file via `file:...?mode=ro`. Verified byte-identical DB after a full test run.
- **Recession model:** trained by the worker once per generation (no artifact on disk). Its probability is the **recession model's**, not `regimes.prob_recession` — the response carries `probability_source: "recession_model"` to disambiguate.
- **Allocation:** computed from the price histories the `full` refresh stores in the additive `asset_prices` table (`src/market_data/asset_history.py`: EODHD first where it carries the instrument, Yahoo as the disclosed fallback, one provider per series, completed sessions only; validated by `validate_db`, carried by `/api/freshness` as the `asset_prices` series). On a database without the table `/api/allocation` answers 503 `not_stored` and never downloads. It is the one endpoint without a strict response model (asset×regime matrices keyed by data).
- **Assistant:** shares `src/analytics/chat.py` — `is_safe_select` and the tool table are **imported, never copied**; `tests/test_api.py::test_assistant_guard_identity_no_local_copy` asserts `api/chat.py` carries no guard symbols of its own. That module no longer imports `src.config`: it has its own `DB_PATH` and `get_secret` (env → `st.secrets` → repo-root `.env`), plus a `TAB_CONTEXT` ContextVar so `explain_current_view` works without Streamlit session state. `POST /api/assistant/ask` is gated by `api/security.py` (2026-09-06): `ASSISTANT_ACCESS=off|key|open`, 10 req/min per client, 16 KB bodies, no persistence — `docs/redesign/DEPLOY.md` documents the modes.
- **Gotcha:** `/api/credit/oas` anchors its `days` window to `date('now')`; if FRED credit data is stale beyond the window, the endpoint 404s. Default `days=90` gives ample slack.
- **Tests:** `tests/test_api.py` (FastAPI `TestClient` against the real read-only DB; skips if the DB file is absent) covers every route group plus the SSE frame contract (stub agent, no tokens spent) and the SPA-fallback/JSON-404 split. Alerts tests are shape-only — `alert_feed` has ~1 row.

---

## Desk · Event Study (branch `desk/event-study`, 2026-09-21 — not merged)

- **Registry:** `src/desk/series.py` (stdlib, keyless). Every asset the engine may read is declared there: store (`fred` / `market` → `desk_series`; `asset_prices` for `^GSPC`, `^RUT`, `GC=F`), shock unit (price → log return; yields and OAS → bp with `scale=100`, FRED serves percent; VIX → log change), declared `history_from`, tier, roles, and two clock times in ET (`fixed_at`: when the day's value is determined; `known_at`: when it is observable; `known_by` is derived for the API). Gold is **GC=F from `asset_prices`** (COMEX front month, 2000-08-30); FRED stopped serving `GOLDPMGBD228NLBM` (listed as unavailable with the reason). A study on gold says "since 2000", the cross study "since 1990", never "since data start".
- **Store:** `desk_series (series_id, date, value, provider)`, written by `python -m src.market_data.desk_history --tier 1` in the `full` refresh (after `asset_history`, before `rm -f .env`). FRED rows are **merged**, never replaced: FRED now serves the ICE BofA OAS series as a rolling three-year window ("Starting in April 2026, this series will only include 3 years of observations"), so `BAMLH0A0HYM2` is declared from 2023-09-22 and the store keeps everything it was ever served. Market rows are replaced whole (adjusted closes restate). A series served short of its declared start gets watermark status `short`; `validate_db` warns, never blocks, and fails a full-mode DB without the table. `/api/freshness` carries a `desk_series` verdict (T+1: FRED posts next day). Tier 1 makes no provider calls; tier 2 adds three EODHD/Yahoo series. The server process never imports the writer.
- **Engine:** `src/desk/event_study.py` (reads through `dbpath.connect_ro`, never writes, never fetches, never recomputes a regime). After the two 2026-09-21 reviews (R-01…R-20, `docs/desk/EVENT_STUDY_REPORT.md` §9): the session calendar is `exchange_calendars` XNYS (pinned 4.13.2 in `requirements-api.txt`) over the inputs' span, never derived from stored rows; every series is aligned onto it, off-session observations and calendar sessions without a value (the S&P's included) are counted exclusions, dates outside the calendar are rejected; a window is incomplete when a session it reads is missing (a move reads t−w and t, a forward window e and e+h; the z window needs 240 of 252 moves); non-finite or non-positive prices before a log are exclusions with a reason; one evaluability mask (z exists, condition computable, target present, lagged regime label exists) for events and baseline, every baseline candidate taking the same entry delay and completeness rules, Unlabeled events in their own row outside the totals; timing rules per series (`fixed`, `known`, `defer_as_target`) resolved per session against the calendar's open and close, FRED daily Treasury and OAS values known at the next open, gold and copper deferred as targets; strict crosses whose side state resets on an unevaluable session; cluster bootstrap over overlapping-window blocks, enumerated exactly up to 7 blocks (7^7 draws) and 10,000 Monte Carlo draws above, an interval needs 5 blocks and an exclusion claim 10 blocks plus an adverse share under 3% with zero counted as adverse and the interval bounds resampled values rounded outward (else "exclusion not established"); the calendar is built one session past the last input; the verdict cites n and blocks per horizon, needs two eligible regimes and a 0.5 pp (5 bp) contrast for a ranking, and names the stage that emptied a zero-event set; `inputs_hash` covers the generation id, content hashes of every input and the regime table, every parameter and the resampling method and draws; validation rejects non-finite thresholds, invalid seeds and parse failures (422) and clamps `cond_value` to ±1e6. Desk never shows `regimes.prob_recession`; the only recession number it may surface is the logistic model's.
- **API:** `GET /api/desk/event-study/assets` (worker item `desk_assets`) and `GET /api/desk/event-study?study=<slug>|params` (`api/desk.py`). Presets (`desk_preset:*` items) are looked up at the default seed; any other seed and every free-form query computes on request behind `EXPENSIVE_PATHS`, pinned to the request's generation, cached by (generation key, slug, seed), and answers **202 `computing`** with `Retry-After` past 20 s and **429 `busy`** when `CACHE_MAX` computations are outstanding, never a blank panel. A job leases the generation it was submitted under (its own connection to that copy, never the served fallback); an expired generation cancels the job and the client's retry lands on the current one. The cache key is the losslessly serialized validated parameters. 422 for a query the engine cannot run; 503 `not_stored` for a planned series. Slugs are permalinks with `repr` floats (`gold-2sigma-spx-weak`, `spx-golden-cross`, `spx-death-cross`, or `shock-w20-z2.0-up-cond=value-target[-regime]`).
- **Verification:** `tests/test_event_study.py` (synthetic rules + §8 against `data/desk_scratch.db`, an owner-populated copy; `DESK_DB` overrides; skipped without it), `tests/test_desk_api.py`, `tests/test_desk_history.py`; `scripts/desk_event_study.py` prints a study read-only. Report: `docs/desk/EVENT_STUDY_REPORT.md`.
- **Gotcha:** a blank `EODHD_API_TOKEN` does not disable the relay or the provider layer: both loaders treat an empty value as absent and fall through to the repo-root `.env`. Only a missing `.env` (or no token in it) keeps them off.

---

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

`refresh-data.yml` has four explicit modes — `full` (11:17 UTC daily, 00:23 UTC Tue–Sat), `news-only` (hourly at :41, lean `requirements-news.txt`), `market-only` (`requirements-market.txt`), `verify-only` — resolved by `scripts/workflow_mode.py` (an unknown cron becomes `verify-only`, never `full`). Every DB-writing run keeps `data/previous.db`, runs `scripts/validate_db.py` (integrity, tables, counts, max-date regression, mode-scoped SLA verdicts, step summary) and uploads only on `pass` + changed. Full runs publish `snapshot-latest.json` and a `validated-db` artifact; after a validated morning full run the refresh dispatches `daily-memo.yml` / `weekly-memo.yml` with its run id and they consume that artifact, refusing anything but `mode=full` (no stash/rebase anywhere). `make sync-data` pulls the Release asset locally with the same validation.

### Rules for future workflow edits

1. **Never replace the retry loop with stash/rebase patterns.** They will reintroduce the binary conflict.
2. If adding a third workflow that writes to `data/macro_radar.db`, give it the same `concurrency: { group: data-write, cancel-in-progress: false }` block.
3. The `for i in 1 2 3 4 5` loop is load-bearing — do not reduce attempts below 3 or remove the backoff.
4. If a scheduled run fails, investigate as a new bug, not the old conflict pattern.

---

## Git Session Routine

### Before every session

```bash
cd "/Users/maxkomen/Python Macro/macro-regime-radar"
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
| `FINNHUB_API_KEY` | Optional — news ingest, and since launch-1 the single-name panel's fundamentals on the API host (`api/providers/finnhub.py`; the key rides in a header, never a URL) |
| `NEWS_API_KEY` | Optional — required for news ingest. **Note the underscore.** Code uses `NEWS_API_KEY`, not `NEWSAPI_KEY` |
| `ANTHROPIC_API_KEY` | Optional — required for AI regime interpretation |
| `PERPLEXITY_API_KEY` | Optional — required for Sonar research enrichment |
| `POLYGON_API_KEY` | Legacy — yfinance is the active path; no longer read by the pipeline. Safe to leave in secrets or remove |
| `GH_DB_TOKEN` | Fine-grained PAT with **Contents: Read** on this repo. Lets `dashboard/app.py` (Streamlit Cloud secret) and `api/bootstrap.py` (env var) download `data/macro_radar.db` from the private `data-latest` Release. Not needed locally; workflows use the built-in `GITHUB_TOKEN` |
| `EODHD_API_TOKEN` | API only — read by `api/stream.py` and `api/providers/market.py` (env, else repo-root `.env`) for the live-quote relay and the on-demand provider layer. Absent → feeds stay off, on-demand lookups answer a typed `missing_token` error (no Yahoo fallback since fix/prelaunch-1), the client falls back to its DB poll. The refresh pipeline's stored histories use it when present (EODHD first) and fall back to Yahoo, disclosed, when absent. Never sent to the browser; redacted from logs by `api/logsafe.py`. **Not a GitHub Actions secret and not needed there** — an owner action on the API host |

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
- Do not put `USSLIND` in a recession freshness block — `RECESSION_INPUTS` (`api/main.py`) names the seven series the model reads (`DGS10`, `DGS2`, `BAMLH0A0HYM2`, `T10YIE`, `T5YIE`, `UNRATE`, `INDPRO`); USSLIND is only the staleness probe and USREC the training target.
- Do not remove `USSLIND` from `RECESSION_SERIES` config without reading `src/analytics/recession.py` first — the model already trains on the `T10YIE − T5YIE` fallback, and the config entry keeps the stored history and the staleness check working.
- Do not assume the env var is `NEWSAPI_KEY` — code uses `NEWS_API_KEY` (underscore).
- Do not extend or reintroduce the `polygon.py` code path — yfinance (`yfinance_client.py`) is the live market data source for daily and intraday.
- Do not replace the workflow retry loop with stash/rebase patterns.
- Do not remove `data/macro_radar.db merge=ours` from `.gitattributes`.
- Do not introduce historical-range-based `fill_pct` for signal cards.
- Do not silently swallow errors — surface them in the UI or log to session state.
- Do not add a TTL cache of database-derived data or compute on the request path: add a worker item (`api/analytics_cache.ITEMS`) so it is rebuilt with every generation (fix/prelaunch-1).
- Do not call Yahoo from the API process (on-demand lookups are EODHD only); the refresh pipeline's `market.daily_history(..., allow_yahoo=True)` is the only Yahoo path.
- Do not let the chat agent run non-`SELECT` SQL — `is_safe_select` in `src/analytics/chat.py` enforces this and is covered by `tests/test_chat_sql_guard.py`.
- Do not copy `is_safe_select` (or any tool implementation) into another module — **import** it from `src/analytics/chat.py`. A forked copy is exactly how the hardening drifts back out; `tests/test_api.py` fails if `api/chat.py` grows its own.
- Do not persist chat history to the DB — Phase 12 is intentionally session-only so visitors never see prior visitors' conversations.
- Do not replace `desk_series` FRED rows whole or fetch them with a lookback: FRED serves the ICE BofA OAS series as a rolling three years since April 2026, and the store's merge is what keeps the older observations (see Desk · Event Study).
- Do not surface `regimes.prob_recession` in Desk; only the logistic model's probability, labelled as such.

---

## Phase 12 — Conversational AI Assistant

**Status:** Complete (May 3 2026).

**Where it lives:** Floating bottom-right FAB rendered on every tab. Click opens an `@st.dialog` modal containing the chat. Wired in once at the end of `dashboard/app.py`, after the last `with tab_meth:` block.

**Files added:**
- `src/analytics/chat.py` — `MacroRadarAgent`, `SYSTEM_PROMPT_TEMPLATE`, 8 tool definitions, tool-use loop (10-iteration cap), `is_safe_select` SQL guard, `RateLimited` / `NetworkError` / `AgentError` exception hierarchy.
- `dashboard/components/chat_widget.py` — `render_chat_launcher()` (FAB) and `_chat_dialog()` (modal). Streams via `st.write_stream` over `MacroRadarAgent.ask_streaming`.
- `dashboard/utils/tab_context.py` — `register_tab_context(tab_name, metrics, kind="live")` writes to `st.session_state.current_tab_context`.
- `tests/test_chat_sql_guard.py` — unit tests covering allowed SELECT/CTE forms and rejecting DDL/DML/PRAGMA/ATTACH/chained statements.

**Files modified:** `dashboard/app.py` (launcher wire-up + Dashboard tab context call); all 11 tab render functions in `dashboard/components/` plus the inline Dashboard block (`register_tab_context` call at entry).

**Tools (8):**
- `query_database(sql)` — read-only SELECT only; capped at 200 rows.
- `get_current_regime()` — latest `regimes` row (label, confidence, growth/inflation trends, 4 probabilities).
- `get_signal_status(signal_name?)` — latest signal rows from `signals`.
- `get_recession_probability()` — latest + 1m / 3m / 6m prior `prob_recession`.
- `get_credit_snapshot()` — latest IG/HY/CCC/BB/B OAS plus 10Y UST (returned in both pct and bps).
- `get_market_snapshot(ticker)` — latest close + 1d/5d/1m/YTD return from `market_daily`.
- `get_recent_headlines(limit, min_significance)` — top items from `news_feed` with `regime_interpretation` and `perplexity_research`.
- `explain_current_view()` — reads the `TAB_CONTEXT` ContextVar (set per request by `api/chat.py`), falling back to `st.session_state.current_tab_context`.

**Model:** `claude-sonnet-4-5-20250929` via the official `anthropic` SDK (already in `requirements.txt`).

**API key:** `ANTHROPIC_API_KEY` loaded via `src/analytics/chat.py`'s own `get_secret` (env → `st.secrets` → repo-root `.env`) — *not* `src.config`, which would drag in the `FRED_API_KEY` requirement and break the key-less FastAPI path. Missing key → FAB silently replaced with a muted "AI Assistant unavailable — API key not configured" caption; no traceback.

**SQL guard:** `is_safe_select` rejects anything that isn't a single `SELECT` (or `WITH … SELECT`) statement. Bans interior `;`, all DDL/DML, PRAGMA (including table-valued `pragma_*`), ATTACH/DETACH, VACUUM, REINDEX, TRUNCATE, `randomblob`/`zeroblob`, `load_extension`. `query_database` additionally installs a SQLite progress handler that aborts a query after ~20M VM instructions — the bound the keyword guard can't express (e.g. an unbounded `WITH RECURSIVE`).

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

Every Claude Code session that ships code to `main` is responsible for updating this file before its final commit:

1. If you completed a phase, update "Phase Status".
2. If you discovered a new gotcha (Streamlit behavior, library quirk, data source issue), add a one-line entry under the relevant section.
3. If you changed workflow files, update the GitHub Actions section.
4. If you added a new dependency or external service, note it in "Project at a Glance" and "API Keys & Secrets" if applicable.
5. If you removed or renamed a tab, update the tab count.
6. Do not add Phase Nx architecture sections until that phase has shipped — speculative documentation drifts faster than no documentation.

When in doubt: delete more than you add. Stale documentation is worse than missing documentation.

---

## React Migration (in progress — nothing ships without explicit user approval)

- **Design source of truth:** `/Users/maxkomen/Documents/Trading-Research-Docs/Macro Regime Radar Design System/` — read `HANDOFF_REACT_MIGRATION.md` there first. `styles.css` + `tokens/` and `components/**/*.jsx` are shippable near as-is; `ui_kits/` are fixture-data references only.
- **Design tooling:** the `impeccable` Claude Code plugin (v4.0.4, user scope, from `pbakaus/impeccable`) is installed — use `/impeccable` (audit, critique, polish, …) alongside the handoff bundle for all UI work.
- **Step 1 (API) is built** — see the FastAPI section above.
- **Steps 2–4 are built on branch `react-rebuild`** (as of 2026-08-26). `web/` is a Vite + React 18 + TypeScript app: all 7 tabs (Dashboard, Regime Lab, Markets, Credit, Recession, News & Calendar, Tools) plus Methodology and the assistant panel (`web/src/screens/shell/AssistantPanel.tsx` over `POST /api/assistant/ask`), a responsive foundation (`web/src/lib/useBreakpoint.ts` — mobile <480 / tablet <768 / desktop <1024 / wide; the sole width-conditional mechanism) and h1→h2→h3 heading semantics. Product and design contracts for it live in `web/PRODUCT.md` and `web/DESIGN.md`. A `Dockerfile` plus `docs/redesign/DEPLOY.md` describe two working deploys (split Vercel + backend host, or a single same-origin host). **The branch is pushed to origin as of 2026-09-10; nothing is merged or deployed.** Session ledger: `proposals/OVERNIGHT_BUILD_LOG.md`.
- **Do not commit, push, merge, or deploy any migration work without the user's explicit say-so.**

---

*Sep 22 2026 — `release/launch-1` (unmerged, unpushed): the public-deploy pass. Every gate at production values, the relay Origin allowlist, closed diagnostics, the assistant's $1/day ledger ceiling, an independent SQL-guard re-audit, `web/vercel.json`, `deploy/api.env.example`, the non-root one-worker image on a pinned lock, session-aware EODHD timers, the Vercel snapshot fetch and deploy hook, DEPLOY.md, `scripts/smoke_public.py`, generation-keyed cache invalidation, Finnhub fundamentals, and every e2e spec green (814). Nothing deployed.*

*Sep 10 2026 — committed the Sep 6 release-readiness pass as five commits and pushed `react-rebuild` to origin (force-with-lease over the Aug WIP commit that had `web/node_modules` and `web/dist` committed; that commit is kept locally as tag `backup/origin-react-rebuild-20260910`). Fixed the relay reconnect loop, the validator's event-calendar false positive, and added a graceful-shutdown timeout to the Dockerfile CMD. Review screenshots under `proposals/` are gitignored. Nothing merged or deployed.*

*Last meaningful update: Sep 6 2026 — release-readiness pass on `react-rebuild` (uncommitted): EODHD-first provider layer (`api/providers/`), security gates (`api/security.py`, `api/logsafe.py`), source-aware freshness (`api/freshness.py`, `api/calendar.py`), relay hardening, health endpoints, snapshot mode (`scripts/build_snapshot.py` + `web/src/api/snapshot.ts`), workflow modes with validation gates (`scripts/validate_db.py`), `make sync-data`, vitest suite, docs (`docs/RUNBOOK.md`, `docs/redesign/DEPLOY.md`, `proposals/FINAL_RELEASE_READINESS.md`). Nothing committed, pushed, dispatched or deployed.*

*Aug 27 2026 — owner-directed revamp on `react-rebuild` (uncommitted): type ramp up one rung with mono narrowed to data-only (`web/DESIGN.md` records it), ~115 UI-copy fixes banning em-dash asides plus a `tidyProse()` display filter for model-composed text, mobile header collapse, and the Phase-2 single-name layer (`api/lookup.py` + `/api/market/search|profile|candles`, SymbolSearch/SingleName in Markets). A running uvicorn needs a restart to pick up the new routes.*

*Aug 26 2026 — refreshed the FastAPI section for the `react-rebuild` branch (assistant SSE endpoint, EODHD relay, DB bootstrap, same-origin bundle serving, env-driven CORS, port 8000) and recorded that migration steps 2–4 are built but neither pushed nor deployed.*

*Jun 2 2026 — stopped committing `data/macro_radar.db` to git (it bloated the repo to ~283 MB and broke Streamlit Cloud's deploy clone); purged it from history and now ship it as the `data-latest` GitHub Release asset, downloaded by the workflows (built-in `GITHUB_TOKEN`) and by the dashboard at startup (authenticated with `GH_DB_TOKEN`, since the repo is private).*