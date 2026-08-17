---
name: Macro Regime Radar
description: A Bloomberg-terminal-style quantitative macro platform — dark, dense, information-first
colors:
  accent-blue: "#4a9eff"
  accent-hover: "#7ab8ff"
  accent-active: "#3b86dd"
  void: "#010409"
  page: "#0d1117"
  card: "#161b22"
  raised: "#21262d"
  line-hair: "#21262d"
  line: "#30363d"
  line-strong: "#484f58"
  text-primary: "#e6edf3"
  text-body: "#c9d1d9"
  text-muted: "#8b949e"
  text-label: "#8899aa"
  text-faint: "#484f58"
  up-green: "#3fb950"
  down-red: "#da3633"
  red-on-dark: "#f08785"
  watch-amber: "#d29922"
  elevated-orange: "#e67e22"
  flat-grey: "#95a5a6"
  research-violet: "#7c3aed"
  regime-goldilocks: "#2ecc71"
  regime-overheating: "#e67e22"
  regime-stagflation: "#e74c3c"
  regime-recession: "#95a5a6"
typography:
  display:
    fontFamily: "Space Grotesk, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Space Grotesk, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.45
  title:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "IBM Plex Mono, SF Mono, Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.5px"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "20px"
spacing:
  gap-chip: "4px"
  gap-inline: "8px"
  gap-card: "12px"
  gap-section: "16px"
  pad-card: "12px"
  pad-card-lg: "16px"
  pad-badge: "8px 20px"
  pad-chip: "2px 6px"
  pad-cell: "8px 12px"
  page-gutter: "28px"
components:
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.pad-card}"
  tag-neutral:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-label}"
    rounded: "{rounded.xs}"
    padding: "{spacing.pad-chip}"
  regime-badge:
    rounded: "{rounded.md}"
    padding: "{spacing.pad-badge}"
    typography: "{typography.headline}"
---

<!-- PROVISIONAL — pending owner review. Recorded 2026-08-06 (overnight session)
     in scan mode from the incumbent design bundle at
     /Users/maxkomen/Documents/Trading-Research-Docs/Macro Regime Radar Design System/
     (tokens/*.css + readme.md content rules + 17 shipped components). Nothing here
     was invented; where this file and the bundle disagree, the bundle wins and the
     disagreement is a bug in this file. Token-level changes are owner-only. -->

# Design System: Macro Regime Radar

## Overview

**Creative North Star: "A terminal that is awake."**

Dark, dense, information-first. The product states, it does not sell — every screen is
built from real model output and market data, set in a strict three-face type system on
GitHub-dark surfaces with one blue accent. Density is the aesthetic: 12px card padding,
12px grid gaps, hairline borders. If a screen feels empty, the answer is more data,
not decoration.

The system is awake, not animated: the only motion tells you something changed. A 6px
dot pulses where data is live, a value flashes green or red for 600ms when it ticks,
and a caret blinks where the terminal awaits input. Nothing bounces, slides, or fades
on scroll.

Confirmed anti-references (owner brief): generic SaaS dashboards, Inter-everything,
purple gradients, cards-in-cards, decorative motion, icon libraries.

**Key Characteristics:**
- GitHub-dark surface stack (#010409 → #0d1117 → #161b22 → #21262d), flat, no gradients
- One brand accent (#4a9eff) that never means "good"
- Three typefaces with mechanical jobs; every number is mono with tabular figures
- 0.5px hairline borders; 3px left rail marks generated/elevated content
- Unicode glyph vocabulary (▲ ▼ → ↗ ↘ ◆ ✓ ×) instead of an icon set
- Desk-note voice: declarative, present tense, every claim carries its number

## Colors

GitHub-dark lineage; five surface stops, a fixed text ladder, one accent, and a strict
directional-semantic layer. Two background colors per surface, maximum. No gradients
anywhere in this product.

### Primary
- **Accent Blue** (#4a9eff): the one brand blue — links, focus, active tab underline,
  sparklines, model-output rails, the wordmark dot. It marks attention and attribution,
  never valence. Hover lightens to #7ab8ff; active darkens to #3b86dd.

### Neutral
- **Void** (#010409): deepest well — terminal wells, iframe backdrops.
- **Page** (#0d1117): app background.
- **Card** (#161b22): every panel and card surface.
- **Raised** (#21262d): gauge tracks, chips, hover fills.
- **Hairline** (#21262d) / **Line** (#30363d) / **Strong** (#484f58): the border ladder.
- **Text ladder** #e6edf3 → #c9d1d9 → #8b949e → #8899aa → #484f58: primary → body →
  secondary → uppercase section labels → decorative meta. Functional text — as-of
  stamps, freshness cells, axis values, column headers, anything informational —
  sits no lower than #8b949e (`--text-muted`, ruled 2026-08-06); #484f58
  (`--text-faint`) is reserved for decorative meta only (null dashes, disclosure
  glyphs, idle dots, zero-probability legend entries). Each step has a fixed job;
  do not improvise greys.

### Semantic (directional first)
- **Up Green** (#3fb950): up, clear, risk-on. Green is always "up", never "good".
- **Down Red** (#da3633): down, triggered. As text on dark it shifts to
  **Red-on-Dark** (#f08785) for contrast.
- **Watch Amber** (#d29922): watch state. **Elevated Orange** (#e67e22): elevated/overheating.
- **Flat Grey** (#95a5a6): unchanged / no-signal.
- **Research Violet** (#7c3aed): Perplexity-sourced research attribution and nothing else.

### Regime colors
Fixed by the classifier: Goldilocks #2ecc71 · Overheating #e67e22 · Stagflation
#e74c3c · Recession Risk #95a5a6. Always rendered as a 12%-opacity fill with a
25%-opacity border — never a solid block.

### Gauge ramp
Threshold proximity is a fixed meaning ramp: <50% green (#3fb950) · 50–75% amber
(#d29922) · 75–95% orange (#e67e22) · ≥95% red (#da3633).

**The One Accent Rule.** #4a9eff is the only brand color. It never encodes good/bad —
valence belongs exclusively to the directional layer.

**The 12% Fill Rule.** Regime and status tints render at 12% fill / 25% border. A solid
regime-colored block is always wrong.

## Typography

**Display Font:** Space Grotesk (with IBM Plex Sans, system-ui fallback)
**Body Font:** IBM Plex Sans (with system-ui fallback)
**Label/Mono Font:** IBM Plex Mono (with SF Mono, Consolas fallback)

**Character:** A terminal register — mono carries the data, a compact grotesk carries
the headlines, and the UI face disappears into legibility. Nothing lighter than 400.

### Hierarchy
- **Display** (700, 34px, lh 1): the dashboard hero number. Also the wordmark (uppercase,
  ~0.14em tracking) and 26px hero metrics. Large mono figures pull tight at −0.02em.
- **Headline** (500–700, 18–20px): the regime badge and the one-sentence market read
  (Space Grotesk); 18px mono for signal-card values.
- **Title** (500, 12px): card titles, table text (Plex Sans).
- **Body** (400, 13px, lh 1.55): prose, memo body. Max measure 74ch.
- **Label** (600, 11px, +0.5px tracking, UPPERCASE): mono section labels. 10px meta
  carries +1px; 9px eyebrows and column headers carry +1.5px.

**The Mono Number Rule.** If it is a figure, label, ticker, timestamp, or column header,
it is IBM Plex Mono with `font-variant-numeric: tabular-nums` — without exception. If it
is a headline it is Space Grotesk; otherwise it is IBM Plex Sans.

**The Tracking Rule.** Tracking widens as type shrinks: 0.5px at 11px, 1px at 10px,
1.5px at 9px — and inverts to −0.02em on large mono figures.

## Layout

Full-width fluid grid, 28px page gutters, no max-width container (the emailed memo is
the only fixed-width surface at 600px). Screens are equal-fraction card grids —
`repeat(3,1fr)`, `repeat(4,1fr)`, `repeat(5,1fr)` — with 12px gaps. Card padding is
12px (16px for large panels); section header → content gap is 10px; section-to-section
gap is 16px; table cells are 8px × 12px. The spacing scale steps in 2px increments
below 12px (2, 3, 4, 6, 8, 10, 12) then 16, 20, 24, 32, 40. Header furniture is the
only fixed element: wordmark + live dot, ticker strip, regime badge + probability bar,
tab bar, then a 10px mono data-freshness line.

Density is deliberate and waived against generic-density heuristics: this is a
terminal, and the 12px rhythm is its signature.

## Elevation & Depth

**Flat.** Depth comes from surface value (#010409 → #0d1117 → #161b22 → #21262d),
never shadow. No blur, no frosted glass, no backdrop filters anywhere.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(1,4,9,.6)`): the floating assistant only —
  the single drop shadow in the system.

**The Flat Rule.** A new shadow anywhere else is a defect. If depth is needed, step the
surface value.

## Shapes

Hairlines and small radii. **0.5px hairline** (#21262d) is the house border — at 1px
the density reads as a grid of boxes; 1px is reserved for section-header rules, table
headers, and the tab bar. A **3px left rail** marks generated or elevated content: blue
for model output, green for the live intelligence banner, alert-level color on feed
rows. Radii: 3px chips/gauges · 6px cards/badges/buttons · 8px memo cards · 20px memo
regime chip (the one pill in the system). State never changes fill: a warn/risk card
swaps its border to rgba(210,153,34,.3) / rgba(218,54,51,.3) while the surface stays
#161b22.

Transparency carries meaning: 12% fills for muted badges, 25–40% for their borders,
1.2% white for table zebra striping, 10% under sparkline areas.

## Components

Seventeen components ship in `web/src/components/` (ported verbatim from the bundle).
Each has a `.d.ts` props contract and a `.prompt.md` usage card — read the prompt
before changing an API.

### Card (`core/Card`)
- **Character:** flat dark panel every module sits in.
- **Shape:** 6px radius, 0.5px hairline; tone swaps border color only
  (watch/risk/clear/accent at 30% opacity); `accentBar` adds the 3px left rail.
- **Background:** #161b22 always; `surface="var(--void)"` for terminal wells.
- **Internal padding:** 12px (16px large).

### SectionHeader (`core/SectionHeader`)
- 11px uppercase mono, +0.5px tracking, #8899aa on a 1px hairline rule — the most
  recognisable typographic move in the product. `level="sub"` drops to 12px sentence
  case, no rule. Titles are short noun phrases, no terminal punctuation.

### Tag / StatusDot (`core/`)
- Tag: 9px mono uppercase chip, 3px radius, 12% tinted fill + 25% border; tones map to
  meaning (pos=clear, warn=watch, neg=triggered, research=Perplexity), never decoration.
- StatusDot: the 6px CSS-circle live tell; pulses only when live/triggered; one pulsing
  element per screen region.

### Data (`data/`): StatTile, GaugeBar, Sparkline, ProbabilityBar, DataTable
- StatTile: label/value/delta triple; values arrive preformatted; ▲ green ▼ red → grey.
- GaugeBar: 4px threshold-proximity bar on the fixed meaning ramp; never scaled up.
- Sparkline: inline SVG, 1.5px stroke, 10% area fill, no axes, no tooltips.
- ProbabilityBar: the four softmax probabilities stacked in fixed GL→OV→ST→RR order;
  zero entries drop to faint rather than disappearing.
- DataTable: 9px uppercase column headers (+1.5px tracking), 12px cells, every numeric
  column mono, zebra at 1.2% white.

### Signals (`signals/`): RegimeBadge, SignalCard, AlertRow
- RegimeBadge: four labels only, Space Grotesk 700, muted 12%/25% treatment, never solid.
- SignalCard: pass the server-computed `status` when available (ratified
  2026-08-06: the stored triggered flag owns "Triggered", so a near-threshold
  signal reads Watch, never a false Triggered); without it, status derives from
  fill% (<50 Clear, 50–75 Watch, ≥75 Triggered). Border and dot follow; only
  Triggered pulses. Display names are humanised ("Unemployment spike"),
  never snake_case.
- AlertRow: 3px left rail in level color; info/watch/risk only; message is the raw
  generated sentence, ends with a period.

### Nav (`nav/`): TickerStrip, TabBar
- TickerStrip: 3–5 items maximum — orientation, not a watchlist; 600ms directional
  flash on change.
- TabBar: text tabs on a hairline rule, 2px accent underline on active; never pills,
  boxes, or background fills.

### Intel (`intel/`): IntelBanner, ReadThrough, NewsCard
- IntelBanner: one sentence stating where the market is; green rail + pulsing dot mean
  the data behind it is current.
- ReadThrough: 2–4 paragraphs of model prose behind a blue rail (model output, not
  measured data); single-sentence bias footer.
- NewsCard: significance colors itself (≥7 red, ≥5 orange, ≥4 amber); attribution
  glyphs ◆ CLAUDE and ◆ PERPLEXITY are kept — they say which model produced which text.

## Do's and Don'ts

### Do:
- **Do** put every number, label, ticker, timestamp, and column header in IBM Plex Mono
  with tabular figures (The Mono Number Rule).
- **Do** give every metric its label, unit, timeframe, and a one-line desk-note caption —
  "CPI runs at 4.17% YoY, a 3.9σ jump vs its recent weekly range."
- **Do** use the closed status vocabulary: Clear/Watch/Triggered · info/watch/risk ·
  Risk-On/Risk-Off · Aligned/Diverges. Never invent synonyms.
- **Do** use 0.5px hairlines as the default border and step surface value for depth.
- **Do** state freshness honestly ("monthly observations · latest Jul 01, 2026") and
  fall back to latest-available data with its date instead of an empty state.
- **Do** respect `prefers-reduced-motion` on every animation, and keep focus rings
  (1px #4a9eff, 2px offset) always.
- **Do** end anything that leaves the app with "Automated briefing from Macro Regime
  Radar. Not investment advice."

### Don't:
- **Don't** add an icon library, draw custom SVG icons, or substitute emoji — the glyph
  vocabulary is Unicode: ▲ ▼ → ↗ ↘ ⬆ ⬇ ◆ ● ✓ × ▸ ▾ ▪. If a concept needs an icon, it
  needs a label.
- **Don't** use gradients, photography, illustration, texture, blur, or drop shadows
  (the assistant float is the sole shadow).
- **Don't** render regime colors as solid blocks — 12% fill / 25% border always.
- **Don't** let #4a9eff mean "good" or use color as the only status channel.
- **Don't** nest cards in cards, center content in narrow columns (memo excepted), or
  add hover background fills outside tables.
- **Don't** soften the terminal: no Inter-everything, no generic-SaaS layouts, no
  decorative motion, nothing lighter than weight 400, no pill shapes (memo chip excepted).
- **Don't** show a naked number: unlabeled decimals ("0.510 / 1.843") and unit-less
  indices are the product's documented worst failure mode (confusion index, 27 items).

<!-- Detector waivers (deliberate, owner-confirmed via overnight brief; do not "fix"):
     heavy mono usage · dense card grids (12px rhythm) · dark-only theme ·
     12px-scale typography density. These are the product's signature, not defects. -->
