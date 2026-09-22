# Redesign Inventory — Summary

Read-only diagnosis of the live Streamlit dashboard, captured locally on 2026-08-06 at HEAD `c1ee467`. Judged against the three audiences: recruiters (10-second impression), non-finance visitors (comprehensibility), the owner (daily macro learning).

## The five worst offenses

1. **The app disagrees with itself on its headline number.** The header badge says "Overheating 83%", the Market Intelligence card says "58% probability", the Allocation banner says "58% confidence" — all visible within two clicks, two of them on the *same screen*. Root cause: `intelligence.py` re-derives probabilities from `confidence` + hardcoded base rates instead of reading the stored `prob_*` columns. Recession risk has the same disease (14.6% model / "15%" card / "RR 0%" bars). Nothing destroys a recruiter's trust faster. ([intelligence](tabs/intelligence.md), [dashboard](tabs/dashboard.md))

2. **The flagship news feature renders as a wall of zeros.** Events & Intelligence hard-filters to 24H/48H/7D with no fallback; with `news_feed` stalled at Jul 08, all five counters read 0 above two apology cards — 3,715 stored articles invisible. Adjacent stale pipelines compound it: calendar ends Jun 18 (both "upcoming events" widgets empty), `alert_feed` has one May alert wrapped in filter ceremony. ([events-intelligence](tabs/events-intelligence.md), [signals-alerts](tabs/signals-alerts.md), [db-baseline](db-baseline.md))

3. **Both ends of the app are scroll caverns.** Dashboard = 4.5 viewports (17 stacked sections aggregating six other tabs); Methodology = 4.7 viewports of ~1,460 static words; Markets 3.7×, Intelligence 3.1×, Recession 2.9× (sensitivity expander open by default). The 185-word read-through paragraph is the "wall of cold text" complaint on the landing screen. ([dashboard](tabs/dashboard.md), [methodology](tabs/methodology.md))

4. **Numbers ship without labels, units, or legends — 27 ranked instances.** Worst: "Growth / Infl Trend 0.510 / 1.843" on the landing KPI row; surprise rows that mislabel a CPI *level* as a weekly *surge*; a unit-less "+29.2" sentiment index; bare "769.74" prices; raw logistic coefficients; legends stranded on the Methodology tab away from the widgets they decode; the "2th percentile" ordinal bug repeated on four tabs. ([confusion-index](confusion-index.md))

5. **Freshness messaging contradicts itself and its own branding is stale.** "refreshed daily 6 AM ET · as of Jul 01, 2026" (Credit), "Live Financing Rate … As of 2026-07-01" (LBO), "updated daily" over May regime data, "Updated Just now" on month-old inputs; Methodology + footer still credit retired Polygon.io; sidebar says "Phase 3 + Trader Pack"; Credit's returns table promises "Phase 8 will replace" (Phase 8 shipped); Recession gauge bands (33/60%) contradict the documented thresholds (20/40%). Monthly data isn't the sin — pretending it's daily is. ([credit](tabs/credit.md), [recession-risk](tabs/recession-risk.md), [methodology](tabs/methodology.md))

## Deliverables

- [db-baseline.md](db-baseline.md) — DB freshness baseline + stale-attribution rules (local DB is *current*; regimes/signals are monthly-cadence; news/calendar/alerts/backtests are pipeline-stalled; `factor_data` empty)
- [ia-proposals.md](ia-proposals.md) — Option A (7 tabs, consolidated) vs Option B (9 tabs, `Monitor · Analyze · Tools` dividers + Cmd+K); per-audience comparison
- [confusion-index.md](confusion-index.md) — 27 ranked unlabeled/unexplained elements with desk-note-voice captions
- Tab docs: [dashboard](tabs/dashboard.md) · [intelligence](tabs/intelligence.md) · [markets](tabs/markets.md) · [signals-alerts](tabs/signals-alerts.md) · [historical-analysis](tabs/historical-analysis.md) · [events-intelligence](tabs/events-intelligence.md) · [credit](tabs/credit.md) · [recession-risk](tabs/recession-risk.md) · [lbo-calculator](tabs/lbo-calculator.md) · [asset-allocation](tabs/asset-allocation.md) · [methodology](tabs/methodology.md)
- Screenshots: `screenshots/*.png` — 11 full-height captures at 1440px (heights 1,145–4,333px)

## Scroll ratios (page height ÷ 900px viewport; flag >2.5×)

| Tab | Ratio | | Tab | Ratio |
|---|---|---|---|---|
| Methodology | **4.7×** | | Credit | 2.4× |
| Dashboard | **4.5×** | | Signals & Alerts | 1.9× |
| Markets | **3.7×** | | Historical Analysis | 1.9× |
| Intelligence | **3.1×** | | LBO Calculator | 1.7× |
| Recession Risk | **2.9×** | | Asset Allocation | 1.5×* |
| | | | Events & Intelligence | 1.2×* |

\* understated: Allocation measured on its Overview sub-tab only; Events measured empty.

## Failures & capture limitations (none blocking)

- **No tab failed to render.** All 11 captured.
- Local-env gaps (absent from the anaconda env, present in requirements.txt/Cloud secrets, so live app unaffected): Prophet forecasts, GARCH card (`arch`), pyfolio factor attribution, riskfolio-dependent optimizers untested, AI Analyst FAB shows "API key not configured". Attributed per-tab where visible.
- Asset Allocation's Optimization/Risk Analysis nested sub-tabs and the news feed's populated state were not screenshotted (nested tabs / empty data); their inventories come from code reading, marked in the tab docs.
- First capture attempt produced viewport-only screenshots; re-captured at full height (all PNGs now ≥1,145px tall).

## What already works (keep in the redesign)

Credit tab's labeling discipline (units, thresholds, context lines) is the model for everything else; Recession's read-through and Signals' Trader Interpretation are the target desk-note voice already shipping; LBO/Recession interactivity (sliders → recomputed outputs) is the strongest recruiter demo; the Bloomberg dark visual language is consistent app-wide.
