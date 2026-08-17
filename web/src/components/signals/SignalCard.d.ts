export interface SignalCardProps {
  /** Display name, e.g. "Curve inversion risk", "VIX spike". */
  name: string;
  /** Preformatted value including unit, e.g. "0.52%" or "16.90". */
  value: React.ReactNode;
  /** 0–100 threshold proximity. Without `status`, drives the derived label:
   *  <50 Clear, <75 Watch, else Triggered. */
  fillPct?: number;
  /**
   * Server-computed status override (2026-08-06, /api/signals/latest v1.2):
   * the stored triggered flag owns "Triggered", so near-threshold signals
   * read Watch instead of a false Triggered. Omit for legacy fill-derived.
   */
  status?: "Clear" | "Watch" | "Triggered";
  /** "Jan 2025" or "Never". */
  lastTriggered?: string;
  showGauge?: boolean;
  style?: React.CSSProperties;
}

/**
 * A monitored macro signal with its distance-to-threshold gauge.
 * @startingPoint section="Signals" subtitle="Signal value, status dot, threshold gauge" viewport="700x200"
 */
export function SignalCard(props: SignalCardProps): JSX.Element;
