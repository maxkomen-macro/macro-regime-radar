/**
 * Sentence splitting for stored model prose (Iteration 1, N4). The News cards
 * show at most four sentences of a stored AI read and move the remainder
 * behind a nested "Details" disclosure, so the split must never cut inside an
 * abbreviation ("U.S. Treasury"), an initial ("J. Powell"), a decimal
 * ("2.9%") or a citation run ("rates.[1][2] The"). Pure: no DOM, no React.
 *
 * A boundary is terminal punctuation, optional closing quotes or brackets and
 * citation markers, then whitespace, then a capital letter, a digit or an
 * opening quote. Nothing is dropped: joining the pieces with single spaces
 * gives back the whitespace-collapsed input.
 */

/** Tokens that end in a period without ending a sentence. */
const ABBREVIATION =
  /(?:^|[\s(])(?:U\.S|U\.K|E\.U|U\.N|e\.g|i\.e|etc|vs|approx|est|Mr|Mrs|Ms|Dr|Prof|Inc|Corp|Co|Ltd|Jr|Sr|St|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|[A-Z])\.$/;

const BOUNDARY = /[.!?]+["'”’)\]]*(?:\[\d+\])*\s+(?=["'“‘(\[]?[A-Z0-9])/g;

export function splitSentences(text: string | null | undefined): string[] {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(t))) {
    const end = m.index + m[0].trimEnd().length;
    // The token that carries the first terminal mark: an abbreviation or an
    // initial keeps the sentence going.
    const head = t.slice(start, m.index + 1);
    if (ABBREVIATION.test(head)) continue;
    const piece = t.slice(start, end).trim();
    if (piece) out.push(piece);
    start = m.index + m[0].length;
  }
  const tail = t.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** The first `n` sentences and the rest, each joined back into prose ("" when empty). */
export function takeSentences(text: string | null | undefined, n: number): { shown: string; rest: string; shownCount: number } {
  const all = splitSentences(text);
  const shown = all.slice(0, Math.max(0, n));
  return { shown: shown.join(" "), rest: all.slice(shown.length).join(" "), shownCount: shown.length };
}
