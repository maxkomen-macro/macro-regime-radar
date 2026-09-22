# Design Critique Notes — React Rebuild

**Session:** 2026-08-26 · observation-only pass (no code changes)
**App:** `http://localhost:8000` (branch `react-rebuild`, 40/40 route-width combos green)
**Method:** walk each screen at 1440 and 375 with Max; capture his notes verbatim, add observations defensible against `web/DESIGN.md` / `web/PRODUCT.md`. Items already logged in `.impeccable/critique/*` are not re-raised.
**Evidence:** screenshots in `proposals/design_notes_evidence/`
**Severity:** blocking / significant / polish — ordered by impact on a recruiter's first ten seconds (audience #1, likely on a phone).

Screens planned: dashboard · landing · markets · regime-lab · credit · recession · news · tools (#lbo, #allocation) · methodology · AI Analyst panel.

---

## 1. /app/dashboard

Evidence: `dashboard-1440-full.png`, `dashboard-375-full.png`, `dashboard-375-fold.png`

### Max's notes

*(superseded — before giving screen-by-screen notes, Max pivoted the session into a
full revamp brief via /impeccable; see `proposals/REVAMP_BRIEF.md`. His standing
verdicts from that brief: the mono-heavy font was hard to read and analyze; the layout
needed restructuring; UI captions read as AI slop. The critique walk stopped here.)*

**Session postscript (2026-08-26, same session):** Phase 1 of the revamp executed.
Of the findings below: header-chrome (fixed — mobile header collapsed, banner on the
first phone screen), ticker clipping (fixed — phones shed the parentheticals),
conviction-chip wrap (fixed — nowrap + shrink guard), signal-caption ownership
(fixed — 20px row gap, 12px caption indent, captions in prose face), freshness meta
(fixed — one compressed line under 480). Still open: What's Priced sparseness
(deferred to the dashboard restructure pass) and the AI ANALYST launcher overlap
(page bottom padding exists; mid-scroll overlap remains). After-screenshots:
`after-*.png` in the evidence folder.

### Dashboard — header chrome eats the entire first phone screen
**Source:** you
**Severity:** blocking
**What:** At 375, the stack above the content is ~420px: wordmark → ticker strip → regime badge → probability bar → "✓ all clear" chip → METHODOLOGY/⌘K row → tab bar → two wrapped freshness lines. The Market Intelligence sentence — the actual ten-second read — starts at the very bottom of the first screen; the hero number (64%) is below the fold on an iPhone.
**Why:** PRODUCT.md audience #1 is "finance recruiters arriving via LinkedIn. One visit, ~10 seconds" — and they arrive on a phone. The first screen is almost entirely furniture; the product's one-sentence proof of life isn't on it. DESIGN.md's header spec ("header furniture is the only fixed element") doesn't anticipate the mobile stacking cost.
**Suggested fix:** Layout change, mobile only: collapse header rows below 480 — regime badge and probability bar share a row (the badge already carries "Goldilocks 64%", so the bar could drop entirely on mobile since the same data repeats 60px lower); move "✓ all clear" into the alert drawer badge; fold METHODOLOGY/⌘K into the tab row or an overflow; compress the two freshness lines to one ("Macro Jul 2026 · tape live"). Target: banner sentence visible on first paint at 375.
**Evidence:** dashboard-375-fold.png (fold ends mid-probability-bar-explainer)

### Dashboard — US 10Y ticker item clips mid-parenthetical on mobile
**Source:** you
**Severity:** significant
**What:** At 375 the third ticker item renders "4.70% (-5" — the "(−5 bps 1w)" delta is cut at the viewport edge with no ellipsis and no scroll affordance visible at rest.
**Why:** Reads as a rendering bug, and PRODUCT.md is explicit that polish failures are fatal for audience #1. Also violates the desk-note rule that every number ships complete with its qualifier — "(-5" is a naked fragment.
**Suggested fix:** Component change (TickerStrip): at <480 either drop the 1w delta and keep "4.70%" clean, or let the strip scroll horizontally with items snapping whole — never clip mid-token.
**Evidence:** dashboard-375-fold.png (top right)

### Dashboard — MEDIUM CONVICTION chip wraps and outshouts its section label on mobile
**Source:** you
**Severity:** significant
**What:** In the Market Intelligence banner at 375, the "MEDIUM CONVICTION" chip wraps onto two lines and its accent-blue border box becomes the visually loudest element of the banner header row, forcing "MARKET INTELLIGENCE" to wrap as well.
**Why:** A chip is a single-line object; wrapping breaks its shape grammar (DESIGN.md tag spec: 9px mono uppercase chip). Hierarchy inverts: the qualifier (conviction) reads louder than the content label. Note the chip's accent-blue treatment is already logged in night-2 ("server-provided colors… MEDIUM CONVICTION accent"), so only the wrap/prominence is new here.
**Suggested fix:** Component change: `white-space: nowrap` on the chip; on mobile move it out of the header row — e.g. into the meta row beside "Recession model / Duration / Macro data" — so the label row stays label + dot only.
**Evidence:** dashboard-375-fold.png (banner)

### Dashboard — signal-card captions live outside the card border
**Source:** you
**Severity:** significant
**What:** Each of the five Monitored Signals cards ends after "Last alert: …", and the two caption lines ("Trips when …" + "monthly signal print · Jul 2026 · monthly print pending") float below the card, outside its border. At 1440 the five caption blocks wrap to different line counts, so the row bottom is ragged and ownership is ambiguous at a glance. At 375 the stack alternates card / loose text / card / loose text, and the trip condition for card N sits closer to card N+1's top border than card N appears to own it.
**Why:** DESIGN.md's card is "the flat dark panel every module sits in" — content that belongs to a module should sit in its panel. The desk-note caption rule ("every metric ships with its caption") is satisfied in content but the binding is visually broken; density-with-ambiguity isn't the terminal signature, density-with-alignment is.
**Suggested fix:** Component/layout change: move the two caption lines inside the SignalCard below a hairline, or tighten the caption-to-own-card gap and widen the card-to-card gap so grouping reads unambiguously (spacing-token change only, no new components).
**Evidence:** dashboard-1440-full.png (signals row), dashboard-375-full.png

### Dashboard — What's Priced teaser is the one sparse module on a dense screen
**Source:** you
**Severity:** polish
**What:** The 3-row teaser spreads label-left / value-right across the full ~1384px content width at 1440; the middle ~900px of each row is empty, and the eye has to travel the full width to bind "SOFR · policy rate proxies" to "3.65% −0.01pp MoM".
**Why:** DESIGN.md: "If a screen feels empty, the answer is more data, not decoration" and the 12px-rhythm density signature. Every other module on the page is dense; this one is airy in a way that reads unfinished rather than restful. Long label-to-value gaps also fight the DataTable idiom used elsewhere.
**Suggested fix:** Layout change: add the middle columns the full Markets table already has (e.g. as-of, 1w delta), or cap the table at ~half width with the caption beside it. No new component needed — this is the existing table idiom.
**Evidence:** dashboard-1440-full.png (What's Priced)

### Dashboard — AI ANALYST launcher covers content at the mobile fold
**Source:** you
**Severity:** polish
**What:** At 375 the floating "◆ AI ANALYST" chip overlaps the probability-bar explainer text ("Conviction is a separate number: 50%") at first paint; on a short phone viewport a fixed bottom-right launcher covers some line of content most of the time.
**Why:** The float is sanctioned (the one shadow in the system), but covering functional text on the recruiter's first screen trades a secondary affordance against primary content.
**Suggested fix:** Component change, mobile only: shrink the launcher to the ◆ glyph alone (with aria-label), or add bottom padding to the page equal to the launcher height so the last line always clears it.
**Evidence:** dashboard-375-fold.png (bottom right)

### Dashboard — freshness meta opens the mobile page with four wrapped lines
**Source:** you
**Severity:** polish
**What:** At 375 the two freshness lines wrap into four lines of 10px muted mono ("Macro data as of Jul 2026 · Signals Aug 2026 · Market …" / "Stored intraday to Aug 25, 15:55 ET · live tape ticking …") directly under the tabs, before any content.
**Why:** Honest freshness is a core principle, but four lines of meta before the first module inverts hierarchy on the smallest screen — meta before message.
**Suggested fix:** Layout change: single compressed freshness line at <480 ("Jul 2026 macro · Aug 25 market · tape live"), full detail preserved at ≥768 and in Methodology.
**Evidence:** dashboard-375-full.png (below tab bar)

### What works (for the record)
- The banner sentence is a genuine ten-second read: regime, odds, runner-up, conviction in one desk-voice line.
- Mono/tabular discipline is consistent; every number seen carries label, unit, and timeframe (the confusion-index work shows).
- Status is never color-only: every dot pairs with Clear/Watch text; the closed vocabulary holds everywhere observed.
- KEY LEVELS' three tone-bordered cards + five stat tiles is the density signature working as intended at 1440.

---

## 2. Exec-lens pass — 2026-08-27 (/design:design-critique, all findings fixed same-session)

Audience frame: executive-level hedge-fund / trading-firm viewers. Screens swept at 1440
(full-page) with 375 spot-checks: regime-lab, credit, recession, tools#lbo,
tools#allocation, assistant panel. Evidence: `sweep-*.png`, `confirm-*.png`, `p2-*.png`.

### Overall
The night-2 screens hold up to the exec bar — Credit's 30-year OAS chart with NBER bands,
Recession's model card and coefficient bars, and Regime Lab's scenario builder read as a
professional terminal. The gaps were concentrated in copy stragglers and two structural
items, all fixed:

### Findings → dispositions
- **Server-composed prose still carried em-dash asides** (Regime Lab takeaway "2nd
  percentile — historically tight"; news interpretations) — **fixed**: `tidyProse()`
  display filter in `lib/format.ts`, applied where takeaway narrative and generated news
  text render. UI-authored stragglers (9 across credit/lbo/allocation/assistant/regimelab)
  swept in pass 4; visible em-dash asides are now zero on every surveyed screen.
- **What's Priced was the one sparse module on a dense screen** — **fixed**: 3-row
  full-width list → 3-up StatTile grid matching the KPI-strip idiom (`confirm-whats-priced.png`).
- **MARKET INTELLIGENCE eyebrow broke mid-word at 375** — **fixed**: eyebrow nowrap +
  header row flex-wrap; the chip drops whole to a second line instead.
- **Backtests cohort column repeated each name four times** — **fixed**: cohort prints
  once per group; later rows keep the name for screen readers via aria-label.
- **Not raised**: Allocation's "no optimizer output this session" block (honest state,
  data question tracked elsewhere); assistant launcher overlap (page-level clearance
  exists; inherent to a FAB).

### Phase 2 addition (built in the same session)
Single-name research shipped at the top of Markets: search any listed symbol, delayed
quote with honest stamp, candle+volume chart across seven ranges, fundamentals tiles,
regime-fit table (monthly closes × stored classifier), stored-coverage list with
headline-match fallback. Evidence: `p2-search-open.png`, `p2-nvda-top.png`,
`p2-nvda-regime.png`, `p2-nvda-375.png`.
