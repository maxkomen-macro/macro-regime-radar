/**
 * The column ladder (Iteration 2 F2, shared in fix/prelaunch-1 J5): a wide
 * table reads the width its well actually has and drops its least important
 * columns in a stated order, rather than half-rendering a number or scrolling
 * inside its panel, and the panel names what it dropped. The macro tape
 * (Markets) and the LBO debt schedule (Tools) use it.
 *
 * A viewport tier cannot answer when a column set fits: the tape's panel is
 * 724px wide at a 1024 viewport but 605px at 900, where the sidebar is still
 * present, and the schedule's well is narrower at 1280 than at 1024. So the
 * table measures its own well.
 */
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { metaStyle } from "./screen-ui";

/**
 * The content width of an element, in CSS pixels; 0 until first measured.
 * Returns a callback ref, so an element that appears after mount (a table
 * that waits for its data) is measured too, and it measures before paint, so
 * a reduced table never flashes in at full width first.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => setW((prev) => (Math.abs(prev - el.clientWidth) < 1 ? prev : el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

/**
 * The columns that fit `width`, dropping from `dropOrder` (least important
 * first) until the rest fit by their minimum widths; a column not in
 * `dropOrder` never drops, so a table can still be wider than a phone's well,
 * where ScrollTable's swipe affordance takes over.
 *
 * `minW` is each column's settled width once the table is compressed as far
 * as its content allows. The ladder never re-measures after a drop, so the
 * choice cannot oscillate under a ResizeObserver. Width 0 is "not measured
 * yet": keep everything and let the first measurement decide.
 */
export function fitColumns<C extends { key: string }>(
  cols: C[],
  width: number,
  minW: Record<string, number>,
  dropOrder: readonly string[],
  fallbackMin = 80,
): { cols: C[]; dropped: C[] } {
  const total = (cs: C[]) => cs.reduce((n, c) => n + (minW[c.key] ?? fallbackMin), 0);
  let kept = cols;
  const dropped: C[] = [];
  for (const key of dropOrder) {
    if (!width || total(kept) <= width) break;
    const hit = kept.find((c) => c.key === key);
    if (!hit) continue;
    kept = kept.filter((c) => c !== hit);
    dropped.push(hit);
  }
  return { cols: kept, dropped };
}

/** The visible affordance: which columns this width cannot show, and how to
 * get them back. Null when nothing is hidden. */
export function hiddenColumnsNote(labels: readonly string[]): string | null {
  const names = [...new Set(labels)];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} hidden at this width · widen the window to read ${names.length === 1 ? "it" : "them"}`;
}

/** The note as the tape shows it, above the table it describes. */
export function HiddenColumnsNote({ labels, testId, style }: { labels: readonly string[]; testId: string; style?: CSSProperties }) {
  const note = hiddenColumnsNote(labels);
  return note ? (
    <div data-testid={testId} style={{ ...metaStyle, margin: "0 0 8px", ...style }}>
      {note}
    </div>
  ) : null;
}
