/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) B.7 and
 * E.1, `screens/dashboard/MacroCalendarCard.test.tsx`: the macro calendar
 * card. The first three rows of `/api/calendar` (30-day window) with the date
 * and time cells from `fmtUtcStampEt` (a Z stamp renders the ET wall time,
 * never the UTC digits), the amber / cyan / gray importance dot with its
 * sr-only word, the stored-schedule fallback to `/api/calendar/recent` when
 * the window is empty, "No events on file." when both are empty, and the
 * StateNote on error. Rendered prop-less: the card owns its two hooks;
 * fixtures via stubFetch, unmatched paths 404.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import MacroCalendarCard from "./MacroCalendarCard";
import type { CalendarEvent } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null): CalendarEvent => ({
  id,
  event_name,
  event_datetime,
  importance,
  source: "hand-maintained",
});

/** Four upcoming rows (the card shows three); Z stamps are UTC. 12:30 UTC is 08:30 ET in September. */
const UPCOMING = [
  ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"),
  ev(2, "FOMC decision", "2026-09-17T18:00:00Z", "medium"),
  ev(3, "Jobless claims", "2026-09-18T12:30:00Z", "low"),
  ev(4, "GDP (Q2, third estimate)", "2026-09-25T12:30:00Z", "high"),
];
const RECENT = [
  ev(11, "Jobs report (Aug)", "2026-09-04T12:30:00Z", "high"),
  ev(12, "ISM services (Aug)", "2026-09-03T14:00:00Z", "medium"),
  ev(13, "PCE (Jul)", "2026-08-28T12:30:00Z", "low"),
];

let calls: string[];

function stub(routes: Record<string, () => unknown>) {
  // "/api/calendar/recent" must precede "/api/calendar": stubFetch matches by prefix, first key wins.
  calls = stubFetch(routes).calls;
}

/** Text with `hidden` subtrees removed, whitespace collapsed; sr-only spans stay (CSS-hidden, not `hidden`). */
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

function card(): HTMLElement {
  return (document.getElementById("macro-calendar") ?? document.body) as HTMLElement;
}

/** The row an importance dot belongs to (the grid row holding date, time, dot and name). */
function rowOf(dot: Element): HTMLElement {
  let el: HTMLElement | null = dot as HTMLElement;
  while (el && !/\d{2}:\d{2} ET/.test(text(el))) el = el.parentElement;
  return (el ?? dot.parentElement) as HTMLElement;
}

beforeEach(() => {
  stub({ "/api/calendar/recent": () => RECENT, "/api/calendar": () => UPCOMING });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MacroCalendarCard (checklist 03 B.7)", () => {
  it("renders the first three upcoming rows with the header, provenance line and the News link", async () => {
    renderWithProviders(<MacroCalendarCard />);
    expect(await screen.findByText("CPI (Aug)")).toBeInTheDocument();
    expect(screen.getByText("FOMC decision")).toBeInTheDocument();
    expect(screen.getByText("Jobless claims")).toBeInTheDocument();
    expect(screen.queryByText("GDP (Q2, third estimate)")).toBeNull();
    expect(screen.getByRole("heading", { name: /^Macro calendar$/i })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View calendar/ });
    expect(link).toHaveAttribute("href", "/app/news#calendar");
    expect(text(card())).toContain("Hand-maintained schedule · FOMC, CPI, jobs and GDP prints");
    // The window had rows, so the stored-schedule fallback is never requested.
    expect(calls.some((c) => c.startsWith("/api/calendar/recent"))).toBe(false);
    expect(calls.some((c) => c.startsWith("/api/calendar?"))).toBe(true);
    expect(text(card())).not.toContain("Stored schedule");
    expect(text(card())).not.toContain("elapsed");
  });

  it("time cell from fmtUtcStampEt: a Z stamp renders the ET wall time, never the UTC digits", async () => {
    stub({
      "/api/calendar/recent": () => [],
      "/api/calendar": () => [ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"), ev(2, "FOMC decision", "2026-09-17 18:00:00", "medium")],
    });
    renderWithProviders(<MacroCalendarCard />);
    const cpi = rowOf(await screen.findByText("CPI (Aug)"));
    expect(text(cpi)).toMatch(/Sep 16/i);
    expect(text(cpi)).toContain("08:30 ET");
    expect(text(cpi)).not.toContain("12:30");
    // A zone-less server stamp is UTC too: 18:00 UTC is 14:00 ET.
    const fomc = rowOf(screen.getByText("FOMC decision"));
    expect(text(fomc)).toMatch(/Sep 17/i);
    expect(text(fomc)).toContain("14:00 ET");
    expect(text(fomc)).not.toContain("18:00");
  });

  it("dot colour token by importance (high amber, medium cyan, low and null gray) and the sr-only word", async () => {
    const { unmount } = renderWithProviders(<MacroCalendarCard />);
    await screen.findByText("CPI (Aug)");
    const dots = [...card().querySelectorAll<HTMLElement>("[data-importance]")];
    expect(dots).toHaveLength(3);
    const style = (el: HTMLElement) => el.getAttribute("style") ?? "";
    const [high, medium, low] = dots;
    expect(high).toHaveAttribute("data-importance", "high");
    expect(style(high)).toMatch(/var\(--amber\)/);
    expect(medium).toHaveAttribute("data-importance", "medium");
    expect(style(medium)).toMatch(/var\(--cyan\)/);
    expect(low).toHaveAttribute("data-importance", "low");
    expect(style(low)).toMatch(/var\(--text-4\)/);
    // The word rides with the dot (title) and in the row's accessible text (sr-only), never colour alone.
    expect(high).toHaveAttribute("title", "high impact");
    expect(medium).toHaveAttribute("title", "medium impact");
    expect(low).toHaveAttribute("title", "low impact");
    expect(text(rowOf(high))).toMatch(/high impact/i);
    expect(text(rowOf(medium))).toMatch(/medium impact/i);
    expect(text(rowOf(low))).toMatch(/low impact/i);
    expect(within(card()).getAllByText(/impact/i).some((el) => el.classList.contains("sr-only"))).toBe(true);
    unmount();

    // A null importance takes the gray token.
    stub({ "/api/calendar/recent": () => [], "/api/calendar": () => [ev(9, "Consumer sentiment (prelim)", "2026-09-18T14:00:00Z", null)] });
    renderWithProviders(<MacroCalendarCard />);
    await screen.findByText("Consumer sentiment (prelim)");
    const only = card().querySelector<HTMLElement>("[data-importance]") as HTMLElement;
    expect(only).not.toBeNull();
    expect(style(only)).toMatch(/var\(--text-4\)/);
    expect(style(only)).not.toMatch(/var\(--amber\)|var\(--cyan\)/);
  });

  it("an empty window falls back to /api/calendar/recent with elapsed rows and the stored-schedule caption", async () => {
    stub({ "/api/calendar/recent": () => RECENT, "/api/calendar": () => [] });
    renderWithProviders(<MacroCalendarCard />);
    expect(await screen.findByText("Jobs report (Aug)")).toBeInTheDocument();
    expect(screen.getByText("ISM services (Aug)")).toBeInTheDocument();
    expect(screen.getByText("PCE (Jul)")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/calendar/recent?limit=3"))).toBe(true));
    expect(text(card())).toContain("Stored schedule: no events in the next 30 days; showing the most recent scheduled events.");
    expect(within(card()).getAllByText(/elapsed/)).toHaveLength(3);
    expect(text(rowOf(screen.getByText("Jobs report (Aug)")))).toMatch(/Sep 04.*elapsed/is);
    expect(text(card())).not.toContain("No events on file.");
    expect(text(card())).toContain("Hand-maintained schedule · FOMC, CPI, jobs and GDP prints");
  });

  it("both empty renders No events on file.", async () => {
    stub({ "/api/calendar/recent": () => [], "/api/calendar": () => [] });
    renderWithProviders(<MacroCalendarCard />);
    expect(await screen.findByText("No events on file; the calendar is a hand-maintained schedule refreshed with the daily run.")).toBeInTheDocument();
    expect(card().querySelectorAll("[data-importance]")).toHaveLength(0);
    expect(text(card())).not.toContain("elapsed");
  });

  it("error renders the StateNote and never the fallback", async () => {
    stub({ "/api/calendar/recent": () => RECENT, "/api/calendar": () => ({ status: 503, body: { detail: "down" } }) });
    renderWithProviders(<MacroCalendarCard />);
    expect(await screen.findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(screen.queryByText("Jobs report (Aug)")).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/calendar/recent"))).toBe(false);
    expect(card().querySelectorAll("[data-importance]")).toHaveLength(0);
  });
});
