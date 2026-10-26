/**
 * The Options Finder's words (Options Finder design §"Framing"): a scenario calculator over end-of-day quotes, never
 * a recommendation. No "best", "recommended" or "buy"; each lens is named for the scenario it sorts by; the maximum
 * loss is the whole premium; the market-implied chance is the options market's pricing, not a forecast; a value on
 * your date that is not intrinsic is labelled modelled, with what it holds fixed.
 */
import type { OptionKind, OptionLens, OptionModel, OptionView } from "../data/types";

export const FRAMING = "Scenario calculator over end-of-day quotes. It shows what each contract would be worth if your view plays out. It is not a recommendation and doesn't know your situation.";

export const OCC_URL = "https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document";

export const LENSES: readonly {
  id: OptionLens;
  title: string;
  question: string;
}[] = [
  {
    id: "payoff",
    title: "Biggest payoff if right",
    question: "If the view plays out in full, what pays the most for the budget?",
  },
  {
    id: "forgiving",
    title: "Most forgiving",
    question: "If the stock gets only halfway, what holds up?",
  },
  {
    id: "time",
    title: "Time cushion",
    question: "If the move comes late, what loses least, among contracts at least doubling at the target?",
  },
];

/** The engine's screens, in its order (src/desk/options_finder.py SCREEN_WORDS): what a drop count means. */
export const SCREEN_WORDS: Readonly<Record<string, string>> = {
  bad_row: "had no contract id, strike or expiry",
  outside_window: "were outside the scan window",
  beyond_calendar: "expire after the market calendar the Finder knows",
  nonstandard: "were not standard contracts (adjusted after a corporate action)",
  no_bid: "had no bid",
  bad_ask: "had no usable ask",
  stale_quote: "had a quote from another session",
  no_arbitrage: "had quotes that contradict other strikes or expiries (an arbitrage in the quotes)",
  wide_spread: "were too wide",
  low_oi: "had too little open interest",
  bad_iv: "had no implied volatility from 5% to 300% that reprices their mid",
  over_budget: "cost more than the budget",
  unpriceable: "could not be priced",
};

/** How a value was priced, in words (never "model"). */
export const PRICER_WORDS: Readonly<Record<OptionModel, string>> = {
  "black76-escrowed": "European value on the forward, dividends escrowed",
  "american-bbsr-escrowed": "American value on a binomial lattice, dividends escrowed",
  intrinsic: "intrinsic value at expiry",
};

export const kindWord = (k: OptionKind | undefined, plural = false): string => (k === "put" ? (plural ? "puts" : "put") : plural ? "calls" : "call");

export const viewWord = (v: OptionView | undefined): string => (v === "down" ? "falls to" : "rises to");

export const TIMING_WORDS: Readonly<Record<string, string>> = {
  bmo: "before the open",
  amc: "after the close",
  dmh: "during market hours",
  unknown: "time not given",
  exact: "",
  cum_close: "last day to hold for the dividend",
};

export const MARKET_IMPLIED = "market-implied, not a forecast";

export const NOT_DEPLOYED = "The Options Finder is not deployed on the data service yet. This preview page goes live once the API carrying it is deployed.";
