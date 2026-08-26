export interface StatusDotProps {
  status?: "live" | "clear" | "watch" | "risk" | "idle" | "accent";
  /**
   * Optional uppercase mono label rendered beside the dot. Takes the status
   * colour, except `idle` — faint dot, `--text-muted` label.
   */
  label?: string;
  /** Force the pulse on/off. Defaults to on for `live`. */
  pulse?: boolean;
  size?: number;
  style?: React.CSSProperties;
}

/** 6px status dot, optionally pulsing — the system's "this is live" tell. */
export function StatusDot(props: StatusDotProps): JSX.Element;
