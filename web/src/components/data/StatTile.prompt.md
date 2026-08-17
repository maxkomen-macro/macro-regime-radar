# StatTile
Label / value / delta triple. The header ticker and the Key Levels grid are both grids of these.

```jsx
<StatTile label="US 10Y" value="4.40%" delta="+10bps" direction="up" live />
```

- Values are preformatted strings — the component never formats numbers.
- `direction` picks the glyph and colour: ▲ green, ▼ red, → grey. Green is always "up", not "good".
- `size="lg"` for a single hero metric; default for grids of four or more.