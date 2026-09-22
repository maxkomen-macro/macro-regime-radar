# Credit

Screenshot: [credit.png](../screenshots/credit.png) · `credit_tab.py::render()`, analytics in `src/analytics/credit.py`. (`credit_spreads.py` is dead code — never imported.)

## Elements (top → bottom)
1. Status bar — "CREDIT REGIME ● Normal" pill + "FRED BAML series · refreshed daily 6 AM ET · as of Jul 01, 2026" (`raw_series` BAML via `get_credit_metrics()`, ttl 1h)
2. SPREAD LEVELS (BASIS POINTS) — 5 iframe cards: HY 272 / IG 75 / CCC 967 / BB 162 / B 292 bps, each with Δ vs prev month + SVG sparkline (`raw_series`)
3. OAS HISTORY & SPREAD RATIOS — Altair dual-line "HY & IG OAS — 30-year history" with NBER shading (hardcoded 2001/2008/2020) | right: HY/IG Ratio "3.63×" + Distress Ratio "96.7%" cards (iframe)
4. CREDIT ANALYTICS — 3 iframe cards: LBO All-in Financing Cost (Fed Funds 3.63% + HY 2.72% = 6.35%), Conditions Logic threshold legend (Normal/Tight/Stressed/Crisis rules), Spread Context percentiles ("2th"/"5th" of 30yr)
5. REGIME-CONDITIONAL ASSET PERFORMANCE — 6 assets × 4 regimes table, current column highlighted. **Hardcoded `_REGIME_RETURNS` constants**, footer admits "Phase 8 will replace with live backtest" — Phase 8 shipped long ago (stale TODO)
6. CREDIT REGIME TRANSITION MATRIX — 3M + 6M iframes computed from 30yr history; Tight row renders as all zeros with a footnote; templated interpretation paragraph

## Unlabeled
- **"2th percentile" / "5th percentile"** — ordinal bug, and the same "2th" propagates into the Dashboard/Intelligence narrative cards.
- Distress Ratio 96.7% renders a nearly-full red-gradient bar directly under a green "Normal" pill — CCC-vs-1000bps needs one line of reconciliation for a non-finance reader.
- "HY / IG Ratio 3.63×" — meaning unexplained beyond hardcoded context values ("2008 peak 8.2×").
- OAS, bps, ICE BofA — no expansions anywhere; this is the jargon-densest tab.
- Change-line source fields are named `*_1w_change`, docstring says 5-business-day, label says "vs prev month" — the label matches the actual monthly-diff computation but the code disagrees with itself.
- Transition matrices' all-zero Tight row shown rather than dropped.

## Text walls
None >80 words — captions here are actually the app's best (threshold legend, "Above 100% = systemic credit stress").

## Stale
- "as of Jul 01, 2026" — `raw_series` monthly resample (cadence), but the header claims "refreshed daily 6 AM ET" one clause earlier: a self-contradicting freshness line.
- Asset-performance table is static research constants presented alongside live data with only a footnote.

## Scroll
2186px ÷ 900px = 2.4× — near flag.

## Overlap
HY OAS independently recomputed on Recession Risk tab (different pipeline, can drift); credit metrics feed Dashboard + Intelligence narrative cards and the LBO tab's context card; chat FAB `get_credit_snapshot` is a fourth surface.

## Verdict
**Keep**: the strongest single tab (labeled units, thresholds, context), needing only the ordinal fix, a de-conflicted freshness line, and honest labeling of the hardcoded returns table.
