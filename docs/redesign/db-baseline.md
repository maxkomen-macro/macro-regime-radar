# DB Freshness Baseline — 2026-08-06

Snapshot of the **local** `data/macro_radar.db` (12.4 MB, file mtime **Aug 5 2026 13:25 local**) used for every screenshot and "stale" judgment in this inventory. Repo: `/Users/maxkomen/Projects/Macro/macro-regime-radar`, HEAD `c1ee4670173f3b536d16c9c79312b112ace1cb7f`.

## Required baselines

| Table | Column | MAX value | Cadence of the source | Verdict as of 2026-08-06 |
|---|---|---|---|---|
| `regimes` | `date` | **2026-05-01** | **Monthly** rows (2026-05-01, 04-01, 03-01…) — despite CLAUDE.md saying "daily output" | ~3 months behind today, but only ~1–2 months behind what monthly INDPRO/CPI publication lag allows. Stale **by source cadence + pipeline lag**, not by local DB age |
| `signals` | `date` | **2026-07-01** | Monthly rows (07-01, 06-01, 05-01…) | Consistent with monthly cadence + lag. **Not** locally stale |
| `market_daily` | `date` | **2026-08-05** | Daily (yfinance) | Fresh — yesterday's close. Local DB is current for market data |
| `market_intraday` | `ts` | **2026-08-05 15:55:00** | 5-min bars, hourly refresh workflow | Fresh through yesterday's close |
| `news_feed` | `published_at` | **2026-07-08T17:28:38+00:00** | Continuous (Finnhub/NewsAPI/RSS ingest) | **~4 weeks stale even though the DB file is fresh** — the news pipeline stopped writing after Jul 8. This is a pipeline gap, not local-DB age. Anything news-related on screen will look a month old |

## Supporting baselines (for per-tab stale attribution)

| Table | MAX | Note |
|---|---|---|
| `raw_series` (`date`) | 2026-07-01 | FRED series resampled monthly — consistent with cadence |
| `derived_metrics` (`date`) | 2026-07-10 | |
| `factor_data` | **0 rows** | Fama-French table is empty in the local DB — any factor UI will render empty/error |
| `event_calendar` (`event_datetime`) | 2026-06-18T18:00:00Z (14 rows) | **Entire calendar is in the past** — the "upcoming events" window (which filters ≥ today) will be empty on screen |
| `alert_feed` | 1 row: 2026-05-01 `cpi_hot` (info) | Effectively empty feed |
| `backtest_results` (`computed_at`) | 2026-07-08T12:16 (144 rows) | Last computed a month ago |
| `news_feed` count | 3,715 rows | Volume is fine; recency is the problem |

## How to read "stale" in the tab docs

- **Stale-local-DB**: would look fresh on the live Streamlit Cloud app (which downloads the latest `data-latest` release asset) but looks old here because the local copy is behind. *Mostly not the case — the local DB carries market data through Aug 5.*
- **Stale-by-cadence**: monthly FRED/regime/signal data legitimately trails today by 1–2 months; the UI just fails to say so, which is what makes it *feel* stale.
- **Stale-pipeline**: `news_feed` (Jul 8), `event_calendar` (Jun 18), `backtest_results` (Jul 8), `factor_data` (empty) have stopped advancing even though the DB itself is current. These will look broken to any visitor regardless of which copy of the DB is used.

## Environment notes

- Streamlit runs from `/opt/anaconda3/bin/streamlit` (1.51.0); the repo `.venv` is API-only (fastapi/uvicorn, no streamlit).
- No local `.streamlit/secrets.toml`; `.env` provides `FRED_API_KEY` only. Phase-11 keys (Finnhub/NewsAPI/Anthropic/Perplexity) absent locally → news ingest and AI-chat FAB will show their "unavailable" fallbacks; noted per-tab where visible.
