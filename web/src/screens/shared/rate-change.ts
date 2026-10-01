/**
 * The label every FRED rate or spread change carries (fix/freshness 2).
 *
 * `/api/credit/oas` used to subtract the previous month-stamped row and call
 * it "1W" (the 10Y's "+49 bps 1W" was the change since Aug 31; the true week
 * was +28). The server now says what each change is measured against, and
 * this is the one place that turns that into words: "1W" only for a true
 * seven-calendar-day change from the true-dated daily store, "vs <Mon>
 * month-end" for a series still stored one row per month. No basis (an older
 * payload) → no change printed, never a guessed label.
 */

import type { CreditSeries } from "../../api/types";
import { fmtDate } from "../../lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface RateChange {
  bps: number;
  basis: "1w" | "month_end";
  /** The short tag beside the number: "1W" or "vs Aug month-end". */
  tag: string;
  /** The same in running text: "on the week" or "since the Aug month-end". */
  phrase: string;
  /** The hover title, naming both ends. */
  title: string;
}

/** "2026-08" → ["Aug", "August 2026"]. */
function monthWords(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const i = Math.min(11, Math.max(0, (m ?? 1) - 1));
  return [MONTHS[i], `${MONTHS_LONG[i]} ${y}`];
}

export function rateChange(s: CreditSeries | undefined | null): RateChange | null {
  if (!s || s.change_bps == null || !Number.isFinite(s.change_bps) || !s.change_from) return null;
  if (s.change_basis === "1w") {
    return {
      bps: s.change_bps,
      basis: "1w",
      tag: "1W",
      phrase: "on the week",
      title: `Change over one week: ${fmtDate(s.date)} against ${fmtDate(s.change_from)}`,
    };
  }
  if (s.change_basis === "month_end") {
    const [short, long] = monthWords(s.change_from);
    return {
      bps: s.change_bps,
      basis: "month_end",
      tag: `vs ${short} month-end`,
      phrase: `since the ${short} month-end`,
      title: `Change since the ${long} month-end value; this series is stored one row per month`,
    };
  }
  return null;
}
