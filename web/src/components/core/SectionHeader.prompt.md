# SectionHeader
Labels a module. The eyebrow is 12px Plex Sans 500, uppercase at .24em in `--text-eyebrow`; no rule underneath any more. Two layouts.

```jsx
<SectionHeader title="Monitored signals" right="5 signals · latest Sep 01, 2026" />

<SectionHeader
  layout="panel"
  title="Spread monitor"
  description="Option-adjusted spreads by rating"
  right="5 series · latest Sep 08, 2026"
  actions={<Link className="mrr-link" to="/app/methodology">Series notes</Link>}
/>

<SectionHeader title="Coefficients" level="sub" />
<SectionHeader title="Inside a tile" level="sub" as="h4" />
```

- `layout="inline"` (default) is today's DOM: one heading containing `<span>{title}</span>` and, when set, `<span>{right}</span>` in the mono meta style (11px, .1em, uppercase, `--text-3`, right-aligned). The `right` slot stays inside the heading so the baseline label harvest still reads the concatenated text ("QUALITY LADDER BB · B · CCC DETAIL · MONTHLY"); do not move it out (checklist 02 risk G1). Screen readers read the meta as part of the heading text: verbose but accurate.
- `layout="panel"` is the mockup `.sec-head`: `<div class="mrr-sec-head">` with the heading (title only), a 13px `--text-2` `description` span, and `<div class="mrr-sec-sp">` (margin-left auto) holding `right` as meta and then `actions` (a `Segmented`, a `Link.mrr-link` with the arrow, a ghost button). Description and actions sit outside the heading, so a segmented control is never read as heading text. Adopt it per screen with a `renames.json` entry when the meta leaves the heading.
- `level="sub"`: 11px Plex Sans 500 at .2em, uppercase, `--text-3`, margin 12/0/6, no slots. Use it inside a section, never as the top label.
- Titles are short noun phrases; no sentence punctuation. Any prop accepts a ReactNode (Jargon terms embed).

## Semantics
This is a real heading, not a styled `<div>`; it carries the document outline.

| level | element |
|---|---|
| `section` (default) | `<h2>` |
| `sub` | `<h3>` |

`as` overrides the element without touching the look (`as="h4"` for a sub under a sub, `as="div"` for a decorative repeated label). Never render an `h1` here. The eyebrow is `white-space: nowrap` at desk width and wraps below 768px (`useBreakpoint`, the app's one width mechanism). All UA heading styles that would diverge from a div (font-size, font-weight, margins) are pinned inline; consumer `style` spreads last, so `style={{ marginTop: 0 }}` still works. In the panel layout `style` and the rest props land on the wrapper div.
