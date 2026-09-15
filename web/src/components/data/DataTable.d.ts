export interface DataTableColumn {
  key: string;
  label: React.ReactNode;
  align?: "left" | "right" | "center";
  /** Render the cell in mono; use it for every number. Figures are tabular in every cell. */
  mono?: boolean;
  width?: string;
  render?: (row: any) => React.ReactNode;
  /** Secondary label after the cell content (11.5px --text-3), e.g. the name beside a symbol. */
  sub?: (row: any) => React.ReactNode;
  /** Render `sub` on its own line (`.nm` block form) instead of inline. */
  subBlock?: boolean;
}

export interface DataTableGroup {
  key?: string;
  /** Group row text (mono 10.5px uppercase eyebrow spanning every column). */
  label: React.ReactNode;
  rows: any[];
}

export interface DataTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  columns?: DataTableColumn[];
  rows?: any[];
  /** Faint 1.2%-white banding on odd rows. Default true; pass false for the mockup look. */
  zebra?: boolean;
  /** Tighter cells (6px 8px) for tapes. */
  compact?: boolean;
  /** Grouped rows with a spanning group row before each group; `rows` is ignored when given. */
  groups?: DataTableGroup[];
  /** Default for every column's `subBlock`. */
  subBlock?: boolean;
  /** Visually hidden `<caption>` for an accessible table name. */
  caption?: React.ReactNode;
  hideHeader?: boolean;
  style?: React.CSSProperties;
}

/**
 * Dense data grid: the macro tape, debt schedules, backtest pivots, weights by method.
 * @startingPoint section="Data" subtitle="Dense terminal table with mono numerics" viewport="700x260"
 */
export function DataTable(props: DataTableProps): JSX.Element;
