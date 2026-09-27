# Where the Desk fixtures' values come from

The fixtures answer the Desk's `/api/desk/*` routes in the tests, the compare
shots and `DESK_FIXTURES=1` dev servers. Their shapes are DESK_FRAME3_SPEC
§12 as folded. Their values follow one rule (fold-and-alignment item 12): a
value `docs/desk/FRAME3_DATA_AUDIT.md` (branch `desk/frame-3-docs`, commit
`cd465f8`) marks **COMPUTABLE** is the real one. Two more kinds of value
are real without that mark, and the table names them: the event-study
engine's own output, and a value derived by a rule the spec names from
stored data (the freshness policy, the bond calendar). Every other value
is **illustrative** and is listed as such below.

## The fixture world

One snapshot, the audit's store (§1): refreshed 2026-09-24 05:07 UTC, daily
data through Sep 23 (S&P, gold, HY OAS, T10Y2Y), FRED's VIX and Treasury
yields through Sep 22 (since desk/fill-compute the Desk's VIX is ^VIX in
`asset_prices`: the fixtures that read it were regenerated from the API on a
copy of the audit's store with ^VIX added the way the full refresh adds it,
`api/providers/market.daily_history` (Yahoo, fetched 2026-09-27), sessions
through Sep 23 only: 14.21 on Sep 22, as FRED had it, and 15.18 on Sep 23), no ^GSPC row for Sep 22, regimes through 2026-08 with
2025-10 absent. Every envelope carries `as_of` 2026-09-24 (the New York
date the generation was staged, §12.0), `generation_id`
`gen-fixture-2026-09-24` and `engine_version`
`cd465f8d48323dbbfaa81b9246cf41a9d9d2b2f0`, the git sha of the audit's
commit, whose engine produced the numbers (§12.0, S-21; `index.ts`
`FIXTURE_META`). The comparison session is Sep 23, the previous one Sep 22.

**Engine values** are the event-study engine's own output
(`src/desk/event_study.py` at `cd465f8`), run read-only on a copy of the
audit's store with the default seed, for the 13 catalog studies. Where the
recomputed `inputs_hash` differs from the audit's only by the copy's file
identity, the fixture carries the audit's hash.

**The firing state** (`firing_now`, `firing_day`, `evaluated_on`, `stale`)
is the engine's condition evaluated on the latest sessions of that run:
nothing fires; a row the engine cannot evaluate on Sep 23 is stale at its
last evaluable session. Every stale row is stale at Sep 21 for the same
reason: the S&P has no Sep 22 close, so its 50- and 200-day rows, gold's
condition and every study with the S&P as its target cannot be read on Sep
22 (VIX for Sep 22 is stored).

## Per fixture

| Fixture | Real (audit COMPUTABLE, or the engine) | Illustrative |
|---|---|---|
| `study.json` (gold preset) | Every count, share, median, baseline, interval, adverse share, method and draws per horizon; worst and best with their dates; `by_regime` n 2 / 6 / 9 / 1, all served null (§2.3); the last five events; `data_start` 2000-08-30, `sample_start` 2001-09-19, `sample_end` 2026-09-21; `inputs_hash` 879a8a1f76831fad; `provenance` (the engine's entry rule, cooldown 20, seed, series starts); `series[]` labels (the registry's), which also name the target (§12.2 serves no separate target name) | `headline`, `why`, `client` and `empty_state` are §12.2's templates filled with those values, numbers printed by the engine's `fmt_move`, a negative's hyphen then U+2212 (S-08 as amended); `elapsed_ms` 300 and `served_from_cache` true; `provenance.engine_version` is the audit commit's sha, as the envelope's |
| `study-horizons.json` | Each horizon's verdict, and the counts, interval and adverse share its `why` prints (the engine's, as in `study.json`) | The answer at 5, 10, 20 and 60 sessions: §12.2's templates filled from that horizon's row, which the fixture resolver serves when a request asks that horizon (Codex R-27); the h = 20 answer is `study.json`'s |
| `study-events.json` | The engine's 18 retained events with each horizon's exit, value and completeness | none |
| `study-catalog.json` | Availability of each study on the audit's store (dollar and oil need series); the two RSI rows (desk/fill-compute) as `GET /api/desk/study/catalog` serves them on the audit's store, their question and client labels included (the labels are drafted, awaiting the owner's approval) | Labels and shorts are §19's (A); every row with a question allows all four horizons, available or not (S-16) |
| `ledger.json` | The ten scored rows at 20 sessions (the two RSI rows since desk/fill-compute, as `GET /api/desk/ledger` serves them on the audit's store at 16:00 UTC on Sep 24: RSI above 70 n 89, last fired 2026-05-26; RSI below 30 n 45, last fired 2026-03-20; both No edge, stale at Sep 21 like every S&P row): n, up share, median, excess, last fired, verdict by rule v1 (golden cross Reliable; gold and VIX Suggestive; death cross, S&P 20- and 5-day and 2s10s No edge; HY Too few at n 2). The S&P 20- and 5-day rows are the catalog's up-2σ studies (n 34 and 78), not the audit's either-way reading | none |
| `overview.json` | The regime tile (the K−2 row, 2026-07 Goldilocks, one month in, Q13); recession 11.64% (§2.1); VIX 15.18 on Sep 23 (^VIX, desk/fill-compute; 14.21 on Sep 22, Q7's value), its band (subdued), its change on the day (+0.97) and, since desk/fill-compute, its gap to the S&P's 21-day realized volatility as `GET /api/desk/overview` serves them on the audit's store (+4.40 pts on Sep 21, VIX 14.87 against 10.47: no window ends on Sep 22, which has no S&P close); the golden cross of 2025-07-01; the active signals (§12.1's rule over the Ledger; since desk/fill-compute the two RSI rows' last fires are among the five latest, as the API serves them); `refreshed_at_utc`, the Desk series' last advance (05:07:11 UTC, §1); the data-status contributors: stored dates (§1), and the expected date, state and reason each series' freshness policy gives on Sep 24 (§12.1: `api/freshness._daily_expected_and_lag` for the FRED inputs, so DGS2, DGS10 and VIX are one business day behind and current; the `asset_prices` rule for ^GSPC and GC=F); the trend tile by §12.7's rule (Codex R-24): both averages read null across the missing Sep 22 close, so the state is `unavailable` since Sep 22 and `above_50`, `above_200` are null, the state Monday serves | none |
| `sectors.json` | Everything: what `GET /api/desk/sectors` serves on the fixture store (the ETF section below): the 60 sessions to Sep 23 (from Jun 29), each sector ETF's log return less SPY's, ranked, and the pattern by `sector-pattern-v1`; `breadth`, of the 11 sector ETFs on Sep 23 (4 above the 50-day, 5 above the 200-day), RSP and IWM against SPY and their one-year lines | none |
| `technicals.json` | The price on Sep 23 and the stored closes at full precision (Q1, Q2), in §12.7's windows: the XNYS sessions after Sep 23 less 6, 12 and 36 calendar months, with Sep 22 a point whose close is null (S-15); the 1-year return, 252 XNYS sessions back (§12.7: from Sep 22, 2025, +15.12%); the golden cross of 2025-07-01; the signals allowlist; `chg_1d` null, because Sep 22 is not stored; the 50- and 200-day averages by §12.7's rule (Codex R-24): simple means over the last 50 and 200 XNYS slots, null wherever a slot has no close, so null on Sep 22 and Sep 23 (the windows start Jul 15 and Dec 5, with 49 and 199 closes), `vs_ma50`, `vs_ma200` null, and the trend `unavailable` since Sep 22; the RSI fields (desk/fill-compute): `src/analytics/technicals.rsi` on the same closes, held on Sep 21 (59.28, the session before 50.71 on Sep 18) because the missing Sep 22 close breaks the run, the last session above 70 (Jun 2, 2026) and below 30 (Mar 30, 2026), each with the S&P's return over the next 20 sessions | `move_20d_sigma` −0.28. `vol` is an awaiting envelope; `sectors` is the API's ready block on the fixture store (desk/fill-etf) |
| `macro.json` | 2y 4.71% and 10y 4.96% on Sep 22, the 3m, 5y and 30y dated null as not stored (S-24); HY 2.73% and IG 0.77% on Sep 23 (§2.5; IG as `source_watermarks` records it, S-22) | The month-ago curve (Q4: Aug 21) and the month's changes derived from it; the 3-year HY rank, range and band on §12.8's window (S-12): 747 expected sessions from Sep 25, 2023 to Sep 23, 2026, the XNYS sessions of `exchange_calendars` less `api/calendar.bond_extra_closures`, all stored, so coverage is complete; the rank and range read every finite observation dated in the window, 787 (the 40 more are weekend month-end prints and values on bond-closure days and holidays); the 12-month line and its peak (Q5). Stock–bond and the correlations are the API's ready blocks on the fixture store (desk/fill-etf: SPY against TLT, and against IEF, HYG, LQD, GLD, UUP, IWM, QQQ and VIX, 60 daily returns to Sep 23, VIX to Sep 22); the matrix is an awaiting envelope |
| `regime.json` | The current row (the K−2 July row and the latest August print, and since desk/fill-compute the home page's classifier reading on the August row as served: Overheating, 0.4246, disagreeing with the July label), the last 60 months of history as stored, recession score, year ago (17.17%, 2025-08) and peak (95.50%, 2020-06), the CPI release date (2026-10-14) | none: since desk/fill-compute the next prints are what `GET /api/desk/regime` serves on the audit's store, read from the July row the page shows (the August CPI and INDPRO prints are already stored, so no threshold: CPI +0.40% m/m flipped inflation to rising, INDPRO +0.02% kept growth rising, and the August row reads Overheating, the label from October); the industrial production release date is null (NEEDS-SERIES); stats and changes as served (months 27 / 213 / 102 / 21, Q8; 123 changes, Q9) |
| `regime-record.json` | The whole stored regimes table (363 rows, 2025-10 absent); fixture only, no route serves it | none |
| `pipeline.json` | Everything: what `GET /api/desk/pipeline` serves on the audit's store at 16:00 UTC on Sep 24, generated from the API (desk/frame-3-api-b2a). The plan's 22 rows (FRAME3_API_PLAN.md §1.9): the Desk registry's series at tier 2 or below, the three curve tenors included, then the raw_series rows a Desk panel reads (INDPRO, CPIAUCSL, UNRATE, T10YIE, T5YIE, USREC, IG), in the five groups; each row's label the registry's (`SERIES_REGISTRY`'s for a raw_series row), its provider the registry's source declaration (R-15), its first and last the observations the Desk reads (IG and the breakevens, stored one row a month, dated by their watermarks' `last_obs`, S-03), its status by its own freshness policy on that date, its note the registry's or the engine's `not_stored` sentence; the feeds are the Desk tabs whose served values are computed from the series, derived from the code (`api/desk_pipeline.tab_readers`: every study reads the regime label, so INDPRO and CPI feed every study tab; the recession model reads the HY spread and the breakevens; the Position Monitor reads 2s10s), and ^NDX, ^RUT and USD/JPY, which no live tab reads, say so in their notes; `last_refresh_utc`, 15:52:43 UTC on Sep 24, the `checked_at` of the `source_watermarks` row `desk_series`; `validation` null, "unknown" on the page, because no `validation.json` was published with the audit's store (§12.9, S-01) | none |
| `positions.json` | The 2s10s sample entered at 40 bp on 2026-09-02 (Q11) and falsified at 15, now 25 | Everything else: sample positions, not anyone's trades |
| `deferred-macro.json`, `vol.json` | none | §12.13's deferred shapes with the mockup's values, for the cards built for them (unit-test inputs, not served): vol with each value's date (`dates`), the matrix. No reads and no words: §12.0 serves a read only with a named rule, and none exists |
| `baskets.json`, `pipeline-ddl.ts` | none | `baskets.json` is an Export of this browser's store; the DDL is the proposed export schema, its first line saying so, generated from `api/static/snowflake_proposed.sql` (the one copy `/pipeline/ddl` serves) by `web/scripts/gen-ddl-fixture.mjs`; `pipeline-ddl.test.ts` holds it equal to the file byte for byte (S-04, R-02) |

## The ETFs (desk/fill-etf)

The audit's store predates the Desk's ETFs, so their values come from the
**fixture store**: the audit's store with the 24 ETFs' `asset_prices` rows
(XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLRE, XLU, XLV, XLY, SPY, RSP, IWM,
QQQ, SMH, SOXX, IGV, TLT, IEF, HYG, LQD, GLD, UUP) taken from a copy this
branch's refresh step filled on 2026-09-27
(`python -m src.market_data.asset_history`, Yahoo, as in the workflow), cut
at 2026-09-23, the last completed session when the audit's store was
refreshed. Nothing else in the store changes, so every other value above is
as it was. `scripts/desk_etf_fixtures.py` builds that store and writes what
the API serves on it into the fixtures, the clock frozen at 16:00 UTC on
Sep 24: `pipeline.json` whole (its three ETF groups are the only change),
and the ETF blocks of the other routes as each is served. The adjusted
closes are the provider's as of 2026-09-27; a dividend paid after Sep 23
restates earlier adjusted closes, so a later rebuild can move the last
digits.

`consistency.test.ts` holds the fixtures to each other (one label per slug,
one comparison session, the firing rows, the regime lag) and to the audit's
real values.

To rebuild them: `web/node_modules/.cache/desk-align/build_fixtures.py`
(scratch, outside the repo) reads the engine run and the direct queries and
writes the files above; the ETF values, `scripts/desk_etf_fixtures.py
--audit <audit copy> --etf-db <refreshed copy> --store <scratch path>`.
