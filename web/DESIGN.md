---
name: Macro Regime Radar
description: A quantitative macro terminal that answers first. Dark, dense, one serif headline per tab over mono evidence.
colors:
  bg: "#030a10"
  panel: "#0a121a"
  tile: "#0e1822"
  card-top: "#0f1a24"
  card-bottom: "#0a131b"
  sidebar-top: "#131e25"
  sidebar-bottom: "#0d161c"
  strip-top: "#111c26"
  strip-bottom: "#0d1720"
  field: "#141f29"
  popover: "#111c26"
  toast: "#16222d"
  line: "rgba(150,175,200,.12)"
  line-2: "rgba(150,175,200,.07)"
  line-strong: "rgba(255,255,255,.22)"
  track: "#222c39"
  text: "#f2f5f8"
  text-2: "#b3c0cd"
  text-3: "#8f9daa"
  text-4: "#5f6c78"
  eyebrow: "#b9c6d3"
  wordmark: "#dfe6ec"
  axis-label: "#6f7d8a"
  pos: "#28d17c"
  neg: "#f0503f"
  amber: "#f5b52e"
  warn-hot: "#e67e22"
  mint: "#26dca0"
  link: "#58b8e6"
  link-hover: "#79c6eb"
  link-active: "#4b9cc3"
  cyan: "#3cc8f0"
  neutral: "#95a5a6"
  regime-goldilocks: "#26dca0"
  regime-overheating: "#e67e22"
  regime-stagflation: "#e74c3c"
  regime-stagflation-text: "#f08785"
  regime-recession: "#95a5a6"
  research-violet: "#7c3aed"
  page-glow: "rgba(40,70,90,.18)"
  hero-glow: "rgba(38,220,160,.07)"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "58px"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.012em"
    fontVariationSettings: "'opsz' 30"
  hero-sub:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  lede:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  kv:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  eyebrow:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.24em"
    textTransform: uppercase
  eyebrow-sm:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.2em"
    textTransform: uppercase
  badge:
    fontFamily: "IBM Plex Mono, SF Mono, Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.1em"
    textTransform: uppercase
  pill:
    fontFamily: "IBM Plex Mono, SF Mono, Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.13em"
    textTransform: uppercase
  meta:
    fontFamily: "IBM Plex Mono, SF Mono, Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
  wordmark:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0.2em"
rounded:
  card: "12px"
  tile: "9px"
  ctl: "8px"
  badge: "7px"
  pill: "999px"
  strip: "10px"
  nav: "9px"
spacing:
  gap-col: "16px"
  gap-panel: "14px"
  gap-tile: "12px"
  pad-panel: "16px 18px 18px"
  pad-tile: "14px"
  sidebar: "196px"
  main-pad: "10px 18px 36px 22px"
  summary: "432px"
  strip-h: "54px"
  topbar-h: "40px"
  search-w: "368px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "{spacing.pad-panel}"
    border: "1px solid {colors.line}"
  tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.text}"
    rounded: "{rounded.tile}"
    padding: "{spacing.pad-tile}"
    border: "1px solid rgba(150,175,200,.10)"
  card-gradient:
    background: "linear-gradient(180deg, {colors.card-top} 0%, {colors.card-bottom} 100%)"
    rounded: "{rounded.card}"
    border: "1px solid {colors.line}"
  badge:
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    height: "24px"
    padding: "0 11px"
    border: "1px solid tint at 32-38%"
    backgroundColor: "tint at 7%"
  pill:
    typography: "{typography.pill}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 18px"
    textColor: "{colors.mint}"
    backgroundColor: "rgba(38,220,160,.11)"
    border: "1px solid rgba(38,220,160,.5)"
    shadow: "0 0 22px rgba(38,220,160,.16), inset 0 0 12px rgba(38,220,160,.08)"
  sidebar-item:
    height: "47px"
    rounded: "{rounded.nav}"
    textColor: "{colors.text-2}"
    fontSize: "14px"
    padding: "0 0 0 24px"
    gap: "18px"
  quote-card:
    height: "{spacing.strip-h}"
    rounded: "{rounded.strip}"
    background: "linear-gradient(180deg, {colors.strip-top}, {colors.strip-bottom})"
    border: "1px solid {colors.line}"
    padding: "0 22px 0 26px"
  freshness-card:
    height: "{spacing.strip-h}"
    rounded: "{rounded.strip}"
    background: "linear-gradient(180deg, {colors.strip-top}, {colors.strip-bottom})"
    border: "1px solid {colors.line}"
    padding: "0 28px 0 24px"
  watchlist-row:
    height: "35px"
    fontSize: "12px"
    padding: "0 10px 0 14px"
    textColor: "{colors.text}"
---

<!-- Recorded 2026-09-15 (Phase 1, branch redesign/01-foundation) from
     docs/redesign-v2/UI_SPEC.md sections 0 to 3, CC_PROMPT.md decisions 1 to 9,
     the regime-lab.html and watchlist.html mockups, and the shipped token files
     in web/src/styles/tokens/. Max approved the redesign; this file is the
     owner's token change (spec section 0). Where this file and the spec
     disagree, the spec wins and the disagreement is a bug here. Rows marked
     "Phase 2" (or a later phase) describe the target, not the shipped build. -->

# Design System: Macro Regime Radar

## 1. Overview

**Creative North Star: "The answer first: one serif headline per tab over mono
evidence."**

Every tab opens with its conclusion set in a 58px serif headline (the tab's answer,
never its name), a probability pill beside it, and the evidence underneath in the UI
face and mono. Dark, dense, information-first: the product states, it does not sell.
Every screen is built from real model output and market data; if a screen feels
empty, the answer is more data, not decoration.

**Executive reading order (kept from the 2026-09-05 pass).** Every major screen reads
in one fixed order: (1) the conclusion, (2) why it matters, (3) what changed, (4)
supporting evidence, (5) what would invalidate the conclusion, (6) methodology and
provenance. A finance executive gets the central message inside ten seconds from the
hero at the top; the analyst keeps every table underneath, with methodology, formulas,
long caveats and provenance one click down behind disclosure rows. Conclusions are
stated once per screen; stacked banners repeating one read are a defect.

**Audiences (unchanged).** Finance recruiters arriving via LinkedIn (one visit, ten
seconds); non-finance visitors who must never be lost; the owner, who reads it daily
to learn macro. Executive-level hedge-fund and trading-firm readers are the bar.

**Anti-references (unchanged, plus one).** Generic SaaS dashboards, Inter-everything,
purple gradients, cards-in-cards, decorative motion, icon libraries. And: no
stock-photo hero until a licensed image exists (decision 8: a placeholder gradient
takes the Dashboard photo's slot).

**Key characteristics**
- Near-black page (#030a10) under a faint page glow; panels (#0a121a) and tiles
  (#0e1822) step up from it; hero and summary cards carry a subtle vertical gradient.
- Link blue (#58b8e6) for links and focus; mint (#26dca0) for CLEAR, live and
  current state; green and red stay strictly directional.
- Three typefaces with mechanical jobs: one serif headline per tab, IBM Plex Sans for
  everything readable (big numbers included), IBM Plex Mono for badges, meta lines,
  timestamps and axes.
- 1px borders, 12/9/8/7px radii, a 999px pill; 196px sidebar with hand-drawn inline
  SVG icons.
- The system is awake, not animated: a dot pulses where data is live, a value flashes
  for 600ms when it ticks, a caret blinks where the analyst awaits input. Nothing
  bounces, slides or fades on scroll.
- Desk-note voice: declarative, present tense, every claim carries its number.

## 2. Colors

Tokens live in `web/src/styles/tokens/colors.css`. The spec names are the only names
new code may use; the pre-redesign names resolve through the transitional alias block
(section 12) until their phase retires them.

### Roles (spec section 0 replacement rules)

| Job | Token | Value | Rule |
|---|---|---|---|
| Links, focus ring, secondary chart series | `--link` | #58b8e6 | Replaces the old one-accent blue. Never encodes good or bad. Hover `--link-hover` #79c6eb, active `--link-active` #4b9cc3, selection `--link-a32`. |
| CLEAR, live, current state, the probability pill | `--mint` | #26dca0 | Mint marks status and liveness: CLEAR badges, the live dot, the sidebar footer dot, the freshness card's "Markets live" line, the Ask the analyst chip, the selected sub-tab hint, Goldilocks. |
| Up moves, sparklines | `--pos` | #28d17c | Direction only. Green is "up", never "good". |
| Down moves, triggered | `--neg` | #f0503f | Direction and TRIGGERED. As text it reads 5.3:1 on `--panel`, so the old red-on-dark rung is retired (see section 11). |
| WATCH, high-impact events, delayed data | `--amber` | #f5b52e | Status. The WATCH badge, the amber pill, the amber summary status strip, EOD / 15M / CLOSE tags. |
| Elevated, overheating, stale | `--warn-hot` | #e67e22 | The Overheating hue and the stale freshness colour. |
| Medium-impact calendar dot | `--cyan` | #3cc8f0 | Calendar only (Phases 3 and 8). |
| Flat, no change | `--neutral` | #95a5a6 | Also the Recession Risk hue. |
| Perplexity attribution | `--research` | #7c3aed | Cited-research attribution and nothing else. |

### Surfaces and lines

`--bg` #030a10 (page; `index.html` paints it before hydration) · `--panel` #0a121a
(panels, drawers, the palette, the assistant) · `--tile` #0e1822 (inner cards) ·
`--card-grad` (hero and summary cards, #0f1a24 → #0a131b) · `--sidebar` (#131e25 →
#0d161c) · `--strip-grad` (quote and freshness cards, #111c26 → #0d1720) · `--field`
#141f29 (search fields) · `--popover` #111c26 · `--toast` #16222d · `--track` #222c39
(meter and slider tracks, chips, the scrollbar thumb).

Lines: `--line` rgba(150,175,200,.12) for card borders, `--line-2`
rgba(150,175,200,.07) for row dividers and chart gridlines, `--line-strong`
rgba(255,255,255,.22) for emphasised dividers, `--line-white-14` for kbd, popover and
toast borders, `--line-white-30` for the ghost button.

### Text ladder

| Token | Value | Job |
|---|---|---|
| `--text` | #f2f5f8 | Primary: headlines, values, table cells |
| `--text-2` | #b3c0cd | Body copy, key/value labels, nav items, descriptions |
| `--text-3` | #8f9daa | Secondary copy, captions, meta. **The floor for functional text**: as-of stamps, freshness cells, axis values, column headers, missing-data dashes and availability words sit no lower than this. |
| `--text-4` | #5f6c78 | Decorative meta only: the version line, idle dots, exact-zero legend entries, disclosure lines, popover footers |
| `--text-eyebrow` | #b9c6d3 | Section eyebrows |
| `--text-wordmark` | #dfe6ec | The wordmark spans and the mountain stroke |

Each step has a fixed job; do not improvise greys. Chart axis labels use #6f7d8a
(Plex Mono 10px) inside chart components only.

### Regime hues

Fixed by the classifier, one hue per regime everywhere: Goldilocks `--r-goldilocks`
#26dca0 (mint, decision 1) · Overheating `--r-overheating` #e67e22 · Stagflation
`--r-stagflation` #e74c3c · Recession Risk `--r-recession` #95a5a6. The fourth regime
is "Recession Risk" everywhere except the Recession tab's own name.

### Tints

**The 7% rule.** Badges render as a 7% tinted fill with a 1px tinted border (mint
`--mint-a07` / `--mint-a32`, amber `--amber-a07` / `--amber-a36`, alert
rgba(240,80,63,.08) / .38, info `--link-a07` / `--link-a32`, reference
rgba(255,255,255,.03) / `--line-white-14`). This replaces the old 12% fill / 25% border
rule; the `--badge-*` tokens still carry 12/25 for `RegimeBadge` and `ProbabilityBar`
until Phase 2 restyles them. The probability pill fills at 10 to 11% with a 50% border
(`--mint-a11` / `--mint-a50`, `--amber-a10` / `--amber-a50` equivalent) and a soft glow.

Status is never conveyed by colour alone: a word or a glyph always accompanies it.

## 3. Typography

**Display:** Source Serif 4 (self-hosted variable woff2, `opsz` 8 to 60, `wght` 200 to
900, decision 2). **UI:** IBM Plex Sans. **Mono:** IBM Plex Mono. All three self-hosted
from `/public/fonts/`; no CDN at runtime. Space Grotesk left the system on 2026-09-15.

**The display rule.** One 58px headline per tab, weight 700, line-height 1.02,
letter-spacing -0.012em, `font-variation-settings: "opsz" 30` set explicitly (automatic
optical sizing would pick 60). The headline is **the tab's answer**, never its name.
Also the scenario result on Recession. Nowhere else: not badges, not the wordmark, not
card titles. `.mrr-display` in `typography.css` is the utility; `TabHero` (Phase 2) is
the consumer. In Phase 1 no element renders in the serif; the face is verified by
`document.fonts.load('700 58px "Source Serif 4"')`, not by eye.

**The UI face carries everything readable**, including big numbers (500,
`font-variant-numeric: tabular-nums`): the hero subhead (23px 500), the lede (15.5px,
measure 540px), body (14px, line-height 1.6), key/value rows (13.5px), captions
(12.5 to 13px, line-height 1.5), nav items (14px, Methodology 13px), the wordmark
(12.5px 500, .2em tracking, line-height 1.55), and section eyebrows (12px 500 uppercase
.24em in `--text-eyebrow`; sub-eyebrows inside tiles 11px .2em in `--text-3`).

**Mono is for data strings**: badges (11.5px uppercase .1em, 24px tall), the
probability pill (14px uppercase .13em), meta strings ("5 SIGNALS · LATEST …", 11px
uppercase .1em), "Last alert:" and "Trips when…" lines on SignalCards (the spec
section 0 exception: short mono meta lines are allowed there), axis labels (10px),
timestamps, table column headers (10.5px uppercase .1em) and group rows (10.5px
.14em), the 9.5px EOD / 15M / CLOSE / 1W tags, the ⌘K kbd (10.5px). Prose, captions,
explainers and state notes are never mono.

**Tracking.** Wide on small uppercase mono and on eyebrows (.1em to .24em), tight on
the headline (-0.012em) and on large numbers (`--ls-numeric` -0.02em). Sans prose
carries no added tracking.

**Copy.** No em-dash asides ("X, the reason Y" reads as generated text): use a colon,
a comma, parentheses or a new sentence. "·" stays the separator for meta runs. Loading
lines end in "…", never a trailing dash. Model-composed text passes through
`tidyProse()` before display.

**Old ramp.** `--fs-micro` 11 · `--fs-meta` 12 · `--fs-label` 11 · `--fs-caption` 13 ·
`--fs-body-s` 13 · `--fs-body` 14 · `--fs-value` 18 · `--fs-lead` 20 · `--fs-value-lg`
20 · `--fs-metric` 26 stay defined for screens not yet restyled. `--fs-lead`,
`--fs-metric` and `--fs-value-lg` retire with `TabHero` (Phase 2); `--ls-badge` (.3px)
retires with the pill.

## 4. Layout

**Shell grid.** `.mrr-app` is `grid-template-columns: var(--sidebar-w) minmax(0,1fr)`
(196px sidebar, sticky, full height). `.mrr-main` pads `10px 18px 36px 22px`
(`--main-pad`). There is no centred max-width frame: the mockups fill 1672px and
screens stretch on wider monitors (`.mrr-frame` survives only on the Landing page
until Phase 10).

**Every tab has the same top** (spec section 4): the hero-row (`TabHero` on the left,
`SummaryCard` 432px on the right, gap 16px, from 1620; below it the summary stacks
under the hero), then the tab body, then a mono
disclosure line (11px, `--text-4`, max-width 1100px) at the end of the tab.

**Dashboard composition (Phase 3, 2026-09-15).** Inside `<div class="mrr-dash">` (a
one-column grid with the 14px panel gap; the hero row's own bottom margin is zeroed
there so hero to signals is one gap), top to bottom: (1) `.mrr-hero-row`: `TabHero
id="regime-hero"` beside `SummaryCard id="regime-summary"`; (2) `<section
id="signals">` Monitored signals; (3) `<section id="key-levels">` Key levels, the slim
seven-tile row (`.mrr-dash-levels`: 7 / 4 / 2 / 1 columns at 1200 / 768 / 480); (4)
`.mrr-dash-bottom` (`minmax(0,2.8fr) minmax(0,1fr) minmax(0,1.14fr)` at 1200 and up;
below 1200 the glance panel spans the row and the two cards share the next; one column
below 768): `<section id="markets-glance">` with its four-tile `.mrr-dash-glance` grid
(2 columns below 768, 1 below 480) and the `#whats-priced` panel, `<section
id="us10y">`, `<section id="macro-calendar">`; (5) `<section id="macro-charts">`,
collapsed; (6) `<section id="read-through">`; (7) the `DisclosureLine`. The route's
only h1 is the hero headline; the sidebar wordmark is a paragraph, and the Dashboard
status strip and the bell read one `alertSummary` (`shell-status.ts`).

**Regime Lab composition (Phase 4, 2026-09-15).** Inside `<div class="mrr-lab">` (the
same one-column panel stack, hero-row margin zeroed), top to bottom: (1)
`.mrr-hero-row`: `TabHero id="takeaway"` (h1 = the served cycle status word, pill "{n}
months in", the served takeaway narrative as the lede, the growth-vs-inflation
`QuadrantChart` with its 12-month trail) beside `SummaryCard id="regime-outlook"`
("Regime odds & outlook": ten rows, the quiet "How this takeaway is composed"
disclosure, and the status strip, an `a[href$="#transitions"]` worded from the
classifier's stored Overheating odds three months back); (2) `SubTabs` (Overview,
Playbook, Scenarios, History & analogues, Empirical evidence; hash-synced through
`SECTION_TO_TAB` / `TAB_ANCHOR`), whose panel renders one view: Overview = `<section
id="cycle">` (`.mrr-lab-tiles-2`: spell tile with the avg tick, late-cycle meters),
`<section id="transitions">` (`.mrr-lab-tiles-3`: 3- and 6-month odds tiles with
regime swatches and no "vs 3 mo ago" column, the "How past {Regime} spells ended"
tile), `<section id="regime-history-teaser">` (the four-lane `RegimeRibbon` teaser
linking to `#regime-history`); Playbook = `<section id="playbook">`
(`.mrr-lab-playbook`); Scenarios = `<section id="scenarios">`; History & analogues =
`<section id="analogues">` then `<section id="regime-history">` (the full ribbon);
Empirical evidence = `<section id="backtests">`; (3) the `DisclosureLine`. Tile grids
collapse to one column below 768; the two ribbons keep their intrinsic width inside
an `overflow-x: auto` well there.

**Markets composition (Phase 5, 2026-09-15).** Inside `<div class="mrr-mkt">` (the
same one-column panel stack, hero-row margin zeroed), top to bottom: (1)
`.mrr-hero-row`: `TabHero id="markets-hero"` (h1 = the risk word read off the four
stored sector ETFs' one-day moves, "Risk-on" / "Mixed" / "Risk-off", with the pill
"{up} of {n} sectors up"; the live session sentence as the subhead; the `WeekBars`
one-week return bars for the 14 stored ETFs as the signature chart; the Tape / Stored
candles / Priced freshness chips and the basis note) beside `SummaryCard
id="markets-summary"` ("Cross-asset summary": US 10Y · Sectors · 1d · Dollar · VIX ·
Priced · Top surprise, and the stream status strip worded from `streamWord` plus the
tape's feed words, opening the freshness drawer); (2) the `ChartPanel` region
(`#markets-chart-panel`, full width, only while a tape row is selected; closing it
returns focus to the row's ticker button); (3) `.mrr-mkt-body` (`minmax(0,1fr)
var(--summary-w)` at 1200 and up, one column below): the left `.mrr-mkt-stack` with
`<section id="single-name-research">` (search and the `Chart range` picker in the
panel header), `<section id="sector-heatmap">`, `<section id="top-surprises">`
(`DataTable`: rank, release with its interpretation, `DivergingBar`, σ), and the right
`<section id="watchlist">` Macro tape (`MacroTape`: `DataTable` groups, nine columns,
the Macro / Single names toggle whose toggled view renders `#single-names`); (4)
`<section id="whats-priced-full">` full width (three tiles, a plain `table.mrr-priced`
with `th[scope="row"]` metric names, Level and MoM only); (5) the `DisclosureLine`.
Nothing on the page is re-derived in the browser: the risk word counts served
`ret_1d` signs, and every figure is a served field or its formatted value.

**Markets, Iteration 1 (M1 to M3, 2026-09-19).** The symbol search rides in the
hero's action row (`TabHero actionsAfter`, the hero set to `overflow: visible` so the
result list can hang below it), on screen without scrolling at 1280 px and up; a pick
fills `#single-name-research`, which scrolls into view and takes focus, and the panel
header keeps only the `Chart range` picker. `<section id="single-name-movers">` sits
under the heatmap: the three biggest gainers and losers among the twelve stored single
names in fixed slots (a missing mover is a marked slot), each tile opening
`?name={symbol}#single-name-research`; the day change is the stream's own `dc` with the
quote's as-of, else the last completed session's close against the one before from the
5D candles (the watchlist's `readCandles`), stamped `Close · {Mon DD}`, and names with
neither are listed plainly. The Macro / Single names toggle is gone: `#single-names`
renders under the macro table inside `#watchlist`. Under the tape one line says live,
delayed or last close with the newest US quote's stamp (`tapeStatusLine`); the two
provenance paragraphs sit behind "Details". The summary adds "Single names · 1d" and
"ETFs · 1w" (served extremes) when there is something to read.

**Credit composition (Phase 6, 2026-09-15).** Inside `<div class="mrr-credit">` (the
same one-column panel stack, hero-row margin zeroed), top to bottom: (1)
`.mrr-hero-row`: `TabHero id="credit-hero"` (h1 = the served `credit_label`, "Normal" /
"Tight" / "Stressed" / "Crisis", with the pill "HY OAS {n} bps"; the subhead "High
yield at {n} bps, the {Nth} percentile since 1996, with investment grade at {n} bps.";
the lede's tercile sentence plus the CCC / BB / B month sentence (and, for Tight, the
state explained with its Jargon affordance); the HY / IG OAS history on Lightweight
Charts as the signature chart, `SpreadLinesChart`, with the three dashed
classification rules as price lines, the NBER bands as a full-height histogram on a
hidden scale, the mono `OAS history window` 10Y / MAX Segmented in the legend row,
the NBER caption and the mono range line; the `ICE BofA via FRED` freshness chip)
beside `SummaryCard id="credit-summary"` ("Credit summary": HY OAS · IG OAS · CCC
distress · HY / IG ratio · Stays {label} · 3m · LBO all-in, and the quality-ladder
strip worded from `ladderStrip`, amber when CCC widened more than BB and B, under the
tension rule, or past the 400 bps rule, linking to `#quality-ladder`); (2) `<section
id="oas">` Spread monitor, full width (`.mrr-credit-monitor`: five `SignalCard`s, HY
and IG with the "Percentile since 1996" meter, BB / Single-B / CCC without); (3)
`.mrr-credit-ladder-row` (`minmax(0,1.25fr) minmax(0,1fr)` at 1200 and up, one column
below): `<section id="quality-ladder">` (`.mrr-credit-ladder-body`: the BB / B / CCC
six-month chart beside the HY / IG ratio and distress ratio tiles, one column below
768; the tension callout only while the distress ratio is 80% or more under a Normal
or Tight label) | `<section id="credit-state-odds">` (`HeatMatrix preset="transition"`
behind the `Transition horizon` 3 months / 6 months Segmented, three stat tiles, the
caption); (4) `<section id="financing">` (`.mrr-credit-fin`, one column below 1024:
the LBO all-in tile with the Fed funds + HY OAS stacked bar from `/api/lbo/defaults`,
and the classification ladder with today's rule highlighted); (5) the
`DisclosureLine`. Nothing on the page is re-derived in the browser: every figure is a
served field or its formatted value; the only client math is the ten-year window cut
(measured from the last served point, never the wall clock), the plotted window's
extremes and the band list.

**Credit, Iteration 1 (C1 to C4, E1, 2026-09-19).** `.mrr-credit-ladder-row` is one
column at every width: paired, the quality ladder ran 300 to 440 px taller than the
credit state odds. The ladder body sets the chart beside a 340 px tile stack (one
column below 768), and the BB / B / CCC plot fills the stack's height through
`HeroChartFrame`; the tension callout keeps its first two sentences, the rest behind
"Details". The state odds put the matrix beside the stat tiles and caption (one column
below 1024); a from-state with no served months (`transition_obs_3m` / `_6m`, else the
Tight count) reads "No history" in every cell, never a measured 0%, the month counts
print under the matrix, and the caption keeps two sentences with the rest behind
"Details". Every spread-monitor card carries the meter slot: HY and IG the served
percentile, CCC the distress-line share (capped bar), BB and Single-B the marked "No
percentile served" slot; five across, the sparkline sits under the number. The financing
grid stacks below 1200. The LBO all-in rate is Fed funds (a monthly average) plus the
daily HY OAS: the panel never says "today's" or "live", each component prints its own
as-of word from the `/api/lbo/defaults` freshness block (`freshLabel`), and the stated
default is read from `is_fallback` / `status`.

**Recession composition (Phase 7, 2026-09-15).** Inside `<div class="mrr-rec">` (the
same one-column panel stack, hero-row margin zeroed), top to bottom: (1)
`.mrr-hero-row`: `TabHero id="recession-hero"` (eyebrow "Recession model"; h1 = the
served `recession_prob` to one decimal, with the served `recession_label` as the pill,
"Low Risk" mint, "Elevated" and "High Risk" amber; the subhead "Twelve-month odds, up /
down {n} points in three months." from the stored monthly series; the lede's base-rate
and band sentence with the Jargon affordance on "logistic model", the served divergence
clause and the sentence that this probability is the recession model's own; the
"Stress the inputs" and "Read the model card" hash links; the footnote "Logistic model
on {n} FRED inputs, lagged 3 months • Scored for {Mon YYYY}"; the `Model inputs`
freshness chip; the note naming the band and its range; the signature visual is the
semicircle gauge, `ProbabilityGauge`, band arcs on the server's 20 / 40 edges with the
words LOW / ELEVATED / HIGH RISK, over the monthly probability line on `LineChart`,
`ProbabilityHistory`, behind the mono `History window` 24M / Full history Segmented,
NBER bands shaded and the 20% / 40% rules dashed) beside `SummaryCard
id="recession-summary"` ("Model summary": 12-month probability · 3 months ago ·
Strongest input · Curve 2s10s · Model vs market · Regime context · Reference
thresholds, and the strip worded from `stripSummary`, amber at three consecutive
month-over-month rises at 0.1 resolution, linking to `#model`); (2) `<section
id="model">` Model inputs, full width (`.mrr-rec-inputs`: five `SignalCard`s, one per
served feature, no meter, no sparkline, no threshold lines); (3) `<section id="curve">`
Curve monitor (`.mrr-rec-curve`: the 2s10s `LineChart` behind the `Curve window` 5Y /
10Y / 30Y Segmented beside the 340px "Current curve shape" tile, one column below
1200); (4) `.mrr-rec-bottom` (`minmax(0,1.25fr) minmax(0,1fr)` at 1200 and up,
stretched to one height since Iteration 1, one column below): `<section
id="sensitivity">` Sensitivity, its five sliders on screen on load (Iteration 1 X3,
decision D2; `.mrr-rec-sens`: five `SliderRow`s with baseline ticks over the result
tile, which states the model's own reading beside the scenario, the second
display-face number on the app) | `<section id="transparency">` Model transparency
(`DivergingBar` coefficients, the macro-vs-markets tile, the model card); (5) the
`DisclosureLine`. Nothing on the page is re-derived in the browser: every probability,
band word, coefficient and divergence figure is a served field or its formatted value;
the only client math is the three-month delta in points, the count of consecutive
rises and the 24-month / 5-year / 10-year slices of served series.

**Recession, Iteration 1 (X1 to X3, E2, 2026-09-19).** The gauge draws in a
`HeroChartFrame` at 88% of the hero's chart slot, capped at 740 px wide (432 px tall),
so it fills the column at every width. The 20% / 40% and "Inversion below 0" rule words
sit in a key row outside the plot, never over the svg (G1). The five input cards carry
the same slots (the X10 curve caption sits under the row; names wrap above the badge).
The curve plot fills its tile's height beside the curve-shape tile, which adds the
served 2s10s spread, its 30-year percentile and the inversion state. The summary adds
Training sample and Inputs through. Sensitivity renders open: the result tile always
shows "Model's own reading · headline" (the served probability, which the sliders never
move) above the scenario ("Scenario at current readings · inputs unchanged", or "Your
adjusted probability"), and Reset returns every input to the model's current reading.
The fifth input is named "10Y − 5Y breakeven spread" (T10YIE − T5YIE), standing in for
the Conference Board leading index (USSLIND), which stopped publishing in February 2020.

**News & Calendar composition (Phase 8, 2026-09-15).** Inside `<div class="mrr-news">`
(the same one-column panel stack, hero-row margin zeroed), top to bottom: (1)
`.mrr-hero-row`: `TabHero id="news-hero"` (eyebrow "Next on the calendar", the live dot
only while the feed is current and not on fallback; h1 = the countdown to the first
high-impact event of the served 30-day window, "{event_name} today / tomorrow / in {n}
days" by ET calendar day, the served name never abbreviated, with the event's impact
word as the pill, "High impact" amber and the rest gray; the subhead naming the first
two served events with their ET weekday and wall time; the lede is the lead story's
two sentences, "{Category} leads the file: {headline} at {x} / 5, the window's highest
score." then its stored interpretation or the sentence that none was stored; the
"Open the calendar" and "Filter headlines" same-route hash links; the footnote "{n}
headlines in {window} • {n} events in the next 30 days • Feed checked {HH:MM} ET"; the
`Newest headline` and `Calendar` freshness chips, hidden on a phone; the note stating
the 60s recheck and the hourly ingest; the signature visual is the inline-SVG 18-day
event timeline, `EventTimeline`, weekends shaded, one tick per ET day, the mint NOW rail,
one stem and dot per served event with height and colour by the served `importance`,
amber high, cyan medium, gray low; the loading, unavailable, stored-schedule and
no-events states swap the h1 for a UI-face sentence) beside `SummaryCard
id="news-summary"` ("Desk summary": Next event · After that · Coverage · Top
significance · High impact, no consensus row because nothing serves consensus, and the
feed-health strip worded from `feedHealth`, mint "Feed current", amber "Feed delayed" /
"Feed stale" / "Fallback coverage", gray "Feed unavailable" / "Reading feed health…",
opening the freshness drawer; the served `/api/freshness` news SLA verdict wins over the
client clock so the strip, the chip and the drawer speak one word); (2) `.mrr-news-body`
(`minmax(0,1fr) var(--summary-w)` at 1200 and up, `align-items: stretch`, one column
below): the left `.mrr-news-stack` with `<section id="headlines">` Priority headlines
("Latest stored headlines" with an amber callout on the fallback; four `NewsCard
variant="lead"` tiles in the 2x2 `.mrr-news-lead` grid, one column below 768, each with
the category badge, the ticker or deal-size chip, "Sig {x} / 5" with five mint dots, the
linked h4 headline, "◆ Why it matters · AI" or "Wire summary", the collapsed "Score
breakdown", the "Regime read · {n} sources" disclosure and "Read at {source} →"; the
"How scoring works →" link to `/app/methodology#ramps`) and `<section id="feed">` More
headlines (the `.mrr-news-filters` fieldset bar: three mono `Segmented` groups, Window
24H / 48H / 7D, Category ALL / MACRO / M&A / EARN / GEO / SECTOR, Significance ANY SIG /
≥ 2.5 notable / ≥ 3.5 high, under sr-only legends; the significance caption; five
`StatTile size="sm"` count tiles in `.mrr-news-tiles`; the list rows as `NewsCard
variant="row"` on the `.mrr-news-row` five-column grid, clock, badge, headline, detail
toggle, score, stacking into three lines below 768, each new arrival flashing once
through `.mrr-news-new`; "Show {n} more headlines" and the top-50 cap caption), and the
right `<section id="calendar">` (`CalendarPanel`: the Upcoming / Recent `Segmented`,
the `.mrr-cal-legend` impact legend, the day-grouped `DataTable` with the TODAY / +{n}d /
elapsed day markers, the stored-schedule callout, the "Recent releases" block and the
caption); (3) the `DisclosureLine`. Nothing on the page is re-derived in the browser:
every figure is a served field or a count of served rows, and the only client
arithmetic is the ET calendar-day delta the countdown, the day markers and the timeline
columns share.

**News, Iteration 1 (N1 to N4, E4, 2026-09-19).** The timeline sets each label beside
its dot, then on the other side, then up to three 16 px lanes up or down, taking the
first spot that meets no other label, dot, the NOW mark or the plot edge; a label with
no free spot is left off (its dot and the calendar still carry the event). Large-cap
earnings (`/api/calendar?include=earnings`, `kind === "earnings"`, read only by the
timeline beside the macro rows of `useCalendar(30)`) draw as violet diamonds on a
dashed stem below the low band, one per day, labelled with their symbols; the ◆
EARNINGS legend and the earnings count in the chart's name appear only when the window
holds any. The desk summary adds Next high impact, Last release, By category, Outlets
and AI reads, each only with something to count. `.mrr-news-body` aligns to the start,
so the calendar card sizes to its content, and the whole 30-day window renders (the
12-row cap and its "Show all" button are gone). Every lead card keeps one read slot: the AI
read ("◆ Why it matters · AI · Regime read · {n} sources") or the wire summary behind one
click, else "Headline only"; an opened AI read shows at most four sentences,
interpretation first, then research, with the cited sources, and the rest (and the
wire summary) behind a nested "Details". List rows stack by the width of their own list
(a container query below 760 px). The hero lede keeps at most two sentences of a
stored interpretation.

**Tools composition (Phase 9, 2026-09-15).** Inside `<div class="mrr-tools">` (the
same one-column panel stack, hero-row margin zeroed), top to bottom: (1) the
`.mrr-hero-row` of the active tool, swapped with the sub-tab and sitting above the
tablist as on every other tab. On LBO calculator, `TabHero id="lbo-hero"` (eyebrow "LBO
calculator", the ◆ glyph; h1 = the default deal's served IRR, "{x}% IRR", read from the
base run of `BASE_INPUTS` at the live rate and never from the modified deal; the pill
"{x}× MOIC" toned by the IRR bands, mint at 20 and above, amber 15 to 20, gray below;
the subhead "The default deal at today's {rate}% all-in rate." or the stated 8.50%
fallback sentence, never moving with the slider; the lede naming the default deal from
`BASE_INPUTS` and then the calculator sentence; "Adjust assumptions", a hash link to
`#lbo-assumptions`, and "View financing conditions" into `/app/credit#financing`; the
footnote is the badge sentence "Clears the 20% PE bar" / "Below the 20% bar · above 15%"
/ "Below 15%" in the ramp colour, then the `Financing rate` freshness chip; the note
prints the modified deal's IRR, MOIC and pp against the default only while something is
modified; the signature visual is the inline-SVG equity value bridge, `EquityBridge`:
six bars on served fields, entry equity, EBITDA growth, multiple change, debt paydown,
fees, exit equity, rounded $M values above, two-line labels below, dashed connectors
between running totals and a 2px stub for a zero step; the loading, rate-unavailable
and model-unavailable states swap the h1 for a UI-face sentence) beside `SummaryCard
id="lbo-summary"` ("Live financing": Fed funds · HY OAS · All-in rate · Financing ·
Structure · Equity check on a viable deal · Vs base case on a modified deal · Credit
state, a link into `/app/credit#financing` printing the served credit label; the FRED
strip, mint "Rate synced from FRED", amber "FRED rate delayed" / "FRED rate stale", gray
"Reading the FRED rate…" / "Rate feed unavailable", a button opening the freshness
drawer). On Asset allocation, `TabHero id="allocation-hero"` (eyebrow "Asset
allocation"; h1 = the asset that led the current regime's months, its served
annualized mean as the pill "{±x}% a year", mint when non-negative; the subhead "Led
{regime} months since {Mon YYYY} at Sharpe {s}; {asset} lagged at {±y}%."; the lede is
the read-the-column sentence with the served odds and sample size; "See the
optimization", a hash link to `#allocation-optimization`, and "Regime Lab backtests"
into `/app/regime-lab#backtests`; the `Returns` and `Regime labels` chips; the signature
visual is `RegimeReturnBars`, the current regime's served means as horizontal bars from
a zero rule, gains right in `--pos`, losses left in `--neg`; the loading state carries
the return-history sentence, the error state the unavailable sentence) beside
`SummaryCard id="allocation-summary"` ("Allocation summary": Sample · Risk-free ·
Optimizer, the solved count read from the served `converged` flags; the strip, mint
"Optimizer solved · {n} methods", amber "Optimizer solved with {k} fallback(s)" /
"Optimizer unavailable this session", gray while reading, a hash link to
`#allocation-optimization`). (2) `SubTabs` (LBO calculator · Asset allocation; the hash
`#lbo` / `#allocation`, and any `#lbo-*` / `#allocation-*` section id selects its tool
by prefix) whose panel is `<section id="lbo">` with the `LboPanel` body
(`.mrr-tools-lbo`, `400px | minmax(0,1fr)`, one column below 1200: `#lbo-assumptions`
with the financing-rate tile and its `.mrr-switch`, the nine sliders in three groups and the
warnings block, beside the results stack: `#lbo-outputs` on `.mrr-tools-outputs`, four
tiles across, auto-fit below 768, one column below 480; `.mrr-tools-pair`,
`#lbo-schedule` over `#lbo-sensitivity` since Iteration 1; the market-check caption)
or `<section id="allocation">` with the `AllocationPanel` sections
(`#allocation-overview`, `#allocation-optimization`, `#allocation-risk`). (3) the tool's
`DisclosureLine`. Nothing on the page is re-derived in the browser: IRR, MOIC, the
schedule and the sensitivity grid are served by `POST /api/lbo/run` (one request at
rest, two once the deal is modified; the base run shares the deal run's key until then),
and the only client arithmetic is the bridge bars, the schedule's paydown and leverage
columns and the debt-at-exit ratio on served rows.

**Tools, Iteration 1 (T1 to T3, E1, 2026-09-19).** `.mrr-tools-pair` is one column at
every width (`#lbo-schedule` over `#lbo-sensitivity`): side by side, the results column
ended 300 to 400 px above the assumptions panel and the two cards differed by up to
29 px; stacked, the schedule reads without its scroll well. The all-in rate is Fed funds
(a monthly average) plus the daily HY OAS and is never called "today's", "live" or
"current": the rate tile's eyebrow reads "Financing rate", the switch "Track the
all-in financing rate", the summary card "Deal financing", and the hero footnote, the
summary rows, the tile caption, the strip and the disclosure line print each
component's as-of word from the freshness block (`componentAsOf`, `freshLabel`). The
engine's stated default is read from `is_fallback` / `status` (`isStatedDefault`) and
marked "Stated default". The hero row is `aria-busy` while the default deal runs. The
Allocation summary adds the regime's leader and laggard, the asset count and the last
month of returns.

**Gaps.** 16px between top-level columns (`--gap-col`), 14px between stacked panels
(`--gap-panel`), 12px between tiles inside a panel (`--gap-tile`). Panel padding
`16px 18px 18px`; tile padding 14 to 16px. The old 2px-increment spacing scale
(`--sp-*`) remains for screens not yet restyled.

**Responsive.** Two thresholds, expressed in CSS media queries with `.98` upper
bounds: below 1200px (`max-width: 1199.98px`) the hero stacks its chart under its copy
and the strip becomes two columns (the summary card stacks under the hero from 1620
down, Iteration 1); below 860px (`max-width: 859.98px`) the sidebar hides, the top
bar becomes `1fr auto`, and `MobileNav` takes over. Anything that changes the DOM (the
sidebar ↔ `MobileNav` swap) reads `useBreakpoint().shellCompact` (< 860); the four
existing tiers (mobile < 480, tablet < 768, desktop < 1024, wide) are untouched and
remain the only width-conditional mechanism for screen bodies. The strip renders on six
of the eight routes (not Recession or Methodology, section 7): four columns from 1620,
two from 768, one card per row below 768.

Density is deliberate and waived against generic-density heuristics: this is a
terminal.

## 5. Elevation and depth

Depth comes from surface value first (`--bg` → `--panel` → `--tile` → `--track`), then
from the few gradients and glows the spec allows:

- **Gradients allowed:** the vertical card gradient (`--card-grad`, hero and summary
  cards), the sidebar (`--sidebar`), the strip cards (`--strip-grad`), the active nav
  item (white 11% → 6%, 1px rgba(255,255,255,.08) border), the pressed segment and
  selected sub-tab (white 8% → 3% / 7% → 2.5%), the summary status strip (mint or
  amber, 12% → 5%). Nothing else is a gradient.
- **Glows allowed:** the hero glow (`--hero-glow`, a 520×320 radial at 88% 40% in the
  hero's own tint; note that `var(--glow)` inside the token resolves on `:root`, so a
  per-hero tint redeclares `--hero-glow` on the hero element) and the page glow
  (`--page-glow`, the body's first background layer).
- **Shadows allowed:** the probability pill glow (`--glow-pill`, amber variant
  `--glow-pill-amber`), the live-dot glow (`--glow-dot`), the assistant float
  (`--shadow-float`), the popover shadow (`--shadow-popover`). A new shadow anywhere
  else is a defect.
- No blur, no frosted glass, no backdrop filters.

## 6. Shapes

Radii: 12px panels and cards (`--r-card`), 9px tiles (`--r-tile`), 8px buttons and
inputs (`--r-ctl`), 7px badges (`--r-badge`), 999px the probability pill (`--r-pill`);
shell: 10px strip cards (`--r-strip`), 9px nav items, search field and Ask chip
(`--r-nav`); 5px meter track (`--track`), 3px meter fill.

Borders are 1px (`--bw`). The 0.5px hairline survives only in inline strings on
screens not yet restyled and is gone by Phase 10 (`--bw-hair`). The 3px left rail
(`--bw-accent`) stays on `DeskRead` until `TabHero` replaces it in Phase 2. Buttons: the
primary is white on #0b1117, 44px, radius 9; the ghost is a 1px `--line-white-30`
border.

## 7. Shell

**Sidebar** (`<aside id="mrr-sidebar" class="mrr-side" aria-label="Sidebar">`, 196px,
sticky, one viewport tall; the watchlist block takes the height the other blocks leave
and scrolls its rows inside it, so the pinned footer never sits on a row): the wordmark
(a hand-drawn 48×26 mountain glyph in `--text-wordmark`, then `MACRO` / `REGIME RADAR`
in the UI face at 12.5px 500 .2em, uppercase in the source text; links to `/`; a
`<p>` since Phase 3, the route's only `<h1>` being the `TabHero` headline), seven nav items (47px, 22px
stroke icons hand-drawn as inline SVG, gap 18, padding-left 24, radius 9;
`aria-current="page"` on the active route with the white-gradient fill), the
Methodology secondary item (36px, 13px, `--text-3`, book icon), a divider, the
Watchlist block (section 8), and the footer (live dot in `--mint` with `--glow-dot`
that pulses only when the stream or intraday data is live, the status words, a
two-line stamp, and `v{__MRR_VERSION__}` from `package.json`, never the mockup's
placeholder). Landmarks: aside "Sidebar", nav "Primary" (`MobileNav` keeps "Primary"),
so exactly one primary navigation landmark exists at every width.

**Top bar** (`<header class="mrr-top">`, grid `1fr 368px 1fr`, 40px): the palette
trigger in the centre (368×38, `--field`, radius 9, "Jump to a tab or section…" with a
⌘ K kbd; the mockup's search copy describes a search the palette does not do), the
transitional regime pill and 4px odds bar in the empty left cell until every tab's
summary card carries the regime row (Phase 10 removes them), and on the right the
**Ask the analyst** chip (34px, mint border and fill, `aria-controls="assistant-panel"`)
and the bell (`aria-haspopup="dialog"`, count badge when there are breaches in the
last 7 days, the full alert sentence in `title` and `aria-label`, an sr-only "Alerts"
word). No avatar (decision 6). The analyst launcher is a header chip at every width,
never a floating button over data.

**Strip** (`.mrr-strip`, grid `325px 332px 332px minmax(0,1fr)`, gap 16, margin-bottom
14; two columns below 1200): three quote cards (SPY, QQQ, US 10Y: symbol 15px 500,
price 15px tabular, 1D change 14px in `--pos`/`--neg`, 80×26 sparkline, 600ms tick
flash, 9.5px mono amber tags `15M` / `CLOSE` / `1W` for delayed or stored reads) and
the freshness card (two 12px lines, each with a 6px dot: "Markets live · <ET clock>"
or "Markets delayed · <stamp>" or "Validated snapshot · <date>", then "Macro monthly ·
latest <Mon YYYY>"; "Freshness ›" opens the per-source drawer). "Markets live" prints
only when the status word is Live, with " · crypto/FX only" whenever the US feed is
quiet. Each quote card is a fixed-slot quote tile (Iteration 1, `QuoteSlots` in
`QuoteCard.tsx`, grid `.mrr-qslots`): symbol, value, change, tag, spark, always all
five in that order, so a feed with no day change prints a muted "—" in the change slot
and keeps its tag, and a missing sparkline leaves an 80×26 placeholder.

**Collapsing the sidebar and where the strip lives (Iteration 1, S3 and S4).** From
860px up, a 28px control beside the wordmark ("Hide navigation", a hand-drawn panel
glyph, `aria-controls="mrr-sidebar"`) collapses the sidebar to a 56px rail (at most
64px) holding the same control ("Show navigation") on top and the freshness entry at
the bottom; the main column takes the freed width. Ctrl+\ (⌘+\ on a Mac) toggles it
too, except while typing in a field, and the palette lists the same action with that
shortcut. Focus follows to the new control. The state is stored in the browser beside
the watchlist (section 8). Below 860 nothing changes: MobileNav, no rail. The strip is
absent on Recession and Methodology (reference reading); the sidebar footer's status
line is a button (`data-testid="sidebar-freshness"`, named "Data freshness: …") that
opens the freshness drawer on every route, as does the rail's dot and a "Data
freshness" row in the open MobileNav list. Its dot takes the `live_quotes` state's tone
when `/api/freshness` serves `series[]`.

**Dev-only build stamp.** A Vite plugin (`web/vite.config.ts`, `apply: "serve"`)
injects `<meta name="mrr-build" content="<branch>@<sha7>">`, computed once when the
dev server starts, so a verifier knows which checkout a page came from. Caveats: the
stamp is frozen at server start (restart Vite after every branch cut or commit);
`--abbrev-ref` prints `HEAD` on a detached checkout; `--short=7` pins the length; the
plugin is inert under `vite build` and `vite preview`. `__MRR_VERSION__` (the sidebar
version) comes from `npm_package_version`.

**Contracts kept:** every route sets `document.title` to `<Tab> · Macro Regime
Radar`; the skip link is the first child of `.mrr-app` and moves focus to
`#main-content`; `#shell-content` wraps the aside, main and assistant panel so
`useModal` can set `inert` on it while the alert drawer, the palette or the freshness
drawer is open (all three sit outside it); `ErrorBoundary key={activeSlug}` and
`Suspense` wrap every screen; ⌘K / Ctrl+K toggles the palette. Every section id in
`sections.ts` still resolves, so palette jumps land.

## 8. Watchlist

The sidebar watchlist (spec section 3.1, decision 6) is one of the two per-visitor
preferences stored in the browser (the other is the sidebar's collapsed state,
`mrr.sidebar.v1` = `{ version: 1, collapsed }`, corrupt reads as expanded):
`localStorage` key `mrr.watchlist.v1`, shaped
`{ version: 1, symbols: [{ symbol, addedAt }] }`, defaults SPY, QQQ, IWM, EEM, validated
on load (uppercase, `^[A-Z0-9.^=-]{1,15}$`, deduped, capped at 12; corrupt data falls
back to the defaults and rewrites storage; unavailable storage keeps the list in memory
and says "Won't be saved in this browser."). "+" opens a popover over the same
`useSymbolSearch` as Markets (arrow keys select, Enter adds, listed symbols show a
check, a full list says so); a × on hover or focus, or Delete / Backspace on a focused
row, removes with a 6-second "Removed SYM · Undo" toast; a drag handle or Alt+↑/↓
reorders; the `storage` event keeps two open tabs in sync. Prices are best effort:
live ticks via `watch(symbol)` when the relay has a slot (20 dynamic symbols shared by
all visitors), otherwise the last close from 5D candles with an amber EOD tag, and the
sparkline from the same candles. Clicking a row opens Markets single-name research
(`?name=`). Rows are 35px, 12px, `symbol · price · 1D change · 36×18 sparkline`. No
accounts, no server storage, no cross-device sync.

## 9. Components

Restyle existing components rather than building parallel ones (spec section 3).
Phase 2 (2026-09-15) built every row below on `/kit`; the screens adopt TabHero and
SummaryCard in Phases 3 to 9 (`DeskRead` stays live until each screen's phase), while
the restyled `Card`, `Tag`, `SubTabs`, `SliderRow`, `Caption` and `Disclosure` already
change the look of their current call sites. Values are the checklist
(`docs/redesign-v2/checklists/02-components.md`, section B) as shipped.

| Mockup element | Build from | Notes | Status |
|---|---|---|---|
| **TabHero** (58px serif headline, pill, subhead, lede, two buttons, footnote, signature chart on the right) | `screens/shared/TabHero.tsx`, built from `DeskRead.tsx` (its `FreshnessChip` and types) | Card gradient on a 12px radius and 1px `--line`, 26/30/22 padding, `minmax(0,540px) minmax(0,1fr)` grid with a per-hero radial glow (`glow`, default `rgba(38,220,160,.07)`). Eyebrow 11.5px Plex Sans 500 .24em `--text-eyebrow` with the 6px pulsing mint dot (`live`) or the ◆ glyph; h1 Source Serif 4 700 58px/1.02 -.012em opsz 30 in `#fff` beside the `Pill`; h2 23px/1.3 500 (a paragraph when `as="h2"`); lede 15.5px/1.6 `--text-2` on a 540px measure; 44px 9px-radius buttons, white primary with the 16px arrow, ghost on `--line-white-30` (`to`, `href` or `onClick`); footnote 12.5px `--text-3` joined by aria-hidden bullets, then the freshness chips and the note; the chart slot (`data-chart-slot`, a flex column centring its child on both axes; the signature charts draw through `HeroChartFrame`, `screens/shared/HeroChart.tsx`, at the column's own size, 1:1, their height between a per-chart floor and aspect cap, each svg marked `data-chart`) or the `linear-gradient(135deg,#0f1a24,#0a131b)` placeholder. Below 1200 one column (`--hero-cols`), below 860 a 44px headline (`--fs-display` override on `.mrr-hero`), below 768 18/16/16 padding. `.mrr-hero-row` (app.css) pairs it with the 432px summary column at 1620 and up and stacks the summary under it below (Iteration 1). The headline is the tab's answer, never the tab name. | Built (Phase 2); Dashboard (Phase 3) |
| **SummaryCard** (key/value rows plus status strip) | `screens/shared/SummaryCard.tsx`, from DeskRead's `Ledger` (`StatusStrip` exported too) | Card gradient, 12px radius, 18/20/16 padding; eyebrow title (h3, or h2 via `as`); real `dl` rows on a `150px minmax(0,1fr)` grid, 7px vertical padding, 1px `--line-2` dividers, 13.5px: sentence-case `--text-2` labels, `--text` tabular values in the UI face (`tone` recolours a value; `kvLinkStyle` for the mint underlined link). The strip is a router `Link`, `<a>` or `<button>` (never a div with onClick), 10px radius, 28px bars glyph, 18px chevron: mint `linear-gradient(90deg, rgba(18,190,130,.12), rgba(18,190,130,.05))` on `rgba(38,220,160,.34)`; amber `rgba(245,181,46,.12) → .04` on `--amber-a36`; gray (loading / unavailable) `rgba(200,210,220,.08) → .03` on `rgba(200,210,220,.25)`. Title 14px 500 in the tone colour, detail 12px `--text-2`. Absent when there is nothing to report. | Built (Phase 2); Dashboard (Phase 3) |
| **SignalCard** | `components/signals/SignalCard` | Tile radius, 14/16/14 padding: name, `Tag` badge (Clear / Watch / Triggered), 21px value, 118×30 sparkline, meter label, 5px meter in the status colour, "Last alert:" and the mono `lines`; `sparkline`, `meterLabel`, `lines`, `badge`, `heading`, `as` props. Reused by Dashboard signals, Credit spread monitor and Recession model inputs. | Built (Phase 2) |
| **Panel + SectionHeader** | `components/core/Card`, `SectionHeader` | `Card` variants: `panel` (12px, 1px `--line`, `--panel`, 16/18/18), `tile` (9px, `rgba(150,175,200,.10)`, `--tile`, 14px), `card` (gradient); tone borders at the badge alphas; `accentBar` is the callout (3px rail, `0 8px 8px 0`, 10/14 padding, tinted gradient). `SectionHeader`: eyebrow 12px Plex Sans 500 .24em `--text-eyebrow`, no rule; `layout="panel"` adds the 13px `--text-2` description and the right slot (mono 11px .1em meta, actions, `.mrr-link` arrow link, wrapping under 768); `level="sub"` is the 11px .2em sub-eyebrow. The default inline layout keeps `right` inside the heading (label parity). | Built (Phase 2) |
| **Badge** (CLEAR / WATCH / alert / info / reference) | `components/core/Tag` | Mono 11.5px .1em uppercase, 7px radius, 7% tinted fill, 1px tinted border; heights `xs` 20 / `sm` 24 / `md` 28; tones `clear` / `watch` / `alert` / `info` / `reference` (the old names alias). | Built (Phase 2) |
| **Probability pill** | `components/core/Pill`; `RegimeBadge` composes it | Mint, amber, gray (plus the overheating and stagflation regime tints); `md` 40px, `sm` 28px, 999px radius, mono 14px .13em uppercase, 10 to 11% fill, 50% border, `--glow-pill` / `--glow-pill-amber`; gray casts no shadow. | Built (Phase 2) |
| **SubTabs** (label plus hint line) | `screens/shared/SubTabs.tsx` | The tablist is a 12px-radius box on `--panel` with a 1px `--line` border, 6px padding and gap; tabs are 8px-radius buttons (9/16/8 padding; 36px min on wrap tiers, 44px narrow) with a block 14px 500 label and, at wide widths, a block 10.5px mono .08em uppercase hint (`--text-4`, mint when selected); the selected tab sits on `--line-white-14` with the 7% to 2.5% white gradient and a white label; hover brightens the label to `--text`. Hints drop when the row wraps; tablist semantics, roving tabindex and the overflow fade / "More ▸" control are unchanged. | Built (Phase 2) |
| **Segmented control** | `components/core/Segmented` | `role="group"` of `aria-pressed` buttons: 28px, 7px radius, 12.5px (mono variant 11px .08em uppercase), pressed on `--line-strong` with the 8% to 3% white gradient; hover via `.mrr-seg button:hover` in app.css; 40px `data-touch` on narrow. | Built (Phase 2) |
| **Meter** | `components/data/GaugeBar` | 5px track on `--track`, 3px radius, fill colour by `tone` (`rampColor` kept); optional `tick`, `gradient`, `scale`; `MeterRow` and `DivergingBar` exports. | Built (Phase 2) |
| **Stacked odds bar** | `components/data/ProbabilityBar` | 8px default height, 2px gaps, 4px radius, mono 11px legend in fixed regime order (`legend="letter"`, `order="desc"` optional). No transition: flex widths cannot animate on the compositor (risk G4). | Built (Phase 2) |
| **Compact DataTable with group rows** | `components/data/DataTable` | Column headers mono 10.5px 500 .1em uppercase `--text-3` over a 1px `--line` rule; cells 13px tabular `--text` with 1px `--line-2` dividers (8/10 padding, `compact` 6/8); `groups` render mono 10.5px .14em `--text-4` rows; column `sub` renders an 11.5px secondary label. | Built (Phase 2) |
| **SliderRow** | `screens/shared/screen-ui.tsx` | Rows 8/0/10 padding divided by 1px `--line-2` (`.mrr-slider-row`); 13px `--text-2` label, 14px 500 tabular value; 4px `--track` track (2px radius) with a `--link` fill; 16px round white thumb with a 4px 20% ring (a solid `box-shadow`, risk G5 default) on the 28px hit band. `baseline` draws the 1px 50%-white current-reading tick; a changed value turns the value, fill, ring and typed `NumberField` amber, sets `data-changed="true"` and prints "│ current reading" in the mono 10px `--text-4` scale row (`scale`, `showScale`, `format`, `changed` props; no scale row until a call site opts in). | Built (Phase 2) |
| **HeatMatrix** | `components/data/HeatMatrix` | `role="table"` grid for the credit transition odds and the Tools IRR grid; `transitionTint` (alpha 0.55·p, mint diagonal, amber off-diagonal) and `irrTint` (bands at 15 and 20) exported; the current row or cell outlined; null cells print n/a. | Built (Phase 2) |
| **Charts** | Lightweight Charts for time series and candles; inline SVG for the quadrant, gauge, bridge, ribbon and event timeline | Axis labels Plex Mono 10px #6f7d8a; gridlines `--line-2`. `Sparkline` gained `gradient` (28% to 0 area fill) and `strokeWidth`. The per-tab signature charts arrive with their screens. | Sparkline built (Phase 2); charts per screen |
| **QuoteCard, FreshnessCard, FreshnessDrawer, Sidebar, TopBar, MobileNav, Watchlist** | shell | Section 7 and 8. | Built (Phase 1) |

**Disclosure, captions and meta (Phase 2, `screens/shared`).** `Disclosure` `row` is
the mockup Options-lens trigger: a full-width button on an 8px radius, 1px `--line-2`
border (`--line` while open), 2% white fill, 10/12 padding, the mono ▸/▾ glyph in
`--text-3`, a 13.5px 500 title, the new 13px `--text-2` `description` (ellipsised at
desk width, wrapping on a phone) and the `right` meta in mono 10px .1em uppercase
`--text-3`; `quiet` is the text-only 12.5px `--text-2` trigger (`tone="mint"`: 11.5px
mint, the News regime-read line); `onToggle` reports the new state; children still
mount only while open. `DisclosureLine` is the mono 11px/1.6 .03em `--text-4` footer
paragraph every tab ends with (max 1100px; `.mrr-disclosure-line` carries the same
values for a plain element). `Caption` / `capStyle` is 13px/1.5 Plex Sans `--text-3`
(the mockup `.cap` is 12.5px; 13px keeps the sans floor); `Caption mono` /
`monoNoteStyle` is the 12px/1.55 mono provenance line; `metaStyle` is the mono 11px
.1em uppercase `--text-3` meta string; `eyebrowStyle` is the 11px .2em Plex Sans 500
sub-eyebrow in `--text-3` (uppercase stays: the label harvester keys on it).
`StatTile` values moved to the UI face at 500 (xs 14 / sm 20 / md 24 / lg 30 / xl 40)
with the mono 11px meta label. Buttons: `.mrr-btn` is the 30px ghost (8px radius,
`--line-white-30`, white 12.5px 500 text, hover to a white border), `.mrr-btn-accent`
the link tint, `.mrr-btn-primary` the white hero primary; the 44px `data-touch` floor
is kept.

Components still outside the mapping (`AlertDrawer`, `CommandPalette`,
`AssistantPanel`, `ScrollTable`, `Jargon`, `Markdown`, `IntelBanner`, `ReadThrough`,
`NewsCard`, `StatusDot`, `AlertRow`) flow through the token aliases until their owning
phase restyles them. `TickerStrip` (`components/nav`) stays for `KitScreen` only; the
shell no longer imports it.

**States.** Loading, empty, stale, unavailable and error states are sentences in the
UI face at 13px, never spinners or blanks: "Reading stored data…", "Nothing on file.",
"Stale coverage. No headlines in the last 7D; latest stored coverage is Aug 26, 2026
(11 days old)", "Unavailable: the data service did not answer." Fallback content is
labeled stale on the hero, on the section notice and on every card ("STORED · STALE").
An optional tool that cannot run demotes to a collapsed status row stating the exact
requirement. Sub-1% probabilities print "<1%"; only an exact zero prints "0%".

**No absence before an answer.** Every API call aborts after 15 seconds and surfaces as
"unavailable"; nothing asserts "No alerts", "none on file" or "No datapoints" while a
request is pending. The bell reads "Reading the alert feed…" then "Alert feed
unavailable…" in its title; chart accordions print "Reading…" captions; signal cards
without a threshold say "its stored trigger" rather than leaking a template. Quote
cards with no stream quote print the newest stored close with its date, never a dash
where a price exists.

**One number, one name.** Dashboard names the classifier's `confidence` "Model
confidence"; Regime Lab names the takeaway's `conviction` "Takeaway conviction". The
NBER recession model's probability is labeled as a separate model from the Recession
Risk regime odds wherever both appear (decision 4). The transitional top-bar pill shows
`max(prob_*)` from the stored row, never `confidence`. Server stamps without a zone are
UTC and render as ET wall time (`fmtUtcStampEt`); chart ranges and "last alert" dates
use `fmtDate`, axis ticks `fmtMonYr`.

**Touch and hit areas.** Interactive controls are at least 28px tall at desk width and
44px below 768 (chips and buttons carrying `data-touch="true"`, menu rows, sub-tabs).
Slider thumbs are 16px with a 4px ring on a 28px hit band. Inline jargon terms keep
the inline-text exception.

## 10. Freshness, status and provenance

### Where the sentence lives (2026-09-15)

The header freshness sentence moved into the **freshness drawer** (`FreshnessDrawer`,
opened from the strip's freshness card, `useModal` contract: focus trap, Esc, `inert`
page, focus returned to "Freshness ›"). The drawer's first block (`role="status"`)
carries the exact sentence `impactSentence(macroFresh, marketFresh, streamLive)`, or the
blocker and snapshot variants, with the coloured Macro / Signals / Market / Intraday
words and dates; then the overall verdict, a feed table (verdict, latest, expected,
reason per `sla` entry), the regime month and its blockers, the NYSE session, the live
relay, and the data service block. The card itself prints two lines: line 1 from the
status word (`Markets live · 09:41 ET`, `Markets delayed · Sep 12, 2026 close`,
`Markets reconnecting · last …`, `Data service unavailable`, `Validated snapshot ·
Sep 12, 2026`), line 2 `Macro monthly · latest Jul 2026` with the dot coloured by the
monthly assessment (current mint, delayed amber, stale warn-hot, unavailable neg).
`FreshnessChip` / `freshness.ts` keep the closed vocabulary Current · Delayed · Stale ·
Unavailable · Reference, assessed against cadence (monthly 45/75 days, weekly 10/21,
daily 4/10, intraday 20 min / 1 session, hourly 6 h / 2 days): word first, glyph
second (● ▪ ▾ × ◆), date always, age in words when not current.

### Provider and fallback labels (2026-09-06)

Every number that came from a market-data provider says which one, in the caption or
the meta line, in this order: **provider · delayed/live · as-of · fallback**.
Vocabulary (one helper, `screens/shared/provider-ui.ts`):

- `EODHD · delayed · as of Sep 04, 16:27 ET`: the REST quote; `live · EODHD stream`
  only while a websocket tick is inside the two-minute window.
- `session closed · last close stands`: appended while the NYSE session is closed.
- `yfinance standing in (EODHD timed out)`: a fallback always names the reason (not
  configured · not in the plan · no listing · unsupported · rate limit · timed out ·
  unavailable · unreadable · no bars).
- Chart provenance: `6M · daily bars · EODHD · through Sep 04, 2026 · split- and
  dividend-adjusted · delayed history, not the live tape`. Daily and coarser bars
  print a date; intraday bars print an ET clock time.
- Fundamentals: `Fundamentals via yfinance (EODHD fundamentals are not in the plan on
  this server)`.
- Failures are sentences that name the kind: no listing · not a supported instrument ·
  not included in the data plan · rate limiting · did not answer in time · unreachable
  (stored data stays) · no history in this range.

### Status word

One chip, from one function (`live/quotes.ts:streamWord` plus the API answering),
glyph + word, never colour alone:
`● Live` · `▪ Delayed` · `↻ Reconnecting` · `× Backend unavailable` ·
`◆ Validated snapshot · <date>`. "Live" names its feeds when the US tape is quiet
(`Live · crypto/FX only · US session closed`) and, when the relay reports degradation,
says why in reader words (`· US equity feed rejected by the provider`, `· US equity
feed silent`); the tape's feed line uses the same vocabulary (`feed rejected by the
provider`, `reconnecting`, `unavailable`). Raw relay states never render. The sidebar
footer prints the same state in words: "Live market data" (plus " · crypto/FX only"),
"Delayed market data", "Reconnecting to feeds", "Data service unavailable", "Validated
snapshot".

### Loading, degraded and unavailable states

- Requesting: `Requesting 6M history for AMZN from EODHD…` (role=status); a range
  switch keeps the previous bars with a small `Requesting 1D bars…` tag; a symbol
  switch never keeps the previous symbol's bars.
- Calculators: `Calculating the deal model…` before the first answer; never "Nothing on
  file" for a pending computation. Unavailable engine, rejected inputs and an
  unreachable service are three different sentences.
- Backend asleep: every seeded screen renders from the validated snapshot; the
  freshness card and drawer say so ("The data service is asleep or unreachable; this
  page runs on the validated snapshot and reconnects on its own."); nothing spins
  forever; queries refetch on their own. Snapshot mode carries its one-sentence
  explanation at every width.

### Responsive Regime Lab navigation

`SubTabs` wraps below the wide tier (<1024) so every view stays visible at 768 and 390
(hints dropped, 36 to 40px rows); at wide widths an overflowing row shows a fade with
`◂` / `More ▸` controls and the selected tab is scrolled into view.

### Options lens

A collapsed `Disclosure` under the key stats of Single-name research (US stocks and
ETFs only): expiration `<select>`, Calls/Puts as `aria-pressed` chips, a sticky-header
table (Strike · Bid · Ask · Last · Vol · OI · IV · Δ Γ Θ V · Moneyness · DTE) inside its
own scroll well (`Swipe sideways for more columns` on narrow), Prev/Next paging, and a
caption stating end-of-day marks, the provider's own Greeks, and that nothing is a
recommendation. A plan without options shows one explicit sentence instead of an empty
shell.

### Review reconciliation (2026-09-06, independent visual review)

- Document titles: every route sets `<Tab> · Macro Regime Radar`.
- Chart captions end with a full stop, print dates for daily-or-coarser bars and ET
  clock time for intraday bars, and omit the adjustment clause for crypto, FX and
  indices.
- News names its lead section "Priority headlines" (palette entry identical) and
  "Latest stored headlines" on the fallback; the conclusion is composed in the
  product's voice, not the headline verbatim; "high impact" means ≥3.5 everywhere on
  the screen.
- Freshness chips print the state word once (`◆ Reference Calendar`).
- Stored tape rows open the DAILY/INTRADAY panel while on-demand rows open range chips
  (two data shapes, two honest affordances); documented and left as is.

## 11. Do's and Don'ts

Rules restated from spec section 0 that still apply, verbatim:

- No icon library. The sidebar icons are hand-drawn inline SVG.
- No emoji.
- Focus ring is never removed.
- Honor reduced motion.
- Honest freshness: never call monthly data live.
- One number, one truth: never re-derive a stored probability in the browser.
- Jargon tooltips on every finance term.
- Every section id in `sections.ts` still resolves.

### Do
- **Do** set every badge, pill, meta string, timestamp, axis label and column header in
  IBM Plex Mono with tabular figures; set every sentence, caption and big number in
  IBM Plex Sans; reserve the serif for the one headline per tab.
- **Do** give every metric its label, unit, timeframe and a one-line desk-note caption:
  "CPI runs at 4.17% YoY, a 3.9σ jump vs its recent weekly range." A naked number
  (unlabeled decimals, unit-less indices) is the product's documented worst failure
  mode.
- **Do** use the closed status vocabulary: Clear/Watch/Triggered · info/watch/risk ·
  Risk-On/Risk-Off · Aligned/Diverges · Current/Delayed/Stale/Unavailable/Reference.
  Never invent synonyms.
- **Do** state freshness honestly ("monthly observations · latest Jul 01, 2026") and fall
  back to latest-available data with its date instead of an empty state: dated beats
  empty. An empty state with data in the store is a rendering failure.
- **Do** keep the focus ring (2px `--link`, 2px offset) on every focusable element and
  respect `prefers-reduced-motion` on every animation (the pulse, the caret, the tick
  flash, gauge transitions; the mint glow is a static box-shadow and is allowed).
- **Do** pair every colour-coded status with a word or a glyph, and render red text on
  the `--neg` rung (#f0503f), which clears AA on `--panel`; never a darker red as text.
- **Do** end anything that leaves the app with "Automated briefing from Macro Regime
  Radar. Not investment advice."
- **Do** keep the hand-drawn glyph vocabulary for text glyphs: ▲ ▼ → ↗ ↘ ◆ ● ✓ × ▸ ▾ ▪
  ›; if a concept needs an icon, it needs a label.

### Don't
- **Don't** add an icon library or substitute emoji. New icons are hand-drawn inline
  SVG at 22px (nav) or 18px (secondary), stroke 1.6, `currentColor`, `aria-hidden`.
- **Don't** use photography until a licensed image exists, and never illustration,
  texture, blur or a shadow outside the five allowed (section 5).
- **Don't** set the serif anywhere but the tab headline and the Recession scenario
  result; never in a badge, a card title or the wordmark.
- **Don't** let `--link` or `--mint` mean "up" or "good"; valence belongs to `--pos` /
  `--neg` alone, and status to mint / amber / neg with a word beside it.
- **Don't** nest cards in cards, centre content in narrow columns (memo excepted), or
  add hover fills outside tables, nav items and watchlist rows.
- **Don't** write em-dash asides in UI copy: an appositive hung off a dash ("X, dash,
  the reason Y") reads as generated text. Use a colon, a comma, parentheses or a new
  sentence; "·" stays the separator for meta runs; the dash survives only as the
  null-value glyph. Loading lines end in "…", never a trailing dash.
- **Don't** re-derive a probability the API already asserts, and never present the
  classifier odds and the NBER recession model as one distribution.
- **Don't** persist anything per visitor except the watchlist; the assistant's
  no-persistence rule is unchanged.
- **Don't** call monthly data live, and never print "Markets live" unless the status
  word is Live.

<!-- Detector waivers (deliberate, owner-confirmed; do not "fix"): heavy mono usage on
     data strings · dense panel grids (12 to 16px rhythm) · dark-only theme · the
     transitional 0.5px inline borders on screens not yet restyled · a single 58px
     serif headline per tab. These are the product's signature, not defects. -->

## 12. Transitional aliases

Rule for Phases 2 to 9: every pre-redesign variable NAME keeps resolving through the
alias block in `colors.css` (and the kept entries in `borders.css`, `spacing.css`,
`typography.css`) until the phase that owns its last consumer replaces it. Before
deleting, re-run `grep -rhoE "var\(--name\)" web/src | wc -l`; Phase 10 deletes an
alias only when its count is 0.

| Old name | Resolves to | Retired by |
|---|---|---|
| `--bg-base`, `--void` | `--bg` | Phase 10 sweep (app.css wells, palette input, `.mrr-number`, `.assistant-input`, `.mrr-md pre`) |
| `--surface` | `--panel` | Phase 2 (`Card`), then each screen; Phase 10 at the latest |
| `--surface-raised` | `--track` | Phase 2 (`GaugeBar`, chips, `SliderRow`); `SymbolSearch` Phase 5; app.css scrollbar Phase 10 |
| `--line-hair` | `--line-2` | Each screen as its inline `0.5px solid` strings become 1px `--line`; Phase 10 |
| `--text-muted` | `--text-3` | Each screen; Phase 10 |
| `--text-faint` | `--text-4` | Each screen; Phase 10 |
| `--text-label` | `--text-eyebrow` | Phase 2 (`SectionHeader`, `.mrr-label`) |
| `--accent` | `--link` | app.css rules with the shell; screens by phase; Phase 10 |
| `--accent-dim` | `--link-a10` | same |
| `--accent-line` | `--link-a32` | same |
| `--warn` | `--amber` | Each screen; Phase 10 |
| `--neg-text` | `--neg` | Each screen; Phase 10 |
| `--pos-soft`, `--neg-soft` | `--pos`, `--neg` | Single consumers; their owning screen |
| `--regime-goldilocks/-overheating/-stagflation/-recession` | `--r-*` | `ProbabilityBar` and `RegimeBadge` Phase 2; Dashboard Phase 3; Regime Lab Phase 4; `SingleName` Phase 5; `AllocationPanel` Phase 9; Landing Phase 10 |
| `--badge-*-bg/-fg/-line` | own values on the new hues (12% / 25%) | Phase 2 (`RegimeBadge` becomes the pill; `Tag` takes the 7% rule) |
| `--gauge-0/-50/-75/-95` | `--pos` / `--amber` / `--warn-hot` / `--neg` | Phase 2 (`GaugeBar` becomes Meter) |
| `--level-info/-watch/-risk` | `--link` / `--amber` / `--neg` | No consumer today; Phase 10 if still unused |
| `--r-md` | 6px | Phase 2 (`Card`, `Tag`, buttons move to `--r-card`, `--r-badge`, `--r-ctl`) |
| `--r-xs`, `--r-sm` | 3px, 4px | Each screen |
| `--bw-hair` | .5px | Phase 10 |
| `--fs-lead`, `--fs-metric`, `--fs-value-lg` | old rungs | Phase 2 (`TabHero`) |
| `--ls-badge` | .3px | Phase 2 (pill) |
| `--maxw-frame` | 1520px | Phase 10, with `.mrr-frame` (Landing page only) |
| `--shadow-float` | kept, not transitional | stays (the assistant float) |

Deleted in Phase 1 (zero consumers on cb7c4d8): `--bg-base-alt`, `--surface-hover`,
`--accent-alt`, `--surface-card`, `--surface-page`, `--text-body`, `--text-heading`,
`--border-card` (the colors.css duplicate; the composed border in borders.css stays),
`--glow-pos`, `--glow-neg`, `--glow-accent`, `--ring-accent`, `--border-hair`,
`--maxw-memo`, `--fs-hero`, `--r-lg`. `--r-pill` was redefined from 20px to 999px (no
consumer). `--link` was an alias of `--accent` and is now the real token.

Hard-coded old-palette literals that bypass every alias stay with their owning phase
and are listed in PROGRESS.md so no phase closes with one left: `rgba(74,158,255,…)` in
six files, `#8b949e` in `AllocationPanel.tsx` and `CandleChart.tsx`, `#2ecc71` in
`RegimeLabScreen.tsx`, `AllocationPanel.tsx`, `MethodologyScreen.tsx` and
`SingleName.tsx`. Phase 1 fixed only the two CSS files (`base.css` link hover and active
colours, `app.css` news-arrive keyframe); Phase 4 cleared `screens/regimelab/` (the
`#2ecc71` map and the `rgba(74,158,255,…)` chip fills became `REGIME_HUE` tokens and
Phase 2 components).

## 13. Change log

- 2026-09-19 Iteration 1, Credit / Recession / Tools: the credit ladder row and the LBO
  schedule / sensitivity pair go one column; charts fill their tiles' height through
  `HeroChartFrame`; the recession gauge scales with its slot; Recession sensitivity opens
  on load (D2) and names the model's own reading; the LBO all-in rate is never "live",
  each component carrying its own as-of word; the fifth recession input is the
  "10Y − 5Y breakeven spread"
- 2026-09-19 Iteration 1, root causes: the hero row pairs the hero with the summary
  card only from 1620 (below, the summary stacks under the hero and sizes to its rows,
  and the full-width hero keeps copy | chart down to 1200, replacing the 1520 inner-grid
  step); the hero chart slot centres its child and the signature charts (quadrant,
  1-week bars, equity bridge, event timeline, regime return bars) draw through
  `HeroChartFrame` at the slot's width, 1:1, instead of a 400px drawing parked at the
  right edge; the summary card's status strip sits on the card's bottom with its rows
  at natural height (no spacer element); the glance tiles are the strip's fixed-slot
  tile (symbol and name, price, change beside tag, sparkline on its own row across the
  tile, `data-sparkline`; the price steps to 17px where the tiles are 4-up and under
  160px, 1200 to 1519); SubTabs keeps the strip where it was on screen when a view is
  picked, focuses the new tab without scrolling, and holds a short panel open so the
  browser cannot clamp the scroll position; `useHashScroll` keeps a hash landing while
  late content grows the page and returns a `release` for sub-tab switches
- 2026-09-19 Iteration 1, shell: the sidebar footer is pinned under a watchlist that
  scrolls inside its own block (short viewports tighten the fixed blocks in three
  steps); the sidebar collapses to a 56px rail (control, Ctrl/⌘+\, palette action,
  `mrr.sidebar.v1`); strip quote cards share the fixed-slot tile and stack one per row
  below 768; no strip on Recession and Methodology; the sidebar footer, the rail and the
  MobileNav list open the freshness drawer; `fresh-state.ts` renders the per-series
  freshness states (FRESHNESS_CONTRACT §5)
- 2026-09-15 Phase 10: transitional top-bar regime pill and odds bar removed (every
  summary card carries the regime row); aliases `--accent`, `--accent-dim`,
  `--accent-line`, `--text-faint` and `--warn` retired after the sweep to `--link`,
  `--link-a10`, `--link-a32`, `--text-4` and `--amber` (the inset focus rings moved to
  `--link` first), with `--bw-hair` and `--border-card`; `--text-4` words lifted to
  `--text-3` (DisclosureLine, slider scale, DataTable group rows, unselected SubTabs
  hints, GaugeBar scale row and MeterRow delta); `StateNote live` (role="status") on
  the Recession scenario result and the Allocation status line; SubTabs named
  "label, hint"; Methodology opens with a UI-face h1; the Landing live dot is
  `--mint`; the three reduced-motion blocks merged into one; measured responsive
  steps: hero inner grid stacks below 1520, strip two-up below 1620, glance tiles
  two-up below 1200, spread-monitor column floor 256px, news score column max-content;
  verifier pass: SubTabs scroll their own strip (no `scrollIntoView`, so the first Tab
  stays on the skip link), the typed slider field reverts on Escape, Methodology header
  metas wrap and the disclosure row meta shrinks at phone width, the divergence-scale
  and news detail words also read `--text-3`, the priced tables carry names, the
  Methodology signals table prints its empty note, the kit's fixture grids clamp to
  their container and its table specimens sit in ScrollTable wells
- 2026-09-15 Phase 9: Tools rebuilt on TabHero / SummaryCard per tool; LBO body 400 | 1fr
  with the IRR HeatMatrix; Allocation on Segmented / HeatMatrix / DataTable / MeterRow
  with every lens kept
- 2026-09-15 Phase 8: News & Calendar rebuilt on TabHero / SummaryCard; NewsCard gains
  the lead variant; the calendar is a day-grouped DataTable
- 2026-09-15 Phase 7: Recession rebuilt on TabHero / SummaryCard; the scenario result
  is the second display-face number (spec section 1); sensitivity collapsed by default
- 2026-09-15 Phase 6: Credit rebuilt on TabHero / SummaryCard; hero OAS chart on
  Lightweight Charts (dashed rules, NBER bands, 10Y / MAX); spread monitor on
  SignalCard; transition odds on HeatMatrix behind a 3m/6m Segmented; the Tight
  glossary entry
- 2026-09-15 Phase 5: Markets rebuilt on TabHero / SummaryCard; tape on DataTable
  groups (nine columns, Macro / Single names toggle); single-name panel with 20-day
  average, News disclosure; local old-palette literals removed
- 2026-09-15 Phase 4: Regime Lab rebuilt on TabHero / SummaryCard; sub-tabs on Panel,
  Segmented, MeterRow, DataTable groups, HeatMatrix; local old-palette hexes removed
- 2026-09-15 Phase 3: Dashboard rebuilt on TabHero / SummaryCard; wordmark demoted to a
  paragraph; the route h1 is the hero headline
- 2026-09-15 Phase 2: shared components restyled; KitScreen rebuilt
- 2026-09-15 Phase 1: spec section 0 adopted; Space Grotesk retired; Source Serif 4
  self-hosted; shell rebuilt (sidebar, top bar, strip, freshness drawer, mobile nav);
  watchlist added; transitional alias block and retire schedule recorded.
