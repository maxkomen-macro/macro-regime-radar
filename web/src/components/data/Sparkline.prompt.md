# Sparkline
Inline micro-chart for trend at a glance. 1.5px stroke, 10% area fill, no axes or labels.

```jsx
<Sparkline values={[3.1, 3.4, 3.2, 3.9, 4.1]} width={120} height={30} />
```

- Default colour is the brand accent; pass `color="var(--pos)"` / `"var(--neg)"` when the series direction carries meaning.
- Never add tooltips or gridlines here — that's a real chart's job.