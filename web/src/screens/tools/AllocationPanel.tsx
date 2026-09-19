/**
 * Asset Allocation (redesign Phase 9, checklist 09 A.9 to A.12): the
 * composition root of the `#allocation` sub-tab body. The hero row and the
 * summary card above it belong to the screen (AllocationHeroRow), the mono
 * disclosure line below it is the screen's DisclosureLine; this panel renders
 * the three sections in order: Regime-conditional performance
 * (`#allocation-overview`), Optimization (`#allocation-optimization`) and
 * Risk analysis (`#allocation-risk`, one lens at a time).
 *
 * Data: /api/allocation — computed by src/analytics/allocation.py from ~24y
 * of monthly asset returns (downloaded server-side, cached 1h). Methods that
 * need riskfolio-lib (Min CVaR, HERC) fall back to equal weight and say so.
 *
 * The vocabulary the three sections share (METHODS, RISK_BLOCKS, REGIME_HUE,
 * the formatters and the tint bands) lives here, exported. The section modules
 * read it inside render only, never at module top level, so the import cycle
 * AllocationPanel → section → AllocationPanel is safe under ESM live bindings
 * (Vite and vitest alike).
 */

import { Card } from "../../components";
import { useAllocation } from "../../api/queries";
import type { AllocationData, FrameData } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { Caption, MISSING, StateNote } from "../shared/screen-ui";
import AllocationOverview from "./AllocationOverview";
import AllocationOptimization from "./AllocationOptimization";
import RiskLenses from "./RiskLenses";

/** The null-value glyph the tables print (U+2014), never an em-dash aside. */
export const DASH = "—";

export const REGIME_ORDER = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
/** The regime hue tokens (tokens/colors.css); the old-palette hexes left in Phase 9. */
export const REGIME_HUE: Record<string, string> = {
  Goldilocks: "var(--r-goldilocks)",
  Overheating: "var(--r-overheating)",
  Stagflation: "var(--r-stagflation)",
  "Recession Risk": "var(--r-recession)",
};

/** Marker hues per the checklist 09 B.11 token map. */
export const METHODS: { key: string; label: string; badge: string; color: string }[] = [
  { key: "mvo", label: "Mean-Variance", badge: "return-based", color: "var(--link)" },
  { key: "min_var", label: "Min Variance", badge: "risk-only", color: "var(--pos)" },
  { key: "risk_parity", label: "Risk Parity", badge: "risk-balanced", color: "var(--amber)" },
  { key: "black_litterman", label: "Black-Litterman", badge: "equilibrium + views", color: "var(--warn-hot)" },
  { key: "hrp", label: "HRP", badge: "hierarchical", color: "var(--research)" },
  { key: "cvar", label: "Min CVaR", badge: "tail-risk", color: "var(--neg)" },
  { key: "herc", label: "HERC", badge: "hierarchical", color: "var(--text-3)" },
];

export const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
export const spct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/** Only an explicit converged:false (or a "(fallback)" method name) marks a
 * fallback — the source omits the flag entirely on some success paths. */
export const isFallback = (o: { converged?: boolean; method?: string } | undefined) =>
  o != null && (o.converged === false || (o.method ?? "").includes("(fallback)"));

/** Regime-return tint bands (checklist 09 B.10): today's `retBg` bands on the new palette. */
export function retTint(v: number | null): string {
  if (v == null) return "transparent";
  if (v >= 0.1) return "rgba(40,209,124,.14)";
  if (v >= 0.05) return "rgba(40,209,124,.07)";
  if (v >= 0) return "transparent";
  if (v >= -0.05) return "rgba(240,80,63,.07)";
  return "rgba(240,80,63,.14)";
}

/** Correlation tint bands (checklist 09 B.12): red clusters, blue diversifiers, on the new palette. */
export function corrTint(v: number | null): string {
  if (v == null) return "transparent";
  if (v >= 0.8) return "rgba(240,80,63,.30)";
  if (v >= 0.5) return "rgba(240,80,63,.18)";
  if (v >= 0.2) return "rgba(240,80,63,.08)";
  if (v >= -0.2) return "transparent";
  if (v >= -0.5) return "rgba(88,184,230,.12)";
  return "rgba(88,184,230,.22)";
}

export const RISK_BLOCKS = [
  { id: "tail", label: "Tail risk", primary: true },
  { id: "drawdowns", label: "Drawdowns", primary: true },
  { id: "correlation", label: "Correlation", primary: true },
  { id: "factors", label: "Factors", primary: true },
  { id: "style", label: "Style", primary: false },
  { id: "transitions", label: "Transition P&L", primary: false },
  { id: "currency", label: "Currency", primary: false },
  { id: "real", label: "Real vs nominal", primary: false },
] as const;
export type RiskBlockId = (typeof RISK_BLOCKS)[number]["id"];

export function frameCell(f: FrameData, rowIdx: number, col: string): number | null {
  const ci = f.columns.indexOf(col);
  if (ci === -1) return null;
  return f.data[rowIdx]?.[ci] ?? null;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** Small counts read as words in prose, matching the API's sentence (review P3-4). */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "2003-06 → 2006-09" → "Jun 2003 → Sep 2006". */
export function fmtMonthRange(range: string): string {
  return range
    .split("→")
    .map((part) => {
      const t = part.trim();
      return /^\d{4}-\d{2}$/.test(t) ? fmtMonYr(`${t}-01`) : t;
    })
    .join(" → ");
}

/** The regimes the payload carries stats for, in house order. */
export function regimesOf(a: AllocationData): string[] {
  return REGIME_ORDER.filter((r) => a.regime_stats[r]);
}

/** The source gates the whole optimizer block on the current regime having
 * enough covariance history, so the payload ships optimizations: null when a
 * thin regime is live. types.ts declares the member non-null — narrow here
 * rather than let a section read through a null. */
export function optimizationsOf(a: AllocationData): AllocationData["optimizations"] | null {
  return a.optimizations ?? null;
}

/** asset_names lives inside the optimizer block; without it the row order
 * falls back to the regime-stats keys — same source columns, same order. */
export function assetNames(a: AllocationData): string[] {
  return (
    optimizationsOf(a)?.asset_names ??
    [...new Set(Object.values(a.regime_stats).flatMap((s) => Object.keys(s?.mean ?? {})))]
  );
}

export default function AllocationPanel() {
  const q = useAllocation();
  const a = q.data;

  if (!a) {
    return (
      <Card>
        <StateNote live loading={q.isLoading} error={q.isError} missing={MISSING.allocation}>
          {q.isLoading
            ? "Building ~24 years of monthly return history; a first load can take up to a minute."
            : undefined}
        </StateNote>
        {q.isLoading && (
          <Caption>
            Ten asset classes, seven optimizers, and the full risk block compute fresh from the
            return history each session.
          </Caption>
        )}
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--gap-panel)", minWidth: 0 }}>
      <AllocationOverview a={a} />
      <AllocationOptimization a={a} />
      <RiskLenses a={a} />
    </div>
  );
}
