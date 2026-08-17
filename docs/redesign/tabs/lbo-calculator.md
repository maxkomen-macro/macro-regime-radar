# LBO Calculator

Screenshot: [lbo-calculator.png](../screenshots/lbo-calculator.png) · `lbo_tab.py::render()`, model in `src/analytics/lbo.py` (pure calculator; binary-search IRR).

## Elements (top → bottom)
Left column:
1. DEAL PARAMETERS header + Live Financing Rate banner (iframe) — "Fed Funds 3.63% + HY Spread 2.72% = 6.35% · As of 2026-07-01" (`raw_series` FEDFUNDS + BAMLH0A0HYM2; hardcoded `_FALLBACK` if DB missing)
2. 9 sliders — Entry EBITDA, growth, entry/exit multiples, hold, leverage, interest (defaults to live rate + "↻ Use live rate" on override), amortization, fees (no DB)
3. Deal Structure card (iframe) — Entry EV $800M / Equity $338M / Debt $450M / D/E 1.3x

Right column:
4. DEAL RETURNS — IRR 19.1% / MOIC 2.40x / Equity Gain +$473M (iframe; `run_lbo_model()`)
5. ANNUAL SCHEDULE table (iframe) — EBITDA/EV/debt/interest per year, EXIT row
6. IRR SENSITIVITY — 5×5 entry-vs-exit-multiple grid, current cell outlined (recomputes the model 25×/render)
7. CURRENT MARKET CONTEXT card (iframe) — "Live HY OAS 272 bps (**2th pct** vs 30yr history)", all-in 6.35% vs "~7% pre-GFC avg*", Normal badge, read-through + footnote (`get_credit_metrics()`, exceptions silently swallowed to "—")

## Unlabeled
- IRR, MOIC, EV/EBITDA, D/E — zero on-tab expansions; the color legend for IRR (≥20% green / 15–20% blue / <15% orange) exists only on the Methodology tab.
- Sensitivity grid colors carry meaning a first-time viewer must guess.
- "2th pct" ordinal bug again.
- Exit equity is computed but never displayed — the one number a learner would want.

## Text walls
None; the context card's read-through + footnote (~45 words) is well-pitched.

## Stale
- "As of 2026-07-01" live-rate stamp (cadence — monthly `raw_series`); label says "Live", data is 5 weeks old, no reconciliation.
- Market-context fetch failure degrades silently to "—" (violates the repo's own no-silent-errors rule).

## Scroll
1492px ÷ 900px = 1.7× — OK. Best-proportioned tab in the app.

## Overlap
Financing-cost card ≈ Credit tab's "LBO ALL-IN FINANCING COST" card (same computation, two homes); HY OAS/conditions ≈ Credit tab; full methodology duplicated on Methodology tab.

## Verdict
**Keep**: unique, interactive, and the clearest recruiter demo of finance mechanics — needs inline acronym expansions and the IRR color legend moved on-tab; consider grouping with Asset Allocation under a "Tools" cluster rather than a top-level slot.
