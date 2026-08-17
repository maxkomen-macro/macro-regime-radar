export interface IntelBannerMeta {
  label: string;
  value: string;
  /** Value colour token, e.g. "var(--pos)". */
  color?: string;
}

export interface IntelBannerProps {
  eyebrow?: string;
  conviction?: "High" | "Medium" | "Low";
  /** One sentence. Never more — the long form belongs in ReadThrough. */
  headline: React.ReactNode;
  meta?: IntelBannerMeta[];
  /** Text of the trailing link, rendered as "→ {action}". */
  action?: string;
  onAction?: () => void;
  /**
   * Gates the eyebrow dot's pulse (owner ruling 2026-08-06): pass true only
   * when the content is new since the visitor's last look or under an age
   * threshold; false renders a static faint dot. Defaults to true.
   */
  live?: boolean;
  style?: React.CSSProperties;
}

/**
 * Top-of-dashboard summary banner with live rail and conviction badge.
 * @startingPoint section="Intelligence" subtitle="One-line market read with conviction" viewport="700x200"
 */
export function IntelBanner(props: IntelBannerProps): JSX.Element;
