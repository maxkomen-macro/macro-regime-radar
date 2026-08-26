# Overnight Build Ledger — React Rebuild Completion

Run started: 2026-08-26 (session local time). Orchestrator: Claude (ultracode).
Governance: plan at ~/.claude/plans/lucky-strolling-eagle.md. HARD STOPS: no push, no deploy.

---
## Phase 0 — Branch hygiene [COMPLETED] (orchestrator, git surgery)
- Found working tree ALREADY on react-rebuild with 2 dirty files carrying uncommitted work
  (CLAUDE.md API-session rewrite; format.py double-YoY fix). Plan's "byte-identical" claim was
  wrong — corrected: folded both into the amended commit instead of discarding.
- Amended 6a88cb5: staged dirty work, .gitignore += web/node_modules|web/dist|web/tsconfig.tsbuildinfo,
  untracked vendored trees. 5,668 → 273 files; web/ 107 MB → 0.6 MB.
- Rebased onto main: clean, no conflicts. New tip 80a0953. origin/react-rebuild untouched (6a88cb5).
- NOT PUSHED (hard stop). Morning command: git push --force-with-lease origin react-rebuild
- npm ci --prefix web: EXIT 0 (allow-scripts warnings only). Kill-switch not triggered.
- BASELINE (actual): typecheck PASS · vite build PASS (713ms) · pytest tests/test_api.py 37 PASSED
  · anaconda suites 31 PASSED.

## Phase 1a — LBO fee direction [COMPLETED via rebase]
- src/analytics/lbo.py:145 now `entry_ev + fee_dollars - entry_debt` (main's fix).
- test_api_lbo_fee_direction PASSES (was the 36/37 failure). Confirmed by run, not assumed.
## Phase 1b — Fresh data [COMPLETED] (orchestrator)
- DB backed up to scratchpad; downloaded data-latest (11,915,264 bytes, Aug 26).
- event_calendar already ingested upstream (42 rows through 2026-12-23) → load_events SKIPPED
  (unnecessary write avoided). news_feed: 5,105 rows, 1,439 in last 48h. Not staged in git ✓.
- Killed an 18-day-old stale uvicorn holding :8000 + the EODHD relay slot; fresh servers via
  launch.json (api:8000, web:5173). Relay: us/crypto/forex OPEN, vix REST, 0 errors.

## Phase 2 — Baseline sweep, 10 routes @1440 (orchestrator harness: web/scripts/verify-route.mjs)
- 9/10 CLEAN (zero console/page/network errors): landing, dashboard, regime-lab, markets,
  credit, recession, news, tools-lbo, methodology.
- FAIL tools-allocation: AllocationPanel crash `null.asset_names` (AllocationPanel.tsx:133).
  ROOT CAUSE: regime flipped to Goldilocks Jul 2026; only 27 Goldilocks months ever; engine's
  ≥24-month covariance gate fails inside the 2002→2026 return window → payload ships
  optimizations:null + portfolio_cvar:null. Silent skip in src/analytics/allocation.py:1298.
  → dispatched implementer (client null-guard). Server-side "reason" field folded into Phase 5.
  OWNER QUESTION logged: fall back to all-regime optimization when the current cohort is thin?

## Phase 1c — Provenance labels [implementer DONE, review IN FLIGHT]
- Implementer changed the 3 allowlisted screens only; typecheck+build PASS (orchestrator-run);
  rendered text shows "monthly signal print · Aug 2026" etc. composed from data. Reviewer dispatched.
## Phase 2 — Interaction sweep (harness: web/scripts/verify-interactions.mjs)
- 8/8 flows verified OK: chart deep-links daily+intraday (7 canvases), Cmd+K → /app/credit,
  alert drawer, news filters (24H/MACRO), regime-lab scenario (2× POST 200, Credit Crisis →
  stressed RR 75%, GL −63pp), recession sensitivity slider (adjusted 41.2%), LBO sliders+grid
  (IRR 17.5% — corrected fee math on screen).
- Initial regimelab-scenario FAIL was a HARNESS bug: CSS text-transform uppercases innerText,
  lowercase regex missed it. App verified correct via targeted probe. Harness noted.

## Phase 1c — REVIEW: PASS (reviewer agent, independent)
- All 7 criteria met. Non-blocking notes: (a) Markets header/caption duplicate provenance string;
  (b) LATENT: signals-meta cadence:"daily" for vix_spike/yield_curve_inversion would compose
  "monthly signal print · X · daily pending" if ever carried forward — not live today (both
  carried=false). Queued as micro-fix inside Phase 3's dashboard unit.
## Phase 2 — Allocation crash fix [implementer DONE, gates PASS, review IN FLIGHT]
- AllocationPanel null-guard: typecheck/build PASS; route CLEAN; honest empty state renders
  ("Optimizers need 24 months of Goldilocks covariance history…"); all other sections stand.
- Implementer's flagged "cvar_95 receives a dict" claim VERIFIED FALSE by orchestrator
  (allocation.py:1462-64 subscripts ["portfolio_cvar"] — scalar). Not chased.
- ALL 10 ROUTES NOW CLEAN at 1440.

## Phase 3a — Heading semantics [implementer DONE, runtime evidence PASS, review IN FLIGHT]
- SectionHeader → h2/h3 (+ `as` override excl. h1), wordmark h1 on AppShell + LandingPage.
- Runtime dump: 1×h1/page; h2 computed 11px/600 mt16/mb10 — UA styles fully pinned.
- deps installed (.venv): riskfolio 7.3.0, anthropic 1.0.0. NOTE: chat.py written against
  anthropic 0.x — Phase 6 must verify 1.0.0 API compat (claude-api skill check queued).

## Defect queue (non-blocking, owner-visible)
- RegimeLab cycle copy: "has run 1 months" pluralization (screenshot evidence).
- 1c latent: signals-meta cadence "daily" vs "monthly signal print" composition (Phase 3 unit).
- Markets Top Surprises header/caption duplicate provenance string (cosmetic).
## Phase 4 — Scout report received (54 grid sites triaged A/B/C/D)
- Mechanism chosen per scout: useBreakpoint() hook (matchMedia 375/768/1024) + static auto-fit/minmax
  for homogeneous card grids + EXTEND the codebase's own overflowX:auto convention to the ~9
  tabular grids missing it. Charts: LineChart/FrontierChart/Gantt have fixed 720/1385-unit
  viewBoxes → SVG text illegible at 375 (Gantt worst, ~2.4px). ChartPanel already autoSize.
- RESEQUENCING DECISION (orchestrator): Phase 3b (grid table semantics) FOLDS INTO Phase 4's
  per-screen units — same markup rewritten once, not twice; each Phase 4 unit carries explicit
  a11y criteria (role=row/cell or real tables). Logged as a deviation from plan phase order.
- Phase 6 SDK note (claude-api skill): anthropic 1.x is built on httpx2; messages.create/stream
  survive; chat.py doesn't import httpx directly → port risk low, but the Phase 6 implementer
  must run the guard suite against 1.0.0 and verify streaming manually. chat.py's pinned model
  (claude-sonnet-4-5-20250929) left unchanged — owner decision to upgrade, not tonight's.
## Phase 3a — REVIEW: PASS → COMMITTED
- Pixel identity, contracts, 45 consumer sites, a>h1 validity all verified by independent reviewer.
- Non-blocking residuals: /kit route has no h1 (pre-existing, dev-only); `as` escape hatch unexercised.

## Phase 7 — Scout result: bugs 3 (gauge 33/60) and 4 (2th ordinal) ALREADY FIXED on main
- Commit 6f20e90 (integrity-fixes session) landed both; scout verified 20/40 bands in code and
  zero bare-ordinal sites repo-wide. Phase 7 shrinks to: news-window leak (events_tab.py:355,
  1 line) + badge hues (THREE copy-pasted dicts: app.py:695, shared_styles.py:58,
  methodology.py:34). Implementer dispatched with all three sites named.

## Phase 3c — Scout: 1 clear contrast violation + 1 focus-ring bypass + 3 reduced-motion gaps
- Implementer dispatched (11-file allowlist, AppShell EXCLUDED — held by Phase 6 UI agent;
  its ⌘K aria-label fix deferred to Phase 4 shell unit). Borderline faint uses (AllocationPanel
  :394 diagonal/near-zero) left for owner ruling.

## Phase 6 — Both units dispatched (backend endpoint + React panel) to the scout's SSE contract.
- requirements-api.txt additions (anthropic) reserved to orchestrator at commit time (collision
  avoidance with Phase 5 implementer which owns that file tonight).
## Commit: 12dd8ec Phase 3a (heading semantics). Tree note: uvicorn on :8000 predates tonight's
api/ edits — restart required before final functionality review picks up the assistant route.
## Phase 2 — Allocation null-guard REVIEW: PASS → COMMITTED
- Reviewer verified crash-proofing (all 13 opt references guarded), populated-path fidelity
  (token-level), design compliance, and the 3 gated additions (each necessary — server only
  fills portfolio_factors/cvar_95 when optimizations exist).
- ORCHESTRATOR CORRECTION: my "cvar_95 is a scalar" false-alarm ruling was WRONG — reviewer
  read calculate_cvar(): ["portfolio_cvar"] IS a dict {cvar,var,worst_periods}. Populated path
  would render NaN%. Latent (needs a data regime with ≥24 cov months). Addendum sent to the
  Phase 5 agent (owns allocation.py): extract the scalar server-side + pin test.
## Phase 5 — Implementer report received (review pending addendum)
- riskfolio CVaR/HERC compute for real; HERC needed a documented shim for riskfolio 7.3.0's
  broken kwarg forwarding (upstream regression) — flagged for reviewer scrutiny.
- optimizations_skipped payload verified live: Goldilocks blocked by COV gate (20 rect < 24),
  stats fine (27 ≥ 12). requirements-api.txt += riskfolio-lib. New tests 4/4.
- test_api_allocation_smoke FAILURE root-caused by ORCHESTRATOR: baseline ran BEFORE the
  Phase 1b DB swap (old DB=Overheating=populated). Data-caused, not code-caused. The test pins
  a false invariant (unconditional non-null optimizations); will be updated to branch on
  optimizations_skipped ONCE Phase 6 backend releases tests/test_api.py. Justification: this is
  correcting a wrong invariant + adding skip-shape assertions, NOT weakening a valid test.
## Phase 7 — Implementer DONE (review dispatched)
- events_tab.py:355 predicate normalized (T/space format mixing) + functional temp-DB test that
  first PROVES the old predicate leaks, then proves the fix. All three badge dicts on the ramp
  recipe, byte-identical values (pinned by test). anaconda suites 41 passed; py_compile 4/4 OK.
- Cross-signal: test_api.py grew 37→41 mid-flight (P6 backend appending); allocation smoke still
  the only API failure (queued fix once P6 releases the file).
## Phase 6 backend — REVIEW ITERATION 2 issued (orchestrator live-verification catch)
- SSE endpoint + guard + ContextVar bridge shipped; 74 targeted tests green both interpreters;
  ONE live in-process call verified (real tool call, Goldilocks 64% grounded).
- DEFECT caught by orchestrator's browser probe: bare-uvicorn deployment path has no
  ANTHROPIC_API_KEY (decoupling dropped src.config's load_dotenv side effect). Panel correctly
  rendered the error frame (accidental proof of the error path). Correction sent: adopt
  api/stream.py's env→.env fallback idiom + min_length=1 on message (empty-msg token spend).
## Phase 6 UI — implementer DONE; gates PASS (tsc/build); panel verified live: launcher,
  dialog semantics, chips, footer, SSE parse, error styling all correct in headless probe.
## test_api.py smoke fix — DONE: both optimizations states covered; FULL API SUITE 41/41 GREEN.
## Phase 3c — REVIEW: PASS → COMMITTED (app.css deferred to Phase 6 commit — shared file with
  the unreviewed-but-gate-passing assistant classes; keeping commits purely-reviewed).
- Reviewer confirmed the reduced-motion selector logic under CSR CSSOM serialization (space
  variant matches; !important-in-media-query beats base.css regardless of order), the
  aria-activedescendant guard self-heals, and the ChartPanel focus-modality argument is sound.
## Phase 7 — REVIEW: PASS → COMMITTED
- Predicate byte-equivalent to api/db.py's proven fix, both branches; 3 badge dicts on the ramp,
  values identical (tested); functional leak-repro test judged genuine + hermetic; 7/7 + 41/41.
- Follow-ups logged for owner (out of frozen scope): src/daily_memo.py:334 has the same
  un-normalized predicate family; dashboard/app.py:708 PROB_COLORS hues no longer match the
  adjacent (fixed) badge.
## Phase 5 — REVIEW: FAIL → correction iteration 3 in flight
- Reviewer caught a REAL cross-consumer regression: my addendum's cvar_95 scalar change breaks
  Streamlit's allocation_tab.py:993 (dict consumer) once optimizations repopulate. Resolution
  honoring the dashboard freeze: REVERT engine to dict shape; fix the React side instead
  (types.ts was wrong). HERC shim: ACCEPT-WITH-CONDITIONS → narrowing except + riskfolio pin.
  Tautological test → replaced by extracting/attaching helper with real-path unit test.
## Phase 6 backend — iteration 2 DONE: get_secret env→st.secrets→repo .env (stream.py idiom),
  verified in stripped-env subprocess; message min_length=1 → 422. Suites 75 + 38 green.
## Phase 6 — LIVE E2E VERIFIED (2nd and final live spend): panel streamed "HY OAS stands at
  269 bps (2026-08-01, FRED HY index), which is tight…" — matches Credit tab's 269 bps
  (cross-surface consistency). Empty message → 422. Zero page/network errors. Review dispatched.
## Phase 5 — iteration 3 landed (46/46): dict shape restored, _attach_portfolio_cvar helper +
  real-path test, shim narrowed + riskfolio-lib==7.3.* pin. Re-review dispatched. React-side
  cvar consumption fixed (types.ts {cvar,var}|null; AllocationPanel ?.cvar) — rides P5 commit.
## Phase 4 charts unit — implementer DONE (gates blocked on shell unit's useBreakpoint.ts,
  by design — coded to the published API contract). Thorough W-flow audit; narrow=360 viewBox
  + FS bump to clear the 8px legibility bar at the measured ~295px card width; desktop
  byte-identical. Earlier transient tsc errors were this agent mid-edit — expected.
## Phase 5 — RE-REVIEW: PASS → COMMITTED (engine + React cvar consistency)
- Dict shape restored engine-side; both consumers verified consistent; production-path helper
  test would have caught the original break; shim narrowed, riskfolio-lib==7.3.* pinned.
## Phase 4 shell+hook — implementer DONE (useBreakpoint.ts singleton-snapshot matchMedia; shell
  stacks at <768; ⌘K label-in-name fixed; touch targets; TickerStrip compact prop; TabBar touch).
## Phase 4 charts — GATE FAIL iteration 2: JSX comment inside parenthesized expression
  (LineChart ~178) → TS1005/1128/1109. Exact correction sent back to implementer.
## Phase 6 — REVIEW: PASS → COMMITTED (both units + guard hardening)
- Guard verified un-weakened and single-sourced; sync-route threadpool + per-pull ContextVar
  confirmed; SSE parser handles split frames/UTF-8/CRLF/heartbeats; session-only verified
  (zero storage APIs); 75/75. 7 minor defects logged — the public-deploy hardening list
  (auth, rate limit, size caps, genericized error echo, thread-pool starvation) feeds
  FINAL_SECURITY_REVIEW verbatim. AppShell's assistant hunks reviewed via frozen diff; the
  file itself rides in the Phase 4 commit (also carries responsive hunks).
## Phase 4 foundation (hook+shell+charts) — REVIEW: PASS
- Reviewer diffed against the true pre-P4 snapshot; every wide-arm literal byte-identical;
  hook identity-stable; contracts consistent. Its two "undisclosed change" flags are RESOLVED:
  the h1 wordmark is Phase 3a's committed work (snapshot predates 3a) and the ⌘K aria-label
  was the explicitly-briefed deferred 3c micro-fix. No ratification needed.
- Phase 4 commit HELD until the 5 screen units land + gate + review (one phase commit).
## P4 screens unit B (markets+news) — implementer DONE
- Tape semantics deliberately deferred with sound rationale (role=row would destroy button
  affordance; correct fix = role=grid + roving tabindex = forbidden behavior change); surprises
  got list semantics; calendar got table semantics + keyboard-reachable scroller (tabIndex=0).
- ORCHESTRATOR RULING on flagged residual: tape zebra/flash painting stops at visible box when
  scrolled (<969px) — DEFERRED (cosmetic, TapeRow behavior-sensitive). Owner follow-up list.
## P4 unit D (regimelab) — implementer DONE: 12 triage sites + Gantt scroll-at-1:1 treatment +
  backtests/factor table semantics (display:contents rows) + "1 months" pluralization fixed.
  Deviations judged reasonable (chip-row wrap, backtests minWidth completing house convention).
## P4 unit C (credit+recession) — implementer DONE: matrices B+semantics (rowheader), heroes/ladder A/auto-fit, coefficient-row reshape (294px≤326px math), gauge stacks at mobile. Deviations sound.
## P4 unit A (dashboard/methodology/landing) — implementer DONE
- Signal cards/KPI/StatTiles gated (static auto-fit would break wide byte-identity — good catch);
  Methodology signals table B+semantics with the LOAD-BEARING minWidth:0 on the section grid item
  (grid min-content propagation); Landing gutter laddered to the shell.
- CROSS-UNIT FLAG: Markets tape section may need the same minWidth:0 (886px TAPE_GRID propagates
  through the page-root grid item) → verify in the 4-width sweep; unit B's agent owns the fix.
- Component nits logged (IntelBanner meta row + SectionHeader right slot lack flexWrap at 375).
## Phase 4 — Full gate iteration 1: typecheck/build PASS; sweep found 16/30 combos overflowing.
  ROOT-CAUSE DIAGNOSIS (orchestrator): (1) grid-item min-content propagation at 375 (Gantt 1385
  → regime-lab 1436; TAPE_GRID → markets 983) — sections lack min-width:0; (2) 1fr hidden
  auto-minimum at 768 (repeat(5,1fr) min-content 1069 > 768) — needs minmax(0,1fr);
  (3) .jargon::after hidden-absolute phantom overflow even at 1440 (dashboard 1642) — unit E's
  app-wide finding CONFIRMED by measurement. One surgical fix-up unit dispatched for all three.
## Phase 8 — REVIEW: PASS (zero defects) → COMMITTED
- Route priority proven structurally + empirically (catch-all last, exclusion set, WS unshadowable);
  bootstrap leak-free/atomic/lazy; CORS replace-not-append; Docker src-isolation verified
  transitively (all __init__ empty, no src.config anywhere in the API's import closure);
  DEPLOY.md claims verified against quotes.ts/queries.ts source. 45/45.
- Docker binary absent on this machine → image build deferred to the human (documented).
## Phase 4 — Fix-up iteration 2 sweep: 28/30 CLEAN (from 16 failures → 2). Remaining:
  tools-lbo @375 (509>375: the returns-banner flex row, measured) + @768 (817) — correction
  sent to unit E's agent (ToolsScreen block sections bypass the global rule, as the fix-up
  agent predicted). Jargon phantom overflow GONE at 1440. dashboard/regime-lab/markets all clean.
## Phase 9 — implementer DONE with exemplary honesty: corrected MY "34 routes" claim to a
  verified 28+3, refused to state unverifiable test counts. Reviewer dispatched.
## Phase 4 — iteration 3: LBO residual fixed (min-width:auto on grid ITEMS — banner was a
  symptom of the schedule table's min-content; correct root-cause hunks + ≥1024 identity
  argument). SWEEP: ALL 30 route-width combos CLEAN. 375 dashboard screenshot verified
  genuinely mobile-grade by orchestrator. Screens+fixup reviewer dispatched (2681-line diff).
## Phase 9 — REVIEW: FAIL (three stale PRODUCT.md claims incl. "assistant out of scope" —
  contradicting same-session CLAUDE.md). Correction iteration sent. All other doc claims
  code-verified PASS by reviewer.
## Phase 9 — RE-REVIEW: PASS → COMMITTED. All doc claims code-verified; PRODUCT.md's three
  stale claims corrected (28 routes, assistant built, architecture decided).
## Phase 4 — SCREENS REVIEW: PASS → COMMITTED (with reviewer's hygiene actions applied)
- Wide tier provably intact (~20 ternaries sampled); 13 tables' semantics column-verified;
  behavior greps clean; mobile judged "genuinely good, not merely non-broken".
- Hygiene: useBreakpoint.ts added to the commit (D2); AppShell's assistant-wiring hunks ride
  this commit with explicit Phase-6 attribution in the message (D1 — hunk-splitting is
  interactive-only; the audit trail lives in both commit messages + this ledger).
- Owner follow-ups (minor, not fixed tonight): factor-table rowheader consistency (D3),
  unlabeled corner columnheader in style table (D4), calendar wrapper unconditional tabIndex (D5).
## ALL 9 BUILD PHASES COMMITTED. Boundary suites: .venv 84 passed · anaconda 45 passed
  (tests/ wholesale under .venv mis-collects test_streamlit_backports — interpreter-split by
  design; documented run commands are per-suite).
## FINAL PHASE — both independent reviews dispatched (security → FINAL_SECURITY_REVIEW.md;
  functionality → FINAL_FUNCTIONALITY_REVIEW.md; fresh agents, no implementers).
## FINAL SECURITY REVIEW — WRITTEN (proposals/FINAL_SECURITY_REVIEW.md)
- VERDICT: NOT safe to deploy publicly as-is. SQL injection surface: ZERO (36 routes verified,
  all bound params; assistant guard single-sourced, ro connection, instruction bound, row cap).
  Secrets/artifacts clean (git history empty for .env; only .example templates tracked).
- Ordered must-fix before ANY public exposure: (1) auth on /api/assistant/ask, (2) rate limit +
  concurrency cap, (3) input-size caps, (4) sync threadpool starvation fix, (5) genericize
  AgentError SSE echo, (6) auth on the data/compute routes broadly. Should-fix: docs/debug
  gating, error-detail leaks, rw-WAL reconciliation, stray 0-byte data/macro.db untrack.
## FINAL FUNCTIONALITY REVIEW — WRITTEN (proposals/FINAL_FUNCTIONALITY_REVIEW.md)
- 40/40 route-width combos: 0 console errors, 0 page errors, 0 failed requests, 0 h-overflow
  (scrollWidth == innerWidth exactly). 8/8 interactions verified (1 known harness quirk).
  Cross-surface numbers consistent everywhere (HY 269 bps, FF 3.63%, 2s10s +46 bps).
- 3 non-blocking findings: GL 65 vs 64 residual-rounding (intelligence.py:540-545); /kit dev
  route URL-reachable with fixture data; harness regex needs /i.
- VERDICT: ready for morning review, desktop and mobile.

# RUN COMPLETE — 2026-08-26. All 9 phases + final reviews done. Nothing pushed, nothing deployed.
