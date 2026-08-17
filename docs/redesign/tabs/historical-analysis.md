# Historical Analysis

Screenshot: [historical-analysis.png](../screenshots/historical-analysis.png) · `backtests.py::render_backtests()` (wired `app.py:1453-1458`).

## Elements (top → bottom)
1. SIGNAL & REGIME BACKTESTS header + caption "Historical SPY forward returns following signal triggers and regime periods."
2. Cohort multiselect (9 chips) + Horizon multiselect (1M/3M/6M/12M) with help tooltip (`backtest_results` via `load_backtest_results`)
3. Wide metrics table — Cohort × Horizon × Avg/Median Return, Hit Rate, N (`pivot_backtest`, `db_helpers.py:230-248`)
4. Conditional low-sample warning (n<5)
5. "Avg Return by Horizon" grouped bar chart (px.bar, y "Avg Return (%)")
6. "Hit Rate by Horizon" grouped bar chart with dashed "50% (breakeven)" line
7. Lineage caption ("Signals from `signals` table, regimes from `regimes` table")
8. FACTOR ATTRIBUTION — SPY ACROSS REGIMES header — locally: "pyfolio import failed: No module named 'pyfolio'" (**local-env only**; `pyfolio-reloaded` is in requirements.txt:20, live app renders). When working: Rolling 6M Sharpe, Rolling 6M Beta (SPY vs itself — a sanity-check constant ≈1.0 presented as a real chart), Top-5 Drawdowns (all matplotlib, **titles explicitly blanked** `ax.set_title("")`), regime color legend, Rolling 63-Day Factor Exposures plotly chart + proxy caption (`market_daily` SPY + **live yfinance fetch** for factor proxies)

## Unlabeled
- Cohort chips mix Title Case regimes with raw snake_case signals ("cpi_cold", "yield_curve_inv…") in one control.
- "Hit Rate", "N" — never defined; Goldilocks 12M shows 100.0% hit rate at N=17 with no small-sample caveat (warning only fires n<5).
- "50% (breakeven)" collides with inflation "breakeven" used two tabs over — same word, unrelated meaning.
- The three pyfolio charts carry no titles by design; "Rolling Beta (vs. SPY)" is SPY-vs-SPY without saying so.
- Sharpe / beta / drawdown / OLS never explained.
- 9-cohort rainbow legends duplicate under both bar charts; `_REGIME_COLORS["Recession Risk"]` is purple here vs gray elsewhere.
- `computed_at` is selected from the DB but never displayed — no way to see results are from Jul 8.

## Text walls
None >80 words.

## Stale
- `backtest_results` last computed **2026-07-08** (stale-pipeline) — invisible on screen (see `computed_at` above).
- Factor-attribution failure is local-env; note the live-yfinance factor fetch means that chart's freshness is independent of the DB.

## Scroll
1690px ÷ 900px = 1.9× — OK (taller when pyfolio section renders on the live app).

## Overlap
`backtest_results` is exclusive to this tab; regime shading/colors reuse `regimes`; SPY series shared with Markets; factor proxies duplicate Asset Allocation's `FACTOR_PROXIES` (re-fetched independently).

## Verdict
**Keep, tighten**: genuinely differentiated quant content recruiters will value, but it needs a visible as-of stamp, humanized cohort names, and the self-beta chart removed or honestly labeled.
