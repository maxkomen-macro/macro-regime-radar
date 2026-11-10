/**
 * The options PROTOTYPE's markers are computed for desk/books' first-visit preset, AI Infrastructure 10. Positioning
 * (Desk P4, §12.20) and the event study (desk P1a, §12.19) are served, so no card is drawn for one basket only.
 */
import { describe, expect, it } from "vitest";
import { PRESET } from "../basket/weights";
import { DRAWN_FOR } from "./drawn-for";

describe("the basket the options markers are computed for", () => {
  it("is the preset: ten names at 10%", () => {
    expect(DRAWN_FOR).toBe(PRESET);
    expect(PRESET.legs.map((l) => l.symbol)).toEqual(["NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"]);
    expect(PRESET.legs.every((l) => Number(l.weight) === 10)).toBe(true);
  });
});
