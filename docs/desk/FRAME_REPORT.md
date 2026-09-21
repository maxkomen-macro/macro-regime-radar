# Desk · frame, shells, and non-analytical modules — report

Branch `desk/frame`, cut from `324d583` (the launch line). Built 2026-09-21 in the worktree
`/Users/maxkomen/Projects/Macro/macro-regime-radar-frame`. Frontend (`web/`) and routing, plus the
one read-only endpoint §7 allows. Nothing pushed, `main` untouched, no secret in any file, the real
database never written. **Stopped at the gate: waiting for `PUSH OK desk/frame`.**

## 0. Investigation (reported before building)

**Tokens reused** (all from `web/src/styles/tokens/*.css`; DESIGN.md wins): surfaces `--bg`,
`--panel`, `--tile`, `--card-grad`, `--sidebar`, `--field`, `--track`; lines `--line`, `--line-2`,
`--line-strong`, `--line-white-14`, `--line-white-30`; the text ladder `--text` … `--text-4`,
`--text-eyebrow`, `--text-wordmark`; status `--mint` (live), `--amber`, `--neg`, `--warn-hot`,
`--link`, the 7 % tint alphas; type `--font-ui` / `--font-mono` / `--font-display` with
`--fs-eyebrow(-sm)`, `--fs-badge`, `--fs-kv`, `--fs-caption`, `--fs-body`, `--fs-nav(-sub)`,
`--fs-hero-sub`, `--fs-display`; spacing `--sidebar-w`, `--main-pad`, `--topbar-h`, `--nav-sub-h`,
`--gap-panel`, `--gap-tile`, `--pad-panel`, `--pad-tile`; radii `--r-card`, `--r-tile`, `--r-ctl`,
`--r-badge`, `--r-pill`, `--r-nav`; motion: the reduced-motion block; the only shadow used is
`--glow-dot` (unused on the Desk in practice: nothing there pulses).

**Components and primitives reused:** `Card`, `Tag`, `Pill`, `Segmented`, `SectionHeader`,
`DataTable` (barrel `components/index.ts`); `Caption`, `StateNote`, `eyebrowStyle`, `mono`
(`screens/shared/screen-ui.tsx`); `Jargon` (jargon tooltip); `fresh-state.ts` (`freshLabel`,
`groupLabel`, `stampLabel`, `toneColor`, `toneGlyph`) with `useFreshReport` (the freshness chip
vocabulary); the shell `Markdown` renderer; `ErrorBoundary`; `ScrollTable`; `Wordmark` (exported by
`Sidebar.tsx`); `useBreakpoint().shellCompact` (<860, the one width mechanism); the shell classes in
`app.css`: `.mrr-app`, `.mrr-side`, `.mrr-main`, `.mrr-mnav*`, `.mrr-btn*`, `.mrr-skip`, `.sr-only`,
`.mrr-md`.

**Route structure found:** `/` landing · `/app` → `/app/dashboard` · `/app/:tab` (AppShell over the
seven tabs in `sections.ts` plus `methodology`) · `/kit` · `*` → `/`. Added: `/desk/:page?` on a lazy
`DeskShell` (`/desk` and any unknown page land on Today). The entry control sits in the TopBar's
left grid track (empty since Phase 10) at ≥860; below 860 the app MobileNav list carries the Desk
row. The Desk wordmark links to `/app/dashboard`. Client view rides on `?view=client`.

**Findings that changed the plan**
- Nothing was listening on :8000 (another session's uvicorn sits on :8123; untouched). The §7
  endpoint lives in this worktree's `api/`, so the main checkout's API could not have served it. I
  copied the main checkout's database read-only (`sqlite3 -readonly … ".backup"`, integrity ok) into
  this worktree's gitignored `data/macro_radar.db` and started this worktree's API on :8000 with
  `EODHD_API_TOKEN=""` (relay off, `token_configured: false`), plus Vite on :5173. The copy is the
  Sep 15 snapshot with no `source_watermarks`, so many FRED daily series honestly read
  "As of unknown" and the stored closes read "Sep 14 · 5 sessions behind" on every badge.
- `shot.mjs` (§8) is not in this worktree (it lives under `proposals/ui-review/tools/` on the review
  checkout). The existing capture tool here is `web/scripts/screenshot.mjs` (puppeteer-core, system
  Chrome); I extended it with `--print`, `--css`, `--local key=json`, `--click`, `--reduced-motion`
  flags (the two-argument form is unchanged).
- `docs/redesign-v2/` (the redesign spec with §0.5 and the label baseline) is not in this worktree.
  The parity guarantees present here ran: hook-coverage (vitest), the Kit manifest test, the AppShell
  suites; the label-parity e2e needs the missing baseline and could not run.
- The product is dark-only (DESIGN.md waiver). The "light" check is the print one-pager, which
  re-tokens the same DOM for paper.
- `/api/desk/positions`: no store exists (positions are browser-local per §5), so it was not added.

## 1. What was built, by spec section

| § | Item | Where |
|---|---|---|
| 1 | `/desk`, title "Desk", eyebrow "Analyst Workspace"; entry link "Analyst Workspace →" in the app TopBar (a text link, not a tab); MobileNav row below 860; Desk wordmark → `/app/dashboard` | `web/src/App.tsx`, `screens/shell/TopBar.tsx`, `screens/shell/MobileNav.tsx`, `screens/shell/Sidebar.tsx` (`Wordmark to`), `screens/desk/DeskShell.tsx`, `DeskSidebar.tsx`, `DeskMobileNav.tsx` |
| 2 | Sidebar groups SURVEY (Today, Launchpad, Dashboard → `/app/dashboard`), ACT (Event Study, S&P Internals, Position Monitor, Pitch Evaluation, Red Team, Macro / Regime), TOOLS (Basket Builder, Hedge Simulator, Data Pipeline, Build Notes); footer card "House Discipline · Enforced" with the four rules | `desk-sections.ts` (registry), `DeskSidebar.tsx` (`HouseDiscipline`), `styles/desk.css` |
| 3 | `StatusBadge`: `● Live · {source} · as of {stamp}` from `/api/freshness` through `useFreshReport` + `fresh-state.ts`; `Designed` in the muted style; the Data Pipeline badge dates itself from the inventory's `generated_at` | `StatusBadge.tsx`, `badge-sources.ts` |
| 4 | Desk / Client toggle in the Desk top bar, persisted as `?view=client` and kept on every Desk link; client view hides the query builder, N, quartiles, intervals, bootstrap details, method ids, z-scores and the promote form, prints hit rates and moves as words; "Export one-pager" calls `window.print()` and the `@media print` block re-tokens the same DOM (no second template) | `desk-view.ts`, `DeskTopBar.tsx`, `words.ts`, `desk.css` (print block) |
| 5 | Event Study: builder (shock asset, window 5/20/60, threshold 1.5/2.0/2.5, sign, co-condition, regime filter, target, Run), distribution chart (inline SVG), horizon table, regime split, last ten events, verdict card, provenance line; assets from `/api/desk/event-study/assets` with `history_from` shown and short-history warnings; `?study=<slug>` with the spec's `gold-2sigma-spx-weak`; fixture (preset only) labelled `Designed` + `Fixture` until the engine answers | `event-study/EventStudyPage.tsx`, `studies.ts`, `fixture.ts`, `DistributionChart.tsx`, `api/desk.ts` |
| 5 | Position Monitor: form (instrument, direction, size, horizon) + gate (variant view, pre-mortem, numeric falsification level tied to a series from the FRED catalogue or the 23 stored symbols); language check on the eight words with a suggested rewrite and a Replace control; Save disabled until the gate passes; the submit handler and the store each re-run the gate; monitored list with live distance (`/series/{id}/latest`, `/api/market/daily`); "Saved on this device"; seeded with nothing | `positions/gate.ts`, `store.ts`, `series.ts`, `PositionMonitorPage.tsx` |
| 5 | Data Pipeline: lineage (Sources → Fetch → Validate → Transform → Store → Serve), inventory table from the endpoint (series, source id, cadence, as-of, status, feeds), RAW → CUR → MART schema block from `web/src/content/desk/schema.md` | `pipeline/DataPipelinePage.tsx`, `Lineage.tsx`, `schema-parse.ts`, `content/desk/schema.md` |
| 5 | Build Notes: rendered from `web/src/content/desk/BUILD_NOTES.md`, five headings, one-line placeholders (Max writes the text) | `notes/BuildNotesPage.tsx`, `shell/Markdown.tsx` (`headingLevel`) |
| 5 | Today: regime label as the page's serif answer with the dominant-odds pill; recession probability with its provenance sentence (source `recession_model`, a separate model); signals fired in the last five sessions (alert feed, seven calendar days back from the last completed session; empty state names the Triggered count); open positions nearest falsification | `today/TodayPage.tsx` |
| 6 | Seven designed shells with layout, controls (reachable, stateful, inert), empty states, one-line "reads once live" note, no fake numbers | `shells/DesignedShellPage.tsx` |
| 7 | `GET /api/desk/pipeline/inventory`: the freshness `series[]` joined with provider and reader facts; GET only; no `src.*` import; nothing computed | `api/desk.py`, `api/main.py` (router include), `tests/test_desk_api.py` |

Decisions worth a second look:
- **"Live" is the wiring word; freshness rides beside it.** A stale source reads
  `▾ Live · FRED · as of Sep 04 · 8 days behind` with the warn-hot glyph and tail, never a clean mint
  dot; unknown reads `◇ Live · … · as of unknown`; a seeded snapshot reads `◇ Snapshot · …`. Monthly
  sources name their cadence in the source ("FRED monthly"). This keeps the spec's two-state badge
  while honouring DESIGN.md's "never call monthly data live" through the stamp.
- **Build Notes and the schema block declare `Designed`** because §3 says a panel with no data source
  does; their tooltips say the text is authored.
- **The Event Study fixture covers the preset only.** Any other query with the engine absent prints
  what is missing and a "Load the preset" control instead of inventing numbers.
- **The entry link renders on every `/app` route's top bar**, since the TopBar is shared; it hides
  below 860 where the MobileNav row takes over.
- **The distribution payload is provisional** (`EventStudyResponse.distribution`; the spec lists no
  bins). When the engine serves none, the panel says so.

## 2. Verification

Servers: worktree API on :8000 (`EODHD_API_TOKEN=""`), Vite on :5173. Commands run from the
worktree (`web/` for the Node ones):

| Check | Result |
|---|---|
| `npx tsc -b --noEmit` | clean |
| `npx vitest run` (full) | 94 files, 1072 tests passed (the Desk adds 9 files / 35 tests: gate, store, view, words, slugs, schema parser, badge, shell, session window) |
| `npx vite build --outDir ../logs/dist-check` | built; `DeskShell` and each Desk page are their own chunks |
| `pytest tests/test_api.py tests/test_desk_api.py` (main `.venv`) | 50 passed, 2 skipped |
| `npx playwright test e2e/desk.spec.ts` | 8 passed: tab walk on Position Monitor (every stop named, ringed; disabled Save not a stop; every group page a stop), gate vs Enter and vs URL params (nothing saved), keyboard save + reload, keyboard Desk/Client toggle in the URL, reduced motion (nothing animates), 390 mobile nav with every page and no horizontal overflow, dashboard one h1 + entry link only ≥860 + MobileNav row, every Desk page badge + title + no overflow |
| Screenshots (`web/scripts/screenshot.mjs`, gitignored under `proposals/desk-frame/`) | 28 frames: today, event-study, position-monitor (seeded with one position via `--local`), data-pipeline, build-notes, red-team, basket-builder, launchpad at 1440×900 and 390×844; today and event-study client view at 1440; the print one-pager for both (`--print`, light); today at 390 with the menu open; dashboard before (`--css ".mrr-top .mrr-desk-entry{display:none !important}"`) and after at 1440; Position Monitor client view and Macro / Regime at 390; the verifier's own `verifier-*.png`; dashboard at 390 with the menu open |

Visual review of the captures (mine, then the verifier's) led to six fixes before verification:
the condition label's case in the study title, the inventory's Status column moved before Feeds
(it sat off-screen at 1440), the sidebar tightened at ≤999 px tall so the House Discipline card
stays in view, the Query panel's badge (`Designed` while the asset lists are the fixture), the
client words for "against baseline", and the positions row in the side column. Playwright found the
one real defect of the pass: the entry link's rules lived in `desk.css`, which loads only with the
Desk chunk, so on the dashboard the link was unstyled and did not hide at 390; the rules moved to
`app.css`.

Keyboard and gate: the walk on Position Monitor has the skip link first, then the wordmark, the
thirteen sidebar rows, the Desk / Client buttons, every field and the Clear button; Save appears in
the order only once the gate passes. Enter in a field does not submit while the only submit button
is disabled (the browser suppresses implicit submission) and the gate row states what is missing;
a programmatic submit meets `gateStatus` again, and `addPosition` in the store runs it a third time,
so a script cannot save a refused draft either. URL parameters never reach the form state.

## 3. Verifier

An independent general-purpose agent that wrote none of the code verified the working tree
against the spec (56 tool calls; evidence in `logs/verifier-*.log`, captures
`proposals/desk-frame/verifier-*.png`, its scratch spec deleted). Verdict: **PASS WITH
FINDINGS**, no S0 or S1. Its findings and what was done:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | S2 | Client view leaked N and the σ threshold: the chart legend and aria-label printed "41 events", the caption "41 conditional events", the regime split "n<10", the h1 "+2.0σ". | Fixed. Client view titles the study in words ("after an unusually large 20-session rise"), the chart takes no count, the caption reads shares only, and a suppressed regime reads "too few events to read". |
| 2 | S2 | `.mrr-desk-row` kept its two-column grid at 390: Today's positions row had an 83 px text column, the Macro / Regime inputs 0 px, the Pitch rubric 136 px. | Fixed. Below 768 every row stacks (`desk.css`, verifier block); re-captured Today, Position Monitor (client) and Macro / Regime at 390. |
| 3 | S2 | A dated badge (the Data Pipeline's "as of Sep 21, 18:31 ET") painted mint while the inventory's own verdict was `stale`. | Fixed. `BadgeSource.verdict` carries the payload's four-word verdict for a dated feed; the pipeline badge now takes `overall` (stale → warn-hot, delayed → amber, current → mint, none → grey). Test added. The badge header now states the colour rule. |
| 4 | S3 | Today's h1 pill printed "64%" in client view. | Fixed: no pill in client view; the sentence already says "about six in ten". |
| 5 | S3 | A malformed `?study=` silently showed the preset. | Fixed: a status line names the unrecognised slug and says the preset is shown. |
| 6 | S3 | The House Discipline card sat 10 px below the fold at 1440×900 (Chromium) and further at 760 / 680 tall. | Tightened one more step at ≤999 and ≤859 px tall (rows 29 / 27 px). The sidebar still scrolls on very short viewports; "pinned" holds at laptop heights. |
| 7 | S3 | `dashboard-before` and `-after` were byte-identical (the injected `.mrr-desk-entry{display:none}` lost to the two-class rule in app.css); `event-study-client-1440` was a stale capture. | Fixed the injection (`.mrr-top .mrr-desk-entry{display:none !important}`) and re-captured both; `cmp` now differs. |
| 8 | S3 | `window.scrollTo` logged "Not implemented" in jsdom on every shell test. | Fixed: the shell scrolls only when the page is not already at the top. |
| 9 | S3 | Sidebar "Dashboard" and the wordmark go to `/app/dashboard`; §2 says `/`. | Kept, and recorded as a decision: `/` is the landing page, and §1 says the wordmark "links back to the dashboard". Max to overrule. |
| 10 | S3 | "Last five sessions" was seven calendar days. | Improved: the last completed session and the four weekdays before it (holidays unknown client-side; the dates are printed, test added). |
| 11 | S3 | Two explainers were set in mono (the "reads once live" line, the designed-shell footer). | Fixed: both in the UI face. |
| 12 | S3 | A row hand-written into `mrr.desk.positions.v1` with banned words lists unflagged. | By design and recorded: the store validates shape; the gate guards the app's own save path, and the device is the visitor's. |

Verified passing by the verifier (its list, condensed): the routes and redirects with the view
kept; title, eyebrow, one h1 per page, `document.title`; the entry link in the header only, flex at
860 and none at 859; the sidebar groups, items, marks and `aria-current`; the House Discipline card;
a badge on every page in both views, every live badge routed through `useFreshReport` and
`fresh-state.ts`, no hand-typed dates; the client view on all 25 links, the builder and the form
absent, Export present, print emulation on three routes with no second template; every §5 module
and control; the gate against Space and Enter on the disabled button, `requestSubmit()`, a
dispatched `submit`, URL parameters, non-numeric levels and all eight words; a keyboard save that
persists, shows its live distance, survives a reload and reaches Today; the seven shells with no
data-like numbers; the one GET endpoint, POST → 405, states equal to `/api/freshness`; its own tab
walks on four pages with zero ringless or nameless stops; reduced motion; no horizontal overflow at
1440 or 390 in either view; `prefers-color-scheme: light` stays dark.

After the fixes: `tsc` clean, Desk unit tests 35/35, full vitest 1072/1072, Playwright 8/8,
Desk API tests 5/5.

## 4. Follow-ups (not in scope, recorded)

- The command palette and the analyst panel are not mounted in the Desk shell; the Desk sidebar has
  no collapse rail. All three are a small lift once the frame is accepted.
- Stream A's field names (`docs/desk/EVENT_STUDY_SPEC.md` §7) are typed provisionally in
  `web/src/api/desk.ts`; reconcile against `EVENT_STUDY_REPORT.md` when it lands, and add
  distribution bins to the engine or drop the chart's provisional payload.
- The falsification series catalogue is a static list mirroring `src/config.py` and the stored
  universe; a `/series` read could replace it.
- `docs/redesign-v2/` is absent from this worktree, so the label-parity e2e did not run here.

## 5. After `PUSH OK desk/frame`

```
git push -u origin desk/frame
```
Nothing else. Stop the worktree servers (`lsof -nP -iTCP:8000 -sTCP:LISTEN`, `:5173`) when done;
`data/macro_radar.db` in this worktree is a gitignored read-only copy and can be deleted.
