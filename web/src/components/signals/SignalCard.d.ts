export type SignalTone = "clear" | "watch" | "alert" | "info" | "reference";

export interface SignalCardProps {
  /** Display name, e.g. "Curve inversion risk", "VIX spike". Any ReactNode. */
  name: React.ReactNode;
  /** Preformatted value including unit, e.g. "0.52%" or "16.90". */
  value: React.ReactNode;
  /** 0 to 100 threshold proximity. Without `status`, drives the derived label:
   *  <50 Clear, <75 Watch, else Triggered. */
  fillPct?: number;
  /**
   * Server-computed status override (2026-08-06, /api/signals/latest v1.2):
   * the stored triggered flag owns "Triggered", so near-threshold signals
   * read Watch instead of a false Triggered. Omit for legacy fill-derived.
   */
  status?: "Clear" | "Watch" | "Triggered";
  /** "Jan 2025", "none on file" or "Never" (default). `null` omits the line. */
  lastTriggered?: string | null;
  /** Meter label and meter. Default true. */
  showGauge?: boolean;
  /** Oldest to newest; renders the 118x30 sparkline only with two or more points. */
  sparkline?: number[];
  /** Label above the meter. Default "Threshold proximity". */
  meterLabel?: React.ReactNode;
  /** Mono lines after "Last alert:" (trigger sentence, print provenance). */
  lines?: React.ReactNode[];
  /** Overrides the badge text (credit "Normal", "Unavailable"); the tint still follows the status or `tone`. */
  badge?: React.ReactNode;
  /** Overrides the status tint for badge, meter and sparkline (credit tiers, `reference` when unavailable). */
  tone?: SignalTone;
  /** Element for the name. Default `span` (no outline entry); `h3` / `h4` opt in. */
  heading?: "h3" | "h4" | "span";
  /** Root element. Default `article`. */
  as?: "article" | "div";
  /** A caption under the lines (13px `--text-3`). */
  caption?: React.ReactNode;
  style?: React.CSSProperties;
  id?: string;
  className?: string;
  /** `aria-*`, `data-*` and any other DOM attribute spread onto the root. */
  [key: string]: unknown;
}

/**
 * A monitored macro signal: name, badge, value, sparkline, meter and mono lines.
 * @startingPoint section="Signals" subtitle="Signal tile with badge, sparkline and meter" viewport="700x220"
 */
export function SignalCard(props: SignalCardProps): JSX.Element;
