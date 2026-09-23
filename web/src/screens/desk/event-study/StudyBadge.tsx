/**
 * The one badge an event-study card carries (DESK_FRAME2_SPEC §1, §3): the
 * standard `Live · {source} · as of {date}` badge, its stamp the response's
 * provenance `as_of`, its tone the freshness report's verdict for the stored
 * tables the study reads (provenance.inputs[].table: asset_prices,
 * desk_series), the weakest one winning. Before a study answers, or when
 * none can (404, 422, awaiting the first refresh), the badge carries no
 * "Live": the source and the state in a grey word (verifier V-08).
 */

import type { EventStudyResponse } from "../../../api/desk";
import type { SlaRow } from "../../../api/types";
import { fmtDate } from "../../../lib/format";
import StatusBadge from "../StatusBadge";
import type { BadgeSource } from "../badge-sources";
import { useFreshReport } from "../../shared/useFreshReport";

export const ENGINE_SOURCE = "event-study engine";

const RANK = { current: 0, delayed: 1, stale: 2, unavailable: 3 } as const;

/** Pure: the weakest report verdict across the tables a study reads (review
 * R-09): a table the report calls unavailable, or does not list at all, is
 * the weakest state and counts, never skipped. Null only when there is no
 * report yet or the study reads no stored table (the badge then stays grey). */
export function studyVerdict(tables: readonly string[], sla: readonly SlaRow[] | null | undefined): "current" | "delayed" | "stale" | "unavailable" | null {
  if (!sla) return null;
  let worst: keyof typeof RANK | null = null;
  for (const t of new Set(tables)) {
    const verdict = sla.find((r) => r.feed === t)?.verdict ?? "unavailable";
    if (worst == null || RANK[verdict] > RANK[worst]) worst = verdict;
  }
  return worst;
}

/** The tables the report does not judge, named in the badge's tooltip. */
function unjudged(tables: readonly string[], sla: readonly SlaRow[] | null | undefined): string[] {
  if (!sla) return [];
  return [...new Set(tables)].filter((t) => {
    const v = sla.find((r) => r.feed === t)?.verdict;
    return v == null || v === "unavailable";
  });
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
    reason: `Inputs as of ${bySeries || p.as_of}; sample ${p.data_start ?? p.sample_start} to ${p.sample_end}; tone from the freshness report's verdict on ${[...new Set(tables)].join(" and ") || "no stored table"}${unjudged(tables, sla).length ? `; unavailable or not in the report: ${unjudged(tables, sla).join(", ")}` : ""}`,
  };
}

/** No study on screen: the source and what it is doing, never "Live". */
export type StudyWait = "waiting" | "computing" | "busy" | "awaiting refresh" | "refused" | "not on this server" | "no answer";

export default function StudyBadge({ study, pending, wait = "waiting" }: { study: EventStudyResponse | null | undefined; pending?: string; wait?: StudyWait }) {
  const report = useFreshReport();
  if (!study) return <StatusBadge pending={{ label: ENGINE_SOURCE, word: wait, note: pending }} />;
  return <StatusBadge source={studySource(study, report.f?.sla, pending)} />;
}
