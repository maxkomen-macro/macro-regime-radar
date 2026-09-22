export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Mono 11px uppercase label, e.g. "US 10Y", "VIX", "2s10s Spread". */
  label: React.ReactNode;
  /** Preformatted value: UI face at 500, always tabular. */
  value: React.ReactNode;
  /** Preformatted change string, e.g. "+0.01" or "-6.33". */
  delta?: React.ReactNode;
  direction?: "up" | "down" | "flat";
  /** Value size: xs 14px, sm 20px, md 24px (default), lg 30px, xl 40px. */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Show the pulsing live dot beside the label. */
  live?: boolean;
  style?: React.CSSProperties;
}

/**
 * Label / value / delta triple used in the Key Levels grid, count tiles and outputs.
 * @startingPoint section="Data" subtitle="Label, value, directional delta" viewport="700x160"
 */
export function StatTile(props: StatTileProps): JSX.Element;
