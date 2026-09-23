import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, stubFetch } from "../../test/utils";
import { freshLabel, stampLabel } from "../shared/fresh-state";
import StatusBadge, { badgeWords } from "./StatusBadge";

const series = (id: string, state: string, as_of: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  kind: "fred",
  cadence: "daily",
  as_of,
  state,
  delay_min: null,
  cycles_behind: 0,
  stale: state === "stale",
  discontinued: false,
  reason: `${id} reason.`,
  ...extra,
});

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe("badgeWords", () => {
  it("keeps Live as the wiring word and carries the server's stamp and tail", () => {
    const stale = freshLabel(series("DGS10", "stale", "2026-09-04", { cycles_behind: 8 }) as never);
    expect(badgeWords(stale, false)).toEqual({ word: "Live", stamp: "Sep 04 · 8 days behind", muted: null });
    const close = freshLabel(series("DGS10", "close", "2026-09-17", { cycles_behind: 1 }) as never);
    expect(badgeWords(close, false)).toEqual({ word: "Live", stamp: "Sep 17", muted: "· 1 day behind" });
    expect(badgeWords(freshLabel(undefined), false).stamp).toBe("unknown");
    expect(badgeWords(stampLabel("Sep 21, 17:51 ET", ""), false, null, true)).toEqual({ word: "Live", stamp: "Sep 21, 17:51 ET", muted: null });
  });
  it("a dated feed with no stamp yet reads 'as of unknown', never 'as of As of unknown' (desk/integration)", () => {
    expect(badgeWords(stampLabel(null, "awaiting the first full refresh"), false, null, true)).toEqual({ word: "Live", stamp: "unknown", muted: null });
    stubFetch({ "/api/freshness": () => ({ regimes_date: null, signals_date: null, market_daily_date: null, market_intraday_ts: null, news_published_at: null, raw_series_date: null, series: [] }) });
    renderWithProviders(<StatusBadge source={{ label: "event-study engine", asOf: null, reason: "awaiting the first full refresh" }} />);
    const text = screen.getByTestId("desk-badge").textContent ?? "";
    expect(text).toMatch(/as of unknown/);
    expect(text).not.toMatch(/As of unknown/);
  });
  it("a seeded snapshot reads Snapshot, never Live", () => {
    const seeded = { word: "Snapshot · as of Sep 18", muted: null, tone: "unknown" as const, reason: "", stale: false };
    expect(badgeWords(seeded, true)).toEqual({ word: "Snapshot", stamp: "Sep 18", muted: null });
  });
});

describe("StatusBadge", () => {
  it("prints the source and the server's as-of, never a hand-typed date", async () => {
    stubFetch({ "/api/freshness": () => ({ regimes_date: null, signals_date: null, market_daily_date: null, market_intraday_ts: null, news_published_at: null, raw_series_date: null, series: [series("DGS10", "close", "2026-09-18")] }) });
    renderWithProviders(<StatusBadge source={{ label: "FRED", ids: ["DGS10"] }} />, { route: "/desk/today" });
    const badge = await screen.findByTestId("desk-badge");
    await screen.findByText("as of Sep 18");
    expect(badge).toHaveAttribute("data-state", "live");
    expect(badge.textContent).toMatch(/Live·FRED·as of Sep 18/);
    expect(badge.getAttribute("title")).toMatch(/DGS10 reason\./);
  });
  it("a dated feed takes its own verdict's tone, grey without one", () => {
    stubFetch({ "/api/freshness": () => ({ regimes_date: null, signals_date: null, market_daily_date: null, market_intraday_ts: null, news_published_at: null, raw_series_date: null, series: [] }) });
    const { unmount } = renderWithProviders(<StatusBadge source={{ label: "pipeline", asOf: "Sep 21, 18:31 ET", verdict: "stale" }} />);
    expect(screen.getByTestId("desk-badge")).toHaveAttribute("data-tone", "stale");
    expect(screen.getByTestId("desk-badge").textContent).toMatch(/as of Sep 21, 18:31 ET/);
    unmount();
    renderWithProviders(<StatusBadge source={{ label: "pipeline", asOf: "Sep 21, 18:31 ET" }} />);
    expect(screen.getByTestId("desk-badge")).toHaveAttribute("data-tone", "unknown");
  });
  it("declares Designed for a panel with no source", () => {
    renderWithProviders(<StatusBadge designed />);
    const badge = screen.getByTestId("desk-badge");
    expect(badge).toHaveTextContent("Designed");
    expect(badge).toHaveAttribute("data-state", "designed");
  });
});
