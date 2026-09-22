/**
 * The LBO deal: its defaults, the nine slider definitions, the assumption
 * warnings, the IRR tone bands, the equity-bridge arithmetic and the one hook
 * that owns the deal state (redesign Phase 9, checklist 09 A.2). Everything
 * here moved verbatim from the first LboPanel.tsx (25-34 BASE_INPUTS, 38-43
 * the bands, 86-140 the state machine, 128-139 the warnings, 235-360 the
 * sliders) so the screen (ToolsScreen), the hero row (LboHeroRow) and the
 * body (LboPanel) read one source.
 *
 * `useLboDeal` runs the deal behind a 300 ms debounce and the base case (the
 * default deal at the live rate) without one. The base run is always enabled
 * so the hero can print the default deal; at rest the two runs share the
 * query key `["lbo", "run", req]` (structural equality), so one POST is sent
 * at rest and two once something is modified, exactly as before. Nothing is
 * re-derived here: IRR, MOIC and the schedule are served, and `bridgeSteps`
 * is the display arithmetic on served fields the checklist names (B.1.1).
 */

import { useCallback, useMemo, useState } from "react";
import type { LboRequest, LboResult, LboSensitivity } from "../../api/types";
import { useLboDefaults, useLboRun } from "../../api/queries";
import { fmtMillions, useDebounced } from "../shared/screen-ui";

/** The default deal (moved verbatim from LboPanel.tsx). */
export const BASE_INPUTS: Omit<LboRequest, "interest_rate"> = {
  ebitda: 100,
  ebitda_growth_rate: 5,
  entry_multiple: 8,
  exit_multiple: 9,
  hold_period: 5,
  leverage_ratio: 4.5,
  amortization_rate: 5,
  mgmt_fee_pct: 1.5,
};

/** The stated rate the calculator falls back to when no live rate is on
 * file (LboPanel.tsx:99); the slider note and the hero name it. */
export const FALLBACK_RATE = 8.5;

/** The rate slider's range: a live rate outside it is clamped so "manual
 * mode" cannot get stuck on (LboPanel.tsx:90, audit). */
export const RATE_MIN = 3;
export const RATE_MAX = 20;

/** The live rate the slider can actually hold; null without a live rate. */
export function clampRate(rate: number | null | undefined): number | null {
  return rate != null && Number.isFinite(rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) : null;
}

export type SliderKey = keyof LboRequest;
export type SliderGroup = "Business" | "Entry & exit" | "Financing";

export interface SliderDef {
  key: SliderKey;
  label: string;
  /** Jargon glossary term wrapped around the label, when one exists. */
  jargon?: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  dp: number;
  valueText: (v: number) => string;
  /** The scale-row formatter (min / max ends). */
  format: (v: number) => string;
  group: SliderGroup;
}

/** The nine slider definitions in today's order (LboPanel.tsx:235-360): the
 * T10 ranges, units and decimal places, each `valueText` as it printed, and a
 * scale-row `format` in the same form. */
export const SLIDERS: SliderDef[] = [
  {
    key: "ebitda",
    label: "Entry EBITDA",
    min: 10,
    max: 1000,
    step: 10,
    unit: "$M",
    dp: 0,
    valueText: (v) => fmtMillions(v),
    format: (v) => `$${v}M`,
    group: "Business",
  },
  {
    key: "ebitda_growth_rate",
    label: "EBITDA growth",
    min: -10,
    max: 30,
    step: 0.5,
    unit: "%/yr",
    dp: 1,
    valueText: (v) => `${v.toFixed(1)}%/yr`,
    format: (v) => `${v}%/yr`,
    group: "Business",
  },
  {
    key: "entry_multiple",
    label: "Entry multiple",
    jargon: "EV/EBITDA",
    min: 3,
    max: 20,
    step: 0.25,
    unit: "×",
    dp: 2,
    valueText: (v) => `${v.toFixed(2)}×`,
    format: (v) => `${v.toFixed(1)}×`,
    group: "Entry & exit",
  },
  {
    key: "exit_multiple",
    label: "Exit multiple",
    jargon: "EV/EBITDA",
    min: 3,
    max: 20,
    step: 0.25,
    unit: "×",
    dp: 2,
    valueText: (v) => `${v.toFixed(2)}×`,
    format: (v) => `${v.toFixed(1)}×`,
    group: "Entry & exit",
  },
  {
    key: "hold_period",
    label: "Hold period",
    min: 1,
    max: 10,
    step: 1,
    unit: "yr",
    dp: 0,
    valueText: (v) => `${v} yr`,
    format: (v) => `${v}`,
    group: "Entry & exit",
  },
  {
    key: "mgmt_fee_pct",
    label: "Transaction fees",
    min: 0,
    max: 5,
    step: 0.25,
    unit: "% EV",
    dp: 2,
    valueText: (v) => `${v.toFixed(2)}% of EV`,
    format: (v) => `${v}%`,
    group: "Entry & exit",
  },
  {
    key: "leverage_ratio",
    label: "Leverage · Debt/EBITDA",
    jargon: "leverage",
    min: 0.5,
    max: 8,
    step: 0.25,
    unit: "×",
    dp: 2,
    valueText: (v) => `${v.toFixed(2)}×`,
    format: (v) => `${v.toFixed(1)}×`,
    group: "Financing",
  },
  {
    key: "interest_rate",
    label: "Interest rate (all-in)",
    min: RATE_MIN,
    max: RATE_MAX,
    step: 0.25,
    unit: "%",
    dp: 2,
    valueText: (v) => `${v.toFixed(2)}%`,
    format: (v) => `${v}%`,
    group: "Financing",
  },
  {
    key: "amortization_rate",
    label: "Debt amortization",
    min: 0,
    max: 20,
    step: 1,
    unit: "%/yr",
    dp: 0,
    valueText: (v) => `${v.toFixed(0)}%/yr`,
    format: (v) => `${v}%/yr`,
    group: "Financing",
  },
];

/** Client-side sanity checks on assumption combinations (LboPanel.tsx:128-139,
 * verbatim); the server still decides viability, these just say why a result
 * will not clear. None at the defaults. */
export function dealWarnings(inputs: LboRequest): string[] {
  const warnings: string[] = [];
  if (inputs.leverage_ratio >= inputs.entry_multiple)
    warnings.push(
      `Leverage ${inputs.leverage_ratio.toFixed(2)}× meets or exceeds the ${inputs.entry_multiple.toFixed(2)}× entry multiple: debt covers the whole purchase price and the equity check goes to zero or below.`,
    );
  if (inputs.amortization_rate * inputs.hold_period > 100)
    warnings.push(
      `Amortizing ${inputs.amortization_rate.toFixed(0)}%/yr over ${inputs.hold_period} years retires more than 100% of the original debt; the schedule floors at zero.`,
    );
  if (inputs.exit_multiple > inputs.entry_multiple + 4)
    warnings.push(
      `Exit multiple sits ${(inputs.exit_multiple - inputs.entry_multiple).toFixed(2)}× above entry: most of the return is multiple expansion, not operating performance.`,
    );
  return warnings;
}

export type IrrTone = "mint" | "amber" | "gray";
/** 20 and above mint, 15 to 20 amber, below 15 gray (the LboPanel.tsx:38-43 bands). */
export function irrTone(irr: number | null | undefined): IrrTone {
  if (irr == null || !Number.isFinite(irr)) return "gray";
  if (irr >= 20) return "mint";
  if (irr >= 15) return "amber";
  return "gray";
}

export interface BridgeStep {
  label: [string, string];
  value: number;
  /** "absolute" bars (entry, exit) stand on the baseline; "delta" bars stack on the running total. */
  kind: "absolute" | "delta";
}

/**
 * The six equity-bridge bars from served fields (checklist 09 B.1.1): entry
 * equity, EBITDA growth, multiple change, debt paydown, fees, exit equity.
 * Every value is a served `LboResult` field or the display arithmetic on one
 * plus the request that produced it. The first five sum to the sixth up to
 * the server's 2 dp rounding, because entry_equity = entry_ev + fees -
 * entry_debt, exit_equity = exit_ev - exit_debt and exit_ev - entry_ev =
 * growth + multiple. Null when the result is not viable (either server
 * branch leaves exit_debt / exit_equity null or the schedule empty).
 */
export function bridgeSteps(result: LboResult | undefined, req: LboRequest): BridgeStep[] | null {
  if (!result || !result.viable) return null;
  const last = result.schedule[result.schedule.length - 1];
  if (!last || result.exit_debt == null || result.exit_equity == null) return null;
  const growth = (last.ebitda - req.ebitda) * req.entry_multiple;
  const multiple = last.ebitda * (req.exit_multiple - req.entry_multiple);
  const paydown = result.entry_debt - result.exit_debt;
  const fees = -(result.entry_equity + result.entry_debt - result.entry_ev);
  return [
    { label: ["Entry", "equity"], value: result.entry_equity, kind: "absolute" },
    { label: ["EBITDA", "growth"], value: growth, kind: "delta" },
    { label: ["Multiple", "change"], value: multiple, kind: "delta" },
    { label: ["Debt", "paydown"], value: paydown, kind: "delta" },
    { label: ["Fees", ""], value: fees, kind: "delta" },
    { label: ["Exit", "equity"], value: result.exit_equity, kind: "absolute" },
  ];
}

export interface LboDeal {
  defaults: ReturnType<typeof useLboDefaults>;
  liveRate: number | null;
  clampedLive: number | null;
  inputs: LboRequest;
  baseInputs: LboRequest;
  overrides: Partial<LboRequest>;
  set: (patch: Partial<LboRequest>) => void;
  reset: () => void;
  modified: boolean;
  manualRate: boolean;
  run: ReturnType<typeof useLboRun>;
  base: ReturnType<typeof useLboRun>;
  res: LboResult | undefined;
  baseRes: LboResult | undefined;
  sens: LboSensitivity | undefined;
  warnings: string[];
  /** True while the 300 ms debounce holds a change the deal run has not yet
   * been asked for (the hero note reads it as "rerunning"). */
  settling?: boolean;
}

/**
 * The deal state machine lifted from LboPanel.tsx:86-140: the live rate
 * clamped to the slider's range, the overrides on top of `BASE_INPUTS` at
 * that rate (or the stated fallback), the 300 ms debounce, the deal run and
 * the always-enabled base run. The runs wait for the defaults query to settle
 * (the request is null while it loads) so the first POST carries the live
 * rate rather than the fallback and then the live rate again. `enabled=false`
 * disables both runs (a panel that received the deal from the screen); the
 * defaults query is shared by key, so it costs nothing either way.
 */
export function useLboDeal(enabled = true): LboDeal {
  const defaults = useLboDefaults();
  const liveRate = defaults.data?.lbo_all_in_rate ?? null;
  // Compare against the value the slider can actually hold; a live rate
  // outside [3,20] would otherwise leave "manual mode" stuck on (audit).
  const clampedLive = clampRate(liveRate);

  const [overrides, setOverrides] = useState<Partial<LboRequest>>({});
  const settled = !defaults.isLoading;

  // Null while the defaults load (brief; then the live rate or the stated
  // fallback): the calculator must not be stranded by a failed rate lookup,
  // and it must not post the fallback deal only to post the live one.
  const liveInputs = useMemo<LboRequest | null>(
    () => (settled ? { ...BASE_INPUTS, interest_rate: clampedLive ?? FALLBACK_RATE, ...overrides } : null),
    [settled, clampedLive, overrides],
  );
  const debounced = useDebounced(liveInputs, 300);
  const run = useLboRun(enabled ? debounced : null);

  // Base case: the same defaults at the live rate, always on so the hero can
  // print the default deal; it shares the deal run's key until something is
  // modified (executive pass, 2026-09-05; Phase 9).
  const liveBase = useMemo<LboRequest | null>(
    () => (settled ? { ...BASE_INPUTS, interest_rate: clampedLive ?? FALLBACK_RATE } : null),
    [settled, clampedLive],
  );
  const base = useLboRun(enabled ? liveBase : null);

  const inputs = useMemo<LboRequest>(
    () => liveInputs ?? { ...BASE_INPUTS, interest_rate: clampedLive ?? FALLBACK_RATE, ...overrides },
    [liveInputs, clampedLive, overrides],
  );
  const baseInputs = useMemo<LboRequest>(
    () => liveBase ?? { ...BASE_INPUTS, interest_rate: clampedLive ?? FALLBACK_RATE },
    [liveBase, clampedLive],
  );

  const modified = Object.keys(overrides).length > 0;
  const manualRate = clampedLive != null && Math.abs(inputs.interest_rate - clampedLive) > 0.1;
  const warnings = useMemo(() => (liveInputs ? dealWarnings(liveInputs) : []), [liveInputs]);

  const set = useCallback((patch: Partial<LboRequest>) => setOverrides((o) => ({ ...o, ...patch })), []);
  const reset = useCallback(() => setOverrides({}), []);

  return {
    defaults,
    liveRate,
    clampedLive,
    inputs,
    baseInputs,
    overrides,
    set,
    reset,
    modified,
    manualRate,
    run,
    base,
    res: run.data?.result,
    baseRes: base.data?.result,
    sens: run.data?.sensitivity,
    warnings,
    settling: liveInputs !== debounced,
  };
}
