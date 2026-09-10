# DEPLOY.md — publication runbook (build everything, deploy nothing)

Status 2026-09-06: **nothing is deployed, committed or pushed.** This is the
runbook a human follows when the go decision is made. Two modes are
supported by the code as built; the zero-cost mode is the one this pass
verified end to end locally.

## 0. What changed in this pass (2026-09-06)

- Provider layer `api/providers/` — EODHD first for search, quotes, daily and
  intraday candles, splits/dividends, exchange hours, options (end-of-day) and
  bounded ticks; yfinance only as a **disclosed** fallback; FRED unchanged.
  Every payload carries `provider`, `fetched_at`, `market_ts`, `delayed`,
  `fallback_used`, `fallback_reason`. Entitlements are probed once per family
  at startup (`/api/providers/status`). Today's plan: fundamentals and ticks
  **not** entitled (403, explicit unavailable states); options entitled.
- Security gates `api/security.py`: body caps, per-client + global rate
  limits, assistant gate (`ASSISTANT_ACCESS`), concurrency ceilings, security
  headers, CSP on the served shell, typed sanitized provider errors, token
  redaction in logs (`api/logsafe.py`).
- Freshness `api/freshness.py` + NYSE calendar `api/calendar.py`: source-aware
  SLA verdicts and regime blockers, used by `/api/freshness` and by
  `scripts/validate_db.py` in the workflows.
- Zero-cost availability: `scripts/build_snapshot.py` → `snapshot/latest.json`
  seeds the React Query cache before first paint (`web/src/api/snapshot.ts`),
  so stored screens render with the API asleep; the shell says
  **Validated snapshot / Delayed / Live / Reconnecting / Backend unavailable**.
- Live relay: stale-tick detection, degraded verdict, bounded dynamic
  subscriptions (`watch`/`unwatch`, ≤20 symbols, 10-min idle expiry),
  `VITE_WS_BASE` for a split deploy.
- Workflows: explicit modes with validation gates and a `validated-db`
  artifact; the refresh dispatches the memo workflows only after a validated
  morning full run and they consume that artifact. `make sync-data` for the
  local copy.

## 1. Zero-cost mode (architecture of record for a free launch)

```
Browser ──HTTPS──> static host (web/dist + snapshot/latest.json)      always up
   │                 Vercel Hobby (free) or Cloudflare Pages (free)
   ├──HTTPS+CORS──> API host (uvicorn api.main:app)                    may sleep
   │                 Render free web service (sleeps after idle)
   └──WSS──────────> same API host, /api/stream/ws (VITE_WS_BASE)      best effort
```

Promises this mode keeps, verified locally 2026-09-06 with FastAPI stopped:

- The shell, Methodology, regime, signals, freshness line, stored market
  tables and the latest stored headlines render from the validated snapshot
  with **no** backend; the status word says *Validated snapshot · <date>*.
- Nothing blocks on the API: the snapshot seed is bounded (2.5 s), health
  checks are never awaited by the UI, live services connect progressively.
- Last-known-good: the snapshot is also kept in `localStorage`, so a cold
  load with the static file unreachable still paints the last validated one.
- When the API wakes, queries refetch on their own; the word changes to
  *Delayed* or *Live*.

What it cannot promise: a **continuous WebSocket**. No free tier I could
confirm keeps a process awake without a payment method or an always-on plan
(section 4), so the live tape is available while the host is awake and
degrades to delayed/stored data otherwise. No keepalive ping is built or
scheduled — it is not within the free hosts' intended use and the brief made
that an owner decision.

### 1a. Static frontend

```bash
cd web
npm ci
# the snapshot ships with the bundle: download the last validated one first
gh release download data-latest --repo maxkomen-macro/macro-regime-radar \
   --pattern snapshot-latest.json --dir public/snapshot && mv public/snapshot/snapshot-latest.json public/snapshot/latest.json
VITE_API_BASE=https://<api-host> VITE_WS_BASE=wss://<api-host> npm run build   # → dist/
```

Vercel: root `web/`, build `npm run build`, output `dist/`, env
`VITE_API_BASE`, `VITE_WS_BASE`, add `web/vercel.json` with
`{"rewrites": [{"source": "/(.*)", "destination": "/index.html"}]}` so
`/app/*` deep links resolve. Because the repo is private, the build step
needs a read token to download the snapshot (`GH_TOKEN` in the Vercel build
env) — or commit nothing and let the page run on its localStorage copy until
the API wakes. `VITE_SNAPSHOT_URL` can point at a snapshot hosted elsewhere.

### 1b. API host (free tier)

Docker image from the repo `Dockerfile` (one process: API + relay; serves
`web/dist` same-origin too when present). Environment per
`docs/RUNBOOK.md` §6; minimum: `GH_DB_TOKEN`, `BOOTSTRAP_DB_MAX_AGE_MIN=60`,
`BOOTSTRAP_DB_REFRESH_MIN=45`, `CORS_ORIGINS=https://<static-host>`,
`EODHD_API_TOKEN` (owner adds it on the host; **not** present in GitHub
Actions and not needed there), `ASSISTANT_ACCESS=off` (default once
`CORS_ORIGINS` is set), `TRUSTED_PROXY_HOPS=1` behind the host proxy.
Health check path for the host: `/health/ready` (it touches the database; `/health/live` only proves the event loop is alive). Behind the host's proxy set `TRUSTED_PROXY_HOPS=1` so rate limits key on real clients.

On wake the bootstrap downloads a fresh DB when the on-disk one is older than
`BOOTSTRAP_DB_MAX_AGE_MIN`, validates it (header, `quick_check`, regime rows)
and swaps it atomically; `/api/freshness.bootstrap` exposes the last attempt,
result, asset `updated_at`, DB mtime and any sanitized error.

## 2. Full live mode (paid, always-on)

Same image on an always-on host (Fly.io `min_machines_running=1`, Railway
paid, Render paid) with exactly **one** instance: the relay keeps one
upstream EODHD socket per feed. Either split (static host + API) with
`VITE_API_BASE`/`VITE_WS_BASE`/`CORS_ORIGINS`/`CSP_CONNECT_SRC`, or
same-origin (the image serves `web/dist`; no CORS, no env on the frontend).

## 3. Security gates (built; verify after deploy)

- Assistant: `ASSISTANT_ACCESS` defaults to `off` whenever `CORS_ORIGINS` is
  set; `key` mode requires `X-Assistant-Key`; 10 req/min per client, 16 KB
  bodies, `Cache-Control: no-store`, no persistence of visitor chats.
- Every API path: 64 KB body cap, 600 req/min per client with a 120-request
  burst and 4000/min global (env-tunable), 4 concurrent expensive
  calculations, 12 concurrent provider requests, 24 concurrent stored-data
  reads; 429 with `Retry-After`. The relay socket is capped at 20 per client
  id and 200 in total, each connection at 30 messages/min and 40 new symbols/h.
  Behind a proxy set `TRUSTED_PROXY_HOPS` (the header is read from the
  right, never the spoofable left); set `OPS_ACCESS_KEY` to gate the two
  diagnostics views.
- Headers on every response: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; CSP
  on the served `index.html` (`connect-src 'self'` plus `CSP_CONNECT_SRC` —
  name the API/WS origin there in a split deploy).
- Inputs: symbols validated by charset/length before any provider call and
  normalized in `api/providers/symbols.py`; free-text search rejects path
  separators, `%`, `#`, `?` and control characters and every provider URL
  segment is percent-encoded; ranges, pagination (offset ≤ 10,000),
  expiration, strikes and tick windows are closed vocabularies; the
  assistant's SELECT-only SQL guard is untouched and still imported, never
  copied.
- Errors: provider failures return `{detail, kind, provider, retryable}`;
  unhandled exceptions return a generic 500; no tracebacks, URLs or tokens.
- Intentionally public endpoints: everything under `/api/*` except
  `/api/assistant/ask`, plus `/health/*` and the unprefixed Atlas routes —
  all read-only over stored data or provider caches.

## 4. Free-host research (official pages read 2026-09-06)

| Host | Free compute | Sleeps? | Card required | WebSockets | Notes |
|---|---|---|---|---|---|
| Render (free web service) | yes, 750 instance-hours/mo | yes, after ~15 min idle; cold start on next request | no | yes while awake | fits zero-cost mode; the relay stops while asleep |
| Fly.io | no free allowance for new orgs | n/a | yes | yes | paid path only |
| Railway | trial credit, then a paid plan | n/a | yes for paid | yes | paid path only |
| Koyeb | no free web-service compute at the time of checking | n/a | — | — | not an option |
| Cloudflare Workers / Durable Objects | free tier with WebSocket support | no | no | yes | would require rewriting the relay; not this codebase |
| Hugging Face Spaces (Docker) | free CPU tier sleeps; persistent always-on tiers are paid | yes | for paid tiers | yes | comparable to Render free |
| Vercel Hobby | static + serverless, free | static: no | no | no server-side WS | static frontend only |
| GitHub Pages | free for public repos | no | no | no | this repo is private → not free |
| Oracle Cloud Always Free VM | free VM | reclaimed when idle for long periods | yes (identity) | yes | possible but outside "no payment method" |

Conclusion stated plainly: **no compliant free host guarantees a continuous
WebSocket relay.** Zero-cost mode is honest about it (status word, snapshot
mode); the paid always-on mode is the only way to promise a live tape.

## 5. Owner actions before publication (outstanding gates)

1. Add `EODHD_API_TOKEN` (and `GH_DB_TOKEN`, `ANTHROPIC_API_KEY` if the
   assistant is wanted) to the API host's secret store. Nothing was created
   or transferred by the build.
2. Choose the hosts (section 1 or 2), set the env, deploy the image and the
   bundle; read the startup log block and the four health endpoints.
3. Push `react-rebuild` (or merge) and dispatch `Refresh Data` → `verify-only`
   once to see the validation summary; then `full`.
4. Decide on a keepalive (not built) and on the assistant access mode.

## 6. Rollback

Image hosts: redeploy the previous image; static host: promote the previous
deployment. Data: see `docs/RUNBOOK.md` §5 — the Release keeps the
last-known-good because uploads are validation-gated.

## 7. Pre-deploy checklist

- [ ] `make test-api` green (287 tests on 2026-09-06 with the local snapshot; the Streamlit-only module runs under the anaconda interpreter)
- [ ] `make test-web` green (typecheck + 25 vitest tests), `make build-web` produces route chunks
- [ ] `make actionlint` clean; `Refresh Data` dispatched once in `verify-only`
- [ ] Secrets only in the host store; `EODHD_API_TOKEN` present on the API host
- [ ] Post-deploy: `/health/ready` 200 (use it as the host's health probe, not `/health/live`), `/api/providers/status` shows the expected entitlements, `/api/stream/debug` not degraded during a session
- [ ] Static host: `snapshot/latest.json` reachable; stop the API once and confirm the shell says *Validated snapshot*
