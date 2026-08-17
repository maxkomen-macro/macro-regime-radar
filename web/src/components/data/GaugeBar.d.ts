export interface GaugeBarProps {
  /** 0–100. Clamped. */
  pct?: number;
  /** Small caption above the bar, e.g. "Threshold proximity". */
  caption?: string;
  /** Override the ramp colour. */
  color?: string;
  height?: number;
  style?: React.CSSProperties;
}

/** Thin fill bar with the green → amber → orange → red threshold ramp. */
export function GaugeBar(props: GaugeBarProps): JSX.Element;

/** Returns the ramp token for a 0–100 fill percentage. */
export function rampColor(pct: number): string;
