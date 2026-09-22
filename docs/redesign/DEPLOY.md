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
same limit. The report carries the two-hour soak under a 1 GB cap. 512 MB is
not enough headroom for the first pass; 1 GB is the floor and 2 GB is the
comfortable choice.

### Before you start: names, accounts and repository access

The site needs the API's address and the API needs the site's, so pick both
names first and write them down:

- **The site:** the Vercel project name becomes `https://<project>.vercel.app`.
  If that name is taken, Vercel adds a suffix too: read the real domain on the
  project's page and use it in `CORS_ORIGINS`.
- **The API:** the Render service name becomes `https://<service>.onrender.com`.
  If the name is taken, Render adds a suffix: read the real URL on the
  service's page after creating it and correct the site's settings if it differs.

Vercel and Render each ask to install their GitHub app when you import the
repository. The repo is private, so grant the app access to
`macro-regime-radar` (or to all repositories) when asked.

### The two read-only GitHub tokens

Both are fine-grained personal access tokens, created the same way:
**GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token.**

1. **Resource owner:** the account or organisation that owns the repository
   (`maxkomen-macro`). If that is an organisation, it may have to approve the
   token before it works. **Repository access:** Only select repositories →
   `macro-regime-radar`.
2. **Permissions → Repository permissions → Contents: Read-only** (GitHub adds
   Metadata: Read-only by itself). Nothing else.
3. **Expiration:** GitHub pre-selects 30 days. Pick the longest your account
   allows and put a reminder in your calendar a week before it.

Make two, one per use, so either can be revoked alone:

| Token | Where it goes | When it expires |
|---|---|---|
| `GH_SNAPSHOT_TOKEN` | Vercel environment variable | Builds still succeed but ship without a fresh snapshot: the build log says so, and the site paints from the API alone. |
| `GH_DB_TOKEN` | API host environment variable | The API stops picking up new databases. After a restart it has no database at all (it lives on the container's own disk) and answers 503 until a new token is set. Renew it before it expires. |

---

## 1. Merge order (do this first, and in this order)

The API computes allocation from the `asset_prices` table that a **full**
refresh writes. A database published before that table exists makes the Tools
allocation panel say so until the next full refresh publishes one that has it.

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

**Price, read 2026-09-21 from vercel.com/pricing:** Hobby is **$0/month**, for
personal, non-commercial use, with 100 GB of Fast Data Transfer a month
included. Nothing in this repo needs a paid feature.

1. Sign in at vercel.com with the GitHub account that owns the repo.
2. **Add New → Project**, import `macro-regime-radar` (grant the Vercel app
   access to it when asked).
3. **Root Directory:** `web`. Vercel reads `web/vercel.json` from there, which
   already carries the build command, the SPA rewrite, the security headers and
   the cache rules.
4. **Environment Variables** (Production, and Preview if you use previews).
   Use the API address you chose above; section 3 creates it.

   | Name | Value | Why |
   |---|---|---|
   | `VITE_API_BASE` | `https://<service>.onrender.com` | Where the bundle sends its API calls. No trailing slash. |
   | `VITE_WS_BASE` | `wss://<service>.onrender.com` | The relay socket. Optional: derived from `VITE_API_BASE` when unset. |
   | `GH_SNAPSHOT_TOKEN` | the snapshot token from section 0 | The build downloads the validated snapshot from the private release. |

   `web/.env.example` lists these and the build command's optional ones.
5. **Edit `web/vercel.json` once**: the Content-Security-Policy contains
   `REPLACE-WITH-API-HOST` twice. Replace both with the API's host name
   (`<service>.onrender.com`: the header already says `https://` and
   `wss://`). Commit that edit to `main`. The smoke script fails if the
   placeholder is still there or if the CSP names a different host.
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
"1 CPU, 2 GB RAM", $85/month for "2 CPU, 4 GB". Disks: **$0.25 per GB per
month**, prorated by the second. WebSockets are listed as available on every
workspace plan, Hobby included. Free instances spin down when idle, which is
why they are not an option here: a relay that sleeps is not a live tape.

**Take the $25/month 1 CPU / 2 GB instance with a 1 GB disk ($25.25/month).**
It is the first tier with clear headroom over the measured peak.

1. **New → Web Service** → connect the repo (grant the Render app access to it
   when asked). Use the service name you chose in section 0.
2. **Runtime: Docker.** Dockerfile path `./Dockerfile`, context `.`. Render
   builds the image itself; the CMD honours the `PORT` it assigns.
3. **Instance type:** 1 CPU / 2 GB ($25/month).
4. **Scaling:** leave it at **1 instance** and do not enable autoscaling. Two
   instances mean two relays on one token, and the second one gets
   `422 Symbols limit reached`.
5. **Health Check Path:** `/health/ready`. Not `/health/live`: readiness waits
   for the first background pass, so Render will not route traffic to a server
   that would answer "warming".
6. **Disk:** Advanced → **Add Disk**, mount path `/var/data`, size **1 GB**. It
   holds the assistant's spend ledger, so the $1 ceiling is per day rather than
   per process: without it every restart or deploy starts a fresh ledger, and
   the day can spend $1 again after each one. Render documents two effects of
   a disk: the service cannot scale past one instance, which it must never do
   anyway, and deploys are no longer zero-downtime. The second one helps here:
   a zero-downtime deploy runs the old and the new instance side by side for a
   while, which is two relays on one token. With the disk, a deploy is a short
   outage instead, and the site paints its snapshot meanwhile.
7. **Settings → Build & Deploy → Auto-Deploy: Off.** Every validated full
   refresh commits `output/playbook.json` to `main`, about twelve times a week,
   and Render skips an auto-deploy only for `[skip render]`, `[render skip]`,
   `[skip deploy]` or `[skip cd]` in the message, not for the workflow's
   `[skip ci]`. With Auto-Deploy on, each of those commits would restart the
   API. Deploy by hand after a merge instead (**Manual Deploy → Deploy latest
   commit**).
8. **Environment variables:** copy them from `deploy/api.env.example`, which
   lists every variable this process reads and the production value for each.
   The ones that must be set:

   | Name | Value |
   |---|---|
   | `DEPLOY_PUBLIC` | `1` |
   | `CORS_ORIGINS` | `https://<project>.vercel.app` |
   | `EODHD_API_TOKEN` | your EODHD token |
   | `GH_DB_TOKEN` | the database token from section 0 |
   | `OPS_ACCESS_KEY` | a long random string you keep |
   | `ASSISTANT_ACCESS` | `open` |
   | `ANTHROPIC_API_KEY` | the site's own key (section 3c) |
   | `FINNHUB_API_KEY` | your Finnhub key |
   | `BOOTSTRAP_DB_REFRESH_MIN` | `10` |
   | `CLIENT_IP_HEADER` | `cf-connecting-ip` |
   | `TRUSTED_PROXY_HOPS` | `2` |
   | `ASSISTANT_DAILY_CAP_USD` | `1.0` |
   | `ASSISTANT_LEDGER_PATH` | `/var/data/assistant_spend.db` (on the disk from step 6) |

   Render's UI puts these under **Environment → Environment Variables**.
   `CLIENT_IP_HEADER` and `TRUSTED_PROXY_HOPS` are how the rate limits find a
   visitor's own address: Render is fronted by Cloudflare, so requests arrive
   with `X-Forwarded-For: <visitor>, <Cloudflare edge>` and a
   `CF-Connecting-IP` header Cloudflare sets itself. Section 5 checks it.
9. **Deploy.** Watch the log for the startup block. Before the first download
   it says `DB MISSING`, which is expected; the bootstrap fetches the database
   straight after. The block states, as yes/no and never as values, whether
   each key resolved, then the public posture, the assistant mode, the daily
   cap, the ledger path and whether it is writable, where the client address is
   read from, and the effective CORS origins.
10. If Render gave the service a different URL from the one you planned, fix
    `VITE_API_BASE`, `VITE_WS_BASE` and the CSP in `web/vercel.json`, and
    redeploy the site.

### 3b. Fly.io (cheaper, more setup)

**Price, read 2026-09-21 from fly.io/docs/about/pricing:** a `shared-cpu-1x`
machine with 1 GB RAM is **$5.92/month** in Amsterdam and **$5.70/month** in
Ashburn, Virginia, the closest region to US visitors; with 2 GB it is $11.11
and $10.70. Other regions cost more or less, and the page's region selector
shows each one. Volumes are **$0.15 per GB per month** of provisioned capacity.
Billing is for provisioned resources, prorated, and a payment method is
required.

It suits this workload if you are comfortable with `flyctl`:

1. Deploy the same Dockerfile with **one machine**: `fly deploy --ha=false`.
   Fly's default is two machines for availability, which here is two relays on
   one token; `fly scale count 1` fixes an app that already has two.
2. In `fly.toml`, `[http_service]` needs `internal_port = 8000` (the image
   listens there unless `PORT` is set), `min_machines_running = 1`, and
   `auto_stop_machines` off, so the machine never sleeps.
3. Create a 1 GB volume for the spend ledger (`fly volumes create data
   --size 1`), mount it at `/var/data` with a `[mounts]` section, and set
   `ASSISTANT_LEDGER_PATH=/var/data/assistant_spend.db`.
4. Set the same environment variables with `fly secrets set`, except the
   client address: `CLIENT_IP_HEADER=fly-client-ip` and `TRUSTED_PROXY_HOPS=1`.

Everything else in this runbook applies unchanged. Choose Render for the
shortest path, Fly to spend less: 2 GB in Ashburn is $10.70 a month against
Render's $25.

### 3c. A backstop for the assistant's bill

The server holds the assistant to `ASSISTANT_DAILY_CAP_USD` itself: every model
call is reserved in the ledger at its worst case before it is made, so neither
a visitor who hangs up nor questions that arrive together can carry the day
past $1. Put a second limit where no bug in this repo can reach it:

1. In the Claude Console, **Settings → Workspaces → Create workspace**, for
   example `radar-site`.
2. Create the site's API key **inside that workspace** and use it as the
   host's `ANTHROPIC_API_KEY`. Keep the news pipeline's key separate.
3. Open the workspace → **Limits** → **Change Limit**, and set the monthly spend
   limit to **$35**: 31 days at $1 with a little room. Anthropic enforces it on
   every request, so even a ledger lost with its disk cannot cost more.

---

## 4. Local development once production is live

**Never run a local process with the production EODHD token.** The token
allows 50 live symbols across every connection, and the relay's fixed universe
uses exactly 30 of them with 20 kept for what a visitor watches. A second
process takes those symbols and the deployed relay starts answering
`422 Symbols limit reached`.

The rule is about the repo's `.env` as much as the shell: every local server,
`make snapshot` (`scripts/build_snapshot.py` starts the app, relay included)
and the tests read `EODHD_API_TOKEN` from the environment and fall back to the
repo-root `.env`. So once production is live:

1. **Delete the production token from `.env`** (leave the line as
   `EODHD_API_TOKEN=`, or put a separate development token there). The
   production token lives only in the API host's settings.
2. Run local servers with the relay off:

   ```bash
   EODHD_API_TOKEN=" " .venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
   ```

   A single space is deliberate: an empty value falls through to `.env`, a
   space does not. The feeds stay off, the tape falls back to stored closes,
   and everything else behaves normally.

---

## 5. After the deploy

Run the smoke script against the public URLs, with your own public address
(from your router, or `curl https://ifconfig.me`):

```bash
.venv/bin/python scripts/smoke_public.py --api https://<service>.onrender.com --site https://<project>.vercel.app --ops-key "$OPS_ACCESS_KEY" --my-ip <your-address>
```

It checks every route, readiness, that freshness can say how fresh it is, the
relay socket and its Origin allowlist, the assistant gate, its budget and its
ledger, the security headers and that the site's CSP names the API, that the
diagnostics are closed, that the rate limits key on your address rather than
a proxy's, and that no feed is being refused for the symbol limit. Exit code 0
means every check passed.

One warning and three failures have a fix outside the code:

- **"assistant ledger disk … the container's own disk" (a warning):** the disk
  from section 3a step 6 is missing, so every restart starts a fresh day's
  ledger. Attach it, or accept that and rely on the workspace limit.
- **"assistant ledger … read-only" or "unavailable":** the disk at `/var/data`
  is not writable by the container's user (uid 10001). Remove
  `ASSISTANT_LEDGER_PATH` so the ledger lives in `/app/data` on the container's
  own disk: the ceiling then holds per day between restarts, and the workspace
  limit in section 3c holds the month. The startup log names the same problem.
- **"client address … every visitor shares one bucket":** set
  `CLIENT_IP_HEADER` as in section 3 (or adjust `TRUSTED_PROXY_HOPS`) until
  `GET /api/ops/whoami` with the `X-Ops-Key` header shows your own address as
  `client_id`.
- **"client address header … a forged … became the key":** the host's edge does
  not overwrite that header, so a visitor could pick its own rate-limit key.
  Unset `CLIENT_IP_HEADER` and rely on `TRUSTED_PROXY_HOPS`.

Then watch these for a day:

- `/health/ready` → `worker.errors` empty and `worker.held` null.
- `/api/freshness` → `overall` not `unknown`; the `sla` rows say what is late.
- `/api/providers/status` (with `X-Ops-Key`) → `quota.units_per_day_projected`
  and `plan.daily_limit`. The deploy spends up to about 8,500 EODHD units on a
  weekday and about 1,500 at a weekend, against the plan's 100,000 a day
  (EODHD's own `/api/user`, read 2026-09-21).

---

## 6. Rollback

- **The site:** Vercel → the project's overview → the Production Deployment
  tile → **Instant Rollback**, pick the deployment, **Confirm Rollback**.
  Instant, no build. On Hobby the choice is the immediately previous
  production deployment. After a rollback, new pushes to `main` do not go live
  until you press **Undo Rollback** on the same tile.
- **The API:** Render → the service → Events → the previous deploy →
  **Rollback**. On Fly, `fly releases` then `fly deploy --image <previous>`.
- **The data:** nothing to undo. The release asset is replaced only after
  validation passes, so the last good database is the one still published; the
  API picks up whatever the release holds at its next check (10 minutes).
  `docs/RUNBOOK.md` §5 has the manual restore if a bad snapshot ever gets
  through.
- **The whole branch:** before it is merged, it is local. After the merge:

  ```bash
  git revert -m 1 <merge-commit-sha> && git push origin main
  ```

  Then deploy the API by hand (Auto-Deploy is off) and let Vercel build the
  reverted `main`.

---

## 7. The single-service alternative (fallback)

The image already serves the bundle: when `web/dist` exists, `api/main.py`
mounts it, answers the SPA's routes and serves the files at its root. So one
container can serve the whole site at one origin, with no Vercel project at
all:

1. Deploy the image exactly as in section 3.
2. Leave `CORS_ORIGINS` **unset** (there is no second origin), and set
   `DEPLOY_PUBLIC=1` so the assistant, the diagnostics and the relay socket
   take their public posture: the socket then accepts only the page's own
   origin. This is why `DEPLOY_PUBLIC` exists: the posture must not depend on
   a variable a same-origin deploy has no reason to set.
3. Set `CSP_CONNECT_SRC` only if the socket lives on another host.
4. Point the domain at the service.

What you lose: the site goes down with the API, and the validated-snapshot
fallback has nothing to serve it from (an image built from git carries no
snapshot: the file is gitignored). What you gain: one thing to run, no CORS
and no `VITE_*` variables. Keep it in your pocket for the day Vercel is the
problem.

---

## 8. Owner checklist

- [ ] Names chosen for the Vercel project and the Render service; both GitHub tokens created, with expiry reminders.
- [ ] Merge to `main`; dispatch Refresh Data → `full` on `main`; it goes green and lists `asset_prices`.
- [ ] Vercel project created, root `web`, three environment variables set, CSP placeholder replaced with the API host.
- [ ] Deploy hook created and stored as the `VERCEL_DEPLOY_HOOK` repository secret.
- [ ] API service created from the Dockerfile: 1 instance, no autoscaling, ≥ 1 GB, health check `/health/ready`, a 1 GB disk at `/var/data`, Auto-Deploy off.
- [ ] Every secret from `deploy/api.env.example` entered in the host's store; none in git.
- [ ] The site's Anthropic key made in its own Console workspace with a $35 monthly limit.
- [ ] `scripts/smoke_public.py … --my-ip <your-address>` exits 0 against the public URLs.
- [ ] The production EODHD token deleted from the local `.env`; local servers run with a blank token.
