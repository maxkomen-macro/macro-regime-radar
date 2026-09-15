/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/DataTable.test.tsx`; contract in section B.11 (mockup
 * `.tbl`: `th[scope=col]`, group rows spanning every column, `compact`
 * padding, column `sub` labels, `zebra`, `caption`, `hideHeader`).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable } from "./DataTable";

const COLUMNS = [
  { key: "sym", label: "Symbol" },
  { key: "last", label: "Last", align: "right" as const, mono: true },
  { key: "d1", label: "1D", align: "right" as const, mono: true },
];
const ROWS = [
  { id: "spy", sym: "SPY", name: "SPDR S&P 500", last: "645.20", d1: "+0.28%" },
  { id: "qqq", sym: "QQQ", name: "Invesco QQQ", last: "572.90", d1: "-0.14%" },
  { id: "tlt", sym: "TLT", name: "20Y+ Treasury", last: "88.12", d1: "-0.64%" },
];

const bodyRows = (table: HTMLElement) => [...(table.querySelector("tbody")?.querySelectorAll("tr") ?? [])];

describe("DataTable (checklist 02 B.11)", () => {
  it("renders th scope=col per column", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers.map((h) => h.textContent)).toEqual(["Symbol", "Last", "1D"]);
    for (const h of headers) {
      expect(h).toHaveAttribute("scope", "col");
      expect(h.style.textTransform).toBe("uppercase");
      expect(h.getAttribute("style") ?? "").toMatch(/var\(--font-mono\)/);
    }
    expect(headers[1].style.textAlign).toBe("right");
    expect(headers[0].style.textAlign).toBe("left");
    expect(headers[0].style.paddingLeft).toMatch(/^0(?:px)?$/);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    // Cells read in --text now, with tabular figures everywhere.
    const cell = screen.getByText("645.20");
    expect(cell.style.color).toBe("var(--text)");
    expect(cell.style.fontVariantNumeric).toBe("tabular-nums");
    expect(cell.getAttribute("style") ?? "").toMatch(/var\(--font-mono\)/);
    expect(screen.getByText("SPY").getAttribute("style") ?? "").toMatch(/var\(--font-ui\)/);
  });

  it("groups render a spanning group row before each group's rows", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        groups={[
          { label: "Equities", rows: ROWS.slice(0, 2) },
          { label: "Rates", rows: ROWS.slice(2) },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    const rows = bodyRows(table);
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      "Equities",
      expect.stringContaining("SPY"),
      expect.stringContaining("QQQ"),
      "Rates",
      expect.stringContaining("TLT"),
    ]);
    const group = rows[0];
    expect(group).toHaveClass("mrr-grp");
    const td = group.querySelector("td") as HTMLTableCellElement;
    expect(group.querySelectorAll("td")).toHaveLength(1);
    expect(td.colSpan).toBe(3);
    expect(td.style.textTransform).toBe("uppercase");
    expect(td.style.color).toBe("var(--text-4)");
    expect(td.getAttribute("style") ?? "").toMatch(/var\(--font-mono\)/);
    // Group rows are real rows: screen readers read the group name.
    expect(within(table).getByRole("row", { name: /Equities/ })).toBeInTheDocument();
  });

  it("compact tightens cell padding", () => {
    const { unmount } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const roomy = screen.getByText("645.20");
    expect(roomy.style.padding).toBe("8px 10px");
    unmount();
    render(<DataTable columns={COLUMNS} rows={ROWS} compact />);
    const tight = screen.getByText("645.20");
    expect(tight.style.padding).toBe("6px 8px");
    // The first column keeps a flush left edge in both densities.
    expect(screen.getByText("SPY").style.paddingLeft).toMatch(/^0(?:px)?$/);
  });

  it("sub renders the secondary label", () => {
    render(<DataTable columns={[{ ...COLUMNS[0], sub: (row: (typeof ROWS)[number]) => row.name }, COLUMNS[1]]} rows={ROWS} />);
    const cell = screen.getByText("SPY").closest("td") as HTMLTableCellElement;
    const sub = within(cell).getByText("SPDR S&P 500");
    expect(sub.tagName).toBe("SPAN");
    expect(sub).toHaveClass("mrr-nm");
    expect(sub.style.fontSize).toBe("11.5px");
    expect(sub.style.color).toBe("var(--text-3)");
    expect(sub.style.marginLeft).toBe("6px");
    // Inline after the symbol, in the same cell.
    expect(cell.textContent).toBe("SPYSPDR S&P 500");
    expect(screen.queryByText("Invesco QQQ")).not.toBeNull();
  });

  it("zebra false removes banding", () => {
    const { unmount } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const banded = bodyRows(screen.getByRole("table"));
    expect(banded[1].getAttribute("style") ?? "").toMatch(/rgba\(255, ?255, ?255, ?0?\.012\)/);
    unmount();
    render(<DataTable columns={COLUMNS} rows={ROWS} zebra={false} />);
    for (const row of bodyRows(screen.getByRole("table"))) {
      expect(row.getAttribute("style") ?? "").not.toMatch(/rgba\(255, ?255, ?255/);
    }
  });

  it("caption renders", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} caption="Macro tape" hideHeader />);
    const table = screen.getByRole("table", { name: "Macro tape" });
    const caption = table.querySelector("caption") as HTMLElement;
    expect(caption).not.toBeNull();
    expect(caption).toHaveTextContent("Macro tape");
    expect(caption).toHaveClass("sr-only");
    expect(table.querySelector("thead")).toBeNull();
    expect(screen.queryByRole("columnheader")).toBeNull();
    expect(screen.getByText("SPY")).toBeInTheDocument();
    // Without the prop there is no caption and the header is back.
    const plain = render(<DataTable columns={COLUMNS} rows={[]} />).container;
    expect(plain.querySelector("caption")).toBeNull();
    expect(plain.querySelectorAll("th")).toHaveLength(3);
    expect(plain.querySelector("tbody")?.querySelectorAll("tr")).toHaveLength(0);
  });
});

/* ── redesign Phase 5 (checklist 05 A.12 / E.1): appended case ─────────────── */

describe("DataTable rowProps (checklist 05 A.12)", () => {
  it("spreads data-*, onClick and a merged style onto each data row, never onto group rows, and reproduces the plain output when omitted", () => {
    const onClick = vi.fn();
    const rowProps = (row: (typeof ROWS)[number], index: number) => ({
      "data-clickable": "",
      "data-selected": row.id === "qqq" ? "true" : "false",
      "data-index": String(index),
      onClick,
      style: index === 1 ? { animation: "mrr-flash-up 600ms ease-out" } : undefined,
    });
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        groups={[
          { label: "Equities", rows: ROWS.slice(0, 2) },
          { label: "Rates", rows: ROWS.slice(2) },
        ]}
        rowProps={rowProps}
      />,
    );
    const rows = bodyRows(screen.getByRole("table"));
    const data = rows.filter((r) => !r.classList.contains("mrr-grp"));
    const groups = rows.filter((r) => r.classList.contains("mrr-grp"));
    expect(data).toHaveLength(3);
    expect(groups).toHaveLength(2);
    for (const r of data) expect(r.hasAttribute("data-clickable")).toBe(true);
    expect(data.map((r) => r.getAttribute("data-selected"))).toEqual(["false", "true", "false"]);
    // The index is the row's position inside its group (the callback's second argument).
    expect(data.map((r) => r.getAttribute("data-index"))).toEqual(["0", "1", "0"]);
    // `style` merges over the zebra background: the second row keeps its band and gains the animation.
    expect(data[1].getAttribute("style") ?? "").toMatch(/rgba\(255, ?255, ?255, ?0?\.012\)/);
    expect(data[1].getAttribute("style") ?? "").toMatch(/mrr-flash-up/);
    expect(data[0].getAttribute("style") ?? "").not.toMatch(/mrr-flash/);
    // Clicking a cell fires the row handler once; the row is the target, not the cell.
    fireEvent.click(screen.getByText("645.20"));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(data[2]);
    expect(onClick).toHaveBeenCalledTimes(2);
    // Group rows never receive the attributes or the handler.
    for (const g of groups) {
      expect(g.hasAttribute("data-clickable")).toBe(false);
      expect(g.hasAttribute("data-selected")).toBe(false);
      expect(g.hasAttribute("data-index")).toBe(false);
      fireEvent.click(g);
    }
    expect(onClick).toHaveBeenCalledTimes(2);

    // Omitted (or returning nothing) reproduces today's output byte for byte.
    const plain = render(<DataTable columns={COLUMNS} rows={ROWS} />).container.innerHTML;
    const empty = render(<DataTable columns={COLUMNS} rows={ROWS} rowProps={() => ({})} />).container.innerHTML;
    const explicit = render(<DataTable columns={COLUMNS} rows={ROWS} rowProps={undefined} />).container.innerHTML;
    expect(empty).toBe(plain);
    expect(explicit).toBe(plain);
    expect(plain).not.toContain("data-clickable");
  });
});
