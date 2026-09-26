# DESK_FRAME3_SPEC.md — Desk v2 build contract

Status: approved mockups, locked 2026-09-23. This file plus `screens/*.png` is the
contract. When the spec and a PNG disagree, the PNG wins for layout and the spec
wins for numbers, labels, and API shape. Every illustrative number below is the
mockup's; the build renders whatever the API returns.

Three sessions consume this file:
- **A (desk/frame-3, `web/` only)** builds the eleven tabs and the Client toggle.
- **B (desk/frame-3-api, `api/`, `src/desk/`, `scripts/`)** builds the endpoints in §12.
- **C (desk/frame-3-docs, `docs/desk/` only)** audits what the store can produce today.

A builds against the JSON in §12 using fixtures; B makes the real endpoints return
that JSON. Neither changes §12 without writing the change into this file first.

---

## 1. Site-wide rules

### 1.1 Navigation
- Sidebar is the ONLY navigation. No top tab strip. Width 176px, background #0f1216.
- Header of sidebar: `← MACRO REGIME RADAR` (mono, 10px, links to the Radar root),
  then `Desk` (serif 26px) over `ANALYST WORKSPACE` (mono 9.5px, letter-spaced).
- Three groups, mono 9.5px uppercase labels:
  - **SURVEY**: Overview, Technicals, Regime, Macro & Correlations, Sectors
  - **ACT**: Event Study, Signal Ledger, Position Monitor
  - **TOOLS**: Basket & Hedge, Data Pipeline, Build Notes
- Active item: background #1b2027, white text. Others #c9cdd3.
- Bottom of sidebar, two stacked cards (border #262b33, radius 10px):
  - **TODAY** card: regime name (serif 18px, amber for Overheating), `regime · Aug
    print`, then `S&P today +0.4%` (green), `Data ● current` (green dot).
  - **HOUSE DISCIPLINE ▸** card: `Gate ● on`. Click opens the gate text (§8.3).
- Page header, every tab: breadcrumb `Radar › Desk › <Tab>` (mono 11.5px, gray)
  left; right side has a Desk / Client segmented toggle (Desk active by default)
  and at most one action button. The action button per tab is listed in §2–§11.

### 1.2 Typography
- Source Serif 4 for big numbers and card titles' numbers. IBM Plex Sans for prose
  and labels. IBM Plex Mono for mono labels, dates, tickers, stat captions.
- Sizes used: page title 22px serif bold; card title 14px sans 600; card subtitle
  12px gray; stat label mono 9.5–10px letter-spaced uppercase #6b7280; stat number
  serif 20–26px; stat sub-line 11px gray; body 12.5px; chart axis mono 11–14px.

### 1.3 Palette — five accents, one job each
| Token | Hex | Only ever means |
|---|---|---|
| green | #26dca0 | up · Reliable · firing · current |
| red | #e5534b | down / negative numbers |
| amber | #e8b447 | Suggestive · caution · a limit / falsification line · Overheating |
| blue | #58b8e6 | the main line on any chart |
| gray | #8b929e | No edge · quiet · second line · neutral |

Neutrals: page #0c0e11, sidebar #0f1216, card #12161b / #151920, card border
#262b33, row divider #1c2027, box border #2a3038, text #e8e6e1 / #c9cdd3 /
#8b929e / #6b7280. Verdict pill tints: Reliable bg #0f1a16 border #1f6b52;
Suggestive bg #1a160f border #5a4a1e; No edge bg #171a1f border #2a3038.
No purple. No other accent.

### 1.4 Card skeleton (every card on every tab follows this)
1. Title (bold) + subtitle (gray) on one line.
2. Stat row: 2–4 stats, each = mono label / serif number / gray sub-line.
3. Body: chart, list, or table.
4. Boxed read: `Read:` or `Read for the desk:` in a #12161b box with a #2a3038
   border, 12px, one or two sentences. Amber-bordered box when the read is a warning.
5. Footer: `Advanced ▸` (blue link) + gray list of what expands, and/or an
   action link `→`.

### 1.5 Verdicts (never "established", never "significant")
- **Reliable** (green pill): 10+ independent episodes AND fewer than 3% of
  resamples go the other way.
- **Suggestive** (amber pill): leans one way but the resampled range crosses zero
  or n < 10. Copy: "don't size on it".
- **No edge** (gray pill): about the same as any month. Copy: "shown so you know
  it was checked".
- A normal month = +1.3% (20 sessions). "vs normal" = median − 1.3.

### 1.6 Live badges
Every card that reads live data carries `● Live · <source> · <date>` (green
dot, mono 10px) top-right. Sources: `engine as of Sep 22`, `Yahoo/FRED`, `Aug
print`, `EODHD`. The `MOCKUP · values illustrative` amber badge is NOT built.

### 1.7 Empty states
- Study with `n_events < 10`: answer card shows one sentence ("Only N events
  since <start> — too few to score.") and two fix chips ("Widen the window",
  "Drop the condition"). No chart.
- Missing series or endpoint error: card body shows "Awaiting refresh" (gray),
  keeps its stat labels, no number.
- A value is rendered with a date only when the date arrives in the same
  response as the value, at the series' own frequency (frame-2 R-07 rule).

### 1.8 Storage
Baskets and saved questions live in `localStorage` per browser with an
Export/Import JSON control. No accounts.

---

## 2. Overview  (`screens/01-overview.png`, 960px)

Action button: **Walkthrough** (opens the first-visit walkthrough overlay,
existing from frame-2).

**Since-last-close line** (full width, one line under the title, box style):
`SINCE LAST CLOSE` mono label, then items separated by `·`: new fires with
`(new)` in green, signals still firing with day count, vol change in pts and
skew direction, `regime unchanged` / `regime changed → X`, `data refreshed
00:23 UTC`. From `/api/desk/overview.since_last_close`.

**Four tiles** (equal width):
| Tile | Label | Big value | Sub-line |
|---|---|---|---|
| REGIME | `● Live · Aug print` | Overheating (amber serif 26px) | Growth rising, inflation rising · rule-based, two-month lag |
| RECESSION · LOGISTIC MODEL | `● Live` | 12% | Low · one-in-eight over the next year, on data through May |
| S&P 500 · TREND | `● Live · Sep 22` | Above 50 & 200 | Uptrend since the Jul 2025 golden cross · that signal is reliable |
| VOL · VIX | `● Live · Sep 22` | 16.2 | Calm · protection costs about 4 pts more than recent moves justify |

**Active signals** card (left, ~60% width). Subtitle: `what fired, how it has
played out before · engine as of Sep 22`. One row per signal in the Ledger
with `firing_now` OR in the top-5 by recency; row = name (bold) + `last fired
<date>` under it; sentence `Fired N× since <start> · S&P up P% of the time ·
20-day median +M% (+D pts vs normal)`; verdict pill right. Mockup rows:
golden cross (31×, 68%, +2.7%, +1.4, Reliable) · death cross (29×, 52%,
+0.9%, −0.4, No edge) · Gold +2σ while S&P < 50d (18× since 2000, 67%, +3.1%,
+1.8, Suggestive) · VIX +2σ in 5 days (41×, 71%, +2.2%, +0.9, Reliable) ·
2s10s +2σ steepening (22×, 45%, −0.6%, −1.9, No edge). Footer: three verdict
definitions (§1.5) side by side + `Full Signal Ledger →`.

**Monitored** card (right). Subtitle `how far each is from being wrong · live`.
Rows (grid `minmax(0,1fr) 54px auto 64px 14px`): name (nowrap) · `N% NAV`
(mono gray) · `P% room · X to level` (green if room ≥ 50%, amber if < 30%,
nowrap) · bar · `▸`. Mockup: Long NDX vs SPX · 4% NAV · 68% room · 3.4% to
level; 2s10s steepener · 2% NAV · 22% room · 3 bp to level (amber); AI-infra
basket, hedged · 6% NAV · 52% room · 2.1% to level. Footer sentence: `Sorted
by room left · same scale for every trade · size as % of NAV · click a row
for the gate text`. Button bottom-right: **Act on this → Position Monitor**.

---

## 3. Technicals  (`screens/02-technicals.png`, 1060px)

Action button: **Act on this → Position Monitor**. Badge: `● Live ·
Yahoo/FRED · as of Sep 22, 2026`.

Grid: left column tall (spans two rows) = Vol; top-middle = Price & MAs;
top-right = Signals; bottom-middle = Sector leadership; bottom-right = RSI.

**What protection costs right now** (Vol column). Subtitle `S&P 500 options,
read from the SPY chain at last close.` Three readings, each label / number /
one-line meaning / one-line context:
- PUTS vs CALLS · 1 MONTH OUT → `+6.8 pts` → "Puts are 6.8 vol points more
  expensive than calls." → "Rising since June. Investors are paying up for
  downside cover."
- WHAT OPTIONS EXPECT vs WHAT HAPPENED → `15.4 vs 11.9` → "Options price 15.4%
  annual movement; the last 20 days delivered 11.9%." → "Protection costs about
  3.5 points more than recent moves justify."
- 1 MONTH · 3 MONTHS · 6 MONTHS → `15.4 · 16.8 · 17.5` → "Longer-dated
  protection costs slightly more than near-dated." → "That is the normal shape.
  No near-term event is being priced in."
Gauge: SKEW · WHERE IT SITS, three bands Cheap / Typical / Expensive, needle
at `74th pct`, caption "74th percentile of a calm two years, so 'expensive'
here is relative. Six months ago it sat in the typical band." Footer:
`Advanced ▸ put IV vs call IV · which side moved · full 2-year skew line ·
chain provenance` and source line `Source: EODHD options, one pull per close ·
live read, not scored (history from Q4 2023)`.

**S&P 500 — price and its two trend lines**. Range chips 6M / 1Y / 3Y. Stats:
PRICE `6,412` (+0.4% today, green) · 50-DAY AVERAGE `6,280` (price is 2.1%
above) · 200-DAY AVERAGE `5,910` (price is 8.5% above). Chart: price (blue),
50-day (green), 200-day (gray dashed); y ticks 5,000 / 6,000 / 7,000; x ticks
Oct 25 / Apr 26 / Sep 26; each line labeled at its right end; white dot at
last price. Callout box: "Jul 1, 2025 — the 50-day crossed above the 200-day.
This has happened 31 times before; the S&P was higher a month later 68% of
the time. Reliable."

**Signals** card. Stats: 1-YEAR RETURN `+14.2%` · TREND `Up` (above both
averages) · LAST 20 DAYS `+0.6σ` (no extreme move). Five rows `name · N×
since 1990 · up P% · a month later +M% · pill`: Golden cross 31/68/+2.7
Reliable; Death cross 29/52/+0.9 No edge; RSI above 70 64/59/+1.1 No edge;
RSI below 30 22/73/+3.4 Reliable; 5-day move over 2σ 88/55/+0.6 No edge.
Note box: "In this regime (Overheating): golden cross has fired only 9 times —
too few to trust. A normal month is +1.3%; 'Reliable' means the edge over that
survives resampling."

**Sector leadership · 3-month relative strength vs S&P**. Seven bars shown
(XLK +6.1, XLI +3.4, XLF +2.2, XLE +0.4, XLV −1.9, XLP −3.6, XLU −4.8);
green > +1%, gray within ±1%, red < −1%. One sentence: "Tech and Industrials
leading; Staples and Utilities lagging, consistent with an Overheating read."
Footer `Advanced ▸ all 11 · rotation over time · by regime`.

**Momentum · RSI**. Stats: NOW `58` (neutral, rising) · LAST ABOVE 70 `Jun 12`
(S&P +1.1% a month later) · LAST BELOW 30 `Apr 8, 2025` (S&P +9.4% a month
later). Gauge Oversold / Neutral / Overbought with needle at 58. Two matched
note boxes (above 70: 64×, 59%, No edge; below 30: 22×, 73%, Reliable).
Footer `Advanced ▸`.

---

## 4. Event Study  (`screens/03-event-study.png`, 1080px)

Action button: **Act on this → Position Monitor**. Subtitle: `Ask what the
market did after a defined shock. Get a scored answer, not an opinion.`

**Row 1 — Pick a question.** Three-way segmented switch: `Common questions` /
`My saved questions · N` / `Build your own`. Under it: gray hint "pick one
below, or build your own in the slots — either way the slots show exactly what
is being asked". Nine preset chips (slugs in §12.2): Gold +2σ while S&P weak ·
Golden cross · Death cross · VIX spike · Credit spreads +2σ · 10y yield +2σ ·
Dollar −2σ · Oil +2σ → gold · S&P −2σ → 10y. Saved questions render as chips
under a `Yours` label.

**Row 2 — THE QUESTION, SPELLED OUT.** Sub-label "change any slot and it
becomes your own · every slot lists the same 12 series". Six labeled dropdown
slots: SHOCK (series) · WINDOW (5/10/20/60 days) · MOVE ⓘ (up 2σ or more /
down 2σ or more / crosses above MA / crosses below MA; tooltip: "σ measured
over the last 252 sessions") · WHILE ⓘ (none / S&P below its 50-day / above /
regime = X; tooltip: "condition checked on the shock day, entry next session")
· WHAT HAPPENS TO (series) · OVER THE NEXT (1 week / 2 weeks / 1 month / 3
months). Buttons **Run** (primary) and **Save**.

**Answer card** (left, ~62%). Headline sentence (serif 17px): e.g. "Leans
positive a month out, but not something to size on." Under it two pills:
`○ Not firing today · last Apr 16, 2025` (or `● Firing today`) and `● Live ·
0.3s, cached` (from `served_from_cache` and `elapsed_ms`). Four stats:
EVENTS `18` (since 2000) · UP A MONTH LATER `67%` (12 of 18) · MEDIAN AT A
MONTH `+3.1%` (vs +1.3% in a normal month) · WORST · BEST `−9.4% / +12.0%`
(Mar 2020 · Apr 2025). Bar chart, four horizons (1 week / 2 weeks / 1 month /
3 months), two bars each (after the event, blue; a normal stretch, gray) with
a range whisker on the event bar; y ticks +5% / 0 / −3%; values +1.2 / +1.6 /
+3.1 / +2.9. Legend: `■ after the event · ■ a normal stretch · ┬ range the
answer could fall in`. Comparison line: "Without the S&P condition — gold +2σ
on its own — it's 41 events, up 58%, median +1.6%: No edge. The condition
earns its place." (from `without_condition`).

**Rail** (right, ~38%), top to bottom:
1. VERDICT box (amber border for Suggestive): `VERDICT · SUGGESTIVE` / bold
   "Lean, don't size." / why (the 9%-of-resamples sentence) / what to do (the
   call-spread sentence) / `Price it →` (deep-links Basket & Hedge, Express
   mode).
2. BY REGIME · A MONTH LATER table: REGIME / N / UP / MEDIAN, four regimes;
   n < 5 renders `n<5` in both cells. Note: "Today is Overheating: six events,
   too few to read alone."
3. LAST FIVE EVENTS · S&P A MONTH LATER: date · regime · return.
4. RANGE vs NORMAL with confidence selector 80% / 90% / 95% (re-queries with
   `confidence`): four rows horizon · range in pts · pill. Note under it:
   "All four include zero at 90% — that is why this is Suggestive. At 80% the
   1-month range clears zero; at 95% none do."
5. `Advanced ▸ all 18 events · resampling detail · entry rules · provenance` ·
   `Export →` (CSV of events). Provenance line (mono 10px): `Engine as of
   Sep 22 · cluster bootstrap 10,000 · entry next session · cooldown 20 · gold
   history from 2000 · slug gold-2sigma-spx-weak`.

Advanced expander content = the frame-2 parameter panel and tables (already
built); it opens below the grid.

---

## 5. Regime  (`screens/04-regime.png`, 960px)

No action button. Badge `● Live · Aug print · Sep 22`. Symmetric 2×2.

**Where we are** (`rule-based · two-month lag`). Big `Overheating` (amber
serif 30px), sentence "Growth rising and inflation rising. Third month in a
row." Stats: GROWTH `Rising` (industrial production, 3-mo slope) · INFLATION
`Rising` (CPI, 3-mo slope) · IN THIS REGIME `3 mo` (since the June print).
LAST FIVE YEARS strip: colored segments by regime, year ticks 2021…2025,
`today` at right; key ■ Goldilocks (green) ■ Overheating (amber) ■
Stagflation (red) ■ Recession Risk (gray). Box "How it's decided: two signs —
growth rising or falling, inflation rising or falling. Four combinations, four
regimes. No model, no fitting." Footer `Advanced ▸ the two input series ·
every regime change since 1996 · rule text`.

**Recession probability** (`logistic model · five monthly inputs, lagged three
months`). Big `12%`, "Low. About one-in-eight over the next year." Gauge Low /
Watch / Elevated · above 50%, needle at 12. Stats: INPUTS THROUGH `May`
(three-month lag by design) · A YEAR AGO `9%` (rising slowly, still low) ·
PEAK LAST CYCLE `71%` (Mar 2020). Box "What it is: a fitted model — five
monthly indicators against NBER recession dates since 1970. It is the only
fitted thing on the site, and it is labeled as one wherever it appears."
Footer `Advanced ▸ the five inputs · fit and out-of-sample record · every
month since 1970`.

**What each regime has meant** (`since 1996 · why a derivatives desk cares`).
Table REGIME / MONTHS / S&P / MO / UP / VIX AVG / STOCK–BOND: Goldilocks 142
+1.4% 66% 15 −0.2 · Overheating 88 +0.9% 59% 17 +0.3 · Stagflation 61 −0.2%
48% 24 +0.4 · Recession Risk 54 −0.6% 45% 29 −0.5. Current regime row
highlighted. Amber read: "Overheating has been fine for equities but vol runs
a little higher than Goldilocks, and stock–bond correlation is positive —
Treasuries stop hedging. That argues for owning protection through options
rather than duration, which is the case the Technicals vol card makes today."
Footer `Advanced ▸ by regime: sector leaders · curve shape · credit spreads ·
skew (since 2023)`.

**What would change it** (`the next two prints, and the last five changes`).
NEXT CPI `Oct 14` — "a soft print (<0.2% m/m) flips inflation to falling →
Goldilocks"; NEXT INDPRO `Oct 17` — "a negative print flips growth to
falling → Stagflation". Both thresholds are COMPUTED by the engine (the value
that flips the 3-month slope), never typed. LAST FIVE REGIME CHANGES · S&P A
MONTH LATER list: Jun 2026 Goldilocks → Overheating +2.1% · Oct 2025
Stagflation → Goldilocks +3.8% · Mar 2025 Overheating → Stagflation −4.2% ·
Aug 2024 Goldilocks → Overheating +1.1% · Jan 2024 Recession Risk →
Goldilocks +5.3%. Read: "regime changes have not been sell signals on their
own; the one negative was the move into Stagflation. The label lags two
months, so the market usually knows before the label does — which is why the
Ledger scores signals, not regimes."

---

## 6. Macro & Correlations  (`screens/05-macro-correlations.png`, 1060px)

No action button. Badge `● Live · FRED / Yahoo · Sep 22`. 2×2.

**Yield curve** (`today against a month ago`). Stats: 10-YEAR `4.21%` (−6 bp
on the month) · 2s10s `+41 bp` (steepening · +9 bp) · FRONT END `3m 4.05%`
(market leans to cuts). Chart: tenors 3m / 2y / 5y / 10y / 30y on x; today
(blue solid) 4.05 / 3.80 / 3.95 / 4.21 / 4.62, a month ago (gray dashed); y
ticks 3.8 / 4.0 / 4.2 / 4.5; both lines labeled at right end. Read: "the
front end has come down more than the long end — a bull steepener. That is
the 2s10s trade on the Position Monitor working, and it is the shape that
usually goes with rate cuts, not stress." Footer `Advanced ▸ 2y · 5y · 10y ·
30y history · real yields · breakevens · curve by regime`.

**Do bonds still hedge stocks?** (`60-day correlation of daily returns, one
year`). Stats: TODAY `+0.31` (positive · bonds not hedging, amber) · A YEAR
AGO `−0.24` (was working) · FLIPPED `Mar 2026` (six months positive). Line
chart one year, y +1 / 0 / −1, upper band labeled "bonds move WITH stocks · no
hedge" (amber tint), lower "bonds move AGAINST stocks · hedge works" (green
tint). Amber read: "with correlation positive, a long-Treasury position does
not protect an equity book — both sell off on inflation surprises.
Protection has to come from options. That is why the Technicals vol card and
the Basket & Hedge tab price puts, not duration." Footer `Advanced ▸ 20 / 60
/ 250-day · since 1990 · correlation by regime`.

**Credit** (`high-yield spread over Treasuries`). Stats: HY SPREAD `3.12%`
(tight) · 3-YEAR RANGE `2.6 – 5.9%` (today near the low) · INVESTMENT GRADE
`0.94%` (also tight). Gauge Tight / Normal / Wide, needle `18th pct`. LAST 12
MONTHS line, y 3% / 4% / 5%, peak labeled `Mar scare · 4.6%`. Read: "credit
is not flagging anything. Spreads near the tight end of three years means the
bond market sees no default cycle; a +2σ widening over 20 days is a scored
signal on the Ledger and would be the first warning." Footer `Advanced ▸ IG ·
BB · B · CCC · spread history · widening as an event`.

**What moves with the S&P** (`60-day correlation · each asset against the
index`). Header `← moves against · a hedge | moves with · same bet →`. Six
rows, each = name / centered bar (left = green, right = amber) / value / gray
meaning: 10-year Treasury (price) +0.31 "moves with · no hedge" · Gold +0.12
"no relationship" · Dollar −0.22 "weak dollar helps" · Oil +0.18 "weak" ·
Nasdaq +0.92 "same trade" · High-yield credit +0.64 "risk-on together".
Read: "nothing on this list reliably moves against the S&P right now — even
Treasuries are moving with it. Nasdaq and high-yield are the same trade as
the index; owning them is not diversification." Footer `Advanced ▸ full
12-asset matrix · rolling windows · by regime`.

---

## 7. Sectors  (`screens/06-sectors.png`, 900px)

No action button. Badge `● Live · Yahoo · Sep 22`. Two columns.

**Sector leadership** (`3-month return relative to the S&P · all eleven`).
Stats: LEADING `Technology` (green) +6.1% vs the index · LAGGING `Utilities`
(red) −4.8% vs the index (red) · PATTERN `Cyclical` growth sectors over
defensives. Eleven rows ticker / name / bar / value: XLK +6.1 · XLI +3.4 ·
XLF +2.2 · XLC +1.6 · XLY +1.1 · XLE +0.4 · XLB −0.6 · XLRE −1.2 · XLV −1.9 ·
XLP −3.6 · XLU −4.8. Key: ■ more than 1% ahead (green) ■ within 1% (gray) ■
more than 1% behind (red). Read: "Tech, Industrials and Financials leading;
Staples and Utilities lagging. Cyclicals over defensives is the leadership
you expect in Overheating — the sector tape agrees with the regime label."
Footer `Advanced ▸ 1 / 3 / 6 / 12 months · rotation over time · leadership by
regime`.

**Breadth** (`is the rally wide or narrow?`). Stats: ABOVE 50-DAY `7 of 11`
(amber; sectors · was 10 in July) · ABOVE 200-DAY `9 of 11` (green; sectors ·
trend still broad) · EQUAL vs CAP WEIGHT `−2.4%` (red; 3 months · big names
carrying it). Line: AVERAGE STOCK vs THE INDEX · ONE YEAR (RSP/SPY relative),
y +5 / 0 / −5, bands labeled "average stock beating the index · broad rally"
(green) and "index beating the average stock · narrow rally" (amber). Dots
row WHICH SECTORS ARE ABOVE THEIR 50-DAY (eleven, green lit / gray) and …AND
THEIR 200-DAY. Line: SMALL CAPS vs LARGE · RUSSELL 2000 AGAINST THE S&P · ONE
YEAR, same y, bands "small caps leading · risk appetite broad" / "large caps
leading · crowded into the biggest names". Amber read: "narrowing. The index
is up on a shrinking group of names — seven of eleven sectors above their
50-day, down from ten. Not a sell signal on its own, but it is the first thing
to watch if the vol card starts flagging." plus gray note "Measured from
sector ETFs; stock-level breadth needs constituent data that is not ingested
yet." Footer `Advanced ▸ all three measures since 2000 · breadth by regime ·
small caps vs large`.

---

## 8. Signal Ledger  (`screens/07-signal-ledger.png`, 880px)

No action button. Badge `● Live · engine as of Sep 22`. Subtitle `every signal
the engine scores, on one page · click a row to open it in Event Study`.

Four stat cards: SIGNALS SCORED `12` (since 1990 where history allows) ·
FIRING NOW `2` (green; names) · RELIABLE `3` (green; names) · NO EDGE `5`
(shown so you know they were checked).

Filter chips: All 12 · Firing now · Reliable only · S&P only · Cross-asset.

Table, fixed column widths: SIGNAL / LAST FIRED / TIMES / UP A MONTH LATER /
MEDIAN / VS NORMAL / VERDICT (92px pill) / NOW (`● Firing` green or `○ Quiet`
gray, text not pill). Two groups with mono group headers: FIRING NOW (rows
green-tinted) then QUIET · SORTED BY VERDICT. Mockup rows in order: 2s10s +2σ
steepening (Sep 9 2026, 22, 45%, −0.6%, −1.9, No edge, Firing) · Dollar −2σ,
20 days (Sep 15 2026, 37, 62%, +1.9%, +0.6, Suggestive, Firing) · S&P golden
cross (Jul 1 2025, 31, 68%, +2.7%, +1.4, Reliable) · RSI below 30 (Apr 8
2025, 22, 73%, +3.4%, +2.1, Reliable) · VIX spike +2σ, 5 days (Aug 5 2024,
41, 71%, +2.2%, +0.9, Reliable) · Gold +2σ while S&P weak (Apr 16 2025, 18,
67%, +3.1%, +1.8, Suggestive) · HY spreads +2σ, 20 days (Mar 12 2025, 24,
63%, +2.9%, +1.6, Suggestive) · S&P 20-day move over 2σ (Apr 9 2025, 29,
66%, +2.4%, +1.1, Suggestive) · S&P death cross (Apr 14 2025, 29, 52%,
+0.9%, −0.4, No edge) · RSI above 70 (Jun 12 2026, 64, 59%, +1.1%, −0.2, No
edge) · Oil +2σ, 20 days (Jun 18 2026, 44, 49%, +0.4%, −0.9, No edge) · S&P
5-day move over 2σ (Aug 2 2026, 88, 55%, +0.6%, −0.7, No edge).

Footer: the three verdict definitions + `a month = 20 sessions · normal month
+1.3% · engine as of Sep 22`.

---

## 9. Position Monitor  (`screens/08-position-monitor.png`, 1040px)

No Desk/Client toggle on this tab (desk-only). Two columns.

**Promote to position** (left). Subtitle "Carried in from Event Study · Gold ≥
+2σ (20d) AND SPX below 50d MA · 20 trading days · any study can be carried
in". Fields: INSTRUMENT (text) · DIRECTION (Long / Short segmented) · SIZE ·
% NAV (number) · HORIZON chips 5 / 10 / 20 / 60 trading days.

**Discipline gate** — "three short answers, then Save turns on" with progress
`✓ variant · ✓ pre-mortem · ○ level`:
1. VARIANT VIEW — "finish the sentence: 'The market thinks ___, I think ___,
   because ___.'" (textarea)
2. PRE-MORTEM — "finish the sentence: 'It lost money because ___.'"
3. WRONG IF — "suggested for <instrument> · changes with the instrument".
   Three suggested chips computed from live levels (e.g. `closes below its
   50-day (6,280)`, `falls 2σ over 5 days`, `the signal reverses`) and a
   `More levels for <instrument>…` expander with eight more (200-day, entry
   −3%, entry −5%, lower low than last 20 days, RSI < 40, VIX > 25, regime
   label changes, HY spreads widen 2σ).
WORDING check: certainty words (will, always, never, proves, guaranteed)
highlighted amber with one-click replacements ("is likely to", "tends to").
Only those block; nothing else is edited. **Save position** button disabled
until the gate is complete; helper text names what's left.

Placeholder text in the mockup's gate fields is illustrative; the build ships
the fields empty, and the two live positions' text carries `TODO(Max)`
markers in the fixture.

**Monitored** (right). Same row format as Overview §2, click expands a row.
Expanded row shows: FALSIFIES AT (`2s10s below +38 bp · now +41 bp`) · SIZE ·
HORIZON (`2% NAV · DV01 $1.4k · 14 of 20 trading days · opened Sep 2`) ·
VARIANT VIEW · PRE-MORTEM · RED TEAM · STRONGEST CASE AGAINST · links `Open
the study behind it →` and `Price a hedge →`. Footer: `Sorted by room left ·
room = distance to the level as a share of the room at entry, same scale for
every trade · size as % of NAV · 12% deployed, 3 positions · click a row for
the gate text`. CLOSED · LAST 90D strip: Falsified on level `4` · Expired at
horizon `6` · Pre-mortem was right `2 of 4`.

---

## 10. Basket & Hedge  (`screens/09-basket-hedge.png`, 1040px) — ships if there's time

Action button: **Send to Position Monitor →**. Badge `● Live · prices Sep 22 ·
options via EODHD`. Two columns.

**Basket**. Selector `AI infrastructure ▾` (7 names · rebalanced monthly) +
`+ New basket`. Stats: 3-MONTH `+12.7%` (vs NDX +9.1%) · VS NDX · RESIDUAL
`−1.9%` (last 60 sessions · falsifies at −4%) · BASKET VOL `41%` (vs NDX 24%
· 1.7× as jumpy). LEGS table ("type a weight, or × to drop a name") with
buttons Equal-weight / Normalize to 100%: NVDA 22 · AVGO 16 · VRT 14 · CRWV
12 · ANET 12 · CEG 12 · SMCI 12; `+ Add a ticker…` row (any US-listed name ·
price history pulled on add); total 100%. Chart: IS THE AI-INFRA BET
WORKING? · BASKET MINUS 1.6 × NASDAQ, LAST 60 SESSIONS — one blue line, zero
line, dashed amber line at −4% with the band below tinted, in-chart labels
"above the line · the bet is paying beyond Nasdaq beta" (green) and "at the
dashed line the position comes off · −4%" (amber), white dot at −1.9%, x
labels "60 sessions ago" / "today". Sentence: "Slipped from +0.8% to −1.9%
over the month: still 2.1 points above the line, but drifting toward it. Same
number the Position Monitor watches." Box: "Beta to NDX: 1.6. Half of this
basket's move is just Nasdaq. Hedge that half and what's left is the actual
AI-infra bet." **Save basket** button. Footer `Advanced ▸ rebalance rule ·
index since inception · export`.

**Hedge · express or protect** (`priced off the live SPY / QQQ surface`).
Three-way switch: Protect the basket / Express the S&P lean / Neutralize NDX
beta. Three option rows (radio; put spread selected): Put spread on QQQ · 1
month · 5% / 10% down — costs 1.1% of basket — breakeven −6.1% · max loss
1.1% — "Cheapest cover for a 5–10% drawdown. Skew is steep, so the lower put
you sell pays for a lot of the upper one." · Collar — costs 0.2% — breakeven
−5.2% · max loss 5.2% — "Near-free, but you give up upside above +5%. Wrong
tool while the basket is running." · Outright QQQ puts 5% down — costs 2.4% —
breakeven −7.4% · max loss 2.4% — "Simplest, and twice the price. Vol is rich
right now; you're paying for it." Then: HEDGE RATIO `$62 per $100` (QQQ
notional · beta-adjusted, 1.6 × 0.39 delta) · COST OF WAITING `−0.09% / wk`
(theta if nothing moves) · ROLL `Oct 17` (30 days · roll at 10 DTE). Scenario
table IF NDX MOVES · OVER THE MONTH: NDX / BASKET / + HEDGE: −20% / −32% /
−30% · −10% / −16% / −14% · flat / 0% / −1.1% · +10% / +16% / +15%. Note:
"Basket moves 1.6× NDX. The spread pays at most 3.1% of the basket (5 points ×
$62 notional), so it softens a drawdown rather than stopping it; below −10%
you are long the basket again." Box "Why index options, not the names: …
single-name vol runs 1.7× the index …". Recommendation box at bottom.

---

## 11. Data Pipeline, Build Notes, Client view

**Data Pipeline** (`screens/10-data-pipeline.png`). Header `● Last full
refresh Sep 22, 00:23 UTC · validation passed`. Title "Where every number
comes from" · "Every panel in Desk resolves to a row here. Nothing is
synthetic; nothing is re-derived in the browser." Lineage strip: 1 SOURCES
(FRED API, Yahoo Finance, EODHD) → 2 FETCH (GitHub Actions, daily 00:23 UTC,
news-only hourly) → 3 VALIDATE (schema + range checks, as-of ≤ today, gap
detection) → 4 TRANSFORM (z-scores, MAs, regime labels, forward returns) → 5
STORE (SQLite snapshot, published as release asset, Snowflake-ready schema) →
6 SERVE (FastAPI · /api/desk/* · one number, one truth). Series inventory:
groups Rates (5) · Credit (5, "HY OAS history from 2023") · Equities & vol
(6) · FX & commodities (4, "WTI published weekly") · Macro monthly (6); each
group expands to a table SERIES / ID / FROM / AS OF / FEEDS / STATUS, scrolls
inside the group; search jumps to a series. Read from the pipeline config —
new series appear automatically. Snowflake bridge card with the DDL block
exactly as on the board, buttons **Export current study → CSV** and
**Generate Snowflake DDL**.

**Build Notes** (`screens/11-build-notes.png`). TOC sidebar (What this is ·
What the engine does · Where every number comes from · What is a model and
what isn't · Review log · Known limits · What I'd build next). Rendered from
`docs/desk/BUILD_NOTES.md` — the page is a markdown render, nothing hardcoded.
Byline `Max Komen · September 2026`. The `[N] findings across [R] rounds`
placeholder is filled by Max from C's audit.

**Client view** (`screens/12-client-view.png`, 760px). The Desk/Client toggle
on any Survey tab swaps the page for a one-card client-safe summary: source
line `Radar · FRED, Yahoo Finance · as of Sep 22, 2026 · Past patterns do not
guarantee future results.`, title "A month later, by economic backdrop",
subtitle "Typical S&P move after the setup", four regime rows with median
(Goldilocks +4.2% · Overheating +2.8% · Stagflation +1.9% · Recession Risk
"too few cases to say"). No verdict pills, no σ, no jargon.

---

## 12. API contract

All under `/api/desk/`. Every response carries `as_of` (engine date),
`generation_id`, and each value that has its own date carries it beside the
value at the series' frequency. Errors are `{ "error": string }` with 4xx/5xx.

### 12.1 `GET /overview`
```json
{
  "as_of": "2026-09-22", "generation_id": "…",
  "since_last_close": {
    "new_fires": [{"slug":"dollar-2sigma-20d","label":"Dollar −2σ fired"}],
    "still_firing": [{"slug":"2s10s-2sigma-steepening","label":"2s10s still firing","day":10}],
    "vol_change_pts": 0.8, "skew_direction": "steeper",
    "regime_changed": false, "regime_from": null, "regime_to": null,
    "refreshed_at_utc": "2026-09-22T00:23:00Z"
  },
  "tiles": {
    "regime": {"label":"Overheating","print":"Aug","growth":"rising","inflation":"rising","months_in":3},
    "recession": {"prob":0.12,"band":"low","inputs_through":"2026-05"},
    "trend": {"above_50":true,"above_200":true,"since":"2025-07-01","since_signal":"golden-cross","since_verdict":"reliable"},
    "vol": {"vix":16.2,"date":"2026-09-22","realized_20d":11.9,"gap_pts":4.3}
  },
  "active_signals": [ /* Ledger rows (12.4) filtered: firing_now OR top 5 by last_fired */ ],
  "monitored": [ /* Position rows (12.7 compact) */ ]
}
```

### 12.2 `GET /study` — the event study
Params: `shock`, `window` (5|10|20|60), `move` (up2s|down2s|cross_above|cross_below),
`while` (none|spx_below_50|spx_above_50|regime:<name>), `target`, `horizon`
(5|10|20|60), `confidence` (0.80|0.90|0.95, default 0.90), or `preset=<slug>`.
Preset slugs: `gold-2sigma-spx-weak`, `golden-cross`, `death-cross`,
`vix-spike-2sigma-5d`, `hy-2sigma-20d`, `10y-2sigma-20d`, `dollar-2sigma-20d`,
`oil-2sigma-gold`, `spx-2sigma-10y`.
```json
{
  "as_of":"2026-09-22","generation_id":"…","inputs_hash":"f80f53b8d728b86c",
  "served_from_cache":true,"elapsed_ms":300,
  "slug":"gold-2sigma-spx-weak","question":{"shock":"gold","window":20,"move":"up2s","while":"spx_below_50","target":"spx","horizon":20},
  "n_events":18,"sample_start":"2000-01-03","firing_now":false,"last_event":"2025-04-16",
  "verdict":"suggestive","headline":"Leans positive a month out, but not something to size on.",
  "why":"18 events clears the floor, but the resampled range still crosses zero at every horizon — about 9% of resamples come out negative at a month, against a 3% bar.",
  "horizons":[
    {"h":5,"label":"1 week","up_pct":0.61,"median":0.012,"baseline_median":0.003,"ci_lo_pts":-0.8,"ci_hi_pts":2.4,"verdict":"suggestive"},
    {"h":10,"label":"2 weeks","up_pct":0.61,"median":0.016,"baseline_median":0.006,"ci_lo_pts":-0.6,"ci_hi_pts":2.9,"verdict":"suggestive"},
    {"h":20,"label":"1 month","up_pct":0.67,"up_n":12,"median":0.031,"baseline_median":0.013,"ci_lo_pts":-1.6,"ci_hi_pts":4.1,"verdict":"suggestive","worst":{"ret":-0.094,"date":"2020-03-09"},"best":{"ret":0.120,"date":"2025-04-16"}},
    {"h":60,"label":"3 months","up_pct":0.56,"median":0.029,"baseline_median":0.036,"ci_lo_pts":-3.9,"ci_hi_pts":2.6,"verdict":"no_edge"}
  ],
  "confidence":0.90,
  "confidence_note":"All four include zero at 90%. At 80% the 1-month range clears zero; at 95% none do.",
  "by_regime":[{"regime":"Goldilocks","n":5,"up_pct":0.80,"median":0.042},{"regime":"Overheating","n":6,"up_pct":0.67,"median":0.028},{"regime":"Stagflation","n":5,"up_pct":0.60,"median":0.019},{"regime":"Recession Risk","n":2,"up_pct":null,"median":null}],
  "last_events":[{"date":"2025-04-16","regime":"Overheating","ret_20":0.120},{"date":"2023-10-27","regime":"Stagflation","ret_20":0.081}, "…"],
  "without_condition":{"n_events":41,"up_pct":0.58,"median":0.016,"verdict":"no_edge"},
  "provenance":{"bootstrap":10000,"entry":"next session","cooldown":20,"series_start":{"gold":"2000-01-03"}},
  "warnings":[]
}
```
`n_events < 10` → `verdict:"insufficient"`, `horizons:[]`, and
`empty_state:{"sentence":"…","fixes":["widen_window","drop_condition"]}`.
Changing `confidence` recomputes `ci_*`, per-horizon `verdict`, and the
top-level `verdict`. All nine presets are precomputed on refresh and cached by
`inputs_hash`; `served_from_cache` reports it.

### 12.3 `GET /study/events?…` — same params, returns the event list (CSV when `Accept: text/csv`).

### 12.4 `GET /ledger`
```json
{"as_of":"…","generation_id":"…","normal_month":0.013,
 "signals":[
  {"slug":"2s10s-2sigma-steepening","label":"2s10s +2σ steepening","group":"cross","last_fired":"2026-09-09","n":22,"up_pct":0.45,"median":-0.006,"vs_normal_pts":-1.9,"verdict":"no_edge","firing_now":true,"firing_day":10},
  "… all 12"
 ]}
```
Sorting is the client's job (firing first, then verdict order Reliable >
Suggestive > No edge). `group` ∈ `spx` | `cross`.

### 12.5 `GET /regime`
```json
{"as_of":"…","current":{"label":"Overheating","print":"2026-08","growth":"rising","inflation":"rising","months_in":3,"since":"2026-06"},
 "history":[{"month":"2021-01","regime":"Goldilocks"},"…"],
 "recession":{"prob":0.12,"inputs_through":"2026-05","year_ago":0.09,"peak":{"prob":0.71,"month":"2020-03"}},
 "stats":[{"regime":"Goldilocks","months":142,"spx_mo":0.014,"up_pct":0.66,"vix_avg":15,"stock_bond_corr":-0.2},"…"],
 "next_prints":{"cpi":{"date":"2026-10-14","flip_threshold_mom":0.002,"flips_to":"Goldilocks"},"indpro":{"date":"2026-10-17","flip_threshold_mom":0.0,"flips_to":"Stagflation"}},
 "changes":[{"month":"2026-06","from":"Goldilocks","to":"Overheating","spx_1m":0.021},"… last 5"]}
```

### 12.6 `GET /macro`
```json
{"as_of":"…",
 "curve":{"today":{"3m":4.05,"2y":3.80,"5y":3.95,"10y":4.21,"30y":4.62,"date":"2026-09-22"},"month_ago":{"…":"…"},"2s10s_bp":41,"2s10s_chg_bp":9,"10y_chg_bp":-6},
 "stock_bond":{"today":0.31,"year_ago":-0.24,"flipped":"2026-03","series":[{"date":"…","corr":0.1},"… 252 pts"]},
 "credit":{"hy":3.12,"hy_pct_3y":0.18,"hy_range_3y":[2.6,5.9],"ig":0.94,"series":[{"date":"…","hy":4.6},"… 252 pts"],"peak_12m":{"date":"2025-03-12","hy":4.6}},
 "correlations":[{"asset":"10y Treasury (price)","corr":0.31,"meaning":"moves with · no hedge"},{"asset":"Gold","corr":0.12,"meaning":"no relationship"},"…6 rows"],
 "matrix":{"assets":["spx","ndx","10y","gold","dxy","wti","hy","vix","…12"],"window":60,"values":[[1,0.92,"…"]]}}
```

### 12.7 `GET /sectors`
```json
{"as_of":"…","window_months":3,
 "leadership":[{"etf":"XLK","name":"Technology","rel_ret":0.061},"… 11 sorted desc"],
 "pattern":"cyclical",
 "breadth":{"above_50":{"n":7,"of":11,"month_ago":10,"by_etf":{"XLK":true,"…":false}},"above_200":{"n":9,"of":11,"by_etf":{}},
            "eqw_vs_cap_3m":-0.024,"eqw_vs_cap_series":[{"date":"…","rel":0.02},"… 252"],"small_vs_large_series":["… 252"]}}
```
Requires tier-2 series XLK XLI XLF XLC XLY XLE XLB XLRE XLV XLP XLU RSP IWM
(Yahoo). Adding them is config in `desk_history.py` — **B does not do this
overnight**; it is a Thursday task. Until then this endpoint returns
`{"error":"series not ingested","missing":[...]}` and the tab shows Awaiting
refresh.

### 12.8 `GET /positions` and `POST /positions`
Compact row: `{"id","name","instrument","direction","size_nav":0.04,"room_pct":0.68,"to_level":{"value":3.4,"unit":"%"},"opened":"2026-09-02","horizon_days":20,"day":14}`.
Expanded adds `falsifies_at`, `now`, `dv01`, `variant`, `pre_mortem`,
`red_team`, `study_slug`. `closed_90d:{"falsified":4,"expired":6,"premortem_right":[2,4]}`.
POST body = the Promote form; server rejects certainty words with
`{"error":"wording","words":["will"]}` and an incomplete gate with
`{"error":"gate","missing":["level"]}`. Positions persist server-side in the
existing store (positions are not localStorage).

### 12.9 `GET /vol` — Technicals vol card
`{"as_of","source":"eodhd","skew_25d_1m_pts":6.8,"skew_pct_2y":0.74,"skew_trend":"rising since June","atm_iv_1m":15.4,"realized_20d":11.9,"term":{"1m":15.4,"3m":16.8,"6m":17.5},"history_from":"2023-10"}`.
Depends on the EODHD relay storing skew / ATM IV / put IV / call IV as tier-2
derived series. Not in B's overnight scope; until wired the card shows
Awaiting refresh.

### 12.10 `GET /technicals`
`{"as_of","price":6412,"chg_1d":0.004,"ma50":6280,"ma200":5910,"ret_1y":0.142,"trend":"up","move_20d_sigma":0.6,"rsi":58,"rsi_last_above_70":{"date":"2026-06-12","spx_1m":0.011},"rsi_last_below_30":{"date":"2025-04-08","spx_1m":0.094},"cross":{"kind":"golden","date":"2025-07-01"},"series":{"6m":[…],"1y":[…],"3y":[…]}}`.
Signals rows come from `/ledger` filtered to `group:"spx"`.

### 12.11 `GET /pipeline`
Series inventory grouped, from the pipeline config: `{"last_refresh_utc","validation":"passed","groups":[{"name":"Rates","source":"FRED","freq":"daily","status":"current","series":[{"label","id","from","as_of","feeds":[],"status","note"}]}]}`. Plus `GET /pipeline/ddl` (text) and `GET /study/events` CSV for the two buttons.

### 12.12 `GET /basket/:id`, `POST /basket/price`, `GET /hedge?…` — only if Basket & Hedge ships. Shapes to be added to this file before B touches them.

---

## 13. Build order and acceptance

Tab order for A: Overview → Technicals → Event Study → Regime → Macro →
Sectors → Ledger → Position Monitor → Data Pipeline → Build Notes → Client
toggle. Basket & Hedge last, only if everything else is green.

Per tab: build from the PNG + this section; run against the fixture for that
endpoint; screenshot at 1440 wide; compare to the PNG; verifier; commit
`frame-3: <tab>`. If the screenshot does not match after two attempts, stop
that tab, write why in `docs/desk/FRAME3_REPORT.md`, and move to the next.

Acceptance for the branch: all eleven tabs render from fixtures; every number
on screen traces to a field in §12; no color outside §1.3; no "established" /
"significant"; typecheck, unit, build, Desk browser tests green.
