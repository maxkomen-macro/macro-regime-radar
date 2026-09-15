# DataTable
Dense terminal grid on the mockup `.tbl` styling: the macro tape, the debt schedule, backtest pivots, weights by method.

```jsx
<DataTable
  compact
  zebra={false}
  caption="Macro tape"
  columns={[
    { key: "sym", label: "Symbol", mono: true, sub: (r) => r.name },
    { key: "last", label: "Last", align: "right", mono: true },
    { key: "d1", label: "1D", align: "right", mono: true, render: (r) => <span style={{ color: r.d1 >= 0 ? "var(--pos)" : "var(--neg)" }}>{r.d1}%</span> },
  ]}
  groups={[{ label: "Equities", rows: eq }, { label: "Rates", rows: rates }]}
/>
```

- Headers are mono 10.5px uppercase with `.1em` tracking under a 1px `--line` rule; cells are 13px in `--text` with 1px `--line-2` dividers and tabular figures always. Numeric columns still set `mono: true` and `align: "right"`.
- `groups` renders a real spanning row (mono 10.5px, `.14em`, `--text-4`) before each group's rows, so screen readers hear the group name. `rows` is ignored when `groups` is given.
- `sub(row)` prints a secondary label (11.5px `--text-3`) inline after the cell; `subBlock` puts it on its own line.
- `compact` tightens cells to 6px 8px. `zebra` stays on by default; pass `zebra={false}` for the mockup look. `caption` adds a visually hidden table name; `hideHeader` drops the header row.
- Use `render` to colour a cell by sign; keep colour logic out of the data. Horizontal scrolling and the sticky first column stay `ScrollTable`'s job.
