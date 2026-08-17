# GaugeBar
Thin fill bar showing how close a value sits to its trigger threshold.

```jsx
<GaugeBar pct={72} caption="Threshold proximity" />
```

- The colour ramp is fixed and meaningful: <50 green, 50–75 amber, 75–95 orange, ≥95 red. Import `rampColor(pct)` if you need the same colour elsewhere.
- 4px tall. Do not scale it up — this is a glance indicator, not a chart.