export interface NewsCardProps {
  /** Feed name, e.g. "FINNHUB" or "NEWSAPI". */
  source?: string;
  time?: string;
  ticker?: string;
  headline: React.ReactNode;
  summary?: React.ReactNode;
  /** Overall significance. Colours the SIG readout. */
  significance?: number;
  /**
   * Scale the significance bands read against (2026-08-06 extension, default
   * keeps legacy): 10 → ≥7 red / ≥5 hot / ≥4 amber; 5 → the pipeline's own
   * ladder, ≥4.5 red / ≥3.5 hot / ≥2.5 amber, and the readout says "/ 5".
   */
  sigScale?: 10 | 5;
  /** Claude's regime interpretation (news_feed.regime_interpretation). */
  interpretation?: React.ReactNode;
  /** Perplexity citation URLs (news_feed.perplexity_research). */
  sources?: string[];
  /** Collapse the detail behind a toggle. Default true. */
  expandable?: boolean;
  style?: React.CSSProperties;
}

/**
 * Headline card from the news pipeline, with AI interpretation and cited sources.
 * @startingPoint section="Intelligence" subtitle="Headline, significance, AI read-out" viewport="700x260"
 */
export function NewsCard(props: NewsCardProps): JSX.Element;
