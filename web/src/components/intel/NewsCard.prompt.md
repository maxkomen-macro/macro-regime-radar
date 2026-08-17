# NewsCard
Headline from the news pipeline with its significance score, Claude regime interpretation and Perplexity citations.

```jsx
<NewsCard source="FINNHUB" time="2h ago" ticker="SPY" significance={6.4}
  headline="…" interpretation="…" sources={["https://…"]} />
```

- `significance` colours itself: ≥7 red, ≥5 orange, ≥4 amber, below that faint.
- Keep detail collapsed by default in feeds; pass `expandable={false}` in a memo where everything prints.
- Attribution glyphs are ◆ CLAUDE and ◆ PERPLEXITY — keep both, they signal which model produced which text.