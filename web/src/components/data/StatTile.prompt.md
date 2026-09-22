# StatTile
Label / value / delta triple. Key levels, count tiles, fundamentals rows and the LBO outputs are grids of these.

```jsx
<StatTile label="US 10Y" value="4.40%" delta="+10bps" direction="up" live />
<StatTile label="IRR" value="18.5%" size="lg" />
```

- Values are preformatted strings in the UI face at 500 with tabular figures; the component never formats numbers. Mono is for the label only.
- Sizes: `xs` 14px (fundamentals row), `sm` 20px (count tiles), `md` 24px (default grids), `lg` 30px (outputs), `xl` 40px (one hero metric).
- `direction` picks the glyph and colour: ▲ `--pos`, ▼ `--neg`, → `--neutral`. Green is always "up", not "good".
- `live` adds the 4px mint dot; it pulses unless the visitor prefers reduced motion.
