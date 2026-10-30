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

All secrets via `st.secrets[]` in production (Streamlit Cloud secrets manager). Locally, `.streamlit/secrets.toml` (gitignored). GitHub Actions secrets in repo settings.

**Never hardcode keys. Never commit `.streamlit/secrets.toml`.** The committed `.streamlit/secrets.toml.example` contains all key names; copy it to `.streamlit/secrets.toml` and fill values.

| Key | Status |
|---|---|
| `FRED_API_KEY` | Required — raises in `src/config.py:17` if missing |
| `FINNHUB_API_KEY` | Optional — news ingest, and since launch-1 the single-name panel's fundamentals on the API host (`api/providers/finnhub.py`; the key rides in a header, never a URL) |
| `EARNINGS_CACHE_KEY` | Optional — the Options Finder earnings cache's vault key (`src/events/earnings_store.py`). GitHub Actions secret for the refresh step (absent → the step skips) and the same value on the API host so the worker can open the vault. A new value starts a new vault. The same key seals the durable ledger's release assets, which the refresh steps upload and fetch with the workflow's built-in `GITHUB_TOKEN` (no new secret). Never logged or printed |
| `FINDER_EARNINGS_DISPLAY` | API host setting, not a secret — the Finder's earnings display switch (`api/desk_options.py`), off unless `1`/`true`/`on`/`yes`. Off: hand-maintained earnings rows only (plan D6). The owner sets it, after Finnhub's written approval |
| `NEWS_API_KEY` | Optional — required for news ingest. **Note the underscore.** Code uses `NEWS_API_KEY`, not `NEWSAPI_KEY` |
| `ANTHROPIC_API_KEY` | Optional — required for AI regime interpretation |
| `PERPLEXITY_API_KEY` | Optional — required for Sonar research enrichment |
| `POLYGON_API_KEY` | Legacy — yfinance is the active path; no longer read by the pipeline. Safe to leave in secrets or remove |
| `GH_DB_TOKEN` | Fine-grained PAT with **Contents: Read** on this repo. Lets `dashboard/app.py` (Streamlit Cloud secret) and `api/bootstrap.py` (env var) download `data/macro_radar.db` from the private `data-latest` Release. Not needed locally; workflows use the built-in `GITHUB_TOKEN` |
| `EODHD_API_TOKEN` | API only — read by `api/stream.py` and `api/providers/market.py` (env, else repo-root `.env`) for the live-quote relay and the on-demand provider layer. Absent → feeds stay off, on-demand lookups answer a typed `missing_token` error (no Yahoo fallback since fix/prelaunch-1), the client falls back to its DB poll. The refresh pipeline's stored histories use it when present (EODHD first) and fall back to Yahoo, disclosed, when absent. Never sent to the browser; redacted from logs by `api/logsafe.py`. **Not a GitHub Actions secret and not needed there** — an owner action on the API host |

Without the four optional Phase-11 keys, the news, AI interpretation, and research-citation pipelines silently produce no output (this is intentional — the dashboard still works for non-news functionality).
