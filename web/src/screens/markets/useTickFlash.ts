/**
 * useTickFlash (redesign Phase 5, checklist 05 A.6): the 600 ms directional
 * wash a tape row shows when its price changes, lifted out of the old
 * `TapeRow` so a `DataTable` row can carry it through `rowProps`.
 *
 * The previous price per symbol lives in a ref. A changed price sets "up" or
 * "down" for FLASH_MS with one timeout per symbol (a second tick inside the
 * window restarts it, as the old per-row effect did); every timeout is
 * cleared on unmount; an unchanged price sets nothing, so the first snapshot
 * never flashes. Reduced motion is the CSS rule on `[style*="mrr-flash"]`
 * (app.css), not this hook's concern.
 */

import { useEffect, useRef, useState } from "react";
import type { LiveQuote } from "../../live/quotes";

export type FlashDir = "up" | "down";

/** Matches `--tick-flash` (tokens/motion.css). */
export const FLASH_MS = 600;

const NONE: ReadonlyMap<string, FlashDir> = new Map();

export function useTickFlash(quotes: ReadonlyMap<string, LiveQuote>): ReadonlyMap<string, FlashDir> {
  const prevRef = useRef(new Map<string, number>());
  const timersRef = useRef(new Map<string, number>());
  const [flash, setFlash] = useState<ReadonlyMap<string, FlashDir>>(NONE);

  useEffect(() => {
    const prev = prevRef.current;
    const changes: [string, FlashDir][] = [];
    quotes.forEach((q, symbol) => {
      const p = q.p;
      if (!Number.isFinite(p)) return;
      const was = prev.get(symbol);
      prev.set(symbol, p);
      if (was != null && p !== was) changes.push([symbol, p > was ? "up" : "down"]);
    });
    if (!changes.length) return;

    setFlash((cur) => {
      const next = new Map(cur);
      for (const [symbol, dir] of changes) next.set(symbol, dir);
      return next;
    });

    const timers = timersRef.current;
    for (const [symbol] of changes) {
      const pending = timers.get(symbol);
      if (pending != null) window.clearTimeout(pending);
      timers.set(
        symbol,
        window.setTimeout(() => {
          timers.delete(symbol);
          setFlash((cur) => {
            if (!cur.has(symbol)) return cur;
            const next = new Map(cur);
            next.delete(symbol);
            return next;
          });
        }, FLASH_MS),
      );
    }
  }, [quotes]);

  // Unmount: no timeout may fire into a dead component.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  return flash;
}
