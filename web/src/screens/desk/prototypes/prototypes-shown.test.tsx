/**
 * The PROTOTYPE cards on their pages (DESK_FRAME3_SPEC §1.0.3), with the registry drawing every card. The owner's
 * release decision of 2026-11-16 set every card's `shown` to false (rule 10), so the pages draw none; this file
 * keeps the suite that held them on their pages (moved from ./prototypes.test.tsx), run against a registry that
 * draws them, so a card that returns is held by the same checks: its footnote last, no badge, its values inside it
 * and nowhere else on its page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { SAVED_BASKETS_KEY } from "../basket/weights";
import { PROTOTYPE_LEAD } from "../kit/Prototype";
import { PROTOTYPES } from "./registry";
import { PROTOTYPE_MARKERS } from "./markers";

vi.mock("./registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./registry")>();
  const rows = real.PROTOTYPES.map((p) => ({ ...p, shown: true }));
  const prototype = (id: string) => {
    const e = rows.find((p) => p.id === id);
    if (!e) throw new Error(`no PROTOTYPE registry row for ${id}`);
    return e;
  };
  return { ...real, PROTOTYPES: rows, prototype, prototypeShown: (id: string) => prototype(id).shown, shownPrototypes: () => rows };
});

it("the mocked registry draws every card", () => {
  expect(PROTOTYPES.length).toBeGreaterThan(0);
  expect(PROTOTYPES.every((p) => p.shown)).toBe(true);
});

describe("§1.0.3: every PROTOTYPE card on its page, and no prototype value outside one", () => {
  const realFetch = globalThis.fetch;
  // A first visit: no basket store, so Basket & Hedge seeds the AI Infrastructure 10 preset the prototypes are drawn for.
  beforeEach(() => {
    stubDesk();
    localStorage.removeItem(SAVED_BASKETS_KEY);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.removeItem(SAVED_BASKETS_KEY);
  });

  // The pages that carry PROTOTYPE cards, and any page the registry adds.
  const pages = [...new Set(["technicals", "basket-hedge", "data-pipeline", ...PROTOTYPES.map((p) => p.page)])];
  const allMarkers = Object.values(PROTOTYPE_MARKERS).flat();

  for (const page of pages)
    it(`${page}: each card ends with its footnote, carries no badge and holds its values`, async () => {
      const { container } = renderWithProviders(
        <Routes>
          <Route path="/desk/:page?" element={<DeskShell />} />
        </Routes>,
        { route: `/desk/${page}` },
      );
      const here = PROTOTYPES.filter((p) => p.page === page);
      // A page renders from a lazy chunk: under a loaded machine its first heading can take longer than findBy's 1 s.
      await screen.findByRole("heading", { level: 1 }, { timeout: 8000 });
      await waitFor(() => expect(container.querySelectorAll("[data-prototype]")).toHaveLength(here.length), { timeout: 8000 });
      for (const p of here) {
        const card = container.querySelector(`[data-prototype="${p.id}"]`)!;
        expect(card, p.id).not.toBeNull();
        const foots = card.querySelectorAll("[data-prototype-foot]");
        expect(foots, p.id).toHaveLength(1);
        // The footnote is the card's last line: nothing follows it in document order.
        const all = card.querySelectorAll("*");
        expect(foots[0].contains(all[all.length - 1]), `${p.id}: footnote last`).toBe(true);
        expect(foots[0].textContent).toBe(`${PROTOTYPE_LEAD}${p.production}`);
        expect(card.querySelector('[data-testid="dk-live"]'), `${p.id}: no badge`).toBeNull();
        await waitFor(
          () => {
            for (const m of PROTOTYPE_MARKERS[p.id]) expect(card.textContent, `${p.id} prints ${m}`).toContain(m);
          },
          { timeout: 8000 },
        );
      }
      const outside = container.cloneNode(true) as HTMLElement;
      outside.querySelectorAll("[data-prototype]").forEach((n) => n.remove());
      const text = outside.textContent ?? "";
      expect(allMarkers.filter((m) => text.includes(m))).toEqual([]);
    }, 30_000);
});
