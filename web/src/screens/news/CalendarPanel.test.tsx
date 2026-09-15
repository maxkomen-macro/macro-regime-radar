/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.1,
 * `screens/news/CalendarPanel.test.tsx`: the Macro calendar panel (B.5)
 * rendered through a small harness that owns the two calendar queries and
 * the view state exactly as the screen does (`useCalendar(30)`,
 * `useCalendarRecent(10, calendarEmpty || view === "recent" ||
 * calendar.isSuccess)`, `usingCalFallback`), so `isLoading` / `isError` are
 * real. Fixtures via stubFetch ("/api/calendar/recent" registered before
 * "/api/calendar": prefix match, first key wins; unmatched paths 404). A
 * fixed epoch `now` (Wednesday Sep 16 2026, 13:00 ET) drives the day
 * markers; stamps are UTC Z stamps rendered as ET wall time.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import CalendarPanel from "./CalendarPanel";
import type { CalendarView } from "./news-types";
import { useCalendar, useCalendarRecent } from "../../api/queries";
import type { CalendarEvent } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Wednesday Sep 16 2026, 13:00 ET (17:00Z). */
const NOW = Date.parse("2026-09-16T17:00:00Z");

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null, source: string | null = "manual_csv"): CalendarEvent => ({
  id,
  event_name,
  event_datetime,
  importance,
  source,
});

/** 12:30Z is 08:30 ET in September; 14:00Z is 10:00 ET; 18:00Z is 14:00 ET. */
const UPCOMING = [
  ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"), // today
  ev(2, "Retail sales (Aug)", "2026-09-16T14:00:00Z", "medium", "bls"), // today, a raw source
  ev(3, "FOMC decision", "2026-09-18T18:00:00Z", "high"), // Fri, +2d
  ev(4, "Jobless claims", "2026-09-24T12:30:00Z", "low"), // Thu, +8d: no marker
  ev(5, "Consumer sentiment (prelim)", "2026-09-25T14:00:00Z", null, null), // Fri, unrated, no source
];
const RECENT = [
  ev(11, "Jobs report (Aug)", "2026-09-04T12:30:00Z", "high"),
  ev(12, "ISM services (Aug)", "2026-09-03T14:00:00Z", "medium"),
  ev(13, "PCE (Jul)", "2026-08-28T12:30:00Z", "low"),
  ev(14, "Trade balance (Jul)", "2026-08-27T12:30:00Z", "medium"),
];
/** Thirteen rows on thirteen days (Sep 17 to Sep 29) for the 12-row cap. */
const THIRTEEN = Array.from({ length: 13 }, (_, i) => ev(100 + i, `Print ${i + 1}`, `2026-09-${String(17 + i).padStart(2, "0")}T12:30:00Z`, i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low"));

type Routes = Record<string, () => unknown>;
let calls: string[] = [];
function stub(routes: Routes) {
  calls = stubFetch(routes).calls;
}
const routes = (over: Partial<Routes> = {}): Routes => ({ "/api/calendar/recent": () => RECENT, "/api/calendar": () => UPCOMING, ...over });

/* ── harness ─────────────────────────────────────────────────────────────── */

function Harness({ initialView = "upcoming" }: { initialView?: CalendarView }) {
  const [view, setView] = useState<CalendarView>(initialView);
  const calendar = useCalendar(30);
  const calendarEmpty = calendar.isSuccess && (calendar.data?.length ?? 0) === 0;
  const recent = useCalendarRecent(10, calendarEmpty || view === "recent" || calendar.isSuccess);
  const usingCalFallback = calendarEmpty && (recent.data?.length ?? 0) > 0;
  return <CalendarPanel calendar={calendar} recent={recent} usingCalFallback={usingCalFallback} view={view} onViewChange={setView} now={NOW} />;
}
function mount(initialView?: CalendarView) {
  return renderWithProviders(
    <main id="main-content">
      <Harness initialView={initialView} />
    </main>,
    { route: "/app/news" },
  );
}

/** Text with `hidden` subtrees removed, whitespace collapsed; sr-only spans stay. */
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
const panel = () => document.getElementById("calendar") as HTMLElement;
const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const groups = () => [...panel().querySelectorAll("tr.mrr-grp")].map((tr) => text(tr));
const dataRows = () => [...panel().querySelectorAll<HTMLTableRowElement>("tbody tr:not(.mrr-grp)")];
const dots = () => [...panel().querySelectorAll<HTMLElement>("[data-importance]")];
const cells = (tr: HTMLTableRowElement) => [...tr.querySelectorAll("td")].map((td) => text(td));
const viewGroup = () => within(panel()).getByRole("group", { name: "Calendar view" });
const viewButton = (name: string) => within(viewGroup()).getByRole("button", { name });
const header = () => panel().querySelector(".mrr-sec-head") as HTMLElement;
const rowOf = (name: string) => {
  const tr = dataRows().find((r) => cells(r).some((c) => c.startsWith(name)));
  if (!tr) throw new Error(`no row named ${name}; rows: ${dataRows().map((r) => cells(r).join(" | ")).join(" || ")}`);
  return tr;
};
const releases = () => screen.queryByRole("heading", { level: 3, name: "Recent releases" });

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("CalendarPanel (checklist 08 B.5)", () => {
  it("renders the section, the h2, the Upcoming view pressed and the next 30 days meta", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    expect(panel().tagName).toBe("SECTION");
    expect(within(panel()).getByRole("heading", { level: 2, name: "Macro calendar" })).toBeInTheDocument();
    expect(viewButton("Upcoming")).toHaveAttribute("aria-pressed", "true");
    expect(viewButton("Recent")).toHaveAttribute("aria-pressed", "false");
    expect(text(header())).toContain("next 30 days");
    expect(text(header())).not.toContain("stored schedule");
    expect(text(header())).not.toContain("last 10 on file");
  });

  it("groups the upcoming rows by ET day under th Time / Impact (sr-only) / Event / Source, with the ET wall time in the first cell", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    const ths = [...panel().querySelectorAll("thead th")];
    expect(ths.map((th) => text(th))).toEqual(["Time", "Impact", "Event", "Source"]);
    expect(ths[1].querySelector(".sr-only")).not.toBeNull();
    expect(groups()).toEqual(["Wed Sep 16 · TODAY", "Fri Sep 18 · +2d", "Thu Sep 24", "Fri Sep 25"]);
    expect(dataRows()).toHaveLength(5);
    // The two same-day rows sit under one group row, in served order.
    const first = panel().querySelector("tr.mrr-grp") as HTMLTableRowElement;
    const after = [] as string[];
    for (let tr = first.nextElementSibling; tr && !tr.classList.contains("mrr-grp"); tr = tr.nextElementSibling) after.push(cells(tr as HTMLTableRowElement)[2]);
    expect(after.map((s) => s.replace(/ (high|medium|low) impact.*$/, ""))).toEqual(["CPI (Aug)", "Retail sales (Aug)"]);
    const cpi = cells(rowOf("CPI (Aug)"));
    expect(cpi[0]).toBe("08:30 ET");
    expect(cpi[0]).not.toContain("12:30");
    expect(cells(rowOf("Retail sales (Aug)"))[0]).toBe("10:00 ET");
    expect(cells(rowOf("FOMC decision"))[0]).toBe("14:00 ET");
  });

  it("the TODAY marker is red and bold, the +Nd marker amber; a day 8 out carries none", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    const [today, soon, later] = [...panel().querySelectorAll<HTMLElement>("tr.mrr-grp")];
    const todayMark = [...today.querySelectorAll("span")].find((s) => text(s).includes("TODAY"));
    expect(todayMark).toBeDefined();
    expect(css(todayMark as Element)).toMatch(/var\(--neg\)/);
    expect(css(todayMark as Element)).toMatch(/font-weight:\s*700/);
    const soonMark = [...soon.querySelectorAll("span")].find((s) => text(s).includes("+2d"));
    expect(soonMark).toBeDefined();
    expect(css(soonMark as Element)).toMatch(/var\(--amber\)/);
    expect(text(later)).toBe("Thu Sep 24");
  });

  it("dots carry data-importance, the impact word as title and in sr-only text, and the amber / cyan / gray colour tokens", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    expect(dots()).toHaveLength(5);
    const high = rowOf("CPI (Aug)").querySelector("[data-importance]") as HTMLElement;
    expect(high).toHaveAttribute("data-importance", "high");
    expect(high).toHaveAttribute("title", "high impact");
    expect(css(high)).toMatch(/var\(--amber\)/);
    expect(text(rowOf("CPI (Aug)").querySelector(".sr-only"))).toBe("high impact");
    const medium = rowOf("Retail sales (Aug)").querySelector("[data-importance]") as HTMLElement;
    expect(medium).toHaveAttribute("data-importance", "medium");
    expect(medium).toHaveAttribute("title", "medium impact");
    expect(css(medium)).toMatch(/var\(--cyan\)/);
    expect(text(rowOf("Retail sales (Aug)").querySelector(".sr-only"))).toBe("medium impact");
    const low = rowOf("Jobless claims").querySelector("[data-importance]") as HTMLElement;
    expect(low).toHaveAttribute("data-importance", "low");
    expect(low).toHaveAttribute("title", "low impact");
    expect(css(low)).toMatch(/var\(--text-4\)/);
    const unrated = rowOf("Consumer sentiment (prelim)").querySelector("[data-importance]") as HTMLElement;
    expect(unrated).toHaveAttribute("title", "impact not rated");
    expect(css(unrated)).toMatch(/var\(--text-4\)/);
    expect(css(unrated)).not.toMatch(/var\(--amber\)|var\(--cyan\)/);
    for (const d of dots()) expect(d).toHaveAttribute("aria-hidden", "true");
  });

  it("the Source column prints hand-maintained for manual_csv, the raw source otherwise, and a dash for null", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    expect(cells(rowOf("CPI (Aug)"))[3]).toBe("hand-maintained");
    expect(cells(rowOf("Retail sales (Aug)"))[3]).toBe("bls");
    const none = cells(rowOf("Consumer sentiment (prelim)"))[3];
    expect(none).not.toBe("");
    expect(none).not.toMatch(/[a-z]/i);
  });

  it("the legend names Impact, High, Medium, Low and ET with the three dot colours", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    const legend = panel().querySelector(".mrr-cal-legend") as HTMLElement;
    expect(legend).not.toBeNull();
    expect(text(legend)).toMatch(/^Impact High Medium Low ET$/);
    const swatches = legend.getAttribute("style") + [...legend.querySelectorAll("*")].map((e) => e.getAttribute("style") ?? "").join(" ");
    expect(swatches).toMatch(/var\(--amber\)/);
    expect(swatches).toMatch(/var\(--cyan\)/);
    // jsdom serialises the hex literal as rgb(); either spelling is the same gray.
    expect(swatches).toMatch(/#6f7d8a|rgb\(111,\s*125,\s*138\)/);
  });

  it("clicking Recent requests /api/calendar/recent?limit=10, reads last 10 on file, groups every row as elapsed on the quiet rung; Upcoming restores", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    fireEvent.click(viewButton("Recent"));
    expect(viewButton("Recent")).toHaveAttribute("aria-pressed", "true");
    expect(viewButton("Upcoming")).toHaveAttribute("aria-pressed", "false");
    await screen.findByText("Jobs report (Aug)");
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/calendar/recent?limit=10"))).toBe(true));
    expect(text(header())).toContain("last 10 on file");
    expect(text(header())).not.toContain("next 30 days");
    expect(groups()).toEqual(["Fri Sep 04 · elapsed", "Thu Sep 03 · elapsed", "Fri Aug 28 · elapsed", "Thu Aug 27 · elapsed"]);
    for (const g of [...panel().querySelectorAll<HTMLElement>("tr.mrr-grp")]) {
      const mark = [...g.querySelectorAll("span")].find((s) => text(s).includes("elapsed"));
      expect(mark).toBeDefined();
      expect(css(mark as Element)).toMatch(/var\(--text-4\)/);
    }
    expect(dataRows()).toHaveLength(4);
    expect(dots()).toHaveLength(4);
    for (const d of dots()) {
      expect(css(d)).toMatch(/var\(--text-4\)/);
      expect(css(d)).not.toMatch(/var\(--amber\)|var\(--cyan\)/);
    }
    for (const tr of dataRows()) expect(text(tr.querySelector(".sr-only"))).toMatch(/impact, elapsed$/);
    expect(text(rowOf("Jobs report (Aug)").querySelector(".sr-only"))).toBe("high impact, elapsed");
    expect(screen.queryByText("CPI (Aug)")).toBeNull();
    expect(releases()).toBeNull();
    // No cap in the recent view: the hook serves ten.
    expect(within(panel()).queryByRole("button", { name: /Show all/ })).toBeNull();

    fireEvent.click(viewButton("Upcoming"));
    await screen.findByText("CPI (Aug)");
    expect(viewButton("Upcoming")).toHaveAttribute("aria-pressed", "true");
    expect(groups()[0]).toBe("Wed Sep 16 · TODAY");
    expect(css(rowOf("CPI (Aug)").querySelector("[data-importance]"))).toMatch(/var\(--amber\)/);
    expect(text(header())).toContain("next 30 days");
  });

  it("an empty window with stored recent rows shows the stored-schedule callout, the split meta and elapsed rows, without the Recent releases block", async () => {
    stub(routes({ "/api/calendar": () => [] }));
    mount();
    await screen.findByText("Jobs report (Aug)");
    expect(text(panel())).toContain("Stored schedule. No upcoming events in the stored window; the calendar snapshot ends Sep 04, 2026; showing the most recent 4 scheduled events instead.");
    expect(text(header())).toContain("next 30 days");
    expect(text(header())).toContain("stored schedule");
    // Each meta word in its own span (the harvested eyebrow survives the fallback).
    const spans = [...header().querySelectorAll("span")].map((s) => text(s));
    expect(spans).toContain("next 30 days");
    expect(spans).toContain("stored schedule");
    expect(groups().every((g) => g.endsWith("· elapsed"))).toBe(true);
    expect(dataRows()).toHaveLength(4);
    for (const d of dots()) expect(css(d)).toMatch(/var\(--text-4\)/);
    expect(viewButton("Upcoming")).toHaveAttribute("aria-pressed", "true");
    expect(releases()).toBeNull();
    expect(text(panel())).not.toContain("No events on file.");
  });

  it("both empty renders No events on file.", async () => {
    stub(routes({ "/api/calendar/recent": () => [], "/api/calendar": () => [] }));
    mount();
    expect(await within(panel()).findByText("No events on file.")).toBeInTheDocument();
    expect(dots()).toHaveLength(0);
    expect(text(panel())).not.toContain("elapsed");
    expect(text(panel())).not.toContain("Stored schedule.");
    expect(releases()).toBeNull();
  });

  it("a calendar 404 renders the StateNote error and never the fallback rows", async () => {
    stub({ "/api/calendar/recent": () => RECENT });
    mount();
    expect(await within(panel()).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(screen.queryByText("Jobs report (Aug)")).toBeNull();
    expect(dots()).toHaveLength(0);
  });

  it("loading renders the StateNote before any payload", () => {
    stub(routes({ "/api/calendar": () => new Promise(() => {}) }));
    mount();
    expect(within(panel()).getByText("Reading stored data…")).toBeInTheDocument();
    expect(dots()).toHaveLength(0);
  });

  it("caps the upcoming view at 12 rows behind Show all {n} events, and reveals the rest on click", async () => {
    stub(routes({ "/api/calendar": () => THIRTEEN }));
    mount();
    await screen.findByText("Print 1");
    expect(dataRows()).toHaveLength(12);
    expect(screen.queryByText("Print 13")).toBeNull();
    const button = within(panel()).getByRole("button", { name: "Show all 13 events" });
    expect(button).toHaveClass("mrr-btn");
    fireEvent.click(button);
    expect(dataRows()).toHaveLength(13);
    expect(screen.getByText("Print 13")).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /Show all/ })).toBeNull();
    // Twelve or fewer rows never show the button.
    expect(groups()).toHaveLength(13);
  });

  it("the Recent releases block lists the three most recent stored events under an h3 in the upcoming view", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    await waitFor(() => expect(releases()).not.toBeNull());
    const heading = releases() as HTMLElement;
    const block = heading.parentElement as HTMLElement;
    expect(text(block)).toContain("most recent 3");
    expect(text(block)).toContain("Jobs report (Aug)");
    expect(text(block)).toContain("ISM services (Aug)");
    expect(text(block)).toContain("PCE (Jul)");
    expect(text(block)).not.toContain("Trade balance (Jul)");
    expect(text(block)).toContain("Sep 04");
    expect(text(block)).toContain("Aug 28");
    // Nothing invents actuals or consensus (F1).
    expect(text(panel())).not.toMatch(/Actual|Cons\.|Beat|Miss/);
    expect(calls.some((c) => c.startsWith("/api/calendar/recent?limit=10"))).toBe(true);
  });

  it("prints the N25 caption", async () => {
    stub(routes());
    mount();
    await screen.findByText("CPI (Aug)");
    expect(text(panel())).toContain("FOMC meetings, CPI, jobs and GDP prints from the hand-maintained schedule; high-priority rows are the ones that can move the regime call.");
  });
});
