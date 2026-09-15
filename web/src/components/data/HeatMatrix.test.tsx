/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/HeatMatrix.test.tsx`; contract in section B.13 (a
 * `role=table` grid of columnheader / rowheader / cell spans, the current row
 * outlined in the transition preset, one outlined bold cell in the IRR preset,
 * and the exported derived tint scales `transitionTint` and `irrTint`).
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HeatMatrix, irrTint, transitionTint, type HeatCell } from "./HeatMatrix";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
/** U+2014, the dash glyph the current matrix prints for a row with no history (B.13). */
const DASH = String.fromCharCode(0x2014);

/** Parse `rgba(r,g,b,a)` (any spacing, alpha with or without the leading 0). */
function rgba(s: string): [number, number, number, number] {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/.exec(s);
  if (!m) throw new Error(`not an rgba colour: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
}

const STATES = ["Normal", "Tight", "Stressed", "Crisis"];
const cols = STATES.map((s) => ({ key: s.toLowerCase(), label: s }));
const transitionRows = (current = 0) => STATES.map((s, i) => ({ key: s.toLowerCase(), label: s, current: i === current }));
const pctCells = (grid: number[][]) => grid.map((row, i) => row.map((p, j) => ({ value: p / 100, text: `${p}%`, tint: transitionTint(p / 100, i === j) })));
const TRANSITION = [
  [88, 7, 5, 0],
  [31, 58, 11, 0],
  [14, 6, 72, 8],
  [0, 0, 39, 61],
];

const MULTIPLES = ["9.0×", "9.5×", "10.0×", "10.5×", "11.0×"];
const irrRows = MULTIPLES.map((m) => ({ key: m, label: m }));
const irrCols = MULTIPLES.map((m) => ({ key: m, label: m }));
const irrCells = (grid: (number | null)[][]) => grid.map((row) => row.map((v) => ({ value: v, text: v == null ? "n/a" : `${v.toFixed(1)}%`, tint: irrTint(v) })));
const IRR: (number | null)[][] = [
  [10.0, 12.3, 14.9, 17.2, 19.3],
  [12.3, 14.9, 17.2, 19.3, 21.6],
  [13.4, 16.1, 20.1, 21.6, 23.3],
  [14.9, 17.2, 21.6, 23.3, 25.3],
  [16.1, 19.3, 23.3, 25.3, 28.7],
];

describe("HeatMatrix (checklist 02 B.13)", () => {
  it("renders role=table with columnheaders and rowheaders", () => {
    render(<HeatMatrix preset="transition" ariaLabel="Credit state odds, 3 months" corner="From ↓ to →" rows={transitionRows()} cols={cols} cells={pctCells(TRANSITION)} />);
    const table = screen.getByRole("table", { name: "Credit state odds, 3 months" });
    expect(table).toHaveClass("mrr-heat");
    expect(table.style.display).toBe("grid");
    expect(table.style.gridTemplateColumns).toMatch(/^84px repeat\(4, ?minmax\(0, ?1fr\)\)$/);
    expect(table.style.gap).toBe("4px");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.style.display).toBe("contents");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["From ↓ to →", ...STATES]);
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders.map((h) => h.textContent?.replace(/\s*●$/, ""))).toEqual(STATES);
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(16);
    expect(cells.map((c) => c.textContent).slice(0, 4)).toEqual(["88%", "7%", "5%", "0%"]);
    expect(cells[0].style.height).toBe("30px");
    expect(cells[0].style.borderRadius).toBe("5px");
    expect(cells[0].style.fontVariantNumeric).toBe("tabular-nums");
  });

  it("outlines every cell of the current row", () => {
    render(<HeatMatrix preset="transition" ariaLabel="Odds" rows={transitionRows(1)} cols={cols} cells={pctCells(TRANSITION)} />);
    const rows = screen.getAllByRole("row").slice(1);
    const outlined = (row: HTMLElement) => within(row).getAllByRole("cell").filter((c) => /solid/.test(css(c)));
    expect(outlined(rows[1])).toHaveLength(4);
    for (const c of outlined(rows[1])) expect(css(c)).toMatch(/outline(?:-style)?:[^;]*solid/);
    expect(css(outlined(rows[1])[0])).toMatch(/rgba\(255, ?255, ?255, ?0?\.28\)/);
    expect(outlined(rows[0])).toHaveLength(0);
    expect(outlined(rows[2])).toHaveLength(0);
    expect(outlined(rows[3])).toHaveLength(0);
    // The current row header carries aria-current and the aria-hidden marker.
    const current = within(rows[1]).getByRole("rowheader");
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current.textContent).toMatch(/Tight/);
    const marker = current.querySelector("[aria-hidden='true']");
    expect(marker?.textContent).toMatch(/●/);
    expect(css(current)).toMatch(/color:\s*(?:#fff|rgb\(255, ?255, ?255\))/);
    expect(within(rows[0]).getByRole("rowheader")).not.toHaveAttribute("aria-current");
    expect(within(rows[0]).getByRole("rowheader").querySelector("[aria-hidden='true']")).toBeNull();
    // Diagonal mint, off-diagonal amber, by the computed tints.
    const cells = within(rows[1]).getAllByRole("cell");
    expect(rgba(css(cells[1])).slice(0, 3)).toEqual([38, 220, 160]);
    expect(rgba(css(cells[0])).slice(0, 3)).toEqual([245, 181, 46]);
  });

  it("currentCell outlines one cell and bolds it", () => {
    render(<HeatMatrix preset="irr" ariaLabel="IRR sensitivity" corner="Entry ↓" rows={irrRows} cols={irrCols} cells={irrCells(IRR)} currentCell={[2, 2]} />);
    const table = screen.getByRole("table", { name: "IRR sensitivity" });
    expect(table.style.gridTemplateColumns).toMatch(/^54px repeat\(5, ?minmax\(0, ?1fr\)\)$/);
    expect(table.style.gap).toBe("5px");
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(25);
    const outlined = cells.filter((c) => /outline(?:-style)?:[^;]*solid/.test(css(c)));
    expect(outlined).toHaveLength(1);
    const current = outlined[0];
    expect(current.textContent).toBe("20.1%");
    expect(css(current)).toMatch(/outline(?:-width)?:[^;]*1\.5px/);
    expect(css(current)).toMatch(/outline(?:-color)?:[^;]*(?:#fff|rgb\(255, ?255, ?255\))/);
    expect(current.style.fontWeight).toBe("600");
    expect(cells[0].style.fontWeight).not.toBe("600");
    expect(cells[0].style.height).toBe("34px");
    expect(cells[0].style.borderRadius).toBe("6px");
    // No row-level outline in the IRR preset.
    expect(within(table).queryByRole("rowheader", { current: true })).toBeNull();
  });

  it("transitionTint scales alpha by probability and hue by diagonal", () => {
    const stay = rgba(transitionTint(0.88, true));
    expect(stay.slice(0, 3)).toEqual([38, 220, 160]);
    expect(stay[3]).toBeCloseTo(0.484, 3);
    const move = rgba(transitionTint(0.07, false));
    expect(move.slice(0, 3)).toEqual([245, 181, 46]);
    expect(move[3]).toBeCloseTo(0.0385, 3);
    expect(rgba(transitionTint(0.58, true))[3]).toBeCloseTo(0.319, 3);
    expect(rgba(transitionTint(0.31, false))[3]).toBeCloseTo(0.1705, 3);
    expect(rgba(transitionTint(0, true))[3]).toBeCloseTo(0, 5);
    expect(rgba(transitionTint(1, false))[3]).toBeCloseTo(0.55, 5);
  });

  it("irrTint bands at 15 and 20", () => {
    const green = (irr: number) => {
      const c = rgba(irrTint(irr));
      expect(c.slice(0, 3), String(irr)).toEqual([38, 220, 160]);
      return c[3];
    };
    const red = (irr: number) => {
      const c = rgba(irrTint(irr));
      expect(c.slice(0, 3), String(irr)).toEqual([240, 80, 63]);
      return c[3];
    };
    const neutral = (irr: number | null) => {
      const c = rgba(irrTint(irr));
      expect(c.slice(0, 3), String(irr)).toEqual([150, 175, 200]);
      expect(c[3], String(irr)).toBeCloseTo(0.07, 5);
    };
    expect(green(20)).toBeCloseTo(0.12, 4);
    expect(green(20.1)).toBeCloseTo(0.123, 3);
    expect(green(21.6)).toBeCloseTo(0.168, 3);
    expect(green(28.7)).toBeCloseTo(0.381, 3);
    expect(green(40)).toBeCloseTo(0.4, 5); // capped
    neutral(15);
    neutral(17.2);
    neutral(19.99);
    neutral(null);
    expect(red(14.9)).toBeCloseTo(0.1036, 4);
    expect(red(13.4)).toBeCloseTo(0.1576, 4);
    expect(red(10)).toBeCloseTo(0.28, 4);
    expect(red(0)).toBeCloseTo(0.3, 5); // capped
  });

  it("null cells print n/a", () => {
    const grid: (number | null)[][] = IRR.map((r) => [...r]);
    grid[0][4] = null;
    render(<HeatMatrix preset="irr" ariaLabel="IRR sensitivity" rows={irrRows} cols={irrCols} cells={irrCells(grid)} currentCell={[2, 2]} />);
    const cell = screen.getByRole("cell", { name: "n/a" });
    expect(cell.textContent).toBe("n/a");
    expect(cell.style.color).toBe("var(--text-4)");
    const tint = rgba(css(cell));
    expect(tint.slice(0, 3)).toEqual([150, 175, 200]);
    expect(tint[3]).toBeCloseTo(0.07, 5);
    expect(css(cell)).not.toMatch(/outline(?:-style)?:[^;]*solid/);
    expect(screen.getAllByRole("cell").filter((c) => c.textContent === "n/a")).toHaveLength(1);
  });

  it("dash rows render without tint", () => {
    const cells: HeatCell[][] = pctCells(TRANSITION);
    cells[1] = STATES.map(() => ({ value: null, text: DASH })); // Tight: no history (C18)
    render(<HeatMatrix preset="transition" ariaLabel="Odds" rows={transitionRows(0)} cols={cols} cells={cells} />);
    const rows = screen.getAllByRole("row").slice(1);
    const dashes = within(rows[1]).getAllByRole("cell");
    expect(dashes).toHaveLength(4);
    for (const c of dashes) {
      expect(c.textContent).toBe(DASH);
      expect(c.style.color).toBe("var(--text-3)");
      expect(css(c)).not.toMatch(/rgba\(/);
      expect(css(c)).not.toMatch(/outline(?:-style)?:[^;]*solid/);
    }
    // The other rows keep their tints and the current row keeps its outline.
    const normal = within(rows[0]).getAllByRole("cell");
    expect(css(normal[0])).toMatch(/rgba\(38, ?220, ?160/);
    expect(normal.filter((c) => /solid/.test(css(c)))).toHaveLength(4);
    // Empty cells render the headers only.
    const empty = render(<HeatMatrix preset="transition" ariaLabel="Empty" rows={[]} cols={cols} cells={[]} />).container;
    expect(within(empty).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(empty).queryAllByRole("cell")).toHaveLength(0);
  });
});
