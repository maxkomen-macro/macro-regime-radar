import type { PillTone } from "../core/Pill";

export type RegimeLabel = "Goldilocks" | "Overheating" | "Stagflation" | "Recession Risk";

export interface RegimeBadgeProps {
  /** One of the four regimes; any other string renders the gray pill. */
  label?: RegimeLabel | (string & {});
  /** `md` 40px (default, page headers), `sm` 28px (top bar, table rows). */
  size?: "sm" | "md";
  /** 0 to 1 confidence, rendered as a trailing `.pct` percentage. */
  confidence?: number;
  /**
   * `regime` (default) maps the label to its tint: Goldilocks mint, Overheating
   * orange, Stagflation red, Recession Risk gray. Any Pill tone overrides it.
   */
  tone?: PillTone | "regime";
  style?: React.CSSProperties;
  id?: string;
  className?: string;
  /** `aria-*`, `data-*`, `title` and any other DOM attribute spread onto the pill. */
  [key: string]: unknown;
}

/**
 * The current macro regime as the probability pill (`Pill` with regime tints).
 * @startingPoint section="Signals" subtitle="Four-regime pill with confidence" viewport="700x140"
 */
export function RegimeBadge(props: RegimeBadgeProps): JSX.Element;
