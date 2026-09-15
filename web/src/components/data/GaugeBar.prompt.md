# GaugeBar (Meter)
5px track on `--track`, 3px radius, filled in the status colour. Plus two row helpers from the same file: `MeterRow` and `DivergingBar`.

```jsx
<GaugeBar pct={7} tone="clear" caption="20-year percentile" />
<GaugeBar pct={26.7} tone="clear" gradient tick={50} height={8} scale={{ left: "0", mid: "avg 26.3 mo", right: "2× avg" }} />
<MeterRow swatch="var(--r-goldilocks)" label="Goldilocks" pct={60} color="var(--r-goldilocks)" value="60%" delta="−4 pts" />
<DivergingBar value={-0.92} max={1} />
```

- Colour precedence: `color` (any paint, regime hues) wins over `tone` (`clear` mint, `watch` amber, `alert` red, `info` link, `neutral`, `pos`, `neg`). With neither, the legacy four-step ramp applies; import `rampColor(pct)` to reuse it.
- Decorative by default; the number beside it carries the value. Pass `ariaLabel` only when the bar stands alone (it then gets `role="img"`).
- `pct` outside 0–100 clamps; NaN renders empty and drops the tick.
- `gradient` fades from 40% alpha to the full colour (cycle progress). `tick` marks a reference percent; `tickLabel` or `scale` prints the mono 10.5px scale row under the track.
- Fill animates with `transform: scaleX` (never `width`); nothing else moves.
- `MeterRow`: `labelWidth · meter · valueWidth · [58px delta]`, 30px tall, gap 10 (12 without a delta); the 8px `swatch` sits inside the label cell. `deltaTone="watch"` paints the delta amber; `valueSize="sm"` and `height={34}` give the late-cycle rows.
- `DivergingBar`: centre tick, bar grows left for negative values and right for positive; `|value| / max` fills half the bar. The caller picks the colours: coefficients keep the defaults (positive red raises odds, negative mint lowers), surprises pass `positiveColor="var(--pos)"` and `negativeColor="var(--neg)"`.
