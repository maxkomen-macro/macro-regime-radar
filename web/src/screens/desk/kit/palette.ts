/**
 * DESK_FRAME3_SPEC §1.3 as data: the five accents (one job each), the listed
 * neutrals, the active-nav fill and the verdict pill tints. The palette tests
 * (unit: every color literal in the v2 styles; browser: every computed color
 * on a rendered tab) accept these and nothing else; rgba() may only tint one.
 */
export const DESK_ACCENTS = { green: "#26dca0", red: "#e5534b", amber: "#e8b447", blue: "#58b8e6", gray: "#8b929e" } as const;

export const DESK_PALETTE: readonly string[] = [
  ...Object.values(DESK_ACCENTS),
  // neutrals: page, sidebar, cards, borders, row divider, box border, text ramp
  "#0c0e11", "#0f1216", "#12161b", "#151920", "#262b33", "#1c2027", "#2a3038", "#e8e6e1", "#c9cdd3", "#6b7280",
  // §1.1: the active nav item's fill and its white text
  "#1b2027", "#ffffff",
  // §1.3 verdict pill tints: Reliable, Suggestive, No edge
  "#0f1a16", "#1f6b52", "#1a160f", "#5a4a1e", "#171a1f",
];

/** "r,g,b" for each palette color. */
export function paletteRgb(): Set<string> {
  return new Set(DESK_PALETTE.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(",")));
}
