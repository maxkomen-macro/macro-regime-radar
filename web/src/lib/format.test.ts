/**
 * Iteration 1, Step 6 (accuracy), A4 "Units and bounds"
 * (docs/redesign-v2/ITERATION_1.md): unit tests for the bps / percent
 * conversion and for the bounds of anything labelled a share or a
 * probability (never above 100%, never below 0).
 *
 * Contract for web/src/lib/format.ts (the implementers add the helpers; this
 * file looks them up by name so the suite type-checks before they land):
 *
 *   pctToBps(pct)  percent points to basis points, numeric (2.65 → 265)
 *   bpsToPct(bps)  basis points to percent points, numeric (265 → 2.65)
 *   fmtProb(v, scale = "unit", dp = 0)
 *                  a probability or share: "unit" is a 0–1 fraction, "percent"
 *                  a 0–100 figure (the recession model). Whole percent under
 *                  the house rounding by default (Math.round: 0.116 → "12%");
 *                  anything outside its scale (and NaN / ±Infinity) renders
 *                  "—" (U+2014), never a clamped number.
 *   fmtWholePct    the older 0–1 whole-percent helper, now bounded the same way.
 *
 * Accepted aliases, first match wins: percentToBps; bpsToPercent;
 * fmtProbability, fmtShare. Display keeps the file header's rules: rates to
 * two decimals (fmtPct → "2.65%"), bps whole and signed (fmtBps → "+265 bps").
 *
 * The CCC-vs-distress-line figure is a ratio to a line, not a share (B2 in
 * the backend brief; `ccc_pct_of_distress_line` may exceed 100): the credit
 * tile must NOT route it through the probability formatter, so 107.6 still
 * renders "107.6%".
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import * as format from "./format";
import { fmtBps, fmtPct, fmtWholePct } from "./format";
import type { CreditMetrics, DatedValue } from "../api/types";
import { renderWithProviders } from "../test/utils";
import QualityLadder from "../screens/credit/QualityLadder";

// jsdom has no canvas: the ladder chart is replaced the way CreditScreen.test.tsx does it.
vi.mock("../screens/credit/SpreadLinesChart", () => ({
  default: () => createElement("div", { role: "img", "aria-label": "Quality ladder chart (stub)" }),
}));

const DASH = "—";

type NumFn = (v: number) => number;
type StrFn = (v: number) => string;
type ProbFn = (v: number, scale?: "unit" | "percent", dp?: number) => string;

/** The first exported function among `names`, or a stub that fails the test
 * naming the helper the contract expects. */
function helper<T>(names: string[]): T {
  const mod = format as unknown as Record<string, unknown>;
  const found = names.find((n) => typeof mod[n] === "function");
  if (found) return mod[found] as T;
  return ((..._args: unknown[]) => {
    throw new Error(`web/src/lib/format.ts exports none of ${names.join(" / ")} (A4 contract: ${names[0]})`);
  }) as unknown as T;
}

const pctToBps = helper<NumFn>(["pctToBps", "percentToBps"]);
const bpsToPct = helper<NumFn>(["bpsToPct", "bpsToPercent"]);
const fmtProb = helper<ProbFn>(["fmtProb", "fmtProbability", "fmtShare"]);
const fmtBpsLevel = helper<StrFn>(["fmtBpsLevel"]);

describe("A4 · bps and percent conversion", () => {
  it("exports the explicit conversion helpers", () => {
    const mod = format as unknown as Record<string, unknown>;
    expect(["pctToBps", "percentToBps"].some((n) => typeof mod[n] === "function"), "pctToBps (percent → bps)").toBe(true);
    expect(["bpsToPct", "bpsToPercent"].some((n) => typeof mod[n] === "function"), "bpsToPct (bps → percent)").toBe(true);
  });

  it.each([
    [2.65, 265],
    [0.78, 78],
    [0.8, 80],
    [4.12, 412],
    [10.76, 1076],
    [0, 0],
    [-0.35, -35],
    [-2.65, -265],
  ])("%s%% ↔ %s bps", (pct, bps) => {
    expect(pctToBps(pct)).toBeCloseTo(bps, 9);
    expect(bpsToPct(bps)).toBeCloseTo(pct, 9);
  });

  it("round-trips both ways without drift", () => {
    for (const pct of [2.65, 0.78, 0.01, 1.005, 3.333, 12.5, -0.35, -4.2, 0]) {
      expect(bpsToPct(pctToBps(pct)), `pct ${pct}`).toBeCloseTo(pct, 9);
    }
    for (const bps of [265, 78, 1, 0.5, 1076, -35, -265, 0]) {
      expect(pctToBps(bpsToPct(bps)), `bps ${bps}`).toBeCloseTo(bps, 9);
    }
  });

  it("keeps the house display rules through a conversion (rates 2 dp, bps whole and signed)", () => {
    expect(fmtBps(pctToBps(2.65))).toBe("+265 bps");
    expect(fmtBps(pctToBps(0.78))).toBe("+78 bps");
    expect(fmtBps(pctToBps(-0.35))).toMatch(/^[-−]35 bps$/);
    expect(fmtPct(bpsToPct(265))).toBe("2.65%");
    expect(fmtPct(bpsToPct(78))).toBe("0.78%");
    expect(fmtPct(bpsToPct(80))).toBe("0.80%");
    expect(fmtPct(bpsToPct(-35))).toMatch(/^[-−]0\.35%$/);
  });
});

describe("A4 · fmtBps sign and rounding", () => {
  it("prints a plus on widening, a minus on tightening, whole bps", () => {
    expect(fmtBps(52)).toBe("+52 bps");
    expect(fmtBps(12.4)).toBe("+12 bps");
    expect(fmtBps(12.6)).toBe("+13 bps");
    expect(fmtBps(-52)).toMatch(/^[-−]52 bps$/);
    expect(fmtBps(-12.6)).toMatch(/^[-−]13 bps$/);
  });

  it("never prints a signed zero", () => {
    for (const v of [0, 0.4, -0.4, -0]) {
      expect(fmtBps(v), `fmtBps(${Object.is(v, -0) ? "-0" : v})`).toBe("0 bps");
    }
  });

  it("always says bps, never the singular bp", () => {
    for (const v of [1, -1, 265, 0]) expect(fmtBps(v)).toMatch(/ bps$/);
  });

  it("a spread level prints unsigned and whole (fmtBpsLevel), converted from percent", () => {
    expect(fmtBpsLevel(265)).toBe("265 bps");
    expect(fmtBpsLevel(pctToBps(2.65))).toBe("265 bps");
    expect(fmtBpsLevel(pctToBps(0.78))).toBe("78 bps");
    expect(fmtBpsLevel(1076.4)).toBe("1076 bps");
  });
});

describe("A4 · probability and share formatter bounds", () => {
  // Out-of-range values warn in the console by design; keep the run quiet.
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("is exported", () => {
    const mod = format as unknown as Record<string, unknown>;
    expect(["fmtProb", "fmtProbability", "fmtShare"].some((n) => typeof mod[n] === "function"), "fmtProb (0–1 fraction → whole percent, '—' out of range)").toBe(true);
  });

  it("renders the in-range ends and the house rounding", () => {
    expect(fmtProb(0)).toBe("0%");
    expect(fmtProb(1)).toBe("100%");
    expect(fmtProb(0.116)).toBe("12%");
    expect(fmtProb(0.5)).toBe("50%");
    expect(fmtProb(0.6423)).toBe("64%");
    expect(fmtProb(0.004)).toBe("0%");
    expect(fmtProb(0.996)).toBe("100%");
  });

  it("renders the dash, never a clamped number, outside [0, 1]", () => {
    for (const v of [-0.01, 1.07, 1.0001, -1, 2, 107.6, -0.5]) {
      expect(fmtProb(v), `fmtProb(${v})`).toBe(DASH);
    }
  });

  it("on the percent scale: 0 and 100 are the ends, 11.63 → 12% (or 11.6% at 1 dp), past 100 or below 0 is the dash", () => {
    expect(fmtProb(0, "percent")).toBe("0%");
    expect(fmtProb(100, "percent")).toBe("100%");
    expect(fmtProb(11.63, "percent")).toBe("12%");
    expect(fmtProb(11.628, "percent", 1)).toBe("11.6%");
    for (const v of [107.6, 100.01, -0.1, -5]) expect(fmtProb(v, "percent"), `fmtProb(${v}, "percent")`).toBe(DASH);
  });

  it("fmtWholePct (odds, confidence) is bounded the same way", () => {
    expect(fmtWholePct(0)).toBe("0%");
    expect(fmtWholePct(1)).toBe("100%");
    expect(fmtWholePct(0.116)).toBe("12%");
    expect(fmtWholePct(-0.01)).toBe(DASH);
    expect(fmtWholePct(1.07)).toBe(DASH);
  });

  it("renders the dash for NaN and infinities", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fmtProb(v), `fmtProb(${v})`).toBe(DASH);
    }
  });

  it("never prints above 100% or below 0% across a sweep, and never dashes an in-range value", () => {
    for (let i = -200; i <= 200; i++) {
      const v = i / 100;
      const out = fmtProb(v);
      if (v >= 0 && v <= 1) {
        expect(out, `fmtProb(${v})`).toMatch(/^\d{1,3}%$/);
        const n = Number.parseInt(out, 10);
        expect(n, `fmtProb(${v})`).toBeGreaterThanOrEqual(0);
        expect(n, `fmtProb(${v})`).toBeLessThanOrEqual(100);
        expect(Math.abs(n - v * 100), `fmtProb(${v}) rounds to the nearest whole percent`).toBeLessThanOrEqual(0.5 + 1e-9);
      } else {
        expect(out, `fmtProb(${v})`).toBe(DASH);
      }
    }
  });
});

/* ── The CCC-vs-distress-line ratio is not a share ─────────────────────── */

function dated(n: number, base: number, step: number): DatedValue[] {
  const months = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].slice(-n);
  return months.map((date, i) => ({ date, value: base + i * step }));
}

/** Invented Sep 2026 spreads with CCC past the 1,000 bps line (107.6%). */
function ladderMetrics(over: Partial<CreditMetrics> = {}): CreditMetrics {
  return {
    hy_oas: 265,
    ig_oas: 80,
    ccc_oas: 1076,
    bb_oas: 150,
    b_oas: 290,
    hy_1w_change: 2,
    ig_1w_change: 0,
    ccc_1w_change: 12,
    bb_1w_change: -1,
    b_1w_change: 1,
    hy_ig_ratio: 3.31,
    ccc_pct_of_distress_line: 107.6,
    ccc_bps_vs_distress_line: 76,
    lbo_all_in_cost: "6.28%",
    credit_label: "Normal",
    credit_label_color: "#28d17c",
    hy_pct_rank: 10,
    ig_pct_rank: 15,
    hy_series: dated(6, 260, 1),
    ig_series: dated(6, 78, 0.4),
    data_as_of: "Sep 01, 2026",
    transition_3m: {},
    transition_6m: {},
    tight_count: 0,
    hy_sparkline: dated(6, 260, 1),
    ig_sparkline: dated(6, 78, 0.4),
    ccc_sparkline: dated(6, 1000, 15),
    bb_sparkline: dated(6, 152, -0.4),
    b_sparkline: dated(6, 285, 1),
    ...over,
  };
}

describe("A4 · the CCC-vs-distress-line ratio is not routed through the probability formatter", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("the probability formatter would dash it (it is not a share)", () => {
    expect(fmtProb(1.076)).toBe(DASH);
    expect(fmtProb(107.6, "percent")).toBe(DASH);
  });

  it("the Credit quality-ladder tile renders 107.6 as 107.6%", () => {
    renderWithProviders(createElement(QualityLadder, { m: ladderMetrics(), status: "ready" }), { route: "/app/credit" });
    const section = document.getElementById("quality-ladder");
    expect(section, "section#quality-ladder renders").not.toBeNull();
    const panel = within(section as HTMLElement);
    expect(panel.getAllByText((_, el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim() === "107.6%").length, "a value element reading exactly 107.6%").toBeGreaterThan(0);
    // The tile's own value is never the dash or a capped 100%.
    const label = panel.getByText(/CCC vs distress line/i);
    const tile = label.closest("article, section, div[style*='var(--r-tile)']") ?? label.parentElement;
    const tileText = (tile?.textContent ?? "").replace(/\s+/g, " ");
    expect(tileText).toContain("107.6%");
    expect(tileText).not.toMatch(/CCC vs distress line\s*—/);
    expect(screen.queryByText(/^100(\.0)?%$/), "no clamped 100% value").toBeNull();
  });

  it("an in-range reading still prints its one decimal, not a whole-percent share", () => {
    renderWithProviders(createElement(QualityLadder, { m: ladderMetrics({ ccc_oas: 580, ccc_pct_of_distress_line: 58, ccc_bps_vs_distress_line: -420 }), status: "ready" }), { route: "/app/credit" });
    const section = document.getElementById("quality-ladder") as HTMLElement;
    expect(within(section).getAllByText((_, el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim() === "58.0%").length).toBeGreaterThan(0);
  });
});
