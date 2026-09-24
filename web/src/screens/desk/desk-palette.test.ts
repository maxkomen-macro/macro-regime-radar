/**
 * DESK_FRAME3_SPEC §1.3: five accents with one job each, the listed neutrals
 * and the verdict pill tints, no purple, no other color. Every color literal
 * in the v2 stylesheets (styles/desk2.css and each tab's CSS under
 * screens/desk/) and in the v2 TSX must be one of them; rgba() may tint an
 * allowed color, never introduce a new one. The v1 stylesheet (desk.css)
 * serves only the frame-2 pieces reused under Event Study's Advanced, which
 * the v2 scope re-tokens; it is not scanned here.
 */
import { describe, expect, it } from "vitest";
import { DESK_PALETTE, paletteRgb } from "./kit/palette";

const ALLOWED = new Set<string>([...DESK_PALETTE, "#fff"]);
const RGB_OK = paletteRgb();

const CSS = import.meta.glob<string>(["/src/styles/desk2.css", "/src/screens/desk/**/*.css"], { query: "?raw", import: "default", eager: true });
const TSX = import.meta.glob<string>(["/src/screens/desk/{kit,data,overview,technicals,event-study,regime,macro,sectors,ledger,positions,pipeline,notes,client}/**/*.tsx", "/src/screens/desk/*.tsx"], { query: "?raw", import: "default", eager: true });

/** Every hex or rgb()/rgba() color in a text, comments stripped. */
export function colorsIn(text: string): string[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const hex = [...clean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  const rgb = [...clean.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map((m) => `rgb(${m[1]},${m[2]},${m[3]})`);
  return [...hex, ...rgb];
}

export function allowed(c: string): boolean {
  if (c.startsWith("rgb(")) return RGB_OK.has(c.slice(4, -1));
  return ALLOWED.has(c);
}

describe("Desk v2 palette (§1.3)", () => {
  it("scans the v2 stylesheets", () => {
    expect(Object.keys(CSS)).toEqual(expect.arrayContaining(["/src/styles/desk2.css", "/src/screens/desk/overview/overview.css"]));
  });

  it("uses no color outside the five accents, the neutrals and the pill tints", () => {
    const bad: string[] = [];
    for (const [f, text] of [...Object.entries(CSS), ...Object.entries(TSX)]) for (const c of colorsIn(text)) if (!allowed(c)) bad.push(`${f}: ${c}`);
    expect(bad).toEqual([]);
  });

  it("the scanner reads hex and rgb, and knows a stray purple", () => {
    expect(colorsIn("a{color:#8B5CF6;background:rgba(38, 220, 160, .1)} /* #123456 */")).toEqual(["#8b5cf6", "rgb(38,220,160)"]);
    expect(allowed("#8b5cf6")).toBe(false);
    expect(allowed("rgb(38,220,160)")).toBe(true);
  });
});
