/**
 * The fixtures agree with each other (Codex round 1, group 3) and carry the
 * audit's real values (item 12). R-05: every study event carries the regime
 * row stamped two months before its own month in the fixtures' monthly
 * record (Unlabeled where that row is absent), whose last rows are /regime's
 * history; the study's by-regime rows, extrema and last five events are
 * those events, recomputed. (R-06's hedge checks left with the hedge
 * fixture: §10 serves no hedge.)
 */
import { describe, expect, it } from "vitest";
import ledger from "./ledger.json";
import overview from "./overview.json";
import record from "./regime-record.json";
import regime from "./regime.json";
import deferredRegime from "./deferred-regime.json";
import studyEvents from "./study-events.json";
import study from "./study.json";
import macro from "./macro.json";
import technicals from "./technicals.json";
import catalog from "./study-catalog.json";
import { rangeText } from "../../screens/desk/kit/units";
import type { TargetUnit } from "../../screens/desk/data/types";

const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
/** §12.2: a regime with fewer than ten events (the engine's MIN_REGIME_N) serves its count and null cells. */
const FLOOR = 10;

function monthBefore(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const k = y * 12 + (m - 1) - n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type Ev = (typeof studyEvents.events)[number];
const valueAt = (e: Ev, h: number) => e[`value_${h}` as "value_20"] as number | null;

describe("the study's events and the regime fixture (Codex R-05)", () => {
  const months = record.months;
  const byMonth = new Map(months.map((r) => [r.month, r.regime]));

  it("the record's months by regime are the deferred stats' months (What each regime has meant · since 1996); Monday serves the block awaiting", () => {
    expect(months[0].month.startsWith("1996")).toBe(true);
    for (const row of deferredRegime.stats) expect([row.regime, row.months]).toEqual([row.regime, months.filter((m) => m.regime === row.regime).length]);
    expect(regime.stats).toEqual({ status: "awaiting", data: null, unavailable: { reason: "regime statistics not yet defined in the engine.", until: null } });
  });

  it("the record is one row a month but the one month the store lacks, and its last 60 rows are /regime's history exactly", () => {
    const gaps: string[] = [];
    for (let i = 1; i < months.length; i++) {
      const want = monthBefore(months[i - 1].month, -1);
      if (months[i].month !== want) gaps.push(want);
      expect([monthBefore(months[i - 1].month, -1), monthBefore(months[i - 1].month, -2)]).toContain(months[i].month);
    }
    // The audit's Q10: 2025-10 has no row (no October CPI or UNRATE print stored).
    expect(gaps).toEqual(["2025-10"]);
    expect(regime.history).toHaveLength(60);
    expect(months.slice(-60)).toEqual(regime.history);
    expect(record.lag_months).toBe(2);
    expect(months.every((r) => REGIMES.includes(r.regime))).toBe(true);
  });

  it("every event's regime is the row stamped K−2, K its own month (Unlabeled where that row is absent)", () => {
    expect(studyEvents.events.length).toBe(study.matched_n);
    for (const e of studyEvents.events) expect([e.event_date, e.regime]).toEqual([e.event_date, byMonth.get(monthBefore(e.event_date.slice(0, 7), record.lag_months)) ?? "Unlabeled"]);
    const dates = studyEvents.events.map((e) => e.event_date);
    expect(dates).toEqual([...dates].sort().reverse());
    // §12.4: an exit and a value exactly when the window is complete.
    for (const e of studyEvents.events) for (const h of [5, 10, 20, 60]) expect([h, e[`complete_${h}` as "complete_20"], e[`exit_${h}` as "exit_20"] !== null]).toEqual([h, valueAt(e, h) !== null, valueAt(e, h) !== null]);
  });

  it("by regime is recomputed from those events: n, the share up and the median a month later", () => {
    const want = REGIMES.map((r) => {
      // §12.2: `by_regime[].n` counts the regime's events complete at h = 20.
      const rets = studyEvents.events.filter((e) => e.regime === r && valueAt(e, 20) !== null).map((e) => valueAt(e, 20) as number);
      if (rets.length < FLOOR) return { h: 20, regime: r, n: rets.length, up_pct: null, median: null };
      return { h: 20, regime: r, n: rets.length, up_pct: rets.filter((x) => x > 0).length / rets.length, median: median(rets) };
    });
    expect(study.by_regime).toEqual(want);
    expect(study.by_regime.reduce((a, r) => a + r.n, 0) + study.unlabeled_n).toBe(study.matched_n);
  });

  it("the served why is §12.2's template over horizons[selected], every number from that row (§13.3)", () => {
    const h = study.horizons.find((x) => x.h === study.selected_horizon)!;
    const adverse = `${(Math.round(h.adverse_share * 1000) / 10).toFixed(1)}%`;
    expect(study.why).toBe(`${h.n} completed outcomes in ${h.n_blocks} overlap blocks; the 90% interval on the excess median runs ${rangeText(h.ci_lo, h.ci_hi, study.question.target_unit as TargetUnit)}; ${adverse} of resampled medians are adverse against a 3% bar.`);
    expect(study.headline.startsWith(`Suggestive at ${h.label}: `)).toBe(true);
  });

  it("each horizon's counts, share up, median and extrema are its own completed outcomes (C-03)", () => {
    for (const h of study.horizons) {
      const done = studyEvents.events.filter((e) => valueAt(e, h.h) !== null).map((e) => ({ v: valueAt(e, h.h) as number, event_date: e.event_date, entry_date: e.entry_date }));
      const vals = done.map((d) => d.v);
      expect([h.h, h.n, h.up_n]).toEqual([h.h, done.length, vals.filter((v) => v > 0).length]);
      expect(h.up_pct).toBeCloseTo(h.up_n / h.n, 12);
      expect(h.median).toBeCloseTo(median(vals), 12);
      const lo = done.reduce((a, b) => (b.v < a.v ? b : a));
      const hi = done.reduce((a, b) => (b.v > a.v ? b : a));
      expect([h.worst, h.best]).toEqual([
        { value: lo.v, event_date: lo.event_date, entry_date: lo.entry_date },
        { value: hi.v, event_date: hi.event_date, entry_date: hi.entry_date },
      ]);
    }
    expect(study.horizons.find((h) => h.h === study.selected_horizon)).toBeDefined();
  });

  it("the last five events are the list's first five, with their regimes", () => {
    expect(study.last_events).toEqual(studyEvents.events.slice(0, 5).map((e) => ({ event_date: e.event_date, entry_date: e.entry_date, regime: e.regime, value_20: e.value_20 })));
    expect([study.first_event, study.last_event]).toEqual([studyEvents.events[studyEvents.events.length - 1].event_date, studyEvents.events[0].event_date]);
  });
});

describe("the audit's real values (FRAME3_DATA_AUDIT.md on desk/frame-3-docs, COMPUTABLE rows)", () => {
  const row = (slug: string) => ledger.signals.find((r) => r.slug === slug)!;
  it("the gold study (§2.3): 18 events since 2000, 12 of 18 up, +3.09% against +1.31%, the interval −1.62 to +4.10 pp, 14.6% adverse, last Apr 16, 2025", () => {
    const h = study.horizons.find((x) => x.h === 20)!;
    expect([study.matched_n, h.n, h.up_n, study.data_start, study.last_event, study.inputs_hash]).toEqual([18, 18, 12, "2000-08-30", "2025-04-16", "879a8a1f76831fad"]);
    expect([h.median, h.baseline_median, h.ci_lo, h.ci_hi, h.adverse_share].map((x) => Math.round(x * 10000) / 10000)).toEqual([0.0309, 0.0131, -0.0162, 0.041, 0.146]);
    expect(study.by_regime.map((r) => r.n)).toEqual([2, 6, 9, 1]);
  });
  it("the Ledger rows (§4): counts, share up, medians and last fires", () => {
    const want: [string, number, number, string][] = [
      ["2s10s-2sigma-steepening", 49, 0.714, "2025-04-21"],
      ["golden-cross", 14, 0.786, "2025-07-01"],
      ["vix-spike-2sigma-5d", 119, 0.664, "2026-06-05"],
      ["gold-2sigma-spx-weak", 18, 0.667, "2025-04-16"],
      ["hy-2sigma-20d", 2, 0.5, "2025-04-08"],
      ["death-cross", 14, 0.571, "2025-04-14"],
    ];
    for (const [slug, n, up, last] of want) expect([slug, row(slug).n, Math.round((row(slug).up_pct as number) * 1000) / 1000, row(slug).last_fired]).toEqual([slug, n, up, last]);
    // Rule v1 at 20 sessions: only the golden cross is established; HY has two events.
    expect(ledger.signals.filter((r) => r.verdict === "reliable").map((r) => r.slug)).toEqual(["golden-cross"]);
    expect(row("hy-2sigma-20d").verdict).toBe("insufficient");
    expect([ledger.scored_n, ledger.unavailable_n]).toEqual([8, 4]);
    expect(catalog.studies.filter((s) => !s.available).map((s) => s.slug)).toEqual(["dollar-2sigma-20d", "oil-2sigma-gold", "oil-2sigma-20d", "rsi-above-70", "rsi-below-30"]);
  });
  it("the regime, the recession score, the curve, credit and the cross (§2.1, §2.4, §2.5, §2.2)", () => {
    expect([regime.current.latest_print, overview.tiles.regime.label, overview.tiles.regime.print]).toEqual(["2026-08", "Goldilocks", "2026-07"]);
    expect(Math.round(regime.recession.score * 10000) / 10000).toBe(0.1164);
    expect(regime.next_prints.cpi.release_date).toBe("2026-10-14");
    expect(regime.next_prints.indpro.release_date).toBeNull();
    expect([macro.curve.today["2y"], macro.curve.today["10y"], macro.curve.today.date]).toEqual([4.71, 4.96, "2026-09-22"]);
    expect([macro.credit.hy.value, macro.credit.hy.date, macro.credit.ig.value]).toEqual([2.73, "2026-09-23", 0.77]);
    expect(technicals.cross).toEqual({ kind: "golden", date: "2025-07-01" });
  });
});

describe("Ledger rows and their baselines (§4.1, v3 §6)", () => {
  it("every row's vs normal is its own excess over its own baseline; an Overview row is its Ledger row, firing state included", () => {
    for (const r of ledger.signals) if (r.median != null) expect(r.vs_normal).toBeCloseTo(100 * (r.median - r.baseline_median), 6);
    const bySlug = new Map(ledger.signals.map((r) => [r.slug, r]));
    // §12.1: active_signals are Ledger rows (§12.5), so their firing state is the Ledger's too.
    const nums = (r: Record<string, unknown> | undefined) =>
      r && { n: r.n, up_pct: r.up_pct, median: r.median, baseline_median: r.baseline_median, vs_normal: r.vs_normal, target_unit: r.target_unit, horizon: r.horizon, firing_now: r.firing_now, firing_day: r.firing_day, evaluated_on: r.evaluated_on, stale: r.stale };
    for (const r of overview.active_signals) expect(nums(r)).toEqual(nums(bySlug.get(r.slug)));
    // The study's firing state is its Ledger row's (§12.2, §12.5).
    const row = bySlug.get(study.slug) as Record<string, unknown>;
    const s = study as Record<string, unknown>;
    expect([s.firing_now, s.firing_day ?? null, s.evaluated_on, s.stale]).toEqual([row.firing_now, row.firing_day ?? null, row.evaluated_on, row.stale]);
    expect("normal_month" in ledger).toBe(false);
    // One study, one baseline: the gold Ledger row is the study's own h = 20 row (§4.1).
    const gold = bySlug.get("gold-2sigma-spx-weak")!;
    const h20 = study.horizons.find((h) => h.h === 20)!;
    expect([gold.median, gold.baseline_median]).toEqual([h20.median, h20.baseline_median]);
  });
});

describe("the regime row governing today and the recession score (§5, §12.1, §12.6)", () => {
  it("both tabs serve the stored row stamped K−2 for the session month, its run, and the newest row beside it", () => {
    const months = record.months;
    const K = (regime.as_of as string).slice(0, 7);
    const print = monthBefore(K, record.lag_months);
    const at = months.findIndex((m) => m.month === print);
    let start = at;
    while (start > 0 && months[start - 1].regime === months[at].regime) start--;
    const want = { label: months[at].regime, print, months_in: at - start + 1, since: months[start].month };
    for (const row of [overview.tiles.regime, regime.current]) expect({ label: row.label, print: row.print, months_in: row.months_in, since: row.since }).toEqual(want);
    expect(regime.current.latest_print).toBe(months[months.length - 1].month);
  });
  it("the Overview tile's recession fields are the Regime tab's; the band follows v3 §11's edges", () => {
    const r = regime.recession;
    const t = overview.tiles.recession;
    for (const k of ["score", "probability_month", "inputs_through", "band", "band_edges"] as const) expect(t[k]).toEqual(r[k]);
    const band = r.score < r.band_edges[0] ? "low" : r.score < r.band_edges[1] ? "elevated" : "high_risk";
    expect(r.band).toBe(band);
    expect(r.band_edges).toEqual([0.2, 0.4]);
  });
});

describe("the client label (§11, §12.2, §12.3; item 14)", () => {
  it("every query-backed catalog row has a client label in plain words; the study's client headline is its row's", () => {
    const rows = catalog.studies as { slug: string; question: unknown; client_label?: string | null }[];
    for (const r of rows) {
      if (r.question == null) expect(r.client_label ?? null).toBeNull();
      else {
        expect(typeof r.client_label, r.slug).toBe("string");
        // No σ and no engine terms (§11).
        expect(r.client_label, r.slug).not.toMatch(/σ|\bz\b|sessions?|window|shock|condition|2s10s|cross/i);
      }
    }
    expect(rows.filter((r) => r.question != null)).toHaveLength(13);
    expect(study.client?.headline).toBe(rows.find((r) => r.slug === study.slug)?.client_label);
  });
});

describe("the firing state (§12.1, §12.5, v4 B-05)", () => {
  it("every since-last-close fire is a Ledger row firing on the comparison session, not stale; the three answers share the sessions", () => {
    const sl = overview.since_last_close;
    // Nothing fires in the audit's snapshot, so the JSON's lists are empty; typed here for the checks that follow.
    type Fire = { slug: string; firing_day?: number | null };
    const [newFires, stillFiring] = [sl.new_fires as Fire[], sl.still_firing as Fire[]];
    const bySlug = new Map(ledger.signals.map((r) => [r.slug, r]));
    for (const f of [...newFires, ...stillFiring]) {
      const r = bySlug.get(f.slug)!;
      expect([f.slug, r.firing_now, r.stale, r.evaluated_on]).toEqual([f.slug, true, false, sl.comparison_session]);
    }
    for (const f of stillFiring) expect(f.firing_day).toBe(bySlug.get(f.slug)!.firing_day);
    expect([ledger.comparison_session, ledger.prev_session]).toEqual([sl.comparison_session, sl.prev_session]);
    expect(study.comparison_session).toBe(sl.comparison_session);
    // A row that is not firing has no firing day (B-05).
    for (const r of ledger.signals) if (r.firing_now !== true) expect(r.firing_day ?? null).toBeNull();
  });
});
