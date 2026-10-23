# Macro Regime Radar — Claude Code

Loaded by every session and every Project thread, and re-read after compaction. Keep it under 200 lines: repo facts and rules that are true for every task. Topic detail lives in `.claude/rules/` and loads when you touch matching files (index at the bottom). How threads branch, report and open PRs lives in the Claude Code Project's instructions, not here.

---

## What this is

- A quant macro terminal: a FastAPI service (`api/`) and a Vite + React 18 + TypeScript front end (`web/`) over one SQLite store that GitHub Actions rebuilds. `dashboard/` is the legacy Streamlit app.
- Python 3.12, Node 22. Sources: FRED, EODHD (API and live relay), Finnhub, NewsAPI, RSS, yfinance (pipeline only), Anthropic, Perplexity Sonar.
- **Front end:** Vercel, production branch `main`. A merge to `main` ships the public site.
- **API:** Render, built from `Dockerfile`, Auto-Deploy off; the owner deploys by hand. Runbooks: `docs/redesign/DEPLOY.md`, `docs/RUNBOOK.md`.
- **Data:** `data/macro_radar.db` is not in git. The refresh workflows publish it as the `data-latest` GitHub Release asset (`.claude/rules/database.md`).
- **`main` moves on its own:** the workflows commit memos and the playbook to `main` several times a day (`[skip ci]`). Expect it to move under your branch.
- **Public on purpose:** the repo is open so people can see how it works; the product is the website. Point user-facing text (UI copy, README, docs) to the site, not to cloning or self-hosting: no "run it yourself" guides, deploy buttons or badges. There is no LICENSE file; don't add one without the owner. Never commit keys, tokens or local machine paths.

## Layout

| Path | What |
|---|---|
| `api/` | FastAPI: routes, the background worker and its generations, provider layer (EODHD, Finnhub), live relay, assistant |
| `src/` | Data pipeline and analytics: `regime.py`, `analytics/` (recession, news, allocation, LBO, technicals), `market_data/`, `desk/` (Desk engine) |
| `web/` | React app. `web/DESIGN.md` (tokens, type, regime colors) and `web/PRODUCT.md` are the design and product contracts |
| `dashboard/` | Legacy Streamlit app |
| `scripts/` | Ops and fixture scripts (`validate_db.py`, `build_snapshot.py`, `sync_data.sh`, `lock_api_requirements.py`, `smoke_public.py`) |
| `tests/` | pytest. Web tests: vitest under `web/src`, Playwright under `web/e2e` |
| `.github/workflows/` | `refresh-data`, `intraday-refresh`, `daily-memo`, `weekly-memo`, `keep-api-warm` |
| `docs/` | Specs, reports, runbooks. Session history: `docs/agent-history.md` |

## Commands

- **Database for tests:** the release asset is public. `mkdir -p data && curl -fsSL -o data/macro_radar.db https://github.com/maxkomen-macro/macro-regime-radar/releases/download/data-latest/macro_radar.db` (≈30 MB, seconds), then `make validate-db PY=python3`. `make sync-data` does the same with validation but needs `gh` auth. Without the file, DB-backed tests skip (`tests/test_api.py` is module-wide `skipif`); a skip is not a pass, so name skips in reports.
- **Python deps:** `pip install -r requirements-api.lock pytest yfinance feedparser pyyaml python-dotenv requests` (about a minute) covers `make test-api`. `src/config.py` raises without `FRED_API_KEY`; a placeholder value is enough for tests. `requirements.txt` (Streamlit, prophet, openbb) is only for the legacy dashboard and the refresh pipeline.
- **Python tests:** `make test-api PY=python3` (the Makefile defaults to the owner's `.venv`). The full suite (~2,100 tests) takes 20–25 minutes, longer than one foreground command may run: run the tests that cover your change in the foreground (`python3 -m pytest tests/test_x.py -q`), and the full suite in the background before calling work done.
- **Judge failures against a baseline:** some tests are pinned to an older copy of the database (`test_desk_v2_technicals.py`'s `test_the_published_copy*`, the golden in `test_desk_native_regression.py`) or to the machine (a `chmod` read-only test can't fail a write as root). These and a few others can fail on an untouched `main` with today's database. Run the same tests on `origin/main` in the same environment and report only failures your change introduced, plus the baseline list.
- **Web:** `cd web && npm ci` once, then `make test-web` (typecheck + vitest), `make build-web`, `npm run e2e` (Playwright; needs browsers).
- **Run locally:** `uvicorn api.main:app --host 127.0.0.1 --port 8000`, then `cd web && npm run dev` (Vite on :5173 proxies to :8000).
- After editing `requirements-api.txt`: `python3 scripts/lock_api_requirements.py` (`tests/test_api_lock.py` pins it).

## Git and deploy rules (hard)

- Changes reach `main` only through a pull request. Never push to `main` directly, and never force-push or rebase a branch you didn't create.
- Merging is the owner's call: merge a PR only when the owner has approved that merge, or a standing rule from the owner covers it. Use a merge commit (the history uses them). A merge to `main` deploys the site.
- API changes don't go live on merge: Render deploys are manual. Say in the PR when a change needs one.
- Never touch deploy infrastructure: no Vercel or Render actions, no deploy hooks, no `gh workflow run`, no `gh release upload`, no secret changes.
- Stage explicit paths; never `git add -A` or `git add .`. The database, `web/node_modules` and `web/dist` have all been committed by accident before.
- Never commit `.env`, `.streamlit/secrets.toml`, `data/*.db`, or anything under `proposals/` that `.gitignore` excludes.

## Never

- Do not hardcode API keys or secrets anywhere in source.
- Do not commit `data/macro_radar.db`.
- Do not commit `.streamlit/secrets.toml`.
- Do not use chained pandas indexing (`df[col][mask] = value`) — use `df.loc[mask, col] = value`.
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
- Do not read a worker result on a Desk v2 route outside `desk_envelope.answer`: it pins the one generation that the item lookup, the memo key and the envelope share (Codex R-01).
- Do not hardcode design tokens or regime colors from memory: read them from `web/DESIGN.md` and `web/src/styles/tokens/`.

## Topic rules (`.claude/rules/`)

Each file loads automatically when you read or edit a file matching its `paths`. If one didn't load, read it before editing those paths.

| File | Covers | Loads for |
|---|---|---|
| `data-sources.md` | FRED series choices, month stamping, session-complete bars, market and news pipelines | `src/`, `scripts/`, `api/`, `tests/`, news screen, workflows |
| `analytics.md` | Regime engine, odds rounding, transition outlook, recession model, allocation caps | `src/`, `api/`, `dashboard/`, `tests/`, `web/src/lib`, `web/src/screens` |
| `database.md` | Why the DB is a Release asset, who reads and writes it | `data/`, `src/`, `scripts/`, `api/db.py`, `api/bootstrap.py`, workflows |
| `api.md` | FastAPI routes, worker generations, bootstrap, freshness, security, deploy posture | `api/`, `Dockerfile`, `deploy/`, API tests and scripts, `web/src/api`, `web/src/live` |
| `desk.md` | Desk engine, event study, Desk v2 envelope, NYSE calendars, regression gate | `src/desk/`, `api/desk*`, Desk screens and fixtures, Desk tests |
| `workflows.md` | The `data-write` concurrency group and retry loop (do not revert), modes, validation | `.github/workflows/`, validation and mode scripts |
| `secrets.md` | Every key, where it is read, what happens without it | config, `api/`, env templates, workflows |
| `assistant.md` | The chat agent, its tools, SQL guard, cost and persistence rules | assistant modules and tests |
| `streamlit.md` | Legacy Streamlit constraints and its own palette | `dashboard/`, `.streamlit/` |
| `web.md` | React app notes and where the design contract lives | `web/` |
| `surprises.md` | Surprise metrics: daily-store sources, session calendars, observation dates, CPI YoY, VIX alerts | `src/analytics/surprise*.py`, alerts, playbook, memo, `src/utils/format.py`, `api/db.py`, surprise tests |

## Keeping this file useful

- Do not append dated session notes here: that is how this file reached 450 lines and ~38k tokens. Put reports under `docs/`; older notes are in `docs/agent-history.md`.
- Add a line only for a gotcha that will bite the next session, in the matching `.claude/rules/` file. Add it here only if it applies to every task.
- Verify against the code before adding a claim. When in doubt, delete more than you add.
