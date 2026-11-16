/**
 * The ways into the Options Finder with the flag off (Options Finder Build Plan step 6, §4): none of them is drawn,
 * and the arithmetic Event Study carries. The flag ships on; this file turns it off to keep the unlisted state
 * (Preview, noindex, no link) covered. ./entry.listed.test.tsx renders the same pieces with the flag as shipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { screen } from "@testing-library/react";

vi.mock("./flag", () => ({ OPTIONS_FINDER_LISTED: false, OPTIONS_FINDER_SLUG: "options-finder" }));

import DeskShell from "../DeskShell";
import { DESK_PAGES, deskPageBySlug } from "../desk-sections";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import study from "../../../fixtures/desk/study.json";
import type { StudyResponse } from "../data/types";
import { PALETTE_ENTRIES, finderPaletteEntries } from "../../shell/sections";
import { OPTIONS_FINDER_LISTED } from "./flag";
import { carriedNote, exampleThesis, studyCarry, StudyFinderLink } from "./entry";
import { LensFinderLink, finderHref } from "./lens-link";

const STUDY = study as unknown as StudyResponse;

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Options Finder with the flag off", () => {
  it("is in no sidebar group, yet its address resolves (unlisted is not private)", () => {
    expect(OPTIONS_FINDER_LISTED).toBe(false);
    expect(DESK_PAGES.map((p) => p.slug)).not.toContain("options-finder");
    expect(deskPageBySlug("options-finder")?.label).toBe("Options Finder");
  });

  it("opens by its address with a Preview badge and a noindex tag, and the sidebar has no link to it", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>,
      { route: "/desk/options-finder" },
    );
    await screen.findByRole("heading", { level: 1, name: "Options Finder" });
    expect(screen.getByTestId("of-preview")).toHaveTextContent("Preview");
    expect(document.head.querySelector('meta[name="robots"][data-options-finder]')).toHaveAttribute("content", "noindex, nofollow");
    expect(screen.queryByRole("link", { name: /^Options Finder/ })).toBeNull();
  });
});

describe("Options Finder entry links, unlisted", () => {
  it("draws no lens link, no Event Study link and no palette entry", () => {
    expect(OPTIONS_FINDER_LISTED).toBe(false);
    const { container } = render(
      <MemoryRouter>
        <LensFinderLink symbol="aapl" />
        <StudyFinderLink study={STUDY} />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
    expect(PALETTE_ENTRIES.some((e) => e.label === "Options Finder" || e.path)).toBe(false);
    expect(finderPaletteEntries(false)).toEqual([]);
    expect(finderPaletteEntries(true)).toEqual([expect.objectContaining({ label: "Options Finder", path: "/desk/options-finder" })]);
  });

  it("builds the example from the served close: SPY 5% above it, 35 days on, $1,500, a one-month window", () => {
    expect(exampleThesis(754.37, "2026-11-13")).toEqual({ symbol: "SPY", direction: "up", target: "792.09", by: "2026-12-18", budget: "1500", scan_months: "1" });
    expect(exampleThesis(Number.NaN, "2026-11-13")).toBeNull();
    expect(exampleThesis(0, "2026-11-13")).toBeNull();
    expect(exampleThesis(754.37, "Nov 13")).toBeNull();
  });

  it("builds the Finder's address", () => {
    expect(finderHref({ symbol: "AAPL" })).toBe("/desk/options-finder?symbol=AAPL");
    expect(finderHref({})).toBe("/desk/options-finder");
  });

  it("maps an S&P 500 study to SPY at its close × e^median, the direction from the median's sign", () => {
    const h = (STUDY.horizons ?? []).find((x) => x.h === STUDY.selected_horizon) as { median: number };
    const carry = studyCarry(STUDY, 660.12, "2026-09-23");
    expect(carry).toMatchObject({ symbol: "SPY", direction: h.median > 0 ? "up" : "down", target: (660.12 * Math.exp(h.median)).toFixed(2), es_h: "20", es_close: "660.12", es_date: "2026-09-23" });
    expect(studyCarry({ ...STUDY, question: { ...STUDY.question, target: "dgs10" } } as StudyResponse, 660.12, "2026-09-23")).toBeNull();
    const flat = { ...STUDY, horizons: (STUDY.horizons ?? []).map((x) => ({ ...x, median: 0 })) } as StudyResponse;
    expect(studyCarry(flat, 660.12, "2026-09-23")).toBeNull();
    expect(studyCarry(STUDY, Number.NaN, "2026-09-23")).toBeNull();
  });

  it("states the carried arithmetic on the Finder, and nothing for an address that carries none", () => {
    const carry = studyCarry(STUDY, 660.12, "2026-09-23") as Record<string, string>;
    const note = carriedNote(new URLSearchParams(carry));
    expect(note).toContain("Carried from Event Study (Gold +2σ while S&P weak): the S&P 500's median move 20 sessions after the event was");
    expect(note).toContain(`SPY's Sep 23, 2026 close $660.12 × e^${Number(carry.es_move).toFixed(4)} = $${carry.target}.`);
    expect(carriedNote(new URLSearchParams("symbol=SPY&target=600"))).toBeNull();
  });
});
