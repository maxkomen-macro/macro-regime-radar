---
paths:
  - "src/config.py"
  - "api/**"
  - ".env.example"
  - "deploy/**"
  - ".streamlit/**"
  - "src/analytics/chat.py"
  - "src/analytics/news.py"
  - "src/analytics/perplexity.py"
  - ".github/workflows/**"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

## API Keys & Secrets

Secrets live in four places, inventoried by name in `deploy/ENV.md`: the API host's environment (Render), GitHub Actions repository secrets (the workflows), Vercel's build environment, and Streamlit Cloud secrets for the legacy dashboard (`st.secrets[]`). Locally: the repo-root `.env` (gitignored; `src/config.py` and the API read it), and `.streamlit/secrets.toml` (gitignored) for the legacy dashboard.

**Never hardcode keys. Never commit `.env` or `.streamlit/secrets.toml`.** The committed `.streamlit/secrets.toml.example` lists the legacy dashboard's key names; copy it to `.streamlit/secrets.toml` and fill values.

| Key | Status |
|---|---|
| `FRED_API_KEY` | Required — raises in `src/config.py:17` if missing |
| `FINNHUB_API_KEY` | Optional — news ingest, and since launch-1 the single-name panel's fundamentals on the API host (`api/providers/finnhub.py`; the key rides in a header, never a URL) |
| `EARNINGS_CACHE_KEY` | Optional — the Options Finder earnings cache's vault key (`src/events/earnings_store.py`). GitHub Actions secret for the refresh step (absent → the step skips) and the same value on the API host so the worker can open the vault and the ledger reader (`api/earnings_ledger_reader.py`) can open the ledger. A new value starts a new vault. The same key seals the durable ledger's release assets, which the refresh steps upload and fetch with the workflow's built-in `GITHUB_TOKEN` (no new secret). Never logged or printed |
| `FINDER_EARNINGS_DISPLAY` | API host setting, not a secret — the Finder's earnings display switch (`api/desk_options.py`), off unless `1`/`true`/`on`/`yes`. Off: hand-maintained earnings rows only (plan D6). The owner sets it, after Finnhub's written approval |
| `NEWS_API_KEY` | Optional — required for news ingest. **Note the underscore.** Code uses `NEWS_API_KEY`, not `NEWSAPI_KEY` |
| `ANTHROPIC_API_KEY` | Optional — required for AI regime interpretation |
| `PERPLEXITY_API_KEY` | Optional — required for Sonar research enrichment |
| `SEC_USER_AGENT` | Optional — the contact the SEC's fair-access policy asks automated clients to declare, read by the full refresh's positioning step (`src/market_data/sec_13f.py`, Desk P4). A GitHub Actions **secret**, not a variable: the public run log prints a variable's value and masks a secret's. Absent → the 13F step reads nothing and says so in its `sec_13f` watermark. Never commit, print or store it |
| `POLYGON_API_KEY` | Legacy — yfinance is the active path; no longer read by the pipeline. Safe to leave in secrets or remove |
| `GH_DB_TOKEN` | Fine-grained PAT with **Contents: Read** on this repo. Lets `dashboard/app.py` (Streamlit Cloud secret) and `api/bootstrap.py` (env var) download `data/macro_radar.db`, and lets the API's earnings ledger reader list and download the ledger assets (child process, token from the environment only), from the `data-latest` Release (public while it lives in this repo; see `.claude/rules/database.md`). Not needed locally; workflows use the built-in `GITHUB_TOKEN` |
| `DATA_RELEASE_TOKEN` | GitHub Actions secret, unset until private storage (`docs/data/PRIVATE_STORAGE.md`): Contents read and write on the private data repo. The data release steps use it only when the repository variable `DATA_RELEASE_REPO` names another repo, and fail before publishing without it. `DATA_RELEASE_REPO` itself is not a secret (API env, Streamlit secret, Vercel env, repository variable); unset means this repo |
| `EODHD_OPTIONS_TOKEN` | Optional — Desk D3's private SPY option-chain collector only (`src/market_data/option_snapshots.py`): a GitHub Actions secret passed in that one refresh step's `env`, never written to `.env`, never read by any other module (pinned by `tests/test_option_snapshots.py`). Same value as the API host's `EODHD_API_TOKEN`, under its own name so adding it cannot switch the stored histories from Yahoo to EODHD. Absent → the step prints `held` and makes no call |
| `OPTION_SNAPSHOT_REPO`, `OPTION_SNAPSHOT_GH_TOKEN` | Optional — the collector's private archive: `owner/name` of a separate **private** repository, and a fine-grained PAT restricted to that repository with **Contents: Read and write** (Metadata: Read is added with it). Actions secrets in that step only. The collector refuses a repository the API does not report as private, and this one. Absent → `held`. Never printed |
| `OPTION_SNAPSHOT_ENABLED` | Not a secret: an Actions repository **variable**, the owner's on/off switch for that step (`vars.` in the step's `env`, nowhere else). Only `true` collects; unset, `false` or anything else → `held detail=disabled…`, no call, no write. Off by default |
| `EODHD_API_TOKEN` | API only — read by `api/stream.py` and `api/providers/market.py` (env, else repo-root `.env`) for the live-quote relay and the on-demand provider layer. Absent → feeds stay off, on-demand lookups answer a typed `missing_token` error (no Yahoo fallback since fix/prelaunch-1), the client falls back to its DB poll. The refresh pipeline's stored histories use it when present (EODHD first) and fall back to Yahoo, disclosed, when absent. Never sent to the browser; redacted from logs by `api/logsafe.py`. **Not a GitHub Actions secret and not needed there** — an owner action on the API host |

Without the four optional Phase-11 keys, the news, AI interpretation, and research-citation pipelines silently produce no output (this is intentional — the dashboard still works for non-news functionality).
