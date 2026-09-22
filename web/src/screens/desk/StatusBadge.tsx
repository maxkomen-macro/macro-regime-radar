/**
 * The status badge every Desk panel carries (docs/desk/DESK_FRAME_SPEC.md §3):
 * `● Live · {source} · as of {timestamp}` in mint, or `Designed` in the muted
 * style. Nothing here is hand-typed: the stamp, the tone and the tooltip
 * sentence come from /api/freshness through useFreshReport (fresh-state.ts,
 * the app's one freshness vocabulary), or, for a feed the report does not
 * judge, from the payload's own stamp and four-word verdict. "Live" is the
 * panel's wiring word (it reads the API); the freshness truth rides beside it
 * in the glyph, the stamp and the muted tail. Colour follows the server's
 * judgement: mint only while the source is current (a live tick or the newest
 * close or print due), amber when delayed, warn-hot when stale
 * (`▾ Live · FRED · as of Sep 04 · 8 days behind`), grey when unknown, a
 * stated default, or a seeded snapshot (`◇ Snapshot · …`, no health mark). A
 * panel with no data source declares Designed.
 */

import type { BadgeSource } from "./badge-sources";
import { labelText, stampLabel, type FreshLabel, type FreshTone } from "../shared/fresh-state";
import { useFreshReport } from "../shared/useFreshReport";

interface Props {
  /** A designed shell: the muted word, no source. */
  designed?: boolean;
  source?: BadgeSource;
  /** Tooltip for a designed panel. */
  note?: string;
  id?: string;
}

function glyphFor(tone: FreshTone): string {
  switch (tone) {
    case "live":
    case "delayed":
    case "neutral":
      return "●";
    case "stale":
      return "▾";
    default:
      return "◇";
  }
}

/** The New York clock of a relay tick, for a live state's stamp. */
function etClock(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const ms = Date.parse(asOf.replace(" ", "T"));
  if (!Number.isFinite(ms)) return null;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms))} ET`;
}

/** Pure: the words the badge prints for a label. */
export function badgeWords(label: FreshLabel, seeded: boolean, liveAsOf?: string | null, dated = false): { word: string; stamp: string; muted: string | null } {
  if (seeded) return { word: "Snapshot", stamp: label.word.replace(/^Snapshot · as of /, ""), muted: null };
  // A feed the report does not judge carries its own stamp (stampLabel): the
  // stamp is the word, and the tone stays grey (never a health mark).
  // With no stamp yet the label's word is "As of unknown", and the badge prints
  // its own "as of " (desk/integration: "as of As of unknown").
  if (dated) return { word: "Live", stamp: label.word.replace(/^As of /, ""), muted: null };
  if (label.tone === "live") return { word: "Live", stamp: etClock(liveAsOf) ?? "live tick", muted: null };
  if (label.tone === "unknown" || label.tone === "fallback") return { word: "Live", stamp: label.tone === "fallback" ? "stated default" : "unknown", muted: null };
  return { word: "Live", stamp: label.word, muted: label.muted };
}

export function StatusBadge({ designed, source, note, id }: Props) {
  const report = useFreshReport();
  if (designed || !source) {
    return (
      <span id={id} className="mrr-desk-badge" data-state="designed" data-testid="desk-badge" title={note ?? "Designed: the layout, controls and empty states are real; no data source is wired yet."}>
        Designed
      </span>
    );
  }
  const dated = !source.ids?.length;
  const label: FreshLabel = !dated ? report.group(source.ids!, source.block) : stampLabel(source.asOf, source.reason ?? "");
  const liveAsOf = source.ids?.length === 1 ? (report.f?.series?.find((s) => s.id === source.ids?.[0])?.as_of ?? null) : null;
  const { word, stamp, muted } = badgeWords(label, report.seeded, liveAsOf, dated);
  const title = [`${source.label}: ${labelText(label)}`, label.reason].filter(Boolean).join(". ");
  const verdictTone: FreshTone = source.verdict === "current" ? "neutral" : source.verdict === "delayed" ? "delayed" : source.verdict === "stale" ? "stale" : "unknown";
  const tone: FreshTone = report.seeded ? "unknown" : dated ? (source.asOf ? verdictTone : "unknown") : label.tone;
  return (
    <span id={id} className="mrr-desk-badge" data-state="live" data-tone={tone} data-stale={label.stale ? "true" : undefined} data-testid="desk-badge" title={title}>
      <span className="glyph" aria-hidden="true">
        {report.seeded ? "◇" : glyphFor(tone)}
      </span>
      <span className="word">{word}</span>
      <span className="muted" aria-hidden="true">
        ·
      </span>
      <span>{source.label}</span>
      <span className="muted" aria-hidden="true">
        ·
      </span>
      <span className="stamp">as of {stamp}</span>
      {muted ? <span className="muted">{muted}</span> : null}
    </span>
  );
}

export default StatusBadge;
