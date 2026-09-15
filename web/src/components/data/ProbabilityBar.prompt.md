# ProbabilityBar
The four softmax regime probabilities as one stacked bar (regime hues, 2px gaps, 4px radius) plus a mono 11px legend.

```jsx
<ProbabilityBar probs={{ goldilocks: 0.64, overheating: 0.22, stagflation: 0.05, recession: 0.09 }} />
<ProbabilityBar probs={probs} height={5} showLegend={false} />
```

- Order is fixed (Goldilocks → Overheating → Stagflation → Recession Risk) so the shape is comparable across screens. `order="desc"` and `legend="letter"` reproduce the mockup's "G 64 · O 22 · R 9 · S 5" if the design lead asks.
- A zero regime is left out of the bar (no dangling gap) but stays in the legend at `--text-4`; a sub-1% share prints `<1%` and only an exact zero prints `0%`.
- No transition: flex segments cannot animate on the compositor and the odds change monthly (risk G4). All-zero input renders the empty track.
- Each segment carries a `title` ("Goldilocks 64%"); wrap the bar in a `dd` labelled "Odds" so the legend is the readable form.
