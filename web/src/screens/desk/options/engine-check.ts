/**
 * The Tier 2 accuracy check's words on a pick (docs/desk/OPTIONS_TIER2_CHECK.md). The API serves `engine_check` only
 * with OPTIONS_TIER2_CHECK on; without it the page says nothing. Every number the Finder shows is Tier 1's: this
 * line reports a second engine's value of the same contract at the same inputs, its stated error, its status and
 * whether the two agree within their stated accuracies. Agreement is a consistency check of the calculation, not a
 * check of the market price, the implied volatility or the ranking, and the line never calls a value cross-checked.
 */
import type { EngineCheck, EngineCheckPick } from "../data/types";
import { isFiniteNumber } from "../kit/format";
import { premium } from "./premium";

/** Printed once under the picks whenever the block is served. */
export const CHECK_NOTE =
  "Accuracy check: a second, research pricing engine (Tier 2) reprices each pick at the inputs the Finder used and states its own error. " +
  "Agreement means the two calculations match within their stated accuracies. It is not a check of the market price, the implied volatility or the ranking. " +
  "Tier 2's error is an estimate from synthetic tests, not a proved bound, and an independent cross-check is not yet in place. Every number on this page is Tier 1's.";

const dollars = (x: number) => `$${premium(x)}`;

/** The block's pick for this contract, or undefined. */
export function checkFor(block: EngineCheck | undefined, contract: string): EngineCheckPick | undefined {
  return block?.picks?.find((p) => p.contract === contract);
}

/** The line on one pick card; null when the API served no check. */
export function checkWords(block: EngineCheck | undefined, contract: string): string | null {
  if (!block) return null;
  if (block.error) return `Accuracy check not run: ${block.error.replace(/^not checked:\s*/, "")}.`;
  const p = checkFor(block, contract);
  if (!p) return "Accuracy check not run for this contract.";
  if (p.status !== "checked" || !p.tier2) return `Accuracy check not run: ${p.reason ?? "no reason was given"}.`;
  const t = p.tier2;
  if (!isFiniteNumber(t.value)) return `Accuracy check: Tier 2 gave no value (${t.price_status}${t.reason ? `: ${t.reason}` : ""}).`;
  const err = isFiniteNumber(t.estimate) ? ` ± ${dollars(t.estimate)}` : "";
  const head = `Accuracy check: Tier 2 ${dollars(t.value)}${err} (${t.price_status}).`;
  if (!isFiniteNumber(p.tier1.value) || p.agree === null) return `${head} Tier 1's value of this contract was not available, so the two are not compared.`;
  const allowed = isFiniteNumber(p.allowed) ? ` (${dollars(p.allowed)})` : "";
  const value =
    p.agree === true
      ? `Agrees with Tier 1's ${dollars(p.tier1.value)} within their stated accuracies${allowed}.`
      : `Differs from Tier 1's ${dollars(p.tier1.value)} by more than their stated accuracies${allowed}; the page shows Tier 1's numbers.`;
  const delta = p.delta_agree === false ? " The deltas differ by more than their stated accuracies." : "";
  return `${head} ${value}${delta}`;
}
