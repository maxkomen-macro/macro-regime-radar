/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) B.5 and
 * E.1, `screens/dashboard/MarketsGlance.test.tsx`: the Markets-at-a-glance
 * panel. Six Segmented options (aria-pressed), the symbol set per tab exactly
 * as the DB and the relay serve them, tiles priced through the shared quote
 * ladder (CLOSE from stored bars, the stream's own change, NO PRICE with the
 * live-only note for FX pairs and crypto), the What's priced tab panel with
 * its three tiles, meta line, note and link, the empty copy, panels mounted
 * `hidden` (never unmounted) and the `#whats-priced` hash selecting the tab.
 *
 * Rendered prop-less (the panel owns useMarketDaily / usePriced / useQuotes);
 * the live-quote store is mocked so each case sets the board it needs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import MarketsGlance from "./MarketsGlance";
import { GLANCE_DAILY_SYMBOLS, GLANCE_TABS } from "./glance-symbols";
import type { DailyBar, PricedMetric } from "../../api/types";
import type { LiveQuote } from "../../live/quotes";
import { renderWithProviders, stubFetch } from "../../test/utils";

const { liveQuotes } = vi.hoisted(() => ({ liveQuotes: new Map<string, LiveQuote>() }));
vi.mock("../../live/quotes", () => ({
  LIVE_WINDOW_MS: 120_000,
  useQuotes: () => liveQuotes,
  useWatch: () => {},
  watch: () => () => {},
  useStreamStatus: () => ({ socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false }),
  useStreamLive: () => false,
  useStreamWord: () => "Delayed",
  useLiveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamIsLive: () => false,
  liveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamWord: () => "Delayed",
}));

const DASH = "\u2014";
const PRIOR = "2026-09-11";
const LATEST = "2026-09-14";

/** The B.5 table: option id, label and the tile symbols per tab. */
const TABS = [
  { id: "equities", label: "Equities", symbols: ["SPY", "QQQ", "IWM", "EEM"] },
  { id: "rates", label: "Rates & credit", symbols: ["TLT", "IEF", "HYG", "LQD"] },
  { id: "fx", label: "FX", symbols: ["UUP", "EURUSD", "USDJPY"] },
  { id: "commodities", label: "Commodities", symbols: ["GLD", "SLV", "USO", "CPER"] },
  { id: "crypto", label: "Crypto", symbols: ["BTC-USD", "ETH-USD"] },
  { id: "priced", label: /^What.s priced$/, symbols: [] as string[] },
];
const STORED = ["SPY", "QQQ", "IWM", "EEM", "TLT", "IEF", "HYG", "LQD", "UUP", "GLD", "SLV", "USO", "CPER"];
const ALL_SYMBOLS = TABS.flatMap((t) => t.symbols);

const bar = (symbol: string, date: string, close: number, ret_1d: number | null): DailyBar => ({
  symbol,
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000,
  vwap: close,
  ret_1d,
  ret_1w: null,
  ret_1m: null,
});
/** Two stored sessions per stored symbol; SPY closes 640.10 then 645.20 (+0.80% on the day). */
const DAILY: DailyBar[] = STORED.flatMap((s, i) => {
  const base = s === "SPY" ? 640.1 : 100 + i * 10;
  const last = s === "SPY" ? 645.2 : base + 1.5;
  return [bar(s, PRIOR, base, null), bar(s, LATEST, last, s === "SPY" ? 0.8 : 1.5)];
});
const PRICED: PricedMetric[] = [
  { group: "Policy", metric: "SOFR", label: "SOFR", unit: "%", date: "2026-09-11", value: 4.31, mom_chg: -0.02 },
  { group: "Inflation", metric: "T10YIE", label: "10Y breakeven", unit: "%", date: "2026-09-11", value: 2.27, mom_chg: 0.05 },
  { group: "Real yields", metric: "DFII10", label: "10Y real yield", unit: "%", date: "2026-09-11", value: 1.84, mom_chg: 0.03 },
];

const wsQuote = (s: string, p: number, dc: number | null, delayed = false): LiveQuote => ({ s, p, dc, dd: dc, t: Date.now(), delayed, src: delayed ? "rest" : "ws" });

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Asset class" });
}
function option(label: string | RegExp): HTMLElement {
  return within(group()).getByRole("button", { name: label });
}
/** Symbol eyebrows on screen: exact-text matches outside any hidden panel. */
function visibleSymbols(root: HTMLElement): string[] {
  return ALL_SYMBOLS.filter((s) => within(root).queryAllByText(s).some((el) => !el.closest("[hidden]")));
}
/** The tile that holds one symbol: the widest ancestor holding no other glance symbol. */
function tileFor(root: HTMLElement, symbol: string): HTMLElement {
  const others = ALL_SYMBOLS.filter((s) => s !== symbol);
  const start = within(root).getAllByText(symbol).find((el) => !el.closest("[hidden]")) as HTMLElement;
  let el: HTMLElement = start;
  while (el.parentElement && el.parentElement !== root && !others.some((s) => within(el.parentElement as HTMLElement).queryAllByText(s).length > 0)) {
    el = el.parentElement;
  }
  return el;
}
/** Objects with a string `symbol` anywhere inside GLANCE_TABS, in source order. */
function symbolDefs(node: unknown, out: { symbol: string; name?: string }[] = []): { symbol: string; name?: string }[] {
  if (Array.isArray(node)) node.forEach((n) => symbolDefs(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.symbol === "string") out.push(o as { symbol: string; name?: string });
    else Object.values(o).forEach((v) => symbolDefs(v, out));
  }
  return out;
}

/** Text with `hidden` subtrees removed (Jargon tooltips, inactive panels), whitespace collapsed. */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const e = n as Element;
    if (e.hasAttribute("hidden")) return "";
    return [...e.childNodes].map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
}

async function renderGlance(route = "/app/dashboard") {
  const utils = renderWithProviders(<MarketsGlance />, { route });
  // The stored closes are on screen once the daily query has answered.
  await waitFor(() => expect(within(utils.container).queryAllByText(/^(?:CLOSE|NO PRICE)$/).length).toBeGreaterThan(0));
  return utils;
}

beforeEach(() => {
  liveQuotes.clear();
  stubFetch({ "/api/market/daily": () => DAILY, "/api/priced": () => PRICED });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarketsGlance (checklist 03 B.5)", () => {
  it("renders six aria-pressed options under the Asset class group, Equities pressed, with the panel header and link", async () => {
    await renderGlance();
    const buttons = within(group()).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Equities", "Rates & credit", "FX", "Commodities", "Crypto", expect.stringMatching(/^What.s priced$/)]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    for (const b of buttons) expect(b).toHaveAttribute("type", "button");
    expect(screen.getByRole("heading", { name: /^Markets at a glance$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View markets/ })).toHaveAttribute("href", "/app/markets");
  });

  it("each tab renders exactly the symbols in the B.5 table; the symbol modules agree", async () => {
    const { container } = await renderGlance();
    expect(visibleSymbols(container)).toEqual(["SPY", "QQQ", "IWM", "EEM"]);
    for (const tab of TABS) {
      fireEvent.click(option(tab.label));
      expect(option(tab.label)).toHaveAttribute("aria-pressed", "true");
      expect(within(group()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      expect(visibleSymbols(container), String(tab.label)).toEqual(tab.symbols);
    }
    // Names beside the symbols (a sample per tab), from the B.5 table.
    fireEvent.click(option("Equities"));
    expect(text(tileFor(container, "SPY"))).toContain("S&P 500");
    fireEvent.click(option("FX"));
    expect(text(tileFor(container, "EURUSD"))).toContain("Euro / dollar · rate");
    fireEvent.click(option("Crypto"));
    expect(text(tileFor(container, "BTC-USD"))).toContain("Bitcoin");

    expect(GLANCE_DAILY_SYMBOLS).toEqual(STORED);
    expect(GLANCE_TABS).toHaveLength(6);
    const defs = symbolDefs(GLANCE_TABS);
    expect(defs.map((d) => d.symbol)).toEqual(ALL_SYMBOLS);
    expect(defs.find((d) => d.symbol === "IEF")?.name).toBe("7\u201310Y Treasuries");
    expect(defs.find((d) => d.symbol === "USDJPY")?.name).toBe("Dollar / yen · rate");
  });

  it("a stored symbol with bars renders a sparkline, the stored change and a CLOSE tag when no live quote exists", async () => {
    const { container } = await renderGlance();
    const spy = tileFor(container, "SPY");
    expect(within(spy).getByText("645.20")).toBeInTheDocument();
    const tag = within(spy).getByText("CLOSE");
    expect(tag).toHaveAttribute("title", "Stored close, Sep 14, 2026");
    // 1D change falls back to the newest bar's server-computed ret_1d.
    expect(text(spy)).toContain("+0.80%");
    expect(spy.querySelector("svg path")).not.toBeNull();
    expect(within(spy).queryByText("NO PRICE")).toBeNull();
    expect(text(spy)).not.toContain("live only");
  });

  it("a live quote with a day change renders the stream's change and no tag", async () => {
    liveQuotes.set("SPY", wsQuote("SPY", 650.1, 1.23));
    const { container } = await renderGlance();
    const spy = tileFor(container, "SPY");
    expect(within(spy).getByText("650.10")).toBeInTheDocument();
    expect(text(spy)).toContain("+1.23%");
    expect(text(spy)).not.toContain("+0.80%");
    expect(within(spy).queryByText(/^(?:15M|LAST|CLOSE|NO PRICE)$/)).toBeNull();
    // The other equities still read their stored closes.
    expect(within(tileFor(container, "QQQ")).getByText("CLOSE")).toBeInTheDocument();
  });

  it("a live-only symbol without a quote renders the dash placeholder, NO PRICE and the live-only note", async () => {
    const { container } = await renderGlance();
    fireEvent.click(option("FX"));
    const eur = tileFor(container, "EURUSD");
    expect(within(eur).getByText(DASH)).toBeInTheDocument();
    expect(within(eur).getByText("NO PRICE")).toBeInTheDocument();
    expect(text(eur)).toContain("live only · no stored history");
    expect(eur.querySelector("svg path")).toBeNull();
    expect(within(tileFor(container, "USDJPY")).getByText("NO PRICE")).toBeInTheDocument();
    // UUP is stored: it prices from its close and carries no live-only note.
    const uup = tileFor(container, "UUP");
    expect(within(uup).getByText("CLOSE")).toBeInTheDocument();
    expect(text(uup)).not.toContain("live only");
    fireEvent.click(option("Crypto"));
    const btc = tileFor(container, "BTC-USD");
    expect(within(btc).getByText("NO PRICE")).toBeInTheDocument();
    expect(text(btc)).toContain("live only · no stored history");
    expect(btc.querySelector("svg path")).toBeNull();
  });

  it("the What's priced panel renders the three tiles, the MoM delta in pp, the meta line, the note and the Markets link", async () => {
    await renderGlance();
    fireEvent.click(option(/^What.s priced$/));
    const panel = document.getElementById("whats-priced") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveAttribute("hidden");
    for (const label of ["SOFR", "10Y breakeven", "10Y real yield"]) expect(within(panel).getByText(label)).toBeInTheDocument();
    expect(within(panel).getByText("4.31%")).toBeInTheDocument();
    expect(within(panel).getByText("2.27%")).toBeInTheDocument();
    expect(within(panel).getByText("1.84%")).toBeInTheDocument();
    const t = text(panel);
    expect(t).toContain("+0.05pp MoM");
    expect(t).toContain("-0.02pp MoM");
    expect(t).toContain("inflation · weekly pipeline · Sep 11, 2026");
    expect(t).toContain("3-row teaser · full table in Markets");
    expect(t).toContain("The market's own pricing: breakevens for expected inflation, TIPS for real yields. All six metrics with the policy rate sit in Markets.");
    expect(within(panel).getByRole("button", { name: "breakevens" })).toHaveClass("jargon");
    expect(within(panel).getByRole("button", { name: "TIPS" })).toHaveClass("jargon");
    expect(within(panel).getByRole("link", { name: "\u2192 See all in Markets" })).toHaveAttribute("href", "/app/markets#whats-priced-full");
    expect(within(panel).queryByText(/No priced metrics on file/)).toBeNull();
  });

  it("renders the empty copy when /api/priced returns []", async () => {
    stubFetch({ "/api/market/daily": () => DAILY, "/api/priced": () => [] });
    await renderGlance();
    fireEvent.click(option(/^What.s priced$/));
    const panel = document.getElementById("whats-priced") as HTMLElement;
    expect(await within(panel).findByText("No priced metrics on file; the weekly pipeline has not written them yet.")).toBeInTheDocument();
    expect(within(panel).queryByText("SOFR")).toBeNull();
    expect(within(panel).getByRole("link", { name: "\u2192 See all in Markets" })).toHaveAttribute("href", "/app/markets#whats-priced-full");
  });

  it("panels are mounted hidden, not unmounted, so #whats-priced always resolves", async () => {
    const { container } = await renderGlance();
    const panel = document.getElementById("whats-priced") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    expect(panel.closest("[hidden]")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "\u2192 See all in Markets" })).toBeNull(); // inaccessible while hidden
    fireEvent.click(option(/^What.s priced$/));
    expect(panel).not.toHaveAttribute("hidden");
    expect(document.getElementById("whats-priced")).toBe(panel); // same node, never remounted
    // The equities tiles stay in the DOM behind a hidden ancestor.
    const spy = within(container).getAllByText("SPY").find((el) => el.closest("[hidden]") !== null);
    expect(spy).toBeDefined();
    fireEvent.click(option("Equities"));
    expect(panel).toHaveAttribute("hidden");
    expect(visibleSymbols(container)).toEqual(["SPY", "QQQ", "IWM", "EEM"]);
  });

  it("#whats-priced in the route hash selects the What's priced tab on mount", async () => {
    await renderGlance("/app/dashboard#whats-priced");
    expect(option(/^What.s priced$/)).toHaveAttribute("aria-pressed", "true");
    expect(option("Equities")).toHaveAttribute("aria-pressed", "false");
    expect(document.getElementById("whats-priced")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("link", { name: "\u2192 See all in Markets" })).toBeInTheDocument();
  });
});
