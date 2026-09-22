# SignalCard
A monitored signal as a tile: name, status badge, value with a 118x30 sparkline, meter label, 5px meter in the status colour, then mono lines ("Last alert:" first). Reused by the Dashboard signals, the Credit spread monitor and the Recession model inputs.

```jsx
<SignalCard
  name="Curve inversion risk"
  value="0.41%"
  fillPct={41}
  status="Clear"
  lastTriggered="none on file"
  sparkline={history}
  lines={["Trips when the 10Y–2Y spread closes below 0.00%.", "Signal print Sep 2026"]}
/>

<SignalCard name="High yield" value="2.91%" fillPct={7} badge="Normal" tone="clear" meterLabel="20-year percentile" lastTriggered={null} lines={["1M change: +6 bp"]} />
<SignalCard name="Unemployment spike" value="Unavailable" badge="Unavailable" tone="reference" showGauge={false} lastTriggered={null} />
<SignalCard name="Inflation pressure" value={<StateNote loading />} showGauge={false} caption="Reading the latest print." />
```

- Status: pass the server's `status` when you have it (`/api/signals/latest` computes it; the stored triggered flag owns "Triggered"). Without it, status derives from fill: <50 Clear, 50 to 75 Watch, 75+ Triggered. The badge word is the status word (Clear / Watch / Triggered, uppercase by CSS only); the badge, meter and sparkline share its tint (mint / amber / `--neg`). The tile border no longer changes with status.
- `badge` overrides the badge text, `tone` overrides the tint (`clear` | `watch` | `alert` | `info` | `reference`); credit tiers pass both.
- `sparkline` renders only with two or more points (118x30, stroke 1.4, no fill, `aria-hidden`; the adjacent value carries the number). Omit it when no history is served; never invent points.
- `lines` are mono 12px notes after "Last alert: {lastTriggered}". `lastTriggered={null}` omits that line; the default is "Never". `caption` adds a 13px Plex Sans note under the lines.
- `heading="h3"` / `"h4"` makes the name a heading when the section outline needs it; the default `span` keeps the outline unchanged. `as="div"` swaps the `article` root.
- Names come from SIGNAL_DISPLAY_NAMES: human phrases like "Unemployment spike", never raw `unemployment_spike`. Loading and missing-print cards pass `value={<StateNote loading />}` with `showGauge={false}`.
