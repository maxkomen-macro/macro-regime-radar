/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.1,
 * `screens/news/EventTimeline.test.tsx`: the 18-day inline-SVG event timeline
 * in the hero chart slot (B.1). Rendered bare (no providers: the component is
 * pure), with a fixed epoch `now` on a known Wednesday (Sep 16 2026, 13:00
 * ET) so the weekend columns, the day labels and the day deltas are
 * deterministic wherever the suite runs. Geometry from B.1: 18 day columns of
 * 22.6 px from x 8 to 392, weekend rects from y 30 to 246, the NOW rail
 * rect, dots at cy 96 / 150 / 190 by importance. jsdom renders SVG as DOM,
 * so attributes are read directly; nothing is mocked.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import EventTimeline from "./EventTimeline";
import type { CalendarEvent } from "../../api/types";
import { weekdayEt } from "../shared/calendar-impact";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Wednesday Sep 16 2026, 13:00 ET (17:00Z). */
const NOW = Date.parse("2026-09-16T17:00:00Z");
/** 08:30 ET on day 0 (12:30Z in EDT; the 18-day window ends Oct 3, still EDT). */
const DAY0_0830 = Date.parse("2026-09-16T12:30:00Z");
const X0 = 8;
/** 18 columns from x 8 to 392: 384 / 17, the "22.6 px" of B.1 to one decimal. */
const STEP = (392 - X0) / 17;
const xOf = (day: number) => X0 + day * STEP;

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null): CalendarEvent => ({
  id,
  event_name,
  event_datetime,
  importance,
  source: "manual_csv",
});
/** An event `day` ET days after NOW at 08:30 ET. */
const onDay = (id: number, event_name: string, day: number, importance: string | null): CalendarEvent =>
  ev(id, event_name, new Date(DAY0_0830 + day * 86_400_000).toISOString().replace(".000Z", "Z"), importance);

const HIGH_D2 = onDay(1, "CPI (Aug)", 2, "high");
const MEDIUM_D5 = onDay(2, "ISM services (Aug)", 5, "medium");
const LOW_D9 = onDay(3, "Jobless claims", 9, "low");
const HIGH_D12 = onDay(4, "FOMC decision", 12, "high");
const BEYOND_D19 = onDay(5, "GDP (Q2, third estimate)", 19, "high");
const BEYOND_D22 = onDay(6, "GDP (Q2, third estimate)", 22, "high");

/* ── helpers ─────────────────────────────────────────────────────────────── */

function mount(events: CalendarEvent[], fallbackEnd?: string): SVGSVGElement {
  const { container } = render(<EventTimeline events={events} now={NOW} fallbackEnd={fallbackEnd} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("EventTimeline rendered no <svg>");
  return svg;
}
const num = (el: Element, attr: string) => parseFloat(el.getAttribute(attr) ?? "NaN");
const content = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const texts = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")];
const textNamed = (svg: SVGSVGElement, s: string | RegExp) => texts(svg).find((t) => (typeof s === "string" ? content(t) === s : s.test(content(t))));
const circles = (svg: SVGSVGElement) => [...svg.querySelectorAll("circle")];
/** Vertical <line> elements (x1 === x2): the day ticks; stems are excluded by rendering no event inside the window. */
const verticalLines = (svg: SVGSVGElement) => [...svg.querySelectorAll("line")].filter((l) => Math.abs(num(l, "x1") - num(l, "x2")) < 0.01);
const weekendRects = (svg: SVGSVGElement) => [...svg.querySelectorAll("rect")].filter((r) => /rgba\(255,\s*255,\s*255,\s*0?\.025\)/.test(r.getAttribute("fill") ?? ""));
const anchorOf = (el: Element) => el.getAttribute("text-anchor") ?? "start";
/** A day-axis label: "{Mon} {D}" (month and day) on day 0, a bare day number elsewhere. */
const DAY_LABEL = /^(?:[A-Z][a-z]{2} )?\d{1,2}$/i;
const circleAt = (svg: SVGSVGElement, day: number) => {
  const c = circles(svg).find((el) => Math.abs(num(el, "cx") - xOf(day)) < 0.25);
  if (!c) throw new Error(`no circle at day ${day} (x ${xOf(day)}); cx values: ${circles(svg).map((el) => el.getAttribute("cx")).join(", ")}`);
  return c;
};

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("EventTimeline (checklist 08 B.1)", () => {
  it("draws 18 day ticks from x 8 to 392 in 22.6 px columns, the title line and the viewBox", () => {
    const svg = mount([BEYOND_D22]);
    expect(svg).toHaveAttribute("viewBox", "0 0 400 290");
    const xs = verticalLines(svg)
      .map((l) => num(l, "x1"))
      .sort((a, b) => a - b);
    expect(xs).toHaveLength(18);
    expect(xs[0]).toBeCloseTo(X0, 1);
    expect(xs[17]).toBeCloseTo(392, 0);
    // Positions print to one decimal, so consecutive diffs read 22.5 or 22.6.
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1] - 22.6)).toBeLessThan(0.15);
    expect(content(svg)).toContain("NEXT 18 DAYS · STEM HEIGHT = IMPACT");
  });

  it("labels day 0 as the month and day, then every fourth day as the day number, and the last day anchored end (the mockup's Sep 9 · 13 · 17 · 21 · 26 pattern)", () => {
    const svg = mount([BEYOND_D22]);
    const day0 = textNamed(svg, /^sep 16$/i);
    expect(day0, "day 0 label").toBeDefined();
    expect(anchorOf(day0 as Element)).toBe("start");
    expect(day0?.getAttribute("fill")).toBe("#dfe6ec");
    expect(num(day0 as Element, "x")).toBeCloseTo(xOf(0), 1);
    // Days 4, 8, 12 (Sep 20, 24, 28) as bare numbers; day 17 (Oct 3) closes the axis anchored end.
    for (const [day, label] of [
      [4, "20"],
      [8, "24"],
      [12, "28"],
      [17, "3"],
    ] as const) {
      const t = texts(svg).find((el) => content(el).replace(/^0+(?=\d)/, "") === label && Math.abs(num(el, "x") - xOf(day)) < 0.5);
      expect(t, `day ${day} label ${label}`).toBeDefined();
      expect(t?.getAttribute("fill")).toBe("#7d8b98");
    }
    const dayLabels = texts(svg).filter((t) => DAY_LABEL.test(content(t)));
    expect(dayLabels.length).toBeGreaterThanOrEqual(5);
    expect(dayLabels.length).toBeLessThanOrEqual(6);
    const rightmost = dayLabels.reduce((a, b) => (num(b, "x") > num(a, "x") ? b : a));
    expect(num(rightmost, "x")).toBeCloseTo(xOf(17), 1);
    expect(anchorOf(rightmost)).toBe("end");
    // No event name is mistaken for a day label and vice versa.
    expect(textNamed(svg, "GDP (Q2, third estimate)")).toBeUndefined();
  });

  it("shades the weekend columns for a Wednesday start: one rect per Saturday and Sunday inside the 18 days, y 30 to 246, each over its tick", () => {
    const svg = mount([BEYOND_D22]);
    const days = Array.from({ length: 18 }, (_, i) => i);
    const weekendDays = days.filter((d) => /^(Sat|Sun)$/.test(weekdayEt(DAY0_0830 + d * 86_400_000)));
    // Sat 19, Sun 20, Sat 26, Sun 27 and Sat Oct 3 (day 17).
    expect(weekendDays).toEqual([3, 4, 10, 11, 17]);
    const rects = weekendRects(svg).sort((a, b) => num(a, "x") - num(b, "x"));
    expect(rects).toHaveLength(weekendDays.length);
    rects.forEach((r, i) => {
      expect(num(r, "y")).toBeCloseTo(30, 1);
      expect(num(r, "height")).toBeCloseTo(216, 1);
      const x = num(r, "x");
      const w = num(r, "width");
      const tick = xOf(weekendDays[i]);
      expect(x, `rect ${i} starts at or before its tick`).toBeLessThanOrEqual(tick + 0.05);
      expect(x + w, `rect ${i} ends at or after its tick`).toBeGreaterThanOrEqual(tick - 0.05);
    });
  });

  it("draws the NOW rail rect and its label", () => {
    const svg = mount([BEYOND_D22]);
    const rail = [...svg.querySelectorAll("rect")].find((r) => r.getAttribute("fill") === "var(--mint)");
    expect(rail, "NOW rail").toBeDefined();
    expect(num(rail as Element, "x")).toBeCloseTo(6, 1);
    expect(num(rail as Element, "y")).toBeCloseTo(30, 1);
    expect(num(rail as Element, "width")).toBeCloseTo(3, 1);
    expect(num(rail as Element, "height")).toBeCloseTo(216, 1);
    expect(num(rail as Element, "rx")).toBeCloseTo(1.5, 1);
    const now = textNamed(svg, "NOW");
    expect(now, "NOW label").toBeDefined();
    expect(num(now as Element, "x")).toBeCloseTo(16, 1);
    expect(num(now as Element, "y")).toBeCloseTo(40, 1);
  });

  it("draws one circle per event inside the 18 days at cy 96 / 150 / 190 with the amber / cyan / gray fill and r 5 / 4 / 4 by importance; a day-19 event is not drawn", () => {
    const svg = mount([HIGH_D2, MEDIUM_D5, LOW_D9, BEYOND_D19]);
    expect(circles(svg)).toHaveLength(3);
    const high = circleAt(svg, 2);
    expect(num(high, "cy")).toBeCloseTo(96, 1);
    expect(num(high, "r")).toBeCloseTo(5, 1);
    expect(high.getAttribute("fill")).toBe("var(--amber)");
    const medium = circleAt(svg, 5);
    expect(num(medium, "cy")).toBeCloseTo(150, 1);
    expect(num(medium, "r")).toBeCloseTo(4, 1);
    expect(medium.getAttribute("fill")).toBe("var(--cyan)");
    const low = circleAt(svg, 9);
    expect(num(low, "cy")).toBeCloseTo(190, 1);
    expect(num(low, "r")).toBeCloseTo(4, 1);
    expect(low.getAttribute("fill")).toBe("#6f7d8a");
    expect(textNamed(svg, "GDP (Q2, third estimate)")).toBeUndefined();
    expect(textNamed(svg, "CPI (Aug)")).toBeDefined();
  });

  it("anchors an event label start left of x 200 and end right of it", () => {
    const svg = mount([HIGH_D2, HIGH_D12]);
    const left = textNamed(svg, "CPI (Aug)");
    const right = textNamed(svg, "FOMC decision");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(anchorOf(left as Element)).toBe("start");
    expect(num(left as Element, "x")).toBeGreaterThan(xOf(2));
    expect(anchorOf(right as Element)).toBe("end");
    expect(num(right as Element, "x")).toBeLessThan(xOf(12));
  });

  it("two same-day events share the x; the highest importance is drawn last", () => {
    const medium = onDay(21, "ISM services (Aug)", 3, "medium");
    const high = onDay(22, "Retail sales (Aug)", 3, "high");
    const svg = mount([medium, high]);
    const sameDay = circles(svg).filter((c) => Math.abs(num(c, "cx") - xOf(3)) < 0.25);
    expect(sameDay).toHaveLength(2);
    expect(sameDay[sameDay.length - 1].getAttribute("fill")).toBe("var(--amber)");
    expect(sameDay[0].getAttribute("fill")).toBe("var(--cyan)");
    expect(textNamed(svg, "ISM services (Aug)")).toBeDefined();
    expect(textNamed(svg, "Retail sales (Aug)")).toBeDefined();
  });

  it("two same-day events at the same height stack their dots and labels 14 px apart", () => {
    const first = onDay(23, "CPI (Aug)", 3, "high");
    const second = onDay(24, "Retail sales (Aug)", 3, "high");
    const svg = mount([first, second]);
    const sameDay = circles(svg).filter((c) => Math.abs(num(c, "cx") - xOf(3)) < 0.25);
    expect(sameDay).toHaveLength(2);
    expect(Math.abs(num(sameDay[0], "cy") - num(sameDay[1], "cy"))).toBeCloseTo(14, 1);
    expect(Math.min(num(sameDay[0], "cy"), num(sameDay[1], "cy"))).toBeCloseTo(96 - 14, 1);
    const a = textNamed(svg, "CPI (Aug)");
    const b = textNamed(svg, "Retail sales (Aug)");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Math.abs(num(a as Element, "y") - num(b as Element, "y"))).toBeCloseTo(14, 1);
  });

  it("is an image named by its counts", () => {
    const svg = mount([HIGH_D2, MEDIUM_D5, LOW_D9]);
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Macro events over the next 18 days: 3 events, 1 high impact");
    expect(mount([HIGH_D2, HIGH_D12])).toHaveAttribute("aria-label", "Macro events over the next 18 days: 2 events, 2 high impact");
  });

  it("an empty 18 days with rows later in the window prints the axis and names the next event", () => {
    const svg = mount([BEYOND_D22]);
    expect(circles(svg)).toHaveLength(0);
    expect(content(svg)).toContain("No events in the next 18 days · next: GDP (Q2, third estimate) Oct 08, 08:30 ET");
    expect(verticalLines(svg)).toHaveLength(18);
  });

  it("an empty window on the stored-schedule fallback prints the end of the stored schedule", () => {
    const svg = mount([], "2026-09-04T12:30:00Z");
    expect(circles(svg)).toHaveLength(0);
    expect(content(svg)).toContain("Stored schedule ends Sep 04, 2026");
    expect(content(svg)).not.toContain("No events on file.");
  });

  it("no events at all prints No events on file.", () => {
    const svg = mount([]);
    expect(circles(svg)).toHaveLength(0);
    expect(content(svg)).toContain("No events on file.");
    expect(content(svg)).not.toContain("Stored schedule ends");
  });
});
