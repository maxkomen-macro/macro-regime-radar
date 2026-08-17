export interface StatTileProps {
  /** Uppercase mono label, e.g. "US 10Y", "VIX", "2s10s Spread". */
  label: string;
  /** Preformatted value string — always mono, always tabular. */
  value: React.ReactNode;
  /** Preformatted change string, e.g. "+0.01" or "-6.33". */
  delta?: React.ReactNode;
  direction?: "up" | "down" | "flat";
  size?: "sm" | "md" | "lg";
  /** Show the pulsing live dot beside the label. */
  live?: boolean;
  style?: React.CSSProperties;
}

/**
 * Label / value / delta triple used in the header ticker strip and Key Levels grid.
 * @startingPoint section="Data" subtitle="Label, mono value, directional delta" viewport="700x160"
 */
export function StatTile(props: StatTileProps): JSX.Element;
