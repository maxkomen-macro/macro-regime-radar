---
target: Dashboard
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-06T11-25-41Z
slug: web-src-screens-dashboard-dashboardscreen-tsx
---
Method: dual-agent (A: design-review subagent · B: detector subagent)

# Critique — Dashboard (Operate)

## Design Health Score (max 40)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | freshness architecture near-perfect; IntelBanner's hardcoded pulse asserts liveness over monthly data (bundle API — owner item) |
| 2 | Match System / Real World | 3 | desk voice + Jargon layer; dev-log leaks (fixed); unscaled −3.91 score (fixed: dropped) |
| 3 | User Control and Freedom | 3 | URL tabs/anchors/Esc; focus restore added; full trap deferred |
| 4 | Consistency and Standards | 2 | regime hue clash (owner); ticker parenthetical semantics; bps/% split (both-units caption added); ↔ glyph (fixed → "vs"); IA order (fixed) |
| 5 | Error Prevention | 3 | read-only; seams stated; drift warning documented |
| 6 | Recognition Rather Than Recall | 3 | legend printed on-page; thresholds in captions |
| 7 | Flexibility and Efficiency | 3 | ⌘K real; dead-end jumps now labeled "planned"; no chart hover readout (deferred) |
| 8 | Aesthetic and Minimalist Design | 3 | density waived; hero states 46/41/27 thrice (accepted teaching redundancy) |
| 9 | Error Recovery | 3 | every failure has copy; uvicorn leak fixed |
| 10 | Help and Documentation | 3 | Jargon layer + legends; Methodology placeholder |
| **Total** | | **29/40** | **Good (72.5%)** |

## Specificity verdict
Authored (A): composition maps 1:1 to the product's data model; nothing stock. Detector (B):
8 findings → 6 FP against the pinned system (3px rails ×3, link-state colors ×2 — promoted into
DESIGN.md frontmatter, Space Grotesk — waivered per brief), 2 real (width transitions inside
verbatim bundle GaugeBar/ProbabilityBar — logged for owner; reduced-motion kill added app-side).

## Priority issues → disposition
- **P0 caption layer at 2.1:1 contrast** → **fixed** (captions + signals legend to --text-muted 5.6:1; true meta stays faint per ladder; bundle-internal faint labels logged for owner).
- P1 IntelBanner unconditional pulse over Jun-2026 data → **logged for owner** (needs a `live` prop — bundle API change); reduced-motion now silences all inline pulses/flashes/width-refills app-side.
- P1 dev-log voice (uvicorn/Streamlit/overnight-report/endpoint) on product surfaces → **fixed** (desk-voice rewrites; placeholders, What's Priced seam, error copy).
- P2 zero visible time-series on default paint + section order vs locked IA → **fixed** (regime-odds panel opens by default — still an in-place accordion; signals moved above KPIs; quarter-date x-labels added to LineChart).
- Minor fixed: Duration meta de-ambered; "Model vs market"; plural grammar; "sum to 100%" claim softened; palette input focus ring restored; drawer edge to hairline; ⌘K title carries Ctrl+K.
- Minor deferred/owner: jargon tooltip edge flip; header target count; palette 35-entry default list; curve-inversion binary gauge (server formula pinned); resting-Watch paradox (VIX 55% proximity at calm levels); prob-rounding largest-remainder; heading-hierarchy semantics; focus trap.

## Personas
Alex: palette now labels planned destinations; chart readout deferred. Sam: Jargon layer got a
title fallback (SR/touch); focus restore added; faint-contrast P0 fixed; full trap + headings deferred.
