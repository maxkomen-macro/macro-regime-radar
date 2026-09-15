/**
 * SEAM STUB (redesign Phase 6): implementer A replaces this file with the
 * Lightweight Charts line chart (checklist 06 B.1.1, reused by the quality
 * ladder, B.5). Keep the props contract.
 */
export interface SpreadPoint {
  /** ISO date (YYYY-MM-DD or a longer ISO string; the chart slices to the day). */
  date: string;
  value: number;
}
export interface SpreadSeries {
  label: string;
  /** CSS colour (hex or rgba; CSS variables are resolved by the caller). */
  color: string;
  points: SpreadPoint[];
  /** Library line width, integer 1..4. Default 1. */
  lineWidth?: 1 | 2 | 3 | 4;
}
export interface SpreadRule {
  /** Index into `series` whose price scale the rule sits on. */
  series: number;
  price: number;
  color: string;
  title: string;
}
export interface SpreadBand {
  /** ISO dates, inclusive months. */
  from: string;
  to: string;
  label: string;
}
export interface SpreadLinesChartProps {
  series: SpreadSeries[];
  height: number;
  /** aria-label of the `role="img"` wrapper. */
  ariaLabel: string;
  /** Dashed horizontal rules (hero chart only). */
  rules?: SpreadRule[];
  /** Shaded date bands (hero chart only; the NBER recessions). */
  bands?: SpreadBand[];
}

export default function SpreadLinesChart({ height, ariaLabel }: SpreadLinesChartProps): JSX.Element {
  return <div role="img" aria-label={ariaLabel} style={{ height }} />;
}
