export interface CardProps {
  /** Border treatment. Maps to the signal-card border rules in shared_styles.py. */
  tone?: "default" | "watch" | "risk" | "clear" | "accent";
  /** Render the 3px left accent bar used on Market Intelligence / Read-through panels. */
  accentBar?: boolean;
  /** CSS padding value. Default `var(--pad-card)` (12px). */
  padding?: string;
  /** Background. Default `var(--surface)`; use `var(--void)` for terminal wells. */
  surface?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * Flat dark panel — the container every dashboard module sits in.
 * @startingPoint section="Core" subtitle="Panel surface with tone + accent bar" viewport="700x220"
 */
export function Card(props: CardProps): JSX.Element;
