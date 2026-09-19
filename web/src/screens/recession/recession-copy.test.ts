/**
 * Phase 7 checklist (docs/redesign-v2/checklists/07-recession.md) section E.1,
 * `screens/recession/recession-copy.test.ts`: the pure C.1 contracts of
 * `recession-copy.ts`. `headlineIndex` (exact match first, the date rule
 * second, -1 on an empty series), `priorPoint`, `riseStreak` at the display's
 * 0.1 resolution, the three tone maps, `heroCopy` (rules 1 to 6), the B.2
 * strip table through `stripSummary`, the two series slices and the feature
 * strings. Fixtures are invented monthly points dated Mar 2023 to Sep 2026
 * (the E.1 shape: the last five 10.2 / 10.7 / 11.1 / 11.6 / 10.0 with the
 * headline 11.6 on the Aug point and a partial Sep tail, a 45.0 spike in Jun
 * 2023, a 2s10s series of yearly points since 1996); the assertions are the
 * copy rules, never the mockup's or the baseline's figures.
 */
import { describe, expect, it } from "vitest";
import { bandRange, featureCurrent, featureLabel, headlineIndex, heroCopy, labelTone, lastMonths, lastYears, pillToneFor, priorPoint, riseStreak, stripSummary } from "./recession-copy";
import type { DatedValue, RecessionMetrics } from "../../api/types";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** The app's numeric placeholder glyph (a dash, not prose copy). */
const DASH = "—";
const TODAY = "2026-09-15";

/** Month-end ISO dates from `from` (YYYY-MM) to `to` inclusive, oldest first. */
function monthEnds(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let idx = fy * 12 + (fm - 1); idx <= ty * 12 + (tm - 1); idx++) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    // Day 0 of the following month is the last day of this one.
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
  }
  return out;
}
const pts = (...pairs: [string, number][]): DatedValue[] => pairs.map(([date, value]) => ({ date, value }));
function set(series: DatedValue[], date: string, value: number): void {
  const p = series.find((q) => q.date === date);
  if (!p) throw new Error(`fixture has no point on ${date}`);
  p.value = value;
}

/** Mar 2023 to Sep 2026 month-ends (the E.1 date range; it yields 43 points, the
 * checklist's "42" is a miscount). Filler values sit at 12.0 to 13.2, so the point
 * before May 2026 is a fall into 10.2 and the streak ending on the headline is
 * exactly three; nothing outside the tail equals the served 11.6; the whole 24M
 * window stays under 20 while the Jun 2023 spike lifts Full history past 40. */
const PROB_DATES = monthEnds("2023-03", "2026-09");
const TAIL: [string, number][] = [
  ["2026-05-31", 10.2],
  ["2026-06-30", 10.7],
  ["2026-07-31", 11.1],
  ["2026-08-31", 11.6],
  ["2026-09-30", 10.0],
];
function probSeries(tail: [string, number][] = TAIL): DatedValue[] {
  const s = PROB_DATES.map((date, i) => ({ date, value: 12 + (i % 4) * 0.4 }));
  set(s, "2023-06-30", 45);
  for (const [date, value] of tail) set(s, date, value);
  return s;
}
/** USREC 1 from Jun to Aug 2023: one NBER band. */
const usrec = (): DatedValue[] => PROB_DATES.map((date) => ({ date, value: date >= "2023-06-30" && date <= "2023-08-31" ? 1 : 0 }));

/** 31 yearly 2s10s points (Mar 1996 to Mar 2026) plus Sep 2026, in percent; a few
 * inverted years so the zero line falls inside every window. */
const YC_DATES = [...Array.from({ length: 31 }, (_, i) => `${1996 + i}-03-01`), "2026-09-01"];
const YC_INVERTED = new Set(["2000-03-01", "2006-03-01", "2007-03-01", "2019-03-01", "2022-03-01", "2023-03-01"]);
const ycSeries = (): DatedValue[] =>
  YC_DATES.map((date, i) => ({ date, value: date === "2026-09-01" ? 0.33 : YC_INVERTED.has(date) ? -(0.2 + (i % 3) * 0.15) : 0.4 + (i % 5) * 0.3 }));

function recessionFixture(over: Partial<RecessionMetrics> = {}): RecessionMetrics {
  return {
    probability_source: "recession_model",
    recession_prob: 11.6,
    recession_label: "Low Risk",
    recession_color: "#2ecc71",
    yield_curve_spread: 33,
    yield_curve_pct_rank: 33,
    inversion_duration_months: 0,
    is_inverted: false,
    divergence_score: -34,
    divergence_label: "Macro ahead of markets",
    divergence_color: "#3498db",
    recession_prob_series: probSeries(),
    yield_curve_series: ycSeries(),
    usrec_series: usrec(),
    n_training_samples: 281,
    model_features: ["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"],
    feature_coefficients: { yield_curve: 0.65, unemployment: -2.54, hy_spread: 2.58, indpro_yoy: 0.05, lei_proxy: -0.49 },
    data_as_of: "2026-09-01",
    curve_shape: { "1M": null, "3M": null, "6M": null, "1Y": null, "2Y": 4.63, "5Y": null, "10Y": 4.96, "30Y": null },
    current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: -0.03 },
    ...over,
  };
}
const BASE = recessionFixture();
/** The last four values equal (streak 0; the latest exact match is the Sep point). */
const FLAT = recessionFixture({ recession_prob_series: probSeries([["2026-06-30", 11.6], ["2026-07-31", 11.6], ["2026-08-31", 11.6], ["2026-09-30", 11.6]]) });
/** Three months back sat higher: the "down" subhead. */
const DOWN = recessionFixture({ recession_prob_series: probSeries([["2026-05-31", 13.0], ["2026-06-30", 12.5], ["2026-07-31", 12.0], ["2026-08-31", 11.6], ["2026-09-30", 10.0]]) });
/** Two rises then the headline (10.7 → 10.2 breaks the run): under the G3 threshold. */
const TWO_RISES = recessionFixture({ recession_prob_series: probSeries([["2026-05-31", 10.7], ["2026-06-30", 10.2], ["2026-07-31", 11.1], ["2026-08-31", 11.6], ["2026-09-30", 10.0]]) });
const SHORT_SERIES = pts(["2026-07-31", 11.0], ["2026-08-31", 11.6], ["2026-09-30", 10.0]);
const SHORT = recessionFixture({ recession_prob_series: SHORT_SERIES, usrec_series: SHORT_SERIES.map((p) => ({ date: p.date, value: 0 })) });
const EMPTY = recessionFixture({ recession_prob_series: [], usrec_series: [] });
const NULL_INPUT = recessionFixture({ current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: null } });

const READY = { isLoading: false, isError: false };
const LEDE_MATERIAL =
  "The logistic model scores twelve-month odds against a ~15% historical base rate; Elevated starts at 20%, High Risk at 40%. Macro ahead of markets: credit pricing and the model disagree. The divergence is material and requires judgment. This is the recession model's own probability, not the classifier's Recession Risk odds (the Regime context row).";
const LEDE_ALIGNED =
  "The logistic model scores twelve-month odds against a ~15% historical base rate; Elevated starts at 20%, High Risk at 40%. Aligned: credit pricing and the model tell one story. This is the recession model's own probability, not the classifier's Recession Risk odds (the Regime context row).";
const GLOW_MINT = "rgba(38,220,160,.07)";
const GLOW_AMBER = "rgba(245,181,46,.06)";
const GLOW_GRAY = "rgba(200,210,220,.05)";

const series = BASE.recession_prob_series;
const HEADLINE_I = series.length - 2; // 2026-08-31, the newest complete month before the partial Sep tail

const strings = (c: ReturnType<typeof heroCopy>): string[] => [c.headline, c.pill, c.subhead, c.ledeText, c.note, c.glow, ...c.footnote];

/* ── headlineIndex ───────────────────────────────────────────────────────── */

describe("headlineIndex (checklist 07 C.1)", () => {
  it("returns the largest point whose value equals the served probability: the Aug 2026 point, never the partial Sep tail", () => {
    const i = headlineIndex(series, 11.6);
    expect(i).toBe(HEADLINE_I);
    expect(series[i]).toEqual({ date: "2026-08-31", value: 11.6 });
    expect(i).not.toBe(series.length - 1);
    // The exact match wins even when a date rule would pick the tail.
    expect(headlineIndex(series, 11.6, "2026-12-31")).toBe(HEADLINE_I);
  });

  it("with a repeated value the latest exact match wins (the flat fixture anchors on Sep 2026)", () => {
    const flat = FLAT.recession_prob_series;
    expect(headlineIndex(flat, 11.6)).toBe(flat.length - 1);
    expect(flat[headlineIndex(flat, 11.6)].date).toBe("2026-09-30");
  });

  it("falls back to the last point dated on or before today when no value matches", () => {
    expect(headlineIndex(series, 12.34, TODAY)).toBe(HEADLINE_I); // Sep 30 is after Sep 15
    expect(headlineIndex(series, 12.34, "2026-09-30")).toBe(series.length - 1); // on the date counts
    expect(headlineIndex(series, 12.34, "2026-10-01")).toBe(series.length - 1);
    expect(headlineIndex(series, 12.34, "2026-07-31")).toBe(series.length - 3);
    expect(headlineIndex(series, null, TODAY)).toBe(HEADLINE_I);
  });

  it("falls back to the last point when nothing is dated on or before today, and returns -1 for an empty series", () => {
    expect(headlineIndex(series, 12.34, "2020-01-01")).toBe(series.length - 1);
    expect(headlineIndex([], 11.6)).toBe(-1);
    expect(headlineIndex([], null, TODAY)).toBe(-1);
  });
});

/* ── priorPoint and riseStreak ───────────────────────────────────────────── */

describe("priorPoint and riseStreak (checklist 07 C.1, B.2)", () => {
  it("priorPoint three back from the headline is May 2026; the short fixture and a negative index give null; back defaults to 3", () => {
    expect(priorPoint(series, HEADLINE_I, 3)).toEqual({ date: "2026-05-31", value: 10.2 });
    expect(priorPoint(series, HEADLINE_I)).toEqual({ date: "2026-05-31", value: 10.2 });
    expect(priorPoint(series, HEADLINE_I, 1)).toEqual({ date: "2026-07-31", value: 11.1 });
    expect(priorPoint(SHORT_SERIES, headlineIndex(SHORT_SERIES, 11.6), 3)).toBeNull();
    expect(priorPoint(series, 2, 3)).toBeNull();
    expect(priorPoint([], -1, 3)).toBeNull();
  });

  it("riseStreak counts three consecutive rises ending on the headline and zero on the flat fixture", () => {
    expect(riseStreak(series, HEADLINE_I)).toBe(3);
    const flat = FLAT.recession_prob_series;
    expect(riseStreak(flat, headlineIndex(flat, 11.6))).toBe(0);
    // A fall breaks the run: 10.7 → 10.2 → 11.1 → 11.6 counts two.
    const two = TWO_RISES.recession_prob_series;
    expect(riseStreak(two, headlineIndex(two, 11.6))).toBe(2);
    // The partial tail (a fall) and the first point both read zero.
    expect(riseStreak(series, series.length - 1)).toBe(0);
    expect(riseStreak(series, 0)).toBe(0);
  });

  it("compares at the display's 0.1 resolution: a 0.04 rise does not count, a 0.1 rise does", () => {
    expect(riseStreak(pts(["2026-07-31", 10.2], ["2026-08-31", 10.24]), 1)).toBe(0);
    expect(riseStreak(pts(["2026-07-31", 10.2], ["2026-08-31", 10.3]), 1)).toBe(1);
    expect(riseStreak(pts(["2026-06-30", 10.0], ["2026-07-31", 10.04], ["2026-08-31", 10.3]), 2)).toBe(1);
    expect(riseStreak(pts(["2026-06-30", 10.16], ["2026-07-31", 10.24], ["2026-08-31", 10.3]), 2)).toBe(1); // 10.2 → 10.2 → 10.3
  });
});

/* ── tone maps ───────────────────────────────────────────────────────────── */

describe("labelTone, pillToneFor, bandRange (checklist 07 C.1)", () => {
  it.each<[label: string, tone: string, pill: string, range: string]>([
    ["Low Risk", "clear", "mint", "under 20%"],
    ["Elevated", "watch", "amber", "20 to 40%"],
    ["High Risk", "alert", "amber", "40% and above"],
  ])("%s reads tone %s, pill %s and the band %s", (label, tone, pill, range) => {
    expect(labelTone(label)).toBe(tone);
    expect(pillToneFor(label)).toBe(pill);
    expect(bandRange(label)).toBe(range);
  });

  it("any other word is reference / gray / an empty range, never a guess from the number", () => {
    for (const label of ["Elevated Risk", "No data", "Uncharted", ""]) {
      expect(labelTone(label), label).toBe("reference");
      expect(pillToneFor(label), label).toBe("gray");
      expect(bandRange(label), label).toBe("");
    }
  });
});

/* ── heroCopy ────────────────────────────────────────────────────────────── */

describe("heroCopy (checklist 07 C.1 rules 1 to 6)", () => {
  it("rule 1: the headline is the probability to one decimal and the pill the served label verbatim", () => {
    const c = heroCopy(BASE);
    expect(c.headline).toBe("11.6%");
    expect(c.headline).toMatch(/^\d+\.\d%$/);
    expect(c.pill).toBe("Low Risk");
    expect(heroCopy(recessionFixture({ recession_prob: 7.24 })).headline).toBe("7.2%");
    expect(heroCopy(recessionFixture({ recession_prob: 40 })).headline).toBe("40.0%");
  });

  it("rule 1: a served label that disagrees with the number is printed as served (no re-derivation)", () => {
    const c = heroCopy(recessionFixture({ recession_label: "Elevated" }));
    expect(c.pill).toBe("Elevated");
    expect(c.headline).toBe("11.6%");
    expect(c.pillTone).toBe("amber");
    expect(c.note).toContain("Sits in the Elevated band (20 to 40%)");
  });

  it("rule 2: the subhead states the three-month change in points: up, down, unchanged, or the NBER sentence without four stored months", () => {
    expect(heroCopy(BASE).subhead).toBe("Twelve-month odds, up 1.4 points in three months.");
    expect(heroCopy(DOWN).subhead).toBe("Twelve-month odds, down 1.4 points in three months.");
    expect(heroCopy(FLAT).subhead).toBe("Twelve-month odds, unchanged over three months.");
    expect(heroCopy(SHORT).subhead).toBe("Twelve-month odds from the NBER-trained model.");
    expect(heroCopy(EMPTY).subhead).toBe("Twelve-month odds from the NBER-trained model.");
    for (const m of [BASE, DOWN, FLAT, SHORT]) expect(heroCopy(m).subhead.startsWith("Twelve-month odds")).toBe(true);
  });

  it("rule 2: the subhead's points figure equals the 3 months ago row's delta at 0.1 resolution", () => {
    const i = headlineIndex(series, 11.6);
    const prior = priorPoint(series, i, 3) as DatedValue;
    const delta = Math.round((series[i].value - prior.value) * 10) / 10;
    expect(heroCopy(BASE).subhead).toContain(`up ${Math.abs(delta).toFixed(1)} points`);
  });

  it("rule 3: the lede is X4 with the three edits, the divergence clause following the served score, and a Jargon node behind ledeText", () => {
    const c = heroCopy(BASE);
    expect(c.ledeText).toBe(LEDE_MATERIAL);
    expect(c.ledeText).toContain("recession model's own probability");
    expect(c.ledeText).toContain("High Risk at 40%");
    expect(c.ledeText).not.toContain("in the header");
    expect(c.ledeText).not.toContain("11.6");
    expect(typeof c.lede).not.toBe("string");
    expect(c.lede).not.toBeNull();
    expect(c.lede).not.toBeUndefined();
    // At or under ±20 the two tell one story; a null score is not material either.
    expect(heroCopy(recessionFixture({ divergence_score: -10, divergence_label: "Aligned" })).ledeText).toBe(LEDE_ALIGNED);
    expect(heroCopy(recessionFixture({ divergence_score: 20, divergence_label: "Aligned" })).ledeText).toContain("tell one story");
    expect(heroCopy(recessionFixture({ divergence_score: 21, divergence_label: "Markets ahead of macro" })).ledeText).toContain("Markets ahead of macro: credit pricing and the model disagree. The divergence is material and requires judgment.");
    expect(heroCopy(recessionFixture({ divergence_score: null, divergence_label: "Aligned" })).ledeText).toContain("tell one story");
  });

  it("rule 4: the note names the served band and its range with the base rate and the 2008 peak, without the number", () => {
    const c = heroCopy(BASE);
    expect(c.note).toBe("Sits in the Low Risk band (under 20%); the historical base rate runs ~15% and 2008 peaked near 89%.");
    expect(c.note).toContain("Low Risk band (under 20%)");
    expect(c.note).toContain("2008 peaked near 89%");
    expect(c.note).not.toContain("11.6");
    expect(heroCopy(recessionFixture({ recession_label: "High Risk" })).note).toBe("Sits in the High Risk band (40% and above); the historical base rate runs ~15% and 2008 peaked near 89%.");
  });

  it("rule 5: the footnote names the input count with the 3-month lag and the month the headline scores; the second item drops without a headline point", () => {
    expect(heroCopy(BASE).footnote).toEqual(["Logistic model on 5 FRED inputs, lagged 3 months", "Scored for Aug 2026"]);
    expect(heroCopy(SHORT).footnote).toEqual(["Logistic model on 5 FRED inputs, lagged 3 months", "Scored for Aug 2026"]);
    expect(heroCopy(FLAT).footnote[1]).toBe("Scored for Sep 2026");
    expect(heroCopy(recessionFixture({ model_features: ["yield_curve", "unemployment", "hy_spread"] })).footnote[0]).toBe("Logistic model on 3 FRED inputs, lagged 3 months");
    expect(heroCopy(EMPTY).footnote).toEqual(["Logistic model on 5 FRED inputs, lagged 3 months"]);
  });

  it.each<[label: string, tone: string, glow: string]>([
    ["Low Risk", "mint", GLOW_MINT],
    ["Elevated", "amber", GLOW_AMBER],
    ["High Risk", "amber", GLOW_AMBER],
    ["Uncharted", "gray", GLOW_GRAY],
  ])("rule 6: %s reads the %s pill with the glow %s", (label, tone, glow) => {
    const c = heroCopy(recessionFixture({ recession_label: label }));
    expect(c.pill).toBe(label);
    expect(c.pillTone).toBe(tone);
    expect(c.glow).toBe(glow);
  });

  it("rule 7: no hero string names the classifier's regime or its odds; none carries an em-dash, null or undefined; the helper is pure", () => {
    for (const m of [BASE, DOWN, FLAT, TWO_RISES, SHORT, EMPTY, NULL_INPUT, recessionFixture({ recession_label: "High Risk", divergence_score: null })]) {
      const before = JSON.stringify(m);
      const a = heroCopy(m);
      const b = heroCopy(m);
      expect(JSON.stringify(m)).toBe(before);
      expect(a.subhead).toBe(b.subhead);
      expect(a.ledeText).toBe(b.ledeText);
      expect(a.footnote).toEqual(b.footnote);
      for (const s of strings(a)) {
        expect(typeof s).toBe("string");
        expect(s).not.toContain("—");
        expect(s).not.toContain("null");
        expect(s).not.toContain("undefined");
        expect(s).not.toContain("NaN");
        expect(s).not.toMatch(/Goldilocks|Overheating|Stagflation/);
      }
      expect(a.ledeText).not.toMatch(/\d+% (?:Goldilocks|Recession Risk)/);
    }
  });
});

/* ── stripSummary ────────────────────────────────────────────────────────── */

describe("stripSummary (checklist 07 B.2 strip table, C.1 rule 8)", () => {
  it("three straight rises: amber Watch with the base month and the two values", () => {
    const s = stripSummary(BASE, READY);
    expect(s.tone).toBe("amber");
    expect(s.title).toBe("Watch · 3 straight rises");
    expect(s.detail).toBe("Since May 2026 · 10.2% → 11.6%");
  });

  it("a longer run prints its own count and base month", () => {
    const four = recessionFixture({ recession_prob_series: probSeries([["2026-04-30", 9.8], ...TAIL]) });
    const s = stripSummary(four, READY);
    expect(s.tone).toBe("amber");
    expect(s.title).toBe("Watch · 4 straight rises");
    expect(s.detail).toBe("Since Apr 2026 · 9.8% → 11.6%");
  });

  it("flat: mint No consecutive rises with the signed delta and the two months", () => {
    const s = stripSummary(FLAT, READY);
    expect(s.tone).toBe("mint");
    expect(s.title).toBe("No consecutive rises");
    expect(s.detail).toBe("0.0 pts · Jun 2026 → Sep 2026");
  });

  it("two rises stay under the three-rise threshold (G3): mint with the +0.9 pts delta from May to Aug", () => {
    const s = stripSummary(TWO_RISES, READY);
    expect(s.tone).toBe("mint");
    expect(s.title).toBe("No consecutive rises");
    expect(s.detail).toBe("+0.9 pts · May 2026 → Aug 2026");
    const down = stripSummary(DOWN, READY);
    expect(down.tone).toBe("mint");
    expect(down.detail).toBe("-1.4 pts · May 2026 → Aug 2026");
  });

  it("fewer than four stored months: mint No consecutive rises with the on-file sentence", () => {
    const s = stripSummary(SHORT, READY);
    expect(s.tone).toBe("mint");
    expect(s.title).toBe("No consecutive rises");
    expect(s.detail).toBe("Fewer than four months on file");
  });

  it("loading reads gray Reading the recession model…, error and an empty series gray Recession model unavailable", () => {
    expect(stripSummary(undefined, { isLoading: true, isError: false })).toEqual({ tone: "gray", title: "Reading the recession model…", detail: "Opens the model inputs" });
    expect(stripSummary(undefined, { isLoading: false, isError: true })).toEqual({ tone: "gray", title: "Recession model unavailable", detail: "The data service did not answer" });
    expect(stripSummary(EMPTY, READY)).toEqual({ tone: "gray", title: "Recession model unavailable", detail: "The data service did not answer" });
  });

  it("every strip string is free of em-dashes and the word null", () => {
    for (const [m, q] of [
      [BASE, READY],
      [FLAT, READY],
      [TWO_RISES, READY],
      [SHORT, READY],
      [EMPTY, READY],
      [undefined, { isLoading: true, isError: false }],
      [undefined, { isLoading: false, isError: true }],
    ] as [RecessionMetrics | undefined, { isLoading: boolean; isError: boolean }][]) {
      const s = stripSummary(m, q);
      for (const text of [s.title, s.detail]) {
        expect(text).not.toContain("—");
        expect(text).not.toContain("null");
        expect(text).not.toContain("NaN");
        expect(text).not.toContain("undefined");
      }
      expect(["mint", "amber", "gray"]).toContain(s.tone);
    }
  });
});

/* ── slices and feature strings ──────────────────────────────────────────── */

describe("lastMonths and lastYears (checklist 07 C.1)", () => {
  it("lastMonths slices the last n points and keeps everything when n exceeds the series", () => {
    const last24 = lastMonths(series, 24);
    expect(last24).toHaveLength(24);
    expect(last24).toEqual(series.slice(-24));
    expect(last24[0].date).toBe("2024-10-31");
    expect(last24[23]).toEqual({ date: "2026-09-30", value: 10.0 });
    expect(lastMonths(SHORT_SERIES, 24)).toEqual(SHORT_SERIES);
    expect(lastMonths([], 24)).toEqual([]);
  });

  it("lastYears(…, 5) keeps dates on or after 2021-09-01, 10 on or after 2016-09-01, and null keeps all", () => {
    const yc = BASE.yield_curve_series;
    const five = lastYears(yc, 5);
    expect(five.map((p) => p.date)).toEqual(["2022-03-01", "2023-03-01", "2024-03-01", "2025-03-01", "2026-03-01", "2026-09-01"]);
    expect(five.every((p) => p.date >= "2021-09-01")).toBe(true);
    const ten = lastYears(yc, 10);
    expect(ten[0].date).toBe("2017-03-01");
    expect(ten).toHaveLength(11);
    expect(lastYears(yc, null)).toEqual(yc);
    expect(lastYears(yc, null)).toHaveLength(32);
    // A point exactly on the cutoff is kept (date >= cutoff).
    const edge = pts(["2021-08-31", 0.5], ["2021-09-01", 0.6], ["2026-09-01", 0.33]);
    expect(lastYears(edge, 5).map((p) => p.date)).toEqual(["2021-09-01", "2026-09-01"]);
    expect(lastYears([], 5)).toEqual([]);
  });
});

describe("featureLabel and featureCurrent (checklist 07 C.1)", () => {
  it("maps the five served feature keys to their labels and an unknown key to its words", () => {
    // Iteration 1 E2: the fifth input is named for what it computes (T10YIE − T5YIE).
    expect(BASE.model_features.map(featureLabel)).toEqual(["Yield curve (2s10s)", "Unemployment rate", "HY credit spread", "Industrial production YoY", "10Y − 5Y breakeven spread"]);
    expect(featureLabel("some_new_input")).toBe("some new input");
  });

  it("prints the five current strings and the dash placeholder for a null input", () => {
    expect(BASE.model_features.map((f) => featureCurrent(f, BASE))).toEqual(["+33 bps", "4.1%", "270 bps", "1.0%", "-0.03pp"]);
    expect(featureCurrent("lei_proxy", NULL_INPUT)).toBe(DASH);
    expect(featureCurrent("yield_curve", recessionFixture({ yield_curve_spread: null }))).toBe(DASH);
    expect(featureCurrent("yield_curve", recessionFixture({ yield_curve_spread: -35 }))).toBe("-35 bps");
    expect(featureCurrent("unemployment", recessionFixture({ current_inputs: { ...BASE.current_inputs, unrate: null } }))).toBe(DASH);
    expect(featureCurrent("some_new_input", BASE)).toBe(DASH);
  });
});
