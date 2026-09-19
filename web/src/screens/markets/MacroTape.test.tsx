/**
 * Phase 5 checklist (docs/redesign-v2/checklists/05-markets.md) section B.7
 * and E.1, `screens/markets/MacroTape.test.tsx`: the `#watchlist` panel
 * rendered directly with fixture props (the seam MarketsScreen composes
 * against). The header list, the eight groups and their 19 rows (counted from
 * the registry, never typed: checklist 05 says 18), the as-of ladder,
 * the feed's own day figures, the sparkline rule, the row click seam (one call
 * per click, never two), the selected rail, the Single names block under the
 * macro tape (Iteration 1 M3b: always rendered, no Tape view toggle), the
 * visible live-or-last-close line with the provenance behind Details
 * (Iteration 1 M2), the phone column set (useBreakpoint mocked) and the
 * 600 ms tick flash (fake timers). The clock is frozen to a Saturday so the
 * live window and the NYSE words are deterministic. Fixtures dated Sep 2026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import MacroTape, { FeedStatusLine, tapeStatusLine, type MacroTapeProps } from "./MacroTape";
import { useTickFlash } from "./useTickFlash";
import { SINGLE_NAMES, TAPE_GROUPS, fmtEtClock, fmtEtStamp, type TapeDef } from "./tape";
import type { LiveQuote, StreamStatus } from "../../live/quotes";
import type { DailyBar } from "../../api/types";
import { renderWithProviders } from "../../test/utils";

/* ── mocks ───────────────────────────────────────────────────────────────── */

const live = vi.hoisted(() => ({
  status: { socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false } as {
    socket: "connecting" | "open" | "closed";
    feeds: Record<string, string>;
    stale: Record<string, boolean>;
    degraded: boolean;
    degradedReasons: string[];
    lastBatchAt: number | null;
    attempts: number;
    everOpened: boolean;
  },
  quotes: new Map<string, unknown>(),
}));
vi.mock("../../live/quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../live/quotes")>();
  const status = () => live.status as StreamStatus;
  const quotes = () => live.quotes as ReadonlyMap<string, LiveQuote>;
  return {
    ...actual,
    useQuotes: quotes,
    useStreamStatus: status,
    useWatch: () => {},
    watch: () => () => {},
    useStreamLive: () => actual.streamIsLive(status(), quotes()),
    useStreamWord: () => actual.streamWord(status(), quotes()),
    useLiveFeeds: () => actual.liveFeeds(status(), quotes()),
  };
});

const bp = vi.hoisted(() => ({ narrow: false }));
vi.mock("../../lib/useBreakpoint", () => {
  const WIDE = Object.freeze({ bp: "wide", isMobile: false, isTablet: false, isNarrow: false, shellCompact: false });
  const NARROW = Object.freeze({ bp: "mobile", isMobile: true, isTablet: false, isNarrow: true, shellCompact: true });
  return { SHELL_COMPACT_QUERY: "(max-width: 859.98px)", useBreakpoint: () => (bp.narrow ? NARROW : WIDE) };
});

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Saturday Sep 19 2026, 11:00 ET. */
const NOW = new Date("2026-09-19T15:00:00Z");
const NOW_MS = NOW.getTime();
const DATES = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
const STORED_THROUGH = DATES[DATES.length - 1];
/** The app's numeric placeholder glyph (a dash, not prose copy). */
const DASH = "\u2014";
const LIVE_T = NOW_MS - 5_000;
const DELAYED_T = NOW_MS - 20 * 60_000;

const bars = (symbol: string, closes: number[], rets: [number | null, number | null, number | null] = [null, null, null]): DailyBar[] =>
  closes.map((close, i) => {
    const last = i === closes.length - 1;
    return {
      symbol,
      date: DATES[DATES.length - closes.length + i],
      open: close,
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: 1_000,
      vwap: close,
      ret_1d: last ? rets[0] : null,
      ret_1w: last ? rets[1] : null,
      ret_1m: last ? rets[2] : null,
    };
  });

const BARS = new Map<string, DailyBar[]>([
  ["SPY", bars("SPY", [640.1, 642.3, 644.8, 646.2, 647.9], [0.42, 1.31, 2.07])],
  ["QQQ", bars("QQQ", [566.2, 568.1, 569.4, 570.9, 571.4], [1.01, 1.84, 3.12])],
  ["IWM", bars("IWM", [229.4, 229.1, 228.9, 228.6, 228.15], [-0.35, -0.62, 0.88])],
  ["TLT", bars("TLT", [88.9, 88.5, 88.1, 87.8, 87.44], [-0.58, -1.07, -2.3])],
  ["UUP", bars("UUP", [28.1, 28.0, 27.95, 27.9, 27.86], [-0.24, -0.91, -1.1])],
  ["GLD", bars("GLD", [318.7], [0.83, 2.06, 4.4])], // one close: no sparkline
]);

const quote = (s: string, p: number, over: Partial<LiveQuote> = {}): LiveQuote => ({ s, p, dc: null, dd: null, t: DELAYED_T, delayed: true, src: "rest", ...over });
const QUOTES = new Map<string, LiveQuote>([
  ["SPY", quote("SPY", 646.31, { dc: 0.42, dd: 2.7, t: LIVE_T, delayed: false, src: "ws" })], // live tick
  ["QQQ", quote("QQQ", 571.9, { dc: -0.35, dd: -2.01 })], // delayed REST row
  ["IWM", quote("IWM", 228.4)], // price without a day change
  ["EURUSD", quote("EURUSD", 1.0842, { dc: 0.12, dd: 0.0013, t: LIVE_T, delayed: false, src: "ws" })],
  ["VIX", quote("VIX", 15.72, { t: null })], // the delayed poll with no stamp
]);

const noop = () => {};
const singlesOf = (...first: string[]): TapeDef[] => [
  ...first.map((s) => SINGLE_NAMES.find((d) => d.symbol === s) as TapeDef),
  ...SINGLE_NAMES.filter((d) => !first.includes(d.symbol)),
];

/* ── harness ─────────────────────────────────────────────────────────────── */

type HarnessProps = Partial<MacroTapeProps>;

/** Holds the controlled `selected` seam like the screen does. */
function Harness({ selected: initialSelected = null, onSelect, ...rest }: HarnessProps) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const select = onSelect ?? ((s: string) => setSelected((cur) => (cur === s ? null : s)));
  return (
    <MacroTape
      quotes={rest.quotes ?? QUOTES}
      barsBySymbol={rest.barsBySymbol ?? BARS}
      singles={rest.singles ?? singlesOf()}
      selected={selected}
      onSelect={select}
      registerRow={rest.registerRow ?? noop}
      live={rest.live ?? false}
      storedThrough={rest.storedThrough === undefined ? STORED_THROUGH : rest.storedThrough}
    />
  );
}
const renderTape = (props: HarnessProps = {}) => renderWithProviders(<Harness {...props} />, { route: "/app/markets" });

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
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const panel = () => byId("watchlist") as HTMLElement;
const table = () => panel().querySelector("table") as HTMLTableElement;
const headers = () => [...table().querySelectorAll("thead th")].map((th) => text(th));
const groupRows = () => [...table().querySelectorAll<HTMLTableRowElement>("tbody tr.mrr-grp")];
const dataRows = () => [...table().querySelectorAll<HTMLTableRowElement>("tbody tr:not(.mrr-grp)")];
const rowButton = (symbol: string) => within(panel()).getByRole("button", { name: symbol });
const rowOf = (symbol: string) => rowButton(symbol).closest("tr") as HTMLTableRowElement;
const cellsOf = (symbol: string) => [...rowOf(symbol).querySelectorAll("td")];
const col = (label: string) => headers().indexOf(label);
const cell = (symbol: string, label: string) => cellsOf(symbol)[col(label)];
/** The innermost element carrying an inline colour inside a cell, else the cell. */
function colorOf(el: Element): string {
  const els = [...el.querySelectorAll<HTMLElement>("[style]")].filter((e) => e.style.color);
  return (els[els.length - 1] ?? (el as HTMLElement)).style.color;
}
const symbolOrder = () => dataRows().map((r) => text(r.querySelector("button")));
/* The single names table (always rendered under the macro tape, Iteration 1 M3b). */
const singlesWrap = () => byId("single-names") as HTMLElement;
const singlesTable = () => singlesWrap().querySelector("table") as HTMLTableElement;
const singlesHeaders = () => [...singlesTable().querySelectorAll("thead th")].map((th) => text(th));
const singlesRows = () => [...singlesTable().querySelectorAll<HTMLTableRowElement>("tbody tr:not(.mrr-grp)")];
const singlesCell = (symbol: string, label: string) => {
  const row = within(singlesWrap()).getByRole("button", { name: symbol }).closest("tr") as HTMLTableRowElement;
  return [...row.querySelectorAll("td")][singlesHeaders().indexOf(label)];
};
/** Opens the tape's Details disclosure (the M2 provenance paragraphs). */
const openDetails = () => fireEvent.click(within(panel()).getByRole("button", { name: /Details/ }));

const WIDE_HEADERS = ["Symbol · name", "Last", "Day %", "Day Δ$", "1W %", "1M %", "30 Sess", "As of"];
const NARROW_HEADERS = ["Symbol · name", "Last", "Day %", "1M %", "As of"];
const SINGLES_HEADERS = ["Symbol · name", "Last", "Day %", "Day Δ$", "As of"];
const SINGLES_NARROW_HEADERS = ["Symbol · name", "Last", "Day %", "As of"];
const GROUP_LABELS = ["Equities", "Rates", "Credit", "Dollar & FX", "Metals", "Energy & Industrial", "Crypto", "Volatility"];
/** 19 on disk (5+2+2+3+2+2+2+1); the checklist's "18" is a miscount, so the count is read from the registry. */
const MACRO_ROWS = TAPE_GROUPS.reduce((n, g) => n + g.defs.length, 0);
const MACRO_TABLE_NAME = new RegExp(`^Macro tape: ${MACRO_ROWS} symbols in (?:${TAPE_GROUPS.length}|eight) groups$`);
const SINGLES_CAPTION = "Twelve large-cap tech, semis, and crypto-adjacent names as market thermometers; biggest day move on top. Off-hours the board holds at the last close until the next session opens.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  bp.narrow = false;
  live.status = { socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false };
  live.quotes = new Map();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("MacroTape (checklist 05 B.7)", () => {
  it("renders the panel section with its heading, no view toggle, the eight headers at wide width and the five on a phone, and the single names under the tape", () => {
    const wide = renderTape();
    expect(panel().tagName).toBe("SECTION");
    expect(within(panel()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Macro tape$/);
    // Iteration 1 M3b: no Macro / Single names toggle hides either list.
    expect(within(panel()).queryByRole("group", { name: "Tape view" })).toBeNull();
    expect(table()).toHaveClass("mrr-tape");
    expect(screen.getByRole("table", { name: MACRO_TABLE_NAME })).toBe(table());
    expect(headers()).toEqual(WIDE_HEADERS);
    for (const th of table().querySelectorAll("thead th")) expect(th).toHaveAttribute("scope", "col");
    expect(byId("single-names")).not.toBeNull();
    expect(panel().contains(byId("single-names"))).toBe(true);
    expect(within(singlesWrap()).getByRole("heading", { level: 3 })).toHaveTextContent(/^Single names$/);
    wide.unmount();

    bp.narrow = true;
    renderTape();
    expect(headers()).toEqual(NARROW_HEADERS);
    expect(cellsOf("SPY")).toHaveLength(NARROW_HEADERS.length);
    // The name stays inline under the symbol on the phone set.
    expect(text(cell("SPY", "Symbol · name"))).toContain("S&P 500");
  });

  it("renders eight group rows with the C.2 labels and every registry symbol as a row in registry order, each with its inline name", () => {
    renderTape();
    expect(groupRows()).toHaveLength(8);
    expect(groupRows().map((r) => text(r))).toEqual(GROUP_LABELS);
    expect(MACRO_ROWS).toBe(19);
    expect(dataRows()).toHaveLength(MACRO_ROWS);
    expect(symbolOrder()).toEqual(TAPE_GROUPS.flatMap((g) => g.defs.map((d) => d.symbol)));
    for (const def of TAPE_GROUPS.flatMap((g) => g.defs)) {
      const symbolCell = cell(def.symbol, "Symbol · name");
      const sub = symbolCell.querySelector(".mrr-nm");
      expect(sub, `${def.symbol} name`).not.toBeNull();
      expect(text(sub)).toBe(def.name);
    }
    // Group rows never carry the row attributes.
    for (const g of groupRows()) {
      expect(g.hasAttribute("data-clickable")).toBe(false);
      expect(g.hasAttribute("data-selected")).toBe(false);
    }
    expect(text(panel())).toContain("through Sep 18, 2026");
    // M2: the provenance paragraphs sit behind Details on the same panel.
    expect(text(panel())).not.toContain("Day moves come straight from the exchange feed");
    openDetails();
    expect(text(panel())).toContain("Day moves come straight from the exchange feed");
    expect(text(panel())).toContain("Every row states its own as-of stamp");
    expect(text(panel())).not.toContain("return above 768px");
  });

  it("M2: one visible line says live or last close with the as-of stamp, at most two sentences, and the provenance opens behind Details", () => {
    // Socket closed (the harness default): the stored-close line with its date.
    renderTape();
    const details = within(panel()).getByRole("button", { name: /Details/ });
    expect(details).toHaveAttribute("aria-expanded", "false");
    // Iteration 1 step 5 (G4): one status line visible; its full sentence leads the Details panel.
    expect(text(panel())).toContain("Last close · stored through Sep 18, 2026");
    expect(text(panel())).not.toContain("Showing the last close: the stream is not connected");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(text(panel())).toContain("Showing the last close: the stream is not connected, so rows print stored closes through Sep 18, 2026.");
    expect(text(panel())).toContain("A dash under Day % means the feed sent a price without a day change");
    expect(text(panel())).toContain("The dashboard's VIX spike signal reads the monthly signal print");
  });

  it("the ticker button is the assistive path: type button, aria-expanded, aria-controls the chart panel, a title, and it registers its ref", () => {
    const registerRow = vi.fn();
    renderTape({ registerRow });
    const spy = rowButton("SPY");
    expect(spy.tagName).toBe("BUTTON");
    expect(spy).toHaveAttribute("type", "button");
    expect(spy).toHaveClass("mrr-tape-btn");
    expect(spy).toHaveAttribute("aria-expanded", "false");
    expect(spy).toHaveAttribute("aria-controls", "markets-chart-panel");
    expect(spy).toHaveAttribute("title", "Open SPY chart");
    expect(registerRow).toHaveBeenCalledWith("SPY", spy);
    expect(registerRow.mock.calls.filter(([, el]) => el instanceof HTMLButtonElement).map(([s]) => s)).toEqual(expect.arrayContaining(["SPY", "VIX", "BTC-USD"]));
    for (const row of dataRows()) {
      expect(row.hasAttribute("data-clickable")).toBe(true);
      expect(row).toHaveAttribute("data-selected", "false");
    }
  });

  it("as-of ladder: a live tick prints the clock in --pos, a delayed row prints its stamp with 15m, a stored row prints its dated close, and nothing prints the dash", () => {
    renderTape();
    const asOf = (s: string) => cell(s, "As of");
    expect(text(asOf("SPY"))).toBe(`\u25cf ${fmtEtClock(LIVE_T)}`);
    expect(text(asOf("SPY"))).toMatch(/^\u25cf \d\d:\d\d:\d\d ET$/);
    expect(colorOf(asOf("SPY"))).toBe("var(--pos)");
    expect(text(asOf("QQQ"))).toBe(`${fmtEtStamp(DELAYED_T)} · 15m`);
    expect(text(asOf("QQQ"))).toMatch(/^[A-Z][a-z]{2} \d\d, \d\d:\d\d ET · 15m$/);
    expect(colorOf(asOf("QQQ"))).not.toBe("var(--pos)");
    expect(text(asOf("TLT"))).toBe("Sep 18, 2026 close");
    expect(text(asOf("VIX"))).toBe("15m delayed");
    expect(text(asOf("BTC-USD"))).toBe(DASH);
    // Last: the quote, else the stored close in --text-2, else "no quote".
    expect(text(cell("SPY", "Last"))).toBe("$646.31");
    expect(text(cell("EURUSD", "Last"))).toBe("1.0842");
    expect(text(cell("VIX", "Last"))).toBe("15.72");
    expect(text(cell("TLT", "Last"))).toBe("$87.44");
    expect(colorOf(cell("TLT", "Last"))).toBe("var(--text-2)");
    expect(text(cell("BTC-USD", "Last"))).toBe("no quote");
    // Stored 1W / 1M and their dash for symbols without history.
    expect(text(cell("SPY", "1W %"))).toBe("+1.3%");
    expect(text(cell("SPY", "1M %"))).toBe("+2.1%");
    expect(text(cell("TLT", "1W %"))).toBe("-1.1%");
    expect(text(cell("BTC-USD", "1W %"))).toBe(DASH);
    expect(text(cell("EURUSD", "1M %"))).toBe(DASH);
  });

  it("Day % and Day Δ$ come from the feed's own figures and never from arithmetic: a price without a day change prints the dash", () => {
    renderTape();
    expect(text(cell("SPY", "Day %"))).toBe("+0.42%");
    expect(colorOf(cell("SPY", "Day %"))).toBe("var(--pos)");
    expect(text(cell("SPY", "Day Δ$"))).toBe("+2.70");
    expect(text(cell("QQQ", "Day %"))).toBe("-0.35%");
    expect(colorOf(cell("QQQ", "Day %"))).toBe("var(--neg-text)");
    expect(text(cell("QQQ", "Day Δ$"))).toBe("-2.01");
    expect(text(cell("EURUSD", "Day Δ$"))).toBe("+0.0013");
    // IWM has a price and stored bars but the feed sent no day change: the dash, not ret_1d.
    expect(text(cell("IWM", "Day %"))).toBe(DASH);
    expect(text(cell("IWM", "Day Δ$"))).toBe(DASH);
    expect(text(cell("IWM", "Day %"))).not.toContain("-0.35%");
    // TLT has no quote: the stored close's own ret_1d, and no Δ$.
    expect(text(cell("TLT", "Day %"))).toBe("-0.58%");
    expect(text(cell("TLT", "Day Δ$"))).toBe(DASH);
    expect(text(cell("BTC-USD", "Day %"))).toBe(DASH);
  });

  it("the 30-session sparkline renders only with two or more closes, coloured by the last close against the first", () => {
    renderTape();
    const spark = (s: string) => cell(s, "30 Sess");
    const spy = spark("SPY").querySelector("svg");
    expect(spy).not.toBeNull();
    expect(spy?.querySelector("path[stroke]")).not.toBeNull();
    expect(spy?.querySelector("path[stroke]")?.getAttribute("stroke")).toBe("var(--pos)");
    expect(spy?.getAttribute("width")).toBe("48");
    expect(spark("TLT").querySelector("svg path[stroke]")?.getAttribute("stroke")).toBe("var(--neg)");
    expect(spark("GLD").querySelector("svg path")).toBeNull();
    expect(text(spark("GLD"))).toBe(DASH);
    expect(spark("BTC-USD").querySelector("svg path")).toBeNull();
    expect(text(spark("BTC-USD"))).toBe(DASH);
  });

  it("clicking a row's td calls onSelect once and clicking the button also once, never twice", () => {
    const onSelect = vi.fn();
    renderTape({ onSelect });
    fireEvent.click(cell("SPY", "Last"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith("SPY");
    fireEvent.click(rowButton("SPY"));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("SPY");
    fireEvent.click(cell("VIX", "As of"));
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith("VIX");
    // A group row is not a target.
    fireEvent.click(groupRows()[0]);
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("the selected row carries data-selected and its button aria-expanded; a click toggles it through the seam", () => {
    renderTape({ selected: "QQQ" });
    expect(rowOf("QQQ")).toHaveAttribute("data-selected", "true");
    expect(rowButton("QQQ")).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("SPY")).toHaveAttribute("data-selected", "false");
    expect(rowButton("SPY")).toHaveAttribute("aria-expanded", "false");
    expect(table().querySelectorAll("tr[data-selected='true']")).toHaveLength(1);
    fireEvent.click(cell("SPY", "Last"));
    expect(rowOf("SPY")).toHaveAttribute("data-selected", "true");
    expect(rowButton("SPY")).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("QQQ")).toHaveAttribute("data-selected", "false");
    fireEvent.click(rowButton("SPY"));
    expect(table().querySelectorAll("tr[data-selected='true']")).toHaveLength(0);
  });

  it("Single names: #single-names renders under the macro tape with 12 rows in the given order, the five columns, the sort meta and the caption, the macro groups still on screen", () => {
    const singles = singlesOf("NVDA", "AAPL");
    const quotes = new Map(QUOTES);
    quotes.set("NVDA", quote("NVDA", 184.2, { dc: 2.1, dd: 3.79 }));
    quotes.set("AAPL", quote("AAPL", 231.5, { dc: -0.5, dd: -1.16 }));
    renderTape({ singles, quotes, live: false });
    const wrap = singlesWrap();
    expect(wrap).not.toBeNull();
    expect(panel().contains(wrap)).toBe(true);
    // Both lists at once: the macro groups stay, the singles follow.
    expect(groupRows()).toHaveLength(8);
    expect(dataRows()).toHaveLength(MACRO_ROWS);
    expect(singlesRows()).toHaveLength(12);
    expect(singlesRows().map((r) => text(r.querySelector("button")))).toEqual(singles.map((d) => d.symbol));
    expect(singlesHeaders()).toEqual(SINGLES_HEADERS);
    expect(screen.getByRole("table", { name: "Single names: twelve large-cap names sorted by day move" })).toBe(singlesTable());
    expect(text(wrap)).toContain("sorted by day move · re-sorts as data updates");
    expect(text(wrap)).toContain(SINGLES_CAPTION);
    expect(text(singlesCell("NVDA", "Day %"))).toBe("+2.10%");
    expect(text(singlesCell("NVDA", "Day Δ$"))).toBe("+3.79");
    expect(text(singlesCell("MSFT", "Last"))).toBe("no quote");
    expect(text(singlesCell("MSFT", "As of"))).toBe(DASH);
    expect(text(singlesCell("NVDA", "Symbol · name"))).toContain("Nvidia");
  });

  it("Single names: the sort meta reads live with US ticks, and the phone set drops Day Δ$", () => {
    const first = renderTape({ live: true });
    expect(byId("single-names")).not.toBeNull();
    expect(text(byId("single-names"))).toContain("sorted by day move · re-sorts live");
    expect(text(byId("single-names"))).not.toContain("as data updates");
    first.unmount();

    bp.narrow = true;
    renderTape();
    expect(singlesHeaders()).toEqual(SINGLES_NARROW_HEADERS);
    openDetails();
    expect(text(panel())).toContain("Δ$, 1W and the sparkline return above 768px.");
    expect(text(panel())).not.toContain("Name, Δ$");
  });

  it("the caption states the stored-candle window, and drops the through-date without one", () => {
    const dated = renderTape();
    openDetails();
    expect(text(panel())).toContain("1W / 1M and sparklines come from the stored daily candles through Sep 18, 2026;");
    dated.unmount();
    renderTape({ storedThrough: null });
    openDetails();
    expect(text(panel())).toContain("1W / 1M and sparklines come from the stored daily candles;");
    expect(text(panel())).not.toContain("through ");
  });

  it("tapeStatusLine: live, delayed in session, the last close off-hours with crypto ticking, and the stream down; never more than two sentences", () => {
    const usLiveQuotes = new Map<string, LiveQuote>([["SPY", quote("SPY", 646.31, { dc: 0.42, t: LIVE_T, delayed: false, src: "ws" })]]);
    const liveLine = tapeStatusLine({ socketOpen: true, usLive: true, quotes: usLiveQuotes, storedThrough: STORED_THROUGH, sessionOpen: true });
    expect(liveLine).toBe(`Live: US rows tick from the exchange feed, newest at ${fmtEtStamp(LIVE_T)}. 1W, 1M and the sparklines read stored closes through Sep 18, 2026.`);
    const delayedQuotes = new Map<string, LiveQuote>([["QQQ", quote("QQQ", 571.9, { t: DELAYED_T })]]);
    expect(tapeStatusLine({ socketOpen: true, usLive: false, quotes: delayedQuotes, storedThrough: STORED_THROUGH, sessionOpen: true })).toBe(
      `Delayed: the US feed is not ticking, so US rows print their newest quote, ${fmtEtStamp(DELAYED_T)} (15 minutes delayed). 1W, 1M and the sparklines read stored closes through Sep 18, 2026.`,
    );
    const closed = new Map<string, LiveQuote>([
      ["QQQ", quote("QQQ", 571.9, { t: DELAYED_T })],
      ["BTC-USD", quote("BTC-USD", 61_250, { dc: 0.8, t: LIVE_T, delayed: false, src: "ws" })],
    ]);
    expect(tapeStatusLine({ socketOpen: true, usLive: false, quotes: closed, storedThrough: null, sessionOpen: false })).toBe(
      `Showing the last close: US rows hold their final quote from ${fmtEtStamp(DELAYED_T)}, while crypto and FX tick live.`,
    );
    expect(tapeStatusLine({ socketOpen: false, usLive: false, quotes: new Map(), storedThrough: null })).toBe(
      "Showing the last close: the stream is not connected and no stored close is on file yet.",
    );
    for (const line of [liveLine]) expect(line.split(/(?<=\.)\s+(?=[A-Z0-9])/).length).toBeLessThanOrEqual(2);
  });

  it("FeedStatusLine: the stream-down sentence with the socket closed, the four feed words with it open", async () => {
    const down = renderWithProviders(<FeedStatusLine />);
    expect(text(document.body)).toBe("stream unavailable · showing stored closes");
    down.unmount();

    live.status = { socket: "open", feeds: { us: "open", crypto: "open", forex: "open", vix: "rest" }, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: NOW_MS - 1_000, attempts: 0, everOpened: true };
    live.quotes = new Map([["BTC-USD", quote("BTC-USD", 61_250, { dc: 0.8, t: LIVE_T, delayed: false, src: "ws" })]]);
    renderWithProviders(<FeedStatusLine />);
    await waitFor(() => expect(text(document.body)).toContain("CRYPTO"));
    const t = text(document.body);
    expect(t).toContain("US session closed");
    expect(t).toContain("CRYPTO \u25cf live");
    expect(t).toContain("FX quiet");
    expect(t).toContain("VIX 15m delayed");
    expect(t).not.toContain("stream unavailable");
  });
});

describe("useTickFlash (checklist 05 A.6)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
  });

  it("a price change sets up or down for 600 ms per symbol and an unchanged price sets nothing", () => {
    const a = new Map<string, LiveQuote>([
      ["SPY", quote("SPY", 646.31, { src: "ws", t: LIVE_T })],
      ["QQQ", quote("QQQ", 571.9)],
    ]);
    const { result, rerender } = renderHook(({ quotes }: { quotes: ReadonlyMap<string, LiveQuote> }) => useTickFlash(quotes), { initialProps: { quotes: a } });
    expect(result.current.size).toBe(0);

    const b = new Map(a);
    b.set("SPY", quote("SPY", 646.9, { src: "ws", t: LIVE_T + 1_000 }));
    rerender({ quotes: b });
    expect(result.current.get("SPY")).toBe("up");
    expect(result.current.get("QQQ")).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(result.current.get("SPY")).toBe("up");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.get("SPY")).toBeUndefined();

    const c = new Map(b);
    c.set("SPY", quote("SPY", 646.5, { src: "ws", t: LIVE_T + 2_000 }));
    c.set("QQQ", quote("QQQ", 571.9, { t: DELAYED_T + 1 })); // same price, new stamp: no flash
    rerender({ quotes: c });
    expect(result.current.get("SPY")).toBe("down");
    expect(result.current.get("QQQ")).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.size).toBe(0);

    // An identical snapshot flashes nothing.
    rerender({ quotes: new Map(c) });
    expect(result.current.size).toBe(0);
  });

  it("the flash rides the row's inline animation through rowProps and clears after 600 ms", () => {
    const { rerender } = renderTape();
    expect(rowOf("SPY").getAttribute("style") ?? "").not.toMatch(/mrr-flash/);
    const next = new Map(QUOTES);
    next.set("SPY", quote("SPY", 647.05, { dc: 0.53, dd: 3.44, t: LIVE_T + 1_000, delayed: false, src: "ws" }));
    rerender(<Harness quotes={next} />);
    expect(rowOf("SPY").getAttribute("style") ?? "").toMatch(/mrr-flash-up/);
    expect(rowOf("QQQ").getAttribute("style") ?? "").not.toMatch(/mrr-flash/);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(rowOf("SPY").getAttribute("style") ?? "").not.toMatch(/mrr-flash/);
    const lower = new Map(next);
    lower.set("SPY", quote("SPY", 646.8, { dc: 0.49, dd: 3.19, t: LIVE_T + 2_000, delayed: false, src: "ws" }));
    rerender(<Harness quotes={lower} />);
    expect(rowOf("SPY").getAttribute("style") ?? "").toMatch(/mrr-flash-down/);
  });
});
