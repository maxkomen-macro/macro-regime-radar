/**
 * The pixel width a chart's container has, so an inline SVG draws at 1:1 and
 * its 10px axis labels stay 10px at any width (DESIGN.md's chart idiom). A
 * ResizeObserver follows the container; without one (jsdom, old engines) the
 * fallback width is used. Clamped so a very wide card never stretches bars.
 */

import { useEffect, useRef, useState } from "react";

export function useChartWidth<T extends HTMLElement>(fallback: number, min = 300, max = 1400) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(Math.round(Math.min(max, Math.max(min, w))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, max]);
  return [ref, width] as const;
}
