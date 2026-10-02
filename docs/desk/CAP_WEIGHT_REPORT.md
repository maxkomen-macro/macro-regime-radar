# desk/cap-weight — cap-weighted baskets on Basket & Hedge

Branch `desk/cap-weight` (worktree `mrr-cap-weight`), cut from main
`001321cd` (Merge branch 'fix/freshness') on 2026-10-01. **Not pushed**: the
owner pushes after typing `PUSH OK desk/cap-weight`. One commit per item:

| # | Commit | Item |
|---|---|---|
| 1 | `fbce2811` | The preset baskets' share counts, stored by the full refresh (`share_counts`), advisory in `validate_db`, a freshness state |
| 2 | `bf9e782e` | The engine: cap weight, market value at the start from share counts |
| 3 | `f0244d76` | The API: `weighting=cap` on `/basket/price` and `/basket/hedge`, `GET /basket/shares` (§12.18), contract, fixtures |
| 4 | `e5fccd37` | The page: Cap-weight beside Equal-weight, the preset's default |
| 4b | `1a684c23` | The preset desk/books seeded, untouched, takes cap weight in place |
| 6 | `ac312b3b` | The review's findings (below, "Review"); its subject says "desk/cap-weight 6" |
| 7 | (this report's commit) | This report and its screenshots (`docs/desk/shots/desk-cap-weight/`) |

**Where the numbers come from.** This machine holds no EODHD token (by
design: the local API runs with the relay off and cannot spend the
production quota), so every basket figure in this report, and in the
fixtures the tests and screenshots read, is priced through
`scripts/desk_basket_fixture.py`: Yahoo's daily closes through 2026-09-23
(the fixture world's last session; the same cached download desk/books
used, so every answer it wrote is unchanged but for the two new fields) run
through the API's own functions (`api/desk_basket.price_answer` and
`hedge_answer` over `src/desk/basket.py`). The share counts are Yahoo's,
read on 2026-10-01 through the full refresh's own check
(`src/market_data/share_counts.checked_count`). The deployed API prices
from EODHD, whose adjusted closes may differ from Yahoo's in the last
digits.

## What the page does now

- **Cap-weight** sits beside **Equal-weight** in the legs' tools. It is a
  toggle (`aria-pressed`): on, the basket is weighted by market value and its
  typed weights are kept as they are (scaled to 100% only when they do not
  add to it); off again, the typed weights are back. **Equal-weight** sets
  typed weights at equal weight. Pressed, the weights column reads **At start**
  and shows each name's resulting weight, read only, served by the API; the
  **Now** column beside it is the weight at the last close. The basket
  reads **"Cap-weighted: market value at the start, current share counts
  (Yahoo, as of Oct 1, 2026)"** under the legs and in the index card's
  footnote; the index card's subtitle says "cap-weighted"; the method hint,
  the contribution card ("cap weight at the start → at the last close") and
  the liquidity card ("At cap weight") say it too.
- **AI Infrastructure 10 is cap-weighted by default**, so it compares like
  for like with the S&P and the Nasdaq it is read against: a new browser is
  seeded with it cap-weighted, and a browser holding desk/books' seed
  untouched gets cap weight in place (one the analyst saved stays theirs).
  Its typed weights stay at 10% each, so **Equal-weight is one click away**:
  one click and Save prices it at equal weight; Cap-weight and Save bring it
  back.
- **Unavailable, with the reason.** Cap weight needs a stored share count
  for every name. A basket with a custom ticker (the sample basket's SMCI, an
  added ORCL), or a database the full refresh has not reached, shows the
  control disabled inside a `[data-unserved]` scope with the reason under
  the legs:
  - "Cap weight is unavailable. It needs a stored share count for every
    name: SMCI has none (counts are stored for the preset baskets' names)."
  - "Cap weight is unavailable. Awaiting refresh: share counts are not
    stored in this database yet; the next full refresh reads them from
    Yahoo."

  A saved cap-weighted basket is then priced at its typed weights (equal),
  and its lead says "10% each (cap weight is unavailable)"; the choice is
  kept, so the counts' arrival makes it cap-weighted again. Adding a name
  never changes the choice either: a name without a count leaves cap weight
  unavailable for the basket, which is priced at its typed weights (equal
  after the add), and the note names it ("ORCL added; the 11 names are at
  equal weight. ORCL has no stored share count, so cap weight is unavailable
  for this basket."); drop the name and the basket is cap-weighted again.
  Typing a weight where cap weight is unavailable makes the basket one of
  typed weights. `?add=` waits for the counts before deciding.
- **Everything below step 1 recomputes from the chosen weights**, because
  the API prices the basket at them: the index and its technicals, the
  returns, the beta and correlation, the relative strength, the
  contribution, the concentration, the liquidity, the hedge ranking, the
  hedge ratio and short, the volatility left and cut, and the stress test.
  The PROTOTYPE cards follow: "Hedge with options" sizes its single-name
  route by the weights the basket holds (cap weights at the last close) and
  reads the cap-weighted hedge answer; "Positioning" weights its figures the
  same way. **Send to Position Monitor** records a cap-weighted basket at
  the cap weights last served for it (the page keeps them on the saved
  basket, in place, never reordering the list, and only a newer answer
  replaces them); a cap-weighted basket no answer was served for is not
  recorded at its typed weights: Save says "<name> is cap-weighted, and no
  cap weights have been served for it in this browser yet: open it on Basket
  & Hedge until it is priced, then send it again."

Screenshots (fixture world, 1440 px unless noted), in
`docs/desk/shots/desk-cap-weight/`: `01` the preset cap-weighted, `02`–`07`
step 2 and step 3 cap-weighted, `08`–`09` the same basket at equal weight,
`10` an old database (no counts), `11` a custom ticker (SMCI), `12` a phone
(390 px, no sideways scroll).

## Method

- **Weight at the start**: `w_i = S_i × P_i(start) / Σ_j S_j × P_j(start)`,
  `S_i` the stored share count, `P_i(start)` the name's close on the
  basket's start (the first XNYS session every name has a close; for the AI
  Infrastructure 10, CoreWeave's first close, Mar 28, 2025). The close is
  the split- and dividend-adjusted one the index is priced from, so a count
  and a close are on one share basis across a split. Using today's counts
  with the start's adjusted close is the approximation the label states
  ("current share counts"); a dividend payer's start value is understated by
  the dividends paid since (about 2% for AVGO and TSM over the 18 months).
- **Held** (the default): the weights become share counts at the start and
  never change, so the holdings stay proportional to the companies' share
  counts and the weights move with each company's value, as a cap-weighted
  index behaves between rebalances.
- **Monthly**: reset to cap weights at the close of each month's first
  index session after the start (as asked). With one set of counts, a reset
  to `S_i × P_i(t) / Σ` changes no holding, so the monthly cap-weighted index
  is the held one (pinned to 1e-12 by `tests/test_desk_basket.py`); only the
  rebalance count differs (19 here, the start and 18 months' first sessions).
- **Liquidity's dollars**: a basket bought today, at the last close's market
  values (the weights a cap-weighted basket holds now), not the start's.
- **ADRs**: a count must be in the unit of the listing's price. The refresh
  checks every count against Yahoo's market cap in US dollars (count × Yahoo's
  price = market cap, within 2%). TSM passes as Yahoo gives it: 5,186.5M ADRs ×
  $459.20 = $2.38T, Yahoo's market cap (one ADR is five ordinary shares;
  Yahoo counts ADRs). A count given in ordinary shares (count × price = k ×
  market cap, k from 2 to 100) would be stored ÷ k, in ADR units, and said;
  a count in another currency, or one that fails the check otherwise, is not
  stored, its previous row stays, and the watermark names it.
- **Two share classes** (CoreWeave, Nebius): Yahoo's market cap counts every
  class at the listed class's price (551.5M and 271.9M shares); the listed
  class has 458.9M and 238.4M. The listed class is stored, because the S&P
  and the Nasdaq count only listed shares; the watermark's detail and the
  freshness reason name both figures. With Yahoo's figure instead, CRWV's
  and NBIS's weights would be 20% and 14% higher (0.46% and 0.13% of the
  basket at the start instead of 0.38% and 0.11%).

## The AI Infrastructure 10's cap weights at the start (Mar 28, 2025)

Counts: Yahoo, read Oct 1, 2026. Closes: Yahoo's adjusted closes on Mar 28,
2025 (the API reads EODHD's).

| Ticker | Name | Shares outstanding | Close on Mar 28, 2025 | Market value | Cap weight at the start | Cap weight at the last close (Sep 23, 2026) | Equal weight |
|---|---|---:|---:|---:|---:|---:|---:|
| NVDA | NVIDIA | 24,147.0M | $109.39 | $2,641.5B | 55.35% | 44.60% | 10.00% |
| AVGO | Broadcom | 4,773.6M | $167.19 | $798.1B | 16.72% | 13.88% | 10.00% |
| AMD | AMD | 1,632.5M | $103.22 | $168.5B | 3.53% | 8.22% | 10.00% |
| TSM | TSMC | 5,186.5M | $162.41 | $842.3B | 17.65% | 18.97% | 10.00% |
| MU | Micron | 1,129.4M | $88.10 | $99.5B | 2.08% | 9.91% | 10.00% |
| ANET | Arista Networks | 1,261.2M | $77.94 | $98.3B | 2.06% | 2.10% | 10.00% |
| VRT | Vertiv | 385.0M | $74.12 | $28.5B | 0.60% | 0.78% | 10.00% |
| CEG | Constellation Energy | 354.3M | $203.72 | $72.2B | 1.51% | 0.77% | 10.00% |
| CRWV | CoreWeave | 458.9M | $40.00 | $18.4B | 0.38% | 0.33% | 10.00% |
| NBIS | Nebius | 238.4M | $22.31 | $5.3B | 0.11% | 0.44% | 10.00% |
| | **Basket** | | | **$4,772.7B** | **100.00%** | **100.00%** | **100%** |

## Every figure on the page, before and after

"Before" is the preset as it was the default until this branch, at equal
weight (10% each); "after" is the preset cap-weighted, its new default; both
bought and held, $1,000,000, prices through Sep 23, 2026.

### Step 1 (Basket)

| | Before: equal weight | After: cap weight |
|---|---|---|
| Lead | AI Infrastructure 10 holds 10 names, 10% each, bought and held, $1,000,000: up 346.5% since Mar 28, 2025, the first session every name has a price (CRWV's first close). | AI Infrastructure 10 holds 10 names, cap-weighted, the largest NVDA at 55% at the start, bought and held, $1,000,000: up 155.8% since Mar 28, 2025, the first session every name has a price (CRWV's first close). |
| Method hint | share counts fixed at the start; weights drift with price | bought at each company's market value at the start; held, it stays cap-weighted |
| Weights column | Weight (typed): 10% each | At start (served): the table above |
| Label | total 100% | Cap-weighted: market value at the start, current share counts (Yahoo, as of Oct 1, 2026) |

### Step 2 (How the basket trades)

| Card lead | Before: equal weight | After: cap weight |
|---|---|---|
| Basket index | Up 346.5% since Mar 28, 2025 and +98.6% over the last year; above both its 50- and 200-day averages since Sep 17. | Up 155.8% since Mar 28, 2025 and +46.7% over the last year; above both its 50- and 200-day averages since Sep 17. |
| Momentum and risk | RSI(14) is 58, the index is 10.9% below its Jun 22, 2026 peak and the last 21 sessions moved at 43% a year. | RSI(14) is 59, the index is 2.9% below its Jun 2, 2026 peak and the last 21 sessions moved at 34% a year. |
| Against the Nasdaq and the S&P (1Y) | Over the last year (since Sep 22, 2025) the basket returned +98.6%, against +23.7% for QQQ and +16.4% for SPY; over a year it has moved 2.23× QQQ, correlation 0.78. | Over the last year (since Sep 22, 2025) the basket returned +46.7%, against +23.7% for QQQ and +16.4% for SPY; over a year it has moved 1.61× QQQ, correlation 0.87. |
| Relative strength (1Y) | Basket ÷ benchmark, 100 on Sep 24: against QQQ at 159, above its 50-day average; against SPY at 169, above its 50-day average. | Basket ÷ benchmark, 100 on Sep 24: against QQQ at 119, above its 50-day average; against SPY at 127, above its 50-day average. |
| Contribution to return | MU added 111.7 of the index's 346.5 points since Mar 28; CEG added the least, 3.0. | NVDA added 58.7 of the index's 155.8 points since Mar 28; CEG added the least, 0.4. |
| Concentration | MU, NBIS and AMD are 63% of the basket at the last close; it holds like 6.1 equal-weight names, and its names' average pairwise correlation is 0.47. | NVDA, TSM and AVGO are 77% of the basket at the last close; it holds like 3.7 equal-weight names, and its names' average pairwise correlation is 0.47. |
| Liquidity | At $1,000,000 the slowest name to trade is CEG: 0.00063 days at 20% of its 20-day average dollar volume. | At $1,000,000 the slowest name to trade is TSM: 0.00022 days at 20% of its 20-day average dollar volume. |

| Figure | Before: equal weight | After: cap weight |
|---|---:|---:|
| Start (base 100) | 2025-03-28 | 2025-03-28 |
| Total return since the start | +346.5% | +155.8% |
| Index, Sep 23, 2026 | 446.5 | 255.8 |
| 1-day change (Sep 22 → 23) | −2.2% | −1.6% |
| 50-day average (index vs it) | 413.0 (+8.1%) | 242.3 (+5.6%) |
| 200-day average (index vs it) | 338.2 (+32.0%) | 216.4 (+18.2%) |
| Trend | above both averages since Sep 17, 2026 | above both averages since Sep 17, 2026 |
| 1-year return (since Sep 22, 2025) | +98.6% | +46.7% |
| RSI (14), Sep 23 | 58.0 | 58.9 |
| From peak (peak date) | −10.9% (2026-06-22) | −2.9% (2026-06-02) |
| Deepest drawdown (date) | −33.6% (2026-07-29) | −18.4% (2026-07-29) |
| 21-day realized vol | 42.8% | 33.7% |
| Beta / correlation to QQQ, 1 year | 2.23 / 0.78 | 1.61 / 0.87 |
| Beta / correlation to QQQ, 60 days | 2.67 / 0.77 | 1.59 / 0.85 |
| Beta / correlation to SPY, 1 year | 2.86 / 0.65 | 2.19 / 0.77 |
| Beta / correlation to SPY, 60 days | 3.41 / 0.54 | 2.27 / 0.67 |
| QQQ / SPY 1-year return (same dates) | +23.7% / +16.4% | +23.7% / +16.4% |
| Basket ÷ QQQ, 1Y chart (base 2025-09-24), with its 50-day | 159 (153) | 119 (118) |
| Basket ÷ SPY, 1Y chart, with its 50-day | 169 (158) | 127 (121) |
| Basket ÷ QQQ, 6M chart (base 2026-03-24), with its 50-day | 135 (130) | 110 (109) |
| Basket ÷ SPY, 6M chart, with its 50-day | 145 (136) | 118 (113) |
| Top-3 weight at the last close | 63% (MU, NBIS, AMD) | 77% (NVDA, TSM, AVGO) |
| Effective names (1 ÷ Σw²) | 6.1 | 3.7 |
| Average pairwise correlation (252 sessions) | 0.47 | 0.47 |
| Liquidity: slowest name, days at 20% of ADV | CEG, 0.00063 days | TSM, 0.00022 days |
| Rebalances, monthly (index identical to held: cap only) | 19 (month-ends) | 19 (months' first sessions) |
| Monthly total return | +319.2% | +155.8% |

The average pairwise correlation is the same both ways: it is the names'
own daily returns, whatever their weights.

Per name (step 1's Now column, and step 2's contribution and liquidity rows):

| Ticker | Weight now: equal → cap | Since start (both) | Contribution, points: equal → cap | 20-day ADV | At target / at cap weight | Days at 20%: equal → cap |
|---|---:|---:|---:|---:|---:|---:|
| NVDA | 4.6% → 44.6% | +106.1% | +10.6 → +58.7 | $29.2B | $100.0K / $446.0K | 0.000017 days → 0.000076 days |
| AVGO | 4.8% → 13.9% | +112.3% | +11.2 → +18.8 | $9.9B | $100.0K / $138.8K | 0.000051 days → 0.00007 days |
| AMD | 13.3% → 8.2% | +495.4% | +49.5 → +17.5 | $11.1B | $100.0K / $82.2K | 0.000045 days → 0.000037 days |
| TSM | 6.2% → 19.0% | +175.0% | +17.5 → +30.9 | $4.3B | $100.0K / $189.7K | 0.00012 days → 0.00022 days |
| MU | 27.3% → 9.9% | +1116.7% | +111.7 → +23.3 | $24.8B | $100.0K / $99.1K | 0.00002 days → 0.00002 days |
| ANET | 5.8% → 2.1% | +161.1% | +16.1 → +3.3 | $982.0M | $100.0K / $21.0K | 0.00051 days → 0.00011 days |
| VRT | 7.5% → 0.8% | +235.6% | +23.6 → +1.4 | $1.4B | $100.0K / $7.8K | 0.00037 days → 0.000029 days |
| CEG | 2.9% → 0.8% | +29.5% | +3.0 → +0.4 | $792.5M | $100.0K / $7.7K | 0.00063 days → 0.000048 days |
| CRWV | 4.9% → 0.3% | +117.3% | +11.7 → +0.5 | $2.4B | $100.0K / $3.3K | 0.00021 days → 0.0000068 days |
| NBIS | 22.8% → 0.4% | +915.7% | +91.6 → +1.0 | $3.3B | $100.0K / $4.4K | 0.00015 days → 0.0000068 days |

### Step 3 (Hedge it)

| Card lead | Before: equal weight | After: cap weight |
|---|---|---|
| Hedge with an ETF | SMH fits the basket best (R² 0.74 over a year): short $1,233,779 of it against $1,000,000 and the basket's volatility falls from 57% to 29%, 49% less. | SMH fits the basket best (R² 0.83 over a year): short $847,494 of it against $1,000,000 and the basket's volatility falls from 37% to 15%, 59% less. |
| Stress test | With the table's hedge, short $1,233,779 of SMH: if QQQ falls 10% the basket loses $223,092 unhedged and makes $222 hedged; if SPY falls 10% the basket loses $286,219 unhedged and makes $6,534 hedged. | With the table's hedge, short $847,494 of SMH: if QQQ falls 10% the basket loses $160,857 unhedged and loses $7,461 hedged; if SPY falls 10% the basket loses $218,536 unhedged and loses $17,441 hedged. |

| ETF | Rank: equal → cap | R² 1Y | R² 60D | Hedge ratio | Short | Vol left | Vol cut |
|---|---:|---:|---:|---:|---:|---:|---:|
| SMH | 1 → 1 | 0.74 → 0.83 | 0.77 → 0.92 | 1.23× → 0.85× | $1.2M → $847.5K | 29% → 15% | −49% → −59% |
| XLK | 3 → 2 | 0.71 → 0.83 | 0.72 → 0.85 | 1.82× → 1.27× | $1.8M → $1.3M | 31% → 15% | −46% → −59% |
| QQQ | 4 → 3 | 0.60 → 0.75 | 0.59 → 0.72 | 2.23× → 1.61× | $2.2M → $1.6M | 36% → 19% | −37% → −50% |
| SOXX | 2 → 4 | 0.73 → 0.74 | 0.79 → 0.84 | 1.06× → 0.69× | $1.1M → $687.1K | 30% → 19% | −48% → −49% |
| SPY | 5 → 5 | 0.42 → 0.59 | 0.29 → 0.45 | 2.86× → 2.19× | $2.9M → $2.2M | 44% → 24% | −24% → −36% |
| IWM | 6 → 6 | 0.35 → 0.35 | 0.32 → 0.33 | 1.81× → 1.17× | $1.8M → $1.2M | 46% → 30% | −19% → −19% |
| IGV | 7 → 7 | 0.04 → 0.09 | 0.01 → 0.00 | 0.36× → 0.35× | $361.7K → $346.6K | 56% → 35% | −2% → −5% |
| XLU | 8 → 8 | 0.01 → 0.00 | 0.01 → 0.00 | 0.33× → 0.06× | $327.0K → $61.4K | 57% → 37% | −0% → −0% |

Top pick: SMH → SMH; basket volatility on the top pick's window 57% → 37%.

| Stress (top pick's short held as the table recommends) | Basket move | Unhedged | Short leg | Hedged |
|---|---:|---:|---:|---:|
| QQQ −10%, equal weight (short $1,233,779 of SMH) | −22.3% | −$223,092 | $223,314 | $222 |
| QQQ −10%, cap weight (short $847,494 of SMH) | −16.1% | −$160,857 | $153,396 | −$7,461 |
| SPY −10%, equal weight (short $1,233,779 of SMH) | −28.6% | −$286,219 | $292,754 | $6,534 |
| SPY −10%, cap weight (short $847,494 of SMH) | −21.9% | −$218,536 | $201,095 | −$17,441 |

PROTOTYPE cards (illustrative outputs, live inputs): "Hedge with options"
reads top ETF SMH both ways, hedge ratio 1.23× → 0.85×, R² 0.74 → 0.83; its
route (b), the three largest names, is NVDA, AVGO and AMD at 10% each
(the basket's order) → NVDA 44.6%, TSM 19.0% and AVGO 13.9%. "Positioning"'s
weighted short interest 4.8% → 1.3% of float, days to cover 1.7 → 0.9.

## The data: share counts in the full refresh

- **Step**: "Store share counts", full mode only, after "Store allocation
  price histories", `continue-on-error: true`, `timeout-minutes: 5`, `python
  -m src.market_data.share_counts`. Full mode already installs yfinance
  (`requirements.txt`); the API image installs none (`requirements-api.lock`)
  and imports nothing from the step. The names are every constituent of every
  preset basket (`src/desk/presets.py`, pinned to the page's `PRESET` by
  `tests/test_share_counts.py`).
- **Table**: `share_counts (symbol PRIMARY KEY, shares_outstanding REAL NOT
  NULL CHECK > 0, as_of TEXT, source TEXT) WITHOUT ROWID`. A name fetched is
  upserted with the refresh's New York date and `yfinance`; a name not
  fetched, or refused by the check, keeps its row and date; a name no preset
  holds any more is removed. Each fetch is retried once.
- **Watermark** `share_counts`: `ok`, `partial` or `error`, the oldest stored
  read as its observation, and a detail naming every note and every failure
  ("Yahoo 10 of 10 · CRWV: listed class 458.9M shares stored; Yahoo's market
  cap counts every class, 551.5M; NBIS: …").
- **validate_db**: the table is advisory (`ADVISORY_TABLES`). In full mode a
  change publishes it (`MODE_TABLES`, a fingerprint over every column). Its
  absence, an empty table, a partial or failed fetch, a date that moved
  earlier, rows that fell, a row the API sets aside, a future date, and a
  check that cannot run on it are warnings, never failures; nothing about it
  is ever "not executed". The database never fails for lacking it.
- **Freshness**: `/api/freshness` `series[]` carries "Share counts (stored)"
  (`kind: derived`): current while the oldest read is at most a week old,
  stale after, unknown with "Share counts are not stored in this database
  yet; the next full refresh reads them from Yahoo." when absent. It is not
  an SLA feed and is not in `overall` (so it never moves the sidebar's Data
  status dot); the Data status drawer lists it, and so does
  `/api/desk/pipeline/inventory`.
- **Run against live Yahoo** on a copy of this machine's published database
  (2026-10-02 02:52 UTC): `ok · Yahoo 10 of 10`, the two class notes above;
  every check passed (ratio 1.0000 for the eight single-class names, TSM
  included). Then `validate_db` against the published file as the previous
  snapshot: **pass, upload true**, changed `share_counts` and
  `source_watermarks`, no share-count warning.
- **A failed fetch** (every Yahoo call raising) on another copy: the step
  wrote the empty table and an `error` watermark; `validate_db`: **pass,
  upload true** (the watermark changed), two warnings ("share_counts: no
  count stored; …" and "share_counts error: Yahoo 0 of 10 · …"), no failure.

## The API

- `GET /api/desk/basket/price` and `/basket/hedge` take
  `weighting=target|cap` (target the default). A cap-weighted basket names
  its legs as tickers alone (`legs=NVDA,AVGO,…`); a weight given is refused,
  422 `unsupported`, and so is a name without a stored count, naming it
  ("Cap weight needs a stored share count for every name: ORCL has none. The
  full refresh stores counts for the preset baskets' names."). Both answers
  carry `weighting` and `cap_weights` (provider, source, the oldest read,
  the start, and per name its count, read date, start close, market value
  and weight; null for typed weights).
- `GET /api/desk/basket/shares` (§12.18): the stored counts
  (`counts_as_of`, never a top-level `as_of`, which is the envelope's), each
  row checked on its own (a count that is not positive, a read date that is
  malformed or after today, no source: set aside in `excluded`, with why).
- Both read the worker item `desk_share_counts` of the request's generation:
  the API never calls Yahoo and never reads the counts outside a generation.
  The item returns a value, never an error, for a missing, empty or
  unreadable table, so an old database never holds a generation back.
- **Old database, live** (this machine's published file, which predates the
  table, served on 127.0.0.1:8001 from a `git archive` of the final head
  `ac312b3b`, relay off, no token): `/health/ready` ready
  with 39 results and no errors; `/basket/shares` 200 awaiting "Awaiting
  refresh: share counts are not stored in this database yet; the next full
  refresh reads them from Yahoo."; `/basket/price` and `/basket/hedge` with
  `weighting=cap` 200 awaiting "Awaiting refresh: cap weight reads stored
  share counts, and share counts are not stored in this database yet; the
  next full refresh reads them from Yahoo."; a typed basket 503 `provider`
  (no EODHD token here, as before); `/api/freshness` lists share counts as
  unknown with the reason. Every Desk route and the core ones answered 200
  (`/api/freshness`, `/api/desk/pipeline/inventory`, `/overview`,
  `/study/catalog`, `/study?preset=golden-cross`, `/ledger`, `/regime`,
  `/technicals`, `/macro`, `/pipeline`, `/sectors`, `/instruments`,
  `/basket/shares`, the four stubs, `/event-study/assets`, `/api/allocation`,
  `/api/credit/oas`, `/api/recession/probability`), and
  `tests/test_desk_api.py`'s route sweep, on a store without the table,
  answers every route its stated status.
- **New database, live** (the same file after the share-count step, the
  same export of `ac312b3b`): `/basket/shares` ready with the ten counts
  (Yahoo, read 2026-10-01, none set aside); a cap request for NVDA, AVGO, TSM
  proceeds to the provider (503 here only for the missing EODHD token); NVDA,
  ORCL is refused 422 naming ORCL; NVDA:50 with `weighting=cap` is refused
  422 ("give the leg 'NVDA:50' as its ticker alone"); the inventory row reads
  current, "Yahoo shares outstanding (stored by the full refresh)", read by
  "Desk · Basket & Hedge (cap weight)".

## Tests

- `tests/test_share_counts.py` (new, 25): the market-cap check on Yahoo's
  own Oct 1 figures (one class; TSM in ADR units; an ADR counted in ordinary
  shares stored ÷ 5; CoreWeave's and Nebius's listed class; ten refusals);
  the retry; the step (every name stored, a partial fetch keeping
  yesterday's rows, a failed fetch writing nothing, the command exiting 0
  even when it cannot run, the CHECK, a name leaving the presets removed);
  the presets equal to the page's; the workflow step; yfinance imported only
  inside the fetch. No test reaches Yahoo (an autouse fixture fails any).
- `tests/test_validate_db.py` (+6): no table passes and says so; **a failed
  share-count fetch still validates and uploads** (the real step, every call
  failing; and a partial one); a count-only change publishes; regressions
  and set-aside rows only warn; an unreadable table only warns; the state is
  reported, never judged.
- `tests/test_desk_basket.py` (+11): **weights from known shares and
  prices**, hand-checked (300 shares at 10 and 50 at 20: 75% and 25%; the
  index is the companies' market value over the start's); the monthly reset
  on the first session and its identity with held; a later listing's start;
  every refusal of a missing or bad count.
- `tests/test_desk_basket_api.py` (+14): the cap-weighted answer against the
  counts × the start's closes; the hedge reading the same counts; monthly
  equal to held; **a missing share count** refused naming it; the cap
  parameter's refusals; **an old database without the table** (awaiting,
  and typed baskets still priced); an empty table; `/basket/shares` setting
  bad rows aside, and a fully set-aside table; **the hedge ranking under cap
  vs equal weights** (X moves
  with SMH, Y with XLU at three times the volatility: XLU ranks first at
  equal weight, SMH cap-weighted, with the ratio, the short and the stress
  following).
- Contract and inventories: `tests/desk_contract.py` (`weighting`,
  `cap_weights`, `BASKET_SHARES`), `tests/test_desk_contract.py`,
  `tests/test_desk_v2_stubs.py`, `tests/test_desk_api.py`'s route sweep.
- Web: `weights.test.ts` (+9: availability and its reasons, the request,
  the held basket, what Position Monitor records, the newer-snapshot rule,
  saving and in-place updates, the untouched seed's upgrade),
  `PositionMonitorPage.test.tsx` (+2: a cap-weighted basket recorded at its
  served weights; one never served refused, with the reason),
  `trades.test.ts` (+4: the label, the method, the lead, every card's
  sentence both ways), `BasketHedgePage.test.tsx` (the preset
  cap-weighted with its weights, label and requests, Equal-weight and back,
  the snapshot; `?add=` without a count; Positioning at held weights; an old
  database; a custom ticker; typing where cap weight is unavailable),
  `api.test.tsx` (the new schema), and the Desk e2e (`desk.spec.ts`: the
  first visit cap-weighted, Equal-weight and back, ORCL; the sample basket's
  SMCI reason; the requests).

## Gates

Run on this machine with the shared venv (`../macro-regime-radar/.venv`,
read-only) and a local `.venv` for yfinance and the fixture script, the full
gates under the owner's `/tmp/mrr-full-gates.lock`.

- **Scoped, per item**: each commit's own suites before it was made
  (`test_share_counts`, `test_validate_db`, `test_workflows`, the freshness
  tests; `test_desk_basket`; `test_desk_basket_api`, the contract, stubs,
  envelope and route-sweep tests; the basket, prototype and Position Monitor
  vitest files and the Desk e2e's basket tests). After the review's fixes:
  355 passed across the touched Python suites.
- **Full pytest** (`pytest --ignore=tests/test_streamlit_backports.py`, with
  `DESK_DB` a copy of the Sep 27 scratch store the usability run used and
  `web/dist` built): at `ac312b3b` **1,920 passed, 3 skipped, 11 failed**
  (at `e5fccd37`: 1,919, 3, the same 11). The 11 fail identically on the base
  `001321cd` with the same database and environment (a `git archive` of the
  base with this worktree's database copied in), so none comes from this
  branch:
  - `test_asset_history` (2): the known pair;
  - `test_desk_v2_overview` null-slope (2), `test_desk_v2_regime` (2),
    `test_desk_v2_technicals` published copy (4): pins on the published
    store, read from this worktree's `data/macro_radar.db` (Oct 1), not the
    audit's;
  - `test_generations` hold-back: fails alone on the base too here.

  `tests/test_streamlit_backports.py` needs Streamlit and was not run.
- **Web**: `tsc -b` clean; vitest **146 files, 1,822 tests, all passed**;
  `vite build` clean.
- **Desk e2e** (`desk.spec.ts` and `desk-usability.spec.ts`, one worker,
  Vite on 5174 from this worktree, its `mrr-build` stamp checked before each
  run): **83/83 at `ac312b3`**; and 83/83 at `1a684c2` before the review's fixes.
- **Live checks** on 127.0.0.1:8001 (the API section above): the old
  database and the filled one, relay off, no token.

## Deploy sequence

Render deploys only by hand (Auto-Deploy is off, `docs/redesign/DEPLOY.md`
§7); Vercel builds `main` on every push.

1. **Push the branch** (after `PUSH OK desk/cap-weight`):
   ```bash
   cd /Users/maxkomen/Projects/Macro/mrr-cap-weight
   git push -u origin desk/cap-weight
   ```
   Then merge it into `main`, either as a pull request:
   ```bash
   gh pr create --base main --head desk/cap-weight --title "desk/cap-weight: cap-weighted baskets on Basket & Hedge" --body-file docs/desk/CAP_WEIGHT_REPORT.md
   gh pr merge desk/cap-weight --merge
   ```
   or locally, as fix/freshness was:
   ```bash
   cd /Users/maxkomen/Projects/Macro/macro-regime-radar
   git checkout main && git pull --ff-only origin main
   git merge --no-ff desk/cap-weight -m "Merge branch 'desk/cap-weight'"
   git push origin main
   ```
   The push to `main` starts Vercel's build (about 1.5 minutes). If
   desk/pdf-polish merges first, see "Merging with desk/pdf-polish" below.
2. **Render: Manual Deploy → Deploy latest commit.** In the Render
   dashboard, open the API service (`macro-economic-radar-api`), press
   **Manual Deploy** (top right), choose **Deploy latest commit**, and wait
   for the deploy to read **Live** (about 20 minutes). Then:
   ```bash
   curl -s https://macro-economic-radar-api.onrender.com/health/ready | python3 -m json.tool | head -20
   curl -s https://macro-economic-radar-api.onrender.com/api/desk/basket/shares | python3 -m json.tool
   ```
   `/health/ready` reads `"status": "ready"`; `/basket/shares` answers
   `awaiting` with "Awaiting refresh: share counts are not stored in this
   database yet; the next full refresh reads them from Yahoo." (the published
   database predates the table), and its `engine_version` is the merge
   commit's sha.
3. **Trigger the full refresh** so the table fills:
   ```bash
   gh workflow run refresh-data.yml --ref main -f mode=full
   gh run list --workflow=refresh-data.yml --limit 1
   gh run watch "$(gh run list --workflow=refresh-data.yml --limit 1 --json databaseId -q '.[0].databaseId')"
   ```
   (or GitHub → Actions → Refresh Data → **Run workflow**, branch `main`,
   mode `full`). In the run, the **Store share counts** step prints
   `share_counts: ok · Yahoo 10 of 10 · …`; **Validate the refreshed
   database** passes with `share_counts` among the changed tables; **Publish
   validated DB snapshot to data-latest release** uploads.
4. **The API picks the new database up by itself** within 10 minutes
   (`BOOTSTRAP_DB_REFRESH_MIN=10`; no deploy needed). Check:
   ```bash
   curl -s https://macro-economic-radar-api.onrender.com/api/desk/basket/shares | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"], (d["data"] or {}).get("counts_as_of"), len((d["data"] or {}).get("counts", [])))'
   curl -s "https://macro-economic-radar-api.onrender.com/api/desk/basket/price?legs=NVDA,AVGO,AMD,TSM,MU,ANET,VRT,CEG,CRWV,NBIS&weighting=cap" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["weighting"], d["start"], [(l["symbol"], round(l["weight_start"], 4)) for l in d["cap_weights"]["legs"]])'
   ```
   The first prints `ready 2026-… 10`; the second the cap weights at the
   start (EODHD's closes, so within a few hundredths of the table above).
   Then open https://macro-economic-radar.vercel.app/desk/basket-hedge in a
   private window: the preset opens cap-weighted.

What the page shows in between, each state served and said:

| Window | Web | API | Basket & Hedge |
|---|---|---|---|
| After step 1, before step 2 (about 20 minutes) | new | old | `/basket/shares` is answered by the old `/basket/:id` stub, so Cap-weight is unavailable with that stub's sentence ("Baskets are kept in this browser; there is no server basket store."), and the preset is priced at equal weight, as today |
| After step 2, before the refresh publishes | new | new | Cap-weight unavailable, "Awaiting refresh: share counts are not stored in this database yet; …"; the preset priced at equal weight |
| Within 10 minutes of the publish | new | new | the preset cap-weighted |

A browser that already holds the preset desk/books seeded, untouched (never
saved, renamed or edited there), gets cap weight in place on its next visit
(`upgradeSeededPreset`: the entry is the app's own seed, byte for byte, its
`saved_at` the seed's). A preset the analyst has saved or changed is theirs
and stays as saved; Cap-weight is one click and a Save away there.

**Rollback**: `git revert -m 1 <merge-commit-sha> && git push origin main`,
then Render **Manual Deploy → Deploy latest commit**. The `share_counts`
table can stay in the published database: nothing else reads it, and
`validate_db` on the reverted code compares it only as a table.

### Merging with desk/pdf-polish

desk/pdf-polish (`6cd184a0`, also on `001321cd`, unpushed) touches five of
this branch's files. `git merge-tree` of the two heads: three merge cleanly
(`docs/desk/DESK_FRAME3_SPEC.md`, `web/e2e/desk.spec.ts`,
`web/src/screens/desk/positions/PositionMonitorPage.tsx`); two conflict, on
lines both changed:

- `web/src/screens/desk/basket/BasketHedgePage.tsx`: the `../kit/Term`
  import (theirs adds `Term`) beside `./trades` (this branch adds
  `capLabel`): keep both. The weight column's head: theirs wraps "Weight" in
  `<Term ids={["col-weight"]}>`, this branch shows "At start" when
  cap-weighted; keep both, `<Term ids={["col-weight"]}>{capped ? "At start" :
  "Weight"}</Term>` (or a new glossary entry for "At start").
- `web/src/screens/desk/basket/BasketTrades.tsx`: the same import line; and
  the liquidity table's "At target" head: theirs `<Term
  ids={["col-at-target"]}>At target</Term>`, this branch `{p?.weighting ===
  "cap" ? "At cap weight" : "At target"}`; keep both, the label inside the
  `Term`.

## Review

An independent read-only review of `001321cd..1a684c23` (a subagent
reading the diff and the files, no tests run) returned seven findings; all
are fixed in `ac312b3b` but the last, which is the deploy window above.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | medium | Two windows holding answers of different days rewrote each other's cap-weight snapshot on every storage event, without end; an older cached answer could overwrite a newer one; a snapshot without its date could be written and make the basket unreadable | `isNewerSnapshot`: only a well-formed, newer answer (its close, then its counts' read) replaces the stored one; tested |
| 2 | low–medium | Position Monitor recorded a cap-weighted basket at its typed (equal) weights when no answer had been served yet | `recordedLegs` returns null there and Save refuses with the reason; tested |
| 3 | low | Cap-weight reset custom typed weights to equal, and Save made the loss permanent | Cap-weight keeps the typed weights (scaled to 100% only if needed) and is a true toggle; a drop scales, never resets; tested |
| 4 | low | An add while the counts were read said "stays cap-weighted" for any name; an add blamed the new name for another's missing count; a failed counts request flipped the basket to typed weights | An add never changes the weighting; the note is built from the availability and names the right name |
| 5 | low | The start's market value, from the dividend-adjusted close, reads low for dividend payers | Stated in the engine's docstring and in this report (Method) |
| 6 | low | Wording: the workflow's "the step above" now meant the new step; validate_db named the wrong module and counted fewer set-aside rows than the API; a fully set-aside table read "no share count is stored yet"; a set-aside name was refused as having none; the inventory showed the counts as "derived" with no reader; step 3 read "a saved basket at exactly 100% is hedged here" while a cap-weighted basket waited on the counts | Each reworded or aligned; the share-count step moved after the Desk daily series |
| 7 | low | Web before API leaves Cap-weight unavailable with the old stub's sentence for the deploy window | Documented in the deploy sequence (the page stays priced, at equal weight) |

## Decisions taken without asking (the more conservative option each time)

1. **A multi-class company keeps its listed class** (CRWV, NBIS), as the S&P
   and the Nasdaq count only listed shares; Yahoo's all-class market cap is
   named beside it, not used.
2. **The start's market value uses the adjusted close** the index is priced
   from (one share basis across splits); the dividend understatement is
   stated above.
3. **Monthly resets on each month's first session**, as asked; the report
   and the page say it changes nothing with one set of counts.
4. **Liquidity reads today's cap weights** for a cap-weighted basket (the
   basket as it would be bought now), not its weights at the start.
5. **Unavailable means priced at the typed weights**, never unpriced: on an
   old database every route still answers, and the preset reads exactly as
   it did before this branch, with the reason shown.
6. **Counts only for preset constituents**, as asked: a custom ticker
   disables cap weight for its basket. A ticker with a count elsewhere
   (Yahoo has one for SMCI) is not fetched.
7. **The table keeps a name whose fetch failed** (dated by its own read) and
   **removes a name no preset holds**, so the freshness state reads the
   presets only.
8. **Position Monitor records a cap-weighted basket at the cap weights last
   served** (at the last close), kept on the saved basket in place; with
   none served it refuses rather than record the typed weights.
9. **The PROTOTYPE options and Positioning cards size by the weights held**;
   "Event study on this basket" is unchanged (it prints no weight).
10. **The fixtures' share counts are dated Oct 1, 2026, beside closes
    through Sep 23** (the counts are current ones by design), so the label
    in the fixture world reads "as of Oct 1, 2026".
11. **Cap-weight is a toggle that keeps the typed weights**, and **an add
    never changes the weighting** (both from the review): an analyst's custom
    weights survive a look at cap weight, and a custom ticker makes cap
    weight unavailable rather than switching the basket off it.
12. **CLAUDE.md is not edited** (the brief). Suggested lines for its owner:
    under Data Source Rules, "The preset baskets' share counts live in
    `share_counts` (desk/cap-weight): Yahoo's, read by the full refresh's
    'Store share counts' step (`src/market_data/share_counts.py`), checked
    against Yahoo's market cap (ADR units, a multi-class company's listed
    class), advisory in `validate_db`; the API reads them through the worker
    item `desk_share_counts` and never calls Yahoo"; and under the FastAPI
    section, "`/api/desk/basket/price` and `/hedge` take `weighting=cap`;
    `GET /api/desk/basket/shares` (§12.18)".

## Not done, and follow-ups

- The Data Pipeline tab's grouped table does not list the share counts (the
  Data status drawer and `/api/desk/pipeline/inventory` do); adding a group
  means a new store in `/pipeline`'s rows, its fixture regenerated on the
  audit's store, and "Basket & Hedge" in the feeds' tab list.
- Counts for names outside the presets (a basket of any US stock
  cap-weighted) need a provider with fundamentals at request time, or a
  longer stored list.
- Historical share counts (each name's count on the start date, from its
  filings) would remove the "current share counts" approximation.
