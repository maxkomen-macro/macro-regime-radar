# DEPLOY.md — Phase 8 runbook (build everything, deploy nothing)

Status: **nothing is deployed.** This document is the runbook a human follows
when the go decision is made. Two working paths exist; the split deploy is the
architecture of record.

> **Pre-deploy security must-fixes:** see `FINAL_SECURITY_REVIEW.md` — the
> assistant endpoint (`POST /api/assistant/ask`) needs auth, rate-limiting,
> and request-size caps before any public exposure. Do not skip this gate.
> (If that file is not yet in the repo, it is the security-review phase's
> deliverable — block on it, not on its absence.)

---

## Architecture of record: SPLIT DEPLOY

React static bundle on **Vercel** + FastAPI backend on an **always-on host**.

```
Browser ──HTTPS──> Vercel (web/dist static)          ── UI, assets, fonts
   │
   └────HTTPS+CORS──> backend host (uvicorn api.main:app)  ── /api/*, Atlas routes
                          │
                          ├── GH_DB_TOKEN ──> data-latest Release (DB snapshot)
                          ├── EODHD_API_TOKEN ──> EODHD WS relay (api/stream.py)
                          └── ANTHROPIC_API_KEY ──> assistant (api/chat.py)
```

### Vercel (frontend)

Project settings:

| Setting | Value |
|---|---|
| Root directory | `web/` |
| Build command | `npm run build` |
| Output directory | `dist/` |
| Env var | `VITE_API_BASE=https://<backend-url>` |

`web/src/api/client.ts` already honors `VITE_API_BASE` (defaults to `""` =
same-origin when unset). Vercel's SPA rewrite: add `web/vercel.json` with
`{"rewrites": [{"source": "/(.*)", "destination": "/index.html"}]}` at deploy
time so `/app/*` and `/kit` deep links resolve.

### Backend (always-on host)

**One instance only, ever.** EODHD allows one WS connection per feed per
token (memory: eodhd-stream-relay); a second instance would fight the first
for the upstream sockets. Horizontal scaling is off the table until the relay
is externalized.

| Host | Always-on? | Notes |
|---|---|---|
| **Railway** | Yes (paid usage-based; no forced sleep on paid plan) | Simplest Dockerfile deploy; private networking not needed here |
| **Render** | Paid tier yes; **free tier NO** — spins down after idle and kills the relay + in-process caches | Free tier is disqualified for this app, not merely degraded |
| **Fly.io** | Yes, if `min_machines_running = 1` and auto-stop disabled | Cheapest always-on VM; config is the sharpest of the three |

**Idle-shutdown is the open question to answer before choosing:** the EODHD
relay and the 15-min TTL analytics caches die with the process. Any host
setting that stops the machine on idle silently converts the live tape into
the 30s DB-poll fallback and makes first requests slow (model retrain).
Confirm the chosen plan keeps exactly one machine running 24/7.

Backend env (set in the HOST's secret store by the human — never committed,
never in the image):

| Var | Required? | Purpose |
|---|---|---|
| `CORS_ORIGINS` | Yes (split deploy) | Comma-separated allowlist replacing the Vite dev defaults, e.g. `https://<project>.vercel.app` |
| `GH_DB_TOKEN` | Yes | Read-only **Contents** PAT on maxkomen-macro/macro-regime-radar; `api/bootstrap.py` downloads the DB from the private `data-latest` Release at startup |
| `BOOTSTRAP_DB_MAX_AGE_MIN` | No | Startup re-download when the on-disk DB is older than N min (unset = download only if missing) |
| `BOOTSTRAP_DB_REFRESH_MIN` | No | Background re-download every N min (0/unset = disabled). Set ~60 in production so the DB tracks the hourly refresh workflows |
| `EODHD_API_TOKEN` | Optional feature gate | Live tape relay; absent → feeds stay off, client falls back to DB polling |
| `ANTHROPIC_API_KEY` | Optional feature gate | Assistant endpoint; absent → assistant returns its configured-off error |

The lifespan logs an honest startup block (dist mounted, DB mtime, token
presence yes/no, effective CORS) — read it after every deploy.

### Split-deploy commands (human runs)

```bash
# 1. Backend — from repo root, image build and push per host's own flow, e.g. Fly:
fly launch --no-deploy          # once; creates fly.toml (set min_machines_running=1)
fly secrets set CORS_ORIGINS=https://<project>.vercel.app GH_DB_TOKEN=... \
    BOOTSTRAP_DB_REFRESH_MIN=60 EODHD_API_TOKEN=... ANTHROPIC_API_KEY=...
fly deploy                      # builds the repo Dockerfile

# Railway equivalent: railway init && railway up (Dockerfile auto-detected),
# secrets via the dashboard. Render: new Web Service → Docker → this repo.

# 2. Frontend:
cd web && npx vercel            # link project; set root=web, build=npm run build, output=dist
npx vercel env add VITE_API_BASE   # value: https://<backend-url>
npx vercel --prod
```

### WebSocket honesty (split deploy)

Vercel does **not** proxy the WebSocket. `web/src/live/quotes.ts:108` connects
to `` `${proto}://${window.location.host}/api/stream/ws` `` — the **page's own
host**, i.e. Vercel — so in the split deploy the socket never reaches the
backend and closes. The client's designed fallback then applies: consumers
poll the DB-backed REST endpoints on a 30s cadence
(`web/src/api/queries.ts:129`, `refetchInterval: 30_000`). **In split mode the
live tape degrades to 30s polling.** Fixing that later means adding a
`VITE_WS_BASE`-style override in quotes.ts (small change, not built in Phase
8) or moving to the same-origin path below, where the socket works as-is.

---

## Same-origin alternative (what the Dockerfile enables)

Phase 8's step 1 made `api/main.py` mount `web/dist` when present: **one
container serves the UI, the API, and the WebSocket from one origin.** No
CORS_ORIGINS, no VITE_API_BASE, live tape fully working. The trade: no CDN in
front of the static assets, and the single instance carries all traffic.

```bash
docker build -t mrr-api .
docker run --rm -p 8000:8000 \
  -e GH_DB_TOKEN=... -e BOOTSTRAP_DB_REFRESH_MIN=60 \
  -e EODHD_API_TOKEN=... -e ANTHROPIC_API_KEY=... \
  mrr-api
# open http://localhost:8000 — UI, /api/*, and /api/stream/ws all same-origin
```

Deploy the same image to any one always-on Docker host (same table and
one-instance rule as above). The image ships **no** DB, no .env, no dashboard/
— data arrives at startup via `GH_DB_TOKEN`. First build is slow: stage 1 runs
`npm ci` + Vite, stage 2 installs the scientific Python stack
(scikit-learn, riskfolio-lib).

Local no-docker equivalent (what the tests exercise): build the bundle
(`cd web && npm run build`), then run uvicorn — main.py finds `web/dist` and
serves it.

---

## Rollback

Image-based hosts: **redeploy the previous image** (`fly releases` →
`fly deploy --image <previous>`; Railway/Render: redeploy prior build from
the dashboard). Vercel: promote the previous deployment (`vercel rollback`).
The DB needs no rollback — it re-bootstraps from `data-latest` on start.

---

## Pre-deploy checklist

- [ ] `FINAL_SECURITY_REVIEW.md` must-fixes done (assistant auth / rate-limit / size caps)
- [ ] `pytest tests/test_api.py` green, including the Phase 8 SPA tests
- [ ] Exactly ONE backend instance configured; idle-shutdown/sleep disabled
- [ ] Secrets set in the host store only; nothing in git, nothing in the image
- [ ] Post-deploy: read the startup log block; confirm DB mtime is recent and tokens show "yes"
- [ ] Split deploy only: accept (or fix) the 30s-poll tape degradation before announcing "live" quotes
