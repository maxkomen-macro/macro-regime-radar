/**
 * fix/freshness 8: the strip is four quote cards of one width, SPY and QQQ over US 10Y and US 30Y; the status card
 * left it for the sidebar's "● Data status". The 30Y is the credit payload's own field: an older API omits it and
 * the card is hidden rather than dashed; a payload that serves it as null dashes with its reason.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import TickerLive from "./TickerLive";
import { renderWithProviders, stubFetch } from "../../test/utils";

vi.mock("../../live/quotes", () => ({
  LIVE_WINDOW_MS: 120_000,
  useQuotes: () => new Map(),
  useQuote: () => undefined,
  useStreamStatus: () => ({ socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false }),
}));
/** app.css as written (Vite's CSS handling empties a ?raw import under vitest): read from disk, as pipeline-ddl.test.ts does. */
async function appCss(): Promise<string> {
  const fs = (await import("node:fs" as string)) as { readFileSync(path: string, enc: string): string };
  const path = (await import("node:path" as string)) as { resolve(...parts: string[]): string };
  const proc = (await import("node:process" as string)) as { cwd(): string };
  return fs.readFileSync(path.resolve(proc.cwd(), "src", "styles", "app.css"), "utf8");
}

const TEN = { series_id: "DGS10", label: "UST10Y", date: "2026-09-28", value_pct: 5.24, value_bps: 524, change_bps: 28, change_basis: "1w", change_from: "2026-09-21", change_1w_bps: 28, history_basis: "daily", history: [{ date: "2026-09-21", value: 4.96 }, { date: "2026-09-28", value: 5.24 }] };
const THIRTY = { series_id: "DGS30", label: "UST30Y", date: "2026-09-28", value_pct: 5.56, value_bps: 556, change_bps: 27, change_basis: "1w", change_from: "2026-09-21", change_1w_bps: 27, history_basis: "daily", history: [{ date: "2026-09-21", value: 5.29 }, { date: "2026-09-28", value: 5.56 }] };
const DGS30_STATE = { id: "DGS30", label: "30Y Treasury", kind: "fred", cadence: "daily", as_of: "2026-09-28", state: "close", delay_min: null, cycles_behind: 2, stale: false, discontinued: false, reason: "30Y Treasury observed 2026-09-28; 2 business day(s) behind the 2026-09-30 print." };

function serve(credit: unknown) {
  stubFetch({
    "/api/market/intraday": () => [],
    "/api/market/daily": () => [],
    "/api/freshness": () => ({ status: 503, body: { detail: "not in this test" } }),
    "/api/credit/oas": () => credit,
  });
}

const strip = () => screen.getByRole("region", { name: "Market strip" });
const cards = () => [...strip().querySelectorAll(".mrr-quote")];

afterEach(() => vi.restoreAllMocks());

describe("the strip (fix/freshness 8)", () => {
  it("is SPY and QQQ, then US 10Y and US 30Y: four quote cards and nothing else", async () => {
    serve({ as_of: "2026-09-29", series: [TEN], ust30y: THIRTY, freshness: { DGS30: DGS30_STATE } });
    renderWithProviders(<TickerLive />);
    await waitFor(() => expect(strip().textContent).toContain("5.56%"));
    expect(strip().children).toHaveLength(4);
    expect(cards()).toHaveLength(4);
    cards().forEach((c, i) => expect(c.textContent).toMatch(new RegExp(`^${["SPY", "QQQ", "US 10Y", "US 30Y"][i]}`)));
    expect(strip().querySelector("button")).toBeNull();
  });

  it("the 30Y card reads like the 10Y: level, true 1W change in bp with both dates in its title, sparkline, FRED stamp", async () => {
    serve({ as_of: "2026-09-29", series: [TEN], ust30y: THIRTY, freshness: { DGS30: DGS30_STATE } });
    renderWithProviders(<TickerLive />);
    await waitFor(() => expect(strip().textContent).toContain("5.56%"));
    const card = cards()[3];
    expect(card.textContent).toContain("+27 bps");
    expect(card.textContent).toContain("1W");
    const tagTitle = [...card.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).find((t) => t?.includes("2026-09-21") || t?.includes("Sep 21"));
    expect(tagTitle, "the 1W tag's title names both dates").toMatch(/Sep 21|2026-09-21/);
    expect(tagTitle).toMatch(/Sep 28|2026-09-28/);
    expect(card.querySelector("svg")).not.toBeNull();
    expect(card.querySelector("[data-stamp]")?.textContent).toBe("FRED · Sep 28 · 2 days behind");
    expect(card.getAttribute("title") ?? card.querySelector("[title*='30-year']")?.getAttribute("title")).toMatch(/30-year Treasury yield · FRED DGS30/);
  });

  it("against an older API (no ust30y field) the 30Y card is hidden, not dashed", async () => {
    serve({ as_of: "2026-09-29", series: [TEN] });
    renderWithProviders(<TickerLive />);
    await waitFor(() => expect(strip().textContent).toContain("5.24%"));
    expect(cards()).toHaveLength(3);
    expect(strip().textContent).not.toContain("US 30Y");
  });

  it("a served null (no eligible DGS30 stored) dashes with its reason", async () => {
    serve({ as_of: "2026-09-29", series: [TEN], ust30y: null });
    renderWithProviders(<TickerLive />);
    await waitFor(() => expect(strip().textContent).toContain("5.24%"));
    expect(cards()).toHaveLength(4);
    const card = cards()[3];
    expect(card.textContent).toMatch(/^US 30Y—/);
    expect(card.outerHTML).toContain("no eligible FRED DGS30 observation is stored yet");
  });

  it("the layout: four across on a wide desk, two by two below 1620 px, one per row on a phone", async () => {
    const css = (await appCss()).replace(/\s+/g, " ");
    expect(css).toMatch(/\.mrr-strip \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width: 1619\.98px\) \{ \.mrr-strip \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    expect(css).toMatch(/\.mrr-strip \{ grid-template-columns: minmax\(0, 1fr\); gap: 8px; \}/);
    expect(css).not.toMatch(/\.mrr-upd\b/);
  });
});
