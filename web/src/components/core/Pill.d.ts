export type PillTone = "mint" | "amber" | "gray" | "overheating" | "stagflation";

export interface PillProps {
  /** Default `mint` (glow). `amber` glows amber, `gray` casts no shadow; the
   *  regime tints `overheating` / `stagflation` are what RegimeBadge composes. */
  tone?: PillTone;
  /** `md` 40px (default, the hero pill), `sm` 28px (top bar, table rows). */
  size?: "md" | "sm";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  /** `aria-*`, `data-*`, `title` and any other DOM attribute spread onto the span. */
  [key: string]: unknown;
}

/** `<span class="mrr-pill" data-tone>`: the mono uppercase probability pill. */
export function Pill(props: PillProps): JSX.Element;
