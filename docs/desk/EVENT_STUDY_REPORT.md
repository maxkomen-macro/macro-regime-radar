# Desk · Conditional Event Study — report

Branch `desk/event-study` (cut from `main` @ 1ebd58c). Backend only. Nothing pushed.

## Status — tier 1 built, awaiting `PUSH OK desk/event-study`

Everything below is on `desk/event-study` (cut from `main` @ 1ebd58c), **uncommitted, unpushed**; `main` untouched; the real database never opened for writing; `web/` untouched. Tier 1 is complete and verified; tiers 2 and 3 are registered, not fetched.

## §1 Decisions taken (Max, 2026-09-21)

| # | Decision | Where it lives |
|---|---|---|
| 1 | Regime lag: a session in month K uses the row stamped K−2; lag and revision caveat in provenance; pre-1996-07 events "Unlabeled", reported, never dropped | `event_study.REGIME_LAG_MONTHS`, `regime_at`, provenance `regime_rule` / `regime_revision_caveat` |
| 2 | New `desk_series` table + own watermark + own full-refresh step; `asset_prices` and allocation freshness untouched; Yahoo only via the Actions refresh path | `src/market_data/desk_history.py`, `refresh-data.yml` |
| 3 | VIX = FRED `VIXCLS` | registry `vix` |
| 4 | Presets (at the default seed) + assets list are worker items; free-form queries compute on request behind the expensive semaphore, 20 s cap, cached by (generation key, slug, seed), `202 computing` never a blank panel | `api/desk.py`, `api/analytics_cache.DESK_PRESETS`, `api/security.EXPENSIVE_PATHS` |
| 5 | Cross-calendar entry = target's next session close (extended: also when an input is public only after the close, VIX and OAS) | `known_by`, `entry_positions`, provenance `entry_rule` |
| 6 | `^GSPC` from 1990; the cross study says "since 1990" | `cross_events`, verdict |
| 7 | Tier order; stop after tier 1 | registry `tier`, `fetched()` |
| 8 | Desk shows only the logistic model's recession probability, never `regimes.prob_recession` | CLAUDE.md rule; the engine never reads either |
| 9 | Scratch DB populated by Max: `data/desk_scratch.db` | `.gitignore`, tests' `DESK_DB` |
| — | Gold = `GC=F` from `asset_prices`, "Gold (COMEX front month)", 2000-08-30, "since 2000"; LBMA entry listed unavailable with reason | registry `gold`, `gold_lbma` |
| — | HY OAS: FRED serves a rolling three years only (see §2); accepted 2026-09-21 | registry `hy_oas`, writer merge |
| — | Gold's daily close declared at 17:00 ET, the conservative reading, so the gold preset enters the S&P the next session (Max, 2026-09-21, after the verifier's defect 1) | registry `gold` (`fixed_at=et(17, 0)`), preset printout §6 |

## §2 Data facts found while building

- **FRED no longer serves `GOLDPMGBD228NLBM`.** Gold is COMEX front month (`GC=F`) from `asset_prices` (Yahoo fallback in Actions; 2000-08-30 → today, 6,539 rows in the scratch copy).
- **FRED serves the ICE BofA OAS series as a rolling three-year window.** Series notes on `BAMLH0A0HYM2` (and `BAMLC0A0CM`): *"Starting in April 2026, this series will only include 3 years of observations. For more data, go to the source."* Metadata now says `observation_start = 2023-09-22`; every request form (`observation_start=1996-12-31`, ALFRED realtime range, first-release view) returns the same 785 rows. The writer was asking for full history; FRED refuses. Fix: FRED rows are **merged** (upsert), never replaced, so the store keeps every observation it was ever served; the registry declares `hy_oas` from 2023-09-22 (what FRED serves) with the note; a series served short of its declared start is flagged `short` in its watermark and named in the table's detail; `validate_db` warns on it. A database rebuilt from nothing would start later; the rolling Release asset carries the history forward.
- **Clock times per series** (added after the verifier's defect 1): every registry entry declares when its daily value is fixed and when it is observable, in ET, and the entry rule reads them. Gold `GC=F` is declared at **17:00 ET** (Max, 2026-09-21: Yahoo's daily close for CME futures may be the 13:30 settlement or the 17:00 Globex close, so the later time is declared), which makes a gold shock enter an equity target the next session. Copper carries the same declaration. The clock times are part of `inputs_hash`, so a change to them is a new study.
- **Index history starts on the first trading day.** `^GSPC` and `^RUT` begin 1990-01-02; the registry says so, and the history bar is the year 1990 (`HISTORY_BAR = "1990-12-31"`), so those series are defaults, not warnings.
- **Provider calls per populate step** (Max's rule): `asset_history` = 25 tickers, 24 EODHD-addressable (one call each with a token; Yahoo otherwise). `desk_history --tier 1` = **0 EODHD calls, 5 FRED calls**. Tier 2 would add 3 EODHD/Yahoo calls and 1 FRED call. The engine and the API make **no** provider calls, ever.
- **A blank `EODHD_API_TOKEN` does not keep the relay off.** `api/stream.py:_load_token` and `api/providers/market.py:_load_token` both treat an empty value as absent and fall through to the repo-root `.env`, which carries the token here. No explicit off switch exists. This session never entered the app's lifespan (TestClient without a context manager), so no relay and no upstream socket were opened. For the launch worktree: no `.env`, or I can add a `RELAY_DISABLED=1` switch on request.

## §3 What was built

| File | Role |
|---|---|
| `src/desk/series.py` | The registry (stdlib): 22 series, declared store, unit, scale, `history_from`, tier, roles, `known_by`, availability + reason |
| `src/market_data/desk_history.py` | The `desk_series` writer: FRED direct (merge), market via `market.daily_history(..., allow_yahoo=True)` (replace whole), completed sessions only, per-series + table watermarks, `short` flag, never fails the refresh |
| `src/desk/event_study.py` | The engine (§4 below) |
| `api/desk.py` | `GET /api/desk/event-study/assets`, `GET /api/desk/event-study` |
| `api/analytics_cache.py` | Worker items `desk_assets`, `desk_preset:gold-2sigma-spx-weak`, `desk_preset:spx-golden-cross`, `desk_preset:spx-death-cross` |
| `api/security.py`, `api/main.py`, `requirements-api.txt` | `/api/desk/event-study` under `EXPENSIVE_PATHS`; router included; API `version="1.5.0"`; `exchange_calendars==4.13.2` |
| `api/db.py`, `api/freshness.py` | `desk_series_date`; a `desk_series` SLA verdict (expected = the session before the last completed one, FRED posts next day; grace to 06:00 UTC; absent on a DB that predates the table) |
| `scripts/validate_db.py` | `desk_series` in full-mode tables, feeds, fingerprints, outage feeds; full mode fails without the table; `desk:*` `short`/`error` watermarks are warnings |
| `.github/workflows/refresh-data.yml` | `Store Desk daily series` step (full mode, after `asset_history`, before `rm -f .env`) |
| `scripts/desk_event_study.py` | Read-only CLI printout of any study |
| `tests/test_desk_history.py`, `tests/test_event_study.py`, `tests/test_desk_api.py`, `tests/test_validate_db.py` | 15 + 69 + 31 tests + the builder change |
| `CLAUDE.md`, `.gitignore` | Desk section, two rules, the scratch path |

## §4 The engine's rules (each pinned by a test; the review's R-ids in §9)

- **Session calendar (R-04, R-02; round 2).** The NYSE calendar from the `exchange_calendars` package (XNYS, pinned 4.13.2 in `requirements-api.txt`), sessions and early closes included, over the whole span of the study's inputs (1990 → today for the S&P studies; 1962 → today when the 10Y is involved). Nothing is derived from stored rows. Every series is aligned onto it: an observation dated off-session (a FRED weekend month-end, a Globex bar on an NYSE holiday, a Treasury print on Good Friday) is dropped and counted; a calendar session a series has no value for, the S&P's own gaps included, is missing and counts as an exclusion (`exclusions[series].missing_sessions`); a date outside the calendar is rejected, never given regular hours. A window's required sessions are the ones its computation reads (a w-session move reads t−w and t; a forward window e and e+h; the cooldown every session); a missing required session excludes the window and is counted (`n_incomplete_by_h`). The z-score's 252-session window tolerates up to 12 missing moves (`Z_MIN_PRESENT = 240`) because the bond market closes on Columbus and Veterans Day while NYSE trades (75 missing Treasury sessions since 1990); under a literal "every interior session" rule no Treasury z-score can form. Reversible in one line if the reviewer prefers the literal reading.
- **Valid prices (R-17).** Before any log, a non-finite value, or a non-positive one on a series that is logged, is an exclusion with a reason (`exclusions[series].invalid_values`, `invalid_reason`), counted per series, applied to events and the baseline identically because it becomes a missing session.
- **Evaluability (R-05; round 2 first item).** One per-session mask: the shock's z exists, the co-condition is computable, the target has a value, and the lagged regime label exists. Events and the baseline both use it; the sample is its first and last session. Every baseline candidate goes through the same `entries_for` delay and the same completeness rules as an event (a candidate at p enters at p or p+1 by the timing rule, its window must be complete, the last candidates without an entry are counted in `baseline_no_entry`), with its regime label from the signal date. **Reconciliation with decision 1:** an event in a month before the first regime row is computed and reported in the split's "Unlabeled" row (`excluded_from_totals: true`, `n_unlabeled`) but is outside `n_events` and the baseline.
- **Shock, cooldown and stages (R-19).** The shock's w-session move in its declared unit, z-scored against the trailing 252 sessions inclusive of the event session. Event = the first session `z ≥ thr` (`+`), `z ≤ −thr` (`−`) or `|z| ≥ thr` (`both`); sessions i+1 … i+w are the cooldown. The shock defines the event date; the condition is evaluated on that session; a shock whose condition fails is dropped and still starts the cooldown. Every filtering stage is recorded in provenance (`stages`: threshold → cooldown → evaluable → condition → regime filter → entry → complete window per horizon), and a zero-event verdict is generated from them, naming the stage that emptied the set and the count that reached it.
- **Timing (R-01, R-02, R-03).** Every series declares `fixed` (when its day's value is determined) and `known` (when a desk can see it) as rules resolved per session against the XNYS open and close, so an early close (13:00) moves every close-relative time with it, and the same rule applies to every baseline candidate. FRED daily Treasury values and the ICE BofA OAS are known at the next session's open, never the same day. Entry is the event date's close only when the target's value is fixed at or after every input is known; otherwise the next session. Gold and copper as targets always enter the next session because their fixing time is ambiguous; `entry_rule` says so.
- **Forward move and baseline.** Close at entry to close h sessions later, in the target's unit; a window whose entry or exit session is missing is excluded and counted; the baseline uses the same rule on every evaluable session.
- **Crosses (R-10, R-21).** Strict only: equality never fires; the side state carries through equal sessions and **resets whenever either average is unevaluable**; an event is admitted only on a session whose immediately preceding session was evaluable and whose carried side was the other one (a cross resolving through a plateau still fires on the first strictly-beyond session, because equality carries the side; a cross right after a gap does not).
- **Calendar extension (R-22).** The calendar is built to the end of the month after the last input date, so every session of the study, the last included, has a next open for the timing rules; the study's session index itself stays bounded by the inputs.
- **Statistics (R-06, R-08, R-11, R-18 rounds 2 and 3).** Per horizon its own n (events with a complete window) and `n_incomplete`, hit rate (share > 0, never flipped), median, mean, p25/p75, the baseline's, Δ, and a 90% **cluster bootstrap** on Δ over blocks of overlapping forward windows. The resample is enumerated **exactly** when the horizon has at most 7 blocks (every one of B^B draws, 7^7 = 823,543, by a vectorized weighted median), Monte Carlo with 10,000 seeded draws otherwise; `resampling`, `n_draws` and the **opposite-sign share** (resampled medians on the other side of the point estimate) are reported per horizon. An interval needs 5 blocks; between 5 and 9 it is printed with "too few independent blocks to judge exclusion". A zero-exclusion claim needs 10 blocks, the 90% interval on the point estimate's side of zero (boundary included), **and** an adverse share below 3%, where **zero is adverse**: with a positive point estimate the adverse draws are the resampled medians ≤ 0, with a negative one those ≥ 0. Both interval bounds are resampled values rounded outward (numpy's `lower` and `higher` methods), never interpolations, so an interval touching zero such as [−0.02, 0] is judged and fails the ceiling rather than reading as "included". When the interval and the share disagree the verdict prints the interval and says "exclusion not established" (`exclusion` ∈ established · not established · included). A horizon with no completed window says "insufficient data".
- **Regime.** The `regimes` table read as stored; a session in month K takes the row stamped K−2; the split reports each regime's n, hit, median, mean (suppressed below 10 with "n<10") beside that regime's own baseline.
- **Verdict (R-08, R-11, R-12, R-19, R-20).** Rule-generated. The interval sentence covers only horizons that have one, each cited with its n and block count; 5–9-block horizons print their interval with the "too few independent blocks" sentence; "insufficient data" and "no interval" horizons are named separately; a regime ranking ("concentrated in … weakest in …") needs two regimes with n ≥ 10 **and** a contrast of at least 0.5 percentage points (5 bp for a yield or spread target) between the top two medians, otherwise "no strongest or weakest claim"; a sole eligible regime is described without ranking; the zero-event sentence names the emptying stage; the sample sentence carries the block count and the resampling method at 20 sessions. Vocabulary: modest, material, concentrated in, not distinguishable from baseline, insufficient data, too few independent blocks, n<10. Tests ban predict / will / proves / model / guarantee / "since data start".
- **Provenance (R-09).** `inputs_hash` = SHA-256 (16 hex) over the data generation id (the leased generation's key in the API, the file key elsewhere), a content hash of every input series (every date and value) and of the regime table, every effective parameter, the timing rules used, the resampling method and draws per horizon, and the engine constants (calendar included). Also: `as_of` + per series, `data_start`, `sample_start`, `sample_end`, `n_sessions`, the four counts, `n_unlabeled`, `n_no_entry`, `n_incomplete_by_h`, `n_blocks_by_h`, `off_session_dropped`, `cooldown`, `seed`, `n_boot`, `ci`, `bootstrap`, `z_window`, `z_min_present`, `generation`, `inputs` (per series: table, unit, fixed, known, defer_as_target, history stored and declared, rows, off-session drops, content hash), `warnings`, `master_calendar`, `evaluability`, `regime_*`, `entry_rule`, `entry_same_session`, `forward_rule`, `hit_rate_rule`.

## §5 API contract

- `GET /api/desk/event-study/assets` → `{shocks[], conditions[], targets[], unavailable[], windows, thresholds, signs, horizons, regimes, presets[], history_bar, regime_lag_months}`. Each asset row: `key, label, series_id, source, table, shock_unit, history_from (stored first date, else declared), history_declared, warn, default, tier, status (stored | planned | deferred | unavailable), known_by, roles, last, rows, note, reason`. Generated from the registry, never hand-typed.
- Jobs lease their generation (R-16): a free-form computation opens the generation's copy it was submitted under and computes only against it; if that copy has been released by the time the job runs, the job is cancelled and the client gets a fresh `202` whose retry lands on a job under the current generation. `cond_value` is clamped to ±1e6 at validation and serialized with `repr` (R-15).
- `GET /api/desk/event-study?study=<slug>` or `?shock=&w=&z=&sign=&cond=&cond_value=&regime=&target=[&kind=cross&cross=golden|death][&seed=]` → `{status: "ready", study{slug, preset, kind, label, params, shock, condition, target{unit, format: pct|bp}}, horizons[], regimes[], recent_events[] (ten newest first: date, z, regime, entry_date, moves{h}), verdict{text, sentences}, provenance{…}}`; `202 {status: "computing", slug, retry_after}` + `Retry-After: 3` past 20 s; `429 {status: "busy"}` + `Retry-After: 3` when `CACHE_MAX` (64) computations are outstanding (R-13); `422 {detail}` for a query the engine cannot run (bad window, threshold, sign, condition, regime, target, a deferred tier-3 series, a non-finite threshold, an invalid seed, a numeric parse failure: every numeric parameter arrives as a string and is parsed by the engine's validation, R-14); `503 {kind: "not_stored"}` for a planned series not yet in the store. The compute cache is keyed by the generation key and the losslessly serialized validated parameters (R-07), so `z=2` and `z=2.0` are one study.
- Slugs: presets `gold-2sigma-spx-weak`, `spx-golden-cross`, `spx-death-cross`; any other study `shock-w{w}-z{z}-{up|down|abs}-{cond[=value]|none}-{target}[-{regime}]` with floats written by `repr` so the slug is lossless (R-07), e.g. `vix-w5-z2.0-up-none-spx`, `us10y-w5-z1.5-down-vix_above=25.0-gold-stagflation`. The seed is not part of the address.

## §6 The preset (§8 printout, `scripts/desk_event_study.py --db data/desk_scratch.db --study gold-2sigma-spx-weak`)

```
Gold (COMEX front month) 20-session move ≥ +2σ (252-session z), while S&P 500 below its 50-day average → S&P 500
calendar XNYS (exchange_calendars 4.13.2), 1990-01-02 to 2026-09-21: 9247 sessions
slug gold-2sigma-spx-weak · as of 2026-09-21 · sample 2001-09-19 → 2026-09-21 (6233 evaluable sessions) · N=18 (shock sessions 193, after cooldown 33, condition held 18; unlabeled 0 outside the totals) · cooldown 20 sessions on the session calendar · seed 20260921 · hash 05b9a275412970f5
  h    n blocks incompl    hit    median      mean       p25       p75 | base n  base med base hit |         Δ                 90% CI  opp%            excl         resample
  5   18     18       0   0.56     +1.6%     +0.6%     -2.3%     +3.4% |   6227     +0.3%     0.58 |     +1.2%         [-1.8%, +3.0%]  34.3        included        mc 10,000
 10   18     18       0   0.61     +1.9%     +1.7%     -0.6%     +4.1% |   6222     +0.7%     0.61 |     +1.3%         [-0.9%, +3.2%]  41.6        included        mc 10,000
 20   18     18       0   0.67     +3.1%     +2.7%     -0.9%     +6.0% |   6212     +1.3%     0.65 |     +1.8%         [-1.6%, +4.1%]  14.6        included        mc 10,000
 60   18     17       0   0.61     +3.0%     +4.2%     -1.1%    +10.0% |   6172     +3.2%     0.70 |     -0.2%         [-4.2%, +6.3%]  49.1        included        mc 10,000
exclusions: gold: off-session 6, missing sessions 19, invalid 0 · spx: off-session 0, missing sessions 0, invalid 0 · baseline candidates without an entry 1
regime split at 20 sessions (own baseline beside it):
  Goldilocks      n=  2  n<10  (baseline n=515, median +1.2%)
  Overheating     n=  6  n<10  (baseline n=3404, median +1.5%)
  Stagflation     n=  9  n<10  (baseline n=1855, median +1.1%)
  Recession Risk  n=  1  n<10  (baseline n=438, median +0.9%)
  Unlabeled       n=  0  n<10  (baseline n=0, median n/a)  (outside the totals)
ten most recent events (newest first):
  event          z regime          entry      same    5d   10d   20d   60d
  2025-04-16  2.08 Overheating     2025-04-17 no    +4.5%  +7.4% +12.0% +17.0%
  2023-03-23  2.11 Stagflation     2023-03-24 no    +3.4%  +3.4%  +4.1%  +9.5%
  2022-03-01  2.21 Stagflation     2022-03-02 no    -2.5%  -0.7%  +4.8%  -7.8%
  2020-04-09  2.03 Stagflation     2020-04-13 no    +2.2%  +4.1%  +5.9% +13.8%
  2019-08-23  2.06 Goldilocks      2019-08-26 no    +1.0%  +3.4%  +3.0%  +8.1%
  2018-12-27  2.09 Stagflation     2018-12-28 no    +2.5%  +3.8%  +6.0% +12.1%
  2016-02-08  2.45 Stagflation     2016-02-09 no    +3.9%  +4.1%  +7.1% +10.2%
  2015-08-21  2.02 Stagflation     2015-08-24 no    +4.1%  +3.9%  +2.6%  +8.0%
  2015-01-20  2.21 Goldilocks      2015-01-21 no    -1.5%  +0.5%  +3.2%  +2.4%
  2011-08-30  2.07 Overheating     2011-08-31 no    -2.7%  -0.8%  -4.9%  -5.1%
verdict: S&P 500 is not distinguishable from baseline at 5 sessions (n = 18, 18 blocks); 10 sessions (n = 18, 18 blocks); 20 sessions (n = 18, 18 blocks); 60 sessions (n = 18, 17 blocks) (the 90% interval on Δ includes zero). No regime reaches n = 10 at 20 sessions, so the split is not informative. n<10: Goldilocks (2), Overheating (6), Stagflation (9), Recession Risk (1). Sample since 2000 (data from 2000-08-30; events evaluable 2001-09-19 to 2026-09-21); 18 events after a 20-session cooldown (193 shock sessions before it); 18 independent blocks at 20 sessions (Monte Carlo, 10,000 draws).
warnings: Gold (COMEX front month): history from 2000-08-30 (after 1990) · off-session observations dropped: gold 6. · calendar sessions without a value: gold 19.
```

Reading it: on the XNYS calendar gold's 20-session move reached +2σ on 193 sessions since 2001-09; the 20-session cooldown leaves 33 shocks; the S&P was below its 50-day average on 18 of them, all in labelled months. Each is entered at the S&P's next session close (gold's close is declared at 17:00 ET), and so is every baseline candidate, whose 6,212 complete 20-session windows have a median of +1.3%. The 18 forward windows never overlap, so the cluster bootstrap has 18 independent blocks and runs Monte Carlo with 10,000 seeded draws. The S&P sits above baseline at 5, 10 and 20 sessions (median +3.1% at 20 sessions, Δ +1.8%) and at baseline at 60, but the 90% interval on Δ includes zero at every horizon, and between 15% and 49% of the resampled medians carry the opposite sign (the `opp%` column), so exclusion is "included" everywhere and no regime reaches ten events. That is the answer to John's question on this sample, said the only way the vocabulary allows. Six Globex bars dated on NYSE holidays were dropped, gold has no bar on 19 calendar sessions, and no window was incomplete.

### §6.1 The 50/200 crosses (spec §6): the golden cross at 20 sessions and the death cross at 60 are the two "established" exclusions on this sample (opposite-sign shares 1.7% and 1.8%, both under the 3% ceiling, fourteen blocks each)

```
S&P 500 golden cross (50-day average crossing above the 200-day, strict) → S&P 500
calendar XNYS (exchange_calendars 4.13.2), 1990-01-02 to 2026-09-21: 9247 sessions
slug spx-golden-cross · as of 2026-09-21 · sample 1996-07-01 → 2026-09-21 (7582 evaluable sessions) · N=14 (shock sessions 16, after cooldown 16, condition held 14; unlabeled 2 outside the totals) · cooldown no cooldown (a cross cannot recur before the opposite cross) · seed 20260921 · hash a079285b71fbd074
  h    n blocks incompl    hit    median      mean       p25       p75 | base n  base med base hit |         Δ                 90% CI  opp%            excl         resample
  5   14     14       0   0.71     +1.0%     +0.8%     -0.2%     +2.5% |   7577     +0.3%     0.58 |     +0.7%         [-0.5%, +1.8%]  15.5        included        mc 10,000
 10   14     14       0   0.71     +1.2%     +0.9%     -1.0%     +2.4% |   7572     +0.7%     0.60 |     +0.5%         [-1.2%, +1.5%]  11.2        included        mc 10,000
 20   14     14       0   0.79     +2.7%     +2.2%     +1.6%     +5.5% |   7562     +1.3%     0.64 |     +1.4%         [+0.4%, +3.3%]   1.7     established        mc 10,000
 60   14     14       0   0.93     +5.2%     +5.5%     +2.7%     +7.1% |   7522     +3.2%     0.69 |     +2.0%         [-0.0%, +3.7%]   6.7        included        mc 10,000
exclusions: spx: off-session 0, missing sessions 0, invalid 0 · baseline candidates without an entry 0
regime split at 20 sessions (own baseline beside it):
  Goldilocks      n=  1  n<10  (baseline n=539, median +1.1%)
  Overheating     n=  5  n<10  (baseline n=4457, median +1.5%)
  Stagflation     n=  6  n<10  (baseline n=2126, median +0.9%)
  Recession Risk  n=  2  n<10  (baseline n=440, median +0.9%)
  Unlabeled       n=  2  n<10  (baseline n=0, median n/a)  (outside the totals)
ten most recent events (newest first):
  event          z regime          entry      same    5d   10d   20d   60d
  2025-07-01       Stagflation     2025-07-01 yes   +1.0%  +1.1%  +2.6%  +6.4%
  2023-02-02       Stagflation     2023-02-02 yes   -2.4%  -2.2%  -3.3%  -0.3%
  2020-07-09       Recession Risk  2020-07-09 yes   +2.0%  +2.6%  +6.1%  +6.0%
  2019-04-01       Stagflation     2019-04-01 yes   +1.0%  +1.3%  +2.7%  +1.6%
  2016-04-25       Goldilocks      2016-04-25 yes   -0.3%  -1.4%  -1.9%  +4.0%
  2015-12-21       Recession Risk  2015-12-21 yes   +2.8%  -1.5%  -7.8%  +1.4%
  2012-01-31       Overheating     2012-01-31 yes   +2.6%  +2.9%  +4.0%  +6.5%
  2010-10-22       Overheating     2010-10-22 yes   +0.0%  +3.6%  +1.4%  +8.0%
  2009-06-23       Stagflation     2009-06-23 yes   +2.7%  -1.8%  +6.4% +17.4%
  2006-09-12       Overheating     2006-09-12 yes   +0.4%  +1.8%  +3.0%  +7.3%
verdict: The 90% interval on Δ excludes zero at 20 sessions (n = 14, 14 blocks). The effect is modest at 20 sessions (n = 14): median +2.7% against a baseline of +1.3%, Δ +1.4%. S&P 500 is not distinguishable from baseline at 5 sessions (n = 14, 14 blocks); 10 sessions (n = 14, 14 blocks); 60 sessions (n = 14, 14 blocks). No regime reaches n = 10 at 20 sessions, so the split is not informative. n<10: Goldilocks (1), Overheating (5), Stagflation (6), Recession Risk (2), Unlabeled (2, outside the totals). Sample since 1990 (data from 1990-01-02; events evaluable 1996-07-01 to 2026-09-21); 14 events; no cooldown, a cross cannot recur before the opposite cross; 14 independent blocks at 20 sessions (Monte Carlo, 10,000 draws).
```

```
S&P 500 death cross (50-day average crossing below the 200-day, strict) → S&P 500
calendar XNYS (exchange_calendars 4.13.2), 1990-01-02 to 2026-09-21: 9247 sessions
slug spx-death-cross · as of 2026-09-21 · sample 1996-07-01 → 2026-09-21 (7582 evaluable sessions) · N=14 (shock sessions 15, after cooldown 15, condition held 14; unlabeled 1 outside the totals) · cooldown no cooldown (a cross cannot recur before the opposite cross) · seed 20260921 · hash 47c92a7500fe6736
  h    n blocks incompl    hit    median      mean       p25       p75 | base n  base med base hit |         Δ                 90% CI  opp%            excl         resample
  5   14     14       0   0.50     -0.2%     -0.2%     -2.2%     +1.4% |   7577     +0.3%     0.58 |     -0.6%         [-2.6%, +1.0%]  39.2        included        mc 10,000
 10   14     14       0   0.50     +0.4%     +0.3%     -3.0%     +4.1% |   7572     +0.7%     0.60 |     -0.3%         [-3.3%, +2.3%]  41.0        included        mc 10,000
 20   14     14       0   0.57     +2.0%     +1.2%     -3.4%     +5.4% |   7562     +1.3%     0.64 |     +0.7%         [-4.3%, +4.0%]  37.6        included        mc 10,000
 60   14     14       0   0.79     +6.4%     +5.8%     +3.6%    +10.6% |   7522     +3.2%     0.69 |     +3.2%         [+0.7%, +6.5%]   1.8     established        mc 10,000
exclusions: spx: off-session 0, missing sessions 0, invalid 0 · baseline candidates without an entry 0
regime split at 20 sessions (own baseline beside it):
  Goldilocks      n=  1  n<10  (baseline n=539, median +1.1%)
  Overheating     n=  3  n<10  (baseline n=4457, median +1.5%)
  Stagflation     n= 10  hit 0.50  median -0.4%  (baseline n=2126, median +0.9%)
  Recession Risk  n=  0  n<10  (baseline n=440, median +0.9%)
  Unlabeled       n=  1  n<10  (baseline n=0, median n/a)  (outside the totals)
ten most recent events (newest first):
  event          z regime          entry      same    5d   10d   20d   60d
  2025-04-14       Overheating     2025-04-14 yes   -2.2%  +2.8%  +8.5% +14.7%
  2022-03-14       Stagflation     2022-03-14 yes   +6.7%  +9.2%  +5.6%  -1.4%
  2020-03-30       Stagflation     2020-03-30 yes   +1.4%  +8.0%  +8.6% +15.0%
  2018-12-07       Stagflation     2018-12-07 yes   -1.3%  -8.6%  -2.3%  +4.3%
  2016-01-11       Stagflation     2016-01-11 yes   -2.2%  -1.0%  -3.8%  +6.0%
  2015-08-28       Stagflation     2015-08-28 yes   -3.5%  -1.8%  -5.5%  +4.8%
  2011-08-12       Overheating     2011-08-12 yes   -4.8%  -0.2%  -1.4%  +6.7%
  2010-07-02       Goldilocks      2010-07-02 yes   +5.3%  +4.6%  +9.6% +11.5%
  2007-12-21       Stagflation     2007-12-21 yes   -1.1%  -6.6% -10.3% -11.0%
  2006-07-19       Overheating     2006-07-19 yes   +0.7%  +1.4%  +2.8%  +7.9%
verdict: The 90% interval on Δ excludes zero at 60 sessions (n = 14, 14 blocks). The effect is modest at 60 sessions (n = 14): median +6.4% against a baseline of +3.2%, Δ +3.2%. S&P 500 is not distinguishable from baseline at 5 sessions (n = 14, 14 blocks); 10 sessions (n = 14, 14 blocks); 20 sessions (n = 14, 14 blocks). Only Stagflation reaches n ≥ 10 at 20 sessions (n = 10, median -0.4%); no ranking across regimes. n<10: Goldilocks (1), Overheating (3), Recession Risk (0), Unlabeled (1, outside the totals). Sample since 1990 (data from 1990-01-02; events evaluable 1996-07-01 to 2026-09-21); 14 events; no cooldown, a cross cannot recur before the opposite cross; 14 independent blocks at 20 sessions (Monte Carlo, 10,000 draws).
```

### §6.2 An exact-enumeration horizon (R-18): 2s10s ≤ −2.5σ over 60 sessions → gold

```
2s10s curve 60-session move ≤ −2.5σ (252-session z) → Gold (COMEX front month)
calendar XNYS (exchange_calendars 4.13.2), 1976-06-01 to 2026-09-21: 12681 sessions
slug curve_2s10s-w60-z2.5-down-none-gold · as of 2026-09-21 · sample 2000-08-30 → 2026-09-21 (6417 evaluable sessions) · N=6 (shock sessions 179, after cooldown 18, condition held 6; unlabeled 0 outside the totals) · cooldown 60 sessions on the session calendar · seed 20260921 · hash 4caf52d86c5fe421
  h    n blocks incompl    hit    median      mean       p25       p75 | base n  base med base hit |         Δ                 90% CI  opp%            excl         resample
  5    6      6       0   0.50     -0.4%     +0.5%     -1.4%     +1.0% |   6373     +0.3%     0.55 |     -0.6%         [-1.8%, +2.7%]  35.5  too few blocks     exact 46,656
 10    6      6       0   0.67     +2.3%     +1.9%     +0.4%     +3.3% |   6368     +0.4%     0.56 |     +1.9%         [-0.6%, +3.7%]  12.4  too few blocks     exact 46,656
 20    6      6       0   0.67     +1.9%     +1.8%     +0.2%     +3.3% |   6360     +0.7%     0.57 |     +1.2%         [-1.1%, +3.3%]  23.5  too few blocks     exact 46,656
 60    6      6       0   0.33     -2.1%     -0.7%     -4.4%     -0.2% |   6320     +2.5%     0.63 |     -4.6%         [-7.4%, +1.7%]   5.9  too few blocks     exact 46,656
exclusions: curve_2s10s: off-session 14, missing sessions 122, invalid 0 · gold: off-session 6, missing sessions 19, invalid 0 · baseline candidates without an entry 1
regime split at 20 sessions (own baseline beside it):
  Goldilocks      n=  2  n<10  (baseline n=506, median +1.0%)
  Overheating     n=  3  n<10  (baseline n=3380, median +0.4%)
  Stagflation     n=  1  n<10  (baseline n=2043, median +1.1%)
  Recession Risk  n=  0  n<10  (baseline n=431, median +1.8%)
  Unlabeled       n=  0  n<10  (baseline n=0, median n/a)  (outside the totals)
ten most recent events (newest first):
  event          z regime          entry      same    5d   10d   20d   60d
  2026-03-19 -2.88 Overheating     2026-03-20 no    -1.8%  +2.4%  +5.4%  -4.9%
  2019-08-27 -3.10 Goldilocks      2019-08-28 no    -1.5%  -2.6%  -2.0%  -5.0%
  2015-01-05 -2.54 Goldilocks      2015-01-06 no    +1.2%  +5.9%  +3.6%  -1.5%
  2011-09-22 -2.62 Overheating     2011-09-23 no    -1.0%  -0.2%  -0.1%  -2.7%
  2008-05-12 -2.80 Stagflation     2008-05-13 no    +5.7%  +3.6%  +1.3%  +0.3%
  2002-03-08 -2.65 Overheating     2002-03-11 no    +0.3%  +2.1%  +2.6%  +9.8%
verdict: At 5 sessions (n = 6, 6 blocks) the 90% interval on Δ is [-1.8%, +2.7%]; too few independent blocks to judge exclusion. At 10 sessions (n = 6, 6 blocks) the 90% interval on Δ is [-0.6%, +3.7%]; too few independent blocks to judge exclusion. At 20 sessions (n = 6, 6 blocks) the 90% interval on Δ is [-1.1%, +3.3%]; too few independent blocks to judge exclusion. At 60 sessions (n = 6, 6 blocks) the 90% interval on Δ is [-7.4%, +1.7%]; too few independent blocks to judge exclusion. No regime reaches n = 10 at 20 sessions, so the split is not informative. n<10: Goldilocks (2), Overheating (3), Stagflation (1), Recession Risk (0). Sample since 2000 (data from 2000-08-30; events evaluable 2000-08-30 to 2026-09-21); 6 events after a 60-session cooldown (179 shock sessions before it); 6 independent blocks at 20 sessions (exact enumeration, 46,656 draws).
warnings: Gold (COMEX front month): history from 2000-08-30 (after 1990) · off-session observations dropped: curve_2s10s 14, gold 6. · calendar sessions without a value: curve_2s10s 122, gold 19.
```

Six events in six blocks: every one of the 6^6 = 46,656 block draws is enumerated, the interval and the opposite-sign share are printed, and the verdict declines to judge exclusion because fewer than ten blocks are independent. The scratch test `test_scratch_exact_enumeration_interval_matches_an_independent_enumeration` reproduces these intervals with `itertools.product` from the stored levels.

## §7 Commands

Populate or refresh the scratch copy (owner-run; the second reads `EODHD_API_TOKEN` from `.env` itself, the third `FRED_API_KEY`; tier 1 makes no EODHD calls):

```bash
cd /Users/maxkomen/Projects/Macro/macro-regime-radar
sqlite3 data/macro_radar.db ".backup data/desk_scratch.db"          # only when starting from nothing
EODHD_PROBE_ON_START=0 .venv/bin/python -m src.market_data.asset_history --db data/desk_scratch.db   # ^GSPC, ^RUT, GC=F … (24 EODHD calls with a token)
.venv/bin/python -m src.market_data.desk_history --db data/desk_scratch.db --tier 1                   # 5 FRED calls, 0 EODHD
```

Re-running tier 1 now merges (FRED rows are upserted): counts stay as pasted except that `BAMLH0A0HYM2` gains nothing (FRED serves nothing earlier) and the `desk:BAMLH0A0HYM2` watermark records `ok` against the declared 2023-09-22.

Run a study, run the tests:

```bash
EODHD_API_TOKEN="" .venv/bin/python scripts/desk_event_study.py --db data/desk_scratch.db --study gold-2sigma-spx-weak
EODHD_API_TOKEN="" .venv/bin/python scripts/desk_event_study.py --db data/desk_scratch.db --shock vix --w 5 --z 2 --sign + --target spx
EODHD_API_TOKEN="" EODHD_PROBE_ON_START=0 .venv/bin/python -m pytest tests/test_event_study.py tests/test_desk_history.py tests/test_desk_api.py -q
```

(`EODHD_API_TOKEN=""` is habit, not a guard: see §2. Nothing above enters the app's lifecycle.)

Push, once approved (never before `PUSH OK desk/event-study`; commit first):

```bash
git push -u origin desk/event-study
```

## §8 Verification

### §8.1 Tests (2026-09-21, `.venv/bin/python`, `EODHD_API_TOKEN=""`, no lifespan, no network)

| Suite | Result |
|---|---|
| Full suite: `pytest tests --ignore=tests/test_streamlit_backports.py` | **755 passed, 0 failed**, 4 min 04 s, rerun after the final R-18 fix (639 before this branch) |
| `tests/test_event_study.py` (69: synthetic rules, one pin per R-id, the owner's zero-is-adverse regression, §8 scratch checks incl. the exact-enumeration interval) | passed |
| `tests/test_desk_history.py` (15: registry incl. timing rules, writer, workflow pin, validator, freshness verdict) | passed |
| `tests/test_desk_api.py` (31: assets item, preset lookup, seed, lossless cache key, free-form compute + cache, 202 computing, 429 busy, generation lease, 422 parse failures, 503, gate) | passed, 124 s (the worker builds a full generation from the scratch copy) |

The §8 deliverables:

1. **Independent recomputation** — `test_scratch_preset_matches_an_independent_pandas_recomputation`: a separate pandas path (rolling z, cooldown loop, 50-day mean through the event date, `searchsorted` entry, log forward move) reproduces the preset's N = 19, its 20-day hit rate and median, and the baseline's N and median, to floating-point equality.
2. **Printout** — §6 above, from `scripts/desk_event_study.py` (read-only), ten most recent events with dates, z, lagged regime, entry date and the four forward moves.
3. **Look-ahead shift** — `test_scratch_look_ahead_shift_changes_the_result`: a backup copy of the scratch DB with every `^GSPC` close moved one session later keeps the same event dates and the same shock, changes `inputs_hash`, and changes the 20-day median or hit rate and the individual forward moves. The window is aligned to the target's own dates.
4. **Declared start** — `test_scratch_every_stored_series_reaches_its_declared_start` (Max's request): every stored series' first date is on or before its registry `history_from`.
5. **Wording** — gold says "Sample since 2000" and never "1990"; both crosses say "Sample since 1990"; no verdict in 24 synthetic studies or the three presets contains predict / will / proves / model / guarantee / "since data start".

### §8.2 After the reviews (rounds 1, 2 and 3)

The engine was rewritten around the fourteen findings (§9). Against the scratch copy the preset moved from 19 to 18 events: one event's session is no longer evaluable under the shared mask, and every entry is now the next session. The baseline is the 6,213 evaluable sessions with a complete 20-session window rather than every S&P session, so its median is unchanged at +1.3% while Δ at 20 sessions is +1.8%. The independent recomputation test (`test_scratch_preset_matches_an_independent_pandas_recomputation`) was rewritten for the reviewed rules and matches the engine's N, hit rate, medians and baseline. Both crosses lose their pre-1996-07 events to the Unlabeled row (2 golden, 1 death, outside the totals) because the lagged regime label is part of evaluability; "Sample since 1990" still holds because the data start is 1990-01-02, and the verdict states the evaluable span.

Round 2 moved the calendar to `exchange_calendars` XNYS (9,247 sessions 1990 → 2026-09-21, the same count the stored S&P has, so no S&P session is missing) and gave the baseline the same entry delay as the events: the preset's 20-session baseline is now 6,212 windows entered one session after each evaluable candidate (median +1.3%, unchanged to the tenth), Δ +1.8%, the interval still including zero. The S&P studies' block counts are unchanged; every horizon of the three presets has more than seven blocks, so they resample by Monte Carlo, while §6.2 shows an exactly enumerated study.

Round 3 raised the Monte Carlo draws to 10,000 and added the opposite-sign test to the exclusion verdict: on this sample the golden cross at 20 sessions (1.7% adverse) and the death cross at 60 (1.8%) stay "established", every preset horizon whose interval includes zero reads "included", and no horizon fell into "exclusion not established". The final R-18 fix (zero is adverse; outward-rounded bounds) changed no printout: no resampled median on this sample equals zero exactly. The cross detector's side reset changed no event on the S&P (its stored series has no gap), and the extended calendar changed no number.

### §8.3 Independent verifier, round 0 (before the review; did not write the code)

A fresh general-purpose agent, read-only, scratch DB only, with its own scripts (`recompute_preset.py`, `hand_checks.py`, `lookahead_shift.py` under the job's tmp dir). Its table, verbatim in substance:

| # | Rule | Verdict | Evidence (the verifier's own numbers) |
|---|---|---|---|
| 1 | No look-ahead; preset recomputation | PASS | Own numpy/sqlite path matches the engine to <1e-12: sample 2001-10-03 → 2026-09-21, raw 185 / shocks 34 / **N = 19**; h20 hit 0.684211, median +0.02440451, mean +0.02099653, baseline median +0.01300746 (N 6261); all ten recent events identical. An exclusive z-window would give 192 raw hits, not 185, so the inclusive window is what runs. |
| 2 | Cooldown, N after dedupe | PASS | Hand synthetic (hits 1,2,3,4,5,7,9,11; w = 3) → kept 1, 5, 9, raw 8; i+w blocked, i+w+1 free. |
| 3 | Baseline = same exclusions and units | PASS | Both paths go through `forward_moves` over the same window; baseline N/median/hit matched at every horizon; bp target checked (S&P → 10Y moves in bp). |
| 4 | Provenance keys | PASS | All ten studies carry non-null `as_of, sample_start, sample_end, n_events, cooldown, seed, inputs_hash`. |
| 5 | Regime read as stored, K−2 lag, Unlabeled counted | PASS | Engine imports only `dbpath` and the registry; 2023-03-23 → row 2023-01-01 Stagflation while the same-month row is Overheating, so the lag is real; VIX study: Unlabeled N = 17 and the regime Ns sum to 136 = `n_events`. |
| 6 | Entry rule | PASS | VIX shocks enter the next S&P session (2026-06-05 → 06-08); gold preset entries equal the event date; OAS entries strictly after. |
| 7 | Verdict vocabulary | PASS | Ten studies; no banned word; gold "Sample since 2000", crosses "Sample since 1990". |
| 8 | Registry and writer | PASS | Units declared, bp series scaled ×100, HY OAS declared start = stored MIN(date), `merge=True` upserts (3 rows + 2 overlapping → 4), `merge=False` replaces. |
| 9 | Look-ahead shift | PASS | Every `^GSPC` close moved one session: event dates and shock count unchanged (34 → 34), `inputs_hash` differs, 10/10 recent 20-day moves changed, h5 median +0.0091 → −0.0024. |
| 10 | Other | see defects | Only SELECTs through `connect_ro`; nothing in `api/` or `src/desk/` imports the writer, yfinance or an HTTP client; the assets endpoint is not under the expensive gate (correct). |

**Defects the verifier found, and what changed (all fixed, all pinned by a new test, the full suite rerun):**

1. *Same-close entry could precede the shock's information time.* The engine derived "next session" from the inputs' `known_by` only and never consulted the target's own close time, so an S&P shock decided at 16:00 entered the 10Y at its 15:30 read the same day. Fix: the registry now declares `fixed_at` and `known_at` per series (ET minutes), and the entry is the event date's close only when `target.fixed_at ≥ max(input.known_at)`. Pinned by `test_entry_waits_for_the_targets_fix_time` (10Y → S&P same close; S&P → 10Y, gold → S&P and a VIX condition into the S&P all next session; 10Y → gold and S&P → VIX same close). The verifier's preset numbers in the table above were computed with same-close entry for gold; after Max's decision to declare gold at 17:00 ET the preset enters the next session, its N is still 19 and §6 shows the current numbers. The independent recomputation test was updated to next-session entry for gold and passes.
2. *`regime=R` filtered the events but not the baseline.* The filter now applies the same labelled-month clamp as `cond=regime`; `test_regime_condition_and_filter_share_the_lag_rule` asserts equal `sample_start`, `sample_end` and baseline N for both forms, and the warning names it.
3. *A non-default `seed` on a preset was ignored.* A preset is looked up only at the default seed; any other seed computes on request (the cache key already carried the seed). Pinned by `test_a_preset_with_another_seed_computes_with_that_seed`: seed 7 reports seed 7, same N and median, computed once.

The verifier also noted that spec §5's "forward window starts the next session" and the implementation's "entry at the event-date close" are the same rule read two ways (the return period begins the session after the entry close); the spec file is unchanged, the provenance says which close is used. It flagged `T10Y2Y` stored through 2026-09-21 while `DGS10`/`DGS2` stop at 09-18 as a FRED publication quirk, not an engine fault (the 09-18 value 0.25 = 5.01 − 4.76 checks out).



## §9 The independent review (round 1, 14 findings, all accepted) and the test that pins each

| R-id | Finding and policy | Fix | Pinned by |
|---|---|---|---|
| R-01 | FRED daily Treasury and OAS values are known at the next session open, never same day | registry `known = NEXT_OPEN` for DGS10, DGS2, T10Y2Y, BAMLH0A0HYM2 | `test_desk_history.py::test_registry_tier1_is_the_agreed_list_and_the_vocabularies_hold`; `test_event_study.py::test_timing_rules_resolve_against_the_session_and_early_closes`; `test_scratch_assets_gaps_and_timing` |
| R-02 | Compare input availability and target fixing per date with `api.calendar.session_bounds()` | `event_study.when` / `same_session_entry` resolve `(anchor, offset)` rules per date; early closes handled | `test_timing_rules_resolve_against_the_session_and_early_closes` (2026-11-27, 13:00 close) |
| R-03 | Gold as a target: defer entry to the next session; state it in provenance | registry `defer_as_target=True` (gold, copper); `entry_rule` says "ambiguous" | `test_timing_rules_…`, `test_entry_follows_the_timing_rules_in_a_study` |
| R-04 | NYSE master calendar; align every series; drop off-session observations; incomplete windows excluded and counted | `align`, `move`, `forward_moves`, `Z_MIN_PRESENT`; counts in provenance (interpretation in §4) | `test_align_drops_off_session_observations_inside_the_range_only`, `test_move_reads_its_two_endpoints_only`, `test_zscore_is_trailing_inclusive_and_tolerates_a_few_missing_moves`, `test_forward_moves_need_both_endpoints_and_follow_the_unit`, `test_run_reports_off_session_drops_and_incomplete_windows`, `test_scratch_assets_gaps_and_timing` |
| R-05 | One per-date evaluability mask for events and baseline | `_run`: `evaluable = z ∧ cond ∧ target ∧ label`; Unlabeled row outside the totals | `test_one_evaluability_mask_for_events_and_baseline`, `test_regime_condition_and_filter_share_the_lag_rule_and_the_baseline`, `test_scratch_preset_matches_an_independent_pandas_recomputation` |
| R-06 | Cluster bootstrap over overlapping-window blocks; report blocks; use in the verdict | `cluster_blocks`, `horizon_stats`, `n_blocks_by_h`, verdict "(n = …, k blocks)" | `test_cluster_blocks_group_overlapping_forward_windows`, `test_horizon_stats_bootstraps_blocks_and_reports_them`, `test_verdict_rules_for_intervals_n_and_regimes` |
| R-07 | Cache key = lossless serialized validated parameters; lossless slugs | `cache_key`, `repr` floats in slugs, `api/desk.py` key | `test_slugs_round_trip_losslessly_and_presets_keep_their_names`, `test_cache_key_is_the_validated_parameters`, `test_desk_api.py::test_cache_key_is_the_validated_parameters_not_the_spelling` |
| R-08 | Print the horizon's own n beside its statistics | CLI columns n / blocks / incompl; verdict cites n per horizon | `test_verdict_vocabulary_over_many_queries` (every cited horizon's n equals the row's), `test_verdict_rules_for_intervals_n_and_regimes` |
| R-09 | `inputs_hash` covers generation id, content hashes of every input and the regime table, all effective parameters | `content_hash`, `_inputs_hash`, `generation` in provenance | `test_inputs_hash_covers_content_generation_and_parameters` |
| R-10 | Strict crossings; equality never fires; resolution through equality fires on the first strictly-beyond session | `cross_positions` state machine | `test_crosses_are_strict_and_resolve_through_equality` |
| R-11 | A horizon with no completed observations gets an insufficient-data statement; the interval sentence covers only horizons with one | `horizon_stats` note; `verdict_sentences` | `test_verdict_rules_for_intervals_n_and_regimes`, `test_horizon_stats_bootstraps_blocks_and_reports_them`, `test_insufficient_data_at_a_horizon_in_a_study` |
| R-12 | Regime ranking needs two regimes with n ≥ 10; otherwise describe the sole eligible regime without claiming concentration | `verdict_sentences` | `test_verdict_rules_for_intervals_n_and_regimes` |
| R-13 | Bound outstanding computations at CACHE_MAX; a full queue returns 429 with Retry-After | `api/desk.py` `QueueFull` → 429 `busy` | `test_desk_api.py::test_a_full_queue_answers_429_with_retry_after` |
| R-14 | Reject non-finite thresholds and invalid seeds; numeric parse failures are StudyError → 422 | `_finite`, `_integer` in `validate`; the route takes strings | `test_validate_rejects` (R-14 cases), `test_validate_normalises_and_coerces_strings`, `test_desk_api.py::test_bad_queries_are_422_with_a_reason` |

Two judgments taken while fixing, both reversible in one line: the endpoint reading of "required session" (§4), and 5 blocks for an interval.

## §9.1 The independent review (round 2, 10 findings, all accepted) and the test that pins each

| R-id | Finding and policy | Fix | Pinned by |
|---|---|---|---|
| R-05 (first) | Baseline candidates take the same `entries_for` delay and completeness rules as events; regime labels from the signal date | `_run`: `base_entry, _, base_has = entries_for(base_pos)`, `baseline_no_entry`; the independent test's baseline path uses p+1 | `test_baseline_candidates_take_the_same_entry_delay`, `test_scratch_preset_matches_an_independent_pandas_recomputation` (baseline at p+1 … p+21) |
| R-04 + R-02 | `exchange_calendars` XNYS as the session calendar for the whole history; S&P gaps are NaN exclusions; dates outside the calendar rejected; version pinned | `session_calendar`, `sessions_between`, `clock_for` (raises), `align` returns `missing_sessions`; `requirements-api.txt` pin 4.13.2 | `test_calendar_is_xnys_and_rejects_dates_outside_it` (9/11 closures, Thanksgiving rejected, 2001-11-23 early close), `test_missing_spx_sessions_are_exclusions_not_calendar_holes`, `test_timing_rules_resolve_against_the_session_and_early_closes` |
| R-17 | Finite, positive prices before any log; exclusions with a reason, identical for events and baseline | `validate_values`; `exclusions[series].invalid_values / invalid_reason` | `test_invalid_prices_are_exclusions_with_a_reason_for_events_and_baseline` |
| R-18 | Exact enumeration when blocks ≤ 7, Monte Carlo otherwise; exclusion claims need 10 blocks; 5–9 print the interval with the sentence; blocks disclosed | `block_resample_medians`, `_weighted_medians`, `horizon_stats`, `verdict_sentences` | `test_exact_enumeration_up_to_seven_blocks_and_the_exclusion_floor` (6^6 and 7^7 enumerated, 8 → Monte Carlo, 10 → judged; weighted median equals numpy's), `test_verdict_rules_for_intervals_n_and_regimes`, `test_scratch_exact_enumeration_interval_matches_an_independent_enumeration` (2s10s → gold, six blocks, 46,656 draws via `itertools.product`) |
| R-09 | The effective n_boot and the resampling method in the hash | `_inputs_hash` takes the horizons' `resampling`/`n_draws` | `test_inputs_hash_covers_content_generation_and_parameters` (n_boot=500 changes the hash) |
| R-15 | Clamp `cond_value` to ±1e6, serialize with `repr`, parser accepts what the serializer emits; property test | `validate` clamps (a warning when it did), `_num_slug`, `_NUM` grammar | `test_cond_value_is_clamped_and_slugs_round_trip_over_random_queries` (400 random valid queries, seeded) |
| R-16 | A job leases its generation and computes only against it; an expired generation cancels the job and yields a fresh 202 | `api/desk.py` `_compute` opens the copy itself (`GenerationExpired`), `study_result` resubmits under the current generation; `event_study.run_on(conn, …)` | `test_desk_api.py::test_a_job_whose_generation_expired_is_cancelled_and_the_client_gets_a_fresh_202` |
| R-19 | The zero-event sentence comes from the recorded stages | `stages` in provenance, `zero_event_sentence` | `test_zero_event_sentence_names_the_stage_that_emptied_the_set` |
| R-20 | Ties and contrasts under 0.5 pp between the top two eligible regimes get no strongest/weakest claim | `MIN_REGIME_CONTRAST` (0.5 pp; 5 bp for bp targets, a judgment), `verdict_sentences` | `test_verdict_rules_for_intervals_n_and_regimes` (tie, clear contrast, bp) |

## §9.2 The independent review (round 3): R-18 revised, R-21, R-22 fixed; R-23, R-24 deferred

| R-id | Finding and policy | Fix | Pinned by |
|---|---|---|---|
| R-18 (round 3) | Exact enumeration ≤ 7 blocks; 10,000 draws above; a zero-exclusion claim needs < 3% adverse resampled medians on top of the 10-block minimum; interval and test disagreeing → "exclusion not established"; share reported per horizon | `N_BOOT = 10000`, `OPPOSITE_SIGN_MAX = 0.03`, `judge_exclusion`, `exclusion` / `opposite_sign_share` per horizon and in provenance and the hash; verdict sentence | `test_exclusion_needs_the_interval_and_the_opposite_sign_test` (0%, 2%, 4%, 10% adverse; negative point estimate), `test_verdict_rules_for_intervals_n_and_regimes` (the "not established" sentence), `test_horizon_stats_bootstraps_blocks_and_reports_them`, `test_exact_enumeration_up_to_seven_blocks_and_the_exclusion_floor` |
| R-18 (final) | The guard treats zero as adverse: count resampled deltas ≥ 0 when the point estimate is negative and ≤ 0 when it is positive | `judge_exclusion`: adverse share with zero included; the interval "excludes zero" when it lies on the point estimate's side, boundary included; both bounds are resampled values rounded outward (`lower` / `higher`), never interpolated | `test_regression_zero_is_adverse_in_the_exclusion_guard` (the owner's repro: eight returns of −2% and three zeros in eleven blocks, zero baseline, h = 5, seed 20260921 → interval [−0.02, 0], adverse share 5.0%, "exclusion not established"), `test_exclusion_needs_the_interval_and_the_opposite_sign_test` (exact zeros count; a zero point estimate is wholly adverse) |
| R-21 | The cross detector resets its side state on an unevaluable session and admits an event only when the immediately preceding session was evaluable and on the other side | `cross_positions` | `test_crosses_are_strict_and_resolve_through_equality` (gap before the cross, gap inside the 200-day window, gap 260 sessions earlier) |
| R-22 | The calendar extends one exchange session past the last input date; the study index stays bounded by the inputs | `session_calendar` builds to the end of the month after `end`; `clock_for`'s guard stays | `test_calendar_extends_one_session_past_the_last_input` (2026-12-31 → next open 2027-01-04; a year-end synthetic study runs) |

## §10 Follow-ups (not done, by design)

**Deferred by decision (third review): R-23 and R-24.** Not on this branch; their text is in the reviewer's report and they are listed here so the deferral is on record.


- Tier 2 (`DCOILWTICO`, `^NDX`, `DX-Y.NYB` 1d, `JPY=X` 1d): registered as `planned`; `desk_history --tier 2` fetches them (3 EODHD/Yahoo calls + 1 FRED); the workflow step stays at `--tier 1` until told.
- Tier 3 (copper, nine sector ETFs): registered as `deferred`, listed by the assets endpoint, rejected by `validate` with a reason.
- A `RELAY_DISABLED=1` switch for `api/stream.py`, if the launch worktree needs the relay off while a `.env` exists.
- A `desk_series` row in the Data Pipeline inventory (`/api/desk/pipeline/inventory` is the frame branch's endpoint).
- The regime split rarely reaches N=10 on the gold preset (19 events over four regimes); that is the data, not the engine.


## Appendix · §0 Investigation (2026-09-21, before any code; the decisions in §1 answer it)

### 0.1 The regime classifier

- **Where:** `src/regime.py`. Run only by the `full` refresh: `main.py:78` → `regime.run(series_dict)` → `run_regime_classification` (`src/regime.py:135`) → `save_regimes` (`src/regime.py:190`, upsert on `regimes.date`).
- **Inputs:** two monthly FRED level series from `SERIES` in `src/config.py:20`: growth = `INDPRO`, inflation = `CPIAUCSL`. Month-stamped by `_to_monthly` (`src/utils/fred_client.py:84`).
- **How it decides:** `compute_trends` (`src/regime.py:17`) fits a rolling OLS slope over `ROLLING_WINDOW = 3` months (`src/config.py:30`) on each level; `classify_regime` (`src/regime.py:43`) maps the sign pair through the `REGIMES` table (`src/regime.py:8`):
  `(growth>0, infl>0)` → `(T,F)` Goldilocks · `(T,T)` Overheating · `(F,T)` Stagflation · `(F,F)` Recession Risk.
  **Four states. It is a rule, not a trained model**: nothing is fit against a target. `confidence` and the four `prob_*` columns are decorations computed afterwards from expanding z-scores of the two slopes through a softmax at T = 0.7 (`compute_regime_probabilities`, `src/regime.py:64`); by construction the dominant probability is always the label's quadrant.
- **Stored output:** table `regimes` (`date TEXT UNIQUE`, `label`, `confidence`, `growth_trend`, `inflation_trend`, `prob_goldilocks/overheating/stagflation/recession`, `computed_at`). Local snapshot (Sep 15): 362 rows, one per month, every `date` is the 1st, `1996-05-01 → 2026-07-01`. Labels: Overheating 212 · Stagflation 102 · Goldilocks 27 · Recession Risk 21.
- **Label for an arbitrary date:** no daily function exists. The API read is `api/db.py:380 regime_history(start, end, limit)` (`SELECT … FROM regimes ORDER BY date`). The join convention in use is `regimes["regime"].reindex(dates, method="ffill")` (`src/analytics/allocation.py:428` and seven more places in that file): a date takes the newest month-stamped row on or before it. `src/analytics/backtest.py:159` uses only regime *entry* dates.
- **Two truth caveats the engine must state:**
  1. *Vintage.* `save_regimes` rewrites every row on every full run (all 362 rows share `computed_at = 2026-09-15T04:18:25`). A stored historical label reflects today's FRED revisions of INDPRO/CPI, not what was knowable then.
  2. *Publication lag.* The row stamped `2026-07-01` needs July INDPRO (released mid-August) and July CPI (released ~Aug 12). An `ffill` on the stamp date labels July sessions with information that arrived six weeks later. Nothing in the codebase lags regime labels; only the recession model lags its inputs.

### 0.2 The recession probability

- **Own computation, not a sourced FRED series.** `src/analytics/recession.py:train_recession_model` fits `sklearn LogisticRegression(C=1.0, class_weight="balanced", random_state=42)` on five monthly features shifted three months (`features_df[FEATURE_NAMES].shift(3)`) against `USREC` from `raw_series` (hard-coded NBER ranges as fallback). Features (`FEATURE_NAMES`): `yield_curve` = DGS10−DGS2, `unemployment` = UNRATE, `hy_spread` = BAMLH0A0HYM2 × 100, `indpro_yoy`, `lei_proxy` = T10YIE−T5YIE (the USSLIND-stale fallback, always taken). This one **is** trained, so "model" is correct for it. In the API it is rebuilt per generation by the worker (`recession_model`, `recession` items in `api/analytics_cache.ITEMS`) and served as `probability_source: "recession_model"`.
- **A different number with a similar name:** `regimes.prob_recession` is the classifier's softmax quadrant weight from 0.1, not a recession probability. `get_recession_metrics` reads it only as `macro_recession_signal` for the divergence score. The event study touches neither.

### 0.3 §3 series: what exists, what needs an entry

**Structural finding:** `raw_series` holds one row per month for every FRED series, daily ones included (`_to_monthly`; DGS10 = 367 rows over 30 years; CLAUDE.md B6: never change it). **No FRED daily history exists anywhere in the pipeline.** Every FRED-sourced asset in §3 needs a new daily store, not a config entry. `fred_client._download` already returns the raw daily observations un-collapsed, so the fetch is trivial; the storage is the new part.

Market side: `market_daily` (`config/assets.yml`, yfinance, 23 ETFs) has SPY from 1993-01-29 (7,901 rows); every other symbol only from 2024-02-27 or 2026-02-18 (XLK/XLE/XLF/XLI: 2026-02-18). `asset_prices` (fix/prelaunch-1; written by `src/market_data/asset_history.py` in the full refresh; `(symbol, interval, date, close, provider)`, `interval IN ('1d','1mo')`) holds, per `_build_series`: daily `^GSPC`, `^RUT`, `GC=F` from 1990-01-01 (GC=F actually starts 2000-08-30 on Yahoo), the ten allocation ETFs from inception, and `DX-Y.NYB` / `JPY=X` at **`1mo` only**. No local DB copy has the table (local snapshot predates it; the `gh release view` call was denied in this session), so this row is from code.

| §3 asset | ID | In the pipeline today | Needs |
|---|---|---|---|
| S&P 500 | `^GSPC` | `asset_prices` 1d from 1990-01-01 (full-refresh DBs only) | nothing for 1990+; longer history only if wanted for §6 |
| Nasdaq 100 | `^NDX` | absent | new daily series (Yahoo from 1985; EODHD `NDX.INDX`) |
| Russell 2000 | `^RUT` | `asset_prices` 1d from 1990-01-01 | nothing |
| Gold PM fix | FRED `GOLDPMGBD228NLBM` | absent | FRED daily store; 1968 |
| WTI | FRED `DCOILWTICO` | absent | FRED daily store; 1986 |
| Copper | `HG=F` | absent | new daily series; Yahoo from 2000-08-30 (warn) |
| 10Y | FRED `DGS10` | `raw_series` monthly only | FRED daily store; 1962 |
| 2Y | FRED `DGS2` | `raw_series` monthly only | FRED daily store; 1976 |
| 2s10s | FRED `T10Y2Y` | absent | FRED daily store (fetch FRED's own series so the number matches FRED); 1976 |
| VIX | `^VIX` | absent (`VIXCLS` monthly in `raw_series`) | daily store; FRED `VIXCLS` (same CBOE close, 1990) or Yahoo `^VIX` — decision below |
| DXY | `DX-Y.NYB` | `asset_prices` `1mo` only | add 1d (EODHD `DXY.INDX`; Yahoo from 1971) |
| USDJPY | `JPY=X` | `asset_prices` `1mo` only | add 1d (EODHD `USDJPY.FOREX`; Yahoo from 1996-10 → warn likely) |
| HY OAS | FRED `BAMLH0A0HYM2` | `raw_series` monthly only | FRED daily store; 1996-12-31 (warn) |
| Sector ETFs XLK…XLU | 9 tickers | XLK/XLE/XLF/XLI in `market_daily` from 2026-02-18; XLB/XLP/XLV/XLY/XLU absent | new daily series ×9 from 1998-12-22 (warn) |

Targets: S&P 500 ✓ (`asset_prices`), Nasdaq 100 ✗, Gold ✗, 10Y ✗, DXY ✗ (1d), HY OAS ✗, VIX ✗. **Two of the twenty-one series exist at daily resolution, and only on a full-refreshed database.**

Shock units (declared, per §2): equities, gold, WTI, copper, DXY, USDJPY, sector ETFs → log return; DGS10, DGS2, T10Y2Y, HY OAS → change in bp (FRED serves yields and OAS in percent → × 100); VIX → log change.

### 0.4 How forward-looking data is prevented today

1. **Daily bars land only after the session completes.** `src/market_data/session.py:bar_is_complete` (real NYSE close incl. 13:00 half-days, + 20 min); `asset_history.refresh` keeps rows `<= cal.session_state(now)["last_completed_session"]`. A stored close is never a partial print. The engine inherits this by reading stored tables only.
2. **FRED as-of lives in `source_watermarks`** (`src/watermarks.py`; read by `api/freshness.py`) because the month-stamped rows hide the observation date. A daily store makes the row date the observation date; it still records a watermark for the freshness contract.
3. **Forward-return convention** — `src/analytics/backtest.py:74 compute_forward_return`: entry = `series.asof(entry_date)` (close on the event date), `future = series[series.index > entry_date]`, exit = `future.iloc[h-1]`, `None` (excluded, not truncated) when fewer than `h` future sessions exist. This is exactly §2. The engine reuses the positional convention: integer session offsets on the target's own index, never calendar days.
4. **The only explicit publication-lag handling** is the recession model's `shift(3)` and `valid_prob = prob_series[index <= today]` (B7). Regime labels have none (0.1).
5. **One file per response.** Every analytics module reads through `src/analytics/dbpath.connect_ro`; in the API `PinGeneration` pins a request to the generation published when it arrived. The engine's `as_of` will be the served generation's per-series max date and `inputs_hash` a digest over (series ids, their max dates and row counts, parameters, seed).
6. **Engine windows (to implement):** z-score = trailing 252 sessions of the shock-unit series ending on the event date inclusive; MAs likewise; co-conditions read the last value on or before the event date on the condition asset's own calendar; the forward window starts the next target session.

### Decisions needed from Max before code

1. **Regime alignment lag.** Session `d` in month K takes the regime row stamped K − `lag` months. Recommend `lag = 2` (row K−2 is fully published in month K; strict). `lag = 0` is allocation's `ffill` (six weeks of look-ahead); `lag = 1` is right for roughly half of each month. Reported as `regime_lag_months` in provenance; used for both the split and the `regime == R` co-condition.
2. **Storage.** Recommend a new table `desk_series (series_id, date, value, provider)` + watermark `desk_series`, written by a new full-refresh step `python -m src.market_data.desk_history` (FRED daily via `fred_client._download`; market series via `market.daily_history(..., allow_yahoo=True)`, the same EODHD-first path `asset_history.py` uses), added to `validate_db`'s `full` expectations. Alternative: reuse `asset_prices` with `provider='fred'` rows — but `api/db.py:696` and `scripts/validate_db.py:206` take the allocation as-of as MIN over every 1d symbol, and T+1 FRED series (gold fix, OAS) would push allocation outside SLA every morning.
3. **VIX source.** Recommend FRED `VIXCLS` daily (same CBOE close as `^VIX`, same source as the rest of the store, no Yahoo); keep `^VIX` as the display id.
4. **Request-path compute.** Presets (the gold study, the 50/200 cross) and the assets list become worker items. A free-form query cannot be precomputed, so `GET /api/desk/event-study` computes on request behind the existing `expensive` semaphore (`api/security.py` `EXPENSIVE_PATHS`, currently POST-only). This is a stated deviation from "never compute on the request path"; bootstrap is 2,000 × 4 horizons of numpy, well under a second.
5. **Cross-calendar entry.** Gold fixes on London days, FRED yields on bond days, SPX on NYSE days. Recommend: entry = the target's close on the event date if the target traded that day, else its next session's close (the first close at which the shock is known and actionable); `h` counts target sessions from there. Stated in provenance.
6. **`^GSPC` depth for §6.** `asset_prices` starts 1990. "Since data start" for the cross study can mean 1990 (what exists) or a longer `^GSPC` pull into the desk store (Yahoo to 1927, EODHD to the 1950s).

Local verification note: `.env` carries `FRED_API_KEY` and `EODHD_API_TOKEN`, so a scratch copy of the DB can be populated locally for the §8 printout; the real database is never written.
