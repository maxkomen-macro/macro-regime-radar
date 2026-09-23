/**
 * Frame-2's pure pieces (DESK_FRAME2_SPEC §1 to §3) against the saved engine
 * payloads: the facts line and the sample line print served fields only, the
 * events behind a cell are the carried events with a complete window, the
 * client verdict claims only what the engine's exclusion verdicts claim, the
 * badge's tone is the report's weakest verdict for the tables a study reads,
 * and a computing answer is polled at the engine's Retry-After.
 */
import { describe, expect, it } from "vitest";
import { pollInterval, toStudyResult, type EngineAnswer, type EventStudyResponse } from "../../../api/desk";
import type { SlaRow } from "../../../api/types";
import { clientVerdict, listWords } from "../words";
import studiesJson from "./__fixtures__/engine-studies.json";
import { EXCLUSION_CLIENT, EXCLUSION_CLIENT_SHORT, eventsBehind, factsLine, fmtInterval, fmtMove, fmtZ, historyLine, missingForwardWord, sampleLine } from "./format";
import { sourceLine, titleFor } from "./EventStudyPage";
import { behindCount } from "./results";
import { fetchFredPair, readingDate, seriesRef } from "../positions/series";
import { niceTicks } from "./HorizonChart";
import { cutoffs, studiesSource, studySource, studyVerdict } from "./StudyBadge";

const studies = studiesJson as unknown as Record<"preset" | "cross" | "bp_target" | "computing" | "awaiting_refresh", EngineAnswer>;

function page(a: EngineAnswer): EventStudyResponse {
  const r = toStudyResult(a);
  if (r.state !== "ready") throw new Error("not ready");
  return r.study;
}

const gold = page(studies.preset);
const golden = page(studies.cross);
const us10y = page(studies.bp_target);

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

  it("the sample line and its tooltip come from the response", () => {
    // The start is where the shock's and the target's histories both begin (V-03).
    expect(gold.provenance.data_start).toBe(gold.provenance.inputs.map((i) => i.history_from).sort().at(-1));
    expect(sampleLine(gold)).toBe(`Sample: ${gold.provenance.data_start} to ${gold.provenance.sample_end}`);
    for (const i of gold.provenance.inputs) expect(historyLine(gold)).toContain(`${i.label}: history from ${i.history_from}`);
    expect(historyLine(gold)).toContain(`Events are evaluable from ${gold.provenance.sample_start}`);
  });

  it("chart ticks are round and cover the range", () => {
    expect(niceTicks(-1.9, 4.2)).toEqual([-2, 0, 2, 4, 6]);
    const t = niceTicks(-0.3, 3.4);
    expect(t[0]).toBeLessThanOrEqual(-0.3);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(3.4);
  });
});

describe("events behind a cell", () => {
  it("lists carried events with a complete window at h, narrowed to a regime", () => {
    const all20 = eventsBehind(gold.recent_events, 20);
    expect(all20.every((e) => e.forward["20"] != null)).toBe(true);
    const r = gold.recent_events[0].regime;
    const behind = eventsBehind(gold.recent_events, 20, r);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.every((e) => e.regime === r)).toBe(true);
    // The engine serves the last ten; a cell can have more events than the list carries.
    expect(gold.recent_events.length).toBeLessThanOrEqual(10);
    expect(gold.provenance.n_events).toBeGreaterThanOrEqual(gold.recent_events.length);
  });
});

describe("the client verdict claims what the engine claims, in words", () => {
  it("an established horizon reads its direction and moves in words; the included ones read the engine's phrase", () => {
    const words = clientVerdict(golden, "%").join(" ");
    const est = golden.horizons.filter((h) => h.exclusion === "established").map((h) => h.h);
    expect(est).toEqual([20]);
    expect(words).toContain("Over 20 sessions, the S&P 500 ran higher than usual");
    expect(words).toContain(`Over ${listWords(golden.horizons.filter((h) => h.exclusion === "included").map((h) => h.h))} sessions, its moves after these events were not distinguishable from an ordinary stretch`);
    expect(words).not.toMatch(/\bn\s*=|blocks|interval|Δ|bootstrap/);
  });

  it("with nothing established it claims nothing: the gold preset", () => {
    const words = clientVerdict(gold, "%").join(" ");
    expect(words).not.toMatch(/ran (higher|lower) than usual/);
    expect(words).toContain(`the ${gold.target.label}'s moves after these events were not distinguishable from an ordinary stretch`);
    expect(words).toContain("No single regime has enough episodes to read on its own.");
    expect(words).toContain(`The record runs from ${gold.provenance.data_start!.slice(0, 4)} to ${gold.provenance.sample_end.slice(0, 4)}.`);
  });

  it("never speaks of a range: the engine judges medians, not ranges of outcomes (V-01)", () => {
    for (const s of [gold, golden, us10y]) expect(clientVerdict(s, s.target.unit === "bp" ? "bp" : "%").join(" ")).not.toMatch(/range/i);
    for (const w of [...Object.values(EXCLUSION_CLIENT), ...Object.values(EXCLUSION_CLIENT_SHORT)]) expect(w).not.toMatch(/range|clear of/i);
  });

  it("uses no word on the Desk's ban list", () => {
    for (const s of [gold, golden, us10y]) expect(clientVerdict(s, s.target.unit === "bp" ? "bp" : "%").join(" ")).not.toMatch(/\b(will|predicts|proves|guaranteed|always|never|obviously|model)\b/i);
  });
});

describe("the study badge", () => {
  const sla = (feed: string, verdict: SlaRow["verdict"]): SlaRow => ({ feed, latest: null, expected: null, verdict, reason: "" });

  it("takes the weakest report verdict across the tables the study reads", () => {
    expect(studyVerdict(["asset_prices"], [sla("asset_prices", "current"), sla("desk_series", "stale")])).toBe("current");
    expect(studyVerdict(["asset_prices", "desk_series"], [sla("asset_prices", "current"), sla("desk_series", "delayed")])).toBe("delayed");
    // Unavailable and missing inputs count as the weakest state (R-09).
    expect(studyVerdict(["asset_prices"], [sla("asset_prices", "unavailable")])).toBe("unavailable");
    expect(studyVerdict(["asset_prices", "desk_series"], [sla("asset_prices", "current"), sla("desk_series", "unavailable")])).toBe("unavailable");
    expect(studyVerdict(["asset_prices", "desk_series"], [sla("asset_prices", "stale")])).toBe("unavailable");
    expect(studyVerdict(["asset_prices"], [sla("asset_prices", "delayed"), sla("desk_series", "unavailable")])).toBe("delayed");
    expect(studyVerdict(["asset_prices"], null)).toBeNull();
  });

  it("stamps the provenance as_of and is unstamped before a study answers", () => {
    const s = studySource(gold, [sla("asset_prices", "stale")]);
    expect(s).toMatchObject({ label: "event-study engine", verdict: "stale" });
    expect(s.asOf).toMatch(/2026/);
    expect(studySource(null, null)).toMatchObject({ asOf: null });
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

describe("review round (R-01, R-04, R-07, R-08)", () => {
  it("R-01: a cell's count comes from the response on screen; a cell it lacks has none", () => {
    expect(behindCount(gold, { h: 20 })).toBe(gold.horizons.find((h) => h.h === 20)!.n);
    const row = gold.regime_split[1];
    expect(behindCount(gold, { h: 20, regime: row.regime })).toBe(row.by_horizon["20"].n);
    expect(behindCount(golden, { h: 20, regime: "No such regime" })).toBeNull();
    expect(behindCount(golden, { h: 7 })).toBeNull();
  });

  it("R-04: the client title and the source line name a regime restriction", () => {
    const restricted = { ...gold, params: { ...gold.params, regime: "stagflation" } };
    expect(titleFor(restricted, true)).toMatch(/, counting only events in Stagflation$/);
    expect(sourceLine(restricted)).toContain("events in Stagflation only");
    expect(titleFor(gold, true)).not.toMatch(/counting only/);
    expect(sourceLine(gold)).not.toMatch(/only/);
    const cross = { ...golden, params: { ...golden.params, regime: "goldilocks" } };
    expect(titleFor(cross, true)).toContain("counting only events in Goldilocks");
  });

  it("R-08: 'window open' only where the response marks the horizon incomplete; every other gap is 'no observation'", () => {
    const ev = (date: string, v: number | null) => ({ date, regime: "Goldilocks", z: null, entry_date: date, same_session: true, forward: { "60": v, "20": v } });
    const events = [ev("2026-09-10", null), ev("2026-07-01", null), ev("2026-03-01", 1.2), ev("2025-11-01", null), ev("2025-06-01", 2.0)];
    const marked = [{ h: 60, n_incomplete: 2 }, { h: 20, n_incomplete: 0 }];
    expect(missingForwardWord(events, marked, "2026-09-10", 60)).toBe("window open");
    expect(missingForwardWord(events, marked, "2026-07-01", 60)).toBe("window open");
    // Below a closed newer window: a gap, even at a marked horizon.
    expect(missingForwardWord(events, marked, "2025-11-01", 60)).toBe("no observation");
    // A horizon the response does not mark incomplete: never "window open".
    expect(missingForwardWord(events, marked, "2026-09-10", 20)).toBe("no observation");
    expect(missingForwardWord(events, [{ h: 60, n_incomplete: null }], "2026-09-10", 60)).toBe("no observation");
    expect(missingForwardWord(events, [], "2026-09-10", 60)).toBe("no observation");
  });

  it("R-08: the adapter carries each horizon's n_incomplete as served", () => {
    const raw = studiesJson.preset as unknown as { horizons: { h: number; n_incomplete: number }[] };
    expect(gold.horizons.map((h) => [h.h, h.n_incomplete])).toEqual(raw.horizons.map((h) => [h.h, h.n_incomplete]));
  });

  it("R-07: a FRED value and its date are one pair from one generation", async () => {
    // A scripted API: freshness reports (generation + DGS10's observation date) and the value.
    const run = async (gens: number[], value = 4.12, asOf = "2026-09-17") => {
      const calls: string[] = [];
      let f = 0;
      const get = (async (path: string) => {
        calls.push(path);
        if (path === "/api/freshness") {
          const id = gens[f++] ?? gens.at(-1);
          return { generation: { id }, series: [{ id: "DGS10", as_of: asOf, cadence: "daily" }, { id: "UNRATE", as_of: "2026-08-01", cadence: "monthly" }] };
        }
        return { series_id: "DGS10", date: "2026-09-01", value };
      }) as never;
      return { reading: await fetchFredPair(seriesRef("DGS10")!, get), calls };
    };
    // One generation around the value: the pair is that generation's value and date.
    const same = await run([1, 1]);
    expect(same.reading).toEqual({ value: 4.12, date: "2026-09-17", monthly: false, generation: 1 });
    expect(readingDate(same.reading)).toBe("Sep 17, 2026");
    expect(same.calls).toEqual(["/api/freshness", "/series/DGS10/latest", "/api/freshness"]);
    // A generation published mid-read: read again, and pair within the new one.
    const moved = await run([1, 2, 2, 2]);
    expect(moved.reading.generation).toBe(2);
    expect(moved.calls).toHaveLength(6);
    // Split twice: refuse rather than guess.
    await expect(run([1, 2, 3, 4])).rejects.toThrow(/different data generations/);
    // A monthly series names its month; an API without generations gives no date.
    expect(readingDate({ date: "2026-08-01", monthly: true })).toBe("Aug 2026");
    const old = (async (path: string) => (path === "/api/freshness" ? { series: [{ id: "DGS10", as_of: "2026-09-17" }] } : { value: 4.12 })) as never;
    expect(await fetchFredPair(seriesRef("DGS10")!, old)).toEqual({ value: 4.12, date: null, generation: null });
    expect(readingDate({ date: null })).toBe("date unknown");
  });
});

describe("R-12: one badge over several studies", () => {
  it("stamps the earliest as_of, lists each study's own, and says when cutoffs differ", () => {
    const early = { ...golden, provenance: { ...golden.provenance, as_of: "2026-09-17" } };
    const items = [
      { name: "Gold preset", study: gold },
      { name: "Golden cross", study: early },
    ];
    expect(cutoffs(items)).toEqual({ earliest: "2026-09-17", differ: gold.provenance.as_of !== "2026-09-17" });
    const src = studiesSource(items, [{ feed: "asset_prices", latest: null, expected: null, verdict: "current", reason: "" }]);
    expect(src.asOf).toBe("Sep 17, 2026");
    expect(src.reason).toContain(`Gold preset as of ${gold.provenance.as_of}`);
    expect(src.reason).toContain("Golden cross as of 2026-09-17");
    expect(src.reason).toMatch(/^Cutoffs differ; the stamp is the earliest\./);
    expect(cutoffs([{ name: "a", study: gold }, { name: "b", study: gold }]).differ).toBe(false);
  });
});

