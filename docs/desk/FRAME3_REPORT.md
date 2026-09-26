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
- **D2. Unbuilt tabs showed a one-line placeholder** until their commit (the
  last one went with Basket & Hedge); the
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

### 4. Regime — `frame-3: regime`

Built: the Regime tab on `/regime` (§5, §12.5), a symmetric 2×2 with no
action button and the `● Live · Aug print · Sep 22` badge. **Where we are**:
the amber serif label, the sentence spelled from `current` ("Growth rising
and inflation rising. Third month in a row."), GROWTH / INFLATION / IN THIS
REGIME, the last-five-years strip from `history` (one segment per run, ticks
2021…2025 and `today`), the key, the "How it's decided" box. **Recession
probability** (labelled as the logistic model): the number, its band word and
one-in-N phrase, the Low / Watch / Elevated gauge with the names under the
track, INPUTS THROUGH / A YEAR AGO / PEAK LAST CYCLE, the "What it is" box.
**What each regime has meant**: the §5 table with the current regime's row
bold, the amber read. **What would change it**: NEXT CPI / NEXT INDPRO with
the flip sentence spelled from the served threshold and target regime, the
last five changes with the S&P a month later, the read. Each card keeps its
labels and says "Awaiting refresh" on a failed or absent block, block by
block; its Advanced footer names what is not served yet. Fixture:
`regime.json` (§12.5, complete). Its 68 months of history (Jan 2021 to Aug
2026) were built from the served list of the last five changes, so the strip
agrees with the list; the PNG's own strip does not (its last Overheating run
is about seven months against "Jun 2026"), so the segment proportions differ
from the drawing on purpose.

Compare: `docs/desk/screens/compare/04-regime.png` (build alone:
`04-regime.build.png`). Matched on the second pass. The first ran 1,059 px
against 960: stat values at the kit's 27 px, the recession gauge's track at
8 px against the PNG's 14, and the reads on a 21 px line where the PNG sets
13.5 px type on a 17 px line (the lower-right read took four lines against
three). Measured and set per card; now 967 px. Deviations, each deliberate:
- **Stagflation is red in the key, the strip and the table** (§5 names it
  red; the PNG draws it gray; D12).
- **The amber read's "positive" is not colored.** The PNG sets the word in
  amber; the served read is plain text (the shared `reads` shape has no
  emphasis), and the page does not pick words to color.
- **The lower-right footer reads "all regime changes since 1996"** where the
  PNG writes "all 34 changes": §12.5 serves the last five changes and no
  count.
- **The two model sentences are §5's own words** ("No model, no fitting.",
  "a fitted model — five monthly indicators …"). The Desk's language test
  bans "model" outside the recession model; it now allows those two
  sentences, quoted from §5, on this page only.
- **No MOCKUP badge** (as on every tab).
- **Colors the page chooses to follow the PNG, for Max to accept:** a NEXT
  date takes the color of the regime it would flip to, with red read as
  caution (amber: "Oct 17" → Stagflation is amber, as in the PNG) and gray
  as none; GROWTH rising is green and falling red, INFLATION rising amber
  and falling green; the STOCK–BOND column is green below zero (bonds hedge)
  and amber above (they do not), as §6 reads the sign; zero is plain. Green
  here means "favorable", the PNG's sense, which is wider than §1.3's list
  for green (up · Reliable · firing · current); making the falling-inflation
  and negative stock–bond cells plain is the alternative.
- **VIX AVG 24 and 29 are plain,** where the PNG sets them in amber: nothing
  served says which averages are high, and the page does not set a
  threshold.

PROPOSED (spec §12.13): `recession.band`, `recession.band_edges`, `reads`
(`stats`, `changes`, `year_ago`), and `generation_id` on the response.

Verifier, round 1: **FAIL** (two blocking findings). Dispositions:
- G-1 (blocking) an absent block lost its labels: the Recession body went
  blank without `recession`, the strip hid inside `current`, null trends
  printed "Growth and inflation .", and the lower cards dropped their labels
  on a failed answer. **Fixed**: each block decides for itself (present →
  shown; absent and not loading → its labels with "Awaiting refresh"), the
  strip stands on `history` alone, and a unit test covers each absent block,
  null trends, a null probability, and the loading state (busy, no
  "Awaiting refresh", D14).
- G-2 (blocking) the flip sentence assumed a rising trend: **fixed**. A
  rising trend flips on a print below the threshold ("a soft print
  (<0.2% m/m)", "a negative print"), a falling one on a print above it ("a
  hot print (>0.4% m/m)", "a positive print"); the threshold prints to the
  served precision (0.0015 → 0.15%); no threshold or no trend → the stat
  says Awaiting refresh. The test that pinned the wrong text is corrected.
- G-3 card names ran title and subtitle together: **fixed** ("Where we are
  rule-based · two-month lag"), pinned by an exact-name test.
- G-4 the table: **fixed**, the header rule is back (only the body's last
  row drops its rule) and the columns end at the PNG's right edges (fixed
  layout, widths as shares of the table, a 6 px gutter so cells never touch
  at narrow widths).
- G-5 colors: "Oct 17" is amber, the rule and the stock–bond and trend rules
  are recorded above, VIX stays plain (recorded); "Watch" is centered under
  its band as in the PNG.
- G-6 tests: added (states, falling and null flips, bands from
  `band_edges`, a null band word, strip tones, widths and ticks, a moved
  current row, exact names).
- G-7 the strip's Recession Risk segment is the key's gray.
- G-8 the trend colors follow the trend (above).
- G-9 the gauge rules with no consumer are removed.
- G-10 recorded above; "Overheating" is 38.5 px, the PNG's size.
- G-11 the stylesheet is one set of rules.

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; G-1 to G-11
confirmed (the table's columns within 5 px of the PNG's, "Overheating"
within 3 px, Technicals pixel-identical to its committed shot). Dispositions:
- R-1 a null `flips_to` printed "→ null": **fixed**, the stat says Awaiting
  refresh; tested.
- R-2 `current` without its `label` hid the headline silently: **fixed**,
  "Awaiting refresh · the regime label"; tested.
- R-3 the fixed table layout wrapped names at 1100 and 390: **fixed**, the
  columns size to their contents below 1300 px and a regime name never
  wraps; no sideways scroll at 1440, 1100 or 390.
- R-4 the color wording: reworded above as a choice that follows the PNG.
- R-5 a threshold under 0.005% printed "<0%": **fixed**, more digits until
  one shows; tested.
- R-6 the 12% took the label's tighter line and lifted the recession stats
  8 px: **fixed**, with the band names and the stats set to the PNG's
  spacing (every row of that card within 1.5 px).

### 5. Macro & Correlations — `frame-3: macro`

Built: the Macro & Correlations tab on `/macro` (§6, §12.6), a 2×2 with no
action button and the `● Live · FRED / Yahoo · Sep 22` badge. **Yield
curve**: 10-YEAR / 2s10s / FRONT END, today's curve (blue, with the tenor
values) against a month ago (gray dashed) on 3m…30y, both labelled at the
right end, the read. **Do bonds still hedge stocks?**: TODAY / A YEAR AGO /
FLIPPED, the year of the 60-day correlation between the amber "with" band
and the green "against" band, the amber read. **Credit**: HY SPREAD /
3-YEAR RANGE / INVESTMENT GRADE, the Tight / Normal / Wide gauge with the
percentile on the names' row at the needle, the last twelve months (blue, §1.3's main
line) with the peak labelled, the read. **What moves with the S&P**: the against / with
header, six rows (name, centered bar green left and amber right, value,
served meaning), the read, and the 12-asset matrix under Advanced (plain
numbers, a focusable region). Each block, and each value inside it, keeps
its label and says "Awaiting refresh" when it is not served. Fixture:
`macro.json` (§12.6, complete; 252-session series ending Sep 22 2026; the
matrix a valid correlation matrix whose S&P row is the six correlations).

Compare: `docs/desk/screens/compare/05-macro-correlations.png` (build alone:
`05-macro-correlations.build.png`). Matched on the second pass. The first
ran 1,102 px against 1,060: the kit's 27 px stat values, 14 px notes and a
19.6 px read line, the 8 px gauge with its caption on a row of its own, and
charts 200 / 170 / 112 px tall. Set to the PNG's measures (the same stat
and read sizes as Regime, the names-under gauge now a kit rule with the
caption on the names' row, charts 148 / 132 / 100 px, correlation rows 27 px
with the PNG's columns). After review the grid's two rows are equal and as
tall as their content (they had stretched to the viewport): cards 389 px
against the PNG's 393.5, the lower edge within 1 px. Regime is
pixel-identical after both changes. Deviations, each deliberate:
- **Everything sits 7.5 px lower than in this PNG,** whose header rule is at
  41 px; every other PNG and the shared shell put it at 47.
- **The colors follow §1.3's jobs where the PNG gives an accent a second
  job (D12):** the credit line is blue (the chart's main line; the PNG draws
  it amber), the FRONT END value and the HY and IG values are plain (the PNG
  sets them blue and green), A YEAR AGO's −0.24 is plain (green in the PNG).
  TODAY is amber when the served `hedging` is false (§6 names the amber);
  2s10s is green or red by the month's served change (§1.3 up / down).
- **The credit gauge's track is 11 px** (this PNG) where Regime's is 14.
- **The lower-right card holds its own read and footer.** In the PNG the
  correlations card ends after the six rows and its read and `Advanced ▸`
  spill below the grid (the read as a loose box, the footer under the Credit
  card); §1's card skeleton and §6's 2×2 put them inside the card. The PNG's
  stray "−0.31 bonds partly offset" line under the Treasury row is not a
  §6 row and is not built.
- **The two curves are labelled at their right ends** (§6), where the PNG
  draws a legend under the chart.
- **Every correlation bar is green left of zero and amber right** (§6), where
  the PNG grays the three weak ones; the served meaning ("weak", "no
  relationship") says it.
- **The credit peak reads "Mar peak · 4.6%"**, not §6's "Mar scare": nothing
  served names the episode, and the page does not name market events.
- **"positive" in the amber read is not colored** (as on Regime).
- **The page spells only the 2s10s direction** ("steepening", "flattening"
  or "unchanged", from the served change) and "unchanged on the month" for a
  zero 10-year change; the stock–bond notes and whether bonds hedge are
  served (PROPOSED).
- The gauge rules the Regime review removed as unused (G-9) are back in the
  kit with their consumer, the credit gauge.

PROPOSED (spec §12.13): `credit.band_edges`, `credit.words`,
`stock_bond.hedging`, `stock_bond.words`, `matrix.labels`, `reads`, and
`generation_id`; also noted there: `flipped: null`, nulls inside blocks, the
asset label and matrix order, the example peak date.

Verifier, round 1: **FAIL** (two blocking findings). Dispositions:
- M-1 (blocking) the curve's y labels printed a 0.25 step at one decimal
  (3.75 read "3.8%"): **fixed**, ticks on a 1 / 2 / 5 step carry the
  decimals their step needs (3.8 … 4.8 at 0.2; credit 3 / 4 / 5); a unit
  test checks every label against its value.
- M-2 (blocking) a null value inside a block dropped a row, the gauge or a
  chart silently, or printed a zero never served ("0.0 – 5.9%", "Mar peak ·
  0.0%"): **fixed**, each value is guarded; a null correlation keeps its row
  with "Awaiting refresh", a missing gauge or chart says so under its label;
  tested.
- M-3 zero and sign wording: **fixed** ("unchanged on the month", "unchanged
  · 0 bp", served bp with their decimals); the stock–bond sentences are
  served now (M-4).
- M-4 judgments in the browser: **fixed** with PROPOSED `stock_bond.hedging`
  and `stock_bond.words`; the credit colors no longer match served words.
- M-5 the chart's band and peak labels lost their colors to the class fill:
  **fixed** in the kit (a passed color is a style); tested.
- M-6 the caption overprinted band names: **fixed**, a name the caption
  would touch is left out, and the gauge's accessible name carries the
  served word ("…18th percentile of three years, tight"); at 390 px "Tight"
  gives way to "18th pct".
- M-7 the cards stretched to the viewport: **fixed** (equal rows as tall as
  their content, here and on Regime); the header offset and the 11 px track
  are recorded above.
- M-8 color jobs: **fixed** to §1.3, recorded above.
- M-9 the matrix: a focusable, named region with the assets' names
  (PROPOSED `matrix.labels`) and an empty corner cell.
- M-10 a card's read printed under an absent block: **fixed**; tested.
- M-11 the fixture: **fixed** (Mar 10 is the year's peak; the matrix is
  valid and ordered as §12.6 begins); the label and order notes are in
  §12.13.
- M-12: `flipped: null` defined (§12.13); the chart's name drops a missing
  date; one null no longer blanks a card; the types admit nulls; the curve's
  value labels are placed clear of the lines (round 2, N-4).
- M-13 tests: added (Macro now 19 unit tests and one browser test).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; M-1 to M-13
confirmed, no regression (Regime, Technicals and Event Study
pixel-identical to their committed shots). Dispositions:
- N-1 the gauge's caption and the hidden name did not follow a resize:
  **fixed** in the kit (the track's width is observed); the browser test
  resizes 1440 → 390 → 1440 and checks the caption over the needle and the
  name hidden, then shown. The caption part also serves Technicals.
- N-2 the accessible name did not carry the hidden band: **fixed** (the
  served word is appended).
- N-3 a flat series printed six decimals: **fixed**, one round unit either
  side and at most four decimals; tested.
- N-4 value labels still met today's own line: **fixed** in the chart kit:
  a label marked `avoid` takes the nearest place above or below its point
  where no line and no other label crosses it (tested; checked at 1440 and
  390).
- N-5 the list's read printed over six unserved rows, and the chart's name
  said "against a month ago" without that line: **fixed**; tested.
- N-6 a malformed `flipped` is not served (Awaiting refresh); tested.
- N-7 tests added: TODAY amber from the served call, 2s10s up and down,
  flat ticks, label placement, and the browser test (equal rows at 960 and
  1500 tall, the band name and the caption across a resize).

### 6. Sectors — `frame-3: sectors`

Built: the Sectors tab on `/sectors` (§7, §12.7), two columns, no action
button, the `● Live · Yahoo · Sep 22` badge. **Sector leadership**: LEADING /
LAGGING / PATTERN, the eleven ranked bars (ticker, name, bar, value; §3's
±1% colors), the key, the read. **Breadth**: ABOVE 50-DAY / ABOVE 200-DAY /
EQUAL vs CAP WEIGHT, the average stock against the index over a year, the
two rows of dots (which sectors are above their 50-day and 200-day), small
caps against large, the amber read with §7's gray note. Until the sector
ETFs are ingested (§12.7's `series not ingested`) both cards keep their
labels and say why. Every value keeps its label and says "Awaiting refresh"
when it is not served (the Regime and Macro reviews' lessons, applied before
review). Fixture: `sectors.json` (§12.7, complete; the two series are the
last 252 NYSE sessions).

Compare: `docs/desk/screens/compare/06-sectors.png` (build alone:
`06-sectors.build.png`). Matched on the second pass. The first ran 951 px
against 900: the dots printed their screen-reader words ("above", "below")
because the visually-hidden rule lived only in the Event Study's
stylesheet (now in the kit), and the stats and reads used the kit's sizes
where this PNG uses Regime's and Macro's (23 px values, 12.5 px notes, reads
on a 17 px line). Now 900 px; the cards run 113 → 876 against the PNG's
111.5 → 881. Event Study is pixel-identical after the rule moved.
Deviations, each deliberate:
- **ABOVE 50-DAY's note reads "was 10 a month ago"**, where §7 and the PNG
  write "was 10 in July": §12.7 serves the count a month earlier, not a
  month's name. The longer note wraps to a second line.
- **The pattern note, the 200-day note and the equal-weight note are
  served** (PROPOSED `words`), and ABOVE 200-DAY's green is the served
  `broad` call; ABOVE 50-DAY is amber when fewer sectors are above than a
  month ago (§7's "narrowing"), green when more (§1.3 up).
- **The ranked values keep §7's ±1% key** (green ahead, gray within,
  red behind), as the Technicals PNG draws them; this PNG colors +0.4% and
  −0.6% by sign. LAGGING's note is red when negative (§1.3) while its name
  follows the key, so a laggard within 1% has a plain name and a red note.
- **The second chart keeps §7's tinted bands** ("same y, bands") where the
  PNG leaves it untinted with its lower label under the plot; it has no
  date row, as in the PNG. The charts' right ends name the served day
  ("Sep 22"), not "today" (D13); Macro's two charts now do the same, and its
  compare shot is regenerated.
- **No MOCKUP badge** (as on every tab).

PROPOSED (spec §12.13): `words`, `breadth.above_200.broad`; the existing
`leadership[].short`, `reads` and the series point shape; notes on nulls and
the not-ingested answer, the served order, what the series' `rel` is, and
`generation_id`.

Verifier, round 1: **PASS WITH FINDINGS**, nothing blocking. Dispositions:
- S-1 sideways scroll at 390, 360 and 1001–1100 px: **fixed**, stat labels
  wrap here and a chart band label too long for a narrow plot wraps at its
  " · " (kit); a browser test checks 1100 and 390.
- S-2 the cards stretched to the window: **fixed** (no flex stretch); the
  browser test checks a 1600 px tall window.
- S-3 a missing `leadership` hid served breadth: **fixed**, any answer
  without `error` is served and each card judges its own block; the dots
  fall back to the map's keys; tested.
- S-4 the browser picked the leader around a null: **fixed**, the served
  order is kept (first row leads, last lags, a null says Awaiting refresh
  in place); Technicals' "all eleven" under Advanced keeps a null row too;
  tested.
- S-5 "today" for a Sep 22 value: **fixed** with D13's rule in the kit
  (`endDay`), here and on Macro.
- S-6 the equal-weight window: **fixed**, always "3 months"; tested.
- S-7 an unserved dot looked like "below": **fixed**, an unlit ring; tested.
- S-8 layout: **fixed** where it moved the page: the stats 4 px up, the
  ranked rows and the key to the PNG's rows (within 2 px), the name column
  to the PNG's track start, the first chart's gaps and plot (round 2), the
  dots' spacing and span, "vs" lowercase. Recorded: the
  value colors (above), the second chart's tint, the 50-day note's wrap.
  The cards run 113 → 877 against the PNG's 111.5 → 881.
- S-9 ABOVE 50-DAY green when rising: recorded (§1.3 up).
- S-10 recorded above.
- S-11 the gray note stays without the read; tested.
- S-12 the types admit nulls; §12.13 adds `generation_id` and what `rel` is.
- S-13 the second dot list is named "Which sectors are above their
  200-day"; under 600 px the sector names are hidden visually, not from
  screen readers.
- S-14 the wrong date: corrected above.
- S-15 tests added (Sectors now 16 unit tests, and the browser test).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; S-1 to S-15
confirmed (no sideways scroll on any Desk tab at 1440 to 360 px; the stats,
rows and key within 1 px; Technicals, Event Study and Regime
pixel-identical; Macro differs only in its two end captions). Dispositions:
- R2-1 the dot rows crowded their labels: **fixed**, the PNG's 9 px gap with
  the totals unchanged.
- R2-2 under 600 px a null row's words squeezed into the value column:
  **fixed**, they take the name's place.
- R2-3 the first chart's plot was 99 px against about 105.5: **fixed**
  (7 px taller); the report's "within 1 px" claim is withdrawn.
- R2-4 the page ran 1 px past 900: **fixed** (the ranked rows are 43.2 px).
- R2-5 at 390 px the line crosses the wrapped band labels on the short
  small-caps chart: recorded; the labels stay readable.
- R2-6 tests for `endDay` and the band-label wrap: added.
- R2-7 the spec names the green too.

### 7. Signal Ledger — `frame-3: signal-ledger`

Built: the Signal Ledger on `/signal-ledger` (§8, §12.4): no action button,
the `● Live · engine as of Sep 22` badge; the four stats (SIGNALS SCORED
with "since 1990 where history allows", FIRING NOW and RELIABLE with their
short names, NO EDGE); the five filter chips; one table with fixed columns
in two groups (FIRING NOW, green-tinted, then QUIET · SORTED BY VERDICT:
Reliable, Suggestive, No edge, served order within a verdict, §12.4 making
the sort the client's); the verdict pill and `● Firing` / `○ Quiet`; the
three verdict definitions and the note in the footer. A row opens its study
in Event Study (`?preset=<slug>`), by click, Enter or Space; against the
fixtures only the gold study answers, so the other rows land on Event
Study's "Awaiting refresh" (§12.13 records the six slugs `/study` must add).
The table keeps its columns at every width and scrolls inside its own named
region below 960 px. Fixture: `ledger.json` (§12.4, complete).

Compare: `docs/desk/screens/compare/07-signal-ledger.png` (build alone:
`07-signal-ledger.build.png`). Matched on the second pass. The first ran
927 px against 880: the stats at the kit's sizes (this PNG uses 23 px values
and 12.5 px notes, as Regime to Sectors do), 11 px more under the chips and
3 px more in the header. Every row now sits within 2 px of the PNG; the page
is 901 px, the difference being the definitions' third line (below).
Deviations, each deliberate:
- **The verdict definitions keep the kit's one wording** (the Overview's):
  "the edge survives resampling: 10+ independent episodes and fewer than 3%
  of resamples go the other way", where this PNG writes the shorter "10+
  independent episodes, fewer than 3% of resamples go the other way". §8
  asks for "the three verdict definitions"; one wording on every tab is
  worth the extra line (16 px).
- **S&P 5-day move over 2σ last fired Jul 31, 2026** where the PNG prints
  Aug 2 (a Sunday; T-9).
- **FIRING NOW and RELIABLE are green only when their count is above
  zero.**
- **Negative medians and "vs normal" values are red** (§1.3, D12); the PNG
  sets them amber.
- **The Ledger keeps the served order inside the firing group** (as the
  PNG: 2s10s, then the dollar), where Technicals' signal list sorts firing
  rows by verdict; §12.4 says only "firing first, then verdict order".
  One shared order is a follow-up.
- **No MOCKUP badge** (as on every tab).

PROPOSED (spec §12.13): `signals[].short` (and on the Overview's rows);
notes on null cells, on what the stats count, and that every ledger slug is
a study preset.

Verifier, round 1: **PASS WITH FINDINGS**, nothing blocking (the twelve rows
match §8, vs normal is median − 1.3 on every row, every Reliable has n ≥ 10,
every date is an NYSE session). Dispositions:
- L-1 names were cut below about 1280 px: **fixed**, the table keeps a
  960 px floor and scrolls in its own region; a browser test checks 1101,
  1200 and 390.
- L-2 half the rows open studies §12.2 cannot answer: recorded above and as
  PROPOSED in §12.13 (with the RSI note for B).
- L-3 an unknown verdict drew an empty pill: **fixed** ("—"); tested.
- L-4 the columns sat left of the PNG's: **fixed**, the PNG's pitches, no
  right padding, the VERDICT header and pill right-aligned, top-aligned
  headers; every column's right edge now equals the PNG's (818, 900, 1002,
  1094, 1195, 1308, 1400) and every row sits within 2 px.
- L-5 the chips: **fixed** (12.5 px, 10 px padding, the card's own shade,
  the secondary text color); within 3 px of the PNG's widths.
- L-6 the note: **fixed** (top-aligned, 280 px, "normal month +1.3%" kept
  together).
- L-7 the firing tint: **fixed**, §1.3's Reliable tint, kept on hover; LAST
  FIRED in the tertiary gray.
- L-8 a missing `as_of`: **fixed**, the badge and the note's date are left
  out; tested.
- L-9 names fall back to the slug, an unknown firing state prints "—", no
  "since the start" or "not served" phrases. The shared row type still
  declares the five values non-null (Overview and Technicals read it); the
  Ledger guards them at run time.
- L-10 the chips wait for the table and the card is busy while loading.
- L-11 only the table scrolls, inside a focusable named region with a ring.
- L-12 recorded above (the order) and in §12.13's notes (the 2s10s verdict
  is served, as the mockup has it).
- L-13 tests added (Ledger now 14 unit tests and one browser test).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; L-1 to L-13
confirmed (column edges exactly the PNG's, rows within about 1 px, no name
cut from 360 to 1440). Dispositions:
- R2-1 (a regression from L-11) the scroll region clipped the rows' focus
  ring to its top and bottom lines: **fixed**, rows inside the region draw
  their ring inside.
- R2-2 the note broke before a separator: **fixed**, a line breaks only
  after one.
- R2-3 disabled chips kept the pointer and the hover border: **fixed**.
- R2-4 no sub-line without a served sample start; the region's ring sits
  inside it (clear of the chips); the region is a Tab stop only while it
  scrolls; an inherited key is not a verdict.
- R2-5 the page height above is corrected.
- Overview's compare shot is regenerated with this commit: its only change
  is the sidebar's "← Macro Regime Radar" link, gray since the Technicals
  review's R2-2 (the PNG's color).

### 8. Position Monitor — `frame-3: position-monitor`

Built: the Position Monitor on `/position-monitor` (§9, §12.8), desk-only
(no Client toggle), two columns. **Promote to position**: the subtitle
names the study carried in from Event Study (`?from=<preset>` or the six
slots), which fills the instrument with the study's target and the horizon,
nothing else; INSTRUMENT, DIRECTION, SIZE · % NAV, HORIZON. **Discipline
gate**: the progress line, VARIANT VIEW and PRE-MORTEM (empty), WRONG IF
with three levels suggested from the served S&P averages and eight more,
or your own; the WORDING check, where only the five certainty words block,
each with two one-click replacements; Save, off until the gate is complete,
naming what is left. Save posts to `/positions`; the fixture server applies
the same rules and keeps posted positions for the session. **Monitored**:
the Overview's rows sorted by room left; a row opens to FALSIFIES AT, SIZE ·
HORIZON, the gate text and the two links, and `?open=<id>` opens one; the
footer; **Closed · last 90d**. Frame-2's page, its local store, its gate and
seals, and its series reader leave with this commit (and their styles in
`desk.css`). Fixture: `positions.json` (three positions as the mockup has
them, every gate text a `TODO(Max)` marker).

Compare: `docs/desk/screens/compare/08-position-monitor.png` (build alone:
`08-position-monitor.build.png`), shot carried in from the gold study as the
PNG is. Matched on the second pass: the first drew the three selects as
small native controls, because their style lived only in the Event Study's
stylesheet (now the kit's `.dk-select`, Event Study pixel-identical). Now
1,040 px as the PNG. Deviations, each deliberate:
- **The gate fields ship empty** (§9 and the owner's rule), so the page
  shows "Three things left" and three open circles where the PNG shows its
  illustrative answers.
- **DIRECTION and HORIZON are dropdowns,** as the PNG draws them; §9's text
  says "Long / Short segmented" and "HORIZON chips".
- **The monitored rows take the Overview's two lines** (D4); the PNG's
  one-line rows overlap their own text.
- **Everything sits about 14 px lower in the PNG,** whose top bar is 55 px
  tall against the shell's 47 (as Macro's PNG differs the other way).
- **The suggested level keeps the served case**, "(Gold gives back its
  move)", where the PNG writes "gold" (as on Event Study).
- **The subtitle spells the carried question in the Event Study's words**
  ("… → S&P 500 over the next 1 month"), where §9 writes "Gold ≥ +2σ (20d)
  AND SPX below 50d MA · 20 trading days".
- **The suggested levels follow the direction:** §9 lists a long's; a short
  gets their mirror (a rally proves a short wrong), and the signal's own
  reversal is offered only when a study was carried in.
- **The first "Use …" button and a pressed level are green-filled,** as the
  PNG draws them (an action, a second job for green; D12 would make them
  neutral).
- **No MOCKUP badge** (as on every tab).

PROPOSED (spec §12.13): the `/positions` envelope, the `falsifies_at` and
`now` shapes, the POST body and its 201 answer, the `wrong_if` ids; notes
on how a study is carried in and on null row values.

Verifier, round 1: **FAIL** (three blocking findings). Dispositions:
- P-1 (blocking) a saved position showed numbers the fixture made up (0%
  NAV, 100% room, 0% to level): **fixed**, the fixture replies null for what
  it does not measure, and the row types admit it (§12.13).
- P-2 (blocking) a null `to_level` crashed the tab and a null room or size
  printed 0%: **fixed** in the kit's rows (Overview too): "—", an empty
  bar, nulls sorted last, the house minus; tested.
- P-3 (blocking) refusals rendered green: **fixed**, the status carries its
  own tone (a refusal amber, a save plain); tested.
- P-4 the suggestions ignored direction: **fixed** (recorded above).
- P-5 a pair or a stray "es" matched the S&P: **fixed**; tested.
- P-6 an unanswerable carried study vanished: **fixed**, the subtitle says it
  is awaiting refresh and `study_slug` is only the served study's; tested.
- P-7 refusal wording: **fixed** (the gate's own words, an empty list, no
  answer at all); tested.
- P-8 a size like "4%" posted null: **fixed**, "4%" reads as 4 and anything
  else keeps Save off with a sentence; tested.
- P-9 the room words ran under the bar: **fixed**, the bar has its own line
  in this column, and the kit's narrow-row rule now comes after the base
  rules so it applies (Overview at phone width too).
- P-10 cards stretched in a tall window: **fixed** above 1100 px tall; the
  browser test checks 2400 px.
- P-11 the deployed share counted a missing size as 0: **fixed**, printed
  only when every row has a size; tested.
- P-12 the `wrong_if` ids are in §12.13.
- P-13 a typed level stayed beside a picked one: **fixed**; tested.
- P-14 focus fell to the page after a save: **fixed**, the status line takes
  it.
- Nits: a replacement keeps a leading capital, the quote keeps punctuation
  against its word, counts are words ("fix two words above"), unfinished
  steps are all amber, the signal chip needs a carried study, the Closed
  strip keeps its label while loading and a malformed count prints "—", a
  200 without positions says Awaiting refresh, the progress line's ignored
  `aria-label` is gone, the house minus in levels, the "More levels" select
  is wide enough for its label.
- Tests: Position Monitor now 20 unit tests and one browser test (flagged
  and expanded states in the palette, 1100 and 390 px, a tall window).
- Overview's compare shot is regenerated: its rows' "·" moved inside the
  dimmed span (a sub-pixel change).

Verifier, round 2: **FAIL** (one blocking finding); P-1 to P-14 confirmed
apart from the network wording. Dispositions:
- R2-1 (blocking) a picked level outlived a change of instrument or
  direction: the S&P's "(6,280)" label was saved for TLT, and a long's level
  kept the gate complete for a short. **Fixed**: the draft keeps only the
  level's id, its label is read from the current suggestions at render and
  at save, and an id they no longer offer is dropped, so the gate reopens;
  tested for both changes.
- R2-2 a bad size was appended outside the count ("One thing left: …; and
  enter the size"): **fixed**, the size is one of the gate's items.
- R2-3 a failed request still read "did not accept": **fixed**, status 0
  (how the client reports no answer) reads "did not answer"; tested.
- R2-4 the wrong-if column broke between 1101 and 1200 px: **fixed**, the
  select and the typed level stack below 1250 px and a long level wraps
  inside its pill; the browser test checks 1200, 1101, 1100 and 390.
- Nits: a size is a plain decimal from 0 to 100; the fixture's saved row
  keeps its opening day (today, day 1) and leaves what it would measure
  null.

Verifier, round 3: **PASS WITH FINDINGS**, R2-1 to R2-4 confirmed with no
regression. Nits, all **fixed**: the select and the typed level stack up to
1340 px so the typed box stays readable (checked at 1300 too); ".5" and "4."
are sizes; the R2-1 test's name says what it asserts and checks that
switching back brings nothing back.

### 9. Data Pipeline — `frame-3: data-pipeline`

Built: the Data Pipeline on `/data-pipeline` (§11, §12.11), no Client
toggle; the top bar carries `● Last full refresh Sep 22, 00:23 UTC ·
validation passed` from `/pipeline` (amber when validation did not pass).
The title "Where every number comes from" with its line; the lineage strip
(§11's six steps, fixed copy, the last one green); the **series inventory**
read from `/pipeline`: 26 series in five groups, each a button that opens
its table (SERIES / ID / FROM / AS OF / FEEDS / STATUS) in a region that
scrolls inside the group, `?group=` opening one from a link, and a search
that jumps to a series by name, id or note and opens its group (or says
nothing matches); the **Snowflake bridge**: the board's three-layer schema,
its note, "Export current study → CSV" (§12.3's events for the last study
Event Study answered in this browser, else the gold preset) and "Generate
Snowflake DDL" (`/pipeline/ddl`, saved as a .sql file). Frame-2's pipeline
page (its lineage, inventory grouping and schema parser), the status badge
and its sources, the page head and the frame-2 UI helpers retire with this
commit. Fixtures: `pipeline.json` (§12.11 plus the PROPOSED group fields;
26 series) and `pipeline-ddl.ts` (the DDL text).

Compare: `docs/desk/screens/compare/10-data-pipeline.png` (build alone:
`10-data-pipeline.build.png`), shot with Credit open as the PNG has it.
Matched on the second pass: the first set the title at the kit's size on
one line with its subtitle and cut the table's STATUS column; now the
title is the PNG's 36 px over its line and the table fits. Deviations:
- **The schema block quotes the board, "never" included** ("never edited",
  "never patched"): the frame-2 ban list flags "never", and the Desk's
  language test and browser scan allow exactly those two lines (anchored),
  in the block marked as board copy, and nothing else in it.
- **No group is open by default;** the PNG shows Credit open. A link opens
  one (`?group=credit`), as a search does.
- **The "current study"** is the last one Event Study answered in this
  browser (§11 does not say which); a six-slot study saves as
  `event-study-events.csv` (the page asks only for the events, whose CSV
  carries no slug), and the events do not depend on the confidence.
- **Geometry the PNG draws differently:** its top bar is 55 px against the
  shell's 47.5 (so content starts 16 px higher here), its gutter is 217 px
  against 211, the inventory and bridge cards run 14 and 22 px shorter, and
  "Series inventory" wraps onto two lines there.
- **Below the shell's 900 px menu width the badge sits under the title**
  (the top bar keeps the breadcrumb); a group's line wraps under its name
  when it does not fit beside it; below 1250 px the bridge sits under the
  inventory; on a phone a table scrolls inside its group.
- **The feeds use the tabs' short names,** "Ledger" and "Macro" as the PNG
  writes them, for Signal Ledger and Macro & Correlations.

PROPOSED (spec §12.13): `groups[].status_text`, `groups[].note`; notes on the
envelope, the DDL answer and the export's study, and a note for B on the
series Desk reads that §11's 26 leave out.

Verifier, round 1: **PASS WITH FINDINGS**, nothing blocking (the schema
block matches the PNG line for line; every committed compare shot
pixel-identical). Dispositions:
- D-1 a group without `status_text` showed no state: **fixed**, the served
  `status` prints; tested.
- D-2 a missing refresh time hid a failed validation: **fixed**, the badge
  reads "Last full refresh — · validation failed" in amber; tested.
- D-3 on a phone the group lines vanished and the badge squeezed the
  breadcrumb: **fixed** (recorded above); the browser test checks both.
- D-4 the column headers sat 5 px right of their cells: **fixed** (the
  padding rules' order).
- D-5 the sticky header covered the rows region's ring: **fixed**, the ring
  sits outside the region.
- D-6 the downloads could hang or save a JSON answer as .csv: **fixed** with
  one kit helper (`kit/download.ts`: 15 s at most, the type checked) that
  Event Study's Export uses too; tested.
- D-7 geometry and details: the caret is the PNG's size and green when open,
  no separator before the status dot, the search box shows its whole
  placeholder; the rest is recorded above.
- D-8 an empty group says "No series in this group yet."; no groups shows no
  count; tested.
- D-9 the search hit is marked with the row color and a blue edge.
- D-10 a group shows its header and five whole rows before it scrolls.
- D-11 the board-line allowance is anchored, in the unit scan and the
  browser scan (which now strips only those two lines).
- D-12 the frame-2 inventory hook and types in `src/api/desk.ts` are gone,
  and the badge's amber rule lives once, in the kit.
- D-13 the fixture's feeds name their real readers (the short names are
  recorded above); the series §11 leaves out are a note for B in §12.13.
- D-14 tests added (Data Pipeline now 13 unit tests; the browser test checks
  the group's own scroll, the phone layout and the breadcrumb).

Verifier, round 2: **PASS WITH FINDINGS**, nothing blocking; D-1 to D-14
confirmed. Dispositions:
- R2-1 (a regression from D-13's longer feed lists) three tables were wider
  than their groups at 1440, STATUS out of view: **fixed**, the feeds use
  the PNG's short names and a long reader list, a status with its note or
  a long series name wraps inside its cell; the browser test checks every
  open table at 1440, 1280, 1101, 900, 760 and 601.
- R2-2 the breadcrumb was cut between 601 and about 750 px: **fixed**, the
  badge moves under the title below the shell's 900 px menu width; checked
  at the same widths.
- R2-3 served group notes were cut with an ellipsis: **fixed**, a group's
  line wraps under its name when it does not fit; checked.
- R2-4 the caret was about 70% of the PNG's: **fixed** (14 px).
- R2-5 the rule that hides the top-bar badge lives in `desk2.css` now, so it
  holds before the page's chunk loads.
- R2-6 tests added: Event Study keeps the last study it answered and never
  one that failed; the download's type check and its 15 s limit
  (`kit/download.test.ts`).

### 10. Build Notes — `frame-3: build-notes`

Built: the Build Notes tab on `/build-notes` (§11), a render of
`docs/desk/BUILD_NOTES.md` read at build time through
`import.meta.glob(…, { query: "?raw" })`; the dev server's allow list gains
that one file. The contents list is the file's own `##` sections (a `##`
inside a code fence is code). It marks the section being read with
`aria-current="location"`: the last one whose top has passed a read line
120 px down, a line that moves to the foot of the window over the last
screen of scroll, so every section is marked on the way down. A jump (a
click, `#…` on arrival, a same-page `#…`) keeps its mark while its section is
on screen, until the reader scrolls by wheel, touch or key. A malformed
`#…` is no section. The card carries the file's `#` title (the tab's name when
the file has none), §11's byline "Max Komen · September 2026", the lead and
each section through the app's Markdown renderer, restyled in the Desk's
tokens for what the file may carry later (a `###` heading, code, a rule, a
link). The column ends with "Rendered from docs/desk/BUILD_NOTES.md · same
file in the repo". The page adds nothing else except the hold markers below
and, when a build has no file, "Awaiting the notes file:
docs/desk/BUILD_NOTES.md is not in this build."

**A conflict for Max:** the owner's rule says "established" and
"significant" never appear, and the file uses "established" twice. This
session may not edit that file. Both uses are in the gold paragraph under
"What is live and what is designed" (line 17). The page holds every
sentence that carries one of the two words. A paragraph is held whole
across its wrapped lines, and a list item across its continuation lines
(joined into the item). A heading is held in place and keeps its section.
Held sentences are replaced by a marker, and a run of them becomes one
counted marker. Emphasis in a paragraph with a hold is dropped, so a span
the hold cuts in two prints no asterisks. The two sentences held today,
verbatim:

> Suggestive, not established.
>
> The cross study is the more interesting result: the golden cross at 20
> sessions and the death cross at 60 both clear the bar the engine sets for
> an established read.

They sit side by side, so the page prints "(two sentences held: they use a
word the Desk does not print)" in their place. The second is the notes'
only statement of the cross-study result, so the page currently drops it.
A rewording in the Desk's own terms would clear both markers with no code
change. For example: "Suggestive: don't size on it." and "… both clear the
bar the engine sets for a Reliable read." A unit test pins the count at
two, so any change to the file's holds, in either direction, fails it
until this section and the count are updated. (Item 13 of the fold and
alignment below changed that test: it now counts the file's own sentences
that use either word, so it follows the file; your rewritten notes hold
none. The two sentences above are those of the committed file.)

**An owner action outside `web/` (B-1):** the image build copies only
`web/` (`Dockerfile`, stage 1) and `.dockerignore` excludes `docs` and
`*.md`. The page no longer breaks that build: the glob finds nothing and
the page says the file is not in this build. A `web/`-only copy was built
this session with `tsc -b` and `vite build`: both pass, and the chunk
carries the awaiting line. For the deployed page to show the notes, add
`COPY docs/desk/BUILD_NOTES.md /build/docs/desk/BUILD_NOTES.md` before
`RUN npm run build`, and `!docs/desk/BUILD_NOTES.md` after the `*.md` line
in `.dockerignore`. On Vercel (Root Directory `web`), confirm that the
project setting that includes files outside the root directory in the
build is on.

Compare: `docs/desk/screens/compare/11-build-notes.png` (build alone:
`11-build-notes.build.png`). Matched on the first pass in structure: the
contents column, the card, the title and byline, section headings and body
at the PNG's sizes. The words differ because the file does. The PNG shows
the frame-3 notes (§11's sections "What the engine does", "Review log",
"Known limits"… and the "[N] findings across [R] rounds" placeholder). The
repo's file is frame-2's ("What is live and what is designed",
"Architecture", "Pre-mortem of this tool", "First 90 days on the desk"), so
the contents list and the page's height follow the file (1,613 px against
1,040). When Max writes the frame-3 notes into the file, the page shows them
with no code change. That includes hard-wrapped list items, which the page
joins before the shared renderer sees them (round 2 tested the PNG's copy,
wrapped). The frame-3 heading "What is a model and what isn't" and the copy's
"always" would fail the language scan (B-5 below).

Verifier round 1: **FAIL** on one blocking finding. The
page itself passed every rendering check: all 24 blocks match the file in
order, no banned word is printed, 11 computed colors all come from §1.3,
there is no sideways scroll from 1440 down to 390, the keyboard stops have
rings, and the geometry matches the PNG. The compare shots of the nine
other built tabs were pixel-identical. Findings and what was done:
- B-1 (blocking) the Docker web build failed: the page imported a file
  outside `web/`. **Fixed inside `web/`** with the glob and the "not in
  this build" state; the Dockerfile lines are the owner action above.
- B-2 the contents mark ignored clicks, scrolling and `#…`. **Fixed**: the
  mark now follows the positions and the jumps described above. A browser
  test covers a fresh arrival on `#…`, a same-page `#…`, a click on a
  section too low to reach the top, scrolling to the foot and back, and a
  click. It is written against positions, not titles, because the file's
  headings are Max's.
- B-3 the hold held too little (`_established_`, the start of a wrapped
  sentence) and too much (a whole `##` heading and its section, a bullet's
  marker, the sentence after a closing quote or bold, text split at "e.g." or
  "U.S."). **Fixed** in `notes.ts`: letters and digits bound the word, the
  file is split into title and sections before holding, and holding goes
  paragraph by paragraph and item by item. Every case is pinned, negatives
  included ("insignificant", "establishment", "significantly", "1.8").
- B-4 a `###` heading, code, a rule and a link fell back to the analyst
  panel's styles. **Fixed**: set in the Desk's tokens in `notes.css`
  (completed in round 2, R2-4).
- B-5 the language gate no longer covered Build Notes. **Fixed**:
  `desk-language.test.ts` scans the file as the page prints it (after the
  holds), under the full list and the recession allowance. Line 29 ("The
  recession probability is a model, … a logistic regression …") passes on
  that allowance. Settle with Max whether his own prose should be exempt
  from the frame-2 list: the PNG's frame-3 copy uses "always" ("always gives
  the same answer") and "model" ("a rule, not a model"), and both would fail
  the scan once written into the file.
- B-6 adjacent holds printed two markers. **Fixed**: one counted marker.
- B-7 this section did not quote the held sentences, overstated the mark,
  and left out B-1. **Fixed** above.
- B-8 the dev server allowed all of `docs/desk`. **Fixed**: the one file.
- B-9 an empty or missing file gave a blank page with no explanation.
  **Fixed**: the awaiting line. The contents list and the "Rendered from"
  line are omitted.
- B-10 tests were thin. **Fixed**: `BuildNotesPage.test.tsx` checks, by
  substring and in the file's order, every block without a held word, using
  a parse independent of `notes.ts`. It pins the hold count and covers the
  edge cases, the missing file, a file with no title, and the mark on click
  and on `#…`. The browser test serves its own notes in place of the file
  (long, short and tiny sections), so it does not depend on Max's text. It
  checks the scroll sweep, clicks, a fresh and a same-page `#…`, the wheel,
  and a malformed `#…`.

Verifier round 2: **FAIL** on one blocking finding. Every round-1 fix was
confirmed: the `web/`-only build, the mark on click, Back, Forward and Enter,
every hold case, the language scan, the counted marker, the dev allow list
and the empty file. The gates and the compare shots were also confirmed.
Findings and what was done:
- R2-1 (blocking) a malformed escape in `#…` (`#%`) crashed the tab.
  **Fixed**: the fragment is decoded under try/catch, and a unit test and
  the browser test cover it.
- R2-2 a jump to a short section marked the next one. **Fixed**: a jump
  keeps its mark while its section is on screen, until a reader-started
  scroll.
- R2-3 scrolling skipped sections (Architecture and Pre-mortem never
  marked). **Fixed** by the moving read line. On the repo file at 1440×1040,
  1440×960, 1100×900, 1440×700 and 390×844, a sweep marks all five sections
  in order.
- R2-4 a rule kept the browser's gray, and a `#` heading in the lead kept
  the app's color. **Fixed** in `notes.css`.
- R2-5 wrapped list items split the list, and the hold missed their
  continuation. The fidelity test's parse also broke on `*x*`, and the
  browser test depended on the file's length. **Fixed**: continuation lines
  are joined into their item. The parse strips emphasis and links, and the
  browser test serves its own notes.
- R2-6 an abbreviation at a sentence's end swallowed the next sentence.
  **Fixed**: a piece runs on after an abbreviation only when it starts in
  lower case or with a digit, and after a name's middle initial only when
  it starts in upper case.
- R2-7 a hold inside an emphasis span printed asterisks. **Fixed** as
  above.
- R2-8 a section id could collide with the page's fixed ids. **Fixed**: the
  card title's id is `bnx-title`, and heading ids end in `--h`, which no
  section slug can.
- R2-9 a `##` inside a code fence started a section. **Fixed**.
- R2-10 all emphasis rendered gray. **Fixed**: emphasis keeps the body
  color, the hold marker included.
- R2-11 a jump landed flush at the window's top. **Fixed**: the scroll
  margin sits on the section.
- R2-12 this section overstated: B-4, "ten other shots", the fidelity
  test, the hold cap, list items, "no code change", and the source line in
  the missing state. **Fixed** above.

The round-2 fixes were checked by the gates and the new unit and browser
tests, not by a third verifier round.

### 11. Client view — `frame-3: client-toggle`

Built: the Desk / Client toggle's client view (§11,
`screens/12-client-view.png`). On a tab that carries the toggle, Client
replaces the tab's body with a client-safe read of one study. Event Study
uses the study in its address; every other tab uses the last study Event
Study answered in this browser, else the gold preset (the bridge export's
rule). The view asks at the served confidence, never the desk's slider.

Left column: "Setup · <day>" (the last event, while the setup is firing;
"Setup last seen · <day>" when it is not), the served question as the
page's h1, the served paragraph, three stat cards and §11's source line.
The cards are Episodes, with "since <year>"; Higher a month later, against
an ordinary month, in green only when it beats that month; and Typical
move, against "ordinary". Right column: the card "A month later, by
economic backdrop" / "Typical S&P move after the setup" with the regime
bars. Every bar is drawn on one scale, so equal moves are equal lengths
whatever their sign. A null median prints "too few cases to say".

Every label and the card's title stay while the study loads. A study that
does not answer says "Awaiting refresh". A study too thin to score prints
the engine's own sentence in the paragraph's place (when no client
paragraph is served) and in the backdrop card, and "too few cases to say"
in the month's two stats. A null regime row's words wrap inside the track:
after zero, or ending before it when zero sits right of the middle. No verdict
pill, no σ, no desk wording. The sidebar stays (the only navigation) but
loses the TODAY and HOUSE DISCIPLINE cards.

The header's action gives way to "Export one-pager (PDF)", which prints the
page. The print style applies to the client view only. It hides the
sidebar, the header, the walkthrough and the button, sets the page in one
column on white paper tokens, prints the numbers in ink and keeps the
bars' colors (`print-color-adjust: exact`), and fits one page on Letter,
A4 and landscape Letter. A browser
test counts the PDF's pages. Printing any other tab is unchanged.

PROPOSED fields (added to the spec's §12.13 before use): `study.client`
(`headline`, `summary`), the question and paragraph in plain words, written
by the engine and never composed on the page; and
`study.horizons[].baseline_up_pct`, the "vs 62% in an ordinary month"
(§12.2 carries only the baseline median). The block also records the
confidence rule, the setup's date and the insufficient-study rule.

Deviations from the PNG, each with its reason:
- The sidebar stays and the header keeps the breadcrumb. The PNG's client
  view has no sidebar and a "Desk · Client view · internals hidden" bar.
  The owner's rule is that the sidebar is the only navigation, so it stays
  on screen, without the desk's two internal cards. It is hidden in print,
  so the exported one-pager has none. The toggle reads "Desk / Client" as
  on every other tab's PNG, not "Desk view / Client view".
- §11 calls the view "a one-card client-safe summary". The PNG shows the
  question, the paragraph and three stat cards beside that card. The build
  follows the PNG, and the one card §11 lists is its right column, word for
  word.
- The source line follows §11's text ("Radar · FRED, Yahoo Finance · as of
  Sep 22, 2026 · Past patterns do not guarantee future results."), not the
  PNG's "Source: Macro Regime Radar · …". The spec is the contract for
  labels.
- The PNG draws Stagflation's +1.9% as a red bar to the left. The build
  draws it green to the right, because §1.3 says red is only ever a down or
  negative number.
- The PNG dates the setup "Sep 21, 2026", the day before its source line.
  The fixture's setup is not firing (`firing_now` false, `last_event`
  2025-04-16), so the build prints "Setup last seen · Apr 16, 2025".
- The numbers are the fixture's study (18 episodes since 2000, 67%, +3.1%
  against +1.3%), not the PNG's illustrative ones (41 since 1990, 63%,
  +1.8%). The PNG itself is marked "MOCKUP · values illustrative".

Compare: `docs/desk/screens/compare/12-client-view.png` (build alone:
`12-client-view.build.png`), shot at
`/desk/event-study?preset=gold-2sigma-spx-weak&view=client`. It matched on
the second attempt. In the first shot the bars' zero line sat mid-track,
with a 118 px value column, so the longest bar was a quarter of the PNG's.
The bars were redrawn to the PNG's geometry: the zero line 142 px from
where the labels start, 60 px rows, 22 px bars, the value 9 px after the
bar's end, and the offset below the title. The card's run down the window,
the stat cards' 105 px height (PNG 103) and the card title's size were
matched too. The bars are to scale; the PNG's are not (its 2.8% bar is
half its 4.2%).

Verifier round 1: **FAIL** on two blocking findings. It confirmed the
geometry against the PNG (card 461×624, zero line 173 px from the card's
edge, bars 22 px on a 60 px pitch) and the study selection across presets,
six slots, garbage storage, 503, 422, a network abort, a 202 and non-JSON.
It also confirmed the toggle on every tab that carries it, the keyboard,
reduced motion, the palette, the wording and the gates. The ten other
compare shots were pixel-identical. Findings and what was done:
- C-1 (blocking) the one-pager printed as a 189 px column over three
  landscape pages, and two portrait pages. The print tokens stayed dark,
  and the print rule leaked into other tabs once loaded. **Fixed** as
  described above, scoped to `.dk[data-client]`. A browser test counts one
  page on Letter, A4 and landscape Letter, a full-width main, the bars'
  color kept, and another tab's sidebar still printing.
- C-2 (blocking) mixed signs were drawn on two scales (−3% twice as long as
  +3%). **Fixed**: `barGeometry` puts every bar on one px-per-point. A unit
  test pins equal lengths for ±x, and a browser test checks them at
  1440/1101/760/390.
- C-3 an all-negative set pushed the values past the card. **Fixed**: the
  value room is always kept on the right; the browser test checks it at
  every width (for a null row's words, completed in round 2, R2-1).
- C-4 a study too thin to score printed "Awaiting refresh". **Fixed**: the
  engine's `empty_state.sentence` (tested; without a client paragraph,
  completed in round 2, R2-2).
- C-5 the setup was dated with `as_of`. **Fixed**: `last_event`, with
  `firing_now` (tested); the deviation above is corrected.
- C-6 the Export button was the light one. **Fixed**: the dark button, bold,
  as the PNG draws it.
- C-7 the tests did not pin the behavior. **Fixed**: Event Study's own
  address (a preset other than the fallback), the stored study on another
  tab, mixed, negative and null bars with their tones, the thin study,
  Export calling `print()`, the loading state and a tab without the toggle.
- C-8 while loading only "Setup" and the tab's name showed. **Fixed**: every
  label and the card's title render in every state. The fallback h1 reads
  "A past pattern, in plain words".
- C-9 the green tone came from a 50% threshold. **Fixed**: green only when
  the setup beat the ordinary month's share (both served numbers), never
  red.
- C-10 the stat cards ran 115 px against 103 and the card title was small.
  **Fixed** (105 px; 16 px title, 277 px wide against 294). The toggle labels are listed above.
- C-11 the desk's internal cards showed in the client view. **Fixed**
  (hidden on screen and in print).
- C-12 internal wording in the awaiting line, a nowrap label that could run
  over the bars, the confidence rule unstated, 58% against 62%. **Fixed**:
  a plain "Awaiting refresh", labels that wrap in a 96 px column, and both
  rules and both numbers stated in the spec.

Verifier round 2: **PASS**, no blocking finding. It confirmed every
round-1 fix. The one-pager printed on one page on Letter, landscape Letter,
A4, landscape A4 and Legal, from 1440 and 390 viewports, with and without
background graphics. Other tabs printed identically before and after a
visit to the client view. Equal moves drew equal lengths at every width,
and no calc() string went invalid across twelve bar variants. The eleven
compare shots were identical. Findings and what was done:
- R2-1 "too few cases to say" ran past the card when zero sat at the right
  (all negative plus a null row). **Fixed**: `barGeometry` places a null
  row's words after zero, or ending before it when zero is right of the
  middle, wrapping inside the track. The browser test adds that case and a
  mixed one, checking every value inside the card and no clipped words at
  four widths.
- R2-2 a thin study without a client paragraph still printed "Awaiting
  refresh". **Fixed**: the sentence takes the paragraph's place. The test
  now deletes `client`.
- R2-3 this section overclaimed C-3, C-4 and the card height. **Fixed**
  above.
- R2-4 green numbers on paper were faint (1.8:1). **Fixed**: in ink on
  paper; the bars keep their green and red.
- R2-5 the fallback h1 described the page, not the reader's question, and
  a thin study's sentence printed three times. **Fixed**: "What has
  happened after this setup"; the sentence prints once in the card and
  once in the paragraph's place, with "too few cases to say" in the stats.
- R2-6 a label of four lines outgrew its row; a median that rounds to 0.0%
  drew a sliver; Export is hidden at 560 px and below (as every header
  action is); A5 prints two pages. **Fixed**: rows grow with their label,
  and no bar is drawn for a move that rounds to zero. The phone header and
  A5 are left as they are: the header's actions are hidden on phones on
  every tab, and Letter, A4 and Legal print on one page.

The round-2 fixes were checked by the gates and the tests above, not by a
third verifier round.

### 12. Basket & Hedge — `frame-3: basket-hedge`

Built last, after every other tab was committed with its gates green (§13).
The Basket & Hedge tab (§10, `screens/09-basket-hedge.png`) has two
columns.

**Basket.** A basket the server keeps (`?basket=`, `GET /basket/:id`) or one
saved in this browser, picked from the selector, with "+ New basket" to
start an empty one. Its stats row: 3-month against NDX, the residual against
NDX with "last 60 sessions · falsifies at −4%", and basket vol against NDX
with the "× as jumpy" ratio. Its legs are typed weights: Equal-weight,
Normalize to 100%, × to drop a name, and a ticker to add at 0%, whose name
arrives with the next price. The total shows beside them, amber when it is
off 100%.

While the typed weights differ from the served ones, `POST /basket/price`
prices them (it writes nothing). A total off 100% says so instead of
pricing. Then the residual chart: its question from the served `short`,
`beta` and window; one blue line, the dashed amber line where the position
comes off, green above zero and amber below the line, the end value by the
white dot. Then the served sentence and the served "Beta to NDX" read.
Save basket keeps the weights in this browser (as Event Study keeps its
saved questions, §1.8). The hedge on the right then prices the saved
weights. A served basket keeps the server's name, short name and rebalance
rule whatever weights this browser keeps for it, and the Advanced panel
offers "Revert to the served weights". A basket of this browser's own can
be deleted there. The panel's "export" is Export / Import JSON of the saved
baskets. An import never replaces a basket: one already here (same name
and legs) is skipped, and one whose number is taken here by a different
basket, including this browser's own weights for a served basket, gets a
fresh `local-<n>`. "+ New
basket" reuses an empty one rather than adding another. The selector lists
the server's baskets (from the default basket's answer) whichever basket
is open, and a save in another window reaches the card as well as the
hedge.
A basket that did not come, or one not saved in this browser, says which.
"Awaiting refresh" is only ever an answer that did not come (§1.7). While
the basket or a price is on its way, and while the analyst's own weights
cannot be priced (a total off 100%, a weight that is not a number), the
stats show their labels alone and the reason is given in words ("Add a
ticker to price the basket" for an empty one).

**Hedge.** Three modes in the address (`?mode=`): Protect the basket,
Express the S&P lean, and Neutralize NDX beta. `GET /hedge` prices one
subject:
- the saved basket, by id or, for weights saved in this browser, as its
  legs;
- the position Position Monitor's "Price a hedge →" carries (`?position=`);
- for Express, the study carried in from Event Study (`?study=` or the six
  slots its "price it" link sends), else the last one it answered, else the
  gold preset.

The served subject's label is printed ("Priced for AI infrastructure
basket"). Picking a basket drops a position carried in, and a mode once
picked is always written to the address. The three structures are radios,
each named by its label and described by its numbers and note, with the
served recommendation picked first. The picked one's hedge ratio, cost of waiting and roll, its month of
scenarios and its note follow the pick. Then the served "Why index options,
not the names" and Recommendation reads. The title row carries "● Live ·
prices <day> · options via <provider>" from the two answers. The header's
"Send to Position Monitor →" carries `?basket=`, and Position Monitor fills
its instrument field from that basket's served `instrument` and says "Sent
from Basket & Hedge · <name>". Nothing about the basket or the hedge is
priced on the page. The page only tidies the analyst's own weights
(equal-weight, normalize).

PROPOSED (the spec's §12.12 left the shapes to be written first; they are
in §12.13, "Basket & Hedge (§10)"): `GET /basket/:id`, the priced fields
shared with `POST /basket/price`, `GET /hedge` with its subjects and its
per-structure numbers, and the `?basket=` hand-off. Fixtures, one file per
endpoint: `basket.json`, `basket-price.json` and `hedge.json`. They carry
one basket, its price and one hedge (Protect, for that basket as a basket,
as its legs, or as the position that holds it), as the fixtures carry one
study. Other weights, baskets, modes and subjects answer 404 in fixture
mode, and the page shows Awaiting refresh with its labels kept. The
collar's and the outright puts' numbers are the fixture's own, worked from
their payoffs on $62 of QQQ per $100 (e.g. the collar at −20%: −32 + 9.3 −
0.2 = −23%). The residual path runs from +0.8% twenty sessions ago to −1.9%
today, as the served sentence says.

Deviations from the PNG, each with its reason:
- The "MOCKUP · values illustrative" chip is not drawn (as on every tab).
- The active mode and the picked structure are drawn with the neutral
  active fill and a gray border, not green. §1.3 gives green to up,
  Reliable, firing and current, and "selected" is none of them. For the
  same reason, the Recommendation box is the ordinary read box, not
  green-bordered.
- Basket vol 41% is in the body color, not red. Red is only a down or
  negative number, and a volatility is neither.
- The chart's right end reads "Sep 22", not "today", because the fixture's
  day is not New York's today (D13, as on every chart).
- The reads drop the PNG's em-dash asides ("… can't, a basket-specific
  selloff, but …"; "… steep skew. Sell the wing, don't buy the outright.").
  The fixture writes them in the owner's house style.
- Picking the collar or the outright puts changes the stats row, the
  scenario table and its note. The PNG shows the put spread's only.
- A "Priced for <subject>" line under the modes names what the hedge
  prices (the served `subject.label`). The PNG has no such line; without
  it a hedge carried in from a position or a study would not say what it
  is for.
- The scenario table's flat-row "0%" is in the neutral color, not green:
  zero is neither up nor down (§1.3).
- The chart's end value is the chart kit's point label (mono, gray, placed
  clear of the line), as on every Desk chart, not white above the dot.
- The residual line is the fixture's path, which the served sentence
  describes (+0.8% twenty sessions ago, −1.9% today). The PNG's drawing
  sits near −1.2% a month back.

Compare: `docs/desk/screens/compare/09-basket-hedge.png` (build alone:
`09-basket-hedge.build.png`). It matched on the second attempt. In the
first shot the stat numbers used the 31 px step (the design's are 23 px on
the basket side and 21 px on the hedge side), the card titles were 15 px
(17), the chart was 230 px tall (165), and the scenario table carried its
question as a caption row above the header row. All four were set to the
design's. After the verifier's round 1, the build is 1,040 px tall, as the
design is. The measures, build against PNG:
- the three structure rows: 88 / 72 / 72 against 84 / 71 / 71;
- scenario rows: 25 px, the same;
- the ticker column: 11.5 px;
- Equal-weight and Normalize: 22 px tall;
- the modes row: 11 px below the title;
- the Beta and Recommendation reads: at their cards' feet.

Verifier round 1: **FAIL** on one blocking finding. It confirmed:
- every copy line against the PNG and §10;
- the six deviations listed then;
- the fixtures' arithmetic, down to all twelve scenario cells from $62 of
  QQQ per $100;
- the contract, field for field;
- the palette in every state, the 27 keyboard stops, and no sideways
  scroll at seven widths;
- the failures on every call.

The other compare shots were identical. Findings and what was done:
- B-1 (blocking) arriving from Event Study's "price it" with `?study=`,
  Protect could not be picked: the page inferred Express from the study
  whenever `mode` was absent, and Protect removed `mode`. **Fixed**: a mode
  once picked is always written. A unit test starts from
  `?mode=express&study=…` and picks Protect.
- B-2 the falsification band was 0.6 points deep, so its label hung onto
  the x captions and, at 390, "−4%" sat on "60 sessions ago". **Fixed**: the
  band runs 1.45 points (the PNG's depth), and a narrow chart takes one-line
  labels. The browser test checks the label inside the band and clear of
  the captions at 1440, 1200, 1101 and 390.
- B-3 "Awaiting refresh" showed while the basket or a price was loading and
  for the analyst's own off-100 total. **Fixed** as described above, with
  tests for a basket that never answers and for a 96% total.
- B-4 the collar's sub-line read "1.6 × 0.45 delta" under "$62 per $100".
  **Fixed**: the fixture's collar delta is 0.39, and all three rows agree.
  The block also records that `max_loss` means the premium for two rows
  and the move to the strike plus the cost for the collar, as §10's figures
  do, for session B to settle.
- B-5 saving the served basket shadowed its name, short name and rebalance
  rule for good, with no revert; empty new baskets piled up; no export.
  **Fixed** as described above.
- B-6 a malformed or null answer could break the tab or print "last null
  sessions" and "0.0%". **Fixed**: every list is checked and every printed
  number is finite or the stat says Awaiting refresh; `residual_window` may
  be null. Tested with unreadable basket, price and hedge answers.
- B-7 the served subject was ignored, and "+ New basket" kept a position
  carried in. **Fixed** (tested).
- B-8 Position Monitor said nothing when a sent basket did not come.
  **Fixed**: it names the basket and says it is awaiting refresh, or not
  saved in this browser (tested).
- B-9 the selector cut "AI infrastructure" from 1101 to 1250 px, and the
  title read "Baske" at 390. **Fixed**: neither shrinks and the header
  wraps. The browser test measures the selected name against the
  selector's width at four widths.
- B-10 the measures above. **Fixed**, and the old line about 29 px spread
  through both columns is gone.
- B-11 unlisted deviations. **Listed** above; "+ New basket" is no longer
  underlined.
- B-12 copy. **Fixed**: a refused price ("has no price for these
  weights"), an unreadable one, and a failed one each have their own
  words; storage off and storage full differ; an empty basket asks for a
  ticker.
- B-13 the legs note followed into another basket. **Fixed**: the legs
  reset with the basket.
- B-14 served facts written into the page ("AI infrastructure" while
  loading, "60 sessions against Nasdaq", `|| 60`). **Fixed**. The fixed
  default basket is recorded in the PROPOSED block.
- B-15 a mouse click drew the focus ring on a structure, and each radio's
  name was the whole row. **Fixed**: `:has(:focus-visible)`, the label as
  the name, and the numbers and note as its description.

Verifier round 2: **FAIL** on one blocking finding the round-1 fixes
introduced. It confirmed all fifteen round-1 fixes by probe: Protect from
every Express address, the band label inside its band at seven widths, the
quiet and awaiting states, the collar's delta, save/override/Revert/Export/
Delete, nulls, the subject line, Position Monitor's three cases, nothing
cut at seven widths, and the measures. The twelve compare shots were
identical. Findings and what was done:
- R2-1 (blocking) on a basket of this browser's, the selector listed only
  this browser's baskets: the served list came from the open basket's
  answer, which a `local-` basket never asks for. **Fixed**: the list comes
  from the default basket's answer whichever basket is open (tested:
  a local basket lists "AI infrastructure" and can pick it).
- R2-2 a save in another window reached the hedge but not the card.
  **Fixed**: the card rereads its saved baskets on `storage` (tested).
- R2-3 an import overwrote a different basket with the same `local-<n>`,
  and accepted ids that are neither local nor served. **Fixed**: those get
  a fresh number, and the status says so (tested in the weights and on the
  page).
- R2-4 a served leg with a text weight, or a price with a null leg, broke
  the tab. **Fixed**: an answer counts as readable only when every leg is a
  ticker and a finite weight (tested). B-6's "every list is checked" now
  holds.
- R2-5 the spec's breakeven definition fitted none of §10's figures, and
  its default-basket sentence described nothing built. **Fixed**: the block
  states the rule the figures follow (strike plus cost) for session B to
  settle, and that the default is fixed on the page.
- R2-6 an empty basket sat quiet with no reason. **Fixed**: "Add a ticker
  to price the basket." (tested).
- R2-7 "+ New basket" on an empty stored basket with typed legs said it was
  empty. **Fixed** in round 3 (R3-3).
- R2-8 the raw id stood in for a missing name ("IS THE LOCAL-9 BET
  WORKING?"). **Fixed**: "Is the bet working?", and a neutral option
  label.
- R2-9 the chart had lost its space under the question. **Fixed**: 32 px
  on the chart's own wrapper (after round 3), so the question sits 42 px
  above the band as in the PNG.
- R2-10 a non-JSON price read "did not answer". **Fixed**: "could not be
  read" (tested).
- R2-11 the wrapped header indented the selector row. **Fixed**: the
  header's gap replaces the margin.
- R2-12 the "Priced for" line (24 px) moves the hedge's middle about 35 px
  below the PNG's and shrinks the PNG's gap above Recommendation to 14 px.
  **Listed** here; the line stays, for the reason given in the deviations.
- R2-13 the missing tests. **Added** as noted above.

Verifier round 3: **PASS**, nothing blocking. It confirmed every round-2
fix by probe. The selector on a local basket lists and picks the served
one from one shared request, and the page stays correct when that request
is slow or fails. A save in one window reaches the other's card and hedge,
with no race. Renumbered imports, unreadable legs and every price-error
wording checked out. Nothing was cut and nothing scrolled sideways at
seven widths. The twelve compare shots were identical. Its six small
findings were then handled:
- R3-1 an import could replace this browser's own weights for a served
  basket. **Fixed**: they are kept, and the imported weights come in as a
  new basket of this browser's (tested).
- R3-2 importing the same file twice doubled the renumbered baskets.
  **Fixed**: a basket already here, by name and legs, is skipped and
  counted ("already here") (tested).
- R3-3 "+ New basket" dropped typed legs unseen. **Fixed**: while the open
  basket has unsaved weights it says to save them or put them back, and
  stays (tested). Picking another basket in the selector still drops
  unsaved weights; the "unsaved weights" note under Save warns of it.
- R3-4 with the default basket's answer failed, an override for another
  served basket in a file comes in as a basket of this browser's. Left as
  is: nothing is lost, and the basket is kept under its name.
- R3-5 the question sat 30 px above the band against the PNG's 42.5.
  **Fixed** (32 px margin); the page is still 1,040 px tall.
- R3-6 the add row's hint was cut from 1101 to about 1350 px. **Fixed**: it
  wraps under the input.

## Codex round 1

Codex reviewed `desk/frame-3` at `7bb2a3e` and returned fifteen findings,
R-01 to R-15, with "do not push". Fourteen are fixed on this branch in four
commits, one per group, each after the four gates and an independent
verifier; R-15 is outside `web/` and is deferred (below). Where a fix needed
a field the API does not serve, the field is in the spec's §12.13 as
PROPOSED with its JSON shape and reason, the fixture carries it, and its
absence prints "Awaiting refresh"; the browser never computes the judgment.

`docs/desk/SPEC_AMENDMENTS_v2.md` and `SPEC_AMENDMENTS_v3.md` (untracked,
dated Sep 24, not written by this session) resolve later reviews and say
they are folded into the spec together, after Codex round 2. It renames some of the fields below (`target_unit`
becomes `log_return | log_change | bp` with a separate `display_unit`,
per-horizon `n` and a study-wide `matched_n`, the envelope with `data`), and
it makes Basket & Hedge unavailable for Monday. This round follows the
round-1 brief's names; the fold is session A's next step, and the file was
left untouched and unstaged.

### Group 1: robustness (R-01, R-09, R-10) — `frame-3: codex-1 robustness`

- **R-01: a null statistic printed as a number.** The kit's formatters
  spelled `null` as "0.0%" (`Math.abs(null)` is 0), and the answer card
  formatted `up_pct`, `median`, `baseline_median` and the extremes
  unchecked. **Fix:** every served statistic in `data/types.ts` is now
  `number | null`, and every block a panel reads on its own is optional,
  so the compiler lists every place a value is formatted or a list is read
  without a check. It raised 100 errors in eleven files (nine of them in two
  test files that read fixture blocks): the answer card, the rail, the
  engine panel and the page's provenance line on Event Study; the
  Overview's tiles, since-last-close and signal sentences; Regime's
  recession card and next prints; the Technicals skew gauge and cross
  marker; the sidebar's S&P change; and the basket's chart and scenario
  rows. The compiler does not see a nullable number inside a template
  string or JSX text, so those were found by a search and by the verifier
  (Technicals' "N× since", "fired N×", the cross's "N times before" and
  the RSI footer; the engine panel's "All N events"; the Macro matrix's
  "N-day"; Position Monitor's Closed strip and FALSIFIES AT line, and the
  level suggestions, which tested `typeof` and so let Infinity through).
  Each now checks the value is finite: a stat keeps its label and prints
  "Awaiting refresh", a table cell prints "—" (§12.13), a horizon row whose
  numbers are null keeps its place and label in the chart and says
  "Awaiting refresh". Under the pages, the formatters return "—" for
  anything not finite, so no path prints a number that was not served. An
  unknown verdict prints "—" in its pill or word, sorts last, and the
  rail's verdict box says Awaiting refresh. **Tests:** the formatter floor
  (`kit/format.test.ts`); a study with `n_events`, the month's `up_pct`,
  `median` and `worst` served null (`EventStudyPage.test.tsx`).
- **R-09: a 200 with a null body was a loading state for ever.** **Fix:**
  once, at the data layer (`data/api.ts`): a completed answer whose body is
  null, not JSON, or not an object rejects as `unreadable` (a
  `DeskApiError` carrying the HTTP status), so every hook on every tab
  reports an error and the page shows its labels with "Awaiting refresh".
  Unreadable answers are not retried; a 5xx is still retried once. The
  basket's price line and Position Monitor's save line word an unreadable
  answer on their own, and after an unreadable save Position Monitor asks
  `/positions` again, so a save that did land shows in Monitored.
  **Tests:** `data/api.test.tsx` (null, a list, a number, a string,
  non-JSON and a refusal, GET and POST; the retry count for a 503, a 404,
  a null and a non-JSON answer); Position Monitor's unreadable save and its
  second `/positions`; a browser test that answers each tab's main endpoint
  with `null` (Overview, Technicals, Event Study, Regime, Macro, Sectors,
  Signal Ledger, Position Monitor, Data Pipeline, Basket & Hedge) and
  checks the tab's labels, "Awaiting refresh", nothing left `aria-busy`,
  and the palette.
- **R-10: blocks were not validated at the boundary, and panels called
  `.find`/`.map` on lists that might be absent.** **Fix:** every field of
  every answer is checked at the boundary against its endpoint's schema
  (`data/schema.ts`, which mirrors `types.ts` field for field). A statistic
  that is not finite (1e999 parses to Infinity) becomes null. A row or
  block missing a field it cannot be read without is dropped (a regime
  history row without its month, a pipeline group without its name, a
  ledger row without its slug, a technicals point without its date, a
  cross without its kind and day, a trend tile without both flags), and
  its panel says it is missing. Any other field of the wrong kind is
  removed (a `data_status` object, a numeric `sample_start`, a numeric
  `vol.source`), so a page never reads a number where it expects words.
  Two blocks are one fact each: the Macro matrix (its names and every row
  of values, or nothing) and a served basket's legs (one bad leg and the
  basket cannot be read as served; a price's bad leg is dropped). A study
  whose `question` is not its six slots cannot be read at all. Every panel
  still guards its own block, and the sidebar's TODAY card, which sits
  outside each tab's own error boundary, has one of its own
  (`kit/Contain.tsx`). Booleans that were missing no longer print a claim:
  "regime unchanged" needs `regime_changed`, and the trend tile needs both
  flags. **Tests:** `data/api.test.tsx` checks every fixture passes its
  schema unchanged; for each endpoint with a fixture, deletes or malforms
  every top-level block eight ways and checks only a required one makes
  the answer unreadable; the six slots of `question`; dropped rows and
  fields; 1e999; the basket's legs. Event Study with `horizons`,
  `provenance`, `by_regime` and `last_events` deleted one at a time, each
  block saying Awaiting refresh on its own while the others stand;
  `kit/Contain.test.tsx`; a browser test that serves Event Study a
  `question` of `{}` and one with a numeric `while`, on Event Study and on
  Position Monitor carried in from it, with no render error.

Verifier (one round, as the brief asks): **FAIL**. It confirmed R-09 on
every endpoint and tab with null, `[]`, a string, a number, non-JSON and
`{}` bodies (over 1,400 page loads), the POST cases, the retry counts, the
top-level blocks, that the new tests fail without the fix, the error
count, and the compare shots. Its findings, all taken:
- G1-1 (blocking) `question` was checked as an object, not six slots, so a
  malformed one still crashed Event Study and Position Monitor. **Fixed**
  by the schema (tested).
- G1-2 to G1-4 the matrix's "null-day", the engine panel's "All  events",
  the Closed strip's Infinity. **Fixed** (above).
- G1-5 nested lists and row fields were not checked. **Fixed** by the
  schema, with page guards on the matrix and the empty state's fixes.
- G1-6 a served basket with a null leg showed as a partial basket.
  **Fixed**: its legs are one fact.
- G1-7 Monitored was not asked again after an unreadable save. **Fixed**.
- G1-8 a wrong-kind string could crash the sidebar, outside the tab's
  boundary, or print "undefined". **Fixed** by the schema, the TODAY card's
  own boundary, and guards on the regime words and the sent basket's
  instrument.
- G1-9 a missing boolean still printed a claim. **Fixed** (above).
- G1-10 the retry rule and most of the boundary were untested. **Fixed**
  (above).
- G1-11 this section overstated its coverage. **Fixed** in this rewrite.

The fixes were checked by the four gates and the tests above, not by a
second verifier round (the brief asks for one per group). Every compare
shot but Event Study's and Technicals' re-shot pixel-identical. Those two
differ only by sub-pixel glyph placement where a sentence's text runs were
rejoined around a finite check (Event Study's without-condition sentence;
Technicals' "N× since" rows, the cross callout and the two RSI notes); the
words are the same, checked crop by crop, and both are regenerated.

### Group 2: contract gaps (R-02, R-03, R-07, R-12, R-13, R-11) — `frame-3: codex-2 contract`

Each fix reads a field the API does not serve yet. The fields are in the
spec's §12.13 under "Codex round 1" with their JSON shapes and reasons,
the fixtures carry them, the response boundary checks their kinds
(`data/schema.ts`), and a response without one keeps its labels and says
the value is awaiting refresh; the page never works the judgment out.

- **R-02: every target move printed as a percent.** A study on the 10-year
  yield or on HY OAS moves in basis points, and the page spelled its
  median, baseline, interval, extremes and chart axis as a percent. **Fix:**
  PROPOSED `study.question.target_unit` (`pct` | `bp` | `px`). One module,
  `event-study/units.ts`, spells a move, an interval and a chart tick from
  it: `pct` a fraction ("+3.1%", intervals in points), `bp` as served ("+25
  bp", never a percent), `px` the target's points. Every place a target
  move is printed reads it: the answer card's stats, chart ticks, bars and
  range labels; the rail's range rows, by-regime medians and last five
  events; the engine panel's events table; the without-condition line;
  the Client view's typical move and backdrop bars. The chart's ticks step
  by 1, 2 or 5 × 10ⁿ in bp or points ("−30 bp / 0 / +50 bp"), where a
  percent keeps §4's 5, 1 or a half. A study without the unit prints no
  move at all and says so; the page never guesses a unit from the series
  key. **Tests:** `units.test.ts`; the ticks; Event Study, its Advanced
  events table and the Client view with a bp study
  (`test/desk-variants.ts`, `bpStudy`, `bpEvents`) and with the unit
  removed; a browser test that serves a bp study to Event Study and the
  Client view and finds "+25 bp" and no signed percent.
- **R-03: the target named from the slot's key.** **Fix:** PROPOSED
  `study.question.target_label` names the target on the chart axis, the
  last-five heading, the Client view's backdrop subtitle ("Typical S&P 500
  move after the setup", which was fixed copy reading "S&P") and Position
  Monitor's carried-study subtitle and instrument prefill. Without it the
  heading and subtitle drop the name and the instrument field is left for
  the analyst. **Tests:** Event Study and Client view with the bp study
  ("10-year Treasury yield"); Position Monitor with a served
  `target_label` of "S&P 500 index" fills the field and the subtitle.
- **R-07: "12 of 18" divided by every event.** A recent event has no
  three-month move yet, so each horizon has its own count. **Fix:**
  PROPOSED `study.horizons[].n_complete`; the "Up a month later" stat
  prints `up_n` of `n_complete`, and says the count is awaiting refresh
  when `n_complete` is not served. `n_events` is printed only as the Events
  stat and the study's other counts ("all 18 events", the Client view's
  episodes), never as a horizon's denominator. **Tests:** a month with
  `n_complete` 17 prints "12 of 17"; one without it prints the awaiting
  line.
- **R-12: the page ranked two verdicts.** The without-condition sentence
  compared the two verdicts' ranks and wrote "The condition earns its
  place." itself. **Fix:** the ranking is deleted; PROPOSED
  `study.without_condition.comparison` (`improves` | `no_improvement` |
  `insufficient`) and `comparison_note`, and the page prints the served
  note, or "Whether the condition helps is awaiting refresh."
  **Tests:** a served note is printed verbatim whatever the two verdicts
  are; without it the awaiting sentence.
- **R-13: Technicals judged the level from the Ledger.** "an extreme move"
  and the RSI's neutral / overbought / oversold came from whether a Ledger
  row was firing, a second response dated on its own. **Fix:** PROPOSED
  `technicals.move_20d_word` and `technicals.rsi_word`, printed as served;
  absent, the stat keeps its number and drops the word (the RSI's Now stat
  still says "rising", the gauge's name is "RSI 58"). **Tests:** `rsiWord`
  unit; a page test with served words ("an extreme move", "overbought")
  and one with both removed.
- **R-11: a free-form study saved no identity.** A study without a slug was
  saved with `study_slug: null`, so "the signal reverses" pointed at
  nothing. **Fix:** the POST carries PROPOSED `question`, exactly the six
  slots, whenever the served study has no slug; the reversal is offered
  only when the position can name its study (a slug or the six slots),
  so never without a carried study; the fixture server answers 422
  `{"error":"gate","missing":["study"]}` to a reversal without either, and
  the page words it ("the study the signal comes from"). §12.13's POST
  body and `wrong_if` entries say the same. The six slots are also all a
  saved Event Study question keeps: the served unit and name belong to the
  answer. **Tests:** a slug-less study's POST carries the six slots and
  nothing else in `question`; with no study carried the reversal is not
  offered; the fixture server refuses a reversal without a study, with a
  blank slug, with the served eight-key question, a seventh key, slots of
  the wrong kind or a window the slots cannot ask, and takes the six slots
  or a slug; a saved question holds six keys.

Verifier (one round): **PASS**, with should-fix items and nits, all
weighed:
- G2-1, G2-2 the Advanced events table's unit and the Client view's
  unit-less guard were untested (reverting either passed every test).
  **Fixed:** tests above.
- G2-3 the fixture server's gate took any value in each slot, a seventh
  key and a blank slug, and a test posted the served eight-key question.
  **Fixed:** the gate mirrors Event Study's own `isQuestion` and wants
  exactly the six keys; the test posts the six slots (above).
- G2-4 the spec named a chart axis the chart does not draw, said
  `n_events` prints only as EVENTS, and left the events rows' unit
  unstated. **Fixed** in §12.13.
- G2-5 the chart's ticks were tuned to percent ("−33 bp / +55 bp").
  **Fixed** (above).
- G2-8 saved questions kept the served unit and name. **Fixed:** the draft
  is the six slots (`slotsOf`).
- G2-9 Position Monitor named an unlabelled target from the series list
  while the other places left it unnamed. **Fixed** (above).
- G2-10 (older than this round) while the next carried study loaded, the
  previous answer stood in for it, so a save could bind to it. **Fixed:**
  a placeholder answer is not carried. **Test:** moving from one carried
  study to one still loading drops the subtitle and the reversal.
- G2-11 no schema test for the new fields, no test for the missing
  `n_complete`, and the bp variant kept the S&P's client paragraph.
  **Fixed:** `data/api.test.tsx` checks each new field's kind is removed
  when wrong; the missing-count test; `bpStudy` carries a bp paragraph.
- G2-6 (not changed) a by-regime or last-five cell without a unit prints
  "—", the table cell convention of §12.13, while a range row, a stat,
  says Awaiting refresh.
- G2-7 (not changed) "pts" is percentage points on a `pct` interval (§4's
  "−1.6 to +4.1 pts") and the target's own points on a `px` one; a
  study has one unit, so the two never share a page.

The fixes were checked by the four gates and the tests above, not by a
second verifier round. The compare shots are pixel-identical except
Event Study's (sub-pixel glyph placement in the last-five heading, now one
text run) and the Client view's, whose backdrop subtitle reads the served
target name, "Typical S&P 500 move after the setup", where the mockup's
fixed copy read "S&P"; both are regenerated.

### Group 3: fixtures and units (R-05, R-06, R-14) — `frame-3: codex-3 fixtures`

- **R-05: the study's regimes contradicted the regime fixture.** Two 2023
  events were labelled Stagflation where `/regime`'s history, read at the
  engine's two-month lag, says Recession Risk, and `/regime` only reaches
  back to 2021 (the Regime tab's last five years), so thirteen of the
  eighteen events had no row to check against. **Fix:**
  `fixtures/desk/regime-record.json`, the fixtures' monthly regime record
  from 1996-05, which no endpoint serves. Its last 68 rows are `/regime`'s
  history exactly. Its earlier rows follow each period's growth and
  inflation direction (the 2001 and 2008 recessions, the 2008 and 2011 oil
  spikes, the 2014–16 industrial slowdown), drawn without regard to the
  events. Its months by regime are now `/regime`'s `stats[].months` (154,
  88, 46, 76 since 1996, where the mockup had 142, 88, 61, 54). Every event
  takes the row stamped two months before its own month; nine events
  changed label. `by_regime` is recomputed from the events: Goldilocks 5,
  up 60%, +2.8%; Recession Risk 7, up 86%, +3.5%; Overheating 4 and
  Stagflation 2 print n<5 (§4). `last_events` follows, and so does the
  rail's note ("Today is Overheating: four events, too few to read
  alone."). The client summary no longer ranks backdrops; it says only
  Goldilocks and recession-risk months have enough episodes to read.
  **Test:** `fixtures/desk/consistency.test.ts`: the record is one row a
  month from 1996; its tail is the history; its counts are the stats;
  every event's regime is its K−2 row; `by_regime` and `last_events` are
  the events recomputed (n<5 rule included).
- **R-06: breakeven and max loss had no single definition, and the rows,
  the ratio line and the table disagreed.** The put spread's "max loss
  1.1%" sat beside a table losing 14% at NDX −10%. The breakevens were
  strike plus cost, and the ratio line's 1.6 × 0.39 is 62.4, not the 62 the
  table used. **Fix:** defined once in §12.13, per $100 of basket over the
  month at expiry. Each structure serves PROPOSED `legs` (strikes as NDX
  moves, +1 bought, −1 sold) and PROPOSED `protected_range` (`ndx_from`,
  `ndx_to`, `basis`). The notional is `beta × delta × 100` = 62.4, printed
  "$62.4 per $100". A scenario's hedged book is beta × x + notional/100 ×
  payoff − cost, unrounded (+14.9% at NDX +10%, where the mockup rounded
  to +15%). Breakeven is the basket move where that book is zero (+1.1%,
  +0.2%, +2.4%: the basket must earn back the cost). Max loss is the worst
  of that book over the structure's own range: between the strikes for
  the spread, "max loss $14.0 per $100 of basket, NDX −5% to −10% (its
  strikes)"; to the table's lowest move for the collar and the outright
  puts, which have no sold put ("… NDX −5% to −20% (table floor)"). The
  prose that quotes the payoffs is restated from them: the collar's "loses
  22.8% instead of 32%", the recommendation's "for 1.1% of the basket it
  pays up to 3.1%", and the why-index cost of 4.1% (1.7 × the outright's
  2.4%), where "about 3.8%" matched nothing. A max loss served without its
  range or basis prints "max loss awaiting refresh". **Tests:**
  `consistency.test.ts` recomputes, from the served legs, every scenario,
  each breakeven (the one crossing), each max loss and its range, the
  ratio line, and every number in the prose; `maxLossWords`; the boundary
  (a bad leg drops the legs, a range without both ends or its basis is
  null); the card's rows and table.
- **R-14: weights were rounded to a tenth.** 22.11 was not a weight (one
  decimal at most), a served 22.11 showed as 22.1, and 22.11/77.89 and
  22.14/77.86 both keyed as `22.1/77.9`. **Fix:** a weight keeps every
  digit, in the input, the basket's key, `POST /basket/price`, `/hedge?legs=`
  and the saved basket, written in decimal (a served 1e-7 is 0.0000001,
  never exponent notation). The total is summed digit by digit and counts
  as 100% only when it is exactly 100; the page prints it with every digit
  ("total 99.97%"), so it never says 100% of weights that do not add to
  it. Normalize leaves weights that add to 100 as they are and otherwise
  writes weights no coarser than the ones typed (22.11 and 77.86 become
  22.12 and 77.88); Equal-weight writes tenths. **Tests:** `weights.test.ts`
  (the two baskets' keys and legs, exact totals such as 99.9999999999 and
  0.1 + 0.2 + 99.7, normalize's precision, decimal output); a page test in
  which a served 22.11/77.89 basket is typed to 22.14/77.86, priced once at
  exactly those weights and shown at its own price; 22.11/77.86 prints
  99.97% and is not priced; saved, the hedge asks
  `legs=NVDA:22.14,AVGO:77.86`; reverted, the served basket.

Verifier (one round): **FAIL**, on should-fix items; no blocker, gates
green, the hedge math exact. All taken except G3-11:
- G3-1 the first record contradicted `/regime`'s stats (it could not
  produce 88 Overheating months), and its earlier rows had been written to
  fit the events' old labels. **Fixed** by the record above: drawn on its
  own, its counts are the stats, the events follow it.
- G3-2 the client summary ranked Goldilocks (n=5) above Overheating (n=6).
  **Fixed:** it ranks nothing.
- G3-3 a total rounded to print said "100%" of 99.99999. **Fixed:** exact
  digits.
- G3-4 Normalize rounded working weights to a tenth. **Fixed:** never
  coarser than typed.
- G3-5 a weight under 1e-6 was written as 1e-7 and then unreadable.
  **Fixed.**
- G3-6 a 1e-9 tolerance let 99.9999999999 count as 100. **Fixed:** exact.
- G3-7 the max losses cover different ranges, and "per $100" never said of
  what. **Fixed:** "per $100 of basket", and each row names its range and
  what bounds it; §12.13 says the three are not one comparison.
- G3-8 the new page test found the card before the lazy page loaded, and
  the exact-100 rule was not pinned on the page. **Fixed:** it waits, and
  99.97% is pinned.
- G3-9 the why-index 3.8% could not be derived; the ratio line said $62
  beside the note's $62.4. **Fixed** (above).
- G3-10 §10 still gave the mockup's hedge figures without a pointer, and
  the consistency test checked two prose numbers. **Fixed:** §10 points to
  §12.13; the test checks every prose number.
- G3-11 (not changed) the weight input shows about five characters, so
  21.99999 scrolls inside its field; the value is kept whole. Widening it
  is a layout change to an approved screen.

The fixes were checked by the four gates, not by a second verifier round.
Compare shots: Event Study (the rail's by-regime table, last five labels
and note), Regime (the months column), Basket & Hedge (the rows, the ratio
line, the table) and the Client view (the backdrop bars, the summary)
changed with their data and are regenerated; the rest re-shot identical.

### Group 4: dates and levels (R-04, R-08) — `frame-3: codex-4 dates-levels`

- **R-04: the badge dated the served basket, whatever numbers were on
  show.** After a repricing the stats were `POST /basket/price`'s, and the
  badge still printed `GET /basket`'s day. **Fix:** PROPOSED
  `prices_as_of` joins the priced fields, so a price answer carries its
  own day. The basket card reports the day of the answer whose numbers it
  shows, and the page's badge prints it: "Live · prices Sep 24 · options
  via EODHD" after a reprice dated Sep 24, the served day again after a
  revert. Weights that cannot be priced show no numbers and date none. When
  the numbers on show are undated, the card's own line says "prices date
  awaiting refresh", never borrowing the served day. The day is reported
  before paint, so no frame pairs one answer's day with another's numbers. The options surface is dated on its own, on
  the hedge card where its prices are: "priced off the SPY / QQQ surface
  of Sep 22", from `hedge.surface_as_of`. The mockup's "live" there is
  dropped, since the day now says how live it is (§12.13 records it).
  **Tests:** a reprice dated Sep 24 moves the badge to Sep 24 while the
  hedge card keeps its surface's Sep 23; revert brings back Sep 22;
  unpriceable weights and a failed price date nothing; an undated price
  says so in the card; an undated surface says so; the boundary keeps
  `prices_as_of` only as text; browser tests reprice at Sep 24 and read
  the badge, and serve an undated basket at 390 px with no sideways
  scroll.
- **R-08: any S&P-looking instrument got the index's levels.** SPY, an ES
  future, an SPX option and "S&P" in any phrasing were offered "closes
  below its 50-day (6,280)", though SPY trades near a tenth of the index.
  **Fix:** PROPOSED `technicals.instrument` (`{"symbol":"SPX","label":"S&P
  500"}`) names the one series every number in `/technicals` describes. A
  level carries its number only when the instrument is exactly that
  series, by label or symbol (case and spacing aside). Every other
  instrument gets the same rules named without a number, and "suggested
  for …" names what was typed. Matching ignores case, spaces at either end
  and repeated spaces, nothing more: "S&P500" and "S&P 500 index" are not
  the series, a conservative miss. `/technicals` served without `instrument`
  gives numbers to nothing. The S&P-guessing `onSpx` is gone. **Tests:**
  `describes`/`suggestions` units (SPY, a pair, an option, a future, a
  basket, the label and symbol in any case); Position Monitor with SPY (no
  6,280 or 5,910 anywhere on the page) then S&P 500 (the number back); the
  page with `/technicals` served without its instrument; the boundary
  takes the instrument whole or not at all; the same browser test types
  S&P 500 and then SPY (the index first, so the numbers are known to have
  arrived). The two page tests that typed an SPX option to reach the
  numbers now type the index itself.

Verifier (one round): **PASS**, one should-fix and nits, all weighed.
It drove every path by which the card shows numbers in a browser (a
served GET, a delayed reprice, a failed price, an undated price, save and
reload, a save in another window, a local-only basket, a basket switch
during a reprice, Express mode) and each dated exactly the answer on show.
- G4-1 the undated badge ("Live · prices date awaiting refresh · options
  via EODHD", 446 px, never wrapping) pushed a 390 px page 71 px sideways.
  **Fixed:** those words live in the card's line; the badge drops the
  prices part.
- G4-2 the day was reported after paint, so one frame could pair the old
  day with the new numbers. **Fixed:** reported before paint.
- G4-3 Technicals and the sidebar name the S&P from their own copy, not
  from `technicals.instrument`. **Not changed:** `/technicals` is the
  S&P's by §12.10. §12.13 now says the field is what a page reads when it
  must decide whether a typed instrument is that series.
- G4-4 the spec said "spacing and case aside", but "S&P500" does not
  match. **Fixed:** the spec says exactly what is ignored.
- G4-5 no test for the undated surface, for a failed price's badge, or for
  the SPY assertion when the numbers might not have arrived yet, and a
  helper sat between imports. **Fixed** (above).
- G4-6 §10's "live" subtitle and §9's "(6,280)" on an SPX option are the
  mockup's without a pointer. **Fixed:** both point to §12.13.
- While checking against HEAD, the verifier's second Vite server shared
  `node_modules/.vite` through a symlink and removed cached files the
  running fixture server used. It rebuilt them and the fixture server
  served every chunk again; nothing in the tree changed.

The fixes were checked by the four gates, not by a second verifier round.
Compare shots: only Basket & Hedge's hedge subtitle changed (the surface's
day); it is regenerated, and the rest re-shot identical.

### R-15: deferred to the API branch

R-15 (Build Notes renders nothing in the Docker image) is outside `web/`
and `docs/desk/`, so it is not fixed here. The image's web stage copies
only `web/`, and `.dockerignore` excludes both `docs` and `*.md`. The
page's glob finds nothing there and says the notes are not in the build.
The two lines for the API branch, exactly:

- `Dockerfile`, before `RUN npm run build` in the `webbuild` stage:
  `COPY docs/desk/BUILD_NOTES.md /build/docs/desk/BUILD_NOTES.md`
- `.dockerignore`, after the `*.md` line:
  `!docs/desk/BUILD_NOTES.md`

(Item 13 below: with the notes' figures, two more lines, `COPY
docs/desk/screens/*.svg /build/docs/desk/screens/` beside the first and
`!docs/desk/screens/*.svg` beside the second, or the image prints each
figure as "Figure: … (not in this build)".)

The glob in `BuildNotesPage.tsx` resolves from `/build/web/src/screens/desk/notes`
to `/build/docs/desk/BUILD_NOTES.md`, which is where the `COPY` puts the
file. Docker's exception pattern re-includes a file inside an excluded
directory, so the one negation clears both `docs` and `*.md`.

## Fold and alignment

The operator adjudicated a spec review in three amendment files,
`SPEC_AMENDMENTS_v2.md`, `v3.md` and `v4.md` (precedence v4 > v3 > v2), with
three clarifications from the final review (C-01 to C-03). This section
records the fold of those files into the spec (phase 1, one commit) and the
UI's alignment with the folded spec (phase 2, one commit per item). Every
place the UI now differs from a PNG is listed under its item with the spec
sentence that requires it.

### Phase 1: the fold — `frame-3: spec fold v2–v4`

`docs/desk/DESK_FRAME3_SPEC.md` is rewritten to v4's fold checklist, and the
three amendment files move, unedited, to `docs/desk/archive/` in the same
commit, so the history shows what was folded.

- **§1** carries the scope table (v2 §1 with v3's RSI, confidence and regime
  statistics unavailable, and the without-condition line unavailable), the
  "Live / Designed, not yet served" lists Build Notes prints (§1.0.1), the
  unavailable state (§1.0.2), the regime-color exception and chart colors
  (v2 D-36), the v1 verdict rule with B-13's four sentences (§1.5), units
  and display (§1.9, v3 §6, B-04) and dates and samples (§1.10).
- **§2–§11** follow the deltas: the Overview's since-last-close anchor and
  its four tiles; Technicals with the vol column, sector bars and RSI
  unavailable; the Event Study's catalog-only slots, the selected horizon,
  `matched_n` over the horizon's count (C-03), the disabled confidence chips
  and the unavailable comparison line (C-01), plus §4.1 for the engine's
  entry, horizon, cooldown, baseline, count, block and compute rules; the
  Regime's K−2 print, the recession score wording and the unavailable
  statistics card; Macro's curve and credit windows; Sectors unavailable;
  the Ledger's fixed order and header; positions in the browser under the
  gate rule, with automatic room only for the S&P's 50-day and 2s10s;
  Basket & Hedge unavailable; the Data Pipeline, Build Notes and the Client
  view's allowlist.
- **§12** is the contract for the nine live endpoints: the envelope and HTTP
  codes, the nested block envelopes at exactly B-08's paths plus the study's
  `without_condition` (C-01), the CSV columns, and a per-field table for
  every field with its type, presence, unit, date, frequency and source, and
  its engine basis: an existing function (E), a projection of the run's full
  event table (P), an authorized new calculation (N), adapter shaping (A),
  or a stored read (S). `data_status` contributors carry
  `observation_date`, `expected_observation_date`, `state` and `reason`
  (C-02). **§12.13** keeps only the deferred shapes: positions, basket,
  hedge, vol, sectors, correlations, RSI, confidence and without_condition.
  **§13** is session B's order, the engine scope allowed for Monday and
  session A's acceptance.
- Withdrawn sentences are gone, among them "A normal month is +1.3%",
  "one-in-eight over the next year", "Peak last cycle", "The condition earns
  its place", the top-level h = 20 verdict, v2 §19's Ledger sort, the live
  confidence selector, the old §12 shapes, the POST `/positions` contract
  and the PROPOSED fields of the earlier §12.13 (Codex round 1's included).

Verifier (one round): **FAIL**, one blocking finding and eight should-fix,
all taken:
- F-1 (blocking) the headline templates reused v2 §7's withdrawn definition
  copy and added "don't size on it", a recommendation drawn from a verdict
  (v2 §15). **Fixed:** the headline is the verdict's label, its horizon and
  its §1.5 sentence, nothing more.
- F-2 an automatic position already through its level would have been saved
  as manual (v3 §16 rejects it), and the S&P's 200-day read as automatic.
  **Fixed.**
- F-3 the `data_status` basis did not cover the two `asset_prices` inputs.
  **Fixed:** each contributor is judged by its store's existing policy.
- F-4 several dated blocks served no `freq` or `source`, and the averages no
  window. **Fixed.**
- F-5 `client` and `by_regime` did not carry their horizon. **Fixed.**
- F-6 references to "§3" for the firing state and an undefined basis code.
  **Fixed** (the S code is defined).
- F-7 the Build Notes list contradicted the Ledger's fixed twelve and left
  out the Client view and three Technicals values. **Fixed.**
- F-8 three engine bases did not match the code (the interval note's words,
  the recession percent, the pipeline's first date). **Fixed.**
- F-9 v2 rules no amendment withdrew had been dropped. **Fixed** in §4.1.
- F-10 `/study` could not say a firing study was stale. **Fixed:**
  `comparison_session` and `stale`.
- F-11 and F-12 (nits) the renames are recorded in §12.0; the empty state no
  longer says "too few to score" (an insufficient study is scored, B-02);
  the §12.13 number is explained; blank cells, spellings and the
  existing-endpoints sentence are fixed.

The fixes were checked by reading the file against the amendments, not by a
second verifier round.

### Phase 2, item 1: the envelope — `frame-3: align 1 envelope`

**What changed.** The data layer reads the §12.0 envelope
(`web/src/screens/desk/data/envelope.ts`, `data/api.ts`). A `ready` answer's
`data` is read with its block envelopes taken apart at exactly the paths
§12.0 lists (and only there). A block served awaiting inside a ready answer
is removed and its reason kept under `_blocks[path]`; one served without a
reason did not arrive ("Awaiting refresh"). The envelope's `as_of`,
`generation_id` and `engine_version` go beside the data. A `computing` answer
(202) is asked again at the same URL after its `Retry-After` (2 s when
absent, at most 30 s, 60 polls), and an unmounted page stops the polling. An
`awaiting` answer is a `DeskApiError` carrying the served `unavailable`,
never retried. An `error` answer carries the served code, message and the
refusal's fields. Only an answer that did not come (no answer, or a 5xx) is
retried, once.

The kit draws the unavailable state (§1.0.2) once for every card
(`kit/ui.tsx`): `Unserved` scopes a page or a card to a route served
awaiting, `useBlockUnserved` reads a card's own block, and `UnservedCard`
draws the card: its title and subtitle, "○ Not yet served", its stat labels
with no number, the served reason once ("Until: …" when served), and its
Advanced control disabled with "not yet served". Every Desk card honours a
route and its own block served awaiting: the Overview's since-last-close
line, four tiles and two cards; Technicals' five cards and page badge; the
Event Study's answer card, rail and the line without the condition; the
Regime's four cards (the next prints and the last five changes each on its
own); Macro's four cards and the matrix under Advanced; Sectors, the
Ledger, the Data Pipeline and the Client view; the sidebar's TODAY card.

The fixture files keep their payloads; the fixture resolver and the test
helpers (`src/test/desk.ts`, `e2e/lib/desk-fixtures.ts`) put every answer on
an enveloped route in its envelope on the way out, a ready block wrapped as
one. The existing endpoints under `/api/desk` (the frame-2 engine's
`/event-study`, `/pipeline/inventory`) and the text answers are not
enveloped.

**Tests.** `data/api.test.tsx` (every envelope state; a ready answer dated by
its envelope; a block served awaiting kept by path and its neighbours
standing; the listed paths only, a look-alike elsewhere left alone; a plain
object at a listed path dropped; 202 polled at the same URL after
`Retry-After`, the poll limit, an abort; `Retry-After` absent or odd; the
retry rule), `kit/Unserved.test.tsx`, and page tests for a route served
awaiting (Sectors, Macro, Event Study with its rail, the Client view,
Technicals) and for blocks served awaiting inside a ready answer (Regime's
statistics and changes, Macro's stock–bond, correlations and matrix, the
Overview's VIX tile and since-last-close line, the line without the
condition). Browser tests: Sectors served awaiting, and blocks served
awaiting on Regime and Macro, each at 1440 and 390 with the palette and no
sideways scroll.

**Against the PNGs.** No change: the fixtures still serve every block ready,
and all twelve compare shots are pixel-identical to the previous commit.
Items 7, 10 and 11 switch Monday's unavailable blocks on.

Verifier (one round): **FAIL**, taken. It confirmed the data layer (every
§12.0 rule, the non-enveloped routes, the retries, an unmount during a poll
with no unhandled rejection, the computing flow in a browser), and that six
mutations each fail a new test. Findings:
- I1-1 (blocking) nothing read a block served awaiting inside a ready
  answer. **Fixed:** every card reads its own block.
- I1-2 (blocking) Technicals' hand-built cards printed the reason zero or two
  times with no badge, and listed Ledger numbers under an unavailable
  answer. **Fixed** with `UnservedCard` and the page badge.
- I1-3, I1-4, I1-5, I1-6 the Event Study rail, the Client view's stats, the
  Overview's since line and tiles, and Regime's cards printed "Awaiting
  refresh" or the reason twice, or no badge. **Fixed.**
- I1-7 a 202 without `Retry-After` was asked again at once. **Fixed** (2 s).
- I1-8 Position Monitor and Basket & Hedge are not wrapped: **left**, since
  items 10 and 11 replace what those pages ask for (the browser's position
  store, and Basket & Hedge's unavailable state).
- I1-9 a block served awaiting without a reason got an invented one.
  **Fixed:** it did not arrive.
- I1-10 the abort listener outlived a finished wait, a 2xx error was
  retried, the 15 s timeout was lost without `AbortSignal.any`. **Fixed.**
  Left: in development React's StrictMode sends each first request twice
  (the first is aborted); an awaiting answer to the CSV export reads as a
  failed download, as before.
- I1-11 duplicated comments and an import order. **Fixed.**

The fixes were checked by the four gates and the tests above, not by a
second verifier round.

### Phase 2, item 2: units — `frame-3: align 2 units`

**What changed.** A target move is served native in `question.target_unit`
(`log_return`, `log_change` or `bp`) with `question.display_unit`
(`percent` or `bp`), and every Ledger row carries the same pair (§1.9,
§12.2, §12.5). `kit/units.ts` is main's linear log display, kept in the kit as the one display rule every tab uses: a log
return or log change prints as 100 × native with a % sign (0.031 → +3.1%,
never exponentiated), basis points print as served, and an unknown or absent
unit prints no move at all. Every log number carries the tooltip "log
return, ×100" (a `title`, or an SVG `<title>` in the chart); bp numbers carry
none. The interval `ci_lo`/`ci_hi` is native and bounds Δ = median −
baseline median: the rail's range prints it scaled ("−1.6 to +4.1 pts",
"−10 to +40 bp"), and the chart's whisker runs from `baseline_median + ci_lo`
to `baseline_median + ci_hi` in native units, then takes the same scale. The
answer card, the rail, the Advanced panel (the study's events and the
engine's tables, whose percent is the engine's 100 × log), the Client view,
and the Ledger, Overview and Technicals rows (their h = 20 medians, now in
each row's own unit, so a yield target prints bp) all go through it. The old
`pct`/`px` units and `ci_lo_pts`/`ci_hi_pts` are gone. Technicals' `chg_1d`,
`ret_1y`, `vs_ma50` and `vs_ma200` are unchanged: simple-return and
level-ratio fractions, × 100, no tooltip (B-04). The fixtures serve the new
fields (the study's intervals ÷ 100 into native units; the Ledger and
Overview rows `log_return`/`percent`); the bp test study serves
`bp`/`bp`.

**Tests.** `kit/units.test.ts` (100 × native, no exponentiation at 0.5 →
+50.0%, both log units, bp never a percent, the whisker from baseline + ci
then scaled, a difference in pts or bp, the tooltip on log units only, `pct`/`px`/`percent` refused as
target units); `api.test.tsx` (the schema keeps the three target units and
two display units, and drops the old ones); `EventStudyPage.test.tsx` (the
log study's numbers carry the tooltip in the answer, rail and chart, the
chart's top tick follows the whisker, the axis's zero untipped, the served
`why` tipped; a bp study has no tooltip);
`ClientView.test.tsx` (every log number and the served summary tipped, a bp
study none);
`LedgerPage.test.tsx` (a row in bp prints bp, a row without a unit prints a
dash, a log row carries the tooltip). Browser: a log study's median and
range carry the tooltip on Event Study and the Ledger; a bp study shows none.

**Against the PNGs.** No visible change: the numbers print as before
(+3.1%, −1.6 to +4.1 pts) and the tooltip shows only on hover. The Event
Study compare shot is regenerated: its chart whiskers and the line without
the condition moved by sub-pixel anti-aliasing (the whisker is now computed
in native units before scaling, and the median in that line is its own
element for its tooltip); the other eleven shots are pixel-identical.

Verifier (one round): **PASS**, with one should-fix and five nits:
- V2-1 (should-fix) the served `why` and `client.summary` carry log
  numbers in words with no tooltip. **Fixed:** a log study's `why` and
  summary carry it.
- V2-2 "vs normal" and "normal month" ignore the row's unit: **left for
  item 5**, which replaces them with each row's served baseline (closed
  there).
- V2-3 `diffText` untested. **Fixed:** tested ("+1.8 pts", "+6 bp").
- V2-4 the axis's zero and the engine table's dashes carried the tooltip.
  **Fixed.**
- V2-5 the unit rule lived under Event Study while four tabs import it.
  **Fixed:** moved to `kit/units.ts`.
- V2-6 the browser bp test does not re-serve `/study/events`: covered by
  the unit test that serves the bp events list to the Advanced table.
- V2-7 (outside this item) the RSI card's "S&P +1.1% a month later", the
  RSI rows' units, and the Regime blocks' S&P numbers are items 7 and 12.

The fixes were checked by the four gates and the tests above; the twelve
compare shots re-shot after them are identical.

### Phase 2, item 3: counts and horizon — `frame-3: align 3 counts-horizon`

**What changed.** A study serves its size once, `matched_n` (retained
events, the same at every horizon), and each horizon's own count `n` beside
its `up_n`, median, extrema and interval (§12.2, C-03). The answer card is
the selected horizon's (§1.5, v4 B-01): it reads `selected_horizon` (the
served question's horizon when that is absent) and never borrows another
horizon's row, so a selected horizon that was not served says Awaiting
refresh. EVENTS prints `matched_n` with "<n> complete at <horizon label>"
beneath; UP <H> LATER prints "<up_n> of <n>" from the same horizon; MEDIAN
and WORST · BEST are that horizon's. The empty state follows the same
horizon: a served `empty_state`, a Too few verdict, or fewer than ten
completed outcomes at the selected horizon print the served sentence and
the served fixes with no chart; without a served sentence the page prints
§12.2's template on the horizon's own count and offers no fix. A study answered Too few is still
scored (B-02), so the rail reads it in full; the "Not scored" placeholder
is gone. The rail's by-regime rows are at h = 20: a regime under ten events
(the engine's `MIN_REGIME_N`) prints its count and "too few cases to say"
across Up and Median, and `unlabeled_n`, when above zero, prints "Unlabeled:
<n> events before the first labelled month". An interval served null
under five blocks prints its served `reason` in words, not "Awaiting
refresh", and an empty event list says "No events". Advanced lists "all
<matched_n> events". The Client view asks the study at h = 20 whatever
horizon the desk has selected, so its episodes, month statistics and empty
state are the month's (§11, B-01); a study too thin to read at a month says
so in plain words there, never in the desk's verdict sentence. Ledger rows and the Ledger carry
`horizon: 20`.

The fixtures serve the new fields: `matched_n` 18, `selected_horizon` 20,
every horizon's `n`, `up_n`, worst and best recomputed from the study's
event list, `by_regime` with `h: 20` and its cells null under ten events,
`unlabeled_n` 0, `empty_state` null, `client.horizon` 20, and `client.summary`
in §12.2's template ("Looking at 18 episodes since 2000, the S&P 500 was
higher a month later in 12 of 18, with a typical move of +3.1% against
+1.3% in an ordinary month."). The consistency
test recomputes each horizon's counts, share, median and extrema from the
events and the by-regime rows at the ten-event floor.

**Tests.** `consistency.test.ts` (each horizon's own completed outcomes;
by regime at ten; the regime counts and `unlabeled_n` sum to `matched_n`);
`EventStudyPage.test.tsx` (EVENTS over the horizon's count; a changed
horizon count is the only denominator; a study at 1 week reads the 1-week
counts, share, median and extrema; a selected horizon not served stands in
for nothing; Too few at 3 months with the served sentence and fixes, no
chart, the full rail; the template and no invented fix when no sentence is
served; an interval's served reason; No events; the Unlabeled line; by-regime rows under ten read too few across both cells);
`ClientView.test.tsx` (a desk question at 1 week is asked at a month;
the backdrop reads too few when every regime is under ten; a thin study in
plain words, with no verdict language); `api.test.tsx` (per-horizon `n` checked by kind). Browser: the
EVENTS sub-line and the four too-few rows at 1440 and 390, whole on one line,
no sideways scroll, the palette.

**Against the PNGs.**
- 03 Event Study, EVENTS: the PNG's sub-line "since 2000" is now "18
  complete at 1 month". §4: "EVENTS `matched_n` with the sub-line "<n>
  complete at <horizon label>" (C-03)".
- 03 Event Study, By regime: the PNG's percentages and medians for regimes
  of five and six events, and its "n<5" cells, are now each regime's count
  and "too few cases to say". §4: "a regime with n < 10 prints its count and
  "too few cases to say" (v2 §9.2)"; §12.2: `by_regime[].up_pct`, `median`
  "null when n < 10, `MIN_REGIME_N`".
- 03 Event Study, the rail: "too few cases to say" starts under UP and runs
  across UP and MEDIAN, where the PNG had a value or "n<5" in each column.
  Same sentences as above.
- 12 Client view, the summary: the PNG's paragraph ("about two times in
  three … a typical gain of about 3% … only Goldilocks and recession-risk
  months have enough episodes to read") is now §12.2's template. §12.2
  `client.summary`: "Looking at <matched_n> episodes since <sample_start
  year>, the <target label> was higher a month later in <up_n> of <n>, with a
  typical move of <median> against <baseline_median> in an ordinary month."
- 12 Client view, the backdrop: the PNG's three bars are now four "too few
  cases to say" rows, because every regime of the fixture's 18 events is
  under ten (the data audit finds the same for the store today: 2, 6, 9 and
  1). §11: "four regime rows with the h = 20 `by_regime` median on one
  scale, "too few cases to say" when null".

Verifier (one round): **PASS**, with two should-fix findings and six nits.
It agreed with every design decision put to it (the horizon read from
`selected_horizon` and never from another row, the empty-state trigger, the
full rail for a Too few study, the ten-event floor by regime, the Client
view asked at a month) and recomputed every horizon's fixture statistics
from the events on its own.
- V3-1 (should-fix) the served Client summary still named two readable
  regimes beside a backdrop that now reads too few for all four. **Fixed:**
  the fixture serves §12.2's template.
- V3-2 (should-fix) a Too few study's rail said "Awaiting refresh", in mono,
  for an interval served null on purpose. **Fixed:** `horizons[].reason`
  is read and printed in words.
- V3-3 the answer card no longer prints the sample's start. **Left:** §4
  fixes the EVENTS sub-line as "<n> complete at <horizon label>" (C-03); the
  provenance line under the grid carries each input's history.
- V3-4 an empty state without served fixes invented two, which lead
  outside the catalog. **Fixed:** only served fixes, and the note that said
  "there is no condition to drop" is gone.
- V3-5 an awkward fallback sentence. **Fixed.**
- V3-6 the spanned cell sat under MEDIAN. **Fixed:** it starts under UP.
- V3-7 an empty event list left a bare heading. **Fixed:** "No events".
- V3-8 the Client view printed the desk's Too few sentence; the fixture
  test counted incomplete events by regime; two stale comments. **Fixed.**
- Outside this item, as it noted: the verdict box's `verdict_line` and
  `what_to_do` (item 4), the unhorizoned line without the condition
  (item 7), and `Price it →` on a Too few study (item 11).

The fixes were checked by the four gates and the tests above; the two
changed compare shots were re-shot after them.

### Phase 2, item 4: verdicts — `frame-3: align 4 verdicts`

**What changed.** The Overview's Active signals footer and the Signal
Ledger's footer print exactly v4 B-13's four definitions (§1.5): Reliable,
Suggestive, No edge and Too few, each name in its verdict color, two by
two. Every verdict pill for `insufficient` reads "Too few" with the dashed
gray border (the Ledger, the Overview's active signals, Technicals' list,
whose pills now keep the kit's own type and gray);
the rail's range rows print it as a word. `/study` serves `verdict_rule`
("v1") and `verdict_confidence` (0.90), and `/ledger` its `verdict_rule`
(§12.2, §12.5); the Event Study's provenance line ends "verdict rule v1 at
90% · slug …" when both are served, and the Advanced panel's resampling
detail states the same rule above the four definitions in place of its old
verdict sentence. The rail's verdict box is §4's: `VERDICT · <label>`, the
served headline, the served why and `Price it →`; the withdrawn
`verdict_line` and `what_to_do` (a verdict turned into trading advice) are
gone from the contract, the fixtures and the page.

The gold study's fixture serves §12.2's templates: the headline "Suggestive
at 1 month: 10+ completed outcomes; excess medians lean the same way at 5,
10 and 20 sessions, but not all Reliable criteria are met." and the why "18
completed outcomes in 18 overlap blocks; the 90% interval on the excess
median runs −1.6 to +4.1 pts; 14.6% of resampled medians are adverse
against a 3% bar." The block count and adverse share are the engine's for
this study, read by running `src/desk/event_study.py` read-only on a scratch
copy of the owner's database (18 blocks, `opposite_sign_share` 0.146). Each horizon now serves its `n_blocks`, `adverse_share`, `draws` and
`method` from the same run, so the why traces to `horizons[selected]`. Rule
v1 reads the lean at 5, 10 and 20 sessions whatever the horizon, so the
fixture's 3-month verdict is Suggestive, not No edge. The Ledger's NO EDGE
card is the count alone (§8); its sub-line repeated the withdrawn
definition.

**Tests.** `consistency.test.ts` (the why rebuilt from
`horizons[selected]` word for word); `OverviewPage.test.tsx` (the four definitions word for word; a
Too few row's dashed pill); `LedgerPage.test.tsx` (the same on the Ledger);
`EventStudyPage.test.tsx` (the served headline; the verdict box is exactly
label, headline, why and Price it; 3 months Suggestive under v1; the
provenance line with and without the served rule). Browser: a Too few pill
computes a dashed border on the Ledger and on Technicals at 11.5px, never
over its sentence; both footers carry four definitions at 1440 and 390, one
column on a phone however the page was reached, with no sideways scroll and
the palette.

**Against the PNGs.**
- 01 Overview and 07 Signal Ledger, the footers: the PNGs' three
  definitions ("the edge survives resampling…", "leans one way but the range
  still crosses zero; don't size on it", "about the same as any month") are
  now B-13's four, two by two, which makes both footers taller. §1.5: "The
  Overview and Ledger footers print exactly:" the four sentences; v4 B-13:
  "The Overview and Ledger footers use exactly these four sentences."
- 03 Event Study, the headline: the PNG's "Leans positive a month out, but
  not something to size on." is now the served template. §12.2: "`headline`:
  "<verdict label> at <L>: " followed by that verdict's §1.5 definition… It
  adds no advice; no recommendation is inferred from a verdict (§12.0)."
- 03 Event Study, the verdict box: the PNG's "Lean, don't size." and the
  call-spread sentence are gone; the box prints the headline and the why.
  §4: "VERDICT box (amber border for Suggestive): `VERDICT · <label>` / the
  served `headline` / `why` / `Price it →`".
- 03 Event Study, the range rows: 3 months reads Suggestive where the PNG
  had No edge. §1.5 rule 3: "the finite excess medians (median −
  baseline_median) at h = 5, 10 and 20 are all strictly positive, or all
  strictly negative → `suggestive`."
- 07 Signal Ledger, NO EDGE: the PNG's sub-line "shown so you know they
  were checked" is gone. §8: "NO EDGE (count)".
- 02 Technicals, the signal list: the verdict pills print in the kit's
  11.5px type and No edge in gray, where the build had drawn them in the
  sentence's 13px light type. §1.3: "gray #8b929e | No edge · Too few".
- 03 Event Study, the provenance line gains "verdict rule v1 at 90%". §4:
  "`… · verdict rule v1 at 90% · slug <slug>`".

Verifier (one round): **PASS**, with three should-fix findings and three
nits. It confirmed the four sentences word for word at 1440, 1101 and 390,
the rail box, the headline and why against its own read-only engine run,
and all four horizons Suggestive under v1 and in the engine.
- V4-1 (should-fix) the phone rule for the definitions lived in the
  Overview's stylesheet, so the Ledger's footer had one column or two
  depending on the page loaded first. **Fixed:** the rule lives with the
  kit's `.dk-defs`.
- V4-2 (should-fix) the bp test study kept the log study's why. **Fixed:**
  it serves its own, in bp, and a test says the box has no "pts".
- V4-3 (should-fix, from the Technicals commit) the list's sentence style
  also caught the verdict pill, which printed at 13px in light text and, on
  a phone, lay over the sentence. **Fixed:** the sentence has its own class.
- V4-4 the served why's numbers were not fields of the response.
  **Fixed:** `n_blocks`, `adverse_share`, `draws`, `method` per horizon, and
  a test that rebuilds the why from them.
- V4-5 the Ledger's NO EDGE sub-line repeated the withdrawn definition.
  **Fixed:** removed.
- V4-6 the Advanced panel's definitions sat flush and its verdicts were
  uncolored. **Fixed.**
- Noted, outside this item: the Overview's Active signals rows crowd their
  names at 1101 (the name column shrinks to about 40 px); the Trend tile's
  "that signal is reliable" reads a non-§12 field; the Technicals note's
  em-dash aside. The last is item 5's; the first two are left for item 12's
  labels pass.

The fixes were checked by the four gates and the tests above; the changed
compare shots were re-shot after them.

### Phase 2, item 5: baselines — `frame-3: align 5 baseline`

**What changed.** There is no universal normal month (§1.5, §4.1). Every
Ledger row, and so every Overview active signal and Technicals row, serves
its own study's `baseline_median` at h = 20 and `vs_normal` = 100 ×
(median − baseline_median) in log percentage points, or the native
difference in bp (§1.9, §12.5, v3 §6). The Ledger's VS NORMAL column and
the Overview's "(+D vs normal)" print the served `vs_normal` in the row's
own unit ("+1.8 pts" with the "log return, ×100" tooltip, "+6 bp" for a bp
target) through the kit's `vsNormalText`. The withdrawn `normal_month`
("+1.3%") is gone from the contract, the fixtures and all three pages: the
Ledger's footer now reads "vs normal compares each study to its own
baseline over its own sample." above "a month = 20 sessions · engine as of
<as_of>" (§8), and Technicals' Signals note box is §3's same sentence,
replacing "A normal month is +1.3%; "Reliable" means the edge over that
survives resampling" and the in-regime count, which read `cross.in_regime`,
a field the folded §12.7 does not serve (`cross` is `{kind, date}`).

The rows' baselines are each study's own: for the eight studies the store
can run, the engine's h = 20 `baseline_median` from the same read-only run
on a scratch copy of the owner's database (the S&P rows between +1.30% and
+1.31% over their own samples, HY spreads' +1.48% over its three years);
the four rows item 7 makes unavailable (the dollar, oil and the two RSI
rows) carry an illustrative +1.3% until then. The rows' medians stay the
fixture's until item 12, so a row's vs normal moves only where its own
baseline differs (HY spreads: +1.6 pts under the old normal month, +1.4
pts against its own). The gold study's h = 20 baseline in the study
fixture is the same 0.013136 its Ledger row serves: one study, one
baseline. The only "+1.3%" left on the Desk is that study's own served
baseline on Event Study and the Client view. This closes V2-2 (item 2's
note that "vs normal" ignored the row's unit).

**Tests.** `consistency.test.ts` (every row's `vs_normal` is 100 ×
(median − baseline_median); the baselines differ by row; an Overview row's
numbers are its Ledger row's; the gold row is the study's own h = 20 row;
no `normal_month`); `kit/units.test.ts`
(`vsNormalText` in pts and bp); `LedgerPage.test.tsx` (the footer word for
word with no "normal month", the date kept on one line; a bp row prints
"+12.5 bp" and "+6 bp"; HY's own "+1.4 pts" with its tooltip);
`OverviewPage.test.tsx` (a bp row reads "+12.5 bp (+6 bp vs normal)" with
no log tooltip); `TechnicalsPage.test.tsx` (the note box is §3's sentence
and nothing of the normal month survives). Browser: no "normal month" or
"+1.3%" renders on the Overview, Technicals or the Ledger.

**Against the PNGs.**
- 07 Signal Ledger, the footer: the PNG's "normal month +1.3%" is gone and
  "vs normal compares each study to its own baseline over its own sample."
  stands above the facts. §8: "Footer: the four §1.5 definitions + "vs
  normal compares each study to its own baseline over its own sample." +
  `a month = 20 sessions · engine as of <as_of>`"; §1.5: "there is no
  universal normal month."
- 07 Signal Ledger, VS NORMAL: HY spreads reads +1.4 pts against its own
  baseline. §1.9: "`vs_normal` = `100 × (median − baseline_median)`".
- 02 Technicals, the Signals note box: the PNG's in-regime count and "A
  normal month is +1.3%" sentence are now §3's sentence. §3: "Note box: "vs
  normal compares each study to its own baseline over its own sample.""
- 03 Event Study: the 1-month gray bar moves by a fraction of a pixel
  (its baseline is 0.013136, the study's own, where it was 0.013).
- 01 Overview: no visible change (the numbers print as before; the "vs
  normal" figure is now its own element for its tooltip).

Verifier (one round): **PASS**, no blocking or should-fix finding. It
re-ran the engine on its own copy of the database (all eight baselines
match to six places), checked `vs_normal` on all twelve rows, the bp path
in the browser, and the Technicals price-card callout, which §3 keeps and
this item leaves alone. Nits, all taken:
- V5-1 the gold study's h = 20 baseline was 0.013 in the study fixture and
  0.013136 on its Ledger row. **Fixed**, with a test that pins them.
- V5-2 the Overview had no bp test for "(+D vs normal)". **Added.**
- V5-3 nothing in the browser suite kept the normal month off the three
  tabs. **Added.**
- V5-4 this section and V2-2's closure. **Done.**
- Noted for item 12: HY spreads' row pairs a fixture median with its real
  baseline; on the store the study has two events at a month and would
  read Too few. For item 7: the four unavailable rows' illustrative values.

The fixes were checked by the four gates and the tests above; the compare
shots were re-shot after them.

### Phase 2, item 6: the regime row and the recession score — `frame-3: align 6 regime-recession`

**What changed.** The regime governing today is the stored row stamped
K−2 for the current session month (§5, v2 §9.1): a September session reads
the July row. `print` is that row's month ("2026-07"), and every surface
names it as a row: the Overview's regime tile badge "● Live · Jul row", the
Regime page's badge "● Live · Jul row · Sep 22", the sidebar's TODAY card
"regime · Jul row" (§1.1), and IN THIS REGIME "since the June row".
`/regime` `current` also serves `latest_print`, the newest stored row,
which the Regime page prints beside the label as "Latest print: Aug 2026"
and nothing classifies from.

The recession block is §12.6's: `score` (a fraction), `probability_month`,
`inputs_through`, `feature_months`, `band` (`low` | `elevated` |
`high_risk`, v3 §11's edges at 0.20 and 0.40), `year_ago` and `peak` as
`{score, probability_month}` (the peak over "since 2015"), `training`,
`methodology`, `freq`, `source`. The Overview tile's sub-line is "Low ·
score for Aug 2026 · inputs through May 2026"; the Regime card is titled
"Recession score" with §5's subtitle, prints the score and its band word
("Low.", "Elevated.", "High risk."), the sub-line, a gauge of Low /
Elevated / High risk at 20% and 40%, and INPUTS THROUGH · A YEAR AGO (its
month; "—" when served null) · PEAK SINCE 2015 (its month). The "What it
is" box names the trained span ("trained Apr 2003 to Sep 2026; historical
scores are in-sample"). Gone: "one-in-eight over the next year", "on data
through May", the Watch band, "Peak last cycle" and "since 1970" (also in
the card's Advanced line, which item 7 disables).

The recession fixture serves real values at the engine's full precision
(§12.0): 0.11644… for Aug 2026 on inputs through May 2026, 0.17172… a year
before and the 0.95497… peak of Jun 2020 (the data audit's §2.1 and §2.4,
confirmed by the verifier's own run), and the training span 2003-04 to
2026-09 (281 rows) from a read-only run of `src/analytics/recession.py` on
a scratch copy of the owner's database. The withdrawn `reads.year_ago`
("rising slowly, still low") and the kit's `oneIn` ("one-in-eight") are
gone. The regime rows come from the fixtures' own
monthly record, where the July row is Overheating in its second month;
item 12 moves them to the store's, where the July row is Goldilocks.

The language test allows "model" in a sentence naming the recession model
(the spec's `source` string) and pins §5's folded "What it is" sentence.

**Tests.** `consistency.test.ts` (both tabs serve the K−2 row, its run and
the newest row beside it; the tile's recession fields are the Regime tab's;
the band follows the edges); `RegimePage.test.tsx` (the second month in a
row since the June row, "Latest print: Aug 2026"; the score line, the
sub-line, the gauge's three bands at 20/20/60%, the three stats, the
trained span, no withdrawn phrase; a null year ago prints "—"; Elevated and High risk; no training span, no
latest print);
`OverviewPage.test.tsx` and `DeskShell.test.tsx` (the Jul row, the tile's
sub-line). Browser: the Regime page at 1440 and 390 (the row badge, the
latest print, the sub-line, the gauge's High risk band, the sidebar), in
the palette with no sideways scroll.

**Against the PNGs.**
- Every tab, the sidebar's TODAY card: "regime · Aug print" is now
  "regime · Jul row". §1.1: "`regime · <Mon> row` beneath (the K−2 row
  governing today, §5; e.g. "Overheating · Jul row")".
- 01 Overview, the regime tile's badge "Live · Aug print" is now "Live ·
  Jul row" (§2: "`● Live · <Mon> row`"); the recession tile's sub-line
  "Low · one-in-eight over the next year, on data through May" is now "Low
  · score for Aug 2026 · inputs through May 2026" (§2: "<band> · score for
  <probability_month> · inputs through <inputs_through>").
- 04 Regime, the badge reads "Jul row" (§5: "`● Live · <Mon> row ·
  <date>`"); "Latest print: Aug 2026" sits beside the label (§5:
  "Beside the label, separately: "Latest print: <latest_print>""); "Second
  month in a row", "2 mo since the June row", where the PNG counted from the
  August row (§5: "`current.label`, the stored row stamped K−2").
- 04 Regime, the recession card: the title "Recession probability" is now
  "Recession score" with §5's subtitle; "Low. About one-in-eight over the
  next year." is "Low." with "score for Aug 2026 · inputs through May
  2026" beneath; the gauge's Low / Watch / Elevated at 25% and 50% is Low /
  Elevated / High risk at 20% and 40%; A YEAR AGO 17% (Aug 2025) replaces
  9% and its read; PEAK LAST CYCLE 71% (Mar 2020) is PEAK SINCE 2015 95%
  (Jun 2020); the box says "trained Apr 2003 to Sep 2026; historical scores
  are in-sample" where it said "since 1970". §5 (the Recession score
  paragraph), §12.6 (`band` "A rule: low < 0.20 ≤ elevated < 0.40 ≤
  high_risk (v3 §11)"; `peak` "the maximum of the served score series since
  2015"; `training` "never a hard-coded 1970").

Verifier (one round): **PASS**, with two should-fix findings and four
nits. It confirmed the K−2 row on every surface, that nothing classifies
from the latest print, every band word and a null year ago in a browser at
1440, 1101 and 390, and the training span on its own copy of the audit's
store.
- V6-1 (should-fix) the peak was served as the audit's rounded 0.955 and
  printed 96%; the engine's 0.95497… prints 95%. **Fixed:** full
  precision for the score, a year ago and the peak.
- V6-2 (should-fix) the fixture still served `reads.year_ago`, now false
  ("rising slowly" against a fall from 17% to 12%) and read by nothing.
  **Fixed:** removed from the fixture, the schema and the type.
- V6-3 the language allowance named "recession score", which no string
  needs, and a pattern that could never match. **Fixed.**
- V6-4 the kit's `oneIn` had no caller left. **Removed**, with its test.
- V6-5 at 1101 the tile split "Aug / 2026". **Fixed:** a month keeps its
  year on the line, on the tile and the card.
- V6-6 a stale comment and three untested cases. **Fixed.** It also noted
  that Build Notes' own prose says "the recession probability is a model";
  that file is the owner's, and item 13 renders it.

The fixes were checked by the four gates and the tests above; the compare
shots were re-shot after them.

### Phase 2, item 7: the unavailable states — `frame-3: align 7 unavailable`

**What changed.** Every block §1.0 marks UNAVAILABLE now arrives and renders
as unavailable (§1.0.2): its card keeps its title, subtitle and stat labels,
prints the served reason once, reads "○ Not yet served", shows no number,
chart or gauge, and its Advanced control is disabled with "not yet served".

- **Overview.** The VIX tile prints the level and its day ("VIX 16.2 · Sep
  22", §2) and, for its unserved half, §1.0's reason ("The gap to realized
  and the band word: realized-volatility method not specified."); `tiles.vol` serves `vix`, `date`, `freq`, `source` only
  (§12.1). The since-last-close line loses the skew (no vol surface is
  served) and the dollar's new fire (its study cannot run while DXY is not
  stored).
- **Technicals.** The vol column and the sector bars read `/technicals`'
  own `vol` and `sectors` blocks (§3, §12.7), served awaiting with §12.7's
  reasons; the page no longer asks the deferred `/vol` and `/sectors` stubs.
  The RSI card has no served envelope, so it prints §1.0's reason; the RSI
  fields are gone from the contract, and the Signals list omits the RSI
  rows while they are unavailable.
- **Event Study.** §12.2 has no `confidence` parameter: the page never
  sends one, an old address's is ignored, and the rail's 80 / 90 / 95%
  chips render disabled with "not yet served", 90% marked as the engine's
  level (`verdict_confidence`), and, since they have no envelope, the rail
  prints §1.0's reason beneath them ("Confidence levels other than 90%:
  interval projection at other quantiles is new plumbing."); the served
  confidence note is gone. The line
  without the condition prints its block's reason ("conditional-versus-
  unconditional comparison is not defined", C-01); its ready form, a
  deferred shape, is no longer read.
- **Regime.** "What each regime has meant" and the last five changes are
  served awaiting ("regime statistics not yet defined in the engine.").
- **Macro.** Stock–bond, what moves with the S&P and the matrix are served
  awaiting ("Treasury and credit price-return series not ingested."); the
  matrix's Advanced opens only once the matrix is served; with them gone, the
  page badge reads "FRED" (§6).
- **Sectors.** `/sectors` is a deferred stub answering the awaiting
  envelope; both cards print §7's reason.
- **Signal Ledger.** The dollar, oil and two RSI rows are unavailable
  (`available: false`, the engine's `not_stored` reason for the two tier-2
  series, §1.0's for RSI): each keeps its label and prints its reason across
  the value columns, with no pill, and opens nothing. SIGNALS SCORED is
  `scored_n` with "8 scored · 4 not yet served" (v4 B-02); FIRING NOW,
  RELIABLE, NO EDGE and the filters count available rows only. NOW reads
  "○ Stale · <evaluated_on>" when a row's last evaluable session is not the
  comparison session, and a stale row is never firing or tinted (v3 §3).
- **Advanced controls (§1.4).** The kit's `AdvancedPanel` is disabled with
  "not yet served" unless it opens something real: Event Study's (the
  study's `/study/events`), Macro's matrix and Technicals' sectors once
  their blocks are served. Basket's export, import, revert and delete are
  the card's own local controls (§1.8, §10), so they move out of Advanced to
  sit with Save, and its Advanced is disabled like the rest.
- **Reads (§1.4).** No `reads` are served on Monday; the fixtures drop them
  and their boxes go.
- The deferred shapes stay as samples for the unit tests that render their
  cards once served: `vol.json`, `sectors.json`, and the new
  `deferred-macro.json` and `deferred-regime.json` (without reads: the
  deferred shapes carry none). The schema gains
  nullable enums, since §12.5 serves a row's verdict, units and firing state
  null when the row is unavailable.
- A kit fix found by the compare shot: a `StatRow` with `cols` now flows by
  row, so the vol column's four labels stack instead of overlapping.

**Tests.** Unit: each tab's Monday state from the fixture as served (the
three Technicals cards, Sectors, Macro's three blocks, Regime's two, the
line without the condition, the VIX tile, the Ledger's header, rows,
filters and stale NOW, the confidence chips asking nothing); the deferred
cards against the served samples; the deferred shapes against their
schemas, as stubs and as `/technicals` blocks; `StatRow`'s flow. Browser:
the Technicals cards and the Ledger's unavailable rows at 1440 and 390 in
the palette with no sideways scroll; the chips disabled, nothing asking with
a confidence; Event Study's Advanced still a blue link.

**Against the PNGs.** Each difference below is the unavailable state
§1.0.2 describes, on the block §1.0's table names:
- 01 Overview: the VIX tile's "Calm · protection costs about 4 pts more
  than recent moves justify" is now "VIX 16.2 · Sep 22" and "The gap to
  realized and the band word: realized-volatility method not specified." (§1.0: "Overview: VIX
  "gap vs realized" and the vol band word | UNAVAILABLE"; §2: "VIX <level>
  · <date> (the gap to realized and the band word are unavailable, §1.0)");
  the since-last-close line loses "Dollar −2σ fired (new)" and ", skew
  steeper" (§1.0: the Ledger's WTI and DXY rows unavailable; the vol column
  unavailable).
- 02 Technicals: the vol column, the sector bars and the RSI card are
  unavailable cards (§3: "What protection costs right now … UNAVAILABLE",
  "Sector leadership … UNAVAILABLE", "Momentum · RSI: UNAVAILABLE (§1.0;
  no served envelope, §1.0.2)"); the Signals list has four rows (§3: "the
  RSI rows are omitted while unavailable").
- 03 Event Study: the confidence chips are disabled with "not yet served",
  §1.0's reason sits beneath them (§1.0.2: "A block that is unavailable by
  §1.0 but has no served envelope (the RSI card, the confidence chips) prints
  the reason in §1.0's table"), and the confidence note is gone (§4: "Confidence chips 80% / 90% / 95%
  render disabled with "not yet served"; 90% is the served level"); the line
  without the condition prints its reason (§4: "Comparison line: the
  `without_condition` block, UNAVAILABLE (§1.0, reason
  "conditional-versus-unconditional comparison is not defined")").
- 04 Regime: "What each regime has meant" and the last five changes are
  unavailable (§5: "What each regime has meant: UNAVAILABLE"; "LAST FIVE
  REGIME CHANGES · S&P A MONTH LATER: UNAVAILABLE"); the "Read for the
  desk" boxes are gone (§1.4: "No read is served on Monday; the box is
  omitted"); every card's Advanced is disabled (§5: "Footer `Advanced ▸`
  disabled, "not yet served"").
- 05 Macro & Correlations: "Do bonds still hedge stocks?" and "What moves
  with the S&P" are unavailable, the curve's front-end words and the reads
  are gone, the Advanced controls are disabled, and the badge reads "FRED"
  (§6: "Badge `● Live · FRED · <date>`") (§6, §12.8: "awaiting:
  "Treasury and credit price-return series not ingested.""; §1.4).
- 06 Sectors: both cards are unavailable (§7: "`/sectors` answers the
  awaiting envelope (reason "sector ETFs, RSP and IWM not ingested.")").
- 07 Signal Ledger: SIGNALS SCORED reads 8 with "8 scored · 4 not yet
  served", FIRING NOW 1, RELIABLE 2, NO EDGE 3; the dollar, oil and RSI rows
  print their reasons with no pill (§8: "SIGNALS SCORED `scored_n`
  ("<scored_n> scored · <unavailable_n> not yet served", v4 B-02) …
  Unavailable rows are excluded from every count but the first"; "An
  unavailable row keeps its label and prints its reason across the value
  columns, with no pill").
- 09 Basket & Hedge: both cards' Advanced controls are disabled, and the
  basket's Export, Import, Revert and Delete sit under Save basket (§1.4:
  "An Advanced control is enabled only when the endpoint it opens exists in
  §12"; §1.8: "an Export / Import JSON control"); item 11 makes the rest of
  the tab unavailable.

Verifier (one round): **FAIL**, one blocking finding, two should-fix and
five nits, all taken but one. It walked §1.0's table row by row (no
unavailable block shows data, no live block is disabled), every Advanced
control, the Ledger's header, counts, unavailable rows and stale NOW, and
that nothing sends `confidence`, at 1440, 1101 and 390 on eight tabs.
- V7-1 (blocking) the confidence chips did not print §1.0's reason, which
  §1.0.2 requires of a block with no envelope. **Fixed.**
- V7-2 (should-fix) the VIX tile printed a sentence of its own instead of
  §1.0's reason, and "VIX level" where §2 has the level. **Fixed.**
- V7-3 (should-fix) Basket's Advanced was the one enabled control opening
  no endpoint, and its sentence claimed stats Monday does not serve.
  **Fixed:** the local controls sit with Save; Advanced is disabled.
- V7-4 unavailable and stale rows sit under "Quiet · sorted by verdict":
  **left for item 12**, whose fixed order replaces the grouping.
- V7-5 the disabled chips looked enabled; the note was 11px. **Fixed.**
- V7-6 the vol card's badge squeezed its title. **Fixed.**
- V7-7 Macro's badge still said Yahoo. **Fixed.**
- V7-8 `useVol` was dead and the deferred samples carried reads. **Fixed.**
- Noted, outside this item: `Price it →` stays a live link (item 11); the
  Technicals list's order (item 12); the dollar and oil preset chips
  (item 8); the Ledger's "day n" and tooltip (item 9).

One unit run in this item failed the Macro curve test on a timing flake
under full-suite load; it passed alone and on every full run after. The
fixes were checked by the four gates and the tests above; the changed
compare shots were re-shot after them.

### Phase 2, item 8: the study slots — `frame-3: align 8 slots`

**What changed.** The Event Study asks only what the catalog serves (§4,
§12.2, §12.3). `/study/catalog` answers §12.3's fifteen studies (the
fixture carries the table: each slug's label, short name, availability with
the reason, its five slots or none, and its allowed horizons), read by a new
`useStudyCatalog` and a pure `event-study/catalog.ts`: a question is
answerable only as an available catalog study at an allowed horizon, and a
slot's option is enabled only when, with the other slots as they are, it
leads to one. The nine chips are their catalog labels ("S&P golden cross",
"VIX spike +2σ, 5 days", "HY spreads +2σ, 20 days"), and a chip whose study
is unavailable (the dollar, oil → gold) is disabled, with its reason printed
under the chips (and as its tooltip). The slots lose window 10 and "S&P above its 50-day"; a cross has no
window (§12.2: "omitted for a cross"), so `question.window` is nullable
through the address, the request, saved questions, the words and the
engine mapping, and the window slot offers "none (a cross)" (and is blank, like the others,
before anything is asked). A preset with no answer (served awaiting, or
refused) still spells out its question: the slots take it from the
catalog. The WHILE
tooltip is §4's ("Entry at the event close when every input is available by
then; otherwise the next close."). A request the server refuses (422
`unsupported`, and only that code) prints the served message in the answer
card and in the Client view, with the labels kept and no "Awaiting
refresh". An address asking a withdrawn value (window 10, the S&P above its
50-day) opens the default question and says so (§12.0: never a silent
parameter drop). Saved questions are never dropped (§1.8): an old cross
saved with a 20-day window reads with none, on load and on import, and a
withdrawn one stays in storage, counted under My saved questions. The fixture answers `/study` from the
catalog the same way: 422 with a message naming the combination it refuses, the awaiting envelope
with the reason for a study not stored, 404 for a catalog study it carries
no answer for.

**Tests.** `catalog.test.ts` (the fifteen rows and the nine chips' labels;
answerable only when available at an allowed horizon; the enabled options
from the gold study, the VIX spike and the golden cross);
`EventStudyPage.test.tsx` (windows and WHILE values, a cross without a
window through the address and the words, withdrawn values opening the
default question; the chips' labels and disabled reasons; the slots'
enabled options; a 422's message); `api.test.tsx` (the catalog passes its
schema; a null window reads for a cross and only for one); and the fixes
below (the chips' reasons in words, the blank window before anything is
asked, the dollar preset's slots, the withdrawn-address note, saved
questions kept and normalised, only `unsupported` a refusal, the Client
view's refusal). Browser: the chips and the window
slot from the fixture's catalog, and a real 422 from an address outside it.

**Against the PNGs.**
- 03 Event Study, the chips: each reads its catalog label, so the row wraps
  to two lines, and the dollar and oil → gold chips are dimmed and disabled,
  their reasons printed beneath.
  §4: "Nine preset chips, each the catalog `label` of: …"; "A chip whose
  study is unavailable is disabled with its reason."
- 03 Event Study, the slots: the window list is 5, 20, 60 and "none (a
  cross)", WHILE has no S&P-above option, and options that lead to no
  catalog study are disabled (not visible in the closed dropdowns). §4:
  "WINDOW (5 / 20 / 60 sessions; none for a cross) … Every option that does
  not lead to a catalog study (§12.3), given the other slots, is disabled".

Verifier (one round): **PASS**, with four should-fix findings and five
nits, all taken. It checked the enabled options from seven starting studies
against sets it computed from §12.3's table, crosses without a window in
the address, the request, saved questions and the engine slug, the catalog
failing or slow, and the layout at three widths. On its two questions: the
catalog check subsumes `series[]` roles and ops (v3 §2: "Capability
metadata (/study/catalog) enumerates the complete allowed combinations"),
and the gold study's slots being fixed but for the horizon is what §12.3's
rule requires.
- V8-1 (should-fix) the chips' reasons were tooltip-only. **Fixed.**
- V8-2 (should-fix, regression) the window slot showed "none (a cross)"
  before anything was asked. **Fixed:** its own value, "none".
- V8-3 (should-fix, regression) old saved crosses and withdrawn questions
  were dropped, then erased on the next save. **Fixed:** normalised or
  kept, never dropped.
- V8-4 (should-fix) old addresses were replaced silently. **Fixed:** a
  note.
- V8-5 any 422 counted as a refusal. **Fixed:** `unsupported` only.
- V8-6 a refused or awaiting preset left the slots blank. **Fixed:** the
  catalog spells out a preset's question.
- V8-7 the Client view of a refused question said Awaiting refresh.
  **Fixed.**
- V8-8 the fixture's refusal named nothing. **Fixed.**
- V8-9 a null window read for any move. **Fixed:** a cross's only.

The fixes were checked by the four gates and the tests above; the compare
shot was re-shot after them.

### Phase 2, item 9: the firing state — `frame-3: align 9 firing`

**What changed.** Firing is read against one pair of sessions (v4 B-05).
`/overview`'s `since_last_close` is §12.1's: `comparison_session` and
`prev_session`, `new_fires` as `{slug, label, short}`, `still_firing` with
`firing_day`, a nullable `regime_changed` and `refreshed_at_utc`. The line
prints each new fire as "<short> fired (new)" and each signal still firing
as "<short> still firing, day <firing_day>", and its label's tooltip names
the two sessions compared ("the Sep 22 close against Sep 21", §1.10). Which
signals appear is the server's rule (only those evaluated on
`comparison_session`); the page invents none, and the fixture test checks
that every fire is a Ledger row firing on that session and not stale. The
Ledger's NOW reads "● Firing · day <n>", "○ Quiet" or "○ Stale ·
<evaluated_on>", its tooltip "evaluated on <evaluated_on>" on every row
served with one (§8); its column widens to hold those words whole. The
Event Study's pill is §4's: "● Firing today · day <firing_day>", "○ Not
firing today · last <last_event>", "○ Stale · <evaluated_on>" (never firing
today), or no pill when the state is not served; `/study` serves
`firing_day`, `evaluated_on`, `comparison_session` and `stale` (§12.2).
The Client view says "Setup · <last_event>" only for a study firing and not
stale (§11), and the Overview marks an active row firing (`data-firing`,
untinted, as §2 and the PNG draw it) only when it is firing and not stale.
A state that cannot be evaluated (`firing_now` null, served stale with no
session) prints no pill and a "—" NOW, never "Stale · —". The Overview's
`active_signals` carry the Ledger row's `firing_day`, `evaluated_on` and
`stale` (§12.1: "array of Ledger rows"), and the fixtures serve `firing_day`
null on every row that is not firing (§12.5: "required, nullable").

**Tests.** `consistency.test.ts` (fires are Ledger rows firing on the
comparison session and not stale; `firing_day` agrees; the three answers
share the sessions; no firing day on a row that is not firing);
`OverviewPage.test.tsx` (the items' words, the sessions' tooltip);
`LedgerPage.test.tsx` (the day, the tooltips, stale, "—" for a state not
served); `EventStudyPage.test.tsx` (firing with its day, stale, no state,
no pill for a stale state with no session); `ClientView.test.tsx` (the
setup label). The consistency test also holds each Overview row's firing
state to its Ledger row's, and the study's to the gold row's. Browser: NOW's words never cut at 1440 and 390.

**Against the PNGs.**
- 01 Overview, the since-last-close line: "2s10s still firing, day 10" is
  now "2s10s steepening still firing, day 10" (the served `short`). §2:
  "each signal still firing with its `firing_day`"; §12.1 `still_firing`
  "array of `{slug, label, short, firing_day}`".
- 07 Signal Ledger, NOW: "● Firing" is now "● Firing · day 10", in a wider
  column (148px against 92; VERDICT gives 12px of it, its 92px pill still
  whole, and LAST FIRED to VS NORMAL sit 44px left of the PNG's). §8: "NOW: `● Firing · day <n>` (green text), `○ Quiet` (gray), or
  `○ Stale · <evaluated_on>`".

Verifier (one round): **PASS**, with two should-fix findings and four nits.
It probed stale, null, day-less, day-123, new-fire and null-regime cases at
1440, 1101 and 390 through `page.route`, and found no clipped NOW cell, no
overflow, no palette or banned-word hit.
- V9-1 (should-fix) a state that cannot be evaluated, served
  `firing_now: null` and `stale: true`, printed "○ Stale · —" in the pill
  and the Ledger. §4: "nothing when `firing_now` is null". **Fixed:** the
  null state is read first.
- V9-2 (should-fix) the Overview's active rows carried no `evaluated_on`
  or `stale`, and the fixture test compared numbers only. §12.1:
  "`active_signals` | array of Ledger rows (§12.5)". **Fixed:** the rows
  carry them and the test compares the firing state; the study's firing
  state is held to its Ledger row's.
- V9-3 (nit) a redundant comment. **Fixed.**
- V9-4 (nit) "● Firing · day 10" sat 8px from the VERDICT pill. **Fixed:**
  NOW takes 12px from VERDICT; no other column moves.
- V9-5 (nit) this section said the Overview tints active rows; it marks
  them untinted. **Fixed** above.
- V9-6 (nit) a stale row sits under "Quiet · sorted by verdict". Left for
  item 12, which sets the Ledger's grouping and fixed order (v3 §2).

Your edit to `docs/desk/BUILD_NOTES.md` (uncommitted, 17:42 on
2026-09-25) and the five new SVGs under `docs/desk/screens/` are left
untouched and out of this commit. On the working tree they fail three
Build Notes unit tests (the ban list, the held-sentence count, the block
order) and two Build Notes browser tests; item 13 takes them up. This
item's gates ran on a scratch worktree holding exactly this commit.

The fixes were checked by the four gates and the tests above; the compare
shots were re-shot after them.

### Phase 2, item 10: positions in the browser — `frame-3: align 10 positions`

**What changed.** Positions live in this browser (§1.8, §9, v3 §16, v4
B-10); nothing is posted. `positions/store.ts` holds §12.13's record
(`instrument`, `direction`, `size_nav`, `horizon_days`, `variant`,
`pre_mortem`, `red_team`, `wrong_if`, `subject`, `monitoring`, `entry_ts`,
`entry_date`, `entry_value`, `trigger {series, operator, threshold,
policy: "frozen", observed_on}`, `original_room`, `evaluation: "close"`,
`closes`) under the versioned key `mrr.desk.positions.v1`, with Export /
Import JSON. §9's gate rule is the record's validation (`whyUnreadable`)
and runs on Save, on Import and on load: a record that fails keeps its
stays in storage and is listed under UNREADABLE with its reason, never
dropped; a store that is not a JSON list is kept whole. An id is a position
(its time of entry), so Import skips a record whose id is already here,
changed or not: a copy never counts a close twice. Monitoring is
automatic only when the instrument is the served series, the level is its
monitored one and the subject is not a basket: the S&P (by its exact name,
`S&P 500`, `SPX` or `^GSPC`, since every `/technicals` field describes the
registry series `spx`, §12.7) against its 50-day, and 2s10s against a bp
level (falls or rises 10 or 25 bp from entry, the level frozen at entry).
Load validation holds a stored automatic record to the same rule: its
instrument is the trigger's series, its subject is not a basket, and its
level sits on its direction's side (below for a long, above for a short). Such a position records its
entry value, the frozen threshold and its observation date, and a positive
`original_room`; a level already crossed at entry is refused with a
sentence, never saved as manual, and so is one whose series is not served
at Save. Every other subject and rule (NDX vs SPX, a basket, the 200-day,
`regime_changes`, a typed level) is manual: no level, no room, "manual" in
the room cell and an empty bar, closed by hand. Room is the signed
distance now over the room at entry, oriented the same way at both
(`value − threshold` below, `threshold − value` above); it goes to zero or
below once through the level and to "room —" when the series is not served
now. `day` counts XNYS sessions from the New York date of the save through
today, both counted, from the holiday table `api/calendar.py` keeps (a
parity test pins them): a save on a session is day 1, one after the close
included (evaluation is at the close); a save on a weekend or holiday is day
0 until the next session opens. SIZE ·
HORIZON prints "DV01 —". Close… stores an explicit close (falsified,
expired or closed) with the pre-mortem judged yes, no or not; the strip
counts the last 90 days' closes. The optional fourth gate field, RED TEAM,
is on the form. The Overview's Monitored rows read the same store against
the same levels and stay live when `/overview` is awaiting (§1.0). `GET
/positions` is a deferred stub in the fixtures and `POST` answers 405
(§12.0); `usePositions`, the server shapes and `monitored` are gone from
the types, the schema and `overview.json`; `/technicals` serves §12.7's
`date`. `positions.json` is now an illustrative Export of the store (six
positions, three open, three closed, every gate text a `TODO(Max)`
marker), used by the tests and the compare shots (`desk-compare.mjs
--store`).

**Tests.** `store.test.ts` (the rule on every sample record; each failure
named; B-10's room and level checks; unreadable entries kept through load
and write, a non-JSON store kept whole; storage off or full; Import that
skips, renumbers and quarantines; explicit closes and the 90-day window);
`sessions.test.ts` (parity with `api/calendar.py`, the day count across
Labor Day and a weekend entry, New York dates); `monitor.test.ts` (the
levels, `planFor` for automatic, manual, crossed and unserved levels, the
room, distance and lines); `PositionMonitorPage.test.tsx` (a save kept in
the browser with nothing posted, the crossed-level refusal, 2s10s
automatic and TLT manual, a browser that keeps nothing, the monitor's
order, Close…, the unreadable list kept through a save, Import, the
fixture's stub and 405, the carried study as subject); `OverviewPage.test.tsx`
(rows from the store, least room first, manual last, live while
`/overview` is awaiting); `format.test.ts` (the room words, the sort).
Browser: a save survives a reload with no request to `/api/desk/positions`;
the Overview's tones from a seeded store.

**Against the PNGs.**
- 08 Position Monitor, the rows' names: "Long 2s10s", "Long AI
  infrastructure basket vs 1.6 × NDX", "Long NDX vs SPX", where the PNG
  has "2s10s steepener" and "AI-infra basket, hedged". §12.13's record has
  no name field; the row is its direction and instrument ("Don't invent
  fields").
- 08, the rows' room: the two manual rows print "manual" and an empty bar,
  where the PNG shows 68% and 52%. §2: "a manual position prints "manual"
  in the room cell and an empty bar"; §9: "Unserved subjects (NDX vs SPX, a
  basket) … are saved with `monitoring: "manual"`, `original_room: null`,
  `room_pct: null`".
- 08, the 2s10s row: 30% room, its level "falls 10 bp from entry (below
  +38 bp)", where the PNG has 22%; the sample's entry is illustrative, and
  §9 defines 2s10s levels as a bp level frozen at entry.
- 08, the rows' order: 2s10s, the basket, NDX vs SPX, where the PNG has
  NDX vs SPX first. §9: "sorted by `room_pct` ascending, null last, then
  id".
- 08, SIZE · HORIZON: "DV01 —" where the PNG has "DV01 $1.4k", and the day
  counted on XNYS from the sample's entry (17 of 20 on Sep 25, where the PNG
  has 14). §9: "`<size> NAV · DV01 — · <day> of <horizon> trading days ·
  opened <entry_date>`"; "`dv01` is null"; "`day` counts the entry session
  as 1 on XNYS".
- 08, the expanded row's links: "Open the study behind it → · Close…",
  where the PNG has "Price a hedge →". §9: "links `Open the study behind it
  →` (a study subject) and **Close…**".
- 08, the form: a fourth step, RED TEAM (optional), under the wrong-if row.
  §9: "4. RED TEAM (optional) — "the strongest case against, in your
  words.""
- 08, the right column: a third card, "Kept in this browser only. Export
  JSON · Import JSON", and the unreadable list when there is one. §9:
  "Export / Import JSON of the store"; "a record that fails is kept in an
  "unreadable" list the page shows".
- 08, the Save helper: "Save keeps the position in this browser." §9:
  "there is no server position store and nothing is posted".
- 08, CLOSED · LAST 90D: 2, 1 and "1 of 2" from the sample's closes, where
  the PNG has 4, 6 and "2 of 4" (illustrative values either way).
- 01 Overview, Monitored: the same three rows from the store, the manual
  two reading "manual". §2: "Rows from the browser's position store (§9)".

Verifier (one round): **FAIL**, on two should-fix findings; both taken, and
five of the nine nits, the rest noted. It probed stored, corrupt and
non-JSON data, saves of every kind, Close…, Import and reload at 1440, 1101
and 390, with no request to `/api/desk/positions` and nothing off the
palette.
- V10-1 (should-fix) the S&P was recognised through `/technicals`
  `instrument`, a field §12.7 does not serve: against a conformant API, or
  with `/technicals` awaiting, "closes below its 50-day" saved as manual.
  §1.0: "automatic room only for the S&P against its 50-day"; §9: "never
  saved as manual". **Fixed:** the S&P is known by its names (§12.7: "Every
  field describes the registry series `spx` (^GSPC)"), the chips' numbers
  come from `ma50`/`ma200` alone, and a 50-day pick with `/technicals` not
  served is refused.
- V10-2 (should-fix) automatic monitoring was not tied to the subject: a
  basket retyped as 2s10s saved automatic, and a stored TLT record with an
  S&P trigger passed validation. §9: automatic "when the subject's
  monitored quantity exactly matches a served series"; "Unserved subjects
  (NDX vs SPX, a basket) … `monitoring: "manual"`". **Fixed** in `planFor`
  and in load validation.
- V10-3 (nit) unreadable entries move to the end of the stored list on a
  write: kept, not in place. **Fixed** in the words (this section and the
  module now say "stays in storage").
- V10-4 (nit) stray text read two ways. **Fixed:** one reason.
- V10-5 (nit) the day-count rule for weekend and after-close saves was not
  stated. **Fixed:** stated above and in `monitor.ts`.
- V10-6 (nit) a changed copy of a closed position imported under a new id
  counted its close twice. **Fixed:** an id already here is skipped.
- V10-7 (nit) 2s10s was unserved when §12.8's `today.date` is null.
  **Fixed:** dated by its two tenors when they agree.
- V10-8 (nit) a long with an above-level trigger passed. **Fixed** in
  validation.
- V10-9 (nit) Build Notes does not yet say the browser gate is a workflow
  check (§9), and `BUILD_NOTES.md` speaks of "a numeric level". Left for
  item 13; `BUILD_NOTES.md` is your file.
- V10-10 (nit) the sample's gate texts are `TODO(Max)` markers, as at HEAD;
  kept for you to write. V10-11 (nit) a long row name ends in an ellipsis
  at 1440 (§2: the name is nowrap).

Decision recorded for you: a study subject may be monitored automatically
when its instrument is the S&P or 2s10s (the sample's 2s10s steepener is
one); §9 names the instrument, and only the basket is called unserved.

The fixes were checked by the four gates and the tests above; the compare
shots were re-shot after them (unchanged).

### Phase 2, item 11: Basket & Hedge unavailable — `frame-3: align 11 basket-hedge`

**What changed.** Basket & Hedge is unavailable (§1.0, §10): basket pricing
and option structures are not yet defined in the engine. What stays is the
analyst's own work, kept in this browser (§1.8): the selector of this
browser's baskets and `+ New basket`, the LEGS table with Equal-weight and
Normalize to 100%, typed weights, `+ Add a ticker…`, the total, **Save
basket** (only at exactly 100%), Export / Import JSON and Delete. The page
opens this browser's first basket and writes it in the address, so **Send to
Position Monitor →** carries it; Position Monitor reads only baskets kept here
and saves them as manual subjects (§9). The priced parts keep their labels
and print §1.0's reason (§1.0.2): 3-MONTH, VS NDX · RESIDUAL and BASKET VOL
with no number and the reason once, the one sentence §1.0.2 allows; the
chart's title for an open basket, with no chart and no beta read; the Hedge card
with its title, subtitle, the three mode labels (disabled) and its stat
labels, the reason, and no structure, ratio or scenario. Both cards'
Advanced controls are disabled ("not yet served"), the page badge reads `○
Not yet served`, and the tab has no Desk / Client toggle (§10). Event
Study's `Price it →` is disabled with "not yet served" (§4). Nothing is
asked of the server: `deskPost`, the basket, price and hedge hooks, their
types and schemas and the three fixtures are gone; the fixture server
answers `GET /basket/:id`, `/basket/price` and `/hedge` with the awaiting
envelope and `POST /basket/price` with 405 (§12.0). `baskets.json` is an
illustrative Export of the store (the AI infrastructure basket), used by
the tests and the compare shot.

**Tests.** `BasketHedgePage.test.tsx` (the unavailable state and nothing
asked of the server; the first basket in the address; weights as typed;
Save only at 100%; storage full; an empty store; + New basket and Delete;
switching baskets never drops typed weights; an unreadable saved basket
counted and kept;
another window's save; Import renumbering an old served id; a basket not
here; the fixture stubs and 405; Send to Position Monitor); `weights.test.ts`
(an old served id imported as this browser's own); `EventStudyPage.test.tsx`
(Price it disabled); `api.test.tsx` (no schema for the removed endpoints,
every read a GET). Browser: the unavailable page, weights saved, the
hand-off, every width with no sideways scroll and no request to the basket
or hedge endpoints.

**Against the PNGs.**
- 09 Basket & Hedge, the header: `○ Not yet served` where the PNG has
  "MOCKUP · values illustrative" and "Live · prices Sep 22 · options via
  EODHD", and no Desk / Client toggle. §10: "No Desk/Client toggle … Badge
  `○ Not yet served`".
- 09, the Basket's stats: labels with "—" and the reason, where the PNG has
  +12.7%, −1.9% and 41%. §10: "The stats (3-MONTH, VS NDX · RESIDUAL, BASKET
  VOL), the residual chart and the beta read are unavailable: labels kept,
  the reason printed."
- 09, the chart and the beta read: the chart's title alone, no chart, no
  "Beta to NDX" box. Same sentence of §10.
- 09, the meta line: "7 names · saved in this browser" where the PNG has
  "rebalanced monthly" (a served field; no basket is served).
- 09, the add row's hint: "any US-listed name" without "price history
  pulled on add" (nothing is pulled while pricing is not served), in sans at
  12px as the legs' hint (owner rule: prose in sans, 12px or more).
- 09, the footer: "kept in this browser only" where the PNG has "changes
  re-price the hedge on the right"; Export, Import and Delete on their own
  line (§10: "Save basket and Export / Import JSON: local editing only").
- 09, the Hedge: title, subtitle, the three mode labels (none picked) and
  the stat labels, then the reason; no structures, ratio, scenarios, "Why
  index options" or Recommendation. §10: "Title, subtitle and the three mode
  labels kept; the reason printed; no structures, no ratio, no scenarios."
  The subtitle reads "priced off the SPY / QQQ surface" where the PNG has
  "the live SPY / QQQ surface": nothing on it is live (§1.6).
- 03 Event Study, the verdict box: "Price it → not yet served", disabled.
  §4: "`Price it →`, disabled with "not yet served" while Basket & Hedge is
  unavailable."

Saved baskets this page cannot read are now kept through every write and
counted on the card, as saved questions and positions are (§1.8); before
this item they were dropped on the next save.

Verifier (one round): **PASS**, no should-fix, eight nits; seven taken. It
probed empty, illustrative and corrupt stores at 1440, 1101 and 390, with
and without `?basket=`, every local flow, the Position Monitor hand-off and
Price it, with no request to the basket or hedge endpoints, nothing off the
palette and every stop named and ringed.
- V11-1 the hedge subtitle said "options surface". **Fixed:** "priced off
  the SPY / QQQ surface".
- V11-2 a second sentence beside the reason. **Fixed:** removed (§1.0.2:
  one sentence).
- V11-3 an amber dash for a total that does not exist. **Fixed.**
- V11-4 a chart title with no basket open. **Fixed:** shown for an open
  basket only.
- V11-5 unreadable saved baskets were dropped on the next write (as at
  HEAD). **Fixed:** kept and counted.
- V11-6 switching baskets dropped typed weights (as at HEAD). **Fixed:** the
  selector waits, as + New basket does. Send to Position Monitor still
  carries the saved legs, not typed ones; noted.
- V11-7 a stale comment. **Fixed.**
- V11-8 two hints in small type (as at HEAD). **Fixed:** sans, 12px.

The fixes were checked by the four gates and the tests above; the compare
shot was re-shot after them.

### Phase 2, item 12: ordering, labels and fixtures — `frame-3: align 12 fixtures`

**What changed.** Every Desk fixture is regenerated to the folded §12
shapes, with the audit's real values wherever it marks a value COMPUTABLE
(`docs/desk/FRAME3_DATA_AUDIT.md` on `desk/frame-3-docs`, `cd465f8`).
One snapshot throughout, the audit's store: refreshed Sep 24 05:07 UTC,
calculation date Sep 24, comparison session Sep 23 against Sep 22, no
^GSPC row for Sep 22, regimes through 2026-08 with 2025-10 absent. The
study values are the event-study engine's own output, run read-only on a
copy of that store; its firing check puts nothing firing, and every row it
cannot evaluate on Sep 23 is stale at its last evaluable session. What
is not COMPUTABLE is illustrative and named as such in the new
`web/src/fixtures/desk/PROVENANCE.md`, fixture by fixture.

- Shapes: `/overview` (`trend {state, above_50, above_200, state_since,
  cross, date, freq, source}`, `data_status {state, contributors}`),
  `/technicals` (§12.7's `date`, `freq`, `source`, `chg_1d_dates`,
  `ret_1y_dates`, the two average windows, `trend {state, state_since}`,
  `move_20d_date`, `signals_allowlist`; no `instrument`, no
  `move_20d_word`), `/study` (`label`, `short`, `data_start`,
  `sample_end`, `first_event`, extremes `{value, event_date, entry_date}`,
  `last_events[].value_20`, `provenance {entry_rule, cooldown, seed,
  engine_version, series_start}`), `/study/events` (exit, value and
  completeness per horizon; the CSV takes §12.4's columns), `/macro` (each
  tenor dated, HY and IG as dated objects, the served band, the rank and
  line windows), `/regime` (`next_prints` per §12.6, the history note),
  `/pipeline` (§12.9's groups, a status per group that is the worst of its
  series, provider and frequency per series, `validation` pass or fail).
  Types and the response boundary (`data/types.ts`, `data/schema.ts`)
  follow them, and every tab reads the new fields.
- Ordering and labels (v2 §19 as amended): one label and one short per
  slug, the catalog's, on every tab; the Ledger in v3 §2's fixed order, one
  table in the served order with no group rows; Overview's active signals
  by §12.1's rule (firing first, then the five latest fires, newest
  first); Technicals' rows in `signals_allowlist` order, under their
  catalog labels ("S&P golden cross", no longer shortened on that tab); the
  series labels in `/study` `series[]` and on Data Pipeline are the
  registry's (`src/desk/series.py`), so gold reads "Gold (COMEX front
  month)", and a study's target is named by its `series[]` entry (§12.2
  serves no separate target name; the old `target_label` is gone).
- §12.13's deferred shapes: `vol.json` carries each value's date and no
  band edges, `sectors.json` breadth's comparison date and no pattern,
  words or month-ago count, `deferred-macro.json` each correlation's
  symbol, quantity and transform and no words or hedging call. §12.0's
  read must name its rule or it is not read, so no fixture carries one.
  The cards built for these blocks (not served on Monday) follow: the
  Sectors PATTERN stat waits, the breadth count is dated, the skew
  percentile is printed without Cheap / Typical / Expensive bands, the
  correlation rows show the declared symbol.
- Tabs, where a field moved: the Overview trend reads `trend.state`
  ("since <state_since> · last cross golden, <date>"); the regime is in
  its color wherever it is named, the Overview tile, the Regime page's
  label and the sidebar's TODAY (§1.3's exception, all four regimes; only
  Overheating was colored before, which the real Goldilocks row showed);
  a falling inflation trend is red, down, not green (§1.3: green only ever
  means up, Reliable, firing or current); the Regime lede says "First
  month in a row." for a first month (§5's "<Nth> month in a row"); the
  sidebar dates the S&P by its sessions and says Awaiting refresh for a
  day's change it cannot compute; the
  Technicals badge is `● Live · <date>` from `/technicals` `date`; the
  Event Study provenance line is §4's; the Client view's title falls back
  to the study's label when `client` is null; Macro dates each spread,
  prints the served band and the range over its window, draws each date's
  curve through its served tenors with a marker on each, and names the
  tenors not served under the chart; Regime spells each flip from
  `operator`, `threshold_mom`, `flips_to` and `first_effective_month` and
  prints "release date unavailable" for the INDPRO print, its dash
  uncolored; Data Pipeline shows provider and frequency on each row (notes
  in sans), a daily series to the day and a monthly one to the month,
  says the inventory is "generated from the registry" (§11), the lineage's
  fetch step "full refresh daily", and always "validation passed",
  "failed" or "unknown".
- Layout the real values needed: the Event Study slot grid gives the shock
  its registry label, and below 1280px the six slots take three columns
  (on a phone shock and while take a row each), so every slot reads whole
  at 1440, 1280, 1101 and 390; the Advanced resampling rows have their own
  four columns and wrap; the Overview stacks below 1280px (tiles two by
  two, signals and monitored rows full width) and its tile words may wrap;
  the Technicals trend words take the small stat size and may wrap; the
  Data Pipeline wrap columns start at 84px so the day-dated columns fit at
  601px; the kit's line chart can join a series across a value not
  served.

**Tests.** `consistency.test.ts` (one label per slug; the sessions, the
generation and the firing rows across the fixtures; the regime lag; the
audit's real values: the K−2 row, recession, VIX, the curve, the spreads,
the gold study's counts and hash, the Ledger's counts and verdicts, the
pipeline's first and last observations); `api.test.tsx` (the new
fields, a wrong kind removed or nulled, the windows whole or not at all);
`OverviewPage`, `TechnicalsPage`, `EventStudyPage`, `ClientView`,
`RegimePage`, `MacroPage`, `LedgerPage`, `PipelinePage`, `DeskShell`,
`PositionMonitorPage` and `monitor` tests on the real values. Browser:
`e2e/desk.spec.ts` on the same values (the Overview tiles and tones, the
Technicals axis at 6,000 / 7,000 / 8,000, §12.4's CSV header, two Too few
pills, the 2s10s position at 15 bp, the 50-day at 7,625, the Client title,
the 10Y Treasury named from `series[]`); `SectorsPage`, the deferred
`MacroPage` and `TechnicalsPage` cards on §12.13's shapes. After the
verifier's round the layouts above were scanned at 1440, 1280, 1101 and
390 for sideways scroll, cut slots, overlapping rows and colliding ticks,
with none found.

**Against the PNGs.** Where a value differs, the PNG carries the mockup's
number and the fixture the store's (the rule of this item; §0: "this file
wins for numbers, labels and API shape").
- 01 Overview: REGIME Goldilocks (green), "Live · Jul row", where the PNG
  has Overheating. §2: the tile shows "the K−2 row governing today";
  the audit's Q13 has July as Goldilocks; §1.3: "Goldilocks green … wherever
  a regime is named." S&P TREND: "since Sep 17, 2026 · last cross golden,
  Jul 1, 2025" where the PNG has "since the Jul 2025 golden cross". §2's
  table: "since <state_since> · last cross <golden|death>, <date>". VIX
  14.2 · Sep 22 where the PNG has 16.2 (the audit's Q7). ACTIVE SIGNALS:
  S&P 5-day, VIX spike, S&P 20-day, golden cross, 2s10s, with the engine's
  counts (14× since 1996 for the golden cross, where the PNG has 31× since
  1990). §12.1: "the deduplicated union of every row with `firing_now`
  true and the five rows with the latest non-null `last_fired`, ordered
  firing first, then `last_fired` descending". SINCE
  LAST CLOSE: "regime unchanged · data refreshed 05:07 UTC"; nothing fires.
  Sidebar: "Goldilocks" in green and "S&P Sep 23 Awaiting refresh" where
  the PNG has an amber Overheating and "S&P today +0.4%". §1.1: TODAY "in
  its regime color"; §12.7: `chg_1d` is "close(to) / close(from) − 1 on
  exact indexed XNYS endpoints", nullable, and Sep 22 is not stored. Below
  1280px the page stacks (PNG 01 is 1440px wide; §0: the PNG wins for
  layout, and at these widths its layout does not fit).
- 02 Technicals: badge "Live · Sep 23" where the PNG has "Live ·
  Yahoo/FRED · as of Sep 22, 2026". §3: "Badge `● Live · <date>` from
  `/technicals` `date`." TREND "Above both" in the small size, where the PNG
  has "Up". §3: "TREND (`trend.state` in words: above both / below both /
  mixed; since `state_since`)." SIGNALS rows read "S&P golden cross",
  "S&P death cross", "S&P 20-day move over 2σ", "S&P 5-day move over 2σ"
  where the PNG drops "S&P". §12.3: "one canonical label and short per
  slug, reused by every tab (v2 §19)". 1-YEAR RETURN +15.1% since Sep 22,
  2025 (§12.7: 252 XNYS sessions back). Prices, averages, the 6,000 /
  7,000 / 8,000 axis and the signal rows (14×, 14×, 34×, 78×) are the
  store's.
- 03 Event Study: SHOCK reads "Gold (COMEX front month)" where the PNG has
  "Gold". §4: "Series labels, roles and ops come from `/study`
  `series[]`"; §12.2: `series[].label` is the engine registry's. Pill "○
  Stale · Sep 21, 2026" where the PNG has "Not firing today · last Apr 16,
  2025". §4: "`○ Stale · <evaluated_on>` when `stale`, never firing
  today". WORST · BEST −4.9% / +12.0% (Aug 2011 · Apr 2025); BY REGIME n 2
  / 6 / 9 / 1, all too few; "Today is Goldilocks: two events"; the last
  five and the four ranges are the engine's. The provenance line reads
  "Monte Carlo 10,000 · entry <the engine's entry sentence> · … Gold
  (COMEX front month) history from 2000", where the PNG has "cluster
  bootstrap 10,000 · entry next session". §4: "`<method> <draws> · entry
  <rule>`"; §12.2: `provenance.entry_rule` is the engine's
  `provenance.entry_rule`, which is that sentence.
- 04 Regime: Goldilocks in green, "First month in a row.", "1 mo, since
  the July row", "Latest print: Aug 2026", where the PNG has an amber
  Overheating, third month. §5 and §12.6: the K−2 row, `latest_print`
  "never used to classify"; §5's big label "(regime color…)". INFLATION
  "Falling" in red: §1.3 (red: "down"; green only ever means up). A YEAR AGO 17% (Aug 2025)
  and PEAK SINCE 2015 95% (Jun 2020) where the PNG has 9% and 71% (the
  audit's §2.4). NEXT INDPRO "—", "release date unavailable", where the
  PNG has Oct 17: the audit marks it NEEDS-SERIES and §12.6 serves the
  date nullable; the dash takes no color.
- 05 Macro: 10-YEAR 4.96%, 2s10s +25 bp flattening −25 bp, HY 2.73% tight
  · Sep 23, 3-year range 2.6 – 4.6% since Sep 23, 2023, IG 0.77% Sep 23,
  gauge 15th percentile over the window's 747 bond sessions, peak Mar
  3.5%: the store's. FRONT END "Awaiting refresh" and a two-point curve
  for each date, where the PNG has five points. §6: "Awaiting refresh until
  DGS3MO is registered"; "a tenor not served leaves its point out and its
  label says so." The tenor ticks print the tenor only and one line under
  the chart says "3m, 5y and 30y not served": the words under each tick
  collided below 1280px (V12-2).
- 07 Signal Ledger: 8 scored · 4 not yet served, none firing, one Reliable,
  four No edge, one table in the fixed order with no group rows, where the
  PNG has 12 scored and two groups. §12.5: "array of 12, in §8's fixed
  order"; §1.0: the dollar, oil and two RSI rows are unavailable.
- 08 Position Monitor: "2s10s below +15 bp · now +25 bp", where the PNG
  has "+38 · now +41". The sample is entered at 40 bp on Sep 2 (the audit's
  Q11) and illustrative otherwise (PROVENANCE.md).
- 10 Data Pipeline: badge "Last full refresh Sep 24, 15:52 UTC ·
  validation passed" (the last full run; the data last advanced at 05:07,
  which the Overview's line prints); "27 series · grouped · generated from
  the registry" where the PNG has "26 series … read from the pipeline
  config" (§11: "generated from the registry and its consumers, counts
  derived"); the lineage's fetch step "full refresh daily" where the PNG
  has "daily 00:23 UTC", which the audit (§10 #21) shows is not the full
  run's time; group lines "● missing" / "● current",
  where the PNG has "● all current · HY OAS history from 2023". §12.9: the
  group's status is "A: the worst of its series"; a series not stored is
  missing. Rows carry provider and frequency ("US HY OAS · FRED, daily")
  and dates to the day or the month, and each feeds list names the Desk
  tabs that read the series. §11: "(provider, `freq`, first and last
  stored observation, feeds)"; §12.9: "the Desk tabs that read the
  series".
- 12 Client view: the title "Gold +2σ while S&P weak", where the PNG has a
  question. §12.2: "`client.headline`: the catalog `label`." EPISODES "since
  2001" (§11: "since <sample_start year>"), 67% against 65%, as of Sep 24.
- 06 Sectors, 09 Basket & Hedge, 11 Build Notes: only the sidebar's TODAY
  card changed (Goldilocks in green · Jul row).

**For you to decide.**
- §12.2 makes the client title the catalog label, which carries a σ; §11
  says the Client view prints "no σ". The page prints the served title; the
  test holds "no σ" everywhere else.
- The provenance line is long: §12.2 serves the engine's whole entry
  sentence, so the mono line runs three lines at 1440px. The engine also
  has `entry_same_session` (false for gold), which would print "next
  session" if §12.2 served it.
- Regime shows the K−2 row (Goldilocks, inflation falling) beside next
  prints read from the latest print (Overheating, inflation rising), so
  the page says "Inflation Falling" and "a print ≤ −0.39% m/m flips
  inflation to falling" together. Both follow §12.6.
- The frame-2 engine panel in Advanced is still there; §4 retires it (v2
  §8). It is left for you to retire; no item of this pass asked for it.
- The Data Pipeline bridge card is titled "Snowflake bridge · schema and
  export"; §11 titles it "Proposed export schema (not the current SQLite
  layout)". Not changed here (a §11 title, not a §19 label).
- The Event Study answer headline is set at serif 21px, as before this
  item; §4 says 17px. Left for you: a type size, not a value or a label.
- On a phone the Event Study mode switch clips its wrapped second line
  ("Common / questions"), as at HEAD.

Verifier (one round): **FAIL**, twelve should-fix and six nits; every
recomputed value matched (the engine rerun on a byte-identical copy of the
audit's store, the recession model, the stored rows), and the findings
were rendering, four fixture fields and one label rule. All twelve fixed,
and four of the nits.
- V12-1 the Advanced resampling rows overprinted each other at 1440 (a
  fourth part in a three-column row). **Fixed:** their own columns, wrap.
- V12-2 the two-line "not served" ticks collided at 1101 and 390.
  **Fixed:** the tenor alone on each tick, one line under the chart naming
  the tenors not served.
- V12-3 the six slots were cut at 1101 and two at 390. **Fixed:** three
  columns below 1280px; shock and while a row each on a phone.
- V12-4 the regime color on the Overview tile only. **Fixed:** the Regime
  label and the sidebar's TODAY too.
- V12-5 a falling inflation trend in green. **Fixed:** red, down (§1.3).
- V12-6 Technicals dropped "S&P" from the catalog labels. **Fixed:** the
  canonical labels.
- V12-7 the data-status contributors' expected dates and reasons were
  made up. **Fixed:** each series through its freshness policy on Sep 24;
  DGS2, DGS10 and VIX one business day behind, current.
- V12-8 the rank window's coverage counts were made up. **Fixed:** the
  bond sessions of the window, 747, all stored, the rank over them (15th
  percentile); `api/calendar` has no 2023 holidays, so the builder adds
  Thanksgiving and Christmas 2023 (recorded in PROVENANCE.md; a gap for the
  API).
- V12-9 the pipeline's feeds were the mockup's. **Fixed:** the Desk tabs
  that read each series.
- V12-10 `question.target_label` is not in §12.2. **Fixed:** removed; the
  target is named by `series[]`.
- V12-11 the deferred fixtures were not regenerated. **Fixed:** §12.13's
  shapes, the fixture world's generation, no reads or words.
- V12-12 the Overview broke just above 1100px (as at HEAD). **Fixed:** it
  stacks below 1280px.
- V12-13 (nit) the phone mode switch clips (as at HEAD). Left; noted above.
- V12-14 (nit) the 1-year return anchor. **Fixed:** 252 XNYS sessions,
  +15.1% since Sep 22, 2025. The averages stay illustrative, as marked.
- V12-15 (nit) closes rounded to 2 dp. **Fixed:** full precision.
- V12-16 (nit) PROVENANCE.md's opening rule, the VIX staleness reason and
  three unmarked values. **Fixed.**
- V12-17 (nit) Pipeline copy: the 00:23 line, "read from the pipeline
  config", mono notes, mixed Rates labels. **Fixed**; the Credit group
  shows about two of its five rows at 1101 in its scrolling region, as
  designed.
- V12-18 (nit) Regime: the first-month lede, the amber dash, the 21px
  headline, the dots-only curve. **Fixed**, except the headline (left for
  you, above).

The fixes were checked by the four gates, the layout scan above and the
tests above; the compare shots were re-shot after them.

### Phase 2, item 13: Build Notes — `frame-3: align 13 build-notes`

**What changed.** Build Notes prints §1.0.1's two lists as their own
section, "Live / Designed, not yet served", word for word: the title, the
"Live" and "Designed, not yet served" heads and all nineteen items, from
`notes/scope.ts`, after the file's sections and last in the contents. It is
the page's own text (§11 allows exactly this and the byline), so it stands
when a build has no notes file. Of the Desk's banned words only
"established" and "significant" are enforced on `docs/desk/BUILD_NOTES.md`
(§11: "the file is the owner's prose"), still by the page's hold; the
language scan keeps the whole list on every source file, `scope.ts`
included.

Your new `BUILD_NOTES.md` (uncommitted, not part of this commit) draws pipe
tables and five figures from `docs/desk/screens/*.svg` (untracked). §11
makes the page "a markdown render" of the file, so the renderer now draws
both, for Build Notes only: `shell/Markdown.tsx` takes a `tables` flag and a
`figure` resolver, which the assistant's panel does not pass, so a model's
reply still never loads an image or draws a table. A figure resolves only to
an SVG of `docs/desk/screens/` bundled with the build (`figureUrl`);
otherwise the page says "Figure: <alt> (not in this build)". A figure is
shown at its own size, since its words are drawn for 1200px and more and
scaled to the card they fell to 2–8px; a wide figure or table scrolls
inside its own region, a tab stop only while it scrolls. The dev server may
read each SVG of that folder and no other file there (`vite.config.ts`).
The page prints §11's byline once: a lead paragraph that only repeats it
(your new file's line 3) is not printed again. Two fixes the file exposed: an underscore now
emphasizes only at a word's edge, as in GitHub's Markdown, so
"FRAME3_DATA_AUDIT.md" no longer prints as "FRAME3DATAAUDIT.md"; and a held
sentence in a table is held cell by cell, a held caption as its whole
figure, so the table keeps its shape. The held-sentence test now counts the
file's own sentences, table cells, figure captions and code lines that use
either word, so it follows the file rather than a fixed two (§10 above
says so now). The figures' drawn text is scanned for the two words too.

**Tests.** `BuildNotesPage.test.tsx` (the section against the spec's own
§1.0.1 lines, read from `DESK_FRAME3_SPEC.md`; the contents; the section
without the file; figures resolved or named; tables in reading order;
holds in a table and a caption; the held count on a file with each kind;
the byline once; every block of the file in order, figures and tables
included); `desk-language.test.ts` (the file scanned for the two words
only; the frame-2 words pass in it; the two frame-3 words are held; the
figures' text); new `Markdown.test.tsx` (tables and figures only on
request, a figure resolved or named, plain text for the assistant, a
table named by its header's words, snake_case as written);
`e2e/desk.spec.ts` (the contents mark reaches the new section at the foot
and on a click). With your new file in place the Build Notes, language and
shell suites pass too (128 tests), and the page shows its five figures and
three tables with no sideways scroll at 390, the figures legible at their own
size, the byline once.

**Against the PNG.** 11 Build Notes: a last section, "Live / Designed, not
yet served", with its two lists, where the PNG has none. §11: "nothing
hardcoded except §11's byline … and the section 'Live / Designed, not yet
served': §1.0.1's two lists, word for word." The section is also the last
entry in the contents, which §11 draws "from the file's sections": a
decision recorded here, so a reader can reach the section like any other.
The PNG's article is the mockup's text; the page prints the file's (§11),
with its tables and figures.

**For you** (your file; nothing here edits it):
- §9 says "The gate in the browser is a workflow check, and Build Notes
  says so." Neither the committed file nor your new one says it, and the
  page may add nothing beyond the byline and §1.0.1's section. One sentence
  in the file closes it (V10-9).
- The new file still carries its placeholders ("[N] findings across [R]
  rounds", "[fill from FRAME3_DATA_AUDIT.md §8 …]").
- The five SVGs are untracked; they need to go in with the file for the
  figures to ship. The Docker image copies neither: R-15's two lines
  (above) plus two for the figures, now written out there. On Vercel the
  setting for files outside the root directory covers `screens/` too.
- An SVG shown as an image cannot use the page's fonts, so the figures'
  IBM Plex Mono falls back to the system's monospace (Courier on a Mac).
  Outlining the text in the SVGs, or setting it in a system font, would fix
  that.
- The file's own section "Live, and designed but not yet served" and the
  page's "Live / Designed, not yet served" sit next to each other in the
  contents and list different things (the file's "Live" leaves out
  Position Monitor and the Client view, which §1.0.1 lists as live).
- The committed file holds two sentences for "established" (§10 quotes
  them); your new one holds none.

Verifier (one round): **PASS**, five should-fix and eight nits. The section
matched §1.0.1 word for word on both builds at 1440, 1101 and 390; the
exemption is exactly §11's; the assistant's replies still cannot load an
image or draw a table, and `figureUrl` resolved the five SVGs and none of
eleven other paths. Fixed, except where the owner has to act.
- V13-1 the byline printed twice with your new file. **Fixed:** a lead
  paragraph that repeats it is not printed.
- V13-2 the figures, scaled to the card, set their words at 2–8px.
  **Fixed:** shown at their own size, scrolling inside their region.
- V13-3 the Docker hand-off lines left out the figures. **Fixed** in the
  report (R-15's note above).
- V13-4 §10 above still said the test pins the count at two. **Fixed.**
- V13-5 §9's "Build Notes says so" is still unmet. Yours: one sentence in
  the file (above).
- V13-6 (nit) the held-count test would miss a caption or a code line.
  **Fixed**, with a file that has each.
- V13-7 (nit) a table's region label carried Markdown marks. **Fixed.**
- V13-8 (nit) no gap after a table. **Fixed.**
- V13-9 (nit) a table that does not scroll was a tab stop. **Fixed**, and a
  figure likewise.
- V13-10 (nit) the dev server could read every file of `docs/desk/screens`.
  **Fixed:** its SVGs only (the mockup PNG answers 403).
- V13-11 (nit) nothing checked the figures' text for the two words.
  **Fixed.**
- V13-12 (nit) the file's section and the page's sit side by side. Yours
  (above).
- V13-13 (nit) a comment named the wrong test. **Fixed.**

The fixes were checked by the four gates and the tests above; the compare
shot was re-shot after them.

### Phase 2, item 14: rulings and Codex round 2 — `frame-3: align 14 rulings and codex-2 fixes`

Your rulings on the Finish section, then Codex round 2's open findings, in
one commit.

**1. Client title: §11 wins.** §12.3 gains `client_label` (a field row and a
catalog column): the Client view's title in plain words, no σ and no engine
terms, for the 13 query-backed rows; the two RSI rows have none. §12.2's
template now reads "`client.headline`: the catalog `client_label` (§12.3),
never `label`", and §11's fallback for a study served without `client` is
the catalog row's `client_label`. The catalog and study fixtures carry them;
the Client view prints the served headline, else the catalog row's
`client_label`, else "What has happened after this setup", and never the σ
label. Drafted for your approval:

| slug | label (every other tab) | client_label (Client view) |
|---|---|---|
| gold-2sigma-spx-weak | Gold +2σ while S&P weak | Gold jumps while the S&P is weak |
| golden-cross | S&P golden cross | The S&P's 50-day average rises above its 200-day |
| death-cross | S&P death cross | The S&P's 50-day average falls below its 200-day |
| vix-spike-2sigma-5d | VIX spike +2σ, 5 days | Stock-market volatility jumps within a week |
| hy-2sigma-20d | HY spreads +2σ, 20 days | High-yield credit spreads widen sharply over a month |
| 10y-2sigma-20d | 10y yield +2σ, 20 days | The 10-year Treasury yield jumps over a month |
| dollar-2sigma-20d | Dollar −2σ, 20 days | The dollar falls sharply over a month |
| oil-2sigma-gold | Oil +2σ → gold | Oil jumps over a month, and what gold does next |
| spx-2sigma-10y | S&P −2σ → 10y | The S&P falls sharply over a month, and what the 10-year yield does next |
| spx-20d-2sigma | S&P 20-day move over 2σ | The S&P rallies sharply over a month |
| spx-5d-2sigma | S&P 5-day move over 2σ | The S&P rallies sharply within a week |
| 2s10s-2sigma-steepening | 2s10s +2σ steepening | The yield curve steepens sharply over a month |
| oil-2sigma-20d | Oil +2σ, 20 days | Oil jumps over a month |

The words map the question one to one: "jumps", "rallies", "falls sharply"
or "widens sharply" stand for a two-standard-deviation move in the study's
direction, "over a month" and "within a week" for its 20- or 5-session
window, and a target other than the S&P is named ("and what gold does
next"). Tests: `consistency.test.ts` (13 labels, none carrying σ or an
engine term, the study's headline equal to its row's), `ClientView.test.tsx`
(the title; no σ anywhere on the view, the title included; the catalog row's
label with no client block; plain words with neither), `e2e/desk.spec.ts`.

**2. Regime.** §5 gains the line: the "What would change it" card carries the
sub-label "from the latest print · <latest_print>", because its next prints
are read from the newest stored row while WHERE WE ARE shows the K−2 row;
both stay. The page prints "from the latest print · Aug 2026" under the
card's title. Test: `RegimePage.test.tsx`.

**3. The frame-2 engine panel is retired** (§4, v2 §8). Advanced shows the
study's events, each horizon's resampling detail, the entry rules and the
provenance, nothing from the frame-2 engine; nothing asks its routes. Gone
with it: the adapter `web/src/api/desk.ts` (its one shared type,
`EventStudyParams`, moved into `studies.ts`, which old `?study=` links still
use), the frame-2 formatters `event-study/format.ts`, `pyformat.ts` and
their tests (`pyformat.test.ts`, `frame2.test.ts`, `engine-adapter.test.ts`),
the engine-slug helpers, the fixture server's `/event-study` routes, and
`LEGACY_FRAME2` (the language scan now holds every Desk file to the whole
list). Kept: `event-study/__fixtures__/engine-studies.json`,
`engine-assets.json` and `py-format.json`, which `tests/test_event_study.py`,
`tests/test_desk_format_fixture.py` and `scripts/desk_format_fixture.py`
still read; they are outside `web/` and `docs/desk/`, so retiring them is the
API branch's. Tests: `EventStudyPage.test.tsx` (Advanced, and no request to
the frame-2 routes), `desk-language.test.ts`, `e2e/desk.spec.ts`.

**4. Bridge card title:** "Proposed export schema (not the current SQLite
layout)", §11's exact words. Test: `PipelinePage.test.tsx`.

**5. Event Study headline: 17px** (§4: "Headline (serif 17px)"). Test:
`e2e/desk.spec.ts` (computed font size).

**6. Codex round 2.** Codex's own text and repros were not in the repository
or the Downloads folder, so each finding was re-verified with a repro written
from its one-line description, in `web/src/screens/desk/codex-round2.test.tsx`.
Of the thirteen tests written first, nine fail at the previous tip and four
pass; the verifier's round added five more for what the first fixes missed.
All eighteen pass at this commit.
- **R-16 (blocking): dropped rows gave wrong totals and false empty-state
  claims.** Still open at the tip. The response boundary drops a list row it
  cannot read, silently; the Ledger then counted Firing now, Reliable and No
  edge from the rest, the chip said "All 11", Data Pipeline counted a group's
  readable rows and said "No series in this group yet" for a group whose one
  row was unreadable, the Overview said "Nothing is firing, and nothing has
  fired recently.", the rail said "No events", the slots' hint said "every
  slot lists the same 12 series" of 13, and Data Pipeline's search said a
  lost series did not exist. **Changed:** the boundary
  now records, per list, how many rows it dropped (`_dropped`, never taken
  from the answer), and every page that counts rows or says a list is empty
  reads it: the Ledger counts from rows only when every row was read (its
  header keeps the served `scored_n` and `unavailable_n`), the chip loses
  its number and the empty filter says "No readable signal matches this
  filter."; Data Pipeline counts read plus lost and claims no total when a
  group is lost; the Overview and the rail make no "nothing" claim and the
  since-last-close line names lost fires; a catalog that lost a row gates
  no slot option, while the rows it read still gate and explain their own
  chips (§4); the slots' hint counts no series from a partial list; a
  search miss says a series could not be read; Sectors names no leader or
  laggard from a partial list. Each place says "1 row could not be read."
  (or event, series, month, regime row, regime change, sector, asset,
  catalog study): the Ledger, the Overview's active signals, Data Pipeline,
  the rail's last events, by-regime rows and horizons, Advanced's events
  table, the Event Study catalog, the Regime strip, statistics and changes,
  Sectors, the Technicals sector bars and signals, the Client backdrop,
  Macro's correlations and the sidebar's data-status tooltip. §1.7 records
  the state. Tests: `codex-round2.test.tsx` (ten), `data/api.test.tsx`,
  `EventStudyPage.test.tsx`.
- **R-17: a missing firing status printed "Not firing today".** Closed by item
  9 (`2d179e2`): the pill prints nothing when `firing_now` is not served and
  the Ledger's NOW says "—". The verifier found the same gap one field over:
  with `stale` not served (§12.2 and §12.5 make it required), a firing study
  was called firing today. **Changed:** every firing claim (the pill, the
  Ledger's NOW and its Firing now count, the Overview's firing mark, the
  Client's "Setup") needs `stale` served as false, and says nothing
  otherwise. Test: `codex-round2.test.tsx` (three).
- **R-18: a missing requested horizon substituted another.** Closed by item 3
  (`d3f07a3`): the answer card reads the served `selected_horizon`, else the
  question's `horizon`, and no other row stands in. Item 14 removes the card's
  last default of 20 sessions: before an answer the labels name the asked
  horizon (a question's own, a preset's §12.2 default of 20), and the card on
  its own names none. Test: `codex-round2.test.tsx` (two).
- **R-19: a missing comparison disappeared without an unavailable state.**
  Closed by item 1 (`f19d52d`): the line on the question without its
  condition is a block, printing its served reason, or "Awaiting refresh"
  when it did not arrive. Test: `codex-round2.test.tsx`.
- **R-20: tiny distinct weights aliased to zero.** Still open at the tip, two
  ways: `decimal()` printed any weight under 1e-20 as "0", and Normalize
  worked in floats capped at twelve decimals, so two distinct tiny weights
  both became 0. **Changed:** `decimal()` writes an exponent form out in
  full; Normalize works in exact decimals, and when the legs add to more
  than 100 it keeps enough extra decimals that a weight typed above zero
  stays above zero and distinct weights stay apart; the result still adds
  to exactly 100. Those digits outrun a float, so a saved basket now keeps
  each weight as the exact decimal typed (an older save's numbers still
  read, and Export / Import carry either); a normalized basket reads back
  adding to exactly 100% (V14-4). The hand-off to Position Monitor still
  records numbers (§9). Tests: `codex-round2.test.tsx` (three),
  `weights.test.ts`, `BasketHedgePage.test.tsx`.

**Against the PNGs.**
- 03 Event Study: the headline at 17px, where the build set it at 21px. §4:
  "Headline (serif 17px)".
- 04 Regime: "from the latest print · Aug 2026" under What would change it,
  which the PNG does not have. §5, as ruled above.
- 10 Data Pipeline: "Proposed export schema (not the current SQLite
  layout)" where the PNG has "Snowflake bridge · schema and export". §11.
- 12 Client view: "Gold jumps while the S&P is weak" where the PNG has a
  question. §11 and §12.2, as ruled above.
- Advanced (not in a PNG): no frame-2 panel. §4.

Verifier (one round): **FAIL**, six should-fix and five nits. Items 1 to 5
checked as stated (spec wording and placement, the 13 labels, nothing left
reading the removed files, `?study=` links intact, the Python tests'
fixtures kept). All fixed, except the owner's calls.
- V14-1 the slots' hint counted a partial series list. **Fixed.**
- V14-2 Data Pipeline's search said a lost series did not exist. **Fixed.**
- V14-3 one lost catalog row re-enabled the unavailable chips and hid their
  reasons. **Fixed:** the rows read still gate their chips; only the slot
  options stop gating.
- V14-4 a normalized basket no longer added to 100% after Save (floats).
  **Fixed:** exact decimals in the store.
- V14-5 with `stale` not served, a study was called firing today. **Fixed.**
- V14-6 the report did not list the labels yet. **Fixed** (this section),
  and the Finish's follow-up on `LEGACY_FRAME2` is closed.
- V14-7 (nit) Regime statistics and changes, Sectors, the Technicals bars
  and the data-status contributors lost rows silently. **Fixed.**
- V14-8 (nit) a baseline not served dropped its "vs normal" line. **Fixed:**
  "normal awaiting refresh" (Event Study), "ordinary month awaiting
  refresh" (Client).
- V14-9 (nit) the new "could not be read" state had no §1.7 sentence.
  **Fixed.**
- V14-10 (nit) two comments still said "catalog label". **Fixed**; a Python
  test's docstring still names the removed adapter (outside this pass).
- V14-11 (nit) the gold label alone names no window. Yours: it is your own
  example; "Gold jumps over a month while the S&P is weak" would match the
  rest.

The fixes were checked by the four gates and the tests above; the compare
shots were re-shot after them and matched.

**For you.**
- Approve or rewrite the 13 client labels above; they live in §12.3 and in
  the fixture builder's one table.
- `CLAUDE.md` (repo root, outside this pass) still describes
  `web/src/api/desk.ts`; the Python tests and the script named in item 3
  still read the frame-2 fixtures.
- If you have Codex round 2's own report, its repros can be run against
  this commit as they stand.

### Phase 2, item 15: the gold label and Codex's repros — `frame-3: align 15 label and codex-2 repros`

The client labels are approved as listed in item 14 with one change, and
Codex round 2's own repros are run and closed, in one commit.

**1. The gold label.** `gold-2sigma-spx-weak`'s `client_label` is now "Gold
jumps over a month while the S&P is weak", which names the 20-session window
as the other twelve do (this replaces the draft in item 14's table; V14-11).
Changed in §12.3, the fixture builder's table, `study-catalog.json`,
`study.json` (`client.headline`), `desk-variants.ts`, `ClientView.test.tsx`,
`e2e/desk.spec.ts` and compare shot 12. The other twelve stand. The longer
title left "weak" alone on its second line at 1440, where the approved PNG's
two lines are even; the Client title now balances its lines
(`text-wrap: balance` on `.cv-headline`).

**2. Codex round 2's repros.** Codex's report (against `7bb2a3e`) is now in
hand. Each repro is a test in
`web/src/screens/desk/codex-round2-codex.test.tsx`, as Codex states it, with
its expectation turned into the assertion. R-16's positions half used a
positions fixture the API served; item 10 moved positions to this browser's
store, so the same collection (`positions[0].instrument = null`) runs through
a seeded store and through Import JSON. Its active-signals half runs against
/overview. Three tests marked "extends" are mine, not Codex's: they carry
R-16 to the other position surfaces. Each test was run at the commit before
item 14 (`54510e8`), at item 14 (`8fa4dea`) and at this commit:

| Finding | Repro | `54510e8` | `8fa4dea` | this commit | Closed by |
|---|---|---|---|---|---|
| R-16 | Codex: positions, seeded store | fails | fails | passes | this commit |
| R-16 | Codex: positions, Import JSON | fails | fails | passes | this commit |
| R-16 | Codex: every active signal's label null, /overview | fails | passes | passes | item 14 (`8fa4dea`) |
| R-16 | extends: Position Monitor with no readable open position | fails | fails | passes | this commit |
| R-16 | extends: a closed record unreadable, 90-day strip | fails | fails | passes | this commit |
| R-16 | extends: Overview monitored rows | fails | fails | passes | this commit |
| R-17 | Codex: `firing_now` deleted | passes | passes | passes | item 9 (`2d179e2`) |
| R-18 | Codex: `h: 20` row removed, horizon 20 kept | passes | passes | passes | item 3 (`d3f07a3`) |
| R-19 | Codex: `without_condition` deleted | passes | passes | passes | item 1 (`f19d52d`) |
| R-20 | Codex: `decimal(1e-21)`, `decimal(2e-21)` | fails | passes | passes | item 14 (`8fa4dea`) |

So, per finding, against Codex's own repros: **R-16's positions half passed
only after this commit's fix.** R-16's active-signals half and R-20 passed
before it, from item 14's fixes. R-17, R-18 and R-19 passed before item 14.
My eighteen repros in `codex-round2.test.tsx` pass at `8fa4dea` and at this
commit.
- **R-16, positions: still reproduced at `8fa4dea`.** The store keeps a record
  it cannot read aside (item 10), and the "Positions kept in this browser"
  card says so, but the Monitored card still totalled the two it could read
  ("8% deployed", "2 positions"), and the Closed · last 90d strip counted
  only the readable records' close events. **Changed:** while a kept
  position cannot be read:
  - The Monitored footer prints no deployed share and says "2 readable
    positions". Under it the note reads "1 kept position could not be read.",
    in the same sans note the Overview uses (`DroppedNote`). With none
    readable, the card says "No readable open position; 1 kept position could
    not be read." where it said "No open positions in this browser.".
  - The strip's three counts read "—", with the same note.
  - The Overview's monitored rows carry the note. With none readable, they
    say "No readable position is monitored; 1 kept position could not be
    read." where they said "No positions are monitored in this browser.".
  - The spec says so in three places: §1.8 (while one is kept, no total and
    no empty state is drawn from the readable records alone), §2 (the
    Overview's rows) and §9 (the footer, the strip and the empty list).
- **R-17.** Codex suggests "Awaiting refresh"; §4 says the pill prints
  nothing when `firing_now` is null, which is what the page does, and Codex's
  check (no "Not firing today") passes. The fixture has been stale since item
  12, and a stale study's pill never reaches the firing branch. Both R-17
  tests now serve `stale: false`, so they reach the branch Codex hit. With the
  null guard removed, both tests fail.
- **R-18.** The answer card's statistics read "Awaiting refresh" under the
  month's labels; the chart below still draws each horizon it was served.

Tests: `codex-round2-codex.test.tsx` (ten), `codex-round2.test.tsx` (the R-17
test now serves `stale: false`).

**Against the PNGs.**
- 12 Client view: "Gold jumps over a month while the S&P is weak", on two
  balanced lines, where the PNG has a question. §11 and §12.3, as approved.
- The other eleven shots re-shoot pixel-identical to the committed ones; the
  sample stores have no unreadable record.

Verifier (one round): **FAIL**, one should-fix and six nits. It found the
label change complete (only item 14's history keeps the draft), Codex's
repros encoded faithfully, and no sideways scroll, clipping or off-palette
colour at 1440, 1101 and 390 on Position Monitor, the Overview and the Client
view. All fixed:
- V15-1 (should-fix) the Closed · last 90d strip counted only the readable
  records. **Fixed** (above).
- V15-2 (nit) the R-17 repro could not reach the branch Codex hit, since the
  fixture is stale. **Fixed:** `stale: false`, in both files; a mutation of
  the pill's guard now fails both.
- V15-3 (nit) the before/after table missed that the Overview monitored test
  also fails at both earlier commits, and did not mark it as my extension.
  **Fixed** (the table above).
- V15-4 (nit) the loss sentence sat in the mono 11px footer. **Fixed:** the
  footer keeps the count; the sentence is a sans `DroppedNote` with
  `role="status"`.
- V15-5 (nit) no spec sentence covered unreadable positions. **Fixed:** §1.8,
  §2, §9.
- V15-6 (nit) the new Position Monitor empty state had no test. **Fixed.**
- V15-7 (nit) the Client title left one word on its second line at 1440.
  **Fixed:** `text-wrap: balance`.

Also seen, not item 15: a long monitored row name ("Long AI infrastructure
basket vs 1.6 × N…") is cut with an ellipsis and has no `title`, so the whole
name cannot be read on Position Monitor or the Overview (the same in the
committed shot 08).

## Spec errata

### S-02 to S-27 from the API plan's §6 — `frame-3: spec errata S-02–S-27`

The replacement wording of `FRAME3_API_PLAN.md` §6 (branch
`desk/frame-3-api-plan`) for S-02 through S-27, except S-12, is folded into
`DESK_FRAME3_SPEC.md`, with the operator's rulings for S-04, S-10, S-21 and
S-25. S-01 and S-12 are untouched; Codex is revising them and a follow-up
carries them.

**Every row is applied in its §6 words.** Where a row's words sit in a table
cell, they go in the cell the row names, and the cell's other words stay:

| Row | Place | How it went in |
|---|---|---|
| S-02 | §12.9 `feeds` | the basis cell, as written |
| S-03 | §12.9 `first`, `last` | the basis cell, as written |
| S-04 | §12.9 `/pipeline/ddl` | the paragraph, as written (ruling: the static file, served verbatim) |
| S-05 | §12.2 `last_events[].entry_date`, §12.4 `events[].entry_date` | presence as written; §12.2's shared `event_date`, `entry_date` row is split in two so only `entry_date` is nullable |
| S-06 | §12.2 `last_events[].regime`, §12.4 `events[].regime` | the type is `regime label` (no `"Unlabeled"`); the sentence goes after the basis code; §12.4's adds "(§12.2)" after `unlabeled_n`, which only `/study` serves |
| S-07 | §12.2 `horizons[].reason` | the basis cell, as written |
| S-08 | §12.2 templates | the sentence replaces "numbers printed by §1.9" |
| S-09 | §12.2 `worst`, `best` | appended, as written |
| S-10 | §12.2 | the row, after `comparison_session` (ruling) |
| S-11 | §12.0 `generation_id` | the meaning cell, as written |
| S-13 | §12.6 `threshold_mom` | the basis cell, as written; "equality is falling" is kept after it |
| S-14 | §12.1 `tiles.regime.data.months_in`, §12.6 `current.data.months_in` | as written, after "A:" (§12.1 keeps "length of") |
| S-15 | §12.7 `series.6m`, `.1y`, `.3y` | the basis cell, as written |
| S-16 | §12.3 `allowed_horizons` | the basis cell, as written |
| S-17 | §12.3 | a "Served reasons" paragraph after the catalog table, the three sentences as written |
| S-18 | §12.1 `active_signals` | inserted, as written |
| S-19 | §12.5 `signals[].stale` | "false for an unavailable row" goes after the definition, before "a stale row is never called firing today" |
| S-20 | §12.2 parameters | the sentence, before "Anything else: 422" |
| S-21 | §12.0 `engine_version`, `as_of` | as written (ruling); `as_of` keeps "null as above" |
| S-22 | §12.8 `credit.data.hy, .ig` | the basis cell, as written |
| S-23 | §12.1 `contributors[].state` | the cell now names both policies: the FRED inputs' mapping as before, then ^GSPC and GC=F in the row's words |
| S-24 | §12.8 `curve.data.today` | the basis cell, as written |
| S-25 | §13.1 step 2 | inserted mid-sentence, as written (ruling: lookups on the ordinary pool) |
| S-26 | §12.0 | the sentence, after the HTTP paragraph |
| S-27 | §12.0 blocks | the sentence, after the block-envelope paragraph |

Four sentences elsewhere in the spec now agree with the rows:
- §1.0.2: the RSI card prints the RSI rows' served reason, "RSI is not
  computed yet." (S-17). §1.0's table keeps its reason as the rationale.
- §1.10: `as_of` is the New York date the generation was staged (S-21).
- §4.1 Compute: a lookup reads under the stored-read ceiling, not the study
  queue (S-25).
- §12.3's catalog intro: every row with a question allows all four horizons
  (S-16).

**For Codex, or for you, on the words themselves:** S-06 says unlabelled
events are "events before the first labelled month", and §4's rail line says
the same. The stored regimes lack 2025-10, so an event in 2025-12, whose K−2
row is that missing month, is also unlabelled, well after the first
labelled month. The fixtures have no such event.

**Fixtures.** They are rebuilt where the wording changes a value:
- `study.json`:
  - `prev_session` 2026-09-22 (S-10).
  - `why` printed by the engine's `fmt_move`: "runs -1.6% to +4.1%", where
    it read "runs −1.6 to +4.1 pts" (S-08).
  - `provenance.engine_version` is the sha of the audit's commit
    `cd465f8d48323dbbfaa81b9246cf41a9d9d2b2f0`, whose engine produced every
    number (S-21). The envelope's `engine_version` (`FIXTURE_META`) is the
    same.
- `study-catalog.json`:
  - The dollar and both oil rows allow all four horizons, although they are
    unavailable (S-16).
  - The RSI rows carry "RSI is not computed yet." (S-17), as the Ledger's do.
- `technicals.json`: each chart series is the XNYS sessions after Sep 23 less
  6, 12 and 36 calendar months (127, 251 and 752 points), with Sep 22 a
  point whose close is null (S-15).
- `macro.json`: the curve dates all five tenors, null for the three not
  stored (S-24). IG stays 0.77% on Sep 23, as `source_watermarks` records it
  (S-22).
- `pipeline.json`: IG, BB, B and CCC keep their first month stamp
  (1996-12-01) as `first`, and take the newest observation, 2026-09-23, as
  `last` (S-03). The page prints a monthly series' dates by month (§1.7), so
  their notes name the date: "one row a month; newest observation
  2026-09-23".
- `regime-record.json`: its note says an event whose K−2 row is absent is
  counted and not listed (S-06).
- The fixture server:
  - `/positions` answers "Positions are kept in this browser; there is no
    server position store." (S-17).
  - `/pipeline/ddl` answers as `text/plain; charset=utf-8` (S-04).
  - `preset` also takes an engine slug that parses to a catalog study.
  - A cross with a window, or a shock move without one, is refused 422
    (S-20).

Unchanged, because the gold study has neither case: no event with a null
entry (S-05) and none unlabelled (S-06). No horizon carries an engine note:
the builder maps all four of S-07's notes, reading `(B < 5)` as the pattern
the engine writes ("(3 < 5)"), and fails on any other. There are
no ties at worst or best (S-09), no firing row (S-18), and no unavailable row
that is stale (S-19). `PROVENANCE.md` says each of these.

**`pipeline-ddl.ts`** stays a plain TS file (R-02). Its header now says that
once session B ships `api/static/snowflake_proposed.sql`, the one copy the
route serves verbatim, the file is generated from it by
`web/scripts/gen-ddl-fixture.mjs`, with a byte-for-byte test, and that
nothing under `web/` imports a `.sql` file. Its text starts with the line
the plan gives the file: "-- PROPOSED Snowflake export schema (not the
current SQLite layout); nothing in this project creates it.". That way B
moves the text as it stands.

**Types and schema:**
- `types.ts`:
  - `prev_session` on the study.
  - A `RegimeLabel` type for listed events, whose `entry_date` is nullable.
  - Tenor dates as `string | null`.
- `schema.ts`:
  - `prev_session`.
  - A listed event's `regime` is one of the four labels, and "Unlabeled" is
    not read as one (Advanced's events table and the rail print "—" in its
    place).
  - Tenor dates nullable.
- `data/api.ts` reads a refusal made before the route runs (`{detail}`, S-26)
  as its message.

**The monitored rows:** a position name cut with an ellipsis carries its
whole text as a `title`, on the Overview and on Position Monitor.

Tests:
- `consistency.test.ts`: a block for the errata (S-03, S-04, S-05/06, S-10,
  S-15, S-16/17, S-18/19, S-21, S-24). The `why` is checked against
  `fmt_move`, and worst/best take the earliest event on ties.
- `api.test.tsx`:
  - S-20 on the fixture server;
  - an "Unlabeled" regime and a null entry;
  - S-26's `{detail}`;
  - S-11's warm-up `computing`.
- `OverviewPage.test.tsx`: the title.
- `e2e/desk.spec.ts`:
  - no untitled truncated name at five widths;
  - the RSI card's reason.

**Against the PNGs.**
- 02 Technicals: the RSI card reads "RSI is not computed yet."; the
  one-year chart starts Sep 24, 2025; Sep 22, served as a point with a null
  close, is left out of the line. §1.0.2, §12.3, §12.7.
- 03 Event Study: the verdict box's second sentence reads "-1.6% to +4.1%"
  where it read "−1.6 to +4.1 pts". §12.2 templates (S-08).
- 07 Signal Ledger: the two RSI rows read "RSI is not computed yet.". §12.3.
- 10 Data Pipeline: IG's note names its newest observation, 2026-09-23.
  §12.9 (S-03).

Verifier (one round): **FAIL**, two should-fix and five nits. It found
every row in its §6 words (placement only), S-01 and S-12 untouched, the
fixtures byte-identical to a fresh build, and no sideways scroll, small sans
text or banned word on the changed pages at 1440, 1101 and 390.
- V16-1 (should-fix) §4.1 still put `/study/catalog` and the presets on the
  study queue, against S-25. **Fixed:** §4.1 names the lookup exception.
- V16-2 (should-fix) IG's true date appeared nowhere on Data Pipeline: the
  page prints `last` by month, and the note no longer carried the date.
  **Fixed:** the note says "one row a month; newest observation 2026-09-23",
  and a test holds the note to `last`.
- V16-3 (nit) the served `why` reads "-1.6%": for you, below.
- V16-4 (nit) the §1.7 sentence added for S-27 gave a failed live block the
  "○ Not yet served" badge. **Removed:** S-27 stays in §12.0 alone, and how
  such a block renders is yours, below.
- V16-5 (nit) §1.0.2 named the RSI card, then excepted it. **Fixed.**
- V16-6 (nit) §13.1 step 2 was not rewrapped. **Fixed.**
- V16-7 (nit) §12.4 says `unlabeled_n`, which `/study/events` does not
  serve. **Fixed:** "(§12.2)".
- For the operator: S-07's key `(B < 5)` is a pattern (the engine writes the
  block count), and S-06's "before the first labelled month" is narrower than
  the engine, above.
- Observation: the Technicals chart draws straight across Sep 22's null
  close (the page skips a null point); the spec gives no rule for gaps.

**For you** (the owner's calls, left as they are):
- `fmt_move` prints an ASCII hyphen, so the served `why` reads "-1.6%"
  beside the page's "−4.9%"; the rail prints the same interval as "−4.2 to
  +6.3 pts" by §1.9. S-08 and §1.9 disagree on how a served interval reads;
  a follow-up erratum would settle it.
- A block the server could not compute is served `awaiting` with "Awaiting
  refresh: this could not be computed from the current data." (S-27). The
  page renders every awaiting block by §1.0.2, badge "○ Not yet served",
  which §1.0 does not intend for a LIVE block. §1.7's gray "Awaiting
  refresh" is the other choice.

### S-01, S-12 and three amendments — `frame-3: spec errata S-01, S-12 and amendments`

The two rows the first pass left for Codex's revision, from the plan's §6 at
`9aa83d0`, then your three amendments to the first pass.

**S-01, §12.9 `validation`.**
- The row takes §6's replacement wording: the verdict of the
  `validation.json` published with the served database, by both writers, as
  `{verdict, mode, timestamp, db_sha256}`. The API verifies the sha,
  records the file's key right after that check, and serves the verdict only
  for the generation with that key; missing, mismatched or re-keyed gives
  null, which the UI prints as "unknown".
- One sentence carries the ruling: the key is recorded only when
  `<DB_PATH>-wal` is absent or empty, checked at the download and at every
  poll alike; with a non-empty WAL nothing is recorded and the verdict is
  null.
- The Date column names the published `validation.json`, where it said "the
  published run artifact".
- The page already prints "unknown" for a null verdict (`pipeline/badge.tsx`
  `validationWord`). The fixture's `"pass"` stands.

**S-12, §12.8 `rank_window`.**
- The row takes §6's wording: expected sessions are the XNYS sessions of the
  engine's calendar (`exchange_calendars`) in the window, minus
  `api/calendar.bond_extra_closures`; `valid_n` counts every finite stored
  observation in the window, weekend month-end prints included;
  `n = valid_n`.
- B-07's coverage sentence stays, now over "every expected session".
- The ruling's sentence: `api/calendar`'s holiday tables cover every year the
  store holds, generated from `exchange_calendars`' bounded regular and ad hoc
  holidays; they agree with its sessions from 1970 on and are the authority
  before 1970.
- The Date column reads "XNYS sessions less bond closures", where it said
  "bond calendar".
- The fixture follows. 747 sessions are expected, all of them stored, so
  coverage is complete. `n` and `valid_n` are 787: the 40 more are weekend
  month-end prints and values on bond-closure days and holidays, which the
  old rule left out. The rank and range read all 787. `hy_pct_3y` moves from
  0.1539 to 0.1550, so the gauge reads "16th pct" where it read "15th pct".
  The range, 2.59 to 4.61, and the band, tight, are unchanged.

**Amendment 1, S-08: U+2212.**
- §12.2's templates now say that after `fmt_move` the adapter substitutes
  U+2212 (−) for a number's leading hyphen, so a negative reads "−1.6%", and
  that the page prints the served string as is.
- The fixture's `why` reads "runs −1.6% to +4.1%". Its `headline` and the
  Client `summary` carry no negative number, so neither changes.
- The page applies no transform of its own.

**Amendment 2, S-27 / §1.7: the badge.**
- A block served awaiting whose reason begins "Awaiting refresh" badges
  "○ Awaiting refresh". Every other awaiting block badges "○ Not yet served".
- The rule is in the kit. `isAwaitingRefresh` tests the reason's start, and
  `NotServedBadge` takes the block and picks its words from it.
- Every badge site passes its block: `UnservedCard`, `Card`, the Overview's
  tiles, the answer card, and the page badges of Technicals, Ledger,
  Sectors, Macro and Regime. Basket & Hedge's badge has no served block and
  stays "Not yet served".
- §1.6, §1.0.2 and §1.7 state the rule.
- The sidebar's TODAY card follows it too. For such a block it says "Regime
  awaiting refresh" or "Awaiting refresh", where it would have said "not yet
  served", so the card does not contradict the badge beside it. §1.7 says so.
  This goes a step past "badges", and it is yours to keep or drop.

**Amendment 3, S-06 and §4's rail line.** An unlabelled event is one "whose
K−2 month has no stored regimes row" in §12.2's and §12.4's regime rows and
in §4's rail line, and the rail prints "Unlabeled: <n> events whose K−2
month has no stored regimes row". The gold study has none, so no shot
changes.

Tests:
- `kit/Unserved.test.tsx`, three tests: a block whose reason begins
  "Awaiting refresh" badges "Awaiting refresh" and prints its reason; any
  other badges "Not yet served", as does a card with no served block; the
  rule's edges (case, a mid-sentence match, null).
- `OverviewPage.test.tsx`: the regime tile badges "Awaiting refresh" beside
  a "Not yet served" vol tile, and the sidebar says "Regime awaiting
  refresh".
- `consistency.test.ts`: no served template leads a number with a hyphen;
  S-12's window counts.
- `EventStudyPage.test.tsx`: the rail text and the verdict box.
- `MacroPage.test.tsx`: the 16th percentile.

**Against the PNGs.**
- 03 Event Study: the verdict box reads "−1.6%" where it read "-1.6%".
  §12.2 templates, as amended.
- 05 Macro & Correlations: the HY gauge reads "16th pct" where it read "15th
  pct". §12.8 (S-12).

Verifier (one round): **PASS**, four nits, nothing should-fix. It found:
- S-01 and S-12 in §6's words;
- every badge site passing its block, and the Basket & Hedge badge right
  without one;
- the page printing the served strings untransformed;
- S-12's counts matching a query of the audit's store under
  `exchange_calendars` 4.13.2: 752 sessions less 5 bond closures, 787 finite
  rows, 122 below the current value.
- V17-1 (nit) a Macro test comment still said "747 bond sessions". **Fixed.**
- V17-2 (nit) §12.9's `last_refresh_utc` row still names "the published run
  artifact", which the API cannot read (the plan sources it from
  `source_watermarks`). No §6 row rules on it, so it is left for a later
  erratum.
- V17-3 (nit) the fixture's `validation: "pass"` was listed neither real nor
  illustrative. **Fixed:** PROVENANCE.md lists it illustrative, since no
  `validation.json` was published with the audit's store.
- V17-4 (nit, yours) a card served "Awaiting refresh" still says "Advanced ▸
  not yet served" under its "○ Awaiting refresh" badge. §1.0.2 says the
  control reads "not yet served", and the amendment covers badges only.

**For you:**
- Whether the Advanced control follows the badge rule (V17-4).
- Whether the TODAY card keeps the rule (amendment 2).
- `last_refresh_utc`'s source wording (V17-2).

### last_refresh_utc — `frame-3: spec erratum last_refresh_utc`

§12.9's `last_refresh_utc` is S: the `checked_at` of the `source_watermarks`
row `"desk_series"`. The Desk store runs only in the full refresh, so that
row dates the last full run. It is never the run artifact, which the API
cannot read. The row's Date column names the watermark row, where it said
"the published run artifact". This closes the leftover V17-2 found.

The fixture already carries that value. In the audit's store the
`desk_series` row has `checked_at` 2026-09-24T15:52:43Z, the fixture's
`last_refresh_utc`, so `pipeline.json` is unchanged. `PROVENANCE.md` now
lists the value as real, a stored read, where it was illustrative
(NEEDS-ENDPOINT). No page changes, and no compare shot changes.

## Gate log

Each commit ran all four gates on the tree as committed: `tsc -b --noEmit`,
`vitest run` (the whole web suite), `npm run build`, and the Desk browser
tests against the fixture dev server.

| Commit | Typecheck | Unit (files / tests) | Build | Desk browser |
|---|---|---|---|---|
| frame-3: overview | clean | 105 / 1,156 | ok | 10 / 10 |
| frame-3: technicals | clean | 106 / 1,171 | ok | 13 / 13 |
| frame-3: event-study | clean | 106 / 1,176 | ok | 16 / 16 |
| frame-3: regime | clean | 107 / 1,192 | ok | 17 / 17 |
| frame-3: macro | clean | 108 / 1,211 | ok | 19 / 19 |
| frame-3: sectors | clean | 110 / 1,230 | ok | 21 / 21 |
| frame-3: signal-ledger | clean | 111 / 1,244 | ok | 23 / 23 |
| frame-3: position-monitor | clean | 110 / 1,253 | ok | 25 / 25 |
| frame-3: data-pipeline | clean | 109 / 1,259 | ok | 27 / 27 |
| frame-3: build-notes | clean | 110 / 1,274 | ok | 29 / 29 |
| frame-3: client-toggle | clean | 111 / 1,285 | ok | 32 / 32 |
| frame-3: basket-hedge | clean | 113 / 1,312 | ok | 34 / 34 |
| frame-3: codex-1 robustness | clean | 115 / 1,332 | ok | 45 / 45 |
| frame-3: codex-2 contract | clean | 116 / 1,352 | ok | 46 / 46 |
| frame-3: codex-3 fixtures | clean | 117 / 1,368 | ok | 46 / 46 |
| frame-3: codex-4 dates-levels | clean | 117 / 1,375 | ok | 48 / 48 |
| frame-3: spec fold v2–v4 | docs only | — | — | — |
| frame-3: align 1 envelope | clean | 118 / 1,403 | ok | 50 / 50 |
| frame-3: align 2 units | clean | 118 / 1,409 | ok | 51 / 51 |
| frame-3: align 3 counts-horizon | clean | 118 / 1,417 | ok | 52 / 52 |
| frame-3: align 4 verdicts | clean | 118 / 1,420 | ok | 53 / 53 |
| frame-3: align 5 baseline | clean | 118 / 1,424 | ok | 53 / 53 |
| frame-3: align 6 regime-recession | clean | 118 / 1,428 | ok | 54 / 54 |
| frame-3: align 7 unavailable | clean | 118 / 1,431 | ok | 55 / 55 |
| frame-3: align 8 slots | clean | 119 / 1,445 | ok | 56 / 56 |
| frame-3: align 9 firing | clean | 119 / 1,450 | ok | 56 / 56 |
| frame-3: align 10 positions | clean | 122 / 1,480 | ok | 56 / 56 |
| frame-3: align 11 basket-hedge | clean | 122 / 1,462 | ok | 54 / 54 |
| frame-3: align 12 fixtures | clean | 122 / 1,465 | ok | 54 / 54 |
| frame-3: align 13 build-notes | clean | 123 / 1,477 | ok | 54 / 54 |
| frame-3: align 14 rulings and codex-2 fixes | clean | 121 / 1,475 | ok | 54 / 54 |
| frame-3: align 15 label and codex-2 repros | clean | 122 / 1,485 | ok | 54 / 54 |
| frame-3: spec errata S-02–S-27 | clean | 122 / 1,498 | ok | 54 / 54 |
| frame-3: spec errata S-01, S-12 and amendments | clean | 122 / 1,504 | ok | 54 / 54 |
| frame-3: spec erratum last_refresh_utc | clean | 122 / 1,504 | ok | 54 / 54 |

## Finish

Every tab in §13's order is committed, each after its compare shot, its
verifier rounds and the four gates. Basket & Hedge came last, once every
other tab was committed and green. No tab was stopped on a mismatch.
Overview and Build Notes matched on their first pass, and every other tab
matched on its second. Each tab's Compare line says what its first pass
missed.

Tip: the commit that carries this report, `frame-3: basket-hedge`, on
`desk/frame-3` (parent `cff06a1 frame-3: client-toggle`), local only. Nothing
is pushed. No `.db`, `data/`, secret, `api/`, `src/` or `scripts/` file was
touched. The spec's changes are its PROPOSED additions in §12.13 and the
pointer under §12.12.

Gate summary at the tip: typecheck clean; unit 113 files / 1,312 tests;
build ok; Desk browser tests 34 / 34. The per-commit rows are in the gate log above.

After Codex round 1 (above): the tip is the commit that carries this
report, `frame-3: codex-4 dates-levels` (parent `dd5e69e frame-3: codex-3
fixtures`, after `f3c182a` and `7166f1c`), local only. Nothing is pushed.
The round touched `web/` and `docs/desk/` only. R-15 is deferred to the
API branch with its two lines. Gate summary at that tip: typecheck clean;
unit 117 files / 1,375 tests; build ok; Desk browser tests 48 / 48.

After the fold and alignment (above): the tip is the commit that carries
this report, `frame-3: align 13 build-notes` (parent `1591bff frame-3: align
12 fixtures`), on `desk/frame-3`, local only; the fold is `a863fc7` and the
thirteen items follow it, one commit each (`f19d52d` … `1591bff`, then the
tip). Nothing is pushed. Only `web/` and `docs/desk/` were touched; your
uncommitted `docs/desk/BUILD_NOTES.md` and the five SVGs in
`docs/desk/screens/` are left out of every commit. Gate summary at the tip,
on a copy of the tree with the committed notes file: typecheck clean; unit
123 files / 1,477 tests; build ok; Desk browser tests 54 / 54. With your new
notes file in place, the Build Notes, language and shell suites pass too.

After item 14 (above): the tip is the commit that carries this report,
`frame-3: align 14 rulings and codex-2 fixes` (parent `54510e8 frame-3: align
13 build-notes`), local only. Nothing is pushed; only `web/` and `docs/desk/`
were touched, and your notes file and SVGs are left out. Gate summary at
that tip: typecheck clean; unit 121 files / 1,475 tests; build ok; Desk
browser tests 54 / 54. Of the list below, the Client title, the Regime
reading, the frame-2 panel, the bridge title and the headline size are now
settled by your rulings; the 13 client labels wait on your approval.

After item 15 (above): the tip is the commit that carries this report,
`frame-3: align 15 label and codex-2 repros` (parent `8fa4dea frame-3: align
14 rulings and codex-2 fixes`), local only. Nothing is pushed; only `web/`
and `docs/desk/` were touched. Your notes file and SVGs, `CLAUDE.md`, and the
Python tests and script that read the frame-2 fixtures are left for the
merge. The 13 client labels are approved, the gold one as you rewrote it.
Codex round 2's own repros all pass; R-16's positions half passed only after
this commit. Gate summary at that tip: typecheck clean; unit 122 files /
1,485 tests; build ok; Desk browser tests 54 / 54.

After the spec errata (above): the tip is the commit that carries this
report, `frame-3: spec errata S-02–S-27` (parent `00c9a2e frame-3: align 15
label and codex-2 repros`), local only. Nothing is pushed. Only `web/` and
`docs/desk/` were touched; your notes file and SVGs are left out. S-01 and
S-12 wait on Codex's revision. Every other row of the API plan's §6 is in
the spec in its own words. Gate summary at that tip: typecheck clean; unit
122 files / 1,498 tests; build ok; Desk browser tests 54 / 54.

After S-01, S-12 and the amendments (above): the tip is the commit that
carries this report, `frame-3: spec errata S-01, S-12 and amendments`
(parent `ef3a338 frame-3: spec errata S-02–S-27`), local only. Nothing is
pushed. Only `web/` and `docs/desk/` were touched; your notes file and SVGs
are left out. Every row of the API plan's §6 is now in the spec. Gate summary
at that tip: typecheck clean; unit 122 files / 1,504 tests; build ok; Desk
browser tests 54 / 54.

After the `last_refresh_utc` erratum (above): the tip is the commit that
carries this report, `frame-3: spec erratum last_refresh_utc` (parent
`0d3996f`), local only. Nothing is pushed; your notes file and SVGs are left
out. Gate summary at that tip: typecheck clean; unit 122 files / 1,504
tests; build ok; Desk browser tests 54 / 54.

For Max, from the fold and alignment:
- **Spec conflicts to settle:** §12.2 makes the Client title the catalog
  label, which carries a σ, and §11 says the Client view prints no σ;
  §12.2's `provenance.entry_rule` is the engine's whole entry sentence, so
  Event Study's provenance line runs three lines; Regime shows the K−2 row
  beside next prints read from the latest print, so "Inflation Falling" and
  "flips inflation to falling" sit together (item 12).
- **Left for you:** the frame-2 engine panel in Advanced, which §4 retires;
  the Data Pipeline bridge card's title, which §11 gives as
  "Proposed export schema (not the current SQLite layout)"; the Event Study
  headline's type size (21px, §4 says 17px) (item 12).
- **Your notes file:** §9's sentence that the browser gate is a workflow
  check; the two placeholders; the five SVGs to commit with it, and the
  Docker lines for both (item 13, R-15).
- **For session B (the API):** `api/calendar` has no 2023 holidays, which
  the §12.8 rank window reaches until late 2026 (item 12, PROVENANCE.md).

For Max:
- **BUILD_NOTES.md** uses "established" twice (§10 quotes both sentences);
  the page holds them until the file is reworded. The frame-3 notes in the
  PNG also use "always" and "model", which the language scan would stop
  once they are written into the file (§10, B-5).
- **The Docker image** needs `docs/desk/BUILD_NOTES.md` copied in for Build
  Notes to show the notes in a deployed build (§10, B-1: one `COPY` line and
  one `.dockerignore` negation; Codex round 1's R-15 gives the two lines).
  Until then the page says the file is not in that build. On Vercel, confirm the setting that includes files outside the
  root directory.
- **Position Monitor's gate fields ship empty;** the monitored positions'
  variant, pre-mortem and red-team texts in `positions.json` (all three
  rows the mockup draws) carry `TODO(Max)` for Max's own words.
- **PROPOSED fields** for session B are listed in the spec's §12.13, tab by
  tab, with the notes for B at its end.

Follow-ups (not done here):
- ~~`LEGACY_FRAME2` in `desk-language.test.ts` now lists one file,
  `src/screens/desk/pyformat.ts`.~~ Closed by item 14: the frame-2 panel,
  `pyformat.ts` and `LEGACY_FRAME2` are gone.
- `web/src/styles/desk.css` (1,502 lines, frame-2) is still imported by the
  shell, but only its walkthrough-strip rules (`.mrr-desk-tour*`) style
  anything the v2 Desk renders. Cutting it down to those is a follow-up.
- The fixtures carry one study and one hedge. Every other question, weight
  set, mode or subject answers 404 in fixture mode, and the pages show
  their awaiting states until session B serves them.
