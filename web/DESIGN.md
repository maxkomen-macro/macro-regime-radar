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
`SummaryCard` 432px on the right, gap 16px), then the tab body, then a mono
disclosure line (11px, `--text-4`, max-width 1100px) at the end of the tab.

**Gaps.** 16px between top-level columns (`--gap-col`), 14px between stacked panels
(`--gap-panel`), 12px between tiles inside a panel (`--gap-tile`). Panel padding
`16px 18px 18px`; tile padding 14 to 16px. The old 2px-increment spacing scale
(`--sp-*`) remains for screens not yet restyled.

**Responsive.** Two thresholds, expressed in CSS media queries with `.98` upper
bounds: below 1200px (`max-width: 1199.98px`) the hero and summary stack and the strip
becomes two columns; below 860px (`max-width: 859.98px`) the sidebar hides, the top
bar becomes `1fr auto`, and `MobileNav` takes over. Anything that changes the DOM (the
sidebar ↔ `MobileNav` swap) reads `useBreakpoint().shellCompact` (< 860); the four
existing tiers (mobile < 480, tablet < 768, desktop < 1024, wide) are untouched and
remain the only width-conditional mechanism for screen bodies. The strip is persistent
at every width (two columns below 1200, four cards always).

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

**Sidebar** (`<aside class="mrr-side" aria-label="Sidebar">`, 196px, sticky,
`overflow-y: auto` so the footer stays reachable with a full watchlist): the wordmark
(a hand-drawn 48×26 mountain glyph in `--text-wordmark`, then `MACRO` / `REGIME RADAR`
in the UI face at 12.5px 500 .2em, uppercase in the source text; links to `/`; the
page's only `<h1>` until `TabHero` takes it in Phase 2), seven nav items (47px, 22px
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
quiet.

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

The sidebar watchlist (spec section 3.1, decision 6) is the single per-visitor
preference stored in the browser: `localStorage` key `mrr.watchlist.v1`, shaped
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
Every row below is a Phase 2 target unless marked built.

| Mockup element | Build from | Notes | Status |
|---|---|---|---|
| **TabHero** (58px serif headline, pill, subhead, lede, two buttons, footnote, signature chart on the right) | `screens/shared/DeskRead.tsx` | Same data, new layout: `conclusion` → h1 plus pill, `why` → h2 and lede, `freshness` chips → footnote. The headline is the tab's answer, never the tab name. | Phase 2 |
| **SummaryCard** (key/value rows plus status strip) | DeskRead `ledger` | Right column, 432px. Status strip mint (all clear) or amber (watch) with a bars icon and a chevron; links to the alert drawer or the relevant section. | Phase 2 |
| **SignalCard** | `components/signals/SignalCard` | Name, badge, value, 118×30 sparkline, meter label, meter, two mono lines. Reused by Dashboard signals, Credit spread monitor and Recession model inputs. | Phase 2 |
| **Panel + SectionHeader** | `components/core/Card`, `SectionHeader` | Eyebrow, plain-text description, right slot for meta, a segmented control or a link with an arrow. | Phase 2 |
| **Badge** (CLEAR / WATCH / alert / info / reference) | `components/core/Tag` | Mono uppercase 11.5px, 7px radius, 1px tinted border, 7% tinted fill, 24px tall. | Phase 2 |
| **Probability pill** | `components/signals/RegimeBadge` | Mint, amber or gray variants with the soft outer glow; 40px, 999px radius. Phase 1 only moved the badge to the UI face at 500. | Phase 2 |
| **SubTabs** (label plus hint line) | `screens/shared/SubTabs.tsx` | Hint in mint on the selected tab; tablist semantics kept. | Phase 2 |
| **Segmented control** | new, small | "Equities / Rates / FX…", range pickers, filters. 28px, 7px radius; pressed state white gradient. | Phase 2 |
| **Meter** | `components/data/GaugeBar` | 5px `--track`, fill colour set by status. | Phase 2 |
| **Stacked odds bar** | `components/data/ProbabilityBar` | Regime hues with 2px gaps. | Phase 2 |
| **Compact DataTable with group rows** | `components/data/DataTable` | Column headers mono 10.5px uppercase .1em; group rows mono 10.5px .14em `--text-4`; cells 13px tabular. | Phase 2 |
| **SliderRow** | `screens/shared/screen-ui.tsx` | Adds a current-reading tick; a changed value turns amber. | Phase 2 |
| **HeatMatrix** | new | Credit transition odds and the Tools IRR grid; outline today's row or cell. | Phase 2 |
| **Charts** | Lightweight Charts for time series and candles; inline SVG for the quadrant, gauge, bridge, ribbon and event timeline | Axis labels Plex Mono 10px #6f7d8a; gridlines `--line-2`. `Sparkline` keeps its flat 10% fill until a `gradient` prop arrives with the restyle. | Phase 2 |
| **QuoteCard, FreshnessCard, FreshnessDrawer, Sidebar, TopBar, MobileNav, Watchlist** | shell | Section 7 and 8. | Built (Phase 1) |

Components not in the mapping (`AlertDrawer`, `CommandPalette`, `AssistantPanel`,
`Disclosure`, `ScrollTable`, `Jargon`, `Markdown`, `NumberField`, `IntelBanner`,
`ReadThrough`, `NewsCard`, `StatTile`, `StatusDot`, `AlertRow`) flow through the token
aliases until their owning phase restyles them. `TickerStrip` (`components/nav`) stays
for `KitScreen` only; the shell no longer imports it.

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
Slider thumbs are 18px with a 28px hit band. Inline jargon terms keep the inline-text
exception.

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
colours, `app.css` news-arrive keyframe).

## 13. Change log

- 2026-09-15 Phase 1: spec section 0 adopted; Space Grotesk retired; Source Serif 4
  self-hosted; shell rebuilt (sidebar, top bar, strip, freshness drawer, mobile nav);
  watchlist added; transitional alias block and retire schedule recorded.
