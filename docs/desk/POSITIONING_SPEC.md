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
| SEC Form 13F data sets (`www.sec.gov`) | the quarterly flattened 13F filings | US government work; SEC's fair-access policy requires a declared User-Agent with a contact and at most ten requests a second. The contact is a repository variable the owner sets (`SEC_USER_AGENT`), never committed. |

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
  their spreading equal the open interest, and so do the short positions plus spreading. A report that
  fails it, misses a field or holds a number that is not a whole count is not stored; the watermark
  `cftc_cot` counts and names the refusals. (On 2026-11-10 every one of the 5,325 reports passed.)
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

Status: designed; the parser is checked against the SEC's own files once this environment can reach them
with a declared User-Agent (§1). Until then nothing in this section is served: the block awaits.

### 3.1 What a 13F is, and what it is not

Institutional investment managers with at least $100 million in 13(f) securities file Form 13F within 45
days of each calendar quarter's end, listing their long positions in those securities at the quarter's
end. It is a lagged, partial disclosure: no shorts, no positions in securities off the SEC's 13(f) list,
no cash or derivatives other than listed options (which this card leaves out), and some positions are
confidential and filed later. Holders are filers (a parent filing for its subsidiaries counts once).

### 3.2 Dates and amendments

- **Period (`period`):** the quarter end the holdings are as of.
- **Filing deadline:** 45 days after the period. A period is served only after its deadline and after a
  data set covering the deadline has been read, and the card states the newest filing date read.
- **Amendments:** a 13F-HR/A marked RESTATEMENT replaces the filer's earlier report for that period
  (the latest restatement by filing date and accession number wins); one marked NEW HOLDINGS adds its
  positions to the filer's report. Notices (13F-NT) hold no positions. Each served figure counts the
  amendments applied.

### 3.3 Figures (per name, per period)

- `holders`: filers reporting a long position (shares, not principal amounts; no put or call rows).
- `holders_change`: against the previous period, when both are served.
- `top10_share`: the share of the name's 13F-reported shares held by its ten largest holders.
- `large_filers_top10`: of the 100 largest filers by reported long value that period, how many hold the
  name among their ten largest positions.

### 3.4 Identifiers

13F rows name a security by CUSIP and issuer, not ticker. The mapping to a basket's ticker is checked, and
a name it cannot settle reads "no 13F row stored" with why, never a guess. CUSIPs are used during the
run only and are not stored in the published database.

## 4. The route

`GET /api/desk/positioning` (DESK_FRAME3_SPEC §12.20): a worker item (`desk_positioning`), rebuilt with
every generation; no parameters. Two block envelopes, `futures` and `holdings`, so one can await while
the other serves. Nothing depends on "now".
