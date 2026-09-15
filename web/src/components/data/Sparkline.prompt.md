# Sparkline
Inline micro-chart for trend at a glance. 1.5px stroke, a 10% flat fill or a 28%→0 gradient under the line, no axes or labels.

```jsx
<Sparkline values={series} width={118} height={30} color="var(--mint)" fill={false} strokeWidth={1.4} />
<Sparkline values={series} width={80} height={26} color="var(--pos)" gradient />
```

- Default colour is the brand accent; pass `color="var(--pos)"` / `"var(--neg)"` / `"var(--mint)"` / `"var(--amber)"` when the series direction or status carries meaning.
- `gradient` swaps the flat fill for a vertical fade (`gradientOpacity` .28 by default, .22 on hero areas). Gradient ids come from `useId`, so any number of sparklines can share a page.
- Sizes in use: 118×30 signal cards (stroke 1.4), 80×26 strip quotes, 48×16 tape and 36×18 watchlist (stroke 1.3).
- The SVG is `aria-hidden`; the adjacent text carries the number. Never add tooltips or gridlines here; that's a real chart's job.
