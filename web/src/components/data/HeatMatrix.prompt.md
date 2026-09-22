# HeatMatrix
A `role="table"` heat grid with column and row headers: the Credit transition-odds matrix and the Tools IRR sensitivity grid. Today's row or cell is outlined.

```jsx
<HeatMatrix
  preset="transition"
  ariaLabel="Credit state transition odds, 3 months"
  corner="From ↓ to →"
  rows={[{ key: "Normal", label: "Normal", current: true }, { key: "Tight", label: "Tight", empty: true }, …]}
  cols={[{ key: "Normal", label: "Normal" }, { key: "Tight", label: "Tight" }, …]}
  cells={rows.map((from) => cols.map((to) => ({ value: p(from, to), text: `${Math.round(p(from, to) * 100)}%` })))}
/>
<HeatMatrix preset="irr" ariaLabel="IRR sensitivity" corner="Entry ↓" rows={entry} cols={exit} cells={grid} currentCell={[2, 2]} legend={<>…</>} />
```

- Cells are precomputed by the consumer from stored data (`value` plus preformatted `text`). One number, one truth: nothing is re-derived here.
- Presets carry the metrics and the tint scale. `transition`: 84px row headers, 30px cells, mint on the diagonal (stay) and amber off it (move) at `0.55 × p` alpha, the current row outlined and marked "●". `irr`: 54px mono row headers, 34px cells, `irrTint` bands (20%+ mint, 15–20 neutral, below 15 red), one current cell outlined in white and bolded.
- The tint constants are derived fits to the mockup numbers (risk G12); adjust them inside `transitionTint` / `irrTint` without touching the API. Pass `tint` for another scale (signed returns, weights, correlations).
- `null` values print "n/a" in `--text-4` with the neutral tint; a row with no history (`empty: true`, or a missing cell row) prints the dash glyph with no tint.
- The `role="table"` grid is the root (it takes `id`, `style`, `className` and `data-*`); when `legend` is given, grid and legend sit side by side in a plain wrapper, never inside the table role.
- `ariaLabel` is required; the number sits in every cell so colour never carries meaning alone. Name the outline in the caption ("The outlined row is today's state"). Wrap in `ScrollTable stickyFirst={false}` below 768px as before.
