<!-- Independent technical/accessibility/data-pipeline review, 2026-09-06. Written to disk by the orchestrator verbatim from the reviewer's final message (the reviewer's harness could not write .md files). -->

I could not write `proposals/release_readiness_evidence/review-technical/REPORT.md` — my harness blocks writing report/analysis `.md` files and requires findings be returned as text. The full report follows; please write it to that path if you still want it on disk. I removed the empty directory I had created for it. The temporary probe `web/scripts/_review-a11y.tmp.mjs` is deleted and the API is back up (`/health` → 200).

---

# Independent technical / accessibility / data-pipeline review

**Scope:** the 2026-09-06 release-readiness changes on `react-rebuild` (uncommitted).
**Posture:** read-only. Nothing in the repo was edited, created or deleted except the temporary probe `web/scripts/_review-a11y.tmp.mjs`, since deleted. No commits, pushes, workflow dispatches, or Anthropic calls. Roughly a dozen EODHD calls via the running API's normal endpoints.

**Caveat up front:** the review deadlocked the running FastAPI process twice (see P0-1). The second time it happened under ordinary browser traffic, not a load test. I killed and restarted `uvicorn api.main:app --host 127.0.0.1 --port 8000` (same command line, `EODHD_PROBE_ON_START=0`) so the rest of the review could proceed. That is the only process-level change I made.

## Test and lint results

| Command | Result |
|---|---|
| `EODHD_PROBE_ON_START=0 .venv/bin/python -m pytest tests -q --ignore=tests/test_streamlit_backports.py` | **262 passed** in 9.07 s |
| `cd web && npm run typecheck` (`tsc -b --noEmit`) | **exit 0**, no diagnostics |
| `cd web && npx vitest run` | **24 passed** (10 files) in 1.75 s |
| `actionlint .github/workflows/*.yml` | **clean**, exit 0 |

`docs/redesign/DEPLOY.md:163-164` still says "261 tests" and "22 vitest tests"; the real numbers are 262 and 24.

---

# Findings

## P0

### P0-1 — A burst of concurrent requests permanently deadlocks the whole API worker pool

**Where:** `api/db.py:28-32`

```python
def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise DBUnavailable(f"Database not found at {DB_PATH}")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
```

Every DB-backed route opens a brand-new SQLite connection and closes it immediately, on up to 40 concurrent anyio worker threads, against a WAL-mode database. `api/security.py:184-192` applies a concurrency ceiling only to `EXPENSIVE_PATHS` and `/api/market/`; `/api/regime/latest`, `/api/signals/latest`, `/api/news`, `/api/freshness` and the unprefixed Atlas routes have none. The per-client rate limit admits 600 req/min with a 600 burst, far above what open/close churn survives.

**Reproduction (observed twice):**

1. `for i in $(seq 1 1200); do curl -s "http://127.0.0.1:8000/api/regime/latest" & done` — the process stopped answering and never recovered (six polls, 20 s timeout each, all `000`).
2. Later, with no load test running, two concurrent headless-browser sessions driving the normal app produced the same wedge. `uvicorn.log` shows the run-up: 22 × `429` on `/api/market/intraday`, `/api/market/daily`, `/api/market/profile/NVDA` (the provider semaphore filling as threads stopped returning), then silence.

**Evidence — `/usr/bin/sample` of the wedged worker (second, organic occurrence):**

```
threads: 47
  42 __psynch_mutexwait
  39 sqlite3BtreeOpen
  39 pysqlite_connection_init
  39 findReusableFd
   2 sqlite3WalClose
   1 unixLock
   1 pysqlite_connection_close
```

One thread is inside `pysqlite_connection_close → sqlite3Close → sqlite3LeaveMutexAndCloseZombie → sqlite3BtreeClose → sqlite3PagerClose → sqlite3WalClose → unixLock → __psynch_mutexwait` — it holds the unix-VFS static mutex and is waiting to re-enter it. The other 39 worker threads are all parked in `sqlite3.connect() → openDatabase → sqlite3BtreeOpen → unixOpen → findReusableFd → __psynch_mutexwait` behind it. CPU 0.1 %, RSS steady: not slow, deadlocked. The process accepts TCP connections and answers nothing, forever.

**Impact:** total loss of the API from a burst any single visitor is allowed to generate, with no self-recovery. `/health/live` is an `async def` on the event loop and **keeps answering 200** while every data route is dead — only `/health/ready` (sync, would hang) catches this, so a liveness probe pointed at `/health/live` would never restart the process.

**Fix (ideally the first two together):**
- Serialize/pool DB access: a `threading.local()` connection per worker thread reused across requests, or a small bounded pool, instead of `connect()`/`close()` per call.
- Add the DB routes to a concurrency ceiling in `api/security.py` (a `db` semaphore of ~8 answering 429), and run uvicorn with `--limit-concurrency`.
- Cap the rate-limit *burst* well below the per-minute rate — 600 simultaneous admits is the trigger.
- Point the deploy's liveness probe at `/health/ready`, or give `/health/live` a real DB touch with a timeout.

The precise mutex re-entrancy is macOS system SQLite 3.51; the exposure (unbounded connect/close churn on an unbounded number of worker threads) is platform-independent.

---

## P1

### P1-1 — `/api/market/search?q=` lets an anonymous caller aim the server's EODHD token at any path on eodhd.com

**Where:** `api/main.py:1000-1007` (only `min_length=1, max_length=40`, no charset) → `api/providers/market.py:281` → `api/providers/eodhd.py:161`

```python
data = self._get(f"/search/{query}", params, what="symbol search")
...
url = f"{BASE}{path}"                       # eodhd.py:79
q = {**params, "api_token": self.token}     # eodhd.py:80
r = c.get(url, params=q)                    # eodhd.py:86
```

`query` is interpolated into the URL **path** without percent-encoding, and httpx normalizes dot segments when it parses the string.

**Reproduction (offline):**
```
'AAPL'       -> https://eodhd.com/api/search/AAPL?fmt=json&limit=15&api_token=SECRET
'../../user' -> https://eodhd.com/user?fmt=json&limit=15&api_token=SECRET
'a/b'        -> https://eodhd.com/api/search/a/b?fmt=json&limit=15&api_token=SECRET
```

**Reproduction (end-to-end against the running app):**
```
curl "http://127.0.0.1:8000/api/market/search?q=..%2Fsearch%2FAAPL&limit=3"
→ {"provider":"eodhd", ... "hits":[{"symbol":"AAPL","name":"Apple Inc." ...}]}
```
The `..` segment was resolved and the request re-entered `/api/search/AAPL` — proof the path escaped its segment. `q=../user` would reach EODHD's account endpoint with the server's token.

**Impact:** an unauthenticated caller chooses which endpoint of a paid provider the server hits with its own credential — quota burn, account-metadata endpoints, and any EODHD path returning a JSON list of `{Code, Name, Exchange}` gets echoed back through the search response. Every other symbol path is protected (`_symbol_arg`, `api/main.py:990-996`); `q` is the one that isn't.

**Fix:** percent-encode the segment (`urllib.parse.quote(query, safe="")`) in `EodhdClient.search()`, **and** add a charset `pattern` to the `q` Query.

### P1-2 — The per-client rate limit is fully bypassable in the configuration the docs tell you to use

**Where:** `api/security.py:114-120`

```python
def _client_id(self, scope: dict) -> str:
    if self.trust_forwarded:
        for k, v in scope.get("headers", []):
            if k == b"x-forwarded-for":
                return v.decode("latin-1").split(",")[0].strip() or "unknown"
```

`docs/RUNBOOK.md:76` — "``TRUST_X_FORWARDED_FOR`` | `1` behind a reverse proxy so rate limits key on the real client"; `docs/redesign/DEPLOY.md:90` repeats it. Every host in the DEPLOY table sits behind a proxy, so this is the intended production setting.

The **left-most** `X-Forwarded-For` entry is the value the *client* supplied. A proxy appends; it does not replace. There is no trusted-hop count and no proxy allowlist.

**Reproduction** (middleware instantiated directly, `per_client_per_min=3`, `TRUST_X_FORWARDED_FOR=1`, socket peer fixed at `203.0.113.9`):
```
same spoofed XFF, 5 requests (limit 3/min):     [200, 200, 200, 429, 429]
rotating spoofed XFF, 20 requests:              [200 × 20]
proxy-appended 'attacker, realclient' × 5:      [200, 200, 200, 200, 200]
client_id from '1.1.1.1, 203.0.113.9':          1.1.1.1
```

**Impact:** with the documented setting the per-client bucket is decorative — one client can saturate the app (and, via P0-1, kill it). With the setting *off* behind the same proxy, the opposite failure: every visitor shares one bucket keyed on the proxy's IP, so 600 req/min is the global ceiling and one abusive client 429s everyone. Both states are wrong; the code offers no third.

**Fix:** take the entry `N` hops from the right with `N` configured as a trusted-proxy count (`TRUSTED_PROXY_HOPS=1`), falling back to `scope["client"]`; or accept the header only when the socket peer is in a CIDR allowlist. Then correct both docs.

### P1-3 — The WebSocket endpoint bypasses every publication gate

**Where:** `api/security.py:133-135`

```python
async def __call__(self, scope, receive, send):
    if scope["type"] != "http":
        return await self.app(scope, receive, send)
```

`/api/stream/ws` (`api/main.py:1370`) therefore has no size cap, no rate limit, no concurrency ceiling, no security headers, and no client cap in `QuoteHub.register` (`api/stream.py:284-292` — `self._clients.add(ws)` is unbounded).

**Reproduction A — unbounded anonymous connections:**
```
opened 40 concurrent browser websockets with no auth
snapshot type: snapshot items: 31
server-reported clients: 45   dynamic: 0 / 20
```
`_flush_loop` (`api/stream.py:351-360`) awaits `_send_all` over every client every 250 ms, so fanout cost is linear in an attacker-controlled number.

**Reproduction B — each `watch` of a new symbol buys an upstream paid call.** `api/stream.py:414`:
```python
entry = {"feed": feed, "watchers": set(), "last_seen": time.monotonic()}
self._dynamic[sym] = entry
await self._subscribe_upstream(sym, feed)
asyncio.create_task(self._seed_symbols([sym]))   # → EODHD /real-time REST call
```
Verified live (two symbols, zero credentials presented):
```
before: dynamic=0 subscribes=0 rejected=0 symbols=[]
after 2 watches: dynamic=2 symbols=['PLTR', 'SNOW']
```
`MAX_DYNAMIC_SYMBOLS=20` caps *concurrent* subscriptions, not the *rate*: `watch()` evicts the longest-idle unwatched symbol (`api/stream.py:406-412`) and subscribes+seeds the new one, so a client cycling `watch`/`unwatch` across distinct symbols drives one EODHD REST call per new symbol as fast as the socket allows. `feed_for_symbol` (`api/stream.py:117-129`) accepts any 1–12-character `[A-Z0-9.-]` string, so the supply of distinct symbols is unbounded. No per-connection message rate limit exists in `register()`.

**Fix:** handle `scope["type"] == "websocket"` in `SecurityMiddleware` — cap total connections and connections per client id. Rate-limit `_handle_client_message` per connection, and gate `_seed_symbols` behind the same `providers.cache.TokenBucket` the REST client uses.

---

## P2

### P2-1 — Search hits on most exchanges produce canonical symbols that do not round-trip

**Where:** `api/providers/symbols.py:19-54` (`EXCHANGE_CODES`), `:116`, `:163`, `:172-181`

`_equity()` builds `canonical = f"{canon_code}.{exchange}"` for any non-US exchange, but `parse()` only recognises a suffix that is a key of `EXCHANGE_CODES` (34 entries). EODHD search returns hits from far more exchanges, so `from_eodhd_hit` emits canonicals `parse()` cannot read back.

**Reproduction (offline):**
```
from_eodhd_hit('AAPL','BA') -> AAPL.BA -> re-parse eodhd: AAPL.BA.US     ← broken
from_eodhd_hit('AAPL','TO') -> AAPL.TO -> re-parse eodhd: AAPL.TO        ← fine
AAPL.AT -> eodhd AAPL.AT.US ;  ABC.XYZ -> eodhd ABC.XYZ.US
```

**Reproduction (live).** `AMZN.BA` and `AAPL.BA` are real hits the Markets symbol search shows (observed in the listbox: `AMZN.BA | Amazon.com Inc. | BA · EQUITY`). Following one:
```
curl "http://127.0.0.1:8000/api/market/candles/AAPL.BA?range=6M"
{'symbol':'AAPL.BA','provider':'yfinance','fallback_used':True,
 'fallback_reason':'unknown_symbol','count':130,'exchange':'US','timezone':'America/New_York'}
```

**Impact:** three lies in one payload. EODHD *does* list `AAPL.BA` — we asked it for `AAPL.BA.US`, so `fallback_reason: "unknown_symbol"` (rendered as "yfinance standing in (no EODHD listing)", `web/src/screens/shared/provider-ui.ts:21`) misattributes our own bug to the provider. `exchange` comes back `US` and `timezone` `America/New_York` for a Buenos Aires listing, so the chart's session framing is wrong. And the EODHD-first contract silently degrades to yfinance for most non-US hits.

**Fix:** make `EXCHANGE_CODES` the yfinance-suffix map only, and keep a separate (or open) set of parseable EODHD exchange codes — any 2–4-letter uppercase suffix should parse as an exchange with `yfinance=None` when unmapped. Add a round-trip property test: `parse(from_eodhd_hit(code, exch)).eodhd == f"{code}.{exch}"`.

Related, same file: `parse()` accepts `AAPL=X` → EODHD `AAPL=X.US` and `A^B` → `A^B.US`, so the "never send Yahoo syntax to EODHD" claim in the module docstring is not strictly enforced (harmless — they 404).

### P2-2 — `signals` can never be reported "stale"

**Where:** `api/freshness.py:183` — the `delayed_ok` argument is `db_fresh.get("signals_date") is not None`, so `_verdict` can only ever return `current` or `delayed` for this feed.

**Reproduction:**
```
ONLY signals broken (2015-01-01), everything else healthy:
  overall: delayed     regime: current     signals: delayed
```

**Impact:** `signals` is in `model_feeds` (`freshness.py:200`) and in `validate_db.MODE_FEEDS["full"]`. A signals table years out of date produces a *warning*, never a failure, so the gate publishes it and the shell says "delayed" — the one word a reader would take to mean hours, not years.

**Fix:** compute `delayed_ok` as `signals_month >= month_add(expected_regime_month, -1)`, mirroring the `regime` row two lines above.

### P2-3 — Future-dated rows read as "current" and pass every gate

**Where:** `api/calendar.py:109-118` (`business_days_between` returns 0 when `b <= a`), `api/freshness.py:95,132,145,176`, `scripts/validate_db.py:155`

**Reproduction** (`assess()` at 2026-09-06 with every stored date set to 2027-12-31):
```
FUTURE-DATED DB -> overall: current
  market_daily / market_intraday / news / fred:* / regime / signals   all "current"
```
`validate_db`'s regression check is `str(new_max) < str(prev_max)`, which a future date passes, and its only other content checks are integrity, table presence, non-empty and a 20 %-row floor. A DB corrupted with future dates (bad runner clock, a parsing bug writing `2027`) validates `pass`, uploads to `data-latest`, and reports as fresh everywhere.

**Fix:** in `assess`, treat `latest > expected + tolerance` as its own verdict; in `validate_db`, fail when any max date is more than a day or two ahead of now.

Related gaps in the same gate: no value-range sanity checks (regime probabilities outside [0,1], negative prices, `prob_*` not summing to 1 all pass); the 20 %-row-loss floor only applies when the previous table had >20 rows; and when `--previous` exists but is unreadable, **all** regression checks are skipped and `changed` defaults to `True` (`validate_db.py:150,166-167`), so a regressed DB uploads if the baseline happens to be corrupt.

### P2-4 — Jargon tooltips fail WCAG 1.4.13 (Content on Hover or Focus, AA)

**Where:** `web/src/styles/app.css:93-124`, `web/src/screens/shared/Jargon.tsx:78-80`

```css
.jargon::after { content: attr(data-def); ... pointer-events: none; display: none; }
.jargon:hover::after, .jargon:focus-visible::after { display: block; opacity: 1; visibility: visible; }
```

1.4.13 requires the content to be **dismissible**, **hoverable**, and **persistent**. There is no Escape handler anywhere, and `pointer-events: none` means the pointer cannot rest on the tooltip — moving toward it leaves the trigger and it vanishes. The `title` attribute is also present (native tooltips are exempt) but the CSS tooltip is what a sighted user actually sees, and it is author content. ~40 jargon terms across Dashboard, Regime Lab, Credit, Recession, News and Tools.

**Fix:** render the definition as a real element with a keydown handler that hides it on Escape, give it `pointer-events: auto` with a bridging gap, and reference it with `aria-describedby`. Related: the spans are `tabIndex={0}` with **no role**, so a screen reader announces them as plain focusable text.

---

## P3

1. **Intraday cron is UTC-fixed across DST.** `.github/workflows/intraday-refresh.yml:9-11` uses `cron: "2-57/5 13-20 * * 1-5"` with the comment "13:30–21:00 UTC = 9:30 AM–5:00 PM ET". In EST the session is 14:30–21:00 UTC, so the schedule starts 90 min before the open (six wasted runs/day) and its last run at 20:57 UTC = 15:57 ET, missing the closing bar. The second entry `cron: "32 13 * * 1-5"` is fully redundant — `2-57/5` already includes minute 32.
2. **The first in-session intraday run may fail validation daily.** `market-only` judges `market_intraday`, which in-session requires bars within 20 minutes (`api/freshness.py:103`). At 13:32 UTC (9:32 ET) the newest stored bar is still yesterday's 15:55 unless yfinance has published the 9:30 bar; a `stale` verdict makes `validate_db.py` exit 1 and the step `exit 1`s. Worth watching after deploy.
3. **`_search_cache` key omits `limit`** — `api/providers/market.py:275,323`; a `limit=25` request served from a `limit=3` entry silently returns three hits for an hour.
4. **`KeyedTTLCache` eviction can break single-flight** — `api/providers/cache.py:36-39` pops `self._locks[oldest]` while another thread may hold it; the next caller creates a fresh lock and a duplicate upstream call runs.
5. **`_identity()` escapes the provider concurrency ceiling** — `api/providers/market.py:333` calls `client().search(...)` directly, not through `_with_slot`.
6. **Options pagination silently clamps** — `api/providers/eodhd.py:204` clamps `page[offset]` to 10000 while `market.py:618` echoes the requested `page`; with the default `limit=60`, pages 167+ (allowed up to 500 by `api/main.py:1047`) return the same rows under the caller's page number.
7. **Dead code in `api/freshness.py:94`:** `cal.next_trading_day(last_session) if False else last_session + timedelta(days=1)`.
8. **`api/freshness.py:160`** decides a month is "complete" for a daily FRED series against the last *calendar* day; FRED daily series end on the last *business* day, so any month ending on a weekend is treated as incomplete and `common_feature_month` walks back a month.
9. **CSP allows any WebSocket host** — `api/main.py:1437`: `connect-src 'self' ws: wss: {extra}`. `CSP_CONNECT_SRC` exists precisely so the relay origin can be named.
10. **`/api/providers/status` and `/api/stream/debug` are unauthenticated ops views** — EODHD plan matrix, entitlement verdicts and reasons, relay states, reconnect backoff, subscription lists, security counters. No secrets (verified), but more internal state than a public deploy needs.
11. **Secrets interpolated into a `run:` heredoc** — `.github/workflows/refresh-data.yml:99-105`. Every *untrusted* (`github.event.*`) value is correctly passed via `env:`; this is the one remaining direct interpolation.
12. **Memo workflows wake on every hourly news run** — `daily-memo.yml:9-12` triggers on every "Refresh Data" completion; the gate skips news-only runs (`:48-58`) but only after a runner + checkout + artifact-download attempt (~24 wasted runner starts/day).
13. **The published snapshot bakes in the build environment's provider state** — `refresh-data.yml:176-178` deletes `.env` before `build_snapshot.py` runs at line 199, and CI has no `EODHD_API_TOKEN`, so the shipped `/api/providers/status` entry will say `eodhd_configured: false` with empty entitlements. The locally built `web/public/snapshot/latest.json` says `true`.
14. **Options-chain table has no accessible name** — 41 rows, 13 `<th>` all correctly `scope`d, but no `<caption>`/`aria-label`. Same for the Tools table (6 `<th>`, **none** `scope`d; `thead` present so implicit column scope is inferred).
15. **lightweight-charts' internal layout `<table>` is exposed to AT** — 2 rows, 0 `<th>`, no `role="presentation"`.
16. **Command palette combobox is incomplete** — `CommandPalette.tsx:93-103`: the input has `aria-controls` + `aria-activedescendant` but no `role="combobox"` and no `aria-expanded`. The zero-result message (`:110-118`) is a plain `<div>` inside `role="listbox"` (invalid listbox child) and is in no live region, so filtering to nothing is silent. `.scrim` has no `aria-hidden="true"`.
17. **No skip link** on any of the six routes, with 8–10 nav links repeated per screen. WCAG 2.4.1 (A) is arguably met via landmarks (ARIA11 is a sufficient technique and `main`/`nav[aria-label="Primary"]`/`header` are present), but a skip link is the cheap belt.
18. **Dialog launchers lack `aria-expanded` / `aria-haspopup`** — `AppShell.tsx:86-119` (alert drawer, ⌘K palette). The AI Analyst button does it correctly (`:364-365`).
19. **SubTabs are 40 px on narrow** (`SubTabs.tsx:131`), under the 44 px bar the brief sets for primary controls on narrow (WCAG 2.2 AA needs 24). The primary mobile nav control measures 44 px.
20. **`KitScreen` is bundled eagerly** — `web/src/App.tsx:3` imports it directly while every `/app/*` screen is `lazy()`.
21. **Dead code:** `_SYMBOL_PATH` (`api/main.py:988`) is defined and never used.
22. **`python-dotenv` in `requirements-news.txt` is unused** — `src/analytics/news.py` never calls `load_dotenv`.
23. **Stale numbers in `docs/redesign/DEPLOY.md:163-164`.**

---

# Verified OK

**Secrets.** The EODHD token does not appear in `web/public/snapshot/latest.json` (exact-substring check against the `.env` value, which I never printed), nor do `api_token=`, `sk-ant-`, `ghp_`/`github_pat_`, `Bearer `, or a 32+-hex run. `api/logsafe.py` holds httpx/httpcore at WARNING and installs a redaction filter on the root logger *and* on handlers added later (the `Logger.addHandler` wrap at `logsafe.py:63-69`). `EodhdClient._redact` and `QuoteHub._redact` scrub the token from every error detail before it reaches a log line or `/api/stream/debug`. `api/main.py:1082` exposes only `bool(client().token)`.

**Error bodies.** Typed and sanitized, no URLs, no tracebacks:
```
/api/market/ticks/AAPL      → {"detail":"The EODHD plan on this server does not include tick data.","kind":"unauthorized","provider":"eodhd","retryable":false}
/api/market/profile/ZZQQX…  → {"detail":"No listing found for 'ZZQQXNOTREAL' on EODHD or yfinance.","kind":"unknown_symbol","provider":"api","retryable":false}
/api/market/options/EURUSD/expirations → {"detail":"Options data covers US-listed stocks and ETFs only.","kind":"unsupported","provider":"api","retryable":false}
```

**Body caps.** 70 KB with `Content-Length` → `413`; the same body chunked → `422` via `_bounded_receive`; 20 KB to `/api/assistant/ask` → `413`.

**Rate limiting (without XFF trust).** 700 concurrent `/api/regime/latest` → `616 × 200, 84 × 429` with `Retry-After`.

**Input validation.** `/api/market/candles/{sym}`: `AAPL` 200; `aa%20pl`, `A'B`, a 32-char symbol all `422`; `../../etc/passwd` `404`. `range=BOGUS` → 422. `page=999` → 422 (`le=500`), `limit=9999` → 422 (`le=200`). `strike_from > strike_to` → 422. `/series/' OR 1=1--/latest` → a parameterized 404, no SQL error.

**Security headers** present on every response including errors: `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `cross-origin-opener-policy`. CSP on the served `index.html` has `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `script-src 'self'`.

**CORS.** Preflight from `https://evil.example` → `400`, no `Access-Control-Allow-Origin`; `http://localhost:5173` → echoed correctly. No wildcard, no `allow_credentials`.

**Assistant gate.** `assistant_mode()` defaults to `off` the moment `CORS_ORIGINS` is set (`security.py:42-46`); `key` mode is header-checked; the 10/min bucket and 16 KB cap are enforced. The SQL guard is still *imported* from `src/analytics/chat.py`, never copied, with `tests/test_api.py::test_assistant_guard_identity_no_local_copy` keeping it that way.

**NYSE calendar.** All four years of `api/calendar.py:17-28` check out against the published NYSE schedule: 2024–2027 holidays complete and correct, including the 2025-01-09 Carter closure, Good Friday (2026-04-03, 2027-03-26), and every weekend-observance shift (2026-07-03, 2027-06-18, 2027-07-05, 2027-12-24). Early closes correct too, including the correct *absence* of one before a Friday-observed holiday. `calendar_known()` degrades to weekends-only past 2027 rather than crashing.

**Freshness, non-pathological cases.** The live `/api/freshness` correctly picks the 360-minute off-hours news SLA at 00:05 ET, reports `regime: delayed` with a named blocker ("Industrial production… not yet published"), and its `session` block is right for a weekend (`phase: weekend`, `last_completed_session: 2026-09-04`, `next_open_utc: 2026-09-08T13:30:00Z`). A decade-old DB reads `stale` on every feed except `signals` (P2-2). ET-vs-UTC handling is explicit: `_parse_dt(..., naive_tz=cal.NY)` for the intraday pipeline's ET wall-clock stamps, UTC for everything else.

**Bootstrap.** `_validate_sqlite` (header + `quick_check` + non-empty `regimes`) runs *before* `os.replace`, so a torn or empty download can never become the live DB; the temp file is created in the same directory and the `finally` removes it. Failures are caught by the lifespan (`api/main.py:101-103`) and never block startup.

**Workflows.** `actionlint` clean. Mode resolution is a pure function with an unknown cron falling to `verify-only`, never `full` (`workflow_mode.py:34`), and `tests/test_workflows.py` asserts the dispatch options, the cron set, that news-only cannot run heavy steps, that every upload is validation-gated, that the concurrency group and retry/soft-reset loop survive, and that the lean requirement sets cover their modules' third-party imports. Every untrusted `github.event.*` value goes through `env:` and is quoted — no script-injection surface. `.env` is deleted with `if: always()` before validation, publication and artifact upload. `verify-only` needs no dependencies at all. I confirmed the import graphs independently:
```
news-only    (news.py, perplexity.py, db_helpers.py) → requests, feedparser   ✓ covered
market-only  (fetch_market.py)                        → pandas, yaml, yfinance ✓ covered
validate_db                                           → (stdlib only)          ✓
```
The Anthropic interpretation pass in `news.py:589` is a raw `requests.post`, so the lean news set correctly needs no `anthropic` package.

**Snapshot mode — the honesty question.** With **all 24 API requests aborted at the network layer** and only `/snapshot/latest.json` allowed through, `/app/dashboard` still paints, and paints honestly:

> "The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own. The macro regime read (Jul 2026) is one monthly cycle late; market data runs through Sep 04, 2026." · "◆ Validated snapshot · Sep 06, 2026" · "Alerts · unavailable" · "Regime unavailable: the data service did not answer. The read resumes when it is back."

Seeded data survives the failing refetch, sections whose endpoints are *not* in the manifest say `unavailable` rather than inventing anything, and `applySnapshot` only fills empty cache slots (`snapshot.ts:61`) so live data always wins.

**Stale-response handling on symbol switch.** `useSymbolCandles`'s `placeholderData` predicate (`queries.ts:429`) keeps bars across a *range* change and drops them across a *symbol* change; `useSymbolSearch` deliberately carries no placeholder. `useOptionsChain` guards on both symbol and expiration.

**Code splitting and router flags.** Every `/app/*` screen is `lazy()` behind `Suspense` (`AppShell.tsx:41-48,537`), and `dist/index.html` preloads only `index / vendor-react / vendor-query / css` — `vendor-charts` (172 KB) is pulled only by the Markets chunks. `BrowserRouter` carries `v7_startTransition` and `v7_relativeSplatPath` (`main.tsx:23`) — the complete set applicable to a non-data router. Favicons: `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` all present in `web/public/`.

**Accessibility — what passed.** Headless DOM audit of `/`, `/app/dashboard`, `/app/markets` (with the AMZN single-name panel and Options lens open), `/app/regime-lab`, `/app/tools`, `/app/news` at 1440 and 390:

- **Accessible names:** 0 unnamed interactive elements on any route at either width (29–54 per page). 0 `<img>` without `alt`. 0 duplicate `id`s. 0 console errors, 0 page errors.
- **Focus rings:** a global `:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px }` plus per-component overrides; a real keyboard Tab produces `solid 1px rgb(74,158,255)`. My first probe flagged one button, which turned out to be an artifact of programmatic `.focus()` not matching `:focus-visible` — **withdrawn; focus is visible everywhere**.
- **Contrast:** 0 failures across every distinct colour/size/weight combination on all six routes at both widths.
- **Command palette:** `role="dialog"`, `aria-modal="true"`, `aria-label`, `aria-describedby`; focus moves to the input; **14 consecutive Tab presses never left the dialog**; `#shell-content` gets `inert` while open and loses it on close; Escape closes it and **focus returns to the ⌘K trigger** (`useModal.ts:88`, verified by opening from the visible button). The `inert` reference count means two overlapping overlays behave.
- **Tabs:** `SubTabs` is a textbook implementation — `role="tablist"` with `aria-label`, `aria-selected`, `aria-controls`, roving `tabIndex`, ←/→/Home/End, labelled `tabpanel` (5 tabs on Regime Lab, 2 on Tools; exactly 1 selected each).
- **Nav:** one `<nav aria-label="Primary">` per screen with exactly one `aria-current="page"`, correct on all six routes at both widths. Mobile collapses to a single 44 px control.
- **Toggles:** chart ranges (1D…MAX) and Calls/Puts all carry `aria-pressed`, all ≥28 px.
- **Target size (2.5.8):** the sub-24 px hits are the inline `.jargon` terms, which qualify for the inline-sentence exception (`display: inline`, inside a text block — verified per element), and the News "Read at …" links, which I checked against the spacing exception explicitly (24 px circle centred on each target vs every other target): **no clashes, all pass**.
- **Charts:** SVGs carry `role="img"` + `aria-label` ("Monthly regime odds, 24 months"); the lightweight-charts canvases sit inside `role="region" aria-label="AMZN chart panel"` (`ChartPanel.tsx:226-228`).
- **Not colour-only:** alert state is in the accessible name plus a `✓`/`●` glyph; decorative glyphs are `aria-hidden`; `aria-label="⌘K · jump to any tab or section"` satisfies 2.5.3 label-in-name.
- **Distinct states:** loading ("Calculating…", `ScreenLoading`), empty ("No tab or section matches …", "No alerts · 7d"), delayed/stale/unavailable and "Validated snapshot" all render as different words, with a `role="status"` region for the freshness line and another for the chart's provider/as-of caption.
- **Options lens:** opens via a proper `aria-expanded` disclosure; the chain table's 13 `<th>` all carry `scope`; the expiration `<select>` has `aria-label`; the header discloses "end-of-day · EODHD · as of 2026-09-05 04:00:03" and "first 1,000 contracts scanned for expirations". Symbol search is a correct combobox (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`).

---

# Tests: are they meaningful?

Mostly yes — behaviour tests, not tautologies.

**Good:** `tests/test_workflows.py` parses the YAML and asserts structural invariants that would otherwise rot silently (news-only can't run heavy steps; every upload is gated; the retry loop and `merge=ours` survive; **lean requirement sets checked against real import graphs**). `tests/test_news_classify.py` uses 21 real headlines including the reported defect and the "billion ≠ M&A" / "IPO ≠ merger" traps. `tests/test_allocation_sample.py` cross-checks `regime_sample_detail` against `_regime_month_counts` and asserts the exact prose sentence. `web/src/api/queries.test.tsx` gates the second fetch on a promise to prove the placeholder is absent *while in flight*. `tests/test_security.py` exercises the middleware directly with tiny limits so assertions are exact. `tests/test_stream_hub.py` asserts the token is absent from the debug payload by substring.

**Untested and material:**

1. **The DB concurrency path (P0-1).** Nothing exercises more than one request at a time; the deadlock is invisible to the suite. ~200 concurrent `TestClient` GETs at `/api/regime/latest` from a thread pool, asserting they all return within N seconds, would have caught it.
2. **`_client_id` / `TRUST_X_FORWARDED_FOR` (P1-2).** `tests/test_security.py` never sets the env var and never sends the header. Two asserts would pin the semantics.
3. **The WebSocket security boundary (P1-3).** `test_stream_hub.py` tests the hub's own bounds, but nothing asserts whether `/api/stream/ws` is subject to the middleware, and nothing caps client count.
4. **`q` charset on `/api/market/search` (P1-1).** `test_api_lookup.py` covers symbol paths but not the free-text query, and no test asserts what URL `EodhdClient.search` actually builds.
5. **Symbol round-tripping (P2-1).** `tests/test_symbols.py` covers the mapped exchanges; no property test for an exchange outside `EXCHANGE_CODES`.
6. **`signals` staleness and future dates (P2-2, P2-3).** `tests/test_freshness.py` has neither case.
7. **`validate_db` with a corrupt `--previous`** — covered against a healthy baseline only.
8. **Retry-bound behaviour of `EodhdClient`** — the mock transport is there; the *number* of attempts and "401/403/404/422 never retry" are unpinned.
9. **No frontend test for the failing-refetch-keeps-snapshot behaviour** I verified manually — it is the load-bearing honesty claim of zero-cost mode.

---

# Commands run

```bash
# suites
EODHD_PROBE_ON_START=0 .venv/bin/python -m pytest tests -q --ignore=tests/test_streamlit_backports.py
cd web && npm run typecheck
cd web && npx vitest run
actionlint .github/workflows/*.yml

# security gates against the running app
curl -s -o /dev/null -w "%{http_code}" -X POST …/api/lbo/run -H 'content-type: application/json' --data-binary @70kb.txt          # 413
curl -s -o /dev/null -w "%{http_code}" -X POST …/api/lbo/run -H 'Transfer-Encoding: chunked' --data-binary @70kb.txt              # 422
curl -s -o /dev/null -w "%{http_code}" -X POST …/api/assistant/ask -H 'content-type: application/json' --data-binary @20kb.json   # 413
for s in AAPL "aa%20pl" "../../etc/passwd" "A'B" "AAAA…32"; do curl -s -o /dev/null -w "%{http_code}" "…/api/market/candles/$s?range=6M"; done
curl -s "…/api/market/candles/AAPL?range=BOGUS"; curl -s "…/api/market/options/AAPL?expiration=2026-09-18&page=999"
curl -s -D - -o /dev/null -X OPTIONS …/api/regime/latest -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET'
for i in $(seq 1 700); do curl -s -o /dev/null -w "%{http_code}\n" "…/api/regime/latest" & done | sort | uniq -c
curl -s "…/api/market/search?q=..%2Fsearch%2FAAPL&limit=3"          # P1-1 proof
curl -s "…/api/market/candles/AAPL.BA?range=6M"                      # P2-1 proof
curl -s …/api/market/ticks/AAPL ; curl -s …/api/market/profile/ZZQQXNOTREAL ; curl -s …/api/providers/status

# in-process proofs
.venv/bin/python  # httpx URL construction for the search path                     (P1-1)
.venv/bin/python  # SecurityMiddleware with TRUST_X_FORWARDED_FOR=1                (P1-2)
.venv/bin/python  # symbols.parse / from_eodhd_hit round-trip table                (P2-1)
.venv/bin/python  # freshness.assess: future / decade-old / signals-only dates     (P2-2, P2-3)
.venv/bin/python  # 40 anonymous websockets; 2 × watch → dynamic subscribe         (P1-3)
.venv/bin/python  # AST import-graph walk for the lean requirement sets
.venv/bin/python  # secret-pattern scan of web/public/snapshot/latest.json

# deadlock evidence
/usr/bin/sample <uvicorn-pid> 3 -file sample.txt      # twice; 39–40 threads in the SQLite mutex wait

# accessibility (temporary puppeteer probe, since deleted)
node web/scripts/_review-a11y.tmp.mjs http://localhost:5173
#   6 routes × {1440, 390} + AMZN panel + Options lens + command palette
#   + offline pass with /api/* aborted at the network layer
```

Raw probe output stayed in the session scratchpad (`a11y.json`, `a11y2.json`, `a11y3.json`, `sample*.txt`); nothing was written into the repo.
