/**
 * The Tier 2 accuracy check's words on a pick (docs/desk/OPTIONS_TIER2_CHECK.md). The API serves `engine_check` only
 * with OPTIONS_TIER2_CHECK on; without it the page says nothing. Outside this line every number is Tier 1's: this
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
  "Each pick says what kind of error Tier 2 stated: none where its value is exact, a proved interval, or an estimate from synthetic tests that is not a proved bound. " +
  "An independent cross-check of Tier 2 is not yet in place. Outside these check lines, every number on this page (prices, deltas, ranking, P&L and breakevens) is Tier 1's.";

/** What Tier 2's stated error is, by its route (src/desk/options_engine.py's statuses); empty where none applies. */
function errorKind(route: string, status: string): string {
  if (status === "exact")
    return route === "intrinsic"
      ? " Tier 2's value is exact here: at expiry it is the payoff."
      : " Tier 2's value is exact here: early exercise adds nothing to this contract, so its European value is its price.";
  if (status === "analytic bound") return " Its ± is the half-width of a proved interval that holds the price, plus a small margin.";
  if (status.startsWith("estimated")) return " Its ± is Tier 2's own estimate of its error, from synthetic tests, not a proved bound.";
  return "";
}

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
  const head = `Accuracy check: Tier 2 ${dollars(t.value)}${err} (${t.price_status}).${errorKind(t.route, t.price_status)}`;
  if (!isFiniteNumber(p.tier1.value)) return `${head} Tier 1's value of this contract was not available, so the two are not compared.`;
  // only an explicit verdict is read as one: an absent or null `agree` is no comparison, never a disagreement (Codex S-9)
  if (typeof p.agree !== "boolean") return `${head} No comparison with Tier 1's ${dollars(p.tier1.value)} was given.`;
  const allowed = isFiniteNumber(p.allowed) ? ` (${dollars(p.allowed)})` : "";
  const value =
    p.agree === true
      ? `Agrees with Tier 1's ${dollars(p.tier1.value)} within their stated accuracies${allowed}.`
      : `Differs from Tier 1's ${dollars(p.tier1.value)} by more than their stated accuracies${allowed}; the Finder's prices and ranking stay Tier 1's.`;
  const delta = p.delta_agree === false ? " The deltas differ by more than their stated accuracies." : "";
  return `${head} ${value}${delta}`;
}
