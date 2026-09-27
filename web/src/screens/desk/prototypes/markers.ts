/**
 * What each PROTOTYPE card prints from its fixtures that no served card prints
 * (DESK_FRAME3_SPEC §1.0.3 rule 4): formatted by the card's own formatters, so
 * the tests can hold every such value inside the card's `[data-prototype]`
 * element, on the fixture dev server and on the production build. Pure (no
 * React, no CSS), so the browser tests can import it.
 */

import { ordinal, signed } from "../kit/format";
import { basketInputs, sampleBasket } from "./basket-inputs";
import { hedge, usd } from "./options";
import { CROWDING_WORDS, positioning } from "./positioning";
import { costText, protection, strikeText } from "./protection";

function protectionMarkers(): string[] {
  const p = protection();
  return [`${signed(p.skew)} pts`, costText(p.put.cost), costText(p.call.cost), strikeText(p.put.strike), strikeText(p.call.strike), `${ordinal(Math.round(p.percentile * 100))} percentile`];
}

/** The sample basket's routes: each structure's cost and payoff in dollars (the ETF's ticker is also a served
 * benchmark's, so it is no marker). */
function optionsMarkers(): string[] {
  const i = basketInputs(sampleBasket());
  if (!i) return [];
  const h = hedge(i);
  return h.routes.flatMap((r) => r.rows.flatMap((p) => [usd(p.costUsd), usd(p.payoffUsd)]));
}

/** The sample basket's names: the crowding words and the two short interests over 10% of float. */
function positioningMarkers(): string[] {
  const p = positioning(sampleBasket().legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) })));
  return [CROWDING_WORDS.short, CROWDING_WORDS.long, ...p.rows.filter((r) => r.flag === "short").map((r) => `${r.si.toFixed(1)}%`)];
}

export const PROTOTYPE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  protection: protectionMarkers(),
  "options-hedge": [...new Set(optionsMarkers())],
  positioning: positioningMarkers(),
};
