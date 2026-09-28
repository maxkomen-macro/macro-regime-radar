/**
 * What each PROTOTYPE card prints from its fixtures that no served card prints
 * (DESK_FRAME3_SPEC §1.0.3 rule 4): formatted by the card's own formatters, so
 * the tests can hold every such value inside the card's `[data-prototype]`
 * element, on the fixture dev server and on the production build. Pure (no
 * React, no CSS), so the browser tests can import it.
 */

import hedgeAnswers from "../../../fixtures/desk/basket-hedge.json" with { type: "json" };
import { legsKey } from "../basket/weights";
import { grouped, ordinal, signed } from "../kit/format";
import { inputsFrom, type HedgeAnswer } from "./basket-inputs";
import { basketStudy, sampleBasket } from "./basket-study";
import { hedge, usd } from "./options";
import { CROWDING_WORDS, positioning } from "./positioning";
import { costText, protection, strikeText } from "./protection";
import { sync } from "./snowflake-sync";

function protectionMarkers(): string[] {
  const p = protection();
  return [`${signed(p.skew)} pts`, costText(p.put.cost), costText(p.call.cost), strikeText(p.put.strike), strikeText(p.call.strike), `${ordinal(Math.round(p.percentile * 100))} percentile`];
}

/** The sample basket's routes, priced from the fixture server's /basket/hedge answer for it: each structure's
 * cost and payoff in dollars (the ETF's ticker is also a served benchmark's, so it is no marker). */
function optionsMarkers(): string[] {
  const b = sampleBasket();
  const answer = (hedgeAnswers as { answers: Record<string, HedgeAnswer> }).answers[`${legsKey(b.legs)}|hold|1000000`];
  const i = inputsFrom(answer, b);
  if (!i) return [];
  const h = hedge(i);
  return h.routes.flatMap((r) => r.rows.flatMap((p) => (p.reason === null ? [usd(p.costUsd), usd(p.payoffUsd)] : [])));
}

/** The sample basket's names: the crowding words and the two short interests over 10% of float. */
function positioningMarkers(): string[] {
  const p = positioning(sampleBasket().legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) })));
  return [CROWDING_WORDS.short, CROWDING_WORDS.long, ...p.rows.filter((r) => r.flag === "short").map((r) => `${r.si.toFixed(1)}%`)];
}

/** The study's question and its why. */
function studyMarkers(): string[] {
  const st = basketStudy();
  return [`After this basket falls 2σ over ${st.window} days`, `${st.month.n} completed outcomes in ${st.month.n_blocks} overlap blocks`];
}

/** The sync's target, and its largest tables' row counts. */
function syncMarkers(): string[] {
  const s = sync();
  return [s.target.warehouse, ...s.tables.filter((t) => t.sourceRows > 100000).map((t) => grouped(t.sourceRows))];
}

export const PROTOTYPE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  protection: protectionMarkers(),
  "options-hedge": [...new Set(optionsMarkers())],
  positioning: positioningMarkers(),
  "basket-study": studyMarkers(),
  "snowflake-sync": syncMarkers(),
};
