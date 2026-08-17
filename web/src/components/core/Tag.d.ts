export interface TagProps {
  tone?: "neutral" | "accent" | "pos" | "warn" | "hot" | "neg" | "research";
  size?: "sm" | "md";
  uppercase?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Small mono chip for alert levels, conviction, percentile ranks and source labels. */
export function Tag(props: TagProps): JSX.Element;
