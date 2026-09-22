/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 1,
 * `tools/lbo-deal.test.ts`: the pure deal module (BASE_INPUTS, SLIDERS,
 * dealWarnings, irrTone, bridgeSteps) and the `useLboDeal` hook through
 * `renderHook` under the providers wrapper, with `stubFetch` answering
 * `/api/lbo/defaults` and the deterministic `/api/lbo/run` stub
 * (./__fixtures__/lbo.ts). Timers are real: the 300 ms debounce is awaited
 * with `waitFor`; only `Date` is frozen. Every expected figure is computed
 * from the fixture model, never the mockup's 10.0x / 6.0x / 7% deal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createElement, type ReactNode } from "react";
import type { LboRequest, LboResult } from "../../api/types";
import { BASE_INPUTS, SLIDERS, bridgeSteps, dealWarnings, irrTone, useLboDeal } from "./lbo-deal";
import { makeClient, stubFetch } from "../../test/utils";
import { BASE_REQ, LBO_DEFAULTS, LIVE_RATE, NOW, STATED_RATE, lboModel, lboRoutes, lboRun, posted } from "./__fixtures__/lbo";

const RUN = "/api/lbo/run";
const runs = (calls: string[]) => calls.filter((c) => c.startsWith(RUN));

/** The providers every screen expects (utils.tsx renderWithProviders), as a renderHook wrapper. */
function makeWrapper() {
  const client = makeClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, { initialEntries: ["/app/tools"], future: { v7_startTransition: true, v7_relativeSplatPath: true } }, children),
    );
  };
}

/* ── the pure module ─────────────────────────────────────────────────────── */

describe("BASE_INPUTS (the default deal, verbatim)", () => {
  it("equals the eight defaults", () => {
    expect(BASE_INPUTS).toEqual({
      ebitda: 100,
      ebitda_growth_rate: 5,
      entry_multiple: 8,
      exit_multiple: 9,
      hold_period: 5,
      leverage_ratio: 4.5,
      amortization_rate: 5,
      mgmt_fee_pct: 1.5,
    });
  });
});

describe("SLIDERS (the nine assumption rows)", () => {
  it("has nine entries in today's order with the T10 labels, ranges, units, dp, groups and Jargon terms", () => {
    expect(SLIDERS).toHaveLength(9);
    expect(SLIDERS.map((s) => s.key)).toEqual([
      "ebitda",
      "ebitda_growth_rate",
      "entry_multiple",
      "exit_multiple",
      "hold_period",
      "mgmt_fee_pct",
      "leverage_ratio",
      "interest_rate",
      "amortization_rate",
    ]);
    expect(SLIDERS.map((s) => s.label)).toEqual([
      "Entry EBITDA",
      "EBITDA growth",
      "Entry multiple",
      "Exit multiple",
      "Hold period",
      "Transaction fees",
      "Leverage · Debt/EBITDA",
      "Interest rate (all-in)",
      "Debt amortization",
    ]);
    expect(SLIDERS.map((s) => [s.min, s.max, s.step, s.unit, s.dp])).toEqual([
      [10, 1000, 10, "$M", 0],
      [-10, 30, 0.5, "%/yr", 1],
      [3, 20, 0.25, "×", 2],
      [3, 20, 0.25, "×", 2],
      [1, 10, 1, "yr", 0],
      [0, 5, 0.25, "% EV", 2],
      [0.5, 8, 0.25, "×", 2],
      [3, 20, 0.25, "%", 2],
      [0, 20, 1, "%/yr", 0],
    ]);
    expect(SLIDERS.map((s) => s.group)).toEqual([
      "Business",
      "Business",
      "Entry & exit",
      "Entry & exit",
      "Entry & exit",
      "Entry & exit",
      "Financing",
      "Financing",
      "Financing",
    ]);
    expect(SLIDERS.map((s) => s.jargon ?? null)).toEqual([null, null, "EV/EBITDA", "EV/EBITDA", null, null, "leverage", null, null]);
  });

  it("formats the scale ends in each row's own form and prints a value text for every row", () => {
    const s = Object.fromEntries(SLIDERS.map((d) => [d.key, d])) as Record<keyof LboRequest, (typeof SLIDERS)[number]>;
    expect([s.ebitda.format(10), s.ebitda.format(1000)]).toEqual(["$10M", "$1000M"]);
    expect([s.entry_multiple.format(3), s.exit_multiple.format(20), s.leverage_ratio.format(0.5)]).toEqual(["3.0×", "20.0×", "0.5×"]);
    expect([s.hold_period.format(1), s.hold_period.format(10)]).toEqual(["1", "10"]);
    expect([s.amortization_rate.format(0), s.amortization_rate.format(20)]).toEqual(["0%/yr", "20%/yr"]);
    expect([s.interest_rate.format(3), s.interest_rate.format(20)]).toEqual(["3%", "20%"]);
    for (const d of SLIDERS) {
      const v = d.valueText(BASE_REQ[d.key]);
      expect(v, d.key).toEqual(expect.any(String));
      expect(v, d.key).toMatch(/\d/);
      expect(v, d.key).not.toContain("—");
    }
  });
});

describe("dealWarnings (the three U14 sentences, verbatim)", () => {
  it("returns nothing at the defaults", () => {
    expect(dealWarnings(BASE_REQ)).toEqual([]);
  });

  it("leverage at the entry multiple: the equity-check sentence", () => {
    const w = dealWarnings({ ...BASE_REQ, leverage_ratio: 8 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(
      /^Leverage 8(?:\.0{1,2})?× meets or exceeds the 8(?:\.0{1,2})?× entry multiple: debt covers the whole purchase price and the equity check goes to zero or below\.$/,
    );
  });

  it("amortization over the hold retiring more than the original debt: the floor sentence", () => {
    const w = dealWarnings({ ...BASE_REQ, amortization_rate: 20, hold_period: 6 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^Amortizing 20(?:\.0)?%\/yr over 6 years retires more than 100% of the original debt; the schedule floors at zero\.$/);
  });

  it("an exit multiple far above entry: the multiple-expansion sentence", () => {
    const w = dealWarnings({ ...BASE_REQ, exit_multiple: 13 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^Exit multiple sits 5(?:\.0{1,2})?× above entry: most of the return is multiple expansion, not operating performance\.$/);
  });

  it("stacks all three when every trigger fires, and none carries an em-dash", () => {
    const w = dealWarnings({ ...BASE_REQ, leverage_ratio: 8, amortization_rate: 20, hold_period: 6, exit_multiple: 13 });
    expect(w).toHaveLength(3);
    expect(w.some((s) => s.includes("meets or exceeds"))).toBe(true);
    expect(w.some((s) => s.includes("retires more than 100%"))).toBe(true);
    expect(w.some((s) => s.includes("multiple expansion"))).toBe(true);
    for (const s of w) expect(s).not.toContain("—");
  });
});

describe("irrTone (the T3 ramp)", () => {
  it("bands at 14.9 / 15 / 19.9 / 20 and reads gray for nothing", () => {
    expect([14.9, 15, 19.9, 20].map((v) => irrTone(v))).toEqual(["gray", "amber", "amber", "mint"]);
    expect(irrTone(null)).toBe("gray");
    expect(irrTone(undefined)).toBe("gray");
    expect(irrTone(Number.NaN)).toBe("gray");
  });
});

describe("bridgeSteps (the six equity-bridge bars from served fields)", () => {
  const res = lboModel(BASE_REQ);
  const last = res.schedule[res.schedule.length - 1];

  it("returns six steps in the mockup's order whose first five sum to the served exit equity within $1M", () => {
    const steps = bridgeSteps(res, BASE_REQ);
    expect(steps).not.toBeNull();
    const s = steps as NonNullable<typeof steps>;
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.kind)).toEqual(["absolute", "delta", "delta", "delta", "delta", "absolute"]);
    expect(s.map((x) => x.label.join(" ").replace(/\s+/g, " ").trim().toLowerCase())).toEqual([
      "entry equity",
      "ebitda growth",
      "multiple change",
      "debt paydown",
      expect.stringMatching(/fees/),
      "exit equity",
    ]);
    expect(s[0].value).toBeCloseTo(res.entry_equity, 6);
    expect(s[1].value).toBeCloseTo((last.ebitda - BASE_REQ.ebitda) * BASE_REQ.entry_multiple, 6);
    expect(s[2].value).toBeCloseTo(last.ebitda * (BASE_REQ.exit_multiple - BASE_REQ.entry_multiple), 6);
    expect(s[3].value).toBeCloseTo(res.entry_debt - (res.exit_debt as number), 6);
    expect(s[4].value).toBeCloseTo(-(res.entry_equity + res.entry_debt - res.entry_ev), 6);
    expect(s[5].value).toBeCloseTo(res.exit_equity as number, 6);
    expect(s[1].value).toBeGreaterThan(0);
    expect(s[3].value).toBeGreaterThan(0);
    expect(s[4].value).toBeLessThan(0);
    const sum = s.slice(0, 5).reduce((a, x) => a + x.value, 0);
    expect(Math.abs(sum - (res.exit_equity as number))).toBeLessThan(1);
  });

  it("prints a zero multiple-change step when the multiples match, and the identity still holds", () => {
    const req = { ...BASE_REQ, exit_multiple: BASE_REQ.entry_multiple };
    const r = lboModel(req);
    const s = bridgeSteps(r, req) as NonNullable<ReturnType<typeof bridgeSteps>>;
    expect(s).toHaveLength(6);
    expect(s[2].value).toBe(0);
    const sum = s.slice(0, 5).reduce((a, x) => a + x.value, 0);
    expect(Math.abs(sum - (r.exit_equity as number))).toBeLessThan(1);
  });

  it("is null for a non-viable result on either branch, and for no result", () => {
    const entryReq = { ...BASE_REQ, leverage_ratio: 8 };
    const entryBranch = lboModel(entryReq);
    expect(entryBranch.viable).toBe(false);
    expect(entryBranch.schedule).toEqual([]);
    expect(bridgeSteps(entryBranch, entryReq)).toBeNull();
    const exitBranch: LboResult = { ...res, viable: false, error_msg: "Deal underwater at exit", exit_equity: -5, moic: null, irr: null };
    expect(bridgeSteps(exitBranch, BASE_REQ)).toBeNull();
    expect(bridgeSteps(undefined, BASE_REQ)).toBeNull();
  });
});

/* ── the hook ────────────────────────────────────────────────────────────── */

describe("useLboDeal (the deal state machine)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    posted.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds the deal at the clamped live rate, runs once at rest and serves the base and deal results from that one run", async () => {
    const { calls } = stubFetch(lboRoutes());
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.defaults.data).toEqual(LBO_DEFAULTS));
    expect(result.current.liveRate).toBe(LIVE_RATE);
    expect(result.current.clampedLive).toBe(LIVE_RATE);
    expect(result.current.inputs).toEqual(BASE_REQ);
    expect(result.current.baseInputs).toEqual(BASE_REQ);
    expect(result.current.overrides).toEqual({});
    expect(result.current.modified).toBe(false);
    expect(result.current.manualRate).toBe(false);
    expect(result.current.warnings).toEqual([]);
    await waitFor(() => expect(result.current.res?.viable).toBe(true));
    const expected = lboModel(BASE_REQ);
    expect(result.current.res).toEqual(expected);
    expect(result.current.baseRes).toEqual(expected);
    expect(result.current.sens?.entry_multiples).toHaveLength(5);
    expect(result.current.sens?.exit_multiples).toHaveLength(5);
    expect(result.current.sens?.entry_center).toBe(BASE_REQ.entry_multiple);
    // One POST at rest: the base run shares the deal run's key until something is modified.
    expect(runs(calls)).toHaveLength(1);
    expect(posted).toEqual([BASE_REQ]);
  });

  it("set() marks the deal modified, posts exactly once after the 300 ms debounce, moves the deal result and leaves the base result alone; reset() returns to the default deal without a third POST", async () => {
    const { calls } = stubFetch(lboRoutes());
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.res?.viable).toBe(true));
    const base = lboModel(BASE_REQ);
    act(() => result.current.set({ entry_multiple: 9 }));
    expect(result.current.modified).toBe(true);
    expect(result.current.overrides).toEqual({ entry_multiple: 9 });
    expect(result.current.inputs).toEqual({ ...BASE_REQ, entry_multiple: 9 });
    expect(result.current.baseInputs).toEqual(BASE_REQ);
    await waitFor(() => expect(runs(calls)).toHaveLength(2));
    expect(posted[1]).toEqual({ ...BASE_REQ, entry_multiple: 9 });
    const modified = lboModel({ ...BASE_REQ, entry_multiple: 9 });
    expect(modified.irr).not.toBe(base.irr);
    await waitFor(() => expect(result.current.res?.irr).toBe(modified.irr));
    expect(result.current.baseRes?.irr).toBe(base.irr);
    expect(result.current.sens?.entry_center).toBe(9);

    act(() => result.current.reset());
    expect(result.current.modified).toBe(false);
    expect(result.current.overrides).toEqual({});
    expect(result.current.inputs).toEqual(BASE_REQ);
    await waitFor(() => expect(result.current.res?.irr).toBe(base.irr));
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(runs(calls)).toHaveLength(2);
  });

  it("a rate moved off the live cost reads manual; moving it back reads tracking again", async () => {
    stubFetch(lboRoutes());
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.res?.viable).toBe(true));
    act(() => result.current.set({ interest_rate: 7.5 }));
    expect(result.current.manualRate).toBe(true);
    expect(result.current.modified).toBe(true);
    expect(result.current.inputs.interest_rate).toBe(7.5);
    expect(result.current.baseInputs.interest_rate).toBe(LIVE_RATE);
    act(() => result.current.set({ interest_rate: LIVE_RATE }));
    expect(result.current.manualRate).toBe(false);
  });

  it("warnings follow the inputs: leverage 8 on entry 8 raises the equity-check sentence; the defaults raise none", async () => {
    stubFetch(lboRoutes());
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.res?.viable).toBe(true));
    act(() => result.current.set({ leverage_ratio: 8 }));
    expect(result.current.warnings).toHaveLength(1);
    expect(result.current.warnings[0]).toContain("meets or exceeds");
    act(() => result.current.reset());
    expect(result.current.warnings).toEqual([]);
  });

  it("clamps a live rate above the model range to 20 and keeps the true rate", async () => {
    stubFetch(lboRoutes({ "/api/lbo/defaults": () => ({ ...LBO_DEFAULTS, lbo_all_in_rate: 22.4 }) }));
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.defaults.data?.lbo_all_in_rate).toBe(22.4));
    expect(result.current.liveRate).toBe(22.4);
    expect(result.current.clampedLive).toBe(20);
    expect(result.current.inputs.interest_rate).toBe(20);
    expect(result.current.baseInputs.interest_rate).toBe(20);
    expect(result.current.manualRate).toBe(false);
  });

  it("falls back to the stated 8.50% rate when the defaults route fails, and still runs the deal", async () => {
    stubFetch({ [RUN]: lboRun });
    const { result } = renderHook(() => useLboDeal(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.defaults.isError).toBe(true));
    expect(result.current.liveRate).toBeNull();
    expect(result.current.clampedLive).toBeNull();
    expect(result.current.inputs.interest_rate).toBe(STATED_RATE);
    expect(result.current.baseInputs.interest_rate).toBe(STATED_RATE);
    expect(result.current.manualRate).toBe(false);
    await waitFor(() => expect(posted.some((b) => b.interest_rate === STATED_RATE)).toBe(true));
    await waitFor(() => expect(result.current.res?.viable).toBe(true));
  });

  it("enabled=false disables both runs: the defaults load, the inputs are seeded, nothing is posted", async () => {
    const { calls } = stubFetch(lboRoutes());
    const { result } = renderHook(() => useLboDeal(false), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.defaults.data).toEqual(LBO_DEFAULTS));
    expect(result.current.inputs).toEqual(BASE_REQ);
    await act(() => new Promise<void>((r) => setTimeout(r, 500)));
    expect(runs(calls)).toHaveLength(0);
    expect(posted).toEqual([]);
    expect(result.current.res).toBeUndefined();
    expect(result.current.baseRes).toBeUndefined();
  });
});
