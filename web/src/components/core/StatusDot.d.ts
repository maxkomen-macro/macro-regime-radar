export interface StatusDotProps {
  status?: "live" | "clear" | "watch" | "risk" | "idle" | "accent";
  /** Optional uppercase mono label rendered beside the dot. */
  label?: string;
  /** Force the pulse on/off. Defaults to on for `live`. */
  pulse?: boolean;
  size?: number;
  style?: React.CSSProperties;
}

/** 6px status dot, optionally pulsing — the system's "this is live" tell. */
export function StatusDot(props: StatusDotProps): JSX.Element;
