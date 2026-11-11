/**
 * Basket & Hedge's cold-cache burst (the Nov 10 busy diagnosis, option C): the page asks /basket/price and
 * /basket/hedge together and /basket/study only once the price has answered for the same basket, so the study's
 * provider fetches never race the other two for the API's provider slots. A fake slow provider answers the price
 * (invented closes: basket-price-synthetic.json, not market data); the study is the fixtures' served answer for the
 * same ETF basket. Until it is asked, the study card says it waits for the price, never "Computing"; a price that
 * fails holds it, in words; a price answered for another basket never releases it; a busy refusal is not retried.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import synthetic from "../../../fixtures/desk/basket-price-synthetic.json";
import { SAVED_BASKETS_KEY } from "./weights";

const PRICES = (synthetic as { answers: Record<string, unknown> }).answers;
const HOLD_KEY = "SMH:40,SOXX:30,XLK:30|hold|1000000";
const MONTHLY_KEY = "SMH:40,SOXX:30,XLK:30|monthly|1000000";
const legs = [
  { symbol: "SMH", name: null, weight: "40" },
  { symbol: "SOXX", name: null, weight: "30" },
  { symbol: "XLK", name: null, weight: "30" },
];
const HOLD = { id: "local-1", name: "Chip ETFs", legs, saved_at: "2026-09-28T00:00:00Z" };
const MONTHLY = { id: "local-2", name: "Chip ETFs monthly", legs, method: "monthly", saved_at: "2026-09-28T00:00:00Z" };
const STUDY_HOLD = "GET /api/desk/basket/study?legs=SMH%3A40%2CSOXX%3A30%2CXLK%3A30&method=hold";
const STUDY_MONTHLY = "GET /api/desk/basket/study?legs=SMH%3A40%2CSOXX%3A30%2CXLK%3A30&method=monthly";

const keyOf = (u: URL) => `${u.searchParams.get("legs")}|${u.searchParams.get("method") ?? "hold"}|${u.searchParams.get("notional") ?? "1000000"}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const studies = (calls: string[]) => calls.filter((c) => c.startsWith("GET /api/desk/basket/study"));

/** A fake slow provider for one route: each request waits until `release(key)` (or `after` ms when set), then answers
 * the invented price for its basket, and the answer is written into the request log as `ANSWERED <key>`. */
function slowPrices(log: { calls: string[] }, after?: number) {
  const waiting = new Map<string, (() => void)[]>();
  const route = (u: URL) => {
    const key = keyOf(u);
    return new Promise<unknown>((resolve) => {
      const answer = () => {
        log.calls.push(`ANSWERED ${key}`);
        resolve(PRICES[key] ?? { status: 404, body: { error: "no fixture for this basket" } });
      };
      if (after !== undefined) setTimeout(answer, after);
      else waiting.set(key, [...(waiting.get(key) ?? []), answer]);
    });
  };
  const release = (key: string) => {
    for (const f of waiting.get(key) ?? []) f();
    waiting.delete(key);
  };
  return { route, release };
}

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/basket-hedge" },
  );
}

const studyCard = () => screen.findByRole("region", { name: /^Event study on this basket/ });
const realFetch = globalThis.fetch;
beforeEach(() => localStorage.removeItem(SAVED_BASKETS_KEY));
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(SAVED_BASKETS_KEY);
});

describe("Event study on this basket waits for the basket's price (option C)", () => {
  it("on a cold cache the price and the hedge are asked together, the study only after the price answered; then it is served", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = slowPrices(log, 400);
    const hedge = slowPrices(log, 400);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route, "/api/desk/basket/hedge": hedge.route }).calls;
    renderTab();
    const c = await studyCard();
    await waitFor(() => expect(c).toHaveTextContent("Waiting for the basket's prices; the study starts once they arrive"));
    expect(c).toHaveAttribute("data-basket-study", "waiting");
    expect(c).toHaveAttribute("aria-busy", "true");
    expect(c).not.toHaveTextContent("Computing");
    await waitFor(() => expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/hedge"))).toBe(true));
    expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/price"))).toBe(true);
    expect(studies(log.calls)).toEqual([]);
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    // The study was asked once, after the price's answer, for exactly this basket.
    expect(studies(log.calls)).toEqual([STUDY_HOLD]);
    expect(log.calls.indexOf(STUDY_HOLD)).toBeGreaterThan(log.calls.indexOf(`ANSWERED ${HOLD_KEY}`));
    expect(c).toHaveTextContent("After Chip ETFs falls 2σ over 5 days, it was higher a month later");
  });

  it("a busy refusal of the price holds the study, says so, and is not retried; Try again prices it and releases the study", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    let refuse = true;
    const { calls } = stubDesk({
      "/api/desk/basket/price": (u) => (refuse ? { status: 429, body: { error: "rate_limited", message: "SMH: The market-data layer is busy; retry in a moment." } } : PRICES[keyOf(u)]),
    });
    renderTab();
    const step = await screen.findByRole("region", { name: /^How the basket trades/ });
    await waitFor(() => expect(step).toHaveTextContent("This basket could not be priced: SMH: The market-data layer is busy; retry in a moment."));
    const c = await studyCard();
    expect(c).toHaveTextContent("The study starts once the basket is priced; step 2 says why it is not.");
    expect(c).toHaveAttribute("data-basket-study", "held");
    expect(c).toHaveAttribute("aria-busy", "false");
    await sleep(300);
    // The refusal is reported as it came: asked once, no retry, and no study beside it.
    expect(calls.filter((x) => x.startsWith("GET /api/desk/basket/price"))).toHaveLength(1);
    expect(studies(calls)).toEqual([]);
    refuse = false;
    fireEvent.click(within(step).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    expect(studies(calls)).toEqual([STUDY_HOLD]);
  });

  it("another basket's price never releases a study: switched before its own price answers, the study waits for it", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD, MONTHLY]));
    const log = { calls: [] as string[] };
    const price = slowPrices(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    renderTab();
    const c = await studyCard();
    await waitFor(() => expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/price") && x.includes("method=hold"))).toBe(true));
    price.release(HOLD_KEY);
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    expect(studies(log.calls)).toEqual([STUDY_HOLD]);
    // The monthly basket: same names, another study. The held basket's answered price does not release it.
    fireEvent.change(screen.getByRole("region", { name: "Basket" }).querySelector("select")!, { target: { value: "local-2" } });
    await waitFor(() => expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/price") && x.includes("method=monthly"))).toBe(true));
    const m = await studyCard();
    await waitFor(() => expect(m).toHaveAttribute("data-basket-study", "waiting"));
    await sleep(300);
    expect(studies(log.calls)).toEqual([STUDY_HOLD]);
    price.release(MONTHLY_KEY);
    await waitFor(() => expect(m).toHaveAttribute("data-basket-study", "ready"));
    expect(studies(log.calls)).toEqual([STUDY_HOLD, STUDY_MONTHLY]);
    expect(log.calls.indexOf(STUDY_MONTHLY)).toBeGreaterThan(log.calls.indexOf(`ANSWERED ${MONTHLY_KEY}`));
  });

  it("a late price for the basket left behind releases nothing: no study for it, none for the open basket until its own price", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD, MONTHLY]));
    const log = { calls: [] as string[] };
    const price = slowPrices(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    renderTab();
    await studyCard();
    await waitFor(() => expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/price") && x.includes("method=hold"))).toBe(true));
    fireEvent.change(screen.getByRole("region", { name: "Basket" }).querySelector("select")!, { target: { value: "local-2" } });
    await waitFor(() => expect(log.calls.some((x) => x.startsWith("GET /api/desk/basket/price") && x.includes("method=monthly"))).toBe(true));
    // The held basket's price answers now, after the switch.
    price.release(HOLD_KEY);
    await waitFor(() => expect(log.calls).toContain(`ANSWERED ${HOLD_KEY}`));
    await sleep(300);
    expect(studies(log.calls)).toEqual([]);
    expect(await studyCard()).toHaveAttribute("data-basket-study", "waiting");
    price.release(MONTHLY_KEY);
    await waitFor(async () => expect(await studyCard()).toHaveAttribute("data-basket-study", "ready"));
    expect(studies(log.calls)).toEqual([STUDY_MONTHLY]);
  });
});
