export interface NewsCardProps {
  /** Feed name, e.g. "FINNHUB" or "NEWSAPI". */
  source?: string;
  time?: string;
  ticker?: string;
  headline: React.ReactNode;
  /** Original article URL; the headline links out and a "Read at source" line renders (2026-09-05). */
  href?: string;
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
  /** Phase 8: "row" (default, the list row) or "lead" (the priority tile). */
  variant?: "row" | "lead";
  /** Category badge word (MACRO, M&A, EARN, GEO, SECTOR); no badge when absent. */
  category?: string;
  categoryTone?: "info" | "watch" | "reference";
  /** Ticker or deal-size chip and its title ("Ticker" / "M&A deal size"). */
  chip?: string;
  chipTitle?: string;
  /** Row variant: the ET clock ("15:41 ET"). */
  clock?: string;
  /** Perplexity research body (rendered under its attribution line). */
  research?: React.ReactNode;
  /** Lead variant: the four sub-scores behind "Score breakdown", each [label, value | null]. */
  dims?: Array<[string, number | null]>;
  /** Fallback coverage: prints "stored · stale" in the footer. */
  stale?: boolean;
}

/**
 * Headline card from the news pipeline, with AI interpretation and cited sources.
 * @startingPoint section="Intelligence" subtitle="Headline, significance, AI read-out" viewport="700x260"
 */
export function NewsCard(props: NewsCardProps): JSX.Element;
