import { describe, expect, it, vi } from "vitest";
import { installStaleChunkReload } from "./stale-chunks";

function fakeWindow() {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const store = new Map<string, string>();
  const reload = vi.fn();
  const win = {
    addEventListener: (type: string, fn: (e: Event) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: { reload },
  };
  const fire = () => {
    const e = new Event("vite:preloadError", { cancelable: true });
    for (const fn of listeners["vite:preloadError"] ?? []) fn(e);
    return e;
  };
  return { win, fire, reload };
}

describe("installStaleChunkReload (launch-1, item 3)", () => {
  it("reloads once when a code-split chunk from an older deploy is gone", () => {
    const { win, fire, reload } = fakeWindow();
    let now = 1_000_000;
    installStaleChunkReload(win as unknown as Window, () => now);
    const e = fire();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    now += 5_000;
    fire(); // the new deploy is broken too: do not loop
    expect(reload).toHaveBeenCalledTimes(1);
    now += 120_000;
    fire(); // a later deploy, minutes on
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads, and never throws, when storage is unavailable", () => {
    // Nothing could remember the reload, so a chunk gone for good would loop.
    const { win, fire, reload } = fakeWindow();
    win.sessionStorage.getItem = () => {
      throw new Error("blocked");
    };
    installStaleChunkReload(win as unknown as Window, () => 1_000_000);
    expect(() => fire()).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
