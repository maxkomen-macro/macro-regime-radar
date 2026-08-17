export interface RegimeProbabilities {
  goldilocks?: number;
  overheating?: number;
  stagflation?: number;
  recession?: number;
}

export interface ProbabilityBarProps {
  /** Softmax probabilities 0–1, keyed like `regimes.prob_*`. */
  probs?: RegimeProbabilities;
  showLegend?: boolean;
  height?: number;
  style?: React.CSSProperties;
}

/** Stacked four-regime distribution bar with GL / OV / ST / RR legend. */
export function ProbabilityBar(props: ProbabilityBarProps): JSX.Element;
