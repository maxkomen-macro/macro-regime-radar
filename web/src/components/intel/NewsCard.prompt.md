# NewsCard
Headline from the news pipeline with its significance score, Claude regime interpretation and Perplexity citations.

```jsx
<NewsCard source="FINNHUB" time="2h ago" ticker="SPY" significance={6.4}
  headline="…" interpretation="…" sources={["https://…"]} />
```

- `significance` colours itself: ≥7 red, ≥5 orange, ≥4 amber, below that faint.
- Keep detail collapsed by default in feeds; pass `expandable={false}` in a memo where everything prints.
- Attribution glyphs are ◆ CLAUDE and ◆ PERPLEXITY — keep both, they signal which model produced which text.

## Two variants (redesign Phase 8)

`variant="row"` (default) is the More-headlines list row: clock, category badge, the headline link with its meta line
(source · time, the ticker or deal-size `chip`, "Read at {source} →"), the detail toggle ("Regime read · N sources" in
mint when the item is enriched, "Wire summary" when only a summary exists, the static "Headline only" otherwise) and the
"Sig x / 5" readout with five dots. The opened block prints "◆ Why it matters · AI", the paragraph, the model attribution
line and the cited sources as "[i] hostname" links whose accessible name is the full URL. Its five cells are laid out by
`.mrr-news-row` in app.css.

`variant="lead"` is the Priority-headlines tile (`<article>`): badge, chip and score on one line, a 16px `h4` headline
link, "◆ Why it matters · AI" or "Wire summary" over the paragraph, the collapsed "Score breakdown" (`dims`), the
"Regime read · N sources" toggle over the source links, and a footer with "Read at {source} →" and the source · time meta
("stored · stale" when `stale`). Pass `sigScale={5}` for the pipeline's own ladder; every toggle is a real button with
`aria-expanded`.
