# FRAME3_DATA_AUDIT.md: what the store can produce for Desk v2

Session C, branch `desk/frame-3-docs` (cut from `main` at `482e128`; the handoff is commit `3d8d804`),
2026-09-24. Read-only: no code, config, test or data file was changed; every query ran against a copy
of the store in a temporary directory; nothing was pushed.

**How the numbers were produced.**

- **The store.** `make sync-data` fetched the published snapshot into this worktree's gitignored
  `data/macro_radar.db`. It was then byte-copied twice: to `$TMPDIR/frame3-audit.8s60MA/store.db` and
  to `…/tree/data/macro_radar.db`.
- **The code.** `git archive HEAD api src config scripts` was exported into `…/tree`. The app's modules
  hard-code `data/macro_radar.db`, so every module read the copy. The export has no `.env`.
- **API values.** They came from the API's own routes, called in-process: `fastapi.testclient.TestClient`
  with no lifespan, the relay off (`EODHD_API_TOKEN=" "`), and the worker built lazily on the copy
  (generation 1, key `(103409468, 1790288288377011094, 16384000)`).
- **Studies.** They came from the engine's own `src.desk.event_study.run()` against the same file.
- **Direct SQL.** Every query ran with `sqlite3 -readonly` and is listed at the end of §1 (Q1 to Q13).
- **Method agreement.** Six studies ran both ways: through the API route and through the engine's
  `run()`. Their horizons, regime splits, recent events and `inputs_hash` were identical.

**Statuses** (§2 onward). COMPUTABLE: a function in `src/desk/`, `api/`, or the `src/analytics/` module an `api/` route calls produces the value now, and an API route serves it
(not necessarily in the §12 shape). NEEDS-ENDPOINT: an engine function can produce it, no route serves it.
NEEDS-COMPUTATION: the data is stored, no function computes it (a value shown for such a row comes from a
direct query listed at the end of §1 and says so). NEEDS-SERIES: an input is not stored. NOT-DERIVABLE: no data or
rule can give it.

**Units.** The engine's percentage moves are 100 × log returns (its `fmt_move`). "Δ" is the engine's
median minus its own baseline median; intervals are on Δ, in percentage points (pp) for a price target
and basis points (bp) for a yield target. "Exclusion" words are the engine's per-horizon field values:
`established`, `not established`, `included`; "—" means no interval (fewer than 5 blocks).

---

## 1. Store as audited

**The copy queried.**

| Item | Value |
|---|---|
| Source | Release `data-latest`, asset `macro_radar.db`, 16,384,000 bytes, updated **2026-09-24T21:45:51Z** (`make sync-data`: verdict `pass`, integrity `ok`) |
| sha256 (worktree file, `store.db`, `tree/data/macro_radar.db`: identical) | `9a8b857968b8de2213a5c87847d2e6d026c376d5cf2c6b44e5098b8f8e69b1f8` |
| Snapshot date | 2026-09-24 (release asset time above) |
| As-of, event-study engine | **2026-09-23** for the S&P and gold studies (`provenance.as_of`); 2026-09-22 for studies that read VIX or the 10-year |
| As-of, `desk_series` watermark | 2026-09-22 (the oldest newest observation of its five series; advanced 2026-09-24T05:07:11Z) |
| As-of, other layers | `market_daily` 2026-09-24 · `asset_prices` 2026-09-23 · `raw_series` month stamp 2026-09 (daily FRED values through 2026-09-23 per `source_watermarks`) · `regimes` 2026-08 (the Aug print) |
| NYSE session at audit time | post-close 2026-09-24 (`/api/freshness.session`) |

**Row counts, Desk tables.**

| Table | Rows | What the Desk reads |
|---|---|---|
| `desk_series` | 51,381 | `BAMLH0A0HYM2` 787 (2023-09-25 → 2026-09-23) · `DGS10` 16,166 (1962-01-02 → 2026-09-22) · `DGS2` 12,574 (1976-06-01 → 2026-09-22) · `T10Y2Y` 12,575 (1976-06-01 → 2026-09-23) · `VIXCLS` 9,279 (1990-01-02 → 2026-09-22) |
| `asset_prices` (interval `1d`) | 89,746 (all symbols) | `^GSPC` 9,248 (1990-01-02 → 2026-09-23) · `GC=F` 6,541 (2000-08-30 → 2026-09-23) · `^RUT` 9,248 (1990-01-02 → 2026-09-23) |
| `regimes` | 363 | 1996-05 → 2026-08, one row per month except **2025-10** (missing; Q10) |
| `source_watermarks` | 28 | 6 Desk rows (`desk_series`, `desk:<id>` × 5) |
| `desk_series_runs`, `desk_series_quarantine` | not present | These exist only on the unmerged `desk/hardening` work |

Two methods agree on every Desk count: the engine's `assets_with_coverage()` `rows` and SQL `COUNT(*)` (Q12)
both give 9,248 / 6,541 / 16,166 / 12,574 / 12,575 / 9,279 / 787 / 9,248.

**The 26 series.** The Data Pipeline mockup and the frame-3 fixture (`web/src/fixtures/desk/pipeline.json`
on `desk/frame-3`) list 26 series. What the store holds for each:

| Group (fixture) | Series | Id | In the store as | First | Last | Ingested daily for the Desk? |
|---|---|---|---|---|---|---|
| Rates | 3-month Treasury | DGS3MO | not stored | | | no |
| Rates | 2-year Treasury | DGS2 | `desk_series` daily | 1976-06-01 | 2026-09-22 | **yes** |
| Rates | 5-year Treasury | DGS5 | not stored | | | no |
| Rates | 10-year Treasury | DGS10 | `desk_series` daily | 1962-01-02 | 2026-09-22 | **yes** |
| Rates | 30-year Treasury | DGS30 | not stored | | | no |
| Credit | High-yield OAS | BAMLH0A0HYM2 | `desk_series` daily (and `raw_series` monthly) | 2023-09-25 | 2026-09-23 | **yes** (watermark `short`) |
| Credit | Investment-grade OAS | BAMLC0A0CM | `raw_series` month-stamped | 1996-12 | 2026-09 stamp (value of 2026-09-23) | no (monthly only) |
| Credit | BB OAS | BAMLH0A1HYBB | `raw_series` month-stamped | 1996-12 | 2026-09 stamp (2026-09-23) | no |
| Credit | Single-B OAS | BAMLH0A2HYB | `raw_series` month-stamped | 1996-12 | 2026-09 stamp (2026-09-23) | no |
| Credit | CCC OAS | BAMLH0A3HYC | `raw_series` month-stamped | 1996-12 | 2026-09 stamp (2026-09-23) | no |
| Equities & vol | S&P 500 | ^GSPC | `asset_prices` 1d | 1990-01-02 | 2026-09-23 | **yes** (no 2026-09-22 row) |
| Equities & vol | Nasdaq 100 | ^NDX | not stored (registered tier 2, `planned`) | | | no |
| Equities & vol | Russell 2000 | ^RUT | `asset_prices` 1d | 1990-01-02 | 2026-09-23 | **yes** (no 2026-09-22 row) |
| Equities & vol | S&P 500 equal weight | RSP | not stored | | | no |
| Equities & vol | VIX | VIXCLS | `desk_series` daily | 1990-01-02 | 2026-09-22 | **yes** |
| Equities & vol | VIX 3-month | VXVCLS | not stored | | | no |
| FX & commodities | Dollar index | DX-Y.NYB | `asset_prices` **1mo** only | 1971-01-01 | 2026-09-01 | no (registered tier 2, `planned`) |
| FX & commodities | Dollar–yen | DEXJPUS | not stored (`JPY=X` 1mo in `asset_prices`, 1996-10 → 2026-09) | | | no |
| FX & commodities | Gold | GC=F | `asset_prices` 1d | 2000-08-30 | 2026-09-23 | **yes** |
| FX & commodities | WTI crude | WCOILWTICO | not stored (registry has `DCOILWTICO`, tier 2, `planned`) | | | no |
| Macro (monthly) | CPI | CPIAUCSL | `raw_series` monthly | 1996-03 | 2026-08 | monthly; **2025-10 missing** |
| Macro (monthly) | Industrial production | INDPRO | `raw_series` monthly | 1996-03 | 2026-08 | monthly |
| Macro (monthly) | Unemployment rate | UNRATE | `raw_series` monthly | 1996-03 | 2026-08 | monthly; 2025-10 missing |
| Macro (monthly) | Payrolls | PAYEMS | not stored | | | no |
| Macro (monthly) | Retail sales | RSAFS | not stored | | | no |
| Macro (monthly) | Fed funds rate | FEDFUNDS | `raw_series` monthly | 1996-03 | 2026-08 | monthly |

Tally of the 26:

- **7 are stored daily where the engine can read them:** DGS2, DGS10, BAMLH0A0HYM2, ^GSPC, ^RUT, VIXCLS
  and GC=F.
- **9 are stored monthly only:** the four other OAS series, CPI, INDPRO, UNRATE, FEDFUNDS and the
  dollar index.
- **10 are not stored at all.**

The store also holds series the 26 omit. `T10Y2Y` (the 2s10s the Position Monitor watches) is in
`desk_series`. `raw_series` holds 19 FRED ids: the ones above plus T10YIE, T5YIE, DFII5, DFII10, SOFR,
USREC and USSLIND. `asset_prices` holds 25 symbols and `market_daily` 23. The pipeline route
`/api/desk/pipeline/inventory` serves **29 rows**: 24 app feeds plus 5 `desk:*` rows.

**Validation warnings the store carries.**

- `scripts/validate_db.py --mode full` on the copy returned **pass with 2 warnings** (verbatim):
  - `desk:BAMLH0A0HYM2 short: fred; served from 2023-09-25; stored from 2023-09-25; 787 rows; declared 2023-09-22`
  - `asset_prices delayed: Last completed session 2026-09-24 not yet stored; the full refresh has until 06:00 UTC. …`
- `--mode verify-only`: pass, no warnings.

The validator does not flag three data facts this audit found, and each changes a number below:

1. **The 2026-09-22 close is missing from `asset_prices` for nine symbols:** `^GSPC`, `^RUT`, AGG, DJP,
   EEM, EFA, HYG, IEF and LQD. The same day is present for GC=F, GLD, IWM and SPY (SPY's `market_daily`
   bar is 773.38).
   - The engine's 50- and 200-day averages need an unbroken window.
   - So the golden and death-cross rule and the "S&P below its 50-day" condition were **last evaluable on
     2026-09-21**. They stay unevaluable until that close is stored. If it never is, they stay unevaluable
     until the gap leaves the window: 50 sessions for the condition, 200 for the cross.
   - Every S&P study warns `calendar sessions without a value: spx 1`.
2. **No `regimes` row for 2025-10.** `raw_series` has no October 2025 CPIAUCSL or UNRATE.
   - Under the K−2 lag, December 2025 sessions are `Unlabeled`, outside every study's totals.
   - The served recession series has no 2026-01-31 point (the recession model shifts its inputs three
     months).
3. **HY OAS daily history starts 2023-09-25.** FRED serves ICE BofA series as a rolling three years.
   The `hy_oas` z-score needs 252 sessions, so HY studies are evaluable only from 2024-10-04.

Each study also carries its own engine warnings (`provenance.warnings`), e.g. `off-session observations dropped: us10y 41`
and `calendar sessions without a value: us10y 232` (bond-market holidays).

### Direct queries (Q1 to Q13)


Run with `sqlite3 -readonly` on `tree/data/macro_radar.db` (sha256 above). §2 to §7 cite them as Q1 to Q13.

```sql
-- Q1 last two S&P closes
SELECT date, close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date DESC LIMIT 2;
--   2026-09-23 7706.02978515625 | 2026-09-21 7764.7001953125

-- Q2 plain average of the last 50 / 200 stored closes (NOT the engine's rolling rule)
SELECT (SELECT AVG(close) FROM (SELECT close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date DESC LIMIT 50)),
       (SELECT AVG(close) FROM (SELECT close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date DESC LIMIT 200));
--   7624.83739257813 (from 2026-07-14) | 7192.01200683594 (from 2025-12-04)

-- Q3 one-year return
SELECT a.close/b.close - 1 FROM
 (SELECT close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' ORDER BY date DESC LIMIT 1) a,
 (SELECT close FROM asset_prices WHERE symbol='^GSPC' AND interval='1d' AND date <= '2025-09-23' ORDER BY date DESC LIMIT 1) b;
--   0.157596887989266 (7706.03 / 6656.92, 2025-09-23)

-- Q4 each desk_series series: newest value and the last on or before one month earlier
--   BAMLH0A0HYM2 2026-09-23 2.73 | 2026-08-21 2.70
--   DGS10        2026-09-22 4.96 | 2026-08-21 4.74
--   DGS2         2026-09-22 4.71 | 2026-08-21 4.24
--   T10Y2Y       2026-09-23 0.26 | 2026-08-21 0.50
--   VIXCLS       2026-09-22 14.21 | 2026-08-21 15.13

-- Q5 HY OAS daily, three years to 2026-09-23
SELECT MIN(value), MAX(value), COUNT(*), MIN(date),
       1.0*SUM(value < (SELECT value FROM desk_series WHERE series_id='BAMLH0A0HYM2' ORDER BY date DESC LIMIT 1))/COUNT(*)
FROM desk_series WHERE series_id='BAMLH0A0HYM2' AND date > date('2026-09-23','-3 years');
--   2.59 | 4.61 | 787 | 2023-09-25 | 0.155019059720457
-- Q5b peak in the last 12 months:   2026-03-30 3.46

-- Q6 IG OAS month-stamp row and its observation date
--   2026-09-01 0.77 | watermark fred:BAMLC0A0CM last_obs 2026-09-23

-- Q7 VIX newest daily:   2026-09-22 14.21

-- Q8 regime months by label
SELECT label, COUNT(*) FROM regimes GROUP BY label;
--   Overheating 213 | Stagflation 102 | Goldilocks 27 | Recession Risk 21

-- Q9 regime changes
WITH x AS (SELECT date, label, LAG(label) OVER (ORDER BY date) AS prev FROM regimes)
SELECT COUNT(*) FROM x WHERE prev IS NOT NULL AND prev <> label;
--   123; last five: 2026-08 Goldilocks→Overheating, 2026-07 Overheating→Goldilocks,
--   2026-01 Stagflation→Overheating, 2025-09 Overheating→Stagflation, 2025-06 Stagflation→Overheating

-- Q10 missing regime months 1996-05 → 2026-08:   2025-10-01
--   (raw_series has no 2025-10 CPIAUCSL or UNRATE row)

-- Q11 2s10s at the position's open and now
--   T10Y2Y 2026-09-02 0.40 | 2026-09-23 0.26   (DGS10−DGS2: 0.40 on 09-02, 0.25 on 09-22)

-- Q12 rows per Desk input
--   ^GSPC 9248 | GC=F 6541 | ^RUT 9248 | BAMLH0A0HYM2 787 | DGS10 16166 | DGS2 12574 | T10Y2Y 12575 | VIXCLS 9279

-- Q13 the last four regime rows
--   2026-08 Overheating | 2026-07 Goldilocks | 2026-06 Overheating | 2026-05 Overheating

-- The 2026-09-22 gap
SELECT symbol, group_concat(date) FROM asset_prices
WHERE interval='1d' AND date BETWEEN '2026-09-21' AND '2026-09-23' GROUP BY symbol;
--   2026-09-22 absent for AGG DJP EEM EFA HYG IEF LQD ^GSPC ^RUT; present for GC=F GLD IWM SPY
```

---

## 2. Per-tab tables

### 2.1 01 Overview

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| SINCE LAST CLOSE "Dollar −2σ fired (new)" | `overview.since_last_close.new_fires` | | NEEDS-SERIES | DX-Y.NYB daily not stored (tier 2). "New since last close" also needs a comparison with the previous generation, which the store does not keep |
| "2s10s still firing, day 10" | `since_last_close.still_firing[].day` | | NEEDS-COMPUTATION | The engine has no firing flag or firing duration. Its last 2s10s +2σ (20-session) event is 2025-04-21 (§4) |
| "vol up 0.8 pts, skew steeper" | `vol_change_pts`, `skew_direction` | | NEEDS-SERIES | No stored ATM IV or skew (§5) |
| "regime unchanged" | `regime_changed`, `regime_from`, `regime_to` | | NEEDS-COMPUTATION | Needs the previous close's label. By print, the label changed at the last print: Jul 2026 Goldilocks → Aug 2026 Overheating (`/api/regime/history`) |
| "data refreshed 00:23 UTC" | `refreshed_at_utc` | Last full run checked the Desk series at 2026-09-24T15:52:43Z; they last advanced 05:07:11Z | NEEDS-ENDPOINT | In `source_watermarks`; `/api/freshness` serves observation dates, not run times |
| REGIME "Overheating" | `tiles.regime.label` | **Overheating** | COMPUTABLE | `/api/regime/latest`, row 2026-08-01 (`src/regime.py` rule) |
| "Aug print" | `tiles.regime.print` | 2026-08 | COMPUTABLE | Same row |
| "Growth rising" | `tiles.regime.growth` | rising (`growth_trend` +0.1131) | COMPUTABLE | Sign of the stored 3-month OLS slope of the INDPRO level |
| "inflation rising" | `tiles.regime.inflation` | rising (`inflation_trend` +0.7815) | COMPUTABLE | Same rule on the CPIAUCSL level |
| (months in regime) | `tiles.regime.months_in` | **1** (mockup data: 3) | COMPUTABLE | `/api/regime/duration` `months_in_regime` 1.0; SQL (Q13) agrees: 2026-07 was Goldilocks |
| RECESSION "12%" | `tiles.recession.prob` | **11.64%** | COMPUTABLE | `/api/recession/probability` `recession_prob`, `probability_source: recession_model`; last point of `recession_prob_series`, 2026-08-31 |
| "Low" | `tiles.recession.band` | "Low Risk" | COMPUTABLE | `recession_label` |
| "on data through May" | `tiles.recession.inputs_through` | 2026-05 | NEEDS-ENDPOINT | Not a served field. The 2026-08-31 reading reads its features shifted three months (`src/analytics/recession.py:256`). The served `data_as_of` (2026-09-30) is a month-end bucket, not this |
| S&P 500 TREND "Above 50 & 200" | `tiles.trend.above_50`, `above_200` | Engine: no value on 2026-09-23 (rule unevaluable). Q2 plain averages: above both (7,706.03 vs 7,624.84 and 7,192.01) | NEEDS-COMPUTATION | No function returns the averages; see §1, data fact 1 |
| "since the Jul 2025 golden cross" | `tiles.trend.since`, `since_signal` | 2025-07-01, golden cross | COMPUTABLE | `spx-golden-cross` `recent_events[0]`, inputs_hash `d5b36893fd64e23e` |
| "that signal is reliable" | `tiles.trend.since_verdict` | Engine: 20-session exclusion `established` (n 14, 14 blocks, adverse share 1.7%) | NEEDS-COMPUTATION | The §1.5 Reliable / Suggestive / No-edge mapping is not in the engine |
| VOL · VIX "16.2" | `tiles.vol.vix`, `date` | **14.21** (2026-09-22) | NEEDS-ENDPOINT | `desk_series` VIXCLS. `/series/VIXCLS/latest` serves 14.21 under its month stamp 2026-09-01, so no route serves value and day together (§1.7) |
| realized 20d (11.9 in §12.1) | `tiles.vol.realized_20d` | | NEEDS-COMPUTATION | 20-session realized volatility of the S&P. `src/analytics/volatility.py` computes a 30-day SPY figure for Streamlit only |
| "protection costs about 4 pts more" | `tiles.vol.gap_pts` | | NEEDS-COMPUTATION | VIX minus the realized figure above |
| Active signals: S&P golden cross, 31× since 1990, up 68%, +2.7%, +1.4 pts, Reliable | `active_signals[]` | **14×** (evaluable since 1996-07-01), up 78.6%, median +2.67%, Δ +1.36 pp; last 2025-07-01 | COMPUTABLE | `d5b36893fd64e23e`. Pill: NEEDS-COMPUTATION (mapping) |
| S&P death cross, 29×, 52%, +0.9%, −0.4, No edge | `active_signals[]` | **14×**, up 57.1%, +2.05%, Δ +0.74 pp; last 2025-04-14 | COMPUTABLE | `af06a9b701fafd52` |
| Gold +2σ while S&P < 50d, 18× since 2000, 67%, +3.1%, +1.8, Suggestive | `active_signals[]` | **18×** since 2000, up 66.7%, +3.09%, Δ +1.78 pp; last 2025-04-16 | COMPUTABLE | `879a8a1f76831fad` |
| VIX +2σ in 5 days, 41×, 71%, +2.2%, +0.9, Reliable | `active_signals[]` | **119×**, up 66.4%, +1.51%, Δ +0.20 pp; last 2026-06-05 | COMPUTABLE | `ca8915ae8989e9a4` |
| 2s10s +2σ steepening, 22×, 45%, −0.6%, −1.9, No edge | `active_signals[]` | **49×**, up 71.4%, +1.59%, Δ +0.30 pp; last 2025-04-21 | COMPUTABLE | `45fce898de3f5d6a`; window 20 assumed (spec gives none, §10) |
| Verdict pills on the five rows (Reliable · No edge · Suggestive · Reliable · No edge) | `active_signals[].verdict` | Engine at 20 sessions: `established` · `included` · `included` · `included` · `included` | NEEDS-COMPUTATION | The §1.5 mapping |
| Monitored rows (three positions) | `monitored[]` | | NOT-DERIVABLE | No positions store (§10, item 14). §7 does the arithmetic on live levels |
| Sidebar TODAY "S&P today +0.4%" | (sidebar) | | NEEDS-COMPUTATION | No one-session change for 2026-09-23 exists in `asset_prices` (the 2026-09-22 close is missing) |
| Sidebar "Data ● current" | (sidebar) | `overall: current` | COMPUTABLE | `/api/freshness` |

### 2.2 02 Technicals

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| PUTS vs CALLS · 1 MONTH "+6.8 pts" | `vol.skew_25d_1m_pts` | | NEEDS-SERIES | 25-delta put and call IV from the SPY chain (§5) |
| WHAT OPTIONS EXPECT "15.4" | `vol.atm_iv_1m` | | NEEDS-SERIES | ATM IV, 1 month |
| WHAT HAPPENED "11.9" | `vol.realized_20d` | | NEEDS-COMPUTATION | As in §2.1 |
| 1 · 3 · 6 MONTHS "15.4 · 16.8 · 17.5" | `vol.term` | | NEEDS-SERIES | ATM IV at 3 tenors |
| SKEW "74th pct" | `vol.skew_pct_2y` | | NEEDS-SERIES | Needs a stored skew history |
| "Rising since June" | `vol.skew_trend` | | NEEDS-SERIES | Same |
| "history from Q4 2023" | `vol.history_from` | | NEEDS-SERIES | The EODHD history start is the spec's claim; not verified here (no provider call made) |
| PRICE "6,412" | `technicals.price` | **7,706.03** (2026-09-23) | NEEDS-ENDPOINT | `asset_prices` ^GSPC (Q1; the engine's `load_level` reads the same row). No route serves the ^GSPC close with its date |
| "+0.4% today" | `technicals.chg_1d` | | NEEDS-COMPUTATION | 2026-09-22 close missing (§1) |
| 50-DAY AVERAGE "6,280" | `technicals.ma50` | 7,624.84 (Q2) | NEEDS-COMPUTATION | Q2 is the plain average of the last 50 stored closes, spanning 51 sessions (2026-07-14 → 2026-09-23). The engine's rolling average is NaN on 2026-09-23 |
| 200-DAY AVERAGE "5,910" | `technicals.ma200` | 7,192.01 (Q2) | NEEDS-COMPUTATION | 200 stored closes from 2025-12-04 |
| "price is 2.1% above" / "8.5% above" | derived | +1.06% / +7.15% (arithmetic on Q1, Q2) | NEEDS-COMPUTATION | |
| Chart 6M / 1Y / 3Y | `technicals.series` | (9,248 stored closes) | NEEDS-ENDPOINT | |
| Callout "Jul 1, 2025: the 50-day crossed above the 200-day" | `technicals.cross` | golden, **2025-07-01** | COMPUTABLE | Engine preset `spx-golden-cross` |
| "happened 31 times … higher a month later 68% … Reliable" | ledger row | 14 events, up 78.6% at 20 sessions, exclusion `established` | COMPUTABLE | Pill: NEEDS-COMPUTATION |
| 1-YEAR RETURN "+14.2%" | `technicals.ret_1y` | +15.76% (Q3: 7,706.03 vs 6,656.92 on 2025-09-23) | NEEDS-COMPUTATION | |
| TREND "Up" | `technicals.trend` | | NEEDS-COMPUTATION | Needs the averages (above) |
| LAST 20 DAYS "+0.6σ" | `technicals.move_20d_sigma` | **−0.28σ** (2026-09-23) | NEEDS-ENDPOINT | Engine functions `align` → `move(w=20)` → `zscore` (252-session window), composed as `_run` composes them; no route serves it |
| Golden cross 31× · 68% · +2.7% · Reliable | ledger | 14× · 78.6% · +2.67% · `established` at 20 | COMPUTABLE | |
| Death cross 29× · 52% · +0.9% · No edge | ledger | 14× · 57.1% · +2.05% · `included` at 20 (`established` at 60) | COMPUTABLE | |
| RSI above 70 64× · 59% · +1.1% | ledger | | NEEDS-COMPUTATION | The engine has no RSI signal |
| RSI below 30 22× · 73% · +3.4% | ledger | | NEEDS-COMPUTATION | Same |
| 5-day move over 2σ 88× · 55% · +0.6% | ledger | **188×** · 66.5% · +1.89% · `included` | COMPUTABLE | `spx-w5-z2.0-abs-none-spx`, `3f68ce31b9f64634`; sign "either way" assumed (§10) |
| Verdict pills on the five signal rows | `signals[].verdict` | | NEEDS-COMPUTATION | The §1.5 mapping |
| "In this regime (Overheating): golden cross has fired only 9 times" | study `by_regime` | **5** | COMPUTABLE | Engine regime split `n_events` |
| "A normal month is +1.3%" | `normal_month` | +1.30% (golden-cross baseline median, 20 sessions) | COMPUTABLE | Each study serves its own baseline (+1.30% to +1.31% for S&P targets) |
| Sector leadership bars (XLK +6.1 … XLU −4.8) | `sectors.leadership` | | NEEDS-SERIES | XLV, XLP, XLU are not stored. XLK, XLI, XLF, XLE are in `market_daily` from 2026-02-18 only (152 bars), outside any Desk table |
| RSI NOW "58", LAST ABOVE 70 "Jun 12", LAST BELOW 30 "Apr 8, 2025", gauge, both note boxes | `technicals.rsi*` | | NEEDS-COMPUTATION | RSI and its thresholds as signals |

### 2.3 03 Event Study (the gold preset)

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| Preset chips: Gold +2σ while S&P weak · Golden cross · Death cross · VIX spike · Credit spreads +2σ · 10y yield +2σ · S&P −2σ → 10y | `preset=<slug>` | 7 run (§3) | COMPUTABLE | The spec's slugs are not the engine's (§10) |
| Preset chips: Dollar −2σ · Oil +2σ → gold | `preset=<slug>` | 503 `not_stored` | NEEDS-SERIES | DX-Y.NYB and DCOILWTICO daily (tier 2) |
| "every slot lists the same 12 series" | assets | 12 selectable shock series; 7 stored, 5 `planned` | COMPUTABLE | `/api/desk/event-study/assets`. Targets: 7 listed, 5 stored |
| WINDOW 5 / 10 / 20 / 60 | `window` | 5, 20, 60 | NEEDS-COMPUTATION | The engine accepts `w ∈ {5, 20, 60}`; `w=10` answers 422 (checked) |
| MOVE "crosses above / below MA" | `move` | S&P 50/200 cross only | NEEDS-COMPUTATION | A cross is `kind=cross` on `spx` only |
| WHILE "S&P above its 50-day" | `while=spx_above_50` | | NEEDS-COMPUTATION | Not an engine condition (422, checked) |
| Confidence 80 / 90 / 95 | `confidence` | 90% served. 80% and 95% computed in §3 by calling `horizon_stats(ci=)` | NEEDS-ENDPOINT | `Query` has no confidence field, and `inputs_hash` is identical at every level (§10) |
| Headline "Leans positive a month out, but not something to size on." | `headline` | Engine text: "S&P 500 is not distinguishable from baseline at 5, 10, 20, 60 sessions" | NEEDS-COMPUTATION | The spec's register would be a new mapping from the engine's fields |
| "last Apr 16, 2025" | `last_event` | **2025-04-16** | COMPUTABLE | `recent_events[0].date` |
| "○ Not firing today" | `firing_now` | | NEEDS-COMPUTATION | No firing rule in the engine. The condition is also unevaluable on 2026-09-22 and 09-23 (§1) |
| "● Live · 0.3s, cached" | `served_from_cache`, `elapsed_ms` | | NEEDS-ENDPOINT | The route does not report either |
| EVENTS "18" since 2000 | `n_events`, `sample_start` | **18**. Data from 2000-08-30, evaluable 2001-09-19 → 2026-09-21 | COMPUTABLE | `879a8a1f76831fad` |
| UP A MONTH LATER "67% (12 of 18)" | `horizons[h=20].up_pct`, `up_n` | **66.7% (12 of 18)** | COMPUTABLE | |
| MEDIAN AT A MONTH "+3.1%" vs "+1.3%" | `median`, `baseline_median` | **+3.09%** vs **+1.31%** | COMPUTABLE | |
| WORST · BEST "−9.4% / +12.0%" | `horizons[h=20].worst`, `best` | | NEEDS-COMPUTATION | The engine serves the last 10 events only. Their best is +12.04% (2025-04-16); no min or max over all 18 is served |
| Bars, after the event: +1.2 / +1.6 / +3.1 / +2.9 | `horizons[].median` | +1.58 / +1.94 / +3.09 / +2.99 (%) | COMPUTABLE | |
| Bars, a normal stretch (gray) | `baseline_median` | +0.34 / +0.67 / +1.31 / +3.19 (%) | COMPUTABLE | |
| Without the condition "41 events, up 58%, median +1.6%: No edge" | `without_condition` | **33** events, up 60.6%, +2.32%, `included` at all four horizons | COMPUTABLE | Second engine run `gold-w20-z2.0-up-none-spx`, `c0e59b63011cf87e` |
| VERDICT · SUGGESTIVE "Lean, don't size." | `verdict` | Engine: `included` at 5, 10, 20, 60 | NEEDS-COMPUTATION | The §1.5 mapping |
| "about 9% of resamples come out negative at a month" | `why` | **14.6%** (`opposite_sign_share`, h 20) | COMPUTABLE | |
| "a 1-month call spread is the cheap way in …" | `why` (action) | | NOT-DERIVABLE | A trade suggestion; no engine output, and the options it prices are not stored |
| BY REGIME: Goldilocks 5 · 80% · +4.2% | `by_regime[]` | n **2**; cells suppressed (`n<10`) | COMPUTABLE | The engine suppresses below 10; the spec says below 5 (§10) |
| Overheating 6 · 67% · +2.8% | `by_regime[]` | n **6**; suppressed | COMPUTABLE | |
| Stagflation 5 · 60% · +1.9% | `by_regime[]` | n **9**; suppressed | COMPUTABLE | |
| Recession Risk 2 · n<5 | `by_regime[]` | n **1**; suppressed | COMPUTABLE | |
| "Today is Overheating: six events" | note | 6 | COMPUTABLE | |
| LAST FIVE EVENTS: Apr 16 2025 Overheating +12.0% · Oct 27 2023 Stagflation +8.1% · Mar 9 2023 +3.4% · Sep 27 2022 −2.2% · Mar 4 2022 −0.8% | `last_events[]` | 2025-04-16 Overheating +12.04% · 2023-03-23 Stagflation +4.10% · 2022-03-01 Stagflation +4.80% · 2020-04-09 Stagflation +5.92% · 2019-08-23 Goldilocks +3.02% | COMPUTABLE | `recent_events` (labels at K−2 months) |
| RANGE vs NORMAL at 90%: 1 wk −0.8 to +2.4 | `horizons[h=5].ci_*` | −1.80 to +2.96 pp, `included` | COMPUTABLE | |
| 2 wk −0.6 to +2.9 | `horizons[h=10].ci_*` | −0.90 to +3.22 pp, `included` | COMPUTABLE | |
| 1 month −1.6 to +4.1 | `horizons[h=20].ci_*` | **−1.62 to +4.10 pp**, `included` | COMPUTABLE | Matches the mockup |
| 3 months −3.9 to +2.6 | `horizons[h=60].ci_*` | −4.16 to +6.28 pp, `included` | COMPUTABLE | |
| "At 80% the 1-month range clears zero; at 95% none do." | `confidence_note` | At 80% the 1-month range is −0.93 to +3.49 pp and still includes zero; no horizon clears zero at 80%, 90% or 95% | NEEDS-ENDPOINT | Values from §3 |
| Provenance "cluster bootstrap 10,000 · entry next session · cooldown 20 · gold history from 2000" | `provenance` | Monte Carlo 10,000 draws at every horizon · entry next session (`entry_same_session: false`) · cooldown 20 · gold data from 2000-08-30 | COMPUTABLE | |
| `slug gold-2sigma-spx-weak` | `slug` | `gold-2sigma-spx-weak` | COMPUTABLE | The one spec slug that is also an engine slug |
| Export (all 18 events) | `/study/events` | | NEEDS-COMPUTATION | The engine returns 10 recent events; a full list is an engine change |

### 2.4 04 Regime

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| "Overheating" | `regime.current.label` | **Overheating** | COMPUTABLE | `/api/regime/latest` |
| "Third month in a row" | `current.months_in` | **first month** (1) | COMPUTABLE | `/api/regime/duration`; Q13 |
| GROWTH "Rising" | `current.growth` | Rising (+0.1131) | COMPUTABLE | |
| INFLATION "Rising" | `current.inflation` | Rising (+0.7815) | COMPUTABLE | |
| IN THIS REGIME "3 mo, since the June print" | `current.months_in`, `since` | 1 month, since 2026-08 | COMPUTABLE | |
| LAST FIVE YEARS strip | `regime.history[]` | 2021-09 … 2026-08 labels | COMPUTABLE | `/api/regime/history` (363 rows from 1996-05; 2025-10 missing) |
| RECESSION "12%", "Low" | `recession.prob` | **11.64%**, Low Risk | COMPUTABLE | |
| INPUTS THROUGH "May" | `recession.inputs_through` | 2026-05 | NEEDS-ENDPOINT | As in §2.1 |
| A YEAR AGO "9%" | `recession.year_ago` | **17.17%** (2025-08-31) | COMPUTABLE | Point of the served `recession_prob_series` |
| PEAK LAST CYCLE "71% (Mar 2020)" | `recession.peak` | **95.50% (2020-06-30)**; the Mar 2020 point is 31.0% | COMPUTABLE | Max of the served series over 2019–2021 ("last cycle" is undefined in the spec) |
| "five monthly indicators against NBER recession dates since 1970" | (text) | Fit on 2003-04 → 2026 (`n_training_samples` 281) | COMPUTABLE | §10 |
| MONTHS 142 / 88 / 61 / 54 | `stats[].months` | Goldilocks **27** · Overheating **213** · Stagflation **102** · Recession Risk **21** | NEEDS-ENDPOINT | Counted from `/api/regime/history`; SQL Q8 agrees. No route serves the count |
| S&P / MO, UP | `stats[].spx_mo`, `up_pct` | | NEEDS-COMPUTATION | Needs a definition: which monthly S&P return, and whether the label takes the K−2 lag |
| VIX AVG | `stats[].vix_avg` | | NEEDS-COMPUTATION | VIXCLS daily is stored |
| STOCK–BOND | `stats[].stock_bond_corr` | | NEEDS-COMPUTATION | Needs a bond price series choice (§2.5) |
| NEXT CPI "Oct 14" | `next_prints.cpi.date` | **2026-10-14** | COMPUTABLE | `/api/calendar?days=60`, "CPI Release" 12:30 UTC |
| NEXT INDPRO "Oct 17" | `next_prints.indpro.date` | | NEEDS-SERIES | `event_calendar` (54 rows) has no industrial production release |
| "a soft print (<0.2% m/m) flips inflation to falling" | `next_prints.cpi.flip_threshold_mom` | | NEEDS-COMPUTATION | The rule is a 3-point OLS slope on the index level, so a flip depends on the level two months back (§10) |
| "a negative print flips growth to falling" | `next_prints.indpro.flip_threshold_mom` | | NEEDS-COMPUTATION | Same |
| LAST FIVE REGIME CHANGES | `changes[]` | 2026-08 Goldilocks → Overheating · 2026-07 Overheating → Goldilocks · 2026-01 Stagflation → Overheating · 2025-09 Overheating → Stagflation · 2025-06 Stagflation → Overheating | NEEDS-ENDPOINT | Consecutive rows of `/api/regime/history`; SQL Q9 agrees |
| S&P A MONTH LATER per change | `changes[].spx_1m` | | NEEDS-COMPUTATION | Needs a definition of the change date (the print date or the month stamp) |
| "all 34 changes since 1996" | (footer) | **123** | NEEDS-ENDPOINT | `/api/regime/history` and Q9 agree |

### 2.5 05 Macro & Correlations

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| 10-YEAR "4.21%" | `macro.curve.today.10y` | **4.96%** (2026-09-22) | COMPUTABLE | `/api/recession/probability` `curve_shape.10Y` 4.96 = `desk_series` DGS10 (two methods agree). The response carries no observation day |
| "−6 bp on the month" | `curve.10y_chg_bp` | **+22 bp** (4.74 on 2026-08-21, Q4) | NEEDS-COMPUTATION | |
| 2s10s "+41 bp" | `curve.2s10s_bp` | **+26 bp** (T10Y2Y 0.26, 2026-09-23) | NEEDS-ENDPOINT | `desk_series`. DGS10 − DGS2 gives 25 bp on 2026-09-22, the same day T10Y2Y reads 0.25 |
| "steepening · +9 bp" | `curve.2s10s_chg_bp` | **−24 bp**, flattening (0.50 on 2026-08-21, Q4) | NEEDS-COMPUTATION | |
| FRONT END "3m 4.05%" | `curve.today.3m` | | NEEDS-SERIES | DGS3MO |
| Curve today, 2y and 10y (3.80, 4.21) | `curve.today.2y`, `.10y` | 2y **4.71**, 10y **4.96** (2026-09-22) | COMPUTABLE | `curve_shape` 2Y / 10Y of `/api/recession/probability` |
| Curve today, 3m / 5y / 30y (4.05, 3.95, 4.62) | `curve.today.3m`, `.5y`, `.30y` | | NEEDS-SERIES | DGS3MO, DGS5, DGS30 |
| Curve a month ago | `curve.month_ago` | 2y 4.24, 10y 4.74 (2026-08-21) | NEEDS-COMPUTATION | Q4 |
| TODAY "+0.31", A YEAR AGO "−0.24", FLIPPED "Mar 2026", the one-year line | `stock_bond.*` | | NEEDS-COMPUTATION | 60-session correlation of daily returns. The bond leg needs a price series choice: IEF is in `asset_prices` 1d from 2002-07-30, but has no 2026-09-22 row |
| HY SPREAD "3.12%" | `credit.hy` | **2.73%** (2026-09-23) | COMPUTABLE | `/api/credit/metrics` `hy_oas` 273 bp = `desk_series` 2.73 (two methods agree). The served `credit_label` is "Normal" (the mockup says "tight") |
| 3-YEAR RANGE "2.6 – 5.9%" | `credit.hy_range_3y` | 2.59 – 4.61% (Q5, 787 daily values from 2023-09-25) | NEEDS-COMPUTATION | |
| INVESTMENT GRADE "0.94%" | `credit.ig` | **0.77%** | COMPUTABLE | `/api/credit/metrics` `ig_oas` 77 bp (month stamp 2026-09; observation 2026-09-23) |
| Gauge "18th pct" | `credit.hy_pct_3y` | 15.5% of the three-year daily values lie below today (Q5) | NEEDS-COMPUTATION | The served `hy_pct_rank` (3.0) ranks the full monthly history since 1996, a different measure |
| LAST 12 MONTHS line | `credit.series` | (daily values stored) | NEEDS-ENDPOINT | |
| "Mar scare · 4.6%" | `credit.peak_12m` | **3.46% on 2026-03-30** (Q5b) | NEEDS-COMPUTATION | |
| 10-year Treasury (price) "+0.31" | `correlations[]` | | NEEDS-COMPUTATION | As the stock–bond row |
| Gold "+0.12" | `correlations[]` | | NEEDS-COMPUTATION | GC=F and ^GSPC stored daily |
| Dollar "−0.22" | `correlations[]` | | NEEDS-SERIES | DX-Y.NYB daily (UUP in `market_daily` only from 2024-02-27) |
| Oil "+0.18" | `correlations[]` | | NEEDS-SERIES | DCOILWTICO daily (USO in `market_daily` only from 2024-02-27) |
| Nasdaq "+0.92" | `correlations[]` | | NEEDS-SERIES | ^NDX daily (QQQ in `market_daily` only from 2024-02-27) |
| High-yield credit "+0.64" | `correlations[]` | | NEEDS-COMPUTATION | HY OAS daily (from 2023-09-25) or HYG in `asset_prices` from 2007 |
| 12-asset matrix | `macro.matrix` | | NEEDS-SERIES | ndx, dxy, wti and other members not stored; the rest NEEDS-COMPUTATION |

### 2.6 06 Sectors

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| Eleven leadership rows (XLK +6.1 … XLU −4.8) | `sectors.leadership[]` | | NEEDS-SERIES | Not stored: XLC, XLY, XLB, XLRE, XLV, XLP, XLU. XLK, XLI, XLF, XLE are in `market_daily` from 2026-02-18 only, not in a Desk table |
| LEADING "Technology", LAGGING "Utilities", PATTERN "Cyclical" | `leadership`, `pattern` | | NEEDS-SERIES | Same |
| ABOVE 50-DAY "7 of 11", ABOVE 200-DAY "9 of 11", both dot rows | `breadth.above_50`, `above_200` | | NEEDS-SERIES | Same |
| EQUAL vs CAP WEIGHT "−2.4%" and its line | `breadth.eqw_vs_cap_*` | | NEEDS-SERIES | RSP |
| SMALL CAPS vs LARGE line | `breadth.small_vs_large_series` | | NEEDS-COMPUTATION | ^RUT is stored daily and registered (tier 2, `stored`); IWM is in `asset_prices` from 2000-05-26. Note ^RUT lacks 2026-09-22 |

### 2.7 07 Signal Ledger

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| SIGNALS SCORED "12" | `ledger.signals.length` | **8** run by the engine (7 with n ≥ 10) | COMPUTABLE | §4. Dollar and oil need series; RSI < 30 and RSI > 70 need a computation |
| FIRING NOW "2" | `firing_now` | | NEEDS-COMPUTATION | No firing rule. No engine event falls on 2026-09-22 or 09-23 |
| RELIABLE "3" | `verdict` | Engine `established` at 20 sessions: golden cross only | NEEDS-COMPUTATION | Mapping |
| NO EDGE "5" | `verdict` | | NEEDS-COMPUTATION | Mapping |
| "normal month +1.3%" | `normal_month` | +1.30% | COMPUTABLE | S&P target baseline median at 20 sessions |
| 2s10s +2σ steepening: Sep 9 2026 · 22 · 45% · −0.6% · −1.9 · No edge · Firing | `signals[]` | 2025-04-21 · **49** · 71.4% · +1.59% · +0.30 pp | COMPUTABLE | `45fce898de3f5d6a`; window 20 assumed |
| Dollar −2σ, 20 days: Sep 15 2026 · 37 · 62% · +1.9% · +0.6 · Suggestive · Firing | `signals[]` | | NEEDS-SERIES | DX-Y.NYB daily |
| S&P golden cross: Jul 1 2025 · 31 · 68% · +2.7% · +1.4 · Reliable | `signals[]` | **2025-07-01** · 14 · 78.6% · +2.67% · +1.36 pp | COMPUTABLE | `d5b36893fd64e23e` |
| RSI below 30: Apr 8 2025 · 22 · 73% · +3.4% · +2.1 · Reliable | `signals[]` | | NEEDS-COMPUTATION | RSI signal |
| VIX spike +2σ, 5 days: Aug 5 2024 · 41 · 71% · +2.2% · +0.9 · Reliable | `signals[]` | 2026-06-05 · **119** · 66.4% · +1.51% · +0.20 pp | COMPUTABLE | `ca8915ae8989e9a4` |
| Gold +2σ while S&P weak: Apr 16 2025 · 18 · 67% · +3.1% · +1.8 · Suggestive | `signals[]` | **2025-04-16** · **18** · 66.7% · +3.09% · +1.78 pp | COMPUTABLE | `879a8a1f76831fad` |
| HY spreads +2σ, 20 days: Mar 12 2025 · 24 · 63% · +2.9% · +1.6 · Suggestive | `signals[]` | 2025-04-08 · **2** · 50% · −3.73% · −5.21 pp | COMPUTABLE | `292b50629626141c`; n < 10, so the empty state |
| S&P 20-day move over 2σ: Apr 9 2025 · 29 · 66% · +2.4% · +1.1 · Suggestive | `signals[]` | 2026-04-27 · **86** · 62.8% · +1.71% · +0.40 pp | COMPUTABLE | `b14702f272d1dd26`; "either way" assumed |
| S&P death cross: Apr 14 2025 · 29 · 52% · +0.9% · −0.4 · No edge | `signals[]` | **2025-04-14** · 14 · 57.1% · +2.05% · +0.74 pp | COMPUTABLE | `af06a9b701fafd52` |
| RSI above 70: Jun 12 2026 · 64 · 59% · +1.1% · −0.2 · No edge | `signals[]` | | NEEDS-COMPUTATION | RSI signal |
| Oil +2σ, 20 days: Jun 18 2026 · 44 · 49% · +0.4% · −0.9 · No edge | `signals[]` | | NEEDS-SERIES | DCOILWTICO daily |
| S&P 5-day move over 2σ: Aug 2 2026 · 88 · 55% · +0.6% · −0.7 · No edge | `signals[]` | 2026-08-04 · **188** · 66.5% · +1.89% · +0.59 pp | COMPUTABLE | `3f68ce31b9f64634`; "either way" assumed |
| VERDICT pills and NOW column (● Firing / ○ Quiet) | `verdict`, `firing_now` | | NEEDS-COMPUTATION | The §1.5 mapping and a firing rule; the engine's words are in §4 |

### 2.8 08 Position Monitor

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| "Carried in from Event Study · Gold ≥ +2σ (20d) AND SPX below 50d MA · 20 trading days" | study label | "Gold (COMEX front month) 20-session move ≥ +2σ (252-session z), while S&P 500 below its 50-day average → S&P 500" | COMPUTABLE | `study.label` |
| WRONG IF "closes below its 50-day (6,280)" | suggested level | 7,624.84 (Q2) | NEEDS-COMPUTATION | As in §2.2 |
| "falls 2σ over 5 days" | suggested level | | NEEDS-COMPUTATION | The engine has the z of a 5-session move (+1.01σ on 2026-09-23); a price level for −2σ needs an inversion no function does |
| "the signal reverses" | suggested level | | NOT-DERIVABLE | Undefined in the spec |
| More levels: 200-day | | 7,192.01 (Q2) | NEEDS-COMPUTATION | |
| More levels: entry −3%, entry −5% | | | NOT-DERIVABLE | No entry is stored |
| More levels: lower low than last 20 days | | | NEEDS-COMPUTATION | |
| More levels: RSI < 40 | | | NEEDS-COMPUTATION | |
| More levels: VIX > 25 | | VIX now 14.21 (2026-09-22) | NEEDS-ENDPOINT | As in §2.1 |
| More levels: regime label changes | | now Overheating | COMPUTABLE | |
| More levels: HY spreads widen 2σ | | | NEEDS-ENDPOINT | The engine forms the z of the HY 20-session move; no route serves the current value |
| Monitored rows, room and level | `positions[].room_pct`, `to_level` | See §7 | NOT-DERIVABLE | No positions store; the arithmetic on live levels is in §7 |
| FALSIFIES AT "2s10s below +38 bp · now +41 bp" | `falsifies_at`, `now` | now **+26 bp** (2026-09-23): 12 bp through the level | NEEDS-ENDPOINT | `desk_series` T10Y2Y |
| "DV01 $1.4k" | `dv01` | | NOT-DERIVABLE | No notional |
| "14 of 20 trading days · opened Sep 2" | `day`, `opened` | | NOT-DERIVABLE | No position record |
| VARIANT VIEW, PRE-MORTEM, RED TEAM | text | | NOT-DERIVABLE | Owner text (`TODO(Max)`) |
| CLOSED · LAST 90D 4 / 6 / 2 of 4 | `closed_90d` | | NOT-DERIVABLE | No position history |
| "12% deployed, 3 positions" | footer | | NOT-DERIVABLE | Same |

### 2.9 09 Basket & Hedge

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| Basket legs NVDA · AVGO · VRT · CRWV · ANET · CEG · SMCI | `/basket/:id` | | NEEDS-SERIES | No single-name history stored |
| 3-MONTH "+12.7%" vs NDX "+9.1%" | basket | | NEEDS-SERIES | Legs and ^NDX |
| VS NDX · RESIDUAL "−1.9%", falsifies at −4% | basket | | NEEDS-SERIES | §7 |
| BASKET VOL "41%" vs NDX 24% | basket | | NEEDS-SERIES | |
| "Beta to NDX: 1.6" | basket | | NEEDS-SERIES | |
| Hedge rows (put spread, collar, puts): cost, breakeven, max loss | `/hedge` | | NEEDS-SERIES | Needs the QQQ/SPY options chain as a stored series (§5). §12.12 defines no shapes in this copy of the spec |
| HEDGE RATIO, COST OF WAITING, ROLL, scenario table | `/hedge` | | NEEDS-SERIES | Same |

### 2.10 10 Data Pipeline

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| "Last full refresh Sep 22, 00:23 UTC" | `pipeline.last_refresh_utc` | The full run's watermarks: Desk series advanced 2026-09-24T05:07:11Z, checked 15:52:43Z | NEEDS-ENDPOINT | `source_watermarks` |
| "validation passed" | `pipeline.validation` | `pass` (2 warnings), from `validate_db.py` on the copy | NEEDS-ENDPOINT | No route serves the validator's verdict |
| "26 series · grouped · read from the pipeline config" | `pipeline.groups[]` | **29** inventory rows (24 app feeds + 5 Desk series) | COMPUTABLE | `/api/desk/pipeline/inventory`. The §12.11 grouped shape needs a new route |
| Rates: 2-year, 10-year (and the 2s10s the fixture omits) | group rows | DGS2, DGS10, T10Y2Y daily, as of 2026-09-22 / 09-22 / 09-23 | COMPUTABLE | Inventory `desk:*` rows |
| Rates: 3-month, 5-year, 30-year | group rows | | NEEDS-SERIES | DGS3MO, DGS5, DGS30 |
| Credit (5) "HY OAS history from 2023" | group rows | HY daily from **2023-09-25**, as of 2026-09-23. IG, BB, B, CCC month-stamped from 1996-12, as of 2026-09-23 | COMPUTABLE | Inventory `as_of` per row |
| Credit rows "FEEDS: Regime" (IG, BB, B, CCC) | `feeds` | The inventory says "Credit" | COMPUTABLE | The regime rule reads INDPRO and CPI only (§10) |
| Equities & vol: S&P 500, Russell 2000, VIX | group rows | ^GSPC and ^RUT (as of 2026-09-23), VIXCLS (2026-09-22) | COMPUTABLE | ^GSPC and ^RUT are read through the `asset_prices` inventory row |
| Equities & vol: Nasdaq 100, S&P equal weight, VIX 3-month | group rows | | NEEDS-SERIES | ^NDX, RSP, VXVCLS |
| FX & commodities: Gold | group row | GC=F daily, as of 2026-09-23 | COMPUTABLE | |
| FX & commodities: Dollar index, Dollar–yen, WTI ("WTI published weekly") | group rows | | NEEDS-SERIES | DX-Y.NYB and JPY=X are monthly only; DEXJPUS and WTI are not stored |
| Macro (monthly): CPI, INDPRO, UNRATE, Fed funds ("Aug print in") | group rows | through 2026-08 | COMPUTABLE | |
| Macro (monthly): Payrolls, Retail sales | group rows | | NEEDS-SERIES | PAYEMS, RSAFS |
| Generate Snowflake DDL | `/pipeline/ddl` | | NEEDS-ENDPOINT | Static text over the stored schema |
| Export current study → CSV | `/study/events` | | NEEDS-COMPUTATION | Needs the full event list (§2.3) |

### 2.11 11 Build Notes

The page renders `docs/desk/BUILD_NOTES.md`; §12 defines no field for it. Each checkable claim in the PNG's text:

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| "[N] findings across [R] rounds" | (markdown) | See §8 | COMPUTABLE | Counted from the reports |
| "The Data Pipeline tab lists all 26 series" | (markdown) | 29 inventory rows; 7 of the mockup's 26 are stored daily | COMPUTABLE | §1 |
| "Gold history starts in 2000" | (markdown) | 2000-08-30 | COMPUTABLE | |
| "High-yield spreads from FRED only go back three years on the free tier" | (markdown) | Three years (from 2023-09-25). FRED's rolling window applies to every user since April 2026; it is not a free-tier limit | COMPUTABLE | §10 |
| "Options history starts Q4 2023" | (markdown) | | NEEDS-SERIES | Not verified; nothing is stored |
| "regime label … lagged two months" | (markdown) | `REGIME_LAG_MONTHS = 2` | COMPUTABLE | |
| "exact enumeration under eight" | (markdown) | `EXACT_MAX_BLOCKS = 7` | COMPUTABLE | |
| "logistic regression on five monthly inputs, lagged three months, fit against NBER dates" | (markdown) | 5 features, `shift(3)`; training from 2003-04 | COMPUTABLE | |
| "Every study carries its as-of date, sample start, event count and a hash of its inputs" | (markdown) | `provenance.as_of`, `sample_start`, `n_events`, `inputs_hash` | COMPUTABLE | The hash also covers the file identity (§10) |

### 2.12 12 Client view

| Screen value | Spec field | Real value today | Status | Note |
|---|---|---|---|---|
| "as of Sep 22, 2026" | `as_of` | **2026-09-23** (gold preset `provenance.as_of`) | COMPUTABLE | |
| Goldilocks "+4.2%" | `by_regime[Goldilocks].median` | n 2: too few (engine suppresses) | COMPUTABLE | "too few cases to say" |
| Overheating "+2.8%" | `by_regime[Overheating].median` | n 6: too few | COMPUTABLE | Same |
| Stagflation "+1.9%" | `by_regime[Stagflation].median` | n 9: too few | COMPUTABLE | Same |
| Recession Risk "too few cases to say" | `by_regime[Recession Risk]` | n 1: too few | COMPUTABLE | All four rows read "too few" today |
| PNG only: EPISODES "41 since 1990" · HIGHER A MONTH LATER "63% vs 58%" · TYPICAL MOVE "+1.8% vs +0.9%" | (not in §12) | Gold preset: **18** since 2000 · **66.7%** vs baseline hit rate 64.8% · **+3.09%** vs baseline +1.31% | COMPUTABLE | The PNG and §11 disagree (§10) |

---

## 3. The nine preset studies

Every figure comes from `src.desk.event_study.run()` on the copy, confirmed through the route where one reaches it.
"Evaluable" is the engine's `sample_start` → `sample_end`; "data from" is `data_start`. Every study below
has `n_events ≥ 10` except `hy-2sigma-20d`.

| Spec slug | Engine query (engine slug) | n_events | Sample start | Verdict at 90% (5 / 10 / 20 / 60 sessions); the 20-session Δ | n<10 empty state | Firing today | Last event | inputs_hash |
|---|---|---|---|---|---|---|---|---|
| `gold-2sigma-spx-weak` | preset `gold-2sigma-spx-weak` | 18 | data 2000-08-30, evaluable 2001-09-19 | inc / inc / inc / inc; Δ +1.78 pp [−1.62, +4.10], adverse 14.6% | no | no; the condition is unevaluable on 2026-09-22 and 09-23 | 2025-04-16 | `879a8a1f76831fad` |
| `golden-cross` | preset `spx-golden-cross` | 14 (16 strict crosses since 1990; 2 before 1996-07 are `Unlabeled`) | data 1990-01-02, evaluable 1996-07-01 | inc / inc / **established** / inc; Δ +1.36 pp [+0.42, +3.27], adverse 1.7% | no | no; the rule is unevaluable since 2026-09-22 | 2025-07-01 | `d5b36893fd64e23e` |
| `death-cross` | preset `spx-death-cross` | 14 (1 more `Unlabeled`) | data 1990-01-02, evaluable 1996-07-01 | inc / inc / inc / **established**; 20-session Δ +0.74 pp [−4.30, +4.01]; 60-session Δ +3.17 pp [+0.65, +6.52], adverse 1.8% | no | no; same | 2025-04-14 | `af06a9b701fafd52` |
| `vix-spike-2sigma-5d` | `vix-w5-z2.0-up-none-spx` | 119 (17 `Unlabeled` outside) | data 1990-01-02, evaluable 1996-07-01 | inc / inc / inc / inc; Δ +0.20 pp [−0.39, +0.96], adverse 31.1% | no | no | 2026-06-05 | `ca8915ae8989e9a4` |
| `hy-2sigma-20d` | `hy_oas-w20-z2.0-up-none-spx` | **2** | data 2023-09-25, evaluable 2024-10-04 | — / — / — / — (2 blocks, fewer than the 5 an interval needs) | **yes** | no | 2025-04-08 | `292b50629626141c` |
| `10y-2sigma-20d` | `us10y-w20-z2.0-up-none-spx` | 37 (10 `Unlabeled`) | data 1990-01-02, evaluable 1996-07-01 | inc / inc / inc / inc; Δ +0.39 pp [−1.47, +1.83], adverse 28.7% | no | no (last event 8 sessions before 2026-09-23) | 2026-09-11 | `52ca7ffa10ea803d` |
| `dollar-2sigma-20d` | `dxy-w20-z2.0-down-none-spx` | | | 503 `not_stored`: "US Dollar Index (DX-Y.NYB) is not stored in this database: it is a tier 2 series, and the full refresh stores tier 1 only." | | | | |
| `oil-2sigma-gold` | `wti-w20-z2.0-up-none-gold` | | | 503 `not_stored`: "WTI crude (DCOILWTICO) is not stored … tier 2 …" | | | | |
| `spx-2sigma-10y` | `spx-w20-z2.0-down-none-us10y` | 56 (5 `Unlabeled`) | data 1990-01-02, evaluable 1996-07-01 | inc / **not established** / inc / **not established**; 20-session Δ −6.0 bp [−12.0, +4.0], adverse 27.3%; 10-session [−6.0, −0.5] bp, adverse 3.4%; 60-session [−34.0, −0.5] bp, adverse 4.5% | no | no | 2026-03-26 | `c771d7fe64eae075` |

"inc" is `included`. "Firing today" has no engine field. Here it means only that the engine's last event is
not the last session (2026-09-23), which holds for every study. A `firing_now` rule is NEEDS-COMPUTATION.

**Verdict at 80% and 95%** (the engine's `horizon_stats` called with `ci=0.80` / `ci=0.95`; everything else unchanged).

| Spec slug | 80%: 5 / 10 / 20 / 60 | 95%: 5 / 10 / 20 / 60 | Moved against 90% |
|---|---|---|---|
| `gold-2sigma-spx-weak` | inc / inc / inc / inc; 20: [−0.93, +3.49] | inc / inc / inc / inc; 20: [−2.09, +4.66] | none |
| `golden-cross` | inc / inc / established / **not established** (60: [+0.81, +3.27], adverse 6.7%) | inc / inc / established / inc; 20: [+0.09, +3.74] | 60 at 80% |
| `death-cross` | inc / inc / inc / established (60: [+1.12, +4.67]) | inc / inc / inc / established (60: [+0.18, +8.08]) | none |
| `vix-spike-2sigma-5d` | inc / inc / inc / **not established** (60: [+0.01, +1.75], adverse 7.6%) | inc × 4 | 60 at 80% |
| `hy-2sigma-20d` | — × 4 | — × 4 | none |
| `10y-2sigma-20d` | **not established** (5: [+0.21, +0.80], adverse 7.0%) / inc / inc / inc | inc × 4 | 5 at 80% |
| `dollar-2sigma-20d` | not stored | not stored | |
| `oil-2sigma-gold` | not stored | not stored | |
| `spx-2sigma-10y` | not established / not established / inc / not established (5: [−4.0, 0.0]; 60: [−29.5, −2.0]) | inc × 4 | 5 at 80%; 10 and 60 at 95% |

The adverse share does not depend on the level, so a horizon above the 3% ceiling can never read `established`
at any level. Only the golden cross at 20 sessions and the death cross at 60 do, and they do at all three levels.

**Parameters the engine cannot honor as the spec defines them.**

- **The slugs.** Only `gold-2sigma-spx-weak` is an engine slug. `golden-cross` and `death-cross` are
  `spx-golden-cross` and `spx-death-cross`. The other six have no engine slug; their engine permalinks
  are in the second column.
- **`window`.** Only 5, 20 and 60 exist. `w=10` answers 422, `"w must be one of (5, 20, 60)"` (checked on
  the route).
- **`while`.** `spx_above_50` is not a condition (422, checked). `regime:<name>` exists as `cond=regime`
  or the `regime=` filter.
- **`move`.** `cross_above` / `cross_below` exist only as the S&P 50/200 cross, not for any shock series.
- **`confidence`.** Not a query parameter. `inputs_hash` does not change with it (identical hashes at
  80, 90 and 95% for every study above).
- **`spx-2sigma-10y`.** The spec gives no window; 20 was used. With the spec's other window list, 10
  would be refused.
- **`vix-spike-2sigma-5d`** and **`10y-2sigma-20d`.** The sign "+" was taken from the chip text ("VIX spike",
  "10y yield +2σ"); the spec's `move` enum would say `up2s`.
- **`oil-2sigma-gold`** and **`dollar-2sigma-20d`** need tier-2 series (§5).

---

## 4. The 12 Ledger signals

Target S&P 500 for every row; "median" and "up" at 20 sessions; Δ against the study's own baseline median
(+1.30% to +1.31%).

| # | Spec row | Engine query | Scored today | n | Last fired | Up / median / Δ at 20 | Verdict (engine, 20 sessions) | firing_now | Missing input |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2s10s +2σ steepening | `curve_2s10s-w20-z2.0-up-none-spx` (window 20 assumed) | yes | 49 | 2025-04-21 | 71.4% / +1.59% / +0.30 pp | `included` [−0.60, +1.78], adverse 33.4% | no (NEEDS-COMPUTATION) | |
| 2 | Dollar −2σ, 20 days | `dxy-w20-z2.0-down-none-spx` | **no** | | | | | | DX-Y.NYB daily (`desk_series`, tier 2) |
| 3 | S&P golden cross | `spx-golden-cross` | yes | 14 | 2025-07-01 | 78.6% / +2.67% / +1.36 pp | `established` [+0.42, +3.27], adverse 1.7% | no; rule unevaluable since 2026-09-22 | |
| 4 | RSI below 30 | none | **no** | | | | | | none (^GSPC stored); NEEDS-COMPUTATION: an RSI signal |
| 5 | VIX spike +2σ, 5 days | `vix-w5-z2.0-up-none-spx` | yes | 119 | 2026-06-05 | 66.4% / +1.51% / +0.20 pp | `included`, adverse 31.1% | no | |
| 6 | Gold +2σ while S&P weak | `gold-2sigma-spx-weak` | yes | 18 | 2025-04-16 | 66.7% / +3.09% / +1.78 pp | `included`, adverse 14.6% | no; condition unevaluable since 2026-09-22 | |
| 7 | HY spreads +2σ, 20 days | `hy_oas-w20-z2.0-up-none-spx` | yes (n < 10) | 2 | 2025-04-08 | 50% / −3.73% / −5.21 pp | no interval (2 blocks) | no | HY OAS daily only from 2023-09-25 |
| 8 | S&P 20-day move over 2σ | `spx-w20-z2.0-abs-none-spx` (either way assumed) | yes | 86 | 2026-04-27 | 62.8% / +1.71% / +0.40 pp | `included`, adverse 22.7% | no | |
| 9 | S&P death cross | `spx-death-cross` | yes | 14 | 2025-04-14 | 57.1% / +2.05% / +0.74 pp | `included` at 20 (`established` at 60) | no; rule unevaluable since 2026-09-22 | |
| 10 | RSI above 70 | none | **no** | | | | | | none; NEEDS-COMPUTATION: an RSI signal |
| 11 | Oil +2σ, 20 days | `wti-w20-z2.0-up-none-spx` | **no** | | | | | | DCOILWTICO daily (`desk_series`, tier 2) |
| 12 | S&P 5-day move over 2σ | `spx-w5-z2.0-abs-none-spx` (either way assumed) | yes | 188 | 2026-08-04 | 66.5% / +1.89% / +0.59 pp | `included`, adverse 15.1% | no | |

The mockup has two rows firing (2s10s since 2026-09-09, dollar since 2026-09-15). On the engine's events, no
row fired in the last session. The 10-year +2σ study (not a Ledger row) fired on 2026-09-11.

---

## 5. Series gap

Every series the spec assumes that the store does not hold daily in a table the engine reads. The registry's
signature is `DeskSeries(key, label, source, series_id, unit, scale, history_from, tier, roles, fixed=, known=,
defer_as_target=, eodhd=, note=)` (`src/desk/series.py` on `main`). Nothing below is applied.

| Series | Yahoo | EODHD | Tier (proposed) | Provider-history limit, and what the store has now |
|---|---|---|---|---|
| XLK XLI XLF XLY XLE XLB XLV XLP XLU | same tickers | `<T>.US` | registered at **3** (`deferred`); needs 2 | Listed 1998-12-22 (registry). `market_daily` holds XLK, XLI, XLF and XLE from 2026-02-18 only |
| XLC | XLC | XLC.US | 2 (new) | Launched June 2018: a study reads "since 2018". The declared start needs confirming on the first fetch |
| XLRE | XLRE | XLRE.US | 2 (new) | Launched October 2015. Confirm the first date on fetch |
| RSP | RSP | RSP.US | 2 (new) | History from 2003. Confirm the first date on fetch |
| IWM | IWM | IWM.US | 2 (new, `asset_prices`) | **Already stored** in `asset_prices` 1d from 2000-05-26 (verified); a registry line reads it with no fetch. ^RUT is already registered and stored from 1990 |
| EEM | EEM | EEM.US | 2 (new, `asset_prices`) | **Already stored** in `asset_prices` 1d from 2003-04-14 (verified); no fetch |
| ^NDX | ^NDX | NDX.INDX | registered at 2 (`planned`) | Not stored. Needed for correlations, NDX vs SPX and the basket |
| DX-Y.NYB (daily) | DX-Y.NYB | DXY.INDX | registered at 2 (`planned`) | Only 1mo rows in `asset_prices` |
| WTI | (FRED `DCOILWTICO`) | | registered at 2 (`planned`) | EIA via FRED. The fixture names weekly `WCOILWTICO`; the registry daily `DCOILWTICO` |
| USD/JPY | JPY=X | USDJPY.FOREX | registered at 2 (`planned`) | Only 1mo rows in `asset_prices`. The fixture names FRED `DEXJPUS` |
| DGS3MO, DGS5, DGS30 | (FRED) | | 2 (new) | Not stored anywhere. FRED: DGS3MO from 1981, DGS5 from 1962, DGS30 from 1977 with a gap 2002-02 → 2006-02. Confirm on fetch |
| VXVCLS | (FRED) | | 2 (new, fixture only) | FRED from 2007-12 |
| IG / BB / B / CCC OAS (daily) | (FRED) | | 2 (new, if daily is wanted) | Monthly rows from 1996-12 exist. **FRED now serves ICE BofA series as a rolling three years**, so a daily fetch starts ~2023-09. The HY daily series shows the same (`short`) |
| Options-derived: SPY 25-delta skew 1m, ATM IV 1m / 3m / 6m, put IV, call IV | none | `/api/mp/unicornbay/options/contracts` (fields `volatility`, `delta`, `dte`) | 2 (new source) | **Not a registry-only change.** It needs a new source kind (`SOURCES` has fred, market, asset_prices), a unit for vol points (`UNITS` has log_return, bp, log_change) and a writer that pulls one chain per close. The spec says history from Q4 2023; not verified. An options-chain call weighs 10 calls against a separate marketplace quota (`api/providers/quota.py`) |
| Basket legs NVDA AVGO VRT CRWV ANET CEG SMCI; QQQ options | same | `<T>.US` | not tiered | Basket & Hedge only; §12.12 has no shapes |
| PAYEMS, RSAFS (fixture) | (FRED monthly) | | not a Desk series | They belong in `src/config.py` SERIES (`raw_series`), not the Desk registry |

The registry lines that would add them (written out, **not applied**):

```python
# src/desk/series.py (main). Proposed; NOT applied. B also has to reconcile with the unmerged
# desk/hardening registry (REFRESH_TIER = 2, day_zone, WTI's session_clock rule).

REFRESH_TIER = 2  # the workflow's "Store Desk daily series" step must run --tier 2 as well

# ── tier 2, FRED rates (new) ───────────────────────────────────────────────
DeskSeries("us3m", "3M Treasury bill", "fred", "DGS3MO", "bp", 100.0, "1981-09-01", 2, _SC,
           fixed=("close", -30), known=NEXT_OPEN, note="Declared start to confirm on the first fetch."),
DeskSeries("us5y", "5Y Treasury", "fred", "DGS5", "bp", 100.0, "1962-01-02", 2, _SC,
           fixed=("close", -30), known=NEXT_OPEN),
DeskSeries("us30y", "30Y Treasury", "fred", "DGS30", "bp", 100.0, "1977-02-15", 2, _SC,
           fixed=("close", -30), known=NEXT_OPEN,
           note="FRED has no DGS30 values from 2002-02 to 2006-02 (the bond was suspended)."),
DeskSeries("vix3m", "VIX 3-month", "fred", "VXVCLS", "log_change", 1.0, "2007-12-04", 2, _SC,
           fixed=("close", 15), known=("close", 15)),

# ── tier 2, already in asset_prices (no fetch; the allocation refresh stores them) ──
DeskSeries("iwm", "Russell 2000 ETF (IWM)", "asset_prices", "IWM", "log_return", 1.0, "2000-05-26", 2, _SC,
           note="Stored from 2000-05-26 by the allocation refresh (asset_prices)."),
DeskSeries("eem", "Emerging markets ETF (EEM)", "asset_prices", "EEM", "log_return", 1.0, "2003-04-14", 2, _SC,
           note="Stored from 2003-04-14 by the allocation refresh (asset_prices)."),

# ── tier 2, market (new) ───────────────────────────────────────────────────
DeskSeries("rsp", "S&P 500 equal weight ETF (RSP)", "market", "RSP", "log_return", 1.0, "2003-05-01", 2, _SC,
           eodhd="RSP.US", note="Declared start to confirm on the first fetch."),
DeskSeries("xlc", "Communication Services sector ETF (XLC)", "market", "XLC", "log_return", 1.0, "2018-06-19", 2, _SC,
           eodhd="XLC.US", note="Launched June 2018; declared start to confirm on the first fetch."),
DeskSeries("xlre", "Real Estate sector ETF (XLRE)", "market", "XLRE", "log_return", 1.0, "2015-10-08", 2, _SC,
           eodhd="XLRE.US", note="Launched October 2015; declared start to confirm on the first fetch."),

# ── the nine sector ETFs: change the existing comprehension's tier from 3 to 2 ──
) + tuple(
    DeskSeries(t.lower(), f"{name} sector ETF ({t})", "market", t, "log_return", 1.0, "1998-12-22", 2, _SC,
               eodhd=f"{t}.US", note="Sector ETFs list from 1998-12-22.")
    for t, name in (
        ("XLB", "Materials"), ("XLE", "Energy"), ("XLF", "Financials"), ("XLI", "Industrials"),
        ("XLK", "Technology"), ("XLP", "Consumer Staples"), ("XLU", "Utilities"),
        ("XLV", "Health Care"), ("XLY", "Consumer Discretionary"),
    )
)

# ── options-derived: NOT valid against today's registry; needs SOURCES += ("options",),
#    UNITS += ("vol_pts",) and a writer that stores one SPY chain read per close ──
DeskSeries("spx_skew_25d_1m", "SPY 25-delta skew, 1 month (put IV − call IV)", "options", "SPY:SKEW25D:1M",
           "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US",
           note="EODHD options (unicornbay), one pull per close; history start is the spec's claim, unverified."),
DeskSeries("spx_atm_iv_1m", "SPY ATM implied vol, 1 month", "options", "SPY:ATMIV:1M", "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US"),
DeskSeries("spx_atm_iv_3m", "SPY ATM implied vol, 3 months", "options", "SPY:ATMIV:3M", "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US"),
DeskSeries("spx_atm_iv_6m", "SPY ATM implied vol, 6 months", "options", "SPY:ATMIV:6M", "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US"),
DeskSeries("spx_put_iv_25d_1m", "SPY 25-delta put IV, 1 month", "options", "SPY:PUTIV25D:1M", "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US"),
DeskSeries("spx_call_iv_25d_1m", "SPY 25-delta call IV, 1 month", "options", "SPY:CALLIV25D:1M", "vol_pts", 1.0, "2023-10-02", 2, ("condition",), known=NEXT_OPEN, eodhd="SPY.US"),
```

Already registered at tier 2 and only waiting for `REFRESH_TIER = 2`: `wti` (DCOILWTICO), `ndx` (^NDX,
NDX.INDX), `dxy` (DX-Y.NYB, DXY.INDX), `usdjpy` (JPY=X, USDJPY.FOREX). `rut` is tier 2 and already stored
(asset_prices).

---

## 6. Real vs mockup

| Item | Mockup | Real (source) |
|---|---|---|
| Regime label, months in | Overheating, 3 months (since the June print) | **Overheating, 1 month** (since the Aug print; Jul was Goldilocks). `/api/regime/latest`, `/api/regime/duration`, Q13 |
| Regime stats: months per regime since 1996 | Goldilocks 142 · Overheating 88 · Stagflation 61 · Recession Risk 54 | **27 · 213 · 102 · 21** (363 months, 1996-05 → 2026-08). `/api/regime/history`, Q8 |
| Regime stats: S&P/mo, up, VIX avg, stock–bond | +1.4/66/15/−0.2 · +0.9/59/17/+0.3 · −0.2/48/24/+0.4 · −0.6/45/29/−0.5 | NEEDS-COMPUTATION (no function; the definitions are open) |
| Regime changes since 1996 | 34 | **123** (`/api/regime/history`, Q9) |
| Recession probability, inputs month | 12%, May | **11.64%**, 2026-05 (the Aug 2026 reading, inputs shifted three months). `/api/recession/probability` |
| Recession a year ago, peak last cycle | 9%; 71% (Mar 2020) | **17.17%** (2025-08-31); **95.50%** (2020-06-30); Mar 2020 = 31.0% |
| Six correlation rows (60-day, vs S&P) | 10y +0.31 · gold +0.12 · dollar −0.22 · oil +0.18 · Nasdaq +0.92 · HY +0.64 | NEEDS-COMPUTATION (10y price, gold, HY); NEEDS-SERIES (dollar, oil, Nasdaq daily) |
| 12-asset matrix | illustrative | NEEDS-SERIES / NEEDS-COMPUTATION |
| Curve today 3m / 2y / 5y / 10y / 30y | 4.05 / 3.80 / 3.95 / 4.21 / 4.62 | – / **4.71** / – / **4.96** / – (2026-09-22; 3m, 5y, 30y not stored) |
| Curve a month ago | (dashed line) | – / **4.24** / – / **4.74** / – (2026-08-21, Q4) |
| 2s10s today and change | +41 bp, +9 bp | **+26 bp** (2026-09-23), **−24 bp** on the month (Q4) |
| 10-year change on the month | −6 bp | **+22 bp** (Q4) |
| HY spread, 3-year range, 3-year percentile | 3.12%, 2.6–5.9%, 18th | **2.73%** (2026-09-23); **2.59–4.61%**; **15.5%** of 787 daily values below today (Q5). Served full-history rank: 3.0 |
| HY 12-month peak | 4.6% (Mar) | **3.46%** (2026-03-30, Q5b) |
| IG spread | 0.94% | **0.77%** (`/api/credit/metrics`) |
| RSI | 58 | NEEDS-COMPUTATION |
| S&P price | 6,412 | **7,706.03** (2026-09-23, Q1) |
| 50-day average | 6,280 | 7,624.84 (Q2, plain average of the last 50 stored closes; the engine's rule has no value while 2026-09-22 is missing) |
| 200-day average | 5,910 | 7,192.01 (Q2, same caveat) |
| 1-year return | +14.2% | **+15.76%** (Q3) |
| Last 20 days in σ | +0.6σ | **−0.28σ** (engine `move`/`zscore`, 2026-09-23) |
| Stock–bond 60-day correlation today, a year ago | +0.31, −0.24 | NEEDS-COMPUTATION |
| VIX | 16.2 | **14.21** (2026-09-22) |

---

## 7. Positions

"Room left" follows spec §9: distance to the level now, as a share of the distance at entry. "Distance" as a
share of the reading follows frame-2's `distanceOf` (|level − reading| / |reading|).

**2s10s steepener, falsifies below +38 bp, opened 2026-09-02 (spec §9).**

- Now: `desk_series` T10Y2Y **0.26% = +26 bp** on 2026-09-23. Cross-check: DGS10 − DGS2 = 4.96 − 4.71 =
  0.25 on 2026-09-22, the same as T10Y2Y 0.25 that day.
- At entry: T10Y2Y **0.40% = +40 bp** on 2026-09-02. Cross-check: DGS10 − DGS2 = 4.79 − 4.39 = 0.40.
- Distance to level: 26 − 38 = **−12 bp**. The spread is 12 bp *below* the level, so the position is
  past its falsification line.
- Room at entry: 40 − 38 = **2 bp**.
- Room left: −12 / 2 = **−600%**. Anything below 0% means falsified; the mockup reads "22% room, 3 bp
  to level".

**The S&P against 6,280.**

- Now: ^GSPC **7,706.03** on 2026-09-23 (`asset_prices`, Q1).
- Distance: 7,706.03 − 6,280 = **1,426.03 points**. That is 1,426.03 / 7,706.03 = **18.51%** of the
  reading, or 22.71% of the level.
- Room left: **NOT-DERIVABLE**. The spec gives no entry date or entry level for an S&P position, so there
  is no distance at entry to divide by.
- 6,280 is the mockup's 50-day average. The plain average of the last 50 stored closes is 7,624.84 (Q2),
  1.06% below the price.

**AI-infra basket, hedged: basket minus 1.6 × NDX against −4%. NOT-DERIVABLE.**

- No basket index exists in the store.
- None of the seven legs (NVDA, AVGO, VRT, CRWV, ANET, CEG, SMCI) is stored.
- ^NDX is not stored either.

---

## 8. Review-log totals

The instruction names `docs/desk/*_REPORT.md`. This worktree (`main`) holds three: `EVENT_STUDY_REPORT.md`,
`FRAME_REPORT.md` and `INTEGRATION_REPORT.md`. The Build Notes sentence covers every Desk branch, so the three
reports that live only on other branches were read too, read-only:

- `FRAME2_REPORT.md` at `desk/frame-2` `4c810d3`.
- `FRAME3_REPORT.md` at `desk/frame-3` `7bb2a3e`.
- `HARDENING_REPORT.md` from the `desk/hardening` worktree's working file. Its later rounds are staged
  and not committed, and the file was being edited during this audit (snapshot sha256
  `cad6e043…39f1`).

Severities are the reports' own words. "Raised" counts every raise; a finding re-raised in a later round
counts again.

| Branch (report) | Rounds | Reviewer | Findings raised | By severity (as written) | Fixed | Accepted exception | Deferred / carried | Open |
|---|---|---|---|---|---|---|---|---|
| `desk/event-study` (EVENT_STUDY_REPORT) | 4: verifier round 0; independent review rounds 1, 2, 3 (round 3 includes the owner's R-18 repro) | verifier + independent review | 33: 3 + 14 + 10 + 6 | none stated | 31 | 0 | 2 deferred by decision (R-23, R-24) | 0 |
| `desk/frame` (FRAME_REPORT) | 1: verifier | verifier | 12 | S2 × 3, S3 × 9 | 10 | 2 (#9 wordmark route, #12 stored rows by design) | 0 | 0 |
| `desk/integration` (INTEGRATION_REPORT) | 4: verifier rounds 1–3 (round 3 found nothing new) + the pre-push review | verifier + Codex pre-push | 15: V-01…V-09, V-11…V-13 (12) + R-01…R-03 (3). The 8 merge defects F1–F8 were found by the builder, fixed test-first, and are not counted | blocker 1 · should-fix 7 · nit 4 · high 1 · low 2 | 10 | 2 (V-09; V-07's import-error half) | 3 carried to `desk/hardening` (R-01 high, R-02 low, R-03 low) | 0 on the branch |
| `desk/frame-2` (FRAME2_REPORT) | 9: verifier rounds 1, 2 and final; independent review; third review; fourth review (Codex); verifier on `67c38a7`; Codex round 4; verifier on `1595319`/`5435df2` | verifier + independent/Codex reviews | 48 (43 distinct: R-07 raised 4 times, R-08 3 times) | S1 1 · S2 9 · S3 20 · blocking 3 · high 3 · low 1 · unstated 11 | 43 | 3 (V-07 Build Notes words, R-11 browser arithmetic, V4-03) | 2 deferred (V-13, V4-02) | 0 |
| `desk/hardening` (HARDENING_REPORT, working file) | 13, by the report's own numbering. Round 1 is the verifier (two passes, V-01…V-13). Reviews 2, 3, 4, 8, 11 and 13 are review rounds (the report names the last four Codex rounds 3–6); the rest process the verifier's rechecks | verifier + Codex | 64 new, plus the 3 inherited from integration (fixed in Part 1) | blocking 6 · high 7 · medium 7 · low 22 · nit 18 · unstated 4 | 54 (+3 inherited) | 6 (V-06, V-10, V-21, V-23, V-24, V-29) | 1 deferred (V-15) | 3 (V-39, V-40, V-41, raised by the last recheck) |
| `desk/frame-3` (FRAME3_REPORT) | 26: two verifier rounds per tab, three for Position Monitor and Basket & Hedge; no Codex round yet | verifier | 246 | blocking 18 · nits 6 · unstated 222 | 214 | 15 | 14 deferred within the run · 3 owner actions | 0 |

Counting rules applied:

- **EVENT_STUDY.** Round 2's "10 findings" counts R-04 + R-02 as two.
- **INTEGRATION.**
  - It has no V-10.
  - V-07 is counted once, as an accepted exception: the shadow attribute was fixed and the
    import-error case left by decision.
- **FRAME2.**
  - R-11 is counted once. The third review "closed" it without re-raising it.
  - V-14 was handled in §6 and counted as fixed.
- **FRAME3.**
  - Tallied by an independent read of the file; its 26 rounds and 18 blocking findings were checked
    against the report's own round summaries.
  - Position Monitor's three unlettered "Nits" bundles count one each.
  - Technicals round 2's four follow-up gaps on T-2, T-3, T-8 and T-11 count as new findings.
- **HARDENING.** Tallied by an independent read of the file.
  - R-01…R-03 appear in both Part 1 and the second review; they are different findings and count
    separately. So do the two R-08s (fourth and eighth rounds).
  - Part 1's three findings are integration's R-01…R-03. They count once, under integration.
  - V-11 has two parts and counts once, as fixed.
  - V-30, V-35, V-36 and V-38 count as fixed by the Codex fixes that superseded them. The report does not
    close them by ID.

**Totals.**

- **Main's three reports:** 60 raised across 9 rounds.
  - 51 fixed, 4 accepted exceptions, 2 deferred by decision.
  - 3 were carried to `desk/hardening`, where Part 1 addressed them.
- **All six branches:** **418 raised across 57 rounds.**
  - 365 fixed, 28 accepted exceptions, 19 deferred to a named follow-up.
  - 3 owner actions (frame-3).
  - 3 open (hardening V-39 to V-41).
  - 365 + 28 + 19 + 3 + 3 = 418.
- **The four pushed branches alone** (event-study, frame, integration, frame-2): 108 across 18 rounds.
  94 fixed, 7 accepted, 4 deferred, 3 carried to hardening and fixed there.

**For Build Notes** (paste in place of "[N] findings across [R] rounds"; the words that follow it in the
mockup, "all fixed or logged as accepted exceptions", are not true of these counts, so the sentence replaces
them too):

> Across six branches the reviews raised 418 findings in 57 rounds: 365 fixed, 28 recorded as accepted exceptions, 19 deferred to a named follow-up, 3 left for me to decide, and 3 still open on the unmerged hardening branch.

If Build Notes should count only what is pushed, use the pushed-branches line instead: 108 in 18 rounds.
94 fixed, 7 accepted, 4 deferred, and 3 whose fixes sit on the unpushed hardening branch.

---

## 9. What B should build first

Ranked by how much of the design each §12 endpoint unlocks with data that exists today.

| Rank | Endpoint | What it unlocks today | Blocker |
|---|---|---|---|
| 1 | `GET /study` (+ `/study/events`) | The Event Study tab. It also supplies the rows of the Ledger, the Overview's active signals and the Technicals signal rows. 7 of 9 presets run now; the engine and `/api/desk/event-study` exist | Slug aliases (§3) · `confidence` into `Query`, cache key and hash · the three-word verdict mapping · `without_condition` (a second run) · `firing_now` · worst/best and the full event list (the engine serves 10) · `served_from_cache`/`elapsed_ms` · the ^GSPC 2026-09-22 gap |
| 2 | `GET /ledger` | The Signal Ledger tab, Overview "Active signals", Technicals "Signals". 8 of 12 rows score now | The same mapping and firing rule · RSI (2 rows) · DX-Y.NYB and WTI daily (2 rows) · the ^GSPC gap |
| 3 | `GET /regime` | Regime tab: label, growth, inflation, months in, the five-year strip, recession (probability, year ago, peak), next CPI, last five changes, months per regime. Also the sidebar TODAY card | Per-regime S&P/VIX/stock–bond stats (definitions) · `inputs_through` field · flip thresholds (a function over the rule) · INDPRO release date (`event_calendar`) · S&P a month after each change |
| 4 | `GET /pipeline` (+ `/pipeline/ddl`) | Data Pipeline tab, from `/api/desk/pipeline/inventory` (29 rows) regrouped | The group model (§12.11 vs the 29 real rows) · the validator verdict and run times as fields · the DDL text |
| 5 | `GET /overview` | Regime and recession tiles, the golden-cross line, VIX; the rest follows ranks 1–3 | `since_last_close` needs the previous generation · MA values · realized volatility · positions |
| 6 | `GET /technicals` | Price, 1-year return, last-20-day σ, the crosses | The 50/200-day averages (a function, plus the gap) · RSI · the one-session change · the price series |
| 7 | `GET /macro` | 2y and 10y today and a month ago, 2s10s, HY and IG levels, HY 3-year range and percentile | DGS3MO, DGS5, DGS30 · every correlation (a function, plus ^NDX, DX-Y.NYB, WTI daily and a bond price choice) |
| 8 | `GET/POST /positions` | The 2s10s "now" line from `desk_series` | No positions store. The API is read-only and the database is replaced on every refresh (§10) |
| 9 | `GET /sectors` | Small caps vs large (^RUT stored) | Ten sector ETFs + XLC/XLRE, RSP (§5) |
| 10 | `GET /vol` | nothing | A new options store and writer (§5) |
| 11 | `/basket`, `/hedge` | nothing | No shapes in §12.12 of this copy; single names, ^NDX and chains unstored |

---

## 10. Spec errors found

1. **§12.2 preset slugs vs the engine.** Only `gold-2sigma-spx-weak` exists. The engine names the crosses
   `spx-golden-cross` and `spx-death-cross`. The other six presets need an alias table, or the spec should
   use the engine's permalinks (§3).
2. **§4 / §12.2 WINDOW 10.** The engine accepts 5, 20 and 60 (`w=10` → 422). The horizon 10 is fine.
3. **§4 WHILE "S&P above its 50-day".** Not an engine condition (422).
4. **§4 MOVE "crosses above / below MA" for any series.** The engine's cross is the S&P 50/200 only.
5. **§12.2 `confidence`.**
   - The engine fixes 90%. Its `inputs_hash` includes the constant `CI_LEVEL`, so it is identical at 80,
     90 and 95%.
   - "Cached by `inputs_hash`" would serve one level's answer for another unless the level enters the
     hash.
   - The hash also includes the generation key (inode, mtime, size of the file), so the same data in
     another copy of the file hashes differently.
6. **§1.5 verdicts.**
   - The engine produces per-horizon `established` / `not established` / `included`, not Reliable,
     Suggestive or No edge.
   - The spec does not say which horizon decides the pill.
   - "Suggestive … or n < 10" collides with the §1.7 empty state (n < 10 → no verdict).
7. **§1.5 "vs normal = median − 1.3".** The engine serves each study's own baseline median (+1.30% to
   +1.31% for S&P targets, other values for yield targets). A constant is wrong for the `spx-2sigma-10y`
   preset, whose unit is bp.
8. **§4 BY REGIME "n < 5 renders n<5".** The engine suppresses cells below 10 (`MIN_REGIME_N = 10`,
   note `n<10`).
9. **"since 1990" for S&P-only signals** (§2, §3, §8).
   - The engine's evaluable sample starts **1996-07-01**, the first month with a two-month-lagged regime
     label.
   - Earlier events go to the `Unlabeled` row, outside the totals.
   - "Data from 1990" is true; "N× since 1990" is not.
10. **§5 recession text.**
    - "Against NBER recession dates since 1970": the model trains on 2003-04 onward (281 months;
      breakevens start 2003).
    - "PEAK LAST CYCLE 71% (Mar 2020)" cannot come from the served series: Mar 2020 is 31.0%, and the
      2019–2021 peak is 95.50% (Jun 2020).
    - "Last cycle" needs a definition.
11. **§5 flip thresholds.**
    - The rule (`src/regime.py`, `ROLLING_WINDOW = 3`) fits an OLS slope to three monthly *index
      levels*: slope = (y<sub>t</sub> − y<sub>t−2</sub>) / 2.
    - So a September print flips the sign only if it lands below the July level.
    - "A soft print (<0.2% m/m)" and "a negative print" are not the thresholds this rule implies.
    - The number must come from a function over the rule, as §5 says. B should not copy these example
      words.
12. **§5 "NEXT INDPRO Oct 17".** `event_calendar` has no industrial production release.
13. **§11 Data Pipeline, Credit group "FEEDS: Regime".** The regime rule reads INDPRO and CPIAUCSL only;
    the OAS series feed Credit (and HY the recession model and the Desk).
14. **§12.8 "Positions persist server-side in the existing store".**
    - The API opens the database read-only, and every POST is pure computation (CLAUDE.md, FastAPI
      section).
    - The database is replaced from the release asset on every refresh, so a write would be overwritten.
    - Frame-2 keeps positions in the browser, and §1.8 keeps baskets in `localStorage`.
    - A server-side store is a design decision the spec has not made.
15. **§11 / Build Notes "26 series".**
    - The store's inventory is 29 rows.
    - 10 of the mockup's 26 are not stored.
    - T10Y2Y, which the Position Monitor watches, is stored but missing from the 26.
16. **Build Notes "High-yield spreads from FRED only go back three years on the free tier".** FRED's
    three-year window applies to every user since April 2026; it is not a tier.
17. **§11 Client view vs its PNG.**
    - The spec describes a one-card summary: a source line, a title and four regime rows.
    - The PNG adds a headline and three stat cards, and dates the setup "SEP 21, 2026".
    - It reads "41 episodes since 1990" for a gold study (gold is stored from 2000).
    - Its Stagflation bar is red beside "+1.9%", which breaks §1.3 (red = negative numbers).
18. **§12.4 `firing_day` and `firing_now`.** No definition of when a signal starts or stops firing.
19. **§8 / §12.4 row definitions left open.**
    - No window for "2s10s +2σ steepening".
    - No sign for "S&P 20-day move over 2σ" and "5-day move over 2σ".
    - No window for "S&P −2σ → 10y".
    - This audit assumed 20 sessions and "either way"; B should write the choice into the spec.
20. **§12.2 example `"sample_start":"2000-01-03"`.**
    - The engine's `sample_start` is the first *evaluable* session (2001-09-19 for the gold preset).
    - Its history start is `data_start` (2000-08-30).
    - The spec should say which field the "since 2000" line reads.
21. **§11 Data Pipeline header "daily 00:23 UTC".** The full refresh runs at 11:17 UTC daily and 00:23 UTC
    Tuesday to Saturday (CLAUDE.md). The Desk series' last advance was 05:07 UTC on 2026-09-24.
22. **Build Notes review log** (`screens/11-build-notes.png`).
    - "Every branch was reviewed by an independent model (Codex) … before it was pushed" does not match
      the reports:
      - `desk/frame` records one verifier round and no Codex review.
      - `desk/frame-3` has 26 verifier rounds and no Codex round.
      - `desk/frame-3` and `desk/hardening` are not pushed.
    - "All fixed or logged as accepted exceptions" leaves out 19 deferred findings, 3 owner actions and 3
      open findings (§8).
