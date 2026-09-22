export type TagTone =
  | "clear"
  | "watch"
  | "alert"
  | "info"
  | "reference"
  | "hot"
  | "research"
  /** Pre-redesign aliases: pos = clear, warn = watch, neg = alert, accent = info, neutral = reference. */
  | "neutral"
  | "accent"
  | "pos"
  | "warn"
  | "neg";

export interface TagProps {
  /** Default `reference`. The old names still resolve to the same tints. */
  tone?: TagTone;
  /** `xs` 20px (ticker chip, Beat / Miss), `sm` 24px (default, the standard badge), `md` 28px. */
  size?: "xs" | "sm" | "md";
  /** `false` drops the CSS uppercase and the .1em tracking (sentence-case badges). */
  uppercase?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  id?: string;
  className?: string;
  /** `aria-*`, `data-*`, `title` and any other DOM attribute spread onto the span. */
  [key: string]: unknown;
}

/** Mono uppercase badge: 1px tinted border, 7% tinted fill, 7px radius. */
export function Tag(props: TagProps): JSX.Element;
