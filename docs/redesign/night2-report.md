# Night-2 Report — Five Tabs, Ratifications, API Round 2

Session: 2026-08-06 → 07, overnight (local only — **nothing committed, nothing pushed**).
Scope delivered: the three ratifications + carried fixes applied (contrast sweep,
double-YoY, tape eyebrows); the API extended with 14 endpoints for the new tabs;
**all seven tabs now render real data** — Regime Lab, Credit, Recession, News &
Calendar, and Tools (LBO · Allocation) built tonight, plus a real Methodology
reference page (the last "coming build" placeholder is gone); one critique + audit
pass per tab with one fix iteration; this report.

---

## Task 0 — Preflight

- Repo root `/Users/maxkomen/Projects/Macro/macro-regime-radar`, HEAD `8c0b466`, branch `main`.
- The day session's dev servers were still holding :8000/:5173 — both killed and
  restarted so every verification ran against tonight's code (uvicorn runs without
  `--reload`; the API restart also picks up `api/` edits).
- DB byte-untouched: every new read path uses the read-only URI or the
  already-accepted analytics-module pattern (see Task 1).

**Run commands (exact):**

```bash
# Terminal 1 — API + stream relay (repo root; .venv has the deps)
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 — web client
npm --prefix web run dev
```

Then `http://localhost:5173/app/regime-lab` (or `/credit`, `/recession`, `/news`,
`/tools#lbo`, `/tools#allocation`, `/app/methodology`).
Typecheck: `npm --prefix web run typecheck`.
Tests: `.venv/bin/python -m pytest tests/test_api.py` (36 = 35 fast + 1 allocation smoke)
and `/opt/anaconda3/bin/python -m pytest tests/test_chat_sql_guard.py tests/test_dates.py` (31).

**Environment change (logged):** `yfinance` installed into `.venv` and added to
`requirements-api.txt` — the allocation engine imports it at module level and
downloads return histories on a cold call. No other machine-level changes.

---

## Task 0 — Ratifications + carried fixes

**(a) `SignalCard.status` ratified** — DESIGN.md's SignalCard entry now documents
the server-status contract as canon (stored triggered flag owns "Triggered";
fill-derived only as legacy fallback). No code change needed — the prop shipped
day-1; the constitution now blesses it.

**(b) Recession Risk badge grey ratified** — dropped from the open-questions list;
already implemented day-1 (ramp grey everywhere).

**(c) Contrast ruling swept app-wide.** Functional text — as-of stamps, freshness
cells, axis values, column headers, palette hints, error/empty states, source
lines, status words, placeholder text, the jargon dotted underline — moved
`--text-faint` → `--text-muted` across every screen. Following day-1's
badge-token precedent, the ruling was also applied inside bundle components where
the text is functional (**bundle corrections, logged**): DataTable column
headers, StatTile label, GaugeBar caption, TickerStrip label + flat-change value,
SignalCard "Last alert" stamp, AlertRow date, NewsCard meta row + low-sig score
color, SectionHeader `right` slot. Kept faint (decorative per the ruling): null
"—" dashes, disclosure glyphs ▸▾, row-index numbers, dot backgrounds,
ProbabilityBar zero-entries (documented "drop to faint" behavior), disabled
control states, and the dev-only `/kit` proof route. DESIGN.md's text-ladder
paragraph now records the ruled job split.

**(d) Double-YoY fixed at the source** — `src/utils/format.py::z_interpretation`
(the one permitted `src/` edit): a label like "CPI YoY" plus the "% YoY" unit
said YoY twice; the unit now owns the suffix → "CPI runs at 3.73% YoY — a 1.4σ
high reading vs its recent range". One shared implementation continues to serve
dashboard, memo, and API; `test_z_interpretation_no_double_yoy` pins it. Both
suites green (the fix is live in tonight's takeaway narrative and surprise rows).

**(e) Macro Tape category eyebrows** — the tape is now one table with eight 9px
uppercase mono eyebrow rows in the ruled order: EQUITIES (SPY QQQ IWM EEM EFA) ·
RATES (TLT IEF) · CREDIT (HYG LQD) · DOLLAR & FX (UUP EURUSD USDJPY) · METALS
(GLD SLV) · ENERGY & INDUSTRIAL (USO CPER) · CRYPTO (BTC-USD ETH-USD) ·
VOLATILITY (VIX). Eyebrows sit at `--text-label` with +1.5px tracking on a
hairline rule; zebra striping restarts per group; row markup, flash, sort, and
the live layer are untouched; Single Names unchanged. Row order inside the tape
changed to match the grouping (was: rates/credit interleaved differently) —
that's the point of the ruling.

---

## Task 1 — API extensions (v1.2.0 → 1.3.0)

Fourteen endpoints, all mirroring the established patterns (read-only queries in
`api/db.py`, schema-faithful Pydantic in `api/main.py`, `_guarded()`, lazy
imports). Where computation lives in `src/analytics/`, the recession-cache
precedent was followed — TTL-cached wrappers in the new **`api/analytics_cache.py`**,
nothing ported:

| Endpoint | Source of truth | Cache |
|---|---|---|
| GET `/api/regime/intelligence` | `intelligence.generate_market_takeaway` fed exactly as the Streamlit tab feeds it (stored probs, credit metrics, recession-model prob) | 15 min |
| GET `/api/regime/playbooks` | `intelligence.get_regime_playbook` ×4 (static reference) | static |
| GET `/api/regime/duration` | `intelligence.get_regime_duration` | 15 min |
| GET `/api/regime/transitions` | `intelligence.get_transition_narrative` | 15 min |
| GET `/api/regime/analogues` | `intelligence.find_historical_analogues` (live hy-pct + rec-prob inputs) | 15 min |
| GET `/api/regime/scenarios` | `intelligence.SCENARIOS` (static defs) | static |
| POST `/api/regime/scenario` | `intelligence.run_scenario` — key or custom shocks, bounded to the builder's slider ranges | none (fast) |
| GET `/api/credit/metrics` | `credit.get_credit_metrics` verbatim (bps, matrices, percentiles, series) | 60 min |
| POST `/api/recession/scenario` | the fitted model via `recession_cache` — the exact Streamlit sensitivity math (`yc_bps/100`, scaler, `predict_proba`) with slider-range validation | model TTL 15 min |
| GET `/api/lbo/defaults` | `lbo.get_lbo_defaults` | none (fast) |
| POST `/api/lbo/run` | `lbo.run_lbo_model` + the 5×5 sensitivity grid (25 full model runs server-side; `_round_to_half` centers, ≥3.0× floor) | none (pure compute) |
| GET `/api/allocation` | `allocation.get_allocation_data` — full payload jsonable-converted | 60 min + single-flight lock |
| GET `/api/news/latest` | latest-available fallback (mirror of `load_latest_news`) | — |
| GET `/api/calendar/recent` | most recent past events, newest first (calendar fallback) | — |

Details and deviations (logged):

- **CORS now allows POST** — every POST is pure computation over stored data;
  nothing writes.
- **`/api/allocation` returns a plain dict** (the one `/api` endpoint without a
  strict response model — leaf shapes are data-keyed asset×regime matrices;
  `api_stream_debug` set the precedent). Top-level keys are documented in
  `web/src/api/types.ts::AllocationData`.
- **riskfolio-lib is not installed** — Min CVaR and HERC fall back to equal
  weight inside `allocation.py` itself; the payload carries the fallback markers
  and the UI tags them. Installing riskfolio is an owner call (heavy dep chain).
- **Recession scenario ≠ headline reproduction, by design**: the headline scores
  3-month-lagged features (anti-look-ahead); the sliders score readings as-if-
  current. `test_api_recession_scenario_reproduces_baseline` pins the
  neighborhood (15pp tolerance — a bps-vs-% unit error saturates the logistic
  and blows far past it; observed structural gap ≈ 5pp).
- **Found + fixed live: news window lexicographic leak.** `news_feed.published_at`
  mixes `"…T08:17:15+00:00"` and `"… 02:08:34"` formats while
  `datetime('now')` yields the space form — `'T' > ' '` let same-day rows
  **older than the window** leak through (a "30h ago" row rendered inside the
  24H filter). Same family as day-1's intraday `since` fix; normalized
  server-side, pinned by `test_api_news_window_no_lexicographic_leak`. This wart
  exists in the Streamlit tab's identical query — back-port candidate.
- `api/recession_cache.py` gained the TTL-cached **model** (not just metrics) so
  scenario POSTs score against the same fitted artifact the headline uses.
- Tests 23 → **36** (13 new: intelligence shape + one-truth label checks,
  playbook structure, duration bands, transition-prob sanity, scenario
  stress-direction + 422 paths, credit one-truth vs `/api/credit/oas`, recession
  scenario neighborhood + validation, LBO defaults/IRR-vs-MOIC identity/grid
  centering/non-viable honesty/422, news fallback ordering, calendar recent,
  news window leak, allocation smoke incl. weights-sum and fallback flags).
  All green; the allocation smoke tolerates offline (skips on 502/503).

---

## Task 2 — The five tabs (what shipped, per tab)

### Regime Lab (`/app/regime-lab`) — [screenshot](screenshots/web/regimelab.png)

Locked-IA sections, all live: **takeaway** (narrative with parsed `<strong>`
emphasis — no `dangerouslySetInnerHTML` — conviction + Risk-On/Off tags,
divergence lines, "regime data as of Jun 2026"); **playbook** (4-regime
selector defaulting to the live regime, sector-tilt bars, asset performance,
risks/warnings/catalysts — labeled "static reference · not live data");
**cycle position** (spell length vs historical avg with the #23 sentence
verbatim-shaped: "Overheating has run 6 months — longer than 76% of past
Overheating spells, which average 4.2 months", risk-indicator percentiles with
their true windows stated); **transition outlook** (3M/6M empirical odds with
bars, the narratives, "a transition matrix, not a forecast model");
**historical analogues** (4 scored cards + the scoring recipe in the caption);
**scenario builder** (5 preset chips + custom shocks with 4 debounced sliders →
POST; result shows stored-vs-stressed ProbabilityBars, per-regime pp deltas,
positioning/sectors, and an honest "sketch of direction, not the classifier
rerun" caption; the source's emoji field is not rendered — glyph rules);
**regime-history Gantt** (bespoke SVG, 4 lanes × 361 monthly calls 1996→2026,
12%-fill/25%-border-family tints, per-segment hover dates, 5-year gridlines,
switches-in-last-12mo stat); **backtests** (regime/signal toggle, humanized
cohort names per #21, ▪ small-sample flags per #12, the 50%-coin-flip line per
#22) **+ factor attribution** (factor × regime annualized table from the
allocation engine — ETF-proxy factors, labeled as such).

### Credit (`/app/credit`) — [screenshot](screenshots/web/credit.png)

**OAS dashboard**: HY/IG hero cards (bps + MoM change with inverted
spread-coloring — widening red; StatTile's up-green grammar would lie, so the
cards are bespoke), 6-point sparklines, the #6 percentile caption with fixed
ordinals ("the 2nd percentile of history since 1996, tighter than 98% of it"),
and the 30-year HY-vs-IG chart with **NBER recession shading** (LineChart grew
an optional `bands` prop). **Quality ladder**: BB/B/CCC cards, HY/IG ratio
(#26 caption with the ~3.5× norm), distress ratio with the #8
paradox-resolving caption ("CCC at 1019 bps — 102% of the distress line — while
the broad market reads Normal at 273 bps: different rungs, not a
contradiction"), and both credit-state **transition matrices** (3M/6M) with a
composed stay/deteriorate sentence + small-sample footnote. **Financing
conditions** (sole owner): the all-in cost card with "→ Model a deal at this
rate in Tools · LBO", and the classification ladder with "← today". The
Streamlit tab's static regime-returns table was **cut** (unmeasured reference
content that duplicates the playbook's asset table — logged).

### Recession (`/app/recession`) — [screenshot](screenshots/web/recession.png)

**Probability model**: gauge arc on the **same 20/40 bands as the badge**
(confusion #5's two-truths widget is dead — band ticks drawn at 20 and 40),
2s10s card stating bps and percent together (#16), divergence card, and the
probability history with NBER shading derived from the stored USREC series.
**Curve monitor**: 30-year 2s10s chart (zero line + recession bands) and the
honest two-tenor curve panel with #15's sentence ("The store holds 2 tenors:
2Y at 4.20% and 10Y at 4.63% — a +43 bps upward slope. Not a broken chart —
daily FRED coverage stops at these two points."). **Sensitivity** (collapsed
by default per locked IA): five sliders seeded from the live inputs, 120ms
debounce → POST against the fitted model; verified live — HY at 1500 bps
drives 100.0% High Risk, +85.5pp vs the 14.5% headline; the panel explains the
lag-vs-current-inputs gap instead of hiding it. **Model transparency**:
coefficients sorted by |log-odds| with current readings and the #20 caption
("A one-σ rise in HY credit spread adds 2.58 to the log-odds of recession —
the model's strongest input"), the model card (280 training months, humanized
feature names, 3-month lag guard), and the #24 LEI-proxy explanation.

### News & Calendar (`/app/news`) — [screenshot](screenshots/web/news.png)

**Headlines**: five summary counters, category chips (ALL/MACRO/M&A/EARN/GEO/
SECTOR — category now filters server-side, mirroring the Streamlit loader),
24H/48H/7D window, significance filter (ANY/≥2.5/≥3.5), and the feed as
NewsCard components — "SIG 4.8 / 5" on the pipeline's own 1–5 ladder (the
`sigScale` contract extension, below), Claude regime reads and
Perplexity-cited sources behind the expandable, M&A deal-size buckets shown
only on M&A items (#17). **Latest-available fallback** (#2): any empty filter
combination — including an empty category inside a busy window — swaps to the
50 most recent stored headlines behind an amber notice stating the newest
stored date. **Macro calendar**: upcoming 30 days from `/api/calendar`; the
local snapshot's calendar ends Jun 18, 2026, so the fallback renders the most
recent 10 scheduled events behind its own amber notice (verified live — the
"stalled pipeline shows dated rows, never zeros" law, ported as behavior, not
code).

### Tools (`/app/tools`) — [LBO](screenshots/web/tools-lbo.png) · [Allocation](screenshots/web/tools-allocation.png)

Sub-tab bar in the URL hash (`#lbo` / `#allocation`) so palette jumps and
cross-tab links land correctly.

**LBO**: nine sliders (bounds = the Streamlit calculator's), the interest rate
seeded from the live all-in cost with a manual-mode note + "↻ back to live"
(financing provenance links to Credit — sole-owner discipline); returns banner
(19.1% IRR · 2.40× MOIC · +$473M with the #10 caption), annual debt schedule
(DataTable), and the **5×5 IRR sensitivity grid** — every cell a full server
model run, green ≥20% / blue ≥15% / orange below / "n/a" not-viable, current
cell outlined; non-viable deals render the honest error banner ("Leverage too
high — debt exceeds entry EV") instead of numbers. The closing caption turns
the calculator into a market lesson (financing-rate reality check).

**Allocation**: regime banner + **regime-conditional performance matrix**
(annualized mean + Sharpe per asset per regime, n-months footer, #14's Sharpe
sentence citing a real positive-return/negative-Sharpe cell from the live
table); **optimization** — seven method cards (expected return/vol/Sharpe +
method-family badges; riskfolio-dependent Min CVaR and HERC honestly tagged
"fallback"), the **efficient frontier** (bespoke SVG on the risk/return plane
with non-fallback method markers), and the weights-by-method matrix with
concentration tinting; **risk analysis paginated** behind eight chips —
Factors (regime-factor table + per-method OLS betas with R²/α), Style, Tail
risk (CVaR/VaR per asset + portfolio CVaR by method), Transition P&L (pairs
with n≥2), Currency, Real vs nominal (▪ eroded flags where inflation flips a
nominal gain), Correlation (regime-conditional 10×10 heat grid), Drawdowns
(by-regime + overall). Nothing exceeds ~2.5 viewports at a time. Cold-load
states say exactly what the engine is doing ("first load runs up to a
minute, then serves from a 1-hour cache").

### Methodology (`/app/methodology`, header link)

The last "coming build" placeholder in the app is gone: regime definitions,
**live signal thresholds read from `/api/signals/latest`** (the reference page
cannot drift from the server truth it documents), the closed meaning ramps
(gauge, recession bands, significance ladder, status vocabularies),
computed-vs-reference content split, and data provenance with cadences.

---

## Component-contract extensions (logged for ratification)

- **`NewsCard.sigScale?: 10 | 5`** (default 10 = legacy): the pipeline scores
  1–5, the bundle's color bands read 0–10 — a 3.8/5 "high impact" headline
  rendered muted. `sigScale=5` aligns the bands to the pipeline's own ladder
  (≥4.5 red / ≥3.5 hot / ≥2.5 amber) and renders "SIG 3.8 / 5" (#17). Same
  shape as the now-ratified `SignalCard.status` precedent; default preserves
  legacy behavior. Ratify or revert.
- **`LineChart.bands?: {from, to}[]`** — screen-code chart (not a bundle
  component); shaded x-intervals for NBER windows on Credit/Recession.

## Conservative choices at ambiguities (log, per ground rules)

1. **Contrast ruling applied inside bundle components** for functional text
   (day-1 badge-token precedent); decorative faint and the `/kit` route left
   untouched. Full list under Task 0(c).
2. **Credit's static regime-returns table cut** — unmeasured reference content;
   the playbook (labeled reference) already owns that story. One-truth over
   completeness.
3. **Calendar fallback over DB reload**: `events/calendar.csv` holds rows
   through Dec 2026 but loading it writes to the DB — read-only session, so the
   tab ships the latest-available fallback instead and the report flags the
   reload (`python -m src.events.load_events`) as the operational fix.
4. **Scenario emoji not rendered** — the source dict carries emoji; the
   terminal's glyph vocabulary excludes them. API stays source-faithful, the
   client drops them.
5. **Scenario slider steps coarsened** (HY 10bps, 10Y 5bps vs Streamlit's 1) —
   fewer debounced POSTs, same expressive range; bounds identical.
6. **`/api/allocation` as a documented plain dict** (see Task 1).
7. **Factor attribution sourced from the allocation engine** (`regime_factors` +
   `portfolio_factors`) rather than porting the Streamlit tab's
   pyfolio/rolling-beta charts — those fail locally even in Streamlit
   (`pyfolio` absent) and duplicate quant logic client-side. The ETF-proxy
   basis is stated in every factor caption.
8. **Recession scenario tolerance at 15pp** — the observed ~5pp structural gap
   is the 3-month feature lag, not a bug; the tolerance still catches unit
   errors (which saturate to ~100pp). Explained in the UI caption too.
9. **HRP "converged" absence**: the source omits the flag on success paths, so
   the client treats only explicit `converged: false` (or a "(fallback)" method
   name) as fallback — HRP's success dict never carries the key. Source wart
   flagged below.
10. **Tools sub-tab in the hash** rather than nested routes — palette
    deep-links work without a router change.

## API warts found (read-only observations, not fixed in src/)

1. `allocation.get_allocation_data`'s HRP fallback dict omits `converged: False`
   (BL/CVaR/HERC fallbacks set it) — fallback detection needs the method-name
   sniff. One-line fix in `src/analytics/allocation.py` when it reopens.
2. The Streamlit events tab has the same `published_at` lexicographic window
   leak fixed tonight in `/api/news` — back-port candidate.
3. `intelligence.run_scenario(current_values=…)` parameter is dead code.
4. `event_calendar` in the DB snapshot lags `events/calendar.csv` by ~6 months
   (needs `python -m src.events.load_events` after the next release download).

---

## Updated open questions (day-1 list carried forward)

1. **Production posture for the stream** (day-1 #2, unchanged): relay-in-process
   hosting, supervision, EODHD connection limits, idle-shutdown — owner decisions.
2. **Mobile posture** (day-1 #5, unchanged): responsive remains deliberately
   deferred. Night-2 note: wide tables scroll inside their own containers
   (`overflowX: auto` on the tape, allocation matrices, backtests) rather than
   clipping, but the fixed grids still crush under ~1000px by design.
3. **Streamlit parity** (day-1 #6, grown): the React side now carries the badge
   hue, honest signal status, the fixed news window (the Streamlit events tab
   still has the lexicographic leak), 20/40-band recession gauge, ordinal fixes,
   and the calendar fallback. Back-port or accept divergence until cutover.
4. **CLAUDE.md** (day-1 #7, unchanged): out of scope again tonight — its API
   section needs v1.3.0 (14 new endpoints, `api/analytics_cache.py`,
   `yfinance` in requirements-api.txt, POST in CORS), and the React-migration
   section should record that steps 2–4 (tabs) are built pending review.
5. **Ratify `NewsCard.sigScale`** (new) — the one component-contract extension
   added tonight; default preserves legacy.
6. **riskfolio-lib** (new): install it in `.venv` (+ requirements-api.txt) to
   light up real Min CVaR / HERC, or accept the tagged equal-weight fallbacks.
7. **Calendar data operational fix** (new): after the next `data-latest`
   download, run `python -m src.events.load_events` so the upcoming window has
   the Dec-2026 rows; the fallback covers until then.
8. **Day-1 open #1 (ratify `SignalCard.status` + RR grey) — closed tonight** by
   the owner's ratifications. Day-1 #3 (chart library) was already resolved in
   practice; Lightweight Charts remains the standard (Regime Lab's Gantt and
   frontier are bespoke SVG by design — non-time-series planes).

## Screenshots (evidence, 1440px, real data)

- [`screenshots/web/regimelab.png`](screenshots/web/regimelab.png) — Regime Lab, full page
- [`screenshots/web/regimelab-scenario.png`](screenshots/web/regimelab-scenario.png) —
  scenario builder with Credit Crisis selected (stored vs stressed odds, +51pp RR),
  the 30-year Gantt, backtests
- [`screenshots/web/credit.png`](screenshots/web/credit.png) — Credit with NBER-shaded
  OAS history, matrices, financing
- [`screenshots/web/recession.png`](screenshots/web/recession.png) — Recession (gauge on
  20/40 bands, curve monitor, transparency)
- [`screenshots/web/recession-sensitivity.png`](screenshots/web/recession-sensitivity.png) —
  sensitivity panel expanded, live adjusted probability
- [`screenshots/web/news.png`](screenshots/web/news.png) — News & Calendar (feed +
  calendar fallback with amber notice)
- [`screenshots/web/tools-lbo.png`](screenshots/web/tools-lbo.png) — LBO calculator with
  the 5×5 IRR grid
- [`screenshots/web/tools-allocation.png`](screenshots/web/tools-allocation.png) —
  Allocation (regime matrix, 7 methods, frontier)
- [`screenshots/web/methodology.png`](screenshots/web/methodology.png) — Methodology
  reference page (live thresholds)
- [`screenshots/web/markets-eyebrows.png`](screenshots/web/markets-eyebrows.png) — the
  tape with its eight category eyebrows
- [`screenshots/web/dashboard-night2.png`](screenshots/web/dashboard-night2.png) —
  Dashboard after the contrast sweep (regression evidence)

---

## Task 3 — Critique + audit pass (one per tab, batched dual-agent)

Method: day-1's dual-agent pattern — one isolated design critic (heuristics,
desk-note voice, confusion-index compliance, specificity, 1440 hierarchy) and
one isolated technical auditor (a11y, perf, responsive, theming, integrity)
over the five tabs + Methodology, source and rendered captures together.
Synthesis persisted to
`.impeccable/critique/2026-08-07T08-30-00Z__web-src-screens-night2-five-tabs.md`
(first run for this slug). One fix iteration applied; token/owner items logged,
not applied.

**Design scores (/40):** Regime Lab **30** · Credit **35** · Recession **29** ·
News & Calendar **25** · Tools **26**. Technical audit (pre-fix): A11y 2 ·
Perf 2 · Responsive 1 · Theming 2 · Integrity 2 — the P0/P1 drivers below are
now fixed; responsive remains a stated deferral.

**Reviewers' verdict highlights:** strongest moment — the financing chain
(Credit's all-in-cost card → Tools · LBO with the same 6.36% decomposed and a
"back to live" escape): "the whole thesis of the product working in four
seconds." Weakest — the news feed's cross-source duplicates under a header
claiming DEDUPED (fixed below). Credit verified numerically consistent across
every surface it touches (HY 273 bps = 2.73pp = the LBO input; Fed Funds 3.63%
= Allocation's risk-free; 2s10s +43 bps = 4.63 − 4.20 = Methodology's 0.43%);
"the 2th percentile is genuinely dead."

**Seven P0s found; six fixed, one logged:**

1. Allocation's style table shipped four blank column headers (a self-closing
   span) — fixed.
2. The server fabricated missing quant inputs (`or 0.0` recession probability
   into the takeaway, `or 50` HY percentile into the analogues) while the
   client captioned the results as measured — both now degrade to an honest
   503 instead of narrating fiction.
3. Recession showed two "current" probabilities 100px apart (gauge 14.5% vs
   the chart legend's series tail 12%) — the legend value is suppressed and
   the caption states what the tail is (a partial-month fit).
4. News rendered verbatim duplicate headlines under "DEDUPED" — the feed now
   collapses identical cross-source headlines client-side (the pipeline-level
   dedupe keys on URL; tightening it is the real fix, logged).
5. Fallback optimizer cards printed `SR 0.00` beside +10.5% return / 8.7% vol
   — an arithmetic impossibility with the risk-free in the header; they now
   print `SR —` with "equal weight — Sharpe not computed".
6. Regime Lab stated two different "average spell" lengths for the same
   regime (playbook literature 6.1mo vs measured 4.2mo) — now labeled
   literature vs measured, one owner per number.
7. **Logged (backend, owner):** `run_lbo_model` subtracts transaction fees
   from the equity check, so raising the fee slider *raises* IRR/MOIC — fees
   are a use of funds and should increase the check ($338M shown vs ~$362M;
   MOIC 2.40× vs ~2.24×). `src/` is frozen this session; the caption now
   prints the fee line so the arithmetic is at least visible, and the fix is
   flagged for the next `src/analytics/lbo.py` session.
   **→ Fixed in the owner-directed follow-up (2026-08-07, same day):**
   `entry_equity = entry_ev + fee_dollars − entry_debt` (sources cover uses);
   default deal now reads 17.5% IRR / 2.24× MOIC / $362M check, the React
   caption states the sources/uses arithmetic, `test_api_lbo_fee_direction`
   pins the direction (fees ↑ ⇒ check ↑, IRR/MOIC ↓), and
   `tools-lbo.png` was recaptured. The Streamlit tab renders model output
   directly and inherits the fix with no changes.

**The fix iteration** (fuller list in the snapshot): Credit — IG series was
silently stretched against HY (per-series index mapping); both now run on the
date intersection; NBER bands raised from an invisible ~2% RGB delta to a
visible tint; the client-side "deterioration %" derivation (ranking credit
states client-side) deleted; unconditional captions ("almost no default
stress", "near the norm") now branch on the data; the never-occurred Tight
state renders "—" rows, not measured-looking 0%s. Recession — 20/40 dashed
rules drawn on the probability chart; "since the mid-90s" corrected to the
series' real start; the unemployment coefficient's counter-intuitive negative
sign explained in the caption; the band legend fills the once-empty hero;
collapsed sensitivity now previews the five live inputs inline; POST results
keep previous data during refetch (no blanking mid-drag); the baseline peeks
the cache instead of retraining the model mid-drag; both recession caches got
locks; the scenario feature vector is built by name, never position. Regime
Lab — the 6M transition column gained its missing "stays" row (it summed to
60%); the Gantt's viewBox now matches its rendered width (chart chrome back to
9px); the scenario builder defaults to the first preset instead of an empty
card; ▪ fragility flags extend to 100%/0% hit rates (the Goldilocks 100%/17
case); the fourth-wall "resume reviewer" caption cut. News — the server-side
window leak fixed (`published_at` format mixing let 30h-old rows into the 24H
filter — same lexicographic family as day-1's intraday fix, pinned by a test);
`manual_csv` humanized; elapsed calendar events muted and labeled "· elapsed";
the capped headline counter marked "+"; zero categories render "—"; the sort
is stated in the header and switches honestly under fallback. Tools — the IRR
mid-band moved off the accent (One Accent Rule) to amber; the regime chip
wears the regime's own 12%/25% treatment; the weights matrix carries its unit
and canonical method names; the frontier grew real axis ticks and clip-proof
labels; the sensitivity outline uses the server's own center (Python rounds
halves to even — entry 8.25 outlined the wrong cell); EBITDA re-ranged
10–1000 so the working range is draggable; the empty 8th method cell became a
how-to-read legend; the factor × regime table is single-homed on Regime Lab.
Shell — the freshness line now adds "live tape ticking via stream" when true,
so it can't read stale beside ticking rows. Plus the audit's mechanical set:
keyed fragments, `aria-expanded` on NewsCard, guards on the allocation
payload's optional members, `contextlib.closing` on every API connection,
float score fields (SQLite REAL tolerance), sensitivity ranges capped at the
slider bounds, negative-result backoff in the TTL cache, memo hygiene.

**Found live during the fix pass:** one of the audit-driven memo changes
itself introduced a hooks-order crash (a `useMemo` placed after the loading
early-return — "Rendered more hooks than during the previous render", caught
on the live Tools tab). Reverted to a plain derivation with a comment naming
the trap; the allocation screenshot was recaptured after the fix and the tab
re-verified end-to-end (all eight risk lenses render, no error overlay).

**Logged for owner / later passes (not applied):**

1. ~~The LBO fee-direction convention (P0 #7)~~ — fixed same-day on the
   owner's direction; see the annotated item above.
2. **Cross-pipeline number drift:** CPI prints 3.46% YoY on Markets (derived
   weekly pipeline) and 3.73% on Methodology/Dashboard (signals table); VIX
   15.15 vs 16.50 (daily close vs monthly signal snapshot). Two pipelines, one
   metric, no reconciling label — the same disease as confusion #4, needs a
   source-level decision. Related: surprise stamps date "week ending" into the
   future (Friday-stamp convention).
3. Server-provided display colors the client now overrides with tokens
   (recession band hex, divergence green-on-negative, analogue similarity
   ramp, conviction accent) — unify the palettes in the source modules.
4. `allocation.py`'s HRP fallback omits `converged: False` (client sniffs the
   method name); `run_scenario`'s dead `current_values` parameter.
5. Token gaps: regime hex maps triplicated client-side; ~25 improvised rgba
   tint opacities; `#a78bfa` (research-on-dark) has no token; `--warn-hot`
   doubles as the Overheating regime color on screens where both appear.
6. Table semantics for the flat span-grids (row-structured grids are easy;
   the flat matrices need display-contents row wrappers) — carried from
   day-1's deferred list.
7. Responsive below ~1000px — still a stated deferral; the widest grids now
   scroll with min-widths instead of crushing.
8. LineChart x-labels are index-sampled quarters, not decade-anchored.
9. `_classify_prob` imported across the private boundary (src frozen).

---

## Git verification

`git status --short` at session end:

```
 M CLAUDE.md              (pre-existing from the API session — untouched tonight)
 M api/db.py              (news window fix, fallback queries, closing())
 M api/main.py            (v1.3.0: 14 endpoints, POST CORS, models, sensitivity centers)
 M requirements-api.txt   (yfinance)
 M src/utils/format.py    (the one permitted src/ edit — double-YoY fix, +4/−1 lines)
 M tests/test_api.py      (23 → 36 tests)
?? .claude/               (pre-existing session tooling)
?? .env.example           (pre-existing, day-1)
?? .impeccable/           (pre-existing; + tonight's critique snapshot)
?? api/analytics_cache.py (NEW — TTL wrappers, recession-cache precedent)
?? api/recession_cache.py (pre-existing day-0; + model cache, locks, peek)
?? api/stream.py          (pre-existing, day-1)
?? docs/redesign/         (pre-existing; this report + refreshed screenshots)
?? proposals/             (pre-existing)
?? web/                   (scaffold + tonight: five screens, Methodology, shared
                           furniture, eyebrows, sweep, critique fixes)
```

**No commits, no pushes, nothing staged.** No file under `dashboard/` was
touched; the only `src/` change is `src/utils/format.py` (+4/−1), exactly the
permitted edit. `data/macro_radar.db` byte-untouched — every new read path is
`mode=ro`, and the analytics-module WAL connections are the same accepted
pattern the Streamlit app has always used.

**Definition of done, checked:** all seven tabs render real data and the
Methodology reference page is real (zero "coming build" placeholders anywhere —
`TabPlaceholder.tsx` is deleted); tape eyebrows live; ratifications (a)–(e)
applied; contrast sweep done; suites green — **36** (`tests/test_api.py`,
.venv) + **31** (chat-guard + dates, anaconda) + `tsc` + `vite build` clean;
this report + 17 screenshots exist.

---

*Session executed by Claude (night-2, autonomous). Every number in the
screenshots is a live read from the local snapshot DB, the EODHD relay, or the
allocation engine's vendor download — nothing is fixture data.*
