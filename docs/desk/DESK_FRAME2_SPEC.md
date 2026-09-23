# Desk · frame-2 — real engine on screen, simplified layout, internals, walkthrough

Branch: `desk/frame-2`, cut from `main` after `desk/integration` has merged and deployed. Frontend plus the thin read-only endpoints named in §7. Do not modify `src/desk/event_study.py` or the daily store; if the engine needs a change, stop and say what and why.
Same rules as every branch: investigate first, `web/DESIGN.md` wins on every token, verifier that did not write the code, never push, `main` untouched, no `.db`/`data/` files staged, stage by explicit path. The launch constraints hold: never ports 8123 or 5180; local API with the relay explicitly off.

Order matters. Sections 1 to 5 are the deliverable. Sections 6 and 7 are built only after 1 to 5 pass the verifier, and are cut first if time runs out. Report after §5 and again at the end.

## 1. Fixture out, engine in
- The Event Study panel reads `/api/desk/event-study` and `/api/desk/event-study/assets`. Delete the fixture and every FIXTURE badge; the panel's badge is the standard `Live · {source} · as of` badge driven by the response's provenance block.
- Handle every state the API returns: computing/queued (202) with a quiet "computing" state and polling, 429 with a plain "busy, try again" line, 422 with the engine's reason under the query, and the "awaiting first refresh" state as a sentence, never an empty chart.
- The gold preset loads by default (`?study=gold-2sigma-spx-weak`). Presets appear as chips above the query; free-form queries update `?study=` on Run.
- Numbers come only from the response. No client-side arithmetic beyond formatting.

## 2. Query as a sentence
Replace the six labeled controls with one sentence with inline controls, in this order:
"When **[shock asset]** moves **[≥ threshold σ] [up/down]** over **[window]** sessions while **[co-condition]**, what did **[target]** do next?" with a regime filter as a trailing "in **[all regimes]**" clause. Each control is a compact inline select or segmented toggle; helper text moves into the existing jargon tooltip component. `history_from` for the chosen shock asset and target shows once, under the sentence, as "Sample: {start} to {end}", taken from the response.

## 3. Results, simplified
- Replace the histogram with the horizon chart: four horizons on the x-axis; for each, the conditional median and the baseline median as paired bars, the 90% interval drawn on the conditional bar, and a small marker or label for the exclusion verdict (established / not established / included) as the API reports it. Histogram moves behind a "distribution" toggle.
- Verdict card: the engine's verdict text as one paragraph, then one facts line: `n {n} · blocks {blocks} · sample {start}–{end} · cooldown {w} · entry {rule}`.
- By-regime table shows one horizon at a time with a 5/10/20/60 switch (default 20). Suppressed cells show `n<10` as now; the Unlabeled row shows with its flag.
- Recent events table unchanged, plus click-to-expand on any By-regime or horizon cell to list the events behind it (dates, regime, forward moves) from the response.
- One badge per card. Cards that are live carry the Live badge; nothing else.

## 4. S&P Internals page (Act › S&P Internals)
Built on the cross study (`study type = cross`): golden-cross and death-cross event lists, the same horizon chart and verdict for each, and the regime split. The page states plainly which of the two reads are established and which are not, in the engine's words. Breadth and sector-rotation panels are `Designed` shells with a one-line note of what they will read (constituent and sector ETF series not yet in the daily store). No fake numbers.

## 5. Today, Client view, Build Notes
- Today strip: current regime label from the classifier (with the two-month lag stated in the tooltip), recession probability labeled "recession probability (logistic model)" from the trained model only, presets that fired in the last five sessions, open positions nearest falsification.
- Client view: the verdict rendered in the client register (numbers as words where the engine's verdict allows it, internals hidden), the horizon chart in its simple form, source line, export control printing the same DOM.
- Build Notes: replace the placeholder file with the content in `docs/desk/BUILD_NOTES.md` (Max supplies it); the page renders it as is. Do not edit its prose.

## 6. Walkthrough (build only after §5 passes; cut first)
A "Walkthrough" control in the Desk header. Pressing it shows a bottom strip: step counter, one-line caption, Back / Next. Nothing autoplays. Each step is a real route with real state, carried in the URL as `?tour=N` so any step is a link. Six steps:
1. `/desk/event-study?study=gold-2sigma-spx-weak` — "The setup you described, on live data since 2000."
2. `/desk/internals` — "The 50/200 cross, scored the same way."
3. `/desk/monitor?from=gold-2sigma-spx-weak` — "Promoting a signal: the gate will not save without a falsification level." (form pre-filled from the signal, Save disabled)
4. `/desk/pipeline` — "Where every number comes from."
5. `/desk/event-study?study=gold-2sigma-spx-weak&view=client` — "The same study, as a client would read it."
6. `/desk/notes` — "How it was built, and how it could be wrong."
Closing the strip clears `tour` from the URL and leaves the page where it is. Keyboard: arrows move steps, Escape closes.

## 7. Endpoints this branch may add (read-only, thin)
None expected. If a screen needs data the API does not expose, stop and say what.

## 8. Verification
- Visual check at 1440 and 390, light and dark; the main dashboard unchanged outside `/desk`.
- Every number on screen traces to a response field; the verifier spot-checks five against the API JSON.
- The language ban list (`will`, `predicts`, `proves`, `guaranteed`, `always`, `never`, `obviously`, `model` outside the recession label) run over every string in `web/src` under `desk/`.
- Keyboard and reduced motion as before. Screenshots with the existing `shot.mjs`.
Report in `docs/desk/FRAME2_REPORT.md`. Stop for `PUSH OK desk/frame-2`.
