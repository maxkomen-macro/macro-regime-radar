/**
 * Frame-2's pure pieces that Desk v2 keeps (DESK_FRAME2_SPEC §1 to §3) against
 * the saved engine payloads: the engine adapter and its formatting, used by
 * the Event Study's Advanced panel (the frame-2 engine detail), print served
 * fields only; the events behind a cell are the carried events with a
 * complete window; a computing answer is polled at the engine's Retry-After.
 * The frame-2 page components (the chart, the badge, the client verdict) left
 * with frame-3 and took their tests with them.
 */
import { describe, expect, it } from "vitest";
import { pollInterval, toStudyResult, type EngineAnswer, type EventStudyResponse } from "../../../api/desk";
import studiesJson from "./__fixtures__/engine-studies.json";
import { factsLine, fmtInterval, fmtMove, fmtZ, historyLine, missingForwardWord } from "./format";

const studies = studiesJson as unknown as Record<"preset" | "cross" | "bp_target" | "computing" | "awaiting_refresh", EngineAnswer>;

function page(a: EngineAnswer): EventStudyResponse {
  const r = toStudyResult(a);
  if (r.state !== "ready") throw new Error("not ready");
  return r.study;
}

const gold = page(studies.preset);
const golden = page(studies.cross);

describe("formatting prints served values only", () => {
  it("signs and units: percent to one place, bp whole, a true minus, a dash for none", () => {
    expect(fmtMove(1.58, "%")).toBe("+1.6%");
    expect(fmtMove(-12.4, "bp")).toBe("−12 bp");
    // The engine's fmt_move keeps the sign at zero (R-03): "+0.0%", "−0.0%".
    expect(fmtMove(0.01, "%")).toBe("+0.0%");
    expect(fmtMove(-0.04, "%")).toBe("−0.0%");
    expect(fmtMove(null, "%")).toBe("—");
    expect(fmtInterval([-1.8, 3.0], "%")).toBe("−1.8% to +3.0%");
    expect(fmtInterval(null, "%")).toBeNull();
  });

  it("interval bounds print as the engine prints them: the sign always kept (V-02, N-1)", () => {
    expect(fmtInterval([-1.6236, 4.0989], "%")).toBe("−1.6% to +4.1%");
    expect(fmtInterval([-0.0395, 3.71], "%")).toBe("−0.0% to +3.7%");
    expect(fmtInterval([0.082, 2.2], "%")).toBe("+0.1% to +2.2%");
    expect(fmtInterval([-34, -1], "bp")).toBe("−34 bp to −1 bp");
    expect(fmtInterval([-33.2, -0.4], "bp")).toBe("−33 bp to −0 bp");
    // An exact tie rounds to even, as Python's format does (R3-04).
    expect(fmtInterval([2.5, 3.5], "bp")).toBe("+2 bp to +4 bp");
    expect(fmtZ(-2.656)).toBe("−2.66");
  });

  it("the facts line reads n, blocks at 20 sessions, the sample, the cooldown and the entry from provenance", () => {
    const p = gold.provenance;
    expect(factsLine(gold)).toBe(`n ${p.n_events} · blocks ${p.n_blocks_by_h["20"]} at 20d · sample ${p.data_start}–${p.sample_end} · cooldown 20 · entry next session`);
    expect(factsLine(golden)).toContain("cooldown none");
    expect(factsLine(golden)).toContain("entry same session");
  });

  it("the history line comes from the response", () => {
    // The start is where the shock's and the target's histories both begin (V-03).
    expect(gold.provenance.data_start).toBe(gold.provenance.inputs.map((i) => i.history_from).sort().at(-1));
    for (const i of gold.provenance.inputs) expect(historyLine(gold)).toContain(`${i.label}: history from ${i.history_from}`);
    expect(historyLine(gold)).toContain(`Events are evaluable from ${gold.provenance.sample_start}`);
  });

});

describe("polling", () => {
  it("asks again at the engine's Retry-After while computing, and never otherwise", () => {
    expect(pollInterval({ state: "computing", slug: "x", detail: "", retry_after: 3 })).toBe(3000);
    expect(pollInterval({ state: "computing", slug: "x", detail: "", retry_after: null })).toBe(3000);
    expect(pollInterval(toStudyResult(studies.preset))).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });
});

describe("review round (R-08)", () => {
  it("R-08: the Oct 27, 2025 case: a lapsed 10-session window with a missing return reads 'no observation'", () => {
    // A saved engine payload with its newest event made the reviewer's case:
    // 2025-10-27, the 10-session return missing, 20 and 60 present, and the
    // horizon's n_incomplete at 2 (an aggregate over every event).
    const raw = structuredClone(studiesJson.preset) as unknown as EngineAnswer & { horizons: { h: number; n_incomplete: number }[]; recent_events: { date: string; moves: Record<string, number | null> }[] };
    raw.horizons.find((h) => h.h === 10)!.n_incomplete = 2;
    raw.recent_events[0] = { ...raw.recent_events[0], date: "2025-10-27", moves: { "5": 0.004, "10": null, "20": 0.021, "60": 0.05 } };
    const s = page(raw);
    const oct = s.recent_events[0];
    expect(oct.date).toBe("2025-10-27");
    expect(oct.forward["10"]).toBeNull();
    expect(missingForwardWord(oct, 10)).toBe("no observation");
    // With the engine's flag the word follows it, and only it (the engine does not serve it yet).
    expect(missingForwardWord({ window_open: { "60": true } }, 60)).toBe("window open");
    expect(missingForwardWord({ window_open: { "60": false } }, 60)).toBe("no observation");
    expect(missingForwardWord({ window_open: {} }, 60)).toBe("no observation");
    // Excluded from N as before: the horizon's n is the engine's, untouched.
    expect(s.horizons.find((h) => h.h === 10)!.n).toBe((raw.horizons as { h: number; n: number }[]).find((h) => h.h === 10)!.n);
  });

  it("R-08: the adapter keeps only true window_open flags an engine serves, and none when it serves none", () => {
    const raw = structuredClone(studiesJson.preset) as unknown as EngineAnswer & { recent_events: Record<string, unknown>[] };
    expect(page(raw).recent_events.every((e) => Object.keys(e.window_open).length === 0)).toBe(true);
    raw.recent_events[0] = { ...raw.recent_events[0], window_open: { "5": false, "60": true } };
    expect(page(raw).recent_events[0].window_open).toEqual({ "60": true });
  });

});
