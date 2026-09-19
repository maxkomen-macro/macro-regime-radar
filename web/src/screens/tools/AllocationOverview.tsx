/**
 * Regime-conditional performance, `Card as="section" id="allocation-overview"`
 * (redesign Phase 9, checklist 09 B.10): the current-regime chip in its hue
 * with the model-odds meta, then the asset × regime matrix on HeatMatrix
 * (annualized return and Sharpe per cell, the current column marked " ←", a
 * final "months in regime" row) and the T22 caption citing a real
 * positive-return / negative-Sharpe cell. Every figure is a served
 * `regime_stats` field; nothing is re-derived here.
 */

import { Card, HeatMatrix, SectionHeader, Tag } from "../../components";
import type { HeatCell } from "../../components/data/HeatMatrix";
import type { AllocationData } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import Disclosure from "../shared/Disclosure";
import Jargon from "../shared/Jargon";
import ScrollTable from "../shared/ScrollTable";
import { Caption, monoNoteStyle } from "../shared/screen-ui";
import { DASH, REGIME_HUE, assetNames, pct, regimesOf, retTint, spct } from "./AllocationPanel";

export default function AllocationOverview({ a }: { a: AllocationData }) {
  const regimes = regimesOf(a);
  const names = assetNames(a);
  const cur = a.current_regime;
  const hue = REGIME_HUE[cur] ?? "var(--text-3)";

  const cell = (asset: string, r: string): HeatCell => {
    const s = a.regime_stats[r];
    const m = s?.mean?.[asset] ?? null;
    const sr = s?.sharpe?.[asset] ?? null;
    // One wrapping span: the HeatMatrix cell is a grid, so two sibling spans
    // would stack as two rows instead of reading as one line.
    return {
      value: m,
      text: (
        <span style={{ whiteSpace: "nowrap" }}>
          <span style={{ color: m != null && m < 0 ? "var(--neg)" : "var(--text)" }}>{m != null ? spct(m) : DASH}</span>
          <span style={{ color: "var(--text-3)" }}> · SR {sr != null ? sr.toFixed(2) : DASH}</span>
        </span>
      ),
    };
  };

  return (
    <Card as="section" id="allocation-overview" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Regime-conditional performance"
        right={`${a.n_months} months · ${fmtMonYr(`${a.data_start}-01`)} → ${fmtMonYr(`${a.data_end}-01`)} · risk-free ${pct(a.rf_rate, 2)} (Fed Funds)`}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {/* The regime chip wears the regime's own 12%/25% treatment, matching
            the column header below — never the accent (critique). */}
        <Tag
          tone="reference"
          size="sm"
          style={{
            color: hue,
            background: `color-mix(in srgb, ${hue} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${hue} 25%, transparent)`,
          }}
        >
          {cur}
        </Tag>
        <span style={monoNoteStyle}>
          {a.dominant_prob != null ? `${Math.round(a.dominant_prob * 100)}% model odds` : ""}
          {" · "}
          <Jargon term="conviction">conviction</Jargon> {Math.round(a.confidence * 100)}% (a
          separate heuristic, not odds); read the current column first
        </span>
      </div>
      {/* Ten asset rows across four regime columns need ~640px; below that the
          matrix scrolls inside its own well rather than widening the page. */}
      <ScrollTable label="Regime-conditional performance">
        <HeatMatrix
          ariaLabel="Regime-conditional performance"
          rowHeaderWidth={150}
          cellHeight={30}
          gap={4}
          rows={[
            ...names.map((n) => ({ key: n, label: n })),
            { key: "n", label: <span style={{ color: "var(--text-3)" }}>months in regime</span> },
          ]}
          cols={regimes.map((r) => ({
            key: r,
            label: (
              <span style={{ color: r === cur ? hue : undefined }}>
                {r}
                {r === cur ? " ←" : ""}
              </span>
            ),
          }))}
          cells={[
            ...names.map((n) => regimes.map((r) => cell(n, r))),
            regimes.map((r) => ({ value: null, text: `n=${a.regime_stats[r].n_months}` })),
          ]}
          tint={(c, ri) => (ri === names.length ? "transparent" : retTint(c.value))}
          style={{ minWidth: 640 }}
        />
      </ScrollTable>
      <Caption>
        Annualized return and <Jargon term="Sharpe">Sharpe</Jargon> per regime since{" "}
        {fmtMonYr(`${a.data_start}-01`)}.{" "}
        {(() => {
          // Cite a REAL positive-return / negative-Sharpe cell — the
          // combination the table exists to expose.
          for (const r of regimes) {
            const s = a.regime_stats[r];
            for (const asset of names) {
              const m = s?.mean?.[asset];
              const sr = s?.sharpe?.[asset];
              if (m != null && sr != null && m > 0 && sr < 0) {
                return (
                  <>
                    A positive return with a negative Sharpe ({asset} prints {spct(m)} in{" "}
                    {r} at SR {sr.toFixed(2)}) means the return does not cover cash plus
                    the risk taken.
                  </>
                );
              }
            }
          }
          return <>A negative Sharpe means the return does not cover cash plus the risk taken.</>;
        })()}
      </Caption>
      {/* G4 (Iteration 1 step 5): two visible sentences; the third behind Details. */}
      <Disclosure variant="quiet" title="Details" style={{ marginTop: 2 }}>
        <Caption style={{ marginTop: 0 }}>Small n columns are anecdotes, not laws.</Caption>
      </Disclosure>
    </Card>
  );
}
