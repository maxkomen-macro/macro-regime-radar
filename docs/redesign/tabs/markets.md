# Markets

Screenshot: [markets.png](../screenshots/markets.png) · `dashboard/components/market_snapshot.py::render_market_snapshot()` (+`tradingview.py`). Optionally wrapped in `st.fragment(run_every=30)` during NYSE hours.

## Elements (top → bottom)
1. MARKET SNAPSHOT header + RATES bar — 3 st.metric: 2Y 4.13% / 10Y 4.48% / 2s10s 0.35% (`raw_series` DGS2/DGS10 via `wide_df`, monthly)
2. Risk Sentiment Composite — "Neutral +29.2", fill bar with −100/0/+100 axis, components caption (computed live from `market_daily` SPY/VIXY/HYG/GLD/UUP z-scores; `market_snapshot.py:97-152`; silently renders nothing if <3 components have data)
3. SPY Volatility GARCH card (iframe, 230px) — locally: "Model unavailable — arch import failed" (local-env; live app computes from `market_daily` SPY, ≥252 rows)
4. 19 ticker cards in 6 groups (iframes, 175px each) — US Equities (SPY/QQQ/IWM/VTV), Rates (TLT/IEF/SHY), Credit (HYG/LQD/EMB), Commodities (GLD/SLV/USO/UNG/CPER), International (EFA/EEM), FX & Vol (UUP/VIXY); price + 1W/1M returns + z-badge + 7-bar sparkline (`market_daily` + `market_intraday` override + `derived_metrics` z)
5. Sectors heatmap (iframe, 70px) — XLF/XLE/XLI/XLK color cells (`market_daily`)
6. Top Surprises This Week — 10 z-score rows (`derived_metrics`; shared helper also on Dashboard)
7. Quick Charts (TradingView) — 3 external iframes (live TradingView data, not the DB)
8. Footer caption — "Intraday prices via yfinance · Updated every 5 min during market hours · FRED macro data daily at 6 AM ET"

## Unlabeled
- Every ticker price is a bare number ("769.74") — no $ or USD on 23 cards/cells.
- "+29.2" composite score — unit-less invented index; formula only in a small caption far from the number.
- Sparklines have no scale; y-range is per-card min/max so steepness isn't comparable.
- Z-badge "—" is ambiguous: code (`if zscore`) renders a true 0.00σ the same as missing data.
- GARCH LOW/ELEVATED/HIGH thresholds (15%/25%) and heatmap ±1/±2% shading breakpoints never shown.
- TradingView charts show live prices (SPY 769.79) beside DB cards (769.74) — two "current" prices, one screen, no note.

## Text walls
None >80 words — this tab's problem is card volume (23 instruments + 10 surprise rows), not prose.

## Stale
- Rates bar uses monthly `raw_series` (cadence) next to daily ticker cards — mixed freshness, unmarked.
- Ticker data through Aug 05 (fresh, local DB current). GARCH card failure is local-env only (`arch` missing).
- Surprise rows repeat the level-vs-change conflation ("CPI YoY surged sharply (+4.17%)").

## Scroll
3349px ÷ 900px = **3.7× — flag**.

## Overlap
Top Surprises duplicated on Dashboard (same shared helper, top_n=5 vs 10); SPY/VIX/10Y already in the persistent header; HY-credit read overlaps Credit tab (ETF proxy vs OAS); TradingView triplicates SPY/GLD/TLT shown as cards directly above.

## Verdict
**Keep, condense**: the trading-desk look is a recruiter asset, but cut the TradingView section (duplicate data source, breaks the "one source of truth" story) and collapse 6 group headers + 23 cards into a denser grid.
