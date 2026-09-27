# DESK_FRAME3_SPEC.md — Desk v2 build contract

Status: approved mockups locked 2026-09-23; the adjudicated amendments v2, v3
and v4 (2026-09-24/25, precedence v4 > v3 > v2) are folded in here on
2026-09-25, with the three clarifications of the final review (C-01 to C-03).
The amendment files are kept, unedited, in `docs/desk/archive/` for the
history; this file is the only contract. Where a sentence of an amendment was
withdrawn by a later one, it is not repeated here.

**Governing rule (v2 §0).** The engine wins. §12 describes what
`src/desk/event_study.py`, `src/regime.py`, `src/analytics/recession.py` and
`api/` compute today, the projections and new calculations §13 authorizes,
and the counts, dates and units needed to display them honestly. A field the
engine cannot produce is served as an explicit **unavailable** state, never as
an illustrative number, and Build Notes lists it under "Designed, not yet
served". When this file and a PNG disagree, the PNG wins for layout and this
file wins for numbers, labels and API shape (v2 §20, D-35). Every
illustrative number below is the mockup's; the build renders what the API
returns.

Three sessions consume this file:
- **A (desk/frame-3, `web/` and `docs/desk/`)** builds the eleven tabs and the
  Client toggle against fixtures in the §12 shapes.
- **B (desk/frame-3-api, `api/`, `src/desk/`, `scripts/`)** builds the nine
  endpoints in §12, in §13's order.
- **C (desk/frame-3-docs, `docs/desk/` only)** audits what the store can
  produce (`FRAME3_DATA_AUDIT.md`).

Neither A nor B changes §12 without writing the change into this file first.

---

## 1. Scope and site-wide rules

### 1.0 Scope for Monday: live and unavailable

| Tab / block | Monday state | Reason |
|---|---|---|
| Overview: since-last-close line, regime tile, recession tile, trend tile, VIX level, active signals, data status | LIVE | — |
| Overview: VIX "gap vs realized" and the vol band word | LIVE (desk/fill-compute) | the S&P's 21-day realized volatility (`src/analytics/technicals.realized_vol`) and the home page's VIX words (§12.1 `tiles.vol`) |
| Overview: Monitored rows | LIVE from the browser's position store (§9) | no server position store (v2 D-21) |
| Technicals: price, 50- and 200-day averages, trend, cross, chart, 1-year return, day change, last 20 days in σ, signals (the §3 allowlist) | LIVE | — |
| Technicals: vol column ("What protection costs right now") | UNAVAILABLE | needs stored SPY option snapshots and a versioned skew method (v2 D-17) |
| Technicals: sector bars | LIVE (desk/fill-etf): the eleven sector ETFs' 60-session log returns less SPY's, `/technicals` `sectors` (§12.14) | — |
| Technicals: RSI card | LIVE (desk/fill-compute) | Wilder's RSI(14) on the stored ^GSPC closes, `src/analytics/technicals.rsi` (the shared, symbol-agnostic copy) (§12.7) |
| Technicals: MACD card | LIVE (desk/fill-compute) | MACD(12, 26, 9) on the stored ^GSPC closes, `src/analytics/technicals.macd` (the shared, symbol-agnostic copy) (§12.7 `macd`) |
| Technicals: seasonality card | LIVE (desk/fill-compute) | each calendar month's average return and share of years up over every stored ^GSPC close, `src/analytics/technicals.monthly_seasonality` (the shared, symbol-agnostic copy) (§12.7 `seasonality`) |
| Event Study: studies in the catalog (§4, §12.3) | LIVE when every input's coverage is stored in the current generation; otherwise that study is awaiting with the missing series named | v3 §2 |
| Event Study: any other combination of slots | refused, 422 `unsupported` | v3 §2 |
| Event Study: confidence 80% / 95% | UNAVAILABLE; intervals are the engine's 90% | interval projection at other quantiles is new plumbing (v3 §8, A-16) |
| Event Study: the line without the condition (`without_condition`) | UNAVAILABLE | conditional-versus-unconditional comparison is not defined (v4 B-11, C-01) |
| Regime: current label, history strip, recession score, next prints | LIVE | — |
| Regime: "What each regime has meant" table, and the S&P a month after each change | LIVE (desk/fill-compute) | FRAME3_DATA_AUDIT.md §2.4's method: every stored row, as stamped, with its own calendar month of the S&P and the VIX (§12.6 `stats`, `changes`) |
| Macro: yield curve | LIVE with 2y, 10y and 2s10s; 3m, 5y and 30y LIVE once DGS3MO, DGS5 and DGS30 are registered (§12.8) | v2 D-16 |
| Macro: HY and IG levels, HY 3-year range and percentile, HY last 12 months | LIVE (the 3-year figures null, with the reason, while three-year coverage is incomplete) | v3 §12, v4 B-07 |
| Macro: stock–bond correlation (SPY against TLT, 60 daily log returns) | LIVE (desk/fill-etf, §12.8) | — |
| Macro: "What moves with the S&P" (TLT, IEF, HYG, LQD, GLD, UUP, IWM, QQQ and VIX against SPY) | LIVE (desk/fill-etf, §12.8) | — |
| Macro: the 12-asset matrix | UNAVAILABLE | the 12-asset matrix's assets and method are not specified yet |
| Sectors: leadership (LEADING, LAGGING, PATTERN, the eleven bars) | LIVE (desk/fill-etf, §12.14) | — |
| Sectors: breadth, of the 11 sector ETFs (above the 50- and 200-day, RSP against SPY, IWM against SPY) | LIVE (desk/fill-etf, §12.14) | — |
| Sectors: constituent-level breadth (the stocks inside the index) | UNAVAILABLE | constituent data is not ingested |
| Signal Ledger | LIVE for the rows whose study completes, the two RSI rows included (desk/fill-compute); any row whose inputs are not stored (WTI, DXY) unavailable | v3 §2, v4 B-02 |
| Position Monitor | LIVE, stored in the browser; automatic room only for the S&P against its 50-day and for 2s10s against a bp level; everything else manual; DV01 null | v3 §16, v4 B-10 |
| Basket & Hedge | UNAVAILABLE; local leg editing (legs, weights, save, export) remains | basket pricing and option structures not yet defined in the engine (v2 D-25–D-28) |
| Data Pipeline | LIVE, inventory from the registry | v2 D-33 |
| Build Notes | LIVE (the authored file, plus the list in §1.0.1) | — |
| Client view | LIVE for Event Study's current study, at h = 20 | — |

#### 1.0.1 The Build Notes list

Build Notes prints these two lists as their own section, word for word.

**Live**
- Overview: since the last close, the regime, the recession score, the S&P trend, the VIX level, its band word and its gap to the S&P's 21-day realized volatility, active signals, data status.
- Technicals: the S&P price, the day's change, the 1-year return, the last 20 days in σ, its 50- and 200-day averages, trend, the latest cross, the chart, the scored signals, sector leadership, the 14-day RSI, MACD (12, 26, 9) and its last crossover, the average return and share of years up for each calendar month.
- Event Study: every catalog study whose inputs are stored, at 5, 10, 20 and 60 sessions, at the engine's 90% interval.
- Regime: the label, the five-year strip, the recession score, the next CPI and industrial-production prints, what each regime has meant since 1996, the last five regime changes and the S&P the month after each.
- Macro & Correlations: the yield curve, the credit spreads, whether bonds still hedge stocks, and what moves with the S&P.
- Sectors: the eleven sector ETFs against SPY over 60 sessions, ranked, and the pattern by its rule; breadth of the 11 sectors, equal weight against cap weight, small caps against large.
- Signal Ledger: the twelve fixed signals, each scored when its study completes.
- Position Monitor: positions kept in this browser, with room for the S&P against its 50-day and for 2s10s.
- Data Pipeline: the series inventory, generated from the registry.
- Client view: the current study in plain words, a month out.

**Designed, not yet served**
- What protection costs: options skew, implied against realized volatility, the term structure.
- Constituent-level breadth: the stocks inside the index, not the 11 sector ETFs.
- Confidence levels other than 90%.
- The comparison with the study's condition dropped.
- The 12-asset correlation matrix.
- Positions kept on a server, and DV01.
- Basket pricing, the residual chart and the hedge structures.

#### 1.0.2 The unavailable state

A card whose block is unavailable keeps its title, subtitle and stat labels.
Its body prints one sentence: the served `unavailable.reason`, and, when
served, "Until: <`unavailable.until`>". No number, no chart, no gauge. Its
`Advanced ▸` control is disabled and says "not yet served". Its badge reads
`○ Not yet served` (`○ Awaiting refresh` when the reason begins "Awaiting
refresh", §1.7). A block that is unavailable by §1.0 but has no served
envelope prints the reason in §1.0's table (the confidence chips).

### 1.1 Navigation
- The sidebar is the ONLY navigation. No top tab strip. Width 176px, background #0f1216.
- Header of the sidebar: `← MACRO REGIME RADAR` (mono, 10px, links to the Radar root),
  then `Desk` (serif 26px) over `ANALYST WORKSPACE` (mono 9.5px, letter-spaced).
- Three groups, mono 9.5px uppercase labels:
  - **SURVEY**: Overview, Technicals, Regime, Macro & Correlations, Sectors
  - **ACT**: Event Study, Signal Ledger, Position Monitor
  - **TOOLS**: Basket & Hedge, Data Pipeline, Build Notes
- Active item: background #1b2027, white text. Others #c9cdd3.
- Bottom of the sidebar, two stacked cards (border #262b33, radius 10px):
  - **TODAY**: the regime (serif 18px, in its regime color, §1.3) with
    `regime · <Mon> row` beneath (the K−2 row governing today, §5; e.g.
    "Overheating · Jul row"); then `S&P <day> +0.4%` from `/technicals`
    `chg_1d` and its `chg_1d_dates.to` ("today" only when that day is New
    York's today); then `Data ● <state>` from `/overview` `data_status`.
  - **HOUSE DISCIPLINE ▸**: `Gate ● on`. Click opens the gate text (§9).
- Page header, every tab: breadcrumb `Radar › Desk › <Tab>` (mono 11.5px, gray)
  left; right side the Desk / Client segmented toggle on the tabs in §11's
  allowlist, and at most one action button (listed per tab).
- The page footer shows the one `generation_id` the page's responses share
  (the Client view prints `Snapshot · <as_of>` instead, §11). If two
  responses on a page carry different ids, the page badge reads "mixed
  generations · refreshing" and the client refetches once (v3 §18).

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
| blue | #58b8e6 | the main line on any chart · event bars |
| gray | #8b929e | No edge · Too few · quiet · second line · baseline bars · neutral |

Neutrals: page #0c0e11, sidebar #0f1216, card #12161b / #151920, card border
#262b33, row divider #1c2027, box border #2a3038, text #e8e6e1 / #c9cdd3 /
#8b929e / #6b7280. Verdict pill tints: Reliable bg #0f1a16 border #1f6b52;
Suggestive bg #1a160f border #5a4a1e; No edge bg #171a1f border #2a3038; Too
few the No edge tint with a dashed border. No purple. No other accent.

**The one exception (v2 D-36): regime colors.** Goldilocks green, Overheating
amber, Stagflation red, Recession Risk gray, wherever a regime is named.
**Chart colors:** main line blue, 50-day green, 200-day gray dashed, event
bars blue, baseline bars gray. Positive bars extend right, negative left.

### 1.4 Card skeleton (every card on every tab follows this)
1. Title (bold) + subtitle (gray) on one line.
2. Stat row: 2–4 stats, each = mono label / serif number / gray sub-line.
3. Body: chart, list, or table.
4. Boxed read: `Read:` or `Read for the desk:` in a #12161b box with a #2a3038
   border, 12px, one or two sentences, only when a served `reads.<card>`
   exists (§12.0, v2 §15). Amber-bordered when its `tone` is `warning`. No
   read is served on Monday; the box is omitted.
5. Footer: `Advanced ▸` (blue link) + gray list of what expands, and/or an
   action link `→`. An Advanced control is enabled only when the endpoint it
   opens exists in §12; otherwise it is disabled and says "not yet served"
   (v2 D-34). Footer text promises no counts or history ranges.

### 1.5 Verdicts (never "established", never "significant")

Rule `verdict_rule: "v1"`, fixed at the engine's 90% exclusion
(`verdict_confidence: 0.90`), evaluated for one horizon h in this order
(v3 §7):
1. `n(h) < 10` → `insufficient`.
2. the engine's exclusion at h is `established` → `reliable`.
3. the finite excess medians (median − baseline_median) at h = 5, 10 and 20
   are all strictly positive, or all strictly negative → `suggestive`.
4. otherwise → `no_edge`.

Any engine result other than `established` counts as not established,
including `included` and an unavailable exclusion. Zero is not a lean; a
missing horizon's excess median is not a lean. The confidence selector never
touches a verdict (§4, §12.13).

Which horizon (v4 B-01): `/study`'s `verdict`, `headline`, `why`, counts and
`empty_state` are the selected horizon's (`selected_horizon`); the Ledger,
the Overview's active signals and the Client view use h = 20 explicitly.
Every summary carries its horizon; a verdict from one horizon never sits
beside another horizon's statistics.

Pills and copy (v4 B-13). The Overview and Ledger footers print exactly:
- **Reliable** (green pill) — at least ten overlap blocks, with the engine's
  90% interval and adverse-share requirements met; zero counts as adverse.
- **Suggestive** (amber pill) — 10+ completed outcomes; excess medians lean
  the same way at 5, 10 and 20 sessions, but not all Reliable criteria are
  met.
- **No edge** (gray pill) — at least ten completed outcomes at this horizon,
  without Reliable evidence or a consistent nonzero excess-median sign across
  5, 10 and 20 sessions.
- **Too few** (dashed gray pill) — fewer than ten completed outcomes at this
  horizon.

"vs normal" is each study's own excess over its own baseline (§1.9); there
is no universal normal month.

### 1.6 Live badges
A card that reads live data carries `● Live · <source> · <date>` (green dot,
mono 10px) top-right, dating only what it covers; a separately dated block
carries its own date (v2 D-36). An unavailable card carries `○ Not yet
served`, or `○ Awaiting refresh` when its served reason begins "Awaiting
refresh" (§1.7). The `MOCKUP · values illustrative` amber badge is NOT built.

### 1.7 Empty, busy and awaiting states
- `computing` (202): the card stays quiet and busy while the client polls.
- A list whose rows the response boundary could not read says so ("1 row could
  not be read."; event, series, month, sector … as fits), and nothing is
  counted or called empty from the rows that are left (Codex round 2, R-16).
  A count read from rows (the Ledger's Firing now, Reliable, No edge, and
  Signals scored when `scored_n` is not served) says "Awaiting refresh" when a
  field it counts is missing on any row, never a number (Codex round 3, R-21).
- A study whose selected horizon has fewer than ten completed outcomes is
  `insufficient`: the answer card prints the served `empty_state.sentence`
  and the served `fixes` as chips (each only when it leads to a catalog
  study). No chart.
- A block whose answer failed or did not arrive: "Awaiting refresh" (gray),
  labels kept, no number.
- A block served `awaiting` whose reason begins "Awaiting refresh" (§12.0: the
  server could not compute it from the current generation) badges
  `○ Awaiting refresh` and prints its reason; every other awaiting block
  badges `○ Not yet served` (§1.0.2). The sidebar's TODAY card says "awaiting
  refresh" for the first and "not yet served" for the second.
- An unavailable block: §1.0.2.
- A value is rendered with a date only when the date arrives in the same
  response as the value, at the series' own frequency.

### 1.8 Storage
Saved questions, baskets and positions live in `localStorage` per browser,
each under a versioned key with an Export / Import JSON control. No accounts.
Positions are validated on save, on import and on load; a record that fails
is kept in an "unreadable" list the page shows, never dropped (§9). While one
is kept, no total and no empty state is drawn from the readable records alone
(Codex round 2, R-16).

### 1.9 Units and display
- `question.target_unit` ∈ `log_return` | `log_change` | `bp`;
  `question.display_unit` ∈ `percent` | `bp` (v2 §6).
- Display (v3 §6, main's `fmt_move`): `log_return` and `log_change` print as
  `100 × native` with a % sign, labelled as log-return percentages; any such
  number carries the tooltip "log return, ×100". `bp` prints unchanged. No
  exponentiation anywhere; simple-return display is a later decision.
- `vs_normal` = `100 × (median − baseline_median)`, in log percentage points
  ("+1.8 pts"), or the native difference in bp ("+6 bp").
- Intervals: `ci_lo` and `ci_hi` bound Δ = event median − baseline median, in
  native units. The chart's whisker runs from `baseline_median + ci_lo` to
  `baseline_median + ci_hi`, then takes the same linear display scale.
- "Up" always means a target change > 0, yields and spreads included.
- Scope of the log rule (v4 B-04): only fields whose `target_unit` is
  `log_return` or `log_change`. Technicals' `chg_1d`, `ret_1y`, `vs_ma50` and
  `vs_ma200` are simple-return or level-ratio fractions and print as
  fraction × 100.
- JSON carries full precision; one display-rounding rule lives in the UI kit.

### 1.10 Dates and samples
- `as_of` is the New York date the generation was staged (§12.0), never an
  observation's date.
- Every live block carries `date` (session `YYYY-MM-DD`), `month` (`YYYY-MM`)
  or `ts` (RFC 3339 with zone) beside its values, plus `freq` ∈ daily |
  weekly | monthly and `source`. A composite statistic carries `window:
  {start, end, n}`. A scheduled release is `release_date`, distinct from an
  observation.
- Three study dates, never conflated (v2 §10, v3 §10): `data_start` (the
  latest of the inputs' first stored observations), `sample_start` /
  `sample_end` (the engine's evaluable boundaries), `first_event` /
  `last_event` (nullable). Provenance reads "history from <data_start>"; a
  count reads "<n> events since <sample_start year>". No 1990 or 2000
  constant appears in the UI.
- A comparison caption names the served comparison date ("was 10 on
  <date>"), never a month's name ("in July") (v2 D-35).

---

## 2. Overview  (`screens/01-overview.png`, 960px)

Action button: **Walkthrough** (the first-visit walkthrough, from frame-2).

**Since-last-close line** (full width, box style): `SINCE LAST CLOSE` mono
label, then, separated by `·`: each new fire with `(new)` in green; each
signal still firing with its `firing_day`; the VIX change in points
(`vol_change_pts`); `regime unchanged` or `regime changed → <regime_to>`;
`data refreshed <time> UTC` (`refreshed_at_utc`). Only signals evaluated on
`comparison_session` appear (§12.5). From `/overview` `since_last_close`.

**Four tiles** (equal width):
| Tile | Badge | Big value | Sub-line |
|---|---|---|---|
| REGIME | `● Live · <Mon> row` | Overheating (regime color, serif 26px) | Growth rising, inflation rising · rule-based, two-month lag |
| RECESSION · LOGISTIC MODEL | `● Live` | 12% | <band> · score for <probability_month> · inputs through <inputs_through> |
| S&P 500 · TREND | `● Live · <date>` | Above 50 & 200 (from `trend.state`) | since <state_since> · last cross <golden\|death>, <date> |
| VOL · VIX | `● Live · <date>` | 16.2 | VIX <level> · <date> · <band> (calm, subdued, stressed), then "<\|gap_pts\|> pts above\|below 21-day realized (<realized_21d>)", with "on <gap.date>" when that is not `date`; "no session has both the VIX and 21 S&P returns" when `gap` is null |

**Active signals** (left, ~60%). Subtitle `what fired, how it has played out
before · engine as of <as_of>`. Rows are `/overview` `active_signals` in the
served order (§12.1: the deduplicated union of every firing row and the five
latest non-null `last_fired`, firing first, then `last_fired` descending, then
slug). Row: `label` (bold) + `last fired <date>`; sentence `Fired N× since
<sample_start year> · S&P up P% of the time · 20-day median +M% (+D vs
normal)`; the h = 20 verdict pill right. Footer: the four §1.5 definitions +
`Full Signal Ledger →`.

**Monitored** (right). Subtitle `how far each is from being wrong · live`.
Rows from the browser's position store (§9), sorted by `room_pct` ascending,
null last, then id; row = name · `N% NAV` · `P% room · X to level` (green if
room ≥ 50%, amber if < 30%) · bar · `▸`; a manual position prints "manual"
in the room cell and an empty bar. Footer `Sorted by room left · same scale
for every trade · size as % of NAV · click a row for the gate text`. While a
kept record cannot be read (§1.8), the rows carry "<n> kept position(s) could
not be read." and no rows read "No readable position is monitored; <n> kept
position(s) could not be read." Button **Act on this → Position Monitor**.

---

## 3. Technicals  (`screens/02-technicals.png`, 1060px)

Action button: **Act on this → Position Monitor**. Badge `● Live · <date>` from
`/technicals` `date`.

Grid: left column (two rows) = the vol column; top-middle = price; top-right =
Signals; bottom-middle = Sector leadership; bottom-right = RSI; a third row
(desk/fill-compute) = MACD across the vol column and the middle, seasonality
on the right.

**What protection costs right now** (vol column): UNAVAILABLE (§1.0), from
`/technicals` `vol` (awaiting). Labels kept: PUTS vs CALLS · 1 MONTH OUT ·
WHAT OPTIONS EXPECT vs WHAT HAPPENED · 1 MONTH · 3 MONTHS · 6 MONTHS · SKEW ·
WHERE IT SITS.

**S&P 500 — price and its two trend lines**. Range chips 6M / 1Y / 3Y. Stats:
PRICE (`price`; sub `chg_1d` × 100 "on <chg_1d_dates.to>") · 50-DAY AVERAGE
(`ma50`; "price is <vs_ma50 × 100>% above|below") · 200-DAY AVERAGE (`ma200`;
same with `vs_ma200`). Chart: close (blue), 50-day (green), 200-day (gray
dashed) from `series`; y ticks round thousands; each line labelled at its
right end; a white dot at the last close. Callout: "<cross.date> — the 50-day
crossed <above|below> the 200-day." followed by the matching Ledger row's
count, up share and h = 20 verdict.

**Signals** card. Stats: 1-YEAR RETURN (`ret_1y` × 100, dated
`ret_1y_dates`) · TREND (`trend.state` in words: above both / below both /
mixed; since `state_since`) · LAST 20 DAYS (`move_20d_sigma`σ). Rows: the
Ledger rows in `signals_allowlist` order — golden-cross, death-cross,
rsi-above-70, rsi-below-30, spx-20d-2sigma, spx-5d-2sigma —
each `label · N× since <sample_start year> · up P% · a month later +M% ·
pill`. Note box: "vs normal compares each study to its own baseline over its
own sample."

**Sector leadership · 3-month relative strength vs S&P**: LIVE (desk/fill-etf),
from `/technicals` `sectors` (§12.14). Sub-line: the served ranking's two ends
named ("<first> and <second> leading; <tenth> and <eleventh> lagging"). Bars:
seven of the eleven (the top three, the middle one, the bottom three), each
`rel_ret` × 100 with the tooltip "log return, ×100" (§1.9), green above
+`band`, red below −`band`, gray within; all eleven under Advanced. A stamp
under the bars: "60 sessions to <window.end> · log returns ×100 ·
<providers>". A row served null prints "not available · <reason>". A
sector without `rel_ret` is never hidden (Codex R-01): its row follows the
seven, the sub-line adds ", among the <ranked_n> sectors with data", and
the note of §7 names it with its reason.

**Momentum · RSI** (desk/fill-compute), from `/technicals` (§12.7). Badge
`● Live · <rsi_date>` (the RSI's own session, §1.6). Stats: NOW (`rsi`, one
decimal; sub-line its zone and direction: "overbought" strictly above 70,
"oversold" strictly below 30, "neutral" otherwise, then "rising", "falling" or
"flat" from `rsi` against `rsi_prev`, the two served numbers and nothing
else) · LAST ABOVE 70 and LAST BELOW 30 (each zone's last session,
`rsi_last_above_70.date` and `rsi_last_below_30.date`; sub-line "S&P
<after_20d> 20 sessions later", or "20 sessions have not passed yet" while
`after_20d` is null). Gauge 0 · 30 · 70 · 100 with the bands
Oversold (green) · Neutral · Overbought (amber) and the needle at `rsi`. A null
`rsi` keeps the labels and says "Awaiting refresh", with no gauge. PNG 02's
two context boxes are not drawn: no read is served (§12.0).

**Momentum · MACD** (desk/fill-compute), from `/technicals` `macd` (§12.7).
Title "Momentum · MACD", sub "12, 26, 9 on the S&P's closes". Badge
`● Live · <macd.date>` (its own session, §1.6). Stats: MACD (`macd.macd`, one
decimal, index points) · SIGNAL (`macd.signal`) · HISTOGRAM (`macd.hist`,
signed, green above zero and red below; sub-line "MACD above its signal" or
"below its signal") · LAST CROSSOVER (`macd.last_cross.date`; sub-line
"MACD crossed above its signal" or "below" from `last_cross.kind`). Chart,
`macd.series` (the price chart's 6M sessions): the histogram as bars from zero
(green above, red below), the MACD line (blue) and the signal line (gray
dashed), a zero line, month ticks, a marker on the last crossover when it is
in range. A null `macd` keeps the labels and says "Awaiting refresh", with no
chart. No read of what the crossover means is served, so none is printed.

**Seasonality · S&P 500 by calendar month** (desk/fill-compute), from
`/technicals` `seasonality` (§12.7). Sub-line: "Average monthly return and
share of years up, <window.start> to <window.end>." (months written "Feb 1990").
A table of the twelve months in calendar order, one row each: MONTH (`label`)
· AVERAGE (`avg` × 100, signed, one decimal) · a bar from a center zero line,
green right for a positive average and red left for a negative one, its
length `|avg|` over the largest `|avg|` of the twelve · UP (`pct_up` × 100,
whole percent) · YEARS (`n`, with `first_year`–`last_year` in its tooltip).
Foot: "<fewest n>–<most n> years a month · a month counts once it is
complete" and the source line. A null `seasonality` keeps the labels and says
"Awaiting refresh". No read is served, so none is printed.

---

## 4. Event Study  (`screens/03-event-study.png`, 1080px)

Action button: **Act on this → Position Monitor**. Subtitle: `Ask what the
market did after a defined shock. Get a scored answer, not an opinion.`

**Row 1 — Pick a question.** Three-way switch: `Common questions` / `My saved
questions · N` / `Build your own`. Hint "pick one below, or build your own in
the slots — either way the slots show exactly what is being asked". Nine
preset chips, each the catalog `label` of: gold-2sigma-spx-weak ·
golden-cross · death-cross · vix-spike-2sigma-5d · hy-2sigma-20d ·
10y-2sigma-20d · dollar-2sigma-20d · oil-2sigma-gold · spx-2sigma-10y. A
chip whose study is unavailable is disabled with its reason. Saved questions
render as chips under `Yours`.

**Row 2 — THE QUESTION, SPELLED OUT.** Sub-label "change any slot and it
becomes your own". Six labelled slots: SHOCK (series) · WINDOW (5 / 20 / 60
sessions; none for a cross or an RSI crossing) · MOVE ⓘ (up 2σ or more /
down 2σ or more / 50-day crosses above the 200-day / crosses below / RSI
crosses above 70 / RSI crosses below 30; tooltip "σ measured over the last
252 sessions") · WHILE ⓘ (none / S&P below its 50-day / regime = X;
tooltip "Entry at the event close when every input is available by then;
otherwise the next close.") · WHAT HAPPENS TO (series) · OVER THE NEXT (1 week
/ 2 weeks / 1 month / 3 months). Every option that does not lead to a catalog
study (§12.3), given the other slots, is disabled; a cross or an RSI
crossing requires shock = S&P, target = S&P, while = none and no window. Series labels, roles and ops
come from `/study` `series[]`. Buttons **Run** (primary) and **Save**. A
request the server refuses (422 `unsupported`) prints the served message.

**Answer card** (left, ~62%), all for `selected_horizon` (the OVER THE NEXT
slot). Headline (serif 17px): the served `headline`. Pills `○ Not firing today
· last <last_event>` (or `● Firing today · day <firing_day>`; `○ Stale ·
<evaluated_on>` when `stale`, never "firing today"; nothing when `firing_now`
is null) and `● Live · <elapsed> <cached>` from
`served_from_cache` and `elapsed_ms`. Four stats: EVENTS `matched_n` with the
sub-line "<n> complete at <horizon label>" (C-03) · UP <H> LATER `up_pct`
("<up_n> of <n>") · MEDIAN AT <H> `median` ("vs <baseline_median> in a normal
<stretch>") · WORST · BEST (with their `event_date`s). Bar chart, four
horizons, two bars each (after the event, blue; a normal stretch, gray) with
the interval whisker on the event bar (§1.9); y ticks carry the display unit.
Legend: `■ after the event · ■ a normal stretch · ┬ range the answer could
fall in`. Comparison line: the `without_condition` block, UNAVAILABLE (§1.0,
reason "conditional-versus-unconditional comparison is not defined").

**Rail** (right, ~38%), top to bottom:
1. VERDICT box (amber border for Suggestive): `VERDICT · <label>` / the served
   `headline` / `why` / `Price it →`, disabled with "not yet served" while
   Basket & Hedge is unavailable.
2. BY REGIME · A MONTH LATER: REGIME / N / UP / MEDIAN, four regimes at
   h = 20; a regime with n < 10 prints its count and "too few cases to say"
   (v2 §9.2). Beneath: "Unlabeled: <unlabeled_n> events whose K−2 month has
   no stored regimes row" when non-zero; "Today is <regime>: <n> events<, too few to
   read alone>."
3. LAST FIVE EVENTS · <target label> A MONTH LATER: event date · regime ·
   `value_20`.
4. RANGE vs NORMAL: four rows horizon · interval (§1.9) · that horizon's pill.
   Confidence chips 80% / 90% / 95% render disabled with "not yet served";
   90% is the served level (`verdict_confidence`).
5. `Advanced ▸ all <matched_n> events · resampling detail · entry rules ·
   provenance` · `Export →` (the CSV of §12.4). Provenance line (mono 10px):
   `Engine as of <as_of> · <method> <draws> · entry <rule> · cooldown <n |
   none> · <series> history from <data_start> · verdict rule v1 at 90% · slug
   <slug>`.

The Advanced panel shows the study's own events (`/study/events`), each
horizon's method, draws, blocks and adverse share, the entry rule and the
provenance. It requests the identical study, so main and Advanced always
show the same calculation; the frame-2 engine panel is retired (v2 §8).

### 4.1 The engine's rules behind every answer (v2 §3–§5, §8, D-37)

- **Entry.** Entry follows the engine's declared availability rules: the
  event session's close when the target's fixing is at or after every input's
  availability; otherwise the next session's close. Ambiguous target fixings
  defer. Every event carries `event_date`, `entry_date` and an exit date per
  horizon.
- **Horizon.** A forward horizon h runs from the entry close to the close h
  XNYS sessions later. Baseline observations use the identical rule.
- **Cooldown.** After every retained threshold hit at session t, sessions t+1
  … t+w are excluded, even if the condition later fails. Crosses have no
  window and no cooldown; `provenance.cooldown` is null for them. An RSI
  crossing (desk/fill-compute) has no window; after each retained crossing
  the next 14 sessions (the RSI period) are its cooldown, so
  `provenance.cooldown` is 14.
- **Baseline.** Each horizon's baseline is the engine's evaluable baseline for
  that exact study and horizon: the condition computable on the baseline dates
  but not required to hold; the same entry and completeness rules; not
  cooldown-thinned. Every study, horizon and Ledger row carries its own; there
  is no universal normal month.
- **Counts.** The hit rate, median, extrema and interval at a horizon use
  exactly the same `n` completed outcomes. No denominator is ever taken from
  another horizon; `matched_n` is the study's size only (C-03).
- **Blocks.** Resampling clusters transitively intersecting inclusive forward
  windows into blocks and resamples whole blocks; every event observation
  stays in the reported counts. Under five blocks there is no interval (§12.2);
  five to seven blocks enumerate Bᴮ draws; above seven, 10,000 Monte Carlo
  draws with seed 20260921.
- **Compute.** `/study`, `/study/events`, `/study/catalog` and the presets
  share the existing single-flight study queue and generation cache, except
  a lookup (a request of only `preset=<catalog slug>`, with an optional
  `horizon`, and a bare `/study/catalog`), which reads under the stored-read
  ceiling (§13.1 step 2); the CSV export reuses the computed study. No new
  public compute route is added.

---

## 5. Regime  (`screens/04-regime.png`, 960px)

No action button. Badge `● Live · <Mon> row · <date>`. Symmetric 2×2.

**Where we are** (`rule-based · two-month lag`). Big label (regime color,
serif 30px): `current.label`, the stored row stamped K−2 for the current
session month K (`current.print`, v2 §9.1). Sentence "Growth <rising|falling>
and inflation <rising|falling>. <Nth> month in this regime." (desk/fill-compute;
it was "in a row"). Under it one line reconciles the home page's classifier
with this label, from `current.classifier` (desk/fill-compute): "The home
page's classifier puts <classifier.label> at <odds>% for the <Mon YYYY> row;
this tab's rule-based label is <label> for the <print> row, the one governing
today. They <agree|disagree> this month." (the row clause is left out when the
two rows are one; the odds are left out when served null). The word is
"classifier", never the other one. Stats: GROWTH
(industrial production, 3-mo slope) · INFLATION (CPI, 3-mo slope) · IN THIS
REGIME `months_in` mo (since the <since> row). Beside the label, separately:
"Latest print: <latest_print>" (never used to classify). LAST FIVE YEARS
strip: the last 60 stored monthly rows (`history`), colored by regime, year
ticks and `today` at the right; key ■ Goldilocks ■ Overheating ■ Stagflation
■ Recession Risk; note "labels as stored; revisions are not replayed."
(`history_note`). Box "How it's decided: two signs — growth rising or
falling, inflation rising or falling. Four combinations, four regimes. No
model, no fitting." Footer `Advanced ▸` disabled, "not yet served".

**Recession score** (`logistic model, five monthly inputs lagged three
months`). Big score (`recession.score` × 100 %), then the band word ("Low.",
"Elevated.", "High risk."). Sub-line "score for <probability_month> · inputs
through <inputs_through>". Gauge Low / Elevated / High risk with edges at
20% and 40% (`band_edges`), needle at the score. Stats: INPUTS THROUGH
`inputs_through` (three-month lag by design) · A YEAR AGO (`year_ago.score`,
its `probability_month`; "—" when null) · PEAK SINCE 2015 (`peak.score`,
`peak.probability_month`). Box "What it is: a fitted model — five monthly
indicators against NBER recession dates, trained <training.start> to
<training.end>; historical scores are in-sample. It is the only fitted thing
on the site, and it is labeled as one wherever it appears." Footer
`Advanced ▸` disabled, "not yet served".

**What each regime has meant** (desk/fill-compute), from `/regime` `stats`.
Sub-label "since <window.start year> · <window.n> stored months, each with its
own month of the S&P and the VIX". Columns REGIME / MONTHS / S&P MEDIAN / S&P
MEAN / UP / VIX AVG: `months`; `spx_median_mo` and `spx_mean_mo` (simple
monthly returns, × 100, signed); `up_pct`; `vix_avg` (one decimal). The
current label's row is marked. PNG 04's STOCK–BOND column is not drawn: no
bond price series is stored (§6). A footnote says what a row is: "Labels as
stored, each paired with its own calendar month; a label is known only after
its month's prints, so this describes, it does not time." No read box.

**What would change it** (`the next two prints`). Both cards read one label
(desk/fill-compute, the owner's brief, superseding item 14's ruling that read
the next prints from the newest row): the next prints are read from the row
WHERE WE ARE shows, the K−2 row (`next_prints.basis`, always
`current.print`), and the card carries the sub-label "from the <basis month>
row · <basis label>". When the stored row after it exists (`next_row`), a line
says "Already printed: the <Mon YYYY> row reads <label>, the label from
<first_effective_month>." NEXT CPI · NEXT INDPRO, each `release_date`
("release date unavailable" when null) and, for a print not yet made, the
sentence "a print <operator> <threshold_mom × 100>% m/m flips
<inflation|growth> to <falling|rising> → <flips_to>, effective from the
<first_effective_month> label." (`operator` `<=` flips a rising axis to
falling, `>` a falling axis to rising; v3 §9.3), or, for a print already made,
"the <Mon YYYY> print (<printed_mom × 100, two decimals, signed>% m/m) flipped
<axis> to <printed_direction>." (or "kept <axis> <printed_direction>." when it
equals `from_direction`). Every flip starts from the displayed label: a
test holds it for all four regimes. LAST FIVE REGIME CHANGES · S&P A MONTH LATER
(desk/fill-compute), from `/regime` `changes`: each row "<Mon YYYY> ·
<from> → <to> · <spx_1m>" (the S&P's simple return over `spx_1m_month`, the
calendar month after the change; "month not over" while null); the list's
label reads "Last five of <n> regime changes · S&P a month later".

---

## 6. Macro & Correlations  (`screens/05-macro-correlations.png`, 1060px)

No action button. Badge `● Live · FRED · <date>`. 2×2.

**Yield curve** (`today against a month ago`). Stats: 10-YEAR (`today.10y`, "<10y_chg_bp> bp on the month") · 2s10s (`curve.2s10s_bp` bp,
"<steepening|flattening|unchanged> · <2s10s_chg_bp> bp") · FRONT END
(`today.3m`; "Awaiting refresh" until DGS3MO is registered). Chart: tenors
3m / 2y / 5y / 10y / 30y on x; today (blue solid) and a month ago (gray
dashed), each labelled at its right end; a tenor not served leaves its point
out and its label says so. Tenors share one `date` or carry their own and
the chart labels the mismatch. Each snapshot is checked on its own date. When
`today.date` is null, today's tenors are drawn as separate points, each
labelled with its tenor and date, with no line joining them, and their dates
(`today.dates`) are listed under the chart. When `month_ago.date` is null, the
month-ago tenors are drawn and listed the same way from `month_ago.dates`. A
snapshot with a date is drawn as one curve. The page lists `month_ago.dates`
under the chart when the date is common too (S-30).

**Do bonds still hedge stocks?** (`60-day correlation of daily returns, one
year`): LIVE (desk/fill-etf), from `/macro` `stock_bond` (§12.8): SPY against
TLT. Stats: TODAY (`today`, signed to two decimals; sub-line "SPY vs TLT ·
<today_date>", or "Awaiting refresh" and the served `today_reason`) · A YEAR
AGO (`year_ago`; sub-line `year_ago_date`) · FLIPPED (`flipped` as "<Mon>
<year>", "None" when served null; sub-line "to <flipped_to> on
<flipped_on>"). No word and no hedging call is served; the numbers take no
color. Chart: `series` (blue) on −1…+1 with the zones "bonds move WITH stocks
· no hedge" (above zero) and "bonds move AGAINST stocks · hedge works" (below
zero). Stamp: "60 daily log returns to <window.end> · SPY vs TLT, adjusted
closes · <providers>".

**Credit** (`high-yield spread over Treasuries`). Stats: HY SPREAD (`hy.value`
%, dated) · 3-YEAR RANGE (`hy_range_3y`, or the served `reason` "coverage
from <date> only" when null) · INVESTMENT GRADE (`ig.value` %, dated). Gauge
Tight / Normal / Wide with edges 0.30 and 0.70 of the three-year rank,
needle at `hy_pct_3y` ("<nth> pct"); no gauge when `hy_pct_3y` is null. LAST
12 MONTHS line (`series`, blue) with `peak_12m` labelled "<Mon> peak ·
<hy>%".

**What moves with the S&P** (`60-day correlation · each asset against the
index`): LIVE (desk/fill-etf), from `/macro` `correlations` (§12.8), one row
per served asset in the served order: its `asset` name, a bar from the
middle (left and green for a negative correlation, right and amber for a
positive one), the signed value to two decimals, and its `symbol` (hover:
`quantity`, `transform`). A row served null prints "not available · <reason>",
or "Awaiting refresh" when its reason begins so. Stamp: "60 daily returns to
<the rows' common date>", then each row dated otherwise ("VIXCLS to <date>"),
then "each against SPY". No meaning word is served. The 12-asset matrix under
Advanced is `matrix` (awaiting, "the 12-asset matrix's assets and method are
not specified yet."): `Advanced ▸` disabled.

---

## 7. Sectors  (`screens/06-sectors.png`, 900px)

LIVE since desk/fill-etf, from `/sectors` (§12.14). No action button. Badge
`● Live · <providers> · <date>` (the served comparison session, §1.6).

**Sector leadership** (`3-month return relative to the S&P · all eleven`).
Stats: LEADING (the first served row's `name`, "<rel_ret> vs the index") ·
LAGGING (the last served row's) · PATTERN (the served `pattern.word`
capitalized; sub-line "cyclical sectors ahead of defensives by <|spread|>",
"defensives ahead of cyclical sectors by <|spread|>", or "neither group ahead
by more than <band>"; "Awaiting refresh" and the served `pattern.reason`
when the word is null). All eleven bars in the served order, each `rel_ret` ×
100 with the tooltip "log return, ×100"; a row served null prints "not
available · <reason>", never a value or "below". Key: more than 1% ahead ·
within 1% · more than 1% behind. Stamp: "60 sessions to <window.end> (from
<window.start>) · log returns ×100 · SPY <benchmark.ret> over the same
sessions". When `missing` is not empty (Codex R-01) the ranking is not
presented as complete: the subtitle reads "<ranked_n> of 11 with data",
LEADING's and LAGGING's sub-lines end "· among the <ranked_n> sectors with
data", and a note under the bars names each missing sector with its reason
("Not ranked, without data over the window: XLC Communications
(<reason>).").

**Breadth** (`is the rally wide or narrow? · of 11 sectors`), the `/sectors`
`breadth` block (§12.14), of the eleven sector ETFs only. Stats: ABOVE 50-DAY
("<n> of <of> sectors"; sub-line "on <compared_on>", then "<etfs> not
available" when a sector's average cannot be read) · ABOVE 200-DAY (the same)
· EQUAL vs CAP WEIGHT (`eqw_vs_cap_3m` × 100, tooltip "log return, ×100",
red when negative, green when positive; sub-line "RSP vs SPY · 60 sessions";
"Awaiting refresh" and the served `eqw_vs_cap_reason` when null). Lines:
"Equal weight vs cap weight · RSP against SPY, 60-session difference · one
year" (`eqw_vs_cap_series`), zones "RSP ahead of SPY · equal weight leading"
and "SPY ahead of RSP · cap weight leading"; dots "Which of the 11 sectors are
above their 50-day" and "…and their 200-day" (`by_etf`; a sector not in the
map is an unlit ring read "not available", never "below"); "Small caps vs
large · IWM against SPY, 60-session difference · one year"
(`small_vs_large_series`), zones "IWM ahead of SPY · small caps leading" and
"SPY ahead of IWM · large caps leading". Gray note: "Counted over the 11
sector ETFs, not stocks. Constituent-level breadth, the stocks inside the
index, needs constituent data that is not ingested yet." Stamp: "on
<compared_on> · averages over 50 and 200 sessions · log returns ×100 ·
<providers>". A served awaiting block keeps the labels and prints its reason.

While the store lacks the sector ETFs (a database older than the first full
refresh that stores them), the route answers awaiting with "Awaiting refresh:
the full refresh stores <symbols>; this database predates it." and both
cards keep their labels and print it (§1.0.2, §1.7).

---

## 8. Signal Ledger  (`screens/07-signal-ledger.png`, 880px)

No action button. Badge `● Live · engine as of <as_of>`. Subtitle `every
signal the engine scores, on one page · click a row to open it in Event
Study`.

Four stat cards: SIGNALS SCORED `scored_n` ("<scored_n> scored · <unavailable_n>
not yet served", v4 B-02) · FIRING NOW (count of available rows with
`firing_now` true and not stale; their `short`s) · RELIABLE (count; `short`s)
· NO EDGE (count). Unavailable rows are excluded from every count but the
first.

Filter chips: All 12 · Firing now · Reliable only · S&P only · Cross-asset.

Table, fixed column widths: SIGNAL / LAST FIRED / TIMES / UP A MONTH LATER /
MEDIAN / VS NORMAL / VERDICT (92px pill) / NOW. The twelve rows in exactly
this order (v3 §2, v4 B-03): 2s10s-2sigma-steepening, dollar-2sigma-20d,
golden-cross, rsi-below-30, vix-spike-2sigma-5d, gold-2sigma-spx-weak,
hy-2sigma-20d, spx-20d-2sigma, death-cross, rsi-above-70, oil-2sigma-20d,
spx-5d-2sigma. A firing row is green-tinted. NOW: `● Firing · day <n>`
(green text), `○ Quiet` (gray), or `○ Stale · <evaluated_on>` when the row is
served `stale`: its `evaluated_on` trails the comparison session by more than
its inputs' publication allowance (§12.5; desk/fill-compute: a FRED daily input
1–3 sessions behind is current); the NOW cell's tooltip
reads "evaluated on <evaluated_on>". An unavailable row keeps its label and
prints its reason across the value columns, with no pill.

Footer: the four §1.5 definitions + "vs normal compares each study to its own
baseline over its own sample." + `a month = 20 sessions · engine as of
<as_of>`.

---

## 9. Position Monitor  (`screens/08-position-monitor.png`, 1040px)

No Desk/Client toggle (desk-only). Two columns. Positions live in this
browser (§1.8): there is no server position store and nothing is posted
(v2 D-21, v3 §16).

**Promote to position** (left). Subtitle names what was carried in (a study
from Event Study, a basket from Basket & Hedge) or "any study can be carried
in". Fields: INSTRUMENT (text) · DIRECTION (Long / Short) · SIZE · % NAV
(number, optional) · HORIZON 5 / 10 / 20 / 60 trading days.

**Discipline gate** — "three short answers, then Save turns on" with progress
`✓ variant · ✓ pre-mortem · ○ level`:
1. VARIANT VIEW — "finish the sentence: 'The market thinks ___, I think ___,
   because ___.'"
2. PRE-MORTEM — "finish the sentence: 'It lost money because ___.'"
3. WRONG IF — "suggested for <instrument> · changes with the instrument". The
   suggested levels are named rules; a level carries a number only for a
   subject the store serves (the S&P against `/technicals` `ma50` and
   `ma200`; 2s10s against `/macro` `curve.2s10s_bp`), and only the S&P's
   50-day and 2s10s are monitored automatically (below). `the signal
   reverses` is offered only for a study subject with its full question.
4. RED TEAM (optional) — "the strongest case against, in your words."
WORDING check: will, always, never, proves, guaranteed (case-insensitive,
ASCII word boundaries, in the variant view and the pre-mortem only) are
highlighted amber with one-click replacements ("is likely to", "tends to").
Only those block. **Save position** is off until the gate is complete; the
helper names what's left. The gate in the browser is a workflow check, and
Build Notes says so.

**The gate rule** (published so a future server enforces it identically):
- required: a trimmed non-empty `instrument`, `variant` and `pre_mortem`, and
  a `wrong_if` choice; `size_nav` null or finite in [0, 1]; `horizon_days` ∈
  {5, 10, 20, 60}.
- subject: `{"kind":"study","question":{the six slots}}`,
  `{"kind":"basket","legs":[{"symbol","weight"}],"benchmark":string|null}` or
  `{"kind":"instrument","id":string}`. `signal_reverses` requires
  `kind: "study"` with the full question.
- monitoring (v3 §16, v4 B-10): `automatic` when the subject's monitored
  quantity exactly matches a served series — the instrument `spx` against
  its 50-day (`/technicals` `ma50`), or the instrument `curve_2s10s` against a
  bp level (`/macro` `curve.2s10s_bp`). Such a position needs a positive
  finite `original_room`; zero or negative (already through the level at
  entry) is rejected with a sentence, never saved as manual. Unserved
  subjects (NDX vs SPX, a basket) and categorical or custom falsifiers
  (`regime_changes`, free text, the S&P's 200-day) are saved with
  `monitoring: "manual"`, `original_room: null`, `room_pct: null`; they stay
  visible and need an explicit close.
- persisted at entry: `entry_ts`, `entry_date`, `entry_value`,
  `trigger: {"series","operator":"below"|"above","threshold","policy":"frozen"}`,
  its observation date, `original_room` (signed), `evaluation: "close"`.
- signed distance: for a below-level falsifier `value − threshold`; for an
  above-level one `threshold − value`; the same orientation at entry and
  now, the threshold frozen at entry. `room_pct = distance now / original_room`;
  ≤ 0 when breached; null when the series is not served.
- `day` counts the entry session as 1 on XNYS. `dv01` is null.
- closure is an explicit stored event (`{"type":"falsified"|"expired"|"closed","ts"}`);
  an unobserved interval (the browser closed) closes nothing. The pre-mortem
  is judged by an explicit stored yes / no at close. `closed_90d` counts the
  stored close events of the last 90 days.
- validation runs on Save, on Import and on load; a record that fails is kept
  in an "unreadable" list the page shows, never dropped. Manual records are
  valid with null room.

**Monitored** (right). Rows as on the Overview (§2), sorted by `room_pct`
ascending, null last, then id; click expands a row: FALSIFIES AT
(`<series> <below|above> <threshold> · now <value>`, or the typed rule for a
manual row) · SIZE · HORIZON (`<size> NAV · DV01 — · <day> of <horizon>
trading days · opened <entry_date>`) · VARIANT VIEW · PRE-MORTEM · RED TEAM ·
links `Open the study behind it →` (a study subject) and **Close…**. Footer
`Sorted by room left · room = distance to the level as a share of the room at
entry, same scale for every trade · size as % of NAV · <deployed>% deployed,
<n> positions · click a row for the gate text`. CLOSED · LAST 90D strip:
Falsified on level · Expired at horizon · Pre-mortem was right `<yes> of
<judged>`. While a kept record cannot be read (§1.8), the footer prints no
deployed share and says `<n> readable positions`, the strip's counts read
"—", each says "<n> kept position(s) could not be read.", and an empty list
reads "No readable open position; <n> kept position(s) could not be read."
Export / Import JSON of the store.

---

## 10. Basket & Hedge  (`screens/09-basket-hedge.png`, 1040px)

UNAVAILABLE (§1.0): basket pricing and option structures are not yet defined
in the engine (v2 D-25–D-28). No Desk/Client toggle. Action button **Send to
Position Monitor →** (a basket subject, monitored manually, §9). Badge `○ Not
yet served`. Two columns, both kept with their titles and labels.

**Basket**. The selector of this browser's baskets and `+ New basket`. The
LEGS table with Equal-weight / Normalize to 100%, typed weights, `+ Add a
ticker…`, the total, **Save basket** and Export / Import JSON: local editing
only. A weight keeps every digit it is typed with; a total counts as 100%
only when it is exactly 100. The stats (3-MONTH, VS NDX · RESIDUAL, BASKET
VOL), the residual chart and the beta read are unavailable: labels kept,
the reason printed.

**Hedge · express or protect**: UNAVAILABLE. Title, subtitle and the three
mode labels kept; the reason printed; no structures, no ratio, no scenarios.
The deferred shapes, with the corrections that apply when they are built,
are in §12.13.

---

## 11. Data Pipeline, Build Notes, Client view

**Data Pipeline** (`screens/10-data-pipeline.png`). No Desk/Client toggle.
Header `● Last full refresh <last_refresh_utc> · validation <passed|failed>`,
or "unknown" for either when not served (v2 D-33). Title "Where every number
comes from" · "Every panel in Desk resolves to a row here. Nothing is
synthetic; nothing is re-derived in the browser." Lineage strip: 1 SOURCES
(FRED API, Yahoo Finance, EODHD) → 2 FETCH (GitHub Actions) → 3 VALIDATE
(schema + range checks, as-of ≤ today, gap detection) → 4 TRANSFORM
(z-scores, MAs, regime labels, forward returns) → 5 STORE (SQLite snapshot,
published as a release asset) → 6 SERVE (FastAPI · /api/desk/* · one
number, one truth). Series inventory: generated from the registry and its
consumers, counts derived; each group expands to a table SERIES / ID / FROM
/ AS OF / FEEDS / STATUS (provider, `freq`, first and last stored
observation, feeds), scrolls inside the group; search jumps to a series. WTI
is the daily `DCOILWTICO`; USD/JPY is the registry's instrument. Since
desk/fill-etf the inventory also lists the 24 ETFs the full refresh stores
in `asset_prices` with each session's volume, in three groups: Sector ETFs
(the eleven SPDR sectors; XLC from 2018-06-19 and XLRE from 2015-10-08, their
listing dates), Equity ETFs (SPY, RSP, IWM, QQQ, SMH, SOXX, IGV) and Bond,
gold & dollar ETFs (TLT, IEF, HYG, LQD, GLD, UUP). The bridge
card is titled "Proposed export schema (not the current SQLite layout)", with
the DDL block and the buttons **Export current study → CSV** (§12.4) and
**Generate Snowflake DDL** (`/pipeline/ddl`).

**Build Notes** (`screens/11-build-notes.png`). TOC sidebar from the file's
sections. Rendered from `docs/desk/BUILD_NOTES.md`, a markdown render,
nothing hardcoded except §11's byline `Max Komen · September 2026` and the
section "Live / Designed, not yet served": §1.0.1's two lists, word for word.
The file is the owner's prose: of the Desk's banned words only "established"
and "significant" are enforced on it, by the page's existing hold (a sentence
that carries either is held, FRAME3_REPORT §10). The `[N] findings across [R] rounds` placeholder is filled by
Max from C's audit.

**Client view** (`screens/12-client-view.png`, 760px). The Desk / Client toggle
appears on Overview, Technicals, Regime, Macro & Correlations, Sectors, Event
Study, Signal Ledger and Build Notes; not on Position Monitor, Data Pipeline
or Basket & Hedge (v2 D-36). Client swaps the page for PNG 12's two-column
client-safe summary of one study: Event Study's current study (its address;
on other tabs the last one Event Study answered in this browser, else the
gold preset), with the same generation and the h = 20 counts Event Study
shows. Left: "Setup · <last_event>" when `firing_now` and not `stale`, else "Setup
last seen · <last_event>"; the served `client.headline` as the title (the catalog
`client_label` when `client` is null); the served `client.summary`; three stats
EPISODES (`matched_n`, "since <sample_start year>") · HIGHER A MONTH LATER
(h = 20 `up_pct` against `baseline_up_pct`, green only when above) · TYPICAL
MOVE (h = 20 `median` against `baseline_median`, §1.9); the source line
`Radar · FRED, Yahoo Finance · as of <as_of> · Past patterns do not guarantee
future results.` Right: "A month later, by economic backdrop" / "Typical
<target label> move after the setup", four regime rows with the h = 20
`by_regime` median on one scale, "too few cases to say" when null. No
verdict pills, no σ, no jargon. The footer prints `Snapshot · <as_of>` and no
generation id, and it is hidden in print. The mixed-generation check of §1.1
still runs on the Client view (S-32).

---

## 12. API contract — the nine live endpoints

### 12.0 Transport, envelope, conventions

**Routes.** JSON, GET only, under `/api/desk/`: `/overview`, `/study`,
`/study/catalog`, `/study/events`, `/ledger`, `/regime`, `/technicals`,
`/macro`, `/pipeline`, and, since desk/fill-etf, `/sectors` (§12.14). Two
text exceptions: `/study/events` with `Accept: text/csv` (§12.4) and
`/pipeline/ddl` (`text/plain; charset=utf-8`). The deferred resources of
§12.13 (`/vol`, `/positions`,
`/basket/:id`, `/basket/price`, `/hedge`) are GET-only stubs answering the
awaiting envelope; a removed write (`POST /positions`, `POST /basket/price`)
answers 405. Every existing endpoint keeps its contract, those under
`/api/desk/` included (`/api/desk/event-study`, `/api/desk/event-study/assets`,
`/api/desk/pipeline/inventory`); this envelope applies only to the routes
above (v3 §18).

**Envelope** (every JSON route above):

| Field | Type | Presence | Meaning |
|---|---|---|---|
| `status` | `"ready"` \| `"computing"` \| `"awaiting"` \| `"error"` | required | the response's state |
| `generation_id` | string | required, nullable | the store generation computed on; null only before a generation exists: the answer is then `computing` (202, `Retry-After: 2`) while the server builds its first generation, and `as_of` is null too |
| `as_of` | date | required, nullable | the New York date the generation was staged; per-request anchors (`comparison_session`) are served in the payload; null as above |
| `engine_version` | string | required | the git commit sha of the running build, injected at image build as `ENGINE_VERSION` (`ARG`/`ENV`) and read from the environment: `ENGINE_VERSION`, else the host's `RENDER_GIT_COMMIT`; `"unknown"` when neither is set |
| `data` | object | required, nullable | the payload; non-null only when `status` is `ready` |
| `unavailable` | `{reason: string, until: string\|null}` | required, nullable | non-null only when `status` is `awaiting` |
| `error` | `{code: string, message: string, provider?: string, retryable?: boolean}` | required, nullable | non-null only when `status` is `error`; `provider` and `retryable` only on `code` `schema_check` (served `"api"` and `true`), and no other field |

HTTP: `ready` 200; `computing` 202 with `Retry-After: 2`, and the client polls
the same URL; `awaiting` 200 with `data: null`; `error` 4xx/5xx. A study
outside the catalog is 422 with `error.code: "unsupported"` and a message
naming what is not supported, never a silent parameter drop. The client
parses `data` only when `status` is `ready`. Refusals made before the route
runs (413, 429 from `api/security.py`) keep the middleware's `{detail}` body.

**Nested block envelopes** occur at exactly these paths and nowhere else
(v4 B-08, C-01):
- `/overview`: `since_last_close`, `tiles.regime`, `tiles.recession`,
  `tiles.trend`, `tiles.vol`, `data_status`;
- `/regime`: `current`, `recession`, `next_prints`, `stats`, `changes`;
- `/macro`: `curve`, `credit`, `stock_bond`, `correlations`, `matrix`;
- `/technicals`: `vol`, `sectors`;
- `/study`: `without_condition`;
- `/sectors`: `breadth` (desk/fill-etf).

A block envelope is `{"status":"ready","data":<the declared object or
array>,"unavailable":null}` or `{"status":"awaiting","data":null,
"unavailable":{"reason","until"}}`. Every other object and array is an
ordinary payload field. The tables below give a nested block's fields as
`<path>.data.<field>`. A block that could not be computed from the current
generation is `awaiting` with reason "Awaiting refresh: this could not be
computed from the current data."

**Values.** Full precision. A missing statistic is null with a reason where
the table says so, never 0, NaN or Infinity. Dates are sessions
`YYYY-MM-DD`, months `YYYY-MM`, timestamps RFC 3339 with zone. Every dated
live block carries `date` | `month` | `ts` with `freq` and `source`; a
composite statistic carries `window: {start, end, n}` (§1.10).

**Reads** (v2 §15). A card's interpretive sentence is served only as
`reads.<card>` = `{"label": "Read" | "Read for the desk" | "Beta to NDX" |
"Why index options, not the names" | "Recommendation" | null, "text": string,
"tone": "normal"|"warning", "rule": string}`, where `rule` names the rule in
this contract that produced it (v2 §15 allows `null`; v3 A-14 serves no word
without its formula, so a read without a named rule is not served). No such rule exists on Monday, so no `reads`
field is served and no read box is drawn. No recommendation is inferred from
a verdict, beta, correlation or IV gap alone.

**Categorical words.** A served word (`band`, `trend.state`, a verdict) names
its formula in this contract or its existing implementation; none is served
on a version string alone (v3 A-14).

**Consistency.** Every response a page makes shows one `generation_id`
(§1.1). Hash identity (v4 B-09): `inputs_hash` is the engine's unchanged
native provenance hash. The native calculation cache keys on the canonical
engine query and the generation and is shared across selected horizons; the
adapter response cache adds `selected_horizon`, the `verdict_rule` version and
the adapter schema version, and an adapter cache key is never served as
`inputs_hash`.

**Names that differ from the amendments' sketches** (the fold's choices,
kept consistent everywhere): v3 §3's per-signal `compared` is one pair,
`comparison_session` and `prev_session`, on `/overview` `since_last_close`,
on `/ledger` and on `/study`, because B-05 anchors every signal to the same
two sessions; v2 §21's `data_status {state, worst_series, date}` is
`{state, contributors[]}` (B-06, C-02); v2 §21's Ledger `unit` is
`target_unit` with `display_unit` (§1.9).

**Engine basis codes** used in the tables:
- **E** an existing function or stored table, named;
- **P** a projection of the engine run's full event table (§13.2);
- **N** a new calculation §13.2 authorizes, named;
- **A** adapter shaping over served values (envelope, catalog, labels, the v1
  verdict rule, fixed templates); no estimator;
- **S** a stored read (a row, or its date), with no calculation.

### 12.1 `GET /overview`

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `since_last_close` | block envelope | required | — | — | — |
| `since_last_close.data.comparison_session` | date | required | — | XNYS session | N firing state (§12.5): `api/calendar.last_completed_session` at the response's calculation time (v4 B-05) |
| `since_last_close.data.prev_session` | date | required | — | XNYS | N: the XNYS session before `comparison_session` (`api/calendar.previous_trading_day`) |
| `since_last_close.data.new_fires` | array of `{slug, label, short}` | required (may be empty) | — | the two sessions | N firing state: `firing_now` false → true between `prev_session` and `comparison_session`, both evaluated in this generation; a signal whose `evaluated_on` is not `comparison_session`, or whose state is null, is excluded |
| `since_last_close.data.still_firing` | array of `{slug, label, short, firing_day}` | required (may be empty) | sessions | the two sessions | N firing state: true → true; `firing_day` as §12.5 |
| `since_last_close.data.vol_change_pts` | number | required, nullable | VIX points | the two sessions · daily · `asset_prices` ^VIX (FRED VIXCLS before desk/fill-compute) | N (v4 B-12): VIX on `comparison_session` minus VIX on `prev_session`; null if either observation is missing |
| `since_last_close.data.regime_from` | regime label | required, nullable | — | the K−2 row governing `prev_session` | N (B-12): stored `regimes` row |
| `since_last_close.data.regime_to` | regime label | required, nullable | — | the K−2 row governing `comparison_session` | N (B-12) |
| `since_last_close.data.regime_changed` | boolean | required, nullable | — | — | N (B-12): `regime_from ≠ regime_to`; null if either is null |
| `since_last_close.data.refreshed_at_utc` | ts | required, nullable | — | `source_watermarks` | S: the Desk series' last advance recorded by the refresh; null when not recorded |
| `tiles.regime` | block envelope | required | — | — | — |
| `tiles.regime.data.label` | regime label | required | — | the row `print` · monthly · `regimes` | E: `src/regime.py` `classify_regime`, stored row |
| `tiles.regime.data.print` | month | required | — | K−2 for the month of `comparison_session` | A: `event_study.regime_at` rule (`REGIME_LAG_MONTHS = 2`) |
| `tiles.regime.data.growth` | `"rising"` \| `"falling"` | required | — | as `print` | E: sign of the stored `growth_trend` (`compute_trends`) |
| `tiles.regime.data.inflation` | `"rising"` \| `"falling"` | required | — | as `print` | E: sign of the stored `inflation_trend` |
| `tiles.regime.data.months_in` | integer | required | months | — | A: length of the run of equal labels in consecutive stored months ending at `print`; a missing month ends the run |
| `tiles.regime.data.since` | month | required | — | — | A: the first row of that run |
| `tiles.regime.data.freq`, `.source` | `"monthly"`, string | required | — | — | A: `"monthly"`, `"regimes table (src/regime.py)"` |
| `tiles.recession` | block envelope | required | — | — | — |
| `tiles.recession.data.score`, `probability_month`, `inputs_through`, `band`, `band_edges`, `freq`, `source` | as the same fields of `/regime` `recession.data` (§12.6) | required | as §12.6 | as §12.6 | as §12.6 |
| `tiles.trend` | block envelope | required | — | — | — |
| `tiles.trend.data.state` | `"above_both"` \| `"below_both"` \| `"mixed"` \| `"unavailable"` | required | — | `date` | N MAs and trend (§13.2, v3 §13): price against `ma50` and `ma200`; equality is `mixed`; `unavailable` when either average is null |
| `tiles.trend.data.above_50` | boolean | required, nullable | — | `date` | N: `price > ma50` |
| `tiles.trend.data.above_200` | boolean | required, nullable | — | `date` | N: `price > ma200` |
| `tiles.trend.data.state_since` | date | required, nullable | — | — | N: the first session of the current state |
| `tiles.trend.data.cross` | `{kind: "golden"\|"death", date}` | required, nullable | — | — | E: `event_study.cross_positions`, the latest strict cross |
| `tiles.trend.data.date` | date | required | — | daily · `asset_prices` ^GSPC | S: the session the state is read at |
| `tiles.trend.data.freq`, `.source` | `"daily"`, string | required | — | — | A: `"daily"`, `"asset_prices ^GSPC"` |
| `tiles.vol` | block envelope | required | — | — | — |
| `tiles.vol.data.vix` | number | required | index points | `date` · daily · `asset_prices` ^VIX (desk/fill-compute, owner's item 7: the CBOE close from ^GSPC's path, EODHD first where a token exists, else Yahoo; FRED's VIXCLS lagged the S&P by up to three sessions) | E: newest stored observation; `source` "asset_prices ^VIX" |
| `tiles.vol.data.date` | date | required | — | — | E |
| `tiles.vol.data.freq`, `.source` | `"daily"`, string | required | — | — | A |
| `tiles.vol.data.band` | `"calm"` \| `"subdued"` \| `"stressed"` | required | — | `date` | A rule (desk/fill-compute): calm < 15 ≤ subdued < 25 ≤ stressed on `vix`, the home page's VIX words and edges (web `DashboardScreen.tsx`; `src/analytics/volatility.py`'s 15 / 25) |
| `tiles.vol.data.band_edges` | `[15, 25]` | required | VIX points | — | A |
| `tiles.vol.data.gap` | `{date, vix, realized_21d, gap_pts, window: {start, end, n}}` | required, nullable (null when no session has both) | VIX points | `gap.date` · daily · the VIX's store and `asset_prices` ^GSPC | N realized volatility (desk/fill-compute): on the XNYS calendar, the latest session where the VIX and the S&P's 21-day realized volatility both exist; `realized_21d` = 100 × √252 × the sample standard deviation (ddof 1) of the 21 daily log returns ending that session, each return needing both its closes (`src/analytics/technicals.realized_vol`, symbol-agnostic); `gap_pts` = `vix` − `realized_21d`; `window` names the first close read and the session, `n` 21 returns |
| `active_signals` | array of Ledger rows (§12.5) | required (may be empty) | — | each row's own | A: the deduplicated union of every row with `firing_now` true and `stale` false and the five rows with the latest non-null `last_fired`, ordered firing first, then `last_fired` descending, then `slug` (v2 §19) |
| `data_status` | block envelope | required | — | — | — |
| `data_status.data.state` | `"current"` \| `"stale"` \| `"missing"` | required | — | — | N data status (v4 B-06): the worst contributor, missing > stale > current |
| `data_status.data.contributors` | array | required | — | — | N: one per series of the Desk feed set, the tier-1 inputs of the twelve Ledger studies plus DGS2 and DGS10: T10Y2Y, BAMLH0A0HYM2, DGS2, DGS10, then the closes ^GSPC, GC=F, ^VIX |
| `…contributors[].series` | string (series id) | required | — | — | A |
| `…contributors[].observation_date` | date | required, nullable | — | the series' newest stored observation | S: `desk_series` for the FRED inputs, `asset_prices` for ^GSPC, GC=F and ^VIX (the symbol's own newest row) |
| `…contributors[].expected_observation_date` | date | required, nullable | — | the observation the series' existing freshness policy expects (C-02); never a publication timestamp | E: for the FRED inputs, `api/freshness._daily_expected_and_lag`'s expected date (bond calendar for rates and spreads, FRED tolerance kept: current within 3 business days since desk/fill-compute); for ^GSPC, GC=F and ^VIX, the completed session the `asset_prices` rule of `api/freshness.assess` expects, applied to the symbol |
| `…contributors[].state` | `"current"` \| `"stale"` \| `"missing"` | required | — | — | N: each series through its existing policy: `desk_series_states` for the FRED inputs, close/current → `current`, stale or delayed past its window → `stale`, absent/unknown → `missing` (a FRED daily series 1–3 business days behind the print due is current, `api/freshness.DAILY_TOLERANCE` = 3, desk/fill-compute); the `asset_prices` rule for ^GSPC, GC=F and ^VIX, `current` and `delayed` within the grace → `current`; `stale` → `stale`; absent → `missing`; never a bare comparison with the latest XNYS session outside that policy (B-06) |
| `…contributors[].reason` | string | required | — | — | E: the freshness policy's reason sentence |

### 12.2 `GET /study`

Parameters: `preset=<slug>`, or the six slots `shock`, `window` (5 | 20 |
60; omitted for a cross or an RSI crossing), `move` (`up2s` | `down2s` |
`cross_above` | `cross_below` | `rsi_above_70` | `rsi_below_30`), `while` (`none` | `spx_below_50` | `regime:<Goldilocks |
Overheating | Stagflation | Recession Risk>`), `target`, `horizon` (5 | 10 |
20 | 60, default 20). A request must normalize to one catalog study (§12.3);
`horizon` then selects that study's results. There is no `confidence`
parameter. `while` defaults to `none`; `window` is required for
`up2s`/`down2s` and refused for a cross or an RSI crossing; `preset` also accepts an engine slug
that parses to a catalog study's query. `horizon` also rides with a preset,
and a preset link keeps it (Codex round 3, R-23). An unknown parameter, a
repeated one, a preset asked with slot parameters, or a horizon outside the
study's `allowed_horizons` is refused 422 `unsupported`, the message naming
what (R-27). A preset for a row whose `allowed_horizons` is `[]` (none since
desk/fill-compute gave the RSI rows a question) is awaiting, with the row's served reason, when the request carries no
`horizon`; with any `horizon` parameter it is refused 422 `unsupported`, the
message naming `horizon`. The default horizon is never applied to such a row.
`/study/events` follows the same rule (S-31). Anything else: 422
`unsupported`.

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `slug` | string | required | — | — | A: the catalog slug the request normalizes to (public aliases; the engine's `slug_for` is unchanged, v3 §2) |
| `label`, `short` | string | required | — | — | A: catalog (§12.3) |
| `question.shock` | series key | required | — | — | A → E `Query.shock` |
| `question.window` | 5 \| 20 \| 60 | required, nullable (null for a cross or an RSI crossing) | sessions | — | E `Query.w` |
| `question.move` | `up2s` \| `down2s` \| `cross_above` \| `cross_below` \| `rsi_above_70` \| `rsi_below_30` | required | — | — | A → E `Query.sign` / `Query.kind`+`cross` (`kind` `rsi`, `cross` `above` \| `below` for the RSI moves) |
| `question.while` | `none` \| `spx_below_50` \| `regime:<label>` | required | — | — | A → E `Query.cond` (`spx_below_50dma`, `regime`) |
| `question.target` | series key | required | — | — | E `Query.target` |
| `question.horizon` | 5 \| 10 \| 20 \| 60 | required | sessions | — | A: the request's horizon |
| `question.target_unit` | `log_return` \| `log_change` \| `bp` | required | — | — | E: registry `DeskSeries.unit` of the target |
| `question.display_unit` | `percent` \| `bp` | required | — | — | A: `percent` for `log_return` and `log_change`, `bp` for `bp` |
| `selected_horizon` | 5 \| 10 \| 20 \| 60 | required | sessions | — | A (v4 B-01) |
| `matched_n` | integer | required | events | `sample_start`–`sample_end` | E `provenance.n_events`: retained events in the evaluable sample, independent of horizon (C-03) |
| `data_start` | date | required | — | — | E `provenance.data_start` (= latest of `series_start`) |
| `sample_start`, `sample_end` | date | required | — | — | E `provenance.sample_start`, `sample_end` |
| `first_event`, `last_event` | date | required, nullable (null with no retained event) | — | — | P |
| `firing_now` | boolean | required, nullable | — | `evaluated_on` | N firing state (§12.5) |
| `firing_day` | integer | required, nullable (null unless `firing_now` is true) | sessions | — | N firing state |
| `evaluated_on` | date | required, nullable | — | — | N firing state: the study's latest evaluable session |
| `comparison_session` | date | required | — | XNYS | N firing state: as §12.5 |
| `prev_session` | date | required | — | XNYS | N firing state: as §12.1 |
| `stale` | boolean | required | — | — | N (desk/fill-compute, owner's item 7): `evaluated_on` trails `comparison_session` by more XNYS sessions than the study's publication allowance, the most any of its inputs allows: 0 for a close an exchange prints (^GSPC, GC=F, ^VIX, ^NDX, the dollar index, USD/JPY), 3 for a FRED daily series (`api/freshness.DAILY_TOLERANCE`), 8 for WTI (`DESK_SLOW_PUBLICATION`, published weekly), or is dated after it; before, any `evaluated_on` other than `comparison_session` was stale; a stale study is never called firing today (v3 §3) |
| `verdict` | `reliable` \| `suggestive` \| `no_edge` \| `insufficient` | required | — | `selected_horizon` | A: `verdict_rule` v1 (§1.5) at `selected_horizon` |
| `verdict_rule` | `"v1"` | required | — | — | A |
| `verdict_confidence` | `0.90` | required | — | — | E `CI_LEVEL` |
| `headline` | string | required | — | `selected_horizon` | A: template by verdict (below) |
| `why` | string | required | — | `selected_horizon` | A: template over `horizons[selected]` (below) |
| `horizons` | array, one row each for 5, 10, 20, 60 | required | — | — | E `horizon_stats` |
| `horizons[].h` | integer | required | sessions | — | E |
| `horizons[].label` | `"1 week"` \| `"2 weeks"` \| `"1 month"` \| `"3 months"` | required | — | — | A |
| `horizons[].n` | integer | required | completed outcomes | — | E `n` |
| `horizons[].up_n` | integer | required | outcomes | — | P |
| `horizons[].n_incomplete` | integer | required | events | — | E |
| `horizons[].n_blocks` | integer | required | overlap blocks | — | E |
| `horizons[].baseline_n` | integer | required | observations | — | E |
| `horizons[].up_pct` | fraction | required, nullable | — | — | E `hit_rate` (target change > 0) |
| `horizons[].median` | number | required, nullable | `target_unit` | — | E |
| `horizons[].baseline_median` | number | required, nullable | `target_unit` | — | E |
| `horizons[].baseline_up_pct` | fraction | required, nullable | — | — | E `baseline_hit_rate` |
| `horizons[].ci_lo`, `ci_hi` | number | required, nullable (null under five blocks) | `target_unit`, on Δ | — | E `judge_exclusion` `ci90` |
| `horizons[].adverse_share` | fraction | required, nullable (null under five blocks) | — | — | E `opposite_sign_share` |
| `horizons[].draws` | integer | required (0 with no interval) | — | — | E `n_draws` |
| `horizons[].method` | `enumeration` \| `monte_carlo` | required, nullable | — | — | E `resampling` (engine "exact" → `enumeration`); 5–7 blocks enumerate Bᴮ draws, above 7 10,000 draws, seed 20260921 |
| `horizons[].reason` | string | required, nullable | — | — | A: the engine's `note` in these words: `insufficient data` → "no completed outcomes at this horizon"; `too few blocks for an interval (B < 5)` → "fewer than five independent blocks"; `too few independent blocks to judge exclusion` → "fewer than ten independent blocks; the interval is shown but not judged"; `exclusion not established` → "the interval clears zero but 3% or more of resampled medians are adverse"; none → null. |
| `horizons[].verdict` | verdict enum | required | — | this `h` | A: v1 at this `h` |
| `horizons[].worst`, `best` | `{value, event_date, entry_date}` | required, nullable | `target_unit` | — | P: min and max over the `n` completed outcomes, the earliest event on ties. |
| `by_regime` | array of 4 | required | — | h = 20 | E `regime_split` at h = 20 |
| `by_regime[].h` | `20` | required | sessions | — | A (B-01) |
| `by_regime[].regime` | regime label | required | — | — | E |
| `by_regime[].n` | integer | required | events complete at h = 20 | — | E |
| `by_regime[].up_pct`, `median` | fraction, number | required, nullable (null when n < 10, `MIN_REGIME_N`) | —, `target_unit` | — | E |
| `unlabeled_n` | integer | required | events | — | E `provenance.n_unlabeled` |
| `last_events` | array of ≤ 5, newest first | required | — | — | P |
| `last_events[].event_date` | date | required | — | — | P |
| `last_events[].entry_date` | date | required, nullable (null when the entry session is after the stored data) | — | — | P |
| `last_events[].regime` | regime label | required | — | the K−2 row of the event's month | P (regime at K−2, already in the run): a retained event always carries its K−2 label; events whose K−2 month has no stored regimes row are counted in `unlabeled_n` and not listed. |
| `last_events[].value_20` | number | required, nullable (incomplete) | `target_unit` | — | P |
| `without_condition` | block envelope | required | — | — | awaiting, reason "conditional-versus-unconditional comparison is not defined" (v4 B-11, C-01); the shape once defined is §12.13 |
| `provenance.entry_rule` | string | required | — | — | E `provenance.entry_rule` |
| `provenance.cooldown` | integer | required, nullable (null for a cross; 14 for an RSI crossing) | sessions | — | E `cooldown_sessions` |
| `provenance.seed` | integer | required | — | — | E |
| `provenance.engine_version` | string | required | — | — | A |
| `provenance.series_start` | object, key → date | required | — | each input's first stored observation | E `provenance.inputs` |
| `warnings` | string[] | required (may be empty) | — | — | E `provenance.warnings`, each served verbatim except the engine's "calendar sessions without a value: …" entry: when an input's stored history starts before 1970-01-01, the served copy appends, right after that input's count, "(includes N pre-1970 holidays the engine calendar treats as sessions)". N counts the dates that are an `api/calendar` holiday before 1970, inside the input's stored range, a session of the study's own calendar, and a date on which the input has no stored value. A study with no pre-1970 input serves the engine's warnings unchanged. |
| `series` | array | required | — | — | E registry (`series.with_role`), limited to the series some catalog study reads: its shock, its target, or the S&P of `spx_below_50` (Codex R-03, desk/fill-etf; the legacy `/api/desk/event-study` keeps every role). The page's Shock and Target slots offer these only |
| `series[].key`, `label` | string | required | — | — | E |
| `series[].roles` | array of `shock` \| `target` \| `condition` | required | — | — | E registry `roles` |
| `series[].ops` | array of `up2s` \| `down2s` \| `cross_above` \| `cross_below` | required | — | — | A: the moves the catalog allows for that series as shock |
| `series[].unit` | `log_return` \| `log_change` \| `bp` | required | — | — | E |
| `client` | `{horizon, headline, summary}` | required, nullable | — | h = 20 | A: template (below) |
| `client.horizon` | `20` | required | sessions | — | A (B-01) |
| `client.headline`, `client.summary` | string | required | — | — | A: templates (below) |
| `empty_state` | `{horizon, sentence, fixes[]}` | required, nullable (non-null iff `horizons[selected].n < 10`) | — | `selected_horizon` | A: template (below) |
| `empty_state.horizon` | 5 \| 10 \| 20 \| 60 | required | sessions | — | A: `selected_horizon` |
| `empty_state.sentence` | string | required | — | — | A: template (below) |
| `empty_state.fixes[]` | `widen_window` \| `drop_condition` | required (may be empty) | — | — | A: offered only when the result is a catalog study |
| `inputs_hash` | string | required | — | — | E `provenance.inputs_hash`, native (B-09) |
| `served_from_cache` | boolean | required | — | — | A |
| `elapsed_ms` | number | required | ms | — | A |

Templates (A, fixed here; `<L>` is the horizon's label). Numbers in served
templates are printed by the engine's `fmt_move` (`src/desk/event_study.py:768`):
a log unit as `±x.x%` of 100 × native, a bp unit as `±x bp`; a share as a
percent with one decimal. The adapter then substitutes U+2212 (−) for a
number's leading hyphen, so a negative reads "−1.6%"; the page prints the
served string as is.
- `headline`: "<verdict label> at <L>: " followed by that verdict's §1.5
  definition, word for word from its first word after the dash (e.g.
  "Suggestive at 1 month: 10+ completed outcomes; excess medians lean the same
  way at 5, 10 and 20 sessions, but not all Reliable criteria are met."). It
  adds no advice; no recommendation is inferred from a verdict (§12.0).
- `why`: "<n> completed outcomes in <n_blocks> overlap blocks; the 90%
  interval on the excess median runs <ci_lo> to <ci_hi>; <adverse_share> of
  resampled medians are adverse against a 3% bar." With no interval: "<n>
  completed outcomes in <n_blocks> overlap blocks; <reason>."
- `empty_state.sentence`: "Only <n> events complete at <L> since
  <sample_start year>, fewer than the ten a verdict other than Too few
  needs."
- `client.headline`: the catalog `client_label` (§12.3), never `label` (§11: no σ). `client.summary`: "Looking at
  <matched_n> episodes since <sample_start year>, the <target label> was
  higher a month later in <up_n> of <n>, with a typical move of <median>
  against <baseline_median> in an ordinary month." (h = 20 values.)

### 12.3 `GET /study/catalog`

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `studies` | array of 15 | required | — | — | A: the catalog below |
| `studies[].slug` | string | required | — | — | A |
| `studies[].label`, `short` | string | required | — | — | A: one canonical label and short per slug, reused by every tab (v2 §19) |
| `studies[].client_label` | string | required, nullable (no catalog row is null since desk/fill-compute) | — | — | A: the Client view's title in plain words, no σ and no engine terms (§11; ruled in item 14, the 13 titles below approved in item 15) |
| `studies[].available` | boolean | required | — | the current generation | A: true when the engine completes on the pinned generation (v4 B-07): every input's coverage stored |
| `studies[].unavailable` | `{reason, until\|null}` | required, nullable (null when available) | — | — | E: the engine's `not_stored` reason, or the §1.0 reason |
| `studies[].question` | `{shock, window, move, while, target}` | required, nullable (no catalog row is null since desk/fill-compute) | — | — | A |
| `studies[].allowed_horizons` | subset of [5, 10, 20, 60] | required | sessions | — | A: [5, 10, 20, 60] for every row with a question, available or not (every row since desk/fill-compute). |

A study is `ready` when the existing engine completes on the pinned
generation; missing required inputs, or no evaluable history, is `awaiting`
with the reason; a completed run with zero retained events is `ready` with
an `insufficient` verdict; short-history warnings alone never make a study
unavailable (v4 B-07).

The catalog (v2 §2, v3 §2; z = 2.0 throughout; every row with a question
allows all four horizons):

| slug | label | short | client_label | shock | window | move | while | target | engine query |
|---|---|---|---|---|---|---|---|---|---|
| gold-2sigma-spx-weak | Gold +2σ while S&P weak | gold while S&P weak | Gold jumps over a month while the S&P is weak | gold | 20 | up2s | spx_below_50 | spx | preset `gold-2sigma-spx-weak` |
| golden-cross | S&P golden cross | golden cross | The S&P's 50-day average rises above its 200-day | spx | — | cross_above | none | spx | preset `spx-golden-cross` |
| death-cross | S&P death cross | death cross | The S&P's 50-day average falls below its 200-day | spx | — | cross_below | none | spx | preset `spx-death-cross` |
| vix-spike-2sigma-5d | VIX spike +2σ, 5 days | VIX spike | Stock-market volatility jumps within a week | vix | 5 | up2s | none | spx | `vix-w5-z2.0-up-none-spx` |
| hy-2sigma-20d | HY spreads +2σ, 20 days | HY spreads widening | High-yield credit spreads widen sharply over a month | hy_oas | 20 | up2s | none | spx | `hy_oas-w20-z2.0-up-none-spx` |
| 10y-2sigma-20d | 10y yield +2σ, 20 days | 10y yield up | The 10-year Treasury yield jumps over a month | us10y | 20 | up2s | none | spx | `us10y-w20-z2.0-up-none-spx` |
| dollar-2sigma-20d | Dollar −2σ, 20 days | dollar weak | The dollar falls sharply over a month | dxy | 20 | down2s | none | spx | `dxy-w20-z2.0-down-none-spx` |
| oil-2sigma-gold | Oil +2σ → gold | oil → gold | Oil jumps over a month, and what gold does next | wti | 20 | up2s | none | gold | `wti-w20-z2.0-up-none-gold` |
| spx-2sigma-10y | S&P −2σ → 10y | S&P drop → 10y | The S&P falls sharply over a month, and what the 10-year yield does next | spx | 20 | down2s | none | us10y | `spx-w20-z2.0-down-none-us10y` |
| spx-20d-2sigma | S&P 20-day move over 2σ | S&P 20-day move | The S&P rallies sharply over a month | spx | 20 | up2s | none | spx | `spx-w20-z2.0-up-none-spx` |
| spx-5d-2sigma | S&P 5-day move over 2σ | S&P 5-day move | The S&P rallies sharply within a week | spx | 5 | up2s | none | spx | `spx-w5-z2.0-up-none-spx` |
| 2s10s-2sigma-steepening | 2s10s +2σ steepening | 2s10s steepening | The yield curve steepens sharply over a month | curve_2s10s | 20 | up2s | none | spx | `curve_2s10s-w20-z2.0-up-none-spx` |
| oil-2sigma-20d | Oil +2σ, 20 days | oil spike | Oil jumps over a month | wti | 20 | up2s | none | spx | `wti-w20-z2.0-up-none-spx` |
| rsi-above-70 | RSI above 70 | RSI > 70 | The S&P's 14-day momentum gauge (RSI) climbs above 70 | spx | — | rsi_above_70 | none | spx | `spx-rsi-above-70` |
| rsi-below-30 | RSI below 30 | RSI < 30 | The S&P's 14-day momentum gauge (RSI) drops below 30 | spx | — | rsi_below_30 | none | spx | `spx-rsi-below-30` |

The two RSI rows (desk/fill-compute): the engine's `kind` `rsi` on the S&P,
the RSI of §12.7 crossing strictly above 70 (strictly below 30) on a session
whose preceding session's RSI was defined and not in that zone, a 14-session
cooldown after each retained crossing, entry and horizons as every S&P study.
Their client labels are drafted by this branch and await the owner's
approval (item 15 approved the other 13).

Served reasons: `/positions`: "Positions are kept in this browser; there is no server
position store."; `/basket/:id`, `/basket/price`, `/hedge`: "basket pricing
and option structures not yet defined in the engine."

The Event Study's slots enable an option only when some available catalog
row agrees with it and with the other slots' values. WTI (`wti`) and the
dollar index (`dxy`) are tier 2; the three studies that read them are
available only when a generation stores their coverage.

### 12.4 `GET /study/events`

Parameters as `/study`. `Accept: application/json` answers the envelope;
`Accept: text/csv` answers the CSV.

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `slug` | string | required | — | — | A |
| `events` | array, newest event first, every retained event | required | — | — | P: the run's full event table |
| `events[].event_date` | date | required | — | XNYS | P |
| `events[].entry_date` | date | required, nullable (null when the entry session is after the stored data) | — | XNYS | P (§4.1 entry rule) |
| `events[].regime` | regime label | required | — | K−2 row | P: a retained event always carries its K−2 label; events whose K−2 month has no stored regimes row are counted in `unlabeled_n` (§12.2) and not listed. |
| `events[].exit_<h>` (h = 5, 10, 20, 60) | date | required, nullable (null when incomplete) | — | XNYS | P |
| `events[].value_<h>` | number | required, nullable (null when incomplete) | the study's `target_unit`, native | — | P |
| `events[].complete_<h>` | boolean | required | — | — | P |

CSV (`text/csv; charset=utf-8`), columns in this order:
`event_date,entry_date,regime,exit_5,value_5,complete_5,exit_10,value_10,complete_10,exit_20,value_20,complete_20,exit_60,value_60,complete_60`.
Rows newest event first; values in native study units; nulls are empty
cells; booleans `true` / `false`.

### 12.5 `GET /ledger`

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `verdict_rule` | `"v1"` | required | — | — | A |
| `horizon` | `20` | required | sessions | — | A (B-01) |
| `comparison_session`, `prev_session` | date | required | — | XNYS | N firing state (as §12.1) |
| `scored_n` | integer | required | rows | — | A: rows whose study completed (an `insufficient` verdict counts as scored) (v4 B-02) |
| `unavailable_n` | integer | required | rows | — | A: 12 − `scored_n` |
| `signals` | array of 12, in §8's fixed order | required | — | — | A |
| `signals[].slug`, `label`, `short` | string | required | — | — | A: catalog |
| `signals[].group` | `"spx"` \| `"cross"` | required | — | — | A: `spx` for golden-cross, death-cross, spx-20d-2sigma, spx-5d-2sigma, rsi-above-70, rsi-below-30; `cross` for the rest |
| `signals[].available` | boolean | required | — | — | A (catalog) |
| `signals[].unavailable` | `{reason, until\|null}` | required, nullable | — | — | as §12.3 |
| `signals[].horizon` | `20` | required | sessions | — | A |
| `signals[].last_fired` | date | required, nullable | — | — | P: `last_event` |
| `signals[].sample_start` | date | required, nullable | — | — | E |
| `signals[].n` | integer | required, nullable (null when unavailable) | completed outcomes at h = 20 | — | E `horizon_stats` |
| `signals[].up_n` | integer | required, nullable | — | — | P |
| `signals[].up_pct` | fraction | required, nullable | — | — | E |
| `signals[].median`, `baseline_median` | number | required, nullable | `target_unit` | — | E |
| `signals[].vs_normal` | number | required, nullable | log pp or bp (§1.9) | — | A: v3 §6 formula |
| `signals[].target_unit`, `display_unit` | as §12.2 | required, nullable (null when unavailable) | — | — | E, A |
| `signals[].verdict` | verdict enum | required, nullable (null when unavailable) | — | h = 20 | A: v1 |
| `signals[].firing_now` | boolean | required, nullable | — | `evaluated_on` | N firing state: shocks — the raw trigger and the condition hold on `evaluated_on`, regardless of cooldown; crosses — true only on the strict crossing session; RSI crossings — the RSI is in the zone (strictly above 70, strictly below 30) on `evaluated_on`, regardless of the crossing rule and the cooldown |
| `signals[].firing_day` | integer | required, nullable (null unless `firing_now` is true) | sessions | — | N: consecutive qualifying XNYS sessions including `evaluated_on`, reset after any false or unevaluable session, never bridging a missing session; 1 for a cross |
| `signals[].evaluated_on` | date | required, nullable | — | — | N: the row's own latest evaluable session |
| `signals[].stale` | boolean | required | — | — | N (desk/fill-compute, owner's item 7): `evaluated_on` trails `comparison_session` by more XNYS sessions than the study's publication allowance, the most any of its inputs allows: 0 for a close an exchange prints (^GSPC, GC=F, ^VIX, ^NDX, the dollar index, USD/JPY), 3 for a FRED daily series (`api/freshness.DAILY_TOLERANCE`), 8 for WTI (`DESK_SLOW_PUBLICATION`, published weekly), or is dated after it; before, any `evaluated_on` other than `comparison_session` was stale; false for an unavailable row; a stale row is never called firing today |

### 12.6 `GET /regime`

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `current` | block envelope | required | — | — | — |
| `current.data.label` | regime label | required | — | row `print` · monthly · `regimes` | E stored row (`classify_regime`) |
| `current.data.print` | month | required | — | K−2 for the current session month | A (v2 §9.1) |
| `current.data.latest_print` | month | required | — | the newest stored row | E; shown on Regime only, never used to classify |
| `current.data.classifier` | `{month, label, odds, agrees}` | required, nullable (null when the newest row stores no finite odds) | —, —, fraction, — | the newest stored row · monthly · `regimes` | S (desk/fill-compute): the home page's classifier reading (`/api/regime/latest`): the newest row's four stored odds (`prob_goldilocks` … `prob_recession`, src/regime.py's softmax), its dominant label (the first of equal odds in that order) and those odds; `odds` is null when the label is Recession Risk (the Desk never shows `regimes.prob_recession`); `agrees` is `label` equal to `current.label` |
| `current.data.growth`, `inflation` | `"rising"` \| `"falling"` | required | — | as `print` | E signs of the stored trends |
| `current.data.months_in` | integer | required | months | — | A: the run of equal labels in consecutive stored months ending at `print`; a missing month ends the run |
| `current.data.since` | month | required | — | — | A |
| `current.data.freq`, `.source` | `"monthly"`, string | required | — | — | A: `"monthly"`, `"regimes table (src/regime.py)"` |
| `history` | array of 60 `{month, regime}` | required | — | monthly · `regimes` | E: the last 60 stored rows |
| `history_note` | `"labels as stored; revisions are not replayed."` | required | — | — | A |
| `history_freq`, `history_source` | `"monthly"`, string | required | — | — | A: as `current` |
| `recession` | block envelope | required | — | — | — |
| `recession.data.score` | fraction | required | — | `probability_month` · monthly | E `recession.get_recession_metrics` (`recession_prob`, a percent 0–100, ÷ 100) |
| `recession.data.probability_month` | month | required | — | the latest valid month this generation produces | N recession provenance (§13.2) |
| `recession.data.inputs_through` | month | required | — | — | N: the observations the score used (features shifted three months) |
| `recession.data.feature_months` | object, feature → month | required | — | — | N |
| `recession.data.band` | `"low"` \| `"elevated"` \| `"high_risk"` | required | — | — | A rule: low < 0.20 ≤ elevated < 0.40 ≤ high_risk (v3 §11) |
| `recession.data.band_edges` | `[0.20, 0.40]` | required | — | — | A |
| `recession.data.year_ago` | `{score, probability_month}` | required, nullable (null when that month is absent) | — | twelve months before | E: the served score series |
| `recession.data.peak` | `{score, probability_month, window: "since 2015"}` | required | — | — | N: the maximum of the served score series since 2015 |
| `recession.data.training` | `{start, end}` | required | months | — | N: the aligned training rows actually used; never a hard-coded 1970 |
| `recession.data.methodology` | string | required | — | — | A: "in-sample fitted scores" |
| `recession.data.freq`, `.source` | `"monthly"`, string | required | — | — | A: `"monthly"`, `"recession model (src/analytics/recession.py)"` |
| `next_prints` | block envelope | required | — | — | — |
| `next_prints.data.basis` | `{month, label}` | required | — | the K−2 row for the session month of the response | N (desk/fill-compute): the row the thresholds are read from, the one `current` shows; the block is awaiting whenever `current` is (no K−2 row) |
| `next_prints.data.next_row` | `{month, label, first_effective_month}` | required, nullable (null when the month after `basis` is not stored) | — | monthly · `regimes` | S: the stored row after `basis`, its label, and the first month it governs (`month` + 2) |
| `next_prints.data.cpi`, `.indpro` | object | required, nullable | — | — | N next-print thresholds (§13.2) |
| `next_prints.data.<k>.release_date` | date | required, nullable (null when the calendar has no record) | — | `event_calendar` | E |
| `next_prints.data.<k>.reference_month` | month | required | — | — | N |
| `next_prints.data.<k>.series` | `"CPIAUCSL"` \| `"INDPRO"` | required | — | — | A |
| `next_prints.data.<k>.threshold_mom` | fraction | required, nullable | m/m change | — | N: m is the `basis` month (desk/fill-compute: the K−2 row, no longer the latest stored row); x_prev is the series' value on the joint INDPRO–CPIAUCSL row before m; `threshold_mom = x_prev / x(m) − 1` (valid for the three-month window only); `threshold_mom` and `flips_to` are null when the series already has a value for m+1; equality is falling |
| `next_prints.data.<k>.from_direction` | `"rising"` \| `"falling"` | required | — | as `basis` | E: the sign of the basis row's own stored trend for this series' axis |
| `next_prints.data.<k>.printed_mom`, `printed_direction` | fraction, `"rising"` \| `"falling"` | required, nullable (null unless the series already has a value for m+1) | m/m change | `reference_month` | N: x(m+1) / x(m) − 1, and the axis row m+1 takes: the stored row's own trend sign when m+1 is stored, else rising iff x(m+1) > x_prev |
| `next_prints.data.<k>.operator` | `"<="` \| `">"` | required | — | — | N: `<=` flips a rising axis to falling; `>` a falling axis to rising |
| `next_prints.data.<k>.flips_to` | regime label | required, nullable (null when not evaluable) | — | — | N: from the `basis` row's other-axis sign |
| `next_prints.data.<k>.first_effective_month` | month | required | — | — | N: `reference_month` + 2 months |
| `next_prints.data.<k>.freq`, `.source` | `"monthly"`, string | required | — | — | A: `"monthly"`, the FRED series id; the release date's source is `event_calendar` |
| `stats` | block envelope | required | — | — | — |
| `stats.data.rows` | array of 4, in the order Goldilocks, Overheating, Stagflation, Recession Risk | required | — | monthly · `regimes`, `asset_prices` ^GSPC, the registry's `vix` | N regime statistics (desk/fill-compute; FRAME3_DATA_AUDIT.md §2.4's method): every stored regimes row counts once, as stamped, no K−2 lag |
| `stats.data.rows[].regime`, `months` | regime label, integer | required | months | — | S: the stored rows with that label (Q8) |
| `stats.data.rows[].spx_n` | integer | required | months | — | N: those months with a complete S&P month: the close on the month's last XNYS session and on the previous month's last XNYS session both stored |
| `stats.data.rows[].spx_median_mo`, `spx_mean_mo` | fraction | required, nullable (null when `spx_n` is 0) | simple return | — | N: median and mean of close(last session of m) / close(last session of m − 1) − 1 over the `spx_n` months |
| `stats.data.rows[].up_pct` | fraction | required, nullable | — | — | N: the share of the `spx_n` months above zero |
| `stats.data.rows[].vix_avg`, `vix_days` | number, integer | required (`vix_avg` nullable when `vix_days` is 0) | VIX points, sessions | — | N: the mean of every stored VIX daily close (`asset_prices` ^VIX) dated in those months, and how many there are; `vix_avg` null and `vix_days` 0 while ^VIX is not stored (a store before its first full refresh after desk/fill-compute), the S&P columns served and `source` saying so |
| `stats.data.window` | `{start, end, n}` | required | months | — | S: the first and last stored rows and their count |
| `stats.data.freq`, `.source` | `"monthly"`, string | required | — | — | A |
| `changes` | block envelope | required | — | — | — |
| `changes.data.rows` | array of ≤ 5, newest first | required | — | monthly · `regimes`, `asset_prices` ^GSPC | N (desk/fill-compute): the stored rows whose label differs from the previous stored row's (Q9; a missing month is not bridged into a change of its own, the change is dated by the row that carries the new label) |
| `changes.data.rows[].month`, `from`, `to`, `from_month` | month, regime label, regime label, month | required | — | — | S: the row, the previous stored row's label, its label, the previous stored row's month |
| `changes.data.rows[].spx_1m`, `spx_1m_month` | fraction, month | required (`spx_1m` nullable until that month is over) | simple return | — | N: the S&P's simple return over the calendar month after `month`, on the rule of `stats` |
| `changes.data.n` | integer | required | changes | — | N: every change in the stored rows |
| `changes.data.window`, `.freq`, `.source` | `{start, end, n}`, `"monthly"`, string | required | — | — | A |

### 12.7 `GET /technicals`

Every field describes the registry series `spx` (^GSPC).

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `price` | number | required, nullable | index points | `date` · daily · `asset_prices` ^GSPC | E `event_study.load_level`, newest session |
| `date` | date | required | — | — | E |
| `freq`, `source` | `"daily"`, string | required | — | — | A |
| `chg_1d` | fraction | required, nullable | simple return | `chg_1d_dates` | N (B-12): close(to) / close(from) − 1 on exact indexed XNYS endpoints |
| `chg_1d_dates` | `{from, to}` | required | — | — | N |
| `ret_1y` | fraction | required, nullable | simple return | `ret_1y_dates` | N (B-12): against the close 252 sessions earlier |
| `ret_1y_dates` | `{from, to}` | required | — | — | N |
| `ma50`, `ma200` | number | required, nullable (null if any required close is missing) | index points | `date` | N MAs (v3 §13): simple means over the last 50 / 200 XNYS session slots, aligned as the engine aligns, no calendar compression |
| `ma50_window`, `ma200_window` | `{start, end, n}` | required | sessions | — | N: the slots each average reads (`n` 50 / 200 when complete) |
| `vs_ma50`, `vs_ma200` | fraction | required, nullable | level ratio | `date` | N (B-12): price / ma − 1 |
| `trend.state` | as §12.1 `tiles.trend.data.state` | required | — | `date` | N |
| `trend.state_since` | date | required, nullable | — | — | N |
| `cross` | `{kind: "golden"\|"death", date}` | required, nullable | — | — | E `cross_positions` |
| `move_20d_sigma` | number | required, nullable | σ | `move_20d_date` | N firing state: the spx-20d-2sigma study's z (`zscore(move(level, spx, 20))`) on its `evaluated_on` |
| `move_20d_date` | date | required, nullable | — | — | N |
| `rsi` | number | required, nullable (null when no session has a defined RSI) | index points 0–100 | `rsi_date` · daily · `asset_prices` ^GSPC | N RSI (desk/fill-compute): `src/analytics/technicals.rsi` (the shared, symbol-agnostic copy), Wilder's RSI(14): seeded from the plain means of 14 close-to-close changes over 15 contiguous valid closes, then avg = (avg × 13 + x) / 14; no losses with gains → 100, no gains with losses → 0, both zero → 50; a missing close breaks the run and the RSI is undefined until 14 new changes re-seed it; the newest defined value |
| `rsi_date` | date | required, nullable | — | — | N: the session of `rsi` (a gap in the closes holds it on the last session before the gap until the RSI re-seeds) |
| `rsi_prev`, `rsi_prev_date` | number, date | required, nullable | index points | — | N: the RSI on the XNYS session before `rsi_date` (null when undefined there), and that session |
| `rsi_last_above_70`, `rsi_last_below_30` | `{date, rsi, after_20d, after_20d_to}` | required, nullable (null when the RSI has never been in that zone) | —, index points, simple return, — | — | N: the last session with the RSI strictly above 70 (strictly below 30), its RSI, and the S&P's simple return from that close to the close 20 XNYS sessions later (`after_20d_to`); both null until that session has a stored close |
| `macd` | object | required, nullable (null when no session has a defined MACD) | index points | `macd.date` · daily · `asset_prices` ^GSPC | N MACD (desk/fill-compute, owner's item 9): `src/analytics/technicals.macd` (the shared, symbol-agnostic copy, series in, MACD out) on the closes aligned to the XNYS calendar: `macd` = EMA(12) − EMA(26) of the closes, `signal` = EMA(9) of `macd`, `hist` = `macd` − `signal`; each EMA has alpha 2 / (span + 1) and is seeded at its span-th contiguous value with the plain mean of those values; a missing close breaks every average that reads it, and they are undefined until they re-seed (nothing bridges a gap) |
| `macd.date`, `.macd`, `.signal`, `.hist` | date, numbers | required | index points | — | N: the newest session with a defined histogram (a gap in the closes holds it on the last session before the gap until the averages re-seed), and the three values there |
| `macd.last_cross` | `{date, kind: "above"\|"below"}` | required, nullable (null when the line has never crossed its signal) | — | — | N: the latest strict crossing, `technicals.macd_crossings`: a session whose histogram is strictly positive (negative) after the side carried was the other one; a zero histogram keeps the carried side; an undefined session resets it, so a crossing never bridges one (the rule of the 50/200-day crosses) |
| `macd.params` | `{fast: 12, slow: 26, signal: 9}` | required | sessions | — | A |
| `seasonality` | object | required, nullable (null when no calendar month is complete) | — | `seasonality.window` · monthly · `asset_prices` ^GSPC | N seasonality (desk/fill-compute, owner's item 10): `src/analytics/technicals.monthly_seasonality` (the shared, symbol-agnostic copy, series in) over every stored close aligned on the XNYS calendar from the first stored close through the last day of the newest close's month (`api/desk_items_macro.month_closes`, the regime table's input): a month's simple return is its last session's close over the previous month's last session's close, less one; a month whose last session has no stored close (a month not over yet included), or the month after one, has none |
| `seasonality.rows` | array of 12 `{month, label, n, avg, pct_up, first_year, last_year}` | required | —, —, years, simple return, fraction, year, year | — | N: calendar order; `n` the years with a return for that month, `avg` their mean, `pct_up` the share strictly above zero, `first_year`/`last_year` the first and last of them; `avg`, `pct_up` and the years null when `n` is 0 |
| `seasonality.window` | `{start, end, n}` (months) | required | months | — | N: the first and last months with a return, and how many there are |
| `seasonality.freq`, `.source` | `"monthly"`, `"asset_prices ^GSPC"` | required | — | — | A |
| `macd.series` | array of `{date, macd, signal, hist}` | required | index points | daily | N chart series: one point per session of `series.6m` (the XNYS sessions after `date` − 6 calendar months, through `date`); each value null where undefined |
| `series.6m`, `.1y`, `.3y` | array of `{date, close, ma50, ma200}` | required | index points | daily | N chart series (v3 §13): the XNYS sessions after `date` − 6, 12 and 36 calendar months, through `date`; a missing close is a point with `close: null`; `ma50`/`ma200` nullable per point |
| `signals_allowlist` | `["golden-cross","death-cross","rsi-above-70","rsi-below-30","spx-20d-2sigma","spx-5d-2sigma"]` | required | — | — | A (v2 §13; the RSI rows since desk/fill-compute). Not served, the Signals list reads "Awaiting refresh"; served empty, it is an empty panel (Codex round 3, R-26) |
| `vol` | block envelope | required | — | — | awaiting: "needs stored SPY option snapshots and a versioned skew method." |
| `sectors` | block envelope | required | — | — | N sector leadership (§12.14, desk/fill-etf): the `/sectors` fields without `breadth`, from the same worker item, so the two agree; awaiting with the route's reason while the store lacks the ETFs |

### 12.8 `GET /macro`

B registers DGS3MO, DGS5 and DGS30 (FRED daily, tier 1) beside DGS2 and
DGS10 (v2 §12). Until then those tenors are null.

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `curve` | block envelope | required | — | — | — |
| `curve.data.today` | `{"3m","2y","5y","10y","30y": number\|null, date, dates}` | required | percent (yield) | `date` shared, or null with per-tenor `dates` · daily · FRED | N curve snapshot alignment (B-12) over stored DGS*: `today.date` is the latest date on which every stored tenor has a value; `dates` names it per tenor (null for a tenor not stored); when no such date exists, `date` is null and each tenor its own newest |
| `curve.data.today.dates` | object, tenor → date | required on every path | — | — | N: the common date, or each tenor's own date when that snapshot's `date` is null; null for a tenor not served (S-30). |
| `curve.data.month_ago` | same shape | required | percent | the last common observation on or before `today.date` − 1 calendar month | N month-ago selection (B-12): same shape; the last common observation on or before `today.date` − 1 calendar month. When `today.date` is null, `date` is null and each tenor carries its newest observation on or before its own `today.dates` entry − 1 calendar month; with a common `today.date` but no common date a month earlier, `date` is null and each tenor carries its newest observation on or before `today.date` − 1 calendar month. |
| `curve.data.month_ago.dates` | object, tenor → date | required on every path | — | — | N: the common date, or each tenor's own date when that snapshot's `date` is null; null for a tenor not served (S-30). |
| `curve.data.2s10s_bp` | number | required, nullable | bp | `today.date` | N: (DGS10 − DGS2) × 100 on `today.date`; null whenever a date it needs, `today.date` or `month_ago.date`, is null. |
| `curve.data.2s10s_chg_bp`, `10y_chg_bp` | number | required, nullable | bp | the two dates | N dated differences (B-12); null whenever a date it needs, `today.date` or `month_ago.date`, is null (so both are null when the tenors share today's date but not a month ago's). |
| `curve.data.freq`, `source` | `"daily"`, `"FRED"` | required | — | — | A |
| `credit` | block envelope | required | — | — | — |
| `credit.data.hy`, `.ig` | `{value, date, freq, source}` | required | percent (OAS) | own `date` · daily · FRED BAMLH0A0HYM2, BAMLC0A0CM | E: HY the newest `desk_series` observation; IG `source_watermarks` `fred:BAMLC0A0CM` (`last_obs`, `last_value`) |
| `credit.data.hy_pct_3y` | fraction | required, nullable | — | `rank_window` | N rolling HY rank (v2 §12, v3 §12): count(values < current) / count(valid) over the closed three-year window ending on the HY date, current included, ties not below |
| `credit.data.hy_range_3y` | `[lo, hi]` | required, nullable | percent | `rank_window` | N |
| `credit.data.rank_window` | `{start, end, n, expected_n, valid_n, missing_n, first_obs, last_obs}` | required | — | XNYS sessions less bond closures | N: Expected sessions are the XNYS sessions of the engine's calendar (`exchange_calendars`) in the window, minus `api/calendar.bond_extra_closures`; `valid_n` counts every finite stored observation dated in the window (weekend month-end prints included); `n = valid_n`. Coverage is a finite observation on every expected session (v4 B-07). `api/calendar`'s holiday tables cover every year the store holds, generated from `exchange_calendars`' bounded regular and ad hoc holidays; they agree with its sessions from 1970 on and are the authority before 1970. |
| `credit.data.reason` | string | required, nullable | — | — | N: non-null exactly when the 3-year figures are null ("coverage from <date> only", or the gap) |
| `credit.data.band` | `"tight"` \| `"normal"` \| `"wide"` | required, nullable | — | — | A rule: tight < 0.30 ≤ normal < 0.70 ≤ wide on `hy_pct_3y` |
| `credit.data.band_edges` | `[0.30, 0.70]` | required | — | — | A |
| `credit.data.series` | array of `{date, hy}` | required | percent | `line_window` | N: the 12-month line window |
| `credit.data.line_window` | `{start, end, n}` | required | — | — | N: [HY date − 12 months, HY date] |
| `credit.data.peak_12m` | `{date, hy}` | required, nullable | percent | — | N: in-window maximum, earliest date on ties |
| `stock_bond` | block envelope | required | — | — | N stock–bond correlation (desk/fill-etf); awaiting with "Awaiting refresh: the full refresh stores <symbols>; this database predates it." while SPY or TLT is not stored |
| `stock_bond.data.today` | number | required, nullable | correlation | `today_date` · daily · `asset_prices` SPY, TLT | N: Pearson's r of SPY's and TLT's daily log returns (ln P(s) / P(s−1), both closes stored) over the 60 XNYS return dates ending at `today_date`, the newest session both close on; null unless all 60 pairs are complete (no forward fill) |
| `stock_bond.data.today_date`, `today_reason` | date, string | required, nullable | — | — | N: `today_reason` non-null exactly when `today` is null |
| `stock_bond.data.year_ago`, `year_ago_date` | number, date | required, nullable | correlation | the last XNYS session on or before `today_date` − 12 calendar months | N: the same correlation on that session |
| `stock_bond.data.flipped`, `flipped_on`, `flipped_to` | month, date, `"positive"` \| `"negative"` | required, nullable (null when the stored history holds no change of sign) | — | — | N: among the sessions with a complete window, in order, zeros skipped, the newest session whose sign differs from the one before; `flipped` its month |
| `stock_bond.data.series` | array of `{date, corr}` | required | correlation | `line_window` | N: the correlation on every XNYS session after `today_date` − 12 calendar months, through `today_date`; `corr` null where the window is incomplete |
| `stock_bond.data.window`, `line_window` | `{start, end, n}` | required | sessions | XNYS | N: the 60 return dates of `today`; the line's sessions |
| `stock_bond.data.stock`, `bond` | `{etf, name}` | required | — | — | A: SPY, TLT |
| `stock_bond.data.transform`, `unit`, `date`, `freq`, `source`, `providers` | `"daily log return"`, `"correlation"`, date, `"daily"`, `"asset_prices"`, string[] | required | — | — | A, S |
| `correlations` | block envelope, data an array | required | — | — | N what moves with the S&P (desk/fill-etf); awaiting with "Awaiting refresh: …" while SPY, or every listed asset, is not stored |
| `correlations.data[]` | `{asset, symbol, quantity, transform, corr, date, window, reason}` | required | — | — | in this order: TLT, IEF, HYG, LQD, GLD, UUP, IWM, QQQ, and VIX (FRED VIXCLS) when the store holds it |
| `correlations.data[].corr` | number | required, nullable | correlation | `date` · daily | N: Pearson's r of SPY's daily log returns and the asset's (VIX: daily log changes of the level) over the 60 XNYS return dates ending at `date`, the newest session both hold a value, every pair complete (no forward fill) |
| `correlations.data[].date`, `window` | date, `{start, end, n}` | required, nullable (when the asset is not stored) | — | XNYS | N |
| `correlations.data[].symbol`, `quantity`, `transform` | string | required | — | — | A: the registry's series id; "adjusted close" (VIX "index level (FRED VIXCLS)"); "daily log return" (VIX "daily log change") |
| `correlations.data[].reason` | string | required, nullable | — | — | N: non-null exactly when `corr` is null: "Awaiting refresh: the full refresh stores <symbol>; this database predates it.", or "fewer than 60 complete daily return pairs in the window to <date>" |
| `matrix` | block envelope | required | — | — | awaiting: "the 12-asset matrix's assets and method are not specified yet." |

### 12.9 `GET /pipeline` and `GET /pipeline/ddl`

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `last_refresh_utc` | ts | required, nullable ("unknown" in the UI when null) | — | `source_watermarks` row `"desk_series"` | S: that row's `checked_at` (the Desk store runs only in the full refresh), never the run artifact |
| `validation` | `"pass"` \| `"fail"` | required, nullable | — | the published `validation.json` | S: the verdict of the `validation.json` published with the served database. Both writers publish it: `refresh-data.yml` and `intraday-refresh.yml`, each in the mode it validates in, as `{verdict, mode, timestamp, db_sha256}`, uploaded after the database. The API binds a verdict by one procedure, run at the download (on the downloaded file) and at every poll (on the served file): read the file's key (k1); require the file's `-wal` to be absent or empty (at a download, `<DB_PATH>-wal` too); hash the file and compare with `db_sha256`; read the key again (k2) and check that the WAL of step 2 (at a download, both) is still absent or empty; bind only when the sha matches, k1 equals k2 and the WAL is still empty, binding exactly k1, with no further sample of the key. It serves the verdict only for the generation with that key; missing, mismatched, WAL-present or re-keyed → null (the UI prints "unknown"). |
| `groups` | array | required | — | — | E registry and its consumers (`/api/desk/pipeline/inventory`) |
| `groups[].name` | string | required | — | — | A: Rates, Credit, Equities & vol, FX & commodities, Macro (monthly), Sector ETFs, Equity ETFs, Bond, gold & dollar ETFs (the last three since desk/fill-etf) |
| `groups[].status` | `"current"` \| `"stale"` \| `"missing"` | required | — | — | A: the worst of its series |
| `groups[].series` | array | required | — | — | E |
| `…series[].label`, `id`, `key` | string (`key` nullable for a non-Desk series) | required | — | — | E registry |
| `…series[].provider` | string | required | — | — | E |
| `…series[].freq` | `"daily"` \| `"weekly"` \| `"monthly"` | required | — | — | E |
| `…series[].first`, `last` | date | required, nullable | — | first and last stored observation | S: the first and last stored observation; for a FRED daily series stored month-stamped in `raw_series`, `last` is its `source_watermarks` `last_obs` and `first` its first month stamp. |
| `…series[].feeds` | string[] | required | — | — | A: the Desk tabs that read the series, a fixed table in the adapter (the inventory's `FEEDS` names main-app readers). |
| `…series[].status` | `"current"` \| `"stale"` \| `"missing"` | required | — | — | E `api/freshness` mapped as §12.1 |
| `…series[].note` | string | required, nullable | — | — | E registry note |

`/pipeline/ddl` answers `text/plain; charset=utf-8`: the contents of
`api/static/snowflake_proposed.sql`, the one copy of the proposed Snowflake
export schema (not the current SQLite layout; the file says so in its first
line), served verbatim by the route and read by the fixture.

### 12.14 `GET /sectors` (desk/fill-etf, 2026-09-27)

Served from one worker item, `desk_etf` (`api/desk_items_etf.py`), rebuilt
with every generation. It reads the stored `asset_prices` closes of SPY and
the eleven SPDR sector ETFs (`src/desk/series.py` `SECTOR_ETFS`) through the
engine's reader and aligns them onto the XNYS calendar; a session without a
close is a gap, never filled. Adjusted closes, stored by the full refresh
(EODHD first, Yahoo fallback).

| Field | Type | Presence | Unit | Date · freq · source | Engine basis |
|---|---|---|---|---|---|
| `window_months` | `3` | required | months | — | A |
| `window` | `{start, end, n}` | required | sessions | XNYS | N sector leadership: `end` is `compared_on`; `start` the XNYS session 60 before it; `n` 60 (v3 A-18) |
| `compared_on` | date | required | — | the newest session with an SPY close | N |
| `unit` | `"log_return"` | required | — | — | A |
| `band` | `0.01` | required | log fraction | — | A: the bars' ±1% band and the pattern rule's |
| `benchmark` | `{etf: "SPY", name, ret}` | required | log fraction | `window` | N: ln(SPY(end) / SPY(start)) |
| `leadership` | array of 11 | required | — | — | N: ranked by `rel_ret`, highest first (ties by ticker), the rows without one after, in `SECTOR_ETFS` order |
| `leadership[].etf`, `name`, `short` | string | required | — | — | A: `SECTOR_ETFS` |
| `leadership[].group` | `"cyclical"` \| `"defensive"` | required, nullable (XLC, XLRE) | — | — | A: the pattern rule's groups |
| `leadership[].rel_ret` | number | required, nullable | log fraction | `window` | N: ln(P(end) / P(start)) − ln(SPY(end) / SPY(start)); null when either close of the ETF is not stored |
| `leadership[].ret` | number | required, nullable | log fraction | `window` | N: ln(P(end) / P(start)) |
| `leadership[].first` | date | required, nullable | — | — | S: the ETF's first stored close (XLC 2018-06-19, XLRE 2015-10-08) |
| `leadership[].reason` | string | required, nullable | — | — | N: non-null exactly when `rel_ret` is null: "no close on <date>: its history starts <first>", "no close stored for <date>", or "not stored in this database" |
| `ranked_n` | integer | required | sectors | `window` | N (Codex R-01): how many rows carry `rel_ret`; the ranking is only among them |
| `missing` | array of `{etf, name, reason}` | required (may be empty) | — | — | N (Codex R-01): the rows without `rel_ret`, in the rows' order, each with its `reason` |
| `pattern.rule`, `pattern.band` | `"sector-pattern-v1"`, `0.01` | required | — | — | A |
| `pattern.cyclicals`, `pattern.defensives` | string[] | required | — | — | A: XLB, XLE, XLF, XLI, XLK, XLY; XLP, XLU, XLV (XLC and XLRE in neither) |
| `pattern.spread` | number | required, nullable | log fraction | `window` | N: the cyclicals' mean `rel_ret` less the defensives'; null unless all nine are served |
| `pattern.word` | `"cyclical"` \| `"defensive"` \| `"mixed"` | required, nullable | — | — | A rule `sector-pattern-v1`: spread > band cyclical, spread < −band defensive, otherwise mixed (strict both ways); null with `spread` |
| `pattern.reason` | string | required, nullable | — | — | N: the members not served, when `word` is null |
| `date`, `freq`, `source` | date, `"daily"`, `"asset_prices"` | required | — | — | A: `date` is `compared_on` |
| `providers` | string[] | required | — | — | S: the providers of the rows read, in words ("Yahoo", "EODHD") |
| `breadth` | block envelope | required | — | — | N breadth, below; awaiting with the route's reason while the store lacks the ETFs |
| `breadth.data.compared_on`, `date` | date | required | — | `compared_on` of the route | N: the same session as leadership |
| `breadth.data.of_total` | `11` | required | sector ETFs | — | A |
| `breadth.data.above_50`, `above_200` | `{n, of, compared_on, window, by_etf, not_available}` | required | sector ETFs | `window` · daily | N: for each sector ETF, above = close(`compared_on`) > the simple mean of its closes over the 50 (200) XNYS session slots ending there (strict; every slot must hold a close, the §12.7 rule); `by_etf` holds the ETFs it can be read for, `not_available` the others with the reason; `n` counts true, `of` the ETFs in `by_etf` (a sector not available is counted in neither) |
| `breadth.data.eqw_vs_cap_3m` | number | required, nullable | log fraction | `relative_window` | N: ln(RSP(end) / RSP(start)) − ln(SPY(end) / SPY(start)) over the 60 sessions |
| `breadth.data.eqw_vs_cap_reason` | string | required, nullable | — | — | N: non-null exactly when `eqw_vs_cap_3m` is null |
| `breadth.data.eqw_vs_cap_series` | array of `{date, rel}` | required | log fraction | `eqw_vs_cap_line_window` | N: the same 60-session difference on every XNYS session after `compared_on` − 12 calendar months, through `compared_on`; `rel` null where a close it needs is not stored |
| `breadth.data.eqw_vs_cap_line_window` | `{start, end, n}` | required, nullable (no RSP) | sessions | — | N |
| `breadth.data.small_vs_large_3m`, `small_vs_large_reason`, `small_vs_large_series`, `small_vs_large_line_window` | as the four above | required | as above | as above | N: IWM against SPY |
| `breadth.data.relative_window` | `{start, end, n: 60}` | required | sessions | XNYS | N |
| `breadth.data.unit`, `freq`, `source`, `providers` | `"log_return"`, `"daily"`, `"asset_prices"`, string[] | required | — | — | A, S |

The route answers `awaiting` with "Awaiting refresh: the full refresh stores
<symbols>; this database predates it." when SPY or every sector ETF is
absent (a database older than the first full refresh after desk/fill-etf).
A parameter is refused 422 `unsupported`. Display (§1.9): `rel_ret`, `ret`
and `spread` print as 100 × native with a % sign, labelled "log returns ×100".

### 12.13 Deferred shapes (`status: deferred`)

(§12.10 to §12.12 are retired; the number 12.13 is kept for the history.)

Each shape below is recorded for when it is built. None is served on
Monday: its route or block answers the awaiting envelope, and the UI renders
§1.0.2. The fields keep these names; the corrections listed apply when they
are built. (The frame-3 fields of the Codex round 1 block, and the other
PROPOSED fields of the earlier §12.13, are superseded by §12.1–§12.9 and by
this section.)

**Positions — `status: deferred`** (`GET /positions`; `POST` answers 405).
The server shape, when one exists, is the browser record of §9: `{id,
instrument, direction: "long"|"short", size_nav: fraction|null,
horizon_days, variant, pre_mortem, red_team: string|null, wrong_if: {id,
label}, subject, monitoring: "automatic"|"manual", entry_ts, entry_date,
entry_value, trigger: {series, operator, threshold, policy: "frozen",
observed_on}, original_room, evaluation: "close", closes: [{type, ts,
premortem_right: boolean|null}]}` and the list's `closed_90d: {falsified,
expired, premortem_right: [yes, judged]}`. `dv01` is null until a notional
exists. The gate rule of §9 is the server's rule.

**Basket — `status: deferred`** (`GET /basket/:id`, `POST /basket/price`
answering 405). `{id, name, short, instrument, rebalance, prices_as_of,
baskets: [{id, name}], legs: [{symbol, name|null, weight}]}` (weight in
percent) plus the priced fields `{benchmark: {symbol, label}, ret_3m,
bench_ret_3m, residual, residual_window, falsifies_at, month_ago, vol,
bench_vol, vol_ratio, beta, series: [{date, value}]}`, each nullable; the
price answer carries its own `prices_as_of`.

**Hedge — `status: deferred`** (`GET /hedge?mode=protect|express|neutralize`
with one subject). `{mode, subject: {kind, id, label}, surface,
surface_as_of, provider, beta, options: [...], recommended}`. Corrections
that apply when built (v2 §17): the hedge notional is a selected budget,
not beta-neutral sizing (neutralize = 100 × beta / |net delta|); breakeven
and loss are `option_breakeven_underlying_return`, `option_max_loss_nav` and
`hedged_book_max_loss_nav`, each with its denominator stated; contracts,
strikes, expiry, quantity, quote timestamps and signed Greeks are served;
`expiration_date`, `current_dte` and `roll_date` are distinct fields.

**Vol — `status: deferred`** (`/technicals` `vol` block; `GET /vol`).
`{source: "eodhd", skew_25d_1m_pts, skew_pct_2y, skew_trend,
atm_iv_1m, realized_20d, term: {"1m","3m","6m"}, history_from}` with each
value's date. Needs stored SPY option snapshots and a versioned skew
method; `realized_20d` needs its method specified, and the Overview's
`tiles.vol` `gap` and `band` are served since desk/fill-compute (§12.1, realized over 21 daily log returns; the Technicals vol column still waits on the option snapshots).

**Sectors — served since desk/fill-etf (§12.14); this deferred shape is
kept for the history** (`/technicals` `sectors` block; `GET /sectors`). `{window_months: 3, leadership: [{etf, name, short, rel_ret}]
(sorted best first), breadth: {above_50: {n, of, compared_on, by_etf},
above_200: {n, of, by_etf}, eqw_vs_cap_3m, eqw_vs_cap_series: [{date, rel}],
small_vs_large_series: [{date, rel}]}}`. When activated: relative return =
log(P_ETF(t) / P_ETF(t−60)) − log(P_SPY(t) / P_SPY(t−60)) on adjusted closes
(v3 A-18); the display and the ±1% band are specified at activation;
breadth serves its comparison date; missing history is "not available",
never "below".

**Correlations — `stock_bond` and `correlations` served since desk/fill-etf
(§12.8); `matrix` `status: deferred`** (`/macro` `stock_bond`,
`correlations`, `matrix`). `stock_bond: {today, year_ago, flipped, series:
[{date, corr}]}`, `correlations: [{asset, symbol, quantity, transform,
corr}]`, `matrix: {assets, labels, window, values}`. Each asset declares
`symbol`, `quantity` and `transform`; Pearson over the same trailing 60 XNYS
return dates, 60 complete pairs, no forward fill (v2 §12).

(The RSI shape once deferred here is served since desk/fill-compute: the
`/technicals` fields in §12.7, the two studies and Ledger rows in §12.3 and
§12.5.)

**Confidence — `status: deferred`** (`/study?confidence=0.80|0.90|0.95`,
`confidence_note`). Changes only the interval quantiles, on identical seeded
draws; never `adverse_share`, the 3% bar or any verdict, which stay at the
90% exclusion (v2 §8, v3 §8).

**without_condition — `status: deferred`** (`/study` `without_condition`
block, awaiting on Monday). `{matched_n, n, up_pct, median, baseline_median,
verdict, comparison: "improves"|"no_improvement"|"insufficient",
comparison_note}`. Before it is enabled, a later version specifies the
companion query, the horizon, sample matching, the baseline treatment, the
direction of improvement and the decision rule (v4 B-11). No improvement
classification or comparison prose is generated until then.

---

## 13. Build order, engine scope and acceptance

### 13.1 Session B's order
1. The envelope and `unavailable` on every route (§12.0), the deferred stubs
   included (GET awaiting, removed writes 405).
2. `/study` and `/study/catalog` (§12.2, §12.3): catalog normalization, the
   public aliases (main's engine slugs and legacy URLs unchanged; `slug_for`
   not modified), presets precomputed and cached. `/study`, `/study/events`,
   `/study/catalog` and the preset precompute use the existing bounded study
   concurrency, timeout and single-flight policy of `api/security.py`, added
   to the middleware's study path list in the same commit that adds the
   routes; a request of only `preset=<catalog slug>` (with an optional
   `horizon`), and a bare `/study/catalog`, is a lookup and reads under the
   stored-read ceiling, as `?study=<preset>` does; engine aliases, worker
   precompute and middleware registration change together (v3 §2, §20).
   Ordinary stored reads stay on their own pool.
3. `/study/events` and its CSV (§12.4).
4. `/ledger` (§12.5).
5. `/technicals` (§12.7).
6. `/regime` (§12.6).
7. `/macro` (§12.8), registering DGS3MO, DGS5 and DGS30.
8. `/overview` (§12.1), composed from the above.
9. `/pipeline` (§12.9).

Each with a fixture-shape test. Regression gate (v3 A-18): for every
existing query under identical inputs, the native event set, per-horizon
outcomes, baselines and the engine's 90% exclusion results are unchanged; no
native result or hash change is permitted, and any that appears is a
blocking finding. The adapter schema, the public aliases and the v1 verdict
labels are tested separately as new outputs. No new series beyond the three
FRED tenors.

### 13.2 Engine work allowed for Monday (v3 §23, v4 B-12)

**Projections of the existing run** (no change to sample or estimator): an
immutable full event table retained from the existing `_run` (event index,
entry index, exit index per horizon, native outcome per horizon, regime at
K−2); per-horizon counts, extrema, first and last event; the CSV;
provenance dates. `matched_n`, per-horizon `n`, `up_n`, extrema,
`first_event`, `last_event`, `last_events` and the CSV are projections of
that table; nothing is reconstructed from `recent_events` and no
event-selection logic is copied.

**New calculations allowed:** the firing state (v3 §3, as §12.5 states
it), with the z of the spx-20d-2sigma study it evaluates served as
`/technicals` `move_20d_sigma`; the 50- and 200-day averages, trend state and chart series (§12.7);
`chg_1d`, `ret_1y`, `vs_ma50`, `vs_ma200` on exact XNYS endpoints; the
next-print inverse thresholds (§12.6); the rolling HY statistics (§12.8);
the recession provenance extraction (§12.6); the Desk `data_status`
(§12.1); the curve snapshot alignment, month-ago selection and dated
differences (§12.8); `vol_change_pts`, `regime_from`, `regime_to` and
`regime_changed` (§12.1); the three FRED tenor series. These do not
authorize any conditional-improvement judgment. Added by desk/fill-etf
(2026-09-27): the 24 ETF series in `asset_prices`; sector leadership and
its pattern rule, and breadth of the 11 sector ETFs (§12.14); the
stock–bond correlation and what moves with the S&P (§12.8).

**Not allowed for Monday** (the blocks are unavailable): RSI (added after
Monday, below); confidence
80% / 95%; the regime statistics table and change outcomes (added after
Monday, below); the
without-condition comparison; everything §1.0 lists as unavailable. No
implementation may broaden scope to satisfy an illustrative shape.

**Added after Monday (desk/fill-compute, 2026-09-27, by the owner's brief).**
Each is a new calculation from stored data, listed in §12 with its rule:
- the 14-day RSI on ^GSPC, `src/analytics/technicals.rsi` (the shared, symbol-agnostic copy), served by `/technicals` (§12.7);
- MACD (12, 26, 9) on ^GSPC and its last crossover, `src/analytics/technicals.macd` and `macd_crossings` (symbol-agnostic:
  a close series in, MACD out), served by `/technicals` `macd` (§12.7; the owner's item 9);
- the S&P's seasonality by calendar month, `src/analytics/technicals.monthly_returns` and `monthly_seasonality`
  (symbol-agnostic; the regime table's month returns now read the same `monthly_returns`), served by `/technicals`
  `seasonality` (§12.7; the owner's item 10);
- what each regime has meant and the last five changes on `/regime` (`stats`, `changes`, §12.6), on the audit's §2.4 method;
- the VIX read from `asset_prices` ^VIX (^GSPC's path) instead of FRED VIXCLS, and `stale` judged per study by its inputs'
  publication cadence (§12.2, §12.5; the owner's item 7). A store its first full refresh after desk/fill-compute has not
  reached holds no ^VIX rows: the vol tile awaits with the engine's words ("awaiting the next full refresh"), the VIX
  studies are unavailable with the same reason, `data_status` names ^VIX missing, and the regime table serves its S&P
  columns with `vix_avg` null. The stored VIXCLS rows are kept (never deleted), no longer refreshed or read by the Desk;
- the S&P's 21-day realized volatility, `src/analytics/technicals.realized_vol`, and the VIX's band word and gap to it on `/overview` `tiles.vol` (§12.1);
- the two RSI studies, the engine's `kind` `rsi` (strict crossings of 70 and 30, a 14-session cooldown), scored by the
  existing engine and the v1 verdict rule like every catalog study (§12.3, §12.5). Existing studies' native results and
  hashes are unchanged: the RSI's own parameters enter only an RSI study's `inputs_hash`.

### 13.3 Session A
Fixtures under `web/src/fixtures/desk/` in the §12 shapes (envelopes
included), with the real values of `FRAME3_DATA_AUDIT.md` wherever it marks
a value COMPUTABLE and illustrative values, marked as such, elsewhere. Per
tab: build from the PNG and this file; screenshot at 1440 wide; compare with
the PNG; verifier; commit. Acceptance: every tab renders from fixtures;
every number on screen traces to a §12 field; no color outside §1.3; no
"established" or "significant"; typecheck, unit, build and the Desk browser
tests green.
