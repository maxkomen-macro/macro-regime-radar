/**
 * Codex R-13: the Methodology's training-sample sentences read the served metadata (training_n, recession months,
 * episodes) and leave a claim out when the response does not carry it.
 */
import { describe, expect, it } from "vitest";
import type { RecessionMetrics } from "../../api/types";
import { recessionSampleWords, trainingWords } from "./MethodologyScreen";

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
