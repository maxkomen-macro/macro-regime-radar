# StatusDot
The system's "this is live" tell — a 6px dot, pulsing on a 2.4s cycle.

```jsx
<StatusDot status="live" label="Streaming" />
<StatusDot status="risk" label="Triggered" />
```

- Only `live` pulses by default. Pass `pulse={false}` when several dots share a view — one pulsing thing per screen region.
- Pairs with an uppercase mono label; never with sentence-case text.