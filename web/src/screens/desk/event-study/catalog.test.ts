/** The study catalog decides what the slots can ask (event-study/catalog.ts; DESK_FRAME3_SPEC §4, §12.2, §12.3). */
import { describe, expect, it } from "vitest";
import catalog from "../../../fixtures/desk/study-catalog.json";
import study from "../../../fixtures/desk/study.json";
import type { CatalogStudy, Question } from "../data/types";
import { isAnswerable, leadsToStudy, studyFor } from "./catalog";
import { PRESET_CHIPS } from "./question";

const studies = catalog.studies as CatalogStudy[];
const GOLD: Question = { shock: "gold", window: 20, move: "up2s", while: "spx_below_50", target: "spx", horizon: 20 };
const GOLDEN: Question = { shock: "spx", window: null, move: "cross_above", while: "none", target: "spx", horizon: 20 };
const VIX: Question = { shock: "vix", window: 5, move: "up2s", while: "none", target: "spx", horizon: 20 };

describe("the study catalog (§12.3)", () => {
  it("serves §12.3's fifteen studies; the nine chips are among them, and the gold study is the fixture's question", () => {
    expect(studies).toHaveLength(15);
    for (const c of PRESET_CHIPS) expect(studies.find((s) => s.slug === c.slug)?.label).toBe(c.label);
    expect(studyFor(studies, { ...(study.question as unknown as Question) })?.slug).toBe("gold-2sigma-spx-weak");
    // Every available row allows all four horizons; the RSI rows have no question yet.
    for (const s of studies.filter((x) => x.available)) expect(s.allowed_horizons).toEqual([5, 10, 20, 60]);
    expect(studies.filter((s) => !s.question).map((s) => s.slug)).toEqual(["rsi-above-70", "rsi-below-30"]);
    expect(studies.filter((s) => !s.available).map((s) => s.slug)).toEqual(["dollar-2sigma-20d", "oil-2sigma-gold", "oil-2sigma-20d", "rsi-above-70", "rsi-below-30"]);
  });

  it("a question is answerable only as an available catalog study at an allowed horizon (§12.2)", () => {
    expect(isAnswerable(studies, GOLD)).toBe(true);
    expect(isAnswerable(studies, { ...GOLD, horizon: 60 })).toBe(true);
    expect(isAnswerable(studies, { ...GOLD, window: 60 })).toBe(false);
    expect(isAnswerable(studies, GOLDEN)).toBe(true);
    // The dollar study is in the catalog but not stored: not answerable.
    expect(isAnswerable(studies, { shock: "dxy", window: 20, move: "down2s", while: "none", target: "spx", horizon: 20 })).toBe(false);
  });

  it("an option is enabled only when, with the other slots as they are, it leads to an available study (§4)", () => {
    const allowed = (q: Question, slot: keyof Question, values: Question[keyof Question][]) => values.filter((v) => leadsToStudy(studies, q, slot, v));
    // The gold study: only its own values lead anywhere, every horizon does.
    expect(allowed(GOLD, "shock", ["gold", "spx", "vix", "dxy"])).toEqual(["gold"]);
    expect(allowed(GOLD, "while", ["none", "spx_below_50"])).toEqual(["spx_below_50"]);
    expect(allowed(GOLD, "window", [5, 20, 60, null])).toEqual([20]);
    expect(allowed(GOLD, "horizon", [5, 10, 20, 60])).toEqual([5, 10, 20, 60]);
    // The VIX spike: the S&P's own 5-day move is one slot away.
    expect(allowed(VIX, "shock", ["vix", "spx", "gold", "wti"])).toEqual(["vix", "spx"]);
    // The golden cross: the death cross is one slot away; a 2σ move needs a window it does not have.
    expect(allowed(GOLDEN, "move", ["cross_above", "cross_below", "up2s", "down2s"])).toEqual(["cross_above", "cross_below"]);
    expect(allowed(GOLDEN, "window", [5, 20, 60, null])).toEqual([null]);
  });
});
