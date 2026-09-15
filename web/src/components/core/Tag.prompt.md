# Tag
The badge: mono 11.5px uppercase at .1em, 24px tall, 7px radius, 1px tinted border on a 7% tinted fill. Alert levels, classification ladder, calendar importance, Beat / Miss, category chips, conviction.

```jsx
<Tag tone="clear">Clear</Tag>
<Tag tone="watch">Watch</Tag>
<Tag tone="alert">Triggered</Tag>
<Tag tone="info" size="xs">Macro</Tag>
<Tag tone="reference" size="md" uppercase={false}>Medium conviction</Tag>
<Tag tone="info"><Jargon term="OAS">Tight</Jargon></Tag>
```

- Tones map to meaning, not decoration: `clear` (mint) all clear / risk-on, `watch` (amber), `alert` (`--neg`) triggered, `info` (link blue) informational, `reference` (default, `--text-2` on a 3% white fill) neutral labels, `hot` elevated / stale, `research` Perplexity-sourced. The old names `pos`, `warn`, `neg`, `accent`, `neutral` alias to the first five.
- Sizes: `sm` (default) is the mockup standard 24px badge; `xs` is the 20px compact chip; `md` 28px for sentence-case badges.
- Uppercase is CSS only, so the accessible name keeps the author's casing. The third signal state is the word "Triggered", never "alert".
- Keep to one or two words. Children accept any ReactNode (a Jargon term sits inside).
