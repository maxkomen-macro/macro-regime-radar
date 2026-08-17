export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Render the cell in mono with tabular figures — use for every number. */
  mono?: boolean;
  width?: string;
  render?: (row: any) => React.ReactNode;
}

export interface DataTableProps {
  columns?: DataTableColumn[];
  rows?: any[];
  /** Faint 1.2%-white banding on odd rows. Default true. */
  zebra?: boolean;
  style?: React.CSSProperties;
}

/**
 * Dense data grid — watchlists, OAS spread tables, transition matrices.
 * @startingPoint section="Data" subtitle="Dense terminal table with mono numerics" viewport="700x260"
 */
export function DataTable(props: DataTableProps): JSX.Element;
