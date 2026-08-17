# Day-1 Session Report — Rulings, Signals Truth, Markets v1 + Live Layer

Session: 2026-08-06, day (local only — **nothing committed, nothing pushed**).
Scope delivered: the three approved design rulings applied; `/api/signals/latest`
rebuilt with server-side truth + carry-forward and the client mirror deleted;
Markets v1 built end-to-end on a new EODHD WebSocket relay (token server-side)
with Lightweight Charts; one critique + audit pass on Markets; this report.

---

## Task 0 — Preflight

- Repo root `/Users/maxkomen/Projects/Macro/macro-regime-radar`, HEAD `8c0b466`
  ("Merge branch 'main' …"), branch `main`.
- `.env` contains `EODHD_API_TOKEN` (checked by name only) and **is gitignored**.
- Created **`.env.example`** at repo root with `FRED_API_KEY=` and
  `EODHD_API_TOKEN=` placeholders (values never committed anywhere).
- Both dev servers were still running from the overnight session (uvicorn :8000
  without `--reload`, Vite :5173). Both were **killed and restarted** so every
  verification below ran against live code, not a stale process.

**Run commands (exact):**

```bash
# Terminal 1 — API + stream relay (repo root; .venv has the deps)
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 — web client (proxies /api incl. the WebSocket, /health, /series)
npm --prefix web run dev
```

Then `http://localhost:5173/app/markets` (or `?chart=SPY`, `?chart=SPY&mode=intraday`
to deep-link an open chart panel). Typecheck: `npm --prefix web run typecheck`.
Tests: `.venv/bin/python -m pytest tests/test_api.py` and
`/opt/anaconda3/bin/python -m pytest tests/test_chat_sql_guard.py tests/test_dates.py`.
Stream ops counters: `http://127.0.0.1:8000/api/stream/debug`.

---

## Task 1 — The three approved rulings

**(a) One hue per regime, everywhere** — `web/src/styles/tokens/colors.css`.
The bundle's `_BADGE_MUTED_STYLES` keyed Overheating to red and Stagflation to
amber while the regime ramp 16px away said orange/red. Badge tokens now derive
from the ramp at the 12% fill / 25% border recipe:
Goldilocks `#2ecc71` · Overheating `#e67e22` · Stagflation `#e74c3c` ·
Recession Risk `#95a5a6`. Logged in-file as a **bundle correction**.
Text rungs were contrast-checked on their own tints (script-computed WCAG):
GL 6.7:1, OV 5.1:1, RR 5.5:1 pass as-is; **Stagflation's `#e74c3c` reads 4.0:1
as text**, so its `-fg` shifts to the existing red-on-dark token `#f08785`
(6.2:1) per DESIGN.md's documented "red as text" rule — no new color invented.
Verified live: the header badge (currently **Overheating 46%**) now renders
orange next to the orange OV segment of the probability bar, and the regime-odds
chart lines match both.

**(b) IntelBanner pulse is conditional** — `web/src/components/intel/IntelBanner.jsx`
gained a `live` prop (default `true` = legacy behavior; `.d.ts` + `.prompt.md`
updated). The dot pulses only when `live`; otherwise it sits static in
`--text-faint` with an explanatory `title`. DashboardScreen gates it exactly as
ruled: **pulse when the regime read is new since this browser's last visit**
(localStorage stamp `mrr-intel-seen` = `date|label`) **or under an age
threshold** (regime month ≤ 35 days old ≈ one monthly print cycle). With Jun
2026 data, a returning visitor now sees a static dot; a first visit or a new
print pulses.

**(c) Width transitions → `transform: scaleX()`** at the 420ms token
(`--dur-slow`), both flagged components:
- `GaugeBar`: fill is now full-width scaled by `scaleX(p/100)`, origin left —
  compositor-only refills.
- `ProbabilityBar`: a flex row can't scaleX per segment (transforms don't
  reflow neighbours), so each regime paints as a **full-width layer scaled to
  its cumulative share, stacked earliest-on-top**. The visible slice of each
  layer is exactly its own share, hover titles still hit the right regime
  (hit-testing follows transforms), and refills are compositor-only.
- `app.css` reduced-motion kill updated to match `transition: transform` on
  exactly these two components (verified: the only inline transform transitions
  in the app).

---

## Task 2 — Signals endpoint: server truth + carry-forward

**API (`api/db.py`, `api/main.py`, version 1.1.0 → 1.2.0):**
`/api/signals/latest` now returns, per signal: `value`, its **own as-of `date`**,
`threshold`, `direction`, `distance_pct` (0–100 threshold proximity, the exact
`shared_styles.py` gauge formula incl. both zero branches), and `status`
(closed vocabulary Clear/Watch/Triggered) — all server-side. The **carry-forward
rule** is `MAX(date) per signal_name`: a monthly signal keeps reporting its
last print between releases; a signal with any history never comes back empty
(this also implements DESIGN.md's "fall back to latest-available data with its
date" law). The unprefixed `/signals/latest` keeps the frozen max-common-date
Atlas contract untouched.

**One deliberate semantics fix (logged, deviation from the bundle's derived
rule):** the stored `triggered` flag owns "Triggered". Under the old
fill-derived client rule (≥75% ⇒ "Triggered"), **CPI at 3.73% vs its 4.00%
threshold (93% proximity, `triggered=0`) would have rendered a false red
"Triggered" the moment carry-forward brought it back on screen**. Server status
is now: Triggered iff the flag says so; else Watch at ≥50% proximity, else
Clear. The Dashboard legend states the new bands ("Clear <50% · Watch ≥50% ·
Triggered = threshold crossed") and `SignalCard` gained an optional `status`
override prop (default keeps legacy derivation — contract extension logged for
ratification below).

**Threshold-drift alarm instead of a mirror:** `api/` still never imports
`src.config` (FRED-key requirement), so the thresholds live as
`api/db.SIGNAL_DEFS` — but
`tests/test_api.py::test_signal_defs_match_src_config` **AST-parses
`src/config.py`** and fails the suite if the constants drift. The client-side
mirror (`web/src/screens/dashboard/signals-meta.ts` thresholds + `fillPct`) is
**deleted**; the file now carries presentation metadata only, and trigger prose
takes the server threshold as input so the sentences can't lie either.

**Dashboard cards:** all five render values + gauges. Carried-forward prints
state their month in the caption — "As of Jun 2026 · monthly print pending."
Verified live: Curve inversion 0.43% Clear · **Inflation pressure 3.73% YoY,
93% proximity, Watch** · Disinflation 3.73% Clear · VIX 16.50, 55%, Watch ·
Unemployment −0.10pp Clear. The read-through's "what would change the read"
sentence now composes from server thresholds, and its tail counts Watch states.

**New endpoints for Markets (same one-truth discipline):**
- `/api/priced` — the six What's-Priced metrics (FEDFUNDS/SOFR/T5YIE/T10YIE/
  DFII5/DFII10 `_latest` + `_mom_chg` from `derived_metrics`), grouped.
- `/api/surprises?top_n=` — top-|z| weekly surprises; the interpretation
  sentence is **imported from `src/utils/format.py::z_interpretation`** (a
  deliberately standalone module — dashboard, memo, and API now share one
  phrasing; no fork).

**Tests:** suite grew 16 → **21 passing** (carry-forward, server-side fields
incl. the triggered-owns-Triggered invariant, AST drift check, priced groups,
surprises ranking). Streamlit-side suites untouched and green (31 passing on
the anaconda interpreter). DB byte-untouched (read-only URIs throughout).

**Dashboard What's-Priced teaser** (locked-IA single home = Markets): the
endpoint-pending seam is replaced by a real 3-row teaser — **SOFR, 10Y
breakeven, 10Y real yield** + "→ See all in Markets" (SOFR represents policy
because Fed Funds already sits on the KPI strip 60px above — no number twice on
one tab).

---

## Task 3 — Markets v1 + the live layer

### Backend relay — `api/stream.py` (the token never reaches the browser)

One process-level QuoteHub started from the FastAPI lifespan:
- **Three upstream EODHD WebSocket clients** (`us`, `crypto`, `forex` feeds)
  subscribing the day-1 symbol set: 14 tape ETFs + 12 single names (us),
  BTC-USD/ETH-USD (crypto), EURUSD/USDJPY (forex). Tick fields `s/p/dc/dd/t`
  pass through — **dc/dd are EODHD's own day-change figures, never recomputed**.
  Forex frames carry ask/bid only; price is the midpoint (logged choice).
- **VIX** is an index (not streamable): 60-second delayed-quote REST poll
  (`VIX.INDX`), marked `delayed`.
- **REST seed sweep** (all 31 symbols, 15-min-delayed endpoint) at startup and
  every 5 minutes — the tape is fully populated off-hours and keeps moving
  (delayed) if a socket drops. A delayed REST row never clobbers a fresher
  socket tick.
- **Reconnect/backoff on both legs**: upstream exponential 1s→30s (+jitter),
  5-minute cadence after an auth rejection; browsers reconnect themselves with
  their own 1s→30s backoff (`web/src/live/quotes.ts`).
- Fanout over **`/api/stream/ws`** (FastAPI WebSocket): snapshot on connect,
  then tick batches coalesced at 250ms. `/api/stream/debug` exposes ops
  counters (frames/reconnects per feed, stored ticks, clients) — no secrets.
- No token → hub stays off, feeds report `off`, the client falls back to its
  DB poll. Token loading: env var, else repo-root `.env`; the value is never
  logged (exception text is redacted defensively).
- Deps: `websockets` added to `requirements-api.txt` (explicit; httpx already
  present). Vite proxy gained `ws: true`.

**Stream VERIFIED end-to-end with real ticks** (21:0x ET, US session closed —
crypto carried the proof exactly as planned): relay debug showed
`crypto: 193 frames / 8s, 221 ticks stored`, and a throwaway browser-side WS
probe received the snapshot plus **39 live BTC + 39 live ETH batches in 10s**
through the full EODHD → relay → client chain. In the rendered UI the BTC row's
as-of clock advanced (21:21:57 → 21:23:45 ET) between checks. One operational
gotcha (logged): running a second direct-to-EODHD probe on the same token while
the relay held its subscription silenced the relay's feed — EODHD appears to
honor one connection per feed per token; don't probe upstream while the relay
runs.

### Client live layer — `web/src/live/quotes.ts`

A module store (useSyncExternalStore hooks), deliberately **not** writes into
the TanStack Query cache: a 30s poll refetch would clobber fresher socket ticks
with staler DB rows, so the transports stay side by side and consumers prefer
the live quote when one is on the board. (The overnight seam comment in
`queries.ts` proposed the cache-write approach; comment updated with the
reasoning — deviation logged.) Store notifies subscribers at most **2×/sec**
(500ms coalescing; latest tick wins), exposes `useQuotes()`,
`useStreamStatus()`, and a primitive `useStreamLive()` so the app shell can
gate its dot without 2Hz re-renders. A 15s heartbeat lets time-derived
liveness decay when batches stop.

### Markets screen — `web/src/screens/markets/`

Locked-IA order, sections: `watchlist` (**Macro Tape**, 19 rows: 14 ETFs +
BTC/ETH + EURUSD/USDJPY + VIX) and **Single Names** (12 mega-cap/semis,
**sorted by day % move descending, re-sorting as ticks land**) as two visibly
separate tables; `sector-heatmap` (XLF/XLE/XLI/XLK from stored closes, ±1%/±2%
tint steps stated); `whats-priced-full` (all six metrics in three group cards +
a composed breakeven term-structure note); `top-surprises` (full 10 rows, z-bar
scaled to 3σ, ±1.5σ amber / ±2.5σ red stated in the caption).

Tape behavior: per-row **600ms directional flash** (previous price in a ref,
the TickerStrip pattern) painted at most 2×/sec; day % / day Δ$ straight from
dc/dd; 1W/1M + 30-day sparklines from stored candles (honest dashes where no
history exists — crypto/FX/VIX/singles); per-row as-of cell — live rows show a
green ● + ET clock, US rows off-hours show **"last market close"** (spec
wording), crypto/FX REST fills and VIX show **"15m delayed"**. The section
header carries a per-feed status line (`US connected · idle · CRYPTO ● live ·
FX connected · idle · VIX 15m delayed`) — "idle" deliberately claims nothing
about session state the relay can't verify. Off-hours the tape is never
static: crypto streams, the rest holds dated last-close rows.

**Chart panel** (`ChartPanel.tsx`, `lightweight-charts@5.2.0`): clicking any
row opens it — daily candles (365d) from `/api/market/daily`, an intraday
5-minute line where the DB stores it (SPY/QQQ; pipeline-stamped ET converted
to epoch via Intl so DST resolves correctly), fully token-themed (colors
resolved from CSS variables at mount: `--pos`/`--neg` candles, hairline grid,
mono axis, `--accent` crosshair). Symbols outside the stored 23-ETF universe
open an honest "no stored history — live quote only" panel instead of a fake
chart. `?chart=SYM` / `&mode=intraday` deep-link the panel (evidence + palette
jumps). The grid itself is bespoke screen code following DataTable's specimen
laws (9px uppercase headers, 8×12 cells, zebra 1.2% white) — row-level
click/flash/re-sort don't fit the DataTable component contract (logged
conservative choice; DataTable itself unchanged).

### Header ticker + shell wiring

`TickerLive` now prefers the stream quote for SPY/QQQ (EODHD's own day change;
`$price · 15m` marker when the quote is the delayed REST fill) and falls back
to the 30s DB poll when the stream is silent; US 10Y stays on the credit
endpoint. The wordmark dot pulses when **the stream is genuinely ticking**
(ws ticks < 60s old) or the DB intraday write is < 20 min old — title says
which. Markets registered `built: true` in `sections.ts` with its five palette
sections; Dashboard's teaser links to `#whats-priced-full`.

---

## Conservative choices at ambiguities (log, per ground rules)

1. **Recession Risk badge points at the ramp grey** — ruling (a) says "one hue
   per regime everywhere," and grey IS the app-wide RR color (probability bar,
   charts, `REGIME_COLORS`). The old red-badge exception is dropped; RR's alarm
   surface remains the recession-model KPI and alert levels. One-token flip if
   the owner wants the exception back.
2. **`status` owns Triggered via the DB flag** (Task 2 section above) — the
   fill-derived ≥75% rule would have shown a false "Triggered" on CPI today.
3. **Live store beside the query cache, not inside it** — clobber-safety
   (details in Task 3).
4. **Forex price = ask/bid midpoint** — EODHD forex frames carry no trade price.
5. **"connected · idle" feed wording** — the relay can't verify session state;
   "idle" is what it knows. US off-hours rows still say "last market close" per
   spec.
6. **Bespoke tape grid** instead of extending DataTable's contract mid-session.
7. **Sector ETFs stay off the stream** (not in the day-1 symbol list); the
   heatmap states "this block moves once a day."
8. **Teaser picks SOFR over Fed Funds** to avoid the same number twice on the
   Dashboard.
9. **EODHD single-connection behavior**: never probe upstream feeds directly
   while the relay runs (operational note from live debugging).
10. **`/api/stream/debug`** added beyond the letter of the spec — it was needed
    to diagnose the silent-feed incident and stays as an honest ops surface.

## Component-contract extensions logged for owner ratification

- `IntelBanner.live?: boolean` — **ruled** (b), applied.
- `SignalCard.status?: "Clear" | "Watch" | "Triggered"` — **not in the ruled
  list**; required by "status computed server-side … consume the new shape."
  Default preserves legacy behavior. Ratify or revert.
- `PRODUCT.md` staleness: its lines "Signal status is derived, not passed" and
  "EODHD is a later step — leave a seam, do not build it" are superseded by
  today's owner instructions. Not repaired (drift rule); flagging for the next
  `impeccable doctor`/init pass.

---

## Task 4 — Critique + audit pass on Markets

Method: **dual-agent** (isolated design-review subagent + isolated
detector/technical-audit subagent, synthesized here). Snapshot persisted to
`.impeccable/critique/2026-08-07T01-41-17Z__web-src-screens-markets-marketsscreen-tsx.md`
(first run for this slug — no trend yet). Browser-overlay step skipped (single
shared pane, autonomous run); headless captures served as rendered truth. The
interactive scope questions were pre-answered by the session brief (one fix
iteration, in-system only, token-level logged).

**Scores:** heuristics **27/40** (Operate; recognition-over-recall earned the
only 4 — "the redesign's win"); technical audit **11/20 pre-fix** (A11y 2,
Perf 2, Theming 3, Responsive 1, Integrity 3). Specificity verdict: *authored
for this product* — the provenance column, per-feed status furniture, and
composed desk-note captions have no template ancestor; Single Names was the
one category-generic module. Emotional peak: ticking crypto rows inside a
closed market. Detector: 1 finding (ChartPanel's 3px accent rail) — judged
consistent with DESIGN.md's pinned rail vocabulary, waived narrowly in
`.impeccable/config.json` beside the overnight session's identical waivers.

**Fixed in the single iteration** (P0 ×0 · P1 ×5 · the actionable P2/P3s):

- **Two "current" SPY prices** — the chart's red last-value badge (769.79) sat
  above the tape's $768.56; the exact sin the old Streamlit tab was condemned
  for. Both series now suppress the badge and price line — the tape row owns
  the current quote.
- **Invisible interaction** — clicking a Single-Names row mounted the panel
  ~1,400px away with no feedback. The panel now scrolls into view and takes
  focus; every row carries `aria-controls`; **Esc closes it**.
- **The honesty widget could lie forever** — after socket death the feed line
  kept saying CONNECTED. It now gates on the socket ("stream reconnecting — /
  stream offline · stored data only"), and one `LIVE_WINDOW_MS` (120s) drives
  every liveness judgment (dot, ● rows, feed line).
- **Freshness derived, never asserted** — AS OF cells print the actual quote
  stamp ("Aug 06, 16:29 ET · 15m") instead of a constant string. This exposed
  a factual error: the after-hours REST quotes were extended-session trades,
  so "last market close" was simply wrong. The critique's sharpest question
  ("why is any freshness string a constant?") became the fix.
- **Trader voice** — "US session closed" (NYSE wall-clock check; holidays
  approximated) / "FX quiet"; "EODHD dc/dd" vendor-speak removed from copy.
- **Performance** — `TapeRow` memoized (quote object identity is preserved for
  untick'd symbols, so only moved rows re-render at the 2Hz cap); chart data
  now flows through series refs (the 30s intraday poll no longer rebuilds the
  chart); **lightweight-charts is lazy-loaded** out of the first-paint bundle;
  no-history panels no longer poll the API with empty symbol lists (the two
  market hooks gained empty-list guards).
- **Theming/a11y** — heatmap tints `color-mix()` the `--pos`/`--neg` tokens
  (RGB literals gone); the DESIGN.md-mandated house focus ring now exists as a
  global `:focus-visible` rule (it was implemented nowhere); `aria-pressed` on
  chart toggles; sparklines `aria-hidden`; the tape scrolls horizontally under
  ~1000px instead of silently clipping the freshness column.
- **Numeric pedantry** (the brand is being pedantic): MoM deltas of
  percent-level series say **pp** on both tabs; σ colors key off the displayed
  rounded value (a "+1.5σ" row is amber even at raw 1.4501); "30 Sess" column
  header; the singles caption no longer calls COIN a mega-cap; explicit
  null-handling in the live sort.

**Logged for owner ratification / later passes** (not applied):

1. `--text-faint` at 2.0–2.3:1 on functional 9–10px text — token-level, now
   flagged by two independent assessments plus the overnight report.
2. Real table semantics + heading elements (SectionHeader renders a div) —
   component-contract surgery; SR users hear concatenated rows today.
3. ~~Tape group eyebrows~~ **RULED AND APPLIED post-critique**: the tape now
   renders eight labeled groups (Equities / Rates / Credit / Dollar & FX /
   Metals / Energy & Industrial / Crypto / Volatility) as 9px mono eyebrows
   with per-group zebra restart — the macro ordering is visible structure
   (screenshots refreshed). Still open from this cluster: sort/filter/pin/pause
   controls; chart affordance on the 17 no-history rows (earn the click or
   plot the live quote).
4. "CPI YoY runs at 3.46% YoY" double-YoY — lives in shared
   `src/utils/format.py::z_interpretation`; `src/` frozen this session.
5. Freshness-dialect unification (shell strip "· 15m" vs tape stamps) — one
   formatter for all surfaces is the finish; and the page's flat exit beat
   (peak-end) — it ends on a 10px source line.

---

## Screenshots (evidence, 1440px, real data)

- [`screenshots/web/markets-chart-open.png`](screenshots/web/markets-chart-open.png)
  — Markets with the SPY daily-candle panel open; live BTC/ETH rows with ET
  clocks; populated header ticker.
- [`screenshots/web/markets-chart-intraday.png`](screenshots/web/markets-chart-intraday.png)
  — the same panel in intraday (5-minute line) mode.
- [`screenshots/web/dashboard-day1.png`](screenshots/web/dashboard-day1.png)
  — fixed Dashboard: all five signal cards with values/gauges, carried-forward
  captions, orange Overheating badge matching the bar, real What's-Priced
  teaser, populated ticker.

## Updated open questions (carrying the overnight list forward)

1. **Ratify `SignalCard.status`** (and the RR-grey-badge call) — smallest items
   blocking a "constitution clean" state.
2. **Production posture for the stream**: the relay runs inside the API
   process; hosting choice (Fly/Railway/Render), process supervision, and
   whether the EODHD plan's connection limits fit a deployed always-on relay
   are owner decisions. Also decide idle-shutdown (stop upstream sockets when
   no browser is connected) — currently always-on while uvicorn runs.
3. **Chart library adopted**: `lightweight-charts` is now in `web/`
   (overnight open question #3 resolved in practice) — confirm it as the
   standard for Regime Lab's heavier charts or direct otherwise.
4. **Remaining endpoint gaps for later tabs** (unchanged from overnight):
   playbook + regime-analytics for Regime Lab; regime-duration percentiles;
   credit percentile ranks.
5. **Mobile posture** (unchanged): the tape's fixed grid will crush under
   ~1000px; responsive remains deliberately deferred.
6. **Streamlit parity**: the header-badge hue correction (ruling a) and the
   honest signal status now exist only in the React client; back-port or accept
   divergence until cutover.
7. **CLAUDE.md** is outside this session's edit scope — its API section
   (signals shape, new endpoints, stream module, requirements) needs the same
   updates recorded here.

## Found live during verification (fixed + regression-tested)

`/api/market/intraday` dropped every SAME-day row when `since` arrived in ISO
form: stored ts is naive `"YYYY-MM-DD HH:MM:SS"` and `" " < "T"`
lexicographically, so `2026-08-05T04:24:00Z` filtered out `2026-08-05 09:30:00`
— the intraday chart rendered empty. The overnight ticker never hit it because
its 48h window started the prior calendar day. Fixed by normalizing the param
server-side; `test_api_market_intraday_iso_since_same_day` pins it. (The
`since` value is still treated as ET-naive after normalization — the endpoint's
UTC param description vs the ET-naive column is a pre-existing wart, logged.)
Also: Lightweight Charts renders its axis in UTC, so intraday bars are fed ET
wall-time as-if-UTC (standard fixed-timezone practice) — the axis reads
09:30–15:55 ET like every other label.

## Git verification

`git status --short` at session end:

```
 M CLAUDE.md              (pre-existing from the API session — untouched today)
 M api/db.py              (signals carry-forward + defs, priced, surprises, intraday fix)
 M api/main.py            (v1.2.0: signals model, /api/priced, /api/surprises, stream WS + debug, lifespan)
 M requirements-api.txt   (websockets explicit)
 M tests/test_api.py      (16 → 22 tests)
?? .claude/               (pre-existing session tooling)
?? .env.example           (NEW — key names only, no values)
?? .impeccable/           (pre-existing; + ChartPanel waiver + critique snapshot)
?? api/recession_cache.py (pre-existing)
?? api/stream.py          (NEW — EODHD relay)
?? docs/redesign/         (pre-existing; this report + refreshed web screenshots)
?? proposals/             (pre-existing)
?? web/                   (overnight scaffold + today: rulings, signals client,
                           live layer, markets/, lazy chart, critique fixes)
```

**No commits, no pushes, nothing staged.** No file under `dashboard/` or
`src/` was modified (the five `M` entries are the same five from the overnight
report plus today's api/tests work). `data/macro_radar.db` byte-untouched
(read-only URIs throughout; the API service opens `mode=ro`).

**Post-critique addendum:** after the fix pass, the tape-group-eyebrows ruling
was applied (see the ratification list above) and the API test suite grew
further — **35 passing** at final check, alongside the 31 Streamlit-side
tests. Typecheck clean, stream healthy (all feeds open), and the Markets
screenshots in this report show the final grouped tape.

---

*Session executed by Claude (day session). Every number in the screenshots is a
live read from the local snapshot DB or the EODHD stream via the relay —
nothing is fixture data.*
