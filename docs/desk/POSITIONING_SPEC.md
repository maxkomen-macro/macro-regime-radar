# Positioning from public filings (P4): method spec

Status: written before the served card, as the Desk real-data plan requires (P4; D0 and D7 approvals,
`desk-upgrade/APPROVED.md`). It replaces the PROTOTYPE card "Positioning" on Basket & Hedge
(DESK_FRAME3_SPEC §10) with two lagged public disclosures: the CFTC's weekly Commitments of Traders
for five macro futures, and SEC Form 13F holder concentration for basket names. D7: "CFTC and SEC 13F
first. Defer FINRA integration until dataset-specific permission is established. Preserve observation
and publication/filing dates, handle amendments, and label these as lagged disclosures rather than
live positioning."

What the prototype showed and this card does not: short interest and days to cover (FINRA, deferred
by D7), the put/call open-interest ratio (OCC, not in D7's scope) and a crowding flag. No crowding
verdict is drawn from either disclosure: the card reports positions and where they sit in their own
history, and says what they are not.

## 1. Sources and rights

| Source | What is read | Rights (evidence) |
|---|---|---|
| CFTC Commitments of Traders, Public Reporting Environment (`publicreporting.cftc.gov`, Socrata, no key) | Traders in Financial Futures, futures only (dataset `gpe5-46if`); Disaggregated, futures only (`72hh-3qpy`) | US government work in the public domain. cftc.gov Web Policy, "Copyright": "Government information at the CFTC website is in the public domain. Public domain information may be freely distributed and copied, but it is requested that in any subsequent use the CFTC be given appropriate acknowledgement." The card credits the CFTC. |
| CFTC COT release schedule (cftc.gov) | the 2026 release dates, copied into `src/market_data/cot_schedule.py` | as above |
| SEC Form 13F data sets (`www.sec.gov`, "Form 13F Data Sets") | the flattened 13F filings, one zip per three months of filing dates | US government work. The SEC's fair-access policy asks automated clients to declare a User-Agent with a contact and to stay under ten requests a second. The contact is a repository secret the owner sets (`SEC_USER_AGENT`): a secret, not a variable, because the public run log prints a variable and masks a secret. It is never committed, printed or stored; a value holding a control character (a line break or tab), which no request header can carry, is refused before any request in words that never quote it. |
| SEC fails-to-deliver data (`www.sec.gov`, "Fails-to-Deliver Data") | the half-month files' ticker, CUSIP and issuer description, to pair a ticker with its CUSIP | as above |

Source copies read for this spec are kept with the project's records (`desk-upgrade/p4-positioning/`).

## 2. CFTC futures positioning

### 2.1 Markets and categories

| Key | Market | CFTC contract (code) | Report | Category the card leads with |
|---|---|---|---|---|
| `spx` | S&P 500 E-mini, CME | 13874A | Traders in Financial Futures | Leveraged funds |
| `ust10y` | 10-year T-note, CBOT | 043602 | Traders in Financial Futures | Leveraged funds |
| `usd` | US dollar index, ICE US | 098662 | Traders in Financial Futures | Leveraged funds |
| `gold` | Gold, COMEX | 088691 | Disaggregated | Managed money |
| `wti` | WTI crude (physical), NYMEX | 067651 | Disaggregated | Managed money |

The lead category is each report's speculative one: leveraged funds (hedge funds, CTAs, proprietary
traders) in the financial report, managed money in the disaggregated one. Every other category is
served beside it (Advanced). Futures only: options positions are not added in. The market names change
over the history (for example "E-MINI S&P 500 STOCK INDEX" became "E-MINI S&P 500"); the contract code
does not, and each stored report keeps the name the CFTC gave it that week.

### 2.2 Storage

`src/market_data/cot.py`, one full-refresh step, stdlib only. Each run reads the five markets' whole
history (two requests; about 1,065 weekly reports per market since 2006-06-13) and writes the additive
table `cot_positions`, one row per (report, contract, positions date, category): long, short and
spreading contracts, the market's open interest, the market name, the CFTC's row id, the provider
(`CFTC`), the run that last wrote the numbers, and when the store first and last wrote them.

- **The CFTC's identity is checked before a report is stored:** the categories' long positions plus
  their spreading equal the open interest, and so do the short positions plus spreading. A row that
  fails it, misses a field or holds a number that is not a whole count is refused. Because a refused row
  may be a stored report's replacement, a run that refuses any row of a CFTC report (TFF or
  Disaggregated) writes nothing for that report's markets: the stored rows stay, none is marked
  withdrawn, and the watermark `cftc_cot` (status `partial`, or `error` while a market has no stored
  report) counts and names the refusals (Codex S-1). (On 2026-11-10 every one of the 5,325 reports passed.)
- **Amendments.** The CFTC occasionally corrects a published report. Because every run reads the whole
  history, a correction is seen: a stored row whose numbers change keeps its old numbers in
  `cot_revisions` (old and new numbers, the runs that wrote each, and when the store read the change),
  and the row takes the new numbers. A stored report the CFTC no longer serves, in a read that served
  that market, is marked `withdrawn_at` and kept; one served again is restored. Nothing is deleted.
- **Runs.** Each run is a row of `positioning_runs` (started, then committed when it wrote anything, or
  failed). The reader reads a row only when its run committed.
- **Never fails the refresh.** A failed read keeps what is stored, records the watermark (status `ok`,
  `partial` or `error`, reasons in the detail) and exits 0; `validate_db` warns, never blocks.

### 2.3 Dates

- **Positions date (`as_of`):** the date the CFTC states the positions as of, usually a Tuesday (a
  Monday or Wednesday in 14 of the history's weeks, around holidays).
- **Release date (`released`):** read from the CFTC's published schedule (`cot_schedule.py`, copied from
  the CFTC's page on 2026-11-10; the CFTC calls it tentative): the first scheduled release after the
  positions date, within ten days. Releases are at 3:30 p.m. ET; a date the CFTC marks delayed by a
  federal holiday says so. The served data carry no release date of their own, so nothing is inferred
  where the schedule is silent: a report outside the schedule (before 2026, or after its last date,
  2026-12-28) has `released` null with the words "release date not on the CFTC schedule this store
  holds". The schedule is also checked against the store: a scheduled date after the day the store first
  held the report is refused (null, with both dates), because the CFTC evidently released it earlier.
- **First stored (`first_stored_at`):** when this store first held the report, UTC.
- **Point-in-time:** no figure for a report reads a report dated after it, and a report dated after the
  day the store first held it is set aside. The card prints each market's positions date and release
  beside its numbers, and the lag note: "Lagged disclosure, not live positioning: each report states
  positions as of a Tuesday and is released the following Friday, later in a holiday week."

### 2.4 What is served per market

From the market's readable reports (§2.5), the newest one:

- `long`, `short`, `spread` of the lead category; `net` = long − short (contracts); `open_interest`;
  `net_pct_oi` = 100 × net / open interest (percent of open interest; spreading counts on both sides of
  open interest and in neither side of net).
- `change_1w`: `net` and `net_pct_oi` minus the previous readable report's, when that report is 6 to
  8 days earlier (the CFTC's previous weekly report; holiday weeks shift it). Otherwise null, with why.
- `range_3y`: where `net_pct_oi` sits among the market's readable reports in the three calendar years
  ending at the report (dated after the same day three years earlier, through the report): `percentile`
  = 100 × (the number of those reports whose `net_pct_oi` is at or below this one) / their count, so the
  highest reads 100 and the lowest 100/n; with the window's count, its first and last dates, and its
  minimum and maximum with their dates. Null, with why, when fewer than 150 reports are in the window
  (156 or 157 are expected). Percent of open interest, not contracts, so the comparison holds as a
  market's open interest grows. No threshold turns it into a word.
- `categories[]`: every category's long, short, spreading, net and net share of open interest.
- `series[]`: the lead category's net and net share of open interest for every readable report in the
  same three years, for a chart.
- the dates of §2.3, `history_from` and the count of readable reports, and `excluded[]`.

### 2.5 Reading a stored report

A report is read only when every one of its rows: was written by a committed run, is not withdrawn,
belongs to a report holding exactly its report's categories (five), agrees on one open interest,
holds whole non-negative counts, satisfies the identity of §2.2, and carries a positions date no later
than the day the store first held it. Any other report is set aside, listed in its market's
`excluded[]` with why, and enters no figure, no change and no window. A market with no readable report
is listed in `missing[]` with why; with no readable report at all the block awaits.

### 2.6 Independent reference check (plan gate 3)

`scripts/check_cot_reference.py` compares every stored number with the other product the CFTC publishes
for the same reports, the yearly compressed text files of its historical archive (`fut_fin_txt_<year>.zip`,
`fut_disagg_txt_<year>.zip`, and `fin_fut_txt_2006_2016.zip` / `fut_disagg_txt_hist_2006_2016.zip` before
2017). The tolerance, fixed before the first run, is zero contracts: both are the CFTC's, and positions are
whole numbers. A report in one and not the other is a difference, except reports after the archive's
newest. First run, 2026-11-10, on a store built from the API that day: every report of all five markets
from 2006-06-13 to 2026-11-03 matched, 1,065 per market, every category and the open interest.

## 3. SEC Form 13F holder concentration

`src/market_data/sec_13f.py`, in the same full-refresh step as §2 (`src/market_data/positioning.py`), stdlib only.

### 3.1 What a 13F is, and what it is not

Institutional investment managers with at least $100 million in 13(f) securities file Form 13F within 45
days of each calendar quarter's end, listing their long positions in those securities at the quarter's
end. It is a lagged, partial disclosure: no shorts, no positions in securities off the SEC's 13(f) list,
no cash or derivatives other than listed options (which this card leaves out), and some positions are
confidential and filed later. Holders are filers (a parent filing for its subsidiaries counts once; two
filers reporting a shared position each count it).

### 3.2 What is read

The SEC's page lists the data sets by filing-date window (`01jun2026-31aug2026_form13f.zip`; the
quarterly-named sets before 2024 are not read). A run reads:

- **The quarter (`period`):** the newest quarter end whose filing deadline (45 days after it) the newest
  data set's window reaches, and the quarter before it (`previous_period`), for the change.
- **The data sets:** every one whose window ends after the earlier quarter's end; their windows must run
  on without a gap from the day after it, or the run is refused. Their newest date is `filings_through`.
- **The filings:** the holdings reports (`13F-HR`) and amendments (`13F-HR/A`) for the two quarters, by
  `SUBMISSION.tsv` and `COVERPAGE.tsv`; notices (`13F-NT`) hold no positions. Positions are
  `INFOTABLE.tsv` rows in shares (`SSHPRNAMTTYPE` = `SH`) with no put or call.
- **A row that cannot be read refuses the run** (Codex S-2): a row of any of the three tables with too
  few fields, a holdings report or amendment with no readable period or filing date, or a counted
  filing's share row with no readable CUSIP, share count or value. Leaving it out would publish a
  quarter short of a holder or a position as if it were whole, so nothing is replaced and the watermark
  names the data set, the table and the line. (The real files read on 2026-11-10, 7.65 million holdings
  rows, held none.)
- **A data set of another shape** (a missing table or column) refuses the run: nothing is replaced.
- **Unchanged inputs:** a run whose needed data sets and method (`METHOD`) are the ones the stored quarter
  was computed from reads only the index page. The data sets change about once a quarter. A change to
  the reading rules moves `METHOD` (`13f-2` since the refusals of §3.2, §3.3 and §3.5), so a quarter an
  earlier method accepted is read again under the new rules, never kept because its inputs are unchanged.

### 3.3 Dates and amendments

- **Period (`period`):** the quarter end the holdings are as of. **Deadline:** 45 days after it. A quarter
  is served only when the filings read reach its deadline; the card prints the period, the deadline and
  `filings_through`. Late filings and amendments filed after `filings_through` are not read until a later
  data set holds them; the quarter is then recomputed, and the count of tickers whose figures changed is
  kept (`revised_names`).
- **Amendments:** per filer and quarter, the filings are ordered by filing date and accession number. The
  latest original or RESTATEMENT amendment is the report; NEW HOLDINGS amendments filed after it add their
  positions; NEW HOLDINGS filed before a restatement are part of what it restates. The type is read from
  each filing's `COVERPAGE.tsv` row. A holdings report or amendment with no cover row, or an amendment of
  no stated type, refuses the run (Codex S-3): were it a restatement, leaving it out would publish the
  numbers it replaced. (The real files read on 2026-11-10 hold neither.) The block counts the
  restatements applied and the new-holdings amendments added.

### 3.4 Figures (per ticker, per quarter)

- `holders`: filers reporting a long position in the ticker's shares.
- `holders_change`: `holders` minus the previous quarter's, when both are stored (else null, with why).
- `shares`: the shares those filers report; `top10_share`: the share of them held by the ten largest
  holders (a fraction).
- `large_filers_top10`: of the 100 filers with the largest reported long value that quarter, how many
  hold the ticker among their ten largest positions. Each position is valued at the quarter's median
  reported price per share of its CUSIP (each filer's own value over its own shares, the median across
  filers), so a filer that writes its values in the wrong unit moves neither its own rank nor anyone
  else's. Ties are broken by CIK and CUSIP.
- No threshold turns a figure into a word ("crowded", "concentrated").

### 3.5 Identifiers

13F rows name a security by CUSIP and issuer, not ticker. The SEC's own fails-to-deliver files (the newest
six half-month files) pair each ticker with a CUSIP and an issuer description. A ticker is mapped to the
CUSIP of its newest fails record, and only when the first word of that record's description agrees with
the first word of the issuer name 13F filers give the CUSIP most often (equal, or the shorter, of three
letters or more, begins the longer: the files abbreviate FED for FEDERAL). A ticker the files pair with
two CUSIPs on its newest date, or whose names disagree, is stored as refused with why; one with no
pairing, or whose CUSIP no filer reports, reads "no 13F row stored: …". Each fails file must be whole:
its trailer ("Trailer record count N") must count the records read, and a record that names a ticker
must carry a readable CUSIP and settlement date (a record with no ticker, a bond say, is passed over);
otherwise, or when the files pair no ticker at all, the run is refused. Tickers are compared without
punctuation (BRK.B and BRKB are one). CUSIPs are used during the run only and are not stored in the
published database.

### 3.6 Storage and failure

`holdings_13f_periods` (one row per quarter: its dates, the data sets and fails files read, the counts,
the method and the run), `holdings_13f` (per ticker key and quarter: the ticker as the fails file writes
it, the issuer name and the figures of §3.4) and `holdings_13f_refused` (per ticker key and quarter, why).
Each run is a `positioning_runs` row (§2.2); the reader reads only a committed run's quarter. The two
quarters are replaced in one transaction, made only when the whole read and computation succeeded: a
failed request, a refusal (HTTP 403, never retried), a data set of another shape, an unreadable row or
fails file (§3.2, §3.5), a quarter read with no filer or no ticker, or a run past its time budget (inside the workflow step's ten minutes) keeps what is stored and records the watermark `sec_13f`
(status `error`, the reason in the detail). Without the contact the step reads nothing and says so. The
step exits 0; `validate_db` warns, never blocks.

### 3.7 Independent reference check (plan gate 3)

`scripts/check_13f_reference.py` compares, for a sample of the quarter's counted filings (the ten with the
largest reported table value, ten amendments and twenty drawn with seed 20261110), the data set's long
positions in shares with the information table the manager filed on EDGAR, CUSIP by CUSIP, at zero
tolerance; and it recomputes `holders`, `shares` and the ten largest holders' shares of named tickers by a
second reading of the data set without the step's SQL (it shares the step's file reader and amendment
rule). First run, 2026-11-10, quarter 2026-06-30 from the Mar–May and Jun–Aug 2026 data sets: all 40
filings matched share for share (5,455 positions in the largest), and the 14 tickers checked matched in
both quarters.

## 4. The route

`GET /api/desk/positioning` (DESK_FRAME3_SPEC §12.20): a worker item (`desk_positioning`), rebuilt with
every generation. Two block envelopes, `futures` and `holdings`, so one can await while the other serves.
One parameter, `names=TICKER,…` (at most 25 US tickers, each once): the names whose 13F rows the holdings
block serves, in that order; without it the block serves the quarter and no names. Nothing depends on
"now".
