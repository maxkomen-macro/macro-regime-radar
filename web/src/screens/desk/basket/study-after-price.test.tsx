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
import { deskFixture } from "../../../fixtures/desk";
import synthetic from "../../../fixtures/desk/basket-price-synthetic.json";
import { SAVED_BASKETS_KEY } from "./weights";

const PRICES = (synthetic as { answers: Record<string, unknown> }).answers;
const HOLD_KEY = "SMH:40,SOXX:30,XLK:30|hold|1000000";
const MONTHLY_KEY = "SMH:40,SOXX:30,XLK:30|monthly|1000000";
const HOLD_2M_KEY = "SMH:40,SOXX:30,XLK:30|hold|2000000";
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

  /** A price route switchable between answering at once, holding until `release()`, and refusing as busy. */
  function switchablePrice(log: { calls: string[] }) {
    const st = { mode: "now" as "now" | "hold" | "refuse", held: [] as (() => void)[] };
    const route = (u: URL) => {
      const key = keyOf(u);
      const answer = (resolve: (v: unknown) => void) => {
        log.calls.push(`ANSWERED ${key}`);
        resolve(PRICES[key]);
      };
      if (st.mode === "refuse") return { status: 429, body: { error: "rate_limited", message: "SMH: The market-data layer is busy; retry in a moment." } };
      return new Promise<unknown>((resolve) => (st.mode === "now" ? answer(resolve) : st.held.push(() => answer(resolve))));
    };
    const release = () => {
      for (const f of st.held.splice(0)) f();
    };
    return { st, route, release };
  }

  it("a new database generation refetches the price first; the study is asked again only after the price answers (Codex S-2)", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = switchablePrice(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    const { client } = renderTab();
    const c = await studyCard();
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    expect(studies(log.calls)).toEqual([STUDY_HOLD]);
    // The generation listener (api/queries.ts useFreshness) drops and refetches everything read from the database.
    price.st.mode = "hold";
    const before = log.calls.length;
    void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) !== "freshness" });
    await waitFor(() => expect(log.calls.slice(before).some((x) => x.startsWith("GET /api/desk/basket/price"))).toBe(true));
    await sleep(300);
    // The hedge is asked beside the price, as before; the study waits.
    expect(log.calls.slice(before).some((x) => x.startsWith("GET /api/desk/basket/hedge"))).toBe(true);
    expect(studies(log.calls.slice(before))).toEqual([]);
    price.release();
    await waitFor(() => expect(studies(log.calls.slice(before))).toEqual([STUDY_HOLD]));
    const after = log.calls.slice(before);
    expect(after.indexOf(STUDY_HOLD)).toBeGreaterThan(after.indexOf(`ANSWERED ${HOLD_KEY}`));
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
  });

  it("a price refused on the new generation holds the study's refetch until a later price answers; nothing is retried by itself", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = switchablePrice(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    const { client } = renderTab();
    const c = await studyCard();
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    price.st.mode = "refuse";
    const before = log.calls.length;
    void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) !== "freshness" });
    const step = screen.getByRole("region", { name: /^How the basket trades/ });
    await waitFor(() => expect(step).toHaveTextContent("This basket could not be priced: SMH: The market-data layer is busy; retry in a moment."));
    await sleep(300);
    expect(log.calls.slice(before).filter((x) => x.startsWith("GET /api/desk/basket/price"))).toHaveLength(1);
    expect(studies(log.calls.slice(before))).toEqual([]);
    price.st.mode = "now";
    fireEvent.click(within(step).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(studies(log.calls.slice(before))).toEqual([STUDY_HOLD]));
    const after = log.calls.slice(before);
    expect(after.indexOf(STUDY_HOLD)).toBeGreaterThan(after.indexOf(`ANSWERED ${HOLD_KEY}`));
  });

  it("a new notional saved while the study waits on a refused price releases it on the new price; the old one is not asked again (Codex S-3)", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = switchablePrice(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    const { client } = renderTab();
    const c = await studyCard();
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    price.st.mode = "refuse";
    const before = log.calls.length;
    void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) !== "freshness" });
    const step = screen.getByRole("region", { name: /^How the basket trades/ });
    await waitFor(() => expect(step).toHaveTextContent("This basket could not be priced: SMH: The market-data layer is busy; retry in a moment."));
    expect(studies(log.calls.slice(before))).toEqual([]);
    // The notional is the price's, not the study's: saving another one keeps the same study waiting, now on the new
    // price (invented closes, basket-price-synthetic.json), which answers.
    price.st.mode = "now";
    fireEvent.change(screen.getByRole("textbox", { name: "Notional, dollars" }), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Save basket/ }));
    await waitFor(() => expect(log.calls).toContain(`ANSWERED ${HOLD_2M_KEY}`));
    await waitFor(() => expect(studies(log.calls.slice(before))).toEqual([STUDY_HOLD]));
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    const after = log.calls.slice(before);
    expect(after.indexOf(STUDY_HOLD)).toBeGreaterThan(after.indexOf(`ANSWERED ${HOLD_2M_KEY}`));
    // The refused price for the old notional was asked once (the generation's refetch) and never again.
    expect(after.filter((x) => x.startsWith("GET /api/desk/basket/price") && x.includes("notional=1000000"))).toHaveLength(1);
  });

  it("a study still computing when the generation changes polls again only after the new price answers (Codex S-4)", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = switchablePrice(log);
    // The study's first ask answers 202 computing (polled again after the default 2 s wait); later asks are served.
    let asked = 0;
    const study = (u: URL) => {
      asked += 1;
      if (asked === 1) return { status: 202, body: { status: "computing" } };
      return JSON.parse(deskFixture("GET", `${u.pathname}${u.search}`, undefined, "application/json")!.body) as unknown;
    };
    log.calls = stubDesk({ "/api/desk/basket/price": price.route, "/api/desk/basket/study": study }).calls;
    const { client } = renderTab();
    const c = await studyCard();
    await waitFor(() => expect(studies(log.calls)).toEqual([STUDY_HOLD]));
    // The generation changes while that study is computing: the price is asked again and held; the study's poll waits.
    price.st.mode = "hold";
    const before = log.calls.length;
    void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) !== "freshness" });
    await waitFor(() => expect(log.calls.slice(before).some((x) => x.startsWith("GET /api/desk/basket/price"))).toBe(true));
    await sleep(2600);
    expect(studies(log.calls.slice(before))).toEqual([]);
    price.release();
    await waitFor(() => expect(studies(log.calls.slice(before))).toEqual([STUDY_HOLD]), { timeout: 4000 });
    const after = log.calls.slice(before);
    expect(after.indexOf(STUDY_HOLD)).toBeGreaterThan(after.indexOf(`ANSWERED ${HOLD_KEY}`));
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
  }, 15_000);

  it("a study refetched on its own while the price is due asks the price first, once, and waits for it", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([HOLD]));
    const log = { calls: [] as string[] };
    const price = switchablePrice(log);
    log.calls = stubDesk({ "/api/desk/basket/price": price.route }).calls;
    const { client } = renderTab();
    const c = await studyCard();
    await waitFor(() => expect(c).toHaveAttribute("data-basket-study", "ready"));
    price.st.mode = "hold";
    const before = log.calls.length;
    // The price is marked due without being asked; then only the study is refetched.
    await client.invalidateQueries({ queryKey: ["desk-v2", "/basket/price"], refetchType: "none" });
    void client.invalidateQueries({ queryKey: ["desk-v2", "/basket/study"] });
    await waitFor(() => expect(log.calls.slice(before).filter((x) => x.startsWith("GET /api/desk/basket/price"))).toHaveLength(1));
    await sleep(300);
    expect(studies(log.calls.slice(before))).toEqual([]);
    price.release();
    await waitFor(() => expect(studies(log.calls.slice(before))).toEqual([STUDY_HOLD]));
    const after = log.calls.slice(before);
    expect(after.filter((x) => x.startsWith("GET /api/desk/basket/price"))).toHaveLength(1);
    expect(after.indexOf(STUDY_HOLD)).toBeGreaterThan(after.indexOf(`ANSWERED ${HOLD_KEY}`));
  });
});
