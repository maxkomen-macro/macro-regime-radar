/**
 * HeroChartFrame: the measured frame a TabHero signature chart draws in
 * (Iteration 1, R1 / M1 / T1). TabHero's right column is the chart slot
 * (`.mrr-hero-viz[data-chart-slot]`, a flex column that centres its child on
 * both axes); this frame fills the slot's width and, in the two-column hero,
 * its height, and hands the chart the box it may draw in, in CSS pixels. The
 * chart lays itself out at that size (a viewBox equal to its box, drawn 1:1,
 * so text keeps its set size at every width) instead of scaling a fixed
 * 400 px drawing that sat narrow and right-aligned in a wide column.
 *
 * Height, in three rules, so the aspect ratio stays sane at every width:
 *   - the frame's floor is the chart's own preferred height for its width
 *     (`minHeight(w)`): a stacked hero gives the chart exactly that;
 *   - a two-column hero stretched by its row can only add to the floor, and
 *     the drawing takes the extra up to `maxHeight(w)` (an aspect cap: a
 *     700 px column never yields a 700 px chart), centred in what is left;
 *   - the drawing is absolutely positioned inside the frame, so its height
 *     never feeds back into the slot it measured: the frame is sized by the
 *     width and the row alone, and a card that shrinks lets the chart shrink.
 *
 * Before the first measurement (and in jsdom, where nothing lays out) the
 * chart draws at its `fallback` box: the mockup geometry the unit tests pin.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The box a hero chart draws in, CSS pixels. */
export interface ChartBox {
  w: number;
  h: number;
}

export interface HeroChartFrameProps {
  /** The drawing before the frame is measured: the mockup geometry. */
  fallback: ChartBox;
  /** The chart's preferred height at a width; the frame never goes shorter. */
  minHeight: (w: number) => number;
  /** The tallest the drawing may grow at a width (the aspect cap). */
  maxHeight: (w: number) => number;
  /** Draws the chart at the box it is given. */
  children: (box: ChartBox) => ReactNode;
}

/** Narrower than this is a layout in flight (a collapsing ancestor, a
 * full-page capture resizing the viewport), never a column to draw in: the
 * last good box (or the fallback) stands. A hash navigation right after a
 * full-page capture measured an 8 px frame and drew negative rects. */
const MIN_MEASURED_W = 120;

/** Clamp for the size rules: `lo` wins when the bounds cross. */
export const clampPx = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(v, hi)));

export function HeroChartFrame({ fallback, minHeight, maxHeight, children }: HeroChartFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartBox | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      // jsdom (and a display:none ancestor) lays nothing out: keep the fallback.
      if (w < MIN_MEASURED_W) return;
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = size?.w ?? fallback.w;
  const floor = Math.round(minHeight(w));
  // The frame is never shorter than the floor, so this never outgrows it.
  const h = size ? clampPx(size.h, floor, Math.max(floor, maxHeight(w))) : fallback.h;

  return (
    <div
      ref={ref}
      className="mrr-chart-frame"
      style={{ position: "relative", alignSelf: "stretch", flex: "1 1 auto", width: "100%", minWidth: 0, minHeight: floor }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children({ w, h })}
      </div>
    </div>
  );
}

export default HeroChartFrame;
