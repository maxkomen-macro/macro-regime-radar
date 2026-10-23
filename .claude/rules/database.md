---
paths:
  - "data/**"
  - "src/**"
  - "scripts/**"
  - "api/bootstrap.py"
  - "api/db.py"
  - "dashboard/app.py"
  - ".github/workflows/**"
  - "Makefile"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

> **Correction (2026-10-22):** the repo is public on purpose, so the `data-latest` asset is publicly downloadable without a token (`curl -fsSL -o data/macro_radar.db https://github.com/maxkomen-macro/macro-regime-radar/releases/download/data-latest/macro_radar.db`). The lines below that call the repo private are history. `GH_DB_TOKEN` is still wired into `api/bootstrap.py` and the Streamlit app; don't remove it without the owner.

## Database

`data/macro_radar.db` is the SQLite store (11 tables; 10 excluding `sqlite_sequence`).

**It is NOT in git.** Committing this ~10 MB binary on every hourly refresh bloated the repo
to ~283 MB and broke Streamlit Cloud's deploy clone (the clone timed out → "Failed to
download the sources"). As of Jun 2026 the DB is **gitignored** and shipped as a rolling
**GitHub Release asset** on the **`data-latest`** tag instead:

- **Writers** (`refresh-data.yml`, `intraday-refresh.yml`) `gh release download` the DB from
  `data-latest` at job start, run their incremental update, then `gh release upload … --clobber`
  it back. They are in the `data-write` concurrency group so uploads don't race.
- **Readers** (`daily-memo.yml`, `weekly-memo.yml`) download it read-only to build the memos.
- **Dashboard** (`dashboard/app.py`) downloads the latest asset into `DB_PATH` at startup via
  the GitHub API, authenticated with **`GH_DB_TOKEN`** (a read-only PAT in Streamlit Cloud
  secrets — the repo is private, so the asset is not publicly reachable), cached
  `@st.cache_resource(ttl=900)`. No token locally → dev uses the on-disk DB untouched.
- Do **not** re-add the DB to git tracking. Inspect locally: `sqlite3 data/macro_radar.db ".tables"`.

Tables added since v1: `news_feed` (Phase 11) and `factor_data` (Fama-French factors via openbb).
