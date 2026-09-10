/**
 * Provider vocabulary for the screens (2026-09-06): one place turns the
 * API's provenance fields and typed errors into the words a reader sees.
 * Every label names the provider, says delayed or live, and states the
 * fallback when one was used; every failure names its kind.
 */

import { ApiError } from "../../api/client";
import type { CandleSeries, Provider } from "../../api/types";
import { fmtDate, fmtUtcStampEt } from "../../lib/format";

export function providerName(p: Provider | null | undefined): string {
  if (p === "eodhd") return "EODHD";
  if (p === "yfinance") return "yfinance";
  return p ? String(p) : "source";
}

const REASON_WORDS: Record<string, string> = {
  missing_token: "EODHD not configured",
  unauthorized: "not in the EODHD plan",
  unknown_symbol: "no EODHD listing",
  unsupported: "instrument not supported by EODHD",
  rate_limited: "EODHD rate limit",
  timeout: "EODHD timed out",
  unavailable: "EODHD unavailable",
  malformed: "EODHD answered unreadably",
  empty: "EODHD returned no bars",
};

export function fallbackNote(reason: string | null | undefined): string {
  return reason ? `yfinance standing in (${REASON_WORDS[reason] ?? reason})` : "yfinance standing in";
}

const INTERVAL_WORDS: Record<string, string> = { "5m": "5-minute", "15m": "15-minute", "1h": "hourly", "1d": "daily", "1wk": "weekly", "1mo": "monthly" };

const NON_CORPORATE = new Set(["CC", "FOREX", "INDX"]);

/** "6M · daily bars · EODHD · through Sep 04, 2026 · split- and dividend-adjusted · delayed history, not the live tape."
 * The adjustment clause applies to listed equities and funds only (review P3-5);
 * the sentence ends with a full stop so callers can follow it with prose. */
export function candleCaption(s: CandleSeries): string {
  const parts = [
    `${s.range} · ${INTERVAL_WORDS[s.interval] ?? s.interval} bars`,
    s.fallback_used ? `${providerName(s.provider)} (${fallbackNote(s.fallback_reason)})` : providerName(s.provider),
    s.market_ts ? `through ${["1d", "1wk", "1mo"].includes(s.interval) ? fmtDate(s.market_ts) : fmtUtcStampEt(s.market_ts)}` : null,
    NON_CORPORATE.has(s.exchange ?? "") ? null : s.adjustment === "split_dividend_adjusted" ? "split- and dividend-adjusted" : s.adjustment,
    "delayed history, not the live tape",
  ];
  return `${parts.filter(Boolean).join(" · ")}.`;
}

/** Provider stamps without a zone are UTC; render them as ET wall time like
 * every other server stamp (review P2-6). */
export function fmtProviderStamp(stamp: string | null | undefined): string {
  if (!stamp) return "the last session";
  const iso = stamp.trim().replace(" ", "T");
  return fmtUtcStampEt(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

/** A typed sentence for a provider failure. `what` reads like "history" or
 * "the quote"; `symbol` is the house spelling. */
export function describeProviderError(err: unknown, what: string, symbol: string): string {
  if (!(err instanceof ApiError)) return `Unavailable: ${what} for ${symbol} did not load.`;
  switch (err.kind) {
    case "unknown_symbol":
      return `No listing found for ${symbol} on EODHD or yfinance.`;
    case "empty":
      return `No ${what} on file for ${symbol} in this range; try a longer range.`;
    case "unsupported":
      return `${symbol} is not a supported instrument for ${what}.`;
    case "unauthorized":
      return `${what[0].toUpperCase()}${what.slice(1)} for ${symbol} is not included in the data plan on this server.`;
    case "missing_token":
      return "Market data is not configured on this server (EODHD_API_TOKEN absent).";
    case "rate_limited":
      return "The data provider is rate limiting requests; it retries automatically in a moment.";
    case "timeout":
      return `The data provider did not answer in time for ${symbol}; retrying.`;
    case "unreachable":
      return "The data service is unreachable; stored data stays on screen until it returns.";
    case "malformed":
      return "The data provider answered unreadably; retrying.";
    default:
      break;
  }
  if (err.status === 404) return `No ${what} found for ${symbol}.`;
  if (err.status === 429) return "Too many requests right now; retry in a moment.";
  if (err.status === 503) return "The data service is starting up or unavailable; retrying.";
  return `Unavailable: ${err.message}`;
}
