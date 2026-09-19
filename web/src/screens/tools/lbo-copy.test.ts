/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 2,
 * `tools/lbo-copy.test.ts`: the pure hero copy (`lboHero`, C.1 rules 1 to 7)
 * and the FRED strip (`lboStrip`, the six B.2 states). No React: the query
 * objects are minimal fakes cast to the LboDeal `defaults` shape, the results
 * come from the fixture model (./__fixtures__/lbo.ts) and the clock is frozen
 * (only `Date`) so the freshness states never depend on when the suite runs.
 * Never the mockup's numbers: every figure is computed from the fixture deal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LboDefaults, LboResult } from "../../api/types";
import { ApiError } from "../../api/client";
import { componentAsOf, isStatedDefault, lboHero, lboStrip } from "./lbo-copy";
import type { LboDeal } from "./lbo-deal";
import { HERO_GLOW_DEFAULT } from "../shared/TabHero";
import { fmtDate } from "../../lib/format";
import { BASE_REQ, LBO_DEFAULTS, LBO_DEFAULTS_B3, LBO_DEFAULTS_B3_UNKNOWN, LBO_DEFAULTS_FALLBACK, LBO_DEFAULTS_STATED, LIVE_RATE, NOW, lboModel } from "./__fixtures__/lbo";

type Defaults = LboDeal["defaults"];

/** A minimal query object in the shape the copy reads (data / isLoading / isError). */
function q(o: { data?: LboDefaults; isLoading?: boolean; isError?: boolean } = {}): Defaults {
  const isLoading = Boolean(o.isLoading);
  const isError = Boolean(o.isError);
  return {
    data: o.data,
    isLoading,
    isPending: isLoading,
    isError,
    isSuccess: o.data != null && !isError,
    isFetching: isLoading,
    error: isError ? new Error("404 Not Found") : null,
    status: isLoading ? "pending" : isError ? "error" : "success",
  } as unknown as Defaults;
}

const BASE_RES = lboModel(BASE_REQ);
const LOWER_RES = lboModel({ ...BASE_REQ, entry_multiple: 9 }); // a pricier entry: lower IRR than the default deal
const HIGHER_RES = lboModel({ ...BASE_REQ, exit_multiple: 10 }); // a richer exit: higher IRR
const NOT_VIABLE_RES = lboModel({ ...BASE_REQ, leverage_ratio: 8 });
const withIrr = (irr: number): LboResult => ({ ...BASE_RES, irr });

const LEDE_FIRST = "A $100M EBITDA business bought at 8.00× with 4.50× leverage, growing 5.0% a year and exiting at 9.00× after 5 years.";
const LEDE_T5 =
  "Every assumption can be typed exactly or dragged; the schedule and the entry × exit sensitivity grid rerun on each change. The classic private-equity hurdle is 20% IRR; green cells in the grid clear it.";

function args(over: Partial<Parameters<typeof lboHero>[0]> = {}): Parameters<typeof lboHero>[0] {
  return {
    defaults: q({ data: LBO_DEFAULTS }),
    clampedLive: LIVE_RATE,
    baseInputs: BASE_REQ,
    baseRes: BASE_RES,
    res: BASE_RES,
    modified: false,
    runPending: false,
    ...over,
  };
}

const sign = (d: number) => (d >= 0 ? "+" : "");
/** toFixed prints the ASCII hyphen; a Unicode minus in the copy is accepted too. */
const asciiMinus = (s: string | null | undefined) => (s ?? "").replace(/−/g, "-");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lboHero (checklist 09 C.1)", () => {
  it("rule 1: the headline is the default deal's IRR and the pill its MOIC; the eyebrow reads LBO calculator", () => {
    const copy = lboHero(args());
    expect(copy.eyebrow).toBe("LBO calculator");
    expect(copy.headline).toBe(`${(BASE_RES.irr as number).toFixed(1)}% IRR`);
    expect(copy.headline).toMatch(/^\d+\.\d% IRR$/);
    expect(copy.pill).toBe(`${(BASE_RES.moic as number).toFixed(2)}× MOIC`);
    expect(copy.pill).toMatch(/^\d\.\d\d× MOIC$/);
  });

  it("rule 1: nothing but the note prints the modified deal's IRR", () => {
    const copy = lboHero(args({ res: LOWER_RES, modified: true }));
    expect(copy.headline).toBe(`${(BASE_RES.irr as number).toFixed(1)}% IRR`);
    expect(copy.pill).toBe(`${(BASE_RES.moic as number).toFixed(2)}× MOIC`);
    expect(copy.subhead).not.toContain(`${(LOWER_RES.irr as number).toFixed(1)}%`);
    expect(copy.lede).not.toContain(`${(LOWER_RES.irr as number).toFixed(1)}%`);
    expect(copy.footnote).not.toContain(`${(LOWER_RES.irr as number).toFixed(1)}%`);
  });

  it("rule 2: pill tone and glow follow the IRR band (20 and above mint, 15 to 20 amber, below 15 gray)", () => {
    const mint = lboHero(args({ baseRes: withIrr(22.4) }));
    expect(mint.pillTone).toBe("mint");
    expect(mint.glow).toBe(HERO_GLOW_DEFAULT);
    const amber = lboHero(args({ baseRes: withIrr(17.5) }));
    expect(amber.pillTone).toBe("amber");
    expect(amber.glow).toBe("rgba(245,181,46,.06)");
    const gray = lboHero(args({ baseRes: withIrr(12.1) }));
    expect(gray.pillTone).toBe("gray");
    expect(gray.glow).toBe("rgba(200,210,220,.05)");
    expect(lboHero(args({ baseRes: withIrr(15) })).pillTone).toBe("amber");
    expect(lboHero(args({ baseRes: withIrr(20) })).pillTone).toBe("mint");
  });

  // Iteration 1 E1: the all-in rate is Fed funds (a monthly average) plus the
  // daily HY spread; the subhead names its parts and never says "today's" or
  // "live", and the engine's stated default reads as a stated default.
  it("rule 3: the subhead states the clamped all-in rate and its parts, the stated default when the payload is one, the stated 8.50% fallback when no rate is on file, and never moves with the slider", () => {
    expect(lboHero(args()).subhead).toBe("The default deal at a 6.98% all-in rate: Fed funds plus the HY spread.");
    expect(lboHero(args({ clampedLive: 20 })).subhead).toBe("The default deal at a 20.00% all-in rate: Fed funds plus the HY spread.");
    expect(lboHero(args({ clampedLive: 8.6, statedDefault: true })).subhead).toBe("The default deal at the stated 8.60% default rate.");
    expect(lboHero(args({ clampedLive: null })).subhead).toBe("The default deal at the stated 8.50% fallback rate.");
    const moved = lboHero(args({ res: LOWER_RES, modified: true }));
    expect(moved.subhead).toBe("The default deal at a 6.98% all-in rate: Fed funds plus the HY spread.");
    for (const a of [args(), args({ clampedLive: 20 }), args({ clampedLive: 8.6, statedDefault: true })]) expect(lboHero(a).subhead).not.toMatch(/today|live|current/i);
  });

  it("rule 4: the lede is the BASE_INPUTS sentence followed by T5 verbatim, with no figure from a run", () => {
    const { lede } = lboHero(args());
    expect(lede.startsWith(LEDE_FIRST)).toBe(true);
    expect(lede.endsWith(LEDE_T5)).toBe(true);
    expect(lede).toBe(`${LEDE_FIRST} ${LEDE_T5}`);
    expect(lede).toContain("20% IRR");
    expect(lede).not.toContain(`${(BASE_RES.irr as number).toFixed(1)}%`);
    expect(lede).not.toContain("50 bp");
    expect(lede).not.toContain("—");
  });

  it("rule 5: the footnote is the T3 badge sentence for the default deal's band", () => {
    expect(lboHero(args({ baseRes: withIrr(22.4) })).footnote).toBe("Clears the 20% PE bar");
    expect(lboHero(args({ baseRes: withIrr(17.5) })).footnote).toBe("Below the 20% bar · above 15%");
    expect(lboHero(args({ baseRes: withIrr(12.1) })).footnote).toBe("Below 15%");
  });

  it("rule 6: no note at rest; the modified-deal note in its three forms", () => {
    expect(lboHero(args()).note ?? null).toBeNull();
    expect(lboHero(args({ res: LOWER_RES, modified: false })).note ?? null).toBeNull();

    const lower = lboHero(args({ res: LOWER_RES, modified: true }));
    const dLower = (LOWER_RES.irr as number) - (BASE_RES.irr as number);
    expect(dLower).toBeLessThan(0);
    expect(asciiMinus(lower.note)).toBe(
      `Your modified deal: ${(LOWER_RES.irr as number).toFixed(1)}% IRR · ${(LOWER_RES.moic as number).toFixed(2)}× MOIC · ${sign(dLower)}${dLower.toFixed(1)} pp vs the default, in Outputs below.`,
    );

    const higher = lboHero(args({ res: HIGHER_RES, modified: true }));
    const dHigher = (HIGHER_RES.irr as number) - (BASE_RES.irr as number);
    expect(dHigher).toBeGreaterThan(0);
    expect(higher.note).toBe(
      `Your modified deal: ${(HIGHER_RES.irr as number).toFixed(1)}% IRR · ${(HIGHER_RES.moic as number).toFixed(2)}× MOIC · +${dHigher.toFixed(1)} pp vs the default, in Outputs below.`,
    );

    expect(lboHero(args({ res: NOT_VIABLE_RES, modified: true })).note).toBe("Your modified deal is not viable at these assumptions; see Outputs.");
    expect(lboHero(args({ res: undefined, modified: true, runPending: true })).note).toBe("Rerunning your modified deal…");
  });

  it("rule 7: the loading and error headlines", () => {
    const loading = lboHero(args({ defaults: q({ isLoading: true }), clampedLive: null, baseRes: undefined, res: undefined, runPending: true }));
    expect(loading.headline).toBe("Running the default deal…");
    expect(loading.pill ?? null).toBeNull();

    const baseRunning = lboHero(args({ baseRes: undefined, res: undefined, runPending: true }));
    expect(baseRunning.headline).toBe("Running the default deal…");

    const noRate = lboHero(args({ defaults: q({ isError: true }), clampedLive: null, baseRes: undefined, res: undefined }));
    expect(noRate.headline).toBe("Financing rate unavailable: the data service did not answer. The calculator falls back to the stated 8.50% rate.");
    expect(noRate.pill).toBe("Unavailable");
    expect(noRate.pillTone).toBe("gray");

    // The base run failed: the headline names it and the subhead carries LboRunState's sentence for that failure.
    const engineMissing = lboHero(args({ baseRes: undefined, res: undefined, runPending: false, baseError: new ApiError(503, "/api/lbo/run", "engine missing") }));
    expect(engineMissing.headline).toBe("Deal model unavailable");
    expect(engineMissing.subhead).toBe("The deal model is unavailable on this server (calculator engine not installed).");
    expect(engineMissing.pill ?? null).toBeNull();
    const unreachable = lboHero(args({ baseRes: undefined, res: undefined, runPending: false, baseError: new ApiError(0, "/api/lbo/run", "x", "unreachable") }));
    expect(unreachable.headline).toBe("Deal model unavailable");
    expect(unreachable.subhead).toBe("The data service did not answer; the deal model will rerun when it returns.");
  });

  it("no rendered sentence carries an em-dash", () => {
    for (const copy of [lboHero(args()), lboHero(args({ res: LOWER_RES, modified: true })), lboHero(args({ res: NOT_VIABLE_RES, modified: true }))]) {
      for (const v of [copy.eyebrow, copy.headline, copy.pill, copy.subhead, copy.lede, copy.footnote, copy.note]) {
        if (typeof v === "string") expect(v).not.toContain("—");
      }
    }
  });
});

describe("lboStrip (the FRED sync strip, checklist 09 B.2)", () => {
  it("loading: gray, Reading the FRED rate…", () => {
    expect(lboStrip(q({ isLoading: true }))).toMatchObject({ tone: "gray", title: "Reading the FRED rate…", detail: "Opens the data freshness breakdown" });
  });

  it("error with no data: gray, Rate feed unavailable, the stated-rate detail", () => {
    expect(lboStrip(q({ isError: true }))).toMatchObject({
      tone: "gray",
      title: "Rate feed unavailable",
      // Iteration 1 step 5 (G4): one status line.
      detail: "The stated 8.50% rate is in use",
    });
  });

  it("the unavailable payload (the engine's module fallback): gray, Rate feed unavailable, the FRED-rows detail", () => {
    expect(lboStrip(q({ data: LBO_DEFAULTS_FALLBACK }))).toMatchObject({
      tone: "gray",
      title: "Rate feed unavailable",
      detail: "No FRED rows · fallback rate in use",
    });
  });

  it("A3: a payload without a freshness block reads gray FRED rate · as of unknown with the stored-through detail (never a browser-judged age)", () => {
    expect(LBO_DEFAULTS.freshness).toBeUndefined();
    expect(lboStrip(q({ data: LBO_DEFAULTS }))).toEqual({
      tone: "gray",
      title: "FRED rate · as of unknown",
      detail: `Stored through ${fmtDate(LBO_DEFAULTS.data_as_of)}`,
    });
    expect(lboStrip(q({ data: LBO_DEFAULTS })).detail).toBe("Stored through Sep 01, 2026");
  });

  it("E1: a B3 stated-default payload (is_fallback) reads Rate feed unavailable even with a dated data_as_of", () => {
    expect(isStatedDefault(LBO_DEFAULTS_STATED)).toBe(true);
    expect(isStatedDefault(LBO_DEFAULTS_FALLBACK)).toBe(true);
    expect(isStatedDefault(LBO_DEFAULTS)).toBe(false);
    expect(isStatedDefault(LBO_DEFAULTS_B3)).toBe(false);
    expect(lboStrip(q({ data: LBO_DEFAULTS_STATED }))).toMatchObject({ tone: "gray", title: "Rate feed unavailable", detail: "No FRED rows · fallback rate in use" });
  });

  it("E1: a B3 payload reads the rate's served state and each component's as-of word (never the month stamp)", () => {
    expect(lboStrip(q({ data: LBO_DEFAULTS_B3 }))).toEqual({ tone: "mint", title: "Rate synced from FRED", detail: "Fed Aug 2026 print · HY Sep 17" });
    expect(lboStrip(q({ data: LBO_DEFAULTS_B3_UNKNOWN }))).toEqual({ tone: "gray", title: "FRED rate · as of unknown", detail: "HY spread As of unknown" });
    expect(componentAsOf(LBO_DEFAULTS_B3).hy.word).toBe("Sep 17");
    expect(componentAsOf(LBO_DEFAULTS).hy.word).toBe("As of unknown");
  });

  it("A3: an older stored stamp without a block reads the same gray words; the age is never judged in the browser", () => {
    for (const stamp of ["2026-07-10", "2026-05-01"]) {
      const data = { ...LBO_DEFAULTS, data_as_of: stamp };
      expect(lboStrip(q({ data }))).toMatchObject({ tone: "gray", title: "FRED rate · as of unknown", detail: `Stored through ${fmtDate(stamp)}` });
    }
  });
});

/* ── CP4 (Iteration 1 step 5): the calculator names itself as missing ─────── */

describe("lboHero and lboStrip: CP4 missing-calculator wording", () => {
  it("the rate and the default deal both unanswered: the hero names the LBO calculator; a snapshot session says it is not in the snapshot", () => {
    const unreachable = new ApiError(0, "/api/lbo/run", "The data service is unreachable.", "unreachable", true);
    const down = lboHero(args({ defaults: q({ isError: true }), clampedLive: null, baseRes: undefined, res: undefined, baseError: unreachable }));
    expect(down.headline).toBe("LBO calculator unavailable: the data service did not answer.");
    expect(down.pill).toBe("Unavailable");
    const snap = lboHero(args({ defaults: q({ isError: true }), clampedLive: null, baseRes: undefined, res: undefined, snapshot: true }));
    expect(snap.headline).toBe("The LBO calculator runs on the server; it is not available in this snapshot.");
    // A snapshot session with the rate on hand keeps the run-error subhead in snapshot words.
    const run = lboHero(args({ baseRes: undefined, res: undefined, runPending: false, baseError: unreachable, snapshot: true }));
    expect(run.subhead).toBe("The LBO calculator runs on the server; it is not available in this snapshot.");
    // The rate alone missing (the deal still pending) keeps the rate-error headline.
    const rateOnly = lboHero(args({ defaults: q({ isError: true }), clampedLive: null, baseRes: undefined, res: undefined }));
    expect(rateOnly.headline).toBe("Financing rate unavailable: the data service did not answer. The calculator falls back to the stated 8.50% rate.");
  });

  it("the strip says the rate feed is not in the snapshot", () => {
    expect(lboStrip(q({ isError: true }), true)).toMatchObject({ tone: "gray", title: "Rate feed not in this snapshot", detail: "The rate is read on the server" });
    expect(lboStrip(q({ isError: true })).title).toBe("Rate feed unavailable");
  });
});
