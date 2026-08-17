# Overnight Design Kickoff — Morning Report

Session: 2026-08-06, overnight (local only — **nothing committed, nothing pushed**).
Scope delivered: design constitution (provisional), `web/` scaffold (Vite + React 18 + TS),
17 bundle components ported with `/kit` proof route, app shell per the locked IA, landing
page draft, Dashboard v1 draft wired to the real API, one critique + audit pass, this report.

---

## What was built

| Piece | Where | State |
|---|---|---|
| PRODUCT.md (impeccable init) | `web/PRODUCT.md` | Done — interview answers taken from the overnight brief as directed; facts labeled [brief]/[bundle]/[repo] |
| DESIGN.md constitution | `web/DESIGN.md` | Done — **PROVISIONAL, pending owner review**; scan-mode record of the bundle (tokens verbatim, nothing invented) |
| Design sidecar | `web/.impeccable/design.json` | Done — component snippets, motion/shadow extensions, narrative |
| Vite scaffold | `web/` | Done — React 18.3, TS strict, TanStack Query 5, react-router 6; `npm run dev` on :5173 |
| Token layer | `web/src/styles/` | `styles.css` + `tokens/` copied **verbatim**, except `fonts.css` → self-hosted `@font-face` (the bundle's own documented offline path) |
| Fonts | `web/public/fonts/` | 6 woff2 (latin): Space Grotesk var, IBM Plex Sans var, IBM Plex Mono 400/500/600/700 — downloaded once from Google Fonts; **no CDN at runtime** |
| 17 components + `.d.ts` + `.prompt.md` | `web/src/components/{core,data,intel,nav,signals}` | Verbatim, one build-compat diff (see Deviations) + `index.ts` barrel |
| `/kit` proof route | `web/src/screens/KitScreen.tsx` | All 17 render with the five specimens' fixture data — screenshot `screenshots/web/kit.png` |
| API layer | `web/src/api/{types,client,queries}.ts` | Typed mirrors of every `/api/*` endpoint + `/series/{id}/latest`; EODHD WebSocket seam documented in `useMarketIntraday` |
| App shell | `web/src/screens/shell/` | Locked-IA header: wordmark + honest live dot, real ticker (SPY/QQQ intraday 30s poll + US 10Y), regime badge + probability bar, alerts trigger + drawer (all-clear state verified), Methodology link, ⌘K palette (35 destinations, keyboard nav), 7-tab URL routing, freshness line |
| Landing page | `web/src/screens/LandingPage.tsx` | One viewport at `/`: wordmark, live regime read off the API, 3-sentence plain-English explanation, architecture line, single CTA |
| Dashboard v1 | `web/src/screens/dashboard/` | Locked IA: regime hero (banner + odds bar + read-through), KPI strip, 5 monitored signals, What's Priced seam, 4-chart in-place accordion — 100% real API data, zero fixtures |
| Placeholders | `web/src/screens/shell/TabPlaceholder.tsx` | Honest "not built tonight" cards listing each tab's planned sections |
| Screenshot tooling | `web/scripts/screenshot.mjs`, `shot-open.mjs` | Headless system-Chrome full-page capture (used for all evidence) |

**Dev environment (exact commands):**

```bash
# Terminal 1 — API (repo root; .venv has the deps)
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 — web client (proxies /api, /health, /series to :8000)
npm --prefix web run dev
```

Then: `http://localhost:5173/` (landing) · `/app/dashboard` (terminal) · `/kit` (component proof).
Typecheck: `npm --prefix web run typecheck`. Screenshots: `node web/scripts/screenshot.mjs <url> <out.png>`.

---

## Environment changes (machine-level, outside the repo)

1. **Node.js 26.5.0 installed via Homebrew** (`brew install node`). Node was absent from the
   machine entirely and everything in the brief requires it. This is the one system-level
   change of the night.
2. `puppeteer-core` added as a `web/` devDependency (drives the already-installed system
   Chrome for screenshots; downloads no browser).
3. `.claude/launch.json` gained a `web` dev-server entry (session tooling, untracked).

---

## Conservative choices at ambiguities (log, per ground rules)

1. **PRODUCT.md / DESIGN.md placed under `web/`, not repo root.** impeccable defaults to
   project root; the ground rule "new files only under `web/` and `docs/redesign/`" wins.
   If you later want them at root, `git mv` is trivial.
2. **No interview questions asked.** The brief supplied the init answers and directed no
   stalls; every inferred fact in PRODUCT.md is source-labeled.
3. **API port 8000** (brief) — CLAUDE.md documents 8787; nothing hardcodes the port beyond
   the Vite proxy target, and `VITE_API_BASE` overrides it.
4. **Vite dev proxy** instead of direct CORS fetches: keeps the client same-origin exactly
   as production will be (FastAPI serving the bundle). Added `/series` to the proxy for the
   unprefixed Atlas endpoints (Fed Funds / VIX latest values).
5. **"Bell-icon" alert trigger has no bell glyph.** The bundle's iconography law (no icons,
   no emoji; "if a concept needs an icon it needs a label") outranks the IA's word "bell" —
   the trigger is a labeled control: `● ALERTS N · 7D` when active, green
   `✓ all clear — last alert May 01, 2026` when silent. Full history in the drawer.
6. **Header badge shows the model's dominant stored probability** (46%), not `confidence`
   (27%) — the integrity-fixes convention ("one number, one truth"); the hero states both,
   labeled, and the odds-bar caption explains the difference.
7. **Live dot is honest.** It pulses only when `market_intraday_ts` is < 20 min old;
   otherwise it sits static-faint with a title explaining why. Pretending stale is live is
   the app's documented worst habit — the wordmark dot now cannot do it.
8. **Signal thresholds are a documented client-side mirror** (`signals-meta.ts`) of
   `src/config.py:36–41` + the exact `shared_styles.py` gauge formula (both zero-value
   branches included), because `/api/signals/latest` does not expose thresholds. Drift risk
   is flagged in-file; the real fix is server-side (open question #1).
9. **Signals missing at the snapshot date render as honest "awaiting the monthly print"
   cards** — `/api/signals/latest` filters to the max common date, so CPI/UNRATE signals
   (monthly cadence) drop out. No values were invented; each card still states its trigger.
10. **What's Priced teaser ships as a designed seam, not numbers.** The surprises /
    what's-priced computations have no API endpoint, and re-deriving quant logic
    client-side would violate one-number-one-truth. The section states exactly that and
    links to Markets.
11. **Hand-rolled SVG charts** (LineChart.tsx, in the Sparkline's idiom + zero-line +
    min/max/last mono labels) instead of adding Recharts/visx tonight. The handoff suggests
    a chart lib for interactive charts — that's an owner dependency decision (open question).
12. **Read-through prose is deterministically composed from stored numbers** and labeled
    "composed from stored data" — it is *not* badged ◆ CLAUDE, since no model wrote it.
    Attribution glyphs stay reserved for genuine model output.
13. **Recession chart caption does not equate the plotted tail with the headline call** —
    the API's stored series ends at 11.7% (Aug 31 row) while `recession_prob` reads 14.5%;
    both are shown as what they are (API wart logged below).
14. **Landing composition centered** (max-width 720 column) — the terminal's "nothing
    centered in a narrow column" rule is an app-surface rule; the landing is the brand lane
    and a left-locked column read as unbalanced at 1440.
15. **Favicon is the wordmark's blue dot** as an inline SVG data-URI (no logo drawn — the
    dot *is* the brand mark; browsers need something).
16. **Intraday timestamps labeled ET** — `market_intraday` rows end 15:55, the last 5-minute
    bar of the NYSE session, so ET is asserted; verify against the yfinance client if you
    ever see a 20:55 tail (UTC would indicate mislabeling).

## Disagreements with the bundle (built to the bundle; logged, not applied)

1. **`IntelBanner.d.ts` conviction vocabulary** is `High | Medium | Low`, but the readme's
   closed set lists `High / Medium / Moderate / Low`. Built to the `.d.ts` (the shippable
   contract); "Moderate" (30–45%) currently collapses into the Medium/Low split. If
   Moderate matters, the component contract needs an owner-approved extension.
2. **Tick-flash + gauge refill animations are not covered by `prefers-reduced-motion`** in
   the bundle's `motion.css` (it silences only pulse and caret). The handoff's reduced-motion
   line arguably covers all three motions; a targeted app-level override was added for the
   flash (see audit fixes) rather than editing the token file.
3. **`--text-faint` (#484f58) on `--bg-base` is ≈2:1 contrast** — used (per the bundle) for
   9–10px meta/axis text. WCAG AA for small text wants 4.5:1. Token-level, so not touched;
   flagged for the owner: an accessible alternative would move meta text one step up the
   ladder (#8b949e) at the cost of some of the terminal's recession into the dark.
4. **The ui_kit scrollbar radius (5px)** is off the token radius scale (3/4/6/8/20); the
   app uses `--r-sm` (4px) instead. Cosmetic, invisible at 10px thumb size.

## API warts found while wiring (all read-only observations; `api/` untouched)

1. `/api/signals/latest` returns only signals present at the max common date — the three
   monthly-cadence signals disappear between prints. Should return latest-per-signal, and
   should carry `threshold` + `direction` per signal (kills the client-side mirror).
2. `/api/recession/probability` mixes units: `yield_curve_spread` is **bps** (43.0) while
   `yield_curve_series` values are **percent** (0.43). One payload, two unit conventions —
   caught live when the KPI rendered "+4300 bps". Client now converts explicitly.
3. `recession_prob` (14.5, = the Jul row) ≠ the last stored `recession_prob_series` point
   (11.7, Aug 31) — a partial-month artifact surfaced verbatim; worth a server-side rule.
4. `data_as_of` is a month-end resample stamp ("2026-08-31") that reads as a future claim;
   rendered as "Aug 2026".
5. No endpoint exposes: What's Priced / Top Surprises, signal thresholds, regime-duration
   percentiles, credit percentile ranks (30y), or the playbook — all needed by later tabs.

---

## Critique + audit (one iteration, per the brief)

Method: **dual-agent critique** (isolated design-review subagent + isolated detector subagent),
synthesized here; snapshots persisted to `.impeccable/critique/` (first runs — no trend yet).
The brief's "answer from the brief, never stall" directive replaced the interactive
scope-question step; scope was pre-set to one fix iteration.

### Scores

| Surface | Heuristics | Band | Specificity verdict |
|---|---|---|---|
| Landing (Persuade; h5/h7/h10 n/a) | **23/28** (82%) | Good | "Authored, decisively — no template DNA; the live model read is the hero" |
| Dashboard (Operate) | **29/40** (72.5%) | Good | "Authored — composition maps 1:1 to the product's data model; nothing stock" |

Detector: 8 findings → **6 false positives** verified against the pinned system (3px rails ×3,
documented link-state colors ×2, Space Grotesk), **2 real** (width transitions inside the
verbatim bundle `GaugeBar`/`ProbabilityBar`). Narrow waivers registered in
`.impeccable/config.json` (Space Grotesk value; side-tab scoped to the three rail components;
one layout-transition FP in `app.css` where the *reduced-motion kill rule* string-matches the
pattern). Browser-overlay pass skipped: overnight headless session, nobody watching.

### Fixed in the single iteration

- **P0 — caption layer at 2.1:1 contrast**: all screen-authored captions + the signals legend
  moved from `--text-faint` to `--text-muted` (5.6:1, AA). True meta (timestamps, axis
  min/max) stays faint per the ladder's job spec.
- **P1 — dev-log voice on product surfaces**: "Start uvicorn on :8000", "Streamlit",
  "overnight report", "/api/surprises pending" all rewritten in desk voice (placeholders,
  What's Priced seam, error copy).
- **P1 — reduced-motion, fully kept**: app-level targeted rules now silence the inline
  pulses (SignalCard/StatTile/IntelBanner), the tick flash, and gauge/probability width
  refills under `prefers-reduced-motion` — no global animation kill.
- **P1 — landing offline fallback**: last good regime payload cached to localStorage and
  rendered with "Last stored read · macro data as of … · live feed unavailable" (dated
  beats empty).
- **P2 — IA order + visible chart**: Monitored signals moved above Key levels (locked IA
  order, matches the palette registry); the regime-odds panel now opens by default, so the
  flagship tab shows a real time-series on first paint (still an in-place accordion);
  LineChart gained quarter-mark x-date labels.
- **P2 — landing vocabulary + eyebrow**: all four regimes named in the explainer; the as-of
  eyebrow moved to the `--text-label` rung (5.9:1).
- **Minors**: palette entries to unbuilt tabs labeled "· planned"; focus restore on
  drawer/palette close; palette input focus ring restored; Jargon definitions now carried in
  `title` (screen readers + touch); drawer edge to hairline; "Model vs market" (↔ was outside
  the glyph set); Duration meta de-ambered; plural grammar; "odds sum to 100%" claim softened
  (independent rounding); CTA ≥44px; FRED glossed; og:/twitter: unfurl tags added.

### Logged for owner ratification (not applied — token/bundle-API level)

1. **Regime hue contradiction inside the bundle**: `--badge-overheating-*` is red-family
   while the regime ramp (`--regime-overheating`, bars, charts) is orange `#e67e22`;
   Stagflation likewise swaps red↔amber between badge and bar — visible 16px apart at both
   heroes. Proposal: point badge tokens at the regime ramp per the 12%/25% rule; decide
   Recession Risk's red-badge exception deliberately.
2. **IntelBanner's hardcoded pulse** claims "current" over monthly data; needs a `live` prop
   (bundle API change) gated on the same freshness check the wordmark dot uses.
3. **Width transitions in `GaugeBar`/`ProbabilityBar`** (the 2 real detector findings):
   `transform: scaleX()` would be jank-free; left verbatim for bundle fidelity.
4. `--text-faint` at ≈2.3:1 in bundle-internal labels (StatTile label, GaugeBar caption,
   TickerStrip label); `IntelBanner.d.ts` conviction set lacks "Moderate"; AlertRow's inert
   `borderLeft` first declaration (dead code, harmless).

### Deferred (post-review polish, intentionally not done in the one iteration)

Chart hover readout · jargon tooltip edge-flip near the right rail · focus traps ·
heading-hierarchy semantics (no h1–h6 yet) · palette's 35-entry unfiltered default ·
header target count (~11 in one band) · multi-open accordion · resting-Watch paradox (VIX
sits at 55% proximity when calm — the pinned server formula makes Watch the floor for VIX;
a recruiter-quant will ask) · curve-inversion's structurally binary gauge (0% until the day
it inverts; same pinned-formula question).

### Technical audit (5 dimensions, post-fix state)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | AA captions + focus restore + SR-reachable jargon now in; no heading hierarchy, no focus trap, bundle faint labels (owner) |
| 2 | Performance | 3 | ~103 KB fonts, sane polling, cheap SVG; 2 width transitions live in bundle components (reduced-motion users exempted) |
| 3 | Responsive Design | 1 | deliberately deferred — fixed 3/5-col grids will crush under ~900px; landing is accidentally near-mobile-safe |
| 4 | Theming | 4 | token layer verbatim; zero hard-coded colors in screen code |
| 5 | Implementation Integrity | 4 | detector-clean outside two bundle-internal findings; one-truth data discipline held under live fire (bps/% catch) |
| **Total** | | **15/20** | **Good** — dragged solely by the planned responsive deferral |

---

## Open questions for the owner, ranked by how much they block the next session

1. **Extend the API for the React client** (`api/` was frozen tonight): latest-per-signal
   `/api/signals/latest` with `threshold`/`direction`; `/api/surprises` (What's Priced +
   Top Surprises); playbook + regime-analytics endpoints for Regime Lab. Every one of these
   is a small read-only addition in `api/db.py`/`main.py`; without them, Markets and Regime
   Lab can only be seams.
2. **Approve or amend the provisional DESIGN.md** (`web/DESIGN.md`) — especially the three
   logged disagreements (Moderate conviction, reduced-motion scope, text-faint contrast).
3. **Chart library decision**: stay hand-rolled SVG (current, dependency-free) or adopt
   Recharts/visx per the handoff before Regime Lab's heavier charts (Gantt, transition
   matrix, backtest visuals).
4. **Mobile posture**: the terminal is desktop-first by design; the landing should probably
   respond first. Decide how far down the shell adapts (breakpoints are unbuilt tonight).
5. **Streamlit parity timing**: when the React Dashboard replaces the Streamlit one, the
   header-badge convention (dominant probability) should be back-ported or confirmed there.
6. **EODHD WebSocket**: subscription + go-ahead for the live ticker layer (seam is in
   `useMarketIntraday`, shape-compatible).

## Screenshots

Full-page at 1440px desktop width, taken after the fix iteration, all real data
(headless system Chrome via `web/scripts/screenshot.mjs`):

- [`screenshots/web/kit.png`](screenshots/web/kit.png) — all 17 components rendering with
  specimen fixtures (`/kit`)
- [`screenshots/web/landing.png`](screenshots/web/landing.png) — the landing at `/`
- [`screenshots/web/app-dashboard.png`](screenshots/web/app-dashboard.png) — `/app/dashboard`
  with the regime-odds chart open (its default state)

One earlier capture showed a full-width accent-blue band at the viewport bottom; it does not
reproduce in any final render or in the DOM — a transient capture artifact, not shipped chrome.

## Git verification

`git status --short` at session end:

```
 M CLAUDE.md              (pre-existing, API session — untouched tonight)
 M api/db.py              (pre-existing)
 M api/main.py            (pre-existing)
 M requirements-api.txt   (pre-existing)
 M tests/test_api.py      (pre-existing)
?? .claude/               (pre-existing dir; launch.json gained the "web" dev-server entry)
?? .impeccable/           (NEW — impeccable tooling: detector waiver config + critique snapshots)
?? api/recession_cache.py (pre-existing)
?? docs/redesign/         (pre-existing dir; this report + screenshots/web/ added)
?? proposals/             (pre-existing)
?? web/                   (NEW — everything built tonight)
```

No commits, no pushes, nothing staged. No file under `dashboard/`, `src/`, or `api/` was
modified tonight (the five `M` entries predate this session). The two dirs outside the
"web/ + docs/redesign/" rule are tooling: `.claude/launch.json` (dev-server registration for
the in-session preview) and `.impeccable/` (created by the brief's own Step-1 waiver
instruction and the critique-persist step; both untracked).

---

*Session executed by Claude (overnight, autonomous). All numbers rendered in the screenshots
are live reads from the local snapshot DB via the FastAPI service — nothing is fixture data
outside `/kit`.*
