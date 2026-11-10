/**
 * The basket the options PROTOTYPE's markers are computed for (./markers.ts; DESK_FRAME3_SPEC §1.0.3):
 * desk/books' first-visit preset, AI Infrastructure 10 (../basket/weights `PRESET`), the basket a fresh browser
 * opens. "Positioning" was drawn for it until Desk P4 served the card (§12.20, basket/PositioningCard.tsx), and
 * "Event study on this basket" until desk P1a (§12.19). Pure.
 */

import { PRESET, type SavedBasket } from "../basket/weights";

export const DRAWN_FOR: SavedBasket = PRESET;
