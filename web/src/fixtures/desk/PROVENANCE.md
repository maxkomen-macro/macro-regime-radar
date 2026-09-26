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
yields through Sep 22, no ^GSPC row for Sep 22, regimes through 2026-08 with
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
| `study-events.json` | The engine's 18 retained events with each horizon's exit, value and completeness | none |
| `study-catalog.json` | Availability of each study on the audit's store (dollar and oil need series; the RSI rows a computation) | Labels and shorts are §19's (A); every row with a question allows all four horizons, available or not (S-16) |
| `ledger.json` | The eight scored rows at 20 sessions: n, up share, median, excess, last fired, verdict by rule v1 (golden cross Reliable; gold and VIX Suggestive; death cross, S&P 20- and 5-day and 2s10s No edge; HY Too few at n 2). The S&P 20- and 5-day rows are the catalog's up-2σ studies (n 34 and 78), not the audit's either-way reading | none |
| `overview.json` | The regime tile (the K−2 row, 2026-07 Goldilocks, one month in, Q13); recession 11.64% (§2.1); VIX 14.21 on Sep 22 (Q7); the golden cross of 2025-07-01; the active signals (§12.1's rule over the Ledger); `refreshed_at_utc`, the Desk series' last advance (05:07:11 UTC, §1); the data-status contributors: stored dates (§1), and the expected date, state and reason each series' freshness policy gives on Sep 24 (§12.1: `api/freshness._daily_expected_and_lag` for the FRED inputs, so DGS2, DGS10 and VIX are one business day behind and current; the `asset_prices` rule for ^GSPC and GC=F) | The trend tile's state and its start (Sep 17) are read from plain rolling means of the stored closes (Q1, Q2), not §12.7's rule, which reads null across the missing Sep 22 close |
| `technicals.json` | The price on Sep 23 and the stored closes at full precision (Q1, Q2), in §12.7's windows: the XNYS sessions after Sep 23 less 6, 12 and 36 calendar months, with Sep 22 a point whose close is null (S-15); the 1-year return, 252 XNYS sessions back (§12.7: from Sep 22, 2025, +15.12%); the golden cross of 2025-07-01; the signals allowlist; `chg_1d` null, because Sep 22 is not stored | The 50- and 200-day averages and their windows: plain rolling means of the last 50 and 200 stored closes (the 50 start Jul 14), not §12.7's XNYS slots, which start Jul 15 and read null across the missing Sep 22; `move_20d_sigma` −0.28. `vol` and `sectors` are awaiting envelopes |
| `macro.json` | 2y 4.71% and 10y 4.96% on Sep 22, the 3m, 5y and 30y dated null as not stored (S-24); HY 2.73% and IG 0.77% on Sep 23 (§2.5; IG as `source_watermarks` records it, S-22) | The month-ago curve (Q4: Aug 21) and the month's changes derived from it; the 3-year HY rank, range and band on §12.8's window (S-12): 747 expected sessions from Sep 25, 2023 to Sep 23, 2026, the XNYS sessions of `exchange_calendars` less `api/calendar.bond_extra_closures`, all stored, so coverage is complete; the rank and range read every finite observation dated in the window, 787 (the 40 more are weekend month-end prints and values on bond-closure days and holidays); the 12-month line and its peak (Q5). Stock–bond, correlations and matrix are awaiting envelopes |
| `regime.json` | The current row (the K−2 July row and the latest August print), the last 60 months of history as stored, recession score, year ago (17.17%, 2025-08) and peak (95.50%, 2020-06), the CPI release date (2026-10-14) | The flip thresholds (NEEDS-COMPUTATION: computed here from the stored index levels); the industrial production release date is null (NEEDS-SERIES). Stats and changes are awaiting envelopes |
| `regime-record.json` | The whole stored regimes table (363 rows, 2025-10 absent); fixture only, no route serves it | none |
| `pipeline.json` | Each series' provider, frequency, first and last stored observation and status (§1, §2.10); for IG, BB, B and CCC, stored one row a month, `last` is the newest observation, Sep 23, which their notes name (S-03); a Desk series' label is the registry's; the feeds are the Desk tabs that read each series, live or designed (§12.9); `last_refresh_utc`, 15:52:43 UTC on Sep 24, the `checked_at` of the `source_watermarks` row `desk_series` (§12.9: the Desk store runs only in the full refresh) | `validation` "pass" (§12.9, S-01: no `validation.json` was published with the audit's store); labels of the series the registry does not carry, in its style ("3M Treasury"); the notes' wording |
| `positions.json` | The 2s10s sample entered at 40 bp on 2026-09-02 (Q11) and falsified at 15, now 25 | Everything else: sample positions, not anyone's trades |
| `deferred-regime.json` | Months per regime 27 / 213 / 102 / 21 (counted from the stored history; NEEDS-ENDPOINT) | Every other value (NEEDS-COMPUTATION or NEEDS-ENDPOINT) |
| `deferred-macro.json`, `vol.json`, `sectors.json` | none | §12.13's deferred shapes with the mockup's values, for the cards built for them: vol with each value's date (`dates`), sectors with breadth's comparison date (`compared_on`), each correlation with its symbol, quantity and transform (illustrative choices). No reads and no words: §12.0 serves a read only with a named rule, and none exists |
| `baskets.json`, `pipeline-ddl.ts` | none | `baskets.json` is an Export of this browser's store; the DDL is the proposed export schema, its first line saying so; once session B ships `api/static/snowflake_proposed.sql`, the file is generated from it (S-04, R-02) |

`consistency.test.ts` holds the fixtures to each other (one label per slug,
one comparison session, the firing rows, the regime lag) and to the audit's
real values.

To rebuild them: `web/node_modules/.cache/desk-align/build_fixtures.py`
(scratch, outside the repo) reads the engine run and the direct queries and
writes the files above.
