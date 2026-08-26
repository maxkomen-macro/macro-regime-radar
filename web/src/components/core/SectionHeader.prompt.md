# SectionHeader
Labels a module. 11px uppercase mono on a hairline rule — the single most recognisable typographic move in the product.

```jsx
<SectionHeader title="Key Levels" right="Updated 06:55 ET" />
<SectionHeader title="Rate expectations" level="sub" />
<SectionHeader title="Rate expectations" level="sub" as="h4" />
```

- `level="sub"` drops to 12px sentence case with no rule; use it inside a section, never as the top label.
- Titles are short noun phrases. No sentence punctuation.

## Semantics
This is a real heading, not a styled `<div>` — it carries the document outline.

| level | element |
|---|---|
| `section` (default) | `<h2>` |
| `sub` | `<h3>` |

The page outline is `h1` (the MACRO REGIME RADAR wordmark, owned by `AppShell` / `LandingPage`) → `h2` per section → `h3` per subsection. Never render an `h1` here.

`as` overrides the element without touching the look: use `as="h4"` for a sub nested under another sub, and `as="div"` when the label is purely decorative (a repeated label inside a card grid, say) and would otherwise litter the outline with phantom entries. Changing `as` changes semantics only — every visual property is set inline.

All UA heading styles that would diverge from the old `<div>` are pinned in the inline style object: `font-size`, `font-weight`, `margin-block-start` / `-end` and `margin-inline-start` / `-end`. Consumer `style` still spreads last, so `style={{ marginTop: 0 }}` overrides as before. If you add a style property here, check the UA heading sheet before assuming the default is `0`.

The `right` slot lives inside the heading element, so screen readers read the meta line as part of the heading text ("KEY LEVELS FRED · latest 12 Aug 2026"). Verbose but accurate; splitting it out would change the flex layout.
