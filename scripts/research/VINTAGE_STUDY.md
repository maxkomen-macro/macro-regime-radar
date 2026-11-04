# Macro data vintage impact study (Desk plan D8)

Research only. Nothing in this study changes the served regime model, the recession model, the stored history or any Desk output. It measures how much those outputs depend on using today's revised data for months that, at the time, were known only through earlier, unrevised prints. Any change to what the site serves is a separate decision.

Run date: 2026-11-03. Inputs: the `data-latest` database as published that day (newest regimes run `2026-11-03T18:32:59`), and ALFRED vintages of INDPRO, CPIAUCSL, UNRATE and USREC fetched 2026-11-03 21:16 UTC.

## Summary

- **Regime labels.** 78 of 356 monthly labels (21.9%) differ from the served label when each month is labelled with the data available the day its two prints were first out. Growth (INDPRO revisions) causes 51 of the flips and inflation (CPI revisions) 27; no month flips on both. The effect is steady across the sample: 23 of 120 months in 1997–2006, 32 of 120 in 2007–2016, 23 of 116 since 2017, and 5 of the last 24.
- **The served odds don't flag revision risk.** Flipped months had a median served top-regime odds of 63%, against 66% for months that kept their label. 26 of the 126 months with odds of 75% or more still flipped. The odds measure how far the trends are from zero, not how likely a revision is to change the sign.
- **The history shifts towards Stagflation.** Real-time labelling has 219 Overheating, 80 Stagflation, 33 Goldilocks and 24 Recession Risk months, against 206, 102, 27 and 21 served. The largest single transition is Overheating at the time becoming Stagflation after revision (33 months).
- **Desk event studies.** Under point-in-time labels, 151 of the 632 events across the 15 catalog studies (23.9%) carry a different regime. Every study's all-events statistics are unchanged. The regime split changes in 13 of 15 studies, and in 5 of them it changes which regimes reach the n ≥ 10 bar the verdict needs. No served verdict names a strongest or weakest regime, so none is overturned, but the split rows printed beside each study change.
- **`/regime` stats.** Under real-time labels the regimes table governs 79 Stagflation months instead of 102, and Goldilocks' share of up months for the S&P rises from 63% to 73%.
- **Recession score, data revisions only.** With today's model applied to first-published UNRATE and INDPRO, scores move by a median of 0.24 pp (maximum 4.0 pp) and change band in 5 of 282 months.
- **Recession score, point in time.** Refitting the model each month on only what was knowable then (including NBER's real-time recession dating) moves scores by a median of 3.0 pp and a maximum of 72 pp, and changes the band in 27 of 183 months since mid-2011. That gap comes mostly from the fit and the target, not from data revisions.
- **Publication timing.** A regimes row stamped M is first knowable a median of 46 days after its stamp date (16 days after the month ends). The Desk's two-month lag holds in every month but one: the 2025-09 row was not published until 2025-12-03, after the November 2025 sessions it labels. The October 2025 CPI was never published, so there is no 2025-10 row.

## Method

### Data

- **ALFRED** (`scripts/research/alfred.py`): every real-time period of every observation from 1990 (`output_type=1`), cached as gzipped JSON outside the repo. `as_of(day)` rebuilds a series exactly as it could be downloaded on `day`, and `first_release` gives each observation's first non-blank print and its date.
- **Coverage:** INDPRO has 467 vintage dates (1990-02-16 to 2026-10-16), CPIAUCSL 459 (1990-02-21 to 2026-10-14), UNRATE 441 and USREC 150. USREC vintages only start on 2011-05-02.
- **Replica check:** the classifier imported from `src/regime.py` reproduces all 356 rows of the newest stored run exactly (labels equal, odds error 0.0). ALFRED's latest vintage equals the stored INDPRO (359 months) and CPI (358 months) inputs to the last digit. The recession replica matches the module's served probability series with a 0.0 pp gap. So "served" and "latest vintage" are the same data, and every difference below is due to the vintage. ALFRED's latest UNRATE and USREC also equal the stored series month for month (366 and 368 months). The scripts enforce all of this before writing any output, with a tolerance of 1e-9. The regime script stops unless every stored row and every INDPRO and CPI month is covered and equal (`enforce_replica`). The recession script stops unless its served series is the module's month for month (`enforce_replica`), and unless the cached UNRATE, INDPRO and USREC equal the stored series (`alfred.enforce_store_match`).

### Regime labels (`vintage_regime.py`)

The classifier runs unchanged on 668 vintage dates, with every replay starting at the served window's start (1996-11-01) so that only the data differs. Three real-time views are compared with the served label:

| View | Definition | Months | Differ |
|---|---|---|---|
| `first_known` | label of month M in the vintage of the day both M prints were first out | 356 | 78 (21.9%) |
| `at_governed_start` | label of row M from the vintage of the last day of M+1, the eve of the month it governs under the Desk's K−2 rule | 355 | 78 (22.0%) |
| `first_release_series` | labels computed on a series of first prints (no one saw this series, but it is the "first-published CPI/INDPRO" reading) | 356 | 92 (25.8%) |

- **Revisions continue long after a month is first labelled.** 116 months changed label at least once after first publication, 57 changed two or more times, and the most changes for one month was 7. Among months that changed, the last change came a median of 670 days (p90 about 9 years) after first publication. INDPRO's annual revisions and rebasings reach decades back.
- **Regime changes:** 123 in the served history, against 132 in the real-time history.
- **Odds:** the largest absolute gap between the served and first-known odds for a month has a median of 0.15 and a p90 of 0.57. It exceeds 0.20 in 137 of 356 months.

| First known → served | Months |
|---|---|
| Overheating → Stagflation | 33 |
| Goldilocks → Overheating | 14 |
| Stagflation → Overheating | 14 |
| Overheating → Goldilocks | 8 |
| Recession Risk → Stagflation | 4 |
| Goldilocks ↔ Recession Risk | 2 / 2 |
| Stagflation → Recession Risk | 1 |

Recent months that differ (first known → served): 2024-09 Overheating → Stagflation, 2025-04 Stagflation → Overheating, 2025-08 Stagflation → Overheating, 2025-11 Overheating → Stagflation, 2025-12 Overheating → Stagflation. The current row (2026-09, Overheating) and the eight before it are unchanged.

### Publication timing

- **When a row is knowable:** row M can exist once both INDPRO M and CPI M are published. That is a median of 46 days after its stamp date (minimum 42, maximum 93), or a median of 16 days after the month ends (p95 21, maximum 64). INDPRO is the later of the two prints in 155 of 356 months.
- **The Desk's K−2 rule is the shortest lag that is safe.** A session in month K reads row K−2. In 355 of 356 months, that row was published before month K began. A one-month lag would read a row that was not yet published for roughly the first half of every month.
- **The one exception: 2025-09.** INDPRO for September 2025 was delayed by the shutdown to 2025-12-03, while CPI was out on 2025-10-24. The Desk tags November 2025 sessions with that row, which was not public until December.
- **No 2025-10 row:** the October 2025 CPI was never published (ALFRED serves a blank). There is no 2025-10 row, so December 2025 sessions are Unlabeled.
- **Slope windows across the gap:** `compute_trends` takes a 3-row rolling slope, not a 3-month one, so the 2025-11 and 2025-12 slopes span the missing month as if it were not there. This is an observation; nothing was changed.
- **Older rows and drifting odds:** the refresh's 30-year window start moves each month. The 8 stored rows for 1996-05 to 1996-12 are left over from earlier runs, and every row's expanding z-score (so its odds and confidence, but not its label) shifts slightly as the start moves. Also an observation; nothing was changed.

### Desk event studies (`vintage_studies.py`)

All 15 catalog studies were run through the engine at their defaults (default seed, 10,000 draws) three ways:

- **`served`:** the stored table, unchanged.
- **`governed_start`:** a scratch copy of the database with the regimes labels swapped for the `at_governed_start` view. The engine runs unmodified.
- **`point_in_time`:** each session reads row K−2's label from the vintage in force on the session's own date. This uses an in-process replacement of `event_study.regime_at`, the one function the engine reads labels through; no file is edited.

Point-in-time results against served, at the 20-session primary horizon:

| Study | Events | Relabelled | What the regime split says |
|---|---|---|---|
| gold-2sigma-spx-weak | 18 | 8 | n<10 counts move (Stagflation 9→6, Recession Risk 1→3) |
| golden-cross | 14 | 6 | n<10 counts move |
| death-cross | 14 | 6 | **Stagflation drops below n = 10** (10→5): "Only Stagflation reaches n ≥ 10 (median −0.4%)" becomes "No regime reaches n = 10" |
| vix-spike-2sigma-5d | 120 | 29 | **Goldilocks drops below 10**: the "two leading regimes within 0.5 pp" sentence disappears |
| hy-2sigma-20d | 3 | 0 | unchanged |
| 10y-2sigma-20d | 37 | 6 | Stagflation n 12→10, median +2.4% → +2.8%; Overheating n 19→21 |
| dollar-2sigma-20d | 40 | 5 | **Overheating becomes eligible** (n = 24, median +0.4%) |
| oil-2sigma-gold | 17 | 7 | n<10 counts move (Overheating 6→9, Stagflation 4→1) |
| spx-2sigma-10y | 56 | 16 | n<10 counts move |
| spx-20d-2sigma | 34 | 5 | **Overheating median −0.1% → +0.8%** (n 19→22) |
| spx-5d-2sigma | 78 | 17 | **Stagflation becomes eligible** (n = 14): a "within 0.5 pp" sentence appears |
| 2s10s-2sigma-steepening | 50 | 10 | **The tie sentence (Stagflation n = 17 vs Overheating n = 28) disappears** |
| oil-2sigma-20d | 17 | 7 | n<10 counts move (Overheating 6→9, Stagflation 4→1) |
| rsi-above-70 | 89 | 17 | n<10 counts move |
| rsi-below-30 | 45 | 12 | n<10 counts move |

- **Totals:** 151 of 632 events are relabelled. The all-events n and medians are identical in all 15 studies.
- **`governed_start` gives nearly the same picture:** 161 events relabelled, and the same 13 studies with a changed split. Mid-month releases account for the small difference.

`/regime` stats (the S&P's return in the month each label governed), served against `governed_start`:

| Regime | Months | S&P median month | Up months | VIX average |
|---|---|---|---|---|
| Goldilocks | 27 → 33 | +1.11% → +1.26% | 63% → 73% | 16.8 → 18.0 |
| Overheating | 214 → 227 | +1.22% → +1.22% | 62% → 61% | 19.7 → 19.6 |
| Stagflation | 102 → 79 | +1.14% → +1.07% | 63% → 62% | 20.7 → 21.0 |
| Recession Risk | 21 → 24 | +1.13% → +0.99% | 67% → 67% | 27.0 → 25.9 |

Regime changes counted by `/regime`: 123 → 132.

### Recession score (`vintage_recession.py`)

The served model is the one `src/analytics/recession.py` fits today. Its training window is 2003-04 to 2026-11 (283 rows), and it contains the 2008–09 and 2020 recessions. The fifth feature (the T10YIE − T5YIE spread) starts in 2003, which is what sets the window.

- **`vintage_only`:** today's fitted model, scoring each month from its feature row (three rows earlier) as first published. UNRATE and INDPRO come from the vintage of the day both prints were out; the market series are read as stored.
  - First-published inputs differ from today's by a mean of 0.05 pp (max 0.2) for UNRATE and 1.16 pp (max 3.9) for INDPRO's 12-month change.
  - Scores differ by a mean of 0.70 pp, median 0.24, p90 2.21 and max 4.02 (2022-07: 62.2% real-time against 58.1% served).
  - The band (low < 20 ≤ elevated < 40 ≤ high) differs in 5 of 282 months: 2004-06, 2004-08, 2015-06, 2017-12 and 2020-02.
- **`point_in_time`:** on each of those dates, the model is refitted with the same code on only what was knowable then: vintage UNRATE and INDPRO, market series through that date, and USREC as ALFRED served it that day. A recession counts in the target only once NBER has dated it, and its months stay recession months until the trough is announced.
  - Scores differ by a mean of 7.56 pp, median 3.04, p90 16.2 and max 72.0. The maximum is 2020-12, scored 73.4% in real time (the recession had begun and its end was not yet dated) against 1.4% served.
  - The band differs in 27 of 183 months (2011-07 to 2026-10).
  - Before 2011-05, the real-time target can't be traced to a stored vintage. ALFRED's USREC vintages start then, and NBER's announcement page could not be reached from this session, so those months are not scored rather than reconstructed from memory.
- **Latest scored month:** 2026-10, which reads the 2026-07 feature row, rebuilt as of 2026-08-18 (the day July's INDPRO was first published). It scores 12.39% served, 12.36% with today's model on the first-published inputs, and 12.45% point in time. All three round to 12.4%, but they rest on different data: July's INDPRO 12-month change was first published as 1.08% and reads 1.28% today, and no recession has been dated since 2021.

## Caveats

- **Market series are treated as unrevised:** DGS10, DGS2, BAMLH0A0HYM2, T10YIE and T5YIE are read from the store as they are now. This is an assumption, not a measurement.
- **Partial-month look-ahead in the point-in-time fit:** the monthly stored market rows hold each month's last observation, so the refit's newest market row can include a few days past the fit date. Only that row is affected, and it is never the row being scored.
- **Regime replays use a fixed window start:** every replay starts at 1996-11-01, the served run's start, so the window is held constant. The refresh at each historical date would have used a different 30-year start. That moves odds slightly and labels not at all (see Publication timing).
- **Same-day releases count:** a release on a session's own date counts for that session. CPI is out at 08:30 ET and G.17 at 09:15 ET, both before the open.
- **The NBER dating fallback is not exercised:** `recession.py`'s hardcoded NBER list is used only when USREC is absent. USREC is present, so the list is not used here.

## Other observation (served model, not a vintage effect)

The served recession model scores 0.1% for 2020-09, a month whose inputs (June 2020) had unemployment at 11.0% and INDPRO down 10.6% year on year. This reflects the fitted coefficients and the three-month lag, not data vintage. It may deserve its own look; this study does not change it.

## What this does not decide

The study changes nothing served. These would each be Max's decision, separately:

1. Label the Desk's regime-split and `/regime` stats as computed on revised regime history (D6 already asks for that label).
2. Store a point-in-time regime history next to the revised one.
3. Handle the 2025-09 and 2025-10 publication gaps explicitly.
4. Serve a point-in-time recession score or keep the in-sample one.

Any point-in-time implementation needs a detailed plan and approval first (APPROVED.md, D0).

## Reproduce

```
export FRED_API_KEY=...            # read from the environment, never printed
CACHE=<dir outside the repo>; OUT=<dir>; DB=data/macro_radar.db
python3 -m scripts.research.alfred --cache $CACHE INDPRO CPIAUCSL UNRATE USREC
python3 -m scripts.research.vintage_regime   --cache $CACHE --db $DB --out $OUT
python3 -m scripts.research.vintage_studies  --db $DB --labels $OUT/regime_labels_by_vintage.csv.gz \
        --histories $OUT/regime_histories.csv --scratch <scratch dir> --out $OUT
python3 -m scripts.research.vintage_recession --cache $CACHE --db $DB --out $OUT
```

Run times on the cloud sandbox: regime replay about 40 s, studies about 30 s, recession about 60 s. `tests/test_research_vintage.py` pins the real-time reconstruction rules (`as_of`, `first_release`, the vintage lookup, the point-in-time label and the score bands) on synthetic tables. ALFRED's latest vintage moves with every release, so a later rerun gives slightly different counts. If a later database or vintage no longer agrees, the replica check stops the run instead of reporting. `tests/test_research_vintage.py` also pins that refusal on mismatched labels, odds, missing rows and months, and ALFRED values that differ from the store.
