/**
 * Which instrument Technicals shows (desk/usability §14.2): `?symbol=` names
 * a US-listed stock or ETF; no symbol, or a spelling of the S&P 500 itself,
 * is the page's default, the S&P 500. Pure.
 */

/** The spellings of the S&P 500 (the API's `SPX_SYMBOLS`, api/desk_v2.py). */
export const SPX_SYMBOLS: readonly string[] = ["^GSPC", "GSPC", "SPX", "^SPX", "GSPC.INDX"];

/** The symbol an address asks, upper-cased; null for the S&P 500 (the default) or a symbol that cannot be one. */
export function symbolOf(search: URLSearchParams | string): string | null {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = (p.get("symbol") ?? "").trim().toUpperCase();
  if (!raw || SPX_SYMBOLS.includes(raw)) return null;
  // The API's own rule (api/main.py _symbol_arg): 1–24 characters of letters, digits and . ^ = -.
  return /^[A-Z0-9.^=-]{1,24}$/.test(raw) ? raw : null;
}
