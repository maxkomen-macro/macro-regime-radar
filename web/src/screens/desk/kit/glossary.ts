/**
 * The Desk's hover definitions (desk/usability item 11, DESK_FRAME3_SPEC §14.11):
 * one plain sentence per term of art, shown on hover or focus wherever a label,
 * a card head or a column head prints the term (kit/Term.tsx). The sentences
 * follow the Desk's ban list (desk-language.test.ts reads this file) and state
 * the Desk's own windows (RSI 14, realized volatility 21 sessions, σ over 252).
 */
export interface GlossaryTerm {
  /** How the term is printed on a page; the longest matching form wins. */
  forms: readonly string[];
  /** One plain sentence. */
  text: string;
}

export const GLOSSARY: Readonly<Record<string, GlossaryTerm>> = {
  sigma: { forms: ["σ"], text: "σ (sigma) is one standard deviation: a move's size against this series' usual moves of the same length over the last 252 sessions." },
  oas: { forms: ["HY spread", "high-yield spread", "High-yield spread", "OAS"], text: "The high-yield spread (an option-adjusted spread, OAS) is the extra yield bonds rated below investment grade pay over Treasuries of the same maturity." },
  ig: { forms: ["Investment grade", "investment grade"], text: "Investment grade is corporate credit rated BBB− or better; the figure is its extra yield over Treasuries." },
  hy: { forms: ["HY"], text: "HY is high-yield credit: corporate bonds rated below investment grade." },
  curve: { forms: ["2s10s"], text: "2s10s is the 10-year Treasury yield minus the 2-year; above zero the curve slopes up, below zero it is inverted." },
  steep: { forms: ["steepening", "flattening"], text: "Steepening means the 10-year yield is rising against the 2-year, so 2s10s widens; flattening is the reverse." },
  front: { forms: ["Front end"], text: "The front end is the short end of the Treasury curve; here, the 3-month bill yield." },
  bp: { forms: ["basis points", "bp"], text: "A basis point (bp) is one hundredth of a percentage point: 25 bp is 0.25 percentage points." },
  rsi: { forms: ["RSI"], text: "The relative strength index scores the last 14 sessions' gains against their losses from 0 to 100; above 70 reads as stretched up, below 30 as stretched down." },
  realized: { forms: ["realized volatility", "Realized volatility", "realized vol", "Realized vol"], text: "Realized volatility is how much the price actually moved: the standard deviation of the last 21 daily log returns, annualized." },
  implied: { forms: ["implied volatility", "Implied volatility", "implied vol", "Implied vol", "IV"], text: "Implied volatility is the size of move option prices assume over their life, annualized; set against realized volatility it shows whether options are rich or cheap." },
  skew: { forms: ["skew", "Skew", "SKEW"], text: "Skew is how much more the market pays for puts than for calls the same distance from the price: the price of crash protection." },
  vix: { forms: ["VIX"], text: "The VIX is the 30-day volatility the S&P 500's option prices imply, in annual percentage points." },
  drawdown: { forms: ["From 1-year high", "drawdown", "Drawdown"], text: "The drawdown is how far the price sits below its highest close of the last 252 sessions." },
  ma: { forms: ["50-day average", "200-day average", "50-day", "200-day"], text: "A moving average is the mean of the last 50 or 200 daily closes; a price above both is in an uptrend." },
  cross: { forms: ["golden cross", "Golden cross", "death cross", "Death cross"], text: "A golden cross is the 50-day average rising above the 200-day; a death cross is the 50-day falling below it." },
  rs: { forms: ["Relative strength", "relative strength"], text: "Relative strength is the price divided by the S&P 500's; a rising line means it is beating the index." },
  logret: { forms: ["log returns", "log return"], text: "A log return is the natural log of the price ratio; for moves this size it is close to the percent change." },
  corr: { forms: ["60-day correlation", "Correlation", "correlation"], text: "Correlation runs from −1 to +1: how closely two assets' daily returns move together, here over the last 60 sessions." },
  breadth: { forms: ["Breadth", "breadth"], text: "Breadth is how much of the market joins a move; here, how many sector ETFs sit above their 50-day and 200-day averages, and the average stock against the index." },
  baseline: { forms: ["Vs normal", "vs normal", "a normal stretch"], text: "Normal is the study's baseline: the same horizon's move over every evaluable session of its sample, not only after events." },
  blocks: { forms: ["overlap blocks"], text: "Events whose outcome windows overlap form one block and are resampled together, so one market episode counts once." },
  interval: { forms: ["90% interval"], text: "The range the median's excess over normal falls in on 90% of resampled histories." },
  lag: { forms: ["K−2"], text: "K−2 is the regime row stamped two months before the month in question, so a label uses only data already published by then." },
  nav: { forms: ["% NAV", "NAV"], text: "NAV is net asset value, the size of the whole book: a 4% NAV position is 4% of it." },
  dv01: { forms: ["DV01"], text: "DV01 is the money a position gains or loses when yields move one basis point." },
  beta: { forms: ["beta", "Beta"], text: "Beta is how far a position tends to move for a 1% move in its benchmark." },
  r2: { forms: ["R²"], text: "R² is the share of a position's daily moves its benchmark explains, from 0 to 1." },
  notional: { forms: ["notional", "Notional"], text: "Notional is the face value a position controls, not the cash it costs." },
};

interface Form {
  form: string;
  id: string;
}

const FORMS: readonly Form[] = Object.entries(GLOSSARY)
  .flatMap(([id, t]) => t.forms.map((form) => ({ form, id })))
  .sort((a, b) => b.form.length - a.form.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A form that starts or ends with a letter or digit matches only as a whole word ("IV" is not in "DIVIDEND"). */
const bounded = (f: string) => `${/^[A-Za-z0-9]/.test(f) ? "(?<![A-Za-z0-9])" : ""}${escape(f)}${/[A-Za-z0-9²]$/.test(f) ? "(?![A-Za-z0-9])" : ""}`;
const PATTERN = new RegExp(FORMS.map((f) => bounded(f.form)).join("|"), "g");
const BY_FORM = new Map(FORMS.map((f) => [f.form, f.id]));

export interface Segment {
  text: string;
  /** The glossary id when the segment is a term. */
  term?: string;
}

/**
 * A text cut at the terms it prints. Each term is marked once per text, at its
 * first occurrence: the second "σ" in one label adds nothing a reader needs.
 */
export function splitTerms(text: string, seen: Set<string> = new Set()): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const id = BY_FORM.get(m[0]);
    if (!id || seen.has(id) || m.index === undefined) continue;
    seen.add(id);
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], term: id });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function definition(id: string): string | undefined {
  return GLOSSARY[id]?.text;
}
