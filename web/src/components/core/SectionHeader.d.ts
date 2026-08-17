export interface SectionHeaderProps {
  title: string;
  /** "section" = 11px uppercase with hairline rule; "sub" = 12px sentence case, no rule. */
  level?: "section" | "sub";
  /** Optional right-aligned meta (timestamp, count). Section level only. */
  right?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Labels a module. Direct port of shared_styles.section_header / subsection_header. */
export function SectionHeader(props: SectionHeaderProps): JSX.Element;
