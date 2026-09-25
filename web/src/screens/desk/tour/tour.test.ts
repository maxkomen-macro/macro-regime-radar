/**
 * The walkthrough's pure rules (DESK_FRAME2_SPEC §6): six steps on the spec's
 * routes, `?tour=N` parsed strictly, each step's link, closing keeps the rest
 * of the query, and the arrow keys stay with a control that uses them.
 */
import { describe, expect, it } from "vitest";
import { DESK_ALIASES, TOUR_STEPS, keyBelongsToControl, parseTour, tourHref, withoutTour } from "./tour";
import { DESK_PAGES } from "../desk-sections";

describe("walkthrough steps", () => {
  it("are the spec's six routes, in order", () => {
    expect(TOUR_STEPS.map((s) => s.route)).toEqual([
      "/desk/event-study?study=gold-2sigma-spx-weak",
      "/desk/internals",
      "/desk/monitor?from=gold-2sigma-spx-weak",
      "/desk/pipeline",
      "/desk/event-study?study=gold-2sigma-spx-weak&view=client",
      "/desk/notes",
    ]);
    for (const s of TOUR_STEPS) expect(s.caption.length).toBeGreaterThan(10);
  });

  it("every short path opens a real Desk page", () => {
    for (const slug of Object.values(DESK_ALIASES)) expect(DESK_PAGES.some((p) => p.slug === slug && !p.href)).toBe(true);
  });

  it("carries the step in the URL, strictly", () => {
    expect(tourHref(1)).toBe("/desk/event-study?study=gold-2sigma-spx-weak&tour=1");
    // Links resolve the spec's short paths to the page slugs (no redirect on Next, R3-01).
    expect(tourHref(2)).toBe("/desk/sp-internals?tour=2");
    expect(tourHref(3)).toBe("/desk/position-monitor?from=gold-2sigma-spx-weak&tour=3");
    expect(tourHref(4)).toBe("/desk/data-pipeline?tour=4");
    expect(tourHref(6)).toBe("/desk/build-notes?tour=6");
    expect(tourHref(5)).toBe("/desk/event-study?study=gold-2sigma-spx-weak&view=client&tour=5");
    for (let n = 1; n <= 6; n++) expect(parseTour(tourHref(n).split("?")[1])).toBe(n);
    for (const bad of ["tour=0", "tour=7", "tour=abc", "tour=1.5", "tour=", ""]) expect(parseTour(bad)).toBeNull();
  });

  it("closing clears the tour and keeps the rest of the query", () => {
    expect(withoutTour("study=gold-2sigma-spx-weak&view=client&tour=5").toString()).toBe("study=gold-2sigma-spx-weak&view=client");
  });

  it("leaves the arrow keys to fields, selects and segmented toggles", () => {
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    const inGroup = document.createElement("button");
    group.appendChild(inGroup);
    const plain = document.createElement("button");
    expect(keyBelongsToControl(document.createElement("input"))).toBe(true);
    expect(keyBelongsToControl(document.createElement("select"))).toBe(true);
    expect(keyBelongsToControl(inGroup)).toBe(true);
    expect(keyBelongsToControl(plain)).toBe(false);
    expect(keyBelongsToControl(document.body)).toBe(false);
  });
});
