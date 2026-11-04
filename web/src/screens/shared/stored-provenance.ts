/**
 * Who wrote the stored daily bars (`market_daily`), by symbol and date.
 *
 * Each stored ETF's bars from its Polygon.io start (2024-02-27 for 9 of the
 * 23, 2026-02-18 for the other 14) to 2026-05-26 are Polygon.io bars the
 * earlier pipeline wrote (6,018 rows), one for every NYSE session, except one
 * yfinance bar: SPY's 2026-03-12 close, a session that run stored none for.
 * Every other row is yfinance: SPY back to 1993-01-29, and all 23 from
 * 2026-05-27. Nothing writes Polygon rows now; the yfinance writers start
 * after each symbol's newest date or insert only missing sessions, and every
 * span already holds every session, so the split holds as the table grows.
 * Stored 5-minute bars (`market_intraday`) are all yfinance.
 *
 * Measured on the data-latest database on 2026-11-04.
 * tests/test_stored_provenance.py checks these facts against the database
 * and these constants against api/desk.py (POLYGON_DAILY_FIRST_BY_SYMBOL,
 * POLYGON_DAILY_LAST, YFINANCE_DAILY_INSIDE), so a change to the stored rows
 * fails a test before it can mislabel a chart.
 */
import { fmtDate } from "../../lib/format";

const EARLY = "2024-02-27";
const LATE = "2026-02-18";
/** Each stored ETF's first Polygon.io bar. A symbol not listed has none. */
export const POLYGON_DAILY_FIRST_BY_SYMBOL: Readonly<Record<string, string>> = {
  CPER: LATE, EEM: LATE, EFA: LATE, EMB: LATE, GLD: EARLY, HYG: EARLY, IEF: LATE, IWM: EARLY,
  LQD: EARLY, QQQ: EARLY, SHY: LATE, SLV: LATE, SPY: EARLY, TLT: EARLY, UNG: LATE, USO: EARLY,
  UUP: EARLY, VIXY: LATE, VTV: LATE, XLE: LATE, XLF: LATE, XLI: LATE, XLK: LATE,
};
export const POLYGON_DAILY_LAST = "2026-05-26";
/** The yfinance bars inside a symbol's Polygon.io span, as [symbol, date]. */
export const YFINANCE_DAILY_INSIDE: readonly (readonly [string, string])[] = [["SPY", "2026-03-12"]];

export type StoredDailyProvider = "Polygon.io" | "yfinance";

/** The provider of a symbol's stored daily bar on this date ("YYYY-MM-DD"). */
export function storedDailyProvider(symbol: string, dateIso: string): StoredDailyProvider {
  const d = dateIso.slice(0, 10);
  const first = POLYGON_DAILY_FIRST_BY_SYMBOL[symbol];
  if (first === undefined || d < first || d > POLYGON_DAILY_LAST) return "yfinance";
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

const LATE_COUNT = Object.values(POLYGON_DAILY_FIRST_BY_SYMBOL).filter((d) => d === LATE).length;

/** The site-wide words for the stored daily table, for disclosure lines. */
export const STORED_DAILY_SOURCE =
  `stored daily candles and returns via the refresh pipeline: yfinance, except each stored ETF's bars from ` +
  `${fmtDate(EARLY)} (${fmtDate(LATE)} for ${LATE_COUNT} of them) to ${fmtDate(POLYGON_DAILY_LAST)}, ` +
  `which are Polygon.io bars kept from the earlier pipeline (${INSIDE_WORDS} is yfinance)`;
