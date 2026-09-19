export interface RegimeProbabilities {
  goldilocks?: number;
  overheating?: number;
  stagflation?: number;
  recession?: number;
}

export interface ProbabilityBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Softmax probabilities 0–1, keyed like `regimes.prob_*`. */
  probs?: RegimeProbabilities;
  showLegend?: boolean;
  /** Bar height in px. Default 8. */
  height?: number;
  /** Gap between segments in px. Default 2. */
  gap?: number;
  /** Legend abbreviations: "abbr" GL OV ST RR (default) or "letter" G O S R. */
  legend?: "abbr" | "letter";
  /** "fixed" keeps the classifier order (default); "desc" sorts by share. */
  order?: "fixed" | "desc";
  /** Iteration 1 (A2): the served probabilities (null when not served),
   * keyed like `probs`. Each legend entry then carries
   * `data-metric="odds-<regime>"` and `data-metric-value` (the served
   * number, unformatted). */
  metrics?: { goldilocks?: number | null; overheating?: number | null; stagflation?: number | null; recession?: number | null };
  style?: React.CSSProperties;
}

/** Stacked four-regime distribution bar with 2px gaps and a mono legend. */
export function ProbabilityBar(props: ProbabilityBarProps): JSX.Element;
