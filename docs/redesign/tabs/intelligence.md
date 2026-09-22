# Intelligence

Screenshot: [intelligence.png](../screenshots/intelligence.png) · `dashboard/components/intelligence_tab.py::render()` (lines 718–915), analytics in `src/analytics/intelligence.py`.

## Elements (top → bottom)
1. Market Intelligence narrative card (iframe, 180px) — regime/credit/recession takeaway + HIGH CONVICTION badge (`regimes`, `raw_series` BAML via `get_credit_metrics`, recession model)
2. "Regime Analysis" label + playbook regime selectbox
3. Current Regime gauge (iframe, 400px) — semicircle "58% Overheating" + 4 pills. **Probabilities are heuristically derived from `regimes.confidence` + hardcoded base rates (`intelligence.py:482-500`) — the real `prob_*` columns exist but are never read**
4. Regime Playbook card (iframe) — description, sector bars, warning signs, catalysts, historical performance table, key risks. **100% hardcoded `_PLAYBOOKS` dict**
5. Regime Duration card (iframe, 260px) — "5.0mo · 68th percentile · Historical avg 4.2mo" + Early/Mid/Extended track + Momentum/Valuation Stretch/Complacency bars (`regimes` streak; `market_daily` SPY, `raw_series` HY OAS + VIXCLS percentiles)
6. Transition Outlook card — 55% stay / top-3 moves; Markov counts from `regimes` history, silently falls back to hardcoded matrices when history is thin
7. Historical Analogues timeline (iframe) — 4 scored nodes; static 8-period list scored against live inputs
8. Explore Analogue buttons + detail expander (static text fields)
9. Scenario selectbox + 5 scenario cards (iframe) + results card (iframe, 620px) — static shock definitions through `run_scenario()` hand-tuned formula; Custom Builder sliders

## Unlabeled
- Gauge "58%" contradicts the always-visible header badge "83%" — same screen, no explanation (root cause above).
- Risk Indicators "Momentum 86% / Valuation Stretch 98% / Complacency 70%" — bare percentages; windows/meaning never stated.
- Sector positioning bar lengths encode hidden 0–100 "strength" values — no numbers, no unit.
- "68th percentile" — percentile of what, unstated. Scenario shocks ("HY +300bps") have no horizon.
- Playbook/analogue/scenario content nowhere labeled as static/hardcoded vs. model output — reads as live analysis.
- Footer credits "FRED · Polygon.io · Yahoo Finance" — Polygon is a dormant legacy source (stale label).

## Text walls
No single block >80 words; density comes from stacked bullet lists (playbook + scenario results ≈150 words of bullets each), not prose.

## Stale
Nothing DB-stale renders here (no `news_feed`/`event_calendar` reads). "Duration 5.0mo" reflects `regimes` ending 2026-05-01 (cadence). "Updated Just now" on the narrative card is misleading — data is May 2026.

## Scroll
2800px ÷ 900px = **3.1× — flag**.

## Overlap
Narrative card duplicated verbatim on Dashboard; regime probabilities triplicate (header badge, Dashboard bars, this gauge — two disagreeing values); credit metrics also on Credit tab; recession prob also on Dashboard + Recession Risk.

## Verdict
**Keep-but-fix**: the playbook/analogues/scenarios are the app's most distinctive recruiter-facing content, but it must read the stored probabilities and label static content as reference material — and its name collides with "Events & Intelligence".
