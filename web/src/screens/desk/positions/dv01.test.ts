/**
 * DV01 on the Position Monitor: the validation of DV01_SPEC.md revision 2, §9 (tolerances fixed in the
 * spec before any run). The bump-and-reprice checks use their own pricer, written from §4's price
 * functions with the cash flows, quantities and hedge weights held fixed during each bump; the production
 * code computes durations only from the closed forms.
 */
import { describe, expect, it } from "vitest";
import { checkedSpread, duration, dv01Number, dv01Of, hText, mvText, proxyKind, spreadFrom, spreadSizeHelp, TENOR_YEARS, type Dv01, type Leg } from "./dv01";
import { dv01Detail, dv01Words } from "./monitor";
import type { Levels } from "./monitor";
import { SPREADS, TENORS, type PositionRecord, type Subject, type Tenor } from "./store";

const BP = 1e-4;
const H = 0.5 * BP;

/** §4: price per 1 of face at yield x with the cash flows of the proxy struck at base yield y0 (held fixed). */
function price(tenor: Tenor, y0: number, x: number): number {
  if (tenor === "3m") return 1 / (1 + x * TENOR_YEARS["3m"]);
  const n = 2 * TENOR_YEARS[tenor];
  const c = y0 > 0 ? y0 : 0;
  let p = Math.pow(1 + x / 2, -n);
  for (let k = 1; k <= n; k++) p += (c / 2) * Math.pow(1 + x / 2, -k);
  return p;
}

/** Central difference of a fixed-cash-flow proxy: (P(y − ½bp) − P(y + ½bp)) / (1bp × P(y)). */
const bumped = (tenor: Tenor, y: number) => (price(tenor, y, y - H) - price(tenor, y, y + H)) / (BP * price(tenor, y, y));

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

const GRID = [-0.01, -0.005, -0.0001, 0, 0.0001, 0.005, 0.02, 0.04, 0.08, 0.15];

type Rec = Pick<PositionRecord, "subject" | "direction" | "size_nav" | "monitoring" | "trigger">;
function record(id: string, direction: "long" | "short", size: number | null, subject?: Subject, trigger: PositionRecord["trigger"] = null): Rec {
  return { subject: subject ?? { kind: "instrument", id }, direction, size_nav: size, monitoring: trigger ? "automatic" : "manual", trigger };
}

const day = "2026-11-03";
function levels(t: Partial<Record<Tenor, number>>, dates: Partial<Record<Tenor, string>> = {}): Levels {
  const tenors: Levels["tenors"] = {};
  for (const k of TENORS) if (t[k] !== undefined) tenors[k] = { value: t[k] as number, date: dates[k] ?? day };
  return { spx: null, curve: null, tenors };
}

describe("V1: analytic controls (1e-6 absolute)", () => {
  it.each([
    ["10y", 0.04, 8.175717],
    ["2y", 0.04, 1.903864],
    ["3m", 0.04, 0.247525],
    ["10y", -0.005, 10.025063],
    ["3m", -0.005, 0.250313],
  ] as const)("%s at %s gives D = %s", (tenor, y, d) => {
    expect(Math.abs(duration(tenor, y) - d)).toBeLessThan(1e-6);
  });
  it.each(TENORS.map((t) => [t]))("y = 0 gives D = T for %s", (t) => {
    const T = TENOR_YEARS[t];
    expect(Math.abs(duration(t, 0) - T)).toBeLessThan(1e-6);
  });
  it("the 3m bill is simple-interest bond-equivalent, not compounded (revision 1's 0.2451 corrected)", () => {
    expect(duration("3m", 0.04)).toBeCloseTo(0.25 / 1.01, 12);
    expect(proxyKind("3m", 0.04)).toBe("bill");
    expect(proxyKind("10y", 0.04)).toBe("par");
    expect(proxyKind("10y", 0)).toBe("zero");
    expect(proxyKind("10y", -0.005)).toBe("zero");
  });
});

describe("V2: bump-and-reprice with fixed cash flows (1e-6 relative)", () => {
  for (const t of TENORS)
    it.each(GRID.map((y) => [y]))(`${t} at y = %s`, (y) => {
      expect(rel(duration(t, y), bumped(t, y))).toBeLessThan(1e-6);
    });
});

describe("V3: near zero, against independent references (1e-9 relative), no NaN, Infinity or zero", () => {
  const ys = [1e-7, -1e-7, 1e-9, -1e-9, 1e-12, -1e-12, 5e-324, -5e-324, 1e-8 * (1 + 1e-12), 1e-8 * (1 - 1e-12)];
  for (const t of TENORS) {
    const T = TENOR_YEARS[t];
    it.each(ys.map((y) => [y]))(`${t} at y = %s`, (y) => {
      const ref = t === "3m" ? T * (1 - T * y) : y > 0 ? T - (T * (2 * T + 1) * y) / 4 : T * (1 - y / 2);
      const d = duration(t, y);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).not.toBe(0);
      expect(rel(d, ref)).toBeLessThan(1e-9);
    });
  }
  it("y = 5e-324 does not return 0 (y/2 underflows: design review DR-02)", () => {
    expect(5e-324 / 2).toBe(0);
    expect(duration("30y", 5e-324)).toBe(30);
  });
});

describe("V3b: a tiny positive size never shows 0", () => {
  const L = levels({ "10y": 4.12 });
  it("long the yield: +<0.000001", () => {
    const v = dv01Of(record("yield_10y", "long", 5e-324), L);
    expect(v.kind).toBe("yield");
    if (v.kind === "yield") expect(dv01Number(v.dv01, v.size)).toBe("+<0.000001");
  });
  it("short the yield: −<0.000001", () => {
    const v = dv01Of(record("yield_10y", "short", 5e-324), L);
    if (v.kind === "yield") expect(dv01Number(v.dv01, v.size)).toBe("−<0.000001");
    else throw new Error(v.kind);
  });
  it("a size of 0 shows 0", () => {
    const v = dv01Of(record("yield_10y", "long", 0), L);
    if (v.kind === "yield") expect(dv01Number(v.dv01, v.size)).toBe("0");
    else throw new Error(v.kind);
  });
});

/** The P&L of fixed leg quantities (face) for yield moves (dS, dL), in fraction of NAV; a ±½ bp central
 * difference of it is the change per 1 bp, so ×100 is % NAV per bp. */
function spreadPnl(v: Extract<Dv01, { kind: "spread" }>, dS: number, dL: number): number {
  const yS = v.short.yield_pct / 100;
  const yL = v.long.yield_pct / 100;
  const faceS = v.mv_short / price(v.short.tenor, yS, yS);
  const faceL = v.mv_long / price(v.long.tenor, yL, yL);
  return faceS * (price(v.short.tenor, yS, yS + dS) - price(v.short.tenor, yS, yS)) + faceL * (price(v.long.tenor, yL, yL + dL) - price(v.long.tenor, yL, yL));
}

function spreadAt(name: string, yS: number, yL: number, direction: "long" | "short" = "long", size = 0.05) {
  const s = SPREADS.find((x) => x.name === name)!;
  const v = dv01Of(record(`curve_${name}`, direction, size), levels({ [s.short]: yS * 100, [s.long]: yL * 100 }));
  if (v.kind !== "spread") throw new Error(`${name} ${yS} ${yL}: ${JSON.stringify(v)}`);
  return v;
}

describe("V4: spread legs bumped alone, quantities and hedge weight fixed (1e-6 relative)", () => {
  for (const s of SPREADS)
    it.each(GRID.map((y) => [y]))(`${s.name} at y = %s on both legs`, (y) => {
      const v = spreadAt(s.name, y, y + 0.002);
      const perBpL = (spreadPnl(v, 0, H) - spreadPnl(v, 0, -H)) * 100;
      const perBpS = (spreadPnl(v, H, 0) - spreadPnl(v, -H, 0)) * 100;
      expect(rel(perBpL, v.sens_long)).toBeLessThan(1e-6);
      expect(rel(perBpS, v.sens_short)).toBeLessThan(1e-6);
    });
});

describe("V5: parallel DV01 is zero to first order only", () => {
  for (const s of SPREADS)
    it(`${s.name}: central-difference parallel P&L per bp within 1e-6 × the spread DV01`, () => {
      const v = spreadAt(s.name, 0.04, 0.045);
      const parallel = (spreadPnl(v, H, H) - spreadPnl(v, -H, -H)) * 100;
      expect(Math.abs(parallel)).toBeLessThan(1e-6 * Math.abs(v.dv01));
    });
  it("a finite parallel shock of 25 bp gives a non-zero P&L", () => {
    const v = spreadAt("2s30s", 0.04, 0.045);
    expect(Math.abs(spreadPnl(v, 0.0025, 0.0025))).toBeGreaterThan(0);
  });
});

describe("V5b: domain and representability (DR-05 to DR-07)", () => {
  it.each([
    [-199.99999999999997, Number.MAX_VALUE],
    [-199.99, 4],
    [Number.MAX_VALUE, 0],
  ])("2y at %s%% and 30y at %s%% is refused as outside the domain", (a, b) => {
    const v = dv01Of(record("curve_2s30s", "long", 0.05), levels({ "2y": a, "30y": b }));
    expect(v).toEqual({ kind: "unknown", why: expect.stringContaining("outside the −5% to 50% range this proxy is defined for") });
  });
  it("−5% and 50% are accepted; −5.01% and 50.01% are refused", () => {
    expect(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": -5 })).kind).toBe("yield");
    expect(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": 50 })).kind).toBe("yield");
    expect(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": -5.01 })).kind).toBe("unknown");
    expect(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": 50.01 })).kind).toBe("unknown");
  });
  it("the §6 bounds hold at every corner of every pair", () => {
    const corners = [-0.05, 0.5];
    let dMin = Infinity, dMax = 0, hMin = Infinity, hMax = 0;
    for (const t of TENORS) for (const y of corners) { const d = duration(t, y); dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
    for (const s of SPREADS) for (const a of corners) for (const b of corners) { const h = duration(s.long, b) / duration(s.short, a); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
    expect(dMin.toPrecision(3)).toBe("0.222");
    expect(dMax.toPrecision(3)).toBe("30.8");
    expect(hMin.toPrecision(3)).toBe("0.195");
    expect(hMax.toPrecision(3)).toBe("138");
  });
  it("a spread of size 5e-324 whose legs underflow is refused", () => {
    const v = dv01Of(record("curve_10s30s", "long", 5e-324), levels({ "10y": -5, "30y": 50 }));
    expect(v).toEqual({ kind: "unknown", why: "the hedge cannot be represented at these yields" });
  });
  it("every V2-grid yield passes the netting check", () => {
    for (const s of SPREADS) for (const y of GRID) expect(spreadAt(s.name, y, y).kind).toBe("spread");
  });
  it("the representability check refuses an underflowed exposure when called directly", () => {
    const leg = (tenor: Tenor, d: number): Leg => ({ tenor, yield_pct: 4, date: day, proxy: "par", duration: d });
    const ok = spreadFrom("2s10s", 0.05, 1, leg("2y", 1.9), leg("10y", 8.1));
    if (ok.kind !== "spread") throw new Error(ok.kind);
    expect(checkedSpread({ ...ok, mv_short: 0 })).toEqual({ kind: "unknown", why: "the hedge cannot be represented at these yields" });
    expect(checkedSpread({ ...ok, sens_short: ok.sens_short * 2 })).toEqual({ kind: "unknown", why: "the hedge cannot be represented at these yields" });
    expect(checkedSpread({ ...ok, gross: Number.MAX_VALUE })).toEqual({ kind: "unknown", why: "the hedge cannot be represented at these yields" });
  });
});

describe("V6: units and the worked examples", () => {
  it("§4.3: the 10y at 4.12%, 5% NAV, long the yield: +0.0041% NAV per bp (D = 8.1286)", () => {
    const v = dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": 4.12 }));
    if (v.kind !== "yield") throw new Error(v.kind);
    expect(v.leg.duration).toBeCloseTo(8.1286, 4);
    expect(dv01Number(v.dv01, v.size)).toBe("+0.0041");
  });
  it("§5: a 2s10s steepener, 5% NAV, 2y 4.20%, 10y 4.12%", () => {
    const v = spreadAt("2s10s", 0.042, 0.0412);
    expect(v.short.duration).toBeCloseTo(1.8993, 4);
    expect(hText(v.h)).toBe("4.28");
    expect(mvText(v.mv_short)).toBe("21.4%");
    expect(v.mv_short).toBeGreaterThan(0);
    expect(mvText(v.mv_long)).toBe("5.0%");
    expect(v.mv_long).toBeLessThan(0);
    expect(mvText(v.gross)).toBe("26.4%");
    expect(dv01Number(v.sens_short, v.size)).toBe("−0.0041");
    expect(dv01Number(v.sens_long, v.size)).toBe("+0.0041");
    expect(dv01Number(v.dv01, v.size)).toBe("+0.0041");
  });
  it("the size is read as a fraction and the yield as percent", () => {
    const v = dv01Of(record("yield_2y", "long", 0.05), levels({ "2y": 4 }));
    if (v.kind !== "yield") throw new Error(v.kind);
    expect(v.dv01).toBeCloseTo(0.05 * duration("2y", 0.04) * 0.01, 15);
  });
  it("number formats: 2 significant figures, never scientific", () => {
    expect(dv01Number(0.0001, 1)).toBe("+0.00010");
    expect(dv01Number(-0.31, 1)).toBe("−0.31");
    expect(dv01Number(0.0000015, 1)).toBe("+0.0000015");
    expect(dv01Number(1234.4, 1)).toBe("+1,234");
    expect(mvText(0.0004)).toBe("<0.1%");
    expect(mvText(14)).toBe("1,400.0%");
    expect(hText(0.0004)).toBe("<0.01");
  });
});

describe("V7: signs", () => {
  const L = levels({ "2y": 4.2, "10y": 4.12 });
  it("long the yield is +, short is −", () => {
    const a = dv01Of(record("yield_10y", "long", 0.05), L);
    const b = dv01Of(record("yield_10y", "short", 0.05), L);
    expect(a.kind === "yield" && a.dv01 > 0).toBe(true);
    expect(b.kind === "yield" && b.dv01 < 0).toBe(true);
  });
  it("steepener +, flattener −, legs as §5", () => {
    const st = spreadAt("2s10s", 0.042, 0.0412, "long");
    const fl = spreadAt("2s10s", 0.042, 0.0412, "short");
    expect(st.dv01).toBeGreaterThan(0);
    expect(fl.dv01).toBeLessThan(0);
    expect([Math.sign(st.mv_short), Math.sign(st.mv_long), Math.sign(st.sens_short), Math.sign(st.sens_long)]).toEqual([1, -1, -1, 1]);
    expect([Math.sign(fl.mv_short), Math.sign(fl.mv_long), Math.sign(fl.sens_short), Math.sign(fl.sens_long)]).toEqual([-1, 1, 1, -1]);
  });
});

describe("V8: refusals", () => {
  const L = levels({ "2y": 4.2, "10y": 4.12 });
  it("no size", () => expect(dv01Of(record("yield_10y", "long", null), L)).toEqual({ kind: "unknown", why: "no size saved" }));
  it("a size that is not finite", () => expect(dv01Of(record("yield_10y", "long", Number.NaN), L)).toEqual({ kind: "unknown", why: "the size is not a share of NAV from 0 to 100%" }));
  it("a yield that is not finite", () => expect(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": Number.POSITIVE_INFINITY })).kind).toBe("unknown"));
  it("a tenor not served", () => expect(dv01Of(record("yield_30y", "long", 0.05), L)).toEqual({ kind: "unknown", why: "the 30y yield is not served" }));
  it("legs on different dates", () =>
    expect(dv01Of(record("curve_2s10s", "long", 0.05), levels({ "2y": 4.2, "10y": 4.12 }, { "2y": "2026-11-02" }))).toEqual({ kind: "unknown", why: "the legs are not served on the same date" }));
  it.each(["AGG", "IEF", "LQD", "HYG", "TLT"])("bond ETF %s is unknown", (sym) =>
    expect(dv01Of(record(sym, "long", 0.05), L)).toEqual({ kind: "unknown", why: "the fund's duration is not stored" }));
  it.each(["spx", "QQQ", "NVDA", "NDX vs SPX"])("%s is not modelled", (id) => expect(dv01Of(record(id, "long", 0.05), L)).toEqual({ kind: "not_modelled" }));
});

describe("V8b: classification from the structured record (DR-03)", () => {
  const L = levels({ "10y": 4.12 });
  it("a manual 10y yield (custom falsifier, no trigger, subject yield_10y) gets a DV01", () => {
    expect(dv01Of(record("yield_10y", "long", 0.05), L).kind).toBe("yield");
  });
  it("a record saved before P1c with subject id '10y yield' gets one too", () => {
    expect(dv01Of(record("10y yield", "long", 0.05), L).kind).toBe("yield");
  });
  it.each([
    ["a basket", { kind: "basket", legs: [{ symbol: "TLT", weight: 1 }], benchmark: null }],
    ["an option", { kind: "option", symbol: "TLT" }],
  ])("%s named '10y yield' or 'TLT' is not modelled", (_, subject) => {
    expect(dv01Of(record("10y yield", "long", 0.05, subject as unknown as Subject), L)).toEqual({ kind: "not_modelled" });
  });
  const study = { kind: "study", question: { shock: "curve_2s10s" } } as unknown as Subject;
  const trig = (series: string) => ({ series, operator: "below", threshold: 15, policy: "frozen", observed_on: day }) as unknown as PositionRecord["trigger"];
  it("a study record monitored automatically on curve_2s10s gets a spread DV01", () => {
    expect(dv01Of(record("2s10s", "long", 0.02, study, trig("curve_2s10s")), levels({ "2y": 4.2, "10y": 4.12 })).kind).toBe("spread");
  });
  it("a study record monitored by hand, or automatically on spx, is not modelled, whatever its instrument text", () => {
    expect(dv01Of(record("10y yield", "long", 0.02, study), L)).toEqual({ kind: "not_modelled" });
    expect(dv01Of(record("2s10s", "long", 0.02, study, trig("spx")), L)).toEqual({ kind: "not_modelled" });
  });
  it("an instrument subject 'tlt' is unknown", () => {
    expect(dv01Of(record("tlt", "long", 0.05), L)).toEqual({ kind: "unknown", why: "the fund's duration is not stored" });
  });
});

describe("V9b to V9d: words and dates", () => {
  it("V9c: an observation keeps its own year and date, never today's (DR-09, DR-11)", () => {
    const v = dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": 4.12 }, { "10y": "2025-11-03" }));
    expect(dv01Detail(v)![0]).toContain("priced at the 10y yield 4.12% on Nov 3, 2025.");
    const fri = dv01Of(record("yield_2y", "long", 0.05), levels({ "2y": 4.2 }, { "2y": "2026-10-30" }));
    expect(dv01Detail(fri)![0]).toContain("on Oct 30, 2026");
  });
  it("the proxy's words follow its kind: zero-coupon at or below 0, the bill for 3m", () => {
    expect(dv01Detail(dv01Of(record("yield_10y", "long", 0.05), levels({ "10y": -0.5 })))![0]).toContain("constant-maturity zero-coupon Treasury proxy");
    expect(dv01Detail(dv01Of(record("yield_3m", "long", 0.05), levels({ "3m": 4 })))![0]).toContain("constant-maturity bill (simple-interest bond-equivalent yield) proxy");
  });
  it("the size line's words for each outcome", () => {
    expect(dv01Words({ kind: "loading" })).toBe("DV01 loading");
    expect(dv01Words({ kind: "not_modelled" })).toBe("rate sensitivity not modelled here");
    expect(dv01Words({ kind: "unknown", why: "no size saved" })).toBe("DV01 unknown: no size saved");
  });
  it("request state (DR-10): loading and failed are said as such, before any tenor check", () => {
    expect(dv01Of(record("yield_10y", "long", 0.05), { ...levels({}), rates: "loading" })).toEqual({ kind: "loading" });
    expect(dv01Of(record("yield_10y", "long", 0.05), { ...levels({}), rates: "failed" })).toEqual({ kind: "unknown", why: "the yields could not be loaded" });
    // A bond ETF or an equity needs no yields: its words do not wait on /macro.
    expect(dv01Of(record("TLT", "long", 0.05), { ...levels({}), rates: "loading" })).toEqual({ kind: "unknown", why: "the fund's duration is not stored" });
  });
  it("V9d: the form's help classifies the position as Save would (DR-13), and refuses a multiple the row would (DR-12, DR-14)", () => {
    const L = levels({ "2y": 4.2, "10y": 4.12 });
    const inst = { subject: { kind: "instrument", id: "curve_2s10s" } as Subject, monitoring: "manual" as const, trigger: null };
    expect(spreadSizeHelp(inst, L)).toBe("For a spread, the size is the market value of the 10y leg. The 2y leg is sized to offset its DV01, so both legs together come to about 5.3 times the size at the yields served for Nov 3, 2026.");
    const study = { kind: "study", question: { shock: "curve_2s10s" } } as unknown as Subject;
    expect(spreadSizeHelp({ subject: study, monitoring: "manual", trigger: null }, L)).toBeNull();
    expect(spreadSizeHelp({ subject: study, monitoring: "automatic", trigger: { series: "curve_2s10s" } }, L)).toContain("about 5.3 times");
    expect(spreadSizeHelp({ ...inst, subject: { kind: "instrument", id: "yield_10y" } }, L)).toBeNull();
    expect(spreadSizeHelp(inst, levels({ "2y": 4.2, "10y": 4.12 }, { "2y": "2026-11-02" }))).toBe("For a spread, the size is the market value of the 10y leg. The 2y leg is sized to offset its DV01; the combined exposure cannot be estimated from the currently served yields.");
  });
});
