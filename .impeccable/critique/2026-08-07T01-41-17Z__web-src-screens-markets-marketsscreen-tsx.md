---
target: Markets tab (web/src/screens/markets)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
timestamp: 2026-08-07T01-41-17Z
slug: web-src-screens-markets-marketsscreen-tsx
---
Method: dual-agent (A: isolated design-review subagent · B: isolated detector+audit subagent)

# Combined critique + audit — Markets tab (day-1 build)

## Design Health Score (Assessment A, Operate surface, all 10 scored)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | Own action invisible: single-name click mounted the panel ~1,400px off-viewport (fixed: scroll+focus) |
| 2 | Match system / real world | 3 | "EODHD dc/dd" vendor-speak; "CONNECTED · IDLE" engineer-speak (both fixed) |
| 3 | User control & freedom | 2 | No Esc (fixed); no sort/pin/pause on 31 rows (logged) |
| 4 | Consistency & standards | 2 | Three freshness dialects + two "current" SPY prices (badge fixed, stamps derived); %-vs-pp (fixed); 60s/120s windows (unified) |
| 5 | Error prevention | 3 | 17 of 31 rows dead-end in "no stored history" (logged as affordance question) |
| 6 | Recognition over recall | 4 | The redesign's win — every number labeled, thresholds printed where used |
| 7 | Flexibility & efficiency | 2 | Deep links + ⌘K good; no sort/filter, 31 tab stops (logged) |
| 8 | Aesthetic & minimalist (density waived) | 3 | 26 identical constant freshness strings (fixed via derived stamps); unchunked 19-row tape (logged) |
| 9 | Error recognition & recovery | 2 | Feed line could claim CONNECTED forever after socket death (fixed: socket-state gate + reconnecting state) |
| 10 | Help & documentation | 3 | Captions teach every module; SOFR/EODHD unglossed (EODHD removed; SOFR logged) |
| **Total** | | **27/40** | **Acceptable→Good** — weaknesses were concentrated in the signature discipline (freshness honesty), all P1s now fixed |

**Design-specificity verdict (A):** *authored for this product* — provenance column,
per-feed status furniture, dual-coded rows, desk-note captions composing live numbers;
one generic module (Single Names) rescued by its caption. **Emotional peak:** ticking
crypto rows inside a closed market — the "terminal that is awake" proven above the fold.

**Detector (B):** 1 finding — `side-tab` on ChartPanel's 3px accent rail; judged
consistent with DESIGN.md's pinned rail vocabulary and waived narrowly in
`.impeccable/config.json` (same pattern as IntelBanner/ReadThrough/AlertRow). Noted:
the identical selected-row rail in MarketsScreen evades the detector via a ternary.
Browser-overlay step skipped (single shared pane, autonomous run) — headless captures
used as rendered-truth evidence.

**Technical audit (B):** A11y 2/4 · Perf 2/4 · Theming 3/4 · Responsive 1/4 ·
Integrity 3/4 = **11/20 before fixes**. P0 ×0 · P1 ×2 · P2 ×8 · P3 ×10.

## Fixed in the single iteration (both assessments woven)

- **P1 two current prices** — candle/line series no longer render a last-value badge
  or price line; the tape row owns the current quote (the old Streamlit tab was
  condemned for exactly this).
- **P1 invisible open** — ChartPanel scrolls into view and takes focus on open;
  `aria-controls` links every row to the panel id; Esc closes it.
- **P1 honesty widget lying after socket death** — FeedStatusLine now gates on
  socket state ("stream reconnecting — / stream offline · stored data only");
  one shared LIVE_WINDOW_MS (120s) for every liveness judgment.
- **P1 responsive clipping** — the fixed-track tape scrolls horizontally under
  ~1000px instead of silently clipping the freshness column (full responsive
  remains deliberately deferred).
- **P2 derived freshness** — AS OF cells print the actual quote timestamp
  ("Aug 06, 16:29 ET · 15m") instead of a constant string; this exposed that
  after-hours REST quotes were NOT "last market close" — the constant was wrong.
- **P2 trader voice** — "US session closed" (NYSE wall-clock check) / "FX quiet";
  "EODHD dc/dd" removed from user-facing copy.
- **P2 performance** — TapeRow memoized (only moved rows re-render at the 2Hz cap);
  chart data applied via series refs (no more full rebuild on every 30s poll);
  lightweight-charts lazy-loaded out of the main bundle; no-history panels no
  longer poll the API with empty symbol lists (hooks gained empty-list guards).
- **P2 theming** — heatmap tints now color-mix() the --pos/--neg tokens instead of
  hard-coded RGB triplets.
- **P2/P3 a11y** — global house focus ring (:focus-visible, DESIGN.md law that was
  implemented nowhere); aria-pressed on mode toggles; aria-hidden sparklines;
  region role + label on the chart panel.
- **P3 pedantry cluster** — MoM deltas say pp (both tabs); σ color keys off the
  displayed rounded value; "30 Sess" header; singles caption no longer calls COIN
  a mega-cap; explicit null-handling in the singles sort.

## Logged, not applied (token/contract/scope level — owner ratification)

1. `--text-faint` (#484f58) at 2.0–2.3:1 on functional 9–10px text (column headers,
   as-of cells, source line) — pinned by DESIGN.md's text ladder; the standing
   owner flag from the overnight report, now with two independent confirmations.
2. Full table semantics (role=table/row/columnheader) and SectionHeader heading
   elements — component-contract surgery; SR users currently get concatenated rows.
3. Tape group eyebrows (equities/duration/credit/commodities/crypto/FX) — ~48px of
   density budget to make the tape's macro narrative visible (A's question #3).
4. Sort/filter/pin/pause on the tape; chart affordance on no-history rows
   (17 of 31 rows dead-end — earn the affordance or plot the live quote?).
5. "CPI YoY runs at 3.46% YoY" double-YoY — lives in the shared
   `src/utils/format.py::z_interpretation`; src/ frozen this session.
6. Freshness-dialect unification across shell strip ("· 15m") vs tape stamps —
   partially done; a single formatter for all three surfaces is the finish.
7. NYSE-hours check ignores market holidays (shows "awaiting trades" on a closed
   holiday) — acceptable approximation, noted.
8. Exit beat: the page ends on a 10px source-attribution line — a flat ending for
   the daily user (peak-end); candidates: promote Top Surprises or add a dated
   "next print" line.
