import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DRAFT, type Draft } from "./gate";
import { POSITIONS_KEY, addPosition, parsePositions, positionProblem, removePosition, resetPositionsForTests, serializePositions } from "./store";

const GOOD: Draft = {
  ...EMPTY_DRAFT,
  instrument: "TLT",
  variant_view: "Duration is likely to cheapen.",
  pre_mortem: "The curve bull-steepened through my level.",
  falsification_series: "DGS10",
  falsification_level: "3.8",
};

beforeEach(() => {
  window.localStorage.clear();
  resetPositionsForTests();
});

describe("positions store", () => {
  it("seeds nothing", () => {
    expect(parsePositions(null)).toEqual([]);
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
  });
  it("refuses a draft the gate refuses and writes nothing", () => {
    const r = addPosition({ ...GOOD, variant_view: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/variant view/);
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
    const flagged = addPosition({ ...GOOD, pre_mortem: "It will never fail." });
    expect(flagged.ok).toBe(false);
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
  });
  it("saves a passing draft under the versioned key and removes it again", () => {
    const r = addPosition(GOOD, new Date("2026-09-21T12:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.persisted).toBe(true);
    const stored = parsePositions(window.localStorage.getItem(POSITIONS_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].falsification).toEqual({ series: "DGS10", level: 3.8, direction: "below" });
    expect(stored[0].created_at).toBe("2026-09-21T12:00:00.000Z");
    expect(removePosition(r.position.id)).toBe(true);
    expect(parsePositions(window.localStorage.getItem(POSITIONS_KEY))).toEqual([]);
  });
  it("reads corrupt, foreign-version or half-shaped data as empty", () => {
    expect(parsePositions("{not json")).toEqual([]);
    expect(parsePositions(JSON.stringify({ version: 2, positions: [] }))).toEqual([]);
    expect(parsePositions(JSON.stringify({ version: 1, positions: [{ id: "x", instrument: "TLT" }] }))).toEqual([]);
    const ok = { id: "a", instrument: "TLT", direction: "long", size: "", horizon: "3 months", variant_view: "v", pre_mortem: "p", falsification: { series: "DGS10", level: 3.8, direction: "below" }, created_at: "2026-01-01T00:00:00Z" };
    expect(parsePositions(serializePositions([ok as never]))).toHaveLength(1);
  });
  it("drops a stored position the gate or the series check refuses, with a console note (R-05)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { id: "a", instrument: "TLT", direction: "long", size: "", horizon: "3 months", variant_view: "Duration is likely to cheapen.", pre_mortem: "The curve steepened.", falsification: { series: "DGS10", level: 3.8, direction: "below" }, created_at: "2026-01-01T00:00:00Z" };
    const flagged = { ...base, id: "b", variant_view: "This will definitely work." };
    const empty = { ...base, id: "c", pre_mortem: "  " };
    const foreign = { ...base, id: "d", falsification: { series: "NOT_A_SERIES", level: 1, direction: "above" } };
    const kept = parsePositions(serializePositions([base, flagged, empty, foreign] as never));
    expect(kept.map((p) => p.id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.map((c) => String(c[0])).join(" | ")).toMatch(/replace 2 flagged words[\s\S]*write the pre-mortem[\s\S]*not one the Desk reads/);
    expect(positionProblem(base as never)).toBeNull();
    warn.mockRestore();
  });
});
