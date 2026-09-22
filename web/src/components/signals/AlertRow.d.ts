export interface AlertRowProps {
  /** Maps to alert_feed.level. */
  level?: "info" | "watch" | "risk";
  /** Alert name, e.g. "vix_spike" or "SPY_drawdown". */
  name: string;
  message?: string;
  date?: string;
  style?: React.CSSProperties;
}

/** One entry in the alert feed — level rail, name, message, date. */
export function AlertRow(props: AlertRowProps): JSX.Element;
