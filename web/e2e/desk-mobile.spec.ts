/**
 * The Desk at a phone's width (fix/site-audit, mobile check M1): every Desk
 * page at 390 px keeps to the viewport, and the Regime page's "last five
 * regime changes" rows hold their own text. Those rows were a fixed 29 px:
 * at 390 px the change ("Goldilocks → Overheating · from Aug data") wraps to
 * two or three lines and ran over the next row. Every request is answered
 * from the §12 fixtures (e2e/lib/desk-fixtures.ts).
 *
 * Run against a dev server: E2E_BASE_URL=http://127.0.0.1:5174 npx playwright test e2e/desk-mobile.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { settle } from "./lib/drive";
import { routeDesk } from "./lib/desk-fixtures";
import { DESK_PAGES } from "../src/screens/desk/desk-sections";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function open(page: Page, route: string): Promise<void> {
  await routeDesk(page);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 500);
}

test.describe("Desk at 390 px", () => {
  test("M1: each regime-change row holds its own text and no two rows overlap", async ({ page }) => {
    await open(page, "/desk/regime");
    const rows = page.locator("ul.rg-changes > li");
    await expect(rows.first()).toBeVisible();
    const boxes = await rows.evaluateAll((lis) =>
      lis.map((li) => {
        const r = li.getBoundingClientRect();
        const kids = [...li.children].map((c) => c.getBoundingClientRect());
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          kidsTop: Math.min(...kids.map((k) => k.top)),
          kidsBottom: Math.max(...kids.map((k) => k.bottom)),
          kidsRight: Math.max(...kids.map((k) => k.right)),
        };
      }),
    );
    expect(boxes.length).toBeGreaterThan(1);
    for (const [i, b] of boxes.entries()) {
      expect(b.kidsTop, `row ${i}: text starts above its row`).toBeGreaterThanOrEqual(b.top - 0.5);
      expect(b.kidsBottom, `row ${i}: text runs below its row`).toBeLessThanOrEqual(b.bottom + 0.5);
      expect(b.kidsRight, `row ${i}: text runs past its row`).toBeLessThanOrEqual(b.right + 0.5);
      if (i > 0) expect(b.top, `row ${i} starts inside row ${i - 1}`).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
    }
  });

  for (const p of DESK_PAGES) {
    test(`no page scrolls sideways: /desk/${p.slug}`, async ({ page }) => {
      await open(page, `/desk/${p.slug}`);
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
      expect(scroll, `/desk/${p.slug} is ${scroll} px wide at ${width} px`).toBeLessThanOrEqual(width);
    });
  }
});
