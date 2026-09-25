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
until this section and the count are updated.

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

For Max:
- **BUILD_NOTES.md** uses "established" twice (§10 quotes both sentences);
  the page holds them until the file is reworded. The frame-3 notes in the
  PNG also use "always" and "model", which the language scan would stop
  once they are written into the file (§10, B-5).
- **The Docker image** needs `docs/desk/BUILD_NOTES.md` copied in for Build
  Notes to show the notes in a deployed build (§10, B-1: one `COPY` line and
  one `.dockerignore` negation). Until then the page says the file is not in
  that build. On Vercel, confirm the setting that includes files outside the
  root directory.
- **Position Monitor's gate fields ship empty;** the monitored positions'
  variant, pre-mortem and red-team texts in `positions.json` (all three
  rows the mockup draws) carry `TODO(Max)` for Max's own words.
- **PROPOSED fields** for session B are listed in the spec's §12.13, tab by
  tab, with the notes for B at its end.

Follow-ups (not done here):
- `LEGACY_FRAME2` in `desk-language.test.ts` now lists one file,
  `src/screens/desk/pyformat.ts`. It is the frame-2 number formatter that
  Event Study's engine panel still uses (`event-study/format.ts`), so it
  keeps the frame-2 list only.
- `web/src/styles/desk.css` (1,502 lines, frame-2) is still imported by the
  shell, but only its walkthrough-strip rules (`.mrr-desk-tour*`) style
  anything the v2 Desk renders. Cutting it down to those is a follow-up.
- The fixtures carry one study and one hedge. Every other question, weight
  set, mode or subject answers 404 in fixture mode, and the pages show
  their awaiting states until session B serves them.
