# FINAL FUNCTIONALITY REVIEW — React rebuild (branch `react-rebuild`)

**Reviewer:** independent functionality reviewer (did not implement any of tonight's work)
**Date:** 2026-08-26, ~05:00–06:00 UTC · Vite dev server :5173 + uvicorn :8000, both already running
**Evidence:** `/private/tmp/claude-501/-Users-maxkomen-Projects-Macro-macro-regime-radar/686263c6-ed53-4ac7-9820-d5faee2ea0c0/scratchpad/evidence/final-func/` (40 screenshots + 40 JSON reports + `overflow-report.json` + 3 full-text dumps) and `…/evidence/final-func-interactions/` (8 flow screenshots + `report.json` + quirk-verification + lens/assistant spot-checks). Assistant evidence reused from `…/evidence/phase6/panel-live-answer.png` — **zero Anthropic calls were made by this review.**

---

## 1. Route matrix — 10 routes × 4 widths = 40 combos

Harness: `web/scripts/verify-route.mjs` (one run per combo, 40 runs). Heights: 812 @375, 1024 @768, 900 @1024/1440. Horizontal overflow measured separately with an inline `scrollWidth` check per combo (verify-route does not measure it; checker script + raw numbers in `overflow-report.json`).

| Route | 375 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| `/` (landing) | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/dashboard` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/regime-lab` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/markets` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/credit` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/recession` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/news` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/tools#lbo` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/tools#allocation` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |
| `/app/methodology` | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow | CLEAN · no h-overflow |

**Totals across all 40 combos: 0 console errors · 0 page errors · 0 failed requests · 0 console warnings.** Overflow: `document.documentElement.scrollWidth === window.innerWidth` **exactly** on all 40 (not merely within tolerance) — 375/768/1024/1440 all measure 375/768/1024/1440.

### Real data confirmed (from captured textSamples + screenshots)

Every route renders live numbers, not fallbacks:

- **Dashboard:** Goldilocks 64% (GL 64 / OV 0 / ST 0 / RR 35), recession model 14.5% Low Risk, 2s10s +46 bps, VIX 15.85, HY 269 bps (−16 bps w/w), Fed Funds 3.63% (Jul 2026), growth trend +0.24 / inflation trend −0.58, five monitored signals each with live values and "monthly signal print · Aug 2026" provenance.
- **Credit:** HY 269 bps (2nd percentile since 1996), IG 81 bps (8th percentile), BB 157 / B 285 / CCC 1036 bps, full 1996→2026 OAS history chart with NBER bands.
- **Recession:** 14.5% in the Low Risk band, 2s10s +46 bps (37th percentile of 30 years), macro-vs-markets divergence −34.
- **News:** real headlines — CNBC "Hong Kong's IPO boom…" (Aug 20), Nayax/IPS M&A (Aug 25, matches `/api/news` row id 299961), 112+ headlines, category/recency/significance filter chips live. Calendar shows genuine upcoming events: GDP Second Estimate Q2 + PCE flagged TODAY (Aug 26, matches `/api/calendar`), NFP Sep 4, Retail/CPI/FOMC beyond.
- **Markets:** full tape with real prices and as-of stamps (SPY $764.99 Aug 25 19:59 ET, EEM $67.25 +1.72%, TLT $83.43, HYG $79.92 …), session badges (US CLOSED · CRYPTO LIVE · FX LIVE · VIX 15M DELAYED), surprises section stamped "weekly derived series · week ending Aug 28, 2026".
- **Tools/LBO:** live financing 6.32% = Fed Funds 3.63% + HY 2.69pp stored through Aug 01, 2026; IRR 17.5%, MOIC 2.24×, full annual schedule + entry×exit sensitivity grid (fits at 375 — screenshot verified).
- **Tools/Allocation:** 289 months Aug 2002→Aug 2026, risk-free 3.63% (Fed Funds), regime-conditional return/Sharpe table fully populated.
- **Methodology:** four-regime explainer with live signal table (curve row reads 0.46%) and the cross-surface provenance statement.
- **Landing:** live regime block (Goldilocks 64%) + product copy; no app chrome, no assistant launcher (by design).
- No wrongly-firing fallback/empty-state notices seen on any route. (One textSample artifact checked and cleared: "NORMALICE BOFA VIA FRED" on Credit is innerText concatenation of the NORMAL badge and the "ICE BOFA VIA FRED" label — the screenshot shows them as separate elements.)

Visual spot-checks at mobile width: `dashboard-375.png` and `tools-lbo-375.png` are genuinely mobile-grade — stacked cards, no clipped columns, tables fit, launcher clear of content.

---

## 2. Interactions — `web/scripts/verify-interactions.mjs` (8 flows)

| Flow | Harness verdict | Notes |
|---|---|---|
| chart-deeplink-daily | OK | SPY daily panel, 7 canvases |
| chart-deeplink-intraday | OK | intraday mode rendered, page mentions intraday |
| cmdk-palette | OK | opened on Ctrl+K, typed "credit", navigated to /app/credit |
| alert-drawer | OK | drawer opened |
| news-filters | OK | 24H + MACRO chips clicked; feed text 19,670 → 9,253 chars (filter visibly narrows) |
| regimelab-scenario | **FAIL (harness quirk — verified passing manually)** | see below |
| recession-sensitivity | OK | "Move the model" expanded, slider moved, adjusted reading 41.2% rendered |
| lbo-sliders | OK | slider moved, IRR re-rendered, sensitivity grid present |

**regimelab-scenario — the known harness quirk, honestly reported:** the step failed with **zero** console/page/HTTP errors (`errs: []` in `report.json`), on the assertion `/stressed|Stressed/` against CSS-uppercased innerText. I reproduced the flow independently with a case-insensitive check (`regimelab-scenario-quirk-verified.png`): after clicking the Credit Crisis preset, lowercase `/stressed/` = **false** but `/stressed/i` = **true**, and the page renders **STRESSED ODDS — GL 2% / OV 2% / ST 21% / RR 75%**, per-regime deltas (recession risk +40pp), "most likely: Recession Risk at 75%", and positioning implications. The scenario feature works; the harness assertion is what's wrong (finding F3). Functional score: **8/8**.

**Additional spot-checks (this review, zero errors):**
- **Allocation risk lenses:** clicked 3 of the 8 chips headlessly — Tail risk (CVaR/VaR table renders real numbers, e.g. US Large Cap −9.6%/−6.9%), Correlation (per-regime matrices), Drawdowns (max drawdown by regime and overall). Each click sets `aria-pressed="true"` and swaps the pane content. Screenshots: `lens-*.png`.
- **Assistant panel opens without spending:** launcher "◆ AI ANALYST" click → `#assistant-panel` with `role="dialog"`, `aria-label="AI analyst"`, all four suggested-prompt chips (exactly the recruiter-facing four from the Streamlit assistant), input labeled/placeholder "Ask the analyst —", SEND button, and footer "Session-only — refresh clears the conversation. Not investment advice." **No message was sent and nothing was POSTed** (`assistant-panel-open-no-send.png`). Route mount separately confirmed side-effect-free: `GET /api/assistant/ask` → 405 (POST-only route exists).

---

## 3. Cross-surface number consistency

| Number | Surfaces | Verdict |
|---|---|---|
| **HY OAS 269 bps** (2026-08-01) | Credit hero "269 bps"; LBO financing input "HY spread 2.69pp" (`/api/lbo/defaults` → `hy_oas_pct: 2.69`); assistant's live answer from tonight's saved evidence — `phase6/panel-live-answer.png` shows the streamed reply "HY OAS stands at 269 bps (2026-08-01, FRED HY index), which is tight…" **in the same frame** as the Credit hero's 269 bps. `/api/credit/oas` still returns 269 bps at this review's capture time, so the number is current, not just historical. | **CONSISTENT** |
| **Fed Funds 3.63%** (Jul 2026) | Dashboard KPI "FED FUNDS 3.63% · Overnight policy rate · monthly average · Jul 2026" = Allocation header "RISK-FREE 3.63% (FED FUNDS)" (`/api/allocation` → `rf_rate: 0.0363`) = LBO "Fed Funds 3.63% + HY spread 2.69pp" (`/series/FEDFUNDS/latest` → 3.63). | **CONSISTENT** |
| **2s10s +46 bps** | Recession "YIELD CURVE · 2S10S +46 bps … (0.46%) — the 37th percentile of 30 years" = Dashboard "+46 bps (0.46%)" = Methodology signals-table curve row "0.46%" (DGS10 4.70 − DGS2 4.24 = 0.46 from the unprefixed series endpoints). | **CONSISTENT** |
| **One "current" price per symbol on Markets** | The tape carries exactly one LAST per symbol with an as-of stamp (SPY $764.99 · Aug 25, 19:59 ET). The chart panel suppresses its own last-value badge — code-verified (`ChartPanel.tsx:152,159` `lastValueVisible: false` on both series, comment documents the intent) and visible in the chart deep-link screenshots (no price chip on the pane). The header ticker strip shows a *separately labeled* live-stream quote (765.84, "live tape ticking via stream") — a different pipeline with its own provenance, exactly what Markets' own caption declares: "the same metric carries a different level on each surface." | **CONSISTENT (by declared provenance)** |
| **Provenance labels** | "monthly signal print · Aug 2026" on every Dashboard signal card and in Methodology; "weekly derived series · week ending Aug 28, 2026" on Markets surprises; Methodology adds the explicit cross-surface statement. | **PRESENT** |

---

## 4. Findings (reported, not fixed — per review mandate)

- **F1 · Cosmetic, 1pp — scenario "stored odds today" says GL 65% while the header badge says 64%.** Mechanism traced: `src/analytics/intelligence.py` (~lines 540–545) rounds each stored prob to an integer percent and then adds the rounding residual to the *dominant* regime so the four sum to 100 (0.6422→64, 0.3512→35, 0.0043→0, 0.0023→0, sum 99, +1 → GL 65). The header instead shows the raw dominant prob (64%). Both are defensible individually; side by side they disagree by 1pp. Options for the owner: distribute the residual by largest-remainder instead of dominant-wins, or have the scenario card display the raw dominant like the header.
- **F2 · Minor — dev UI-kit route ships:** `web/src/App.tsx:14` routes `/kit` → `KitScreen`, a component-kit page with hardcoded fixture data (e.g. "2s10s Spread +52 bps" vs live +46). Nothing links to it, but it is reachable by URL on the deployed app and shows plausible-but-fake numbers. Consider gating behind `import.meta.env.DEV` or removing before deploy.
- **F3 · Harness, not app — `verify-interactions.mjs` regimelab-scenario step asserts `/stressed|Stressed/`** against innerText that arrives CSS-uppercased ("STRESSED ODDS") → guaranteed false failure. One-character fix when the harness is next touched: `/stressed/i`. (Not fixed by this review — no code edits allowed.)
- **Observation, no action — header stream vs tape print:** SPY 765.84 (live stream, header) vs $764.99 (stored LAST, tape, stamped Aug 25 19:59 ET) differ by ~$0.85. Both carry their own labels/pipelines and the app narrates this exact situation on Markets and Methodology; noting it here so nobody mistakes it for a bug in the morning.
- **Robustness checked in passing:** unknown `/app/<slug>` redirects to `/app/dashboard` (AppShell:148); unknown top-level paths redirect to `/`.

---

## 5. Verdict

**Ready for morning review, at desktop and mobile widths.** All 40 route-width combos load with zero console errors, zero page errors, zero failed requests, and zero page-level horizontal overflow — the measurement is exact, not approximate — and every surface renders live data with honest provenance: real headlines and a real event calendar, a fully populated tape with as-of stamps, and the same macro numbers (HY 269 bps, Fed Funds 3.63%, 2s10s +46 bps) agreeing everywhere they appear, including in the assistant's live-verified answer from tonight. All eight interaction flows work — seven pass the harness outright and the eighth (scenario presets) was independently re-verified as a harness-side case-sensitivity quirk, with the feature itself producing correct stressed odds — and the allocation risk lenses and assistant panel open cleanly. The three genuine findings (a 1pp rounding disagreement in the scenario card, a stray dev `/kit` route with fixture numbers, and the harness regex) are all cosmetic or tooling-level; none blocks use, none corrupts a displayed live number on the ten shipped routes. Nothing found tonight would embarrass this app in front of a recruiter on a phone or a desktop.
