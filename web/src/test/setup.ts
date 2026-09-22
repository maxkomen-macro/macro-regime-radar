import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom lacks a few browser APIs the screens touch.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!window.scrollTo) window.scrollTo = (() => {}) as typeof window.scrollTo;

  // Node >= 22 puts a Web Storage `localStorage` getter on globalThis that
  // reads as undefined unless --localstorage-file is set, and vitest's jsdom
  // environment copies only the window keys the Node global lacks, so
  // jsdom's own storage never lands (Node 26.5 / vitest 2.1.9: `window ===
  // globalThis` and `window.localStorage === undefined`). Borrow a real jsdom
  // Storage from a throwaway window: same webidl implementation, so
  // StorageEvent's `storageArea` check accepts it and `vi.spyOn(Storage.
  // prototype, ...)` reaches the instance. Skipped wherever jsdom's own
  // storage is already present.
  if (typeof window.localStorage === "undefined") {
    // @ts-expect-error jsdom ships no type declarations (and @types/node is deliberately absent)
    const mod = await import("jsdom");
    const JSDOM = mod.JSDOM ?? mod.default?.JSDOM;
    if (JSDOM) {
      const w = new JSDOM("", { url: window.location.href }).window;
      for (const key of ["Storage", "localStorage", "sessionStorage"] as const) {
        Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true, enumerable: true });
      }
    }
  }
}

afterEach(() => cleanup());
