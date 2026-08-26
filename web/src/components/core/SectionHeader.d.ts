export interface SectionHeaderProps {
  title: string;
  /** "section" = 11px uppercase with hairline rule; "sub" = 12px sentence case, no rule. */
  level?: "section" | "sub";
  /**
   * Override the rendered element. Defaults to the semantic heading for the
   * level: "section" → `h2`, "sub" → `h3`. Use `"h4"` when a sub sits under
   * another sub, or `"div"` when the label is decorative and would otherwise
   * inject a phantom node into the outline. `h1` is deliberately not offered —
   * the wordmark is the page's only h1.
   */
  as?: "h2" | "h3" | "h4" | "div";
  /** Optional right-aligned meta (timestamp, count). Section level only. */
  right?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Labels a module. Direct port of shared_styles.section_header / subsection_header. */
export function SectionHeader(props: SectionHeaderProps): JSX.Element;
