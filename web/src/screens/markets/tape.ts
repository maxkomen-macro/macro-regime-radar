/**
 * Markets tape registry and formatters (redesign Phase 5, checklist 05 A.2):
 * moved byte-identical from MarketsScreen.tsx so the hero, the tape panel and
 * the tests import them without mounting the screen. Every export here is
 * pure: no hooks, no React tree.
 */

import type React from "react";
import { LIVE_WINDOW_MS, type FeedState, type LiveQuote } from "../../live/quotes";
import { fmtSigned } from "../../lib/format";

/* ── symbol registry ───────────────────────────────────────────────────── */

export type Kind = "usd" | "fx" | "index";
export type Feed = "us" | "crypto" | "forex" | "vix";

export interface TapeDef {
  symbol: string;
  name: string;
  kind: Kind;
  feed: Feed;
}

/** The tape reads top-down as a macro dashboard: risk assets first, then the
 * rates/credit/dollar complex, then real assets, crypto, and the fear gauge.
 * Eyebrow rows make that ordering visible (ruled 2026-08-06). */
export const TAPE_GROUPS: { label: string; defs: TapeDef[] }[] = [
  {
    label: "Equities",
    defs: [
      { symbol: "SPY", name: "S&P 500", kind: "usd", feed: "us" },
      { symbol: "QQQ", name: "Nasdaq 100", kind: "usd", feed: "us" },
      { symbol: "IWM", name: "Russell 2000", kind: "usd", feed: "us" },
      { symbol: "EEM", name: "EM equities", kind: "usd", feed: "us" },
      { symbol: "EFA", name: "Intl developed", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Rates",
    defs: [
      { symbol: "TLT", name: "20Y+ Treasuries", kind: "usd", feed: "us" },
      { symbol: "IEF", name: "7–10Y Treasuries", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Credit",
    defs: [
      { symbol: "HYG", name: "High-yield credit", kind: "usd", feed: "us" },
      { symbol: "LQD", name: "IG credit", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Dollar & FX",
    defs: [
      { symbol: "UUP", name: "US dollar", kind: "usd", feed: "us" },
      { symbol: "EURUSD", name: "Euro / dollar · rate", kind: "fx", feed: "forex" },
      { symbol: "USDJPY", name: "Dollar / yen · rate", kind: "fx", feed: "forex" },
    ],
  },
  {
    label: "Metals",
    defs: [
      { symbol: "GLD", name: "Gold", kind: "usd", feed: "us" },
      { symbol: "SLV", name: "Silver", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Energy & Industrial",
    defs: [
      { symbol: "USO", name: "Oil (WTI)", kind: "usd", feed: "us" },
      { symbol: "CPER", name: "Copper", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Crypto",
    defs: [
      { symbol: "BTC-USD", name: "Bitcoin", kind: "usd", feed: "crypto" },
      { symbol: "ETH-USD", name: "Ether", kind: "usd", feed: "crypto" },
    ],
  },
  {
    label: "Volatility",
    defs: [{ symbol: "VIX", name: "VIX · index", kind: "index", feed: "vix" }],
  },
];

export const MACRO_TAPE: TapeDef[] = TAPE_GROUPS.flatMap((g) => g.defs);

export const SINGLE_NAMES: TapeDef[] = [
  { symbol: "AAPL", name: "Apple", kind: "usd", feed: "us" },
  { symbol: "MSFT", name: "Microsoft", kind: "usd", feed: "us" },
  { symbol: "NVDA", name: "Nvidia", kind: "usd", feed: "us" },
  { symbol: "GOOGL", name: "Alphabet", kind: "usd", feed: "us" },
  { symbol: "AMZN", name: "Amazon", kind: "usd", feed: "us" },
  { symbol: "META", name: "Meta Platforms", kind: "usd", feed: "us" },
  { symbol: "TSLA", name: "Tesla", kind: "usd", feed: "us" },
  { symbol: "AVGO", name: "Broadcom", kind: "usd", feed: "us" },
  { symbol: "TSM", name: "TSMC", kind: "usd", feed: "us" },
  { symbol: "MU", name: "Micron", kind: "usd", feed: "us" },
  { symbol: "AMD", name: "AMD", kind: "usd", feed: "us" },
  { symbol: "COIN", name: "Coinbase", kind: "usd", feed: "us" },
];

/** Symbols the DB stores daily candles for (chart panel + 1W/1M/spark). */
export const DB_SYMBOLS = new Set([
  "SPY", "QQQ", "IWM", "TLT", "IEF", "HYG", "LQD",
  "UUP", "GLD", "SLV", "USO", "CPER", "EEM", "EFA",
]);
export const SECTORS: { symbol: string; name: string }[] = [
  { symbol: "XLF", name: "Financials" },
  { symbol: "XLE", name: "Energy" },
  { symbol: "XLI", name: "Industrials" },
  { symbol: "XLK", name: "Technology" },
];
export const DAILY_FETCH = [...DB_SYMBOLS, ...SECTORS.map((s) => s.symbol)];

/* ── formatting ────────────────────────────────────────────────────────── */

export function fmtPrice(def: TapeDef, p: number): string {
  if (def.kind === "fx") return def.symbol === "EURUSD" ? p.toFixed(4) : p.toFixed(3);
  const n =
    p >= 1_000
      ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.toFixed(2);
  return def.kind === "usd" ? `$${n}` : n;
}

export function fmtDayDollar(def: TapeDef, dd: number): string {
  if (def.kind === "fx") return fmtSigned(dd, def.symbol === "EURUSD" ? 4 : 3);
  return fmtSigned(dd, 2);
}

export const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
export const fmtEtClock = (ms: number) => `${ET_CLOCK.format(new Date(ms))} ET`;

export const ET_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "Aug 05, 16:00 ET" — every stale row states WHEN, not a constant string. */
export function fmtEtStamp(ms: number): string {
  const parts = ET_STAMP.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ET`;
}

/** Freshness is derived, never asserted (critique 2026-08-06): live rows show
 * a ticking ● clock; everything else prints the actual quote timestamp, with
 * the 15-minute REST delay stated where it applies. A constant string renders
 * only when the feed gave us no timestamp at all. */
export function asOfCell(q: LiveQuote | undefined): { text: string; live: boolean } {
  if (!q) return { text: "—", live: false };
  const fresh = q.t != null && Date.now() - q.t < LIVE_WINDOW_MS;
  if (q.src === "ws" && q.t != null) {
    return fresh
      ? { text: fmtEtClock(q.t), live: true }
      : { text: fmtEtStamp(q.t), live: false };
  }
  if (q.t != null) {
    return { text: `${fmtEtStamp(q.t)}${q.delayed ? " · 15m" : ""}`, live: false };
  }
  return { text: q.delayed ? "15m delayed" : "—", live: false };
}

/* ── shared cell styles ────────────────────────────────────────────────── */

export const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};
export const headerCell: React.CSSProperties = {
  ...mono,
  fontSize: "var(--fs-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-wide)",
  color: "var(--text-muted)",
  textAlign: "right",
};
// Captions are prose: UI face at --fs-caption (the 2026-08-26 readability
// pass) — mono inside a caption is opt-in per number via <span style={mono}>.
export const capStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-muted)",
  lineHeight: 1.55,
  marginTop: 6,
  maxWidth: "var(--maxw-prose)",
};

// A missing figure is information ("no quote"), so the dash reads at muted,
// never the decorative faint rung (executive pass, 2026-09-05).
export const toneColor = (v: number | null | undefined) =>
  v == null ? "var(--text-muted)" : v >= 0 ? "var(--pos)" : "var(--neg-text)";

/* ── feed status line ──────────────────────────────────────────────────── */

/** True during NYSE regular hours (Mon–Fri 09:30–16:00 ET, holidays not
 * modeled) — used only to pick honest wording, never to claim data. */
export function nyseSessionOpen(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (["Sat", "Sun"].includes(get("weekday"))) return false;
  const mins = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function feedWord(
  feed: "us" | "crypto" | "forex" | "vix",
  state: FeedState | undefined,
  hasLiveTicks: boolean,
): { text: string; color: string } {
  if (state === "open" && hasLiveTicks) return { text: "● live", color: "var(--pos)" };
  if (state === "open") {
    // Connected but tickless — say it in trader words, not engineer words
    // (critique: "idle" scans as broken to a skimmer).
    const text =
      feed === "us"
        ? nyseSessionOpen()
          ? "awaiting trades"
          : "session closed"
        : "quiet";
    return { text, color: "var(--text-muted)" };
  }
  if (state === "rest") return { text: "15m delayed", color: "var(--text-muted)" };
  if (state === "auth_failed") return { text: "feed rejected by the provider", color: "var(--neg-text)" };
  if (state === "connecting") return { text: "connecting", color: "var(--text-muted)" };
  if (state === "closed") return { text: "reconnecting", color: "var(--text-muted)" };
  if (state === "off" || state == null) return { text: "off", color: "var(--text-muted)" };
  // Never a raw machine state on screen: anything new reads as unavailable.
  return { text: "unavailable", color: "var(--text-muted)" };
}
