/**
 * Desk v2 navigation (docs/desk/DESK_FRAME3_SPEC.md §1.1, as desk/usability
 * §14.5 regroups it): the sidebar is the only navigation, in labelled groups
 * by what an analyst is doing: MARKET (Overview · Technicals · Sectors ·
 * Macro · Regime), RESEARCH (Event Study · Signal Ledger), TRADE (Basket &
 * Hedge · Position Monitor), then a small ABOUT THIS BUILD line (Data
 * Pipeline · Build Notes). Each tab carries its one-line purpose, the one
 * action its header may show and whether the Desk / Client toggle appears
 * (every tab but Position Monitor, Basket & Hedge and Data Pipeline, whose
 * header carries the refresh badge instead, as its PNG draws it).
 *
 * Old frame-1/frame-2 slugs and the walkthrough's short paths are aliases:
 * a saved link still lands on the page that replaced it.
 */

export type DeskAction = "walkthrough" | "act" | "send";

export interface DeskPage {
  slug: string;
  label: string;
  /** The page title when it differs from the nav label. */
  title?: string;
  /** One line beside the page title. */
  blurb: string;
  action?: DeskAction;
  /** false: no Desk / Client toggle in this tab's header. */
  toggle?: boolean;
}

export interface DeskGroup {
  id: "market" | "research" | "trade" | "about";
  label: string;
  pages: DeskPage[];
  /** The small "About this build" line under the three groups. */
  small?: boolean;
}

export const DESK_HOME = "overview";

export const DESK_GROUPS: DeskGroup[] = [
  {
    id: "market",
    label: "Market",
    pages: [
      { slug: "overview", label: "Overview", blurb: "Where the tape is, what fired, what's closest to being wrong.", action: "walkthrough" },
      { slug: "technicals", label: "Technicals", blurb: "S&P 500 · every marker is scored by the event-study engine", action: "act" },
      { slug: "sectors", label: "Sectors", blurb: "who is leading, and whether the rally is wide or narrow" },
      { slug: "macro", label: "Macro", title: "Macro & Correlations", blurb: "the rate backdrop, credit, and whether your hedges are hedging" },
      { slug: "regime", label: "Regime", blurb: "where the economy sits, what it has meant for equities and vol, and what would change it" },
    ],
  },
  {
    id: "research",
    label: "Research",
    pages: [
      { slug: "event-study", label: "Event Study", blurb: "Ask what the market did after a defined shock. Get a scored answer, not an opinion.", action: "act" },
      { slug: "signal-ledger", label: "Signal Ledger", blurb: "every signal the engine scores, on one page · click a row to open it in Event Study" },
    ],
  },
  {
    id: "trade",
    label: "Trade",
    pages: [
      // §10: no Desk / Client toggle.
      { slug: "basket-hedge", label: "Basket & Hedge", blurb: "build the exposure, then price the cheapest way to own it", action: "send", toggle: false },
      { slug: "position-monitor", label: "Position Monitor", title: "Position Monitor", blurb: "Your positions, and how far each is from being wrong.", toggle: false },
    ],
  },
  {
    id: "about",
    label: "About this build",
    small: true,
    pages: [
      {
        slug: "data-pipeline",
        label: "Data Pipeline",
        title: "Where every number comes from",
        blurb: "Every panel in Desk resolves to a row here. Every live number comes from stored data; prototype cards are marked. No live number is re-derived in the browser.",
        toggle: false,
      },
      { slug: "build-notes", label: "Build Notes", blurb: "what this is, how it was checked, and what I would do next" },
    ],
  },
];

export const DESK_PAGES: DeskPage[] = DESK_GROUPS.flatMap((g) => g.pages);

/** Old slugs (frame-1, frame-2) and the walkthrough's short paths → the v2 tab. */
export const DESK_ALIASES: Readonly<Record<string, string>> = {
  today: "overview",
  launchpad: "overview",
  dashboard: "overview",
  internals: "technicals",
  "sp-internals": "technicals",
  "macro-regime": "regime",
  ledger: "signal-ledger",
  monitor: "position-monitor",
  "pitch-evaluation": "position-monitor",
  "red-team": "position-monitor",
  "basket-builder": "basket-hedge",
  "hedge-simulator": "basket-hedge",
  pipeline: "data-pipeline",
  notes: "build-notes",
};

export function deskPageBySlug(slug: string | undefined): DeskPage | undefined {
  return DESK_PAGES.find((p) => p.slug === slug);
}

export function deskGroupOf(slug: string): DeskGroup | undefined {
  return DESK_GROUPS.find((g) => g.pages.some((p) => p.slug === slug));
}

/** The Market tabs (§14.5; formerly SURVEY: the Client toggle on one swaps the page for the client summary). */
export const SURVEY_SLUGS: readonly string[] = DESK_GROUPS[0].pages.map((p) => p.slug);

/** The three gate steps a position passes (§9), which the sidebar's House
 * Discipline card opens and the Promote form enforces. */
export const GATES = [
  { id: "variant", label: "Variant view", prompt: "Finish the sentence: “The market thinks ___, I think ___, because ___.”" },
  { id: "premortem", label: "Pre-mortem", prompt: "Finish the sentence: “It lost money because ___.”" },
  { id: "level", label: "Wrong if", prompt: "Pick the level where the idea is wrong, suggested from live levels for the instrument." },
] as const;

export type GateId = (typeof GATES)[number]["id"];
