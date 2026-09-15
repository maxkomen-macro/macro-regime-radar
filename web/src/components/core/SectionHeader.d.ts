export interface SectionHeaderProps {
  /** Short noun phrase; any ReactNode (a Jargon term can sit inside). */
  title: React.ReactNode;
  /** "section" = the 12px Plex Sans eyebrow (.24em, uppercase, `--text-eyebrow`);
   *  "sub" = the 11px sub-eyebrow (.2em, `--text-3`), no layout slots. */
  level?: "section" | "sub";
  /**
   * Override the rendered element. Defaults to the semantic heading for the
   * level: "section" is `h2`, "sub" is `h3`. Use `"h4"` when a sub sits under
   * another sub, or `"div"` when the label is decorative and would otherwise
   * inject a phantom node into the outline. `h1` is deliberately not offered.
   */
  as?: "h2" | "h3" | "h4" | "div";
  /** Right-aligned mono meta (timestamp, count, a Tag). Section level only.
   *  In the inline layout it stays inside the heading element. */
  right?: React.ReactNode;
  /**
   * "inline" (default): today's DOM, one heading with the title and `right`
   * spans. "panel": the mockup `.sec-head`, a `div.mrr-sec-head` wrapper with
   * the heading (title only), the `description` span and a `div.mrr-sec-sp`
   * holding `right` as meta and then `actions`.
   */
  layout?: "inline" | "panel";
  /** Plain-text description after the eyebrow (panel layout). 13px `--text-2`. */
  description?: React.ReactNode;
  /** A Segmented control, a `<Link className="mrr-link">` or a ghost button (panel layout). */
  actions?: React.ReactNode;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  /** `aria-*`, `data-*` and any other DOM attribute spread onto the root. */
  [key: string]: unknown;
}

/** Labels a module: the section eyebrow, with optional description, meta and actions. */
export function SectionHeader(props: SectionHeaderProps): JSX.Element;
