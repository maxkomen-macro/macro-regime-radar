# TickerStrip
Always-on market strip under the wordmark. Values flash green or red for 600ms when they change.

```jsx
<TickerStrip items={[{label:"S&P 500", value:"+0.28%", raw:0.28, tone:"pos"}]} />
```

- Pass `raw` (a number) so the flash can detect direction; without it the strip is static.
- Three to five items maximum. This is orientation, not a watchlist.