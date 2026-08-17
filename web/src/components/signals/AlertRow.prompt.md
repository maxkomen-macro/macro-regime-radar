# AlertRow
One entry in the alert feed. Stack them in a Card with 6px gaps.

```jsx
<AlertRow level="watch" name="VIX_shock" message="VIX weekly z-score=2.41 — above 2.0 watch threshold." date="2026-05-01" />
```

- Three levels only: info / watch / risk. The 3px left rail carries the level colour.
- Messages are the raw generated sentence from `alerts.py` — factual, ends with a period.