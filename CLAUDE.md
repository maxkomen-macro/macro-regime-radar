# Macro Regime Radar — Claude Code Reference

## Project Overview

Bloomberg-terminal-style Streamlit macro dashboard. Live at **macro-regime-radar.streamlit.app**. Built as a recruiting portfolio piece demonstrating quantitative macro analysis, data engineering, and full-stack Python skills.

## Tech Stack

- **Python 3.12**
- **Streamlit** — UI framework
- **SQLite** (`data/macro_radar.db`) — local data store, refreshed by scheduled jobs
- **FRED API** — macroeconomic time series
- **yfinance** — market prices and asset data
- **pandas** — data manipulation
- **scikit-learn** — regime classification and signal modeling
- **plotly / altair** — charting

## Project Structure

```
macro-regime-radar/
├── dashboard/
│   ├── app.py                  # Streamlit entry point, tab routing
│   └── components/             # Per-tab UI modules
├── src/
│   ├── analytics/              # Signal logic, regime detection, scoring
│   └── config.py               # Shared constants, series IDs, thresholds
└── data/
    └── macro_radar.db          # SQLite DB (excluded from local git tracking)
```

## Current Tabs (11)

1. Dashboard
2. Intelligence
3. Markets
4. Signals & Alerts
5. Historical Analysis
6. Events & Intelligence
7. Credit
8. Recession Risk
9. LBO Calculator
10. Asset Allocation
11. Methodology

## Design Rules — Bloomberg Aesthetic

| Token | Value |
|---|---|
| Background | `#0d1117` |
| Card background | `#161b22` |
| Borders | `#30363d` |
| Accent blue | `#4a9eff` |

- **Always** use `streamlit.components.v1.html()` to render styled card HTML. **Never** use `st.markdown()` for styled cards.
- Use `width="stretch"` on all dataframes.
- Use `df.loc[mask, col]` for pandas indexing. **Never** use chained `df[col][mask]`.
- Do not alter the Bloomberg dark aesthetic — no light themes, no color palette changes.

## API Keys

All secrets come from `st.secrets[]`. **Never hardcode keys or tokens** in source files.

## Git Workflow

Before starting any session:

```bash
git checkout HEAD -- data/macro_radar.db && git pull --no-rebase
```

- `macro_radar.db` is excluded from local tracking (refreshed remotely). Always restore it from HEAD before pulling.
- Do not commit `data/macro_radar.db`.

## Phase 11 — In Progress

Upgrading the **Calendar** tab to **Events & Intelligence**:

- Adding **Finnhub** and **NewsAPI** news feeds
- Significance scoring on incoming headlines
- **Claude API** interpretation runs only for headlines with `significance >= 4`

## What NOT to Do

- Do not hardcode API keys or secrets anywhere in source
- Do not commit `data/macro_radar.db`
- Do not use `st.markdown()` for styled HTML cards — use `streamlit.components.v1.html()`
- Do not change the Bloomberg dark aesthetic
- Do not use chained pandas indexing (`df[col][mask]`) — use `df.loc[mask, col]`
