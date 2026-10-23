---
paths:
  - "src/analytics/chat.py"
  - "api/chat.py"
  - "api/assistant_budget.py"
  - "dashboard/components/chat_widget.py"
  - "dashboard/utils/tab_context.py"
  - "web/src/screens/shell/AssistantPanel.tsx"
  - "tests/test_chat_sql_guard.py"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

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

**Model:** `claude-sonnet-4-5-20250929` via the official `anthropic` SDK (already in `requirements.txt`).

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
