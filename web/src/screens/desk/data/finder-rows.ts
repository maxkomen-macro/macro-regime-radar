import { DROPPED } from "./schema";
import type { OptionModel, OptionsFinderResponse } from "./types";

/** The models a row may name, and the scenarios a per-scenario value on the date may name. */
const MODELS: readonly OptionModel[] = ["black76-escrowed", "american-bbsr-escrowed", "intrinsic"];
const SCENARIOS = ["target", "half", "flat"];

/** A value on the date names one known model, or one known model for each of one to three known scenarios. */
export function onDateOk(on: unknown): boolean {
  if (typeof on === "string") return MODELS.includes(on as OptionModel);
  if (!on || typeof on !== "object" || Array.isArray(on)) return false;
  const entries = Object.entries(on);
  return entries.length > 0 && entries.every(([k, m]) => SCENARIOS.includes(k) && MODELS.includes(m as OptionModel));
}

/** The Finder's rows past the schema (which cannot say "a model, or one per scenario"): a row whose value on the date
 * names no known model is not read, and is counted with the rows the schema dropped, so the page says how many it
 * could not read (independent review, finding 3). */
export function finderRows(d: OptionsFinderResponse): OptionsFinderResponse {
  const rows = d.rows ?? [];
  const kept = rows.filter((r) => onDateOk(r.model?.on_date));
  if (kept.length === rows.length) return d;
  const was = (d as unknown as Record<string, Record<string, number> | undefined>)[DROPPED] ?? {};
  return { ...d, rows: kept, [DROPPED]: { ...was, rows: (was.rows ?? 0) + rows.length - kept.length } } as OptionsFinderResponse;
}
