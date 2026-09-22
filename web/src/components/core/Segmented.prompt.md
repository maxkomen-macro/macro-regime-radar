# Segmented
A small aria-pressed button group for one-of-N views: "Equities / Rates / FX", range pickers (5D 1M 6M 1Y), "3 months / 6 months", "Upcoming / Recent", filter rows.

```jsx
<Segmented
  label="Horizon"
  options={[{ id: "3m", label: "3 months" }, { id: "6m", label: "6 months" }]}
  value={horizon}
  onChange={setHorizon}
/>

<Segmented mono label="Range" value={range} onChange={setRange}
  options={[{ id: "5d", label: "5D" }, { id: "1m", label: "1M" }, { id: "max", label: "MAX", disabled: true }]} />
```

- Anatomy: `<div role="group" aria-label={label} class="mrr-seg">` with one `<button type="button" aria-pressed>` per option. Never a radiogroup: the buttons stay in the Tab order natively, matching the app's other toggle groups, and the label harvester records each option as a button.
- Buttons are 28px, 7px radius, 12.5px Plex Sans in `--text-2`; the pressed one is white on the 8% to 3% white gradient with a `--line-strong` border. Hover colour is in app.css (`.mrr-seg button:hover`).
- `mono` (or `variant="mono"`): 11px Plex Mono, uppercase, .08em, 11px side padding; the group carries `data-mono="true"`. Write labels as authored ("24M", "Full history"); uppercase is CSS only.
- Below 768px (`useBreakpoint().isNarrow`) the group and its buttons carry `data-touch="true"`: 40px min height, 14px side padding.
- Keyboard: Enter / Space activate natively; ArrowLeft / ArrowRight / Home / End move focus between enabled options without changing the value. `disabled` options are native `disabled` (`--text-4`, no click).
- A group with a single option renders it pressed. Separate several groups in a filter row with a 1x20px `--line` divider.
