# Pill
The probability pill: mono 14px uppercase at .13em on a 40px, 999px-radius capsule with a soft outer glow. Mint by default, amber for an elevated read, gray when the state is unavailable or neutral. `RegimeBadge` composes it.

```jsx
<Pill>64% probability</Pill>
<Pill tone="amber">Elevated</Pill>
<Pill tone="gray" size="sm">Reading regime</Pill>
```

- Tones: `mint` (`--glow-pill`), `amber` (`--glow-pill-amber`), `gray` (no shadow), plus the regime tints `overheating` and `stagflation` for `RegimeBadge`. The root carries `data-tone` and `class="mrr-pill"`.
- Sizes: `md` 40px (the hero and summary pill), `sm` 28px at 11.5px for the top bar and table rows.
- The glow is `box-shadow`; it is the one shadow spec section 0 allows besides the hero glow. Never add another.
- The pill is never the only carrier of a state word: the hero or summary copy repeats it.
- Uppercase is CSS only; the accessible text keeps the author's casing.
