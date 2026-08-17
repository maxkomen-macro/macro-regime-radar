# Dashboard

Screenshot: [dashboard.png](../screenshots/dashboard.png) · Rendered inline in `dashboard/app.py:1002-1408` + `decision_view.py`, `intelligence_tab._render_intelligence_dashboard_card`, `recession_tab.render_recession_summary`, `macro_forecasts.py`.

## Elements (top → bottom)
1. Persistent header bar — brand, regime badge "Overheating 83%" + GL/ST/RR pills, S&P/VIX/US-10Y mini-stats (`market_daily`, `raw_series`; `app.py:642`)
2. Timestamps line — "Macro data as of May 2026 · Market data through Aug 05, 2026" (`app.py:775`)
3. Market Intelligence card (iframe) — narrative + HIGH CONVICTION badge (`regimes`, `raw_series` BAML, recession model; `intelligence_tab.py:659`)
4. Current read-through box — ~185-word generated paragraph + Playbook bias line (`regimes`, `derived`, `output/playbook.json`; `app.py:795`)
5. Recession-risk summary strip — 14.6% / yield-curve +35bps / macro divergence (recession model, `recession_tab.py`)
6. Regime probability distribution — 4 HTML bars + deltas (`regimes` prob columns; `decision_view.py:108`)
7. Top Risks ("Info: 1") | Upcoming Events ("No events…") (`alert_feed`, `event_calendar`)
8. Signal Monitor — 5 fill-bar cards, "Signals as of 2026-07-01" (`signals`; `decision_view.py:284`)
9. What's Priced — 3 st.metric + caption (`derived_metrics`)
10. Top Surprises This Week — 5 z-score bars (`derived_metrics`)
11. Key Indicators — 5 metric cards with sparklines + momentum labels (`raw_series` derived)
12. Charts — 4 sub-tabs (CPI/Unemployment/Yield Curve/VIX), plotly (`raw_series`)
13. Regime History Gantt + 2 metrics (`regimes`)
14. Drivers Panel — bar chart + snapshot table + z-score bullets (`derived`)
15. Data Freshness expander (`raw_series` max dates)
16. Macro Forecasts — 3 Prophet charts (locally: "No module named 'prophet'" warnings)
17. Downloads — 3 CSV buttons

## Unlabeled
- **Three conflicting regime probabilities on one screen**: header 83%, intelligence card "58% probability" (heuristic reconstruction, not the stored softmax), bars 83%. Card also prints "2th percentile".
- Three recession numbers: 14.6% (model), "15%" (card), RR 0% (regime bars) — no reconciliation.
- Growth/Infl Trend "0.510 / 1.843" — no units, no explanation anywhere.
- Drivers bar chart y-axis "Trend value"; z-score bullets ("+2.98σ") assume statistical literacy.
- 2s10s shown as "+35 bps" in strip and "0.35%" in KPI — same number, two units.
- Surprise rows conflate level with change: "CPI YoY surged sharply (+4.17%) — 3.9σ move" (4.17% is the level).

## Text walls
- Read-through box ≈185 words + 27-word playbook line — the single largest block, above the fold-adjacent zone.

## Stale
- "Macro data as of May 2026" (regimes cadence + pipeline lag — honest but alarming with no explanation).
- Signals as of 2026-07-01 (cadence). Upcoming Events empty + Top Risks 1 info alert (stale-pipeline: `event_calendar` ends Jun 18, `alert_feed` 1 row).
- Prophet warnings + "AI Assistant unavailable — API key not configured" = local-env only.

## Scroll
4086px ÷ 900px = **4.5× — flag**.

## Overlap
Signal cards (≈Signals & Alerts alerts), What's Priced + Top Surprises (duplicated on Markets/Signals tabs), intelligence card (condensed Intelligence tab), recession strip (Recession tab), regime bars (header badge + Intelligence gauge).

## Verdict
**Keep as the sole landing tab but split/demote**: it's a 4.5×-scroll aggregation of six other tabs' content; keep hero (header, read-through, probability bars, signals, KPIs) and demote charts/forecasts/downloads.
