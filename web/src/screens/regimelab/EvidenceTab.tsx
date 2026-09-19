/**
 * Empirical evidence sub-tab (redesign Phase 4, checklist 04 B.10): the
 * backtests table and the factor-returns grid moved from RegimeLabScreen.tsx
 * BacktestsSection. The cohort column became DataTable group rows (the
 * cohort names are the group labels, C.4 #7), the By regime / By signal
 * toggle is a mono Segmented, and the factor table is a HeatMatrix with a
 * signed tint that saturates at ±30 %/yr (G9); the signed number sits in
 * every cell so colour never carries the meaning alone.
 *
 * Confusion-index items kept: #12 small-sample hit rates (the ▪ flag),
 * #21 cohort names, #22 the coin-flip line.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable, HeatMatrix, SectionHeader, Segmented } from "../../components";
import type { HeatCell } from "../../components/data/HeatMatrix";
import { useAllocation, useBacktests } from "../../api/queries";
import type { BacktestRow } from "../../api/types";
import { fmtDate, fmtMonYr, fmtProb } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Jargon from "../shared/Jargon";
import ScrollTable from "../shared/ScrollTable";
import { Caption, StateNote } from "../shared/screen-ui";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import { REGIMES, regimeOrder } from "./regime-history";

export const COHORT_NAMES: Record<string, string> = {
  cpi_hot: "Inflation hot · CPI above 4%",
  cpi_cold: "Inflation cold · CPI below 1%",
  unemployment_spike: "Unemployment spike · +0.3pp vs 12m low",
  vix_spike: "VIX spike · above 30",
  yield_curve_inversion: "Curve inversion · 2s10s below 0",
};

/** The null-value glyph today's tables print (U+2014). */
const DASH = "\u2014";

/** ▪ flags fragility: tiny samples and extreme hit rates (a 100% on four
 * samples is exactly what a quant reader probes). */
function isSmall(r: BacktestRow): boolean {
  return ((r.n ?? 0) > 0 && (r.n ?? 0) <= 4) || r.hit_rate === 1 || r.hit_rate === 0;
}

const signedPct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/**
 * Signed return tint: mint for a positive annualized return, red for a
 * negative one, saturating at ±30 %/yr; null and zero paint nothing.
 * Alpha runs .06 to .40 (a visual scale the design lead may tune).
 */
export function signedTint(cell: HeatCell): string {
  const v = cell.value;
  if (v == null || !Number.isFinite(v) || v === 0) return "transparent";
  const a = 0.06 + 0.34 * Math.min(1, Math.abs(v) / 0.3);
  return `rgba(${v > 0 ? "38,220,160" : "240,80,63"},${Number(a.toFixed(4))})`;
}

type KeyedRow = BacktestRow & { id: string };

const BACKTEST_COLUMNS = [
  { key: "horizon", label: "Horizon", mono: true, align: "right" as const },
  {
    key: "avg_return",
    label: "Avg return",
    mono: true,
    align: "right" as const,
    render: (r: KeyedRow) =>
      r.avg_return != null ? <span style={{ color: r.avg_return >= 0 ? "var(--pos)" : "var(--neg)" }}>{signedPct(r.avg_return)}</span> : DASH,
  },
  {
    key: "median_return",
    label: "Median",
    mono: true,
    align: "right" as const,
    render: (r: KeyedRow) => <span style={{ color: "var(--text-3)" }}>{r.median_return != null ? signedPct(r.median_return) : DASH}</span>,
  },
  {
    key: "hit_rate",
    label: "Hit rate",
    mono: true,
    align: "right" as const,
    render: (r: KeyedRow) => {
      if (r.hit_rate == null) return DASH;
      const small = isSmall(r);
      return (
        <span style={{ color: small ? "var(--amber)" : "var(--text)" }}>
          {fmtProb(r.hit_rate)}
          {small ? " ▪" : ""}
        </span>
      );
    },
  },
  {
    key: "n",
    label: "N",
    mono: true,
    align: "right" as const,
    render: (r: KeyedRow) => <span style={{ color: "var(--text-3)" }}>{r.n != null ? r.n.toFixed(0) : DASH}</span>,
  },
];

const KIND_OPTIONS = [
  { id: "regime", label: "By regime" },
  { id: "signal", label: "By signal" },
];

export default function EvidenceTab() {
  const q = useBacktests();
  const alloc = useAllocation();
  const { isNarrow } = useBreakpoint();
  const [kind, setKind] = useState<"regime" | "signal">("regime");

  const groups = useMemo(() => {
    const filtered = (q.data ?? []).filter((r) => (kind === "regime" ? r.test_name.startsWith("SPY_regime_") : r.test_name.startsWith("SPY_signal_")));
    // House regime order (GL → OV → ST → RR), matching the factor grid below.
    const sorted = [...filtered].sort((a, b) => regimeOrder(a.cohort) - regimeOrder(b.cohort) || a.cohort.localeCompare(b.cohort));
    const out: { key: string; label: string; rows: KeyedRow[] }[] = [];
    for (const r of sorted) {
      const row: KeyedRow = { ...r, id: `${r.cohort}-${r.horizon}` };
      const last = out[out.length - 1];
      if (last && last.key === r.cohort) last.rows.push(row);
      else out.push({ key: r.cohort, label: COHORT_NAMES[r.cohort] ?? r.cohort, rows: [row] });
    }
    return out;
  }, [q.data, kind]);
  const computedAt = q.data?.[0]?.computed_at?.slice(0, 10) ?? null;

  const factorNames = useMemo(
    () => (alloc.data ? [...new Set(Object.values(alloc.data.regime_factors).flatMap((f) => Object.keys(f)))] : []),
    [alloc.data],
  );
  const factorCells = useMemo(
    () =>
      factorNames.map((f) =>
        REGIMES.map((regime): HeatCell => {
          const v = alloc.data?.regime_factors[regime]?.[f] ?? null;
          return {
            value: v,
            text: v != null ? <span style={{ color: v < 0 ? "var(--neg)" : "var(--pos)" }}>{signedPct(v)}</span> : DASH,
          };
        }),
      ),
    [alloc.data, factorNames],
  );

  return (
    <Card as="section" variant="panel" id="backtests" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Backtests & factor attribution"
        right={
          <MetaWithStamp
            meta="Stored empirical analysis · SPY forward returns"
            stamp={<Stamp source={SRC.backtests} asOf={computedAt ? `computed ${fmtDate(computedAt)}` : null} />}
          />
        }
        actions={<Segmented mono label="Backtest cohorts" value={kind} onChange={(id) => setKind(id as "regime" | "signal")} options={KIND_OPTIONS} />}
      />
      {groups.length ? (
        <Card variant="tile" style={{ minWidth: 0 }}>
          <ScrollTable stickyFirst={false} label="Backtests table">
            {/* Below 768 the table keeps the width its columns need and the
                well scrolls it, so the header rule spans the scrolled width. */}
            <DataTable compact zebra={false} caption="Backtests" columns={BACKTEST_COLUMNS} groups={groups} style={{ minWidth: isNarrow ? 674 : undefined }} />
          </ScrollTable>
          <Caption>
            SPY forward returns after each {kind === "regime" ? "regime began" : "signal fired"}, measured over trading-day horizons
            (1M=21d … 12M=252d). ▪ flags fragile cells: four or fewer samples, or a perfect 100%/0%{" "}
            <Jargon term="hit rate">hit rate</Jargon>, which is a small base, not a guarantee. 50% is a coin flip; read hit rates
            against that line, not zero.
          </Caption>
        </Card>
      ) : (
        <Card variant="tile">
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}

      <SectionHeader level="sub" as="h3" title="Factor returns by regime · annualized" style={{ margin: "14px 0 6px" }} />
      {alloc.data && factorNames.length ? (
        <Card variant="tile" style={{ minWidth: 0 }}>
          {/* A label column plus four regime columns needs ~560px; below 768
              the well scrolls instead of crushing the factor names. */}
          <ScrollTable stickyFirst={false} label="Factor returns table">
            <HeatMatrix
              ariaLabel="Factor returns by regime"
              corner="Factor"
              rowHeaderWidth={120}
              cellHeight={30}
              rows={factorNames.map((f) => ({ key: f, label: f }))}
              cols={REGIMES.map((r) => ({ key: r, label: r }))}
              cells={factorCells}
              tint={signedTint}
              style={{ minWidth: isNarrow ? 560 : undefined }}
            />
          </ScrollTable>
          <Caption>
            Long/short ETF-proxy factors (Value, Momentum, Quality, Size, Low Vol) annualized inside each regime&apos;s months: which
            styles actually paid in each weather. Full portfolio-level attribution lives in{" "}
            <Link to="/app/tools#allocation">Tools → Allocation → Risk</Link>.
          </Caption>
          <Stamp block source={SRC.allocation} asOf={alloc.data.data_end ? `returns through ${fmtMonYr(`${alloc.data.data_end}-01`)}` : null} />
        </Card>
      ) : (
        <Card variant="tile">
          {alloc.isLoading ? (
            <StateNote loading>Factor table computes on the allocation engine; up to a minute cold, then cached an hour.</StateNote>
          ) : (
            <StateNote>Factor history unavailable: the allocation engine could not reach its data vendor.</StateNote>
          )}
        </Card>
      )}
    </Card>
  );
}
