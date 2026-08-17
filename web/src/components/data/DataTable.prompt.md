# DataTable
Dense terminal grid — watchlists, OAS spreads, transition matrices, backtest pivots.

```jsx
<DataTable
  columns={[{key:"sym",label:"Sym",mono:true},{key:"chg",label:"1D Chg",align:"right",mono:true}]}
  rows={rows}
/>
```

- Every numeric column gets `mono: true` — tabular figures are non-negotiable.
- Column headers are 9px uppercase with 1.5px tracking. Cells are 12px.
- Use `render` to colour a cell by sign; don't put colour logic in the data.