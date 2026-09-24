/**
 * The Promote form's WORDING check (DESK_FRAME3_SPEC §9): certainty words in
 * the variant view and the pre-mortem are highlighted with one-click
 * replacements, and only they block the save; nothing else is edited. The
 * server applies the same rule (§12.8 answers `{"error":"wording","words":[…]}`),
 * so the form can never save what this module flags. Pure.
 */

/** §9's five certainty words, the only ones that block. */
export const CERTAINTY_WORDS = ["will", "always", "never", "proves", "guaranteed"] as const;

export type CertaintyWord = (typeof CERTAINTY_WORDS)[number];

/** Two replacements each, the first as §9 names it for "will". */
export const REPLACEMENTS: Record<CertaintyWord, [string, string]> = {
  will: ["is likely to", "tends to"],
  always: ["usually", "in most of the sample"],
  never: ["rarely", "seldom"],
  proves: ["is consistent with", "suggests"],
  guaranteed: ["likely", "probable"],
};

export type Field = "variant" | "pre_mortem";

export interface Flag {
  field: Field;
  word: CertaintyWord;
  /** The word as written (its case kept). */
  written: string;
  index: number;
}

const PATTERN = new RegExp(`\\b(${CERTAINTY_WORDS.join("|")})\\b`, "gi");

export function findFlags(text: string, field: Field): Flag[] {
  return [...text.matchAll(PATTERN)].map((m) => ({ field, word: m[0].toLowerCase() as CertaintyWord, written: m[0], index: m.index ?? 0 }));
}

/** The text with one flagged word replaced; unchanged when the flag no longer matches. */
export function replaceFlag(text: string, flag: Flag, replacement: string): string {
  if (text.slice(flag.index, flag.index + flag.written.length).toLowerCase() !== flag.word) return text;
  // A capitalised word keeps its capital ("Will it?" → "Is likely to it?").
  const r = /^[A-Z]/.test(flag.written) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  return `${text.slice(0, flag.index)}${r}${text.slice(flag.index + flag.written.length)}`;
}

/** A few words either side of a flag, for the wording box ("gold will mean-revert"). */
export function context(text: string, flag: Flag): { before: string; word: string; after: string } {
  const before = text.slice(0, flag.index).split(/\s+/).filter(Boolean).slice(-2).join(" ");
  const after = text.slice(flag.index + flag.written.length).split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
  return { before, word: flag.written, after };
}

export interface GateState {
  variant: boolean;
  premortem: boolean;
  level: boolean;
  flags: Flag[];
  ok: boolean;
  /** What is left, in words: "Two things left: pick a "wrong if" level, and fix one word above". */
  left: string;
}

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** The gate for a draft: three answers and no certainty word (§9). */
export function gateState(d: { instrument: string; variant: string; pre_mortem: string; level: string | null; sizeOk?: boolean }): GateState {
  const flags = [...findFlags(d.variant, "variant"), ...findFlags(d.pre_mortem, "pre_mortem")];
  const variant = d.variant.trim().length > 0;
  const premortem = d.pre_mortem.trim().length > 0;
  const level = !!d.level && d.level.trim().length > 0;
  const todo: string[] = [];
  if (!d.instrument.trim()) todo.push("name the instrument");
  if (!variant) todo.push("finish the variant view");
  if (!premortem) todo.push("finish the pre-mortem");
  if (!level) todo.push("pick a “wrong if” level");
  if (d.sizeOk === false) todo.push("enter the size as a number from 0 to 100, or leave it empty");
  if (flags.length) todo.push(flags.length === 1 ? "fix one word above" : `fix ${(COUNT[flags.length] ?? String(flags.length)).toLowerCase()} words above`);
  const ok = todo.length === 0;
  const lead = `${COUNT[todo.length] ?? todo.length} thing${todo.length === 1 ? "" : "s"} left`;
  const list = todo.length > 1 ? `${todo.slice(0, -1).join(", ")}, and ${todo[todo.length - 1]}` : todo[0] ?? "";
  return { variant, premortem, level, flags, ok, left: ok ? "" : `${lead}: ${list}` };
}
