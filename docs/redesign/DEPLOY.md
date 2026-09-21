# DEPLOY.md — publishing Macro Regime Radar (launch-1)

The site is two pieces: a static bundle on Vercel and one always-on FastAPI
container that holds the database, the EODHD relay and the assistant. This is
the runbook for putting them up, in order, with the prices and the secrets.

Status: **nothing is deployed and no account was created by the build.** Every
step below is one a human does. Prices were read from the vendors' pricing
pages on **2026-09-21** and are quoted as they appeared.

---

## 0. The shape, and why

| Piece | Where | Why |
|---|---|---|
| Static bundle (`web/dist`) + the validated snapshot | Vercel Hobby, free | It is files. It stays up when the API does not, and paints the last validated numbers from the snapshot. |
| API, relay, assistant | One always-on container, ≥ 1 GB | The relay holds one EODHD socket per feed, and the token allows 50 live symbols across every connection. **Exactly one instance. No autoscaling. No second copy in a preview environment.** |

Measured on this branch (launch-1, `docs/redesign-v2/LAUNCH_REPORT.md`): the
container settles at about 230 MiB of anonymous memory, and a database swap
rebuilds every derived result with the allocation child peaking inside the
same limit. Under a 1 GB cap it never came close to an OOM kill in a two-hour
soak. 512 MB is not enough headroom for the first pass; 1 GB is the floor and
2 GB is the comfortable choice.

---

## 1. Merge order (do this first, and in this order)

The API computes allocation from the `asset_prices` table that a **full**
refresh writes. A database published before that table exists makes the Tools
allocation panel say so, politely, forever.

1. **Merge the branch to `main`.**
2. **Run Actions → Refresh Data → Run workflow → branch `main`, mode `full`.**
   Wait for it to finish green. Its step summary must list `asset_prices` with
   rows and a max date equal to the last completed session.
3. **Only then deploy the API** (section 3), so its first bootstrap downloads a
   database that already carries the table.

This supersedes the "dispatch on the branch before merging" step in
`docs/redesign-v2/PRELAUNCH_REPORT.md`: dispatching on `main` after the merge
is the same publish with one fewer moving part.

---

## 2. Vercel (the static site)

**Price:** Hobby is free for personal, non-commercial projects. Vercel's own
pricing page is the reference; nothing in this repo needs a paid feature.

1. Sign in at vercel.com with the GitHub account that owns the repo.
2. **Add New → Project**, import `macro-regime-radar`.
3. **Root Directory:** `web`. Vercel reads `web/vercel.json` from there, which
   already carries the build command, the SPA rewrite, the security headers and
   the cache rules.
4. **Environment Variables** (Production, and Preview if you use previews):

   | Name | Value | Why |
   |---|---|---|
   | `VITE_API_BASE` | `https://<your-api-host>` | Where the bundle sends its API calls. No trailing slash. |
   | `VITE_WS_BASE` | `wss://<your-api-host>` | The relay socket. Optional: derived from `VITE_API_BASE` when unset. |
   | `GH_SNAPSHOT_TOKEN` | a fine-grained GitHub PAT, **Contents: Read** on this repo | The build downloads the validated snapshot from the private release. Without it the build still succeeds and the site simply starts without a pre-seeded snapshot. |

5. **Edit `web/vercel.json` once**: the Content-Security-Policy contains
   `REPLACE-WITH-API-HOST` twice. Replace both with your API host (no scheme in
   the placeholder position: the header already says `https://` and `wss://`).
   Commit that edit. The smoke script fails if the placeholder is still there.
6. **Deploy.** Then, in the project's **Settings → Git → Deploy Hooks**, create
   a hook named `snapshot-refresh` on the production branch and copy its URL.
7. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**, name `VERCEL_DEPLOY_HOOK`, value the hook URL. Every
   full refresh that publishes now asks Vercel to rebuild, so the site's
   fallback snapshot is never more than one full run old. Without the secret
   the refresh logs one line and carries on.

---

## 3. The API host

### 3a. Render (the default)

**Price, read 2026-09-21 from render.com/pricing.** Workspace: Hobby **$0/mo**
(up to 25 services, 5 GB bandwidth included, then $0.15/GB). Compute, per
service: **$7/month** for "less than 1 CPU, 512 MB RAM", **$25/month** for
"1 CPU, 2 GB RAM", $85/month for "2 CPU, 4 GB". WebSockets are listed as
available on every workspace plan, Hobby included. Free instances have
documented limitations (they spin down when idle), which is why they are not
an option here: a relay that sleeps is not a live tape.

**Take the $25/month 1 CPU / 2 GB instance.** It is the first tier with clear
headroom over the measured peak.

1. New → **Web Service** → connect the repo.
2. **Runtime: Docker.** Dockerfile path `./Dockerfile`, context `.`. Render
   builds the image itself; the CMD honours the `PORT` it assigns.
3. **Instance type:** 1 CPU / 2 GB ($25/month).
4. **Scaling:** leave it at **1 instance** and do not enable autoscaling. Two
   instances mean two relays on one token, and the second one gets
   `422 Symbols limit reached`.
5. **Health Check Path:** `/health/ready`. Not `/health/live`: readiness waits
   for the first background pass, so Render will not route traffic to a server
   that would answer "warming".
6. **Environment variables:** copy them from `deploy/api.env.example`, which
   lists every variable this process reads and the production value for each.
   The ones that must be set:

   | Name | Value |
   |---|---|
   | `DEPLOY_PUBLIC` | `1` |
   | `CORS_ORIGINS` | `https://<your-vercel-domain>` |
   | `EODHD_API_TOKEN` | your EODHD token |
   | `GH_DB_TOKEN` | fine-grained PAT, Contents: Read on this repo |
   | `OPS_ACCESS_KEY` | a long random string you keep |
   | `ASSISTANT_ACCESS` | `open` |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `FINNHUB_API_KEY` | your Finnhub key |
   | `BOOTSTRAP_DB_REFRESH_MIN` | `10` |
   | `TRUSTED_PROXY_HOPS` | `1` |
   | `ASSISTANT_DAILY_CAP_USD` | `1.0` |

   Render's UI puts these under **Environment → Environment Variables**; each
   value is stored encrypted and is not shown again after saving.
7. Deploy. Watch the log for the startup block: it states whether each secret
   resolved (yes/no, never the value), the effective CORS origins and the
   entitlement probe's verdicts.
8. Copy the service's URL into Vercel's `VITE_API_BASE` / `VITE_WS_BASE` and
   into the CSP in `web/vercel.json`, then redeploy the site.

### 3b. Fly.io (cheaper, more setup)

**Price, read 2026-09-21 from fly.io/docs/about/pricing:** a `shared-cpu-1x`
machine with 1 GB RAM is **$5.92/month** in Amsterdam, and pricing varies by
region (Mumbai is quoted at $9.20). Billing is for provisioned resources,
prorated. A payment method is required; there is no general free allowance.

It suits this workload if you are comfortable with `flyctl`: deploy the same
Dockerfile, set `[http_service] min_machines_running = 1` so the machine never
stops, and keep `auto_stop_machines` off. Set the same environment variables
with `fly secrets set`. Everything else in this runbook applies unchanged.

Choose Render for the shortest path, Fly to spend a quarter as much.

---

## 4. Local development once production is live

**Never run a local server with the production EODHD token.** The token allows
50 live symbols across every connection, and the relay's fixed universe uses
exactly 30 of them with 20 kept for what a visitor watches. A second process
takes those symbols and the deployed relay starts answering
`422 Symbols limit reached`.

Run local work with the relay off:

```bash
EODHD_API_TOKEN=" " .venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
```

A single space is deliberate: an empty value falls through to the repo's
`.env`, a space does not. The feeds stay off, the tape falls back to stored
closes, and everything else behaves normally. The alternative is a second
EODHD token for development.

---

## 5. After the deploy

Run the smoke script against the public URLs:

```bash
.venv/bin/python scripts/smoke_public.py --api https://<api-host> --site https://<site> --ops-key "$OPS_ACCESS_KEY"
```

It checks every route, readiness, that freshness can say how fresh it is, the
relay socket and its Origin allowlist, the assistant gate and its budget, the
security headers and the CSP, that the diagnostics are closed, and that no
feed is being refused for the symbol limit. Exit code 0 means every check
passed.

Then watch these for a day:

- `/health/ready` → `worker.errors` empty and `worker.held` null.
- `/api/freshness` → `overall` not `unknown`; the `sla` rows say what is late.
- `/api/providers/status` (with `X-Ops-Key`) → `quota.units_per_day_projected`.
  The deploy spends roughly 8,400 EODHD units on a weekday and about 1,500 at
  a weekend, against a paid plan's 100,000 a day.

---

## 6. Rollback

- **The site:** Vercel → Deployments → the previous production deployment →
  **Promote to Production**. Instant, no build.
- **The API:** Render → the service → Events → the previous deploy →
  **Rollback**. On Fly, `flyctl releases` then `flyctl deploy --image <previous>`.
- **The data:** nothing to undo. The release asset is replaced only after
  validation passes, so the last good database is the one still published; the
  API picks up whatever the release holds at its next check (10 minutes).
  `docs/RUNBOOK.md` §5 has the manual restore if a bad snapshot ever gets
  through.
- **The whole branch, before it is merged:** it is local. After the merge,
  `git revert -m 1 <merge-commit-sha>`.

---

## 7. The single-service alternative (fallback)

The image already serves the bundle: when `web/dist` exists, `api/main.py`
mounts it and answers the SPA's routes. So one container can serve the whole
site at one origin, with no Vercel project at all:

1. Deploy the image exactly as in section 3.
2. Leave `CORS_ORIGINS` **unset** (there is no second origin), and set
   `DEPLOY_PUBLIC=1` so the assistant and the diagnostics still take their
   public posture. This is why `DEPLOY_PUBLIC` exists: the posture must not
   depend on a variable a same-origin deploy has no reason to set.
3. Set `CSP_CONNECT_SRC` only if the socket lives on another host.
4. Point the domain at the service.

What you lose: the site goes down with the API, and the validated-snapshot
fallback has nothing to serve it from. What you gain: one thing to run, no CORS
and no `VITE_*` variables. Keep it in your pocket for the day Vercel is the
problem.

---

## 8. Owner checklist

- [ ] Merge to `main`; dispatch Refresh Data → `full` on `main`; it goes green and lists `asset_prices`.
- [ ] Vercel project created, root `web`, three environment variables set, CSP placeholder replaced.
- [ ] Deploy hook created and stored as the `VERCEL_DEPLOY_HOOK` repository secret.
- [ ] API service created from the Dockerfile: 1 instance, no autoscaling, ≥ 1 GB, health check `/health/ready`.
- [ ] Every secret from `deploy/api.env.example` entered in the host's store; none in git.
- [ ] `VITE_API_BASE` / `VITE_WS_BASE` point at the API; the site redeployed.
- [ ] `scripts/smoke_public.py` exits 0 against the public URLs.
- [ ] Local development switched to a blank EODHD token.
