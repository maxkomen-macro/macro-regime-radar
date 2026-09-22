---
target: landing page
total_score: 23
max_score: 28
na_heuristics: 5,7,10
p0_count: 0
p1_count: 2
timestamp: 2026-08-06T11-25-41Z
slug: web-src-screens-landingpage-tsx
---
Method: dual-agent (A: design-review subagent · B: detector subagent)

# Critique — Landing page (Persuade)

## Design Health Score (applicable max 28 — h5, h7, h10 n/a on this surface)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | live read + as-of date; honest dot; written loading/offline states |
| 2 | Match System / Real World | 3 | GL/OV/ST/RR + "conviction" unglossed at first contact (fixed: four regimes now named in the explainer) |
| 3 | User Control and Freedom | 3 | single path, nothing to lose |
| 4 | Consistency and Standards | 3 | badge hue vs bar hue for the same regime (bundle-internal token contradiction — owner item) |
| 5 | Error Prevention | n/a | no error-prone action exists |
| 6 | Recognition Rather Than Recall | 3 | regimes unnamed (fixed) |
| 7 | Flexibility and Efficiency | n/a | one-shot page, no repeated task |
| 8 | Aesthetic and Minimalist Design | 4 | one viewport, one claim, one CTA, zero decoration |
| 9 | Error Recovery | 3 | offline collapsed the hero (fixed: localStorage last-good-read fallback with date qualifier) |
| 10 | Help and Documentation | n/a | self-explanatory single viewport |
| **Total** | | **23/28** | **Good (82%)** |

## Specificity verdict
Authored, decisively (A). No template DNA; the live model read with its date is the hero; the
liveRead() coin-flip/contested/clear ladder is authored voice. Detector (B): 0 findings on this
file; bundle-level rails/fonts flagged elsewhere were classified FP against the pinned system.

## Priority issues → disposition
- P1 badge/bar regime hue contradiction (bundle tokens `--badge-overheating-*` red vs regime ramp orange) → **logged for owner ratification** (token-level).
- P1 no cached fallback when API down → **fixed** (localStorage last-good payload, "Last stored read · … · live feed unavailable").
- P2 four-regime vocabulary unexpanded → **fixed** (named in the explainer sentence).
- P2 as-of eyebrow at 2.3:1 faint → **fixed** (moved to --text-label rung, 5.9:1).
- P3 LinkedIn og:/twitter: tags missing → **fixed** (og:title/description + twitter card; og:image = owner call, no logo may be drawn).
- Minor deferred: caret idiom unused on loading line; conviction gloss in-sentence; centered-column note logged for owner (extends the memo exception).

## Personas
Jordan survives (explainer + named regimes; conviction still undefined on this surface — dashboard's Jargon layer covers it). Casey: near-mobile-safe by accident; CTA raised to ≥44px; full responsive pass deferred by plan.
