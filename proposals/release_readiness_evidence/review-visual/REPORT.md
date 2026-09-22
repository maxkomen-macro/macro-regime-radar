<!-- Independent visual/UX review, 2026-09-06. Written to disk by the orchestrator verbatim from the reviewer's final message (the reviewer's harness could not write .md files). -->

The report file could not be written — my harness blocks subagents from writing report/summary `.md` files, so it's returned in full below for you to save to `proposals/release_readiness_evidence/review-visual/REPORT.md`. The evidence directory itself was created and is populated with all the screenshots referenced. The temp script `web/scripts/_review.tmp.mjs` has been deleted; nothing else in the repo was touched.

---

# Independent visual / UX review — Macro Regime Radar React client

Reviewer: independent, no automated detector run. Judged from my own headless Chrome captures (puppeteer-core, system Chrome, headless "shell") plus the accessibility tree and DOM measurement, against `web/DESIGN.md` and `web/PRODUCT.md`.

**Session:** 2026-09-06, ~00:05–00:55 EDT. Vite `http://localhost:5173`, FastAPI `http://127.0.0.1:8000`.
**Viewports:** 390×844, 768×1024, 1440×900, 2160×1080.
**Routes:** landing, dashboard, regime-lab, markets, credit, recession, news, tools#lbo, tools#allocation, methodology.
**Evidence:** `proposals/release_readiness_evidence/review-visual/` — `rv-*.png` (full-page sweeps), `mk-*` (markets), `repro*` (crash repros), `hdr-*` (headers), `offline-*` (degraded states), `crop*`/`zoom*` (readable slices), `rv-report.json` (per-route overflow + hit-target measurements).

## Two caveats that bound this review

1. **The tree was being edited underneath me.** `web/src/App.tsx`, `web/src/styles/app.css`, `web/src/api/snapshot-manifest.json`, all of `api/`, and all three Markets chart files (`CandleChart.tsx`, `SingleName.tsx`, `ChartPanel.tsx`) changed mid-session; `web/scripts/_shoot-all.tmp.mjs` disappeared. Findings are against the tree as of ~00:38–00:50 EDT; I re-read the source for the P0 at 00:50 and it was still unfixed.
2. **The FastAPI service wedged twice under ordinary page-load bursts** — two `uvicorn` processes bound to :8000, every request hanging with no response, no recovery in 6+ minutes of polling. It also emitted bursts of 429 (`RATE_LIMIT_PER_CLIENT_PER_MIN` default 600) and 500s. Several intermediate captures are outage artifacts (`rv-tools-*-2160.png`, `rv-tools-allocation-390.png` at viewport height, the first `rv-credit-1440.png`). **I re-verified every finding below against a healthy run or a deliberate, reproducible simulation** (request interception returning `connectionrefused`, or an injected delay). Nothing here rests on an accidental outage. Separate concern for whoever owns the API: a local dev server that dies under ten page loads will die on a free host.

---

# Findings

## P0

### P0-1 · Switching chart range crashes the whole Markets tab

**Route/viewport:** `/app/markets`, reproduced at 1440×900; the code path is width-independent.

**What I saw.** With AMZN open in Single-name research, clicking `1M` (hourly bars) then `1Y` throws inside the chart and the *entire Markets tab* is replaced by "This tab hit a rendering error and could not paint. The rest of the terminal is unaffected; switching tabs re-mounts it."

Console: `Error: Assertion failed: data must be asc ordered by time, index=1, time=1785888000, prev time=1785888000` at `CandleChart`. `1785888000` is `2026-08-05T00:00:00Z` — exactly the first day of the 1M hourly window. Confirmed paths:

| Surface | Sequence | Result |
|---|---|---|
| Single-name (AMZN) | 1M → 1Y | **crash** |
| Single-name (AMZN) | 1D → 5Y | **crash** (`time=1788480000` = 2026-09-04) |
| Macro tape (VIX row) | 1M → 1Y | **crash** |
| Single-name | 1M → 6M | no crash (6M is default, cached) |
| Single-name | 6M → 1D, 5D → 6M | no crash |

Trigger: current range ∈ {1D, 5D, 1M} **and** target ∈ {6M, 1Y, 5Y, MAX} **and** the target isn't yet cached. Since 6M is the default and always cached, the live traps are the first click on 1Y, 5Y or MAX after any intraday range — an obvious thing for a visitor to do.

**Why it matters.** The range chips are the headline affordance of the "any listed symbol" feature. A recruiter clicking `1Y` loses the whole screen. `PRODUCT.md` names this audience first and calls polish failures "fatal here". Recovery requires navigating away and back.

**Root cause (verified in source).** `CandleChart` picks its time encoding from the `range` **prop** while `bars` still hold the **previous** range's payload during the fetch:

- `web/src/screens/markets/CandleChart.tsx:18,31,86-87`
  ```ts
  const INTRADAY_RANGES = new Set(["1D", "5D", "1M"]);
  const intraday = INTRADAY_RANGES.has(range);
  const toTime = (ts) => intraday ? (Date.parse(ts) / 1000) : (ts.slice(0, 10));
  ```
- `web/src/screens/markets/SingleName.tsx:273` — `<CandleChart bars={candles.data.bars} range={range} />`
- `web/src/screens/markets/ChartPanel.tsx:357` — `<CandleChart bars={q.data.bars} range={range} />`

Both callers *already know* the two disagree — the very next line renders `{candles.isFetching && candles.data.range !== range ? "Requesting {range} bars…" : null}`. When `range` flips to daily-or-coarser first, every hourly/5-minute bar collapses to the same `"YYYY-MM-DD"` key, lightweight-charts asserts, and the ErrorBoundary eats the tab. **The API payload is clean** — I checked all seven ranges for AMZN: 0 duplicates, 0 non-ascending, correct intervals (1D/5D=5m, 1M=1h, 6M/1Y=1d, 5Y=1wk, MAX=1mo). This is purely client-side.

**Proposed fix.** Drive the encoding from the data, not the request: pass `range={candles.data.range}` / `range={q.data.range}` at both call sites, or derive `intraday` from `bars[0].ts`/`interval`. Add a guard in `CandleChart` before `setData` (de-duplicate by `time`, assert ascending) so a future payload anomaly degrades to a thin chart rather than a dead tab.

**Evidence:** `repro-1M-to-1Y-1440.png`, `repro-1M-to-1Y-mid-1440.png`, `repro2-VIX-1M-1Y-1440.png`.

---

## P1

### P1-1 · Single-name research advertises yfinance over EODHD data

**Route/viewport:** `/app/markets` → Single-name research; every viewport.

The section header's right-hand meta reads `ANY LISTED SYMBOL · YFINANCE · DELAYED UP TO 15M`, ~120px above a quote line reading `EODHD · delayed · as of Sep 04, 16:27 ET · session closed · last close stands` and a chart caption reading `6M · daily bars · EODHD · through Sep 04, 2026 …`. Same for BRK.B and for the empty state before any symbol is chosen.

**Why it matters.** `PRODUCT.md` (2026-09-06) makes EODHD primary and yfinance a *disclosed fallback*, with "every on-demand payload names its provider … a series never mixes providers and a fallback is never silent". The most prominent provenance label on the section names the wrong provider and contradicts the two labels beneath it — the "app disagreeing with itself" failure mode on the flagship feature, and the label a skimmer reads first.

**Fix:** `web/src/screens/markets/MarketsScreen.tsx:735` — `right="any listed symbol · yfinance · delayed up to 15m"`. Replace with a provider-agnostic line, or derive it from the same `provider-ui.ts` helper the quote and chart captions already use.

**Evidence:** `mk-AMZN-panel-1440.png`, `mk-options-1440.png`, `tape-SPY-1440.png`.

### P1-2 · "Regime unavailable" banner stacked on top of a fully populated regime read

**Route/viewport:** `/app/dashboard`, all viewports. Reproduced deliberately by refusing every `/api/*` request at the browser (`connectionrefused`), and observed again during the real API hang.

With the backend unreachable, `<main>` opens with a red-toned card — "Regime unavailable: the data service did not answer. The read resumes when it is back." — immediately followed by a complete, confident desk read from the snapshot: "Goldilocks at 64% model odds, a clear lead over Recession Risk at 35%", plus `Goldilocks 64%` in the header badge, `GL 64% OV <1% ST <1% RR 35%` in the probability bar, and a status line already saying "The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own."

**Why it matters.** Three contract breaches in one screen: `PRODUCT.md` P2 ("One number, one truth — the app disagreeing with itself is the worst historical bug"); `DESIGN.md` ("Conclusions are stated once per screen; stacked banners repeating one read are a defect"); and the availability promise that the regime "reads with the API asleep". A recruiter opening the deployed app on a sleeping free host — the documented zero-cost deploy mode — sees "unavailable" over live-looking numbers on the first screen.

**Fix:** `web/src/screens/dashboard/DashboardScreen.tsx:373-379` — the banner renders on `regime.isError` alone. Gate it on `regime.isError && !regime.data`, or reword to "Live regime read unavailable; the read below is the validated snapshot from Sep 06, 2026." Since the shell status line already says this, dropping the card when a snapshot is seeded is cleaner.

**Evidence:** `offline-dash-1440.png`, `hdr-2160.png`, `hdr-768.png`.

---

## P2

### P2-1 · Landing page credits the wrong data sources
`/`, all viewports. Footer reads `Data: FRED · yfinance · Finnhub · NewsAPI · RSS`. EODHD — now primary for symbol search, quotes, daily and intraday candles, splits/dividends, end-of-day options and the live tape — is absent, and yfinance is listed as if primary. First screen the priority audience sees, and the one line on it making a provenance claim. **Fix:** `web/src/screens/LandingPage.tsx:401`. **Evidence:** `landing-vp-1440.png`.

### P2-2 · Landing calls the classifier's confidence "Conviction"
`/`, all viewports. The lead ends `Conviction in the call is 50%.` That 50% is the classifier's `confidence` — the number the Dashboard names **"Model confidence"**. `DESIGN.md` has a rule written specifically to prevent this: "Dashboard names the classifier's `confidence` 'Model confidence'; Regime Lab names the takeaway's `conviction` 'Takeaway conviction' … so the two screens can differ without contradicting." The landing uses Regime Lab's word for the Dashboard's number, so a reader clicking through sees "Conviction 50%" become "Model confidence 50%" with no way to know they're the same figure. **Fix:** `web/src/screens/LandingPage.tsx:59`. **Evidence:** `landing-vp-1440.png`, `landing-vp-390.png`.

### P2-3 · The one status word contradicts the Markets feed line, and leaks a machine string
`/app/markets`, all viewports (the header half is on every route). The shell says `● Live · crypto only · US session closed`. The Macro tape header on the same screen says, in red, `US AUTH FAILED`. `/api/stream/debug` confirms the tape is right: `feeds.us: "auth_failed"`, `degraded: true`, `degraded_reasons: ["us feed: EODHD rejected the token"]`.

- **One fact, two explanations.** The shell attributes the missing US tape to the closed session — `f.session.is_open` is the only input (`AppShell.tsx:298-301`) — while Markets attributes it to a rejected token. On a trading day the shell would read `● Live · crypto only` with no explanation at all. `streamWord()` (`web/src/live/quotes.ts:344-352`) never reads `s.degraded` / `s.degradedReasons`, which the relay publishes precisely so the shell can be honest.
- **Engineer-speak in the UI.** "AUTH FAILED" isn't in the closed vocabulary and reads to a recruiter as broken credentials. Worse, `feedWord`'s fallback (`MarketsScreen.tsx:455`) is `return { text: state, … }` — it renders the raw machine state (`connecting`, `closed`, and anything added later) straight to screen, against "Machine strings and snake_case never render".

**Fix:** feed `degraded`/`degradedReasons` into `streamWord`'s suffix (e.g. `▪ Delayed · crypto/FX only · US equity feed rejected`), reword `auth_failed` to a reader's sentence, and replace the `text: state` fallback with an exhaustive map. **Evidence:** `mk-options-1440.png` (tape header), `hdr-1440.png`.

### P2-4 · Chart caption is a run-on: two sentences with no break
`/app/markets`, both the Single-name chart and every on-demand tape chart, all viewports:
> 6M · daily bars · EODHD · through Sep 04, 2026 · split- and dividend-adjusted · delayed history, not the live tape **The tape above owns the live quote**; this chart owns the history.

`candleCaption()` ends without terminal punctuation and the next sentence is concatenated with a bare space. A missing full stop here makes the provenance line look machine-assembled — the exact impression the provenance work exists to avoid. **Fix:** `web/src/screens/markets/SingleName.tsx:~296` and the matching block in `ChartPanel.tsx` — terminate `candleCaption()` with a period, or join with `" · "`. **Evidence:** `mk-AMZN-panel-1440.png`, `tape-VIX-1440.png`.

### P2-5 · Options table scroll well takes a tab stop with no role or name
`/app/markets` → Options lens, 390×844. Measured the three horizontally-overflowing wells:

| well | scrollWidth/clientWidth | role | tabindex |
|---|---|---|---|
| Options chain | 760 / 330 | **null** | 0 |
| Macro tape | 527 / 364 | `region` | 0 |
| Single names | 445 / 364 | `region` | 0 |

The two `ScrollTable` wells follow the documented contract ("the well takes a tab stop and a region role then"); the options chain takes the tab stop without the role, so a keyboard or screen-reader user lands on an unnamed, unannounced container. The visible "Swipe sideways for more columns" hint is present and correct — only the semantics are missing. **Fix:** render the chain through `ScrollTable`, or add `role="region"` + `aria-label="Options chain, scrollable"` beside the existing `tabindex="0"` (`SingleName.tsx` ~494). **Evidence:** `mk-options-390.png`.

### P2-6 · Options provenance stamp has no timezone, and disagrees with itself
`/app/markets` → Options lens, all viewports. Header: `end-of-day · EODHD · as of 2026-09-05 04:00:03`. Caption under the table: `End-of-day marks from EODHD as of 2026-09-05 04:00:0**2**`. Three issues in one line: no zone (`DESIGN.md`: "Server stamps without a zone are UTC and render as ET wall time (`fmtUtcStampEt`)"), ISO format rather than house `Sep 05, 2026 · 04:00 ET`, and two renders of the same stamp differing by one second — the app contradicting itself in the panel whose whole job is provenance. **Fix:** run both through `fmtUtcStampEt` from one value in `SingleName.tsx`. **Evidence:** `mk-options-1440.png`, `mk-options-390.png`.

---

## P3

**P3-1 · Freshness chip prints its state word twice.** `web/src/screens/shared/DeskRead.tsx:50-83` renders `{info.word}` *and* a `text` that repeats it: `◆ Reference Calendar · reference` (News desk read, all viewports); `× Unavailable <noun> · unavailable` for the other case. Fix: for those two states set `text = noun`. Evidence: `crop2-news-390.png`.

**P3-2 · Two definitions of "high" on the News screen.** The ledger says `126 stories in 7D · 0 high impact (≥4)` (`NewsScreen.tsx:460`); the filter chip on the same screen says `≥ 3.5 HIGH` (`NewsScreen.tsx:43`), and the filter caption's bands are ≥4.5 / ≥3.5 / ≥2.5. Three boundaries, one word.

**P3-3 · Command palette says "Headlines", the screen says "Priority developments".** `sections.ts` registers the News section as `Headlines`; ⌘K → "Headlines · NEWS & CALENDAR §" lands on a section titled **Priority developments** (`NewsScreen.tsx:517`). On the wording itself: defensible desk register, but it's the only abstract noun phrase among concrete siblings (Monitored signals, Macro tape, Top surprises, Curve monitor) and it duplicates the palette's own label for the same anchor. I'd make both "Priority headlines" — keeps the ranking claim, matches the vocabulary.

**P3-4 · Allocation prose mixes number styles and leaks ISO dates.** Optimizer status disclosure: "…need 24 Goldilocks months in which all **10** asset classes have a return … 21 of 28 Goldilocks months have complete returns across all **ten** assets … 7 months are excluded (**2003-06 → 2006-09**) … the complete rows run **2010-02 → 2026-09**" — digits and words for the same count two clauses apart, and raw `YYYY-MM` beside the house `Aug 2002 → Sep 2026` in the same sentence. Fix: `AllocationPanel.tsx:~378-398`, run `excluded_range`/`complete_range` through `fmtMonYr`. (The required sentence itself renders verbatim and correctly.) Evidence: `alloc-optimizer-1440.png`.

**P3-5 · Crypto and index charts claim to be split- and dividend-adjusted.** Expanding BTC-USD or VIX captions the chart `… · split- and dividend-adjusted · …`. Neither instrument has splits or dividends. Fix: suppress the adjustment clause for non-equity types in `candleCaption()`. Evidence: `tape-VIX-1440.png`, `tape-BTC-USD-1440.png`.

**P3-6 · "VIX · VIX · index" in the tape panel header.** The panel prints `{symbol} · {name}` and the VIX def's name is already "VIX · index".

**P3-7 · Two 3px rails above the fold on Credit.** At 768 and 1440 the DeskRead's blue rail (y≈228-462 at 1440) is immediately followed by the Analytical callout's amber rail (y≈485-670), `CreditScreen.tsx:333` — `<Card tone="watch" accentBar>`. `DESIGN.md` says the rail is carried "once per screen … the only model-composed surface above the fold", and the detector waiver rests on that. The callout's content is genuinely additive; it just shouldn't carry a second rail above the fold. Evidence: `crop2-credit-1440-fold.png`, `crop-credit-768-0.png`.

**P3-8 · Every route has the same document title.** `document.title` is `Macro Regime Radar` on dashboard, markets, credit, news and methodology. Tabs, bookmarks and history are indistinguishable, and since an SPA route change moves neither the title nor focus, a screen-reader user gets no signal the page changed. Fix: set `document.title = "<Tab> · Macro Regime Radar"` in `AppShell` on tab change.

**P3-9 · Methodology's opening card is ~45% empty.** At 1440 and 2160 the "How to read this product" card spans the full frame (≈1120px at 2160) while its prose is capped at 74ch (≈590px), leaving a large empty right half inside a bordered box. Correct per the prose rule, wrong-looking on a wide monitor. Fix: shrink the card to the prose measure, or put the four numbered items in two columns. Evidence: `crop2-methodology-2160.png`.

**P3-10 · Recession sensitivity disclosure: the "expand" affordance is stranded mid-row.** At 768 the row wraps as `▸ Move the model's five inputs and watch 11.6% respond · 2s10s +45 bps · U-3 4.1% · HY 270 bps   expand` then `· IP 1.0% · LEI 0.0pp`, so the right-aligned "expand" ends up inside the middle of the meta run. Fix: `flex-shrink: 0` + `align-self: flex-start` on the `Disclosure` `right` slot, or drop the meta run to its own line below 1024. Evidence: `crop-recession-768-1.png`.

**P3-11 · Adjacent tape rows open two different chart affordances.** SPY (stored) opens `251 sessions · through Sep 04, 2026` with a `DAILY / INTRADAY` toggle; VIX/BTC-USD two rows away open `1D 5D 1M 6M 1Y 5Y MAX` chips. Both individually well-labelled; jarring only because the rows sit two lines apart. Evidence: `tape-SPY-1440.png` vs `tape-VIX-1440.png`.

**P3-12 · Missing-value dash rendered at `--text-faint`.** `SingleName.tsx:351` colours a null regime-fit average `var(--text-faint)` (#484f58, ≈2.1:1 on card). `DESIGN.md` ruled 2026-09-05 that "missing-data dashes … read at `--text-muted`: a reader has to read them." (`ProbabilityBar`'s exact-zero use is explicitly permitted and is fine.)

**P3-13 · Dashboard prints the same freshness facts twice within one phone screen.** At 390 the header reads `Macro Jul 2026 2 months old` / `Market Sep 04, 2026 current`, and the DeskRead ~300px below repeats `▪ Delayed Macro · Jul 2026 · 2 months old`, `● Current Market · Sep 04, 2026`. Only Dashboard duplicates — Markets' desk chips are Tape / Stored candles / Priced, News' are Newest headline / Calendar — so the pattern is right and this is a per-screen collision. Evidence: `d390-s0.png`.

**P3-14 · Header chips are 40px tall at 390.** Wordmark 196×40, `✓ Alerts` 87×40, `◆ AI` 55×40; SubTabs 43px. `DESIGN.md` explicitly sets 40px for chips/subtabs below 768 and 44px only for menu rows and CTAs — so this is the contract being followed; flagging only because the brief asked for ≥44px. MobileNav rows (56px) and its palette row (44px) do meet it. A 44px floor is a two-line change in `.mrr-chip-btn[data-touch="true"]` (`app.css:443`).

**P3-15 · "Validated snapshot" is unexplained below 1024.** Deliberate per the code comment at `AppShell.tsx:334-342` ("Tablet: the dated words carry the whole message"), but the consequence is that at 768 and 390 a visitor whose backend is asleep sees `◆ Validated snapshot · Sep 06, 2026` with no sentence anywhere explaining it — and `PRODUCT.md`'s audience 2 is "non-finance visitors [who] must not be impenetrable". Consider keeping the snapshot sentence at every width even while the general reconciliation sentence stays desk-only. Evidence: `hdr-768.png` vs `hdr-2160.png`.

**P3-16 · News desk read repeats the top headline verbatim.** At 390 the desk-read conclusion is the headline "Here's what Nvidia's $13 billion Hugging Face deal means for the world of AI", and the identical string is the first NewsCard title ~500px below. A conclusion in the product's own voice ("M&A leads the file: Nvidia–Hugging Face at 3.5/5, the week's highest score") would carry more.

---

# Verified OK

**Layout / overflow.** No horizontal page overflow on any of the ten routes at 390, 768, 1440 or 2160 (`scrollWidth == clientWidth` everywhere). No element escapes the frame outside an intentional scroll well. Frame capped and centred at ~1520px on 2160 with quiet margins. No collisions and nothing obstructing an input at any width, apart from P3-10.

**Navigation.** Primary nav never clipped or hidden; active route carries the 2px accent underline and `aria-current="page"`. MobileNav at 390 lists all seven tabs plus Methodology (marked REFERENCE) plus "Jump to a section", 56px rows and a 44px palette row, `aria-current` on the active route, `position: static` so it pushes content rather than covering the alerts chip, and closes on navigation and on Escape.

**Regime Lab.** All five sub-views reachable at 390 (tablist wraps to two rows, every tab fully visible, 43px) and at 768 (single row, 40px). Keyboard: roving tabindex, ←/→ move and wrap, Home/End jump to first/last, selection and focus stay in sync, panels carry `role="tabpanel"`.

**Command palette.** ⌘K and Ctrl+K both open it; focus lands in "Filter destinations"; `#shell-content` gets `inert`; Tab is contained; typing filters correctly (`credit` → Credit tab + its three sections, first row `aria-selected="true"`); Escape closes; Enter navigates exactly once (`history.length` +1) and closes; a real mouse click on a row navigates and closes; focus returns to the ⌘K chip after Escape. Dialog named via `aria-label="Jump to tab or section"` + `aria-describedby="palette-help"`. The alert drawer follows the same contract (initial focus on Close, focus restored to the trigger).

**Markets — single name.** AMZN resolves; quote label `EODHD · delayed · as of Sep 04, 16:27 ET · session closed · last close stands`; chart caption names range/interval/provider/through-date/adjustment/delay; fundamentals carry `Fundamentals via yfinance (EODHD fundamentals are not in the plan on this server)`; all seven range chips present and, taken coarse-to-fine, all load with a `Requesting 5D bars…` / `Requesting 1D bars…` tag over the previous bars. BRK.B resolves with the dashed-alias ranking putting BRK.B first. ZZZQ returns `No listings match "ZZZQ".` and the panel keeps its explanatory empty state.

**Markets — options lens.** Collapsed by default (`aria-expanded="false"`, 43px at 1440, 64px at 390) with the hint `end-of-day · EODHD · opens on demand`. Opens on demand to an expiration `<select>` (11 dates), Calls/Puts chips, the full column set (Strike Bid Ask Last Vol OI IV Δ Γ Θ V Moneyness DTE), a sticky header inside its own scroll well, `Swipe sideways for more columns` at 390, `page 1 · 40 contracts` with working Prev/Next, and a caption stating end-of-day marks, that the Greeks and IV are the provider's own, and that nothing is a recommendation.

**Markets — macro tape.** BTC-USD and VIX expand to on-demand history labelled `NOT IN THE STORED UNIVERSE · REQUESTED ON DEMAND`; SPY opens the stored panel (`251 sessions · through Sep 04, 2026`, DAILY/INTRADAY). Every row states its own as-of stamp, `●` marks a live tick, `· 15m` marks the delayed REST fill, and the caption explains why crypto/FX/VIX print a dash in the 1W/1M/sparkline columns and why the VIX row differs from the Dashboard's VIX signal.

**Tools — LBO.** Cold load with a 6-second delay injected into `/api/lbo/*` goes `Reading stored data…` → `Running the deal model…` → the result. **Never "Nothing on file."**

**Tools — Allocation.** The required sentence renders verbatim: `21 of 28 Goldilocks months have complete returns across all ten assets; 24 are required.` It sits inside a collapsed `Optimizer status: no output this session` disclosure whose summary reads `21 of 28 Goldilocks months complete · 24 required`, with the regime matrix staying primary above it — exactly the documented demotion.

**News.** Filters collapsed by default (43px), opening to Category / Window / Significance groups plus a caption explaining the 1–5 scoring and colour bands. All 24 external links carry `target="_blank" rel="noreferrer"`. The fallback path is wired (`Latest stored developments` + "significance filter not applied" when the window is empty).

**Header / status line.** Exactly one status-word chip at 390, 768, 1440 and 2160, always from the closed vocabulary, always glyph + word + colour (never colour alone). With every `/api/*` request refused the shell degrades correctly: `◆ Validated snapshot · Sep 06, 2026`, `Alerts · unavailable`, `SPY — (no price)`, and "The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own." The page still paints in full from the snapshot within the documented 15-second abort — confirmed both against a refused API and against the wedged, hanging one.

**Structure and accessibility basics.** Exactly one `h1` per page, no heading-level jumps, `header` / `nav[aria-label="Primary"]` / `main` landmarks, a working "Skip to content" link to `#main-content` (which exists with `tabindex="-1"`), no unnamed buttons or links, no unlabelled SVGs, `lang="en"`, and `prefers-reduced-motion: reduce` handled in four places including the live dot and caret.
