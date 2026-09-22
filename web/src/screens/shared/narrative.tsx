/**
 * Narrative helpers shared by the Dashboard and Regime Lab desk reads
 * (redesign Phase 3, checklist 03 A.10). Copied from RegimeLabScreen.tsx so
 * both screens phrase the stored takeaway the same way; Phase 4 switches
 * Regime Lab to this module and deletes its local copies.
 */
import type React from "react";
import { tidyProse } from "../../lib/format";
import { splitSentences } from "../../lib/sentences";

const STRONG_OPEN = "<strong>";
const STRONG_CLOSE = "</strong>";
const countOf = (s: string, t: string) => s.split(t).length - 1;

/**
 * The first `n` sentences of a stored narrative that may carry the source
 * module's <strong> emphasis, and the rest (Iteration 1 step 5, G4: a
 * model-composed lede is capped by construction). Sentences are counted on
 * the text a reader sees (tags stripped, `splitSentences`), then cut at the
 * same place in the marked-up string; an emphasis span the cut divides is
 * closed in `shown` and reopened in `rest`. Whitespace is collapsed; nothing
 * else changes, so `shown + " " + rest` reads as the whole narrative.
 */
export function takeMarkedSentences(narrative: string, n: number): { shown: string; rest: string } {
  const clean = narrative.replace(/\s+/g, " ").trim();
  const plain = clean.split(STRONG_OPEN).join("").split(STRONG_CLOSE).join("");
  const all = splitSentences(plain);
  if (all.length <= n) return { shown: clean, rest: "" };
  const target = all.slice(0, n).join(" ").length;
  let i = 0;
  let count = 0;
  while (i < clean.length && count < target) {
    if (clean.startsWith(STRONG_OPEN, i)) i += STRONG_OPEN.length;
    else if (clean.startsWith(STRONG_CLOSE, i)) i += STRONG_CLOSE.length;
    else {
      i += 1;
      count += 1;
    }
  }
  while (clean.startsWith(STRONG_CLOSE, i)) i += STRONG_CLOSE.length;
  let shown = clean.slice(0, i).trim();
  let rest = clean.slice(i).trim();
  if (countOf(shown, STRONG_OPEN) > countOf(shown, STRONG_CLOSE)) {
    shown += STRONG_CLOSE;
    rest = STRONG_OPEN + rest;
  }
  return { shown, rest };
}

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
