/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section D:
 * the /kit route's section ids and variant names, shared by KitScreen.tsx,
 * KitScreen.test.tsx and e2e/kit.spec.ts so the three never drift apart.
 *
 * Every section root on /kit carries `data-kit="<id>"`; every variant wrapper
 * carries `data-kit-variant="<name>"`. Variant names are kebab-case and follow
 * the numbered "KitScreen variants" lists in section B (variants 1 to 85);
 * the `legacy` section (D item 19) renders the untouched components so route
 * K1 still shows all 17, and carries no numbered variant.
 */
export const KIT_SECTIONS: { id: string; title: string; variants: string[] }[] = [
  {
    id: "tabhero",
    title: "TabHero",
    variants: ["hero-regime-mint", "hero-recession-amber", "hero-loading-gray", "hero-photo-slot"],
  },
  {
    id: "summary",
    title: "SummaryCard and StatusStrip",
    variants: ["summary-mint-strip", "summary-amber-strip", "summary-gray-loading", "summary-no-strip-disclosure"],
  },
  {
    id: "signalcard",
    title: "SignalCard",
    variants: [
      "signal-clear-sparkline",
      "signal-watch-three-lines",
      "signal-triggered",
      "signal-credit-tier-normal",
      "signal-unavailable",
      "signal-loading-caption",
      "signal-heading-h4",
    ],
  },
  {
    id: "panel",
    title: "Panel and SectionHeader",
    variants: [
      "panel-inline-header",
      "panel-layout-description-link",
      "panel-layout-segmented-action",
      "tile-sub-header-h4",
      "card-gradient",
      "panel-tones",
      "panel-accent-callouts",
      "panel-padding-zero-table",
      "panel-surface-void-well",
      "panel-as-section",
    ],
  },
  {
    id: "badge",
    title: "Badge",
    variants: ["badge-tones-sm", "badge-tones-xs", "badge-md-sentence-case", "badge-alias-names", "badge-jargon-child"],
  },
  {
    id: "pill",
    title: "Pill and RegimeBadge",
    variants: ["pill-md", "pill-sm", "regime-badge-md", "regime-badge-sm", "regime-badge-tone-override"],
  },
  {
    id: "subtabs",
    title: "SubTabs",
    variants: ["subtabs-regime-lab-hints", "subtabs-tools-two", "subtabs-no-hints"],
  },
  {
    id: "segmented",
    title: "Segmented",
    variants: [
      "segmented-two-options",
      "segmented-three-options",
      "segmented-mono-ranges",
      "segmented-news-filter-row",
      "segmented-touch",
    ],
  },
  {
    id: "meter",
    title: "Meter, MeterRow and DivergingBar",
    variants: [
      "meter-tones",
      "meter-legacy-ramp",
      "meter-gradient-tick-scale",
      "meter-caption-percentile",
      "meter-rows",
      "diverging-bars",
    ],
  },
  {
    id: "odds",
    title: "ProbabilityBar",
    variants: ["odds-four-regime", "odds-sub-one-percent", "odds-two-regime", "odds-height-5-no-legend", "odds-letter-desc"],
  },
  {
    id: "table",
    title: "DataTable",
    variants: ["table-debt-schedule", "table-compact-grouped-tape", "table-empty-rows", "table-hide-header-caption"],
  },
  {
    id: "slider",
    title: "SliderRow",
    variants: [
      "slider-default",
      "slider-baseline-unchanged",
      "slider-baseline-changed",
      "slider-scale-format",
      "slider-input-note",
      "slider-disabled",
    ],
  },
  {
    id: "heatmatrix",
    title: "HeatMatrix",
    variants: ["heat-transition-current-row", "heat-irr-current-cell-legend", "heat-transition-dash-row", "heat-irr-null-cell"],
  },
  {
    id: "disclosure",
    title: "Disclosure and DisclosureLine",
    variants: ["disclosure-row-description-meta", "disclosure-row-open", "disclosure-quiet-mint", "disclosure-line-footer"],
  },
  {
    id: "sparkline",
    title: "Sparkline",
    variants: [
      "sparkline-flat-fill",
      "sparkline-gradient",
      "sparkline-no-fill-118x30",
      "sparkline-tape-sizes",
      "sparkline-one-point-empty",
    ],
  },
  {
    id: "caption",
    title: "Caption, StateNote and meta styles",
    variants: ["caption-prose", "caption-mono-lines", "state-note-states", "meta-and-eyebrow-styles"],
  },
  {
    id: "stattile",
    title: "StatTile",
    variants: ["stat-tile-sizes", "stat-tile-deltas", "stat-tile-live"],
  },
  {
    id: "buttons",
    title: "Buttons",
    variants: ["buttons-ghost-accent-primary-disabled"],
  },
  {
    id: "legacy",
    title: "Legacy components (unchanged)",
    variants: [],
  },
];

/** Every variant name across the sections, in manifest order (85 names). */
export const KIT_VARIANTS: string[] = KIT_SECTIONS.flatMap((s) => s.variants);
