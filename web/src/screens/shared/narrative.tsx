/**
 * Narrative helpers shared by the Dashboard and Regime Lab desk reads
 * (redesign Phase 3, checklist 03 A.10). Copied from RegimeLabScreen.tsx so
 * both screens phrase the stored takeaway the same way; Phase 4 switches
 * Regime Lab to this module and deletes its local copies.
 */
import type React from "react";
import { tidyProse } from "../../lib/format";

/** Render the source module's <strong> emphasis without injecting HTML. */
export function parseStrong(narrative: string): React.ReactNode[] {
  return narrative.split(/<strong>(.*?)<\/strong>/g).map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: "var(--text)", fontWeight: 600 }}>
        {seg}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

/** First sentence as the lead, the rest as the body (both tidied). */
export function splitNarrative(narrative: string): { lead: string; rest: string } {
  const clean = tidyProse(narrative);
  const m = /^(.*?[.!?])(?:\s+|$)([\s\S]*)$/.exec(clean);
  if (!m) return { lead: clean, rest: "" };
  return { lead: m[1], rest: m[2] };
}

/** The closing sentence of a narrative (the implication), tidied, with the
 * <strong> tags stripped; the whole text when it holds a single sentence. A
 * sentence ends where splitNarrative says it does: terminal punctuation
 * followed by whitespace or the end, so "11.6%" never splits one. */
export function lastSentence(narrative: string): string {
  let text = tidyProse(narrative).replace(/<\/?strong>/g, "").trim();
  for (;;) {
    const m = /^(.*?[.!?])(?:\s+|$)([\s\S]*)$/.exec(text);
    if (!m) return text;
    const rest = m[2].trim();
    if (!rest) return m[1];
    text = rest;
  }
}
