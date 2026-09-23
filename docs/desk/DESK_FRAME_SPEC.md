# Desk · frame, shells, and non-analytical modules — spec of record

Branch: `desk/frame`, cut from the current launch line. Frontend (`web/`) and routing only, plus the thin read-only API endpoints named in §6. Do not modify analytics or pipeline code; Stream A owns `desk/event-study`.
Same rules as every branch: investigate first, verifier that did not write the code, never push, `main` untouched, no secrets, the real database never written. Load the frontend-design skill before planning; the existing `web/DESIGN.md` wins on every token — Desk is the same product, not a new identity.

## 0. Investigate first
List every design token, component, and layout primitive you will reuse (sidebar, top bar, card, badge, table, freshness chip, jargon tooltip, mobile nav) and confirm the route structure. Report, then proceed.

## 1. Route and entry
- New top-level section at `/desk`, titled "Desk", eyebrow "Analyst Workspace".
- Entry: an understated "Analyst Workspace →" control on the main dashboard header area. Not a tab in the existing tab strip.
- Wordmark inside Desk links back to the dashboard. Mobile nav below 860 px carries Desk.

## 2. Sidebar (three groups, this order)
- SURVEY: Today, Launchpad, Dashboard (links back to `/`)
- ACT: Event Study, S&P Internals, Position Monitor, Pitch Evaluation, Red Team, Macro / Regime
- TOOLS: Basket Builder, Hedge Simulator, Data Pipeline, Build Notes
- Footer card "House Discipline · Enforced": Variant view first. Pre-mortem before defense. Falsification required. Calibrated language only.

## 3. Status badges (every panel, no exceptions)
`● Live · {source} · as of {timestamp}` in mint, or `Designed` in the muted style. The badge component reads from `/api/freshness` and the Data Pipeline inventory; never hand-typed. A panel with no data source declares `Designed`.

## 4. Desk / Client toggle
Header toggle, persisted in the URL (`?view=client`). Client view hides z-scores, N, CIs, bootstrap details, model/method IDs, and the query builder; it shows the verdict text, the headline numbers as words ("about six times in ten"), and an "Export one-pager" control. The export prints the same DOM (print stylesheet), not a second template.

## 5. Modules to build now
- **Event Study panel**: query builder (shock asset, window, threshold, co-condition, regime filter, Run), distribution chart, horizon table, regime-split table, recent-events list, verdict card. Asset dropdowns populated from `/api/desk/event-study/assets` with `history_from` shown. Reads `/api/desk/event-study`; stub the fetch with a fixture until Stream A lands. Studies addressable by `?study=<slug>`.
- **Position Monitor**: promote-to-position form (instrument, direction, size, horizon) plus the discipline gate: Variant view, Pre-mortem, Falsification level (numeric, tied to a series). Save is disabled until all three are non-empty. Language check flags "will", "definitely", "obviously", "proves", "guaranteed", "certain", "always", "never" in thesis fields with a suggested rewrite; save blocked while any remain. Monitored list shows distance to falsification using the live series. The app has no accounts: persist positions in browser storage, label the panel "saved on this device", and seed it with nothing (no sample positions).
- **Data Pipeline page**: lineage diagram (Sources → Fetch → Validate → Transform → Store → Serve), series inventory table generated from the pipeline config (series, source ID, cadence, as-of, feeds, status), and a Snowflake-style schema block (RAW → CUR → MART) rendered from `web/src/content/desk/schema.md` (tracked; `docs/desk/` is for specs and reports only).
- **Build Notes**: markdown page rendered from `web/src/content/desk/BUILD_NOTES.md` (Max writes the text; create the file with the five headings and a one-line placeholder each). Sections: what this is, what is live vs designed, architecture, the pre-mortem of this tool, first 90 days on the desk.
- **Today**: current regime label, recession probability with its provenance sentence, signals that fired in the last five sessions, open positions nearest falsification.

## 6. Designed shells (real UI, labeled `Designed`)
Basket Builder, Hedge Simulator, Red Team, Pitch Evaluation, Macro / Regime, Launchpad, S&P Internals. Each has its layout, controls, and empty states, with a one-line note of what it reads once live. No fake numbers anywhere.

## 7. Thin endpoints this branch may add (read-only, no analytics)
`/api/desk/pipeline/inventory` (series config + freshness), `/api/desk/positions` (if a store exists). Nothing else.

## 8. Verification
- Visual check at 1440 and 390 in light and dark; every §0.5-style parity rule from the redesign spec still holds on the main dashboard.
- Keyboard: every control reachable; focus ring intact; reduced motion honored.
- The discipline gate cannot be bypassed from the keyboard or by editing the URL.
- Capture before/after shots with the existing `shot.mjs`.
Report in `docs/desk/FRAME_REPORT.md`. Stop. Wait for `PUSH OK desk/frame`.
