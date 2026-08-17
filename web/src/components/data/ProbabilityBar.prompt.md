# ProbabilityBar
The four softmax regime probabilities as one stacked bar plus a GL/OV/ST/RR legend.

```jsx
<ProbabilityBar probs={{ goldilocks: 0, overheating: 0.52, stagflation: 0.48, recession: 0 }} />
```

- Order is fixed (Goldilocks → Overheating → Stagflation → Recession Risk) so the shape is comparable across screens.
- Zero-probability legend entries drop to `--text-faint` rather than disappearing.