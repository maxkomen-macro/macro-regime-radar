/**
 * The PROTOTYPE cards (DESK_FRAME3_SPEC §1.0.3), one row each: the page it
 * stands on, its title, and its footnote's one line on how it would be built.
 * Pure data: the cards read their footnote from here, and the tests read the
 * list to find every card on every page.
 */

export interface PrototypeEntry {
  /** Carried by the card as `data-prototype`. */
  id: string;
  /** The Desk page slug the card stands on. */
  page: string;
  title: string;
  /** The footnote's line after "In production: ". */
  production: string;
}

export const PROTOTYPES: readonly PrototypeEntry[] = [
  {
    id: "protection",
    page: "technicals",
    title: "What protection costs right now",
    production: "daily SPY chain snapshots from the EODHD options add-on, stored and versioned.",
  },
];

/** A registry row by id; throws on an unknown id, so a card cannot ship without its row. */
export function prototype(id: string): PrototypeEntry {
  const e = PROTOTYPES.find((p) => p.id === id);
  if (!e) throw new Error(`no PROTOTYPE registry row for ${id}`);
  return e;
}

/** §1.0.3 rule 4: the fixtures only modules under prototypes/ may read, by path. */
export function isPrototypeFixture(path: string): boolean {
  return /\/fixtures\/desk\/(proto-[^/]+|vol)\.json$/.test(path);
}

/** The names a module outside prototypes/ may import from it: the cards themselves, which a page places. */
export const PROTOTYPE_CARD_EXPORTS: readonly string[] = ["ProtectionCard"];
