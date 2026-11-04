/**
 * Who wrote the stored daily bars (`market_daily`), by date.
 *
 * The table's `source` column splits by date. The rows dated 2024-02-27 to
 * 2026-05-26 are Polygon.io bars the earlier pipeline wrote (6,018 rows over
 * the 23 stored ETFs; 14 of them start 2026-02-18), except one yfinance bar:
 * SPY's 2026-03-12 close, a day that run stored no SPY bar. Every other row
 * is yfinance: SPY back to 1993-01-29, and all 23 from 2026-05-27. Nothing
 * writes Polygon rows now, and the yfinance writer starts after each
 * symbol's newest stored date, so the split holds as the table grows. Stored
 * 5-minute bars (`market_intraday`) are all yfinance.
 *
 * Measured on the data-latest database on 2026-11-04.
 * tests/test_stored_provenance.py checks these facts against the database
 * and these constants against api/desk.py (POLYGON_DAILY_FIRST,
 * POLYGON_DAILY_LAST, YFINANCE_DAILY_INSIDE), so a change to the stored rows
 * fails a test before it can mislabel a chart.
 */
import { fmtDate } from "../../lib/format";

export const POLYGON_DAILY_FIRST = "2024-02-27";
export const POLYGON_DAILY_LAST = "2026-05-26";
/** The yfinance bars inside the Polygon.io span, as [symbol, date]. */
export const YFINANCE_DAILY_INSIDE: readonly (readonly [string, string])[] = [["SPY", "2026-03-12"]];

export type StoredDailyProvider = "Polygon.io" | "yfinance";

/** The provider of a symbol's stored daily bar on this date ("YYYY-MM-DD"). */
export function storedDailyProvider(symbol: string, dateIso: string): StoredDailyProvider {
  const d = dateIso.slice(0, 10);
  if (d < POLYGON_DAILY_FIRST || d > POLYGON_DAILY_LAST) return "yfinance";
  return YFINANCE_DAILY_INSIDE.some(([s, x]) => s === symbol && x === d) ? "yfinance" : "Polygon.io";
}

/** The providers of a run of one symbol's stored daily bars, in date order,
 * each with its own bars' dates: "yfinance", or "Polygon.io to May 26, 2026,
 * yfinance from May 27, 2026". `null` for no bars. */
export function storedDailyProviders(symbol: string, datesIso: readonly string[]): string | null {
  const dates = [...datesIso].map((d) => d.slice(0, 10)).sort();
  if (dates.length === 0) return null;
  const runs: { provider: StoredDailyProvider; first: string; last: string }[] = [];
  for (const d of dates) {
    const provider = storedDailyProvider(symbol, d);
    const run = runs[runs.length - 1];
    if (run && run.provider === provider) run.last = d;
    else runs.push({ provider, first: d, last: d });
  }
  if (runs.length === 1) return runs[0].provider;
  return runs
    .map((r, i) =>
      i === 0
        ? `${r.provider} to ${fmtDate(r.last)}`
        : i === runs.length - 1
          ? `${r.provider} from ${fmtDate(r.first)}`
          : r.first === r.last
            ? `${r.provider} on ${fmtDate(r.first)}`
            : `${r.provider} ${fmtDate(r.first)} to ${fmtDate(r.last)}`,
    )
    .join(", ");
}

const INSIDE_WORDS = YFINANCE_DAILY_INSIDE.map(([s, d]) => `${s}'s ${fmtDate(d)} bar`).join(" and ");

/** The site-wide words for the stored daily table, for disclosure lines. */
export const STORED_DAILY_SOURCE =
  `stored daily candles and returns via the refresh pipeline: yfinance, except the bars dated ` +
  `${fmtDate(POLYGON_DAILY_FIRST)} to ${fmtDate(POLYGON_DAILY_LAST)}, which are Polygon.io bars kept from the earlier pipeline ` +
  `(${INSIDE_WORDS} is yfinance)`;
