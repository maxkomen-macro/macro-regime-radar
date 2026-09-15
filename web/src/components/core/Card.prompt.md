# Card
The surface every module sits in: a `panel` (12px radius, 1px `--line`, `--panel`, padding 16/18/18), a `tile` inside a panel (9px radius, `--tile`, 14px padding) or a `card` (12px, the `--card-grad` gradient, used by the hero and summary). No shadow, ever; depth comes from surface value only.

```jsx
<Card>
  <SectionHeader title="Monitored signals" right="5 signals" />
  …
</Card>

<Card variant="tile">…</Card>              // inner card inside a panel
<Card variant="card">…</Card>              // gradient surface (hero, summary)
<Card tone="watch">…</Card>                // 1px amber border, nothing else changes
<Card accentBar tone="watch">…</Card>      // callout: 3px rail, 0 8 8 0 radius, amber wash
<Card as="section" id="quality-ladder">…</Card>
```

- `tone`: default | watch | risk | clear | accent. Changes the border colour only (the badge alphas: `--amber-a36`, `rgba(240,80,63,.38)`, `--mint-a32`, `--link-a32`).
- `accentBar` is the mockup callout ("Quality ladder tension"): `border-left: 3px solid <tone>`, `border-radius: 0 8px 8px 0`, `padding: 10px 14px`, `background: linear-gradient(90deg, <tone at .08>, transparent)`, no outer border. `default` and `accent` rail in `--link`.
- `variant` picks the surface (default `panel`). Nested cards look like panel-in-panel until the owning screen passes `variant="tile"` (checklist 02 risk G2).
- `as` changes the element only (`div` default, `section`, `article`); `id`, `aria-*`, `data-*`, `className` pass through.
- `padding` and `surface` still win over the variant and the callout; `style` spreads last.
