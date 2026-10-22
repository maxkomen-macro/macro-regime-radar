/**
 * Top surprises panel (redesign Phase 5, checklist 05 B.6): the ten weekly
 * moves ranked by z-score as a DataTable (rank, release with its served
 * interpretation under it, the centre-anchored σ bar on today's 3σ scale, the
 * σ figure). Colour keys off the displayed one-decimal value, as today: a row
 * labeled "+1.5σ" is amber even when the raw z is 1.4501. No hooks: the screen
 * passes its query and the week stamp.
 */

import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable, DivergingBar, SectionHeader } from "../../components";
import type { Surprise } from "../../api/types";
import { fmtDate, fmtSigned, tidyProse } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, StateNote } from "../shared/screen-ui";
import { MetaWithStamp, Stamp } from "../shared/Stamp";

interface Props {
  surprises: { data: Surprise[] | undefined; isLoading: boolean; isError: boolean };
  surpriseWeek: string | null;
}

interface Row extends Surprise {
  id: string;
  rank: number;
}

/** `--neg` from 2.5σ, `--amber` from 1.5σ, else `--link`, off the displayed value. */
export function surpriseColor(z: number): string {
  const shown = Math.abs(Number(z.toFixed(1)));
  return shown >= 2.5 ? "var(--neg)" : shown >= 1.5 ? "var(--amber)" : "var(--link)";
}

/* The interpretation must wrap (DataTable cells are nowrap by contract), so
   the sub-line is composed inside the cell with the .mrr-nm block styling. */
const subLine: CSSProperties = {
  display: "block",
  whiteSpace: "normal",
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  lineHeight: 1.45,
  color: "var(--text-3)",
  marginTop: 2,
};

const COLUMNS = [
  {
    key: "rank",
    label: "#",
    width: "24px",
    mono: true,
    render: (r: Row) => <span style={{ color: "var(--text-3)" }}>{r.rank}</span>,
  },
  {
    key: "label",
    label: "Release",
    render: (r: Row) => (
      <div style={{ whiteSpace: "normal", minWidth: 0 }}>
        <span style={{ color: "var(--text)" }}>{r.label}</span>
        <span className="mrr-nm" style={subLine}>
          {tidyProse(r.interpretation)}
        </span>
      </div>
    ),
  },
  {
    key: "bar",
    label: "Surprise",
    align: "right" as const,
    width: "132px",
    render: (r: Row) => {
      const color = surpriseColor(r.z_score);
      return <DivergingBar value={r.z_score} max={3} width={120} positiveColor={color} negativeColor={color} style={{ marginLeft: "auto" }} />;
    },
  },
  {
    key: "z",
    label: "σ",
    align: "right" as const,
    mono: true,
    width: "56px",
    render: (r: Row) => <span style={{ fontWeight: 700, color: surpriseColor(r.z_score) }}>{fmtSigned(r.z_score, 1)}σ</span>,
  },
];

export default function TopSurprises({ surprises, surpriseWeek }: Props) {
  const rows: Row[] = (surprises.data ?? []).map((s, i) => ({ ...s, id: s.metric, rank: i + 1 }));
  return (
    <Card as="section" variant="panel" id="top-surprises" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Top surprises this week"
        description="Weekly moves ranked by z-score"
        right={
          <MetaWithStamp
            meta="weekly derived series"
            stamp={<Stamp source="Derived pipeline" asOf={surpriseWeek ? `week ending ${fmtDate(surpriseWeek)}` : null} />}
          />
        }
        actions={
          <Link className="mrr-link" to="/app/news#calendar">
            Calendar →
          </Link>
        }
      />
      {rows.length ? (
        <DataTable zebra={false} caption="Top surprises this week, ranked by z-score" columns={COLUMNS} rows={rows} />
      ) : (
        <StateNote>
          {surprises.isError
            ? "Surprise feed unavailable: the data service did not answer."
            : surprises.isLoading
              ? "Ranking the week's moves…"
              : "No surprise data on file for this week."}
        </StateNote>
      )}
      <Caption>
        Weekly moves ranked by <Jargon term="z-score">z-score</Jargon>: how far outside its own recent range each market
        traveled. Bars scale to 3σ; ±1.5σ turns amber, ±2.5σ red.
        {/* Provenance: these rows are the weekly derived-metrics pipeline,
            not the monthly signals snapshot the Dashboard cards read: a
            macro metric legitimately carries two levels across the app. */}
        <div style={{ marginTop: 2 }}>
          weekly derived series
          {surpriseWeek ? ` · week ending ${fmtDate(surpriseWeek)}` : ""} · macro rows read this pipeline, not the monthly
          signal prints on the dashboard; the same metric carries a different level on each surface.
        </div>
      </Caption>
    </Card>
  );
}
