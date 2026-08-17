# Card
Flat dark panel that every dashboard module sits in. Use for any grouped block of data; use `accentBar` when the panel is a summary/callout rather than a plain container.

```jsx
<Card tone="watch" accentBar>
  <SectionHeader title="Signals" />
  …
</Card>
```

- `tone`: default | watch | risk | clear | accent — sets the hairline border colour (and the rail colour when `accentBar`).
- `surface="var(--void)"` for terminal wells (log output, code, embedded frames).
- Never add a drop shadow. Depth in this system comes from surface value only.