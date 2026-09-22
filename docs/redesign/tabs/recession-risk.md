# Recession Risk

Screenshot: [recession-risk.png](../screenshots/recession-risk.png) · `recession_tab.py::render()`, model in `src/analytics/recession.py` (trained in-process, no artifact).

## Elements (top → bottom)
1. Status bar — "Low Risk · 14.6% · 12-month recession probability · Logistic regression · trained on NBER recession dates · updated daily" (st.markdown card)
2. KEY RISK INDICATORS — 3 iframe cards: SVG probability gauge (14.6%), Yield Curve 2s10s "+35 bps · 34th pct vs 30yr", Macro Divergence "Aligned (+1)" (`raw_series` DGS10/DGS2/BAML + `regimes.prob_recession`)
3. CURRENT READ-THROUGH — ~60-word templated interpretation (good desk-note copy)
4. Model-output Altair chart 1995–present with NBER shading + 50% rule (`train_recession_model()` probabilities)
5. YIELD CURVE MONITOR — 30yr 2s10s chart + "current curve shape" mini-chart that renders as **a line between exactly 2 dots** (DB only holds DGS2/DGS10; code asks for DGS1MO…DGS30) | right: Current Spread card + hardcoded 4-row inversion-history table (ends "2022-07–2024-05 · no recession yet")
6. Sensitivity expander (**expanded by default**) — 5 sliders + Adjusted probability card ("10.0% vs baseline 14.6% (−4.5pp)")
7. MODEL TRANSPARENCY — Feature Coefficients iframe (raw logistic coefs on scaled inputs) + Model Metadata iframe (279 months, "Data as of 2026-07-31", 3-month lag note)

## Unlabeled
- **Gauge bands use 33%/60% thresholds while the badge/Methodology use 20%/40%** (`_gauge_svg` vs `_classify_prob`) — at 25–33% the badge says Elevated over a green arc.
- Coefficients ("+2.570") are log-odds per standard deviation — shown as bare numbers with only a color hint.
- "LEI proxy −0.03" — no unit, no definition on-tab (it's the T10YIE−T5YIE breakeven fallback).
- Two-point "curve shape" chart looks broken to any visitor.
- "Aligned (+1)" divergence score — scale never explained.

## Text walls
None — this tab's prose is the app's target voice (numbers inside declarative sentences).

## Stale
- "updated daily" claim vs model metadata "Data as of 2026-07-31" (monthly features; cadence) — same self-contradiction pattern as Credit.
- Divergence card mixes fresh credit data with `regimes.prob_recession` from 2026-05-01 (cadence + pipeline) with no freshness check.
- Inversion-history table is hardcoded (will silently age).
- Sensitivity model is `@st.cache_resource` with no TTL while the headline model refreshes hourly — the two can drift after long uptime.

## Scroll
2574px ÷ 900px = **2.9× — flag** (default-open sensitivity expander alone adds ~500px).

## Overlap
Probability + 2s10s + divergence duplicated as Dashboard summary strip; HY OAS recomputed separately from Credit tab's pipeline; methodology re-documented (with mismatched thresholds) on Methodology tab.

## Verdict
**Keep**: the model + sensitivity sliders are genuinely impressive interview material; collapse the expander by default, unify thresholds, and drop or fix the two-point curve chart.
