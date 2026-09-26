/**
 * Build Notes' reading of docs/desk/BUILD_NOTES.md (DESK_FRAME3_SPEC §11):
 * the file's `#` title, the text before its first `##`, and one section per
 * `##` (outside code fences) with an id for the contents list. The words are
 * the file's; the one thing the page does to them is hold a sentence that
 * uses a word the Desk never prints (the owner's rule), with a marker in its
 * place. The file is split into its title and sections first and held inside
 * each part, so a held heading keeps its section. A paragraph is held whole
 * (its wrapped lines joined, as the renderer joins them) and a list item with
 * its continuation lines (joined here, since ../../shell/Markdown ends a list
 * at a line without a marker). A table row is held cell by cell, so the
 * table keeps its shape, and a figure line whole. Pure.
 */

export interface NotesSection {
  id: string;
  title: string;
  body: string;
}

export interface Notes {
  title: string | null;
  lead: string;
  sections: NotesSection[];
  /** Sentences, headings and code lines held for a banned word. */
  held: number;
}

/** The two words the Desk never prints (frame-3). Letters and digits bound
 * the word, not \b, so `_established_` (rendered as emphasis) is held too;
 * "insignificant" and "establishment" are other words. */
const BANNED = /(?<![\p{L}\p{N}])(established|significant)(?![\p{L}\p{N}])/iu;

/** What stands in for one held sentence (rendered as emphasis). */
export const HELD_MARK = "*(one sentence held: it uses a word the Desk does not print)*";
/** What stands in for a held heading (a heading is not set in emphasis). */
export const HELD_HEADING = "(heading held: it uses a word the Desk does not print)";
const HELD_CODE = "(one line held: it uses a word the Desk does not print)";
const HELD_FIGURE = "(one figure held: its caption uses a word the Desk does not print)";

const COUNT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function heldMark(n: number): string {
  return n === 1 ? HELD_MARK : `*(${COUNT[n] ?? n} sentences held: they use a word the Desk does not print)*`;
}

/** A sentence ends at . ! or ? followed by any closing quotes, brackets or
 * emphasis marks, then space. */
const SENTENCE_END = /(?<=[.!?]["'”’)\]*_]*)\s+/;
const CLOSERS = `["'”’)\\]*_]*$`;
/** An abbreviation (e.g., i.e., vs., U.S., p.m.) runs on into a piece that starts in lower case or a digit. */
const ABBREVIATION = new RegExp(`(?:\\b(?:e\\.g|i\\.e|cf|vs|approx|Mr|Ms|Mrs|Dr|St)\\.|(?:^|[\\s("'“‘])(?:[A-Za-z]\\.){2,})${CLOSERS}`);
/** A middle initial after a name (John F. Kennedy) runs on into a piece that starts in upper case. */
const INITIAL = new RegExp(`(?:^|\\s)[A-Z][a-z]+\\s[A-Z]\\.${CLOSERS}`);

export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(SENTENCE_END)) {
    const prev = out[out.length - 1];
    const runOn = prev !== undefined && ((ABBREVIATION.test(prev) && /^[a-z0-9]/.test(piece)) || (INITIAL.test(prev) && /^[A-Z]/.test(piece)));
    if (runOn) out[out.length - 1] = `${prev} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** Emphasis marks at a word's edge, dropped from a paragraph that has a
 * hold: a span the hold cut in two would otherwise print its asterisks. */
function unemphasize(s: string): string {
  return s.replace(/(^|[\s("'“‘[])[*_]+(?=\S)/g, "$1").replace(/(?<=\S)[*_]+(?=[\s.,;:!?)"'”’\]]|$)/g, "");
}

/** One paragraph (or list item) with its banned sentences held; a run of
 * held sentences becomes one marker that counts them. */
export function holdSentences(text: string): { text: string; held: number } {
  if (!BANNED.test(text)) return { text, held: 0 };
  const out: string[] = [];
  let held = 0;
  let run = 0;
  const flush = () => {
    if (run) out.push(heldMark(run));
    run = 0;
  };
  for (const s of sentences(text)) {
    if (BANNED.test(s)) {
      run += 1;
      held += 1;
    } else {
      flush();
      out.push(unemphasize(s));
    }
  }
  flush();
  return { text: out.join(" "), held };
}

function holdHeading(text: string): { text: string; held: number } {
  return BANNED.test(text) ? { text: HELD_HEADING, held: 1 } : { text, held: 0 };
}

const HEADING = /^(#{1,4}[ \t]+)(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,})\s*$/;
const ITEM = /^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$/;
const TABLE_ROW = /^\s*\|/;
const FIGURE = /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/;

/** A table row with each cell's banned sentences held; the pipes stay. */
function holdRow(line: string): { text: string; held: number } {
  if (!BANNED.test(line)) return { text: line, held: 0 };
  let held = 0;
  const cells = line.split(/(?<!\\)\|/).map((c) => {
    if (!BANNED.test(c)) return c;
    const r = holdSentences(c.trim());
    held += r.held;
    return ` ${r.text} `;
  });
  return { text: cells.join("|"), held };
}

/** A Markdown body, block by block as ../../shell/Markdown parses it, with
 * a list item's continuation lines joined into the item. */
export function holdBanned(md: string): { text: string; held: number } {
  let held = 0;
  const out: string[] = [];
  let para: string[] = [];
  let item: { prefix: string; lines: string[] } | null = null;
  let code = false;
  const flushPara = () => {
    if (!para.length) return;
    if (BANNED.test(para.join("\n"))) {
      const r = holdSentences(para.map((l) => l.trim()).join(" "));
      held += r.held;
      out.push(r.text);
    } else out.push(...para);
    para = [];
  };
  const flushItem = () => {
    if (!item) return;
    const r = holdSentences(item.lines.map((l) => l.trim()).join(" "));
    held += r.held;
    out.push(item.prefix + r.text);
    item = null;
  };
  const flush = () => {
    flushPara();
    flushItem();
  };
  for (const line of md.split("\n")) {
    if (line.trim().startsWith("```")) {
      flush();
      code = !code;
      out.push(line);
      continue;
    }
    if (code) {
      if (BANNED.test(line)) held += 1;
      out.push(BANNED.test(line) ? HELD_CODE : line);
      continue;
    }
    if (!line.trim()) {
      flush();
      out.push(line);
      continue;
    }
    if (TABLE_ROW.test(line) || FIGURE.test(line)) {
      flush();
      const r = FIGURE.test(line) ? (BANNED.test(line) ? { text: HELD_FIGURE, held: 1 } : { text: line, held: 0 }) : holdRow(line);
      held += r.held;
      out.push(r.text);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const r = holdHeading(h[2]);
      held += r.held;
      out.push(h[1] + r.text);
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push(line);
      continue;
    }
    const li = ITEM.exec(line);
    if (li) {
      flush();
      item = { prefix: li[1], lines: [li[2]] };
      continue;
    }
    if (item) item.lines.push(line);
    else para.push(line);
  }
  flush();
  return { text: out.join("\n"), held };
}

const slug = (t: string) =>
  "bn-" +
  t
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The body split at each `##` line outside a code fence. */
function splitSections(rest: string): { lead: string; parts: { head: string; body: string }[] } {
  const lead: string[] = [];
  const parts: { head: string; lines: string[] }[] = [];
  let code = false;
  for (const line of rest.split("\n")) {
    if (line.trim().startsWith("```")) code = !code;
    const m = code ? null : /^##[ \t]+(.*)$/.exec(line);
    if (m) parts.push({ head: m[1].trim(), lines: [] });
    else (parts.length ? parts[parts.length - 1].lines : lead).push(line);
  }
  return { lead: lead.join("\n"), parts: parts.map((p) => ({ head: p.head, body: p.lines.join("\n") })) };
}

export function readNotes(md: string): Notes {
  const src = md.replace(/\r\n?/g, "\n");
  let held = 0;
  const m = /^\s*#[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(src);
  let title: string | null = null;
  if (m) {
    const r = holdHeading(m[1]);
    held += r.held;
    title = r.text;
  }
  const { lead: leadMd, parts } = splitSections(m ? src.slice(m[0].length) : src);
  const lead = holdBanned(leadMd);
  held += lead.held;
  const seen = new Map<string, number>();
  const sections = parts.map((p) => {
    const head = holdHeading(p.head);
    const body = holdBanned(p.body);
    held += head.held + body.held;
    const base = slug(head.text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, title: head.text, body: body.text.trim() };
  });
  return { title, lead: lead.text.trim(), sections, held };
}
