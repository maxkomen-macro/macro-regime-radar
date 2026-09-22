# Final release readiness — Macro Regime Radar React/FastAPI build

Date: 2026-09-06 (build session on branch `react-rebuild`, all work uncommitted).
Owner: Max. Author: the build session (implementation worker + orchestrator), with two
independent reviewers (visual/UX; technical/accessibility/data-pipeline) whose reports
sit in `proposals/release_readiness_evidence/review-visual/REPORT.md` and
`review-technical/REPORT.md`.

**Verdict: locally ready to publish, with owner-dependent publication gates outstanding
(section 12).** Nothing was committed, pushed, merged, deployed or dispatched; no
Release asset was written; no hosting resource, payment method or trial was created; no
secret was created, transferred, printed or hard-coded.

## 1. Provider hierarchy (built and verified)

| Dataset | Primary | Fallback | Verified 2026-09-06 |
|---|---|---|---|
| Live US equity / ETF quotes | EODHD WebSocket relay (`api/stream.py`) | latest validated stored close (tape) | feeds `us/crypto/forex` open at startup; VIX REST poll `rest` |
| VIX / delayed quotes | EODHD REST real-time (15–20 min) | stored close | `/api/market/profile/BRK.B` → `quote_provider: eodhd`, `market_ts` 2026-09-04T20:27Z |
| Daily candles | EODHD EOD (`period=d/w/m`, adjusted by `adjusted_close/close`) | yfinance (disclosed) | `/api/market/candles/AMZN?range=6M` → `provider: eodhd`, 126 bars |
| Intraday candles | EODHD intraday (5m/1h) | yfinance (disclosed) | BTC-USD 1D on-demand in the browser |
| Symbol search | EODHD search | yfinance (disclosed) | `nvidia` → NVDA/NVDX/NVDQ (US first) |
| Splits / dividends | EODHD | yfinance | unit-tested (`tests/test_providers.py`) |
| Exchange metadata | EODHD exchange-details | built-in NYSE calendar | probe `ok` |
| Fundamentals | EODHD **only if entitled** → not entitled (403) | yfinance, labeled | BRK.B/AMZN `fundamentals_provider: yfinance` |
| Options | EODHD marketplace, end-of-day, entitled | explicit unavailable state | AAPL expirations + AMZN chain paged in the browser |
| Ticks | EODHD only, bounded, **not entitled** (403) | none | `/api/market/ticks/AAPL` → 403 `kind: unauthorized` |
| Macro series | FRED (pipeline) | none | unchanged |
| News | existing pipeline | stored feed | unchanged (classifier rewritten) |

Entitlement probe (`/api/providers/status`, one bounded call per family at startup,
cached 6 h, refreshed by live results): historical ✓, intraday ✓, realtime ✓, search ✓,
splits_dividends ✓, exchange_details ✓, options ✓, fundamentals ✗ 403, ticks ✗ 403,
websocket = verified by the relay feed state. The token never appears in any response,
log line (`api/logsafe.py`), error body or snapshot.

Symbol normalization (`api/providers/symbols.py`, `tests/test_symbols.py`): AMZN, AAPL,
NVDA, MSFT, JPM, BRK.B/BRK-B → `BRK-B.US` / `BRK-B`, SPY, QQQ, BTC-USD → `BTC-USD.CC`,
EURUSD → `EURUSD.FOREX` / `EURUSD=X`, VIX/^VIX → `VIX.INDX` / `^VIX`. Yahoo syntax is
never sent to EODHD and vice versa (asserted by the mock transport).

## 2. Freshness (source-aware, verified against the synced snapshot)

`/api/freshness` on 2026-09-06 03:3x UTC after `make sync-data` (Release asset updated
2026-09-06T02:53Z):

| Feed | Latest | Verdict | Reason |
|---|---|---|---|
| market_daily | 2026-09-04 | current | last completed session stored |
| market_intraday | 2026-09-04 15:55 ET | current | closing bar of the last session |
| news | 2026-09-05T23:55Z | current | inside the off-hours 6 h window |
| fred:DGS10 / DGS2 / VIXCLS | 2026-09-01 | **delayed** | 3 business days behind — a FRED-fetch lag in the pipeline to watch on the next full refresh |
| fred:INDPRO / CPIAUCSL | 2026-07-01 | current | July is the latest print due |
| fred:UNRATE | 2026-08-01 | current | August print stored |
| regime | 2026-07-01 | current | latest complete common feature month |
| live_quotes | — | delayed | US session closed (weekend); crypto/FX feeds live |

**Why the regime is still July:** August industrial production (INDPRO, due ~Sep 16) and
August CPI (CPIAUCSL, due ~Sep 11) are not yet published; the report names both under
`regime.blockers` with cause `publication calendar`. It is not a pipeline fault.

SLA rules live in `api/freshness.py` (NYSE calendar 2024–2027 with early closes in
`api/calendar.py`) and are reused by `scripts/validate_db.py`.

## 3. GitHub Actions (rewritten, actionlint-clean, tested)

Audit of the existing history (7+ days, via the run list before this pass): full
refreshes ran about twice a day but were delayed 2–4 h by GitHub's cron lag; the hourly
run skipped the heavy steps by a fragile string comparison; both memo workflows used the
forbidden `git stash` / `pull --rebase` pattern; the weekly memo's last run failed at
"Generate weekly memo" (2026-08-31).

Now: `refresh-data.yml` has explicit modes (`full` 11:17 UTC daily and 00:23 UTC
Tue–Sat; `news-only` hourly at :41; `market-only`; `verify-only`) resolved by
`scripts/workflow_mode.py` (unknown cron → `verify-only`); lean dependency sets
(`requirements-news.txt`, `requirements-market.txt`); the previous asset kept as
`data/previous.db`; `scripts/validate_db.py` after every refresh (integrity_check,
required tables, row counts and max dates, no max-date regression, no core-table row
loss, source labels, mode-scoped SLA verdicts, GitHub Step Summary); upload only on
`pass` + changed (last-known-good otherwise); a `validated-db` run artifact for the memo
workflows, which now trigger on `workflow_run`, gate on the artifact's `mode=full`,
morning slot and weekday/Monday, and commit with the retry / soft-reset loop.
`intraday-refresh.yml` keeps the `data-write` concurrency group and validates before
upload. The DB is never committed. `tests/test_workflows.py` (20 tests) and
`tests/test_validate_db.py` (8) pin all of this.

Not run: no workflow was dispatched. The owner should dispatch `verify-only` first.

## 4. Zero-cost availability (verified with FastAPI stopped)

`scripts/build_snapshot.py` → `web/public/snapshot/latest.json` (20 endpoints,
359 KB, secret-shape scan) seeds the query cache before first paint. With the API
stopped: the dashboard painted the regime, signals and freshness line under the status
word **Validated snapshot · Sep 06, 2026**; Methodology readable; News rendered the
seeded window; Markets rendered the tape shell with unavailable notes; no blank page
and no infinite spinner at 1440 and 390; a 60-second idle produced 6 console errors,
all the expected relay/proxy connection failures (a 30-minute idle was not run in real
time; reconnect backoff is bounded at 30 s). After restart the word returned to
**Live · crypto only · US session closed** without a reload.

Host research and the honest limit ("no compliant free host guarantees a continuous
WebSocket relay") are in `docs/redesign/DEPLOY.md` §4. No keepalive was built.

## 5. Security gates (built, tested, curl-verified)

`api/security.py` (pure ASGI): 64 KB body cap (16 KB assistant); 600 req/min per client
and 4000/min global (env-tunable) with `Retry-After`; assistant `ASSISTANT_ACCESS`
off/key/open (off by default whenever `CORS_ORIGINS` is set; 10 req/min; `no-store`);
concurrency ceilings (4 calculators, 12 provider calls); security headers on every
response; CSP on the served shell; typed sanitized provider errors and a generic 500
handler; symbol/range/pagination/expiration/strike/tick-window validation; the read-only
SQL guard untouched. `api/logsafe.py` fixed a real leak: httpx was logging full EODHD
URLs (with the token) at INFO.

## 6. UI work verified in the browser (Playwright, 1440 unless noted)

- Command Palette: Enter navigates once to `/app/credit`, closes, focus returns to the
  ⌘K trigger without reactivating it (regression test `CommandPalette.test.tsx`).
- Regime Lab: five views in one row at 768, wrapped at 390, Empirical evidence reachable
  (`SubTabs.test.tsx`).
- News classifier: "China challenges Korean champions in flash memory race" → SECTOR;
  26 classification tests.
- Allocation: "21 of 28 Goldilocks months have complete returns across all ten assets;
  24 are required." (engine → API → types → UI; tests on both sides).
- LBO cold load: "Calculating the deal model…" then the result; never "Nothing on file".
- Release polish: React Router future flags, favicon files, divergence copy replaced,
  status word replaces redundant freshness copy, route-level code splitting
  (index 85 KB, vendor-react 162 KB, vendor-charts 172 KB, screens 15–48 KB, the
  design-kit route in its own 15 KB chunk), 1520 px frame preserved.
- Markets: AMZN/BRK.B/BTC-USD/unknown-symbol states, Options lens, provider labels.
- Rapid switching: picking AMZN → AAPL → NVDA in under a second leaves the panel on
  NVDA with "Requesting 6M history for NVDA…" and no other symbol's bars, then NVDA's
  own caption and regime fit. Two regressions were found and fixed on the way: the
  search list offered the previous query's hits while the new query loaded (Enter then
  picked a symbol the reader never typed), and a disabled share-class alias query kept
  stale placeholder hits. Both are pinned in `SymbolSearch.test.tsx`.

## 7. Test evidence

- Python: `EODHD_PROBE_ON_START=0 .venv/bin/python -m pytest tests --ignore=tests/test_streamlit_backports.py` → **287 passed** (after the correction pass); `tests/test_streamlit_backports.py` → 7 passed under `/opt/anaconda3/bin/python` (needs Streamlit).
- Frontend: `npm run typecheck` clean; `npx vitest run` → **31 passed** (12 files); `npm run build` clean with route chunks.
- Workflows: `actionlint` clean.
- Live smoke calls (bounded): candles AMZN, profile BRK.B, search, options expirations, ticks (403 expected).

## 8. Evidence

`proposals/release_readiness_evidence/` — `before/` and `after/` (40 captures each; the
`after/` matrix was re-captured on the corrected build after both review passes,
`report.json`: zero horizontal overflow at 390/768/1440/2160), interaction captures
`after/after-*.png` (including `after-fix-*` after the corrections), both reviewer
reports with their captures, the detector outputs, and a `README.md` index.

## 9. Independent review reconciliation

### 9a. Technical / accessibility / data-pipeline review (opus, read-only, report at `review-technical/REPORT.md`)

The review ran the suites (green), then found one P0, three P1s, four P2s and 23 P3s.
Every P0–P2 and the material P3s were fixed in one bounded correction pass; the rest
are recorded here with a reason.

| Finding | Action |
|---|---|
| **P0-1** per-request SQLite open/close churn deadlocked the worker pool under a burst (39 threads in the unix-VFS mutex; `/health/live` kept answering) | Fixed: `api/db.py` reuses one read-only connection per worker thread, reopening only when the file underneath changes; new `DB_MAX_CONCURRENCY` ceiling (16) sheds excess stored-data reads as 429; per-client burst capped at 120 and global burst at 600; Docker `--limit-concurrency 64`; docs point the host probe at `/health/ready`. `tests/test_concurrency.py` fires 240 concurrent requests and requires completion with only 200/429. |
| **P1-1** `q` in `/api/market/search` reached the EODHD URL path unencoded (`../user` escaped the segment with the server's token) | Fixed: every provider URL segment is percent-encoded (`_seg`), and free text rejects `/ \ ? # %` and control characters (422). |
| **P1-2** `TRUST_X_FORWARDED_FOR` read the spoofable left-most entry | Fixed: `TRUSTED_PROXY_HOPS` reads the entry that many places from the right (default 0 = socket peer); the old flag is an alias for one hop; tests cover spoofing and short headers. |
| **P1-3** the WebSocket bypassed every gate; `watch` cycling bought paid REST seeds | Fixed: per-client (4) and total (100) socket caps in the middleware; 30 messages/min and 40 new symbols/h per connection; dynamic seeds share the provider token bucket. |
| **P2-1** non-US search hits did not round-trip (`AAPL.BA` → `AAPL.BA.US`, mislabeled fallback) | Fixed: any 2–6 letter exchange suffix parses; unmapped exchanges carry no yfinance fallback rather than a wrong one; Yahoo syntax can no longer become an equity code; round-trip tests added. |
| **P2-2** `signals` could never read "stale" | Fixed: month-based verdict mirroring the regime row; test added. |
| **P2-3** future-dated stamps read "current" and passed the gate | Fixed: stamps beyond now+2 days are `unavailable` in the report; the validator fails on future max dates, on an unusable baseline, and on probabilities outside [0,1] or non-positive closes. |
| **P2-4** jargon tooltips failed WCAG 1.4.13 | Fixed: a real `role="tooltip"` element, hoverable, pinnable, Escape-dismissible, referenced by `aria-describedby`; test added. |
| P3 intraday cron UTC-fixed across DST; redundant entry | Fixed: `2-57/5 13-21 * * 1-5`. |
| P3 first in-session run could fail validation | Fixed: a 30-minute opening grace treats the previous close bar as delayed, not stale. |
| P3 search cache key ignored `limit`; `_identity` outside the concurrency slot; cache lock eviction | Fixed. |
| P3 options offset clamp masked as pagination | Fixed: `page × limit > 10,000` → 422. |
| P3 dead code (`_SYMBOL_PATH`, freshness `if False`) | Removed. |
| P3 daily-series month completeness used calendar days | Fixed: last trading day of the month. |
| P3 CSP allowed any `ws:`/`wss:` host | Fixed: `connect-src 'self'` + `CSP_CONNECT_SRC`. |
| P3 diagnostics views public | Fixed: `OPS_ACCESS_KEY` gate (open in dev). |
| P3 secrets interpolated into a `run:` heredoc | Fixed: passed through `env:`. |
| P3 memo workflows woke on every hourly run | Fixed: the refresh dispatches the memos explicitly after a validated morning full run with its run id; the memos refuse anything but `mode=full`. |
| P3 snapshot baked CI provider state | Fixed: the provider-status entry is no longer part of the public snapshot. |
| P3 a11y: options table name, `DataTable` header scope, chart layout tables exposed, palette combobox semantics, no skip link, launcher `aria-haspopup`/`aria-expanded`, 40 px sub-tabs on narrow, eager `KitScreen` chunk | All fixed (caption, `scope="col"`, `role="presentation"`, `role="combobox"` + live status, skip link to `main`, launcher states, 44 px rows, lazy kit route). |
| P3 `python-dotenv` unused in the news set; stale test counts in DEPLOY.md | Fixed. |
| P3 `/api/providers/status` hop count / value-range checks beyond the two core tables | Bounded: only the two tables every screen reads are value-checked; documented as a follow-up. |

Untested-but-material items the review listed (retry bounds, snapshot survives failing refetch in a frontend test, corrupt baseline) are now covered by `tests/test_providers.py` (retry counts were already pinned by `test_client_429_retries_then_gives_up`), `tests/test_validate_db.py::test_unusable_previous_blocks_upload`, and the manual snapshot verification in §4 (a unit test for the failing-refetch path remains a follow-up).

### 9b. Visual / UX review (opus, read-only, no detector output seen; report at `review-visual/REPORT.md`, 134 evidence files)

The review found one P0, two P1s, six P2s and sixteen P3s. All P0–P2 items and every
P3 except one (kept by design) were fixed in one bounded correction pass and
re-verified in the browser.

| Finding | Action |
|---|---|
| **P0-1** switching from an intraday range (1D/5D/1M) to a coarser uncached range crashed the whole Markets tab: the chart encoded the previous range's placeholder bars with the requested range's time format, collapsing a day's hourly bars onto one key | Fixed at the root: `candle-data.ts` encodes by the payload's own interval, de-duplicates by time and sorts; `CandleChart` receives the data's `range`/`interval`, not the request's. Unit test on the exact collapse case and a component test that holds the coarser fetch in flight. Re-verified: 1M→1Y, 1D→5Y, 5D→MAX on AMZN with no crash. |
| **P1-1** Single-name section header still read "yfinance · delayed up to 15m" above EODHD-labelled data | Fixed: "EODHD first, yfinance only as a disclosed fallback · delayed quotes". |
| **P1-2** "Regime unavailable" card stacked over a complete snapshot read | Fixed: the card renders only when there is no regime data at all; the shell's status word carries the sleeping-service message. |
| **P2-1** landing footer credited yfinance, not EODHD | Fixed. |
| **P2-2** landing called model confidence "Conviction" | Fixed: "Model confidence". |
| **P2-3** the status word ignored relay degradation while the tape said "AUTH FAILED"; raw machine states could render | Fixed: `● Live` / `▪ Delayed` carry a reader-word suffix from the relay's degraded reasons ("US equity feed rejected by the provider"); the tape's feed line maps every state to words and never prints a raw one. The relay itself now distinguishes a rejected token (401/403) from a refused subscription (connection limit after a restart). |
| **P2-4** chart caption ran into the next sentence | Fixed: captions end with a full stop. |
| **P2-5** options scroll well took a tab stop with no role or name | Fixed: `role="region"` + name. |
| **P2-6** options stamp lacked a zone and differed between header and caption | Fixed: one stamp, rendered as ET wall time via `fmtProviderStamp`. |
| P3-1 freshness chip printed the state word twice | Fixed. |
| P3-2 two definitions of "high" on News | Fixed: ≥3.5 everywhere. |
| P3-3 palette "Headlines" vs section "Priority developments" | Fixed: both "Priority headlines"; the fallback is "Latest stored headlines" (the older stored stories were never "priority developments"). |
| P3-4 allocation prose mixed digits/words and leaked ISO months | Fixed: number words and `Jun 2003 → Sep 2006` ranges. |
| P3-5 crypto/index charts claimed split/dividend adjustment | Fixed: clause omitted for CC/FOREX/INDX. |
| P3-6 "VIX · VIX · index" | Fixed. |
| P3-7 two rails above the fold on Credit | Fixed: the callout keeps its watch tone without a rail. |
| P3-8 identical document titles | Fixed: `<Tab> · Macro Regime Radar`. |
| P3-9 Methodology opening card half empty on wide monitors | Fixed: the card hugs the prose measure. |
| P3-10 Recession "expand" stranded mid-row at 768 | Fixed: the meta run takes its own line below the wide tier. |
| P3-11 stored rows open DAILY/INTRADAY, on-demand rows open range chips | Left as is: two data shapes, two honest affordances; recorded in DESIGN.md. |
| P3-12 missing-value dash at `--text-faint` | Fixed: `--text-muted`. |
| P3-13 Dashboard repeated the header's freshness words on a phone | Fixed: the desk read's chips are hidden on mobile. |
| P3-14 header chips 40 px at 390 | Fixed: 44 px on touch layouts; DESIGN.md updated. |
| P3-15 "Validated snapshot" unexplained below 1024 | Fixed: the one-sentence explanation renders at every width. |
| P3-16 News desk read repeated the top headline verbatim | Fixed: composed in the product's voice ("M&A leads the file: … at 3.5 / 5, the window's highest score."). |

The review also noted that the dev API wedged under page-load bursts during its session —
the P0 the technical review diagnosed and this pass fixed (thread-local connections,
concurrency ceilings). The socket-per-client cap first chosen (4) was raised to 20 after
the corrected server refused sockets from a single dev machine with several tabs; a NAT
address counts as one client unless `TRUSTED_PROXY_HOPS` is set.

## 10. Impeccable detector

Run exactly once after the last UI change over the 54 changed `web/src` files
(`proposals/release_readiness_evidence/detector/files.txt`), then once more as the
confirmation pass; both outputs are filed (`run-1.json`, `run-2-confirmation.json`) and
are identical: **two `side-tab` warnings**, `DeskRead.tsx:161` (the 3 px accent rail that
is the documented house mark for model output) and `AlertDrawer.tsx:36` (the alert
item's level-coded rail, paired with the level word). Both are intentional per the
suppression policy in the brief; no correction was needed and **no suppression was
added** — neither a global `side-tab` ignore nor a file-scoped one — pending Max's
explicit approval. The stop hook raised the same `AlertDrawer.tsx:36` finding during the
session and it was classified the same way.

## 11. Known limitations (stated, not hidden)

- FRED daily series lag 3 business days in the current snapshot (pipeline fetch, not the UI).
- Fundamentals and ticks are outside the EODHD plan; both degrade explicitly.
- Free hosts sleep: the live tape is best-effort there; the snapshot layer is the guarantee.
- Options data is end-of-day (EODHD marketplace), labeled as such.
- EODHD refuses a WebSocket subscription with `422 Symbols limit reached` when the
  plan's symbol budget is exhausted — seen once during the review while two API
  instances (a reviewer's manual restart and the preview server) held sockets on one
  token. The relay now records the refusal and retries normally instead of declaring the
  token rejected; run **one** API instance per token.
- The static snapshot is generated (gitignored); the frontend build step must fetch it
  from the Release (private repo → build token) or rely on the localStorage copy.

## 12. Outstanding publication gates (owner)

1. Add `EODHD_API_TOKEN` (and `GH_DB_TOKEN`, optionally `ANTHROPIC_API_KEY`) to the API host's secret store. Not a GitHub Actions secret; not needed there.
2. Choose hosting (zero-cost vs always-on) and deploy per `docs/redesign/DEPLOY.md`.
3. Push the branch; dispatch `Refresh Data → verify-only`, then `full`.
4. Decide on the assistant access mode and on any keepalive.
