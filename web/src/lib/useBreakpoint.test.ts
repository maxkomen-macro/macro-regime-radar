/**
 * Phase 10 checklist (docs/redesign-v2/checklists/10-states-a11y.md) E.1,
 * `lib/useBreakpoint.test.ts`: the tier and `shellCompact` the hook reports at
 * 1672, 1280, 1024, 768 and 390, the 479.99 / 480 seam, the frozen snapshot
 * identity (STATES) and listener attach / detach (subscribe), all from a
 * matchMedia stub keyed by the exact query strings of useBreakpoint.ts.
 * The hook caches its MediaQueryLists in a module singleton (G16), so every
 * case resets the module registry and imports the hook afresh against its
 * own stub; the global jsdom stub (src/test/setup.ts) answers false to
 * everything and is never consulted here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/** The five query strings, verbatim from useBreakpoint.ts QUERIES and SHELL_COMPACT_QUERY. */
const QUERIES: Record<string, (w: number) => boolean> = {
  "(max-width: 479.98px)": (w) => w <= 479.98,
  "(min-width: 480px) and (max-width: 767.98px)": (w) => w >= 480 && w <= 767.98,
  "(min-width: 768px) and (max-width: 1023.98px)": (w) => w >= 768 && w <= 1023.98,
  "(min-width: 1024px)": (w) => w >= 1024,
  "(max-width: 859.98px)": (w) => w <= 859.98,
};

interface StubMql {
  media: string;
  readonly matches: boolean;
  listeners: Set<(e: Event) => void>;
  addEventListener: (type: string, l: (e: Event) => void) => void;
  removeEventListener: (type: string, l: (e: Event) => void) => void;
  addListener: (l: (e: Event) => void) => void;
  removeListener: (l: (e: Event) => void) => void;
  onchange: null;
  dispatchEvent: () => boolean;
}

interface Media {
  /** Every MediaQueryList the hook asked for, by query string. */
  created: Map<string, StubMql>;
  setWidth: (w: number) => void;
}

const original = window.matchMedia;

/** A matchMedia that answers from `width` through a getter, so a cached list
 * reads the current width on every measure; an unknown query throws so a
 * change to the hook's strings fails here first. */
function installMatchMedia(width: number): Media {
  const created = new Map<string, StubMql>();
  const state = { width };
  window.matchMedia = ((query: string): MediaQueryList => {
    const rule = QUERIES[query];
    if (!rule) throw new Error(`unexpected media query: ${query}`);
    const mql: StubMql = {
      media: query,
      get matches() {
        return rule(state.width);
      },
      listeners: new Set(),
      addEventListener(type, l) {
        if (type === "change") this.listeners.add(l);
      },
      removeEventListener(type, l) {
        if (type === "change") this.listeners.delete(l);
      },
      addListener(l) {
        this.listeners.add(l);
      },
      removeListener(l) {
        this.listeners.delete(l);
      },
      onchange: null,
      dispatchEvent: () => false,
    };
    created.set(query, mql);
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    created,
    setWidth(w) {
      state.width = w;
      created.forEach((m) => m.listeners.forEach((l) => l(new Event("change"))));
    },
  };
}

async function load(width: number) {
  vi.resetModules();
  const media = installMatchMedia(width);
  const mod = await import("./useBreakpoint");
  return { ...mod, media };
}

afterEach(() => {
  window.matchMedia = original;
});

describe("useBreakpoint (checklist 10 E.1)", () => {
  const CASES: [number, "mobile" | "tablet" | "desktop" | "wide", boolean][] = [
    [1672, "wide", false],
    [1280, "wide", false],
    [1024, "wide", false],
    [768, "desktop", true],
    [390, "mobile", true],
  ];
  for (const [width, bp, shellCompact] of CASES) {
    it(`${width}px reads ${bp} with shellCompact ${shellCompact}`, async () => {
      const { useBreakpoint } = await load(width);
      const { result } = renderHook(() => useBreakpoint());
      expect(result.current.bp).toBe(bp);
      expect(result.current.shellCompact).toBe(shellCompact);
      expect(result.current.isMobile).toBe(bp === "mobile");
      expect(result.current.isTablet).toBe(bp === "tablet");
      expect(result.current.isNarrow).toBe(bp === "mobile" || bp === "tablet");
    });
  }

  it("479.98 and 480 fall on opposite tiers (the fractional upper bounds); a width inside the 0.02 px gap reads the wide default", async () => {
    const below = await load(479.98);
    expect(renderHook(() => below.useBreakpoint()).result.current.bp).toBe("mobile");
    const at = await load(480);
    const r = renderHook(() => at.useBreakpoint()).result.current;
    expect(r.bp).toBe("tablet");
    expect(r.isNarrow).toBe(true);
    expect(r.shellCompact).toBe(true);
    // The queries bound the tiers at 479.98 and 480: a width strictly between
    // them (479.99, unreachable in Chromium, which snaps viewport widths to
    // 1/64 px) matches no tier and the hook keeps its documented "wide" home.
    const gap = await load(479.99);
    expect(renderHook(() => gap.useBreakpoint()).result.current).toMatchObject({ bp: "wide", shellCompact: true });
    // The shell seam sits between the tiers: 859.98 is compact, 860 is not, both desktop.
    const compact = await load(859.98);
    expect(renderHook(() => compact.useBreakpoint()).result.current).toMatchObject({ bp: "desktop", shellCompact: true });
    const wideShell = await load(860);
    expect(renderHook(() => wideShell.useBreakpoint()).result.current).toMatchObject({ bp: "desktop", shellCompact: false });
  });

  it("exports the shell seam query the CSS media query mirrors", async () => {
    const { SHELL_COMPACT_QUERY } = await load(1672);
    expect(SHELL_COMPACT_QUERY).toBe("(max-width: 859.98px)");
  });

  it("returns a frozen, referentially stable snapshot; a width change swaps to another frozen singleton and back", async () => {
    const { useBreakpoint, media } = await load(1672);
    const { result, rerender } = renderHook(() => useBreakpoint());
    const first = result.current;
    expect(Object.isFrozen(first)).toBe(true);
    rerender();
    expect(result.current).toBe(first);
    act(() => media.setWidth(390));
    const phone = result.current;
    expect(phone).not.toBe(first);
    expect(phone).toMatchObject({ bp: "mobile", shellCompact: true });
    expect(Object.isFrozen(phone)).toBe(true);
    act(() => media.setWidth(1672));
    expect(result.current).toBe(first);
    // The five lists were created once and reused (the module singleton).
    expect([...media.created.keys()].sort()).toEqual(Object.keys(QUERIES).sort());
  });

  it("attaches one change listener per list with the first consumer and detaches with the last", async () => {
    const { useBreakpoint, media } = await load(1672);
    const counts = () => [...media.created.values()].map((m) => m.listeners.size);
    const a = renderHook(() => useBreakpoint());
    expect(media.created.size).toBe(5);
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    const b = renderHook(() => useBreakpoint());
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    a.unmount();
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    b.unmount();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    // A new consumer re-attaches.
    const c = renderHook(() => useBreakpoint());
    expect(counts()).toEqual([1, 1, 1, 1, 1]);
    c.unmount();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
  });
});
