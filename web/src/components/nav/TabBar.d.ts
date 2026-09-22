export interface TabBarProps {
  /** Strings, or {id,label} objects. */
  tabs?: (string | { id: string; label: string })[];
  active?: string;
  onChange?: (id: string) => void;
  /**
   * Finger-sized tabs (40px min height) for narrow viewports. Default false =
   * the desk row's compact height.
   */
  touch?: boolean;
  style?: React.CSSProperties;
}

/** Primary navigation — text tabs on a hairline rule, 2px accent underline when active. */
export function TabBar(props: TabBarProps): JSX.Element;
