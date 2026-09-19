/**
 * Quote card (redesign Phase 1, spec §2): one 54 px strip card with the
 * symbol, the price, the 1D change and an 80×26 sparkline. A delayed or
 * stored read carries a small mono tag (15M, CLOSE, 1W) so the reader is
 * never told a stored close is the tape. The card flashes for 600 ms when the
 * price ticks (the TickerStrip idiom), silenced under reduced motion by the
 * `[style*="mrr-flash"]` rule in app.css.
 *
 * Iteration 1 (S2): the card is the first user of the fixed-slot quote tile.
 * Five slots, always present and always in this order (`data-slot` symbol,
 * value, change, tag, spark) on one grid (`.mrr-qslots` in app.css), so every
 * strip card is the same height at every width: a feed with no day change
 * prints "—" in the change slot and keeps its tag (LAST, 15M) in the tag
 * slot, and a missing sparkline leaves an aria-hidden placeholder of the
 * same box. `QuoteSlots` is exported for the Dashboard's glance tiles.
 *
 * Iteration 1 (D2): the glance tiles use the same five slots with three
 * options: `name` rides in the symbol slot under the symbol, `sparkFill`
 * draws the sparkline across its slot's measured width (the tile gives the
 * spark its own row), and `sparkNote` replaces the placeholder with a note
 * (a live-only symbol has no stored history to draw). Every sparkline carries
 * `data-sparkline`, so the G3 chart sweep never mistakes one for a chart.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Sparkline } from "../../components";

export interface QuoteTag {
  text: string;
  title?: string;
  /** amber for delayed or stored reads, muted for timeframe notes. */
  tone?: "amber" | "muted";
}

export interface QuoteCardProps {
  /** Rendered uppercase; the harvester records it as an eyebrow. */
  symbol: string;
  /** Formatted price, or "—" only when no price exists anywhere. */
  price: string;
  /** Numeric price for the tick flash. */
  raw?: number;
  change?: string;
  /** Direction, not valence: green is up, red is down, for yields too. */
  changeTone?: "pos" | "neg";
  tag?: QuoteTag;
  /** Oldest to newest; fewer than two points renders the placeholder. */
  series?: number[];
  title?: string;
}

/** The five slots of the fixed-slot quote tile, in DOM order. */
export const QUOTE_SLOTS = ["symbol", "value", "change", "tag", "spark"] as const;
export type QuoteSlot = (typeof QUOTE_SLOTS)[number];

/** What the change slot prints when the feed sends no day change. */
export const NO_CHANGE = "—";

/** The strip's sparkline box; the placeholder takes the same size. */
export const SPARK_W = 80;
export const SPARK_H = 26;

const TONE_COLOR = {
  pos: "var(--pos, #28d17c)",
  neg: "var(--neg, #f0503f)",
  flat: "var(--text-3, var(--text-muted))",
} as const;

/** Direction colour for a change tone; muted when there is none. */
export function quoteToneColor(tone: QuoteCardProps["changeTone"]): string {
  return tone ? TONE_COLOR[tone] : TONE_COLOR.flat;
}

export interface QuoteSlotsProps extends Omit<QuoteCardProps, "raw" | "title"> {
  sparkWidth?: number;
  sparkHeight?: number;
  /** A second line in the symbol slot (the glance tile's instrument name). */
  name?: ReactNode;
  /** Draw the sparkline across the spark slot's measured width; `sparkWidth`
   * is then the width before the first measurement (and jsdom's). */
  sparkFill?: boolean;
  /** The mockup's fading area under the line (glance tiles). */
  sparkGradient?: boolean;
  /** Printed in the spark slot, in place of the placeholder, when there is
   * no series to draw. */
  sparkNote?: ReactNode;
}

/** A sparkline as wide as its slot, re-measured on resize (glance tiles). */
function FillSparkline({ values, fallback, height, color, gradient }: { values: number[]; fallback: number; height: number; color: string; gradient?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span ref={ref} className="mrr-spark-fill" style={{ display: "block", width: "100%", height }}>
      <Sparkline data-sparkline="" values={values} width={width || fallback} height={height} color={color} gradient={gradient} />
    </span>
  );
}

/**
 * The five slot elements, for a container carrying `.mrr-qslots` (the grid
 * that places them). Every slot renders whatever the read lacks, so tiles in
 * a row never differ in shape.
 */
export function QuoteSlots({
  symbol,
  price,
  change,
  changeTone,
  tag,
  series,
  sparkWidth = SPARK_W,
  sparkHeight = SPARK_H,
  name,
  sparkFill = false,
  sparkGradient = false,
  sparkNote,
}: QuoteSlotsProps) {
  const color = quoteToneColor(changeTone);
  // An empty string is a missing change too: the slot never reads blank.
  const hasChange = typeof change === "string" && change.trim() !== "";
  const hasSpark = (series?.length ?? 0) >= 2;
  return (
    <>
      {/* The inner span is load-bearing: the label-parity harvester reads
          uppercase eyebrows from span/div/p/small/dd/td, never from <b>, and
          text-transform inherits, so the span is what keeps SPY / QQQ / US 10Y
          in the baseline set. */}
      <b data-slot="symbol">
        <span>{symbol}</span>
        {name != null ? <span className="n">{name}</span> : null}
      </b>
      <span className="v" data-slot="value">
        {price}
      </span>
      <span
        className="c"
        data-slot="change"
        data-empty={hasChange ? undefined : "true"}
        style={hasChange ? { color } : undefined}
        title={hasChange ? undefined : "No day change from this feed"}
      >
        {hasChange ? change : NO_CHANGE}
      </span>
      <span className="t" data-slot="tag">
        {tag ? (
          <span className="mrr-tag" data-tone={tag.tone ?? "amber"} title={tag.title}>
            {tag.text}
          </span>
        ) : null}
      </span>
      {/* Decorative: the numbers sit in the slots beside it. A note is words,
          so a slot carrying one is read out. */}
      <span className="k" data-slot="spark" aria-hidden={hasSpark || sparkNote == null ? "true" : undefined}>
        {hasSpark ? (
          sparkFill ? (
            <FillSparkline values={series ?? []} fallback={sparkWidth} height={sparkHeight} color={color} gradient={sparkGradient} />
          ) : (
            <Sparkline data-sparkline="" values={series ?? []} width={sparkWidth} height={sparkHeight} color={color} gradient={sparkGradient} />
          )
        ) : sparkNote != null ? (
          <span className="mrr-spark-note">{sparkNote}</span>
        ) : (
          <span className="mrr-spark-ph" aria-hidden="true" style={{ width: sparkFill ? "100%" : sparkWidth, height: sparkHeight }} />
        )}
      </span>
    </>
  );
}

export default function QuoteCard({ symbol, price, raw, change, changeTone, tag, series, title }: QuoteCardProps) {
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = raw;
    if (before === undefined || raw === undefined || before === raw) return;
    setFlash(raw > before ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [raw]);

  return (
    <div
      className="mrr-quote mrr-qslots"
      data-symbol={symbol}
      title={title}
      style={flash ? { animation: `mrr-flash-${flash} var(--tick-flash) var(--ease-out)` } : undefined}
    >
      <QuoteSlots symbol={symbol} price={price} change={change} changeTone={changeTone} tag={tag} series={series} />
    </div>
  );
}
