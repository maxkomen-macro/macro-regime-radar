# Signals & Alerts

Screenshot: [signals-alerts.png](../screenshots/signals-alerts.png) · `alerts_tab.py::render_alerts_tab()` + `whats_priced.py::render_whats_priced()` (wired `app.py:1436-1447`).

## Elements (top → bottom)
1. ALERTS FEED header + caption "Macro signal and market-based alerts, newest first."
2. Severity count badges — currently a single "🔵 Info: 1" pill (`alert_feed` table)
3. Alert type / Severity level selectboxes (filter a 1-row table) + "Showing 1 of 1 alerts"
4. Alert card — "INFLATION · INFO · Cpi Hot · CPI above threshold — Fed tightening risk elevated, real rates at risk · Value: 4.27 — above trigger · 2026-05-01" (`alert_feed`; display names from hardcoded `_SIGNAL_DISPLAY`, `alerts_tab.py:23-29`)
5. "View as table" expander — raw snake_case DB dump (`alert_feed`)
6. WHAT'S PRICED — 3 subsections × 2 st.metric: Fed Funds 3.63% / SOFR 3.62%, 5Y BE 2.28% / 10Y BE 2.25%, 5Y Real 1.94% / 10Y Real 2.24%, each "±0.0x% MoM" (`derived_metrics` via `load_derived_metrics`)
7. TRADER INTERPRETATION — 4 conditional template bullets in one bordered card (same `derived_metrics`; thresholds hardcoded in `whats_priced.py:85-159`)

All styled via `st.markdown(unsafe_allow_html=True)` — no `components.html` iframes (contradicts the project's own styling rule).

## Unlabeled
- "Value: 4.27 — above trigger" — no unit (it's % YoY CPI), no threshold number shown.
- risk/watch/info severity levels never defined on screen.
- "Cpi Hot" title-cased raw signal name; table expander shows pure snake_case (`unemployment_spike`).
- SOFR, TIPS, breakeven, "MoM" — no expansions or hover definitions anywhere.
- No as-of/updated timestamp for either data source on the whole tab.

## Text walls
None >80 words; Trader Interpretation panel totals ~75 words across 4 bullets (the good kind of desk-note copy — closest existing match to the target voice).

## Stale
- The single alert is dated **2026-05-01** (stale-pipeline: `alert_feed` has 1 row ever) — filters + "Showing 1 of 1" ceremony around a 3-month-old item makes the app feel dead.
- What's Priced values reflect monthly `derived_metrics` through Jul (cadence) — but nothing on screen says so.

## Scroll
1713px ÷ 900px = 1.9× — OK.

## Overlap
- Tab title says "Signals" but the actual signal gauge cards live on Dashboard's SIGNAL MONITOR (this tab never queries `signals`).
- What's Priced is a 6-metric superset of Dashboard's 3-metric WHAT'S PRICED (same header text, same table).
- Top Risks on Dashboard shows the same `alert_feed` rows.

## Verdict
**Merge**: fold the alert feed into a unified signal/alert surface with Dashboard's Signal Monitor and keep the Trader Interpretation voice; a standalone tab whose main content is one stale alert and a duplicated metric block doesn't justify a nav slot.
