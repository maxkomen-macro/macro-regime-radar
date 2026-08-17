# Asset Allocation

Screenshot: [asset-allocation.png](../screenshots/asset-allocation.png) (Overview sub-tab only — Optimization/Risk Analysis are nested `st.tabs` not exercised by the capture) · `allocation_tab.py::render()`, engine in `src/analytics/allocation.py`.

## Elements (top → bottom)
1. Banner — "Asset Allocation · Regime-conditional portfolio optimization — 7 institutional methods"
2. Sub-tabs: **Overview / Optimization / Risk Analysis**
3. Overview: regime banner "Overheating · 58% confidence · Data Range 289 months (2002-08 → 2026-08)" + REGIME-CONDITIONAL PERFORMANCE heatmap — 10 asset classes × 4 regimes, each cell return% + "SR x.xx", n-months footer (25/158/88/18) — **prices fetched live via yfinance, not `market_daily`**; regimes from `regimes` table
4. Optimization (not captured): context line, 5–7 method cards (MVO/MinVar/RiskParity/BL/HRP ± CVaR/HERC), KEY INSIGHT banner, weights-by-method Altair chart, Efficient Frontier chart, quantstats tearsheet generator (2200px iframe), "Understanding the Methods" expander (~198 words)
5. Risk Analysis (not captured): 8 sections — factor decomposition (live yfinance long/short proxies — **not** the empty `factor_data` table), style selection, CVaR/VaR tables, transition P&L, currency overlay, real-vs-nominal toggle, correlation heatmap, max drawdown

## Unlabeled
- "SR −0.18" — Sharpe ratio never spelled out; negative SRs beside positive returns confuse non-finance viewers.
- "58% confidence" banner sits under a header badge saying "83%" — the confidence-vs-probability split, unexplained (third surface for this contradiction).
- n-months row (18 months for Recession Risk) — no small-sample caveat despite driving cell colors.
- Deeper sub-tabs: R²/α cards uncaptioned, correlation colors have no legend, VaR undefined.
- `register_tab_context` claims `factor_data`/`market_daily` as sources — both false (misleads the chat assistant too).

## Text walls
"Understanding the Methods" expander ≈198 words (7 entries) — acceptable because opt-in, but it's the only methodology this tab gets: **Methodology tab has no Asset Allocation section at all.**

## Stale
- Regime conditioning uses `regimes` last row 2026-05-01 (cadence + pipeline) with no freshness indicator; "Data Range → 2026-08" refers to asset returns, masking the stale regime input.
- Live-yfinance dependency means this tab's data is fresher than the DB — the opposite asymmetry from everywhere else, invisible to users.

## Scroll
Overview 1372px ÷ 900 = 1.5× — OK; Risk Analysis with 8 stacked sections will far exceed 2.5× on the live app (not measurable in this capture).

## Overlap
Regime banner duplicates header/Dashboard; factor proxies duplicate Historical Analysis' factor attribution (independently re-fetched); CPI reuse; tearsheet benchmarks vs SPY like backtests.

## Verdict
**Split/tier**: Overview + Optimization are strong showcase content; the 8-section Risk Analysis sub-tab is a second full dashboard hiding inside a sub-tab and should be tiered down or paginated — and the tab needs a Methodology section.
