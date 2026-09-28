/**
 * "Hedge with options" (PROTOTYPE, DESK_FRAME3_SPEC §10, §1.0.3): the three
 * routes are Black-Scholes at the stated volatilities on the basket engine's
 * inputs, and every cost, breakeven and payoff agrees with its closed form.
 */
import { describe, expect, it } from "vitest";
import o from "../../../fixtures/desk/proto-options.json";
import books from "../../../fixtures/desk/proto-books-basket.json";
import { putValue, years } from "./black-scholes";
import { basketInputs, inputsFrom, sampleBasket } from "./basket-inputs";
import { etfStrike, hedge, largest, pct2, STRUCTURES, usd, usdM, type Priced } from "./options";

const inputs = basketInputs(sampleBasket())!;
const h = hedge(inputs);
type Ok = Extract<Priced, { reason: null }>;
/** A priced row: the sample basket's are all inside the domain. */
const ok = (p: Priced): Ok => {
  if (p.reason !== null) throw new Error(p.reason);
  return p;
};
const route = (k: string) => {
  const r = h.routes.find((x) => x.key === k)!;
  return { ...r, rows: r.rows.map(ok) };
};
const put = (strike: number, days: number, vol: number, q: number) => putValue({ strike, t: years(days), vol: vol / 100, r: o.rate, q });

describe("the basket engine's inputs (the rebase seam)", () => {
  it("the stand-in answers for the sample basket as saved, whatever its id: §12.15's notional, top, and the top row's ratio and R²", () => {
    expect(inputs).not.toBeNull();
    expect(inputs.notional).toBe(books.notional);
    expect(inputs.top.symbol).toBe(books.top);
    expect(inputs.top.symbol).toBe("XLK");
    const row = books.etfs.find((e) => e.symbol === books.top)!;
    expect(row.rank).toBe(1);
    expect(inputs.top.hedge_ratio).toBe(row.hedge_ratio);
    expect(inputs.top.r2).toBe(row.r2_1y);
    expect(inputs.window).toEqual(row.window_1y);
    expect(inputs.basketVol).toBe(row.basket_vol);
    expect(inputs.next?.symbol).toBe("SMH");
    expect(inputs.ranked).toBe(8);
    expect(basketInputs({ ...sampleBasket(), id: "local-7" })?.basketId).toBe("local-7");
    // Weights saved as the exact decimals typed read the same.
    expect(basketInputs({ ...sampleBasket(), legs: sampleBasket().legs.map((l) => ({ ...l, weight: String(l.weight) })) })).not.toBeNull();
  });

  it("and for no other basket: other weights, other names, none", () => {
    const legs = sampleBasket().legs;
    expect(basketInputs({ ...sampleBasket(), legs: legs.map((l, i) => (i === 6 ? { ...l, weight: 8 } : l)) })).toBeNull();
    expect(basketInputs({ ...sampleBasket(), legs: legs.slice(1) })).toBeNull();
    expect(basketInputs(null)).toBeNull();
  });

  it("inputsFrom reads a served answer: a young basket's 60-day basis, and no top pick is no inputs", () => {
    const row = { symbol: "QQQ", label: "Nasdaq 100", rank: 1, basis: "60d" as const, r2_1y: null, r2_60d: 0.5, hedge_ratio: 1.5, window_60d: { start: "2026-06-29", end: "2026-09-23", n: 60 } };
    const got = inputsFrom({ notional: 250000, top: "QQQ", etfs: [row] }, sampleBasket());
    expect(got).toMatchObject({ notional: 250000, top: { symbol: "QQQ", hedge_ratio: 1.5, r2: 0.5 }, next: null, window: { n: 60 } });
    expect(inputsFrom({ notional: 250000, top: null, etfs: [row] }, sampleBasket())).toBeNull();
    expect(inputsFrom({ notional: 250000, top: "QQQ", etfs: [{ ...row, hedge_ratio: null }] }, sampleBasket())).toBeNull();
  });
});

describe("the three routes", () => {
  const beta = inputs.top.hedge_ratio;
  const xlk = o.etfs.XLK;
  const N = books.notional;

  it("(a) puts on the ETF: hedge ratio × notional of it, at the basket's strikes moved by the ratio; the ETF moves by the basket's move ÷ the ratio", () => {
    const a = route("etf");
    expect(h.etf?.notional).toBeCloseTo(beta * N, 6);
    expect(etfStrike(0.95, beta)).toBeCloseTo(1 - 0.05 / beta, 12);
    expect(h.etf?.strikes.long).toBeCloseTo(0.9639, 4);
    expect(h.etf?.strikes.short).toBeCloseTo(0.8917, 4);
    const k95 = etfStrike(0.95, beta);
    const k85 = etfStrike(0.85, beta);
    const p1 = put(k95, 30, xlk.vol["1m_95"], xlk.q);
    expect(a.rows[0].cost).toBeCloseTo(beta * p1, 12);
    // Breakeven: the basket's fall at which β × (K_etf − (1 − x / β)) repays β × premium.
    expect(a.rows[0].breakeven).toBeCloseTo(0.05 + beta * p1, 9);
    // Moved strikes protect the basket's own level: at −10% the 95 put pays 5% of notional, as the basket put does.
    expect(a.rows[0].payoff).toBeCloseTo(0.05, 12);
    const spread = put(k95, 30, xlk.vol["1m_95"], xlk.q) - put(k85, 30, xlk.vol["1m_85"], xlk.q);
    expect(a.rows[2].cost).toBeCloseTo(beta * spread, 12);
    expect(pct2(a.rows[0].cost)).toBe("1.90%");
    expect(usd(a.rows[0].costUsd)).toBe("$19,000");
    expect(usd(a.rows[0].payoffUsd)).toBe("$50,000");
  });

  it("(b) the three largest names, each sized to its weight and moving with the basket", () => {
    expect(largest(inputs.legs).map((l) => l.symbol)).toEqual(["NVDA", "AVGO", "VRT"]);
    // A tie keeps the basket's order.
    expect(largest([{ symbol: "A", name: null, weight: 10 }, { symbol: "B", name: null, weight: 20 }, { symbol: "C", name: null, weight: 10 }, { symbol: "D", name: null, weight: 10 }]).map((l) => l.symbol)).toEqual(["B", "A", "C"]);
    const b = route("names");
    expect(b.covered).toBeCloseTo(0.52, 12);
    const cost = (["NVDA", "AVGO", "VRT"] as const).reduce((a, s) => a + (inputs.legs.find((l) => l.symbol === s)!.weight / 100) * put(0.95, 30, o.names[s].vol["1m_95"], o.names[s].q), 0);
    expect(b.rows[0].cost).toBeCloseTo(cost, 12);
    expect(b.rows[0].breakeven).toBeCloseTo(cost / 0.52 + 0.05, 9);
    expect(b.rows[0].payoff).toBeCloseTo(0.52 * 0.05, 12);
    expect(usd(b.rows[0].payoffUsd)).toBe("$26,000");
  });

  it("(c) the basket put: the ETF's vol at the strike × the ratio ÷ √R², plus the dealer's margin; an exact payoff", () => {
    const c = route("otc");
    const vol = (k: "1m_95" | "1m_85" | "3m_95") => (beta * xlk.vol[k]) / Math.sqrt(inputs.top.r2) + o.basket.dealer_margin_pts;
    expect(h.basket?.vol["1m_95"]).toBeCloseTo(vol("1m_95"), 12);
    expect(vol("1m_95")).toBeCloseTo(44.81, 2);
    // Just above the engine's own realized basket vol on the same window (44.1%): the dealer's margin over it.
    expect(vol("1m_95") / 100).toBeGreaterThan(inputs.basketVol!);
    const p1 = put(0.95, 30, vol("1m_95"), o.basket.q);
    expect(c.rows[0].cost).toBeCloseTo(p1, 12);
    expect(c.rows[0].breakeven).toBeCloseTo(1 - 0.95 + p1, 9);
    expect(c.rows[0].payoff).toBeCloseTo(0.05, 12);
    expect(c.rows[1].cost).toBeCloseTo(put(0.95, 91, vol("3m_95"), o.basket.q), 12);
  });

  it("on every route the spread costs less than the put and the 3-month put more; the ETF and the basket put pay the same at −10%, the names less", () => {
    expect(STRUCTURES.map((s) => s.label)).toEqual(["1M 95 put", "3M 95 put", "1M 95/85 put spread"]);
    for (const r of h.routes.map((x) => route(x.key))) {
      const [p1, p3, sp] = r.rows;
      expect(sp.cost).toBeLessThan(p1.cost);
      expect(p3.cost).toBeGreaterThan(p1.cost);
      for (const row of r.rows) expect(row.costUsd).toBeCloseTo(row.cost * N, 6);
    }
    expect(route("otc").rows[0].payoff).toBeCloseTo(route("etf").rows[0].payoff, 12);
    expect(route("etf").rows[0].payoff).toBeGreaterThan(route("names").rows[0].payoff);
    // The ETF's lower vol is the variance it does not carry: the exact hedge costs more.
    expect(route("otc").rows[0].cost).toBeGreaterThan(route("etf").rows[0].cost);
    expect(usdM(inputs.notional)).toBe("$1.0M");
  });

  it("a name with no assumed vol takes the stated default, and says so", () => {
    const other = hedge({ ...inputs, legs: [{ symbol: "ZZZZ", name: null, weight: 40 }, ...inputs.legs.slice(0, 2)] });
    expect(other.routes.every((r) => r.rows.every((p) => p.reason === null))).toBe(true);
    expect(other.names[0]).toMatchObject({ symbol: "ZZZZ", assumed: true, vol: o.name_default.vol });
    expect(other.names[1].assumed).toBe(false);
  });

  it("the stand-in is §12.15's answer for the sample basket: its request key, eight ETFs ranked by R², a year each, and an assumed vol for every one", () => {
    expect(books.request).toBe(`${sampleBasket().legs.map((l) => `${l.symbol}:${l.weight}`).join(",")}|hold|1000000`);
    expect(books.ranked_by).toBe("r2_1y");
    expect(books.etfs.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const r2 = books.etfs.map((e) => e.r2_1y!);
    expect(r2).toEqual([...r2].sort((a, b) => b - a));
    for (const e of books.etfs) {
      expect(e.window_1y.n).toBe(252);
      expect(Object.keys(o.etfs)).toContain(e.symbol);
    }
    expect(books.legs.reduce((a, l) => a + l.weight, 0)).toBe(100);
  });
});

describe("Codex R-02: each structure is priced only inside its domain; outside it, a plain reason and no number", () => {
  const at = (ratio: number) => hedge({ ...inputs, top: { ...inputs.top, hedge_ratio: ratio } });
  const numbersOf = (h: ReturnType<typeof hedge>) => h.routes.flatMap((r) => r.rows.flatMap((p) => (p.reason === null ? [p.cost, p.costUsd, p.payoff, p.payoffUsd, p.breakeven ?? 0] : [])));

  it("hedge_ratio 0.10: the ETF and basket routes are not priced, each row says why; the names route still is; no NaN", () => {
    const h = at(0.1);
    const etf = h.routes.find((r) => r.key === "etf")!;
    const otc = h.routes.find((r) => r.key === "otc")!;
    for (const p of [...etf.rows, ...otc.rows]) expect(p.reason).toBe("Not priced: the hedge ratio, 0.10, is outside the 0.25 to 4 this card prices.");
    for (const p of h.routes.find((r) => r.key === "names")!.rows) expect(p.reason).toBeNull();
    expect(numbersOf(h).every(Number.isFinite)).toBe(true);
    // A number that is not finite serializes as null: no priced field is.
    expect(JSON.stringify(h.routes)).not.toMatch(/"(cost|costUsd|payoff|payoffUsd)":null/);
  });

  it("hedge_ratio 0.25: the puts are priced; the spread's 85% strike moves to 40% of the ETF, outside 50% to 100%, so it is not", () => {
    const etf = at(0.25).routes.find((r) => r.key === "etf")!;
    expect(etf.rows[0].reason).toBeNull();
    expect(etf.rows[1].reason).toBeNull();
    expect(etf.rows[2].reason).toBe("Not priced: the 85% strike moves to 40.0% of XLK, outside the 50% to 100% of spot this card prices.");
  });

  it("a ratio that is not a number, an R² outside (0, 1], a vol that is not positive: not priced, with the reason", () => {
    expect(at(NaN).routes.find((r) => r.key === "etf")!.rows[0].reason).toBe("Not priced: no hedge ratio was served.");
    const r2 = hedge({ ...inputs, top: { ...inputs.top, r2: 0 } }).routes.find((r) => r.key === "otc")!;
    expect(r2.rows[0].reason).toBe("Not priced: an R² of 0.00 cannot carry the ETF's volatility to the basket's.");
    const flat = hedge({ ...inputs, legs: [{ symbol: "ZZZZ", name: null, weight: 100 }] }, { name_default: { q: 0, vol: { "1m_95": 0, "1m_85": 0, "3m_95": 0 } } });
    for (const p of flat.routes.find((r) => r.key === "names")!.rows) expect(p.reason).toBe("Not priced: no volatility is assumed for ZZZZ at this strike.");
  });
});
