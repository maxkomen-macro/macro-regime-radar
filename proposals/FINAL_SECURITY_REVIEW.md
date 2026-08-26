# FINAL SECURITY REVIEW — FastAPI backend (`api/`) + assistant path

**Reviewer role:** Independent security reviewer. I implemented none of tonight's work.
**Target:** branch `react-rebuild`, working tree at review time (all work committed locally). HEAD `81b7bd2` ("Phase 4: responsive + table semantics").
**Scope read:** `api/main.py` (1049 L), `api/db.py` (554 L), `api/chat.py` (124 L), `api/bootstrap.py` (140 L), `api/stream.py` (340 L), `api/recession_cache.py`, `api/analytics_cache.py`, `src/analytics/chat.py` (607 L), and the five `src/analytics/*` modules the API imports.
**Method:** direct code read + live read-only probes against the running server on `:8000` + `pytest` on the assistant identity/guard tests. No code changed; no state-changing git, no server control, no Anthropic API calls.
**Background doc:** `proposals/API_SQLGUARD_AUDIT.md` (Aug-17). That audit predates the assistant port — its headline finding "the API has no LLM path" is **now false**. Verified independently; not inherited.

---

## 1. SQL execution inventory

### 1a. Where SQL actually runs

AST/grep confirms every SQL string executed on the API request path lives in **`api/db.py`** (read-only helpers) or in the five **`src/analytics/*`** modules reached by the compute endpoints. `api/main.py`, `api/chat.py`, `api/stream.py`, `api/recession_cache.py`, `api/analytics_cache.py` contain **no `execute(...)` call sites of their own**. The assistant additionally runs SQL through `src/analytics/chat.py`'s tool layer.

**Route count:** 36 HTTP/WS routes + 1 conditional SPA catch-all (`main.py:1041`, no SQL) + **1 new assistant route** `POST /api/assistant/ask` (`api/chat.py:112`) that did not exist at the Aug-17 audit. All are **unauthenticated** (see §2).

### 1b. Per-route SQL source classification

Legend — **static**: server-authored literal, no request data in the string. **user-influenced**: a query param/path value reaches the query, always via bound `?` placeholder. **LLM**: model-generated SQL (assistant only). **conn mode**: `ro` = `file:...?mode=ro` read-only URI; `rw` = plain `sqlite3.connect(DB_PATH)` + `PRAGMA journal_mode=WAL` (a write).

| # | Route | SQL at (file:line) | Source class | Guard / parameterization | conn |
|---|---|---|---|---|---|
| 1 | `GET /health` | — (`db.py:25` `exists()` only) | none | n/a | none |
| 2 | `GET /regime/latest` | `db.py:38` | static | n/a | ro |
| 3 | `GET /signals/latest` | `db.py:48` | static | n/a | ro |
| 4 | `GET /series` | `db.py:69` | static | n/a | ro |
| 5 | `GET /series/latest` | `db.py:77` | static | n/a | ro |
| 6 | `GET /series/{series_id}/latest` | `db.py:88` | **user-influenced** (path) | bound `?` `db.py:91` | ro |
| 7 | `GET /api/regime/latest` | `db.py:38` | static | n/a | ro |
| 8 | `GET /api/regime/history` | `db.py:300–316` | **user-influenced** (`start`,`end`,`limit`) | clauses are literals; values bound `?` `db.py:303–314`; `limit` also `Query(ge=1)` `main.py:665` | ro |
| 9 | `GET /api/signals/latest` | `db.py:265` | static | n/a | ro |
| 10 | `GET /api/priced` | `db.py:171` | static (names from `PRICED_METRICS` const) | bound `?` `db.py:174` | ro |
| 11 | `GET /api/surprises` | `db.py:171` | static (`top_n` slices in Python `db.py:230`) | `top_n` `Query(ge=1,le=15)` `main.py:690` | ro |
| 12 | `GET /api/alerts` | `db.py:320–337` | **user-influenced** (`level`,`alert_type`,`limit`) | bound `?`; `limit` `Query(ge=1,le=500)` | ro |
| 13 | `GET /api/news` | `db.py:349–366` | **user-influenced** (`hours`,`category`,`min_significance`,`limit`) | bound `?`; all four `Query`-bounded `main.py:707–711` | ro |
| 14 | `GET /api/market/daily` | `db.py:411–417` | **user-influenced** (`symbols` CSV, `days`) | generated `?` placeholders from list length; values bound `db.py:417`; `days` `Query(ge=1,le=3650)` | ro |
| 15 | `GET /api/market/intraday` | `db.py:435–450` | **user-influenced** (`symbols` CSV, `since`) | same generated-placeholder pattern; `since` normalized then bound `db.py:447` | ro |
| 16 | `GET /api/calendar` | `db.py:457–463` | **user-influenced** (`days`) | bound as `+N days` modifier `db.py:463`; `Query(ge=1,le=365)` | ro |
| 17 | `GET /api/backtests` | `db.py:472` | static | n/a | ro |
| 18 | `GET /api/credit/oas` | `db.py:507,515` | **user-influenced** (`days`) | bound `?` `db.py:510`; `Query(ge=7,le=3650)` | ro |
| 19 | `GET /api/recession/probability` | `recession.py:42,204,234` | static | n/a — **rw conn `recession.py:34,36`** | **rw** |
| 20 | `GET /api/freshness` | `db.py:542–553` | static (dict of literals) | n/a | ro |
| 21 | `GET /api/regime/intelligence` | `db.py:38`+`credit.py:56`+`recession.py:34` | static | n/a — **rw conns** | **rw** |
| 22 | `GET /api/regime/playbooks` | — (static content) | none | n/a | none |
| 23 | `GET /api/regime/duration` | `intelligence.py:447` | static | n/a — **rw conn** | **rw** |
| 24 | `GET /api/regime/transitions` | `intelligence.py:447` | static | n/a — **rw conn** | **rw** |
| 25 | `GET /api/regime/analogues` | `intelligence.py:447`+`credit.py:56`+`recession.py:34` | static | n/a — **rw conns** | **rw** |
| 26 | `GET /api/regime/scenarios` | — (static `SCENARIOS`) | none | n/a | none |
| 27 | `POST /api/regime/scenario` | `intelligence.py:447` | **user-influenced** (`scenario_key` = dict lookup, never SQL; shocks = `Field(ge,le)` floats `main.py:500–503`) | n/a — **rw conn** | **rw** |
| 28 | `GET /api/credit/metrics` | `credit.py:56` | static | n/a — **rw conn** | **rw** |
| 29 | `POST /api/recession/scenario` | `recession.py:34` (cold train only) | **user-influenced** (5 floats, all `Field(ge,le)`-bounded `main.py:573–577`) → reach **sklearn, not SQL** (`recession_cache.py:103–136`) | n/a — **rw conn on train** | **rw** |
| 30 | `GET /api/lbo/defaults` | `lbo.py:15` conn, static query | static | n/a — **rw conn** | **rw** |
| 31 | `POST /api/lbo/run` | — (pure computation, no DB) | none | inputs `Field(ge,le)`-bounded `main.py:600–608` | none |
| 32 | `GET /api/allocation` | `allocation.py:253,270,297,1429,1446` | static (no args) | n/a — **rw conn `allocation.py:78`** + outbound yfinance network | **rw** |
| 33 | `GET /api/news/latest` | `db.py:377–389` | **user-influenced** (`category`,`limit`) | bound `?`; `limit` `Query(ge=1,le=200)` | ro |
| 34 | `GET /api/calendar/recent` | `db.py:398–404` | **user-influenced** (`limit`) | bound `?` `db.py:403`; `Query(ge=1,le=100)` | ro |
| 35 | `WS /api/stream/ws` | — (in-memory quote hub) | none | n/a | none |
| 36 | `GET /api/stream/debug` | — (in-memory counters) | none | n/a | none |
| 37 | `POST /api/assistant/ask` | `chat.py` tool layer → `src/analytics/chat.py:159` | **LLM** (model-authored SQL via `query_database`) | **`is_safe_select` guard** `chat.py:146` + `mode=ro` conn `chat.py:124` + progress-handler abort + 200-row cap | ro |

**Verdict on user-influenced params (symbols / hours / limit / days / category):** I read every one. There is **no f-string interpolation of a user value into SQL anywhere in `api/db.py`.** The only f-strings that build SQL fragments interpolate either (a) `,`-joined `?` placeholders whose *count* comes from `len(symbols)` — never the symbol text itself (`db.py:411,435`), or (b) fixed column-name constants (`_REGIME_COLS`, `_NEWS_COLS`). Every user value — `series_id`, `start/end/limit`, `level/alert_type`, `hours/category/min_significance`, `symbols` items, `days`, `since`, `top_n` — is passed in the `params` tuple/list and bound by SQLite, or is a `Query(...)`-bounded int/float that never touches the string. The `regime_history` `limit` path (`db.py:313`) does a `.replace('ORDER BY date', ...)` on **server-authored SQL only** (no user text in that string) and binds `limit` as `?`. Injection surface through the data routes: **none found.**

### 1c. The assistant path — guard placement, single-sourcing, bounds

I traced model SQL end-to-end and confirmed the guard sits **between the model and the DB**:

- `POST /api/assistant/ask` (`chat.py:112`) → `_event_stream` → `MacroRadarAgent.ask_streaming` (`src/analytics/chat.py:505`).
- When the model emits a `query_database` tool_use, the loop dispatches through `_TOOL_IMPLS["query_database"]` (`chat.py:557,562`) → `_tool_query_database` (`chat.py:145`).
- `_tool_query_database` calls **`is_safe_select(sql)` first (`chat.py:146`)** and returns a guard-error dict *before opening any connection* if it fails. Only on pass does it open `_ro_conn()` (`chat.py:124`, `file:...?mode=ro`).
- Guard (`is_safe_select`, `chat.py:94–117`): strips trailing `;`, rejects any interior `;` (statement chaining), rejects a forbidden-keyword regex covering `insert|update|delete|drop|alter|replace|create|attach|detach|vacuum|pragma\w*|reindex|truncate|randomblob|zeroblob|load_extension`, and requires the statement to open with `select` or `with`. `pragma\w*` also kills table-valued `pragma_*()` forms; `randomblob`/`zeroblob` are blocked as per-cell memory-exhaustion vectors the row cap can't bound.

**`api/chat.py` imports the guard, does not copy it — pytest evidence.** Ran the identity test the brief specifies:

```
$ .venv/bin/python -m pytest tests/test_api.py -k assistant -q
....                                                                     [100%]
4 passed, 41 deselected in 0.58s
```

The passing `test_assistant_guard_identity_no_local_copy` asserts `api.chat` carries **no** `_FORBIDDEN_KEYWORDS`, `is_safe_select`, or `_tool_query_database` symbol of its own, that `chat._TOOL_IMPLS["query_database"] is chat._tool_query_database`, and that `_tool_query_database.__module__ == "src.analytics.chat"`. `test_assistant_tool_layer_rejects_hostile_sql` drives 5 hostile strings (`SELECT 1; DROP TABLE regimes`, `PRAGMA table_info(...)`, `SELECT load_extension('x')`, `SELECT randomblob(999999999)`, `INSERT ...`) through the same dispatch table the endpoint uses and confirms each returns a `SQL guard:`-prefixed error. **The Streamlit-era hardened guard is single-sourced and load-bearing on the HTTP path — the hole the dashboard closed is not reintroduced.**

**Execution bound (~20M-instruction cap):** `_tool_query_database` installs a SQLite progress handler (`chat.py:157`) firing every `_QUERY_PROGRESS_PERIOD = 10_000` VM instructions with a `_QUERY_PROGRESS_BUDGET = 2_000` callback budget → the query is interrupted after ~20M instructions (`chat.py:141–142,150–163`). This guards runaway `WITH RECURSIVE` bombs the keyword filter cannot see. Confirmed present and wired into a `try/finally` that clears the handler.

**200-row cap:** `cur.fetchmany(200)` (`chat.py:160`) — the model can never pull more than 200 rows per call regardless of `LIMIT`.

**Iteration cap:** `MAX_TOOL_ITERATIONS = 10` (`chat.py:74`, loop `chat.py:521`) bounds tool round-trips per request.

### 1d. Every write-capable connection in the API's import closure

The read-only contract holds for `api/db.py` (all `ro`) and the assistant (`ro`). But **12 GET/POST routes reach `src/analytics/*` helpers that open a plain read-write connection and execute `PRAGMA journal_mode=WAL` — a write to the DB file and its `-wal`/`-shm` sidecars.** The five helpers:

| Helper | file:line | Reached by routes |
|---|---|---|
| `recession._get_conn` | `recession.py:34,36` | 19, 21, 25, 29 |
| `credit.*` conn | `credit.py:56,58` | 21, 25, 28 |
| `intelligence.*` conn | `intelligence.py:447,449` | 23, 24, 25, 27 |
| `allocation.*` conn | `allocation.py:78,80` | 32 |
| `lbo.*` conn | `lbo.py:15,17` | 30 |

**Judgement:** These are **not SQL-injection risks** — every query in these modules is a static literal or a bound `?` (I grepped for `INSERT/UPDATE/DELETE/CREATE/to_sql/executemany` in all five and found **none**; they only `SELECT`). The concern is **integrity/robustness, not injection**:

1. **They defeat the DB-swap tolerance the architecture relies on.** `api/bootstrap.py` swaps the DB via `os.replace()` mid-flight; `api/db.py`'s per-request `mode=ro` connections tolerate that. A read-write WAL connection opened against the file being swapped can leave `-wal`/`-shm` sidecars, and if the deploy filesystem is read-only (a hardened container) `PRAGMA journal_mode=WAL` **fails outright**, turning routes 19/21/23/24/25/27/28/29/30/32 into 500s. This is a latent availability bug, not a breach.
2. **They are documented and deliberate** (`recession_cache.py:9–11`, `analytics_cache.py:16` both cite the CLAUDE.md WAL exception, matching what Streamlit always did). Accepted as-is, but the CLAUDE.md claim that "the API opens a fresh read-only connection per request" is **true of `api/db.py`, false of the API as a whole** — worth correcting in docs.

No write-capable connection is reachable by attacker-controlled SQL; the model's SQL only ever reaches the `mode=ro` connection behind the guard.

---

## 2. Public-exposure assessment (backend intended to go public)

### 2a. Authentication — there is none, on anything

**Every one of the 37 routes is unauthenticated.** Stated plainly: no API key, no bearer token, no session, no `Depends(...)` security dependency exists anywhere in `api/`. Grep for `Depends|Security|APIKey|Authorization` in `api/*.py` returns only the outbound `Authorization: Bearer` header `bootstrap.py` sends **to GitHub** — nothing inbound. Anyone who can reach the origin can call every data route, every compute route, the WS stream, `/api/stream/debug`, and **`POST /api/assistant/ask`** (which spends Anthropic tokens).

### 2b. CORS

`main.py:123–128`: `allow_origins=CORS_ORIGINS` (env `CORS_ORIGINS` comma-split, else the two Vite dev origins), `allow_methods=["GET","POST"]`, `allow_headers=["*"]`. `allow_credentials` is **not set** (defaults to `False`) — correct, since there are no cookies/credentials to protect, and it means the `["*"]` header allowance cannot be combined with credentialed wildcarding. **CORS is not a security boundary here anyway** — it only constrains browser JS from other origins; it does nothing against `curl`/scripted clients, which reach every route regardless. Do not treat CORS as access control. The env override (`main.py:49–51`) is sound: it *replaces* rather than appends, so a split deploy sets exactly the Vercel origin.

### 2c. Injection surfaces in user-influenced params

Covered in §1b: **none.** No f-string SQL with user input. All bound. The compute POSTs (`/api/regime/scenario`, `/api/recession/scenario`, `/api/lbo/run`) take only `Field(ge,le)`-bounded numeric inputs or a dict-key lookup — no string reaches SQL, sklearn, or a shell.

### 2d. Error / stack-trace leakage

- **FastAPI debug mode:** off (no `debug=True`, no `reload=` in app construction). Unhandled exceptions return the framework's generic 500 with no traceback in the body. Good.
- **`_guarded` 503s (`main.py:133–138`):** `detail=str(exc)` where `exc` is `db.DBUnavailable` — the message is a fixed `"Database not found at {DB_PATH}"`. Leaks the **absolute server DB path**. Low severity; cosmetic infoleak.
- **`/api/allocation` (`main.py:966–979`):** `detail=f"...dependency missing: {exc.name}..."` and `detail=f"...{type(exc).__name__} while..."` — leaks a missing module name and an exception class name. Low severity.
- **Assistant `AgentError` echo (`chat.py:103`):** `yield _sse({"message": f"_AI assistant error: {exc}_"}, event="error")`. **This is the real leak.** `AgentError` is raised on `anthropic.APIStatusError` as `AgentError(f"Anthropic API error: {exc}")` (`src/analytics/chat.py:539`). The Anthropic SDK's `APIStatusError.__str__` includes the upstream **request-id, HTTP status, and error body (which names the model, e.g. `claude-sonnet-4-5-20250929`)**. So an unauthenticated caller can surface: the model ID in use, Anthropic request-ids, and raw upstream error text — useful reconnaissance and confirmation the org has a paid Anthropic account. `RateLimited`/`NetworkError` frames are fixed strings (fine); only the `AgentError` branch and the last-resort `Exception` branch (fixed string, fine) matter. **Genericize the `AgentError` echo** — log the detail server-side, return a fixed message to the client.

### 2e. The LLM endpoint as a billing-DoS vector — quantified

`POST /api/assistant/ask` is **unauthenticated, unthrottled, and unbounded in input size.** Request model (`chat.py:39–42`):

```python
message: str = Field(min_length=1)          # min only — NO max_length
history: list[ChatTurn] = Field(default=[]) # NO max length; each .content is unbounded str
tab_context: dict[str, Any] | None = None   # arbitrary; echoed into model context via explain_current_view
```

Attack surface, each independently a problem:

1. **No `max_length` on `message`** — a single request can carry hundreds of KB of prompt text.
2. **No length cap on the `history` list, and no per-item content cap.** `HISTORY_TURN_LIMIT` trims to the last 40 entries **only after** Pydantic has parsed the entire list into memory (`src/analytics/chat.py:517`) — so an attacker posting a 100k-element `history` causes a large **memory allocation on parse** before any trim, independent of token cost.
3. **`tab_context` is echoed into the model's context** via `explain_current_view` (`src/analytics/chat.py:295–299`, ContextVar set per-pull in `chat.py:91`) — another unbounded attacker-controlled string into the paid prompt.
4. **Full history is re-sent every iteration.** The loop resends the accumulating `messages` array up to `MAX_TOOL_ITERATIONS = 10` times, so input tokens are billed ~10× the (already unbounded) prompt.
5. **Thread-pool starvation.** The route is sync `def` and returns a **sync** SSE body iterator (`chat.py:113,120`), so Starlette runs it on the anyio worker thread pool (**default 40 tokens**). Each in-flight assistant request holds one thread for the entire multi-second, up-to-10-round-trip Anthropic exchange. **~40 concurrent slow requests exhaust the pool and starve every other sync route** — and all the `api/db.py` data routes are sync `def` too, so the whole API stalls. A cheap availability DoS needing only ~40 held connections, no auth.

**Worst-case spend per single request** (model `claude-sonnet-4-5-20250929`; standard Sonnet-4.5 tier is $3 / $15 per 1M input/output tokens — the bundled `claude-api` model reference lists it Active but does not carry the price line, so confirm against current Anthropic pricing before quoting a dollar figure externally):

- **Output:** `MAX_TOKENS = 2000` per API call × `MAX_TOOL_ITERATIONS = 10` = up to **20,000 output tokens** → ~**$0.30**.
- **Input (dominant):** attacker fills the prompt toward the model's context window and it is re-sent each iteration. At, say, ~150–200K input tokens re-sent across the iterations you reach **on the order of 1–2M input tokens** → ~**$3–$6 per request** for input alone, and it climbs with each tool round-trip.
- **Aggregate:** roughly **$3–$6+ per single unauthenticated request**, with **no per-IP/global rate limit and unbounded concurrency** — i.e. spend scales linearly with request volume an attacker chooses. This is the single highest-impact finding.

**Must-fix list for this endpoint (before any public exposure):** (a) auth or a shared-secret gate; (b) rate limit (per-IP and global); (c) `max_length` on `message`, a `max_items` on `history` **and** a per-item content cap (enforced in the Pydantic model so the cap runs before the list is fully materialized where possible), and a size bound on `tab_context`; (d) move the endpoint to `async def` with the Anthropic call offloaded via `run_in_threadpool`/an async client, or raise the anyio thread-pool limit and add a concurrency semaphore, to remove the ~40-thread starvation ceiling; (e) genericize the `AgentError` echo (§2d).

### 2f. `/api/stream/debug` info exposure

`main.py:1014–1023` returns `stream.hub.feeds` (feed states), client count, `symbols_stored`, and `stream.hub.stats` (frame counts, connect counts, `feed_last_error`, ticks stored/flushed). Live probe returned exactly that — **no secrets**. The EODHD token is loaded into `hub.token` (`stream.py:99`) and **never** placed in `feeds`/`stats`; the stream even has a `_redact()` that scrubs the token from any error text (`stream.py:143`, used at `:227`). `feed_last_error` is redacted repr. **Harmless from a secrets standpoint**, but it is an unauthenticated ops-introspection surface (confirms the org runs a live EODHD feed and how busy it is). Recommend gating it behind the same auth as the rest, or dropping it in production — **should-fix, not must-fix**.

### 2g. `/docs` + `/openapi.json`

Live probe: `GET /docs` → **200**, `GET /openapi.json` → **200**. The full interactive schema of all 36 documented routes (params, bounds, response models) is public. This is reconnaissance-useful (it enumerates every param and its bounds for an attacker) but exposes no secret and no undocumented capability. **Recommend gating both behind auth or disabling in production** (`FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` when a prod flag is set) — **should-fix**; acceptable to ship if auth lands first, since auth then also covers docs.

### 2h. DB bootstrap `GH_DB_TOKEN` handling (`api/bootstrap.py`)

Read in full:

- **Token read from env only** (`_token()`, `bootstrap.py:38–39`); never from a query param or request.
- **Never logged.** Startup logs presence as `"GH_DB_TOKEN yes/no"` (`main.py:80`), and `refresh_db` logs `"GH_DB_TOKEN not set — ... skipped"` (`bootstrap.py:80`) — value never in a log line. Confirmed by reading every `log.` call in the module.
- **Header-only auth:** sent as `Authorization: Bearer {token}` to the GitHub API and asset URL (`bootstrap.py:87,94,115`) — never in a URL/query string.
- **Redirect behavior is correct:** `httpx.Client(follow_redirects=True)`; the comment at `bootstrap.py:105–107` notes httpx drops the `Authorization` header on the cross-host redirect to the signed CDN URL, so the token is **not** re-sent to the CDN. This matches httpx's documented same-origin header-stripping on redirect. No token leakage to the asset CDN.
- Download is atomic (temp file beside `DB_PATH` + `os.replace`), so readers never see a torn file.

**No issue.** Token handling is clean.

---

## 3. Secrets & artifacts

All checks run; evidence pasted.

**`.env` never committed:**
```
$ git log --all --oneline -- .env
(empty — no output)
```

**Tracked env/secrets/db files:**
```
$ git ls-files | grep -E "\.env|secrets|\.db$"
.env.example
.streamlit/secrets.toml.example
data/macro.db
```
Only the two `*.example` templates are the expected safe ones. **`data/macro.db` is tracked** — but it is a **0-byte empty file** (committed `4bc9949` "Phase 1 + Phase 2", `git cat-file -s` = 0, `sqlite3 ".tables"` returns nothing). It is **not** the live `data/macro_radar.db` store and holds no data. Cosmetic wart (a stray empty file), not a secrets exposure. The live DB is a different filename.

**`data/macro_radar.db` untracked and ignored:**
```
$ git ls-files --error-unmatch data/macro_radar.db
error: pathspec 'data/macro_radar.db' did not match any file(s) known to git   # → untracked
$ git check-ignore -v data/macro_radar.db .env
.gitignore:19:data/macro_radar.db   data/macro_radar.db
.gitignore:1:.env                    .env
```
Both the live DB and `.env` are gitignored. Good.

**Secret variable names are only presence-checked / env-read, never printed:**
```
$ grep -rn "ANTHROPIC_API_KEY\|EODHD_API_TOKEN\|GH_DB_TOKEN" api/ src/analytics/chat.py
api/stream.py:70,77,125     EODHD_API_TOKEN — os.environ.get / .env line-parse / "not set" warning
api/bootstrap.py:39,80      GH_DB_TOKEN     — os.environ.get / "not set" log
api/main.py:61              get_secret("ANTHROPIC_API_KEY")            (presence bool)
api/main.py:80,81,82        log "GH_DB_TOKEN/EODHD_API_TOKEN/ANTHROPIC_API_KEY: yes/no"  (presence only)
src/analytics/chat.py:492   api_key = get_secret("ANTHROPIC_API_KEY")  (assignment, not logged)
src/analytics/chat.py:494   raise if not set                           (presence)
```
I read each hit. **Every one is an env-read, a `.env` line parse, a presence boolean, or a "yes/no" log — no branch prints or logs an actual secret value.** `stream.py` even carries `_redact()` (`:143`) to scrub the EODHD token out of error reprs. The three `get_secret` paths (`src/analytics/chat.py:33–60`) parse `.env` in-process and the docstrings note the value "never leaves this process." Clean.

**Dockerfile / .dockerignore exclude `.env` and the DB:**
- `.dockerignore` excludes `**/.env*`, `data`, `data/*.db*`, `.streamlit`, plus `.git`, `tests`, `proposals`, `docs`, `.claude`, `scripts`, `*.md`, `__pycache__`. Secrets and the local DB cannot enter the build context.
- `Dockerfile` stage 2 copies only `api/`, `src/`, `requirements-api.txt`, and the built `web/dist` from stage 1. Comments confirm `.env` and `data/*.db` are deliberately **not** copied (secrets via host secret store; DB via `GH_DB_TOKEN` bootstrap at startup). `CMD` runs plain `uvicorn` (no `--reload`, no debug).

**No secret is committed, logged, or shipped in the image.**

---

## 4. VERDICT

> **Safe to deploy publicly as-is: NO.**

The SQL posture is genuinely good — zero injection surface across all 36 data/compute routes (every user value bound or numerically bounded), and the assistant's LLM-generated SQL is gated by the single-sourced, un-weakened `is_safe_select` guard sitting between the model and a `mode=ro` connection, with a ~20M-instruction abort and a 200-row cap (pytest-verified, 4 passed). Secrets and artifacts are clean. **But the backend is entirely unauthenticated, and it now includes a metered LLM endpoint with no auth, no rate limit, and no input-size caps — an open-ended billing-and-availability DoS.** That gates public deployment.

### Must fix BEFORE any public exposure (ordered by exploitability × impact)

1. **Gate `POST /api/assistant/ask` with auth or a shared secret.** Highest impact: unauthenticated, metered, ~$3–$6+ Anthropic spend per request, unbounded concurrency. Nothing else on this list matters if this stays open.
2. **Rate-limit the assistant endpoint (per-IP and global).** Even with auth, cap request rate and concurrent in-flight assistant calls; add a concurrency semaphore.
3. **Add input-size caps to the assistant request model:** `max_length` on `message`, `max_items` on `history` + a per-turn content-length cap, and a size bound on `tab_context`. Closes both the token-cost amplifier and the pre-trim memory-allocation vector.
4. **Fix the thread-pool starvation:** make `/api/assistant/ask` `async def` with the Anthropic round-trip offloaded (async client or `run_in_threadpool` behind a semaphore), or raise the anyio thread-pool limit — otherwise ~40 held connections stall the entire sync API.
5. **Genericize the `AgentError` SSE echo** (`api/chat.py:103`): stop returning raw Anthropic `APIStatusError` text (request-id, model name, upstream body) to unauthenticated callers; log server-side, return a fixed message.
6. **Authenticate the backend as a whole** (all 36 data/compute routes). Lower per-call impact than the LLM route, but the compute routes (`/api/allocation` triggers outbound yfinance downloads; recession/intelligence/credit train a model or open rw WAL connections) are unauthenticated CPU/network amplifiers. Put every route behind the same gate.

### Should fix soon (not a hard blocker if auth lands first)

- **Disable or gate `/docs`, `/redoc`, `/openapi.json` in production** (auth covers them once #6 lands; otherwise `docs_url=None` behind a prod flag).
- **Gate or drop `/api/stream/debug`** — unauthenticated ops introspection (no secrets, but reveals live feed activity).
- **Genericize the `_guarded` 503 and `/api/allocation` error details** — they leak the absolute DB path and module/exception names (low severity).
- **Reconcile the `src/analytics/*` read-write WAL connections with the deploy model** (12 routes): they defeat the DB-swap tolerance and will 500 on a read-only container filesystem. Not a breach; an availability/integrity latent bug. Also correct the CLAUDE.md claim that the whole API is read-only per request.
- **Remove the stray tracked 0-byte `data/macro.db`** (not the live store; just clutter that invites confusion with the gitignored `data/macro_radar.db`).

### Independent confirmation of the Phase-6 reviewer's cost/exposure list

The Phase-6 reviewer's hand-off list — "auth, rate limit, size caps, genericized error echo, thread-pool starvation" (`proposals/OVERNIGHT_BUILD_LOG.md:177–179`) — I verified each **independently against the code**, not by inheritance: auth absent (grep, §2a); no rate limiter (grep, §2e); no `max_length`/list caps (`chat.py:39–42`, §2e); raw `AgentError` echo (`chat.py:103` → `src/analytics/chat.py:539`, §2d); sync-route thread-pool starvation (`chat.py:113,120`, §2e). **All five confirmed real.** My review adds three the list did not itemize: the pre-trim `history` memory-allocation vector (#3), the 12 read-write WAL connections' deploy-fragility (§1d), and the public `/docs`+`/openapi.json` and `/api/stream/debug` surfaces.

---

*Report written to `proposals/FINAL_SECURITY_REVIEW.md`. Read-only review; no code, git state, servers, or Anthropic APIs were touched.*
