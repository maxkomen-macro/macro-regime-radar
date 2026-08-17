# Integrity Fixes — 2026-08-06

Fixes for the four data-integrity bugs from [SUMMARY.md](SUMMARY.md), applied **locally only** on top of HEAD `c1ee467` — nothing committed or pushed. Every fix verified against the DB (query output below) and against the running app (screenshots taken in-session; the rendered strings quoted here are transcribed from those captures). Test suites pass after all changes: 31 (chat-guard + dates, anaconda) + 16 (API, `.venv`).

Working-tree note: `CLAUDE.md`, `api/db.py`, `api/main.py`, `api/recession_cache.py`, `requirements-api.txt`, `tests/test_api.py`, and `proposals/` were already modified/untracked before this session (React-migration API work) and were **not touched** here.

---

## Bug 1 — Contradicting probabilities (header 83% vs card 58% vs banner 58%)

**Root cause.** Two loaders invented probabilities instead of reading them. `src/analytics/regimes.py::get_current_regime_probs` and `src/analytics/intelligence.py::_get_current_regime_state` both reconstructed a distribution from `regimes.confidence` + hardcoded `REGIME_BASE_RATES` priors — the docstring even claimed "exact softmax probabilities are not stored in the regimes table," which is false: `regimes.prob_*` columns exist, are written by `src/regime.py`, and are populated for **all 360 rows** (0 NULLs). The header badge and Dashboard bars read the stored columns (83%); the Intelligence gauge, both narrative cards, the scenario baselines, and the Allocation banner surfaced the 58% confidence dressed up as a probability.

**Fix.**
- `get_current_regime_probs()` and `_get_current_regime_state()` now read the stored `prob_*` columns; the confidence-derived approximation survives only as a fallback for legacy NULL rows (none exist in this DB). The state dict key was renamed `approx_probs` → `probs`.
- Allocation banner now shows both quantities, labeled: **"83% model probability · 58% conviction"** (`get_current_regime()` extended to return the stored dominant probability).
- Scenario analysis (`run_scenario`) now stresses from the stored baseline instead of the reconstruction — scenario outputs shift accordingly (they are now anchored to the model's actual odds).

**Recession's three values** (14.6% strip / "15%" card / RR 0% bars): the "15%" was the *same* model value rounded `:.0f`; RR 0% is a *different* quantity (`regimes.prob_recession` = 0.0003, the regime-classifier's odds of the Recession-Risk regime, shown under the regime-probability header where it belongs). Fix: the narrative now prints the model value at one decimal with its source and the tab's own bands — **"The 12-month recession model reads 14.6% — low"** — using the documented 20/40 thresholds (the old sentence also used its own private 15/30 bands). If the model is unavailable the sentence is omitted entirely instead of printing an invented 15%.

**Files.** `src/analytics/regimes.py`, `src/analytics/intelligence.py`, `src/analytics/allocation.py`, `dashboard/components/intelligence_tab.py`, `dashboard/components/allocation_tab.py`.

**Verification.** Surface audit: every regime/recession-probability read now resolves to stored columns — header badge (`app.py:710`), Dashboard bars (`decision_view.py:113`), Intelligence gauge/pills, both narrative cards, Allocation banner, chat tool (`chat.py:99`, already stored), API (`api/main.py`, already stored), memos (already stored). Script output (`scratchpad/verify_bug1.py`) against the live DB:

```
DB truth        : 2026-05-01 Overheating conf=0.5797
stored probs    : GL=0.0015 OV=0.8261 ST=0.1721 RR=0.0003
get_current_regime_probs: {'goldilocks': 0.0015, 'overheating': 0.8261, ...}
_get_current_regime_state probs: {'Goldilocks': 0, 'Overheating': 83, 'Stagflation': 17, 'Recession Risk': 0}
header badge=83%  gauge=83%
allocation banner: label=Overheating conviction=58% prob=83%
recession model : 14.6%
narrative       : Markets are in Overheating regime (83% probability) with credit spreads
                  at the 2nd percentile — historically tight. The 12-month recession model
                  reads 14.6% — low. ...
ALL BUG-1 SURFACES RESOLVE TO STORED VALUES ✅
```

Rendered app confirms: header badge **"Overheating 83%"** (pills ST 17% · GL 0% · RR 0%), Intelligence gauge **"83% Overheating"** with pills 83/17/0/0, narrative card **"(83% probability)"** — one number everywhere.

---

## Bug 2 — "News pipeline dead since Jul 08"

**Root cause — the pipeline is not dead.** Diagnosis:

- `gh run list` (refresh-data.yml): every recent hourly run **succeeded**; the latest (2026-08-06 08:32 UTC, run 31085188743) logged `Stored 46 new headlines`.
- The `data-latest` release asset (what the live app serves) has `news_feed` spanning **Jul 30 → Aug 06 08:17 UTC**, 3,782 rows at ~500–800/day — because `src/analytics/news.py:700` prunes anything older than 7 days by design.
- The Jul-08 wall exists only in the **local snapshot**: its newest news row has `fetched_at 2026-07-08 17:29` and its span (Jul 01–08) is exactly the 7-day retention window as of that moment. Since then the local copy's `market_daily` kept advancing (keyless yfinance runs locally) while news never could — `FINNHUB_API_KEY`/`NEWS_API_KEY` are absent from local `.env`, and the DB was never re-downloaded from the release.
- The tab then turned data-lag into apparent product death: `load_news` hard-filters to `now − 24/48/168h` with no fallback → five zero counters + two apology cards over 3,715 invisible stored articles.
- **No secret/key rotation is needed.** All keys work in CI; the local gap is by design (keys live in GitHub secrets, not on this machine).

**Fix (code) — latest-available fallback**, `dashboard/components/events_tab.py`: new `load_latest_news()` loader (most recent N regardless of age, newest first, category-aware); when the active window is empty the tab now shows those dated headlines under an amber notice — **"No headlines in the last 24H — latest stored coverage is Jul 08, 2026 17:28 UTC; showing the 50 most recent."** — and the summary bar counts what is displayed. The apology card now appears only when `news_feed` is truly empty, with honest copy.

**Fix (verification of the fetch path).** Ran the real pipeline keyless (RSS path: Fed/NYT/CNBC/FT/MarketWatch via feedparser) against a byte-identical copy of the stale local DB:

```
BEFORE: rows=3715  span=2026-07-01T00:04:20+00:00 .. 2026-07-08T17:28:38+00:00
fetch_and_store_news returned: 107 new rows inserted
AFTER : rows=107   span=2026-08-04T10:17:29+00:00 .. 2026-08-06T09:15:00+00:00
```

Fresh rows written minutes after publication; the pipeline's own 7-day prune removed the stale July rows as designed. (`feedparser` was missing from the local anaconda env despite being in requirements.txt — installed.)

**Why a copy:** this session's permission layer blocked direct writes to `data/macro_radar.db` for the news path (its prune deletes rows), so the live-fetch proof ran on `scratchpad/verify_fetch.db`. A backup of the pre-session local DB is at `…/scratchpad/macro_radar.db.backup-2026-08-06`. **To refresh the local snapshot to match the live app** (strictly fresher on every table except intraday history that the cloud prunes at 30 days):

```bash
gh release download data-latest --pattern macro_radar.db --dir data --clobber
```

**Rendered evidence.** Events & Intelligence with the stale local DB now shows: summary bar **HEADLINES 50 · HIGH IMPACT 0 · M&A DEALS 10 · MACRO/FED 2 · GEOPOLITICAL 1** (was five zeros), the notice line above the filter pills, and the two-column feed of dated headlines ("CNBC · 28d ago") with working detail cards.

---

## Bug 3 — Calendar ended Jun 18

**Root cause — source exhausted, loader fine.** `event_calendar` is fed solely by `events/calendar.csv` via `src/events/load_events.py` (idempotent `INSERT OR IGNORE`, re-run daily by the workflow). The CSV was hand-written once with 14 rows ending **2026-06-18** and never extended, so the loader has been faithfully re-ingesting the same past events for months. (Side-note: the old "2026" FOMC rows — Mar 19 / May 7 / Jun 18 — actually match the *2025* Fed calendar; real 2026 meetings were Mar 17–18 / Apr 28–29 / Jun 16–17. Past rows were left untouched as history; only the new rows are authoritative.)

**Fix.** Extended `events/calendar.csv` with **28 verified events for Aug–Dec 2026**, from primary sources: FOMC dates from federalreserve.gov (Sep 15–16, Oct 27–28, Dec 8–9; statement 2 PM ET day 2); CPI + Employment Situation from the BLS release schedule; GDP, PCE (Personal Income & Outlays) and Advance Retail Sales from the OMB *Schedule of Release Dates for Principal Federal Economic Indicators CY2026*. Times encode 8:30 AM ET releases as 12:30 UTC (EDT) / 13:30 UTC (EST after Nov 1). Then ran the loader against the local DB.

**Verification.**

```
[events] Loaded 28 new events (0 invalid skipped, 14 duplicates ignored).
event_calendar: 42 rows, max event 2026-12-23T13:30:00Z
Upcoming next 30 days: Aug 7 NFP · Aug 12 CPI · Aug 14 Retail Sales ·
                       Aug 26 GDP 2nd Est + PCE · Sep 4 NFP
```

Rendered app: UPCOMING MACRO EVENTS table shows **"Aug 7, 2026 +1d Jobs Report (NFP) · HIGH"** through Sep 4 — six rows where the empty-calendar card used to be. The live app picks the rows up on the first scheduled full refresh after the CSV is pushed.

---

## Bug 4 — Correctness sweep

**4a. "2th percentile" ordinal bug.** One shared helper — `src/utils/format.py::ordinal()` (handles 1st/2nd/3rd/11th–13th/21st/…) — replaced **11 hardcoded `…th` sites across 8 files** (the inventory's "four tabs" undercounted): `src/analytics/intelligence.py` (narrative), `src/analytics/credit.py` (CLI prints), `dashboard/components/` `credit_tab` (HY/IG spread-context cards), `lbo_tab` (HY rank), `recession_tab` (2 sites, 2s10s pct), `intelligence_tab` (duration percentile + analogue metric), `market_snapshot` (GARCH vol percentile). Verified: 14-case unit sweep incl. `ordinal(2)='2nd'`, `ordinal(68)='68th'`, `ordinal(101)='101st'`; narrative renders "credit spreads at the **2nd percentile**"; grep for `}th` patterns returns nothing.

**4b. Surprise rows mislabeling a CPI level as a weekly surge.** Root cause: one phrasing template treated every metric as a percent change. Fixing it exposed **two more latent unit bugs in the same template**: weekly ETF returns are stored as *fractions* (0.0039) but printed as `+0.00%`, and yield changes are percentage *points* printed as `%`. New shared `src/utils/format.py::z_interpretation()` with a per-metric kind map (level / return-fraction / yield-pp→bps / pp / index-points) now backs **both** consumers — `dashboard/components/db_helpers.py` (Dashboard + Markets rows) and `src/memo.py` (weekly memo) — which previously had duplicate, independently-wrong copies. Rendered before → after, from the live Dashboard:

| Before (capture 2026-08-06 AM) | After (same data) |
|---|---|
| CPI YoY surged sharply (+4.17%) — 3.9σ move | **CPI YoY runs at 4.17% YoY — a 3.9σ high reading vs its recent range** |
| Unemployment rate fell notably (-0.10%) | Unemployment rate fell notably (**-0.10pp on the week**) |
| 10Y–2Y Yield Spread surged modestly (+0.05%) | 10Y–2Y Yield Spread surged modestly (**+5 bps on the week**) |
| LQD (IG Credit) fell modestly (-0.01%) | LQD (IG Credit) fell modestly (**-0.70% on the week**) |

**4c. Self-contradicting freshness lines.** Each claim now states what the data actually is:
- Credit status bar: "refreshed daily 6 AM ET · as of Jul 01, 2026" → **"FRED BAML series · monthly observations · latest Jul 01, 2026"** (`credit_tab.py`).
- LBO: "Live Financing Rate" → **"Financing Rate"** (the existing "As of …" line now has nothing to contradict) (`lbo_tab.py`).
- Recession status bar: "· updated daily" → **"· monthly inputs through 2026-07-31"** (pulled from the model's own `data_as_of`) (`recession_tab.py`).
- Intelligence narrative card: "Updated Just now" → **"Macro data as of May 2026"** (stamped from the latest `regimes` row the narrative is actually built from) (`intelligence.py` + `intelligence_tab.py`).

**4d. Stale branding.** Footer "Data: FRED · Polygon.io · Yahoo Finance" → **"Data: FRED · Yahoo Finance (yfinance) · Finnhub · NewsAPI · RSS"**; Methodology data-sources row and pipeline-schedule row Polygon.io → yfinance (with the real 23-symbol daily + 5-min intraday coverage); sidebar caption "Macro Regime Radar · Phase 3 + Trader Pack" → **"Macro Regime Radar"**; app.py docstring likewise; Credit's returns-table footnote "Phase 8 will replace with live backtest" (Phase 8 shipped long ago) → honest static-reference labeling: *"Static reference table — approximate medians from academic and industry research, not computed from this dashboard's data."*

**4e. Recession gauge bands 33/60 vs documented 20/40.** **Chose: code matches docs (20/40).** Rationale: 20/40 is what actually classifies — `_classify_prob` in `src/analytics/recession.py` (the Low/Elevated/High badge), the Methodology tab ("Low <20%, Elevated 20–40%, High ≥40%"), and the newly-unified narrative sentence all use 20/40; the 33/60 pair existed *only* in the SVG arc colors, so it was the outlier, and at 25–33% it painted a green arc under an "Elevated" badge. `_gauge_svg` band boundaries and fill color now use 20/40 with a comment pinning them to `_classify_prob`. Verified: `_classify_prob(14.6)=Low`, `(25)=Elevated`, `(45)=High` all now agree with the arc; rendered gauge shows the green band ending at 20%.

**Files (Bug 4).** `src/utils/format.py` (new), `src/analytics/intelligence.py`, `src/analytics/credit.py`, `src/memo.py`, `dashboard/app.py`, `dashboard/components/{db_helpers, market_snapshot, intelligence_tab, recession_tab, credit_tab, lbo_tab, methodology}.py`.

---

## Environment changes made during verification

- `feedparser` 6.0.14 installed into `/opt/anaconda3` (declared in requirements.txt, was missing locally — required by the news RSS path).
- `.claude/launch.json` added (dev-server config for the in-session browser preview on port 8601).
- Scratchpad artifacts (outside the repo): `macro_radar.db.backup-2026-08-06` (pre-session local DB), `release_db/macro_radar.db` (fresh release asset), `verify_bug1/fallback/calendar/fetch/bug4.py` verification scripts.
- Local DB writes this session: **only** `event_calendar` (+28 rows via the project's own idempotent loader). News/regimes/market tables untouched locally.

## Git status after fixes

```
 M CLAUDE.md                                  (pre-existing, API session)
 M api/db.py                                  (pre-existing, API session)
 M api/main.py                                (pre-existing, API session)
 M requirements-api.txt                       (pre-existing, API session)
 M tests/test_api.py                          (pre-existing, API session)
?? api/recession_cache.py                     (pre-existing, API session)
?? proposals/                                 (pre-existing)
 M dashboard/app.py                           (this session — Bug 4)
 M dashboard/components/allocation_tab.py     (Bug 1)
 M dashboard/components/credit_tab.py         (Bug 4)
 M dashboard/components/db_helpers.py         (Bug 4)
 M dashboard/components/events_tab.py         (Bug 2)
 M dashboard/components/intelligence_tab.py   (Bugs 1, 4)
 M dashboard/components/lbo_tab.py            (Bug 4)
 M dashboard/components/market_snapshot.py    (Bug 4)
 M dashboard/components/methodology.py        (Bug 4)
 M dashboard/components/recession_tab.py      (Bug 4)
 M events/calendar.csv                        (Bug 3)
 M src/analytics/allocation.py                (Bug 1)
 M src/analytics/credit.py                    (Bug 4)
 M src/analytics/intelligence.py              (Bugs 1, 4)
 M src/analytics/regimes.py                   (Bug 1)
 M src/memo.py                                (Bug 4)
?? .claude/                                   (launch.json, verification only)
?? docs/redesign/                             (this inventory + this report)
?? src/utils/format.py                        (Bug 4 — shared helpers)
```

## Shipping risk assessment (per fix, for deploying to the live Streamlit app ahead of the redesign)

- **Bug 1 (stored probabilities):** LOW — read-path swap with NULL-row fallback retained; changes displayed numbers to the values the DB already asserts; scenario baselines shift accordingly (now anchored to real odds). All 47 tests pass.
- **Bug 2 (news fallback):** LOW — additive branch that only activates when the current windowed query is empty; populated feeds render byte-identically to today.
- **Bug 3 (calendar CSV):** MINIMAL — data-only append consumed by the existing idempotent loader; no code changed; wrong dates would merely display (all dates verified against Fed/BLS/OMB primary sources).
- **Bug 4a/4c/4d (ordinals, freshness, branding):** MINIMAL — display-string changes; the shared `ordinal()` is pure and unit-tested.
- **Bug 4b (surprise units):** LOW-MEDIUM — deliberately changes displayed numbers (to the correct units) on Dashboard, Markets **and the weekly memo**; eyeball the first memo render after deploy.
- **Bug 4e (gauge bands):** MINIMAL — presentation-only; aligns the arc with the classification logic that already ships.

One collective caveat: the Streamlit Cloud app caches several of these code paths (`@st.cache_data`/`@st.cache_resource`); after deploying, a cold restart (or the caches' natural TTL) is needed before every surface shows the new strings.
