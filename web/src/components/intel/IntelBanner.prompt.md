# IntelBanner
Top-of-dashboard summary: one sentence stating where the market is, with a conviction badge.

```jsx
<IntelBanner
  conviction="Medium"
  headline="Markets are in Overheating regime (54% probability) with credit spreads at the 4th percentile."
  meta={[{label:"Signal", value:"Risk-On", color:"var(--pos)"}]}
  action="See Intelligence tab for full analysis"
/>
```

- One sentence. If it needs a second, it belongs in ReadThrough.
- The green rail and pulsing dot mean the data behind it is current; don't use this component for static content.
- The dot pulses only when `live` is true — pass it as "content is new since last visit OR under an age threshold" (owner ruling 2026-08-06); a hardcoded pulse over stale data is the failure mode this prop exists to prevent.