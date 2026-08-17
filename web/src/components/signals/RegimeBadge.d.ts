export type RegimeLabel = "Goldilocks" | "Overheating" | "Stagflation" | "Recession Risk";

export interface RegimeBadgeProps {
  label?: RegimeLabel;
  size?: "sm" | "md";
  /** 0–1 confidence, rendered as a trailing percentage. */
  confidence?: number;
  style?: React.CSSProperties;
}

/**
 * The current macro regime, in its muted translucent badge.
 * @startingPoint section="Signals" subtitle="Four-regime badge, muted fill" viewport="700x140"
 */
export function RegimeBadge(props: RegimeBadgeProps): JSX.Element;
