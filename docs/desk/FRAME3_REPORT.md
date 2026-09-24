# FRAME3_REPORT.md — Desk v2 build (session A, `desk/frame-3`)

Contract: `docs/desk/DESK_FRAME3_SPEC.md` plus the approved PNGs in
`docs/desk/screens/`. Branch `desk/frame-3`, cut from `desk/frame-2` at
`4c810d3`. Touches `web/` only, plus this report, the compare screenshots in
`docs/desk/screens/compare/` and the PROPOSED fields in the spec's §12.13.
Nothing pushed; no `.db`, `data/`, secrets, `api/`, `src/` or `scripts/`.

## How it was built and checked

- **Fixtures, one per endpoint.** `web/src/fixtures/desk/<endpoint>.json`,
  each the §12 shape with the mockup's values (PROPOSED fields from §12.13
  included). The app never imports them: it always asks `/api/desk/*`.
  One resolver (`web/src/fixtures/desk/index.ts`) answers from them for
  three consumers, so they cannot disagree: the unit tests
  (`web/src/test/desk.ts`), the Desk browser tests (`web/e2e/lib/desk-fixtures.ts`,
  `page.route`) and the dev server when started with `DESK_FIXTURES=1`
  (`web/vite.config.ts`, serve-only middleware, never in a build).
- **Compare shots.** `web/scripts/desk-compare.mjs <route> <png-name>`
  screenshots a tab with Playwright's Chromium at 1440 wide, the approved
  PNG's height, 2× density (the PNGs are 2880 px wide), against
  `DESK_FIXTURES=1 npx vite --port 5193`, and writes
  `compare/<name>.build.png` (the build) and `compare/<name>.png` (design
  left, build right). Geometry was matched by measuring text runs and box
  edges in both images (PIL), not by eye alone.
- **Gates before every commit:** `tsc -b --noEmit`, `vitest run` (whole
  suite), `npm run build`, and the Desk browser tests
  (`E2E_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/desk.spec.ts`).
  The browser tests assert, per built tab: every computed color is a §1.3
  color, no banned word renders, no sideways scroll; plus keyboard stops with
  names and rings, reduced motion, the 390 px menu.
- **Standing checks in the unit suite:** `desk-palette.test.ts` (every color
  literal in the v2 CSS/TSX is a §1.3 color), `desk-language.test.ts` (the
  frame-2 ban list plus "established" and "significant", over the Desk
  sources and every string the fixtures serve).
- **Independent verifier per tab:** a separate agent with no part in the
  build, briefed with the spec section, the PNG, the compare shot, the
  fixtures and the source, asked to fail anything that does not trace to §12.

## Decisions taken unattended

- **D1. Type sizes and geometry follow the PNGs, not §1.2's stated sizes.**
  The PNGs render about 10–15% larger than §1.2 says (they were drawn with
  wider fallback fonts: DejaVu Sans / Mono and a Times-like serif). The PNG
  wins for layout, so sizes were calibrated by matching text-run widths in the
  PNG with Plex / Source Serif 4: body ≈ 14 px, mono labels ≈ 11.5–12 px with
  almost no extra tracking, serif values ≈ 29 px, page title 28 px, sidebar
  189 px wide including its border (§1.1 says 176). Fonts are the spec's.
- **D2. Unbuilt tabs show a one-line placeholder** until their commit; the
  frame-2 pages they replace are removed with the commit that replaces them
  (Today, S&P Internals, the designed shells, the mobile nav and the Build
  Notes copy went with Overview). Old slugs redirect to the v2 tab
  (`today → overview`, `sp-internals → technicals`, …), query kept.
- **D3. Monitored rows sort by room left, least first.** The mockup draws
  68% / 22% / 52% under the words "Sorted by room left"; the footer's claim
  wins over the drawing, and least-room-first matches "what's closest to
  being wrong".
- **D4. Monitored rows take two lines.** §2's one-row grid
  (`minmax(0,1fr) 54px auto 64px 14px`) leaves the name about 60 px at this
  card width; in the mockup the names overlap the NAV column. The build keeps
  the same cells in the same order on two lines (name and `▸`, then NAV,
  room, bar), so every name reads in full.
- **D5. Room between 30% and 50% keeps the neutral text color:** §2 colors
  ≥ 50% green and < 30% amber and names nothing between.
- **D6. The regime name is amber on the Overview tile** (§2's table says
  "amber serif"); the PNG draws it white.
- **D7. The walkthrough** (frame-2) opens from the Overview's Walkthrough
  button, as before; nothing autoplays. Its six steps now point at the v2
  tabs; the Event Study step addresses its question as `?preset=<slug>`,
  mirroring §12.2's parameters.
- **D8. Frame-3's two banned words are enforced on v2 code and every fixture
  string now;** the frame-2 files not yet rebuilt (the event-study engine
  adapter, the frame-2 study components, positions, pipeline) are listed in
  `LEGACY_FRAME2` in `desk-language.test.ts` and keep the frame-2 list until
  their tab lands. The list is reported at the end of this file.
- **D9. One wording for the verdict definitions** (§1.5), shared by Overview
  and the Ledger; the two PNGs word them slightly differently.
- **D10. "Radar" links** (the sidebar's `← MACRO REGIME RADAR` and the
  breadcrumb) go to `/app/dashboard`, the frame-1/frame-2 target.
- **D11. The impeccable design hook's font-size and radius findings** measure
  against `web/DESIGN.md`'s ramp; the v2 Desk follows the frame-3 spec and
  PNGs instead, and the `desk.css` findings are pre-existing frame-2 values.
  Left as they are.
- **D12. Color jobs follow §1.3 where a PNG gives an accent a second job.**
  Only Overheating takes a regime color on the Overview tile and the sidebar
  (amber); red stays for down and negative numbers; the black shadows became
  page-color tints. Where the spec text names a color outright (the Regime
  key in §5, the 50-day line in §3) the text wins over the PNG.
- **D13. The sidebar's `S&P today` reads "today" only when the served session
  is New York's today;** otherwise it names the session ("S&P Sep 22"), so a
  weekend or a stale snapshot never calls an old close today. With the Sep 22
  fixtures the build therefore prints "S&P Sep 22" where the PNG prints
  "S&P today".
- **D14. "Awaiting refresh" means a failed or absent block** (§1.7); while the
  first answer is on its way a card stays quiet (`aria-busy`), so a slow
  answer never reads as a missing one. The verdict type carries §12.2's
  `insufficient` (pill "Too few", dashed gray) so a Ledger or trend row with
  fewer than 10 events renders instead of breaking.

## Tabs

### 1. Overview — `frame-3: overview`

Built: the v2 shell (sidebar as the only navigation with TODAY and HOUSE
DISCIPLINE cards, header with breadcrumb, Desk / Client toggle in the URL and
the tab's one action, aliases for old slugs, the 390 px Menu), the card kit
(`web/src/screens/desk/kit/`), the data layer (`web/src/screens/desk/data/`,
§12 types and one React Query hook per endpoint), and the Overview tab:
since-last-close line, four tiles with Live badges, Active signals with the
three verdict definitions, Monitored rows, both actions. Fixtures:
`overview.json`, `ledger.json`, `technicals.json` (the sidebar reads
`chg_1d`; its price series are shaped so the averages land exactly on 6,280
and 5,910 with crosses near Apr 14 and Jul 1, 2025).

Compare: `docs/desk/screens/compare/01-overview.png` (build alone:
`01-overview.build.png`). Matches on the first calibrated pass; differences
are D3–D6 and the MOCKUP badge (§1.6: not built).

PROPOSED (spec §12.13): `sample_start` on ledger rows, `tiles.vol.band`,
`tiles.trend.date`, `data_status`, the technicals point shape. Notes for B:
the two label spellings, and the mockup rows vs §12.1's filter.

Verifier, round 1: **FAIL** (one blocking finding). Dispositions:
- V-1 (blocking) tone colors lost to later same-specificity rules (room % and
  "Overheating" rendered in the text color): **fixed**, tones scoped under
  `.dk`; the browser test now checks the computed colors.
- V-2 regime colors beyond §1.3: **fixed** (D12).
- V-3 the trend badge dated by the envelope: **fixed** with PROPOSED
  `tiles.trend.date`; the sidebar's "S&P today" is D13.
- V-4 the walkthrough strip in frame-2 colors and offset: **fixed**, v2
  tokens and the 189 px offset; the palette check now runs with `?tour=2`.
- V-5 non-fixture values (null dates, null blocks, p outside the one-in-N
  range, "insufficient", a 0.0 vol change): **fixed**, tolerant formatters and
  a guard per tile.
- V-6 the technicals price series (crossings a day or three off the served
  dates, NYSE holidays as sessions): **deferred to the Technicals commit**,
  which draws that series; the Overview reads only `chg_1d`.
- V-7 a day count off by one in the fixture: **fixed** (31).
- V-8 "Awaiting refresh" while loading: **fixed** (D14).
- V-9 spacing and glyph nits: **fixed** (subtitle gap, first-row offset,
  note spacing and wrap, ▶ caret, toggle and button widths, crumb color).
- V-10 "prove" in the gate prompt and black shadows: **fixed**.
- V-11 two broken references in the spec (§12.1 says `monitored` is "12.7
  compact", the position shape is §12.8; §1.1 cites "§8.3" for the gate
  text, which is §9): **recorded for the spec owner**, not edited (session A
  adds only PROPOSED fields to the spec).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; V-1 to V-8 and
V-10 confirmed fixed (colors sampled from the new shot). Its three nits:
- R2-1 the v2 reset `.dk p { margin: 0 }` out-ranked single-class margins, so
  some calibrated margins never applied: **fixed**, the reset now has zero
  specificity (`:where(...)`), and the sidebar, tiles and Monitored list were
  re-measured against the PNG (within 1–4 px); the note wraps only at its
  separators; the header's toggle and button match the PNG's width.
- R2-2 null `vol.band`, `since_signal`, `vix`, `up_pct`: **fixed**, each is
  guarded and its phrase left out.
- R2-3 the "Too few" pill for `insufficient` is not spec copy: **recorded**
  (D14), for the Ledger tab.

Gates at commit: typecheck clean; unit 105 files, 1,156 tests; build ok;
Desk browser tests 10 of 10.

### 2. Technicals — `frame-3: technicals`

Built: the Technicals tab on `/technicals`, `/vol`, `/sectors` and the
Ledger's S&P group: the vol column (three readings, the skew gauge, the
source line), the price card with its 6M / 1Y / 3Y range and the cross
callout, the Signals card with the in-regime note, seven sector bars (all
eleven under Advanced), the RSI card with its gauge and two matched notes.
New kit pieces: an SVG line chart (`kit/LineChart.tsx`), a band gauge
(`kit/Gauge.tsx`), ranked bars (`kit/RankBars.tsx`) and an Advanced panel
that says in one sentence what the API does not serve yet, so an expander
never opens onto nothing. Fixtures: `vol.json`, `sectors.json`, and
`technicals.json` regenerated (verifier V-6 from the Overview): the price
path now runs on NYSE sessions (exchange_calendars XNYS) and the 50/200-day
crossings fall exactly on 2025-04-14 (death) and 2025-07-01 (golden), with
the end values exact (6,412 · 6,280 · 5,910, +14.2% on the year, +0.4% on
the day). The path is shaped for the chart; the served statistics
(`move_20d_sigma`, RSI) are the fixture's scalars, not recomputed from it.

Compare: `docs/desk/screens/compare/02-technicals.png` (build alone:
`02-technicals.build.png`). Matched on the second pass (the first ran 89 px
tall; the Signals rows and the chart height were tightened). Deviations,
each deliberate:
- **Six signal rows, not five.** §12.10 says the rows are `/ledger` filtered
  to `group: "spx"`, which yields six (the S&P 20-day move is an S&P
  signal); the PNG draws five. The rows keep the Ledger's order (firing,
  then verdict, then served order: §12.4 names no third key).
- **The 50-day line and its number are green** (§3 names it green); the PNG
  draws them amber.
- **Gauge ends are amber, not red** (D12: red means down or negative only):
  Expensive, Overbought, and "last above 70".
- **The term-structure numbers are white**, not green: §1.3 gives green no
  job that fits them.
- **The skew gauge's label is §3's** ("SKEW · WHERE IT SITS"), not the PNG's
  longer one. The RSI notes are §3's two matched boxes (above 70 / below 30
  from the Ledger), not the PNG's "Past year" and "What it has meant" boxes,
  which need fields §12 does not have.
- **The y axis encloses the data in round thousands** (5,000 / 6,000 /
  7,000, as §3 lists); with the fixture's path the line sits in the middle
  band, where the mockup's hand-drawn line spans more of it.
- **A white dot marks the last price** (§3); the PNG has none. The cross
  marker shows when its date is in range (on 3Y, not on 1Y: the cross is
  Jul 2025, the 1Y view starts Sep 2025), where the mockup drew a crossing
  inside the 1Y window that its own dates contradict.
- **Bars are drawn as the PNGs draw them:** from the left, length ranked on
  the served value (lowest 22%, highest 78% of the track), color by §3's
  ±1% rule; the printed number carries the value.

PROPOSED (spec §12.13): the shared `reads` shape; `vs_ma50`/`vs_ma200`,
`rsi_direction`, `cross.in_regime`; `vol.skew_band_edges`, `vol.reads`;
`sectors.leadership[].short`, `sectors.reads`, the small-vs-large point
shape.

Verifier, round 1: **FAIL** (one blocking finding). Dispositions:
- T-1 (blocking) the `Advanced ▸` links rendered gray: the `.dk button`
  reset out-ranked `.dk-link`, the V-1 class of bug again. **Fixed** for the
  whole kit: the button reset has zero specificity (`:where`), links keep a
  scoped reset, `.dk .dk-link` wins both; the browser test checks the color.
- T-2 "Awaiting refresh" while loading: **fixed**, each card is quiet while
  its first answer is on its way and says "Awaiting refresh" only on an
  error or a missing block (D14).
- T-3 null or absent values (a §12.9 `/vol` without the PROPOSED reads, a
  null `cross`, `rsi_last_*`, `vs_ma*`, `up_pct`, `ma200`): **fixed**, each is
  guarded and its phrase left out; the chart's extent ignores non-finite
  points.
- T-4 "Apr 8, 2025" ran past its column: **fixed**, date stats print at 24 px.
- T-5 "+0.4% today" beside the sidebar's "S&P Sep 22": **fixed**, D13 applies
  ("+0.4% on Sep 22" until the session is New York's today).
- T-6 judgments in the browser: "no extreme move" and the RSI word now come
  from the Ledger's own signals (`spx-20d-2sigma`, `rsi-above-70`,
  `rsi-below-30`, `firing_now`); "too few to trust" is §1.5's 10-episode
  floor; the skew reading is amber when puts cost more than calls (a sign
  rule: demand for protection is §1.3's caution). Recorded.
- T-7 the averages tied at the fixture's precision on both cross dates:
  **fixed**, the crossings are decisive (≥ 0.2 point either side).
- T-8 the drawn path against the served scalars: **mostly fixed**. The path
  was searched (seeded) so the 20-session returns after Apr 8 2025 and Jun 12
  2026 are within 0.1 point of the served +9.4% and +1.1%, the last month is
  0.65σ (served 0.6σ), its RSI(14) ends at 56 (served 58) and never falls
  under 30 after Apr 8. One residual, recorded: its own RSI(14) is above 70
  again on Jul 9, Aug 17 to Sep 3 and Sep 14 to 16, 2026 (79.7 at the Sep 16
  high of 6,519, four sessions before the as-of), where the served "last
  above 70" is Jun 12. RSI is not drawn on this chart; the served number is
  the engine's.
- T-9 holidays in the sector series: **fixed**, 252 NYSE sessions ending
  Sep 22. The Ledger's "S&P 5-day move over 2σ, last fired Aug 2, 2026" is a
  Sunday; the fixture uses Friday Jul 31, 2026 (the Ledger PNG prints Aug 2).
- T-10 layout nits: the TREND line and the RSI caption now match; the bar
  names are the one four-letter `short` both PNGs need (this PNG spells
  "Indust", "Energy", "Health", "Staples"; the Sectors dots use "Ind",
  "Enrg", "Hlth", "Stpl"), and ticker and name sit in their own columns.
  The page is 1,067 px tall against 1,060. Recorded.
- T-11 the gauge caption near the ends and over the 30/70 ticks: **fixed**,
  the caption stays inside the track, a tick it would cover is left out, and
  unsorted band edges cannot give negative widths.
- T-12 code nits: **fixed** (death-cross marker red, the chart's label names
  the cross, month labels never repeat, right-end labels stay inside the
  plot, `quarterOf` and an unknown verdict are guarded, the RSI footer
  string, one accent table, `aria-controls` only while the panel is open, the
  skew gauge names its band).

Verifier, round 2: **FAIL** on one regression the round-1 fix introduced;
T-1, T-4, T-5, T-7, T-9, T-10, T-12 confirmed, T-6 accepted as recorded.
- R2-1 (blocking) the link reset's `:hover` rule out-ranked the light
  buttons' own color, so their text vanished on hover: **fixed**, the reset
  sets no hover color; the browser test hovers "Act on this" and checks it.
- R2-2 the back link rendered light where the PNG is gray (the `.dk a` reset
  out-ranked `.dk-back`): **fixed**, checked at rest and on hover.
- R2-3 the walkthrough strip's buttons took the app's weight and line
  height: **fixed** in the Desk rule.
- T-2 gap: a 200 answer without its block (`{"error": …}` from `/sectors`, a
  ledger without `signals`) threw: **fixed**, the block check is a boolean,
  and tests pin both the quiet loading state and the missing block.
- T-3 gap: a null `n` and a missing `normal_month`: **fixed**.
- T-8 wording: corrected above.
- T-11 gap: the caption's clamp now uses its measured width.

Gates at commit: see the gate summary at the end of this report.

### 3. Event Study — `frame-3: event-study`

Built: the Event Study on `/study` and `/study/events`: row 1 (the
three-way switch, the nine preset chips, saved questions under "Yours" with
Export / Import JSON in this browser per §1.8, the six labeled slots with
their two tooltips, Run and Save), the answer card (serif headline, the
firing and served-from-cache pills, four stats, the horizon bar chart with
the range whisker, its legend, the line without the condition), the rail
(verdict box with `Price it →` to Basket & Hedge in Express mode, by regime
with `n<5`, today's-regime note from `/overview`, last five events, the range
against normal at 80 / 90 / 95% re-asked with `confidence`, the served note,
`Advanced ▸` and `Export →`), the provenance line under the grid, and the
Advanced panel (all events, resampling detail, entry rules, provenance, and
the frame-2 engine's own tables for the same question). Fewer than 10
events renders one sentence and the two fixes (§1.7), which re-ask with a
wider window or no condition. The page's address is the question. The
header's "Act on this → Position Monitor" carries the preset
(`?from=<slug>`), which the walkthrough's step 3 reads. Fixtures:
`study.json` (§12.2's gold example, complete) and `study-events.json` (the
18 events, solved so every number the tab prints agrees: 12 of 18 up with a
+3.1% median at a month, the worst and best on their dates, each regime's
count, ups and median, and the 1-week, 2-week and 3-month up-shares and
medians). Frame-2's page components (the chart, the quartile chart, the
sentence builder, the badge, the results cards, the client-verdict words)
left with this commit; its engine adapter, slug grammar and formatters stay
and keep their tests.

Compare: `docs/desk/screens/compare/03-event-study.png` (build alone:
`03-event-study.build.png`). Matched on the second pass (the first ran 58 px
tall: the rail's section spacing; now 1,086 px against 1,080). Deviations,
each deliberate:
- **The event bars are blue** (§4: "after the event, blue"); the PNG draws
  them green. The whisker and the value labels take the bar's color.
- **The Advanced panel shows the frame-2 engine's parameters and tables in
  the v2 style and words,** not the frame-2 components as they were: those
  printed the engine's "established / not established" (banned by frame-3)
  and used app colors outside §1.3. The engine's per-horizon result is
  printed as the engine's own fact about zero ("clears zero on 10+ blocks,
  under 3% adverse", "clears zero, below that bar", "includes zero", "too
  few blocks to say"), never as a §1.5 pill: §1.5 verdicts come only from
  `/study`, so the panel cannot disagree with the rail (verifier E-1). The
  engine answers only questions it can ask (windows 5/20/60, the
  S&P-below-50-day or regime conditions, crosses of the target's own
  averages, the shocks and targets its asset list names); for any other the
  panel says so in one sentence, and a 422 or `not_stored` answer prints the
  engine's reason. A note above the tables says its sample and dates are the
  engine's own: in fixture mode the frame-2 engine fixture's events (Mar 23
  2023, Mar 1 2022, Apr 9 2020), sample (from Aug 30 2000) and as-of (Sep 18)
  differ from `/study`'s, because the two are different saved payloads; with
  one server they read one generation.
- **The line without the condition** judges the condition from the two
  served verdicts: better than without → "The condition earns its place." (§4's
  words); otherwise "The condition does not improve the read." (not in the
  spec).
- **The confidence chips show the served confidence as pressed.** The
  fixture carries 0.90 whatever is asked, so in fixture mode choosing 80%
  re-asks (the address and the request carry `confidence=0.8`) and the chips
  stay on 90%; against the API they follow its answer.
- **"My saved questions · 0"** where the PNG shows 3: saved questions live in
  the browser (§1.8) and the fixture browser has none.
- **The rail's heading reads "Last five events · S&P 500 a month later"**
  (the target's served label); §4 writes "S&P".
- **The confidence note is §12.2's served string.** §4 and the PNG add "—
  that is why this is Suggestive."; the page prints what the server says and
  adds nothing.
- **"Today is Overheating: six events, too few to read alone."** The "too
  few" clause uses §1.5's 10-episode floor on that regime's `n`; §4 shows
  the sentence without a rule.
- **Series names keep their served case** in running text ("Gold history
  from 2000", "— Gold +2σ on its own —"); §4 and the PNG write "gold".
  Lowercasing a served label turns "S&P 500" into "s&p 500" and "VIX" into
  "vix" (verifier E-7), so the page prints labels as served.
- **By regime and the last five events are "a month later"** whatever the
  horizon asked: §4's label is fixed and §12.2 serves `by_regime` and
  `last_events[].ret_20` at 20 sessions.

PROPOSED (spec §12.13): `verdict_line`, `what_to_do`, `series`, and §12.3's
events shape (JSON and CSV).

Verifier, round 1: **FAIL** (one blocking finding). Dispositions:
- E-1 (blocking) the Advanced panel's engine rows carried a §1.5 pill mapped
  from the engine's exclusion field ("included" → No edge) where the rail
  prints Suggestive for the same range, and this report called that mapping
  §1.5's rule, which it is not: **fixed**, the rows state the engine's fact
  about zero in words (above), and the unit test checks no pill is printed.
- E-2 the links between Event Study and Position Monitor: **fixed on this
  side**: "Act on this" and "Price it →" carry the question as the page's
  own parameters (`from=<preset>` for a preset, the six slots for a custom
  question), and the page reads a frame-2 `?study=<engine slug>` as the same
  six slots. Position Monitor (§9) is built later in this run and reads
  both.
- E-3 the rail was an empty card on an error and under 10 events: **fixed**,
  it keeps its four section labels with "Awaiting refresh" or "Not scored:
  too few events" (§1.7); a failed answer card keeps the asked horizon's
  labels ("Up a month later").
- E-4 without the PROPOSED `series` list: **fixed**, the Shock and Target
  slots are held and say the list is awaiting refresh; no hard-coded count
  remains; labels fall back to the key only where no list exists.
- E-5 state: **fixed**. Clicking the pressed preset puts the served
  question back; a confidence change keeps the edits; Run on an unchanged
  question refetches instead of pushing a duplicate history entry; "Widen
  the window" is offered only when a wider window exists.
- E-6 the previous answer under a new chip: **fixed**, it stays but dims and
  is marked busy (`aria-busy`) until the new answer lands; the slots show
  the address's own question while it is on its way or when it fails.
- E-7 wording: **fixed** (labels keep their served case, "crossing above
  its average on its own", "over a normal three months", `n<5` only when
  n < 5, "—" for a null value). The "too few to read alone" rule and the
  fixed "a month later" label are recorded above.
- E-8 deviations: recorded above (confidence note, engine sample); the bar
  chart fills its box (measured width and height, no 70 px gap). The
  Worst · best overflow was not fixed in round 1 (see R2-2).
- E-9 the engine panel for questions the engine cannot run: **fixed**, it
  checks the shock and target against the engine's asset list and prints a
  422 or `not_stored` reason; a missing forward return uses frame-2's
  `missingForwardWord`.
- E-10 accessibility and export: **fixed**. The ⓘ tips are focusable
  buttons whose text shows on focus; the chart's label carries each
  horizon's median against normal; the download's object URL is revoked a
  second after the click; an answer under 100 ms reads in milliseconds.
- E-11 the language scanner skips only literal operands of `===`/`!==`, so
  printed text inside a comparison is scanned; `format.ts` lost
  `sampleLine` and `eventsBehind` (see R2-6 for the rest).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; E-1, E-3 to
E-7, E-9 to E-11 and the links confirmed. Dispositions:
- R2-1 (a regression from the E-5 fix) the slots went blank when a preset
  whose answer was still cached resolved to the question already shown:
  **fixed**, a new address fills the slots from a served answer that is
  already here; a unit test with the app's cache times fails without the
  fix.
- R2-2 the Worst · best value still ran 7.5 px past its column (the "date"
  stat size is the same 24 px): **fixed**, it prints at 20 px (the PNG's
  size) and wraps at " / "; measured inside the card's content edge at
  1440, 1300, 1200 and 1110 px wide (one line at 1440).
- R2-3 an old engine link at another z or for one regime opened the 2σ,
  all-regime question: **fixed**, such a link is not read as the six slots,
  and the page says it opened the default question instead.
- R2-4 the served label's case: recorded above.
- R2-5 the engine refusal names the series by their served labels.
- R2-6 `unitWord` and `fmtTick` removed; `fmtShare` and `fmtBound` stay,
  pinned by the Python-parity test (`pyformat.test.ts`).
- R2-7 the report now says 100 ms, as the code does.
- R2-8 when neither fix applies, one sentence replaces the empty group.
- R2-9 the placeholder keeps "vs" lowercase.
- R2-10 Export is off while a new answer is on its way, so it cannot save
  one question's events under another's name.

## Gate log

Each commit ran all four gates on the tree as committed: `tsc -b --noEmit`,
`vitest run` (the whole web suite), `npm run build`, and the Desk browser
tests against the fixture dev server.

| Commit | Typecheck | Unit (files / tests) | Build | Desk browser |
|---|---|---|---|---|
| frame-3: overview | clean | 105 / 1,156 | ok | 10 / 10 |
| frame-3: technicals | clean | 106 / 1,171 | ok | 13 / 13 |
| frame-3: event-study | clean | 106 / 1,176 | ok | 16 / 16 |
