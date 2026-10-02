/**
 * What's priced panel (redesign Phase 5, checklist 05 B.8): the six served
 * metrics (written every full refresh, each dated by its observation month) in their three served groups as tiles, each a plain table
 * with the metric name as a row header (so FED FUNDS and SOFR stay harvested),
 * the level and the month-on-month change with the StatTile glyph rule. 1W
 * and 1Y-range columns are not served (F1) and are not drawn. `useBreakpoint`
 * is the only hook: the screen passes its query, groups, captions and the
 * breakeven term note.
 */

import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader } from "../../components";
import type { PricedMetric } from "../../api/types";
import { fmtSigned } from "../../lib/format";
import { pricedMonths, pricedWhen } from "../shared/priced-when";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Caption, StateNote } from "../shared/screen-ui";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";

interface Props {
  priced: { data: PricedMetric[] | undefined; isLoading: boolean; isError: boolean };
  pricedGroups: [string, PricedMetric[]][];
  groupCaptions: Record<string, ReactNode>;
  beTermNote: string | null;
}

/* The DataTable TH values (mono 10.5px uppercase --text-3 over a --line rule). */
const TH: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  padding: "0 0 8px 10px",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
  textAlign: "right",
};

const ROW_CELL: CSSProperties = {
  height: 38,
  borderBottom: "1px solid var(--line-2)",
  verticalAlign: "middle",
};

const DIR: Record<"up" | "down" | "flat", [string, string]> = {
  up: ["▲", "var(--pos)"],
  down: ["▼", "var(--neg)"],
  flat: ["→", "var(--neutral)"],
};

function direction(mom: number | null): "up" | "down" | "flat" {
  return mom != null && mom !== 0 ? (mom > 0 ? "up" : "down") : "flat";
}

export default function WhatsPriced({ priced, pricedGroups, groupCaptions, beTermNote }: Props) {
  const { isNarrow } = useBreakpoint();
  // fix/freshness 4: each metric's observation month, never the run that wrote it.
  const months = priced.data?.length ? pricedMonths(priced.data) : null;
  const report = useFreshReport();
  return (
    <Card as="section" variant="panel" id="whats-priced-full" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="What's priced"
        description="Market-implied path for policy, inflation and real rates"
        right={
          <MetaWithStamp meta="FRED · each metric's own month" stamp={<Stamp source={SRC.fred} asOf={months} />} />
        }
        actions={
          <Link className="mrr-link" to="/app/methodology#data">
            Methodology →
          </Link>
        }
      />
      {pricedGroups.length ? (
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: "var(--gap-tile)" }}>
          {pricedGroups.map(([group, metrics]) => (
            <Card key={group} variant="tile" padding="12px 16px 6px" style={{ minWidth: 0 }}>
              <SectionHeader level="sub" as="h3" title={group} style={{ marginTop: 0, marginBottom: 2 }} />
              <table className="mrr-priced" aria-label={`${group}: what is priced`} style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th scope="col" className="sr-only">
                      Metric
                    </th>
                    <th scope="col" style={TH}>
                      Level
                    </th>
                    <th scope="col" style={TH}>
                      MoM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((p) => {
                    const [glyph, color] = DIR[direction(p.mom_chg)];
                    return (
                      <tr key={p.metric}>
                        <th scope="row" style={ROW_CELL}>
                          {p.label}
                          {pricedWhen(p) ? <span style={{ color: "var(--text-3)", fontWeight: 400 }}>{` · ${pricedWhen(p)}`}</span> : null}
                        </th>
                        <td
                          style={{
                            ...ROW_CELL,
                            textAlign: "right",
                            paddingLeft: 10,
                            font: "500 14px var(--font-ui)",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.value.toFixed(2)}
                          {p.unit}
                        </td>
                        <td
                          style={{
                            ...ROW_CELL,
                            textAlign: "right",
                            paddingLeft: 10,
                            fontSize: 12.5,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                            color: p.mom_chg != null ? color : "var(--text-3)",
                          }}
                        >
                          {/* The change of a percent-level series is pp, not %;
                              the term-structure note below already says pp. */}
                          {p.mom_chg != null ? `${glyph} ${fmtSigned(p.mom_chg)}${p.unit === "%" ? "pp" : p.unit}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Caption>{groupCaptions[group] ?? null}</Caption>
              {/* A1: the group's FRED series, their weakest state (§5). */}
              <Stamp block source={SRC.fred} label={report.group(metrics.map((m) => m.metric))} style={{ marginTop: 4, marginBottom: 6 }} />
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="tile" style={{ minWidth: 0 }}>
          <StateNote>
            {priced.isError
              ? "Market-implied pricing unavailable: the data service did not answer."
              : priced.isLoading
                ? "Reading market-implied pricing…"
                : "No priced metrics on file; the full refresh has not written them yet."}
          </StateNote>
        </Card>
      )}
      {beTermNote ? (
        <Caption style={{ marginTop: 8 }}>
          {beTermNote} <span style={{ color: "var(--text-3)" }}>· composed from stored data</span>
        </Caption>
      ) : null}
      <Caption style={{ marginTop: beTermNote ? 2 : 8 }}>
        Written by every full refresh from the stored FRED rows, each dated by its own observation month; levels can differ from the monthly
        signal prints on the dashboard.
      </Caption>
    </Card>
  );
}
