# Streamlit Cloud Deployment Guide

## Pre-Deploy Checklist

Before deploying, verify all of the following:

- [ ] `requirements.txt` is complete (all third-party imports listed)
- [ ] `runtime.txt` exists and specifies the correct Python version (`python-3.12`)
- [ ] `.streamlit/config.toml` exists (dark theme + headless server)
- [ ] `data/macro_radar.db` is committed to the repo (`git ls-files | grep macro_radar`)
- [ ] No secrets in the codebase (`git grep -nE "FRED_API_KEY|POLYGON_API_KEY"` returns no hardcoded values)
- [ ] `.env` is in `.gitignore` and NOT tracked (`git ls-files | grep .env` returns nothing)
- [ ] `.github/workflows/refresh-data.yml` exists (auto-refresh after deploy)
- [ ] GitHub repository is set to **Public** (required for free Streamlit Cloud)

---

## Streamlit Cloud Deploy Steps

1. Go to [https://share.streamlit.io](https://share.streamlit.io)
2. Sign in with GitHub (account: `maxkomen-macro`)
3. Click **"New app"**
4. Fill in the deploy form:
   - **Repository:** `maxkomen-macro/macro-regime-radar`
   - **Branch:** `main`
   - **Main file path:** `dashboard/app.py`
5. Click **"Advanced settings"** and add secrets:
   ```toml
   FRED_API_KEY = "your_actual_fred_key"
   POLYGON_API_KEY = "your_actual_polygon_key"
   ```
6. Click **"Deploy"**
7. Wait 2–3 minutes for the build to complete

> **Note:** Streamlit Cloud builds a fresh environment from `requirements.txt` and `runtime.txt`.
> If the build fails, check the logs for `ModuleNotFoundError` — add any missing package to
> `requirements.txt` and push.

---

## Post-Deploy Steps

After the app is live:

1. **Copy the live URL** — it looks like: `https://macro-regime-radar-xxxxx.streamlit.app`
2. **Take a screenshot** of the running dashboard (all 7 tabs loaded)
3. **Save the screenshot** as `docs/images/dashboard.png`
4. **Update README.md** — find this line and replace it:
   ```markdown
   > **Live App:** *Deploying to Streamlit Cloud — URL coming soon*
   ```
   Replace with:
   ```markdown
   > **Live App:** [https://macro-regime-radar-xxxxx.streamlit.app](https://macro-regime-radar-xxxxx.streamlit.app)
   ```
5. **Commit and push:**
   ```bash
   git add docs/images/dashboard.png README.md
   git commit -m "Add live URL and dashboard screenshot"
   git push
   ```

---

## How Auto-Refresh Works

GitHub Actions keeps the dashboard data fresh automatically:

1. The workflow (`.github/workflows/refresh-data.yml`) runs every day at **11:00 UTC (6:00 AM ET)**,
   before US market open.
2. It runs the full pipeline on GitHub's servers:
   - Fetches latest FRED macro data (`python main.py`)
   - Fetches latest market data from Polygon.io (`python src/market_data/fetch_market.py --mode incremental`)
   - Recomputes all analytics (surprise z-scores, backtests, alerts, priced metrics, playbook)
3. Intraday data older than 30 days is automatically trimmed to prevent database bloat.
4. If `data/macro_radar.db` changed, the workflow commits and pushes the updated file to `main`.
   The commit message includes `[skip ci]` to prevent an infinite Actions loop.
5. Streamlit Cloud detects the push and auto-redeploys within ~1 minute.

**Result:** Recruiters always see data that is at most 24 hours old. No manual intervention needed.

You can also trigger a manual refresh anytime:
- Go to the **Actions** tab on GitHub
- Select **"Refresh Data"**
- Click **"Run workflow"** → **"Run workflow"**

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ModuleNotFoundError` on deploy | Add missing package to `requirements.txt`, push |
| Secrets not found / KeyError | Check Streamlit Cloud → App settings → Secrets |
| DB missing or empty on deploy | Run `git ls-files \| grep .db` — DB must be tracked, not gitignored |
| Python version mismatch | Update `runtime.txt` to a supported version (3.9–3.12) |
| GitHub Actions failing | Check Actions tab on GitHub for error logs |
| Data looks stale | Check Actions tab — see if last run succeeded; trigger manual run |
| Repo getting large (>500MB) | Check intraday row count; reduce retention window in workflow |
| Streamlit not redeploy after push | Check Streamlit Cloud dashboard → app settings → auto-redeployment is enabled |

---

## Adding GitHub Secrets for Auto-Refresh

The GitHub Actions workflow requires two repository secrets:

1. Go to: `https://github.com/maxkomen-macro/macro-regime-radar/settings/secrets/actions`
2. Click **"New repository secret"**
3. Add: `FRED_API_KEY` = your FRED API key
4. Add: `POLYGON_API_KEY` = your Polygon.io API key

To test:
- Go to **Actions tab** → **"Refresh Data"** → **"Run workflow"** → click **"Run workflow"**
- Watch the run — if it succeeds and shows a commit, the pipeline is fully automated
