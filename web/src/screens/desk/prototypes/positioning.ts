/**
 * Basket & Hedge's "Positioning" as a PROTOTYPE (DESK_FRAME3_SPEC §10,
 * §1.0.3): per name in the open basket, short interest as a share of float,
 * days to cover, the put/call open-interest ratio and a crowding flag, from
 * proto-positioning.json. The flag's rule is stated in the card's Advanced
 * section: crowded short at a short interest of 10% of float or more, else
 * crowded long when at least 25% of the funds a 13F sample tracks hold the
 * name in their top ten. The basket's figures weight each name with data by
 * its share and say what they cover (the weight and the names); a name
 * without data reads "no data" and is in no count; a figure without a
 * positive covered weight is withheld, never NaN (Codex R-01). Pure.
 */

import p from "../../../fixtures/desk/proto-positioning.json" with { type: "json" };
import type { BasketLeg } from "./basket-inputs";

export type Crowding = "short" | "long" | null;

interface Row {
  si_pct_float: number;
  days_to_cover: number;
  put_call_oi: number;
  top10_13f_pct: number;
}

export interface NameRow extends BasketLeg {
  /** Short interest, percent of float; days to cover; puts' open interest over calls'; the 13F top-ten share, percent. */
  si: number;
  dtc: number;
  putCall: number;
  top10: number;
  flag: Crowding;
}

export interface Positioning {
  /** The names with data. */
  rows: NameRow[];
  /** The names with no data: listed, never counted (Codex R-01). */
  missing: BasketLeg[];
  /** The basket weight the names with data carry, and the whole basket's, in percent. */
  coveredWeight: number;
  totalWeight: number;
  /** Weighted over the names with data by their weights; null unless that weight is positive and the figure
   * finite, so nothing on screen is NaN (Codex R-01). */
  weightedSi: number | null;
  weightedDtc: number | null;
  /** Crowded names among those with data. */
  flagged: number;
  rules: { shortSi: number; longTop10: number };
}

export const RULES = { shortSi: p.rules.crowded_short_si_pct, longTop10: p.rules.crowded_long_13f_pct };

/** §10's crowding flag: short interest first, then the funds' top-ten share. */
export function crowding(r: Pick<Row, "si_pct_float" | "top10_13f_pct">): Crowding {
  if (r.si_pct_float >= RULES.shortSi) return "short";
  if (r.top10_13f_pct >= RULES.longTop10) return "long";
  return null;
}

export const CROWDING_WORDS: Record<Exclude<Crowding, null>, string> = { short: "Crowded short", long: "Crowded long" };

export function positioning(legs: readonly BasketLeg[]): Positioning {
  const names = p.names as Record<string, Row>;
  const rows: NameRow[] = [];
  const missing: BasketLeg[] = [];
  for (const l of legs) {
    const r = names[l.symbol];
    if (!r) missing.push(l);
    else rows.push({ ...l, si: r.si_pct_float, dtc: r.days_to_cover, putCall: r.put_call_oi, top10: r.top10_13f_pct, flag: crowding(r) });
  }
  const w = rows.reduce((a, r) => a + r.weight, 0);
  const avg = (f: (r: NameRow) => number): number | null => {
    if (!(Number.isFinite(w) && w > 0)) return null;
    const v = rows.reduce((a, r) => a + r.weight * f(r), 0) / w;
    return Number.isFinite(v) ? v : null;
  };
  return {
    rows,
    missing,
    coveredWeight: w,
    totalWeight: legs.reduce((a, l) => a + l.weight, 0),
    weightedSi: avg((r) => r.si),
    weightedDtc: avg((r) => r.dtc),
    flagged: rows.filter((r) => r.flag).length,
    rules: RULES,
  };
}
