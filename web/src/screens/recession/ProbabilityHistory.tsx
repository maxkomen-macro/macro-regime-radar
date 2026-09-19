/**
 * The hero chart under the gauge (redesign Phase 7, checklist 07 B.1.2): the
 * model's monthly 12-month odds on `LineChart` behind a mono 24M / Full
 * history `Segmented`, with the NBER recessions shaded and the 20 / 40 band
 * edges as dashed rules (drawn only when they fall inside the plotted range,
 * so a quiet 24-month window shows the mockup's plain line and Full history
 * always shows both), named in a key row above the plot, never on it (G1). The window is local state: no hash, no storage. The
 * toggle only swaps the points array; nothing is re-derived. `showLast` is
 * off because the h1 above is the one current number.
 */

import { useState } from "react";
import { Segmented } from "../../components";
import type { RecessionMetrics } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import LineChart from "../dashboard/LineChart";
import { DASH } from "../dashboard/hero-copy";
import Jargon from "../shared/Jargon";
import { Caption, monoNoteStyle } from "../shared/screen-ui";
import { lastMonths, usrecBands } from "./recession-copy";

type HistoryWindow = "24m" | "full";

const WINDOW_OPTIONS = [
  { id: "24m", label: "24M" },
  { id: "full", label: "Full history" },
];

const RULES = [
  { y: 20, label: "20% Elevated" },
  { y: 40, label: "40% High Risk" },
];

export default function ProbabilityHistory({ m }: { m: RecessionMetrics }): JSX.Element {
  const [win, setWin] = useState<HistoryWindow>("24m");
  const series = m.recession_prob_series ?? [];
  const plotted = win === "24m" ? lastMonths(series, 24) : series;
  const prob = m.recession_prob ?? 0;
  const tail = series.length ? series[series.length - 1] : null;
  // LineChart draws a rule only when it falls inside the plotted range; the
  // key names exactly the rules on the plot. The words sit in this key row,
  // off the svg (Iteration 1 G1: drawn over the plot they overlapped it).
  const ys = plotted.map((p) => p.value).filter((v) => Number.isFinite(v));
  const drawn = ys.length ? RULES.filter((r) => r.y >= Math.min(...ys) && r.y <= Math.max(...ys)) : [];

  return (
    <div className="mrr-rec-history" style={{ width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "2px 0 6px" }}>
        <span data-role="rule-key" style={{ display: "inline-flex", flexWrap: "wrap", gap: 12, ...monoNoteStyle, marginTop: 0 }}>
          {drawn.map((r) => (
            <span key={r.y} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i aria-hidden="true" style={{ display: "inline-block", width: 16, borderTop: "1px dashed var(--line-strong)" }} />
              {r.label}
            </span>
          ))}
        </span>
        <Segmented mono label="History window" options={WINDOW_OPTIONS} value={win} onChange={(id) => setWin(id as HistoryWindow)} />
      </div>
      <LineChart
        series={[{ label: "Recession probability", color: "var(--amber)", points: plotted.map((p) => ({ x: p.date, y: p.value })) }]}
        height={win === "24m" ? 90 : 150}
        yFmt={(v) => `${v.toFixed(0)}%`}
        bands={usrecBands(m.usrec_series ?? [])}
        hlines={RULES.map(({ y }) => ({ y }))}
        showLast={false}
        caption="Model recession probability history with NBER recessions shaded"
      />
      <Caption mono>
        The model&apos;s 12-month odds, monthly since {plotted[0] ? fmtMonYr(plotted[0].date) : DASH}. Shaded bands are actual{" "}
        <Jargon term="NBER">NBER</Jargon> recessions, dashed rules the 20/40 band edges. The plotted tail ({tail ? `${tail.value.toFixed(0)}%` : DASH})
        is a partial-month fit; the headline {prob.toFixed(1)}% is the newest complete monthly read. Features enter with a 3-month lag so the line
        never peeks at data it wouldn&apos;t have had.
      </Caption>
    </div>
  );
}
