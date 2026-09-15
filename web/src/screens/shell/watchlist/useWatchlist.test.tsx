/**
 * Phase 1 checklist F.2 / F.11 cases 13-18: the useWatchlist hook
 * (web/src/screens/shell/watchlist/useWatchlist.ts). renderHook against
 * jsdom's localStorage; fake timers for the 6 s undo expiry; a StorageEvent
 * for the cross-tab sync; a throwing setItem for the unavailable path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useWatchlist from "./useWatchlist";
import { DEFAULT_SYMBOLS, UNDO_MS, WATCHLIST_KEY } from "./storage";

const ISO = "2026-09-01T00:00:00.000Z";
const file = (symbols: string[]) => JSON.stringify({ version: 1, symbols: symbols.map((symbol) => ({ symbol, addedAt: ISO })) });
const stored = (): string[] => {
  const raw = window.localStorage.getItem(WATCHLIST_KEY);
  if (raw == null) throw new Error(`nothing stored under ${WATCHLIST_KEY}`);
  const parsed = JSON.parse(raw) as { version: number; symbols: { symbol: string }[] };
  expect(parsed.version).toBe(1);
  return parsed.symbols.map((s) => s.symbol);
};
const symbols = (r: { current: ReturnType<typeof useWatchlist> }) => r.current.entries.map((e) => e.symbol);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useWatchlist", () => {
  it("persistence round trip: add AMD, unmount, remount, AMD is still there", () => {
    const first = renderHook(() => useWatchlist());
    expect(symbols(first.result)).toEqual(DEFAULT_SYMBOLS);
    expect(first.result.current.unsaved).toBe(false);
    expect(first.result.current.pendingUndo).toBeNull();

    let status: string | undefined;
    act(() => {
      status = first.result.current.add("amd");
    });
    expect(status).toBe("added");
    expect(symbols(first.result)).toEqual([...DEFAULT_SYMBOLS, "AMD"]);
    expect(stored()).toEqual([...DEFAULT_SYMBOLS, "AMD"]);

    // Reorder and restore write through as well.
    act(() => {
      first.result.current.move("AMD", -1);
    });
    expect(symbols(first.result)).toEqual(["SPY", "QQQ", "IWM", "AMD", "EEM"]);
    expect(stored()).toEqual(["SPY", "QQQ", "IWM", "AMD", "EEM"]);
    first.unmount();

    const second = renderHook(() => useWatchlist());
    expect(symbols(second.result)).toEqual(["SPY", "QQQ", "IWM", "AMD", "EEM"]);
    act(() => {
      second.result.current.restoreDefaults();
    });
    expect(symbols(second.result)).toEqual(DEFAULT_SYMBOLS);
    expect(stored()).toEqual(DEFAULT_SYMBOLS);
  });

  it("corrupt storage is rewritten with the defaults on load", () => {
    window.localStorage.setItem(WATCHLIST_KEY, "{oops");
    const { result } = renderHook(() => useWatchlist());
    expect(symbols(result)).toEqual(DEFAULT_SYMBOLS);
    expect(stored()).toEqual(DEFAULT_SYMBOLS);
    expect(result.current.unsaved).toBe(false);
  });

  it("remove then undo restores the symbol at its original index", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => {
      result.current.remove("QQQ");
    });
    expect(symbols(result)).toEqual(["SPY", "IWM", "EEM"]);
    expect(stored()).toEqual(["SPY", "IWM", "EEM"]);
    expect(result.current.pendingUndo?.entry.symbol).toBe("QQQ");
    expect(result.current.pendingUndo?.index).toBe(1);

    act(() => {
      result.current.undo();
    });
    expect(symbols(result)).toEqual(DEFAULT_SYMBOLS);
    expect(stored()).toEqual(DEFAULT_SYMBOLS);
    expect(result.current.pendingUndo).toBeNull();

    // A removal from the end goes back to the end; dismiss drops the buffer without restoring.
    act(() => {
      result.current.remove("EEM");
    });
    expect(result.current.pendingUndo?.index).toBe(3);
    act(() => {
      result.current.dismissUndo();
    });
    expect(result.current.pendingUndo).toBeNull();
    expect(symbols(result)).toEqual(["SPY", "QQQ", "IWM"]);
  });

  it("undo expires after 6 s", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWatchlist());
    act(() => {
      result.current.remove("IWM");
    });
    expect(result.current.pendingUndo?.entry.symbol).toBe("IWM");

    act(() => {
      vi.advanceTimersByTime(UNDO_MS - 1);
    });
    expect(result.current.pendingUndo?.entry.symbol).toBe("IWM");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pendingUndo).toBeNull();
    expect(symbols(result)).toEqual(["SPY", "QQQ", "EEM"]);
    expect(stored()).toEqual(["SPY", "QQQ", "EEM"]);

    // A second removal replaces the first buffer and restarts the clock.
    act(() => {
      result.current.remove("SPY");
    });
    act(() => {
      vi.advanceTimersByTime(UNDO_MS / 2);
    });
    act(() => {
      result.current.remove("QQQ");
    });
    expect(result.current.pendingUndo?.entry.symbol).toBe("QQQ");
    act(() => {
      vi.advanceTimersByTime(UNDO_MS / 2);
    });
    expect(result.current.pendingUndo?.entry.symbol).toBe("QQQ"); // the old timer must not clear the new buffer
    act(() => {
      vi.advanceTimersByTime(UNDO_MS / 2);
    });
    expect(result.current.pendingUndo).toBeNull();
    expect(symbols(result)).toEqual(["EEM"]);
  });

  it("a storage event for the key replaces the list; other keys are ignored", () => {
    const { result } = renderHook(() => useWatchlist());
    expect(symbols(result)).toEqual(DEFAULT_SYMBOLS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: file(["AMD", "NVDA"]), storageArea: window.localStorage }));
    });
    expect(symbols(result)).toEqual(["AMD", "NVDA"]);
    expect(setItem).not.toHaveBeenCalled(); // no echo: the other tab already wrote it

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "mrr:snapshot:v1", newValue: file(["ZZZ"]), storageArea: window.localStorage }));
    });
    expect(symbols(result)).toEqual(["AMD", "NVDA"]);

    // The other tab cleared the key: back to the defaults, still without a write.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: null, storageArea: window.localStorage }));
    });
    expect(symbols(result)).toEqual(DEFAULT_SYMBOLS);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("storage unavailable: the list works in memory and unsaved is true", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.unsaved).toBe(true);
    expect(symbols(result)).toEqual(DEFAULT_SYMBOLS);

    let status: string | undefined;
    act(() => {
      status = result.current.add("AMD");
    });
    expect(status).toBe("added");
    expect(symbols(result)).toEqual([...DEFAULT_SYMBOLS, "AMD"]);

    act(() => {
      result.current.remove("SPY");
    });
    expect(symbols(result)).toEqual(["QQQ", "IWM", "EEM", "AMD"]);
    act(() => {
      result.current.undo();
    });
    expect(symbols(result)).toEqual([...DEFAULT_SYMBOLS, "AMD"]);
    expect(window.localStorage.getItem(WATCHLIST_KEY)).toBeNull();
  });
});
