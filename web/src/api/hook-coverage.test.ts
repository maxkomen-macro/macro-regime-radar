/**
 * Parity guarantee #1 (docs/redesign-v2/PARITY_MANIFEST.md): every exported
 * hook in api/queries.ts and live/quotes.ts is used by at least one screen
 * or shell module. A hook losing its last consumer fails the suite, so no
 * data surface can silently disappear during the redesign. The three hooks
 * the manifest records as unused today are allow-listed; if one of them gains
 * a consumer, remove it from the list (the second test enforces that).
 *
 * Sources are read through Vite's import.meta.glob (raw, eager) so the test
 * needs no Node typings in the src tsconfig.
 */
import { describe, expect, it } from "vitest";

const HOOK_FILES = ["/src/api/queries.ts", "/src/live/quotes.ts"];
const KNOWN_UNUSED = ["useCorporateActions", "useProvidersStatus", "useStreamDebug"];

const sources = import.meta.glob<string>("/src/**/*.{ts,tsx,jsx}", { query: "?raw", import: "default", eager: true });

function exportedHooks(src: string): string[] {
  return [...src.matchAll(/^export (?:function|const) (use[A-Z]\w*)/gm)].map((m) => m[1]);
}

const hookSources = HOOK_FILES.map((f) => {
  const src = sources[f];
  if (src == null) throw new Error(`hook module not found in glob: ${f}`);
  return src;
});
const hooks = hookSources.flatMap(exportedHooks);
const corpus = Object.entries(sources)
  .filter(([p]) => !HOOK_FILES.includes(p) && !/\.test\.|\.d\.ts$/.test(p))
  .map(([, src]) => src)
  .join("\n");
const consumed = (h: string) => new RegExp(`\\b${h}\\b`).test(corpus);

describe("hook coverage", () => {
  it("finds the hook modules", () => {
    expect(hooks.length).toBeGreaterThan(30);
  });
  it("every exported hook outside the allow-list has a consumer", () => {
    const orphans = hooks.filter((h) => !KNOWN_UNUSED.includes(h) && !consumed(h));
    expect(orphans, `hooks with no consumer: ${orphans.join(", ")}`).toEqual([]);
  });
  it("the allow-list only names hooks that are really unused", () => {
    const stale = KNOWN_UNUSED.filter((h) => !hooks.includes(h) || consumed(h));
    expect(stale, `remove from KNOWN_UNUSED: ${stale.join(", ")}`).toEqual([]);
  });
});
