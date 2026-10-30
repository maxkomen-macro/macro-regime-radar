# Options Finder: the earnings cache

The Finder's earnings dates beyond the 12 tape names, built to the earnings-cache plan (revision 2, decisions D1 to
D6), the capability report's revision 2 (R1 to R5) and the owner's clarifications of 2026-10-29. Code:
`src/events/earnings_cache.py` (the refresh step), `src/events/earnings_store.py` (the vault and the read-time
rules), `api/desk_options.py` (the reader and the display switch), `src/desk/options_finder.py` (the coverage
sentences and flags), `src/events/earnings_ledger.py` (the durable ledger). Tests: `tests/test_earnings_cache.py`,
`tests/test_earnings_store.py`, `tests/test_earnings_ledger.py`, `tests/test_desk_options_earnings_cache.py`.

**What it is not.** Coverage is provider data: Finnhub's dates and fiscal labels for regular quarterly reports,
reconciled with the quarters Finnhub shows as reported. It is never company confirmation, and unscheduled earnings
updates (pre-announcements, restatements) are not covered. Wherever the rules below cannot establish a state, the
answer is "earnings dates unknown", which never passes as no earnings, never removes the unknown flag and never
supports an implied move.

## The refresh step

`python -m src.events.earnings_cache` runs in full refresh mode (`refresh-data.yml`, "Load earnings cache (Options
Finder)", after the dashboard's earnings step and the news feed, before validation; `continue-on-error`, 10-minute
timeout). It prints one summary line of counts, never a symbol, date, key or URL, and exits 0 on every end.

One run asks Finnhub's whole-market `/calendar/earnings` for 7-day windows over days 0 to 119 (18 calls), then the
lookback week before today. A reply of 1,000 rows or more is split in halves, recursively; the observed reply cap is
1,500 rows, so a single day at the cap is recorded as capped (incomplete). Each split is checked against its parent
row for row: symbol, date, release time, fiscal label, the actual EPS and revenue figures, and how many times each
row appears.

Run outcomes, worst first: failed (no reply), inconsistent (a malformed reply or row, a split that does not match its
parent, or a dashboard row for one of the 12 tape names missing from the reply covering its day, or nothing to
compare), partial (stopped early, capped, or an incomplete covered day), passing.

Safeguards (each ends the run with a skip, never a call): only a scheduled full-mode run on its first attempt within
12 hours of its cron slot calls Finnhub from GitHub Actions; never in weekday 09:00 to 17:00 New York hours (checked
before every call); 10 hours since the last passing run; 60 s since the last call; 6 s between calls (12 s for 24
hours after a 429); at most 40 calls a run and 80 a UTC day; no call on a UTC date after the run's start; no call
started after 8 minutes, each call bounded to 15 s and the run to 8 minutes 45 s; a reply body over 4 MB is dropped.
The run's 40-call reservation is uploaded to the ledger before the first call.

## The durable ledger (Amendment A-1, 2026-10-30)

The vault in the database persists only when the refresh publishes its database, so the run's call accounting also
lives in a durable ledger on the `data-latest` release (`src/events/earnings_ledger.py`): immutable, sequenced assets
`earnings-cache-ledger-<9-digit seq>.bin`, each a sealed copy of the vault (the same key, ciphertext only). A write
uploads a new asset under a new name, never replacing one; only after that upload succeeds are ledger assets other
than the two newest deleted, so a failed write never removes the last state that reached the release.

Three workflow steps, full mode only, each `continue-on-error` and bounded, with only the built-in `GITHUB_TOKEN`:
"Fetch earnings cache ledger" (2 minutes, just before the cache step) lists and downloads the newest two assets;
the cache step uploads a reservation before its first call and its final state after its last; "Publish earnings
cache ledger" (2 minutes, `if: always()`, after the database publish) uploads a final state the cache step could not,
whether validation failed, the publish failed or the job was cancelled. The database's upload stays gated on
validation exactly as before.

- **Start state.** The higher seq of the newest asset that opens and the vault table. Every write is numbered above
  every listed asset and the table, so a recovery is always the newest state.
- **Reservation.** Before the first call: 40 calls charged, a 429 assumed, finished at the latest moment the run can
  still be calling (start plus the step's 10 minutes), and every day it plans to ask provisionally withdrawn. If it
  cannot be uploaded, the run makes no call. The final write replaces it with the exact record.
- **No allowance, no call.** The ledger cannot be listed or downloaded, or an asset's name is not in sequence form:
  the run skips and writes nothing.
- **Conservative restart.** The newest asset does not open (key, decryption, format or sequence), the two copies
  disagree at the same seq, or the ledger is gone while the table shows it existed: the run records 80 calls for the
  UTC day with a 429, withdraws every day it covers at that moment, and makes no call. Uncertain accounting is never
  reset to zero: the daily cap, the 24-hour slow pace and the 10-hour spacing all hold, and every day stays unknown
  until two passing reads newer than the restart.
- **Spacing and the 429 pace** count passing runs, reservations still in place and restart records.
- **Out of reach.** Only a person deleting every ledger asset by hand, alongside a vault table from before the
  ledger existed, can look like a first run.

**The reader.** The Finder reads only the published database, never the ledger and never Finnhub. A contradiction
seen by a run whose refresh is not published reaches it at the first of: a later published database whose vault
carries it (the next run that reads the ledger writes it into the vault table), or the older snapshot's own freshness
limit, 48 hours after its newest read. Until then the Finder can show coverage from that snapshot; closing the gap
needs the API to read the ledger, which is the owner's decision, and the display stays off until it is settled. A
reservation's provisional withdrawals in a published vault count once the reservation is 15 minutes old.

## The vault

One row of `earnings_cache_vault`: AES-256-GCM over the compressed JSON, keyed through HKDF-SHA256 from
`EARNINGS_CACHE_KEY`, so the public `data-latest` database carries ciphertext only (D5). It keeps the runs, the newest
two covering entries for each New York day, and every (symbol, date) any reply listed, with the fiscal labels seen and
the labels a passing run saw with actual figures (with the run that first saw each, its fiscal identity and
reporting date: an anchor a passing run saw reported is kept, never inferred from a scheduled or estimated report),
and, for each day a request asked for and got no answer, when.
A new key starts a new vault; the same key that cannot open the blob leaves it untouched. The validator publishes a
full run when the vault's keyed `content_digest` changes (`scripts/validate_db.py`): it covers the observations, the
unanswered requests and every run that charged a call (its calls, status and any 429), not a zero-call skip. A vault
that cannot be read only warns.

The validator's whole change (Amendment A-1, exception X1): `earnings_cache_vault` added to `MODE_TABLES["full"]`, and
one `ADVISORY_FINGERPRINT_SQL` entry, `SELECT key_id, content_digest FROM earnings_cache_vault ORDER BY id`. Every
other check is unchanged. A full run whose only change is the vault therefore publishes when validation passes, which
also fires the existing Vercel deploy step (an occasional extra publish and deploy the owner accepted). The ledger
assets are not part of validation.

## The read-time rules

- A day is stable when its two newest covering entries are both from passing runs and complete, the newer under 48
  hours old and the two at most 48 hours apart. A newer entry that is not passing, or a newer request for the day
  that got no answer (a failed call, a 429, a time limit), withdraws the day until two reads newer than that request
  are stable again. D is the last day of the unbroken stable stretch from the session.
- A listing is stable when its day is stable and both entries list the symbol once with the same valid label.
- A listing the newest entry no longer shows is a possible report until its date passes, its quarter is seen
  reported on another date, or the same quarter is stable on another date (then shown as moved).
- Coverage is reconciled through K only along a chain from the latest quarter a passing run saw reported, dated on
  or before the session: each link the next fiscal quarter (Q4 rolls to Q1 of the next year), stable, on or after
  the session and on or before D, with no other listed or possible report and no hand-maintained row between links.
  K is the last link with no other report from the session through it. Any doubt about the anchor (a changed label,
  one quarter on two dates, an earlier quarter listed later) leaves it unknown.

States the Finder shows: reconciled (through K), listed (dates shown, not reconciled), unlisted (no listing through
D), unconfirmed (no stable session day: contested when the session's newest read failed its checks or a newer request
for it got no answer, else unread),
and withheld (the display switch off).

## The display switch

`FINDER_EARNINGS_DISPLAY` on the API host, off unless `1`, `true`, `on` or `yes`. Off (the shipped default, D6): the
Finder shows the hand-maintained earnings rows only and says Finnhub's dates are not shown; it no longer shows the 12
stored Finnhub dates. On with the vault open: the rules above. On without it (no key, a rotated key, no vault): the
stored rows, as before the cache. The route sends no Finnhub request in any state. Turning it on waits for Finnhub's
written approval and the owner's release decision.

## Going live (the owner's steps)

1. Add `EARNINGS_CACHE_KEY` (a long random string) as a GitHub Actions secret. Without it the step skips.
2. Deploy the API on Render by hand, with the same `EARNINGS_CACHE_KEY` in its environment, so the worker can open
   the vault. Nothing reaches the public while the display switch is off.
3. After Finnhub's written approval and the release decision, set `FINDER_EARNINGS_DISPLAY=1` on Render.

`python -m src.events.earnings_cache --report --db <copy>` prints the vault's counts per state (needs the key).
