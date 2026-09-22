export interface HeatCell {
  /** The stored number (probability 0..1, IRR in percent, …); null prints "n/a". */
  value: number | null;
  /** Preformatted cell text ("88%", "18.5%"). */
  text: React.ReactNode;
  /** Explicit background; the default tint reads it when no preset or `tint` applies. */
  tint?: string;
  /** Bold the cell without outlining it. */
  strong?: boolean;
}

export interface HeatRow {
  key: string;
  label: React.ReactNode;
  /** Today's row: outlined (row mode) and marked with an aria-hidden "●". */
  current?: boolean;
  /** No history: every cell renders the dash glyph with no tint. */
  empty?: boolean;
}

export interface HeatCol {
  key: string;
  label: React.ReactNode;
}

export interface HeatMatrixProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  rows: HeatRow[];
  cols: HeatCol[];
  /** rows × cols, precomputed by the consumer from stored data (never re-derived here).
   *  A missing or empty row renders as dashes; an empty array renders the headers only. */
  cells: (HeatCell[] | null | undefined)[];
  /** Custom background per cell. Default: the preset scale, else `cell.tint ?? "transparent"`. */
  tint?: (cell: HeatCell, rowIndex: number, colIndex: number) => string;
  /** "transition" (credit 4×4: 30px cells, row outline, transitionTint) or
   *  "irr" (tools 5×5: 34px cells, cell outline, irrTint). */
  preset?: "transition" | "irr";
  /** Corner header text ("From ↓ to →", "Entry ↓"). */
  corner?: React.ReactNode;
  /** [rowIndex, colIndex] to outline one cell (1.5px white, bold). */
  currentCell?: [number, number];
  /** Which highlight applies; default from the preset ("row" for transition, "cell" for irr). */
  outline?: "row" | "cell";
  /** Rendered under the grid in the 12.5px caption row (flex, 16px gap). */
  legend?: React.ReactNode;
  /** Accessible name of the grid (the visible title is an eyebrow). */
  ariaLabel: string;
  rowHeaderWidth?: number;
  cellHeight?: number;
  gap?: number;
  style?: React.CSSProperties;
  id?: string;
}

/** role=table heat grid with column and row headers; today's row or cell outlined. */
export function HeatMatrix(props: HeatMatrixProps): JSX.Element;

/** Credit transition tint: rgba(38,220,160, 0.55·p) on the diagonal, rgba(245,181,46, 0.55·p) off it. */
export function transitionTint(p: number | null | undefined, onDiagonal: boolean): string;

/** IRR tint bands: ≥20 mint (.12 + .03·(irr−20), cap .40), 15–20 neutral, <15 red (.10 + .036·(15−irr), cap .30), null neutral. */
export function irrTint(irr: number | null | undefined): string;
