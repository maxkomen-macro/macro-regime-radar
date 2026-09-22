Snowflake-style tiers over one SQLite file, `data/macro_radar.db`, shipped as the `data-latest` release asset and read by the API through generations. Tier names describe the row's job, not a separate database.

## RAW
Source rows as fetched, one provider per series, never rewritten by a model.
- `raw_series` · FRED observations, one row per series and month (daily series keep the newest in-month value; the true observation date lives in `source_watermarks`).
- `market_daily` · completed daily bars for the 23-symbol stored universe (yfinance).
- `market_intraday` · 5-minute bars for SPY and QQQ, stored after the session completes.
- `news_feed` · scored headlines from Finnhub, NewsAPI and RSS, with the AI reads (`regime_interpretation`, `perplexity_research`).
- `source_watermarks` · per source: the newest observation date, when it last advanced, when it was last checked.
- `desk_series` · the Desk's daily history per series (FRED direct, merged so a rolling window never forgets; tier 2 adds market closes), read by the event study.
- `ai_spend_ledger` · append-only cost of every AI call, never pruned.
- `event_calendar` · the hand-maintained macro calendar.

## CUR
Curated series the models read, at the RAW grain, checked by `scripts/validate_db.py` (integrity, counts, max-date regression, freshness verdicts) before a release is published.
- `factor_data` · Fama-French factors (openbb) for attribution.
- `asset_prices` · price histories for the allocation universe, EODHD first with Yahoo as the disclosed fallback, completed sessions only.
- `derived_metrics` · the weekly what's-priced and surprise metrics (z-scores over the configured window).

## MART
Model output, one row per date, read by the API and this Desk. One number, one truth: the browser never re-derives these.
- `regimes` · the four-way classifier's label, confidence and four probabilities per month.
- `signals` · the five monitored signals: value, threshold, triggered.
- `alert_feed` · signal breaches with level info, watch or risk.
- `backtest_results` · regime-conditional returns by asset and horizon.
