# Environment inventory

This file lists names only and never values. It says where each variable is set, so a key rotation updates every copy.
It was taken from the code on 2026-09-24 (main `30515f7`) by grepping `os.environ`, `getenv`, `get_secret`,
`import.meta.env`, `process.env` and `secrets.*` in the workflows. When the code starts reading a new name, add it here.

The two deploy surfaces are the **API image** (the `Dockerfile`, served on Render) and the **web build**
(Vercel runs `web/vercel.json`'s build command; the Dockerfile's `webbuild` stage builds the same bundle).
`deploy/api.env.example` gives the API's values and what each one does, and `web/.env.example` does the same for Vercel.

## Rotation checklist: where each secret lives

| Secret | Render (API) | GitHub Actions repo secret | Vercel | Streamlit Cloud | Local `.env` / `secrets.toml` |
|---|---|---|---|---|---|
| `EODHD_API_TOKEN` | yes | no | no | no | repo-root `.env` (dev relay) |
| `GH_DB_TOKEN` (fine-grained PAT, Contents: Read) | yes | no (workflows use the built-in `GITHUB_TOKEN`) | no | yes | no |
| `GH_SNAPSHOT_TOKEN` (fine-grained PAT, Contents: Read) | no | no | yes | no | no |
| `OPS_ACCESS_KEY` | yes | no | no | no | no |
| `ASSISTANT_ACCESS_KEY` (only when `ASSISTANT_ACCESS=key`) | if used | no | no | no | no |
| `ANTHROPIC_API_KEY` | yes | yes (refresh-data, daily-memo) | no | yes | optional |
| `FINNHUB_API_KEY` | yes | yes (refresh-data) | no | yes (if set) | optional |
| `FRED_API_KEY` | no | yes (refresh-data, weekly-memo) | no | yes | yes |
| `NEWS_API_KEY` | no | yes (refresh-data) | no | yes (if set) | optional |
| `PERPLEXITY_API_KEY` | no | yes (refresh-data, daily-memo) | no | yes (if set) | optional |
| `VERCEL_DEPLOY_HOOK` (a URL that works as a credential) | no | yes (refresh-data) | created in Vercel | no | no |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `MEMO_RECIPIENTS` | no | yes (daily-memo, weekly-memo) | no | no | no |

The Streamlit Cloud column comes from the dashboard's `st.secrets` reads, not from the deploy code.
Before rotating, check the Streamlit app's secrets page for what is really set there.
`FINNHUB_API_KEY` can be one key or two. `deploy/api.env.example` recommends a separate key for the API
so that the news refresh cannot use up the API's per-minute allowance. If you use two, rotate each one where it lives.

## API image (Render)

These are read by the API process (`api/`, plus the config-free `src/analytics/*` modules it imports).
The process never imports `src.config`, so it does not read `FRED_API_KEY` or the other pipeline keys, even though
`src/` is in the image.

**Secrets**

- `EODHD_API_TOKEN`: live relay and on-demand lookups. If the environment has no value, the loader falls back to the repo-root `.env`.
- `GH_DB_TOKEN`: downloads the database from the `data-latest` release.
- `OPS_ACCESS_KEY`: opens the diagnostics views.
- `ANTHROPIC_API_KEY`: the assistant. `src/analytics/chat.py` looks in the environment, then `st.secrets`, then the repo-root `.env`.
- `FINNHUB_API_KEY`: fundamentals for the single-name panel.
- `ASSISTANT_ACCESS_KEY`: used only in `ASSISTANT_ACCESS=key` mode.

**Configuration (not secret)**

- Posture: `DEPLOY_PUBLIC`, `CORS_ORIGINS`, `CSP_CONNECT_SRC`
- Assistant: `ASSISTANT_ACCESS`, `ASSISTANT_DAILY_CAP_USD`, `ASSISTANT_LEDGER_PATH`, `ASSISTANT_MAX_CONCURRENCY`
- Client address: `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`, `TRUST_X_FORWARDED_FOR` (legacy)
- Database bootstrap: `BOOTSTRAP_DB_REFRESH_MIN`, `BOOTSTRAP_DB_MAX_AGE_MIN` (legacy; it is reported and changes nothing)
- Limits: `MAX_BODY_BYTES`, `RATE_LIMIT_PER_CLIENT_PER_MIN`, `RATE_LIMIT_PER_CLIENT_BURST`, `RATE_LIMIT_GLOBAL_PER_MIN`,
  `RATE_LIMIT_GLOBAL_BURST`, `WS_MAX_PER_CLIENT`, `WS_MAX_TOTAL`, `DB_MAX_CONCURRENCY`, `PROVIDER_MAX_CONCURRENCY`,
  `DESK_STUDY_MAX_CONCURRENCY`
- Runtime: `PREFETCH_MARKET`, `EODHD_PROBE_ON_START`, `GC_FREEZE`, `WORKER_WAIT_S` (for the test harness only)
- Container: `PORT` (Render sets it, and the image's CMD reads it). The Dockerfile sets `PYTHONUNBUFFERED` and `PIP_NO_CACHE_DIR` itself.
  **Do not set `WEB_CONCURRENCY`.** The CMD pins `--workers 1` because a second worker would start a second EODHD relay on the same token.

## Web build

**Vercel project environment**

- Build command (`web/scripts/fetch-snapshot.mjs`): `GH_SNAPSHOT_TOKEN` (secret; `GH_TOKEN` is the fallback), plus
  `SNAPSHOT_REPO`, `SNAPSHOT_TAG` and `SNAPSHOT_ASSET`, which are optional and have defaults.
- Bundle, fixed at build time and public once built: `VITE_API_BASE`, `VITE_WS_BASE`, `VITE_SNAPSHOT_URL`.
  **Never put a secret in a `VITE_` variable.** Vite inlines every `VITE_` value into the JavaScript that ships to browsers.
- `VITE_PROXY_TARGET` is read only by `vite.config.ts` for `npm run dev`, and never by a build.

**Dockerfile `webbuild` stage**

This stage reads no variables. It declares no `ARG` or `ENV`, and it runs no snapshot fetch. The bundle it builds
calls the API on its own origin (`VITE_API_BASE` unset), which is right for the single-image deploy.

## GitHub Actions (repository secrets)

| Workflow | Secrets |
|---|---|
| `refresh-data.yml` | `FRED_API_KEY`, `ANTHROPIC_API_KEY`, `FINNHUB_API_KEY`, `NEWS_API_KEY`, `PERPLEXITY_API_KEY`, `VERCEL_DEPLOY_HOOK`, `GITHUB_TOKEN` (built in) |
| `intraday-refresh.yml` | `GITHUB_TOKEN` (built in) |
| `daily-memo.yml` | `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `MEMO_RECIPIENTS`, `GITHUB_TOKEN` (built in) |
| `weekly-memo.yml` | `FRED_API_KEY`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `MEMO_RECIPIENTS`, `GITHUB_TOKEN` (built in) |

`GITHUB_TOKEN` is issued for each run and is never rotated by hand. Actions has no `EODHD_API_TOKEN` secret.
When that token is absent, the refresh pipeline's stored histories fall back to Yahoo and say so.

The pipeline code also reads `POLYGON_API_KEY` (legacy, and nothing sets it), `MARKET_DAILY_BACKFILL_YEARS` (optional),
and `GITHUB_ACTIONS` and `GITHUB_RUN_ID`, which the Actions runner sets itself.
