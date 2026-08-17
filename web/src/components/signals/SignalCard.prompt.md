# SignalCard
A monitored macro signal with its distance-to-threshold gauge.

```jsx
<SignalCard name="Curve inversion risk" value="0.52%" fillPct={38} lastTriggered="Jan 2025" />
```

- Status: pass the server's `status` when you have it (/api/signals/latest computes it; the stored triggered flag owns "Triggered"). Without it, status derives from fill: <50 Clear, 50–75 Watch, ≥75 Triggered. The border and the dot follow it, and only Triggered pulses.
- Names come from SIGNAL_DISPLAY_NAMES — human phrases like "Unemployment spike", never raw `unemployment_spike`.