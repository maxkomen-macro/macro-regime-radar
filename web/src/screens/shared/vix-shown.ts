/**
 * The one VIX reading a card shows (fix/freshness 3c, moved here for item 7 so
 * the Dashboard card and the Desk tile run the same code). The live quote
 * store the Markets tape reads (`web/src/live/quotes.ts`, the relay's delayed
 * VIX poll) wins, with the tape's own number and stamp (`asOfCell`), but only
 * when it was observed at or after the stored close (Codex R-09: the store
 * keeps a quote after its socket drops, so Wednesday's quote must never
 * outrank Thursday's close); otherwise, and without a quote, the newest stored
 * close, labeled "Close · <date>" by its true observation date (the month only
 * when no true date is known). Everything a
 * card derives from the VIX is computed against the value shown: the band
 * word (calm < 15 ≤ subdued < 25 ≤ stressed, the edges api/desk_v2.py serves)
 * and the gap to a served realized volatility.
 */

import type { LiveQuote } from "../../live/quotes";
import { asOfCell } from "../markets/tape";

/** The VIX words' edges (api/desk_v2.VIX_BAND_EDGES; the Dashboard's read-through used the same). */
export const VIX_BAND_EDGES: readonly [number, number] = [15, 25];

export type VixBand = "calm" | "subdued" | "stressed";

/** The newest stored close a card falls back to (the Desk's served vol tile has this shape). */
export interface StoredVix {
  vix: number | null;
  /** The close's observation date, "YYYY-MM-DD" (or "YYYY-MM-01" with `monthOnly`). */
  date: string;
  /** True when only the close's month is known (a month-stamped row with no true date). */
  monthOnly?: boolean;
  band?: VixBand | null;
  band_edges?: readonly [number, number] | null;
  /** A served gap to the S&P's realized volatility; only its realized figure and date are read. */
  gap?: { date: string; realized_21d: number | null } | null;
}

export interface VixShown {
  value: number;
  /** The tape's number for an index row (screens/markets/tape.ts fmtPrice): two decimals. */
  text: string;
  source: "quote" | "close";
  /** A live tick says Live with its clock; anything else is its stamp. */
  live: boolean;
  /** The quote's own stamp, exactly the tape's ("Sep 29, 16:15 ET · 15m"), or "Close · Sep 29". */
  stamp: string;
  /** The New York date of the value ("YYYY-MM-DD"). */
  date: string;
  band: VixBand | null;
  gapPts: number | null;
  realized: number | null;
  realizedDate: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** "2026-09-29" → "Sep 29"; with `month`, "Sep 2026". */
function dateWords(iso: string, month = false): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return "";
  return month ? `${MONTHS[m - 1]} ${y}` : d ? `${MONTHS[m - 1]} ${d}` : "";
}

/** The New York date of an epoch-ms stamp ("2026-09-30"). */
const nyDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

const NY_WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ["2026-09-30", "15:45"]: an epoch-ms stamp's New York date and wall clock. */
function nyWall(ms: number): [string, string] {
  const p: Record<string, string> = {};
  for (const part of NY_WALL.formatToParts(new Date(ms))) p[part.type] = part.value;
  return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`];
}

/** When the daily VIX close is struck, New York time: the Cboe close that FRED VIXCLS and ^VIX record. On an
 * early-close day the close is struck earlier, and a quote between that close and this time is ranked below the
 * stored close, which then shows the same close. */
export const VIX_CLOSE_ET = "16:15";

/**
 * Codex R-09: a quote is the reading only when it was observed at or after the stored close: a later New York
 * day, or the close's own day at or after VIX_CLOSE_ET. A close known only by its month is beaten only by a quote
 * from a later month; a quote without a timestamp never beats a stored close. Without a stored close the quote is
 * all there is.
 */
export function quoteIsCurrent(q: LiveQuote, close: StoredVix | null | undefined): boolean {
  if (!close || !fin(close.vix)) return true;
  if (!fin(q.t)) return false;
  const [day, clock] = nyWall(q.t);
  if (close.monthOnly) return day.slice(0, 7) > close.date.slice(0, 7);
  const closeDay = close.date.slice(0, 10);
  return day > closeDay || (day === closeDay && clock >= VIX_CLOSE_ET);
}

/** calm / subdued / stressed by the edges given (VIX_BAND_EDGES by default). */
export function vixBand(value: number, edges: readonly [number, number] = VIX_BAND_EDGES): VixBand {
  return value < edges[0] ? "calm" : value < edges[1] ? "subdued" : "stressed";
}

export function vixShown(close: StoredVix | null | undefined, q: LiveQuote | null | undefined): VixShown | null {
  const quote = q && fin(q.p) && quoteIsCurrent(q, close) ? q : undefined;
  if (!quote && !(close && fin(close.vix))) return null;
  const value = quote ? quote.p : (close!.vix as number);
  const at = quote ? asOfCell(quote) : null;
  const edges = close?.band_edges && fin(close.band_edges[0]) && fin(close.band_edges[1]) ? close.band_edges : VIX_BAND_EDGES;
  const realized = close?.gap && fin(close.gap.realized_21d) ? close.gap.realized_21d : null;
  const closeWords = close ? dateWords(close.date, close.monthOnly) : "";
  return {
    value,
    text: value.toFixed(2),
    source: quote ? "quote" : "close",
    live: at?.live ?? false,
    stamp: at ? at.text : closeWords ? `Close · ${closeWords}` : "Close",
    date: quote && quote.t != null ? nyDay(quote.t) : (close?.date ?? ""),
    band: vixBand(value, edges),
    gapPts: realized != null ? value - realized : null,
    realized,
    realizedDate: close?.gap?.date ?? null,
  };
}

/**
 * The Dashboard's stored VIX (FRED VIXCLS, `/series/VIXCLS/latest`): the row is month-stamped (one row a month,
 * the newest in-month value), so its date is the freshness report's true observation date (`series[]`, from the
 * source watermark) when that date falls in the row's month; else only the month is known.
 */
export function storedVixFromFred(latest: { date: string; value: number } | null | undefined, trueDate: string | null | undefined): StoredVix | null {
  if (!latest || !fin(latest.value)) return null;
  const known = trueDate && /^\d{4}-\d{2}-\d{2}/.test(trueDate) && trueDate.slice(0, 7) === latest.date.slice(0, 7);
  if (known) return { vix: latest.value, date: trueDate!.slice(0, 10) };
  // A row dated other than the 1st already carries its observation day; a month stamp alone says only the month.
  return latest.date.slice(8, 10) === "01" ? { vix: latest.value, date: latest.date.slice(0, 10), monthOnly: true } : { vix: latest.value, date: latest.date.slice(0, 10) };
}
