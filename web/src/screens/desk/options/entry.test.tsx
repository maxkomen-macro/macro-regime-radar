/**
 * The ways into the Options Finder while it ships unlisted (Options Finder Build Plan step 6, §4): none of them is
 * drawn, and the arithmetic Event Study would carry. ./entry.listed.test.tsx renders the same pieces with the flag on.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import study from "../../../fixtures/desk/study.json";
import type { StudyResponse } from "../data/types";
import { PALETTE_ENTRIES, finderPaletteEntries } from "../../shell/sections";
import { OPTIONS_FINDER_LISTED } from "./flag";
import { carriedNote, studyCarry, StudyFinderLink } from "./entry";
import { LensFinderLink, finderHref } from "./lens-link";

const STUDY = study as unknown as StudyResponse;

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
