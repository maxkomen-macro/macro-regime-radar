/**
 * Desk v2 browser tests read the §12 fixtures, never a live API: every
 * /api/* request the page makes is answered here, /api/desk/* by the same
 * resolver the fixture dev server and the unit tests use
 * (src/fixtures/desk), anything else with a 503 so no other data surface
 * leaks into a Desk assertion. `over` replaces one /api/desk path.
 *
 * Also the in-page audits the Desk specs share: the §1.3 palette over every
 * rendered element's computed colors, and the banned words over the page text.
 */
import type { Page } from "@playwright/test";
import { deskFixture } from "../../src/fixtures/desk/index";
import { paletteRgb } from "../../src/screens/desk/kit/palette";

export type Override = { status: number; body: unknown };

export async function routeDesk(page: Page, over: Record<string, Override> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}${url.search}`);
    const o = over[url.pathname];
    if (o) return route.fulfill({ status: o.status, contentType: "application/json", body: JSON.stringify(o.body) });
    const reply = deskFixture(req.method(), `${url.pathname}${url.search}`, req.postData() ?? undefined, req.headers()["accept"] ?? "");
    if (reply) return route.fulfill({ status: reply.status, contentType: reply.contentType, body: reply.body });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "not served in the Desk browser tests" }) });
  });
  return calls;
}

export interface ColorOffender {
  el: string;
  prop: string;
  value: string;
}

/** Every visible element under the Desk root: its text, background, visible
 * border, SVG fill and stroke colors must be palette colors (rgba may tint
 * one; fully transparent is nothing). Runs in the page. */
export async function auditPalette(page: Page): Promise<ColorOffender[]> {
  const ok = [...paletteRgb()];
  return page.evaluate((okList) => {
    const okSet = new Set(okList);
    const out: { el: string; prop: string; value: string }[] = [];
    const parse = (v: string): { rgb: string; a: number } | null => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(v);
      if (!m) return null;
      return { rgb: `${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])}`, a: m[4] === undefined ? 1 : +m[4] };
    };
    const root = document.querySelector(".dk");
    if (!root) return [{ el: "document", prop: "root", value: "no .dk root" }];
    for (const el of Array.from(root.querySelectorAll<HTMLElement | SVGElement>("*"))) {
      if (el.closest(".mrr-skip")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const props: [string, string][] = [["color", cs.color], ["background-color", cs.backgroundColor]];
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        if (parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none") props.push([`border-${side.toLowerCase()}-color`, cs.getPropertyValue(`border-${side.toLowerCase()}-color`)]);
      }
      if (el instanceof SVGElement) {
        props.push(["fill", cs.fill], ["stroke", cs.stroke]);
      }
      for (const [prop, value] of props) {
        if (!value || value === "none" || value.startsWith("url(")) continue;
        const c = parse(value);
        if (!c) continue;
        if (c.a === 0) continue;
        if (!okSet.has(c.rgb)) out.push({ el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ")[0]}`, prop, value });
      }
      if (out.length > 30) break;
    }
    return out;
  }, ok);
}

/** Frame-3's two words (§1.5) and frame-2's ban list, over the rendered text. */
export async function bannedWordsOnPage(page: Page): Promise<string[]> {
  // The gate's own list of the words it blocks (§9) is the one place they are printed; the
  // Snowflake bridge's schema quotes the board (§11): its two lines "-- RAW: … never edited"
  // and "-- MART: … never patched." are left out, and nothing else in the block.
  const text = await page.evaluate(() => {
    const root = document.querySelector(".dk")?.cloneNode(true) as HTMLElement | undefined;
    root?.querySelectorAll("[data-gate-words], textarea, input").forEach((n) => n.remove());
    const board = [/^-- RAW: exact copy of source, never edited$/, /^-- MART: what Desk reads\. Rebuilt, never patched\.$/];
    root?.querySelectorAll("[data-board-copy]").forEach((n) => {
      n.textContent = (n.textContent ?? "")
        .split("\n")
        .filter((l) => !board.some((r) => r.test(l.trim())))
        .join("\n");
    });
    return root?.textContent ?? "";
  });
  return [...text.matchAll(/\b(established|significant|will|predicts|proves|guaranteed|always|never|obviously)\b/gi)].map((m) => m[0]);
}
