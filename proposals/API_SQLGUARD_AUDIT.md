# FastAPI Backend — SQL Guard & Public-Exposure Audit

**Target:** branch `react-rebuild` @ `6a88cb5` ("React rebuild + FastAPI v1.3.0 (WIP from 3 overnight sessions; not deployed)")
**Scope:** `api/main.py`, `api/db.py`, `api/stream.py`, `api/analytics_cache.py`, `api/recession_cache.py`, plus every `src/analytics/*` module they reach.
**Date:** 2026-08-17 · Read-only audit. **No code was changed.** Findings are proposals only.

Method note: the working tree sits on `main`; every file below was read out of `react-rebuild` via `git show` rather than by checking the branch out. Line numbers are `react-rebuild` line numbers.

---

## 1. Verdict

> **The FastAPI backend has no LLM/chat path at all — there is nothing for the guard to protect, so the Streamlit hole was not reintroduced. Every one of the 36 routes runs developer-written SQL with all user input bound as parameters. But it is NOT safe to deploy publicly as-is: all 36 routes are unauthenticated, ten of them open the DB read-write, and several are unauthenticated compute/network amplifiers.**

The specific worry that motivated this audit — *"does the rebuild reintroduce the hole the Streamlit work closed?"* — resolves **negative, and for a structural reason rather than a lucky one**: the chat feature was never ported. `src/analytics/chat.py` (which owns `MacroRadarAgent` and the hardened `is_safe_select`) is imported by the Streamlit widget only. `api/` contains zero references to it, and the `anthropic` SDK is not even in `requirements-api.txt`, so the API environment cannot construct the agent.

The real blockers are elsewhere, and one of them is arguably worse than the SQL question: **the backend is fully open**. Two corrections to the premises in the brief, both in the operator's favour and both worth knowing:

- **There is no Anthropic billing-DoS vector on this backend today.** No route calls an LLM. That risk arrives with the chat migration, not before.
- **The claim in `CLAUDE.md` that "`api/db.py` opens a fresh read-only connection per request" is true of `api/db.py` but not of the API as a whole.** Ten routes reach `src/analytics/*` modules that open plain read-write connections and execute `PRAGMA journal_mode=WAL` — a write. See Finding 2.

---

## 2. Route → SQL map

All 36 routes. **SQL source class:** `static` = developer-written literal, no request data in the string; `user-influenced` = a request value reaches the query (all such cases are bound `?` parameters); `LLM` = model-generated SQL. **Guard status:** `n/a (bound)` means no guard is needed because the value can never be parsed as SQL.

### Unprefixed group (Atlas contract)

| # | Route | Handler | SQL executed at | Source class | Guard status |
|---|---|---|---|---|---|
| 1 | `GET /health` | `main.py:104` | — (file `exists()` only, `db.py:24`) | none | n/a |
| 2 | `GET /regime/latest` | `main.py:109` | `db.py:38` | static | n/a |
| 3 | `GET /signals/latest` | `main.py:117` | `db.py:48` | static | n/a |
| 4 | `GET /series` | `main.py:125` | `db.py:69` | static | n/a |
| 5 | `GET /series/latest` | `main.py:130` | `db.py:77` | static | n/a |
| 6 | `GET /series/{series_id}/latest` | `main.py:135` | `db.py:88` | **user-influenced** (path param) | n/a (bound `?`, `db.py:91`) |

### `/api/*` group (React migration)

| # | Route | Handler | SQL executed at | Source class | Guard status |
|---|---|---|---|---|---|
| 7 | `GET /api/regime/latest` | `main.py:581` | `db.py:38` | static | n/a |
| 8 | `GET /api/regime/history` | `main.py:586` | `db.py:316` | **user-influenced** (`start`,`end`,`limit`) | n/a (clauses are literals; values bound, `db.py:299–316`) |
| 9 | `GET /api/signals/latest` | `main.py:596` | `db.py:265` | static | n/a |
| 10 | `GET /api/priced` | `main.py:607` | `db.py:171` | static (names from `PRICED_METRICS`, `db.py:138`) | n/a (bound) |
| 11 | `GET /api/surprises` | `main.py:614` | `db.py:171` | static (`top_n` slices in Python, `db.py:230`) | n/a (bound) |
| 12 | `GET /api/alerts` | `main.py:621` | `db.py:337` | **user-influenced** (`level`,`alert_type`,`limit`) | n/a (bound, `db.py:320–337`) |
| 13 | `GET /api/news` | `main.py:631` | `db.py:366` | **user-influenced** (`hours`,`category`,`min_significance`,`limit`) | n/a (bound, `db.py:341–366`) |
| 14 | `GET /api/market/daily` | `main.py:642` | `db.py:413` | **user-influenced** (`symbols` CSV, `days`) | n/a (generated `?` placeholders, `db.py:411`; values bound, `db.py:417`) — but see Finding 8 |
| 15 | `GET /api/market/intraday` | `main.py:654` | `db.py:450` | **user-influenced** (`symbols` CSV, `since`) | n/a (same pattern, `db.py:435–450`) — see Finding 8 |
| 16 | `GET /api/calendar` | `main.py:666` | `db.py:457` | **user-influenced** (`days`) | n/a (bound as `+N days` modifier, `db.py:463`) |
| 17 | `GET /api/backtests` | `main.py:672` | `db.py:472` | static | n/a |
| 18 | `GET /api/credit/oas` | `main.py:678` | `db.py:507`, `db.py:515` | **user-influenced** (`days`) | n/a (bound, `db.py:510`) |
| 19 | `GET /api/recession/probability` | `main.py:688` | `recession.py:42`, `:204`, `:234` | static | n/a — **but read-write conn, `recession.py:34,36`** (Finding 2) |
| 20 | `GET /api/freshness` | `main.py:700` | `db.py:553` | static (dict of literals, `db.py:542–549`) | n/a |
| 21 | `GET /api/regime/intelligence` | `main.py:710` | `db.py:38` + `credit.py:56` + `recession.py:34` | static | n/a — **read-write conns** (Finding 2) |
| 22 | `GET /api/regime/playbooks` | `main.py:720` | — (static content, `analytics_cache.py:216`) | none | n/a |
| 23 | `GET /api/regime/duration` | `main.py:728` | `intelligence.py:447` | static | n/a — **read-write conn** (Finding 2) |
| 24 | `GET /api/regime/transitions` | `main.py:735` | `intelligence.py:447` | static | n/a — **read-write conn** (Finding 2) |
| 25 | `GET /api/regime/analogues` | `main.py:742` | `intelligence.py:447` + `credit.py:56` + `recession.py:34` | static | n/a — **read-write conns** (Finding 2) |
| 26 | `GET /api/regime/scenarios` | `main.py:749` | — (static `SCENARIOS`, `analytics_cache.py:227`) | none | n/a |
| 27 | `POST /api/regime/scenario` | `main.py:757` | `intelligence.py:447` | **user-influenced** (`scenario_key`, shocks) — `scenario_key` is a **dict lookup, never SQL** (`analytics_cache.py:239`); shocks are `Field(ge=,le=)`-bounded floats (`main.py:425–428`) | n/a — **read-write conn** (Finding 2) |
| 28 | `GET /api/credit/metrics` | `main.py:780` | `credit.py:56` | static | n/a — **read-write conn** (Finding 2) |
| 29 | `POST /api/recession/scenario` | `main.py:795` | `recession.py:34` (on cold model train only) | **user-influenced** (5 floats, all `Field(ge=,le=)`-bounded, `main.py:498–502`) — reach **sklearn, not SQL** (`recession_cache.py:117–136`) | n/a — **read-write conn on train** (Finding 2) |
| 30 | `GET /api/lbo/defaults` | `main.py:825` | `lbo.py:15` (conn), static query | static | n/a — **read-write conn** (Finding 2) |
| 31 | `POST /api/lbo/run` | `main.py:837` | — (pure computation, no DB) | none | n/a — see Finding 3 |
| 32 | `GET /api/allocation` | `main.py:877` | `allocation.py:253,270,297,1429,1446` | static (`get_allocation_data()` takes no arguments, `allocation.py:1268`) | n/a — **read-write conn `allocation.py:78`** + outbound network (Findings 2, 3) |
| 33 | `GET /api/news/latest` | `main.py:909` | `db.py:389` | **user-influenced** (`category`,`limit`) | n/a (bound, `db.py:377–389`) |
| 34 | `GET /api/calendar/recent` | `main.py:920` | `db.py:398` | **user-influenced** (`limit`) | n/a (bound, `db.py:403`) |
| 35 | `WS /api/stream/ws` | `main.py:931` | — (no SQL; in-memory quote hub) | none | n/a — see Finding 4 |
| 36 | `GET /api/stream/debug` | `main.py:938` | — (in-memory counters) | none | n/a — see Finding 5 |

**LLM-sourced SQL rows in this table: zero.**

### Mechanical corroboration

Reading alone is not proof, so I AST-scanned every `execute` / `executemany` / `executescript` / `read_sql*` call site in the `api/` package and classified its first argument:

- **19 call sites, all in `api/db.py`.** `api/main.py`, `api/stream.py`, `api/analytics_cache.py`, and `api/recession_cache.py` contain **no SQL execution at all**.
- 13 are constant literals; 5 are a `sql` local assembled from literal fragments (`db.py:316, 337, 366, 389, 450`); 1 is an f-string (`db.py:413`).
- The single f-string interpolates only `placeholders` — a string of `?` characters generated by `",".join("?" for _ in symbols)` (`db.py:411`). Symbol *values* never enter the string; they are passed as the parameter sequence at `db.py:417`.
- `executescript` (the multi-statement API) is **never called** anywhere in `api/`.

No string concatenation, `%`-formatting, or `.format()` of request data into SQL exists in the backend.

---

## 3. Guard parity (question C)

Not applicable in the strict sense — the API runs no model-generated SQL, so no guard is wired in and none is currently required. For the record, here is the guard the Streamlit path uses, so a future migration has the reference:

`src/analytics/chat.py:42` `is_safe_select()`, with `_FORBIDDEN_KEYWORDS` at `chat.py:36–40`:

```
insert|update|delete|drop|alter|replace|create|attach|detach|
vacuum|pragma\w*|reindex|truncate|randomblob|zeroblob|load_extension
```

Confirmed present on `react-rebuild` — `git branch --merged react-rebuild` lists `fix/chat-sql-guard-hardening`, and `src/analytics/chat.py` is **byte-identical between `main` and `react-rebuild`** (`git diff main..react-rebuild -- src/analytics/chat.py` is empty). The hardened behaviours the brief asked about are all in place:

| Protection | Mechanism | Location |
|---|---|---|
| `pragma_table_info()` and other table-valued PRAGMA forms | `pragma\w*` (the `\w*` is what catches the `pragma_`-prefixed TVFs) | `chat.py:38` |
| Blob memory-exhaustion DoS | `randomblob`, `zeroblob` | `chat.py:39` |
| `load_extension` | keyword ban | `chat.py:39` |
| Multi-statement chaining | one trailing `;` stripped, then any remaining `;` rejects | `chat.py:57–58` |
| Non-SELECT statements | first token must be `select` or `with` | `chat.py:64–65` |
| DDL/DML | keyword ban | `chat.py:36–40` |

Backed by 27 tests in `tests/test_chat_sql_guard.py` (matches the 27/27 in the brief).

**Parity gap that matters:** `tests/test_api.py` (517 new lines on this branch) contains **no** test referencing chat, injection, or the guard. Nothing in the API suite would fail if a future commit added an unguarded chat endpoint. That is Finding 9.

---

## 4. Findings

### Finding 1 — Every route is unauthenticated · **HIGH** · CONFIRMED

**Mechanism.** `api/main.py` registers exactly one piece of middleware — `CORSMiddleware` at `main.py:48`. There is no `Depends`, no `HTTPBearer`, no `APIKeyHeader`, no `Security(...)`, no auth middleware anywhere in the file. All 36 routes are open to any caller who can reach the port.

**`file:line`.** `api/main.py:37–53` (app + middleware construction); absence verified across the whole file.

**Why it's worse once public.** The Streamlit app was effectively single-user on localhost, so "no auth" cost nothing. Published, `/api/*` becomes an open read API over the full contents of `macro_radar.db` — news with Anthropic-generated `regime_interpretation` and Perplexity `perplexity_research` text (paid enrichment, `db.py:352`), full backtest results, and every model output. CORS does **not** mitigate this: it is a browser-enforced policy, and `curl` ignores it entirely. The allow-list at `main.py:50` will stop a third-party *web page* from reading responses; it stops no direct client.

**Proposed fix.** Decide the posture first, because it changes the size of the job:
- *If the data is meant to be public* (it backs a portfolio dashboard aimed at recruiters — plausible): leave the read endpoints open and treat rate limiting (Finding 3) as the real control. Small.
- *If not*: a single shared-secret header dependency applied at the `APIRouter(prefix="/api")` level (`main.py:147`) covers all 30 `/api` routes in one edit, plus the 6 unprefixed Atlas routes separately. Small wiring change; the awkward part is the WebSocket, which needs the token in the query string or a subprotocol.

**Risk note.** Low-risk change. Adding a router-level dependency does not touch query logic. The Atlas consumer contract (`main.py:5–6` warns against changing it) is field names, not headers, so auth can be added without breaking it — but Atlas would need the credential.

---

### Finding 2 — Ten routes open the database read-write and write to it · **MEDIUM** · CONFIRMED

**Mechanism.** `api/db.py` is scrupulous: `sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)` at `db.py:31`, fresh per call, closed immediately. But the routes that delegate to `src/analytics/*` bypass `api/db.py` entirely, and every one of those modules opens a **plain read-write connection and then executes a write**:

| Module | Connect | Write |
|---|---|---|
| `src/analytics/recession.py` | `:34` `sqlite3.connect(DB_PATH)` | `:36` `PRAGMA journal_mode=WAL` |
| `src/analytics/intelligence.py` | `:447` | `:449` |
| `src/analytics/credit.py` | `:56` | `:58` |
| `src/analytics/regimes.py` | `:29` | `:31` |
| `src/analytics/allocation.py` | `:78` | `:80` |
| `src/analytics/lbo.py` | `:15` | `:17` |

`PRAGMA journal_mode=WAL` is not a read: it rewrites the database header and creates `-wal`/`-shm` sidecar files. Affected routes: #19, #21, #23, #24, #25, #27, #28, #29, #30, #32.

This is *documented* rather than accidental — `api/recession_cache.py:9–11` and `api/analytics_cache.py:15–17` both call it a "deliberate deviation… identical to what the Streamlit dashboard has always done." That reasoning was sound for a single-user local dashboard. It does not survive the move to a public backend, and it makes the `CLAUDE.md` line "the API opens a fresh read-only connection per request" true only of `api/db.py`.

**Why it's worse once public.** Three ways. (a) The read-only guarantee the audit was asked to confirm does not hold end-to-end — any anonymous request to `/api/credit/metrics` opens a writable handle to the DB. (b) The DB is a downloaded Release asset swapped by the refresh workflows; long-lived write handles and stray `-wal` files complicate that swap. (c) If the deploy target mounts the filesystem read-only (a common and otherwise-good hardening choice), these ten routes fail at `PRAGMA` time with an unhandled `sqlite3.OperationalError` → HTTP 500, while the `api/db.py` routes keep working. That is a confusing half-broken deploy.

To be precise about severity: **no request data reaches these queries** — they are all static SQL (verified: `allocation.get_allocation_data()` takes no arguments, `allocation.py:1268`). This is not an injection or data-tampering path. It is a violated invariant plus a deploy-fragility bug, which is why it is Medium and not High.

**Proposed fix.** Two options:
- *Minimal:* leave the modules alone and mount the DB file read-only at the OS level, accepting that these ten routes will 500. Not recommended — silent partial failure.
- *Correct:* give the six `src/analytics` modules the same `file:...?mode=ro` URI connection `api/db.py` uses, and drop the `PRAGMA journal_mode=WAL` line (WAL is a persisted database property; a reader does not need to set it).

**Risk note.** Medium, and larger than it looks — these six modules are **shared with the live Streamlit app and the memo workflows**. Changing their connection helper changes behaviour in the currently-deployed product. Safer shape: add an opt-in read-only parameter (or an env flag the API sets) rather than changing the default, so Streamlit's behaviour is untouched. That keeps Finding 5 (Streamlit unaffected) true after the fix.

---

### Finding 3 — Unauthenticated compute and outbound-network amplifiers · **HIGH** · CONFIRMED

**Mechanism.** Several open routes do far more work than a typical read:

| Route | Cost per cold request | `file:line` |
|---|---|---|
| `GET /api/allocation` | **Outbound `yfinance` downloads, ~30–60 s**, then 1 h TTL | `main.py:877`, `analytics_cache.py:246–256` |
| `GET /api/recession/probability` | Trains a `LogisticRegression` in-process (no artifact on disk), 15 min TTL | `main.py:688`, `recession_cache.py:64–70` |
| `POST /api/recession/scenario` | Trains the model on cold cache | `main.py:795`, `recession_cache.py:92–100` |
| `POST /api/lbo/run` | **1 + up to 25** full `run_lbo_model` calls per request, **no cache at all** | `main.py:855–861` |
| `POST /api/regime/scenario` | Recomputes every POST by design ("no TTL", `analytics_cache.py:237`) | `main.py:757` |

The TTL caches blunt repeat cost but not the first hit, and `/api/lbo/run` has no cache by construction — the 5×5 grid at `main.py:855–861` runs the model 25 times for every single request.

**Why it's worse once public.** `/api/allocation` is the sharp one: each cold call makes the *server* fetch return histories from Yahoo. An anonymous attacker (or a crawler) hitting it repeatedly turns the host into a Yahoo-request amplifier and can get the deployment's IP throttled or blocked — which then breaks the market-data pipeline the rest of the product depends on. `/api/lbo/run` accepts unbounded request volume with 25 model runs each, a cheap CPU-exhaustion lever. None of this is reachable today because the service binds `127.0.0.1` (`main.py:13`); publishing removes that protection.

Worth stating plainly since the brief flagged it: **there is no Anthropic-key billing exposure here.** No route calls an LLM. The cost vectors are CPU and third-party API quota, not model spend.

**Proposed fix.** Rate limiting in front of the app (reverse-proxy rule, or `slowapi`), strictest on `/api/allocation` and the three POSTs. Consider a warm-on-startup for `/api/allocation` so no user request ever pays the cold download, and a small LRU on `/api/lbo/run` keyed by the request body.

**Risk note.** Small if done at the proxy — zero application code changes. In-app (`slowapi`) is also small but adds a dependency to `requirements-api.txt`.

---

### Finding 4 — WebSocket accepts any origin, with no client cap · **MEDIUM** · CONFIRMED

**Mechanism.** `stream.hub.register()` calls `await ws.accept()` at `stream.py:148` unconditionally — no `Origin` header check, no token, no `_clients` size limit (`stream.py:104,149`). **`CORSMiddleware` does not apply to WebSocket handshakes**, so the allow-list at `main.py:50` gives this endpoint no protection whatsoever.

**`file:line`.** `api/main.py:931` → `api/stream.py:147–164`.

**Why it's worse once public.** Any web page on the internet can open a socket to it and receive the live tape, and any script can open thousands. Every connected client is fanned out to every 250 ms (`stream.py:190–199`), so N clients multiply outbound bandwidth by N with no ceiling. The data itself is market quotes rather than user secrets, so the impact is resource abuse and free redistribution of the operator's **paid EODHD feed** rather than a confidentiality breach — hence Medium.

Credit where due: the token handling here is genuinely careful. It is loaded server-side (`stream.py:67–81`), never sent to browsers, and `_redact()` (`stream.py:142`) scrubs it from error strings before they reach `/api/stream/debug`.

**Proposed fix.** Check `websocket.headers.get("origin")` against an allow-list before `accept()`, and cap `len(self._clients)` (reject or evict past the cap). Both are a few lines in `stream.py:147–150`.

**Risk note.** Small and self-contained. The one gotcha: native/non-browser clients send no `Origin`, so decide explicitly whether a missing header is allowed.

---

### Finding 5 — `/api/stream/debug` exposes ops internals unauthenticated · **LOW** · CONFIRMED

**Mechanism.** Returns feed states, per-feed frame and reconnect counters, connected-client count, stored-symbol count, and `feed_last_error` (`main.py:938–947`, backed by `stream.py:110–116`).

**Why it's worse once public.** Free operational reconnaissance — whether the paid feed is authorised, when it drops, how many users are connected. `feed_last_error` carries `repr(exc)` from upstream failures; it is passed through `_redact()` (`stream.py:227`), which replaces the exact token string, so a token leak would require an upstream error that mangles the token before echoing it. Unlikely, but the endpoint has no reason to be world-readable.

**Proposed fix.** Put it behind the same auth as Finding 1, or drop it from the production build.

**Risk note.** Trivial. Nothing depends on it except manual debugging.

---

### Finding 6 — Absolute filesystem path disclosed in 503 responses · **LOW** · CONFIRMED

**Mechanism.** `DBUnavailable(f"Database not found at {DB_PATH}")` (`db.py:30`) is surfaced verbatim as the HTTP detail by `_guarded`: `raise HTTPException(status_code=503, detail=str(exc))` (`main.py:63`). A missing DB therefore returns the server's absolute path to the caller.

**Why it's worse once public.** Standard path-disclosure recon (deploy layout, usernames). Related, milder: `/api/allocation` leaks a missing module name and exception class name (`main.py:894`, `main.py:902`).

Confirmed *not* an issue: FastAPI is constructed without debug mode (`main.py:37–42`), so unhandled exceptions return a generic 500 and tracebacks go to logs only, not to response bodies.

**Proposed fix.** Return a fixed string ("Database unavailable") in the HTTP detail and log the path server-side.

**Risk note.** Trivial, one line at `main.py:63`.

---

### Finding 7 — Interactive API docs and OpenAPI schema served by default · **LOW / INFO** · CONFIRMED

**Mechanism.** `FastAPI(...)` at `main.py:37` sets no `docs_url=None` / `redoc_url=None` / `openapi_url=None`, so `/docs`, `/redoc`, and `/openapi.json` are live and unauthenticated.

**Why it's worse once public.** Hands an attacker the complete route list, every parameter, and every bound — turning enumeration of the amplifier endpoints in Finding 3 into a copy-paste exercise. For a portfolio project the docs may well be a *feature*; this is a deliberate call to make, not an automatic defect.

**Proposed fix.** If the API is meant to be a showcase, keep them. Otherwise pass `docs_url=None, redoc_url=None, openapi_url=None`.

**Risk note.** Trivial. Note `tests/test_api.py` uses `TestClient` directly, so disabling docs will not break the suite.

---

### Finding 8 — `symbols` CSV parameter is unbounded · **LOW** · CONFIRMED

**Mechanism.** `main.py:647` and `main.py:659` split the caller's `symbols` string on commas with no length or count limit, then `db.py:411` / `db.py:435` build one `?` placeholder per symbol. A request with tens of thousands of comma-separated values builds a query exceeding SQLite's `SQLITE_MAX_VARIABLE_NUMBER`, raising an unhandled `sqlite3.OperationalError` → HTTP 500.

**Why it's worse once public.** Cheap, repeatable 500s and wasted parsing/allocation per request. **Not** an injection: the values remain bound parameters no matter how many there are — the failure is a resource/DoS one, which is why this is Low.

**Proposed fix.** Cap the symbol count (e.g. reject >50) in both handlers, alongside the existing `Field`-style bounds used on every other numeric query param (`main.py:645`, `main.py:667`, etc.).

**Risk note.** Trivial, two handlers, no query changes.

---

### Finding 9 — No API-side regression test would catch an unguarded chat endpoint · **MEDIUM (forward-looking)** · CONFIRMED (gap) / SUSPECTED (that it will be exercised)

**Mechanism.** The guard is well covered where it lives — 27 tests in `tests/test_chat_sql_guard.py`. But `tests/test_api.py` (517 lines, new on this branch) contains **zero** references to chat, the agent, `is_safe_select`, or SQL injection. Migrating the assistant is the natural next step (`CLAUDE.md` lists a "assistant streaming endpoint" as a remaining React-migration step, and `chat.py` is fully built), and nothing in CI would fail if that endpoint executed model SQL directly against `api/db.py`.

**Why it's worse once public.** This audit's clean verdict is a snapshot of a branch where the feature simply is not present. The moment a chat route lands, every risk the Streamlit hardening addressed reappears — this time on an unauthenticated, internet-reachable endpoint where the SQL author is a language model steered by anonymous input, *plus* the Anthropic billing-DoS vector that does not exist today. The `mode=ro` connection in `db.py:31` is real defence-in-depth against writes, but it does not stop `pragma_table_info()` schema enumeration or `randomblob()` memory exhaustion — which is precisely why `is_safe_select` bans them.

**Proposed fix.** Land the guard's *contract* before the feature: (a) a test in `tests/test_api.py` asserting no API route reaches `sqlite3.execute` with model-authored SQL, or more practically a standing rule that any API chat endpoint must call `src.analytics.chat.is_safe_select`; (b) when the endpoint is written, import the existing guard — **do not copy it**, since a forked copy is exactly how the hardening drifts back out.

**Risk note.** Small now (a test and a note), large later if skipped. Worth recording while the context is fresh.

---

## 5. Streamlit unaffected (question E)

**Confirmed — nothing in this audit implicates the live Streamlit app.**

- The live app runs from `main`; every finding above is on the unmerged `react-rebuild` branch, in `api/` — a package `dashboard/` never imports.
- `src/analytics/chat.py` is byte-identical between `main` and `react-rebuild`; the hardened guard on the live path is untouched by the rebuild.
- Different process, different entrypoint: Streamlit Cloud serves `dashboard/app.py`; the FastAPI service is `uvicorn api.main:app` and is not deployed (`api/__init__.py:1–8` and the branch commit message both still describe it as local-only).
- The one carry-over to watch is Finding 2's fix: those six `src/analytics/*` modules **are** shared with the live dashboard, which is why the proposal there is an opt-in read-only mode rather than changing the default.

---

## 6. Pre-deploy checklist

Minimum set that must land before this backend is exposed to the public internet, in order. Items 1–3 are blocking; 4–6 are same-batch hygiene; 7 is a guard rail for the next commit rather than this one.

| # | Action | Finding | Blocking? |
|---|---|---|---|
| 1 | **Decide the auth posture and implement it** — shared-secret dependency on the `/api` router + the 6 unprefixed routes, or an explicit written decision that the data is public. Everything below assumes this is settled. | 1 | **Yes** |
| 2 | **Rate-limit at the edge**, strictest on `/api/allocation` (outbound Yahoo amplifier), `/api/lbo/run` (25 model runs/request), and the two other POSTs. | 3 | **Yes** |
| 3 | **Close the WebSocket** — `Origin` allow-list check before `accept()` and a hard cap on concurrent clients. | 4 | **Yes** |
| 4 | **Restore the read-only invariant** — opt-in `mode=ro` for the six `src/analytics` modules and drop `PRAGMA journal_mode=WAL` from the API path, *without* changing the default that live Streamlit uses. Verify against a copy of the DB, never the real asset. | 2 | Strongly recommended |
| 5 | **Stop leaking paths** — generic 503 detail at `main.py:63`; log the real path server-side. Cap the `symbols` count in both market handlers. | 6, 8 | Recommended |
| 6 | **Decide on `/docs` and `/api/stream/debug`** — keep the docs if the API is part of the portfolio showcase; put the debug endpoint behind auth or remove it from the production build. | 5, 7 | Recommended |
| 7 | **Write the guard rule down before the chat endpoint exists** — any future API chat route imports `src.analytics.chat.is_safe_select` rather than copying it, and ships with API-level injection tests. Revisit rate limiting and auth at that point: that endpoint reintroduces Anthropic billing exposure, which today's backend does not have. | 9 | Before chat migration |

Also worth confirming at deploy time (correctness, not security): the CORS allow-list at `main.py:50` contains only Vite dev origins, and no `StaticFiles` mount exists — so the "built bundle served same-origin" assumption in the `main.py:44–47` comment is not yet implemented. The frontend will need either that mount or the production origin added to the list.

---

*Audit performed read-only: no files in the repo were modified, no commits or pushes made, no dependencies installed, no server started, and no requests sent. The database was never opened as data. `.env` was not read — `stream.py:67–81` is described from source only.*
