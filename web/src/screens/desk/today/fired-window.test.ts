import { describe, expect, it } from "vitest";
import { firedWindow } from "./TodayPage";

describe("five-session window", () => {
  it("counts the last completed session and the four weekdays before it", () => {
    expect(firedWindow("2026-09-18")).toEqual({ from: "2026-09-14", to: "2026-09-18" }); // Fri → Mon
    expect(firedWindow("2026-09-21")).toEqual({ from: "2026-09-15", to: "2026-09-21" }); // Mon → Tue, over a weekend
    expect(firedWindow("2026-09-16")).toEqual({ from: "2026-09-10", to: "2026-09-16" }); // Wed → Thu
  });
});
