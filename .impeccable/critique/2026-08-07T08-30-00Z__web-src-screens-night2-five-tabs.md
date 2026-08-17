# Critique + Audit Snapshot — Night-2 Five Tabs (+ Methodology)

Date: 2026-08-07 · Method: dual isolated agents (design critique + technical
audit) over screen source + 1440px rendered captures, synthesized by the build
session; one fix iteration applied per tab. First snapshot for this slug.

## Scores

Design critique (a/b/c/d/e = heuristics · voice · confusion-index · specificity
· hierarchy, /40): Regime Lab **30** · Credit **35** · Recession **29** ·
News & Calendar **25** · Tools **26**.

Technical audit (/4): A11y **2** · Perf **2** · Responsive **1** · Theming
**2** · Integrity **2** — pre-fix state; the P0/P1 drivers are addressed below.

## P0s (all fixed)

1. Allocation style table rendered four blank column headers (self-closing
   span) — headers now render.
2. Server fabricated missing quant inputs (`or 0.0` recession prob, `or 50` HY
   percentile) and the client narrated them as measured — now degrade to 503.
3. Recession showed two "current" probabilities (gauge 14.5% vs chart tail
   12%) — legend value suppressed (`showLast=false`), caption states
   partial-month tail vs newest complete read.
4. News rendered verbatim duplicate headlines under a "DEDUPED" header —
   client-side normalized-headline dedupe (pipeline fix logged for owner).
5. Fallback method cards printed `SR 0.00` beside +10.5%/8.7% (arithmetic
   impossibility) — now `SR —` + "equal weight — Sharpe not computed".
6. Regime Lab showed two "average spell" numbers (literature 6.1 vs measured
   4.2) — labeled literature vs measured, single owner per number.
7. LBO fee slider moves returns the wrong way (fees reduce the modeled equity
   check, flattering MOIC/IRR) — **backend, owner item**; the caption now
   prints the fee line so the arithmetic is visible.
   **Update 2026-08-07 (owner-directed follow-up): fixed** —
   `src/analytics/lbo.py` now computes `entry_equity = entry_ev + fees −
   entry_debt`; pinned by `test_api_lbo_fee_direction`; React caption
   rewritten to sources/uses; screenshot refreshed.

## P1s fixed (selection)

Credit: IG series stretched against HY (per-series index x-mapping) → date
intersection; NBER bands invisible at faint@12% → line-strong@28% + edge
strokes; client-side "deterioration" probability derivation removed;
unconditional captions now branch on the data; Tight row renders "—" when the
state never occurred. Recession: 20/40 dashed rules on the probability chart;
"since the mid-90s" → derived series start; unemployment's negative sign
explained; band legend beside the gauge; sensitivity trigger previews live
inputs; sensitivity/scenario/LBO queries keep previous data during refetch
(no blanking); baseline peeks the cache instead of retraining mid-drag; both
recession caches locked; feature vector assembled by name. Regime Lab: 6M
"stays" row restored (sums to ~100); Gantt viewBox 1385 (chart chrome back to
9px); scenario builder defaults to the first preset; ▪ extended to 100%/0% hit
rates; backtest rows in house regime order; fourth-wall caption cut. News:
window leak fixed server-side (lexicographic published_at); `manual_csv` →
"hand-maintained"; elapsed events muted + labeled; capped counter marked
"150+"; zero categories render "—"; sort stated in the header; one clock
format; summaries clamped. Tools: IRR mid-band accent → amber (One Accent
Rule); regime chip wears regime treatment; weights unit in the eyebrow +
canonical method labels; frontier ticks + right-axis labels + clip-proof
marker labels; sensitivity outlines the server's own center (banker's
rounding); EBITDA slider re-ranged 10–1000; empty 8th cell → method-family
legend; factor×regime table single-homed on Regime Lab; dev-log copy
rewritten. Shell: freshness line states "live tape ticking via stream" when
the stream is live. Methodology: status column de-repeated; null
direction/threshold render "—"; legends on tokens (one palette with the gauge).

## Logged, not applied (owner / token level)

- ~~`src/analytics/lbo.py` fee-direction convention (P0 #7 above)~~ — fixed
  same-day on the owner's direction.
- CPI 3.46% (derived weekly pipeline) vs 3.73% (signals) on two tabs; VIX
  15.15 vs 16.50 — two pipelines, one metric, needs a reconciling label or a
  single source. Same family: surprise "week ending" stamps dated into the
  future by the Friday-stamp convention.
- Server-provided colors the client now ignores for display (recession band
  hex, divergence color, analogue similarity color, `MEDIUM CONVICTION`
  accent) — palette unification belongs in the source modules.
- HRP fallback dict omits `converged: False` (method-name sniff in client).
- Regime hex maps triplicated client-side; ~25 improvised rgba tints; missing
  `--research-text` token for `#a78bfa`; `--warn-hot`/Overheating collision.
- Flat span-grids lack table semantics (row-structured grids and DataTable
  are fine); NewsCard deal-size bucket rides the ticker slot.
- Responsive: fixed grids below ~1000px remain deliberately deferred — now
  stated here; the widest grids scroll with min-widths.
- `_classify_prob` private import (src frozen this session).
- LineChart x-labels are index-sampled, not decade-anchored.
