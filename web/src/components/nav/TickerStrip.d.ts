export interface TickerItem {
  /** Uppercase label, e.g. "S&P 500". */
  label: string;
  /** Preformatted display value, e.g. "+0.28%" or "16.9". */
  value: string;
  /** Numeric value — compared across renders to fire the tick flash. */
  raw?: number;
  /** Colour of the value. */
  tone?: "pos" | "neg" | "neutral";
  /** Parenthetical change, e.g. "-8.36" or "+10bps". */
  change?: string;
  changeTone?: "pos" | "neg" | "neutral";
}

export interface TickerStripProps {
  items?: TickerItem[];
  style?: React.CSSProperties;
}

/**
 * Always-on market strip below the wordmark; flashes green/red on value change.
 * @startingPoint section="Navigation" subtitle="Live header ticker with tick flash" viewport="700x120"
 */
export function TickerStrip(props: TickerStripProps): JSX.Element;
