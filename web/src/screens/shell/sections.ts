/**
 * Navigation registry — the seven locked-IA tabs and their sections.
 * Feeds the TabBar, the Cmd+K palette (v1: tabs + sections only), and the
 * per-tab placeholders. Section ids double as scroll anchors (#id).
 */

export interface TabDef {
  slug: string;
  label: string;
  built: boolean;
  sections: { id: string; label: string }[];
}

export const TABS: TabDef[] = [
  {
    slug: "dashboard",
    label: "Dashboard",
    built: true,
    sections: [
      { id: "regime-hero", label: "Regime hero" },
      { id: "signals", label: "Monitored signals" },
      { id: "key-levels", label: "Key levels" },
      { id: "whats-priced", label: "What's Priced teaser" },
      { id: "macro-charts", label: "Macro charts" },
    ],
  },
  {
    slug: "regime-lab",
    label: "Regime Lab",
    built: true,
    sections: [
      { id: "playbook", label: "Playbook" },
      { id: "cycle", label: "Cycle position" },
      { id: "transitions", label: "Transition outlook" },
      { id: "analogues", label: "Historical analogues" },
      { id: "scenarios", label: "Scenario builder" },
      { id: "regime-history", label: "Regime history (Gantt)" },
      { id: "backtests", label: "Backtests & factor attribution" },
    ],
  },
  {
    slug: "markets",
    label: "Markets",
    built: true,
    sections: [
      { id: "watchlist", label: "Macro tape" },
      { id: "single-names", label: "Single names" },
      { id: "sector-heatmap", label: "Sector heatmap" },
      { id: "whats-priced-full", label: "What's Priced (full)" },
      { id: "top-surprises", label: "Top Surprises" },
    ],
  },
  {
    slug: "credit",
    label: "Credit",
    built: true,
    sections: [
      { id: "oas", label: "OAS dashboard" },
      { id: "quality-ladder", label: "Quality ladder" },
      { id: "financing", label: "Financing conditions" },
    ],
  },
  {
    slug: "recession",
    label: "Recession",
    built: true,
    sections: [
      { id: "model", label: "Probability model" },
      { id: "curve", label: "Curve monitor" },
      { id: "sensitivity", label: "Sensitivity sliders" },
      { id: "transparency", label: "Model transparency" },
    ],
  },
  {
    slug: "news",
    label: "News & Calendar",
    built: true,
    sections: [
      { id: "headlines", label: "Headlines" },
      { id: "calendar", label: "Macro calendar" },
    ],
  },
  {
    slug: "tools",
    label: "Tools",
    built: true,
    sections: [
      { id: "lbo", label: "LBO Calculator" },
      { id: "allocation", label: "Asset Allocation" },
    ],
  },
];

/** Methodology is a persistent header link, not a tab (locked IA). */
export const METHODOLOGY_SLUG = "methodology";

export const tabBySlug = (slug: string | undefined): TabDef | undefined =>
  TABS.find((t) => t.slug === slug);

export interface PaletteEntry {
  kind: "tab" | "section";
  tabSlug: string;
  sectionId?: string;
  label: string;
  hint: string;
}

export const PALETTE_ENTRIES: PaletteEntry[] = [
  ...TABS.map<PaletteEntry>((t) => ({
    kind: "tab",
    tabSlug: t.slug,
    label: t.label,
    hint: t.built ? "Tab" : "Tab · planned",
  })),
  ...TABS.flatMap<PaletteEntry>((t) =>
    t.sections.map((s) => ({
      kind: "section",
      tabSlug: t.slug,
      sectionId: s.id,
      label: s.label,
      // "planned" keeps the palette honest — a jump to an unbuilt tab lands
      // on its placeholder, and the entry says so up front.
      hint: t.built ? t.label : `${t.label} · planned`,
    })),
  ),
  { kind: "tab", tabSlug: METHODOLOGY_SLUG, label: "Methodology", hint: "Reference" },
];
