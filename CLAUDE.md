# Macro Regime Radar — Claude Code Reference

Single source of truth for Claude Code sessions on this repo. Keep tight; verify against code before adding new claims. If you can't confirm a fact in five minutes of reading, don't add it.

---

## Project at a Glance

- **Live:** macro-regime-radar.streamlit.app
- **Repo:** github.com/maxkomen-macro/macro-regime-radar
- **Local path:** `/Users/maxkomen/Python Macro/macro-regime-radar` (note the space — escape in shell)
- **Stack:** Python 3.12, Streamlit, SQLite (`data/macro_radar.db`), FRED + yfinance + Finnhub + NewsAPI, Anthropic API, Perplexity Sonar API, scikit-learn, plotly/altair, openbb, arch, riskfolio-lib, quantstats, prophet. Hosted on Streamlit Community Cloud, automated via GitHub Actions.
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
5. **Fragments:** scope `st.fragment(run_every=N)` narrowly. Wrapping a whole tab in a fragment causes session state issues.

---

## Data Source Rules

- **FRED yields:** daily series only — `DGS2`, `DGS10`. Not monthly averages `GS2`, `GS10`.
- **IG OAS:** `BAMLC0A0CM`. Not `BAMLC0A0CAAA`. Other BAML series in active use: `BAMLH0A0HYM2` (US HY), `BAMLH0A1HYBB` (BB), `BAMLH0A2HYB` (B), `BAMLH0A3HYC` (CCC).
- **Inflation expectations:** `T10YIE` and `T5YIE` are the live signals. Breakeven proxy `T10YIE − T5YIE` is the operative input for current readings.
- **`USSLIND` is a frozen historical series.** FRED stopped publishing it in February 2020 — the local DB has 288 rows ending `2020-02-01` and that is the entire dataset that will ever exist. The series is still present in `RECESSION_SERIES` (`src/config.py`) because it is used as historical training data for the recession model. **Never remove `USSLIND` from config without first confirming the recession model has been retrained without it.** For live recession signal computation, the breakeven proxy above is what's actually being read.
- **IRR:** `numpy.irr` was removed in recent numpy versions. Use binary search on NPV. Do not reintroduce `numpy.irr`. Implementation lives in `src/analytics/lbo.py` (look for `_compute_irr`).
- **Market data:** `yfinance` (keyless) for both daily and intraday. `src/market_data/polygon.py` exists as legacy code and `POLYGON_API_KEY` is still read from secrets, but it is **not in the active fetch path.** Live workflow `intraday-refresh.yml` says explicitly "yfinance — no API key needed". If you find yourself touching `polygon.py`, you're probably on the wrong path — verify with the user before continuing.
- **News pipeline:** Finnhub (general + M&A) and NewsAPI (macro + M&A) are ingested via `src/analytics/news.py`. Five-dimension significance scoring lives there. Top-significance items get an Anthropic interpretation pass and a per-item Perplexity Sonar (cited research) enrichment. Both outputs persist into `news_feed` (`regime_interpretation` and `perplexity_research` columns).

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

`data/macro_radar.db` is the local SQLite store, refreshed by scheduled workflows.

- 11 tables in active use (10 excluding `sqlite_sequence`).
- Excluded from local git tracking via `.git/info/exclude` — will not appear as modified locally.
- Do **not** add it back to tracking. Do **not** commit it.
- Inspect schema: `sqlite3 data/macro_radar.db ".schema"`
- List tables: `sqlite3 data/macro_radar.db ".tables"`

Tables added since v1: `news_feed` (Phase 11) and `factor_data` (Fama-French factors via openbb).

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

The two workflows queue against each other instead of racing. Only one DB-writing workflow runs at a time.

Note: there are also `daily-memo.yml` and `weekly-memo.yml` workflows. They generate HTML memos and do not write to `data/macro_radar.db` directly, so they are not part of the `data-write` concurrency group.

### Retry loop pattern

The "Commit and push" step in BOTH DB-writing workflows uses a 5-attempt retry loop with `git reset --soft origin/main` instead of the old `git stash` / `git pull --rebase` / `git stash pop` pattern:

```yaml
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add data/macro_radar.db
git add output/playbook.json 2>/dev/null || true   # refresh-data.yml only
git commit -m "<EXISTING_COMMIT_MESSAGE>"
for i in 1 2 3 4 5; do
  git fetch origin main
  COMMIT_MSG=$(git log -1 --pretty=%B)
  git reset --soft origin/main
  git commit -m "$COMMIT_MSG"
  if git push; then
    echo "Push succeeded on attempt $i"
    exit 0
  fi
  echo "Push failed on attempt $i, retrying..."
  sleep $((RANDOM % 10 + 5))
done
echo "Push failed after 5 attempts"
exit 1
```

### Why this works

`git reset --soft origin/main` moves the branch pointer to origin's tip while keeping the staged DB changes, then re-commits on top. **No rebase, no merge, no binary conflict possible.** Each attempt has a 5–14s random backoff.

### Commit messages preserved across the soft reset

- `refresh-data.yml`: `"Auto-refresh data [skip ci]"`
- `intraday-refresh.yml`: `"Intraday refresh [skip ci]"`

### `.gitattributes`

Still contains `data/macro_radar.db merge=ours`. Harmless, left in place. Do not remove.

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
| `FINNHUB_API_KEY` | Optional — required for news ingest |
| `NEWS_API_KEY` | Optional — required for news ingest. **Note the underscore.** Code uses `NEWS_API_KEY`, not `NEWSAPI_KEY` |
| `ANTHROPIC_API_KEY` | Optional — required for AI regime interpretation |
| `PERPLEXITY_API_KEY` | Optional — required for Sonar research enrichment |
| `POLYGON_API_KEY` | Legacy — yfinance is the active path; `POLYGON_API_KEY` is not used in the live pipeline |

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
- Do not extend the `polygon.py` code path — yfinance is the live market data source.
- Do not replace the workflow retry loop with stash/rebase patterns.
- Do not remove `data/macro_radar.db merge=ours` from `.gitattributes`.
- Do not introduce historical-range-based `fill_pct` for signal cards.
- Do not silently swallow errors — surface them in the UI or log to session state.
- Do not let the chat agent run non-`SELECT` SQL — `is_safe_select` in `src/analytics/chat.py` enforces this and is covered by `tests/test_chat_sql_guard.py`.
- Do not persist chat history to the DB — Phase 12 is intentionally session-only so visitors never see prior visitors' conversations.

---

## Phase 12 — Conversational AI Assistant

**Status:** Complete (May 3 2026).

**Where it lives:** Floating bottom-right FAB rendered on every tab. Click opens an `@st.dialog` modal containing the chat. Wired in once at the end of `dashboard/app.py`, after the last `with tab_meth:` block.

**Files added:**
- `src/analytics/chat.py` — `MacroRadarAgent`, `SYSTEM_PROMPT_TEMPLATE`, 8 tool definitions, tool-use loop (10-iteration cap), `is_safe_select` SQL guard, `RateLimited` / `NetworkError` / `AgentError` exception hierarchy.
- `dashboard/components/chat_widget.py` — `render_chat_launcher()` (FAB) and `_chat_dialog()` (modal). Streams via `st.write_stream` over `MacroRadarAgent.ask_streaming`.
- `dashboard/utils/tab_context.py` — `register_tab_context(tab_name, metrics, kind="live")` writes to `st.session_state.current_tab_context`.
- `tests/test_chat_sql_guard.py` — 21 unit tests covering allowed SELECT/CTE forms and rejecting DDL/DML/PRAGMA/ATTACH/chained statements.

**Files modified:** `dashboard/app.py` (launcher wire-up + Dashboard tab context call); all 11 tab render functions in `dashboard/components/` plus the inline Dashboard block (`register_tab_context` call at entry).

**Tools (8):**
- `query_database(sql)` — read-only SELECT only; capped at 200 rows.
- `get_current_regime()` — latest `regimes` row (label, confidence, growth/inflation trends, 4 probabilities).
- `get_signal_status(signal_name?)` — latest signal rows from `signals`.
- `get_recession_probability()` — latest + 1m / 3m / 6m prior `prob_recession`.
- `get_credit_snapshot()` — latest IG/HY/CCC/BB/B OAS plus 10Y UST (returned in both pct and bps).
- `get_market_snapshot(ticker)` — latest close + 1d/5d/1m/YTD return from `market_daily`.
- `get_recent_headlines(limit, min_significance)` — top items from `news_feed` with `regime_interpretation` and `perplexity_research`.
- `explain_current_view()` — reads `st.session_state.current_tab_context`.

**Model:** `claude-sonnet-4-5-20250929` via the official `anthropic` SDK (already in `requirements.txt`).

**API key:** `ANTHROPIC_API_KEY` loaded via `src.config.get_secret` (same pattern as Phase 11 news pipeline). Missing key → FAB silently replaced with a muted "AI Assistant unavailable — API key not configured" caption; no traceback.

**SQL guard:** `is_safe_select` rejects anything that isn't a single `SELECT` (or `WITH … SELECT`) statement. Bans interior `;`, all DDL/DML, PRAGMA, ATTACH/DETACH, VACUUM, REINDEX, TRUNCATE.

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

*Last meaningful update: May 3 2026 — Phase 12 (conversational AI assistant) shipped: floating tab-aware chat with read-only SQL guard, 8 tools, session-only history.*