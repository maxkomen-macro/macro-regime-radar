/**
 * Basket & Hedge's "Event study on this basket" as a PROTOTYPE (DESK_FRAME3_SPEC
 * §10, §1.0.3): after the basket falls 2σ over 5 days, the basket a week, two
 * weeks, a month and three months later, in the Event Study's shape (§4,
 * §12.2), from proto-basket-study.json. Its verdict is §1.5's rule v1 on the
 * card's own numbers, at a month (h = 20, as the Ledger reads it). Drawn for
 * the sample basket the fixture carries (baskets.json's) alone: another basket
 * has no illustrative study. Pure.
 */

import s from "../../../fixtures/desk/proto-basket-study.json" with { type: "json" };
import type { StudyHorizon, Verdict } from "../data/types";
import { horizonLabel } from "../event-study/question";
import type { SavedBasket } from "../basket/weights";
import type { BasketLeg } from "./basket-inputs";

export interface BasketStudy {
  matchedN: number;
  sampleStart: string;
  sampleEnd: string;
  indexFrom: string;
  indexRule: string;
  lastEvent: string;
  cooldown: number;
  window: number;
  horizons: (StudyHorizon & { n: number; up_n: number; n_blocks: number; adverse_share: number; baseline_up_pct: number })[];
  /** h = 20's row. */
  month: BasketStudy["horizons"][number];
  verdict: Verdict;
}

type Row = (typeof s.horizons)[number];

/** §1.5, rule v1, at horizon h: too few under ten outcomes; Reliable when the engine's exclusion holds (ten or
 * more blocks, the interval on one side of zero, under 3% of resampled medians adverse); Suggestive when the
 * excess medians at 5, 10 and 20 sessions all lean the same way; else No edge. */
export function verdictV1(rows: readonly Pick<Row, "h" | "n" | "median" | "baseline_median" | "ci_lo" | "ci_hi" | "blocks" | "adverse_share">[], h: number): Verdict {
  const x = rows.find((r) => r.h === h);
  if (!x || x.n < 10) return "insufficient";
  if (x.blocks >= 10 && (x.ci_lo > 0 || x.ci_hi < 0) && x.adverse_share < 0.03) return "reliable";
  const lean = [5, 10, 20].map((k) => {
    const r = rows.find((y) => y.h === k);
    return r ? r.median - r.baseline_median : NaN;
  });
  if (lean.every((v) => v > 0) || lean.every((v) => v < 0)) return "suggestive";
  return "no_edge";
}

/** The sample basket the illustrative study was drawn for, as this browser saves it. */
export function sampleBasket(): SavedBasket {
  return { id: s.basket.id, name: s.basket.name, legs: s.basket.legs.map((l) => ({ ...l })), saved_at: "2026-09-22T20:00:00Z" };
}

/** Whether the open basket is the sample the illustrative study was drawn for (its legs at its weights). */
export function isSampleBasket(legs: readonly BasketLeg[]): boolean {
  const sample = sampleBasket().legs;
  return legs.length === sample.length && legs.every((l, i) => l.symbol === sample[i].symbol && l.weight === Number(sample[i].weight));
}

export function basketStudy(): BasketStudy {
  const horizons = s.horizons.map((r) => ({
    h: r.h,
    label: horizonLabel(r.h),
    n: r.n,
    up_n: r.up_n,
    up_pct: r.up_n / r.n,
    median: r.median,
    baseline_median: r.baseline_median,
    baseline_up_pct: r.baseline_up_pct,
    ci_lo: r.ci_lo,
    ci_hi: r.ci_hi,
    n_blocks: r.blocks,
    adverse_share: r.adverse_share,
    worst: "worst" in r && r.worst ? { value: r.worst.value, event_date: r.worst.event_date, entry_date: null } : null,
    best: "best" in r && r.best ? { value: r.best.value, event_date: r.best.event_date, entry_date: null } : null,
  }));
  const month = horizons.find((h) => h.h === 20)!;
  return {
    matchedN: s.matched_n,
    sampleStart: s.sample_start,
    sampleEnd: s.sample_end,
    indexFrom: s.index.from,
    indexRule: s.index.rule,
    lastEvent: s.last_event,
    cooldown: s.cooldown,
    window: s.question.window,
    horizons,
    month,
    verdict: verdictV1(s.horizons, 20),
  };
}

/** The sample basket's name, for the words another basket's card prints. */
export const SAMPLE_NAME = sampleBasket().name;
