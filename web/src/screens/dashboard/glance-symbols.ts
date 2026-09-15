/**
 * Symbol sets for the Dashboard's "Markets at a glance" panel (redesign
 * Phase 3, checklist 03 B.5): exactly what the DB stores and the relay serves
 * today. `stored` symbols have `market_daily` rows (sparkline and a dated
 * CLOSE fallback); the FX pairs and crypto exist on the relay feeds only
 * (`api/stream.py` FOREX_SYMBOLS / CRYPTO_SYMBOLS), so their tiles are
 * live-only and never padded with an unserved instrument (F2, F3).
 */

export type GlanceTabId = "equities" | "rates" | "fx" | "commodities" | "crypto" | "priced";

export interface GlanceSymbol {
  symbol: string;
  name: string;
  /** Price formatting family: `usd` prints 2 dp; `fx` 4 dp (EURUSD) or 3 dp (USDJPY). */
  kind: "usd" | "fx" | "crypto";
  /** Relay feed the symbol ticks on (all are on the fixed subscription). */
  feed: "us" | "forex" | "crypto";
  /** `market_daily` rows exist: sparkline, `ret_1d`, dated CLOSE fallback. */
  stored: boolean;
}

export interface GlanceTab {
  id: GlanceTabId;
  label: string;
  /** Empty for the What's priced tab (a teaser panel, not tiles). */
  symbols: GlanceSymbol[];
}

const us = (symbol: string, name: string): GlanceSymbol => ({ symbol, name, kind: "usd", feed: "us", stored: true });

export const GLANCE_TABS: GlanceTab[] = [
  {
    id: "equities",
    label: "Equities",
    symbols: [us("SPY", "S&P 500"), us("QQQ", "Nasdaq 100"), us("IWM", "Russell 2000"), us("EEM", "EM equities")],
  },
  {
    // "Rates & credit", not the PNG's "Rates": two of the four stored tiles
    // are credit ETFs (G15).
    id: "rates",
    label: "Rates & credit",
    symbols: [us("TLT", "20Y+ Treasuries"), us("IEF", "7–10Y Treasuries"), us("HYG", "High-yield credit"), us("LQD", "IG credit")],
  },
  {
    id: "fx",
    label: "FX",
    symbols: [
      us("UUP", "US dollar"),
      { symbol: "EURUSD", name: "Euro / dollar · rate", kind: "fx", feed: "forex", stored: false },
      { symbol: "USDJPY", name: "Dollar / yen · rate", kind: "fx", feed: "forex", stored: false },
    ],
  },
  {
    id: "commodities",
    label: "Commodities",
    symbols: [us("GLD", "Gold"), us("SLV", "Silver"), us("USO", "Oil (WTI)"), us("CPER", "Copper")],
  },
  {
    id: "crypto",
    label: "Crypto",
    symbols: [
      { symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", feed: "crypto", stored: false },
      { symbol: "ETH-USD", name: "Ether", kind: "crypto", feed: "crypto", stored: false },
    ],
  },
  { id: "priced", label: "What's priced", symbols: [] },
];

/** The stored subset: one `useMarketDaily(GLANCE_DAILY_SYMBOLS, 45)` request. */
export const GLANCE_DAILY_SYMBOLS: string[] = GLANCE_TABS.flatMap((t) => t.symbols.filter((s) => s.stored).map((s) => s.symbol));

/** The What's priced anchor; `#whats-priced` selects that tab. */
export const WHATS_PRICED_HASH = "#whats-priced";

export function glanceTabFromHash(hash: string): GlanceTabId | null {
  return hash === WHATS_PRICED_HASH ? "priced" : null;
}
