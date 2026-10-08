/**
 * The recession model's vintage in one vocabulary (fix/site-audit D6): the
 * month a score is for and the month its inputs come from, "Scored for Sep
 * 2026 · inputs from Jun 2026". On 2026-10-07 the Recession page's stamp read
 * "Recession model · Oct 2026" (`data_as_of`, the newest raw input row, which
 * the score does not read), its body "Scored for Sep 2026", the Dashboard
 * "this month" and the Desk "based on Jun 2026 data": four words for one
 * score. Both months are served (`probability_month` and `inputs_through` on
 * /api/recession/probability and on the Desk's recession blocks); nothing
 * here computes a month. The Dashboard, the Recession page, the Regime Lab
 * and the Desk all print it from here.
 */
import type { RecessionMetrics } from "../../api/types";
import { fmtMonYr } from "../../lib/format";

/** The two served months, "YYYY-MM" (a dated "YYYY-MM-DD" reads as its month). */
export interface RecessionVintage {
  probability_month?: string | null;
  inputs_through?: string | null;
}

function month(m: string | null | undefined, nbsp: boolean): string | null {
  if (typeof m !== "string" || !/^\d{4}-\d{2}/.test(m)) return null;
  const s = fmtMonYr(m.slice(0, 7));
  return nbsp ? s.replace(" ", " ") : s;
}

/** "Scored for Sep 2026 · inputs from Jun 2026"; the half that is served when
 * only one month is; null with neither. `lower` for use inside a sentence,
 * `nbsp` so a month and its year never part across lines. */
export function recessionVintage(v: RecessionVintage | null | undefined, { lower = false, nbsp = false } = {}): string | null {
  const scored = month(v?.probability_month, nbsp);
  const inputs = month(v?.inputs_through, nbsp);
  const parts = [scored ? `scored for ${scored}` : null, inputs ? `inputs from ${inputs}` : null].filter((p): p is string => p != null);
  if (!parts.length) return null;
  const text = parts.join(" · ");
  return lower ? text : text[0].toUpperCase() + text.slice(1);
}

/** The served months of /api/recession/probability; an API that predates
 * `probability_month` dates the score by its history's last point. */
export function vintageOf(m: Pick<RecessionMetrics, "probability_month" | "inputs_through" | "recession_prob_series">): RecessionVintage {
  return { probability_month: m.probability_month ?? m.recession_prob_series?.at(-1)?.date ?? null, inputs_through: m.inputs_through ?? null };
}
