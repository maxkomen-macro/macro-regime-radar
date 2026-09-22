# Revamp Brief — Exec-Grade Readability + Expansion Program

**Date:** 2026-08-26 · confirmed via structured interview (owner answers recorded below)
**Mode:** Operate · **World:** the incumbent "terminal that is awake" — evolved, not replaced.

## Owner decisions (verbatim intent)

1. **Order:** readability/type/layout system first, across all screens — "so every later screen is built in the new system" — then Markets expansion, then tab-by-tab expansion. Observation freeze lifted.
2. **Type:** evolve the three-face system (chosen from options): mono narrows to numbers/tickers/timestamps/column-headers; all prose and captions move to IBM Plex Sans; sizes up one step; looser leading.
3. **Layout:** restructure screens inside the existing top-tab shell — no new nav paradigm.
4. **Copy:** UI captions/explainers rewritten terser + full sweep for AI tells (em-dash appositive chains, hedging, LLM sentence rhythm) — everywhere. Generated model-prose blocks (Claude/Perplexity) render as-is; their prompt tightening is a src/ pipeline item, out of scope here.

## Job and audience

Exec-level hedge-fund / trading-firm viewers and finance recruiters (10-second first read, often on a phone) must see a credible professional terminal; non-finance visitors must never be locked out (glossary layer); the owner uses it daily.

## Status

- **Phase 1 executed 2026-08-26** (same session, uncommitted on `react-rebuild`):
  token ramp bump + `--fs-caption`; every caption/state note to Plex Sans; 104
  copy fixes across three sweep passes (em-dash asides → colon/semicolon/parens,
  trailing-dash loading lines → "…"); mobile header collapse (probability bar
  dropped <480, one control row, one freshness line); ticker parentheticals shed
  on phones; conviction chip nowrap; signal-caption ownership fix; DESIGN.md
  updated (typography frontmatter, Mono Number Rule inverse, em-dash rule).
  Verified: `npm run build` clean; impeccable detector 0 findings over 22 changed
  files; before/after screenshots in `proposals/design_notes_evidence/`.
- **Exec-lens critique pass executed 2026-08-27** (/design:design-critique over
  regime-lab, credit, recession, tools, assistant): What's Priced teaser →
  3-up stat-tile grid; IntelBanner chip wrap guard (eyebrow nowrap + row wrap);
  backtest cohort labels print once per group (aria-label keeps them for SRs);
  `tidyProse()` display filter strips em-dash asides from server/model-composed
  prose (takeaway narrative, news interpretations, cited research); copy pass 4
  (9 stragglers) + pass 3 earlier (51) — visible em-dash asides are now zero
  across every screen surveyed. Evidence: `sweep-*.png`, `confirm-*.png`.
- **Phase 2 core built 2026-08-27** (uncommitted; needs a :8000 uvicorn restart
  to serve the new API — verified on a parallel instance at :8001):
  - `api/lookup.py`: keyed single-flight TTL caches over yfinance —
    `GET /api/market/search?q=`, `GET /api/market/profile/{symbol}`,
    `GET /api/market/candles/{symbol}?range=1D|5D|1M|6M|1Y|5Y|MAX`; plus a
    `ticker` filter on `GET /api/news`. Errors map UnknownSymbol→404,
    upstream→502; delayed data stamped `fetched_at`.
  - `web/`: SymbolSearch (combobox, keyboard-navigable), SingleName deep dive
    (live-or-delayed price with honest stamp, candle+volume chart across seven
    ranges via lazy lightweight-charts, 8 fundamentals tiles, regime-fit table
    computed from monthly closes × stored classifier since 1996, stored-coverage
    list with tagged-then-headline-match fallback and client dedupe), wired at
    the top of Markets with `?name=` deep link and a ⌘K section entry.
  - Tests: `tests/test_api_lookup.py` (9, stubbed seam, no network); full suite
    97 passed (test_streamlit_backports pre-existing skip — needs anaconda env).
- **Full functional audit + live-feed hardening 2026-08-27** (owner-directed,
  subagent fix→review→orchestrator cycle; :8000 restarted onto current code):
  - Verified live end-to-end: tape ticks (BTC moved $28 in 15s on screen), all
    feeds open with zero errors, deep-dive live-first quote path (BTC "live ·
    EODHD stream"), all 7 candle ranges, stored chart panel, scenario/sensitivity/
    LBO POSTs, allocation risk lenses, palette, drawer, jargon, assistant panel,
    landing, calendar; 375 sweeps clean (no body-level horizontal scroll). The
    News 60s poll was proven at the network layer (fetches at t=0/72/132/192/252)
    with the checked-stamp advancing; the ErrorBoundary was proven live with a
    temporary URL-flagged throw (fallback painted, shell survived, keyed remount
    recovered on navigation; throw reverted). The session counter counts stories,
    not rows: a shared headlineKey() backs both the feed dedupe and the arrival
    tracker so a cross-source duplicate can never inflate "N new this session".
  - Fixed via the cycle: deep-dive price thousands separator; 404 message +
    no-retry on unknown symbols; AS OF column clip (118→150px); singles caption
    em-dash + tidyProse on surprise interpretations; **Style risk-block crash**
    (spread rows are return-only in the payload; unguarded sharpe.toFixed blanked
    the app — no error boundary existed); News live refresh (60s poll, arrival
    flash, checked-stamp, session counter, filter-change re-seed); residual
    null-guards (optimizer method cells, real_nominal lens) + type-level
    optionality so tsc enforces them; screen-level ErrorBoundary.
  - Logged, not fixed (data plane): news_feed rows carry no ticker tags in the
    local snapshot; style-spread rows lack vol/sharpe by source design
    (src/analytics/allocation.py:1238); sector heatmap covers 4 SPDRs (stored
    universe); optimizer block null while Goldilocks covariance history < 24 months.
- Phase 3 (News & Calendar revamp beyond the live feed) and Phase 4 (tab-by-tab): not started.

## The program

- **Phase 1 — readability system (this session):** token ramp bump (9→10, 10→11, 12→13, 13→14; body leading 1.6), shared caption/state-note styles to Plex Sans 12px, screen-local mono-prose migrated, UI copy sweep, shell/header mobile foundation (header collapse <480, ticker clip fix, single freshness line), dashboard's worst layout offenses (signal-caption ownership, What's Priced density).
- **Phase 2 — Markets expansion:** ticker search over arbitrary symbols (new FastAPI lookup/profile/candles endpoints via on-demand yfinance), single-name deep-dive (price + live movement via the existing EODHD `us` feed with honest delayed fallback, key stats, regime context, ticker-tagged news from `news_feed.ticker`), watchlist/heatmap restructure into a search + workspace + detail-pane surface.
- **Phase 3 — News & Calendar revamp:** significance-led feed, ticker filters, calendar as next-print countdown.
- **Phase 4 — tab-by-tab:** each remaining screen restructured and expanded in the new system.
- **Cross-cutting:** hover/tap definition layer extending the existing Jargon dotted-underline mechanism to every term and card title — no tooltip library, no icons.

## Boundaries

- Nothing commits, pushes, merges, or deploys without the owner's explicit say-so.
- Untouched: API contracts (Atlas frozen group), regime/status color semantics, glyph vocabulary, dark-only theme, no-icon/no-emoji/no-gradient/no-shadow rules, generated model prose content.
- Anti-goals: generic SaaS look, Inter-everything, decorative motion, pill shapes, cards-in-cards.
- EODHD true-real-time breadth for US equities is a subscription decision — owner's, later. UI ships live-first with honest freshness labels either way.
- DESIGN.md is updated to record the evolved type system when Phase 1 lands (owner-directed token change, recorded as such).
