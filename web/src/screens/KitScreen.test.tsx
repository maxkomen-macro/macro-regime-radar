/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/KitScreen.test.tsx`: the /kit smoke test. Every section id in
 * `kit-manifest.ts` mounts exactly once (`[data-kit]`), every variant name
 * renders (`[data-kit-variant]`), the route has exactly one h1 (risk G17: the
 * first TabHero is the h1, the page title is a styled paragraph), nothing is
 * logged to console.error / console.warn, and the file imports no data hook
 * (section D rules; the hook-coverage corpus includes this file, risk G16).
 *
 * Timers are faked so the legacy TickerStrip's drifting demo quotes and its
 * tick flash never fire mid-test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import KitScreen from "./KitScreen";
import { KIT_SECTIONS, KIT_VARIANTS } from "./kit-manifest";
import { renderWithProviders } from "../test/utils";

const sources = import.meta.glob<string>("/src/screens/*.tsx", { query: "?raw", import: "default", eager: true });

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mount = () => renderWithProviders(<KitScreen />, { route: "/kit" });

describe("KitScreen (checklist 02 section D / E)", () => {
  it("mounts every section in KIT_SECTIONS (one [data-kit] per id)", () => {
    mount();
    const ids = KIT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
    const roots = [...document.querySelectorAll("[data-kit]")];
    const found = roots.map((r) => r.getAttribute("data-kit"));
    expect(found).toEqual(ids); // manifest order, each exactly once
    for (const root of roots) {
      expect(root.tagName).toBe("SECTION");
      const labelledBy = root.getAttribute("aria-labelledby");
      expect(labelledBy, `section ${root.getAttribute("data-kit")} has aria-labelledby`).toBeTruthy();
      const heading = document.getElementById(labelledBy as string);
      expect(heading?.tagName, `section ${root.getAttribute("data-kit")} is labelled by an h2`).toBe("H2");
    }
  });

  it("renders every variant name ([data-kit-variant] set equals the manifest)", () => {
    mount();
    expect(KIT_VARIANTS).toHaveLength(85);
    expect(new Set(KIT_VARIANTS).size).toBe(85);
    for (const name of KIT_VARIANTS) expect(name, name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const rendered = [...document.querySelectorAll("[data-kit-variant]")].map((el) => el.getAttribute("data-kit-variant") as string);
    expect(new Set(rendered)).toEqual(new Set(KIT_VARIANTS));
    expect(rendered).toHaveLength(KIT_VARIANTS.length); // each wrapper once
    // Every variant wrapper sits inside its own section.
    for (const section of KIT_SECTIONS) {
      const root = document.querySelector(`[data-kit="${section.id}"]`) as HTMLElement;
      for (const name of section.variants) {
        const wrapper = document.querySelector(`[data-kit-variant="${name}"]`) as HTMLElement;
        expect(root.contains(wrapper), `${name} inside ${section.id}`).toBe(true);
        expect(wrapper.childElementCount, `${name} renders something`).toBeGreaterThan(0);
      }
    }
  });

  it("renders exactly one h1", () => {
    mount();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    // The route's h1 is the first TabHero specimen, not the page title.
    const hero = document.querySelector('[data-kit-variant="hero-regime-mint"]') as HTMLElement;
    expect(hero.contains(h1s[0])).toBe(true);
    expect(h1s[0].getAttribute("style") ?? "").toMatch(/var\(--font-display\)/);
    expect(screen.getByText("Component Kit").tagName).not.toBe("H1");
  });

  it("logs no console.error or console.warn (spy)", () => {
    mount();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("imports no hook (the file source contains no use[A-Z] import from api/queries or live/quotes, read via import.meta.glob raw like hook-coverage.test.ts)", () => {
    const src = sources["/src/screens/KitScreen.tsx"];
    expect(src, "KitScreen.tsx found in the raw glob").toBeTruthy();
    const imports = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `import from ${spec}`).not.toMatch(/api\/queries|live\/quotes/);
    }
    expect(src).not.toMatch(/import\s*\{[^}]*\buse[A-Z]\w*[^}]*\}\s*from\s*["'][^"']*(?:api\/queries|live\/quotes)["']/s);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/from\s+["'][^"']*api\/client["']/);
  });
});
