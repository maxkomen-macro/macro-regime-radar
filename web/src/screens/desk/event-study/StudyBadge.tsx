/**
 * The one badge an event-study card carries (DESK_FRAME2_SPEC §1, §3): the
 * standard `Live · {source} · as of {date}` badge, its stamp the response's
 * provenance `as_of`, its tone the freshness report's verdict for the stored
 * tables the study reads (provenance.inputs[].table: asset_prices,
 * desk_series), the weakest one winning. Before a study answers there is no
 * stamp and the badge reads "as of unknown", grey. Nothing is hand-typed.
 */

import type { EventStudyResponse } from "../../../api/desk";
import type { SlaRow } from "../../../api/types";
import { fmtDate } from "../../../lib/format";
import StatusBadge from "../StatusBadge";
import type { BadgeSource } from "../badge-sources";
import { useFreshReport } from "../../shared/useFreshReport";

export const ENGINE_SOURCE = "event-study engine";

const RANK = { current: 0, delayed: 1, stale: 2 } as const;

/** Pure: the weakest report verdict across the tables a study reads; null
 * when the report judges none of them (the badge then stays grey). */
export function studyVerdict(tables: readonly string[], sla: readonly SlaRow[] | null | undefined): "current" | "delayed" | "stale" | null {
  let worst: "current" | "delayed" | "stale" | null = null;
  for (const t of new Set(tables)) {
    const row = sla?.find((r) => r.feed === t);
    if (!row || row.verdict === "unavailable") continue;
    if (worst == null || RANK[row.verdict] > RANK[worst]) worst = row.verdict;
  }
  return worst;
}

/** Pure: the badge source for a study, or the unstamped one before it answers. */
export function studySource(study: EventStudyResponse | null | undefined, sla: readonly SlaRow[] | null | undefined, pending?: string): BadgeSource {
  if (!study) return { label: ENGINE_SOURCE, asOf: null, reason: pending ?? "No study has answered yet." };
  const p = study.provenance;
  const tables = p.inputs.map((i) => i.table);
  const bySeries = Object.entries(p.as_of_by_series)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return {
    label: ENGINE_SOURCE,
    asOf: fmtDate(p.as_of),
    verdict: studyVerdict(tables, sla),
    reason: `Inputs as of ${bySeries || p.as_of}; sample ${p.sample_start} to ${p.sample_end}; tone from the freshness report's verdict on ${[...new Set(tables)].join(" and ") || "no stored table"}`,
  };
}

export default function StudyBadge({ study, pending }: { study: EventStudyResponse | null | undefined; pending?: string }) {
  const report = useFreshReport();
  return <StatusBadge source={studySource(study, report.f?.sla, pending)} />;
}
