/**
 * Desk navigation registry (docs/desk/DESK_FRAME_SPEC.md §2): three groups in
 * this order, SURVEY · ACT · TOOLS, each page with the build status its
 * status badge and its sidebar mark read. `status` is the page's wiring:
 * `live` pages read the API (their badges still take every freshness word
 * from /api/freshness, never from here); `designed` pages are real UI with
 * no data source and declare `Designed` (§3, §6). Dashboard is the one
 * external entry, linking back to the main app.
 */

export type DeskStatus = "live" | "designed";

export interface DeskPage {
  slug: string;
  label: string;
  status: DeskStatus;
  /** One sentence under the page title. */
  blurb: string;
  /** Designed shells: what the page reads once live (§6, one line). */
  reads?: string;
  /** An external destination instead of /desk/<slug>. */
  href?: string;
}

export interface DeskGroup {
  id: "survey" | "act" | "tools";
  label: string;
  pages: DeskPage[];
}

export const DESK_HOME = "today";

export const DESK_GROUPS: DeskGroup[] = [
  {
    id: "survey",
    label: "Survey",
    pages: [
      { slug: DESK_HOME, label: "Today", status: "live", blurb: "The regime, the recession read, what fired, and the positions closest to being wrong." },
      {
        slug: "launchpad",
        label: "Launchpad",
        status: "designed",
        blurb: "The morning route through the desk: what to read first and which studies to rerun.",
        reads: "Reads the freshness report, the alert feed and the saved studies once live.",
      },
      { slug: "dashboard", label: "Dashboard", status: "live", blurb: "The main terminal.", href: "/app/dashboard" },
    ],
  },
  {
    id: "act",
    label: "Act",
    pages: [
      { slug: "event-study", label: "Event Study", status: "live", blurb: "After a defined shock in one asset, while a condition holds, what did the target do over the next sessions?" },
      {
        slug: "sp-internals",
        label: "S&P Internals",
        status: "designed",
        blurb: "Breadth, the 50/200 crosses and their forward record, split by regime.",
        reads: "Reads the 50/200 cross study from the event-study engine and stored S&P constituents once live.",
      },
      { slug: "position-monitor", label: "Position Monitor", status: "live", blurb: "Promote an idea to a position only through the discipline gate; then watch its distance to falsification." },
      {
        slug: "pitch-evaluation",
        label: "Pitch Evaluation",
        status: "designed",
        blurb: "Score a pitch on variant view, base rates, falsifiability and calibration before it reaches the book.",
        reads: "Reads saved positions and the event-study base rates once live.",
      },
      {
        slug: "red-team",
        label: "Red Team",
        status: "designed",
        blurb: "The strongest case against an open position, argued from the same data.",
        reads: "Reads saved positions, the regime odds and the analogue set once live.",
      },
      {
        slug: "macro-regime",
        label: "Macro / Regime",
        status: "designed",
        blurb: "The classifier's odds, its inputs and their release calendar, on one desk page.",
        reads: "Reads /api/regime/latest, /api/regime/transitions and the regime freshness block once live.",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    pages: [
      {
        slug: "basket-builder",
        label: "Basket Builder",
        status: "designed",
        blurb: "Compose a basket from the stored universe and read its regime-split history.",
        reads: "Reads stored daily bars and the regime history once live.",
      },
      {
        slug: "hedge-simulator",
        label: "Hedge Simulator",
        status: "designed",
        blurb: "Size a hedge against a saved position and see the residual across regimes.",
        reads: "Reads saved positions, stored bars and the transition odds once live.",
      },
      { slug: "data-pipeline", label: "Data Pipeline", status: "live", blurb: "Where every number comes from: lineage, the series inventory and the store's schema." },
      { slug: "build-notes", label: "Build Notes", status: "designed", blurb: "What this is, what is live, how it is built, and how it could fail." },
    ],
  },
];

export const DESK_PAGES: DeskPage[] = DESK_GROUPS.flatMap((g) => g.pages);

/** The page for a route slug; undefined for an unknown or external slug. */
export function deskPageBySlug(slug: string | undefined): DeskPage | undefined {
  return DESK_PAGES.find((p) => p.slug === slug && !p.href);
}

export function deskGroupOf(slug: string): DeskGroup | undefined {
  return DESK_GROUPS.find((g) => g.pages.some((p) => p.slug === slug));
}

/** The sidebar footer card (§2): four rules, one line each. */
export const HOUSE_DISCIPLINE: readonly string[] = [
  "Variant view first.",
  "Pre-mortem before defense.",
  "Falsification required.",
  "Calibrated language only.",
];

/** The three gates a position passes (Position Monitor §5); the seals the
 * sidebar footer and the form both draw. */
export const GATES = [
  { id: "variant", label: "Variant view" },
  { id: "premortem", label: "Pre-mortem" },
  { id: "falsification", label: "Falsification" },
] as const;

export type GateId = (typeof GATES)[number]["id"];
