/**
 * Basket & Hedge's words (DESK_FRAME3_SPEC §10, desk/books): each card leads
 * with one plain sentence stating its answer with its numbers. Every number
 * here is a served field of /basket/price (§12.14), formatted; a sentence
 * whose numbers are not all served says what is missing instead. Pure.
 */

import type { BasketHedgeResponse, BasketIndex, BasketLegPriced, BasketMethod, BasketPriceResponse, ComparePoint, StressRow, TrendState } from "../data/types";
import { dayLong, dayShort, grouped, num, nyToday, pct, pctPlain } from "../kit/format";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** "CRWV", "CRWV and NBIS", "CRWV, NBIS and SMCI". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How the basket is held, as a sentence. */
export function methodSentence(m: BasketMethod | undefined): string {
  return m === "monthly" ? "Rebalanced to its target weights at each month's last session." : "Bought and held: the share counts are fixed at the start, so the weights drift with price.";
}

/** Why the index starts where it does: the names whose first close it is, or the start of the history. */
export function startWhy(p: Pick<BasketPriceResponse, "start_binding" | "start_is_first_close" | "start_kind" | "start_gap_session">): string {
  const who = p.start_binding ?? [];
  // Codex R-03: a start after a gap says whose close was missing, and on which session.
  if (p.start_kind === "gap" && who.length && p.start_gap_session) return `${listWords(who)} ${who.length === 1 ? "has" : "have"} no close on ${dayLong(p.start_gap_session)}`;
  if (p.start_is_first_close && who.length) return who.length === 1 ? `${who[0]}'s first close` : `the first closes of ${listWords(who)}`;
  return "the start of the daily history the API reads";
}

/** "the first session every name has a price: CRWV's first close" (§10: the start date and why). */
export function startSentence(p: BasketPriceResponse): string | null {
  if (!p.start) return null;
  return `Base 100 on ${dayLong(p.start)}, the first session every name has a price (${startWhy(p)}).`;
}

/** Dollars: "$1,000,000"; compact above a million for volumes ("$25.3B", "$412.0M"). */
export function usd(x: number, compact = false): string {
  if (!fin(x)) return "—";
  if (compact) {
    const sign = x < 0 ? "−" : "";
    const a = Math.abs(x);
    if (a >= 1e9) return `${sign}$${num(a / 1e9, 1)}B`;
    if (a >= 1e6) return `${sign}$${num(a / 1e6, 1)}M`;
    if (a >= 1e3) return `${sign}$${num(a / 1e3, 1)}K`;
  }
  return `${x < 0 ? "−" : ""}$${grouped(Math.abs(x))}`;
}

/** Days to trade: two significant digits under a hundredth, two decimals under one, one under ten. */
export function daysText(d: number): string {
  if (!fin(d)) return "—";
  const v = d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d >= 0.01 ? d.toFixed(2) : d.toPrecision(2);
  return `${v} ${v === "1.0" || v === "1" ? "day" : "days"}`;
}

/** "+0.4% today", or "on Sep 22" for an earlier session (the Technicals price card's rule). */
export function dayChange(chg: number, to: string, today = nyToday()): string {
  return `${pct(chg)} ${to === today ? "today" : `on ${dayShort(to)}`}`;
}

/** "index is 2.1% above" from the served distance to an average. */
export function vsAverage(frac: number): string {
  const n = Math.abs(frac * 100).toFixed(1);
  return `index is ${n}% ${frac >= 0 ? "above" : "below"}`;
}

/** A trend state as the lead says it (§12.7's states). */
export function trendPhrase(t: { state: TrendState; state_since: string | null } | undefined): string | null {
  if (!t) return null;
  const since = t.state_since ? ` since ${dayShort(t.state_since)}` : "";
  switch (t.state) {
    case "above_both":
      return `above both its 50- and 200-day averages${since}`;
    case "below_both":
      return `below both its 50- and 200-day averages${since}`;
    case "mixed":
      return `between its 50- and 200-day averages${since}`;
    default:
      return "its 200-day average needs 200 sessions of the index";
  }
}

/** "Up 346.5%" / "Down 12.3%" / "Flat". */
export function upDown(frac: number, digits = 1): string {
  const s = pctPlain(Math.abs(frac), digits);
  return Number(Math.abs(frac * 100).toFixed(digits)) === 0 ? "Flat" : `${frac > 0 ? "Up" : "Down"} ${s}`;
}

/** The index card's lead. */
export function indexLead(p: BasketPriceResponse): string | null {
  const ix = p.index;
  if (!ix || !fin(p.total_return) || !p.start) return null;
  const year = fin(ix.ret_1y) ? ` and ${pct(ix.ret_1y)} over the last year` : "";
  const trend = trendPhrase(ix.trend);
  return `${upDown(p.total_return)} since ${dayLong(p.start)}${year}${trend ? `; ${trend}` : ""}.`;
}

/** The momentum and risk card's lead. */
export function momentumLead(ix: BasketIndex | undefined): string | null {
  if (!ix) return null;
  const parts: string[] = [];
  if (fin(ix.rsi)) parts.push(`RSI(14) is ${num(ix.rsi, 0)}`);
  const dd = ix.drawdown;
  if (dd && fin(dd.now)) parts.push(dd.now < 0 ? `the index is ${pctPlain(-dd.now, 1)} below its ${dayLong(dd.peak_date)} peak` : "the index is at its peak");
  if (fin(ix.realized_vol_21d)) parts.push(`the last 21 sessions moved at ${pctPlain(ix.realized_vol_21d, 0)} a year`);
  if (!parts.length) return null;
  const s = listWords(parts);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** A rebased level as a change from 100: 146.2 → "+46.2%". */
const fromBase = (v: number) => pct(v / 100 - 1);

/** The comparison card's lead: on the one-year range, the one-year returns over the index's own one-year
 * dates (the index card's number); on a shorter range, the rebased chart's last values. */
export function compareLead(p: BasketPriceResponse, range: "6m" | "1y"): string | null {
  const qqq = p.benchmarks?.qqq;
  const spy = p.benchmarks?.spy;
  const ix = p.index;
  let head: string | null = null;
  if (range === "1y" && ix && fin(ix.ret_1y) && ix.ret_1y_dates && qqq && spy && fin(qqq.ret_1y) && fin(spy.ret_1y)) {
    head = `Over the last year (since ${dayLong(ix.ret_1y_dates.from)}) the basket returned ${pct(ix.ret_1y)}, against ${pct(qqq.ret_1y)} for QQQ and ${pct(spy.ret_1y)} for SPY`;
  } else {
    const c = p.compare?.[range];
    const last = c ? [...c.points].reverse().find((q) => fin(q.basket) && fin(q.qqq) && fin(q.spy)) : undefined;
    if (!last || !c?.base_date) return null;
    head = `Since ${dayLong(c.base_date)} the basket is ${fromBase(last.basket as number)}, against ${fromBase(last.qqq as number)} for QQQ and ${fromBase(last.spy as number)} for SPY`;
  }
  if (qqq && fin(qqq.beta_1y) && fin(qqq.corr_1y)) return `${head}; over a year it has moved ${num(qqq.beta_1y, 2)}× QQQ, correlation ${num(qqq.corr_1y, 2)}.`;
  if (qqq && fin(qqq.beta_60d) && fin(qqq.corr_60d)) return `${head}; over 60 sessions it has moved ${num(qqq.beta_60d, 2)}× QQQ, correlation ${num(qqq.corr_60d, 2)}.`;
  return `${head}.`;
}

/** One relative line's words: "at 162, above its 50-day average". */
function rsWords(v: number | null, ma: number | null): string | null {
  if (!fin(v)) return null;
  const vs = fin(ma) ? (v > ma ? ", above its 50-day average" : v < ma ? ", below its 50-day average" : ", on its 50-day average") : "";
  return `at ${num(v, 0)}${vs}`;
}

/** The relative-strength card's lead. */
export function rsLead(pts: readonly ComparePoint[], base: string | null | undefined): string | null {
  const last = [...pts].reverse().find((p) => fin(p.rs_qqq) || fin(p.rs_spy));
  if (!last || !base) return null;
  const q = rsWords(last.rs_qqq, last.rs_qqq_ma50);
  const s = rsWords(last.rs_spy, last.rs_spy_ma50);
  const parts = [q ? `against QQQ ${q}` : null, s ? `against SPY ${s}` : null].filter(Boolean) as string[];
  if (!parts.length) return null;
  return `Basket ÷ benchmark, 100 on ${dayShort(base)}: ${parts.join("; ")}.`;
}

/** The legs with a served contribution, largest first. */
export function byContribution(legs: readonly BasketLegPriced[] | undefined): (BasketLegPriced & { contribution: number })[] {
  return (legs ?? []).filter((l): l is BasketLegPriced & { contribution: number } => fin(l.contribution)).sort((a, b) => b.contribution - a.contribution);
}

/** The contribution card's lead: the most and the least of the index's return, in points. */
export function contributionLead(p: BasketPriceResponse): string | null {
  const rows = byContribution(p.legs);
  if (!rows.length || !fin(p.total_return) || !p.start) return null;
  const pt = (x: number) => `${x < 0 ? "−" : ""}${num(Math.abs(x) * 100, 1)}`;
  const top = rows[0];
  const low = rows[rows.length - 1];
  const head = `${top.symbol} added ${pt(top.contribution)} of the index's ${pt(p.total_return)} points since ${dayShort(p.start)}`;
  return rows.length > 1 ? `${head}; ${low.symbol} added the least, ${pt(low.contribution)}.` : `${head}.`;
}

/** The concentration card's lead. */
export function concentrationLead(c: BasketPriceResponse["concentration"]): string | null {
  if (!c || !fin(c.top3_share) || !fin(c.effective_n)) return null;
  const corr = fin(c.avg_pairwise_corr) ? `, and its names' average pairwise correlation is ${num(c.avg_pairwise_corr, 2)}` : "";
  const who = c.top3.length === 1 ? `${c.top3[0]} is` : `${listWords(c.top3)} are`;
  return `${who} ${pctPlain(c.top3_share, 0)} of the basket at the last close; it holds like ${num(c.effective_n, 1)} equal-weight names${corr}.`;
}

/** The liquidity card's lead. */
export function liquidityLead(p: BasketPriceResponse): string | null {
  const q = p.liquidity;
  if (!q || !fin(q.basket_days) || !q.binding || !fin(p.notional)) return null;
  return `At ${usd(p.notional)} the slowest name to trade is ${q.binding}: ${daysText(q.basket_days)} at ${pctPlain(q.participation ?? 0.2, 0)} of its ${q.adv_sessions ?? 20}-day average dollar volume.`;
}

// ── Step 3: the ETF hedge (§12.15) ────────────────────────────────────────

/** A dollar P&L as a verb: "loses $223,092", "makes $222", "is flat". */
export function pnlWords(usdPnl: number): string {
  if (!fin(usdPnl)) return "—";
  const r = Math.round(usdPnl);
  return r === 0 ? "is flat" : r < 0 ? `loses ${usd(-r)}` : `makes ${usd(r)}`;
}

/** The ETF table's lead: the top pick, its fit, the short and what it does to the basket's volatility. */
export function hedgeLead(h: BasketHedgeResponse): string | null {
  const top = h.etfs?.find((e) => e.symbol === h.top);
  if (!top || !fin(top.hedge_ratio) || !fin(top.short_usd) || !fin(top.basket_vol) || !fin(top.residual_vol) || !fin(top.vol_reduction) || !fin(h.notional)) return null;
  const r2 = top.basis === "1y" ? top.r2_1y : top.r2_60d;
  if (!fin(r2)) return null;
  const over = top.basis === "1y" ? "a year" : "60 sessions";
  return `${top.symbol} fits the basket best (R² ${num(r2, 2)} over ${over}): short ${usd(top.short_usd)} of it against ${usd(h.notional)} and the basket's volatility falls from ${pctPlain(top.basket_vol, 0)} to ${pctPlain(top.residual_vol, 0)}, ${pctPlain(top.vol_reduction, 0)} less.`;
}

/** The stress card's lead: each shock, unhedged and hedged with the top pick. */
export function stressLead(h: BasketHedgeResponse): string | null {
  const rows = (h.stress ?? []).filter((s) => fin(s.unhedged_usd) && fin(s.move));
  if (!rows.length) return null;
  const parts = rows.map((s) => {
    const head = `if ${s.shock} falls ${pctPlain(Math.abs(s.move as number), 0)} the basket ${pnlWords(s.unhedged_usd as number)} unhedged`;
    return fin(s.hedged_usd) && s.hedge ? `${head} and ${pnlWords(s.hedged_usd)} hedged with ${s.hedge}` : head;
  });
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

// ── Step 1: the basket (§10) ──────────────────────────────────────────────

/** "10% each", or "the largest NVDA at 22%": the saved weights in words. */
export function weightsWords(legs: readonly { symbol: string; weight: number | string }[]): string {
  const w = legs.map((l) => ({ s: l.symbol, v: Number(l.weight) }));
  if (!w.length) return "";
  if (w.every((x) => x.v === w[0].v)) return `${num(w[0].v, Number.isInteger(w[0].v) ? 0 : 1)}% each`;
  const top = [...w].sort((a, b) => b.v - a.v)[0];
  return `the largest ${top.s} at ${num(top.v, Number.isInteger(top.v) ? 0 : 1)}%`;
}

/** The basket card's lead: what the basket is, and, once priced, what it has done since its start. */
export function basketLead(
  b: { name: string; legs: readonly { symbol: string; weight: number | string }[] },
  method: BasketMethod,
  notional: number,
  p: BasketPriceResponse | undefined,
): string {
  const n = b.legs.length;
  if (!n) return `${b.name} holds no name yet: add tickers, then Save to price it.`;
  const held = method === "monthly" ? "rebalanced monthly" : "bought and held";
  const head = `${b.name} holds ${n} ${n === 1 ? "name" : "names"}, ${weightsWords(b.legs)}, ${held}, ${usd(notional)}`;
  if (!p || !p.start || !fin(p.total_return)) return `${head}.`;
  return `${head}: ${upDown(p.total_return).toLowerCase()} since ${dayLong(p.start)}, the first session every name has a price (${startWhy(p)}).`;
}

/** Closes left out of an answer (Codex R-07), in words: "Left out: SPLT, 1 session (no adjusted close from the provider)." */
export function excludedWords(ex: readonly { symbol: string; n: number | null; reason?: string }[] | undefined): string | null {
  const rows = (ex ?? []).filter((e) => fin(e.n) && (e.n as number) > 0);
  if (!rows.length) return null;
  return `Left out: ${rows.map((e) => `${e.symbol}, ${e.n} ${e.n === 1 ? "session" : "sessions"}${e.reason ? ` (${e.reason})` : ""}`).join("; ")}.`;
}

/** The stress card's footnote from the served windows and basis (Codex R-09): never "one-year" for a 60-session fit. */
export function stressWindowWords(h: BasketHedgeResponse): string | null {
  const rows = (h.stress ?? []).filter((s) => s.window && s.window.start && s.window.end && fin(s.window.n));
  if (!rows.length) return null;
  const basis = h.etfs?.find((e) => e.symbol === h.top)?.basis;
  const span = (w: NonNullable<StressRow["window"]>) => `the ${w.n} sessions from ${dayLong(w.start)} to ${dayLong(w.end)}`;
  const same = rows.every((s) => s.window!.start === rows[0].window!.start && s.window!.end === rows[0].window!.end && s.window!.n === rows[0].window!.n);
  const where = same ? span(rows[0].window!) : rows.map((s) => `${s.shock}: ${span(s.window!)}`).join("; ");
  const length = basis === "1y" ? "one year" : basis === "60d" ? "60 sessions, fewer than a year of shared returns" : null;
  return `Betas fitted on ${where}${length ? ` (${length})` : ""}, on which the basket, ${h.top ?? "the ETF"} and the shock all trade. No convexity, no costs.`;
}

/** When the hedge and the price answers read different sessions, the page says so (Codex R-08). */
export function asOfMismatch(priceAsOf: string | null | undefined, hedgeAsOf: string | null | undefined): string | null {
  if (!priceAsOf || !hedgeAsOf || priceAsOf === hedgeAsOf) return null;
  return `The hedge reads prices through ${dayLong(hedgeAsOf)}; the basket above reads them through ${dayLong(priceAsOf)}. The two were answered at different sessions.`;
}
