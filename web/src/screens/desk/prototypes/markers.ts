/**
 * What each PROTOTYPE card prints from its fixtures that no served card prints
 * (DESK_FRAME3_SPEC §1.0.3 rule 4): formatted by the card's own formatters, so
 * the tests can hold every such value inside the card's `[data-prototype]`
 * element, on the fixture dev server and on the production build. Pure (no
 * React, no CSS), so the browser tests can import it.
 */

export const PROTOTYPE_MARKERS: Readonly<Record<string, readonly string[]>> = {};
