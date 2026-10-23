# Agent session history (moved from CLAUDE.md, 2026-10-22)

Dated notes earlier Claude Code sessions appended to `CLAUDE.md`. Kept for reference; not loaded into sessions. Write new session reports under `docs/`, not in `CLAUDE.md`.

*Oct 1 2026 — `fix/freshness` (worktree `mrr-freshness`, from main `b116f584`; unpushed, gate `PUSH OK fix/freshness`): the relay's US day change (D1), true-dated 1W changes and month-end labels, one number per concept across the Dashboard and the Desk (D2), wording that matched the code (D3–D5: Streamlit untouched, transition odds called hand-set priors, "recession odds for this month, scored from inputs three months old"), the Regime Lab quadrant on per-axis scales, the tape's fund names; item 7 (the Dashboard VIX card on the tape's quote); Codex round 1 (R-01..R-24: relay anchors, rates through the Desk's reader, VIX by observation time, training copy from served metadata, wording; R-10, R-11 deferred, R-07 rejected); item 8 (the US 30Y strip card, "Data status"); Codex round 2 (R-25 close-evidence anchors, R-04 the REST hold, the 2008 peak from the served history, R-20's last strings incl. one engine provenance sentence pinned by `REWORDED` in the native gate). Report: `docs/FRESHNESS_REPORT.md`.*

*Sep 27 2026 — `desk/books` (worktree `mrr-books`, from main `4394e59`, rebased onto main `23014d0` after desk/fill-etf and desk/fill-compute merged): Basket & Hedge live from real prices. `range=2Y` daily candles, the basket engine (`src/desk/basket.py`), the shared technicals (`src/desk/technicals.py`), `/api/desk/basket/price` and `/basket/hedge`, named baskets with notional and method, the AI Infrastructure 10 preset, `?add=`, the three-step page, the options slot for desk/prototypes. Report: `docs/desk/BOOKS_REPORT.md`.*

*Sep 27 2026 — `desk/fill-compute` (worktree `mrr-compute`, unpushed): the empty Desk cards filled from stored data (RSI, the RSI studies, the VIX gap and band, what each regime has meant and the last five changes, one label on Regime, the classifier line, MACD, seasonality), the VIX moved to ^VIX, stale by publication cadence, FRED daily tolerance 3. Report: `docs/desk/FILL_COMPUTE_REPORT.md`.*

*Sep 28 2026 — `desk/usability` (worktree `mrr-usability`, rebased onto main `2c62d403`): the Desk walkable cold: Desk-wide stock search, Technicals for any US stock, Event Study on any question, saved positions first, grouped navigation, one line and one action per page, Start here, the landing link, deep links, loading and per-card failure states, hover definitions, the no-dead-control guard, the keep-warm cron. Report: `docs/desk/USABILITY_REPORT.md`.*

*Sep 26 2026 — `desk/frame-3-api-b2a` (session B2a, worktree `mrr-b2a`, rebased onto main `9979fe9` after frame-3 merged): Desk v2 `/regime`, `/macro`, `/pipeline`, `/pipeline/ddl` in the envelope, the three FRED curve tenors registered, the published `validation.json` verdict (both writers, bootstrap binding, per-generation key gate), the Data Pipeline's feeds derived from the code, the pipeline fixture from the served payload, the generated DDL fixture. Report: `docs/desk/FRAME3_API_REPORT_B2A.md`.*

*Sep 22 2026 — `desk/integration` (worktree `macro-regime-radar-integration`, cut from origin/main `a739585`; unpushed, gate `PUSH OK desk/integration`): desk/event-study and desk/frame merged, the lock carries `exchange_calendars`, one `api/desk.py`, the inventory's desk_series rows, the `awaiting_refresh` state for a database that predates the first full refresh, the Event Study page on the engine's real contract and slugs, the smoke's Desk checks. Report: `docs/desk/INTEGRATION_REPORT.md`.*

*Sep 22 2026 — `release/launch-1` (unmerged, unpushed): the public-deploy pass. Every gate at production values, the relay Origin allowlist, closed diagnostics, the assistant's $1/day ledger ceiling, an independent SQL-guard re-audit, `web/vercel.json`, `deploy/api.env.example`, the non-root one-worker image on a pinned lock, session-aware EODHD timers, the Vercel snapshot fetch and deploy hook, DEPLOY.md, `scripts/smoke_public.py`, generation-keyed cache invalidation, Finnhub fundamentals, and every e2e spec green (814). Nothing deployed.*

*Sep 21 2026 — `desk/frame` (worktree `macro-regime-radar-frame`): the Desk analyst workspace at `/desk` (`web/src/screens/desk/`, `web/src/styles/desk.css`, content in `web/src/content/desk/`), the one read-only endpoint `/api/desk/pipeline/inventory` (`api/desk.py`), spec `docs/desk/DESK_FRAME_SPEC.md`, report `docs/desk/FRAME_REPORT.md`. Unpushed; gate `PUSH OK desk/frame`.*

*Sep 10 2026 — committed the Sep 6 release-readiness pass as five commits and pushed `react-rebuild` to origin (force-with-lease over the Aug WIP commit that had `web/node_modules` and `web/dist` committed; that commit is kept locally as tag `backup/origin-react-rebuild-20260910`). Fixed the relay reconnect loop, the validator's event-calendar false positive, and added a graceful-shutdown timeout to the Dockerfile CMD. Review screenshots under `proposals/` are gitignored. Nothing merged or deployed.*

*Last meaningful update: Sep 6 2026 — release-readiness pass on `react-rebuild` (uncommitted): EODHD-first provider layer (`api/providers/`), security gates (`api/security.py`, `api/logsafe.py`), source-aware freshness (`api/freshness.py`, `api/calendar.py`), relay hardening, health endpoints, snapshot mode (`scripts/build_snapshot.py` + `web/src/api/snapshot.ts`), workflow modes with validation gates (`scripts/validate_db.py`), `make sync-data`, vitest suite, docs (`docs/RUNBOOK.md`, `docs/redesign/DEPLOY.md`, `proposals/FINAL_RELEASE_READINESS.md`). Nothing committed, pushed, dispatched or deployed.*

*Aug 27 2026 — owner-directed revamp on `react-rebuild` (uncommitted): type ramp up one rung with mono narrowed to data-only (`web/DESIGN.md` records it), ~115 UI-copy fixes banning em-dash asides plus a `tidyProse()` display filter for model-composed text, mobile header collapse, and the Phase-2 single-name layer (`api/lookup.py` + `/api/market/search|profile|candles`, SymbolSearch/SingleName in Markets). A running uvicorn needs a restart to pick up the new routes.*

*Aug 26 2026 — refreshed the FastAPI section for the `react-rebuild` branch (assistant SSE endpoint, EODHD relay, DB bootstrap, same-origin bundle serving, env-driven CORS, port 8000) and recorded that migration steps 2–4 are built but neither pushed nor deployed.*

*Jun 2 2026 — stopped committing `data/macro_radar.db` to git (it bloated the repo to ~283 MB and broke Streamlit Cloud's deploy clone); purged it from history and now ship it as the `data-latest` GitHub Release asset, downloaded by the workflows (built-in `GITHUB_TOKEN`) and by the dashboard at startup (authenticated with `GH_DB_TOKEN`, since the repo is private).*

## CLAUDE.md header before the split (superseded)

The title, intro, "Project at a Glance" and "Phase Status" of `CLAUDE.md` as they stood on `main` at the split, kept as they were except two edits: the live URL now points to the current site, and the owner's local machine path is removed. CLAUDE.md's "What this is" replaces them; some lines are stale (the stack and hosting line still describe the Streamlit app). The old `## What NOT to Do` list is now `## Never` in CLAUDE.md.

```markdown
# Macro Regime Radar — Claude Code Reference

Single source of truth for Claude Code sessions on this repo. Keep tight; verify against code before adding new claims. If you can't confirm a fact in five minutes of reading, don't add it.

---

## Project at a Glance

- **Live:** https://macro-economic-radar.vercel.app/
- **Repo:** github.com/maxkomen-macro/macro-regime-radar
- **Stack:** Python 3.12, Streamlit, SQLite (`data/macro_radar.db`), FRED + yfinance + Finnhub + NewsAPI + RSS (feedparser), Anthropic API, Perplexity Sonar API, scikit-learn, plotly/altair, openbb, arch, riskfolio-lib, quantstats, prophet. Hosted on Streamlit Community Cloud, automated via GitHub Actions.
- **Tabs:** 11 total. Names live in `dashboard/app.py` (around line 893).

---

## Phase Status

Phases 0–12 are complete. For per-phase scope, read `git log` and recent commit messages.
```
