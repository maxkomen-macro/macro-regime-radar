# Release-readiness evidence (2026-09-06)

- `before/` — 40 full-page captures (10 routes × 390/768/1440/2160) taken before this pass, with `report.json` (document scrollWidth/clientWidth per capture; no horizontal overflow at baseline).
- `after/` — the same 40 captures after the pass (`report.json`: no horizontal overflow at any width; `tools-allocation-390/768` re-captured after the allocation cache warmed), plus interaction captures named `after-*.png`:
  - `after-markets-amzn-1440.png` — AMZN single-name panel: EODHD delayed quote label, EODHD 6M candles, yfinance fundamentals label
  - `after-options-lens-1440.png` — Options lens open (EODHD end-of-day, calls, page 1)
  - `after-tape-btc-ondemand-1440.png` — Macro tape row BTC-USD expanded to on-demand EODHD history (1D)
  - `after-regimelab-768.png`, `after-regimelab-390.png` — every Regime Lab view reachable (one row at 768, wrapped at 390)
  - `after-tools-allocation-1440.png` — exact sample sentence ("21 of 28 Goldilocks months have complete returns across all ten assets; 24 are required.")
  - `after-ai-panel-1440.png` — assistant panel with a stubbed SSE answer (markdown) and the disabled-state error
  - `after-news-1440.png` — News screen
  - `after-backend-stopped-*.png` — FastAPI stopped: shell on the validated snapshot (1440 and 390), News on the snapshot
  - `after-backend-restored-dashboard-1440.png` — after the API restart: status word back to Live (crypto/FX only, US session closed)
  - `after-news-snapshot-mode-1440.png` — News with `/api/news` blocked: the seeded window renders the stored feed
- `review-visual/` (REPORT.md + 133 captures), `review-technical/` (REPORT.md) — independent reviewer reports; reconciliation in `proposals/FINAL_RELEASE_READINESS.md` §9.
- `detector/` — the single Impeccable detector run after the last UI change (`run-1.json`), the confirmation run (`run-2-confirmation.json`) and the file list; two intentional `side-tab` rails, no suppression added.
- `after/after-fix-*.png` — captures after the review corrections: range switching without a crash (`markets-ranges-1440`), the Recession disclosure row at 768, the Dashboard at 390 without duplicated freshness chips.

Playwright console logs for the interaction runs live under `/Users/maxkomen/Projects/Macro/.playwright-mcp/` (not part of the repo).
