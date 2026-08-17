export interface ReadThroughProps {
  label?: string;
  /** One string per paragraph. */
  paragraphs?: React.ReactNode[];
  /** Bold inline label for the footer row, e.g. "Playbook bias". */
  footerLabel?: string;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Long-form generated commentary panel with an accent rail. */
export function ReadThrough(props: ReadThroughProps): JSX.Element;
