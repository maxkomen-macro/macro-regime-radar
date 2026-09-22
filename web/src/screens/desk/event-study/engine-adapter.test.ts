/**
 * The engine's contract as the page reads it (desk/integration). The frame
 * typed the event study from the spec before the engine existed; these run
 * the real payloads (__fixtures__/engine-*.json, saved from the engine and
 * pinned to it by tests/test_event_study.py) through the adapter in
 * api/desk.ts.
 */
import { describe, expect, it } from "vitest";
import { toPageAssets, toStudyResult, type EngineAnswer, type EngineAssets } from "../../../api/desk";
import assetsJson from "./__fixtures__/engine-assets.json";
import studiesJson from "./__fixtures__/engine-studies.json";
import { PRESET, PRESETS } from "./studies";

const assets = assetsJson as unknown as EngineAssets;
const studies = studiesJson as unknown as Record<"preset" | "cross" | "bp_target" | "computing" | "awaiting_refresh", EngineAnswer>;

function ready(a: EngineAnswer) {
  const r = toStudyResult(a);
  if (r.state !== "ready") throw new Error(`expected ready, got ${r.state}`);
  return { page: r.study, raw: a as Extract<EngineAnswer, { status: "ready" }> };
}

describe("assets: the engine's lists in the builder's terms", () => {
  const a = toPageAssets(assets);

  it("offers the stored series only, by the engine's keys, with history_from", () => {
    const ids = a.shock_assets.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["spx", "gold", "us10y", "us2y", "curve_2s10s", "vix", "hy_oas"]));
    for (const gone of ["gold_lbma", "ndx", "wti", "copper", "xlk"]) expect(ids).not.toContain(gone);
    expect(a.shock_assets.find((x) => x.id === "gold")).toMatchObject({ history_from: "2000-08-30", warn: true, shock_unit: "log_return" });
    expect(a.targets.map((x) => x.id).sort()).toEqual(["gold", "hy_oas", "spx", "us10y", "vix"]);
  });

  it("writes a condition with its value as the slug writes it, and leaves the regime condition to the regime filter", () => {
    expect(a.conditions[0]).toEqual({ id: "none", label: "No co-condition" });
    expect(a.conditions.map((c) => c.id)).toEqual(["none", "spx_below_50dma", "spx_20d_negative", "vix_above=20.0", "hy_oas_20d_change_above=25.0"]);
    expect(a.conditions.find((c) => c.id === "vix_above=20.0")?.label).toBe("VIX above 20");
    expect(a.conditions.find((c) => c.id === "hy_oas_20d_change_above=25.0")?.label).toBe("HY OAS 20-session change above 25 bp");
  });

  it("carries the regimes as slug words, the vocabularies, the presets and nothing awaiting", () => {
    expect(a.regimes).toEqual(["all", "goldilocks", "overheating", "stagflation", "recession_risk"]);
    expect(a.windows).toEqual([5, 20, 60]);
    expect(a.thresholds).toEqual([1.5, 2, 2.5]);
    expect(a.signs).toEqual(["+", "-", "both"]);
    expect(a.presets?.map((p) => p.slug)).toEqual(Object.keys(PRESETS));
    expect(a.awaiting).toEqual([]);
  });

  it("keeps a series awaiting the first full refresh selectable and names it", () => {
    const before = structuredClone(assets);
    for (const row of [...before.shocks, ...before.targets]) if (row.key === "vix") row.status = "awaiting_refresh";
    before.awaiting_refresh = ["vix"];
    const b = toPageAssets(before);
    expect(b.shock_assets.find((x) => x.id === "vix")?.status).toBe("awaiting_refresh");
    expect(b.awaiting).toEqual(["VIX"]);
  });
});

describe("a study: the engine's payload in the page's terms", () => {
  it("prints a return target in percent: every move and interval × 100, shares untouched", () => {
    const { page, raw } = ready(studies.preset);
    expect(page.slug).toBe("gold-2sigma-spx-weak");
    expect(page.params).toEqual(PRESET);
    expect(page.target).toEqual({ label: "S&P 500", unit: "log_return" });
    const [h, r] = [page.horizons[0], raw.horizons[0]];
    expect(h.median).toBeCloseTo((r.median as number) * 100, 10);
    expect(h.delta).toBeCloseTo((r.delta as number) * 100, 10);
    expect(h.ci90?.[0]).toBeCloseTo((r.ci90 as [number, number])[0] * 100, 10);
    expect(h.hit_rate).toBe(r.hit_rate);
    expect(h.baseline_hit_rate).toBe(r.baseline_hit_rate);
    expect(h.n_blocks).toBe(r.n_blocks);
    expect(page.recent_events[0].forward["20"]).toBeCloseTo((raw.recent_events[0].moves["20"] as number) * 100, 10);
    expect(page.recent_events[0].z).toBe(raw.recent_events[0].z);
    expect(page.verdict).toEqual({ text: raw.verdict.text, points: raw.verdict.sentences });
    expect(page.provenance).toMatchObject({ as_of: raw.provenance.as_of, n_events: raw.provenance.n_events, cooldown: 20, seed: raw.provenance.seed, inputs_hash: raw.provenance.inputs_hash, n_boot: 10000 });
    expect(page.distribution ?? null).toBeNull();
  });

  it("reads the regime split with its suppressed reads and the Unlabeled row outside the totals", () => {
    const { page, raw } = ready(studies.preset);
    expect(page.regime_split.map((r) => r.regime)).toEqual(raw.regimes.map((r) => (r.excluded_from_totals ? `${r.regime} (outside the totals)` : r.regime)));
    for (const [i, r] of raw.regimes.entries()) {
      const row = page.regime_split[i];
      expect(row.n).toBe(r.n_events);
      expect(row.suppressed).toBe(r.horizons.every((x) => x.median == null));
      for (const x of r.horizons) expect(row.by_horizon[String(x.h)]).toEqual({ hit_rate: x.hit_rate, median: x.median == null ? null : x.median * 100 });
    }
  });

  it("reads a cross: its own params, no z and no cooldown", () => {
    const { page, raw } = ready(studies.cross);
    expect(page.params).toEqual(PRESETS["spx-golden-cross"]);
    expect(page.kind).toBe("cross");
    expect(page.label).toBe(raw.study.label);
    expect(page.recent_events[0].z).toBeNull();
    expect(page.provenance.cooldown).toBeNull();
  });

  it("prints a yield target in basis points as served", () => {
    const { page, raw } = ready(studies.bp_target);
    expect(page.target.unit).toBe("bp");
    expect(page.horizons[1].median).toBe(raw.horizons[1].median);
    expect(page.horizons[1].ci90).toEqual(raw.horizons[1].ci90);
  });

  it("carries the two states that are not a study", () => {
    expect(toStudyResult(studies.computing)).toEqual({ state: "computing", slug: "vix-w5-z2.0-up-none-spx", detail: expect.stringContaining("computing") });
    const w = toStudyResult(studies.awaiting_refresh);
    expect(w).toEqual({ state: "awaiting_refresh", slug: "vix-w5-z2.0-up-none-spx", series: "vix", detail: expect.stringContaining("first full refresh") });
  });
});

describe("retries (desk/integration, verifier V-03)", () => {
  it("retries what the API marks retryable, a few times, and nothing else", async () => {
    const { ApiError } = await import("../../../api/client");
    const { deskRetry } = await import("../../../api/desk");
    const warming = new ApiError(503, "/api/desk/event-study", "The server is warming up", "warming", true);
    const timeout = new ApiError(0, "/api/desk/event-study", "did not answer", "timeout", true);
    const busy = new ApiError(429, "/api/desk/event-study", "busy", null, true);
    for (const e of [warming, timeout, busy]) {
      expect(deskRetry(0, e), e.message).toBe(true);
      expect(deskRetry(4, e), e.message).toBe(false);
    }
    expect(deskRetry(0, new ApiError(422, "/api/desk/event-study", "w must be one of (5, 20, 60)", null, false))).toBe(false);
    expect(deskRetry(0, new ApiError(503, "/api/desk/event-study", "tier 2", "not_stored", false))).toBe(false);
    expect(deskRetry(0, new ApiError(404, "/api/desk/event-study", "Not Found", null, false))).toBe(false);
    expect(deskRetry(0, new Error("boom"))).toBe(false);
  });
});
