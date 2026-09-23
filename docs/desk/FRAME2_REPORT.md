# Desk · frame-2 — report

Branch `desk/frame-2`, cut from `main` at `a57f9bf` (desk/integration merged as `45cdbae`). Frontend
only: `web/`. The engine (`src/desk/event_study.py`), the daily store and every API route are
untouched; no endpoint was added (§7). Nothing pushed, `main` untouched, no `.db` or `data/` file
staged. **Stops at the gate: waiting for `PUSH OK desk/frame-2`.**

Status: §1 to §5 built (`f4806e9`), verified in two rounds (fixes `fffe9c1`, `9c693fa`). §6 and §7
follow below.

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

## 1. What was built (§1 to §5)

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

## 2. Verification of §1 to §5 (mine)

| Check | Result |
|---|---|
| `npx tsc -b --noEmit` | clean |
| `npx vitest run` | 101 files, **1,125 passed** (Desk: 73, of which new: `frame2.test.ts` 11, `desk-language.test.ts` 3, seven new shell tests covering ready / 202 / 429 / 422 / awaiting / 404 / client / Internals / Run / expand) |
| `npx vite build` | built (to the job's scratch directory) |
| `pytest tests/test_desk_api.py tests/test_event_study.py -k "fixtures or desk"` | 54 passed (the refreshed `engine-studies.json` passes the engine key pin) |
| `playwright test e2e/desk.spec.ts` (E2E_BASE_URL :5197) | **12 passed**: the frame's 8 plus four for frame-2: five on-screen numbers traced to the API JSON (verdict text, facts line, the 20-session medians, the 20-session interval, the newest event's move), keyboard expand + Run writes `?study=` then computing → ready, Internals reads vs the API's exclusions + Designed shells, 390 overflow and reduced motion on five routes |
| Ban list | scan green; five strings reworded (D10) |
| Main dashboard | outside `desk/` the only changed file is `screens/shared/Jargon.tsx` (an optional `def` prop, default unchanged; `Jargon.test.tsx` green); `dashboard-1440.png` / `dashboard-390.png` captured |
| Screenshots (`proposals/desk-frame2/`, gitignored) | today, event-study, sp-internals, build-notes, position-monitor, data-pipeline at 1440 and 390; client views of event-study, sp-internals, today at 1440 and 390; the print one-pager for event-study and sp-internals; the Distribution toggle; an expanded horizon cell; the light-scheme emulation. No horizontal overflow on any; CLS ≤ 0.016 on the frame-2 pages after reserving loading heights (Internals was 0.54 before) |

## 3. Verifier (§1 to §5)

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

## 4. Follow-ups (not in scope, recorded)

- **Engine (deferred, D1 and D2):** serve histogram bins per horizon, and the full event list (or a
  per-cell list) so an expansion can list every event behind a cell, not only the last ten.
- The five-session window uses weekdays; the XNYS calendar lives server-side.
- The Data Pipeline page measured CLS 0.24 at 1440 (frame-era, untouched here).
- V-13: the Position Monitor's "now" line dates a FRED daily reading by its month stamp; the true
  observation date is in `/api/freshness` `series[].as_of` (CLAUDE.md, B6).
- V-07: Build Notes carries "will" and "model" in the owner's prose; Max decides whether to edit it.
