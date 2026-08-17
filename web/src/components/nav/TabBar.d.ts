export interface TabBarProps {
  /** Strings, or {id,label} objects. */
  tabs?: (string | { id: string; label: string })[];
  active?: string;
  onChange?: (id: string) => void;
  style?: React.CSSProperties;
}

/** Primary navigation — text tabs on a hairline rule, 2px accent underline when active. */
export function TabBar(props: TabBarProps): JSX.Element;
