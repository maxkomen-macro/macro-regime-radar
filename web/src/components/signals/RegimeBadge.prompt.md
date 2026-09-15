# RegimeBadge
States the current macro regime as the probability pill. Four labels: Goldilocks (mint), Overheating (orange), Stagflation (red), Recession Risk (gray); anything else renders gray.

```jsx
<RegimeBadge label="Goldilocks" confidence={0.64} />
<RegimeBadge label="Overheating" size="sm" confidence={0.52} />
<RegimeBadge label="Reading regime" tone="gray" />
```

- Renders `<Pill>` (`class="mrr-pill" data-tone`): mono uppercase on the 999px capsule with the tone's glow; `size="sm"` is the 28px pill for the top bar and table rows.
- `confidence` (0 to 1) appends `<span class="pct">64%</span>` at .85 opacity in the pill colour.
- `tone` overrides the regime mapping with any Pill tone (`mint`, `amber`, `gray`, `overheating`, `stagflation`); `"regime"` (default) maps from the label.
- Fill is always the translucent tint, never a solid block; the pill is never the only carrier of the regime word (the hero or summary copy repeats it).
