/**
 * Codex R-13: the Methodology's training-sample sentences read the served metadata (training_n, recession months,
 * episodes) and leave a claim out when the response does not carry it.
 */
import { describe, expect, it } from "vitest";
import type { RecessionMetrics } from "../../api/types";
import { REGIME_DEFS, recessionSampleWords, trainingWords } from "./MethodologyScreen";
import { REGIME_MEANING } from "../dashboard/hero-copy";

const SERVED = {
  training_window: { start: "2003-04", end: "2026-09" },
  training_n: 281,
  training_recession_months: 20,
  training_recessions: [
    { start: "2008-01", end: "2009-06" },
    { start: "2020-03", end: "2020-04" },
  ],
} as unknown as RecessionMetrics;

describe("the recession model's sample in Methodology", () => {
  it("names the served count of recessions", () => {
    expect(recessionSampleWords(SERVED)).toBe("The recession model has two recessions in its sample and no out-of-sample test.");
    const three = { ...SERVED, training_recessions: [...SERVED.training_recessions!, { start: "2001-03", end: "2001-11" }] } as RecessionMetrics;
    expect(recessionSampleWords(three)).toBe("The recession model has three recessions in its sample and no out-of-sample test.");
    const one = { ...SERVED, training_recessions: [SERVED.training_recessions![0]] } as RecessionMetrics;
    expect(recessionSampleWords(one)).toBe("The recession model has one recession in its sample and no out-of-sample test.");
  });
  it("without the metadata states only what needs none", () => {
    expect(recessionSampleWords(undefined)).toBe("The recession model has no out-of-sample test.");
    expect(recessionSampleWords({ ...SERVED, training_recessions: null } as RecessionMetrics)).toBe("The recession model has no out-of-sample test.");
    expect(recessionSampleWords({ ...SERVED, training_n: null } as RecessionMetrics)).toBe("The recession model has no out-of-sample test.");
  });
  it("trainingWords reads the same metadata", () => {
    expect(trainingWords(SERVED)).toBe("Trained on April 2003 to September 2026 (n = 281 months), with 20 recession months across two recessions (2008–09, 2020).");
    expect(trainingWords(undefined)).toBe("Trained on the months where all five inputs exist (from April 2003, when the breakevens begin).");
  });
});

describe("Codex R-20 follow-up: the regime slope is the last three monthly readings, never three months", () => {
  it("in Methodology's quadrant definitions and the Dashboard hero's", () => {
    const defs = [...REGIME_DEFS.map((d) => d.def), ...Object.values(REGIME_MEANING)];
    for (const d of defs) expect(d, d).not.toMatch(/three months|3 months|3-month/);
    expect(defs.filter((d) => d.includes("over the last three monthly readings"))).toHaveLength(6);
  });
});
