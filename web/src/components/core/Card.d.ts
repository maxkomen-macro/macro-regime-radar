export interface CardProps {
  /** Border colour: 1px at the badge alphas. `default` keeps the variant border. */
  tone?: "default" | "watch" | "risk" | "clear" | "accent";
  /**
   * Render as the callout: a 3px left rail in the tone colour, `0 8px 8px 0`
   * radius, `10px 14px` padding and an 8% horizontal wash; no outer border.
   */
  accentBar?: boolean;
  /** Surface: `panel` (12px radius, `--panel`, default), `tile` (9px, `--tile`,
   *  14px padding) or `card` (12px, the `--card-grad` gradient). */
  variant?: "panel" | "tile" | "card";
  /** Root element. Default `div`. */
  as?: "div" | "section" | "article";
  /** CSS padding value. Overrides the variant (and callout) padding. */
  padding?: string;
  /** Background override, e.g. `var(--void)` for terminal wells. */
  surface?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  id?: string;
  className?: string;
  /** `aria-*`, `data-*`, `role`, `key` and any other DOM attribute spread onto the root. */
  [key: string]: unknown;
}

/**
 * Panel, tile or card surface: the container every module sits in.
 * @startingPoint section="Core" subtitle="Panel / tile / card, tone borders, callout" viewport="700x220"
 */
export function Card(props: CardProps): JSX.Element;
