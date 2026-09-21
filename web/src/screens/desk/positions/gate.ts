/**
 * The discipline gate (docs/desk/DESK_FRAME_SPEC.md §5, Position Monitor).
 * Pure functions, no React: a draft passes only when its variant view and
 * pre-mortem are written, its falsification level is a number tied to a
 * series, and neither thesis field carries an uncalibrated word. The store's
 * `addPosition` runs the same check, so the gate cannot be bypassed by a
 * keyboard submit, a URL, or a script: nothing saves that this module refuses.
 */

import type { SealState } from "../Seals";

export const BANNED_WORDS = ["will", "definitely", "obviously", "proves", "guaranteed", "certain", "always", "never"] as const;

type Banned = (typeof BANNED_WORDS)[number];

/** The calibrated rewrite offered for each word. */
export const REWRITES: Record<Banned, string> = {
  will: "is likely to",
  definitely: "probably",
  obviously: "on the evidence",
  proves: "is consistent with",
  guaranteed: "likely",
  certain: "probable",
  always: "in most of the sample",
  never: "rarely in the sample",
};

export type ThesisField = "variant_view" | "pre_mortem";

export interface Flag {
  field: ThesisField;
  /** The word as written (its case kept). */
  word: string;
  /** Character offset in the field's text. */
  index: number;
  suggestion: string;
}

const PATTERN = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "gi");

/** Every flagged word in a thesis field, in text order. */
export function findFlags(text: string, field: ThesisField): Flag[] {
  const out: Flag[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const word = m[0];
    out.push({ field, word, index: m.index ?? 0, suggestion: REWRITES[word.toLowerCase() as Banned] });
  }
  return out;
}

/** The text with one flagged occurrence replaced by its suggestion. */
export function applyRewrite(text: string, flag: Flag): string {
  if (text.slice(flag.index, flag.index + flag.word.length).toLowerCase() !== flag.word.toLowerCase()) return text;
  return `${text.slice(0, flag.index)}${flag.suggestion}${text.slice(flag.index + flag.word.length)}`;
}

export interface Draft {
  instrument: string;
  direction: "long" | "short";
  size: string;
  horizon: string;
  variant_view: string;
  pre_mortem: string;
  falsification_series: string;
  /** The typed level, raw: the gate parses it. */
  falsification_level: string;
  falsification_direction: "above" | "below";
}

export const EMPTY_DRAFT: Draft = {
  instrument: "",
  direction: "long",
  size: "",
  horizon: "3 months",
  variant_view: "",
  pre_mortem: "",
  falsification_series: "",
  falsification_level: "",
  falsification_direction: "below",
};

export interface GateStatus {
  ok: boolean;
  variant: SealState;
  premortem: SealState;
  falsification: SealState;
  flags: Flag[];
  /** What still blocks the save, in reader words; "" when nothing does. */
  reason: string;
  /** The parsed level when the falsification gate is met. */
  level: number | null;
}

export function parseLevel(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The whole gate for a draft. */
export function gateStatus(draft: Draft): GateStatus {
  const flags = [...findFlags(draft.variant_view, "variant_view"), ...findFlags(draft.pre_mortem, "pre_mortem")];
  const seal = (text: string, field: ThesisField): SealState => (!text.trim() ? "open" : flags.some((f) => f.field === field) ? "flagged" : "met");
  const variant = seal(draft.variant_view, "variant_view");
  const premortem = seal(draft.pre_mortem, "pre_mortem");
  const level = parseLevel(draft.falsification_level);
  const falsification: SealState = draft.falsification_series.trim() && level != null ? "met" : "open";
  const missing: string[] = [];
  if (!draft.instrument.trim()) missing.push("name the instrument");
  if (variant === "open") missing.push("write the variant view");
  if (premortem === "open") missing.push("write the pre-mortem");
  if (falsification === "open") missing.push(!draft.falsification_series.trim() ? "tie the falsification level to a series" : "set a numeric falsification level");
  if (flags.length) missing.push(`replace ${flags.length === 1 ? "the flagged word" : `${flags.length} flagged words`}`);
  const ok = missing.length === 0;
  const reason = ok ? "" : `Save is blocked: ${missing.join("; ")}.`;
  return { ok, variant, premortem, falsification, flags, reason, level };
}
