# Desk · frame-2 — report

Branch `desk/frame-2`, cut from `main` at `a57f9bf` (desk/integration merged as `45cdbae`). Frontend
only: `web/`. The engine (`src/desk/event_study.py`), the daily store and every API route are
untouched; no endpoint was added (§7). Nothing pushed, `main` untouched, no `.db` or `data/` file
staged. **Stops at the gate: waiting for `PUSH OK desk/frame-2`.**

Status: **complete.** §1 to §5 built (`f4806e9`) and verified in two rounds (fixes `fffe9c1`,
`9c693fa`); report after §5 (`b2f538a`); §6 built after that (`ca39d21`); §7 needed nothing; the final
verifier pass over the branch returned PASS WITH FINDINGS, fixed in `21ee29f`. Open for the owner:
V-07 (Build Notes prose vs the ban list) and the follow-ups in §4.

## Decisions taken unattended

The run was unattended; where the spec says to stop and ask, the most conservative option that
keeps the deliverable honest was taken and recorded here.

| # | Where | Decision | Why |
|---|---|---|---|
| D1 | §3 histogram | The "Distribution" toggle shows the **served quartiles** (p25, median, p75 for the events; baseline_p25, baseline_median, baseline_p75 for every session) as paired boxes per horizon. No histogram. | The engine serves no histogram bins. Drawing one would need an engine change (deferred, not done) or invented bins (a fake number). The frame's `DistributionChart.tsx` and its provisional `distribution` type are deleted. |
| D2 | §3 click-to-expand | A horizon cell or a by-regime row expands to the events **the response carries**, and the list says how many of the cell's events that is ("The response carries the last 10 of 18 events; 3 of the 6 behind this cell are among them"). | The engine serves only the last ten events (`recent_events`, `event_study.py` ~l.1061). A full list per cell is an engine change: deferred to the follow-ups. |
| D3 | §3 interval | The 90% interval is drawn on the conditional bar at baseline median + each bound of the served Δ interval. Only the served interval (on Δ) is printed. | The spec asks for the interval on the conditional bar; the engine serves it on Δ. The engine's Δ draws are resampled medians minus the fixed baseline median (`horizon_stats`), so the offset is exact plotting geometry. No derived number reaches the screen. |
| D4 | §1 badge | The Live badge is `Live · event-study engine · as of {provenance.as_of}`; its tone is the freshness report's SLA verdict for the stored tables the study reads (`provenance.inputs[].table`: asset_prices, desk_series), weakest wins. With no study on screen (loading, 202, 429, 422, awaiting, 404) the badge carries no "Live": `◇ event-study engine · {state}`, grey (after V-08). | "Driven by the response's provenance block" for the stamp; the tone reuses the report's own verdict so a stale store never paints mint. |
| D5 | §3 facts line | `blocks` is the engine's `n_blocks_by_h["20"]`, printed `blocks 18 at 20d` (the horizon the engine's verdict cites); `entry` is `same session`/`next session` from `entry_same_session`, the engine's full `entry_rule` in the tooltip; `cooldown none` for a cross. | The spec's template names one blocks value and one entry rule; these are the served fields that carry them. |
| D6 | §5 presets fired | The five-session window ends at the studies' `as_of` (the newest session the engine read), weekdays only, with the dates printed. | Ending at today's date would call a stale store "quiet". Exchange holidays are not known client-side; the frame's rule is kept and stated. |
| D7 | §5 regime | Today prints the classifier's label and month only, with the engine's `regime_lag_months` in the tooltip. The frame's regime odds line is gone. | Those odds included `regimes.prob_recession`, which the Desk must never show (CLAUDE.md, Desk section); "model confidence" also used a banned word. |
| D8 | §5 client verdict | The client register is composed from the engine's per-horizon exclusion verdicts (established → the served Δ's direction, the medians in words; included → "not distinguishable from an ordinary stretch"), with no size adjective; n, blocks, intervals and the bootstrap stay out. | Regex-editing the engine's paragraph is brittle; composing from the verdict fields claims exactly what the engine claims. Size words were dropped after a capture showed "sizeable" beside the engine's own "modest". |
| D9 | §5 Build Notes | `docs/desk/BUILD_NOTES.md` copied byte for byte (`cmp` identical). Its `# Build Notes` line is the page's h1 (one h1 per route); its `##` sections render at h2. | "Renders it as is; do not edit its prose." |
| D10 | §8 ban list | The scan (vitest, TypeScript AST: string literals, template text, JSX text; comments never count) covers every .ts/.tsx/.md under a `desk/` directory plus `api/desk.ts`. Exempt: tests and saved engine payloads; `BUILD_NOTES.md` (owner prose containing "will" and "model", not to be edited); in `gate.ts`, the ban list's own entries. "model" passes only inside "(logistic model)"; "models" is banned too. | Five frame-era strings failed and were reworded (`schema.md` ×4, `Lineage.tsx` ×1). |
| D11 | §8 light/dark | The product is dark-only (DESIGN.md). "Light" is checked as `prefers-color-scheme: light` emulation (the page stays dark, identical background pixels) and as the print one-pager (the paper re-tokening). | DESIGN.md wins on every token. |
| D12 | §8 tooling | `shot.mjs` (the UI-review capture tool, git-excluded under `proposals/ui-review/tools/`) runs from the job's scratch directory with `node_modules` linked to `web/node_modules`; a small `print.mjs` beside it emulates print. Captures are under `proposals/desk-frame2/` (gitignored). | "Screenshots with the existing shot.mjs." |
| D13 | servers | Local API on **:8781** from a `git archive HEAD` export (no `.env` in it) with `EODHD_API_TOKEN=" "`: `token_configured: false`, feeds off. Its database is a read-only `.backup` of the integration worktree's copy (data through 2026-09-18, asset_prices and desk_series present). Vite on **:5197** proxying to it. Never 8123/5180; 8000 and 5173 belong to other sessions. The live Render API was only read (GET) to compare payload shapes. | Downloading the `data-latest` release was denied by this session's permissions; a blank token alone falls through to the repo `.env`, a whitespace value does not. |
| D14 | §4 | S&P Internals keeps its slug `sp-internals`; `desk-sections.ts` marks it live. Breadth and sector rotation are Designed; the sector panel lists the nine sector ETFs the engine registers as deferred, from the assets endpoint. | No constituent or sector series is in the Desk's daily store. |
| D15 | §5 Today | The frame's "Signals fired" panel (the alert feed) is replaced by the spec's "presets that fired". | The strip names four items; the alert feed is not one of them. |
| D16 | §7 | No endpoint added. | Every screen reads `/api/desk/event-study`, `/api/desk/event-study/assets`, `/api/regime/latest`, `/api/recession/probability`, `/api/freshness` and the stored series the Position Monitor already read. |
| D17 | §6 step 3 | The caption reads "Promoting a signal: the gate **does not** save without a falsification level." (the spec: "will not"). | §8's ban list covers every string under `desk/`, "will" included; the sentence means the same. |
| D18 | §6 routes | The spec's short paths (`/desk/internals`, `/desk/monitor`, `/desk/pipeline`, `/desk/notes`) are inbound aliases: DeskShell replaces them with the page's slug (`sp-internals`, `position-monitor`, `data-pipeline`, `build-notes`), query and hash kept, so every step link in the spec works as written. The strip's own Back and Next go straight to the slug (after R3-01, a redirect dropped focus). | Renaming four slugs would move every existing link, test and e2e route of the frame; an alias keeps both. |
| D19 | §6 step 3 pre-fill | `?from=<study slug>` fills **the instrument** from the engine's answer for that study (its target's label) and quotes the engine's first verdict sentence above the form. Direction, size, horizon, series, variant view, pre-mortem and the level stay the analyst's; the gate row names what is missing and Save stays disabled. A slug the engine cannot read fills nothing and says so; no other URL text reaches the form. | Writing a thesis or picking a direction or level from a study that established nothing would put words and numbers in the analyst's mouth. The target (^GSPC) has no exact series in the Monitor's catalogue (SPY is a fund), so no series is chosen either. |
| D20 | §6 keyboard | ArrowLeft/ArrowRight move steps unless the key belongs to a control (a field, a select, a segmented group, a tablist); Escape closes, after any open jargon tooltip. Opening from the header puts focus on Next; closing returns it to the header control; at a disabled end, focus moves to the neighbouring button first. The strip is hidden in print and the page keeps room for it. | The Desk's segmented toggles use the arrows for focus; Escape already closes jargon tooltips. |

## 1. What was built (§1 to §7)

| § | Item | Where |
|---|---|---|
| 1 | Fixture and every FIXTURE badge deleted; the adapter carries the provenance, quartile and exclusion fields the panels read; one Live badge per card from provenance | `web/src/api/desk.ts`, `event-study/StudyBadge.tsx`; deleted `event-study/fixture.ts`, `event-study/DistributionChart.tsx` |
| 1 | States: 202 computing (quiet line, polled at the engine's `retry_after`), 429 (plain busy line + Try again, from the first failure), 422 and 503 not_stored (the engine's reason under the query), awaiting_refresh (a sentence), 404 (a sentence); loading heights reserved | `event-study/EventStudyPage.tsx` (`StudyState`), `api/desk.ts` (`pollInterval`) |
| 1 | Gold preset by default; presets as chips above the query; Run and the chips write `?study=` | `event-study/QuerySentence.tsx` |
| 2 | "When [shock] moves [≥ zσ] [up·down·either way] over [w] sessions while [condition], what did [target] do next in [regime]?"; inline selects and a segmented toggle, each with an accessible name; helper text in jargon tooltips on "moves", "sessions", "while", "do next", "in" (the shared `Jargon` takes an optional `def`); "Sample: {start} to {end}" from provenance with each input's history in its tooltip | `event-study/QuerySentence.tsx`, `screens/shared/Jargon.tsx` |
| 3 | Horizon chart: paired medians, the interval on the event bar, the exclusion marker per horizon; sized to its container (10px labels at any width); horizon cells under it (the keyboard path); Distribution toggle (D1) | `event-study/HorizonChart.tsx`, `QuartileChart.tsx`, `useChartWidth.ts`, `results.tsx` |
| 3 | Verdict: the engine's paragraph + `n · blocks · sample · cooldown · entry` | `results.tsx` (`VerdictCard`), `format.ts` (`factsLine`) |
| 3 | By regime: one horizon at a time (5/10/20/60, default 20), n<10 where suppressed, the Unlabeled row flagged "outside the totals", the regime's own baseline; rows expand to their events | `results.tsx` (`RegimeCard`) |
| 3 | Recent events table unchanged; horizon cells and regime rows expand (D2) | `results.tsx` (`EventsCard`, `EventsBehind`) |
| 4 | S&P Internals live: "What the engine establishes" (from each horizon's exclusion, then the engine's own sentences quoted); per cross the verdict, horizon chart, regime split and events; Breadth and Sector rotation Designed with one-line reads notes | `internals/InternalsPage.tsx`, `desk-sections.ts`, `DeskShell.tsx`, `shells/DesignedShellPage.tsx` (the old shell removed) |
| 5 | Today strip: regime label (lag tooltip), "Recession probability (logistic model)", presets fired, positions nearest falsification | `today/TodayPage.tsx`, `positions/PositionMonitorPage.tsx` (`MonitoredRow compact`) |
| 5 | Client view: the verdict in the client register, the simple chart (no interval, verdict words), a source line; Export prints the same DOM | `words.ts` (`clientVerdict`), `results.tsx`, `EventStudyPage.tsx` |
| 5 | Build Notes verbatim (D9) | `content/desk/BUILD_NOTES.md`, `notes/BuildNotesPage.tsx` |
| 8 | Ban-list scan (D10) | `desk-language.test.ts`; `content/desk/schema.md`, `pipeline/Lineage.tsx` reworded |

| 6 | The Walkthrough control in the Desk header; the bottom strip (counter, caption, Back, Next, Close); six steps on the spec's routes with `?tour=N` (links resolve to the page slugs; the short paths open inbound); keyboard; focus; print | `tour/tour.ts`, `tour/TourStrip.tsx`, `DeskTopBar.tsx`, `DeskShell.tsx`, `desk.css` |
| 6 | Step 3: `?from=<study>` promotes a signal (D19) | `positions/PositionMonitorPage.tsx` (`useSignal`, `SignalNote`, `draftFromSignal`) |
| 7 | No endpoint: `git diff a57f9bf.. --stat -- api src` is empty | — |

## 2. Verification (mine)

| Check | Result |
|---|---|
| `npx tsc -b --noEmit` | clean |
| `npx vitest run` | after §5: 101 files, 1,125 passed; **after §6: 102 files, 1,136 passed** (Desk 84: `frame2.test.ts` 13, `desk-language.test.ts` 3, `tour/tour.test.ts` 5, shell tests for ready / 202 / 429 / 422 / awaiting / 404 / client / Internals / Run / expand / the walkthrough / the signal pre-fill) |
| `npx vite build` | built (to the job's scratch directory) |
| `pytest tests/test_desk_api.py tests/test_event_study.py -k "fixtures or desk"` | 54 passed (the refreshed `engine-studies.json` passes the engine key pin) |
| `playwright test e2e/desk.spec.ts` (E2E_BASE_URL :5197), at `21ee29f` | **14 passed**: the frame's 8; four for §1 to §5 (five on-screen numbers traced to the API JSON: the verdict text, the facts line, the 20-session medians, the 20-session interval, the newest event's move; keyboard expand + Run writes `?study=` then computing → ready; Internals reads vs the API's exclusions + Designed shells; 390 and reduced motion on five routes); two for §6 (the six steps by Enter on Next with a real-state check on each and focus kept on Next, no autoplay, ArrowLeft, Escape closing where it is with focus back on the control; step 3 as a link at 390 with ringed Back / Next / Close) |
| Shared-shell e2e sample (`a11y`, `shell`, `sections`) | 39 passed (tab walks, jargon keyboard, reduced motion, overflow at 1672) |
| Ban list | scan green; five strings reworded (D10) |
| Main dashboard | outside `desk/` the only changed file is `screens/shared/Jargon.tsx` (an optional `def` prop, default unchanged; `Jargon.test.tsx` green); `dashboard-1440.png` / `dashboard-390.png` captured |
| Screenshots (`proposals/desk-frame2/`, gitignored) | today, event-study, sp-internals, build-notes, position-monitor, data-pipeline at 1440 and 390; client views of event-study, sp-internals, today at 1440 and 390; the print one-pager for event-study and sp-internals; the Distribution toggle; an expanded horizon cell; the light-scheme emulation; the dashboard at 1440 and 390; walkthrough step 3 at 1440 and step 1 at 390. No horizontal overflow on any. CLS after the round-2 fixes: Internals 0.024 (desk) / 0.039 (client), Event Study ≤ 0.015, Today 0.011 |

## 3. Verifier

An independent general-purpose agent that wrote none of the code verified `f4806e9` against the
spec (84 tool calls, read-only, evidence under the job's scratch `verifier/`). **Round 1: PASS WITH
FINDINGS**, no S0, one S1. It accepted D1, D2, D4 to D7, D9, D11, D13 to D16, found D3 sound
(`event_study.py:682-685,709-710`: baseline + a bound is exactly a resampled median), agreed with
composing the client paragraph (D8) but not with its chart and Internals words (V-01), and
spot-checked five numbers against the API JSON through :5197 (gold 20d median and interval, gold
blocks, death-cross 5d Δ and the Stagflation cell, the us10y study in bp, the recession
probability): all matched. Fixed in `fffe9c1`:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| V-01 | S1 | The client words said "clear of the usual range" for an established horizon; the engine judges the median against the baseline median, and the golden 20d median sits inside the baseline's own quartiles. | Fixed: "differs from an ordinary stretch" / "not distinguishable from an ordinary stretch" / "difference not established" (short forms under the chart, spelled out in the legend); a test forbids "range" and "clear of". |
| V-02 | S2 | A lower bound of −0.0395% printed "0.0%", the sign that decides "included". | Fixed: interval bounds round outward at display precision (low down, high up), as the engine rounds its own; test added. |
| V-03 | S2 | "Sample:" used the first evaluable event, not the history the spec names; hidden when the sentence changed. | Fixed: `Sample: {data_start} to {sample_end}` (the later of the shock's and the target's history_from, served), the evaluable window in its tooltip; always shown with the dirty or cross note beside it; the facts line and the client "record runs from" use the same start. |
| V-04 | S2 | Client chart at 390: axis labels overlapped and the verdict words were dropped. | Fixed: below 480 px the labels read `5d` and the verdicts move to a list under the chart. |
| V-05 | S2 | Recession "inputs as of Sep 30, 2026" (a month-end stamp) beside a badge "as of Sep 17". | Fixed: "inputs through Sep 2026" (`fmtMonYr`), as the Recession screen prints it. |
| V-06 | S3 | The first median label collided with the y-axis tick. | Fixed: value labels sit above the bar or the interval's top. |
| V-07 | S3 (owner) | Build Notes prints "will" once and "model" five times outside the recession label (D10). | **Owner's decision.** Rendered as written per §5; exempted from the scan and stated here. |
| V-08 | S3 | With no study (404, 422, 429, awaiting) the badge still said "Live … as of unknown". | Fixed: a pending badge, `◇ event-study engine · {computing · busy · refused · awaiting refresh · not on this server · waiting}`, grey, no "Live". |
| V-09 | S3 | "Last five sessions read" counts weekdays. | Fixed: "Five weekdays to the last session read, {from} to {to}". |
| V-10 | S3 | Chart legends in 11px mono prose; the Unlabeled flag at 11.5px. | Fixed: UI face at 12px. |
| V-11 | S3 | Client title "…while S&P 500 below its 50-day average" (no verb); horizons joined with commas. | Fixed: "…, with {condition}"; `listWords`. |
| V-12 | S3 | Unused client-derived `suppressed`; z printed with an ASCII hyphen. | Fixed: field removed; `fmtZ` prints U+2212. |
| V-13 | S3 | A seeded position's FRED reading is dated by its month stamp (frame-era `MonitoredRow`). | Not fixed (frame-era, outside §1 to §5): follow-up below. |
| V-14 | S3 | §6's `/desk/internals`, `/desk/monitor`, `/desk/notes` are not routes. | Handled in §6. |

**Round 2** (the same verifier re-checking `fffe9c1`, 105 tool calls): **PASS WITH FINDINGS, no S0
or S1 remaining**: V-01 to V-06 and V-08 to V-12 confirmed fixed; three new findings, fixed in
`9c693fa`:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| N-1 | S2 | The V-02 fix rounded bounds outward at display precision, which could push a bound across zero (a served +0.082% low printed "0.0%") and disagree with the engine's own sentence on the same screen. | Fixed: bounds print exactly as the engine's `fmt_move` does (`+.1f` percent, `+.0f` bp: ordinary rounding, the sign always kept), U+2212 for the minus. |
| N-2 | S3 | The client source line still started the sample at `sample_start`. | Fixed: `data_start`. |
| N-3 | S3 | Internals CLS rose to 0.07 (desk) and 0.10 (client) when the pending badge became the Live one. | Fixed: the pending badge holds the Live badge's width at ≥768 px and the Reads card keeps one height from wait to answer in each view: 0.024 and 0.039 (Event Study 0.001 to 0.015, Today 0.011). |

With round 2 the verifier's condition for §1 to §5 is met; §6 was built after it.

**Final pass** (the same verifier on `ca39d21`, the whole branch): **PASS WITH FINDINGS**, nothing
blocking. It accepted D17 ("does not save"), D18 (the short paths as inbound aliases: both addresses
work as links and history Back steps through the tour) and D19 (the step-3 pre-fill: "honest";
filling a direction from an "included" read would not be). It confirmed N-1 to N-3 fixed, every
step's real state, no autoplay, arrows and Escape (a jargon tooltip first), closing that keeps
`?study=…&view=client` and returns focus, one h1 and no overflow at 390 on every step, print hiding
the strip and the control; `tsc` clean, vitest 102 files / 1,136, `e2e/desk.spec.ts` 14/14; `git diff
a57f9bf..ca39d21 --stat -- api src scripts .github data` empty. Fixed in `21ee29f`:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R3-01 | S2 | Next or Back into a short-path step (2, 3, 4, 6) passed through the alias redirect, which remounted the strip and dropped keyboard focus to the page. | Fixed: step links resolve the short path to the page slug (`/desk/sp-internals?tour=2`); the short paths still open inbound. The e2e now presses Enter on Next through all six steps and asserts Next keeps focus. |
| R3-02 | S3 | The Walkthrough control carried `aria-pressed` but restarts the tour rather than closing it. | Fixed: a plain button; mid-tour its title says it starts again from step 1. |
| R3-03 | S3 | Step 3's default "Long" and "3 months" sat beside the signal and could read as its call. | Fixed: the signal note says only the instrument is filled in, and that direction and horizon are the form's defaults, not a call from the signal. |
| R3-04 | S3 | `toFixed` rounds an exact tie away from zero; Python's `format` rounds half-to-even (no served value hit it). | Fixed: an exact binary tie rounds to even; test added. |

After `21ee29f`: vitest 102 files / 1,136 passed, the build is clean, `e2e/desk.spec.ts` 14/14.

## 4. Follow-ups (not in scope, recorded)

- **Engine (deferred, D1 and D2):** serve histogram bins per horizon, and the full event list (or a
  per-cell list) so an expansion can list every event behind a cell, not only the last ten.
- The five-session window uses weekdays; the XNYS calendar lives server-side.
- The Data Pipeline page measured CLS 0.24 at 1440 (frame-era, untouched here).
- V-13: the Position Monitor's "now" line dates a FRED daily reading by its month stamp; the true
  observation date is in `/api/freshness` `series[].as_of` (CLAUDE.md, B6).
- V-07: Build Notes carries "will" and "model" in the owner's prose; Max decides whether to edit it.

## 5. Owner edits after the final pass (2026-09-23)

- **Build Notes:** "what it will read once it's wired" → "what it reads once wired", in both
  `docs/desk/BUILD_NOTES.md` and `web/src/content/desk/BUILD_NOTES.md` (still byte-identical). That
  takes "will" out of the file; "model" remains in the owner's prose (V-07).
- **Today's recession date.** The frame printed `data_as_of` ("inputs as of Sep 30, 2026" on Sep 23).
  That field is the month-end label of the newest monthly bucket across the inputs
  (`src/analytics/recession.py`: the features are resampled to month-end; September's bucket holds
  daily values only through Sep 17). The number on the card is not that bucket: it is the last point
  of the served `recession_prob_series`, which the server cuts at today (`2026-08-31`, the Aug 2026
  reading), and that reading reads its features three months back (May 2026 values; checked against
  the feature frame on the scratch database). The card now dates its number by the reading it is,
  as a month: "Low Risk · the Aug 2026 reading", taken from the series' last point when it equals the
  headline (else no date). Nothing is computed in the browser. The badge beside it dates the input
  series themselves ("as of Sep 17 · 3 days behind"). The two agree: the reading's month is not
  later than the badge date, and neither is later than today. The lag is stated in the label's tooltip.
- **Tests:** a Today test fixes the clock at 2026-09-23 and serves `data_as_of: "2026-09-30"`. It
  reads every date the strip prints ("Sep 30, 2026", "Sep 17", "Aug 2026", ISO) and fails on any date
  after today. It failed on the old line and passes now. An e2e test does the same against the real
  API. vitest 102 files / 1,139, `e2e/desk.spec.ts` 15/15, build clean.
- **Follow-up:** the main Recession screen still prints `data_as_of` as a month ("Sep 2026"). An API
  field for the reading's month and its input month would let every screen say both without the
  browser knowing the lag.

## 6. Independent review (11 findings, all accepted) and the fixes

| # | Finding | Fix |
|---|---|---|
| R-01 | An open horizon cell or regime row outlived a study change, with a count stored from the old response. | The selection carries its study's slug, is cleared in the render where the slug changes (switching back does not bring it back), and its count is read from the response on screen at render (`behindCount`). Tested by rerendering the same mounted cards with a second study and back. |
| R-02 | "Presets fired" said "None fired" before every preset had answered, and judged every preset against the first answer's window. | Each preset is judged against the five weekdays to its own `as_of`. Until all three have answered the card reads "Incomplete" (or "N fired so far") with "k of 3 presets answered", and each row names its state (loading, computing, awaiting refresh, no answer). "None fired" appears only when every preset has answered. |
| R-03 | `toFixed` and `Math.round` round differently from the engine's Python. | `web/src/screens/desk/pyformat.ts` rounds the double's exact binary value (BigInt mantissa × 2^exponent) half-to-even, as Python's `format` does. Every Desk number formatter goes through it: moves, bounds, bp, z, shares, words, Position Monitor levels and distances, the recession figure, the σ labels. A point move now keeps its sign at zero as `fmt_move` does ("+0.0%"). `scripts/desk_format_fixture.py` writes Python's own strings (the engine's `fmt_move` and `format`) for 470 doubles: every value in the saved payloads, exact ties, near-ties, −0.0, a subnormal and large values. They go to `__fixtures__/py-format.json`. `pyformat.test.ts` checks moves, bounds, bp, shares and the fixed-point core against it, and `tests/test_desk_format_fixture.py` fails if the file drifts from a fresh run. |
| R-04 | The client title and source line dropped a regime restriction. | Both name it: "…, counting only events in Stagflation" and "…; events in Stagflation only, by the regime classifier's label". |
| R-05 | Positions loaded from storage were checked for shape only. | On load each passes the discipline gate as a draft and a catalogue check of its series; a refused one is dropped with a console note naming it and why. |
| R-06 | "saved" dates used the UTC day. | Saved instants print by their New York day (`fmtDateNy`). The date test gains the evening boundary: a position saved at 21:30 ET on Sep 22 (01:30Z on Sep 23) reads "saved Sep 22, 2026", and no date on the page is later than the New York day. |
| R-07 | FRED readings in the Position Monitor were dated by `/series/{id}/latest`'s month stamp. | The value still comes from there; the date is the freshness report's observation date for the series (a monthly series prints its month), and "date unknown" when the report has none. |
| R-08 | Every missing forward move read "window open". | Events come newest first, so a window can be open only while no newer event has a closed one at that horizon. Any other gap reads "no observation" (`missingForwardWord`). |
| R-09 | The study badge skipped unavailable and missing input tables. | They count as the weakest state (`unavailable`, grey) and are named in the tooltip; only a report that has not loaded leaves the badge unjudged. |
| R-10 | Build Notes was exempt from the language scan. | The scan now includes it. "model" passes only in a sentence about the recession regression (one naming the recession probability, a logistic regression or the logistic model). In both copies (still identical): "a second model" → "a second, independent reviewer"; "a rules-based classifier, not a trained model" → "a fixed-rule classifier: nothing in it is fitted or trained"; the two recession sentences became one that keeps "the only number in Desk I call a model"; "never calls" → "does not call"; "is never recomputed" → "is not recomputed"; "that's never edited" → "that stays unedited"; "will compare" → "is likely to compare" (the gate's own rewrite for "will"). |
| R-11 | **Approved exception**, recorded: two computations on served numbers happen in the browser. (1) The five-weekday windows on Today (`firedWindow`: weekdays counted back from a served `as_of`; the dates are printed). (2) The distance to falsification (`distanceOf`: level − reading, and \|gap\| / \|reading\|). Both print their inputs beside the result. Everywhere else the page only formats served fields. | — |

Gates after the fixes: `tsc` clean; vitest 103 files / 1,152 passed (Desk 100: `pyformat.test.ts` 4, the review-round shell tests, `frame2.test.ts` 18, `store.test.ts` 5, the language scan with Build Notes); the build clean; pytest `test_desk_format_fixture.py`, `test_desk_api.py` and the engine's fixture pins 57 passed; `scripts/desk_format_fixture.py --check` current; `e2e/desk.spec.ts` 15/15 against the local API (:8781, relay off) through Vite (:5197).

## 7. Third review: R-07 (blocking), R-08 and R-12 (high); R-11 closed

| # | Finding | Fix |
|---|---|---|
| R-07 | The second-round fix still paired a cached FRED value with the freshness report of the moment. When a refetch of the value failed (the 503 repro) and a new generation's report arrived, the old value showed the new generation's date. | `fetchFredPair` (`positions/series.ts`) fetches the value between two `/api/freshness` reads and pairs it with that report's observation date only when both reads name the same data generation (generations only advance, so the value came from it). A generation published mid-read means one more try; split twice means refuse. The pair (value, date, generation) is one cached object: a failed refetch keeps the old pair with its old date, or shows "Live reading unavailable" when there is none, and no newer date can reach a cached value. An API that reports no generation gives the value with "date unknown". The 503 repro is a shell test: value 4.12 at Sep 17 in generation 1; generation 2 with Sep 18 lands while `/series/DGS10/latest` answers 503; the row keeps "4.12% now (Sep 17, 2026)". The test fails on the previous `series.ts` ("4.12% now (Sep 18, 2026)") and passes now. |
| R-08 | "window open" was inferred from the list's order alone. | The adapter carries each horizon's served `n_incomplete`. "window open" only when the response marks that horizon incomplete (`n_incomplete` > 0) and no newer event has a closed window there; every other missing return reads "no observation". |
| R-12 | "Presets fired" took its badge from the first study that answered. | The badge is stamped with the earliest `as_of` among the studies that answered, its tone is the weakest verdict across all their tables, and its tooltip lists each study's own `as_of`. When the cutoffs differ the card body says so ("Cutoffs differ: …" with each date). The same badge now dates the two S&P Internals cards that read both crosses. |
| R-11 | Browser arithmetic on served numbers (the five-weekday windows, the falsification distance). | **Closed by decision** as an accepted exception (§6); no change. |

## 8. Fourth review (Codex, `82e5484..c850c8e`): R-07 (blocking, partial), R-08 (high)

| # | Finding | Fix |
|---|---|---|
| R-07 | The pairing compared only the generation `id`, a process-local counter that restarts at 1 with the worker. With `{id 1, built Sep 17}` → value 4.25 (Sep 18's) → `{id 1, built Sep 18}` the check passed and printed "4.25% now (Sep 17, 2026)". | The check compares the full identity before and after the value read: generation `id`, `built_at` and the series' own `as_of` (`generationIdentity`). A mismatch reads again, once; a second mismatch throws `GenerationSplit` and the row and the form read "Awaiting refresh" with no value (React Query does not retry a split again). A report with no generation at all still gives the value with "date unknown"; any other failed refetch keeps the old pair with its old date. Tests: the reviewer's repro as a unit (same id, Sep 17 then Sep 18 build: re-read, and 4.25 pairs with Sep 18, never Sep 17), identical ids across different build stamps on every read (rejected), a moved `as_of` under the same id and stamp (rejected), and a shell test where every read carries id 1 with a new stamp (the row reads "Awaiting refresh.", no value). The shell test fails on the previous `series.ts`, which printed "4.25% now (Sep 18, 2026)". Frontend only; the worker is untouched. |
| R-08 | `n_incomplete` counts incomplete windows across all events, so a lapsed historical window (the Oct 27, 2025 event: 10-session return missing, 20 and 60 present, `n_incomplete` 2) still read "window open". | **Frontend only, by the owner's decision** (the fix the review asks for adds a field to the engine, which `DESK_FRAME2_SPEC.md` freezes on this branch). "window open" now needs an explicit per-event, per-horizon `window_open: true` on the event; the engine serves no such flag, so every missing forward return reads "no observation" and stays out of N as before. The adapter carries only `true` flags if an engine ever serves them. The `n_incomplete` inference is gone. Tests: the Oct 27, 2025 case on a saved payload (adapter + formatter: "no observation"), the events table rendering that row as "no observation" with no "window open" anywhere, and the flag rule. **Deferred engine follow-up (rule revised in Codex round 4, R-13):** `recent_events[].window_open` as `{ "5": bool, "10": bool, "20": bool, "60": bool }`, one entry per served horizon, true only when the event's entry session plus h sessions, counted on the exchange (XNYS) calendar, lands after the **target series' own last available observation** (its last stored date, `provenance.as_of_by_series[target]`), not the study-wide `as_of` (the earliest last date across all inputs). A window whose exit session is on or before the target's last observation has elapsed: a missing endpoint there is a data gap, `window_open` is false, and the page reads "no observation". Either way the move stays out of that horizon's n. The shape and the rule are written into `EVENT_STUDY_SPEC.md` §7 and the response contract in `EVENT_STUDY_REPORT.md` §5, marked planned.  Once the engine serves the field, the saved payloads are refreshed and the key pin (`tests/test_event_study.py`) covers it. |

Verifier on `67c38a7` (independent, read-only): **PASS WITH FINDINGS**, nothing blocking. It ran the new tests against the previous files in scratch copies: all five failed, the row printing "4.25% now (Sep 18, 2026)" and "window open". It found the new code rejects a split in the browser. Its findings:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| V4-01 | S2 | Every test that moved `built_at` also moved `as_of`, so dropping the `built_at` clause would have passed. | Fixed: a case where only the build stamp moves (same id, same `as_of`) is rejected. |
| V4-02 | S3 | The before/after check assumes one server whose generations only advance; two API instances serving at once (a rolling deploy) could alternate old, new, old. | **Deferred server follow-up**, beside the R-08 engine flag: serve the generation, or the observation date, with the value (`/series/{id}/latest`), so a pair needs one request. Today's deploy runs one worker. |
| V4-03 | S3 | With the flag deferred, a recent event's still-open window reads "no observation". | Accepted behaviour; the Recent events card now says so in one line when a return is missing. |

**Codex round 4 on R-07 (blocking): the pairing is removed.** The before/after freshness pairing cannot prove which generation served the value when two servers answer (V4-02 made concrete), so it claimed more than it could establish. It is gone, with its retry and its split state. A value is now shown with a date only if that date came in the same response as the value: a stored bar carries its own date ("Sep 18, 2026"); a FRED row carries its month stamp, printed as the month it is ("Sep 2026": one row per month holding the newest in-month value, CLAUDE.md B6); a response with no date prints the value with no date attribution, and the page's own badge dates the source on its own. A failed fetch with nothing held reads "Awaiting refresh"; a failed refetch keeps the old value with its own date. Tests: the build-stamp and pairing tests are gone; a value response without a date renders no date (and none of the freshness report's dates); a value response with a date renders that date and no other (a FRED month stamp, a stored bar); a 503 refetch keeps the old value and its date; a failed first fetch reads "Awaiting refresh". **The full fix is the API returning `as_of` with each value** (`/series/{id}/latest` and the stored-bar reads), scheduled for the frame-3 API work; this branch stays frontend and docs only.

**Codex round 4, R-13 (low): the deferred `window_open` rule.** The rule recorded above judged maturity against the study-wide `as_of`, which is the earliest last date across every input; a target that stores later than another input would read an elapsed window as open. The rule now judges each window against the target series' own last observation, and an elapsed window with a missing endpoint is a data gap ("no observation"). Docs only: `EVENT_STUDY_SPEC.md` §7 and `EVENT_STUDY_REPORT.md` §5 name the field, its shape and this rule as planned (not served), and the two frontend comments that restated the old rule (`api/desk.ts`, `event-study/format.ts`) now state this one. No engine change.

Verifier on `1595319` and `5435df2` (independent, read-only): **PASS WITH FINDINGS**, nothing blocking. Scope confirmed frontend and docs only, R-07 and R-13 as separate commits, the pairing gone from `web/src`, every Position Monitor, form and Today date taken from the reading's own response, and five mutants caught (reattaching the report's date, falling back to it, "date unknown", never awaiting refresh, `monthly` false). Its findings, fixed in a third commit:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| V5-01 | S2 | The failed-refetch test asserted before React rendered the error state, so a mutant that dropped the held value passed. | Fixed: the test waits for the query's `error` state after its retry and flushes React before reading the row; the mutant now fails it. |
| V5-02 | S2 | `1595319` deleted the two R-12 "Presets fired" shell tests along with the pairing test (a slicing error in the edit). | Restored from `87dcec8`, unchanged; they pass. |
| V5-03 | S3 | Nothing covered the date in the form's hint. | Fixed: both new R-07 tests assert the hint ("Now 4.12%." and "Now 4.12% (Aug 2026)."). |
| V5-04 | S3 | The R-08 row said the rule is in the specs and, in its last sentence, that the specs were not changed. | Fixed: the last sentence now says what follows when the engine serves the field. |
| V5-05 | S3 | A comment still showed a day date for a FRED reading; the "Live reading unavailable" branch could no longer run. | Tidied. |
| V5-06 | S3 | Judgement asked for: a FRED month stamp printed as "(Sep 2026)". The verifier finds it acceptable: the stamp is the only date in the response, printed at its precision, and true for daily and monthly series. One risk: beside a daily yield it could read as a monthly average; the reviewer's example may have expected no date at all for DGS10. | **Decided and fixed in its own commit.** A date is rendered at the series' own frequency, and only when the response carries it at that frequency. Every catalogue series declares its frequency. A daily series (the FRED yields, spreads, breakevens, VIX, SOFR, TIPS; every stored price and FX bar) shows a day or no date: the FRED row's month stamp is never shown for it, and a day appears only if the response carries the observation's day (`as_of`, the frame-3 API work). A stored bar shows its own day. A monthly series (CPI, industrial production, unemployment, fed funds) shows its month. One test per case: a daily FRED month stamp renders no date (row and form hint); a daily response carrying its day renders that day; a stored bar renders its day; a monthly series renders its month (row and form hint); plus the unit cases, and the failed-refetch test now reads a monthly series so the kept date stays visible. |

## 9. After `PUSH OK desk/frame-2`

```
git push -u origin desk/frame-2
```

Nothing else: no merge, no deploy. The servers this run started (API on :8781 from the job's
scratch export, Vite on :5197) belong to the job and stop with it; the repo's `data/` was never
written (the API read a scratch copy).

