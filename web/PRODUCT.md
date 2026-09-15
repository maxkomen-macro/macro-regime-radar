# Product

<!-- impeccable:product-schema 1 -->

<!-- Compiled 2026-08-06 (overnight session) from the owner's overnight brief, the
     design bundle, and the repository. The owner pre-supplied the interview
     answers in the brief and directed that no live questions be asked; facts
     below are labeled [brief], [bundle], or [repo] by source. -->

## Platform

web

## Stack

Vite + React 18 + TypeScript in `web/`, specified by the owner [brief] — not delegated.
TanStack Query for the data layer against the existing FastAPI service (`api/`, read-only
SQLite). Plain CSS custom properties + inline styles; no Tailwind, no CSS-in-JS — the
token layer is the design system and a utility framework would fight it [bundle].
Fonts self-hosted as woff2 (no CDN at runtime) [brief]. The Streamlit app
(`dashboard/`) remains the production surface until the owner explicitly ships the
React client; nothing is committed or deployed without their say-so [brief].

## Users

Priority order [brief]:

1. **Finance recruiters arriving via LinkedIn.** One visit, ~10 seconds of attention.
   The product must read as a credible, live quantitative terminal immediately —
   polish failures (contradicting numbers, empty states, typos) are fatal here.
2. **Non-finance visitors.** Must not be impenetrable: every jargon term carries a
   plain-language affordance; captions state what a number means, not just its value.
3. **The owner** — a rising junior using it daily to learn macro. Depth, backtests,
   and interactive tools matter to this loop; Cmd+K serves this user.

## Product Purpose

A live quantitative macro terminal. It ingests FRED macro series, yfinance prices, and
financial headlines; classifies the economy into one of four regimes (Goldilocks,
Overheating, Stagflation, Recession Risk) with a softmax classifier; watches five macro
signals against thresholds; runs a logistic recession model; and publishes automated
daily and weekly AI briefings (Claude interpretation + Perplexity cited research) [repo].
Success: the recruiter is impressed in 10 seconds, the civilian is never lost, and the
owner learns something every day.

## Positioning

A single-operator quantitative macro platform with a fully automated pipeline — FRED →
classifier → signals → Claude briefings, refreshed daily [brief]. Not a mock and not a
tutorial project: live data, real stored model output, published memos, and an
auditable data pipeline. The design language states this rather than sells it.

## Operating Context

- **Data plane:** FastAPI `api/` serves 28 `/api/*` router routes over the SQLite snapshot
  (`data/macro_radar.db`) — table endpoints mirror the Streamlit loaders' SQL, computed
  ones call the same `src/analytics/*` modules the tabs do — plus the unprefixed Atlas
  group, the stream WebSocket/debug pair, and `POST /api/assistant/ask` (count as of
  2026-08-26) [repo]. During development the client assumes `http://127.0.0.1:8000` [brief].
- **Cadence truth [repo]:** regimes/signals are monthly-cadence; the stored market
  universe (23 ETFs) is refreshed daily by the pipeline (yfinance); intraday is 5-min for
  SPY/QQQ; news is hourly with a rolling retention window; the calendar is a
  hand-maintained CSV through Dec 2026. Freshness messaging must state what the data
  is, never pretend it is live. Since 2026-09-06 the server publishes source-aware
  verdicts (`/api/freshness`: current / delayed / stale per feed, the NYSE session, and
  the exact monthly inputs blocking the regime month) and the shell prints one status
  word: **Validated snapshot · Delayed · Live · Reconnecting · Backend unavailable**.
- **Provider hierarchy (2026-09-06) [repo]:** EODHD is the primary market-data provider
  for everything requested on demand — symbol search, delayed quotes, daily and intraday
  candles, splits/dividends, exchange hours, end-of-day options, bounded ticks — and for
  the live tape (WebSocket relay). yfinance is only a **disclosed** fallback (search,
  candles, quotes) and the source of fundamentals while the EODHD plan excludes them.
  FRED remains the sole macro authority. Every on-demand payload names its provider,
  fetch time, market timestamp, delayed/live, and any fallback with its reason; a series
  never mixes providers and a fallback is never silent. Entitlements are probed once per
  family at startup and published at `/api/providers/status` (2026-09-06: fundamentals
  and ticks not in the plan → explicit unavailable states; options entitled).
- **Any listed symbol [repo]:** stored-universe rows keep their DB history; any other
  symbol (AMZN, BRK.B, BTC-USD, EURUSD, VIX…) requests EODHD history on demand with
  ranges 1D/5D/1M/6M/1Y/5Y/MAX (default 6M), never persisted to SQLite, never painted
  with a previous symbol's bars, and with named states for unknown symbol, unsupported
  instrument, plan gap, rate limit, timeout, empty range, fallback, and closed session.
- **Options and ticks scope [repo]:** the Options lens is a collapsed disclosure inside
  Single-name research — end-of-day EODHD marks, one expiration at a time, calls or
  puts, server-side pagination and filters, provider Greeks and IV only, no trading
  recommendation, and an explicit unavailable state when the plan lacks the family.
  Ticks are bounded windows (≤30 min, ≤5,000 trades) aggregated server-side to
  one-minute bars, never stored, and gated by entitlement (unavailable on today's plan).
- **Availability promise [repo]:** the static bundle ships a validated snapshot
  (`snapshot/latest.json`, built from a validated database) that seeds the cache before
  first paint, so the shell, Methodology, regime, signals, freshness, stored market
  tables and the latest stored headlines read with the API asleep; dynamic services
  connect progressively and never block; the live tape is best-effort on a sleeping
  host and the status word says so.
- **The locked IA is the spec of record [brief]:** seven tabs — Dashboard (regime hero +
  signals + KPIs + 3-row What's Priced teaser + macro charts in an in-place accordion) ·
  Regime Lab (playbook, cycle, transitions, analogues, scenarios, regime-history Gantt,
  backtests + factor attribution) · Markets (watchlist, sector heatmap, full What's
  Priced, Top Surprises) · Credit · Recession · News & Calendar (latest-available
  fallback, never an empty state) · Tools (LBO + Allocation as sub-tabs). Header:
  wordmark + live dot, ticker strip, regime badge + probability bar, bell-icon alert
  drawer (7-day badge count; green "✓ all clear — last alert [date]" when silent; full
  history in drawer), Methodology as a small persistent link. Cmd+K palette v1: tabs +
  sections only. No TradingView embeds.

## Capabilities and Constraints

- Unprefixed API endpoints (`/regime/latest`, `/signals/latest`, `/series*`) are a frozen
  contract with Atlas's MacroBridge agent; `/api/*` field names mirror the dashboard
  loaders. Do not rename fields [repo].
- The ticker strip runs on the EODHD WebSocket relay (`api/stream.py` → `/api/stream/ws`),
  built 2026-08-06 and hardened 2026-09-06 (stale-tick detection, degraded verdict,
  bounded dynamic subscriptions for the symbol a panel is watching, `VITE_WS_BASE`); the
  token stays server-side and never reaches the browser. Absent `EODHD_API_TOKEN` the
  feeds stay off and the client falls back to the `/api/market/intraday` DB poll [repo].
- Public exposure is gated (2026-09-06, `api/security.py`): the assistant is off by
  default on a public origin set (`ASSISTANT_ACCESS`), every API path is rate limited and
  size capped, expensive calculators and provider calls have concurrency ceilings,
  responses carry security headers, and provider failures return typed, sanitized
  bodies [repo].
- The assistant is built (2026-08-26): `POST /api/assistant/ask` streams SSE from
  `api/chat.py`, rendered by `web/src/screens/shell/AssistantPanel.tsx`. The SELECT-only
  SQL guard stays server-side and is **imported** from `src/analytics/chat.py`, never
  copied [repo].
- The watchlist is the single per-visitor preference stored in the browser (localStorage key mrr.watchlist.v1: add, remove, reorder; no accounts, no server storage). The assistant's no-persistence rule is unchanged.
- Signal status is server-computed and passed: `/api/signals/latest` returns `status`
  (the stored triggered flag owns "Triggered"), and the client renders it (ruled
  2026-08-06). The fill%-derived ladder — <50 Clear, 50–75 Watch, ≥75 Triggered — is the
  fallback only when no `status` is present [repo + bundle].
- Regime labels are a closed set of four; alert levels a closed set of three [repo].
- **Undecided** (owner decisions, not to be made unilaterally): production hosting — the
  runbook (`docs/redesign/DEPLOY.md`) documents a zero-cost mode (static bundle +
  sleeping free API host, snapshot-backed) and a paid always-on mode; the choice, the
  keepalive question, and adding `EODHD_API_TOKEN` to the host are the owner's [repo];
  when the React client replaces Streamlit; the EODHD plan tier (fundamentals and ticks
  are outside today's plan).

## Brand Commitments

- **Wordmark, not logo:** a pulsing blue dot + `MACRO REGIME RADAR` in Space Grotesk,
  uppercase, 700, ~0.14em tracking. No logo file exists and none may be drawn [bundle].
- **No icon set.** The glyph vocabulary is Unicode at 9–13px in semantic colors:
  `▲ ▼ → ↗ ↘ ⬆ ⬇ ◆ ● ✓ × ▸ ▾ ▪`. Never add an icon library; never substitute emoji [bundle].
- **Voice: desk note.** Declarative, present tense, third person about the market;
  every claim carries its number in the sentence; uncertainty stated as numbers
  ("52/48"), never adverbs; no emoji anywhere. Closed status vocabulary:
  Clear/Watch/Triggered · info/watch/risk · Risk-On/Risk-Off · Aligned/Diverges [bundle].
- **The footer disclaimer is not optional:** anything that leaves the app ends with
  "Automated briefing from Macro Regime Radar. Not investment advice." [bundle]
- The design bundle at
  `/Users/maxkomen/Documents/Trading-Research-Docs/Macro Regime Radar Design System/`
  is the visual source of truth. Token-level changes and anything softening the
  terminal character are owner-only decisions; disagreements are built to the bundle
  and logged in the session report, not applied [brief].

## Evidence on Hand

- Design bundle (path above): 7 token files, 17 React components with `.d.ts` +
  `.prompt.md` contracts, 5 specimen pages, dashboard + memo ui_kits, 20 guideline
  specimen cards, 1 reference screenshot [bundle].
- `docs/redesign/`: full 11-tab diagnosis (SUMMARY.md), 27-item confusion index with
  desk-note captions, IA proposals, integrity-fixes report, 11 full-height screenshots [repo].
- Live deployed app (macro-regime-radar.streamlit.app) and published memos
  (maxkomen-macro.github.io/macro-regime-radar) [repo].
- **Absent — never fabricate:** testimonials, customers, press, benchmarks, pricing.
  The proof of life is real data rendering correctly, nothing else.

## Product Principles

1. **Every number is a claim.** No naked figures: each value ships with its label, unit,
   timeframe, and a one-line desk-note caption. (The confusion index is the worklist.)
2. **One number, one truth.** Read stored model output; never re-derive a probability a
   table already asserts. The app disagreeing with itself is the worst historical bug.
3. **Honest freshness.** Say "monthly observations · latest Jul 01, 2026", never
   "updated just now" over month-old inputs. Monthly data isn't the sin — pretending
   it's daily is.
4. **Dated beats empty.** When a window has no rows, fall back to latest-available with
   its date stated. An empty state with data in the store is a rendering failure.
5. **Motion is information.** Pulse = live, tick-flash = changed, caret = awaiting input.
   Nothing else moves. If a screen feels empty, the answer is more data, not decoration.
6. **Conclusion first (2026-09-05).** Every major screen opens with one desk read:
   conclusion, why it matters, what changed, what to watch, what would invalidate the
   call, and how fresh the evidence is. The audit trail (signals, evidence, charts) sits
   under it and methodology is one click down. The locked IA is unchanged; the reading
   order inside each tab is now fixed.

## Accessibility & Inclusion

- Focus ring (1px accent, 2px offset) is never removed [bundle].
- `prefers-reduced-motion: reduce` disables pulse and caret — already handled in
  `tokens/motion.css`; tick-flash and gauge transitions must respect it too [bundle].
- Red text on dark backgrounds uses `#f08785`, not raw `#da3633`, for contrast [bundle].
- Jargon terms carry dotted-underline plain-language definitions so audience 2 is never
  locked out; status is never conveyed by color alone (always paired with a word or
  glyph) [brief + bundle].
