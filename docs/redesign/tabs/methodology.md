# Methodology

Screenshot: [methodology.png](../screenshots/methodology.png) · `methodology.py::render_methodology()` — 100% static `st.markdown` reference (zero DB reads, zero iframes; module docstring still says "5 sections," actual count 8).

## Elements (top → bottom)
1. REGIME FRAMEWORK — 4-regime table + 3 prose paragraphs (growth/inflation trend, conviction formula)
2. SIGNAL DEFINITIONS — 5-row table (measure, threshold, trigger, FRED source)
3. THRESHOLD PROXIMITY — fill% formula prose + Clear/Watch/Triggered table
4. DATA SOURCES & UPDATE CADENCE — sources table + pipeline-schedule table
5. METHODOLOGY NOTES — 4 bullet paragraphs
6. RECESSION PROBABILITY MODEL — 8-row component table + limitation prose
7. LBO CALCULATOR — data-sources + model-mechanics tables, IRR threshold legend, sensitivity prose
8. MARKET INTELLIGENCE — 6-row components table + conviction-scoring table + limitations

## Unlabeled
n/a (no charts) — but this is where several other tabs' missing legends actually live (IRR colors, recession thresholds), stranded far from the numbers they explain.

## Text walls
≈**1,460 words of static copy** (≈660 flowing prose + ≈795 table text). Largest offenders: Market Intelligence section ≈390 words; Regime Framework ≈240 (its conviction paragraph alone ≈85–90 words — the only single block over the 80-word bar); Recession Model ≈195; Methodology Notes ≈174. This is the "wall of cold text" complaint incarnate.

## Stale
- **Data Sources table and pipeline schedule still name Polygon.io** as the market-data provider — migrated to yfinance 2026-05-26; dormant-legacy source presented as live (matches the app-wide footer "Data: FRED · Polygon.io · Yahoo Finance" and the sidebar's "Phase 3 + Trader Pack" caption — three stale branding surfaces).
- Recession thresholds documented as 20/40% — contradicts the Recession tab's 33/60% gauge bands.
- No Asset Allocation section despite that tab being the app's most complex.

## Scroll
4273px ÷ 900px = **4.7× — flag; the tallest tab in the app**, all of it static.

## Overlap
Every section re-documents a live tab (regimes, signals, recession, LBO, intelligence) — pure reference duplication, which is fine *as reference* but wrong as a peer nav slot.

## Verdict
**Kill as a tab** (per redesign constraint): move to a persistent header/footer "Methodology" link opening a doc page/modal, split into per-feature popovers next to the numbers they explain, and fix the Polygon/threshold staleness in the same pass.
