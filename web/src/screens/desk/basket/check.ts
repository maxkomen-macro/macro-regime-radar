/**
 * Whether a ticker can go in a basket (desk/books): asked of the price
 * endpoint the basket is priced from, `/api/market/candles/{SYM}?range=2Y`
 * (EODHD's daily bars). A plain input checked this way stands in for the
 * shared InstrumentSearch until desk/usability lands; at that rebase the
 * search's pick replaces this check.
 *
 * Three answers: listed (it has daily bars); not listed (the endpoint says
 * the symbol is unknown or malformed), in the endpoint's words; or not
 * checked (the endpoint did not answer), with why, so the page can add the
 * name and let the price say whether it is listed.
 */

const BASE: string = import.meta.env.VITE_API_BASE ?? "";
const TIMEOUT_MS = 15_000;

export type TickerCheck = { state: "listed"; last: string | null } | { state: "unlisted"; words: string } | { state: "unchecked"; words: string };

/** The served words of a refusal: FastAPI's `detail` when it is a sentence. */
function detailOf(body: unknown): string | null {
  const d = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  return typeof d === "string" && d.trim() ? d : null;
}

export async function checkTicker(symbol: string, fetcher: typeof fetch = fetch): Promise<TickerCheck> {
  let res: Response;
  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    res = await fetcher(`${BASE}/api/market/candles/${encodeURIComponent(symbol)}?range=2Y`, { headers: { Accept: "application/json" }, signal });
  } catch {
    return { state: "unchecked", words: "the price service did not answer" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.ok) {
    const bars = body && typeof body === "object" ? (body as { bars?: { ts?: unknown }[] }).bars : undefined;
    if (Array.isArray(bars) && bars.length) {
      const ts = bars[bars.length - 1]?.ts;
      return { state: "listed", last: typeof ts === "string" ? ts.slice(0, 10) : null };
    }
    return { state: "unlisted", words: `no daily prices for ${symbol}` };
  }
  const kind = body && typeof body === "object" ? (body as { kind?: unknown }).kind : undefined;
  if (res.status === 422 || kind === "unknown_symbol" || kind === "empty") return { state: "unlisted", words: detailOf(body) ?? `${symbol} is not a listed US ticker` };
  return { state: "unchecked", words: detailOf(body) ?? `the price service answered ${res.status}` };
}
