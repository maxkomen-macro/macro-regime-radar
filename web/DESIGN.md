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
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
  lead:
    fontFamily: "Space Grotesk, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.35
  caption:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
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
  frame-max: "1520px"
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

**Executive hierarchy (2026-09-05 pass, owner-directed).** Every major screen reads in
one fixed order: (1) the conclusion, (2) why it matters, (3) what changed, (4) supporting
evidence, (5) what would invalidate the conclusion, (6) methodology and provenance. A
finance executive gets the central message inside ten seconds from the desk read at the
top; the analyst keeps every table underneath, with methodology, formulas, long caveats
and provenance one click down behind disclosure rows. Conclusions are stated once per
screen; stacked banners repeating one read are a defect.

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
  (`--text-faint`) is reserved for decorative meta only (idle dots and exact-zero
  legend entries). Missing-data dashes, "no quote" cells, availability words and
  disclosure glyphs read at `--text-muted` (2026-09-05): a reader has to read them.
  Each step has a fixed job; do not improvise greys.

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

**Evolved 2026-08-26 (owner-directed readability pass).** The size ramp moved up one
rung (micro 9→10, meta 10→11, body-s 12→13, body 13→14, body leading 1.55→1.6; a new
`--fs-caption` rung) and mono narrowed to data only: every desk-note caption,
explainer, state note, and prose sentence renders in IBM Plex Sans. Mono inside a
caption is opt-in per number. The 11px mono uppercase section label — the system's
signature move — is unchanged.

**Floor raised again 2026-09-05 (owner-directed executive pass).** `--fs-micro` 10→11,
`--fs-meta` 11→12, `--fs-caption` 12→13; a new `--fs-lead` 20px rung carries the
desk-read conclusion. Tracking tightened: `--ls-wide` 1.5→1px, `--ls-micro` 1→.6px;
`--ls-label` stays .5px. Minimum readable text is now 11px mono (status words, column
headers, gauge captions) and 13px sans for anything a reader must read; 11px is
reserved for genuinely secondary metadata. No inline font size below 10px survives
(the Gantt lane labels and matrix headers were the last ones).

### Hierarchy
- **Display** (700, 34px, lh 1): the dashboard hero number. Also the wordmark (uppercase,
  ~0.14em tracking) and 26px hero metrics. Large mono figures pull tight at −0.02em.
- **Lead** (500, 20px, lh 1.35, Space Grotesk): the desk-read conclusion, max 36ch.
  Drops to 18px below 768.
- **Headline** (500–700, 18–20px): the regime badge and the one-sentence market read
  (Space Grotesk); 18px mono for signal-card values.
- **Title** (500, 13px): card titles, table text (Plex Sans).
- **Caption** (400, 13px, lh 1.55): desk-note captions and state notes (Plex Sans,
  never mono — ruled 2026-08-26).
- **Body** (400, 14px, lh 1.6): prose, memo body. Max measure 74ch.
- **Label** (600, 11px, +0.5px tracking, UPPERCASE): mono section labels. 11px meta
  carries +1px; 10px eyebrows and column headers carry +1.5px.

**The Mono Number Rule.** If it is a figure, label, ticker, timestamp, or column header,
it is IBM Plex Mono with `font-variant-numeric: tabular-nums` — without exception. If it
is a headline it is Space Grotesk; otherwise it is IBM Plex Sans. The inverse holds just
as hard (ruled 2026-08-26): if it is a sentence — caption, explainer, state note — it is
never mono. Mono is data, not a costume.

**The Tracking Rule.** Tracking widens as mono type shrinks, but never past 1px:
0.5px at the 11px label, .6px at 12px meta, 1px at 11px eyebrows/column headers — and
inverts to −0.02em on large mono figures. Sans prose carries no added tracking.

## Layout

**Content frame (2026-09-05).** The desk is a centered frame of at most 1520px
(`--maxw-frame`, `.mrr-frame`) with 28px gutters (16px at 480–767, 12px below 480).
Header rows, the freshness line and every screen share the frame, so a 2160px monitor
gets quiet margins instead of 2,000px lines. Prose inside the frame stays at the 74ch
measure (`.mrr-prose`, DeskRead's why-paragraph, methodology copy); charts and dense
tables may fill the frame. The emailed memo remains the only other fixed-width surface
(600px). Inside the frame, screens are equal-fraction card grids —
`repeat(3,1fr)`, `repeat(4,1fr)`, `repeat(5,1fr)` — with 12px gaps. Card padding is
12px (16px for large panels); section header → content gap is 10px; section-to-section
gap is 16px; table cells are 8px × 12px. The spacing scale steps in 2px increments
below 12px (2, 3, 4, 6, 8, 10, 12) then 16, 20, 24, 32, 40.

**Header composition (2026-09-05).** Three rows, one job each:
1. Identity + regime + actions: wordmark and live dot on the left; the regime badge
   (dominant stored probability), the alerts chip, the AI Analyst chip and the ⌘K chip
   on the right. At desk width the ticker strip sits under the wordmark and the
   four-regime probability bar under the chips.
2. Primary navigation: text links on a hairline rule, 2px accent underline and
   `aria-current="page"` on the active route; Methodology is a route like the others,
   right-aligned in mono uppercase and marked reference.
3. Freshness status line (inside `<main>`): one sentence that reconciles the monthly
   macro read with the daily market overlay ("The macro regime read (Jul 2026) is one
   monthly cycle late; the tape is ticking live."), and colour-coded state words with a
   date for Macro, Signals, Market and Intraday.
Below 1024 the header stacks (tape and bar on their own row, nav gap 16px, 13px labels);
below 768 the navigation becomes a "Screen · Menu" disclosure listing all seven tabs,
Methodology and "Jump to a section"; below 480 the tape is dropped (it lives in Markets),
the badge takes its own row and chips shorten to "✓ Alerts" / "◆ AI". The analyst
launcher is a header chip at every width, never a floating button over data.

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
- Tag: 10px mono uppercase chip, 3px radius, 12% tinted fill + 25% border; tones map to
  meaning (pos=clear, warn=watch, neg=triggered, research=Perplexity), never decoration.
  A chip never wraps: `white-space: nowrap`, and it yields width instead of breaking.
- StatusDot: the 6px CSS-circle live tell; pulses only when live/triggered; one pulsing
  element per screen region.

### Data (`data/`): StatTile, GaugeBar, Sparkline, ProbabilityBar, DataTable
- StatTile: label/value/delta triple; values arrive preformatted; ▲ green ▼ red → grey.
- GaugeBar: 4px threshold-proximity bar on the fixed meaning ramp; never scaled up.
- Sparkline: inline SVG, 1.5px stroke, 10% area fill, no axes, no tooltips.
- ProbabilityBar: the four softmax probabilities stacked in fixed GL→OV→ST→RR order;
  zero entries drop to faint rather than disappearing.
- DataTable: 10px uppercase column headers (+1.5px tracking), 13px cells, every numeric
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
- NewsCard: significance colors itself; `sigScale?: 10 | 5` selects the bands (ratified
  2026-08-26, raised in the night-2 report). Default 10 keeps the legacy ≥7 red / ≥5
  orange / ≥4 amber; `sigScale={5}` aligns them to the pipeline's own 1–5 significance
  ladder (≥4.5 red / ≥3.5 orange / ≥2.5 amber) and appends the "/ 5" denominator so the
  number is never read against the wrong scale. Attribution glyphs ◆ CLAUDE and
  ◆ PERPLEXITY are kept — they say which model produced which text.

### Screen furniture (`web/src/screens/shared/`, 2026-09-05)
- **DeskRead**: the executive decision strip that opens every major route. Mono eyebrow
  ("Desk read · Dashboard") with the live/pulse gate, an optional right-aligned chip
  (conviction, credit state, feed state), the 20px conclusion, the why-paragraph at 74ch,
  a ledger (`<dl>` of label/value rows: What changed · Watch · Invalidates · model
  numbers), freshness chips, and an optional note. Two columns from 1024px (conclusion
  left, ledger right on a hairline), stacked below. Carries the 3px accent rail once per
  screen; it is the only model-composed surface above the fold.
- **FreshnessChip / freshness.ts**: the closed vocabulary Current · Delayed · Stale ·
  Unavailable · Reference, assessed against cadence (monthly 45/75 days, weekly 10/21,
  daily 4/10, intraday 20 min/1 session, hourly 6 h/2 days). Word first, glyph second
  (● ▪ ▾ × ◆), date always, age in words when not current. `impactSentence()` composes
  the header reconciliation line.
- **Disclosure**: aria-expanded button over a hidden region for methodology, formulas,
  long caveats, provenance, secondary evidence and filters; closed by default, 40px row.
- **SubTabs**: local views with tablist/tab/tabpanel semantics, roving tabindex,
  ←/→/Home/End, hints in mono ("live model", "reference"); wraps on phones so every view
  stays visible. Used by Regime Lab (Overview · Playbook · Scenarios · History &
  analogues · Empirical evidence) and Tools (LBO · Asset allocation).
- **ScrollTable**: the responsive table well. Wide grids scroll inside it, the first
  column pins (`stickyFirst`), a "Swipe for more →" / "← Swipe back" line appears only
  when it actually overflows, and the well takes a tab stop and a region role then.
  Phones also drop secondary tape columns (name, Δ$, 1W, sparkline) rather than shrinking type.
- **SliderRow + NumberField**: the house slider is a 28px hit area with an 18px thumb
  over a 4px track (no gradients: track and fill are two elements); `input` adds a typed
  field that commits on Enter/blur, clamps to range and flags out-of-range drafts with
  aria-invalid. Calculators (LBO, Recession sensitivity, Scenario shocks) ship a Reset.
- **MobileNav**: the phone disclosure list of every destination, 44px rows,
  aria-current on the active route.
- **Markdown (shell)**: the analyst's replies render as React elements (headings capped
  at h3, lists, inline and fenced code, links); literal Markdown never reaches the reader.
- **alert-copy.ts**: composes alert rows into desk language (what tripped, when, the
  trigger and margin, whether it is still active against the latest print, why it
  matters). Machine strings and snake_case never render.
- **useModal**: the modal contract for the alert drawer and command palette: initial
  focus, Tab/Shift+Tab containment, Escape, `inert` on `#shell-content`, focus
  restored to the trigger. Dialogs carry `aria-labelledby`/`aria-describedby`.

### Touch and hit areas
Interactive controls are at least 28px tall at desk width and 40px (chips, subtabs,
disclosures) to 44px (menu rows, CTA) below 768; `data-touch` switches the chip and
button classes. Slider thumbs are 18px with a 28px hit band.

### Chart layout
Hand-rolled SVG charts (LineChart) span the frame width inside their card; the viewBox
is 720 units at desk and 360 below 768 so axis labels stay near 1:1. Lightweight Charts
panels are 320px tall and never wider than the frame. An empty intraday window renders a
compact status block (why, what is stored, "Show daily candles") instead of a blank
canvas. Charts cap at the 1520px frame on ultrawide monitors.

### States
Loading, empty, stale, unavailable and error states are sentences in the UI face at
13px, never spinners or blanks: "Reading stored data…", "Nothing on file.", "Stale
coverage. No headlines in the last 7D; latest stored coverage is Aug 26, 2026 (11 days
old)", "Unavailable: the data service did not answer." Fallback content is labeled
stale on the desk read, on the section notice and on every card ("STORED · STALE").
An optional tool that cannot run (the allocation optimizer) demotes to a collapsed
status row stating the exact requirement; the primary output (the regime matrix) stays
first. Sub-1% probabilities print "<1%"; only an exact zero prints "0%".

**No absence before an answer (review fix, 2026-09-05).** Every API call aborts after
15 seconds and surfaces as "unavailable"; nothing asserts "No alerts", "none on file"
or "No datapoints" while a request is pending. The alerts chip reads "Alerts ·
reading…" then "Alerts · unavailable"; chart accordions print "Reading…" captions;
signal cards without a threshold say "its stored trigger" rather than leaking a
template. Tape rows with no stream quote print the newest stored close with its date
("Aug 25, 2026 close"), matching the header ticker, and the feed line says "stream
unavailable · showing stored closes" in one phrase.

**One number, one name.** Dashboard names the classifier's `confidence` "Model
confidence"; Regime Lab names the takeaway's `conviction` "Takeaway conviction" and
prints both in its ledger with the model-vs-market score, so the two screens can differ
without contradicting. The NBER recession model's probability is labeled as a separate
model from the Recession Risk regime odds wherever both appear. Server stamps without a
zone are UTC and render as ET wall time (`fmtUtcStampEt`); chart ranges and "last
alert" dates use `fmtDate`, axis ticks `fmtMonYr`; reference-line labels are 11px HTML
anchored left of the plot, not SVG text that scales with the viewBox.

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
- **Don't** write em-dash asides in UI copy (owner sweep, 2026-08-26): "X — the reason
  Y" reads as generated text. Use a colon, semicolon, parentheses, or a new sentence;
  "·" stays the separator for meta runs; "—" survives only as the null-value dash.
  Loading lines end in "…", never a trailing dash.

<!-- Detector waivers (deliberate, owner-confirmed via overnight brief; do not "fix"):
     heavy mono usage · dense card grids (12px rhythm) · dark-only theme ·
     12px-scale typography density · the 3px left rail on model-composed surfaces
     (DeskRead, ReadThrough, IntelBanner, chart panel, alert rows) — the detector
     flags it as "side-tab"; here it is the house mark for generated or elevated
     content and appears once per screen above the fold. These are the product's
     signature, not defects. -->

<!-- 2026-09-05 executive pass: every statement above describes the browser-verified
     build at 390 / 768 / 1440 / 2160. The former "no max-width container" layout, the
     floating analyst launcher, the 10px micro rung, the 1.5px eyebrow tracking and the
     eight-chip risk pager are gone; where an older line still names them, this note wins. -->

## Provenance, availability and the Options lens (2026-09-06)

### Provider and fallback labels

Every number that came from a market-data provider says which one, in the
caption or the meta line, in this order: **provider · delayed/live · as-of ·
fallback**. Vocabulary (one helper, `screens/shared/provider-ui.ts`):

- `EODHD · delayed · as of Sep 04, 16:27 ET` — the REST quote; `live · EODHD stream`
  only while a websocket tick is inside the two-minute window.
- `session closed · last close stands` — appended while the NYSE session is closed.
- `yfinance standing in (EODHD timed out)` — a fallback always names the reason
  (not configured · not in the plan · no listing · unsupported · rate limit ·
  timed out · unavailable · unreadable · no bars).
- Chart provenance: `6M · daily bars · EODHD · through Sep 04, 2026 · split- and
  dividend-adjusted · delayed history, not the live tape`. Daily and coarser
  bars print a date; intraday bars print an ET clock time.
- Fundamentals: `Fundamentals via yfinance (EODHD fundamentals are not in the plan
  on this server)`.
- Failures are sentences that name the kind: no listing · not a supported
  instrument · not included in the data plan · rate limiting · did not answer
  in time · unreachable (stored data stays) · no history in this range.

### Status word

One chip in the freshness line, from one function (`live/quotes.ts:streamWord`
plus the API answering), glyph + word, never colour alone:
`● Live` · `▪ Delayed` · `↻ Reconnecting` · `× Backend unavailable` ·
`◆ Validated snapshot · <date>`. "Live" names its feeds when the US tape is
quiet (`Live · crypto/FX only · US session closed`).

### Loading, degraded and unavailable states

- Requesting: `Requesting 6M history for AMZN from EODHD…` (role=status); a range
  switch keeps the previous bars with a small `Requesting 1D bars…` tag; a symbol
  switch never keeps the previous symbol's bars.
- Calculators: `Calculating the deal model…` before the first answer; never
  "Nothing on file" for a pending computation. Unavailable engine, rejected
  inputs and an unreachable service are three different sentences.
- Backend asleep: every seeded screen renders from the snapshot; the shell says
  so; nothing spins forever; queries refetch on their own.

### Responsive Regime Lab navigation

`SubTabs` wraps below the wide tier (<1024) so every view stays visible at 768
and 390 (hints dropped, 36–40px rows); at wide widths an overflowing row shows
a fade with `◂` / `More ▸` controls and the selected tab is scrolled into view.

### Options lens

A collapsed `Disclosure` under the key stats of Single-name research (US stocks
and ETFs only): expiration `<select>`, Calls/Puts as `aria-pressed` chips, a
sticky-header table (Strike · Bid · Ask · Last · Vol · OI · IV · Δ Γ Θ V ·
Moneyness · DTE) inside its own scroll well (`Swipe sideways for more columns`
on narrow), Prev/Next paging, and a caption stating end-of-day marks, the
provider's own Greeks, and that nothing is a recommendation. A plan without
options shows one explicit sentence instead of an empty shell.

### Review reconciliation (2026-09-06, independent visual review)

- **Status word suffixes.** `● Live` names its feeds when the US tape is quiet
  (`· crypto/FX only · US session closed`) and, when the relay reports
  degradation, says why in reader words (`· US equity feed rejected by the
  provider`, `· US equity feed silent`); the tape's feed line uses the same
  vocabulary (`feed rejected by the provider`, `reconnecting`, `unavailable`).
  Raw relay states never render.
- **Touch targets.** Chips and buttons carrying `data-touch="true"` are 44 px
  below 768 (was 40); sub-tabs 44 px on narrow. Inline jargon terms keep the
  inline-text exception.
- **Document titles.** Every route sets `<Tab> · Macro Regime Radar`.
- **Chart captions** end with a full stop, print dates for daily-or-coarser
  bars and ET clock time for intraday bars, and omit the adjustment clause
  for crypto, FX and indices.
- **Snapshot mode** carries its one-sentence explanation at every width.
- **News** names its lead section "Priority headlines" (palette entry
  identical) and "Latest stored headlines" on the fallback; the desk-read
  conclusion is composed in the product's voice, not the headline verbatim;
  "high impact" means ≥3.5 everywhere on the screen.
- **Freshness chips** print the state word once (`◆ Reference Calendar`).
- **One rail above the fold**: the Credit callout keeps its watch tone without
  a second accent rail.
- Documented and left as is: stored tape rows open the DAILY/INTRADAY panel
  while on-demand rows open range chips (two data shapes, two honest
  affordances).

