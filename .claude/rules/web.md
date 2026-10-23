---
paths:
  - "web/**"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

Cloud Project threads cannot read the owner's local design folder named below, and the `impeccable` plugin is installed at user scope on the owner's Mac only. In a cloud thread, `web/DESIGN.md` (tokens, type, regime colors) and `web/PRODUCT.md` are the contracts. The migration below has since shipped (the site is live on Vercel from `main`), so its branch and "not deployed" status lines are history.

## React Migration (in progress — nothing ships without explicit user approval)

- **Design source of truth:** the owner's local design bundle (*Macro Regime Radar Design System*, kept outside this repo) — read `HANDOFF_REACT_MIGRATION.md` there first. `styles.css` + `tokens/` and `components/**/*.jsx` are shippable near as-is; `ui_kits/` are fixture-data references only.
- **Design tooling:** the `impeccable` Claude Code plugin (v4.0.4, user scope, from `pbakaus/impeccable`) is installed — use `/impeccable` (audit, critique, polish, …) alongside the handoff bundle for all UI work.
- **Step 1 (API) is built** — see the FastAPI section above.
- **Steps 2–4 are built on branch `react-rebuild`** (as of 2026-08-26). `web/` is a Vite + React 18 + TypeScript app: all 7 tabs (Dashboard, Regime Lab, Markets, Credit, Recession, News & Calendar, Tools) plus Methodology and the assistant panel (`web/src/screens/shell/AssistantPanel.tsx` over `POST /api/assistant/ask`), a responsive foundation (`web/src/lib/useBreakpoint.ts` — mobile <480 / tablet <768 / desktop <1024 / wide; the sole width-conditional mechanism) and h1→h2→h3 heading semantics. Product and design contracts for it live in `web/PRODUCT.md` and `web/DESIGN.md`. A `Dockerfile` plus `docs/redesign/DEPLOY.md` describe two working deploys (split Vercel + backend host, or a single same-origin host). **The branch is pushed to origin as of 2026-09-10; nothing is merged or deployed.** Session ledger: `proposals/OVERNIGHT_BUILD_LOG.md`.
- **Do not commit, push, merge, or deploy any migration work without the user's explicit say-so.**
